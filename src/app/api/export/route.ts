import { getConfig } from "@/config";
import { getDatabase } from "@/db/client";
import { readOperatorSession } from "@/lib/auth";
import { apiError, jsonResponse } from "@/lib/http";
import { exportResearchDataset } from "@/services/research";

export const dynamic = "force-dynamic";

export const GET = async (request: Request): Promise<Response> => {
  const config = getConfig();
  if (!readOperatorSession(request, config.secretKey)) {
    return apiError(401, "UNAUTHENTICATED", "Valid FlipWire operator credentials are required.");
  }
  return jsonResponse(
    await exportResearchDataset({ database: getDatabase(config.databaseUrl) }),
    {
      headers: { "content-disposition": 'attachment; filename="flipwire-export.json"' },
      noStore: true,
    },
  );
};
