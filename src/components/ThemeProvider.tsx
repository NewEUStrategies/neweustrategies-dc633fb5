import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  applyTheme,
  readThemeChoice,
  resolveTheme,
  subscribeSystemTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type Theme,
} from "@/lib/theme/themeChoice";

const STORAGE_KEY = THEME_STORAGE_KEY;

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}>({
  theme: "light",
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
  const [theme, setThemeState] = useState<Theme>("light");

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

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY)
        startTransition(() => setThemeState(e.newValue === "dark" ? "dark" : "light"));
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

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    // The CSS class responds immediately. Keep already visible content while
    // a lazy descendant finishes hydrating under the new theme; an urgent
    // context update can otherwise replace it with a null Suspense fallback.
    startTransition(() => setThemeState(next));
  };

  // A second click may arrive while the React transition is pending. The DOM
  // class already reflects the last explicit choice, unlike the deferred state.
  const toggle = () =>
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
