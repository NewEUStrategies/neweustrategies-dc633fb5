-- events-harness: include
-- ============================================================================
-- KODY DOSTEPU DO WEJSCIOWEK: LIMIT PROB, KTORY NAPRAWDE WIAZE.
--
-- DEFEKT (audyt platformy, probe-surfaces-1 i -4). Kod dostepu do biletu
-- (prasa, partnerzy, zaproszenia - `event_ticket_types.access_code_hash`,
-- kod wybiera administrator, 4-64 znaki) mial DWIE wyrocznie bez dzialajacego
-- limitu:
--   1. `event_ticket_checkout_quote(uuid, text)` (20260828054337) - STABLE,
--      GRANT dla `authenticated`, bez zadnego licznika: odpowiedz inna niz
--      `ticket_access_code_invalid` potwierdzala kod. Zalogowany wolal ja wprost
--      przez PostgREST w petli.
--   2. `event_register(jsonb)` (20260830090000, GRANT anon) - licznik
--      `rate_limit_hit('event_register', najemca:COALESCE(ip_hash, email))`
--      byl kluczowany wartoscia z LADUNKU (przegladarka nigdy nie wysyla
--      `ip_hash`, wiec kluczem byl e-mail wybrany przez wolajacego), a pudlo
--      konczylo sie wyjatkiem, ktory wycofywal ten zapis.
--
-- ZMIANA:
--   A. `_access_code_probe_guard/_miss(bilet, konto, adres)` - kubelek
--      BILETU (`access_code_miss.ticket`, 60 pudel / 10 min, klucz z bazy)
--      plus wspolny kubelek sond kodow konta i adresu (`_coupon_probe_guard/
--      _miss`, 30 i 120 / 10 min). Straznik jest PODGLADEM przed porownaniem:
--      przy pelnym kubelku odmowe dostaje takze dobry kod.
--   B. `_event_ticket_checkout_quote(najemca, konto, adres, bilet, kod)` -
--      cialo z 20260828054337, VOLATILE (zlicza), pudlo wraca WARTOSCIA
--      `{ok:false, error:'ticket_access_code_invalid'}` zamiast wyjatku.
--      `event_ticket_checkout_quote_for_user(_tenant_id, _user_id,
--      _probe_subject, ...)` - TYLKO `service_role`, tozsamosc konta na czas
--      wywolania (`_set_request_identity`, jak `event_admission_quote_for_user`),
--      bo `has_tier_rank` czyta `auth.uid()`. Stara dwuargumentowa zostaje
--      wrapperem (najemca z hosta, konto z JWT, bez adresu) - TYLKO
--      `service_role`.
--   C. `event_register(jsonb)` - cialo z 20260830090000 z JEDNA zmiana
--      (oznaczona w miejscu): pudlo kodu liczone w kubelku biletu (i konta,
--      gdy zalogowany) i zwracane wartoscia `{ok:false,
--      error:'invalid_access_code'}`. Funkcja zostaje publiczna (anon) - zapis
--      bez konta to jej zadanie.
--
-- CZEGO TO NIE ZAMYKA: anonimowy zapis nie ma kubelka ADRESU - baza nie zna
-- zaufanego adresu klienta, a solony skrot liczy serwer aplikacji. Kubelek
-- biletu ogranicza zgadywanie do 8 640 prob na dobe na bilet (z ~1,7 mln
-- kombinacji dla 4 znakow) kosztem mozliwej 10-minutowej blokady wpisywania
-- kodu tego biletu w trakcie ataku. Pelne domkniecie (adres) wymaga zapisu
-- przez funkcje serwerowa - opisane w docs/HARDENING_FOLLOWUP_2026-10-07.md.
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD. Kod kasy woluje
-- `event_ticket_checkout_quote_for_user` rola serwisowa, a przy PGRST202/42883
-- wraca do starego wywolania JWT kupujacego, ktore dziala do wejscia tej
-- migracji. Formularz zapisu czyta pudlo i jako wyjatek (stara baza), i jako
-- wartosc (nowa) - kolejnosc dla niego nie ma znaczenia.
--
-- IDEMPOTENTNA: CREATE OR REPLACE i bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/ticket_access_code_probe_test.sql.
-- ============================================================================

-- A) KUBELKI PUDEL KODU DOSTEPU ------------------------------------------------
CREATE OR REPLACE FUNCTION public._access_code_probe_guard(p_ticket uuid, p_uid uuid, p_ip_subject text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- Okno jak w `rate_limit_hit` (10 minut).
  v_start timestamptz := to_timestamp((floor(extract(epoch FROM now()) / 600) * 600)::double precision);
  v_count integer;
BEGIN
  -- PODGLAD, nie zliczenie: dobry kod nie zjada kubelka.
  IF p_ticket IS NOT NULL THEN
    SELECT rl.count INTO v_count
      FROM public.rate_limits rl
     WHERE rl.scope = 'access_code_miss.ticket'
       AND rl.subject_id = 'ticket:' || p_ticket::text
       AND rl.window_start = v_start;
    IF COALESCE(v_count, 0) >= 60 THEN
      RAISE EXCEPTION 'rate_limited: too many code attempts, try again later';
    END IF;
  END IF;
  PERFORM public._coupon_probe_guard(p_uid, p_ip_subject);
END $$;
REVOKE ALL ON FUNCTION public._access_code_probe_guard(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._access_code_probe_miss(p_ticket uuid, p_uid uuid, p_ip_subject text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_ticket IS NOT NULL THEN
    -- Bez wyjatku przy przekroczeniu: pudlo i tak jest odmowa, a wyjatek
    -- wycofalby zliczenie. Nastepna proba zatrzyma sie na strazniku.
    PERFORM public.rate_limit_hit('access_code_miss.ticket', 'ticket:' || p_ticket::text, 60, 10);
  END IF;
  PERFORM public._coupon_probe_miss(p_uid, p_ip_subject);
END $$;
REVOKE ALL ON FUNCTION public._access_code_probe_miss(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._access_code_probe_guard(uuid, uuid, text) IS
  'Straznik sond kodu dostepu do biletu: 60 pudel na bilet, 30 na konto, 120 na adres w oknie 10 minut -> rate_limited. Podglad bez zliczania; NULL pomija dany kubelek.';
COMMENT ON FUNCTION public._access_code_probe_miss(uuid, uuid, text) IS
  'Zlicza pudlo kodu dostepu w kubelku biletu (access_code_miss.ticket) oraz konta i adresu (_coupon_probe_miss).';

-- B) WYCENA KASY ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_ticket_checkout_quote(
  p_tenant uuid, p_uid uuid, p_ip_subject text, p_ticket_type_id uuid, p_access_code text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := p_tenant;
  t public.event_ticket_types;
  e public.events;
  v_phase jsonb;
  v_seats integer;
BEGIN
  IF p_uid IS NULL THEN
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
  -- KOD DOSTEPU: straznik przed porownaniem, pudlo zliczone i zwrocone
  -- WARTOSCIA (wyjatek wycofalby zliczenie). Pusty kod to brak proby.
  IF t.access_code_hash IS NOT NULL THEN
    IF btrim(COALESCE(p_access_code, '')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ticket_access_code_invalid');
    END IF;
    PERFORM public._access_code_probe_guard(t.id, p_uid, p_ip_subject);
    IF encode(digest(upper(btrim(p_access_code)), 'sha256'), 'hex') <> t.access_code_hash THEN
      PERFORM public._access_code_probe_miss(t.id, p_uid, p_ip_subject);
      RETURN jsonb_build_object('ok', false, 'error', 'ticket_access_code_invalid');
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
    'list_price_cents', t.price_cents,
    'currency', t.currency,
    'requires_approval', t.requires_approval,
    'seats_left', v_seats,
    'phase', v_phase
  );
END $$;
REVOKE ALL ON FUNCTION public._event_ticket_checkout_quote(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.event_ticket_checkout_quote_for_user(
  _tenant_id uuid, _user_id uuid, _probe_subject text, p_ticket_type_id uuid, p_access_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_prev_role text := current_setting('request.jwt.claim.role', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_out jsonb;
BEGIN
  PERFORM public._require_server_identity(_tenant_id, _user_id, _probe_subject);
  -- `has_tier_rank` czyta konto z `auth.uid()` - na czas wywolania wolajacym
  -- JEST konto z sesji. Wyjatek wycofuje te ustawienia razem z transakcja.
  PERFORM public._set_request_identity(
    _user_id::text, 'authenticated',
    jsonb_build_object('sub', _user_id, 'role', 'authenticated')::text);
  v_out := public._event_ticket_checkout_quote(
    _tenant_id, _user_id, _probe_subject, p_ticket_type_id, p_access_code);
  PERFORM public._set_request_identity(v_prev_sub, v_prev_role, v_prev_claims);
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.event_ticket_checkout_quote_for_user(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_ticket_checkout_quote_for_user(uuid, uuid, text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.event_ticket_checkout_quote(p_ticket_type_id uuid, p_access_code text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._event_ticket_checkout_quote(
    public.public_tenant_id(), auth.uid(), NULL, p_ticket_type_id, p_access_code);
END $$;
REVOKE ALL ON FUNCTION public.event_ticket_checkout_quote(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_ticket_checkout_quote(uuid, text) TO service_role;

COMMENT ON FUNCTION public.event_ticket_checkout_quote_for_user(uuid, uuid, text, uuid, text) IS
  'Wycena wejsciowki dla kasy - TYLKO service_role. Najemca hosta, konto z sesji i solony skrot adresu jawnie; pudlo kodu dostepu liczone w kubelku biletu, konta i adresu i zwracane wartoscia {ok:false, error:ticket_access_code_invalid}.';
COMMENT ON FUNCTION public.event_ticket_checkout_quote(uuid, text) IS
  'Wrapper zgodnosci (najemca z hosta, konto z JWT, bez kubelka adresu) - TYLKO service_role. Kasa woluje event_ticket_checkout_quote_for_user.';

-- C) ZAPIS NA WYDARZENIE ------------------------------------------------------
-- Cialo z 20260830090000 z JEDNA zmiana w bloku kodu dostepu (oznaczona).
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
    --
    -- ZMIANA 20261007140400: PUDLO WRACA WARTOSCIA I JEST ZLICZONE. Dotad pudlo
    -- konczylo sie wyjatkiem, a wyjatek wycofywal zapis licznika z
    -- `rate_limit_hit` wyzej (12 / 10 min) - a ten i tak byl kluczowany adresem
    -- e-mail z ladunku, wiec kazda proba trafiala do nowego kubelka. Teraz pudlo
    -- liczy sie w kubelku TEGO BILETU (60 / 10 min, klucz z bazy, nie z
    -- ladunku) i - dla zalogowanego - w kubelku konta wspolnym z kodami
    -- rabatowymi (30 / 10 min). Przy pelnym kubelku odmowa obejmuje takze dobry
    -- kod, inaczej roznica „rate_limited" / sukces bylaby nowa wyrocznia.
    -- Pusty kod to brak proby: odmowa bez zliczenia.
    IF v_ticket.access_code_hash IS NOT NULL THEN
      IF v_access_code = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_access_code');
      END IF;
      PERFORM public._access_code_probe_guard(v_ticket.id, v_uid, NULL);
      IF encode(digest(v_access_code, 'sha256'), 'hex') <> v_ticket.access_code_hash THEN
        PERFORM public._access_code_probe_miss(v_ticket.id, v_uid, NULL);
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_access_code');
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
      -- KROK PIENIEDZY WYMAGA KONTA (2026-08-30).
      -- Zapis anonimowy zostaje dla wejsciowek BEZPLATNYCH - tam `manage_token`
      -- wystarcza za caly kontrakt z uczestnikiem. Przy wejsciowce PLATNEJ
      -- konczyl sie slepym zaulkiem: `createCheckoutOrder` stoi za
      -- `requireSupabaseAuth`, a `payments_apply_event_ticket_outcome` wymaga
      -- `payment_orders.user_id IS NOT NULL`, wiec gosc dostawal zgloszenie,
      -- ktorego NIE MIAL JAK oplacic - i zadne pozniejsze logowanie tego nie
      -- odkrecalo, bo zgloszenie anonimowe nie ma wlasciciela do dowiazania.
      -- Do konta nalezy paragon i droga zwrotu, wiec wymagamy go PRZED
      -- powstaniem wiersza, a nie po.
      IF v_uid IS NULL THEN
        RAISE EXCEPTION 'payment_account_required: a paid ticket requires an account';
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
    -- Kasa przyjmuje `event_id`, `ticket_type_id` I `registration_id` naraz,
    -- wiec odpowiedz zapisu musi niesc komplet - inaczej ekran potwierdzenia
    -- musialby go doszukiwac drugim zapytaniem.
    'event_id', v_event.id,
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
  'Publiczny zapis na wydarzenie. Przy wejsciowce platnej zapisuje payment_status = unpaid, NIE wydaje kodu QR i WYMAGA konta. Pudlo kodu dostepu zwraca wartoscia {ok:false, error:invalid_access_code} i liczy je w kubelku biletu (60 / 10 min) oraz konta zalogowanego - wyjatek wycofywal licznik.';
