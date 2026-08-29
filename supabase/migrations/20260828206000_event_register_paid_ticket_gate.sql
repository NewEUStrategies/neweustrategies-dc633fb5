-- ============================================================================
-- `event_register`: PLATNY BILET BYL WYDAWANY ZA DARMO.
--
-- events-harness: include
--
-- CO BYLO ZLE (P1, PIENIADZE - nie estetyka)
--
-- Funkcja sprawdzala przy wybranej wejsciowce WSZYSTKO POZA CENA: `is_active`,
-- okno sprzedazy, `min_tier_rank`, kod dostepu po SHA-256 i pule miejsc.
-- Kolumna `price_cents` nie padala w calym jej ciele ANI RAZU. Zgloszenie
-- powstawalo ze statusem `approved`, z wydanym kodem QR i z domyslnym
-- `payment_status = 'not_required'`.
--
-- Wydarzenie z `registration_mode = 'form'` i biletem za 1200 zl wydawalo ten
-- bilet kazdemu, kto wypelnil formularz: miejsce z puli zajete, kod QR dziala
-- przy bramce, w rozliczeniach ani sladu. Poprawna sciezka kasowa ISTNIEJE
-- OBOK i jest zrobiona dobrze (`event_ticket_checkout_quote` -> koszyk ->
-- `payment_status`), tylko ten przebieg jej nie uzywal.
--
-- CO ROBI TA MIGRACJA
--
--   1. Liczy cene wybranej wejsciowki przez `_event_ticket_price_now`, czyli
--      tak samo jak ekran zapisu - z fazami cenowymi i early bird, a nie
--      z golego `price_cents`. Jedno zrodlo prawdy o cenie.
--   2. Przy cenie > 0 zapisuje `payment_status = 'unpaid'`.
--   3. NIE WYDAJE KODU QR takiemu zgloszeniu. To jest wlasciwa bramka
--      bezpieczenstwa: zgloszenie istnieje i zajmuje miejsce (organizator je
--      widzi, moze nim zarzadzac), ale wejsciowka nie powstaje, dopoki
--      platnosc nie jest potwierdzona.
--   4. Oddaje klientowi `payment_required`, `amount_cents` i `currency`, zeby
--      formularz mial czym pokierowac do kasy zamiast pokazywac potwierdzenie.
--
-- CZEGO TA MIGRACJA CELOWO NIE ROBI
--
--   * NIE SKLEJA DWOCH OSI, ale NIEZAPLACONE ZGLOSZENIE ZOSTAWIA JAKO `pending`.
--     Pierwsza wersja tej migracji zostawiala je `approved` z osobna kolumna
--     `payment_status = 'unpaid'` - os decyzji obok osi pieniedzy. Rozumowanie
--     bylo takie, ze organizator nie odrozni czekajacego na decyzje od
--     czekajacego na przelew. Odrozni: mowi mu o tym wlasnie `payment_status`.
--     Cena tamtego wyboru byla natomiast realna i policzalna: `_event_seats_left`
--     i przelicznik `sold_count` licza statusy `approved / attended / no_show`,
--     wiec KAZDE porzucone zgloszenie zjadalo miejsce z puli NA ZAWSZE - nic
--     takich wierszy nie sprzata. Anonim z dowolnym adresem e-mail mogl w petli
--     wyczerpac pule platnego wydarzenia, nie placac ani zlotowki. Dlatego
--     niezaplacony bilet stoi `pending`: nie trzyma miejsca, a organizator widzi
--     po `payment_status`, na co czeka. Miejsce zajmuje sie dopiero przy
--     zaksiegowaniu wplaty albo przy swiadomej decyzji organizatora.
--   * NIE zamyka recznej odprawy po nazwisku. Organizator, ktory chce wpuscic
--     kogos mimo braku platnosci, nadal moze - to jest furtka SWIADOMA,
--     a nie przeoczenie. Zamkniete jest wylacznie samoobslugowe wejscie kodem.
--   * NIE dotyka `rsvp_event` ani przebiegu bez wejsciowek - tam nie ma ceny.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- KOLUMNA, KTOREJ TA FUNKCJA UZYWA - ZAKLADANA IDEMPOTENTNIE.
--
-- `payment_status` dodaje migracja `20260828053802`. Na produkcji kolumna juz
-- jest i ponizsze `IF NOT EXISTS` jest pustym przebiegiem. W harnessie tamta
-- migracja NIE JEST odtwarzana: nie definiuje zadnej funkcji modulu, wiec nie
-- pasuje do selektora, a poszerzenie selektora o `ALTER TABLE public.event_`
-- wciagneloby `20260713093000_events_module.sql` i `20260714130000_expert_hub.sql`,
-- ktorych powierzchnie harness stawia jako ATRAPE - czyli zepsuloby jego zalozenie.
--
-- Dlatego migracja, ktora z kolumny KORZYSTA, upewnia sie, ze kolumna istnieje.
-- Ksztalt przepisany z oryginalu znak w znak.
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_required';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_registrations'::regclass
      AND conname = 'event_registrations_payment_status_values'
  ) THEN
    ALTER TABLE public.event_registrations
      ADD CONSTRAINT event_registrations_payment_status_values
      CHECK (payment_status IN ('not_required', 'unpaid', 'paid', 'refunded'));
  END IF;
END
$$;

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
  v_price integer := 0;
  v_payment text := 'not_required';
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
    -- CENA WEJSCIOWKI. Do naprawy z tego commita `event_register` NIE PATRZYL
    -- na `price_cents` ani razu: platny bilet byl wydawany za darmo, ze statusem
    -- `approved`, z kodem QR i z `payment_status = 'not_required'`.
    v_price := COALESCE(public._event_ticket_price_now(
      v_ticket.price_cents, v_ticket.early_bird_price_cents,
      v_ticket.early_bird_until, v_ticket.price_schedule), 0);
    IF v_price > 0 THEN
      v_payment := 'unpaid';
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

  -- NIEZAPLACONY BILET NIE TRZYMA MIEJSCA W PULI.
  -- `_event_seats_left` i przelicznik `event_ticket_types.sold_count` licza
  -- statusy `approved / attended / no_show`. Zgloszenie zostawione jako
  -- `approved` z `payment_status = 'unpaid'` zajmowaloby wiec miejsce i sztuke
  -- z puli biletu BEZ KONCA - zadne zadanie takich wierszy nie sprzata, a zapis
  -- jest otwarty dla anonima. Petla zgloszen z roznymi adresami wyczerpalaby
  -- platne wydarzenie za darmo. `pending` znaczy tu dokladnie tyle, ile znaczy
  -- gdzie indziej: zgloszenie istnieje, organizator je widzi, miejsce nie jest
  -- jeszcze zajete. NA CO czeka, mowi `payment_status`, nie `status`.
  IF v_payment = 'unpaid' AND v_status = 'approved' THEN
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

  -- KOD QR JEST PRZEPUSTKA, WIEC NIE POWSTAJE PRZED PLATNOSCIA. Zgloszenie
  -- istnieje i organizator je widzi, ale miejsce z puli NIE jest jeszcze zajete
  -- (status stoi `pending`, patrz wyzej) i wejsciowka nie jest wydana. Z tego
  -- stanu wyprowadza `admin_event_registration_decide` akcja `paid`: ksieguje
  -- wplate, zajmuje miejsce i dopiero wtedy wydaje kod. Reczna odprawa po
  -- nazwisku nadal dziala - to swiadoma furtka dla organizatora, ktory chce
  -- kogos wpuscic mimo braku platnosci.
  IF v_status = 'approved' AND v_payment <> 'unpaid' THEN
    v_token := public._event_new_qr_token();
  END IF;
  v_manage := public._event_new_qr_token();

  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source,
    decided_at, decision_source, qr_token_hash, qr_issued_at,
    manage_token_hash, waitlist_position, payment_status, created_by
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
    v_payment,
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
    'manage_token', v_manage,
    -- Klient MUSI wiedziec, ze zgloszenie nie jest jeszcze wejsciowka - inaczej
    -- pokaze ekran potwierdzenia i wysle mail „do zobaczenia", a nikt nie
    -- zaplaci.
    'payment_status', v_payment,
    'payment_required', (v_payment = 'unpaid'),
    'amount_cents', CASE WHEN v_payment = 'unpaid' THEN v_price END,
    'currency', CASE WHEN v_payment = 'unpaid' THEN v_ticket.currency END
  );
END;
$$;
COMMENT ON FUNCTION public.event_register(jsonb) IS
  'Publiczny zapis na wydarzenie. Przy wejsciowce platnej zapisuje payment_status = unpaid i NIE wydaje kodu QR - wejsciowka powstaje dopiero po potwierdzeniu platnosci; odpowiedz niesie payment_required, amount_cents i currency. Wczesniej cena nie byla sprawdzana w ogole i platny bilet wychodzil za darmo, z dzialajacym kodem QR.';
