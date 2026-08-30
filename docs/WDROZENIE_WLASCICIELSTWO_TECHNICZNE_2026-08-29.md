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
| `src/lib/ci/__tests__/ownership.test.ts` | 46 testów jednostkowych inwariantu                                         |
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
| 1 `identyfikatory` | Identyfikatory specyficzne, ważone rzadkością `1/log2(1+df)`; argmax po domenach                                  |    892 |
| 1.5 `literaly`     | Rescan surowego tekstu po nazwach ≥ 8 znaków - dla dynamicznego SQL i bloków `DO $$`, gdzie nazwy są w literałach |      3 |
| 2 `przekrojowe`    | Identyfikatory przekrojowe (`profiles`, `tenants`, `has_role`, ...) jako sygnał SŁABY, nie wyrzucony              |     18 |
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
- migracji bez atrybucji jest więcej niż `progi.migracjeBezAtrybucji`,
- domena wskazuje na nieistniejący wpis w `osoby`,
- właściciel domeny jest jednocześnie jej zastępcą (zerowy bus factor),
- reguła rejestru nie trafia już w nic (zgnilizna) ponad `progi.martweReguly`,
- brakuje któregoś z dokumentów: umowy, runbooka ciągłości, `governance/README.md`,
- **umowa utrzymaniowa wygasła** (`kontraktUtrzymaniowy.obowiazujeDo` w przeszłości).

**Ostrzega, nie blokując:**

- 60 dni przed wygaśnięciem umowy,
- gdy domeny nie mają obsadzonego właściciela, ale mieszczą się w progu.

### 5.1 Trzy zapadki

Progi wolno **WYŁĄCZNIE OBNIŻAĆ** - ta sama zasada, którą repo stosuje do
progów pokrycia w `vitest.config.ts`.

| Próg                   |  Dziś | Znaczenie                                                                     |
| ---------------------- | ----: | ----------------------------------------------------------------------------- |
| `domenyBezWlasciciela` | **9** | Ile domen może nie mieć obsadzonego właściciela. Spada przy każdym obsadzeniu |
| `migracjeBezAtrybucji` | **5** | Podłoga metody z §4.1                                                         |
| `martweReguly`         | **0** | Rejestr nie może zgnić: reguła, która w nic nie trafia, ma zniknąć            |

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
