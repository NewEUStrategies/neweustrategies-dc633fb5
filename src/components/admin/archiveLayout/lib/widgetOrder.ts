// Reguły listy widgetów panelu bocznego archiwum: włączanie, wyłączanie i
// zmiana kolejności.
//
// DLACZEGO OSOBNY MODUŁ. Obie reguły siedziały w ciele `ArchiveLayoutAdmin.tsx`
// jako domknięcia nad `setDraft`, więc jedyną drogą do nich było wyrenderowanie
// całego panelu z react-query, podglądem na żywo i rejestrem układów. Efekt:
// funkcjonalność „Szablony stron i archiwów" stała na 3,7% linii - najniżej
// w całym module 4 - a razem z nią reguła decydująca o TYM, CO widzi czytelnik
// w panelu bocznym kategorii i w jakiej kolejności.
//
// Obie funkcje są czyste i NIE MUTUJĄ wejścia: panel trzyma listę w stanie
// Reacta, więc mutacja w miejscu nie wywołałaby ponownego renderu.
import type { SidebarWidgetKey } from "@/lib/archive-layout-settings";

/**
 * Przesuwa widget o jedno miejsce w podanym kierunku.
 *
 * Zwraca WEJŚCIOWĄ tablicę (tę samą referencję), gdy ruch jest niemożliwy -
 * widgetu nie ma na liście albo stoi już na skraju. Dzięki temu panel nie
 * odnotowuje zmiany tam, gdzie nic się nie zmieniło.
 */
export function moveWidget(
  widgets: readonly SidebarWidgetKey[],
  key: SidebarWidgetKey,
  direction: -1 | 1,
): readonly SidebarWidgetKey[] {
  const index = widgets.indexOf(key);
  if (index < 0) return widgets;
  const next = index + direction;
  if (next < 0 || next >= widgets.length) return widgets;
  const out = [...widgets];
  [out[index], out[next]] = [out[next], out[index]];
  return out;
}

/**
 * Włącza lub wyłącza widget.
 *
 * Włączenie dokłada go NA KOŃCU (redaktor porządkuje kolejność osobno), a
 * ustawienie stanu, który już obowiązuje, oddaje wejściową tablicę - bez tego
 * ponowne kliknięcie w ten sam przełącznik duplikowałoby wpis.
 */
export function toggleWidget(
  widgets: readonly SidebarWidgetKey[],
  key: SidebarWidgetKey,
  enabled: boolean,
): readonly SidebarWidgetKey[] {
  const has = widgets.includes(key);
  if (enabled && !has) return [...widgets, key];
  if (!enabled && has) return widgets.filter((w) => w !== key);
  return widgets;
}
