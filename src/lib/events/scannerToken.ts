// Kształt POŚWIADCZENIA urządzenia skanującego - jedyna część sesji skanera,
// której potrzebuje trasa `/scanner` przed montażem aplikacji.
//
// OSOBNY PLIK, A NIE `scannerSession`. Trasa odrzuca token spoza kształtu już
// w `validateSearch`, a ta opcja - jak `head` i `loader` - należy do
// NIEDZIELONEJ części pliku trasy, czyli jedzie w chunku WEJŚCIOWYM każdej
// strony serwisu. Import ze `scannerSession` ciągnął tam cały parser sesji
// urządzenia, zegar i zakresy (`onsiteEnums`) - dla czytelnika, który skanera
// nigdy nie otworzy (kronika `scripts/check-bundle-size.ts`, wpis XIX).
// `scannerSession` re-eksportuje oba symbole, więc aplikacja skanera ma jedno
// źródło importu.

/** Kształt tokenu wymuszany przez `_event_scanner_device_auth`. */
export const SCANNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isScannerToken(value: string): boolean {
  return SCANNER_TOKEN_PATTERN.test(value.trim());
}
