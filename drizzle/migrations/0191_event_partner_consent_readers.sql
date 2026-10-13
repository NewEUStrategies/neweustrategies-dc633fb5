CREATE OR REPLACE FUNCTION public.admin_event_lead_scans_export(
  p_event_id uuid,
  p_sponsor_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  sponsor_name text,
  first_name text,
  last_name text,
  company text,
  job_title text,
  email text,
  phone text,
  consent boolean,
  consent_snapshot_at timestamptz,
  interest_rating smallint,
  note text,
  scan_count integer,
  first_scanned_at timestamptz,
  last_scanned_at timestamptz,
  device_label text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    sp.snapshot_name,
    CASE WHEN c.ok THEN p.first_name END,
    CASE WHEN c.ok THEN p.last_name END,
    CASE WHEN c.ok THEN COALESCE(NULLIF(btrim(p.company_text), ''), co.name) END,
    CASE WHEN c.ok THEN p.job_title END,
    CASE WHEN c.ok THEN p.email END,
    CASE WHEN c.ok THEN p.phone END,
    c.ok,
    l.consent_snapshot_at,
    l.interest_rating,
    l.note,
    l.scan_count,
    l.first_scanned_at,
    l.last_scanned_at,
    d.label
  FROM public.event_lead_scans l
  JOIN public.event_sponsors sp ON sp.tenant_id = l.tenant_id AND sp.id = l.sponsor_id
  JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
  CROSS JOIN LATERAL (
    SELECT public._event_partner_consent_at(l.tenant_id, l.event_id, l.person_id) IS NOT NULL AS ok
    OFFSET 0
  ) c
  LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_scanner_devices d ON d.tenant_id = l.tenant_id AND d.id = l.device_id
  WHERE l.tenant_id = v_tenant
    AND l.event_id = p_event_id
    AND (p_sponsor_id IS NULL OR l.sponsor_id = p_sponsor_id)
  ORDER BY sp.snapshot_name, l.last_scanned_at DESC
  LIMIT 20000;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_event_lead_scans_list(
  p_event_id uuid,
  p_sponsor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  sponsor_id uuid,
  sponsor_name text,
  person_id uuid,
  first_name text,
  last_name text,
  company text,
  first_scanned_at timestamptz,
  last_scanned_at timestamptz,
  scan_count integer,
  interest_rating smallint,
  note text,
  consent boolean,
  consent_snapshot_at timestamptz,
  device_id uuid,
  device_label text,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  RETURN QUERY
  SELECT
    l.id, l.sponsor_id, sp.snapshot_name,
    l.person_id, p.first_name, p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    l.first_scanned_at, l.last_scanned_at, l.scan_count,
    l.interest_rating, l.note,
    (public._event_partner_consent_at(l.tenant_id, l.event_id, l.person_id) IS NOT NULL),
    l.consent_snapshot_at,
    l.device_id, d.label,
    count(*) OVER ()::integer
  FROM public.event_lead_scans l
  JOIN public.event_sponsors sp ON sp.tenant_id = l.tenant_id AND sp.id = l.sponsor_id
  JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
  LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_scanner_devices d ON d.tenant_id = l.tenant_id AND d.id = l.device_id
  WHERE l.tenant_id = v_tenant
    AND l.event_id = p_event_id
    AND (p_sponsor_id IS NULL OR l.sponsor_id = p_sponsor_id)
  ORDER BY l.last_scanned_at DESC, l.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.event_lead_scans_list(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(NULLIF(p_payload->>'offset', '')::integer, 0), 0);
  v_rows jsonb;
  v_total integer;
  v_with_consent integer;
BEGIN
  SELECT d.* INTO v_device
  FROM public.event_scanner_devices d
  WHERE d.token_hash = encode(digest(btrim(COALESCE(p_payload->>'device_token', '')), 'sha256'), 'hex');

  IF v_device.id IS NULL
     OR v_device.revoked_at IS NOT NULL
     OR NOT v_device.is_active
     OR v_device.expires_at <= now()
     OR (v_device.locked_until IS NOT NULL AND v_device.locked_until > now())
     OR NOT ('lead' = ANY (v_device.scopes)) THEN
    RAISE EXCEPTION 'invalid_device_token: scanner credential is not valid for lead retrieval';
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE public._event_partner_consent_at(l.tenant_id, l.event_id, l.person_id) IS NOT NULL
         )::integer
    INTO v_total, v_with_consent
  FROM public.event_lead_scans l
  WHERE l.tenant_id = v_device.tenant_id
    AND l.sponsor_id = v_device.sponsor_id;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'lead_id', l.id,
      'first_scanned_at', l.first_scanned_at,
      'last_scanned_at', l.last_scanned_at,
      'scan_count', l.scan_count,
      'note', l.note,
      'interest_rating', l.interest_rating,
      'consent', c.ok,
      'first_name', CASE WHEN c.ok THEN p.first_name END,
      'last_name', CASE WHEN c.ok THEN p.last_name END,
      'company', CASE WHEN c.ok THEN COALESCE(NULLIF(btrim(p.company_text), ''), co.name) END,
      'job_title', CASE WHEN c.ok THEN p.job_title END,
      'email', CASE WHEN c.ok THEN p.email END,
      'phone', CASE WHEN c.ok THEN p.phone END
    ) AS x
    FROM public.event_lead_scans l
    JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
    CROSS JOIN LATERAL (
      SELECT public._event_partner_consent_at(l.tenant_id, l.event_id, l.person_id) IS NOT NULL AS ok
      OFFSET 0
    ) c
    LEFT JOIN public.crm_companies co
      ON co.tenant_id = p.tenant_id AND co.id = p.company_id
    WHERE l.tenant_id = v_device.tenant_id
      AND l.sponsor_id = v_device.sponsor_id
    ORDER BY l.last_scanned_at DESC
    LIMIT v_limit OFFSET v_offset
  ) src;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'with_consent_count', v_with_consent,
    'rows', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.event_sponsor_report_for_token(p_tenant uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_link public.event_sponsor_report_links%ROWTYPE;
  v_sponsor public.event_sponsors%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tier public.event_sponsor_tiers%ROWTYPE;
  v_totals jsonb;
  v_leads_summary jsonb;
  v_meetings jsonb;
  v_placements jsonb;
  v_series jsonb;
  v_leads jsonb;
BEGIN
  IF p_tenant IS NULL OR v_token !~ '^[A-Za-z0-9_-]{32}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT k.* INTO v_link
    FROM public.event_sponsor_report_links k
   WHERE k.tenant_id = p_tenant
     AND k.token_hash = encode(digest(v_token, 'sha256'), 'hex');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_link.revoked_at IS NOT NULL OR v_link.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  UPDATE public.event_sponsor_report_links k
     SET view_count = k.view_count + 1, last_seen_at = now()
   WHERE k.tenant_id = p_tenant AND k.id = v_link.id;

  SELECT s.* INTO v_sponsor
    FROM public.event_sponsors s
   WHERE s.tenant_id = p_tenant AND s.id = v_link.sponsor_id;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = p_tenant AND e.id = v_link.event_id;
  SELECT t.* INTO v_tier
    FROM public.event_sponsor_tiers t
   WHERE t.tenant_id = p_tenant AND t.id = v_sponsor.tier_id;

  SELECT jsonb_build_object(
           'views_unique', count(*) FILTER (WHERE x.kind = 'view'),
           'views_total', COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'view'), 0),
           'clicks_unique', count(*) FILTER (WHERE x.kind = 'click'),
           'clicks_total', COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'click'), 0),
           'material_opens', count(*) FILTER (WHERE x.kind = 'material_open')
         )
    INTO v_totals
    FROM public.event_sponsor_exposures x
   WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id;

  SELECT jsonb_build_object(
           'leads_total', count(*),
           'leads_consented', count(*) FILTER (
             WHERE public._event_partner_consent_at(l.tenant_id, l.event_id, l.person_id) IS NOT NULL),
           'lead_scans_total', COALESCE(sum(l.scan_count), 0)
         )
    INTO v_leads_summary
    FROM public.event_lead_scans l
   WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id;

  SELECT jsonb_build_object(
           'meetings_total', count(*) FILTER (WHERE m.status NOT IN ('cancelled', 'rescheduled')),
           'meetings_accepted', count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show')),
           'meetings_held', count(*) FILTER (WHERE m.status = 'held')
         )
    INTO v_meetings
    FROM public.event_meetings m
   WHERE m.tenant_id = p_tenant AND m.event_id = v_link.event_id AND m.sponsor_id = v_link.sponsor_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'placement', g.placement,
           'views_unique', g.vu, 'views_total', g.vt,
           'clicks_unique', g.cu, 'clicks_total', g.ct,
           'material_opens', g.mo
         ) ORDER BY g.placement), '[]'::jsonb)
    INTO v_placements
    FROM (
      SELECT x.placement,
             count(*) FILTER (WHERE x.kind = 'view') AS vu,
             COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'view'), 0) AS vt,
             count(*) FILTER (WHERE x.kind = 'click') AS cu,
             COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'click'), 0) AS ct,
             count(*) FILTER (WHERE x.kind = 'material_open') AS mo
        FROM public.event_sponsor_exposures x
       WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id
       GROUP BY x.placement
    ) g;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', d.dday,
           'views_unique', COALESCE(ev.vu, 0),
           'clicks_unique', COALESCE(ev.cu, 0),
           'material_opens', COALESCE(ev.mo, 0),
           'leads_new', COALESCE(ls.n, 0)
         ) ORDER BY d.dday), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT x.day AS dday
        FROM public.event_sponsor_exposures x
       WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id
      UNION
      SELECT (l.first_scanned_at AT TIME ZONE v_event.timezone)::date
        FROM public.event_lead_scans l
       WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id
    ) d
    LEFT JOIN (
      SELECT x.day AS dday,
             count(*) FILTER (WHERE x.kind = 'view') AS vu,
             count(*) FILTER (WHERE x.kind = 'click') AS cu,
             count(*) FILTER (WHERE x.kind = 'material_open') AS mo
        FROM public.event_sponsor_exposures x
       WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id
       GROUP BY x.day
    ) ev ON ev.dday = d.dday
    LEFT JOIN (
      SELECT (l.first_scanned_at AT TIME ZONE v_event.timezone)::date AS dday, count(*) AS n
        FROM public.event_lead_scans l
       WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id
       GROUP BY 1
    ) ls ON ls.dday = d.dday;

  IF v_link.include_leads THEN
    SELECT COALESCE(jsonb_agg(q.row_json ORDER BY q.last_scanned_at DESC), '[]'::jsonb)
      INTO v_leads
      FROM (
        SELECT l.last_scanned_at,
               jsonb_build_object(
                 'sponsor_name', v_sponsor.snapshot_name,
                 'first_name', CASE WHEN c.ok THEN p.first_name END,
                 'last_name', CASE WHEN c.ok THEN p.last_name END,
                 'company', CASE WHEN c.ok THEN COALESCE(NULLIF(btrim(p.company_text), ''), co.name) END,
                 'job_title', CASE WHEN c.ok THEN p.job_title END,
                 'email', CASE WHEN c.ok THEN p.email END,
                 'phone', CASE WHEN c.ok THEN p.phone END,
                 'consent', c.ok,
                 'consent_snapshot_at', l.consent_snapshot_at,
                 'interest_rating', l.interest_rating,
                 'note', l.note,
                 'scan_count', l.scan_count,
                 'first_scanned_at', l.first_scanned_at,
                 'last_scanned_at', l.last_scanned_at,
                 'device_label', d.label
               ) AS row_json
          FROM public.event_lead_scans l
          JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
          CROSS JOIN LATERAL (
            SELECT public._event_partner_consent_at(l.tenant_id, l.event_id, l.person_id) IS NOT NULL AS ok
            OFFSET 0
          ) c
          LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
          LEFT JOIN public.event_scanner_devices d ON d.tenant_id = l.tenant_id AND d.id = l.device_id
         WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id
         ORDER BY l.last_scanned_at DESC
         LIMIT 5000
      ) q;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'event', jsonb_build_object(
      'slug', v_event.slug,
      'title_pl', v_event.title_pl,
      'title_en', v_event.title_en,
      'timezone', v_event.timezone,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at
    ),
    'sponsor', jsonb_build_object(
      'id', v_sponsor.id,
      'name', v_sponsor.snapshot_name,
      'logo_url', v_sponsor.snapshot_logo_url,
      'role', v_sponsor.role,
      'tier_name_pl', v_tier.name_pl,
      'tier_name_en', v_tier.name_en
    ),
    'link', jsonb_build_object(
      'label', v_link.label,
      'expires_at', v_link.expires_at,
      'include_leads', v_link.include_leads
    ),
    'totals', v_totals || v_leads_summary || v_meetings,
    'placements', v_placements,
    'series', v_series,
    'leads', v_leads
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_summary(
  p_event_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_placement text DEFAULT NULL
)
RETURNS TABLE (
  sponsor_id uuid,
  company_id uuid,
  sponsor_name text,
  sponsor_logo_url text,
  role text,
  tier_id uuid,
  tier_name_pl text,
  tier_name_en text,
  tier_rank integer,
  is_published boolean,
  views_unique integer,
  views_total integer,
  clicks_unique integer,
  clicks_total integer,
  material_opens integer,
  leads_total integer,
  leads_consented integer,
  lead_scans_total integer,
  leads_avg_rating numeric,
  meetings_total integer,
  meetings_accepted integer,
  meetings_held integer,
  active_links integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_tz text;
BEGIN
  PERFORM public._event_sponsor_report_assert_filters(p_from, p_to, p_placement);

  SELECT e.timezone INTO v_tz
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = p_event_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  WITH ex AS (
    SELECT x.sponsor_id AS sid,
           count(*) FILTER (WHERE x.kind = 'view')::integer AS vu,
           COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'view'), 0)::integer AS vt,
           count(*) FILTER (WHERE x.kind = 'click')::integer AS cu,
           COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'click'), 0)::integer AS ct,
           count(*) FILTER (WHERE x.kind = 'material_open')::integer AS mo
      FROM public.event_sponsor_exposures x
     WHERE x.tenant_id = v_tenant AND x.event_id = p_event_id AND x.sponsor_id IS NOT NULL
       AND (p_from IS NULL OR x.day >= p_from)
       AND (p_to IS NULL OR x.day <= p_to)
       AND (p_placement IS NULL OR x.placement = p_placement)
     GROUP BY x.sponsor_id
  ), ld AS (
    SELECT l.sponsor_id AS sid,
           count(*)::integer AS total,
           count(*) FILTER (
             WHERE public._event_partner_consent_at(l.tenant_id, l.event_id, l.person_id) IS NOT NULL
           )::integer AS consented,
           COALESCE(sum(l.scan_count), 0)::integer AS scans,
           round(avg(l.interest_rating), 2) AS rating
      FROM public.event_lead_scans l
     WHERE l.tenant_id = v_tenant AND l.event_id = p_event_id
       AND (p_from IS NULL OR (l.first_scanned_at AT TIME ZONE v_tz)::date >= p_from)
       AND (p_to IS NULL OR (l.first_scanned_at AT TIME ZONE v_tz)::date <= p_to)
     GROUP BY l.sponsor_id
  ), mt AS (
    SELECT m.sponsor_id AS sid,
           count(*) FILTER (WHERE m.status NOT IN ('cancelled', 'rescheduled'))::integer AS total,
           count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show'))::integer AS accepted,
           count(*) FILTER (WHERE m.status = 'held')::integer AS held
      FROM public.event_meetings m
     WHERE m.tenant_id = v_tenant AND m.event_id = p_event_id AND m.sponsor_id IS NOT NULL
       AND (p_from IS NULL OR (m.starts_at AT TIME ZONE v_tz)::date >= p_from)
       AND (p_to IS NULL OR (m.starts_at AT TIME ZONE v_tz)::date <= p_to)
     GROUP BY m.sponsor_id
  ), lk AS (
    SELECT k.sponsor_id AS sid, count(*)::integer AS active
      FROM public.event_sponsor_report_links k
     WHERE k.tenant_id = v_tenant AND k.event_id = p_event_id
       AND k.revoked_at IS NULL AND k.expires_at > now()
     GROUP BY k.sponsor_id
  )
  SELECT s.id, s.company_id, s.snapshot_name, s.snapshot_logo_url, s.role,
         s.tier_id, t.name_pl, t.name_en, t.rank, s.is_published,
         COALESCE(ex.vu, 0), COALESCE(ex.vt, 0), COALESCE(ex.cu, 0), COALESCE(ex.ct, 0),
         COALESCE(ex.mo, 0),
         COALESCE(ld.total, 0), COALESCE(ld.consented, 0), COALESCE(ld.scans, 0), ld.rating,
         COALESCE(mt.total, 0), COALESCE(mt.accepted, 0), COALESCE(mt.held, 0),
         COALESCE(lk.active, 0)
    FROM public.event_sponsors s
    LEFT JOIN public.event_sponsor_tiers t ON t.tenant_id = s.tenant_id AND t.id = s.tier_id
    LEFT JOIN ex ON ex.sid = s.id
    LEFT JOIN ld ON ld.sid = s.id
    LEFT JOIN mt ON mt.sid = s.id
    LEFT JOIN lk ON lk.sid = s.id
   WHERE s.tenant_id = v_tenant AND s.event_id = p_event_id
   ORDER BY t.rank DESC NULLS LAST, s.sort_order, s.snapshot_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_leads_series(
  p_event_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_sponsor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  day date,
  sponsor_id uuid,
  leads_new integer,
  leads_new_consented integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_tz text;
BEGIN
  PERFORM public._event_sponsor_report_assert_filters(p_from, p_to, NULL);

  SELECT e.timezone INTO v_tz
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = p_event_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  WITH d AS (
    SELECT (l.first_scanned_at AT TIME ZONE v_tz)::date AS dday,
           l.sponsor_id AS sid,
           (public._event_partner_consent_at(l.tenant_id, l.event_id, l.person_id) IS NOT NULL) AS ok
      FROM public.event_lead_scans l
     WHERE l.tenant_id = v_tenant AND l.event_id = p_event_id
       AND (p_sponsor_id IS NULL OR l.sponsor_id = p_sponsor_id)
  )
  SELECT d.dday, d.sid, count(*)::integer, count(*) FILTER (WHERE d.ok)::integer
    FROM d
   WHERE (p_from IS NULL OR d.dday >= p_from) AND (p_to IS NULL OR d.dday <= p_to)
   GROUP BY d.dday, d.sid
   ORDER BY d.dday, d.sid;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_event_company_sponsorships(p_company_id uuid)
RETURNS TABLE (
  event_id uuid,
  event_slug text,
  event_title_pl text,
  event_title_en text,
  event_starts_at timestamptz,
  event_timezone text,
  event_status text,
  sponsor_id uuid,
  role text,
  tier_name_pl text,
  tier_name_en text,
  is_published boolean,
  views_unique integer,
  clicks_unique integer,
  material_opens integer,
  leads_total integer,
  leads_consented integer,
  meetings_held integer,
  active_links integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT e.id, e.slug, e.title_pl, e.title_en, e.starts_at, e.timezone, e.status,
         s.id, s.role, t.name_pl, t.name_en, s.is_published,
         (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.sponsor_id = s.id AND x.kind = 'view')::integer,
         (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.sponsor_id = s.id AND x.kind = 'click')::integer,
         (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.sponsor_id = s.id AND x.kind = 'material_open')::integer,
         (SELECT count(*) FROM public.event_lead_scans l
           WHERE l.tenant_id = v_tenant AND l.sponsor_id = s.id)::integer,
         (SELECT count(*) FROM public.event_lead_scans l
           WHERE l.tenant_id = v_tenant AND l.sponsor_id = s.id
             AND public._event_partner_consent_at(l.tenant_id, l.event_id, l.person_id) IS NOT NULL)::integer,
         (SELECT count(*) FROM public.event_meetings m
           WHERE m.tenant_id = v_tenant AND m.sponsor_id = s.id AND m.status = 'held')::integer,
         (SELECT count(*) FROM public.event_sponsor_report_links k
           WHERE k.tenant_id = v_tenant AND k.sponsor_id = s.id
             AND k.revoked_at IS NULL AND k.expires_at > now())::integer
    FROM public.event_sponsors s
    JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
    LEFT JOIN public.event_sponsor_tiers t ON t.tenant_id = s.tenant_id AND t.id = s.tier_id
   WHERE s.tenant_id = v_tenant AND s.company_id = p_company_id
   ORDER BY e.starts_at DESC, e.id
   LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_event_onsite_stats(
  p_event_id uuid,
  p_bucket_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_bucket integer := LEAST(GREATEST(COALESCE(p_bucket_minutes, 15), 5), 240);
  v_registered integer;
  v_arrived integer;
  v_arrived_reg integer;
  v_walk_in integer;
  v_denied integer;
  v_repeats integer;
  v_failed integer;
  v_badge_people integer;
  v_badge_copies integer;
  v_leads integer;
  v_leads_consent integer;
  v_denied_breakdown jsonb;
  v_histogram jsonb;
  v_checkpoints jsonb;
  v_devices jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  SELECT count(*)::integer INTO v_registered
  FROM public.event_registrations r
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
    AND r.status IN ('approved', 'attended', 'no_show');

  SELECT
    count(DISTINCT c.person_id)::integer,
    count(DISTINCT c.person_id) FILTER (WHERE c.registration_id IS NOT NULL)::integer,
    count(DISTINCT c.person_id) FILTER (WHERE c.registration_id IS NULL)::integer
  INTO v_arrived, v_arrived_reg, v_walk_in
  FROM public.event_checkins c
  WHERE c.tenant_id = v_tenant
    AND c.event_id = p_event_id
    AND c.result = 'granted'
    AND c.direction = 'in';

  SELECT
    count(*) FILTER (WHERE c.result <> 'granted')::integer,
    COALESCE(sum(c.repeat_count), 0)::integer
  INTO v_denied, v_repeats
  FROM public.event_checkins c
  WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id;

  SELECT COALESCE(jsonb_object_agg(x.result, x.cnt), '{}'::jsonb) INTO v_denied_breakdown
  FROM (
    SELECT c.result, count(*)::integer AS cnt
    FROM public.event_checkins c
    WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id AND c.result <> 'granted'
    GROUP BY c.result
  ) x;

  SELECT COALESCE(sum(d.failed_scan_count), 0)::integer INTO v_failed
  FROM public.event_scanner_devices d
  WHERE d.tenant_id = v_tenant AND d.event_id = p_event_id;

  SELECT count(DISTINCT bp.person_id)::integer, COALESCE(sum(bp.copies), 0)::integer
  INTO v_badge_people, v_badge_copies
  FROM public.event_badge_prints bp
  WHERE bp.tenant_id = v_tenant AND bp.event_id = p_event_id;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE public._event_partner_consent_at(l.tenant_id, l.event_id, l.person_id) IS NOT NULL
    )::integer
  INTO v_leads, v_leads_consent
  FROM public.event_lead_scans l
  WHERE l.tenant_id = v_tenant AND l.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket_at', b.bucket_at,
    'granted_in', b.granted_in,
    'granted_out', b.granted_out,
    'denied', b.denied
  ) ORDER BY b.bucket_at), '[]'::jsonb) INTO v_histogram
  FROM (
    SELECT
      to_timestamp(
        floor(extract(epoch FROM c.occurred_at) / (v_bucket * 60)) * (v_bucket * 60)
      ) AS bucket_at,
      count(*) FILTER (WHERE c.result = 'granted' AND c.direction = 'in')::integer AS granted_in,
      count(*) FILTER (WHERE c.result = 'granted' AND c.direction = 'out')::integer AS granted_out,
      count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied
    FROM public.event_checkins c
    WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id
    GROUP BY 1
  ) b;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'checkpoint_id', s.id,
    'name_pl', s.name_pl,
    'name_en', s.name_en,
    'kind', s.kind,
    'access_mode', s.access_mode,
    'capacity', s.capacity,
    'occupancy', s.occupancy,
    'granted', s.granted,
    'denied', s.denied,
    'unique_people', s.unique_people,
    'last_checkin_at', s.last_at
  ) ORDER BY s.sort_order, s.name_pl), '[]'::jsonb) INTO v_checkpoints
  FROM (
    SELECT
      cp.id, cp.name_pl, cp.name_en, cp.kind, cp.access_mode, cp.capacity, cp.sort_order,
      public._event_checkpoint_occupancy(v_tenant, cp.id) AS occupancy,
      COALESCE(a.granted, 0)::integer AS granted,
      COALESCE(a.denied, 0)::integer AS denied,
      COALESCE(a.people, 0)::integer AS unique_people,
      a.last_at
    FROM public.event_checkpoints cp
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE c.result = 'granted')::integer AS granted,
        count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied,
        count(DISTINCT c.person_id) FILTER (WHERE c.result = 'granted')::integer AS people,
        max(c.occurred_at) AS last_at
      FROM public.event_checkins c
      WHERE c.tenant_id = cp.tenant_id AND c.checkpoint_id = cp.id
    ) a ON true
    WHERE cp.tenant_id = v_tenant AND cp.event_id = p_event_id
  ) s;

  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'active', count(*) FILTER (
      WHERE d.revoked_at IS NULL AND d.is_active AND d.expires_at > now()
        AND (d.locked_until IS NULL OR d.locked_until <= now())
    )::integer,
    'locked', count(*) FILTER (WHERE d.locked_until IS NOT NULL AND d.locked_until > now())::integer,
    'revoked', count(*) FILTER (WHERE d.revoked_at IS NOT NULL)::integer,
    'expired', count(*) FILTER (WHERE d.revoked_at IS NULL AND d.expires_at <= now())::integer
  ) INTO v_devices
  FROM public.event_scanner_devices d
  WHERE d.tenant_id = v_tenant AND d.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'bucket_minutes', v_bucket,
    'registered_total', v_registered,
    'arrived_total', v_arrived,
    'arrived_registered', v_arrived_reg,
    'walk_in_total', v_walk_in,
    'attendance_rate', CASE
      WHEN v_registered > 0
      THEN round((v_arrived_reg::numeric / v_registered::numeric) * 100, 1)
      ELSE NULL
    END,
    'no_show_total', GREATEST(v_registered - v_arrived_reg, 0),
    'denied_total', v_denied,
    'denied_by_reason', v_denied_breakdown,
    'repeat_total', v_repeats,
    'failed_resolve_total', v_failed,
    'badges_printed_people', v_badge_people,
    'badges_printed_copies', v_badge_copies,
    'lead_scans_total', v_leads,
    'lead_scans_with_consent', v_leads_consent,
    'histogram', v_histogram,
    'checkpoints', v_checkpoints,
    'devices', v_devices
  );
END;
$$;

COMMENT ON FUNCTION public.admin_event_lead_scans_export(uuid, uuid) IS
  'Eksport leadow wystawcow (plik dla sponsora). Zgoda = _event_partner_consent_at() na wydarzenie leada. Bez zgody NULL w imieniu, nazwisku, firmie, stanowisku, e-mailu i telefonie; zostaja sponsor, zgoda, ocena, notatka obslugi stoiska, liczniki i urzadzenie.';

COMMENT ON FUNCTION public.event_lead_scans_list(jsonb) IS
  'Leady WLASNEGO sponsora urzadzenia. Payload: {device_token, limit?, offset?}. Nie przyjmuje sponsor_id - wlasciciel jest tozsamoscia poswiadczenia. Tozsamosc i kontakt uczestnika sa oddawane WYLACZNIE przy zgodzie na TO wydarzenie (_event_partner_consent_at); wiersz bez zgody zostaje policzony, ale bez danych osoby.';

COMMENT ON FUNCTION public.event_sponsor_report_for_token(uuid, text) IS
  'Raport sponsora po tokenie linku: {ok:false, reason:not_found|expired} albo {ok:true, event, sponsor, link, totals, placements, series, leads}. Wylacznie service_role - najemca z zaufanego hosta, limit prob po IP po stronie serwera. Podbija view_count i last_seen_at. Dane osoby tylko przy zgodzie na przekazanie partnerom TEGO wydarzenia (_event_partner_consent_at).';