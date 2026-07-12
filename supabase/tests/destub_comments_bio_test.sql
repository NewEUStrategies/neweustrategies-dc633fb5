-- pgTAP: de-stubbing komentarzy i bio (migracja 20260713140000).
--
--   1. Bio: trigger lustra utrzymuje profiles.bio = bio_pl (fallback bio_en)
--      przy INSERT i UPDATE; zapis niezwiązany z bio go nie rusza.
--   2. Komentarze: autor edytuje własny komentarz w oknie 15 min (edited_at
--      ostemplowane); poza oknem edycja odrzucona.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(8);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d1111111-1111-1111-1111-1111111100dd', 'destub-tenant', 'Destub Tenant');

INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-0000000000d1', 'destub1@test.test'),
  ('d0000000-0000-0000-0000-0000000000d2', 'destub2@test.test');

-- ── 1) BIO: lustro przy INSERT (bio_pl -> bio) ──────────────────────────────
INSERT INTO public.profiles (id, email, display_name, tenant_id, bio_pl) VALUES
  ('d0000000-0000-0000-0000-0000000000d1', 'destub1@test.test', 'Destub One',
   'd1111111-1111-1111-1111-1111111100dd', 'bio PL przy tworzeniu');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d0000000-0000-0000-0000-0000000000d2', 'destub2@test.test', 'Destub Two',
   'd1111111-1111-1111-1111-1111111100dd');

SELECT is(
  (SELECT bio FROM public.profiles WHERE id = 'd0000000-0000-0000-0000-0000000000d1'),
  'bio PL przy tworzeniu',
  'lustro na INSERT: profiles.bio = bio_pl'
);

-- Lustro przy UPDATE lokalu.
UPDATE public.profiles SET bio_pl = 'nowe bio PL'
 WHERE id = 'd0000000-0000-0000-0000-0000000000d1';
SELECT is(
  (SELECT bio FROM public.profiles WHERE id = 'd0000000-0000-0000-0000-0000000000d1'),
  'nowe bio PL',
  'lustro na UPDATE: profiles.bio = bio_pl'
);

-- Fallback na bio_en gdy bio_pl puste.
UPDATE public.profiles SET bio_pl = NULL, bio_en = 'only EN'
 WHERE id = 'd0000000-0000-0000-0000-0000000000d2';
SELECT is(
  (SELECT bio FROM public.profiles WHERE id = 'd0000000-0000-0000-0000-0000000000d2'),
  'only EN',
  'lustro: fallback profiles.bio = bio_en gdy bio_pl puste'
);

-- Zapis niezwiązany z bio (trigger tylko na UPDATE OF bio_pl,bio_en) nie rusza lustra.
UPDATE public.profiles SET bio = 'ręczne', display_name = 'Two v2'
 WHERE id = 'd0000000-0000-0000-0000-0000000000d2';
SELECT is(
  (SELECT bio FROM public.profiles WHERE id = 'd0000000-0000-0000-0000-0000000000d2'),
  'ręczne',
  'zapis bio niezwiązany z lokalami nie jest nadpisany lustrem'
);

-- ── 2) KOMENTARZE: edycja w oknie / poza oknem ──────────────────────────────
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('d0000000-0000-0000-0000-0000000000e0', 'd1111111-1111-1111-1111-1111111100dd', 'destub-home');
INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl)
VALUES ('d0000000-0000-0000-0000-0000000000e1', 'destub-post',
        'd0000000-0000-0000-0000-0000000000d1', 'published',
        'd1111111-1111-1111-1111-1111111100dd',
        'd0000000-0000-0000-0000-0000000000e0', 'Destub Post');

-- site_settings PK jest na samym 'key' (globalny wiersz); kierujemy go na nasz
-- tenant, bo comments_before_insert czyta discussion po (key, tenant_id).
INSERT INTO public.site_settings (tenant_id, key, value)
VALUES ('d1111111-1111-1111-1111-1111111100dd', 'discussion',
        '{"allow_comments": true, "moderate_new_comments": false}'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET tenant_id = EXCLUDED.tenant_id, value = EXCLUDED.value;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.comments (id, post_id, user_id, body)
    VALUES ('d0000000-0000-0000-0000-0000000000e2',
            'd0000000-0000-0000-0000-0000000000e1',
            'd0000000-0000-0000-0000-0000000000d2', 'pierwsza wersja')$$,
  'autor dodaje komentarz'
);

SELECT lives_ok(
  $$UPDATE public.comments SET body = 'poprawiona wersja'
     WHERE id = 'd0000000-0000-0000-0000-0000000000e2'$$,
  'autor edytuje własny komentarz w oknie 15 min'
);

RESET ROLE;
SELECT is(
  (SELECT edited_at IS NOT NULL FROM public.comments
    WHERE id = 'd0000000-0000-0000-0000-0000000000e2'),
  true,
  'edycja ostemplowała edited_at'
);

-- Poza oknem: cofnij created_at o 20 min (jako właściciel - czyścimy claims,
-- inaczej guard widzi auth.uid() i blokuje zmianę created_at jako tożsamości).
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.comments SET created_at = now() - interval '20 minutes'
 WHERE id = 'd0000000-0000-0000-0000-0000000000e2';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
SELECT throws_ok(
  $$UPDATE public.comments SET body = 'za późno'
     WHERE id = 'd0000000-0000-0000-0000-0000000000e2'$$,
  'comments: edit window expired',
  'edycja po 15 min odrzucona'
);

SELECT * FROM finish();
ROLLBACK;
