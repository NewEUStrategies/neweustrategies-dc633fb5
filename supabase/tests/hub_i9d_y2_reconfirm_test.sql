-- pgTAP: „Poproś o zgodę na pomiar" i panel treści zgody (I9d-Y2; migracja
-- 20261020162500; decyzja właściciela 2026-10-20 pkt 3 i 2026-10-21).
--
-- CO PRZYPINA:
--   * kandydaci: aktywni subskrybenci bez zgody na pomiar (nie: ze zgodą,
--     z własnym „nie mierz", DOI, wypisani); lista wyłączeń liczona osobno;
--   * panel: podgląd i start tylko dla admina z sesji (redaktor 42501);
--     start z potwierdzoną liczbą (więcej kandydatów = 40001, brak liczby =
--     22023), prośba RAZ na wersję treści, audyt bez adresów;
--   * wysyłka: porcja z dzierżawą (druga porcja pusta), nieaktualna prośba
--     -> `skipped`, dzienny limit WSPÓLNY z prośbami wygaszania Y1, wynik
--     (błąd = kod i ponowienie, wysłana, powtórka `gone`, zły wynik 22023);
--   * link potwierdzenia: zły nonce `invalid`, potwierdzenie = wpis
--     `newsletter` z bieżącą treścią i wersją + `email_measurement` (status
--     subskrybenta bez zmian, znacznik zaangażowania), powtórka `already`,
--     wypisany `inactive`, zgoda już udzielona - `already` bez wpisu;
--   * oznaczenie „mój tekst obejmuje pomiar": odczyt admin/redaktor, zapis
--     admin; skrót zapisanego tekstu, zmiana tekstu = `stale`, zdjęcie,
--     błędy 22023, audyt; zgoda z oznaczonym tekstem daje pomiar; ACL.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_y2_reconfirm
BEGIN;
SELECT plan(29);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('19d80000-0000-4000-8000-0000000000a0', 'i9d-y2-prosba-a', 'I9d Y2 Prośba A'),
  ('19d80000-0000-4000-8000-0000000000b0', 'i9d-y2-prosba-b', 'I9d Y2 Prośba B');
INSERT INTO auth.users (id, email) VALUES
  ('19d80000-0000-4000-8000-00000000a001', 'admin@i9d-y2-prosba.test'),
  ('19d80000-0000-4000-8000-00000000a002', 'redaktor@i9d-y2-prosba.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19d80000-0000-4000-8000-00000000a001', 'admin@i9d-y2-prosba.test', 'Admin', '19d80000-0000-4000-8000-0000000000a0'),
  ('19d80000-0000-4000-8000-00000000a002', 'redaktor@i9d-y2-prosba.test', 'Redaktor', '19d80000-0000-4000-8000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19d80000-0000-4000-8000-00000000a001', 'admin', '19d80000-0000-4000-8000-0000000000a0'),
  ('19d80000-0000-4000-8000-00000000a002', 'editor', '19d80000-0000-4000-8000-0000000000a0');
INSERT INTO public.newsletter_settings (tenant_id, policy_html_pl, policy_html_en, popup_privacy_html_pl)
VALUES ('19d80000-0000-4000-8000-0000000000a0', public._newsletter_consent_default('pl'),
        'My own consent text: we measure opens and clicks.', NULL);

CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;
CREATE FUNCTION pg_temp.sub(p_key text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM public.newsletter_subscribers s WHERE s.email = p_key || '@i9d-y2-prosba.test'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sub(text) TO authenticated;
CREATE FUNCTION pg_temp.field(p jsonb, p_field text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT f - 'marked_at' FROM jsonb_array_elements(p -> 'fields') f WHERE f ->> 'field' = p_field
$$;
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r TO authenticated;

-- R1, R7 (EN) - zgoda sprzed Y2; R2 - zgoda z pomiarem; R3 - sam wyłączył
-- pomiar; R4 - na liście wyłączeń (blokada ręczna nie wypisuje); R5 - DOI;
-- R6 - wypisany.
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents, created_at)
SELECT '19d80000-0000-4000-8000-0000000000a0', k || '@i9d-y2-prosba.test',
       CASE k WHEN 'r5' THEN 'pending' WHEN 'r6' THEN 'unsubscribed' ELSE 'subscribed' END,
       CASE WHEN k = 'r7' THEN 'en' ELSE 'pl' END,
       CASE WHEN k IN ('r2', 'r3') THEN jsonb_build_array(jsonb_build_object(
              'key', 'newsletter', 'text', public._newsletter_consent_default('pl'),
              'version', public._newsletter_consent_version()))
            ELSE '[]'::jsonb END,
       now() - make_interval(days => n)
  FROM (VALUES ('r1', 7), ('r2', 6), ('r3', 5), ('r4', 4), ('r5', 3), ('r6', 2), ('r7', 1)) x(k, n);
UPDATE public.crm_consent_log SET created_at = now() - interval '1 day' WHERE email LIKE '%@i9d-y2-prosba.test';
SELECT public.email_measurement_withdraw(pg_temp.sub('r3'), NULL, 'preferences');
INSERT INTO public.email_suppressions (tenant_id, email, reason, scope, source, subscriber_id)
VALUES ('19d80000-0000-4000-8000-0000000000a0', 'r4@i9d-y2-prosba.test', 'manual', 'permanent', 'manual', pg_temp.sub('r4'));

-- Najemca B: 199 próśb wygaszania wysłanych w ostatniej dobie (budżet 200)
-- i 3 prośby o zgodę na pomiar czekające na wysyłkę.
INSERT INTO public.newsletter_subscribers (tenant_id, email, status)
SELECT '19d80000-0000-4000-8000-0000000000b0', 'b' || g || '@i9d-y2-prosba.test', 'subscribed'
  FROM generate_series(1, 202) g;
INSERT INTO public.newsletter_sunset_requests (subscriber_id, tenant_id, mailed_at, mail_outcome)
SELECT s.id, s.tenant_id, now() - interval '1 hour', 'queued'
  FROM public.newsletter_subscribers s
 WHERE s.tenant_id = '19d80000-0000-4000-8000-0000000000b0'
   AND split_part(s.email, '@', 1) IN (SELECT 'b' || g FROM generate_series(1, 199) g);
INSERT INTO public.newsletter_measurement_requests (subscriber_id, consent_version, tenant_id, requested_at)
SELECT s.id, public._newsletter_consent_version(), s.tenant_id, now() - interval '1 hour'
  FROM public.newsletter_subscribers s
 WHERE s.tenant_id = '19d80000-0000-4000-8000-0000000000b0'
   AND split_part(s.email, '@', 1) IN ('b200', 'b201', 'b202');

-- ── 1. Podgląd i start (panel) ───────────────────────────────────────────────
SELECT pg_temp.as_user('19d80000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'p0', public.admin_newsletter_measurement_preview();
RESET ROLE;
SELECT is(
  (SELECT v - 'last_requested_at' FROM r WHERE k = 'p0'),
  jsonb_build_object('version', 'newsletter-2026-10-21', 'enabled', true, 'subscribers', 5, 'with_consent', 1,
                     'candidates', 2, 'suppressed', 1, 'requested', 0, 'pending', 0, 'mailed', 0, 'blocked', 0,
                     'skipped', 0, 'failed', 0, 'confirmed', 0, 'daily_cap', 200),
  'podgląd: 5 aktywnych, 1 ze zgodą, 2 kandydatów (bez: ze zgodą, „nie mierz", DOI, wypisanych), 1 na liście wyłączeń');

SELECT pg_temp.as_user('19d80000-0000-4000-8000-00000000a002');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.admin_newsletter_measurement_preview() $$, '42501', 'forbidden',
  'podgląd: redaktor - 42501 (wysyłka do całej listy to decyzja admina)');
SELECT throws_ok($$ SELECT public.admin_newsletter_measurement_request(2) $$, '42501', 'forbidden',
  'start: redaktor - 42501');
SELECT pg_temp.as_user('19d80000-0000-4000-8000-00000000a001');
SELECT throws_ok($$ SELECT public.admin_newsletter_measurement_request(1) $$, '40001', 'stale_preview',
  'start: więcej kandydatów niż potwierdzono w podglądzie - 40001, bez wysyłki');
SELECT throws_ok($$ SELECT public.admin_newsletter_measurement_request(NULL) $$, '22023', 'expected_invalid',
  'start: bez potwierdzonej liczby - 22023');
INSERT INTO r SELECT 's1', public.admin_newsletter_measurement_request(2);
INSERT INTO r SELECT 's2', public.admin_newsletter_measurement_request(0);
INSERT INTO r SELECT 'p1', public.admin_newsletter_measurement_preview();
RESET ROLE;
SELECT ok(
  (SELECT v = '{"requested": 2, "version": "newsletter-2026-10-21"}'::jsonb FROM r WHERE k = 's1')
  AND (SELECT array_agg(split_part(s.email, '@', 1) ORDER BY s.email) = ARRAY['r1', 'r7']
         FROM public.newsletter_measurement_requests q JOIN public.newsletter_subscribers s ON s.id = q.subscriber_id
        WHERE q.tenant_id = '19d80000-0000-4000-8000-0000000000a0' AND q.requested_by = '19d80000-0000-4000-8000-00000000a001'),
  'start: prośba dla kandydatów spoza listy wyłączeń, autor z sesji');
SELECT ok(
  (SELECT (v ->> 'requested')::int = 0 FROM r WHERE k = 's2')
  AND (SELECT (v ->> 'candidates')::int = 0 AND (v ->> 'requested')::int = 2 AND (v ->> 'pending')::int = 2
              AND v ->> 'last_requested_at' IS NOT NULL FROM r WHERE k = 'p1'),
  'prośba RAZ na wersję treści: ponowny start nikogo nie dodaje; podgląd liczy zlecone');
SELECT ok(
  (SELECT count(*) = 1 FROM public.audit_log
    WHERE tenant_id = '19d80000-0000-4000-8000-0000000000a0' AND action = 'newsletter.measurement_reconfirm_requested'
      AND actor_id = '19d80000-0000-4000-8000-00000000a001' AND (metadata ->> 'requested')::int = 2
      AND NOT metadata::text LIKE '%@%'),
  'audyt startu: liczba i wersja, bez adresów; start bez nowych próśb - bez wpisu');

-- ── 2. Wysyłka: porcja, pominięcie, wspólny budżet ───────────────────────────
-- R7 udzielił zgody na pomiar innym kanałem przed wysyłką.
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given)
VALUES ('19d80000-0000-4000-8000-0000000000a0', 'r7@i9d-y2-prosba.test', 'newsletter', 'email_measurement',
        'Zgoda na pomiar (formularz)', true);
CREATE TEMP TABLE claimed ON COMMIT DROP AS SELECT * FROM public.newsletter_measurement_claim(50);
SELECT is(
  (SELECT jsonb_agg(jsonb_build_object('who', split_part(c.email, '@', 1), 'lang', c.lang, 'attempt', c.attempt,
                                       'version', c.consent_version, 'unsub', c.unsubscribe_token IS NOT NULL)
                    ORDER BY c.email)
     FROM claimed c WHERE c.tenant_id = '19d80000-0000-4000-8000-0000000000a0'),
  '[{"who": "r1", "lang": "pl", "unsub": true, "attempt": 1, "version": "newsletter-2026-10-21"}]'::jsonb,
  'porcja: subskrybent, język, wersja, token wypisu, próba; R7 (zgoda w międzyczasie) pominięty');
SELECT ok(
  (SELECT mail_outcome = 'skipped' AND mailed_at IS NOT NULL FROM public.newsletter_measurement_requests
    WHERE subscriber_id = pg_temp.sub('r7'))
  AND (SELECT count(*) = 1 FROM claimed WHERE tenant_id = '19d80000-0000-4000-8000-0000000000b0'),
  'nieaktualna prośba -> skipped bez maila; najemca B: 199 próśb wygaszania w dobie -> tylko 1 prośba o pomiar (limit wspólny)');
SELECT ok(
  public._newsletter_oneoff_mail_used('19d80000-0000-4000-8000-0000000000b0') = 200
  AND NOT EXISTS (SELECT 1 FROM public.newsletter_measurement_claim(50)),
  'budżet: wysłane prośby wygaszania + dzierżawy próśb o pomiar = 200; druga porcja pusta (dzierżawa i limit)');

-- Wynik wysyłki.
INSERT INTO r SELECT 'mf', public.newsletter_measurement_mark(pg_temp.sub('r1'), (SELECT nonce FROM claimed WHERE email LIKE 'r1@%'),
                                                              'failed', 'Błąd dla r1@i9d-y2-prosba.test');
SELECT ok(
  (SELECT (v ->> 'ok')::boolean AND NOT (v ->> 'mailed')::boolean AND v ->> 'retry_at' IS NOT NULL FROM r WHERE k = 'mf')
  AND (SELECT last_error = 'failed' AND mailed_at IS NULL FROM public.newsletter_measurement_requests
        WHERE subscriber_id = pg_temp.sub('r1')),
  'wynik: błąd = ponowienie po przerwie, zapisany kod (nie tekst z adresem)');
INSERT INTO r SELECT 'mq', public.newsletter_measurement_mark(pg_temp.sub('r1'), (SELECT nonce FROM claimed WHERE email LIKE 'r1@%'),
                                                              'queued');
SELECT ok(
  (SELECT v = '{"ok": true, "mailed": true, "retry_at": null}'::jsonb FROM r WHERE k = 'mq')
  AND (SELECT mail_outcome = 'queued' AND claimed_until IS NULL FROM public.newsletter_measurement_requests
        WHERE subscriber_id = pg_temp.sub('r1')),
  'wynik: w kolejce = wysłana');
SELECT ok(
  public.newsletter_measurement_mark(pg_temp.sub('r1'), (SELECT nonce FROM claimed WHERE email LIKE 'r1@%'), 'queued')
    ->> 'reason' = 'gone'
  AND public.newsletter_measurement_mark(pg_temp.sub('r1'), gen_random_uuid(), 'failed') ->> 'reason' = 'gone',
  'wynik: powtórka i obcy nonce - gone');
SELECT throws_ok(
  $$ SELECT public.newsletter_measurement_mark(gen_random_uuid(), gen_random_uuid(), 'sent') $$,
  '22023', 'outcome_invalid', 'wynik spoza listy - 22023');

-- ── 3. Link potwierdzenia ────────────────────────────────────────────────────
SELECT is(public.newsletter_measurement_confirm(pg_temp.sub('r1'), gen_random_uuid()) ->> 'result', 'invalid',
  'potwierdzenie: obcy nonce - invalid');
INSERT INTO r SELECT 'cf1', public.newsletter_measurement_confirm(pg_temp.sub('r1'), (SELECT nonce FROM claimed WHERE email LIKE 'r1@%'),
                                                                  '198.51.100.4', 'Mozilla/5.0 Test');
SELECT ok(
  (SELECT v ->> 'result' = 'confirmed' AND v ->> 'lang' = 'pl' FROM r WHERE k = 'cf1')
  AND public._email_measurement_consent('19d80000-0000-4000-8000-0000000000a0', 'r1@i9d-y2-prosba.test')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log
        WHERE email = 'r1@i9d-y2-prosba.test' AND consent_key = 'newsletter' AND given
          AND form_id = 'newsletter:measurement_reconfirm' AND consent_text = public._newsletter_consent_default('pl')
          AND consent_version = 'newsletter-2026-10-21' AND ip = '198.51.100.4')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log
        WHERE email = 'r1@i9d-y2-prosba.test' AND consent_key = 'email_measurement' AND given
          AND form_id = 'newsletter:measurement_reconfirm'),
  'potwierdzenie: wpis newsletter z bieżącą treścią i wersją z pomiarem (+ email_measurement) - zgoda na pomiar');
SELECT ok(
  (SELECT status = 'subscribed' AND last_engaged_at IS NOT NULL FROM public.newsletter_subscribers WHERE id = pg_temp.sub('r1'))
  AND (SELECT confirmed_at IS NOT NULL FROM public.newsletter_measurement_requests WHERE subscriber_id = pg_temp.sub('r1'))
  AND public.newsletter_measurement_confirm(pg_temp.sub('r1'), (SELECT nonce FROM claimed WHERE email LIKE 'r1@%')) ->> 'result' = 'already',
  'potwierdzenie: status bez zmian, znacznik zaangażowania, link jednorazowy (already)');
INSERT INTO public.newsletter_measurement_requests (subscriber_id, consent_version, tenant_id, nonce)
VALUES (pg_temp.sub('r6'), public._newsletter_consent_version(), '19d80000-0000-4000-8000-0000000000a0',
        '19d80000-0000-4000-8000-0000000070a6'),
       (pg_temp.sub('r2'), public._newsletter_consent_version(), '19d80000-0000-4000-8000-0000000000a0',
        '19d80000-0000-4000-8000-0000000070a2');
INSERT INTO r SELECT 'n_r2', to_jsonb((SELECT count(*) FROM public.crm_consent_log WHERE email = 'r2@i9d-y2-prosba.test'));
SELECT ok(
  public.newsletter_measurement_confirm(pg_temp.sub('r6'), '19d80000-0000-4000-8000-0000000070a6') ->> 'result' = 'inactive'
  AND public.newsletter_measurement_confirm(pg_temp.sub('r2'), '19d80000-0000-4000-8000-0000000070a2') ->> 'result' = 'already'
  AND public.newsletter_measurement_confirm(gen_random_uuid(), gen_random_uuid()) ->> 'result' = 'gone'
  AND public.newsletter_measurement_confirm(NULL, NULL) ->> 'result' = 'invalid',
  'potwierdzenie: wypisany - inactive (nie wraca na listę), zgoda już udzielona - already, nieznany - gone');
SELECT is((SELECT count(*) FROM public.crm_consent_log WHERE email = 'r2@i9d-y2-prosba.test'),
  (SELECT (v #>> '{}')::bigint FROM r WHERE k = 'n_r2'), 'potwierdzenie przy zgodzie już udzielonej - bez drugiego wpisu');

-- ── 4. Oznaczenie „mój tekst obejmuje pomiar" ────────────────────────────────
SELECT pg_temp.as_user('19d80000-0000-4000-8000-00000000a002');
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'g0', public.admin_newsletter_consent_measurement_get();
SELECT throws_ok($$ SELECT public.admin_newsletter_consent_measurement_mark('policy_html_en', true) $$, '42501', 'forbidden',
  'oznaczenie: redaktor czyta stan, ale nie oznacza (42501)');
RESET ROLE;
SELECT ok(
  (SELECT pg_temp.field(v, 'policy_html_pl') = '{"field": "policy_html_pl", "lang": "pl", "text_present": true,
          "is_default": true, "marked": false, "stale": false, "covers": true}'::jsonb FROM r WHERE k = 'g0')
  AND (SELECT pg_temp.field(v, 'policy_html_en') = '{"field": "policy_html_en", "lang": "en", "text_present": true,
          "is_default": false, "marked": false, "stale": false, "covers": false}'::jsonb FROM r WHERE k = 'g0')
  AND (SELECT pg_temp.field(v, 'popup_privacy_html_pl') = '{"field": "popup_privacy_html_pl", "lang": "pl",
          "text_present": false, "is_default": false, "marked": false, "stale": false, "covers": null}'::jsonb FROM r WHERE k = 'g0')
  AND (SELECT jsonb_array_length(v -> 'fields') = 4 AND v ->> 'version' = 'newsletter-2026-10-21' FROM r WHERE k = 'g0'),
  'stan: treść domyślna obejmuje pomiar, własny tekst EN - nie (ostrzeżenie), puste pole popupu - rozstrzyga panel');

SELECT pg_temp.as_user('19d80000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'm1', public.admin_newsletter_consent_measurement_mark('policy_html_en', true);
SELECT throws_ok($$ SELECT public.admin_newsletter_consent_measurement_mark('heading_pl', true) $$, '22023', 'field_invalid',
  'oznaczenie: pole spoza treści zgody - 22023');
SELECT throws_ok($$ SELECT public.admin_newsletter_consent_measurement_mark('popup_privacy_html_pl', true) $$, '22023',
  'text_missing', 'oznaczenie: puste pole - 22023 (nie ma czego oznaczyć)');
RESET ROLE;
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents)
VALUES ('19d80000-0000-4000-8000-0000000000a0', 'en-tekst@i9d-y2-prosba.test', 'subscribed', 'en',
        '[{"key":"newsletter","text":"My own consent text: we measure opens and clicks.","lang":"en"}]');
SELECT ok(
  (SELECT (pg_temp.field(v, 'policy_html_en') ->> 'marked')::boolean AND (pg_temp.field(v, 'policy_html_en') ->> 'covers')::boolean
     FROM r WHERE k = 'm1')
  AND (SELECT text_sha256 = public._consent_text_sha256('My own consent text: we measure opens and clicks.')
              AND marked_by = '19d80000-0000-4000-8000-00000000a001'
         FROM public.newsletter_consent_measurement_marks
        WHERE tenant_id = '19d80000-0000-4000-8000-0000000000a0' AND field = 'policy_html_en')
  AND public._email_measurement_consent('19d80000-0000-4000-8000-0000000000a0', 'en-tekst@i9d-y2-prosba.test')
  AND (SELECT count(*) = 1 FROM public.audit_log
        WHERE tenant_id = '19d80000-0000-4000-8000-0000000000a0' AND action = 'newsletter.consent_measurement_marked'
          AND metadata ->> 'field' = 'policy_html_en'),
  'oznaczenie (admin): skrót ZAPISANEGO tekstu, autor z sesji, audyt; zgoda z tym tekstem daje pomiar');

UPDATE public.newsletter_settings SET policy_html_en = 'My own consent text, edited later.'
 WHERE tenant_id = '19d80000-0000-4000-8000-0000000000a0';
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'g1', public.admin_newsletter_consent_measurement_get();
INSERT INTO r SELECT 'm2', public.admin_newsletter_consent_measurement_mark('policy_html_en', false);
RESET ROLE;
SELECT ok(
  (SELECT pg_temp.field(v, 'policy_html_en') ->> 'stale' = 'true' AND pg_temp.field(v, 'policy_html_en') ->> 'marked' = 'false'
          AND pg_temp.field(v, 'policy_html_en') ->> 'covers' = 'false' FROM r WHERE k = 'g1')
  AND (SELECT pg_temp.field(v, 'policy_html_en') ->> 'stale' = 'false' FROM r WHERE k = 'm2')
  AND NOT EXISTS (SELECT 1 FROM public.newsletter_consent_measurement_marks
                   WHERE tenant_id = '19d80000-0000-4000-8000-0000000000a0')
  AND EXISTS (SELECT 1 FROM public.audit_log WHERE tenant_id = '19d80000-0000-4000-8000-0000000000a0'
                AND action = 'newsletter.consent_measurement_unmarked'),
  'tekst zmieniony po oznaczeniu = stale (ostrzeżenie wraca); zdjęcie oznaczenia z audytem');

-- ── 5. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.newsletter_measurement_claim(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.newsletter_measurement_mark(uuid, uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.newsletter_measurement_confirm(uuid, uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.newsletter_measurement_confirm(uuid, uuid, text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.newsletter_measurement_claim(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.newsletter_measurement_confirm(uuid, uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.newsletter_sunset_claim(integer)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._newsletter_measurement_candidates(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._newsletter_oneoff_mail_used(uuid)', 'EXECUTE'),
  'ACL: wysyłka, potwierdzenie i porcja wygaszania - wyłącznie service_role; pomocniki bez ról API');
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_newsletter_measurement_preview()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_newsletter_measurement_request(integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_newsletter_consent_measurement_get()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_newsletter_consent_measurement_mark(text, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_newsletter_measurement_request(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_newsletter_consent_measurement_mark(text, boolean)', 'EXECUTE'),
  'ACL: RPC panelu - authenticated (rola z sesji w funkcji), bez anon');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.newsletter_measurement_requests'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.newsletter_measurement_requests', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.newsletter_measurement_requests', 'SELECT')
  AND has_table_privilege('service_role', 'public.newsletter_measurement_requests', 'UPDATE'),
  'tabela próśb: RLS, bez dostępu ról klienta');

SELECT * FROM finish();
ROLLBACK;
