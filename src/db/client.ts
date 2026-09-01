import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

const clients = new Map<string, ReturnType<typeof postgres>>();

export const getDatabase = (databaseUrl: string) => {
  const existing = clients.get(databaseUrl);
  const client = existing ?? postgres(databaseUrl, { max: 10 });
  if (!existing) clients.set(databaseUrl, client);
  return drizzle(client, { schema });
};

export type Database = ReturnType<typeof getDatabase>;

export const closeDatabaseConnections = async (): Promise<void> => {
  await Promise.all([...clients.values()].map(async (client) => client.end()));
  clients.clear();
};

