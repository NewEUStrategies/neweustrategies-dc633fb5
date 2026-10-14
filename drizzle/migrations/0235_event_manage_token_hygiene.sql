CREATE OR REPLACE FUNCTION public.event_registration_manage_view(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_token text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_reg_id uuid := CASE
    WHEN COALESCE(p_payload->>'registration_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'registration_id')::uuid
    ELSE NULL
  END;
  v_reg public.event_registrations;
  v_ticket public.event_ticket_types;
  v_event public.events;
  v_key_id uuid;
  v_key_verdict text;
  v_unit jsonb;
  v_owned boolean := false;
BEGIN
  IF v_tenant IS NULL OR (v_token IS NULL AND v_reg_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_token IS NOT NULL THEN
    SELECT k.registration_id, k.verdict INTO v_key_id, v_key_verdict
      FROM public._event_manage_token_resolve(v_tenant, v_token, 'view') k;
    IF v_key_verdict = 'expired' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    ELSIF v_key_verdict IS DISTINCT FROM 'ok' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    SELECT r.* INTO v_reg
    FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant
      AND r.id = v_key_id;
  ELSE
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    SELECT r.* INTO v_reg
    FROM public.event_registrations r
    LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE r.id = v_reg_id
      AND r.tenant_id = v_tenant
      AND (r.created_by = v_uid OR p.user_id = v_uid);
  END IF;

  IF v_reg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_event FROM public.events e
  WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant;

  IF v_reg.ticket_type_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.event_ticket_types t
    WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant;
  END IF;

  v_unit := public._event_registration_unit_price(v_reg, v_ticket);

  v_owned := v_uid IS NOT NULL AND (
    v_reg.created_by = v_uid
    OR EXISTS (SELECT 1 FROM public.event_people p
               WHERE p.id = v_reg.person_id AND p.tenant_id = v_tenant AND p.user_id = v_uid)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg.id,
    'event_id', v_reg.event_id,
    'event_slug', v_event.slug,
    'ticket_type_id', v_reg.ticket_type_id,
    'status', v_reg.status,
    'payment_status', v_reg.payment_status,
    'waitlist_position', v_reg.waitlist_position,
    'amount_cents', COALESCE((v_unit->>'amount_cents')::integer, 0),
    'price_source', COALESCE(v_unit->>'source', 'current'),
    'quote_valid_until', v_unit->'quote_valid_until',
    'currency', v_ticket.currency,
    'owned_by_caller', v_owned
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_manage_view(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_manage_view(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_manage_view(jsonb) IS
  'Stan wlasnego zgloszenia pod kluczem manage_token (gosc; _event_manage_token_resolve cel view: po koncu wydarzenia {ok:false, reason:expired}, po anulowaniu sam status) albo pod identyfikatorem (wlasciciel konta). Oddaje MINIMUM potrzebne stronie samoobslugi: status, os pieniedzy, kwote zgloszenia (_event_registration_unit_price; price_source quote|current, quote_valid_until) i to, czy zalogowany jest wlascicielem. Zadnych danych osobowych.';

CREATE OR REPLACE FUNCTION public.event_registration_attribution_attach(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_now timestamptz := now();
  v_token text;
  v_ad boolean;
  v_key_id uuid;
  v_key_verdict text;
  v_reg_id uuid;
  v_reg_event uuid;
  v_reg_person uuid;
  v_reg_created timestamptz;
  v_slug text;
  v_title_pl text;
  v_title_en text;
  v_first jsonb;
  v_last jsonb;
  v_click jsonb;
  v_source text;
  v_medium text;
  v_campaign text;
  v_tags text[];
  v_summary_pl text;
  v_summary_en text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: a payload object is required';
  END IF;

  v_token := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  IF v_tenant IS NULL OR v_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT k.registration_id, k.verdict INTO v_key_id, v_key_verdict
    FROM public._event_manage_token_resolve(v_tenant, v_token, 'act') k;
  IF v_key_verdict IS DISTINCT FROM 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'reason', COALESCE(v_key_verdict, 'not_found'));
  END IF;

  SELECT r.id, r.event_id, r.person_id, r.created_at
    INTO v_reg_id, v_reg_event, v_reg_person, v_reg_created
    FROM public.event_registrations r
   WHERE r.tenant_id = v_tenant
     AND r.id = v_key_id
   FOR UPDATE;
  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_reg_created < v_now - interval '1 day' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_late');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_registration_attributions a
     WHERE a.tenant_id = v_tenant AND a.registration_id = v_reg_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'attached', false, 'reason', 'already_attached');
  END IF;

  v_ad := COALESCE(p_payload->>'ad_consent', '') = 'true';
  v_first := public._event_ads_touch(p_payload->'first', v_ad, v_now);
  v_last := public._event_ads_touch(p_payload->'last', v_ad, v_now);
  v_first := COALESCE(v_first, v_last);
  v_last := COALESCE(v_last, v_first);
  v_click := CASE
    WHEN v_last->>'click_id' IS NOT NULL THEN v_last
    WHEN v_first->>'click_id' IS NOT NULL THEN v_first
  END;
  v_source := COALESCE(v_last->>'source', '(direct)');
  v_medium := COALESCE(v_last->>'medium', '(none)');
  v_campaign := v_last->>'utm_campaign';

  INSERT INTO public.event_registration_attributions AS a (
    tenant_id, registration_id, event_id, first_touch, last_touch, source, medium,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, gad_source, gad_campaign_id,
    referrer_host, click_id_type, click_id, click_at, ad_user_data, ad_personalization, created_at
  ) VALUES (
    v_tenant, v_reg_id, v_reg_event, v_first, v_last, v_source, v_medium,
    v_last->>'utm_source', v_last->>'utm_medium', v_campaign, v_last->>'utm_term',
    v_last->>'utm_content', v_last->>'gad_source', v_last->>'gad_campaign_id',
    v_last->>'referrer_host', v_click->>'click_id_type', v_click->>'click_id',
    (v_click->>'touch_at')::timestamptz, v_ad, v_ad, v_now
  )
  ON CONFLICT (tenant_id, registration_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'attached', false, 'reason', 'already_attached');
  END IF;

  SELECT e.slug, e.title_pl, e.title_en INTO v_slug, v_title_pl, v_title_en
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_reg_event;

  v_tags := ARRAY['event:' || v_slug];
  IF v_campaign IS NOT NULL THEN
    v_tags := v_tags || left(
      'utm_campaign:' || btrim(regexp_replace(lower(v_campaign), '[^a-z0-9._-]+', '-', 'g'), '-'),
      60
    );
  END IF;
  v_summary_pl := CASE
    WHEN v_campaign IS NOT NULL
      THEN format('Zapis na wydarzenie z kampanii %s (%s / %s)', v_campaign, v_source, v_medium)
    WHEN v_last IS NOT NULL
      THEN format('Zapis na wydarzenie z %s / %s', v_source, v_medium)
    ELSE 'Zapis na wydarzenie bez kampanii'
  END;
  v_summary_en := CASE
    WHEN v_campaign IS NOT NULL
      THEN format('Event registration from campaign %s (%s / %s)', v_campaign, v_source, v_medium)
    WHEN v_last IS NOT NULL
      THEN format('Event registration from %s / %s', v_source, v_medium)
    ELSE 'Event registration without a campaign'
  END;

  PERFORM public._event_person_crm_sync(
    v_tenant,
    v_reg_person,
    'event_participant',
    'event:' || v_slug || ':registration',
    v_tags,
    jsonb_strip_nulls(jsonb_build_object(
      'utm_source', v_last->>'utm_source',
      'utm_medium', v_last->>'utm_medium',
      'utm_campaign', v_campaign,
      'gad_campaign_id', v_last->>'gad_campaign_id'
    )),
    true,
    'event.registration.attributed',
    jsonb_strip_nulls(jsonb_build_object(
      'event_id', v_reg_event,
      'event_slug', v_slug,
      'event_title_pl', v_title_pl,
      'event_title_en', v_title_en,
      'summary_pl', v_summary_pl,
      'summary_en', v_summary_en,
      'registration_id', v_reg_id,
      'source', v_source,
      'medium', v_medium,
      'utm_campaign', v_campaign,
      'gad_campaign_id', v_last->>'gad_campaign_id'
    ))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'attached', true,
    'source', v_source,
    'medium', v_medium,
    'click', v_click IS NOT NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_attribution_attach(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_attribution_attach(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_attribution_attach(jsonb) IS
  'Przypiecie dotkniecia kampanii do wlasnego zgloszenia pod kluczem manage_token (plaszczyzna publiczna, public_tenant_id, bez has_role; klucz przez _event_manage_token_resolve cel act - wygasly/zamkniety/nieznany -> {ok:false, reason:expired|closed|not_found}). Zapis raz, w dobie od zapisu; identyfikator klikniecia tylko przy ad_consent. Wola most CRM (_event_person_crm_sync: segment event_participant, tagi event:<slug> i utm_campaign:<c>, wpis osi czasu event.registration.attributed) - bez identyfikatora klikniecia.';

CREATE OR REPLACE FUNCTION public.event_ticket_seats(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug', '')), '');
  v_qr text := NULLIF(btrim(COALESCE(p_payload->>'qr_token', '')), '');
  v_manage text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_key_id uuid;
  v_key_verdict text;
  v_reg uuid;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RETURN jsonb_build_object('seats', '[]'::jsonb);
  END IF;
  IF v_manage IS NOT NULL THEN
    SELECT k.registration_id, k.verdict INTO v_key_id, v_key_verdict
      FROM public._event_manage_token_resolve(v_tenant, v_manage, 'view') k;
    IF v_key_verdict = 'ok' THEN
      SELECT r.id INTO v_reg
        FROM public.event_registrations r
        JOIN public.events e ON e.tenant_id = r.tenant_id AND e.id = r.event_id
       WHERE r.tenant_id = v_tenant AND r.id = v_key_id AND e.slug = v_slug;
    END IF;
  END IF;
  IF v_reg IS NULL AND v_qr IS NOT NULL AND v_qr ~ '^[A-Za-z0-9_-]{32}$' THEN
    SELECT r.id INTO v_reg
      FROM public.event_registrations r
      JOIN public.events e ON e.tenant_id = r.tenant_id AND e.id = r.event_id
     WHERE r.tenant_id = v_tenant AND e.slug = v_slug
       AND r.qr_token_hash = encode(digest(v_qr, 'sha256'), 'hex');
  END IF;
  IF v_reg IS NULL THEN
    RETURN jsonb_build_object('seats', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object('seats', public._event_seat_cards(v_tenant, ARRAY[v_reg]));
END;
$$;
REVOKE ALL ON FUNCTION public.event_ticket_seats(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_ticket_seats(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_ticket_seats(jsonb) IS
  'Miejsce na sali na stronie biletu: zgloszenie wskazane kluczem samoobslugi (_event_manage_token_resolve cel view: tylko ok - po koncu wydarzenia pusta lista) albo skrotem kodu QR z fragmentu adresu (baza trzyma tylko SHA-256), tylko plany opublikowane, ten sam minimalny ksztalt co event_my_seats. Nieznany kod = pusta lista (bez rozroznienia przyczyny). Plaszczyzna tresci: public_tenant_id(), bez has_role.';

CREATE OR REPLACE FUNCTION public.event_registration_notify_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
BEGIN
  IF v_tenant IS NULL OR NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_request: manage_token is required';
  END IF;
  RETURN public.event_registration_notify_payload_for_tenant(v_tenant, p_payload);
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_notify_payload(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_registration_notify_payload(jsonb) TO service_role;

COMMENT ON FUNCTION public.event_registration_notify_payload(jsonb) IS
  'REG-17: obwodka zgodnosci event_registration_notify_payload_for_tenant(public_tenant_id(), p_payload) - ta sama regula klucza (cel contact: po koncu wydarzenia manage_expired, po anulowaniu not_found), bez nazwiska i notatki. Tylko service_role; serwer wola _for_tenant z najemca z zaufanego hosta.';

CREATE OR REPLACE FUNCTION public._event_registration_actor(
  _tenant uuid, _registration_id uuid, _uid uuid, _manage_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_key_id uuid;
  v_key_verdict text;
  r public.event_registrations;
  v_holder uuid;
  v_payer uuid;
  v_via boolean;
  v_group boolean;
BEGIN
  IF _tenant IS NULL THEN
    RETURN jsonb_build_object('exists', false);
  END IF;
  IF _manage_token IS NOT NULL AND btrim(_manage_token) <> '' THEN
    SELECT k.registration_id, k.verdict INTO v_key_id, v_key_verdict
      FROM public._event_manage_token_resolve(_tenant, _manage_token, 'act') k;
  END IF;

  IF _registration_id IS NOT NULL THEN
    SELECT x.* INTO r FROM public.event_registrations x
     WHERE x.id = _registration_id AND x.tenant_id = _tenant;
  ELSIF v_key_id IS NOT NULL THEN
    SELECT x.* INTO r FROM public.event_registrations x
     WHERE x.id = v_key_id AND x.tenant_id = _tenant;
  END IF;

  IF r.id IS NULL THEN
    RETURN jsonb_build_object('exists', false);
  END IF;

  v_via := COALESCE(v_key_verdict = 'ok' AND v_key_id = r.id, false);

  SELECT p.user_id INTO v_holder
    FROM public.event_people p
   WHERE p.id = r.person_id AND p.tenant_id = r.tenant_id;

  IF r.payment_order_id IS NOT NULL THEN
    SELECT o.user_id INTO v_payer
      FROM public.payment_orders o
     WHERE o.id = r.payment_order_id AND o.tenant_id = r.tenant_id;
  END IF;

  v_group := r.group_lead_registration_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.event_registrations g
                WHERE g.tenant_id = r.tenant_id AND g.group_lead_registration_id = r.id);

  RETURN jsonb_build_object(
    'exists', true,
    'registration_id', r.id,
    'tenant_id', r.tenant_id,
    'event_id', r.event_id,
    'person_id', r.person_id,
    'ticket_type_id', r.ticket_type_id,
    'status', r.status,
    'payment_status', r.payment_status,
    'source', r.source,
    'group_lead_registration_id', r.group_lead_registration_id,
    'is_group', v_group,
    'via_token', v_via,
    'token_verdict', CASE
      WHEN v_key_verdict IS NULL THEN NULL
      WHEN v_key_id IS NOT DISTINCT FROM r.id THEN v_key_verdict
      ELSE 'not_found'
    END,
    'is_holder', v_via OR COALESCE(_uid IS NOT NULL AND v_holder = _uid, false),
    'is_registrant', COALESCE(_uid IS NOT NULL AND r.created_by = _uid, false),
    'is_payer', COALESCE(_uid IS NOT NULL AND v_payer = _uid, false),
    'holder_user_id', v_holder,
    'payer_user_id', v_payer,
    'payment_order_id', r.payment_order_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._event_registration_actor(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_actor(uuid, uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_registration_actor(uuid, uuid, uuid, text) IS
  'Kim jest wolajacy wobec zgloszenia: posiadacz (konto osoby albo klucz samoobslugi - _event_manage_token_resolve cel act: tylko werdykt ok dla TEGO zgloszenia), zglaszajacy (created_by), platnik (payment_orders.user_id). Szukanie po id albo po kluczu, ZAWSZE w obrebie najemcy; brak = {"exists":false}. token_verdict: werdykt klucza dla zgloszenia (NULL bez klucza).';