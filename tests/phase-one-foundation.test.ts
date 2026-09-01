import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as getArtists } from "@/app/api/artists/route";
import { POST as createSession } from "@/app/api/auth/session/route";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getReadiness } from "@/app/api/ready/route";
import { parseConfig, parseDatabaseUrl } from "@/config";
import { getDatabase } from "@/db/client";
import {
  artists,
  events,
  ingestionRuns,
  listings,
  marketSnapshots,
  rawPayloads,
  sourceEvents,
  venues,
} from "@/db/schema";
import { resetTestDatabase } from "@/testing/database";
import { retainRawJson } from "@/services/raw-payloads";

const testEnvironment = (overrides: Readonly<Record<string, string>> = {}) => ({
  DATABASE_URL: "postgresql://flipwire:flipwire@127.0.0.1:55432/flipwire_test",
  FLIPWIRE_ADMIN_PASSWORD: "local-test-password",
  FLIPWIRE_ADMIN_USERNAME: "operator",
  FLIPWIRE_RAW_STORAGE_ROOT: "/tmp/flipwire-test-raw",
  FLIPWIRE_SECRET_KEY: "s".repeat(32),
  ...overrides,
});

describe("deploy configuration", () => {
  it("rejects missing and short secrets at the trust boundary", () => {
    const missingSecret: Record<string, string> = { ...testEnvironment() };
    Reflect.deleteProperty(missingSecret, "FLIPWIRE_SECRET_KEY");

    expect(() => parseConfig(missingSecret)).toThrow(/FLIPWIRE_SECRET_KEY/i);
    expect(() => parseConfig(testEnvironment({ FLIPWIRE_SECRET_KEY: "short" }))).toThrow(
      /at least 32/i,
    );
    expect(parseConfig(testEnvironment()).secretKey).toBe("s".repeat(32));
  });

  it("normalizes deploy-specific values", () => {
    const config = parseConfig(
      testEnvironment({ FLIPWIRE_DEBUG: "true", FLIPWIRE_LOG_LEVEL: "warning" }),
    );

    expect(config.debug).toBe(true);
    expect(config.logLevel).toBe("WARNING");
    expect(config.databaseUrl).toMatch(/flipwire_test$/);
    expect(config.rawStorageRoot).toBe("/tmp/flipwire-test-raw");
  });

  it("treats blank optional connector settings as unset", () => {
    const config = parseConfig(
      testEnvironment({
        B2B_API_TOKEN: "",
        B2B_BASE_URL: "",
        TICKET_DATA_API_TOKEN: "",
        TICKET_DATA_BASE_URL: "",
        TICKPICK_API_TOKEN: "",
        TICKPICK_BASE_URL: "",
      }),
    );

    expect(config).not.toHaveProperty("b2bBaseUrl");
    expect(config).not.toHaveProperty("ticketDataApiToken");
    expect(config).not.toHaveProperty("tickpickBaseUrl");
  });

  it("allows migration processes to validate only their database URL", () => {
    expect(parseDatabaseUrl({ DATABASE_URL: testEnvironment().DATABASE_URL })).toBe(
      testEnvironment().DATABASE_URL,
    );
    expect(() => parseDatabaseUrl({ DATABASE_URL: "sqlite:///flipwire.db" })).toThrow(
      /PostgreSQL URL/,
    );
  });
});

describe("PostgreSQL foundation", () => {
  const database = getDatabase(testEnvironment().DATABASE_URL);

  beforeEach(async () => {
    await resetTestDatabase(testEnvironment().DATABASE_URL);
  });

  it("preserves raw source identity and rejects duplicate source listings", async () => {
    const [artist] = await database
      .insert(artists)
      .values({ canonicalName: "the midnight", displayName: "The Midnight" })
      .returning();
    const [venue] = await database
      .insert(venues)
      .values({
        canonicalName: "the greek theatre",
        city: "Los Angeles",
        country: "US",
        displayName: "The Greek Theatre",
        stateRegion: "CA",
        timezone: "America/Los_Angeles",
      })
      .returning();
    expect(artist).toBeDefined();
    expect(venue).toBeDefined();
    if (!artist || !venue) throw new Error("Fixture creation failed");

    const [event] = await database
      .insert(events)
      .values({
        artistId: artist.id,
        canonicalEventKey: "the-midnight|the-greek-theatre|2026-10-02",
        eventName: "The Midnight Live",
        startsAt: new Date("2026-10-03T03:00:00.000Z"),
        venueId: venue.id,
      })
      .returning();
    const [run] = await database
      .insert(ingestionRuns)
      .values({ source: "tickpick", status: "running" })
      .returning();
    expect(event).toBeDefined();
    expect(run).toBeDefined();
    if (!event || !run) throw new Error("Fixture creation failed");

    const [raw] = await database
      .insert(rawPayloads)
      .values({
        contentHash: "a".repeat(64),
        payloadType: "json",
        runId: run.id,
        source: "tickpick",
        storagePath: "tickpick/aa/payload.json",
      })
      .returning();
    expect(raw).toBeDefined();
    if (!raw) throw new Error("Fixture creation failed");

    await database.insert(sourceEvents).values({
      eventId: event.id,
      rawArtistName: "The Midnight",
      rawPayloadId: raw.id,
      rawVenueName: "Greek Theatre",
      source: "tickpick",
      sourceEventId: "tp-event-1",
      sourceUrl: "https://example.test/events/tp-event-1",
    });
    await database.insert(marketSnapshots).values({
      eventId: event.id,
      getInPrice: "88.00",
      observedAt: new Date("2026-08-31T12:00:00.000Z"),
      source: "ticket_data",
    });
    await database.insert(listings).values({
      eventId: event.id,
      listingUrl: "https://example.test/listings/1",
      source: "tickpick",
      sourceListingId: "listing-1",
      unitPrice: "120.00",
    });

    await expect(
      database.insert(listings).values({
        eventId: event.id,
        listingUrl: "https://example.test/listings/1-copy",
        source: "tickpick",
        sourceListingId: "listing-1",
        unitPrice: "125.00",
      }),
    ).rejects.toThrow();

    const retained = await database.query.sourceEvents.findFirst({
      where: (record, { eq }) => eq(record.sourceEventId, "tp-event-1"),
    });
    expect(retained?.rawArtistName).toBe("The Midnight");
  });
});

describe("authenticated operational API", () => {
  beforeEach(() => {
    process.env = { ...process.env, ...testEnvironment() };
  });

  it("keeps health public, checks readiness, and sends security headers", async () => {
    const health = await getHealth();
    const readiness = await getReadiness();

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(readiness.status).toBe(200);
    await expect(readiness.json()).resolves.toEqual({ status: "ready" });
  });

  it("rejects unauthenticated reads and creates a secure operator session", async () => {
    const unauthenticated = await getArtists(new Request("http://localhost/api/artists"));
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({
      error: "UNAUTHENTICATED",
      message: "Valid FlipWire operator credentials are required.",
    });

    const rejectedLogin = await createSession(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ password: "incorrect-password", username: "operator" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(rejectedLogin.status).toBe(401);

    const authenticated = await createSession(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ password: "local-test-password", username: "operator" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(authenticated.status).toBe(204);
    expect(authenticated.headers.get("set-cookie")).toMatch(
      /^flipwire_session=.*HttpOnly.*SameSite=Strict/i,
    );
  });
});

describe("raw payload retention", () => {
  const database = getDatabase(testEnvironment().DATABASE_URL);
  let storageRoot = "";

  beforeEach(async () => {
    await resetTestDatabase(testEnvironment().DATABASE_URL);
    storageRoot = await mkdtemp(path.join(tmpdir(), "flipwire-raw-"));
  });

  afterEach(async () => {
    await rm(storageRoot, { force: true, recursive: true });
  });

  it("writes content-addressed JSON after recursively removing credentials", async () => {
    const [run] = await database
      .insert(ingestionRuns)
      .values({ source: "ticket_data", status: "running" })
      .returning();
    expect(run).toBeDefined();
    if (!run) throw new Error("Fixture creation failed");

    const stored = await retainRawJson({
      database,
      payload: {
        authorization: "Bearer top-secret-token",
        event: { id: "td-event-1", name: "The Midnight Live" },
        nested: { api_key: "also-secret", price: 88 },
      },
      runId: run.id,
      source: "ticket_data",
      sourceUrl: "https://example.test/events/td-event-1?api_key=query-secret",
      storageRoot,
    });
    const retained = JSON.parse(
      await readFile(path.join(storageRoot, stored.storagePath), "utf8"),
    ) as unknown;

    expect(stored.contentHash).toBe(
      "cedde0725ea457dbb1d08a9f0ba9a3abbe0bbb33859ddd73de960cfd97e05d0c",
    );
    expect(retained).toEqual({
      authorization: "[REDACTED]",
      event: { id: "td-event-1", name: "The Midnight Live" },
      nested: { api_key: "[REDACTED]", price: 88 },
    });
    expect(stored.sourceUrl).toBe(
      "https://example.test/events/td-event-1?api_key=%5BREDACTED%5D",
    );
  });

  it("redacts sensitive array members and accepts payloads without a source URL", async () => {
    const [run] = await database
      .insert(ingestionRuns)
      .values({ source: "b2b", status: "running" })
      .returning();
    if (!run) throw new Error("Fixture creation failed");

    const stored = await retainRawJson({
      database,
      payload: [{ access_token: "hidden", value: true }, null, "plain"],
      runId: run.id,
      source: "b2b",
      sourceUrl: "https://example.test/events?view=compact",
      storageRoot,
    });
    const retained = JSON.parse(
      await readFile(path.join(storageRoot, stored.storagePath), "utf8"),
    ) as unknown;

    expect(retained).toEqual([{ access_token: "[REDACTED]", value: true }, null, "plain"]);
    expect(stored.sourceUrl).toBe("https://example.test/events?view=compact");
    const withoutUrl = await retainRawJson({
      database,
      payload: "second payload",
      runId: run.id,
      source: "b2b",
      sourceUrl: null,
      storageRoot,
    });
    expect(withoutUrl.sourceUrl).toBeNull();
  });
});
