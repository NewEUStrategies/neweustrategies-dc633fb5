// Shared react-query test harness. Components under test increasingly read
// data through useQuery (ReadingHeader -> useHeaderProfile, PostSidebarRenderer,
// RelatedPosts, block views), so a bare render() throws "No QueryClient set".
// Each call gets a FRESH retry-free client - no cache bleed between tests, no
// retry-induced flakiness. Queries simply stay pending unless the test mocks
// their data source, which is exactly what shell/layout tests want.
import type { PropsWithChildren, ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Wrapper dla `renderHook`. Udostępnia klienta, aby test mógł sprawdzić stan
 * cache lub unieważnienia bez tworzenia drugiego, rozjeżdżającego się
 * harnessu React Query.
 */
export function createQueryClientWrapper() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/**
 * `queryClient` rides along on the return value so a test can spy on
 * `invalidateQueries` (which cache keys a mutation actually touched) without
 * building its own provider wiring - see CompanyPickerDialog's tests.
 */
export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = createTestQueryClient();
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}
