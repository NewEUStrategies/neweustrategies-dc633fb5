-- events-harness: include
-- ============================================================================
-- WYDARZENIA: FUNKCJE, KTORE PADALY PRZY KAZDYM WYKONANIU.
--
-- ZRODLO: `plpgsql_check` na katalogu po wszystkich migracjach (audyt
-- platformy, klasa „SQL nigdy niewykonany"). Kazda z czterech funkcji
-- przechodzila CREATE (PL/pgSQL nie sprawdza ciala przy tworzeniu) i KAZDE
-- wywolanie konczylo sie bledem:
--   * `admin_event_audience_grant_history(jsonb)` - `pr.full_name` (profiles
--     ma display_name / first_name / last_name) i `e.title` -> 42703; panel
--     historii uprawnien widowni nie otwieral sie wcale;
--   * `admin_event_audience_grants_list(jsonb)` - `e.title` -> 42703; lista
--     uprawnien widowni w panelu;
--   * `event_my_package_orders()` - `e.title` -> 42703; „Moje pakiety" kupujacego;
--   * `event_audience_qualifies(text)` - `AND` z wynikiem jsonb
--     `my_academic_domain_verification()` -> 42804 dla widowni `academic`;
--     wycena i zakup pakietow akademickich padaly dla KAZDEGO wolajacego.
--     Kwalifikacja czyta teraz pole `automatic` (domena na liscie
--     zweryfikowanych domen akademickich najemcy).
--
-- ZMIANA: ciala z katalogu (pg_get_functiondef) z poprawionymi odwolaniami;
-- tytul wydarzenia = title_pl, a bez niego title_en; nazwa aktora =
-- display_name, a bez niej imie i nazwisko. Sygnatury, typy wyniku i ACL bez
-- zmian.
--
-- IDEMPOTENTNA: CREATE OR REPLACE.
-- DOWOD: supabase/tests/sql_runtime_errors_test.sql (wywolania + plpgsql_check).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_event_audience_grant_history(p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(id uuid, grant_id uuid, action text, created_at timestamp with time zone, actor_id uuid, actor_name text, actor_email text, audience text, event_id uuid, event_title text, subject_email text, subject_name text, changed text[], before_values jsonb, after_values jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_grant_id uuid := NULLIF(p_payload->>'grant_id', '')::uuid;
  v_search text := NULLIF(lower(btrim(COALESCE(p_payload->>'search', ''))), '');
  v_limit integer := LEAST(GREATEST(COALESCE((NULLIF(p_payload->>'limit', ''))::integer, 100), 1), 500);
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.entity_id,
    a.action,
    a.created_at,
    a.actor_id,
    NULLIF(btrim(COALESCE(COALESCE(NULLIF(btrim(pr.display_name), ''), btrim(concat_ws(' ', pr.first_name, pr.last_name))), '')), ''),
    lower(btrim(au.email)),
    COALESCE(g.audience, a.metadata->>'audience'),
    COALESCE(g.event_id, NULLIF(a.metadata->>'event_id', '')::uuid),
    COALESCE(NULLIF(e.title_pl, ''), e.title_en),
    COALESCE(lower(btrim(su.email)), lower(btrim(pe.email))),
    NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), ''),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(a.metadata->'changed')),
      ARRAY[]::text[]
    ),
    COALESCE(a.metadata->'before', '{}'::jsonb),
    COALESCE(a.metadata->'after', '{}'::jsonb)
  FROM public.audit_log a
  LEFT JOIN public.event_audience_grants g
    ON g.id = a.entity_id AND g.tenant_id = a.tenant_id
  LEFT JOIN auth.users au ON au.id = a.actor_id
  LEFT JOIN public.profiles pr ON pr.id = a.actor_id
  LEFT JOIN auth.users su ON su.id = g.user_id
  LEFT JOIN public.event_people pe ON pe.id = g.person_id AND pe.tenant_id = a.tenant_id
  LEFT JOIN public.events e
    ON e.id = COALESCE(g.event_id, NULLIF(a.metadata->>'event_id', '')::uuid)
   AND e.tenant_id = a.tenant_id
  WHERE a.tenant_id = v_tenant
    AND a.entity_type = 'event_audience_grant'
    AND (v_grant_id IS NULL OR a.entity_id = v_grant_id)
    AND (
      v_event_id IS NULL
      OR COALESCE(g.event_id, NULLIF(a.metadata->>'event_id', '')::uuid) = v_event_id
    )
    AND (
      v_search IS NULL
      OR lower(COALESCE(au.email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(COALESCE(NULLIF(btrim(pr.display_name), ''), btrim(concat_ws(' ', pr.first_name, pr.last_name))), '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(su.email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(pe.email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(g.evidence, '')) LIKE '%' || v_search || '%'
    )
  ORDER BY a.created_at DESC
  LIMIT v_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_event_audience_grants_list(p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(id uuid, audience text, user_id uuid, person_id uuid, company_id uuid, event_id uuid, subject_email text, subject_name text, company_name text, event_title text, evidence text, valid_from timestamp with time zone, valid_until timestamp with time zone, revoked_at timestamp with time zone, created_at timestamp with time zone, state text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_audience text := NULLIF(lower(btrim(COALESCE(p_payload->>'audience', ''))), '');
  v_include_revoked boolean := COALESCE((NULLIF(p_payload->>'include_revoked', ''))::boolean, false);
  v_search text := NULLIF(lower(btrim(COALESCE(p_payload->>'search', ''))), '');
BEGIN
  RETURN QUERY
  SELECT
    g.id, g.audience, g.user_id, g.person_id, g.company_id, g.event_id,
    COALESCE(lower(btrim(u.email)), lower(btrim(pe.email))),
    btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')),
    c.name,
    COALESCE(NULLIF(e.title_pl, ''), e.title_en),
    g.evidence, g.valid_from, g.valid_until, g.revoked_at, g.created_at,
    CASE
      WHEN g.revoked_at IS NOT NULL THEN 'revoked'
      WHEN g.valid_until IS NOT NULL AND g.valid_until <= now() THEN 'expired'
      WHEN g.valid_from > now() THEN 'scheduled'
      ELSE 'active'
    END
  FROM public.event_audience_grants g
  LEFT JOIN auth.users u ON u.id = g.user_id
  LEFT JOIN public.event_people pe ON pe.id = g.person_id AND pe.tenant_id = g.tenant_id
  LEFT JOIN public.crm_companies c ON c.id = g.company_id AND c.tenant_id = g.tenant_id
  LEFT JOIN public.events e ON e.id = g.event_id AND e.tenant_id = g.tenant_id
  WHERE g.tenant_id = v_tenant
    AND (v_event_id IS NULL OR g.event_id = v_event_id)
    AND (v_audience IS NULL OR g.audience = v_audience)
    AND (v_include_revoked OR g.revoked_at IS NULL)
    AND (
      v_search IS NULL
      OR lower(COALESCE(u.email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(pe.email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(c.name, '')) LIKE '%' || v_search || '%'
      OR lower(g.evidence) LIKE '%' || v_search || '%'
    )
  ORDER BY g.created_at DESC, g.id
  LIMIT 500;
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_my_package_orders()
 RETURNS TABLE(id uuid, event_id uuid, event_slug text, event_title text, package_id uuid, package_name_pl text, package_name_en text, status text, seats_total integer, seats_free integer, seats_invited integer, seats_assigned integer, amount_cents integer, discount_cents integer, currency text, buyer_email text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.id, o.event_id, e.slug, COALESCE(NULLIF(e.title_pl, ''), e.title_en), o.package_id, p.name_pl, p.name_en,
    o.status, o.seats_total,
    COALESCE(s.free, 0), COALESCE(s.invited, 0), COALESCE(s.assigned, 0),
    o.amount_cents, o.discount_cents, o.currency, o.buyer_email, o.created_at
  FROM public.event_package_orders o
  JOIN public.events e ON e.id = o.event_id AND e.tenant_id = o.tenant_id
  JOIN public.event_ticket_packages p ON p.id = o.package_id AND p.tenant_id = o.tenant_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE x.revoked_at IS NULL AND x.registration_id IS NULL AND x.invite_email IS NULL
      )::integer AS free,
      count(*) FILTER (
        WHERE x.revoked_at IS NULL AND x.registration_id IS NULL AND x.invite_email IS NOT NULL
      )::integer AS invited,
      count(*) FILTER (
        WHERE x.revoked_at IS NULL AND x.registration_id IS NOT NULL
      )::integer AS assigned
    FROM public.event_package_seats x
    WHERE x.package_order_id = o.id AND x.tenant_id = o.tenant_id
  ) s ON true
  WHERE o.tenant_id = v_tenant
    AND o.buyer_user_id = v_uid
  ORDER BY o.created_at DESC, o.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_audience_qualifies(p_audience text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_email text;
BEGIN
  IF p_audience IS NULL OR p_audience = 'public' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN false;
  END IF;

  IF p_audience = 'member' THEN
    RETURN true;
  END IF;

  IF p_audience = 'academic'
     AND COALESCE((public.my_academic_domain_verification() ->> 'automatic')::boolean, false) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_audience_grants g
    WHERE g.tenant_id = v_tenant
      AND g.audience = p_audience
      AND g.user_id = v_uid
      AND g.revoked_at IS NULL
      AND g.valid_from <= now()
      AND (g.valid_until IS NULL OR g.valid_until > now())
  ) THEN
    RETURN true;
  END IF;

  IF p_audience = 'company' THEN
    SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = v_uid;
    IF v_email IS NULL OR position('@' in v_email) = 0 THEN
      RETURN false;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.crm_companies c
      WHERE c.tenant_id = v_tenant
        AND c.domain IS NOT NULL
        AND lower(btrim(c.domain)) = split_part(v_email, '@', 2)
    );
  END IF;

  RETURN false;
END;
$function$;
