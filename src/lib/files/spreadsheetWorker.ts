import type { SheetResult } from "./officeParse";
import {
  SPREADSHEET_MAX_BYTES,
  type SpreadsheetOp,
  type SpreadsheetRequest,
  type SpreadsheetResponse,
  type SpreadsheetBook,
  type SpreadsheetResults,
  type SpreadsheetRowsOptions,
  type WritableCell,
} from "./spreadsheetProtocol";

/**
 * Termin na odpowiedź procesu. Podgląd dotyczy CUDZEGO pliku z załącznika, więc
 * ma krótki termin - zawieszony parser nie może trzymać karty czytelnika.
 * Import i eksport przerabiają plik samego redaktora albo operatora i bywają
 * duże (tysiące leadów), więc dostają więcej czasu.
 */
const TIMEOUT_MS: Record<SpreadsheetOp, number> = {
  preview: 10_000,
  rows: 30_000,
  write: 30_000,
};

/** Odmowa procesu bez szczegółów - komunikat biblioteki nie trafia do UI. */
const FAILURE: Record<SpreadsheetOp, string> = {
  preview: "spreadsheet:preview-unavailable",
  rows: "spreadsheet:read-failed",
  write: "spreadsheet:write-failed",
};

function callSpreadsheetWorker<Op extends SpreadsheetOp>(
  request: SpreadsheetRequest & { op: Op },
  signal?: AbortSignal,
): Promise<SpreadsheetResults[Op]> {
  if ("buffer" in request && request.buffer.byteLength > SPREADSHEET_MAX_BYTES) {
    return Promise.reject(new Error("spreadsheet:file-limit"));
  }
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./spreadsheet.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = (outcome: { result: SpreadsheetResults[Op] } | { error: Error }) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.result);
    };
    const abort = () => finish({ error: new DOMException("Aborted", "AbortError") });
    const timer = setTimeout(
      () => finish({ error: new Error("spreadsheet:timeout") }),
      TIMEOUT_MS[request.op],
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish({ error: new Error("spreadsheet:worker-failed") });
    worker.onmessage = (event: MessageEvent<SpreadsheetResponse<Op>>) => {
      if (event.data.ok) finish({ result: event.data.result });
      else finish({ error: new Error(FAILURE[request.op]) });
    };
    // Keep the caller's buffer intact for React StrictMode effect replay.
    worker.postMessage(request);
  });
}

/** Podgląd załącznika (klub): ograniczony HTML każdego arkusza. */
export function runSpreadsheetWorker(
  buffer: ArrayBuffer,
  signal?: AbortSignal,
): Promise<SheetResult[]> {
  return callSpreadsheetWorker({ op: "preview", buffer }, signal);
}

/**
 * Surowe komórki arkuszy. Tryb importu wykresu (procent · 100, błąd jako
 * tekst, HTML bez zgadywania typów, limity z liczbami pominiętych) włącza
 * WYŁĄCZNIE `chartImport: true` - patrz `SpreadsheetRowsOptions`; bez niego
 * proces czyta tak jak przed wprowadzeniem trybu.
 */
export function readSpreadsheetRowsInWorker(
  buffer: ArrayBuffer,
  options: SpreadsheetRowsOptions & { signal?: AbortSignal } = {},
): Promise<SpreadsheetBook> {
  const request: SpreadsheetRequest & { op: "rows" } =
    options.chartImport === true
      ? { op: "rows", buffer, chartImport: true }
      : { op: "rows", buffer };
  return callSpreadsheetWorker(request, options.signal);
}

/** Eksport: jeden arkusz z wierszy do bajtów pliku `.xlsx`. */
export function writeSpreadsheetInWorker(
  sheetName: string,
  rows: readonly (readonly WritableCell[])[],
): Promise<ArrayBuffer> {
  return callSpreadsheetWorker({ op: "write", sheetName, rows: rows.map((row) => [...row]) });
}
