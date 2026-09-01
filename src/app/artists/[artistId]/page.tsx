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
import { getArtistResearch } from "@/services/research";

import { requireOperatorSession } from "../../_lib/require-session";

export const dynamic = "force-dynamic";

const sorts = [
  ["event_date", "Event date"],
  ["ticket_data", "Ticket Data get-in"],
  ["tickpick", "TickPick low"],
  ["b2b", "B2B low"],
  ["refreshed", "Recently refreshed"],
] as const;

const ArtistPage = async ({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ artistId: string }>;
  searchParams: Promise<{ sort?: string }>;
}>) => {
  await requireOperatorSession();
  const artistId = (await params).artistId;
  const requestedSort = (await searchParams).sort;
  const sort = sorts.some(([value]) => value === requestedSort)
    ? (requestedSort as (typeof sorts)[number][0])
    : "event_date";
  const result = await getArtistResearch({
    artistId,
    database: getDatabase(getConfig().databaseUrl),
    sort,
  });
  if (!result) notFound();

  return (
    <AppShell>
      <div className="breadcrumbs">
        <Link href="/">Artists</Link><span>/</span><span>{result.artist.displayName}</span>
      </div>
      <section className="page-heading compact reveal">
        <div>
          <p className="eyebrow">Artist comparison</p>
          <h1>{result.artist.displayName}</h1>
          <p className="lede">
            {result.events.length} matched event{result.events.length === 1 ? "" : "s"} across the
            monitored sources.
          </p>
        </div>
      </section>
      <section className="panel table-panel reveal">
        <div className="panel-header">
          <div><p className="eyebrow">Unified events</p><h2>Market comparison</h2></div>
          <form className="sort-form">
            <label htmlFor="event-sort">Sort by</label>
            <select defaultValue={sort} id="event-sort" name="sort">
              {sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button className="button button-light" type="submit">Apply</button>
          </form>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Event</th><th><SourceBadge source="ticket_data" /></th><th><SourceBadge source="tickpick" /></th><th><SourceBadge source="b2b" /></th><th>Freshness</th><th>Sources</th></tr>
            </thead>
            <tbody>
              {result.events.map((event) => (
                <tr key={event.id}>
                  <td className="event-cell">
                    <Link href={`/events/${event.id}`}>{event.eventName ?? result.artist.displayName}</Link>
                    <strong>{displayDate(event.startsAt)}</strong>
                    <span>{event.venueName}</span>
                    <small>{event.city}{event.stateRegion ? `, ${event.stateRegion}` : ""}</small>
                  </td>
                  <td>
                    <span className="price">{displayMoney(event.ticketData.getInPrice)}</span>
                    <small>{displayValue(event.ticketData.inventoryCount)} inventory · {displayValue(event.ticketData.listingCount)} listings</small>
                  </td>
                  <td>
                    <span className="price">{displayMoney(event.tickpick.lowPrice)}</span>
                    <small>{event.tickpick.activeListingCount} {event.tickpick.activeListingCount === 1 ? "listing" : "listings"} · {displayValue(event.tickpick.activeQuantity)} tickets</small>
                  </td>
                  <td>
                    <span className="price">{displayMoney(event.b2b.lowPrice)}</span>
                    <small>{event.b2b.activeListingCount} {event.b2b.activeListingCount === 1 ? "listing" : "listings"} · {displayValue(event.b2b.activeQuantity)} tickets</small>
                  </td>
                  <td><span className="freshness">{displayRelativeFreshness(event.lastRefreshedAt)}</span></td>
                  <td>
                    <div className="source-links">
                      {event.sourceLinks.map((link) => (
                        <a href={link.url} key={`${link.source}-${link.url}`} rel="noreferrer" target="_blank">
                          <SourceBadge source={link.source} />
                        </a>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.events.length === 0 ? (
            <p className="empty-state">No matched events are available for this artist yet.</p>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
};

export default ArtistPage;
