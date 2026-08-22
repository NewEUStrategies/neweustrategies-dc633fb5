-- 20260822090000_orphan_tier_rank_28_remap.sql
UPDATE public.clubs SET min_tier_rank = 30, updated_at = now() WHERE min_tier_rank = 28;
UPDATE public.events SET min_tier_rank = 30 WHERE min_tier_rank = 28;
UPDATE public.content_access SET min_tier_rank = 30 WHERE min_tier_rank = 28;
UPDATE public.member_resources SET min_tier_rank = 30 WHERE min_tier_rank = 28;
COMMENT ON COLUMN public.clubs.min_tier_rank IS
  'Próg rangi planu otwierający klub. Wartości dopuszczalne = rangi z katalogu (0, 10, 20, 25, 30, 40, 50, 60). Ranga 28 (wycofany próg Partner Biznesowy) została przemapowana na 30 migracją 20260822090000 - nie wprowadzać jej ponownie.';

-- 20260822091000_plan_ticket_allowance.sql
CREATE TABLE IF NOT EXISTS public.plan_ticket_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.member_organizations(id) ON DELETE SET NULL,
  tier_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
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
    ON mt.tenant_id = v_tenant AND mt.key = k.tier_key AND mt.active;
  SELECT mo.id,
         COALESCE(NULLIF(mt.features ->> 'included_event_tickets_org', '')::integer, 0)
    INTO v_org, v_org_quota
    FROM public.organization_seats os
    JOIN public.member_organizations mo ON mo.id = os.org_id
    JOIN public.membership_tiers mt
      ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key AND mt.active
   WHERE os.user_id = v_uid
     AND mo.tenant_id = v_tenant
     AND (os.status = 'active'
          OR (os.status = 'grace' AND (os.grace_until IS NULL OR os.grace_until > now())))
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
  PERFORM pg_advisory_xact_lock(
    hashtext('plan_ticket_pool:' || v_tenant::text || ':' || v_uid::text)
  );
  IF EXISTS (
    SELECT 1 FROM public.plan_ticket_claims c
     WHERE c.user_id = v_uid AND c.event_id = p_event_id
       AND c.released_at IS NULL
       AND c.period_start <= CURRENT_DATE
       AND c.period_end > CURRENT_DATE
  ) THEN
    RETURN true;
  END IF;
  v_state := public.my_ticket_allowance();
  IF COALESCE((v_state ->> 'remaining')::integer, 0) <= 0 THEN
    RETURN false;
  END IF;
  v_org := NULLIF(v_state ->> 'org_id', '')::uuid;
  IF v_org IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('plan_ticket_pool_org:' || v_tenant::text || ':' || v_org::text)
    );
    v_state := public.my_ticket_allowance();
    IF COALESCE((v_state ->> 'remaining')::integer, 0) <= 0 THEN
      RETURN false;
    END IF;
  END IF;
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
  ON CONFLICT (user_id, event_id) DO UPDATE
    SET released_at   = NULL,
        org_id        = EXCLUDED.org_id,
        tier_key      = EXCLUDED.tier_key,
        period_start  = EXCLUDED.period_start,
        period_end    = EXCLUDED.period_end,
        face_value_cents = EXCLUDED.face_value_cents,
        currency      = EXCLUDED.currency,
        claimed_at    = now();
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_included_event_ticket(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_included_event_ticket(uuid) TO service_role;
COMMENT ON FUNCTION public.claim_included_event_ticket(uuid) IS
  'Odstępuje jeden bilet z puli wliczonej w plan na wskazane wydarzenie biletowane. Zwraca false, gdy puli brak - wołający musi wtedy kupić bilet.';

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

-- 20260822092000_chatham_house_tier_benefit.sql
UPDATE public.membership_tiers
   SET features = COALESCE(features, '{}'::jsonb)
                  || jsonb_build_object('chatham_house_events', true)
 WHERE key IN ('pro', 'vip', 'team', 'ngo', 'corporate',
               'partner', 'partner_general', 'presidents_circle')
   AND NOT (features ? 'chatham_house_events');

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
    RAISE EXCEPTION 'events: membership required';
  END IF;
  IF v_event.chatham_house AND NOT public.has_tier_feature('chatham_house_events') THEN
    RAISE EXCEPTION 'events: chatham house membership required';
  END IF;
  IF p_status <> 'cancelled'
     AND v_event.rsvp_opens_at IS NOT NULL
     AND now() < v_event.rsvp_opens_at THEN
    IF v_event.early_rsvp_rank IS NULL
       OR NOT public.has_tier_rank(v_event.early_rsvp_rank) THEN
      RAISE EXCEPTION 'events: rsvp not open';
    END IF;
  END IF;
  SELECT er.status INTO v_prev
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;
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
  IF p_status <> 'going' THEN
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

CREATE OR REPLACE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS TABLE (
  can_join boolean,
  join_url text,
  can_watch boolean,
  recording_url text,
  reason text,
  watch_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_staff boolean := false;
  v_allowed boolean;
  v_can_watch boolean;
  v_rsvp text;
BEGIN
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_event.status <> 'published' THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'not_found', 'not_found';
    RETURN;
  END IF;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'auth_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'auth_required' END;
    RETURN;
  END IF;
  v_staff := v_event.tenant_id = public.current_tenant_id()
         AND (public.has_role(v_user, 'admin'::app_role)
              OR public.has_role(v_user, 'editor'::app_role));
  SELECT er.status INTO v_rsvp
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;
  IF v_staff THEN
    v_allowed := true;
  ELSIF v_event.visibility = 'members' AND v_event.kind = 'briefing' THEN
    v_allowed := public.has_tier_feature('pro_briefings');
  ELSIF v_event.visibility = 'members' THEN
    v_allowed := public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1));
  ELSE
    v_allowed := public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0));
  END IF;
  IF v_allowed AND NOT v_staff AND v_event.chatham_house THEN
    v_allowed := public.has_tier_feature('chatham_house_events');
  END IF;
  IF NOT v_allowed THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'tier_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'tier_required' END;
    RETURN;
  END IF;
  v_can_watch := v_event.recording_url IS NOT NULL
             AND (v_staff OR public.has_tier_feature('recordings'));
  RETURN QUERY SELECT
    (v_staff OR v_rsvp = 'going') AND v_event.join_url IS NOT NULL,
    CASE WHEN (v_staff OR v_rsvp = 'going') THEN v_event.join_url END,
    v_can_watch,
    CASE WHEN v_can_watch THEN v_event.recording_url END,
    CASE
      WHEN v_rsvp = 'going' OR v_staff THEN 'ok'
      WHEN v_rsvp = 'waitlist' THEN 'waitlisted'
      ELSE 'rsvp_required'
    END,
    CASE
      WHEN v_event.recording_url IS NULL THEN 'none'
      WHEN v_can_watch THEN 'ok'
      ELSE 'tier_required'
    END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_event_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_access(uuid) TO anon, authenticated, service_role;
COMMENT ON COLUMN public.events.chatham_house IS
  'Spotkanie prowadzone w regule Chatham House. Od 20260822092000 jest to BRAMKA, nie etykieta: wejście i nagranie wymagają flagi features chatham_house_events (próg Pro i wyżej).';

-- 20260822093000_early_access_publish_at_gate.sql
CREATE OR REPLACE FUNCTION public.early_access_window()
RETURNS interval
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT interval '72 hours';
$$;
REVOKE EXECUTE ON FUNCTION public.early_access_window() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.early_access_window() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.early_access_window() IS
  'Długość okna wczesnego dostępu do wpisów zaplanowanych (katalog v6.1: 72 godziny przed publikacją otwartą). Jedno źródło liczby dla polityki RLS i dla komunikacji w katalogu.';
UPDATE public.membership_tiers
   SET features = COALESCE(features, '{}'::jsonb)
                  || jsonb_build_object('early_access', true)
 WHERE key IN ('pro', 'vip', 'team', 'ngo', 'corporate',
               'partner', 'partner_general', 'presidents_circle')
   AND NOT COALESCE((features ->> 'early_access')::boolean, false);
UPDATE public.membership_tiers
   SET features = features - 'early_access'
 WHERE key IN ('reader', 'supporter', 'member', 'student', 'educator')
   AND features ? 'early_access';
DROP POLICY IF EXISTS "Early access reads scheduled posts" ON public.posts;
CREATE POLICY "Early access reads scheduled posts"
  ON public.posts
  FOR SELECT
  TO authenticated
  USING (
    status = 'scheduled'::post_status
    AND deleted_at IS NULL
    AND tenant_id = public.public_tenant_id()
    AND publish_at IS NOT NULL
    AND publish_at > now()
    AND publish_at <= now() + (SELECT public.early_access_window())
    AND (SELECT public.has_tier_feature('early_access'))
  );
COMMENT ON COLUMN public.posts.publish_at IS
  'Termin publikacji wpisu zaplanowanego (UTC). Od 20260822093000 jest też punktem zaczepienia wczesnego dostępu: konto z flagą features early_access czyta wpis w oknie early_access_window() przed tym terminem. Nie mylić z published_at, który oznacza FAKT publikacji.';

-- 20260822094000_catalog_v61_products_and_verification.sql
ALTER TABLE public.access_plans
  ADD COLUMN IF NOT EXISTS volume_threshold_seats integer;
ALTER TABLE public.access_plans
  ADD COLUMN IF NOT EXISTS volume_price_cents integer;
DO $$
BEGIN
  ALTER TABLE public.access_plans
    ADD CONSTRAINT access_plans_volume_tier_check
    CHECK (
      (volume_threshold_seats IS NULL AND volume_price_cents IS NULL)
      OR (volume_threshold_seats >= 2 AND volume_price_cents >= 0
          AND volume_price_cents <= price_cents)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON COLUMN public.access_plans.volume_threshold_seats IS
  'Liczba miejsc, od której obowiązuje cena wolumenowa (katalog v6.1: Zespół od 11 miejsc). NULL = plan bez progu wolumenowego.';
COMMENT ON COLUMN public.access_plans.volume_price_cents IS
  'Cena za miejsce po osiągnięciu progu wolumenowego. Cena obejmuje WSZYSTKIE miejsca w zamówieniu (tiers_mode volume u operatora), nie tylko nadwyżkę ponad próg.';
UPDATE public.access_plans
   SET volume_threshold_seats = 11,
       volume_price_cents = 7900
 WHERE tier_key = 'team'
   AND interval = 'month'::public.plan_interval
   AND volume_threshold_seats IS NULL;
INSERT INTO public.membership_tiers
  (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
   benefits, features, is_default, active, sort_order, audience_key, cta_mode)
SELECT t.id, 'decision_lab', 0,
       'Decision Lab', 'Decision Lab',
       'Wpis techniczny mostka plan -> warstwa dla produktu jednorazowego. Nie jest progiem członkostwa i nie nadaje żadnych uprawnień.',
       'Technical bridge row between the plan and the tier ladder for a one-off product. Not a membership tier; grants nothing.',
       '[]'::jsonb, '{}'::jsonb, false, false, 900, NULL, 'none'
  FROM public.tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.membership_tiers mt
    WHERE mt.tenant_id = t.id AND mt.key = 'decision_lab'
 );
INSERT INTO public.access_plans
  (tenant_id, name_pl, name_en, description_pl, description_en,
   price_cents, currency, interval, active, sort_order, tier_key)
SELECT t.id,
       'Decision Lab - miejsce w cyklu',
       'Decision Lab - seat in the cycle',
       'Miejsce dla podmiotu spoza partnerstwa w jednym cyklu Decision Lab: seria spotkań zakończona raportem z uzgodnionymi rekomendacjami. Partnerzy instytucjonalni mają miejsca wliczone w składkę.',
       'A seat for a non-partner organisation in one Decision Lab cycle: a series of meetings closing with a report of agreed recommendations. Institutional partners have seats included in their contribution.',
       1600000, 'PLN', 'one_time'::public.plan_interval, true, 200, 'decision_lab'
  FROM public.tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.access_plans ap
    WHERE ap.tenant_id = t.id AND ap.tier_key = 'decision_lab'
 );
ALTER TABLE public.verification_domains
  ADD COLUMN IF NOT EXISTS academic boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.verification_domains.academic IS
  'Domena uczelni / instytucji naukowej. Adres w tej domenie zwalnia z ręcznej weryfikacji stawki studenckiej i akademickiej (katalog v6.1: automat tam, gdzie domena jest na liście, ręcznie wyłącznie jako wyjątek).';

CREATE OR REPLACE FUNCTION public.my_academic_domain_verification()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_tenant    uuid;
  v_email     text;
  v_domain    text;
  v_confirmed boolean := false;
  v_match     boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('automatic', false, 'domain', NULL,
                              'email_confirmed', false, 'reason', 'auth_required');
  END IF;
  SELECT p.tenant_id, p.email INTO v_tenant, v_email
    FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL OR v_email IS NULL THEN
    RETURN jsonb_build_object('automatic', false, 'domain', NULL,
                              'email_confirmed', false, 'reason', 'no_email');
  END IF;
  v_domain := lower(split_part(v_email, '@', 2));
  SELECT (u.email_confirmed_at IS NOT NULL) INTO v_confirmed
    FROM auth.users u WHERE u.id = v_uid;
  v_confirmed := COALESCE(v_confirmed, false);
  SELECT EXISTS (
    SELECT 1 FROM public.verification_domains vd
     WHERE vd.tenant_id = v_tenant
       AND vd.active
       AND vd.academic
       AND vd.domain = v_domain
       AND (v_confirmed OR NOT vd.require_email_confirmed)
  ) INTO v_match;
  RETURN jsonb_build_object(
    'automatic', v_match,
    'domain', v_domain,
    'email_confirmed', v_confirmed,
    'reason', CASE
      WHEN v_match THEN 'domain_listed'
      WHEN NOT v_confirmed THEN 'email_not_confirmed'
      ELSE 'domain_not_listed'
    END
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.my_academic_domain_verification() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_academic_domain_verification() TO authenticated, service_role;
COMMENT ON FUNCTION public.my_academic_domain_verification() IS
  'Czy wołający kwalifikuje się do AUTOMATYCZNEJ weryfikacji stawki studenckiej / akademickiej na podstawie domeny e-mail z listy verification_domains (academic = true). Ręczna weryfikacja legitymacją zostaje wyjątkiem dla domen spoza listy.';

DROP FUNCTION IF EXISTS public.admin_upsert_verification_domain(
  text, text, text, boolean, boolean, text
);
DROP FUNCTION IF EXISTS public.admin_upsert_verification_domain(
  text, text, text, boolean, boolean
);
CREATE OR REPLACE FUNCTION public.admin_upsert_verification_domain(
  p_domain text,
  p_badge text DEFAULT 'verified',
  p_note text DEFAULT NULL,
  p_active boolean DEFAULT true,
  p_require_email_confirmed boolean DEFAULT true,
  p_grants_tier_key text DEFAULT NULL,
  p_academic boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.admin_assert_verification_admin();
  v_domain text := lower(btrim(COALESCE(p_domain, '')));
  v_tier text := NULLIF(btrim(COALESCE(p_grants_tier_key, '')), '');
  v_id uuid;
BEGIN
  IF v_domain = '' OR v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'verification: invalid domain' USING ERRCODE = '22023';
  END IF;
  IF p_badge NOT IN ('verified', 'expert', 'staff', 'contributor') THEN
    RAISE EXCEPTION 'verification: unsupported badge' USING ERRCODE = '22023';
  END IF;
  IF v_tier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.membership_tiers mt
     WHERE mt.tenant_id = v_tenant AND mt.key = v_tier AND mt.active
  ) THEN
    RAISE EXCEPTION 'verification: unknown membership tier' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.verification_domains
    (tenant_id, domain, badge, note, active, require_email_confirmed,
     grants_tier_key, academic, created_by)
  VALUES (v_tenant, v_domain, p_badge, NULLIF(btrim(COALESCE(p_note, '')), ''),
          p_active, p_require_email_confirmed, v_tier,
          COALESCE(p_academic, false), auth.uid())
  ON CONFLICT (tenant_id, domain, badge) DO UPDATE
    SET note = EXCLUDED.note,
        active = EXCLUDED.active,
        require_email_confirmed = EXCLUDED.require_email_confirmed,
        grants_tier_key = EXCLUDED.grants_tier_key,
        academic = EXCLUDED.academic,
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_verification_domain(
  text, text, text, boolean, boolean, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_verification_domain(
  text, text, text, boolean, boolean, text, boolean
) TO authenticated, service_role;

-- 20260822095000_catalog_v61_benefits_copy.sql
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Pełne archiwum analiz i policy papers, bez limitów","en":"The full archive of analyses and policy papers, no limits",
         "group_pl":"Wszystko z progu Czytelnik, oraz:","group_en":"All of Reader, plus:"},
        {"pl":"Wszystkie briefingi członkowskie online w roku, wraz z nagraniami","en":"Every online member briefing in the year, with recordings"},
        {"pl":"1 wliczony bilet rocznie na wydarzenie biletowane, w tym „Geopolityczna Gra Mocarstw”","en":"1 included ticket a year for a ticketed event, including „Geopolityczna Gra Mocarstw”"},
        {"pl":"Pogłębiony digest członkowski: 44 wydania rocznie","en":"The in-depth member digest: 44 issues a year"},
        {"pl":"1 zapytanie do eksperta miesięcznie","en":"1 expert request a month"},
        {"pl":"Czat i wiadomości z innymi członkami","en":"Chat and messages with other members"},
        {"pl":"Narzędzia cytowania: Chicago, APA, BibTeX","en":"Citation tools: Chicago, APA, BibTeX"},
        {"pl":"Rezygnacja w każdej chwili, bez okresu wypowiedzenia","en":"Cancel at any time, with no notice period"}]'::jsonb
 WHERE key = 'member'
   AND benefits::text NOT LIKE '%wliczony bilet%';
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Pełne członkostwo w jednym klubie dyskusyjnym do wyboru","en":"Full membership of one discussion club of your choice",
         "group_pl":"Wszystko z progu Członek - wraz z tym samym jednym biletem rocznie, nie drugim - oraz:","group_en":"All of Member - including the same single yearly ticket, not a second one - plus:"},
        {"pl":"Monitoring regulacyjny: tracker legislacyjny UE z alertami","en":"Regulatory monitoring: the EU legislative tracker with alerts"},
        {"pl":"4 zamknięte briefingi Pro rocznie: marzec, czerwiec, wrzesień, grudzień","en":"4 closed-door Pro briefings a year: March, June, September, December"},
        {"pl":"Spotkania prowadzone w regule Chatham House","en":"Meetings held under the Chatham House Rule"},
        {"pl":"4 noty foresightowe rocznie, w ostatnim tygodniu kwartału","en":"4 foresight notes a year, in the last week of each quarter"},
        {"pl":"Wczesny dostęp do raportów: 72 godziny przed publikacją otwartą","en":"Early access to reports: 72 hours before open publication"},
        {"pl":"3 zapytania do eksperta miesięcznie","en":"3 expert requests a month"},
        {"pl":"Priorytet pytań w sesjach Q&A z ekspertami","en":"Priority questions in expert Q&A sessions"},
        {"pl":"Linki podarunkowe: 3 pełne analizy miesięcznie dla osób spoza platformy","en":"Gift links: 3 full analyses a month for people outside the platform"}]'::jsonb
 WHERE key = 'pro'
   AND benefits::text NOT LIKE '%Chatham House%';
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Pełny zakres progu Członek, bez limitów, na komputerze i telefonie","en":"The full Member scope, no limits, on desktop and mobile"},
        {"pl":"Wszystkie briefingi członkowskie online wraz z nagraniami","en":"All online member briefings, with recordings"},
        {"pl":"Zniżka 50% na wydarzenia biletowane, zamiast biletu wliczonego","en":"50% off ticketed events, in place of an included ticket"},
        {"pl":"Cotygodniowy przegląd i pogłębiony digest członkowski","en":"The weekly review and the in-depth member digest"},
        {"pl":"Dostęp do materiałów edukacyjnych New European Strategies, w tym EuroChallenge","en":"Access to New European Strategies educational materials, including EuroChallenge"},
        {"pl":"Weryfikacja automatyczna adresem w domenie uczelni; legitymacja wyłącznie dla domen spoza listy","en":"Automatic verification with a university-domain address; a student ID only for domains outside the list"}]'::jsonb
 WHERE key = 'student'
   AND benefits::text NOT LIKE '%Zniżka 50%';
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Materiały dydaktyczne: kluczowe wnioski i słowniczek pojęć przy analizach","en":"Teaching materials: key takeaways and a glossary alongside analyses",
         "group_pl":"Wszystko ze stawki studenckiej, oraz:","group_en":"All of the Student rate, plus:"},
        {"pl":"Licencja do wykorzystania treści na zajęciach","en":"A licence to use content in class"},
        {"pl":"Prawo cytowania analiz w publikacjach naukowych","en":"The right to cite analyses in academic publications"},
        {"pl":"Zniżka 50% na wydarzenia biletowane, zamiast biletu wliczonego","en":"50% off ticketed events, in place of an included ticket"},
        {"pl":"Priorytetowe zaproszenia na seminaria akademickie New European Strategies","en":"Priority invitations to New European Strategies academic seminars"},
        {"pl":"Weryfikacja automatyczna adresem w domenie uczelni; dokument afiliacyjny wyłącznie dla domen spoza listy","en":"Automatic verification with a university-domain address; an affiliation document only for domains outside the list"}]'::jsonb
 WHERE key = 'educator'
   AND benefits::text NOT LIKE '%Zniżka 50%';
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Pełny zakres progu Członek Pro dla każdego miejsca","en":"The full Member Pro scope for every seat"},
        {"pl":"Wejścia rangi 25: kluby i treści otwarte dla Rady Instytutu","en":"Rank 25 entries: clubs and content open to the Institute Council"},
        {"pl":"3 wliczone bilety rocznie na organizację, niezależnie od liczby miejsc","en":"3 included tickets a year per organisation, regardless of seat count"},
        {"pl":"Onboarding zespołowy: przypisanie wszystkich miejsc do klubów w 7 dni od zakupu","en":"Team onboarding: every seat assigned to a club within 7 days of purchase"},
        {"pl":"Panel miejsc: zapraszanie, odbieranie i przenoszenie między osobami","en":"A seat panel: invite, revoke and reassign between people"},
        {"pl":"Wspólna biblioteka i archiwum organizacji","en":"A shared library and organisation archive"},
        {"pl":"Jedna zbiorcza faktura dla całego zespołu","en":"One consolidated invoice for the whole team"},
        {"pl":"Rabat wolumenowy od 11 miejsc: 79 zł za miejsce","en":"Volume discount from 11 seats: 79 zł per seat"}]'::jsonb
 WHERE key = 'team'
   AND benefits::text NOT LIKE '%3 wliczone bilety%';
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Do 10 osób nominowanych z pełnym zakresem Pro","en":"Up to 10 nominated people with the full Pro scope",
         "group_pl":"Wszystko z progu Członek Pro dla osób nominowanych, oraz:","group_en":"All of Member Pro for nominated people, plus:"},
        {"pl":"1 Decision Lab rocznie z dwoma miejscami dla osób nominowanych","en":"1 Decision Lab a year with two seats for nominated people"},
        {"pl":"Sounding board: rekomendacje do komentarza 10 dni roboczych przed publikacją","en":"Sounding board: recommendations for comment 10 working days before publication"},
        {"pl":"4 briefingi zamknięte dla organizacji w roku","en":"4 closed-door briefings for the organisation a year"},
        {"pl":"8 godzin konsultacji analitycznych rocznie, jednostka 30 minut","en":"8 hours of analytical consultation a year, in 30-minute units"},
        {"pl":"Wszystkie kluby dyskusyjne dla osób nominowanych","en":"All discussion clubs for nominated people"}]'::jsonb
 WHERE key = 'partner'
   AND benefits::text LIKE '%Wyróżnienie jako partner%';
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Do 25 osób nominowanych, bez dopłaty za miejsce","en":"Up to 25 nominated people, with no per-seat charge",
         "group_pl":"Wszystko z progu Partner Instytucjonalny, oraz:","group_en":"All of Institutional Partner, plus:"},
        {"pl":"1 własna grupa zadaniowa rocznie: cykl 4 spotkań zakończony raportem sygnowanym wspólnie","en":"1 own task force a year: a cycle of 4 meetings closing with a co-signed report"},
        {"pl":"2 dedykowane briefingi szyte na miarę w roku","en":"2 dedicated, tailor-made briefings a year"},
        {"pl":"20 godzin dostępu do analityka rocznie","en":"20 hours of analyst access a year"},
        {"pl":"Prywatny mikroserwis klubowy dla organizacji","en":"A private club micro-site for the organisation"},
        {"pl":"1 slot prelegencki na konferencji New European Strategies w roku","en":"1 speaking slot at the New European Strategies conference each year"},
        {"pl":"2 kolacje eksperckie na poziomie zarządu w roku","en":"2 board-level expert dinners a year"}]'::jsonb
 WHERE key = 'partner_general'
   AND benefits::text NOT LIKE '%mikroserwis klubowy%';

-- 20260822096000_club_events_tier_gate.sql
ALTER TABLE public.club_events
  ADD COLUMN IF NOT EXISTS min_tier_rank integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  ALTER TABLE public.club_events
    ADD CONSTRAINT club_events_min_tier_rank_check CHECK (min_tier_rank >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON COLUMN public.club_events.min_tier_rank IS
  'Próg rangi planu dla POJEDYNCZEGO terminu w kalendarzu klubu (0 = bez progu). Dokładany na wierzchu bramki klubu, nigdy zamiast niej. Katalog v6.1: Decision Lab jako obserwator od rangi 25.';
DROP FUNCTION IF EXISTS public.club_events_list(uuid, timestamptz, timestamptz, text, integer);
CREATE FUNCTION public.club_events_list(
  p_club_id uuid,
  p_from    timestamptz DEFAULT NULL,
  p_to      timestamptz DEFAULT NULL,
  p_kind    text        DEFAULT NULL,
  p_limit   integer     DEFAULT 200
)
RETURNS TABLE (
  id uuid, club_id uuid, group_id uuid, thread_id uuid, anchor_event_id uuid,
  slug text, title_pl text, title_en text, description_pl text, description_en text,
  kind text, starts_at timestamptz, ends_at timestamptz, all_day boolean,
  location text, meeting_url text, status text,
  rsvp_enabled boolean, capacity integer, going_count integer,
  min_tier_rank integer,
  my_rsvp text, thread_slug text, group_name_pl text, group_name_en text,
  created_at timestamptz, can_manage boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id, e.club_id, e.group_id, e.thread_id, e.anchor_event_id,
    e.slug, e.title_pl, e.title_en, e.description_pl, e.description_en,
    e.kind, e.starts_at, e.ends_at, e.all_day,
    e.location,
    CASE WHEN cap.can_reply OR cap.can_moderate THEN e.meeting_url ELSE NULL END,
    e.status,
    e.rsvp_enabled, e.capacity, e.going_count,
    e.min_tier_rank,
    r.state,
    t.slug, g.name_pl, g.name_en,
    e.created_at, cap.can_moderate
  FROM public.club_events e
  CROSS JOIN LATERAL public.club_capabilities(e.club_id, NULL, auth.uid()) cap
  LEFT JOIN public.club_threads t ON t.id = e.thread_id
  LEFT JOIN public.club_groups  g ON g.id = e.group_id
  LEFT JOIN public.club_event_rsvps r ON r.event_id = e.id AND r.user_id = auth.uid()
  WHERE e.club_id = p_club_id
    AND cap.can_read
    AND (
      COALESCE(e.min_tier_rank, 0) = 0
      OR cap.can_moderate
      OR (SELECT public.current_tier_rank()) >= e.min_tier_rank
    )
    AND (p_from IS NULL OR COALESCE(e.ends_at, e.starts_at) >= p_from)
    AND (p_to   IS NULL OR e.starts_at <= p_to)
    AND (p_kind IS NULL OR e.kind = p_kind)
  ORDER BY e.starts_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
$$;
COMMENT ON FUNCTION public.club_events_list(uuid, timestamptz, timestamptz, text, integer) IS
  'Kalendarz klubu w zakresie dat. Zakres domyka sie po ends_at, wiec wydarzenie trwajace przez granice okna nie znika. meeting_url wychodzi tylko uczestnikom. Termin z wlasnym min_tier_rank widzi kurator i ranga >= progu.';
REVOKE EXECUTE ON FUNCTION public.club_events_list(uuid, timestamptz, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_events_list(uuid, timestamptz, timestamptz, text, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_event_rsvp(
  p_event_id uuid,
  p_state    text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_club     uuid;
  v_tenant   uuid;
  v_enabled  boolean;
  v_capacity integer;
  v_going    integer;
  v_prev     text;
  v_member   boolean;
  v_min_rank integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('going', 'maybe', 'declined') THEN
    RAISE EXCEPTION 'clubs: invalid rsvp state %', p_state USING ERRCODE = '22023';
  END IF;
  SELECT e.club_id, e.tenant_id, e.rsvp_enabled, e.capacity, e.going_count,
         COALESCE(e.min_tier_rank, 0)
    INTO v_club, v_tenant, v_enabled, v_capacity, v_going, v_min_rank
    FROM public.club_events e WHERE e.id = p_event_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'clubs: rsvp disabled' USING ERRCODE = '22023';
  END IF;
  IF v_min_rank > 0
     AND p_state <> 'declined'
     AND NOT public.has_tier_rank(v_min_rank) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.club_members m
     WHERE m.club_id = v_club AND m.user_id = v_uid AND m.status = 'active'
  ) INTO v_member;
  IF NOT v_member THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT r.state INTO v_prev
    FROM public.club_event_rsvps r
   WHERE r.event_id = p_event_id AND r.user_id = v_uid;
  IF p_state = 'going'
     AND v_capacity IS NOT NULL
     AND COALESCE(v_prev, '') <> 'going'
     AND v_going >= v_capacity THEN
    RAISE EXCEPTION 'clubs: event is full' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.club_event_rsvps (event_id, user_id, tenant_id, state)
  VALUES (p_event_id, v_uid, v_tenant, p_state)
  ON CONFLICT (event_id, user_id) DO UPDATE SET state = EXCLUDED.state;
  RETURN true;
END;
$$;
COMMENT ON FUNCTION public.club_event_rsvp(uuid, text) IS
  'Deklaracja obecnosci. Wymaga AKTYWNEGO czlonkostwa, nie samego can_read - deklaracja osoby spoza klubu jest szumem dla prowadzacego, ktory na jej podstawie rezerwuje sale. Termin z wlasnym min_tier_rank wymaga dodatkowo tej rangi (poza zejsciem z listy).';
REVOKE EXECUTE ON FUNCTION public.club_event_rsvp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_event_rsvp(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_event_upsert(
  p_club_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.club_require_curator(p_club_id);
  v_id     uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_slug   text := NULLIF(btrim(COALESCE(p_payload->>'slug', '')), '');
BEGIN
  IF v_id IS NULL THEN
    IF v_slug IS NULL THEN
      RAISE EXCEPTION 'clubs: slug required' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(p_payload->>'starts_at', '') IS NULL THEN
      RAISE EXCEPTION 'clubs: starts_at required' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.club_events (
      tenant_id, club_id, group_id, thread_id, anchor_event_id, slug,
      title_pl, title_en, description_pl, description_en, kind,
      starts_at, ends_at, all_day, location, meeting_url, status,
      rsvp_enabled, capacity, min_tier_rank, created_by
    ) VALUES (
      v_tenant, p_club_id,
      NULLIF(p_payload->>'group_id', '')::uuid,
      NULLIF(p_payload->>'thread_id', '')::uuid,
      NULLIF(p_payload->>'anchor_event_id', '')::uuid,
      v_slug,
      COALESCE(p_payload->>'title_pl', ''),
      COALESCE(p_payload->>'title_en', ''),
      NULLIF(p_payload->>'description_pl', ''),
      NULLIF(p_payload->>'description_en', ''),
      COALESCE(NULLIF(p_payload->>'kind', ''), 'meeting'),
      (p_payload->>'starts_at')::timestamptz,
      NULLIF(p_payload->>'ends_at', '')::timestamptz,
      COALESCE((p_payload->>'all_day')::boolean, false),
      NULLIF(p_payload->>'location', ''),
      NULLIF(p_payload->>'meeting_url', ''),
      COALESCE(NULLIF(p_payload->>'status', ''), 'scheduled'),
      COALESCE((p_payload->>'rsvp_enabled')::boolean, false),
      NULLIF(p_payload->>'capacity', '')::integer,
      GREATEST(COALESCE(NULLIF(p_payload->>'min_tier_rank', '')::integer, 0), 0),
      auth.uid()
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  UPDATE public.club_events e SET
    group_id        = CASE WHEN p_payload ? 'group_id'
                           THEN NULLIF(p_payload->>'group_id', '')::uuid ELSE e.group_id END,
    thread_id       = CASE WHEN p_payload ? 'thread_id'
                           THEN NULLIF(p_payload->>'thread_id', '')::uuid ELSE e.thread_id END,
    anchor_event_id = CASE WHEN p_payload ? 'anchor_event_id'
                           THEN NULLIF(p_payload->>'anchor_event_id', '')::uuid ELSE e.anchor_event_id END,
    slug            = COALESCE(v_slug, e.slug),
    title_pl        = COALESCE(NULLIF(p_payload->>'title_pl', ''), e.title_pl),
    title_en        = COALESCE(NULLIF(p_payload->>'title_en', ''), e.title_en),
    description_pl  = CASE WHEN p_payload ? 'description_pl'
                           THEN NULLIF(p_payload->>'description_pl', '') ELSE e.description_pl END,
    description_en  = CASE WHEN p_payload ? 'description_en'
                           THEN NULLIF(p_payload->>'description_en', '') ELSE e.description_en END,
    kind            = COALESCE(NULLIF(p_payload->>'kind', ''), e.kind),
    starts_at       = COALESCE(NULLIF(p_payload->>'starts_at', '')::timestamptz, e.starts_at),
    ends_at         = CASE WHEN p_payload ? 'ends_at'
                           THEN NULLIF(p_payload->>'ends_at', '')::timestamptz ELSE e.ends_at END,
    all_day         = COALESCE((p_payload->>'all_day')::boolean, e.all_day),
    location        = CASE WHEN p_payload ? 'location'
                           THEN NULLIF(p_payload->>'location', '') ELSE e.location END,
    meeting_url     = CASE WHEN p_payload ? 'meeting_url'
                           THEN NULLIF(p_payload->>'meeting_url', '') ELSE e.meeting_url END,
    status          = COALESCE(NULLIF(p_payload->>'status', ''), e.status),
    rsvp_enabled    = COALESCE((p_payload->>'rsvp_enabled')::boolean, e.rsvp_enabled),
    capacity        = CASE WHEN p_payload ? 'capacity'
                           THEN NULLIF(p_payload->>'capacity', '')::integer ELSE e.capacity END,
    min_tier_rank   = CASE WHEN p_payload ? 'min_tier_rank'
                           THEN GREATEST(COALESCE(NULLIF(p_payload->>'min_tier_rank', '')::integer, 0), 0)
                           ELSE e.min_tier_rank END
  WHERE e.id = v_id AND e.club_id = p_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_event_upsert(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_event_upsert(uuid, jsonb) TO authenticated, service_role;