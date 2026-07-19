import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { DEFAULT_LANG, localizedPath } from "@/lib/i18n/localePath";
import { setClientLang } from "@/lib/i18n/localeRuntime";
import { resolveOrPersistPreferredLang } from "@/lib/i18n/langCookie";

/**
 * Honor a returning visitor's stored language preference - and, on a first
 * visit, auto-detect from the browser (Polish -> pl, anything else -> en) -
 * but ONLY on the bare homepage. The SSR of "/" always renders the default
 * language (so it stays a single, shareable edge-cache entry); this
 * client-only effect then bounces a visitor to their preferred language
 * ("/en"). Deep links are deliberately left untouched, so shared / indexed
 * content URLs always render exactly as addressed.
 */
export function LocalePreferenceRedirect() {
  const router = useRouter();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== "/") return;
    const pref = resolveOrPersistPreferredLang();
    if (!pref || pref === DEFAULT_LANG) return;
    setClientLang(pref);
    void i18n.changeLanguage(pref);
    void router.navigate({ href: localizedPath("/", pref), replace: true, resetScroll: false });
  }, [router, i18n]);

  return null;
}

