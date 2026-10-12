-- events-harness: include
-- ============================================================================
-- JEDNA KSIEGA MIEJSC: ZGLOSZENIA + MIEJSCA PAKIETOW (audyt biletow TIX-03,
-- TIX-04, TIX-07, TIX-08, TIX-13b; czesc TIX-13a).
--
-- 1. KSIEGA (TIX-04). Zakup pakietu robil `sold_count = sold_count + seats`,
--    a trigger zgloszen po KAZDEJ zmianie przeliczal `sold_count` od nowa jako
--    `count(approved/attended/no_show)` - slepy na miejsca pakietow. Pierwsza
--    zmiana statusu dowolnego zgloszenia na ten bilet oddawala miejsca pakietu
--    do sprzedazy, a delegat z oplaconym zaproszeniem dostawal potem CHECK
--    `event_ticket_types_sold_within_quota`. Pakiety nie liczyly sie tez do
--    `events.capacity`. Teraz jedna regula w jednym miejscu:
--      sold_count(bilet) = zgloszenia na miejscu
--                        + miejsca pakietow TRZYMANE w puli
--    gdzie miejsce pakietu trzyma pule, gdy jest nieodwolane, jego zamowienie
--    zyje (`pending`/`paid`) i nie ma jeszcze zgloszenia na miejscu (puste albo
--    zgloszenie czeka: draft/pending/waitlist). Przyjete zgloszenie liczy sie
--    samo, wiec przejscie miejsca -> zgloszenie nie liczy sie dwa razy.
--    `_event_seats_left` (pojemnosc) i `event_seat_state` licza to samo.
--    Anulowanie / zwrot zamowienia przelicza pule (trigger statusu zamowienia).
--
-- 2. ZAMOWIENIA PAKIETOW `pending` (TIX-07). Termin platnosci (`pay_by`) na
--    zakupie samoobslugowym, przeglad anulujacy przeterminowane zamowienia
--    (pg_cron + community-cron), limit otwartych zamowien na kupujacego,
--    a przyjecie zaproszenia z NIEOPLACONEGO zamowienia zostawia zgloszenie
--    `pending` bez kodu QR - wchodzi na miejsce, gdy zamowienie zostanie
--    oplacone (albo od razu, gdy pakiet ma jawna flage zaufania do faktury
--    `admit_before_payment`).
--
--    PRZY OKAZJI: przyjecie zaproszenia NIGDY nie dzialalo - dwa CHECK-i
--    odrzucaly kazde wywolanie (23514), a zaden harness go nie wykonywal:
--      * `source = 'package_invitation'` nie bylo w
--        `event_registrations_source_values` ani `event_people_source_values`
--        (CHECK-i dostaja te wartosc; lejek reklam 20260927001100 juz ja
--        odfiltrowuje);
--      * `invite_token_hash = NULL` przy zostawionym `invite_email` lamalo
--        `event_package_seats_invite_pair` (skrot zostaje, jednorazowosc
--        trzyma `registration_id`).
--
-- 3. GOSCIE PO OTWARCIU KASY (TIX-03). Dopisanie gosci bylo dozwolone przy
--    otwartej kasie, a wplata oplacala WSZYSTKICH gosci prowadzacego - grupa za
--    2 miejsca dostawala 10 biletow. Teraz: dopisanie odmawia przy swiezym
--    zamowieniu `pending`/`processing` tego zgloszenia, a wplata rozlicza
--    najwyzej `quantity - 1` gosci istniejacych PRZED zalozeniem zamowienia;
--    reszta zostaje nieoplacona.
--
-- 4. ZAKUP BEZ ZGLOSZENIA (TIX-08). Decyzja o miejscu RSVP po wplacie szla
--    w webhooku jako odczyt + osobny zapis, bez blokady: dwa webhooki o ostatnie
--    miejsce przechodzily oba. `_event_rsvp_claim_paid_seat` rozstrzyga pod
--    blokada wiersza wydarzenia (ta sama kolejnosc blokad co ksiegowanie wplaty).
--
-- 5. OKNO WAZNOSCI KODU (TIX-13b). Pakiet liczyl `now() < valid_until`, bilet
--    `now() <= valid_until`. Jedna funkcja `_b2b_coupon_window_open` (granice
--    domkniete) we wszystkich sciezkach.
--
-- 6. KUMULACJA RABATOW (TIX-13a, czesc bazodanowa): kolumny kodu
--    `stacks_with_promotions` i `max_total_discount_percent`. Regule liczy
--    wspolna wycena biletu (`eventTicketPricing.server.ts`).
--
-- KOLEJNOSC BLOKAD bez zmian: wydarzenie -> bilet -> zgloszenie; kod -> zamowienie
-- pakietu (20260926180000).
--
-- IDEMPOTENTNA: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
-- DOWOD: scripts/events-harness/runtime_test.d/78_ticket_checkout_integrity.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) KOLUMNY I OGRANICZENIA
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_ticket_packages
  ADD COLUMN IF NOT EXISTS admit_before_payment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS max_open_orders_per_buyer integer DEFAULT 3;

DO $$ BEGIN
  ALTER TABLE public.event_ticket_packages
    ADD CONSTRAINT event_ticket_packages_payment_terms_range
    CHECK (payment_terms_days BETWEEN 1 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_ticket_packages
    ADD CONSTRAINT event_ticket_packages_open_orders_range
    CHECK (max_open_orders_per_buyer IS NULL OR max_open_orders_per_buyer BETWEEN 1 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.event_ticket_packages.admit_before_payment IS
  'Zaufanie do faktury: zaproszenie z NIEOPLACONEGO zamowienia wpuszcza delegata od razu (zgloszenie approved z kodem QR). Domyslnie false - delegat czeka jako pending, az zamowienie zostanie oplacone (TIX-07).';
COMMENT ON COLUMN public.event_ticket_packages.max_open_orders_per_buyer IS
  'Ile NIEOPLACONYCH zamowien (pending) jeden kupujacy moze miec na to wydarzenie, kupujac ten pakiet. Seria zamowien bez platnosci blokowala pule biletu (TIX-07). NULL = bez limitu (decyzja organizatora).';
COMMENT ON COLUMN public.event_ticket_packages.payment_terms_days IS
  'Termin platnosci zakupu samoobslugowego w dniach (event_package_orders.pay_by). Po terminie przeglad _event_package_orders_expire anuluje zamowienie i oddaje miejsca do puli.';

ALTER TABLE public.event_package_orders
  ADD COLUMN IF NOT EXISTS pay_by timestamptz;

COMMENT ON COLUMN public.event_package_orders.pay_by IS
  'Termin platnosci zamowienia pakietu. NULL = bez terminu (zamowienie organizatora albo sprzed 20261012090000). Przeterminowane zamowienie pending bez delegata na miejscu anuluje _event_package_orders_expire.';

CREATE INDEX IF NOT EXISTS event_package_orders_pay_by_idx
  ON public.event_package_orders (pay_by)
  WHERE status = 'pending' AND pay_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_package_seats_event_live_idx
  ON public.event_package_seats (tenant_id, event_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.b2b_coupons
  ADD COLUMN IF NOT EXISTS stacks_with_promotions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_total_discount_percent smallint;

DO $$ BEGIN
  ALTER TABLE public.b2b_coupons
    ADD CONSTRAINT b2b_coupons_max_total_discount_range
    CHECK (max_total_discount_percent IS NULL OR max_total_discount_percent BETWEEN 1 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.b2b_coupons.stacks_with_promotions IS
  'false = kod nie laczy sie z innymi promocjami biletu (faza sprzedazy, benefit planu): przy aktywnej promocji kasa odmawia kodu (coupon_not_combinable).';
COMMENT ON COLUMN public.b2b_coupons.max_total_discount_percent IS
  'Gorny limit LACZNEGO rabatu biletu (faza + benefit + kod) w procentach ceny regularnej. Kod, ktory by go przekroczyl, schodzi tylko do limitu. NULL = bez limitu.';

-- Zrodlo zgloszenia z zaproszenia pakietu (patrz naglowek, punkt 2).
ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS event_registrations_source_values;
ALTER TABLE public.event_registrations ADD CONSTRAINT event_registrations_source_values
  CHECK (source = ANY (ARRAY['self_registration'::text, 'invitation'::text, 'organizer'::text,
                             'import'::text, 'crm'::text, 'partner'::text, 'scan'::text,
                             'package_invitation'::text]));
ALTER TABLE public.event_people DROP CONSTRAINT IF EXISTS event_people_source_values;
ALTER TABLE public.event_people ADD CONSTRAINT event_people_source_values
  CHECK (source = ANY (ARRAY['self_registration'::text, 'invitation'::text, 'organizer'::text,
                             'import'::text, 'crm'::text, 'partner'::text, 'scan'::text,
                             'package_invitation'::text]));

-- ----------------------------------------------------------------------------
-- 1) FUNKCJE POMOCNICZE
-- ----------------------------------------------------------------------------

-- Okno waznosci kodu: granice DOMKNIETE po obu stronach - kod „do 18:00" dziala
-- jeszcze o 18:00:00 i w kasie biletu, i w zakupie pakietu.
CREATE OR REPLACE FUNCTION public._b2b_coupon_window_open(
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT (p_valid_from IS NULL OR p_at >= p_valid_from)
     AND (p_valid_until IS NULL OR p_at <= p_valid_until);
$$;
REVOKE ALL ON FUNCTION public._b2b_coupon_window_open(timestamptz, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._b2b_coupon_window_open(timestamptz, timestamptz, timestamptz)
  TO service_role;
COMMENT ON FUNCTION public._b2b_coupon_window_open(timestamptz, timestamptz, timestamptz) IS
  'Jedyna regula okna waznosci kodu (b2b_coupons.valid_from/valid_until): granice domkniete. Uzywaja jej kasa biletu, zakup pakietu, odslanianie biletow i rezerwacja uzycia (TIX-13b).';

-- Miejsca pakietow trzymane w puli (regula w naglowku, punkt 1).
CREATE OR REPLACE FUNCTION public._event_package_seats_held(
  p_tenant uuid,
  p_event_id uuid,
  p_ticket_type_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT count(*)::integer
  FROM public.event_package_seats s
  JOIN public.event_package_orders o
    ON o.id = s.package_order_id AND o.tenant_id = s.tenant_id
  JOIN public.event_ticket_packages p
    ON p.id = o.package_id AND p.tenant_id = o.tenant_id
  LEFT JOIN public.event_registrations r
    ON r.id = s.registration_id AND r.tenant_id = s.tenant_id
  WHERE s.tenant_id = p_tenant
    AND s.event_id = p_event_id
    AND s.revoked_at IS NULL
    AND o.status IN ('pending', 'paid')
    AND (p_ticket_type_id IS NULL OR p.ticket_type_id = p_ticket_type_id)
    AND (s.registration_id IS NULL OR r.id IS NULL OR r.status IN ('draft', 'pending', 'waitlist'));
$$;
REVOKE ALL ON FUNCTION public._event_package_seats_held(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_package_seats_held(uuid, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_package_seats_held(uuid, uuid, uuid) IS
  'Miejsca pakietow trzymane w puli wydarzenia (opcjonalnie: biletu): nieodwolane, z zamowienia pending/paid, bez zgloszenia na miejscu. Druga polowa jednej ksiegi miejsc (TIX-04).';

-- Przelicznik puli biletu - JEDYNE miejsce, ktore pisze `sold_count` biletu.
CREATE OR REPLACE FUNCTION public._event_ticket_sold_recount(p_tenant uuid, p_ticket_type_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event uuid;
  v_n integer;
BEGIN
  IF p_tenant IS NULL OR p_ticket_type_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT t.event_id INTO v_event
  FROM public.event_ticket_types t
  WHERE t.id = p_ticket_type_id AND t.tenant_id = p_tenant;
  IF v_event IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::integer INTO v_n
  FROM public.event_registrations r
  WHERE r.tenant_id = p_tenant
    AND r.ticket_type_id = p_ticket_type_id
    AND r.status IN ('approved', 'attended', 'no_show');
  v_n := v_n + public._event_package_seats_held(p_tenant, v_event, p_ticket_type_id);

  UPDATE public.event_ticket_types t
  SET sold_count = v_n
  WHERE t.id = p_ticket_type_id AND t.tenant_id = p_tenant AND t.sold_count <> v_n;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_ticket_sold_recount(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_sold_recount(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_ticket_sold_recount(uuid, uuid) IS
  'Przelicza event_ticket_types.sold_count jedna regula: zgloszenia approved/attended/no_show + miejsca pakietow trzymane w puli (_event_package_seats_held). Woluja ja triggery zgloszen, miejsc i zamowien pakietow (TIX-04).';

-- Licznik pakietow (event_ticket_packages.sold_count) - zamowienia, ktore zyja.
CREATE OR REPLACE FUNCTION public._event_package_sold_recount(p_tenant uuid, p_package_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_tenant IS NULL OR p_package_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*)::integer INTO v_n
  FROM public.event_package_orders o
  WHERE o.tenant_id = p_tenant AND o.package_id = p_package_id
    AND o.status IN ('pending', 'paid');
  UPDATE public.event_ticket_packages p
  SET sold_count = v_n
  WHERE p.id = p_package_id AND p.tenant_id = p_tenant AND p.sold_count <> v_n;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_package_sold_recount(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_package_sold_recount(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) KSIEGA: TRIGGERY (TIX-04)
-- ----------------------------------------------------------------------------

-- Zgloszenie: bilet zgloszenia (stary i nowy) oraz bilet pakietu, ktorego
-- miejsce wskazuje to zgloszenie (zgloszenie czekajace trzyma miejsce pakietu,
-- przyjete - juz nie).
CREATE OR REPLACE FUNCTION public.tg_event_registrations_sync_ticket_sold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_reg uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id;
    v_reg := OLD.id;
  ELSE
    v_tenant := NEW.tenant_id;
    v_reg := NEW.id;
  END IF;

  IF TG_OP <> 'INSERT' AND OLD.ticket_type_id IS NOT NULL THEN
    v_ids := array_append(v_ids, OLD.ticket_type_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.ticket_type_id IS NOT NULL THEN
    v_ids := array_append(v_ids, NEW.ticket_type_id);
  END IF;

  v_ids := v_ids || COALESCE((
    SELECT array_agg(DISTINCT p.ticket_type_id)
    FROM public.event_package_seats s
    JOIN public.event_package_orders o
      ON o.id = s.package_order_id AND o.tenant_id = s.tenant_id
    JOIN public.event_ticket_packages p
      ON p.id = o.package_id AND p.tenant_id = o.tenant_id
    WHERE s.tenant_id = v_tenant AND s.registration_id = v_reg
  ), ARRAY[]::uuid[]);

  FOR v_id IN SELECT DISTINCT x FROM unnest(v_ids) AS x LOOP
    PERFORM public._event_ticket_sold_recount(v_tenant, v_id);
  END LOOP;

  RETURN NULL;
END;
$function$;

-- Miejsce pakietu: licznik przypisanych w zamowieniu (jak dotad) i pula biletu.
-- Kasowanie kaskadowe zamowienia zostawia miejsce bez wiersza zamowienia - wtedy
-- przeliczamy kazdy bilet pakietow tego wydarzenia.
CREATE OR REPLACE FUNCTION public.tg_event_package_seats_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order uuid := COALESCE(NEW.package_order_id, OLD.package_order_id);
  v_tenant uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_event uuid := COALESCE(NEW.event_id, OLD.event_id);
  v_ticket uuid;
BEGIN
  UPDATE public.event_package_orders o
  SET seats_assigned = (
    SELECT count(*)::integer FROM public.event_package_seats s
    WHERE s.package_order_id = v_order
      AND s.registration_id IS NOT NULL
      AND s.revoked_at IS NULL
  )
  WHERE o.id = v_order;

  SELECT p.ticket_type_id INTO v_ticket
  FROM public.event_package_orders o
  JOIN public.event_ticket_packages p ON p.id = o.package_id AND p.tenant_id = o.tenant_id
  WHERE o.id = v_order AND o.tenant_id = v_tenant;

  IF v_ticket IS NOT NULL THEN
    PERFORM public._event_ticket_sold_recount(v_tenant, v_ticket);
  ELSE
    FOR v_ticket IN
      SELECT DISTINCT p.ticket_type_id FROM public.event_ticket_packages p
      WHERE p.tenant_id = v_tenant AND p.event_id = v_event
    LOOP
      PERFORM public._event_ticket_sold_recount(v_tenant, v_ticket);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$;

-- Zamowienie pakietu: status (anulowanie, zwrot, powrot) zmienia to, co trzyma
-- pule, i liczbe sprzedanych pakietow.
CREATE OR REPLACE FUNCTION public._tg_event_package_order_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ticket uuid;
BEGIN
  SELECT p.ticket_type_id INTO v_ticket
  FROM public.event_ticket_packages p
  WHERE p.id = NEW.package_id AND p.tenant_id = NEW.tenant_id;
  PERFORM public._event_ticket_sold_recount(NEW.tenant_id, v_ticket);
  PERFORM public._event_package_sold_recount(NEW.tenant_id, NEW.package_id);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._tg_event_package_order_ledger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_package_orders_ledger ON public.event_package_orders;
CREATE TRIGGER event_package_orders_ledger
  AFTER INSERT OR UPDATE OF status, package_id ON public.event_package_orders
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_package_order_ledger();

-- Pojemnosc wydarzenia liczy tez miejsca pakietow trzymane w puli.
CREATE OR REPLACE FUNCTION public._event_seats_left(_tenant uuid, _event_id uuid, _ticket_type_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_capacity integer;
  v_used integer;
  v_quota integer;
  v_sold integer;
  v_left integer;
  v_ticket_left integer;
BEGIN
  SELECT e.capacity INTO v_capacity
  FROM public.events e
  WHERE e.id = _event_id AND e.tenant_id = _tenant;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF v_capacity IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used
    FROM public.event_registrations r
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.status IN ('approved', 'attended', 'no_show');
    -- TIX-04: miejsca pakietow zajmuja sale tak samo jak zgloszenia.
    v_used := v_used + public._event_package_seats_held(_tenant, _event_id, NULL);
    v_left := GREATEST(v_capacity - v_used, 0);
  END IF;

  IF _ticket_type_id IS NOT NULL THEN
    SELECT t.quota, t.sold_count INTO v_quota, v_sold
    FROM public.event_ticket_types t
    WHERE t.id = _ticket_type_id
      AND t.tenant_id = _tenant
      AND t.event_id = _event_id;

    IF NOT FOUND THEN
      RETURN 0;
    END IF;

    IF v_quota IS NOT NULL THEN
      v_ticket_left := GREATEST(v_quota - v_sold, 0);
      v_left := CASE
        WHEN v_left IS NULL THEN v_ticket_left
        ELSE LEAST(v_left, v_ticket_left)
      END;
    END IF;
  END IF;

  RETURN v_left;
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_seat_state(p_event_id uuid)
 RETURNS TABLE(event_id uuid, capacity integer, seats_left integer, going integer, waitlist integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_claims text := NULLIF(current_setting('request.jwt.claims', true), '');
  v_service boolean :=
       COALESCE(current_setting('role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (v_claims IS NOT NULL AND (v_claims::jsonb ->> 'role') = 'service_role');
  v_tenant uuid;
  v_event public.events;
  v_rsvp_going integer;
  v_rsvp_waitlist integer;
  v_reg_used integer;
  v_reg_waitlist integer;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  IF v_service THEN
    SELECT e.tenant_id INTO v_tenant FROM public.events e WHERE e.id = p_event_id;
  ELSE
    v_tenant := public.public_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.tenant_id = v_tenant
    AND e.status = 'published';
  IF v_event.id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) FILTER (WHERE r.status = 'going')::integer,
         count(*) FILTER (WHERE r.status = 'waitlist')::integer
    INTO v_rsvp_going, v_rsvp_waitlist
  FROM public.event_rsvps r
  WHERE r.tenant_id = v_tenant AND r.event_id = v_event.id;

  SELECT count(*) FILTER (WHERE g.status IN ('approved', 'attended', 'no_show'))::integer,
         count(*) FILTER (WHERE g.status = 'waitlist')::integer
    INTO v_reg_used, v_reg_waitlist
  FROM public.event_registrations g
  WHERE g.tenant_id = v_tenant AND g.event_id = v_event.id;

  -- TIX-04: miejsca zajete to zgloszenia na miejscu i miejsca pakietow w puli -
  -- ta sama regula, co `_event_seats_left`, wiec capacity - going = seats_left.
  v_reg_used := COALESCE(v_reg_used, 0) + public._event_package_seats_held(v_tenant, v_event.id, NULL);

  RETURN QUERY
  SELECT
    v_event.id,
    v_event.capacity,
    public._event_page_seats_left(v_tenant, v_event.id),
    GREATEST(COALESCE(v_rsvp_going, 0), COALESCE(v_reg_used, 0)),
    COALESCE(v_rsvp_waitlist, 0) + COALESCE(v_reg_waitlist, 0);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3) GOSCIE PO OTWARCIU KASY (TIX-03)
-- ----------------------------------------------------------------------------

-- Swieza kasa zgloszenia: zamowienie w toku z tym `registration_id`. Okno
-- 30 minut - porzucona nakladka nie blokuje grupy na dluzej, a wplata ze
-- starej sesji i tak rozliczy tylko gosci sprzed zamowienia (limit nizej).
CREATE OR REPLACE FUNCTION public._event_registration_checkout_open(p_tenant uuid, p_registration_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payment_orders o
    WHERE o.tenant_id = p_tenant
      AND o.status::text IN ('pending', 'processing')
      AND o.created_at > now() - interval '30 minutes'
      AND o.metadata->>'registration_id' = p_registration_id::text
  );
$$;
REVOKE ALL ON FUNCTION public._event_registration_checkout_open(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_checkout_open(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.event_register_group_guests(p_lead_registration_id uuid, p_guests jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_lead public.event_registrations;
  v_ticket public.event_ticket_types;
  v_guest jsonb;
  v_email text;
  v_first text;
  v_last text;
  v_person uuid;
  v_count integer;
  v_existing integer;
  v_seats integer;
  v_token text;
  v_reg uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'account_required'; END IF;
  IF jsonb_typeof(p_guests) <> 'array' THEN RAISE EXCEPTION 'invalid_guests'; END IF;
  v_count := jsonb_array_length(p_guests);
  IF v_count = 0 THEN RETURN jsonb_build_object('added', 0, 'registration_ids', '[]'::jsonb); END IF;

  SELECT r.* INTO v_lead FROM public.event_registrations r
  LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.id = p_lead_registration_id AND r.tenant_id = v_tenant
    AND r.group_lead_registration_id IS NULL
    AND (r.created_by = v_uid OR p.user_id = v_uid)
  FOR UPDATE OF r;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_lead.status IN ('cancelled','rejected') THEN RAISE EXCEPTION 'registration_closed'; END IF;
  IF v_lead.payment_status NOT IN ('unpaid','not_required') THEN RAISE EXCEPTION 'already_settled'; END IF;
  -- TIX-03: kasa wyliczyla juz liczbe miejsc - gosc dopisany teraz nie bylby
  -- w kwocie, a wplata nie moze go oplacic.
  IF v_lead.payment_status = 'unpaid'
     AND public._event_registration_checkout_open(v_tenant, v_lead.id) THEN
    RAISE EXCEPTION 'checkout_in_progress: finish or close the open payment before adding guests';
  END IF;

  SELECT * INTO v_ticket FROM public.event_ticket_types t
  WHERE t.id = v_lead.ticket_type_id AND t.tenant_id = v_tenant;
  IF v_ticket.id IS NULL OR NOT v_ticket.group_registration_enabled THEN
    RAISE EXCEPTION 'group_not_enabled';
  END IF;

  SELECT count(*)::integer INTO v_existing FROM public.event_registrations r
  WHERE r.group_lead_registration_id = v_lead.id AND r.status NOT IN ('cancelled','rejected');
  IF 1 + v_existing + v_count > v_ticket.group_max_size THEN
    RAISE EXCEPTION 'group_too_large';
  END IF;

  v_seats := public._event_seats_left(v_tenant, v_lead.event_id, v_ticket.id);
  IF v_seats IS NOT NULL AND v_seats < v_count THEN RAISE EXCEPTION 'sold_out'; END IF;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
    v_email := lower(btrim(COALESCE(v_guest->>'email','')));
    v_first := btrim(COALESCE(v_guest->>'first_name',''));
    v_last := btrim(COALESCE(v_guest->>'last_name',''));
    IF v_first = '' OR v_last = '' OR char_length(v_first) > 80 OR char_length(v_last) > 80 THEN
      RAISE EXCEPTION 'invalid_name';
    END IF;
    IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' OR char_length(v_email) > 320 THEN
      RAISE EXCEPTION 'invalid_email';
    END IF;

    SELECT p.id INTO v_person FROM public.event_people p
    WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;
    IF v_person IS NULL THEN
      INSERT INTO public.event_people (tenant_id, email, first_name, last_name, source, created_by)
      VALUES (v_tenant, v_email, v_first, v_last, 'self_registration', v_uid)
      RETURNING id INTO v_person;
    END IF;

    IF EXISTS (SELECT 1 FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant AND r.event_id = v_lead.event_id
        AND r.person_id = v_person AND r.status NOT IN ('cancelled','rejected')) THEN
      RAISE EXCEPTION 'already_registered: %', v_email;
    END IF;

    v_token := CASE WHEN v_lead.status = 'approved' AND v_lead.payment_status = 'not_required'
                    THEN public._event_new_qr_token() END;

    INSERT INTO public.event_registrations (
      tenant_id, event_id, person_id, ticket_type_id, group_id, status, registration_mode,
      answers, source, decided_at, decision_source, qr_token_hash, qr_issued_at,
      payment_status, created_by, group_lead_registration_id
    ) VALUES (
      v_tenant, v_lead.event_id, v_person, v_ticket.id, v_lead.group_id,
      CASE WHEN v_lead.status = 'waitlist' THEN 'pending' ELSE v_lead.status END,
      v_lead.registration_mode, '{}'::jsonb, 'self_registration',
      v_lead.decided_at, v_lead.decision_source,
      CASE WHEN v_token IS NOT NULL THEN encode(digest(v_token,'sha256'),'hex') END,
      CASE WHEN v_token IS NOT NULL THEN now() END,
      v_lead.payment_status, v_uid, v_lead.id
    ) RETURNING id INTO v_reg;
    v_ids := v_ids || v_reg;

    PERFORM public.emit_domain_event(v_tenant, 'event_registration', v_reg::text,
      'event.registration.created.v1',
      jsonb_build_object('event_id', v_lead.event_id, 'person_id', v_person,
        'ticket_type_id', v_ticket.id, 'source', 'group_registration',
        'group_lead_registration_id', v_lead.id), v_uid);
  END LOOP;

  RETURN jsonb_build_object('added', v_count, 'registration_ids', to_jsonb(v_ids));
END $function$;

-- Rozliczenie grupy: wplata oplaca najwyzej `quantity - 1` gosci istniejacych
-- PRZED zalozeniem zamowienia. Cialo: 20260926183100 (sekcja 4); zmiany
-- oznaczone `TIX-03` oraz przelicznik puli przez `_event_ticket_sold_recount`.
CREATE OR REPLACE FUNCTION public._event_apply_outcome_to_group(p_lead_id uuid, p_order_id uuid, p_outcome text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  g public.event_registrations;
  v_lead public.event_registrations;
  v_tenant uuid;
  v_token text;
  v_n integer := 0;
  v_freed uuid[] := ARRAY[]::uuid[];
  v_seated boolean;
  v_guest_user uuid;
  v_release uuid[] := ARRAY[]::uuid[];   -- ZMIANA (PF-F): group-release-after-promote
  v_cap_order uuid;                      -- TIX-03
  v_order_at timestamptz;                -- TIX-03
  v_guest_cap integer;                   -- TIX-03: NULL = bez limitu liczby
  v_settled integer := 0;                -- TIX-03
BEGIN
  SELECT * INTO v_lead FROM public.event_registrations l WHERE l.id = p_lead_id;
  v_tenant := v_lead.tenant_id;
  -- GOSCIE NIE WCHODZA PRZED PROWADZACYM (pozycja 5). Wplata bez miejsca stawia
  -- prowadzacego w kolejce, a bilet z akceptacja - w oczekiwaniu na decyzje.
  -- Goscie sa wtedy tylko rozliczani; przyjmie ich kaskada statusu, gdy
  -- prowadzacy wejdzie na miejsce (awans z kolejki albo decyzja organizatora).
  v_seated := v_lead.status IN ('approved', 'attended', 'no_show');

  -- TIX-03: zamowienie, ktore oplacilo prowadzacego. Trigger przekazuje je tylko
  -- przy ZMIANIE `payment_order_id`; gdy wczesniejsza nieudana platnosc tego
  -- samego zamowienia juz je wpisala, bierzemy je z wiersza prowadzacego.
  -- Rozliczenie bez zamowienia (decyzja organizatora) limitu nie ma.
  IF p_outcome = 'paid' THEN
    v_cap_order := COALESCE(p_order_id, v_lead.payment_order_id);
    IF v_cap_order IS NOT NULL THEN
      SELECT o.created_at,
             CASE WHEN COALESCE(o.metadata->>'quantity', '') ~ '^[0-9]{1,4}$'
                  THEN GREATEST((o.metadata->>'quantity')::integer - 1, 0) END
        INTO v_order_at, v_guest_cap
      FROM public.payment_orders o
      WHERE o.id = v_cap_order AND o.tenant_id = v_tenant;
    END IF;
  END IF;

  FOR g IN SELECT * FROM public.event_registrations r
    WHERE r.group_lead_registration_id = p_lead_id AND r.tenant_id = v_tenant
    ORDER BY r.created_at, r.id
    FOR UPDATE LOOP
    IF p_outcome IN ('refunded', 'partial_refund')
       AND g.payment_status NOT IN ('paid', 'partially_refunded') THEN
      CONTINUE;
    END IF;
    IF p_outcome = 'paid' THEN
      IF g.status IN ('cancelled','rejected') THEN CONTINUE; END IF;
      -- TIX-03: gosc, ktorego ta wplata dopiero oplaca, musi byc w kwocie
      -- zamowienia: istnial przed jego zalozeniem i miesci sie w `quantity - 1`.
      IF g.payment_status NOT IN ('paid', 'partially_refunded') THEN
        IF (v_order_at IS NOT NULL AND g.created_at > v_order_at)
           OR (v_guest_cap IS NOT NULL AND v_settled >= v_guest_cap) THEN
          CONTINUE;
        END IF;
        v_settled := v_settled + 1;
      END IF;
      IF g.status IN ('draft','pending','waitlist') THEN
        UPDATE public.event_registrations r SET
          payment_order_id = COALESCE(p_order_id, r.payment_order_id), payment_status = 'paid',
          paid_at = COALESCE(r.paid_at, now()),
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = v_tenant;
        IF v_seated THEN
          PERFORM public._event_ticket_sold_recount(v_tenant, g.ticket_type_id);
          PERFORM public._event_group_admit_guest(v_lead, g);
        END IF;
      ELSE
        -- Gosc juz przyjety albo obecny: tylko rozliczenie. Kod zostaje (albo
        -- powstaje, gdy przyjecie przyszlo bez niego).
        v_token := public._event_new_qr_token();
        UPDATE public.event_registrations r SET
          payment_order_id = COALESCE(p_order_id, r.payment_order_id), payment_status = 'paid',
          paid_at = COALESCE(r.paid_at, now()),
          waitlist_position = NULL,
          decided_at = COALESCE(r.decided_at, now()),
          decision_source = COALESCE(r.decision_source, 'system'),
          qr_token_hash = COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex')),
          qr_issued_at = COALESCE(r.qr_issued_at, now()),
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = v_tenant;
      END IF;
    ELSIF p_outcome = 'refunded' THEN
      -- Miejsce zajmowal gosc przyjety albo juz na sali - te same statusy,
      -- ktore liczy `_event_seats_left`. Gosc oplacony w kolejce, wycofany
      -- albo odrzucony miejsca nie trzymal.
      IF g.status IN ('approved', 'attended', 'no_show') THEN
        v_freed := array_append(v_freed, g.ticket_type_id);
      END IF;
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'refunded', paid_at = NULL,
        status = 'cancelled', cancelled_at = COALESCE(r.cancelled_at, now()),
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        -- ZMIANA (PF-F): group-refund-clears-qr - kod wejscia goscia traci
        -- waznosc razem z biletem prowadzacego (D0-2).
        qr_token_hash = NULL,
        qr_issued_at = NULL,
        -- Zawiadomienie o odwolanym bilecie (sekcja 1) - wyrazenie widzi
        -- wiersz SPRZED zwrotu, jak w kaskadzie statusu.
        ticket_revoked_at = CASE
          WHEN public._event_guest_ticket_reached(r) THEN now() ELSE r.ticket_revoked_at
        END,
        ticket_revoked_notice_claimed_at = CASE
          WHEN public._event_guest_ticket_reached(r) THEN NULL
          ELSE r.ticket_revoked_notice_claimed_at
        END,
        updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant;
      -- ZMIANA (PF-F): group-refund-releases-guests - konto goscia (jesli jest)
      -- traci zapisy na sesje, zakladki i starsza rezerwacje RSVP. Tylko gosc,
      -- ktory zaplacil (warunek na poczatku petli), wiec zwalniamy dokladnie
      -- tych, ktorych zwrot odwolal.
      SELECT p.user_id INTO v_guest_user
        FROM public.event_people p
       WHERE p.id = g.person_id AND p.tenant_id = v_tenant;
      -- ZMIANA (PF-F): group-release-after-promote - konto trafia na liste,
      -- a zwolnienie biegnie PO awansie kolejki (event_sessions ostatnia
      -- blokada, A.3). Nadal PO anulowaniu wiersza goscia (kontrakt straznika).
      IF v_guest_user IS NOT NULL THEN
        v_release := array_append(v_release, v_guest_user);
      END IF;
    ELSIF p_outcome = 'partial_refund' THEN
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'partially_refunded', updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant;
    ELSE
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'unpaid', updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant AND r.payment_status <> 'paid';
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- AWANS ZA MIEJSCA ZWOLNIONE ZWROTEM - PO PETLI, bez wlasnej grupy (patrz
  -- naglowek). Miejsce prowadzacego awansuje wolajacy, po kaskadzie statusu.
  IF cardinality(v_freed) > 0 THEN
    PERFORM public._event_group_promote_freed(v_tenant, v_lead.event_id, v_freed, p_lead_id);
  END IF;

  -- ZMIANA (PF-F): group-release-after-promote - zwolnienie kont zwroconych
  -- gosci (group-refund-releases-guests) na ostatnim szczeblu drabiny blokad.
  FOREACH v_guest_user IN ARRAY v_release LOOP
    PERFORM public._event_participant_release(v_tenant, v_lead.event_id, v_guest_user, 'refunded');
  END LOOP;

  RETURN v_n;
END $function$;

-- ----------------------------------------------------------------------------
-- 4) PAKIETY: ZAKUP, ZAMOWIENIE ORGANIZATORA, ZAPROSZENIE, STATUS (TIX-04/07)
-- ----------------------------------------------------------------------------

-- Zakup samoobslugowy. Cialo: 20261007120600; zmiany:
--   * blokada wiersza wydarzenia PRZED biletem (kolejnosc wydarzenie -> bilet)
--     i kontrola miejsc `_event_seats_left` - pula biletu ORAZ pojemnosc sali;
--   * limit otwartych zamowien na kupujacego i wydarzenie (TIX-07);
--   * termin platnosci `pay_by` z warunkow pakietu (TIX-07);
--   * okno kodu przez `_b2b_coupon_window_open` (TIX-13b);
--   * pula biletu przelicza sie triggerem miejsc - bez recznego `+ seats`.
CREATE OR REPLACE FUNCTION public._event_package_purchase(p_payload jsonb, p_ip_subject text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'buyer_email', '')));
  v_name text := btrim(COALESCE(p_payload->>'buyer_name', ''));
  v_note text := btrim(COALESCE(p_payload->>'invoice_note', ''));
  v_quote jsonb;
  v_pkg public.event_ticket_packages;
  v_type public.event_ticket_types;
  v_order_id uuid;
  v_coupon_id uuid;
  v_total integer;
  v_discount integer;
  v_per_user integer;
  v_left integer;
  v_open integer;
  v_starts timestamptz;
  v_pay_by timestamptz;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;
  IF v_package_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: package_id is required';
  END IF;
  -- FIRME NA ZAMOWIENIU USTALA ORGANIZATOR, NIE KUPUJACY. Przypiecie
  -- `company_id` robi most faktur przy WYSTAWIENIU (decyzja administratora,
  -- 20260927000200) i tylko na pustym polu - wartosc od kupujacego wyprzedzala
  -- te decyzje, a potem blokowala ja na zawsze. Klucz w ladunku (nawet pusty)
  -- to blad wolajacego, nie cicha zmiana znaczenia.
  IF p_payload ? 'company_id' THEN
    RAISE EXCEPTION 'forbidden_field: company_id is assigned by the organizer';
  END IF;

  v_quote := public._event_admission_quote(jsonb_build_object(
    'package_id', v_package_id,
    'coupon_code', COALESCE(p_payload->>'coupon_code', '')
  ), p_ip_subject);

  IF NOT (v_quote->>'ok')::boolean THEN
    -- PUDLO WRACA WARTOSCIA, NIE WYJATKIEM (20261007120600).
    IF v_quote->>'reason' = 'coupon_unknown' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_unknown');
    END IF;
    RAISE EXCEPTION 'refused_%: %', v_quote->>'reason', v_quote->>'reason';
  END IF;

  v_total := (v_quote->>'total_cents')::integer;
  v_discount := (v_quote->>'discount_cents')::integer;
  v_coupon_id := NULLIF(v_quote->>'coupon_id', '')::uuid;

  -- KOLEJNOSC BLOKAD: wydarzenie -> bilet -> pakiet (jak zapis i ksiegowanie
  -- wplaty). Pakiet pakietu nie zmienia wydarzenia, wiec odczyt bez blokady.
  SELECT e.starts_at INTO v_starts
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.id = (SELECT p.event_id FROM public.event_ticket_packages p
                WHERE p.id = v_package_id AND p.tenant_id = v_tenant)
  FOR UPDATE;

  SELECT t.* INTO v_type
  FROM public.event_ticket_types t
  JOIN public.event_ticket_packages p
    ON p.ticket_type_id = t.id AND p.tenant_id = t.tenant_id
  WHERE p.id = v_package_id AND p.tenant_id = v_tenant
  FOR UPDATE OF t;

  SELECT * INTO v_pkg
  FROM public.event_ticket_packages
  WHERE id = v_package_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_pkg.id IS NULL OR v_type.id IS NULL THEN
    RAISE EXCEPTION 'not_found: package does not exist in this tenant';
  END IF;

  IF v_pkg.quota IS NOT NULL AND v_pkg.sold_count >= v_pkg.quota THEN
    RAISE EXCEPTION 'sold_out: no packages left';
  END IF;
  -- TIX-07: otwarte zamowienia tego kupujacego na to wydarzenie. Seria
  -- zamowien bez platnosci blokowala cala pule biletu.
  SELECT count(*)::integer INTO v_open
  FROM public.event_package_orders o
  WHERE o.tenant_id = v_tenant AND o.event_id = v_pkg.event_id
    AND o.buyer_user_id = v_uid AND o.status = 'pending';
  IF v_pkg.max_open_orders_per_buyer IS NOT NULL AND v_open >= v_pkg.max_open_orders_per_buyer THEN
    RAISE EXCEPTION 'too_many_open_orders: pay or cancel an open order before buying another package';
  END IF;

  -- TIX-04: pula biletu ORAZ sala (pakiety licza sie do `events.capacity`).
  v_left := public._event_seats_left(v_tenant, v_pkg.event_id, v_type.id);
  IF v_left IS NOT NULL AND v_left < v_pkg.seats THEN
    RAISE EXCEPTION 'seats_exhausted: not enough seats left for a whole package';
  END IF;

  -- TIX-07: termin platnosci - warunki pakietu, najpozniej start wydarzenia.
  v_pay_by := now() + make_interval(days => v_pkg.payment_terms_days);
  IF v_starts IS NOT NULL AND v_starts > now() THEN
    v_pay_by := LEAST(v_pay_by, v_starts);
  END IF;

  INSERT INTO public.event_package_orders (
    tenant_id, event_id, package_id, buyer_user_id, company_id,
    buyer_email, buyer_name, seats_total, status,
    amount_cents, discount_cents, currency, coupon_id, invoice_note, created_by, pay_by
  ) VALUES (
    v_tenant, v_pkg.event_id, v_package_id, v_uid, NULL,
    CASE WHEN v_email <> '' THEN v_email
         ELSE lower(btrim((SELECT u.email FROM auth.users u WHERE u.id = v_uid))) END,
    v_name, v_pkg.seats, 'pending',
    v_total, v_discount, v_pkg.currency, v_coupon_id, v_note, v_uid, v_pay_by
  )
  RETURNING id INTO v_order_id;

  -- ZUZYCIE KODU W TEJ SAMEJ TRANSAKCJI CO ZAMOWIENIE (20261007120600).
  IF v_coupon_id IS NOT NULL THEN
    SELECT c.max_redemptions_per_user INTO v_per_user
    FROM public.b2b_coupons c
    WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant
    FOR UPDATE;

    IF v_per_user IS NOT NULL AND (
         SELECT count(*)
         FROM public.b2b_coupon_redemptions r
         WHERE r.coupon_id = v_coupon_id AND r.user_id = v_uid
           AND r.tenant_id = v_tenant
       ) >= v_per_user THEN
      RAISE EXCEPTION 'refused_coupon_used_by_you: code already used by this buyer in a concurrent order';
    END IF;

    UPDATE public.b2b_coupons c
    SET redemptions_count = c.redemptions_count + 1, updated_at = now()
    WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant AND c.active
      AND (c.max_redemptions IS NULL OR c.redemptions_count < c.max_redemptions)
      AND public._b2b_coupon_window_open(c.valid_from, c.valid_until);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'refused_coupon_exhausted: last use taken by a concurrent order';
    END IF;

    INSERT INTO public.b2b_coupon_redemptions (
      tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
      package_order_id
    ) VALUES (
      v_tenant, v_coupon_id, NULL, v_uid, v_discount, v_total + v_discount, v_pkg.currency,
      v_order_id
    );
  END IF;

  INSERT INTO public.event_package_seats (tenant_id, event_id, package_order_id)
  SELECT v_tenant, v_pkg.event_id, v_order_id FROM generate_series(1, v_pkg.seats);

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'seats', v_pkg.seats,
    'currency', v_pkg.currency,
    'total_cents', v_total,
    'discount_cents', v_discount,
    'status', 'pending',
    'pay_by', v_pay_by
  );
END;
$function$;

-- Zamowienie organizatora. Cialo: 20260827221214; zmiany: blokada wydarzenia,
-- kontrola miejsc (pula biletu + sala) PRZED wstawieniem miejsc - inaczej
-- trigger ksiegi odmowilby CHECK-iem bez nazwy - i opcjonalny termin `pay_by`.
-- Liczniki pakietu i biletu prowadza triggery (TIX-04).
CREATE OR REPLACE FUNCTION public.admin_event_package_order_create(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_package public.event_ticket_packages;
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'buyer_email', '')));
  v_name text := btrim(COALESCE(p_payload->>'buyer_name', ''));
  v_seats integer;
  v_order_id uuid;
  v_left integer;
  v_pay_by timestamptz := NULLIF(p_payload->>'pay_by', '')::timestamptz;
BEGIN
  IF v_package_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: package_id is required';
  END IF;

  -- KOLEJNOSC BLOKAD jak w zakupie: wydarzenie -> bilet -> pakiet.
  PERFORM 1 FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.id = (SELECT p.event_id FROM public.event_ticket_packages p
                WHERE p.id = v_package_id AND p.tenant_id = v_tenant)
  FOR UPDATE;

  PERFORM 1 FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant
    AND t.id = (SELECT p.ticket_type_id FROM public.event_ticket_packages p
                WHERE p.id = v_package_id AND p.tenant_id = v_tenant)
  FOR UPDATE;

  SELECT * INTO v_package
  FROM public.event_ticket_packages p
  WHERE p.id = v_package_id AND p.tenant_id = v_tenant
  FOR UPDATE;

  IF v_package.id IS NULL THEN
    RAISE EXCEPTION 'not_found: package does not exist in this tenant';
  END IF;

  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid buyer e-mail is required';
  END IF;

  IF v_package.quota IS NOT NULL AND v_package.sold_count >= v_package.quota THEN
    RAISE EXCEPTION 'package_sold_out: no packages of this kind are left';
  END IF;

  v_seats := COALESCE((NULLIF(p_payload->>'seats_total', ''))::integer, v_package.seats);
  IF v_seats < 1 OR v_seats > 1000 THEN
    RAISE EXCEPTION 'invalid_request: seats_total must be between 1 and 1000';
  END IF;

  v_left := public._event_seats_left(v_tenant, v_package.event_id, v_package.ticket_type_id);
  IF v_left IS NOT NULL AND v_left < v_seats THEN
    RAISE EXCEPTION 'seats_exhausted: not enough seats left for this order';
  END IF;
  IF v_pay_by IS NOT NULL AND v_pay_by <= now() THEN
    RAISE EXCEPTION 'invalid_request: pay_by must be in the future';
  END IF;

  INSERT INTO public.event_package_orders (
    tenant_id, event_id, package_id, buyer_email, buyer_name, seats_total,
    status, amount_cents, currency, invoice_note, created_by, pay_by
  ) VALUES (
    v_tenant, v_package.event_id, v_package.id, v_email, v_name, v_seats,
    'pending',
    COALESCE((NULLIF(p_payload->>'amount_cents', ''))::integer, v_package.price_cents),
    v_package.currency,
    left(btrim(COALESCE(p_payload->>'invoice_note', '')), 500),
    v_uid,
    v_pay_by
  )
  RETURNING id INTO v_order_id;

  -- Miejsca powstaja razem z zamowieniem: pusty wiersz jest jedynym miejscem,
  -- w ktore da sie pozniej wpisac uczestnika bez wyscigu o licznik.
  INSERT INTO public.event_package_seats (tenant_id, event_id, package_order_id)
  SELECT v_tenant, v_package.event_id, v_order_id
  FROM generate_series(1, v_seats);

  RETURN v_order_id;
END;
$function$;

-- Przyjecie zaproszenia. Cialo: 20260827221214; zmiany (TIX-07):
--   * zgloszenie powstaje `pending` i dopiero wtedy wskazuje miejsce - miejsce
--     trzyma pule do konca, wiec przejscie miejsce -> zgloszenie nie liczy sie
--     podwojnie (CHECK puli przy wyczerpanej sprzedazy);
--   * na miejsce (approved + kod QR) wchodzi tylko z zamowienia OPLACONEGO albo
--     z pakietu z jawna flaga `admit_before_payment`; inaczej czeka `pending`
--     bez kodu i przyjmuje je oplacenie zamowienia;
--   * zamowienie zwrocone odmawia jak anulowane.
CREATE OR REPLACE FUNCTION public.event_package_invite_accept(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  v_admit boolean;
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

  IF v_order.status IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'order_cancelled: the order behind this seat is cancelled';
  END IF;

  SELECT * INTO v_package
  FROM public.event_ticket_packages p
  WHERE p.id = v_order.package_id AND p.tenant_id = v_tenant;

  v_admit := v_order.status = 'paid' OR COALESCE(v_package.admit_before_payment, false);

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
    UPDATE public.event_people pe SET
      first_name = v_first,
      last_name = v_last,
      job_title = COALESCE(v_job, pe.job_title),
      company_text = COALESCE(v_company, pe.company_text),
      consent_data_processing_at = COALESCE(pe.consent_data_processing_at, now()),
      consent_withdrawn_at = NULL
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

  v_manage := public._event_new_qr_token();

  -- Najpierw `pending` - miejsce pakietu dalej trzyma pule (patrz naglowek).
  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source, manage_token_hash, created_by
  ) VALUES (
    v_tenant, v_seat.event_id, v_person_id, v_package.ticket_type_id, v_group_id,
    'pending', 'form', v_answers, 'package_invitation',
    encode(digest(v_manage, 'sha256'), 'hex'), v_uid
  )
  RETURNING id INTO v_reg_id;

  -- Skrot tokenu ZOSTAJE: CHECK `event_package_seats_invite_pair` wiaze go
  -- z adresem zaproszenia, a zerowanie samego skrotu (jak w ciele z
  -- 20260827221214) lamalo ten CHECK przy kazdym przyjeciu. Jednorazowosc
  -- trzyma `registration_id` - ponowne uzycie konczy sie `seat_taken`.
  UPDATE public.event_package_seats s SET
    registration_id = v_reg_id,
    assigned_at = now()
  WHERE s.id = v_seat.id AND s.tenant_id = v_tenant;

  IF v_admit THEN
    v_qr := public._event_new_qr_token();
    UPDATE public.event_registrations r SET
      status = 'approved',
      decided_at = now(),
      decision_source = 'system',
      qr_token_hash = encode(digest(v_qr, 'sha256'), 'hex'),
      qr_issued_at = now(),
      updated_at = now()
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_seat.event_id,
      'person_id', v_person_id,
      'status', CASE WHEN v_admit THEN 'approved' ELSE 'pending' END,
      'ticket_type_id', v_package.ticket_type_id,
      'source', 'package_invitation'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'registration_id', v_reg_id,
    'event_id', v_seat.event_id,
    'status', CASE WHEN v_admit THEN 'approved' ELSE 'pending' END,
    'awaiting_payment', NOT v_admit,
    'qr_token', v_qr,
    'manage_token', v_manage
  );
END;
$function$;

-- Zaproszenie od kupujacego i od organizatora: zamowienie zwrocone (refunded)
-- zamyka miejsca tak samo jak anulowane.
CREATE OR REPLACE FUNCTION public.event_package_seat_invite(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_order_id uuid := NULLIF(p_payload->>'package_order_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'email', '')));
  v_name text := btrim(COALESCE(p_payload->>'name', ''));
  v_days integer := COALESCE((NULLIF(p_payload->>'expires_in_days', ''))::integer, 30);
  v_order public.event_package_orders;
  v_seat_id uuid;
  v_token text;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid address is required';
  END IF;

  SELECT * INTO v_order
  FROM public.event_package_orders
  WHERE id = v_order_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'not_found: package order does not exist in this tenant';
  END IF;

  IF v_order.buyer_user_id IS DISTINCT FROM v_uid
     AND NOT (
       public.has_role(v_uid, 'admin'::app_role)
       OR public.is_super_admin(v_uid)
     ) THEN
    RAISE EXCEPTION 'forbidden: only the buyer or the organiser may hand out seats';
  END IF;

  IF v_order.status IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'order_cancelled: seats of a cancelled order cannot be handed out';
  END IF;

  SELECT id INTO v_seat_id
  FROM public.event_package_seats
  WHERE package_order_id = v_order_id
    AND tenant_id = v_tenant
    AND registration_id IS NULL
    AND invite_email IS NULL
    AND revoked_at IS NULL
  ORDER BY created_at, id
  LIMIT 1;

  IF v_seat_id IS NULL THEN
    RAISE EXCEPTION 'no_free_seat: every seat of this package is taken or invited';
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  UPDATE public.event_package_seats SET
    invite_email = v_email,
    invite_name = v_name,
    invite_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
    invite_sent_at = now(),
    invite_expires_at = now() + make_interval(days => GREATEST(v_days, 1))
  WHERE id = v_seat_id;

  RETURN jsonb_build_object(
    'seat_id', v_seat_id,
    'email', v_email,
    'token', v_token,
    'expires_at', now() + make_interval(days => GREATEST(v_days, 1))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_event_package_seat_invite(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'invite_email', '')));
  v_name text := btrim(COALESCE(p_payload->>'invite_name', ''));
  v_days integer := COALESCE((NULLIF(p_payload->>'valid_days', ''))::integer, 30);
  v_seat public.event_package_seats;
  v_status text;
  v_token text;
BEGIN
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid invitee e-mail is required';
  END IF;
  IF v_days < 1 OR v_days > 365 THEN
    RAISE EXCEPTION 'invalid_request: valid_days must be between 1 and 365';
  END IF;

  SELECT * INTO v_seat
  FROM public.event_package_seats s
  WHERE s.id = v_id AND s.tenant_id = v_tenant
  FOR UPDATE;

  IF v_seat.id IS NULL THEN
    RAISE EXCEPTION 'not_found: seat does not exist in this tenant';
  END IF;
  IF v_seat.registration_id IS NOT NULL THEN
    RAISE EXCEPTION 'seat_taken: this seat is already assigned to a participant';
  END IF;
  IF v_seat.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'seat_revoked: this seat has been withdrawn';
  END IF;

  SELECT o.status INTO v_status
  FROM public.event_package_orders o
  WHERE o.id = v_seat.package_order_id AND o.tenant_id = v_tenant;

  IF v_status IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'order_cancelled: the order behind this seat is cancelled';
  END IF;

  v_token := public._event_new_qr_token();

  UPDATE public.event_package_seats s SET
    invite_email = v_email,
    invite_name = left(v_name, 200),
    invite_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
    invite_sent_at = now(),
    invite_expires_at = now() + make_interval(days => v_days)
  WHERE s.id = v_id AND s.tenant_id = v_tenant;

  RETURN jsonb_build_object('seat_id', v_id, 'invite_token', v_token);
END;
$function$;

-- Status zamowienia pakietu - rdzen wspolny dla panelu i przegladu terminow.
-- Cialo: 20261007120600 (admin_event_package_order_set_status); zmiany (TIX-07):
--   * `p_expire_only`: przeglad terminow anuluje WYLACZNIE zamowienie nadal
--     `pending`, po `pay_by`, bez delegata na miejscu (warunek sprawdzany pod
--     blokada wiersza - nie na migawce z wyboru kandydatow);
--   * oplacenie przyjmuje delegatow czekajacych na zamowienie (`pending` ->
--     `approved`, decyzja `system`; kod QR wyda i wysle cron biletow);
--   * anulowanie i zwrot zamykaja miejsca bez delegata ORAZ zgloszenia
--     delegatow, ktore jeszcze nie weszly na miejsce;
--   * pula biletu i licznik pakietow przelicza trigger ksiegi (TIX-04).
CREATE OR REPLACE FUNCTION public._event_package_order_set_status_core(
  p_tenant uuid,
  p_payload jsonb,
  p_expire_only boolean DEFAULT false
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := p_tenant;
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_status text := lower(btrim(COALESCE(p_payload->>'status', '')));
  v_order public.event_package_orders;
  v_latch timestamptz;
  v_coupon_id uuid;
  v_per_user integer;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: tenant required';
  END IF;
  IF p_expire_only THEN
    v_status := 'cancelled';
  END IF;
  IF v_status NOT IN ('pending', 'paid', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'invalid_status: unknown order status';
  END IF;

  -- KOLEJNOSC BLOKAD: NAJPIERW KOD, potem zamowienie (20260926180000).
  PERFORM 1 FROM public.b2b_coupons c
  WHERE c.id = (SELECT o.coupon_id FROM public.event_package_orders o
                WHERE o.id = v_id AND o.tenant_id = v_tenant)
    AND c.tenant_id = v_tenant
  FOR UPDATE OF c;

  SELECT * INTO v_order
  FROM public.event_package_orders o
  WHERE o.id = v_id AND o.tenant_id = v_tenant
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    IF p_expire_only THEN
      RETURN false;
    END IF;
    RAISE EXCEPTION 'not_found: order does not exist in this tenant';
  END IF;

  IF p_expire_only AND (
       v_order.status <> 'pending'
       OR v_order.pay_by IS NULL
       OR v_order.pay_by > now()
       OR EXISTS (
         SELECT 1 FROM public.event_package_seats s
         JOIN public.event_registrations r
           ON r.id = s.registration_id AND r.tenant_id = s.tenant_id
         WHERE s.package_order_id = v_order.id AND s.tenant_id = v_tenant
           AND r.status IN ('approved', 'attended', 'no_show')
       )) THEN
    RETURN false;
  END IF;

  v_latch := v_order.coupon_released_at;

  IF v_status = 'cancelled' AND v_order.status <> 'cancelled' THEN
    -- A. WEJSCIE W ANULOWANIE - oddanie uzycia kodu (20260926130000).
    DELETE FROM public.b2b_coupon_redemptions r
    WHERE r.package_order_id = v_id AND r.tenant_id = v_tenant
      AND EXISTS (SELECT 1 FROM public.b2b_coupons c
                  WHERE c.id = r.coupon_id AND c.tenant_id = v_tenant)
    RETURNING r.coupon_id INTO v_coupon_id;

    IF FOUND THEN
      UPDATE public.b2b_coupons c
      SET redemptions_count = GREATEST(0, c.redemptions_count - 1), updated_at = now()
      WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant;
      v_latch := now();
    END IF;

  ELSIF v_status <> 'cancelled' AND v_order.status = 'cancelled'
        AND v_order.coupon_released_at IS NOT NULL THEN
    -- B. POWROT Z ANULOWANIA, KTORE ODDALO UZYCIE (20260926130000).
    IF v_order.coupon_id IS NOT NULL THEN
      SELECT c.id, c.max_redemptions_per_user INTO v_coupon_id, v_per_user
      FROM public.b2b_coupons c
      WHERE c.id = v_order.coupon_id AND c.tenant_id = v_tenant
      FOR UPDATE;
    END IF;

    IF v_coupon_id IS NOT NULL THEN
      IF v_per_user IS NOT NULL AND (
           SELECT count(*)
           FROM public.b2b_coupon_redemptions r
           WHERE r.coupon_id = v_coupon_id AND r.user_id = v_order.buyer_user_id
             AND r.tenant_id = v_tenant
         ) >= v_per_user THEN
        RAISE EXCEPTION 'coupon_restore_used_by_buyer: the buyer already used this code in another order';
      END IF;

      UPDATE public.b2b_coupons c
      SET redemptions_count = c.redemptions_count + 1, updated_at = now()
      WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant
        AND (c.max_redemptions IS NULL OR c.redemptions_count < c.max_redemptions);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'coupon_restore_exhausted: the code has no use left to give back to this order';
      END IF;

      INSERT INTO public.b2b_coupon_redemptions (
        tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
        package_order_id
      ) VALUES (
        v_tenant, v_coupon_id, NULL, v_order.buyer_user_id, v_order.discount_cents,
        v_order.amount_cents + v_order.discount_cents, v_order.currency,
        v_id
      );
    END IF;

    v_latch := NULL;
  END IF;

  -- Zatrzask w TYM SAMYM UPDATE co status (CHECK coupon_released_stamp).
  UPDATE public.event_package_orders o SET
    status = v_status,
    paid_at = CASE WHEN v_status IN ('paid', 'refunded') THEN COALESCE(o.paid_at, now()) END,
    cancelled_at = CASE WHEN v_status = 'cancelled' THEN COALESCE(o.cancelled_at, now()) END,
    coupon_released_at = v_latch
  WHERE o.id = v_id AND o.tenant_id = v_tenant;

  IF v_status = 'paid' AND v_order.status <> 'paid' THEN
    -- TIX-07: delegaci czekajacy na zaplate wchodza na miejsce. Ich miejsce
    -- pakietu trzymalo pule, wiec przejscie nie przekracza puli.
    UPDATE public.event_registrations r SET
      status = 'approved',
      decided_at = now(),
      decision_source = 'system',
      updated_at = now()
    FROM public.event_package_seats s
    WHERE s.package_order_id = v_id AND s.tenant_id = v_tenant
      AND s.revoked_at IS NULL
      AND r.id = s.registration_id AND r.tenant_id = s.tenant_id
      AND r.status = 'pending'
      AND r.source = 'package_invitation';
  END IF;

  -- Anulowane albo zwrocone zamowienie nie moze trzymac zaproszen, ktore ktos
  -- jeszcze przyjmie, ani delegatow czekajacych na jego zaplate.
  IF v_status IN ('cancelled', 'refunded') THEN
    UPDATE public.event_package_seats s SET
      revoked_at = now(),
      invite_email = NULL,
      invite_token_hash = NULL
    WHERE s.package_order_id = v_id
      AND s.tenant_id = v_tenant
      AND s.registration_id IS NULL
      AND s.revoked_at IS NULL;

    UPDATE public.event_registrations r SET
      status = 'cancelled',
      cancelled_at = COALESCE(r.cancelled_at, now()),
      decided_at = COALESCE(r.decided_at, now()),
      decision_source = COALESCE(r.decision_source, 'system'),
      updated_at = now()
    FROM public.event_package_seats s
    WHERE s.package_order_id = v_id AND s.tenant_id = v_tenant
      AND r.id = s.registration_id AND r.tenant_id = s.tenant_id
      AND r.status IN ('draft', 'pending', 'waitlist')
      AND r.source = 'package_invitation';
  END IF;

  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public._event_package_order_set_status_core(uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_package_order_set_status_core(uuid, jsonb, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_event_package_order_set_status(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public._event_package_order_set_status_core(
    public.assert_event_admin_tenant(), p_payload, false);
END;
$function$;

-- Przeglad terminow platnosci (TIX-07). Kandydaci bez blokady; decyzje
-- podejmuje rdzen pod blokadami w kolejnosci kod -> zamowienie.
CREATE OR REPLACE FUNCTION public._event_package_orders_expire(p_limit integer DEFAULT 200)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_n integer := 0;
BEGIN
  FOR v_row IN
    SELECT o.id, o.tenant_id
    FROM public.event_package_orders o
    WHERE o.status = 'pending' AND o.pay_by IS NOT NULL AND o.pay_by <= now()
    ORDER BY o.pay_by, o.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
  LOOP
    IF public._event_package_order_set_status_core(
         v_row.tenant_id, jsonb_build_object('id', v_row.id), true) THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._event_package_orders_expire(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_package_orders_expire(integer) TO service_role;
COMMENT ON FUNCTION public._event_package_orders_expire(integer) IS
  'Co godzine (pg_cron event-package-orders-expire) i z community-cron (event-ticket-codes): anuluje zamowienia pakietow pending po pay_by, bez delegata na miejscu - miejsca wracaja do puli, kod rabatowy oddaje uzycie (TIX-07). Zwraca liczbe anulowanych.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('event-package-orders-expire', '23 * * * *',
      'SELECT public._event_package_orders_expire(200)');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - expired package orders cancelled by community-cron (event-ticket-codes)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 5) ZAKUP BEZ ZGLOSZENIA: MIEJSCE RSVP POD BLOKADA (TIX-08)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_rsvp_claim_paid_seat(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders;
  v_event_id uuid;
  v_status text;
  v_left integer;
BEGIN
  SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = p_order_id;
  IF v_order.id IS NULL OR v_order.user_id IS NULL OR v_order.tenant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  v_event_id := CASE
    WHEN COALESCE(v_order.metadata->>'event_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'event_id')::uuid
  END;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_ticket_order');
  END IF;

  -- Ta sama blokada, na ktorej serializuje sie ksiegowanie wplaty i zapis.
  PERFORM 1 FROM public.events e
  WHERE e.id = v_event_id AND e.tenant_id = v_order.tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_not_found');
  END IF;

  SELECT r.status INTO v_status
  FROM public.event_rsvps r
  WHERE r.event_id = v_event_id AND r.user_id = v_order.user_id;
  IF v_status = 'going' THEN
    RETURN jsonb_build_object('ok', true, 'seated', true, 'already', true, 'event_id', v_event_id);
  END IF;

  v_left := public._event_page_seats_left(v_order.tenant_id, v_event_id);
  IF v_left IS NOT NULL AND v_left <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_full', 'event_id', v_event_id);
  END IF;

  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, updated_at)
  VALUES (v_order.tenant_id, v_event_id, v_order.user_id, 'going', now())
  ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'going', updated_at = now();

  RETURN jsonb_build_object('ok', true, 'seated', true, 'already', false, 'event_id', v_event_id);
END;
$function$;
REVOKE ALL ON FUNCTION public._event_rsvp_claim_paid_seat(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_rsvp_claim_paid_seat(uuid) TO service_role;
COMMENT ON FUNCTION public._event_rsvp_claim_paid_seat(uuid) IS
  'Webhook (oneTimeFulfilment): wplata bez zgloszenia formularza zajmuje miejsce RSVP pod blokada wiersza wydarzenia - regula _event_page_seats_left. event_full = zwrot. Idempotentne dla RSVP going (TIX-08).';

-- ----------------------------------------------------------------------------
-- 6) OKNO WAZNOSCI KODU WE WSZYSTKICH SCIEZKACH (TIX-13b)
-- ----------------------------------------------------------------------------
-- Ciala z katalogu (pg_get_functiondef); jedyna zmiana: warunki okna kodu
-- przez `_b2b_coupon_window_open`. Sygnatury, typy wyniku i ACL bez zmian.
CREATE OR REPLACE FUNCTION public._event_admission_quote(p_payload jsonb, p_ip_subject text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_ticket_type_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_code text := upper(btrim(COALESCE(p_payload->>'coupon_code', '')));
  v_kind text;
  v_audience text;
  v_requires_verification boolean;
  v_min_tier_rank integer;
  v_price integer;
  v_currency text;
  v_quota integer;
  v_sold integer;
  v_sales_from timestamptz;
  v_sales_to timestamptz;
  v_seats integer := 1;
  v_max_per_person integer;
  v_event_id uuid;
  v_is_active boolean;
  v_owned integer := 0;
  v_coupon public.b2b_coupons;
  v_discount integer := 0;
  v_used_by_user integer := 0;
  -- Rodzaj wejsciowki, po ktorym sprawdzamy zakres kodu: dla wejsciowki ona
  -- sama, dla pakietu - rodzaj, w ktory zamienia sie kazde jego miejsce.
  v_scope_type uuid;
  v_code_cents integer;
  v_per_seat integer;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sign_in_required');
  END IF;

  IF (v_ticket_type_id IS NULL) = (v_package_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload: give exactly one of ticket_type_id or package_id';
  END IF;

  IF v_ticket_type_id IS NOT NULL THEN
    v_kind := 'ticket';
    v_scope_type := v_ticket_type_id;
    SELECT t.event_id, t.audience, t.requires_verification, t.min_tier_rank,
           t.price_cents, t.currency, t.quota, t.sold_count, t.sales_from, t.sales_to,
           t.is_active, t.max_per_person
      INTO v_event_id, v_audience, v_requires_verification, v_min_tier_rank,
           v_price, v_currency, v_quota, v_sold, v_sales_from, v_sales_to,
           v_is_active, v_max_per_person
    FROM public.event_ticket_types t
    WHERE t.id = v_ticket_type_id AND t.tenant_id = v_tenant;
  ELSE
    v_kind := 'package';
    SELECT p.event_id, p.audience, p.requires_verification, p.min_tier_rank,
           p.price_cents, p.currency, p.quota, p.sold_count, p.sales_from, p.sales_to,
           p.is_active, p.seats, p.ticket_type_id
      INTO v_event_id, v_audience, v_requires_verification, v_min_tier_rank,
           v_price, v_currency, v_quota, v_sold, v_sales_from, v_sales_to,
           v_is_active, v_seats, v_scope_type
    FROM public.event_ticket_packages p
    WHERE p.id = v_package_id AND p.tenant_id = v_tenant;
  END IF;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF NOT v_is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;

  IF v_sales_from IS NOT NULL AND now() < v_sales_from THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_not_open',
                              'sales_from', v_sales_from);
  END IF;
  IF v_sales_to IS NOT NULL AND now() >= v_sales_to THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_closed');
  END IF;

  IF v_quota IS NOT NULL AND v_sold >= v_quota THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sold_out');
  END IF;

  IF v_min_tier_rank > 0 AND NOT public.has_tier_rank(v_min_tier_rank) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tier_required',
                              'min_tier_rank', v_min_tier_rank);
  END IF;

  IF v_audience NOT IN ('public', 'member') AND v_requires_verification
     AND NOT public.event_audience_qualifies(v_audience) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'audience_not_verified',
                              'audience', v_audience);
  END IF;

  IF v_kind = 'ticket' AND v_max_per_person IS NOT NULL THEN
    SELECT count(*)::integer INTO v_owned
    FROM public.event_registrations r
    JOIN public.event_people pe
      ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    WHERE r.tenant_id = v_tenant
      AND r.ticket_type_id = v_ticket_type_id
      AND pe.user_id = v_uid
      AND r.status NOT IN ('cancelled', 'rejected');
    IF v_owned >= v_max_per_person THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'per_person_limit',
                                'max_per_person', v_max_per_person, 'owned', v_owned);
    END IF;
  END IF;

  IF v_code <> '' THEN
    -- Straznik PRZED wyszukaniem kodu: przy pelnym kubelku pudel zadna wycena
    -- z kodem nie dostaje odpowiedzi (takze z dobrym kodem).
    PERFORM public._coupon_probe_guard(v_uid, p_ip_subject);
    SELECT * INTO v_coupon FROM public.b2b_coupons c
    WHERE c.tenant_id = v_tenant AND upper(c.code) = v_code;

    -- KLASA „NIE MA": brak, wylaczony i kod INNEGO wydarzenia to ta sama
    -- odpowiedz `coupon_unknown` i to samo zliczone pudlo. Zakres wydarzenia
    -- stoi PRZED waznoscia i limitami: wczesniej wygasly kod innego wydarzenia
    -- odpowiadal `coupon_expired`, czyli zdradzal, ze istnieje.
    IF v_coupon.id IS NULL OR NOT v_coupon.active
       OR (array_length(v_coupon.event_ids, 1) IS NOT NULL
           AND NOT (v_event_id = ANY (v_coupon.event_ids))) THEN
      PERFORM public._coupon_probe_miss(v_uid, p_ip_subject);
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_unknown');
    END IF;
    -- TIX-13b: okno kodu jedna regula (`_b2b_coupon_window_open`, granice
    -- domkniete) - dotad pakiet odmawial juz w chwili `valid_until`.
    IF NOT public._b2b_coupon_window_open(v_coupon.valid_from, NULL) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_not_yet_valid');
    END IF;
    IF NOT public._b2b_coupon_window_open(NULL, v_coupon.valid_until) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_expired');
    END IF;
    IF v_coupon.max_redemptions IS NOT NULL
       AND v_coupon.redemptions_count >= v_coupon.max_redemptions THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_exhausted');
    END IF;

    IF v_coupon.max_redemptions_per_user IS NOT NULL THEN
      SELECT count(*)::integer INTO v_used_by_user
      FROM public.b2b_coupon_redemptions r
      WHERE r.coupon_id = v_coupon.id AND r.user_id = v_uid
        AND r.tenant_id = v_tenant;
      IF v_used_by_user >= v_coupon.max_redemptions_per_user THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'coupon_used_by_you');
      END IF;
    END IF;

    -- ZAKRES BILETU OBEJMUJE TEZ PAKIET. Wczesniej ten warunek mial
    -- `v_kind = 'ticket'`, wiec kod „tylko na Standard" dzialal na pakiet
    -- dowolnego rodzaju - studio kodow nie wypelnia `package_ids`, wiec nic
    -- innego go nie zawezalo.
    --
    -- WYJATEK: pakiet wymieniony WPROST w `package_ids`. Kod „Standard + pakiet
    -- P5" (zapisany SQL-em - studio tego pola nie ma) odmawialby inaczej wlasnie
    -- na P5, ktory admin nazwal. Dla wejsciowki `v_kind = 'package'` jest
    -- falszem, wiec `v_package_id` NULL nie robi z warunku NULL-a.
    IF array_length(v_coupon.ticket_type_ids, 1) IS NOT NULL
       AND NOT (v_scope_type = ANY (v_coupon.ticket_type_ids))
       AND NOT (v_kind = 'package' AND v_package_id = ANY (v_coupon.package_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_ticket_type');
    END IF;
    IF v_kind = 'package' AND array_length(v_coupon.package_ids, 1) IS NOT NULL
       AND NOT (v_package_id = ANY (v_coupon.package_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_package');
    END IF;
    -- KOD TYLKO ODSLANIAJACY nie ma kwoty. Bez tej odmowy obie kwoty NULL
    -- przechodzily przez LEAST/GREATEST (ktore pomijaja NULL) jako rabat
    -- rowny CENIE - pakiet wychodzil za zero zlotych i bez limitu.
    IF NOT v_coupon.applies_discount THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_no_discount');
    END IF;
    IF v_coupon.currency IS NOT NULL AND v_coupon.currency <> v_currency THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_currency');
    END IF;

    IF v_coupon.discount_kind = 'percent' THEN
      -- Procent od sumy to procent od kazdego miejsca - bez rozbicia.
      -- `bigint`, bo cena razy procent wychodzi poza integer przy drogich
      -- pakietach.
      v_discount := ((v_price::bigint * COALESCE(v_coupon.discount_percent, 0)) / 100)::integer;
    ELSE
      -- KOD KWOTOWY DZIALA NA MIEJSCE: min(kod, cena_pakietu / miejsca) za
      -- kazde miejsce. Liczymy to jako min(kod x miejsca, cena), bo to jest
      -- ta sama liczba bez dzielenia - a dzielenie calkowite gubiloby RESZTE:
      -- pakiet za 1000,00 zl na 3 miejsca to 333,33 zl i 1 grosz reszty, wiec
      -- kod wiekszy od ceny miejsca zostawialby do zaplaty 1 grosz zamiast
      -- zera. Gdy kod pokrywa kazde miejsce w calosci, rabat jest CALA cena
      -- (reszta tez), a na miejsce pokazujemy cene miejsca zaokraglona w dol -
      -- ta jedna etykieta moze sie roznic od rabatu o mniej niz grosz na
      -- miejsce, suma nigdy.
      v_code_cents := COALESCE(v_coupon.discount_cents, 0);
      IF v_code_cents::bigint * v_seats >= v_price THEN
        v_discount := v_price;
        v_per_seat := v_price / v_seats;
      ELSE
        v_discount := v_code_cents * v_seats;
        v_per_seat := v_code_cents;
      END IF;
    END IF;
    v_discount := GREATEST(LEAST(v_discount, v_price), 0);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', v_kind,
    'event_id', v_event_id,
    'audience', v_audience,
    'seats', v_seats,
    'currency', v_currency,
    'price_cents', v_price,
    'discount_cents', v_discount,
    'total_cents', v_price - v_discount,
    'coupon_id', v_coupon.id,
    'coupon_code', NULLIF(v_code, ''),
    -- Ekran zakupu pokazuje „Rabat (N x kwota)" - bez tych dwoch pol musialby
    -- zgadywac rodzaj kodu z proporcji kwot.
    'discount_kind', v_coupon.discount_kind,
    'discount_per_seat_cents', v_per_seat,
    'seats_left', CASE WHEN v_quota IS NULL THEN NULL ELSE v_quota - v_sold END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._b2b_coupon_evaluate(c b2b_coupons, _amount_cents integer, _currency text, p_uid uuid)
 RETURNS TABLE(ok boolean, error text, coupon_id uuid, discount_cents integer, final_cents integer, label text, discount_kind text, discount_percent integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_disc integer := 0;
  v_used integer := 0;
BEGIN
  -- ODMOWA NIE NIESIE KODU: id, nazwa, rodzaj i procent naleza wylacznie do
  -- wiersza sukcesu. Wylaczony kod to `not_found`.
  IF NOT c.active THEN
    RETURN QUERY SELECT false,'not_found'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF NOT public._b2b_coupon_window_open(c.valid_from, NULL) THEN
    RETURN QUERY SELECT false,'not_yet_valid'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF NOT public._b2b_coupon_window_open(NULL, c.valid_until) THEN
    RETURN QUERY SELECT false,'expired'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.max_redemptions IS NOT NULL AND c.redemptions_count >= c.max_redemptions THEN
    RETURN QUERY SELECT false,'limit_reached'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.max_redemptions_per_user IS NOT NULL AND p_uid IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used FROM public.b2b_coupon_redemptions r
     WHERE r.coupon_id = c.id AND r.user_id = p_uid;
    IF v_used >= c.max_redemptions_per_user THEN
      RETURN QUERY SELECT false,'per_user_limit_reached'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
    END IF;
  END IF;
  IF NOT c.applies_discount THEN
    RETURN QUERY SELECT false,'no_discount'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.discount_kind = 'percent' THEN
    v_disc := (_amount_cents * COALESCE(c.discount_percent,0)) / 100;
  ELSE
    IF c.currency IS NOT NULL AND upper(c.currency) <> upper(_currency) THEN
      RETURN QUERY SELECT false,'currency_mismatch'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
    END IF;
    v_disc := LEAST(COALESCE(c.discount_cents,0),_amount_cents);
  END IF;
  RETURN QUERY SELECT true,NULL::text,c.id,v_disc,GREATEST(_amount_cents-v_disc,0),c.name,c.discount_kind,c.discount_percent;
END $function$;

CREATE OR REPLACE FUNCTION public._redeem_b2b_coupon(p_tenant uuid, p_uid uuid, _coupon_id uuid, _order_id uuid, _applied_cents integer, _original_cents integer, _currency text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_per_user integer;
  v_used_by_user integer := 0;
BEGIN
  IF p_tenant IS NULL OR p_uid IS NULL OR _order_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.id = _order_id AND o.tenant_id = p_tenant AND o.user_id = p_uid
  ) THEN
    RETURN false;
  END IF;
  -- Limit na uzytkownika PRZED inkrementacja licznika kampanii, zeby odrzucona
  -- proba nie zjadala globalnej puli.
  SELECT max_redemptions_per_user INTO v_per_user
    FROM public.b2b_coupons
   WHERE id = _coupon_id AND tenant_id = p_tenant
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_per_user IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used_by_user
      FROM public.b2b_coupon_redemptions r
     WHERE r.coupon_id = _coupon_id AND r.user_id = p_uid;
    IF v_used_by_user >= v_per_user THEN RETURN false; END IF;
  END IF;

  UPDATE public.b2b_coupons
     SET redemptions_count = redemptions_count + 1, updated_at = now()
   WHERE id = _coupon_id AND tenant_id = p_tenant AND active
     AND (max_redemptions IS NULL OR redemptions_count < max_redemptions)
     AND public._b2b_coupon_window_open(valid_from, valid_until);
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.b2b_coupon_redemptions
    (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency)
  VALUES
    (p_tenant, _coupon_id, _order_id, p_uid, _applied_cents, _original_cents, _currency);
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.event_coupon_revealed_tickets(p_tenant uuid, p_event_id uuid, p_code text)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c public.b2b_coupons%ROWTYPE;
  v_norm text := upper(trim(coalesce(p_code,'')));
  v_ids uuid[];
BEGIN
  -- Najemca przychodzi JAWNIE od serwera (host zadania rozwiazany po stronie
  -- TS): supabaseAdmin nie niesie hosta, a public_tenant_id() bez hosta to
  -- najemca domyslny.
  IF p_tenant IS NULL OR p_event_id IS NULL OR v_norm = '' OR length(v_norm) > 64 THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  -- Kazdy powod odmowy (brak, wylaczony, nie odslania, inne wydarzenie, poza
  -- oknem, wyczerpany) to ta sama pusta lista.
  SELECT * INTO c FROM public.b2b_coupons
   WHERE tenant_id = p_tenant AND upper(code) = v_norm
     AND active AND reveals_hidden AND p_event_id = ANY(event_ids)
     AND public._b2b_coupon_window_open(valid_from, valid_until)
     AND (max_redemptions IS NULL OR redemptions_count < max_redemptions);
  IF NOT FOUND THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  SELECT coalesce(array_agg(t.id ORDER BY t.id), ARRAY[]::uuid[]) INTO v_ids
    FROM public.event_ticket_types t
   WHERE t.tenant_id = p_tenant AND t.event_id = p_event_id AND t.is_hidden
     AND (array_length(c.ticket_type_ids,1) IS NULL OR t.id = ANY(c.ticket_type_ids));
  RETURN v_ids;
END $function$;

-- ----------------------------------------------------------------------------
-- 7) PRZELICZENIE KSIEGI DLA ISTNIEJACYCH DANYCH (TIX-04)
-- ----------------------------------------------------------------------------
-- Pule biletow i liczniki pakietow liczone od nowa jedna regula. Bilet, ktory
-- po zliczeniu miejsc pakietow wychodzi PONAD swoja pule, byl juz sprzedany
-- ponad nia (miejsca pakietow wrocily do sprzedazy i zostaly sprzedane drugi
-- raz) - to stan faktyczny, nie blad przeliczenia. CHECK
-- `sold_within_quota` nie dopuszcza go zapisac, wiec pula takiego biletu rosnie
-- do liczby wydanych miejsc (sprzedaz staje), a NOTICE nazywa bilet, zeby
-- organizator zdecydowal, co z nadwyzka.
DO $$
DECLARE
  r record;
  v_n integer;
BEGIN
  FOR r IN SELECT p.id, p.tenant_id, p.quota FROM public.event_ticket_packages p LOOP
    SELECT count(*)::integer INTO v_n FROM public.event_package_orders o
    WHERE o.tenant_id = r.tenant_id AND o.package_id = r.id AND o.status IN ('pending', 'paid');
    IF r.quota IS NOT NULL AND v_n > r.quota THEN
      RAISE NOTICE 'package % (tenant %) has % live orders over quota %', r.id, r.tenant_id, v_n, r.quota;
      UPDATE public.event_ticket_packages p SET quota = v_n, sold_count = v_n
      WHERE p.id = r.id AND p.tenant_id = r.tenant_id;
    ELSE
      UPDATE public.event_ticket_packages p SET sold_count = v_n
      WHERE p.id = r.id AND p.tenant_id = r.tenant_id AND p.sold_count <> v_n;
    END IF;
  END LOOP;

  FOR r IN SELECT t.id, t.tenant_id, t.event_id, t.quota FROM public.event_ticket_types t LOOP
    SELECT count(*)::integer INTO v_n FROM public.event_registrations x
    WHERE x.tenant_id = r.tenant_id AND x.ticket_type_id = r.id
      AND x.status IN ('approved', 'attended', 'no_show');
    v_n := v_n + public._event_package_seats_held(r.tenant_id, r.event_id, r.id);
    IF r.quota IS NOT NULL AND v_n > r.quota THEN
      RAISE NOTICE 'ticket type % (tenant %) holds % seats over quota %', r.id, r.tenant_id, v_n, r.quota;
      UPDATE public.event_ticket_types t SET quota = v_n, sold_count = v_n
      WHERE t.id = r.id AND t.tenant_id = r.tenant_id;
    ELSE
      UPDATE public.event_ticket_types t SET sold_count = v_n
      WHERE t.id = r.id AND t.tenant_id = r.tenant_id AND t.sold_count <> v_n;
    END IF;
  END LOOP;
END $$;
