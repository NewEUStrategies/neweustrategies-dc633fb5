-- events-harness: include
-- ============================================================================
-- WYDARZENIA: ZAPIS STEMPLUJE ZGODE PARTNERSKA W ZGLOSZENIU I NIE KASUJE
-- WYCOFANIA ZGOD (OPS-01, pisarze).
--
-- PROBLEM (po fundamencie 20261013110000). Fundament dal kolumny
-- `event_registrations.consent_partner_sharing_at / _withdrawn_at` i funkcje
-- `_event_partner_consent_at()`, ale pisarze nadal dzialaly po staremu:
--   * `event_register(jsonb)` pisal zgode partnerska WYLACZNIE na osobe
--     (`event_people`, COALESCE(stary, now())). Nowe zgloszenie nie dostawalo
--     stempla, wiec osoba, ktora zgode zaznaczyla, byla dla czytelnikow
--     per zgloszenie osoba BEZ zgody - a osoba, ktora zaznaczyla ja kiedys
--     przy innym wydarzeniu, nadal miala globalny stempel;
--   * `event_register(jsonb)` ustawial `consent_withdrawn_at = NULL` przy
--     KAZDYM zapisie. Wycofanie zgod znikalo przy zapisie na kolejne
--     wydarzenie bez zadnego dzialania osoby, a razem z nim WRACALA stara
--     zgoda marketingowa (`consent_marketing_at` stal nietkniety, a most CRM
--     czyta `consent_marketing_at IS NOT NULL AND consent_withdrawn_at IS
--     NULL`) i stara zgoda partnerska;
--   * `event_package_invite_accept(jsonb)` kasowal wycofanie tak samo, choc
--     przyjecie zaproszenia z pakietu nie zbiera ZADNEJ zgody poza
--     przetwarzaniem danych.
-- To lamie wymog zgody konkretnej i rownie latwej do wycofania jak do
-- udzielenia (art. 4 pkt 11 i art. 7 ust. 3 RODO): wycofanie trwa, dopoki
-- osoba sama nie udzieli zgody na nowo.
--
-- ZMIANA:
--   A. `_event_partner_consent_carry_withdrawal(najemca, osoba)` - przenosi
--      globalne wycofanie osoby (`event_people.consent_withdrawn_at`) do
--      `consent_partner_withdrawn_at` kazdego jej zgloszenia, ktorego zgoda
--      partnerska NIE jest pozniejsza niz to wycofanie, a nie ma jeszcze
--      wlasnego wycofania. Po tym kroku wyczyszczenie stempla osoby nie moze
--      wskrzesic starej zgody partnerskiej - wycofanie zostaje udokumentowane
--      na zgloszeniu, ktorego dotyczylo. Wolana z `event_register` tuz przed
--      czyszczeniem i RAZ tutaj dla istniejacych danych (backfill).
--      TYLKO `service_role` (wolaja ja funkcje SECURITY DEFINER).
--   B. `event_register(jsonb)` - cialo z 20261007140400 z trzema zmianami
--      (oznaczone w miejscu "ZMIANA 20261013110100"):
--        1. nowe zgloszenie dostaje `consent_partner_sharing_at = now()`
--           WYLACZNIE przy jawnie zaznaczonej zgodzie partnerskiej w TYM
--           formularzu; bez zaznaczenia - NULL (zgoda na TO wydarzenie);
--        2. `consent_withdrawn_at` jest czyszczony WYLACZNIE przy jawnie
--           zaznaczonej zgodzie marketingowej, w tej samej instrukcji, ktora
--           daje SWIEZY stempel `consent_marketing_at = now()` (stary stempel
--           sprzed wycofania nigdy nie wraca), i dopiero po kroku A. Zgoda
--           ciagla - bez wycofania - zachowuje date pierwszego nadania, bo to
--           ona jest dowodem;
--        3. stempel partnerski OSOBY zostaje jako HISTORYCZNY dowod pierwszej
--           zgody (dowolne wydarzenie) - o przekazaniu danych partnerowi
--           rozstrzyga wylacznie `_event_partner_consent_at()`.
--   C. `event_package_invite_accept(jsonb)` - cialo z 20260827221214 bez
--      `consent_withdrawn_at = NULL`. Zgloszenie z pakietu nie ma zgody
--      partnerskiej (kolumna zostaje NULL - fail-closed).
--
-- CZEGO TO NIE ZMIENIA: sygnatury, typy wyniku i ACL obu funkcji publicznych
-- (CREATE OR REPLACE zachowuje GRANT-y). Pozostali pisarze kartoteki
-- (`_event_cfp_resolve_person`, `admin_event_speaker_upsert`,
-- `event_register_group_guests`, `admin_event_registration_upsert`) nie
-- czyszcza wycofania i nie nadaja zgody partnerskiej - sprawdzone na
-- najnowszych definicjach. Czytelnicy zgody partnerskiej przechodza na
-- `_event_partner_consent_at()` w 20261013110200.
--
-- IDEMPOTENTNA: CREATE OR REPLACE; backfill dotyka tylko zgloszen, ktorych
-- zgoda partnerska nie ma jeszcze wycofania pozniejszego niz nadanie.
-- DOWOD: scripts/events-harness/runtime_test.d/33_partner_consent_per_registration.sql.
-- ============================================================================

-- A) WYCOFANIE OSOBY PRZECHODZI NA JEJ ZGLOSZENIA -----------------------------
CREATE OR REPLACE FUNCTION public._event_partner_consent_carry_withdrawal(
  p_tenant uuid,
  p_person_id uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Ten sam porzadek co `_event_partner_consent_at()`: zgoda liczy sie tylko,
  -- gdy jest SCISLE pozniejsza niz wycofanie, wiec rownosc dat to wycofana
  -- zgoda. Zgloszenie z wlasnym wycofaniem pozniejszym niz nadanie zostaje
  -- nietkniete - jego data jest dokladniejszym dowodem.
  UPDATE public.event_registrations r
     SET consent_partner_withdrawn_at = p.consent_withdrawn_at
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant
     AND p.id = p_person_id
     AND p.consent_withdrawn_at IS NOT NULL
     AND r.tenant_id = p.tenant_id
     AND r.person_id = p.id
     AND r.consent_partner_sharing_at IS NOT NULL
     AND r.consent_partner_sharing_at <= p.consent_withdrawn_at
     AND (r.consent_partner_withdrawn_at IS NULL
          OR r.consent_partner_withdrawn_at < r.consent_partner_sharing_at);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public._event_partner_consent_carry_withdrawal(uuid, uuid) IS
  'Przenosi globalne wycofanie zgod osoby na consent_partner_withdrawn_at jej zgloszen ze zgoda partnerska nie pozniejsza niz wycofanie. Wolane przed wyczyszczeniem event_people.consent_withdrawn_at, zeby stara zgoda partnerska nie wrocila.';

REVOKE ALL ON FUNCTION public._event_partner_consent_carry_withdrawal(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._event_partner_consent_carry_withdrawal(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_partner_consent_carry_withdrawal(uuid, uuid) TO service_role;

-- Backfill: raz dla kazdej osoby z wycofaniem. Dzis nikt tego stempla nie
-- czysci poza `event_register` (krok B), ale stan sprzed tej migracji moze
-- miec wycofanie, ktore wyczysci najblizszy zapis z zaznaczonym marketingiem.
DO $backfill$
BEGIN
  PERFORM public._event_partner_consent_carry_withdrawal(p.tenant_id, p.id)
     FROM public.event_people p
    WHERE p.consent_withdrawn_at IS NOT NULL;
END
$backfill$;

-- B) ZAPIS NA WYDARZENIE ------------------------------------------------------
-- Cialo z 20261007140400 z trzema zmianami (oznaczone "ZMIANA 20261013110100").
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
    -- ZMIANA 20261013110100 (2): WYCOFANIE ZGOD TRWA, DOPOKI OSOBA SAMA NIE
    -- UDZIELI ZGODY NA NOWO. Dotad kazdy zapis ustawial `consent_withdrawn_at =
    -- NULL`, a razem z nim wracala stara zgoda marketingowa i partnerska.
    -- Teraz wycofanie czysci WYLACZNIE jawnie zaznaczona zgoda marketingowa
    -- w tym formularzu - i ta sama instrukcja daje jej SWIEZY stempel, wiec
    -- stempel sprzed wycofania nie wraca. Zgoda ciagla (bez wycofania)
    -- zachowuje date pierwszego nadania. Zanim stempel osoby zniknie, jej
    -- wycofanie przechodzi na zgloszenia ze zgoda partnerska sprzed niego -
    -- inaczej wyczyszczenie wskrzesiloby zgode partnerska z innego wydarzenia.
    IF v_marketing THEN
      PERFORM public._event_partner_consent_carry_withdrawal(v_tenant, v_person_id);
    END IF;

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
        WHEN v_marketing AND p.consent_withdrawn_at IS NOT NULL THEN now()
        WHEN v_marketing THEN COALESCE(p.consent_marketing_at, now())
        ELSE p.consent_marketing_at
      END,
      -- ZMIANA 20261013110100 (3): stempel partnerski OSOBY jest HISTORYCZNY
      -- (pierwsza zgoda, dowolne wydarzenie) i nic go juz nie czyta przy
      -- decyzji. O przekazaniu danych partnerowi rozstrzyga stempel zgloszenia
      -- (nizej) przez `_event_partner_consent_at()`.
      consent_partner_sharing_at = CASE
        WHEN v_partner THEN COALESCE(p.consent_partner_sharing_at, now())
        ELSE p.consent_partner_sharing_at
      END,
      consent_withdrawn_at = CASE
        WHEN v_marketing THEN NULL
        ELSE p.consent_withdrawn_at
      END
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

  -- ZMIANA 20261013110100 (1): ZGODA PARTNERSKA NALEZY DO ZGLOSZENIA. Stempel
  -- powstaje WYLACZNIE przy jawnie zaznaczonej zgodzie w TYM formularzu, wiec
  -- dotyczy TEGO wydarzenia; bez zaznaczenia zgloszenie ma NULL, niezaleznie
  -- od tego, co osoba zaznaczyla przy innych wydarzeniach.
  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source,
    decided_at, decision_source, qr_token_hash, qr_issued_at,
    manage_token_hash, waitlist_position, payment_status, created_by,
    consent_partner_sharing_at
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
    v_uid,
    CASE WHEN v_partner THEN now() END
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
  'Publiczny zapis na wydarzenie. Zgoda partnerska trafia do zgloszenia (consent_partner_sharing_at) tylko przy jawnym zaznaczeniu w tym formularzu; wycofanie zgod osoby czysci tylko jawnie zaznaczona zgoda marketingowa (swiezy stempel), po przeniesieniu wycofania na zgloszenia. Przy wejsciowce platnej zapisuje payment_status = unpaid, NIE wydaje kodu QR i WYMAGA konta. Pudlo kodu dostepu zwraca wartoscia {ok:false, error:invalid_access_code}.';

-- C) PRZYJECIE ZAPROSZENIA Z PAKIETU -----------------------------------------
-- Cialo z 20260827221214 z JEDNA zmiana (oznaczona): bez `consent_withdrawn_at
-- = NULL`. Formularz zaproszenia zbiera tylko zgode na przetwarzanie danych,
-- wiec nie ma czym zastapic wycofania - a jego wyczyszczenie wskrzeszalo
-- zgode marketingowa i partnerska sprzed wycofania.
CREATE OR REPLACE FUNCTION public.event_package_invite_accept(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_token text := btrim(COALESCE(p_payload->>'token', ''));
  v_first text := btrim(COALESCE(p_payload->>'first_name', ''));
  v_last text := btrim(COALESCE(p_payload->>'last_name', ''));
  v_job text := NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), '');
  v_company text := NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), '');
  v_answers jsonb := COALESCE(p_payload->'answers', '{}'::jsonb);
  v_data_ok boolean := lower(COALESCE(p_payload->>'consent_data_processing', '')) IN ('true', 't', '1');
  v_ip_hash text := NULLIF(btrim(COALESCE(p_payload->>'ip_hash', '')), '');
  v_seat public.event_package_seats;
  v_order public.event_package_orders;
  v_package public.event_ticket_packages;
  v_person_id uuid;
  v_group_id uuid;
  v_reg_id uuid;
  v_qr text;
  v_manage text;
  v_rate record;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: invitation does not exist';
  END IF;
  IF v_token = '' THEN
    RAISE EXCEPTION 'invalid_token: the invitation link is incomplete';
  END IF;
  IF v_first = '' OR v_last = '' THEN
    RAISE EXCEPTION 'invalid_name: first name and last name are required';
  END IF;
  IF NOT v_data_ok THEN
    RAISE EXCEPTION 'consent_required: consent to data processing is required';
  END IF;
  IF jsonb_typeof(v_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;

  SELECT * INTO v_rate
  FROM public.rate_limit_hit(
    'event_package_invite_accept',
    v_tenant::text || ':' || COALESCE(v_ip_hash, left(v_token, 12)),
    10,
    10
  );
  IF NOT v_rate.allowed THEN
    RAISE EXCEPTION 'rate_limited: too many attempts, try again later';
  END IF;

  SELECT * INTO v_seat
  FROM public.event_package_seats s
  WHERE s.tenant_id = v_tenant
    AND s.invite_token_hash = encode(digest(v_token, 'sha256'), 'hex')
  FOR UPDATE;

  IF v_seat.id IS NULL OR v_seat.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_token: the invitation is not valid';
  END IF;
  IF v_seat.registration_id IS NOT NULL THEN
    RAISE EXCEPTION 'seat_taken: this invitation has already been used';
  END IF;
  IF v_seat.invite_expires_at IS NOT NULL AND now() > v_seat.invite_expires_at THEN
    RAISE EXCEPTION 'invitation_expired: the invitation has expired';
  END IF;

  SELECT * INTO v_order
  FROM public.event_package_orders o
  WHERE o.id = v_seat.package_order_id AND o.tenant_id = v_tenant;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'order_cancelled: the order behind this seat is cancelled';
  END IF;

  SELECT * INTO v_package
  FROM public.event_ticket_packages p
  WHERE p.id = v_order.package_id AND p.tenant_id = v_tenant;

  SELECT pe.id INTO v_person_id
  FROM public.event_people pe
  WHERE pe.tenant_id = v_tenant AND pe.email_norm = v_seat.invite_email;

  IF v_person_id IS NULL THEN
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, job_title, company_text,
      source, consent_data_processing_at, created_by
    ) VALUES (
      v_tenant, v_uid, v_seat.invite_email, v_first, v_last, v_job, v_company,
      'package_invitation', now(), v_uid
    )
    RETURNING id INTO v_person_id;
  ELSE
    -- ZMIANA 20261013110100: bez `consent_withdrawn_at = NULL`. Przyjecie
    -- zaproszenia nie jest zgoda marketingowa ani partnerska, wiec wycofanie
    -- zgod osoby zostaje nietkniete.
    UPDATE public.event_people pe SET
      first_name = v_first,
      last_name = v_last,
      job_title = COALESCE(v_job, pe.job_title),
      company_text = COALESCE(v_company, pe.company_text),
      consent_data_processing_at = COALESCE(pe.consent_data_processing_at, now())
    WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant
      AND r.event_id = v_seat.event_id
      AND r.person_id = v_person_id
      AND r.status NOT IN ('cancelled', 'rejected')
  ) THEN
    RAISE EXCEPTION 'already_registered: this person already has an active registration';
  END IF;

  SELECT t.group_id INTO v_group_id
  FROM public.event_ticket_types t
  WHERE t.id = v_package.ticket_type_id AND t.tenant_id = v_tenant;

  IF v_group_id IS NULL THEN
    SELECT g.id INTO v_group_id
    FROM public.event_groups g
    WHERE g.tenant_id = v_tenant AND g.event_id = v_seat.event_id AND g.is_default;
  END IF;

  v_qr := public._event_new_qr_token();
  v_manage := public._event_new_qr_token();

  -- Miejsce jest juz oplacone przez firme, wiec zgloszenie wchodzi zatwierdzone;
  -- pula biletu nie jest tu dotykana, bo zajely ja miejsca pakietu.
  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source, decided_at, decision_source,
    qr_token_hash, qr_issued_at, manage_token_hash, created_by
  ) VALUES (
    v_tenant, v_seat.event_id, v_person_id, v_package.ticket_type_id, v_group_id,
    'approved', 'form', v_answers, 'package_invitation', now(), 'system',
    encode(digest(v_qr, 'sha256'), 'hex'), now(),
    encode(digest(v_manage, 'sha256'), 'hex'), v_uid
  )
  RETURNING id INTO v_reg_id;

  UPDATE public.event_package_seats s SET
    registration_id = v_reg_id,
    assigned_at = now(),
    invite_token_hash = NULL
  WHERE s.id = v_seat.id AND s.tenant_id = v_tenant;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_seat.event_id,
      'person_id', v_person_id,
      'status', 'approved',
      'ticket_type_id', v_package.ticket_type_id,
      'source', 'package_invitation'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'registration_id', v_reg_id,
    'event_id', v_seat.event_id,
    'status', 'approved',
    'qr_token', v_qr,
    'manage_token', v_manage
  );
END;
$$;

COMMENT ON FUNCTION public.event_package_invite_accept(jsonb) IS
  'Przyjecie zaproszenia na miejsce z pakietu: tworzy zatwierdzone zgloszenie uczestnika bez zgody partnerskiej i bez czyszczenia wycofania zgod osoby. Token porownywany po skrocie, jednorazowy, z limitem prob.';
