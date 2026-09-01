const securityHeaders = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

export const jsonResponse = (
  body: unknown,
  init: ResponseInit & { readonly noStore?: boolean } = {},
): Response => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  if (init.noStore) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
};

export const noContentResponse = (headers?: HeadersInit): Response => {
  const responseHeaders = new Headers(headers);
  for (const [name, value] of Object.entries(securityHeaders)) responseHeaders.set(name, value);
  return new Response(null, { headers: responseHeaders, status: 204 });
};

export const apiError = (status: number, error: string, message: string): Response =>
  jsonResponse({ error, message }, { status });
