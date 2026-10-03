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
      void Promise.resolve(
        router.navigate({
          href,
          replace: true,
          resetScroll: false,
          hashScrollIntoView: false,
          state: (prev) => ({ ...prev, [UI_LANG_STATE_KEY]: next }),
        }),
      ).catch(() => hardNavigate(href));
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
