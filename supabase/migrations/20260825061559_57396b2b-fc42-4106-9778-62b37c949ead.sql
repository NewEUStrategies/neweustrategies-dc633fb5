DROP FUNCTION IF EXISTS public.admin_event_badge_templates_list(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_badge_templates_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  name text,
  paper_format text,
  width_mm numeric,
  height_mm numeric,
  orientation text,
  double_fold boolean,
  background_color text,
  background_image_url text,
  show_qr boolean,
  qr_size_mm numeric,
  elements jsonb,
  version integer,
  is_default boolean,
  prints_count integer,
  printed_people_count integer,
  last_printed_at timestamptz,
  stale_prints_count integer,
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
    t.id, t.event_id, t.name, t.paper_format, t.width_mm, t.height_mm,
    t.orientation, t.double_fold, t.background_color, t.background_image_url,
    t.show_qr, t.qr_size_mm, t.elements, t.version, t.is_default,
    COALESCE(pr.cnt, 0)::integer,
    COALESCE(pr.people, 0)::integer,
    pr.last_at,
    COALESCE(pr.stale, 0)::integer,
    t.created_at, t.updated_at
  FROM public.event_badge_templates t
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS cnt,
      count(DISTINCT bp.person_id)::integer AS people,
      count(*) FILTER (WHERE bp.template_version < t.version)::integer AS stale,
      max(bp.printed_at) AS last_at
    FROM public.event_badge_prints bp
    WHERE bp.tenant_id = t.tenant_id AND bp.template_id = t.id
  ) pr ON true
  WHERE t.tenant_id = v_tenant
    AND t.event_id = p_event_id
  ORDER BY t.is_default DESC, t.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_badge_templates_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_templates_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_badge_templates_list(uuid) IS
  'Szablony identyfikatora wydarzenia z licznikiem wydrukow i licznikiem wydrukow ze STARSZEJ wersji ukladu (kogo trzeba przedrukowac). Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_badge_template_save(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_badge_template_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_name text := btrim(COALESCE(p_payload->>'name', ''));
  v_format text := lower(btrim(COALESCE(p_payload->>'paper_format', 'a6')));
  v_orientation text := lower(btrim(COALESCE(p_payload->>'orientation', 'portrait')));
  v_width numeric := NULLIF(p_payload->>'width_mm', '')::numeric;
  v_height numeric := NULLIF(p_payload->>'height_mm', '')::numeric;
  v_bg text := NULLIF(btrim(COALESCE(p_payload->>'background_color', '')), '');
  v_bg_url text := NULLIF(btrim(COALESCE(p_payload->>'background_image_url', '')), '');
  v_show_qr boolean := COALESCE(NULLIF(p_payload->>'show_qr', '')::boolean, true);
  v_qr_size numeric := COALESCE(NULLIF(p_payload->>'qr_size_mm', '')::numeric, 25.00);
  v_fold boolean := COALESCE(NULLIF(p_payload->>'double_fold', '')::boolean, false);
  v_default boolean := COALESCE(NULLIF(p_payload->>'is_default', '')::boolean, false);
  v_elements jsonb := CASE
    WHEN jsonb_typeof(p_payload->'elements') = 'array' THEN p_payload->'elements'
    ELSE '[]'::jsonb
  END;
  v_element jsonb;
  v_kind text;
  v_existing public.event_badge_templates;
  v_layout_changed boolean := true;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT t.* INTO v_existing
    FROM public.event_badge_templates t
    WHERE t.id = v_id AND t.tenant_id = v_tenant;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'not_found: badge template does not exist in this organisation';
    END IF;
    v_event_id := v_existing.event_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF char_length(v_name) < 2 THEN
    RAISE EXCEPTION 'invalid_name: the template name must have at least 2 characters';
  END IF;

  IF v_format NOT IN ('a4', 'a5', 'a6', 'a7', 'badge_90x54', 'badge_100x150', 'custom') THEN
    RAISE EXCEPTION 'invalid_paper_format: unknown paper format %', v_format;
  END IF;

  IF v_orientation NOT IN ('portrait', 'landscape') THEN
    RAISE EXCEPTION 'invalid_orientation: orientation must be portrait or landscape';
  END IF;

  IF v_format = 'custom' THEN
    IF v_width IS NULL OR v_height IS NULL THEN
      RAISE EXCEPTION 'custom_dimensions_required: a custom format needs width_mm and height_mm';
    END IF;
    IF v_width NOT BETWEEN 20 AND 420 OR v_height NOT BETWEEN 20 AND 420 THEN
      RAISE EXCEPTION 'invalid_dimensions: each side must be between 20 and 420 mm';
    END IF;
  ELSE
    v_width := NULL;
    v_height := NULL;
  END IF;

  IF v_qr_size NOT BETWEEN 10 AND 100 THEN
    RAISE EXCEPTION 'invalid_qr_size: the QR side must be between 10 and 100 mm';
  END IF;

  IF v_bg IS NOT NULL AND v_bg !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'invalid_background_color: the colour must be written as #rrggbb';
  END IF;

  IF v_bg_url IS NOT NULL AND v_bg_url !~ '^(https?://|/)' THEN
    RAISE EXCEPTION 'invalid_background_url: the address must be absolute or start with /';
  END IF;

  IF jsonb_array_length(v_elements) > 40 THEN
    RAISE EXCEPTION 'too_many_elements: a template can hold at most 40 blocks';
  END IF;

  FOR v_element IN SELECT * FROM jsonb_array_elements(v_elements) LOOP
    IF jsonb_typeof(v_element) <> 'object' THEN
      RAISE EXCEPTION 'invalid_element: every layout block must be an object';
    END IF;

    v_kind := lower(btrim(COALESCE(v_element->>'kind', '')));
    IF v_kind NOT IN ('text', 'field', 'image', 'qr', 'sponsors', 'spacer') THEN
      RAISE EXCEPTION 'invalid_element_kind: unknown block kind %', v_kind;
    END IF;

    IF v_kind = 'field' AND lower(btrim(COALESCE(v_element->>'field', ''))) NOT IN (
      'first_name', 'last_name', 'full_name', 'company', 'job_title',
      'ticket_name', 'group_name', 'event_title', 'event_dates'
    ) THEN
      RAISE EXCEPTION 'invalid_element_field: unknown participant field %', v_element->>'field';
    END IF;

    IF v_kind = 'text' AND btrim(COALESCE(v_element->>'text', '')) = '' THEN
      RAISE EXCEPTION 'invalid_element_text: a text block cannot be empty';
    END IF;

    IF v_kind = 'image' AND COALESCE(v_element->>'url', '') !~ '^(https?://|/)' THEN
      RAISE EXCEPTION 'invalid_element_url: an image block needs an absolute address or one starting with /';
    END IF;

    IF v_element ? 'font_size_pt'
       AND (v_element->>'font_size_pt')::numeric NOT BETWEEN 5 AND 96 THEN
      RAISE EXCEPTION 'invalid_element_font_size: the font size must be between 5 and 96 pt';
    END IF;

    IF v_element ? 'width_percent'
       AND (v_element->>'width_percent')::numeric NOT BETWEEN 5 AND 100 THEN
      RAISE EXCEPTION 'invalid_element_width: the block width must be between 5 and 100 percent';
    END IF;

    IF v_element ? 'align'
       AND lower(COALESCE(v_element->>'align', '')) NOT IN ('left', 'center', 'right') THEN
      RAISE EXCEPTION 'invalid_element_align: alignment must be left, center or right';
    END IF;
  END LOOP;

  IF v_id IS NULL THEN
    INSERT INTO public.event_badge_templates (
      tenant_id, event_id, name, paper_format, width_mm, height_mm, orientation,
      double_fold, background_color, background_image_url, show_qr, qr_size_mm,
      elements, version, is_default, created_by
    ) VALUES (
      v_tenant, v_event_id, v_name, v_format, v_width, v_height, v_orientation,
      v_fold, v_bg, v_bg_url, v_show_qr, v_qr_size,
      v_elements, 1, false, auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    v_layout_changed := (
      v_existing.paper_format IS DISTINCT FROM v_format
      OR v_existing.width_mm IS DISTINCT FROM v_width
      OR v_existing.height_mm IS DISTINCT FROM v_height
      OR v_existing.orientation IS DISTINCT FROM v_orientation
      OR v_existing.double_fold IS DISTINCT FROM v_fold
      OR v_existing.background_color IS DISTINCT FROM v_bg
      OR v_existing.background_image_url IS DISTINCT FROM v_bg_url
      OR v_existing.show_qr IS DISTINCT FROM v_show_qr
      OR v_existing.qr_size_mm IS DISTINCT FROM v_qr_size
      OR v_existing.elements IS DISTINCT FROM v_elements
    );

    UPDATE public.event_badge_templates SET
      name = v_name,
      paper_format = v_format,
      width_mm = v_width,
      height_mm = v_height,
      orientation = v_orientation,
      double_fold = v_fold,
      background_color = v_bg,
      background_image_url = v_bg_url,
      show_qr = v_show_qr,
      qr_size_mm = v_qr_size,
      elements = v_elements,
      version = version + CASE WHEN v_layout_changed THEN 1 ELSE 0 END
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  IF v_default THEN
    UPDATE public.event_badge_templates
    SET is_default = false
    WHERE tenant_id = v_tenant AND event_id = v_event_id AND id <> v_id AND is_default;

    UPDATE public.event_badge_templates
    SET is_default = true
    WHERE tenant_id = v_tenant AND id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_badge_template_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_template_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_badge_template_save(jsonb) IS
  'Dodanie albo edycja szablonu identyfikatora, razem z walidacja slownika blokow ukladu. Wersja rosnie tylko przy zmianie czegokolwiek WIDOCZNEGO na kartce. Payload jsonb. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_badge_template_delete(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_badge_template_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_badge_templates t
    WHERE t.id = _id AND t.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: badge template does not exist in this organisation';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_badge_prints bp
  WHERE bp.tenant_id = v_tenant AND bp.template_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'template_in_use: % badge print(s) were made from this template', v_used;
  END IF;

  DELETE FROM public.event_badge_templates WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_badge_template_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_template_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_badge_template_delete(uuid) IS
  'Usuniecie szablonu identyfikatora. Odrzucane, gdy z szablonu cokolwiek wydrukowano - wydruk jest dowodem wydania. Bramka: assert_editor_tenant().';