// Reguły normalizacji list w HTML buildera - JEDNO źródło dla dwóch silników:
//   * `normalizeRichHtml.ts` - node-html-parser, render serwerowy (Worker SSR),
//   * `normalizeRichHtmlDom.ts` - natywny parser przeglądarki (`<template>`).
// Parser HTML (~47 KB gzip) nie jedzie do przeglądarki, a reguły nie mogą się
// rozjechać: poprawka listy nośników albo klasy rzędu ikon trafia tutaj, więc
// działa w obu runtime'ach naraz. Ten moduł NIE MOŻE niczego importować -
// siedzi w grafie klienta obok bliźniaka DOM.

/** Szybki odsiew: HTML bez `<ul>`/`<ol>` wraca bajtowo nietknięty, bez parsera. */
export const LIST_MARKUP = /<(?:ul|ol)\b/i;

export const LIST_TAGS = new Set(["UL", "OL"]);

/**
 * Punkt listy bez tekstu zostaje, gdy niesie link albo nośnik (rząd ikon
 * social, zagnieżdżona lista, osadzenie). Znany brak: `svg`, `picture`,
 * `object`, `embed`, `canvas`, `input` (defekt w `normalizeRichHtml.test.ts`).
 */
export const LIST_ITEM_KEEPERS = "a[href], ul, ol, img, iframe, video, audio, button";

/** Klasa rzędu ikon (lista samych linków bez tekstu) - styl w `src/styles.css`. */
export const SOCIAL_LIST_CLASS = "cms-social-list";

/** Sufit przebiegów: każdy przebieg tylko usuwa lub spłaszcza, więc to bezpiecznik. */
export const MAX_PASSES = 20;

/** Tekst bez treści: same białe znaki, `&nbsp;` albo `<br>`. */
export function isBlankListText(text: string | null | undefined): boolean {
  return (text ?? "").replace(/\u00a0/g, "").trim().length === 0;
}
