// Które opakowania renderera niosą widget wyszukiwarki - znacznik
// `data-search-overflow` liczony z DANYCH dokumentu, a nie z DOM-u.
//
// PO CO. Sekcje, wiersze kolumn i sloty kolumn mają `overflow-hidden`, a pływająca
// etykieta, obwódka fokusu i popover wyszukiwarki wychodzą poza pole. Efekt
// w `SearchButtonWidget` oznacza przodków dopiero po hydratacji, więc pierwsza
// klatka z SSR przycinała pole. Łatała to reguła `:has(.builder-search-widget)`
// w `styles.css`, ale sama obecność `:has()` w publicznym arkuszu podnosi koszt
// każdego pełnego przeliczenia stylu ~70x (bramka `noHasSelectors`). Renderer zna
// drzewo z góry, więc wypisuje znacznik już w HTML-u SSR - ta sama reguła
// `[data-search-overflow]:not([data-reading-row])` działa od pierwszej klatki.

import type { SectionChild, WidgetNode } from "./types";

export const SEARCH_WIDGET_TYPE = "search-button";

function isSearchWidget(w: WidgetNode): boolean {
  return w.type === SEARCH_WIDGET_TYPE;
}

/** Czy kolumna albo sekcja zagnieżdżona zawiera widget wyszukiwarki. */
export function childHostsSearchWidget(child: SectionChild): boolean {
  if (child.kind === "column") {
    return Array.isArray(child.children) && child.children.some((w) => !!w && isSearchWidget(w));
  }
  if (child.kind === "inner-section") {
    return (
      Array.isArray(child.columns) && child.columns.some((c) => !!c && childHostsSearchWidget(c))
    );
  }
  return false;
}

/** Wartość atrybutu dla Reacta: pusty napis albo brak atrybutu. */
export function searchOverflowAttr(hosts: boolean): "" | undefined {
  return hosts ? "" : undefined;
}
