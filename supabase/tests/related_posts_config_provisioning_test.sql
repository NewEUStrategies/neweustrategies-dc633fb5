-- pgTAP: provisioning i izolacja tenantów dla `related_posts_config`.
--
-- Weryfikuje migrację 20260726090000_related_posts_config_provisioning, która
-- domyka błąd klasy "cichy zapis":
--
--   Tabela-singleton (`tenant_id` jako PRIMARY KEY) była zasiewana JEDNORAZOWO w
--   migracji z 24.06, bez provisioningu dla tenantów zakładanych później. Panel
--   zapisywał przez `UPDATE ... WHERE tenant_id <> '000…0'`, a UPDATE bez
--   dopasowania jest dla PostgREST sukcesem (204) - nowy tenant widział więc
--   „Zapisano" przy zerowej zmianie.
--
-- Asercje:
--   1. TRIGGER: nowy tenant dostaje wiersz w momencie utworzenia.
--   2. BACKFILL: po migracji KAŻDY istniejący tenant ma dokładnie jeden wiersz.
--   3. IDEMPOTENCJA: `seed_related_posts_config` wołany dwa razy nie duplikuje
--      wiersza i nie nadpisuje ustawień administratora.
--   4. ZAPIS EDYTORA: upsert admina zmienia WYŁĄCZNIE wiersz jego tenanta.
--   5. IZOLACJA ZAPISU: admin tenanta A nie może nadpisać wiersza tenanta B
--      (polityka WITH CHECK na `current_tenant_id()`).
--   6. IZOLACJA ODCZYTU: admin tenanta A czytający tabelę na domenie tenanta B
--      widzi DWA wiersze (suma polityk OR) - dlatego `select().limit(1)` był
--      niedeterministyczny; `get_related_posts_config()` zwraca wtedy wiersz
--      tenanta PRZEGLĄDANEGO, nigdy własnego.
--   7. anon nigdy nie widzi wiersza obcego tenanta.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(13);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── 2) BACKFILL: żaden istniejący tenant nie może zostać bez wiersza ───────
SELECT is(
  (SELECT count(*) FROM public.tenants t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.related_posts_config c WHERE c.tenant_id = t.id
    )),
  0::bigint,
  'backfill: każdy istniejący tenant ma wiersz related_posts_config'
);

-- ── 1) TRIGGER: nowy tenant zasiewa się sam ────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('a1111111-1111-1111-1111-1111111111c1', 'rpc-tenant-a', 'RPC Tenant A', 'rpc-a.example'),
  ('b2222222-2222-2222-2222-2222222222c2', 'rpc-tenant-b', 'RPC Tenant B', 'rpc-b.example');

SELECT is(
  (SELECT count(*) FROM public.related_posts_config
    WHERE tenant_id IN ('a1111111-1111-1111-1111-1111111111c1',
                        'b2222222-2222-2222-2222-2222222222c2')),
  2::bigint,
  'trigger tenants_seed_related_posts_config: nowe tenanty dostają wiersz od razu'
);

SELECT is(
  (SELECT layout FROM public.related_posts_config
    WHERE tenant_id = 'a1111111-1111-1111-1111-1111111111c1'),
  'grid',
  'zasiany wiersz ma kolumnowe wartości domyślne (layout=grid)'
);

-- ── 3) IDEMPOTENCJA zasiewu ────────────────────────────────────────────────
UPDATE public.related_posts_config
   SET layout = 'timeline', items_limit = 9
 WHERE tenant_id = 'a1111111-1111-1111-1111-1111111111c1';

SELECT public.seed_related_posts_config('a1111111-1111-1111-1111-1111111111c1');

SELECT is(
  (SELECT count(*) FROM public.related_posts_config
    WHERE tenant_id = 'a1111111-1111-1111-1111-1111111111c1'),
  1::bigint,
  'seed_related_posts_config jest idempotentny (bez duplikatu)'
);

SELECT is(
  (SELECT layout FROM public.related_posts_config
    WHERE tenant_id = 'a1111111-1111-1111-1111-1111111111c1'),
  'timeline',
  'powtórny zasiew NIE nadpisuje ustawień administratora'
);

-- ── Użytkownicy: admin A i admin B ─────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000c1', 'admin-a@rpc.test'),
  ('b0000000-0000-0000-0000-0000000000c2', 'admin-b@rpc.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000c1', 'admin-a@rpc.test', 'Admin A',
   'a1111111-1111-1111-1111-1111111111c1'),
  ('b0000000-0000-0000-0000-0000000000c2', 'admin-b@rpc.test', 'Admin B',
   'b2222222-2222-2222-2222-2222222222c2');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000c1', 'admin', 'a1111111-1111-1111-1111-1111111111c1'),
  ('b0000000-0000-0000-0000-0000000000c2', 'admin', 'b2222222-2222-2222-2222-2222222222c2');

-- ── 4) ZAPIS EDYTORA: upsert dotyka tylko własnego tenanta ─────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);

INSERT INTO public.related_posts_config (tenant_id, items_limit, weight_tags)
VALUES ('a1111111-1111-1111-1111-1111111111c1', 12, 7)
ON CONFLICT (tenant_id) DO UPDATE
  SET items_limit = EXCLUDED.items_limit,
      weight_tags = EXCLUDED.weight_tags;

SELECT is(
  (SELECT items_limit FROM public.related_posts_config
    WHERE tenant_id = 'a1111111-1111-1111-1111-1111111111c1'),
  12,
  'upsert admina zapisuje wiersz JEGO tenanta (ON CONFLICT tenant_id)'
);

-- ── 5) IZOLACJA ZAPISU: nie da się nadpisać wiersza obcego tenanta ─────────
-- Polityka edytorska ma USING/WITH CHECK na current_tenant_id(), więc UPDATE
-- wiersza tenanta B z sesji admina A nie dopasowuje niczego.
UPDATE public.related_posts_config
   SET items_limit = 99
 WHERE tenant_id = 'b2222222-2222-2222-2222-2222222222c2';

RESET ROLE;
SELECT is(
  (SELECT items_limit FROM public.related_posts_config
    WHERE tenant_id = 'b2222222-2222-2222-2222-2222222222c2'),
  6,
  'admin tenanta A nie nadpisuje wiersza tenanta B (RLS USING/WITH CHECK)'
);

-- Upsert z podrobionym tenant_id musi zostać odrzucony przez WITH CHECK.
-- Używamy ISTNIEJĄCEGO tenanta B (nie losowego UUID-a), żeby test mierzył
-- politykę RLS, a nie klucz obcy - inaczej nie wiadomo, co go odrzuciło.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.related_posts_config (tenant_id, items_limit)
    VALUES ('b2222222-2222-2222-2222-2222222222c2', 3)
    ON CONFLICT (tenant_id) DO UPDATE SET items_limit = EXCLUDED.items_limit$$,
  '42501',
  NULL,
  'upsert z obcym tenant_id jest blokowany przez politykę RLS'
);

-- ── 6) IZOLACJA ODCZYTU: sumowanie polityk vs get_related_posts_config() ───
-- Admin A na domenie tenanta B spełnia OBIE polityki SELECT (publiczną po
-- public_tenant_id() i edytorską po current_tenant_id()), więc goły SELECT widzi
-- dwa wiersze. To dokładnie ta niedeterminacja, którą usuwa funkcja.
SELECT set_config('request.headers', '{"x-tenant-host":"rpc-b.example"}', true);

SELECT is(
  (SELECT count(*) FROM public.related_posts_config
    WHERE tenant_id IN ('a1111111-1111-1111-1111-1111111111c1',
                        'b2222222-2222-2222-2222-2222222222c2')),
  2::bigint,
  'goły SELECT widzi DWA wiersze (suma polityk) - stąd niedeterminizm limit(1)'
);

SELECT is(
  (SELECT tenant_id FROM public.get_related_posts_config()),
  'b2222222-2222-2222-2222-2222222222c2'::uuid,
  'get_related_posts_config() zwraca wiersz tenanta PRZEGLĄDANEGO, nie własnego'
);

SELECT is(
  (SELECT count(*) FROM public.get_related_posts_config()),
  1::bigint,
  'get_related_posts_config() zwraca dokładnie jeden wiersz'
);

-- ── 7) anon: tylko tenant przeglądany ──────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', NULL, true);
SELECT set_config('request.headers', '{"x-tenant-host":"rpc-b.example"}', true);

SELECT is(
  (SELECT count(*) FROM public.related_posts_config
    WHERE tenant_id = 'a1111111-1111-1111-1111-1111111111c1'),
  0::bigint,
  'anon na domenie B nie widzi wiersza tenanta A'
);

SELECT is(
  (SELECT tenant_id FROM public.get_related_posts_config()),
  'b2222222-2222-2222-2222-2222222222c2'::uuid,
  'anon czyta przez funkcję wyłącznie wiersz tenanta przeglądanego'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
