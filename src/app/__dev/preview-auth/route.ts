import { getConfig } from "@/config";
import { createSessionToken, sessionCookie } from "@/lib/auth";
import { isValidPreviewAuthSignature } from "@/lib/preview-auth";

export const dynamic = "force-dynamic";

const notFound = (): Response =>
  new Response("Not found", {
    headers: { "cache-control": "no-store" },
    status: 404,
  });

export const GET = (request: Request): Response => {
  if (process.env.NODE_ENV !== "development") return notFound();

  const url = new URL(request.url);
  const expiresAtValue = url.searchParams.get("exp");
  const signature = url.searchParams.get("sig");
  if (!expiresAtValue || !/^\d+$/.test(expiresAtValue) || !signature) return notFound();

  const expiresAt = Number(expiresAtValue);
  const config = getConfig();
  if (!isValidPreviewAuthSignature(expiresAt, signature, config.secretKey)) return notFound();

  return new Response(null, {
    headers: {
      "cache-control": "no-store",
      location: new URL("/", request.url).toString(),
      "referrer-policy": "no-referrer",
      "set-cookie": sessionCookie(
        createSessionToken(config.adminUsername, config.secretKey),
        !config.debug,
      ),
    },
    status: 303,
  });
};
