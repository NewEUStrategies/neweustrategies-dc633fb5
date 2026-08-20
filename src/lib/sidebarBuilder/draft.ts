// Reduktor draftu buildera sidebara - CZYSTE funkcje nad niezmiennym stanem.
//
// PO CO OSOBNY MODUŁ. Do 2026-08-19 cała ta logika żyła wewnątrz
// `SidebarBuilderPane.tsx` jako domknięcia nad `setDraft`, wywoływane wprost
// z `onClick` w JSX-ie. Skutkiem było 0% pokrycia CAŁEJ powierzchni
// (0 z 58 funkcji): żeby v8 zaliczył `moveWidget`, test musiałby wyrenderować
// panel, poczekać na zapytanie o układy i kliknąć konkretną strzałkę - a każda
// kolejna gałąź (ruch poza zakres, id nieistniejące) kosztowałaby osobny
// `fireEvent`. Tu ta sama logika jest tabelą przypadków.
//
// KONTRAKT NIEZMIENNOŚCI. Każda funkcja zwraca NOWY obiekt układu i NOWĄ tablicę
// widgetów, a dla operacji bez skutku zwraca układ REFERENCYJNIE (`===`), żeby
// React nie renderował na próżno. Ten drugi warunek jest testowany jawnie -
// bez niego „no-op" jest tylko w komentarzu.
//
// ID WSTRZYKIWANE. `newWidget` przyjmuje identyfikator jako argument
// (domyślnie `crypto.randomUUID()`), bo test bez tego byłby nierozstrzygalny,
// a produkcja zachowuje się dokładnie jak dotąd.
import {
  DEFAULT_READING_PANEL_SETTINGS,
  type ReadingPanelSettings,
  type SidebarLayout,
  type SidebarWidget,
  type SidebarWidgetType,
} from "./types";

/** Kierunek przesunięcia widgetu na kanwie: w górę (-1) albo w dół (+1). */
export type MoveDirection = -1 | 1;

/**
 * Ustawienia domyślne nowego widgetu. Panel czytania dostaje PEŁNY zestaw
 * przełączników (kopię, nie referencję - dwa panele w jednym układzie nie mogą
 * dzielić obiektu ustawień), pozostałe typy startują puste.
 */
export function defaultSettingsFor(type: SidebarWidgetType): Record<string, unknown> {
  if (type === "reading-panel") return { ...DEFAULT_READING_PANEL_SETTINGS };
  return {};
}

/** Nowy widget wskazanego typu. Identyfikator wstrzykiwany - patrz nagłówek. */
export function newWidget(
  type: SidebarWidgetType,
  id: string = crypto.randomUUID(),
): SidebarWidget {
  return { id, type, hidden: false, settings: defaultSettingsFor(type) };
}

/** Kopia układu do edycji - tablica widgetów odczepiona od danych zapytania. */
export function draftFromLayout(layout: SidebarLayout | null | undefined): SidebarLayout | null {
  return layout ? { ...layout, widgets: [...layout.widgets] } : null;
}

/** Układ, który panel otwiera na start: domyślny, a gdy go nie ma - pierwszy. */
export function pickDefaultLayout(
  layouts: readonly SidebarLayout[] | null | undefined,
): SidebarLayout | null {
  if (!layouts?.length) return null;
  return layouts.find((l) => l.is_default) ?? layouts[0];
}

/** Widget zaznaczony po wczytaniu układu - pierwszy z listy albo żaden. */
export function initialSelection(layout: SidebarLayout | null | undefined): string | null {
  return layout?.widgets[0]?.id ?? null;
}

/** Dokłada widget na KONIEC układu. */
export function addWidget(layout: SidebarLayout, widget: SidebarWidget): SidebarLayout {
  return { ...layout, widgets: [...layout.widgets, widget] };
}

/**
 * Przesuwa widget o jedną pozycję. Zwraca układ BEZ ZMIAN (referencyjnie), gdy
 * ruch nie ma sensu: id nieistniejące, „w górę" z pozycji 0, „w dół" z ostatniej.
 */
export function moveWidget(layout: SidebarLayout, id: string, dir: MoveDirection): SidebarLayout {
  const idx = layout.widgets.findIndex((w) => w.id === id);
  if (idx < 0) return layout;
  const target = idx + dir;
  if (target < 0 || target >= layout.widgets.length) return layout;
  const widgets = [...layout.widgets];
  [widgets[idx], widgets[target]] = [widgets[target], widgets[idx]];
  return { ...layout, widgets };
}

/** Usuwa widget. Id nieistniejące to no-op, nie wyjątek. */
export function deleteWidget(layout: SidebarLayout, id: string): SidebarLayout {
  if (!layout.widgets.some((w) => w.id === id)) return layout;
  return { ...layout, widgets: layout.widgets.filter((w) => w.id !== id) };
}

/** Przełącza ukrycie widgetu. Podwójne przełączenie wraca do stanu wyjściowego. */
export function toggleHidden(layout: SidebarLayout, id: string): SidebarLayout {
  if (!layout.widgets.some((w) => w.id === id)) return layout;
  return {
    ...layout,
    widgets: layout.widgets.map((w) => (w.id === id ? { ...w, hidden: !w.hidden } : w)),
  };
}

/**
 * Scala CZĘŚCIOWY patch ustawień widgetu. Pola nietknięte muszą przeżyć - to
 * jest ten błąd, który cicho zeruje przełączniki panelu czytania, gdy inspektor
 * wysyła jeden klucz, a reduktor podmienia cały obiekt.
 */
export function updateWidgetSettings(
  layout: SidebarLayout,
  id: string,
  partial: Record<string, unknown>,
): SidebarLayout {
  if (!layout.widgets.some((w) => w.id === id)) return layout;
  return {
    ...layout,
    widgets: layout.widgets.map((w) =>
      w.id === id ? { ...w, settings: { ...w.settings, ...partial } } : w,
    ),
  };
}

/** Zaznaczenie po usunięciu widgetu: czyścimy tylko wtedy, gdy usunięto ten wybrany. */
export function selectionAfterDelete(
  currentSelection: string | null,
  deletedId: string,
): string | null {
  return currentSelection === deletedId ? null : currentSelection;
}

/**
 * Pełne ustawienia panelu czytania na podstawie tego, co realnie leży w bazie.
 *
 * Scalenie jest DWUPOZIOMOWE i to jest cały sens tej funkcji: `social` jest
 * obiektem, więc pojedynczy spread nadpisałby całą mapę przełączników
 * społecznościowych patchem, który niesie JEDEN klucz - i pozostałe siedem
 * przycisków udostępniania zniknęłoby ze sidebara bez żadnego błędu. Funkcja
 * żyła jako wyrażenie inline w JSX-ie inspektora, czyli w miejscu, którego
 * nie da się przetestować tabelą.
 */
export function resolveReadingPanelSettings(settings: unknown): ReadingPanelSettings {
  const partial = (settings ?? {}) as Partial<ReadingPanelSettings>;
  return {
    ...DEFAULT_READING_PANEL_SETTINGS,
    ...partial,
    social: { ...DEFAULT_READING_PANEL_SETTINGS.social, ...(partial.social ?? {}) },
  };
}
