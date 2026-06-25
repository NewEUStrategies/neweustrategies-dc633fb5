// Editor mode context - used by the CMS Builder to override the visual
// light/dark mode independently of the global ThemeProvider (which still
// drives the rest of the admin UI). When this context is present, widgets
// and properties resolve ThemedValue<T> against the editor's chosen mode.
import { createContext, useContext, type ReactNode } from "react";
import type { Mode } from "./types";

const BuilderModeContext = createContext<Mode | null>(null);

export function BuilderModeProvider({ mode, children }: { mode: Mode; children: ReactNode }) {
  return <BuilderModeContext.Provider value={mode}>{children}</BuilderModeContext.Provider>;
}

/** Returns the editor's current mode, or `null` if not inside the builder. */
export function useBuilderMode(): Mode | null {
  return useContext(BuilderModeContext);
}
