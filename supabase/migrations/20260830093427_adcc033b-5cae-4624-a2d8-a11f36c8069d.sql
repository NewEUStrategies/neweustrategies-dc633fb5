CREATE OR REPLACE FUNCTION public.event_sections(p_slug text)
RETURNS TABLE (
  section_key text,
  sort_order integer,
  heading_pl text,
  heading_en text,
  visibility text,
  min_tier_rank integer,
  is_locked boolean,
  lock_reason text,
  has_content boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_slug, '')), '');
  v_event public.events;
  v_registered boolean := false;
  v_has_description boolean;
  v_has_agenda boolean;
  v_has_speakers boolean;
  v_has_sponsors boolean;
  v_has_materials boolean;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = v_slug
    AND e.status = 'published';

  IF v_event.id IS NULL THEN
    RETURN;
  END IF;

  IF v_uid IS NOT NULL THEN
    v_registered :=
      EXISTS (
        SELECT 1
        FROM public.event_registrations r
        JOIN public.event_people pe
          ON pe.tenant_id = r.tenant_id AND pe.id = r.person_id
        WHERE r.tenant_id = v_tenant
          AND r.event_id = v_event.id
          AND pe.user_id = v_uid
          AND r.status IN ('approved', 'attended')
      )
      OR EXISTS (
        SELECT 1 FROM public.event_rsvps rs
        WHERE rs.tenant_id = v_tenant
          AND rs.event_id = v_event.id
          AND rs.user_id = v_uid
          AND rs.status = 'going'
      );
  END IF;

  v_has_description :=
    btrim(COALESCE(v_event.description_pl, '')) <> ''
    OR btrim(COALESCE(v_event.description_en, '')) <> '';

  v_has_agenda := EXISTS (
    SELECT 1 FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant
      AND s.event_id = v_event.id
      AND s.status = 'published'
      AND s.is_private = false
  );

  v_has_speakers :=
    EXISTS (
      SELECT 1 FROM public.event_speakers sp
      WHERE sp.event_id = v_event.id
    )
    OR EXISTS (
      SELECT 1 FROM public.event_session_speakers es
      WHERE es.tenant_id = v_tenant AND es.event_id = v_event.id
    );

  v_has_sponsors := EXISTS (
    SELECT 1 FROM public.event_sponsors sn
    WHERE sn.tenant_id = v_tenant
      AND sn.event_id = v_event.id
      AND sn.is_published
  );

  v_has_materials := EXISTS (
    SELECT 1
    FROM public.event_sponsor_materials m
    JOIN public.event_sponsors s
      ON s.id = m.sponsor_id AND s.tenant_id = m.tenant_id
    WHERE m.tenant_id = v_tenant
      AND m.event_id = v_event.id
      AND m.is_published
      AND s.is_published
  );

  RETURN QUERY
  WITH merged AS (
    SELECT
      d.section_key AS k,
      COALESCE(s.is_visible, d.is_visible) AS visible,
      COALESCE(s.sort_order, d.sort_order) AS ord,
      s.heading_pl AS h_pl,
      s.heading_en AS h_en,
      COALESCE(s.visibility, d.visibility) AS vis,
      COALESCE(s.min_tier_rank, d.min_tier_rank) AS rank_min
    FROM public._event_default_sections() d
    LEFT JOIN public.event_page_sections s
      ON s.tenant_id = v_tenant
     AND s.event_id = v_event.id
     AND s.section_key = d.section_key
  ),
  gated AS (
    SELECT
      m.k, m.ord, m.h_pl, m.h_en, m.vis, m.rank_min,
      CASE
        WHEN m.vis = 'authenticated' AND v_uid IS NULL THEN 'auth_required'
        WHEN m.vis = 'registered' AND NOT v_registered THEN 'registration_required'
        WHEN m.vis = 'tier' AND NOT public.has_tier_rank(m.rank_min) THEN 'tier_required'
        WHEN NOT v_registered AND v_event.guest_mode = 'hidden'
          THEN 'registration_required'
        WHEN NOT v_registered AND v_event.guest_mode = 'teaser'
          AND m.k NOT IN ('description', 'agenda', 'registration')
          THEN 'registration_required'
        WHEN NOT v_registered AND v_event.guest_mode = 'full' AND m.k = 'contact'
          THEN 'registration_required'
        ELSE 'none'
      END AS reason
    FROM merged m
    WHERE m.visible
  )
  SELECT
    g.k,
    g.ord,
    g.h_pl,
    g.h_en,
    g.vis,
    g.rank_min,
    (g.reason <> 'none'),
    g.reason,
    CASE g.k
      WHEN 'description' THEN v_has_description
      WHEN 'agenda' THEN v_has_agenda
      WHEN 'speakers' THEN v_has_speakers
      WHEN 'sponsors' THEN v_has_sponsors
      WHEN 'materials' THEN v_has_materials
      WHEN 'registration' THEN (v_event.registration_mode <> 'none')
      WHEN 'map' THEN NULL::boolean
      WHEN 'contact' THEN NULL::boolean
      ELSE NULL
    END
  FROM gated g
  ORDER BY g.ord, g.k;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sections(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_sections(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_sections(text) IS
  'Uklad sekcji strony opublikowanego wydarzenia dla WOLAJACEGO: kolejnosc, nadpisany naglowek, bramka (is_locked + lock_reason z visibility i events.guest_mode) oraz has_content liczony z prawdziwego zrodla kazdej sekcji. Boolean wraca dla szostki, ktora baza umie policzyc: description_pl/_en, event_sessions, event_speakers + event_session_speakers, event_sponsors, event_sponsor_materials (predykat jak w event_sponsor_materials_public) oraz registration_mode. NULL ("nie da sie policzyc") wraca wylacznie dla map i contact - pustke tych dwoch liczy front z tych samych kolumn, z ktorych rysuje tresc (lib/events/eventPractical). Sekcje wylaczone przez redakcje nie wracaja; zamkniete wracaja z powodem.';