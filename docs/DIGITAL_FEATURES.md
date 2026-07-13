# NES Digital Features

Formalny moduł interaktywnych „digital features" w stylistyce think-tanków
(CSIS: _Digital Features_ / _Charts_ / _Microsites_). Nie jest to „ozdobiony
artykuł" - to komponowalne widgety danych osadzane w istniejącym **builderze**
(Elementor-style), które łączą narrację, dane, mapę, wykresy, filtry,
metodologię i źródła w jeden eksplorowalny produkt.

## Model CSIS a NES

CSIS wydziela trzy kategorie; tak mapują się na architekturę NES:

| Kategoria CSIS      | Co to jest                                                     | Realizacja w NES                                                                 |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Charts**          | Pojedyncze wykresy / mapy danych                               | Widgety `chart` + `data-map` (silnik `src/components/charts`) - **już istniały** |
| **Digital Features**| Interaktywne raporty: narracja + dane + mapa + filtry + metoda | **Ten moduł** - widgety `feature-*` komponowane w builderze na jednej stronie    |
| **Microsites**      | Trwałe, autonomiczne produkty z własną nawigacją i marką       | Strona buildera (`/admin/pages`) jako „hub" + podstrony; osobna nawigacja/menu   |

Digital Feature = **strona buildera** złożona z widgetów `feature-*` (plus
`chart`, `data-map`, `heading`, `rich-text`). Microsite = zestaw takich stron
spięty własnym menu (`/admin/appearance/menu`) i sekcją nagłówka - platforma
już to umożliwia (builder pełni rolę „page-composition engine").

## Widgety modułu

Wszystkie żyją w kategorii **„NES Digital Features"** w palecie buildera
(`WidgetLibrary`) i renderują się przez `WidgetView` jak każdy inny widget.
Silnik: `src/components/features/*`; adapter treść→config:
`src/components/admin/builder/ui/organisms/widget-view/FeatureWidgets.tsx`.

| Widget (`type`)         | Komponent          | Do czego                                                        |
| ----------------------- | ------------------ | -------------------------------------------------------------- |
| `feature-timeline`      | `Timeline`         | Oś czasu - kalendarium dossier, kroków legislacyjnych           |
| `feature-sankey`        | `SankeyDiagram`    | Przepływy - handel, energia (LNG), migracje                     |
| `feature-compare`       | `CountryCompare`   | Porównywarka państw - tabela wskaźników z paskami               |
| `feature-risk-matrix`   | `RiskMatrix`       | Macierz ryzyka 5×5 (prawdopodobieństwo × wpływ)                 |
| `feature-indicator`     | `IndicatorCard`    | Karta wskaźnika (KPI) - wartość, delta, sparkline               |
| `feature-network`       | `RelationNetwork`  | Sieć powiązań - graf aktorów/instytucji (układ kołowy)          |
| `feature-corridor-map`  | `CorridorMap`      | Mapa korytarzy - linie lon/lat na choroplecie + węzły           |
| `feature-sources`       | `SourceLibrary`    | Biblioteka źródeł - filtr po typie + wyszukiwanie               |
| `feature-methodology`   | `MethodologyNote`  | Nota metodologiczna - rozwijalny blok z wersją i datą           |
| `chart` _(istniejący)_  | `Chart`            | Wykresy: liniowy, słupkowy, pole, kołowy, pierścień             |
| `data-map` _(istniejący)_ | `ChoroplethMap`  | Mapa danych (choropleta) Europy / świata                        |

## Zasady wspólne (spójność z silnikiem wykresów)

- **Kolory tylko z tokenów** `--chart-1..8`, `--brand`, `--card`, `--border`,
  `--muted-foreground`. Dzięki temu tryb ciemny i wymuszony jasny canvas
  buildera działają automatycznie - żadnych zaszytych hexów w komponentach.
- **Dostępność ≠ tooltip.** Każdy widget niesie kanał tekstowy niezależny od
  grafiki: tabela danych (`FeatureDataTable`, natywny `<details>`), lista lub
  semantyczna struktura. Grafika jest wizualnym duplikatem, nie jedyną drogą do
  wartości. Testy `axe` pilnują braku naruszeń.
- **SSR-safe + zero migotania.** Animacje wejścia odpala `useRevealOnScroll`
  (ten sam hook co wykresy): SSR renderuje stan KOŃCOWY (crawler/no-JS widzi
  pełną treść), animacja uzbraja się tylko poza viewportem. `prefers-reduced-motion`
  wyłącza ruch.
- **Code-splitting.** Wszystkie renderery `feature-*` żyją w jednym module
  ładowanym przez `React.lazy` (`lazyWidgets.tsx` → chunk `FeatureWidgets`),
  więc silnik nie obciąża współdzielonego bundla Header/Footer. Strony bez tych
  widgetów nic nie dopłacają.
- **Dwujęzyczność (PL/EN).** Ramka widgetu (tytuł/opis/źródło) to pola
  `*_pl`/`*_en`. Dane wierszowe niosą tłumaczenie inline w komórce jako
  `"PL|EN"` - liczba żyje raz, tekst tłumaczy się obok. Parsery: `src/lib/features/parse.ts`.
- **Zero nowych zależności.** Cały moduł to czyste SVG/HTML + React; mapa
  korytarzy reużywa zasobów `public/geo/*.v1.json` i projekcji generatora.

## Format danych (textarea w panelu właściwości)

Separator `;` (przyjazny polskiemu przecinkowi dziesiętnemu), jeden rekord na
wiersz, tłumaczenie w komórce po `|`. Przykłady:

```
# feature-timeline   (Data; Tytuł|Title; Opis|Description; slot 1-8)
2024-03; Prezentacja EDIS|EDIS unveiled; Pierwsza strategia|The first strategy; 1

# feature-sankey     (Źródło|Source; Cel|Target; wartość)
USA|USA; Terminale UE|EU terminals; 56

# feature-compare    (nagłówek: "; Kol1; Kol2"; wiersz: "Wskaźnik [jedn.]|..; v1; v2")
; Polska|Poland; Niemcy|Germany
Wydatki obronne [% PKB]|Defence spending [% GDP]; 4,1; 2,1

# feature-corridor-map  (Nazwa|Name; slot; lat,lon > lat,lon > ...)
Bałtyk–Adriatyk|Baltic–Adriatic; 1; 54.35,18.65 > 52.23,21.01 > 45.44,12.32
```

## Mapa korytarzy: projekcja geo

`CorridorMap` rysuje linie i markery w tym samym układzie współrzędnych co
choropleta krajów. Generator (`scripts/generate-geo-maps.ts`) osadza w każdym
zasobie `public/geo/*.v1.json` metadane `proj` (typ projekcji + parametry
dopasowania). Runtime (`src/lib/features/geoProject.ts`) odtwarza z nich funkcję
`lon/lat → px` - **bez duplikowania kodu projekcji** i bez ryzyka dryfu. Gdy
zcache'owany starszy zasób nie ma `proj`, warstwa korytarzy jest po prostu
pomijana (fail-safe), a choropleta i tak się renderuje.

Zmiana w generatorze jest **wstecznie zgodna**: geometria krajów (`countries`,
`viewBox`, `license`) jest bajt-w-bajt identyczna; dochodzi tylko pole `proj`.

## Najlepsze potencjalne produkty NES (kompozycje)

Każdy to strona buildera łącząca kilka widgetów `feature-*`:

1. **Mapa europejskich korytarzy transportowych** - `feature-corridor-map` +
   `feature-sources` + `feature-methodology`.
2. **Tracker EDIP/EDIS i przemysłu obronnego** - `feature-timeline` +
   `feature-compare` + `feature-indicator` + `chart`.
3. **Indeks bezpieczeństwa energetycznego** - `feature-indicator` (kafle) +
   `feature-sankey` (przepływy LNG) + `data-map`.
4. **Tracker inwestycji infrastrukturalnych** - `feature-corridor-map` +
   `feature-compare` + `chart`.
5. **Mapa sankcji i obchodzenia sankcji** - `data-map` + `feature-network` +
   `feature-sources`.
6. **Dashboard pozycji państw swingujących** - `feature-compare` +
   `feature-risk-matrix` + `feature-network` (istniejący tracker dostarcza
   `PolicyPositionsMap`).

## Testy

- `src/lib/features/__tests__/parse.test.ts` - parsery (format `;`, `PL|EN`,
  walidacja, limity wierszy).
- `src/lib/features/__tests__/geoProject.test.ts` - projekcja lon/lat →
  wewnętrzny punkt kanwy, ścieżka korytarza.
- `src/components/features/__tests__/features.test.tsx` - render + `axe` dla
  ośmiu widoków (mapa korytarzy zależy od React Query, testowana osobno).
- `schema.test.ts` (drift guard) i `lazyWidgets.test.ts` (eksporty) pokrywają
  rejestrację w builderze.
