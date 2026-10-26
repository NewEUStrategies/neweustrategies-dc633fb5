-- pgTAP: wypis z newslettera wycofuje zgodę marketingową kontaktu CRM
-- (audyt ED14, migracja 20261026120000).
--
-- CO PRZYPINA:
--   * ACL: wyzwalacz i uzgodnienie bez EXECUTE dla anon, authenticated
--     i service_role; wyzwalacz tylko na PRZEJŚCIU na `unsubscribed` i po
--     wyzwalaczach `newsletter_to_lead` (OR) i pomiaru;
--   * każdy kanał wypisu (link tokenem subskrybenta, twarde odbicie przez
--     listę wyłączeń, zmiana statusu przez personel) zdejmuje flagę
--     `crm_leads.marketing_consent` i dopisuje `marketing`/`given = false`
--     ze źródłem `newsletter`, id subskrybenta i językiem subskrybenta;
--   * ponowny UPDATE już wypisanego wiersza nie pisze nic; obcy najemca
--     z tym samym adresem nietknięty;
--   * czytelnik zgody ścieżek: ponowny zapis z nowym wpisem „tak" przywraca
--     zgodę, „Przywróć" w panelu (sam status) - nie;
--   * uzgodnienie danych: kontakt wypisany przed wyzwalaczem traci flagę,
--     kontakt z późniejszą zgodą zostaje, powtórka = 0.
--
-- Uruchamianie: PGTAP_DIR=... bash scripts/pgtap-local/run.sh test newsletter_unsubscribe_crm_consent
BEGIN;
SELECT plan(16);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('ed140000-0000-4000-8000-0000000000a0', 'ed14-nuc-a', 'ED14 NUC A'),
  ('ed140000-0000-4000-8000-0000000000b0', 'ed14-nuc-b', 'ED14 NUC B');

-- Wiersze `subscribed` zapalają flagę w CRM wyzwalaczami newslettera (OR).
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status, language, unsubscribe_token) VALUES
  ('ed140000-0000-4000-8000-0000000001a1', 'ed140000-0000-4000-8000-0000000000a0', 'Link@nuc.test', 'subscribed', 'pl', 'ed14-nuc-tok-link'),
  ('ed140000-0000-4000-8000-0000000001a2', 'ed140000-0000-4000-8000-0000000000a0', 'bounce@nuc.test', 'subscribed', 'pl', 'ed14-nuc-tok-bounce'),
  ('ed140000-0000-4000-8000-0000000001a3', 'ed140000-0000-4000-8000-0000000000a0', 'staff@nuc.test', 'subscribed', 'en', 'ed14-nuc-tok-staff'),
  ('ed140000-0000-4000-8000-0000000001a4', 'ed140000-0000-4000-8000-0000000000a0', 'again@nuc.test', 'unsubscribed', 'pl', 'ed14-nuc-tok-again'),
  ('ed140000-0000-4000-8000-0000000001a5', 'ed140000-0000-4000-8000-0000000000a0', 'resub@nuc.test', 'subscribed', 'pl', 'ed14-nuc-tok-resub'),
  ('ed140000-0000-4000-8000-0000000001a6', 'ed140000-0000-4000-8000-0000000000a0', 'restore@nuc.test', 'subscribed', 'pl', 'ed14-nuc-tok-restore'),
  ('ed140000-0000-4000-8000-0000000001a7', 'ed140000-0000-4000-8000-0000000000a0', 'shared@nuc.test', 'subscribed', 'pl', 'ed14-nuc-tok-shared-a'),
  ('ed140000-0000-4000-8000-0000000001b7', 'ed140000-0000-4000-8000-0000000000b0', 'shared@nuc.test', 'subscribed', 'pl', 'ed14-nuc-tok-shared-b'),
  ('ed140000-0000-4000-8000-0000000001a8', 'ed140000-0000-4000-8000-0000000000a0', 'legacy@nuc.test', 'subscribed', 'pl', 'ed14-nuc-tok-legacy'),
  ('ed140000-0000-4000-8000-0000000001a9', 'ed140000-0000-4000-8000-0000000000a0', 'later@nuc.test', 'subscribed', 'pl', 'ed14-nuc-tok-later');

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;

CREATE FUNCTION pg_temp.flag(p_tenant uuid, p_email text) RETURNS boolean LANGUAGE sql AS $$
  SELECT l.marketing_consent FROM public.crm_leads l WHERE l.tenant_id = p_tenant AND l.email_norm = p_email
$$;
CREATE FUNCTION pg_temp.lead(p_email text) RETURNS uuid LANGUAGE sql AS $$
  SELECT l.id FROM public.crm_leads l
   WHERE l.tenant_id = 'ed140000-0000-4000-8000-0000000000a0' AND l.email_norm = p_email
$$;
CREATE FUNCTION pg_temp.withdrawals(p_tenant uuid, p_email text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.crm_consent_log c
   WHERE c.tenant_id = p_tenant AND lower(c.email) = p_email AND c.consent_key = 'marketing' AND NOT c.given
$$;
-- Chwile rejestru w kolejności zdarzeń: cała transakcja testu ma jedno
-- `now()`, więc zapis (tak) i wypis (nie) dostają jawnie wcześniejsze chwile.
CREATE FUNCTION pg_temp.age_log(p_email text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.crm_consent_log c
     SET created_at = CASE WHEN c.given THEN now() - interval '2 days' ELSE now() - interval '1 day' END
   WHERE c.tenant_id = 'ed140000-0000-4000-8000-0000000000a0' AND lower(c.email) = p_email
$$;

-- ── 1-2. ACL i definicja wyzwalacza ─────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.tg_newsletter_unsubscribed_withdraw_crm()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_newsletter_unsubscribed_withdraw_crm()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.tg_newsletter_unsubscribed_withdraw_crm()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._newsletter_unsubscribe_crm_reconcile()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._newsletter_unsubscribe_crm_reconcile()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._newsletter_unsubscribe_crm_reconcile()', 'EXECUTE'),
  'ACL: wyzwalacz i uzgodnienie bez EXECUTE dla anon, authenticated i service_role');

SELECT ok(
  (SELECT pg_get_triggerdef(t.oid) ~ 'AFTER UPDATE OF status ON public\.newsletter_subscribers'
          AND pg_get_triggerdef(t.oid) ~ $re$new\.status = 'unsubscribed'::text\) AND \(old\.status IS DISTINCT FROM 'unsubscribed'::text$re$
     FROM pg_trigger t
    WHERE t.tgrelid = 'public.newsletter_subscribers'::regclass
      AND t.tgname = 'trg_newsletter_unsubscribed_withdraw_crm')
  -- Wyzwalacze AFTER tej samej tabeli biegną w kolejności nazw.
  AND 'trg_newsletter_unsubscribed_withdraw_crm' > 'trg_newsletter_to_lead'
  AND 'trg_newsletter_unsubscribed_withdraw_crm' > 'trg_newsletter_unsubscribed_measurement',
  'wyzwalacz: AFTER UPDATE OF status, tylko przejście na unsubscribed, po newsletter_to_lead i po pomiarze');

-- ── 3-5. Link wypisu (token subskrybenta) ────────────────────────────────────
SELECT ok(pg_temp.flag('ed140000-0000-4000-8000-0000000000a0', 'link@nuc.test'),
  'przed wypisem: zapis na newsletter zapalił zgodę w CRM');
INSERT INTO r VALUES ('link', public.email_unsubscribe_by_token('ed14-nuc-tok-link'));
SELECT ok(
  (SELECT (v ->> 'ok')::boolean FROM r WHERE k = 'link')
  AND NOT pg_temp.flag('ed140000-0000-4000-8000-0000000000a0', 'link@nuc.test')
  AND (SELECT newsletter_status FROM public.crm_leads
        WHERE tenant_id = 'ed140000-0000-4000-8000-0000000000a0' AND email_norm = 'link@nuc.test') = 'unsubscribed',
  'link wypisu: flaga zgody zdjęta, status newslettera w CRM = unsubscribed');
SELECT is(
  (SELECT count(*) FROM public.crm_consent_log c
    WHERE c.tenant_id = 'ed140000-0000-4000-8000-0000000000a0' AND c.email = 'Link@nuc.test'
      AND c.consent_key = 'marketing' AND NOT c.given AND c.source_type = 'newsletter'
      AND c.source_id = 'ed140000-0000-4000-8000-0000000001a1' AND c.form_id = 'newsletter:unsubscribe'
      AND c.form_name = 'newsletter_unsubscribe' AND c.lang = 'pl' AND c.consent_text LIKE 'Wycofanie zgody marketingowej%'),
  1::bigint,
  'link wypisu: jeden wpis marketing/given=false - źródło newsletter, id subskrybenta, adres jak w kontakcie, język PL');

-- ── 6. Twarde odbicie (lista wyłączeń -> wyzwalacz synchronizacji) ──────────
SELECT public.email_record_suppression(
  p_tenant => 'ed140000-0000-4000-8000-0000000000a0', p_email => 'bounce@nuc.test',
  p_reason => 'hard_bounce', p_source => 'manual', p_provider => 'test');
SELECT ok(
  (SELECT status FROM public.newsletter_subscribers WHERE id = 'ed140000-0000-4000-8000-0000000001a2') = 'unsubscribed'
  AND NOT pg_temp.flag('ed140000-0000-4000-8000-0000000000a0', 'bounce@nuc.test')
  AND pg_temp.withdrawals('ed140000-0000-4000-8000-0000000000a0', 'bounce@nuc.test') = 1,
  'twarde odbicie: subskrybent wypisany, flaga zdjęta, wpis „nie"');

-- ── 7. Personel (zmiana statusu w panelu), subskrybent EN ───────────────────
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now()
 WHERE id = 'ed140000-0000-4000-8000-0000000001a3';
SELECT ok(
  NOT pg_temp.flag('ed140000-0000-4000-8000-0000000000a0', 'staff@nuc.test')
  AND EXISTS (SELECT 1 FROM public.crm_consent_log c
               WHERE c.tenant_id = 'ed140000-0000-4000-8000-0000000000a0' AND c.email = 'staff@nuc.test'
                 AND c.consent_key = 'marketing' AND NOT c.given AND c.lang = 'en'
                 AND c.consent_text LIKE 'Marketing consent withdrawn%'),
  'personel: flaga zdjęta, wpis „nie" w języku subskrybenta (EN)');

-- ── 8. Brak przejścia = brak wycofania ──────────────────────────────────────
-- Wiersz od początku wypisany; flagę zaznaczył później personel.
UPDATE public.crm_leads SET marketing_consent = true
 WHERE tenant_id = 'ed140000-0000-4000-8000-0000000000a0' AND email_norm = 'again@nuc.test';
UPDATE public.newsletter_subscribers SET status = 'unsubscribed'
 WHERE id = 'ed140000-0000-4000-8000-0000000001a4';
SELECT ok(
  pg_temp.flag('ed140000-0000-4000-8000-0000000000a0', 'again@nuc.test')
  AND pg_temp.withdrawals('ed140000-0000-4000-8000-0000000000a0', 'again@nuc.test') = 0,
  'ponowny UPDATE wypisanego wiersza (bez przejścia): flaga i rejestr bez zmian');

-- ── 9. Obcy najemca z tym samym adresem ─────────────────────────────────────
SELECT public.email_unsubscribe_by_token('ed14-nuc-tok-shared-a');
SELECT ok(
  NOT pg_temp.flag('ed140000-0000-4000-8000-0000000000a0', 'shared@nuc.test')
  AND pg_temp.flag('ed140000-0000-4000-8000-0000000000b0', 'shared@nuc.test')
  AND pg_temp.withdrawals('ed140000-0000-4000-8000-0000000000b0', 'shared@nuc.test') = 0,
  'izolacja: wypis w A nie dotyka kontaktu ani rejestru najemcy B');

-- ── 10-12. Czytelnik zgody ścieżek ──────────────────────────────────────────
SELECT public.email_unsubscribe_by_token('ed14-nuc-tok-resub');
SELECT public.email_unsubscribe_by_token('ed14-nuc-tok-restore');
SELECT pg_temp.age_log('resub@nuc.test');
SELECT pg_temp.age_log('restore@nuc.test');
SELECT is(public._journey_marketing_consent('ed140000-0000-4000-8000-0000000000a0', pg_temp.lead('resub@nuc.test')),
  'unsubscribed', 'ścieżki: wypisany -> unsubscribed');
-- Ponowny zapis z formularza (nowa pozycja `consents` = nowy wpis „tak")
-- i potwierdzenie double opt-in.
UPDATE public.newsletter_subscribers
   SET status = 'pending', unsubscribed_at = NULL,
       consents = jsonb_build_array(jsonb_build_object(
         'key', 'newsletter', 'text', 'Zapisuję się do newslettera.', 'given', true,
         'received_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
 WHERE id = 'ed140000-0000-4000-8000-0000000001a5';
UPDATE public.newsletter_subscribers SET status = 'subscribed', confirmed_at = now()
 WHERE id = 'ed140000-0000-4000-8000-0000000001a5';
SELECT is(public._journey_marketing_consent('ed140000-0000-4000-8000-0000000000a0', pg_temp.lead('resub@nuc.test')),
  'ok', 'ścieżki: ponowny zapis po wypisie (nowszy wpis „tak") przywraca zgodę');
-- „Przywróć" w panelu: sam status, bez nowego dowodu zgody osoby.
UPDATE public.newsletter_subscribers SET status = 'subscribed', unsubscribed_at = NULL
 WHERE id = 'ed140000-0000-4000-8000-0000000001a6';
SELECT is(public._journey_marketing_consent('ed140000-0000-4000-8000-0000000000a0', pg_temp.lead('restore@nuc.test')),
  'no_consent', 'ścieżki: „Przywróć" w panelu (bez wpisu „tak") nie wskrzesza zgody');

-- ── 13-16. Uzgodnienie danych sprzed wyzwalacza ─────────────────────────────
-- Stan sprzed poprawki: wypis bez wyzwalacza A (flaga zostaje przez OR).
ALTER TABLE public.newsletter_subscribers DISABLE TRIGGER trg_newsletter_unsubscribed_withdraw_crm;
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() - interval '10 days'
 WHERE id IN ('ed140000-0000-4000-8000-0000000001a8', 'ed140000-0000-4000-8000-0000000001a9');
ALTER TABLE public.newsletter_subscribers ENABLE TRIGGER trg_newsletter_unsubscribed_withdraw_crm;
UPDATE public.crm_consent_log SET created_at = now() - interval '30 days'
 WHERE tenant_id = 'ed140000-0000-4000-8000-0000000000a0' AND lower(email) IN ('legacy@nuc.test', 'later@nuc.test');
-- `later` po wypisie udzielił zgody innym kanałem (np. most wydarzeń).
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given, created_at) VALUES
  ('ed140000-0000-4000-8000-0000000000a0', 'later@nuc.test', 'event', 'marketing', 'Zgoda z wydarzenia.', true,
   now() - interval '2 days');
SELECT ok(
  pg_temp.flag('ed140000-0000-4000-8000-0000000000a0', 'legacy@nuc.test')
  AND pg_temp.flag('ed140000-0000-4000-8000-0000000000a0', 'later@nuc.test'),
  'stan sprzed poprawki: wypisani mają w CRM flagę zgody');

INSERT INTO r VALUES ('reconcile', to_jsonb(public._newsletter_unsubscribe_crm_reconcile()));
SELECT ok(
  NOT pg_temp.flag('ed140000-0000-4000-8000-0000000000a0', 'legacy@nuc.test')
  AND EXISTS (SELECT 1 FROM public.crm_consent_log c
               WHERE c.tenant_id = 'ed140000-0000-4000-8000-0000000000a0' AND c.email = 'legacy@nuc.test'
                 AND c.consent_key = 'marketing' AND NOT c.given
                 AND c.source_id = 'ed140000-0000-4000-8000-0000000001a8'
                 AND c.form_id = 'newsletter:unsubscribe' AND c.form_name = 'newsletter_unsubscribe_reconcile'
                 AND c.consent_text LIKE '%' || to_char((now() - interval '10 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '%'),
  'uzgodnienie: wypisany przed wyzwalaczem traci flagę, wpis z datą wypisu');
SELECT ok(
  pg_temp.flag('ed140000-0000-4000-8000-0000000000a0', 'later@nuc.test')
  AND pg_temp.withdrawals('ed140000-0000-4000-8000-0000000000a0', 'later@nuc.test') = 0
  AND (SELECT (v #>> '{}')::bigint FROM r WHERE k = 'reconcile') =
      (SELECT count(*) FROM public.crm_consent_log WHERE form_name = 'newsletter_unsubscribe_reconcile'),
  'uzgodnienie: późniejsza zgoda zostaje; wynik = liczba wpisów rejestru');
SELECT is(public._newsletter_unsubscribe_crm_reconcile(), 0, 'uzgodnienie: powtórka = 0');

SELECT * FROM finish();
ROLLBACK;
