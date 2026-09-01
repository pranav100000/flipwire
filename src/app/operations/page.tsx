import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { ManualRunForm } from "@/components/manual-run-form";
import { SourceBadge } from "@/components/source-badge";
import { getConfig } from "@/config";
import { getDatabase } from "@/db/client";
import { displayDate, displayRelativeFreshness } from "@/lib/presentation";
import { getOperationsOverview } from "@/services/research";

import { requireOperatorSession } from "../_lib/require-session";

export const dynamic = "force-dynamic";

const OperationsPage = async () => {
  await requireOperatorSession();
  const overview = await getOperationsOverview({
    database: getDatabase(getConfig().databaseUrl),
  });
  return (
    <AppShell>
      <section className="page-heading compact reveal">
        <div>
          <p className="eyebrow">Pipeline control</p>
          <h1>Operations</h1>
          <p className="lede">
            Refresh health, durable jobs, failed runs, and uncertain matches in one audit surface.
          </p>
        </div>
        <Link className="button button-light export-link" href="/api/export">Export JSON</Link>
      </section>
      <section className="source-health reveal">
        {overview.sources.map((source) => (
          <article className="panel" key={source.source}>
            <div className="source-card-head">
              <SourceBadge source={source.source} />
              <span className={`status ${source.enabled ? "status-active" : "status-inactive"}`}>
                {source.enabled ? "enabled" : "disabled"}
              </span>
            </div>
            <strong className="health-time">{displayRelativeFreshness(source.lastSuccessfulAt)}</strong>
            <small>last successful refresh</small>
            <dl>
              <div><dt>Events</dt><dd>{source.eventCount}</dd></div>
              <div><dt>Artists</dt><dd>{source.artistCount}</dd></div>
              <div><dt>Active listings</dt><dd>{source.activeListingCount}</dd></div>
              <div><dt>Cadence</dt><dd>{source.cadenceMinutes} min</dd></div>
            </dl>
            <p className="mode-label">{source.fixtureMode ? "Fixture mode" : "Live connector"}</p>
          </article>
        ))}
      </section>
      <section className="panel reveal">
        <div className="panel-header"><div><p className="eyebrow">Manual collection</p><h2>Queue a refresh</h2></div></div>
        <ManualRunForm />
      </section>
      <section className="detail-grid reveal">
        <article className="panel">
          <div className="panel-header">
            <div><p className="eyebrow">Review queue</p><h2>Uncertain matches</h2></div>
            <span className="count-label">{overview.openReviewCount} open</span>
          </div>
          {overview.reviewItems.length ? (
            <div className="issue-list">
              {overview.reviewItems.map((item) => (
                <div key={item.id}>
                  <SourceBadge source={item.source} />
                  <span><strong>{item.summary}</strong><small>{item.kind.replaceAll("_", " ")} · {displayDate(item.createdAt)}</small></span>
                </div>
              ))}
            </div>
          ) : <p className="empty-state">No source events currently need manual review.</p>}
        </article>
        <article className="panel">
          <div className="panel-header">
            <div><p className="eyebrow">Failed runs</p><h2>Collection errors</h2></div>
            <span className="count-label">{overview.failedRuns.length} shown</span>
          </div>
          {overview.failedRuns.length ? (
            <div className="issue-list">
              {overview.failedRuns.map((run) => (
                <div key={run.id}>
                  <SourceBadge source={run.source} />
                  <span>
                    <strong>{displayDate(run.startedAt)}</strong>
                    <small>{run.errors.map((error) => String(error["message"] ?? "Collection failed")).join(" · ")}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="empty-state">No failed ingestion runs are retained.</p>}
        </article>
      </section>
      <section className="panel table-panel reveal">
        <div className="panel-header">
          <div><p className="eyebrow">Durable queue</p><h2>Recent jobs</h2></div>
          <span className="count-label">{overview.jobs.length} shown</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Source</th><th>Status</th><th>Scope</th><th>Attempts</th><th>Created</th><th>Result</th></tr></thead>
            <tbody>
              {overview.jobs.map((job) => (
                <tr key={job.id}>
                  <td><SourceBadge source={job.source} /></td>
                  <td><span className={`status status-${job.status}`}>{job.status}</span></td>
                  <td><code>{Object.keys(job.scope).length ? JSON.stringify(job.scope) : "all monitored events"}</code></td>
                  <td>{job.attempts}</td>
                  <td>{displayDate(job.createdAt)}</td>
                  <td>{job.lastError || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {overview.jobs.length === 0 ? <p className="empty-state">The queue has not received any jobs yet.</p> : null}
        </div>
      </section>
    </AppShell>
  );
};

export default OperationsPage;
