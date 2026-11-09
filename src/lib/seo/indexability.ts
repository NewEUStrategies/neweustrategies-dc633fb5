// POLITYKA INDEKSOWALNOŚCI Z KODU - jedno wejście dla powierzchni maszynowych
// (mapa XML), które decydują, czy adres wolno zgłosić wyszukiwarce.
//
// PO CO OSOBNY MODUŁ. Reguły „ten adres nigdy nie jest indeksowalny, bez
// względu na flagę w bazie" mieszkają w trzech miejscach domeny SEO: trasy
// kodowe z `noindex` (`noindexCodeRoutes.ts`), strony techniczne CMS-a
// (`utilityPages.ts`) i treść testowa (`testContent.ts`). Kolektor mapy
// (`lib/server/sitemapEntries.server.ts`) należy do rdzenia platformy, a bramka
// `platformCoreBoundary.gate.test.ts` nie pozwala rdzeniowi zyskiwać importów
// domen. Rdzeń pyta więc o JEDNĄ politykę, a nie o każdą regułę z osobna -
// dopisanie kolejnej reguły zmienia ten plik, nie graf zależności rdzenia.
import { isNoindexCodeRoutePath } from "./noindexCodeRoutes";
import { isTestContentSlug } from "./testContent";
import { isUtilityPagePath } from "./utilityPages";

/**
 * Czy strona CMS pod tą ścieżką jest wyłączona z indeksu przez kod: pod jej
 * adresem renderuje się trasa kodowa z `noindex` (`/login`, `/club`) albo
 * jest to strona techniczna (`/customize-interests`, `/koszyk`).
 */
export function pagePathExcludedFromIndex(path: string): boolean {
  return isNoindexCodeRoutePath(path) || isUtilityPagePath(path);
}

/** Czy wydarzenie o tym slugu jest treścią testową (`test-*`/`e2e-*`) - zawsze `noindex`. */
export function eventSlugExcludedFromIndex(slug: string | null | undefined): boolean {
  return isTestContentSlug(slug);
}
