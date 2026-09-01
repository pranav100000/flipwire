import { sql } from "drizzle-orm";

import { getConfig } from "@/config";
import { getDatabase } from "@/db/client";
import { jsonResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = async (): Promise<Response> => {
  const database = getDatabase(getConfig().databaseUrl);
  await database.execute(sql`select 1`);
  return jsonResponse({ status: "ready" }, { noStore: true });
};

