# Connector contract

Every source adapter implements the same internal boundary:

1. `collect(scope)` obtains one authorized payload and its source URL.
2. The raw payload is recursively credential-redacted and retained before translation.
3. `translate(payload)` validates the source-specific shape and returns canonical event, market, history, and listing values.
4. Ingestion matches the event, then idempotently upserts source records. A malformed source fails only its own run.

Supported manual scopes are `artist`, source `eventId`, and an authorized source `url`. A scoped refresh never ages listings that were outside that scope.

## Ticket Data

The executable fixture contract uses snake-case fields:

- event: `id`, `url`, `artist_name`, `event_name`, `starts_at`, `venue_name`, location, timezone, `observed_at`
- market: nullable `get_in_price`, low/median/high, listing/inventory counts, forecast value/text
- history: `metric`, numeric `value`, `observed_at`

Ticket Data becomes `market_snapshots` and `price_history`; it is not treated as a buying-listing source.

## TickPick

The executable fixture contract uses TickPick-specific names:

- event: `event_id`, `event_url`, `artist`, `event`, `starts_at`, `venue`, location, timezone, `observed_at`
- listing: `id`, `url`, section/row/seat fields, quantity, `unit_price`, optional `total_price`, currency, status

## B2B

The executable fixture contract uses camel-case fields:

- event: `eventId`, `eventUrl`, `artistName`, `eventName`, `startsAt`, `venueName`, location, timezone, `observedAt`
- listing: `listingId`, `listingUrl`, seating fields, quantity, `unitPrice`, optional `totalPrice`, currency, availability

## Live-mode policy

Base URLs and bearer tokens come only from environment variables. HTTP collection applies the configured source delay, timeout, bounded exponential retry for 429/5xx/network errors, and no retry for permanent 4xx responses. Error records are fixed/sanitized descriptions; response bodies and tokens are not logged.

Vendor APIs frequently change and no issued API documentation or account access accompanied the PRD. Before switching a source out of fixture mode, reconcile the issued response against its Zod validator in `src/connectors/translate.ts`. Do not loosen validation globally or invent undocumented field meanings.
