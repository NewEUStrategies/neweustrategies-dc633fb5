// Pure, framework-free <head> preload builder for the self-hosted Red Hat
// Display variable font. Kept side-effect free (no asset imports, no DOM) so it
// is fully unit-testable; the fingerprinted woff2 URLs are injected by the
// caller (the root route, which imports them via Vite `?url`).
import type { Lang } from "@/lib/seo/meta";

export interface FontPreloadUrls {
  /** Base Latin subset (U+0000-00FF, ...) - required by every language. */
  latin: string;
  /** Latin-ext subset (U+0100-02BA, ...) - carries the Polish diacritics
   *  (a-ogonek, c-acute, e-ogonek, l-stroke, n-acute, s-acute, z-acute,
   *  z-dot). Only Polish renders need it. */
  latinExt: string;
}

/**
 * Preload <link> descriptors for the critical font subsets.
 *
 * The Latin subset backs both PL and EN, so it is always preloaded; Latin-ext
 * (Polish diacritics) is preloaded only for Polish, so an English render pulls
 * exactly one font file instead of two. `crossOrigin` is mandatory even for a
 * same-origin font or the browser double-fetches it (the CSS-triggered request
 * is always anonymous-CORS, so the preload must match to be reused).
 *
 * Returned as `Array<Record<string, string>>` to match the descriptor shape the
 * other SEO builders emit for TanStack `head().links`.
 */
export function fontPreloadLinks(lang: Lang, urls: FontPreloadUrls): Array<Record<string, string>> {
  const preload = (href: string): Record<string, string> => ({
    rel: "preload",
    as: "font",
    type: "font/woff2",
    href,
    crossOrigin: "anonymous",
  });

  const links = [preload(urls.latin)];
  if (lang === "pl") links.push(preload(urls.latinExt));
  return links;
}
