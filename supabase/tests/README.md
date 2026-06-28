# Testy bazy danych (pgTAP)

Testy SQL warstwy danych Supabase — RLS (izolacja tenantów), przypięcie
`profiles.tenant_id` oraz pełnotekstowe wyszukiwanie. Dopełniają testy
jednostkowe Vitest (`bun run test`), które nie dotykają realnego Postgresa
ani polityk RLS.

## Pliki

| Plik | Co weryfikuje |
| --- | --- |
| `rls_tenant_isolation_test.sql` | „user tenanta A nie czyta postów B" (RLS na `public.posts`, szkice i opublikowane) oraz „UPDATE `tenant_id` jest ignorowany" (trigger `profiles_pin_tenant`). |
| `search_tsquery_test.sql` | `public.nes_search_tsquery` — unaccent + lower, prefiks `:*`, łączenie AND, sanityzacja znaków, puste/NULL → `NULL`. |
| `search_posts_smoke_test.sql` | Smoke RPC `public.search_posts`: zwraca tylko opublikowane, nieusunięte posty tenanta publicznego; pomija szkice, usunięte i obcych tenantów. |

## Uruchamianie

Kanonicznie — przez Supabase CLI, które stawia świeżą bazę, nakłada wszystkie
migracje z `supabase/migrations/` i odpala pliki przez `pg_prove`:

```bash
supabase test db          # albo: bun run db:test
```

Wymagane jest rozszerzenie pgTAP w lokalnej bazie testowej (jednorazowo):

```sql
create extension if not exists pgtap with schema extensions;
```

### Konwencje

- Każdy plik jest samowystarczalny: `begin; select plan(N); … select * from finish(); rollback;`.
  `ROLLBACK` na końcu nie zostawia żadnych danych — testy nie zależą od kolejności.
- Wcielanie się w użytkownika (RLS): `set local role authenticated|anon` +
  `set_config('request.jwt.claims', '{"sub":"…","role":"…"}', true)`; `auth.uid()`
  czyta `sub` z claims. Rolę zdejmujemy przez `reset role`.
- Seed nadaje `tenant_id`/role jawnie i wyłącza triggery rejestracji
  (`alter table auth.users disable trigger user`), żeby nie polegać na
  auto-provisioningu.

## Uwaga: środowisko bez Supabase CLI

`supabase test db` wymaga lokalnego stacka Supabase (Docker). W środowiskach bez
CLI te same pliki uruchomisz przez `pg_prove` na dowolnym Postgresie, który ma
nałożone migracje oraz schematy/role platformy Supabase (`auth.uid()`,
`auth.users`, role `anon`/`authenticated`/`service_role`, `storage.*`):

```bash
pg_prove -d "$DATABASE_URL" supabase/tests/*.sql
```
