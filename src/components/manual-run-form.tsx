"use client";

import { useState } from "react";

type QueueJob = (request: Request) => Promise<Response>;

export const ManualRunForm = ({ queueJob = fetch }: Readonly<{ queueJob?: QueueJob }>) => {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (formData: FormData) => {
    setPending(true);
    setMessage("");
    const artist = String(formData.get("artist") ?? "").trim();
    const eventId = String(formData.get("eventId") ?? "").trim();
    const url = String(formData.get("url") ?? "").trim();
    const source = String(formData.get("source") ?? "ticket_data");
    try {
      const response = await queueJob(
        new Request("/api/ingestion-jobs", {
          body: JSON.stringify({
            ...(artist ? { artist } : {}),
            ...(eventId ? { eventId } : {}),
            source,
            ...(url ? { url } : {}),
          }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": `manual-${crypto.randomUUID()}`,
          },
          method: "POST",
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
        setMessage(typeof body?.message === "string" ? body.message : "Refresh could not be queued.");
        return;
      }
      setMessage("Refresh queued. The worker will collect it shortly.");
    } catch {
      setMessage("Refresh could not be queued. Check the server connection.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form action={submit} className="manual-form">
      <label>
        <span>Source</span>
        <select defaultValue="ticket_data" name="source">
          <option value="ticket_data">Ticket Data</option>
          <option value="tickpick">TickPick</option>
          <option value="b2b">B2B</option>
        </select>
      </label>
      <label>
        <span>Artist scope</span>
        <input name="artist" placeholder="Optional artist name" />
      </label>
      <label>
        <span>Event ID</span>
        <input name="eventId" placeholder="Optional source event ID" />
      </label>
      <label className="form-wide">
        <span>Source URL</span>
        <input name="url" placeholder="Optional authorized source URL" type="url" />
      </label>
      <div className="form-wide form-actions">
        <button className="button button-dark" disabled={pending} type="submit">
          {pending ? "Queuing…" : "Queue refresh"}
        </button>
        {message ? <p className="form-status" role="status">{message}</p> : null}
      </div>
    </form>
  );
};
