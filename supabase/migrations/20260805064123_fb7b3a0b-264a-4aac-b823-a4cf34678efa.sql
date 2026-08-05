-- 1. Szczegóły audytowe zdarzeń zgód
ALTER TABLE public.user_consent_events
  ADD COLUMN IF NOT EXISTS banner_version text,
  ADD COLUMN IF NOT EXISTS decision_id uuid,
  ADD COLUMN IF NOT EXISTS page_url text;

CREATE INDEX IF NOT EXISTS user_consent_events_tenant_created_idx
  ON public.user_consent_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_consent_events_decision_idx
  ON public.user_consent_events (decision_id);

-- 2. Zapis zgody z dodatkowymi metadanymi (nowa sygnatura; stare zostają)
CREATE OR REPLACE FUNCTION public.set_user_consent(
  p_key text,
  p_given boolean,
  p_version text,
  p_gpc boolean,
  p_lang text,
  p_ip text,
  p_user_agent text,
  p_source text,
  p_banner_version text,
  p_decision_id uuid,
  p_page_url text
)
RETURNS public.user_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_gpc boolean := COALESCE(p_gpc, false);
  v_row public.user_consents;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_key IS NULL OR length(p_key) = 0 THEN
    RAISE EXCEPTION 'invalid_key';
  END IF;
  IF p_version IS NULL OR length(p_version) = 0 THEN
    RAISE EXCEPTION 'invalid_version';
  END IF;

  INSERT INTO public.user_consents AS uc
    (user_id, tenant_id, consent_key, given, version, lang, ip, user_agent, gpc,
     given_at, withdrawn_at)
  VALUES
    (v_uid, v_tenant, p_key, p_given, p_version, p_lang, p_ip, p_user_agent, v_gpc,
     CASE WHEN p_given THEN now() ELSE NULL END,
     CASE WHEN p_given THEN NULL ELSE now() END)
  ON CONFLICT (user_id, consent_key) DO UPDATE
    SET given = EXCLUDED.given,
        version = EXCLUDED.version,
        lang = COALESCE(EXCLUDED.lang, uc.lang),
        ip = EXCLUDED.ip,
        user_agent = EXCLUDED.user_agent,
        gpc = EXCLUDED.gpc,
        given_at = CASE WHEN EXCLUDED.given THEN now() ELSE uc.given_at END,
        withdrawn_at = CASE WHEN EXCLUDED.given THEN NULL ELSE now() END,
        updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.user_consent_events
    (user_id, tenant_id, consent_key, given, version, lang, ip, user_agent, source, gpc,
     banner_version, decision_id, page_url)
  VALUES
    (v_uid, v_tenant, p_key, p_given, p_version, p_lang, p_ip, p_user_agent, p_source, v_gpc,
     NULLIF(left(COALESCE(p_banner_version, ''), 32), ''),
     p_decision_id,
     NULLIF(left(COALESCE(p_page_url, ''), 500), ''));

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_user_consent(text, boolean, text, boolean, text, text, text, text, text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, boolean, text, text, text, text, text, uuid, text) TO authenticated;

-- 3. Podsumowanie administracyjne: pogrupowane decyzje
CREATE OR REPLACE FUNCTION public.admin_consent_decisions(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source text DEFAULT NULL
)
RETURNS TABLE (
  decision_id uuid,
  user_id uuid,
  email text,
  display_name text,
  decided_at timestamptz,
  source text,
  banner_version text,
  lang text,
  gpc boolean,
  page_url text,
  granted_keys text[],
  denied_keys text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS ok
  ),
  grouped AS (
    SELECT
      COALESCE(e.decision_id, e.id) AS decision_id,
      e.user_id,
      max(e.created_at) AS decided_at,
      (array_agg(e.source ORDER BY e.created_at DESC))[1] AS source,
      (array_agg(e.banner_version ORDER BY e.created_at DESC))[1] AS banner_version,
      (array_agg(e.lang ORDER BY e.created_at DESC))[1] AS lang,
      bool_or(COALESCE(e.gpc, false)) AS gpc,
      (array_agg(e.page_url ORDER BY e.created_at DESC))[1] AS page_url,
      array_remove(array_agg(DISTINCT e.consent_key) FILTER (WHERE e.given), NULL) AS granted_keys,
      array_remove(array_agg(DISTINCT e.consent_key) FILTER (WHERE NOT e.given), NULL) AS denied_keys
    FROM public.user_consent_events e, guard g
    WHERE g.ok
      AND e.tenant_id IS NOT DISTINCT FROM public.current_tenant_id()
      AND (p_source IS NULL OR e.source = p_source)
    GROUP BY COALESCE(e.decision_id, e.id), e.user_id
  )
  SELECT
    d.decision_id,
    d.user_id,
    p.email,
    p.display_name,
    d.decided_at,
    d.source,
    d.banner_version,
    d.lang,
    d.gpc,
    d.page_url,
    COALESCE(d.granted_keys, ARRAY[]::text[]),
    COALESCE(d.denied_keys, ARRAY[]::text[])
  FROM grouped d
  LEFT JOIN public.profiles p ON p.id = d.user_id
  ORDER BY d.decided_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

REVOKE ALL ON FUNCTION public.admin_consent_decisions(integer, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_consent_decisions(integer, integer, text) TO authenticated;

-- 4. Zbiorcze statystyki per klucz zgody
CREATE OR REPLACE FUNCTION public.admin_consent_stats(p_days integer DEFAULT 30)
RETURNS TABLE (
  consent_key text,
  granted bigint,
  denied bigint,
  gpc_events bigint,
  last_event_at timestamptz,
  banner_versions text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    e.consent_key,
    count(*) FILTER (WHERE e.given) AS granted,
    count(*) FILTER (WHERE NOT e.given) AS denied,
    count(*) FILTER (WHERE COALESCE(e.gpc, false)) AS gpc_events,
    max(e.created_at) AS last_event_at,
    array_remove(array_agg(DISTINCT e.banner_version), NULL) AS banner_versions
  FROM public.user_consent_events e
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND e.tenant_id IS NOT DISTINCT FROM public.current_tenant_id()
    AND e.created_at >= now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 30), 1), 365))
  GROUP BY e.consent_key
  ORDER BY e.consent_key;
$function$;

REVOKE ALL ON FUNCTION public.admin_consent_stats(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_consent_stats(integer) TO authenticated;