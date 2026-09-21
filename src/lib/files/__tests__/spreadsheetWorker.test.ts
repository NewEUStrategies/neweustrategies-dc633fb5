import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpreadsheetWorker } from "../spreadsheetWorker";

class FakeWorker {
  static latest: FakeWorker;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("spreadsheet worker lifecycle", () => {
  it("terminates after success and releases its timer", async () => {
    const promise = runSpreadsheetWorker(new ArrayBuffer(8));
    const sheets = [{ name: "Data", html: "<table></table>", rows: 0 }];
    FakeWorker.latest.onmessage?.({ data: { ok: true, sheets } });
    await expect(promise).resolves.toEqual(sheets);
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a decoder that does not respond", async () => {
    const controller = new AbortController();
    const promise = runSpreadsheetWorker(new ArrayBuffer(8), controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("enforces the deadline even when the parser is stuck", async () => {
    const promise = runSpreadsheetWorker(new ArrayBuffer(8));
    const assertion = expect(promise).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it("cleans up on a decoder error", async () => {
    const promise = runSpreadsheetWorker(new ArrayBuffer(8));
    FakeWorker.latest.onerror?.();
    await expect(promise).rejects.toThrow("worker-failed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
