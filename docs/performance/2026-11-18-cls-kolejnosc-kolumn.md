# CLS 0,16 na telefonie: kolejność kolumn przy strumieniowanym HTML (2026-11-18)

Zgłoszenie: PageSpeed Insights, strona główna, profil mobilny (Lighthouse 13.6.0) -
**Cumulative Layout Shift 0,16**; desktop 0. Ten dokument opisuje przyczynę, dowód,
poprawkę, jej koszt i to, czego poprawka świadomie nie obejmuje.

## 1. Przyczyna

Sekcja hero strony głównej ma trzy kolumny w kolejności dokumentu
`[A: „Najnowszy raport", span 3, order.mobile 2] [B: slider, span 6, order.mobile 1]
[C: „Zdaniem ekspertów", span 3, order.mobile 3]`. Na telefonie siatka ma jedną kolumnę,
a kolejność wizualną ustawia reguła `@media (max-width: 767px){… {order:N !important}}`
emitowana przez `RenderSection` PRZED kolumnami (poprawka F29c z
[`AUDYT_CWV_ZIMNE_OTWARCIE_2026-09-20.md`](../AUDYT_CWV_ZIMNE_OTWARCIE_2026-09-20.md)).

Parser HTML wstawia kolumny w kolejności dokumentu, a przeglądarka maluje to, co już
wczytała. Gdy sekcja hero jedzie w powłoce SSR (a nie jako ukryty segment `S:n`
odsłaniany skryptem `$RC` - to zależy od tego, czy dane zdążyły przed wysłaniem
powłoki), telefon maluje A na górze siatki, zanim parser dojdzie do B. Po wczytaniu B
reguła `order` stawia B przed A i A zjeżdża o wysokość slidera (~309 px przy 412 px
szerokości). Reguła stojąca przed kolumnami tego nie leczy: działa od początku,
brakuje tylko rodzeństwa, które ma ją wyprzedzić. To ten sam pomiar „CLS 0,324 w
jednej zimnej próbie", który audyt z 2026-09-20 przypisał wyłącznie kolejności
`<style>` (F29c).

Desktop nie ma kolejności (`order.desktop` puste), więc kolejność dokumentu = kolejność
wizualna i CLS = 0.

## 2. Dowód

Warunki: Playwright, 412×823 (DPR 1,75), CPU 4×, 150 ms RTT, 1,6 Mb/s, `pl-PL`.
CLS = suma przesunięć do 10 s; „przestój" = proxy wstrzymujące dokument na 1,5 s tuż
przed drugą kolumną sekcji (jak przestój sieci komórkowej).

| Pomiar                                                                   |                        Baseline |                      Kandydat |
| ------------------------------------------------------------------------ | ------------------------------: | ----------------------------: |
| Produkcja (bez zmian w kodzie), pojedyncze przesunięcie kolumny A        |      0,13-0,32, co ~2. przebieg |                             - |
| Produkcyjny HTML z lokalnego serwera, przestój, JS aplikacji zablokowany |                            0,42 |      0-0,001 (bramka robocza) |
| Artefakt `build:smoke` + fixture, przestój, 4 przebiegi                  |                     0,383 (4/4) | maks. 0,0012 (kropki slidera) |
| j.w., LCP (mediana)                                                      |                         1864 ms |                       1872 ms |
| Artefakt + fixture, bez przestoju, 12 przebiegów przeplatanych           | przesunięcie w 5/12, maks. 0,21 |            0/12, maks. 0,0029 |
| j.w., LCP (mediany dwóch serii)                                          |                  1324 / 1364 ms |                1328 / 1352 ms |
| `e2e-performance/streamed-column-order.spec.ts`, 390 px                  |             CLS 0,41 (czerwony) |                         CLS 0 |

Fixture wydajnościowe (`e2e/fixtures/first-visit.json`) ma tę samą kolejność kolumn
hero co produkcja, a sekcja hero jedzie w nim w powłoce - stąd wierne odtworzenie.

Śledzenie wstawień (`MutationObserver` + `requestAnimationFrame`) pokazało wprost
klatkę z A wstawioną i namalowaną (`top=123`/`361`) przed wstawieniem slotu B oraz
przesunięcie do `top=670` w chwili, gdy B dostaje treść.

## 3. Poprawka: bramka prefiksu (`src/lib/builder/columnOrderGate.ts`)

Kolumna X jest **wstrzymana** (`visibility: hidden`), gdy w dokumencie po niej stoi
kolumna, która wizualnie ją wyprzedza (mniejszy `order` w danym zakresie szerokości).
Blok `hold` stoi przed kolumnami; blok zwalniający (`visibility: inherit`) stoi jako
**ostatnie dziecko slotu ostatniej takiej kolumny** („domykającej"), więc działa
dopiero po jej pełnym wczytaniu. Wtedy wszyscy wizualni poprzednicy X są kompletni
i X pojawia się od razu na swoim miejscu. Niewidoczny węzeł nie jest źródłem
przesunięcia, a odsłonięcie jest pojawieniem się treści, nie ruchem.

Na stronie głównej wstrzymana jest wyłącznie A (do końca B). Slider B (kandydat LCP)
i kolumna C nie czekają na nic, więc LCP się nie zmienia (tabela wyżej). Koszt w
bundlu: `app-initial` +481 B gzip (+0,19%); `check:bundle` w budżecie.

Zakresy liczone osobno: telefon (`max-width: 767px`, reguły `!important`) i
`not all and (max-width: 767px)` (inline `order.desktop` z HTML-u serwera; dokładne
dopełnienie, bez luki przy ułamkowych szerokościach). Sekcja bez odwrócenia nie
dostaje ani bajtu. Wartości `order` przechodzą przez jeden normalizator `cssOrder`
(tylko liczby całkowite - tylko takie przyjmuje CSS) w regułach, stylu inline i
bramce, a identyfikatory w selektorach przez `cssAttrValue`; surowy tekst z jsonb
nie trafia już do arkusza.

### Odrzucone warianty

- **Bramka całego rzędu** (hold przed rzędem, release za nim): działa (CLS 0 na
  artefakcie), ale wstrzymuje też slider do końca kolumny C: +~100 ms LCP przy
  przestoju strumienia, +20-28 ms bez przestoju.
- **Przestawienie DOM-u na kolejność mobilną** z jawnym umieszczeniem w siatce na
  desktopie: usuwa przyczynę, ale zmienia kolejność czytania i fokusu na desktopie,
  sąsiedztwo `slot + slot` (separatory kolumn w `styles.css`) i kolejność, w jakiej
  listy wpisów rezerwują wpisy przez `UsedPostIdsProvider` - czyli treść strony.
- **`content-visibility: hidden`**: zawęża rozmiar wstrzymanego slotu (size
  containment), więc widoczne kolumny po nim ruszają się przy odsłonięciu; ignorowane
  na iOS < 18.
- **`:has()` z wartownikiem**, skrypt z `MutationObserver` w `<head>`, wymuszony
  segment Suspense albo HTML zależny od UA: sprzeczne z zasadami repo albo droższe.

## 4. Drugie źródło w oknie Lighthouse'a: ticker w nagłówku

`TrendingTicker` emitował statyczny arkusz z geometrią pasma (`TICKER_CSS`:
`.tt-glass-chip`, wysokość okna kart) jako OSTATNIE dziecko, ~20 KB HTML-u za kartami.
Malowanie w trakcie parsowania dawało pasmo bez geometrii i przeskok po wczytaniu
stylu: 0,001-0,0125 w chwili FCP (1 z 4 przebiegów na produkcji). Arkusz stoi teraz
zaraz za paletą, przed pasmem, w obu gałęziach (test w `TrendingTicker.test.tsx`).

## 5. Testy

- `src/lib/builder/__tests__/columnOrderGate.test.ts` - przypadki, normalizacja,
  wstrzyknięcia, oraz test właściwościowy: symulacja parsowania prefiksami na 720
  układach (żadna widoczna kolumna nie zyskuje nowego wizualnego poprzednika;
  domykające nigdy nie czekają).
- `builderRenderer.section.test.tsx` - położenie bloków w drzewie dla [2|1|3] i
  inwariant „każde wstrzymanie ma zwolnienie w renderowanym slocie po wstrzymanej
  kolumnie" dla desktop/tablet/mobile.
- `e2e-performance/streamed-column-order.spec.ts` - artefakt + proxy wstrzymujące
  dokument przed drugą kolumną sekcji z mobilną kolejnością; baseline: CLS 0,41 na
  390 px (czerwony), kandydat: 0 na 390 i 1440 px.

## 6. Poza zakresem (do osobnej decyzji)

1. **Autozmiana slajdu hero na telefonie**: tytuł ma tam `height: auto` (3-5 linii
   zależnie od nagłówka), więc każda zmiana na nagłówek o innej liczbie linii przesuwa
   wszystko poniżej o 0,019-0,033 na okno. Dzieje się to po otwarciu bramki ruchu
   (≥ 5 s po załadowaniu), więc poza śladem PSI, ale liczy się do CLS terenowego.
   Kandydat: rezerwa wysokości najdłuższego tytułu przez ukryte „sizery" w jednej
   komórce siatki (CSS, bez pomiaru) + `key` na spanie tytułu; koszt: ukryty tekst
   w HTML-u (SEO) i zmiany w ~7 plikach testów slidera.
2. **Tablet**: SSR maluje porządek desktopowy, `order.tablet` wchodzi po hydratacji
   (przesunięcie przy hydratacji, gdy `order.tablet` ≠ `order.desktop`). Kandydat:
   reguła `@media (min-width: 768px) and (max-width: 1023px)` przed kolumnami.
3. **Kolumna `hideOn.desktop`** nie istnieje w HTML-u serwera i na telefonie wchodzi
   dopiero po hydratacji.
4. Wzrost kolumny domykającej już po jej wczytaniu (granica Suspense dopełniana `$RC`,
   widget bez danych w budżecie SSR, obraz bez wymiarów) nadal może przesunąć
   odsłoniętą kolumnę - bramka pilnuje kolejności parsowania, nie wysokości.
