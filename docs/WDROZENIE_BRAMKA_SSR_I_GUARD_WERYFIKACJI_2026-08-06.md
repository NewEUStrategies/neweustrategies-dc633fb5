# Wdrożenie: realna bramka kompletności SSR + guard pól weryfikacji - 2026-08-06

Zamknięcie dwóch wierszy audytu `OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`:

| Wiersz audytu                 | Ocena | Diagnoza audytu                                                                                                                                                            | Stan po wdrożeniu                                                                                                       |
| ----------------------------- | :---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Bramka kompletności SSR (e2e) |   4   | asercja „kończy się `</html>`" **nie mogła zafailować**, bo strażnik dosztukowuje ogon; zero asercji treści poza `h1` na `/`                                               | sygnatura ucięcia + nagłówek uzbrojenia + asercje treści per szablon; **udowodniono empirycznie, że bramka failuje**    |
| Guard pól weryfikacji         | 6 → 5 | `20260806094104` zawęziło krąg do samego `admin`, `super_admin` stracił dostęp; snapshot autoryzacji położył suitę na `main`; pgTAP testował wariant sprzed dwóch migracji | krąg przywrócony (`admin` + `super_admin`), 42501, snapshot zregenerowany, pgTAP na zachowaniu, **bramka wpięta do CI** |

Powiązane: korekta 2 audytu (brak `h1` na stronach buildera) - naprawiona i przypięta
testami, bo to ona odbierała bramce SSR sens na trasie `$.tsx`.

---

## 1. Bramka kompletności SSR - dlaczego była pozorna

`documentStreamGuard.server.ts` istnieje po incydencie „~61 s" i celowo
**dosztukowuje** `</body></html>`, gdy render nie dobił do końca: crawler ma dostać
dokument parsowalny, a nie strzęp. Skutek uboczny był fatalny dla bramki:

```
ucięty render  -> strażnik dopisuje </body></html> -> HTTP 200, kończy się </html>
kompletny render                                   -> HTTP 200, kończy się </html>
```

Test szukał dokładnie tego, co strażnik dopisywał. Mierzył więc zachowanie strażnika,
nie kompletność renderu - **nie istniał stan, w którym mógł zafailować.**

### Co zmieniło się w kodzie

1. **Sygnatura ucięcia** (`DOC_GUARD_TRUNCATION_MARKER`). Dosztukowany ogon jest teraz
   poprzedzony komentarzem HTML z powodem, czasem i liczbą bajtów:
   `<!--ssr-doc-guard:truncated reason="idle" ms="12001" bytes="53210"-->`.
   Komentarz jest niewidoczny dla użytkownika i ignorowany przez parsery, a daje
   maszynowo pewny dowód ucięcia - w teście, w logu i w „pokaż źródło strony"
   (diagnostyka „dlaczego ta strona nie ma hydratacji").
2. **Nagłówek uzbrojenia** (`x-ssr-doc-guard: on`), ustawiany przy opakowaniu odpowiedzi.
   Bez niego asercja „brak sygnatury ucięcia" byłaby pozorna w drugą stronę:
   przechodziłaby także przy `SSR_DOC_GUARD=off`, gdy nikt niczego nie pilnuje.
   Nagłówki oryginalnej odpowiedzi są kopiowane, nie mutowane.
3. **Mikrooptymalizacje strażnika**: maska case-insensitive sentinela policzona raz
   (`SENTINEL_MASK`), `TextEncoder` wyniesiony do modułu.

### Co zmieniło się w bramce (`e2e/ssr-completeness.spec.ts`)

Trzy niezależne warstwy, dla każdej z czterech tras:

- **uzbrojenie** - nagłówek `x-ssr-doc-guard`,
- **brak sygnatury ucięcia** - właściwa asercja kompletności,
- **treść per szablon** - `<main id="main-content">`, `<footer>` (dowód, że body dobiegło
  końca - stopka jest ostatnia w drzewie), **dokładnie jeden** `h1` o treści zgodnej
  z szablonem, `lang` trasy, niepusty `<title>` oraz kopia chrome'u w języku trasy
  (`Przejdź do treści` / `Skip to content`) - co przy okazji łapie surowy klucz i18n
  i angielską stronę renderowaną po polsku.

Testy hydratacji są teraz dwa (PL i EN), z **jawnie ustawionym `locale`** kontekstu:
goła strona główna negocjuje język z `Accept-Language`, więc bez tego test mierzyłby
ustawienia regionalne runnera CI, a nie hydratację.

### Dowód, że bramka failuje (wykonany, nie deklarowany)

Do strażnika wstrzyknięto tymczasowy błąd (zamknięcie strumienia po pierwszym chunku),
uruchomiono suitę i przywrócono kod:

```
✘ home (PL) (/)          → Error: / dokument został dosztukowany przez strażnika
✘ home (EN) (/en)        → j.w.
✘ blog listing (/blog)   → j.w.
✘ cookie policy (/cookies) → j.w.
✓ home (PL) hydration    → PRZESZŁA
✓ home (EN) hydration    → PRZESZŁA
```

Ostatnie dwie linie są pointą: **testy przeglądarkowe ucięcia SSR nie widzą** - klient
dorabia brakującą treść po hydratacji. Kompletność SSR da się bramkować wyłącznie na
surowej odpowiedzi, dokładnie tak, jak ją widzi crawler. Po przywróceniu kodu:
`6 passed`.

---

## 2. Strony buildera bez `h1` (korekta 2) - inwariant zamiast zgadywania

Commit `632c526` usunął z gałęzi buildera bezwarunkowy `<h1 className="sr-only">` i wstawił
`aria-label={title}` na opakowującym `<div>`. Dwa defekty: `aria-label` na elemencie bez
roli (`role="generic"`) nie jest eksponowany przez czytniki ekranu, a strona buildera bez
własnego nagłówka została **bez żadnego `h1`**.

Wdrożone:

- `src/lib/builder/headings.ts` - `builderDocHasTopHeading(doc)`: obchód drzewa dokumentu,
  liczy nagłówek poziomu 1 tylko wtedy, gdy renderer wypisze go **bez kontekstu wpisu**
  (jawny `tag: "h1"`, `<h1>` w treści bogatej). Widgety zależne od kontekstu
  (`post-title`, `archive-title`) na stronie renderują `null`, więc nie są dowodem -
  zasada ostrożności celowo przechyla decyzję w stronę „dorysuj nagłówek".
  Modul jest bez zależności (bundel trasy publicznej).
- `src/components/pages/BuilderPageShell.tsx` - szablon strony buildera; `h1.sr-only`
  z tytułu **tylko** gdy dokument swojego nie ma, `aria-label` usunięty.
- `src/routes/$.tsx` - gałąź buildera renderuje szkielet zamiast składać `div`-a na miejscu.
- Testy: `headings.test.ts` (11 przypadków, oba kierunki + dokument uszkodzony),
  `BuilderPageShell.test.tsx` (kolejność w dokumencie, brak `aria-label`, `sr-only`),
  oraz **e2e na zaseedowanych stronach** (`supabase/seed.sql` dokłada dwie strony
  buildera: z własnym `h1` i bez) w `e2e/user-paths.spec.ts` - PL i EN.

---

## 3. Guard pól weryfikacji - rozstrzygnięcie intencji

Migracja `20260806094104` (weryfikacja po domenie e-mail) przepisała ciało
`profiles_guard_verification()` z wariantu lipcowego: dołożyła potrzebną furtkę
`app.verification_sync`, ale **zawęziła** krąg uprawnionych z `admin OR super_admin`
(stan z `20260805122338`) do samego `admin` i zgubiła `ERRCODE = '42501'`.

**Intencja rozstrzygnięta na `admin` + `super_admin`** - bo dokładnie taki krąg trzymają
wszystkie bramki-rodzeństwo, w tym wprowadzone TĄ SAMĄ migracją:

| Bramka                                             | Krąg                                  |
| -------------------------------------------------- | ------------------------------------- |
| `admin_assert_verification_admin()`                | `has_role(admin) OR is_super_admin()` |
| polityka RLS `verification domains staff read`     | `has_role(admin) OR is_super_admin()` |
| `admin_grant_profile_badge()` (odznaka `verified`) | `has_role(admin) OR is_super_admin()` |
| `profiles_guard_privileged_columns()`              | admin / super_admin / editor          |

Zawężenie było więc niezamierzoną regresją, nie decyzją produktową: `super_admin` bez
osobnej roli `admin` mógł zarządzać domenami weryfikacyjnymi i uruchamiać przegląd
zbiorczy, ale nie mógł nadać ani odebrać samej weryfikacji - w module, w którym
weryfikacja pociąga odznakę, a odznaka eksperta dożywotni VIP.

Wariant `_profiles_verification_guard_super_admin.sql` z tej sesji **nigdy nie wjechał do
żadnego środowiska i został usunięty z repo** - opisuje to sekcja „Kolizja wersji" niżej.
Żywym rozstrzygnięciem jest `20260806150000_profile_verification_authority.sql` (jeden
predykat `can_manage_profile_verification()` + rozdział własności kolumn), domknięte przez
`20260806160002_profile_verification_guard_insert_parity.sql` (parytet INSERT/UPDATE).
Różnica względem usuniętego wariantu, dla porządku:

| Aspekt              | usunięty wariant                           | stan żywy                                                            |
| ------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| krąg uprawnionych   | `has_role(admin) OR is_super_admin()`      | `can_manage_profile_verification()` - jeden predykat, cztery ścieżki |
| skalowanie tenantem | brak (`is_super_admin` ponad tenantami)    | tenant WIERSZA (`OLD`/`NEW.tenant_id` vs `current_tenant_id()`)      |
| własność kolumn     | dublowana z `privileged_columns`           | jedna kolumna = jedna bramka                                         |
| zasięg triggera     | `BEFORE INSERT OR UPDATE`, bez `OF`        | to samo (przywrócone w 20260806160000)                               |
| `ERRCODE`           | `42501`                                    | `42501` (bez zmian)                                                  |
| furtki              | `app.verification_sync`, brak `auth.uid()` | te same                                                              |

`is_super_admin()` ponad tenantami odpadło świadomie: weryfikacja nadaje odznakę, a
odznaka `expert` dożywotni VIP, więc admin (także platformowy) rozstrzyga to w SWOIM
obszarze roboczym - tak samo jak `admin_set_profile_verification()` od `20260713160000`.

### Kolizja wersji `20260806150000` - jak dwa pliki dzieliły klucz główny

Oba warianty naprawy powstały równolegle pod tym samym timestampem, a
`supabase_migrations.schema_migrations.version` to KLUCZ GŁÓWNY: `supabase db start` padał
na `duplicate key value`, więc job `pgtap` (74 pliki, w tym jedyne testy izolacji
prywatności czatu) nie dobiegał do pierwszej asercji, a `check:sql-migration-replay`
świecił czerwono. **Żadna z dwóch migracji nie została zaaplikowana w jakimkolwiek
środowisku** - dlatego usunięcie zbędnego pliku nie rozjeżdża ledgera z repo (kryterium
z `src/lib/ci/migrationReplay.ts`, inwariant 3) i jest właściwym domknięciem, a nie
łamaniem zasady forward-only.

Skutkiem ubocznym kolizji był złamany inwariant „jeden predykat": dwa pliki
przedefiniowywały `profiles_guard_verification()` w dwóch różnych kontraktach, a o żywym
stanie decydowała kolejność alfabetyczna nazw. Bramka wersji z
`check:sql-migration-replay` pilnuje KLUCZA - nie pilnuje tego, że dwie migracje z tej
samej doby opisują tę samą bramkę inaczej. To pilnuje `check:authz-snapshot` (efektywny
krąg ról odtworzony z migracji) oraz test inwariantu
`src/__tests__/profilesVerificationGuard.invariant.test.ts` - od tej sesji także w części
„zasięg triggera”, bo `20260806150000` cofnęła pokrycie INSERT nie ruszając ciała funkcji:
funkcja była bez zarzutu, więc ani snapshot, ani bramka literałów ról nie miały czego
zgłosić, a jedyny sygnał (`tgtype = 23` w pgTAP) leżał za `supabase db start`.

### pgTAP: z istnienia na zachowanie

Poprzedni plik sprawdzał wyłącznie istnienie funkcji, triggera i flagi `SECURITY DEFINER` -
i dlatego przeżył dwie zmiany semantyki bez jednego czerwonego przebiegu. Wersja końcowa
(37 asercji) sprawdza ZACHOWANIE osobno dla: zwykłego członka (twarde `42501`, nie cichy
no-op), `editora`, `admina`, `super_admina` bez roli `admin` (regres 20260806094104), obu
sankcjonowanych furtek, izolacji obszarów roboczych w triggerze ORAZ w RPC, pokrycia
INSERT i ścieżki UI przypisania firmy.

Uwaga o pułapce, w którą ten plik wpadł po drodze: dwie wersje suity zlały się w jeden
zlepek - `plan(20)` przy 33 asercjach, seed w ŚRODKU pliku (pierwsze 17 asercji
odwoływało się do fixture'ów, które jeszcze nie istniały) i dwie wzajemnie sprzeczne
asercje dla tego samego zapisu (członek: `42501` kontra `lives_ok`). pgTAP powiedziałby to
od razu - tylko że job `pgtap` padał wcześniej na kolizji wersji migracji. Stąd nowa
bramka `check:pgtap-plan`: porównuje `plan(N)` z liczbą asercji STATYCZNIE, nad całą
suitą, bez Dockera i bez bazy.

### CI: bramka, która o tym powie

`check:authz-snapshot` i `check:permissions-parity` istniały jako skrypty, ale **nie były
wpięte w CI** - dlatego rozjazd snapshotu położył suitę na `main` na cztery doby.
Oba trafiły do jobu `verify` **przed** buildem i lintem: rozjazd autoryzacji ma być widoczny
od razu, a nie po dwudziestu minutach kompilacji.

Naprawiona też diagnostyka samej bramki (`diffAuthzSnapshots`): komunikat drukował cztery
pola rolowo-tenantowe, więc przeniesienie definicji do innej migracji (zmiana `file` przy
tym samym zbiorze ról) dawało „rozjechała się: {A} vs {A}" - dowód zaprzeczający tezie.
Teraz `describeGateDelta` wypisuje **wyłącznie realnie różne pola**, z proweniencją, a lista
pól jest domknięta typem (nowe pole `RoleGateEntry` nie przejdzie bez dopisania).

### Bramka `check:sql-app-role` (w służbie powyższego)

Skanowała pliki `.ts/.tsx` **bez wycinania komentarzy**, więc od czterech dni wywalała się
na własnej dokumentacji (`src/lib/ci/authzGates.ts` cytuje wzorzec `has_role(uid, 'X')`)
i na negatywnym fixture testu parsera. Krok w CI padał przed innymi bramkami SQL. Dodany
`stripTsComments()` (obok istniejącego `stripSqlComments`) i pominięcie plików testowych;
realne wywołanie w kodzie produkcyjnym nadal jest naruszeniem - sprawdzone sondą.

---

## 4. Weryfikacja tej sesji

| Krok                                                                                 | Wynik                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `bunx tsc --noEmit`                                                                  | czysty                                                    |
| `bunx eslint` na zmienionych plikach                                                 | czysty                                                    |
| `bunx prettier --check` na zmienionych plikach                                       | czysty                                                    |
| `bun run check:authz-snapshot`                                                       | ✓ zgodny z migracjami                                     |
| `bun run check:permissions-parity`                                                   | ✓ 79 testów                                               |
| `bun run check:sql-app-role`                                                         | ✓ (przed: czerwony na własnej dokumentacji)               |
| `check:sql-tenant-scope` / `owner-tenant-scope` / `anon-insert` / `migration-replay` | ✓                                                         |
| testy jednostkowe dotkniętych obszarów                                               | ✓ (strażnik dokumentu, authz, builder, szkielet strony)   |
| `bunx playwright test e2e/ssr-completeness.spec.ts`                                  | ✓ 6/6 na czystym kodzie, 4/6 ✘ przy wstrzykniętym ucięciu |

**Nie uruchomiono lokalnie:** pgTAP (`supabase test db`) - w tym środowisku nie ma CLI
Supabase ani bazy; plik pokrywa job `pgtap` w CI. Suita seedowanych e2e wymaga lokalnego
Supabase (job `e2e-seeded`).
