import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { pl } from "@/lib/locale/pl";
import { en } from "@/lib/locale/en";
import { DEFAULT_LANG, type AppLang } from "@/lib/i18n/localePath";
import { currentLang, setClientLang } from "@/lib/i18n/localeRuntime";
import { readLangCookieClient, writeLangCookieClient, detectBrowserLang } from "@/lib/i18n/langCookie";

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
  // Mutating the shared singleton is safe only on the client (one user per
  // runtime). On the server this instance is shared across every concurrent
  // request, so a changeLanguage here races with another request's render and
  // can emit the wrong language into an edge-cached document. On the server the
  // per-request render clone (getRenderI18n) carries the language instead.
  if (typeof window !== "undefined" && i18n.language !== lang) {
    await i18n.changeLanguage(lang);
  }
  return lang;
}

/**
 * The i18next instance a render should use.
 *
 * - Client: the shared singleton (one user per runtime; keeps the language
 *   switcher, cookie sync and `changeLanguage` working).
 * - Server: a fresh per-request clone seeded to the request language. The clone
 *   shares the singleton's resource store by reference (i18next `cloneInstance`
 *   without `forkResourceStore`), so every base + overlay bundle is present and
 *   no translations go missing - but its `language` is isolated, so concurrent
 *   requests of different languages can no longer bleed into each other.
 */
export function getRenderI18n(): typeof i18n {
  if (typeof window !== "undefined") return i18n;
  return i18n.cloneInstance({ lng: currentLang() });
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
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
      // Backfill the preference cookie if missing. Prefer an auto-detected
      // browser language (Polish -> pl, anything else -> en) so a first-time
      // visitor's preference is captured before the homepage redirect runs.
      if (!readLangCookieClient()) {
        const detected = detectBrowserLang();
        writeLangCookieClient(detected ?? (i18n.language === "en" ? "en" : "pl"));
      }
    } catch {
      /* ignore */
    }
  }
}

export default i18n;
