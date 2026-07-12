-- ============================================================================
-- Katalog osób: weryfikacja zawodowa + filtr po roli (stanowisku).
--
--   1) profiles.verified_at / verified_by - odznaka "zweryfikowany zawodowo"
--      nadawana przez admina tenanta (RPC admin_set_profile_verification,
--      audyt w samych kolumnach: kto i kiedy). GRANT UPDATE na profiles jest
--      tabelowy, więc samodzielne ustawienie odznaki blokuje trigger guard
--      (wzorzec: pinowanie tenant_id).
--
--   2) search_people zwraca flagę verified oraz przyjmuje nowe filtry:
--      p_job_title (rola/stanowisko) i p_verified_only. Zmiana kolumn
--      wyjściowych wymaga DROP FUNCTION (lekcja 42P13 z audytu 2026-07-11).
--
--   3) people_filter_options dostaje czwartą fasetę: job_title.
--
-- Idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Kolumny weryfikacji + widoczność
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verified_by uuid;

COMMENT ON COLUMN public.profiles.verified_at IS
  'Weryfikacja zawodowa nadana przez admina (NULL = niezweryfikowany).';
COMMENT ON COLUMN public.profiles.verified_by IS
  'Admin, który nadał/odebrał weryfikację (audyt; bez grantu SELECT dla klientów).';

-- Odznaka jest publicznym sygnałem zaufania - doczytywana przy profilu/autorze.
-- verified_by zostaje service-role-only (kolumnowe SELECT granty profiles).
GRANT SELECT (verified_at) ON public.profiles TO anon, authenticated;

-- Guard: verified_at/verified_by zmienia wyłącznie admin tenanta (RPC niżej
-- też przechodzi przez ten trigger - auth.uid() to wołający admin). Service
-- role (auth.uid() IS NULL) przechodzi dla operacji serwerowych.
CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
    IF v_uid IS NOT NULL AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
      RAISE EXCEPTION 'profiles: verification can only be changed by an admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_verification_trg ON public.profiles;
CREATE TRIGGER profiles_guard_verification_trg
  BEFORE UPDATE OF verified_at, verified_by ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_verification();

-- ----------------------------------------------------------------------------
-- 2) RPC: nadanie / odebranie weryfikacji przez admina tenanta
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_profile_verification(
  p_user_id uuid,
  p_verified boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_tenant uuid;
  v_target_tenant uuid;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT tenant_id INTO v_caller_tenant FROM public.profiles WHERE id = v_caller;
  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_target_tenant IS NULL OR v_target_tenant IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'forbidden: target outside caller tenant';
  END IF;

  UPDATE public.profiles
     SET verified_at = CASE WHEN p_verified THEN now() ELSE NULL END,
         verified_by = CASE WHEN p_verified THEN v_caller ELSE NULL END
   WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_profile_verification(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_verification(uuid, boolean)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) search_people: + verified w wyniku, + filtry p_job_title / p_verified_only
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_people(text, text, text, text, integer, integer);

CREATE FUNCTION public.search_people(
  p_query text DEFAULT '',
  p_specialization text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_job_title text DEFAULT NULL,
  p_verified_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  verified boolean,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT
      unaccent(lower(btrim(COALESCE(p_query, '')))) AS raw,
      replace(replace(replace(
        unaccent(lower(btrim(COALESCE(p_query, '')))),
        '\', '\\'), '%', '\%'), '_', '\_') AS esc
  )
  SELECT
    p.id,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'User'
    ) AS display_name,
    p.avatar_url,
    p.job_title,
    p.current_company,
    p.specialization,
    p.location,
    p.slug,
    (p.verified_at IS NOT NULL) AS verified,
    count(*) OVER () AS total_count
  FROM public.profiles p, q
  WHERE auth.uid() IS NOT NULL
    AND p.discoverable
    AND p.id <> auth.uid()
    AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
    AND (q.raw = '' OR p.discovery_search LIKE '%' || q.esc || '%')
    AND (COALESCE(btrim(p_specialization), '') = ''
         OR lower(btrim(p.specialization)) = lower(btrim(p_specialization)))
    AND (COALESCE(btrim(p_company), '') = ''
         OR lower(btrim(p.current_company)) = lower(btrim(p_company)))
    AND (COALESCE(btrim(p_location), '') = ''
         OR lower(btrim(p.location)) = lower(btrim(p_location)))
    AND (COALESCE(btrim(p_job_title), '') = ''
         OR lower(btrim(p.job_title)) = lower(btrim(p_job_title)))
    AND (NOT COALESCE(p_verified_only, false) OR p.verified_at IS NOT NULL)
  ORDER BY
    (q.raw <> '' AND p.discovery_search LIKE q.esc || '%') DESC,
    CASE WHEN q.raw <> '' THEN similarity(p.discovery_search, q.raw) ELSE 0 END DESC,
    lower(COALESCE(
      NULLIF(btrim(p.display_name), ''),
      concat_ws(' ', p.first_name, p.last_name)
    )) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE EXECUTE ON FUNCTION
  public.search_people(text, text, text, text, integer, integer, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.search_people(text, text, text, text, integer, integer, text, boolean)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) people_filter_options: czwarta faseta job_title (rola/stanowisko)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.people_filter_options()
RETURNS TABLE (field text, value text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH base AS (
    SELECT p.specialization, p.current_company, p.location, p.job_title
      FROM public.profiles p
     WHERE auth.uid() IS NOT NULL
       AND p.discoverable
       AND p.id <> auth.uid()
       AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
  )
  SELECT * FROM (
    SELECT 'specialization'::text AS field, btrim(b.specialization) AS value, count(*) AS cnt
      FROM base b
     WHERE COALESCE(btrim(b.specialization), '') <> ''
     GROUP BY btrim(b.specialization)
    UNION ALL
    SELECT 'company'::text, btrim(b.current_company), count(*)
      FROM base b
     WHERE COALESCE(btrim(b.current_company), '') <> ''
     GROUP BY btrim(b.current_company)
    UNION ALL
    SELECT 'location'::text, btrim(b.location), count(*)
      FROM base b
     WHERE COALESCE(btrim(b.location), '') <> ''
     GROUP BY btrim(b.location)
    UNION ALL
    SELECT 'job_title'::text, btrim(b.job_title), count(*)
      FROM base b
     WHERE COALESCE(btrim(b.job_title), '') <> ''
     GROUP BY btrim(b.job_title)
  ) opts
  ORDER BY opts.field ASC, opts.cnt DESC, opts.value ASC
$$;

REVOKE EXECUTE ON FUNCTION public.people_filter_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.people_filter_options() TO authenticated, service_role;
