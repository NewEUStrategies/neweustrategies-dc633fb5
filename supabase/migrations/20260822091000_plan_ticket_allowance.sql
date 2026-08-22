-- ============================================================================
-- BILET WLICZONY W PLAN: LICZNIK, KONSUMPCJA I BRAMKA WEJŚCIA
--
-- Audyt katalogu członkostw v6.1, rozdział 2.3. Katalog sprzedaje od progu
-- Członek „1 wliczony bilet rocznie na wydarzenie biletowane" i odsyła do
-- tabeli `event_tickets` przy statusie [B?] („istniejąca funkcja, brakuje
-- reguły dostępu"). Odczyt repozytorium pokazał dwie rzeczy:
--
--   1. `event_tickets` NIE ISTNIEJE. Warstwa biletowa jest zbudowana inaczej:
--      cena mieszka w `events.ticket_price_cents` (NULL = wydarzenie
--      bezpłatne, minimum 100 groszy), zakup przechodzi przez
--      `adhocCheckout.server.ts` z celem `event_ticket`, a stan miejsc
--      i kod wejściówki obsługują `events/ticket.server.ts` i `ticketCode.ts`.
--      Rejestracja to `event_rsvps`.
--   2. Nigdzie w repozytorium nie ma pojęcia puli biletów przysługujących
--      z planu (`free_ticket`, `included_ticket`, `ticket_allowance`,
--      `ticket_credit`, `comp_ticket` - zero trafień). Pozycja katalogu nie
--      jest więc [B?], tylko [N]: funkcją do zbudowania.
--
-- DRUGIE USTALENIE, POWAŻNIEJSZE OD PIERWSZEGO. `rsvp_event` w ogóle NIE PYTA
-- o bilet. Bramkuje wyłącznie rangę / flagę `pro_briefings` i limit miejsc,
-- po czym zapisuje `going`. Wydarzenie biletowane było więc dostępne za darmo
-- każdemu, kto spełniał próg rangi i wywołał RPC bezpośrednio - przycisk
-- „kup bilet" w interfejsie był jedyną przeszkodą, a RPC jest nadane roli
-- `authenticated`. Dopóki ta dziura jest otwarta, „wliczony bilet" nie ma
-- czego sprzedawać: wszyscy mają wszystkie bilety. Ta migracja zamyka ją przy
-- okazji budowy puli - inaczej benefit byłby fikcją w dniu wdrożenia.
--
-- ── MODEL ───────────────────────────────────────────────────────────────────
--
-- Dwa klucze liczbowe w `membership_tiers.features` (obok istniejącego
-- `expert_request_quota`, ta sama konwencja: wartość, nie przełącznik):
--
--   * `included_event_tickets`     - bilety NA CZŁONKA na rok członkowski,
--   * `included_event_tickets_org` - bilety NA ORGANIZACJĘ na rok członkowski,
--   * `event_ticket_discount_pct`  - zniżka procentowa zamiast biletu.
--
-- Rozdzielenie puli osobowej i organizacyjnej jest wymuszone korektą 2.4
-- audytu. Katalog v6.1 dawał progowi Zespół „1 wliczony bilet rocznie na każde
-- miejsce": przy dwudziestu miejscach po 89 zł przychód roczny wynosi
-- 21 360 zł, a ekspozycja to dwadzieścia biletów - 6 000 zł przy bilecie za
-- 300 zł (28% przychodu progu) i 10 000 zł przy 500 zł (blisko połowy).
-- Zespół dostaje więc pulę ORGANIZACYJNĄ: trzy bilety rocznie niezależnie od
-- liczby miejsc, konsumowane w kolejności zgłoszeń.
--
-- Stawki ulgowe (student 190 zł/rok, kadra akademicka) dostają z tej samej
-- korekty zniżkę 50% zamiast biletu: bilet o cenie katalogowej 300 zł przy
-- składce 190 zł to sprzedaż poniżej kosztu krańcowego uczestnictwa, a student
-- jest jednocześnie grupą, która skorzysta z niego najchętniej.
--
-- ── ROK CZŁONKOWSKI, NIE KALENDARZOWY ───────────────────────────────────────
--
-- Audyt wymienia „obsługę przypadku, w którym członek dołącza w połowie roku"
-- jako osobny wymóg. Rok kalendarzowy wymusiłby proporcjonalność (pół roku =
-- pół biletu, czyli zero) albo prezent (pełny bilet za dwa miesiące składki).
-- Okno jest więc ROCZNICOWE: liczone od początku członkostwa, przesuwane co
-- dwanaście miesięcy. Kto dołączy 15 listopada, ma bilet do 14 listopada roku
-- następnego i kolejny od 15 listopada. Żadnej proporcjonalności, żadnego
-- prezentu, zero arytmetyki w komunikacji z członkiem.
--
-- ── ZWROT DO PULI ───────────────────────────────────────────────────────────
--
-- Rezygnacja z udziału (`going` -> `cancelled`/`interested`) zwalnia bilet:
-- `released_at` jest stemplowane, a wiersz zostaje jako ślad audytowy. Bez
-- tego jedno omyłkowe kliknięcie kasowałoby roczny benefit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Rejestr wykorzystania puli.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_ticket_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- Wypełnione, gdy bilet pochodzi z puli ORGANIZACYJNEJ (próg Zespół).
  org_id uuid REFERENCES public.member_organizations(id) ON DELETE SET NULL,
  tier_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  -- Wartość odstąpionego biletu w chwili konsumpcji - do rachunku ekspozycji.
  face_value_cents integer NOT NULL DEFAULT 0 CHECK (face_value_cents >= 0),
  currency text NOT NULL DEFAULT 'PLN',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CONSTRAINT plan_ticket_claims_period_check CHECK (period_end > period_start),
  CONSTRAINT plan_ticket_claims_user_event_uniq UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_ticket_claims_active
  ON public.plan_ticket_claims (tenant_id, user_id, period_start)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_ticket_claims_org_active
  ON public.plan_ticket_claims (tenant_id, org_id, period_start)
  WHERE released_at IS NULL AND org_id IS NOT NULL;

COMMENT ON TABLE public.plan_ticket_claims IS
  'Wykorzystanie biletów wliczonych w plan (katalog v6.1). Jeden wiersz = jeden bilet odstąpiony z puli członka albo organizacji; released_at oznacza zwrot do puli po rezygnacji z udziału.';

ALTER TABLE public.plan_ticket_claims ENABLE ROW LEVEL SECURITY;

-- Odczyt własny: członek widzi, na co wydał swój bilet. Zapis wyłącznie przez
-- RPC SECURITY DEFINER - pula nie może być nabijana bezpośrednim INSERT-em.
DROP POLICY IF EXISTS "plan ticket claims owner read" ON public.plan_ticket_claims;
CREATE POLICY "plan ticket claims owner read"
  ON public.plan_ticket_claims FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND tenant_id = (SELECT public.current_tenant_id()));

DROP POLICY IF EXISTS "plan ticket claims staff read" ON public.plan_ticket_claims;
CREATE POLICY "plan ticket claims staff read"
  ON public.plan_ticket_claims FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
    )
  );

GRANT SELECT ON public.plan_ticket_claims TO authenticated;
GRANT ALL ON public.plan_ticket_claims TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Rok członkowski wołającego (okno rocznicowe).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.membership_year_window(p_user uuid)
RETURNS TABLE (period_start date, period_end date)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_anchor timestamptz;
  v_years  integer;
BEGIN
  SELECT p.tenant_id, p.created_at INTO v_tenant, v_anchor
    FROM public.profiles p WHERE p.id = p_user;
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  -- Kotwicą jest NAJWCZEŚNIEJSZY początek CZYNNEGO uprawnienia: subskrypcji
  -- albo nadania ręcznego. Data założenia konta jest wyłącznie zapasem dla
  -- kogoś, kto uprawnienia nie ma - konto sprzed dwóch lat nie może przesuwać
  -- rocznicy świeżo opłaconego członkostwa na losowy miesiąc.
  SELECT MIN(src.started_at)
    INTO v_anchor
    FROM (
      SELECT us.started_at
        FROM public.user_subscriptions us
       WHERE us.user_id = p_user
         AND us.tenant_id = v_tenant
         AND us.status::text IN ('active', 'trialing', 'past_due')
      UNION ALL
      SELECT g.starts_at
        FROM public.membership_grants g
       WHERE g.user_id = p_user
         AND g.tenant_id = v_tenant
         AND g.revoked_at IS NULL
         AND g.starts_at <= now()
         AND (g.expires_at IS NULL OR g.expires_at > now())
    ) AS src;

  IF v_anchor IS NULL THEN
    SELECT p.created_at INTO v_anchor FROM public.profiles p WHERE p.id = p_user;
  END IF;
  v_anchor := COALESCE(v_anchor, now());
  IF v_anchor > now() THEN
    v_anchor := now();
  END IF;

  -- `age()` liczy PEŁNE lata kalendarzowe, więc rocznica nie dryfuje przy
  -- latach przestępnych - inaczej niż przy dzieleniu sekund przez rok gwiazdowy.
  v_years := GREATEST(0, EXTRACT(YEAR FROM age(now(), v_anchor))::integer);

  period_start := (v_anchor + make_interval(years => v_years))::date;
  period_end := (v_anchor + make_interval(years => v_years + 1))::date;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.membership_year_window(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.membership_year_window(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.membership_year_window(uuid) IS
  'Rok członkowski (okno rocznicowe) liczony od początku najwcześniejszego czynnego uprawnienia. Podstawa rozliczenia puli biletów wliczonych w plan - patrz 20260822091000.';

-- ----------------------------------------------------------------------------
-- 3) Stan puli biletów wołającego.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_ticket_allowance()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_tenant    uuid;
  v_personal  integer := 0;
  v_org_quota integer := 0;
  v_discount  integer := 0;
  v_org       uuid;
  v_org_tier  text;
  v_used      integer := 0;
  v_start     date;
  v_end       date;
  v_scope     text := 'personal';
  v_granted   integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('granted', 0, 'used', 0, 'remaining', 0,
                              'discount_pct', 0, 'scope', 'none',
                              'org_id', NULL, 'period_start', NULL, 'period_end', NULL);
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('granted', 0, 'used', 0, 'remaining', 0,
                              'discount_pct', 0, 'scope', 'none',
                              'org_id', NULL, 'period_start', NULL, 'period_end', NULL);
  END IF;

  SELECT w.period_start, w.period_end INTO v_start, v_end
    FROM public.membership_year_window(v_uid) w;
  IF v_start IS NULL THEN
    RETURN jsonb_build_object('granted', 0, 'used', 0, 'remaining', 0,
                              'discount_pct', 0, 'scope', 'none',
                              'org_id', NULL, 'period_start', NULL, 'period_end', NULL);
  END IF;

  -- Ta sama definicja zbioru warstw, co w my_effective_tier_features
  -- i my_expert_request_quota: nadania ręczne UNION plany czynnych subskrypcji.
  -- MAX, nie SUMA - próg Pro dziedziczy bilet po Członku i nie dostaje drugiego,
  -- dokładnie jak zapisuje katalog.
  WITH keys AS (
    SELECT g.tier_key
      FROM public.membership_grants g
     WHERE g.user_id = v_uid AND g.tenant_id = v_tenant
       AND g.revoked_at IS NULL
       AND g.starts_at <= now()
       AND (g.expires_at IS NULL OR g.expires_at > now())
    UNION
    SELECT ap.tier_key
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
     WHERE us.user_id = v_uid AND us.tenant_id = v_tenant
       AND us.status::text IN ('active', 'trialing', 'past_due')
       AND ap.tier_key IS NOT NULL
  )
  SELECT
    COALESCE(max(NULLIF(mt.features ->> 'included_event_tickets', '')::integer), 0),
    COALESCE(max(NULLIF(mt.features ->> 'event_ticket_discount_pct', '')::integer), 0)
  INTO v_personal, v_discount
  FROM keys k
  JOIN public.membership_tiers mt
    ON mt.tenant_id = v_tenant AND mt.key = k.tier_key;

  -- Pula organizacyjna: miejsce w organizacji, której próg ją przyznaje
  -- (Zespół = 3 bilety na organizację rocznie, niezależnie od liczby miejsc).
  SELECT mo.id, mo.tier_key,
         COALESCE(NULLIF(mt.features ->> 'included_event_tickets_org', '')::integer, 0)
    INTO v_org, v_org_tier, v_org_quota
    FROM public.organization_seats os
    JOIN public.member_organizations mo ON mo.id = os.org_id
    JOIN public.membership_tiers mt
      ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key
   WHERE os.user_id = v_uid
     AND os.tenant_id = v_tenant
     AND mo.status = 'active'
     AND mo.starts_at <= now()
     AND (mo.expires_at IS NULL OR mo.expires_at > now())
     AND COALESCE(NULLIF(mt.features ->> 'included_event_tickets_org', '')::integer, 0) > 0
   ORDER BY COALESCE(NULLIF(mt.features ->> 'included_event_tickets_org', '')::integer, 0) DESC
   LIMIT 1;

  IF v_org IS NOT NULL AND v_org_quota > v_personal THEN
    v_scope   := 'organisation';
    v_granted := v_org_quota;
    SELECT count(*)::integer INTO v_used
      FROM public.plan_ticket_claims c
     WHERE c.tenant_id = v_tenant
       AND c.org_id = v_org
       AND c.released_at IS NULL
       AND c.period_start <= CURRENT_DATE
       AND c.period_end > CURRENT_DATE;
  ELSE
    v_scope   := CASE WHEN v_personal > 0 THEN 'personal' ELSE 'none' END;
    v_granted := v_personal;
    v_org     := NULL;
    -- Okno wyznaczone datami wiersza, nie równością z bieżącym `period_start`:
    -- dokupienie drugiej subskrypcji przesuwa kotwicę rocznicy, a wtedy
    -- równość przestałaby widzieć bilet wykorzystany tydzień wcześniej.
    SELECT count(*)::integer INTO v_used
      FROM public.plan_ticket_claims c
     WHERE c.tenant_id = v_tenant
       AND c.user_id = v_uid
       AND c.org_id IS NULL
       AND c.released_at IS NULL
       AND c.period_start <= CURRENT_DATE
       AND c.period_end > CURRENT_DATE;
  END IF;

  RETURN jsonb_build_object(
    'granted', v_granted,
    'used', COALESCE(v_used, 0),
    'remaining', GREATEST(v_granted - COALESCE(v_used, 0), 0),
    'discount_pct', LEAST(GREATEST(v_discount, 0), 100),
    'scope', v_scope,
    'org_id', v_org,
    'period_start', v_start,
    'period_end', v_end
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_ticket_allowance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_ticket_allowance() TO authenticated, service_role;

COMMENT ON FUNCTION public.my_ticket_allowance() IS
  'Stan puli biletów wliczonych w plan dla wołającego: przyznane, wykorzystane, pozostałe, zniżka procentowa dla stawek ulgowych, zakres (osobista / organizacyjna) i okno roku członkowskiego.';

-- ----------------------------------------------------------------------------
-- 4) Konsumpcja jednego biletu z puli.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_included_event_ticket(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_tenant   uuid;
  v_state    jsonb;
  v_event    public.events%ROWTYPE;
  v_org      uuid;
  v_tier     text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_event FROM public.events e WHERE e.id = p_event_id;
  IF NOT FOUND OR COALESCE(v_event.ticket_price_cents, 0) <= 0 THEN
    RETURN false;
  END IF;

  -- Bilet już odstąpiony na to wydarzenie (np. ponowny zapis po rezygnacji)
  -- wraca do posiadacza bez ruszania licznika.
  UPDATE public.plan_ticket_claims
     SET released_at = NULL
   WHERE user_id = v_uid AND event_id = p_event_id AND released_at IS NOT NULL;
  IF FOUND THEN
    RETURN true;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.plan_ticket_claims
     WHERE user_id = v_uid AND event_id = p_event_id
  ) THEN
    RETURN true;
  END IF;

  v_state := public.my_ticket_allowance();
  IF COALESCE((v_state ->> 'remaining')::integer, 0) <= 0 THEN
    RETURN false;
  END IF;

  v_org := NULLIF(v_state ->> 'org_id', '')::uuid;

  SELECT k.tier_key INTO v_tier
    FROM (
      SELECT g.tier_key, mt.rank
        FROM public.membership_grants g
        JOIN public.membership_tiers mt
          ON mt.tenant_id = g.tenant_id AND mt.key = g.tier_key
       WHERE g.user_id = v_uid AND g.tenant_id = v_tenant
         AND g.revoked_at IS NULL
         AND g.starts_at <= now()
         AND (g.expires_at IS NULL OR g.expires_at > now())
      UNION ALL
      SELECT ap.tier_key, mt.rank
        FROM public.user_subscriptions us
        JOIN public.access_plans ap ON ap.id = us.plan_id
        JOIN public.membership_tiers mt
          ON mt.tenant_id = us.tenant_id AND mt.key = ap.tier_key
       WHERE us.user_id = v_uid AND us.tenant_id = v_tenant
         AND us.status::text IN ('active', 'trialing', 'past_due')
         AND ap.tier_key IS NOT NULL
    ) k
   ORDER BY k.rank DESC
   LIMIT 1;

  INSERT INTO public.plan_ticket_claims (
    tenant_id, user_id, event_id, org_id, tier_key,
    period_start, period_end, face_value_cents, currency
  )
  VALUES (
    v_tenant, v_uid, p_event_id, v_org,
    COALESCE(v_tier, 'member'),
    (v_state ->> 'period_start')::date,
    (v_state ->> 'period_end')::date,
    COALESCE(v_event.ticket_price_cents, 0),
    COALESCE(v_event.ticket_currency, 'PLN')
  )
  ON CONFLICT (user_id, event_id) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_included_event_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_included_event_ticket(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_included_event_ticket(uuid) IS
  'Odstępuje jeden bilet z puli wliczonej w plan na wskazane wydarzenie biletowane. Zwraca false, gdy puli brak - wołający musi wtedy kupić bilet.';

-- ----------------------------------------------------------------------------
-- 5) Zwrot biletu do puli.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_included_event_ticket(p_event_id uuid, p_user uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := COALESCE(p_user, auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  -- Cudzy bilet zwalnia wyłącznie administrator własnego tenanta.
  IF v_uid <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'tickets: forbidden';
  END IF;

  UPDATE public.plan_ticket_claims
     SET released_at = now()
   WHERE user_id = v_uid
     AND event_id = p_event_id
     AND released_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_included_event_ticket(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_included_event_ticket(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.release_included_event_ticket(uuid, uuid) IS
  'Zwraca bilet do puli po rezygnacji z udziału. Wiersz zostaje ze stemplem released_at jako ślad audytowy.';

-- ----------------------------------------------------------------------------
-- 6) Wartości puli w katalogu warstw.
--
--    MAX, nie suma: Pro dziedziczy bilet po Członku i nie dostaje drugiego.
--    Progi partnerskie mają go, bo katalog obiecuje osobom nominowanym „pełny
--    zakres Pro". Zespół - wyłącznie pula organizacyjna (korekta 2.4 audytu).
--    Stawki ulgowe - zniżka zamiast biletu (ta sama korekta).
-- ----------------------------------------------------------------------------
UPDATE public.membership_tiers
   SET features = COALESCE(features, '{}'::jsonb)
                  || jsonb_build_object('included_event_tickets', 1)
 WHERE key IN ('member', 'pro', 'vip', 'ngo', 'corporate',
               'partner', 'partner_general', 'presidents_circle')
   AND NOT (features ? 'included_event_tickets');

UPDATE public.membership_tiers
   SET features = COALESCE(features, '{}'::jsonb)
                  || jsonb_build_object('included_event_tickets_org', 3)
 WHERE key = 'team'
   AND NOT (features ? 'included_event_tickets_org');

UPDATE public.membership_tiers
   SET features = COALESCE(features, '{}'::jsonb)
                  || jsonb_build_object('event_ticket_discount_pct', 50)
 WHERE key IN ('student', 'educator')
   AND NOT (features ? 'event_ticket_discount_pct');

-- ----------------------------------------------------------------------------
-- 7) Bramka biletowa w rsvp_event.
--
--    Zmiana wobec 20260818065327 jest JEDNA i dopisana w jednym miejscu:
--    wydarzenie z ceną biletu wymaga opłaconego zamówienia ALBO biletu z puli.
--    Reszta ciała - bramka rangi, flaga pro_briefings, limit miejsc, kolejka
--    rezerwowa, promocja z listy - przeniesiona bez modyfikacji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_prev text;
  v_going integer;
  v_waitlist integer;
  v_position integer;
  v_min_rank integer;
  v_result_status text := p_status;
  v_paid boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'events: authentication required';
  END IF;
  IF p_status NOT IN ('going', 'interested', 'cancelled') THEN
    RAISE EXCEPTION 'events: invalid status';
  END IF;

  -- FOR UPDATE serializuje rownolegle RSVP - licznik miejsc i kolejka
  -- rezerwowa nie moga sie scigac.
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id
     AND tenant_id = public.public_tenant_id()
     AND status = 'published'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'events: not found';
  END IF;

  IF v_event.visibility = 'members' THEN
    IF v_event.kind = 'briefing' THEN
      IF NOT public.has_tier_feature('pro_briefings') THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    ELSE
      v_min_rank := GREATEST(COALESCE(v_event.min_tier_rank, 0), 1);
      IF NOT public.has_tier_rank(v_min_rank) THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    END IF;
  ELSIF NOT public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0)) THEN
    -- Public (i kazde przyszle visibility) z progiem rangi: ta sama galaz
    -- ELSE co w get_event_access - zapis nie moze omijac bramki odczytu.
    RAISE EXCEPTION 'events: membership required';
  END IF;

  SELECT er.status INTO v_prev
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;

  -- BRAMKA BILETOWA. Sama ranga nigdy nie wystarczała do wejścia na wydarzenie
  -- płatne - tyle że do tej migracji nikt o to nie pytał. Wejście daje albo
  -- opłacone zamówienie, albo bilet wliczony w plan.
  IF p_status = 'going'
     AND COALESCE(v_event.ticket_price_cents, 0) > 0
     AND COALESCE(v_prev, '') <> 'going' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.payment_orders po
       WHERE po.user_id = v_user
         AND po.status = 'paid'
         AND po.metadata ->> 'event_id' = p_event_id::text
    ) INTO v_paid;
    IF NOT v_paid AND NOT public.claim_included_event_ticket(p_event_id) THEN
      RAISE EXCEPTION 'events: ticket required';
    END IF;
  END IF;

  IF p_status = 'going'
     AND v_event.capacity IS NOT NULL
     AND COALESCE(v_prev, '') <> 'going' THEN
    SELECT count(*) INTO v_going
      FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going';
    IF v_going >= v_event.capacity THEN
      v_result_status := 'waitlist';
    END IF;
  END IF;

  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, waitlisted_at)
  VALUES (
    v_event.tenant_id, p_event_id, v_user, v_result_status,
    CASE WHEN v_result_status = 'waitlist' THEN clock_timestamp() END
  )
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    waitlisted_at = CASE
      WHEN EXCLUDED.status = 'waitlist'
        THEN COALESCE(event_rsvps.waitlisted_at, clock_timestamp())
      ELSE NULL
    END,
    updated_at = now();

  IF v_prev = 'going' AND v_result_status <> 'going' THEN
    PERFORM public.promote_event_waitlist(p_event_id);
  END IF;

  -- Rezygnacja zwalnia bilet z puli. Trafienie na listę rezerwową też - miejsce
  -- nie zostało przyznane, więc benefit nie może zostać spalony.
  IF v_result_status <> 'going' THEN
    PERFORM public.release_included_event_ticket(p_event_id, v_user);
  END IF;

  SELECT count(*) FILTER (WHERE er.status = 'going'),
         count(*) FILTER (WHERE er.status = 'waitlist')
    INTO v_going, v_waitlist
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id;

  IF v_result_status = 'waitlist' THEN
    SELECT count(*) INTO v_position
      FROM public.event_rsvps er
     WHERE er.event_id = p_event_id
       AND er.status = 'waitlist'
       AND er.waitlisted_at <= (
         SELECT mine.waitlisted_at
           FROM public.event_rsvps mine
          WHERE mine.event_id = p_event_id AND mine.user_id = v_user
       );
  END IF;

  RETURN jsonb_build_object(
    'status', v_result_status,
    'going', v_going,
    'waitlist', v_waitlist,
    'waitlist_position', v_position
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;
