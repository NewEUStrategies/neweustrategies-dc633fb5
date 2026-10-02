CREATE OR REPLACE FUNCTION public.save_menu_items(p_menu_key text, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_menu_id uuid;
  v_saved integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR public.has_role(v_uid, 'editor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: staff role required' USING ERRCODE = '42501';
  END IF;

  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: caller has no tenant' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be an array' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
       OR NULLIF(e.item ->> 'local_id', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_payload: local_id is required for every item' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS e(item)
    GROUP BY e.item ->> 'local_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'invalid_payload: duplicate local_id' USING ERRCODE = '22023';
  END IF;

  SELECT m.id INTO v_menu_id
  FROM public.menus m
  WHERE m.tenant_id = v_tenant
    AND m.key = p_menu_key
  FOR UPDATE;

  IF v_menu_id IS NULL THEN
    RAISE EXCEPTION 'menu_not_found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.menu_items mi WHERE mi.menu_id = v_menu_id;

  WITH RECURSIVE src AS MATERIALIZED (
    SELECT
      e.item,
      e.item ->> 'local_id' AS local_id,
      NULLIF(e.item ->> 'parent_local_id', '') AS parent_local_id,
      gen_random_uuid() AS id
    FROM jsonb_array_elements(p_items) AS e(item)
  ),
  linked AS (
    SELECT s.id, s.item, p.id AS parent_id
    FROM src s
    LEFT JOIN src p ON p.local_id = s.parent_local_id
  ),
  tree AS (
    SELECT l.id, l.parent_id, l.item, 0 AS depth
    FROM linked l
    WHERE l.parent_id IS NULL
    UNION ALL
    SELECT l.id, l.parent_id, l.item, t.depth + 1
    FROM linked l
    JOIN tree t ON l.parent_id = t.id
  )
  INSERT INTO public.menu_items (
    id, menu_id, parent_id, position, item_type, ref_id,
    label_pl, label_en, href, target, css_class, visibility, icon,
    mega_enabled, mega_config
  )
  SELECT
    t.id,
    v_menu_id,
    t.parent_id,
    COALESCE((t.item ->> 'position')::integer, 0),
    (t.item ->> 'item_type')::public.menu_item_type,
    NULLIF(t.item ->> 'ref_id', '')::uuid,
    COALESCE(t.item ->> 'label_pl', ''),
    COALESCE(t.item ->> 'label_en', ''),
    COALESCE(t.item ->> 'href', ''),
    COALESCE(NULLIF(t.item ->> 'target', ''), '_self'),
    COALESCE(t.item ->> 'css_class', ''),
    COALESCE(NULLIF(t.item ->> 'visibility', ''), 'all'),
    COALESCE(t.item ->> 'icon', ''),
    COALESCE((t.item ->> 'mega_enabled')::boolean, false),
    CASE
      WHEN jsonb_typeof(t.item -> 'mega_config') = 'object' THEN t.item -> 'mega_config'
      ELSE '{}'::jsonb
    END
  FROM tree t
  ORDER BY t.depth;

  GET DIAGNOSTICS v_saved = ROW_COUNT;
  RETURN v_saved;
END;
$$;

COMMENT ON FUNCTION public.save_menu_items(text, jsonb) IS
  'Zapisuje CAŁE drzewo pozycji menu (klucz w tenancie domowym wołającego) w JEDNEJ transakcji: kasuje stare pozycje i wstawia nowe albo nie zmienia niczego. p_items: [{local_id, parent_local_id, position, item_type, ref_id, label_pl, label_en, href, target, css_class, visibility, icon, mega_enabled, mega_config}]. UUID i rodziców mapuje baza; sierota ląduje na najwyższym poziomie, pozycja w pierścieniu nie jest zapisywana. Bramka: admin albo editor w tenancie domowym. Zwraca liczbę zapisanych pozycji.';

REVOKE ALL ON FUNCTION public.save_menu_items(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_menu_items(text, jsonb) TO authenticated;