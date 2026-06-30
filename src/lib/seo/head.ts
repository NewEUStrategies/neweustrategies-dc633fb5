// Route-facing SEO helpers that bridge the isomorphic request reader, i18n and
// the pure meta builders. Keeping the "which language is this request?" rule in
// one place ensures every route emits consistent canonical / og / hreflang.
import { getRequestUrl } from "@/lib/seo/request";
import { stripLangPrefix } from "@/lib/i18n/localePath";
import { currentLang } from "@/lib/i18n/localeRuntime";
import type { Lang } from "@/lib/seo/meta";

/**
 * Active language for head()/JSON-LD. The URL PATH prefix ("/en/...") is
 * authoritative; an unprefixed path is the default-language canonical, so it
 * falls back to the request-scoped language resolver.
 *
 * It deliberately does NOT read the module-global i18next singleton: that
 * instance is shared across every concurrent SSR request in a worker, so
 * reading its `language` here would race with another request's
 * `changeLanguage()` and could emit the wrong canonical / og / <html lang> into
 * a shared-cached document. `currentLang()` is isomorphic and per-request on the
 * server (resolved from the request URL), so it is always correct.
 */
export function activeLang(url?: string): Lang {
  const u = url ?? getRequestUrl();
  try {
    const { lang } = stripLangPrefix(new URL(u, "http://x").pathname);
    if (lang) return lang;
  } catch {
    /* ignore */
  }
  return currentLang();
}
