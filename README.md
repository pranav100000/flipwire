# FlipWire

FlipWire is an authenticated internal ticket-market research application. It collects Ticket Data market context plus TickPick and B2B listings, matches them into canonical events, retains raw payloads, and presents the result in a table-first Next.js dashboard.

Phase 1 intentionally contains no scoring, alerts, recommendations, Discord integration, or purchase automation.

## What runs

- `web`: Next.js 16 dashboard and JSON API
- `scheduler`: enqueues each enabled source on its configurable cadence (120 minutes by default)
- `worker`: claims durable PostgreSQL jobs, retries failures, and recovers abandoned work
- `postgres`: canonical data, run audit history, review items, and queue state
- `raw-data` volume: content-addressed, credential-redacted source payloads

## Local start

Requirements: Docker with Compose, or Node.js 22+ and PostgreSQL 17.

1. Copy `.env.example` to `.env` and replace the admin password and secret key. The secret key must be at least 32 characters.
2. Start the stack:

   ```sh
   docker compose up --build -d
   ```

3. Load the monitored artist configuration and all three fixture sources:

   ```sh
   docker compose run --rm web npm run seed
   ```

4. Open [http://localhost:3000](http://localhost:3000) and sign in with `FLIPWIRE_ADMIN_USERNAME` and `FLIPWIRE_ADMIN_PASSWORD`.

If those host ports are already in use, override them when starting Compose, for example `FLIPWIRE_WEB_PORT=3300 FLIPWIRE_POSTGRES_PORT=55433 docker compose up --build -d`. Container-to-container addresses do not change.

Fixture mode is enabled per source by default, so the complete workflow runs without vendor credentials. Edit `config/monitored-artists.json` to set the local monitored cohort; the included fixture covers The Midnight.

## Native development

```sh
npm ci
npm run test:db:up
DATABASE_URL=postgresql://flipwire:flipwire@127.0.0.1:55432/flipwire_test npm run db:migrate
npm test
npm run test:ui
npm run typecheck
npm run lint
```

For the application itself, set `.env` to a reachable PostgreSQL URL, run `npm run db:migrate`, `npm run seed`, and then run the three processes in separate terminals:

```sh
npm run dev
npm run worker
npm run scheduler
```

## Aether workspace

`.aether/environment.json` prepares dependencies, starts PostgreSQL, applies migrations, seeds the fixture catalog, and starts the dashboard on port 3000 for each task. Its authenticated preview hook uses a short-lived signed bootstrap URL to sign into the seeded development operator session automatically. The bootstrap route is disabled outside `NODE_ENV=development`.

## Live connector configuration

The repository implements the source adapters, retry/timeout/rate-limit policy, validation, raw retention, normalization, and ingestion lifecycle. The checked-in fixture schemas are the executable source contracts. Actual vendor endpoints and credentials were not present in the PRD, so they are deliberately not guessed.

To enable an issued API contract:

1. Set the matching `*_BASE_URL` and `*_API_TOKEN` environment variables.
2. Confirm the vendor response matches the documented contract in `docs/connectors.md`, or update only that source’s validator/translator.
3. Set `source_configs.fixture_mode = false` for that source after validation.
4. Configure `timeout_seconds`, `max_retries`, `backoff_seconds`, `rate_limit_seconds`, and `cadence_minutes` in `source_configs`.

Only authorized API/export/browser access may be connected. Tokens stay server-side and raw JSON is recursively redacted before disk persistence.

## Operations

The Operations page exposes last success by source, per-source record counts, failed runs with sanitized errors, open review items, stale listings, the durable queue, and a manual source/artist/event/URL refresh form. Manual requests require both authentication and an idempotency key.

`GET /api/export` downloads an authenticated JSON export containing canonical and source-attributed research records, raw payload metadata, and no credentials.

Health checks:

- `GET /api/health`: process liveness
- `GET /api/ready`: database readiness

## Deployment

Build the supplied `Dockerfile` once and run the same image with `npm start`, `npm run worker`, and `npm run scheduler`. Run migrations as a release step before those processes. Use managed PostgreSQL and a persistent encrypted volume for `FLIPWIRE_RAW_STORAGE_ROOT`; an object-storage adapter can replace the filesystem boundary when multi-host raw storage is required.

For staging and production, use distinct databases, raw-data roots, secrets, and vendor credentials. Termination signals stop worker/scheduler polling and close database connections. PostgreSQL row locking and the active-source uniqueness constraint make multiple worker replicas safe while preventing concurrent runs for one source.

See [the connector contract](docs/connectors.md) and [data dictionary](docs/data-dictionary.md) for implementation details.
