import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LANG, type AppLang } from "@/lib/i18n/localePath";
import { currentLang, setClientLang } from "@/lib/i18n/localeRuntime";
import {
  readLangCookieClient,
  writeLangCookieClient,
  detectBrowserLang,
} from "@/lib/i18n/langCookie";

// ---------------------------------------------------------------------------
// Split słowników per język (perf pierwszego wczytania):
// core PL i EN (~65 KB źródła każdy) były importowane statycznie, więc OBA
// języki jechały w bundlu wejściowym każdej strony. Teraz:
//   - SERWER: ładuje oba (współbieżne żądania w różnych językach dzielą jeden
//     isolate, a getRenderI18n() klonuje instancję współdzieląc store zasobów),
//   - KLIENT: top-level await dociąga wyłącznie język aktywnej strony (znany
//     z URL-a przed startem Reacta), a hydratacja i tak czeka na graf modułów,
//     więc pierwsze malowanie nie miga surowymi kluczami. Drugi język schodzi
//     leniwie: natychmiast przy zmianie języka (patrz wrapper changeLanguage)
//     albo w tle po bezczynności (fallback dla stron EN).
// Vite wydziela locale/pl i locale/en do osobnych chunków dzięki dynamicznym
// importom; pliki są czystymi eksportami danych (bez side-effectów), więc
// nie ma różnicy semantycznej względem importu statycznego.
// ---------------------------------------------------------------------------

type CoreBundle = Record<string, unknown>;

/** Języki, których RDZENNY słownik jest już w store (overlaye i18n-* rejestrują
 * własne fragmenty i nie mogą być brane za załadowany core). */
const coreLoaded = new Set<AppLang>();

async function importCore(lang: AppLang): Promise<CoreBundle> {
  if (lang === "en") {
    const { en } = await import("@/lib/locale/en");
    return en;
  }
  const { pl } = await import("@/lib/locale/pl");
  return pl;
}

/**
 * Dociąga rdzenny słownik języka (idempotentnie). `overwrite=false`, żeby
 * fragmenty zarejestrowane wcześniej przez overlaye (lib/i18n-*) nie zostały
 * nadpisane - overlaye z założenia tylko DOKŁADAJĄ brakujące klucze.
 */
export async function ensureCoreLanguage(lng: string): Promise<void> {
  const lang: AppLang = lng === "en" ? "en" : "pl";
  if (coreLoaded.has(lang)) return;
  const core = await importCore(lang);
  coreLoaded.add(lang);
  i18n.addResourceBundle(lang, "translation", core, true, false);
}

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
  // Top-level await: klient czeka wyłącznie na chunk AKTYWNEGO języka (request
  // startuje na początku ewaluacji entry, równolegle z resztą wykonywania);
  // serwer ładuje oba języki jak dotąd.
  const initialResources: Record<string, { translation: CoreBundle }> = {};
  if (import.meta.env.SSR) {
    const [plCore, enCore] = await Promise.all([importCore("pl"), importCore("en")]);
    initialResources.pl = { translation: plCore };
    initialResources.en = { translation: enCore };
    coreLoaded.add("pl");
    coreLoaded.add("en");
  } else {
    const lang = currentLang();
    initialResources[lang] = { translation: await importCore(lang) };
    coreLoaded.add(lang);
  }

  i18n.use(initReactI18next).init({
    resources: initialResources,
    // currentLang() resolves from the URL path on the client (hydration-safe,
    // mirroring the server) and falls back to the default elsewhere.
    lng: currentLang(),
    fallbackLng: DEFAULT_LANG,
    supportedLngs: ["pl", "en"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

  if (typeof window !== "undefined") {
    // Każda zmiana języka przechodzi przez changeLanguage (przełącznik w
    // headerze, LocalePreferenceRedirect, syncI18nToRequest po nawigacji).
    // Wrapper dociąga rdzenny słownik ZANIM i18next wyemituje languageChanged,
    // więc przełączenie nigdy nie miga surowymi kluczami. Błąd sieci nie
    // blokuje zmiany języka - overlaye + fallback wciąż działają.
    const origChangeLanguage = i18n.changeLanguage.bind(i18n);
    i18n.changeLanguage = ((lng?: string, callback?: Parameters<typeof origChangeLanguage>[1]) => {
      const ensure = lng ? ensureCoreLanguage(lng).catch(() => undefined) : Promise.resolve();
      return ensure.then(() => origChangeLanguage(lng, callback));
    }) as typeof i18n.changeLanguage;

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

    // Strony EN: dociągnij PL w tle po bezczynności - PL jest fallbackiem
    // brakujących kluczy, a przełączenie na PL staje się natychmiastowe.
    // Strony PL (większość ruchu) nie pobierają EN wcale, dopóki użytkownik
    // nie przełączy języka.
    if (i18n.language === "en") {
      const idle = () => void ensureCoreLanguage("pl");
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(idle, { timeout: 5000 });
      } else {
        window.setTimeout(idle, 3000);
      }
    }
  }
}

export default i18n;
