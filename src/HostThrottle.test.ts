import { HostThrottle } from "./HostThrottle";

describe("HostThrottle", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("serializes concurrent waits for the same host", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    const throttle = new HostThrottle(100);
    let firstDone = false;
    let secondDone = false;

    const first = throttle.wait("example.com").then(() => {
      firstDone = true;
    });
    const second = throttle.wait("example.com").then(() => {
      secondDone = true;
    });

    await Promise.resolve();
    expect(firstDone).toBe(true);
    expect(secondDone).toBe(false);

    await jest.advanceTimersByTimeAsync(99);
    expect(secondDone).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(secondDone).toBe(true);

    await Promise.all([first, second]);
  });
});
