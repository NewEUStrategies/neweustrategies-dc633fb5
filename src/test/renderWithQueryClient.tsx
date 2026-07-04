// Shared react-query test harness. Components under test increasingly read
// data through useQuery (ReadingHeader -> useHeaderProfile, PostSidebarRenderer,
// RelatedPosts, block views), so a bare render() throws "No QueryClient set".
// Each call gets a FRESH retry-free client - no cache bleed between tests, no
// retry-induced flakiness. Queries simply stay pending unless the test mocks
// their data source, which is exactly what shell/layout tests want.
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
