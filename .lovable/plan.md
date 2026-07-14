
# Kontenery z zakładkami w Builderze

Rozszerzenie hierarchii Buildera o nowy poziom "Container" znajdujący się nad sekcjami. Container może pracować jako pojedynczy blok albo jako kontener zakładek — w każdej zakładce można umieszczać sekcje, a w sekcjach kolumny/widgety (bez zmian w istniejącej sekcji).

## Nowa hierarchia

```text
Document
├── Section                (istniejące, bez zmian)
└── Container (nowe)
    ├── (tryb bez zakładek) → children: Section[]
    └── (tryb tabs)
        └── tabs: [{ id, label_pl, label_en, ... }]
            └── każda sekcja ma tabId → filtrowanie w rendererze
```

Container nigdy nie zawiera widgetów bezpośrednio — tylko sekcje. Zachowuje to spójność: widgety zawsze siedzą w kolumnach sekcji.

## Data model

- Nowy interfejs `ContainerNode { id, kind: "container", layout?, background?, border?, tabs?: ContainerTabsConfig, children: SectionNode[] }`.
- `ContainerTabsConfig` = ten sam kształt co `SectionTabsConfig` (orientation, variant, align, mobileMode, items, defaultTabId) — reużycie typu.
- `SectionNode.tabId?: string` już istnieje w kolumnach; dodajemy ten sam pattern (`tabId`) na poziomie `SectionNode` gdy jest dzieckiem Container-with-tabs.
- `BuilderDocument.nodes: (SectionNode | ContainerNode)[]` — migracja wsteczna: gdy dokument ma pole `sections`, czytamy je jako `nodes` (kompatybilność publikowanych stron).

## UI - WidgetLibrary (lewy panel)

Nowa sekcja **"Nowy kontener"** dodana NAD "Nowa sekcja - wybierz strukturę":

- Przycisk "Kontener" - wstawia pusty Container z jedną sekcją w środku.
- Przycisk "Kontener z zakładkami" - wstawia Container w trybie tabs (2 zakładki, w każdej pusta sekcja placeholder).
- Oba draggable (DnD do canvasa), z podglądem ikony.

## Renderer

`BuilderRenderer` iteruje po `nodes[]`:
- `SectionNode` → renderuje jak dziś.
- `ContainerNode` → wrapper z tłem/bordurem, jeśli `tabs.enabled` renderuje `SectionTabsBar` (reużycie molekułu) + panel z sekcjami filtrowanymi po `activeTabId`.
- Sekcje w kontenerze renderują się przez ten sam `RenderSection` co obecnie.

## Canvas (edytor)

- `VisualCanvas` obsługuje selekcję nowego typu `"container"`.
- Drop-target logic: sekcje można upuszczać wewnątrz Container-tab-panel (nie tylko na root).
- Overlay "add section" w każdym pustym tabie kontenera.
- Selection kind rozszerzony w `builder/types.ts`: `"section" | "column" | "widget" | "inner-section" | "container"`.

## Properties (prawy panel)

Nowy komponent `ContainerProperties`:
- Zakładka **Zakładki** - reużycie `TabsPane` (parametryzowany dla ContainerNode).
- Zakładka **Styl** - tło, border, spacing (podzestaw `StylePane`).
- Zakładka **Zaawans.** - anchor id, css classes, visibility.

## Persistence / migracje

- Reader: `sections` (stary) → mapowany na `nodes` transparentnie w `emptyDocument` loader; writer zapisuje `nodes` ORAZ `sections` (dublet, na czas przejścia i wstecznej kompatybilności publikowanych stron).
- Bez migracji SQL — pole `builder_data` to JSONB, kształt walidowany po stronie klienta.

## i18n / a11y

- Etykiety kontenerów w PL/EN (`label_pl`, `label_en` w tab items).
- `role="tablist"` już zapewniony przez `SectionTabsBar`.
- Wszystkie stringi UI edytora tłumaczone (PL + EN keys w `builder.*`).

## Testy

- `containerNode.test.ts` - shape + migracja `sections → nodes`.
- `BuilderRenderer.container.test.tsx` - render trybu bez tabs, render z tabs (filtrowanie sekcji).
- `WidgetLibrary.container.test.tsx` - obecność przycisków "Nowy kontener".

## Pliki do utworzenia

- `src/components/admin/builder/ui/organisms/ContainerPicker.tsx` (nowe przyciski w WidgetLibrary).
- `src/components/admin/builder/ui/organisms/container-properties/ContainerProperties.tsx`.
- `src/components/admin/builder/ui/organisms/container-properties/ContainerTabsPane.tsx` (adapter do reużytego TabsPane).
- `src/components/admin/builder/ui/organisms/RenderContainer.tsx` (organism renderujący Container).

## Pliki do modyfikacji

- `src/lib/builder/types.ts` - ContainerNode, ContainerTabsConfig, nodes[], migracja loader.
- `src/lib/builder/registry.ts` (jeśli potrzebne dla drag-source containera).
- `src/components/admin/builder/ui/organisms/WidgetLibrary.tsx` - sekcja "Nowy kontener" nad "Nowa sekcja".
- `src/components/admin/builder/ui/organisms/BuilderRenderer.tsx` - iteracja po `nodes[]` zamiast `sections[]`.
- `src/components/admin/builder/ui/organisms/builder/VisualCanvas.tsx` - drop-target dla sekcji w kontenerze, selection kind.
- `src/components/admin/builder/ui/organisms/builder/types.ts` - `SelectionKind` += `"container"`.
- `src/components/admin/builder/Builder.tsx` - obsługa selekcji Container, akcje CRUD (add/duplicate/delete container).

## Notatki techniczne

- Container jest opcjonalnym opakowaniem - domyślnie użytkownik nadal dodaje sekcje bezpośrednio. Kontener wybiera świadomie, gdy potrzebuje tabs na wielu sekcjach naraz (odróżnienie od "Section as Tab Container" z poprzedniej iteracji: tam tabs były wewnątrz JEDNEJ sekcji, tu tabs grupują wiele sekcji).
- Reużycie `SectionTabsBar` molekułu - zero duplikacji CSS/keyboard nav.
- `mobileMode: "scroll" | "wrap"` (dodane w poprzedniej turze) propaguje się automatycznie.
- Zachowanie DnD z paletą struktur: upuszczenie struktury nad pustym Container-tab tworzy sekcję w tym tabie.
