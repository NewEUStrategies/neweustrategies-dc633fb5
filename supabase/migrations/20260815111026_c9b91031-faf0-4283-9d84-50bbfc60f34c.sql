CREATE OR REPLACE FUNCTION public.club_anchor_label(p_type text, p_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
BEGIN
  IF p_type IS NULL OR NULLIF(btrim(COALESCE(p_id, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;

  CASE p_type
    WHEN 'eu_policy_item' THEN
      SELECT COALESCE(NULLIF(btrim(i.title_pl), ''), NULLIF(btrim(i.title_en), ''))
        INTO v_label FROM public.eu_policy_items i WHERE i.id = p_id::uuid;
    WHEN 'post' THEN
      SELECT COALESCE(NULLIF(btrim(p.title_pl), ''), NULLIF(btrim(p.title_en), ''), p.slug)
        INTO v_label FROM public.posts p
       WHERE p.id = p_id::uuid AND p.deleted_at IS NULL;
    WHEN 'event' THEN
      SELECT COALESCE(NULLIF(btrim(e.title_pl), ''), NULLIF(btrim(e.title_en), ''), e.slug)
        INTO v_label FROM public.events e WHERE e.id = p_id::uuid;
    WHEN 'research_program' THEN
      SELECT COALESCE(NULLIF(btrim(r.name_pl), ''), NULLIF(btrim(r.name_en), ''), r.slug)
        INTO v_label FROM public.programs r WHERE r.id = p_id::uuid;
    WHEN 'club_thread' THEN
      v_label := public.club_linked_item_label('club_thread', p_id);
    ELSE
      v_label := NULL;
  END CASE;

  RETURN v_label;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;