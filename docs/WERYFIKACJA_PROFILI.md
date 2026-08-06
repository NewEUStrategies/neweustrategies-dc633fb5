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
Dla osób bez firmowego adresu (partnerzy, eksperci zewnętrzni): Panel → Społeczność →
Odznaki → **Przyznaj odznakę**, z obowiązkową notatką uzasadniającą (kto/na jakiej
podstawie). Takie nadania mają `grant_source = manual` i są odporne na przeglądy.

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
- Ścieżki systemowe (service_role bez `auth.uid()`) oraz `sync_org_verification` (flaga
  `app.verification_sync`) przechodzą bramkę weryfikacji bez pytania o rolę - to jedyne
  dwie furtki i obie są w kodzie triggera.
- Weryfikację nadaje się **wyłącznie w tenancie domowym wołającego**: admin tenanta A
  nie ostempluje profilu (a przez to VIP-a) w tenancie B.
- Sama deklaracja adresu nie wystarcza - liczy się `email_confirmed_at`, co blokuje
  eskalację uprawnień przez rejestrację cudzym adresem.

## Bramki, które tego pilnują
- `supabase/tests/profiles_verification_guard_test.sql` (pgTAP, 16 asercji): predykat
  dla czterech ról, nadanie przez `super_admin` **bez** osobnej roli `admin`, odmowa
  `42501` dla `editor` i członka, izolacja tenantów, self-service firmy.
- `bun run check:authz-snapshot` i `bun run check:permissions-parity` (job `verify`):
  zbiór ról każdej bramki jest odtwarzany z migracji i porównywany z artefaktem
  macierzy uprawnień - zawężenie bez regeneracji snapshotu oblewa CI, z komunikatem
  rozdzielającym zmianę uprawnień od przeniesionej definicji.
