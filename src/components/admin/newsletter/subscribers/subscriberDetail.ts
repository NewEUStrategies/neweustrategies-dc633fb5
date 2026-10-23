// Reguły odczytu szczegółów subskrybenta - warstwa CZYSTA.
//
// Kolumny `consents` i `meta` są w bazie typu `jsonb`, więc ich typem jest
// `Json` - a to znaczy także napis, liczba i tablica napisów. Wpisują je
// integracje i formularze, nie tylko nasz kod. Odczyt musi więc ZAWĘŻAĆ jawnie:
// element, który nie jest obiektem, ma być POMINIĘTY, a nie wyrenderowany jako
// puste pole - bo puste pole w kolumnie „zgoda" odpowiada po cichu „nie" na
// pytanie, czy ta osoba zgodziła się na marketing.
//
// Funkcje przeniesione z `SubscriberDetailDialog` bez zmiany zachowania.
import type { Json } from "@/integrations/supabase/types";
import {
  EMAIL_MEASUREMENT_DECLARED_KEY,
  normalizeConsentKey,
} from "@/lib/newsletter/measurementConsentText";

/** Wpis zgody w kształcie, w jakim czyta go widok szczegółów. */
export interface Consent {
  key?: string;
  text?: string;
  given?: boolean;
  lang?: string;
  at?: string;
}

/** Napis albo `undefined` - bez rzutowania, bo `Json` bywa liczbą i tablicą. */
export function jsonStr(value: Json | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Lista zgód z kolumny `consents`.
 *
 * Zgoda jest UDZIELONA wyłącznie przy jawnym `true` - „truthy" nie wystarcza,
 * bo ładunek `{"given": "no"}` z obcej integracji zapisałby zgodę, której nie
 * ma.
 */
export function readConsents(raw: Json): Consent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    return [
      {
        key: jsonStr(entry["key"]),
        text: jsonStr(entry["text"]),
        given: entry["given"] === true,
        lang: jsonStr(entry["lang"]),
        at: jsonStr(entry["at"]),
      },
    ];
  });
}

/**
 * Stan wpisu zgody, jaki pokazuje okno:
 *   * `declared` - DEKLARACJA pola pomiaru z formularza
 *     (`email_measurement_declared`, I9d-Y2b R1.8): zaznaczone pole to nie
 *     zgoda - zgodę na pomiar zapisuje dopiero potwierdzenie właściciela
 *     skrzynki w rejestrze zgód, więc „✓ udzielona" byłoby nieprawdą;
 *   * `given` - zgoda udzielona (jawne `true`);
 *   * `missing` - brak zgody albo nieczytelny ładunek.
 */
export type ConsentEntryState = "given" | "declared" | "missing";

export function consentEntryState(consent: Consent): ConsentEntryState {
  if (!consent.given) return "missing";
  return consent.key !== undefined &&
    normalizeConsentKey(consent.key) === EMAIL_MEASUREMENT_DECLARED_KEY
    ? "declared"
    : "given";
}

/** Pary `klucz -> wartość` z kolumny `meta` (też `jsonb`, więc też nie obiekt z definicji). */
export function readMeta(raw: Json): [string, string][] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  return Object.entries(raw).map(([key, value]) => [key, value === undefined ? "" : String(value)]);
}

/** Znacznik czasu w formacie lokalnym; brak i wartość nieparsowalna dają kreskę. */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}
