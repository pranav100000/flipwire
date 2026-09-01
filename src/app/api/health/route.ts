import { jsonResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = (): Response => jsonResponse({ status: "ok" }, { noStore: true });

