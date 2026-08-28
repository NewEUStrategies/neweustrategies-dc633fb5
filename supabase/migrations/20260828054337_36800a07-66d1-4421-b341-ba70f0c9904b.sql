CREATE OR REPLACE FUNCTION public.event_ticket_checkout_quote(p_ticket_type_id uuid, p_access_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  t public.event_ticket_types;
  e public.events;
  v_phase jsonb;
  v_seats integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to buy a ticket';
  END IF;
  IF v_tenant IS NULL OR p_ticket_type_id IS NULL THEN
    RAISE EXCEPTION 'ticket_not_available';
  END IF;

  SELECT * INTO t FROM public.event_ticket_types x
  WHERE x.id = p_ticket_type_id AND x.tenant_id = v_tenant;
  IF t.id IS NULL OR NOT t.is_active THEN
    RAISE EXCEPTION 'ticket_not_available';
  END IF;

  SELECT * INTO e FROM public.events x
  WHERE x.id = t.event_id AND x.tenant_id = v_tenant AND x.status = 'published';
  IF e.id IS NULL OR e.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'ticket_not_available';
  END IF;
  IF e.starts_at IS NOT NULL AND e.starts_at < now() THEN
    RAISE EXCEPTION 'event_finished';
  END IF;

  IF t.sales_from IS NOT NULL AND now() < t.sales_from THEN
    RAISE EXCEPTION 'ticket_sales_not_open';
  END IF;
  IF t.sales_to IS NOT NULL AND now() > t.sales_to THEN
    RAISE EXCEPTION 'ticket_sales_closed';
  END IF;
  IF t.min_tier_rank > 0 AND NOT public.has_tier_rank(t.min_tier_rank) THEN
    RAISE EXCEPTION 'ticket_tier_required';
  END IF;
  IF t.access_code_hash IS NOT NULL THEN
    IF p_access_code IS NULL
      OR encode(digest(upper(btrim(p_access_code)), 'sha256'), 'hex') <> t.access_code_hash THEN
      RAISE EXCEPTION 'ticket_access_code_invalid';
    END IF;
  END IF;

  v_seats := public._event_seats_left(v_tenant, t.event_id, t.id);
  IF v_seats IS NOT NULL AND v_seats <= 0 THEN
    RAISE EXCEPTION 'ticket_sold_out';
  END IF;

  v_phase := public._event_ticket_phase(
    t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule, now());

  RETURN jsonb_build_object(
    'ticket_type_id', t.id,
    'event_id', t.event_id,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'name_pl', t.name_pl,
    'name_en', t.name_en,
    'amount_cents', (v_phase->>'price_cents')::integer,
    -- Cena regularna: nakładka płatności pokazuje rabat fazy jako osobną
    -- pozycję, a nie tylko kwotę końcową.
    'list_price_cents', t.price_cents,
    'currency', t.currency,
    'requires_approval', t.requires_approval,
    'seats_left', v_seats,
    'phase', v_phase
  );
END;
$function$;