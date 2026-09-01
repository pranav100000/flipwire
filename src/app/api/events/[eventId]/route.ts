import { z } from "zod";

import { getConfig } from "@/config";
import { getDatabase } from "@/db/client";
import { readOperatorSession } from "@/lib/auth";
import { apiError, jsonResponse } from "@/lib/http";
import { getEventResearch } from "@/services/research";

export const dynamic = "force-dynamic";

export const GET = async (
  request: Request,
  context: Readonly<{ params: Promise<{ eventId: string }> }>,
): Promise<Response> => {
  const config = getConfig();
  if (!readOperatorSession(request, config.secretKey)) {
    return apiError(401, "UNAUTHENTICATED", "Valid FlipWire operator credentials are required.");
  }
  const parameters = z.object({ eventId: z.uuid() }).safeParse(await context.params);
  if (!parameters.success) return apiError(422, "INVALID_REQUEST", "Event ID is invalid.");
  const result = await getEventResearch({
    database: getDatabase(config.databaseUrl),
    eventId: parameters.data.eventId,
  });
  return result
    ? jsonResponse({ data: result }, { noStore: true })
    : apiError(404, "NOT_FOUND", "Event was not found.");
};
