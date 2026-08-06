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

| Kontrolka | Co zapisuje | Co z tego wynika |
| --------- | ----------- | ---------------- |
| Panel → Użytkownicy → *(osoba)* → **Weryfikacja zawodowa** | `profiles.verified_at` + `verified_by` (RPC `admin_set_profile_verification`) | flaga `verified` w katalogu osób (`search_people`) i filtr „tylko zweryfikowani"; `verified_by` to stempel audytowy |
| Panel → Społeczność → Odznaki → **Przyznaj odznakę** | wiersz w `profile_badges` (`grant_source = manual`) | odznaka prezentacyjna przy profilu; odznaka `expert` dodatkowo nadaje dożywotni VIP (`sync_expert_vip_grant`, 20260805201517) |

Nadanie ręczne (z obowiązkową notatką uzasadniającą: kto / na jakiej podstawie) jest
odporne na przeglądy zbiorcze: sweep cofa wyłącznie nadania automatyczne
(`grant_source = system`), a `verified_at` czyści tylko wtedy, gdy `verified_by IS NULL`
- czyli nigdy po decyzji administratora.

## Kto może nadawać weryfikację
`admin` **albo** `super_admin` - jeden zbiór ról w trzech miejscach, pilnowany testami:

| Warstwa | Bramka |
| ------- | ------ |
| trigger `profiles_guard_verification_trg` na `profiles` (INSERT + UPDATE) | `has_role(admin)` OR `is_super_admin()`; odmowa = `42501` |
| RPC panelu `admin_set_profile_verification` | ten sam zbiór + skalowanie tenantem wołającego |
| polityka RLS `"Admins can update tenant profiles"` | `admin` OR `super_admin` w tenancie domowym |

`editor` przechodzi bliźniaczy `profiles_guard_privileged_columns`, ale **nie** bramkę
weryfikacji - to zawężenie jest zamierzone i identyczne z `admin_grant_profile_badge`.
Historia decyzji: `docs/WDROZENIE_GUARD_WERYFIKACJI_2026-08-06.md`.

## Przegląd zbiorczy
Przycisk **Uruchom przegląd** wywołuje `admin_run_org_verification()` - przechodzi po
wszystkich profilach tenanta, dopina brakujące odznaki i cofa nieaktualne automatyczne.
Zwraca licznik `checked / granted / revoked`. Uruchamiaj po dodaniu nowej domeny lub
po masowym imporcie kont.

## Kto może nadawać weryfikację (autorytet)

Weryfikacja nie jest ozdobą: steruje odznaką, a odznaka `expert` nadaje **dożywotni
VIP** (`sync_expert_vip_grant`). Dlatego od migracji `20260806150000` decyzję „kto
może” podejmuje **jeden predykat**, z którego czytają wszystkie ścieżki:

| Ścieżka | Bramka |
| ------- | ------ |
| Bezpośredni `UPDATE profiles.verified_at / verified_by` | trigger `profiles_guard_verification` |
| RPC panelu (`admin_set_profile_verification`) | ten sam predykat + zgodność tenanta |
| RPC domen weryfikacji (`admin_*_verification_domain`) | `admin_assert_verification_admin()` |
| Odczyt `verification_domains` (RLS) | polityka `verification domains staff read` |

Predykat: **`can_manage_profile_verification(uuid)` → `admin` albo `super_admin`**,
zawsze w tenancie domowym wołającego (`has_role` porównuje `tenant_id` z
`current_tenant_id()`). Rola `editor` **nie** nadaje weryfikacji - może redagować
treści, ale nie przyznawać dożywotniego dostępu płatnego.

Dlaczego jeden predykat: do `20260806150000` te same kolumny pilnowały dwie bramki o
różnych zbiorach ról (`profiles_guard_verification` = `admin`,
`profiles_guard_privileged_columns` = `admin`/`super_admin`/`editor`), a o wyniku
decydowała alfabetyczna kolejność triggerów `BEFORE`. Cichy revert wykonywał się
pierwszy i maskował twardą odmowę, więc naruszenie nie zostawiało śladu, a migracja
`20260806094104` mogła po cichu wypchnąć `super_admin` z kręgu uprawnionych (wykryte
w audycie `OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`, korekta 3).

## Własność kolumn (jedna kolumna = jedna bramka)

| Kolumna | Bramka | Reakcja na brak uprawnień |
| ------- | ------ | ------------------------- |
| `verified_at`, `verified_by` | `profiles_guard_verification` | `RAISE 42501` - naruszenie zostawia ślad |
| `current_company_id` | `profiles_guard_privileged_columns` | cichy revert wartości |

`current_company_id` zapisuje **staff w swoim tenancie** oraz **właściciel wiersza**
(firma musi należeć do jego tenanta) - to ścieżka UI `link_current_company` i „odłącz
firmę”, która przed `20260806150000` cofała się po cichu dla każdego nie-stafa: członek
widział zielony toast i zero zmiany w bazie.

## Bezpieczeństwo
- `verification_domains` jest RLS-owane i skalowane per tenant; zapis wyłącznie przez
  RPC SECURITY DEFINER (`admin_upsert_verification_domain`, `admin_delete_verification_domain`).
- Pola weryfikacji chronią DWA triggery BEFORE na `profiles` i kolejność ma znaczenie
  (triggery odpalają się alfabetycznie po nazwie):
  1. `profiles_guard_privileged_columns_trg` - dla nie-stafu **po cichu wycofuje**
     `verified_at`/`verified_by`/`current_company_id` (brak wyjątku, brak efektu);
  2. `profiles_guard_verification_trg` - **odmawia twardo** (`42501`) temu, kto pola
     realnie zmienia, a nie jest `admin`/`super_admin`.
  Dlatego zwykły użytkownik nie widzi błędu (zmiana wyparowuje), a `editor` - który
  przechodzi pierwszy trigger - dostaje `42501` z drugiego.
- Ścieżka automatyczna nie ma sesji stafowej, więc przechodzi sankcjonowaną furtką
  `app.verification_sync = 'on'`, ustawianą lokalnie (`set_config(..., true)`) wyłącznie
  przez `sync_org_verification()`. Wnioski praktyczne: **`service_role` też podlega
  triggerom** - `UPDATE profiles SET verified_at = ...` z klucza serwisowego bez tej
  flagi zostanie po cichu wycofany, więc automaty muszą iść przez
  `sync_org_verification()` / `admin_run_org_verification()`.
- Wiersz nie może **urodzić się** zweryfikowany: bramka obowiązuje także na INSERT
  (polityka `"Users insert own profile"` pozwala wstawić własny wiersz, gdy profilu
  jeszcze/już nie ma - migracja 20260806130000).
- Sama deklaracja adresu nie wystarcza - liczy się `email_confirmed_at`, co blokuje
  eskalację uprawnień przez rejestrację cudzym adresem.
- Zbiór ról bramki jest źródłem wiersza `profile_verification` w macierzy uprawnień
  (`/admin/permissions`) - snapshot autoryzacji odtwarza go ze SQL-a, a bramka CI
  `check:authz-snapshot` nie przepuści zmiany bramki bez zregenerowanego artefaktu.
