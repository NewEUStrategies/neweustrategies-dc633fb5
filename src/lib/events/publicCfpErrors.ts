// Odmowy bazy w NABORZE PRELEGENTÓW -> zdanie po ludzku (strona zgłoszenia,
// panel prelegenta, panel recenzenta).
//
// TA SAMA MECHANIKA, CO W POZOSTAŁYCH MAPACH MODUŁU: klucz siedzi w głowie
// komunikatu plpgsql (`limit_reached: at most 2 submissions per person`),
// liczby z ogona wchodzą do interpolacji (`{{count}}`), a nieznana głowa
// wraca jako `unknown` - uczestnik nie czyta `23514` ani nazwy ograniczenia.
//
// RDZEŃ `mapCfpFailure` JEST WSPÓLNY Z MAPĄ PANELU (`adminCfpErrors`). Panel
// może importować moduł publiczny; odwrotnie nie - słownik panelu nie trafia do
// chunku strony publicznej.
import i18n from "@/lib/i18n";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

export type CfpErrorParams = Record<string, string | number>;

export interface CfpFailure {
  /** Pełny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: CfpErrorParams;
}

/** `limit_reached` -> `limitReached`. Słownik camelCase, baza snake_case. */
function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

function paramsOf(tail: string): CfpErrorParams {
  const numbers = tail.match(/\d+/g) ?? [];
  const out: CfpErrorParams = {};
  if (numbers[0] !== undefined) out.count = Number(numbers[0]);
  if (numbers[1] !== undefined) out.total = Number(numbers[1]);
  return out;
}

/** Rdzeń obu map: głowa komunikatu -> `prefix + camelCase`, inaczej `unknown`. */
export function mapCfpFailure(prefix: string, error: unknown): CfpFailure {
  const message = messageOf(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  const tail = separator === -1 ? "" : message.slice(separator + 1);
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return { key: `${prefix}unknown`, params: {} };
  const candidate = `${prefix}${camel(head)}`;
  if (!i18n.exists(candidate)) return { key: `${prefix}unknown`, params: {} };
  return { key: candidate, params: paramsOf(tail) };
}

export function publicCfpFailure(error: unknown): CfpFailure {
  // Bez rejestracji nakładki `i18n.exists()` odpowiada „nie ma" na każdy klucz.
  ensureEventCfpI18n();
  return mapCfpFailure("eventCfp.errors.", error);
}

/** Gotowe zdanie dla toasta i komunikatu formularza. */
export function publicCfpErrorMessage(error: unknown): string {
  const failure = publicCfpFailure(error);
  return i18n.t(failure.key, failure.params);
}
