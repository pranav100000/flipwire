import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const logProcessEvent = (
  level: "error" | "info" | "warn",
  event: string,
  details: Readonly<Record<string, boolean | number | string>> = {},
): void => {
  const output = JSON.stringify({ event, level, timestamp: new Date().toISOString(), ...details });
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
};

export const isMainModule = (moduleUrl: string): boolean => {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && moduleUrl === pathToFileURL(entrypoint).href;
};

export const runUntilStopped = async (input: {
  readonly intervalMs: number;
  readonly runOnce: () => Promise<void>;
  readonly signal: AbortSignal;
}): Promise<void> => {
  while (!input.signal.aborted) {
    await input.runOnce();
    try {
      await delay(input.intervalMs, undefined, { signal: input.signal });
    } catch (error) {
      if (!input.signal.aborted) throw error;
    }
  }
};
