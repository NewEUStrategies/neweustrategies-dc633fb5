-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S1, 5/5): JEDNA ŚCIEŻKA RĘCZNEGO NADANIA
-- I ODEBRANIA CZŁONKOSTWA.
--
-- DEFEKT
--   Ręczne nadanie warstwy ma dziś dwie drogi o różnej semantyce:
--   * RPC `admin_grant_membership(p_email, …)` szuka konta po e-mailu
--     GLOBALNIE w `auth.users` (bez sprawdzenia, że konto należy do najemcy
--     admina), nie wygasza poprzedniego ręcznego nadania (użytkownik zbiera
--     kilka aktywnych naraz) i nie zostawia wpisu w `audit_log`;
--   * `setMemberTier`/`revokeMemberTier` (klient serwisowy) wygaszają
--     WSZYSTKIE aktywne nadania użytkownika - także te z darowizny, kuponu,
--     domeny organizacji czy programu ekspertów, których panel członkostwa nie
--     jest właścicielem - a zapis i wygaszenie idą osobnymi zapytaniami (błąd
--     w połowie zostawia stan pośredni).
--
-- ZMIANA
--   A. `admin_membership_grant_set(p_user_id, p_tier_key, p_expires_at, p_note)
--      RETURNS uuid` (id nowego nadania). Panel; WYŁĄCZNIE admin (editor i autor
--      -> 42501), najemca z sesji (`assert_admin_tenant()`). W JEDNEJ
--      transakcji: użytkownik należy do najemcy (`profiles.tenant_id`, inaczej
--      P0002 `user_not_in_tenant`); warstwa istnieje i jest aktywna (inaczej
--      22023 `tier_inactive`); `p_expires_at` NULL albo w przyszłości (22023
--      `expires_in_past`); wygaszenie (`revoked_at = now()`) aktywnych nadań
--      TEGO użytkownika z `source = 'manual'` - inne źródła zostają
--      nietknięte; INSERT `source = 'manual'`, `granted_by = auth.uid()`;
--      wpis `audit_log` `membership.manual_grant` (`metadata {tier_key,
--      user_id, expires_at, revoked_grant_ids}`). Równoległe nadania temu
--      samemu użytkownikowi serializuje blokada doradcza transakcji (inaczej
--      dwa wywołania naraz zostawiłyby dwa aktywne nadania ręczne).
--   B. `admin_membership_grant_revoke(p_grant_id, p_reason) RETURNS uuid`.
--      Panel; wyłącznie admin, najemca z sesji. Nadanie najemcy, jeszcze
--      nieodwołane (inaczej P0002 `grant_not_found` - także nadanie innego
--      najemcy); `revoked_at = now()`; `audit_log` `membership.manual_revoke`
--      (`metadata {reason, source, tier_key, user_id}`). Powód > 500 znaków
--      -> 22023 `reason_too_long` (odrzucony, nie przycięty).
--   C. CRM: istniejący wyzwalacz `membership_crm_sync_outbox`
--      (`queue_membership_crm_sync`, 20260912103000) zapisuje
--      `member_crm_sync_pending` dla nadań `manual` - w tej samej transakcji,
--      bez nowego kodu i bez duplikatu.
--   D. `REVOKE EXECUTE ON FUNCTION admin_grant_membership(...) FROM
--      authenticated` - forward-only (bez DROP: funkcja zostaje dla
--      ewentualnych wywołań serwisowych do sprzątnięcia w I9; bez CIALO-Z, bo
--      to nie redefinicja).
--
-- KOLEJNOŚĆ WDROŻENIA: razem z kodem S1 (`membership-admin.ts`,
-- `membersDirectory.functions.ts` wołają nowe RPC). Stary panel wołający
-- `admin_grant_membership` dostaje 42501 po wdrożeniu tej migracji.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe sygnatury), bezstanowe
-- REVOKE/GRANT. Zero DDL.
-- DOWÓD: supabase/tests/membership_grants_single_path_test.sql (jedna
-- transakcja, audit_log, wygaszanie tylko `manual`, warstwa nieaktywna,
-- użytkownik spoza najemcy, editor 42501, wiersz outboxu CRM, brak EXECUTE
-- `admin_grant_membership` dla authenticated).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Nadanie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_membership_grant_set(
  p_user_id uuid,
  p_tier_key text,
  p_expires_at timestamptz,
  p_note text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_revoked uuid[];
  v_id uuid;
BEGIN
  -- Jawne 42501 przed `assert_admin_tenant()` (ta rzuca P0001) - klient
  -- tłumaczy brak uprawnień po kodzie.
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.assert_admin_tenant();

  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'user_not_in_tenant' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.membership_tiers t
     WHERE t.tenant_id = v_tenant AND t.key = p_tier_key AND t.active
  ) THEN
    RAISE EXCEPTION 'tier_inactive' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'expires_in_past' USING ERRCODE = '22023';
  END IF;

  -- Jedno aktywne nadanie RĘCZNE na użytkownika: równoległe wywołania dla
  -- tej samej osoby czekają na siebie (blokada zwalnia się z transakcją).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('membership_manual_grant:' || v_tenant::text || ':' || p_user_id::text, 0));

  -- Wygaszamy WYŁĄCZNIE nadania ręczne - darowizna, kupon, domena
  -- organizacji i program ekspertów mają własnych właścicieli.
  WITH revoked AS (
    UPDATE public.membership_grants g
       SET revoked_at = now()
     WHERE g.tenant_id = v_tenant
       AND g.user_id = p_user_id
       AND g.source = 'manual'
       AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at > now())
    RETURNING g.id
  )
  SELECT COALESCE(array_agg(r.id ORDER BY r.id), ARRAY[]::uuid[]) INTO v_revoked FROM revoked r;

  INSERT INTO public.membership_grants (tenant_id, user_id, tier_key, source, note, granted_by, expires_at)
  VALUES (v_tenant, p_user_id, p_tier_key, 'manual', v_note, v_uid, p_expires_at)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tenant, v_uid, 'membership.manual_grant', 'membership_grant', v_id,
    jsonb_build_object(
      'tier_key', p_tier_key,
      'user_id', p_user_id,
      'expires_at', p_expires_at,
      'revoked_grant_ids', to_jsonb(v_revoked)
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_membership_grant_set(uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_membership_grant_set(uuid, text, timestamptz, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_membership_grant_set(uuid, text, timestamptz, text) IS
  'Hub S1: ręczne nadanie warstwy (admin, najemca z sesji) w jednej transakcji - wygasza wyłącznie aktywne nadania manual użytkownika, audit_log membership.manual_grant, CRM przez outbox. Zwraca id nadania.';

-- ----------------------------------------------------------------------------
-- B. Odebranie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_membership_grant_revoke(
  p_grant_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_grant public.membership_grants%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.assert_admin_tenant();

  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_grant
    FROM public.membership_grants g
   WHERE g.id = p_grant_id
     AND g.tenant_id = v_tenant
     AND g.revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'grant_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.membership_grants SET revoked_at = now() WHERE id = v_grant.id;

  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tenant, v_uid, 'membership.manual_revoke', 'membership_grant', v_grant.id,
    jsonb_build_object(
      'reason', v_reason,
      'source', v_grant.source,
      'tier_key', v_grant.tier_key,
      'user_id', v_grant.user_id
    )
  );

  RETURN v_grant.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_membership_grant_revoke(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_membership_grant_revoke(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_membership_grant_revoke(uuid, text) IS
  'Hub S1: odebranie nadania członkostwa (admin, najemca z sesji) z wpisem audit_log membership.manual_revoke; nadanie spoza najemcy lub już odwołane -> P0002 grant_not_found.';

-- ----------------------------------------------------------------------------
-- D. Stara ścieżka bez sprawdzenia najemcy - koniec wywołań z przeglądarki.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.admin_grant_membership(text, text, integer, text) FROM PUBLIC, anon, authenticated;
