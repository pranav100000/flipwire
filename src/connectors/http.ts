type CollectHttpJsonInput = Readonly<{
  fetcher?: typeof fetch;
  maxRetries: number;
  minimumDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  sourceUrl: string;
  timeoutMs: number;
  token?: string;
}>;

class PermanentHttpError extends Error {}

const defaultSleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const collectHttpJson = async (
  input: CollectHttpJsonInput,
): Promise<Readonly<{ payload: unknown; sourceUrl: string }>> => {
  const fetcher = input.fetcher ?? fetch;
  const sleep = input.sleep ?? defaultSleep;
  let attempt = 0;

  if (input.minimumDelayMs && input.minimumDelayMs > 0) {
    await sleep(input.minimumDelayMs);
  }

  while (attempt <= input.maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetcher(input.sourceUrl, {
        headers: input.token ? { Authorization: `Bearer ${input.token}` } : {},
        signal: controller.signal,
      });
      if (response.ok) {
        const payload: unknown = await response.json();
        return { payload, sourceUrl: input.sourceUrl };
      }
      const isTransient = response.status === 429 || response.status >= 500;
      if (!isTransient) {
        throw new PermanentHttpError(`Source request failed with HTTP ${response.status}`);
      }
      if (attempt === input.maxRetries) {
        throw new Error(`Source request failed with HTTP ${response.status}`);
      }
    } catch (error: unknown) {
      if (error instanceof PermanentHttpError) throw error;
      if (attempt === input.maxRetries) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await sleep(1_000 * 2 ** attempt);
    attempt += 1;
  }
  /* v8 ignore next -- every loop exit returns a payload or throws the final request error */
  throw new Error("Source request exhausted retries");
};
