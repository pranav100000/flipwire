import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const sourceEnum = pgEnum("source", ["ticket_data", "tickpick", "b2b"]);
export const availabilityStatusEnum = pgEnum("availability_status", [
  "active",
  "inactive",
  "unknown",
]);
export const ingestionRunStatusEnum = pgEnum("ingestion_run_status", [
  "running",
  "succeeded",
  "partial",
  "failed",
]);
export const payloadTypeEnum = pgEnum("payload_type", [
  "api_response",
  "html",
  "json",
  "screenshot",
  "export",
]);
export const reviewKindEnum = pgEnum("review_kind", [
  "unmatched_event",
  "ambiguous_event",
  "artist_alias",
  "venue_alias",
  "invalid_date",
  "listing_without_event",
]);
export const reviewStatusEnum = pgEnum("review_status", ["open", "resolved", "dismissed"]);
export const ingestionJobStatusEnum = pgEnum("ingestion_job_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

const timestamps = {
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const artists = pgTable("artists", {
  id: uuid("id").defaultRandom().primaryKey(),
  canonicalName: text("canonical_name").notNull().unique(),
  displayName: text("display_name").notNull(),
  ...timestamps,
});

export const artistAliases = pgTable("artist_aliases", {
  id: uuid("id").defaultRandom().primaryKey(),
  artistId: uuid("artist_id")
    .notNull()
    .references(() => artists.id, { onDelete: "cascade" }),
  alias: text("alias").notNull().unique(),
  source: sourceEnum("source"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

export const venues = pgTable(
  "venues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    displayName: text("display_name").notNull(),
    city: text("city").notNull(),
    stateRegion: text("state_region").default("").notNull(),
    country: varchar("country", { length: 2 }).default("US").notNull(),
    timezone: text("timezone").notNull(),
    capacity: integer("capacity"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("venues_canonical_location_unique").on(
      table.canonicalName,
      table.city,
      table.stateRegion,
      table.country,
    ),
  ],
);

export const venueAliases = pgTable(
  "venue_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    city: text("city").notNull(),
    source: sourceEnum("source"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("venue_aliases_alias_city_unique").on(table.alias, table.city)],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "restrict" }),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),
    eventName: text("event_name"),
    startsAt: timestamp("starts_at", { mode: "date", withTimezone: true }).notNull(),
    sourceEventKey: text("source_event_key"),
    canonicalEventKey: text("canonical_event_key").notNull().unique(),
    ...timestamps,
  },
  (table) => [index("events_artist_starts_at_index").on(table.artistId, table.startsAt)],
);

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: sourceEnum("source").notNull(),
    status: ingestionRunStatusEnum("status").default("running").notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    recordsFound: integer("records_found").default(0).notNull(),
    recordsCreated: integer("records_created").default(0).notNull(),
    recordsUpdated: integer("records_updated").default(0).notNull(),
    errors: jsonb("errors").$type<ReadonlyArray<Readonly<Record<string, unknown>>>>().default([]).notNull(),
    scope: jsonb("scope").$type<Readonly<Record<string, unknown>>>().default({}).notNull(),
  },
  (table) => [index("ingestion_runs_source_status_index").on(table.source, table.status)],
);

export const rawPayloads = pgTable(
  "raw_payloads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: sourceEnum("source").notNull(),
    sourceUrl: text("source_url"),
    payloadType: payloadTypeEnum("payload_type").notNull(),
    storagePath: text("storage_path").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    collectedAt: timestamp("collected_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: "restrict" }),
  },
  (table) => [index("raw_payloads_source_hash_index").on(table.source, table.contentHash)],
);

export const sourceEvents = pgTable(
  "source_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: sourceEnum("source").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    rawPayloadId: uuid("raw_payload_id").references(() => rawPayloads.id, { onDelete: "set null" }),
    rawArtistName: text("raw_artist_name").default("").notNull(),
    rawEventName: text("raw_event_name").default("").notNull(),
    rawVenueName: text("raw_venue_name").default("").notNull(),
    rawCity: text("raw_city").default("").notNull(),
    firstSeenAt: timestamp("first_seen_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("source_events_source_id_unique").on(table.source, table.sourceEventId)],
);

export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    source: sourceEnum("source").notNull(),
    getInPrice: numeric("get_in_price", { precision: 12, scale: 2 }),
    medianPrice: numeric("median_price", { precision: 12, scale: 2 }),
    lowPrice: numeric("low_price", { precision: 12, scale: 2 }),
    highPrice: numeric("high_price", { precision: 12, scale: 2 }),
    listingCount: integer("listing_count"),
    inventoryCount: integer("inventory_count"),
    forecastValue: numeric("forecast_value", { precision: 12, scale: 2 }),
    forecastText: text("forecast_text"),
    observedAt: timestamp("observed_at", { mode: "date", withTimezone: true }).notNull(),
    rawPayloadId: uuid("raw_payload_id").references(() => rawPayloads.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("market_snapshots_observation_unique").on(
      table.eventId,
      table.source,
      table.observedAt,
    ),
  ],
);

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: sourceEnum("source").notNull(),
    sourceListingId: text("source_listing_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    listingUrl: text("listing_url").notNull(),
    section: text("section"),
    row: text("row"),
    seatDetails: text("seat_details"),
    quantity: integer("quantity"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }),
    currency: varchar("currency", { length: 3 }).default("USD").notNull(),
    availabilityStatus: availabilityStatusEnum("availability_status").default("unknown").notNull(),
    firstSeenAt: timestamp("first_seen_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    missedRuns: integer("missed_runs").default(0).notNull(),
    rawPayloadId: uuid("raw_payload_id").references(() => rawPayloads.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("listings_source_id_unique").on(table.source, table.sourceListingId),
    index("listings_event_source_status_price_index").on(
      table.eventId,
      table.source,
      table.availabilityStatus,
      table.unitPrice,
    ),
  ],
);

export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    source: sourceEnum("source").notNull(),
    metricName: text("metric_name").notNull(),
    metricValue: numeric("metric_value", { precision: 12, scale: 2 }).notNull(),
    observedAt: timestamp("observed_at", { mode: "date", withTimezone: true }).notNull(),
    rawPayloadId: uuid("raw_payload_id").references(() => rawPayloads.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("price_history_point_unique").on(
      table.eventId,
      table.source,
      table.metricName,
      table.observedAt,
    ),
  ],
);

export const reviewItems = pgTable(
  "review_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: reviewKindEnum("kind").notNull(),
    status: reviewStatusEnum("status").default("open").notNull(),
    source: sourceEnum("source").notNull(),
    sourceEventId: text("source_event_id").default("").notNull(),
    summary: text("summary").notNull(),
    details: jsonb("details").$type<Readonly<Record<string, unknown>>>().default({}).notNull(),
    candidateEventIds: jsonb("candidate_event_ids").$type<ReadonlyArray<string>>().default([]).notNull(),
    rawPayloadId: uuid("raw_payload_id").references(() => rawPayloads.id, { onDelete: "set null" }),
    resolvedEventId: uuid("resolved_event_id").references(() => events.id, { onDelete: "set null" }),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { mode: "date", withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("review_items_status_kind_source_index").on(table.status, table.kind, table.source),
    uniqueIndex("review_items_open_identity_unique").on(
      table.source,
      table.sourceEventId,
      table.kind,
      table.status,
    ),
  ],
);

export const sourceConfigs = pgTable("source_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: sourceEnum("source").notNull().unique(),
  enabled: boolean("enabled").default(true).notNull(),
  fixtureMode: boolean("fixture_mode").default(true).notNull(),
  cadenceMinutes: integer("cadence_minutes").default(120).notNull(),
  timeoutSeconds: integer("timeout_seconds").default(30).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),
  backoffSeconds: integer("backoff_seconds").default(2).notNull(),
  rateLimitSeconds: numeric("rate_limit_seconds", { precision: 7, scale: 3 }).default("0").notNull(),
  staleAfterMissedRuns: integer("stale_after_missed_runs").default(3).notNull(),
  nextRunAt: timestamp("next_run_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  lastSuccessAt: timestamp("last_success_at", { mode: "date", withTimezone: true }),
  ...timestamps,
});

export const ingestionJobs = pgTable(
  "ingestion_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: sourceEnum("source").notNull(),
    status: ingestionJobStatusEnum("status").default("pending").notNull(),
    scope: jsonb("scope").$type<Readonly<Record<string, unknown>>>().default({}).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).unique(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    lastError: text("last_error").default("").notNull(),
    ingestionRunId: uuid("ingestion_run_id").unique().references(() => ingestionRuns.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    index("ingestion_jobs_status_available_index").on(table.status, table.availableAt),
    uniqueIndex("ingestion_jobs_active_source_unique")
      .on(table.source)
      .where(sql`${table.status} in ('pending', 'running')`),
  ],
);

export const artistsRelations = relations(artists, ({ many }) => ({
  aliases: many(artistAliases),
  events: many(events),
}));
export const venuesRelations = relations(venues, ({ many }) => ({
  aliases: many(venueAliases),
  events: many(events),
}));
export const eventsRelations = relations(events, ({ many, one }) => ({
  artist: one(artists, { fields: [events.artistId], references: [artists.id] }),
  listings: many(listings),
  marketSnapshots: many(marketSnapshots),
  priceHistory: many(priceHistory),
  sourceEvents: many(sourceEvents),
  venue: one(venues, { fields: [events.venueId], references: [venues.id] }),
}));
export const sourceEventsRelations = relations(sourceEvents, ({ one }) => ({
  event: one(events, { fields: [sourceEvents.eventId], references: [events.id] }),
  rawPayload: one(rawPayloads, {
    fields: [sourceEvents.rawPayloadId],
    references: [rawPayloads.id],
  }),
}));
export const listingsRelations = relations(listings, ({ one }) => ({
  event: one(events, { fields: [listings.eventId], references: [events.id] }),
}));
export const marketSnapshotsRelations = relations(marketSnapshots, ({ one }) => ({
  event: one(events, { fields: [marketSnapshots.eventId], references: [events.id] }),
}));
export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  event: one(events, { fields: [priceHistory.eventId], references: [events.id] }),
}));
export const ingestionRunsRelations = relations(ingestionRuns, ({ many, one }) => ({
  job: one(ingestionJobs),
  rawPayloads: many(rawPayloads),
}));
export const rawPayloadsRelations = relations(rawPayloads, ({ one }) => ({
  run: one(ingestionRuns, { fields: [rawPayloads.runId], references: [ingestionRuns.id] }),
}));
export const ingestionJobsRelations = relations(ingestionJobs, ({ one }) => ({
  ingestionRun: one(ingestionRuns, {
    fields: [ingestionJobs.ingestionRunId],
    references: [ingestionRuns.id],
  }),
}));

export const schemaVersion = sql`1`;
