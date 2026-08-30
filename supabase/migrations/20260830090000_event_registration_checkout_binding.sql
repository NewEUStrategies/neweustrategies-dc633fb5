-- ============================================================================
-- ZAPIS ETAPU 4 DOSTAJE DROGE DO KASY, A WPLATA - PEWNE DOWIAZANIE.
--
-- events-harness: include
--
-- STAN, KTORY TA MIGRACJA ZASTAJE
--
-- Petla platnicza jest juz zamknieta po OBU stronach poza jednym krokiem:
--   * `event_register` (20260828206000) liczy cene, zapisuje
--     `payment_status = 'unpaid'`, NIE wydaje kodu QR i zostawia zgloszenie
--     jako `pending`, zeby porzucony zapis nie zjadal miejsca z puli;
--   * `event_ticket_checkout_quote` (20260828054337) liczy kwote dla kasy;
--   * `payments_apply_event_ticket_outcome` (20260828053802 -> 20260828055725)
--     przy `paid` wydaje kod QR i promuje `pending -> approved`, przy
--     `refunded` odwraca to i zwalnia miejsce.
-- Brakowalo wylacznie tego, co 20260828206000 zapisala sobie jako prace do
-- zrobienia: front nie mial czym pokierowac do kasy. Ta migracja daje mu
-- brakujace kawalki i zamyka DWIE dziury, ktore ten krok odslania.
--
-- DZIURA 1: DOPASOWANIE WPLATY DO ZGLOSZENIA BYLO NIEPEWNE (P1, PIENIADZE)
--
-- `payments_apply_event_ticket_outcome` szukalo zgloszenia tak:
--   WHERE r.tenant_id = ... AND r.event_id = ...
--     AND (r.payment_order_id = v_order.id
--          OR (v_person_id IS NOT NULL AND r.person_id = v_person_id))
--   ORDER BY (r.payment_order_id = v_order.id) DESC, r.created_at DESC
--   LIMIT 1
-- `payment_order_id` ustawia DOPIERO TA SAMA FUNKCJA, wiec przy PIERWSZYM
-- ksiegowaniu pierwszy czlon alternatywy nie moze byc prawdziwy dla zadnego
-- wiersza. Zostawalo wylacznie dopasowanie PO OSOBIE z `LIMIT 1` po
-- `created_at DESC`. Uczestnik z dwoma zgloszeniami na to samo wydarzenie
-- (druga proba po porzuceniu pierwszej, zapis na dwie rozne wejsciowki)
-- dostawal oplacony bilet przypiety do NAJNOWSZEGO wiersza - niekoniecznie
-- tego, za ktory zaplacil. Przy dwoch roznych cenach znaczylo to bilet drozszy
-- oplacony tansza kwota albo odwrotnie, a przy zwrocie - zwolnienie cudzego
-- miejsca.
--
-- Naprawa: `payment_orders.metadata` niesie `registration_id`, a funkcja
-- dopasowuje WYLACZNIE po nim, gdy klucz jest obecny. Niezgodnosc najemcy albo
-- wydarzenia to jawna odmowa (`{applied:false, reason:...}`), a NIE ciche
-- zejscie do dopasowania po osobie - inaczej blad wskazania zamieniałby sie
-- w to samo zgadywanie, ktore usuwamy. Dopasowanie po osobie zostaje jako
-- sciezka zapasowa dla zamowien powstalych PRZED formularzem (kasa spolecznosci
-- z `EventTicketPurchase`, ktora nie zna zgloszen etapu 4) - tak jak dzis.
--
-- DZIURA 2: GOSC BEZ KONTA TRAFIAL W SLEPY ZAULEK (P1)
--
-- `event_register` dopuszcza zapis anonimowy i to jest sluszne dla wejsciowek
-- bezplatnych: `manage_token` wystarcza za caly kontrakt z uczestnikiem.
-- Przy wejsciowce PLATNEJ konczylo sie to jednak zgloszeniem, ktorego NIKT nie
-- moze oplacic: `createCheckoutOrder` stoi za `requireSupabaseAuth`,
-- a `payments_apply_event_ticket_outcome` wymaga `payment_orders.user_id`.
-- Samo dodanie przycisku dałoby gosciowi kontrolke, ktora nie ma prawa zadzialac.
--
-- Rozstrzygniecie: PLATNA WEJSCIOWKA WYMAGA KONTA, i to PRZED powstaniem
-- wiersza, a nie po. Powod jest prawdziwy i dokladnie taki: do konta nalezy
-- paragon i droga zwrotu. Dowiazanie po fakcie nie jest alternatywa - zgloszenie
-- anonimowe nie ma wlasciciela, ktorego mozna by rozpoznac po zalogowaniu,
-- a rozpoznawanie po adresie e-mail oddawaloby cudzy bilet kazdemu, kto zna
-- adres.
--
-- CZEGO TA MIGRACJA NIE ROBI
--
--   * NIE ROZLUZNIA bramki z 20260828206000. Niezaplacony bilet nadal stoi
--     `pending`, nadal nie ma kodu QR i nadal nie trzyma miejsca.
--   * NIE ZAMYKA NADSPRZEDAZY. `payments_apply_event_ticket_outcome` promuje
--     `pending -> approved` BEZWARUNKOWO - `_event_seats_left` ani `sold_count`
--     nie padaja w jej ciele. To bezposrednia cena (slusznej) decyzji, ze
--     `pending` nie trzyma miejsca: miedzy startem kasy a webhookiem pula moze
--     sie wyczerpac. Defekt jest ZAREJESTROWANY asercja harnessu
--     (`scripts/events-harness/runtime_test.d/25_payment_binding.sql`,
--     sekcja NADSPRZEDAZ) i czeka na rozstrzygniecie produktowe - rezerwacja
--     miejsca na czas sesji operatora, swiadoma nadsprzedaz z alertem albo
--     automatyczny zwrot. Cicha naprawa przy okazji byla by decyzja o
--     pieniadzach klienta podjeta w cudzym zadaniu.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- KSZTALT, Z KTOREGO TA MIGRACJA KORZYSTA - ZAKLADANY IDEMPOTENTNIE.
--
-- Kolumny rozliczeniowe dokladaja 20260828053802 i 20260828055725. Zadna z nich
-- NIE JEST odtwarzana w `events-harness`: selektor lapie migracje po tresci
-- (`public.admin_event_`, `events_tenant_id_key`, jawny znacznik, definicja
-- `FUNCTION public.event_...`), a tamte dwie definiuja wylacznie
-- `payments_apply_event_ticket_outcome` - nazwe spoza tego zbioru. Migracja,
-- ktora z kolumn KORZYSTA i ktora harness odtwarza, upewnia sie wiec, ze
-- kolumny istnieja. Ksztalt przepisany z oryginalow znak w znak.
-- ----------------------------------------------------------------------------
ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS refunded_amount_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS payment_order_id uuid REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE INDEX IF NOT EXISTS event_registrations_payment_order_idx
  ON public.event_registrations (payment_order_id)
  WHERE payment_order_id IS NOT NULL;

-- Piec wartosci, nie cztery: `partially_refunded` dokłada 20260828055725,
-- a 20260828206000 (ta, ktora harness ZNA) zaklada wariant czteroelementowy.
-- Bez tego podniesienia asercja zwrotu czesciowego przewracalaby sie na
-- ograniczeniu, ktorego produkcja juz nie ma.
ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_payment_status_values;
ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_payment_status_values
  CHECK (payment_status = ANY (ARRAY['not_required'::text,'unpaid'::text,'paid'::text,'partially_refunded'::text,'refunded'::text]));

-- ----------------------------------------------------------------------------
-- 1. `event_register`: PLATNA WEJSCIOWKA WYMAGA KONTA + `event_id` W ODPOWIEDZI.
--
-- Cialo przepisane z 20260828206000 ze DWIEMA zmianami, obie oznaczone
-- w miejscu. Reszta - bramka ceny, brak kodu QR, `pending` zamiast `approved` -
-- zostaje BEZ ZMIAN: to jest wlasciwa bramka i nie wolno jej rozluznic.
-- ----------------------------------------------------------------------------
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
  'Publiczny zapis na wydarzenie. Przy wejsciowce platnej zapisuje payment_status = unpaid, NIE wydaje kodu QR i WYMAGA konta (paragon i droga zwrotu naleza do konta; zgloszenie anonimowe nie ma jak zostac oplacone). Odpowiedz niesie event_id, payment_required, amount_cents i currency, zeby formularz mial czym pokierowac do kasy.';

-- ----------------------------------------------------------------------------
-- 2. `event_registration_payment_context`: CZY TO ZGLOSZENIE WOLNO OPLACIC.
--
-- Kasa przyjmuje `registration_id` OD KLIENTA, wiec ktos musi sprawdzic, ze
-- wskazany wiersz nalezy do wolajacego i do tego samego wydarzenia. Robi to
-- baza, a nie serwer aplikacji: RLS `event_registrations` jest zamkniete dla
-- uczestnika (20260825170000, panel administracyjny tylko), wiec zwykly odczyt
-- tabeli i tak nic by nie zwrocil, a rzutowanie tego na `service_role` oddaloby
-- serwerowi aplikacji prawo czytania CUDZYCH zgloszen.
--
-- WLASCICIELA ROZPOZNAJEMY DWOMA DROGAMI. `created_by` stempluje `event_register`
-- kontem wolajacego, a `event_people.user_id` wiaze kartoteke z kontem. Druga
-- droga bywa PUSTA mimo zalogowania: `event_register` nie przepina kartoteki,
-- gdy to samo konto siedzi juz przy INNYM wierszu osoby w tym najemcy
-- (`v_bind_uid` staje sie NULL). Bez `created_by` taki uczestnik nie mialby jak
-- oplacic wlasnego zapisu.
--
-- KWOTA JEST INFORMACYJNA. Do zaplaty liczy ja `event_ticket_checkout_quote`
-- przy zakladaniu zamowienia - tu sluzy wylacznie do napisania zdania na
-- ekranie. Dwa zrodla prawdy o cenie nie powstaja, bo obie czytaja
-- `_event_ticket_price_now`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_registration_payment_context(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_reg public.event_registrations;
  v_ticket public.event_ticket_types;
  v_slug text;
  v_price integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_required');
  END IF;
  IF v_tenant IS NULL OR p_registration_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT r.* INTO v_reg
  FROM public.event_registrations r
  LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.id = p_registration_id
    AND r.tenant_id = v_tenant
    AND (r.created_by = v_uid OR p.user_id = v_uid);

  IF v_reg.id IS NULL THEN
    -- „Nie Twoje" i „nie istnieje" oddajemy JEDNYM powodem: rozroznienie
    -- zamienialoby te funkcje w sonde istnienia cudzych zgloszen.
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_reg.status IN ('cancelled', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'registration_closed',
                              'registration_id', v_reg.id, 'event_id', v_reg.event_id);
  END IF;

  IF v_reg.payment_status <> 'unpaid' THEN
    RETURN jsonb_build_object('ok', false, 'reason',
                              CASE WHEN v_reg.payment_status = 'not_required'
                                   THEN 'payment_not_required' ELSE 'already_settled' END,
                              'registration_id', v_reg.id, 'event_id', v_reg.event_id,
                              'payment_status', v_reg.payment_status);
  END IF;

  SELECT e.slug INTO v_slug FROM public.events e
  WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant;

  IF v_reg.ticket_type_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.event_ticket_types t
    WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant;
    v_price := COALESCE(public._event_ticket_price_now(
      v_ticket.price_cents, v_ticket.early_bird_price_cents,
      v_ticket.early_bird_until, v_ticket.price_schedule), 0);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg.id,
    'event_id', v_reg.event_id,
    'event_slug', v_slug,
    'ticket_type_id', v_reg.ticket_type_id,
    'status', v_reg.status,
    'payment_status', v_reg.payment_status,
    'amount_cents', v_price,
    'currency', v_ticket.currency
  );
END;
$$;
COMMENT ON FUNCTION public.event_registration_payment_context(uuid) IS
  'Czy WOLAJACY moze oplacic wskazane zgloszenie: wlasnosc (created_by albo event_people.user_id), stan zapisu i kwota informacyjna. Kasa waliduje nia registration_id przyjete od klienta.';

REVOKE ALL ON FUNCTION public.event_registration_payment_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_registration_payment_context(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. `event_registration_manage_view`: STAN ZGLOSZENIA POD KLUCZEM Z MAILA.
--
-- Strona `/events/<slug>/manage` pokazywala dotad WYLACZNIE naglowek wydarzenia
-- i przycisk rezygnacji - o samym zgloszeniu nie mowila nic. Uczestnik, ktory
-- zamknal ekran potwierdzenia przed zaplata, nie mial wiec ZADNEJ drogi powrotu
-- do kasy poza zapisaniem sie DRUGI RAZ. To produkuje dokladnie te zduplikowane
-- wiersze, o ktore rozbijalo sie dopasowanie wplaty (patrz naglowek).
--
-- KLUCZ JEST POSWIADCZENIEM, WIEC ODCZYT NIE POSZERZA UPRAWNIEN. Posiadacz
-- `manage_token` moze juz tym samym kluczem ODWOLAC zgloszenie
-- (`event_registration_cancel`) i zmienic jego kanaly powiadomien
-- (`event_registration_set_channels`). Pokazanie mu statusu i kwoty jest
-- SCISLE MNIEJ, niz umie zrobic.
--
-- ODDAJEMY MINIMUM. Zaden adres e-mail, zadne nazwisko, zadna odpowiedz
-- z formularza - wylacznie to, czego potrzebuje zdanie „czekamy na wplate,
-- oto kwota" i przycisk do kasy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_registration_manage_view(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
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
  v_price integer := 0;
  v_owned boolean := false;
BEGIN
  IF v_tenant IS NULL OR (v_token IS NULL AND v_reg_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_token IS NOT NULL THEN
    SELECT r.* INTO v_reg
    FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant
      AND r.manage_token_hash = encode(digest(v_token, 'sha256'), 'hex');
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
    v_price := COALESCE(public._event_ticket_price_now(
      v_ticket.price_cents, v_ticket.early_bird_price_cents,
      v_ticket.early_bird_until, v_ticket.price_schedule), 0);
  END IF;

  -- Czy TEN zalogowany uzytkownik jest wlascicielem zgloszenia. Front pyta
  -- o to, zeby wiedziec, czy pokazac przycisk „Zaplac", czy zdanie
  -- „platna wejsciowka nalezy do konta - zaloguj sie na nie".
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
    'amount_cents', v_price,
    'currency', v_ticket.currency,
    'owned_by_caller', v_owned
  );
END;
$$;
COMMENT ON FUNCTION public.event_registration_manage_view(jsonb) IS
  'Stan wlasnego zgloszenia pod kluczem manage_token (gosc) albo pod identyfikatorem (wlasciciel konta). Oddaje MINIMUM potrzebne stronie samoobslugi: status, os pieniedzy, kwote i to, czy zalogowany jest wlascicielem. Zadnych danych osobowych.';

REVOKE ALL ON FUNCTION public.event_registration_manage_view(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_manage_view(jsonb) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. `event_my_registrations`: `event_id` I `ticket_type_id` W KARCIE UCZESTNIKA.
--
-- Cialo przepisane z 20260828095114 z JEDNA zmiana, oznaczona w miejscu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_my_registrations(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit','')::integer, 20), 1), 50);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your registrations';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      r.id AS registration_id,
      -- `event_id` i `ticket_type_id` (2026-08-30): panel uczestnika musi umiec
      -- ODESLAC DO KASY zgloszenie z `payment_status = 'unpaid'`, a
      -- `createCheckoutOrder` przyjmuje wszystkie trzy identyfikatory naraz.
      -- Bez nich karta pokazywala „nieoplacone" i nie dawala z tym nic zrobic.
      r.event_id,
      r.ticket_type_id,
      r.status,
      r.payment_status,
      r.created_at,
      r.cancelled_at,
      r.paid_at,
      r.waitlist_position,
      r.promoted_at,
      r.notify_email,
      r.notify_sms,
      COALESCE(NULLIF(btrim(r.cancel_reason), ''), NULLIF(btrim(r.decision_note), '')) AS cancel_reason,
      r.decision_source,
      e.slug AS event_slug,
      e.title_pl AS event_title_pl,
      e.title_en AS event_title_en,
      e.starts_at AS event_starts_at,
      e.ends_at AS event_ends_at,
      e.timezone AS event_timezone,
      o.id AS order_id,
      o.status AS order_status,
      o.amount_cents,
      o.refunded_amount_cents,
      o.currency,
      o.provider_session_id,
      o.provider_payment_intent_id,
      o.environment,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', w.id,
                 'event_type', w.event_type,
                 'status', w.status,
                 'occurred_at', w.occurred_at,
                 'processed_at', w.processed_at,
                 'retry_count', w.retry_count
               ) ORDER BY w.occurred_at DESC)
        FROM (
          SELECT w2.*
          FROM public.payment_webhook_events w2
          WHERE w2.tenant_id = r.tenant_id
            AND (
              (o.provider_customer_id IS NOT NULL AND w2.customer_id = o.provider_customer_id)
              OR w2.user_id = v_uid
            )
          ORDER BY w2.occurred_at DESC
          LIMIT 20
        ) w
      ), '[]'::jsonb) AS webhooks
    FROM public.event_registrations r
    JOIN public.event_people pe ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id
    WHERE r.tenant_id = v_tenant
      AND pe.user_id = v_uid
    ORDER BY r.created_at DESC
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object('registrations', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_registrations(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_registrations(jsonb) TO authenticated, service_role;
-- ----------------------------------------------------------------------------
-- 5. `payments_apply_event_ticket_outcome`: WPLATA IDZIE DO WSKAZANEGO WIERSZA.
--
-- Cialo przepisane z 20260828055725 z JEDNA zmiana, oznaczona w miejscu:
-- dopasowanie zgloszenia. Reszta - kumulatywny zwrot, promocja z listy
-- rezerwowej, zdarzenie domenowe, ksztalt odpowiedzi - bez zmian.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payments_apply_event_ticket_outcome(uuid, text);

CREATE OR REPLACE FUNCTION public.payments_apply_event_ticket_outcome(
  p_order_id uuid,
  p_outcome text,
  p_refunded_cents integer DEFAULT NULL
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
  v_registration_hint uuid;
  v_person_id uuid;
  v_reg public.event_registrations;
  v_token text;
  v_promoted jsonb := jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  v_effective text;
  v_refunded integer;
  v_person public.event_people;
  v_event public.events;
BEGIN
  IF p_outcome NOT IN ('paid','unpaid','refunded','partial_refund') THEN
    RAISE EXCEPTION 'invalid_outcome';
  END IF;

  SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'order_not_found');
  END IF;

  v_effective := p_outcome;
  v_refunded := COALESCE(v_order.refunded_amount_cents, 0);

  -- Zwrot: suma zwroconych srodkow jest kumulatywna (operator przysyla
  -- `amount_refunded` narastajaco). Gdy pokryje cale obciazenie, zwrot
  -- czesciowy staje sie pelnym - miejsce musi wrocic do puli.
  IF p_outcome IN ('refunded','partial_refund') THEN
    IF p_refunded_cents IS NOT NULL AND p_refunded_cents > v_refunded THEN
      v_refunded := p_refunded_cents;
    ELSIF p_outcome = 'refunded' AND p_refunded_cents IS NULL THEN
      v_refunded := GREATEST(v_refunded, COALESCE(v_order.amount_cents, 0));
    END IF;

    UPDATE public.payment_orders o
    SET refunded_amount_cents = v_refunded,
        updated_at = now()
    WHERE o.id = v_order.id;

    IF COALESCE(v_order.amount_cents, 0) > 0 AND v_refunded >= v_order.amount_cents THEN
      v_effective := 'refunded';
    ELSIF p_outcome = 'partial_refund' THEN
      v_effective := 'partial_refund';
    END IF;
  END IF;

  v_event_id := NULLIF(v_order.metadata->>'event_id','')::uuid;
  v_ticket_type_id := NULLIF(v_order.metadata->>'ticket_type_id','')::uuid;
  -- Ksztalt sprawdzamy REGEXEM, a nie rzutowaniem: `'zle'::uuid` rzuca 22P02
  -- i wywracaloby ksiegowanie wplaty, ktora u operatora juz przeszla.
  v_registration_hint := CASE
    WHEN COALESCE(v_order.metadata->>'registration_id','') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'registration_id')::uuid
    ELSE NULL
  END;

  IF v_event_id IS NULL OR v_order.user_id IS NULL OR v_order.tenant_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_a_ticket_order',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  -- ==========================================================================
  -- DOPASOWANIE ZGLOSZENIA (zmiana z 2026-08-30).
  --
  -- BYLO: alternatywa `payment_order_id = order.id OR person_id = <osoba>`
  -- z `ORDER BY ... created_at DESC LIMIT 1`. Pierwszy czlon ustawia DOPIERO
  -- TA FUNKCJA, wiec przy pierwszym ksiegowaniu dzialal WYLACZNIE drugi:
  -- uczestnik z dwoma zgloszeniami na to samo wydarzenie dostawal oplacony
  -- bilet przypiety do najnowszego wiersza, niekoniecznie tego, za ktory
  -- zaplacil.
  --
  -- JEST: gdy zamowienie NIESIE `registration_id`, dopasowanie idzie WYLACZNIE
  -- po nim. Niezgodnosc najemcy albo wydarzenia to JAWNA ODMOWA, a nie ciche
  -- zejscie do zgadywania po osobie - blad wskazania ma byc widoczny, a nie
  -- zamaskowany tym samym zachowaniem, ktore usuwamy.
  --
  -- Dopasowanie po osobie ZOSTAJE dla zamowien BEZ tego klucza: kasa
  -- spolecznosci (`EventTicketPurchase` -> cena z wiersza wydarzenia) nie zna
  -- zgloszen etapu 4, a zamowienia zalozone przed ta migracja juz leza w bazie.
  -- ==========================================================================
  IF v_registration_hint IS NOT NULL THEN
    SELECT r.* INTO v_reg
    FROM public.event_registrations r
    WHERE r.id = v_registration_hint
      AND r.tenant_id = v_order.tenant_id
      AND r.event_id = v_event_id
    FOR UPDATE;

    IF v_reg.id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'registration_mismatch',
                                'registration_id', v_registration_hint,
                                'outcome', v_effective, 'refunded_cents', v_refunded);
    END IF;
  ELSE
    SELECT p.id INTO v_person_id
    FROM public.event_people p
    WHERE p.tenant_id = v_order.tenant_id AND p.user_id = v_order.user_id
    LIMIT 1;

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
  END IF;

  IF v_reg.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'registration_not_found',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  IF v_effective = 'paid' THEN
    v_token := public._event_new_qr_token();
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'paid',
        paid_at = COALESCE(r.paid_at, now()),
        ticket_type_id = COALESCE(v_ticket_type_id, r.ticket_type_id),
        status = CASE WHEN r.status IN ('draft','pending','waitlist') THEN 'approved' ELSE r.status END,
        waitlist_position = NULL,
        -- `cancelled_at` CZYSCIMY WYLACZNIE RAZEM ZE STATUSEM (naprawa 2026-08-30).
        --
        -- Bylo tu bezwarunkowe `cancelled_at = NULL`, a status flipuje sie
        -- tylko z `draft/pending/waitlist`. Wplata ksiegowana na zgloszeniu
        -- ODWOLANYM zostawiala wiec wiersz `status = 'cancelled'` z pustym
        -- `cancelled_at` - czyli naruszenie `event_registrations_cancelled_dated`,
        -- czyli WYJATEK w calej funkcji. Webhook zamienia wyjatek na 500,
        -- operator ponawia dostarczenie, a ponowienie pada tak samo: pieniadze
        -- pobrane, zgloszenie nietkniete, petla bez konca. Sciezka jest realna
        -- - uczestnik odwoluje zapis i dopiero potem konczy platnosc zaczeta
        -- wczesniej - i po dowiazaniu po `registration_id` trafia sie CZESCIEJ,
        -- bo wplata idzie dokladnie tam, gdzie wskazano.
        cancelled_at = CASE
          WHEN r.status IN ('draft','pending','waitlist') THEN NULL
          ELSE r.cancelled_at
        END,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        qr_token_hash = COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex')),
        qr_issued_at = COALESCE(r.qr_issued_at, now()),
        updated_at = now()
    WHERE r.id = v_reg.id;

  ELSIF v_effective = 'unpaid' THEN
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'unpaid',
        updated_at = now()
    WHERE r.id = v_reg.id AND r.payment_status <> 'paid';

  ELSIF v_effective = 'partial_refund' THEN
    -- Zwrot czesciowy to korekta ceny, nie rezygnacja: uczestnik zachowuje
    -- miejsce i kod QR, zmienia sie wylacznie obraz rozliczenia.
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'partially_refunded',
        updated_at = now()
    WHERE r.id = v_reg.id;

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

    v_promoted := public._event_waitlist_promote(
      v_order.tenant_id, v_event_id, COALESCE(v_ticket_type_id, v_reg.ticket_type_id), 1);
  END IF;

  SELECT * INTO v_person FROM public.event_people p WHERE p.id = v_reg.person_id;
  SELECT * INTO v_event FROM public.events e WHERE e.id = v_event_id;

  PERFORM public.emit_domain_event(
    v_order.tenant_id,
    'event_registration',
    v_reg.id::text,
    'event.registration.payment.v1',
    jsonb_build_object('event_id', v_event_id, 'order_id', v_order.id,
                       'outcome', v_effective, 'refunded_cents', v_refunded),
    NULL
  );

  RETURN jsonb_build_object(
    'applied', true,
    'registration_id', v_reg.id,
    'outcome', v_effective,
    'refunded_cents', v_refunded,
    'amount_cents', v_order.amount_cents,
    'currency', v_order.currency,
    'tenant_id', v_order.tenant_id,
    'event_id', v_event_id,
    'event_title_pl', v_event.title_pl,
    'event_title_en', v_event.title_en,
    'event_slug', v_event.slug,
    'contact', jsonb_build_object(
      'person_id', v_reg.person_id,
      'user_id', v_order.user_id,
      'email', v_person.email,
      'phone', v_person.phone,
      'first_name', v_person.first_name,
      'last_name', v_person.last_name
    ),
    'waitlist', v_promoted
  );
END;
$function$;
COMMENT ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) IS
  'Przenosi wynik platnosci na zgloszenie. Gdy zamowienie niesie metadata.registration_id, dopasowanie idzie WYLACZNIE po nim (niezgodnosc = jawna odmowa registration_mismatch); dopasowanie po osobie zostaje wylacznie dla zamowien bez tego klucza.';

REVOKE ALL ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) TO service_role;
