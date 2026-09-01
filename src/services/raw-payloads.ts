import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Database } from "@/db/client";
import { rawPayloads } from "@/db/schema";

const REDACTED = "[REDACTED]";
const sensitiveKeys = new Set([
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "password",
  "secret",
  "session",
  "token",
]);

const isSensitive = (key: string): boolean => {
  const normalized = key.toLowerCase().replaceAll("-", "_");
  return (
    sensitiveKeys.has(normalized) ||
    normalized.endsWith("_token") ||
    normalized.endsWith("_secret") ||
    normalized.endsWith("_key")
  );
};

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, isSensitive(key) ? REDACTED : redact(item)]),
    );
  }
  return value;
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const redactUrl = (sourceUrl: string | null): string | null => {
  if (!sourceUrl) return null;
  const url = new URL(sourceUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitive(key)) url.searchParams.set(key, REDACTED);
  }
  return url.toString();
};

type RetainRawJsonInput = Readonly<{
  database: Database;
  payload: unknown;
  runId: string;
  source: "ticket_data" | "tickpick" | "b2b";
  sourceUrl: string | null;
  storageRoot: string;
}>;

export const retainRawJson = async (input: RetainRawJsonInput) => {
  const retained = redact(input.payload);
  const content = stableJson(retained);
  const contentHash = createHash("sha256").update(content).digest("hex");
  const storagePath = path.join(input.source, contentHash.slice(0, 2), `${contentHash}.json`);
  const destination = path.join(input.storageRoot, storagePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");

  const [stored] = await input.database
    .insert(rawPayloads)
    .values({
      contentHash,
      payloadType: "json",
      runId: input.runId,
      source: input.source,
      sourceUrl: redactUrl(input.sourceUrl),
      storagePath,
    })
    .returning();
  /* v8 ignore next -- PostgreSQL RETURNING always yields the inserted raw metadata row */
  if (!stored) throw new Error("Raw payload metadata was not stored");
  return stored;
};
