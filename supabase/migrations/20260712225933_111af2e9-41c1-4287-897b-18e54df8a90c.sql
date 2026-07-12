-- Admin/staff dostęp do konwersacji i wiadomości + kontrola dostępności modułów community.
-- Role staffu w tym projekcie: admin, super_admin, editor.

-- 1. Staff SELECT na konwersacjach
CREATE POLICY conversations_staff_read ON public.conversations
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'editor')
  );

-- 2. Staff DELETE konwersacji (cascade uprzątnie participants/messages)
CREATE POLICY conversations_staff_delete ON public.conversations
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- 3. Staff SELECT na wiadomościach
CREATE POLICY messages_staff_read ON public.messages
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'editor')
  );

-- 4. Staff UPDATE (soft-delete) wiadomości
CREATE POLICY messages_staff_update ON public.messages
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'editor')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'editor')
  );

-- 5. Toggle modułów community w site_settings
INSERT INTO public.site_settings (key, value)
VALUES (
  'community_modules',
  jsonb_build_object(
    'chat_enabled', true,
    'events_enabled', true,
    'qa_enabled', true,
    'polls_enabled', true,
    'default_message_ttl_seconds', null
  )
)
ON CONFLICT (key) DO NOTHING;

-- 6. RPC: metryki community
CREATE OR REPLACE FUNCTION public.admin_community_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT (
       public.has_role(v_uid, 'admin')
    OR public.has_role(v_uid, 'super_admin')
    OR public.has_role(v_uid, 'editor')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'conversations_total', (SELECT count(*) FROM public.conversations),
    'messages_last_24h', (SELECT count(*) FROM public.messages WHERE created_at > now() - interval '24 hours' AND deleted_at IS NULL),
    'events_upcoming', (SELECT count(*) FROM public.events WHERE status = 'published' AND starts_at >= now()),
    'events_drafts', (SELECT count(*) FROM public.events WHERE status = 'draft'),
    'qa_sessions_open', (SELECT count(*) FROM public.qa_sessions WHERE status IN ('open','answering')),
    'qa_questions_pending', (SELECT count(*) FROM public.qa_questions WHERE status = 'pending')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_community_stats() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_community_stats() TO authenticated;

-- 7. RPC: soft-delete wiadomości
CREATE OR REPLACE FUNCTION public.admin_soft_delete_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
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
     AND deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_soft_delete_message(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_message(uuid) TO authenticated;