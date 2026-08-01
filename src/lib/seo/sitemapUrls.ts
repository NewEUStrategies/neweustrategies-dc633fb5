// Kanonizacja adresów w sitemapie + linkowanie językowe (PL/EN).
//
// Sitemapa nie może reklamować URL-i, które serwer i tak przekieruje: crawler
// traci budżet, a raport GSC zapełnia się "Strona z przekierowaniem". Ten moduł
// przepuszcza każdy adres przez ten sam indeks reguł, którego używa middleware
// (`matchRedirectForPath`), więc sitemapa zawsze publikuje docelowy, kanoniczny
// adres - i pomija to, co zostało wycofane (410) albo prowadzi poza serwis.
//
// Drugie zadanie: pełne linkowanie językowe. Każdy kanoniczny dokument dostaje
// osobny wpis <url> na wariant językowy (PL bez prefiksu, EN pod /en), a każdy
// wpis nosi kompletny klaster hreflang (x-default + wszystkie języki),
// wskazujący na adresy PO przekierowaniach - dokładnie tak, jak wymaga tego
// specyfikacja hreflang (linkowanie wzajemne i self-referencing).
import {
  DEFAULT_LANG,
  SUPPORTED_LANGS,
  isLocalizablePath,
  localizedPath,
  stripLangPrefix,
  type AppLang,
} from "@/lib/i18n/localePath";
import { matchRedirectForPath, type RedirectIndex } from "@/lib/seo/redirects";

/** Maksymalna liczba skoków przy domykaniu łańcucha reguł w sitemapie. */
const MAX_HOPS = 5;

function pathOnly(target: string): string {
  const [path] = target.split("#");
  const [clean] = path.split("?");
  return clean || "/";
}

function isAbsolute(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Docelowa ścieżka dla adresu w sitemapie.
 *
 * Zwraca `null`, gdy adres nie powinien się w sitemapie pojawić: reguła 410
 * (treść wycofana) albo przekierowanie na inny host (absolutny URL spoza
 * `sameOriginHosts`). Bez indeksu reguł zwraca wejście bez zmian.
 */
export function canonicalSitemapPath(
  index: RedirectIndex | null,
  pathname: string,
  sameOriginHosts: readonly string[] = [],
): string | null {
  let current = pathname || "/";
  if (!index) return current;

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const hit = matchRedirectForPath(index, current, "");
    if (!hit) return current;
    if (hit.gone) return null;

    let next = hit.target;
    if (isAbsolute(next)) {
      let url: URL;
      try {
        url = new URL(next);
      } catch {
        return null;
      }
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();
      const allowed = sameOriginHosts.some(
        (h) => h.replace(/^www\./i, "").toLowerCase() === host,
      );
      // Przekierowanie poza serwis - taki adres nie jest naszym kanonicznym URL-em.
      if (!allowed) return null;
      next = url.pathname;
    }
    next = pathOnly(next);
    if (next === current) return current;
    current = next;
  }
  // Łańcuch dłuższy niż limit - traktujemy jako niestabilny i pomijamy.
  return null;
}

export interface SitemapLangUrl {
  lang: AppLang;
  loc: string;
  alternates: Array<{ hreflang: string; href: string }>;
}

/**
 * Warianty językowe jednego dokumentu, już po kanonizacji przekierowań.
 *
 * `canonicalPath` to ścieżka bez prefiksu językowego. Dla ścieżek, których
 * serwis nie lokalizuje (`isLocalizablePath === false`), powstaje pojedynczy
 * wpis bez klastra hreflang - wariant /en tam nie istnieje.
 */
export function sitemapLanguageUrls(
  origin: string,
  canonicalPath: string,
  index: RedirectIndex | null = null,
  sameOriginHosts: readonly string[] = [],
): SitemapLangUrl[] {
  const base = stripLangPrefix(canonicalPath).pathname || "/";
  const resolvedBase = canonicalSitemapPath(index, base, sameOriginHosts);
  if (!resolvedBase) return [];

  // Każdy język rozwiązywany osobno - operator może mieć regułę tylko dla /en.
  const resolved = new Map<AppLang, string>();
  for (const lang of SUPPORTED_LANGS) {
    if (lang !== DEFAULT_LANG && !isLocalizablePath(resolvedBase)) continue;
    const localized = localizedPath(resolvedBase, lang);
    const target = canonicalSitemapPath(index, localized, sameOriginHosts);
    if (target) resolved.set(lang, target);
  }
  if (resolved.size === 0) return [];

  const alternates: Array<{ hreflang: string; href: string }> = [];
  const defaultHref = resolved.get(DEFAULT_LANG);
  if (defaultHref && resolved.size > 1) {
    alternates.push({ hreflang: "x-default", href: `${origin}${defaultHref}` });
  }
  if (resolved.size > 1) {
    for (const [lang, path] of resolved) {
      alternates.push({ hreflang: lang, href: `${origin}${path}` });
    }
  }

  return Array.from(resolved, ([lang, path]) => ({
    lang,
    loc: `${origin}${path}`,
    alternates,
  }));
}
