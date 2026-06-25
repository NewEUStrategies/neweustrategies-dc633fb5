// Route-facing SEO helpers that bridge the isomorphic request reader, i18n and
// the pure meta builders. Keeping the "which language is this request?" rule in
// one place ensures every route emits consistent canonical / og / hreflang.
import i18n from "@/lib/i18n";
import { getRequestUrl } from "@/lib/seo/request";
import type { Lang } from "@/lib/seo/meta";

/**
 * Active language for head()/JSON-LD. An explicit `?lang=` (honoured by i18n and
 * by the hreflang alternates) wins; otherwise the i18n singleton (pl on the
 * server, the user's choice on the client).
 */
export function activeLang(url?: string): Lang {
  const u = url ?? getRequestUrl();
  try {
    const l = new URL(u, "http://x").searchParams.get("lang");
    if (l === "en" || l === "pl") return l;
  } catch {
    /* ignore */
  }
  return i18n.language === "en" ? "en" : "pl";
}
