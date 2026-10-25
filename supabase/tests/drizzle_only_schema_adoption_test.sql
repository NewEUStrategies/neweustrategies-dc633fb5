-- pgTAP: schemat, który istniał wyłącznie w dzienniku drizzle, stoi teraz
-- w pasie kanonicznym. Weryfikuje dwie migracje adopcji:
--   * 20261025090000_adopt_event_speaker_panel_bio.sql (0148, asercje 1-16),
--   * 20261025090010_adopt_membership_coupon_source_indexes.sql (0392/0393,
--     asercje 17-19).
--
-- PO CO TO STOI. Baza pgTAP powstaje WYŁĄCZNIE z supabase/migrations, a dwa
-- wpisy dziennika z panelu Lovable (0148_event_speaker_panel_bio,
-- 0392_membership_coupon_source) zmieniły produkcję poza tym pasem: lista
-- prelegentów panelu oddawała tu 21 kolumn, na produkcji 29, a indeks
-- (tenant_id, source_coupon_id) istniał tylko na produkcji. Test przypina
-- STAN KOŃCOWY, niezależnie od tego, którym pasem ktoś spróbuje go zmienić.
--
-- CO PRZYPINA
--   1-8.  kształt wyniku (21 dotychczasowych kolumn w tej samej kolejności
--         + 8 scenicznych na końcu), SECURITY DEFINER z przypiętym
--         search_path, granty: bez PUBLIC i anon, EXECUTE dla authenticated
--         i service_role; najemca z sesji (`assert_event_admin_tenant()`);
--   9-15. zachowanie: biogram łączy nakładkę z kartoteką osoby (jak
--         projekcja publiczna), tematy/języki/liczniki z nakładki, zbiory
--         zapasowe `{}` i zera dla nakładki bez treści;
--   16.   administrator innego najemcy dostaje 42501 (bramka najemcy);
--   17-19. indeksy i klucz obcy `membership_grants.source_coupon_id`
--         (definicje 1:1 jak na produkcji po 0392/0393).
--
-- WYZWALACZE UŻYTKOWNIKA NA auth.users WYŁĄCZONE - konwencja suity
-- (profiles_discoverable_opt_in_test, event_people_account_binding_test).
BEGIN;
SELECT plan(19);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── 1-8. Kształt, bezpieczeństwo, granty ───────────────────────────────────
SELECT is(
  pg_get_function_result('public.admin_event_speakers_list(uuid)'::regprocedure),
  'TABLE(entry_id uuid, speaker_profile_id uuid, user_id uuid, person_id uuid, display_name text, avatar_url text, job_title text, company text, email text, is_public boolean, sort_order integer, is_legacy boolean, headline_pl text, headline_en text, card_photo_url text, card_cta_label_pl text, card_cta_label_en text, card_cta_url text, card_cta_color text, tracks jsonb, sessions jsonb, bio_pl text, bio_en text, topics_pl text[], topics_en text[], languages text[], talks_count integer, rating numeric, reviews_count integer)',
  'admin_event_speakers_list: 21 kolumn w dotychczasowej kolejności + 8 scenicznych na końcu (stan 0148)'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.admin_event_speakers_list(uuid)'::regprocedure),
  'admin_event_speakers_list jest SECURITY DEFINER (czyta speaker_profiles bez grantu klienta)'
);
SELECT is(
  (SELECT proconfig FROM pg_proc WHERE oid = 'public.admin_event_speakers_list(uuid)'::regprocedure),
  ARRAY['search_path=public, pg_temp'],
  'admin_event_speakers_list ma przypięty search_path = public, pg_temp'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.admin_event_speakers_list(uuid)'::regprocedure AND a.grantee = 0
  ),
  'admin_event_speakers_list: PUBLIC bez EXECUTE'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_event_speakers_list(uuid)', 'EXECUTE'),
  'admin_event_speakers_list: anon bez EXECUTE (domyślne uprawnienia platformy zdjęte jawnie)'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_event_speakers_list(uuid)', 'EXECUTE'),
  'admin_event_speakers_list: authenticated z EXECUTE (panel woła RPC z przeglądarki)'
);
SELECT ok(
  has_function_privilege('service_role', 'public.admin_event_speakers_list(uuid)', 'EXECUTE'),
  'admin_event_speakers_list: service_role z EXECUTE'
);
SELECT ok(
  pg_get_functiondef('public.admin_event_speakers_list(uuid)'::regprocedure)
    LIKE '%v_tenant uuid := public.assert_event_admin_tenant();%',
  'admin_event_speakers_list bierze najemcę z sesji (assert_event_admin_tenant), nie z ładunku'
);

-- ── Fikstury ────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('d0a40000-0000-0000-0000-0000000000aa', 'dzo-a', 'Drizzle Adoption A', 'dzo-a.example'),
  ('d0a40000-0000-0000-0000-0000000000bb', 'dzo-b', 'Drizzle Adoption B', 'dzo-b.example');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('d0a10000-0000-0000-0000-0000000000a1', 'admin-a@dzo.example', now()),
  ('d0a10000-0000-0000-0000-0000000000b1', 'admin-b@dzo.example', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d0a10000-0000-0000-0000-0000000000a1', 'admin-a@dzo.example', 'DZO Admin A', 'd0a40000-0000-0000-0000-0000000000aa'),
  ('d0a10000-0000-0000-0000-0000000000b1', 'admin-b@dzo.example', 'DZO Admin B', 'd0a40000-0000-0000-0000-0000000000bb');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d0a10000-0000-0000-0000-0000000000a1', 'admin', 'd0a40000-0000-0000-0000-0000000000aa'),
  ('d0a10000-0000-0000-0000-0000000000b1', 'admin', 'd0a40000-0000-0000-0000-0000000000bb');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('d0ae0000-0000-0000-0000-0000000000e1', 'd0a40000-0000-0000-0000-0000000000aa',
   'dzo-e1', 'DZO 1', 'DZO 1', now() + interval '30 days', 'draft');

-- P1: osoba bez konta z biogramem w kartotece; nakładka ma tylko biogram EN
-- i treść sceniczną. P2: osoba bez konta, nakładka bez treści.
INSERT INTO public.event_people (id, tenant_id, first_name, last_name, bio_pl, bio_en) VALUES
  ('d0ac0000-0000-0000-0000-0000000000c1', 'd0a40000-0000-0000-0000-0000000000aa',
   'Paulina', 'Prelegentka', 'Biogram z kartoteki', 'Person bio EN'),
  ('d0ac0000-0000-0000-0000-0000000000c2', 'd0a40000-0000-0000-0000-0000000000aa',
   'Piotr', 'Pusty', NULL, NULL);
INSERT INTO public.speaker_profiles
  (id, tenant_id, person_id, bio_pl, bio_en, topics_pl, topics_en, languages, talks_count, rating, reviews_count) VALUES
  ('d0a50000-0000-0000-0000-0000000000f1', 'd0a40000-0000-0000-0000-0000000000aa',
   'd0ac0000-0000-0000-0000-0000000000c1', NULL, 'Stage bio EN', ARRAY['AI'], ARRAY['AI'], ARRAY['pl','en'], 3, 4.5, 2);
INSERT INTO public.speaker_profiles (id, tenant_id, person_id) VALUES
  ('d0a50000-0000-0000-0000-0000000000f2', 'd0a40000-0000-0000-0000-0000000000aa',
   'd0ac0000-0000-0000-0000-0000000000c2');
INSERT INTO public.event_speaker_entries (tenant_id, event_id, speaker_profile_id, sort_order) VALUES
  ('d0a40000-0000-0000-0000-0000000000aa', 'd0ae0000-0000-0000-0000-0000000000e1', 'd0a50000-0000-0000-0000-0000000000f1', 1),
  ('d0a40000-0000-0000-0000-0000000000aa', 'd0ae0000-0000-0000-0000-0000000000e1', 'd0a50000-0000-0000-0000-0000000000f2', 2);

CREATE TEMP TABLE dzo_rows AS
  SELECT * FROM public.admin_event_speakers_list('d0ae0000-0000-0000-0000-0000000000e1') WITH NO DATA;
GRANT ALL ON dzo_rows TO authenticated;

-- ── 9-15. Zachowanie: wołamy jako administrator najemcy A ──────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"dzo-a.example"}', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"d0a10000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO dzo_rows SELECT * FROM public.admin_event_speakers_list('d0ae0000-0000-0000-0000-0000000000e1');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM dzo_rows), 2, 'panel widzi obu prelegentów wydarzenia');
SELECT is(
  (SELECT bio_pl || ' | ' || bio_en FROM dzo_rows WHERE speaker_profile_id = 'd0a50000-0000-0000-0000-0000000000f1'),
  'Biogram z kartoteki | Stage bio EN',
  'biogram: nakładka ma pierwszeństwo, brak w nakładce -> kartoteka osoby (COALESCE jak w projekcji publicznej)'
);
SELECT is(
  (SELECT topics_pl FROM dzo_rows WHERE speaker_profile_id = 'd0a50000-0000-0000-0000-0000000000f1'),
  ARRAY['AI'],
  'tematy PL z nakładki scenicznej'
);
SELECT is(
  (SELECT languages FROM dzo_rows WHERE speaker_profile_id = 'd0a50000-0000-0000-0000-0000000000f1'),
  ARRAY['pl','en'],
  'języki wystąpień z nakładki scenicznej'
);
SELECT is(
  (SELECT talks_count || '/' || rating || '/' || reviews_count FROM dzo_rows WHERE speaker_profile_id = 'd0a50000-0000-0000-0000-0000000000f1'),
  '3/4.5/2',
  'liczniki (wystąpienia, ocena, recenzje) z nakładki scenicznej'
);
SELECT is(
  (SELECT bio_pl IS NULL AND bio_en IS NULL AND topics_pl = '{}' AND topics_en = '{}' AND languages = '{}'
     FROM dzo_rows WHERE speaker_profile_id = 'd0a50000-0000-0000-0000-0000000000f2'),
  true,
  'nakładka bez treści: biogram NULL, tematy i języki jako pusty zbiór, nie NULL'
);
SELECT is(
  (SELECT talks_count || '/' || rating || '/' || reviews_count FROM dzo_rows WHERE speaker_profile_id = 'd0a50000-0000-0000-0000-0000000000f2'),
  '0/0.0/0',
  'nakładka bez treści: liczniki zero'
);

-- ── 16. Bramka najemcy ─────────────────────────────────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"dzo-b.example"}', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"d0a10000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT * FROM public.admin_event_speakers_list('d0ae0000-0000-0000-0000-0000000000e1')$$,
  '42501',
  'event_speakers: event not found in tenant',
  'administrator innego najemcy nie czyta listy prelegentów cudzego wydarzenia'
);
RESET ROLE;

-- ── 17-19. membership_grants.source_coupon_id: stan z 0392/0393 ────────────
SELECT is(
  (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'membership_grants_tenant_coupon_idx'),
  'CREATE INDEX membership_grants_tenant_coupon_idx ON public.membership_grants USING btree (tenant_id, source_coupon_id) WHERE (source_coupon_id IS NOT NULL)',
  'indeks membership_grants_tenant_coupon_idx jak na produkcji (0392)'
);
SELECT is(
  (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_membership_grants_source_coupon'),
  'CREATE INDEX idx_membership_grants_source_coupon ON public.membership_grants USING btree (source_coupon_id) WHERE (source_coupon_id IS NOT NULL)',
  'indeks klucza obcego idx_membership_grants_source_coupon (ON DELETE SET NULL nie skanuje tabeli)'
);
SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.membership_grants'::regclass AND conname = 'membership_grants_source_coupon_id_fkey'),
  'FOREIGN KEY (source_coupon_id) REFERENCES b2b_coupons(id) ON DELETE SET NULL',
  'klucz obcy membership_grants_source_coupon_id_fkey: ta sama nazwa i definicja co po 0393 na produkcji'
);

SELECT * FROM finish();
ROLLBACK;
