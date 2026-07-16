// Query options dla menedżera menu - wspólne dla loadera i komponentów.
import { queryOptions } from "@tanstack/react-query";
import { getMenuWithItems, listMenus } from "./menu.functions";

export const menusListQueryOptions = queryOptions({
  queryKey: ["menus-list"] as const,
  queryFn: () => listMenus(),
  staleTime: 60_000,
});

export function menuWithItemsQueryOptions(key: string) {
  return queryOptions({
    queryKey: ["menu-with-items", key] as const,
    queryFn: () => getMenuWithItems({ data: { key } }),
    staleTime: 30_000,
  });
}
