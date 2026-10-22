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
//
// PODSTAWIANIE W DOKUMENCIE MIESZKA TUTAJ (Z-S5-08, decyzja S8). Podgląd maila
// w edytorze S8 działa w przeglądarce, przy każdej zmianie treści, na próbkach
// (`JOURNEY_VARIABLE_SAMPLES`) - bez sieci i bez danych kontaktu. Żeby pokazał
// DOKŁADNIE to, co wyśle runner, `substituteDocVariables` jest czystym kodem
// tego liścia, a `render.server.ts` tylko go importuje (i re-eksportuje dla
// zgodności). Adresy serwisu (`journeyUrlVariables`) mają tu kopię ścieżek
// runnera - parytet przypina test podglądu S8, a przejście runnera na ten
// import to zgłoszenie do integratora. Server fn podglądu dałaby tę samą
// zgodność kosztem zapytania na każdy znak - odrzucone.
// Moduł nie importuje nic w czasie działania (typy EmailDoc znikają przy
// kompilacji), więc nie ciągnie do klienta niczego z serwera.
import type { EmailBlock, EmailDoc, EmailI18n } from "@/lib/newsletter/emailDoc";

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

/** Wszystkie znaczniki w napisie, bez powtórzeń (podpowiedzi i ostrzeżenia edytora). */
export function journeyVariableTags(text: string): string[] {
  return [...new Set([...text.matchAll(TAG_RE)].map((match) => match[1]))];
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

/**
 * Adresy serwisu najemcy - jedyne zmienne dozwolone w linkach maila. Runner
 * buduje je z `publicFacingOrigin(site_domain)`, podgląd edytora z originu
 * karty; ścieżki są wspólne (test parytetu z `journeysRunner.server.ts`).
 */
export function journeyUrlVariables(origin: string): JourneyVariableValues {
  return {
    site_url: origin,
    pricing_url: `${origin}/pricing`,
    account_url: `${origin}/profile/billing`,
    newsletter_url: `${origin}/profile/notifications`,
  };
}

function sub(value: EmailI18n, vars: JourneyVariableValues, mode: SubstituteMode): EmailI18n {
  return {
    pl: substituteJourneyVariables(value.pl, vars, mode),
    en: substituteJourneyVariables(value.en, vars, mode),
  };
}

function subUrl(value: string | null, vars: JourneyVariableValues): string | null {
  return value === null ? null : substituteJourneyVariables(value, vars, "url");
}

/** Zmienne w dokumencie, pole po polu (tryb wg rodzaju pola - patrz nagłówek). */
export function substituteDocVariables(doc: EmailDoc, vars: JourneyVariableValues): EmailDoc {
  const blocks = doc.blocks.map((block): EmailBlock => {
    switch (block.type) {
      case "heading":
        return { ...block, text: sub(block.text, vars, "text") };
      case "paragraph":
        return { ...block, html: sub(block.html, vars, "html") };
      case "footer-note":
        return { ...block, html: sub(block.html, vars, "html") };
      case "button":
        return {
          ...block,
          label: sub(block.label, vars, "text"),
          url: substituteJourneyVariables(block.url, vars, "url"),
        };
      case "image":
        return {
          ...block,
          url: subUrl(block.url, vars),
          href: subUrl(block.href, vars),
          alt: substituteJourneyVariables(block.alt, vars, "text"),
        };
      case "quote":
        return {
          ...block,
          text: sub(block.text, vars, "text"),
          attribution: sub(block.attribution, vars, "text"),
        };
      case "post-list":
        return { ...block, heading: sub(block.heading, vars, "text") };
      default:
        return block;
    }
  });
  return { ...doc, blocks };
}
