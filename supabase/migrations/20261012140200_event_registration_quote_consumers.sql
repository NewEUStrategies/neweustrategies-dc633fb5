-- events-harness: include
-- ============================================================================
-- ZAPIS NA WYDARZENIE (B1a, CZESC 3): KASA BEZ UKRYTEGO BILETU Z ULICY,
-- KONTEKST PLATNOSCI I FAKTURA Z CENA Z CHWILI ZAPISU.
--
-- DEFEKT
--   1. REG-05. `_event_ticket_checkout_quote` (20261007140400:107-181) nie
--      patrzyl na `is_hidden`: bilet ukryty bez kodu dostepu dawal sie wycenic
--      i kupic samym identyfikatorem (`createCheckoutOrder` przyjmuje
--      `ticket_type_id` bez zgloszenia).
--   2. REG-16. `event_registration_payment_context` (20260926140000:60-145,
--      :115) i `_event_invoice_registration_source` (20260927000201:422-578,
--      :533) liczyly zgloszenie nieoplacone cena z TEJ chwili - po koncu early
--      birda uczestnik zapisany po cenie promocyjnej dostawal w kasie
--      i w proformie cene standardowa.
--
-- ZMIANA (ciala z podanych migracji, zmiany oznaczone `ZMIANA 20261012`):
--   A. `_event_ticket_checkout_quote`: bilet ukryty bez kodu dostepu wycenia
--      sie wylacznie posiadaczowi zgloszenia na ten bilet (zalozyl je albo
--      jest jego osoba) - inaczej `ticket_not_available`, ta sama odpowiedz
--      co dla biletu, ktorego nie ma. Zgloszenie na taki bilet powstaje tylko
--      z kodem odslaniajacym (20261012140000).
--   B. `event_registration_payment_context`: `amount_cents` =
--      `_event_registration_unit_price(zgloszenie, bilet)` (oferta z chwili
--      zapisu, dopoki wazna, albo cena biezaca) + `price_source`
--      ('quote'|'current') i `quote_valid_until` - kasa (B1b,
--      eventTicketPricing.server.ts) liczy z nich miejsce zgloszenia.
--   C. `_event_invoice_registration_source`: zgloszenie nieoplacone (proforma)
--      - ta sama cena jednostkowa.
--
-- CZEGO TO NIE ZAMYKA: `event_registration_manage_view` i
-- `event_my_registrations` (inni wlasciciele, B7/B4) - przechodza na
-- `_event_registration_unit_price` w swoich migracjach. Kasa nadal odmawia
-- po `sales_to` biletu nawet przy waznej ofercie (regula kasy, nie ceny).
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD. Kasa (B1b) czyta `price_source`
-- i `amount_cents`, gdy sa; starsza baza ich nie ma i kasa liczy jak dotad.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_register_entry_hardening_test.sql (REG-05 kasa,
--   REG-16 granica early birda), scripts/events-harness/runtime_test.d/
--   21_register_entry_hardening.sql, 25_payment_binding.sql, 27_invoices.sql,
--   29_group_lead_plan_seat.sql.
-- ============================================================================

-- A) WYCENA KASY ------------------------------------------------------------------
-- Cialo z 20261007140400:107-181.
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

  -- ZMIANA 20261012 (REG-05, D6): BILET UKRYTY BEZ KODU DOSTEPU kupuje
  -- wylacznie posiadacz zgloszenia na ten bilet (zalozyl je albo jest jego
  -- osoba) - zgloszenie powstaje tylko z kodem odslaniajacym. Kazdy inny
  -- dostaje te sama odmowe co dla biletu, ktorego nie ma, ZANIM padnie
  -- cokolwiek o wydarzeniu czy oknie sprzedazy.
  IF t.is_hidden AND t.access_code_hash IS NULL AND NOT EXISTS (
    SELECT 1
      FROM public.event_registrations r
      LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
     WHERE r.tenant_id = v_tenant
       AND r.ticket_type_id = t.id
       AND r.status NOT IN ('cancelled', 'rejected')
       AND (r.created_by = p_uid OR p.user_id = p_uid)
  ) THEN
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
GRANT EXECUTE ON FUNCTION public._event_ticket_checkout_quote(uuid, uuid, text, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_ticket_checkout_quote(uuid, uuid, text, uuid, text) IS
  'Rdzen wyceny wejsciowki dla kasy (najemca, konto i solony skrot adresu z argumentow). Pudlo kodu dostepu wartoscia {ok:false, error:ticket_access_code_invalid} (kubelki biletu, konta, adresu). Bilet ukryty bez kodu dostepu tylko dla posiadacza zgloszenia na ten bilet, inaczej ticket_not_available (REG-05). Wolaja wrappery service_role.';

-- B) KONTEKST PLATNOSCI ----------------------------------------------------------------
-- Cialo z 20260926140000:60-136.
CREATE OR REPLACE FUNCTION public.event_registration_payment_context(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_reg public.event_registrations;
  v_ticket public.event_ticket_types;
  v_slug text;
  v_unit jsonb;
  v_holder boolean := false;
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
  END IF;

  -- ZMIANA 20261012 (REG-16, D8): cena z chwili zapisu. Oferta zgloszenia
  -- obowiazuje do `quote_valid_until` (LEAST z cena biezaca - obnizka
  -- przechodzi na uczestnika, koniec early birda nie); po niej, bez oferty
  -- albo w innej walucie - cena biezaca. Jedna regula:
  -- `_event_registration_unit_price`.
  v_unit := public._event_registration_unit_price(v_reg, v_ticket);

  -- MIEJSCE WOLAJACEGO. Oplacic moze tez ten, kto zgloszenie ZALOZYL
  -- (prowadzacy za goscia), ale benefit planu nalezy do osoby zgloszenia.
  v_holder := EXISTS (
    SELECT 1 FROM public.event_people p
    WHERE p.id = v_reg.person_id AND p.tenant_id = v_tenant AND p.user_id = v_uid
  );

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg.id,
    'event_id', v_reg.event_id,
    'event_slug', v_slug,
    'ticket_type_id', v_reg.ticket_type_id,
    'status', v_reg.status,
    'payment_status', v_reg.payment_status,
    'amount_cents', COALESCE((v_unit->>'amount_cents')::integer, 0),
    'price_source', COALESCE(v_unit->>'source', 'current'),
    'quote_valid_until', v_unit->'quote_valid_until',
    'currency', v_ticket.currency,
    'holder_is_caller', v_holder
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_payment_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_registration_payment_context(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_payment_context(uuid) IS
  'Czy WOLAJACY moze oplacic wskazane zgloszenie: wlasnosc (created_by albo event_people.user_id), stan zapisu, kwota zgloszenia (_event_registration_unit_price: oferta z chwili zapisu albo cena biezaca; price_source quote|current, quote_valid_until) i holder_is_caller (osoba zgloszenia to wolajacy - tylko wtedy kasa liczy benefit planu). Kasa waliduje nia registration_id i liczy z niej cene miejsca zgloszenia.';

-- C) ZAPIS JAKO ZRODLO DOKUMENTU ----------------------------------------------------------
-- Cialo z 20260927000201:422-578.
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
BEGIN
  SELECT r.id, r.event_id, r.person_id, r.group_lead_registration_id, r.status, r.payment_status,
         r.payment_order_id, r.ticket_type_id,
         COALESCE(r.paid_at, o.paid_at) AS paid_at,
         p.user_id AS holder_user_id, o.user_id AS payer_user_id,
         COALESCE(t.name_pl, '') AS name_pl, COALESCE(t.name_en, '') AS name_en,
         COALESCE(o.currency, t.currency, 'PLN') AS currency,
         (o.id IS NOT NULL AND o.status::text IN ('paid', 'refunded')) AS via_card,
         (o.amount_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS order_gross,
         COALESCE(o.metadata, '{}'::jsonb) AS meta,
         t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule,
         COALESCE(t.tax_mode, 'inclusive') AS tax_mode
    INTO v
    FROM public.event_registrations r
    JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    LEFT JOIN public.event_ticket_types t ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
   WHERE r.id = p_registration_id AND r.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v.group_lead_registration_id IS NOT NULL THEN
    SELECT l.payment_order_id INTO v_lead_order
      FROM public.event_registrations l
     WHERE l.id = v.group_lead_registration_id AND l.tenant_id = p_tenant;
    IF NOT (v.via_card AND v.payment_order_id IS DISTINCT FROM v_lead_order) THEN
      v_block := 'not_lead';
    END IF;
  ELSE
    -- Goscie rozliczani przez prowadzacego: bez wlasnego zamowienia z karty
    -- (gosc z wlasnym zamowieniem to osobne zrodlo), otwarci, nie zwroceni.
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
      -- Czesc prowadzacego: zaokraglenie polowkowe, reszta to goscie.
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
    IF v_block IS NULL AND v_seats < 1 THEN
      v_block := 'plan_ticket';
    END IF;
    -- ZMIANA 20261012 (REG-16, D8): zgloszenie NIEOPLACONE (proforma) - cena
    -- z chwili zapisu (`_event_registration_unit_price`: oferta, dopoki
    -- wazna, inaczej cena biezaca), ta sama co w kasie i panelu. Oplacone -
    -- cena fazy z chwili zaplaty, jak dotad.
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
    -- Kupujacy zamowienia z karty to PLATNIK (po przekazaniu biletu osoba
    -- zapisu jest kim innym), bez zamowienia - osoba zapisu.
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
      WHEN v.tax_mode = 'exclusive' THEN 'price_list_net'
      ELSE 'price_list'
    END
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) TO service_role;
COMMENT ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) IS
  'Zapis jako zrodlo dokumentu (bez wyjatkow): block (not_lead, closed, plan_ticket albo NULL), miejsca, kwota i grupy pozycji (zamowienie z karty wg metadata.quantity i benefitu planu; zapis nieoplacony wg _event_registration_unit_price - oferta z chwili zapisu albo cena biezaca; oplacony bez karty - cena fazy z chwili zaplaty), karta, platnik, admission.';
