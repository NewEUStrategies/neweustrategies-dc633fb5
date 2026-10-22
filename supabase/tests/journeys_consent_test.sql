-- pgTAP: zgody, blokady i limity maila ścieżki (migracje 20261020140200,
-- 140500, hub S5; D-03, D-04).
--
-- Sprawdza:
--   * marketing bez zgody -> `no_consent` -> zapis `exited/consent`;
--   * zgoda: flaga leada, subskrybent `confirmed`, `subscribed` przy
--     wyłączonym double opt-in; ostatni wpis księgi `given = false` ją zdejmuje;
--   * wypis z newslettera -> `unsubscribed`; blokada techniczna -> `suppressed`;
--   * usługa: wypis i miękkie odbicie przepuszczone (lustro
--     `suppressionPolicy.ts`), twarde odbicie zatrzymuje; usługa wyłącznie
--     z podstawą prawną (CHECK);
--   * limit D-03: 3 maile marketingowe / 7 dni liczone ze ścieżek I kampanii
--     -> `capped` (3 przesunięcia, potem krok pominięty `capped`);
--   * cisza nocna -> `quiet` i przesunięcie do końca ciszy;
--   * zapis testowy: tylko blokady techniczne;
--   * `journey_contact_for_send` wyłącznie service_role; język zastępczy PL,
--     gdy temat EN niegotowy.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test journeys_consent
BEGIN;
SELECT plan(23);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e5500000-0000-0000-0000-0000000000a0', 'hub-s5-consent-a', 'Hub S5 zgody A'),
  ('e5500000-0000-0000-0000-0000000000b0', 'hub-s5-consent-b', 'Hub S5 zgody B');
INSERT INTO auth.users (id, email) VALUES
  ('e5500000-0000-0000-0000-00000000a001', 'admin-a@hub-s5-consent.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e5500000-0000-0000-0000-00000000a001', 'admin-a@hub-s5-consent.test', 'Admin A', 'e5500000-0000-0000-0000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e5500000-0000-0000-0000-00000000a001', 'admin', 'e5500000-0000-0000-0000-0000000000a0');
-- Cisza nocna ustawiona POZA bieżącą godziną (przypadek ciszy niżej).
INSERT INTO public.journey_settings (tenant_id, enabled, marketing_cap_per_7d, quiet_start, quiet_end) VALUES
  ('e5500000-0000-0000-0000-0000000000a0', true, 3,
   ((now() AT TIME ZONE 'Europe/Warsaw') + interval '2 hours')::time,
   ((now() AT TIME ZONE 'Europe/Warsaw') + interval '3 hours')::time);
INSERT INTO public.newsletter_settings (tenant_id, double_opt_in) VALUES
  ('e5500000-0000-0000-0000-0000000000a0', true)
ON CONFLICT (tenant_id) DO UPDATE SET double_opt_in = true;

-- Kontakty: k1 bez zgody, k2 zgoda leada, k3 subskrybent confirmed, k4 wypisany,
-- k5 zablokowany (hard_bounce), k6 zgoda + wycofanie w księdze, k7 limit,
-- k8 subskrybent `subscribed` (DOI włączony), k9 cisza nocna.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, marketing_consent)
SELECT ('e5500000-0000-0000-0000-0000000001a' || g)::uuid, 'e5500000-0000-0000-0000-0000000000a0',
       'k' || g || '@hub-s5-consent.test', 'k' || g || '@hub-s5-consent.test', g IN (2, 5, 6, 7, 9)
  FROM generate_series(1, 9) g;
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language) VALUES
  ('e5500000-0000-0000-0000-0000000000a0', 'k3@hub-s5-consent.test', 'confirmed', 'en'),
  ('e5500000-0000-0000-0000-0000000000a0', 'k4@hub-s5-consent.test', 'unsubscribed', 'pl'),
  ('e5500000-0000-0000-0000-0000000000a0', 'k8@hub-s5-consent.test', 'subscribed', 'pl');
SELECT public.email_record_suppression(p_tenant => 'e5500000-0000-0000-0000-0000000000a0',
  p_email => 'k5@hub-s5-consent.test', p_reason => 'hard_bounce', p_source => 'manual', p_provider => 'test');
-- Most newslettera -> CRM nadaje flagę zgody przy zapisie; reguła statusu
-- subskrybenta (double opt-in) jest sprawdzana na leadzie BEZ tej flagi.
UPDATE public.crm_leads SET marketing_consent = false
 WHERE tenant_id = 'e5500000-0000-0000-0000-0000000000a0'
   AND email_norm IN ('k1@hub-s5-consent.test', 'k3@hub-s5-consent.test', 'k4@hub-s5-consent.test',
                      'k8@hub-s5-consent.test');
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given) VALUES
  ('e5500000-0000-0000-0000-0000000000a0', 'k6@hub-s5-consent.test', 'other', 'marketing', 'wycofanie', false);

INSERT INTO public.journey_definitions (id, tenant_id, key, name, status, category, legal_basis) VALUES
  ('e5500000-0000-0000-0000-0000000010a1', 'e5500000-0000-0000-0000-0000000000a0', 'marketing', 'Marketing', 'active', 'marketing', NULL),
  ('e5500000-0000-0000-0000-0000000010a2', 'e5500000-0000-0000-0000-0000000000a0', 'usluga', 'Usługa', 'active', 'service',
   'Art. 6 ust. 1 lit. b RODO - informacja o końcu okresu próbnego');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum) VALUES
  ('e5500000-0000-0000-0000-0000000011a1', 'e5500000-0000-0000-0000-0000000000a0', 'e5500000-0000-0000-0000-0000000010a1', 1,
   'crm_lead.updated.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"m","type":"send_email","params":{}},{"id":"x","type":"exit","params":{}}],
     "edges":[{"from":"t","to":"m","branch":"next"},{"from":"m","to":"x","branch":"next"}]}', 'x'),
  ('e5500000-0000-0000-0000-0000000011a2', 'e5500000-0000-0000-0000-0000000000a0', 'e5500000-0000-0000-0000-0000000010a2', 1,
   'crm_lead.updated.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"m","type":"send_email","params":{}},{"id":"x","type":"exit","params":{}}],
     "edges":[{"from":"t","to":"m","branch":"next"},{"from":"m","to":"x","branch":"next"}]}', 'x');
UPDATE public.journey_definitions SET published_version_id = 'e5500000-0000-0000-0000-0000000011a1' WHERE id = 'e5500000-0000-0000-0000-0000000010a1';
UPDATE public.journey_definitions SET published_version_id = 'e5500000-0000-0000-0000-0000000011a2' WHERE id = 'e5500000-0000-0000-0000-0000000010a2';
INSERT INTO public.journey_email_contents (tenant_id, journey_id, version_id, node_id, variant, subject_pl, subject_en, doc) VALUES
  ('e5500000-0000-0000-0000-0000000000a0', 'e5500000-0000-0000-0000-0000000010a1', 'e5500000-0000-0000-0000-0000000011a1',
   'm', 'A', 'Temat PL', NULL, '{"version":1,"blocks":[],"style":{}}');

CREATE FUNCTION pg_temp.at_mail(p_journey uuid, p_lead uuid, p_test boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_e uuid; t uuid := gen_random_uuid();
BEGIN
  v_e := public._journey_enroll('e5500000-0000-0000-0000-0000000000a0', p_journey,
    (SELECT published_version_id FROM public.journey_definitions WHERE id = p_journey), p_lead,
    jsonb_build_object('id', gen_random_uuid(), 'event_type', 'crm_lead.updated.v1', 'payload', '{}'::jsonb), p_test);
  UPDATE public.journey_enrollments SET lock_token = t, locked_until = now() + interval '2 minutes' WHERE id = v_e;
  PERFORM public.journey_advance(v_e, t, 25);
  RETURN v_e;
END $$;

CREATE FUNCTION pg_temp.tok(p_e uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT lock_token FROM public.journey_enrollments WHERE id = p_e
$$;

CREATE TEMP TABLE s5c (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
INSERT INTO s5c
SELECT 'k' || g, pg_temp.at_mail('e5500000-0000-0000-0000-0000000010a1', ('e5500000-0000-0000-0000-0000000001a' || g)::uuid)
  FROM generate_series(1, 9) g;

-- ── 1. Werdykty zgody i blokad ───────────────────────────────────────────────
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k1'), 'marketing'), 'no_consent',
  'marketing bez zgody -> no_consent');
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k2'), 'marketing'), 'ok',
  'zgoda z flagi leada -> ok');
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k3'), 'marketing'), 'ok',
  'subskrybent confirmed -> ok');
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k4'), 'marketing'), 'unsubscribed',
  'wypisany z newslettera -> unsubscribed');
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k5'), 'marketing'), 'suppressed',
  'twarde odbicie -> suppressed');
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k6'), 'marketing'), 'no_consent',
  'ostatni wpis księgi given=false zdejmuje zgodę leada');
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k8'), 'marketing'), 'no_consent',
  'subskrybent subscribed przy double opt-in -> brak zgody');
UPDATE public.newsletter_settings SET double_opt_in = false WHERE tenant_id = 'e5500000-0000-0000-0000-0000000000a0';
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k8'), 'marketing'), 'ok',
  'subskrybent subscribed przy wyłączonym double opt-in -> ok');
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k1'), 'service'), 'no_consent',
  'kategoria ścieżki wygrywa z deklaracją runnera (marketing nie staje się usługą)');

-- Usługa: wypis i miękkie odbicie przepuszczone, twarde zatrzymuje.
INSERT INTO s5c VALUES ('s4', pg_temp.at_mail('e5500000-0000-0000-0000-0000000010a2', 'e5500000-0000-0000-0000-0000000001a4'));
SELECT public.email_record_suppression(p_tenant => 'e5500000-0000-0000-0000-0000000000a0',
  p_email => 'k4@hub-s5-consent.test', p_reason => 'unsubscribe', p_source => 'manual', p_provider => 'test');
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 's4'), 'service'), 'ok',
  'usługa: wypis z marketingu nie zatrzymuje (podstawa prawna)');
INSERT INTO s5c VALUES ('s5', pg_temp.at_mail('e5500000-0000-0000-0000-0000000010a2', 'e5500000-0000-0000-0000-0000000001a5'));
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 's5'), 'service'), 'suppressed',
  'usługa: twarde odbicie zatrzymuje także usługę');
SELECT throws_ok(
  $$ INSERT INTO public.journey_definitions (tenant_id, key, name, category)
     VALUES ('e5500000-0000-0000-0000-0000000000a0', 'bez-podstawy', 'X', 'service') $$,
  '23514', NULL, 'usługa bez podstawy prawnej odrzucona (CHECK)');

-- Zapis testowy: tylko blokady techniczne.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, marketing_consent) VALUES
  ('e5500000-0000-0000-0000-0000000001b0', 'e5500000-0000-0000-0000-0000000000a0', 'test@hub-s5-consent.test',
   'test@hub-s5-consent.test', false);
INSERT INTO s5c VALUES ('t1', pg_temp.at_mail('e5500000-0000-0000-0000-0000000010a1', 'e5500000-0000-0000-0000-0000000001b0', true));
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 't1'), 'marketing'), 'ok',
  'zapis testowy: brak zgody nie blokuje testu na żywo');

-- ── 2. Brak zgody kończy zapis ───────────────────────────────────────────────
SELECT is(
  public.journey_complete_email_step((SELECT id FROM s5c WHERE k = 'k1'), pg_temp.tok((SELECT id FROM s5c WHERE k = 'k1')),
    'm', 'no_consent') ->> 'status', 'exited', 'no_consent: krok domknięty wyjściem');
SELECT is(
  (SELECT e.status || '|' || e.exit_reason || '|' || sr.outcome FROM public.journey_enrollments e
     JOIN public.journey_step_runs sr ON sr.enrollment_id = e.id AND sr.node_id = 'm'
    WHERE e.id = (SELECT id FROM s5c WHERE k = 'k1')),
  'exited|consent|no_consent', 'no_consent: zapis exited/consent, krok no_consent');

-- ── 3. Limit D-03 (ścieżki + kampanie) ───────────────────────────────────────
INSERT INTO public.journey_messages (message_id, tenant_id, enrollment_id, journey_id, version_id, node_id, lead_id, queued_at)
SELECT 'cap-' || g, 'e5500000-0000-0000-0000-0000000000a0', (SELECT id FROM s5c WHERE k = 'k2'),
       'e5500000-0000-0000-0000-0000000010a1', 'e5500000-0000-0000-0000-0000000011a1', 'cap' || g,
       'e5500000-0000-0000-0000-0000000001a7', now() - interval '1 day'
  FROM generate_series(1, 2) g;
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k7'), 'marketing'), 'ok',
  'limit: 2 maile ścieżek w 7 dni < 3');
INSERT INTO public.newsletter_campaigns (id, tenant_id, name) VALUES
  ('e5500000-0000-0000-0000-0000000020a1', 'e5500000-0000-0000-0000-0000000000a0', 'Kampania');
INSERT INTO public.newsletter_campaign_recipients (tenant_id, campaign_id, email, status, sent_at) VALUES
  ('e5500000-0000-0000-0000-0000000000a0', 'e5500000-0000-0000-0000-0000000020a1', 'k7@hub-s5-consent.test', 'sent', now() - interval '2 days');
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k7'), 'marketing'), 'capped',
  'limit D-03: 2 ze ścieżek + 1 kampania = 3 / 7 dni -> capped');
SELECT is(
  public.journey_complete_email_step((SELECT id FROM s5c WHERE k = 'k7'), pg_temp.tok((SELECT id FROM s5c WHERE k = 'k7')),
    'm', 'capped') ->> 'reason', 'capped', 'capped: pierwsze przesunięcie o dobę');
UPDATE public.journey_step_runs SET detail = detail || '{"capped_count":3}'
 WHERE enrollment_id = (SELECT id FROM s5c WHERE k = 'k7') AND node_id = 'm';
UPDATE public.journey_enrollments SET lock_token = gen_random_uuid(), locked_until = now() + interval '2 minutes'
 WHERE id = (SELECT id FROM s5c WHERE k = 'k7');
SELECT public.journey_complete_email_step((SELECT id FROM s5c WHERE k = 'k7'), pg_temp.tok((SELECT id FROM s5c WHERE k = 'k7')),
  'm', 'capped');
SELECT is(
  (SELECT sr.status || '|' || sr.outcome || '|' || e.status FROM public.journey_step_runs sr
     JOIN public.journey_enrollments e ON e.id = sr.enrollment_id
    WHERE sr.enrollment_id = (SELECT id FROM s5c WHERE k = 'k7') AND sr.node_id = 'm'),
  'skipped|capped|completed', 'capped: po 3 przesunięciach krok pominięty, ścieżka idzie dalej');

-- ── 4. Cisza nocna ───────────────────────────────────────────────────────────
UPDATE public.journey_settings
   SET quiet_start = ((now() AT TIME ZONE 'Europe/Warsaw') - interval '1 hour')::time,
       quiet_end = ((now() AT TIME ZONE 'Europe/Warsaw') + interval '1 hour')::time
 WHERE tenant_id = 'e5500000-0000-0000-0000-0000000000a0';
SELECT is(public.journey_can_send((SELECT id FROM s5c WHERE k = 'k9'), 'marketing'), 'quiet',
  'cisza nocna -> quiet');
SELECT public.journey_complete_email_step((SELECT id FROM s5c WHERE k = 'k9'), pg_temp.tok((SELECT id FROM s5c WHERE k = 'k9')),
  'm', 'quiet');
SELECT ok(
  (SELECT next_run_at BETWEEN now() + interval '55 minutes' AND now() + interval '65 minutes'
     FROM public.journey_enrollments WHERE id = (SELECT id FROM s5c WHERE k = 'k9')),
  'cisza nocna: mail przesunięty na koniec ciszy (quiet_end)');

-- ── 5. Kontakt do wysyłki ────────────────────────────────────────────────────
SELECT is(
  (SELECT (j ->> 'subject') || '|' || (j ->> 'locale') || '|' || (j ->> 'fallback_locale')
     FROM (SELECT public.journey_contact_for_send((SELECT id FROM s5c WHERE k = 'k3'), 'm') AS j) x),
  'Temat PL|pl|true', 'contact_for_send: odbiorca EN bez tematu EN dostaje PL (język zastępczy)');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.journey_contact_for_send(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.journey_contact_for_send(uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.journey_contact_for_send(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.journey_can_send(uuid,text)', 'EXECUTE'),
  'acl: journey_contact_for_send i journey_can_send wyłącznie dla service_role');

SELECT * FROM finish();
ROLLBACK;
