# Wdrożenie: proweniencja kopii pipeline'u (bliźniaki PR #312, 2026-08-31)

## Diagnoza

Pipeline wdrożeniowy wydał ponownie dwie migracje klasy „tenant scope"
przyniesione w PR #312, każdą pod własnym numerem. Sekwencja jest zamknięta
w czterech commitach i widać ją co do sekundy:

| Commit    | Czas     | Co wniósł                                                  |
| --------- | -------- | ---------------------------------------------------------- |
| `1759be2` | 21:50:45 | `20260831214637_5b55b33f-….sql` (kopia migracji `…160000`) |
| `528abb5` | 21:51:17 | `20260831215103_21bb8d7a-….sql` (kopia migracji `…170000`) |
| `ceb5a23` | 21:52:15 | dwa wpisy `reconciled` w `supabase/migration-ledger.json`  |
| `8e771b9` | 21:53:03 | „Wdrożył migracje PR #312" - domknięcie serii              |

Treść wykonywana jest po obu stronach każdej pary identyczna - md5 treści
okrojonej z komentarzy i białych znaków wynosi `9df21f7097e4` dla pierwszej pary
i `a90cb00acee0` dla drugiej. Nie są identyczne rozmiary:

| Plik z PR-a                                                                             | Kopia z pipeline'u                                         | Zdjęte               |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------- |
| `…160000_page_full_path_tenant_scope.sql` (10 643 B, 215 linii, 125 komentarza)         | `…214637_5b55b33f-….sql` (2 587 B, 85 linii, 0 komentarza) | 125 linii komentarza |
| `…170000_owner_plane_tenant_scope_read_history.sql` (5 826 B, 113 linii, 62 komentarza) | `…215103_21bb8d7a-….sql` (2 012 B, 51 linii, 0 komentarza) | 62 linie komentarza  |

Razem **187 linii udokumentowanego uzasadnienia** - w obu przypadkach
**całość** komentarza, nie jego część.

### Co z tego było czerwone, a co nie jest naprawą

Pięć zapaleń z jednej przyczyny (dwa testy w `migrationReplay`, jeden
w `authzSnapshotParity`, dwie bramki) domknęły wpisy z 01-02.09: para po parze
w `KNOWN_CONTENT_TWINS`, mapowanie `reconciled` w ledgerze i regeneracja
`authzSnapshot.generated.ts` (`"migrations":932` -> stan katalogu). To była
naprawa **sygnału**. Zostawiła jednak nietkniętą przyczynę, dla której sygnał
w ogóle miał znaczenie - i tę zamyka dopiero to wdrożenie.

### Rzeczywisty koszt, którego rejestr nie usuwał

Moduł bramki nazywa go od pierwszego wydania inwariantu 3: „HISTORIA MIGRACJI
PRZESTAJE MÓWIĆ PRAWDĘ o tym, kiedy zmiana realnie weszła. Przy spłaszczonej
historii commitów to jedyne narzędzie datowania regresji, jakie zostaje audytowi
i debuggerowi." Przy commitach nazwanych „Changes" i „Work in progress" to nie
jest figura retoryczna - `git log` nie niesie tu żadnej informacji o treści.

Skutek jest mierzalny. Kto datuje regresję izolacji najemcy w kanonicznej
ścieżce strony po katalogu migracji albo po `schema_migrations`, trafia na
`20260831214637` - plik z **najnowszym** znacznikiem czasu, **zerem**
uzasadnienia i przesunięciem **5 h 46 min** wobec chwili, w której zmiana
naprawdę weszła (`20260831160000`). Dla drugiej pary przesunięcie wynosi
**4 h 51 min**. Wpis w `KNOWN_CONTENT_TWINS` niesie prawdę, ale pomaga wyłącznie
temu, kto **już wie**, że ma tam zajrzeć; człowiek dochodzący do sprawy od
strony bazy nie wie.

## Zmiany

### 1. Inwariant 5: kopia pipeline'u wskazuje na swój oryginał

`src/lib/ci/migrationReplay.ts` dostaje piąty inwariant. Kopia musi nieść
w nagłówku linię:

```sql
-- BLIZNIAK TRESCI: 20260831160000_page_full_path_tenant_scope.sql
```

Nagłówek jest sprawdzany maszynowo (`TWIN_PROVENANCE_RE`) i musi wskazywać
**drugi człon tej samej pary**. Wskazanie „jakiegoś" pliku czerwieni bramkę tak
samo jak brak nagłówka: przy dwóch wdrożeniach w jednym dniu ozdobnik wysłałby
datującego regresję w miejsce gorsze niż milczenie.

Który człon pary jest kopią, wynika z konwencji nazw: pipeline nadaje
`<wersja>_<uuid>.sql`, PR - opis słowny. Reguła trzyma się na **wszystkich 55**
parach rejestru (dokładnie jeden człon każdej pary pasuje) i **nie jest**
zgadywanką: para, w której konwencja nie rozstrzyga, jest raportowana jako wada
rejestru przez `validateTwinLedger`, a nie po cichu pomijana.

Komentarz nie zmienia niczego, co migracja wykonuje. `normalizeSql` odejmuje
komentarze przed grupowaniem, więc para nadal grupuje się po tej samej treści -
md5 treści okrojonej po dopisaniu nagłówków to nadal `9df21f7097e4`
i `a90cb00acee0`, co do znaku.

### 2. Ratchet po dacie, nie backfill 53 par

Wymóg obowiązuje pary z `appliedOn >= TWIN_PROVENANCE_SINCE` (`2026-08-31`).
53 pary sprzed tej linii zostają bez nagłówka **świadomie**: dopisywanie
komentarzy do zastosowanych migracji jest decyzją operatorską i osobnym
wdrożeniem, nie skutkiem ubocznym naprawy jednego zdarzenia. Linię wolno
przesuwać **wyłącznie wstecz** - pokrycie inwariantu może tylko rosnąć.

Zielona linia raportu odróżnia teraz parę objętą ratchetem od pary sprzed linii:

```
dług: PR #312 / panel Lovable (commit 1759be2) (2026-08-31) …160000_page_full_path_tenant_scope.sql ≡ …214637_5b55b33f-….sql [proweniencja w kopii]
```

Bez tego znacznika zielony raport nie pokazywałby, czy pokrycie rośnie.

### 3. Nagłówki w obu kopiach

Każda kopia niesie teraz: stwierdzenie, że **nie wnosi zmiany**; commit i czas
wydania przez pipeline; liczbę zdjętych linii komentarza; md5 potwierdzające
tożsamość treści; **ostrzeżenie o datowaniu** wraz z prawdziwą wersją wejścia
i wielkością przesunięcia; wskazanie, gdzie leży uzasadnienie; oraz powód, dla
którego pliku **nie wolno skasować** (wersja siedzi w `schema_migrations`,
usunięcie zostawiłoby wiersz ledgera bez pliku i wywróciło kolejny `db push`).

Uzasadnienie merytoryczne **nie jest** kopiowane do duplikatu. Argument
zduplikowany w dwóch plikach rozjeżdża się po cichu - dokładnie tak, jak
komentarz „Wdrożenie PR #191" przeżył wpis z PR #209, co opisuje wdrożenie
z 2026-08-18.

### 4. Korekta liczb w rejestrze

Wpisy `KNOWN_CONTENT_TWINS` dla obu par mówiły „131 linii (215 -> 84)"
i „63 linie (113 -> 50)". Rozbieżność brała się z `wc -l`, które nie liczy
ostatniej linii pliku bez znaku końca - a kopie z pipeline'u takiego znaku nie
mają. Poprawione na mierzalne wprost: 125 linii komentarza (215 -> 85)
i 62 linie komentarza (113 -> 51).

## Dowód

| Sprawdzenie                                                                                                                                             | Wynik                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `check:sql-migration-replay`                                                                                                                            | zielona, 935 plików, 55 znanych par           |
| kontrpróbka: nagłówek zdjęty z `…214637_5b55b33f-….sql`                                                                                                 | bramka **czerwona**, wskazuje plik i oryginał |
| `vitest run src/lib/ci/__tests__/migrationReplay.test.ts`                                                                                               | 44 testy (było 37, doszło 7)                  |
| `vitest run src/lib/ci/__tests__`                                                                                                                       | 44 pliki / 819 testów                         |
| `vitest run src/lib/authz`                                                                                                                              | 183 testy + 1 oczekiwana porażka              |
| `check:authz-snapshot`                                                                                                                                  | snapshot zgodny z migracjami                  |
| md5 treści okrojonej, obie pary, przed vs po                                                                                                            | identyczne (`9df21f7097e4`, `a90cb00acee0`)   |
| `check:sql-tenant-scope`, `sql-app-role`, `sql-anon-insert`, `sql-owner-tenant-scope`, `sql-policy-tenant-regression`, `rpc-contract`, `sql-emit-actor` | wszystkie zielone                             |
| `tsc --noEmit`, `eslint`, `prettier --check`                                                                                                            | czyste na zmienionych plikach                 |

Wiersz z kontrpróbką jest tu warunkiem, a nie ozdobą: bramka, której nikt nie
zobaczył na czerwono, jest nieodróżnialna od bramki, która nic nie mierzy.

## Czego to NIE naprawia

Źródła zjawiska repo nadal nie kontroluje - pipeline będzie generował kopie tak
długo, jak długo migracje wjeżdżają przez panel, i każde takie wdrożenie doda
parę do rejestru. Nowe jest wyłącznie to, że kopia przestaje być anonimowa:
musi powiedzieć, czyją jest kopią i że jej znacznik czasu nie jest datą wejścia
zmiany.

Nie naprawia też nazewnictwa commitów. „Changes" i „Work in progress" pozostają
nazwami, przy których datowanie regresji opiera się na wersjach migracji - to
wdrożenie sprawia tylko, że te wersje przestają w tej roli kłamać.

Backfill 53 par sprzed linii ratchetu pozostaje otwarty i wymaga osobnej decyzji.
