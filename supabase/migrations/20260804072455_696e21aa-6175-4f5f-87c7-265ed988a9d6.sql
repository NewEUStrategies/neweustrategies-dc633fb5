DO $$
DECLARE
  page_id uuid := '3ba8b617-c654-4ff0-b00f-ece24dabb335';
  col_children jsonb;
  new_children jsonb := '[]'::jsonb;
  item jsonb;
BEGIN
  SELECT builder_data->'sections'->2->'children'->1->'children'
  INTO col_children
  FROM public.pages
  WHERE id = page_id;

  IF col_children IS NULL THEN
    RETURN;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(col_children)
  LOOP
    IF item->>'id' <> 'w-newsletter' THEN
      new_children := new_children || item;
    END IF;
  END LOOP;

  UPDATE public.pages
  SET builder_data = jsonb_set(
    builder_data,
    '{sections,2,children,1,children}',
    new_children
  )
  WHERE id = page_id;
END $$;
