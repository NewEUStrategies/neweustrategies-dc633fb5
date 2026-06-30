// Route-facing SEO helpers that bridge the isomorphic request reader, i18n and
// the pure meta builders. Keeping the "which language is this request?" rule in
// one place ensures every route emits consistent canonical / og / hreflang.
import i18n from "@/lib/i18n";
import { getRequestUrl } from "@/lib/seo/request";
import { stripLangPrefix } from "@/lib/i18n/localePath";
import type { Lang } from "@/lib/seo/meta";

/**
 * Active language for head()/JSON-LD. The URL PATH prefix ("/en/...") is
 * authoritative; an unprefixed path is the default-language canonical, so it
 * falls back to the i18n runtime (pl on the server for content, the user's
 * choice on the client).
 */
export function activeLang(url?: string): Lang {
  const u = url ?? getRequestUrl();
  try {
    const { lang } = stripLangPrefix(new URL(u, "http://x").pathname);
    if (lang) return lang;
  } catch {
    /* ignore */
  }
  return i18n.language === "en" ? "en" : "pl";
}
