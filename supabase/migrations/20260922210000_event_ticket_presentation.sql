ALTER TABLE public.event_ticket_types
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_price_label boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS price_label_pl text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS price_label_en text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_registration_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.event_ticket_types
  ADD CONSTRAINT event_ticket_types_price_label_len
  CHECK (char_length(price_label_pl) <= 40 AND char_length(price_label_en) <= 40);

CREATE OR REPLACE FUNCTION public.admin_event_ticket_presentation(p_event_id uuid)
RETURNS TABLE(id uuid, is_hidden boolean, show_price_label boolean, price_label_pl text, price_label_en text, group_registration_enabled boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY SELECT t.id, t.is_hidden, t.show_price_label, t.price_label_pl, t.price_label_en, t.group_registration_enabled
  FROM public.event_ticket_types t WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_event_ticket_set_presentation(
  p_ticket_id uuid, p_is_hidden boolean, p_show_price_label boolean,
  p_price_label_pl text, p_price_label_en text, p_group_registration_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_tenant uuid := public.assert_editor_tenant();
BEGIN
  UPDATE public.event_ticket_types t SET
    is_hidden = COALESCE(p_is_hidden, false),
    show_price_label = COALESCE(p_show_price_label, true),
    price_label_pl = left(btrim(COALESCE(p_price_label_pl, '')), 40),
    price_label_en = left(btrim(COALESCE(p_price_label_en, '')), 40),
    group_registration_enabled = COALESCE(p_group_registration_enabled, false),
    updated_at = now()
  WHERE t.id = p_ticket_id AND t.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: ticket does not exist in this tenant'; END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_presentation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_event_ticket_set_presentation(uuid, boolean, boolean, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_presentation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_set_presentation(uuid, boolean, boolean, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.event_registration_form(p_event_slug text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event public.events;
  v_slug text := NULLIF(btrim(COALESCE(p_event_slug, '')), '');
  v_seats_left integer;
  v_reason text;
  v_fields jsonb;
  v_consents jsonb;
  v_tickets jsonb;
  v_terms jsonb;
  v_active_tickets integer;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;
  SELECT * INTO v_event FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.status = 'published';
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'not_found: event does not exist'; END IF;
  v_seats_left := public._event_seats_left(v_tenant, v_event.id, NULL);
  SELECT count(*)::integer INTO v_active_tickets FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;
  v_reason := CASE
    WHEN v_event.cancelled_at IS NOT NULL THEN 'event_cancelled'
    WHEN v_event.registration_mode = 'none' THEN 'registration_disabled'
    WHEN v_event.registration_mode = 'external' THEN 'registration_external'
    WHEN v_event.rsvp_opens_at IS NOT NULL AND v_event.rsvp_opens_at > now()
      AND NOT (v_event.early_rsvp_rank IS NOT NULL AND public.has_tier_rank(v_event.early_rsvp_rank)) THEN 'registration_not_open'
    WHEN v_event.visibility = 'members' AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN 'membership_required'
    WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN 'sold_out'
    ELSE NULL END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id,'key', f.key,'field_type', f.field_type,'label_pl', f.label_pl,'label_en', f.label_en,'help_pl', f.help_pl,'help_en', f.help_en,'is_required', f.is_required,'options', f.options,'sort_order', f.sort_order) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_fields FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant AND f.event_id = v_event.id AND f.is_active AND f.field_type <> 'consent';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id,'key', f.key,'field_type', f.field_type,'label_pl', f.label_pl,'label_en', f.label_en,'help_pl', f.help_pl,'help_en', f.help_en,'is_required', f.is_required,'options', f.options,'sort_order', f.sort_order) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_consents FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant AND f.event_id = v_event.id AND f.is_active AND f.field_type = 'consent';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'key', t.key, 'name_pl', t.name_pl, 'name_en', t.name_en,
    'description_pl', t.description_pl, 'description_en', t.description_en,
    'price_cents', t.price_cents,
    'effective_price_cents', public._event_ticket_price_now(t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule),
    'phase', public._event_ticket_phase(t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule, now()),
    'benefits_pl', to_jsonb(t.benefits_pl), 'benefits_en', to_jsonb(t.benefits_en),
    'requires_access_code', (t.access_code_hash IS NOT NULL), 'access_code_hint', t.access_code_hint,
    'currency', t.currency, 'requires_approval', t.requires_approval, 'min_tier_rank', t.min_tier_rank,
    'sales_from', t.sales_from, 'sales_to', t.sales_to,
    'seats_left', public._event_seats_left(v_tenant, v_event.id, t.id),
    'availability', CASE
      WHEN t.sales_from IS NOT NULL AND now() < t.sales_from THEN 'scheduled'
      WHEN t.sales_to IS NOT NULL AND now() > t.sales_to THEN 'ended'
      WHEN t.quota IS NOT NULL AND t.sold_count >= t.quota THEN 'sold_out'
      ELSE 'on_sale' END,
    'tier_locked', (t.min_tier_rank > 0 AND NOT public.has_tier_rank(t.min_tier_rank)),
    'sort_order', t.sort_order,
    'is_hidden', t.is_hidden, 'show_price_label', t.show_price_label,
    'price_label_pl', t.price_label_pl, 'price_label_en', t.price_label_en,
    'group_registration_enabled', t.group_registration_enabled
  ) ORDER BY t.sort_order, t.key), '[]'::jsonb)
  INTO v_tickets FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', tr.id,'key', tr.key,'label_pl', tr.label_pl,'label_en', tr.label_en,'body_pl', tr.body_pl,'body_en', tr.body_en,'external_url', tr.external_url,'is_required', tr.is_required,'version', tr.version,'sort_order', tr.sort_order) ORDER BY tr.sort_order, tr.key), '[]'::jsonb)
  INTO v_terms FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant AND tr.event_id = v_event.id AND tr.is_active AND tr.display IN ('registration', 'registration_and_access');
  RETURN jsonb_build_object(
    'event', jsonb_build_object('id', v_event.id,'slug', v_event.slug,'title_pl', v_event.title_pl,'title_en', v_event.title_en,'starts_at', v_event.starts_at,'ends_at', v_event.ends_at,'timezone', v_event.timezone,'registration_mode', v_event.registration_mode,'registration_flow', v_event.registration_flow,'external_registration_url', v_event.external_registration_url,'capacity', v_event.capacity,'seats_left', v_seats_left,'rsvp_opens_at', v_event.rsvp_opens_at),
    'is_open', (v_reason IS NULL), 'closed_reason', v_reason,
    'fields', v_fields, 'consents', v_consents, 'tickets', v_tickets, 'terms', v_terms);
END;
$function$;