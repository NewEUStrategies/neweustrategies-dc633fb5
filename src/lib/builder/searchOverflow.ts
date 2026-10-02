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
//
// TYLKO WIDGET, KTÓRY SIĘ RENDERUJE. Dawna reguła `:has()` pytała DOM, więc
// widget ukryty urządzeniem (`hideOn`), regułą dostępu albo nieaktywną zakładką
// nie zdejmował nikomu clipa. Predykat używa tych samych filtrów co renderer
// (`isRenderedWidget` w `RenderColumn`, dostęp kolumn w `RenderInner`; zakładki
// odsiewa wołający przez `visibleCols`) - inaczej sekcja z wyszukiwarką tylko na
// telefon traciłaby na desktopie ochronę przed wylewaniem treści.

import { evaluateAccess, type AccessContext } from "./accessControl";
import { isRenderedWidget } from "./sectionVisibility";
import type { Device, SectionChild, WidgetNode } from "./types";

export const SEARCH_WIDGET_TYPE = "search-button";

export interface SearchOverflowScope {
  device: Device;
  accessCtx: AccessContext;
}

function rendersSearchWidget(w: WidgetNode, scope: SearchOverflowScope): boolean {
  return w.type === SEARCH_WIDGET_TYPE && isRenderedWidget(w, scope.device, scope.accessCtx);
}

/**
 * Czy kolumna albo sekcja zagnieżdżona RENDERUJE widget wyszukiwarki.
 * Kolumny najwyższego poziomu wołający podaje już po filtrze dostępu i zakładek
 * (`visibleCols`); kolumny sekcji zagnieżdżonej filtrujemy tu, jak `RenderInner`.
 */
export function childHostsSearchWidget(child: SectionChild, scope: SearchOverflowScope): boolean {
  if (child.kind === "column") {
    return (
      Array.isArray(child.children) &&
      child.children.some((w) => !!w && rendersSearchWidget(w, scope))
    );
  }
  if (child.kind === "inner-section") {
    return (
      Array.isArray(child.columns) &&
      child.columns.some(
        (c) =>
          !!c &&
          evaluateAccess(c.advanced?.access, scope.accessCtx) &&
          childHostsSearchWidget(c, scope),
      )
    );
  }
  return false;
}

/** Wartość atrybutu dla Reacta: pusty napis albo brak atrybutu. */
export function searchOverflowAttr(hosts: boolean): "" | undefined {
  return hosts ? "" : undefined;
}
