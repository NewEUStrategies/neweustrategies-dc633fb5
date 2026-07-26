DROP POLICY IF EXISTS "audit_log staff insert tenant" ON public.audit_log;

CREATE POLICY "audit_log staff insert tenant"
ON public.audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = current_tenant_id()
  AND actor_id = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'editor'::public.app_role)
    OR public.has_role(auth.uid(), 'author'::public.app_role)
  )
);

CREATE OR REPLACE FUNCTION public.can_access_entity_presence(
  _entity_type text,
  _entity_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF _uid IS NULL OR _tenant IS NULL OR _entity_id IS NULL THEN
    RETURN false;
  END IF;

  IF _entity_type = 'conversation' THEN
    RETURN public.is_tenant_conversation_member(_entity_id, _uid);
  END IF;

  IF _entity_type IN ('post', 'page', 'media', 'crm_lead') THEN
    RETURN (
      public.has_role(_uid, 'admin'::public.app_role)
      OR public.has_role(_uid, 'super_admin'::public.app_role)
      OR public.has_role(_uid, 'editor'::public.app_role)
      OR public.has_role(_uid, 'author'::public.app_role)
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_entity_presence(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_entity_presence(text, uuid) TO authenticated;

DROP POLICY IF EXISTS entity_presence_tenant_read ON realtime.messages;
DROP POLICY IF EXISTS entity_presence_tenant_write ON realtime.messages;

CREATE POLICY entity_presence_tenant_read
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'presence'
  AND realtime.topic() LIKE 'presence:%'
  AND split_part(realtime.topic(), ':', 2) = (public.current_tenant_id())::text
  AND split_part(realtime.topic(), ':', 3) <> ''
  AND split_part(realtime.topic(), ':', 4) <> ''
  AND public.can_access_entity_presence(
        split_part(realtime.topic(), ':', 3),
        NULLIF(split_part(realtime.topic(), ':', 4), '')::uuid
      )
);

CREATE POLICY entity_presence_tenant_write
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  extension = 'presence'
  AND realtime.topic() LIKE 'presence:%'
  AND split_part(realtime.topic(), ':', 2) = (public.current_tenant_id())::text
  AND split_part(realtime.topic(), ':', 3) <> ''
  AND split_part(realtime.topic(), ':', 4) <> ''
  AND public.can_access_entity_presence(
        split_part(realtime.topic(), ':', 3),
        NULLIF(split_part(realtime.topic(), ':', 4), '')::uuid
      )
);