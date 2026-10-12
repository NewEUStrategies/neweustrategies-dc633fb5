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
  'Termin platnosci zamowienia pakietu. NULL = bez terminu (zamowienie organizatora albo sprzed 20261012130000). Przeterminowane zamowienie pending bez delegata na miejscu anuluje _event_package_orders_expire.';

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

-- migration-split: part 1/3 of 20261012130000_event_ticket_seat_ledger.sql
-- CIAG DALSZY: 20261012130001_event_ticket_seat_ledger_part2.sql .. 20261012130002_event_ticket_seat_ledger_part3.sql
-- (scripts/split-migration.ts, limit wdrozenia Lovable). SQL wykonywalny
-- czesci 1..3 sklejonych po kolei == SQL tej migracji sprzed podzialu.
-- events-harness: include
