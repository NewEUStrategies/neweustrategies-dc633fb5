// Kształt POŚWIADCZENIA urządzenia skanującego - jedyna część sesji skanera,
// której potrzebuje trasa `/scanner` przed montażem aplikacji.
//
// OSOBNY PLIK, A NIE `scannerSession`. Trasa odrzucała token spoza kształtu
// w `validateSearch` - opcji z NIEDZIELONEJ części pliku trasy, czyli z chunku
// WEJŚCIOWEGO każdej strony serwisu. Import ze `scannerSession` ciągnął tam
// cały parser sesji urządzenia, zegar i zakresy (`onsiteEnums`) - dla
// czytelnika, który skanera nigdy nie otworzy (kronika
// `scripts/check-bundle-size.ts`, wpis XIX). Od OPS-07 token jedzie we
// fragmencie i czyta go `scannerLink.ts` w komponencie trasy (`validateSearch`
// już nie ma), a z kształtu korzysta też panel organizatora - lekki moduł bez
// zależności zostaje. `scannerSession` re-eksportuje oba symbole, więc
// aplikacja skanera ma jedno źródło importu.

/** Kształt tokenu wymuszany przez `_event_scanner_device_auth`. */
export const SCANNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isScannerToken(value: string): boolean {
  return SCANNER_TOKEN_PATTERN.test(value.trim());
}
