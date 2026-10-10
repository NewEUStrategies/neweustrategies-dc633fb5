# System wykresów 2026-10 - wdrożenie specyfikacji w silniku SVG

Dokument opisuje, jak specyfikacja systemu wykresów (paleta ról, słupki, linie, tooltip, panel, źródła, karty KPI) została wdrożona w istniejącym silniku `src/lib/charts` + `src/components/charts`, gdzie i dlaczego wdrożenie odbiega od wzorca oraz czego jeszcze nie ma.

## 1. Biblioteka i renderowanie - dlaczego nie ECharts

Specyfikacja zakłada Apache ECharts 5.5 z rendererem SVG. Repozytorium świadomie z ECharts zrezygnowało (`vite.config.ts`, komentarz przy `optimizeDeps`; `ChartCard.tsx`, `ClubInsights.tsx`): biblioteka ważyła 266,8 KB w budżecie czytelnika, wymagała odcinania od grafu SSR i prebundlingu modułów CJS. Własny silnik rysuje SVG w HTML z serwera (pełny wykres bez JS), a wszystkie kolory biorą się z tokenów CSS.

Wymagania z sekcji 1 są więc spełnione mechanizmem silnika, nie ECharts:

| Wymaganie                                     | Realizacja                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| SVG, eksport bez strat                        | rysunek jest SVG; eksport `svgDoPliku` (z tłem i fontem) i `svgDoPng` (2x, tło motywu) w `src/lib/charts/exportImage.ts` |
| `role="img"`, `aria-label` = tytuł            | kontener `.neh-canvas` (`a11y.chart`)                                                                                    |
| resize z opóźnieniem 160 ms, ignoruj < 4 px   | `src/hooks/useContainerWidth.ts` (`RESIZE_DEBOUNCE_MS`, `RESIZE_MIN_DELTA_PX`)                                           |
| przerysowanie po zmianie motywu, kolory z CSS | rysunek podaje wyłącznie `var(--chart-*)` - przełączenie `.dark` przemalowuje go bez renderu Reacta                      |
| komunikat, gdy biblioteka się nie załaduje    | `ChartLoadFailed` jako zapas leniwego importu bloku CMS i widgetu buildera                                               |
| `dispose` przy zmianie widoku                 | nie dotyczy - komponent Reacta nie trzyma instancji poza drzewem                                                         |

## 2. Kolory - role zamiast hexów

Mapowanie nazw ze specyfikacji na tokeny arkusza stoi w `src/lib/charts/roles.ts` (`ROLE`), wartości w `src/styles.css` (blok `:root, .light` i `.dark`) i w bloku druku `charts.css`. Bramka `src/lib/charts/__tests__/roles.test.ts` porównuje arkusz z modułem i liczy progi.

Paleta serii `focus` (domyślna, `seriesStyle.ts`): akcent, łupek główny, łupek drugi, dodatni, „powyżej przedziału". Jedna seria w akcencie, pozostałe neutralne. Paleta `categorical` (27 slotów) zostaje do świadomego wyboru autora.

Odstępstwa od wzorca, każde z pomiaru (kontrast WCAG, odległość CIELAB po symulacji daltonizmu):

| Rola                      | Wzorzec           | Wdrożone                                 | Powód                                                                                                                                     |
| ------------------------- | ----------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `--pos`                   | #2D7A6A / #5BB8A3 | #1b6f8c / #6fb3c9 (`--chart-positive`)   | para wzorcowa z czerwienią: protanopia 8,5; nasza: 34,6                                                                                   |
| `--warn`                  | #B7791F / #E0A84A | #7c4dbf / #ab92ec (fiolet)               | decyzja właściciela: bez bursztynu; bursztyn leży w rodzinie pomarańczu marki                                                             |
| `--s-alt` jasny           | #9AA6B5 (2,47:1)  | #8794a4 (3,09:1)                         | trzecia seria przechodzi próg grafiki 3:1 także bez kreskowania                                                                           |
| `--acc-t` jasny           | #ED751A (2,93:1)  | #ab5517 (5,19:1, `--chart-accent-audit`) | etykieta pasma i tekst akcentu muszą przejść próg tekstu 4,5:1                                                                            |
| `--line`/`--line2` ciemny | #2E2B29 / #403C39 | #22201f / #363331                        | przeliczone pod naszą płytę #0f0f0f z tym samym kontrastem, jaki wzorzec miał na #1f1e1d                                                  |
| `--panel` ciemny          | #1F1E1D           | `var(--card)` (#0f0f0f)                  | płyta, wobec której zwalidowana jest cała paleta                                                                                          |
| akcent                    | #FA9346           | #FA9346                                  | kolor marki bez zmian; na bieli ma 2,25:1, więc seria w akcencie zawsze ma drugi nośnik: kształt punktu, etykietę, tooltip, tabelę danych |

Tooltip jest ciemny w obu motywach, więc napisy oceny (zmiana, status) mają w nim własne warianty (`TOOLTIP_STATUS_TEXT`, >= 4,9:1).

## 3-6. Typografia, układ, serie, animacja, interakcja

Wszystkie liczby stoją w `src/lib/charts/geometry.ts` i są pilnowane przez `geometry.test.ts`:

- tekst 12 px (11 px w panelu < 600 px), osie 11,5 / 10,5 px w tuszu trzecim, etykiety wartości 11 px w tuszu drugim;
- siatka: lewy 6, prawy 24 (14), górny 30; jednostka jako nazwa osi nad osią; maksimum z 4% zapasu nad punktem, pasmem albo celem (`extendDomain`, wspólne z orzeczeniem o uciętej osi);
- linia 2 px (2,5 px pod kursorem), punkty 7 px w czterech kształtach z obwódką płyty, chowane powyżej 20 punktów; trzecia i dalsze serie przerywane 6 4;
- pole pod linią: gradient 15% (seria główna) / 8% (pozostałe na wykresie pól) do zera przy bazie;
- słupki pełne, najwyżej 22 px (34 px w stosie), odstęp serii 25%, koniec danych zaokrąglony 4 px, ujemna wartość pojedynczej serii w czerwieni, trzecia seria kreskowana; wspólna reguła `charts.css` daje pełne wypełnienie każdemu słupkowi (także histogram, tornado, stos 100%), więc ustawienie „Wypełnienie słupków" (blade / gradient) zniknęło z edytora bloku i z panelu buildera - parser nadal przyjmuje zapisany klucz `barStyle`, żeby starsze treści się wczytywały;
- pasmo optimum (akcent 10%, etykieta „przedział" / „optimum (demo)") i linia celu (5 4, „cel X");
- wykres kaskadowy: zmiany w dodatnim/czerwieni, poziomy w łupku głównym, etykiety ze znakiem „+";
- animacja 400 ms cubicOut, aktualizacja 300 ms, bez kaskady, wyłączona przy `prefers-reduced-motion`; tooltip bez zwłoki;
- prowadnica 4 4 w tuszu trzecim, tło kolumny 8%, przygaszanie serii nieaktywnych (seria rozpoznawana z geometrii), legenda ukrywa serie, etykiety przy końcu linii dla 2-4 serii, suwak 18 px i Shift + kółko powyżej 30 punktów, dotyk (drugie stuknięcie otwiera okno punktu).

## 7-8. Tooltip i panel

Tooltip (`ChartTooltip.tsx`): nagłówek 13 px, serie z próbką, siatka klucz-wartość 66 px (Zmiana, Status ze słowem i symbolem, Znaczenie), linia źródła w `--chart-acc-l`. Wiersze oceny pojawiają się, gdy wykres jest wskaźnikiem (ma kierunek albo przedział).

Panel (`ChartFrame.tsx`): `figure` z `aria-labelledby`, tytuł 15,5/650, znaczek „demo", podtytuł „jednostka. Źródło: X (litera)" z numerami przypisów, przyciski „i", „⤢", PNG, SVG (natywny `<dialog>`, bez biblioteki), ramka „Jak czytać" obok wykresu (container query), podpis 13 px. Karta pulpitu używa wariantu `embedded` (bez drugiej karty i drugiego zestawu przycisków) i dostała eksport SVG.

## 9. Dane i źródła

- `ChartConfig` ma pola `palette`, `band`, `target`, `direction`, `provenance`, `demo`, `sources`, `caption` (parser: `src/lib/charts/parse.ts`).
- Pasmo bez źródła nie jest rysowane ani używane do oceny (`effectiveBand`) - wykres mówi wtedy „brak benchmarku".
- Przypisy chicagowskie: `src/lib/charts/sources.ts`. W artykule źródła wykresu dostają numery z tej samej sekwencji co przypisy tekstu i trafiają do sekcji przypisów na dole wpisu (`precomputeFootnotes`). Poza artykułem (builder, panel) numeracja jest lokalna dla wykresu - tak samo, jak przypisy widgetów buildera.
- Karty Web Vitals mają przedziały „good" ze źródłem pierwotnym (web.dev, Google; `VITAL_THRESHOLD_SOURCES`).

## 10. Karty KPI

`KpiTile` (pulpity) używa wspólnych atomów `Sparkline` (akcent 2 px, kropka ostatniego punktu, pasmo 14%) i `RangeScale` (strefy, znacznik 4 x 20 px, podpowiedzi słowne, stan „brak benchmarku"). Zmiana: ▲ ▼ ■, kolor z kierunku wskaźnika.

## 11. Wykresy w blokach CMS i widgetach buildera (PR #489)

Blok CMS („Gutenberg") i widget buildera („Elementor") rysują ten sam silnik i - od tego PR - z tej samej konfiguracji. Widget trzyma ustawienia płasko (pola `*_pl`/`*_en`, przełączniki „on"/„off", dane jako tekst ze średnikami), a adapter `src/lib/charts/widgetConfig.ts` przekłada je na Json w kształcie bloku i przepuszcza przez ten sam parser (`parseChartConfig`, `parseDataMapConfig`). Test `chartBlockWidgetParity.test.tsx` renderuje każdy z 17 rodzajów obiema drogami i porównuje znacznik figury (różni się wyłącznie margines: blok `my-6`, widget `my-0`).

- Paleta ról jest domyślna w każdym rodzaju, którego kolor nie koduje wartości ani znaku (`KIND_CAPS.palette`; mapa ciepła, tornado i mostek zostają przy kolorze znaczącym). Warianty dla rodzajów spoza rysownika kartezjańskiego są mieszankami jednego koloru roli (`color-mix` z płytą: wnętrze 18%, najechanie 85%, pasmo 12%), bez nowych tokenów.
- Wycinki tarczy i pierścienia są pełne (decyzja właściciela), z przerwą tej samej szerokości w obu motywach. Wycinek wyróżniony (`accentCategory`, domyślnie największy) nigdy nie trafia do „Pozostałe"; paleta kategorialna tarczy bierze sloty z `SLOT_SEQUENCE`, nigdy pomarańczu marki dla wycinka, który nie jest akcentem.
- Akcent (#FA9346, 2,25:1 na bieli) ma wszędzie drugi nośnik: obrys 1 px w `--chart-accent-audit-graphic` (wycinek, słupki histogramu, pudełko i punkty odstające boxplota, punkty roju, segment stosu 100%), a mediana na pudełku w akcencie ma tusz ~8:1.
- Eksport PNG i SVG działa we wszystkich rodzajach i na mapie. Plik SVG ma kolory wyłącznie w zapisie `#rrggbb`/`rgba()` (`exportColor.ts` rozwiązuje `oklch()`, `color-mix()` i `var()`), klucz serii albo wycinków pod rysunkiem i kolejność `paint-order` obwódek napisów. Kod eksportu ładuje się dopiero po kliknięciu.
- Okno „Jak czytać" ma teksty dla rodziny rysunku (kartezjańska, rozkład, część całości, zależność, wrażliwość, panele, mapa - `readHelp.ts`), a każdy tooltip - linię źródła.
- Typografia motywu buildera (Theme Design) nie przestylowuje wykresu: `figure.neh-chart` i tooltip niosą `data-typography-exempt`, a gałęzie szablonu typografii mają zwolnienie w formie przodka `:where(:not([data-typography-exempt] *))` - bez wagi w kaskadzie, więc pozostałe widgety zachowują specyficzność sprzed zmiany.

## 12. Mapa danych (kartogram)

| Ustawienie      | Wartości                                                               | Domyślnie                                   |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| schemat barw    | niebieski, łupkowy, pomarańczowy (akcent), rozbieżny (spadek - wzrost) | niebieski                                   |
| liczba klas     | skala ciągła albo 3-7 klas                                             | nowa mapa: 5; mapa bez klucza: skala ciągła |
| metoda podziału | kwantyle (równe liczebności), równe przedziały                         | kwantyle                                    |
| środek skali    | liczba (tylko schemat rozbieżny)                                       | 0                                           |

- Opublikowana mapa bez nowych kluczy wygląda dokładnie jak przed PR: niebieska skala ciągła z tym samym mieszaniem `0,15 + 0,85 t` (50 porównań w `mapPublishedLook.test.tsx`).
- Rampy nie mają turkusu ani fioletu (czytałyby się jak „dodatni" i „powyżej przedziału" palety ról) ani bursztynu; bramka `palette.test.ts` liczy dla klas 3-7 odstęp jasności sąsiednich klas, kontrast końca rampy z płytą i odróżnialność od „brak danych", w motywie jasnym, ciemnym i druku.
- Legenda klasowa (przedziały w jednostce, nazwa metody), gradient skali ciągłej, punkt środkowy skali rozbieżnej i kreskowana próbka „brak danych". Kraj bez wartości jest kreskowany (odstęp >= 4 px także przy szerokości 320 px), a tooltip mówi „brak danych".
- Tooltip mapy: wartość, pozycja w rankingu, przedział klasy i źródło; obrys najechania i fokusu w dwóch tonach ma >= 3:1 wobec każdej klasy (bramka `mapOutlineContrast.test.ts`); dotyk otwiera tooltip stuknięciem.
- Kody spoza regionu nie zmieniają skali barw - nota pod mapą je wymienia, tabela danych zostaje pełna. Pusta mapa zachowuje panel. Źródła mapy mają przypisy w sekwencji artykułu, tak jak wykresy.

## 13. Wprowadzanie danych

**Arkusz danych** (`src/components/admin/charts/`: wspólne prymitywy siatki, `ChartDataGrid`, `MapDataGrid`) jest ten sam w bloku CMS i w dialogu widgetu. Komórka liczbowa trzyma szkic i zatwierdza go przy wyjściu, Enter, Tab albo wklejeniu przez `parseImportedCell` - wpis, który nie jest liczbą, dostaje `aria-invalid` i zdanie po polsku albo angielsku, a nie cichą lukę. Enter / Shift+Enter, Tab / Shift+Tab i strzałki na krawędzi tekstu przechodzą między komórkami; Ctrl+Z i Ctrl+Shift+Z w arkuszu cofają w historii bloku albo buildera.

**Wklejanie** z Excela, Google Sheets, LibreOffice i Numbers czyta HTML schowka i tekst z tabulatorami. Gdy arkusz podaje surową wartość komórki (`x:num`, `data-sheets-value`, `sdval`), liczba pochodzi z niej, a nie z wyświetlanego napisu; procent („25%" albo format komórki z „%") daje 25. Zakres wklejony do komórki trafia w to miejsce jako jedna zmiana (jeden krok cofania). Zastąpienie całej tabeli (pusty arkusz, lewy górny róg z nagłówkiem, plik, wklejenie na kanwę z zaznaczonym blokiem) otwiera podgląd: nagłówek, obrót wierszy i kolumn, format liczb (auto / polski / angielski), a dla mapy - kolumna krajów i kolumna wartości.

**Mapa**: kraj wpisuje się kodem ISO-2, ISO-3 albo nazwą po polsku lub angielsku („Czechy", „Czech Republic", „UK" -> CZ, CZ, GB). Wiersz pokazuje status słowem i ikoną: kraj nierozpoznany, powtórzony, spoza regionu, bez wartości. Arkusz mapy ma limit 300 wierszy.

**Import pliku**: xlsx, xlsm, xlsb, xltx, xltm, xls, ods, fods, csv, tsv, txt, html, htm (bez SYLK i DIF). Pliki czyta proces roboczy arkuszy; limity: 10 arkuszy, 2000 wierszy, 256 kolumn. Problemy skoroszytu, arkusza i wierszy (obcięcie, komórki nieliczbowe, nierozpoznane kraje, flagi Eurostatu, kodowanie windows-1250) pojawiają się jedną listą tymi samymi zdaniami (`importProblems.ts`).

**Pole tekstowe** danych w panelu buildera zamienia wklejoną tabelę na format średnikowy z kropką dziesiętną; w mapie wklejone kraje dołączają do istniejących, chyba że pole jest puste albo całe zaznaczone. Tabela CMS przekształca się w wykres (`Przekształć w` - `Wykres`); tabela bez liczb zostaje nietknięta, a kanwa mówi dlaczego.

## 14. Dobór kolorów

- Paleta ról (domyślna): seria wyróżniona w akcencie, pozostałe jako tło porównania. Wybór „Seria wyróżniona" jest w arkuszu, w menu kolumny i w panelu buildera; w palecie kategorialnej seria wyróżniona zachowuje swój kolor, a wyróżnia się rysunkiem (linia ciągła, znacznik).
- Paleta kategorialna: wybór koloru serii oferuje tylko sloty z kontrastem >= 3:1 na płycie w obu motywach i z odcieniem OKLCh poza 30-110° - czyli bez pomarańczy, bursztynu i żółci (lista wyliczana, bramka `chartColorSlots.test.ts`). Próbka pokazuje kolor faktycznie rysowany.
- Mapa: wybór schematu jest grupą przycisków radiowych z prawdziwymi próbkami rampy i nazwą (nigdy sam kolor), z liczbą klas, metodą, środkiem skali rozbieżnej i podglądem legendy liczonej na bieżących danych.

Progi kontrastu grafiki 3:1 pochodzą z kryterium 1.4.11 WCAG 2.2[^wcag]; kwantyle i równe przedziały jako metody klasyfikacji kartogramu oraz zasada, że rampa sekwencyjna zmienia jasność, a rozbieżna ma neutralny środek - z praktyki kartograficznej Brewer[^brewer].

[^wcag]: World Wide Web Consortium, „Web Content Accessibility Guidelines (WCAG) 2.2", W3C Recommendation, 5 października 2023, kryterium 1.4.11 „Non-text Contrast", [https://www.w3.org/TR/WCAG22/#non-text-contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast).

[^brewer]: Cynthia A. Brewer, _Designing Better Maps: A Guide for GIS Users_, wyd. 2 (Redlands: Esri Press, 2016); Cynthia A. Brewer i Mark Harrower, „ColorBrewer 2.0", Pennsylvania State University, [https://colorbrewer2.org/](https://colorbrewer2.org/).

## Czego jeszcze nie ma

- Rodzaje z sekcji 4, których silnik nie miał: lejek, mapa ciepła STATUSÓW, dumbbell, bullet, odchylenia od normy, kombi z dwiema osiami, slope, radar, treemap, Pareto, kalendarz, kohorty, sankey w silniku. Każdy wymaga modelu, tabeli danych, wpisu w czterech powierzchniach autorskich i bramki `chartKinds.test.ts`.
- Bibliografia zbiorcza na stronach buildera (dziś: numeracja w obrębie wykresu i lista źródeł w oknie „Jak czytać").
- Galeria wykresów z danymi demonstracyjnymi.
- Odłożone w PR #489: kolor własny dla pojedynczej kategorii (wycinka) - jest tylko wycinek wyróżniony; przekształcenie tabeli w mapę danych (skorowidz krajów jest asynchroniczny, a przekształcenie bloku synchroniczne); przełączanie serii legendą poza rodzajami kartezjańskimi; nawigacja klawiaturą po sąsiednich krajach mapy i znaczniki mikropaństw; widgety „feature" (sankey, porównanie, matryca ryzyka, sieć, oś czasu, wskaźnik) i pozostałe mapy (mapa świata, korytarz, tracker stanowisk, panel geograficzny) - osobny PR.
- Menu „Przekształć w" liczy cele po typie bloku, więc „Wykres" widać także przy tabeli samego tekstu (kanwa odmawia z komunikatem).
- Podkreślenie ustawione na całym widgecie buildera dziedziczy się w tytule, legendzie i podpisie wykresu - `text-decoration` propaguje się w CSS na potomków i nie da się go zdjąć z wnętrza.
