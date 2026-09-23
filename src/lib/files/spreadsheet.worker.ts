import { handleSpreadsheetRequest } from "./spreadsheetCore";
import type { SpreadsheetRequest, SpreadsheetResponse } from "./spreadsheetProtocol";

self.onmessage = (event: MessageEvent<SpreadsheetRequest>) => {
  let response: SpreadsheetResponse;
  try {
    response = { ok: true, result: handleSpreadsheetRequest(event.data) };
  } catch {
    response = { ok: false };
  }
  self.postMessage(response);
};
