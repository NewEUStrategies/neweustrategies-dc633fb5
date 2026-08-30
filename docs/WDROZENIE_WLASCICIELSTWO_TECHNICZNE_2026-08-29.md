# Wdrożenie: własnicielstwo techniczne tras i migracji (2026-08-29)

Zapis wdrożenia naprawy ustalenia audytowego: **193 trasy administracyjne i 918
migracji bazy bez wskazanego właściciela technicznego, bez umowy utrzymaniowej
i bez procedury na wypadek niedostępności wykonawcy.**

Dokument mówi, CO zostało zrobione, CZYM to zmierzono i CO zostało otwarte.
Nie powiela treści dokumentów, które wdrożenie tworzy - odsyła do nich.

---

## 1. Stan przed zmianą - pomiar, nie wrażenie

Wszystkie liczby zmierzone na `HEAD` gałęzi `claude/admin-routes-migrations-owner-ck2llv`.

| Fakt                                                                | Wartość            | Jak zmierzone                                                             |
| ------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| Trasy administracyjne                                               | **193**            | `ls src/routes \| grep '^admin' \| wc -l` (wszystkie `.tsx`, zero testów) |
| Migracje bazy                                                       | **918**            | `ls supabase/migrations/*.sql \| wc -l`                                   |
| Migracje o nazwie będącej UUID-em (bez znaczenia semantycznego)     | **631 (68,7%)**    | dopasowanie nazwy pliku do wzorca UUID                                    |
| Dokumenty o własnicielstwie / SLA / ciągłości w `docs/` (124 pliki) | **0**              | `grep -rn` po: właścicie, SLA, utrzyman, wykonawc, ciągłość, RTO, RPO     |
| `.github/CODEOWNERS`                                                | **brak**           | zawartość `.github/` to 5 plików workflow i nic więcej                    |
| Procedura backupu w repo                                            | **brak**           | `pg_dump`, `pg_restore`, `supabase db dump`, `supabase link` - 0 trafień  |
| Commity człowieka w całej historii                                  | **2 z 275 (0,7%)** | `git shortlog -sne --all`: 240 bot platformy, 33 agenci, 2 organizacja    |
| Tagi w gicie                                                        | **0**              | `git tag`                                                                 |

Dwie z tych liczb decydują o kształcie naprawy:

1. **68,7% migracji nie da się przypisać po nazwie pliku.** Atrybucja musi iść
   po TREŚCI SQL - po obiektach, których migracja dotyka. Rejestr oparty na
   nazwach byłby pusty w dwóch trzecich.
2. **Bus factor liczony z historii gita wynosi zero.** Wiedza o systemie nie ma
   dziś nośnika osobowego, więc pytanie „kto to utrzymuje" nie ma odpowiedzi
   nawet nieformalnej. To przesądza, że naprawa musi być EGZEKWOWANA, a nie
   opisana - dokument bez bramki zdezaktualizowałby się przy pierwszej nowej
   trasie i nikt by tego nie zauważył.

---

## 2. Co dostarczono

| Plik                                     | Rola                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `governance/ownership.json`              | **Rejestr** - jedyne źródło prawdy o zakresie i właścicielach              |
| `governance/README.md`                   | Instrukcja edycji rejestru (najczęstsze sytuacje, progi, metoda atrybucji) |
| `src/lib/ci/ownership.ts`                | Inwariant, warstwa czysta: parsowanie, atrybucja, raport                   |
| `src/lib/ci/__tests__/ownership.test.ts` | 65 testów jednostkowych inwariantu                                         |
| `scripts/check-ownership.ts`             | Cienki runner bramki (`bun run check:ownership`)                           |
| `scripts/generate-codeowners.ts`         | Generator i weryfikator `.github/CODEOWNERS` (`--check` bajt w bajt)       |
| `.github/CODEOWNERS`                     | Plik GENEROWANY z rejestru                                                 |
| `docs/UMOWA_UTRZYMANIOWA.md`             | Specyfikacja poziomu usługi (SLA/OLA) - załącznik techniczny do umowy      |
| `docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md`     | Procedura na wypadek niedostępności wykonawcy                              |
| `.github/workflows/ci.yml`               | Dwa nowe kroki w bloku najtańszych bramek                                  |
| `package.json`                           | `check:ownership`, `generate:codeowners`, `check:codeowners`               |

Podział na warstwy (czysty moduł w `src/lib/ci/` + cienki runner w `scripts/` +
test jednostkowy + wpięcie w `ci.yml`) jest konwencją tego repo, nie wyborem -
patrz `scripts/check-gate-coverage.ts` i `src/lib/ci/gateCoverage.ts`.

---

## 3. Taksonomia: 9 domen, nie wymyślonych

Domeny NIE zostały wymyślone. Powstały ze zderzenia dwóch źródeł, które już
były w repo:

- **`src/lib/admin/adminNav.ts`** (420 linii, 13 grup nawigacji panelu) -
  grupowanie jest tam jawnie domenowe („co administrator chce zrobić, a nie
  gdzie mieszka trasa"), więc to gotowa taksonomia powierzchni tras;
- **korpus SQL** - realny rozkład prefiksów tabel (`event_` 41 tabel, `club_` 33,
  `post_` 17, `crm_` 8, `career_` 6, `newsletter_` 6, ...).

13 grup nawigacji zwinięto do 9 domen własnicielskich - grupa nawigacji to
jednostka UI, domena własnicielska to jednostka odpowiedzialności i musi być
grubsza, bo inaczej rejestr wymagałby 13 właścicieli i 13 zastępców.

Zmierzony rozkład (wydruk `bun run check:ownership`):

| Domena                    |   Trasy | Migracje | SLA     |
| ------------------------- | ------: | -------: | ------- |
| `spolecznosc-i-kluby`     |      17 |      229 | `sla-1` |
| `wydarzenia`              |      51 |      128 | `sla-1` |
| `monetyzacja-i-platnosci` |      19 |      107 | `sla-1` |
| `crm-i-marketing`         |      35 |       84 | `sla-2` |
| `kariera-i-programy`      |       5 |       13 | `sla-3` |
| `tresc-i-edytory`         |      40 |      240 | `sla-1` |
| `zgodnosc-i-prywatnosc`   |       2 |        8 | `sla-1` |
| `tozsamosc-i-uprawnienia` |      20 |       40 | `sla-1` |
| `platforma-i-baza`        |       4 |       69 | `sla-1` |
| **Razem**                 | **193** |  **918** |         |

**KOLEJNOŚĆ DOMEN W REJESTRZE JEST ZNACZĄCA, nie kosmetyczna.** Rozstrzyga
dwie różne rzeczy naraz: nakładające się wzorce tras (pierwsza domena wygrywa)
oraz remisy punktacji migracji. Dlatego domeny wąskie stoją PRZED szerokimi -
`zgodnosc-i-prywatnosc` (wzorce dokładne `admin.settings.privacy.tsx`,
`admin.settings.cookie-banner.tsx`) przed `tozsamosc-i-uprawnienia` (wzorzec
`admin.settings.*`). Przy odwrotnej kolejności - zmierzone w trakcie wdrożenia -
`zgodnosc-i-prywatnosc` dostawała **0 tras**, a rozkład migracji przesuwał się
o jeden plik.

---

## 4. Metoda atrybucji migracji

Cztery warstwy, każda uruchamiana dopiero wtedy, gdy poprzednia nic nie znalazła:

| Warstwa            | Co robi                                                                                                           | Plików |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | -----: |
| 1 `identyfikatory` | Identyfikatory specyficzne, ważone rzadkością `1/log2(1+df)`; argmax po domenach                                  |    893 |
| 1.5 `literaly`     | Rescan surowego tekstu po nazwach ≥ 8 znaków - dla dynamicznego SQL i bloków `DO $$`, gdzie nazwy są w literałach |      3 |
| 2 `przekrojowe`    | Identyfikatory przekrojowe (`profiles`, `tenants`, `has_role`, ...) jako sygnał SŁABY, nie wyrzucony              |     17 |
| 3 `brak`           | Brak trafienia → domena przekrojowa `platforma-i-baza`                                                            |  **5** |

Kluczowe decyzje metody:

- **Identyfikatory przekrojowe są ODKŁADANE, nie wyrzucane.** Migracja robiąca
  wyłącznie `GRANT ... ON public.profiles` należy do tożsamości, a nie do kubła
  „nie wiadomo". Bez warstwy 2 kubeł miał 32 pliki zamiast 5.
- **Słownik (VOCAB) odsiewa nazwy CTE, aliasy i zmienne PL/pgSQL.** Bez niego
  korpus dawał 1653 identyfikatory zamiast 1350 - punktowały `visible`, `base`,
  `cand`, `ranked`, `ctx`.
- **Próg „przekrojowości" (20% plików) działa dopiero od 50 plików korpusu.**
  W korpusie jednoplikowym każdy identyfikator występuje w 100% plików, więc
  próg odwróciłby się przeciwko regule i wszystko spadłoby do warstwy „brak".
  Błąd wyszedł na testach jednostkowych, nie na produkcji.

### 4.1 Pozostałe 5 plików bez atrybucji - to podłoga, nie zaniedbanie

| Plik                            | Co w nim jest                                                |
| ------------------------------- | ------------------------------------------------------------ |
| `20260628221009_5a12c332-….sql` | jedna linia: `CREATE EXTENSION pgtap`                        |
| `20260724060222_9a710f7c-….sql` | **pusty** - `-- see /tmp/mig.sql (loaded via file below)`    |
| `20260724064450_1abe66d4-….sql` | **pusty** - odsyła do innego pliku migracji                  |
| `20260727053841_7ec6a016-….sql` | **pusty** - odsyła do pliku w `/tmp`, którego już nie ma     |
| `20260725181311_90af83b6-….sql` | pętla `DO $$` po `pg_proc`, nazwy wyłącznie przez `format()` |

Trzy z nich to **puste placeholdery - same komentarze, zero SQL**. To osobne
ustalenie tego wdrożenia: nie jest to problem atrybucji, tylko śmieci w
katalogu migracji. Nie usuwam ich w tej zmianie (usunięcie pliku z historii
migracji to operacja na `schema_migrations`, nie na repo) - zgłaszam jako lukę
otwartą w §7.

### 4.2 Uczciwie o ograniczeniu

Bramka gwarantuje **POKRYCIE, nie TRAFNOŚĆ**. 221 z 918 atrybucji jest
„słabych" - rozstrzygniętych jednym identyfikatorem. Raport bramki podaje tę
liczbę osobno, w każdym przebiegu, zamiast chować ją za zieloną bramką.

---

## 5. Co bramka egzekwuje

`bun run check:ownership` - **0,6 s** na pełnym korpusie (193 trasy + 918
migracji), czyta wyłącznie pliki repo, więc stoi w bloku najtańszych sygnałów
`ci.yml`, tuż za `check:gate-coverage`.

**Oblewa, gdy:**

- jakakolwiek trasa `src/routes/admin*.tsx` nie pasuje do żadnego wzorca,
- migracja bez atrybucji nie jest wymieniona w `progi.migracjeBezAtrybucjiDozwolone`,
- domena wskazuje na nieistniejący wpis w `osoby`,
- właściciel domeny jest jednocześnie jej zastępcą (zerowy bus factor),
- wzorzec TRASY nie trafia już w nic (zgnilizna) ponad `progi.martweWzorceTras`,
- brakuje któregoś z dokumentów: umowy, runbooka ciągłości, `governance/README.md`,
- **umowa utrzymaniowa wygasła** (`kontraktUtrzymaniowy.obowiazujeDo` w przeszłości).

**Ostrzega, nie blokując:**

- 60 dni przed wygaśnięciem umowy,
- gdy domeny nie mają obsadzonego właściciela, ale mieszczą się w progu.

### 5.1 Trzy zapadki

Progi wolno **WYŁĄCZNIE OBNIŻAĆ** - ta sama zasada, którą repo stosuje do
progów pokrycia w `vitest.config.ts`.

| Próg                            |       Dziś | Znaczenie                                                                         |
| ------------------------------- | ---------: | --------------------------------------------------------------------------------- |
| `domenyBezWlasciciela`          |      **9** | Ile domen może nie mieć obsadzonego właściciela. Spada przy każdym obsadzeniu     |
| `migracjeBezAtrybucjiDozwolone` | **5 nazw** | Podłoga metody z §4.1, wypisana z nazwy zamiast policzona                         |
| `martweWzorceTras`              |      **0** | Wzorzec TRASY, który w nic nie trafia, ma zniknąć. Prefiksy bazy tylko ostrzegają |

### 5.2 Dlaczego wygaśnięcie umowy jest błędem, a nie ostrzeżeniem

Ustalenie audytowe brzmiało „brak umowy utrzymaniowej". Umowa, o której nikt
nie pamięta, jest tym samym stanem co jej brak. Pole `obowiazujeDo` jest więc
egzekwowane: 60 dni ostrzeżenia w każdym przebiegu CI, potem czerwono.
Przedłużenie kosztuje jedno pole w rejestrze i commit. **To jest świadoma
decyzja projektowa, nie efekt uboczny** - i jedyne miejsce w tej zmianie, które
w przyszłości zapali CI bez żadnej zmiany w kodzie. Data: **2027-08-31**.

---

## 6. `.github/CODEOWNERS` - dlaczego reguły są zakomentowane

Plik jest generowany z rejestru, ale **wszystkie reguły wychodzą dziś
zakomentowane**. Powód jest operacyjny, nie kosmetyczny: zespoły
`@NewEUStrategies/utrzymanie-*` nie istnieją jeszcze w organizacji, a aktywna
reguła CODEOWNERS wskazująca nieistniejący zespół **zablokowałaby KAŻDY merge**
przy ochronie gałęzi z opcją „Require review from Code Owners". Bramka
własnicielska nie ma prawa zatrzymać wydania.

Kolejność aktywacji: załóż zespół w organizacji → ustaw `obsadzone: true` w
rejestrze → `bun run generate:codeowners` → obniż próg `domenyBezWlasciciela`.

---

## 7. Luki otwarte - do decyzji Zamawiającego

Naprawa dostarcza mechanizm i dokumenty. Trzech rzeczy **nie dało się
dostarczyć z repozytorium** i są to zadania po stronie organizacji:

| #   | Luka                                                                                                                                                                                                         | Kto zamyka              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| L1  | **Obsadzenie 9 właścicieli i 9 zastępców.** W repo nie ma ANI JEDNEGO indywidualnego uchwytu GitHub ani osobowego adresu e-mail - wymyślanie ludzi byłoby fikcją, więc rejestr ma jawne wpisy `NIEOBSADZONE` | Zamawiający             |
| L2  | **Wskazanie wykonawcy** (`kontraktUtrzymaniowy.wykonawca`) i uzupełnienie tabel „DO UZUPEŁNIENIA" w umowie i runbooku                                                                                        | Zamawiający             |
| L3  | **Procedura backupu produkcji.** W repo jej nie ma; `docs/UMOWA_UTRZYMANIOWA.md` §8 opisuje ryzyko i proponuje mierzalne zobowiązanie, ale samo zobowiązanie musi zostać przyjęte                            | Zamawiający + Wykonawca |
| L4  | Trzy puste migracje-placeholdery (§4.1) - do usunięcia razem z uzgodnieniem `schema_migrations`                                                                                                              | Wykonawca               |

L1 i L2 są przedmiotem progu `domenyBezWlasciciela` - dopóki nie zostaną
zamknięte, każdy przebieg CI wypisuje, ilu właścicieli brakuje.

---

## 8. Weryfikacja wdrożenia

| Sprawdzenie                                         | Wynik                                                    |
| --------------------------------------------------- | -------------------------------------------------------- |
| `bun run check:ownership`                           | ✓ 193/193 tras, 918/918 migracji, 0 martwych reguł       |
| to samo po scaleniu `main` (2026-08-30)             | ✓ 193/193 tras, **922/922** migracji, 0 martwych reguł   |
| `bun run check:codeowners`                          | ✓ zgodny z rejestrem                                     |
| `bun run check:gate-coverage`                       | ✓ 38 bramek `check:*`, każda wpięta dokładnie raz na job |
| `vitest run src/lib/ci/__tests__/ownership.test.ts` | ✓ 46/46                                                  |
| `eslint` na nowych plikach                          | ✓ czysto                                                 |
| `prettier --check` na nowych plikach                | ✓ czysto                                                 |

**Uwaga o stanie zastanym:** `bun run format:check` na CAŁYM repo oblewa na
**53 plikach, których ta zmiana nie dotyka** (m.in. `src/routes/profile.tsx`,
`src/routes/quiz.tsx`, `src/routes/events.$slug.me.tsx`). Osobno
`prettier` nie potrafi sparsować `.github/workflows/ci.yml` (`SyntaxError:
Nested mappings are not allowed in compact mappings`) - błąd występuje
identycznie na wersji sprzed tej zmiany, więc nie został przez nią
wprowadzony. Oba stany są zastane i wymagają osobnej pracy.

---

## 9. Przegląd adwersaryjny bramki i wynikające z niego poprawki

Bramka blokująca, która myli się w jedną stronę, kosztuje cykl wydania; myląc
się w drugą - nie robi nic. Po napisaniu jej przeszła więc osobny przegląd
adwersaryjny (trzy niezależne soczewki: fałszywa czerwień, poprawność logiki,
możliwość obejścia; każde znalezisko weryfikowane przez osobnego kontrolera
z zadaniem OBALENIA go). Znaleziska potwierdzone eksperymentem na żywym repo
i naprawione w tej samej zmianie:

| #   | Defekt                                                                 | Skutek, gdyby został                                                                                                                                | Poprawka                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `stripSqlNoise` wycinał komentarze PRZED literałami                    | `'--'` wewnątrz literału zjadał resztę linii razem z prawdziwym SQL-em; migracja gubiła identyfikatory i dostawała złą domenę                       | Skaner stanowy w jednym przebiegu (żadna kolejność trzech `replace` nie jest poprawna - komentarz i literał zagnieżdżają się wzajemnie). Odzyskał jedną migrację z warstwy 2 do warstwy 1 |
| 2   | Generowany CODEOWNERS ODWRACAŁ precedencję rejestru                    | GitHub bierze OSTATNIE trafienie, rejestr PIERWSZE - po aktywacji reguł przeglądy trafiałyby do odwrotnych zespołów niż mówi rejestr                | Domeny emitowane w kolejności ODWROTNEJ, z wyjaśnieniem w nagłówku pliku                                                                                                                  |
| 3   | `usedPatterns` zapisywał tylko wzorzec ZWYCIĘSKI                       | Wzorzec przesłonięty przez wcześniejszą domenę byłby raportowany jako MARTWY, a przepisane lekarstwo („usuń regułę") kasowałoby poprawną informację | Do „użytych" liczy się KAŻDY wzorzec, który trafił                                                                                                                                        |
| 4   | Wzorzec-łapacz uciszał bramkę tras jedną linią                         | `admin.*` w dowolnej domenie daje 100% pokrycia i zero informacji - bramka świeciła na zielono, nie znacząc nic                                     | Próg `CATCH_ALL_SHARE` (40%; najszerszy uczciwy wzorzec bierze 20,2%) z podłogą 20 tras, żeby procent miał sens                                                                           |
| 5   | Jeden boolean przy wpisie-zaślepce „obsadzał" 9 domen naraz            | Wszystkie domeny wskazują ten sam wpis `wt-nieobsadzony`; `obsadzone: true` bez kontaktu oznaczałby cały system jako mający właściciela             | Obsadzony musi mieć `kontakt` i organizację inną niż `NIEOBSADZONE`                                                                                                                       |
| 6   | `martweReguly` traktowało wzorce tras i prefiksy bazy tak samo         | Spłaszczenie historii migracji dawało 13 „martwych" reguł, a lekarstwo kasowało poprawne własnicielstwo tabel, które istnieją                       | Rozdzielone: martwy wzorzec TRASY blokuje, martwy prefiks bazy tylko ostrzega                                                                                                             |
| 7   | `migracjeBezAtrybucji` było LICZBĄ ustawioną dokładnie na stanie (5/5) | Zero zapasu, a komunikat wypisywał sześć UUID-ów bez wskazania, który jest nowy                                                                     | Lista NAZW zamiast liczby: komunikat pokazuje wyłącznie migracje nowe, a nieaktualny wpis listy jest zgłaszany osobno                                                                     |
| 8   | Uszkodzony rejestr kończył się stosem wywołań `JSON.parse`             | Pierwszy kontakt z bramką to niezrozumiały błąd                                                                                                     | Trzy osobne komunikaty: brak pliku, zły JSON, zły kształt - każdy ze wskazaniem lekarstwa                                                                                                 |
| 9   | Skan tras był płaski (`readdirSync` bez rekursji)                      | Trasa w `src/routes/admin/…` byłaby dla bramki niewidzialna - dziura w bramce, której cała wartość to kompletność                                   | Skan rekurencyjny, wzorce dopasowywane do ścieżki względnej                                                                                                                               |
| 10  | `check:codeowners` przy różnicy w OGONIE pliku dawał pusty komunikat   | „linia 0", „&lt;brak linii&gt;" po obu stronach                                                                                                     | Iteracja po dłuższej z dwóch stron + liczba linii po obu                                                                                                                                  |

Nienaprawione świadomie, z uzasadnieniem:

- **Zapadki nie są egzekwowane maszynowo.** Nic nie porównuje progów z gałęzią
  bazową, więc podniesienie progu w tym samym commicie, który psuje pokrycie,
  przejdzie. Porównanie z `origin/main` wymagałoby w CI pobrania gałęzi bazowej
  i wywracałoby bramkę przy płytkim klonie. Zapadka jest konwencją wspartą
  przeglądem PR-a - i jest to teraz napisane wprost w nagłówku modułu oraz
  w `governance/README.md`, zamiast udawać inaczej.
- **Usunięcie trasy nadal wymaga jednej linii zmiany w rejestrze.** Przegląd
  policzył, że dotyczy to 58 z 193 tras (te objęte wzorcem dokładnym). To jest
  zamierzone: własnicielstwo ma śledzić rzeczywistość, komunikat mówi dokładnie
  co usunąć, a alternatywa (liczenie martwych reguł tylko dla wzorców
  z gwiazdką) wyłączyłaby zapadkę dla 57 z 75 wzorców.

---

## 10. Zgłoszenia bota przeglądowego na PR #305

Bot `chatgpt-codex-connector` zgłosił trzy uwagi P2 do kodu bramki. Wszystkie
trzy okazały się realne i zostały naprawione; dwie z nich to ta sama klasa
błędu, którą przegląd adwersaryjny złapał gdzie indziej - bramka o kompletność
miała miejsca, w których coś znikało po cichu.

| Zgłoszenie                                          | Weryfikacja                                                                                                                                                                                                                                                                                                                                                                              | Poprawka                                                                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skan tras obejmował tylko `.tsx`                    | Potwierdzone: router bierze też `.ts`, a repo ma **55** tras w czystym `.ts` (`sitemaps.$section.ts`, `llms[.]txt.ts`, `mcp.ts`, całe `lovable/email/**`). Trasa panelu bez JSX-a - handler, przekierowanie, eksport - jest naturalnie `.ts` i **znikałaby z bramki bez śladu**. Dziś takiej trasy nie ma: jedyne `admin*.ts` to test w `__tests__/`, więc poprawka niczego nie przenosi | Skan bierze `.ts` i `.tsx`; testy odpadają po katalogu `__tests__` **oraz** po `.test.`/`.spec.` w nazwie, bo test bywa położony obok trasy                                                                         |
| Warstwa 1.5 skanowała surowy SQL **z komentarzami** | Potwierdzone i groźniejsze, niż wygląda: migracja, której cała treść to `-- Follow-up for club_members; no SQL yet`, dostawała domenę **z komentarza**. To dokładnie kształt trzech pustych placeholderów z listy `migracjeBezAtrybucjiDozwolone` - czyli mechanizm, który miał je wyłapywać, sam je przepuszczał                                                                        | Skaner rozdzielony na dwa tryby: `stripSqlNoise` (komentarze **i** literały - warstwa 1) oraz `stripSqlComments` (tylko komentarze, literały zostają - warstwa 1.5). Po poprawce warstwa 1.5 spadła z 3 plików do 2 |
| `tier2` nie był walidowany wobec listy domen        | Potwierdzone: literówka w nazwie domeny nie zapalała **żadnego** warunku - migracja trafiała do nieistniejącej domeny, `perDomain` liczyło jej udział jako `NaN`, a `ownershipFailed` milczało. Bramka raportowała własnicielstwo, którego nie było                                                                                                                                      | `parseRegistry` odrzuca cel `tier2` spoza `domeny`. Walidacja stoi **po** kontroli duplikatów i pustych domen, żeby bardziej podstawowy błąd zgłaszał się pierwszy                                                  |

Testów: 59 → 65.

### 10.1 Scalenie `main` (2026-08-30)

Konflikt w `.github/workflows/ci.yml` był **wyłącznie w komentarzu**: `main`
niezależnie zrobiło tę samą poprawkę (cudzysłów wokół nazwy kroku z `RLS: `),
a jego komentarz niesie fakt, którego mój nie miał - bez cudzysłowu GitHub
kończy bieg jako **startup failure**: zero jobów, zero logów. Wzięta została
wersja z `main`; kod po obu stronach był identyczny.

Scalenie dołożyło 4 migracje (918 → 922). Bramka pokrywa je bez zmiany
rejestru: 922/922, nadal 5 plików na liście bazowej, 0 martwych wzorców tras.
