// Wspólny montaż testów kart lejka: klient zapytań bez ponowień i prawdziwy
// słownik. Atrapy modułów (`vi.mock`) zostają w plikach testów - są
// hoistowane i muszą stać w pliku, który je deklaruje.
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

export function renderWithClient(ui: ReactNode, client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

/** Atrapa `useBenchmark`: bez benchmarku (stan „none") i bez żądania grupy. */
export function noBenchmark() {
  return { bench: null, sources: [], status: "none", retry: () => undefined };
}
