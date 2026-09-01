import { createConfiguredConnector } from "@/connectors/configured";
import type { Config } from "@/config";
import type { Database } from "@/db/client";
import { artists } from "@/db/schema";
import { normalizeEntityName } from "@/services/entity-matching";
import { runConnectorSet } from "@/services/ingestion";
import { ensureSourceConfigs } from "@/services/jobs";

export const seedFixtureCatalog = async (input: {
  readonly config: Config;
  readonly database: Database;
  readonly monitoredArtists: ReadonlyArray<string>;
  readonly storageRoot: string;
}) => {
  await ensureSourceConfigs(input.database);
  for (const displayName of input.monitoredArtists) {
    await input.database
      .insert(artists)
      .values({ canonicalName: normalizeEntityName(displayName), displayName })
      .onConflictDoUpdate({
        target: artists.canonicalName,
        set: { displayName },
      });
  }
  return runConnectorSet({
    connectors: (["ticket_data", "tickpick", "b2b"] as const).map((source) =>
      createConfiguredConnector({ config: input.config, fixtureMode: true, source }),
    ),
    database: input.database,
    storageRoot: input.storageRoot,
  });
};
