// ODCINKI TREŚCI ZGÓD - WSPÓLNY LIŚĆ (I9d-Y2b, decyzja właściciela 2026-10-23,
// wariant (b): każda zgoda ma osobne pole).
//
// Treść zgody (na newsletter, na pomiar otwarć i kliknięć, akceptacja
// polityki prywatności w popupie) żyje w kodzie jako ODCINKI: tekst albo link
// wewnętrzny serwisu. Z tych samych odcinków powstają:
//   * HTML - DOKŁADNIE literał SQL (dowód w rejestrze zgód, test parytetu),
//   * tekst bez znaczników (mail, czytniki bez HTML),
//   * widok React bez `innerHTML` (`ConsentSegmentsText`).
//
// MODUŁ CZYSTY I LIŚĆ: bez Reacta, bez I/O, bez importów - czytają go chunki
// czytelnika (formularze publiczne), serwer i panel.

export type ConsentLang = "pl" | "en";

/** Odcinek treści: tekst albo link (adres wewnętrzny serwisu i etykieta). */
export type ConsentSegment = string | { readonly href: string; readonly label: string };

/** Języki treści zgód (kolejność stała - PL pierwszy jak w SQL). */
export const CONSENT_LANGS: readonly ConsentLang[] = ["pl", "en"];

/**
 * Język wiersza subskrybenta -> język treści zgody. Lustro SQL
 * `CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END` (pisarz zgody na
 * pomiar zapisuje treść w tym języku): ekran, który pokazuje treść do
 * zapisu, musi wybrać język tą samą regułą.
 */
export function consentLangOf(language: string | null | undefined): ConsentLang {
  return language === "en" ? "en" : "pl";
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

/** Odcinki -> HTML (escape `& < > "`; link jako `<a href="…">…</a>`). */
export function segmentsHtml(segments: readonly ConsentSegment[]): string {
  return segments
    .map((part) =>
      typeof part === "string"
        ? escapeHtml(part)
        : `<a href="${escapeHtml(part.href)}">${escapeHtml(part.label)}</a>`,
    )
    .join("");
}

/** Odcinki -> tekst bez znaczników (link = sama etykieta). */
export function segmentsPlain(segments: readonly ConsentSegment[]): string {
  return segments.map((part) => (typeof part === "string" ? part : part.label)).join("");
}
