-- pgTAP: paginacja serwerowa archiwum autora (migracja 20260731193000).
--
-- get_expert_materials() musi widziec DOKLADNIE ten sam zbior co
-- get_expert_hub() (posty autora + wspolautorstwa, podcasty, wydarzenia
-- host/prelegent; tylko published, bez soft-delete), ale zwracac jedna strone
-- okna LIMIT/OFFSET + prawdziwy total, z filtrami AND liczonymi w SQL:
--   * porzadek deterministyczny: data DESC NULLS LAST, id ASC,
--   * dedupe strukturalny (autor glowny wygrywa ze wspolautorstwem),
--   * filtr taga dotyczy tylko postow (podcast/wydarzenie odpadaja),
--   * nieznany slug filtra => total=0 (nigdy wyjatek),
--   * strona poza zakresem => items puste, total prawdziwy,
--   * pivoty taksonomii TYLKO dla postow biezacej strony,
--   * rezolucja profilu: slug, fallback UUID; brak profilu => found=false,
--   * SECURITY INVOKER + EXECUTE dla anon (publiczna sciezka RLS).
--
-- Konwencje: plik samowystarczalny (BEGIN/plan/finish/ROLLBACK), odczyty
-- z perspektywy anona na tenancie publicznym - jak premium_search_test.sql.

BEGIN;
SELECT plan(22);

ALTER TABLE auth.users DISABLE TRIGGER USER;

SELECT public.public_tenant_id() AS nes \gset

-- ── (0) Definicja i uprawnienia ─────────────────────────────────────────────
SELECT isnt_definer(
  'public', 'get_expert_materials',
  ARRAY['text','text','text','text','text','text','integer','integer','integer'],
  'get_expert_materials() jest SECURITY INVOKER (pelny RLS wolajacego)'
);
SELECT ok(
  has_function_privilege(
    'anon',
    'public.get_expert_materials(text,text,text,text,text,text,integer,integer,integer)',
    'EXECUTE'
  ),
  'anon moze wywolac get_expert_materials() (publiczne archiwum autora)'
);

-- ── Seed ────────────────────────────────────────────────────────────────────
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('ee000000-0000-0000-0000-00000000ef01', :'nes', 'ep-home');

INSERT INTO auth.users (id, email) VALUES
  ('ee000000-0000-0000-0000-00000000e001', 'expert@ep.test'),
  ('ee000000-0000-0000-0000-00000000e002', 'other@ep.test');

INSERT INTO public.profiles (id, email, display_name, slug, tenant_id) VALUES
  ('ee000000-0000-0000-0000-00000000e001', 'expert@ep.test', 'Ewa Paginacja',
   'ep-expert', :'nes'),
  ('ee000000-0000-0000-0000-00000000e002', 'other@ep.test', 'Inny Autor',
   'ep-other', :'nes');

-- Taksonomie filtrow.
INSERT INTO public.tags (id, slug, name) VALUES
  ('ee000000-0000-0000-0000-00000000d001', 'ep-energia', 'Energia');
INSERT INTO public.programs (id, tenant_id, slug, name_pl, name_en) VALUES
  ('ee000000-0000-0000-0000-00000000d002', :'nes', 'ep-defence',
   'Obronnosc', 'Defence');

-- 8 postow autora glownego (3 raporty, 1 wideo) + 1 wspolautorstwo
-- + 1 draft i 1 soft-delete (oba MUSZA byc niewidoczne).
INSERT INTO public.posts
  (id, slug, status, tenant_id, parent_page_id, title_pl, title_en,
   post_format, published_at, author_id) VALUES
  ('ee000000-0000-0000-0000-00000000a001', 'ep-p1', 'published', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'P1', 'P1', 'standard',
   '2026-06-30T10:00:00Z', 'ee000000-0000-0000-0000-00000000e001'),
  ('ee000000-0000-0000-0000-00000000a002', 'ep-p2', 'published', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'P2', 'P2', 'standard',
   '2026-06-20T10:00:00Z', 'ee000000-0000-0000-0000-00000000e001'),
  ('ee000000-0000-0000-0000-00000000a003', 'ep-p3', 'published', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'P3', 'P3', 'standard',
   '2026-06-10T10:00:00Z', 'ee000000-0000-0000-0000-00000000e001'),
  ('ee000000-0000-0000-0000-00000000a004', 'ep-p4', 'published', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'P4', 'P4', 'video',
   '2026-05-30T10:00:00Z', 'ee000000-0000-0000-0000-00000000e001'),
  ('ee000000-0000-0000-0000-00000000a005', 'ep-p5', 'published', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'P5', 'P5', 'report',
   '2026-04-15T10:00:00Z', 'ee000000-0000-0000-0000-00000000e001'),
  ('ee000000-0000-0000-0000-00000000a006', 'ep-p6', 'published', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'P6', 'P6', 'report',
   '2025-12-01T10:00:00Z', 'ee000000-0000-0000-0000-00000000e001'),
  ('ee000000-0000-0000-0000-00000000a007', 'ep-p7', 'published', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'P7', 'P7', 'standard',
   '2025-06-01T10:00:00Z', 'ee000000-0000-0000-0000-00000000e001'),
  ('ee000000-0000-0000-0000-00000000a008', 'ep-p8', 'published', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'P8', 'P8', 'report',
   '2024-03-01T10:00:00Z', 'ee000000-0000-0000-0000-00000000e001'),
  ('ee000000-0000-0000-0000-00000000a009', 'ep-pc', 'published', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'PC', 'PC', 'standard',
   '2026-03-01T10:00:00Z', 'ee000000-0000-0000-0000-00000000e002'),
  ('ee000000-0000-0000-0000-00000000a010', 'ep-draft', 'draft', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'Draft', 'Draft', 'standard',
   '2026-07-01T10:00:00Z', 'ee000000-0000-0000-0000-00000000e001'),
  ('ee000000-0000-0000-0000-00000000a011', 'ep-deleted', 'published', :'nes',
   'ee000000-0000-0000-0000-00000000ef01', 'Del', 'Del', 'standard',
   '2026-07-02T10:00:00Z', 'ee000000-0000-0000-0000-00000000e001');
UPDATE public.posts SET deleted_at = now()
  WHERE id = 'ee000000-0000-0000-0000-00000000a011';

-- Wspolautorstwo eksperta w poscie innego autora.
INSERT INTO public.post_authors (post_id, user_id) VALUES
  ('ee000000-0000-0000-0000-00000000a009', 'ee000000-0000-0000-0000-00000000e001');

-- Pivoty filtrow: tag na p1 + p6; program na p2 + podcast.
INSERT INTO public.post_tags (post_id, tag_id) VALUES
  ('ee000000-0000-0000-0000-00000000a001', 'ee000000-0000-0000-0000-00000000d001'),
  ('ee000000-0000-0000-0000-00000000a006', 'ee000000-0000-0000-0000-00000000d001');
INSERT INTO public.post_programs (post_id, program_id) VALUES
  ('ee000000-0000-0000-0000-00000000a002', 'ee000000-0000-0000-0000-00000000d002');

INSERT INTO public.podcasts
  (id, tenant_id, slug, title_pl, audio_url, status, published_at,
   author_id, program_id) VALUES
  ('ee000000-0000-0000-0000-00000000b001', :'nes', 'ep-pod', 'Podcast EP',
   'https://cdn.example/ep.mp3', 'published', '2026-02-01T10:00:00Z',
   'ee000000-0000-0000-0000-00000000e001',
   'ee000000-0000-0000-0000-00000000d002');

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status, host_user_id) VALUES
  ('ee000000-0000-0000-0000-00000000c001', :'nes', 'ep-ev-host',
   'Debata EP', 'EP Debate', '2026-07-20T18:00:00Z', 'published',
   'ee000000-0000-0000-0000-00000000e001'),
  ('ee000000-0000-0000-0000-00000000c002', :'nes', 'ep-ev-speak',
   'Panel EP', 'EP Panel', '2026-07-10T18:00:00Z', 'published',
   'ee000000-0000-0000-0000-00000000e002');
INSERT INTO public.event_speakers (event_id, user_id) VALUES
  ('ee000000-0000-0000-0000-00000000c002', 'ee000000-0000-0000-0000-00000000e001');

-- ── Odczyty z perspektywy anona ─────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);

-- (1) Rezolucja profilu.
SELECT is(
  public.get_expert_materials('ep-ghost') ->> 'found', 'false',
  'nieznany slug profilu => found=false (TS mapuje na 404)'
);
SELECT is(
  (public.get_expert_materials('ee000000-0000-0000-0000-00000000e001') ->> 'total')::int,
  12,
  'fallback po UUID rozwiazuje ten sam profil (kompatybilnosc starych linkow)'
);

-- (2) Total i okno strony 1: 8 postow + wspolautorstwo + podcast + 2 wydarzenia
--     = 12; draft i soft-delete NIE licza sie.
SELECT is(
  (public.get_expert_materials('ep-expert') ->> 'total')::int, 12,
  'total = 12 (published bez draftu i soft-delete, wszystkie zrodla)'
);
SELECT is(
  jsonb_array_length(public.get_expert_materials('ep-expert') -> 'items'), 9,
  'strona 1 niesie pelne okno 9 pozycji'
);
SELECT is(
  public.get_expert_materials('ep-expert') -> 'items' -> 0 -> 'row' ->> 'id',
  'ee000000-0000-0000-0000-00000000c001',
  'porzadek: najnowsza data pierwsza (hostowane wydarzenie 2026-07-20)'
);
SELECT is(
  public.get_expert_materials('ep-expert') -> 'items' -> 0 ->> 'source',
  'event',
  'pierwsza pozycja strony 1 pochodzi ze zrodla event'
);

-- (3) Strona 2: reszta okna w tym samym porzadku.
SELECT is(
  jsonb_array_length(
    public.get_expert_materials('ep-expert', NULL, NULL, NULL, NULL, NULL, NULL, 2, 9)
      -> 'items'
  ),
  3,
  'strona 2 niesie pozostale 3 pozycje (12 = 9 + 3)'
);
SELECT is(
  public.get_expert_materials('ep-expert', NULL, NULL, NULL, NULL, NULL, NULL, 2, 9)
    -> 'items' -> 0 -> 'row' ->> 'id',
  'ee000000-0000-0000-0000-00000000a006',
  'strona 2 zaczyna sie od 10. pozycji porzadku (p6, 2025-12-01)'
);

-- (4) Strona poza zakresem: puste okno, prawdziwy total.
SELECT is(
  jsonb_array_length(
    public.get_expert_materials('ep-expert', NULL, NULL, NULL, NULL, NULL, NULL, 9, 9)
      -> 'items'
  ),
  0,
  'strona poza zakresem => items puste (parytet LIMIT/OFFSET)'
);
SELECT is(
  (public.get_expert_materials('ep-expert', NULL, NULL, NULL, NULL, NULL, NULL, 9, 9)
     ->> 'total')::int,
  12,
  'strona poza zakresem => total nadal prawdziwy (klient sam koryguje strone)'
);

-- (5) Filtry AND liczone w SQL.
SELECT is(
  (public.get_expert_materials('ep-expert', 'report') ->> 'total')::int, 3,
  'filtr kind=report zaweza do 3 raportow (p5, p6, p8)'
);
SELECT is(
  (public.get_expert_materials('ep-expert', NULL, NULL, NULL, NULL, 'ep-energia')
     ->> 'total')::int,
  2,
  'filtr taga lapie tylko posty z pivotem (p1, p6); podcast/wydarzenia odpadaja'
);
SELECT is(
  (public.get_expert_materials('ep-expert', NULL, 'ep-defence') ->> 'total')::int, 2,
  'filtr programu obejmuje post (pivot) i podcast (kolumna program_id)'
);
SELECT is(
  (public.get_expert_materials('ep-expert', NULL, NULL, NULL, NULL, NULL, 2025)
     ->> 'total')::int,
  2,
  'filtr roku (UTC) zaweza do publikacji z 2025 (p6, p7)'
);
SELECT is(
  (public.get_expert_materials('ep-expert', NULL, NULL, NULL, NULL, 'ep-nie-ma')
     ->> 'total')::int,
  0,
  'nieznany slug filtra => pusty wynik (found=true, total=0), nie wyjatek'
);

-- (6) Flaga wspolautora per pozycja.
SELECT is(
  (SELECT item ->> 'is_coauthor'
     FROM jsonb_array_elements(public.get_expert_materials('ep-expert') -> 'items') item
    WHERE item -> 'row' ->> 'id' = 'ee000000-0000-0000-0000-00000000a009'),
  'true',
  'post innego autora ze wspolautorstwem eksperta ma is_coauthor=true'
);
SELECT is(
  (SELECT item ->> 'is_coauthor'
     FROM jsonb_array_elements(public.get_expert_materials('ep-expert') -> 'items') item
    WHERE item -> 'row' ->> 'id' = 'ee000000-0000-0000-0000-00000000a001'),
  'false',
  'post autora glownego ma is_coauthor=false'
);

-- (7) Pivoty taksonomii sa zawezone do postow biezacej strony.
SELECT ok(
  (public.get_expert_materials('ep-expert', NULL, NULL, NULL, NULL, NULL, NULL, 2, 9)
     -> 'post_tags')
  @> '[{"post_id":"ee000000-0000-0000-0000-00000000a006","tag_id":"ee000000-0000-0000-0000-00000000d001"}]'::jsonb,
  'strona 2 niesie pivot taga dla p6 (post z tej strony)'
);
SELECT ok(
  NOT (
    (public.get_expert_materials('ep-expert', NULL, NULL, NULL, NULL, NULL, NULL, 2, 9)
       -> 'post_tags')
    @> '[{"post_id":"ee000000-0000-0000-0000-00000000a001","tag_id":"ee000000-0000-0000-0000-00000000d001"}]'::jsonb
  ),
  'strona 2 NIE niesie pivotow postow spoza swojego okna (p1 jest na stronie 1)'
);

-- (8) Sanity page_size: klamrowanie wejscia.
SELECT is(
  (public.get_expert_materials('ep-expert', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0)
     ->> 'page')::int,
  1,
  'page < 1 klamrowane do 1 (RPC broni sie sam, niezaleznie od parsera URL)'
);

SELECT * FROM finish();
ROLLBACK;
