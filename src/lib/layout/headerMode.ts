// Który pasek jest właścicielem górnej krawędzi ekranu na danej trasie.
//
// Platforma ma DWA paski nagłówka i tylko jeden z nich może być przyklejony do
// górnej krawędzi:
//
//   "sticky-shrink" - <Header> jest `sticky top-0` i zwija się na scrollu
//                     (.site-header-shrink). Domyślne dla home, archiwów,
//                     stron statycznych, profilu itd.
//   "reading"       - <Header> zostaje w układzie (`relative`) i wyjeżdża z
//                     ekranu, bo po ~320 px przewinięcia górną krawędź
//                     przejmuje <ReadingHeader> (pasek czytania wpisu).
//
// DLACZEGO TO ISTNIEJE: gdy oba paski są przyklejone jednocześnie, pasek
// czytania (z-30, `fixed`) chowa się CAŁKOWICIE pod mobilnym paskiem headera
// (z-9998) - jego akcje ("Zapisz na później", motyw) stają się niedostępne, a
// zwijanie headera trzyma `.site-header-chrome` w układzie o 1/scale szerszym
// niż viewport (patrz styles.css), co na iOS Safari pozwala przesuwać stronę w
// bok. Rozstrzygnięcie trybu w JEDNYM miejscu jest więc warunkiem obu rzeczy:
// widoczności paska czytania i braku poziomego przesuwania.
//
// UWAGA na wykrywanie wpisu: kanoniczny adres wpisu to `<ścieżka-rodzica>/<slug>`
// obsługiwany przez trasę catch-all (`/post/<slug>` tylko przekierowuje 301),
// więc po ścieżce NIE da się rozpoznać wpisu. Źródłem prawdy jest `kind` z
// loaderData dopasowanej trasy - SiteChrome czyta je i podaje tutaj.
import { stripLangPrefix } from "@/lib/i18n/localePath";

/** Rodzaj treści rozpoznany przez loader trasy (`$.tsx`). */
export type ContentKind = "post" | "page" | null;

export type HeaderMode = "sticky-shrink" | "reading";

export interface HeaderModeInput {
  /** Aktualna ścieżka (z prefiksem języka lub bez). */
  pathname: string;
  /** `kind` z loaderData dopasowanej trasy, gdy dostępne. */
  contentKind?: ContentKind;
}

/**
 * Ścieżki legacy `/post/<slug>` (również w wariancie `/en/post/<slug>`).
 * Trasa tylko przekierowuje, ale zanim to zrobi renderuje chrome - bez tej
 * gałęzi pierwsza klatka miałaby dwa przyklejone paski.
 */
function isLegacyPostPath(pathname: string): boolean {
  const { pathname: internal } = stripLangPrefix(pathname);
  return internal === "/post" || internal.startsWith("/post/");
}

/**
 * Czy na tej trasie górną krawędź przejmuje pasek czytania wpisu.
 * Czysta funkcja - jedyne źródło decyzji dla <Header> i testów.
 */
export function isReadingSurface({ pathname, contentKind }: HeaderModeInput): boolean {
  return contentKind === "post" || isLegacyPostPath(pathname);
}

export function resolveHeaderMode(input: HeaderModeInput): HeaderMode {
  return isReadingSurface(input) ? "reading" : "sticky-shrink";
}
