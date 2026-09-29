// Odmowy płaszczyzny urządzenia -> zdanie dla OPERATORA BRAMKI.
//
// INNY ODBIORCA, INNY TON. Przy bramce stoi wolontariusz z kolejką za plecami,
// a nie administrator z panelem. „Poświadczenie unieważnione - poproś
// organizatora o nowy kod" mówi, co zrobić w piętnaście sekund; „violates
// check constraint" nie mówi nic i kosztuje telefon do biura.
//
// WYNIK SKANU NIE JEST BŁĘDEM. `unknown_code`, `wrong_event` i odmowy wejścia
// wracają jako POPRAWNA odpowiedź RPC, nie jako wyjątek - i tak je pokazujemy,
// wielkim kolorem na ekranie, a nie czerwonym powiadomieniem awarii. Wyjątki
// zostają dla poświadczenia i sieci.
import i18n from "@/lib/i18n";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

const PREFIX = "eventScanner.errors.";

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

export function scannerErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

/** Pełny klucz i18n odmowy - zawsze istnieje, w najgorszym razie `...unknown`. */
export function scannerErrorKey(error: unknown): string {
  ensureScannerI18n();
  const message = scannerErrorText(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return `${PREFIX}unknown`;
  const candidate = `${PREFIX}${camel(head)}`;
  return i18n.exists(candidate) ? candidate : `${PREFIX}unknown`;
}

export function scannerErrorMessage(error: unknown): string {
  return i18n.t(scannerErrorKey(error));
}

/**
 * Czy ta odmowa unieważnia SESJĘ urządzenia.
 *
 * Token po terminie albo unieważniony nie zadziała po odświeżeniu ekranu, więc
 * zamiast pokazywać komunikat nad działającym skanerem, wyrzucamy operatora do
 * ekranu parowania. Blokada czasowa (`device_locked`) NIE należy do tej listy:
 * mija sama i poświadczenie nadal jest ważne. Wstrzymanie w panelu
 * (`device_inactive`) też nie: administrator wznawia urządzenie jednym
 * kliknięciem, a skasowany jednorazowy token i zrzucona kolejka nie wróciłyby
 * już z tym wznowieniem.
 */
export function invalidatesSession(error: unknown): boolean {
  const message = scannerErrorText(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  return head === "invalid_device_token" || head === "device_revoked" || head === "device_expired";
}

/**
 * Czy warto ponowić ten błąd - i czy skan może pójść ścieżką offline.
 *
 * Odmowa z bazy niesie ROZPOZNAWALNY prefiks (`invalid_payload:`,
 * `checkpoint_not_found:` …). Awaria sieci nie niesie żadnego - `fetch` rzuca
 * `TypeError: Failed to fetch`, a przekroczenie terminu `ScannerTimeoutError`
 * bez prefiksu. Ponawiamy błędy transportu oraz czasową blokadę urządzenia;
 * po ustąpieniu blokady ten sam skan może być ponownie wysłany.
 */
export function isRetryableScanError(error: unknown): boolean {
  const message = scannerErrorText(error);
  const separator = message.indexOf(":");
  if (separator === -1) return true;
  const head = message.slice(0, separator).trim();
  return head === "device_locked" || !/^[a-z][a-z0-9_]*$/.test(head);
}

/** Głowa komunikatu (`kod` z `kod: szczegóły`) - pusta, gdy jej nie ma. */
export function scannerErrorHead(error: unknown): string {
  const message = scannerErrorText(error);
  const separator = message.indexOf(":");
  return (separator === -1 ? message : message.slice(0, separator)).trim();
}

/** Wynik skanu -> klucz nagłówka wyniku (wielki napis na ekranie). */
export function scanOutcomeKey(outcome: string): string {
  const candidate = `eventScanner.outcomes.${camel(outcome)}`;
  return i18n.exists(candidate) ? candidate : "eventScanner.outcomes.unknown";
}
