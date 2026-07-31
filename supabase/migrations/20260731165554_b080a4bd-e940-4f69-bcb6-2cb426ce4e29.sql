CREATE OR REPLACE FUNCTION public.tmp_fix_slider_author(node jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE k text; v jsonb; out jsonb; el jsonb; arr jsonb;
BEGIN
  IF node IS NULL THEN RETURN node; END IF;
  IF jsonb_typeof(node) = 'array' THEN
    arr := '[]'::jsonb;
    FOR el IN SELECT * FROM jsonb_array_elements(node) LOOP
      arr := arr || jsonb_build_array(public.tmp_fix_slider_author(el));
    END LOOP;
    RETURN arr;
  ELSIF jsonb_typeof(node) = 'object' THEN
    out := node;
    IF node ? 'authorSizePx' OR node ? 'authorAvatarSizePx' OR (node->>'type') = 'slider' THEN
      IF (node ? 'authorSizePx') OR (node->>'type') = 'slider' THEN
        out := jsonb_set(out, '{authorSizePx}', '12'::jsonb, true);
        out := jsonb_set(out, '{authorAvatarSizePx}', '20'::jsonb, true);
      END IF;
    END IF;
    FOR k, v IN SELECT * FROM jsonb_each(out) LOOP
      IF jsonb_typeof(v) IN ('object','array') THEN
        out := jsonb_set(out, ARRAY[k], public.tmp_fix_slider_author(v));
      END IF;
    END LOOP;
    RETURN out;
  END IF;
  RETURN node;
END $$;

UPDATE public.pages SET builder_data = public.tmp_fix_slider_author(builder_data) WHERE builder_data::text LIKE '%authorSizePx%' OR builder_data::text LIKE '%"slider"%';
UPDATE public.posts SET builder_data = public.tmp_fix_slider_author(builder_data) WHERE builder_data::text LIKE '%authorSizePx%' OR builder_data::text LIKE '%"slider"%';
UPDATE public.builder_popups SET builder_data = public.tmp_fix_slider_author(builder_data) WHERE builder_data::text LIKE '%authorSizePx%' OR builder_data::text LIKE '%"slider"%';

DROP FUNCTION public.tmp_fix_slider_author(jsonb);