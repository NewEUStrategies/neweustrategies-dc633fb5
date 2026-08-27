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

  -- Zgody sa osobna lista, bo maja inna semantyke niz pytanie: zapisujemy
  -- rowniez fakt ich udzielenia, a etykieta niesie odnosnik do dokumentu.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'key', f.key,
    'label_pl', f.label_pl,
    'label_en', f.label_en,
    'help_pl', f.help_pl,
    'help_en', f.help_en,
    'is_required', f.is_required,
    'consent_url_pl', f.consent_url_pl,
    'consent_url_en', f.consent_url_en,
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
    'effective_price_cents', public._event_ticket_effective_price(
      t.price_cents, t.early_bird_price_cents, t.early_bird_until),
    'early_bird_price_cents', t.early_bird_price_cents,
    'early_bird_until', t.early_bird_until,
    'early_bird_active', (
      t.early_bird_price_cents IS NOT NULL
      AND t.early_bird_until IS NOT NULL
      AND now() <= t.early_bird_until
    ),
    'currency', t.currency,
    'requires_approval', t.requires_approval,
    'requires_access_code', (t.access_code_hash IS NOT NULL),
    'access_code_hint', t.access_code_hint,
    'waitlist_enabled', t.waitlist_enabled,
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

REVOKE ALL ON FUNCTION public.event_registration_form(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_form(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_form(text) IS
  'Formularz zapisu wydarzenia dla frontu: tryb, okno, pola, zgody z odnosnikiem, bilety z cena early-bird i informacja o kodzie dostepu. Kod dostepu nie opuszcza serwera.';

DROP FUNCTION IF EXISTS public.event_register(p_payload jsonb);

CREATE OR REPLACE FUNCTION public.event_register(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event public.events;
  v_ticket public.event_ticket_types;
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid;
  v_ticket_id uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'email', '')));
  v_first text := btrim(COALESCE(p_payload->>'first_name', ''));
  v_last text := btrim(COALESCE(p_payload->>'last_name', ''));
  v_phone text := NULLIF(btrim(COALESCE(p_payload->>'phone', '')), '');
  v_job text := NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), '');
  v_company text := NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), '');
  v_social text := NULLIF(btrim(COALESCE(p_payload->>'social_profile_url', '')), '');
  v_answers jsonb := COALESCE(p_payload->'answers', '{}'::jsonb);
  v_ip_hash text := NULLIF(btrim(COALESCE(p_payload->>'ip_hash', '')), '');
  v_user_agent text := left(NULLIF(btrim(COALESCE(p_payload->>'user_agent', '')), ''), 400);
  v_marketing boolean := lower(COALESCE(p_payload->>'consent_marketing', '')) IN ('true', 't', '1');
  v_partner boolean := lower(COALESCE(p_payload->>'consent_partner_sharing', '')) IN ('true', 't', '1');
  v_data_ok boolean := lower(COALESCE(p_payload->>'consent_data_processing', '')) IN ('true', 't', '1');
  v_access_code text := upper(btrim(COALESCE(p_payload->>'access_code', '')));
  v_accepted uuid[];
  v_active_tickets integer;
  v_person_id uuid;
  v_bind_uid uuid;
  v_missing text[];
  v_verdict text;
  v_status text;
  v_decision_source text;
  v_group_id uuid;
  v_seats_left integer;
  v_position integer;
  v_token text;
  v_manage text;
  v_reg_id uuid;
  v_rate record;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  IF length(p_payload::text) > 65536 THEN
    RAISE EXCEPTION 'payload_too_large: registration payload exceeds 64 kB';
  END IF;

  IF jsonb_typeof(v_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;

  IF v_first = '' OR v_last = '' THEN
    RAISE EXCEPTION 'invalid_name: first name and last name are required';
  END IF;

  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid e-mail address is required';
  END IF;

  IF NOT v_data_ok THEN
    RAISE EXCEPTION 'consent_required: consent to data processing is required';
  END IF;

  IF v_social IS NOT NULL AND v_social !~ '^https://' THEN
    RAISE EXCEPTION 'invalid_social_url: the profile address must start with https://';
  END IF;

  SELECT * INTO v_rate
  FROM public.rate_limit_hit(
    'event_register',
    v_tenant::text || ':' || COALESCE(v_ip_hash, v_email),
    12,
    10
  );
  IF NOT v_rate.allowed THEN
    RAISE EXCEPTION 'rate_limited: too many registration attempts, try again later';
  END IF;

  v_event_id := CASE
    WHEN COALESCE(p_payload->>'event_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'event_id')::uuid
    ELSE NULL
  END;
  v_ticket_id := CASE
    WHEN COALESCE(p_payload->>'ticket_type_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'ticket_type_id')::uuid
    ELSE NULL
  END;

  IF v_event_id IS NULL AND v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id or event_slug is required';
  END IF;

  SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[]) INTO v_accepted
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'accepted_term_ids') = 'array'
        THEN p_payload->'accepted_term_ids'
      ELSE '[]'::jsonb
    END
  ) AS t(x)
  WHERE x ~ '^[0-9a-fA-F-]{36}$';

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND (
      (v_event_id IS NOT NULL AND e.id = v_event_id)
      OR (v_event_id IS NULL AND e.slug = v_slug)
    )
  FOR UPDATE;

  IF v_event.id IS NULL OR v_event.status <> 'published' THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  IF v_event.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_cancelled: the event has been cancelled';
  END IF;

  IF v_event.registration_mode = 'none' THEN
    RAISE EXCEPTION 'registration_disabled: this event does not take registrations';
  END IF;

  IF v_event.registration_mode = 'external' THEN
    RAISE EXCEPTION 'registration_external: registration runs in an external tool';
  END IF;

  IF v_event.rsvp_opens_at IS NOT NULL
     AND v_event.rsvp_opens_at > now()
     AND NOT (
       v_event.early_rsvp_rank IS NOT NULL
       AND public.has_tier_rank(v_event.early_rsvp_rank)
     ) THEN
    RAISE EXCEPTION 'registration_not_open: registration has not opened yet';
  END IF;

  IF v_event.visibility = 'members'
     AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN
    RAISE EXCEPTION 'membership_required: this event is open to members only';
  END IF;

  SELECT count(*)::integer INTO v_active_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  IF v_ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket
    FROM public.event_ticket_types t
    WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant AND t.event_id = v_event.id
    FOR UPDATE;

    IF v_ticket.id IS NULL OR NOT v_ticket.is_active THEN
      RAISE EXCEPTION 'not_found: ticket does not exist for this event';
    END IF;
    IF v_ticket.sales_from IS NOT NULL AND now() < v_ticket.sales_from THEN
      RAISE EXCEPTION 'ticket_not_on_sale: sales for this ticket have not started';
    END IF;
    IF v_ticket.sales_to IS NOT NULL AND now() > v_ticket.sales_to THEN
      RAISE EXCEPTION 'ticket_sales_ended: sales for this ticket are closed';
    END IF;
    IF v_ticket.min_tier_rank > 0 AND NOT public.has_tier_rank(v_ticket.min_tier_rank) THEN
      RAISE EXCEPTION 'ticket_tier_required: this ticket requires a higher membership tier';
    END IF;
    -- Kod dostepu porownujemy po skrocie: jawnego kodu nie ma w bazie, a wielkosc
    -- liter nie moze decydowac o wpuszczeniu na wydarzenie.
    IF v_ticket.access_code_hash IS NOT NULL THEN
      IF v_access_code = ''
         OR encode(digest(v_access_code, 'sha256'), 'hex') <> v_ticket.access_code_hash THEN
        RAISE EXCEPTION 'invalid_access_code: this ticket requires a valid access code';
      END IF;
    END IF;
    v_group_id := v_ticket.group_id;
  ELSIF v_active_tickets > 0 THEN
    RAISE EXCEPTION 'ticket_required: this event sells tickets - pick one';
  END IF;

  IF v_group_id IS NULL THEN
    SELECT g.id INTO v_group_id
    FROM public.event_groups g
    WHERE g.tenant_id = v_tenant AND g.event_id = v_event.id AND g.is_default;
  END IF;

  IF v_event.registration_mode = 'form' THEN
    SELECT COALESCE(array_agg(f.key ORDER BY f.sort_order, f.key), ARRAY[]::text[])
    INTO v_missing
    FROM public.event_registration_fields f
    WHERE f.tenant_id = v_tenant
      AND f.event_id = v_event.id
      AND f.is_active
      AND f.is_required
      AND f.field_type <> 'consent'
      AND NOT public._event_answer_matches('not_empty', 'null'::jsonb, v_answers -> f.key);

    IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
      RAISE EXCEPTION 'missing_required_fields: %', array_to_string(v_missing, ',');
    END IF;

    -- Zgoda obowiazkowa musi byc PRAWDA, nie tylko obecna: brak zaznaczenia to
    -- brak zgody, a puste pole i "false" znacza tu dokladnie to samo.
    SELECT COALESCE(array_agg(f.key ORDER BY f.sort_order, f.key), ARRAY[]::text[])
    INTO v_missing
    FROM public.event_registration_fields f
    WHERE f.tenant_id = v_tenant
      AND f.event_id = v_event.id
      AND f.is_active
      AND f.is_required
      AND f.field_type = 'consent'
      AND NOT public._event_answer_matches('is_true', 'null'::jsonb, v_answers -> f.key);

    IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
      RAISE EXCEPTION 'missing_required_consents: %', array_to_string(v_missing, ',');
    END IF;
  END IF;

  SELECT COALESCE(array_agg(tr.key ORDER BY tr.sort_order, tr.key), ARRAY[]::text[])
  INTO v_missing
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.is_required
    AND tr.display IN ('registration', 'registration_and_access')
    AND NOT (tr.id = ANY (v_accepted));

  IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'terms_required: %', array_to_string(v_missing, ',');
  END IF;

  SELECT p.id INTO v_person_id
  FROM public.event_people p
  WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;

  v_bind_uid := CASE
    WHEN v_uid IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.event_people p2
      WHERE p2.tenant_id = v_tenant
        AND p2.user_id = v_uid
        AND (v_person_id IS NULL OR p2.id <> v_person_id)
    ) THEN NULL
    ELSE v_uid
  END;

  IF v_person_id IS NULL THEN
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, phone, job_title,
      company_text, social_profile_url, source,
      consent_data_processing_at, consent_marketing_at, consent_partner_sharing_at,
      created_by
    ) VALUES (
      v_tenant, v_bind_uid, v_email, v_first, v_last, v_phone, v_job,
      v_company, v_social, 'self_registration',
      now(),
      CASE WHEN v_marketing THEN now() END,
      CASE WHEN v_partner THEN now() END,
      v_uid
    )
    RETURNING id INTO v_person_id;
  ELSE
    UPDATE public.event_people p SET
      user_id = COALESCE(p.user_id, v_bind_uid),
      first_name = v_first,
      last_name = v_last,
      phone = COALESCE(v_phone, p.phone),
      job_title = COALESCE(v_job, p.job_title),
      company_text = COALESCE(v_company, p.company_text),
      social_profile_url = COALESCE(v_social, p.social_profile_url),
      consent_data_processing_at = COALESCE(p.consent_data_processing_at, now()),
      consent_marketing_at = CASE
        WHEN v_marketing THEN COALESCE(p.consent_marketing_at, now())
        ELSE p.consent_marketing_at
      END,
      consent_partner_sharing_at = CASE
        WHEN v_partner THEN COALESCE(p.consent_partner_sharing_at, now())
        ELSE p.consent_partner_sharing_at
      END,
      consent_withdrawn_at = NULL
    WHERE p.id = v_person_id AND p.tenant_id = v_tenant;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant
      AND r.event_id = v_event.id
      AND r.person_id = v_person_id
      AND r.status NOT IN ('cancelled', 'rejected')
  ) THEN
    RAISE EXCEPTION 'already_registered: this person already has an active registration';
  END IF;

  v_verdict := public._event_registration_verdict(v_tenant, v_event.id, v_answers);

  IF v_verdict = 'reject' THEN
    v_status := 'rejected';
    v_decision_source := 'automatic_rule';
  ELSIF v_verdict = 'approval' THEN
    v_status := 'pending';
  ELSIF v_verdict = 'auto_approve' THEN
    v_status := 'approved';
    v_decision_source := 'automatic_rule';
  ELSE
    v_status := CASE WHEN v_event.registration_flow = 'approval' THEN 'pending' ELSE 'approved' END;
    v_decision_source := CASE WHEN v_status = 'approved' THEN 'system' ELSE NULL END;
  END IF;

  IF v_ticket.id IS NOT NULL AND v_ticket.requires_approval AND v_status = 'approved' THEN
    v_status := 'pending';
    v_decision_source := NULL;
  END IF;

  IF v_status = 'approved' THEN
    v_seats_left := public._event_seats_left(v_tenant, v_event.id, v_ticket.id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      IF v_ticket.id IS NOT NULL AND NOT v_ticket.waitlist_enabled THEN
        RAISE EXCEPTION 'sold_out: no seats left and the waiting list is closed';
      END IF;
      v_status := 'waitlist';
      v_decision_source := 'capacity';
      v_position := public._event_next_waitlist_position(v_tenant, v_event.id);
    END IF;
  END IF;

  IF v_status = 'approved' THEN
    v_token := public._event_new_qr_token();
  END IF;
  v_manage := public._event_new_qr_token();

  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source,
    decided_at, decision_source, qr_token_hash, qr_issued_at,
    manage_token_hash, waitlist_position, created_by
  ) VALUES (
    v_tenant, v_event.id, v_person_id, v_ticket.id, v_group_id, v_status,
    CASE WHEN v_event.registration_mode = 'form' THEN 'form' ELSE 'rsvp' END,
    v_answers, 'self_registration',
    CASE WHEN v_decision_source IS NOT NULL THEN now() END,
    v_decision_source,
    CASE WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex') END,
    CASE WHEN v_token IS NOT NULL THEN now() END,
    encode(digest(v_manage, 'sha256'), 'hex'),
    v_position,
    v_uid
  )
  RETURNING id INTO v_reg_id;

  INSERT INTO public.event_term_acceptances (
    tenant_id, term_id, person_id, registration_id, version, ip_hash, user_agent
  )
  SELECT v_tenant, tr.id, v_person_id, v_reg_id, tr.version, v_ip_hash, v_user_agent
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.id = ANY (v_accepted)
  ON CONFLICT (tenant_id, term_id, person_id, version) DO NOTHING;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_event.id,
      'person_id', v_person_id,
      'status', v_status,
      'ticket_type_id', v_ticket.id,
      'source', 'self_registration'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'registration_id', v_reg_id,
    'person_id', v_person_id,
    'status', v_status,
    'decision_source', v_decision_source,
    'waitlist_position', v_position,
    'ticket_type_id', v_ticket.id,
    'group_id', v_group_id,
    'qr_token', v_token,
    'manage_token', v_manage
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_register(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_register(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_register(jsonb) IS
  'Publiczny zapis na wydarzenie. Waliduje pola wymagane, zgody per pole, kod dostepu biletu, okno sprzedazy i pule; przy wylaczonej liscie rezerwowej brak miejsc konczy sie sold_out.';
