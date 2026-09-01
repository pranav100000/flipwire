import { z } from "zod";

import { getConfig } from "@/config";
import { getDatabase } from "@/db/client";
import { readOperatorSession } from "@/lib/auth";
import { apiError, jsonResponse } from "@/lib/http";
import { getArtistResearch } from "@/services/research";

export const dynamic = "force-dynamic";

const parametersSchema = z.object({ artistId: z.uuid() });
const sortSchema = z.enum(["event_date", "ticket_data", "tickpick", "b2b", "refreshed"]);

export const GET = async (
  request: Request,
  context: Readonly<{ params: Promise<{ artistId: string }> }>,
): Promise<Response> => {
  const config = getConfig();
  if (!readOperatorSession(request, config.secretKey)) {
    return apiError(401, "UNAUTHENTICATED", "Valid FlipWire operator credentials are required.");
  }
  const parameters = parametersSchema.safeParse(await context.params);
  if (!parameters.success) return apiError(422, "INVALID_REQUEST", "Artist ID is invalid.");
  const requestedSort = sortSchema.safeParse(new URL(request.url).searchParams.get("sort"));
  const result = await getArtistResearch({
    artistId: parameters.data.artistId,
    database: getDatabase(config.databaseUrl),
    sort: requestedSort.success ? requestedSort.data : "event_date",
  });
  return result
    ? jsonResponse({ data: result }, { noStore: true })
    : apiError(404, "NOT_FOUND", "Artist was not found.");
};
