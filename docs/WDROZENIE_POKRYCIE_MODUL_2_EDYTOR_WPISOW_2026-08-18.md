# Wdrożenie: pokrycie testami MODUŁU 2 — edytor wpisów i workflow redakcyjny (2026-08-18)

## Diagnoza

Audyt z 18.08 (`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`) postawił
temu modułowi najostrzejszą diagnozę w całym repo:

| Miara                       |     Przed |
| --------------------------- | --------: |
| Linie                       | **8,34%** |
| Funkcje                     | **6,85%** |
| Plików produkcyjnych        |        83 |
| Plików bez ani jednej linii | **64/83** |
| Stosunek testy/produkcja    |      0,13 |

Trzy z pięciu funkcjonalności modułu stały na **okrągłym zerze**: „Rewizje
i przywracanie" (0/105 funkcji), „Workflow draft→review→published" (0/82)
i „Obecność edytorska" (0/3).

**Metodologiczne zastrzeżenie, bez którego te liczby są mylące.** Warstwa REGUŁ
tego modułu była już pokryta — `src/lib/content/workflow.ts` (100% linii, 8/8
funkcji), `src/lib/content/revisions.ts` (100%, 6/6), `revisionDiff.ts` (97,9%),
`useAutosave.ts` (96,7%). Te pliki leżą w `src/lib/content/`, więc reguły
mapowania z §9.1 audytu wrzucają je do MODUŁU 3. Dziura nie była więc w regułach,
tylko w **orkiestracji, hookach i panelach** — i dokładnie tam poszła ta praca.

**Druga korekta atrybucji.** Dwa pliki wskazane w zleceniu nie należą do MODUŁU 2
według reguł samego audytu: `src/lib/admin/workflows.ts` łapie wzorzec
`src/lib/admin/` (MODUŁ 19), a `src/lib/builder/revisions.ts` wzorzec
`src/lib/builder/` (MODUŁ 3). Zostały pokryte, bo są najtańszą redukcją realnego
ryzyka w zasięgu tej pracy — ale nie podnoszą liczby MODUŁU 2 i nie są w niej
liczone.

---

## 0. Warunek wstępny: pomiar musi być możliwy na czerwonej suicie

`checkThresholds` żyje WEWNĄTRZ `reportCoverage()`, z którego vitest wychodzi
natychmiast po pierwszym padniętym teście. Skutek był praktyczny: autor nowych
testów nie mógł zmierzyć własnej pracy, dopóki cała suita nie była zielona — a
bywała czerwona z powodu zupełnie innej powierzchni.

`reportOnFailure: true` w bloku `coverage`. Komentarz w configu zapisuje
jednocześnie ograniczenie tego raportu: liczby z czerwonego przebiegu są NIŻSZE
niż prawda (pliki padnięte w kolekcji nie wykonały ani jednej linii), więc służą
do porównywania własnej delty, nie do raportowania stanu repo.

---

## 1. `src/lib/admin/workflows.ts`: 63,6% → 100% na czterech metrykach

Audyt wskazał ten plik jako najtańsze pokrycie w zasięgu i wymienił jako
niedobite: `parseWorkflowSteps`, `serializeWorkflowSteps`, `conditionToPairs`,
`pairsToCondition`, `draftFromDefinition`, `emptyWorkflowDraft`,
`isValidEventType`.

**Pomiar pokazał co innego.** Te helpery były pokryte istniejącym
`workflows.test.ts`. Prawdziwa dziura to **warstwa danych** — dziewięć funkcji
asynchronicznych (zapytania, mutacje, ślad korelacji) plus `isUuid`
i `conditionValueToInput`. 21 pokrytych + 11 niepokrytych = 32 funkcje pliku,
więc arytmetyka się domyka.

| Metryka    | Przed |                 Po |
| ---------- | ----: | -----------------: |
| Instrukcje |     — | **100%** (172/172) |
| Linie      | 63,6% | **100%** (132/132) |
| Funkcje    | 21/32 |   **100%** (32/32) |
| Gałęzie    |   55% | **100%** (137/137) |

**Dwa pliki, bo dwie atrapy.** `workflows.test.ts` atrapuje klienta Supabase
pustym obiektem — czystym helperom klient nie jest potrzebny. Warstwa danych
potrzebuje pełnego łańcucha PostgREST, `rpc()` i `auth.getSession()`, więc
dostała własny plik na wspólnej atrapie `src/test/supabaseChain.ts` — tej samej,
której używają czat i profil. Żadna reguła nie jest dowodzona dwa razy.

Co te testy faktycznie dowodzą (nie „zapytanie się wykonało"):

- `saveWorkflowDefinition` **pinuje `tenant_id`** z rpc `current_tenant_id()`, bo
  kolumna nie ma defaultu; brak tenanta jest WYJĄTKIEM przed INSERT-em, nie
  wierszem z `tenant_id: null` odbitym przez policy;
- `setWorkflowEnabled` wysyła **dokładnie dwie kolumny** — szeroki UPDATE z ekranu
  listy nadpisałby warunek i kroki wartościami, których ta lista nie wczytuje
  (klasa defektu K10 z audytu treści, gdzie zmiana koloru kasowała opisy PL/EN);
- `fetchCorrelationTrace` **nie odpytuje outboxu** przy śladzie bez zdarzeń —
  `.in("event_id", [])` to zapytanie po całej tabeli dostaw;
- projekcja outboxu nie wypuszcza z bazy ciał żądań/odpowiedzi webhooków (mogą
  nieść dane osobowe, a panel ich nie pokazuje);
- każdy odczyt zamienia `data: null` na pustą listę — panel woła `.map()`.

---

## 2. Maszyna opuszczenia edytora: 0/10 funkcji → 100%

`src/lib/unsavedChanges.ts` (0/7) i `src/hooks/useUnsavedChangesGuard.ts` (0/3) to
**jedyna zapora między redaktorem a utratą napisanego tekstu**, gdy autosave nie
zdążył. Po zmianie: 100% instrukcji, linii, funkcji i gałęzi na obu plikach
(26/26, 24/24, 10/10, 4/4).

**Najważniejsza asercja całej tej pozycji:** `shouldBlockFn` zwraca `!leave`.
Odwrócenie tej negacji nie wysypuje niczego, nie psuje żadnego typu i przechodzi
przez typecheck oraz lint — po prostu redaktor, który wybrał „zostaję", zostaje
wyrzucony z edytora razem z niezapisanym tekstem.

Pozostałe reguły, które mają teraz dowód: subskrypcja woła callback NATYCHMIAST
stanem bieżącym (host montuje się raz w `__root.tsx`; bez tego dialog pojawiłby
się o jedno zdarzenie za późno), rozstrzygnięcie emituje `null` (inaczej dialog
zostaje na ekranie), stan wraca do `null` PRZED rozwiązaniem obietnicy
(kolejność, nie tylko fakt), wyścig dwóch blokerów rozstrzyga porzucone pytanie
na „zostaję", a `enableBeforeUnload` czyta AKTUALNĄ wartość `when` po rerenderze
w obie strony.

---

## 3. Orkiestracja rewizji: 0/13 funkcji → 100%

`src/lib/revisions.functions.ts` — 66 linii bez ani jednego wywołania. Po
zmianie 100% instrukcji, linii, funkcji i gałęzi (79/79, 66/66, 13/13, 54/54)
w 40 przypadkach.

**Czego ten plik NIE testuje — świadomie.** Reguły domenowe (limit 50, próg
5 minut, pola przywracalne) są dowiedzione w `src/lib/content/revisions.test.ts`.
Reguł egzekwowanych w bazie (RLS, rola staff, odebrany SELECT na kolumnach ciała)
też nie testujemy atrapą — to pgTAP w `supabase/tests`; atrapa dowiodłaby tylko,
że atrapa działa.

Siedem rzeczy, których złamanie jest ciche:

1. **Tenant fail-closed.** Brak profilu, `tenant_id: null` i błąd zapytania kończą
   się tym samym wyjątkiem, a zapytanie o rewizje NIE WYCHODZI.
2. **Bramka rate limit RZUCA**, a nie pomija cicho — ciche pominięcie byłoby
   GORSZE od błędu, bo redaktor zobaczyłby pustą historię i uznał, że wersje
   przepadły. Bramka stoi PRZED rozwiązaniem tenanta.
3. **Lista jest projekcją** — `snapshot` nie opuszcza serwera (asercja sprawdza
   brak `snapshot` i `builder_data` przy migawce z kilobajtowym dokumentem).
4. **Cichy filtr RLS jest błędem** — trzy przypadki: mniej wierszy niż zamówionych
   id, `data: null` bez błędu, oraz UPDATE bez błędu, który nie zapisał nic. Ten
   trzeci jest najgroźniejszy: bez sprawdzenia użytkownik widzi „przywrócono",
   a treść zostaje stara.
5. **Migawka `pre_restore` powstaje PRZED nadpisaniem** — test sprawdza KOLEJNOŚĆ
   operacji, nie sam fakt istnienia migawki.
6. **Patch przywracania nie zawiera `status`** — migawka w fixture niosła
   `status: "draft"`; gdyby trafił do patcha, przywrócenie starej wersji tekstu
   zdjęłoby opublikowany wpis ze strony.
7. **Audyt po UDANYM zapisie** — `recordAudit` nie jest wołany, gdy UPDATE zwrócił
   błąd ani gdy nie zaktualizował żadnego wiersza.

---

## 4. `usePostEditorForm`: 530 linii, 0/36 funkcji → 100% linii i funkcji

To była największa pojedyncza dziura modułu. Nie dlatego, że nikt nie próbował —
dlatego, że KAŻDA reguła siedziała w środku hooka, którego nie da się wywołać bez
routera, klienta react-query, `useServerFn`, i18n i klienta Supabase.

### 4a. Ekstrakcja czystych reguł do `../lib` (bez zmiany zachowania)

Nowe moduły w `src/components/admin/post-editor/lib/` (folder już istniał
z `layoutOverrides.ts`), hook 530 → 454 linii:

| Plik                 | Funkcja                 | Dlaczego wyjęta                                         |
| -------------------- | ----------------------- | ------------------------------------------------------- |
| `savePayload.ts`     | `buildPostUpdateFields` | mapa **51 kolumn** wysyłanych przy każdym zapisie       |
|                      | `replaceFormImageUrls`  | musi zwrócić TĘ SAMĄ referencję przy zero trafień       |
|                      | `applyPersistedImages`  | nakłada tylko zmienione dokumenty                       |
|                      | `nextOptimisticBase`    | baza optimistic-locka                                   |
| `slugNavigation.ts`  | `resolveCanonicalSlug`  | trzy `if`-y w środku 130-linijkowego `saveFn`           |
| `saveErrors.ts`      | `classifySaveError`     | zwraca DANE, nie tekst — toasty zostają w hooku         |
| `editorGates.ts`     | `seoSaveDecision`       | blokada vs licznik ostrzeżeń                            |
|                      | `missingRequiredKeys`   | zwraca KLUCZE i18n, nie sklejony tekst                  |
|                      | `isScheduledInPast`     | `now` jako argument (było `Date.now()` wprost)          |
| `historyShortcut.ts` | `historyShortcut`       | dało się wywołać tylko prawdziwym `keydown` na `window` |

Trzy z tych reguł niosą koszt, który jest niewidoczny do momentu awarii:

- **`buildPostUpdateFields`** — pole, które wypadnie z mapy zapisu, przestaje się
  zapisywać CICHO: formularz nadal pokazuje wartość, autosave nadal raportuje
  sukces, a kolumna w bazie zostaje stara. Test wypisuje wszystkie 51 nazw JAWNIE
  i osobno sprawdza, że `published_at`, `sponsored_marked_at` i `updated_at` do
  bazy NIE JADĄ (pierwsze dwa stempluje serwer, trzecie idzie jako `baseUpdatedAt`).
- **`replaceFormImageUrls`** — nowy obiekt formularza to dla `useAutosave` nowa
  wartość, więc niezmieniony formularz uruchamiałby kolejny zapis, ten znowu
  wołałby tę funkcję i edytor zapisywałby w kółko bez udziału redaktora.
- **`resolveCanonicalSlug`** — serwer może znormalizować slug (`uniqueSlug`
  dopisuje sufiks przy kolizji). Nawigacja na slug WPISANY w formularzu
  załadowałaby CUDZY wpis, który ten slug posiada; redaktor zobaczyłby obcą treść,
  a następny autosave zapisałby ją na tamtym wierszu.

Pomiar: `post-editor/lib/**` z 0% na **100% instrukcji, linii, funkcji i gałęzi**
(52/52, 38/38, 18/18, 71/71) w 74 przypadkach. Po drodze dobite dwa ramiona
przedistniejącego `layoutOverrides.ts` (87,5%): `layoutSetFor` (zero wywołań)
i fallback `?? "standard"` w `resolvePostFormat`.

### 4b. Obudowa hooka

| Plik                   | Instrukcje |    Linie |          Funkcje | Gałęzie |
| ---------------------- | ---------: | -------: | ---------------: | ------: |
| `usePostEditorForm.ts` |     98,85% | **100%** | **100%** (35/35) |  91,35% |
| `usePostEditorData.ts` |       100% |     100% |             100% |    100% |

Najważniejsza asercja: **nieudany zapis NIE MELDUJE SUKCESU.**
`useAutosave.flush()` celowo ODRZUCA, gdy zapis padł — komentarz w `useAutosave.ts`
opisuje, że kłamstwo w tym miejscu spowodowało kiedyś całkowitą utratę pracy
w page builderze. Trzy osobne testy pilnują, że po nieudanym zapisie leci
`toast.error`, NIE leci `toast.success`, a `busy` wraca do `false`.

Warstwa danych (`usePostEditorData`) niesie dwie rzeczy nie do naprawienia po
fakcie: **izolację najemców** (test przechodzi po WSZYSTKICH czterech słownikach
i żąda filtra `tenant_id` na każdym — bez niego słownik obcej firmy wchodzi do
listy wyboru, a zapis przypina wpis do cudzej taksonomii) oraz
**`refetchOnReconnect: false`** na wierszu edytowanego wpisu, bo refetch podmienia
`post`, hook formularza robi na tym `history.reset()`, a to kasuje niezapisane
zmiany i całą historię undo — wystarczy chwilowy brak sieci w trakcie pisania.

---

## 5. Rewizje i wersje: z zera

| Plik                                                | Linie po | Funkcje po |
| --------------------------------------------------- | -------: | ---------: |
| `components/admin/molecules/RevisionsCard.tsx`      | **100%** |   **100%** |
| `components/admin/molecules/RevisionDiffDialog.tsx` |   94,11% |     85,71% |
| `lib/builder/revisions.ts`                          | **100%** |   **100%** |
| `hooks/useEditPresence.ts`                          | **100%** |   **100%** |

**Wzorzec dwóch kliknięć** przy porównywaniu wersji ma pięć testów, bo to jedyne
miejsce, gdzie kolejność ma znaczenie SEMANTYCZNE. Lista jest posortowana od
najnowszej, więc klikając „z góry na dół" redaktor uzbraja NOWSZĄ wersję,
a porównuje ze STARSZĄ. Bez normalizacji kierunku diff pokazywałby zmiany
odwrócone — dodany akapit jako usunięty — i redaktor przywróciłby nie to, co
chciał. Testy dowodzą, że oba kierunki klikania dają identyczny wynik.

**„Zbyt mało migawek" to BŁĄD, nie „brak zmian".** Tak wygląda cichy filtr RLS:
serwer nic nie zgłasza, tylko zwraca mniej wierszy. „Brak zmian" byłby wtedy
kłamstwem — redaktor uznałby, że wersje są identyczne, i nie przywrócił niczego.

**Obecność edytorska** to cienka nakładka na `useEntityPresence`, więc jej test
jest testem KONTRAKTU DELEGACJI, nie testem realtime. Warto go mieć, bo obecność
jest funkcją PRYWATNOŚCI: topic kanału powstaje z `entityType:entityId`,
a przekręcenie tych argumentów wpuściłoby edytora wpisu na kanał STRONY o tym
samym id — czyli pokazałoby nazwiska osób pracujących nad innym dokumentem.

---

## 6. Defekty znalezione PRZY PISANIU testów

Pięć defektów produkcyjnych wyszło w trakcie tej pracy. Zgodnie z zasadą repo
każdy ma osobny commit z opisem, co dokładnie było złe — i w każdym przypadku
blok testowy, który w commicie pokrywającym był ŚWIADKIEM defektu, jest po
naprawie testem REGRESJI.

### D1 — przywracanie wersji popupu było MARTWE

`BuilderVersionsPane` woła `useRestoreBuilderRevision(...)` z zakresem
wynikającym z aktywnej zakładki. Ternarny wybór miał po obu stronach **tę samą
wartość** (`"page"`), więc zakładka „Popupy/szablony" przywracała rewizję jak
zwykłą stronę. Skutek: przywrócenie wersji globalnego widgetu albo nie robiło
nic, albo trafiało w niewłaściwy byt — a redaktor widział komunikat sukcesu.

Naprawa: gałąź `template` przekazuje `"global_widget"`. Test pilnuje obu
zakładek osobno, bo to jedyna asercja, która odróżnia te dwa wywołania.

### D3 — statusy dostarczeń automatyzacji były po ANGIELSKU na sztywno

Cztery etykiety w `components/admin/workflows/atoms.tsx` (`delivered`,
`pending`, `retry`, `dead`) były literałami angielskimi w kodzie, mimo że cały
panel jest dwujęzyczny. Polski redaktor patrzący na historię przebiegów widział
„Dead-lettered" bez żadnego kontekstu — a to jest dokładnie ten stan, w którym
musi zrozumieć, że zdarzenie NIE dojdzie i wymaga ręcznej interwencji.

Naprawa: cztery klucze w `lib/i18n-admin-workflows.ts`, w PL i EN (bramki
parytetu i18n są blokujące, więc jedno bez drugiego nie przechodzi CI).

### D4 — adres wpisu i taksonomii ZJADAŁ literę „ł"

`slugifyTaxonomy` normalizowało tekst przez `normalize("NFD")` + usunięcie
znaków diakrytycznych. To rozkłada `ą ć ę ń ó ś ź ż`, ale **nie** `ł` (U+0142 to
osobny znak, nie „l" + diakryt), więc litera wypadała razem z resztą
niealfanumerycznych: `Łódź → odz`, `Miłość i Przyjaźń → mio-i-przyjazn`.

Najgorsze w tym defekcie było to, że repo miało już test, który tę usterkę
**dokumentował jako decyzję**: asercja `slugifyTaxonomy("Łódź") === "odz"`
z komentarzem „matching prior behavior". Charakteryzacja utrwaliła błąd.

Naprawa: wspólny moduł `src/lib/text/strokeLetters.ts` (litery z przekreśleniem
i ligatury: `ł ø đ ð æ œ ß þ ħ ŀ ı`) użyty PRZED normalizacją NFD. Ten sam
słownik miał już prywatną kopię w panelu profilu — teraz jest jeden, więc adres
proponowany w profilu i adres taksonomii nie mogą się rozjechać. Test
charakteryzacyjny zamienił się w test poprawności, z komentarzem, dlaczego stara
asercja była błędna.

### D5 — obce `?lang=` w adresie edytora PRZECHODZIŁO jako język UI

Trasa `/admin/posts/$slug` deklaruje `validateSearch` zwracające `{}` dla
wartości innej niż `pl`/`en`. To wygląda na odsiew, ale nim nie jest: router
składa `match.search` jako `{ ...surowe, ...zwalidowane }`, a `Route.useSearch()`
czyta właśnie `match.search`. Zwrócenie `{}` niczego nie usuwa — klucz zostaje
z surową wartością, a deklarowany typ `{ lang?: "pl" | "en" }` jest obietnicą
wyłącznie kompilacyjną.

Skutek: `?lang=cokolwiek` przyklejało edytor do polszczyzny (panele porównują
`uiLang === "en"`), więc redaktor pracujący w panelu EN dostawał polskie nazwy
kategorii i polski wariant karty patrona — zamiast powrotu do języka panelu.

Naprawa: `uiLang` zawęża wartość w runtime, a nie tylko sprawdza jej obecność.
Komentarz przy `validateSearch` mówi wprost, że zawęża TYP, nie odsiewa wartości.

### D2 — otwarcie i zapis przepisu cicho zmieniało typ warunku

Runda `conditionToPairs → (edytor) → pairsToCondition` była **stratna**:

| W bazie     | Po otwarciu i zapisie |
| ----------- | --------------------- |
| `"true"`    | `true` (boolean)      |
| `"42"`      | `42` (number)         |
| `"null"`    | `null`                |
| `'{"a":1}'` | `{a: 1}` (obiekt)     |
| `"007"`     | `7`                   |

Redaktor otwierał przepis i zapisywał go **bez tknięcia warunku** — na przykład
tylko zmieniając nazwę. Typ wartości w kolumnie `condition` zmieniał się przy tym
zapisie. Silnik dopasowuje zdarzenia przez containment na jsonb
(`payload @> condition`), a containment ROZRÓŻNIA TYPY, więc `{"status": true}`
nie pasuje do payloadu `{"status": "true"}`. Przepis przestawał się odpalać — bez
błędu, bez ostrzeżenia, bez śladu w historii przebiegów.

Przyczyna źródłowa: `conditionValueToInput` zwracało string dosłownie, więc
tekstowa reprezentacja stringa `"true"` i boolean `true` była identyczna —
`parseConditionValue` nie miał z czego odtworzyć intencji.

Naprawa (dwie linie): string, który po ponownym sparsowaniu przestałby być
stringiem, wraca do inputu W CUDZYSŁOWACH. Porównanie idzie przez
`parseConditionValue`, nie przez skopiowaną listę wzorców, więc obie funkcje nie
mogą się rozjechać. Cudzysłów nie jest nową składnią: jawny literał JSON był
w tym polu akceptowany od początku — teraz jest też WYPISYWANY, gdy inaczej
zmieniłby typ. Zwykłe wartości (`won`, `pending_review`, puste) wyglądają jak
dotąd; osobny test tego pilnuje.

Blok testowy, który w commicie pokrywającym był ŚWIADKIEM DEFEKTU, jest teraz
testem REGRESJI: 23 wartości przechodzą rundę bez straty.

---

## 7. Panele automatyzacji i wersji: reguła, nie render

Zlecenie stawiało tu warunek metodyczny: **wyciągnąć regułę, którą panel
prezentuje, i asertować DANE albo KLUCZ i18n — nie renderować całości bez
asercji.** Repo raz już usunęło warstwę testów renderujących bez asercji
(historia zapisana przy globalnym progu w `vitest.config.ts`), więc powtórka
byłaby regresją metody, nie postępem.

| Katalog                       |  Linie | Funkcje | Instrukcje | Gałęzie |
| ----------------------------- | -----: | ------: | ---------: | ------: |
| `components/admin/workflows/` | 98,93% |  97,56% |     98,01% |  94,27% |
| `components/admin/versions/`  | 96,35% |  95,45% |     96,79% |  92,09% |

Reguły, które dostały dowód (a nie „komponent się wyrenderował"):

- **KPI liczone z okna przebiegów.** Liczba awarii jest jedynym miejscem, gdzie
  redaktor widzi, że automatyzacje się psują — zły licznik UKRYWA awarię.
  Czysty `aggregateRunStats` został w testach PRAWDZIWY; atrapowana jest tylko
  warstwa zapytań.
- **Nieudane przełączenie przepisu musi się COFNĄĆ NA EKRANIE.** Przełącznik
  jest optymistyczny wobec oka użytkownika: bez unieważnienia po błędzie
  pokazuje stan, którego baza nie przyjęła.
- **Każda mutacja unieważnia OBA zapytania** (definicje + okno przebiegów) —
  inaczej lista pokazuje stan sprzed zmiany, a KPI liczy ze starego okna.
- **Ślad korelacji reaguje na deep-link, ale nie kasuje ręcznego wpisu**
  (wzorzec „adjust state during render": reakcja na ZMIANĘ propa, nie na każdy
  render).
- **Przywracanie wersji celuje we właściwy byt** — patrz D1.

## 8. Atomy, molekuły i organizmy edytora

| Katalog                  |    Linie |  Funkcje | Instrukcje |  Gałęzie |
| ------------------------ | -------: | -------: | ---------: | -------: |
| `post-editor/lib/`       | **100%** | **100%** |   **100%** | **100%** |
| `post-editor/atoms/`     | **100%** | **100%** |   **100%** | **100%** |
| `post-editor/hooks/`     | **100%** | **100%** |     99,23% |   92,25% |
| `post-editor/molecules/` | **100%** | **100%** |     99,13% |   96,83% |
| `post-editor/organisms/` | **100%** |   98,41% |     99,26% |   88,21% |

Trzy rzeczy warte wyróżnienia, bo są regułami, a nie „widokiem":

1. **Wielopolowe zmiany idą JEDNĄ pozycją historii.** Karty organizacji
   i sponsoringu zmieniają po kilka pól naraz. Osobne `set()` na każde pole
   dałoby tyle samo wpisów undo i tyle samo szans, żeby autozapis utrwalił stan
   pośredni — czyli wpis oznaczony jako komercyjny bez reszty deklaracji.
2. **Jedna zakładka szczegółów na raz.** Sekcje montują ciężkie panele (SEO
   z analizą treści, dostęp, historia wersji); zamontowanie kilku naraz to
   kilka kompletów zapytań przy każdym wejściu w edytor.
3. **Przypisy z podglądu piszą do SWOJEGO języka.** `AutoFootnotesPreview`
   oddaje poprawiony dokument jednego języka; zapis bez scalenia
   (`{ ...cur, [lang]: nextDoc }`) wymazałby dokument DRUGIEGO języka —
   redaktor tracił by całą wersję EN przy pierwszym przypisie dodanym po
   polsku. Test montuje kadr layoutu, bo sam `canvasWrap()` zwraca element,
   którego nikt nie renderuje.

## 9. Osiem tras panelu redakcyjnego: wszystkie z zera

Zlecenie początkowo wykluczało trasy („nie goń pokrycia na trasach admina");
druga instrukcja zdjęła to ograniczenie z warunkiem „z dużą ostrożnością
i uwagą do detalu". Trasy okazały się miejscem, w którym mieszka **sklejenie** —
warstwa niewidoczna dla testów komponentów.

| Trasa                        | Linii kodu |    Linie |  Funkcje |  Gałęzie |
| ---------------------------- | ---------: | -------: | -------: | -------: |
| `admin.posts.tsx`            |        768 | **100%** | **100%** |   97,64% |
| `admin.redirects.tsx`        |        668 | **100%** | **100%** |   95,20% |
| `admin.import-wordpress.tsx` |        624 | **100%** | **100%** |   96,80% |
| `admin.posts.calendar.tsx`   |        401 | **100%** | **100%** |   97,97% |
| `admin.workflows.tsx`        |        249 |   97,10% |   94,28% |   89,74% |
| `admin.posts.$slug.tsx`      |        131 | **100%** | **100%** | **100%** |
| `admin.posts.new.tsx`        |         49 | **100%** | **100%** | **100%** |
| `admin.versions.tsx`         |         30 | **100%** | **100%** | **100%** |

Reguły, których żaden test komponentu nie widzi:

- **POJEDYNCZY POST przy tworzeniu szkicu.** `/admin/posts/new` tworzy wiersz
  efektem ubocznym wejścia na adres, a StrictMode uruchamia efekt dwukrotnie.
  Bez synchronicznej blokady jedno wejście zostawiałoby w bazie DWA puste wpisy.
- **Wpis OPUBLIKOWANY jest w kalendarzu NIERUCHOMY.** Przeciągnięcie
  re-datowałoby archiwum, sitemapy i feedy. Bramka siedzi w propie `draggable`,
  więc widzi ją wyłącznie test UI — serwer o niej nic nie wie.
- **Termin nie gubi godziny.** 14:30 z 20 sierpnia zostaje 14:30 z 25; szkic
  z backlogu dostaje 09:00.
- **Cel przekierowania poza własnymi domenami nie przechodzi** — to open
  redirect, czyli phishing z autorytetem naszej domeny. Gdy zapytanie o domeny
  tenanta nic nie zwróci, odrzucany jest KAŻDY adres absolutny (fail-closed).
- **Fraza szukania jest odkażana**: `escapeLike` usuwa metaznaki, więc przecinek
  z frazy nie dołoży własnego warunku do `.or()`.
- **Wynik masowy jest uczciwy**: 0 zmienionych to BŁĄD, część to OSTRZEŻENIE —
  „zrobiono 2" po odrzuceniu obu wierszy przez RLS to najgorszy możliwy
  komunikat.
- **Import z WordPressa** ogranicza zakres w UI (1..100, offset ≥ 0), a postęp
  unieważnia listy admina tylko GDY SIĘ ZMIENIŁ (odpytywanie chodzi co sekundę).
- **Pustka ma dwa znaczenia** — „nic tu nie ma" i „filtry wykluczyły wszystko";
  licznik widoku je rozdziela, osobno dla listy i dla kosza.

Atrapy w testach tras są celowo minimalne i opisane w komentarzu każdego pliku:
`@dnd-kit/core` (rozpoznawanie przeciągnięcia to biblioteka, nie nasza reguła —
ale atrapa oddaje identyfikatory komórek dnia i bramkę `disabled`, czyli
dokładnie reguły trasy), `Tabs`/`Select` (Radix nie przełącza się pod happy-dom),
`ConfirmDialog` (sprowadzony do przycisku, który — jak oryginał — najpierw
wykonuje akcję, potem zamyka okno) oraz molekuły list, atrapowane do SOND, żeby
test mógł wywołać ich callbacki.

## 10. Serwerowa migracja treści do bloków: 0/4 funkcji → 100%

`src/lib/posts-migrate.functions.ts` był jedynym plikiem modułu, który MASOWO
NADPISUJE treść wpisów, i miał zero wykonanych funkcji. Pięć rzeczy z dowodem:

1. **Granica tenanta na `service_role`.** Kolumny ciała są odebrane roli
   `authenticated`, więc odczyt idzie `supabaseAdmin` — a ten OMIJA RLS. Jawny
   `.eq("tenant_id", ...)` jest tam całą granicą najemcy; brak tenanta w profilu
   rzuca PRZED pierwszym zapytaniem o wpis.
2. **Zapis idzie klientem WOŁAJĄCEGO** (adminem nadpisywałby treść z pominięciem
   polityk).
3. **Idempotencja**: wpis już na `blocks` jest pomijany BEZ zapisu.
4. **Cichy filtr RLS to błąd**, nie „zmigrowano 0".
5. **Partia nie przewraca się na jednym wierszu** — uszkodzony wpis wraca
   w raporcie jako `source: "error"`, także gdy rzut nie jest instancją `Error`.

## 11. Progi per-ścieżka: zamiana jednorazowego wysiłku w zaporę

Bez progów następna generacja może zejść z powrotem do zera i żadna bramka tego
nie zauważy — dokładnie to stało się temu modułowi między audytami. Progi
w `vitest.config.ts` są floorowane tuż pod ZMIERZONYM poziomem i wolno je
wyłącznie podnosić (identyczna zasada, co przy sieci kontaktów, czacie
i profilu).

Objęte bramką: siedem katalogów edytora (`post-editor/lib`, `atoms`, `hooks`,
`molecules`, `organisms`) oraz `admin/versions`, `admin/workflows`; osiem
pojedynczych plików warstwy danych i hooków (`lib/admin/workflows.ts`,
`lib/unsavedChanges.ts`, `hooks/useUnsavedChangesGuard.ts`,
`lib/revisions.functions.ts`, `lib/posts-migrate.functions.ts`,
`hooks/useEditPresence.ts`, `hooks/useAutosave.ts`, `hooks/useHistory.ts`);
dwa komponenty korzenia (`PostEditor.tsx`, `PostGeneralOverview.tsx`)
i wszystkie osiem tras. Czyste moduły trzymane pod 100% na wszystkich czterech
metrykach — tak jak pozostałe czyste moduły w tym pliku.

Trasy dostały wpisy POJEDYNCZE, nie glob na `src/routes/**`: reszta katalogu
tras jeszcze na bramkę nie zarobiła, a te osiem już tak.

## Wynik

Pomiar na tej gałęzi, `--coverage.all=true` na 89 plikach (83 pliki MODUŁU 2 wg
reguł §9.1 audytu, plus `lib/admin/workflows.ts` z pierwszego kroku zlecenia
i pięć plików, które wzorce audytu łapią, a jego tabela funkcjonalności pomija),
80 plików testowych, **1568 testów, wszystkie zielone**:

| Miara                       |     Przed |         Po |    Delta |
| --------------------------- | --------: | ---------: | -------: |
| Linie                       |     8,34% | **99,41%** | +91,1 pp |
| Instrukcje                  |     7,7 % | **98,81%** | +91,1 pp |
| Funkcje                     |     6,85% | **99,00%** | +92,2 pp |
| Gałęzie                     |     6,8 % | **94,38%** | +87,6 pp |
| Plików bez ani jednej linii | **64/83** |   **0/89** |      −64 |

Warunki „definicji ukończenia" ze zlecenia: linie ≥ 90% i funkcje ≥ 90% dla
modułu (osiągnięte: 99,41% / 99,00%), `lib/admin/workflows.ts` ≥ 95% linii
i ≥ 90% gałęzi (osiągnięte: 100% / 100%), `unsavedChanges.ts`
i `revisions.functions.ts` zdjęte z zera i objęte progami (100% na czterech
metrykach), żadna funkcjonalność modułu nie stoi na 0%.

Niepokryte resztki są policzone i opisane w komentarzach przy progach. To
w większości ramiona obronne nieosiągalne z UI (`if (!editor) return` w dialogu,
którego nie ma w DOM bez edytora; `redirects ?? []` w eksporcie, gdy przycisk
jest wyłączony; `catch` w `formatDate`, bo `Invalid Date.toLocaleDateString()`
nie rzuca) — zostawione świadomie, bo test, który je wywołuje, musiałby najpierw
złamać niezmiennik komponentu.

---

## Metoda — żeby to dało się powtórzyć

Każda liczba w tym dokumencie pochodzi z komendy uruchomionej na tej gałęzi, nie
z przepisania audytu. Pomiar pojedynczej powierzchni:

```
npx vitest run <pliki testowe> \
  --coverage --coverage.all=false --coverage.reporter=text \
  --coverage.include='<glob docelowy>' \
  --coverage.thresholds.lines=0 --coverage.thresholds.statements=0 \
  --coverage.thresholds.functions=0 --coverage.thresholds.branches=0
```

Pomiar całego MODUŁU 2 (83 pliki wg reguł §9.1 audytu) — lista plików powstaje
z tych samych wzorców ścieżek, żeby licznik i mianownik zgadzały się z audytem:

```
find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
  | grep -v '__tests__' | grep -v '\.test\.' \
  | grep -E 'src/components/admin/post-editor/|src/components/admin/versions/|src/components/admin/workflows/|src/lib/revisions|src/lib/posts-migrate|src/hooks/useAutosave|src/hooks/useEditPresence|src/hooks/useHistory|src/hooks/useUnsavedChangesGuard|src/lib/unsavedChanges|src/routes/admin\.(posts|scheduler|calendar)|src/routes/admin\.(versions|workflows|redirects|import-wordpress|contributors)|src/components/admin/(PostEditor|PostGeneralOverview)'
```

### Uwaga o środowisku

W tym sandboksie `bun install` nie dociąga 31 pakietów z prywatnego rejestru
Lovable (403 od bramki egress) — te publiczne trzeba doinstalować z
`registry.npmjs.org` (`npm install --no-save --legacy-peer-deps`). Dwa pakiety
używane przez testy, `jsdom` i `@testing-library/dom`, **nie są zadeklarowane
w `package.json`** — pierwszego wymagają dwa testy widgetów przez docblock
`@vitest-environment jsdom`, drugi jest peer-dependency
`@testing-library/react@16`. W CI z pełnym rejestrem dociągają się tranzytywnie;
tutaj ich brak zabijał workera vitesta i przewracał ~262 pliki testowe naraz,
co wyglądało jak masowa regresja, a było jedną brakującą zależnością.
