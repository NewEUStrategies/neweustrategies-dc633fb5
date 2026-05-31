# Przebudowa CMS na model Elementora

## Cel
Edytor wpisów i stron działający jak Elementor: **lewy panel** = biblioteka widgetów + edycja właściwości zaznaczonego elementu (kontekstowo), **prawa strona** = canvas z żywym podglądem sekcji, kolumn, widgetów. Aktualny układ trzykolumnowy (widgety | canvas | właściwości) zostaje zastąpiony klasycznym układem dwukolumnowym Elementora.

## Co już mamy (zachowujemy)
- Model danych `BuilderDocument` (sections → columns/inner-sections → widgets) — `src/lib/builder/types.ts`
- 14 widgetów (heading, text, image, button, spacer, video, gallery, icon, map, post-list, carousel, newsletter, cta, contact) — `src/lib/builder/registry.tsx`
- Renderowanie publiczne 1:1 z edytorem — `src/components/admin/builder/BuilderRenderer.tsx` + `src/lib/builder/sectionStyles.tsx`
- Panel właściwości sekcji (Layout / Style / Advanced) — `SectionProperties.tsx`
- Auto-save, podgląd urządzeń (desktop/tablet/mobile), przełącznik języka PL/EN
- Persystencja w `posts.builder_data` i `pages.builder_data` (jsonb)

## Co budujemy

### 1. Nowy układ Elementora (`Builder.tsx` — przepisany)

```text
┌──────────────────┬─────────────────────────────────────────┐
│  LEWY PANEL      │   PRAWY CANVAS (przewijalny)            │
│  (360px,         │                                          │
│   2 tryby)       │   ┌─ SEKCJA ────────────────────┐        │
│                  │   │ [+] [⋮⋮] [⚙] [✕]          │        │
│  TRYB A:         │   │ ┌─ kolumna ─┐ ┌─ kolumna ─┐│        │
│  Biblioteka      │   │ │ widget    │ │ widget    ││        │
│  widgetów        │   │ │ widget    │ │           ││        │
│  + struktury     │   │ └───────────┘ └───────────┘│        │
│  sekcji          │   └────────────────────────────┘        │
│                  │                                          │
│  TRYB B:         │   [ + Dodaj sekcję ]                    │
│  Edycja          │                                          │
│  zaznaczonego    │                                          │
│  elementu        │   Toolbar góra: PL/EN | 🖥 📱 | 💾 | 👁  │
│  (Content/Style/ │                                          │
│   Advanced)      │                                          │
│                  │                                          │
│  Drzewko Nav     │                                          │
│  (Navigator)     │                                          │
│  na dole         │                                          │
└──────────────────┴─────────────────────────────────────────┘
```

**Lewy panel** przełącza się automatycznie:
- Nic nie zaznaczone → biblioteka widgetów + struktury sekcji (grid 2 kolumn, search, kategorie: Basic/Pro/Media/Dynamic/Form)
- Zaznaczona sekcja/kolumna/widget → panel właściwości tego elementu z zakładkami Content/Style/Advanced + breadcrumb (Sekcja > Kolumna > Widget) + przycisk powrotu do biblioteki

**Prawy canvas**: aktualny `SectionView` zostaje, dostaje:
- Pływające „handle" sekcji u góry (dodaj, duplikuj, kopiuj/wklej, ustawienia, usuń) — Elementor-style
- Handle kolumny po najechaniu (szerokość, ustawienia, usuń)
- Handle widgetu (edytuj, duplikuj, usuń, przeciągnij)
- Strefy „+" między sekcjami do wstawiania nowych

### 2. Navigator (drzewko warstw)
Panel u dołu lewej kolumny (zwijalny) pokazujący strukturę dokumentu jako drzewo:
```
▾ Sekcja 1
  ▾ Kolumna (12)
    • Heading
    • Text
  ▾ Kolumna (12)
    • Image
▾ Sekcja 2
```
Klik na element = zaznaczenie + scroll canvasa do niego. Ikony widoczności/ukrycia per element.

### 3. Drag & drop z biblioteki na canvas
Aktualnie widget dodaje się klikiem do „focused column". Dodajemy też:
- Przeciąganie z biblioteki na konkretną kolumnę / strefę między sekcjami
- Przeciąganie istniejących widgetów między kolumnami (nie tylko w obrębie jednej)
- Wizualne strefy upuszczenia (drop indicators) podczas przeciągania

### 4. Pełne właściwości widgetów (Content/Style/Advanced)
Aktualnie panel właściwości widgetu jest uproszczony. Rozbudowujemy każdy widget o pełne pola Elementora:
- **Content**: pola specyficzne dla widgetu (już są, doszlifowanie)
- **Style**: typografia (font, rozmiar, weight, line-height, letter-spacing per device), kolor, tło, border, padding, margin, shadow
- **Advanced**: ID, klasy CSS, animacje wejścia, responsive visibility, motion effects, custom CSS

### 5. Ustawienia kolumn (nowe)
Panel właściwości dla zaznaczonej kolumny: szerokość % (desktop/tablet/mobile), padding, margin, tło, border, vertical align, HTML tag.

### 6. Historia (Undo/Redo) i kopiuj/wklej
- Skróty Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z
- Stos historii (last N=50 stanów dokumentu)
- Kopiuj/wklej sekcji i widgetu (clipboard w `sessionStorage` — żeby działało między wpisami)
- Duplikuj sekcję/kolumnę/widget

### 7. Zapisywanie szablonów (opcja na później — flaga)
Pomijam w tej iteracji, dodam tylko miejsce w UI („Zapisz jako szablon" — disabled placeholder).

## Pliki

### Nowe
- `src/components/admin/builder/BuilderLayout.tsx` — układ 2-kolumnowy + toolbar
- `src/components/admin/builder/LeftPanel.tsx` — przełącznik trybów (Library / Properties / Navigator)
- `src/components/admin/builder/WidgetLibrary.tsx` — wyciągnięte z aktualnego Builder.tsx
- `src/components/admin/builder/Navigator.tsx` — drzewko warstw
- `src/components/admin/builder/Canvas.tsx` — sam canvas z sekcjami
- `src/components/admin/builder/SectionHandles.tsx` — pływające kontrolki sekcji
- `src/components/admin/builder/ColumnProperties.tsx` — panel właściwości kolumny
- `src/components/admin/builder/WidgetProperties.tsx` — wyciągnięte z Builder.tsx, rozbudowane
- `src/lib/builder/useHistory.ts` — undo/redo
- `src/lib/builder/clipboard.ts` — kopiuj/wklej (sessionStorage)
- `src/lib/builder/dnd.ts` — helpery DnD (move/insert/drop zones)

### Modyfikowane
- `src/components/admin/builder/Builder.tsx` — staje się thin orkiestratorem (state + composition)
- `src/lib/builder/types.ts` — dodanie pól typografii widgetów (`style.typography` per device)
- `src/components/admin/builder/SectionProperties.tsx` — bez zmian (już działa)

### Bez zmian
- `BuilderRenderer.tsx` (publiczny render) — kontrakt danych nie ulega zmianie
- `sectionStyles.tsx` — używane przez canvas i renderer

## Kompatybilność danych
Wszystkie zmiany są addytywne w schemacie JSON `builder_data`. Stare dokumenty wczytają się bez migracji — nowe pola mają wartości domyślne. **Brak migracji DB**.

## Zakres NIE w tej iteracji
- Biblioteka gotowych szablonów sekcji i stron
- Globalne style (motyw kolorów/typografii nadrzędnej)
- Widoki dynamiczne (custom post types) — zostaje obecny zestaw widgetów
- Edycja inline w canvas (klik w heading → edycja w miejscu) — tekst nadal w panelu

## Ryzyka
- Refaktor Builder.tsx (~700 linii) na ~6 mniejszych plików — możliwe regresje DnD; testuję ręcznie kluczowe ścieżki (dodaj sekcję, dodaj widget, przesuń widget między kolumnami, zaznacz, edytuj, zapisz).
- Undo/redo musi działać z autosave bez konfliktu (autosave czeka 800ms po ostatniej zmianie — undo to też zmiana).

## Plan wykonania (kolejność)
1. Wyodrębnić `WidgetLibrary`, `WidgetProperties` z obecnego `Builder.tsx` (czysty refaktor, bez zmiany UI)
2. Zbudować `BuilderLayout` 2-kolumnowy z `LeftPanel` (Library/Properties switcher)
3. Dodać `Navigator` (drzewko)
4. Rozbudować handles sekcji/kolumny/widgetu (duplikuj, kopiuj, drop zones „+")
5. `useHistory` + skróty klawiszowe
6. `clipboard` + akcje kopiuj/wklej w handles
7. `ColumnProperties` (pełen panel)
8. Rozbudowa Style/Advanced widgetów (typografia, motion)

Po akceptacji idę po kolei i raportuję postęp.
