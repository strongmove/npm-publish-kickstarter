import type { QueueAdapter, QueueItem } from "../types";

/**
 * Simple FIFO in-memory queue for development and testing.
 * Not suitable for production distributed workloads — use a Redis/BullMQ
 * adapter for horizontal scaling.
 */
export class InMemoryQueue implements QueueAdapter {
  private pending: QueueItem[] = [];
  private inFlight = new Map<string, QueueItem>();
  private counter = 0;

  private insertPending(item: QueueItem): void {
    const itemPriority = item.priority ?? 0;
    const insertAt = this.pending.findIndex(
      (candidate) => (candidate.priority ?? 0) < itemPriority
    );

    if (insertAt === -1) {
      this.pending.push(item);
      return;
    }

    this.pending.splice(insertAt, 0, item);
  }

  async enqueue(
    url: string,
    opts: { priority?: number; depth?: number } = {}
  ): Promise<void> {
    const id = String(++this.counter);
    this.insertPending({
      id,
      url,
      priority: opts.priority ?? 0,
      depth: opts.depth ?? 0,
    });
  }

  async dequeue(): Promise<QueueItem | null> {
    const item = this.pending.shift() ?? null;
    if (item) {
      this.inFlight.set(item.id, item);
    }
    return item;
  }

  async ack(itemId: string): Promise<void> {
    this.inFlight.delete(itemId);
  }

  async requeue(itemId: string, opts: { delay?: number } = {}): Promise<void> {
    const item = this.inFlight.get(itemId);
    if (!item) return;
    this.inFlight.delete(itemId);

    const reEnqueue = () => {
      this.insertPending(item);
    };

    if (opts.delay && opts.delay > 0) {
      setTimeout(reEnqueue, opts.delay);
    } else {
      reEnqueue();
    }
  }

  /** Return the number of items currently in the queue (for testing). */
  get size(): number {
    return this.pending.length;
  }

  /** Return the number of items currently in-flight (for testing). */
  get inFlightSize(): number {
    return this.inFlight.size;
  }
}
