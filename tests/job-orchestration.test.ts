import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as createIngestionJob } from "@/app/api/ingestion-jobs/route";
import { parseConfig } from "@/config";
import { getDatabase } from "@/db/client";
import { ingestionJobs, ingestionRuns, sourceConfigs } from "@/db/schema";
import { createSessionToken } from "@/lib/auth";
import {
  claimNextJob,
  enqueueManualJob,
  enqueueDueSources,
  failClaimedJob,
  IdempotencyKeyReusedError,
  processClaimedJob,
  recoverAbandonedJobs,
  retryFailedJob,
  SourceAlreadyQueuedError,
} from "@/services/jobs";
import { resetTestDatabase } from "@/testing/database";

const databaseUrl = "postgresql://flipwire:flipwire@127.0.0.1:55432/flipwire_test";
const database = getDatabase(databaseUrl);
const environment = () => ({
  DATABASE_URL: databaseUrl,
  FLIPWIRE_ADMIN_PASSWORD: "local-test-password",
  FLIPWIRE_ADMIN_USERNAME: "operator",
  FLIPWIRE_DEBUG: "true",
  FLIPWIRE_LOG_LEVEL: "INFO",
  FLIPWIRE_RAW_STORAGE_ROOT: "/tmp/flipwire-test-raw",
  FLIPWIRE_SECRET_KEY: "s".repeat(32),
});

describe("scheduler and worker orchestration", () => {
  let storageRoot = "";

  beforeEach(async () => {
    process.env = { ...process.env, ...environment() };
    await resetTestDatabase(databaseUrl);
    storageRoot = await mkdtemp(path.join(tmpdir(), "flipwire-jobs-"));
  });

  afterEach(async () => {
    await rm(storageRoot, { force: true, recursive: true });
  });

  it("enqueues each due source once and advances its configurable schedule", async () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    await database.insert(sourceConfigs).values([
      { cadenceMinutes: 120, nextRunAt: new Date("2026-08-31T11:00:00.000Z"), source: "ticket_data" },
      { cadenceMinutes: 60, nextRunAt: now, source: "tickpick" },
      { cadenceMinutes: 120, nextRunAt: new Date("2026-08-31T14:00:00.000Z"), source: "b2b" },
    ]);

    const first = await enqueueDueSources({ database, now });
    const second = await enqueueDueSources({ database, now });

    expect(first.map((job) => job.source)).toEqual(["ticket_data", "tickpick"]);
    expect(second).toEqual([]);
    expect(await database.select().from(ingestionJobs)).toHaveLength(2);
    const configs = await database.select().from(sourceConfigs);
    expect(configs.find((config) => config.source === "ticket_data")?.nextRunAt).toEqual(
      new Date("2026-08-31T14:00:00.000Z"),
    );
    expect(configs.find((config) => config.source === "tickpick")?.nextRunAt).toEqual(
      new Date("2026-08-31T13:00:00.000Z"),
    );
  });

  it("claims jobs atomically and processes fixture ingestion through the worker", async () => {
    const [queued] = await database
      .insert(ingestionJobs)
      .values({
        availableAt: new Date("2026-08-31T11:59:00.000Z"),
        source: "ticket_data",
        status: "pending",
      })
      .returning();
    await database.insert(sourceConfigs).values({ fixtureMode: true, source: "ticket_data" });
    if (!queued) throw new Error("Fixture creation failed");

    const claimed = await claimNextJob({
      database,
      now: new Date("2026-08-31T12:00:00.000Z"),
    });
    const secondClaim = await claimNextJob({
      database,
      now: new Date("2026-08-31T12:00:01.000Z"),
    });
    expect(claimed).toMatchObject({ attempts: 1, id: queued.id, status: "running" });
    expect(secondClaim).toBeNull();
    if (!claimed) throw new Error("Expected a claimed job");

    const completed = await processClaimedJob({
      config: parseConfig(environment()),
      database,
      job: claimed,
      storageRoot,
    });

    expect(completed.status).toBe("succeeded");
    expect(completed.ingestionRunId).toBeTruthy();
    expect(await database.select().from(ingestionRuns)).toHaveLength(1);
  });

  it("recovers abandoned work and makes failed jobs retryable with backoff", async () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    const [abandoned] = await database
      .insert(ingestionJobs)
      .values({
        attempts: 1,
        claimedAt: new Date("2026-08-31T11:30:00.000Z"),
        source: "tickpick",
        status: "running",
      })
      .returning();
    if (!abandoned) throw new Error("Fixture creation failed");

    expect(
      await recoverAbandonedJobs({ database, now, staleAfterMs: 15 * 60 * 1_000 }),
    ).toBe(1);
    const recovered = await database.query.ingestionJobs.findFirst({
      where: eq(ingestionJobs.id, abandoned.id),
    });
    expect(recovered).toMatchObject({ claimedAt: null, status: "pending" });

    await database
      .update(ingestionJobs)
      .set({ attempts: 2, status: "failed" })
      .where(eq(ingestionJobs.id, abandoned.id));
    const retried = await retryFailedJob({
      backoffSeconds: 30,
      database,
      jobId: abandoned.id,
      maxAttempts: 3,
      now,
    });
    expect(retried).toMatchObject({
      attempts: 2,
      availableAt: new Date("2026-08-31T12:00:30.000Z"),
      status: "pending",
    });
  });

  it("marks an unexpectedly interrupted claimed job failed without persisting exception details", async () => {
    const [claimed] = await database
      .insert(ingestionJobs)
      .values({
        attempts: 1,
        claimedAt: new Date("2026-08-31T12:00:00.000Z"),
        source: "b2b",
        status: "running",
      })
      .returning();
    if (!claimed) throw new Error("Fixture creation failed");

    const failed = await failClaimedJob({ database, jobId: claimed.id });

    expect(failed).toMatchObject({
      completedAt: expect.any(Date),
      lastError: "Worker execution failed",
      status: "failed",
    });
  });

  it("creates idempotent authenticated manual jobs and rejects key reuse with new parameters", async () => {
    const config = parseConfig(environment());
    const token = createSessionToken("operator", config.secretKey);
    const request = (source: "b2b" | "tickpick") =>
      new Request("http://localhost/api/ingestion-jobs", {
        body: JSON.stringify({ artist: "The Midnight", source }),
        headers: {
          cookie: `flipwire_session=${token}`,
          "content-type": "application/json",
          "idempotency-key": "manual-run-1",
          origin: "http://localhost",
        },
        method: "POST",
      });

    const first = await createIngestionJob(request("b2b"));
    const repeated = await createIngestionJob(request("b2b"));
    const conflict = await createIngestionJob(request("tickpick"));

    expect(first.status).toBe(202);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(await first.json());
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ error: "IDEMPOTENCY_KEY_REUSED" });
    expect(await database.select().from(ingestionJobs)).toHaveLength(1);
  });

  it("advances due schedules without duplicating an already-active source", async () => {
    const now = new Date("2026-08-31T12:00:00Z");
    await database.insert(sourceConfigs).values({ nextRunAt: now, source: "b2b" });
    await database.insert(ingestionJobs).values({ source: "b2b", status: "pending" });

    await expect(enqueueDueSources({ database, now })).resolves.toEqual([]);
    expect(await database.select().from(ingestionJobs)).toHaveLength(1);
    const config = await database.query.sourceConfigs.findFirst({
      where: eq(sourceConfigs.source, "b2b"),
    });
    expect(config?.nextRunAt).toEqual(new Date("2026-08-31T14:00:00Z"));
  });

  it("rejects invalid retry and manual-job state transitions", async () => {
    const now = new Date("2026-08-31T12:00:00Z");
    expect(
      await retryFailedJob({
        backoffSeconds: 1,
        database,
        jobId: "00000000-0000-4000-8000-000000000000",
        maxAttempts: 3,
        now,
      }),
    ).toBeNull();
    const [pending] = await database
      .insert(ingestionJobs)
      .values({ source: "tickpick", status: "pending" })
      .returning();
    if (!pending) throw new Error("Fixture creation failed");
    expect(
      await retryFailedJob({
        backoffSeconds: 1,
        database,
        jobId: pending.id,
        maxAttempts: 3,
        now,
      }),
    ).toBeNull();
    await expect(failClaimedJob({ database, jobId: pending.id })).rejects.toThrow(/could not/);
    await expect(
      enqueueManualJob({
        database,
        idempotencyKey: "another-key",
        scope: {},
        source: "tickpick",
      }),
    ).rejects.toBeInstanceOf(SourceAlreadyQueuedError);

    await database
      .update(ingestionJobs)
      .set({ attempts: 3, status: "failed" })
      .where(eq(ingestionJobs.id, pending.id));
    expect(
      await retryFailedJob({
        backoffSeconds: 1,
        database,
        jobId: pending.id,
        maxAttempts: 3,
        now,
      }),
    ).toBeNull();
  });

  it("rejects replaying an idempotency key with a different scope", async () => {
    await enqueueManualJob({
      database,
      idempotencyKey: "same-source-key",
      scope: { artist: "The Midnight" },
      source: "b2b",
    });

    await expect(
      enqueueManualJob({
        database,
        idempotencyKey: "same-source-key",
        scope: { artist: "Another Artist" },
        source: "b2b",
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it("uses default fixture policy for full manual scopes and records live configuration failures", async () => {
    const [fixtureJob] = await database
      .insert(ingestionJobs)
      .values({
        scope: {
          artist: "The Midnight",
          eventId: "td-midnight-la",
          url: "https://authorized.test/ticket-data/event",
        },
        source: "ticket_data",
        status: "running",
      })
      .returning();
    if (!fixtureJob) throw new Error("Fixture creation failed");
    const succeeded = await processClaimedJob({
      config: parseConfig(environment()),
      database,
      job: fixtureJob,
      storageRoot,
    });
    expect(succeeded.status).toBe("succeeded");

    await database.insert(sourceConfigs).values({ fixtureMode: false, source: "b2b" });
    const [liveJob] = await database
      .insert(ingestionJobs)
      .values({ source: "b2b", status: "running" })
      .returning();
    if (!liveJob) throw new Error("Fixture creation failed");
    const failed = await processClaimedJob({
      config: parseConfig(environment()),
      database,
      job: liveJob,
      storageRoot,
    });
    expect(failed).toMatchObject({ lastError: "Source ingestion failed", status: "failed" });
  });
});
