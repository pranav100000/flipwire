import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/db/client";
import {
  artistAliases,
  artists,
  events,
  reviewItems,
  sourceEvents,
  venueAliases,
  venues,
} from "@/db/schema";
import {
  buildCanonicalEventKey,
  matchSourceEvent,
  normalizeEntityName,
} from "@/services/entity-matching";
import { resetTestDatabase } from "@/testing/database";

const databaseUrl = "postgresql://flipwire:flipwire@127.0.0.1:55432/flipwire_test";
const database = getDatabase(databaseUrl);

const sourceIdentity = (
  overrides: Readonly<Partial<Parameters<typeof matchSourceEvent>[0]["identity"]>> = {},
) => ({
  artistName: "Beyoncé",
  city: "Los Angeles",
  country: "US",
  eventName: "Beyoncé Live",
  source: "ticket_data" as const,
  sourceEventId: "td-1",
  sourceUrl: "https://example.test/events/td-1",
  startsAt: new Date("2026-10-03T03:00:00.000Z"),
  stateRegion: "CA",
  timezone: "America/Los_Angeles",
  venueName: "The Greek Theatre",
  ...overrides,
});

describe("canonical event identity", () => {
  beforeEach(async () => {
    await resetTestDatabase(databaseUrl);
  });

  it("normalizes accents, punctuation, ampersands, casing, and whitespace", () => {
    expect(normalizeEntityName("  Beyoncé  & JAY-Z!!! ")).toBe("beyonce and jay z");
    expect(normalizeEntityName("Crypto.com   Arena")).toBe("crypto com arena");
  });

  it("derives event dates in the venue timezone rather than UTC", () => {
    expect(
      buildCanonicalEventKey({
        artistCanonicalName: "beyonce",
        startsAt: new Date("2026-10-03T03:00:00.000Z"),
        timezone: "America/Los_Angeles",
        venueCanonicalName: "the greek theatre",
      }),
    ).toBe("beyonce|the greek theatre|2026-10-02");
  });

  it("merges exact cross-source events while preserving both source identities", async () => {
    const first = await matchSourceEvent({ database, identity: sourceIdentity() });
    const second = await matchSourceEvent({
      database,
      identity: sourceIdentity({
        source: "tickpick",
        sourceEventId: "tp-9",
        sourceUrl: "https://example.test/events/tp-9",
      }),
    });

    expect(first.status).toBe("matched");
    if (first.status !== "matched") throw new Error("Expected an exact event match");
    expect(second).toEqual({ eventId: first.eventId, status: "matched" });
    expect(await database.select().from(events)).toHaveLength(1);
    const retainedSources = await database
      .select({ source: sourceEvents.source, sourceEventId: sourceEvents.sourceEventId })
      .from(sourceEvents)
      .orderBy(asc(sourceEvents.source));
    expect(retainedSources).toEqual([
      { source: "ticket_data", sourceEventId: "td-1" },
      { source: "tickpick", sourceEventId: "tp-9" },
    ]);
  });

  it("uses explicit artist and venue aliases without losing the raw names", async () => {
    const [artist] = await database
      .insert(artists)
      .values({ canonicalName: "the weeknd", displayName: "The Weeknd" })
      .returning();
    const [venue] = await database
      .insert(venues)
      .values({
        canonicalName: "crypto com arena",
        city: "Los Angeles",
        country: "US",
        displayName: "Crypto.com Arena",
        stateRegion: "CA",
        timezone: "America/Los_Angeles",
      })
      .returning();
    if (!artist || !venue) throw new Error("Fixture creation failed");
    await database.insert(artistAliases).values({ alias: "weeknd", artistId: artist.id });
    await database.insert(venueAliases).values({
      alias: "staples center",
      city: "los angeles",
      venueId: venue.id,
    });

    const result = await matchSourceEvent({
      database,
      identity: sourceIdentity({
        artistName: "Weeknd",
        sourceEventId: "b2b-44",
        source: "b2b",
        venueName: "Staples Center",
      }),
    });

    expect(result.status).toBe("matched");
    const retained = await database.query.sourceEvents.findFirst({
      where: eq(sourceEvents.sourceEventId, "b2b-44"),
    });
    expect(retained?.rawArtistName).toBe("Weeknd");
    expect(retained?.rawVenueName).toBe("Staples Center");
    expect(await database.select().from(artists)).toHaveLength(1);
    expect(await database.select().from(venues)).toHaveLength(1);
  });

  it("queues multiple plausible venue matches instead of creating or merging an event", async () => {
    const [artist] = await database
      .insert(artists)
      .values({ canonicalName: "beyonce", displayName: "Beyoncé" })
      .returning();
    if (!artist) throw new Error("Fixture creation failed");
    const candidateVenues = await database.insert(venues).values([
      {
        canonicalName: "crypto com arena",
        city: "Los Angeles",
        country: "US",
        displayName: "Crypto.com Arena",
        stateRegion: "CA",
        timezone: "America/Los_Angeles",
      },
      {
        canonicalName: "arena theatre",
        city: "Los Angeles",
        country: "US",
        displayName: "Arena Theatre",
        stateRegion: "CA",
        timezone: "America/Los_Angeles",
      },
    ]).returning();
    await database.insert(events).values(
      candidateVenues.map((venue, index) => ({
        artistId: artist.id,
        canonicalEventKey: `beyonce|${venue.canonicalName}|2026-10-02-${index}`,
        eventName: "Beyoncé Live",
        startsAt: new Date("2026-10-03T03:00:00.000Z"),
        venueId: venue.id,
      })),
    );
    const firstCandidateVenue = candidateVenues[0];
    if (!firstCandidateVenue) throw new Error("Expected a candidate venue");
    await database.insert(events).values({
      artistId: artist.id,
      canonicalEventKey: "beyonce|crypto com arena|2026-10-03-later",
      eventName: "Beyoncé Live Later",
      startsAt: new Date("2026-10-04T03:00:00.000Z"),
      venueId: firstCandidateVenue.id,
    });

    const result = await matchSourceEvent({
      database,
      identity: sourceIdentity({ sourceEventId: "td-ambiguous", venueName: "Arena" }),
    });

    expect(result.status).toBe("review_required");
    expect(await database.select().from(events)).toHaveLength(3);
    expect(await database.select().from(sourceEvents)).toHaveLength(0);
    const [review] = await database.select().from(reviewItems);
    expect(review).toMatchObject({
      kind: "ambiguous_event",
      source: "ticket_data",
      sourceEventId: "td-ambiguous",
      status: "open",
    });
    expect(review?.details).toMatchObject({ rawVenueName: "Arena" });
    expect(review?.candidateEventIds).toHaveLength(2);
  });

  it("queues missing or invalid dates and remains idempotent on review retries", async () => {
    const invalidIdentity = sourceIdentity({ sourceEventId: "td-invalid", startsAt: null });

    const first = await matchSourceEvent({ database, identity: invalidIdentity });
    const second = await matchSourceEvent({ database, identity: invalidIdentity });

    expect(first.status).toBe("review_required");
    expect(second).toEqual(first);
    const reviews = await database.select().from(reviewItems);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      kind: "invalid_date",
      sourceEventId: "td-invalid",
    });
  });

  it("returns an existing source identity without duplicating canonical records", async () => {
    const first = await matchSourceEvent({ database, identity: sourceIdentity() });
    const second = await matchSourceEvent({ database, identity: sourceIdentity() });

    expect(second).toEqual(first);
    expect(await database.select().from(sourceEvents)).toHaveLength(1);
  });

  it("queues invalid Date objects and invalid timezone identifiers", async () => {
    const invalidDate = await matchSourceEvent({
      database,
      identity: sourceIdentity({ sourceEventId: "td-nan", startsAt: new Date(Number.NaN) }),
    });
    const invalidTimezone = await matchSourceEvent({
      database,
      identity: sourceIdentity({ sourceEventId: "td-zone", timezone: "Not/A_Timezone" }),
    });

    expect(invalidDate.status).toBe("review_required");
    expect(invalidTimezone.status).toBe("review_required");
    expect(await database.select().from(reviewItems)).toHaveLength(2);
  });

  it("handles empty venue tokens and preserves a null source event name", async () => {
    await database.insert(venues).values({
      canonicalName: "known venue",
      city: "Los Angeles",
      country: "US",
      displayName: "Known Venue",
      stateRegion: "CA",
      timezone: "America/Los_Angeles",
    });
    const result = await matchSourceEvent({
      database,
      identity: sourceIdentity({ eventName: null, sourceEventId: "td-empty-venue", venueName: "!!!" }),
    });

    expect(result.status).toBe("matched");
    const record = await database.query.sourceEvents.findFirst({
      where: eq(sourceEvents.sourceEventId, "td-empty-venue"),
    });
    expect(record?.rawEventName).toBe("");
  });
});
