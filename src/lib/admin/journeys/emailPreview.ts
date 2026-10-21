// PODGLĄD MAILA ŚCIEŻKI W PRZEGLĄDARCE (S8, Z-S5-08) - to, co dostanie odbiorca.
//
// DECYZJA Z-S5-08. `substituteDocVariables` mieszkało w `render.server.ts`, więc
// edytor S8 miał dwa wyjścia: server fn podglądu albo kod kliencki. Wybraliśmy
// kod kliencki BEZ KOPII: czysta część podstawiania przeszła do liścia
// `src/lib/journeys/variables.ts`, a `render.server.ts` ją importuje - podgląd
// i wysyłka wołają TEN SAM kod. Podgląd odświeża się przy każdej zmianie
// treści bez zapytania do serwera i bez danych kontaktu.
//
// CO JEST WSPÓLNE Z WYSYŁKĄ (runner -> `journey_contact_for_send` ->
// `renderJourneyEmail`), krok po kroku:
//   * pola treści jak po zapisie (`admin_journey_email_content_save` przycina
//     napisy, puste EN i preheadery zapisuje jako NULL);
//   * język: angielski tylko wtedy, gdy jest temat EN - inaczej kontakt
//     anglojęzyczny dostaje wersję polską (`fallbackLocale`, licznik
//     `fallbackLocale` w statystykach);
//   * temat i preheader: zmienne w trybie tekstu i przycięcie; treść:
//     `substituteDocVariables` + `renderEmailHtml(…, { postsByBlock: {} })`;
//   * kolejność błędów `doc_invalid` -> `subject_empty` -> `doc_empty` - te
//     same powody `delivery_not_ready`, z którymi runner wstrzyma krok;
//   * obudowa HTML (krój, szerokość, ukryty preheader) - test parytetu
//     porównuje wynik ZNAK W ZNAK z `renderJourneyEmail` bez wiadomości.
// CZEGO PODGLĄD NIE MA: przekierowań pomiaru kliknięć i piksela (wysyłka dokłada
// je z identyfikatorem wiadomości) ani stopki wypisu - jej podwójne wystąpienie
// sprawdza M3 (Z-S5-05), więc podgląd jej nie obiecuje.
//
// DANE: wyłącznie `JOURNEY_VARIABLE_SAMPLES` (zero PII) i adresy serwisu
// z originu karty (`journeyUrlVariables` - te same ścieżki co runner).
// SANITIZER: przeglądarka czyści akapity DOMPurify, serwer - walkerem SSR
// (`src/lib/sanitize.ts`), z tą samą listą dozwolonych znaczników; test
// parytetu biegnie na jednym silniku, więc pilnuje NASZEGO kodu, nie silników.
//
// Moduł czysty (bez Reacta), importowany przez edytor maila (S8.3c).
import { parseEmailDoc, type EmailDoc } from "@/lib/newsletter/emailDoc";
import { renderEmailHtml } from "@/lib/newsletter/renderEmailHtml";
import {
  JOURNEY_VARIABLES,
  JOURNEY_VARIABLE_SAMPLES,
  escapeHtml,
  journeyUrlVariables,
  journeyVariableTags,
  substituteDocVariables,
  substituteJourneyVariables,
  unknownJourneyVariables,
  type JourneyVariableValues,
} from "@/lib/journeys/variables";

export type JourneyPreviewLang = "pl" | "en";

/** Treść wariantu maila w kształcie edytora (`JourneyEmailContentDto` bez metadanych). */
export interface JourneyEmailPreviewContent {
  subjectPl: string;
  subjectEn: string | null;
  preheaderPl: string | null;
  preheaderEn: string | null;
  doc: unknown;
}

/** Powody, z którymi runner wstrzyma krok (`delivery_not_ready`). */
export type JourneyEmailPreviewError = "doc_invalid" | "subject_empty" | "doc_empty";

export interface JourneyEmailPreviewOptions {
  /** Język odbiorcy, którego oczami oglądamy maila. */
  lang: JourneyPreviewLang;
  /** Origin serwisu (`window.location.origin`) - adresy `{{site_url}}` i pokrewne. */
  origin: string;
  /** Nadpisanie próbek (testy parytetu); domyślnie próbki języka wysyłki. */
  vars?: JourneyVariableValues;
}

interface PreviewBase {
  /** Język, w którym mail faktycznie wyjdzie. */
  locale: JourneyPreviewLang;
  /** Prośba o EN bez tematu EN - wyjdzie wersja polska. */
  fallbackLocale: boolean;
}

export type JourneyEmailPreview =
  | (PreviewBase & {
      ok: true;
      subject: string;
      /** Preheader po podstawieniu (pusty = mail bez preheadera). */
      preheader: string;
      /** Treść z obudową - jak `renderJourneyEmail` bez wiadomości. */
      html: string;
    })
  | (PreviewBase & { ok: false; error: JourneyEmailPreviewError });

/**
 * Obudowa treści - kopia z `renderJourneyEmail` (`render.server.ts`). Kolor
 * tekstu to część maila (klient poczty nie zna tokenów motywu), nie panelu.
 * Rozjazd z serwerem oblewa test parytetu `emailPreview.test.ts`.
 */
const EMAIL_SHELL_STYLE =
  "font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:640px;margin:0 auto";
const PREHEADER_STYLE = "display:none;max-height:0;overflow:hidden;mso-hide:all";

/** Napis po zapisie: przycięty, a pusty jako NULL (jak RPC zapisu treści). */
function stored(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** Treść w kształcie, w jakim przeczyta ją wysyłka (patrz `stored`). */
export function storedEmailContent(content: JourneyEmailPreviewContent): JourneyEmailPreviewContent {
  return {
    subjectPl: (content.subjectPl ?? "").trim(),
    subjectEn: stored(content.subjectEn),
    preheaderPl: stored(content.preheaderPl),
    preheaderEn: stored(content.preheaderEn),
    doc: content.doc,
  };
}

/**
 * Język wysyłki: lustro `journey_contact_for_send` - EN wyłącznie z tematem
 * EN (NULL po zapisie), inaczej PL z flagą `fallbackLocale`.
 */
export function previewLocale(
  content: Pick<JourneyEmailPreviewContent, "subjectEn">,
  lang: JourneyPreviewLang,
): PreviewBase {
  if (lang === "en" && stored(content.subjectEn) === null) {
    return { locale: "pl", fallbackLocale: true };
  }
  return { locale: lang, fallbackLocale: false };
}

/** Próbki języka wysyłki + adresy serwisu z originu karty. */
export function previewVariables(locale: JourneyPreviewLang, origin: string): JourneyVariableValues {
  return { ...JOURNEY_VARIABLE_SAMPLES[locale], ...journeyUrlVariables(origin) };
}

/** Podgląd jednego wariantu maila w języku odbiorcy (patrz nagłówek). */
export function journeyEmailPreview(
  content: JourneyEmailPreviewContent,
  options: JourneyEmailPreviewOptions,
): JourneyEmailPreview {
  const saved = storedEmailContent(content);
  const base = previewLocale(saved, options.lang);
  const vars = options.vars ?? previewVariables(base.locale, options.origin);

  const doc: EmailDoc | null = parseEmailDoc(saved.doc);
  if (!doc) return { ...base, ok: false, error: "doc_invalid" };
  const rawSubject = base.locale === "en" ? (saved.subjectEn ?? "") : saved.subjectPl;
  const subject = substituteJourneyVariables(rawSubject, vars, "text").trim();
  if (!subject) return { ...base, ok: false, error: "subject_empty" };
  const body = renderEmailHtml(substituteDocVariables(doc, vars), base.locale, {
    postsByBlock: {},
  });
  if (!body) return { ...base, ok: false, error: "doc_empty" };

  const rawPreheader = base.locale === "en" ? saved.preheaderEn : saved.preheaderPl;
  const preheader = rawPreheader
    ? substituteJourneyVariables(rawPreheader, vars, "text").trim()
    : "";
  const preheaderHtml = preheader
    ? `<div style="${PREHEADER_STYLE}">${escapeHtml(preheader)}</div>`
    : "";
  return {
    ...base,
    ok: true,
    subject,
    preheader,
    html: `<div style="${EMAIL_SHELL_STYLE}">${preheaderHtml}${body}</div>`,
  };
}

/**
 * Dokument ramki podglądu (`<iframe srcDoc>`), wzór `CampaignContentBuilder`.
 * Ramka bez skryptów - `sandbox` ustawia komponent.
 */
export function journeyEmailPreviewDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:16px">${html}</body></html>`;
}

const URL_VARIABLES: ReadonlySet<string> = new Set(
  JOURNEY_VARIABLES.filter((v) => v.kind === "url").map((v) => v.key),
);

/** Pola adresowe dokumentu - te podstawia się w trybie `url`. */
function urlFields(doc: EmailDoc): string[] {
  return doc.blocks.flatMap((block) => {
    if (block.type === "button") return [block.url];
    if (block.type === "image") return [block.url ?? "", block.href ?? ""];
    return [];
  });
}

export interface JourneyEmailVariableIssues {
  /** Znaczniki spoza słownika - w wysyłce będą puste. */
  unknown: string[];
  /** Znane zmienne NIEADRESOWE w adresach (dane kontaktu) - w wysyłce puste. */
  blankInUrls: string[];
}

/**
 * Ostrzeżenia edytora o zmiennych w OBU językach (temat, preheader, cały
 * dokument). Niezależne od języka podglądu - redaktor poprawia wszystko naraz.
 */
export function journeyEmailVariableIssues(
  content: JourneyEmailPreviewContent,
): JourneyEmailVariableIssues {
  const texts = [
    content.subjectPl,
    content.subjectEn ?? "",
    content.preheaderPl ?? "",
    content.preheaderEn ?? "",
    JSON.stringify(content.doc ?? null),
  ];
  const unknown = new Set(texts.flatMap((text) => unknownJourneyVariables(text)));
  const doc = parseEmailDoc(content.doc);
  const known = new Set<string>(JOURNEY_VARIABLES.map((v) => v.key));
  const blankInUrls = new Set(
    (doc ? urlFields(doc) : [])
      .flatMap((url) => journeyVariableTags(url))
      .filter((key) => known.has(key) && !URL_VARIABLES.has(key)),
  );
  return { unknown: [...unknown].sort(), blankInUrls: [...blankInUrls].sort() };
}

/** Zdania błędów podglądu (słownik `i18n-admin-journeys-editor`). */
export const JOURNEY_PREVIEW_ERROR_KEY: Readonly<Record<JourneyEmailPreviewError, string>> = {
  doc_invalid: "adminJourneys.editor.preview.error.doc_invalid",
  subject_empty: "adminJourneys.editor.preview.error.subject_empty",
  doc_empty: "adminJourneys.editor.preview.error.doc_empty",
};

/** Adnotacje podglądu: próbki, język zastępczy, ostrzeżenia o zmiennych. */
export const JOURNEY_PREVIEW_NOTE_KEY = {
  samples: "adminJourneys.editor.preview.samples",
  fallbackLocale: "adminJourneys.editor.preview.fallbackLocale",
  unknownVariables: "adminJourneys.editor.preview.unknownVariables",
  blankInUrls: "adminJourneys.editor.preview.urlVariables",
} as const;
