# System wykresów 2026-10 - wdrożenie specyfikacji w silniku SVG

Dokument opisuje, jak specyfikacja systemu wykresów (paleta ról, słupki, linie, tooltip, panel, źródła, karty KPI) została wdrożona w istniejącym silniku `src/lib/charts` + `src/components/charts`, gdzie i dlaczego wdrożenie odbiega od wzorca oraz czego jeszcze nie ma.

## 1. Biblioteka i renderowanie - dlaczego nie ECharts

Specyfikacja zakłada Apache ECharts 5.5 z rendererem SVG. Repozytorium świadomie z ECharts zrezygnowało (`vite.config.ts`, komentarz przy `optimizeDeps`; `ChartCard.tsx`, `ClubInsights.tsx`): biblioteka ważyła 266,8 KB w budżecie czytelnika, wymagała odcinania od grafu SSR i prebundlingu modułów CJS. Własny silnik rysuje SVG w HTML z serwera (pełny wykres bez JS), a wszystkie kolory biorą się z tokenów CSS.

Wymagania z sekcji 1 są więc spełnione mechanizmem silnika, nie ECharts:

| Wymaganie | Realizacja |
|---|---|
| SVG, eksport bez strat | rysunek jest SVG; eksport `svgDoPliku` (z tłem i fontem) i `svgDoPng` (2x, tło motywu) w `src/lib/charts/exportImage.ts` |
| `role="img"`, `aria-label` = tytuł | kontener `.neh-canvas` (`a11y.chart`) |
| resize z opóźnieniem 160 ms, ignoruj < 4 px | `src/hooks/useContainerWidth.ts` (`RESIZE_DEBOUNCE_MS`, `RESIZE_MIN_DELTA_PX`) |
| przerysowanie po zmianie motywu, kolory z CSS | rysunek podaje wyłącznie `var(--chart-*)` - przełączenie `.dark` przemalowuje go bez renderu Reacta |
| komunikat, gdy biblioteka się nie załaduje | `ChartLoadFailed` jako zapas leniwego importu bloku CMS i widgetu buildera |
| `dispose` przy zmianie widoku | nie dotyczy - komponent Reacta nie trzyma instancji poza drzewem |

## 2. Kolory - role zamiast hexów

Mapowanie nazw ze specyfikacji na tokeny arkusza stoi w `src/lib/charts/roles.ts` (`ROLE`), wartości w `src/styles.css` (blok `:root, .light` i `.dark`) i w bloku druku `charts.css`. Bramka `src/lib/charts/__tests__/roles.test.ts` porównuje arkusz z modułem i liczy progi.

Paleta serii `focus` (domyślna, `seriesStyle.ts`): akcent, łupek główny, łupek drugi, dodatni, „powyżej przedziału". Jedna seria w akcencie, pozostałe neutralne. Paleta `categorical` (27 slotów) zostaje do świadomego wyboru autora.

Odstępstwa od wzorca, każde z pomiaru (kontrast WCAG, odległość CIELAB po symulacji daltonizmu):

| Rola | Wzorzec | Wdrożone | Powód |
|---|---|---|---|
| `--pos` | #2D7A6A / #5BB8A3 | #1b6f8c / #6fb3c9 (`--chart-positive`) | para wzorcowa z czerwienią: protanopia 8,5; nasza: 34,6 |
| `--warn` | #B7791F / #E0A84A | #7c4dbf / #ab92ec (fiolet) | decyzja właściciela: bez bursztynu; bursztyn leży w rodzinie pomarańczu marki |
| `--s-alt` jasny | #9AA6B5 (2,47:1) | #8794a4 (3,09:1) | trzecia seria przechodzi próg grafiki 3:1 także bez kreskowania |
| `--acc-t` jasny | #ED751A (2,93:1) | #ab5517 (5,19:1, `--chart-accent-audit`) | etykieta pasma i tekst akcentu muszą przejść próg tekstu 4,5:1 |
| `--line`/`--line2` ciemny | #2E2B29 / #403C39 | #22201f / #363331 | przeliczone pod naszą płytę #0f0f0f z tym samym kontrastem, jaki wzorzec miał na #1f1e1d |
| `--panel` ciemny | #1F1E1D | `var(--card)` (#0f0f0f) | płyta, wobec której zwalidowana jest cała paleta |
| akcent | #FA9346 | #FA9346 | kolor marki bez zmian; na bieli ma 2,25:1, więc seria w akcencie zawsze ma drugi nośnik: kształt punktu, etykietę, tooltip, tabelę danych |

Tooltip jest ciemny w obu motywach, więc napisy oceny (zmiana, status) mają w nim własne warianty (`TOOLTIP_STATUS_TEXT`, >= 4,9:1).

## 3-6. Typografia, układ, serie, animacja, interakcja

Wszystkie liczby stoją w `src/lib/charts/geometry.ts` i są pilnowane przez `geometry.test.ts`:

- tekst 12 px (11 px w panelu < 600 px), osie 11,5 / 10,5 px w tuszu trzecim, etykiety wartości 11 px w tuszu drugim;
- siatka: lewy 6, prawy 24 (14), górny 30; jednostka jako nazwa osi nad osią; maksimum z 4% zapasu nad punktem, pasmem albo celem (`extendDomain`, wspólne z orzeczeniem o uciętej osi);
- linia 2 px (2,5 px pod kursorem), punkty 7 px w czterech kształtach z obwódką płyty, chowane powyżej 20 punktów; trzecia i dalsze serie przerywane 6 4;
- pole pod linią: gradient 15% (seria główna) / 8% (pozostałe na wykresie pól) do zera przy bazie;
- słupki pełne, najwyżej 22 px (34 px w stosie), odstęp serii 25%, koniec danych zaokrąglony 4 px, ujemna wartość pojedynczej serii w czerwieni, trzecia seria kreskowana;
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

## Czego jeszcze nie ma

- Rodzaje z sekcji 4, których silnik nie miał: lejek, mapa ciepła STATUSÓW, dumbbell, bullet, odchylenia od normy, kombi z dwiema osiami, slope, radar, treemap, Pareto, kalendarz, kohorty, sankey w silniku. Każdy wymaga modelu, tabeli danych, wpisu w czterech powierzchniach autorskich i bramki `chartKinds.test.ts`.
- Bibliografia zbiorcza na stronach buildera (dziś: numeracja w obrębie wykresu i lista źródeł w oknie „Jak czytać").
- Galeria wykresów z danymi demonstracyjnymi.
