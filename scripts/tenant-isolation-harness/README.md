# tenant-isolation-harness

Wykonawcza (nie statyczna) bramka izolacji obszarow roboczych dla plaszczyzny
wlasciciela: `media_mentions`, `saved_searches`, `user_follows`.

## Po co

Audyt 2026-08-29 pokazal, ze polityki wlascicielskie tych tabel bramkowaly
wylacznie `user_id = auth.uid()`, mimo ze kazda z nich ma NOT NULL `tenant_id`.
Skutek: wiersz zalozony w jednym obszarze roboczym byl czytelny i edytowalny
z innego (dryf profilu), a `WITH CHECK` pozwalal ZAPISAC wiersz do cudzego
obszaru. Naprawa: migracja `20260829091010`.

## Co robi

1. `harness.sql` - minimalna atrapa platformy (auth.users, tenants, profiles,
   `auth.uid()`, `current_tenant_id()`, `public_tenant_id()`, `has_role()`)
   plus trzy tabele i polityki w stanie SPRZED naprawy.
2. `run.sh` - aplikuje PRAWDZIWE migracje polityk z `supabase/migrations`
   (dobor po tresci, nie po nazwie pliku).
3. `runtime_test.sql` - asercje na zywej bazie z wlaczonym RLS i rola
   `authenticated`: brak odczytu, zmiany i kasowania wierszy z obcego obszaru,
   odrzucenie zapisu do obcego obszaru, poprawny obszar domyslny.

## Uruchomienie

```bash
bun run check:tenant-isolation      # albo: bash scripts/tenant-isolation-harness/run.sh
bash scripts/tenant-isolation-harness/run.sh --keep   # zostawia baze do debugu
```

## Czego NIE sprawdza

Nie zastepuje statycznej bramki `src/lib/ci/__tests__/tenantIsolationPolicies.test.ts`
(stan koncowy polityk we WSZYSTKICH migracjach) ani `check:sql-owner-tenant-scope`.
Atrapa odtwarza tylko otoczenie potrzebne do wykonania tych trzech polityk.
