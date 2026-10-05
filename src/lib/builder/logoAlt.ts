// Heurystyka „widget obrazu = logo serwisu” po tekście alternatywnym.
//
// Domyślne seedy powłoki (chromeDefaults.ts) mają `alt = "Logo"` bez `src`, a renderer
// (`mediaWidgets.tsx`) podmienia taki obraz na logo z ustawień motywu. Dawny test
// `/logo/i` łapał też zwykłe słowa zawierające ten ciąg liter: „analogowy”, „ekologowie”,
// „logowanie”, „dialog”, przez co zdjęcie z altem „Zegar analogowy” renderowało się jako
// logo serwisu, a preload LCP (heroImage.ts) i kandydat LCP (lcpCandidate.ts) je pomijały.
//
// Teraz liczy się wyłącznie całe słowo: „logo” (nieodmienne po polsku, także „LOGO”,
// „Logo NES”, „NES-logo”), angielskie „logos” oraz „logotyp”/„logotype” z końcówkami
// („logotypu”, „logotypem”, „logotypes”). Granicą słowa jest każdy znak niebędący literą
// ani cyfrą Unicode, więc polskie litery nie przecinają wyrazu (`\b` bez flagi `u` uznałby
// „ł” za granicę). Trzy miejsca (renderer, preload, kandydat LCP) muszą wołać TEN predykat:
// rozjazd oznaczałby preload innego obrazu niż malowany.

// Bez lookbehind: Safari obsługuje go dopiero od 16.4, a błąd składni wywróciłby cały chunk.
const LOGO_WORD = /(?:^|[^\p{L}\p{N}])(?:logos?|logotyp\p{L}*|logotype\p{L}*)(?![\p{L}\p{N}])/iu;

/** Czy tekst alternatywny oznacza widget obrazu jako logo serwisu (całe słowo, nie fragment). */
export function altMarksLogo(alt: string | null | undefined): boolean {
  return typeof alt === "string" && alt !== "" && LOGO_WORD.test(alt);
}
