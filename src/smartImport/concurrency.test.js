import { describe, it, expect, vi } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  it("returns results in the original item order regardless of completion order", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const fn = vi.fn(async (item) => {
      const delayMs = item % 2 === 0 ? 0 : 5; // odd items resolve slower than even ones
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return item * 10;
    });
    const results = await mapWithConcurrency(items, 3, fn);
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it("never runs more than `limit` calls concurrently", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    const fn = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });
    await mapWithConcurrency(items, 3, fn);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(fn).toHaveBeenCalledTimes(10);
  });

  it("handles an empty array without error", async () => {
    const fn = vi.fn();
    const results = await mapWithConcurrency([], 5, fn);
    expect(results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("caps concurrency at the item count when limit exceeds it", async () => {
    const items = [1, 2];
    const fn = vi.fn(async (item) => item);
    const results = await mapWithConcurrency(items, 10, fn);
    expect(results).toEqual([1, 2]);
  });

  it("passes both the item and its index to fn", async () => {
    const items = ["a", "b", "c"];
    const fn = vi.fn(async (item, index) => `${item}-${index}`);
    const results = await mapWithConcurrency(items, 2, fn);
    expect(results).toEqual(["a-0", "b-1", "c-2"]);
  });

  it("propagates an exception thrown by fn to the caller", async () => {
    const items = [1, 2, 3];
    const fn = async (item) => {
      if (item === 2) throw new Error("boom");
      return item;
    };
    await expect(mapWithConcurrency(items, 2, fn)).rejects.toThrow("boom");
  });
});
