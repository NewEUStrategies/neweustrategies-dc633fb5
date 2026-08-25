DROP FUNCTION IF EXISTS public.admin_event_sponsors_list(uuid, uuid, text, text, text, integer, integer);
CREATE FUNCTION public.admin_event_sponsors_list(
  p_event_id uuid,
  p_tier_id uuid DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_published text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  company_id uuid,
  tier_id uuid,
  tier_key text,
  tier_name_pl text,
  tier_name_en text,
  tier_rank integer,
  tier_accent_color text,
  tier_logo_size text,
  role text,
  booth_label text,
  sort_order integer,
  is_published boolean,
  snapshot_name text,
  snapshot_logo_url text,
  snapshot_description_pl text,
  snapshot_description_en text,
  snapshot_website text,
  snapshot_country text,
  snapshot_source text,
  snapshot_taken_at timestamptz,
  crm_name text,
  crm_logo_url text,
  crm_website text,
  crm_country text,
  crm_city text,
  crm_drift boolean,
  crm_drift_fields text[],
  contacts_count integer,
  materials_count integer,
  published_materials_count integer,
  created_at timestamptz,
  updated_at timestamptz,
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
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.event_id, s.company_id, s.tier_id,
    t.key, t.name_pl, t.name_en, t.rank, t.accent_color, t.logo_size,
    s.role, s.booth_label, s.sort_order, s.is_published,
    s.snapshot_name, s.snapshot_logo_url,
    s.snapshot_description_pl, s.snapshot_description_en,
    s.snapshot_website, s.snapshot_country,
    s.snapshot_source, s.snapshot_taken_at,
    c.name, c.logo_url, public._event_sponsor_web_url(c.website), c.country, c.city,
    (cardinality(d.fields) > 0),
    d.fields,
    COALESCE(k.contacts, 0)::integer,
    COALESCE(m.total, 0)::integer,
    COALESCE(m.published, 0)::integer,
    s.created_at, s.updated_at,
    count(*) OVER ()::integer
  FROM public.event_sponsors s
  JOIN public.crm_companies c
    ON c.id = s.company_id AND c.tenant_id = s.tenant_id
  LEFT JOIN public.event_sponsor_tiers t
    ON t.id = s.tier_id AND t.tenant_id = s.tenant_id
  CROSS JOIN LATERAL (
    SELECT array_remove(ARRAY[
      CASE
        WHEN btrim(s.snapshot_name) IS DISTINCT FROM btrim(c.name) THEN 'name'
      END,
      CASE
        WHEN btrim(COALESCE(s.snapshot_logo_url, ''))
             IS DISTINCT FROM btrim(COALESCE(c.logo_url, '')) THEN 'logo_url'
      END,
      CASE
        WHEN COALESCE(s.snapshot_website, '')
             IS DISTINCT FROM COALESCE(public._event_sponsor_web_url(c.website), '')
          THEN 'website'
      END,
      CASE
        WHEN btrim(COALESCE(s.snapshot_country, ''))
             IS DISTINCT FROM btrim(COALESCE(c.country, '')) THEN 'country'
      END
    ]::text[], NULL) AS fields
  ) d
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS contacts
    FROM public.event_sponsor_contacts k0
    WHERE k0.tenant_id = v_tenant AND k0.sponsor_id = s.id
  ) k ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE m0.is_published)::integer AS published
    FROM public.event_sponsor_materials m0
    WHERE m0.tenant_id = v_tenant AND m0.sponsor_id = s.id
  ) m ON true
  WHERE s.tenant_id = v_tenant
    AND s.event_id = p_event_id
    AND (p_tier_id IS NULL OR s.tier_id = p_tier_id)
    AND (p_role IS NULL OR p_role = 'all' OR s.role = p_role)
    AND (
      p_published IS NULL OR p_published = 'all'
      OR (p_published = 'published' AND s.is_published)
      OR (p_published = 'draft' AND NOT s.is_published)
    )
    AND (
      v_q IS NULL
      OR s.snapshot_name ILIKE '%' || v_q || '%'
      OR c.name ILIKE '%' || v_q || '%'
      OR s.booth_label ILIKE '%' || v_q || '%'
    )
  ORDER BY t.rank DESC NULLS LAST, s.sort_order, s.snapshot_name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsors_list(uuid, uuid, text, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsors_list(uuid, uuid, text, text, text, integer, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsors_list(uuid, uuid, text, text, text, integer, integer) IS
  'Lista sponsorow wydarzenia dla panelu: nazwa i ranga poziomu, status publikacji, biezace wartosci z kartoteki i WYLICZONY rozjazd migawki (crm_drift + crm_drift_fields). Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_detail(uuid);
CREATE FUNCTION public.admin_event_sponsor_detail(_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  company_id uuid,
  tier_id uuid,
  tier_key text,
  tier_name_pl text,
  tier_name_en text,
  tier_rank integer,
  role text,
  booth_label text,
  sort_order integer,
  is_published boolean,
  snapshot_name text,
  snapshot_logo_url text,
  snapshot_description_pl text,
  snapshot_description_en text,
  snapshot_website text,
  snapshot_country text,
  snapshot_source text,
  snapshot_taken_at timestamptz,
  internal_note text,
  crm_name text,
  crm_logo_url text,
  crm_website text,
  crm_country text,
  crm_city text,
  crm_domain text,
  crm_drift_fields text[],
  contacts jsonb,
  materials jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.event_id, s.company_id, s.tier_id,
    t.key, t.name_pl, t.name_en, t.rank,
    s.role, s.booth_label, s.sort_order, s.is_published,
    s.snapshot_name, s.snapshot_logo_url,
    s.snapshot_description_pl, s.snapshot_description_en,
    s.snapshot_website, s.snapshot_country,
    s.snapshot_source, s.snapshot_taken_at, s.internal_note,
    c.name, c.logo_url, public._event_sponsor_web_url(c.website),
    c.country, c.city, c.domain,
    array_remove(ARRAY[
      CASE
        WHEN btrim(s.snapshot_name) IS DISTINCT FROM btrim(c.name) THEN 'name'
      END,
      CASE
        WHEN btrim(COALESCE(s.snapshot_logo_url, ''))
             IS DISTINCT FROM btrim(COALESCE(c.logo_url, '')) THEN 'logo_url'
      END,
      CASE
        WHEN COALESCE(s.snapshot_website, '')
             IS DISTINCT FROM COALESCE(public._event_sponsor_web_url(c.website), '')
          THEN 'website'
      END,
      CASE
        WHEN btrim(COALESCE(s.snapshot_country, ''))
             IS DISTINCT FROM btrim(COALESCE(c.country, '')) THEN 'country'
      END
    ]::text[], NULL),
    COALESCE(k.items, '[]'::jsonb),
    COALESCE(m.items, '[]'::jsonb),
    s.created_at, s.updated_at
  FROM public.event_sponsors s
  JOIN public.crm_companies c
    ON c.id = s.company_id AND c.tenant_id = s.tenant_id
  LEFT JOIN public.event_sponsor_tiers t
    ON t.id = s.tier_id AND t.tenant_id = s.tenant_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', k0.id,
        'lead_id', k0.lead_id,
        'role', k0.role,
        'sort_order', k0.sort_order,
        'first_name', l.first_name,
        'last_name', l.last_name,
        'email', l.email,
        'phone', l.phone,
        'position', l.position,
        'lead_company_id', l.company_id,
        'lead_company_name', lc.name
      ) ORDER BY k0.sort_order, l.last_name, l.first_name
    ) AS items
    FROM public.event_sponsor_contacts k0
    JOIN public.crm_leads l
      ON l.id = k0.lead_id AND l.tenant_id = k0.tenant_id
    LEFT JOIN public.crm_companies lc
      ON lc.id = l.company_id AND lc.tenant_id = l.tenant_id
    WHERE k0.tenant_id = v_tenant AND k0.sponsor_id = s.id
  ) k ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', m0.id,
        'title_pl', m0.title_pl,
        'title_en', m0.title_en,
        'kind', m0.kind,
        'url', m0.url,
        'sort_order', m0.sort_order,
        'is_published', m0.is_published
      ) ORDER BY m0.sort_order, m0.title_pl
    ) AS items
    FROM public.event_sponsor_materials m0
    WHERE m0.tenant_id = v_tenant AND m0.sponsor_id = s.id
  ) m ON true
  WHERE s.tenant_id = v_tenant
    AND s.id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_detail(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_detail(uuid) IS
  'Jedno przypiecie sponsora do formularza panelu: migawka, biezaca kartoteka, rozjazd, notatka wewnetrzna, osoby kontaktowe z danymi NA ZYWO i materialy. Bramka: assert_editor_tenant().';