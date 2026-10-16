import type { CeloxC2CCallbackTimeline } from "./types";

// Poll our own inbox (never Celox) so a short interval is safe from 429 rate_limited.
export const C2C_CALLBACK_POLL_INTERVAL_MS = 4_000;

type Options = {
  reference: string;
  /** true = keep polling; false = fetch once and stop. */
  active: boolean;
  onTimeline: (timeline: CeloxC2CCallbackTimeline) => void;
  onError: (error: unknown) => void;
  fetchImpl?: typeof fetch;
  setTimeoutImpl?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutImpl?: (timer: ReturnType<typeof setTimeout>) => void;
};

/**
 * Always makes the initial request, even after the transaction has ended, so a closed
 * transaction still shows the callbacks it received. Uses a chained setTimeout rather
 * than setInterval so slow responses never overlap. Returns a stop function.
 */
export function startC2CCallbackPolling({
  reference,
  active,
  onTimeline,
  onError,
  fetchImpl = fetch,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}: Options): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load() {
    try {
      const response = await fetchImpl(`/api/celox/c2c/${encodeURIComponent(reference)}/events`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("ไม่สามารถอ่าน callback ได้");
      onTimeline(await response.json() as CeloxC2CCallbackTimeline);
    } catch (caught) {
      if (controller.signal.aborted) return;
      onError(caught);
    }
    if (active && !controller.signal.aborted) timer = setTimeoutImpl(() => void load(), C2C_CALLBACK_POLL_INTERVAL_MS);
  }

  void load();
  return () => {
    controller.abort();
    if (timer !== undefined) clearTimeoutImpl(timer);
  };
}
