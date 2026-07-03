# Testy bazy danych (pgTAP)

Testy SQL warstwy danych Supabase — RLS (izolacja tenantów), przypięcie
`profiles.tenant_id` oraz pełnotekstowe wyszukiwanie. Dopełniają testy
jednostkowe Vitest (`bun run test`), które nie dotykają realnego Postgresa
ani polityk RLS.

## Pliki

| Plik | Co weryfikuje |
| --- | --- |
| `rls_tenant_isolation_test.sql` | „user tenanta A nie czyta postów B" (RLS na `public.posts`, szkice i opublikowane) oraz „UPDATE `tenant_id` jest ignorowany" (trigger `profiles_pin_tenant`). |
| `host_tenant_resolution_test.sql` | Host-aware płaszczyzna anon: `request_public_host()` (normalizacja nagłówka `x-tenant-host`), `public_tenant_id()` (host -> tenant, alias `www.`, fallback do tenanta domyślnego), RLS anon per host oraz otenantowane `trending_posts` / `popular_post_ids`. |
| `signup_provisioning_test.sql` | `handle_new_user`: rejestracja klienta = zawsze reader w tenancie domyślnym; `signup_type='staff'` w `raw_user_meta_data` (spoofing) nie eskaluje; tenant + admin powstaje wyłącznie z `raw_app_meta_data` (service role). |
| `tenants_update_grants_test.sql` | Kolumnowy grant UPDATE na `tenants`: admin tenanta zmienia tylko `name`; `slug`/`domain`/`is_default` odrzucane uprawnieniami (42501); anon bez UPDATE w ogóle. |
| `role_management_test.sql` | Atomowa zmiana ról (`change_user_role`) + wpisy w `role_audit_log`. |
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
