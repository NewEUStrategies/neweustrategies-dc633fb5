// ZMIENNE MAILI ŚCIEŻEK (`{{first_name}}`, `{{plan_name}}`…) - słownik dla
// edytora treści (S8, podpowiedzi) i podstawianie przy wysyłce (runner).
//
// Wartości przychodzą z `journey_contact_for_send` (kontakt, warstwa, wydarzenie,
// klub) i z runnera (adresy serwisu najemcy). Trzy tryby podstawiania, bo
// trzy rodzaje pól EmailDoc mają różne ryzyko:
//   * `html`  - akapit i stopka (HTML ograniczony): wartość ESCAPOWANA - imię
//               „<b>Jan</b>" nie może dopisać znaczników do maila;
//   * `text`  - nagłówek, etykieta przycisku, cytat: wartość surowa, bo
//               renderer EmailDoc sam escapuje tekst (podwójne escapowanie
//               dałoby „&amp;amp;");
//   * `url`   - adres przycisku/obrazka: WYŁĄCZNIE zmienne adresowe serwisu
//               (zaufane, budowane z domeny najemcy); dane kontaktu w adresie
//               byłyby wyciekiem PII do logów proxy i otwartym przekierowaniem.
// Nieznany znacznik zostaje pusty (nie surowy `{{x}}` w mailu do czytelnika).

export const JOURNEY_VARIABLES = [
  { key: "first_name", kind: "contact" },
  { key: "last_name", kind: "contact" },
  { key: "site_name", kind: "site" },
  { key: "plan_name", kind: "context" },
  { key: "event_title", kind: "context" },
  { key: "club_name", kind: "context" },
  { key: "trial_ends_at", kind: "context" },
  { key: "site_url", kind: "url" },
  { key: "pricing_url", kind: "url" },
  { key: "account_url", kind: "url" },
  { key: "newsletter_url", kind: "url" },
] as const;
export type JourneyVariableKey = (typeof JOURNEY_VARIABLES)[number]["key"];
export type JourneyVariableKind = (typeof JOURNEY_VARIABLES)[number]["kind"];

export const JOURNEY_VARIABLE_KEYS: readonly JourneyVariableKey[] = JOURNEY_VARIABLES.map(
  (v) => v.key,
);
const URL_KEYS: ReadonlySet<string> = new Set(
  JOURNEY_VARIABLES.filter((v) => v.kind === "url").map((v) => v.key),
);

export type JourneyVariableValues = Partial<Record<JourneyVariableKey, string | null>>;
export type SubstituteMode = "html" | "text" | "url";

const TAG_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Podstawia `{{klucz}}` wg trybu pola (patrz nagłówek). */
export function substituteJourneyVariables(
  text: string,
  values: JourneyVariableValues,
  mode: SubstituteMode,
): string {
  return text.replace(TAG_RE, (_match, key: string) => {
    if (mode === "url" && !URL_KEYS.has(key)) return "";
    const value = (values as Record<string, string | null | undefined>)[key] ?? "";
    return mode === "html" ? escapeHtml(value) : value;
  });
}

/** Znaczniki spoza słownika (walidacja treści w edytorze). */
export function unknownJourneyVariables(text: string): string[] {
  const known = new Set<string>(JOURNEY_VARIABLE_KEYS);
  const unknown = new Set<string>();
  for (const match of text.matchAll(TAG_RE)) {
    if (!known.has(match[1])) unknown.add(match[1]);
  }
  return [...unknown];
}

/** Przykładowe wartości podglądu edytora (bez danych realnego kontaktu). */
export const JOURNEY_VARIABLE_SAMPLES: Readonly<Record<"pl" | "en", JourneyVariableValues>> = {
  pl: {
    first_name: "Anna",
    last_name: "Kowalska",
    site_name: "New European Strategies",
    plan_name: "Członkostwo",
    event_title: "Forum strategiczne",
    club_name: "Klub dyskusyjny",
    trial_ends_at: "24.10.2026",
  },
  en: {
    first_name: "Anna",
    last_name: "Kowalska",
    site_name: "New European Strategies",
    plan_name: "Membership",
    event_title: "Strategy forum",
    club_name: "Discussion club",
    trial_ends_at: "24 Oct 2026",
  },
};
