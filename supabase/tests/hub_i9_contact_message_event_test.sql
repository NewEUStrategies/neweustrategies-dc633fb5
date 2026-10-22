-- pgTAP: zdarzenie `contact_message.submitted.v1` (I9, Z-S5-01; migracja
-- 20261020162800) - wiadomość z formularza kontaktowego na szynie.
--
-- CO PRZYPINA:
--   * formularz cennika -> dokładnie jedno zdarzenie na agregacie wiadomości
--     z `lead_id` leada założonego przez wyzwalacz CRM (kolejność wyzwalaczy:
--     emiter po `trg_contact_messages_to_lead`);
--   * ładunek BEZ danych osobowych (tylko message_id, lead_id, form_kind,
--     form_id) i `form_kind` z białej listy;
--   * kandydat do pracy (`form_id = 'careers'`) bez zdarzenia;
--   * awaria emitera nie wycofuje zapisu formularza (ślad w
--     `domain_event_emit_errors`);
--   * ACL funkcji wyzwalacza.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9_contact_message_event
BEGIN;
SELECT plan(9);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('19e90000-0000-4000-8000-0000000005a0', 'i9-kontakt', 'I9 Kontakt');

CREATE FUNCTION pg_temp.msg(p_id text, p_email text, p_form_id text, p_source text, p_form_type text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.contact_messages (id, tenant_id, name, email, message, consent, lang, form_id,
                                       source, form_type)
  VALUES (p_id::uuid, '19e90000-0000-4000-8000-0000000005a0', 'Anna Nowak', p_email, 'Prosimy o ofertę',
          true, 'pl', p_form_id, p_source, COALESCE(p_form_type, 'contact_form'))
$$;
CREATE FUNCTION pg_temp.ev(p_id text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT e.payload FROM public.domain_events e
   WHERE e.aggregate_type = 'contact_message' AND e.aggregate_id = p_id
     AND e.event_type = 'contact_message.submitted.v1'
$$;

-- ── 1-4. Formularz cennika ──────────────────────────────────────────────────
SELECT pg_temp.msg('19e90000-0000-4000-8000-0000000051a1', 'Anna.Nowak@Firma.test', 'pricing-contact-sales',
                   'pricing', NULL);
SELECT is(
  (SELECT count(*) FROM public.domain_events
    WHERE aggregate_type = 'contact_message' AND aggregate_id = '19e90000-0000-4000-8000-0000000051a1'
      AND event_type = 'contact_message.submitted.v1'),
  1::bigint,
  'formularz cennika: dokładnie jedno zdarzenie na agregacie wiadomości');
SELECT ok(
  pg_temp.ev('19e90000-0000-4000-8000-0000000051a1') ->> 'lead_id' = (
    SELECT l.id::text FROM public.crm_leads l
     WHERE l.tenant_id = '19e90000-0000-4000-8000-0000000005a0' AND l.email_norm = 'anna.nowak@firma.test'),
  'lead_id = lead założony przez wyzwalacz CRM w tej samej instrukcji (emiter odpala po nim)');
SELECT ok(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.ev('19e90000-0000-4000-8000-0000000051a1')) k)
    = ARRAY['form_id', 'form_kind', 'lead_id', 'message_id']
  AND pg_temp.ev('19e90000-0000-4000-8000-0000000051a1')::text NOT ILIKE '%anna%'
  AND pg_temp.ev('19e90000-0000-4000-8000-0000000051a1')::text NOT ILIKE '%firma.test%'
  AND pg_temp.ev('19e90000-0000-4000-8000-0000000051a1')::text NOT ILIKE '%ofert%',
  'ładunek bez danych osobowych: tylko message_id, lead_id, form_kind, form_id');
SELECT is(pg_temp.ev('19e90000-0000-4000-8000-0000000051a1') ->> 'form_kind', 'pricing',
  'form_kind: formularz kasy cennika -> pricing');

-- ── 5. Biała lista form_kind ────────────────────────────────────────────────
SELECT pg_temp.msg('19e90000-0000-4000-8000-0000000051a2', 'b@firma.test', NULL, 'pricing', NULL);
SELECT pg_temp.msg('19e90000-0000-4000-8000-0000000051a3', 'c@firma.test', 'kontakt-stopka', 'stopka <b>', NULL);
SELECT pg_temp.msg('19e90000-0000-4000-8000-0000000051a4', 'd@firma.test', NULL, NULL, 'newsletter');
SELECT pg_temp.msg('19e90000-0000-4000-8000-0000000051a5', 'e@firma.test', NULL, NULL, 'join_us');
SELECT is(
  ARRAY[pg_temp.ev('19e90000-0000-4000-8000-0000000051a2') ->> 'form_kind',
        pg_temp.ev('19e90000-0000-4000-8000-0000000051a3') ->> 'form_kind',
        pg_temp.ev('19e90000-0000-4000-8000-0000000051a4') ->> 'form_kind',
        pg_temp.ev('19e90000-0000-4000-8000-0000000051a5') ->> 'form_kind'],
  ARRAY['pricing', 'contact', 'newsletter', 'join_us'],
  'form_kind z białej listy: źródło cennika, kontakt (wolny tekst źródła nie trafia do ładunku), newsletter, join_us');

-- ── 6. Kandydat do pracy ────────────────────────────────────────────────────
SELECT pg_temp.msg('19e90000-0000-4000-8000-0000000051a6', 'kandydat@firma.test', 'careers', NULL, NULL);
SELECT ok(
  pg_temp.ev('19e90000-0000-4000-8000-0000000051a6') IS NULL
  AND EXISTS (SELECT 1 FROM public.career_applications WHERE message_id = '19e90000-0000-4000-8000-0000000051a6'),
  'kandydat do pracy: zgłoszenie w module karier, zdarzenia na szynie brak');

-- ── 7. Awaria emitera nie wycofuje zapisu ───────────────────────────────────
-- Emiter szyny podmieniony w transakcji testu: rzuca tylko dla tego typu,
-- inne zdarzenia (lead) idą jak zwykle.
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text, p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_actor_id uuid DEFAULT NULL, p_suppress_actor boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_event_type = 'contact_message.submitted.v1' THEN
    RAISE EXCEPTION 'probe: bus down' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.domain_events (tenant_id, aggregate_type, aggregate_id, event_type, payload, actor_id)
  VALUES (p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type, COALESCE(p_payload, '{}'::jsonb), p_actor_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
SELECT lives_ok(
  $$ SELECT pg_temp.msg('19e90000-0000-4000-8000-0000000051a7', 'f@firma.test', 'pricing-contact-sales', NULL, NULL) $$,
  'awaria emitera: zapis formularza przechodzi');
SELECT ok(
  EXISTS (SELECT 1 FROM public.contact_messages WHERE id = '19e90000-0000-4000-8000-0000000051a7')
  AND pg_temp.ev('19e90000-0000-4000-8000-0000000051a7') IS NULL
  AND EXISTS (SELECT 1 FROM public.domain_event_emit_errors
               WHERE tenant_id = '19e90000-0000-4000-8000-0000000005a0'
                 AND source = 'tg_contact_messages_submitted_emit'
                 AND event_type = 'contact_message.submitted.v1' AND error LIKE 'probe:%'),
  'awaria emitera: wiadomość zapisana, zdarzenia brak, ślad w domain_event_emit_errors');

-- ── 8. ACL i kolejność wyzwalaczy ───────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.tg_contact_messages_submitted_emit()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_contact_messages_submitted_emit()', 'EXECUTE')
  AND (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
        WHERE t.tgrelid = 'public.contact_messages'::regclass
          AND t.tgname::text LIKE 'trg_contact_messages_to_lead%')
      = ARRAY['trg_contact_messages_to_lead', 'trg_contact_messages_to_lead_submitted_emit'],
  'ACL: wyzwalacz bez EXECUTE dla klientów; emiter sortuje się po wyzwalaczu CRM');

SELECT * FROM finish();
ROLLBACK;
