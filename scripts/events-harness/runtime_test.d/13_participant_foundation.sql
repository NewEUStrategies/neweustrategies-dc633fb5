-- ============================================================================
-- 13_participant_foundation - FUNDAMENT FUNKCJI UCZESTNIKA F1-F5
--
-- PO CO TEN PLIK ISTNIEJE
-- `20260926100000_event_participant_foundation.sql` zaklada podloge, na ktorej
-- staja trzy tory: ustawienia organizatora (get/save z regula „brak klucza =
-- bez zmian"), publiczne flagi `event_participant_options`, dziennik doreczen
-- z UNIKALNYM kluczem, rozpoznanie aktora zgloszenia, jezyk odbiorcy,
-- sprzatanie po utracie biletu i pomocnikow czasu. Kazda asercja ma
-- KONTRAPUNKT (inny najemca, inny uzytkownik, anonim, redaktor), bo bramka,
-- ktora przepuszcza wszystko, i bramka, ktora odbija wszystko, przechodza
-- polowe testow tak samo.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * zachowania bramki preferencji powiadomien (`event` tlumione, `billing`
--     doreczane, 'canceled' odrzucone) - to wylacznie pgTAP na prawdziwej
--     funkcji z `20260926100200`; tutaj stoi atrapa i sprawdzamy jej TOZSAMOSC;
--   * RPC torow A/B/C (pliki 15_-19_, 27_-34_, 91_-94_);
--   * D0 (`event_my_agenda`, zwrot w `payments_apply_event_ticket_outcome`) -
--     plik 14_.
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 13 fundament uczestnika: ustawienia, dziennik doreczen, aktor, jezyk =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA
--   najemca A = 13131313-...-131313131313, najemca B = 13131313-...-13131313131b
--   EA1 opublikowane (Warszawa, bez ends_at), EA2 szkic, EA3 opublikowane
--   z BLEDNA strefa `Mars/Base` i z ends_at, EB1 opublikowane u najemcy B.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('13131313-1313-1313-1313-131313131313', 'Tenant 13A', 't13a'),
  ('13131313-1313-1313-1313-13131313131b', 'Tenant 13B', 't13b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('13000000-0000-0000-0000-0000000000a1', 'admin.13a@example.org'),
  ('13000000-0000-0000-0000-0000000000e1', 'editor.13a@example.org'),
  ('13000000-0000-0000-0000-0000000000b1', 'admin.13b@example.org'),
  ('13000000-0000-0000-0000-000000000001', 'holder.13@example.org'),
  ('13000000-0000-0000-0000-000000000002', 'registrant.13@example.org'),
  ('13000000-0000-0000-0000-000000000003', 'payer.13@example.org'),
  ('13000000-0000-0000-0000-000000000004', 'waiter.13@example.org'),
  ('13000000-0000-0000-0000-000000000005', 'rsvp.13@example.org'),
  ('13000000-0000-0000-0000-000000000006', 'prof.13@example.org'),
  ('13000000-0000-0000-0000-000000000007', 'prof.other.13@example.org'),
  ('13000000-0000-0000-0000-000000000008', 'prof.lang.13@example.org'),
  ('13000000-0000-0000-0000-0000000000f1', 'super.13@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, prefs) VALUES
  ('13000000-0000-0000-0000-0000000000a1', '13131313-1313-1313-1313-131313131313', 'Admin 13A', '{}'),
  ('13000000-0000-0000-0000-0000000000e1', '13131313-1313-1313-1313-131313131313', 'Editor 13A', '{}'),
  ('13000000-0000-0000-0000-0000000000b1', '13131313-1313-1313-1313-13131313131b', 'Admin 13B', '{}'),
  ('13000000-0000-0000-0000-000000000006', '13131313-1313-1313-1313-131313131313', 'Prof EN', '{"language":"en"}'),
  -- profil w INNYM najemcy: jezyk z niego NIE moze trafic do zgloszenia najemcy A
  ('13000000-0000-0000-0000-000000000007', '13131313-1313-1313-1313-13131313131b', 'Prof B', '{"language":"en"}'),
  ('13000000-0000-0000-0000-000000000008', '13131313-1313-1313-1313-131313131313', 'Prof lang', '{"lang":"EN"}'),
  ('13000000-0000-0000-0000-0000000000f1', '13131313-1313-1313-1313-131313131313', 'Super 13A', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('13000000-0000-0000-0000-0000000000a1', 'admin'),
  ('13000000-0000-0000-0000-0000000000e1', 'editor'),
  ('13000000-0000-0000-0000-0000000000b1', 'admin')
ON CONFLICT DO NOTHING;
-- super administrator BEZ roli admin: galaz `OR is_super_admin(...)` polityk
-- i bramki panelu (A.6: admin zawsze w parze z super adminem).
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('13000000-0000-0000-0000-0000000000f1', 'super_admin', '13131313-1313-1313-1313-131313131313')
ON CONFLICT DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status,
   registration_mode, registration_flow)
VALUES
  ('13100000-0000-0000-0000-000000000001', '13131313-1313-1313-1313-131313131313',
   'fnd-pub', 'Fundament A', 'Foundation A', '2030-06-10 08:00+00', NULL, 'Europe/Warsaw',
   'published', 'form', 'instant'),
  ('13100000-0000-0000-0000-000000000002', '13131313-1313-1313-1313-131313131313',
   'fnd-draft', 'Szkic A', 'Draft A', '2030-06-11 08:00+00', NULL, 'Europe/Warsaw',
   'draft', 'form', 'instant'),
  ('13100000-0000-0000-0000-000000000003', '13131313-1313-1313-1313-131313131313',
   'fnd-mars', 'Mars A', 'Mars A', '2030-06-12 08:00+00', '2030-06-12 18:00+00', 'Mars/Base',
   'published', 'form', 'instant'),
  ('13100000-0000-0000-0000-00000000000b', '13131313-1313-1313-1313-13131313131b',
   'fnd-pub-b', 'Fundament B', 'Foundation B', '2030-06-10 08:00+00', NULL, 'Europe/Warsaw',
   'published', 'form', 'instant');

INSERT INTO public.event_sessions
  (id, tenant_id, event_id, title_pl, title_en, starts_at, ends_at, status, requires_signup, capacity)
VALUES
  ('13200000-0000-0000-0000-000000000001', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000001', 'Sesja jeden', 'Session one',
   '2030-06-10 09:00+00', '2030-06-10 10:00+00', 'published', true, 1),
  ('13200000-0000-0000-0000-000000000002', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000001', 'Sesja dwa', 'Session two',
   '2030-06-10 11:00+00', '2030-06-10 12:00+00', 'published', true, 1),
  ('13200000-0000-0000-0000-000000000003', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000002', 'Sesja szkicu', 'Draft session',
   '2030-06-11 09:00+00', '2030-06-11 10:00+00', 'published', true, NULL),
  -- S4: zapis posiadacza BEZ kolejki (galaz: odwolany zapis, nikogo do awansu)
  ('13200000-0000-0000-0000-000000000004', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000001', 'Sesja cztery', 'Session four',
   '2030-06-10 13:00+00', '2030-06-10 14:00+00', 'published', true, 5);

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('13300000-0000-0000-0000-000000000001', '13131313-1313-1313-1313-131313131313',
   '13000000-0000-0000-0000-000000000001', 'holder.13@example.org', 'Hania', 'Posiadaczka'),
  ('13300000-0000-0000-0000-000000000002', '13131313-1313-1313-1313-131313131313',
   NULL, 'nl.guest.13@example.org', 'Nela', 'Newsletter'),
  ('13300000-0000-0000-0000-000000000003', '13131313-1313-1313-1313-131313131313',
   '13000000-0000-0000-0000-000000000006', 'prof.13@example.org', 'Piotr', 'Profil'),
  ('13300000-0000-0000-0000-000000000004', '13131313-1313-1313-1313-131313131313',
   '13000000-0000-0000-0000-000000000007', 'prof.other.13@example.org', 'Olga', 'Obca'),
  ('13300000-0000-0000-0000-000000000005', '13131313-1313-1313-1313-131313131313',
   NULL, 'guest.13@example.org', 'Gosia', 'Gosc'),
  ('13300000-0000-0000-0000-000000000006', '13131313-1313-1313-1313-131313131313',
   NULL, 'lead.13@example.org', 'Leon', 'Prowadzacy'),
  ('13300000-0000-0000-0000-000000000007', '13131313-1313-1313-1313-131313131313',
   NULL, 'plain.13@example.org', 'Paula', 'Zwykla'),
  ('13300000-0000-0000-0000-000000000008', '13131313-1313-1313-1313-131313131313',
   '13000000-0000-0000-0000-000000000005', 'rsvp.13@example.org', 'Rafal', 'Rezerwacja'),
  ('13300000-0000-0000-0000-000000000009', '13131313-1313-1313-1313-131313131313',
   '13000000-0000-0000-0000-000000000008', 'prof.lang.13@example.org', 'Lena', 'Lang');

INSERT INTO public.newsletter_subscribers (tenant_id, email, language) VALUES
  ('13131313-1313-1313-1313-131313131313', 'NL.Guest.13@example.org', 'en'),
  -- ten sam adres u najemcy B: jezyk z obcego najemcy nie przecieka
  ('13131313-1313-1313-1313-13131313131b', 'plain.13@example.org', 'en');

INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata) VALUES
  ('13400000-0000-0000-0000-000000000001', '13131313-1313-1313-1313-131313131313',
   '13000000-0000-0000-0000-000000000003', 'paid', 10000, 'PLN', '{}');

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, created_by,
   payment_status, payment_order_id, paid_at, manage_token_hash, lang, group_lead_registration_id,
   decided_at, decision_source)
VALUES
  -- R1: posiadacz U1, zglaszajacy U2, platnik U3, klucz samoobslugi
  ('13500000-0000-0000-0000-000000000001', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000001', 'approved', 'form',
   '13000000-0000-0000-0000-000000000002', 'paid', '13400000-0000-0000-0000-000000000001', now(),
   encode(digest('tok13-holder-abcdefghijklmnopqrstuv', 'sha256'), 'hex'), NULL, NULL,
   now(), 'system'),
  -- R_nl: gosc bez konta, jezyk z newslettera (adres rozna wielkoscia liter)
  ('13500000-0000-0000-0000-000000000002', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000002', 'approved', 'form',
   NULL, 'not_required', NULL, NULL, NULL, NULL, NULL, now(), 'system'),
  -- R_prof: konto z profilem prefs.language = en
  ('13500000-0000-0000-0000-000000000003', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000003', 'approved', 'form',
   NULL, 'not_required', NULL, NULL, NULL, NULL, NULL, now(), 'system'),
  -- R_other: profil konta jest w najemcy B - nie liczy sie
  ('13500000-0000-0000-0000-000000000004', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000004', 'approved', 'form',
   NULL, 'not_required', NULL, NULL, NULL, NULL, NULL, now(), 'system'),
  -- R_lead: prowadzacy grupy z jezykiem w KOLUMNIE
  ('13500000-0000-0000-0000-000000000006', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000006', 'approved', 'form',
   NULL, 'not_required', NULL, NULL, NULL, 'en', NULL, now(), 'system'),
  -- R_plain: nic nie wiadomo -> pl
  ('13500000-0000-0000-0000-000000000007', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000007', 'approved', 'form',
   NULL, 'not_required', NULL, NULL, NULL, NULL, NULL, now(), 'system'),
  -- R_rsvp_old (odwolane) i R_rsvp (aktywne) tej samej osoby U5
  ('13500000-0000-0000-0000-000000000008', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000003', '13300000-0000-0000-0000-000000000008', 'approved', 'form',
   NULL, 'not_required', NULL, NULL, NULL, NULL, NULL, now(), 'system'),
  -- R_lang: profil z kluczem prefs.lang = EN (wielkie litery)
  ('13500000-0000-0000-0000-000000000009', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000003', '13300000-0000-0000-0000-000000000009', 'approved', 'form',
   NULL, 'not_required', NULL, NULL, NULL, NULL, NULL, now(), 'system');

-- R_guest: gosc grupy R_lead bez profilu i bez newslettera -> jezyk prowadzacego
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status,
   group_lead_registration_id, decided_at, decision_source)
VALUES
  ('13500000-0000-0000-0000-000000000005', '13131313-1313-1313-1313-131313131313',
   '13100000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000005', 'approved', 'form',
   'not_required', '13500000-0000-0000-0000-000000000006', now(), 'system');

CREATE FUNCTION pg_temp.t13_claim(p_key text, p_channel text DEFAULT 'email',
  p_event uuid DEFAULT '13100000-0000-0000-0000-000000000001',
  p_kind text DEFAULT 'event_reminder') RETURNS uuid
LANGUAGE sql AS $$
  SELECT public._event_delivery_claim(jsonb_build_object(
    'tenant_id', '13131313-1313-1313-1313-131313131313', 'event_id', p_event,
    'kind', p_kind, 'channel', p_channel, 'dedupe_key', p_key))
$$;

-- ---------------------------------------------------------------------------
-- 1. Pomocnicy czasu
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(public._event_safe_timezone('Mars/Base') = 'Europe/Warsaw',
  '13/czas: _event_safe_timezone(Mars/Base) -> Europe/Warsaw');
SELECT pg_temp.assert(public._event_safe_timezone(NULL) = 'Europe/Warsaw'
    AND public._event_safe_timezone('  ') = 'Europe/Warsaw',
  '13/czas: _event_safe_timezone(NULL/pusta) -> Europe/Warsaw');
SELECT pg_temp.assert(public._event_safe_timezone('America/New_York') = 'America/New_York',
  '13/czas: _event_safe_timezone zachowuje poprawna strefe (kontrapunkt)');

SELECT pg_temp.assert(
  public._event_effective_end('2030-06-10 08:00+00', NULL) = '2030-06-11 08:00+00'::timestamptz,
  '13/czas: _event_effective_end bez ends_at = starts_at + 24 h');
SELECT pg_temp.assert(
  public._event_effective_end('2030-06-10 08:00+00', '2030-06-10 12:00+00') = '2030-06-10 12:00+00'::timestamptz,
  '13/czas: _event_effective_end z ends_at = ends_at');

-- 23:30 w Warszawie (lato, UTC+2) = 21:30 UTC; 12:00 = 10:00 UTC.
SELECT pg_temp.assert(public._event_local_quiet('Europe/Warsaw', '2030-06-10 21:30+00') IS TRUE,
  '13/czas: _event_local_quiet 23:30 Warszawa = cisza');
SELECT pg_temp.assert(public._event_local_quiet('Europe/Warsaw', '2030-06-10 10:00+00') IS FALSE,
  '13/czas: _event_local_quiet 12:00 Warszawa = dzien');
SELECT pg_temp.assert(public._event_local_quiet('Europe/Warsaw', '2030-06-10 04:59+00') IS TRUE
    AND public._event_local_quiet('Europe/Warsaw', '2030-06-10 05:00+00') IS FALSE,
  '13/czas: _event_local_quiet granica 07:00 (06:59 cisza, 07:00 dzien)');
SELECT pg_temp.assert(public._event_local_quiet('Mars/Base', '2030-06-10 21:30+00') IS TRUE,
  '13/czas: _event_local_quiet z bledna strefa liczy w Europe/Warsaw');

-- ---------------------------------------------------------------------------
-- 2. Kolumny zgloszenia: CHECK-i jezyka i zgody SMS
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  $$UPDATE public.event_registrations SET remind_sms = true
     WHERE id = '13500000-0000-0000-0000-000000000007'$$,
  'event_registrations_remind_sms_consented',
  '13/kolumny: remind_sms bez stempla zgody lamie event_registrations_remind_sms_consented');
SELECT pg_temp.assert_raises_like(
  $$UPDATE public.event_registrations SET remind_sms_consent_via = 'email'
     WHERE id = '13500000-0000-0000-0000-000000000007'$$,
  'event_registrations_remind_sms_consent_via_values',
  '13/kolumny: remind_sms_consent_via spoza account|token odrzucone');
SELECT pg_temp.assert_raises_like(
  $$UPDATE public.event_registrations SET lang = 'de' WHERE id = '13500000-0000-0000-0000-000000000007'$$,
  'event_registrations_lang_values',
  '13/kolumny: lang spoza pl|en odrzucony');
DO $$
BEGIN
  UPDATE public.event_registrations
     SET remind_sms = true, remind_sms_consent_at = now(), remind_sms_consent_via = 'account'
   WHERE id = '13500000-0000-0000-0000-000000000007';
  PERFORM pg_temp.assert(
    (SELECT remind_sms AND remind_email AND remind_push AND remind_sessions AND lang IS NULL
       FROM public.event_registrations WHERE id = '13500000-0000-0000-0000-000000000007'),
    '13/kolumny: remind_sms ze stemplem przechodzi; domyslne remind_* = true, lang = NULL (R-1)');
  UPDATE public.event_registrations
     SET remind_sms = false, remind_sms_consent_at = NULL, remind_sms_consent_via = NULL
   WHERE id = '13500000-0000-0000-0000-000000000007';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Jezyk odbiorcy: kazdy krok kaskady _event_registration_lang
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(public._event_registration_lang('13131313-1313-1313-1313-131313131313',
    '13500000-0000-0000-0000-000000000006') = 'en',
  '13/jezyk: krok 1 - kolumna r.lang');
SELECT pg_temp.assert(public._event_registration_lang('13131313-1313-1313-1313-131313131313',
    '13500000-0000-0000-0000-000000000003') = 'en',
  '13/jezyk: krok 2 - profiles.prefs language');
SELECT pg_temp.assert(public._event_registration_lang('13131313-1313-1313-1313-131313131313',
    '13500000-0000-0000-0000-000000000009') = 'en',
  '13/jezyk: krok 2b - profiles.prefs lang (wielkie litery)');
SELECT pg_temp.assert(public._event_registration_lang('13131313-1313-1313-1313-131313131313',
    '13500000-0000-0000-0000-000000000004') = 'pl',
  '13/jezyk: profil konta w OBCYM najemcy nie liczy sie (kontrapunkt kroku 2)');
SELECT pg_temp.assert(public._event_registration_lang('13131313-1313-1313-1313-131313131313',
    '13500000-0000-0000-0000-000000000002') = 'en',
  '13/jezyk: krok 3 - newsletter po adresie bez wzgledu na wielkosc liter');
SELECT pg_temp.assert(public._event_registration_lang('13131313-1313-1313-1313-131313131313',
    '13500000-0000-0000-0000-000000000005') = 'en',
  '13/jezyk: krok 4 - lang prowadzacego grupy');
SELECT pg_temp.assert(public._event_registration_lang('13131313-1313-1313-1313-131313131313',
    '13500000-0000-0000-0000-000000000007') = 'pl',
  '13/jezyk: krok 5 - domyslnie pl (newsletter obcego najemcy nie przecieka)');
SELECT pg_temp.assert(public._event_registration_lang('13131313-1313-1313-1313-13131313131b',
    '13500000-0000-0000-0000-000000000006') = 'pl'
  AND public._event_registration_lang('13131313-1313-1313-1313-131313131313',
    '13599999-0000-0000-0000-000000000000') = 'pl',
  '13/jezyk: nieznane / obce zgloszenie -> pl');

-- ---------------------------------------------------------------------------
-- 4. Aktor zgloszenia: _event_registration_actor
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a constant uuid := '13131313-1313-1313-1313-131313131313';
  b constant uuid := '13131313-1313-1313-1313-13131313131b';
  r1 constant uuid := '13500000-0000-0000-0000-000000000001';
  v jsonb;
BEGIN
  v := public._event_registration_actor(a, r1, '13000000-0000-0000-0000-000000000001', NULL);
  PERFORM pg_temp.assert(
    (v->>'exists')::boolean AND (v->>'is_holder')::boolean AND NOT (v->>'via_token')::boolean
    AND NOT (v->>'is_registrant')::boolean AND NOT (v->>'is_payer')::boolean
    AND v->>'holder_user_id' = '13000000-0000-0000-0000-000000000001'
    AND v->>'payer_user_id' = '13000000-0000-0000-0000-000000000003'
    AND v->>'payment_order_id' = '13400000-0000-0000-0000-000000000001'
    AND v->>'event_id' = '13100000-0000-0000-0000-000000000001'
    AND v->>'status' = 'approved' AND v->>'payment_status' = 'paid'
    AND NOT (v->>'is_group')::boolean,
    '13/aktor: posiadacz po koncie (is_holder, bez tokenu, nie platnik, nie zglaszajacy)');

  v := public._event_registration_actor(a, r1, '13000000-0000-0000-0000-000000000002', NULL);
  PERFORM pg_temp.assert((v->>'is_registrant')::boolean AND NOT (v->>'is_holder')::boolean
      AND NOT (v->>'is_payer')::boolean,
    '13/aktor: zglaszajacy (created_by) - is_registrant bez is_holder');

  v := public._event_registration_actor(a, r1, '13000000-0000-0000-0000-000000000003', NULL);
  PERFORM pg_temp.assert((v->>'is_payer')::boolean AND NOT (v->>'is_holder')::boolean
      AND NOT (v->>'is_registrant')::boolean,
    '13/aktor: platnik (payment_orders.user_id) - is_payer');

  v := public._event_registration_actor(a, r1, '13000000-0000-0000-0000-000000000004', NULL);
  PERFORM pg_temp.assert((v->>'exists')::boolean AND NOT (v->>'is_holder')::boolean
      AND NOT (v->>'is_registrant')::boolean AND NOT (v->>'is_payer')::boolean,
    '13/aktor: obcy uzytkownik - zgloszenie istnieje, zadnej roli (kontrapunkt)');

  v := public._event_registration_actor(a, NULL, NULL, 'tok13-holder-abcdefghijklmnopqrstuv');
  PERFORM pg_temp.assert((v->>'exists')::boolean AND (v->>'via_token')::boolean
      AND (v->>'is_holder')::boolean AND v->>'registration_id' = r1::text,
    '13/aktor: posiadacz po kluczu samoobslugi (via_token)');

  v := public._event_registration_actor(a, r1, NULL, '  tok13-holder-abcdefghijklmnopqrstuv  ');
  PERFORM pg_temp.assert((v->>'via_token')::boolean AND (v->>'is_holder')::boolean
      AND NOT (v->>'is_registrant')::boolean AND NOT (v->>'is_payer')::boolean,
    '13/aktor: znane id + wlasciwy klucz (z bialymi znakami) -> via_token i is_holder');

  v := public._event_registration_actor(a, r1, NULL, 'tok13-zly-klucz');
  PERFORM pg_temp.assert((v->>'exists')::boolean AND NOT (v->>'via_token')::boolean
      AND NOT (v->>'is_holder')::boolean,
    '13/aktor: zly klucz przy znanym id nie daje roli posiadacza');

  PERFORM pg_temp.assert(
    public._event_registration_actor(b, r1, '13000000-0000-0000-0000-000000000001', NULL)->>'exists' = 'false'
    AND public._event_registration_actor(b, NULL, NULL, 'tok13-holder-abcdefghijklmnopqrstuv')->>'exists' = 'false',
    '13/aktor: obcy najemca -> exists:false (po id i po kluczu)');
  PERFORM pg_temp.assert(
    public._event_registration_actor(NULL, r1, NULL, NULL)->>'exists' = 'false'
    AND public._event_registration_actor(a, NULL, '13000000-0000-0000-0000-000000000001', NULL)->>'exists' = 'false'
    AND public._event_registration_actor(a, NULL, NULL, '   ')->>'exists' = 'false',
    '13/aktor: brak najemcy / brak id i klucza / pusty klucz -> exists:false');

  PERFORM pg_temp.assert(
    (public._event_registration_actor(a, '13500000-0000-0000-0000-000000000006', NULL, NULL)->>'is_group')::boolean
    AND (public._event_registration_actor(a, '13500000-0000-0000-0000-000000000005', NULL, NULL)->>'is_group')::boolean,
    '13/aktor: is_group dla prowadzacego i dla goscia grupy');
END $$;

-- ---------------------------------------------------------------------------
-- 5. Ustawienia: domyslne bez wiersza, zapis z regula „brak klucza = bez zmian"
-- ---------------------------------------------------------------------------
SAVEPOINT t13_defaults;
INSERT INTO public.event_participant_settings (tenant_id, event_id)
VALUES ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000002');
SELECT pg_temp.assert(
  (SELECT to_jsonb(s) - ARRAY['id', 'event_id', 'created_at', 'updated_at', 'updated_by']
     FROM public.event_participant_settings s
    WHERE s.event_id = '13100000-0000-0000-0000-000000000002')
  = (to_jsonb(public._event_participant_settings_effective(
        '13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001'))
     - ARRAY['id', 'event_id', 'created_at', 'updated_at', 'updated_by']),
  '13/ustawienia: domyslne bez wiersza = DEFAULT-y kolumn (_event_participant_settings_effective)');
ROLLBACK TO SAVEPOINT t13_defaults;

SELECT pg_temp.act_as('13000000-0000-0000-0000-0000000000a1', '13131313-1313-1313-1313-131313131313');

DO $$
DECLARE v jsonb;
BEGIN
  v := public.admin_event_participant_settings_get('13100000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert(
    NOT (v->>'has_row')::boolean AND v->>'id' IS NULL AND v->>'updated_at' IS NULL
    AND v->>'event_id' = '13100000-0000-0000-0000-000000000001'
    AND (v->>'calendar_export_enabled')::boolean AND (v->>'reminders_enabled')::boolean
    AND v->'reminder_event_leads_minutes' = '[1440, 60]'::jsonb
    AND (v->>'session_reminder_lead_minutes')::int = 15 AND NOT (v->>'reminder_sms_enabled')::boolean
    AND (v->>'transfer_enabled')::boolean AND (v->>'transfer_deadline_hours')::int = 24
    AND v->>'refund_mode' = 'policy' AND (v->>'refund_deadline_hours')::int = 168
    AND (v->>'waitlist_offer_hours')::int = 24 AND NOT (v->>'certificate_enabled')::boolean
    AND v->>'certificate_eligibility' = 'attended' AND NOT (v->>'survey_enabled')::boolean
    AND (v->>'survey_anonymous')::boolean AND (v->>'survey_close_after_days')::int = 14
    AND (v->>'survey_min_results')::int = 5 AND (v->>'survey_invite_enabled')::boolean
    AND NOT (v->>'has_session_checkpoints')::boolean,
    '13/ustawienia: admin_event_participant_settings_get bez wiersza zwraca domyslne (has_row=false)');

  INSERT INTO public.event_checkpoints (tenant_id, event_id, name_pl, name_en, kind, session_id)
  VALUES ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
          'Wejscie S1', 'Entry S1', 'session', '13200000-0000-0000-0000-000000000001');
  v := public.admin_event_participant_settings_get('13100000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert((v->>'has_session_checkpoints')::boolean,
    '13/ustawienia: has_session_checkpoints po dodaniu punktu kind=session');

  v := public.admin_event_participant_settings_save(jsonb_build_object(
    'event_id', '13100000-0000-0000-0000-000000000001', 'refund_mode', 'none'));
  PERFORM pg_temp.assert((v->>'has_row')::boolean AND v->>'refund_mode' = 'none'
      AND (v->>'transfer_enabled')::boolean AND v->>'updated_at' IS NOT NULL
      AND v->>'updated_by' = '13000000-0000-0000-0000-0000000000a1',
    '13/ustawienia: pierwszy zapis tworzy wiersz z podanym kluczem, reszta domyslna');

  v := public.admin_event_participant_settings_save(jsonb_build_object(
    'event_id', '13100000-0000-0000-0000-000000000001', 'transfer_enabled', false,
    'unknown_key', 'ignored'));
  PERFORM pg_temp.assert(v->>'refund_mode' = 'none' AND NOT (v->>'transfer_enabled')::boolean,
    '13/ustawienia: brak klucza = bez zmian (refund_mode zostaje none po zapisie transfer_enabled)');

  PERFORM pg_temp.assert(EXISTS (
    SELECT 1 FROM public.domain_events d
     WHERE d.event_type = 'event.participant_settings.updated.v1'
       AND d.aggregate_type = 'event_participant_settings'
       AND d.aggregate_id = '13100000-0000-0000-0000-000000000001'
       AND d.payload->'keys' = '["transfer_enabled"]'::jsonb
       AND d.payload->>'event_id' = '13100000-0000-0000-0000-000000000001'
       AND d.actor_id = '13000000-0000-0000-0000-0000000000a1'),
    '13/ustawienia: zapis emituje event.participant_settings.updated.v1 {event_id, keys} z aktorem');

  -- wszystkie typy wartosci naraz
  v := public.admin_event_participant_settings_save(jsonb_build_object(
    'event_id', '13100000-0000-0000-0000-000000000001',
    'calendar_export_enabled', false, 'reminders_enabled', false, 'session_reminders_enabled', false,
    'reminder_sms_enabled', true, 'certificate_enabled', true, 'certificate_require_survey', true,
    'survey_enabled', true, 'survey_anonymous', false, 'survey_invite_enabled', false,
    'reminder_event_leads_minutes', jsonb_build_array(60, 1440, 60, 15),
    'session_reminder_lead_minutes', 30, 'transfer_deadline_hours', 0, 'refund_deadline_hours', 2160,
    'waitlist_offer_hours', 168, 'certificate_eligibility', 'sessions_min', 'certificate_min_sessions', 3,
    'certificate_hours', 1.5, 'certificate_issuer_name', '  NES Institute  ',
    'certificate_signatory_name', 'Jan Kowalski', 'certificate_signatory_title_pl', 'Prezes',
    'certificate_signatory_title_en', 'President', 'certificate_body_pl', 'Tresc', 'certificate_body_en', '   ',
    'survey_intro_pl', 'Wstep', 'survey_intro_en', NULL,
    'survey_close_after_days', 90, 'survey_min_results', 50));
  PERFORM pg_temp.assert(
    NOT (v->>'calendar_export_enabled')::boolean AND NOT (v->>'reminders_enabled')::boolean
    AND NOT (v->>'session_reminders_enabled')::boolean AND (v->>'reminder_sms_enabled')::boolean
    AND (v->>'certificate_enabled')::boolean AND (v->>'certificate_require_survey')::boolean
    AND (v->>'survey_enabled')::boolean AND NOT (v->>'survey_anonymous')::boolean
    AND NOT (v->>'survey_invite_enabled')::boolean
    AND v->'reminder_event_leads_minutes' = '[1440, 60, 15]'::jsonb
    AND (v->>'session_reminder_lead_minutes')::int = 30 AND (v->>'transfer_deadline_hours')::int = 0
    AND (v->>'refund_deadline_hours')::int = 2160 AND (v->>'waitlist_offer_hours')::int = 168
    AND v->>'certificate_eligibility' = 'sessions_min' AND (v->>'certificate_min_sessions')::int = 3
    AND (v->>'certificate_hours')::numeric = 1.50
    AND v->>'certificate_issuer_name' = 'NES Institute'
    AND v->>'certificate_signatory_name' = 'Jan Kowalski'
    AND v->>'certificate_signatory_title_pl' = 'Prezes' AND v->>'certificate_signatory_title_en' = 'President'
    AND v->>'certificate_body_pl' = 'Tresc' AND v->>'certificate_body_en' IS NULL
    AND v->>'survey_intro_pl' = 'Wstep' AND v->>'survey_intro_en' IS NULL
    AND (v->>'survey_close_after_days')::int = 90 AND (v->>'survey_min_results')::int = 50
    AND v->>'refund_mode' = 'none',
    '13/ustawienia: zapis kazdego klucza (leady posortowane malejaco bez duplikatow, tekst przyciety, pusty = NULL)');

  -- sessions_min z juz zapisanym progiem: sama zmiana trybu przechodzi (regula na WIERSZU WYNIKOWYM)
  v := public.admin_event_participant_settings_save(jsonb_build_object(
    'event_id', '13100000-0000-0000-0000-000000000001', 'certificate_eligibility', 'attended'));
  v := public.admin_event_participant_settings_save(jsonb_build_object(
    'event_id', '13100000-0000-0000-0000-000000000001', 'certificate_eligibility', 'sessions_min'));
  PERFORM pg_temp.assert(v->>'certificate_eligibility' = 'sessions_min' AND (v->>'certificate_min_sessions')::int = 3,
    '13/ustawienia: sessions_min przy zapisanym progu przechodzi (regula liczona na wierszu wynikowym)');

  v := public.admin_event_participant_settings_save(jsonb_build_object(
    'event_id', '13100000-0000-0000-0000-000000000001', 'certificate_eligibility', 'confirmed',
    'certificate_min_sessions', NULL, 'certificate_hours', NULL, 'reminder_event_leads_minutes', '[]'::jsonb));
  PERFORM pg_temp.assert(v->>'certificate_min_sessions' IS NULL AND v->>'certificate_hours' IS NULL
      AND v->'reminder_event_leads_minutes' = '[]'::jsonb,
    '13/ustawienia: null czysci prog sesji i godziny; pusta lista leadow dozwolona');

  -- sam event_id: nic sie nie zapisuje (brak wiersza zostaje brakiem wiersza)
  v := public.admin_event_participant_settings_save(jsonb_build_object(
    'event_id', '13100000-0000-0000-0000-000000000002'));
  PERFORM pg_temp.assert(NOT (v->>'has_row')::boolean
      AND NOT EXISTS (SELECT 1 FROM public.event_participant_settings s
                       WHERE s.event_id = '13100000-0000-0000-0000-000000000002'),
    '13/ustawienia: zapis bez znanych kluczy nie tworzy wiersza');
END $$;

-- ── Kazdy kod invalid_* (assert_raises_like) ────────────────────────────────
SELECT pg_temp.assert_raises_like($$SELECT public.admin_event_participant_settings_save('[]'::jsonb)$$,
  'invalid_request', '13/ustawienia: invalid_request - ladunek nie jest obiektem');
SELECT pg_temp.assert_raises_like($$SELECT public.admin_event_participant_settings_save('{}'::jsonb)$$,
  'invalid_request: event_id is required', '13/ustawienia: invalid_request - brak event_id');
SELECT pg_temp.assert_raises_like($$SELECT public.admin_event_participant_settings_save('{"event_id":"zle"}'::jsonb)$$,
  'invalid_request: event_id is required', '13/ustawienia: invalid_request - event_id o zlym ksztalcie');
SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_participant_settings_save('{"event_id":"13100000-0000-0000-0000-000000000099","refund_mode":"none"}'::jsonb)$$,
  'not_found', '13/ustawienia: not_found - nieznane wydarzenie (save)');
SELECT pg_temp.assert_raises_like($$SELECT public.admin_event_participant_settings_get(NULL)$$,
  'not_found', '13/ustawienia: not_found - get(NULL)');

CREATE FUNCTION pg_temp.t13_save(p jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.admin_event_participant_settings_save(
    p || '{"event_id":"13100000-0000-0000-0000-000000000001"}'::jsonb)
$$;

SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"calendar_export_enabled":"yes"}')$$,
  'invalid_boolean: calendar_export_enabled', '13/ustawienia: invalid_boolean (napis zamiast boolean)');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"survey_invite_enabled":1}')$$,
  'invalid_boolean: survey_invite_enabled', '13/ustawienia: invalid_boolean (liczba zamiast boolean)');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"reminder_event_leads_minutes":60}')$$,
  'invalid_reminder_leads', '13/ustawienia: invalid_reminder_leads - nie tablica');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"reminder_event_leads_minutes":["60"]}')$$,
  'invalid_reminder_leads', '13/ustawienia: invalid_reminder_leads - element nie jest liczba');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"reminder_event_leads_minutes":[10]}')$$,
  'invalid_reminder_leads', '13/ustawienia: invalid_reminder_leads - ponizej 15 minut');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"reminder_event_leads_minutes":[60.5]}')$$,
  'invalid_reminder_leads', '13/ustawienia: invalid_reminder_leads - nie calkowita');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"reminder_event_leads_minutes":[10081]}')$$,
  'invalid_reminder_leads', '13/ustawienia: invalid_reminder_leads - powyzej 10080');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"reminder_event_leads_minutes":[15,30,60,120,240]}')$$,
  'invalid_reminder_leads', '13/ustawienia: invalid_reminder_leads - piec roznych wartosci');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"session_reminder_lead_minutes":"15"}')$$,
  'invalid_session_lead', '13/ustawienia: invalid_session_lead - napis');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"session_reminder_lead_minutes":4}')$$,
  'invalid_session_lead', '13/ustawienia: invalid_session_lead - ponizej 5');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"session_reminder_lead_minutes":15.5}')$$,
  'invalid_session_lead', '13/ustawienia: invalid_session_lead - nie calkowita');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"transfer_deadline_hours":true}')$$,
  'invalid_transfer_deadline', '13/ustawienia: invalid_transfer_deadline - boolean');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"transfer_deadline_hours":721}')$$,
  'invalid_transfer_deadline', '13/ustawienia: invalid_transfer_deadline - powyzej 720');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"refund_mode":1}')$$,
  'invalid_refund_mode', '13/ustawienia: invalid_refund_mode - liczba');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"refund_mode":"full"}')$$,
  'invalid_refund_mode', '13/ustawienia: invalid_refund_mode - spoza policy|none');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"refund_deadline_hours":"x"}')$$,
  'invalid_refund_deadline', '13/ustawienia: invalid_refund_deadline - napis');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"refund_deadline_hours":2161}')$$,
  'invalid_refund_deadline', '13/ustawienia: invalid_refund_deadline - powyzej 2160');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"waitlist_offer_hours":null}')$$,
  'invalid_offer_hours', '13/ustawienia: invalid_offer_hours - null');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"waitlist_offer_hours":1}')$$,
  'invalid_offer_hours', '13/ustawienia: invalid_offer_hours - ponizej 2');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_eligibility":5}')$$,
  'invalid_certificate_eligibility', '13/ustawienia: invalid_certificate_eligibility - liczba');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_eligibility":"always"}')$$,
  'invalid_certificate_eligibility', '13/ustawienia: invalid_certificate_eligibility - spoza listy');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_min_sessions":"3"}')$$,
  'invalid_certificate_min_sessions', '13/ustawienia: invalid_certificate_min_sessions - napis');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_min_sessions":0}')$$,
  'invalid_certificate_min_sessions', '13/ustawienia: invalid_certificate_min_sessions - ponizej 1');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_min_sessions":101}')$$,
  'invalid_certificate_min_sessions', '13/ustawienia: invalid_certificate_min_sessions - powyzej 100');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_eligibility":"sessions_min"}')$$,
  'invalid_certificate_min_sessions', '13/ustawienia: invalid_certificate_min_sessions - sessions_min bez progu na wierszu wynikowym');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_hours":"2"}')$$,
  'invalid_certificate_hours', '13/ustawienia: invalid_certificate_hours - napis');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_hours":0}')$$,
  'invalid_certificate_hours', '13/ustawienia: invalid_certificate_hours - zero');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_hours":0.001}')$$,
  'invalid_certificate_hours', '13/ustawienia: invalid_certificate_hours - zaokragla sie do zera');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_hours":999.999}')$$,
  'invalid_certificate_hours', '13/ustawienia: invalid_certificate_hours - zaokragla sie powyzej 999');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"certificate_issuer_name":5}')$$,
  'invalid_text_length: certificate_issuer_name', '13/ustawienia: invalid_text_length - nie napis');
SELECT pg_temp.assert_raises_like(
  format($f$SELECT pg_temp.t13_save('{"certificate_issuer_name":"%s"}')$f$, repeat('x', 161)),
  'invalid_text_length: certificate_issuer_name', '13/ustawienia: invalid_text_length - wystawca > 160');
SELECT pg_temp.assert_raises_like(
  format($f$SELECT pg_temp.t13_save('{"certificate_signatory_title_en":"%s"}')$f$, repeat('x', 121)),
  'invalid_text_length: certificate_signatory_title_en', '13/ustawienia: invalid_text_length - tytul > 120');
SELECT pg_temp.assert_raises_like(
  format($f$SELECT pg_temp.t13_save('{"survey_intro_en":"%s"}')$f$, repeat('x', 601)),
  'invalid_text_length: survey_intro_en', '13/ustawienia: invalid_text_length - wstep ankiety > 600');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"survey_close_after_days":"14"}')$$,
  'invalid_survey_close_days', '13/ustawienia: invalid_survey_close_days - napis');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"survey_close_after_days":91}')$$,
  'invalid_survey_close_days', '13/ustawienia: invalid_survey_close_days - powyzej 90');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"survey_min_results":[]}')$$,
  'invalid_survey_min_results', '13/ustawienia: invalid_survey_min_results - tablica');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"survey_min_results":4}')$$,
  'invalid_survey_min_results', '13/ustawienia: invalid_survey_min_results - ponizej k=5');
-- walidacja PRZED zapisem: poprawny klucz obok blednego NIE trafia do bazy
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_save('{"transfer_enabled":true,"survey_min_results":4}')$$,
  'invalid_survey_min_results', '13/ustawienia: blad w jednym kluczu odrzuca caly zapis');
SELECT pg_temp.assert(
  (SELECT NOT transfer_enabled FROM public.event_participant_settings
    WHERE event_id = '13100000-0000-0000-0000-000000000001'),
  '13/ustawienia: po odrzuconym zapisie transfer_enabled zostaje false (kontrapunkt)');

-- ── Kto moze: redaktor i anonim odbici, obcy administrator dostaje not_found ──
SELECT pg_temp.act_as('13000000-0000-0000-0000-0000000000e1', '13131313-1313-1313-1313-131313131313');
SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_participant_settings_get('13100000-0000-0000-0000-000000000001')$$,
  'forbidden', '13/ustawienia: redaktor odbity od get (forbidden)');
SELECT pg_temp.assert_raises_like(
  $$SELECT pg_temp.t13_save('{"refund_mode":"policy"}')$$,
  'forbidden', '13/ustawienia: redaktor odbity od save (forbidden)');
SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_message_delivery_stats('13100000-0000-0000-0000-000000000001')$$,
  'forbidden', '13/statystyki: redaktor odbity (forbidden)');
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_participant_settings_get('13100000-0000-0000-0000-000000000001')$$,
  'forbidden', '13/ustawienia: anonim odbity od get (forbidden)');
SELECT pg_temp.assert_raises_like(
  $$SELECT pg_temp.t13_save('{"refund_mode":"policy"}')$$,
  'forbidden', '13/ustawienia: anonim odbity od save (forbidden)');

SELECT pg_temp.act_as('13000000-0000-0000-0000-0000000000b1', '13131313-1313-1313-1313-13131313131b');
SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_participant_settings_get('13100000-0000-0000-0000-000000000001')$$,
  'not_found', '13/ustawienia: administrator najemcy B -> not_found dla wydarzenia A (get)');
SELECT pg_temp.assert_raises_like(
  $$SELECT pg_temp.t13_save('{"refund_mode":"policy"}')$$,
  'not_found', '13/ustawienia: administrator najemcy B -> not_found dla wydarzenia A (save)');
SELECT pg_temp.assert(
  (public.admin_event_participant_settings_get('13100000-0000-0000-0000-00000000000b')->>'has_row')::boolean = false,
  '13/ustawienia: administrator najemcy B czyta swoje wydarzenie (kontrapunkt)');

-- ---------------------------------------------------------------------------
-- 6. Dziennik doreczen: _event_delivery_claim / _event_delivery_confirm
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
DO $$
DECLARE
  v_id uuid;
  v_again uuid;
  v_in uuid;
  v_row public.event_message_deliveries;
BEGIN
  v_id := public._event_delivery_claim(jsonb_build_object(
    'tenant_id', '13131313-1313-1313-1313-131313131313',
    'event_id', '13100000-0000-0000-0000-000000000001',
    'registration_id', '13500000-0000-0000-0000-000000000001',
    'person_id', '13300000-0000-0000-0000-000000000001',
    'user_id', '13000000-0000-0000-0000-000000000001',
    'session_id', '13200000-0000-0000-0000-000000000001',
    'kind', 'event_reminder', 'channel', 'email', 'lead_minutes', 60,
    'starts_at', '2030-06-10T08:00:00Z', 'dedupe_key', 'er:t13:one:email:60'));
  SELECT * INTO v_row FROM public.event_message_deliveries WHERE id = v_id;
  PERFORM pg_temp.assert(v_id IS NOT NULL AND v_row.status = 'claimed' AND v_row.attempts = 1
      AND v_row.lead_minutes = 60 AND v_row.starts_at_snapshot = '2030-06-10 08:00+00'
      AND v_row.registration_id = '13500000-0000-0000-0000-000000000001'
      AND v_row.session_id = '13200000-0000-0000-0000-000000000001',
    '13/doreczenia: _event_delivery_claim zaklada wiersz claimed z polami opcjonalnymi');

  PERFORM pg_temp.assert(pg_temp.t13_claim('er:t13:one:email:60') IS NULL,
    '13/doreczenia: duplikat klucza w oknie 15 min -> NULL');

  UPDATE public.event_message_deliveries SET claimed_at = now() - interval '16 minutes' WHERE id = v_id;
  v_again := pg_temp.t13_claim('er:t13:one:email:60');
  PERFORM pg_temp.assert(v_again = v_id
      AND (SELECT attempts FROM public.event_message_deliveries WHERE id = v_id) = 2,
    '13/doreczenia: porzucona rezerwacja (16 min) ponownie wzieta, attempts = 2');

  PERFORM pg_temp.assert(public._event_delivery_confirm(v_id, 'failed', 'smtp_timeout'),
    '13/doreczenia: _event_delivery_confirm failed');
  v_again := pg_temp.t13_claim('er:t13:one:email:60');
  PERFORM pg_temp.assert(v_again = v_id
      AND (SELECT attempts FROM public.event_message_deliveries WHERE id = v_id) = 3,
    '13/doreczenia: failed przy attempts < 3 ponownie wziety (attempts = 3)');
  PERFORM public._event_delivery_confirm(v_id, 'failed', 'smtp_timeout');
  PERFORM pg_temp.assert(pg_temp.t13_claim('er:t13:one:email:60') IS NULL,
    '13/doreczenia: failed przy attempts = 3 NIE jest juz brany');

  -- porzucona rezerwacja przy 10 probach nie wywraca CHECK-a attempts
  UPDATE public.event_message_deliveries
     SET status = 'claimed', attempts = 10, claimed_at = now() - interval '1 hour'
   WHERE id = v_id;
  PERFORM pg_temp.assert(pg_temp.t13_claim('er:t13:one:email:60') IS NULL,
    '13/doreczenia: porzucona rezerwacja przy attempts = 10 nie jest brana (CHECK chroniony)');

  -- in-app: nigdy ponownie
  v_in := pg_temp.t13_claim('er:t13:one:inapp:60', 'inapp');
  UPDATE public.event_message_deliveries SET claimed_at = now() - interval '16 minutes' WHERE id = v_in;
  PERFORM pg_temp.assert(v_in IS NOT NULL AND pg_temp.t13_claim('er:t13:one:inapp:60', 'inapp') IS NULL,
    '13/doreczenia: porzucony dzwonek in-app nie jest ponownie brany');
  PERFORM public._event_delivery_confirm(v_in, 'failed', NULL);
  PERFORM pg_temp.assert(pg_temp.t13_claim('er:t13:one:inapp:60', 'inapp') IS NULL,
    '13/doreczenia: nieudany dzwonek in-app nie jest ponownie brany');

  -- potwierdzenia
  v_id := pg_temp.t13_claim('er:t13:two:email:60');
  PERFORM pg_temp.assert(public._event_delivery_confirm(v_id, 'sent'),
    '13/doreczenia: _event_delivery_confirm sent zwraca true');
  PERFORM pg_temp.assert((SELECT status = 'sent' AND sent_at IS NOT NULL AND detail IS NULL
             FROM public.event_message_deliveries WHERE id = v_id),
    '13/doreczenia: _event_delivery_confirm sent stempluje sent_at');
  PERFORM pg_temp.assert(NOT public._event_delivery_confirm(v_id, 'failed', 'late'),
    '13/doreczenia: potwierdzenie dziala tylko na wierszu claimed');
  PERFORM pg_temp.assert(NOT public._event_delivery_confirm('13999999-0000-0000-0000-000000000000', 'sent'),
    '13/doreczenia: nieznane id -> false');
  v_id := pg_temp.t13_claim('er:t13:three:email:60');
  PERFORM pg_temp.assert(public._event_delivery_confirm(v_id, 'skipped', repeat('d', 600)),
    '13/doreczenia: _event_delivery_confirm skipped zwraca true');
  PERFORM pg_temp.assert((SELECT status = 'skipped' AND char_length(detail) = 500 AND sent_at IS NULL
             FROM public.event_message_deliveries WHERE id = v_id),
    '13/doreczenia: skipped z powodem przycietym do 500 znakow');
END $$;

SELECT pg_temp.assert_raises_like($$SELECT public._event_delivery_confirm(gen_random_uuid(), 'done')$$,
  'invalid_status', '13/doreczenia: invalid_status - status spoza listy');
SELECT pg_temp.assert_raises_like($$SELECT public._event_delivery_confirm(gen_random_uuid(), NULL)$$,
  'invalid_status', '13/doreczenia: invalid_status - NULL');
SELECT pg_temp.assert_raises_like($$SELECT public._event_delivery_claim(NULL)$$,
  'invalid_payload', '13/doreczenia: invalid_payload - brak ladunku');
SELECT pg_temp.assert_raises_like($$SELECT public._event_delivery_claim('{"tenant_id":"13131313-1313-1313-1313-131313131313"}')$$,
  'invalid_payload: tenant_id, event_id, kind, channel and dedupe_key are required',
  '13/doreczenia: invalid_payload - brak wymaganych kluczy');
SELECT pg_temp.assert_raises_like(
  $$SELECT public._event_delivery_claim('{"tenant_id":"zle","event_id":"13100000-0000-0000-0000-000000000001","kind":"event_reminder","channel":"email","dedupe_key":"er:t13:bad:1"}')$$,
  'invalid_payload: malformed', '13/doreczenia: invalid_payload - uuid o zlym ksztalcie');
SELECT pg_temp.assert_raises_like(
  $$SELECT public._event_delivery_claim('{"tenant_id":"13131313-1313-1313-1313-131313131313","event_id":"13100000-0000-0000-0000-000000000001","kind":"event_reminder","channel":"email","dedupe_key":"er:t13:bad:2","lead_minutes":"1.5"}')$$,
  'invalid_payload: malformed', '13/doreczenia: invalid_payload - lead_minutes nie calkowite');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_claim('er:t13:bad:3', 'email', '13100000-0000-0000-0000-000000000001', 'party')$$,
  'invalid_payload: unknown kind', '13/doreczenia: invalid_payload - nieznany rodzaj');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_claim('er:t13:bad:4', 'fax')$$,
  'invalid_payload: unknown channel', '13/doreczenia: invalid_payload - nieznany kanal');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_claim('short')$$,
  'invalid_payload: dedupe_key', '13/doreczenia: invalid_payload - klucz krotszy niz 8');
SELECT pg_temp.assert_raises_like(
  $$SELECT public._event_delivery_claim('{"tenant_id":"13131313-1313-1313-1313-131313131313","event_id":"13100000-0000-0000-0000-000000000001","kind":"event_reminder","channel":"email","dedupe_key":"er:t13:bad:5","lead_minutes":-1}')$$,
  'invalid_payload: lead_minutes', '13/doreczenia: invalid_payload - lead_minutes ujemne');
SELECT pg_temp.assert_raises_like($$SELECT pg_temp.t13_claim('er:t13:bad:6', 'email', '13100000-0000-0000-0000-00000000000b')$$,
  'invalid_payload: referenced', '13/doreczenia: invalid_payload - wydarzenie obcego najemcy (klucz zlozony)');

-- ---------------------------------------------------------------------------
-- 7. Statystyki doreczen: tylko wlasne wydarzenie
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.t13_claim('er:t13:draft:email:60', 'email', '13100000-0000-0000-0000-000000000002');
  INSERT INTO public.event_message_deliveries (tenant_id, event_id, kind, channel, dedupe_key, status, sent_at)
  VALUES ('13131313-1313-1313-1313-13131313131b', '13100000-0000-0000-0000-00000000000b',
          'event_reminder', 'email', 'er:t13:tenant-b:1', 'sent', now());
END $$;

SELECT pg_temp.act_as('13000000-0000-0000-0000-0000000000a1', '13131313-1313-1313-1313-131313131313');
DO $$
DECLARE v jsonb;
BEGIN
  v := public.admin_event_message_delivery_stats('13100000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert(
    v->'rows' @> '[{"kind":"event_reminder","channel":"email","claimed":1,"sent":1,"skipped":1,"failed":0}]'::jsonb
    AND v->'rows' @> '[{"kind":"event_reminder","channel":"inapp","claimed":0,"sent":0,"skipped":0,"failed":1}]'::jsonb
    AND jsonb_array_length(v->'rows') = 2 AND v->>'last_sent_at' IS NOT NULL,
    '13/statystyki: admin_event_message_delivery_stats liczy wiersze wlasnego wydarzenia per rodzaj/kanal');
  v := public.admin_event_message_delivery_stats('13100000-0000-0000-0000-00000000000b');
  PERFORM pg_temp.assert(v->'rows' = '[]'::jsonb AND v->>'last_sent_at' IS NULL,
    '13/statystyki: wydarzenie obcego najemcy -> pusto (filtr najemcy)');
  v := public.admin_event_message_delivery_stats('13100000-0000-0000-0000-000000000002');
  PERFORM pg_temp.assert(jsonb_array_length(v->'rows') = 1 AND v->>'last_sent_at' IS NULL,
    '13/statystyki: inne wydarzenie najemcy liczone osobno (kontrapunkt)');
END $$;

-- ---------------------------------------------------------------------------
-- 8. RLS: ustawienia i dziennik tylko dla administratora najemcy
-- ---------------------------------------------------------------------------
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_participant_settings
    WHERE event_id = '13100000-0000-0000-0000-000000000001') = 1
  AND (SELECT count(*) FROM public.event_message_deliveries
    WHERE event_id = '13100000-0000-0000-0000-000000000001') >= 4,
  '13/rls: administrator najemcy A widzi ustawienia i dziennik swojego wydarzenia');
RESET ROLE;

SELECT pg_temp.act_as('13000000-0000-0000-0000-0000000000e1', '13131313-1313-1313-1313-131313131313');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_participant_settings) = 0
  AND (SELECT count(*) FROM public.event_message_deliveries) = 0,
  '13/rls: redaktor nie widzi ustawien ani dziennika');
RESET ROLE;

SELECT pg_temp.act_as('13000000-0000-0000-0000-0000000000b1', '13131313-1313-1313-1313-13131313131b');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_participant_settings
    WHERE tenant_id = '13131313-1313-1313-1313-131313131313') = 0
  AND (SELECT count(*) FROM public.event_message_deliveries
    WHERE tenant_id = '13131313-1313-1313-1313-131313131313') = 0
  AND (SELECT count(*) FROM public.event_message_deliveries
    WHERE tenant_id = '13131313-1313-1313-1313-13131313131b') = 1,
  '13/rls: administrator najemcy B nie widzi wierszy A, widzi swoj (kontrapunkt)');
RESET ROLE;

-- super administrator (bez roli admin) - galaz `OR is_super_admin` polityki i bramki
SELECT pg_temp.act_as('13000000-0000-0000-0000-0000000000f1', '13131313-1313-1313-1313-131313131313');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_participant_settings
    WHERE event_id = '13100000-0000-0000-0000-000000000001') = 1
  AND (SELECT count(*) FROM public.event_message_deliveries
    WHERE event_id = '13100000-0000-0000-0000-000000000001') >= 4
  AND (SELECT count(*) FROM public.event_message_deliveries
    WHERE tenant_id = '13131313-1313-1313-1313-13131313131b') = 0,
  '13/rls: super administrator najemcy A widzi ustawienia i dziennik A, nie widzi B');
RESET ROLE;
SELECT pg_temp.assert(
  public.admin_event_participant_settings_get('13100000-0000-0000-0000-000000000001')->>'refund_mode' = 'none',
  '13/ustawienia: super administrator przechodzi bramke panelu (get)');

SELECT pg_temp.act_as('13000000-0000-0000-0000-0000000000b1', '13131313-1313-1313-1313-13131313131b');
SET ROLE authenticated;
SELECT pg_temp.assert_raises(
  $$INSERT INTO public.event_participant_settings (tenant_id, event_id)
    VALUES ('13131313-1313-1313-1313-13131313131b', '13100000-0000-0000-0000-00000000000b')$$,
  '13/rls: authenticated nie pisze bezposrednio do ustawien (tylko RPC)');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 9. Publiczne event_participant_options (anon, niezalezne od widza)
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', '13131313-1313-1313-1313-131313131313', false);
SET ROLE anon;
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_participant_options('fnd-pub');
  PERFORM pg_temp.assert(
    (v->>'ok')::boolean AND v->>'event_id' = '13100000-0000-0000-0000-000000000001'
    AND v->>'timezone' = 'Europe/Warsaw'
    AND (v->>'starts_at')::timestamptz = '2030-06-10 08:00+00' AND v->>'ends_at' IS NULL
    AND (v->>'effective_end')::timestamptz = '2030-06-11 08:00+00'
    AND NOT (v->>'calendar_export_enabled')::boolean AND NOT (v->>'transfer_enabled')::boolean
    AND (v->>'transfer_deadline_at')::timestamptz = '2030-06-10 08:00+00'
    AND v->>'refund_mode' = 'none' AND (v->>'refund_deadline_hours')::int = 2160
    AND (v->>'waitlist_offer_hours')::int = 168 AND (v->>'certificate_enabled')::boolean
    AND (v->>'survey_enabled')::boolean
    AND v->'reminder_event_leads_minutes' = '[]'::jsonb
    AND (v->>'session_reminder_lead_minutes')::int = 30 AND (v->>'reminder_sms_enabled')::boolean
    AND NOT (v->>'reminders_enabled')::boolean AND NOT (v->>'session_reminders_enabled')::boolean
    AND (v->>'survey_opens_at')::timestamptz = '2030-06-11 08:00+00'
    AND (v->>'survey_closes_at')::timestamptz = '2030-09-09 08:00+00'
    AND NOT v ? 'survey_anonymous',
    '13/opcje: event_participant_options dla anonima (zapisane ustawienia, terminy wyliczone)');

  v := public.event_participant_options('fnd-mars');
  PERFORM pg_temp.assert((v->>'ok')::boolean AND v->>'timezone' = 'Europe/Warsaw'
      AND (v->>'transfer_deadline_at')::timestamptz = '2030-06-11 08:00+00'
      AND (v->>'effective_end')::timestamptz = '2030-06-12 18:00+00'
      AND (v->>'survey_closes_at')::timestamptz = '2030-06-26 18:00+00'
      AND (v->>'calendar_export_enabled')::boolean,
    '13/opcje: bez wiersza ustawien - domyslne; bledna strefa -> Europe/Warsaw; z ends_at');

  PERFORM pg_temp.assert(public.event_participant_options('fnd-draft') = '{"ok":false}'::jsonb,
    '13/opcje: szkic -> {"ok":false}');
  PERFORM pg_temp.assert(public.event_participant_options('fnd-pub-b') = '{"ok":false}'::jsonb
      AND public.event_participant_options('nie-ma-takiego') = '{"ok":false}'::jsonb
      AND public.event_participant_options('  ') = '{"ok":false}'::jsonb
      AND public.event_participant_options(NULL) = '{"ok":false}'::jsonb,
    '13/opcje: obcy najemca / nieznany / pusty slug -> {"ok":false}');
END $$;
RESET ROLE;
SELECT set_config('nes.public_tenant', '', false);

-- ---------------------------------------------------------------------------
-- 10. Sprzatanie po utracie biletu
-- ---------------------------------------------------------------------------
-- starsze rezerwacje RSVP
INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, waitlisted_at) VALUES
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
   '13000000-0000-0000-0000-000000000001', 'going', NULL),
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000003',
   '13000000-0000-0000-0000-000000000005', 'waitlist', now()),
  -- U2 nie ma zadnego zgloszenia na EA1: o wyniku decyduje WYLACZNIE filtr statusu
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
   '13000000-0000-0000-0000-000000000002', 'interested', NULL);

DO $$
DECLARE
  a constant uuid := '13131313-1313-1313-1313-131313131313';
  n integer;
BEGIN
  -- U5 ma aktywne zgloszenie na EA3 -> rezerwacja zostaje
  n := public._event_legacy_rsvp_release(a, '13100000-0000-0000-0000-000000000003',
                                          '13000000-0000-0000-0000-000000000005');
  PERFORM pg_temp.assert(n = 0 AND (SELECT status FROM public.event_rsvps
      WHERE user_id = '13000000-0000-0000-0000-000000000005') = 'waitlist',
    '13/zwolnienie: _event_legacy_rsvp_release zostawia RSVP, gdy konto ma inne aktywne zgloszenie');

  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
   WHERE id = '13500000-0000-0000-0000-000000000008';
  n := public._event_legacy_rsvp_release(a, '13100000-0000-0000-0000-000000000003',
                                          '13000000-0000-0000-0000-000000000005');
  PERFORM pg_temp.assert(n = 1 AND (SELECT status FROM public.event_rsvps
      WHERE user_id = '13000000-0000-0000-0000-000000000005') = 'cancelled',
    '13/zwolnienie: _event_legacy_rsvp_release anuluje waitlist po odwolaniu jedynego zgloszenia');

  n := public._event_legacy_rsvp_release(a, '13100000-0000-0000-0000-000000000001',
                                          '13000000-0000-0000-0000-000000000002');
  PERFORM pg_temp.assert(n = 0 AND (SELECT status FROM public.event_rsvps
      WHERE user_id = '13000000-0000-0000-0000-000000000002') = 'interested',
    '13/zwolnienie: status interested nie jest zwalniany (tylko going/waitlist)');

  PERFORM pg_temp.assert(public._event_legacy_rsvp_release(a, '13100000-0000-0000-0000-000000000001', NULL) = 0,
    '13/zwolnienie: _event_legacy_rsvp_release(NULL) = 0');
END $$;

-- Filtr najemcy w UPDATE: wiersz RSVP zapisany pod najemca B (przy wydarzeniu
-- EA3) nie jest zwalniany przez wywolanie z najemca A - i JEST zwalniany przez
-- wywolanie z najemca B (kontrapunkt: filtr dziala po najemcy, nie blokuje wszystkiego).
INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status) VALUES
  ('13131313-1313-1313-1313-13131313131b', '13100000-0000-0000-0000-000000000003',
   '13000000-0000-0000-0000-000000000004', 'going');
DO $$
DECLARE n integer;
BEGIN
  n := public._event_legacy_rsvp_release('13131313-1313-1313-1313-131313131313',
    '13100000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000004');
  PERFORM pg_temp.assert(n = 0 AND (SELECT status FROM public.event_rsvps
      WHERE user_id = '13000000-0000-0000-0000-000000000004'
        AND event_id = '13100000-0000-0000-0000-000000000003') = 'going',
    '13/zwolnienie: _event_legacy_rsvp_release nie zwalnia RSVP obcego najemcy (filtr tenant_id)');
  n := public._event_legacy_rsvp_release('13131313-1313-1313-1313-13131313131b',
    '13100000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000004');
  PERFORM pg_temp.assert(n = 1,
    '13/zwolnienie: ten sam wiersz zwalniany przy zgodnym najemcy (kontrapunkt)');
END $$;

-- zapisy na sesje, kolejka i zakladki
INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id, status, registered_at) VALUES
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
   '13200000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'registered', now() - interval '2 hours'),
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
   '13200000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000004', 'waitlist', now() - interval '1 hour'),
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
   '13200000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001', 'waitlist', now() - interval '1 hour'),
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000002',
   '13200000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000001', 'registered', now()),
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
   '13200000-0000-0000-0000-000000000004', '13000000-0000-0000-0000-000000000001', 'registered', now() - interval '3 hours');
INSERT INTO public.event_session_saves (tenant_id, event_id, session_id, user_id) VALUES
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
   '13200000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001'),
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
   '13200000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000004'),
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000002',
   '13200000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000001');

-- RLS zakladek: tylko wlasciciel, tylko w najemcy hosta
SELECT pg_temp.act_as('13000000-0000-0000-0000-000000000001', NULL);
SELECT set_config('nes.public_tenant', '13131313-1313-1313-1313-131313131313', false);
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_session_saves) = 2,
  '13/zakladki: event_session_saves - wlasciciel widzi swoje zakladki w najemcy hosta');
SELECT pg_temp.assert_raises(
  $$INSERT INTO public.event_session_saves (tenant_id, event_id, session_id, user_id)
    VALUES ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
            '13200000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001')$$,
  '13/zakladki: authenticated nie pisze bezposrednio (tylko RPC toru A)');
RESET ROLE;
SELECT pg_temp.act_as('13000000-0000-0000-0000-000000000004', NULL);
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_session_saves
    WHERE user_id = '13000000-0000-0000-0000-000000000001') = 0
  AND (SELECT count(*) FROM public.event_session_saves) = 1,
  '13/zakladki: inny uzytkownik nie widzi cudzych zakladek, widzi swoja (kontrapunkt)');
RESET ROLE;
SELECT pg_temp.act_as('13000000-0000-0000-0000-000000000001', NULL);
SELECT set_config('nes.public_tenant', '13131313-1313-1313-1313-13131313131b', false);
SET ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) FROM public.event_session_saves) = 0,
  '13/zakladki: w obcym najemcy hosta wlasciciel nie widzi zakladek');
RESET ROLE;
SELECT set_config('nes.public_tenant', '', false);
SELECT pg_temp.act_as(NULL, NULL);

DO $$
DECLARE
  a constant uuid := '13131313-1313-1313-1313-131313131313';
  v jsonb;
BEGIN
  PERFORM pg_temp.assert(
    public._event_participant_release(a, '13100000-0000-0000-0000-000000000001', NULL, 'test')
      = '{"signups_cancelled":0,"signups_promoted":0,"saves_removed":0,"rsvp_cancelled":0}'::jsonb,
    '13/zwolnienie: _event_participant_release(NULL) - same zera');

  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
   WHERE id = '13500000-0000-0000-0000-000000000001';
  v := public._event_participant_release(a, '13100000-0000-0000-0000-000000000001',
                                          '13000000-0000-0000-0000-000000000001', 'refunded');
  -- S1 registered + kolejka (awans), S2 waitlist (bez awansu), S4 registered bez kolejki (bez awansu)
  PERFORM pg_temp.assert(
    v = '{"signups_cancelled":3,"signups_promoted":1,"saves_removed":1,"rsvp_cancelled":1}'::jsonb,
    '13/zwolnienie: _event_participant_release liczy odwolane zapisy, awans, zakladki i RSVP');
  PERFORM pg_temp.assert(
    (SELECT status = 'cancelled' AND cancelled_at IS NOT NULL FROM public.event_session_signups
      WHERE session_id = '13200000-0000-0000-0000-000000000004'
        AND user_id = '13000000-0000-0000-0000-000000000001')
    AND (SELECT count(*) FROM public.event_session_signups
      WHERE session_id = '13200000-0000-0000-0000-000000000004' AND status = 'registered') = 0,
    '13/zwolnienie: zapis registered bez kolejki odwolany, nikt nie awansuje');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_session_signups
      WHERE session_id = '13200000-0000-0000-0000-000000000001'
        AND user_id = '13000000-0000-0000-0000-000000000004') = 'registered'
    AND (SELECT count(*) FROM public.event_session_signups
      WHERE event_id = '13100000-0000-0000-0000-000000000001'
        AND user_id = '13000000-0000-0000-0000-000000000001'
        AND status = 'cancelled' AND cancelled_at IS NOT NULL) = 3,
    '13/zwolnienie: zapisy posiadacza odwolane, pierwszy z kolejki sesji awansowany');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_session_signups
      WHERE session_id = '13200000-0000-0000-0000-000000000003') = 'registered'
    AND (SELECT count(*) FROM public.event_session_saves
      WHERE user_id = '13000000-0000-0000-0000-000000000001') = 1
    AND (SELECT count(*) FROM public.event_session_saves
      WHERE user_id = '13000000-0000-0000-0000-000000000004') = 1
    AND (SELECT status FROM public.event_rsvps
      WHERE user_id = '13000000-0000-0000-0000-000000000001') = 'cancelled',
    '13/zwolnienie: inne wydarzenie i cudze zakladki nietkniete; RSVP posiadacza anulowane');
END $$;

-- Zapis, ktorego status zmienil sie miedzy odczytem petli a blokada sesji
-- (rownolegle `event_session_signup` odwolalo go i samo awansowalo kolejke),
-- nie jest liczony ani nie wywoluje DRUGIEGO awansu. Jedna sesja nie odtworzy
-- wyscigu, wiec UPDATE, ktory nie trafia w wiersz, symuluje trigger BEFORE
-- UPDATE zwracajacy NULL (w punkcie zapisu, wycofywany).
INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id, status, registered_at) VALUES
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
   '13200000-0000-0000-0000-000000000004', '13000000-0000-0000-0000-000000000002', 'registered', now() - interval '2 hours'),
  ('13131313-1313-1313-1313-131313131313', '13100000-0000-0000-0000-000000000001',
   '13200000-0000-0000-0000-000000000004', '13000000-0000-0000-0000-000000000005', 'waitlist', now() - interval '1 hour');
SAVEPOINT t13_stale_signup;
CREATE FUNCTION public.t13_skip_signup_cancel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.user_id = '13000000-0000-0000-0000-000000000002' AND NEW.status = 'cancelled' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t13_skip_signup_cancel BEFORE UPDATE ON public.event_session_signups
  FOR EACH ROW EXECUTE FUNCTION public.t13_skip_signup_cancel();
DO $$
DECLARE v jsonb;
BEGIN
  v := public._event_participant_release('13131313-1313-1313-1313-131313131313',
    '13100000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000002', 'stale');
  PERFORM pg_temp.assert(
    v = '{"signups_cancelled":0,"signups_promoted":0,"saves_removed":0,"rsvp_cancelled":0}'::jsonb
    AND (SELECT status FROM public.event_session_signups
          WHERE session_id = '13200000-0000-0000-0000-000000000004'
            AND user_id = '13000000-0000-0000-0000-000000000005') = 'waitlist',
    '13/zwolnienie: zapis, ktory nie mial juz widzianego statusu, nie jest liczony i nie awansuje kolejki');
END $$;
ROLLBACK TO SAVEPOINT t13_stale_signup;
DO $$
DECLARE v jsonb;
BEGIN
  v := public._event_participant_release('13131313-1313-1313-1313-131313131313',
    '13100000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000002', 'plain');
  PERFORM pg_temp.assert(
    v->>'signups_cancelled' = '1' AND v->>'signups_promoted' = '1'
    AND (SELECT status FROM public.event_session_signups
          WHERE session_id = '13200000-0000-0000-0000-000000000004'
            AND user_id = '13000000-0000-0000-0000-000000000005') = 'registered',
    '13/zwolnienie: bez zmiany statusu ten sam zapis jest odwolany, a kolejka awansuje (kontrapunkt)');
END $$;

-- ---------------------------------------------------------------------------
-- 11. Uprawnienia funkcji i tozsamosc atrapy platformy
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_participant_options(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_participant_settings_save(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_participant_settings_get(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_delivery_claim(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_registration_actor(uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_participant_release(uuid,uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public._event_safe_timezone(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public._event_effective_end(timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_effective_end(timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_local_quiet(text,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_legacy_rsvp_release(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_registration_lang(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_participant_settings_effective(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_message_delivery_stats(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_participant_settings_save(jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_delivery_confirm(uuid,text,text)', 'EXECUTE'),
  '13/acl: publiczne opcje dla anon, panel dla authenticated, pomocnicy tylko service_role');

SELECT pg_temp.assert(
  obj_description('public.enqueue_notification'::regproc, 'pg_proc') LIKE 'events-harness stub%',
  '13/atrapa: enqueue_notification to atrapa harnessu (migracja platformy nie jest replayowana)');

ROLLBACK;
