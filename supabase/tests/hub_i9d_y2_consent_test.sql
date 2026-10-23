-- pgTAP: treść zgody na newsletter, wersja treści przy każdej zgodzie, klucz
-- `email_measurement` (I9d-Y2; migracja 20261020162300) - od I9d-Y2b
-- (20261023090000, decyzje właściciela 2026-10-23: D1 wariant (b), D2) zgoda
-- na pomiar jest OSOBNYM polem, a pomiar działa tylko dla skrzynki
-- potwierdzonej przez właściciela.
--
-- CO PRZYPINA:
--   * treść domyślna PL/EN (b): zgoda na newsletter BEZ pomiaru i bez
--     akceptacji polityki, wycofanie z linkiem, istniejąca trasa EN (bez
--     `/privacy-policy`); DEFAULT kolumn = literał bieżącej treści;
--     aktualizacja TYLKO tekstu równego dawnemu domyślnemu (tekst admina,
--     NULL i pusty - bez zmian; powtórka = 0);
--   * wersja przy KAŻDEJ zgodzie newslettera (z ładunku albo skrót treści),
--     także tekst zastępczy; ponowny zapis (UPDATE `consents`) loguje tylko
--     NOWE pozycje;
--   * brak pakietowania: zgoda na newsletter w wersji (a) i (b), dwa klucze
--     marketingowe, zgoda z wydarzenia - żadnego wpisu `email_measurement`;
--     zgodę zapisuje wyłącznie `_email_measurement_grant`;
--   * czytelnik zgody: wycofanie pomiaru, wycofanie zgody marketingowej
--     i wypis PO udzieleniu = brak pomiaru; ponowny zapis po wypisie (także
--     z treścią (a) i deklaracją pola pomiaru) - brak pomiaru; kontakt CRM
--     bez subskrypcji - brak;
--   * wycofanie SAMEGO pomiaru (subskrybent, kontakt CRM): wpis „nie" z wersją
--     treści pomiaru, zgoda na newsletter i status bez zmian, powtórka
--     `already`;
--   * porcja dla runnerów: zgoda vs wspólny przełącznik najemcy, limit,
--     najemca wymagany; ACL funkcji, archiwum oznaczeń tylko do odczytu.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_y2_consent
BEGIN;
SELECT plan(33);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('19d60000-0000-4000-8000-0000000000a0', 'i9d-y2-zgoda-a', 'I9d Y2 Zgoda A'),
  ('19d60000-0000-4000-8000-0000000000b0', 'i9d-y2-zgoda-b', 'I9d Y2 Zgoda B'),
  ('19d60000-0000-4000-8000-0000000000c0', 'i9d-y2-zgoda-c', 'I9d Y2 Zgoda C'),
  ('19d60000-0000-4000-8000-0000000000d0', 'i9d-y2-zgoda-d', 'I9d Y2 Zgoda D');

-- A: oba stare domyślne (B: tekst admina PL + EN NULL; C: pusty).
INSERT INTO public.newsletter_settings (tenant_id, policy_html_pl, policy_html_en) VALUES
  ('19d60000-0000-4000-8000-0000000000a0',
   'Zapisując się akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Możesz wypisać się w każdej chwili.',
   '  By signing up, you agree to our <a href="/privacy-policy">Privacy Policy</a>. You may unsubscribe at any time. '),
  ('19d60000-0000-4000-8000-0000000000b0', 'Mój własny tekst zgody: mierzymy otwarcia i kliknięcia.', NULL),
  ('19d60000-0000-4000-8000-0000000000c0', '', '');

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
CREATE FUNCTION pg_temp.consent(p_tenant text, p_email text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public._email_measurement_consent(p_tenant::uuid, p_email)
$$;
CREATE FUNCTION pg_temp.sub(p_email text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM public.newsletter_subscribers s WHERE s.email = p_email
$$;
-- „Tak" pomiaru z jawną chwilą i źródłem (fikstura; flaga jak w jedynym
-- pisarzu `_email_measurement_grant` - bez niej strażnik rejestru odrzuca).
CREATE FUNCTION pg_temp.grant_raw(p_tenant text, p_email text, p_source public.crm_source_type, p_source_id uuid,
                                  p_at timestamptz) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('nes.email_measurement_grant', 'on', true);
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, consent_key, consent_text,
                                      consent_version, given, created_at)
  VALUES (p_tenant::uuid, p_email, p_source, p_source_id, 'measurement:reconfirm', 'email_measurement',
          public._email_measurement_consent_default('pl'), public._email_measurement_consent_version(), true, p_at);
  PERFORM set_config('nes.email_measurement_grant', '', true);
END $$;

-- ── 1. Treść domyślna i aktualizacja tylko starego domyślnego ───────────────
INSERT INTO r SELECT 'up1', to_jsonb(public._newsletter_consent_upgrade_defaults());
INSERT INTO r SELECT 'up2', to_jsonb(public._newsletter_consent_upgrade_defaults());

SELECT ok(
  public._newsletter_consent_default('pl') LIKE 'Zapisując się, wyrażasz zgodę na otrzymywanie newslettera.%'
  AND public._newsletter_consent_default('pl') LIKE '%Zasady przetwarzania danych opisuje <a href="/polityka-prywatnosci">Polityka prywatności</a>.%'
  AND public._newsletter_consent_default('pl') LIKE '%wycofać w każdej chwili (<a href="/komunikacja-i-marketing#rezygnacja">%'
  AND public._newsletter_consent_default('pl') !~* 'mierz|pomiar|akceptuj',
  'treść PL (b): zgoda na newsletter, polityka jako informacja, wycofanie z linkiem; bez pomiaru i bez „akceptujesz"');
SELECT ok(
  public._newsletter_consent_default('en') LIKE 'By signing up, you agree to receive the newsletter.%'
  AND public._newsletter_consent_default('en') LIKE '%<a href="/en/polityka-prywatnosci">%'
  AND public._newsletter_consent_default('en') LIKE '%<a href="/en/komunikacja-i-marketing#rezygnacja">%'
  AND public._newsletter_consent_default('en') NOT LIKE '%/privacy-policy%'
  AND public._newsletter_consent_default('en') !~* 'measur|accept'
  AND public._newsletter_consent_default('xx') = public._newsletter_consent_default('pl'),
  'treść EN (b): te same elementy, istniejące trasy EN (bez /privacy-policy), bez pomiaru; inny język = PL');
SELECT ok(
  public._newsletter_consent_version() = 'newsletter-2026-10-23'
  AND char_length(public._newsletter_consent_version()) <= 32
  AND NOT (public._newsletter_consent_version() = ANY (public._consent_measurement_versions())),
  'wersja treści (b) mieści się w limicie ładunku (32) i NIE jest wersją treści pomiaru');
SELECT ok(
  (SELECT policy_html_pl = public._newsletter_consent_default('pl') AND policy_html_en = public._newsletter_consent_default('en')
     FROM public.newsletter_settings WHERE tenant_id = '19d60000-0000-4000-8000-0000000000a0')
  AND (SELECT (v #>> '{}')::int >= 2 FROM r WHERE k = 'up1'),
  'stary domyślny PL i EN (także ze spacjami brzegowymi) -> bieżąca treść domyślna');
SELECT ok(
  (SELECT policy_html_pl = 'Mój własny tekst zgody: mierzymy otwarcia i kliknięcia.' AND policy_html_en IS NULL
     FROM public.newsletter_settings WHERE tenant_id = '19d60000-0000-4000-8000-0000000000b0')
  AND (SELECT policy_html_pl = '' AND policy_html_en = ''
         FROM public.newsletter_settings WHERE tenant_id = '19d60000-0000-4000-8000-0000000000c0')
  AND (SELECT (v #>> '{}')::int = 0 FROM r WHERE k = 'up2'),
  'tekst admina, NULL i pusty bez zmian; powtórka aktualizacji = 0 wierszy');
INSERT INTO public.newsletter_settings (tenant_id) VALUES ('19d60000-0000-4000-8000-0000000000d0');
SELECT ok(
  (SELECT policy_html_pl = public._newsletter_consent_default('pl') AND policy_html_en = public._newsletter_consent_default('en')
     FROM public.newsletter_settings WHERE tenant_id = '19d60000-0000-4000-8000-0000000000d0')
  AND NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                   WHERE d.adrelid = 'public.newsletter_settings'::regclass
                     AND a.attname IN ('policy_html_pl', 'policy_html_en')
                     AND pg_get_expr(d.adbin, d.adrelid) LIKE '%_newsletter_consent_default%'),
  'nowy wiersz ustawień dostaje bieżącą treść; DEFAULT to literał (zapis przez rolę klienta bez EXECUTE)');

-- ── 2. Wersja przy każdej zgodzie newslettera ────────────────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents) VALUES
  ('19d60000-0000-4000-8000-0000000000a0', 'bez-wersji@i9d-y2.test', 'subscribed', 'pl',
   '[{"key":"newsletter","text":"Chcę dostawać newsletter.","given":true}]'),
  ('19d60000-0000-4000-8000-0000000000a0', 'z-wersja@i9d-y2.test', 'subscribed', 'pl',
   '[{"key":"newsletter","text":"Chcę dostawać newsletter.","version":"sha256:abc","given":true}]'),
  ('19d60000-0000-4000-8000-0000000000a0', 'pusto@i9d-y2.test', 'subscribed', 'pl', '[]');
SELECT is(
  (SELECT consent_version FROM public.crm_consent_log WHERE email = 'bez-wersji@i9d-y2.test' AND consent_key = 'newsletter'),
  'txt-sha256:' || left(encode(sha256(convert_to('Chcę dostawać newsletter.', 'UTF8')), 'hex'), 20),
  'wpis bez wersji w ładunku dostaje skrót treści (txt-sha256 + 20 hex, 31 znaków)');
SELECT ok(
  (SELECT consent_version = 'sha256:abc' FROM public.crm_consent_log
    WHERE email = 'z-wersja@i9d-y2.test' AND consent_key = 'newsletter')
  AND (SELECT consent_version LIKE 'txt-sha256:%' AND consent_text LIKE 'Zapisuję się do newslettera%'
         FROM public.crm_consent_log WHERE email = 'pusto@i9d-y2.test' AND consent_key = 'newsletter')
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log
                   WHERE email IN ('bez-wersji@i9d-y2.test', 'z-wersja@i9d-y2.test', 'pusto@i9d-y2.test')
                     AND consent_key = 'email_measurement'),
  'wersja z ładunku zostaje; tekst zastępczy też z wersją; zgoda na newsletter - bez wpisu email_measurement');

-- Link „Chcę dalej otrzymywać" (wygaszanie Y1) - wpis „tak" też z wersją.
INSERT INTO public.newsletter_sunset_requests (subscriber_id, tenant_id, nonce)
VALUES (pg_temp.sub('bez-wersji@i9d-y2.test'), '19d60000-0000-4000-8000-0000000000a0', '19d60000-0000-4000-8000-0000000070a1');
INSERT INTO r SELECT 'keep', public.newsletter_sunset_keep(pg_temp.sub('bez-wersji@i9d-y2.test'),
                                                           '19d60000-0000-4000-8000-0000000070a1');
SELECT ok(
  (SELECT v ->> 'result' = 'kept' FROM r WHERE k = 'keep')
  AND (SELECT consent_version = public._consent_text_version(consent_text) FROM public.crm_consent_log
        WHERE email = 'bez-wersji@i9d-y2.test' AND form_id = 'retention:newsletter_keep'),
  'link „Chcę dalej otrzymywać": wpis potwierdzenia z wersją treści (bez pomiaru)');

-- ── 3. Brak pakietowania; zgodę zapisuje wyłącznie pisarz pomiaru ─────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents)
SELECT '19d60000-0000-4000-8000-0000000000a0', 'pomiar@i9d-y2.test', 'subscribed', 'pl',
       jsonb_build_array(jsonb_build_object('key', 'newsletter', 'text', public._newsletter_consent_default('pl'),
                                            'version', public._newsletter_consent_version(), 'given', true));
INSERT INTO r SELECT 'pomiar_before', to_jsonb(pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'pomiar@i9d-y2.test'));
INSERT INTO r SELECT 'g_pomiar', to_jsonb(public._email_measurement_grant(pg_temp.sub('pomiar@i9d-y2.test'), 'reconfirm'));
SELECT ok(
  (SELECT v = 'false'::jsonb FROM r WHERE k = 'pomiar_before')
  AND (SELECT v = '"granted"'::jsonb FROM r WHERE k = 'g_pomiar')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log m
        WHERE m.email = 'pomiar@i9d-y2.test' AND m.consent_key = 'email_measurement' AND m.given
          AND m.source_type = 'newsletter' AND m.source_id = pg_temp.sub('pomiar@i9d-y2.test')
          AND m.form_id = 'measurement:reconfirm' AND m.consent_version = public._email_measurement_consent_version()
          AND m.consent_text = public._email_measurement_consent_default('pl'))
  AND pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'POMIAR@i9d-y2.test')
  AND NOT pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'bez-wersji@i9d-y2.test'),
  'zgoda na newsletter (b) nie daje pomiaru; pisarz pomiaru - wpis związany z subskrybentem; czytelnik bez wielkości liter');

-- Formularz z kluczem `newsletter` i `marketing` (treść (a) i (b)) - zero wpisów pomiaru.
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents)
SELECT '19d60000-0000-4000-8000-0000000000a0', 'dwa-klucze@i9d-y2.test', 'subscribed', 'pl',
       jsonb_build_array(
         jsonb_build_object('key', 'newsletter', 'text', 'Treść A', 'version', 'newsletter-2026-10-21'),
         jsonb_build_object('key', 'marketing', 'text', 'Treść A', 'version', public._newsletter_consent_version()));
SELECT is(
  (SELECT count(*)::int FROM public.crm_consent_log WHERE email = 'dwa-klucze@i9d-y2.test' AND consent_key = 'email_measurement'),
  0, 'dwa klucze marketingowe z jednego formularza (wersja (a) i (b)) - żadnego wpisu email_measurement');

-- Zgoda z wydarzenia (inny pisarz rejestru) z treścią i wersją (a) - bez pomiaru.
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language)
VALUES ('19d60000-0000-4000-8000-0000000000b0', 'admin-tekst@i9d-y2.test', 'subscribed', 'pl');
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, consent_version, given)
VALUES ('19d60000-0000-4000-8000-0000000000b0', 'admin-tekst@i9d-y2.test', 'event', 'marketing',
        'Mój własny tekst zgody: mierzymy otwarcia i kliknięcia.', 'newsletter-2026-10-21', true);
SELECT ok(
  NOT pg_temp.consent('19d60000-0000-4000-8000-0000000000b0', 'admin-tekst@i9d-y2.test')
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email = 'admin-tekst@i9d-y2.test'
                    AND consent_key = 'email_measurement'),
  'zgoda z wydarzenia z treścią i wersją (a) - bez wpisu email_measurement i bez pomiaru');

-- ── 4. Ponowny zapis (UPDATE consents) ───────────────────────────────────────
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() - interval '1 minute'
 WHERE email = 'pomiar@i9d-y2.test';
SELECT ok(NOT pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'pomiar@i9d-y2.test'),
  'wypis subskrybenta po udzieleniu = brak pomiaru');
-- Zgody sprzed wypisu: chwila zapisu przed `unsubscribed_at` (wpisy pomiaru
-- są niezmienne - strażnik rejestru; wypis dopisał „nie" pomiaru).
UPDATE public.crm_consent_log SET created_at = now() - interval '1 hour'
 WHERE email = 'pomiar@i9d-y2.test' AND consent_key <> 'email_measurement';
INSERT INTO r SELECT 'n_before', to_jsonb((SELECT count(*) FROM public.crm_consent_log WHERE email = 'pomiar@i9d-y2.test'));
UPDATE public.newsletter_subscribers
   SET status = 'subscribed',
       consents = '[{"key":"newsletter","text":"Stara treść bez pomiaru.","received_at":"2026-10-22T10:00:00Z"}]'
 WHERE email = 'pomiar@i9d-y2.test';
SELECT ok(
  (SELECT count(*) FROM public.crm_consent_log WHERE email = 'pomiar@i9d-y2.test')
    = (SELECT (v #>> '{}')::bigint + 1 FROM r WHERE k = 'n_before')
  AND EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email = 'pomiar@i9d-y2.test' AND consent_key = 'newsletter'
                AND consent_text = 'Stara treść bez pomiaru.' AND consent_version LIKE 'txt-sha256:%')
  AND NOT pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'pomiar@i9d-y2.test'),
  'ponowny zapis po wypisie: nowa zgoda w rejestrze (dotąd bez wpisu), ale bez pomiaru - stara zgoda nie wraca');
UPDATE public.newsletter_subscribers
   SET consents = consents || jsonb_build_array(
         jsonb_build_object('key', 'newsletter', 'text', 'Treść (a) z pomiarem.', 'version', 'newsletter-2026-10-21',
                            'received_at', '2026-10-22T10:05:00Z'),
         jsonb_build_object('key', 'email_measurement_declared', 'text', public._email_measurement_consent_default('pl'),
                            'version', public._email_measurement_consent_version(), 'given', true,
                            'received_at', '2026-10-22T10:05:00Z'))
 WHERE email = 'pomiar@i9d-y2.test';
SELECT ok(
  (SELECT count(*) FROM public.crm_consent_log WHERE email = 'pomiar@i9d-y2.test')
    = (SELECT (v #>> '{}')::bigint + 2 FROM r WHERE k = 'n_before')
  AND NOT pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'pomiar@i9d-y2.test'),
  'ponowny zapis z treścią (a) i deklaracją pola pomiaru: w rejestrze tylko zgoda na newsletter - pomiar nie wraca');
UPDATE public.newsletter_subscribers SET consents = consents WHERE email = 'pomiar@i9d-y2.test';
UPDATE public.newsletter_subscribers SET first_name = 'Bez zmian zgód' WHERE email = 'pomiar@i9d-y2.test';
SELECT is(
  (SELECT count(*) FROM public.crm_consent_log WHERE email = 'pomiar@i9d-y2.test'),
  (SELECT (v #>> '{}')::bigint + 2 FROM r WHERE k = 'n_before'),
  'UPDATE bez nowych pozycji consents nie dopisuje wpisów');

-- ── 5. Wycofanie zgody marketingowej i samego pomiaru ────────────────────────
SELECT pg_temp.grant_raw('19d60000-0000-4000-8000-0000000000a0', 'dwa-klucze@i9d-y2.test', 'newsletter',
                         pg_temp.sub('dwa-klucze@i9d-y2.test'), now() - interval '1 hour');
INSERT INTO r SELECT 'dk_before', to_jsonb(pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'dwa-klucze@i9d-y2.test'));
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given)
VALUES ('19d60000-0000-4000-8000-0000000000a0', 'dwa-klucze@i9d-y2.test', 'other', 'marketing',
        'Wycofanie zgody marketingowej (wypis ścieżki)', false);
SELECT ok((SELECT v = 'true'::jsonb FROM r WHERE k = 'dk_before')
          AND NOT pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'dwa-klucze@i9d-y2.test'),
  'wycofanie zgody marketing PO udzieleniu pomiaru = brak pomiaru');

-- Ponowna zgoda na pomiar po ponownym zapisie (decyzja właściciela - pisarz).
SELECT public._email_measurement_grant(pg_temp.sub('pomiar@i9d-y2.test'), 'reconfirm');
INSERT INTO r SELECT 'state1', public.email_measurement_state(pg_temp.sub('pomiar@i9d-y2.test'), NULL);
INSERT INTO r SELECT 'w1', public.email_measurement_withdraw(pg_temp.sub('pomiar@i9d-y2.test'), NULL, 'email_footer',
                                                             '203.0.113.7', 'Mozilla/5.0');
INSERT INTO r SELECT 'w2', public.email_measurement_withdraw(pg_temp.sub('pomiar@i9d-y2.test'), NULL, 'nieznany');
SELECT ok(
  (SELECT v ->> 'result' = 'ok' AND (v ->> 'consent')::boolean AND (v ->> 'measured')::boolean
          AND (v ->> 'enabled')::boolean AND v ->> 'lang' = 'pl' FROM r WHERE k = 'state1')
  AND (SELECT v ->> 'result' = 'withdrawn' AND v ->> 'tenant_id' = '19d60000-0000-4000-8000-0000000000a0'
         FROM r WHERE k = 'w1')
  AND (SELECT v ->> 'result' = 'already' FROM r WHERE k = 'w2'),
  'stan przed wycofaniem; wycofanie pomiaru -> withdrawn; powtórka -> already');
SELECT ok(
  NOT pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'pomiar@i9d-y2.test')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log
        WHERE email = 'pomiar@i9d-y2.test' AND consent_key = 'email_measurement' AND NOT given
          AND form_id = 'measurement:email_footer' AND source_type = 'newsletter'
          AND consent_version = public._email_measurement_consent_version() AND ip = '203.0.113.7' AND lang = 'pl')
  AND (SELECT status = 'subscribed' FROM public.newsletter_subscribers WHERE email = 'pomiar@i9d-y2.test')
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log WHERE email = 'pomiar@i9d-y2.test'
                    AND consent_key IN ('newsletter', 'marketing') AND NOT given),
  'wycofanie SAMEGO pomiaru: jeden wpis „nie" (kanał, wersja treści pomiaru, IP); newsletter i status bez zmian');
SELECT is(
  (SELECT v ->> 'consent' FROM (SELECT public.email_measurement_state(pg_temp.sub('pomiar@i9d-y2.test'), NULL) AS v) x),
  'false', 'stan po wycofaniu: bez zgody na pomiar');

-- Kontakt CRM bez subskrypcji (mail ścieżki): język domyślny, źródło other.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm) VALUES
  ('19d60000-0000-4000-8000-0000000030a1', '19d60000-0000-4000-8000-0000000000a0', 'Kontakt@i9d-y2.test', 'kontakt@i9d-y2.test');
SELECT pg_temp.grant_raw('19d60000-0000-4000-8000-0000000000a0', 'kontakt@i9d-y2.test', 'other',
                         '19d60000-0000-4000-8000-0000000030a1', now() - interval '1 day');
INSERT INTO r SELECT 'k_before', to_jsonb(pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'kontakt@i9d-y2.test'));
-- Osobne polecenie: funkcje STABLE w jednym poleceniu widzą migawkę sprzed
-- wpisu wycofania.
INSERT INTO r SELECT 'kw', public.email_measurement_withdraw(NULL, '19d60000-0000-4000-8000-0000000030a1', 'preferences');
SELECT ok(
  (SELECT v = 'false'::jsonb FROM r WHERE k = 'k_before')
  AND (SELECT v ->> 'result' = 'withdrawn' FROM r WHERE k = 'kw')
  AND NOT pg_temp.consent('19d60000-0000-4000-8000-0000000000a0', 'kontakt@i9d-y2.test')
  AND (SELECT source_type = 'other' AND source_id = '19d60000-0000-4000-8000-0000000030a1' AND lang = 'pl'
              AND form_id = 'measurement:preferences'
         FROM public.crm_consent_log WHERE email = 'kontakt@i9d-y2.test' AND consent_key = 'email_measurement' AND NOT given),
  'kontakt CRM bez subskrypcji: „tak" bez pomiaru (D2); wycofanie przez identyfikator kontaktu zamyka łańcuch');
SELECT ok(
  public.email_measurement_withdraw(NULL, NULL) ->> 'result' = 'invalid'
  AND public.email_measurement_withdraw(pg_temp.sub('pomiar@i9d-y2.test'), '19d60000-0000-4000-8000-0000000030a1') ->> 'result' = 'invalid'
  AND public.email_measurement_withdraw('19d60000-0000-4000-8000-00000000ffff', NULL) ->> 'result' = 'gone'
  AND public.email_measurement_state(NULL, '19d60000-0000-4000-8000-00000000ffff') ->> 'result' = 'gone'
  AND public.email_measurement_withdraw(pg_temp.sub('bez-wersji@i9d-y2.test'), NULL) ->> 'result' = 'already',
  'podmiot: dokładnie jeden identyfikator (invalid), nieznany -> gone, bez zgody na pomiar -> already bez wpisu');

-- ── 6. Porcja dla runnerów i wspólny przełącznik ─────────────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents)
SELECT '19d60000-0000-4000-8000-0000000000a0', 'porcja@i9d-y2.test', 'subscribed', 'en',
       jsonb_build_array(jsonb_build_object('key', 'newsletter', 'text', public._newsletter_consent_default('en'),
                                            'version', public._newsletter_consent_version(), 'lang', 'en'));
SELECT public._email_measurement_grant(pg_temp.sub('porcja@i9d-y2.test'), 'doi');
SELECT is(
  (SELECT jsonb_agg(jsonb_build_object('e', s.email, 'c', s.consent, 'm', s.measured) ORDER BY s.email)
     FROM public.email_measurement_status('19d60000-0000-4000-8000-0000000000a0',
            ARRAY['PORCJA@i9d-y2.test', 'porcja@i9d-y2.test ', 'bez-wersji@i9d-y2.test', '', NULL]) s),
  '[{"c": false, "e": "bez-wersji@i9d-y2.test", "m": false}, {"c": true, "e": "porcja@i9d-y2.test", "m": true}]'::jsonb,
  'porcja: adresy małymi literami bez duplikatów i pustych; zgoda = pomiar przy włączonym przełączniku');
INSERT INTO public.journey_settings (tenant_id, open_tracking_enabled)
VALUES ('19d60000-0000-4000-8000-0000000000a0', false);
SELECT is(
  (SELECT jsonb_agg(jsonb_build_object('c', s.consent, 'm', s.measured))
     FROM public.email_measurement_status('19d60000-0000-4000-8000-0000000000a0', ARRAY['porcja@i9d-y2.test']) s),
  '[{"c": true, "m": false}]'::jsonb,
  'wspólny przełącznik najemcy wyłączony: zgoda zostaje, pomiaru nie ma (ścieżki i kampanie)');
SELECT is(
  (SELECT v ->> 'measured' FROM (SELECT public.email_measurement_state(pg_temp.sub('porcja@i9d-y2.test'), NULL) AS v) x),
  'false', 'stan: measured = zgoda ORAZ przełącznik');
SELECT throws_ok(
  $$ SELECT * FROM public.email_measurement_status('19d60000-0000-4000-8000-0000000000a0',
                                                  (SELECT array_agg('x' || g || '@i9d-y2.test') FROM generate_series(1, 2001) g)) $$,
  '22023', 'too_many_emails', 'porcja: limit 2000 adresów (22023)');
SELECT throws_ok($$ SELECT * FROM public.email_measurement_status(NULL, ARRAY['a@b.c']) $$,
  '22023', 'tenant_required', 'porcja: najemca wymagany (22023)');

-- ── 7. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.email_measurement_status(uuid, text[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.email_measurement_status(uuid, text[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.email_measurement_status(uuid, text[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.email_measurement_withdraw(uuid, uuid, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.email_measurement_withdraw(uuid, uuid, text, text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.email_measurement_withdraw(uuid, uuid, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.email_measurement_state(uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.email_measurement_state(uuid, uuid)', 'EXECUTE'),
  'ACL: porcja, stan i wycofanie pomiaru - wyłącznie service_role (podpis HMAC sprawdza serwer)');
SELECT ok(
  NOT has_function_privilege('service_role', 'public._email_measurement_consent(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._email_measurement_consent(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._newsletter_consent_default(text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._newsletter_consent_upgrade_defaults()', 'EXECUTE')
  AND to_regprocedure('public._consent_covers_measurement(uuid, text, text, text)') IS NULL
  AND NOT has_function_privilege('service_role',
        'public._newsletter_log_consents(uuid, text, uuid, text, text, text, text, text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.newsletter_to_lead()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._email_measurement_grant(uuid, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_crm_consent_log_measurement_guard()', 'EXECUTE'),
  'ACL: funkcje wewnętrzne i wyzwalacze bez EXECUTE dla ról API; funkcja pakietowania usunięta');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.newsletter_consent_measurement_marks'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.newsletter_consent_measurement_marks', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.newsletter_consent_measurement_marks', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.newsletter_consent_measurement_marks', 'INSERT')
  AND has_table_privilege('service_role', 'public.newsletter_consent_measurement_marks', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.newsletter_consent_measurement_marks', 'INSERT'),
  'tabela oznaczeń (archiwum okresu (a)): RLS, bez dostępu ról klienta, service_role tylko odczyt');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_consent_log_measurement'
                AND tgrelid = 'public.crm_consent_log'::regclass AND NOT tgisinternal)
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_consent_log_measurement_guard'
                AND tgrelid = 'public.crm_consent_log'::regclass AND NOT tgisinternal)
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_newsletter_consents_log'
                AND tgrelid = 'public.newsletter_subscribers'::regclass AND NOT tgisinternal),
  'wyzwalacze: bez pakietowania (strażnik rejestru zamiast dopisywania pomiaru), subskrybent -> nowe pozycje consents');
SELECT throws_ok(
  $$ INSERT INTO public.newsletter_consent_measurement_marks (tenant_id, field, text_sha256)
     VALUES ('19d60000-0000-4000-8000-0000000000a0', 'heading_pl', repeat('a', 64)) $$,
  '23514', NULL, 'oznaczenie tylko dla pól treści zgody (CHECK)');
SELECT throws_ok(
  $$ INSERT INTO public.newsletter_consent_measurement_marks (tenant_id, field, text_sha256)
     VALUES ('19d60000-0000-4000-8000-0000000000a0', 'policy_html_en', 'nie-skrot') $$,
  '23514', NULL, 'oznaczenie: skrót SHA-256 (64 hex, CHECK)');

SELECT * FROM finish();
ROLLBACK;
