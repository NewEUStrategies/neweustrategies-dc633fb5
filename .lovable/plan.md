
# Refaktor edytora CMS do atomic design

Cel: rozbić cztery monolity (`Builder.tsx`, `WidgetView.tsx`, `WidgetProperties.tsx`, `SectionProperties.tsx`) i przenieść pozostałe pliki edytora do spójnej hierarchii `atoms / molecules / organisms`, bez zmian w funkcjonalności i UI.

## Docelowa struktura

```text
src/components/admin/builder/
  ui/
    atoms/         # małe, jednofunkcyjne (input pól, ikony, badge)
      ColorField.tsx              (istnieje)
      PropField.tsx               (istnieje)
      ResponsiveInput.tsx         (istnieje)
      Segmented.tsx               (istnieje)
      Row.tsx                     (nowe, z SectionProperties)
      ColorInput.tsx              (nowe, z SectionProperties)
      NumberInput.tsx             (nowe, z SectionProperties)
      SidesInput.tsx              (nowe, z SectionProperties)
      Collapsible.tsx             (nowe, wspólne dla SectionProperties + WidgetProperties)
      IconBtn.tsx                 (nowe, z Builder.tsx)
      ItemFrame.tsx               (nowe, z WidgetProperties)
      ImageSlot.tsx               (nowe, z WidgetProperties)
    molecules/
      HoverControl.tsx            (istnieje)
      MotionControl.tsx           (istnieje)
      SpacingControl.tsx          (istnieje)
      TypographyControl.tsx       (istnieje)
      VisibilityControl.tsx       (istnieje)
      SchemaFieldControl.tsx      (istnieje)
      BackgroundEditor.tsx        (nowe, z SectionProperties)
      OverlayEditor.tsx           (nowe)
      BorderEditor.tsx            (nowe)
      ShapeEditor.tsx             (nowe)
      TypographyEditor.tsx        (nowe)
      ListShell.tsx               (nowe, z WidgetProperties)
      Editable.tsx                (nowe, z WidgetView - inline editing)
      TtsPlayerHost.tsx           (nowe, z WidgetView)
    organisms/
      Toolbar.tsx                 (z Builder)
      CanvasActionBar.tsx         (z Builder)
      EmptyState.tsx              (z Builder)
      SectionDropZone.tsx         (z Builder)
      ChromeFrame.tsx             (z Builder)
      SectionView.tsx             (z Builder)
      InnerSectionView.tsx        (z Builder)
      ColumnView.tsx              (z Builder)
      SortableWidget.tsx          (z Builder)
      VisualCanvas.tsx            (z Builder)
      Navigator.tsx               (przeniesienie)
      WidgetLibrary.tsx           (przeniesienie)
      StructurePicker.tsx         (przeniesienie)
      TemplateHistoryDialog.tsx   (przeniesienie)
      BuilderRenderer.tsx         (przeniesienie)
      ColumnProperties.tsx        (przeniesienie)
      section-properties/
        SectionProperties.tsx     (cienki orchestrator)
        LayoutPane.tsx
        StylePane.tsx
        AdvancedPane.tsx
      widget-properties/
        WidgetProperties.tsx      (cienki orchestrator + tabs)
        ContentFields.tsx
        editors/
          AccordionEditor.tsx
          TabsEditor.tsx
          PricingEditor.tsx
          RatedListEditor.tsx
          ImageEditor.tsx
          SectionLabelEditor.tsx
          SliderEditor.tsx
          AnimatedHeadingEditor.tsx
      widget-view/
        WidgetView.tsx            (cienki dispatcher po typie widgetu)
        PostListView.tsx
        RatedListView.tsx
        CategoriesView.tsx
        TagsView.tsx
        TabsBlock.tsx
        motion.ts                 (MOTION_INITIAL/FINAL, EASING_MAP)
        frame.ts                  (getWidgetFrameStyle, styleToCSS, hiddenOnDevice, helpers)
  Builder.tsx                     (cienki kontener: state, DnD, history, props)
```

Reguły:
- atoms: bez zależności od stanu edytora, czyste prezentacyjne primitivy.
- molecules: złożenia atomów dla jednej sekcji edytora właściwości.
- organisms: kawałki UI edytora świadome `BuilderValue`, `SectionNode`, `WidgetNode`, DnD, historii.

## Kroki (każdy krok = osobny, zielony build)

1. Atomy współdzielone
   - Wyciągnąć `Row`, `ColorInput`, `NumberInput`, `SidesInput`, `Collapsible` z `SectionProperties` do `ui/atoms/*`.
   - Wyciągnąć `IconBtn` z `Builder.tsx`, `ItemFrame`, `ImageSlot` z `WidgetProperties` do `ui/atoms/*`.
   - Podmienić importy w pierwotnych plikach. Bez zmian logiki.

2. Rozbicie `SectionProperties.tsx`
   - Przenieść `BackgroundEditor`, `OverlayEditor`, `BorderEditor`, `ShapeEditor`, `TypographyEditor` do `ui/molecules/*`.
   - Przenieść `LayoutPane`, `StylePane`, `AdvancedPane` do `ui/organisms/section-properties/*`.
   - `SectionProperties.tsx` (orchestrator) ląduje w `ui/organisms/section-properties/`, stary plik staje się re-eksportem (`export { SectionProperties } from "./ui/organisms/section-properties/SectionProperties"`) dla zachowania importów w `Builder.tsx`.

3. Rozbicie `WidgetView.tsx`
   - Wydzielić helpery do `ui/organisms/widget-view/frame.ts` (`styleToCSS`, `pickSize`, `toCssSize`, `getWidgetFrameStyle`, `hiddenOnDevice`, `getStr/getNum/getStrArr`, `normalizeNewsletterVariant`, stałe `DEFAULT_*`, `AUTO_SIZE_WIDGETS`).
   - `motion.ts`: `MOTION_INITIAL`, `MOTION_FINAL`, `EASING_MAP`.
   - `Editable.tsx`, `TtsPlayerHost.tsx` do `ui/molecules/`.
   - Każdy „sub-view" (`PostListView`, `RatedListView`, `CategoriesView`, `TagsView`, `TabsBlock`) do `ui/organisms/widget-view/*`.
   - Pozostawić cienki `WidgetView` z dużym `switch(node.type)`.
   - Stary `WidgetView.tsx` zamienić na re-eksport (zachowane `import { WidgetView, getWidgetFrameStyle, styleToCSS, hiddenOnDevice } from "./WidgetView"`).

4. Rozbicie `WidgetProperties.tsx`
   - `ContentFields` + `itemsOf`, `ListShell` do `ui/molecules/`.
   - Każdy edytor (`AccordionEditor`, `TabsEditor`, `PricingEditor`, `RatedListEditor`, `ImageEditor`, `SectionLabelEditor`, `SliderEditor`, `AnimatedHeadingEditor`) do `ui/organisms/widget-properties/editors/*`.
   - Cienki `WidgetProperties` w `ui/organisms/widget-properties/`, re-eksport w pierwotnej lokalizacji.

5. Rozbicie `Builder.tsx`
   - Przenieść `Toolbar`, `CanvasActionBar`, `EmptyState`, `SectionDropZone`, `ChromeFrame`, `SectionView`, `InnerSectionView`, `ColumnView`, `SortableWidget`, `VisualCanvas` do `ui/organisms/*`.
   - W `Builder.tsx` zostaje wyłącznie: typy `Props`, state (history, selection, clipboard, device, hover), DnD sensors+handlery, hot-keys, render `VisualCanvas` + sidebary.

6. Przeniesienie pozostałych plików
   - `BuilderRenderer.tsx`, `ColumnProperties.tsx`, `Navigator.tsx`, `WidgetLibrary.tsx`, `StructurePicker.tsx`, `TemplateHistoryDialog.tsx` → `ui/organisms/*`.
   - W starych ścieżkach zostawić re-eksporty (jednolinijkowe), żeby nie ruszać importów z `routes/admin.*`.

7. Sprzątanie
   - Zaktualizować `src/components/admin/builder/ui/atoms/index.ts` i `molecules/index.ts` (utworzyć `organisms/index.ts`) z barrel-exportami.
   - Po przejściu wszystkich kroków usunąć re-eksporty tam, gdzie da się szybko podmienić importy (`BuilderRenderer` używany m.in. w `Builder.tsx`, `PostLayoutRenderer.tsx` — punktowa podmiana).

## Bezpieczeństwo zmian

- Brak zmian w runtime / UI / typach publicznych. Tylko podział plików i przeniesienie funkcji.
- Każdy krok kończy się działającym buildem (re-eksporty zapewniają wsteczną kompatybilność importów).
- Bez zmian w `lib/builder/*`, RLS, danych, motywach.

## Szacunek skali

- ~30 nowych plików, 4 monolity stają się cienkimi orchestratorami (~150 linii każdy).
- 6 plików przeniesionych do `organisms/` z re-eksportami w starych ścieżkach.
- Brak zmian w API komponentów.

Zatwierdź plan, a wykonam kroki 1-7 po kolei.
