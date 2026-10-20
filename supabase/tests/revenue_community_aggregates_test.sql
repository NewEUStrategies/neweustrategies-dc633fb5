-- pgTAP: przekroje społeczności huba (migracja 20261020130700, hub S4):
-- `admin_revenue_events_summary` i `admin_revenue_clubs_summary`.
--
-- Sprawdza:
--   * wydarzenia: kohorta po `starts_at` (bez szkiców i spoza okna),
--     zgłoszenia dopuszczone, obecność, no-show, opłacone, pula planu;
--     suma przekroju = suma `_event_revenue_net` per wydarzenie (ta sama
--     liczba co lejek studia bez okna), suma listy = suma góry, waluty
--     rozdzielne;
--   * macierz ról: kwoty tylko admin (editor: `null`, liczby osób te same),
--     autor 42501; dwóch najemców; okno niepoprawne 22023;
--   * kluby: tajny i szkic poza przekrojem (także ich zgłoszenia), członkowie
--     jako osoby, współtwórcy tylko spośród aktywnych członków (bez wpisów
--     ukrytych), aktywni = współtwórcy + czytający w oknie, lejek zgłoszeń
--     i mediana czasu decyzji, przełącznik modułu;
--   * migracja zastosowana (komentarz funkcji). Znacznik `pg-harness:
--     exclude` w pliku migracji sprawdza vitest
--     src/lib/revenue/community/__tests__/parse.test.ts (pgTAP nie czyta
--     plików), a skutek - `bun run check:pg-harness`.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test revenue_community_aggregates
BEGIN;
SELECT plan(23);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d4800000-0000-0000-0000-0000000000a0', 'hub-s4-com-a', 'Hub S4 społeczność A'),
  ('d4800000-0000-0000-0000-0000000000b0', 'hub-s4-com-b', 'Hub S4 społeczność B');

INSERT INTO auth.users (id, email) VALUES
  ('d4800000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-com.test'),
  ('d4800000-0000-0000-0000-00000000a002', 'editor-a@hub-s4-com.test'),
  ('d4800000-0000-0000-0000-00000000a003', 'author-a@hub-s4-com.test'),
  ('d4800000-0000-0000-0000-00000000a011', 'm1@hub-s4-com.test'),
  ('d4800000-0000-0000-0000-00000000a012', 'm2@hub-s4-com.test'),
  ('d4800000-0000-0000-0000-00000000a013', 'm3@hub-s4-com.test'),
  ('d4800000-0000-0000-0000-00000000a014', 'm4@hub-s4-com.test'),
  ('d4800000-0000-0000-0000-00000000b001', 'admin-b@hub-s4-com.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d4800000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-com.test', 'Admin A', 'd4800000-0000-0000-0000-0000000000a0'),
  ('d4800000-0000-0000-0000-00000000a002', 'editor-a@hub-s4-com.test', 'Editor A', 'd4800000-0000-0000-0000-0000000000a0'),
  ('d4800000-0000-0000-0000-00000000a003', 'author-a@hub-s4-com.test', 'Author A', 'd4800000-0000-0000-0000-0000000000a0'),
  ('d4800000-0000-0000-0000-00000000a011', 'm1@hub-s4-com.test', 'M1', 'd4800000-0000-0000-0000-0000000000a0'),
  ('d4800000-0000-0000-0000-00000000a012', 'm2@hub-s4-com.test', 'M2', 'd4800000-0000-0000-0000-0000000000a0'),
  ('d4800000-0000-0000-0000-00000000a013', 'm3@hub-s4-com.test', 'M3', 'd4800000-0000-0000-0000-0000000000a0'),
  ('d4800000-0000-0000-0000-00000000a014', 'm4@hub-s4-com.test', 'M4', 'd4800000-0000-0000-0000-0000000000a0'),
  ('d4800000-0000-0000-0000-00000000b001', 'admin-b@hub-s4-com.test', 'Admin B', 'd4800000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d4800000-0000-0000-0000-00000000a001', 'admin', 'd4800000-0000-0000-0000-0000000000a0'),
  ('d4800000-0000-0000-0000-00000000a002', 'editor', 'd4800000-0000-0000-0000-0000000000a0'),
  ('d4800000-0000-0000-0000-00000000a003', 'author', 'd4800000-0000-0000-0000-0000000000a0'),
  ('d4800000-0000-0000-0000-00000000b001', 'admin', 'd4800000-0000-0000-0000-0000000000b0');

-- Fikstura domen wydarzeń i klubów bez wyzwalaczy i FK (liczymy odczyt, nie
-- ścieżki zapisu - te pokrywają events-harness i pg-harness).
SET LOCAL session_replication_role = replica;

-- ── Wydarzenia ───────────────────────────────────────────────────────────────
-- A1 (zakończone 10 dni temu), A2 (3 dni temu, bez końca), A3 szkic, A4 spoza
-- okna, B1 drugiego najemcy.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status, timezone) VALUES
  ('d4800000-0000-0000-0000-0000000000e1', 'd4800000-0000-0000-0000-0000000000a0', 'hub-s4-a1', 'A1', 'A1', now() - interval '10 days', now() - interval '10 days' + interval '3 hours', 'published', 'Europe/Warsaw'),
  ('d4800000-0000-0000-0000-0000000000e2', 'd4800000-0000-0000-0000-0000000000a0', 'hub-s4-a2', 'A2', 'A2', now() - interval '3 days', NULL, 'published', 'Europe/Warsaw'),
  ('d4800000-0000-0000-0000-0000000000e3', 'd4800000-0000-0000-0000-0000000000a0', 'hub-s4-a3', 'A3', 'A3', now() - interval '5 days', NULL, 'draft', 'Europe/Warsaw'),
  ('d4800000-0000-0000-0000-0000000000e4', 'd4800000-0000-0000-0000-0000000000a0', 'hub-s4-a4', 'A4', 'A4', now() - interval '60 days', NULL, 'published', 'Europe/Warsaw'),
  ('d4800000-0000-0000-0000-0000000000f1', 'd4800000-0000-0000-0000-0000000000b0', 'hub-s4-b1', 'B1', 'B1', now() - interval '5 days', NULL, 'published', 'Europe/Warsaw');

INSERT INTO public.payment_orders (id, tenant_id, kind, status, amount_cents, currency, refunded_amount_cents, paid_at) VALUES
  ('d4800000-0000-0000-0000-0000000009b1', 'd4800000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 30000, 'PLN', 0, now()),
  ('d4800000-0000-0000-0000-0000000009b2', 'd4800000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 10000, 'EUR', 0, now()),
  ('d4800000-0000-0000-0000-0000000009b7', 'd4800000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 5000, 'PLN', 0, now()),
  ('d4800000-0000-0000-0000-0000000009b3', 'd4800000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 99999, 'PLN', 0, now()),
  ('d4800000-0000-0000-0000-0000000009b4', 'd4800000-0000-0000-0000-0000000000a0', 'one_time', 'paid', 88888, 'PLN', 0, now()),
  ('d4800000-0000-0000-0000-0000000009f1', 'd4800000-0000-0000-0000-0000000000b0', 'one_time', 'paid', 77700, 'PLN', 0, now());

-- A1: r1 opłacone + obecny, r2 opłacone EUR bez obecności (no-show po
-- zakończeniu), r3 status no_show, r4 anulowane, r5 lista rezerwowa, r6 pula
-- planu + obecny. A2: r7 opłacone + obecny. A3/A4/B1: po jednym opłaconym.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status, payment_order_id, attended_at, cancelled_at, waitlist_position)
VALUES
  ('d4800000-0000-0000-0000-00000000c001', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000000e1', 'd4800000-0000-0000-0000-00000006c001', 'approved', 'form', 'paid', 'd4800000-0000-0000-0000-0000000009b1', now() - interval '10 days', NULL, NULL),
  ('d4800000-0000-0000-0000-00000000c002', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000000e1', 'd4800000-0000-0000-0000-00000006c002', 'approved', 'form', 'paid', 'd4800000-0000-0000-0000-0000000009b2', NULL, NULL, NULL),
  ('d4800000-0000-0000-0000-00000000c003', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000000e1', 'd4800000-0000-0000-0000-00000006c003', 'no_show', 'form', 'not_required', NULL, NULL, NULL, NULL),
  ('d4800000-0000-0000-0000-00000000c004', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000000e1', 'd4800000-0000-0000-0000-00000006c004', 'cancelled', 'form', 'not_required', NULL, NULL, now(), NULL),
  ('d4800000-0000-0000-0000-00000000c005', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000000e1', 'd4800000-0000-0000-0000-00000006c005', 'waitlist', 'form', 'not_required', NULL, NULL, NULL, 1),
  ('d4800000-0000-0000-0000-00000000c006', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000000e1', 'd4800000-0000-0000-0000-00000006c006', 'attended', 'form', 'paid', NULL, now() - interval '10 days', NULL, NULL),
  ('d4800000-0000-0000-0000-00000000c007', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000000e2', 'd4800000-0000-0000-0000-00000006c007', 'attended', 'form', 'paid', 'd4800000-0000-0000-0000-0000000009b7', now() - interval '3 days', NULL, NULL),
  ('d4800000-0000-0000-0000-00000000c008', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000000e3', 'd4800000-0000-0000-0000-00000006c008', 'approved', 'form', 'paid', 'd4800000-0000-0000-0000-0000000009b3', NULL, NULL, NULL),
  ('d4800000-0000-0000-0000-00000000c009', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000000e4', 'd4800000-0000-0000-0000-00000006c009', 'approved', 'form', 'paid', 'd4800000-0000-0000-0000-0000000009b4', NULL, NULL, NULL),
  ('d4800000-0000-0000-0000-00000000c00f', 'd4800000-0000-0000-0000-0000000000b0', 'd4800000-0000-0000-0000-0000000000f1', 'd4800000-0000-0000-0000-00000006c00f', 'approved', 'form', 'paid', 'd4800000-0000-0000-0000-0000000009f1', NULL, NULL, NULL);

INSERT INTO public.plan_ticket_claims (tenant_id, user_id, event_id, tier_key, period_start, period_end, registration_id) VALUES
  ('d4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-00000000a011', 'd4800000-0000-0000-0000-0000000000e1',
   'pro', current_date - 30, current_date + 30, 'd4800000-0000-0000-0000-00000000c006');

INSERT INTO public.event_package_orders (id, tenant_id, event_id, package_id, buyer_email, seats_total, status, amount_cents, currency, paid_at) VALUES
  ('d4800000-0000-0000-0000-00000000e001', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000000e2',
   'd4800000-0000-0000-0000-00000000f001', 'firma@hub-s4-com.test', 4, 'paid', 20000, 'PLN', now());

-- ── Kluby ────────────────────────────────────────────────────────────────────
-- C1 członkowski, C2 publiczny, CS tajny, CD szkic.
INSERT INTO public.clubs (id, tenant_id, slug, name_pl, name_en, visibility, status) VALUES
  ('d4800000-0000-0000-0000-0000000002c1', 'd4800000-0000-0000-0000-0000000000a0', 'hub-s4-c1', 'C1', 'C1', 'members', 'active'),
  ('d4800000-0000-0000-0000-0000000002c2', 'd4800000-0000-0000-0000-0000000000a0', 'hub-s4-c2', 'C2', 'C2', 'public', 'active'),
  ('d4800000-0000-0000-0000-0000000002c5', 'd4800000-0000-0000-0000-0000000000a0', 'hub-s4-tajny', 'Tajny', 'Secret', 'secret', 'active'),
  ('d4800000-0000-0000-0000-0000000002cd', 'd4800000-0000-0000-0000-0000000000a0', 'hub-s4-szkic', 'Szkic', 'Draft', 'members', 'draft');

INSERT INTO public.club_members (tenant_id, club_id, user_id, status, last_read_at) VALUES
  ('d4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c1', 'd4800000-0000-0000-0000-00000000a011', 'active', now() - interval '1 day'),
  ('d4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c1', 'd4800000-0000-0000-0000-00000000a012', 'active', NULL),
  ('d4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c1', 'd4800000-0000-0000-0000-00000000a013', 'left', now() - interval '1 day'),
  ('d4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c1', 'd4800000-0000-0000-0000-00000000a014', 'active', now() - interval '90 days'),
  ('d4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c2', 'd4800000-0000-0000-0000-00000000a011', 'active', now() - interval '90 days'),
  ('d4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c5', 'd4800000-0000-0000-0000-00000000a012', 'active', now() - interval '1 day'),
  ('d4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c5', 'd4800000-0000-0000-0000-00000000a013', 'active', now() - interval '1 day');

-- m2 pisze w C1 (współtwórca); m3 (już poza klubem) odpowiada w C1 - nie
-- liczy się; m1 ma w C2 wątek ukryty - nie liczy się; m3 pisze w tajnym.
INSERT INTO public.club_threads (id, tenant_id, club_id, group_id, author_id, slug, title, body, status, created_at) VALUES
  ('d4800000-0000-0000-0000-0000000003a1', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c1', 'd4800000-0000-0000-0000-0000000004c1',
   'd4800000-0000-0000-0000-00000000a012', 'hub-s4-t1', 'Wątek', 'Treść wątku testowego', 'open', now() - interval '2 days'),
  ('d4800000-0000-0000-0000-0000000003a2', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c2', 'd4800000-0000-0000-0000-0000000004c2',
   'd4800000-0000-0000-0000-00000000a011', 'hub-s4-t2', 'Ukryty', 'Treść wątku ukrytego', 'hidden', now() - interval '2 days'),
  ('d4800000-0000-0000-0000-0000000003a5', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c5', 'd4800000-0000-0000-0000-0000000004c5',
   'd4800000-0000-0000-0000-00000000a013', 'hub-s4-t5', 'Tajny', 'Treść wątku tajnego', 'open', now() - interval '2 days');
INSERT INTO public.club_replies (tenant_id, club_id, thread_id, author_id, body, status, created_at) VALUES
  ('d4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-0000000002c1', 'd4800000-0000-0000-0000-0000000003a1',
   'd4800000-0000-0000-0000-00000000a013', 'Odpowiedź', 'visible', now() - interval '1 day');

-- Zgłoszenia: app1 C1 otwarte; app2 C1 przyjęte po 24 h; app3 C1 odrzucone po
-- 12 h; app4 do tajnego; app5 bez klubu (sama specjalizacja) otwarte; app6
-- przyjęte poza oknem.
INSERT INTO public.club_applications (id, tenant_id, user_id, specialization_slug, club_id, first_name, email, status, created_at, reviewed_at) VALUES
  ('d4800000-0000-0000-0000-0000000005a1', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-00000000a011', 'c1', 'd4800000-0000-0000-0000-0000000002c1', 'A', 'a1@hub-s4-com.test', 'pending', now() - interval '5 days', NULL),
  ('d4800000-0000-0000-0000-0000000005a2', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-00000000a012', 'c1', 'd4800000-0000-0000-0000-0000000002c1', 'A', 'a2@hub-s4-com.test', 'accepted', now() - interval '20 days', now() - interval '19 days'),
  ('d4800000-0000-0000-0000-0000000005a3', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-00000000a013', 'c1b', 'd4800000-0000-0000-0000-0000000002c1', 'A', 'a3@hub-s4-com.test', 'rejected', now() - interval '10 days', now() - interval '10 days' + interval '12 hours'),
  ('d4800000-0000-0000-0000-0000000005a4', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-00000000a014', 'tajne', 'd4800000-0000-0000-0000-0000000002c5', 'A', 'a4@hub-s4-com.test', 'pending', now() - interval '4 days', NULL),
  ('d4800000-0000-0000-0000-0000000005a5', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-00000000a014', 'energia', NULL, 'A', 'a5@hub-s4-com.test', 'review', now() - interval '2 days', NULL),
  ('d4800000-0000-0000-0000-0000000005a6', 'd4800000-0000-0000-0000-0000000000a0', 'd4800000-0000-0000-0000-00000000a012', 'c1c', 'd4800000-0000-0000-0000-0000000002c1', 'A', 'a6@hub-s4-com.test', 'accepted', now() - interval '100 days', now() - interval '90 days');

INSERT INTO public.site_settings (tenant_id, key, value) VALUES
  ('d4800000-0000-0000-0000-0000000000a0', 'community_modules', '{"clubs_enabled": true}'::jsonb)
ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value;

SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE TEMP TABLE res (name text PRIMARY KEY, r jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT ON res TO authenticated;

-- ── 1. ACL i znacznik harnessu ──────────────────────────────────────────────
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_revenue_events_summary(timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_revenue_events_summary(timestamptz,timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_revenue_clubs_summary(timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_revenue_clubs_summary(timestamptz,timestamptz)', 'EXECUTE'),
  'acl: oba przekroje dla authenticated (bramka w ciele), nie dla anon');
SELECT ok(
  (SELECT obj_description('public.admin_revenue_clubs_summary(timestamptz,timestamptz)'::regprocedure, 'pg_proc') LIKE 'Hub S4:%'),
  'migracja 20261020130700 zastosowana (komentarz funkcji z hubu S4)');

-- ── 2. Admin A ───────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('d4800000-0000-0000-0000-00000000a001');
SET LOCAL ROLE authenticated;
INSERT INTO res VALUES
  ('ev_admin', public.admin_revenue_events_summary(now() - interval '30 days', now() + interval '1 day')),
  ('cl_admin', public.admin_revenue_clubs_summary(now() - interval '30 days', now() + interval '1 day'));
RESET ROLE;

SELECT is(
  (SELECT jsonb_build_object('events', r -> 'events_count', 'registrations', r -> 'registrations',
                             'attended', r -> 'attended', 'no_show', r -> 'no_show',
                             'paid', r -> 'paid', 'plan_pool', r -> 'plan_pool',
                             'money_visible', r -> 'money_visible')
     FROM res WHERE name = 'ev_admin'),
  '{"events": 2, "registrations": 5, "attended": 3, "no_show": 2, "paid": 4, "plan_pool": 1, "money_visible": true}'::jsonb,
  'wydarzenia: kohorta okna bez szkicu i spoza okna; dopuszczeni, obecni, no-show, opłaceni, pula planu');
SELECT is(
  (SELECT r -> 'by_currency' FROM res WHERE name = 'ev_admin'),
  '[{"currency": "EUR", "ticket_revenue_net_minor": 10000}, {"currency": "PLN", "ticket_revenue_net_minor": 55000}]'::jsonb,
  'wydarzenia: przychód netto per waluta (bez sumowania walut), pakiet wliczony');
SELECT is(
  (SELECT r -> 'by_currency' FROM res WHERE name = 'ev_admin'),
  (SELECT jsonb_agg(jsonb_build_object('currency', x.currency, 'ticket_revenue_net_minor', x.s) ORDER BY x.currency)
     FROM (SELECT n.currency, sum(n.net_minor)::bigint AS s
             FROM public.events e
            CROSS JOIN LATERAL public._event_revenue_net(e.tenant_id, e.id, NULL, NULL) n
            WHERE e.tenant_id = 'd4800000-0000-0000-0000-0000000000a0' AND e.status <> 'draft'
              AND e.starts_at >= now() - interval '30 days' AND e.starts_at < now() + interval '1 day'
            GROUP BY n.currency) x),
  'wydarzenia: suma przekroju = suma _event_revenue_net per wydarzenie (jedno źródło z lejkiem studia)');
SELECT is(
  (SELECT jsonb_agg(jsonb_build_object('currency', x.currency, 'ticket_revenue_net_minor', x.s) ORDER BY x.currency)
     FROM (SELECT b ->> 'currency' AS currency, sum((b ->> 'ticket_revenue_net_minor')::bigint) AS s
             FROM res, jsonb_array_elements(r -> 'events') e, jsonb_array_elements(e -> 'by_currency') b
            WHERE name = 'ev_admin'
            GROUP BY 1) x),
  (SELECT r -> 'by_currency' FROM res WHERE name = 'ev_admin'),
  'wydarzenia: suma listy per wydarzenie = suma najwyższego poziomu');
SELECT is(
  (SELECT string_agg((e ->> 'slug') || ':' || (e ->> 'registrations') || '/' || (e ->> 'paid'), ',' ORDER BY e ->> 'slug')
     FROM res, jsonb_array_elements(r -> 'events') e WHERE name = 'ev_admin'),
  'hub-s4-a1:4/2,hub-s4-a2:1/2',
  'wydarzenia: wiersze per wydarzenie (A1: 4 dopuszczonych, 2 opłacone; A2: zgłoszenie + pakiet)');

SELECT is(
  (SELECT jsonb_build_object('clubs', r -> 'clubs_count', 'members', r -> 'members',
                             'active', r -> 'active_members', 'contributors', r -> 'contributors',
                             'enabled', r -> 'clubs_enabled')
     FROM res WHERE name = 'cl_admin'),
  '{"clubs": 2, "members": 3, "active": 2, "contributors": 1, "enabled": true}'::jsonb,
  'kluby: bez tajnego i szkicu; członkowie jako osoby; współtwórcy tylko aktywni, bez ukrytych; aktywni = współtwórcy + czytający');
SELECT is(
  (SELECT r -> 'applications' FROM res WHERE name = 'cl_admin'),
  '{"submitted": 4, "accepted": 1, "rejected": 1, "pending": 2}'::jsonb,
  'kluby: lejek zgłoszeń (tajny poza, zgłoszenie bez klubu liczone, decyzje w oknie)');
SELECT is(
  (SELECT (r ->> 'decision_hours_median')::numeric FROM res WHERE name = 'cl_admin'),
  18.00::numeric, 'kluby: mediana godzin do decyzji (24 h i 12 h)');
SELECT is(
  (SELECT string_agg((c ->> 'slug') || ':' || (c ->> 'members') || '/' || (c ->> 'active_members') || '/'
                     || (c ->> 'contributors') || '/' || (c ->> 'applications_submitted') || '/'
                     || (c ->> 'applications_accepted') || '/' || (c ->> 'applications_rejected'), ','
                     ORDER BY c ->> 'slug')
     FROM res, jsonb_array_elements(r -> 'clubs') c WHERE name = 'cl_admin'),
  'hub-s4-c1:3/2/1/3/1/1,hub-s4-c2:1/0/0/0/0/0',
  'kluby: wiersze per klub (członkowie/aktywni/współtwórcy/zgłoszone/przyjęte/odrzucone)');
SELECT ok(
  (SELECT r::text NOT LIKE '%hub-s4-tajny%' AND r::text NOT LIKE '%d4800000-0000-0000-0000-0000000002c5%'
     FROM res WHERE name = 'cl_admin'),
  'kluby: tajny klub nie pojawia się w wyniku ani po slugu, ani po id');

-- ── 3. Editor A: liczby tak, kwoty nie ──────────────────────────────────────
SELECT pg_temp.as_user('d4800000-0000-0000-0000-00000000a002');
SET LOCAL ROLE authenticated;
INSERT INTO res VALUES
  ('ev_editor', public.admin_revenue_events_summary(now() - interval '30 days', now() + interval '1 day'));
SELECT lives_ok(
  $$ SELECT public.admin_revenue_clubs_summary(now() - interval '30 days', now()) $$,
  'editor: przekrój klubów dostępny');
RESET ROLE;
SELECT is(
  (SELECT (r -> 'money_visible')::text || '|' || COALESCE(jsonb_typeof(r -> 'by_currency'), 'null') FROM res WHERE name = 'ev_editor'),
  'false|null', 'editor: kwoty null (brak danych, nie zero)');
SELECT ok(
  (SELECT bool_and(NOT (e ? 'by_currency') OR jsonb_typeof(e -> 'by_currency') = 'null')
     FROM res, jsonb_array_elements(r -> 'events') e WHERE name = 'ev_editor'),
  'editor: kwoty per wydarzenie też null');
SELECT is(
  (SELECT r -> 'registrations' FROM res WHERE name = 'ev_editor'),
  (SELECT r -> 'registrations' FROM res WHERE name = 'ev_admin'),
  'editor: liczby osób te same co u admina');

-- ── 4. Autor, okno, drugi najemca ───────────────────────────────────────────
SELECT pg_temp.as_user('d4800000-0000-0000-0000-00000000a003');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_revenue_events_summary(now() - interval '30 days', now()) $$,
  '42501', 'forbidden', 'autor: przekrój wydarzeń 42501');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_clubs_summary(now() - interval '30 days', now()) $$,
  '42501', 'forbidden', 'autor: przekrój klubów 42501');
RESET ROLE;

SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_revenue_events_summary(now() - interval '30 days', now()) $$,
  '42501', 'forbidden', 'bez sesji: 42501');
RESET ROLE;

SELECT pg_temp.as_user('d4800000-0000-0000-0000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_revenue_events_summary(now(), now() - interval '1 day') $$,
  '22023', 'window_invalid', 'okno: koniec przed początkiem = 22023');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_clubs_summary(now() - interval '401 days', now()) $$,
  '22023', 'window_invalid', 'okno: ponad 400 dni = 22023');
RESET ROLE;

SELECT pg_temp.as_user('d4800000-0000-0000-0000-00000000b001');
SET LOCAL ROLE authenticated;
INSERT INTO res VALUES
  ('ev_b', public.admin_revenue_events_summary(now() - interval '30 days', now() + interval '1 day')),
  ('cl_b', public.admin_revenue_clubs_summary(now() - interval '30 days', now() + interval '1 day'));
RESET ROLE;
SELECT is(
  (SELECT (r ->> 'events_count') || '|' || (r -> 'by_currency')::text FROM res WHERE name = 'ev_b'),
  '1|[{"currency": "PLN", "ticket_revenue_net_minor": 77700}]',
  'izolacja: najemca B widzi wyłącznie swoje wydarzenie i przychód');
SELECT is(
  (SELECT (r ->> 'clubs_count') || '|' || (r ->> 'members') || '|' || (r -> 'applications' ->> 'submitted')
          || '|' || (r ->> 'clubs_enabled') || '|' || COALESCE(r ->> 'decision_hours_median', 'null')
     FROM res WHERE name = 'cl_b'),
  '0|0|0|false|null',
  'izolacja: najemca B bez klubów A; moduł wyłączony bez ustawienia; mediana null bez decyzji');

SELECT * FROM finish();
ROLLBACK;
