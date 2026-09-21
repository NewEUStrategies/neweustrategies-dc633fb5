import type { SheetResult } from "./officeParse";

type WorkerResult = { ok: true; sheets: SheetResult[] } | { ok: false };
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export function runSpreadsheetWorker(
  buffer: ArrayBuffer,
  signal?: AbortSignal,
): Promise<SheetResult[]> {
  if (buffer.byteLength > MAX_BYTES) return Promise.reject(new Error("spreadsheet:file-limit"));
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./spreadsheet.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = (result?: SheetResult[], error?: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result ?? []);
    };
    const abort = () => finish(undefined, new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(undefined, new Error("spreadsheet:timeout")), TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(undefined, new Error("spreadsheet:worker-failed"));
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      if (event.data.ok) finish(event.data.sheets);
      else finish(undefined, new Error("spreadsheet:preview-unavailable"));
    };
    // Keep the caller's buffer intact for React StrictMode effect replay.
    worker.postMessage(buffer);
  });
}
