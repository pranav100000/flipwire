export type Source = "ticket_data" | "tickpick" | "b2b";

export type IngestionScope = Readonly<{
  artist?: string;
  eventId?: string;
  url?: string;
}>;

export type NormalizedListing = Readonly<{
  availabilityStatus: "active" | "inactive" | "unknown";
  currency: string;
  listingUrl: string;
  quantity: number | null;
  row: string | null;
  seatDetails: string | null;
  section: string | null;
  sourceListingId: string;
  totalPrice: string | null;
  unitPrice: string;
}>;

export type NormalizedMarket = Readonly<{
  forecastText: string | null;
  forecastValue: string | null;
  getInPrice: string | null;
  highPrice: string | null;
  inventoryCount: number | null;
  listingCount: number | null;
  lowPrice: string | null;
  medianPrice: string | null;
}>;

export type NormalizedHistoryPoint = Readonly<{
  metricName: string;
  metricValue: string;
  observedAt: Date;
}>;

export type NormalizedEvent = Readonly<{
  artistName: string;
  city: string;
  country: string;
  eventName: string | null;
  history: ReadonlyArray<NormalizedHistoryPoint>;
  listings: ReadonlyArray<NormalizedListing>;
  market: NormalizedMarket | null;
  observedAt: Date;
  sourceEventId: string;
  sourceUrl: string;
  startsAt: Date | null;
  stateRegion: string;
  timezone: string;
  venueName: string;
}>;

export type TranslationResult = Readonly<{
  events: ReadonlyArray<NormalizedEvent>;
}>;

export interface Connector {
  readonly source: Source;
  collect(scope?: IngestionScope): Promise<Readonly<{ payload: unknown; sourceUrl: string | null }>>;
  translate(payload: unknown): TranslationResult;
}

