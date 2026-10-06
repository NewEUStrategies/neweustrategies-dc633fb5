import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyTheme,
  parseThemeChoice,
  readThemeChoice,
  resolveTheme,
  subscribeSystemTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type Theme,
} from "@/lib/theme/themeChoice";
import { useIslandMirror } from "@/lib/performance/hydrationIsland";

const STORAGE_KEY = THEME_STORAGE_KEY;
const SERVER_THEME: Theme = "light";

// ── MOTYW BEZ ZMIANY KONTEKSTU (P2.2, wymóg I2 z recenzji P1.6) ─────────────
//
// PROBLEM. Motyw jechał WARTOŚCIĄ kontekstu: start na `SERVER_THEME`, a po
// montażu `startTransition(() => setThemeState(readStored()))`. Przy zapisanym
// albo systemowym motywie ciemnym to ZMIANA WARTOŚCI KONTEKSTU nad całą
// stroną, a React propaguje ją do każdej odwodnionej granicy Suspense (nie
// wie, kto w środku czyta kontekst). Każda wyspa hydratacji (sekcje i stopka
// P2.2, nagłówek P2.3) budziła się wtedy zaraz po boocie, a przejście czekało
// na wszystkie - przełącznik motywu też (górna granica w `hydrationIsland.tsx`).
//
// ROZWIĄZANIE. Wartość kontekstu jest STAŁA (magazyn motywu i dwie akcje).
// Motyw mieszka w magazynie dostawcy, a każdy konsument ma lustro `useState`:
//  - przy hydratacji (i na serwerze) lustro startuje od `SERVER_THEME` -
//    parytet z HTML serwera także u odwiedzającego z ciemnym motywem (klasę
//    na `<html>` i tak ustawił skrypt anty-FOUC z `<head>`);
//  - świeży montaż (nawigacja SPA, popup, widget doładowany po zmianie
//    motywu) bierze bieżący motyw magazynu od razu - bez mignięcia jasnym;
//  - po montażu i przy każdej zmianie magazynu lustro przechodzi na bieżący
//    motyw w `startTransition`, więc zawieszony widget zostawia poprzedni
//    widok zamiast fallbacku (jak dotąd).
// Czekająca wyspa nie ma jeszcze zamontowanych konsumentów - zmiana motywu do
// niej nie dociera; uwodniona dostaje motyw lustrem we własnym przejściu.
// Lustro i sonda trybu renderu są wspólne z wyspą i urządzeniem renderera
// (`useIslandMirror`/`useHydrating` w `hydrationIsland.tsx`: React woła
// `getServerSnapshot` wyłącznie przy hydratacji).
//
// `setTheme` najpierw SYNCHRONICZNIE stosuje klasę na `<html>` (CSS reaguje w
// tej samej klatce, niezależnie od wysp), dopiero potem ogłasza motyw w
// magazynie - lustra przechodzą w przejściu.

interface ThemeStore {
  get(): Theme;
  set(next: Theme): void;
  subscribe(listener: () => void): () => void;
}

function createThemeStore(initial: Theme): ThemeStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next) {
      if (next === current) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

interface ThemeContextValue {
  store: ThemeStore;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

/** Poza dostawcą: motyw serwera, który się nie zmienia, i bezczynne akcje. */
const DEFAULT_CONTEXT: ThemeContextValue = {
  store: createThemeStore(SERVER_THEME),
  toggle: () => {},
  setTheme: () => {},
};

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_CONTEXT);

function systemTheme(): Theme {
  return systemPrefersDark() ? "dark" : "light";
}

// Jawny wybór użytkownika wygrywa z preferencją systemu. Reguła NIE JEST JUŻ
// PISANA TUTAJ: stoi raz w `lib/theme/themeChoice.ts` i stamtąd biorą ją
// zarówno ten komponent, jak i skrypt anty-FOUC z `<head>`, i skrypt preloadu
// tła quizu. Komentarz „keep both in sync", który tu wcześniej był, jest teraz
// bramką - `themeParity.test.ts` wykonuje skrypt i tę funkcję na tej samej
// macierzy wejść i wymaga identycznego skutku na `<html>`.
function readStored(): Theme {
  if (typeof window === "undefined") return "light";
  return resolveTheme(readThemeChoice(), systemPrefersDark());
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  // Klasa i `color-scheme` niosą ROZSTRZYGNIĘTY motyw, atrybut `data-motyw`
  // niesie WYBÓR - dlatego wybór czytamy z magazynu, a nie wnioskujemy
  // z `theme`. Wnioskowanie zamieniałoby „podążam za systemem, a system jest
  // ciemny" na „wybrałem ciemny", czyli gubiłoby jedyny stan, którego klasa
  // wyrazić nie umie.
  applyTheme(theme, readThemeChoice(), document.documentElement);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Magazyn startuje od "light" na serwerze i u klienta: serwer nie zna
  // zapisanego wyboru, a lustra konsumentów przy hydratacji i tak zaczynają od
  // motywu serwera (parytet HTML). Skrypt anty-FOUC z `__root.tsx` ustawił
  // klasę przed pierwszym malowaniem, więc nic nie miga.
  const [store] = useState(() => createThemeStore(SERVER_THEME));

  // Zmiana motywu po starcie (inna karta, system): klasa na `<html>`, potem
  // magazyn (lustra konsumentów w przejściu). Ten sam motyw - bez niczego.
  const adopt = useCallback(
    (next: Theme) => {
      if (next === store.get()) return;
      apply(next);
      store.set(next);
    },
    [store],
  );

  // Przyjęcie zapisanego wyboru po montażu. Do tej chwili `<html>` należy do
  // skryptu sprzed hydratacji (przy różnicy klasa jest stosowana ponownie,
  // idempotentnie - jak dotąd w efekcie motywu).
  useEffect(() => {
    adopt(readStored());
  }, [adopt]);

  // Wybór z innej karty przechodzi przez TĘ SAMĄ regułę co start aplikacji.
  // Wcześniej stała tu jej kopia (`newValue === "dark" ? "dark" : "light"`):
  // wybór usunięty w innej karcie albo wartość nieznana dawały jasny motyw
  // przy ciemnym systemie. `key === null` to `localStorage.clear()` w innej
  // karcie - wybór zniknął tak samo, jak przy usunięciu samego klucza.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null)
        adopt(resolveTheme(parseThemeChoice(e.newValue), systemPrefersDark()));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [adopt]);

  // Podążaj za ŻYWĄ zmianą motywu systemu, ale tylko dopóki użytkownik nie
  // wybrał jawnie. Zapytanie `prefers-color-scheme` i odpięcie nasłuchu
  // trzyma `themeChoice.ts`, bo start aplikacji i reakcja na zmianę muszą
  // pytać system TYM SAMYM warunkiem.
  useEffect(
    () =>
      subscribeSystemTheme(() => {
        if (readThemeChoice() === null) adopt(systemTheme());
      }),
    [adopt],
  );

  const setTheme = useCallback(
    (next: Theme) => {
      localStorage.setItem(STORAGE_KEY, next);
      // Klasa CSS reaguje od razu, zanim jakakolwiek wyspa się uwodni; lustra
      // konsumentów idą w przejściu (zawieszony widget zostawia widok).
      apply(next);
      store.set(next);
    },
    [store],
  );

  // A second click may arrive while the React transition is pending. The DOM
  // class already reflects the last explicit choice, unlike the deferred state.
  const toggle = useCallback(
    () => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
    [setTheme],
  );

  // Wartość kontekstu nie zmienia się przez całe życie dostawcy (MOTYW BEZ
  // ZMIANY KONTEKSTU): ani przy przyjęciu zapisanego wyboru, ani przy
  // przełączeniu - żadna zmiana motywu nie dociera do odwodnionej granicy.
  const value = useMemo(() => ({ store, toggle, setTheme }), [store, toggle, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const { store, toggle, setTheme } = useContext(ThemeContext);
  // A lazy widget can hydrate after an already interactive header changes the
  // theme. It still needs the server's theme for that first render; using the
  // live theme would add/remove its style nodes and discard the SSR tree.
  // Lustro (`useIslandMirror`): hydratacja - motyw serwera, świeży montaż -
  // bieżący motyw magazynu, potem przejścia; ten sam motyw nie renderuje
  // konsumenta (hydratacja na jasnym motywie - zero dodatkowych renderów).
  const theme = useIslandMirror(SERVER_THEME, store.get, store.subscribe);
  return useMemo(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme]);
}
