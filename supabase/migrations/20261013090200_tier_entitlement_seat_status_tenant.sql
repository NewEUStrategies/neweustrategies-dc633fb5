-- ============================================================================
-- UPRAWNIENIA WARSTWY: MIEJSCE ZAWIESZONE NIE OTWIERA TRESCI, A SUBSKRYPCJA
-- JEDNEGO NAJEMCY NIE OTWIERA TRESCI DRUGIEGO (audyt billingowy SUB-07).
--
-- DEFEKT (stan przed ta migracja, najnowsze definicje):
--   * `user_has_tier_feature(uuid, text)` (20260714130000_expert_hub.sql) -
--     trzy galezie (subskrypcja / nadanie / miejsce w organizacji) BEZ zadnego
--     filtra najemcy, a galaz miejsc sprawdzala tylko `mo.status = 'active'`.
--     Status MIEJSCA (`organization_seats.status`: active | grace | suspended,
--     20260729210625) byl ignorowany w calosci.
--   * `user_tier_rank(uuid, uuid)` (ta sama migracja) - najemca byl, ale galaz
--     miejsc tez nie patrzyla na `os.status`.
--   * `has_content_access(...)` (20260723090000_tier_content_gating_tracker.sql)
--     - przy domyslnym `min_tier_rank = 0` otwiera tresc 'paid' przez
--     `user_has_tier_feature(v_uid, 'premium_content')`, czyli: subskrypcja
--     z warstwa premium_content w najemcy A otwierala platne tresci najemcy B,
--     a osoba wypchnieta z miejsca po koncu karencji (status 'suspended') dalej
--     czytala platne tresci organizacji. Przy `min_tier_rank > 0` ranga szla
--     przez `current_tier_rank()` - najemca HOSTA/profilu wolajacego, a nie
--     najemca TRESCI.
--   Wzorzec poprawny byl juz w repo: `current_membership_tier()` (20260729210625)
--   - najemca w kazdej galezi i miejsce tylko 'active' albo 'grace' przed
--   terminem `grace_until`.
--
-- ZMIANA:
--   1. `user_has_tier_feature(p_user, _feature, p_tenant)` - NOWE przeciazenie
--      z jawnym najemca: kazda galaz zawezona do `p_tenant`, galaz miejsc
--      z regula statusu identyczna jak `current_membership_tier()`. Brak
--      najemcy albo uzytkownika = false (fail-closed).
--   2. `user_has_tier_feature(p_user, _feature)` - stara sygnatura ZOSTAJE (woluja
--      ja `can_gift_articles()` i `list_qa_questions(uuid)`), ale deleguje do
--      wersji z najemca rozwiazanym tak samo jak w `user_tier_rank` /
--      `current_membership_tier` (`public_tenant_id()`, potem
--      `current_tenant_id()`). Bez DROP: zadna polityka ani widok jej nie uzywa,
--      a CREATE OR REPLACE nie rusza wolajacych.
--   3. `user_tier_rank(p_user, p_tenant)` - galaz miejsc z regula statusu.
--   4. `has_content_access(...)` - ranga i flaga premium_content liczone dla
--      NAJEMCY TRESCI (`content_access.tenant_id`), nie dla najemcy hosta:
--      `user_tier_rank(v_uid, v_tenant)` i `user_has_tier_feature(v_uid,
--      'premium_content', v_tenant)`. Reszta ciala bez zmian (zakup
--      jednorazowy, targetowanie planem, tryb members).
--
-- CZEGO TO NIE ZMIENIA: statusy subskrypcji (tylko 'active' z niewygaslym
-- `current_period_end`, jak w `current_membership_tier`) - karencja past_due
-- jest sprawa zapisu `current_period_end` po stronie webhooka, nie tych funkcji.
-- `my_ticket_allowance()` ma juz regule statusu miejsca, a `is_vip_user`,
-- `my_effective_tier_features`, `my_expert_request_quota` i
-- `membership_year_window` filtruja najemce i nie czytaja miejsc - bez zmian.
--
-- GRANTY: obie wersje `user_has_tier_feature` oraz `user_tier_rank` wylacznie
-- dla `service_role` (jak dotad; domyslne uprawnienia platformy nadaja EXECUTE
-- anon/authenticated kazdej NOWEJ funkcji jawnie, wiec REVOKE obejmuje obie
-- role, nie tylko PUBLIC). `has_content_access` - bez zmian (anon,
-- authenticated, service_role).
--
-- IDEMPOTENTNA: CREATE OR REPLACE + bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/tier_entitlement_seat_tenant_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Flaga warstwy KONKRETNEGO uzytkownika w KONKRETNYM najemcy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_tier_feature(p_user uuid, _feature text, p_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND p_tenant IS NOT NULL AND (
    -- Subskrypcja: najemca PLANU (tak jak current_membership_tier) - warstwa
    -- planu najemcy A nie jest warstwa najemcy B.
    EXISTS (
      SELECT 1 FROM public.user_subscriptions us
        JOIN public.access_plans ap ON ap.id = us.plan_id AND ap.tenant_id = p_tenant
        JOIN public.membership_tiers mt
          ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
       WHERE us.user_id = p_user AND us.status = 'active'
         AND (us.current_period_end IS NULL OR us.current_period_end > now())
         AND (mt.features ->> _feature)::boolean IS TRUE
    ) OR EXISTS (
      SELECT 1 FROM public.membership_grants mg
        JOIN public.membership_tiers mt
          ON mt.tenant_id = mg.tenant_id AND mt.key = mg.tier_key AND mt.active
       WHERE mg.user_id = p_user AND mg.tenant_id = p_tenant
         AND mg.revoked_at IS NULL
         AND mg.starts_at <= now()
         AND (mg.expires_at IS NULL OR mg.expires_at > now())
         AND (mt.features ->> _feature)::boolean IS TRUE
    ) OR EXISTS (
      -- Miejsce w organizacji: aktywne albo w karencji PRZED terminem. Miejsce
      -- 'suspended' (redukcja liczby miejsc po koncu karencji) nie daje nic -
      -- regula 1:1 z current_membership_tier() i my_ticket_allowance().
      SELECT 1 FROM public.organization_seats os
        JOIN public.member_organizations mo ON mo.id = os.org_id
        JOIN public.membership_tiers mt
          ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key AND mt.active
       WHERE os.user_id = p_user AND mo.tenant_id = p_tenant
         AND (os.status = 'active'
              OR (os.status = 'grace' AND (os.grace_until IS NULL OR os.grace_until > now())))
         AND mo.status = 'active'
         AND mo.starts_at <= now()
         AND (mo.expires_at IS NULL OR mo.expires_at > now())
         AND (mt.features ->> _feature)::boolean IS TRUE
    )
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_tier_feature(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.user_has_tier_feature(uuid, text, uuid) IS
  'Flaga features warstwy uzytkownika p_user W NAJEMCY p_tenant: subskrypcja (najemca planu), '
  'nadanie albo miejsce w organizacji (status active lub grace przed grace_until). '
  'Brak najemcy/uzytkownika = false. Wylacznie service_role i funkcje SECURITY DEFINER.';

-- ----------------------------------------------------------------------------
-- 2) Stara sygnatura: ten sam werdykt dla najemcy biezacego kontekstu.
--    Rozstrzygniecie najemcy identyczne z user_tier_rank(p_user, NULL) i
--    current_membership_tier() - jedna regula, nie trzecia wersja.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_tier_feature(p_user uuid, _feature text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_has_tier_feature(
    p_user,
    _feature,
    COALESCE(public.public_tenant_id(), public.current_tenant_id())
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_tier_feature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text) TO service_role;

COMMENT ON FUNCTION public.user_has_tier_feature(uuid, text) IS
  'Zgodnosc wsteczna: user_has_tier_feature(p_user, _feature, najemca kontekstu) - '
  'najemca z public_tenant_id(), potem current_tenant_id(). Nowy kod podaje najemce jawnie.';

-- ----------------------------------------------------------------------------
-- 3) Ranga warstwy uzytkownika w najemcy - galaz miejsc z regula statusu.
--    Pelne cialo z 20260714130000_expert_hub.sql; zmiana wylacznie w galezi
--    organization_seats.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_tier_rank(p_user uuid, p_tenant uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT COALESCE(p_tenant, public.public_tenant_id(), public.current_tenant_id()) AS tid
  ),
  entitled AS (
    SELECT mt.rank
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
      JOIN t ON ap.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
     WHERE us.user_id = p_user AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
    UNION ALL
    SELECT mt.rank
      FROM public.membership_grants mg
      JOIN t ON mg.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mg.tenant_id AND mt.key = mg.tier_key AND mt.active
     WHERE mg.user_id = p_user AND mg.revoked_at IS NULL
       AND mg.starts_at <= now()
       AND (mg.expires_at IS NULL OR mg.expires_at > now())
    UNION ALL
    SELECT mt.rank
      FROM public.organization_seats os
      JOIN public.member_organizations mo ON mo.id = os.org_id
      JOIN t ON mo.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key AND mt.active
     WHERE os.user_id = p_user
       AND (os.status = 'active'
            OR (os.status = 'grace' AND (os.grace_until IS NULL OR os.grace_until > now())))
       AND mo.status = 'active'
       AND mo.starts_at <= now()
       AND (mo.expires_at IS NULL OR mo.expires_at > now())
  )
  SELECT COALESCE(
    (SELECT max(rank) FROM entitled),
    (SELECT mt.rank FROM public.membership_tiers mt JOIN t ON mt.tenant_id = t.tid
      WHERE mt.is_default AND mt.active LIMIT 1),
    0
  );
$$;

REVOKE ALL ON FUNCTION public.user_tier_rank(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_tier_rank(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Rdzen bramki tresci: ranga i premium_content dla NAJEMCY TRESCI.
--    Pelne cialo z 20260723090000_tier_content_gating_tracker.sql; zmienione
--    wylacznie zrodla rangi/flagi. Sygnatura bez zmian (get_entity_content,
--    metering, linki podarunkowe woluja ja tak samo).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_content_access(
  _entity_type access_entity_type,
  _entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode access_mode;
  v_plans uuid[];
  v_tenant uuid;
  v_min_rank integer;
  v_uid uuid := auth.uid();
BEGIN
  SELECT mode, plan_ids, tenant_id, min_tier_rank
    INTO v_mode, v_plans, v_tenant, v_min_rank
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode = 'public' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  v_min_rank := COALESCE(v_min_rank, 0);

  -- Tryb 'members': konto zalogowane w tenancie tresci; przy ustawionym progu
  -- dodatkowo ranga W TYM SAMYM najemcy (nie w najemcy hosta wolajacego).
  IF v_mode = 'members' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = v_uid AND p.tenant_id = v_tenant
    ) AND (v_min_rank = 0 OR public.user_tier_rank(v_uid, v_tenant) >= v_min_rank);
  END IF;

  -- Tryb 'paid'. Zakup jednorazowy zawsze otwiera dana tresc.
  IF EXISTS (
    SELECT 1 FROM public.user_purchases
     WHERE user_id = v_uid
       AND entity_type = _entity_type
       AND entity_id = _entity_id
       AND status = 'active'
  ) THEN
    RETURN true;
  END IF;

  -- Konkretny plan wskazany na tresci (targetowanie planem) - niezaleznie od rangi.
  IF array_length(v_plans, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_subscriptions
     WHERE user_id = v_uid
       AND plan_id = ANY (v_plans)
       AND status = 'active'
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RETURN true;
  END IF;

  -- Drabinka warstw: ranga z subskrypcji + nadania + miejsca (active/grace)
  -- liczona w najemcy TRESCI - subskrypcja najemcy A nie podnosi rangi w B.
  IF v_min_rank > 0 THEN
    RETURN public.user_tier_rank(v_uid, v_tenant) >= v_min_rank;
  END IF;

  -- Legacy (min_tier_rank = 0): binarny site-licence przez premium_content,
  -- teraz zawezony do najemcy tresci i do miejsc active/grace.
  IF public.user_has_tier_feature(v_uid, 'premium_content', v_tenant) THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.has_content_access(access_entity_type, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_content_access(access_entity_type, uuid)
  TO anon, authenticated, service_role;
