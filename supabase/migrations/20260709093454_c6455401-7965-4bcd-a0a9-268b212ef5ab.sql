
ALTER TABLE public.content_access
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_hint_pl text,
  ADD COLUMN IF NOT EXISTS password_hint_en text;

CREATE OR REPLACE FUNCTION public.verify_content_password(
  _entity_type public.access_entity_type,
  _entity_id uuid,
  _password text
)
RETURNS TABLE(
  ok boolean,
  content_pl text,
  content_en text,
  builder_data jsonb,
  blocks_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
  v_mode public.access_mode;
  v_tenant uuid := public.public_tenant_id();
BEGIN
  SELECT mode, password_hash INTO v_mode, v_hash
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode::text <> 'password' OR v_hash IS NULL OR _password IS NULL OR length(_password) = 0 THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF public.crypt(_password, v_hash) <> v_hash THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF _entity_type = 'post' THEN
    RETURN QUERY
      SELECT true, p.content_pl, p.content_en, p.builder_data, p.blocks_data
        FROM public.posts p
       WHERE p.id = _entity_id
         AND p.tenant_id = v_tenant
         AND p.status = 'published'
         AND p.deleted_at IS NULL;
  ELSIF _entity_type = 'page' THEN
    RETURN QUERY
      SELECT true, pg.content_pl, pg.content_en, pg.builder_data, NULL::jsonb
        FROM public.pages pg
       WHERE pg.id = _entity_id
         AND pg.tenant_id = v_tenant
         AND pg.status = 'published'
         AND pg.deleted_at IS NULL;
  END IF;

  RETURN;
END
$$;

REVOKE ALL ON FUNCTION public.verify_content_password(public.access_entity_type, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_content_password(public.access_entity_type, uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_password_hint(
  _entity_type public.access_entity_type,
  _entity_id uuid
)
RETURNS TABLE(hint_pl text, hint_en text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT password_hint_pl, password_hint_en
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id AND mode::text = 'password'
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_password_hint(public.access_entity_type, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_password_hint(public.access_entity_type, uuid) TO anon, authenticated, service_role;
