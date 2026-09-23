import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readSpreadsheetRowsInWorker,
  runSpreadsheetWorker,
  writeSpreadsheetInWorker,
} from "../spreadsheetWorker";
import type { SpreadsheetRequest } from "../spreadsheetProtocol";

class FakeWorker {
  static latest: FakeWorker;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage = vi.fn<(message: SpreadsheetRequest) => void>();
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
    FakeWorker.latest.onmessage?.({ data: { ok: true, result: sheets } });
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
  it("asks the worker for a preview and reports a refusal without library details", async () => {
    const buffer = new ArrayBuffer(8);
    const promise = runSpreadsheetWorker(buffer);
    expect(FakeWorker.latest.postMessage).toHaveBeenCalledWith({ op: "preview", buffer });
    FakeWorker.latest.onmessage?.({ data: { ok: false } });
    await expect(promise).rejects.toThrow("spreadsheet:preview-unavailable");
  });
  it("rejects an oversized file before starting a worker", async () => {
    await expect(runSpreadsheetWorker(new ArrayBuffer(20 * 1024 * 1024 + 1))).rejects.toThrow(
      "spreadsheet:file-limit",
    );
    await expect(
      readSpreadsheetRowsInWorker(new ArrayBuffer(20 * 1024 * 1024 + 1)),
    ).rejects.toThrow("spreadsheet:file-limit");
  });
  it("does not start a worker for an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runSpreadsheetWorker(new ArrayBuffer(8), controller.signal)).rejects.toMatchObject(
      { name: "AbortError" },
    );
  });
});

describe("chart import through the same worker", () => {
  it("sends the file bytes and returns the raw rows of every sheet", async () => {
    const buffer = new ArrayBuffer(8);
    const promise = readSpreadsheetRowsInWorker(buffer);
    expect(FakeWorker.latest.postMessage).toHaveBeenCalledWith({ op: "rows", buffer });
    const result = [
      {
        name: "Data",
        rows: [
          ["Country", "Value"],
          ["PL", 42],
        ],
      },
    ];
    FakeWorker.latest.onmessage?.({ data: { ok: true, result } });
    await expect(promise).resolves.toEqual(result);
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("gives a large import more time than an untrusted preview", async () => {
    const promise = readSpreadsheetRowsInWorker(new ArrayBuffer(8));
    let settled = false;
    promise.catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    const assertion = expect(promise).rejects.toThrow("spreadsheet:timeout");
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it("reports an unreadable workbook as a read failure", async () => {
    const promise = readSpreadsheetRowsInWorker(new ArrayBuffer(8));
    FakeWorker.latest.onmessage?.({ data: { ok: false } });
    await expect(promise).rejects.toThrow("spreadsheet:read-failed");
  });
});

describe("lead export through the same worker", () => {
  it("sends a copy of the rows, so the caller can keep editing its own table", async () => {
    const rows = [
      ["Name", "Email"],
      ["Ewa", "ewa@example.com"],
    ];
    const promise = writeSpreadsheetInWorker("Leady", rows);
    const posted = FakeWorker.latest.postMessage.mock.calls[0]?.[0];
    expect(posted).toEqual({ op: "write", sheetName: "Leady", rows });
    if (posted?.op !== "write") throw new Error("worker nie dostał zlecenia zapisu");
    expect(posted.rows).not.toBe(rows);
    expect(posted.rows[0]).not.toBe(rows[0]);
    const bytes = new ArrayBuffer(4);
    FakeWorker.latest.onmessage?.({ data: { ok: true, result: bytes } });
    await expect(promise).resolves.toBe(bytes);
  });
  it("reports a failed write as a write failure", async () => {
    const promise = writeSpreadsheetInWorker("Leads", [["x"]]);
    FakeWorker.latest.onmessage?.({ data: { ok: false } });
    await expect(promise).rejects.toThrow("spreadsheet:write-failed");
  });
});
