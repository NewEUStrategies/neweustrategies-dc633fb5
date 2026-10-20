-- pgTAP: trasa szyny do skrzynki ścieżek, rozpoznanie kontaktu i zapis na
-- ścieżkę (migracja 20261020140000, hub S5).
--
-- Sprawdza:
--   * trasa -> skrzynka (zdarzenie z trasą trafia raz, bez trasy - wcale),
--     idempotencja skrzynki po `event_id`, izolacja najemców;
--   * agregaty `journey` i `revenue_diagnostic` pomijane (brak pętli);
--   * resolver: `user_id`, `person_id` (lead bez zgody), agregat zgłoszenia
--     wydarzenia (rezygnacja), `member_user_id`,
--     `actor_id` (spoza personelu), agregat `crm_lead`; klub `secret`,
--     zdarzenie anonimowe i aktor-redaktor = brak kontaktu;
--   * ingest: zapis raz (`never`), zdarzenie sprzed `published_at` nie
--     zapisuje, wyłączony silnik najemcy nie zapisuje;
--   * ACL: funkcje silnika wyłącznie dla service_role.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test journeys_routing
BEGIN;
SELECT plan(24);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('e5100000-0000-0000-0000-0000000000a0', 'hub-s5-route-a', 'Hub S5 trasa A'),
  ('e5100000-0000-0000-0000-0000000000b0', 'hub-s5-route-b', 'Hub S5 trasa B');

INSERT INTO auth.users (id, email) VALUES
  ('e5100000-0000-0000-0000-00000000a001', 'admin-a@hub-s5-route.test'),
  ('e5100000-0000-0000-0000-00000000a003', 'czytelnik-a@hub-s5-route.test'),
  ('e5100000-0000-0000-0000-00000000a004', 'klubowicz-a@hub-s5-route.test'),
  ('e5100000-0000-0000-0000-00000000a005', 'aktor-a@hub-s5-route.test'),
  ('e5100000-0000-0000-0000-00000000b003', 'czytelnik-b@hub-s5-route.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e5100000-0000-0000-0000-00000000a001', 'admin-a@hub-s5-route.test', 'Admin A', 'e5100000-0000-0000-0000-0000000000a0'),
  ('e5100000-0000-0000-0000-00000000a003', 'czytelnik-a@hub-s5-route.test', 'Czytelnik A', 'e5100000-0000-0000-0000-0000000000a0'),
  ('e5100000-0000-0000-0000-00000000a004', 'klubowicz-a@hub-s5-route.test', 'Klubowicz A', 'e5100000-0000-0000-0000-0000000000a0'),
  ('e5100000-0000-0000-0000-00000000a005', 'aktor-a@hub-s5-route.test', 'Aktor A', 'e5100000-0000-0000-0000-0000000000a0'),
  ('e5100000-0000-0000-0000-00000000b003', 'czytelnik-b@hub-s5-route.test', 'Czytelnik B', 'e5100000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e5100000-0000-0000-0000-00000000a001', 'admin', 'e5100000-0000-0000-0000-0000000000a0');

-- Leady kont (wyzwalacz profilu zakłada je sam; ON CONFLICT na wypadek jego braku).
INSERT INTO public.crm_leads (tenant_id, email, email_norm, user_id)
SELECT p.tenant_id, p.email, p.email, p.id FROM public.profiles p
 WHERE p.id IN ('e5100000-0000-0000-0000-00000000a003', 'e5100000-0000-0000-0000-00000000a004',
                'e5100000-0000-0000-0000-00000000a005', 'e5100000-0000-0000-0000-00000000b003')
   AND NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.tenant_id = p.tenant_id AND l.email_norm = p.email);
UPDATE public.crm_leads l SET user_id = p.id
  FROM public.profiles p
 WHERE l.tenant_id = p.tenant_id AND l.email_norm = p.email AND l.user_id IS NULL
   AND p.id::text LIKE 'e5100000-%';

INSERT INTO public.event_people (id, tenant_id, first_name, last_name, email) VALUES
  ('e5100000-0000-0000-0000-0000000005a1', 'e5100000-0000-0000-0000-0000000000a0', 'Osoba', 'Wydarzenia', 'osoba@hub-s5-route.test');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at) VALUES
  ('e5100000-0000-0000-0000-0000000007a1', 'e5100000-0000-0000-0000-0000000000a0', 'hub-s5-wydarzenie',
   'Wydarzenie', 'Event', now() + interval '7 days');
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, registration_mode) VALUES
  ('e5100000-0000-0000-0000-0000000007b1', 'e5100000-0000-0000-0000-0000000000a0',
   'e5100000-0000-0000-0000-0000000007a1', 'e5100000-0000-0000-0000-0000000005a1', 'rsvp');

INSERT INTO public.clubs (id, tenant_id, slug, name_pl, name_en, visibility) VALUES
  ('e5100000-0000-0000-0000-0000000006a1', 'e5100000-0000-0000-0000-0000000000a0', 'hub-s5-tajny', 'Tajny', 'Secret', 'secret');

INSERT INTO public.journey_settings (tenant_id, enabled) VALUES
  ('e5100000-0000-0000-0000-0000000000a0', true),
  ('e5100000-0000-0000-0000-0000000000b0', false);

-- Ścieżka opublikowana godzinę temu: wyzwalacz -> koniec.
INSERT INTO public.journey_definitions (id, tenant_id, key, name, status) VALUES
  ('e5100000-0000-0000-0000-0000000010a1', 'e5100000-0000-0000-0000-0000000000a0', 'powitanie', 'Powitanie', 'active'),
  ('e5100000-0000-0000-0000-0000000010b1', 'e5100000-0000-0000-0000-0000000000b0', 'powitanie', 'Powitanie B', 'active');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum, published_at) VALUES
  ('e5100000-0000-0000-0000-0000000011a1', 'e5100000-0000-0000-0000-0000000000a0', 'e5100000-0000-0000-0000-0000000010a1', 1,
   'account.registered.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],"edges":[{"from":"t","to":"x","branch":"next"}]}',
   'x', now() - interval '1 hour'),
  ('e5100000-0000-0000-0000-0000000011b1', 'e5100000-0000-0000-0000-0000000000b0', 'e5100000-0000-0000-0000-0000000010b1', 1,
   'account.registered.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],"edges":[{"from":"t","to":"x","branch":"next"}]}',
   'x', now() - interval '1 hour');
UPDATE public.journey_definitions SET published_version_id = 'e5100000-0000-0000-0000-0000000011a1'
 WHERE id = 'e5100000-0000-0000-0000-0000000010a1';
UPDATE public.journey_definitions SET published_version_id = 'e5100000-0000-0000-0000-0000000011b1'
 WHERE id = 'e5100000-0000-0000-0000-0000000010b1';
INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role) VALUES
  ('e5100000-0000-0000-0000-0000000000a0', 'account.registered.v1', 'e5100000-0000-0000-0000-0000000010a1', 'e5100000-0000-0000-0000-0000000011a1', 'enroll'),
  ('e5100000-0000-0000-0000-0000000000b0', 'account.registered.v1', 'e5100000-0000-0000-0000-0000000010b1', 'e5100000-0000-0000-0000-0000000011b1', 'enroll'),
  -- Trasa na typ zdarzenia ścieżek: wyzwalacz i tak ma je pominąć.
  ('e5100000-0000-0000-0000-0000000000a0', 'journey.changed.v1', 'e5100000-0000-0000-0000-0000000010a1', 'e5100000-0000-0000-0000-0000000011a1', 'enroll'),
  ('e5100000-0000-0000-0000-0000000000a0', 'revenue_diagnostic.snoozed.v1', 'e5100000-0000-0000-0000-0000000010a1', 'e5100000-0000-0000-0000-0000000011a1', 'enroll');

-- Skrzynka zaczyna się od zera dla tych najemców (profil emituje rejestrację
-- wyzwalaczem S3 jeszcze PRZED założeniem tras - nic nie powinno trafić).
DELETE FROM public.journey_event_inbox WHERE tenant_id IN ('e5100000-0000-0000-0000-0000000000a0', 'e5100000-0000-0000-0000-0000000000b0');

CREATE FUNCTION pg_temp.ev(p_id uuid, p_tenant uuid, p_agg text, p_agg_id text, p_type text, p_payload jsonb,
                           p_actor uuid DEFAULT NULL, p_at timestamptz DEFAULT now())
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.domain_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, actor_id, created_at)
  VALUES (p_id, p_tenant, p_agg, p_agg_id, p_type, p_payload, p_actor, p_at)
$$;

CREATE FUNCTION pg_temp.inbox(p_tenant uuid, p_agg text, p_agg_id text, p_payload jsonb, p_actor uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO public.journey_event_inbox (tenant_id, event_id, event_type, aggregate_type, aggregate_id, actor_id, payload, occurred_at)
  VALUES (p_tenant, gen_random_uuid(), 'test.resolve.v1', p_agg, p_agg_id, p_actor, p_payload, now())
  RETURNING id
$$;

-- ── 1. Trasa -> skrzynka ─────────────────────────────────────────────────────
SELECT pg_temp.ev('e5100000-0000-0000-0000-00000000e001', 'e5100000-0000-0000-0000-0000000000a0', 'account',
  'e5100000-0000-0000-0000-00000000a003', 'account.registered.v1',
  '{"user_id":"e5100000-0000-0000-0000-00000000a003","signup_source":"direct","first_name":"Jan"}');
SELECT is(
  (SELECT count(*)::int FROM public.journey_event_inbox WHERE event_id = 'e5100000-0000-0000-0000-00000000e001'),
  1, 'trasa: zdarzenie z trasą trafia do skrzynki');
SELECT ok(
  (SELECT NOT (payload ? 'first_name') FROM public.journey_event_inbox WHERE event_id = 'e5100000-0000-0000-0000-00000000e001'),
  'trasa: skrzynka bez imienia (minimum danych)');
INSERT INTO public.journey_event_inbox (tenant_id, event_id, event_type, payload, occurred_at)
VALUES ('e5100000-0000-0000-0000-0000000000a0', 'e5100000-0000-0000-0000-00000000e001', 'account.registered.v1', '{}', now())
ON CONFLICT (event_id) DO NOTHING;
SELECT is(
  (SELECT count(*)::int FROM public.journey_event_inbox WHERE event_id = 'e5100000-0000-0000-0000-00000000e001'),
  1, 'trasa: skrzynka idempotentna po event_id');

SELECT pg_temp.ev('e5100000-0000-0000-0000-00000000e002', 'e5100000-0000-0000-0000-0000000000a0', 'post',
  'e5100000-0000-0000-0000-00000000f001', 'post.published.v1', '{}');
SELECT is(
  (SELECT count(*)::int FROM public.journey_event_inbox WHERE event_id = 'e5100000-0000-0000-0000-00000000e002'),
  0, 'trasa: zdarzenie bez trasy nie trafia do skrzynki');

SELECT pg_temp.ev('e5100000-0000-0000-0000-00000000e003', 'e5100000-0000-0000-0000-0000000000a0', 'journey',
  'e5100000-0000-0000-0000-0000000010a1', 'journey.changed.v1', '{"op":"save"}');
SELECT pg_temp.ev('e5100000-0000-0000-0000-00000000e004', 'e5100000-0000-0000-0000-0000000000a0', 'revenue_diagnostic',
  'x', 'revenue_diagnostic.snoozed.v1', '{}');
SELECT is(
  (SELECT count(*)::int FROM public.journey_event_inbox
    WHERE event_id IN ('e5100000-0000-0000-0000-00000000e003', 'e5100000-0000-0000-0000-00000000e004')),
  0, 'brak pętli: agregaty journey i revenue_diagnostic pomijane mimo trasy');

-- ── 2. Ingest i zapis ────────────────────────────────────────────────────────
SELECT is(
  (public.journey_ingest_inbox(200) ->> 'enrolled')::int, 1, 'ingest: jeden zapis na ścieżkę');
SELECT is(
  (SELECT e.current_node_id || '|' || e.status || '|' || e.trigger_event_type
     FROM public.journey_enrollments e
     JOIN public.crm_leads l ON l.id = e.lead_id
    WHERE e.journey_id = 'e5100000-0000-0000-0000-0000000010a1' AND l.user_id = 'e5100000-0000-0000-0000-00000000a003'),
  't|active|account.registered.v1', 'ingest: zapis na węźle wyzwalacza konta z user_id');
SELECT ok(
  (SELECT processed_at IS NOT NULL FROM public.journey_event_inbox WHERE event_id = 'e5100000-0000-0000-0000-00000000e001'),
  'ingest: zdarzenie oznaczone jako przetworzone');

SELECT pg_temp.ev('e5100000-0000-0000-0000-00000000e005', 'e5100000-0000-0000-0000-0000000000a0', 'account',
  'e5100000-0000-0000-0000-00000000a003', 'account.registered.v1',
  '{"user_id":"e5100000-0000-0000-0000-00000000a003"}');
SELECT is((public.journey_ingest_inbox(200) ->> 'enrolled')::int, 0,
  'ingest: polityka never - drugie zdarzenie tego samego konta nie zapisuje');

SELECT pg_temp.ev('e5100000-0000-0000-0000-00000000e006', 'e5100000-0000-0000-0000-0000000000a0', 'account',
  'e5100000-0000-0000-0000-00000000a004', 'account.registered.v1',
  '{"user_id":"e5100000-0000-0000-0000-00000000a004"}', NULL, now() - interval '1 day');
SELECT is((public.journey_ingest_inbox(200) ->> 'enrolled')::int, 0,
  'ingest: zdarzenie sprzed published_at nie zapisuje');

SELECT pg_temp.ev('e5100000-0000-0000-0000-00000000e007', 'e5100000-0000-0000-0000-0000000000b0', 'account',
  'e5100000-0000-0000-0000-00000000b003', 'account.registered.v1',
  '{"user_id":"e5100000-0000-0000-0000-00000000b003"}');
SELECT is(
  (SELECT count(*)::int FROM public.journey_event_inbox WHERE event_id = 'e5100000-0000-0000-0000-00000000e007'),
  1, 'najemca B: zdarzenie w skrzynce (trasa B)');
SELECT public.journey_ingest_inbox(200);
SELECT is(
  (SELECT count(*)::int FROM public.journey_enrollments WHERE tenant_id = 'e5100000-0000-0000-0000-0000000000b0'),
  0, 'silnik najemcy B wyłączony: zdarzenie przetworzone, zero zapisów');
SELECT ok(
  (SELECT processed_at IS NOT NULL FROM public.journey_event_inbox WHERE event_id = 'e5100000-0000-0000-0000-00000000e007'),
  'silnik wyłączony: skrzynka nie rośnie (zdarzenie zamknięte)');

-- ── 3. Resolver ──────────────────────────────────────────────────────────────
SELECT is(
  public.journey_resolve_lead(pg_temp.inbox('e5100000-0000-0000-0000-0000000000a0', 'x', '1',
    '{"user_id":"e5100000-0000-0000-0000-00000000a003"}')),
  (SELECT id FROM public.crm_leads WHERE user_id = 'e5100000-0000-0000-0000-00000000a003'),
  'resolver: user_id -> lead konta');
SELECT is(
  public.journey_resolve_lead(pg_temp.inbox('e5100000-0000-0000-0000-0000000000a0', 'x', '1',
    '{"member_user_id":"e5100000-0000-0000-0000-00000000a004"}')),
  (SELECT id FROM public.crm_leads WHERE user_id = 'e5100000-0000-0000-0000-00000000a004'),
  'resolver: member_user_id -> lead członka');
-- Osobna instrukcja: lead założony przez resolver jest widoczny dopiero
-- w następnym zapytaniu (migawka instrukcji).
CREATE TEMP TABLE s5_person_lead ON COMMIT DROP AS
SELECT public.journey_resolve_lead(pg_temp.inbox('e5100000-0000-0000-0000-0000000000a0', 'x', '1',
  '{"person_id":"e5100000-0000-0000-0000-0000000005a1"}')) AS id;
SELECT is(
  (SELECT l.email_norm || '|' || l.marketing_consent::text FROM public.crm_leads l
     JOIN s5_person_lead r ON r.id = l.id),
  'osoba@hub-s5-route.test|false', 'resolver: person_id -> lead osoby wydarzeń BEZ zgody marketingowej');
SELECT is(
  public.journey_resolve_lead(pg_temp.inbox('e5100000-0000-0000-0000-0000000000a0', 'event_registration',
    'e5100000-0000-0000-0000-0000000007b1', '{"event_id":"e5100000-0000-0000-0000-0000000007a1","by":"participant"}')),
  (SELECT id FROM s5_person_lead),
  'resolver: rezygnacja bez person_id -> osoba z agregatu zgłoszenia (wyjście ścieżki wydarzeń)');
SELECT is(
  public.journey_resolve_lead(pg_temp.inbox('e5100000-0000-0000-0000-0000000000a0', 'x', '1', '{}',
    'e5100000-0000-0000-0000-00000000a005')),
  (SELECT id FROM public.crm_leads WHERE user_id = 'e5100000-0000-0000-0000-00000000a005'),
  'resolver: actor_id spoza personelu (bez tożsamości w ładunku) -> lead aktora');
SELECT is(
  public.journey_resolve_lead(pg_temp.inbox('e5100000-0000-0000-0000-0000000000a0', 'x', '1', '{}',
    'e5100000-0000-0000-0000-00000000a001')),
  NULL, 'resolver: aktor-admin nie jest kontaktem zdarzenia');
SELECT is(
  public.journey_resolve_lead(pg_temp.inbox('e5100000-0000-0000-0000-0000000000a0', 'crm_lead',
    (SELECT id::text FROM public.crm_leads WHERE user_id = 'e5100000-0000-0000-0000-00000000a004'), '{}')),
  (SELECT id FROM public.crm_leads WHERE user_id = 'e5100000-0000-0000-0000-00000000a004'),
  'resolver: agregat crm_lead');
SELECT is(
  public.journey_resolve_lead(pg_temp.inbox('e5100000-0000-0000-0000-0000000000a0', 'club_application', '1',
    '{"club_id":"e5100000-0000-0000-0000-0000000006a1","user_id":"e5100000-0000-0000-0000-00000000a003"}')),
  NULL, 'resolver: klub secret = brak kontaktu');
SELECT is(
  public.journey_resolve_lead(pg_temp.inbox('e5100000-0000-0000-0000-0000000000a0', 'x', '1', '{"source":"form"}')),
  NULL, 'resolver: zdarzenie anonimowe = brak kontaktu');
SELECT is(
  public.journey_resolve_lead(pg_temp.inbox('e5100000-0000-0000-0000-0000000000a0', 'x', '1',
    jsonb_build_object('lead_id', (SELECT id FROM public.crm_leads WHERE user_id = 'e5100000-0000-0000-0000-00000000b003')))),
  NULL, 'resolver: lead innego najemcy nie istnieje dla zdarzenia');

-- ── 4. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.journey_ingest_inbox(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.journey_ingest_inbox(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.journey_ingest_inbox(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.journey_resolve_lead(bigint)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.journey_resolve_lead(bigint)', 'EXECUTE'),
  'acl: ingest i resolver wyłącznie dla service_role');

SELECT * FROM finish();
ROLLBACK;
