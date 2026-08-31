# tenant-isolation-harness

Wykonawcza (nie statyczna) bramka izolacji obszarow roboczych dla plaszczyzny
wlasciciela: `media_mentions`, `saved_searches`, `user_follows` oraz - od
2026-08-31 - `subscriptions`, `membership_grants`, `organization_seats`,
`user_purchases`, `user_subscriptions`, `post_gift_links`.

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

## Rozszerzenie 2026-08-31 (moduly monetyzacji)

Przeglad polityk modulow 13 (checkout/subskrypcje/billing) i 14 (kupony/
darowizny/prezenty/reklamy) wykazal SZESC dalszych wystapien tego samego
wzorca; domkniete migracja `20260831060000`. Wszystkie sa na kolumnie SELECT,
wiec przeciekal ODCZYT: historia zakupow, subskrypcji, przydzialow czlonkostwa,
miejsc w organizacji i linkow prezentowych byla widoczna dla wlasciciela takze
spoza obszaru, w ktorym powstala.

Dlaczego statyczna bramka `check:sql-owner-tenant-scope` ich nie widziala:
jest SAMOKALIBRUJACA - zapala sie, gdy na tej samej tabeli jedna klauzula
WLASCICIELSKA wiaze tenanta, a inna go gubi. Kazda z tych szesciu tabel ma
dokladnie JEDNA polityke wlascicielska, a tenanta pilnuje polityka
ADMINISTRACYJNA - nie ma wiec rodzenstwa deklarujacego intencje. Ta klasa luki
jest poza zasiegiem tamtej bramki z konstrukcji i wymaga dowodu wykonawczego.

`post_gift_links` dokladalo drugi powod niewidocznosci: wlascicielem jest tam
`created_by`, a nie `user_id`.

## Uruchomienie

```bash
bun run check:tenant-isolation      # albo: bash scripts/tenant-isolation-harness/run.sh
bash scripts/tenant-isolation-harness/run.sh --keep   # zostawia baze do debugu
```

## Czego NIE sprawdza

Nie zastepuje statycznej bramki `src/lib/ci/__tests__/tenantIsolationPolicies.test.ts`
(stan koncowy polityk we WSZYSTKICH migracjach) ani `check:sql-owner-tenant-scope`.
Atrapa odtwarza tylko otoczenie potrzebne do wykonania tych trzech polityk.
