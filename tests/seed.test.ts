import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { parseConfig } from "@/config";
import { getDatabase } from "@/db/client";
import { artists, events, listings, sourceConfigs, sourceEvents } from "@/db/schema";
import { seedFixtureCatalog } from "@/services/seed";
import { resetTestDatabase } from "@/testing/database";

const databaseUrl = "postgresql://flipwire:flipwire@127.0.0.1:55432/flipwire_test";
const database = getDatabase(databaseUrl);
const config = parseConfig({
  DATABASE_URL: databaseUrl,
  FLIPWIRE_ADMIN_PASSWORD: "local-test-password",
  FLIPWIRE_ADMIN_USERNAME: "operator",
  FLIPWIRE_RAW_STORAGE_ROOT: "/tmp/flipwire-test-raw",
  FLIPWIRE_SECRET_KEY: "s".repeat(32),
});
let storageRoot = "";

beforeEach(async () => {
  await resetTestDatabase(databaseUrl);
  storageRoot = await mkdtemp(path.join(tmpdir(), "flipwire-seed-"));
});

afterEach(async () => {
  await rm(storageRoot, { force: true, recursive: true });
});

it("seeds the monitored catalog and all fixture sources idempotently", async () => {
  const first = await seedFixtureCatalog({
    config,
    database,
    monitoredArtists: ["The Midnight"],
    storageRoot,
  });
  const second = await seedFixtureCatalog({
    config,
    database,
    monitoredArtists: ["The Midnight"],
    storageRoot,
  });

  expect(first.map((result) => result.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  expect(second.map((result) => result.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  expect(await database.select().from(artists)).toHaveLength(1);
  expect(await database.select().from(events)).toHaveLength(1);
  expect(await database.select().from(sourceEvents)).toHaveLength(3);
  expect(await database.select().from(listings)).toHaveLength(2);
  expect(await database.select().from(sourceConfigs)).toHaveLength(3);
});
