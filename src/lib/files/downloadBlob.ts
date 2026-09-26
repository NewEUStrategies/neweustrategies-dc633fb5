// Pobieranie pliku zbudowanego w przeglądarce (PDF faktury i certyfikatu,
// `.ics` planu, CSV wyników ankiety) - bez wychodzenia ze strony.
//
// ZWOLNIENIE ADRESU PO CHWILI, NIE OD RAZU. `URL.revokeObjectURL` zaraz po
// `click()` bywa szybsze niż start pobierania: Safari i część Chromium na
// Androidzie gubią wtedy plik (pobranie „nieudane" albo pusta karta). Sekunda
// zwłoki wystarcza, żeby przeglądarka przejęła strumień, a adres i tak nie
// żyje dłużej, niż musi.
//
// Moduł współdzielony przez billing (`InvoiceLedgerCard`) i wydarzenia -
// dlatego mieszka w `lib/files`, a nie w żadnym z nich.

/** Po tylu milisekundach zwalniamy adres `blob:` (patrz komentarz wyżej). */
export const OBJECT_URL_REVOKE_DELAY_MS = 1000;

/** Znacznik kolejności bajtów UTF-8 - Excel bez niego czyta CSV jako Windows-1250. */
const UTF8_BOM = "﻿";

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
}

/** Plik z danych base64 (odpowiedź funkcji serwerowej). */
export function downloadBase64File(base64: string, fileName: string, mimeType: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  downloadBlob(new Blob([bytes], { type: mimeType }), fileName);
}

/** PDF z base64 - faktura, certyfikat. */
export function downloadBase64Pdf(base64: string, fileName: string): void {
  downloadBase64File(base64, fileName, "application/pdf");
}

/**
 * Plik tekstowy (`.ics`, `.csv`). `withBom` dokleja BOM UTF-8 - potrzebny dla
 * CSV otwieranego w Excelu; kalendarzom i parserom szkodzi, więc domyślnie brak.
 */
export function downloadTextFile(
  text: string,
  fileName: string,
  mimeType: string,
  withBom = false,
): void {
  downloadBlob(new Blob([withBom ? UTF8_BOM + text : text], { type: mimeType }), fileName);
}
