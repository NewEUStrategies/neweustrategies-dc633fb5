import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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

const STORAGE_KEY = THEME_STORAGE_KEY;
const SERVER_THEME: Theme = "light";
// React selects the hydration snapshot per consumer; no external event is
// needed. Keep this shared UI primitive independent of the router.
const subscribeToHydration = () => () => undefined;

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}>({
  theme: SERVER_THEME,
  toggle: () => {},
  setTheme: () => {},
});

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
  // Start as "light" on BOTH server and client. The server cannot know the
  // visitor's stored preference, so reading localStorage in the state
  // initializer made the first client render disagree with the SSR HTML for
  // dark-mode visitors - React 19 then rebuilds the entire hydrated tree
  // (blank flash, every query refetches). The inline script in __root.tsx
  // already applies the stored class before first paint, so starting "light"
  // causes no visual flash; state adopts the stored value right after
  // hydration in the effect below.
  const [theme, setThemeState] = useState<Theme>(SERVER_THEME);

  useEffect(() => {
    startTransition(() => setThemeState(readStored()));
  }, []);

  // Skip the first run: until state has adopted the stored preference, the
  // pre-hydration script owns the <html> class - applying the transient
  // "light" default here would flash a dark-mode visitor to light.
  const appliedOnce = useRef(false);
  useEffect(() => {
    if (!appliedOnce.current) {
      appliedOnce.current = true;
      return;
    }
    apply(theme);
  }, [theme]);

  // Wybór z innej karty przechodzi przez TĘ SAMĄ regułę co start aplikacji.
  // Wcześniej stała tu jej kopia (`newValue === "dark" ? "dark" : "light"`):
  // wybór usunięty w innej karcie albo wartość nieznana dawały jasny motyw
  // przy ciemnym systemie. `key === null` to `localStorage.clear()` w innej
  // karcie - wybór zniknął tak samo, jak przy usunięciu samego klucza.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null)
        startTransition(() =>
          setThemeState(resolveTheme(parseThemeChoice(e.newValue), systemPrefersDark())),
        );
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Podążaj za ŻYWĄ zmianą motywu systemu, ale tylko dopóki użytkownik nie
  // wybrał jawnie. Zapytanie `prefers-color-scheme` i odpięcie nasłuchu
  // trzyma `themeChoice.ts`, bo start aplikacji i reakcja na zmianę muszą
  // pytać system TYM SAMYM warunkiem.
  useEffect(
    () =>
      subscribeSystemTheme(() => {
        if (readThemeChoice() === null) startTransition(() => setThemeState(systemTheme()));
      }),
    [],
  );

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    // The CSS class responds immediately. Keep already visible content while
    // a lazy descendant finishes hydrating under the new theme; an urgent
    // context update can otherwise replace it with a null Suspense fallback.
    startTransition(() => setThemeState(next));
  }, []);

  // A second click may arrive while the React transition is pending. The DOM
  // class already reflects the last explicit choice, unlike the deferred state.
  const toggle = useCallback(
    () => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
    [setTheme],
  );

  // Unrelated root updates must not broadcast a new context during hydration.
  // A context update can discard a still-pending widget's SSR boundary even
  // when that widget's props and the actual theme remain unchanged.
  const value = useMemo(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  const theme = useSyncExternalStore(
    subscribeToHydration,
    () => context.theme,
    () => SERVER_THEME,
  );
  // A lazy widget can hydrate after an already interactive header changes the
  // theme. It still needs the server's snapshot for that first render; using
  // the live context can add/remove its style nodes and discard the SSR tree.
  return useMemo(
    // Subscribe to the value, not a false -> true hydration flag. On the
    // default light theme there is nothing to update: forcing another render
    // in every CMS widget adds synchronous work and can hide lazy content.
    () => (theme === context.theme ? context : { ...context, theme }),
    [context, theme],
  );
}
