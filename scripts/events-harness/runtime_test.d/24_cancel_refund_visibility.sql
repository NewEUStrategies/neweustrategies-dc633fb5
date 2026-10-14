-- ============================================================================
-- 24_cancel_refund_visibility - REZYGNACJA, ZWROTY I NOTATKA WEWNETRZNA
-- (REG-03, REG-13 czesc rezygnacji, REG-06; migracje 20261012170000..170200)
--
-- PO CO TEN PLIK ISTNIEJE
-- pgTAP (supabase/tests/event_registration_cancel_refund_test.sql
-- i event_registration_participant_reason_test.sql) przypina reguly na pelnym
-- schemacie. Ten plik sprawdza je na REPLAYU modulu - na tych samych cialach,
-- ktore dostaja pozostale pliki harnessu (kaskada grup, kolejka, webhook) -
-- i na kluczu samoobslugi z prawdziwego generatora.
--
-- KRYTERIUM AUDYTU REG-03: „oplacone + rezygnacja -> zlecenie albo
-- needs_review". Kazde zamkniecie oplaconego zgloszenia zostawia wiersz
-- w `event_registration_refund_jobs`: rezygnacja w terminie (pending
-- + dzwonek billing do administratora), po terminie (needs_review), wplata
-- reczna (needs_review bez zamowienia), anulowanie przez organizatora (pending
-- albo „nie zwracaj" z notatka) i surowy UPDATE (siatka bezpieczenstwa).
-- REG-13: rezygnacja po koncu wydarzenia -> `event_ended` / `manage_expired`,
-- organizator zamyka po koncu bez awansu kolejki.
-- REG-06: „Moje zgloszenia" bez notatki wewnetrznej, odczyt kolumny wprost
-- odmowiony, gosc grupy nie dziedziczy powodu dla uczestnika.
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================
\echo '== 24 rezygnacja, zwroty i notatka wewnetrzna =='

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('b4240000-0000-4000-8000-000000000001', 'crv-admin@example.test'),
  ('b4240000-0000-4000-8000-000000000002', 'crv-owner@example.test');
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('b4240000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b4240000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.user_roles (user_id, role) VALUES ('b4240000-0000-4000-8000-000000000001', 'admin');

-- e1 w terminie zwrotu (start za 30 dni, zasada domyslna 168 h), e2 po
-- terminie (720 h przed startem za 10 dni), e3 zakonczone godzine temu.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status, registration_mode) VALUES
  ('b4241000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'crv-window',
   'Zwroty w terminie', 'Refund window', now() + interval '30 days', NULL, 'published', 'form'),
  ('b4241000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'crv-late',
   'Zwroty po terminie', 'Refund late', now() + interval '10 days', NULL, 'published', 'form'),
  ('b4241000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'crv-ended',
   'Zakonczone', 'Ended', now() - interval '2 days', now() - interval '1 hour', 'published', 'form');
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
                                       group_registration_enabled, group_max_size)
SELECT ('b4242000-0000-4000-8000-00000000000' || s)::uuid, '11111111-1111-1111-1111-111111111111',
       ('b4241000-0000-4000-8000-00000000000' || s)::uuid, 'crv_' || s, 'Wstep', 'Admission', 10000, 'PLN', true, 5
  FROM unnest(ARRAY['1', '2', '3']) AS s;
INSERT INTO public.event_participant_settings (tenant_id, event_id, refund_mode, refund_deadline_hours)
VALUES ('11111111-1111-1111-1111-111111111111', 'b4241000-0000-4000-8000-000000000002', 'policy', 720);

CREATE TEMP TABLE crv (k text PRIMARY KEY, u uuid, t text) ON COMMIT DROP;
-- Klucze i identyfikatory czyta tez sesja pod SET ROLE anon/authenticated.
GRANT SELECT ON crv TO anon, authenticated;

-- Oplacone zgloszenie z kluczem samoobslugi i (opcjonalnie) zamowieniem Stripe.
CREATE FUNCTION pg_temp.crv_paid(p_key text, p_event text, p_status text, p_order boolean,
                                 p_user uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_person uuid := gen_random_uuid();
  v_id uuid := gen_random_uuid();
  v_order uuid;
  v_token text := public._event_new_qr_token();
BEGIN
  INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name)
  VALUES (v_person, '11111111-1111-1111-1111-111111111111', p_user, p_key || '@crv.example.test', 'Test', p_key);
  IF p_order THEN
    v_order := gen_random_uuid();
    INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, provider,
                                       environment, provider_payment_intent_id, paid_at, metadata)
    VALUES (v_order, '11111111-1111-1111-1111-111111111111', 'b4240000-0000-4000-8000-000000000002', 'paid',
            10000, 'PLN', 'stripe', 'sandbox', 'pi_crv_' || p_key, now(),
            jsonb_build_object('event_id', 'b4241000-0000-4000-8000-00000000000' || p_event,
                               'registration_id', v_id,
                               'ticket_type_id', 'b4242000-0000-4000-8000-00000000000' || p_event));
  END IF;
  INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status,
    registration_mode, payment_status, payment_order_id, paid_at, waitlist_position, manage_token_hash)
  VALUES (v_id, '11111111-1111-1111-1111-111111111111', ('b4241000-0000-4000-8000-00000000000' || p_event)::uuid,
          v_person, ('b4242000-0000-4000-8000-00000000000' || p_event)::uuid, p_status, 'form', 'paid', v_order,
          now(), CASE WHEN p_status = 'waitlist' THEN 1 END,
          encode(extensions.digest(v_token, 'sha256'), 'hex'));
  INSERT INTO crv (k, u, t) VALUES (p_key, v_id, v_token);
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.crv_job(p_key text) RETURNS public.event_registration_refund_jobs
LANGUAGE sql AS $$
  SELECT j.* FROM public.event_registration_refund_jobs j
   WHERE j.registration_id = (SELECT u FROM crv WHERE k = p_key)
      OR j.payment_order_id = (SELECT r.payment_order_id FROM public.event_registrations r
                                WHERE r.id = (SELECT u FROM crv WHERE k = p_key))
   ORDER BY j.updated_at DESC LIMIT 1
$$;

SELECT pg_temp.crv_paid('window', '1', 'approved', true);
SELECT pg_temp.crv_paid('late', '2', 'approved', true);
SELECT pg_temp.crv_paid('manual', '1', 'approved', false);
SELECT pg_temp.crv_paid('org_full', '1', 'approved', true);
SELECT pg_temp.crv_paid('org_none', '1', 'approved', true);
SELECT pg_temp.crv_paid('raw', '1', 'approved', true);
SELECT pg_temp.crv_paid('ended', '3', 'approved', true, 'b4240000-0000-4000-8000-000000000002');
SELECT pg_temp.crv_paid('ended_queue', '3', 'waitlist', false);

-- ── REG-03: rezygnacja kluczem w terminie zwrotu ────────────────────────────────
SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);
SET ROLE anon;
SELECT pg_temp.assert(
  (SELECT v->'refund'->>'effect' = 'full_refund' AND (v->'refund'->>'amount_cents')::int = 10000
          AND (v->'refund'->>'acknowledgement_required')::boolean
     FROM (SELECT public.event_registration_cancel_preview(
             jsonb_build_object('manage_token', (SELECT t FROM crv WHERE k = 'window'))) AS v) x),
  'REG-03: podglad kluczem pokazuje pelny zwrot 100 zl przed potwierdzeniem');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_cancel(%L::jsonb)',
         jsonb_build_object('manage_token', (SELECT t FROM crv WHERE k = 'window'))),
  'refund_ack_required', 'REG-03: rezygnacja oplaconego bez potwierdzenia skutku odrzucona');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_cancel(%L::jsonb)',
         jsonb_build_object('manage_token', (SELECT t FROM crv WHERE k = 'window'),
                            'acknowledged_effect', 'no_refund')),
  'refund_terms_changed', 'REG-03: potwierdzony inny skutek -> refund_terms_changed');
SELECT pg_temp.assert(
  public.event_registration_cancel(jsonb_build_object(
    'manage_token', (SELECT t FROM crv WHERE k = 'window'), 'acknowledged_effect', 'full_refund'))
    -> 'refund' ->> 'job_state' = 'pending',
  'REG-03: rezygnacja z potwierdzeniem zwraca stan zlecenia');
RESET ROLE;
SELECT pg_temp.assert(
  (SELECT j.state = 'pending' AND j.origin = 'participant_cancelled' AND j.amount_cents = 10000
     FROM pg_temp.crv_job('window') j),
  'REG-03 KRYTERIUM: oplacone + rezygnacja w terminie -> zlecenie pending');
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.notifications n
           WHERE n.user_id = 'b4240000-0000-4000-8000-000000000001' AND n.kind = 'billing'
             AND n.href = '/admin/events/b4241000-0000-4000-8000-000000000001/registration/list'),
  'REG-03: administrator najemcy dostaje dzwonek billing z odnosnikiem do listy zgloszen');
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM jsonb_array_elements(public._event_registration_refunds_claim(100)) c
           WHERE c->>'id' = (SELECT j.id::text FROM pg_temp.crv_job('window') j)
             AND c->>'origin' = 'participant_cancelled'),
  'REG-03: worker dzierzawi zlecenie z pochodzeniem (powod zwrotu u operatora)');

-- ── REG-03: po terminie, wplata reczna ───────────────────────────────────────────
SET ROLE anon;
SELECT pg_temp.assert(
  public.event_registration_cancel(jsonb_build_object(
    'manage_token', (SELECT t FROM crv WHERE k = 'late'), 'acknowledged_effect', 'no_refund'))
    -> 'refund' ->> 'review_reason' = 'outside_refund_window',
  'REG-03: po terminie skutek no_refund, decyzja organizatora');
SELECT pg_temp.assert(
  public.event_registration_cancel(jsonb_build_object(
    'manage_token', (SELECT t FROM crv WHERE k = 'manual'), 'acknowledged_effect', 'organizer_review'))
    ->> 'status' = 'cancelled',
  'REG-03: wplata poza operatorem - rezygnacja z potwierdzeniem');
RESET ROLE;
SELECT pg_temp.assert(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'outside_refund_window' FROM pg_temp.crv_job('late') j),
  'REG-03 KRYTERIUM: oplacone + rezygnacja po terminie -> needs_review');
SELECT pg_temp.assert(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'manual_payment' AND j.payment_order_id IS NULL
     FROM pg_temp.crv_job('manual') j),
  'REG-03 KRYTERIUM: wplata reczna + rezygnacja -> needs_review bez zamowienia');

-- ── REG-03: organizator ─────────────────────────────────────────────────────────
SELECT pg_temp.act_as('b4240000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', (SELECT u FROM crv WHERE k = 'org_full'), 'action', 'cancel'))
    -> 'refund' ->> 'job_state' = 'pending',
  'REG-03 KRYTERIUM: organizator anuluje oplacone -> zwrot automatyczny');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.admin_event_registration_decide(%L::jsonb)',
         jsonb_build_object('registration_id', (SELECT u FROM crv WHERE k = 'org_none'),
                            'action', 'cancel', 'refund', 'none')),
  'reason_required', 'REG-03: „nie zwracaj" bez notatki wewnetrznej odrzucone');
SELECT public.admin_event_registration_decide(jsonb_build_object(
  'registration_id', (SELECT u FROM crv WHERE k = 'org_none'), 'action', 'cancel', 'refund', 'none',
  'note', 'Bilet przeniesiony na kolejna edycje'));
SELECT pg_temp.assert(
  (SELECT j.state = 'cancelled' AND j.review_reason = 'organizer_waived' FROM pg_temp.crv_job('org_none') j),
  'REG-03 KRYTERIUM: „nie zwracaj" zostawia wpis cancelled/organizer_waived');
SELECT pg_temp.assert(
  public.admin_event_refund_job_decide(jsonb_build_object(
    'job_id', (SELECT j.id FROM pg_temp.crv_job('manual') j), 'action', 'mark_refunded',
    'note', 'Przelew zwrotny')) ->> 'state' = 'completed',
  'REG-03: organizator oznacza zwrot reczny - zlecenie zakonczone');
SELECT pg_temp.assert(
  (SELECT payment_status = 'refunded' FROM public.event_registrations WHERE id = (SELECT u FROM crv WHERE k = 'manual')),
  'REG-03: zwrot reczny ustawia wplate zgloszenia na refunded');
SELECT pg_temp.assert(
  (SELECT bool_and(e ? 'origin' AND e ? 'review_reason' AND NOT e ? 'claim_token')
     FROM jsonb_array_elements(public.admin_event_refund_jobs('b4241000-0000-4000-8000-000000000001')) e),
  'REG-03: dziennik zwrotow pokazuje pochodzenie i powod, bez dzierzawy workera');

-- ── REG-03: siatka bezpieczenstwa ───────────────────────────────────────────────
UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
 WHERE id = (SELECT u FROM crv WHERE k = 'raw');
SELECT pg_temp.assert(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'closed_without_refund_decision'
     FROM pg_temp.crv_job('raw') j),
  'REG-03 KRYTERIUM: surowe zamkniecie oplaconego -> needs_review (siatka bezpieczenstwa)');

-- ── REG-13: po koncu wydarzenia ─────────────────────────────────────────────────
SELECT pg_temp.act_as('b4240000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_cancel(%L::jsonb)',
         jsonb_build_object('registration_id', (SELECT u FROM crv WHERE k = 'ended'),
                            'acknowledged_effect', 'no_refund')),
  'event_ended', 'REG-13 KRYTERIUM: wlasciciel konta po ends_at -> odmowa event_ended');
SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_cancel(%L::jsonb)',
         jsonb_build_object('manage_token', (SELECT t FROM crv WHERE k = 'ended'))),
  'manage_expired', 'REG-13/REG-17: klucz samoobslugi po koncu -> manage_expired');
SELECT pg_temp.assert(
  public.event_registration_cancel_preview(jsonb_build_object('manage_token', (SELECT t FROM crv WHERE k = 'ended')))
    = '{"ok": false, "reason": "expired"}'::jsonb,
  'REG-13: podglad kluczem po koncu - expired, bez danych');
RESET ROLE;
SELECT pg_temp.act_as('b4240000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (public.admin_event_registration_decide(jsonb_build_object(
     'registration_id', (SELECT u FROM crv WHERE k = 'ended'), 'action', 'cancel')) ->> 'promoted_from_waitlist')::int = 0
  AND (SELECT status = 'waitlist' FROM public.event_registrations WHERE id = (SELECT u FROM crv WHERE k = 'ended_queue')),
  'REG-13: organizator zamyka zgloszenie po koncu - kolejka nie awansuje');

-- ── REG-06: notatka wewnetrzna nie dociera do uczestnika ────────────────────────
DO $$
DECLARE
  v_lead uuid;
  v_guest uuid;
  -- Prowadzaca grupy to ta sama osoba (konto ...0002), co zgloszenie „ended".
  v_person uuid := (SELECT r.person_id FROM public.event_registrations r
                     WHERE r.id = (SELECT u FROM crv WHERE k = 'ended'));
  v_gperson uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
    (v_gperson, '11111111-1111-1111-1111-111111111111', NULL, 'crv-guest@example.test', 'Gosia', 'Guest');
  v_lead := gen_random_uuid();
  v_guest := gen_random_uuid();
  INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status,
    registration_mode, payment_status) VALUES
    (v_lead, '11111111-1111-1111-1111-111111111111', 'b4241000-0000-4000-8000-000000000002', v_person,
     'b4242000-0000-4000-8000-000000000002', 'pending', 'form', 'not_required');
  INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status,
    registration_mode, payment_status, group_lead_registration_id) VALUES
    (v_guest, '11111111-1111-1111-1111-111111111111', 'b4241000-0000-4000-8000-000000000002', v_gperson,
     'b4242000-0000-4000-8000-000000000002', 'pending', 'form', 'not_required', v_lead);
  INSERT INTO crv (k, u) VALUES ('lead', v_lead), ('guest', v_guest);
  PERFORM public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', v_lead, 'action', 'reject', 'note', 'WEWN-LEAD podejrzana firma',
    'participant_reason', 'Pula dla instytucji jest wyczerpana.'));
END $$;
SELECT pg_temp.assert(
  (SELECT participant_reason = 'Pula dla instytucji jest wyczerpana.' AND decision_note LIKE 'WEWN-LEAD%'
     FROM public.event_registrations WHERE id = (SELECT u FROM crv WHERE k = 'lead')),
  'REG-06: odrzucenie zapisuje osobno notatke wewnetrzna i powod dla uczestnika');
SELECT pg_temp.assert(
  (SELECT status = 'rejected' AND participant_reason IS NULL
     FROM public.event_registrations WHERE id = (SELECT u FROM crv WHERE k = 'guest')),
  'REG-06: gosc zamkniety kaskada nie dziedziczy powodu dla uczestnika (fail-closed)');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.admin_event_registration_decide(%L::jsonb)',
         jsonb_build_object('registration_id', (SELECT u FROM crv WHERE k = 'lead'), 'action', 'approve',
                            'participant_reason', 'Witamy')),
  'invalid_request', 'REG-06: powod dla uczestnika tylko przy reject/cancel/refund');

SELECT pg_temp.act_as('b4240000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT strpos(v::text, 'WEWN') = 0
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'registrations') e
                           WHERE e ? 'decision_note' OR e ? 'cancel_reason')
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'registrations') e
                       WHERE e->>'participant_reason' = 'Pula dla instytucji jest wyczerpana.')
     FROM (SELECT public.event_my_registrations('{"limit":50}'::jsonb) AS v) x),
  'REG-06 KRYTERIUM: event_my_registrations bez decision_note, z powodem dla uczestnika');
SELECT pg_temp.assert_raises_like(
  $q$SELECT decision_note FROM public.event_registrations$q$, 'permission denied',
  'REG-06: uczestnik nie czyta decision_note wprost (granty kolumnowe)');
SELECT pg_temp.assert(
  (SELECT count(*) >= 2 FROM (SELECT id, status FROM public.event_registrations) x),
  'REG-06: kolumny jawne wlasnych zgloszen nadal czytelne (polityka self_read)');
RESET ROLE;
SELECT pg_temp.act_as(NULL, NULL);

ROLLBACK;
