import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Connector, Source } from "@/connectors/contracts";
import { collectHttpJson } from "@/connectors/http";
import { translateSourcePayload } from "@/connectors/translate";
import { getDatabase } from "@/db/client";
import {
  events,
  ingestionRuns,
  listings,
  marketSnapshots,
  priceHistory,
  rawPayloads,
  reviewItems,
  sourceConfigs,
  sourceEvents,
} from "@/db/schema";
import { runConnectorSet, runSourceIngestion } from "@/services/ingestion";
import { resetTestDatabase } from "@/testing/database";

const databaseUrl = "postgresql://flipwire:flipwire@127.0.0.1:55432/flipwire_test";
const database = getDatabase(databaseUrl);

const loadFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(path.join(process.cwd(), "fixtures", `${name}.json`), "utf8")) as unknown;

const connector = (source: Source, payload: () => unknown): Connector => ({
  collect: async () => ({
    payload: payload(),
    sourceUrl: `fixture://${source}`,
  }),
  source,
  translate: (raw) => translateSourcePayload(source, raw),
});

describe("source ingestion", () => {
  let storageRoot = "";

  beforeEach(async () => {
    await resetTestDatabase(databaseUrl);
    storageRoot = await mkdtemp(path.join(tmpdir(), "flipwire-ingestion-"));
  });

  afterEach(async () => {
    await rm(storageRoot, { force: true, recursive: true });
  });

  it("consolidates all three source shapes into one event with market context and listings", async () => {
    const ticketData = await loadFixture("ticket-data");
    const tickpick = await loadFixture("tickpick");
    const b2b = await loadFixture("b2b");

    await runSourceIngestion({
      connector: connector("ticket_data", () => ticketData),
      database,
      storageRoot,
    });
    await runSourceIngestion({
      connector: connector("tickpick", () => tickpick),
      database,
      storageRoot,
    });
    await runSourceIngestion({
      connector: connector("b2b", () => b2b),
      database,
      storageRoot,
    });

    expect(await database.select().from(events)).toHaveLength(1);
    expect(await database.select().from(sourceEvents)).toHaveLength(3);
    expect(await database.select().from(rawPayloads)).toHaveLength(3);
    expect(await database.select().from(marketSnapshots)).toHaveLength(1);
    expect(await database.select().from(priceHistory)).toHaveLength(1);
    const retainedListings = await database
      .select({ source: listings.source, unitPrice: listings.unitPrice })
      .from(listings)
      .orderBy(asc(listings.source));
    expect(retainedListings).toEqual([
      { source: "tickpick", unitPrice: "120.00" },
      { source: "b2b", unitPrice: "109.00" },
    ]);
    const runs = await database.select().from(ingestionRuns).orderBy(asc(ingestionRuns.source));
    expect(runs.map((run) => run.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  });

  it("updates a repeated listing and snapshot without creating duplicates", async () => {
    const ticketData = await loadFixture("ticket-data");
    const tickpick = (await loadFixture("tickpick")) as {
      events: Array<{ listings: Array<{ unit_price: number }> }>;
    };
    const tickpickConnector = connector("tickpick", () => tickpick);

    await runSourceIngestion({
      connector: connector("ticket_data", () => ticketData),
      database,
      storageRoot,
    });
    await runSourceIngestion({
      connector: connector("ticket_data", () => ticketData),
      database,
      storageRoot,
    });
    await runSourceIngestion({ connector: tickpickConnector, database, storageRoot });
    const firstListing = tickpick.events[0]?.listings[0];
    if (!firstListing) throw new Error("Fixture is missing its listing");
    firstListing.unit_price = 111;
    await runSourceIngestion({ connector: tickpickConnector, database, storageRoot });

    const retained = await database.select().from(listings);
    expect(retained).toHaveLength(1);
    expect(retained[0]?.unitPrice).toBe("111.00");
    expect(await database.select().from(marketSnapshots)).toHaveLength(1);
    expect(await database.select().from(sourceEvents)).toHaveLength(2);
  });

  it("marks listings inactive only after the configured number of complete missed runs", async () => {
    const b2b = (await loadFixture("b2b")) as {
      events: Array<{ listings: Array<Record<string, unknown>> }>;
    };
    const firstEvent = b2b.events[0];
    if (!firstEvent) throw new Error("Fixture is missing its event");
    firstEvent.listings.push({
      availability: "active",
      currency: "USD",
      listingId: "b2b-listing-stale",
      listingUrl: "https://example.test/b2b/listings/b2b-listing-stale",
      quantity: 2,
      unitPrice: 140,
    });
    const b2bConnector = connector("b2b", () => b2b);
    await database.insert(sourceConfigs).values({
      source: "b2b",
      staleAfterMissedRuns: 2,
    });

    await runSourceIngestion({ connector: b2bConnector, database, storageRoot });
    firstEvent.listings = firstEvent.listings.filter(
      (listing) => listing["listingId"] !== "b2b-listing-stale",
    );
    await runSourceIngestion({ connector: b2bConnector, database, storageRoot });
    const afterOneMiss = await database.query.listings.findFirst({
      where: eq(listings.sourceListingId, "b2b-listing-stale"),
    });
    expect(afterOneMiss).toMatchObject({ availabilityStatus: "active", missedRuns: 1 });

    await runSourceIngestion({ connector: b2bConnector, database, storageRoot });
    const afterTwoMisses = await database.query.listings.findFirst({
      where: eq(listings.sourceListingId, "b2b-listing-stale"),
    });
    expect(afterTwoMisses).toMatchObject({ availabilityStatus: "inactive", missedRuns: 2 });
    expect(await database.select().from(listings)).toHaveLength(2);
  });

  it("retains malformed raw data and marks only that source failed", async () => {
    const ticketData = await loadFixture("ticket-data");
    const malformed = connector("tickpick", () => ({ events: [{ missing: "identity" }] }));
    const results = await runConnectorSet({
      connectors: [malformed, connector("ticket_data", () => ticketData)],
      database,
      storageRoot,
    });

    expect(results).toEqual([
      { source: "tickpick", status: "failed" },
      { source: "ticket_data", status: "succeeded" },
    ]);
    expect(await database.select().from(rawPayloads)).toHaveLength(2);
    const runs = await database
      .select({ errors: ingestionRuns.errors, source: ingestionRuns.source, status: ingestionRuns.status })
      .from(ingestionRuns)
      .orderBy(asc(ingestionRuns.source));
    expect(runs).toEqual([
      { errors: [], source: "ticket_data", status: "succeeded" },
      {
        errors: [{ code: "INVALID_SOURCE_PAYLOAD", message: "Source payload did not match its contract" }],
        source: "tickpick",
        status: "failed",
      },
    ]);
  });

  it("retries transient HTTP responses with bearer credentials and bounded backoff", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ events: [] }));
    const sleep = vi.fn(async () => undefined);

    const collected = await collectHttpJson({
      fetcher,
      maxRetries: 2,
      sleep,
      sourceUrl: "https://vendor.test/events",
      timeoutMs: 500,
      token: "vendor-secret",
    });

    expect(collected.payload).toEqual({ events: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "Bearer vendor-secret" });
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("does not retry permanent HTTP failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const sleep = vi.fn(async () => undefined);

    await expect(
      collectHttpJson({
        fetcher,
        maxRetries: 2,
        sleep,
        sourceUrl: "https://vendor.test/events",
        timeoutMs: 500,
        token: "invalid-secret",
      }),
    ).rejects.toThrow(/HTTP 401/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("honors a configured source delay before live collection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ events: [] }));
    const sleep = vi.fn(async () => undefined);

    await collectHttpJson({
      fetcher,
      maxRetries: 0,
      minimumDelayMs: 250,
      sleep,
      sourceUrl: "https://vendor.test/events",
      timeoutMs: 500,
    });

    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(250);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not age listings during a scoped manual refresh", async () => {
    const b2b = (await loadFixture("b2b")) as {
      events: Array<{ listings: Array<Record<string, unknown>> }>;
    };
    const b2bConnector = connector("b2b", () => b2b);
    await runSourceIngestion({ connector: b2bConnector, database, storageRoot });
    const event = b2b.events[0];
    if (!event) throw new Error("Fixture is missing its event");
    event.listings = [];

    await runSourceIngestion({
      connector: b2bConnector,
      database,
      scope: { artist: "The Midnight" },
      storageRoot,
    });

    const retained = await database.query.listings.findFirst({
      where: and(eq(listings.source, "b2b"), eq(listings.sourceListingId, "b2b-listing-1")),
    });
    expect(retained).toMatchObject({ availabilityStatus: "active", missedRuns: 0 });
  });

  it("queues a source event without a valid date without failing its source run", async () => {
    const payload = {
      events: [
        {
          artist_name: "Undated Artist",
          city: "Austin",
          id: "td-undated",
          observed_at: "2026-08-31T12:00:00Z",
          starts_at: null,
          timezone: "America/Chicago",
          url: "https://ticket-data.test/td-undated",
          venue_name: "Undated Venue",
        },
      ],
    };

    const result = await runSourceIngestion({
      connector: connector("ticket_data", () => payload),
      database,
      storageRoot,
    });

    expect(result.status).toBe("succeeded");
    expect(await database.select().from(reviewItems)).toHaveLength(1);
    expect(await database.select().from(events)).toHaveLength(0);
  });

  it("isolates an invalid normalized event and marks the run partial", async () => {
    const invalidNormalized: Connector = {
      collect: async () => ({ payload: { retained: true }, sourceUrl: "fixture://b2b-invalid" }),
      source: "b2b",
      translate: () => ({
        events: [
          {
            artistName: "Broken Listing Artist",
            city: "Austin",
            country: "US",
            eventName: null,
            history: [],
            listings: [
              {
                availabilityStatus: "active",
                currency: "TOOLONG",
                listingUrl: "https://b2b.test/listing",
                quantity: null,
                row: null,
                seatDetails: null,
                section: null,
                sourceListingId: "invalid-currency",
                totalPrice: null,
                unitPrice: "10.00",
              },
            ],
            market: null,
            observedAt: new Date("2026-08-31T12:00:00Z"),
            sourceEventId: "b2b-broken",
            sourceUrl: "https://b2b.test/event",
            startsAt: new Date("2026-10-01T01:00:00Z"),
            stateRegion: "TX",
            timezone: "America/Chicago",
            venueName: "Broken Venue",
          },
        ],
      }),
    };

    const result = await runSourceIngestion({
      connector: invalidNormalized,
      database,
      storageRoot,
    });
    expect(result.status).toBe("partial");
    const [run] = await database.select().from(ingestionRuns);
    expect(run?.errors).toEqual([
      { code: "SOURCE_EVENT_FAILED", message: "A source event could not be normalized or stored" },
    ]);
  });
});
