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

## Kto może nadać i odebrać weryfikację

Weryfikacja nie jest kosmetyką: steruje odznaką `verified`, a odznaka eksperta pociąga
dożywotni dostęp VIP (`sync_expert_vip_grant`). Krąg uprawnionych jest więc jeden dla
**całego** modułu - bramka triggera, RPC ręcznej ścieżki, RPC odznak i polityki RLS
domen weryfikacyjnych rozstrzygają identycznie:

| Kto                                            | `profiles.verified_at` / `verified_by` | Mechanizm                                                                                       |
| ---------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `admin` (tenant)                               | ✅ nadaje i odbiera                    | `has_role(uid, 'admin')`                                                                        |
| `super_admin` (także bez osobnej roli `admin`) | ✅ nadaje i odbiera                    | `is_super_admin(uid)` - świadomie ponad tenantami                                               |
| `editor`                                       | ❌ **błąd 42501**                      | przechodzi `profiles_guard_privileged_columns()`, odbija się od `profiles_guard_verification()` |
| zwykły użytkownik                              | ❌ bez skutku, bez błędu               | `profiles_guard_privileged_columns()` cicho przywraca stare wartości                            |
| `service_role` / wewnętrzne SECURITY DEFINER   | ✅                                     | brak `auth.uid()`                                                                               |
| synchronizacja domenowa                        | ✅                                     | flaga transakcyjna `app.verification_sync = 'on'`                                               |

Odmowa ma zawsze kod **42501** (`insufficient_privilege`) - klient rozpoznaje ją po kodzie,
nie po treści komunikatu. Zawężenie kręgu do samego `admin` (migracja `20260806094104`)
było regresją: odcięło `super_admina` od modułu, którym sterują wszystkie pozostałe bramki
tego obszaru. Przywraca to `20260806150000_profiles_verification_guard_super_admin.sql`.

Egzekwowanie (blokujące):

- pgTAP `supabase/tests/profiles_verification_guard_test.sql` - zachowanie osobno dla
  każdej roli, dla flagi synchronizacji i dla RPC,
- `bun run check:authz-snapshot` + `bun run check:permissions-parity` w jobie `verify`
  (CI) - każda zmiana kręgu uprawnionych w SQL-u musi trafić do snapshotu i do macierzy
  `/admin/permissions`, inaczej PR nie przechodzi.

## Bezpieczeństwo

- `verification_domains` jest RLS-owane i skalowane per tenant; zapis wyłącznie przez
  RPC SECURITY DEFINER (`admin_upsert_verification_domain`, `admin_delete_verification_domain`).
- `profiles.verified_at` i kolumny uprzywilejowane chronią DWA triggery BEFORE UPDATE
  (kolejność alfabetyczna): `profiles_guard_privileged_columns()` cicho cofa wartości
  nie-staffowi, `profiles_guard_verification()` rzuca 42501 staffowi bez prawa do
  weryfikacji. Zapis automatyczny przechodzi tylko z flagą `app.verification_sync`
  ustawianą przez funkcję synchronizującą.
- Sama deklaracja adresu nie wystarcza - liczy się `email_confirmed_at`, co blokuje
  eskalację uprawnień przez rejestrację cudzym adresem.
