import { eq } from "drizzle-orm";

import { getConfig } from "@/config";
import { closeDatabaseConnections, getDatabase } from "@/db/client";
import { sourceConfigs } from "@/db/schema";
import { isMainModule, logProcessEvent, runUntilStopped } from "@/lib/process-runtime";
import {
  claimNextJob,
  failClaimedJob,
  processClaimedJob,
  recoverAbandonedJobs,
  retryFailedJob,
} from "@/services/jobs";

export const runWorkerCycle = async (): Promise<boolean> => {
  const config = getConfig();
  const database = getDatabase(config.databaseUrl);
  const job = await claimNextJob({ database, now: new Date() });
  if (!job) return false;

  logProcessEvent("info", "ingestion_job_started", { jobId: job.id, source: job.source });
  let completed;
  try {
    completed = await processClaimedJob({
      config,
      database,
      job,
      storageRoot: config.rawStorageRoot,
    });
  } catch {
    completed = await failClaimedJob({ database, jobId: job.id });
  }

  if (completed.status === "failed") {
    const sourceConfig = await database.query.sourceConfigs.findFirst({
      where: eq(sourceConfigs.source, job.source),
    });
    if (sourceConfig) {
      await retryFailedJob({
        backoffSeconds: sourceConfig.backoffSeconds,
        database,
        jobId: job.id,
        maxAttempts: sourceConfig.maxRetries + 1,
        now: new Date(),
      });
    }
  }
  logProcessEvent(completed.status === "failed" ? "warn" : "info", "ingestion_job_finished", {
    jobId: job.id,
    source: job.source,
    status: completed.status,
  });
  return true;
};

const main = async (): Promise<void> => {
  const config = getConfig();
  const database = getDatabase(config.databaseUrl);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const recovered = await recoverAbandonedJobs({
    database,
    now: new Date(),
    staleAfterMs: 15 * 60_000,
  });
  logProcessEvent("info", "worker_started", { recovered });
  try {
    await runUntilStopped({
      intervalMs: 2_000,
      runOnce: async () => {
        try {
          await runWorkerCycle();
        } catch {
          logProcessEvent("error", "worker_cycle_failed");
        }
      },
      signal: controller.signal,
    });
  } finally {
    await closeDatabaseConnections();
    logProcessEvent("info", "worker_stopped");
  }
};

if (isMainModule(import.meta.url)) void main();
