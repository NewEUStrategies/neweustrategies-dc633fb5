// Przełączenie języka INTERFEJSU - jedna ścieżka dla wszystkich przełączników:
// taśmy w headerze (`LangReelSwitcher`), flag w mobilnej szufladzie
// (`LangToggle`) i widgetu "language switch" buildera (`LangSwitcherDropdown`).
//
// Dlaczego wspólny moduł: każdy przełącznik niósł własną, prawie identyczną
// kopię tej sekwencji i kopie zdążyły się rozjechać:
//   * `LangToggle` czytał `router.state` bez obrony, więc klik poza
//     RouterProvider kończył się TypeErrorem zamiast zmianą języka;
//   * dwa pozostałe zapisywały localStorage "i18nextLng", którego NIC nie czyta
//     (w projekcie nie ma detektora i18next) - lustrem preferencji jest
//     LANG_STORAGE_KEY ("nes.lang"), zapisywany razem z ciasteczkiem `nes_lang`
//     i <html lang> przez handler `languageChanged` w `src/lib/i18n.ts`;
//   * wszystkie trzy budowały adres z samej ścieżki, gubiąc query i hash -
//     przełączenie na /search?q=… czyściło wyszukiwanie, a na
//     /login?redirect=… zrywało powrót po zalogowaniu;
//   * fallback na `window.location` łapał tylko synchroniczny wyjątek, a
//     `router.navigate` jest async - odrzucona obietnica (np. SecurityError
//     z dławionego `history.replaceState` w Safari) zostawiała język klienta
//     przestawiony bez nawigacji i nieobsłużone odrzucenie w konsoli.
import { useRouter, type HistoryState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { uiLang } from "./format";
import { localizedPath, stripLangPrefix, type AppLang } from "./localePath";
import { setClientLang } from "./localeRuntime";

/** Magazyn lokalizacji routera, który `<Link>`-i subskrybują. */
interface UiLangLocationStore {
  get(): object;
  set(location: object): void;
}

/** Tyle routera TanStack, ile potrzeba do przełączenia. */
export interface UiLangRouter {
  state?: { location?: { pathname?: string; searchStr?: string; hash?: string } };
  navigate: (opts: {
    href: string;
    replace: boolean;
    resetScroll: boolean;
    hashScrollIntoView: boolean;
    state: (prev: HistoryState) => HistoryState;
  }) => unknown;
  /** Bez magazynu (atrapa, inny router) odnośniki odświeży dopiero nawigacja. */
  stores?: { location?: UiLangLocationStore };
  /** Bieżące opcje routera - `update` dostaje je z powrotem bez zmian. */
  options?: object;
  /**
   * Bez `update` (atrapa, inny router) nie ma pamięci lokalizacji do czyszczenia.
   * Składnia metody celowo: jej parametr porównywany jest biwariantnie, więc
   * prawdziwy router (`UpdateFn` z pełnymi opcjami konstruktora) pasuje do typu.
   */
  update?(options: object): void;
}

/** Tyle i18next, ile potrzeba do przełączenia. */
export interface UiLangI18n {
  changeLanguage: (lng: string) => unknown;
}

/**
 * Język, który przełącznik pokazuje jako aktywny. Prefiks ścieżki ("/en/...")
 * ma pierwszeństwo; bez niego decyduje kod i18next po prefiksie ("en-GB" -> en,
 * brak języka -> pl).
 */
export function resolveUiLang(
  pathname: string | undefined,
  i18nLanguage: string | undefined,
): AppLang {
  return stripLangPrefix(pathname ?? "/").lang ?? uiLang(i18nLanguage);
}

/** Bieżący adres: z routera, a bez niego z okna; query i hash idą dalej. */
function currentAddress(router: UiLangRouter | null | undefined): {
  pathname: string;
  suffix: string;
} {
  const loc = router?.state?.location;
  if (loc?.pathname != null) {
    return {
      pathname: loc.pathname,
      suffix: `${loc.searchStr ?? ""}${loc.hash ? `#${loc.hash}` : ""}`,
    };
  }
  if (typeof window === "undefined") return { pathname: "/", suffix: "" };
  const { pathname, search, hash } = window.location;
  return { pathname, suffix: `${search}${hash}` };
}

/** Klucz stanu historii, którym przełącznik oznacza wpis nowym językiem. */
const UI_LANG_STATE_KEY = "__uiLang";

function hardNavigate(href: string): void {
  if (typeof window !== "undefined") window.location.href = href;
}

/**
 * Każe JUŻ wyrenderowanym `<Link>`-om zbudować href od nowa - w nowym języku.
 *
 * Przełączenie zmienia tylko prefiks, który rewrite `input` zdejmuje - "/en/b"
 * i "/b" to dla routera ten sam "/b" - a jedynym, co zależy od języka, jest
 * rewrite `output`, czytający `currentLang()`. Bez odświeżenia odnośniki strony
 * zostawały w starym języku: nowa karta, skopiowany link i pasek statusu
 * prowadziły do drugiej wersji językowej (sam klik nie, bo `navigate` buduje
 * adres kliku od nowa). Dwa mechanizmy routera trzymają stary href:
 *
 *   1. Pamięć lokalizacji. router-core 1.171.37 zapamiętuje wynik
 *      `buildLocation` każdego `<Link>`, który nie zależy od bieżącego adresu
 *      (bezwzględne `to`, bez `search: true` itp.), pod obiektem opcji tego
 *      odnośnika (`staticLocations`, `router.js`). Czyści ją wyłącznie
 *      `update()` (albo `setRoutes`), a zależności od `currentLang()` pamięć nie
 *      widzi. `update` z niezmienionymi opcjami - to samo, co robi
 *      `RouterProvider` przy zmianie propsów - przy tym samym obiekcie
 *      `rewrite` tylko ją czyści i ponownie parsuje `latestLocation`.
 *   2. Przeliczenie na żądanie. `<Link>` buduje lokalizację ponownie dopiero,
 *      gdy magazyn lokalizacji poda INNY obiekt niż ostatnio widziany
 *      (porównanie tożsamości, `link.tsx`/`matchContext.tsx`). Zapis płytkiej
 *      kopii i natychmiastowy powrót tej samej lokalizacji to dwa
 *      powiadomienia; każdy odnośnik przelicza href synchronicznie, w chwili
 *      powiadomienia (migawka `useSyncExternalStore`), więc kopii nie trzeba
 *      renderować. Warunek: wywołanie POZA `router.batch` - w nim (np. ze
 *      słuchacza `onResolved`) oba zapisy scalają się w jedno powiadomienie
 *      z TĄ SAMĄ lokalizacją i żaden odnośnik nic nie przelicza; stąd
 *      odświeżenie dopiero w `.then` nawigacji. Kopia ma te same pola, więc
 *      subskrybenci czytający `pathname`, `href` czy `search` nie widzą
 *      różnicy, a w routerze zostaje TA SAMA lokalizacja. Żadnej nawigacji,
 *      zapisu historii ani ładowania tras.
 */
function refreshRenderedLinks(router: UiLangRouter): void {
  const store = router.stores?.location;
  if (!store) return;
  const location = store.get();
  try {
    router.update?.({ ...router.options });
    store.set({ ...location });
  } catch {
    // Odświeżenie dotyczy samych href-ów - jego błąd (np. wyjątek subskrybenta
    // magazynu) nie może wywrócić udanego przełączenia ani zostawić
    // nieobsłużonego odrzucenia.
  }
  // Kopia nie może zostać w routerze - nawet gdy zapis wyżej rzucił.
  store.set(location);
}

/**
 * Przełącza język interfejsu na `next` i przenosi na ten sam adres w nowym
 * języku. No-op, gdy `next` jest już aktywny.
 *
 * Kolejność ma znaczenie: `setClientLang` idzie PRZED nawigacją, bo rewrite
 * `output` routera czyta `currentLang()` w chwili budowania adresu i tylko wtedy
 * dokleja (albo zdejmuje) prefiks "/en" - niezależnie od asynchronicznego
 * `changeLanguage`, który najpierw dociąga słownik drugiego języka.
 */
export function switchUiLanguage(
  next: AppLang,
  current: AppLang,
  { i18n, router }: { i18n: UiLangI18n; router: UiLangRouter | null | undefined },
): void {
  if (next === current) return;
  setClientLang(next);
  void i18n.changeLanguage(next);
  // <html lang> od razu, a nie dopiero w `languageChanged` (ten czeka na
  // słownik) - czytnik ekranu i reguły :lang() widzą nowy język w tej samej
  // klatce co nawigacja. Zapis tylko przy realnej zmianie, jak w i18n.ts.
  if (typeof document !== "undefined" && document.documentElement.lang !== next) {
    document.documentElement.lang = next;
  }
  const { pathname, suffix } = currentAddress(router);
  const href = `${localizedPath(pathname, next)}${suffix}`;
  if (router) {
    try {
      // `hashScrollIntoView: false`: hash jedzie w adresie, ale router nie może
      // przewinąć do kotwicy - domyślnie robi to nawet przy `resetScroll: false`,
      // więc czytelnik, który doczytał dalej niż #sekcja, wracałby do niej.
      // `state` z językiem: router porównuje adresy BEZ prefiksu, a "/en/a" i
      // "/a" to dla niego ten sam "/a" - przy tym samym stanie historii tylko
      // przeładowuje trasę i NIE zapisuje adresu. Przełączenie EN -> PL
      // zostawiało więc w pasku /en/a (przeładowanie i udostępniony link
      // wracały do angielskiego). Inny stan wymusza `history.replace`.
      // Wyrenderowane odnośniki sama nawigacja nie przestawia na nowy język
      // (router pamięta ich lokalizacje, a język nie jest częścią adresu, który
      // widzi) - po nawigacji odświeżamy je (`refreshRenderedLinks`).
      void Promise.resolve(
        router.navigate({
          href,
          replace: true,
          resetScroll: false,
          hashScrollIntoView: false,
          state: (prev) => ({ ...prev, [UI_LANG_STATE_KEY]: next }),
        }),
      ).then(
        () => refreshRenderedLinks(router),
        () => hardNavigate(href),
      );
      return;
    } catch {
      /* synchroniczny wyjątek - twarda nawigacja niżej */
    }
  }
  hardNavigate(href);
}

/**
 * Stan i akcja przełącznika języka interfejsu dla komponentu. Router jest
 * opcjonalny (`warn: false`): przełącznik renderowany poza RouterProvider
 * (podgląd, testy) pokazuje język z i18next i nawiguje twardo.
 */
export function useUiLangSwitch(): { current: AppLang; switchTo: (next: AppLang) => void } {
  const { i18n } = useTranslation();
  // Typ `useRouter` obiecuje router zawsze, ale poza RouterProvider zwraca null.
  const router: UiLangRouter | null = useRouter({ warn: false });
  const current = resolveUiLang(router?.state?.location?.pathname, i18n.language);
  return {
    current,
    switchTo: (next) => switchUiLanguage(next, current, { i18n, router }),
  };
}
