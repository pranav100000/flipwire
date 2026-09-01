import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { SourceBadge } from "@/components/source-badge";
import { getConfig } from "@/config";
import { getDatabase } from "@/db/client";
import {
  displayDate,
  displayMoney,
  displayRelativeFreshness,
  displayValue,
} from "@/lib/presentation";
import { getEventResearch } from "@/services/research";

import { requireOperatorSession } from "../../_lib/require-session";

export const dynamic = "force-dynamic";

const EventPage = async ({ params }: Readonly<{ params: Promise<{ eventId: string }> }>) => {
  await requireOperatorSession();
  const result = await getEventResearch({
    database: getDatabase(getConfig().databaseUrl),
    eventId: (await params).eventId,
  });
  if (!result) notFound();
  return (
    <AppShell>
      <div className="breadcrumbs">
        <Link href="/">Artists</Link><span>/</span>
        <Link href={`/artists/${result.event.artistId}`}>{result.event.artistName}</Link>
        <span>/</span><span>Event</span>
      </div>
      <section className="page-heading compact reveal">
        <div>
          <p className="eyebrow">Canonical event</p>
          <h1>{result.event.eventName ?? result.event.artistName}</h1>
          <p className="lede">
            {displayDate(result.event.startsAt)} · {result.event.venueName}, {result.event.city}
            {result.event.stateRegion ? `, ${result.event.stateRegion}` : ""}
          </p>
        </div>
        <div className="heading-meta">
          <span>Last refreshed</span>
          <strong>{displayRelativeFreshness(result.lastRefreshedAt)}</strong>
        </div>
      </section>

      <section className="detail-grid reveal">
        <article className="panel">
          <div className="panel-header">
            <div><p className="eyebrow">Ticket Data</p><h2>Market snapshots</h2></div>
            <SourceBadge source="ticket_data" />
          </div>
          {result.marketSnapshots.length ? result.marketSnapshots.map((snapshot) => (
            <div className="snapshot-grid" key={snapshot.id}>
              <div><span>Get-in</span><strong>{displayMoney(snapshot.getInPrice)}</strong></div>
              <div><span>Median</span><strong>{displayMoney(snapshot.medianPrice)}</strong></div>
              <div><span>Range</span><strong>{displayMoney(snapshot.lowPrice)} – {displayMoney(snapshot.highPrice)}</strong></div>
              <div><span>Inventory</span><strong>{displayValue(snapshot.inventoryCount)}</strong></div>
              <div><span>Forecast</span><strong>{snapshot.forecastText ?? "unknown"}</strong></div>
              <div><span>Observed</span><strong>{displayDate(snapshot.observedAt)}</strong></div>
            </div>
          )) : <p className="empty-state">No Ticket Data market snapshot is available.</p>}
        </article>
        <article className="panel">
          <div className="panel-header"><div><p className="eyebrow">Collected context</p><h2>Price history</h2></div></div>
          {result.priceHistory.length ? (
            <div className="history-list">
              {result.priceHistory.map((point) => (
                <div key={point.id}>
                  <SourceBadge source={point.source} />
                  <span>{point.metricName.replaceAll("_", " ")}</span>
                  <strong>{displayMoney(point.metricValue)}</strong>
                  <time>{displayDate(point.observedAt)}</time>
                </div>
              ))}
            </div>
          ) : <p className="empty-state">No historical price points are available.</p>}
        </article>
      </section>

      <section className="panel table-panel reveal">
        <div className="panel-header">
          <div><p className="eyebrow">Buying sources</p><h2>Listings</h2></div>
          <span className="count-label">{result.listings.length} retained</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Source</th><th>Section / row</th><th>Quantity</th><th>Unit price</th><th>Total price</th><th>Status</th><th>Last seen</th><th>Marketplace</th></tr></thead>
            <tbody>
              {result.listings.map((listing) => (
                <tr key={listing.id}>
                  <td><SourceBadge source={listing.source} /></td>
                  <td>
                    <strong>{listing.section ?? "unknown"}</strong>
                    <small>{listing.row ? `Row ${listing.row}` : "row unknown"}{listing.seatDetails ? ` · ${listing.seatDetails}` : ""}</small>
                  </td>
                  <td>{displayValue(listing.quantity)}</td>
                  <td className="price">{displayMoney(listing.unitPrice, listing.currency)}</td>
                  <td>{displayMoney(listing.totalPrice, listing.currency)}</td>
                  <td><span className={`status status-${listing.availabilityStatus}`}>{listing.availabilityStatus}</span></td>
                  <td className="freshness">{displayDate(listing.lastSeenAt)}</td>
                  <td><a className="text-link" href={listing.listingUrl} rel="noreferrer" target="_blank">Open listing →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.listings.length === 0 ? <p className="empty-state">No TickPick or B2B listings are available.</p> : null}
        </div>
      </section>

      <section className="panel reveal">
        <div className="panel-header"><div><p className="eyebrow">Debug references</p><h2>Source records</h2></div></div>
        <div className="record-list">
          {result.sourceRecords.map((record) => (
            <div key={record.id}>
              <SourceBadge source={record.source} />
              <span><strong>{record.sourceEventId}</strong><small>{record.rawArtistName} · {record.rawVenueName}</small></span>
              <span><small>Raw payload</small><code>{record.rawPayloadId ?? "unknown"}</code></span>
              <a className="text-link" href={record.sourceUrl} rel="noreferrer" target="_blank">Open source →</a>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
};

export default EventPage;
