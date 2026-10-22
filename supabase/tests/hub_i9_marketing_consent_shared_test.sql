-- pgTAP: jeden pomocnik wycofania zgody marketingowej kontaktu CRM (I9,
-- Z-S5-04; migracja 20261020162700).
--
-- CO PRZYPINA:
--   * ACL: `_crm_marketing_consent_withdraw` bez EXECUTE dla anon,
--     authenticated i service_role (wołają go wyłącznie definery);
--   * semantyka pomocnika: flaga zdejmowana tylko kontaktom, które ją mają
--     (kontakt już odznaczony - wpis rejestru jest, `updated_at` bez zmian),
--     wpis `marketing`/`given = false` dla każdego kontaktu najemcy, kontakt
--     obcego najemcy nietknięty, wynik = liczba wpisów;
--   * trzy ścieżki - personel CRM, wypis ze ścieżki, wygaszanie newslettera -
--     zostawiają TEN SAM ślad rejestru, różny tylko formularzem, treścią
--     i źródłem.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9_marketing_consent_shared
BEGIN;
SELECT plan(10);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('19e90000-0000-4000-8000-0000000004a0', 'i9-zgoda-a', 'I9 Zgoda A'),
  ('19e90000-0000-4000-8000-0000000004b0', 'i9-zgoda-b', 'I9 Zgoda B');
INSERT INTO auth.users (id, email) VALUES
  ('19e90000-0000-4000-8000-00000000a401', 'admin@i9-zgoda.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19e90000-0000-4000-8000-00000000a401', 'admin@i9-zgoda.test', 'Admin', '19e90000-0000-4000-8000-0000000004a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19e90000-0000-4000-8000-00000000a401', 'admin', '19e90000-0000-4000-8000-0000000004a0');

-- L1 ma zgodę, L2 już odznaczony (stary `updated_at`), LB - obcy najemca,
-- L4 - ścieżka personelu, L5 - wypis ze ścieżki.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, marketing_consent) VALUES
  ('19e90000-0000-4000-8000-0000000041a1', '19e90000-0000-4000-8000-0000000004a0', 'L1@i9-zgoda.test', 'l1@i9-zgoda.test', true),
  ('19e90000-0000-4000-8000-0000000041a2', '19e90000-0000-4000-8000-0000000004a0', 'l2@i9-zgoda.test', 'l2@i9-zgoda.test', false),
  ('19e90000-0000-4000-8000-0000000041b1', '19e90000-0000-4000-8000-0000000004b0', 'lb@i9-zgoda.test', 'lb@i9-zgoda.test', true),
  ('19e90000-0000-4000-8000-0000000041a4', '19e90000-0000-4000-8000-0000000004a0', 'l4@i9-zgoda.test', 'l4@i9-zgoda.test', true),
  ('19e90000-0000-4000-8000-0000000041a5', '19e90000-0000-4000-8000-0000000004a0', 'l5@i9-zgoda.test', 'l5@i9-zgoda.test', true);
-- Bez wyzwalaczy: `set_updated_at` nadpisałby datę na „teraz" transakcji.
ALTER TABLE public.crm_leads DISABLE TRIGGER USER;
UPDATE public.crm_leads SET updated_at = now() - interval '30 days'
 WHERE id = '19e90000-0000-4000-8000-0000000041a2';
ALTER TABLE public.crm_leads ENABLE TRIGGER USER;

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r TO authenticated;

-- ── 1. ACL pomocnika ─────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon',
        'public._crm_marketing_consent_withdraw(uuid, uuid[], public.crm_source_type, uuid, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
        'public._crm_marketing_consent_withdraw(uuid, uuid[], public.crm_source_type, uuid, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role',
        'public._crm_marketing_consent_withdraw(uuid, uuid[], public.crm_source_type, uuid, text, text, text, text)', 'EXECUTE'),
  'pomocnik: bez EXECUTE dla anon, authenticated i service_role');

-- ── 2-4. Semantyka pomocnika ────────────────────────────────────────────────
INSERT INTO r VALUES ('helper', to_jsonb(public._crm_marketing_consent_withdraw(
  '19e90000-0000-4000-8000-0000000004a0',
  ARRAY['19e90000-0000-4000-8000-0000000041a1', '19e90000-0000-4000-8000-0000000041a2',
        '19e90000-0000-4000-8000-0000000041b1']::uuid[],
  'other', NULL, 'probe:withdraw', 'probe', 'Probe withdrawal.', 'pl')));
SELECT is((SELECT v FROM r WHERE k = 'helper'), '2'::jsonb,
  'pomocnik: wynik = liczba wpisów rejestru (dwa kontakty najemcy, obcy pominięty)');
SELECT ok(
  NOT (SELECT marketing_consent FROM public.crm_leads WHERE id = '19e90000-0000-4000-8000-0000000041a1')
  AND (SELECT updated_at < now() - interval '29 days' FROM public.crm_leads
        WHERE id = '19e90000-0000-4000-8000-0000000041a2')
  AND (SELECT marketing_consent FROM public.crm_leads WHERE id = '19e90000-0000-4000-8000-0000000041b1'),
  'pomocnik: flaga zdjęta kontaktowi ze zgodą, już odznaczony bez nowego updated_at, obcy najemca nietknięty');
SELECT ok(
  (SELECT count(*) = 2 FROM public.crm_consent_log
    WHERE tenant_id = '19e90000-0000-4000-8000-0000000004a0' AND form_id = 'probe:withdraw'
      AND consent_key = 'marketing' AND NOT given AND source_type = 'other' AND lang = 'pl'
      AND source_id IN ('19e90000-0000-4000-8000-0000000041a1', '19e90000-0000-4000-8000-0000000041a2'))
  AND EXISTS (SELECT 1 FROM public.crm_consent_log
               WHERE form_id = 'probe:withdraw' AND email = 'L1@i9-zgoda.test')
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log
                   WHERE tenant_id = '19e90000-0000-4000-8000-0000000004b0' AND form_id = 'probe:withdraw'),
  'pomocnik: wpis „nie" dla każdego kontaktu najemcy (także już odznaczonego), adres jak w kontakcie, źródło = kontakt');

-- ── 5-6. Personel CRM ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '19e90000-0000-4000-8000-00000000a401', true);
SELECT set_config('request.jwt.claims', '{"sub":"19e90000-0000-4000-8000-00000000a401","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r VALUES ('staff', to_jsonb(public.crm_leads_marketing_consent_withdraw(
  ARRAY['19e90000-0000-4000-8000-0000000041a4', '19e90000-0000-4000-8000-0000000041b1']::uuid[])));
RESET ROLE;
SELECT is((SELECT v FROM r WHERE k = 'staff'), '1'::jsonb,
  'personel: 1 kontakt najemcy z sesji, obcy pominięty');
SELECT ok(
  NOT (SELECT marketing_consent FROM public.crm_leads WHERE id = '19e90000-0000-4000-8000-0000000041a4')
  AND EXISTS (SELECT 1 FROM public.crm_consent_log
               WHERE source_id = '19e90000-0000-4000-8000-0000000041a4' AND form_id = 'crm_staff:withdraw'
                 AND form_name = 'staff' AND consent_key = 'marketing' AND NOT given),
  'personel: flaga zdjęta, wpis crm_staff:withdraw/staff');

-- ── 7-8. Wypis ze ścieżki ───────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT public._journey_unsubscribe('19e90000-0000-4000-8000-0000000004a0',
                                        '19e90000-0000-4000-8000-0000000041a5', 'msg-probe') $$,
  'wypis ze ścieżki: przechodzi przez pomocnika (blokada wypisu zapisana)');
SELECT ok(
  NOT (SELECT marketing_consent FROM public.crm_leads WHERE id = '19e90000-0000-4000-8000-0000000041a5')
  AND EXISTS (SELECT 1 FROM public.crm_consent_log
               WHERE source_id = '19e90000-0000-4000-8000-0000000041a5' AND form_id = 'journey:unsubscribe'
                 AND form_name = 'journey' AND consent_key = 'marketing' AND NOT given)
  AND EXISTS (SELECT 1 FROM public.email_suppressions
               WHERE tenant_id = '19e90000-0000-4000-8000-0000000004a0' AND email = 'l5@i9-zgoda.test'
                 AND reason = 'unsubscribe'),
  'wypis ze ścieżki: flaga zdjęta, wpis journey:unsubscribe/journey, blokada `unsubscribe`');

-- ── 9. Ten sam ślad z dwóch ścieżek ──────────────────────────────────────────
SELECT is(
  (SELECT count(DISTINCT (tenant_id, consent_key, given, source_type, consent_version, ip, user_agent, lang))
     FROM public.crm_consent_log
    WHERE source_id IN ('19e90000-0000-4000-8000-0000000041a4', '19e90000-0000-4000-8000-0000000041a5')),
  1::bigint,
  'personel i wypis: identyczny ślad rejestru (różni się tylko formularz, treść i kontakt)');

-- ── 10. Wygaszanie newslettera ──────────────────────────────────────────────
-- Subskrybent EN bez łańcucha `marketing` w rejestrze, kontakt ze zgodą
-- (źródłem był newsletter - innej zgody brak): wycofanie przez pomocnika.
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status, language) VALUES
  ('19e90000-0000-4000-8000-0000000045a1', '19e90000-0000-4000-8000-0000000004a0', 'sun@i9-zgoda.test',
   'subscribed', 'en');
INSERT INTO public.crm_leads (tenant_id, email, email_norm, marketing_consent) VALUES
  ('19e90000-0000-4000-8000-0000000004a0', 'sun@i9-zgoda.test', 'sun@i9-zgoda.test', true)
ON CONFLICT DO NOTHING;
UPDATE public.crm_leads SET marketing_consent = true
 WHERE tenant_id = '19e90000-0000-4000-8000-0000000004a0' AND email_norm = 'sun@i9-zgoda.test';
DELETE FROM public.crm_consent_log
 WHERE tenant_id = '19e90000-0000-4000-8000-0000000004a0' AND lower(email) = 'sun@i9-zgoda.test'
   AND consent_key = 'marketing';
-- Zgody z zapisu - z chwilą zapisu, nie testu: wpis wygaśnięcia z tą samą
-- chwilą co zgoda dawałby losowe „ostatnie słowo" (remis `created_at`,
-- rozstrzyga losowy identyfikator).
UPDATE public.crm_consent_log SET created_at = now() - interval '20 months'
 WHERE tenant_id = '19e90000-0000-4000-8000-0000000004a0' AND lower(email) = 'sun@i9-zgoda.test';
-- Osobna instrukcja: zapytanie, które woła funkcję zapisującą, nie widzi jej
-- zmian w podzapytaniach (migawka instrukcji).
INSERT INTO r VALUES ('sunset', to_jsonb(public._newsletter_sunset_delete(
  '19e90000-0000-4000-8000-0000000004a0', '19e90000-0000-4000-8000-0000000045a1')));
SELECT ok(
  (SELECT v = 'true'::jsonb FROM r WHERE k = 'sunset')
  AND NOT (SELECT marketing_consent FROM public.crm_leads
            WHERE tenant_id = '19e90000-0000-4000-8000-0000000004a0' AND email_norm = 'sun@i9-zgoda.test')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log
        WHERE tenant_id = '19e90000-0000-4000-8000-0000000004a0' AND lower(email) = 'sun@i9-zgoda.test'
          AND consent_key = 'marketing' AND NOT given AND source_type = 'newsletter'
          AND source_id = '19e90000-0000-4000-8000-0000000045a1'
          AND form_id = 'retention:newsletter_sunset' AND lang = 'en'),
  'wygaszanie: zgoda kontaktu wycofana przez pomocnika - źródło newsletter, id subskrybenta, język subskrybenta');

SELECT * FROM finish();
ROLLBACK;
