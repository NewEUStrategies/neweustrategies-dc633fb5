
-- 1) Fix resolve_path: track last successful iteration explicitly
CREATE OR REPLACE FUNCTION public.resolve_path(_segments text[])
 RETURNS TABLE(page_id uuid, post_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parent uuid := NULL;
  v_current uuid := NULL;
  v_seg text;
  v_last int := 0;
  v_len int;
  i int;
  v_post uuid;
BEGIN
  IF _segments IS NULL OR array_length(_segments, 1) IS NULL THEN
    RETURN;
  END IF;
  v_len := array_length(_segments, 1);

  -- Try full path as pages
  FOR i IN 1 .. v_len LOOP
    v_seg := _segments[i];
    SELECT id INTO v_current
      FROM public.pages
      WHERE slug = v_seg
        AND parent_id IS NOT DISTINCT FROM v_parent
        AND status = 'published'
        AND deleted_at IS NULL
      LIMIT 1;
    IF v_current IS NULL THEN
      EXIT;
    END IF;
    v_parent := v_current;
    v_last := i;
  END LOOP;

  IF v_current IS NOT NULL AND v_last = v_len THEN
    page_id := v_current;
    post_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Try all-but-last as page path, last as post slug
  IF v_len >= 2 THEN
    v_parent := NULL;
    v_current := NULL;
    v_last := 0;
    FOR i IN 1 .. v_len - 1 LOOP
      v_seg := _segments[i];
      SELECT id INTO v_current
        FROM public.pages
        WHERE slug = v_seg
          AND parent_id IS NOT DISTINCT FROM v_parent
          AND status = 'published'
          AND deleted_at IS NULL
        LIMIT 1;
      IF v_current IS NULL THEN
        RETURN;
      END IF;
      v_parent := v_current;
      v_last := i;
    END LOOP;

    IF v_last <> v_len - 1 THEN
      RETURN;
    END IF;

    SELECT id INTO v_post
      FROM public.posts
      WHERE slug = _segments[v_len]
        AND parent_page_id = v_current
        AND status = 'published'
        AND deleted_at IS NULL
      LIMIT 1;

    IF v_post IS NOT NULL THEN
      page_id := v_current;
      post_id := v_post;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;
END;
$function$;

-- 2) Tenant host mapping: add aliases[] and set defaults for NES
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

UPDATE public.tenants
   SET domain = COALESCE(NULLIF(domain, ''), 'neweustrategies.lovable.app'),
       aliases = ARRAY['localhost','127.0.0.1','id-preview--59b9e533-d5b0-40cf-a791-624ceeb88e2e.lovable.app']
 WHERE slug = 'nes';

-- 3) public_tenant_id: include aliases lookup
CREATE OR REPLACE FUNCTION public.public_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH req AS (SELECT public.request_public_host() AS host)
  SELECT COALESCE(
    (SELECT t.id
       FROM public.tenants t, req r
      WHERE r.host IS NOT NULL
        AND (
          lower(t.domain) IN (
            r.host,
            CASE WHEN r.host LIKE 'www.%' THEN substr(r.host, 5)
                 ELSE 'www.' || r.host END
          )
          OR r.host = ANY (ARRAY(SELECT lower(a) FROM unnest(t.aliases) a))
        )
      ORDER BY (lower(t.domain) = r.host) DESC
      LIMIT 1),
    (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
    (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
  )
$function$;
