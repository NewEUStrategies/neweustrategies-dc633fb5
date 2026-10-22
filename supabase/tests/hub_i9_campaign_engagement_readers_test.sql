-- pgTAP: czytelnicy zdarzeń kampanii po retencji (I9, Z-I9c-05, Z-S7-07,
-- Z-I9c-10; migracja 20261020162900).
--
-- CO PRZYPINA:
--   * okno SPRZED progu retencji daje ten sam wynik przed złożeniem zdarzeń
--     i po nim: Kokpit (`admin_dashboard_marketing` - otwarcia, kliknięcia
--     okna i tabela kampanii), zdrowie poczty huba
--     (`admin_revenue_email_health` - unikalne otwarcia i kliknięcia
--     kohorty) i warstwa semantyczna (`analytics_semantic_snapshot` -
--     otwarcia, kliknięcia, kampanie);
--   * złożenie przy wygaszaniu subskrybenta (`_newsletter_sunset_fold_events`)
--     też dokłada sumy dzienne - Kokpit bez zmian;
--   * surowe zdarzenia faktycznie zniknęły, zestawienie dzienne nie niesie
--     subskrybenta;
--   * Z-I9c-10: kampania 4 odbiorców, wszyscy wracają po złożeniu -
--     zasięg unikalny (`newsletter_campaign_engagement`) i zdrowie poczty
--     nie przekraczają liczby odbiorców;
--   * ACL tabeli i pomocnika sumy dziennej.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9_campaign_engagement_readers
BEGIN;
SELECT plan(14);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, created_at) VALUES
  ('19e90000-0000-4000-8000-0000000006a0', 'i9-kampanie', 'I9 Kampanie', now() - interval '60 days');
INSERT INTO auth.users (id, email) VALUES
  ('19e90000-0000-4000-8000-00000000a601', 'admin@i9-kampanie.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19e90000-0000-4000-8000-00000000a601', 'admin@i9-kampanie.test', 'Admin', '19e90000-0000-4000-8000-0000000006a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19e90000-0000-4000-8000-00000000a601', 'admin', '19e90000-0000-4000-8000-0000000006a0');

CREATE TEMP TABLE w (k text PRIMARY KEY, t timestamptz) ON COMMIT DROP;
-- d1-d3: dni sprzed progu (13 mies.); okno „old" kończy się przed progiem.
INSERT INTO w VALUES
  ('d1', date_trunc('day', now() - interval '14 months') + interval '10 hours'),
  ('d2', date_trunc('day', now() - interval '14 months') + interval '1 day 10 hours'),
  ('d3', date_trunc('day', now() - interval '14 months') + interval '2 days 10 hours'),
  ('since', date_trunc('day', now() - interval '15 months')),
  ('until', date_trunc('day', now() - interval '13 months') - interval '2 days');
CREATE FUNCTION pg_temp.w(p text) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT t FROM w WHERE k = p $$;
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r, w TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.w(text) TO authenticated;

-- Odczyt trzech czytelników jako admin najemcy - tylko pola, które
-- zależą od zdarzeń kampanii.
CREATE FUNCTION pg_temp.read() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_dash jsonb;
  v_eh jsonb;
  v_sem jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '19e90000-0000-4000-8000-00000000a601', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"19e90000-0000-4000-8000-00000000a601","role":"authenticated"}', true);
  v_dash := public.admin_dashboard_marketing(pg_temp.w('since'), pg_temp.w('until'),
                                             pg_temp.w('since') - interval '1 year',
                                             pg_temp.w('until') - interval '1 year');
  v_eh := public.admin_revenue_email_health(pg_temp.w('since'), pg_temp.w('until'));
  v_sem := public.analytics_semantic_snapshot(pg_temp.w('since'), pg_temp.w('until'));
  RETURN jsonb_build_object(
    'dash_opens', v_dash -> 'current' -> 'opens', 'dash_clicks', v_dash -> 'current' -> 'clicks',
    'dash_campaign', (SELECT jsonb_build_object('opens', c -> 'opens', 'clicks', c -> 'clicks')
                        FROM jsonb_array_elements(v_dash -> 'campaigns') c WHERE c ->> 'name' = 'K1'),
    'eh_opens', v_eh -> 'campaigns' -> 'unique_opens', 'eh_clicks', v_eh -> 'campaigns' -> 'unique_clicks',
    'sem_opens', v_sem -> 'newsletter' -> 'opens', 'sem_clicks', v_sem -> 'newsletter' -> 'clicks',
    'sem_campaigns', v_sem -> 'newsletter' -> 'campaigns');
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.read() TO authenticated;

-- Kampania K1 sprzed progu: 4 odbiorców (wysłane d1), s1 i s2 otwierają d1,
-- s2 klika d1, s3 otwiera d2, s4 otwiera i klika d3.
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status)
SELECT ('19e90000-0000-4000-8000-0000000060a' || n)::uuid, '19e90000-0000-4000-8000-0000000006a0',
       's' || n || '@i9-kampanie.test', 'confirmed'
  FROM generate_series(1, 4) n;
INSERT INTO public.newsletter_campaigns (id, tenant_id, name, status, sent_count, recipient_count, finished_at) VALUES
  ('19e90000-0000-4000-8000-0000000020a1', '19e90000-0000-4000-8000-0000000006a0', 'K1', 'sent', 4, 4,
   pg_temp.w('d1') + interval '1 hour');
INSERT INTO public.newsletter_campaign_recipients (tenant_id, campaign_id, subscriber_id, email, status, sent_at)
SELECT '19e90000-0000-4000-8000-0000000006a0', '19e90000-0000-4000-8000-0000000020a1',
       ('19e90000-0000-4000-8000-0000000060a' || n)::uuid, 's' || n || '@i9-kampanie.test', 'sent', pg_temp.w('d1')
  FROM generate_series(1, 4) n;
INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind, created_at)
SELECT '19e90000-0000-4000-8000-0000000006a0', '19e90000-0000-4000-8000-0000000020a1', x.s, x.kind, x.at
  FROM (VALUES ('19e90000-0000-4000-8000-0000000060a1'::uuid, 'open', pg_temp.w('d1')),
               ('19e90000-0000-4000-8000-0000000060a2'::uuid, 'open', pg_temp.w('d1') + interval '1 hour'),
               ('19e90000-0000-4000-8000-0000000060a2'::uuid, 'click', pg_temp.w('d1') + interval '2 hours'),
               ('19e90000-0000-4000-8000-0000000060a3'::uuid, 'open', pg_temp.w('d2')),
               ('19e90000-0000-4000-8000-0000000060a4'::uuid, 'open', pg_temp.w('d3')),
               ('19e90000-0000-4000-8000-0000000060a4'::uuid, 'click', pg_temp.w('d3') + interval '1 hour')) x(s, kind, at);

INSERT INTO r VALUES ('before', pg_temp.read());

-- ── 1. Odczyt bazowy nie jest pusty ─────────────────────────────────────────
SELECT is((SELECT v FROM r WHERE k = 'before'),
  '{"dash_opens": 4, "dash_clicks": 2, "dash_campaign": {"opens": 4, "clicks": 2},
    "eh_opens": 4, "eh_clicks": 2, "sem_opens": 4, "sem_clicks": 2, "sem_campaigns": 1}'::jsonb,
  'odczyt bazowy z surowych zdarzeń: 4 otwarcia, 2 kliknięcia, 1 kampania');

-- ── 2-3. Wygaszanie subskrybenta s4 składa jego zdarzenia ───────────────────
SELECT is(public._newsletter_sunset_fold_events('19e90000-0000-4000-8000-0000000006a0',
                                                '19e90000-0000-4000-8000-0000000060a4'), 2,
  'wygaszanie: dwa zdarzenia s4 złożone');
INSERT INTO r VALUES ('after_sunset', pg_temp.read());
SELECT is((SELECT v FROM r WHERE k = 'after_sunset'), (SELECT v FROM r WHERE k = 'before'),
  'po złożeniu przy wygaszaniu: Kokpit, zdrowie poczty i warstwa semantyczna bez zmian');

-- ── 4-6. Retencja składa resztę okna ────────────────────────────────────────
SELECT is(public._data_retention_fold_campaign_events('19e90000-0000-4000-8000-0000000006a0',
                                                      now() - interval '13 months', true, 100000), 4,
  'retencja: cztery pozostałe zdarzenia sprzed progu złożone');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.newsletter_campaign_events
               WHERE campaign_id = '19e90000-0000-4000-8000-0000000020a1')
  AND (SELECT count(*) = 3 AND sum(opens) = 4 AND sum(clicks) = 2
         FROM public.newsletter_campaign_engagement_daily
        WHERE campaign_id = '19e90000-0000-4000-8000-0000000020a1'),
  'surowe zdarzenia zniknęły; zestawienie: 3 dni, 4 otwarcia, 2 kliknięcia');
INSERT INTO r VALUES ('after_fold', pg_temp.read());
SELECT is((SELECT v FROM r WHERE k = 'after_fold'), (SELECT v FROM r WHERE k = 'before'),
  'okno sprzed progu po retencji: Kokpit, zdrowie poczty i warstwa semantyczna identyczne');

-- ── 7. Zestawienie bez identyfikatorów osób ─────────────────────────────────
SELECT is(
  (SELECT array_agg(column_name::text ORDER BY column_name::text) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'newsletter_campaign_engagement_daily'),
  ARRAY['campaign_id', 'clicks', 'day', 'opens', 'tenant_id', 'updated_at'],
  'zestawienie dzienne bez subskrybenta i adresu');

-- ── 8-10. Z-I9c-10: powrót wszystkich odbiorców po złożeniu ─────────────────
INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind, created_at)
SELECT '19e90000-0000-4000-8000-0000000006a0', '19e90000-0000-4000-8000-0000000020a1',
       ('19e90000-0000-4000-8000-0000000060a' || n)::uuid, k, now() - interval '1 day'
  FROM generate_series(1, 4) n CROSS JOIN (VALUES ('open'), ('click')) x(k);
SELECT set_config('request.jwt.claim.sub', '19e90000-0000-4000-8000-00000000a601', true);
SELECT set_config('request.jwt.claims', '{"sub":"19e90000-0000-4000-8000-00000000a601","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'eng', to_jsonb(e) FROM public.newsletter_campaign_engagement('19e90000-0000-4000-8000-0000000020a1') e;
RESET ROLE;
SELECT is((SELECT v ->> 'unique_openers' FROM r WHERE k = 'eng'), '4',
  'zasięg unikalny: surowe 4 + archiwum 4 przycięte do 4 odbiorców (nie 8)');
SELECT is((SELECT v ->> 'unique_clickers' FROM r WHERE k = 'eng'), '4',
  'zasięg klikających: przycięty do liczby odbiorców');
INSERT INTO r VALUES ('after_return', pg_temp.read());
SELECT ok(
  (SELECT (v ->> 'eh_opens')::int <= 4 AND (v ->> 'eh_clicks')::int <= 4 FROM r WHERE k = 'after_return'),
  'zdrowie poczty: zasięg kampanii nie przekracza kohorty po powrocie odbiorców');

-- ── 11-12. Suma dnia: okno półotwarte i domknięte ───────────────────────────
SELECT is(public._newsletter_engagement_daily_sum('19e90000-0000-4000-8000-0000000006a0', 'open',
            date_trunc('day', pg_temp.w('d1')), date_trunc('day', pg_temp.w('d3')), false), 3::bigint,
  'suma dnia [since, until): dzień końca okna poza oknem');
SELECT is(public._newsletter_engagement_daily_sum('19e90000-0000-4000-8000-0000000006a0', 'click',
            date_trunc('day', pg_temp.w('d1')), date_trunc('day', pg_temp.w('d3')), true), 2::bigint,
  'suma dnia [since, until]: dzień końca okna w oknie');

-- ── 13-14. ACL ──────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_table_privilege('anon', 'public.newsletter_campaign_engagement_daily', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.newsletter_campaign_engagement_daily', 'SELECT')
  AND has_table_privilege('service_role', 'public.newsletter_campaign_engagement_daily', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.newsletter_campaign_engagement_daily'::regclass),
  'tabela: RLS, bez uprawnień anon/authenticated, zapis service_role');
SELECT ok(
  NOT has_function_privilege('anon',
        'public._newsletter_engagement_daily_sum(uuid, text, timestamptz, timestamptz, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
        'public._newsletter_engagement_daily_sum(uuid, text, timestamptz, timestamptz, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('service_role',
        'public._newsletter_engagement_daily_sum(uuid, text, timestamptz, timestamptz, boolean)', 'EXECUTE'),
  'pomocnik sumy dziennej: bez EXECUTE dla klientów i service_role');

SELECT * FROM finish();
ROLLBACK;
