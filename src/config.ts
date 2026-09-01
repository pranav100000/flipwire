import { z } from "zod";

const optionalText = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);

const databaseUrl = z.string().refine(
  (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
  "DATABASE_URL must be a PostgreSQL URL",
);

const environmentSchema = z.object({
  DATABASE_URL: databaseUrl,
  B2B_API_TOKEN: optionalText,
  B2B_BASE_URL: optionalUrl,
  FLIPWIRE_ADMIN_PASSWORD: z.string().min(12),
  FLIPWIRE_ADMIN_USERNAME: z.string().min(1),
  FLIPWIRE_DEBUG: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  FLIPWIRE_LOG_LEVEL: z
    .string()
    .default("INFO")
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])),
  FLIPWIRE_RAW_STORAGE_ROOT: z.string().min(1),
  FLIPWIRE_SECRET_KEY: z
    .string()
    .min(32, "FLIPWIRE_SECRET_KEY must be at least 32 characters"),
  TICKET_DATA_API_TOKEN: optionalText,
  TICKET_DATA_BASE_URL: optionalUrl,
  TICKPICK_API_TOKEN: optionalText,
  TICKPICK_BASE_URL: optionalUrl,
});

export type Config = Readonly<{
  adminPassword: string;
  adminUsername: string;
  b2bApiToken?: string;
  b2bBaseUrl?: string;
  databaseUrl: string;
  debug: boolean;
  logLevel: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  rawStorageRoot: string;
  secretKey: string;
  ticketDataApiToken?: string;
  ticketDataBaseUrl?: string;
  tickpickApiToken?: string;
  tickpickBaseUrl?: string;
}>;

export const parseConfig = (environment: Readonly<Record<string, string | undefined>>): Config => {
  const parsed = environmentSchema.parse(environment);
  return {
    adminPassword: parsed.FLIPWIRE_ADMIN_PASSWORD,
    adminUsername: parsed.FLIPWIRE_ADMIN_USERNAME,
    ...(parsed.B2B_API_TOKEN ? { b2bApiToken: parsed.B2B_API_TOKEN } : {}),
    ...(parsed.B2B_BASE_URL ? { b2bBaseUrl: parsed.B2B_BASE_URL } : {}),
    databaseUrl: parsed.DATABASE_URL,
    debug: parsed.FLIPWIRE_DEBUG,
    logLevel: parsed.FLIPWIRE_LOG_LEVEL,
    rawStorageRoot: parsed.FLIPWIRE_RAW_STORAGE_ROOT,
    secretKey: parsed.FLIPWIRE_SECRET_KEY,
    ...(parsed.TICKET_DATA_API_TOKEN
      ? { ticketDataApiToken: parsed.TICKET_DATA_API_TOKEN }
      : {}),
    ...(parsed.TICKET_DATA_BASE_URL ? { ticketDataBaseUrl: parsed.TICKET_DATA_BASE_URL } : {}),
    ...(parsed.TICKPICK_API_TOKEN ? { tickpickApiToken: parsed.TICKPICK_API_TOKEN } : {}),
    ...(parsed.TICKPICK_BASE_URL ? { tickpickBaseUrl: parsed.TICKPICK_BASE_URL } : {}),
  };
};

export const getConfig = (): Config => parseConfig(process.env);

export const parseDatabaseUrl = (
  environment: Readonly<Record<string, string | undefined>>,
): string => databaseUrl.parse(environment["DATABASE_URL"]);
