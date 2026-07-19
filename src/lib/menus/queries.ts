// Query options dla menedżera menu - wspólne dla loadera i komponentów.
import { queryOptions } from "@tanstack/react-query";
import { getMenuWithItems, listMenus } from "./menu.functions";

export const menusListQueryOptions = queryOptions({
  queryKey: ["menus-list"] as const,
  queryFn: () => listMenus(),
  // Menu rzadko zmieniają strukturę - 10 min świeżości, 1h w cache.
  staleTime: 10 * 60_000,
  gcTime: 60 * 60_000,
});

export function menuWithItemsQueryOptions(key: string) {
  return queryOptions({
    queryKey: ["menu-with-items", key] as const,
    queryFn: () => getMenuWithItems({ data: { key } }),
    // Pozycje menu rzadko się zmieniają - 10 min świeżości, 1h w cache.
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });
}
