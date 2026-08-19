# Moduł 5 (strona główna, archiwa, chrome): z 16,7% na pokrytą powierzchnię i progi CI (2026-08-18)

Zamknięcie pozycji **MODUŁ 5 — Strona główna, archiwa, chrome ⚠ · linie 16,71% · funkcje
11,80%** z audytu `AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`.

Audyt nazwał ten moduł dokładnie tym, czym jest: **chrome całego serwisu**. Nagłówek,
stopka, menu i mega menu są na ścieżce KAŻDEJ strony i renderują się po stronie serwera;
archiwa kategorii i tagów to druga najczęściej odwiedzana powierzchnia po wpisach. Awaria
tutaj nie dotyczy jednej funkcji — dotyczy każdego wejścia.

---

## 1. Stan wyjściowy: jedna powierzchnia była katastrofą, jedna wzorem

| Powierzchnia                         | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------ | -----: | ----: | ------: | --------: | --------: |
| Nagłówek / stopka / menu             |   1,8% |  0,0% |    0,3% |  **2,0%** |     1/324 |
| Archiwa kategorii/tagów              |  19,1% | 11,6% |   11,9% | **17,5%** |      8/67 |
| Chrome mobilny (drawer, dolny pasek) |  41,5% | 36,5% |   41,1% | **44,3%** |     23/56 |
| Mega menu                            |  80,9% | 64,2% |   79,5% | **88,1%** |     31/39 |

34 z 51 plików modułu nie miało **ani jednej wykonanej linii**.

### 1.1 Dlaczego mega menu miało 88%, a sąsiedni `SiteMenu` 0,3%

To jest najważniejsza obserwacja audytu i punkt wyjścia całej tej pracy. Obie powierzchnie to
ta sama klasa kodu: komponent nawigacji z konfiguracją z bazy, wariantami układu i wersją
mobilną. Różnica nie była w trudności — była w tym, że przy mega menu **ktoś wydzielił
helpery i napisał do nich asercje** (`normalizeFeatured`, `megaMenuColumnParity`), a przy
`SiteMenu` reguły zostały w ciele komponentów.

Stąd kształt tej pracy: **najpierw wyprowadzenie reguł, potem asercje**. Nie odwrotnie i nie
zamiast.

---

## 2. Co zostało wyprowadzone z organizmów

| Nowy moduł                 | Co wyniósł                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/menus/tree.ts`        | hierarchia menu: budowa drzewa, głębokość, przenoszenie z ochroną przed cyklem, wcięcia, kasowanie poddrzewa, payload zapisu, strefa upuszczenia                            |
| `lib/menus/megaColumns.ts` | układ kolumn mega panelu: dodaj / zmień / usuń kolumnę i link, derywacja układu z drzewa, reguła pickera treści                                                             |
| `lib/menus/siteMenu.ts`    | reguły nawigacji publicznej: drzewo, etykieta z zejściem językowym, wariant panelu (link / dropdown / mega z auto‑promocją), źródło kolumn, linki mobilne, geometria panelu |
| `lib/archive/bodyPlan.ts`  | układ archiwum: karta wyróżniona, podział wpisów, liczba stron, sidebar, kandydat LCP, podział magazynowy                                                                   |

Rozmiary organizmów po wyprowadzeniu: `MenuManager.tsx` 1545 → 1311 linii,
`SiteMenu.tsx` 593 → 494 linii. Oba są teraz **kompozycją**: spinają stan z regułami i nie
zawierają arytmetyki hierarchii ani układu.

Server fn (`lib/menus/menu.functions.ts`, `lib/mobileDrawer.functions.ts`) dostały ten sam
zabieg, co `webhooks.stripe`: ciała handlerów są zwykłymi funkcjami z **wstrzykiwanym
klientem**, a `createServerFn` zostaje cienką obwolutą. Bez tego cała orkiestracja — razem
z bramkami ról — była nietestowalna, bo server fn nie da się wywołać bez kontekstu żądania.

---

## 3. Defekty, które wyszły przy pisaniu testów

Refaktor sam z siebie nie znajduje błędów. Znalazły je asercje pisane do wyprowadzonych
modułów — i to jest jedyny dowód, że ekstrakcja miała sens.

### 3.1 Sierota znikała w edytorze, choć nawigacja serwisu ją pokazywała

Edytor menu grupował pozycje po **surowej** wartości `parent_local_id`. Pozycja wskazująca
rodzica, którego nie ma na liście (skasowany osobno, resztka po starszej strukturze),
lądowała w kubełku, po który rekurencja budująca drzewo nigdy nie sięgała.

Publiczne `SiteMenu` od zawsze promuje taką pozycję na najwyższy poziom. Efekt: pozycja
**widoczna** w nagłówku serwisu i **niewidoczna** w panelu. Administrator nie mógł jej ani
poprawić, ani usunąć — nie istniała dla niego. Gorzej: zapis menu jest destrukcyjny
(delete‑all + insert‑all na podstawie stanu edytora), więc pierwsze kliknięcie „Zapisz"
kasowało ją z bazy bez ostrzeżenia.

Poprawka: `buildMenuTree` normalizuje rodzica spoza listy do `null`. Edytor i front budują
teraz drzewo z tej samej listy w ten sam sposób.

### 3.2 Kasowanie pozycji mogło zabić kartę przeglądarki

`collect` w komponencie (dziś `descendantIds`) nie miał bezpiecznika na cykl. Dwa wiersze
z uszkodzoną hierarchią w bazie (A rodzicem B, B rodzicem A) zamieniały kliknięcie „Usuń"
w nieskończoną rekurencję i `RangeError`.

### 3.3 Etykieta zastępcza szła z kodu, po polsku, do bazy

`label_pl: it.label_pl || it.href || "(bez nazwy)"` — ta wartość **ląduje w bazie** i pokazuje
się czytelnikowi w nawigacji, także w wersji angielskiej. Teraz podaje ją wywołujący ze
słownika (`admin.menu.untitledItem`, PL + EN).

### 3.4 Komentarz przy zapisie menu kłamał

Przy pętli BFS wstawiającej pozycje poziomami stało, że wpis wskazujący rodzica nieobecnego
w payloadzie „nigdy nie zostanie wstawiony". Nieprawda: `localToUuid.get(...) ?? null` daje mu
`parent_id = null`, więc **wchodzi jako pozycja najwyższego poziomu**. Test to utrwala,
komentarz jest poprawiony — i zgadza się teraz z tym, co edytor pokazuje po poprawce 3.1.

### 3.5 Powrót na górę ignorował `prefers-reduced-motion`

Przycisk stopki zawsze wołał `scrollTo({ behavior: "smooth" })`, czyli animował przewijanie
przez całą wysokość dokumentu — także wtedy, gdy system czytelnika prosi o ograniczenie
ruchu. Dla części czytelników (migrena przedsionkowa, choroba lokomocyjna) przejazd przez
kilkanaście ekranów tekstu jest objawowy, a artykuły w tym serwisie bywają długie.
Ze zgłoszoną preferencją skok jest teraz natychmiastowy; bez niej zachowanie bez zmian.

### 3.6 Martwy kod w chunku wejściowym

`SubmenuItem` w `SiteMenu` miał drugi, **nieosiągalny** wariant z własnym `useState`
i wysuwaną w bok listą `<ul role="menu">`. Płaski dropdown renderuje się wyłącznie wtedy, gdy
żadne dziecko nie ma dzieci — inaczej `panelKindFor` promuje pozycję do panelu redakcyjnego.
Gałąź została usunięta, a inwariant, na którym stoi to uproszczenie, ma własny test.

---

## 4. Co testy pilnują (a czego nie pilnowało nic)

**Menu publiczne** — wariant panelu razem z auto‑promocją menu zagnieżdżonego (bez niej wnuki
znikają z nawigacji), zejście etykiety PL↔EN, pozycja bez nazwy w obu językach nie trafia do
nagłówka, adres wykonujący skrypt nie trafia do `href`, panel mieści się w oknie na 320 px,
Escape i kliknięcie poza nagłówkiem zamykają panel, zwłoka zamknięcia przy przejeździe myszą.

**Edytor menu** — zmiana etykiety/adresu/ikony/celu trafia do **ładunku zapisu**, nie tylko na
ekran; usunięcie zabiera całe poddrzewo; wcięcie rozwija nowego rodzica (inaczej pozycja
„znika"); przeciąganie na pozycję, na tło listy i na samą siebie; zapis wysyła klucz menu
z hierarchią przeniesioną na nowe identyfikatory; błąd zapisu pokazuje **powód**.

**Archiwa** — granice, na których mieszkają błędy klasy „brakuje wpisów": pusta strona nie robi
karty wyróżnionej z niczego, karta wyróżniona **zdejmuje** wpis z siatki, wariant magazynowy
sumuje się do wejścia (lead + cztery karty + reszta), archiwum bez wpisów ma jedną pustą
stronę (nie zero), pasek stron pojawia się dopiero od drugiej strony — także dokładnie na
granicy, priorytet LCP dostaje tylko jeden obraz nad zgięciem, podgląd admina nie emituje
reklam ani slide‑upu stopki, sekcja powiązanych taksonomii **nie zostawia nagłówka nad pustką**.

**Chrome mobilny** — kolejność bloków szuflady odczytana z DOM‑u (różnica między „ustawienie
zapisane" a „ustawienie działa"), lupa zamyka szufladę przed otwarciem wyszukiwarki,
wylogowanie zamyka ją dopiero po zakończeniu operacji, każdy link menu ją zamyka; w dolnym
pasku: progi licznika (0 → brak odznaki, 1..99 → liczba, ≥100 → „99+"), gość nie dociąga
warstwy czatu/sieci, rezerwacja miejsca na dole strony i jej **sprzątanie** przy odmontowaniu.

**Trasy archiwum** — dwa poziomy. Kontrakty czyste: adres (`?page=1` i `?sort=newest` zostają
niejawne, śmieciowe wejście znika) oraz nagłówek (`noindex, follow` od strony drugiej,
kanoniczny adres bez parametrów, autodiscovery RSS taksonomii, `numberOfItems` tylko gdy są
wyniki). I trasy ZAMONTOWANE w routerze pamięciowym: loader dogrzewa cache pod tym samym
kluczem, z którego czyta komponent (rozjazd = drugi fetch przy hydracji), brak taksonomii daje
404 a nie puste archiwum, awaria bazy daje stronę błędu z drogą powrotną, blip listy wpisów
daje pustą powłokę zamiast wyjątku, a preload okładki LCP wskazuje ten sam wariant obrazu,
który malowany jest na ekranie (`sizes` karty wyróżnionej vs karty siatki).

---

## 5. Pomiar: przed i po

### 5.1 Powierzchnie modułu

| Powierzchnia                         | Linie PRZED |    Linie PO | fn PRZED |       fn PO |
| ------------------------------------ | ----------: | ----------: | -------: | ----------: |
| Nagłówek / stopka / menu             |        2,0% |  **97,87%** |    1/324 | **325/343** |
| Archiwa kategorii/tagów              |       17,5% | **100,00%** |     8/67 | **110/110** |
| Chrome mobilny (drawer, dolny pasek) |       44,3% |  **98,18%** |    23/56 |   **53/58** |
| Mega menu                            |       88,1% |  **88,70%** |    31/39 |   **46/55** |

Mianowniki różnią się od audytu, bo wyprowadzenie reguł z organizmów utworzyło
nowe moduły (`tree.ts`, `siteMenu.ts`, `megaColumns.ts`, `bodyPlan.ts`), a testy
tras dołożyły do pomiaru cztery pliki `src/routes`. Porównanie „ile funkcji ma
choć jedno wywołanie" jest więc ostrożniejsze niż sam procent: **63 → 534**.

### 5.2 Moduł razem

| Metryka    |  PRZED |         PO | Wymagane w zadaniu |
| ---------- | -----: | ---------: | -----------------: |
| Instrukcje | 16,04% | **95,72%** |                  — |
| Gałęzie    | 11,89% | **83,53%** |                  — |
| Funkcje    | 11,80% | **94,35%** |           ≥ 90% ✅ |
| Linie      | 16,71% | **97,43%** |           ≥ 95% ✅ |

**Plików bez ani jednej wykonanej linii: 34 z 51 → 0 z 52.**

Przypadków testowych w plikach tego modułu: **79 → 593** (23 pliki testowe).

### 5.3 Jak to zmierzono

`bunx vitest run --coverage.enabled` na całym repozytorium, z wyłączeniem 38
plików testowych, które w tym środowisku (kontener bez wyświetlacza) wiszą do
timeoutu — to ta sama lista, którą audyt wskazał w sekcji 9.2. Wyłączenie
dotyczy plików SPOZA modułu 5; jedyny plik modułu z tej listy
(`MobileBottomBarView.test.tsx`) przechodzi tutaj w 1,7 s, więc został
w pomiarze — patrz 5.4.

### 5.4 Marker „pomiar zaniżony" przy module 5 był artefaktem środowiska

Audyt oznaczył moduł 5 adnotacją o zaniżonym pomiarze, bo
`MobileBottomBarView.test.tsx` nie kończył się w tamtym przebiegu. W tej sesji
ten plik przechodzi w komplecie (15 przypadków, 1,7 s) i jest w pomiarze.
Wiszą wyłącznie pliki buildera i widgetów — marker należy do nich, nie do
chrome.

---

## 6. Zapory, żeby pomiar znów nie zamarł

### 6.1 `reportOnFailure: true`

`checkThresholds()` w vitest żyje **wewnątrz** `reportCoverage()`, a z tego bloku runner
wychodzi natychmiast po pierwszym nieudanym teście. Na czerwonym maine `bun run test:coverage`
nie drukował ani jednej liczby — czyli każda praca nad pokryciem była ślepa na własny skutek,
dopóki ktoś inny nie naprawił swojego testu. To odwraca kolejność zależności: pomiar przestaje
zależeć od cudzej zieleni. Progi działają bez zmian.

### 6.2 Progi per‑ścieżka

Siedemnaście nowych wpisów w `vitest.config.ts` obejmuje całą powierzchnię modułu:
`lib/menus/**` (plus trzy czyste moduły pod 100%), `lib/archive/bodyPlan.ts`,
`components/menu/**`, `components/megaMenu/**`, `components/archive/**`,
`components/admin/menu/**`, `components/header/**`, `components/footer/**`,
`components/mobile/**`, `lib/mobileBottomBar/**` oraz cztery trasy archiwum
(`blog.index.tsx`, `category.$slug.tsx`, `tag.$slug.tsx`, `publications.tsx` — po 100% linii
i funkcji).

Każdy próg jest floorowany **pod** zmierzonym poziomem (marża na dryf CI) i ma przy sobie
zdanie, dlaczego akurat tyle — w szczególności co zostaje niedobite i dlaczego nie da się tego
dobić bez udawania (obwoluty `createServerFn`, wywołania zwrotne obserwatora rozmiaru, których
happy-dom nie wywoła, warianty językowe `head()` zależne od adresu żądania).

**Mega menu dostało próg mimo dobrego stanu.** To nie jest zapora „do osiągnięcia", tylko
zapora „żeby nie zjechało": 88,1% linii na tej samej klasie kodu, na której sąsiad miał 0,3%,
pokazuje, jak łatwo taka asymetria wraca.

---

## 7. Czego ten PR NIE robi

- **Nie zastępuje e2e.** Trasy archiwum są zamontowane w routerze pamięciowym, więc dowodzą
  swojego sklejenia (loader → cache → komponent, 404, błąd, preload), ale nie dowodzą realnego
  SSR ani przeglądarki — to zostaje przy `public.spec` i `ssr-completeness.spec`.

  > Zmiana wobec pierwotnego planu. Zadanie mówiło „nie goń pokrycia na trasach — to cienka
  > kompozycja loaderów". Po zamontowaniu ich okazało się, że kompozycją nie są: mieszka tam
  > wybór wariantu layoutu, rozróżnienie 404 od pustego archiwum, degradacja przy blipie
  > backendu i wybór wariantu obrazu do preloadu LCP. Cztery pliki tras stały na 19–71% linii
  > i były jedyną powierzchnią modułu poniżej celu. Po decyzji użytkownika („wykonaj tak, aby
  > pokryć 95%") zostały pokryte — do 100% linii i funkcji.

- **Nie podpina podświetlenia aktywnej sekcji w nagłówku.** `isMenuPathActive` /
  `activeMenuIndex` są napisane i przetestowane (reguła należy do menu, nie do komponentu),
  ale nagłówek ich nie używa — to zmiana zachowania ścieżki krytycznej każdej strony i idzie
  osobną decyzją.
- **Nie tłumaczy pozostałych napisów zaszytych w edytorze menu.** W panelu admina zostaje
  jeszcze kilkanaście polskich literałów („Poziom 1 · pozycje główne", „Tytuł PL",
  „+ Własny link"). Poprawiony został ten JEDEN, który trafiał do bazy i pokazywał się
  czytelnikowi. Reszta to osobna praca i18n, nie efekt uboczny testów.
- **Nie rusza reguł egzekwowanych w bazie.** RLS, izolacja tenanta i role zostają pgTAP‑owi
  w `supabase/tests`.

---

## 8. Bramki: stan na CI (a nie w sandboksie)

Sekcja pisana najpierw z lokalnego przebiegu, potem POPRAWIONA tym, co pokazało CI na
PR #260. Różnice między jednym a drugim są tu wypisane wprost, bo część „ostrzeżeń"
z sandboksa okazała się artefaktem środowiska, a jedno realne zjawisko wyszło dopiero na CI.

### 8.1 Zielone na CI

`format:check` (prettier, także `docs/*.md`), `typecheck`, `lint`, wszystkie bramki SQL
i RPC, `check:unknown-casts`, `check:i18n-hardcoded`, `check:i18n-default-value`,
`check:i18n-overlay-imports`, snapshot autoryzacji, parzystość konfiguracji chunków —
29 kroków `verify` z rzędu bez ani jednego czerwonego. Poza `verify`: **`e2e`,
`e2e-seeded`, `pgtap`, `pg-harness`, `lighthouse` — wszystkie zielone.**

Dwie rzeczy, w których sandboks KŁAMAŁ i CI to wyprostowało:

- **`check:i18n-overlay-imports`** — lokalnie ratchet skarżył się „w dobrą stronę"
  (`AdminShell.tsx` 2 → 0). Na CI krok przechodzi. To był dryf zależności w tym
  kontenerze (instalacja z publicznego npm bez pinów), nie stan repo.
- **8 czerwonych plików testowych** (`lazyWidgets`, `eagerWidgetChunks`, `accordionEditor`,
  `speakersWidget`, `teamMemberEditableFlag`, `postListVariants2`,
  `postsSliderDisplaySettings`, `widgetViewI18nFallback`) — lokalnie czerwone identycznie
  na `39a9efd` i na tej gałęzi. Na CI **nie da się tego potwierdzić ani zaprzeczyć**, bo
  przebieg nie dochodzi do końca (patrz 8.3). Nie twierdzę więc, że są czerwone na CI —
  twierdzę tylko, że w tym sandboksie są, i że tak samo na commicie bazowym.

### 8.2 Lint: jedyna zmiana tej gałęzi poza modułem 5

`AccountIdentityPanel.test.tsx:87` wołał `require("react")` wewnątrz fabryki `vi.mock`
(`@typescript-eslint/no-require-imports`). Błąd jest starszy niż ta gałąź — występuje
identycznie na `39a9efd` — ale miał skutek, którego nikt nie widział: **na main `verify`
padał na lincie, więc krok „Test + coverage gate" był POMIJANY** (status `skipped`).
Testy, pokrycie i wszystkie progi nie wykonywały się w ogóle.

Naprawione tutaj po decyzji autora (`createElement` ze statycznego importu, atrapa renderuje
to samo `<a href>`). Skutek uboczny jest ważniejszy niż sama poprawka: ten PR jest
**pierwszym, który krok testowy w ogóle uruchamia**.

### 8.3 Co przez to wyszło: pełna suita wiesza się na CI

Krok „Test + coverage gate" nie kończy się i zadanie ginie na `timeout-minutes: 20`.
Dwa przebiegi, sygnatura co do pliku identyczna:

| Przebieg | Ostatnia linia postępu             | Cisza    | Koniec              |
| -------- | ---------------------------------- | -------- | ------------------- |
| 1        | `migrationReplay.test.ts` 08:07:51 | 16 min   | `canceled` 08:24:24 |
| 2        | `migrationReplay.test.ts` 08:41:33 | 14,5 min | `canceled` 08:56:15 |

W obu przy sprzątaniu runner ubijał wciąż żywe procesy `bun`, `esbuild` i cztery `node` —
to zawieszenie transformacji, nie powolne testy. Podniesienie limitu czasu nic by nie dało.

**To nie jest defekt tej gałęzi.** Test A/B na tej samej maszynie, z tymi samymi
`node_modules`:

| Rewizja                           | `settingsFidelity.gate.test.tsx` |
| --------------------------------- | -------------------------------- |
| `39a9efd` (main, baza tej gałęzi) | wisi > 200 s                     |
| ta gałąź                          | wisi > 200 s                     |
| gałąź PR #256 (moduł 3)           | kończy się w 5 s                 |

PR #256 przebudowuje dokładnie tę powierzchnię (`lazyWidgets.tsx` → `lazySuspense.tsx`

- `lazySliderRender.tsx`) i jego `verify` przechodzi na CI **całą** suitę w 17 min 07 s.
  Ślad przyczyny: esbuild dławi się na transformacji `src/test/eagerWidgetChunks.tsx` —
  gorliwego lustra rejestru wszystkich 99 widgetów.

Decyzja (autora): **nic tu nie naprawiamy**. #256 wchodzi do main, potem ta gałąź wciąga
main i CI powinno przejść bez żadnej ingerencji w kod modułu 5. Alternatywy — obejście
w konfiguracji vitest albo własna naprawa w module 3 — dublowałyby cudzą pracę na tej samej
powierzchni.

### 8.4 `check:bundle`

Na CI ten krok **nie został osiągnięty** (stoi za krokiem testowym). Lokalnie: budżet
3870 KB, na `39a9efd` **3870,7 KB**, na tej gałęzi **3870,5 KB** — o 0,2 KB **mniej**.
Usunięcie nieosiągalnej gałęzi `SubmenuItem` z chunku wejściowego (sekcja 3.6) odjęło
więcej, niż dodały wyprowadzone moduły. Budżet był przekroczony przed tą pracą; kronika
w `check-bundle-size.ts` wskazuje ruchy `vendor +43,9 KB`, `i18n +27,6 KB`,
`ConsentBanner NOWY` — nie z tej gałęzi.

### 8.5 Czym stoi pomiar tej pracy

Wszystkie 631 przypadków w 24 plikach testowych tej gałęzi przechodzi (17,6 s razem —
to nie one są kosztem przebiegu CI), a nowe progi per‑ścieżka zostały zweryfikowane wprost
z raportu `coverage-final.json` tą samą arytmetyką, której używa vitest (sumy per plik
w obrębie wzorca) — **17 z 17 spełnionych z marżą**. Do czasu, aż zawieszenie z 8.3 zniknie
z main, jest to jedyny dostępny dowód na progi: bramka CI po prostu do nich nie dochodzi.
