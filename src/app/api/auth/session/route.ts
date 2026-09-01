import { z } from "zod";

import { getConfig } from "@/config";
import {
  createSessionToken,
  credentialsAreValid,
  expiredSessionCookie,
  sessionCookie,
} from "@/lib/auth";
import { apiError, noContentResponse } from "@/lib/http";

const loginSchema = z.object({
  password: z.string(),
  username: z.string(),
});

export const POST = async (request: Request): Promise<Response> => {
  const body: unknown = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return apiError(422, "INVALID_REQUEST", "Username and password are required.");

  const config = getConfig();
  if (!credentialsAreValid(parsed.data.username, parsed.data.password, config)) {
    return apiError(401, "UNAUTHENTICATED", "The username or password is incorrect.");
  }

  const token = createSessionToken(parsed.data.username, config.secretKey);
  return noContentResponse({
    "set-cookie": sessionCookie(token, !config.debug),
  });
};

export const DELETE = (): Response =>
  noContentResponse({ "set-cookie": expiredSessionCookie(!getConfig().debug) });
