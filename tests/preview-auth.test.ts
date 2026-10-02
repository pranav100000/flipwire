import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as createPreviewSession } from "@/app/__dev/preview-auth/route";
import { readOperatorSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { createPreviewAuthSignature } from "@/lib/preview-auth";

const secret = "preview-auth-route-test-secret-key-32chars";
const previewUrl = "https://3000-preview.preview.runaether.dev/__dev/preview-auth";

const useDevelopmentEnvironment = (): void => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DATABASE_URL", "postgresql://flipwire:flipwire@localhost:5432/flipwire");
  vi.stubEnv("FLIPWIRE_ADMIN_PASSWORD", "local-test-password");
  vi.stubEnv("FLIPWIRE_ADMIN_USERNAME", "operator");
  vi.stubEnv("FLIPWIRE_RAW_STORAGE_ROOT", "/tmp/flipwire-test-raw");
  vi.stubEnv("FLIPWIRE_SECRET_KEY", secret);
};

describe("development preview authentication route", () => {
  beforeEach(() => useDevelopmentEnvironment());
  afterEach(() => vi.unstubAllEnvs());

  it("sets a secure operator session and redirects to the dashboard", () => {
    const expiresAt = Math.floor(Date.now() / 1_000) + 30;
    const signature = createPreviewAuthSignature(expiresAt, secret);
    const response = createPreviewSession(
      new Request(`${previewUrl}?exp=${expiresAt}&sig=${signature}`),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://3000-preview.preview.runaether.dev/");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    const token = cookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    expect(readOperatorSessionToken(token, secret)?.sub).toBe("operator");
  });

  it("rejects malformed or forged bootstrap requests", () => {
    expect(createPreviewSession(new Request(previewUrl)).status).toBe(404);
    expect(createPreviewSession(new Request(`${previewUrl}?exp=bad&sig=forged`)).status).toBe(404);
    expect(createPreviewSession(new Request(`${previewUrl}?exp=1800000000&sig=forged`)).status).toBe(404);
  });

  it("is unavailable outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(createPreviewSession(new Request(previewUrl)).status).toBe(404);
  });
});
