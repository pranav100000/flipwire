import { z } from "zod";

import { getConfig } from "@/config";
import { getDatabase } from "@/db/client";
import { readOperatorSession } from "@/lib/auth";
import { apiError, jsonResponse } from "@/lib/http";
import {
  enqueueManualJob,
  IdempotencyKeyReusedError,
  SourceAlreadyQueuedError,
} from "@/services/jobs";

const requestSchema = z.object({
  artist: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  source: z.enum(["ticket_data", "tickpick", "b2b"]),
  url: z.url().optional(),
});

export const POST = async (request: Request): Promise<Response> => {
  const config = getConfig();
  if (!readOperatorSession(request, config.secretKey)) {
    return apiError(
      401,
      "UNAUTHENTICATED",
      "Valid FlipWire operator credentials are required.",
    );
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return apiError(403, "ORIGIN_REJECTED", "Manual runs must originate from the FlipWire dashboard.");
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return apiError(400, "MISSING_IDEMPOTENCY_KEY", "Idempotency-Key is required.");
  }
  const body: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return apiError(422, "INVALID_REQUEST", "Manual run parameters are invalid.");
  const { source } = parsed.data;
  const scope = {
    ...(parsed.data.artist ? { artist: parsed.data.artist } : {}),
    ...(parsed.data.eventId ? { eventId: parsed.data.eventId } : {}),
    ...(parsed.data.url ? { url: parsed.data.url } : {}),
  };

  try {
    const queued = await enqueueManualJob({
      database: getDatabase(config.databaseUrl),
      idempotencyKey,
      scope,
      source,
    });
    return jsonResponse(
      {
        data: {
          id: queued.job.id,
          scope: queued.job.scope,
          source: queued.job.source,
          status: queued.job.status,
        },
      },
      { status: queued.replayed ? 200 : 202 },
    );
  } catch (error: unknown) {
    if (error instanceof IdempotencyKeyReusedError) {
      return apiError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "That idempotency key was already used with different parameters.",
      );
    }
    if (error instanceof SourceAlreadyQueuedError) {
      return apiError(409, "SOURCE_ALREADY_QUEUED", "That source already has active work.");
    }
    throw error;
  }
};
