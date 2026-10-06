import { createPreviewAuthSignature, PREVIEW_AUTH_TTL_SECONDS } from "@/lib/preview-auth";

type PreviewHookInput = Readonly<{
  port: number;
  preview_origin: string;
  sibling_origins: Record<string, string>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseOrigin = (value: unknown): URL => {
  if (typeof value !== "string") throw new Error("Preview origins must be strings.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Preview origins must be credential-free HTTPS origins.");
  }
  return url;
};

const parseInput = (value: unknown): PreviewHookInput => {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["port", "preview_origin", "sibling_origins"].includes(key)) ||
    value["port"] !== 3000 ||
    typeof value["sibling_origins"] !== "object" ||
    value["sibling_origins"] === null ||
    Array.isArray(value["sibling_origins"])
  ) {
    throw new Error("Expected the Aether preview hook input for port 3000.");
  }

  parseOrigin(value["preview_origin"]);
  for (const [port, origin] of Object.entries(value["sibling_origins"])) {
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
      throw new Error("Sibling origin keys must be valid ports.");
    }
    parseOrigin(origin);
  }

  return value as PreviewHookInput;
};

const main = async (): Promise<void> => {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }

  let inputText = "";
  for await (const chunk of process.stdin) {
    inputText += chunk.toString();
    if (Buffer.byteLength(inputText) > 64 * 1_024) throw new Error("Preview hook input is too large.");
  }

  const input = parseInput(JSON.parse(inputText) as unknown);
  const secretKey = process.env["FLIPWIRE_SECRET_KEY"];
  if (!secretKey || secretKey.length < 32) throw new Error("FLIPWIRE_SECRET_KEY is unavailable.");

  const expiresAt = Math.floor(Date.now() / 1_000) + PREVIEW_AUTH_TTL_SECONDS;
  const bootstrapUrl = new URL("/__dev/preview-auth", parseOrigin(input.preview_origin));
  bootstrapUrl.searchParams.set("exp", String(expiresAt));
  bootstrapUrl.searchParams.set("sig", createPreviewAuthSignature(expiresAt, secretKey));

  process.stdout.write(`${JSON.stringify({ url: bootstrapUrl.toString() })}\n`);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Preview authentication failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
