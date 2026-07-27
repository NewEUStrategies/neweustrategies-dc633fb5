// Shared "current UI language" hook for SSR-rendered chrome (Header, Footer,
// AlertBar, banners...). Guarantees:
//   1. First render (server + client hydration) uses currentLang() - derived
//      from the request URL, so SSR HTML and hydrated HTML match byte-for-byte
//      and there is no flash of the wrong language.
//   2. After mount, subscribes to i18next `languageChanged` and re-renders
//      synchronously when the user flips the switcher, even when the memoized
//      wrapper would otherwise bail out on identical props.
//
// We deliberately do NOT read `i18n.language` at mount to reconcile: it is
// updated asynchronously by changeLanguage(), so reading it during hydration
// can return the previous locale and cause a visible one-frame text flicker.
// The event payload / URL is authoritative instead.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentLang } from "./localeRuntime";
import type { AppLang } from "./localePath";

export function useLang(): AppLang {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState<AppLang>(() => currentLang());
  useEffect(() => {
    const sync = (nextRaw?: string) => {
      const fromEvent: AppLang | undefined = nextRaw
        ? nextRaw.startsWith("en")
          ? "en"
          : "pl"
        : undefined;
      // URL is authoritative (matches router's `output` rewrite / SSR).
      const next: AppLang = fromEvent ?? currentLang();
      setLang((prev) => (prev === next ? prev : next));
    };
    i18n.on("languageChanged", sync);
    return () => {
      i18n.off("languageChanged", sync);
    };
  }, [i18n]);
  return lang;
}
