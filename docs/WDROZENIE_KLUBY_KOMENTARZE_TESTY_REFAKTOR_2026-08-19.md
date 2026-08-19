# Kluby i komentarze: warstwa danych z zera, rozbicie useClubs i reguły wyjęte z organizmów (2026-08-19)

Praca nad pozycją **MODUŁ 16 - Społeczność: kluby, komentarze, moderacja** z audytu
`AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`: 242 pliki produkcyjne (największy
moduł w repo), 177 bez ani jednej wykonanej linii, 6 442 niepokryte linie - druga pozycja
w rankingu bezwzględnym.

Zabieg jest powtórzeniem tego, co zadziałało przy czacie
(`WDROZENIE_CZAT_TESTY_REFAKTOR_2026-08-18.md`), ale **diagnoza okazała się inna** - i to
jest pierwsza rzecz, którą trzeba zapisać, bo zmienia kolejność prac dla następnej osoby.

---

## 1. Diagnoza: dlaczego kluby NIE są czatem

Zlecenie zakładało, że moduł stoi z tych samych trzech powodów, co czat: łańcuch PostgREST
w warstwie danych, reguły w `useMemo` organizmu, powtórzony JSX. Pomiar przed pracą:

| Plik                              | `supabase.rpc(` | `supabase.from(` |
| --------------------------------- | --------------: | ---------------: |
| `lib/clubs/api.ts`                |              69 |            **0** |
| `lib/clubs/threadWorkspaceApi.ts` |              20 |                0 |
| `lib/clubs/networkApi.ts`         |              16 |                0 |
| `lib/clubs/workspaceApi.ts`       |              13 |                0 |
| `lib/clubs/specializationsApi.ts` |               6 |                0 |
| `lib/clubs/topicsApi.ts`          |               5 |                0 |

Wszystkie trafienia `from` to KOMENTARZE wyjaśniające, dlaczego go nie ma. Moduł jest
**RPC-only i to jest decyzja architektoniczna**: tabele klubów nie mają grantów dla
klienta, więc `supabase.from("clubs")` oddałby pusty zbiór nawet adminowi, a cała
autoryzacja żyje w SECURITY DEFINER.

Skutki dla planu:

- **przeszkoda nr 1 z czatu w klubach nie istnieje.** `supabaseFromStub()` nie jest atrapą,
  której kluby potrzebują;
- **`useClubs.ts` nie ma ANI JEDNEGO `useMemo`.** To nie był organizm z regułami w środku,
  tylko barrel 70 cienkich opakowań react-query; 155 funkcji brało się z domknięć
  `queryFn`/`onSuccess`;
- **komentarze są odwrotnie**: `lib/comments/api.ts` to czysty łańcuch `from("comments")…`,
  więc tam atrapa łańcucha wchodzi 1:1.

Czego kluby naprawdę potrzebowały: **rejestratora RPC** - nazwa funkcji, nazwy argumentów,
kolejność wywołań, planowana odpowiedź per nazwa. W chwili rozpoczęcia prac **29 plików
testowych repo miało własną, ręcznie pisaną kopię takiej atrapy**, w tym dwa w samych
klubach (`postsApi.test.ts`, `applyApi.test.ts`). To był najczęściej duplikowany atom
testowy w repo.

---

## 2. Harness: `src/test/supabase/`

Krok bez pokrycia i jedyny, bez którego reszta jest droga.

| Moduł               | Co obsługuje                                                           |
| ------------------- | ---------------------------------------------------------------------- |
| `chain.ts`          | `supabase.from(...)` - pełny thenable łańcuch PostgREST (przeniesiony) |
| `rpc.ts` **(nowy)** | `supabase.rpc(...)` + atrapa `auth`; argumenty czytane PO NAZWIE       |
| `realtime.ts`       | kanały z obserwowalnym refcountem (wyjęte z `test/chat/fixtures`)      |
| `storage.ts`        | podpisy pojedyncze i wsadowe (wyjęte)                                  |
| `i18n.ts`           | stub `react-i18next` echujący klucz (wyjęty)                           |

Podział idzie **po sposobie rozmowy z bazą, nie po module produktowym**. Zasada z czatu
zostaje bez zmian: brak zaplanowanej odpowiedzi to BŁĄD TESTU, nie ciche `[]`.

`test/chat/fixtures.ts` re-eksportuje całość, więc **17 plików testowych czatu
i `test/profile/fixtures.ts` nie zmieniły ani jednego importu** - zweryfikowane: 58 plików,
1 169 testów zielonych po przeprowadzce.

Do listy ogniw łańcucha doszły `ilike`, `like` i `textSearch`. Lista jest jawna
z premedytacją (literówka w nazwie ogniwa MA być błędem testu), ale ogniwo, którego
produkcja naprawdę używa, musi w niej być - `fetchAdminComments` trafiał na
`builder.ilike is not a function`.

---

## 3. Co dokładnie jest testowane w warstwie RPC-only

Autoryzacji tu nie ma czego sprawdzać: nie istnieje klientowy filtr po tenancie, a izolację
dowodzi 19 plików pgTAP. Zostają trzy kontrakty klienta:

1. **NAZWY ARGUMENTÓW.** Skoro serwer zakresuje po tym, co dostanie, to zgubiony
   `p_club_id` nie wywala niczego - cicho traci zawężenie. Taki błąd przechodzi przez `tsc`
   (obiekt argumentów jest luźny), przez przegląd (literówka wśród dwudziestu podobnych
   wierszy) i przez interfejs (lista i tak coś pokazuje).

2. **ROZRÓŻNIENIE `null` OD `undefined`.** Pominięcie klucza daje serwerowy DEFAULT, jawny
   `null` znaczy „bez zawężenia". Kod nosi ślady dwóch defektów tej klasy i oba mają test
   oznaczony `REGRESJA`: `p_status` członków (droplista „Wszystkie" cicho pokazywała samych
   aktywnych) i `p_anchored` wątków (filtr „tylko bez kotwicy" znaczył „wszystkie").

3. **TRANSFORMACJA ZWROTKI.** `total_count` z window function, kursor następnej strony,
   `RETURNS TABLE` jako tablica jednowierszowa, wartości domyślne przy pustej odpowiedzi.

Do tego dwa testy kontraktu CAŁEGO modułu: każda funkcja rzuca przy odmowie bazy (żadna nie
połyka błędu udając pustą listę), a lista przypadków jest porównywana z rzeczywistym
zbiorem eksportów - nowa funkcja bez testu zapala się na czerwono.

---

## 4. Rozbicie `useClubs.ts`

Stan wyjściowy: 1 258 linii, 70 hooków, 155 funkcji, 0,4% pokrycia.

### 4.1 Reguła, która naprawdę dała się wyjąć

`clubInvalidations.ts` - **osiemnaście nazwanych skutków** zwracających listę kluczy,
zamiast ~40 bloków `onSuccess` wypisujących ją inline.

To nie jest szczegół cache'u. Zła lista nie wywala niczego: zapis idzie do bazy, mutacja
kończy się sukcesem, toast mówi „zapisano". Zepsuty jest tylko WIDOK - i to nie od razu,
tylko do wygasnięcia `staleTime`. Taki defekt wygląda jak „czasem trzeba odświeżyć stronę",
więc nie trafia do zgłoszeń i żyje kwartałami. Moduł nosił ślad dokładnie takiego błędu:
karta klubu (`bySlug`) wisi POZA poddrzewem `club(clubId)`, bo mutacja pracuje na id,
a widok czyta po slugu.

Testy sprawdzają **relacje prefiksów**, nie samą obecność kluczy - bo to prefiks decyduje
o tym, co react-query naprawdę unieważni.

### 4.2 Podział na sześć modułów domenowych

`useClubCatalog`, `useClubAdmin`, `useClubInvites`, `useClubThreadsData`, `useClubReactions`,
`useClubModeration`. `useClubs.ts` zostaje jako **moduł zgodności** (1 258 -> 129 linii),
więc żaden z 29 konsumentów nie zmienia importu - ten sam wzorzec, co przy rozdzieleniu
workspace klubu i wątku (PR #206/#207).

`clubHooksModuleBoundary.test.ts` pilnuje, że re-eksport wskazuje TĘ SAMĄ funkcję (kopia
przeszłaby typecheck i wszystkie testy), że bariera nie zawiera implementacji, że nie ma
cyklu i że żaden moduł domenowy nie omija `clubInvalidations`.

---

## 5. Reguły wyjęte z organizmów

| Nowy moduł                       | Co wyniósł                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `lib/clubs/clubInvalidations.ts` | 18 skutków mutacji jako listy kluczy + `CLUB_STALE_MS`                           |
| `lib/clubs/gateView.ts`          | deskryptor bramki dostępu: co pokazać anonimowi / za niskim planowi / ekspertowi |
| `lib/clubs/moderationRules.ts`   | rozbicie wsadu na typy celu, próg powodu ujawnienia, które akcje pytają          |

Wszystkie trzy zwracają **DANE albo KLUCZE i18n**, nie gotowe zdania - odmiana liczebników
i copy zostają w słowniku PL/EN, a test reguły nie zależy od treści. Zero nowych kluczy
i18n: deskryptory wskazują klucze, które już istnieją.

---

## 6. Defekty i rozjazdy wykryte przez nowe testy

Refaktor sam z siebie nie znajduje błędów. Znalazły je testy pisane do wyekstrahowanych
modułów - i to jest jedyny dowód, że ekstrakcja miała sens.

### 6.1 Trzy wywołania `invalidateQueries` bez żadnego skutku

Inwariant „żaden skutek nie zawiera klucza będącego prefiksem innego w tym samym zestawie"
wskazał trzy miejsca, w których oryginalny kod wołał unieważnienie dwa razy o to samo:
`club(clubId)` obok `all` (pięć wołających) oraz `thread(clubId, slug)` obok `club(clubId)`
w dwóch skutkach wątku. Klucz szerszy pochłania węższy, więc pierwsze wywołanie nie miało
żadnego skutku poza własnym kosztem. Zakres unieważnienia po zmianie jest **identyczny co
do zapytania**; usunięte zostały wyłącznie wywołania bez efektu.

### 6.2 Notka eksperta wyjaśniałaby nieistniejący przycisk

Pierwsza wersja deskryptora bramki liczyła `showExpertNote` bez `canRequest`, więc notka
„masz odznakę eksperta" pojawiłaby się także w klubie „tylko z zaproszenia", gdzie żadnej
prośby o dostęp nie ma. Oryginał renderował ją WEWNĄTRZ gałęzi `canRequest`. Inwariant
„notka eksperta wyłącznie razem z prośbą" wychwycił rozjazd przed wyjściem z gałęzi.

### 6.3 Istniejąca bramka i18n złapała błąd w ekstrakcji

`adminClubsI18nLoading.gate` zaświeciła się na `moderationRules.ts`: pierwsza wersja
budowała tam klucz `adminClubs.moderation.target.*`, czyli klucz ze słownika PANELU -
w module osiągalnym z tras publicznych, bez `ensureAdminClubsI18n()`. Ten defekt kończy się
gołym kluczem na ekranie i jest widoczny dopiero w przeglądarce. Moduł reguł odpowiada
teraz wyłącznie na pytanie „czy znam ten typ", a prefiks został na powierzchni panelu.

### 6.4 `splitInline` urywa adres na domykającym nawiasie

Klasa znaków adresu w parserze treści klubowej wyklucza `)`, więc gałąź `trimUrl` „zdejmij
`)` tylko wtedy, gdy nie ma otwarcia" **nie ma jak się wykonać**. Skutek jest widoczny dla
czytelnika: link do hasła Wikipedii z dopiskiem ujednoznaczniającym
(`.../Test_(ujednoznacznienie)`) prowadzi pod urwany adres. Test przypina stan faktyczny,
żeby naprawa była świadomą zmianą, a nie przypadkiem. **Nie naprawione w tym PR** - to
zmiana zachowania parsera, należy jej się osobne wdrożenie i decyzja, czy domykać nawias.

### 6.5 Martwa obrona w warstwie danych

`createClubThread` ma `p_title: params.title ?? undefined` i to samo na `p_body`, choć oba
pola są w sygnaturze WYMAGANE - gałąź `??` jest nieosiągalna. Podobnie `?? null` na
`cursor_value` w `fetchClubThreads`: wygenerowany typ deklaruje tę kolumnę jako non-null
i nie ma jej w `NullableCols`, więc stanu „pełna strona bez kursora" nie da się zbudować
zgodnie z typem. Zostawione bez zmian (obrona nic nie kosztuje), ale zapisane, żeby nie
było brane za regułę.

### 6.6 Trzy miejsca, w których rację miał KOD, a nie pierwsze oczekiwanie testu

- `club_edit_thread` wysyła **pusty string** zamiast pomijać pole, bo SQL składa UPDATE jako
  `COALESCE(NULLIF(btrim(p_body), ''), body)` - to pusty string jest sygnałem „nie ruszaj";
- `club_resolve_thread` przekazuje **NULL wprost**, bo NULL znaczy cofnięcie oznaczenia;
- tag jednoznakowy (`#a`) **nie jest tagiem** - wzorzec wymaga minimum dwóch znaków.

---

## 7. Pomiar

### 7.1 Warstwa danych i hooki (`src/lib/clubs`)

| Plik                           |     Przed |                             Po |
| ------------------------------ | --------: | -----------------------------: |
| `api.ts` (1 265 linii)         |        0% |   **100%** linii, 100% funkcji |
| `workspaceApi.ts`              |        0% |                           100% |
| `threadWorkspaceApi.ts`        |        0% |                           100% |
| `networkApi.ts`                |        0% |                           100% |
| `topicsApi.ts`                 |        0% |                           100% |
| `specializationsApi.ts`        |        0% |                           100% |
| `publicClub.ts`                |        0% |                           100% |
| `policyAreas.ts`               |        0% |                           100% |
| `inlineSegments.ts`            |        0% |                           100% |
| `threadIcons.ts`               |        0% |                           100% |
| `clubHead.ts` / `applyHead.ts` |        0% |                           100% |
| `useClubNetwork.ts`            |        0% |                          88,9% |
| `useClubWorkspace.ts`          |        0% |                          78,0% |
| `useThreadWorkspace.ts`        |      1,6% |                          60,9% |
| `useClubs.ts` (barrel)         |      0,4% |                           100% |
| **CAŁY `src/lib/clubs`**       | **24,6%** | **86,9% linii, 86,3% funkcji** |

### 7.2 Komentarze

| Powierzchnia              | Przed |                           Po |
| ------------------------- | ----: | ---------------------------: |
| `src/lib/comments`        | 17,2% | **100% linii, 100% funkcji** |
| `src/components/comments` |    0% |                  68,9% linii |

### 7.3 Organizmy

| Plik                    | Przed |                         Po |
| ----------------------- | ----: | -------------------------: |
| `ClubAccessGate.tsx`    |    0% |                      83,9% |
| `ClubModerationTab.tsx` |    0% |                      59,9% |
| `gateView.ts`           |     - | 100% na czterech metrykach |
| `moderationRules.ts`    |     - |       100% linii i funkcji |
| `clubInvalidations.ts`  |     - | 100% na czterech metrykach |

---

## 8. Czego ten PR NIE robi

Moduł ma 242 pliki. Ta praca domknęła **warstwę danych i hooki w całości** oraz trzy
organizmy o najwyższym ryzyku. Poza zasięgiem zostają:

- **UI klubów** (`src/components/clubs`, 103 pliki, 2 241 linii) - poza `ClubAccessGate`
  i atomami, które miały już testy;
- **panel administracyjny** (`src/components/admin/clubs`, 26 plików, 1 242 linie) - poza
  `ClubModerationTab`;
- **trasy klubowe** (20 plików, 707 linii) - kompozycja loaderów;
- **społeczność** (odznaki, Q&A, ankiety - 20 plików, 548 linii).

To jest świadome zatrzymanie na kroku, nie przeoczenie: warstwa danych i reguły są tym,
czego złamanie widzi użytkownik i czego nie łapie żadna inna bramka repo. Trasy i pozostałe
organizmy są następnym krokiem, nie regresją tego.

**Nie naprawiono** defektu z 6.4 (urwany adres z nawiasem) - to zmiana zachowania parsera
i należy jej się osobna decyzja.

---

## 9. Progi jako zapora

Pokrycie czatu stało w miejscu przez trzy pomiary, bo sam pomiar niczego nie pilnuje.
Progi per ścieżka w `vitest.config.ts` są floorowane tuż pod zmierzonym poziomem, zasada
jak wszędzie w tym pliku: **wolno je wyłącznie podnosić**.

Dodatkowo `reportOnFailure: true` w bloku coverage. `checkThresholds()` żyje wewnątrz
`reportCoverage()`, z którego vitest wychodzi natychmiast po pierwszym nieudanym teście -
bez tej flagi pomiar znika dokładnie wtedy, kiedy jest najbardziej potrzebny, czyli
w trakcie pisania nowych testów.
