import { closeDatabaseConnections, getDatabase } from "@/db/client";
import { getConfig } from "@/config";
import { enqueueDueSources, ensureSourceConfigs } from "@/services/jobs";
import { isMainModule, logProcessEvent, runUntilStopped } from "@/lib/process-runtime";

export const runSchedulerCycle = async (): Promise<number> => {
  const config = getConfig();
  const database = getDatabase(config.databaseUrl);
  await ensureSourceConfigs(database);
  const jobs = await enqueueDueSources({ database, now: new Date() });
  if (jobs.length > 0) logProcessEvent("info", "ingestion_jobs_enqueued", { count: jobs.length });
  return jobs.length;
};

const main = async (): Promise<void> => {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  logProcessEvent("info", "scheduler_started");
  try {
    await runUntilStopped({
      intervalMs: 30_000,
      runOnce: async () => {
        try {
          await runSchedulerCycle();
        } catch {
          logProcessEvent("error", "scheduler_cycle_failed");
        }
      },
      signal: controller.signal,
    });
  } finally {
    await closeDatabaseConnections();
    logProcessEvent("info", "scheduler_stopped");
  }
};

if (isMainModule(import.meta.url)) void main();
