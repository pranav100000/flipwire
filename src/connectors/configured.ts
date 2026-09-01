import type { Config } from "@/config";
import type { Connector, IngestionScope, Source } from "@/connectors/contracts";
import { collectHttpJson } from "@/connectors/http";
import { translateSourcePayload } from "@/connectors/translate";

import b2bFixture from "../../fixtures/b2b.json";
import ticketDataFixture from "../../fixtures/ticket-data.json";
import tickpickFixture from "../../fixtures/tickpick.json";

const fixturePayloads: Readonly<Record<Source, unknown>> = {
  b2b: b2bFixture,
  ticket_data: ticketDataFixture,
  tickpick: tickpickFixture,
};

const liveConfiguration = (
  source: Source,
  config: Config,
): Readonly<{ sourceUrl?: string; token?: string }> => {
  switch (source) {
    case "ticket_data":
      return {
        ...(config.ticketDataBaseUrl ? { sourceUrl: config.ticketDataBaseUrl } : {}),
        ...(config.ticketDataApiToken ? { token: config.ticketDataApiToken } : {}),
      };
    case "tickpick":
      return {
        ...(config.tickpickBaseUrl ? { sourceUrl: config.tickpickBaseUrl } : {}),
        ...(config.tickpickApiToken ? { token: config.tickpickApiToken } : {}),
      };
    case "b2b":
      return {
        ...(config.b2bBaseUrl ? { sourceUrl: config.b2bBaseUrl } : {}),
        ...(config.b2bApiToken ? { token: config.b2bApiToken } : {}),
      };
  }
};

const scopedUrl = (baseUrl: string, scope?: IngestionScope): string => {
  if (scope?.url) return scope.url;
  const url = new URL(baseUrl);
  if (scope?.artist) url.searchParams.set("artist", scope.artist);
  if (scope?.eventId) url.searchParams.set("eventId", scope.eventId);
  return url.toString();
};

export const createConfiguredConnector = (input: {
  readonly config: Config;
  readonly fixtureMode: boolean;
  readonly maxRetries?: number;
  readonly rateLimitSeconds?: number;
  readonly source: Source;
  readonly timeoutMs?: number;
}): Connector => ({
  source: input.source,
  collect: async (scope) => {
    if (input.fixtureMode) {
      return {
        payload: structuredClone(fixturePayloads[input.source]),
        sourceUrl: `fixture://${input.source}`,
      };
    }

    const live = liveConfiguration(input.source, input.config);
    if (!live.sourceUrl) throw new Error(`No live endpoint configured for ${input.source}`);
    return collectHttpJson({
      maxRetries: input.maxRetries ?? 3,
      minimumDelayMs: (input.rateLimitSeconds ?? 0) * 1_000,
      sourceUrl: scopedUrl(live.sourceUrl, scope),
      timeoutMs: input.timeoutMs ?? 30_000,
      ...(live.token ? { token: live.token } : {}),
    });
  },
  translate: (payload) => translateSourcePayload(input.source, payload),
});
