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

Trzy defekty produkcyjne wyszły w trakcie tej pracy. Zgodnie z zasadą repo każdy
ma osobny commit z opisem, co dokładnie było złe.

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
