// Kontekst renderowania widgetów w kontekście huba eksperta. Widgety
// (istniejące oraz przyszłe expert.*) mogą sięgnąć po pełen `ExpertHubData`
// bez ponownego pobierania danych - jedno źródło prawdy dla strony /author.
import { createContext, useContext, type ReactNode } from "react";
import type { ExpertHubData } from "@/lib/experts/types";

interface ExpertRenderValue {
  hub: ExpertHubData;
  lang: "pl" | "en";
}

const ExpertRenderContext = createContext<ExpertRenderValue | null>(null);

export function ExpertRenderProvider({
  hub,
  lang,
  children,
}: {
  hub: ExpertHubData;
  lang: "pl" | "en";
  children: ReactNode;
}) {
  return (
    <ExpertRenderContext.Provider value={{ hub, lang }}>{children}</ExpertRenderContext.Provider>
  );
}

/** Zwraca kontekst eksperta lub null jeśli widget renderuje się poza stroną eksperta. */
export function useMaybeExpertRender(): ExpertRenderValue | null {
  return useContext(ExpertRenderContext);
}

/** Wersja wymagająca kontekstu - do widgetów expert.*. */
export function useExpertRender(): ExpertRenderValue {
  const ctx = useContext(ExpertRenderContext);
  if (!ctx) throw new Error("useExpertRender must be used inside <ExpertRenderProvider>.");
  return ctx;
}
