import { and, eq } from "drizzle-orm";

import type { Connector, IngestionScope, NormalizedEvent, Source } from "@/connectors/contracts";
import type { Database } from "@/db/client";
import {
  ingestionRuns,
  listings,
  marketSnapshots,
  priceHistory,
  sourceConfigs,
} from "@/db/schema";
import { matchSourceEvent } from "@/services/entity-matching";
import { retainRawJson } from "@/services/raw-payloads";

type RunResult = Readonly<{
  runId: string;
  source: Source;
  status: "succeeded" | "partial" | "failed";
}>;

const sourcePayloadError = {
  code: "INVALID_SOURCE_PAYLOAD",
  message: "Source payload did not match its contract",
} as const;

const sourceEventError = {
  code: "SOURCE_EVENT_FAILED",
  message: "A source event could not be normalized or stored",
} as const;

const storeEventData = async (input: {
  readonly database: Database;
  readonly event: NormalizedEvent;
  readonly rawPayloadId: string;
  readonly seenListingIds: Set<string>;
  readonly source: Source;
}): Promise<Readonly<{ created: number; updated: number }>> => {
  const matched = await matchSourceEvent({
    database: input.database,
    identity: {
      artistName: input.event.artistName,
      city: input.event.city,
      country: input.event.country,
      eventName: input.event.eventName,
      rawPayloadId: input.rawPayloadId,
      source: input.source,
      sourceEventId: input.event.sourceEventId,
      sourceUrl: input.event.sourceUrl,
      startsAt: input.event.startsAt,
      stateRegion: input.event.stateRegion,
      timezone: input.event.timezone,
      venueName: input.event.venueName,
    },
  });
  if (matched.status === "review_required") return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  if (input.event.market) {
    const values = {
      eventId: matched.eventId,
      forecastText: input.event.market.forecastText,
      forecastValue: input.event.market.forecastValue,
      getInPrice: input.event.market.getInPrice,
      highPrice: input.event.market.highPrice,
      inventoryCount: input.event.market.inventoryCount,
      listingCount: input.event.market.listingCount,
      lowPrice: input.event.market.lowPrice,
      medianPrice: input.event.market.medianPrice,
      observedAt: input.event.observedAt,
      rawPayloadId: input.rawPayloadId,
      source: input.source,
    } as const;
    const existing = await input.database.query.marketSnapshots.findFirst({
      where: and(
        eq(marketSnapshots.eventId, matched.eventId),
        eq(marketSnapshots.source, input.source),
        eq(marketSnapshots.observedAt, input.event.observedAt),
      ),
    });
    await input.database
      .insert(marketSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [marketSnapshots.eventId, marketSnapshots.source, marketSnapshots.observedAt],
        set: values,
      });
    if (existing) updated += 1;
    else created += 1;
  }

  for (const point of input.event.history) {
    const values = {
      eventId: matched.eventId,
      metricName: point.metricName,
      metricValue: point.metricValue,
      observedAt: point.observedAt,
      rawPayloadId: input.rawPayloadId,
      source: input.source,
    } as const;
    const existing = await input.database.query.priceHistory.findFirst({
      where: and(
        eq(priceHistory.eventId, matched.eventId),
        eq(priceHistory.source, input.source),
        eq(priceHistory.metricName, point.metricName),
        eq(priceHistory.observedAt, point.observedAt),
      ),
    });
    await input.database
      .insert(priceHistory)
      .values(values)
      .onConflictDoUpdate({
        target: [priceHistory.eventId, priceHistory.source, priceHistory.metricName, priceHistory.observedAt],
        set: values,
      });
    if (existing) updated += 1;
    else created += 1;
  }

  for (const listing of input.event.listings) {
    input.seenListingIds.add(listing.sourceListingId);
    const existing = await input.database.query.listings.findFirst({
      where: and(
        eq(listings.source, input.source),
        eq(listings.sourceListingId, listing.sourceListingId),
      ),
    });
    const values = {
      availabilityStatus: listing.availabilityStatus,
      currency: listing.currency,
      eventId: matched.eventId,
      lastSeenAt: input.event.observedAt,
      listingUrl: listing.listingUrl,
      missedRuns: 0,
      quantity: listing.quantity,
      rawPayloadId: input.rawPayloadId,
      row: listing.row,
      seatDetails: listing.seatDetails,
      section: listing.section,
      source: input.source,
      sourceListingId: listing.sourceListingId,
      totalPrice: listing.totalPrice,
      unitPrice: listing.unitPrice,
    } as const;
    await input.database
      .insert(listings)
      .values(values)
      .onConflictDoUpdate({
        target: [listings.source, listings.sourceListingId],
        set: values,
      });
    if (existing) updated += 1;
    else created += 1;
  }
  return { created, updated };
};

const ageMissingListings = async (
  database: Database,
  source: Source,
  seenListingIds: ReadonlySet<string>,
): Promise<number> => {
  const config = await database.query.sourceConfigs.findFirst({
    where: eq(sourceConfigs.source, source),
  });
  const threshold = config?.staleAfterMissedRuns ?? 3;
  const sourceListings = await database.query.listings.findMany({
    where: eq(listings.source, source),
  });
  let updated = 0;
  for (const listing of sourceListings) {
    if (seenListingIds.has(listing.sourceListingId)) continue;
    const missedRuns = listing.missedRuns + 1;
    await database
      .update(listings)
      .set({
        availabilityStatus: missedRuns >= threshold ? "inactive" : listing.availabilityStatus,
        missedRuns,
      })
      .where(eq(listings.id, listing.id));
    updated += 1;
  }
  return updated;
};

export const runSourceIngestion = async (input: {
  readonly connector: Connector;
  readonly database: Database;
  readonly scope?: IngestionScope;
  readonly storageRoot: string;
}): Promise<RunResult> => {
  const [run] = await input.database
    .insert(ingestionRuns)
    .values({ source: input.connector.source, status: "running", scope: input.scope ?? {} })
    .returning({ id: ingestionRuns.id });
  /* v8 ignore next -- PostgreSQL RETURNING always yields the inserted run */
  if (!run) throw new Error("Ingestion run was not created");

  let rawPayloadId: string;
  let translated: ReturnType<Connector["translate"]>;
  try {
    const collected = await input.connector.collect(input.scope);
    const raw = await retainRawJson({
      database: input.database,
      payload: collected.payload,
      runId: run.id,
      source: input.connector.source,
      sourceUrl: collected.sourceUrl,
      storageRoot: input.storageRoot,
    });
    rawPayloadId = raw.id;
    translated = input.connector.translate(collected.payload);
  } catch {
    await input.database
      .update(ingestionRuns)
      .set({ completedAt: new Date(), errors: [sourcePayloadError], status: "failed" })
      .where(eq(ingestionRuns.id, run.id));
    return { runId: run.id, source: input.connector.source, status: "failed" };
  }

  let created = 0;
  let updated = 0;
  const errors: Array<typeof sourceEventError> = [];
  const seenListingIds = new Set<string>();
  for (const event of translated.events) {
    try {
      const counts = await storeEventData({
        database: input.database,
        event,
        rawPayloadId,
        seenListingIds,
        source: input.connector.source,
      });
      created += counts.created;
      updated += counts.updated;
    } catch {
      errors.push(sourceEventError);
    }
  }
  if (!input.scope) {
    updated += await ageMissingListings(input.database, input.connector.source, seenListingIds);
  }
  const status = errors.length > 0 ? "partial" : "succeeded";
  await input.database
    .update(ingestionRuns)
    .set({
      completedAt: new Date(),
      errors,
      recordsCreated: created,
      recordsFound:
        translated.events.length +
        translated.events.reduce(
          (total, event) => total + event.listings.length + event.history.length,
          0,
        ),
      recordsUpdated: updated,
      status,
    })
    .where(eq(ingestionRuns.id, run.id));
  return { runId: run.id, source: input.connector.source, status };
};

export const runConnectorSet = async (input: {
  readonly connectors: ReadonlyArray<Connector>;
  readonly database: Database;
  readonly storageRoot: string;
}): Promise<ReadonlyArray<Readonly<{ source: Source; status: RunResult["status"] }>>> => {
  const results = [];
  for (const connector of input.connectors) {
    const result = await runSourceIngestion({
      connector,
      database: input.database,
      storageRoot: input.storageRoot,
    });
    results.push({ source: result.source, status: result.status });
  }
  return results;
};
