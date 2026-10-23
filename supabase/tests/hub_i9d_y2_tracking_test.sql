-- pgTAP: piksel i linki z identyfikatorem odbiorcy tylko za zgodą na pomiar
-- (I9d-Y2; migracja 20261020162400; Z-I9c-09 - wspólny przełącznik najemcy).
--
-- CO PRZYPINA:
--   * kontakt do wysyłki ścieżki: `measurement` = `open_tracking` =
--     `link_tracking` = przełącznik ORAZ zgoda kontaktu (bez zgody, przy
--     wyłączonym przełączniku i - od I9d-Y2b, D2 - dla kontaktu CRM bez
--     potwierdzonej subskrypcji - false);
--   * zapis zdarzeń ścieżki i kampanii: otwarcie i kliknięcie bez zgody ->
--     `no_measurement_consent` (bez wiersza, bez znacznika zaangażowania),
--     ze zgodą - zapis; wycofanie pomiaru działa na maile wysłane wcześniej;
--     przełącznik wyłączony -> `measurement_disabled` dla otwarć I kliknięć
--     (także kampanie); wypis ścieżki bez zmian;
--   * odbiorcy kampanii: `measured` liczone przy statusie `sent` (albo podane
--     przez runner - bez nadpisania), NULL dla niewysłanych; mianownik
--     w panelu (admin/editor, obca kampania P0002, bez roli 42501); ACL.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_y2_tracking
BEGIN;
SELECT plan(20);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('19d70000-0000-4000-8000-0000000000a0', 'i9d-y2-pomiar-a', 'I9d Y2 Pomiar A'),
  ('19d70000-0000-4000-8000-0000000000b0', 'i9d-y2-pomiar-b', 'I9d Y2 Pomiar B');
INSERT INTO auth.users (id, email) VALUES
  ('19d70000-0000-4000-8000-00000000a001', 'admin@i9d-y2-pomiar.test'),
  ('19d70000-0000-4000-8000-00000000a002', 'redaktor@i9d-y2-pomiar.test'),
  ('19d70000-0000-4000-8000-00000000a003', 'czytelnik@i9d-y2-pomiar.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19d70000-0000-4000-8000-00000000a001', 'admin@i9d-y2-pomiar.test', 'Admin', '19d70000-0000-4000-8000-0000000000a0'),
  ('19d70000-0000-4000-8000-00000000a002', 'redaktor@i9d-y2-pomiar.test', 'Redaktor', '19d70000-0000-4000-8000-0000000000a0'),
  ('19d70000-0000-4000-8000-00000000a003', 'czytelnik@i9d-y2-pomiar.test', 'Czytelnik', '19d70000-0000-4000-8000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19d70000-0000-4000-8000-00000000a001', 'admin', '19d70000-0000-4000-8000-0000000000a0'),
  ('19d70000-0000-4000-8000-00000000a002', 'editor', '19d70000-0000-4000-8000-0000000000a0');
-- Próg maszynowy 0 s: otwarcie w teście jest „ludzkie" (znacznik zaangażowania).
INSERT INTO public.journey_settings (tenant_id, machine_open_seconds) VALUES ('19d70000-0000-4000-8000-0000000000a0', 0);

CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r TO authenticated;

-- „Tak" pomiaru z jawną chwilą i źródłem (fikstura; flaga jak w jedynym
-- pisarzu `_email_measurement_grant` - bez niej strażnik rejestru odrzuca).
CREATE FUNCTION pg_temp.grant_raw(p_email text, p_source public.crm_source_type, p_source_id uuid, p_at timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('nes.email_measurement_grant', 'on', true);
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, consent_key, consent_text,
                                      consent_version, given, created_at)
  VALUES ('19d70000-0000-4000-8000-0000000000a0', p_email, p_source, p_source_id, 'measurement:reconfirm',
          'email_measurement', public._email_measurement_consent_default('pl'),
          public._email_measurement_consent_version(), true, p_at);
  PERFORM set_config('nes.email_measurement_grant', '', true);
END $$;
CREATE FUNCTION pg_temp.grant_at(p_email text, p_at timestamptz) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.grant_raw(p_email, 'newsletter',
                           (SELECT s.id FROM public.newsletter_subscribers s WHERE s.email = p_email), p_at)
$$;

-- Kontakty: J1 - subskrybent ze zgodą na pomiar, J2 - subskrybent bez zgody,
-- J3 - kontakt CRM bez subskrypcji z wpisem „tak" (D2: brak pomiaru).
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, marketing_consent)
SELECT ('19d70000-0000-4000-8000-0000000030a' || n)::uuid, '19d70000-0000-4000-8000-0000000000a0',
       'j' || n || '@i9d-y2-pomiar.test', 'j' || n || '@i9d-y2-pomiar.test', true
  FROM generate_series(1, 3) n;
INSERT INTO public.newsletter_subscribers (tenant_id, email, status)
SELECT '19d70000-0000-4000-8000-0000000000a0', 'j' || n || '@i9d-y2-pomiar.test', 'subscribed'
  FROM generate_series(1, 2) n;
SELECT pg_temp.grant_at('j1@i9d-y2-pomiar.test', now() - interval '1 day');
SELECT pg_temp.grant_raw('j3@i9d-y2-pomiar.test', 'other', '19d70000-0000-4000-8000-0000000030a3', now() - interval '1 day');

INSERT INTO public.journey_definitions (id, tenant_id, key, name, status, category) VALUES
  ('19d70000-0000-4000-8000-0000000050a1', '19d70000-0000-4000-8000-0000000000a0', 'i9d-y2', 'Pomiar', 'active', 'marketing');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum, published_at)
VALUES ('19d70000-0000-4000-8000-0000000050b1', '19d70000-0000-4000-8000-0000000000a0', '19d70000-0000-4000-8000-0000000050a1', 1,
        'account.registered.v1',
        '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"m","type":"send_email","params":{}},{"id":"x","type":"exit","params":{}}],
          "edges":[{"from":"t","to":"m","branch":"next"},{"from":"m","to":"x","branch":"next"}]}',
        'x', now() - interval '1 day');
UPDATE public.journey_definitions SET published_version_id = '19d70000-0000-4000-8000-0000000050b1'
 WHERE id = '19d70000-0000-4000-8000-0000000050a1';
INSERT INTO public.journey_email_contents (tenant_id, journey_id, version_id, node_id, variant, subject_pl, subject_en, doc)
VALUES ('19d70000-0000-4000-8000-0000000000a0', '19d70000-0000-4000-8000-0000000050a1', '19d70000-0000-4000-8000-0000000050b1',
        'm', 'A', 'Temat', NULL, '{"version":1,"blocks":[],"style":{}}');
INSERT INTO public.journey_enrollments (id, tenant_id, journey_id, version_id, lead_id, status, current_node_id,
                                        trigger_snapshot, enrollment_key)
SELECT ('19d70000-0000-4000-8000-0000000050c' || n)::uuid, '19d70000-0000-4000-8000-0000000000a0',
       '19d70000-0000-4000-8000-0000000050a1', '19d70000-0000-4000-8000-0000000050b1',
       ('19d70000-0000-4000-8000-0000000030a' || n)::uuid, 'active', 'm', '{}', 'y2-' || n
  FROM generate_series(1, 3) n;
INSERT INTO public.journey_messages (message_id, tenant_id, enrollment_id, journey_id, version_id, node_id, lead_id, queued_at)
SELECT 'i9d-y2-m' || n, '19d70000-0000-4000-8000-0000000000a0', ('19d70000-0000-4000-8000-0000000050c' || n)::uuid,
       '19d70000-0000-4000-8000-0000000050a1', '19d70000-0000-4000-8000-0000000050b1', 'm',
       ('19d70000-0000-4000-8000-0000000030a' || n)::uuid, now() - interval '1 hour'
  FROM generate_series(1, 3) n;

-- Kampania: S1 ze zgodą na pomiar, S2 bez (sama zgoda na newsletter); kampania
-- obcego najemcy.
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status, consents)
SELECT ('19d70000-0000-4000-8000-0000000060a' || n)::uuid, '19d70000-0000-4000-8000-0000000000a0',
       's' || n || '@i9d-y2-pomiar.test', 'subscribed',
       CASE WHEN n IN (1, 2) THEN jsonb_build_array(jsonb_build_object(
              'key', 'newsletter', 'text', public._newsletter_consent_default('pl'),
              'version', public._newsletter_consent_version()))
            ELSE '[]'::jsonb END
  FROM generate_series(1, 3) n;
SELECT pg_temp.grant_at('s1@i9d-y2-pomiar.test', now() - interval '1 day');
INSERT INTO public.newsletter_campaigns (id, tenant_id, name) VALUES
  ('19d70000-0000-4000-8000-0000000020a1', '19d70000-0000-4000-8000-0000000000a0', 'Kampania Y2'),
  ('19d70000-0000-4000-8000-0000000020b1', '19d70000-0000-4000-8000-0000000000b0', 'Kampania obca');
INSERT INTO public.newsletter_campaign_recipients (tenant_id, campaign_id, subscriber_id, email, status, sent_at)
SELECT '19d70000-0000-4000-8000-0000000000a0', '19d70000-0000-4000-8000-0000000020a1',
       ('19d70000-0000-4000-8000-0000000060a' || n)::uuid, 's' || n || '@i9d-y2-pomiar.test',
       CASE WHEN n = 3 THEN 'failed' ELSE 'sent' END, CASE WHEN n = 3 THEN NULL ELSE now() - interval '1 hour' END
  FROM generate_series(1, 3) n;

-- ── 1. Kontakt do wysyłki ścieżki ────────────────────────────────────────────
INSERT INTO r SELECT 'c1', public.journey_contact_for_send('19d70000-0000-4000-8000-0000000050c1', 'm');
INSERT INTO r SELECT 'c2', public.journey_contact_for_send('19d70000-0000-4000-8000-0000000050c2', 'm');
INSERT INTO r SELECT 'c3', public.journey_contact_for_send('19d70000-0000-4000-8000-0000000050c3', 'm');
SELECT is(
  (SELECT jsonb_build_object('m', v -> 'measurement', 'o', v -> 'open_tracking', 'l', v -> 'link_tracking') FROM r WHERE k = 'c1'),
  '{"l": true, "m": true, "o": true}'::jsonb,
  'kontakt ze zgodą na pomiar: piksel i linki z identyfikatorem wiadomości');
SELECT is(
  (SELECT jsonb_build_object('m', v -> 'measurement', 'o', v -> 'open_tracking', 'l', v -> 'link_tracking') FROM r WHERE k = 'c2'),
  '{"l": false, "m": false, "o": false}'::jsonb,
  'kontakt bez zgody na pomiar (sama zgoda na newsletter): bez piksela, linki nieprzepisane');
SELECT is(
  (SELECT jsonb_build_object('m', v -> 'measurement', 'o', v -> 'open_tracking', 'l', v -> 'link_tracking') FROM r WHERE k = 'c3'),
  '{"l": false, "m": false, "o": false}'::jsonb,
  'kontakt CRM bez subskrypcji z wpisem „tak" (I9d-Y2b, D2): bez piksela, linki nieprzepisane');

-- ── 2. Zapis zdarzeń ścieżki ─────────────────────────────────────────────────
SELECT is(public.journey_record_message_event('i9d-y2-m2', 'click', 0, 'https://nes.example/a') - 'tenant_id',
  '{"recorded": false, "reason": "no_measurement_consent"}'::jsonb,
  'ścieżka: kliknięcie kontaktu bez zgody nie jest zapisywane');
SELECT is(public.journey_record_message_event('i9d-y2-m2', 'open') ->> 'reason', 'no_measurement_consent',
  'ścieżka: otwarcie kontaktu bez zgody nie jest zapisywane');
INSERT INTO r SELECT 'e1o', public.journey_record_message_event('i9d-y2-m1', 'open');
INSERT INTO r SELECT 'e1c', public.journey_record_message_event('i9d-y2-m1', 'click', 0, 'https://nes.example/a');
SELECT ok(
  (SELECT (v ->> 'recorded')::boolean FROM r WHERE k = 'e1o') AND (SELECT (v ->> 'recorded')::boolean FROM r WHERE k = 'e1c')
  AND (SELECT count(*) = 2 FROM public.journey_message_events WHERE message_id = 'i9d-y2-m1')
  AND NOT EXISTS (SELECT 1 FROM public.journey_message_events WHERE message_id = 'i9d-y2-m2'),
  'ścieżka: otwarcie i kliknięcie kontaktu ze zgodą - zapisane; bez zgody - zero wierszy');

-- Wycofanie pomiaru po wysyłce: piksel i link z maila w skrzynce nic nie zapisują.
SELECT is(public.email_measurement_withdraw(NULL, '19d70000-0000-4000-8000-0000000030a1') ->> 'result', 'withdrawn',
  'kontakt J1 wycofuje pomiar (link w stopce maila ścieżki)');
SELECT is(public.journey_record_message_event('i9d-y2-m1', 'click', 1, 'https://nes.example/b') ->> 'reason',
  'no_measurement_consent', 'ścieżka: kliknięcie z maila wysłanego PRZED wycofaniem - bez zapisu');
SELECT is(
  (SELECT jsonb_build_object('m', v -> 'measurement', 'l', v -> 'link_tracking')
     FROM (SELECT public.journey_contact_for_send('19d70000-0000-4000-8000-0000000050c1', 'm') AS v) x),
  '{"l": false, "m": false}'::jsonb, 'kolejny mail do J1 - bez pomiaru');

-- ── 3. Zapis zdarzeń kampanii ────────────────────────────────────────────────
SELECT is(
  public.newsletter_record_campaign_event('19d70000-0000-4000-8000-0000000020a1', '19d70000-0000-4000-8000-0000000060a2', 'open')
    - 'tenant_id',
  '{"reason": "no_measurement_consent", "duplicate": false, "recorded": false}'::jsonb,
  'kampania: otwarcie subskrybenta bez zgody na pomiar nie jest zapisywane');
INSERT INTO r SELECT 'k1', public.newsletter_record_campaign_event('19d70000-0000-4000-8000-0000000020a1',
                                                                   '19d70000-0000-4000-8000-0000000060a1', 'click',
                                                                   'https://nes.example/c');
SELECT ok(
  (SELECT (v ->> 'recorded')::boolean FROM r WHERE k = 'k1')
  AND (SELECT count(*) = 1 FROM public.newsletter_campaign_events WHERE campaign_id = '19d70000-0000-4000-8000-0000000020a1')
  AND (SELECT last_engaged_at IS NOT NULL FROM public.newsletter_subscribers WHERE id = '19d70000-0000-4000-8000-0000000060a1')
  AND (SELECT last_engaged_at IS NULL AND last_human_open_at IS NULL FROM public.newsletter_subscribers
        WHERE id = '19d70000-0000-4000-8000-0000000060a2'),
  'kampania: kliknięcie subskrybenta ze zgodą zapisane (+ znacznik zaangażowania); odrzucone - bez znacznika');

-- ── 4. Wspólny przełącznik najemcy (Z-I9c-09) ────────────────────────────────
UPDATE public.journey_settings SET open_tracking_enabled = false WHERE tenant_id = '19d70000-0000-4000-8000-0000000000a0';
SELECT is(
  public.newsletter_record_campaign_event('19d70000-0000-4000-8000-0000000020a1', '19d70000-0000-4000-8000-0000000060a1', 'open')
    ->> 'reason',
  'measurement_disabled', 'kampania: przełącznik wyłączony - otwarcie nie jest zapisywane mimo zgody');
SELECT pg_temp.grant_at('j1@i9d-y2-pomiar.test', clock_timestamp() + interval '1 second');
SELECT ok(
  public.journey_record_message_event('i9d-y2-m1', 'click', 2, 'https://nes.example/d') ->> 'reason' = 'measurement_disabled'
  AND public.journey_contact_for_send('19d70000-0000-4000-8000-0000000050c1', 'm') ->> 'link_tracking' = 'false',
  'ścieżka: przełącznik wyłączony - kliknięcie bez zapisu i linki nieprzepisane mimo zgody');
SELECT ok(
  (public.journey_record_message_event('i9d-y2-m2', 'unsubscribe') ->> 'kind') = 'unsubscribe',
  'wypis z maila ścieżki działa bez zgody na pomiar i przy wyłączonym przełączniku (to nie jest pomiar)');
UPDATE public.journey_settings SET open_tracking_enabled = true WHERE tenant_id = '19d70000-0000-4000-8000-0000000000a0';

-- ── 5. Odbiorcy mierzeni kampanii ────────────────────────────────────────────
SELECT is(
  (SELECT jsonb_object_agg(email, measured) FROM public.newsletter_campaign_recipients
    WHERE campaign_id = '19d70000-0000-4000-8000-0000000020a1'),
  '{"s1@i9d-y2-pomiar.test": true, "s2@i9d-y2-pomiar.test": false, "s3@i9d-y2-pomiar.test": null}'::jsonb,
  'odbiorcy: measured liczone przy statusie sent (zgoda ORAZ przełącznik), NULL dla niewysłanych');
-- Wznowienie: failed -> sent liczy stan; runner podaje wartość wprost - zostaje.
UPDATE public.newsletter_campaign_recipients SET status = 'sent', sent_at = now()
 WHERE campaign_id = '19d70000-0000-4000-8000-0000000020a1' AND email = 's3@i9d-y2-pomiar.test';
INSERT INTO public.newsletter_campaign_recipients (tenant_id, campaign_id, subscriber_id, email, status, sent_at, measured)
VALUES ('19d70000-0000-4000-8000-0000000000a0', '19d70000-0000-4000-8000-0000000020a1',
        '19d70000-0000-4000-8000-0000000060a1', 's1-kopia@i9d-y2-pomiar.test', 'sent', now(), false);
SELECT is(
  (SELECT jsonb_object_agg(email, measured) FROM public.newsletter_campaign_recipients
    WHERE campaign_id = '19d70000-0000-4000-8000-0000000020a1' AND email IN ('s3@i9d-y2-pomiar.test', 's1-kopia@i9d-y2-pomiar.test')),
  '{"s1-kopia@i9d-y2-pomiar.test": false, "s3@i9d-y2-pomiar.test": false}'::jsonb,
  'odbiorcy: wznowiona wysyłka liczy stan; wartość podana przez runner nie jest nadpisywana');

SELECT pg_temp.as_user('19d70000-0000-4000-8000-00000000a002');
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'panel', public.admin_newsletter_campaign_measurement('19d70000-0000-4000-8000-0000000020a1');
RESET ROLE;
SELECT is((SELECT v FROM r WHERE k = 'panel'),
  '{"campaign_id": "19d70000-0000-4000-8000-0000000020a1", "sent": 4, "measured": 1, "unmeasured": 3, "unknown": 0}'::jsonb,
  'panel (redaktor): mianownik - wysłane, mierzone, niemierzone, nieznane');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.admin_newsletter_campaign_measurement('19d70000-0000-4000-8000-0000000020b1') $$,
  'P0002', 'campaign_not_found', 'panel: kampania obcego najemcy - P0002');
SELECT pg_temp.as_user('19d70000-0000-4000-8000-00000000a003');
SELECT throws_ok($$ SELECT public.admin_newsletter_campaign_measurement('19d70000-0000-4000-8000-0000000020a1') $$,
  '42501', NULL, 'panel: użytkownik bez roli personelu - 42501');
RESET ROLE;

-- ── 6. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.journey_contact_for_send(uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.journey_contact_for_send(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.journey_record_message_event(text, text, integer, text, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_newsletter_campaign_measurement(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_newsletter_campaign_measurement(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.tg_newsletter_recipients_measured()', 'EXECUTE'),
  'ACL: kontakt i zapis zdarzeń - service_role; mianownik - authenticated (bramka roli w funkcji); wyzwalacz - bez ról API');

SELECT * FROM finish();
ROLLBACK;
