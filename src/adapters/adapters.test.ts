import { InMemoryQueue } from "./InMemoryQueue";
import { NoopPersistenceAdapter } from "./NoopPersistenceAdapter";

describe("InMemoryQueue", () => {
  it("enqueues and dequeues items FIFO (same priority)", async () => {
    const q = new InMemoryQueue();
    await q.enqueue("https://a.com", { depth: 0 });
    await q.enqueue("https://b.com", { depth: 0 });

    const first = await q.dequeue();
    expect(first?.url).toBe("https://a.com");

    const second = await q.dequeue();
    expect(second?.url).toBe("https://b.com");
  });

  it("returns null when empty", async () => {
    const q = new InMemoryQueue();
    expect(await q.dequeue()).toBeNull();
  });

  it("honours priority (higher priority first)", async () => {
    const q = new InMemoryQueue();
    await q.enqueue("https://low.com", { priority: 1 });
    await q.enqueue("https://high.com", { priority: 10 });

    const first = await q.dequeue();
    expect(first?.url).toBe("https://high.com");
  });

  it("ack removes from in-flight", async () => {
    const q = new InMemoryQueue();
    await q.enqueue("https://a.com");
    const item = await q.dequeue();
    expect(q.inFlightSize).toBe(1);
    await q.ack(item!.id);
    expect(q.inFlightSize).toBe(0);
  });

  it("requeue puts item back in queue", async () => {
    const q = new InMemoryQueue();
    await q.enqueue("https://a.com");
    const item = await q.dequeue();
    expect(q.size).toBe(0);
    await q.requeue(item!.id);
    expect(q.size).toBe(1);
  });

  it("includes depth in dequeued item", async () => {
    const q = new InMemoryQueue();
    await q.enqueue("https://a.com", { depth: 3 });
    const item = await q.dequeue();
    expect(item?.depth).toBe(3);
  });
});

describe("NoopPersistenceAdapter", () => {
  const adapter = new NoopPersistenceAdapter();

  it("tryClaim returns true", async () => {
    expect(await adapter.tryClaim("https://example.com")).toBe(true);
  });

  it("getOrCreateCanonical returns empty string", async () => {
    expect(await adapter.getOrCreateCanonical("some title")).toBe("");
  });

  it("saveItem returns void without error", async () => {
    const result = await adapter.saveItem({
      title: "Test",
      locations: ["https://example.com/file"],
    });
    expect(result).toBeUndefined();
  });

  it("findPendingByParsedTitle returns empty array", async () => {
    const result = await adapter.findPendingByParsedTitle?.("test");
    expect(result).toEqual([]);
  });
});
