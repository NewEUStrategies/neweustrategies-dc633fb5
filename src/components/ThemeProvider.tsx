import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "theme";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}>({
  theme: "light",
  toggle: () => {},
  setTheme: () => {},
});

function readStored(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
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
    setThemeState(readStored());
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
      if (e.key === STORAGE_KEY) setThemeState(e.newValue === "dark" ? "dark" : "light");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    setThemeState(next);
  };

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
