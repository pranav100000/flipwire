import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { getConfig } from "@/config";
import { closeDatabaseConnections, getDatabase } from "@/db/client";
import { logProcessEvent } from "@/lib/process-runtime";
import { seedFixtureCatalog } from "@/services/seed";

const main = async (): Promise<void> => {
  const config = getConfig();
  const monitoredArtists = z
    .array(z.string().trim().min(1))
    .min(1)
    .parse(
      JSON.parse(
        await readFile(path.join(process.cwd(), "config", "monitored-artists.json"), "utf8"),
      ) as unknown,
    );
  try {
    const results = await seedFixtureCatalog({
      config,
      database: getDatabase(config.databaseUrl),
      monitoredArtists,
      storageRoot: config.rawStorageRoot,
    });
    logProcessEvent("info", "fixture_catalog_seeded", {
      sources: results.length,
      succeeded: results.filter((result) => result.status === "succeeded").length,
    });
  } finally {
    await closeDatabaseConnections();
  }
};

void main();
