CREATE OR REPLACE FUNCTION public.admin_club_topic_upsert(
  _key text,
  _label_pl text,
  _label_en text,
  _sort_order integer DEFAULT 100,
  _is_active boolean DEFAULT true,
  _id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_key text := lower(btrim(COALESCE(_key, '')));
  v_id uuid;
BEGIN
  IF _id IS NOT NULL THEN
    SELECT ct.id, ct.key INTO v_id, v_key
    FROM public.club_topics ct
    WHERE ct.id = _id AND ct.tenant_id = v_tenant;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: topic does not exist in this tenant';
    END IF;

    UPDATE public.club_topics
    SET label_pl = btrim(_label_pl),
        label_en = btrim(_label_en),
        sort_order = COALESCE(_sort_order, sort_order),
        is_active = COALESCE(_is_active, is_active)
    WHERE id = v_id;

    RETURN v_id;
  END IF;

  IF v_key = '' THEN
    RAISE EXCEPTION 'invalid_key: key is required';
  END IF;

  INSERT INTO public.club_topics (tenant_id, key, label_pl, label_en, sort_order, is_active, is_system)
  VALUES (v_tenant, v_key, btrim(_label_pl), btrim(_label_en), COALESCE(_sort_order, 100), COALESCE(_is_active, true), false)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_club_topic_upsert(uuid, text, text, text, integer, boolean);

GRANT EXECUTE ON FUNCTION public.admin_club_topic_upsert(text, text, text, integer, boolean, uuid) TO authenticated, service_role;