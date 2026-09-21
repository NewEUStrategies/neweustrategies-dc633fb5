import { decodeSpreadsheet } from "./spreadsheetCore";

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ ok: true, sheets: decodeSpreadsheet(event.data) });
  } catch {
    self.postMessage({ ok: false });
  }
};
