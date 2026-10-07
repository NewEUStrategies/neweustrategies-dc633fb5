# Szew TypeScript ⇄ SQL: sprawdzany kontrakt i naprawy (2026-10-07)

## Diagnoza

Najpoważniejsze defekty ostatnich wydań leżały na szwach, których żadna warstwa
nie widziała w całości: TypeScript ⇄ SQL, rola serwisowa ⇄ RLS, edytor ⇄ CI.
Testy Vitest zastępują bazę atrapą (przyjmuje każdy cel `onConflict`, każdą
wartość i każde uprawnienie), pgTAP widzi bazę, ale nie wywołania z TS, a bramka
`check:rpc-contract` sprawdza tylko istnienie funkcji. Stąd 98,84% pokrycia przy
działającej regresji.

## Kontrakt (nowy)

`src/lib/ci/tsSqlContract.ts` czyta kod produkcyjny `src/**` (drzewo składniowe
TS) i generuje `supabase/tests/ts_sql_contract_test.sql`, który job `pgtap`
uruchamia na bazie po WSZYSTKICH migracjach. Dziewięć asercji, każda zwraca listę
naruszeń z plikiem TS:

| #   | Sprawdza                                                                       | Klasa defektu                       |
| --- | ------------------------------------------------------------------------------ | ----------------------------------- |
| 1   | `.rpc()`: przeciążenie dla podanych kluczy                                     | PGRST202                            |
| 2   | `.rpc()`: EXECUTE dla roli klienta                                             | 42501 przy każdym kliknięciu        |
| 3   | RPC wołane z TS tylko rolą serwisową: bez EXECUTE dla `anon`/`authenticated`   | GRANT szerszy niż kod (N-13-1)      |
| 4   | `.from()`: relacja i kolumny istnieją                                          | PGRST205 / 42703                    |
| 5   | `.from()`: uprawnienie kolumnowe do operacji (`select("*")` = każda kolumna)   | 42501                               |
| 6   | literał zapisywany z TS przechodzi typ i CHECK kolumny                         | 23514 (klasa N-16-1)                |
| 7   | cel `onConflict` ma unikalny klucz dokładnie na tych kolumnach                 | 42P10 (N-19-1)                      |
| 8   | grant SELECT dla klienta = stała TS kolumn publicznych                         | kolumna prywatna dla anona (D-14-3) |
| 9   | SECURITY DEFINER dla klienta nie bierze tożsamości z jsonb bez bramki redakcji | `company_id` z ładunku              |

Plik nie jest w repozytorium (`.gitignore`) - powstaje z bieżącego kodu w CI
i w `bun run test:pgtap-local`, więc edytor nie może go zestarzeć. Bez bazy
`bun run check:ts-sql-contract` (job `verify`, `verify:static`) pilnuje zasięgu
ekstrakcji. Wyjątki są jawne i mogą tylko maleć: `PAYLOAD_IDENTITY_REVIEWED` (2),
`SERVER_ONLY_RPC_REVIEWED` (0), zapadka `MAX_UNRESOLVED_SITES` (13).

Dowód skuteczności (mutacje na pełnym schemacie, każda złapana z plikiem TS):
GRANT SELECT `ad_slots` dla `anon`, stara definicja zakupu pakietu z
`company_id`, odebrany DELETE na `conversations`, EXECUTE `join_us_link_and_backfill`
dla `authenticated`, usunięty indeks `user_roles_unique_per_tenant`, cel
`onConflict: "user_id,role"` w TS, CHECK zawężony pod literał zapisywany z TS.

## Naprawy

| Defekt                                                                                                                                                                      | Naprawa                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onConflict: "user_id,role"` (N-19-1)                                                                                                                                       | już naprawione wcześniej; kontrakt (asercja 7) pilnuje regresji na prawdziwym kluczu                                                                                    |
| `club_updated` poza CHECK (N-16-1)                                                                                                                                          | już naprawione (20261004090000); pisarze SQL: `check_whitelist_writers_test.sql`, pisarze TS: asercja 6                                                                 |
| `validate_b2b_coupon`/`redeem_b2b_coupon` dla `authenticated` (N-13-1, D-13-1)                                                                                              | `20261007120200`: funkcje `*_for_user` tylko dla `service_role`, kubełek pudeł także po adresie (120/10 min)                                                            |
| `ad_slots.notes` czytelne dla `anon` (D-14-3)                                                                                                                               | `20261007120100`: SELECT kolumnowy bez `notes`, `admin_list_ad_slots()` dla redakcji                                                                                    |
| `company_id` z ładunku `event_package_purchase`                                                                                                                             | `20261007120000`: klucz w ładunku to `forbidden_field`; firmę ustala organizator (most faktur)                                                                          |
| „Uruchom przypomnienia" / „Wyczyść wygasłe" zawsze 42501 (R-N-PRZYPOMNIENIA-s2)                                                                                             | funkcje serwerowe za `requireAdmin` (`communityJobs.functions.ts`)                                                                                                      |
| „Usuń konwersację" zawsze 42501                                                                                                                                             | `20261007120300`: GRANT DELETE (zakres wyznacza istniejąca polityka redakcji)                                                                                           |
| `join_us_link_and_backfill` dla `authenticated` (przepięcie cudzej subskrypcji)                                                                                             | `20261007120300`: tylko `service_role`                                                                                                                                  |
| `enforce_form_field_policy` dla `PUBLIC`/`anon`                                                                                                                             | `20261007120300`: tylko `service_role`                                                                                                                                  |
| `verify_content_password` dla `anon` (limit adresu do obejścia) i najemca domyślny pod rolą serwisową                                                                       | `20261007120400`: `verify_content_password_for_tenant` tylko dla `service_role`, najemca z hosta                                                                        |
| `org_apply_subscription_seats` (bez bramki) i 10-arg. `crm_upsert_from_form` wykonywalne dla `anon`                                                                         | `20261007120500`: tylko `service_role`; `career_cv_gc_*` - `20261007120510` - domyślne EXECUTE platformy na funkcje                                                     |
| kody WYDARZEŃ (`validate_event_ticket_coupon`, `event_admission_quote`, `event_package_purchase`) dla `authenticated` - farma kont za jednym adresem omijała kubełek adresu | `20261007120600`: wersje `*_for_user` tylko dla `service_role`, pudła w kubełku konta I adresu; ekran zakupu pakietu przez funkcje serwerowe (`admission.functions.ts`) |
| „Wyślij aktywację" czytało `profiles.email` klientem admina (42501)                                                                                                         | `admin_get_user` (bramka redakcji, bez roli serwisowej)                                                                                                                 |
| karta CRM: `profile_skills.name/endorsements_count`, `profile_awards.issued_on` (42703)                                                                                     | aliasy PostgREST `name:label`, `issued_on:awarded_at`                                                                                                                   |
| martwy zapis `subscriptions.quantity` klientem bez UPDATE                                                                                                                   | usunięty - lustro uzupełnia webhook operatora                                                                                                                           |
| typecheck CI: `tsgo` bez zależności (commit edytora 35184a8)                                                                                                                | `@typescript/native-preview` 7.0.0-dev.20260707.2 w `devDependencies`                                                                                                   |

## Kolejność wdrożenia migracji (panel Lovable)

| Migracja                                                      | Kolejność                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| `20261007120000_event_package_order_company_not_from_payload` | dowolna                                                     |
| `20261007120100_ad_slots_private_notes`                       | dowolna (panel slotów wraca do `select("*")` przy PGRST202) |
| `20261007120200_plan_coupon_server_only`                      | NAJPIERW KOD (fallback na stare RPC przy PGRST202)          |
| `20261007120300_client_grants_follow_ts_callers`              | dowolna                                                     |
| `20261007120400_content_password_explicit_tenant`             | NAJPIERW KOD (fallback na stare RPC przy PGRST202)          |
| `20261007120500_service_only_rpc_default_execute`             | dowolna (kod już woła te funkcje rolą serwisową)            |
| `20261007120510_career_cv_gc_service_only`                    | dowolna (job retencji woła rolą serwisową)                  |
| `20261007120600_event_codes_server_only`                      | NAJPIERW KOD (fallback na stare RPC przy PGRST202)          |

Runner `bun run test:pgtap-local` odtwarza domyślne EXECUTE platformy na NOWE
funkcje (jak baza stawiana w CI przez `supabase db start`); tabel i sekwencji
platforma domyślnie nie nadaje, więc runner ich nie emuluje. Bez tej linii
funkcja zamknięta tylko `REVOKE ... FROM PUBLIC` wyglądała lokalnie na
niedostępną dla `anon` - tak ukrywały się luki z `20261007120500`
i `20261007120510`.

Okno wdrożenia rozpoznaje jeden pomocnik `src/lib/supabase/migrationPending.ts`
(PGRST202 / 42883) - wcześniej trzy prywatne kopie w module wydarzeń.

## Kody wydarzeń: kubełek adresu (20261007120600)

Walidacja kodu na bilet, wycena wejściówki/pakietu i zakup pakietu były
wykonywalne dla `authenticated` z kubełkiem pudeł tylko po KONCIE (30 / 10 min),
a ekran zakupu wołał wycenę i zakup wprost z przeglądarki. Limit po adresie żył
w TS, więc farma kont za jednym adresem zgadywała kody wydarzeń bez sufitu.

- Baza: `validate_event_ticket_coupon_for_user`, `event_admission_quote_for_user`
  i `event_package_purchase_for_user` (`_tenant_id`, `_user_id`,
  `_probe_subject`, ...) tylko dla `service_role`; pudła liczą
  `_coupon_probe_guard/_miss(uuid, text)` w kubełku konta i adresu - tym samym
  kubełku adresu co kody planu (120 / 10 min). Stare sygnatury zostają cienkimi
  wrapperami tylko dla `service_role`.
- Wycena zależy od łańcucha funkcji kwalifikacji czytających `auth.uid()`
  (`_caller_tenant`, `has_tier_rank`, `event_audience_qualifies`), więc wersja
  serwerowa ustawia tożsamość wołającego na czas wywołania
  (`_set_request_identity`, te same `request.jwt.claim*` co PostgREST) i po
  powrocie ją odtwarza - jedna reguła kwalifikacji zamiast drugiej kopii.
- Kod: `couponRpc.server.ts` (`validateEventTicketCouponForUser`, kasa i podgląd
  wejściówki), `admissionRpc.server.ts` + `admission.functions.ts` (wycena
  i zakup pakietu przez funkcje serwerowe POST); `admissionApi.ts` mapuje
  odmowy i błędy tym samym słownikiem co dotąd.
- Dowód: `event_code_guessing_test.sql` - pięć kont za jednym adresem, po 24
  pudła (pod limitem konta) przez walidację, wycenę i zakup; szóste, świeże
  konto dostaje `rate_limited` przy pierwszej próbie na każdej z trzech ścieżek,
  a to samo konto z innego adresu dostaje wycenę z rabatem.
