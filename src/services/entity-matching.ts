import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db/client";
import {
  artistAliases,
  artists,
  events,
  reviewItems,
  sourceEvents,
  venueAliases,
  venues,
} from "@/db/schema";

type Source = "ticket_data" | "tickpick" | "b2b";

export type SourceIdentity = Readonly<{
  artistName: string;
  city: string;
  country: string;
  eventName: string | null;
  rawPayloadId?: string | null;
  source: Source;
  sourceEventId: string;
  sourceUrl: string;
  startsAt: Date | null;
  stateRegion: string;
  timezone: string;
  venueName: string;
}>;

type MatchResult =
  | Readonly<{ eventId: string; status: "matched" }>
  | Readonly<{ reviewItemId: string; status: "review_required" }>;

export const normalizeEntityName = (value: string): string =>
  value
    .normalize("NFKD")
    .replaceAll(/\p{Mark}/gu, "")
    .replaceAll("&", " and ")
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replaceAll(/\s+/g, " ");

const localDate = (startsAt: Date, timezone: string): string => {
  if (Number.isNaN(startsAt.getTime())) throw new RangeError("Invalid event date");
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(startsAt);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const matched = parts.find((item) => item.type === type);
    /* v8 ignore next -- Intl guarantees requested date parts after a successful format */
    if (!matched) throw new RangeError("Event date part is missing");
    return matched.value;
  };
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return date;
};

export const buildCanonicalEventKey = (input: {
  readonly artistCanonicalName: string;
  readonly startsAt: Date;
  readonly timezone: string;
  readonly venueCanonicalName: string;
}): string =>
  [
    normalizeEntityName(input.artistCanonicalName),
    normalizeEntityName(input.venueCanonicalName),
    localDate(input.startsAt, input.timezone),
  ].join("|");

const tokenSimilarity = (left: string, right: string): number => {
  const leftTokens = new Set(normalizeEntityName(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeEntityName(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
};

const existingReview = async (
  database: Database,
  identity: SourceIdentity,
  kind: "invalid_date" | "ambiguous_event",
) =>
  database.query.reviewItems.findFirst({
    where: and(
      eq(reviewItems.source, identity.source),
      eq(reviewItems.sourceEventId, identity.sourceEventId),
      eq(reviewItems.kind, kind),
      eq(reviewItems.status, "open"),
    ),
  });

const queueReview = async (
  database: Database,
  identity: SourceIdentity,
  kind: "invalid_date" | "ambiguous_event",
  summary: string,
  details: Readonly<Record<string, unknown>>,
  candidateEventIds: ReadonlyArray<string> = [],
): Promise<MatchResult> => {
  const existing = await existingReview(database, identity, kind);
  if (existing) return { reviewItemId: existing.id, status: "review_required" };

  const [created] = await database
    .insert(reviewItems)
    .values({
      candidateEventIds,
      details,
      kind,
      rawPayloadId: identity.rawPayloadId ?? null,
      source: identity.source,
      sourceEventId: identity.sourceEventId,
      summary,
    })
    .returning({ id: reviewItems.id });
  /* v8 ignore next -- PostgreSQL RETURNING always yields the inserted review row */
  if (!created) throw new Error("Review item was not stored");
  return { reviewItemId: created.id, status: "review_required" };
};

const resolveArtist = async (database: Database, rawName: string) => {
  const canonicalName = normalizeEntityName(rawName);
  const direct = await database.query.artists.findFirst({
    where: eq(artists.canonicalName, canonicalName),
  });
  if (direct) return direct;

  const [aliased] = await database
    .select({ artist: artists })
    .from(artistAliases)
    .innerJoin(artists, eq(artistAliases.artistId, artists.id))
    .where(eq(artistAliases.alias, canonicalName))
    .limit(1);
  if (aliased) return aliased.artist;

  const [resolved] = await database
    .insert(artists)
    .values({ canonicalName, displayName: rawName.trim() })
    .onConflictDoUpdate({ target: artists.canonicalName, set: { canonicalName } })
    .returning();
  /* v8 ignore next -- upsert RETURNING always yields the resolved artist */
  if (!resolved) throw new Error("Artist could not be resolved");
  return resolved;
};

type VenueResolution =
  | Readonly<{ status: "resolved"; venue: typeof venues.$inferSelect }>
  | Readonly<{ candidates: ReadonlyArray<typeof venues.$inferSelect>; status: "ambiguous" }>;

const resolveVenue = async (database: Database, identity: SourceIdentity): Promise<VenueResolution> => {
  const canonicalName = normalizeEntityName(identity.venueName);
  const canonicalCity = normalizeEntityName(identity.city);
  const allVenues = await database.select().from(venues);
  const cityVenues = allVenues.filter(
    (venue) =>
      normalizeEntityName(venue.city) === canonicalCity && venue.country === identity.country,
  );
  const direct = cityVenues.find((venue) => venue.canonicalName === canonicalName);
  if (direct) return { status: "resolved", venue: direct };

  const [aliased] = await database
    .select({ venue: venues })
    .from(venueAliases)
    .innerJoin(venues, eq(venueAliases.venueId, venues.id))
    .where(and(eq(venueAliases.alias, canonicalName), eq(venueAliases.city, canonicalCity)))
    .limit(1);
  if (aliased) return { status: "resolved", venue: aliased.venue };

  const plausible = cityVenues.filter(
    (venue) => tokenSimilarity(canonicalName, venue.canonicalName) >= 0.8,
  );
  if (plausible.length > 1) return { candidates: plausible, status: "ambiguous" };
  const [single] = plausible;
  if (single) {
    await database
      .insert(venueAliases)
      .values({ alias: canonicalName, city: canonicalCity, venueId: single.id })
      .onConflictDoNothing();
    return { status: "resolved", venue: single };
  }

  const [created] = await database
    .insert(venues)
    .values({
      canonicalName,
      city: identity.city.trim(),
      country: identity.country,
      displayName: identity.venueName.trim(),
      stateRegion: identity.stateRegion,
      timezone: identity.timezone,
    })
    .returning();
  /* v8 ignore next -- PostgreSQL RETURNING always yields the inserted venue */
  if (!created) throw new Error("Venue could not be resolved");
  return { status: "resolved", venue: created };
};

export const matchSourceEvent = async (input: {
  readonly database: Database;
  readonly identity: SourceIdentity;
}): Promise<MatchResult> => {
  const { database, identity } = input;
  const existingSource = await database.query.sourceEvents.findFirst({
    where: and(
      eq(sourceEvents.source, identity.source),
      eq(sourceEvents.sourceEventId, identity.sourceEventId),
    ),
  });
  if (existingSource) return { eventId: existingSource.eventId, status: "matched" };

  if (!identity.startsAt) {
    return queueReview(database, identity, "invalid_date", "Source event has no valid date", {
      rawArtistName: identity.artistName,
      rawVenueName: identity.venueName,
    });
  }
  try {
    localDate(identity.startsAt, identity.timezone);
  } catch {
    return queueReview(database, identity, "invalid_date", "Source event date or timezone is invalid", {
      rawArtistName: identity.artistName,
      rawVenueName: identity.venueName,
      timezone: identity.timezone,
    });
  }

  const [artist, venueResolution] = await Promise.all([
    resolveArtist(database, identity.artistName),
    resolveVenue(database, identity),
  ]);
  if (venueResolution.status === "ambiguous") {
    const candidateVenueIds = venueResolution.candidates.map((venue) => venue.id);
    const candidateEvents = await database
      .select({ id: events.id, startsAt: events.startsAt, venueId: events.venueId })
      .from(events)
      .where(and(eq(events.artistId, artist.id), inArray(events.venueId, candidateVenueIds)));
    const targetDate = localDate(identity.startsAt, identity.timezone);
    return queueReview(
      database,
      identity,
      "ambiguous_event",
      "Multiple venues are plausible matches for this source event",
      {
        candidateVenueIds,
        rawArtistName: identity.artistName,
        rawVenueName: identity.venueName,
      },
      candidateEvents.reduce<Array<string>>((matches, event) => {
        if (localDate(event.startsAt, identity.timezone) === targetDate) matches.push(event.id);
        return matches;
      }, []),
    );
  }

  const canonicalEventKey = buildCanonicalEventKey({
    artistCanonicalName: artist.canonicalName,
    startsAt: identity.startsAt,
    timezone: venueResolution.venue.timezone,
    venueCanonicalName: venueResolution.venue.canonicalName,
  });
  const existingEvent = await database.query.events.findFirst({
    where: eq(events.canonicalEventKey, canonicalEventKey),
  });
  const event =
    existingEvent ??
    (
      await database
        .insert(events)
        .values({
          artistId: artist.id,
          canonicalEventKey,
          eventName: identity.eventName,
          startsAt: identity.startsAt,
          venueId: venueResolution.venue.id,
        })
        .returning()
    )[0];
  /* v8 ignore next -- insert RETURNING or the preceding lookup always resolves an event */
  if (!event) throw new Error("Event could not be resolved");

  await database.insert(sourceEvents).values({
    eventId: event.id,
    rawArtistName: identity.artistName,
    rawCity: identity.city,
    rawEventName: identity.eventName ?? "",
    rawPayloadId: identity.rawPayloadId ?? null,
    rawVenueName: identity.venueName,
    source: identity.source,
    sourceEventId: identity.sourceEventId,
    sourceUrl: identity.sourceUrl,
  });
  return { eventId: event.id, status: "matched" };
};
