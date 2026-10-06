// Query options dla menedżera menu - wspólne dla loadera i komponentów.
import { queryOptions } from "@tanstack/react-query";
import { getMenuWithItems, listMenus, type MenuWithItemsWire } from "./menu.functions";
import { DEFAULT_MEGA_CONFIG, type MenuWithItems } from "./types";

export const menusListQueryOptions = queryOptions({
  queryKey: ["menus-list"] as const,
  queryFn: () => listMenus(),
  // Menu rzadko zmieniają strukturę - 10 min świeżości, 1h w cache.
  staleTime: 10 * 60_000,
  gcTime: 60 * 60_000,
});

/**
 * Odwrotność `compactMenuWithItems` (`menu.functions.ts`): menu w kształcie
 * przesyłki -> pełne wiersze `MenuItemRow` z wartościami domyślnymi TEJ SAMEJ
 * normalizacji co `fetchMenuWithItems` (`menu_id` = `id` menu, bo pozycje
 * przychodzą z osadzenia po kluczu obcym). Na pełnym wierszu jest tożsamością
 * co do wartości, więc wpis sprzed projekcji (starszy izolat) też się czyta.
 *
 * Żyje TU, nie przy projekcji: to `select` zapytania klienta, a moduł server
 * fn jest w testach podmieniany w całości.
 */
export function expandMenuWithItems(menu: MenuWithItemsWire | null): MenuWithItems | null {
  if (!menu) return null;
  return {
    id: menu.id,
    key: menu.key,
    name: menu.name,
    items: menu.items.map((row) => ({
      id: row.id,
      menu_id: menu.id,
      parent_id: row.parent_id ?? null,
      position: row.position,
      item_type: row.item_type,
      ref_id: row.ref_id,
      label_pl: row.label_pl ?? "",
      label_en: row.label_en ?? "",
      href: row.href ?? "",
      target: row.target ?? "_self",
      css_class: row.css_class ?? "",
      visibility: row.visibility ?? "all",
      icon: row.icon ?? "",
      mega_enabled: row.mega_enabled ?? false,
      mega_config: row.mega_config ?? DEFAULT_MEGA_CONFIG,
    })),
  };
}

export function menuWithItemsQueryOptions(key: string) {
  return queryOptions({
    queryKey: ["menu-with-items", key] as const,
    // W cache (i w stanie odwodnionym SSR) leży menu w KSZTAŁCIE PRZESYŁKI -
    // bez `menu_id` i pól domyślnych (`compactMenuWithItems`, P2.5).
    queryFn: () => getMenuWithItems({ data: { key } }),
    // Konsumenci (nagłówek, stopka, edytor menu) dostają pełne `MenuWithItems`.
    // Funkcja na poziomie modułu = stała tożsamość, więc react-query liczy
    // `select` raz na zmianę danych, a nie przy każdym renderze.
    select: expandMenuWithItems,
    // Pozycje menu rzadko się zmieniają - 10 min świeżości, 1h w cache.
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });
}
