// Shared react-query test harness. Components under test increasingly read
// data through useQuery (ReadingHeader -> useHeaderProfile, PostSidebarRenderer,
// RelatedPosts, block views), so a bare render() throws "No QueryClient set".
// Each call gets a FRESH retry-free client - no cache bleed between tests, no
// retry-induced flakiness. Queries simply stay pending unless the test mocks
// their data source, which is exactly what shell/layout tests want.
import type { ReactElement, ReactNode } from "react";
import { render, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * `queryClient` rides along on the return value so a test can spy on
 * `invalidateQueries` (which cache keys a mutation actually touched) without
 * building its own provider wiring - see CompanyPickerDialog's tests.
 */
export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

/**
 * Wariant dla HOOKÓW. Ta sama zasada co wyżej - świeży klient bez ponowień na
 * każde wywołanie - ale przez `renderHook`, bo hooki warstwy danych (np.
 * `useRetentionSettings`) nie mają własnego komponentu do wyrenderowania.
 *
 * `queryClient` wraca w wyniku, żeby test mógł sprawdzić, czy zapytanie w ogóle
 * trafiło do cache - to jedyny sposób na dowiedzenie, że flaga `enabled: false`
 * FAKTYCZNIE wstrzymuje odczyt, a nie tylko chowa wynik.
 */
export function renderHookWithQueryClient<TResult>(hook: () => TResult) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(hook, { wrapper }), queryClient };
}
