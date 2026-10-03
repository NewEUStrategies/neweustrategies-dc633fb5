# Design system (`src/components/ui`): sześć funkcjonalności - naprawy, optymalizacje, testy (2026-10-03)

Zlecenie: „Optymalizuj, naprawiaj, wdrażaj testy" dla sześciu wierszy przekroju
**X-design-system** z tabeli funkcjonalności audytu wydania 12
(`AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 16) oraz
otwartych pozycji zlecenia `PROMPT_DESIGN_SYSTEM.md` (A1-A4, B1, rozdz. 3).

Audyt nie publikuje reguł plików dla wierszy X-design-system (taksonomia
w `scripts/taxonomy/features.mjs` obejmuje moduły 3, 7, 16 i 21), więc przypisanie
plików do wierszy jest moją rekonstrukcją. Pięć wierszy dopasowałem co do linii
z liczbami audytu (np. karuzela okrężna: 59 + 62 = 121 linii, funkcje 20 + 24 = 44):

| Wiersz audytu                                         | Pliki                                       |
| ----------------------------------------------------- | ------------------------------------------- |
| Karuzela okrężna z nawigacją klawiaturą               | `circular-carousel.tsx`, `text-rotate.tsx`  |
| Progresywny slider z paskiem postępu na przyciskach   | `progressive-carousel.tsx`                  |
| Wybór daty i godziny z zapisem w ISO/UTC              | `datetime-picker.tsx`, `calendar.tsx`       |
| Jednolity wygląd kontrolek w jasnym i ciemnym motywie | prymitywy shadcn/Radix (lista w rozdz. 2.4) |
| Galeria showcase w popupie rejestracji                | `signup-showcase.tsx`, `field-box.tsx`      |
| Karta trasy z polubieniem pamiętanym w przeglądarce   | `travel-route-card.tsx`                     |

Wiersz „Jednolity wygląd" (28 plików w audycie) to reszta prymitywów po odjęciu
pozostałych wierszy X-design-system; tu dopasowanie co do pliku nie jest pewne.

---

## 1. Pomiar

Przed: liczby z tabeli zlecenia (audyt wyd. 12, HEAD `b8b53ae5`). Po: pełna suita
na tej gałęzi (3208 plików testowych, 83 644 przypadki), provider `istanbul`
z `vitest.config.ts`, raport zawężony do `src/components/ui/**`.

| Wiersz                     | Przed: linie / gałęzie / funkcje | Po: linie / gałęzie / funkcje   | Pliki na zerze |
| -------------------------- | -------------------------------- | ------------------------------- | -------------: |
| Karuzela okrężna           | 73,6% / 59,1% / 69,0% (26/44)    | **100% / 100% / 100%** (40/40)  |              0 |
| Progresywny slider         | 78,8% / 60,3% / 84,6% (22/26)    | **100% / 100% / 100%** (30/30)  |              0 |
| Wybór daty i godziny       | 86,9% / 85,1% / 83,3% (20/24)    | **100% / 100% / 100%** (23/23)  |              0 |
| Jednolity wygląd kontrolek | 87,0% / 40,5% / 81,0% (81/100)   | **100% / 98,2% / 100%** (92/92) |      2 → **0** |
| Galeria showcase           | 92,6% / 81,5% / 89,5% (17/19)    | **100% / 100% / 100%** (24/24)  |              0 |
| Karta trasy                | 96,0% / 76,0% / 100% (6/6)       | **100% / 100% / 100%** (8/8)    |              0 |

Kolejność kolumn „przed" jak w tabeli zlecenia: linie, gałęzie, funkcje.
Liczba funkcji po jest inna niż przed, bo kod się zmienił (np. martwe prymitywy
usunięte, nowe handlery klawiatury i pauzy).

Cała powierzchnia `src/components/ui`: **100% linii (842/842), 100% funkcji,
99,57% instrukcji, 94,43% gałęzi, zero plików na zerze** (zlecenie, rozdz. 7:
cel 92% linii i 90% funkcji). Testy w `src/components/ui/__tests__`: 2 pliki na
`967cec9`, 10 na HEAD tej gałęzi przed pracą, **46 po** (po jednym na komponent).

Czerwone w pełnej suicie, wszystkie poza tym PR-em: pięć plików `xlsx`
(zaślepka, rozdz. 5) oraz `src/lib/__tests__/i18nOrganizations.test.ts` -
klucz `organization.seoDescriptionFallback` zniknął ze słownika
`i18n-organizations` na `main` (`531a2c5`) i test pada tam tak samo.

---

## 2. Naprawy - każda z testem, który pada na starym kodzie

Każdy test regresji niżej sprawdziłem w dwie strony: przechodzi na nowym kodzie
i pada na pliku z `HEAD` (podmiana pliku produkcyjnego, ten sam test).

### 2.1. Karuzela okrężna (`circular-carousel.tsx`, `text-rotate.tsx`)

- **Nawigacja strzałkami gubiła ognisko po trzech krokach.** Ognisko zostawało
  na starej karcie (nikt go nie przenosił), a przy `visibleCount=5` po trzecim
  kroku ta karta wypadała z widoku i znikała z DOM - ognisko lądowało na `<body>`
  i dalsze strzałki nie robiły nic. Teraz roving tabindex: przy zmianie z
  klawiatury ognisko idzie za aktywną kartą. Flaga przeniesienia jest ustawiana
  tylko przy realnej zmianie indeksu, żeby nie ukradła później ogniska strzałce
  pod kartami.
- **Home/End** na regionie (skok na pierwszą/ostatnią kartę).
- **Enter na linku karty nie nawigował**: obsługa karty łapała bąbelkujący
  `keydown` i robiła `preventDefault`. Teraz ignoruje zdarzenia z dzieci.
- **Pauza auto-play**: kursor i ognisko pauzują niezależnie (zjazd myszą nie
  wznawia rotacji, gdy ognisko jest w środku - WCAG 2.2.2), przejście ogniska
  między elementami karuzeli nie jest „wyjściem", rotacja nie startuje przy
  `prefers-reduced-motion`, karty mają `motion-reduce:transition-none`.
- Licznik ma `aria-live="polite"` poza rotacją (`off` w trakcie), ujemny
  `activeIndex` jest przycinany do 0.
- **TextRotate bez pętli gasił ostatni tekst na stałe**: kolejny tik na ostatnim
  indeksie zerował `entered`, a efekt wejścia zależny od indeksu już się nie
  uruchamiał (segmenty zostawały z `opacity: 0`). To samo `previous()` na
  pierwszym i `reset()`/`jumpTo(bieżący)`. Przejście na ten sam indeks jest teraz
  no-opem, a auto-rotacja bez pętli staje na ostatnim tekście.
- **TextRotate po skróceniu listy (edycja widgetu) pokazywał pusty tekst** aż do
  następnego obrotu - indeks jest przycinany.
- **TextRotate: `aria-label` na `<span>` bez roli** (zakazane w ARIA 1.2,
  czytniki pomijają albo czytają podwójnie z tekstem `sr-only`) - etykieta
  jawna trafia teraz do `sr-only`. Własna kopia `usePrefersReducedMotion`
  zastąpiona wspólnym hookiem.

### 2.2. Progresywny slider (`progressive-carousel.tsx`) - A1, pozycja blokująca

- **Klik w przycisk slajdu nie przełączał slajdu** pod kursorem i przy ognisku
  (czyli zawsze przy myszy i przy Tab), a w podglądzie edytora (`paused`) wcale:
  `handleButtonClick` zapisywał tylko refy, a pętla rAF biegła wyłącznie przy
  auto-play. Docelowy slajd jest teraz stanem Reacta, jedna pętla obsługuje
  auto-play i dobieg po kliknięciu, a dobieg startuje od narysowanego postępu
  zamiast od zera. Kryterium odbioru zlecenia (klik po `mouseEnter` bez
  `mouseLeave`; `focus` + Enter bez `blur`) jest testem.
- Klik w aktywny slajd w trakcie dobiegu odwołuje dobieg; pauza kursora
  i ogniska rozdzielona jak w karuzeli okrężnej.
- Test widoku `ProgressCarouselView` asertował `aria-current` przez
  `toBeTruthy()`, co przechodziło także dla `"false"` - dlatego A1 nie był
  widoczny w testach. Asercja jest teraz ścisła.

### 2.3. Wybór daty i godziny (`datetime-picker.tsx`, `calendar.tsx`)

- **Nieczytelny ISO z bazy wywracał formularz**: `format()` rzuca `RangeError`
  na `Invalid Date`. Taka wartość jest teraz pustym polem.
- **Przycisk czyszczenia był elementem interaktywnym wewnątrz `<button>`**
  (`span role="button"` w triggerze): niepoprawny HTML, nazwa „Wyczyść"
  doklejana do nazwy pola, Spacja otwierała popover, a przy `disabled` krzyżyk
  pozostawał w taborze. Teraz to rodzeństwo triggera, zablokowane razem z polem;
  test przechodzi audyt axe (`nested-interactive`).
- **Ostatnie napisy PL/EN w kodzie** (placeholder, „Teraz", „Wyczyść") przeszły
  na klucze `dateTimePicker.*` (zapadka `check:i18n-hardcoded` 5 → 1).
- **Kalendarz przemontowywał całą siatkę przy każdym renderze rodzica**:
  `Root`, `Chevron` i `WeekNumber` były literałami w renderze, czyli nowym typem
  elementu za każdym razem - React zrywał drzewo dni razem z przyciskiem, który
  miał ognisko. Podkomponenty są na poziomie modułu (test: węzły DOM przeżywają
  `rerender`).
- **Rozwijana lista miesięcy szła językiem przeglądarki** (`toLocaleString("default")`)
  zamiast językiem kalendarza - przy polskim interfejsie i angielskiej przeglądarce
  „Jan" zamiast „sty".
- Optymalizacja: `getDefaultClassNames()` (pętle po czterech enumach biblioteki)
  liczone raz na moduł zamiast w każdym renderze kalendarza i każdego z ~42 dni.
- A4 (`initialFocus`) było już zamknięte na tym HEAD (wszystkie miejsca mają
  `autoFocus`); doszedł test, że po otwarciu ognisko jest w siatce dni.

### 2.4. Jednolity wygląd kontrolek (prymitywy)

- **A3, droga (a): usunięty martwy kod** - `download-button.tsx` (109 wierszy,
  zero importów), jego słownik `src/lib/i18n-download-button.ts` (25),
  `form-link.tsx` (27; drogi (b) nie dało się wziąć: `AuthFormBlocks` używa
  `<Link>` routera, a `FormLink` renderuje surowe `<a>`, więc podpięcie zabrałoby
  nawigację po stronie klienta) oraz **238 wierszy martwego CSS `.dlb-*`**
  z `src/styles.css`, ładowanego na każdej stronie. Klasa `.form-link` zostaje -
  używają jej formularze logowania.
- **Osiem prymitywów zdefiniowanych i nieeksportowanych** (kod nieosiągalny):
  `AlertTitle`, `BreadcrumbEllipsis` (z angielską etykietą „More"),
  `CommandShortcut`, `SelectLabel`, `SelectSeparator`, `SheetFooter`,
  `TableFooter`, `TableCaption`; martwy wariant poziomy wewnętrznego `ScrollBar`.
- **Ikony omijające przełącznik paczki** (`lucide-react` wprost) w `accordion`,
  `context-menu`, `circular-carousel`, `datetime-picker`, `signup-showcase` -
  przepięte na `@/lib/lucide-shim`, więc paczka Font Awesome obejmuje je tak jak
  resztę interfejsu.
- **`Progress` nie przekazywał `value` korzeniowi Radiksa**: pasek był dla
  czytnika ekranu zawsze „nieokreślony". To rozbroiło `it.fails` „DEFEKT: postęp
  wysyłki nie dociera do czytnika ekranu" w `profileDashboardRoute.test.tsx`
  (teraz zwykły test).
- **Okno palety poleceń bez nazwy dostępnej** (axe `aria-dialog-name`):
  `CommandDialog` wymaga teraz `label` (niewidoczny `DialogTitle`), paleta podaje
  `search.title`.
- **`Breadcrumb` rozlewał nieczytany prop `separator` na `<nav>`**
  (`separator="[object Object]"`) - prop usunięty z typu.
- **Zamknięcie okna sterowanego propem `open` gubiło ognisko na `<body>`**
  (WCAG 2.4.3): Radix oddaje je tylko swojemu `Trigger`, a większość okien
  w repo (wszystkie arkusze - moduł nie eksportuje `SheetTrigger`, hosty
  potwierdzeń) go nie ma. Hook `useReturnFocus` (w `dialog.tsx`, używany też przez
  `Sheet` i `AlertDialog`) oddaje ognisko elementowi, który je miał przy
  otwarciu; `onCloseAutoFocus` wywołującego z `preventDefault()` ma
  pierwszeństwo, a `<body>` (klik bez ogniska, np. Safari) nie jest celem -
  wtedy zostaje `Trigger` Radiksa.
- Pliki wiersza: `accordion`, `alert-dialog`, `alert`, `avatar`, `badge`,
  `breadcrumb`, `button`, `card`, `checkbox`, `command`, `context-menu`, `dialog`,
  `hover-card`, `input`, `label`, `link-preview`, `popover`, `progress`,
  `scroll-area`, `select`, `sheet`, `skeleton`, `slider`, `sonner`,
  `subscribe-button`, `switch`, `table`, `tabs`, `textarea`.

### 2.5. Galeria showcase (`signup-showcase.tsx`, `field-box.tsx`)

- **Atrament galerii z progu luminancji zamiast z kontrastu**: półtony
  (luminancja ~0,19-0,4, np. `#8a8a8a`) dostawały biały tekst ~3,4:1, choć
  ciemny atrament daje ~5,7:1. Wybór idzie teraz przez `contrastRatio`
  z `popupDesign` z faktycznymi atramentami galerii.
- **Auto-rotacja zmieniała podpis bez możliwości zatrzymania** - teraz pauza
  pod kursorem i przy ognisku, brak rotacji przy `prefers-reduced-motion`.
- **`FieldBox`: pusty placeholder z konfiguracji unosił etykietę nad pustym
  polem** (`""` przechodził przez `??`, a `:placeholder-shown` przestawał
  pasować); `invalid` dawał tylko `data-invalid` na ramce, bez `aria-invalid`
  na polu (czytnik nie słyszał błędu w formularzach rejestracji na wydarzenie);
  `id` podane z zewnątrz było nadpisywane przez `useId`.
- Martwy zapas `MOSAIC_PLACEMENT[index] ?? {}` (kafli jest najwyżej cztery).

### 2.6. Karta trasy (`travel-route-card.tsx`)

- **Polubienie w innej karcie przeglądarki nie docierało** do otwartej strony -
  karta słucha teraz zdarzenia `storage` (także wyczyszczenia całej pamięci).
- Martwe osłony `typeof window` w odczycie/zapisie (biegną tylko w efekcie
  i handlerze) usunięte.

### 2.7. Optymalizacje bez zmiany zachowania

- Slider: postęp (zmiana co klatkę, 60/s) w osobnym kontekście - co klatkę
  renderuje się tylko pasek aktywnego przycisku, a nie każdy slajd ze zdjęciem
  (test z `<Profiler>`: zero commitów slajdów w trakcie animacji).
- Slider: pierwszy slajd aktywny już w HTML-u serwera (`ProgressCarouselView`
  podaje `activeSlider`); wcześniej SSR i pierwsza klatka nie miały aktywnego
  slajdu, więc obszar zdjęcia stał pusty do hydratacji.
- Kalendarz: patrz 2.3 (brak przemontowań, mapa klas raz na moduł).
- Globalny CSS: -238 wierszy martwego `.dlb-*`.

### 2.8. Budżet paczek (`check:bundle`) - skutek uboczny scalania chunków

Pierwszy push oblał „Bundle size budget": public 2892,0 KB przy progu 2877
(`main`: 2854,7). Rozbiór inwentarzem chunków (`BUNDLE_INVENTORY=1`, oba buildy
lokalnie, porównanie zbiorów modułów w chunkach publicznych tą samą regułą co
`adminOnlyByGraph`) dał dwie przyczyny, obie w decyzjach Rollupa
`experimentalMinChunkSize: 2048`, a nie w nowym kodzie:

1. **Mikromoduł `return-focus.ts`** (~0,6 KB) przestawił scalanie tak, że chunk
   pomocników date-fns (5,6 KB gz) wszedł do domknięcia startowego (boot 9 → 10
   chunków). Hook przeniesiony do `dialog.tsx` - boot wraca do 9 chunków.
2. **Pulpit analityki admina w grafie publicznym** (~190 KB kodu: AdminDashboard,
   ChartCard, `i18n-admin-analytics`). Trasa `/admin/` dzieli
   `loadAdminDashboard` między `loader` i komponent, więc splitter TanStacka
   wydzielał go do mikromodułu `admin.index.tsx?tsr-shared=1` (~140 B). Rollup
   dokleja taki mikromoduł do chunku wybranego po rozmiarach innych chunków: na
   `main` trafiał do chunku trasy admina, po zmianie rozmiarów kilku widgetów
   z tego PR-a - do `CalendarView`, a w innym buildzie do chunku wejściowego.
   Krawędź `import()` pulpitu wychodziła wtedy z publicznego chunku.
   `scripts/lib/routeCodeSplitting.ts` trzyma teraz dla `/admin/` `loader`
   w jednej grupie z komponentem: import zostaje w chunku `admin.index-*`
   niezależnie od rozmiarów reszty bundla (test w `routeCodeSplitting.test.ts`).

Pomiar po obu poprawkach (lokalnie, oba buildy na tym samym hoście; bez paczki
`xlsx` nie powstaje `spreadsheet.worker`, więc liczby bezwzględne są niższe niż
w CI - porównywać parami):

| Metryka (KB gz) | `main` `531a2c5` | PR, pierwszy push | PR po poprawkach |
| --------------- | ---------------: | ----------------: | ---------------: |
| public          |           2711,5 |            2748,1 |       **2714,2** |
| admin-only      |           1944,7 |            1912,9 |           1945,1 |
| overall         |           4656,2 |            4661,0 |       **4659,2** |
| CSS             |             96,0 |              95,2 |         **95,2** |
| boot (chunki)   |        473,9 (9) |        478,8 (10) |    **473,4 (9)** |

Zostaje +2,7 KB public i +3,0 KB overall - realny kod napraw (klawiatura, pauzy,
przywracanie ogniska, testowane gałęzie). `check:chunks`, `check:entry-purity`
i `check:server-entry-purity` przechodzą na tym artefakcie. Przekroczenie
`overall` w CI (4791,8 > 4772) istnieje już na `main` i nie jest skutkiem tego
PR-a.

---

## 3. Czego świadomie NIE zrobiłem

- **Angielskie etykiety `sr-only` „Close" w `Dialog`/`Sheet` i nazwa „breadcrumb"
  na `<nav>`.** Naprawa wymaga i18n w prymitywie użytym w całym repo, a dziewięć
  plików testowych konsumentów asertuje dziś „Close" (m.in. `careerRoleDialog`,
  `LoginPopup`, `adminProgramsRoute`). To osobny PR, nie dopisek do tego.
- **`CommandSeparator` z rolą `separator` wewnątrz `listbox`** (axe
  `aria-required-children`) - struktura cmdk; test palety nie asertuje tego jako
  poprawnego.
- Gałęzie, których testy `ui/__tests__` nie pokrywają: warianty wyglądu kart
  (`promo-card`, `cover-overlay-card`, `grid-card`) spoza sześciu wierszy -
  pokrywają je testy widgetów; tego PR-a dotyczą tylko w progu zbiorczym.

---

## 4. Progi

`vitest.config.ts` dostał pierwsze progi tej powierzchni (zlecenie B1): osiem
plików pięciu wierszy na 98 we wszystkich czterech metrykach, zmierzone na 100%
samymi testami `ui/__tests__`, oraz próg zbiorczy `src/components/ui/**`
(97 / 97 / 97 / 91 dla instrukcji, funkcji, linii i gałęzi), czyli ~3 pp pod
pomiarem pełnej suity, jak przy innych globach w tej konfiguracji.

---

## 5. Środowisko pomiaru

Host `cdn.sheetjs.com` (tarball `xlsx`) jest w tej sesji zablokowany polityką
sieci (403). Jak w audycie wydania 12 (rozdz. 16.1): zależności zainstalowane
bez tej jednej paczki, w `node_modules/xlsx` lokalna zaślepka poza repozytorium;
`package.json` i `bun.lock` nietknięte. Koszt: testy wołające prawdziwą
bibliotekę i 10 błędów `tsc` o brakujących typach `xlsx` - wszystkie poza
zakresem tego PR-a.
