# Proces weryfikacji profili

## Cel

Odznaka „Zweryfikowany” potwierdza, że konto należy do osoby z organizacji o zaufanej
domenie e-mail (m.in. `neweuropeanstrategies.com`, `neweustrategies.com`). Wszyscy
członkowie New European Strategies są weryfikowani automatycznie.

## Ścieżka automatyczna (domyślna)

1. Administrator dodaje domenę w Panel → Społeczność → Odznaki → **Weryfikacja domenowa**.
2. Użytkownik rejestruje się adresem w tej domenie i **potwierdza e-mail**
   (jeśli domena ma włączone „Wymagaj potwierdzenia e-mail”).
3. Trigger `profiles_org_verification_trg` uruchamia `sync_org_verification(user_id)`:
   - nadaje wpis w `profile_badges` (`badge = verified`, `grant_source = system`),
   - ustawia `profiles.verified_at`.
4. Zmiana adresu na spoza zaufanej domeny cofa **wyłącznie** nadania automatyczne
   (`grant_source = system`); nadania ręczne pozostają nietknięte.

## Ścieżka ręczna (wyjątki)

Dla osób bez firmowego adresu (partnerzy, eksperci zewnętrzni) są dwie kontrolki i
**celowo nie są tym samym**:

| Kontrolka                                                  | Co zapisuje                                                                   | Co z tego wynika                                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Panel → Użytkownicy → _(osoba)_ → **Weryfikacja zawodowa** | `profiles.verified_at` + `verified_by` (RPC `admin_set_profile_verification`) | flaga `verified` w katalogu osób (`search_people`) i filtr „tylko zweryfikowani"; `verified_by` to stempel audytowy           |
| Panel → Społeczność → Odznaki → **Przyznaj odznakę**       | wiersz w `profile_badges` (`grant_source = manual`)                           | odznaka prezentacyjna przy profilu; odznaka `expert` dodatkowo nadaje dożywotni VIP (`sync_expert_vip_grant`, 20260805201517) |

Nadanie ręczne (z obowiązkową notatką uzasadniającą: kto / na jakiej podstawie) jest
odporne na przeglądy zbiorcze: sweep cofa wyłącznie nadania automatyczne
(`grant_source = system`), a `verified_at` czyści tylko wtedy, gdy `verified_by IS NULL`

- czyli nigdy po decyzji administratora.

## Przegląd zbiorczy

Przycisk **Uruchom przegląd** wywołuje `admin_run_org_verification()` - przechodzi po
wszystkich profilach tenanta, dopina brakujące odznaki i cofa nieaktualne automatyczne.
Zwraca licznik `checked / granted / revoked`. Uruchamiaj po dodaniu nowej domeny lub
po masowym imporcie kont.

## Kto może nadawać weryfikację (autorytet)

Weryfikacja nie jest ozdobą: steruje odznaką, a odznaka `expert` nadaje **dożywotni
VIP** (`sync_expert_vip_grant`). Dlatego od migracji `20260806150000` decyzję „kto
może” podejmuje **jeden predykat**, z którego czytają wszystkie ścieżki:

| Ścieżka                                                 | Bramka                                     |
| ------------------------------------------------------- | ------------------------------------------ |
| Bezpośredni `UPDATE profiles.verified_at / verified_by` | trigger `profiles_guard_verification`      |
| RPC panelu (`admin_set_profile_verification`)           | ten sam predykat + zgodność tenanta        |
| RPC domen weryfikacji (`admin_*_verification_domain`)   | `admin_assert_verification_admin()`        |
| Odczyt `verification_domains` (RLS)                     | polityka `verification domains staff read` |

Predykat: **`can_manage_profile_verification(uuid)` → `admin` albo `super_admin`**.
`has_role()` porównuje `tenant_id` z `current_tenant_id()`, więc uprawnienie liczy się
w tenancie domowym wołającego - a sama bramka dodatkowo wymaga, żeby **tenant WIERSZA**
zgadzał się z tenantem wołającego. Inaczej admin obszaru roboczego A stemplowałby
odznakę (i dożywotniego VIP-a) w obszarze roboczym B. Rola `editor` **nie** nadaje
weryfikacji - może redagować treści, ale nie przyznawać dożywotniego dostępu płatnego
(to samo zawężenie ma `admin_grant_profile_badge`).

Świadomie NIE używamy tu `is_super_admin()`: ten predykat działa ponad tenantami, a
weryfikacja jest decyzją wewnątrz obszaru roboczego. Historia decyzji:
`docs/WDROZENIE_GUARD_WERYFIKACJI_2026-08-06.md` oraz
`docs/WDROZENIE_BRAMKA_SSR_I_GUARD_WERYFIKACJI_2026-08-06.md`.

Dlaczego jeden predykat: do `20260806150000` te same kolumny pilnowały dwie bramki o
różnych zbiorach ról (`profiles_guard_verification` = `admin`,
`profiles_guard_privileged_columns` = `admin`/`super_admin`/`editor`), a o wyniku
decydowała alfabetyczna kolejność triggerów `BEFORE`. Cichy revert wykonywał się
pierwszy i maskował twardą odmowę, więc naruszenie nie zostawiało śladu, a migracja
`20260806094104` mogła po cichu wypchnąć `super_admin` z kręgu uprawnionych (wykryte
w audycie `OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`, korekta 3).

## Własność kolumn (jedna kolumna = jedna bramka)

| Kolumna                      | Bramka                              | Reakcja na brak uprawnień                |
| ---------------------------- | ----------------------------------- | ---------------------------------------- |
| `verified_at`, `verified_by` | `profiles_guard_verification`       | `RAISE 42501` - naruszenie zostawia ślad |
| `current_company_id`         | `profiles_guard_privileged_columns` | cichy revert wartości                    |

Odmowa przy weryfikacji jest **twarda dla każdego** - także dla zwykłego członka.
Do `20260806150000` samonadanie było po cichu wycofywane przez bramkę bliźniaczą
(odpalała się alfabetycznie pierwsza), więc próba nadużycia nie zostawiała śladu nigdzie:
ani w logu, ani w danych.

Cichy revert `current_company_id` jest natomiast zamierzony: to nie ścieżka eskalacji
uprawnień, a „przypisz firmę” ma własny RPC (`link_current_company`) z jawnymi błędami
`company_not_found` / `tenant_mismatch`. Wyjątek z triggera wywalałby niepowiązane
zapisy do profilu, które przypadkiem przenoszą tę kolumnę. Wartość zapisuje **staff w
swoim tenancie** oraz **właściciel wiersza** (firma musi należeć do obszaru roboczego
wiersza) - to ścieżka UI `link_current_company` i „odłącz firmę”, która przed
`20260806150000` cofała się po cichu dla każdego nie-stafa: członek widział zielony
toast i zero zmiany w bazie.

## Bezpieczeństwo

- `verification_domains` jest RLS-owane i skalowane per tenant; zapis wyłącznie przez
  RPC SECURITY DEFINER (`admin_upsert_verification_domain`, `admin_delete_verification_domain`).
- Oba triggery są `BEFORE INSERT OR UPDATE ... FOR EACH ROW` i **bez klauzuli `OF`**,
  czyli kolejność triggerów przestała cokolwiek znaczyć (migracja `20260806160000`).
  `BEFORE UPDATE OF kolumna` odpala się według LISTY `SET` w zapytaniu, a nie według
  realnej zmiany wartości - wartość podstawiona przez wcześniejszy trigger `BEFORE`
  mijałaby taką bramkę bez śladu. Kosztu wydajności nie ma: wyjście przez
  `IS NOT DISTINCT FROM` jest pierwszą instrukcją, przed jakimkolwiek zapytaniem.
- Wiersz nie może **urodzić się** zweryfikowany ani ze wskazaniem firmy z obcego
  obszaru roboczego: polityka `"Users insert own profile"` pozwala wstawić własny wiersz,
  gdy profilu jeszcze/już nie ma (skasowany profil przy żywym koncie `auth.users`,
  nieudany provisioning), więc obie bramki obowiązują na INSERT - kontrakt z
  `20260806130000`, przywrócony w `20260806160000` po przepięciu triggerów na sam UPDATE.
- Ścieżka automatyczna nie ma sesji stafowej, więc przechodzi sankcjonowaną furtką
  `app.verification_sync = 'on'`, ustawianą lokalnie (`set_config(..., true)`) wyłącznie
  przez `sync_org_verification()`.
- **`service_role` NIE jest chroniony przed pomyłką.** Brak `auth.uid()` przechodzi
  bramkę (to nie samonadanie), a od `20260806150000` bramka bliźniacza nie pinuje już pól
  weryfikacji - `UPDATE profiles SET verified_at = ...` z klucza serwisowego **wchodzi**.
  Automaty muszą iść przez `sync_org_verification()` / `admin_run_org_verification()`,
  żeby odznaka i `profile_badges` nie rozjechały się z kolumną.
- Sama deklaracja adresu nie wystarcza - liczy się `email_confirmed_at`, co blokuje
  eskalację uprawnień przez rejestrację cudzym adresem.
- Zbiór ról bramki jest źródłem wiersza `profile_verification` w macierzy uprawnień
  (`/admin/permissions`) - snapshot autoryzacji odtwarza go ze SQL-a, a bramka CI
  `check:authz-snapshot` nie przepuści zmiany bramki bez zregenerowanego artefaktu.

## Czym to jest pilnowane

| Bramka                                                             | Co mierzy                                                                                                                                    | Bez bazy?   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `supabase/tests/profiles_verification_guard_test.sql` (37 asercji) | ZACHOWANIE: kto przechodzi, jak wygląda odmowa, izolacja obszarów roboczych, pokrycie INSERT, ścieżka firmy                                  | nie (pgTAP) |
| `src/__tests__/profilesVerificationGuard.invariant.test.ts`        | EFEKTYWNY zbiór ról (przez rozwinięcie predykatu), wiązanie tenanta, `SECURITY DEFINER` oraz ZASIĘG triggerów (`INSERT`+`UPDATE`, brak `OF`) | tak         |
| `check:authz-snapshot`                                             | snapshot `/admin/permissions` kontra bramki odtworzone z migracji, bajt w bajt                                                               | tak         |
| `check:sql-migration-replay`                                       | unikalność wersji migracji (`schema_migrations.version` to klucz główny)                                                                     | tak         |
| `check:pgtap-plan`                                                 | `plan(N)` zgodny z liczbą asercji w każdym z 73 plików suity                                                                                 | tak         |

Rozdział „bez bazy / z bazą” jest tu istotny: `20260806150000` cofnęła pokrycie INSERT
nie ruszając ciała funkcji, więc ani snapshot autoryzacji, ani bramka literałów ról nie
miały czego zgłosić - a jedyny sygnał (`tgtype` w pgTAP) leżał za `supabase db start`,
który wtedy padał na kolizji wersji migracji. Dlatego zasięg triggera ma dziś asercję
statyczną, a `plan(N)` własną bramkę.
