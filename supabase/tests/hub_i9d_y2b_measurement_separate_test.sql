-- pgTAP: zgoda na pomiar otwarć i kliknięć jako OSOBNE pole i pomiar tylko dla
-- skrzynki potwierdzonej przez właściciela (I9d-Y2b; migracje 20261023090000,
-- 20261023090100, 20261023090200; decyzje właściciela 2026-10-23: D1 wariant
-- (b), D2).
--
-- CO PRZYPINA:
--   * treści i wersje: zgoda na newsletter (b) bez pomiaru i bez akceptacji
--     polityki, osobna treść pola pomiaru, rejestr wersji = wersje pomiaru,
--     kanały udzielenia/odmowy, dawne zaufane pary;
--   * dane ustawień: dawne treści domyślne -> (b), pakiet z wymaganego pola
--     prywatności popupu -> NULL, tekst admina zostaje, powtórka = 0, DEFAULT;
--   * brak pakietowania (wyzwalacz, funkcje, RPC oznaczeń, tabela tylko do
--     odczytu): zgoda na newsletter (a) i (b) nie daje pomiaru;
--   * strażnik rejestru: „tak" bez flagi (superuser i service_role), deklaracja
--     i inna pisownia klucza - 0 wierszy, „nie" przechodzi; UPDATE wpisu pomiaru
--     (decyzja, chwila, klucz) - 42501, pseudonimizacja adresu przechodzi;
--     pisarz z kanałem spoza listy - 22023;
--   * pisarze formularzy: subskrybent, ponowny zapis (UPDATE consents),
--     wiadomość kontaktowa - zero „tak" pomiaru; rezerwa `newsletter` tylko
--     przy pustym consents;
--   * `pending` i strona DOI (sygnatury z sekretem skrzynki z 20261023090300 -
--     reszta sekretu: hub_i9d_y2b_measurement_fixes_test): brak pomiaru przed
--     potwierdzeniem, stan inactive -> offer, decyzja „tak" (kanał, treść,
--     wersja, IP, UA), „nie" (kanał odmowy, wykluczenie z próśb), powtórka
--     `already`, brak/zła deklaracja `none`, deklaracja z ładunku TS (HTML
--     i tekst), wygaśnięcie (prośba - 60 dni od deklaracji, DOI - termin
--     z podpisu), token nieznany/zły/wyzerowany `invalid`, wypisany bez
--     wyzerowania tokenu `inactive`;
--   * prośba po zapisie bez DOI (origin signup), porcja z pochodzeniem
--     i osobnym budżetem, potwierdzenie z kanałem signup/reconfirm bez wpisu
--     newsletter, panel w wersji pomiaru (liczniki tylko panelu), kandydaci
--     bez maila prośby (a), kolejka (a) przepięta;
--   * czytelnik: wiersze (a) z treści formularza - brak pomiaru, dawne
--     potwierdzenie z prośby - pomiar tylko z potwierdzoną prośbą, brak
--     związania, kontakt CRM bez subskrypcji, wycofanie newsletter, remis;
--   * wypis każdym kanałem (UPDATE, link, odbicie, skarga, panel) - „nie"
--     neutralne raz, „Przywróć" nie wskrzesza, ponowny zapis przez osobę
--     trzecią czeka na decyzję właściciela; wycofanie `unsubscribe` z zewnątrz
--     = `email_footer`; retencja usuwa łańcuch pomiaru; ACL.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_y2b_measurement_separate
BEGIN;
SELECT plan(59);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('19db0000-0000-4000-8000-0000000000a0', 'i9d-y2b-a', 'I9d Y2b A'),
  ('19db0000-0000-4000-8000-0000000000b0', 'i9d-y2b-b', 'I9d Y2b B'),
  ('19db0000-0000-4000-8000-0000000000c0', 'i9d-y2b-c', 'I9d Y2b C'),
  ('19db0000-0000-4000-8000-0000000000d0', 'i9d-y2b-d', 'I9d Y2b D'),
  ('19db0000-0000-4000-8000-0000000000e0', 'i9d-y2b-e', 'I9d Y2b E');
INSERT INTO auth.users (id, email) VALUES ('19db0000-0000-4000-8000-00000000a001', 'admin@i9d-y2b.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19db0000-0000-4000-8000-00000000a001', 'admin@i9d-y2b.test', 'Admin', '19db0000-0000-4000-8000-0000000000b0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19db0000-0000-4000-8000-00000000a001', 'admin', '19db0000-0000-4000-8000-0000000000b0');

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r TO authenticated, service_role;
CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;
CREATE FUNCTION pg_temp.sub(p_key text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM public.newsletter_subscribers s WHERE s.email = p_key || '@i9d-y2b.test'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sub(text) TO authenticated;
CREATE FUNCTION pg_temp.consent(p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public._email_measurement_consent(s.tenant_id, s.email)
    FROM public.newsletter_subscribers s WHERE s.email = p_key || '@i9d-y2b.test'
$$;
CREATE FUNCTION pg_temp.state(p_key text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT public._newsletter_measurement_offer_state(pg_temp.sub(p_key))
$$;
-- Strona DOI (od 20261023090300) z treścią podpisanego parametru `m` z maila
-- (podpis HMAC sprawdza serwer TS): subskrybent i adres z wiersza tokenu,
-- bieżąca wersja treści pomiaru, termin za 30 dni.
CREATE FUNCTION pg_temp.doi_state(p_key text, p_expires timestamptz DEFAULT now() + interval '30 days')
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT public.newsletter_doi_measurement_state(md5(p_key), s.id, s.email,
                                                 public._email_measurement_consent_version(), p_expires)
    FROM public.newsletter_subscribers s WHERE s.confirmation_token = md5(p_key)
$$;
CREATE FUNCTION pg_temp.doi_decide(p_key text, p_grant boolean, p_ip text DEFAULT NULL, p_ua text DEFAULT NULL,
                                   p_expires timestamptz DEFAULT now() + interval '30 days')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.newsletter_doi_measurement_decide(md5(p_key), s.id, s.email,
                                                  public._email_measurement_consent_version(), p_expires,
                                                  p_grant, p_ip, p_ua)
    FROM public.newsletter_subscribers s WHERE s.confirmation_token = md5(p_key)
$$;
-- Deklaracja pola pomiaru jak z `measurementConsentPayload` (+ chwila odbioru).
CREATE FUNCTION pg_temp.tick(p_lang text, p_at timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('key', 'email_measurement_declared', 'text', public._email_measurement_consent_default(p_lang),
                            'version', public._email_measurement_consent_version(), 'given', true, 'lang', p_lang,
                            'received_at', to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;
CREATE FUNCTION pg_temp.nl(p_lang text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('key', 'newsletter', 'text', public._newsletter_consent_default(p_lang),
                            'version', public._newsletter_consent_version(), 'given', true, 'lang', p_lang,
                            'received_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;
-- „Tak" z jawną chwilą (fikstura): flaga jak w `_email_measurement_grant`.
CREATE FUNCTION pg_temp.grant_raw(p_sid uuid, p_at timestamptz, p_form text DEFAULT 'measurement:reconfirm',
                                  p_version text DEFAULT 'email-measurement-2026-10-23',
                                  p_source public.crm_source_type DEFAULT 'newsletter', p_source_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('nes.email_measurement_grant', 'on', true);
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, lang, created_at)
  SELECT s.tenant_id, s.email, p_source, COALESCE(p_source_id, s.id), p_form, 'email_measurement', 'email_measurement',
         public._email_measurement_consent_default('pl'), p_version, true, 'pl', p_at
    FROM public.newsletter_subscribers s WHERE s.id = p_sid;
  PERFORM set_config('nes.email_measurement_grant', '', true);
END $$;
CREATE FUNCTION pg_temp.grant_at(p_sid uuid, p_at timestamptz) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.grant_raw(p_sid, p_at)
$$;
CREATE FUNCTION pg_temp.n_log(p_key text, p_consent_key text, p_given boolean DEFAULT NULL) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.crm_consent_log
   WHERE email = p_key || '@i9d-y2b.test' AND consent_key = p_consent_key AND (p_given IS NULL OR given = p_given)
$$;

-- ── 1. Treści, wersje, kanały ────────────────────────────────────────────────
SELECT ok(
  public._newsletter_consent_version() = 'newsletter-2026-10-23'
  AND public._email_measurement_consent_version() = 'email-measurement-2026-10-23'
  AND public._consent_measurement_versions() = ARRAY['email-measurement-2026-10-23']
  AND NOT (public._newsletter_consent_version() = ANY (public._consent_measurement_versions()))
  AND NOT ('newsletter-2026-10-21' = ANY (public._consent_measurement_versions())),
  'wersje: newsletter (b) i pomiar; rejestr wersji = wyłącznie treść pola pomiaru');
SELECT ok(
  public._newsletter_consent_default('pl') !~* 'mierz|pomiar|measur|akceptuj'
  AND public._newsletter_consent_default('en') !~* 'mierz|pomiar|measur|accept'
  AND public._newsletter_consent_default('pl') LIKE '%<a href="/polityka-prywatnosci">Polityka prywatności</a>%'
  AND public._newsletter_consent_default('en') LIKE '%<a href="/en/komunikacja-i-marketing#rezygnacja">%',
  'treść zgody na newsletter (b): bez pomiaru i bez akceptacji polityki, z linkami');
SELECT ok(
  public._email_measurement_consent_default('pl') LIKE '%<a href="/komunikacja-i-marketing#pomiar">szczegóły</a>).'
  AND public._email_measurement_consent_default('en') LIKE '%“Don''t measure my opens and clicks”%#pomiar">details</a>).'
  AND public._email_measurement_consent_default('pl') LIKE '%newsletter otrzymam także bez niej%'
  AND public._email_measurement_consent_default('xx') = public._email_measurement_consent_default('pl'),
  'treść pola pomiaru PL/EN: dobrowolność, potwierdzenie, link #pomiar; inny język = PL');
SELECT ok(
  public._email_measurement_grant_channels() = ARRAY['measurement:doi', 'measurement:signup', 'measurement:reconfirm']
  AND public._email_measurement_refusal_channels()
      = ARRAY['measurement:email_footer', 'measurement:preferences', 'measurement:account', 'measurement:doi_declined']
  AND (SELECT array_agg(form_id || '|' || consent_version) FROM public._email_measurement_legacy_grants())
      = ARRAY['newsletter:measurement_reconfirm|newsletter-2026-10-21'],
  'kanały udzielenia i własnej odmowy; jedna dawna zaufana para (potwierdzenie prośby (a))');

-- ── 2. Dane ustawień ─────────────────────────────────────────────────────────
INSERT INTO public.newsletter_settings (tenant_id, policy_html_pl, policy_html_en, popup_privacy_html_pl,
                                        popup_privacy_html_en) VALUES
  ('19db0000-0000-4000-8000-0000000000c0',
   'Zapisując się akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Możesz wypisać się w każdej chwili.',
   'By signing up, you agree to receive the newsletter and accept our <a href="/en/polityka-prywatnosci">Privacy Policy</a>. Our emails may contain elements that measure opens and clicks - they help us tailor the content and sending frequency and keep statistics. You can switch off this measurement separately, without unsubscribing, and withdraw your consent at any time (<a href="/en/komunikacja-i-marketing#rezygnacja">how to do it</a>).  ',
   ' Zapisując się, wyrażasz zgodę na otrzymywanie newslettera i akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Wiadomości mogą zawierać elementy mierzące otwarcia i kliknięcia - dzięki nim dopasowujemy treść i częstotliwość wysyłki oraz prowadzimy statystykę. Pomiar możesz wyłączyć osobno, bez rezygnacji z newslettera, a zgodę wycofać w każdej chwili (<a href="/komunikacja-i-marketing#rezygnacja">jak to zrobić</a>).',
   public._newsletter_consent_default('en')),
  ('19db0000-0000-4000-8000-0000000000d0',
   'Zapisując się, wyrażasz zgodę na otrzymywanie newslettera i akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Wiadomości mogą zawierać elementy mierzące otwarcia i kliknięcia - dzięki nim dopasowujemy treść i częstotliwość wysyłki oraz prowadzimy statystykę. Pomiar możesz wyłączyć osobno, bez rezygnacji z newslettera, a zgodę wycofać w każdej chwili (<a href="/komunikacja-i-marketing#rezygnacja">jak to zrobić</a>).',
   'My own consent text.', 'Akceptuję <a href="/regulamin">Regulamin</a>.', NULL),
  ('19db0000-0000-4000-8000-0000000000e0', NULL, '', '', NULL);
INSERT INTO r SELECT 'up1', to_jsonb(public._newsletter_consent_upgrade_defaults());
INSERT INTO r SELECT 'up2', to_jsonb(public._newsletter_consent_upgrade_defaults());
SELECT ok(
  (SELECT policy_html_pl = public._newsletter_consent_default('pl') AND policy_html_en = public._newsletter_consent_default('en')
     FROM public.newsletter_settings WHERE tenant_id = '19db0000-0000-4000-8000-0000000000c0')
  AND (SELECT policy_html_pl = public._newsletter_consent_default('pl') AND policy_html_en = 'My own consent text.'
         FROM public.newsletter_settings WHERE tenant_id = '19db0000-0000-4000-8000-0000000000d0'),
  'dawna treść domyślna i pakietowa (a) PL/EN (ze spacjami brzegowymi) -> treść (b); własny tekst zostaje');
SELECT ok(
  (SELECT popup_privacy_html_pl IS NULL AND popup_privacy_html_en IS NULL
     FROM public.newsletter_settings WHERE tenant_id = '19db0000-0000-4000-8000-0000000000c0')
  AND (SELECT popup_privacy_html_pl = 'Akceptuję <a href="/regulamin">Regulamin</a>.'
         FROM public.newsletter_settings WHERE tenant_id = '19db0000-0000-4000-8000-0000000000d0'),
  'wymagane pole prywatności popupu z kopią treści zgody (a) albo (b) -> NULL; własny tekst zostaje');
SELECT ok(
  (SELECT policy_html_pl IS NULL AND policy_html_en = '' AND popup_privacy_html_pl = ''
     FROM public.newsletter_settings WHERE tenant_id = '19db0000-0000-4000-8000-0000000000e0')
  AND (SELECT (v #>> '{}')::int = 5 FROM r WHERE k = 'up1')
  AND (SELECT (v #>> '{}')::int = 0 FROM r WHERE k = 'up2'),
  'NULL i pusty bez zmian; 5 zmienionych pól, powtórka = 0');
DELETE FROM public.newsletter_settings WHERE tenant_id = '19db0000-0000-4000-8000-0000000000e0';
INSERT INTO public.newsletter_settings (tenant_id) VALUES ('19db0000-0000-4000-8000-0000000000e0');
SELECT ok(
  (SELECT policy_html_pl = public._newsletter_consent_default('pl') AND policy_html_en = public._newsletter_consent_default('en')
     FROM public.newsletter_settings WHERE tenant_id = '19db0000-0000-4000-8000-0000000000e0')
  AND NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                   WHERE d.adrelid = 'public.newsletter_settings'::regclass
                     AND a.attname IN ('policy_html_pl', 'policy_html_en')
                     AND pg_get_expr(d.adbin, d.adrelid) LIKE '%_newsletter_consent_default%'),
  'nowy wiersz ustawień dostaje treść (b); DEFAULT to literał');

-- ── 3. Brak pakietowania ─────────────────────────────────────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents)
SELECT '19db0000-0000-4000-8000-0000000000a0', 'a1@i9d-y2b.test', 'subscribed', 'pl',
       jsonb_build_array(
         jsonb_build_object('key', 'newsletter', 'version', 'newsletter-2026-10-21', 'text',
           'Zapisując się, wyrażasz zgodę na otrzymywanie newslettera i akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Wiadomości mogą zawierać elementy mierzące otwarcia i kliknięcia - dzięki nim dopasowujemy treść i częstotliwość wysyłki oraz prowadzimy statystykę. Pomiar możesz wyłączyć osobno, bez rezygnacji z newslettera, a zgodę wycofać w każdej chwili (<a href="/komunikacja-i-marketing#rezygnacja">jak to zrobić</a>).'),
         jsonb_build_object('key', 'marketing', 'text', public._newsletter_consent_default('pl'),
                            'version', public._newsletter_consent_version()));
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_consent_log_measurement')
  AND to_regprocedure('public.tg_crm_consent_log_measurement()') IS NULL
  AND to_regprocedure('public._consent_covers_measurement(uuid, text, text, text)') IS NULL
  AND to_regprocedure('public.admin_newsletter_consent_measurement_get()') IS NULL
  AND to_regprocedure('public.admin_newsletter_consent_measurement_mark(text, boolean)') IS NULL,
  'pakietowanie usunięte: wyzwalacz, funkcja pokrycia, RPC oznaczeń admina');
SELECT ok(
  pg_temp.n_log('a1', 'newsletter') = 1 AND pg_temp.n_log('a1', 'marketing') = 1
  AND pg_temp.n_log('a1', 'email_measurement') = 0 AND NOT pg_temp.consent('a1'),
  'zgoda na newsletter w wersji (a) i (b) nie tworzy wpisu email_measurement - brak pomiaru');
SELECT ok(
  has_table_privilege('service_role', 'public.newsletter_consent_measurement_marks', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.newsletter_consent_measurement_marks', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.newsletter_consent_measurement_marks', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.newsletter_consent_measurement_marks', 'DELETE'),
  'tabela oznaczeń: archiwum tylko do odczytu');

-- ── 4. Strażnik rejestru i jedyny pisarz „tak" ───────────────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language)
VALUES ('19db0000-0000-4000-8000-0000000000a0', 'g1@i9d-y2b.test', 'subscribed', 'pl');
WITH ins AS (
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, consent_key, consent_text,
                                      consent_version, given)
  VALUES ('19db0000-0000-4000-8000-0000000000a0', 'g1@i9d-y2b.test', 'newsletter', pg_temp.sub('g1'),
          'measurement:doi', 'email_measurement', 'x', 'email-measurement-2026-10-23', true)
  RETURNING 1)
INSERT INTO r SELECT 'g_su', to_jsonb(count(*)) FROM ins;
SET LOCAL ROLE service_role;
WITH ins AS (
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, consent_key, consent_text,
                                      consent_version, given)
  VALUES ('19db0000-0000-4000-8000-0000000000a0', 'g1@i9d-y2b.test', 'newsletter',
          (SELECT s.id FROM public.newsletter_subscribers s WHERE s.email = 'g1@i9d-y2b.test'),
          'measurement:doi', 'email_measurement', 'x', 'email-measurement-2026-10-23', true)
  RETURNING 1)
INSERT INTO r SELECT 'g_svc', to_jsonb(count(*)) FROM ins;
RESET ROLE;
WITH ins AS (
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given)
  VALUES ('19db0000-0000-4000-8000-0000000000a0', 'g1@i9d-y2b.test', 'newsletter', 'email_measurement_declared', 'x', true),
         ('19db0000-0000-4000-8000-0000000000a0', 'g1@i9d-y2b.test', 'newsletter', ' Email_Measurement ', 'x', true),
         ('19db0000-0000-4000-8000-0000000000a0', 'g1@i9d-y2b.test', 'newsletter', 'Email_Measurement', 'x', false)
  RETURNING 1)
INSERT INTO r SELECT 'g_odd', to_jsonb(count(*)) FROM ins;
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given, created_at)
VALUES ('19db0000-0000-4000-8000-0000000000a0', 'g1@i9d-y2b.test', 'other', 'email_measurement', 'Nie mierz', false,
        now() - interval '1 hour');
SELECT ok(
  (SELECT v = '0'::jsonb FROM r WHERE k = 'g_su') AND (SELECT v = '0'::jsonb FROM r WHERE k = 'g_svc')
  AND NOT pg_temp.consent('g1'),
  'strażnik: „tak" email_measurement bez flagi pisarza - 0 wierszy (superuser i service_role)');
SELECT ok(
  (SELECT v = '0'::jsonb FROM r WHERE k = 'g_odd')
  AND pg_temp.n_log('g1', 'email_measurement', false) = 1
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email = 'g1@i9d-y2b.test'
                    AND lower(btrim(consent_key)) = 'email_measurement_declared'),
  'strażnik: deklaracja i inna pisownia klucza odrzucone; „nie" przechodzi');
SELECT throws_ok($$ SELECT public._email_measurement_grant(pg_temp.sub('g1'), 'account') $$,
  '22023', 'channel_invalid', 'pisarz „tak": kanał spoza listy udzielenia (account) - 22023');
SELECT throws_ok($$ SELECT public._email_measurement_grant(pg_temp.sub('g1'), 'x') $$,
  '22023', 'channel_invalid', 'pisarz „tak": nieznany kanał - 22023');
SELECT throws_ok(
  $$ UPDATE public.crm_consent_log SET given = true WHERE email = 'g1@i9d-y2b.test' AND consent_key = 'email_measurement' $$,
  '42501', 'email_measurement_log_immutable', 'UPDATE: „nie" pomiaru nie zamienia się w „tak" (42501)');
SELECT throws_ok(
  $$ UPDATE public.crm_consent_log SET created_at = now() - interval '1 year'
      WHERE email = 'g1@i9d-y2b.test' AND consent_key = 'email_measurement' $$,
  '42501', 'email_measurement_log_immutable', 'UPDATE: chwila wpisu pomiaru niezmienna (42501)');
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given)
VALUES ('19db0000-0000-4000-8000-0000000000a0', 'g1@i9d-y2b.test', 'newsletter', 'newsletter', 'Newsletter', true);
SELECT throws_ok(
  $$ UPDATE public.crm_consent_log SET consent_key = 'email_measurement'
      WHERE email = 'g1@i9d-y2b.test' AND consent_key = 'newsletter' $$,
  '42501', 'email_measurement_log_immutable', 'UPDATE: wpis innego klucza nie staje się wpisem pomiaru (42501)');
SELECT lives_ok(
  $$ UPDATE public.crm_consent_log SET email = 'anon-y2b@anonymized.invalid', consent_text = '[redacted]'
      WHERE email = 'g1@i9d-y2b.test' AND consent_key = 'email_measurement' $$,
  'UPDATE: pseudonimizacja adresu i opisu wpisu pomiaru przechodzi');

-- ── 5. Pisarze formularzy ────────────────────────────────────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents)
SELECT '19db0000-0000-4000-8000-0000000000a0', k || '@i9d-y2b.test', 'subscribed', 'pl', c
  FROM (VALUES ('f1', jsonb_build_array(pg_temp.nl('pl'), pg_temp.tick('pl'))),
               ('f2', jsonb_build_array(pg_temp.tick('pl'))),
               ('f3', '[]'::jsonb)) x(k, c);
UPDATE public.newsletter_subscribers
   SET consents = consents || jsonb_build_array(
         jsonb_build_object('key', 'email_measurement', 'text', public._email_measurement_consent_default('pl'),
                            'version', public._email_measurement_consent_version(), 'given', true,
                            'received_at', '2026-10-23T10:00:00.000Z'),
         jsonb_build_object('key', ' Email_Measurement ', 'text', 'Mierzcie mnie', 'given', true,
                            'received_at', '2026-10-23T10:00:01.000Z'),
         pg_temp.tick('pl', now() + interval '1 second'))
 WHERE email = 'f1@i9d-y2b.test';
SELECT ok(
  (SELECT count(*) = 1 FROM public.crm_consent_log WHERE email = 'f1@i9d-y2b.test' AND consent_key = 'newsletter'
     AND consent_version = 'newsletter-2026-10-23' AND consent_text = public._newsletter_consent_default('pl'))
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email = 'f1@i9d-y2b.test'
                    AND lower(btrim(consent_key)) IN ('email_measurement', 'email_measurement_declared'))
  AND NOT pg_temp.consent('f1') AND pg_temp.state('f1') = 'offer',
  'zapis i ponowny zapis (UPDATE consents) z deklaracją i spreparowanym kluczem pomiaru - zero wpisów pomiaru; deklaracja = oferta');
SELECT ok(
  pg_temp.n_log('f2', 'newsletter') = 0
  AND (SELECT count(*) = 1 FROM public.crm_consent_log WHERE email = 'f3@i9d-y2b.test' AND consent_key = 'newsletter'
         AND consent_text LIKE 'Zapisuję się do newslettera%'),
  'rezerwa newsletter_to_lead: sama deklaracja pomiaru nie daje zgody na newsletter; pusty consents - wpis zastępczy');
INSERT INTO public.contact_messages (tenant_id, name, email, message, consent, consents)
VALUES ('19db0000-0000-4000-8000-0000000000a0', 'Kontakt Y2b', 'c1@i9d-y2b.test', 'Treść', true,
        jsonb_build_array(
          jsonb_build_object('key', 'email_measurement', 'text', public._email_measurement_consent_default('pl'),
                             'version', public._email_measurement_consent_version(), 'given', true),
          pg_temp.tick('pl')));
SELECT ok(
  pg_temp.n_log('c1', 'rodo') = 1
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email = 'c1@i9d-y2b.test'
                    AND consent_key IN ('email_measurement', 'email_measurement_declared')),
  'wiadomość kontaktowa z pozycjami pomiaru: wpis RODO jest, wpisów pomiaru brak');

-- ── 6. `pending` i strona DOI ────────────────────────────────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents, confirmation_token)
SELECT '19db0000-0000-4000-8000-0000000000a0', k || '@i9d-y2b.test', 'pending', l,
       jsonb_build_array(pg_temp.nl(l), pg_temp.tick(l)), md5(k)
  FROM (VALUES ('p1', 'pl'), ('p2', 'en')) x(k, l);
SELECT ok(
  pg_temp.n_log('p1', 'newsletter') = 1 AND pg_temp.n_log('p1', 'email_measurement') = 0
  AND NOT pg_temp.consent('p1')
  AND (SELECT NOT s.measured FROM public.email_measurement_status('19db0000-0000-4000-8000-0000000000a0',
                                                                   ARRAY['p1@i9d-y2b.test']) s)
  AND public.email_measurement_state(pg_temp.sub('p1'), NULL) ->> 'consent' = 'false',
  'pending z deklaracją: w rejestrze tylko newsletter; czytelnik, porcja i stan - bez pomiaru');
SELECT is(pg_temp.doi_state('p1'), '{"result": "inactive", "lang": "pl"}'::jsonb,
  'strona DOI przed potwierdzeniem: inactive (+ język subskrybenta)');
UPDATE public.newsletter_subscribers SET status = 'subscribed', confirmed_at = now(), confirmation_expires_at = NULL
 WHERE email IN ('p1@i9d-y2b.test', 'p2@i9d-y2b.test');
SELECT ok(
  pg_temp.doi_state('p1') = '{"result": "offer", "lang": "pl"}'::jsonb
  AND pg_temp.doi_state('p2') = '{"result": "offer", "lang": "en"}'::jsonb
  AND NOT pg_temp.consent('p1'),
  'po potwierdzeniu DOI: oferta decyzji, ale bez pomiaru (GET nigdy nie udziela zgody)');

-- ── 7. Decyzja „tak" na stronie DOI ──────────────────────────────────────────
INSERT INTO r SELECT 'd1', pg_temp.doi_decide('p1', true, ' 198.51.100.7 ', 'Mozilla/5.0 Y2b');
SELECT ok(
  (SELECT v = '{"result": "granted", "lang": "pl"}'::jsonb FROM r WHERE k = 'd1')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log c
        WHERE c.email = 'p1@i9d-y2b.test' AND c.consent_key = 'email_measurement' AND c.given
          AND c.form_id = 'measurement:doi' AND c.source_type = 'newsletter' AND c.source_id = pg_temp.sub('p1')
          AND c.consent_text = public._email_measurement_consent_default('pl')
          AND c.consent_version = 'email-measurement-2026-10-23' AND c.ip = '198.51.100.7'
          AND c.user_agent = 'Mozilla/5.0 Y2b' AND c.lang = 'pl')
  AND pg_temp.consent('p1'),
  'DOI „Zgadzam się": wpis measurement:doi związany z subskrybentem (treść i wersja pomiaru, IP, UA) - pomiar');
SELECT ok(
  pg_temp.doi_decide('p1', true) = '{"result": "already", "lang": "pl"}'::jsonb
  AND pg_temp.doi_decide('p1', false) ->> 'result' = 'already'
  AND pg_temp.doi_state('p1') ->> 'result' = 'granted'
  AND pg_temp.n_log('p1', 'email_measurement') = 1,
  'DOI: powtórka (także zmiana zdania) - already bez drugiego wpisu; stan granted');

-- ── 8. Odmowa na stronie DOI ─────────────────────────────────────────────────
INSERT INTO r SELECT 'd2', pg_temp.doi_decide('p2', false, '198.51.100.8', 'UA');
SELECT ok(
  (SELECT v = '{"result": "declined", "lang": "en"}'::jsonb FROM r WHERE k = 'd2')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log c
        WHERE c.email = 'p2@i9d-y2b.test' AND c.consent_key = 'email_measurement' AND NOT c.given
          AND c.form_id = 'measurement:doi_declined' AND c.consent_version = 'email-measurement-2026-10-23'
          AND c.consent_text LIKE 'Consent to measuring opens and clicks declined%' AND c.lang = 'en')
  AND NOT pg_temp.consent('p2') AND pg_temp.state('p2') = 'declined',
  'DOI „Nie zgadzam się": wpis measurement:doi_declined (EN); stan declined, bez pomiaru');
SELECT ok(
  pg_temp.doi_decide('p2', true) ->> 'result' = 'already'
  AND NOT EXISTS (SELECT 1 FROM public._newsletter_measurement_candidates('19db0000-0000-4000-8000-0000000000a0') x
                   WHERE x.subscriber_id = pg_temp.sub('p2'))
  AND NOT pg_temp.consent('p2'),
  'odmowa na stronie DOI: decyzja zamknięta (already) i osoba nie jest kandydatem do prośby');

-- ── 9. Brak albo zła deklaracja, ładunek TS, wygaśnięcie ─────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents, confirmation_token)
SELECT '19db0000-0000-4000-8000-0000000000a0', k || '@i9d-y2b.test', 'subscribed', 'pl', c, md5(k)
  FROM (VALUES
    ('n1', jsonb_build_array(pg_temp.nl('pl'))),
    ('n2', jsonb_build_array(pg_temp.tick('pl') || '{"version": "newsletter-2026-10-21"}')),
    ('n3', jsonb_build_array(pg_temp.tick('pl') || '{"text": "Zgadzam się na wszystko."}')),
    ('n4', jsonb_build_array(pg_temp.tick('pl') || '{"given": false}')),
    ('n5', jsonb_build_array(pg_temp.tick('pl') || '{"key": "email_measurement"}')),
    ('e1', jsonb_build_array(pg_temp.tick('pl', now() - interval '61 days'))),
    ('e2', jsonb_build_array(pg_temp.tick('pl', now() - interval '59 days')))) x(k, c);
SELECT ok(
  pg_temp.state('n1') = 'none' AND pg_temp.state('n2') = 'none' AND pg_temp.state('n3') = 'none'
  AND pg_temp.state('n4') = 'none' AND pg_temp.state('n5') = 'none'
  AND pg_temp.doi_decide('n2', true) = '{"result": "none", "lang": "pl"}'::jsonb
  AND pg_temp.doi_decide('n3', true) ->> 'result' = 'none'
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email IN ('n2@i9d-y2b.test', 'n3@i9d-y2b.test')
                    AND consent_key = 'email_measurement'),
  'bez deklaracji, z wersją (a), obcą treścią, given:false albo kluczem zgody zamiast deklaracji: none, bez wpisu');
SELECT ok(
  public._newsletter_measurement_declared_at(jsonb_build_array('{"key":"email_measurement_declared","text":"Zgadzam się na pomiar otwarć i kliknięć w wiadomościach e-mail, które od Was otrzymuję (niewidoczny obrazek w treści i linki z moim identyfikatorem), aby dopasować treść i częstotliwość wysyłki oraz prowadzić statystykę. Zgoda jest dobrowolna - newsletter otrzymam także bez niej. Pomiar zacznie działać dopiero, gdy potwierdzę tę zgodę przyciskiem na stronie, do której prowadzi link z wiadomości wysłanej na mój adres. Mogę ją wycofać w każdej chwili, bez rezygnacji z newslettera, linkiem „Nie mierz moich otwarć i kliknięć” w stopce każdej wiadomości (<a href=\"/komunikacja-i-marketing#pomiar\">szczegóły</a>).","version":"email-measurement-2026-10-23","given":true,"lang":"pl","received_at":"2026-10-23T10:00:00.000Z"}'::jsonb))
    = '2026-10-23 10:00:00+00'::timestamptz
  AND public._newsletter_measurement_declared_at(jsonb_build_array(pg_temp.tick('en') || jsonb_build_object(
        'text', regexp_replace(public._email_measurement_consent_default('en'), '<[^>]*>', '', 'g'),
        'received_at', '2026-10-22T08:00:00Z'))) = '2026-10-22 08:00:00+00'::timestamptz
  AND public._newsletter_measurement_declared_at(jsonb_build_array(pg_temp.tick('pl') || '{"received_at": "2026-13-45T99:00:00Z"}'))
    = '-infinity'::timestamptz
  AND public._newsletter_measurement_declared_at('{"key": "x"}'::jsonb) IS NULL,
  'deklaracja: dosłowny ładunek measurementConsentPayload (HTML) i treść bez znaczników rozpoznane; zła chwila = -infinity');
SELECT ok(
  pg_temp.state('e1') = 'none' AND pg_temp.state('e2') = 'offer'
  AND pg_temp.doi_state('e1') ->> 'result' = 'offer'
  AND pg_temp.doi_decide('e1', true, p_expires => now() - interval '1 second') ->> 'result' = 'none'
  AND pg_temp.doi_decide('e1', true, p_expires => now() + interval '62 days') ->> 'result' = 'none'
  AND pg_temp.n_log('e1', 'email_measurement') = 0,
  'prośba po zapisie: 60 dni od deklaracji (61 - none, 59 - offer); strona DOI: termin z podpisu maila (minął albo dalszy niż 60 dni + dzień tolerancji - none)');

-- ── 10. Token ────────────────────────────────────────────────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents, confirmation_token)
SELECT '19db0000-0000-4000-8000-0000000000a0', k || '@i9d-y2b.test', 'subscribed', 'pl',
       jsonb_build_array(pg_temp.tick('pl')), md5(k)
  FROM (VALUES ('t1'), ('t2')) x(k);
SELECT public.email_unsubscribe_by_token((SELECT unsubscribe_token FROM public.newsletter_subscribers
                                           WHERE email = 't1@i9d-y2b.test'));
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE email = 't2@i9d-y2b.test';
SELECT ok(
  public.newsletter_doi_measurement_state(md5('nieznany'), pg_temp.sub('t1'), 't1@i9d-y2b.test',
                                         'email-measurement-2026-10-23', now() + interval '1 day') = '{"result": "invalid"}'::jsonb
  AND public.newsletter_doi_measurement_state('zly-token', NULL, NULL, NULL, NULL) = '{"result": "invalid"}'::jsonb
  AND public.newsletter_doi_measurement_state(NULL, NULL, NULL, NULL, NULL) = '{"result": "invalid"}'::jsonb
  AND public.newsletter_doi_measurement_decide('xyz', NULL, NULL, NULL, NULL, true) = '{"result": "invalid"}'::jsonb
  AND public.newsletter_doi_measurement_state(md5('t1'), pg_temp.sub('t1'), 't1@i9d-y2b.test',
                                              'email-measurement-2026-10-23', now() + interval '1 day') = '{"result": "invalid"}'::jsonb,
  'token nieznany, zły format, NULL i wyzerowany wypisem z linku - invalid');
SELECT ok(
  pg_temp.doi_state('t2') = '{"result": "inactive", "lang": "pl"}'::jsonb
  AND pg_temp.doi_decide('t2', true) ->> 'result' = 'inactive'
  AND pg_temp.n_log('t2', 'email_measurement') = 0,
  'wypis przez personel bez wyzerowania tokenu: inactive, bez wpisu');
SELECT throws_ok($$ SELECT pg_temp.doi_decide('p1', NULL) $$,
  '22023', 'decision_invalid', 'decyzja NULL - 22023');

-- ── 11. Czytelnik: wiersze (a), dawne potwierdzenie, związanie ───────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language)
SELECT '19db0000-0000-4000-8000-0000000000a0', k || '@i9d-y2b.test', 'subscribed', 'pl'
  FROM (VALUES ('l1'), ('l2'), ('l3'), ('b1'), ('b2'), ('o1'), ('o2'), ('w1'), ('u1'), ('u2'), ('u3'), ('r1')) x(k);
SELECT pg_temp.grant_raw(pg_temp.sub('l1'), now() - interval '1 day', 'newsletter-footer', 'newsletter-2026-10-21');
SELECT pg_temp.grant_raw(pg_temp.sub(k), now() - interval '1 day', 'newsletter:measurement_reconfirm', 'newsletter-2026-10-21')
  FROM (VALUES ('l2'), ('l3')) x(k);
INSERT INTO public.newsletter_measurement_requests (subscriber_id, consent_version, tenant_id, mailed_at, mail_outcome,
                                                    confirmed_at)
VALUES (pg_temp.sub('l2'), 'newsletter-2026-10-21', '19db0000-0000-4000-8000-0000000000a0', now() - interval '2 days',
        'queued', now() - interval '1 day');
SELECT ok(
  NOT pg_temp.consent('l1') AND pg_temp.consent('l2') AND NOT pg_temp.consent('l3')
  AND EXISTS (SELECT 1 FROM public._newsletter_measurement_candidates('19db0000-0000-4000-8000-0000000000a0') x
               WHERE x.subscriber_id = pg_temp.sub('l1')),
  'wiersz (a) z treści formularza - brak pomiaru i kandydat; dawne potwierdzenie prośby - pomiar tylko z potwierdzoną prośbą');
SELECT pg_temp.grant_raw(pg_temp.sub('b1'), now() - interval '1 day', p_source => 'contact_form');
SELECT pg_temp.grant_raw(pg_temp.sub('b2'), now() - interval '1 day', p_source_id => pg_temp.sub('l1'));
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm)
VALUES ('19db0000-0000-4000-8000-0000000030a1', '19db0000-0000-4000-8000-0000000000a0', 'k1@i9d-y2b.test', 'k1@i9d-y2b.test');
SELECT set_config('nes.email_measurement_grant', 'on', true);
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, consent_key, consent_text,
                                    consent_version, given, created_at)
VALUES ('19db0000-0000-4000-8000-0000000000a0', 'k1@i9d-y2b.test', 'other', '19db0000-0000-4000-8000-0000000030a1',
        'measurement:reconfirm', 'email_measurement', 'Zgoda', 'email-measurement-2026-10-23', true, now() - interval '1 day');
SELECT set_config('nes.email_measurement_grant', '', true);
SELECT ok(
  NOT pg_temp.consent('b1') AND NOT pg_temp.consent('b2')
  AND NOT public._email_measurement_consent('19db0000-0000-4000-8000-0000000000a0', 'k1@i9d-y2b.test')
  AND pg_temp.n_log('k1', 'email_measurement', true) = 1,
  'brak związania: źródło formularza, cudzy subskrybent, kontakt CRM bez subskrypcji - brak pomiaru');

-- Wycofanie zgody newsletter po udzieleniu; remis chwil.
SELECT pg_temp.grant_at(pg_temp.sub('o1'), now() - interval '1 day');
SELECT pg_temp.grant_at(pg_temp.sub('o2'), now() - interval '1 hour');
INSERT INTO r SELECT 'o1_before', to_jsonb(pg_temp.consent('o1'));
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given, created_at)
VALUES ('19db0000-0000-4000-8000-0000000000a0', 'o1@i9d-y2b.test', 'other', 'newsletter', 'Wypis', false, now()),
       ('19db0000-0000-4000-8000-0000000000a0', 'o2@i9d-y2b.test', 'other', 'email_measurement', 'Nie', false,
        now() - interval '1 hour');
SELECT ok(
  (SELECT v = 'true'::jsonb FROM r WHERE k = 'o1_before') AND NOT pg_temp.consent('o1') AND NOT pg_temp.consent('o2'),
  'wycofanie zgody newsletter po udzieleniu - brak pomiaru; remis chwil „tak" i „nie" - brak pomiaru');

-- ── 12. Wycofanie z zewnątrz i wypis ─────────────────────────────────────────
SELECT pg_temp.grant_at(pg_temp.sub(k), now() - interval '1 day') FROM (VALUES ('w1'), ('u1'), ('u2'), ('u3')) x(k);
INSERT INTO r SELECT 'w1', public.email_measurement_withdraw(pg_temp.sub('w1'), NULL, 'unsubscribe');
SELECT ok(
  (SELECT v ->> 'result' = 'withdrawn' FROM r WHERE k = 'w1')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log
        WHERE email = 'w1@i9d-y2b.test' AND consent_key = 'email_measurement' AND NOT given
          AND form_id = 'measurement:email_footer' AND consent_version = 'email-measurement-2026-10-23'
          AND created_at >= now())
  AND NOT EXISTS (SELECT 1 FROM public._newsletter_measurement_candidates('19db0000-0000-4000-8000-0000000000a0') x
                   WHERE x.subscriber_id = pg_temp.sub('w1')),
  'wycofanie z kanałem unsubscribe podanym z zewnątrz = email_footer (wersja pomiaru, chwila zapisu); odmowa wyklucza z próśb');

INSERT INTO r SELECT 'u1_before', to_jsonb(pg_temp.consent('u1'));
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE email = 'u1@i9d-y2b.test';
SELECT ok(
  (SELECT v = 'true'::jsonb FROM r WHERE k = 'u1_before') AND NOT pg_temp.consent('u1')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log
        WHERE email = 'u1@i9d-y2b.test' AND consent_key = 'email_measurement' AND NOT given
          AND form_id = 'measurement:unsubscribe' AND source_id = pg_temp.sub('u1')
          AND consent_version = 'email-measurement-2026-10-23'
          AND consent_text LIKE 'Wygaśnięcie zgody na pomiar otwarć i kliknięć - koniec subskrypcji newslettera%'),
  'wypis: wpis „nie" measurement:unsubscribe (wersja pomiaru, treść neutralna) - brak pomiaru');
UPDATE public.newsletter_subscribers SET status = 'subscribed', unsubscribed_at = NULL WHERE email = 'u1@i9d-y2b.test';
SELECT ok(
  NOT pg_temp.consent('u1')
  AND EXISTS (SELECT 1 FROM public._newsletter_measurement_candidates('19db0000-0000-4000-8000-0000000000a0') x
               WHERE x.subscriber_id = pg_temp.sub('u1')),
  '„Przywróć" (subscribed, unsubscribed_at NULL) nie wskrzesza zgody; wypis nie wyklucza z próśb');
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE email = 'u1@i9d-y2b.test';
SELECT is(pg_temp.n_log('u1', 'email_measurement', false), 1, 'drugi wypis bez nowego „tak" - bez drugiego „nie"');
SELECT public.email_record_suppression('19db0000-0000-4000-8000-0000000000a0', 'u2@i9d-y2b.test', 'hard_bounce');
SELECT public.email_record_suppression('19db0000-0000-4000-8000-0000000000a0', 'U3@i9d-y2b.test', 'complaint');
SELECT ok(
  (SELECT bool_and(status = 'unsubscribed') FROM public.newsletter_subscribers
    WHERE email IN ('u2@i9d-y2b.test', 'u3@i9d-y2b.test'))
  AND (SELECT count(*) = 2 FROM public.crm_consent_log
        WHERE email IN ('u2@i9d-y2b.test', 'u3@i9d-y2b.test') AND consent_key = 'email_measurement' AND NOT given
          AND form_id = 'measurement:unsubscribe')
  AND NOT pg_temp.consent('u2') AND NOT pg_temp.consent('u3'),
  'odbicie twarde i skarga (lista wyłączeń -> wypis): wpis „nie" measurement:unsubscribe');

-- Ponowny zapis przez osobę trzecią: wypisany -> pending z deklaracją -> DOI.
SELECT pg_temp.grant_at(pg_temp.sub('r1'), now() - interval '2 days');
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() - interval '1 day'
 WHERE email = 'r1@i9d-y2b.test';
INSERT INTO r SELECT 'r1_old', to_jsonb(pg_temp.state('r1'));
UPDATE public.newsletter_subscribers SET status = 'pending', confirmation_token = md5('r1'),
       consents = consents || jsonb_build_array(pg_temp.tick('pl', clock_timestamp() + interval '1 second'))
 WHERE email = 'r1@i9d-y2b.test';
UPDATE public.newsletter_subscribers SET status = 'subscribed', confirmed_at = now() WHERE email = 'r1@i9d-y2b.test';
SELECT ok(
  (SELECT v = '"inactive"'::jsonb FROM r WHERE k = 'r1_old')
  AND NOT pg_temp.consent('r1') AND pg_temp.n_log('r1', 'email_measurement', true) = 1
  -- Mail DOI ponownego zapisu wyszedł PO wypisie (sekret wydany teraz).
  AND pg_temp.doi_state('r1', clock_timestamp() + interval '60 days') ->> 'result' = 'offer',
  'ponowny zapis wypisanego przez osobę trzecią: stara zgoda nie wraca, decyzja czeka na właściciela (offer)');

-- ── 13. Prośba po zapisie bez DOI, porcja, potwierdzenie ─────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents, created_at)
SELECT '19db0000-0000-4000-8000-0000000000b0', k || '@i9d-y2b.test', 'subscribed', l, c, now() - make_interval(days => n)
  FROM (VALUES ('bs1', 'en', jsonb_build_array(pg_temp.nl('en'), pg_temp.tick('en')), 9),
               ('bs2', 'pl', jsonb_build_array(pg_temp.nl('pl')), 8),
               ('bq1', 'pl', '[]'::jsonb, 7), ('bq2', 'pl', '[]'::jsonb, 6), ('bq3', 'pl', '[]'::jsonb, 5),
               ('bu4', 'pl', '[]'::jsonb, 4), ('bp5', 'pl', '[]'::jsonb, 3), ('bg6', 'pl', '[]'::jsonb, 2)) x(k, l, c, n);
SELECT pg_temp.grant_at(pg_temp.sub('bg6'), now() - interval '1 day');
-- Najemca B: 200 próśb wygaszania w ostatniej dobie - budżet panelu wyczerpany.
INSERT INTO public.newsletter_subscribers (tenant_id, email, status)
SELECT '19db0000-0000-4000-8000-0000000000b0', 'bz' || g || '@i9d-y2b.test', 'unsubscribed' FROM generate_series(1, 200) g;
INSERT INTO public.newsletter_sunset_requests (subscriber_id, tenant_id, mailed_at, mail_outcome)
SELECT s.id, s.tenant_id, now() - interval '1 hour', 'queued' FROM public.newsletter_subscribers s
 WHERE s.tenant_id = '19db0000-0000-4000-8000-0000000000b0' AND s.email LIKE 'bz%';
-- Prośby (a): wysłana (bq1), niewysłana (bq2), potwierdzona (bq3).
INSERT INTO public.newsletter_measurement_requests (subscriber_id, consent_version, tenant_id, mailed_at, mail_outcome,
                                                    confirmed_at)
VALUES (pg_temp.sub('bq1'), 'newsletter-2026-10-21', '19db0000-0000-4000-8000-0000000000b0', now() - interval '3 days', 'queued', NULL),
       (pg_temp.sub('bq2'), 'newsletter-2026-10-21', '19db0000-0000-4000-8000-0000000000b0', NULL, NULL, NULL),
       (pg_temp.sub('bq3'), 'newsletter-2026-10-21', '19db0000-0000-4000-8000-0000000000b0', now() - interval '3 days', 'queued',
        now() - interval '2 days');
INSERT INTO r SELECT 'qa1', to_jsonb(public._newsletter_measurement_requests_upgrade());
INSERT INTO r SELECT 'qa2', to_jsonb(public._newsletter_measurement_requests_upgrade());
SELECT ok(
  (SELECT v = '1'::jsonb FROM r WHERE k = 'qa1') AND (SELECT v = '0'::jsonb FROM r WHERE k = 'qa2')
  AND (SELECT consent_version = 'email-measurement-2026-10-23' AND origin = 'panel'
         FROM public.newsletter_measurement_requests WHERE subscriber_id = pg_temp.sub('bq2'))
  AND (SELECT array_agg(consent_version ORDER BY subscriber_id) = ARRAY['newsletter-2026-10-21', 'newsletter-2026-10-21']
         FROM public.newsletter_measurement_requests WHERE subscriber_id IN (pg_temp.sub('bq1'), pg_temp.sub('bq3'))),
  'kolejka (a): niewysłana prośba -> wersja pomiaru; wysłana i potwierdzona zostają; powtórka = 0');

INSERT INTO r SELECT 'rs1', public.newsletter_measurement_request_signup(pg_temp.sub('bs1'));
SELECT ok(
  (SELECT v = '{"result": "requested"}'::jsonb FROM r WHERE k = 'rs1')
  AND (SELECT origin = 'signup' AND consent_version = 'email-measurement-2026-10-23' AND requested_by IS NULL
              AND tenant_id = '19db0000-0000-4000-8000-0000000000b0'
         FROM public.newsletter_measurement_requests WHERE subscriber_id = pg_temp.sub('bs1')),
  'zapis bez DOI z deklaracją: prośba origin signup w wersji pomiaru, bez autora');
SELECT ok(
  public.newsletter_measurement_request_signup(pg_temp.sub('bs1')) = '{"result": "exists"}'::jsonb
  AND public.newsletter_measurement_request_signup(pg_temp.sub('bs2')) = '{"result": "none"}'::jsonb
  AND public.newsletter_measurement_request_signup(pg_temp.sub('p2')) = '{"result": "declined"}'::jsonb
  AND public.newsletter_measurement_request_signup(pg_temp.sub('t2')) = '{"result": "inactive"}'::jsonb
  AND public.newsletter_measurement_request_signup(gen_random_uuid()) = '{"result": "gone"}'::jsonb
  AND public.newsletter_measurement_request_signup(NULL) = '{"result": "invalid"}'::jsonb,
  'prośba po zapisie: powtórka exists; bez deklaracji none; po odmowie declined; wypisany inactive; nieznany gone');

-- Panel najemcy B (admin z sesji).
SELECT pg_temp.as_user('19db0000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'pv0', public.admin_newsletter_measurement_preview();
INSERT INTO r SELECT 'st', public.admin_newsletter_measurement_request(3);
INSERT INTO r SELECT 'pv1', public.admin_newsletter_measurement_preview();
-- Panel: wypis subskrybentów przez personel (UPDATE w roli klienta, RLS).
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now()
 WHERE email IN ('bu4@i9d-y2b.test', 'bg6@i9d-y2b.test');
RESET ROLE;
SELECT ok(
  (SELECT count(*) = 1 FROM public.crm_consent_log
    WHERE email = 'bg6@i9d-y2b.test' AND consent_key = 'email_measurement' AND NOT given
      AND form_id = 'measurement:unsubscribe')
  AND pg_temp.n_log('bu4', 'email_measurement') = 0 AND NOT pg_temp.consent('bg6'),
  'wypis przez personel w panelu (rola klienta): „nie" measurement:unsubscribe tylko tam, gdzie ostatnie słowo brzmiało „tak"');
SELECT ok(
  (SELECT v ->> 'version' = 'email-measurement-2026-10-23' AND (v ->> 'candidates')::int = 3
          AND (v ->> 'requested')::int = 1 AND (v ->> 'pending')::int = 1 FROM r WHERE k = 'pv0')
  AND (SELECT v = '{"requested": 3, "version": "email-measurement-2026-10-23"}'::jsonb FROM r WHERE k = 'st')
  AND (SELECT (v ->> 'requested')::int = 4 AND (v ->> 'candidates')::int = 0 FROM r WHERE k = 'pv1')
  AND (SELECT array_agg(split_part(s.email, '@', 1) ORDER BY s.email) = ARRAY['bp5', 'bs2', 'bu4']
         FROM public.newsletter_measurement_requests q JOIN public.newsletter_subscribers s ON s.id = q.subscriber_id
        WHERE q.origin = 'panel' AND q.requested_by = '19db0000-0000-4000-8000-00000000a001'),
  'panel: wersja pomiaru; kandydaci bez maila prośby (a) i bez prośby z zapisu; liczniki tylko próśb panelu');

CREATE TEMP TABLE claimed_signup ON COMMIT DROP AS SELECT * FROM public.newsletter_measurement_claim(50, 'signup');
CREATE TEMP TABLE claimed_all ON COMMIT DROP AS SELECT * FROM public.newsletter_measurement_claim(50);
SELECT ok(
  (SELECT jsonb_agg(jsonb_build_object('who', split_part(c.email, '@', 1), 'origin', c.origin, 'lang', c.lang,
                                       'version', c.consent_version))
     FROM claimed_signup c WHERE c.tenant_id = '19db0000-0000-4000-8000-0000000000b0')
    = '[{"who": "bs1", "lang": "en", "origin": "signup", "version": "email-measurement-2026-10-23"}]'::jsonb
  AND NOT EXISTS (SELECT 1 FROM claimed_signup WHERE origin <> 'signup')
  AND NOT EXISTS (SELECT 1 FROM claimed_all c WHERE c.tenant_id = '19db0000-0000-4000-8000-0000000000b0'),
  'porcja signup: tylko prośby po zapisie, z pochodzeniem; budżet panelu (200 wygaszania) nie blokuje próśb po zapisie');
SELECT ok(
  public._newsletter_measurement_signup_mail_used('19db0000-0000-4000-8000-0000000000b0') = 1
  AND public._newsletter_oneoff_mail_used('19db0000-0000-4000-8000-0000000000b0') = 200
  AND to_regprocedure('public.newsletter_measurement_claim(integer)') IS NULL,
  'budżety: prośby po zapisie liczone osobno (dzierżawa = 1), wspólny budżet panelu bez próśb po zapisie');
SELECT throws_ok($$ SELECT * FROM public.newsletter_measurement_claim(10, 'inne') $$,
  '22023', 'origin_invalid', 'porcja: pochodzenie spoza listy - 22023');

INSERT INTO r SELECT 'c_bs1', public.newsletter_measurement_confirm(pg_temp.sub('bs1'),
  (SELECT nonce FROM claimed_signup WHERE email = 'bs1@i9d-y2b.test'), '203.0.113.9', 'UA signup');
INSERT INTO r SELECT 'n_nl_bs2', to_jsonb(pg_temp.n_log('bs2', 'newsletter'));
-- Prośba z panelu bs2 nie weszła do porcji (budżet panelu wyczerpany):
-- fikstura udaje wysłany mail - adres wysyłki zapisany jak przy zajęciu.
UPDATE public.newsletter_measurement_requests SET email_norm = 'bs2@i9d-y2b.test'
 WHERE subscriber_id = pg_temp.sub('bs2');
INSERT INTO r SELECT 'c_bs2', public.newsletter_measurement_confirm(pg_temp.sub('bs2'),
  (SELECT nonce FROM public.newsletter_measurement_requests WHERE subscriber_id = pg_temp.sub('bs2')));
SELECT ok(
  (SELECT v ->> 'result' = 'confirmed' AND v ->> 'lang' = 'en' FROM r WHERE k = 'c_bs1')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log
        WHERE email = 'bs1@i9d-y2b.test' AND consent_key = 'email_measurement' AND given
          AND form_id = 'measurement:signup' AND consent_text = public._email_measurement_consent_default('en')
          AND ip = '203.0.113.9' AND lang = 'en')
  AND pg_temp.consent('bs1') AND pg_temp.n_log('bs1', 'newsletter') = 1,
  'potwierdzenie prośby po zapisie: wpis measurement:signup (treść EN pomiaru, IP), bez wpisu newsletter');
SELECT ok(
  (SELECT v ->> 'result' = 'confirmed' FROM r WHERE k = 'c_bs2')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log
        WHERE email = 'bs2@i9d-y2b.test' AND consent_key = 'email_measurement' AND given
          AND form_id = 'measurement:reconfirm' AND consent_version = 'email-measurement-2026-10-23')
  AND pg_temp.n_log('bs2', 'newsletter') = (SELECT (v #>> '{}')::int FROM r WHERE k = 'n_nl_bs2')
  AND pg_temp.consent('bs2')
  AND public.newsletter_measurement_confirm(pg_temp.sub('bs2'),
        (SELECT nonce FROM public.newsletter_measurement_requests WHERE subscriber_id = pg_temp.sub('bs2'))) ->> 'result' = 'already',
  'potwierdzenie prośby z panelu: email_measurement measurement:reconfirm bez wpisu newsletter; link jednorazowy');
SELECT is(
  public.newsletter_measurement_confirm(pg_temp.sub('bu4'),
    (SELECT nonce FROM public.newsletter_measurement_requests WHERE subscriber_id = pg_temp.sub('bu4'))) ->> 'result',
  'inactive', 'potwierdzenie po wypisie przez personel - inactive (bez zgody)');

-- ── 14. Retencja: łańcuch pomiaru usuwany po okresie dowodowym ───────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language)
VALUES ('19db0000-0000-4000-8000-0000000000e0', 'ret1@i9d-y2b.test', 'subscribed', 'pl');
SELECT pg_temp.grant_at(pg_temp.sub('ret1'), now() - interval '7 years');
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given, created_at)
VALUES ('19db0000-0000-4000-8000-0000000000e0', 'ret1@i9d-y2b.test', 'newsletter', 'email_measurement', 'Nie', false,
        now() - interval '7 years' + interval '1 day');
SELECT public._data_retention_consent_log('19db0000-0000-4000-8000-0000000000e0', true, 1000);
SELECT ok(
  pg_temp.n_log('ret1', 'email_measurement') = 0 AND pg_temp.n_log('ret1', 'newsletter') = 1,
  'retencja: łańcuch pomiaru z ostatnim „nie" starszym niż okres dowodowy usunięty (DELETE przechodzi)');

-- ── 15. ACL ──────────────────────────────────────────────────────────────────
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text || ' -> ' || r
       FROM pg_proc p CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
      WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege(r, p.oid, 'EXECUTE')
        AND p.proname = ANY (ARRAY[
          '_email_measurement_consent_default', '_email_measurement_consent_version',
          '_email_measurement_grant_channels', '_email_measurement_refusal_channels',
          '_email_measurement_legacy_grants', '_email_measurement_grant', '_email_measurement_close_on_unsubscribe',
          '_email_measurement_consent', '_consent_measurement_versions', '_newsletter_consent_default',
          '_newsletter_consent_version', '_newsletter_consent_upgrade_defaults', '_newsletter_log_consents',
          '_newsletter_measurement_declared_at', '_newsletter_measurement_offer_state',
          '_newsletter_measurement_signup_mail_used', '_newsletter_oneoff_mail_used',
          '_newsletter_measurement_candidates', '_newsletter_measurement_requests_upgrade',
          'tg_crm_consent_log_measurement_guard', 'tg_newsletter_unsubscribed_measurement', 'newsletter_to_lead']::name[]) $$,
  'ACL: funkcje wewnętrzne i wyzwalacze bez EXECUTE dla anon, authenticated i service_role');
SELECT ok(
  has_function_privilege('service_role', 'public.newsletter_doi_measurement_state(text, uuid, text, text, timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role',
        'public.newsletter_doi_measurement_decide(text, uuid, text, text, timestamptz, boolean, text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.newsletter_measurement_request_signup(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.newsletter_measurement_claim(integer, text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) r
     CROSS JOIN unnest(ARRAY['public.newsletter_doi_measurement_state(text, uuid, text, text, timestamptz)',
                             'public.newsletter_doi_measurement_decide(text, uuid, text, text, timestamptz, boolean, text, text)',
                             'public.newsletter_measurement_request_signup(uuid)',
                             'public.newsletter_measurement_claim(integer, text)',
                             'public.newsletter_measurement_confirm(uuid, uuid, text, text)',
                             'public.email_measurement_withdraw(uuid, uuid, text, text, text)']) f
     WHERE has_function_privilege(r, f, 'EXECUTE')),
  'ACL: strona DOI, prośba po zapisie, porcja, potwierdzenie i wycofanie - wyłącznie service_role');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_consent_log_measurement_guard'
            AND tgrelid = 'public.crm_consent_log'::regclass AND NOT tgisinternal)
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_consent_log_measurement_lock'
                AND tgrelid = 'public.crm_consent_log'::regclass AND NOT tgisinternal)
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_newsletter_unsubscribed_measurement'
                AND tgrelid = 'public.newsletter_subscribers'::regclass AND NOT tgisinternal)
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'newsletter_measurement_requests_origin_check'),
  'wyzwalacze strażnika (INSERT, UPDATE) i wypisu; CHECK pochodzenia prośby');

SELECT * FROM finish();
ROLLBACK;
