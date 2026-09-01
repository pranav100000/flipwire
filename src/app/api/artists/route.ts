import { getConfig } from "@/config";
import { getDatabase } from "@/db/client";
import { readOperatorSession } from "@/lib/auth";
import { apiError, jsonResponse } from "@/lib/http";
import { listArtists } from "@/services/research";

export const dynamic = "force-dynamic";

export const GET = async (request: Request): Promise<Response> => {
  const config = getConfig();
  if (!readOperatorSession(request, config.secretKey)) {
    return apiError(
      401,
      "UNAUTHENTICATED",
      "Valid FlipWire operator credentials are required.",
    );
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const requestedPage = Number(url.searchParams.get("page") ?? "1");
  const requestedPageSize = Number(url.searchParams.get("pageSize") ?? "20");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize =
    Number.isInteger(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, 100)
      : 20;
  const result = await listArtists({
    database: getDatabase(config.databaseUrl),
    page,
    pageSize,
    query,
  });

  return jsonResponse(
    {
      data: result.items,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / result.pageSize),
      },
    },
    { noStore: true },
  );
};
