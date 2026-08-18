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
