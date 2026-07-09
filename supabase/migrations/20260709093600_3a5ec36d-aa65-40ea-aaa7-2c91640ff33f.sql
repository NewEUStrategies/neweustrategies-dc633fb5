
CREATE OR REPLACE FUNCTION public.admin_set_content_password(
  _entity_type public.access_entity_type,
  _entity_id uuid,
  _password text,
  _hint_pl text,
  _hint_en text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'super_admin') OR public.has_role(v_uid, 'editor')) THEN
    RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
  END IF;

  UPDATE public.content_access
     SET password_hash = CASE
           WHEN _password IS NULL OR length(_password) = 0 THEN password_hash
           ELSE public.crypt(_password, public.gen_salt('bf', 10))
         END,
         password_hint_pl = _hint_pl,
         password_hint_en = _hint_en,
         updated_at = now()
   WHERE entity_type = _entity_type AND entity_id = _entity_id;
END
$$;

REVOKE ALL ON FUNCTION public.admin_set_content_password(public.access_entity_type, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_content_password(public.access_entity_type, uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_clear_content_password(
  _entity_type public.access_entity_type,
  _entity_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'super_admin') OR public.has_role(v_uid, 'editor')) THEN
    RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
  END IF;
  UPDATE public.content_access
     SET password_hash = NULL,
         updated_at = now()
   WHERE entity_type = _entity_type AND entity_id = _entity_id;
END
$$;

REVOKE ALL ON FUNCTION public.admin_clear_content_password(public.access_entity_type, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_content_password(public.access_entity_type, uuid) TO authenticated, service_role;
