/**
 * Per-host throttle map.
 *
 * Tracks the next time we are allowed to send a request to each hostname.
 * This enforces a minimum delay between requests to the same host (politeness).
 */
export class HostThrottle {
  private nextAllowedAt = new Map<string, number>();
  private readonly delayMs: number;

  constructor(delayMs = 500) {
    this.delayMs = delayMs;
  }

  /**
   * Wait until the per-host delay has elapsed, then register a new request.
   */
  async wait(hostname: string): Promise<void> {
    const now = Date.now();
    const next = this.nextAllowedAt.get(hostname) ?? 0;
    const waitMs = Math.max(0, next - now);

    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }

    this.nextAllowedAt.set(hostname, Date.now() + this.delayMs);
  }
}
