import { createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_AUTH_TTL_SECONDS = 60;

const signatureMessage = (expiresAt: number): string => `flipwire-preview-auth:v1:${expiresAt}`;

export const createPreviewAuthSignature = (expiresAt: number, secretKey: string): string =>
  createHmac("sha256", secretKey).update(signatureMessage(expiresAt)).digest("base64url");

export const isValidPreviewAuthSignature = (
  expiresAt: number,
  signature: string,
  secretKey: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): boolean => {
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= nowSeconds ||
    expiresAt > nowSeconds + PREVIEW_AUTH_TTL_SECONDS ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    return false;
  }

  const provided = Buffer.from(signature, "base64url");
  const expected = Buffer.from(createPreviewAuthSignature(expiresAt, secretKey), "base64url");
  return timingSafeEqual(provided, expected);
};
