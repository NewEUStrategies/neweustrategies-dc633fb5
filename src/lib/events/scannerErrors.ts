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
//
// KLASYFIKACJA ODMÓW mieszka w `scannerErrorKind.ts` (reguła czysta, bez
// słownika) - tu jest re-eksportowana, żeby tor na żywo i kolejka pytały TĘ
// SAMĄ funkcję, a dotychczasowi importerzy nie musieli zmieniać ścieżki.
import i18n from "@/lib/i18n";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";
import { scannerErrorHead } from "@/lib/events/scannerErrorKind";

export {
  invalidatesSession,
  isRetryableScanError,
  scannerErrorHead,
  scannerErrorText,
} from "@/lib/events/scannerErrorKind";

const PREFIX = "eventScanner.errors.";

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

/** Pełny klucz i18n odmowy - zawsze istnieje, w najgorszym razie `...unknown`. */
export function scannerErrorKey(error: unknown): string {
  ensureScannerI18n();
  const head = scannerErrorHead(error);
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return `${PREFIX}unknown`;
  const candidate = `${PREFIX}${camel(head)}`;
  return i18n.exists(candidate) ? candidate : `${PREFIX}unknown`;
}

export function scannerErrorMessage(error: unknown): string {
  return i18n.t(scannerErrorKey(error));
}

/** Wynik skanu -> klucz nagłówka wyniku (wielki napis na ekranie). */
export function scanOutcomeKey(outcome: string): string {
  const candidate = `eventScanner.outcomes.${camel(outcome)}`;
  return i18n.exists(candidate) ? candidate : "eventScanner.outcomes.unknown";
}
