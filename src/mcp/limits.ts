import { AppError } from "../validation/strings.js";

const MAX_PAYLOAD_BYTES = 1_000_000; // 1 MB per tool call argument

// At most maxRequests calls start per window. A burst over that waits for its
// slot instead of failing: a client that sends many calls at once (pipelined)
// got most of them rejected. Only a backlog longer than maxWaitMs is refused.
export class RateLimiter {
  // Start times given out, in order; some may lie in the future
  private slots: number[] = [];
  constructor(
    private maxRequests: number,
    private windowMs: number,
    private maxWaitMs: number,
    // Aborted when the client goes away: calls still waiting then don't run,
    // as their answers could no longer be sent (they used to run unanswered)
    private signal?: AbortSignal
  ) {}

  async acquire(): Promise<void> {
    // Monotonic: with Date.now() setting the clock back an hour locked every
    // tool out for that hour
    const now = performance.now();
    while (this.slots.length > 0 && this.slots[0] <= now - this.windowMs) this.slots.shift();
    const start =
      this.slots.length < this.maxRequests
        ? now
        : Math.max(now, this.slots[this.slots.length - this.maxRequests] + this.windowMs);
    const wait = start - now;
    if (wait > this.maxWaitMs) {
      throw new AppError(
        `Rate limit exceeded (${this.maxRequests} calls per second). Try again in ${Math.ceil((wait - this.maxWaitMs) / 1000)} s.`
      );
    }
    this.slots.push(start);
    if (wait > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, wait);
        function done() {
          clearTimeout(timer);
          resolve();
        }
        this.signal?.addEventListener("abort", done, { once: true });
      });
    }
    if (this.signal?.aborted) throw new AppError("The client disconnected before this call's turn.");
  }
}

// Measures the text in a tool call's arguments: every string, in UTF-8.
// (JSON.stringify would count every backslash and quote in them twice.)
function payloadBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf-8");
  if (Array.isArray(value)) return value.reduce((sum: number, v) => sum + payloadBytes(v), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((sum: number, v) => sum + payloadBytes(v), 0);
  return 0;
}

export function checkPayloadSize(args: unknown): void {
  const bytes = payloadBytes(args);
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new AppError(`Request payload too large (${bytes} bytes, max ${MAX_PAYLOAD_BYTES})`);
  }
}
