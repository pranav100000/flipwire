import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseConfig } from "@/config";
import { createConfiguredConnector } from "@/connectors/configured";
import { getDatabase } from "@/db/client";
import {
  artists,
  events,
  ingestionJobs,
  ingestionRuns,
  listings,
  marketSnapshots,
  reviewItems,
  sourceConfigs,
  venues,
} from "@/db/schema";
import { runSourceIngestion } from "@/services/ingestion";
import {
  getArtistResearch,
  getEventResearch,
  getOperationsOverview,
  exportResearchDataset,
  listArtists,
} from "@/services/research";
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

describe("research read model", () => {
  let storageRoot = "";

  beforeEach(async () => {
    await resetTestDatabase(databaseUrl);
    storageRoot = await mkdtemp(path.join(tmpdir(), "flipwire-research-"));
    for (const source of ["ticket_data", "tickpick", "b2b"] as const) {
      await runSourceIngestion({
        connector: createConfiguredConnector({ config, fixtureMode: true, source }),
        database,
        storageRoot,
      });
    }
  });

  afterEach(async () => {
    await rm(storageRoot, { force: true, recursive: true });
  });

  it("searches artists and consolidates market context and active listing lows", async () => {
    const search = await listArtists({ database, page: 1, pageSize: 20, query: "mid" });
    expect(search).toMatchObject({ page: 1, pageSize: 20, totalItems: 1 });
    expect(search.items[0]).toMatchObject({ displayName: "The Midnight" });
    const artistId = search.items[0]?.id;
    if (!artistId) throw new Error("Expected seeded artist");

    const research = await getArtistResearch({ artistId, database, sort: "event_date" });

    expect(research?.artist.displayName).toBe("The Midnight");
    expect(research?.events).toHaveLength(1);
    expect(research?.events[0]).toMatchObject({
      b2b: { activeListingCount: 1, activeQuantity: 4, lowPrice: 109 },
      city: "Los Angeles",
      ticketData: { getInPrice: 88 },
      tickpick: { activeListingCount: 1, activeQuantity: 2, lowPrice: 120 },
      venueName: "The Greek Theatre",
    });
    expect(research?.events[0]?.sourceLinks.map((link) => link.source).sort()).toEqual([
      "b2b",
      "ticket_data",
      "tickpick",
    ]);
  });

  it("returns source-labelled event details, freshness, history, and raw references", async () => {
    const [artist] = await database.select().from(artists);
    if (!artist) throw new Error("Expected seeded artist");
    const research = await getArtistResearch({
      artistId: artist.id,
      database,
      sort: "event_date",
    });
    const eventId = research?.events[0]?.id;
    if (!eventId) throw new Error("Expected seeded event");

    const detail = await getEventResearch({ database, eventId });

    expect(detail?.marketSnapshots[0]).toMatchObject({ getInPrice: 88, source: "ticket_data" });
    expect(detail?.priceHistory[0]).toMatchObject({ metricName: "get_in", metricValue: 92 });
    expect(detail?.listings.map((listing) => [listing.source, listing.unitPrice])).toEqual([
      ["b2b", 109],
      ["tickpick", 120],
    ]);
    expect(detail?.sourceRecords).toHaveLength(3);
    expect(detail?.sourceRecords.every((record) => record.rawPayloadId !== null)).toBe(true);
    if (!detail) throw new Error("Expected event detail");
    const expectedFreshness = new Date(
      Math.max(
        ...detail.marketSnapshots.map((snapshot) => snapshot.observedAt.getTime()),
        ...detail.listings.map((listing) => listing.lastSeenAt.getTime()),
        ...detail.sourceRecords.map((record) => record.lastSeenAt.getTime()),
      ),
    );
    expect(detail.lastRefreshedAt).toEqual(expectedFreshness);
  });

  it("summarizes freshness, record counts, failures, reviews, and stale listings", async () => {
    const overview = await getOperationsOverview({ database });

    expect(overview.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventCount: 1, source: "ticket_data" }),
        expect.objectContaining({ activeListingCount: 1, source: "tickpick" }),
        expect.objectContaining({ activeListingCount: 1, source: "b2b" }),
      ]),
    );
    expect(overview.failedRuns).toEqual([]);
    expect(overview.openReviewCount).toBe(0);
    expect(overview.staleListingCount).toBe(0);
  });

  it("exports canonical and source-attributed research records without credentials", async () => {
    const exported = await exportResearchDataset({ database });

    expect(exported.artists).toHaveLength(1);
    expect(exported.events).toHaveLength(1);
    expect(exported.sourceEvents).toHaveLength(3);
    expect(exported.listings).toHaveLength(2);
    expect(JSON.stringify(exported)).not.toContain("local-test-password");
  });

  it("handles unknown records, empty artists, missing events, and every supported sort", async () => {
    expect(
      await getArtistResearch({
        artistId: "00000000-0000-4000-8000-000000000000",
        database,
        sort: "event_date",
      }),
    ).toBeNull();
    expect(
      await getEventResearch({
        database,
        eventId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBeNull();

    const [emptyArtist] = await database
      .insert(artists)
      .values({ canonicalName: "no dates", displayName: "No Dates" })
      .returning();
    const [artist] = await database
      .select()
      .from(artists)
      .where(eq(artists.canonicalName, "the midnight"));
    const [venue] = await database.select().from(venues);
    if (!emptyArtist || !artist || !venue) throw new Error("Expected seeded records");
    const unknownEvents = await database.insert(events).values([
      {
        artistId: artist.id,
        canonicalEventKey: "the midnight|the greek theatre|2026-10-03",
        eventName: null,
        startsAt: new Date("2026-10-04T03:00:00Z"),
        venueId: venue.id,
      },
      {
        artistId: artist.id,
        canonicalEventKey: "the midnight|the greek theatre|2026-10-04",
        eventName: "Second unknown event",
        startsAt: new Date("2026-10-05T03:00:00Z"),
        venueId: venue.id,
      },
    ]).returning();
    const firstUnknown = unknownEvents[0];
    if (!firstUnknown) throw new Error("Expected unknown event");
    await database.insert(marketSnapshots).values({
      eventId: firstUnknown.id,
      observedAt: new Date("2026-08-31T13:00:00Z"),
      source: "ticket_data",
    });
    await database.insert(listings).values([
      {
        availabilityStatus: "active",
        eventId: firstUnknown.id,
        listingUrl: "https://b2b.test/unknown-1",
        quantity: null,
        source: "b2b",
        sourceListingId: "unknown-1",
        totalPrice: null,
        unitPrice: "75.00",
      },
      {
        availabilityStatus: "active",
        eventId: firstUnknown.id,
        listingUrl: "https://b2b.test/unknown-2",
        quantity: null,
        source: "b2b",
        sourceListingId: "unknown-2",
        totalPrice: null,
        unitPrice: "80.00",
      },
    ]);

    await expect(
      getArtistResearch({ artistId: emptyArtist.id, database, sort: "event_date" }),
    ).resolves.toMatchObject({ events: [] });
    const emptyArtistEvents = await database.insert(events).values([
      {
        artistId: emptyArtist.id,
        canonicalEventKey: "no dates|the greek theatre|2026-11-01",
        startsAt: new Date("2026-11-02T03:00:00Z"),
        venueId: venue.id,
      },
      {
        artistId: emptyArtist.id,
        canonicalEventKey: "no dates|the greek theatre|2026-11-02",
        startsAt: new Date("2026-11-03T03:00:00Z"),
        venueId: venue.id,
      },
      {
        artistId: emptyArtist.id,
        canonicalEventKey: "no dates|the greek theatre|2026-11-03",
        startsAt: new Date("2026-11-04T03:00:00Z"),
        venueId: venue.id,
      },
    ]).returning();
    const pricedEmptyArtistEvent = emptyArtistEvents[1];
    if (!pricedEmptyArtistEvent) throw new Error("Expected sort fixture event");
    await database.insert(listings).values({
      availabilityStatus: "active",
      eventId: pricedEmptyArtistEvent.id,
      listingUrl: "https://b2b.test/sort-fixture",
      source: "b2b",
      sourceListingId: "sort-fixture",
      unitPrice: "50.00",
    });
    await expect(
      getArtistResearch({ artistId: emptyArtist.id, database, sort: "b2b" }),
    ).resolves.toMatchObject({ events: [{ b2b: { lowPrice: 50 } }, {}, {}] });
    await expect(
      getArtistResearch({ artistId: emptyArtist.id, database, sort: "refreshed" }),
    ).resolves.toMatchObject({ events: [{ lastRefreshedAt: expect.any(Date) }, {}, {}] });
    for (const sort of ["event_date", "ticket_data", "tickpick", "b2b", "refreshed"] as const) {
      const result = await getArtistResearch({ artistId: artist.id, database, sort });
      expect(result?.events).toHaveLength(3);
      expect(result?.events.some((event) => event.lastRefreshedAt === null)).toBe(true);
      expect(result?.events.some((event) => event.b2b.lowPrice === null)).toBe(true);
    }
    const detail = await getEventResearch({ database, eventId: firstUnknown.id });
    expect(detail?.marketSnapshots[0]?.getInPrice).toBeNull();
    expect(detail?.listings[0]?.totalPrice).toBeNull();
    expect(detail?.listings).toHaveLength(2);
    const allArtists = await listArtists({ database, page: 1, pageSize: 20, query: "" });
    expect(allArtists.totalItems).toBe(2);
  });

  it("includes configured source state and retained operational failures", async () => {
    const now = new Date("2026-08-31T18:00:00Z");
    await database.insert(sourceConfigs).values([
      { lastSuccessAt: now, source: "ticket_data" },
      { enabled: false, fixtureMode: false, source: "tickpick" },
    ]);
    await database.insert(ingestionRuns).values({
      completedAt: now,
      errors: [{ message: "Sanitized collection failure" }],
      source: "b2b",
      status: "failed",
    });
    await database.insert(reviewItems).values({
      kind: "invalid_date",
      source: "tickpick",
      sourceEventId: "tp-invalid",
      summary: "Missing event date",
    });
    await database.insert(ingestionJobs).values({ source: "ticket_data", status: "failed" });
    await database
      .update(ingestionRuns)
      .set({ status: "failed" })
      .where(eq(ingestionRuns.source, "b2b"));
    const [listing] = await database.select().from(listings);
    if (!listing) throw new Error("Expected seeded listing");
    await database
      .update(listings)
      .set({ availabilityStatus: "inactive" })
      .where(eq(listings.id, listing.id));

    const overview = await getOperationsOverview({ database });

    expect(overview.failedRuns).toHaveLength(2);
    expect(overview.reviewItems).toHaveLength(1);
    expect(overview.jobs).toHaveLength(1);
    expect(overview.staleListingCount).toBe(1);
    expect(overview.sources.find((source) => source.source === "ticket_data")?.lastSuccessfulAt).toEqual(now);
    expect(overview.sources.find((source) => source.source === "tickpick")).toMatchObject({
      enabled: false,
      fixtureMode: false,
    });
    expect(overview.sources.find((source) => source.source === "b2b")?.lastSuccessfulAt).toBeNull();
  });
});
