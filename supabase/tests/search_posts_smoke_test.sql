-- pgTAP: smoke test RPC public.search_posts (strona /search).
--
-- search_posts jest SECURITY DEFINER i sam egzekwuje widoczność: zwraca tylko
-- posty published, nieusunięte (deleted_at IS NULL) i w obrębie tenanta
-- rozstrzyganego WYŁĄCZNIE serwerowo — dla anonima jest to tenant publiczny
-- (public_tenant_id()). Smoke pokrywa happy-path + każde wykluczenie + brzegowe
-- zapytania, wszystko z perspektywy roli `anon`.

BEGIN;
SELECT plan(7);

-- ── Seed ───────────────────────────────────────────────────────────────────
-- Wyłączamy wszystkie triggery użytkownika na auth.users (jest ich kilka:
-- auto-provisioning profilu/tenanta + nadawanie super_admin), by w pełni
-- kontrolować seed. Transakcyjne — cofane przez ROLLBACK.
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Tenant publiczny ('nes') jest już zaseedowany przez migracje.
SELECT public.public_tenant_id() AS nes \gset

-- Drugi, NIEpubliczny tenant — jego treść nie może trafić do publicznego search.
INSERT INTO public.tenants (id, slug, name) VALUES
  ('cccccccc-3333-3333-3333-333333333333', 'tenant-c', 'Tenant C');

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('11111111-0000-0000-0000-0000000000ee', :'nes',                                  'nes-home'),
  ('22222222-0000-0000-0000-0000000000cc', 'cccccccc-3333-3333-3333-333333333333',  'c-home');

-- Wszystkie posty zawierają term „geopolityka", ale tylko jeden spełnia komplet
-- warunków widoczności publicznej (published + nieusunięty + tenant publiczny).
INSERT INTO public.posts (id, slug, status, tenant_id, parent_page_id, title_pl, published_at, deleted_at) VALUES
  ('dddd0000-0000-0000-0000-000000000001', 'nes-pub',   'published', :'nes', '11111111-0000-0000-0000-0000000000ee', 'Analiza geopolityka Europa', now(), NULL),
  ('dddd0000-0000-0000-0000-000000000002', 'nes-draft', 'draft',     :'nes', '11111111-0000-0000-0000-0000000000ee', 'Szkic geopolityka',          NULL,  NULL),
  ('dddd0000-0000-0000-0000-000000000003', 'nes-del',   'published', :'nes', '11111111-0000-0000-0000-0000000000ee', 'Usunieta geopolityka',       now(), now());
INSERT INTO public.posts (id, slug, status, tenant_id, parent_page_id, title_pl, published_at) VALUES
  ('dddd0000-0000-0000-0000-000000000004', 'c-pub', 'published', 'cccccccc-3333-3333-3333-333333333333', '22222222-0000-0000-0000-0000000000cc', 'Tajna geopolityka C', now());

-- ── Wcielenie: anonimowy odwiedzający ───────────────────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);

-- Komplet: zwracany jest dokładnie opublikowany, nieusunięty post tenanta publicznego.
SELECT is(
  (SELECT array_agg(slug ORDER BY slug) FROM public.search_posts('geopolityka')),
  ARRAY['nes-pub'],
  'search_posts zwraca tylko opublikowane, nieusunięte posty tenanta publicznego'
);

-- Wykluczenia rozbite na nazwane asercje (czytelna diagnostyka przy regresji).
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.search_posts('geopolityka') WHERE slug = 'nes-draft'),
  'szkic (status != published) pominięty'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.search_posts('geopolityka') WHERE slug = 'nes-del'),
  'post usunięty (deleted_at) pominięty'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.search_posts('geopolityka') WHERE slug = 'c-pub'),
  'post innego tenanta nie wycieka do wyszukiwania publicznego'
);

-- Ranking trafności jest dodatni (ts_rank_cd), a nie zerowy/NULL.
SELECT ok(
  (SELECT rank FROM public.search_posts('geopolityka') WHERE slug = 'nes-pub') > 0,
  'wynik niesie dodatni ranking trafności'
);

-- Zapytania brzegowe → pusty zbiór (RPC nie rzuca, tq.q IS NULL ucina wyniki).
SELECT is(
  (SELECT count(*)::int FROM public.search_posts('')),
  0,
  'puste zapytanie → 0 wyników'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_posts('zzzznosuchterm')),
  0,
  'brak dopasowania → 0 wyników'
);

SELECT * FROM finish();
ROLLBACK;
