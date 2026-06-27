## Stan obecny

- **Treść bloków**: już w pełni rozdzielona per język - `LocalizedBlocks { pl: BlocksDoc, en: BlocksDoc }` (wpisy) i ten sam model w widgecie `rich-text` buildera. Każdy blok ma niezależne dane w PL i EN, edytor ma zakładki PL/EN z odizolowaną historią undo/redo. Renderery (`BlocksRenderer`, `PostLayoutRenderer`, `RichTextView`) dostają `lang` i wybierają właściwy dokument.
- **Etykiety / placeholdery w edytorze**: ~58 plików w `src/components/admin/blocks/edit/` zawiera ~162 hardkodowane polskie placeholdery oraz dziesiątki napisów JSX ("Pozycja mediów:", "Wysokość:", "Dodaj pytanie" itp.).
- **Statyczne napisy w widokach publicznych**: część (`InteractiveViews`, `ContactFormView`, `AuthFormBlocks`, `FoxizExtraViews`) ma własne mapy PL/EN po `lang`; reszta (`MarketingViews`, `ConversionViews`, `DataSocialViews`, `PresentationViews`) używa hardkodowanych etykiet (np. "Wyślij", "Zobacz więcej", "Zapisz się").
- **Locale**: `blocks.*` namespace istnieje (`src/lib/locale/pl.ts` + `en.ts`), ale pokrywa tylko `actions`, `sidebar`, `types`, `settings` (~25 kluczy).

## Cel

Każdy blok renderuje treść we właściwym języku (już działa), a wszystkie etykiety i placeholdery w edytorze oraz statyczne napisy w widokach publicznych mają tłumaczenia PL/EN przez i18next.

## Zakres prac

### 1. Rozbudowa namespace `blocks` w locale (PL + EN)

Dodać podsekcje (jednorazowy ~200-liniowy patch w `pl.ts` i `en.ts`):

- `blocks.fields.*` - wspólne pola formularzy: `url`, `urlPh`, `alt`, `caption`, `title`, `subtitle`, `description`, `label`, `href`, `eyebrow`, `ctaLabel`, `ctaUrl`, `secondaryCtaLabel`, `secondaryCtaUrl`, `imageUrl`, `coverUrl`, `posterUrl`, `videoUrl`, `audioUrl`, `fileUrl`, `embedUrl`, `mapAddress`, `latitude`, `longitude`, `zoom`, `height`, `width`, `count`, `columns`, `rows`, `target`, `rel`, `placeholder`, `requiredField`, `optional`.
- `blocks.ui.*` - przyciski edytora: `add`, `addItem`, `remove`, `duplicate`, `moveUp`, `moveDown`, `expand`, `collapse`, `preview`, `edit`, `reset`, `chooseImage`, `chooseFile`, `pickIcon`, `chooseVariant`, `defaultOpen`, `openInNewTab`, `noFollow`, `loop`, `autoplay`, `muted`, `controls`.
- `blocks.editors.*` - per-blok specyfika (po jednym sub-namespace na typ): `hero`, `cta`, `mediaText`, `cover`, `gallery`, `accordion`, `tabs`, `countdown`, `pricing`, `testimonials`, `timeline`, `teamGrid`, `logoGrid`, `featureGrid`, `alertBanner`, `dividerText`, `stepList`, `comparisonTable`, `bannerImage`, `videoHero`, `quote`, `pullquote`, `spoiler`, `details`, `newsletter`, `searchWidget`, `tagCloud`, `archivesWidget`, `calendarWidget`, `xquote`, `mapWidget`, `contactForm`, `iconBox`, `statsCounter`, `imageCarousel`.
- `blocks.viewers.*` - statyczne napisy w widokach publicznych: `submit`, `sending`, `success`, `error`, `loadMore`, `readMore`, `subscribe`, `subscribed`, `viewAll`, `dismiss`, `closed`, `comingSoon`, `days`, `hours`, `minutes`, `seconds`.

### 2. Helper hook

`src/lib/blocks/i18n.ts` - cienki wrapper na `useTranslation()` z `tField(key)`, `tUi(key)`, `tEditor(blockType, key)`, `tViewer(key)`. Eliminuje powtarzane prefiksy i daje typowanie kluczy.

### 3. Migracja edytorów (`src/components/admin/blocks/edit/*`)

Wszystkie 58 plików: zamienić każdy hardkodowany `placeholder="..."`, label JSX i `title=""` na `t("blocks.fields.*" | "blocks.ui.*" | "blocks.editors.<blok>.*")`. Bez zmian logiki - tylko warstwa prezentacji.

### 4. Migracja widoków publicznych (`src/components/blocks/*`)

Pliki bez per-lang map (`MarketingViews.tsx`, `ConversionViews.tsx`, `DataSocialViews.tsx`, `PresentationViews.tsx`, `NavLoopViews.tsx` w częściach statycznych): zastąpić literały `t("blocks.viewers.*")`. Pliki, które mają już własne mapy PL/EN (`InteractiveViews`, `ContactFormView`, `AuthFormBlocks`, `FoxizExtraViews`), pozostają na własnym `lang`-switch (wyświetlają treść w języku dokumentu, a nie UI usera) - tylko etykiety przycisków admin-side trafiają do i18next.

### 5. Testy

- `src/lib/blocks/__tests__/i18n.test.ts` - assert: każdy klucz `blocks.fields.*`, `blocks.editors.*`, `blocks.viewers.*` istnieje w PL i EN, brak rozjazdów.
- Aktualizacja `BlocksRenderer.test.tsx` - smoke render bloków hero/cta/contact-form z `lang="en"` weryfikujący brak polskich napisów.

### 6. QA

`bun run typecheck` + `bun test` (oczekiwane: 0 błędów, wszystkie istniejące suity zielone).

## Szczegóły techniczne

```text
src/lib/locale/pl.ts                  # +~200 linii kluczy blocks.{fields,ui,editors,viewers}.*
src/lib/locale/en.ts                  # +~200 linii (lustro)
src/lib/blocks/i18n.ts                # nowy helper (~40 linii)
src/components/admin/blocks/edit/*    # 58 plików - find/replace strings -> t(...)
src/components/blocks/*Views.tsx      # 4-5 plików - statyczne napisy -> t(...)
src/lib/blocks/__tests__/i18n.test.ts # nowy test parytetu kluczy
```

Brak zmian schematów, brak zmian danych użytkowników, brak migracji DB.

## Ryzyka i nie-cele

- Treść użytkownika (tytuły, opisy w danych bloku) **nie jest** automatycznie tłumaczona - autor wpisuje PL i EN osobno (tak jak teraz).
- Nie ruszamy buildera Elementor (`src/components/admin/builder/**`) - osobny system, ma własne UI i własną i18n.
- Nie zmieniamy `BlocksRenderer` core logic - tylko podmiana literałów.

## Szacowany rozmiar

~65-70 plików zmienionych, ~1.5-2k linii diff (głównie mechaniczne zamiany).
