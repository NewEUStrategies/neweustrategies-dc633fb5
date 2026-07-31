CREATE OR REPLACE FUNCTION public.tmp_set_slider_author_size(node jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v jsonb; out jsonb;
BEGIN
  IF jsonb_typeof(node) = 'object' THEN
    out := node;
    IF node->>'type' = 'slider' AND node ? 'content' THEN
      out := jsonb_set(out, '{content,authorSizePx}', '10'::jsonb, true);
    END IF;
    FOR k, v IN SELECT * FROM jsonb_each(out) LOOP
      IF jsonb_typeof(v) IN ('object','array') THEN
        out := jsonb_set(out, ARRAY[k], public.tmp_set_slider_author_size(v), true);
      END IF;
    END LOOP;
    RETURN out;
  ELSIF jsonb_typeof(node) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(public.tmp_set_slider_author_size(e)), '[]'::jsonb) FROM jsonb_array_elements(node) e);
  END IF;
  RETURN node;
END $$;

UPDATE public.pages SET builder_data = public.tmp_set_slider_author_size(builder_data)
WHERE builder_data::text LIKE '%"slider%';
UPDATE public.posts SET builder_data = public.tmp_set_slider_author_size(builder_data)
WHERE builder_data::text LIKE '%"slider%';
UPDATE public.builder_popups SET builder_data = public.tmp_set_slider_author_size(builder_data)
WHERE builder_data::text LIKE '%"slider%';

DROP FUNCTION public.tmp_set_slider_author_size(jsonb);