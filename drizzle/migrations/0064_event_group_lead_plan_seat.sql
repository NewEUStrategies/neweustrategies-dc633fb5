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
    'amount_cents', v_price,
    'currency', v_ticket.currency,
    'holder_is_caller', v_holder
  );
END;
$$;
COMMENT ON FUNCTION public.event_registration_payment_context(uuid) IS
  'Czy WOLAJACY moze oplacic wskazane zgloszenie: wlasnosc (created_by albo event_people.user_id), stan zapisu, kwota informacyjna i holder_is_caller (osoba zgloszenia to wolajacy - tylko wtedy kasa liczy benefit planu). Kasa waliduje nia registration_id przyjete od klienta.';

REVOKE ALL ON FUNCTION public.event_registration_payment_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_registration_payment_context(uuid) TO authenticated, service_role;

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

  IF v_reg.id IS NULL OR v_pool_tenant IS NULL OR v_face <= 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_eligible');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('plan_ticket_pool:' || v_pool_tenant::text || ':' || v_uid::text)
  );
  IF EXISTS (
    SELECT 1 FROM public.plan_ticket_claims c
     WHERE c.user_id = v_uid AND c.event_id = v_reg.event_id
       AND c.released_at IS NULL
       AND c.period_start <= CURRENT_DATE
       AND c.period_end > CURRENT_DATE
  ) THEN
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

  IF COALESCE(p_dry_run, false) THEN
    RETURN jsonb_build_object('claimed', true, 'reused', false, 'dry_run', true);
  END IF;

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
    period_start, period_end, face_value_cents, currency
  )
  VALUES (
    v_pool_tenant, v_uid, v_reg.event_id, v_org,
    COALESCE(v_tier, 'member'),
    (v_state ->> 'period_start')::date,
    (v_state ->> 'period_end')::date,
    v_face,
    COALESCE(v_ticket.currency, 'PLN')
  )
  ON CONFLICT (user_id, event_id) DO UPDATE
    SET released_at      = NULL,
        org_id           = EXCLUDED.org_id,
        tier_key         = EXCLUDED.tier_key,
        period_start     = EXCLUDED.period_start,
        period_end       = EXCLUDED.period_end,
        face_value_cents = EXCLUDED.face_value_cents,
        currency         = EXCLUDED.currency,
        claimed_at       = now();
  RETURN jsonb_build_object('claimed', true, 'reused', false);
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_claim_plan_seat(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_registration_claim_plan_seat(uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_claim_plan_seat(uuid, boolean) IS
  'Bilet z puli planu dla miejsca PROWADZACEGO w zamowieniu grupowym: tylko zgloszenie, ktorego osoba to wolajacy, bez grupy nad soba, otwarte i nieoplacone, z biletem platnym w cenniku. Ta sama regula puli co claim_included_event_ticket (blokady, okno roku, jeden bilet na wydarzenie - ponowna kasa bierze ten sam). p_dry_run: podglad kasy - ta sama odpowiedz bez zapisu. Odmowa nie rzuca: {claimed:false, reason: account_required | not_eligible | pool_empty}.';