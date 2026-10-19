-- pgTAP: agregat zdrowia e-mail huba (S1, migracja 20261020100300).
--
-- CO PRZYPINA:
--   * liczniki na fiksturze kampanii najemcy A (okno wrzesień 2026):
--     wysłane, doręczone, unikalne otwarcia/kliknięcia (per kampania, sumowane
--     - ten sam człowiek w dwóch kampaniach liczy się dwa razy, dwa otwarcia
--     w jednej kampanii - raz), odbicia twarde/miękkie, skargi, wypisy
--     w 7 dni od wysyłki, stan listy (start/koniec/nowi/wypisani/netto),
--     DOI potwierdzone w 7 dni;
--   * `null` zamiast zera: okno bez wysyłek (wskaźniki kampanii), kohorta bez
--     sygnału dostawcy (doręczenia/odbicia/skargi), DOI bez zapisów;
--   * kształt jsonb (`-- rpc-shape` w src/lib/revenue/email/parse.ts) - bez
--     pól kwotowych, więc editor dostaje pełny wynik; autor -> 42501;
--   * dwaj najemcy: dane B nie wchodzą do wyniku A i odwrotnie;
--   * `window_invalid` (22023): koniec <= początek, okno > 400 dni, NULL.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test email_health_aggregate
BEGIN;
SELECT plan(24);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c4000000-0000-0000-0000-0000000000a0', 'hub-s1-eh-a', 'Hub S1 e-mail A'),
  ('c4000000-0000-0000-0000-0000000000b0', 'hub-s1-eh-b', 'Hub S1 e-mail B');

INSERT INTO auth.users (id, email) VALUES
  ('c4000000-0000-0000-0000-00000000a001', 'admin-a@hub-s1-eh.test'),
  ('c4000000-0000-0000-0000-00000000a002', 'editor-a@hub-s1-eh.test'),
  ('c4000000-0000-0000-0000-00000000a003', 'author-a@hub-s1-eh.test'),
  ('c4000000-0000-0000-0000-00000000b001', 'admin-b@hub-s1-eh.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c4000000-0000-0000-0000-00000000a001', 'admin-a@hub-s1-eh.test', 'Admin A', 'c4000000-0000-0000-0000-0000000000a0'),
  ('c4000000-0000-0000-0000-00000000a002', 'editor-a@hub-s1-eh.test', 'Editor A', 'c4000000-0000-0000-0000-0000000000a0'),
  ('c4000000-0000-0000-0000-00000000a003', 'author-a@hub-s1-eh.test', 'Author A', 'c4000000-0000-0000-0000-0000000000a0'),
  ('c4000000-0000-0000-0000-00000000b001', 'admin-b@hub-s1-eh.test', 'Admin B', 'c4000000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c4000000-0000-0000-0000-00000000a001', 'admin', 'c4000000-0000-0000-0000-0000000000a0'),
  ('c4000000-0000-0000-0000-00000000a002', 'editor', 'c4000000-0000-0000-0000-0000000000a0'),
  ('c4000000-0000-0000-0000-00000000a003', 'author', 'c4000000-0000-0000-0000-0000000000a0'),
  ('c4000000-0000-0000-0000-00000000b001', 'admin', 'c4000000-0000-0000-0000-0000000000b0');

-- Subskrybenci A (okno: 2026-09-01 .. 2026-10-01):
--   s1 na liście od sierpnia; s2 od sierpnia, wypis 10.09; s3 nowy 05.09
--   (bez DOI); s4 DOI 02.09 niepotwierdzony; s5 DOI 03.09, potwierdzony 05.09;
--   s6 DOI 04.09, potwierdzony po 16 dniach; s7 wypisany w lutym; s8 dopisany
--   po oknie.
INSERT INTO public.newsletter_subscribers
  (id, tenant_id, email, status, created_at, confirmed_at, unsubscribed_at, confirmation_token) VALUES
  ('c4000000-0000-0000-0000-0000000005a1', 'c4000000-0000-0000-0000-0000000000a0', 's1@hub-s1-eh.test', 'subscribed',   '2026-08-01', '2026-08-01', NULL, NULL),
  ('c4000000-0000-0000-0000-0000000005a2', 'c4000000-0000-0000-0000-0000000000a0', 's2@hub-s1-eh.test', 'unsubscribed', '2026-08-05', '2026-08-05', '2026-09-10', NULL),
  ('c4000000-0000-0000-0000-0000000005a3', 'c4000000-0000-0000-0000-0000000000a0', 's3@hub-s1-eh.test', 'subscribed',   '2026-09-05', '2026-09-05', NULL, NULL),
  ('c4000000-0000-0000-0000-0000000005a4', 'c4000000-0000-0000-0000-0000000000a0', 's4@hub-s1-eh.test', 'pending',      '2026-09-02', NULL, NULL, 'tok-eh-4'),
  ('c4000000-0000-0000-0000-0000000005a5', 'c4000000-0000-0000-0000-0000000000a0', 's5@hub-s1-eh.test', 'subscribed',   '2026-09-03', '2026-09-05', NULL, 'tok-eh-5'),
  ('c4000000-0000-0000-0000-0000000005a6', 'c4000000-0000-0000-0000-0000000000a0', 's6@hub-s1-eh.test', 'subscribed',   '2026-09-04', '2026-09-20', NULL, 'tok-eh-6'),
  ('c4000000-0000-0000-0000-0000000005a7', 'c4000000-0000-0000-0000-0000000000a0', 's7@hub-s1-eh.test', 'unsubscribed', '2026-01-01', '2026-01-01', '2026-02-01', NULL),
  ('c4000000-0000-0000-0000-0000000005a8', 'c4000000-0000-0000-0000-0000000000a0', 's8@hub-s1-eh.test', 'subscribed',   '2026-10-05', '2026-10-05', NULL, NULL),
  ('c4000000-0000-0000-0000-0000000005b1', 'c4000000-0000-0000-0000-0000000000b0', 'b1@hub-s1-eh.test', 'subscribed',   '2026-08-01', '2026-08-01', NULL, NULL);

-- Kampanie: c1 (wrzesień), c2 (sierpień - poza oknem), c3 (20.09, bez
-- sygnału dostawcy), cb (najemca B).
INSERT INTO public.newsletter_campaigns (id, tenant_id, name, status) VALUES
  ('c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000000a0', 'Wrzesień', 'sent'),
  ('c4000000-0000-0000-0000-0000000006a2', 'c4000000-0000-0000-0000-0000000000a0', 'Sierpień', 'sent'),
  ('c4000000-0000-0000-0000-0000000006a3', 'c4000000-0000-0000-0000-0000000000a0', 'Wrzesień bis', 'sent'),
  ('c4000000-0000-0000-0000-0000000006b1', 'c4000000-0000-0000-0000-0000000000b0', 'B wrzesień', 'sent');

INSERT INTO public.newsletter_campaign_recipients
  (tenant_id, campaign_id, subscriber_id, email, status, sent_at, delivery_state, delivered_at, bounced_at, complained_at, bounce_class) VALUES
  -- c1: doręczony; doręczony (wypis 2 dni później); odbicie twarde; odbicie miękkie; skarga.
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a1', 's1@hub-s1-eh.test', 'sent', '2026-09-08', 'delivered', '2026-09-08', NULL, NULL, NULL),
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a2', 's2@hub-s1-eh.test', 'sent', '2026-09-08', 'delivered', '2026-09-08', NULL, NULL, NULL),
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a3', 's3@hub-s1-eh.test', 'sent', '2026-09-08', 'bounced', NULL, '2026-09-08', NULL, 'hard'),
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a5', 's5@hub-s1-eh.test', 'sent', '2026-09-08', 'bounced', NULL, '2026-09-08', NULL, 'soft'),
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a6', 's6@hub-s1-eh.test', 'sent', '2026-09-08', 'complained', '2026-09-08', NULL, '2026-09-09', NULL),
  -- c1: nieudana próba (nie wchodzi do kohorty).
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a4', 's4@hub-s1-eh.test', 'failed', NULL, 'failed', NULL, NULL, NULL, NULL),
  -- c2: sierpień (poza oknem).
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a2', 'c4000000-0000-0000-0000-0000000005a1', 's1@hub-s1-eh.test', 'sent', '2026-08-20', 'delivered', '2026-08-20', NULL, NULL, NULL),
  -- c3: 20.09, wysłany, bez sygnału dostawcy.
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a3', 'c4000000-0000-0000-0000-0000000005a1', 's1@hub-s1-eh.test', 'sent', '2026-09-20', 'sent', NULL, NULL, NULL, NULL),
  -- cb: najemca B.
  ('c4000000-0000-0000-0000-0000000000b0', 'c4000000-0000-0000-0000-0000000006b1', 'c4000000-0000-0000-0000-0000000005b1', 'b1@hub-s1-eh.test', 'sent', '2026-09-10', 'delivered', '2026-09-10', NULL, NULL, NULL);

-- Zdarzenia: s1 otwiera c1 dwa razy (dwie doby) i klika; s2 otwiera c1;
-- s6 klika c1; s1 otwiera c2 (poza oknem) i c3; b1 otwiera cb.
INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind, created_at) VALUES
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a1', 'open',  '2026-09-08 10:00+00'),
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a1', 'open',  '2026-09-09 10:00+00'),
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a1', 'click', '2026-09-08 10:05+00'),
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a2', 'open',  '2026-09-08 11:00+00'),
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a1', 'c4000000-0000-0000-0000-0000000005a6', 'click', '2026-09-08 12:00+00'),
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a2', 'c4000000-0000-0000-0000-0000000005a1', 'open',  '2026-08-20 10:00+00'),
  ('c4000000-0000-0000-0000-0000000000a0', 'c4000000-0000-0000-0000-0000000006a3', 'c4000000-0000-0000-0000-0000000005a1', 'open',  '2026-09-20 10:00+00'),
  ('c4000000-0000-0000-0000-0000000000b0', 'c4000000-0000-0000-0000-0000000006b1', 'c4000000-0000-0000-0000-0000000005b1', 'open',  '2026-09-10 10:00+00');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE TEMP TABLE res (name text PRIMARY KEY, r jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT ON res TO authenticated;

-- ── 1. ACL i role ────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_revenue_email_health(timestamptz, timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_revenue_email_health(timestamptz, timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.admin_revenue_email_health(timestamptz, timestamptz)', 'EXECUTE'),
  'acl: RPC dla authenticated i service_role, nie dla anon');

SELECT pg_temp.as_user('c4000000-0000-0000-0000-00000000a003');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_revenue_email_health('2026-09-01', '2026-10-01') $$,
  '42501', 'forbidden', 'role: autor -> 42501');

-- Editor - pełny wynik (RPC nie ma kwot).
SELECT pg_temp.as_user('c4000000-0000-0000-0000-00000000a002');
INSERT INTO res (name, r) SELECT 'a_sep', public.admin_revenue_email_health('2026-09-01', '2026-10-01');
RESET ROLE;

-- ── 2. Kształt ───────────────────────────────────────────────────────────────
SELECT set_eq(
  $$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'a_sep' $$,
  ARRAY['since', 'until', 'campaigns', 'list', 'doi'],
  'kształt: klucze najwyższego poziomu');
SELECT set_eq(
  $$ SELECT jsonb_object_keys(r -> 'campaigns') FROM res WHERE name = 'a_sep' $$,
  ARRAY['sent', 'delivered', 'unique_opens', 'unique_clicks', 'hard_bounces', 'soft_bounces', 'complaints', 'unsubscribes'],
  'kształt: pola kampanii (bez kwot)');
SELECT set_eq(
  $$ SELECT jsonb_object_keys(r -> 'list') FROM res WHERE name = 'a_sep' $$,
  ARRAY['start', 'end', 'new', 'unsubscribed', 'net_growth'],
  'kształt: pola listy');
SELECT set_eq(
  $$ SELECT jsonb_object_keys(r -> 'doi') FROM res WHERE name = 'a_sep' $$,
  ARRAY['started', 'confirmed_7d'],
  'kształt: pola DOI');

-- ── 3. Liczniki kampanii (editor, najemca A, wrzesień) ──────────────────────
SELECT is((SELECT r -> 'campaigns' -> 'sent' FROM res WHERE name = 'a_sep'), '6'::jsonb,
  'kampanie: wysłane = 5 (c1) + 1 (c3); nieudana próba i sierpień poza kohortą');
SELECT is((SELECT r -> 'campaigns' -> 'delivered' FROM res WHERE name = 'a_sep'), '3'::jsonb,
  'kampanie: doręczone = 2 doręczone + 1 skarga (skarga przychodzi po doręczeniu)');
SELECT is((SELECT r -> 'campaigns' -> 'unique_opens' FROM res WHERE name = 'a_sep'), '3'::jsonb,
  'kampanie: unikalne otwarcia = c1 {s1, s2} + c3 {s1}; dwa otwarcia s1 w c1 liczą się raz');
SELECT is((SELECT r -> 'campaigns' -> 'unique_clicks' FROM res WHERE name = 'a_sep'), '2'::jsonb,
  'kampanie: unikalne kliknięcia = c1 {s1, s6}');
SELECT results_eq(
  $$ SELECT (r -> 'campaigns' ->> 'hard_bounces')::int, (r -> 'campaigns' ->> 'soft_bounces')::int,
            (r -> 'campaigns' ->> 'complaints')::int FROM res WHERE name = 'a_sep' $$,
  $$ VALUES (1, 1, 1) $$,
  'kampanie: odbicia twarde 1, miękkie 1, skargi 1');
SELECT is((SELECT r -> 'campaigns' -> 'unsubscribes' FROM res WHERE name = 'a_sep'), '1'::jsonb,
  'kampanie: wypisy = s2 (2 dni po wysyłce c1, okno atrybucji 7 dni)');

-- ── 4. Lista i DOI ───────────────────────────────────────────────────────────
SELECT is((SELECT r -> 'list' FROM res WHERE name = 'a_sep'),
  '{"start":2,"end":4,"new":3,"unsubscribed":1,"net_growth":2}'::jsonb,
  'lista: start {s1,s2}, koniec {s1,s3,s5,s6}, nowi {s3,s5,s6}, wypisani {s2}, netto = koniec - start');
SELECT is((SELECT r -> 'doi' FROM res WHERE name = 'a_sep'),
  '{"started":3,"confirmed_7d":1}'::jsonb,
  'doi: zaczęte {s4,s5,s6} (s3 bez DOI), potwierdzone w 7 dni {s5}');
SELECT is((SELECT r ->> 'since' FROM res WHERE name = 'a_sep')::timestamptz, '2026-09-01'::timestamptz,
  'kształt: since = początek okna');

-- ── 5. null zamiast zera ────────────────────────────────────────────────────
SELECT pg_temp.as_user('c4000000-0000-0000-0000-00000000a001');
INSERT INTO res (name, r) SELECT 'a_jun', public.admin_revenue_email_health('2026-06-01', '2026-07-01');
SELECT is((SELECT r -> 'campaigns' FROM res WHERE name = 'a_jun'),
  '{"sent":0,"delivered":null,"unique_opens":null,"unique_clicks":null,"hard_bounces":null,"soft_bounces":null,"complaints":null,"unsubscribes":null}'::jsonb,
  'null: okno bez wysyłek -> sent 0, reszta wskaźników kampanii null (nie 0)');
SELECT is((SELECT r -> 'doi' FROM res WHERE name = 'a_jun'), '{"started":0,"confirmed_7d":null}'::jsonb,
  'null: DOI bez zapisów -> confirmed_7d null');
SELECT is((SELECT r -> 'list' -> 'start' FROM res WHERE name = 'a_jun'), '0'::jsonb,
  'lista: w czerwcu na liście nikt (s7 odszedł w lutym, reszta później)');

INSERT INTO res (name, r) SELECT 'a_c3', public.admin_revenue_email_health('2026-09-19', '2026-09-21');
SELECT results_eq(
  $$ SELECT (r -> 'campaigns' ->> 'sent')::int, r -> 'campaigns' -> 'delivered', r -> 'campaigns' -> 'hard_bounces',
            (r -> 'campaigns' ->> 'unique_opens')::int FROM res WHERE name = 'a_c3' $$,
  $$ VALUES (1, 'null'::jsonb, 'null'::jsonb, 1) $$,
  'null: kohorta bez sygnału dostawcy -> doręczenia/odbicia null, otwarcia policzone');

-- ── 6. Dwaj najemcy ──────────────────────────────────────────────────────────
SELECT pg_temp.as_user('c4000000-0000-0000-0000-00000000b001');
INSERT INTO res (name, r) SELECT 'b_sep', public.admin_revenue_email_health('2026-09-01', '2026-10-01');
SELECT results_eq(
  $$ SELECT (r -> 'campaigns' ->> 'sent')::int, (r -> 'campaigns' ->> 'delivered')::int,
            (r -> 'campaigns' ->> 'unique_opens')::int, (r -> 'list' ->> 'end')::int FROM res WHERE name = 'b_sep' $$,
  $$ VALUES (1, 1, 1, 1) $$,
  'izolacja: admin B widzi wyłącznie wysyłkę, otwarcie i listę najemcy B');
SELECT is((SELECT (r -> 'campaigns' ->> 'sent')::int FROM res WHERE name = 'a_sep'), 6,
  'izolacja: wynik A nie zawiera wysyłki B');

-- ── 7. window_invalid ────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.admin_revenue_email_health('2026-10-01', '2026-09-01') $$,
  '22023', 'window_invalid', 'okno: koniec przed początkiem -> 22023');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_email_health('2025-01-01', '2026-10-01') $$,
  '22023', 'window_invalid', 'okno: dłuższe niż 400 dni -> 22023');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_email_health(NULL, '2026-10-01') $$,
  '22023', 'window_invalid', 'okno: NULL -> 22023');

SELECT * FROM finish();
ROLLBACK;
