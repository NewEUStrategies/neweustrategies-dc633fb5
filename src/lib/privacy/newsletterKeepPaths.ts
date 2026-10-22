// Adresy linku „Chcę dalej otrzymywać" (wygaszanie newslettera, I9d-Y1).
//
// Osobny liść BEZ zależności: czyta go publiczna strona `/newsletter/keep`
// (chunk czytelnika - bez zod i stałych retencji) oraz serwer, który buduje
// link w mailu (`newsletterSunset.ts` re-eksportuje oba adresy).

/** Publiczny endpoint linku (GET: walidacja/303, POST: potwierdzenie). */
export const NEWSLETTER_KEEP_API_PATH = "/api/public/newsletter/keep";
/** Strona z przyciskiem, na którą GET z przeglądarki robi 303. */
export const NEWSLETTER_KEEP_PAGE_PATH = "/newsletter/keep";
