# Wzmocnienie szwów po PR #482 - raport (2026-10-07)

PR #483. Źródło: audyt całej platformy po PR #482 (8 niezależnych przeglądów
szwów, każdy z adwersarialną weryfikacją; 93 ustalenia potwierdzone lub
częściowo potwierdzone, 0 odrzuconych) oraz `plpgsql_check` uruchomiony na
katalogu po wszystkich migracjach. Każda poprawka ma test, który oblewa się
na starej wersji (sprawdzone mutacją).

## 1. Co naprawiono

| #   | Defekt                                                                                                                                                       | Skutek przed poprawką                                                                                                                                      | Poprawka                                                                                                                                  | Dowód                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | Kolejki poczty (`enqueue_email`, `read_email_batch`, `delete_email`, `move_to_dlq`) wykonywalne dla `anon`/`authenticated`                                   | odczyt linków resetu hasła i magic linków z `auth_emails` (przejęcie konta), dowolna poczta z adresu platformy                                             | EXECUTE tylko `service_role` (`20261007140000`)                                                                                           | `email_queue_grants_test` (12)                        |
| 2   | 42 funkcje SECURITY DEFINER bez żadnej ścieżki klienta, a z EXECUTE dla klienta                                                                              | zbędna powierzchnia (m.in. `crm_get_merydian_secrets`, `org_reconcile_seats`)                                                                              | EXECUTE tylko `service_role` (`20261007140100`)                                                                                           | `definer_client_exec_inventory_test` (84)             |
| 3   | `release_b2b_coupon` bez sprawdzenia właściciela i statusu zamówienia                                                                                        | jednorazowy kod używany bez końca (reset limitu po opłaceniu)                                                                                              | `release_b2b_coupon_for_user` tylko z serwera, tylko nieopłacone zamówienie tego konta (`20261007140200`)                                 | `coupon_release_test` (14)                            |
| 4   | `subscriptions.tenant_id DEFAULT public_tenant_id()` przy zapisie webhookiem (service role, bez hosta)                                                       | subskrypcje lądowały w najemcy domyślnym                                                                                                                   | wyzwalacz przypina najemcę profilu właściciela + backfill (`20261007140300`)                                                              | `subscriptions_tenant_pin_test` (5)                   |
| 5   | `deleteUserAccount` / `startImpersonation` bez rangi celu                                                                                                    | admin najemcy usuwał konto super_admina; podszycie pod super_admina omijało jego TOTP                                                                      | odmowa (`ADMIN_ACCOUNT/SUPER_ADMIN_REQUIRED`, `Forbidden: cannot impersonate a super_admin`)                                              | vitest, mutacja oblewa 5 asercji                      |
| 6   | Kody dostępu do wejściówek: `event_ticket_checkout_quote` bez licznika, `event_register` z licznikiem cofanym przez wyjątek i kluczowanym e-mailem z ładunku | zgadywanie kodów prasy/partnerów bez limitu                                                                                                                | kubełek biletu (60/10 min) + konta i adresu, pudło zwracane wartością; wycena tylko z serwera (`20261007140400`)                          | `ticket_access_code_probe_test` (26)                  |
| 7   | `resolveStripeDiscount` - publiczny server fn bez wywołań w UI                                                                                               | sonda kodów najemcy domyślnego bez kubełka w bazie, zakładanie rabatów u operatora                                                                         | usunięty wraz z `discounts.server.ts`                                                                                                     | vitest                                                |
| 8   | `crm_upsert_lead_from_profile` dla każdego zalogowanego; `crm_backfill_all_leads` po wszystkich najemcach; `linkJoinUsAndBackfill` z e-mailem z ładunku      | przetwarzanie cudzych profili w CRM, zapis do CRM-u innych najemców, przepinanie cudzej subskrypcji                                                        | grant tylko `service_role`, backfill w najemcy wołającego, wiązanie po adresie z sesji i tylko wierszy bez właściciela (`20261007140500`) | `crm_newsletter_writers_bound_test` (12)              |
| 9   | `accept_my_user_invitation` (INVOKER) czytała `profiles.email` bez prawa                                                                                     | **każde** przyjęcie zaproszenia padało (`permission denied`, połykane w `useAuth`)                                                                         | SECURITY DEFINER związana z wołającym w ciele                                                                                             | jw.                                                   |
| 10  | IPv6 bez agregacji                                                                                                                                           | host z pulą /64 dostawał nowy kubełek na każde żądanie                                                                                                     | `ipRateKey`: IPv6 -> /64 w jedynym podmiocie limitu (`rateLimitIpSubject`)                                                                | vitest                                                |
| 11  | 9 funkcji PL/pgSQL, które padały przy KAŻDYM wykonaniu                                                                                                       | synchronizacja miejsc Team, hasła treści, CRM zgłoszeń do klubu, panel uprawnień widowni, „Moje pakiety", widownia akademicka, powiadomienia obserwujących | `20261007140600`, `140700`, `140710`; hasła treści przy okazji zawężone do najemcy                                                        | `sql_runtime_errors_test` (14) WYWOŁUJE każdą ścieżkę |
| 12  | Brak bramki na martwe odwołania w PL/pgSQL                                                                                                                   | klasa z punktu 11 wracałaby bez sygnału                                                                                                                    | `plpgsql_check_gate_test`: zero błędów w funkcjach i wyzwalaczach `public`                                                                | mutacja oblewa 3 asercje                              |
| 13  | `rate_limits` nigdy nie czyszczona                                                                                                                           | nieograniczony przyrost (podmioty wybiera wołający)                                                                                                        | `rate_limits_prune` + pg_cron co godzinę (`20261007140800`)                                                                               | `rate_limits_retention_test` (7)                      |
| 14  | Parytet snapshotu autoryzacji oblewał każdą migrację (`stats`)                                                                                               | czerwone CI bez zmiany uprawnień                                                                                                                           | `stats` poza parytetem; zmiany ról/flag dalej oblewają                                                                                    | vitest                                                |

## 2. Kolejność wdrożenia (panel Lovable)

| Migracja                                                 | Kolejność             | Uwagi                                              |
| -------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| `20261007140000_email_queue_service_only`                | **najpierw, od razu** | wszyscy wołający używają klucza serwisowego        |
| `20261007140100_definer_functions_without_client_path`   | dowolna               |                                                    |
| `20261007140200_release_coupon_server_only`              | **najpierw kod**      | kod wraca do starej funkcji przy PGRST202/42883    |
| `20261007140300_subscriptions_tenant_from_owner`         | dowolna               | zawiera backfill - najpierw zapytanie z sekcji 3.2 |
| `20261007140400_ticket_access_code_probe`                | **najpierw kod**      | formularz zapisu rozumie oba kształty pudła        |
| `20261007140500_crm_newsletter_writers_bound`            | dowolna               |                                                    |
| `20261007140600_event_functions_runtime_errors`          | dowolna               |                                                    |
| `20261007140700_runtime_errors_seats_workflow_passwords` | dowolna               |                                                    |
| `20261007140710_club_application_crm_sync_overload`      | dowolna               |                                                    |
| `20261007140800_rate_limits_retention`                   | dowolna               | pg_cron, minuta 29                                 |

## 3. Działania właściciela (poza repozytorium)

1. **Kolejka poczty na produkcji.** Sprawdzić
   `has_function_privilege('anon', 'public.read_email_batch(text,integer,integer)', 'EXECUTE')`
   (i dla pozostałych trzech), logi `rpc/read_email_batch` i `read_ct` w pgmq.
   Jeśli było użycie - unieważnić sesje. `email_queue_dispatch` występuje tylko
   w `types.ts`, bez migracji - sprawdzić, czy istnieje na produkcji.
2. **Subskrypcje w złym najemcy.** Przed `140300`:
   `SELECT count(*) FROM subscriptions s JOIN profiles p ON p.id = s.user_id WHERE s.tenant_id IS DISTINCT FROM p.tenant_id;`
   i kopia tabeli.
3. **Ochrona `main`.** Ruleset / merge queue; edytor Lovable na osobnej gałęzi
   (dziś większość przebiegów CI na `main` to bezpośrednie pushe edytora).
4. **Prawda o produkcji.** Rola tylko do odczytu w chronionym Environment
   i odcisk katalogu (sygnatury, md5 ciał, ACL, polityki) porównywany z CI po
   każdej publikacji; SHA builda w `/api/public/version`.
5. **Deny-by-default.** Decyzja o
   `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;`
   (dotyczy tylko nowych obiektów) + zatwierdzony snapshot ACL w pgTAP.
6. **aal2 w SQL.** Drugi składnik dla 287 RPC `admin_*` egzekwowany dziś
   wyłącznie w TS.
7. **pgcrypto.** Potwierdzić schemat rozszerzenia na produkcji (poprawki haseł
   treści działają w `extensions` i w `public`).

## 4. Co zostaje (mapa z audytu)

- Zapis na wydarzenie bez konta nie ma kubełka ADRESU (baza nie zna zaufanego
  adresu klienta) - pełne domknięcie wymaga zapisu przez funkcję serwerową.
- Okna limitów są stałe (podwójny wybuch na granicy okna) - kubełek przesuwny
  w `rate_limit_hit`.
- Kontrakt TS <-> SQL v2: markowane typy klientów (`ServiceClient`,
  `UserClient`, `AnonClient`) zamiast zgadywania roli po nazwach zmiennych
  (dziś `unknown` przy ok. 9% wywołań RPC), rola `anon`, asercje RLS
  i `tenant_id` w zapisach rolą serwisową.
- Testy integracyjne płatności, miejsc i zaproszeń na prawdziwej bazie
  (`e2e-seeded`).
- Polityki zapisu bez przypięcia najemcy (3, m.in. `qa_sessions`), ścieżka
  obiektu storage ufająca wartości z bazy.
