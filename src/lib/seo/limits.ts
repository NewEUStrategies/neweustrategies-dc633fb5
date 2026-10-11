// Limity pól SEO - JEDNO źródło dla edytorów (liczniki, `maxLength`), walidatora
// panelu i schematu zapisu na serwerze. Wcześniej panel trzymał 160/320,
// serwer te same liczby jako literały, a kafel przeglądu wpisu pokazywał
// „/ 60" i „/ 160" - trzy różne odpowiedzi na pytanie „ile mogę wpisać".
// Widoczny limit musi być limitem zapisu (AGENTS.md), więc wszyscy czytają stąd.
//
// To są limity TWARDE (przechowywanie). O tym, co Google pokaże w wyniku,
// decyduje budżet PIKSELOWY z `serp.ts` (tytuł ~600 px, opis ~960 px) - stąd
// ostrzeżenie „zostanie ucięty" przy tekście, który mieści się w limicie znaków.

/** Twardy limit tytułu SEO (`seo_title_pl/en`). */
export const SEO_TITLE_MAX_CHARS = 160;
/** Twardy limit opisu meta (`seo_description_pl/en`). */
export const SEO_DESCRIPTION_MAX_CHARS = 320;
/** Twardy limit zajawki (`excerpt_pl/en`) - źródło opisu wyprowadzonego. */
export const CONTENT_EXCERPT_MAX_CHARS = 1000;
