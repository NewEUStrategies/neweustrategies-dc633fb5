-- 20260828203000_event_session_access_tier_gate.sql
-- events-harness: include
CREATE OR REPLACE FUNCTION public.event_session_access(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_session public.event_sessions;
  v_event public.events;
  v_staff boolean := false;
  v_allowed boolean;
  v_signed boolean;
  v_can_watch boolean;
BEGIN
  IF v_tenant IS NULL OR _session_id IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'not_found');
  END IF;

  SELECT s.* INTO v_session
  FROM public.event_sessions s
  JOIN public.events e
    ON e.id = s.event_id AND e.tenant_id = s.tenant_id
  WHERE s.id = _session_id
    AND s.tenant_id = v_tenant
    AND s.status = 'published'
    AND e.status = 'published';

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'not_found');
  END IF;

  -- Wiersz wydarzenia - to jego brak byl cala usterka.
  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.id = v_session.event_id AND e.tenant_id = v_tenant;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'not_found');
  END IF;

  v_staff := v_event.tenant_id = public.current_tenant_id()
         AND v_uid IS NOT NULL
         AND (public.has_role(v_uid, 'admin'::app_role)
              OR public.has_role(v_uid, 'editor'::app_role));

  -- Niezalogowany nie dostaje adresow.
  IF NOT v_staff AND v_uid IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'auth_required');
  END IF;

  IF v_staff THEN
    v_allowed := true;
  ELSIF v_event.visibility = 'members' AND v_event.kind = 'briefing' THEN
    v_allowed := public.has_tier_feature('pro_briefings');
  ELSIF v_event.visibility = 'members' THEN
    v_allowed := public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1));
  ELSE
    v_allowed := public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0));
  END IF;

  IF v_allowed AND NOT v_staff AND v_event.chatham_house THEN
    v_allowed := public.has_tier_feature('chatham_house_events');
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'tier_required');
  END IF;

  -- Wlasna ranga SESJI - warunek sprzed tej migracji, zachowany bez zmian.
  IF NOT v_staff
     AND v_session.min_tier_rank > 0
     AND NOT public.has_tier_rank(v_session.min_tier_rank) THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'tier_required');
  END IF;

  v_signed := v_staff OR NOT v_session.requires_signup OR EXISTS (
    SELECT 1 FROM public.event_session_signups g
    WHERE g.tenant_id = v_tenant
      AND g.session_id = _session_id
      AND g.user_id = v_uid
      AND g.status = 'registered'
  );

  -- NAGRANIE ZALEZY OD RANGI, NIE OD ZAPISU I NIE OD FLAGI `recordings`.
  v_can_watch := v_session.recording_url IS NOT NULL;

  RETURN jsonb_build_object(
    'can_stream', v_signed,
    'can_watch', v_can_watch,
    'reason', CASE WHEN v_signed THEN 'granted' ELSE 'signup_required' END,
    'stream_url', CASE WHEN v_signed THEN v_session.stream_url END,
    'recording_url', CASE WHEN v_can_watch THEN v_session.recording_url END,
    'chatham_house', v_session.chatham_house
  );
END;
$$;

COMMENT ON FUNCTION public.event_session_access(uuid) IS
  'Dostep do transmisji i nagrania SESJI. Bramka wydarzenia jest odwzorowaniem get_event_access (obsada, auth_required, widocznosc, ranga, Chatham House), a nie druga regula. Nagranie idzie za sama ta bramka - BEZ wymogu zapisu na sesje i BEZ flagi recordings, bo zapis otwiera transmisje (miejsce na sali), a nie archiwum. Wczesniej sprawdzana byla wylacznie wlasna ranga sesji, przez co niezalogowany czytal nagrania wydarzenia dla czlonkow.';

REVOKE ALL ON FUNCTION public.event_session_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_session_access(uuid) TO anon, authenticated, service_role;

-- 20260828204000_event_registration_form_consents.sql
-- events-harness: include
CREATE OR REPLACE FUNCTION public.event_registration_form(p_event_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.status = 'published';

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_seats_left := public._event_seats_left(v_tenant, v_event.id, NULL);

  SELECT count(*)::integer INTO v_active_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  v_reason := CASE
    WHEN v_event.cancelled_at IS NOT NULL THEN 'event_cancelled'
    WHEN v_event.registration_mode = 'none' THEN 'registration_disabled'
    WHEN v_event.registration_mode = 'external' THEN 'registration_external'
    WHEN v_event.rsvp_opens_at IS NOT NULL
      AND v_event.rsvp_opens_at > now()
      AND NOT (
        v_event.early_rsvp_rank IS NOT NULL
        AND public.has_tier_rank(v_event.early_rsvp_rank)
      ) THEN 'registration_not_open'
    WHEN v_event.visibility = 'members'
      AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN 'membership_required'
    WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN 'sold_out'
    ELSE NULL
  END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'key', f.key,
    'field_type', f.field_type,
    'label_pl', f.label_pl,
    'label_en', f.label_en,
    'help_pl', f.help_pl,
    'help_en', f.help_en,
    'is_required', f.is_required,
    'options', f.options,
    'sort_order', f.sort_order
  ) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_fields
  FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant
    AND f.event_id = v_event.id
    AND f.is_active
    AND f.field_type <> 'consent';

  -- ZGODY: ta sama tabela, ta sama projekcja, inny ekran.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'key', f.key,
    'field_type', f.field_type,
    'label_pl', f.label_pl,
    'label_en', f.label_en,
    'help_pl', f.help_pl,
    'help_en', f.help_en,
    'is_required', f.is_required,
    'options', f.options,
    'sort_order', f.sort_order
  ) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_consents
  FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant
    AND f.event_id = v_event.id
    AND f.is_active
    AND f.field_type = 'consent';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'key', t.key,
    'name_pl', t.name_pl,
    'name_en', t.name_en,
    'description_pl', t.description_pl,
    'description_en', t.description_en,
    'price_cents', t.price_cents,
    'effective_price_cents', public._event_ticket_price_now(
      t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule),
    'phase', public._event_ticket_phase(
      t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule, now()),
    'benefits_pl', to_jsonb(t.benefits_pl),
    'benefits_en', to_jsonb(t.benefits_en),
    'requires_access_code', (t.access_code_hash IS NOT NULL),
    'access_code_hint', t.access_code_hint,
    'currency', t.currency,
    'requires_approval', t.requires_approval,
    'min_tier_rank', t.min_tier_rank,
    'sales_from', t.sales_from,
    'sales_to', t.sales_to,
    'seats_left', public._event_seats_left(v_tenant, v_event.id, t.id),
    'availability', CASE
      WHEN t.sales_from IS NOT NULL AND now() < t.sales_from THEN 'scheduled'
      WHEN t.sales_to IS NOT NULL AND now() > t.sales_to THEN 'ended'
      WHEN t.quota IS NOT NULL AND t.sold_count >= t.quota THEN 'sold_out'
      ELSE 'on_sale'
    END,
    'tier_locked', (t.min_tier_rank > 0 AND NOT public.has_tier_rank(t.min_tier_rank)),
    'sort_order', t.sort_order
  ) ORDER BY t.sort_order, t.key), '[]'::jsonb)
  INTO v_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tr.id,
    'key', tr.key,
    'label_pl', tr.label_pl,
    'label_en', tr.label_en,
    'body_pl', tr.body_pl,
    'body_en', tr.body_en,
    'external_url', tr.external_url,
    'is_required', tr.is_required,
    'version', tr.version,
    'sort_order', tr.sort_order
  ) ORDER BY tr.sort_order, tr.key), '[]'::jsonb)
  INTO v_terms
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.display IN ('registration', 'registration_and_access');

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'slug', v_event.slug,
      'title_pl', v_event.title_pl,
      'title_en', v_event.title_en,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at,
      'timezone', v_event.timezone,
      'registration_mode', v_event.registration_mode,
      'registration_flow', v_event.registration_flow,
      'external_registration_url', v_event.external_registration_url,
      'capacity', v_event.capacity,
      'seats_left', v_seats_left,
      'rsvp_opens_at', v_event.rsvp_opens_at
    ),
    'is_open', (v_reason IS NULL),
    'closed_reason', v_reason,
    'fields', v_fields,
    'consents', v_consents,
    'tickets', v_tickets,
    'terms', v_terms
  );
END;
$$;

COMMENT ON FUNCTION public.event_registration_form(text) IS
  'Formularz zapisu dla strony publicznej: wydarzenie, stan otwarcia, pytania kwalifikacyjne (fields), ZGODY (consents), bilety i regulaminy. Klucz consents byl brakujaca polowa rozdzialu z 20260827220945 - bez niego wymagana zgoda blokowala zapisy na gluchy zamek.';

-- 20260828205000_domain_events_multi_segment_type.sql
-- events-harness: include
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.domain_events'::regclass
      AND conname = 'domain_events_event_type_check'
  ) THEN
    ALTER TABLE public.domain_events DROP CONSTRAINT domain_events_event_type_check;
  END IF;
END
$$;

ALTER TABLE public.domain_events
  ADD CONSTRAINT domain_events_event_type_check
  CHECK (event_type ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$');

COMMENT ON CONSTRAINT domain_events_event_type_check ON public.domain_events IS
  'Nazwa zdarzenia: co najmniej dwa czlony rozdzielone kropka i wersja .vN na koncu. Wczesniej dopuszczala DOKLADNIE dwa czlony, przez co szesc zdarzen event.registration.* modulu Wydarzen bylo odrzucanych przy INSERT, a emit_domain_event polykal wyjatek - ginely bez sladu.';