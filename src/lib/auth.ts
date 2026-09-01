import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { Config } from "@/config";

export const SESSION_COOKIE = "flipwire_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12;

type SessionPayload = Readonly<{
  exp: number;
  sub: string;
}>;

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

export const credentialsAreValid = (
  username: string,
  password: string,
  config: Pick<Config, "adminPassword" | "adminUsername">,
): boolean =>
  timingSafeEqual(digest(username), digest(config.adminUsername)) &&
  timingSafeEqual(digest(password), digest(config.adminPassword));

const sign = (payload: string, secretKey: string): string =>
  createHmac("sha256", secretKey).update(payload).digest("base64url");

export const createSessionToken = (
  username: string,
  secretKey: string,
  now: Date = new Date(),
): string => {
  const payload: SessionPayload = {
    exp: Math.floor(now.getTime() / 1000) + SESSION_DURATION_SECONDS,
    sub: username,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secretKey)}`;
};

const decodeSession = (token: string, secretKey: string, now: Date): SessionPayload | null => {
  const [encoded, providedSignature, extra] = token.split(".");
  if (!encoded || !providedSignature || extra) return null;
  const expectedSignature = sign(encoded, secretKey);
  if (!timingSafeEqual(digest(providedSignature), digest(expectedSignature))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("sub" in parsed) ||
      typeof parsed.sub !== "string" ||
      !("exp" in parsed) ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Math.floor(now.getTime() / 1000)
    ) {
      return null;
    }
    return { exp: parsed.exp, sub: parsed.sub };
  } catch {
    return null;
  }
};

export const readOperatorSessionToken = (
  token: string | undefined,
  secretKey: string,
  now: Date = new Date(),
): SessionPayload | null => (token ? decodeSession(token, secretKey, now) : null);

const readCookie = (cookieHeader: string | null, name: string): string | null => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName === name) return valueParts.join("=");
  }
  return null;
};

export const readOperatorSession = (
  request: Request,
  secretKey: string,
  now: Date = new Date(),
): SessionPayload | null => {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return token ? decodeSession(token, secretKey, now) : null;
};

export const sessionCookie = (token: string, secure: boolean): string =>
  [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_DURATION_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

export const expiredSessionCookie = (secure: boolean): string =>
  [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
