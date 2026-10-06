import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { parseConfig } from "@/config";
import { createConfiguredConnector } from "@/connectors/configured";
import { collectHttpJson } from "@/connectors/http";
import { translateSourcePayload } from "@/connectors/translate";
import {
  createSessionToken,
  credentialsAreValid,
  expiredSessionCookie,
  readOperatorSession,
  readOperatorSessionToken,
  sessionCookie,
} from "@/lib/auth";
import {
  createPreviewAuthSignature,
  isValidPreviewAuthSignature,
  PREVIEW_AUTH_TTL_SECONDS,
} from "@/lib/preview-auth";
import { displayDate, displayMoney, displayRelativeFreshness, displayValue } from "@/lib/presentation";
import { isMainModule, logProcessEvent, runUntilStopped } from "@/lib/process-runtime";

const baseEnvironment = {
  DATABASE_URL: "postgresql://flipwire:flipwire@localhost:5432/flipwire",
  FLIPWIRE_ADMIN_PASSWORD: "local-test-password",
  FLIPWIRE_ADMIN_USERNAME: "operator",
  FLIPWIRE_RAW_STORAGE_ROOT: "/tmp/flipwire-test-raw",
  FLIPWIRE_SECRET_KEY: "s".repeat(32),
};

describe("configuration and connector boundaries", () => {
  it("maps every optional live connector value", () => {
    const config = parseConfig({
      ...baseEnvironment,
      B2B_API_TOKEN: "b2b-secret",
      B2B_BASE_URL: "https://b2b.test/events",
      TICKET_DATA_API_TOKEN: "td-secret",
      TICKET_DATA_BASE_URL: "https://ticket-data.test/events",
      TICKPICK_API_TOKEN: "tp-secret",
      TICKPICK_BASE_URL: "https://tickpick.test/events",
    });
    expect(config).toMatchObject({
      b2bApiToken: "b2b-secret",
      b2bBaseUrl: "https://b2b.test/events",
      ticketDataApiToken: "td-secret",
      ticketDataBaseUrl: "https://ticket-data.test/events",
      tickpickApiToken: "tp-secret",
      tickpickBaseUrl: "https://tickpick.test/events",
    });
    expect(
      parseConfig({ ...baseEnvironment, DATABASE_URL: "postgres://flipwire:flipwire@localhost/db" })
        .databaseUrl,
    ).toMatch(/^postgres:\/\//);
  });

  it("collects all live sources with credentials and supported scopes", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ events: [] }));
    const config = parseConfig({
      ...baseEnvironment,
      B2B_API_TOKEN: "b2b-secret",
      B2B_BASE_URL: "https://b2b.test/events",
      TICKET_DATA_API_TOKEN: "td-secret",
      TICKET_DATA_BASE_URL: "https://ticket-data.test/events",
      TICKPICK_API_TOKEN: "tp-secret",
      TICKPICK_BASE_URL: "https://tickpick.test/events",
    });
    const ticketData = createConfiguredConnector({
      config,
      fixtureMode: false,
      maxRetries: 0,
      source: "ticket_data",
      timeoutMs: 500,
    });
    const tickpick = createConfiguredConnector({ config, fixtureMode: false, source: "tickpick" });
    const b2b = createConfiguredConnector({ config, fixtureMode: false, source: "b2b" });

    await ticketData.collect({ artist: "The Midnight", eventId: "td-1" });
    await tickpick.collect({ url: "https://authorized.test/tickpick/event" });
    await b2b.collect();

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://ticket-data.test/events?artist=The+Midnight&eventId=td-1",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "Bearer td-secret" });
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://authorized.test/tickpick/event");
    expect(fetcher.mock.calls[2]?.[0]).toBe("https://b2b.test/events");
    fetcher.mockRestore();
  });

  it("rejects live collection without an issued endpoint and reads bundled fixtures", async () => {
    const config = parseConfig(baseEnvironment);
    const live = createConfiguredConnector({ config, fixtureMode: false, source: "b2b" });
    await expect(live.collect()).rejects.toThrow(/No live endpoint/);

    const fixture = createConfiguredConnector({ config, fixtureMode: true, source: "tickpick" });
    const collected = await fixture.collect();
    expect(fixture.translate(collected.payload).events[0]?.listings[0]?.sourceListingId).toBe(
      "tp-listing-1",
    );
  });

  it("supports credential-free issued endpoints and rejects each missing endpoint", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ events: [] }));
    const noTokens = parseConfig({
      ...baseEnvironment,
      B2B_BASE_URL: "https://b2b.test/events",
      TICKET_DATA_BASE_URL: "https://ticket-data.test/events",
      TICKPICK_BASE_URL: "https://tickpick.test/events",
    });
    for (const source of ["ticket_data", "tickpick", "b2b"] as const) {
      await createConfiguredConnector({ config: noTokens, fixtureMode: false, source }).collect();
    }
    expect(fetcher.mock.calls.every((call) => JSON.stringify(call[1]?.headers) === "{}")).toBe(true);
    fetcher.mockRestore();

    const noEndpoints = parseConfig(baseEnvironment);
    for (const source of ["ticket_data", "tickpick"] as const) {
      await expect(
        createConfiguredConnector({ config: noEndpoints, fixtureMode: false, source }).collect(),
      ).rejects.toThrow(/No live endpoint/);
    }
  });

  it("applies source defaults and preserves explicit nulls during translation", () => {
    const ticketData = translateSourcePayload("ticket_data", {
      events: [
        {
          artist_name: "Artist",
          city: "Austin",
          id: "td-min",
          market: {},
          observed_at: "2026-08-31T12:00:00Z",
          timezone: "America/Chicago",
          url: "https://ticket-data.test/td-min",
          venue_name: "Venue",
        },
      ],
    });
    const tickpick = translateSourcePayload("tickpick", {
      events: [
        {
          artist: "Artist",
          city: "Austin",
          event_id: "tp-min",
          event_url: "https://tickpick.test/tp-min",
          listings: [{ id: "tp-l", unit_price: 10, url: "https://tickpick.test/l" }],
          observed_at: "2026-08-31T12:00:00Z",
          timezone: "America/Chicago",
          venue: "Venue",
        },
      ],
    });
    const b2b = translateSourcePayload("b2b", {
      events: [
        {
          artistName: "Artist",
          city: "Austin",
          eventId: "b2b-min",
          eventUrl: "https://b2b.test/b2b-min",
          listings: [
            { listingId: "b2b-l", listingUrl: "https://b2b.test/l", unitPrice: 20 },
          ],
          observedAt: "2026-08-31T12:00:00Z",
          timezone: "America/Chicago",
          venueName: "Venue",
        },
      ],
    });

    expect(ticketData.events[0]).toMatchObject({
      country: "US",
      eventName: null,
      history: [],
      startsAt: null,
      stateRegion: "",
    });
    expect(ticketData.events[0]?.market).toEqual({
      forecastText: null,
      forecastValue: null,
      getInPrice: null,
      highPrice: null,
      inventoryCount: null,
      listingCount: null,
      lowPrice: null,
      medianPrice: null,
    });
    expect(tickpick.events[0]?.listings[0]).toMatchObject({
      availabilityStatus: "unknown",
      currency: "USD",
      quantity: null,
      row: null,
      seatDetails: null,
      section: null,
      totalPrice: null,
    });
    expect(b2b.events[0]?.listings[0]).toMatchObject({
      availabilityStatus: "unknown",
      currency: "USD",
      quantity: null,
      totalPrice: null,
    });
  });
});

describe("HTTP failure policy", () => {
  it("uses the default wait implementation and global fetch", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
    await expect(
      collectHttpJson({
        maxRetries: 0,
        minimumDelayMs: 1,
        sourceUrl: "https://vendor.test/events",
        timeoutMs: 500,
      }),
    ).resolves.toMatchObject({ payload: { ok: true } });
    fetcher.mockRestore();
  });

  it("retries thrown network failures and stops after the final attempt", async () => {
    const recovered = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(Response.json({ events: [] }));
    await expect(
      collectHttpJson({
        fetcher: recovered,
        maxRetries: 1,
        sleep: async () => undefined,
        sourceUrl: "https://vendor.test/events",
        timeoutMs: 500,
      }),
    ).resolves.toMatchObject({ payload: { events: [] } });

    await expect(
      collectHttpJson({
        fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error("still down")),
        maxRetries: 0,
        sourceUrl: "https://vendor.test/events",
        timeoutMs: 500,
      }),
    ).rejects.toThrow("still down");
    await expect(
      collectHttpJson({
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("down", { status: 503 })),
        maxRetries: 0,
        sourceUrl: "https://vendor.test/events",
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("aborts a request after its configured timeout", async () => {
    const waitsForAbort = vi.fn<typeof fetch>(async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );
    await expect(
      collectHttpJson({
        fetcher: waitsForAbort,
        maxRetries: 0,
        sourceUrl: "https://vendor.test/slow",
        timeoutMs: 1,
      }),
    ).rejects.toThrow("aborted");
  });
});

describe("operator session boundary", () => {
  const secret = "s".repeat(32);
  const signed = (payload: unknown) => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  };
  const signedText = (payload: string) => {
    const encoded = Buffer.from(payload).toString("base64url");
    const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  };

  it("accepts an unexpired signed token from a multi-cookie request", () => {
    const now = new Date("2026-08-31T12:00:00Z");
    const token = createSessionToken("operator", secret, now);
    const request = new Request("http://localhost", {
      headers: { cookie: `theme=warm; flipwire_session=${token}; locale=en` },
    });
    expect(readOperatorSession(request, secret, now)?.sub).toBe("operator");
    expect(readOperatorSession(new Request("http://localhost"), secret, now)).toBeNull();
  });

  it("rejects malformed, forged, expired, and structurally invalid tokens", () => {
    const now = new Date("2026-08-31T12:00:00Z");
    expect(readOperatorSessionToken(undefined, secret, now)).toBeNull();
    expect(readOperatorSessionToken("missing-parts", secret, now)).toBeNull();
    expect(readOperatorSessionToken("a.b.c", secret, now)).toBeNull();
    expect(readOperatorSessionToken("payload.forged", secret, now)).toBeNull();
    expect(readOperatorSessionToken(signed(null), secret, now)).toBeNull();
    expect(readOperatorSessionToken(signed({ exp: 1, sub: "operator" }), secret, now)).toBeNull();
    expect(readOperatorSessionToken(signed({ exp: 2_000_000_000 }), secret, now)).toBeNull();
    expect(readOperatorSessionToken(signed({ exp: "later", sub: "operator" }), secret, now)).toBeNull();
    expect(readOperatorSessionToken(signedText("not-json"), secret, now)).toBeNull();
    expect(
      readOperatorSession(
        new Request("http://localhost", { headers: { cookie: "theme=warm; locale=en" } }),
        secret,
        now,
      ),
    ).toBeNull();
  });

  it("compares both credential fields and emits secure and local cookie variants", () => {
    const config = parseConfig(baseEnvironment);
    expect(credentialsAreValid("operator", "local-test-password", config)).toBe(true);
    expect(credentialsAreValid("intruder", "local-test-password", config)).toBe(false);
    expect(sessionCookie("token", true)).toContain("Secure");
    expect(sessionCookie("token", false)).not.toContain("Secure");
    expect(expiredSessionCookie(true)).toContain("Max-Age=0");
    expect(expiredSessionCookie(false)).not.toContain("Secure");
  });
});

describe("authenticated preview bootstrap", () => {
  const secret = "preview-secret-key-which-is-at-least-32-chars";
  const nowSeconds = 1_800_000_000;

  it("accepts a short-lived signed bootstrap and rejects invalid signatures or windows", () => {
    const expiresAt = nowSeconds + PREVIEW_AUTH_TTL_SECONDS;
    const signature = createPreviewAuthSignature(expiresAt, secret);

    expect(isValidPreviewAuthSignature(expiresAt, signature, secret, nowSeconds)).toBe(true);
    expect(isValidPreviewAuthSignature(expiresAt, signature, "wrong-secret", nowSeconds)).toBe(false);
    expect(isValidPreviewAuthSignature(expiresAt, "invalid", secret, nowSeconds)).toBe(false);
    expect(isValidPreviewAuthSignature(nowSeconds, signature, secret, nowSeconds)).toBe(false);
    expect(
      isValidPreviewAuthSignature(nowSeconds + PREVIEW_AUTH_TTL_SECONDS + 1, signature, secret, nowSeconds),
    ).toBe(false);
    expect(isValidPreviewAuthSignature(Number.NaN, signature, secret, nowSeconds)).toBe(false);
  });
});

describe("presentation and process utilities", () => {
  it("formats known and unknown values", () => {
    const date = new Date("2026-08-31T12:00:00Z");
    expect(displayDate(date)).toContain("Aug 31, 2026");
    expect(displayRelativeFreshness(date)).toContain("Aug 31, 2026");
    expect(displayRelativeFreshness(null)).toBe("unknown");
    expect(displayMoney(12.5)).toBe("$12.50");
    expect(displayMoney(10, "USD")).toBe("$10.00");
    expect(displayMoney(null)).toBe("unknown");
    expect(displayValue(1_200)).toBe("1,200");
    expect(displayValue(null)).toBe("unknown");
  });

  it("identifies the process entrypoint and emits structured log levels", () => {
    expect(isMainModule(pathToFileURL(process.argv[1] ?? "").href)).toBe(true);
    expect(isMainModule("file:///not-the-entrypoint.ts")).toBe(false);
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logProcessEvent("info", "started", { count: 1 });
    logProcessEvent("warn", "slow");
    logProcessEvent("error", "failed");
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"event":"started"'));
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it("runs until abort and propagates cycle failures", async () => {
    const controller = new AbortController();
    let runs = 0;
    await runUntilStopped({
      intervalMs: 1,
      runOnce: async () => {
        runs += 1;
        controller.abort();
      },
      signal: controller.signal,
    });
    expect(runs).toBe(1);
    await expect(
      runUntilStopped({
        intervalMs: 1,
        runOnce: async () => {
          throw new Error("cycle failed");
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("cycle failed");
  });
});
