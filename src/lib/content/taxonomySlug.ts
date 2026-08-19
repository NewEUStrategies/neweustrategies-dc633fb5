// Pure slug generator for inline taxonomy (category / tag) creation in the post
// editor. Lowercases, transliterates stroke letters and ligatures that Unicode
// does NOT decompose (see `replaceStrokeLetters`), decomposes to NFD and strips
// the resulting combining diacritic marks (via the `\p{Diacritic}` Unicode
// property), collapses any run of non-alphanumerics to a single dash, trims
// leading / trailing dashes and caps the result at 80 chars. Framework-free and
// side-effect-free so it can be unit tested in isolation.
//
// KOLEJNOSC KROKOW JEST ISTOTNA: transliteracja idzie PRZED normalizacja i przed
// zamiana reszty na dywizy - po nich „l z przekresleniem" jest juz dywizem i nie
// ma czego transliterowac. Do 18.08 tego kroku tu nie bylo i slug ZJADAL te
// litere: „Lodz" dawalo `odz`.
import { replaceStrokeLetters } from "@/lib/text/strokeLetters";

export function slugifyTaxonomy(s: string): string {
  return replaceStrokeLetters(s.toLowerCase())
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Wersja "do pisania w polu": jak slugifyTaxonomy, ale zachowuje końcowy dywiz,
 * żeby wpisywanie kolejnych wyrazów nie było blokowane przy każdym spacji.
 */
export function normalizeSlugInput(s: string): string {
  return replaceStrokeLetters(s.toLowerCase())
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 80);
}
