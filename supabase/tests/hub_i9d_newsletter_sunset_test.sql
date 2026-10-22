-- pgTAP: wygaszanie nieaktywnych subskrybentów newslettera (I9d-Y1,
-- Z-I9c-08; migracje 20261020161900-162100 i rdzeń katalogu 20261020162200;
-- decyzja właściciela 2026-10-20 „tak, usuwaj").
--
-- CO PRZYPINA:
--   * zaangażowanie: kliknięcie, otwarcie LUDZKIE (po progu
--     `machine_open_seconds` od wysyłki; otwarcie tuż po doręczeniu - Apple
--     MPP - się nie liczy), logowanie powiązanego konta, formularz,
--     potwierdzenie zapisu; przy wyłączonym pomiarze otwarć - bez otwarć;
--     kandydat tylko z kampanią wysłaną w oknie; wykluczeni i niepotwierdzeni
--     (DOI) - nigdy; zapis zdarzenia ścieżki też utrwala zaangażowanie;
--   * cykl: JEDNA prośba (powtórka przebiegu nie tworzy drugiej; porcja do
--     wysyłki tylko po karencji, raz), wynik wysyłki (zablokowany listą
--     wyłączeń = jak wysłany, błąd = ponowienie), link „Chcę dalej
--     otrzymywać" jednorazowy (reset + wpis w rejestrze zgód), reakcja po
--     prośbie = reset;
--   * po 30 dniach bez reakcji: usunięcie subskrybenta; lista wyłączeń
--     NIETKNIĘTA, dziennik zgód zostaje + wpis wygaśnięcia; zgoda
--     marketingowa kontaktu CRM wycofana TYLKO gdy jej źródłem był newsletter;
--     zasięg kampanii bez zmian; powtórka = 0;
--   * najemca w karencji: podgląd, bez cyklu;
--   * panel: admin z sesji (redaktor 42501), lista „do wygaszenia",
--     wykluczenie i cofnięcie z powodem 3-500 (audit_log, bez adresu), cudzy
--     subskrybent P0002; ACL funkcji i tabel.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_newsletter_sunset
BEGIN;
SELECT plan(32);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- A: po karencji; B: w karencji; C: po karencji, pomiar otwarć wyłączony.
INSERT INTO public.tenants (id, slug, name, created_at) VALUES
  ('19d40000-0000-4000-8000-0000000000a0', 'i9d-newsletter-a', 'I9d Newsletter A', now() - interval '30 days'),
  ('19d40000-0000-4000-8000-0000000000b0', 'i9d-newsletter-b', 'I9d Newsletter B', now()),
  ('19d40000-0000-4000-8000-0000000000c0', 'i9d-newsletter-c', 'I9d Newsletter C', now() - interval '30 days');
INSERT INTO auth.users (id, email, last_sign_in_at) VALUES
  ('19d40000-0000-4000-8000-00000000a001', 'admin@i9d-newsletter.test', now()),
  ('19d40000-0000-4000-8000-00000000a002', 'redaktor@i9d-newsletter.test', now()),
  ('19d40000-0000-4000-8000-00000000e008', 's8@i9d-newsletter.test', now() - interval '1 month');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19d40000-0000-4000-8000-00000000a001', 'admin@i9d-newsletter.test', 'Admin', '19d40000-0000-4000-8000-0000000000a0'),
  ('19d40000-0000-4000-8000-00000000a002', 'redaktor@i9d-newsletter.test', 'Redaktor', '19d40000-0000-4000-8000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19d40000-0000-4000-8000-00000000a001', 'admin', '19d40000-0000-4000-8000-0000000000a0'),
  ('19d40000-0000-4000-8000-00000000a002', 'editor', '19d40000-0000-4000-8000-0000000000a0');
INSERT INTO public.journey_settings (tenant_id, open_tracking_enabled)
VALUES ('19d40000-0000-4000-8000-0000000000c0', false);

CREATE FUNCTION pg_temp.ts(p interval) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() - p $$;
CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;
CREATE FUNCTION pg_temp.sub(p_key text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM public.newsletter_subscribers s WHERE s.email = p_key || '@i9d-newsletter.test'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sub(text) TO authenticated;

-- Subskrybenci zapisani 20 mies. temu (potwierdzeni). S7 - niepotwierdzony
-- DOI; S3 - język angielski; S8 - konto zalogowane miesiąc temu.
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, first_name, user_id, created_at,
                                           confirmed_at)
SELECT t::uuid, k || '@i9d-newsletter.test', CASE WHEN k = 's7' THEN 'pending' ELSE 'subscribed' END,
       CASE WHEN k = 's3' THEN 'en' ELSE 'pl' END, 'Imię ' || k,
       CASE WHEN k = 's8' THEN '19d40000-0000-4000-8000-00000000e008'::uuid END,
       pg_temp.ts('20 months'), CASE WHEN k <> 's7' THEN pg_temp.ts('20 months') END
  FROM (VALUES ('19d40000-0000-4000-8000-0000000000a0', 's1'), ('19d40000-0000-4000-8000-0000000000a0', 's2'),
               ('19d40000-0000-4000-8000-0000000000a0', 's3'), ('19d40000-0000-4000-8000-0000000000a0', 's4'),
               ('19d40000-0000-4000-8000-0000000000a0', 's5'), ('19d40000-0000-4000-8000-0000000000a0', 's6'),
               ('19d40000-0000-4000-8000-0000000000a0', 's7'), ('19d40000-0000-4000-8000-0000000000a0', 's8'),
               ('19d40000-0000-4000-8000-0000000000a0', 's9'), ('19d40000-0000-4000-8000-0000000000a0', 's10'),
               ('19d40000-0000-4000-8000-0000000000a0', 's11'),
               ('19d40000-0000-4000-8000-0000000000b0', 'sb'), ('19d40000-0000-4000-8000-0000000000c0', 'sc')) x(t, k);
-- Wpisy zgód z zapisu (wyzwalacz modułu) - z chwilą zapisu, nie testu.
UPDATE public.crm_consent_log SET created_at = pg_temp.ts('20 months') WHERE email LIKE '%@i9d-newsletter.test';
-- S10: zgoda marketingowa także z formularza kontaktowego (inne źródło).
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given, created_at)
VALUES ('19d40000-0000-4000-8000-0000000000a0', 's10@i9d-newsletter.test', 'contact_form', 'marketing',
        'Zgoda na informacje handlowe', true, pg_temp.ts('20 months'));
-- S1: blokada listy wyłączeń (miękkie odbicie) - ma przetrwać usunięcie.
INSERT INTO public.email_suppressions (tenant_id, email, reason, scope, source, subscriber_id)
VALUES ('19d40000-0000-4000-8000-0000000000a0', 's1@i9d-newsletter.test', 'soft_bounce', 'transient', 'system',
        pg_temp.sub('s1'));

-- Kampania K1 wysłana 3 mies. temu do A (bez S6) i do B, C; K0 sprzed 20 mies. do S6.
INSERT INTO public.newsletter_campaigns (id, tenant_id, name) VALUES
  ('19d40000-0000-4000-8000-0000000020a1', '19d40000-0000-4000-8000-0000000000a0', 'K1'),
  ('19d40000-0000-4000-8000-0000000020a0', '19d40000-0000-4000-8000-0000000000a0', 'K0'),
  ('19d40000-0000-4000-8000-0000000020b1', '19d40000-0000-4000-8000-0000000000b0', 'KB'),
  ('19d40000-0000-4000-8000-0000000020c1', '19d40000-0000-4000-8000-0000000000c0', 'KC');
INSERT INTO public.newsletter_campaign_recipients (tenant_id, campaign_id, subscriber_id, email, status, sent_at)
SELECT s.tenant_id,
       CASE WHEN s.email LIKE 's6@%' THEN '19d40000-0000-4000-8000-0000000020a0'
            WHEN s.email LIKE 'sb@%' THEN '19d40000-0000-4000-8000-0000000020b1'
            WHEN s.email LIKE 'sc@%' THEN '19d40000-0000-4000-8000-0000000020c1'
            ELSE '19d40000-0000-4000-8000-0000000020a1' END::uuid,
       s.id, s.email, 'sent', CASE WHEN s.email LIKE 's6@%' THEN pg_temp.ts('20 months') ELSE pg_temp.ts('3 months') END
  FROM public.newsletter_subscribers s WHERE s.email LIKE '%@i9d-newsletter.test';

-- Zdarzenia kampanii przez JEDYNĄ ścieżkę zapisu: S1 i S3 - otwarcie tuż po
-- doręczeniu (Apple MPP), S4 - otwarcie godzinę po wysyłce, S2 - kliknięcie,
-- SC - otwarcie ludzkie przy wyłączonym pomiarze.
SELECT public.newsletter_record_campaign_event(r.campaign_id, r.subscriber_id, e.kind, e.url, r.sent_at + e.after)
  FROM public.newsletter_campaign_recipients r
  JOIN (VALUES ('s1', 'open', NULL, interval '1 second'), ('s3', 'open', NULL, interval '1 second'),
               ('s4', 'open', NULL, interval '1 hour'), ('s2', 'click', 'https://nes.example/a', interval '1 hour'),
               ('sc', 'open', NULL, interval '1 hour')) e(k, kind, url, after)
    ON r.email = e.k || '@i9d-newsletter.test';
-- S9: formularz z adresem istniejącego subskrybenta.
SELECT public.newsletter_engagement_touch('19d40000-0000-4000-8000-0000000000a0', 'S9@i9d-newsletter.test');

-- Ścieżka (S5): kliknięcie w mailu ścieżki do kontaktu S11 - znacznik
-- zaangażowania po adresie kontaktu (sprawdzany niżej, przed resetem).
INSERT INTO public.journey_definitions (id, tenant_id, key, name, status, category) VALUES
  ('19d40000-0000-4000-8000-0000000050a1', '19d40000-0000-4000-8000-0000000000a0', 'i9d-sunset', 'Ścieżka', 'active', 'marketing');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum, published_at)
VALUES ('19d40000-0000-4000-8000-0000000050b1', '19d40000-0000-4000-8000-0000000000a0', '19d40000-0000-4000-8000-0000000050a1', 1,
        'account.registered.v1',
        '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],"edges":[{"from":"t","to":"x","branch":"next"}]}',
        'x', pg_temp.ts('4 months'));
INSERT INTO public.journey_enrollments (id, tenant_id, journey_id, version_id, lead_id, status, trigger_snapshot, enrollment_key)
SELECT '19d40000-0000-4000-8000-0000000050c1', l.tenant_id, '19d40000-0000-4000-8000-0000000050a1',
       '19d40000-0000-4000-8000-0000000050b1', l.id, 'active', '{}', 'i9d-sunset'
  FROM public.crm_leads l WHERE l.email_norm = 's11@i9d-newsletter.test';
INSERT INTO public.journey_step_runs (tenant_id, enrollment_id, journey_id, version_id, node_id, node_type, status)
VALUES ('19d40000-0000-4000-8000-0000000000a0', '19d40000-0000-4000-8000-0000000050c1', '19d40000-0000-4000-8000-0000000050a1',
        '19d40000-0000-4000-8000-0000000050b1', 'm', 'send_email', 'succeeded');
INSERT INTO public.journey_messages (message_id, tenant_id, enrollment_id, journey_id, version_id, node_id, lead_id, queued_at)
SELECT 'i9d-sunset-m', l.tenant_id, '19d40000-0000-4000-8000-0000000050c1', '19d40000-0000-4000-8000-0000000050a1',
       '19d40000-0000-4000-8000-0000000050b1', 'm', l.id, now() - interval '1 hour'
  FROM public.crm_leads l WHERE l.email_norm = 's11@i9d-newsletter.test';

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r TO authenticated;

-- ── 1. Zaangażowanie ─────────────────────────────────────────────────────────
SELECT ok(
  (SELECT last_engaged_at IS NOT NULL FROM public.newsletter_subscribers WHERE id = pg_temp.sub('s2'))
  AND (SELECT last_human_open_at IS NOT NULL AND last_engaged_at IS NULL FROM public.newsletter_subscribers
        WHERE id = pg_temp.sub('s4'))
  AND (SELECT last_human_open_at IS NULL AND last_engaged_at IS NULL FROM public.newsletter_subscribers
        WHERE id = pg_temp.sub('s1'))
  AND (SELECT count(*) = 2 FROM public.newsletter_campaign_events WHERE kind = 'open'
         AND subscriber_id IN (pg_temp.sub('s1'), pg_temp.sub('s3'))),
  'zapis kampanii: kliknięcie i otwarcie po progu utrwalają zaangażowanie; otwarcie tuż po doręczeniu (MPP) - nie (zdarzenie zapisane)');
SELECT ok(
  (SELECT last_engaged_at >= now() - interval '1 minute' FROM public.newsletter_subscribers WHERE id = pg_temp.sub('s9')),
  'formularz z adresem subskrybenta (wielkość liter bez znaczenia) = zaangażowanie');

SELECT is(
  (SELECT array_agg(split_part(s.email, '@', 1) ORDER BY split_part(s.email, '@', 1))
     FROM public._data_retention_newsletter_candidates('19d40000-0000-4000-8000-0000000000a0', pg_temp.ts('12 months'), 100) c
     JOIN public.newsletter_subscribers s ON s.id = c.subscriber_id),
  ARRAY['s1', 's10', 's11', 's3', 's5'],
  'kandydaci: bez kliknięcia, otwarcia ludzkiego, logowania i formularza, z kampanią w oknie (nie: S6 bez kampanii, S7 DOI, S8 konto)');

-- Wykluczenie z panelu (admin z sesji) - przed przebiegiem.
SELECT pg_temp.as_user('19d40000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'excl', public.admin_data_retention_newsletter_exclude(pg_temp.sub('s5'), '  Partner instytucjonalny  ');
RESET ROLE;
SELECT ok(
  (SELECT v ->> 'excluded' = 'true' FROM r WHERE k = 'excl')
  AND (SELECT reason = 'Partner instytucjonalny' AND created_by = '19d40000-0000-4000-8000-00000000a001'
         FROM public.newsletter_sunset_exclusions WHERE subscriber_id = pg_temp.sub('s5'))
  AND (SELECT count(*) = 1 FROM public.audit_log
        WHERE tenant_id = '19d40000-0000-4000-8000-0000000000a0' AND action = 'data_retention.newsletter_excluded'
          AND entity_type = 'newsletter_subscriber' AND entity_id = pg_temp.sub('s5')
          AND metadata ->> 'reason' = 'Partner instytucjonalny' AND NOT metadata::text LIKE '%@%'),
  'wykluczenie: powód (bez spacji brzegowych), autor z sesji, audit_log bez adresu');

-- ── 2. Karencja (B) i przebieg (A, C) ────────────────────────────────────────
INSERT INTO r SELECT 'b', public._data_retention_run_tenant('19d40000-0000-4000-8000-0000000000b0', 'schedule', 1000);
SELECT ok(
  (SELECT v -> 'newsletter_inactive' ->> 'mode' = 'preview' AND (v -> 'newsletter_inactive' ->> 'requested')::int = 1
     FROM r WHERE k = 'b')
  AND NOT EXISTS (SELECT 1 FROM public.newsletter_sunset_requests WHERE tenant_id = '19d40000-0000-4000-8000-0000000000b0'),
  'najemca w karencji: podgląd liczy prośby, cykl nie powstaje (bez maila)');

INSERT INTO r SELECT 'a1', public._data_retention_run_tenant('19d40000-0000-4000-8000-0000000000a0', 'schedule', 1000);
INSERT INTO r SELECT 'c1', public._data_retention_run_tenant('19d40000-0000-4000-8000-0000000000c0', 'schedule', 1000);
SELECT ok(
  (SELECT v -> 'newsletter_inactive' ->> 'mode' = 'execute' AND (v -> 'newsletter_inactive' ->> 'requested')::int = 4
          AND (v -> 'newsletter_inactive' ->> 'deleted')::int = 0 FROM r WHERE k = 'a1')
  AND (SELECT array_agg(split_part(s.email, '@', 1) ORDER BY split_part(s.email, '@', 1))
         FROM public.newsletter_sunset_requests q
         JOIN public.newsletter_subscribers s ON s.id = q.subscriber_id
        WHERE q.tenant_id = '19d40000-0000-4000-8000-0000000000a0') = ARRAY['s1', 's10', 's11', 's3'],
  'wykonanie: cykl (prośba czeka na wysyłkę) dla 4 nieaktywnych; wykluczony - bez cyklu');
SELECT ok(
  EXISTS (SELECT 1 FROM public.newsletter_sunset_requests WHERE subscriber_id = pg_temp.sub('sc')),
  'pomiar otwarć wyłączony: otwarcie ludzkie się nie liczy - cykl powstaje');

INSERT INTO r SELECT 'a2', public._data_retention_run_tenant('19d40000-0000-4000-8000-0000000000a0', 'schedule', 1000);
SELECT ok(
  (SELECT (v -> 'newsletter_inactive' ->> 'affected')::int = 0 FROM r WHERE k = 'a2')
  AND (SELECT count(*) = 4 FROM public.newsletter_sunset_requests WHERE tenant_id = '19d40000-0000-4000-8000-0000000000a0'),
  'prośba raz: powtórka przebiegu nie tworzy drugiego cyklu');

-- Ścieżka: kliknięcie S11 w mailu ścieżki (zapis S5 z nowym znacznikiem).
SELECT public.journey_record_message_event('i9d-sunset-m', 'click', 0, 'https://nes.example/b', false);
SELECT ok(
  (SELECT last_engaged_at >= now() - interval '1 minute' FROM public.newsletter_subscribers WHERE id = pg_temp.sub('s11')),
  'zapis zdarzenia ścieżki: kliknięcie utrwala zaangażowanie subskrybenta po adresie kontaktu');

-- ── 3. Wysyłka prośby (krok TS przez claim/mark) ─────────────────────────────
-- Cykl B założony ręcznie: najemca w karencji nie dostaje maila.
INSERT INTO public.newsletter_sunset_requests (subscriber_id, tenant_id)
VALUES (pg_temp.sub('sb'), '19d40000-0000-4000-8000-0000000000b0');
CREATE TEMP TABLE claimed ON COMMIT DROP AS SELECT * FROM public.newsletter_sunset_claim(50);
SELECT ok(
  (SELECT count(*) = 5 FROM claimed)
  AND NOT EXISTS (SELECT 1 FROM claimed WHERE tenant_id = '19d40000-0000-4000-8000-0000000000b0')
  AND (SELECT lang = 'en' AND first_name = 'Imię s3' AND unsubscribe_token IS NOT NULL AND attempt = 1
              AND delete_after > now() + interval '29 days' FROM claimed WHERE subscriber_id = pg_temp.sub('s3'))
  AND (SELECT bool_and(lang = 'pl') FROM claimed WHERE subscriber_id <> pg_temp.sub('s3')),
  'porcja do wysyłki: 4 prośby A i 1 C (bez najemcy w karencji), język subskrybenta, token wypisu, termin usunięcia');

-- Wynik wysyłki w osobnej instrukcji: asercja niżej czyta stan PO zapisie.
CREATE TEMP TABLE marked ON COMMIT DROP AS
SELECT c.subscriber_id, public.newsletter_sunset_mark(c.subscriber_id, c.nonce,
         CASE split_part(c.email, '@', 1) WHEN 's3' THEN 'suppressed' WHEN 's11' THEN 'duplicate'
                                          WHEN 'sc' THEN 'failed' ELSE 'queued' END,
         CASE WHEN c.email LIKE 'sc@%' THEN 'smtp_timeout' END) AS res
  FROM claimed c;
SELECT ok(
  (SELECT bool_and((res ->> 'ok')::boolean) AND count(*) FILTER (WHERE (res ->> 'mailed')::boolean) = 4 FROM marked)
  AND (SELECT count(*) = 4 FROM public.newsletter_sunset_requests
        WHERE tenant_id = '19d40000-0000-4000-8000-0000000000a0' AND mailed_at IS NOT NULL)
  AND (SELECT mail_outcome = 'suppressed' FROM public.newsletter_sunset_requests WHERE subscriber_id = pg_temp.sub('s3'))
  AND (SELECT mailed_at IS NULL AND last_error = 'smtp_timeout' AND claimed_until > now()
         FROM public.newsletter_sunset_requests WHERE subscriber_id = pg_temp.sub('sc')),
  'wynik wysyłki: w kolejce/duplikat/zablokowany listą wyłączeń = wysłany; błąd = ponowienie po przerwie (kod, nie tekst)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.newsletter_sunset_claim(50))
  AND (public.newsletter_sunset_mark(pg_temp.sub('s1'), (SELECT nonce FROM claimed WHERE subscriber_id = pg_temp.sub('s1')),
                                     'queued') ->> 'reason') = 'gone',
  'mail raz: wysłanej prośby porcja już nie zwraca, drugi wynik odrzucony (gone)');
SELECT throws_ok(
  $$ SELECT public.newsletter_sunset_mark(gen_random_uuid(), gen_random_uuid(), 'sent') $$,
  '22023', 'outcome_invalid', 'wynik spoza słownika: 22023');

-- ── 4. „Chcę dalej otrzymywać" (S3) ──────────────────────────────────────────
SELECT is(public.newsletter_sunset_keep(pg_temp.sub('s3'), gen_random_uuid()) ->> 'result', 'already',
  'link z obcym nonce: bez skutku');
INSERT INTO r SELECT 'keep', public.newsletter_sunset_keep(pg_temp.sub('s3'), (SELECT nonce FROM claimed WHERE subscriber_id = pg_temp.sub('s3')));
SELECT ok(
  (SELECT v ->> 'result' = 'kept' AND v ->> 'lang' = 'en' AND v ->> 'tenant_id' = '19d40000-0000-4000-8000-0000000000a0'
     FROM r WHERE k = 'keep')
  AND NOT EXISTS (SELECT 1 FROM public.newsletter_sunset_requests WHERE subscriber_id = pg_temp.sub('s3'))
  AND (SELECT last_engaged_at >= now() - interval '1 minute' FROM public.newsletter_subscribers WHERE id = pg_temp.sub('s3'))
  AND EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email = 's3@i9d-newsletter.test' AND given
                AND consent_key = 'newsletter' AND form_id = 'retention:newsletter_keep' AND lang = 'en'),
  'link „Chcę dalej otrzymywać": cykl usunięty (reset), znacznik zaangażowania, wpis potwierdzenia w rejestrze zgód');
SELECT is(public.newsletter_sunset_keep(pg_temp.sub('s3'), (SELECT nonce FROM claimed WHERE subscriber_id = pg_temp.sub('s3'))) ->> 'result',
  'already', 'token jednorazowy: drugie użycie bez skutku');

-- ── 5. Po 30 dniach bez reakcji ──────────────────────────────────────────────
UPDATE public.newsletter_sunset_requests
   SET requested_at = now() - interval '32 days', mailed_at = now() - interval '31 days'
 WHERE tenant_id = '19d40000-0000-4000-8000-0000000000a0';
CREATE TEMP TABLE before_del ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.email_suppressions WHERE email = 's1@i9d-newsletter.test') AS suppressions,
       (SELECT count(*) FROM public.crm_consent_log WHERE email LIKE '%@i9d-newsletter.test') AS consents,
       (SELECT to_jsonb(e) FROM (SELECT * FROM public.newsletter_campaign_engagement('19d40000-0000-4000-8000-0000000020a1')) e)
         AS engagement
  FROM (SELECT pg_temp.as_user('19d40000-0000-4000-8000-00000000a001')) x;
SELECT set_config('request.jwt.claims', '', true);

INSERT INTO r SELECT 'a3', public._data_retention_run_tenant('19d40000-0000-4000-8000-0000000000a0', 'schedule', 1000);
SELECT ok(
  (SELECT (v -> 'newsletter_inactive' ->> 'deleted')::int = 2 AND (v -> 'newsletter_inactive' ->> 'reset')::int = 1
     FROM r WHERE k = 'a3')
  AND pg_temp.sub('s1') IS NULL AND pg_temp.sub('s10') IS NULL
  AND pg_temp.sub('s11') IS NOT NULL AND pg_temp.sub('s3') IS NOT NULL AND pg_temp.sub('s5') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.newsletter_sunset_requests WHERE tenant_id = '19d40000-0000-4000-8000-0000000000a0'),
  'po 30 dniach: bez reakcji -> usunięci; reakcja po prośbie (kliknięcie) -> reset; potwierdzony i wykluczony zostają');

SELECT ok(
  (SELECT count(*) FROM public.email_suppressions WHERE email = 's1@i9d-newsletter.test') = (SELECT suppressions FROM before_del)
  AND (SELECT subscriber_id IS NULL AND reason = 'soft_bounce' FROM public.email_suppressions
        WHERE email = 's1@i9d-newsletter.test')
  AND NOT EXISTS (SELECT 1 FROM public.email_suppressions WHERE email = 's10@i9d-newsletter.test'),
  'lista wyłączeń NIETKNIĘTA: blokada zostaje (odpięta od subskrybenta), nowej nie ma (to nie sprzeciw)');

SELECT ok(
  (SELECT count(*) FROM public.crm_consent_log WHERE email LIKE '%@i9d-newsletter.test')
    = (SELECT consents FROM before_del) + 3
  AND (SELECT count(*) = 1 FROM public.crm_consent_log
        WHERE email = 's1@i9d-newsletter.test' AND consent_key = 'newsletter' AND NOT given
          AND source_type = 'newsletter' AND form_id = 'retention:newsletter_sunset'
          AND consent_text LIKE 'Wygaśnięcie zgody%')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log
        WHERE email = 's10@i9d-newsletter.test' AND consent_key = 'newsletter' AND NOT given
          AND form_id = 'retention:newsletter_sunset')
  AND EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email = 's1@i9d-newsletter.test' AND consent_key = 'newsletter'
                AND given AND created_at < now() - interval '1 year'),
  'dziennik zgód zostaje (dowód zapisu) + wpis wygaśnięcia łańcucha newslettera (od niego 6 lat dowodu)');

SELECT ok(
  (SELECT NOT marketing_consent AND newsletter_status IS NULL FROM public.crm_leads
    WHERE email_norm = 's1@i9d-newsletter.test')
  AND EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email = 's1@i9d-newsletter.test' AND consent_key = 'marketing'
                AND NOT given AND form_id = 'retention:newsletter_sunset')
  AND (SELECT marketing_consent AND newsletter_status IS NULL FROM public.crm_leads
        WHERE email_norm = 's10@i9d-newsletter.test')
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email = 's10@i9d-newsletter.test'
                    AND consent_key = 'marketing' AND NOT given),
  'zgoda marketingowa kontaktu CRM: wycofana (wpis „nie") TYLKO gdy jej źródłem był newsletter; zgoda z formularza zostaje');

SELECT pg_temp.as_user('19d40000-0000-4000-8000-00000000a001');
SELECT is(
  (SELECT to_jsonb(e) FROM (SELECT * FROM public.newsletter_campaign_engagement('19d40000-0000-4000-8000-0000000020a1')) e),
  (SELECT engagement FROM before_del),
  'zasięg kampanii (otwarcia, kliknięcia, unikalni) bez zmian - zdarzenia usuniętego zwinięte do archiwum');
SELECT set_config('request.jwt.claims', '', true);

INSERT INTO r SELECT 'a4', public._data_retention_run_tenant('19d40000-0000-4000-8000-0000000000a0', 'schedule', 1000);
SELECT is((SELECT (v -> 'newsletter_inactive' ->> 'affected')::int FROM r WHERE k = 'a4'), 0,
  'idempotencja: powtórka nic nie zmienia');

-- ── 6. Panel ─────────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('19d40000-0000-4000-8000-00000000a002');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.admin_data_retention_newsletter_due(50) $$, '42501', NULL,
  'lista „do wygaszenia": redaktor odrzucony (42501)');
RESET ROLE;
SELECT pg_temp.as_user('19d40000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'due', public.admin_data_retention_newsletter_due(50);
RESET ROLE;
SELECT ok(
  (SELECT (v -> 'counts' ->> 'excluded')::int = 1 AND (v -> 'counts' ->> 'requested')::int = 0
          AND (v ->> 'response_days')::int = 30 AND (v ->> 'daily_cap')::int = 200
          AND (v ->> 'open_tracking_enabled')::boolean AND (v ->> 'enabled')::boolean AND (v ->> 'enforced')::boolean
          AND (v ->> 'period_months')::int = 12
          AND v -> 'excluded' -> 0 ->> 'email' = 's5@i9d-newsletter.test'
          AND v -> 'excluded' -> 0 ->> 'reason' = 'Partner instytucjonalny'
     FROM r WHERE k = 'due'),
  'lista „do wygaszenia": liczby, reguły (30 dni, limit dzienny), okres, pomiar otwarć, wykluczeni z powodem');

SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.admin_data_retention_newsletter_exclude(pg_temp.sub('s2'), ' ab ') $$, '22023',
  'reason_length', 'wykluczenie: powód krótszy niż 3 znaki odrzucony');
SELECT throws_ok($$ SELECT public.admin_data_retention_newsletter_exclude(pg_temp.sub('s2'), repeat('x', 501)) $$, '22023',
  'reason_length', 'wykluczenie: powód dłuższy niż 500 znaków odrzucony (nie skrócony)');
SELECT throws_ok($$ SELECT public.admin_data_retention_newsletter_exclude(pg_temp.sub('sb'), 'Cudzy najemca') $$, 'P0002',
  'subscriber_not_found', 'wykluczenie: subskrybent innego najemcy - P0002 (najemca z sesji)');
SELECT lives_ok($$ SELECT public.admin_data_retention_newsletter_include(pg_temp.sub('s5'), 'Koniec partnerstwa') $$,
  'cofnięcie wykluczenia z powodem');
SELECT throws_ok($$ SELECT public.admin_data_retention_newsletter_include(pg_temp.sub('s5'), 'Ponownie') $$, 'P0002',
  'exclusion_not_found', 'cofnięcie nieistniejącego wykluczenia - P0002');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.newsletter_sunset_exclusions WHERE subscriber_id = pg_temp.sub('s5'))
  AND (SELECT count(*) = 1 FROM public.audit_log
        WHERE tenant_id = '19d40000-0000-4000-8000-0000000000a0' AND action = 'data_retention.newsletter_exclusion_removed'
          AND entity_id = pg_temp.sub('s5') AND metadata ->> 'reason' = 'Koniec partnerstwa'),
  'cofnięcie: wykluczenie zdjęte, audit_log z powodem');

-- ── 7. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
             'public.newsletter_sunset_claim(integer)', 'public.newsletter_sunset_mark(uuid, uuid, text, text)',
             'public.newsletter_sunset_keep(uuid, uuid)', 'public.newsletter_engagement_touch(uuid, text)',
             'public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)',
             'public.journey_record_message_event(text, text, integer, text, boolean)']) f,
           unnest(ARRAY['anon', 'authenticated']) rl
     WHERE has_function_privilege(rl, f, 'EXECUTE'))
  AND has_function_privilege('service_role', 'public.newsletter_sunset_claim(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.newsletter_sunset_mark(uuid, uuid, text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.newsletter_sunset_keep(uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.newsletter_engagement_touch(uuid, text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
             'public._newsletter_engagement_touch(uuid, uuid, text, text, timestamptz)',
             'public._newsletter_last_engagement(uuid, boolean)', 'public._newsletter_track_opens(uuid)',
             'public._data_retention_newsletter_candidates(uuid, timestamptz, integer)',
             'public._newsletter_sunset_fold_events(uuid, uuid)', 'public._newsletter_sunset_delete(uuid, uuid)',
             'public._data_retention_newsletter_inactive(uuid, timestamptz, boolean, integer)']) f,
           unnest(ARRAY['anon', 'authenticated', 'service_role']) rl
     WHERE has_function_privilege(rl, f, 'EXECUTE')),
  'acl: wysyłka, wynik, link i formularz - tylko service_role; funkcje wewnętrzne - bez EXECUTE dla ról API');
SELECT ok(
  (SELECT bool_and(has_function_privilege('authenticated', f, 'EXECUTE') AND NOT has_function_privilege('anon', f, 'EXECUTE'))
     FROM unnest(ARRAY['public.admin_data_retention_newsletter_due(integer)',
                       'public.admin_data_retention_newsletter_exclude(uuid, text)',
                       'public.admin_data_retention_newsletter_include(uuid, text)']) f)
  AND (SELECT bool_and(c.relrowsecurity) FROM pg_class c
        WHERE c.oid IN ('public.newsletter_sunset_requests'::regclass, 'public.newsletter_sunset_exclusions'::regclass))
  AND NOT has_table_privilege('authenticated', 'public.newsletter_sunset_requests', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.newsletter_sunset_exclusions', 'SELECT'),
  'acl: RPC panelu - authenticated (admin z sesji), bez anon; tabele cyklu i wykluczeń z RLS, bez dostępu klienta');

SELECT * FROM finish();
ROLLBACK;
