import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import type { Config } from "@/config";
import type { IngestionScope, Source } from "@/connectors/contracts";
import { createConfiguredConnector } from "@/connectors/configured";
import type { Database } from "@/db/client";
import { ingestionJobs, sourceConfigs } from "@/db/schema";
import { runSourceIngestion } from "@/services/ingestion";

type Job = typeof ingestionJobs.$inferSelect;

export class IdempotencyKeyReusedError extends Error {}
export class SourceAlreadyQueuedError extends Error {}

const scopeSchema = z.object({
  artist: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  url: z.url().optional(),
});

const parseScope = (value: unknown): IngestionScope => {
  const parsed = scopeSchema.parse(value);
  return {
    ...(parsed.artist ? { artist: parsed.artist } : {}),
    ...(parsed.eventId ? { eventId: parsed.eventId } : {}),
    ...(parsed.url ? { url: parsed.url } : {}),
  };
};

const activeJob = async (database: Database, source: Source): Promise<Job | undefined> =>
  database.query.ingestionJobs.findFirst({
    where: and(
      eq(ingestionJobs.source, source),
      inArray(ingestionJobs.status, ["pending", "running"]),
    ),
  });

export const ensureSourceConfigs = async (database: Database): Promise<void> => {
  await database
    .insert(sourceConfigs)
    .values([
      { source: "ticket_data" },
      { source: "tickpick" },
      { source: "b2b" },
    ])
    .onConflictDoNothing({ target: sourceConfigs.source });
};

export const enqueueDueSources = async (input: {
  readonly database: Database;
  readonly now: Date;
}): Promise<ReadonlyArray<Job>> => {
  const due = await input.database
    .select()
    .from(sourceConfigs)
    .where(and(eq(sourceConfigs.enabled, true), lte(sourceConfigs.nextRunAt, input.now)))
    .orderBy(asc(sourceConfigs.source));
  const queued: Array<Job> = [];
  for (const config of due) {
    const existing = await activeJob(input.database, config.source);
    if (!existing) {
      const [job] = await input.database
        .insert(ingestionJobs)
        .values({ source: config.source, status: "pending" })
        .returning();
      /* v8 ignore next -- PostgreSQL RETURNING always yields the inserted job */
      if (job) queued.push(job);
    }
    await input.database
      .update(sourceConfigs)
      .set({ nextRunAt: new Date(input.now.getTime() + config.cadenceMinutes * 60_000) })
      .where(eq(sourceConfigs.id, config.id));
  }
  return queued;
};

export const claimNextJob = async (input: {
  readonly database: Database;
  readonly now: Date;
}): Promise<Job | null> =>
  input.database.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(ingestionJobs)
      .where(
        and(eq(ingestionJobs.status, "pending"), lte(ingestionJobs.availableAt, input.now)),
      )
      .orderBy(asc(ingestionJobs.availableAt), asc(ingestionJobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;

    const [claimed] = await transaction
      .update(ingestionJobs)
      .set({
        attempts: candidate.attempts + 1,
        claimedAt: input.now,
        lastError: "",
        status: "running",
      })
      .where(eq(ingestionJobs.id, candidate.id))
      .returning();
    /* v8 ignore next -- a locked candidate remains present for this transaction's update */
    return claimed ?? null;
  });

export const processClaimedJob = async (input: {
  readonly config: Config;
  readonly database: Database;
  readonly job: Job;
  readonly storageRoot: string;
}): Promise<Job> => {
  const sourceConfig = await input.database.query.sourceConfigs.findFirst({
    where: eq(sourceConfigs.source, input.job.source),
  });
  const connector = createConfiguredConnector({
    config: input.config,
    fixtureMode: sourceConfig?.fixtureMode ?? true,
    maxRetries: sourceConfig?.maxRetries ?? 3,
    rateLimitSeconds: Number(sourceConfig?.rateLimitSeconds ?? 0),
    source: input.job.source,
    timeoutMs: (sourceConfig?.timeoutSeconds ?? 30) * 1_000,
  });
  const scope = parseScope(input.job.scope);
  const result = await runSourceIngestion({
    connector,
    database: input.database,
    ...(Object.keys(scope).length > 0 ? { scope } : {}),
    storageRoot: input.storageRoot,
  });
  const succeeded = result.status !== "failed";
  const [completed] = await input.database
    .update(ingestionJobs)
    .set({
      completedAt: new Date(),
      ingestionRunId: result.runId,
      lastError: succeeded ? "" : "Source ingestion failed",
      status: succeeded ? "succeeded" : "failed",
    })
    .where(eq(ingestionJobs.id, input.job.id))
    .returning();
  /* v8 ignore next -- the claimed job remains present through its completion update */
  if (!completed) throw new Error("Claimed job could not be completed");
  if (succeeded && sourceConfig) {
    await input.database
      .update(sourceConfigs)
      .set({ lastSuccessAt: new Date() })
      .where(eq(sourceConfigs.id, sourceConfig.id));
  }
  return completed;
};

export const recoverAbandonedJobs = async (input: {
  readonly database: Database;
  readonly now: Date;
  readonly staleAfterMs: number;
}): Promise<number> => {
  const cutoff = new Date(input.now.getTime() - input.staleAfterMs);
  const recovered = await input.database
    .update(ingestionJobs)
    .set({
      availableAt: input.now,
      claimedAt: null,
      lastError: "Recovered after an interrupted worker",
      status: "pending",
    })
    .where(and(eq(ingestionJobs.status, "running"), lte(ingestionJobs.claimedAt, cutoff)))
    .returning({ id: ingestionJobs.id });
  return recovered.length;
};

export const failClaimedJob = async (input: {
  readonly database: Database;
  readonly jobId: string;
}): Promise<Job> => {
  const [failed] = await input.database
    .update(ingestionJobs)
    .set({
      completedAt: new Date(),
      lastError: "Worker execution failed",
      status: "failed",
    })
    .where(and(eq(ingestionJobs.id, input.jobId), eq(ingestionJobs.status, "running")))
    .returning();
  if (!failed) throw new Error("Running job could not be marked failed");
  return failed;
};

export const retryFailedJob = async (input: {
  readonly backoffSeconds: number;
  readonly database: Database;
  readonly jobId: string;
  readonly maxAttempts: number;
  readonly now: Date;
}): Promise<Job | null> => {
  const job = await input.database.query.ingestionJobs.findFirst({
    where: eq(ingestionJobs.id, input.jobId),
  });
  if (!job || job.status !== "failed" || job.attempts >= input.maxAttempts) return null;
  const [retried] = await input.database
    .update(ingestionJobs)
    .set({
      availableAt: new Date(input.now.getTime() + input.backoffSeconds * 1_000),
      claimedAt: null,
      completedAt: null,
      status: "pending",
    })
    .where(eq(ingestionJobs.id, input.jobId))
    .returning();
  /* v8 ignore next -- the failed job remains present through its retry update */
  return retried ?? null;
};

const scopeEquals = (
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean => JSON.stringify(left) === JSON.stringify(right);

export const enqueueManualJob = async (input: {
  readonly database: Database;
  readonly idempotencyKey: string;
  readonly scope: IngestionScope;
  readonly source: Source;
}): Promise<Readonly<{ job: Job; replayed: boolean }>> => {
  const replay = await input.database.query.ingestionJobs.findFirst({
    where: eq(ingestionJobs.idempotencyKey, input.idempotencyKey),
  });
  if (replay) {
    if (replay.source !== input.source || !scopeEquals(replay.scope, input.scope)) {
      throw new IdempotencyKeyReusedError();
    }
    return { job: replay, replayed: true };
  }
  if (await activeJob(input.database, input.source)) throw new SourceAlreadyQueuedError();

  const [job] = await input.database
    .insert(ingestionJobs)
    .values({
      idempotencyKey: input.idempotencyKey,
      scope: input.scope,
      source: input.source,
      status: "pending",
    })
    .returning();
  /* v8 ignore next -- PostgreSQL RETURNING always yields the inserted manual job */
  if (!job) throw new Error("Manual ingestion job was not created");
  return { job, replayed: false };
};
