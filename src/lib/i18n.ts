import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LANG, type AppLang } from "@/lib/i18n/localePath";
import { LANG_STORAGE_KEY } from "@/lib/storageKeys";
import { currentLang, setClientLang, syncClientLangToUrl } from "@/lib/i18n/localeRuntime";
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
 * Własna kopia rdzenia dla `init({ resources })`. i18next trzyma zasoby z init
 * PRZEZ REFERENCJĘ, a każda nakładka (`addResourceBundle(..., deep=true)`)
 * scala się W MIEJSCU w obiekt ze store - bez kopii dopisywała się do eksportu
 * `pl`/`en` z `@/lib/locale/*`. Dziś tylko SERWER (oba języki) - klient ma
 * tańszą kopię przy zapisie (blok niżej). Ten eksport
 * bramki i testy słowników czytają jako CZYSTY rdzeń (ratchet podmian w
 * nakładkach był przez to ślepy na PL). Kopia JSON - ta sama, którą i18next
 * robi sam w `addResourceBundle`, więc `ensureCoreLanguage` jej nie potrzebuje;
 * koszt raz na start: ~0,6-0,8 ms i ~200 KiB sterty na język (Node 22; zimny
 * `structuredClone` ~2,5 ms).
 */
function storeCopy(core: CoreBundle): CoreBundle {
  return JSON.parse(JSON.stringify(core));
}

// ---------------------------------------------------------------------------
// KLIENT: rdzeń w store BEZ głębokiej kopii (P1.7, F5 z diagnozy P0.5).
//
// `storeCopy` na kliencie biegł we wznowieniu po top-level await niżej (zadanie
// K9 księgi Lantern: 1,1-4,0 ms obs na samą kopię ~65 KB słownika), zanim
// ewaluowała się reszta grafu entry. Kopia chroni jedno: eksport `pl`/`en`
// z `@/lib/locale/*` przed scalaniem nakładek W MIEJSCU. Ta sama ochrona
// wychodzi taniej jako KOPIA PRZY ZAPISIE:
//   * store dostaje PŁYTKĄ kopię rdzenia (nowe klucze najwyższego poziomu
//     z nakładek lądują w niej, nie w eksporcie);
//   * przed głębokim scaleniem (`addResourceBundle(..., deep=true)` - jedyna
//     droga nakładek) poddrzewa najwyższego poziomu, które nakładka dotyka,
//     a które store nadal dzieli z eksportem, dostają własną kopię.
// Kopiujemy więc tylko to, co nakładki naprawdę ruszają, i dopiero wtedy, gdy
// je ruszają. Dowód czystości eksportu: `i18nClientRuntime.test.ts`
// („eksporty rdzenia nie są mutowane przez nakładki") i
// `i18nCoreExportsPristine.test.ts` (wszystkie nakładki, oba języki).
// Serwer zostaje przy `storeCopy` (raz na izolat, poza przeglądarką).
// ---------------------------------------------------------------------------

/** Język -> eksport rdzenia, z którym store klienta dzieli poddrzewa. */
const sharedCore = new Map<string, CoreBundle>();

/** Bundle `translation` języka w store (ten sam obiekt, nie kopia). */
function storeBundle(lang: string): Record<string, unknown> | undefined {
  const bundle = i18n.store?.data?.[lang]?.translation;
  return bundle !== null && typeof bundle === "object"
    ? (bundle as Record<string, unknown>)
    : undefined;
}

/**
 * Przed głębokim scaleniem `resources` w bundle `lang`: każde poddrzewo
 * najwyższego poziomu, które nakładka dotyka, a które store wciąż dzieli
 * z eksportem rdzenia, zamienia na własną kopię (ta sama kopia JSON, co
 * `storeCopy`, tylko dla jednego poddrzewa).
 */
function detachSharedSubtrees(lang: string, resources: unknown): void {
  const core = sharedCore.get(lang);
  if (core === undefined || resources === null || typeof resources !== "object") return;
  const bundle = storeBundle(lang);
  if (bundle === undefined) return;
  for (const key of Object.keys(resources)) {
    const shared = core[key];
    if (shared !== null && typeof shared === "object" && bundle[key] === shared) {
      bundle[key] = JSON.parse(JSON.stringify(shared));
    }
  }
}

/**
 * Wpina kopię przy zapisie w `addResourceBundle` instancji (klient). Obsługuje
 * też formę ścieżkową i18next (`addResourceBundle("pl.translation", res, deep)`).
 */
function installCopyOnWrite(): void {
  const original = i18n.addResourceBundle.bind(i18n);
  i18n.addResourceBundle = ((...args: Parameters<typeof i18n.addResourceBundle>) => {
    const [lng, ns, resources, deep] = args;
    // Forma ścieżkowa przesuwa argumenty: (ścieżka, zasoby, deep).
    const dotted = lng.includes(".");
    const [lang, namespace] = dotted ? lng.split(".") : [lng, ns];
    const payload: unknown = dotted ? ns : resources;
    const isDeep = dotted ? Boolean(resources) : Boolean(deep);
    if (namespace === "translation" && isDeep) detachSharedSubtrees(lang, payload);
    return original(...args);
  }) as typeof i18n.addResourceBundle;
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
const STORAGE_KEY = LANG_STORAGE_KEY.key;

/**
 * Push the i18next runtime to the language this request/app is currently
 * rendering (resolved from the URL path on the server, the live client ref on
 * the client). Called from the root `beforeLoad` with the location being
 * loaded: the root loader does not re-run on a client navigation (the root
 * match "stays"), so a browser back/forward between "/en/x" and "/x" never
 * reached i18next. `publicHref` first re-derives the client ref from that URL
 * (see syncClientLangToUrl - a no-op on the server and for preloads).
 */
export async function syncI18nToRequest(publicHref?: string): Promise<AppLang> {
  // Synchronicznie, zanim React przerenderuje odnośniki nowej lokalizacji
  // (zmiana magazynu lokalizacji routera planuje render w mikrozadaniu).
  if (publicHref !== undefined) syncClientLangToUrl(publicHref);
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
    initialResources.pl = { translation: storeCopy(plCore) };
    initialResources.en = { translation: storeCopy(enCore) };
    coreLoaded.add("pl");
    coreLoaded.add("en");
  } else {
    const lang = currentLang();
    const core = await importCore(lang);
    // Płytka kopia + kopia przy zapisie (patrz `installCopyOnWrite`) zamiast
    // `storeCopy`: wznowienie po top-level await nie kopiuje całego słownika.
    initialResources[lang] = { translation: { ...core } };
    sharedCore.set(lang, core);
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
    if (sharedCore.size > 0) installCopyOnWrite();
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
        // Zapis tylko przy realnej zmianie: ustawienie tej samej wartości też
        // unieważnia style całego dokumentu (atrybut na <html>).
        if (document.documentElement.getAttribute("lang") !== lang) {
          document.documentElement.setAttribute("lang", lang);
        }
      } catch {
        /* ignore */
      }
    });
    try {
      if (document.documentElement.getAttribute("lang") !== i18n.language) {
        document.documentElement.setAttribute("lang", i18n.language);
      }
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
        (window as Window).requestIdleCallback(idle, { timeout: 5000 });
      } else {
        (window as Window).setTimeout(idle, 3000);
      }
    }

    // JEDNO TYKNIĘCIE PRZED MODUŁAMI ZALEŻNYMI (P1.7, F5). Moduły, które
    // importują ten plik (w praktyce cały graf entry: drzewo tras ze schematami
    // `validateSearch`, komponenty korzenia), ewaluują się dopiero, gdy ten
    // moduł skończy. Bez tego tyknięcia robiły to w TYM SAMYM zadaniu, co
    // wznowienie po top-level await (słownik, `init`, ciasteczko) - zadanie K9
    // księgi Lantern, 18-24 ms obs na mobile x4 (próg długiego zadania to
    // 12,5 ms obs przy x4). Makrozadanie dzieli je na dwa: rozruch i18n tutaj,
    // ewaluacja zależnych (i `hydrateRoot` na końcu entry) w następnym.
    // Hydratacja i tak czeka na cały graf, więc start Reacta przesuwa się
    // najwyżej o jedno tyknięcie timera.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

export default i18n;
