-- SECURITY FIX: chat moderation surface was cross-tenant.
--
-- The staff policies + RPCs added in 20260712225933 gated only on has_role(...)
-- with NO tenant predicate. Because has_role() checks whether the caller has a
-- role in THEIR OWN tenant (not which rows they may touch), an admin/editor in
-- tenant A could read (and admins delete/soft-delete) conversations and messages
-- across EVERY tenant, and admin_community_stats() blended all tenants' counts.
--
-- This migration re-scopes every one of those surfaces to
-- `tenant_id = current_tenant_id()` (profile-derived, JWT-independent), matching
-- the dominant staff-policy pattern used everywhere else in the schema
-- (`tenant_id = current_tenant_id() AND has_role(...)`). Idempotent.

-- 1-4. Staff RLS policies on conversations/messages -> tenant-scoped.
DROP POLICY IF EXISTS conversations_staff_read ON public.conversations;
CREATE POLICY conversations_staff_read ON public.conversations
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'editor')
    )
  );

DROP POLICY IF EXISTS conversations_staff_delete ON public.conversations;
CREATE POLICY conversations_staff_delete ON public.conversations
  FOR DELETE TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

DROP POLICY IF EXISTS messages_staff_read ON public.messages;
CREATE POLICY messages_staff_read ON public.messages
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'editor')
    )
  );

DROP POLICY IF EXISTS messages_staff_update ON public.messages;
CREATE POLICY messages_staff_update ON public.messages
  FOR UPDATE TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'editor')
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'editor')
    )
  );

-- 5. admin_community_stats(): scope every aggregate to the caller's tenant.
CREATE OR REPLACE FUNCTION public.admin_community_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL OR NOT (
       public.has_role(v_uid, 'admin')
    OR public.has_role(v_uid, 'super_admin')
    OR public.has_role(v_uid, 'editor')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'conversations_total', (SELECT count(*) FROM public.conversations WHERE tenant_id = v_tenant),
    'messages_last_24h', (SELECT count(*) FROM public.messages WHERE tenant_id = v_tenant AND created_at > now() - interval '24 hours' AND deleted_at IS NULL),
    'events_upcoming', (SELECT count(*) FROM public.events WHERE tenant_id = v_tenant AND status = 'published' AND starts_at >= now()),
    'events_drafts', (SELECT count(*) FROM public.events WHERE tenant_id = v_tenant AND status = 'draft'),
    'qa_sessions_open', (SELECT count(*) FROM public.qa_sessions WHERE tenant_id = v_tenant AND status IN ('open','answering')),
    'qa_questions_pending', (SELECT count(*) FROM public.qa_questions WHERE tenant_id = v_tenant AND status = 'pending')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_community_stats() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_community_stats() TO authenticated;

-- 6. admin_soft_delete_message(): SECURITY DEFINER bypasses RLS, so pin the
--    UPDATE to the caller's tenant (previously deletable by id across tenants).
CREATE OR REPLACE FUNCTION public.admin_soft_delete_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL OR NOT (
       public.has_role(v_uid, 'admin')
    OR public.has_role(v_uid, 'super_admin')
    OR public.has_role(v_uid, 'editor')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.messages
     SET deleted_at = now(),
         body = NULL,
         attachment_path = NULL,
         attachment_name = NULL,
         attachment_mime = NULL,
         attachment_size = NULL
   WHERE id = p_message_id
     AND tenant_id = v_tenant
     AND deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_soft_delete_message(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_message(uuid) TO authenticated;
