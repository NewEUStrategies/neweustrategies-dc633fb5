import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { pl } from "@/lib/locale/pl";
import { en } from "@/lib/locale/en";
import { DEFAULT_LANG, type AppLang } from "@/lib/i18n/localePath";
import { currentLang, setClientLang } from "@/lib/i18n/localeRuntime";
import { readLangCookieClient, writeLangCookieClient } from "@/lib/i18n/langCookie";

const resources = {
  pl: { translation: pl },
  en: { translation: en },
};

// Secondary mirror of the language preference. The cookie (see langCookie.ts)
// is the source of truth; localStorage is a resilience backstop for clients
// that drop the cookie. Neither affects a content render's cacheability - the
// language is taken from the URL path now.
const STORAGE_KEY = "lovable.lang";

/**
 * Push the i18next runtime to the language this request/app is currently
 * rendering (resolved from the URL path on the server, the live client ref on
 * the client). Called from the root loader so SSR copy matches the URL.
 */
export async function syncI18nToRequest(): Promise<AppLang> {
  const lang = currentLang();
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
  return lang;
}

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources,
      // currentLang() resolves from the URL path on the client (hydration-safe,
      // mirroring the server) and falls back to the default elsewhere.
      lng: currentLang(),
      fallbackLng: DEFAULT_LANG,
      supportedLngs: ["pl", "en"],
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });

  if (typeof window !== "undefined") {
    i18n.on("languageChanged", (lng) => {
      const lang: AppLang = lng === "en" ? "en" : "pl";
      try {
        // Keep the router's `output` rewrite in lockstep with the rendered
        // language so freshly built hrefs carry the right "/en" prefix.
        setClientLang(lang);
        window.localStorage.setItem(STORAGE_KEY, lang);
        writeLangCookieClient(lang);
        document.documentElement.setAttribute("lang", lang);
      } catch {
        /* ignore */
      }
    });
    try {
      document.documentElement.setAttribute("lang", i18n.language);
      // Backfill the preference cookie if missing (e.g. set only in
      // localStorage by an older build).
      if (!readLangCookieClient()) writeLangCookieClient(i18n.language === "en" ? "en" : "pl");
    } catch {
      /* ignore */
    }
  }
}

export default i18n;
