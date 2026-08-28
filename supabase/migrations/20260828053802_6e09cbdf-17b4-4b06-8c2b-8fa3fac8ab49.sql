ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS provider_customer_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS provider_charge_id text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_session_uniq
  ON public.payment_orders (environment, provider_session_id)
  WHERE provider_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_orders_provider_payment_intent_idx
  ON public.payment_orders (provider_payment_intent_id)
  WHERE provider_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_orders_provider_customer_idx
  ON public.payment_orders (provider_customer_id)
  WHERE provider_customer_id IS NOT NULL;

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS payment_order_id uuid REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_registrations'::regclass
      AND conname = 'event_registrations_payment_status_values'
  ) THEN
    ALTER TABLE public.event_registrations
      ADD CONSTRAINT event_registrations_payment_status_values
      CHECK (payment_status IN ('not_required','unpaid','paid','refunded'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_registrations_payment_order_idx
  ON public.event_registrations (payment_order_id)
  WHERE payment_order_id IS NOT NULL;

-- Rozliczenie wyniku płatności na zgłoszeniu uczestnika.
-- Jedno miejsce, w którym „opłacone/nieopłacone/zwrócone” zamienia się w stan
-- zgłoszenia: bez tego panel organizatora pokazywałby potwierdzoną obecność
-- osoby, której pieniądze wróciły na kartę, a zwolnione miejsce nigdy nie
-- trafiłoby do pierwszej osoby z listy rezerwowej.
CREATE OR REPLACE FUNCTION public.payments_apply_event_ticket_outcome(
  p_order_id uuid,
  p_outcome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_order public.payment_orders;
  v_event_id uuid;
  v_ticket_type_id uuid;
  v_person_id uuid;
  v_reg public.event_registrations;
  v_token text;
  v_promoted jsonb := jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
BEGIN
  IF p_outcome NOT IN ('paid','unpaid','refunded') THEN
    RAISE EXCEPTION 'invalid_outcome';
  END IF;

  SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'order_not_found');
  END IF;

  v_event_id := NULLIF(v_order.metadata->>'event_id','')::uuid;
  v_ticket_type_id := NULLIF(v_order.metadata->>'ticket_type_id','')::uuid;
  IF v_event_id IS NULL OR v_order.user_id IS NULL OR v_order.tenant_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_a_ticket_order');
  END IF;

  SELECT p.id INTO v_person_id
  FROM public.event_people p
  WHERE p.tenant_id = v_order.tenant_id AND p.user_id = v_order.user_id
  LIMIT 1;

  -- Najpierw powiązanie zapisane wcześniej, potem dopasowanie po osobie:
  -- zamówienie mogło powstać zanim uczestnik wypełnił formularz zgłoszenia.
  SELECT r.* INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_order.tenant_id
    AND r.event_id = v_event_id
    AND (
      r.payment_order_id = v_order.id
      OR (v_person_id IS NOT NULL AND r.person_id = v_person_id)
    )
  ORDER BY (r.payment_order_id = v_order.id) DESC, r.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_reg.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'registration_not_found');
  END IF;

  IF p_outcome = 'paid' THEN
    v_token := public._event_new_qr_token();
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'paid',
        paid_at = COALESCE(r.paid_at, now()),
        ticket_type_id = COALESCE(v_ticket_type_id, r.ticket_type_id),
        status = CASE WHEN r.status IN ('draft','pending','waitlist') THEN 'approved' ELSE r.status END,
        waitlist_position = NULL,
        cancelled_at = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        qr_token_hash = COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex')),
        qr_issued_at = COALESCE(r.qr_issued_at, now()),
        updated_at = now()
    WHERE r.id = v_reg.id;

  ELSIF p_outcome = 'unpaid' THEN
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'unpaid',
        updated_at = now()
    WHERE r.id = v_reg.id AND r.payment_status <> 'paid';

  ELSE
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'refunded',
        paid_at = NULL,
        status = 'cancelled',
        cancelled_at = COALESCE(r.cancelled_at, now()),
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        updated_at = now()
    WHERE r.id = v_reg.id;

    -- Zwrot zwalnia miejsce - pierwsza osoba z listy rezerwowej wchodzi
    -- natychmiast, w tej samej transakcji co anulowanie.
    v_promoted := public._event_waitlist_promote(
      v_order.tenant_id, v_event_id, COALESCE(v_ticket_type_id, v_reg.ticket_type_id), 1);
  END IF;

  PERFORM public.emit_domain_event(
    v_order.tenant_id,
    'event_registration',
    v_reg.id::text,
    'event.registration.payment.v1',
    jsonb_build_object('event_id', v_event_id, 'order_id', v_order.id, 'outcome', p_outcome),
    NULL
  );

  RETURN jsonb_build_object(
    'applied', true,
    'registration_id', v_reg.id,
    'outcome', p_outcome,
    'waitlist', v_promoted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text) TO service_role;