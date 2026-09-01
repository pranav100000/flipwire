# Data dictionary

All identifiers are UUIDs unless noted. Timestamps are stored with timezone. Money is fixed-precision numeric and is returned as numbers by the research read model.

| Table | Purpose | Important identity/lifecycle rules |
|---|---|---|
| `artists` | Canonical monitored artists | Unique normalized `canonical_name`; source-facing `display_name` preserved |
| `artist_aliases` | Known source/name variants | Alias is unique and maps to one artist |
| `venues` | Canonical venues and location/timezone | Unique normalized venue plus city/region/country |
| `venue_aliases` | Known source venue variants | Unique alias plus city maps to one venue |
| `events` | Canonical artist/date/venue event | Unique key is normalized artist + normalized venue + venue-local event date |
| `source_events` | Stable source event identity and source link | Unique `source + source_event_id`; retains raw artist/event/venue/city names and latest raw payload reference |
| `market_snapshots` | Event-level Ticket Data market context | Unique event/source/observation; nullable fields remain unknown |
| `price_history` | Source metric time series | Unique event/source/metric/observation |
| `listings` | TickPick and B2B listing inventory | Unique `source + source_listing_id`; missing listings accrue `missed_runs` and become inactive without deletion |
| `raw_payloads` | Content-addressed raw collection metadata | References a redacted file, source URL, SHA-256 hash, source, and run |
| `ingestion_runs` | Audit record for each collection attempt | Running/succeeded/partial/failed, scope, counts, timestamps, sanitized errors |
| `review_items` | Manual review queue | Open ambiguous/invalid/unmatched identities are idempotent by source/source-event/kind/status |
| `source_configs` | Per-source operating policy | Enablement, fixture/live mode, cadence, timeout, retries, backoff, rate limit, stale threshold, next run, last success |
| `ingestion_jobs` | Durable scheduler/manual work queue | Pending/running/succeeded/failed; atomic claims, attempts, scope, idempotency key, linked run |

## Source and status values

- Source: `ticket_data`, `tickpick`, `b2b`
- Listing availability: `active`, `inactive`, `unknown`
- Run: `running`, `succeeded`, `partial`, `failed`
- Review kind: unmatched event, ambiguous event, artist alias, venue alias, invalid date, listing without event
- Review status: `open`, `resolved`, `dismissed`

The UI displays unknown for absent nullable market, seating, quantity, and freshness fields. It never substitutes inferred prices or quantities.
