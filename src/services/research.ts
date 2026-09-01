import { and, asc, count, desc, eq, ilike, inArray } from "drizzle-orm";

import type { Source } from "@/connectors/contracts";
import type { Database } from "@/db/client";
import {
  artists,
  events,
  ingestionJobs,
  ingestionRuns,
  listings,
  marketSnapshots,
  priceHistory,
  rawPayloads,
  reviewItems,
  sourceConfigs,
  sourceEvents,
  venues,
} from "@/db/schema";

const sources = ["ticket_data", "tickpick", "b2b"] as const satisfies ReadonlyArray<Source>;

const asNumber = (value: string | null): number | null => (value === null ? null : Number(value));

const latestDate = (dates: ReadonlyArray<Date>): Date | null => {
  let latest: Date | null = null;
  for (const date of dates) {
    if (!latest || date > latest) latest = date;
  }
  return latest;
};

export const listArtists = async (input: {
  readonly database: Database;
  readonly page: number;
  readonly pageSize: number;
  readonly query: string;
}) => {
  const filter = input.query ? ilike(artists.displayName, `%${input.query}%`) : undefined;
  const [items, totals] = await Promise.all([
    input.database
      .select({ canonicalName: artists.canonicalName, displayName: artists.displayName, id: artists.id })
      .from(artists)
      .where(filter)
      .orderBy(asc(artists.displayName))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    input.database.select({ value: count() }).from(artists).where(filter),
  ]);
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    totalItems: Number(totals.reduce((total, row) => total + row.value, 0)),
  };
};

type EventSort = "b2b" | "event_date" | "refreshed" | "ticket_data" | "tickpick";

type ListingSummary = Readonly<{
  activeListingCount: number;
  activeQuantity: number | null;
  lowPrice: number | null;
}>;

const emptyListingSummary = (): ListingSummary => ({
  activeListingCount: 0,
  activeQuantity: null,
  lowPrice: null,
});

export const getArtistResearch = async (input: {
  readonly artistId: string;
  readonly database: Database;
  readonly sort: EventSort;
}) => {
  const artist = await input.database.query.artists.findFirst({
    columns: { canonicalName: true, displayName: true, id: true },
    where: eq(artists.id, input.artistId),
  });
  if (!artist) return null;

  const eventRows = await input.database
    .select({
      city: venues.city,
      country: venues.country,
      eventName: events.eventName,
      id: events.id,
      startsAt: events.startsAt,
      stateRegion: venues.stateRegion,
      timezone: venues.timezone,
      venueName: venues.displayName,
    })
    .from(events)
    .innerJoin(venues, eq(events.venueId, venues.id))
    .where(eq(events.artistId, input.artistId));
  const eventIds = eventRows.map((event) => event.id);
  if (eventIds.length === 0) return { artist, events: [] };

  const [snapshotRows, listingRows, sourceRows] = await Promise.all([
    input.database
      .select()
      .from(marketSnapshots)
      .where(inArray(marketSnapshots.eventId, eventIds))
      .orderBy(desc(marketSnapshots.observedAt)),
    input.database
      .select()
      .from(listings)
      .where(
        and(inArray(listings.eventId, eventIds), eq(listings.availabilityStatus, "active")),
      ),
    input.database.select().from(sourceEvents).where(inArray(sourceEvents.eventId, eventIds)),
  ]);

  const researchEvents = eventRows.map((event) => {
    const snapshots = snapshotRows.filter((snapshot) => snapshot.eventId === event.id);
    const ticketData = snapshots.find((snapshot) => snapshot.source === "ticket_data");
    const eventListings = listingRows.filter((listing) => listing.eventId === event.id);
    const listingSummary = (source: "b2b" | "tickpick"): ListingSummary => {
      const matching = eventListings.filter((listing) => listing.source === source);
      if (matching.length === 0) return emptyListingSummary();
      const quantities = matching
        .map((listing) => listing.quantity)
        .filter((quantity): quantity is number => quantity !== null);
      return {
        activeListingCount: matching.length,
        activeQuantity: quantities.length > 0 ? quantities.reduce((total, value) => total + value, 0) : null,
        lowPrice: Math.min(...matching.map((listing) => Number(listing.unitPrice))),
      };
    };
    const sourceRecords = sourceRows.filter((record) => record.eventId === event.id);
    return {
      ...event,
      b2b: listingSummary("b2b"),
      lastRefreshedAt: latestDate([
        ...snapshots.map((snapshot) => snapshot.observedAt),
        ...eventListings.map((listing) => listing.lastSeenAt),
        ...sourceRecords.map((record) => record.lastSeenAt),
      ]),
      sourceLinks: sourceRecords.map((record) => ({
        source: record.source,
        url: record.sourceUrl,
      })),
      ticketData: {
        getInPrice: ticketData ? asNumber(ticketData.getInPrice) : null,
        inventoryCount: ticketData?.inventoryCount ?? null,
        listingCount: ticketData?.listingCount ?? null,
      },
      tickpick: listingSummary("tickpick"),
    };
  });

  const numericSort = (getValue: (event: (typeof researchEvents)[number]) => number | null) =>
    (left: (typeof researchEvents)[number], right: (typeof researchEvents)[number]): number => {
      const leftValue = getValue(left);
      const rightValue = getValue(right);
      if (leftValue === null) return rightValue === null ? 0 : 1;
      if (rightValue === null) return -1;
      return leftValue - rightValue;
    };
  const comparators: Readonly<Record<EventSort, (left: (typeof researchEvents)[number], right: (typeof researchEvents)[number]) => number>> = {
    b2b: numericSort((event) => event.b2b.lowPrice),
    event_date: (left, right) => left.startsAt.getTime() - right.startsAt.getTime(),
    refreshed: (left, right) =>
      (right.lastRefreshedAt?.getTime() ?? 0) - (left.lastRefreshedAt?.getTime() ?? 0),
    ticket_data: numericSort((event) => event.ticketData.getInPrice),
    tickpick: numericSort((event) => event.tickpick.lowPrice),
  };
  researchEvents.sort(comparators[input.sort]);
  return { artist, events: researchEvents };
};

export const getEventResearch = async (input: {
  readonly database: Database;
  readonly eventId: string;
}) => {
  const [event] = await input.database
    .select({
      artistId: artists.id,
      artistName: artists.displayName,
      city: venues.city,
      country: venues.country,
      eventName: events.eventName,
      id: events.id,
      startsAt: events.startsAt,
      stateRegion: venues.stateRegion,
      timezone: venues.timezone,
      venueName: venues.displayName,
    })
    .from(events)
    .innerJoin(artists, eq(events.artistId, artists.id))
    .innerJoin(venues, eq(events.venueId, venues.id))
    .where(eq(events.id, input.eventId))
    .limit(1);
  if (!event) return null;

  const [snapshots, history, listingRows, records] = await Promise.all([
    input.database
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.eventId, input.eventId))
      .orderBy(desc(marketSnapshots.observedAt)),
    input.database
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.eventId, input.eventId))
      .orderBy(desc(priceHistory.observedAt)),
    input.database
      .select()
      .from(listings)
      .where(eq(listings.eventId, input.eventId))
      .orderBy(asc(listings.source), asc(listings.unitPrice)),
    input.database
      .select()
      .from(sourceEvents)
      .where(eq(sourceEvents.eventId, input.eventId))
      .orderBy(asc(sourceEvents.source)),
  ]);
  return {
    event,
    lastRefreshedAt: latestDate([
      ...snapshots.map((snapshot) => snapshot.observedAt),
      ...listingRows.map((listing) => listing.lastSeenAt),
      ...records.map((record) => record.lastSeenAt),
    ]),
    listings: listingRows
      .toSorted(
        (left, right) =>
          left.source.localeCompare(right.source) || Number(left.unitPrice) - Number(right.unitPrice),
      )
      .map((listing) => ({
        ...listing,
        totalPrice: asNumber(listing.totalPrice),
        unitPrice: Number(listing.unitPrice),
      })),
    marketSnapshots: snapshots.map((snapshot) => ({
      ...snapshot,
      forecastValue: asNumber(snapshot.forecastValue),
      getInPrice: asNumber(snapshot.getInPrice),
      highPrice: asNumber(snapshot.highPrice),
      lowPrice: asNumber(snapshot.lowPrice),
      medianPrice: asNumber(snapshot.medianPrice),
    })),
    priceHistory: history.map((point) => ({ ...point, metricValue: Number(point.metricValue) })),
    sourceRecords: records,
  };
};

export const getOperationsOverview = async (input: { readonly database: Database }) => {
  const [configs, runs, sourceRecords, listingRows, eventRows, openReviews, jobs] = await Promise.all([
    input.database.select().from(sourceConfigs).orderBy(asc(sourceConfigs.source)),
    input.database.select().from(ingestionRuns).orderBy(desc(ingestionRuns.startedAt)).limit(100),
    input.database.select().from(sourceEvents),
    input.database.select().from(listings),
    input.database.select({ artistId: events.artistId, id: events.id }).from(events),
    input.database
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.status, "open"))
      .orderBy(desc(reviewItems.createdAt)),
    input.database.select().from(ingestionJobs).orderBy(desc(ingestionJobs.createdAt)).limit(20),
  ]);
  const artistByEvent = new Map(eventRows.map((event) => [event.id, event.artistId]));
  return {
    failedRuns: runs.filter((run) => run.status === "failed").slice(0, 20),
    jobs,
    openReviewCount: openReviews.length,
    reviewItems: openReviews,
    sources: sources.map((source) => {
      const records = sourceRecords.filter((record) => record.source === source);
      const sourceListings = listingRows.filter((listing) => listing.source === source);
      const sourceRuns = runs.filter((run) => run.source === source);
      const config = configs.find((candidate) => candidate.source === source);
      return {
        activeListingCount: sourceListings.filter((listing) => listing.availabilityStatus === "active").length,
        artistCount: new Set(records.map((record) => artistByEvent.get(record.eventId))).size,
        cadenceMinutes: config?.cadenceMinutes ?? 120,
        enabled: config?.enabled ?? true,
        eventCount: new Set(records.map((record) => record.eventId)).size,
        fixtureMode: config?.fixtureMode ?? true,
        lastSuccessfulAt:
          config?.lastSuccessAt ??
          sourceRuns.find((run) => run.status === "succeeded")?.completedAt ??
          null,
        source,
      };
    }),
    staleListingCount: listingRows.filter((listing) => listing.availabilityStatus === "inactive").length,
  };
};

export const exportResearchDataset = async (input: { readonly database: Database }) => {
  const [artistRows, venueRows, eventRows, sourceRows, snapshots, listingRows, history, rawRows] =
    await Promise.all([
      input.database.select().from(artists).orderBy(asc(artists.displayName)),
      input.database.select().from(venues).orderBy(asc(venues.displayName)),
      input.database.select().from(events).orderBy(asc(events.startsAt)),
      input.database.select().from(sourceEvents).orderBy(asc(sourceEvents.source)),
      input.database.select().from(marketSnapshots).orderBy(desc(marketSnapshots.observedAt)),
      input.database.select().from(listings).orderBy(asc(listings.source), asc(listings.unitPrice)),
      input.database.select().from(priceHistory).orderBy(desc(priceHistory.observedAt)),
      input.database.select().from(rawPayloads).orderBy(desc(rawPayloads.collectedAt)),
    ]);
  return {
    artists: artistRows,
    events: eventRows,
    exportedAt: new Date(),
    listings: listingRows,
    marketSnapshots: snapshots,
    priceHistory: history,
    rawPayloads: rawRows,
    sourceEvents: sourceRows,
    venues: venueRows,
  };
};
