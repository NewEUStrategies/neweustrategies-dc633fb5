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
 * mija sama i poświadczenie nadal jest ważne.
 */
export function invalidatesSession(error: unknown): boolean {
  const message = scannerErrorText(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  return (
    head === "invalid_device_token" ||
    head === "device_revoked" ||
    head === "device_inactive" ||
    head === "device_expired"
  );
}

/** Wynik skanu -> klucz nagłówka wyniku (wielki napis na ekranie). */
export function scanOutcomeKey(outcome: string): string {
  const candidate = `eventScanner.outcomes.${camel(outcome)}`;
  return i18n.exists(candidate) ? candidate : "eventScanner.outcomes.unknown";
}
