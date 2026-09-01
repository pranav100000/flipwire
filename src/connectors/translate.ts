import { z } from "zod";

import type {
  NormalizedEvent,
  NormalizedHistoryPoint,
  NormalizedListing,
  NormalizedMarket,
  Source,
  TranslationResult,
} from "@/connectors/contracts";

const dateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const nullableMoney = (value: number | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toFixed(2);

const ticketDataSchema = z.object({
  events: z.array(
    z.object({
      artist_name: z.string().min(1),
      city: z.string().min(1),
      country: z.string().length(2).default("US"),
      event_name: z.string().nullable().optional(),
      historical_prices: z
        .array(
          z.object({ metric: z.string().min(1), observed_at: dateTime, value: z.number().nonnegative() }),
        )
        .default([]),
      id: z.string().min(1),
      market: z
        .object({
          forecast_text: z.string().nullable().optional(),
          forecast_value: z.number().nullable().optional(),
          get_in_price: z.number().nullable().optional(),
          high_price: z.number().nullable().optional(),
          inventory_count: z.number().int().nonnegative().nullable().optional(),
          listing_count: z.number().int().nonnegative().nullable().optional(),
          low_price: z.number().nullable().optional(),
          median_price: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
      observed_at: dateTime,
      starts_at: dateTime.nullable().optional(),
      state_region: z.string().default(""),
      timezone: z.string().min(1),
      url: z.url(),
      venue_name: z.string().min(1),
    }),
  ),
});

const tickpickSchema = z.object({
  events: z.array(
    z.object({
      artist: z.string().min(1),
      city: z.string().min(1),
      country: z.string().length(2).default("US"),
      event: z.string().nullable().optional(),
      event_id: z.string().min(1),
      event_url: z.url(),
      listings: z.array(
        z.object({
          currency: z.string().length(3).default("USD"),
          id: z.string().min(1),
          quantity: z.number().int().positive().nullable().optional(),
          row: z.string().nullable().optional(),
          seat_details: z.string().nullable().optional(),
          section: z.string().nullable().optional(),
          status: z.enum(["active", "inactive", "unknown"]).default("unknown"),
          total_price: z.number().nonnegative().nullable().optional(),
          unit_price: z.number().nonnegative(),
          url: z.url(),
        }),
      ),
      observed_at: dateTime,
      starts_at: dateTime.nullable().optional(),
      state: z.string().default(""),
      timezone: z.string().min(1),
      venue: z.string().min(1),
    }),
  ),
});

const b2bSchema = z.object({
  events: z.array(
    z.object({
      artistName: z.string().min(1),
      city: z.string().min(1),
      country: z.string().length(2).default("US"),
      eventId: z.string().min(1),
      eventName: z.string().nullable().optional(),
      eventUrl: z.url(),
      listings: z.array(
        z.object({
          availability: z.enum(["active", "inactive", "unknown"]).default("unknown"),
          currency: z.string().length(3).default("USD"),
          listingId: z.string().min(1),
          listingUrl: z.url(),
          quantity: z.number().int().positive().nullable().optional(),
          row: z.string().nullable().optional(),
          seatDetails: z.string().nullable().optional(),
          section: z.string().nullable().optional(),
          totalPrice: z.number().nonnegative().nullable().optional(),
          unitPrice: z.number().nonnegative(),
        }),
      ),
      observedAt: dateTime,
      startsAt: dateTime.nullable().optional(),
      stateRegion: z.string().default(""),
      timezone: z.string().min(1),
      venueName: z.string().min(1),
    }),
  ),
});

const market = (
  value: z.infer<typeof ticketDataSchema>["events"][number]["market"],
): NormalizedMarket | null =>
  value
    ? {
        forecastText: value.forecast_text ?? null,
        forecastValue: nullableMoney(value.forecast_value),
        getInPrice: nullableMoney(value.get_in_price),
        highPrice: nullableMoney(value.high_price),
        inventoryCount: value.inventory_count ?? null,
        listingCount: value.listing_count ?? null,
        lowPrice: nullableMoney(value.low_price),
        medianPrice: nullableMoney(value.median_price),
      }
    : null;

const translateTicketData = (payload: unknown): TranslationResult => {
  const parsed = ticketDataSchema.parse(payload);
  return {
    events: parsed.events.map(
      (event): NormalizedEvent => ({
        artistName: event.artist_name,
        city: event.city,
        country: event.country,
        eventName: event.event_name ?? null,
        history: event.historical_prices.map(
          (point): NormalizedHistoryPoint => ({
            metricName: point.metric,
            metricValue: point.value.toFixed(2),
            observedAt: point.observed_at,
          }),
        ),
        listings: [],
        market: market(event.market),
        observedAt: event.observed_at,
        sourceEventId: event.id,
        sourceUrl: event.url,
        startsAt: event.starts_at ?? null,
        stateRegion: event.state_region,
        timezone: event.timezone,
        venueName: event.venue_name,
      }),
    ),
  };
};

const translateTickpick = (payload: unknown): TranslationResult => {
  const parsed = tickpickSchema.parse(payload);
  return {
    events: parsed.events.map(
      (event): NormalizedEvent => ({
        artistName: event.artist,
        city: event.city,
        country: event.country,
        eventName: event.event ?? null,
        history: [],
        listings: event.listings.map(
          (listing): NormalizedListing => ({
            availabilityStatus: listing.status,
            currency: listing.currency,
            listingUrl: listing.url,
            quantity: listing.quantity ?? null,
            row: listing.row ?? null,
            seatDetails: listing.seat_details ?? null,
            section: listing.section ?? null,
            sourceListingId: listing.id,
            totalPrice: nullableMoney(listing.total_price),
            unitPrice: listing.unit_price.toFixed(2),
          }),
        ),
        market: null,
        observedAt: event.observed_at,
        sourceEventId: event.event_id,
        sourceUrl: event.event_url,
        startsAt: event.starts_at ?? null,
        stateRegion: event.state,
        timezone: event.timezone,
        venueName: event.venue,
      }),
    ),
  };
};

const translateB2b = (payload: unknown): TranslationResult => {
  const parsed = b2bSchema.parse(payload);
  return {
    events: parsed.events.map(
      (event): NormalizedEvent => ({
        artistName: event.artistName,
        city: event.city,
        country: event.country,
        eventName: event.eventName ?? null,
        history: [],
        listings: event.listings.map(
          (listing): NormalizedListing => ({
            availabilityStatus: listing.availability,
            currency: listing.currency,
            listingUrl: listing.listingUrl,
            quantity: listing.quantity ?? null,
            row: listing.row ?? null,
            seatDetails: listing.seatDetails ?? null,
            section: listing.section ?? null,
            sourceListingId: listing.listingId,
            totalPrice: nullableMoney(listing.totalPrice),
            unitPrice: listing.unitPrice.toFixed(2),
          }),
        ),
        market: null,
        observedAt: event.observedAt,
        sourceEventId: event.eventId,
        sourceUrl: event.eventUrl,
        startsAt: event.startsAt ?? null,
        stateRegion: event.stateRegion,
        timezone: event.timezone,
        venueName: event.venueName,
      }),
    ),
  };
};

export const translateSourcePayload = (source: Source, payload: unknown): TranslationResult => {
  switch (source) {
    case "ticket_data":
      return translateTicketData(payload);
    case "tickpick":
      return translateTickpick(payload);
    case "b2b":
      return translateB2b(payload);
  }
};
