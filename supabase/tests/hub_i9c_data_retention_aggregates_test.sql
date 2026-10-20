-- pgTAP: retencja danych - agregaty i odczyt starszych okien (I9c-X2,
-- Z-I9b-10; migracje 20261020161000-161300) oraz przełącznik pomiaru otwarć.
--
-- CO PRZYPINA:
--   * okno SPRZED progu retencji daje ten sam wynik przed czyszczeniem i po
--     nim: lejek (`_funnel_counts` - konta, goście, uderzenia, konwersje,
--     powody; także okno przecinające próg i segment), pulpit monetyzacji
--     (zdarzenia licznika), zaangażowanie kampanii (otwarcia, kliknięcia,
--     zasięg unikalny - także subskrybent z otwarciem przed progiem i po nim)
--     i statystyki kroku ścieżki (wysłane, otwarcia, kliknięcia);
--   * surowe wiersze faktycznie zniknęły (test nie jest pusty), odczyt
--     ścieżki przełączył się na rollup;
--   * pomiar otwarć: domyślnie włączony, zapis przez ustawienia silnika
--     (S5), kontakt do wysyłki bez piksela, otwarcie z maila wysłanego
--     wcześniej nie jest zapisywane (kliknięcie tak), wartość nie-logiczna
--     odrzucona (22023).
--
-- Fikstura: każde konto ma uderzenia w paywall w JEDNYM dniu - agregat
-- dzienny liczy konto raz na dzień (dziennik wdrożenia §21.21), więc tylko
-- taki zbiór pozwala porównać okno surowe z oknem z agregatu co do sztuki.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9c_data_retention_aggregates
BEGIN;
SELECT plan(23);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Najemca po karencji (założony 60 dni temu, bez wierszy ustawień).
INSERT INTO public.tenants (id, slug, name, created_at) VALUES
  ('19c30000-0000-4000-8000-0000000000c0', 'i9c-agregaty', 'I9c Agregaty', now() - interval '60 days');
INSERT INTO auth.users (id, email) VALUES
  ('19c30000-0000-4000-8000-00000000c001', 'admin-c@i9c-agregaty.test'),
  ('19c30000-0000-4000-8000-0000000000d1', 'u1@i9c-agregaty.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19c30000-0000-4000-8000-00000000c001', 'admin-c@i9c-agregaty.test', 'Admin C', '19c30000-0000-4000-8000-0000000000c0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19c30000-0000-4000-8000-00000000c001', 'admin', '19c30000-0000-4000-8000-0000000000c0');

CREATE TEMP TABLE w (k text PRIMARY KEY, t timestamptz) ON COMMIT DROP;
-- d1-d3: trzy dni sprzed progu (13 mies.), okno „old" kończy się przed progiem.
INSERT INTO w VALUES
  ('d1', date_trunc('day', now() - interval '14 months') + interval '10 hours'),
  ('d2', date_trunc('day', now() - interval '14 months') + interval '2 days 10 hours'),
  ('d3', date_trunc('day', now() - interval '14 months') + interval '4 days 10 hours'),
  ('since', date_trunc('day', now() - interval '15 months')),
  ('until', date_trunc('day', now() - interval '13 months') - interval '2 days');
CREATE FUNCTION pg_temp.w(p text) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT t FROM w WHERE k = p $$;
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r, w TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.w(text) TO authenticated;
CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;
-- Pola lejka zależne od uderzeń w paywall (reszta liczników nie czyta
-- usuwanych tabel).
CREATE FUNCTION pg_temp.funnel(p_since timestamptz, p_until timestamptz, p_segment text DEFAULT 'all')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'accounts', f -> 'accounts', 'active_accounts', f -> 'active_accounts',
    'paywall_hit_accounts', f -> 'paywall_hit_accounts', 'paywall_hit_visitors', f -> 'paywall_hit_visitors',
    'paywall_hits', f -> 'paywall_hits', 'paywall_converted_accounts', f -> 'paywall_converted_accounts',
    'paywall_reasons', f -> 'paywall_reasons', 'paywall_hit_rate', f -> 'paywall_hit_rate',
    'paywall_conversion_rate', f -> 'paywall_conversion_rate')
    FROM (SELECT public._funnel_counts('19c30000-0000-4000-8000-0000000000c0', p_since, p_until, p_segment) AS f) x
$$;
-- Węzły statystyk ścieżki: pola wspólne odczytu surowego i rollupu.
CREATE FUNCTION pg_temp.nodes(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'node_id', n ->> 'node_id', 'type', n ->> 'type', 'entered', n -> 'entered',
           'succeeded', n -> 'succeeded', 'failed', n -> 'failed',
           'sent', n -> 'email' -> 'sent', 'bounced', n -> 'email' -> 'bounced',
           'unique_opens', n -> 'email' -> 'unique_opens', 'unique_human_opens', n -> 'email' -> 'unique_human_opens',
           'unique_clicks', n -> 'email' -> 'unique_clicks', 'ctor', n -> 'email' -> 'ctor')
         ORDER BY n ->> 'node_id'), '[]'::jsonb)
    FROM jsonb_array_elements(p -> 'nodes') n
$$;
GRANT EXECUTE ON FUNCTION pg_temp.nodes(jsonb) TO authenticated;

-- Lejek: u1 (d1, konwersja tego samego dnia), u2 (d1), u3 (d2), gość (d2),
-- u4 (d3); świeże: u5 i gość sprzed kilku dni.
INSERT INTO public.paywall_hits (tenant_id, day, user_id, visitor_hash, entity_type, entity_id, reason, hits,
                                 first_at, last_at)
SELECT '19c30000-0000-4000-8000-0000000000c0', (x.at AT TIME ZONE 'UTC')::date, x.u, x.v, 'post', gen_random_uuid(),
       x.reason, x.hits, x.at, x.at + interval '5 minutes'
  FROM (VALUES
    ('19c30000-0000-4000-8000-0000000000d1'::uuid, NULL::text, 'paid', 3, pg_temp.w('d1')),
    ('19c30000-0000-4000-8000-0000000000d2'::uuid, NULL, 'members', 1, pg_temp.w('d1')),
    ('19c30000-0000-4000-8000-0000000000d3'::uuid, NULL, 'paid', 2, pg_temp.w('d2')),
    (NULL, 'i9c-gosc-stary-0000000001', 'registration', 1, pg_temp.w('d2')),
    ('19c30000-0000-4000-8000-0000000000d4'::uuid, NULL, 'paid', 1, pg_temp.w('d3')),
    ('19c30000-0000-4000-8000-0000000000d5'::uuid, NULL, 'paid', 2, now() - interval '10 days'),
    (NULL, 'i9c-gosc-nowy-00000000002', 'quota', 1, now() - interval '5 days')) x(u, v, reason, hits, at);
-- Konwersja u1 w dniu uderzenia (opłacone zamówienie zakłada tylko
-- service_role - strażnik statusu).
SET LOCAL request.jwt.claim.role = 'service_role';
INSERT INTO public.payment_orders (tenant_id, user_id, kind, status, amount_cents, currency, provider, environment,
                                   paid_at, created_at)
VALUES ('19c30000-0000-4000-8000-0000000000c0', '19c30000-0000-4000-8000-0000000000d1', 'one_time', 'paid', 4900, 'PLN',
        'stripe', 'live', pg_temp.w('d1') + interval '1 hour', pg_temp.w('d1') + interval '30 minutes');
SET LOCAL request.jwt.claim.role = '';
INSERT INTO public.metering_event_log (tenant_id, occurred_at, outcome)
SELECT '19c30000-0000-4000-8000-0000000000c0', x.at, x.outcome
  FROM (VALUES (pg_temp.w('d1'), 'consumed'), (pg_temp.w('d1') + interval '1 hour', 'consumed'),
               (pg_temp.w('d2'), 'denied'), (pg_temp.w('d3'), 'requires_registration'),
               (now() - interval '3 days', 'consumed')) x(at, outcome);

-- Kampania: s1 dwa otwarcia (różne dni - deduplikacja doby) i kliknięcie
-- przed progiem, s2 otwarcie przed
-- progiem I po nim (zasięg unikalny nie może policzyć go dwa razy).
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status) VALUES
  ('19c30000-0000-4000-8000-0000000060a1', '19c30000-0000-4000-8000-0000000000c0', 's1@i9c-agregaty.test', 'confirmed'),
  ('19c30000-0000-4000-8000-0000000060a2', '19c30000-0000-4000-8000-0000000000c0', 's2@i9c-agregaty.test', 'confirmed');
INSERT INTO public.newsletter_campaigns (id, tenant_id, name) VALUES
  ('19c30000-0000-4000-8000-0000000020c1', '19c30000-0000-4000-8000-0000000000c0', 'Kampania agregaty');
INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind, created_at)
SELECT '19c30000-0000-4000-8000-0000000000c0', '19c30000-0000-4000-8000-0000000020c1', x.s, x.kind, x.at
  FROM (VALUES ('19c30000-0000-4000-8000-0000000060a1'::uuid, 'open', pg_temp.w('d1')),
               ('19c30000-0000-4000-8000-0000000060a1'::uuid, 'open', pg_temp.w('d1') + interval '1 day'),
               ('19c30000-0000-4000-8000-0000000060a1'::uuid, 'click', pg_temp.w('d1') + interval '1 hour'),
               ('19c30000-0000-4000-8000-0000000060a2'::uuid, 'open', pg_temp.w('d2')),
               ('19c30000-0000-4000-8000-0000000060a2'::uuid, 'open', now() - interval '1 month')) x(s, kind, at);

-- Ścieżka: dwa zapisy zakończone 14 mies. temu (krok maila wysłany obu,
-- jeden otwarty i kliknięty) i zapis aktywny przy mailu (piksel).
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, last_activity_at)
SELECT ('19c30000-0000-4000-8000-0000000030c' || n)::uuid, '19c30000-0000-4000-8000-0000000000c0',
       'j' || n || '@i9c-agregaty.test', 'j' || n || '@i9c-agregaty.test', now() - interval '1 day'
  FROM generate_series(1, 3) n;
INSERT INTO public.journey_definitions (id, tenant_id, key, name, status, category) VALUES
  ('19c30000-0000-4000-8000-0000000050d1', '19c30000-0000-4000-8000-0000000000c0', 'i9c-agr', 'Agregaty', 'active', 'marketing');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum, published_at)
VALUES ('19c30000-0000-4000-8000-0000000050e1', '19c30000-0000-4000-8000-0000000000c0', '19c30000-0000-4000-8000-0000000050d1', 1,
        'account.registered.v1',
        '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"m","type":"send_email","params":{}},{"id":"x","type":"exit","params":{}}],
          "edges":[{"from":"t","to":"m","branch":"next"},{"from":"m","to":"x","branch":"next"}]}',
        'x', pg_temp.w('since'));
UPDATE public.journey_definitions SET published_version_id = '19c30000-0000-4000-8000-0000000050e1'
 WHERE id = '19c30000-0000-4000-8000-0000000050d1';
INSERT INTO public.journey_email_contents (tenant_id, journey_id, version_id, node_id, variant, subject_pl, subject_en, doc)
VALUES ('19c30000-0000-4000-8000-0000000000c0', '19c30000-0000-4000-8000-0000000050d1', '19c30000-0000-4000-8000-0000000050e1',
        'm', 'A', 'Temat', NULL, '{"version":1,"blocks":[],"style":{}}');
INSERT INTO public.journey_enrollments (id, tenant_id, journey_id, version_id, lead_id, status, current_node_id,
                                        trigger_snapshot, enrollment_key, entered_at, finished_at, exit_reason)
SELECT ('19c30000-0000-4000-8000-0000000050f' || n)::uuid, '19c30000-0000-4000-8000-0000000000c0',
       '19c30000-0000-4000-8000-0000000050d1', '19c30000-0000-4000-8000-0000000050e1',
       ('19c30000-0000-4000-8000-0000000030c' || n)::uuid,
       CASE WHEN n = 3 THEN 'active' ELSE 'completed' END, CASE WHEN n = 3 THEN 'm' END, '{}', 'agr-' || n,
       CASE WHEN n = 3 THEN now() - interval '1 hour' ELSE pg_temp.w('d1') END,
       CASE WHEN n = 3 THEN NULL ELSE pg_temp.w('d1') + interval '3 hours' END,
       CASE WHEN n = 3 THEN NULL ELSE 'completed' END
  FROM generate_series(1, 3) n;
INSERT INTO public.journey_step_runs (tenant_id, enrollment_id, journey_id, version_id, node_id, node_type, status, started_at)
SELECT '19c30000-0000-4000-8000-0000000000c0', ('19c30000-0000-4000-8000-0000000050f' || n)::uuid,
       '19c30000-0000-4000-8000-0000000050d1', '19c30000-0000-4000-8000-0000000050e1', 'm', 'send_email', 'succeeded',
       pg_temp.w('d1') + interval '10 minutes'
  FROM generate_series(1, 2) n;
INSERT INTO public.journey_messages (message_id, tenant_id, enrollment_id, journey_id, version_id, node_id, lead_id, queued_at)
SELECT 'i9c3-m' || n, '19c30000-0000-4000-8000-0000000000c0', ('19c30000-0000-4000-8000-0000000050f' || n)::uuid,
       '19c30000-0000-4000-8000-0000000050d1', '19c30000-0000-4000-8000-0000000050e1', 'm',
       ('19c30000-0000-4000-8000-0000000030c' || n)::uuid,
       CASE WHEN n = 3 THEN now() - interval '1 hour' ELSE pg_temp.w('d1') + interval '10 minutes' END
  FROM generate_series(1, 3) n;
INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, tenant_id, created_at)
SELECT 'i9c3-m' || n, 'journey', 'j' || n || '@i9c-agregaty.test', 'sent', '19c30000-0000-4000-8000-0000000000c0',
       pg_temp.w('d1') + interval '11 minutes'
  FROM generate_series(1, 2) n;
INSERT INTO public.journey_message_events (tenant_id, message_id, kind, occurred_at, day)
SELECT '19c30000-0000-4000-8000-0000000000c0', 'i9c3-m1', x.kind, x.at, (x.at AT TIME ZONE 'UTC')::date
  FROM (VALUES ('open', pg_temp.w('d1') + interval '2 hours'), ('click', pg_temp.w('d1') + interval '2 hours')) x(kind, at);

-- ── 1. Pomiar otwarć (piksel) ────────────────────────────────────────────────
SELECT is(public.journey_contact_for_send('19c30000-0000-4000-8000-0000000050f3', 'm') ->> 'open_tracking', 'true',
  'piksel: bez ustawień silnika pomiar otwarć włączony (domyślnie)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('19c30000-0000-4000-8000-00000000c001');
SELECT is(public.admin_journey_settings_get() ->> 'open_tracking_enabled', 'true',
  'ustawienia silnika: klucz open_tracking_enabled, domyślnie true');
SELECT throws_ok($$ SELECT public.admin_journey_settings_save('{"open_tracking_enabled":"nie"}', NULL) $$,
  '22023', 'open_tracking_enabled_invalid', 'ustawienia silnika: wartość nie-logiczna odrzucona (22023)');
SELECT is(public.admin_journey_settings_save('{"open_tracking_enabled":false}', NULL) ->> 'open_tracking_enabled', 'false',
  'ustawienia silnika: wyłączenie pomiaru otwarć zapisane');
RESET ROLE;
SELECT is(public.journey_contact_for_send('19c30000-0000-4000-8000-0000000050f3', 'm') ->> 'open_tracking', 'false',
  'piksel: kontakt do wysyłki bez piksela po wyłączeniu');
SELECT is(public.journey_record_message_event('i9c3-m3', 'open') - 'tenant_id',
  '{"recorded": false, "reason": "open_tracking_disabled"}'::jsonb,
  'piksel: otwarcie z maila wysłanego wcześniej nie jest zapisywane');
SELECT ok((public.journey_record_message_event('i9c3-m3', 'click', 0, 'https://example.test/') ->> 'recorded')::boolean
          AND NOT EXISTS (SELECT 1 FROM public.journey_message_events WHERE message_id = 'i9c3-m3' AND kind = 'open'),
  'piksel: kliknięcie nadal zapisywane, otwarcia brak');

-- ── 2. Odczyt PRZED czyszczeniem ─────────────────────────────────────────────
INSERT INTO r VALUES
  ('f_old', pg_temp.funnel(pg_temp.w('since'), pg_temp.w('until'))),
  ('f_all', pg_temp.funnel(pg_temp.w('since'), now())),
  ('f_seg', pg_temp.funnel(pg_temp.w('since'), pg_temp.w('until'), 'b2c_individual')),
  ('f_since', to_jsonb(public._funnel_counts('19c30000-0000-4000-8000-0000000000c0', pg_temp.w('since'), now())
                         ->> 'paywall_data_since'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('19c30000-0000-4000-8000-00000000c001');
INSERT INTO r SELECT 'm_old', public.monetization_dashboard(pg_temp.w('since'), pg_temp.w('until')) -> 'metering_events';
INSERT INTO r SELECT 'e', to_jsonb(x) FROM public.newsletter_campaign_engagement('19c30000-0000-4000-8000-0000000020c1') x;
INSERT INTO r SELECT 'j_old', public.admin_journey_stats('19c30000-0000-4000-8000-0000000050d1', NULL,
                                                         pg_temp.w('since'), pg_temp.w('until'));
RESET ROLE;

SELECT is((SELECT v - 'paywall_reasons' - 'paywall_hit_rate' - 'accounts' FROM r WHERE k = 'f_old'),
  '{"active_accounts": 4, "paywall_hit_accounts": 4, "paywall_hit_visitors": 1, "paywall_hits": 8,
    "paywall_converted_accounts": 1, "paywall_conversion_rate": 0.25}'::jsonb,
  'przed: okno sprzed progu ma dane lejka (test nie jest pusty)');
SELECT is((SELECT v FROM r WHERE k = 'm_old'), '{"consumed": 2, "denied": 1, "reg_wall": 1}'::jsonb,
  'przed: zdarzenia licznika w oknie sprzed progu');
SELECT is((SELECT v FROM r WHERE k = 'e'),
  '{"opens": 4, "clicks": 1, "unique_openers": 2, "unique_clickers": 1}'::jsonb,
  'przed: zaangażowanie kampanii (s2 otwiera przed progiem i po nim)');
SELECT is((SELECT v ->> 'source' FROM r WHERE k = 'j_old'), 'raw', 'przed: statystyki ścieżki z wierszy surowych');

-- ── 3. Czyszczenie (najemca po karencji) ─────────────────────────────────────
INSERT INTO r SELECT 'run', public._data_retention_run_tenant('19c30000-0000-4000-8000-0000000000c0', 'schedule', 1000);
SELECT ok((SELECT v -> 'paywall_metering' ->> 'mode' = 'execute' AND v -> 'email_engagement' ->> 'mode' = 'execute'
             FROM r WHERE k = 'run')
          AND NOT EXISTS (SELECT 1 FROM public.paywall_hits
                           WHERE tenant_id = '19c30000-0000-4000-8000-0000000000c0' AND last_at < pg_temp.w('until'))
          AND NOT EXISTS (SELECT 1 FROM public.metering_event_log
                           WHERE tenant_id = '19c30000-0000-4000-8000-0000000000c0' AND occurred_at < pg_temp.w('until')),
  'czyszczenie: stare uderzenia i zdarzenia licznika usunięte (wykonanie)');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.newsletter_campaign_events
                       WHERE campaign_id = '19c30000-0000-4000-8000-0000000020c1' AND created_at < pg_temp.w('until'))
          AND NOT EXISTS (SELECT 1 FROM public.journey_message_events WHERE message_id IN ('i9c3-m1', 'i9c3-m2'))
          AND NOT EXISTS (SELECT 1 FROM public.journey_enrollments
                           WHERE journey_id = '19c30000-0000-4000-8000-0000000050d1' AND status = 'completed'),
  'czyszczenie: stare zdarzenia kampanii i ścieżki oraz zakończone zapisy usunięte');

-- ── 4. Odczyt PO czyszczeniu - ten sam wynik ─────────────────────────────────
SELECT is(pg_temp.funnel(pg_temp.w('since'), pg_temp.w('until')), (SELECT v FROM r WHERE k = 'f_old'),
  'lejek: okno sprzed progu identyczne po czyszczeniu (konta, goście, uderzenia, konwersje, powody, wskaźniki)');
SELECT is(pg_temp.funnel(pg_temp.w('since'), now()), (SELECT v FROM r WHERE k = 'f_all'),
  'lejek: okno przecinające próg identyczne (agregat + wiersze surowe)');
SELECT is(pg_temp.funnel(pg_temp.w('since'), pg_temp.w('until'), 'b2c_individual'), (SELECT v FROM r WHERE k = 'f_seg'),
  'lejek: okno segmentu identyczne');
SELECT is((public._funnel_counts('19c30000-0000-4000-8000-0000000000c0', pg_temp.w('since'), now())
            ->> 'paywall_data_since')::timestamptz,
          date_trunc('day', ((SELECT v #>> '{}' FROM r WHERE k = 'f_since')::timestamptz) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
  'lejek: początek pomiaru nie przesuwa się naprzód (dzień pierwszego uderzenia)');
SELECT ok((SELECT count(*) = 3 FROM public.funnel_paywall_daily f
            WHERE f.tenant_id = '19c30000-0000-4000-8000-0000000000c0' AND f.paywall_hits > 0)
          AND NOT EXISTS (SELECT 1 FROM public.funnel_paywall_daily f
                           WHERE f.tenant_id = '19c30000-0000-4000-8000-0000000000c0'
                             AND f::text ~* 'i9c-gosc|19c30000-0000-4000-8000-0000000000d'),
  'agregat lejka: dzień na wiersz, bez identyfikatorów kont i gości');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('19c30000-0000-4000-8000-00000000c001');
SELECT is(public.monetization_dashboard(pg_temp.w('since'), pg_temp.w('until')) -> 'metering_events',
  (SELECT v FROM r WHERE k = 'm_old'), 'pulpit monetyzacji: zdarzenia licznika okna sprzed progu identyczne');
SELECT is((SELECT to_jsonb(x) FROM public.newsletter_campaign_engagement('19c30000-0000-4000-8000-0000000020c1') x),
  (SELECT v FROM r WHERE k = 'e'), 'kampania: otwarcia, kliknięcia i zasięg unikalny identyczne (surowe + archiwum)');
INSERT INTO r SELECT 'j_after', public.admin_journey_stats('19c30000-0000-4000-8000-0000000050d1', NULL,
                                                           pg_temp.w('since'), pg_temp.w('until'));
SELECT is((SELECT v ->> 'source' FROM r WHERE k = 'j_after'), 'rollup',
  'ścieżka: okno z dniem zapieczętowanym czytane z rollupu');
SELECT is((SELECT pg_temp.nodes(v) FROM r WHERE k = 'j_after'), (SELECT pg_temp.nodes(v) FROM r WHERE k = 'j_old'),
  'ścieżka: liczniki kroku (wejścia, wysłane, otwarcia, kliknięcia, CTOR) identyczne po usunięciu zdarzeń i zapisów');
RESET ROLE;
SELECT is((SELECT pg_temp.nodes(v) -> 0 FROM r WHERE k = 'j_old'),
  '{"node_id": "m", "type": "send_email", "entered": 2, "succeeded": 2, "failed": 0, "sent": 2, "bounced": 0,
    "unique_opens": 1, "unique_human_opens": 1, "unique_clicks": 1, "ctor": 1.0000}'::jsonb,
  'ścieżka: liczniki kroku przed czyszczeniem (test nie jest pusty)');

SELECT * FROM finish();
ROLLBACK;
