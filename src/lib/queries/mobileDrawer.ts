// Query options dla konfiguracji mobilnego drawera - wspólne dla loadera
// (`ensureQueryData`) i komponentów (`useSuspenseQuery`).
import { queryOptions } from "@tanstack/react-query";
import { getMobileDrawerConfig } from "@/lib/mobileDrawer.functions";
import { DEFAULT_DRAWER_CONFIG } from "@/lib/mobileDrawer";

export const mobileDrawerConfigQueryKey = ["mobile-drawer-config"] as const;

export const mobileDrawerConfigQueryOptions = queryOptions({
  queryKey: mobileDrawerConfigQueryKey,
  queryFn: () => getMobileDrawerConfig(),
  // Konfiguracja zmienia się rzadko - trzymamy 5 min w pamięci.
  staleTime: 5 * 60_000,
  initialData: DEFAULT_DRAWER_CONFIG,
});
