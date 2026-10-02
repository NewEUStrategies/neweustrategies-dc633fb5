-- pgTAP: sygnal dwell silnika rekomendacji (post_views.dwell_ms).
--
-- Weryfikuje migracje 20261002200000_post_views_dwell_signal.sql:
--   1. kolumna i jej zakres (0..30 min, NULL = brak zgloszenia);
--   2. zapis `record_post_dwell` jest WYLACZNIE dla service_role - anon nie moze
--      ominac limitera beaconu wolaniem PostgREST wprost;
--   3. zapis trafia NAJNOWSZA odslone (wpis, viewer_hash) najemcy z ostatnich
--      2 h, wartosc tylko rosnie i jest przycieta do czasu, jaki uplynal od
--      odslony; obcy najemca, stara odslona i szum ponizej 1 s nie pisza nic;
--   4. agregat `related_posts_dwell` liczy MEDIANE per opublikowany wpis
--      najemcy wskazanego przez host, pomija wpisy z mniej niz 5 pomiarami,
--      szkice i odslony bez zgloszenia, i nie przecieka miedzy najemcami.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(24);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ───────────────────────────────────────────────────────────────────
UPDATE public.tenants SET domain = 'nes.example' WHERE slug = 'nes';

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('d2222222-2222-2222-2222-2222222222d2', 'dwell-b', 'Dwell Tenant B', 'dwell-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'author-a@dwell.test'),
  ('d0000000-0000-0000-0000-0000000000b1', 'author-b@dwell.test');

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('daaaaaaa-0000-0000-0000-00000000000a',
   (SELECT id FROM public.tenants WHERE slug = 'nes'), 'dwell-a-home'),
  ('dbbbbbbb-0000-0000-0000-00000000000b',
   'd2222222-2222-2222-2222-2222222222d2', 'dwell-b-home');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl) VALUES
  -- najemca domyslny: piec pomiarow, ale na hoscie B nie wolno go zobaczyc
  ('d0000000-0000-0000-0000-00000000a001', 'dwell-a-post',
   'd0000000-0000-0000-0000-0000000000a1', 'published',
   (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'daaaaaaa-0000-0000-0000-00000000000a', 'Dwell A'),
  -- najemca B: piec pomiarow - wchodzi do agregatu
  ('d0000000-0000-0000-0000-00000000b001', 'dwell-b-full',
   'd0000000-0000-0000-0000-0000000000b1', 'published',
   'd2222222-2222-2222-2222-2222222222d2',
   'dbbbbbbb-0000-0000-0000-00000000000b', 'Dwell B pelny'),
  -- najemca B: cztery pomiary - za malo
  ('d0000000-0000-0000-0000-00000000b002', 'dwell-b-thin',
   'd0000000-0000-0000-0000-0000000000b1', 'published',
   'd2222222-2222-2222-2222-2222222222d2',
   'dbbbbbbb-0000-0000-0000-00000000000b', 'Dwell B cienki'),
  -- najemca B: szkic z pieciu pomiarami - nie wolno go polecac
  ('d0000000-0000-0000-0000-00000000b003', 'dwell-b-draft',
   'd0000000-0000-0000-0000-0000000000b1', 'draft',
   'd2222222-2222-2222-2222-2222222222d2',
   'dbbbbbbb-0000-0000-0000-00000000000b', 'Dwell B szkic'),
  -- najemca B: cel zapisow przez record_post_dwell
  ('d0000000-0000-0000-0000-00000000b004', 'dwell-b-target',
   'd0000000-0000-0000-0000-0000000000b1', 'published',
   'd2222222-2222-2222-2222-2222222222d2',
   'dbbbbbbb-0000-0000-0000-00000000000b', 'Dwell B cel');

-- Pomiary do agregatu. Mediana pieciu wartosci 10..50 s to 30 s; odslona bez
-- zgloszenia (NULL) nie moze tej mediany przesunac.
INSERT INTO public.post_views (post_id, tenant_id, viewer_hash, viewed_at, dwell_ms)
SELECT 'd0000000-0000-0000-0000-00000000b001'::uuid,
       'd2222222-2222-2222-2222-2222222222d2'::uuid,
       'dwell-full-viewer-' || g, now() - interval '1 day', g * 10000
  FROM generate_series(1, 5) AS g;
INSERT INTO public.post_views (post_id, tenant_id, viewer_hash, viewed_at, dwell_ms) VALUES
  ('d0000000-0000-0000-0000-00000000b001', 'd2222222-2222-2222-2222-2222222222d2',
   'dwell-full-viewer-null', now() - interval '1 day', NULL);

INSERT INTO public.post_views (post_id, tenant_id, viewer_hash, viewed_at, dwell_ms)
SELECT 'd0000000-0000-0000-0000-00000000b002'::uuid,
       'd2222222-2222-2222-2222-2222222222d2'::uuid,
       'dwell-thin-viewer-' || g, now() - interval '1 day', 600000
  FROM generate_series(1, 4) AS g;

INSERT INTO public.post_views (post_id, tenant_id, viewer_hash, viewed_at, dwell_ms)
SELECT 'd0000000-0000-0000-0000-00000000b003'::uuid,
       'd2222222-2222-2222-2222-2222222222d2'::uuid,
       'dwell-draft-viewer-' || g, now() - interval '1 day', 900000
  FROM generate_series(1, 5) AS g;

INSERT INTO public.post_views (post_id, tenant_id, viewer_hash, viewed_at, dwell_ms)
SELECT 'd0000000-0000-0000-0000-00000000a001'::uuid,
       (SELECT id FROM public.tenants WHERE slug = 'nes'),
       'dwell-a-viewer-' || g, now() - interval '1 day', 1200000
  FROM generate_series(1, 5) AS g;

-- Odslony celu zapisu: starsza (1 h) i najnowsza (10 min) tego samego
-- czytelnika, odslona sprzed 3 h innego czytelnika.
INSERT INTO public.post_views (id, post_id, tenant_id, viewer_hash, viewed_at) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000b004',
   'd2222222-2222-2222-2222-2222222222d2', 'dwell-writer-hash-0001', now() - interval '1 hour'),
  ('d1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000b004',
   'd2222222-2222-2222-2222-2222222222d2', 'dwell-writer-hash-0001', now() - interval '10 minutes'),
  ('d1000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-00000000b004',
   'd2222222-2222-2222-2222-2222222222d2', 'dwell-stale-hash-00001', now() - interval '3 hours');

-- ── 1. Kolumna i zakres ────────────────────────────────────────────────────
SELECT has_column('public', 'post_views', 'dwell_ms', 'post_views ma kolumne dwell_ms');
SELECT col_is_null('public', 'post_views', 'dwell_ms',
  'dwell_ms jest NULL-owalne: brak zgloszenia to nie zero');
SELECT throws_ok(
  $$UPDATE public.post_views SET dwell_ms = 1800001
     WHERE id = 'd1000000-0000-0000-0000-000000000001'$$,
  '23514', NULL,
  'CHECK odrzuca czas czytania powyzej 30 minut');

-- ── 2. Granty i konfiguracja funkcji ───────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.record_post_dwell(uuid, uuid, text, integer)', 'EXECUTE'),
  'acl: anon NIE wykonuje record_post_dwell (zapis tylko przez beacon za limiterem)');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.record_post_dwell(uuid, uuid, text, integer)', 'EXECUTE'),
  'acl: authenticated NIE wykonuje record_post_dwell');
SELECT ok(
  has_function_privilege('service_role', 'public.record_post_dwell(uuid, uuid, text, integer)', 'EXECUTE'),
  'acl: service_role wykonuje record_post_dwell (trasa /api/public/post-dwell)');
SELECT ok(
  has_function_privilege('anon', 'public.related_posts_dwell(integer, integer)', 'EXECUTE'),
  'acl: anon wykonuje related_posts_dwell (rekomendacje pod publicznym artykulem)');
SELECT is(
  (SELECT count(*)::int FROM pg_proc
    WHERE oid IN ('public.record_post_dwell(uuid, uuid, text, integer)'::regprocedure,
                  'public.related_posts_dwell(integer, integer)'::regprocedure)
      AND prosecdef AND proconfig = ARRAY['search_path=public, pg_temp']),
  2,
  'obie funkcje: SECURITY DEFINER z search_path = public, pg_temp');

-- ── 3. Zapis: trafienie, monotonicznosc, przyciecie ────────────────────────
SELECT ok(
  public.record_post_dwell('d2222222-2222-2222-2222-2222222222d2',
    'd0000000-0000-0000-0000-00000000b004', 'dwell-writer-hash-0001', 120000),
  'record_post_dwell trafia odslone i zwraca true');
SELECT is(
  (SELECT dwell_ms FROM public.post_views WHERE id = 'd1000000-0000-0000-0000-000000000002'),
  120000,
  'zapis trafia NAJNOWSZA odslone (wpis, viewer_hash)');
SELECT is(
  (SELECT dwell_ms FROM public.post_views WHERE id = 'd1000000-0000-0000-0000-000000000001'),
  NULL::integer,
  'starsza odslona tego samego czytelnika zostaje bez zmian');

SELECT public.record_post_dwell('d2222222-2222-2222-2222-2222222222d2',
  'd0000000-0000-0000-0000-00000000b004', 'dwell-writer-hash-0001', 60000);
SELECT is(
  (SELECT dwell_ms FROM public.post_views WHERE id = 'd1000000-0000-0000-0000-000000000002'),
  120000,
  'mniejsze (spoznione) zgloszenie nie cofa wartosci - zapis tylko rosnie');

SELECT public.record_post_dwell('d2222222-2222-2222-2222-2222222222d2',
  'd0000000-0000-0000-0000-00000000b004', 'dwell-writer-hash-0001', 1800000);
SELECT is(
  (SELECT dwell_ms FROM public.post_views WHERE id = 'd1000000-0000-0000-0000-000000000002'),
  605000,
  'zgloszenie przyciete do czasu od odslony (10 min + 5 s zapasu), a nie 30 min');

-- ── 4. Zapis: odmowy ───────────────────────────────────────────────────────
SELECT ok(
  NOT public.record_post_dwell((SELECT id FROM public.tenants WHERE slug = 'nes'),
    'd0000000-0000-0000-0000-00000000b004', 'dwell-writer-hash-0001', 90000),
  'obcy najemca nie trafia odslony najemcy B');
SELECT ok(
  NOT public.record_post_dwell('d2222222-2222-2222-2222-2222222222d2',
    'd0000000-0000-0000-0000-00000000b004', 'dwell-stale-hash-00001', 90000),
  'odslona starsza niz 2 h nie przyjmuje zgloszenia');
SELECT is(
  (SELECT dwell_ms FROM public.post_views WHERE id = 'd1000000-0000-0000-0000-000000000003'),
  NULL::integer,
  'stara odslona zostaje bez czasu czytania');
SELECT ok(
  NOT public.record_post_dwell('d2222222-2222-2222-2222-2222222222d2',
    'd0000000-0000-0000-0000-00000000b004', 'dwell-writer-hash-0001', 999),
  'szum ponizej 1 s jest odrzucany');
SELECT ok(
  NOT public.record_post_dwell('d2222222-2222-2222-2222-2222222222d2',
    'd0000000-0000-0000-0000-00000000b004', 'short', 90000),
  'za krotki viewer_hash jest odrzucany');

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.record_post_dwell('d2222222-2222-2222-2222-2222222222d2',
      'd0000000-0000-0000-0000-00000000b004', 'dwell-writer-hash-0001', 90000)$$,
  '42501', NULL,
  'anon wolajacy PostgREST wprost dostaje odmowe uprawnien');

-- ── 5. Agregat: mediana, prog proby, izolacja najemcy ──────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"dwell-b.example"}', true);

SELECT is(
  (SELECT median_dwell_ms FROM public.related_posts_dwell(28, 200)
    WHERE post_id = 'd0000000-0000-0000-0000-00000000b001'),
  30000,
  'mediana pieciu pomiarow 10..50 s to 30 s (odslona bez zgloszenia nie liczy sie)');
SELECT is(
  (SELECT count(*)::int FROM public.related_posts_dwell(28, 200)
    WHERE post_id = 'd0000000-0000-0000-0000-00000000b002'),
  0,
  'wpis z czterema pomiarami nie wchodzi do agregatu (prog 5)');
SELECT is(
  (SELECT count(*)::int FROM public.related_posts_dwell(28, 200)
    WHERE post_id = 'd0000000-0000-0000-0000-00000000b003'),
  0,
  'szkic nie wchodzi do agregatu, choc ma piec pomiarow');
SELECT is(
  (SELECT count(*)::int FROM public.related_posts_dwell(28, 200)
    WHERE post_id = 'd0000000-0000-0000-0000-00000000a001'),
  0,
  'wpis najemcy domyslnego nie przecieka na host najemcy B');

SELECT set_config('request.headers', '{"x-tenant-host":"nes.example"}', true);
SELECT is(
  (SELECT array_agg(post_id) FROM public.related_posts_dwell(28, 200)
    WHERE post_id::text LIKE 'd0000000-%'),
  ARRAY['d0000000-0000-0000-0000-00000000a001'::uuid],
  'host najemcy domyslnego widzi wylacznie wlasny wpis');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
