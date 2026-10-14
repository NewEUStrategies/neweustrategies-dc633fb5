CREATE OR REPLACE FUNCTION public._event_invoice_registration_source(
  p_tenant uuid, p_registration_id uuid, p_rate text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
  v_lead_order uuid;
  v_block text;
  v_guests integer := 0;
  v_seats integer;
  v_gross bigint;
  v_unit bigint;
  v_units jsonb;
  v_coupon bigint := 0;
  v_lead_w bigint := 0;
  v_guest_w bigint := 0;
  v_total_w bigint := 0;
  v_lead_part bigint;
  v_booked boolean;
BEGIN
  SELECT r.id, r.event_id, r.person_id, r.group_lead_registration_id, r.status, r.payment_status,
         r.payment_order_id, r.ticket_type_id,
         COALESCE(r.paid_at, o.paid_at) AS paid_at,
         p.user_id AS holder_user_id, o.user_id AS payer_user_id,
         COALESCE(t.name_pl, '') AS name_pl, COALESCE(t.name_en, '') AS name_en,
         COALESCE(o.currency, r.paid_amount_currency, t.currency, 'PLN') AS currency,
         (o.id IS NOT NULL AND o.status::text IN ('paid', 'refunded')) AS via_card,
         (o.amount_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS order_gross,
         COALESCE(o.metadata, '{}'::jsonb) AS meta,
         t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule,
         COALESCE(t.tax_mode, 'inclusive') AS tax_mode,
         r.paid_amount_cents
    INTO v
    FROM public.event_registrations r
    JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    LEFT JOIN public.event_ticket_types t ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
   WHERE r.id = p_registration_id AND r.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_booked := NOT v.via_card AND v.paid_amount_cents IS NOT NULL
              AND v.payment_status IN ('paid', 'partially_refunded');

  IF v.group_lead_registration_id IS NOT NULL THEN
    SELECT l.payment_order_id INTO v_lead_order
      FROM public.event_registrations l
     WHERE l.id = v.group_lead_registration_id AND l.tenant_id = p_tenant;
    IF NOT (v.via_card AND v.payment_order_id IS DISTINCT FROM v_lead_order) THEN
      v_block := 'not_lead';
    END IF;
  ELSE
    SELECT count(*)::integer INTO v_guests
      FROM public.event_registrations g
      LEFT JOIN public.payment_orders go ON go.id = g.payment_order_id AND go.tenant_id = g.tenant_id
     WHERE g.group_lead_registration_id = v.id AND g.tenant_id = p_tenant
       AND g.status NOT IN ('cancelled', 'rejected')
       AND g.payment_status IN ('paid', 'partially_refunded', 'unpaid')
       AND NOT (go.id IS NOT NULL AND go.status::text IN ('paid', 'refunded')
                AND g.payment_order_id IS DISTINCT FROM v.payment_order_id);
  END IF;
  IF v_block IS NULL
     AND (v.status IN ('cancelled', 'rejected')
          OR v.payment_status NOT IN ('paid', 'partially_refunded', 'unpaid')) THEN
    v_block := 'closed';
  END IF;

  IF v.via_card AND v.order_gross IS NOT NULL THEN
    v_gross := v.order_gross;
    v_seats := CASE
      WHEN COALESCE(v.meta->>'quantity', '') ~ '^[0-9]{1,5}$' AND (v.meta->>'quantity')::integer >= 1
        THEN (v.meta->>'quantity')::integer
      ELSE 1 + v_guests
    END;
    IF v.meta->>'plan_benefit' IN ('included', 'discount')
       AND COALESCE(v.meta->>'lead_unit_cents', '') ~ '^[0-9]{1,9}$'
       AND COALESCE(v.meta->>'guest_unit_cents', '') ~ '^[0-9]{1,9}$' THEN
      IF COALESCE(v.meta->>'coupon_discount_per_seat_cents', '') ~ '^[0-9]{1,9}$' THEN
        v_coupon := (v.meta->>'coupon_discount_per_seat_cents')::bigint;
      END IF;
      v_lead_w := greatest((v.meta->>'lead_unit_cents')::bigint - v_coupon, 0);
      v_guest_w := greatest((v.meta->>'guest_unit_cents')::bigint - v_coupon, 0);
      v_total_w := v_lead_w + v_guest_w * (v_seats - 1);
    END IF;
    IF v_total_w > 0 AND v_gross > 0 THEN
      v_lead_part := (2 * v_gross * v_lead_w + v_total_w) / (2 * v_total_w);
      v_units := '[]'::jsonb;
      IF v_lead_part > 0 THEN
        v_units := v_units || jsonb_build_array(jsonb_build_object('qty', 1, 'gross', v_lead_part));
      END IF;
      IF v_seats > 1 AND v_gross - v_lead_part > 0 THEN
        v_units := v_units || jsonb_build_array(jsonb_build_object('qty', v_seats - 1, 'gross', v_gross - v_lead_part));
      END IF;
    ELSE
      v_units := jsonb_build_array(jsonb_build_object('qty', v_seats, 'gross', v_gross));
    END IF;
  ELSE
    v_seats := 1 + v_guests - CASE
      WHEN v.group_lead_registration_id IS NULL AND EXISTS (
        SELECT 1 FROM public.plan_ticket_claims c
         WHERE c.tenant_id = p_tenant AND c.registration_id = v.id AND c.released_at IS NULL
      ) THEN 1 ELSE 0 END;
    IF v_booked AND v.paid_amount_cents > 0 THEN
      v_seats := greatest(v_seats, 1);
    END IF;
    IF v_block IS NULL AND v_seats < 1 THEN
      v_block := 'plan_ticket';
    END IF;
    IF v_booked THEN
      v_gross := v.paid_amount_cents;
    ELSE
      v_unit := COALESCE(CASE
        WHEN v.payment_status = 'unpaid'
          THEN (public._event_registration_unit_price(
                  (SELECT r FROM public.event_registrations r
                    WHERE r.id = v.id AND r.tenant_id = p_tenant),
                  (SELECT t FROM public.event_ticket_types t
                    WHERE t.id = v.ticket_type_id AND t.tenant_id = p_tenant)
                )->>'amount_cents')::integer
        ELSE (public._event_ticket_phase(v.price_cents, v.early_bird_price_cents, v.early_bird_until,
                                         v.price_schedule, COALESCE(v.paid_at, now()))->>'price_cents')::integer
      END, 0)::bigint;
      IF v.tax_mode = 'exclusive' THEN
        v_unit := public._event_invoice_gross_from_net(v_unit, p_rate);
      END IF;
      v_gross := v_unit * greatest(v_seats, 0);
    END IF;
    v_units := jsonb_build_array(jsonb_build_object('qty', greatest(v_seats, 0), 'gross', v_gross));
  END IF;

  RETURN jsonb_build_object(
    'id', v.id,
    'event_id', v.event_id,
    'person_id', v.person_id,
    'lead_id', v.group_lead_registration_id,
    'status', v.status,
    'payment_status', v.payment_status,
    'block', v_block,
    'admission', CASE
      WHEN v.status = 'waitlist' THEN 'waitlisted'
      WHEN v.status IN ('draft', 'pending') THEN 'awaitingDecision'
      ELSE 'seated'
    END,
    'user_id', CASE WHEN v.via_card THEN v.payer_user_id ELSE v.holder_user_id END,
    'via_card', v.via_card,
    'payment_order_id', CASE WHEN v.via_card THEN v.payment_order_id END,
    'ticket_type_id', v.ticket_type_id,
    'name_pl', v.name_pl,
    'name_en', v.name_en,
    'currency', v.currency,
    'paid', v.payment_status IN ('paid', 'partially_refunded'),
    'paid_at', v.paid_at,
    'seats', v_seats,
    'gross', v_gross,
    'units', v_units,
    'basis', CASE
      WHEN v.via_card AND v.order_gross IS NOT NULL THEN 'order'
      WHEN v_booked THEN 'booked'
      WHEN v.tax_mode = 'exclusive' THEN 'price_list_net'
      ELSE 'price_list'
    END
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) IS
  'Zapis jako zrodlo dokumentu (bez wyjatkow): block (not_lead, closed, plan_ticket albo NULL), miejsca, kwota i grupy pozycji (zamowienie z karty wg metadata.quantity i benefitu planu; wplata zaksiegowana przez organizatora - INV-14; zapis nieoplacony wg _event_registration_unit_price - oferta z chwili zapisu albo cena biezaca, REG-16; oplacony bez karty i bez ksiegowania - cena fazy z chwili zaplaty), karta, platnik, admission, basis (order/booked/price_list/price_list_net).';