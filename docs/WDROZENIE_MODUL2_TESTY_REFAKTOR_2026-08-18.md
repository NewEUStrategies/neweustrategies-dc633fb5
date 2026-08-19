# Moduł 2 (edytor wpisów i workflow redakcyjny): reguły z organizmów, bramki, pokrycie (2026-08-18)

Zamknięcie pozycji **„MODUŁ 2 — Edytor wpisów i workflow redakcyjny: linie 8,34%,
funkcje 6,85%, plików 0%: 64/83"** z audytu
`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` — najsłabszego modułu
w całym repo, jedynego bez ani jednego progu per-ścieżka.

---

## 1. Cztery ustalenia, które zmieniły plan pracy

Zlecenie opisywało stan na podstawie audytu. Weryfikacja w kodzie pokazała, że
cztery jego założenia są nieaktualne albo niepełne — i każde z nich przesuwało
pracę w inne miejsce, niż wskazywał opis.

### 1.1 Reguły rewizji i workflow BYŁY już wyekstrahowane

Zlecenie kazało wynieść do czystych modułów: limit 50 rewizji, throttling 5 minut,
pominięcie `status` przy przywracaniu, wyliczanie diffa pól, dozwolone przejścia
`draft → review → published`, walidację definicji kroków i mapowanie statusów runa.

Wszystkie te reguły **już były czystymi modułami i już miały testy**:

| Reguła                                                                                                              | Gdzie mieszka                     | Test                             |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| `REVISION_KEEP_LIMIT = 50`, `REVISION_MIN_INTERVAL_MS`, `shouldSnapshot`, `pickRestorableFields` (odsiewa `status`) | `src/lib/content/revisions.ts`    | `revisions.test.ts`              |
| LCS diffa pól, `collapseContext`, limit 800 linii                                                                   | `src/lib/content/revisionDiff.ts` | `__tests__/revisionDiff.test.ts` |
| `evaluateTransition`, `statusOptionsFor`, `isFirstPublish`                                                          | `src/lib/content/workflow.ts`     | `workflow.test.ts`               |
| `validateWorkflowDraft`, `parseWorkflowSteps`, `aggregateRunStats`                                                  | `src/lib/admin/workflows.ts`      | `__tests__/workflows.test.ts`    |

Powód, dla którego audyt pokazywał tu 0%: reguły mapowania z jego rozdziału 9.1
przypisują `src/lib/content/` do **MODUŁU 3**, a `src/lib/admin/` do **MODUŁU 19**.
Moduł 2 dostał w mianowniku wyłącznie warstwę kompozycji i adapterów.

**Konsekwencja dla tej pracy:** nie duplikujemy istniejących modułów. Ekstrahujemy
to, co faktycznie nie zostało wyniesione, a testujemy warstwę, która naprawdę stała
na zerze.

### 1.2 „Workflow draft→review→published · 7 plików" to nie ten workflow

Te 7 plików (`src/components/admin/workflows/**`) to panel **automatyzacji** —
deklaratywny silnik przepisów „gdy zdarzenie → wykonaj akcje" z migracji
`20260711204000`, razem z historią przebiegów, katalogiem szablonów i śladem
korelacji. Redakcyjny `draft → review → published` żyje w `lib/content/workflow.ts`
i w triggerze `enforce_post_workflow`. Etykieta funkcjonalności w audycie jest myląca.

### 1.3 Trzy z czterech „czerwonych testów" były już zielone

| Test                  | Stan na HEAD `39a9efd`                                                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authzSnapshotParity` | **zielony** (12/12). Snapshot odświeżył commit `038d8cb`, `check:authz-snapshot` potwierdza zgodność z migracjami. Bramka flagi `pro_briefings\|policy:events/events member read` była już rozstrzygnięta — **żadna decyzja o kręgu uprawnionych nie była potrzebna**. |
| `companyViews` (CRM)  | **zielony** — ten sam commit zamroził zegar `vi.useFakeTimers`. Test gnił z upływem kalendarza, nie z powodu kodu produkcyjnego.                                                                                                                                       |
| `labelsEn`            | **zielony** (8/8).                                                                                                                                                                                                                                                     |
| `lazyWidgets`         | **czerwony — i gorzej, niż mówiło zlecenie**: brakowało TRZECH wpisów (`AccordionWidget`, `SectionLabelWidgetView`, `TrendingNowView`), nie jednego.                                                                                                                   |

Do tego **czwarty czerwony test, którego zlecenie nie wymieniało**:
`src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts`. Ta sama przyczyna co
w `lazyWidgets` — commit `01253dc` („Chunk wejściowy: 374 → 253 KB gz") zepchnął
widgety na leniwą krawędź i nie zaktualizował ani listy w teście, ani lustra eager.

### 1.4 Liczby linii w zleceniu były zaniżone ok. 4×

Zlecenie podawało `admin.posts.tsx` = 199 linii; plik ma 768 linii surowych.
Rozbieżność jest pozorna: audyt liczy **mierzone linie wykonywalne** (v8), nie
surowe. Cały moduł to 12 317 linii surowych, ale tylko **2 128 linii mierzonych** —
i to jest właściwy mianownik pracy.

---

## 2. Stan wyjściowy: pomiar, który sam siebie wyłączał

### 2.1 Bramka, która milczała dokładnie wtedy, gdy była potrzebna

`checkThresholds` jest wołane wewnątrz `coverageProvider.reportCoverage()`, a vitest
wychodzi z tej metody natychmiast przy pierwszym padniętym teście:

```ts
if (!this._coverageOptions.reportOnFailure) return;
```

Przy domyślnym `false` pojedynczy czerwony test wyłączał **jednocześnie** próg
globalny i wszystkie 37 progów per-ścieżka, a raport nie powstawał wcale. Skutek był
odwrotny do zamierzonego: w chwili, w której pokrycie może się osunąć (suita już
czerwona, ktoś naprawia w pośpiechu), bramka nie sprawdzała niczego. Audyt z 18.08
musiał z tego powodu odtwarzać pomiar obejściem opisanym w swoim rozdziale 9.3.

`reportOnFailure: true` przywraca widoczność pomiaru. Zieleń CI nadal zależy od
testów — to nie jest rozluźnienie bramki.

### 2.2 Pomiar bazowy

Mierzone `vitest run --coverage` (v8, `all: true`, całe `src/` w mianowniku), z
pominięciem dwóch powierzchni wieszających ten sandboks (rozdz. 9.2 audytu:
`components/admin/builder/**`, `components/builder/organisms/widget-view/**`).

| Metryka    | Audyt 18.08 | HEAD przed tą pracą |
| ---------- | ----------: | ------------------: |
| Linie      |       8,34% |          **14,99%** |
| Instrukcje |       7,75% |          **14,40%** |
| Gałęzie    |       6,82% |          **11,57%** |
| Funkcje    |       6,85% |          **11,79%** |

Mianownik: 2 128 linii, 780 funkcji, 89 plików, z tego **61 na okrągłym zerze**.

---

## 3. Defekty znalezione przy pisaniu testów

Refaktor sam z siebie nie znajduje błędów. Znalazły je testy pisane do
wyekstrahowanych reguł — i to jest jedyny dowód, że ekstrakcja miała sens.

### 3.1 Przywracanie wersji popupu nie działało wcale

`BuilderVersionsPane` budował mutację przywracania warunkiem z **dwiema
identycznymi gałęziami**:

```ts
useRestoreBuilderRevision(tab === "template" ? "global_widget" : "global_widget");
```

Skutek był najbardziej mylący z możliwych, bo gałąź **podglądu** rozróżniała zakładki
poprawnie: redaktor widział właściwą starą wersję popupu, klikał „Przywróć tę wersję"
i dostawał ogólne „Nie udało się przywrócić". Przyczyna: `parseGlobalWidgetRevision`
dostawał payload popupu (`{builder_data, settings}`) i zwracał `null`. Gdyby
kiedykolwiek sparsował, zapis poszedłby `UPDATE`-em na `builder_global_widgets` po
identyfikatorze **popupu** — w zero wierszy, z komunikatem o sukcesie.

Nic w warstwie kontrolnej repo tego nie widziało: `tsc` przepuszcza warunek
o identycznych gałęziach (typy się zgadzają), a plik stał na 0%.

### 3.2 Kalendarz: obietnica z nagłówka wisiała na jednym propie JSX

Nagłówek `admin.posts.calendar.tsx` obiecuje wprost, że przeciągnięcie wpisu
**opublikowanego** jest „świadomie zablokowane", bo re-datowałoby archiwum, sitemapy
i feedy. Reguła istniała wyłącznie jako `draggable={canPublish && p.status ===
"scheduled"}` w komórce dnia — a `onDragEnd`, czyli miejsce, które faktycznie woła
`updatePost`, nie sprawdzał ani statusu, ani roli. Dołożenie uchwytu przeciągania
w nowym widoku odblokowałoby zapis bez ani jednego czerwonego testu.

### 3.3 Katalog statusów rozjechany z bazą w OBIE strony

Mapa statusów w `RunStatusBadge` znała `pending` i `retry` — wartości, których nie
dopuszcza **żaden** CHECK — a nie znała `queued` ani `delivering`, które w bazie
występują naprawdę:

```sql
workflow_runs.status           CHECK IN ('succeeded','failed')
integration_deliveries.status  CHECK IN ('queued','delivering','delivered','failed','dead')
```

Dostawa w kolejce i dostawa w trakcie wysyłki trafiały do gałęzi domyślnej, więc panel
pokazywał surową wartość z bazy zamiast etykiety — i to akurat w dwóch stanach,
w których administrator **patrzy**, czy webhook wyszedł.

### 3.4 Cztery angielskie literały w polskim panelu

Ten sam plik: cztery z sześciu etykiet były napisami wpisanymi wprost w komponent
(`"delivered"`, `"pending"`, `"retry"`, `"dead"`) obok dwóch przetłumaczonych przez
`t()`. W polskim panelu dawało to mieszankę dwóch języków w jednej kolumnie tabeli.

### 3.5 Lustro eager nie znało dwóch widgetów

`src/test/eagerWidgetChunks.tsx` nie miał `AccordionWidget` ani
`SectionLabelWidgetView`. Skutek jest opisany w nagłówku samego lustra: `WidgetView`
dostaje `undefined`, widget renderuje pustkę, a bramka wierności ustawień uznaje
**każde** jego ustawienie za martwe — zgłasza defekt tam, gdzie go nie ma, i kusi
wpisaniem odstępstwa zamiast naprawy.

### 3.6 Lista wersji bez wskazania, którą wersję czytasz

`VersionRow` sygnalizował wybraną wersję **wyłącznie** klasą tła, więc czytnik ekranu
czytał listę jako zestaw identycznych przycisków. Dodane `aria-current`.

---

## 4. Ekstrakcja: reguła wychodzi z organizmu, komponent zostaje kompozycją

### 4.1 Zasada umiejscowienia (nieoczywista i istotna)

Nowy czysty moduł w `src/lib/**` wpada przez catch-all `src/lib/` do **MODUŁU 20**,
nie do 2. Żeby reguła liczyła się do modułu, który ją niesie, musi leżeć pod wzorcem
ścieżek tego modułu. Repo ma na to precedens: `post-editor/lib/layoutOverrides.ts`.
Wszystkie nowe moduły trzymają tę konwencję.

### 4.2 Co powstało

| Moduł                                  | Co przejął z komponentu/trasy                                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post-editor/lib/editorialCalendar.ts` | siatka miesiąca od poniedziałku, klucz dnia, zakres zapytania, grupowanie, prawo do przesunięcia terminu, wyliczenie nowego terminu                                           |
| `post-editor/lib/postPatch.ts`         | budowa payloadu zapisu (47 pól), lista pól tylko do odczytu, baza optimistic-locka, rozstrzygnięcie slugu, klasyfikacja błędu zapisu, bramka SEO, „zaplanowany w przeszłości" |
| `versions/lib/builderVersions.ts`      | typ encji dla przywracania, argumenty zapytania o wersje, dokumenty podglądu, format daty (trzy kopie → jedna)                                                                |
| `workflows/lib/runStatus.ts`           | katalog statusów jako lustro CHECK-ów + deskryptor (ton, ikona, klucz i18n)                                                                                                   |
| `workflows/lib/panelRules.ts`          | wartownik „wszystkie", zainstalowane szablony, parametry zapytania o historię, walidacja identyfikatora śladu                                                                 |
| `lib/revisions/listProjection.ts`      | projekcja wiersza rewizji na pozycję listy                                                                                                                                    |

### 4.3 Deskryptory zamiast napisów

`runStatusDescriptor()` zwraca `{tone, icon, labelKey}` — **dane albo klucz i18n,
nigdy gotowy tekst**. Ta sama zasada, co `headerSubtitle()` i `sendErrorMessageKey()`
w czacie (`docs/WDROZENIE_CZAT_TESTY_REFAKTOR_2026-08-18.md` §2.1). Reguła zostaje
w module, tłumaczenie w słowniku, a test reguły nie zależy od copy.

---

## 5. Czego testy pilnują

Nie „czy się renderuje", tylko **czy gwarancja nadal obowiązuje**:

| Gwarancja                                                                                    | Gdzie                    |
| -------------------------------------------------------------------------------------------- | ------------------------ |
| siatka kalendarza zaczyna się w poniedziałek dla każdego z 12 miesięcy                       | `editorialCalendar`      |
| dzień liczony LOKALNIE — wpis o 23:30 należy do dnia redaktora, nie do doby UTC              | `editorialCalendar`      |
| górna granica zakresu wskazuje dobę PO ostatniej komórce (zapytanie używa `lt`)              | `editorialCalendar`      |
| przeciągnięcie zachowuje godzinę; szkic dostaje 09:00; ten sam dzień to BRAK zapisu          | `editorialCalendar`      |
| KAŻDE pole formularza albo idzie do zapisu, albo stoi na jawnej liście wyłączeń              | `postPatch`              |
| `published_at` i `sponsored_marked_at` NIE wyciekają do payloadu                             | `postPatch`              |
| baza optimistic-locka przy braku `updatedAt` ZOSTAJE (nie zeruje się, nie skacze na „teraz") | `postPatch`              |
| przy kolizji slugu wygrywa slug ZAPISANY — nawigacja na wpisany ładuje CUDZY wpis            | `postPatch`              |
| subskrybent kolejki wyjścia dostaje stan natychmiast; drugie żądanie odrzuca pierwsze        | `unsavedChanges`         |
| `shouldBlockFn` zwraca wartość ZANEGOWANĄ i czyta aktualne `when` przez ref                  | `useUnsavedChangesGuard` |
| jawny `tenant_id` przy INSERT kategorii i tagu; guard pustej nazwy PRZED zapisem             | `useInlineTaxonomy`      |
| migawka rewizji NIE wychodzi na wylot; przez projekcję przechodzą wyłącznie napisy           | `listProjection`         |
| katalog statusów odznaki = suma CHECK-ów z migracji, czytanych wprost z plików               | `runStatus`              |
| selektor statusu w UI mówi to samo, co trigger `enforce_post_workflow`                       | bramka parytetu          |

---

## 6. Bramki

### 6.1 Parytet UI ↔ trigger DB

Reguła workflow jest egzekwowana potrójnie (UI, server fn, trigger). Trzy kopie tej
samej decyzji to trzy okazje do rozjazdu, a nic w repo tego nie widziało: `tsc` nie
czyta SQL-a, a testy obu warstw sprawdzały każdą osobno.

`post-editor/__tests__/workflowTriggerParity.gate.test.ts` czyta **ostatnią**
definicję funkcji z katalogu migracji i porównuje ją z tablicą decyzyjną modułu
domenowego — symetrycznie, więc łapie rozjazd w obie strony.

### 6.2 i18n modułu 2 pod twardą bramką

`adminPostPanes` i `adminWorkflows` nie były w `GATED_PREFIXES`, więc rozjazd PL/EN
w całym module 2 był wyłącznie ostrzeżeniem (`console.warn`). Bramka modułowa
`post-editor/__tests__/i18nParity.test.ts` nie była też wpięta w `check:i18n-parity`.
Oba braki domknięte.

Zakres bramki, bez zaokrąglania: `parityFailed()` oblewa na **brakującym** kluczu po
którejkolwiek stronie. Identyczne brzmienie PL i EN nie jest błędem i nie oblewa —
moduł ma 25 takich par („Audio", „Layout", „Lead").

---

## 7. Czego ta praca NIE robi

- **Nie dokłada pgTAP-a** dla triggera `enforce_post_workflow` ani dla RLS
  `content_revisions`, mimo że obie reguły żyją w bazie i pgTAP-a nie mają. Powód jest
  praktyczny i podany wprost: pgTAP wymaga `supabase db start` (Docker), którego w tym
  środowisku nie ma, a wrzucenie **nieuruchomionego** pliku SQL do blokującego joba
  `pgtap` byłoby gorsze niż jego brak. Zamiast tego powstała weryfikowalna bramka
  statyczna (§6.1). Otwarta rekomendacja — plik pgTAP powinien asertować:
  1. autor nie wejdzie w `published`/`scheduled` (`42501`), a admin wejdzie,
  2. `scheduled` bez `publish_at` → `23514`,
  3. ponowny zapis BEZ zmiany statusu przechodzi także autorowi (to ta gałąź, która
     pozwala poprawić literówkę w opublikowanym wpisie),
  4. `publish_due_posts()` backdatuje `published_at` na moment planowany,
  5. izolacja tenanta na `content_revisions` i DELETE tylko dla publikującego
     (dlatego przycinanie historii do 50 jest best-effort).
- **Nie rozstrzyga asymetrii bramki SEO.** `hasBlockingSeoIssues` stoi wyłącznie na
  ścieżce „Zapisz"; „Publikuj", „Wyślij do recenzji", „Zatwierdź" i autozapis jej nie
  przechodzą — choć publikacja jest operacją bardziej doniosłą niż zapis roboczy.
  `seoSaveGate` utrwala stan **istniejący**, a komentarz i test przypinają asymetrię
  jawnie, żeby przestała być niewidoczna. Czy jest zamierzona, to rozstrzygnięcie
  produktowe.
- **Nie naprawia rozbieżności `publish_due_posts()`.** Migracja `20260702113027`
  ustawia `published_at = COALESCE(publish_at, now())` przy każdym przebiegu, podczas
  gdy `isFirstPublish` w TS-ie pilnuje, żeby znacznik pierwszej publikacji był
  niezmienny. To wymaga decyzji, która warstwa ma rację.

---

## 8. Pomiar końcowy

Ta sama komenda, co przy pomiarze bazowym (§2.2): `bun run test:coverage` z pominięciem
dwóch powierzchni wieszających ten sandboks (rozdz. 9.2 audytu). Suita: **8 900 testów
zielonych, 0 czerwonych**.

### 8.1 Moduł 2 jako całość

| Metryka    | Audyt 18.08 | Po tej pracy |          Δ |
| ---------- | ----------: | -----------: | ---------: |
| Linie      |       8,34% |   **35,87%** | +27,5 pkt. |
| Instrukcje |       7,75% |   **35,83%** | +28,1 pkt. |
| Gałęzie    |       6,82% |   **30,30%** | +23,5 pkt. |
| Funkcje    |       6,85% |   **32,13%** | +25,3 pkt. |

| Licznik             | Audyt 18.08 | Po tej pracy |
| ------------------- | ----------: | -----------: |
| Pliki produkcyjne   |          83 |           93 |
| Pliki **na 0%**     |          64 |           43 |
| Pliki testowe       |          11 |           33 |
| Przypadki testowe   |          65 |          539 |
| Asercje (`expect`)  |         120 |        1 053 |
| T/P (testowe/prod.) |       0,133 |        0,355 |

Mianownik urósł z 2 128 do 2 208 mierzonych linii — ekstrakcja reguł do `lib/` dołożyła
10 plików. To celowe: liczby liczone są wobec **większego** mianownika, więc wzrost nie
bierze się z przesunięcia kodu poza pomiar.

### 8.2 Rozbicie na funkcjonalności

| Funkcjonalność                           | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ---------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Listy, kalendarz, przekierowania, import |      6 |        483 |   0,0% |   0,0% |    0,0% |   **0,0%** |     0/153 |
| Rewizje i przywracanie                   |     12 |        247 |   8,0% |  11,4% |   13,0% |   **9,3%** |     12/92 |
| Workflow draft→review→published          |     10 |        276 |  15,4% |  10,2% |   12,2% |  **15,2%** |    15/123 |
| Edytor wpisu (panele)                    |     60 |      1 044 |  54,9% |  44,6% |   47,6% |  **54,8%** |   204/429 |
| Autozapis i niezapisane zmiany           |      4 |        157 |  96,4% |  88,5% |  100,0% |  **98,1%** |     36/36 |
| Obecność edytorska (presence)            |      1 |          1 | 100,0% | 100,0% |  100,0% | **100,0%** |       1/1 |

Wzorce ścieżek dla tych sześciu wierszy są wypisane w audycie (rozdz. 3, nota pod
tabelą modułu 2). Audyt z 18.08 podawał pięć wierszy obejmujących 75 z 83 plików —
tabela wyżej obejmuje **wszystkie 93**, więc wiersze nie są porównywalne jeden do
jednego z poprzednią wersją.

### 8.3 Progi per-ścieżka

Moduł wchodził w tę pracę bez **ani jednego** progu (rozdz. 6 audytu). Wychodzi z
osiemnastoma, w dwóch klasach:

**Czyste moduły — równo 100%, bez marginesu.** Nie ma tu gałęzi, której nie dałoby się
wywołać z testu, więc każdy spadek to realna reguła bez pokrycia:
`postPatch.ts`, `postsListQuery.ts`, `postsListDialogs.ts`, `postRouteParams.ts`,
`redirectsAdmin.ts`, `organizationDirectory.ts`, `versions/lib/**`, `workflows/lib/**`,
`lib/revisions/**`, `unsavedChanges.ts`, `useUnsavedChangesGuard.ts`, `useEditPresence.ts`.

**Powierzchnie z marginesem** (floor pod zmierzonym poziomem, na dryf CI):
`editorialCalendar.ts` 98/100/100/92, `post-editor/lib/**` 95/95/95/94,
`post-editor/hooks/**` 94/96/95/89, `post-editor/atoms/**` 88/85/87/89.

**Zapory antyregresyjne, nie deklaracje jakości.** Trzy katalogi komponentowe wyszły z
zera, ale są w połowie drogi: `post-editor/molecules/**` (23/26/23/22),
`workflows/**` (16/13/16/8), `versions/**` (7/8/7/9). Próg jest tam wyłącznie po to,
żeby nie wróciły na zero przy kolejnym refaktorze — i ma rosnąć.

Progi katalogowe (`**`) istnieją obok progów per-plik świadomie: per-plik nie łapie
przypadku „nowy plik reguł wszedł do `lib/` bez testu”, katalogowy łapie.

### 8.4 Czego NIE udało się osiągnąć

Cel podniesiony w trakcie pracy do **95%** linii **nie został osiągnięty** — jest
35,87%. Powód jest jeden i nie jest techniczny: równoległe pokrycie dwunastu grup
plików padło na limicie sesji po ukończeniu jednej grupy, a reszta powstawała
pojedynczo. Nic z tego, co zostało, nie jest zablokowane merytorycznie.

43 pliki wciąż stoją na zerze. Największe, w kolejności kosztu:

| Plik                                                                    | Linii mierz. | Funkcji |
| ----------------------------------------------------------------------- | -----------: | ------: |
| `src/routes/admin.posts.tsx`                                            |          162 |      50 |
| `src/routes/admin.import-wordpress.tsx`                                 |          108 |      36 |
| `src/routes/admin.redirects.tsx`                                        |          102 |      34 |
| `src/components/admin/workflows/WorkflowEditorDialog.tsx`               |           70 |      39 |
| `src/routes/admin.workflows.tsx`                                        |           69 |      35 |
| `src/routes/admin.posts.calendar.tsx`                                   |           67 |      22 |
| `src/lib/revisions.functions.ts`                                        |           61 |      11 |
| `src/components/admin/post-editor/molecules/OrganizationCreateForm.tsx` |           53 |      12 |
| `src/components/admin/workflows/CorrelationTracePanel.tsx`              |           53 |      13 |
| `src/components/admin/PostGeneralOverview.tsx`                          |           46 |      28 |

Trasy panelu (`admin.posts.tsx`, `admin.redirects.tsx`, `admin.posts.calendar.tsx`,
`admin.workflows.tsx`) mają już wyekstrahowane reguły — `postsListQuery`,
`redirectsAdmin`, `editorialCalendar`, `panelRules` — na 100%. To, co w nich zostało,
to kompozycja i podpięcie zapytań; pokrycie tych plików to głównie koszt fixture'ów
routera, nie nowa wiedza o regułach. Kolejnością o najlepszym stosunku wartości do
kosztu jest więc: `revisions.functions.ts` (server fn rewizji — reguły limitu 50,
throttle 5 min i pominięcia `status` przy przywracaniu wciąż nie mają pokrycia
runtime'owego), potem `WorkflowEditorDialog.tsx` i `CorrelationTracePanel.tsx`.
