import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { parseDatabaseUrl } from "@/config";

const run = async (): Promise<void> => {
  const client = postgres(parseDatabaseUrl(process.env), { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    process.stdout.write(`${JSON.stringify({ level: "info", message: "database migrated" })}\n`);
  } finally {
    await client.end();
  }
};

await run();
