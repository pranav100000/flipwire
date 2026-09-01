import Link from "next/link";
import type { CSSProperties } from "react";

import { AppShell } from "@/components/app-shell";
import { getConfig } from "@/config";
import { getDatabase } from "@/db/client";
import { displayRelativeFreshness } from "@/lib/presentation";
import { getOperationsOverview, listArtists } from "@/services/research";

import { requireOperatorSession } from "./_lib/require-session";

export const dynamic = "force-dynamic";

const HomePage = async ({ searchParams }: Readonly<{ searchParams: Promise<{ q?: string }> }>) => {
  await requireOperatorSession();
  const query = (await searchParams).q?.trim() ?? "";
  const database = getDatabase(getConfig().databaseUrl);
  const [catalog, operations] = await Promise.all([
    listArtists({ database, page: 1, pageSize: 100, query }),
    getOperationsOverview({ database }),
  ]);
  const lastRefresh =
    operations.sources
      .map((source) => source.lastSuccessfulAt)
      .filter((date): date is Date => date !== null)
      .toSorted((left, right) => right.getTime() - left.getTime())[0] ?? null;
  const eventCount = operations.sources.reduce((total, source) => total + source.eventCount, 0);

  return (
    <AppShell>
      <section className="page-heading reveal">
        <div>
          <p className="eyebrow">Artist research</p>
          <h1>Compare the market, event by event.</h1>
          <p className="lede">
            Canonical events with Ticket Data context and active listings from the team’s buying
            sources.
          </p>
        </div>
        <div className="heading-meta">
          <span>Last source refresh</span>
          <strong>{displayRelativeFreshness(lastRefresh)}</strong>
        </div>
      </section>

      <section className="metric-grid reveal">
        <article><span>Artists</span><strong>{catalog.totalItems}</strong><small>matched catalog</small></article>
        <article><span>Source events</span><strong>{eventCount}</strong><small>across three sources</small></article>
        <article><span>Open reviews</span><strong>{operations.openReviewCount}</strong><small>uncertain matches</small></article>
        <article><span>Stale listings</span><strong>{operations.staleListingCount}</strong><small>retained, not deleted</small></article>
      </section>

      <section className="panel reveal">
        <div className="panel-header">
          <div><p className="eyebrow">Monitored catalog</p><h2>Find an artist</h2></div>
          <span className="count-label">{catalog.totalItems} result{catalog.totalItems === 1 ? "" : "s"}</span>
        </div>
        <form className="search-form" role="search">
          <label className="sr-only" htmlFor="artist-search">Search artists</label>
          <input defaultValue={query} id="artist-search" name="q" placeholder="Search by artist name" />
          <button className="button button-dark" type="submit">Search</button>
        </form>
        <div className="artist-list">
          {catalog.items.length > 0 ? catalog.items.map((artist, index) => (
            <Link
              className="artist-row"
              href={`/artists/${artist.id}`}
              key={artist.id}
              style={{ "--index": index } as CSSProperties}
            >
              <span className="artist-initial">{artist.displayName.slice(0, 1).toUpperCase()}</span>
              <span><strong>{artist.displayName}</strong><small>{artist.canonicalName}</small></span>
              <span className="row-link">View events <span aria-hidden="true">→</span></span>
            </Link>
          )) : <p className="empty-state">No artists match “{query}”. Try a broader name.</p>}
        </div>
      </section>
    </AppShell>
  );
};

export default HomePage;
