// Reguły WIDOCZNOŚCI pozycji menu względem stanu zalogowania czytelnika.
//
// DLACZEGO OSOBNY MODUŁ: tę samą decyzję podejmują trzy miejsca - normalizacja
// wiersza z bazy (server fn), edytor w panelu i publiczna nawigacja. Jedna
// funkcja = jedna reguła, testowalna bez renderu.
import { MENU_ITEM_VISIBILITIES, type MenuItemVisibility } from "./types";

/** Wartość z bazy (może być pusta / nieznana) sprowadzona do kontraktu. */
export function normalizeMenuVisibility(value: unknown): MenuItemVisibility {
  return typeof value === "string" && (MENU_ITEM_VISIBILITIES as readonly string[]).includes(value)
    ? (value as MenuItemVisibility)
    : "all";
}

/**
 * Czy pozycja pokazuje się temu czytelnikowi.
 * `guest` = tylko niezalogowani (np. „Zarejestruj się"),
 * `auth`  = tylko zalogowani (np. „Mój profil"),
 * `all`   = zawsze.
 */
export function isVisibleForViewer(
  item: { visibility?: MenuItemVisibility | null },
  isAuthenticated: boolean,
): boolean {
  const v = normalizeMenuVisibility(item.visibility);
  if (v === "guest") return !isAuthenticated;
  if (v === "auth") return isAuthenticated;
  return true;
}

/**
 * Filtr płaskiej listy pozycji. Dzieci ukrytej pozycji też znikają - inaczej
 * podpięta pod nią gałąź wróciłaby na najwyższy poziom nawigacji
 * (`buildPublicMenuTree` promuje sieroty).
 */
export function filterMenuItemsForViewer<
  T extends { id: string; parent_id: string | null; visibility?: MenuItemVisibility | null },
>(items: readonly T[], isAuthenticated: boolean): T[] {
  const hidden = new Set<string>();
  for (const it of items) {
    if (!isVisibleForViewer(it, isAuthenticated)) hidden.add(it.id);
  }
  // Kaskada w dół: lista jest posortowana po pozycji, więc dziecko może
  // wyprzedzić rodzica - powtarzamy przebieg aż zbiór przestanie rosnąć.
  let grew = true;
  while (grew) {
    grew = false;
    for (const it of items) {
      if (it.parent_id && hidden.has(it.parent_id) && !hidden.has(it.id)) {
        hidden.add(it.id);
        grew = true;
      }
    }
  }
  return items.filter((it) => !hidden.has(it.id));
}
