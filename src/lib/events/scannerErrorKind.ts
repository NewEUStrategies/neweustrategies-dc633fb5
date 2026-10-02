// JEDNA klasyfikacja odmów płaszczyzny urządzenia - reguła czysta, bez i18n.
//
// DLACZEGO OSOBNY MODUŁ. Odmowę klasyfikowały dwie reguły, które nie wiedziały
// o sobie: tor skanu na żywo (`isRetryableScanError`: każdy kod `kod:` poza
// blokadą czasową jest odmową) i kolejka (`isPermanentFailure`: odmową jest
// tylko kod z ręcznej listy). Rozjeżdżały się na wszystkim spoza listy - kod
// odmowy dołożony w bazie trafiał przy bramce prosto do operatora, a ten sam
// kod w kolejce był ponawiany osiem razy i lądował w „wymaga uwagi" zamiast na
// liście odrzuconych z eksportem. Komunikat bez dwukropka szedł w drugą stronę:
// na żywo do kolejki, w kolejce - jako odmowa trwała. Teraz obie strony pytają
// tę samą funkcję. Moduł nie importuje słownika, więc kolejka (reguła czysta,
// `scannerOutbox.ts`) może z niego korzystać.
//
// REGUŁA. Odmowa z bazy ma ROZPOZNAWALNĄ głowę `kod:` (`RAISE EXCEPTION
// 'invalid_payload: ...'`). Awaria transportu jej nie ma: `TypeError: Failed
// to fetch` (głowa z wielkiej litery), `Failed to fetch` (bez dwukropka),
// `ScannerTimeoutError` („Scanner request timed out"), odpowiedź bramy
// z odstępami w głowie. Z głów rozpoznawalnych trzy klasy są szczególne:
//   * `device_locked`  - blokada czasowa, mija sama: ponawiamy;
//   * `device_inactive` - wstrzymanie w panelu, odwracalne jednym kliknięciem:
//     nie ponawiamy w pętli, ale też nie odrzucamy pozycji;
//   * poświadczenie unieważnione, nieznane albo po terminie - koniec sesji.
// Każda inna rozpoznawalna głowa jest odmową TEJ pozycji: nie zacznie
// przechodzić po dziesiątej próbie.

export type ScanErrorKind = "transport" | "locked" | "paused" | "session" | "refused";

const SESSION_HEADS: ReadonlySet<string> = new Set([
  "invalid_device_token",
  "device_revoked",
  "device_expired",
]);

const CODE = /^[a-z][a-z0-9_]*$/;

export function scannerErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

/** Głowa komunikatu (`kod` z `kod: szczegóły`) - cały komunikat, gdy nie ma dwukropka. */
export function scannerErrorHead(error: unknown): string {
  const message = scannerErrorText(error);
  const separator = message.indexOf(":");
  return (separator === -1 ? message : message.slice(0, separator)).trim();
}

export function scanErrorKind(error: unknown): ScanErrorKind {
  const message = scannerErrorText(error);
  if (message.indexOf(":") === -1) return "transport";
  const head = scannerErrorHead(message);
  if (!CODE.test(head)) return "transport";
  if (head === "device_locked") return "locked";
  if (head === "device_inactive") return "paused";
  if (SESSION_HEADS.has(head)) return "session";
  return "refused";
}

/**
 * Czy ta odmowa unieważnia SESJĘ urządzenia.
 *
 * Token po terminie albo unieważniony nie zadziała po odświeżeniu ekranu, więc
 * zamiast pokazywać komunikat nad działającym skanerem, wyrzucamy operatora do
 * ekranu parowania. Blokada czasowa (`device_locked`) i wstrzymanie w panelu
 * (`device_inactive`) NIE należą do tej klasy: obie mijają, a skasowany
 * jednorazowy token i zrzucona kolejka nie wróciłyby już z ich ustąpieniem.
 */
export function invalidatesSession(error: unknown): boolean {
  return scanErrorKind(error) === "session";
}

/**
 * Czy warto ponowić ten błąd - i czy skan może pójść ścieżką offline.
 * Ponawiamy błędy transportu oraz czasową blokadę urządzenia.
 */
export function isRetryableScanError(error: unknown): boolean {
  const kind = scanErrorKind(error);
  return kind === "transport" || kind === "locked";
}

/**
 * Czy pozycja kolejki z tą odmową ma zejść na listę odrzuconych zamiast
 * czekać na kolejną próbę. Odmowa poświadczenia też jest trwała dla pozycji
 * (wysłanie jej tym samym tokenem nic nie zmieni); wstrzymanie - nie.
 */
export function isPermanentScanError(error: unknown): boolean {
  const kind = scanErrorKind(error);
  return kind === "refused" || kind === "session";
}
