// Mapowanie lokalizacji routera na typ strony systemu reklamowego.
// SiteChrome przekazuje wynik do <Header/> (baner nagłówka) - dzięki temu
// placementy zawężone do typu strony (home/archiwum/kategoria/tag/szukajka/
// wpis/strona) renderują się wszędzie tam, gdzie je zadeklarowano, a nie
// wyłącznie te z page_type="all" (stan sprzed tej poprawki).
import type { AdPageType } from "./types";

/** Zdejmuje prefiks językowy (/en) - typ strony jest niezależny od języka. */
function stripLangPrefix(pathname: string): string {
  if (pathname === "/en" || pathname === "/en/") return "/";
  return pathname.startsWith("/en/") ? pathname.slice(3) : pathname;
}

/**
 * Typ strony dla bieżącej lokalizacji. `contentKind` pochodzi z loadera trasy
 * catch-all ($.tsx zwraca kind: "post" | "page") - ścieżki nie da się
 * rozstrzygnąć samym URL-em, bo wpisy i strony żyją pod dowolnymi splatami.
 */
export function adPageTypeForLocation(
  pathname: string,
  contentKind: "post" | "page" | null,
): AdPageType {
  const path = stripLangPrefix(pathname);
  if (path === "/") return "home";
  if (path === "/blog" || path.startsWith("/blog/")) return "archive";
  if (path === "/publications" || path.startsWith("/publications/")) return "archive";
  if (path.startsWith("/category/")) return "category";
  if (path.startsWith("/tag/")) return "tag";
  if (path === "/search" || path.startsWith("/search/")) return "search";
  if (contentKind === "post") return "post";
  if (contentKind === "page") return "page";
  return "all";
}
