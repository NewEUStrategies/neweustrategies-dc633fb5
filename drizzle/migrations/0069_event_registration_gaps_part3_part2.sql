-- CZESC 2/3 MIGRACJI 0067_event_registration_gaps_part3.sql
-- migration-split: part 2/3 of 0067_event_registration_gaps_part3.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 0067_event_registration_gaps_part3.sql,
-- potem 0069_event_registration_gaps_part3_part2.sql .. 0070_event_registration_gaps_part3_part3.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.

CREATE OR REPLACE FUNCTION public.admin_event_ticket_resend(
  p_registration_id uuid,
  p_include_group boolean DEFAULT true,
  p_exclude_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_group boolean := COALESCE(p_include_group, true);
  v_reg public.event_registrations;
  v_lead uuid;
  v_root uuid;
BEGIN
  -- Korzen z odczytu BEZ blokady - prowadzacy wiersza sie nie zmienia.
  SELECT r.group_lead_registration_id INTO v_lead
  FROM public.event_registrations r
  WHERE r.id = p_registration_id AND r.tenant_id = v_tenant;

  v_root := CASE
    WHEN v_group THEN COALESCE(v_lead, p_registration_id)
    ELSE p_registration_id
  END;

  PERFORM 1 FROM public.event_registrations r
  WHERE r.tenant_id = v_tenant
    AND (r.id = p_registration_id
         OR (v_group AND (r.id = v_root OR r.group_lead_registration_id = v_root)))
  ORDER BY (r.id = v_root) DESC, r.created_at, r.id
  FOR UPDATE;

  SELECT * INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = p_registration_id AND r.tenant_id = v_tenant;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  IF v_reg.status NOT IN ('approved', 'attended')
     OR v_reg.payment_status NOT IN ('paid', 'partially_refunded', 'not_required') THEN
    RAISE EXCEPTION 'ticket_not_issuable: only an approved and settled registration gets a ticket';
  END IF;

  IF v_reg.ticket_code_sent_at IS NULL
     AND v_reg.ticket_code_claimed_at > now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'ticket_send_in_progress: the ticket e-mail is being sent right now';
  END IF;

  UPDATE public.event_registrations r SET
    ticket_code_sent_at = NULL,
    ticket_code_claimed_at = NULL,
    ticket_code_undeliverable_at = NULL,
    updated_at = now()
  WHERE r.tenant_id = v_tenant
    AND (r.id = v_reg.id
         OR (v_group AND (r.id = v_root OR r.group_lead_registration_id = v_root)))
    AND r.status IN ('approved', 'attended')
    AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')
    AND (r.ticket_code_sent_at IS NOT NULL
         OR r.ticket_code_claimed_at IS NULL
         OR r.ticket_code_claimed_at <= now() - interval '15 minutes')
    AND NOT (r.id = ANY(COALESCE(p_exclude_ids, ARRAY[]::uuid[])));

  RETURN v_root;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_resend(uuid, boolean, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_resend(uuid, boolean, uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_resend(uuid, boolean, uuid[]) IS
  'Ponowna wysylka biletu: kasuje znacznik wysylki przyjetych i rozliczonych wierszy (zgloszenie albo cala jego grupa, bez p_exclude_ids - adresow z listy wykluczen) i oddaje identyfikator do wydania przez serwer. Blokuje korzen, potem grupe po created_at, id. Wiersz nieprzyjety albo nierozliczony: ticket_not_issuable; wiersz, ktorego bilet wlasnie wychodzi (zywa dzierzawa): ticket_send_in_progress - wiersze grupy w tym stanie sa pomijane. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_ticket_resend_scope(
  p_registration_id uuid,
  p_include_group boolean DEFAULT true
)
RETURNS TABLE (
  registration_id uuid,
  email text,
  tenant_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_group boolean := COALESCE(p_include_group, true);
  v_lead uuid;
  v_root uuid;
BEGIN
  SELECT r.group_lead_registration_id INTO v_lead
  FROM public.event_registrations r
  WHERE r.id = p_registration_id AND r.tenant_id = v_tenant;

  v_root := CASE
    WHEN v_group THEN COALESCE(v_lead, p_registration_id)
    ELSE p_registration_id
  END;

  RETURN QUERY
  SELECT r.id, p.email, r.tenant_id
  FROM public.event_registrations r
  JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tenant
    AND (r.id = p_registration_id
         OR (v_group AND (r.id = v_root OR r.group_lead_registration_id = v_root)))
    AND r.status IN ('approved', 'attended')
    AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')
    AND (r.ticket_code_sent_at IS NOT NULL
         OR r.ticket_code_claimed_at IS NULL
         OR r.ticket_code_claimed_at <= now() - interval '15 minutes')
  ORDER BY (r.id = v_root) DESC, r.created_at, r.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_resend_scope(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_resend_scope(uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_resend_scope(uuid, boolean) IS
  'Zakres ponownej wysylki biletu (te same wiersze, ktorym admin_event_ticket_resend skasuje znacznik) z adresem i najemca - serwer sprawdza nimi liste wykluczen przed rotacja kodow. Tylko odczyt. Bramka: assert_event_admin_tenant().';

-- ============================================================================
-- 8) BILET Z PULI PLANU IDZIE ZA ZGLOSZENIEM
-- ============================================================================
-- ----------------------------------------------------------------------------
-- a) KTORE ZGLOSZENIE TRZYMA BILET
-- ----------------------------------------------------------------------------
ALTER TABLE public.plan_ticket_claims
  ADD COLUMN IF NOT EXISTS registration_id uuid
    REFERENCES public.event_registrations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plan_ticket_claims_registration
  ON public.plan_ticket_claims (registration_id)
  WHERE registration_id IS NOT NULL;

-- Niepusty `redeemed_at` = bilet z puli JEST rozliczeniem zgloszenia (odbior
-- z planu, sekcja 9, bez zamowienia). `_event_plan_seat_settle` (c) przywraca
-- go przy ponownym przyjeciu tak samo, jak bilet oplaconej kasy; wplata reczna
-- bez zamowienia znacznika nie ma i biletu nie przywraca. Kasa, ktora zajmuje
-- albo przepina bilet (e), znacznik kasuje.
ALTER TABLE public.plan_ticket_claims
  ADD COLUMN IF NOT EXISTS redeemed_at timestamptz;

COMMENT ON COLUMN public.plan_ticket_claims.redeemed_at IS
  'Bilet z puli rozliczyl zgloszenie registration_id sam - odbior z planu (event_registration_redeem_plan_ticket), bez zamowienia. Ponowne przyjecie zgloszenia przywraca go jak bilet oplaconej kasy; kasa, ktora zajmuje albo przepina bilet, znacznik kasuje.';

COMMENT ON COLUMN public.plan_ticket_claims.registration_id IS
  'Zgloszenie etapu 4, ktorego miejsce prowadzacego pokrywa ten bilet (event_registration_claim_plan_seat). Pusta: bilet sciezki RSVP. Bilet ze zgloszeniem zwalnia cykl zgloszenia (_event_plan_seat_settle), nie czlonek.';


-- ----------------------------------------------------------------------------
-- b) CZY ZGLOSZENIE POTRZEBUJE BILETU Z PULI
-- ----------------------------------------------------------------------------
-- `p_user` - wlasciciel biletu (placacy prowadzacy). `p_except_order` -
-- zamowienie, ktore wlasnie przepadlo, a nadal stoi w processing.
CREATE OR REPLACE FUNCTION public._event_plan_seat_needed(
  p_reg public.event_registrations,
  p_user uuid,
  p_except_order uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_reg.status NOT IN ('cancelled', 'rejected')
     AND p_reg.payment_status <> 'refunded'
     AND (
       p_reg.payment_status IN ('paid', 'partially_refunded')
       OR EXISTS (
         SELECT 1 FROM public.payment_orders o
          WHERE o.user_id = p_user
            AND o.status::text IN ('pending', 'processing')
            AND o.created_at > now() - interval '25 hours'
            AND o.metadata->>'registration_id' = p_reg.id::text
            AND o.metadata->>'plan_benefit' = 'included'
            AND o.id IS DISTINCT FROM p_except_order
       )
     )
$$;
REVOKE ALL ON FUNCTION public._event_plan_seat_needed(public.event_registrations, uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_plan_seat_needed(public.event_registrations, uuid, uuid) IS
  'Czy zgloszenie potrzebuje biletu z puli planu: otwarte, nie zwrocone i oplacone albo z zywa kasa (zamowienie pending/processing z benefitem included, mlodsze niz 25 h, poza p_except_order).';

-- ----------------------------------------------------------------------------
-- c) BILET IDZIE ZA ZGLOSZENIEM
-- ----------------------------------------------------------------------------
-- 'none' (brak biletu zgloszenia albo nic do zrobienia) | 'released' |
-- 'reheld' (bilet wrocil do zgloszenia oplaconego z puli) | 'kept'.
CREATE OR REPLACE FUNCTION public._event_plan_seat_settle(
  p_registration_id uuid,
  p_lapsed_order uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_reg public.event_registrations;
  v_user uuid;
  v_n integer;
BEGIN
  -- Wlasciciel biletu (placacy prowadzacy). Klucz obcy `registration_id`
  -- gwarantuje, ze zgloszenie biletu istnieje.
  SELECT c.user_id INTO v_user
    FROM public.plan_ticket_claims c
   WHERE c.registration_id = p_registration_id
   ORDER BY c.released_at DESC NULLS FIRST
   LIMIT 1;
  IF v_user IS NULL THEN
    RETURN 'none';
  END IF;
  SELECT r.* INTO v_reg FROM public.event_registrations r WHERE r.id = p_registration_id;

  IF NOT public._event_plan_seat_needed(v_reg, v_user, p_lapsed_order) THEN
    UPDATE public.plan_ticket_claims c SET released_at = now()
     WHERE c.registration_id = v_reg.id AND c.released_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN CASE WHEN v_n > 0 THEN 'released' ELSE 'none' END;
  END IF;

  -- Zgloszenie znow potrzebuje biletu, ktory juz oddalo (ponowne przyjecie,
  -- wplata z sesji otwartej przed odwolaniem). Wraca tylko, gdy oplacilo je
  -- zamowienie liczace miejsce prowadzacego z puli - bez sprawdzania puli.
  UPDATE public.plan_ticket_claims c SET released_at = NULL
   WHERE c.registration_id = v_reg.id
     AND c.user_id = v_user
     AND c.released_at IS NOT NULL
     AND (
       -- Bilet rozliczyl zgloszenie sam (odbior z planu, sekcja 9).
       c.redeemed_at IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.payment_orders o
          WHERE o.id = v_reg.payment_order_id
            AND o.user_id = v_user
            AND o.status::text = 'paid'
            AND o.metadata->>'plan_benefit' = 'included'
       )
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN CASE WHEN v_n > 0 THEN 'reheld' ELSE 'kept' END;
END $$;
REVOKE ALL ON FUNCTION public._event_plan_seat_settle(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_plan_seat_settle(uuid, uuid) IS
  'Uzgadnia bilet z puli planu ze stanem zgloszenia (_event_plan_seat_needed): zwalnia, gdy niepotrzebny; przywraca bez sprawdzania puli, gdy zgloszenie oplacilo zamowienie z miejscem z puli albo bilet rozliczyl zgloszenie sam (redeemed_at). Zwraca none | released | reheld | kept.';

CREATE OR REPLACE FUNCTION public._tg_event_plan_seat_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public._event_plan_seat_settle(NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_plan_seat_follow() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_registrations_plan_seat_follow ON public.event_registrations;
CREATE TRIGGER event_registrations_plan_seat_follow
  AFTER UPDATE OF status, payment_status ON public.event_registrations
  FOR EACH ROW
  WHEN (NEW.group_lead_registration_id IS NULL
        AND (OLD.status IS DISTINCT FROM NEW.status
             OR OLD.payment_status IS DISTINCT FROM NEW.payment_status))
  EXECUTE FUNCTION public._tg_event_plan_seat_follow();

-- ----------------------------------------------------------------------------
-- d) PORZUCONE KASY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_plan_seat_release_lapsed(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ids uuid[];
  v_n integer;
BEGIN
  SELECT array_agg(x.id) INTO v_ids
    FROM (
      SELECT c.id
        FROM public.plan_ticket_claims c
        JOIN public.event_registrations r ON r.id = c.registration_id
       WHERE c.released_at IS NULL
         AND c.claimed_at < now() - interval '1 hour'
         AND NOT public._event_plan_seat_needed(r, c.user_id)
       ORDER BY c.claimed_at, c.id
       LIMIT GREATEST(COALESCE(p_limit, 500), 1)
       FOR UPDATE OF c SKIP LOCKED
    ) x;

  UPDATE public.plan_ticket_claims c SET released_at = now()
   WHERE c.id = ANY (v_ids) AND c.released_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_plan_seat_release_lapsed(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_plan_seat_release_lapsed(integer) TO service_role;

COMMENT ON FUNCTION public._event_plan_seat_release_lapsed(integer) IS
  'Co godzine (pg_cron event-plan-seat-release) i z community-cron (event-ticket-codes): zwalnia bilety z puli trzymane przez zgloszenia, ktore ich nie potrzebuja (_event_plan_seat_needed) - porzucona kasa, kasa przerwana przed zamowieniem. Karencja godziny od zajecia. Zwraca liczbe zwolnionych.';

-- Harmonogram w pg_cron, gdy jest. NIE jest jedynym zrodlem wywolan:
-- `community-cron` (job `event-ticket-codes`, scheduler repo co 5 minut) wola
-- ten sam przeglad (`runPlanSeatRelease`), wiec baza bez pg_cron - albo
-- z nieudanym zakladaniem zadania - nie zostawia biletow porzuconych kas
-- zajetych na zawsze. Funkcja jest idempotentna (SKIP LOCKED, karencja).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('event-plan-seat-release', '17 * * * *',
      'SELECT public._event_plan_seat_release_lapsed(500)');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - lapsed plan seats released by community-cron (event-ticket-codes)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- e) KASA ZAPISUJE ZGLOSZENIE W BILECIE
-- ----------------------------------------------------------------------------
-- Cialo z 20260926140000. Zmiany: `registration_id` przy zajeciu i przy
-- ponownym zajeciu zwolnionego wiersza; bilet zajety przez INNE zgloszenie tej
-- osoby przechodzi na biezace (poza podgladem).
CREATE OR REPLACE FUNCTION public.event_registration_claim_plan_seat(
  p_registration_id uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
  v_pool_tenant uuid;
  v_reg public.event_registrations;
  v_ticket public.event_ticket_types;
  v_face integer := 0;
  v_state jsonb;
  v_org uuid;
  v_tier text;
  v_claim_id uuid;
  v_holder uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'account_required');
  END IF;
  SELECT p.tenant_id INTO v_pool_tenant FROM public.profiles p WHERE p.id = v_uid;

  SELECT r.* INTO v_reg
  FROM public.event_registrations r
  JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.id = p_registration_id
    AND r.tenant_id = v_tenant
    AND p.user_id = v_uid
    AND r.group_lead_registration_id IS NULL
    AND r.status NOT IN ('cancelled', 'rejected')
    AND r.payment_status = 'unpaid'
  FOR UPDATE OF r;

  IF v_reg.id IS NOT NULL AND v_reg.ticket_type_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.event_ticket_types t
    WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant;
    v_face := COALESCE(public._event_ticket_price_now(
      v_ticket.price_cents, v_ticket.early_bird_price_cents,
      v_ticket.early_bird_until, v_ticket.price_schedule), 0);
  END IF;

  -- Zgloszenie cudze, goscia, zamkniete, rozliczone, bez biletu z cennika albo
  -- z biletem za darmo - nie ma czego pokrywac pula. Jeden powod, jak
  -- w kontekscie platnosci: rozroznienie byloby sonda cudzych zgloszen.
  IF v_reg.id IS NULL OR v_pool_tenant IS NULL OR v_face <= 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_eligible');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('plan_ticket_pool:' || v_pool_tenant::text || ':' || v_uid::text)
  );
  SELECT c.id, c.registration_id INTO v_claim_id, v_holder
    FROM public.plan_ticket_claims c
   WHERE c.user_id = v_uid AND c.event_id = v_reg.event_id
     AND c.released_at IS NULL
     AND c.period_start <= CURRENT_DATE
     AND c.period_end > CURRENT_DATE
   FOR UPDATE;
  IF v_claim_id IS NOT NULL THEN
    -- Bilet trzyma INNE zgloszenie tej osoby - zamkniete, bo otwarte jest
    -- jedno (`event_registrations_active_uniq`): przechodzi na biezace, zeby
    -- jego cykl (odwolanie, porzucona kasa) go oddal. Bilet sciezki RSVP
    -- (bez zgloszenia) zostaje jej. Podglad niczego nie zapisuje.
    IF v_holder IS NOT NULL AND v_holder <> v_reg.id AND NOT COALESCE(p_dry_run, false) THEN
      UPDATE public.plan_ticket_claims SET registration_id = v_reg.id, redeemed_at = NULL
       WHERE id = v_claim_id;
    END IF;
    RETURN jsonb_build_object('claimed', true, 'reused', true);
  END IF;

  v_state := public.my_ticket_allowance();
  IF COALESCE((v_state ->> 'remaining')::integer, 0) <= 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'pool_empty');
  END IF;
  v_org := NULLIF(v_state ->> 'org_id', '')::uuid;
  IF v_org IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('plan_ticket_pool_org:' || v_pool_tenant::text || ':' || v_org::text)
    );
    v_state := public.my_ticket_allowance();
    IF COALESCE((v_state ->> 'remaining')::integer, 0) <= 0 THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'pool_empty');
    END IF;
  END IF;

  -- Podglad: pula odda bilet, ale nic nie zapisujemy.
  IF COALESCE(p_dry_run, false) THEN
    RETURN jsonb_build_object('claimed', true, 'reused', false, 'dry_run', true);
  END IF;

  -- Najwyzsza warstwa czlonka - ta sama kolejnosc zrodel, co w
  -- `claim_included_event_ticket` (nadanie albo subskrypcja).
  SELECT k.tier_key INTO v_tier
    FROM (
      SELECT g.tier_key, mt.rank
        FROM public.membership_grants g
        JOIN public.membership_tiers mt
          ON mt.tenant_id = g.tenant_id AND mt.key = g.tier_key
       WHERE g.user_id = v_uid AND g.tenant_id = v_pool_tenant
         AND g.revoked_at IS NULL
         AND g.starts_at <= now()
         AND (g.expires_at IS NULL OR g.expires_at > now())
      UNION ALL
      SELECT ap.tier_key, mt.rank
        FROM public.user_subscriptions us
        JOIN public.access_plans ap ON ap.id = us.plan_id
        JOIN public.membership_tiers mt
          ON mt.tenant_id = us.tenant_id AND mt.key = ap.tier_key
       WHERE us.user_id = v_uid AND us.tenant_id = v_pool_tenant
         AND us.status::text IN ('active', 'trialing', 'past_due')
         AND ap.tier_key IS NOT NULL
    ) k
   ORDER BY k.rank DESC
   LIMIT 1;

  INSERT INTO public.plan_ticket_claims (
    tenant_id, user_id, event_id, org_id, tier_key,
    period_start, period_end, face_value_cents, currency, registration_id
  )
  VALUES (
    v_pool_tenant, v_uid, v_reg.event_id, v_org,
    COALESCE(v_tier, 'member'),
    (v_state ->> 'period_start')::date,
    (v_state ->> 'period_end')::date,
    v_face,
    COALESCE(v_ticket.currency, 'PLN'),
    v_reg.id
  )
  ON CONFLICT (user_id, event_id) DO UPDATE
    SET released_at      = NULL,
        org_id           = EXCLUDED.org_id,
        tier_key         = EXCLUDED.tier_key,
        period_start     = EXCLUDED.period_start,
        period_end       = EXCLUDED.period_end,
        face_value_cents = EXCLUDED.face_value_cents,
        currency         = EXCLUDED.currency,
        registration_id  = EXCLUDED.registration_id,
        redeemed_at      = NULL,
        claimed_at       = now();
  RETURN jsonb_build_object('claimed', true, 'reused', false);
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_claim_plan_seat(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_registration_claim_plan_seat(uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_claim_plan_seat(uuid, boolean) IS
  'Bilet z puli planu dla miejsca PROWADZACEGO w zamowieniu grupowym: tylko zgloszenie, ktorego osoba to wolajacy, bez grupy nad soba, otwarte i nieoplacone, z biletem platnym w cenniku. Ta sama regula puli co claim_included_event_ticket (blokady, okno roku, jeden bilet na wydarzenie - ponowna kasa bierze ten sam; bilet zapisuje zgloszenie - registration_id, zwalnia go jego cykl). p_dry_run: podglad kasy - ta sama odpowiedz bez zapisu. Odmowa nie rzuca: {claimed:false, reason: account_required | not_eligible | pool_empty}.';

-- ----------------------------------------------------------------------------
-- f) RECZNY ZWROT BILETU DO PULI
-- ----------------------------------------------------------------------------
-- Cialo z 20260822171037. Zmiany: czlonek (zwrot wlasnego biletu, takze
-- przez `rsvp_event`) NIE zwraca biletu, ktory trzyma zgloszenie - kasa
-- wycenila za niego miejsce prowadzacego na zero. Administrator i rola
-- serwisowa zwracaja kazdy i ODPINAJA go od zgloszenia, zeby cykl zgloszenia
-- (ponowne przyjecie) go nie przywrocil.
CREATE OR REPLACE FUNCTION public.release_included_event_ticket(p_event_id uuid, p_user uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := COALESCE(p_user, auth.uid());
  v_self boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  IF v_uid <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'tickets: forbidden';
  END IF;
  v_self := v_uid = auth.uid();

  UPDATE public.plan_ticket_claims c
     SET released_at = now(),
         registration_id = CASE WHEN v_self THEN c.registration_id END
   WHERE c.user_id = v_uid
     AND c.event_id = p_event_id
     AND c.released_at IS NULL
     AND (NOT COALESCE(v_self, false) OR c.registration_id IS NULL);

  RETURN FOUND;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_included_event_ticket(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_included_event_ticket(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.release_included_event_ticket(uuid, uuid) IS
  'Zwraca bilet do puli po rezygnacji z udzialu. Wiersz zostaje ze stemplem released_at jako slad audytowy. Bilet trzymany przez zgloszenie etapu 4 (registration_id) zwraca cykl zgloszenia - czlonek go nie zwolni; administrator albo rola serwisowa zwalnia i odpina go od zgloszenia.';

-- ----------------------------------------------------------------------------
-- f2) REGULA PRZYJECIA OPLACONEGO ZGLOSZENIA (pozycje 4 i 5)
-- ----------------------------------------------------------------------------
-- Status zgloszenia po rozliczeniu. Jedna regula dla wyniku Stripe (g)
-- i odbioru biletu z planu (sekcja 9). Wolajacy trzyma blokade wydarzenia
-- i biletu (`_event_seats_left` liczy, nie rezerwuje). Akceptacja: ta sama
-- regula, co w `event_register` (bilet `requires_approval`, przeplyw
-- `approval` bez reguly `auto_approve`, werdykt `approval` albo `reject` -
-- regula zmieniona po zapisie zostaje organizatorowi, platnosc nikogo nie
-- odrzuca). Wiersz juz w kolejce akceptacje pomija - kolejka to juz decyzja.
CREATE OR REPLACE FUNCTION public._event_registration_paid_admission(
  p_reg public.event_registrations,
  p_ticket_type_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_left integer;
  v_needs boolean;
BEGIN
  -- Przyjete, obecne, nieobecne, odwolane, odrzucone - wplata nie zmienia statusu.
  IF p_reg.status NOT IN ('draft', 'pending', 'waitlist') THEN
    RETURN p_reg.status;
  END IF;

  IF p_reg.group_lead_registration_id IS NOT NULL THEN
    -- Gosc idzie za prowadzacym: bez prowadzacego na miejscu tylko rozliczenie.
    IF NOT EXISTS (
      SELECT 1 FROM public.event_registrations l
      WHERE l.id = p_reg.group_lead_registration_id
        AND l.tenant_id = p_reg.tenant_id
        AND l.status IN ('approved', 'attended', 'no_show')
    ) THEN
      RETURN p_reg.status;
    END IF;
  ELSIF p_reg.status <> 'waitlist' THEN
    -- Wplata nie jest akceptacja. Ta sama regula, co w `event_register`.
    SELECT COALESCE(t.requires_approval, false)
        OR CASE public._event_registration_verdict(p_reg.tenant_id, p_reg.event_id, p_reg.answers)
             WHEN 'auto_approve' THEN false
             WHEN 'none' THEN e.registration_flow = 'approval'
             ELSE true
           END
      INTO v_needs
    FROM public.events e
    LEFT JOIN public.event_ticket_types t
      ON t.id = p_ticket_type_id AND t.tenant_id = e.tenant_id AND t.event_id = e.id
    WHERE e.id = p_reg.event_id AND e.tenant_id = p_reg.tenant_id;

    IF COALESCE(v_needs, false) THEN
      RETURN 'pending';
    END IF;
  END IF;

  v_left := public._event_seats_left(p_reg.tenant_id, p_reg.event_id, p_ticket_type_id);
  RETURN CASE WHEN v_left IS NULL OR v_left > 0 THEN 'approved' ELSE 'waitlist' END;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_paid_admission(public.event_registrations, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_registration_paid_admission(public.event_registrations, uuid) IS
  'Status oplaconego zgloszenia po wplacie: przyjete/obecne/nieobecne/odwolane/odrzucone bez zmian; gosc bez prowadzacego na miejscu bez zmian; zgloszenie wymagajace akceptacji (bilet requires_approval, przeplyw approval bez reguly auto_approve, regula approval albo reject) -> pending; poza tym miejsce (_event_seats_left) -> approved, brak -> waitlist. Zgloszenie juz w kolejce pomija akceptacje. Wolajacy trzyma blokade wydarzenia i biletu.';
