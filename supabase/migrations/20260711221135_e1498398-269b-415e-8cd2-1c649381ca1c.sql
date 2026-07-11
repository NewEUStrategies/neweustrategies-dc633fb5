CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid,
  p_kind text,
  p_title_pl text,
  p_title_en text,
  p_body_pl text DEFAULT NULL,
  p_body_en text DEFAULT NULL,
  p_href text DEFAULT NULL,
  p_icon text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN
    RETURN NULL;
  END IF;

  SELECT CASE p_kind
           WHEN 'message'      THEN np.enabled_message
           WHEN 'comment'      THEN np.enabled_comment
           WHEN 'follow'       THEN np.enabled_follow
           WHEN 'subscription' THEN np.enabled_subscription
           WHEN 'content'      THEN np.enabled_content
           WHEN 'system'       THEN np.enabled_system
           WHEN 'security'     THEN np.enabled_security
           ELSE true
         END
    INTO v_enabled
    FROM public.notification_preferences np
   WHERE np.user_id = p_user_id;
  IF v_enabled IS FALSE THEN
    RETURN NULL;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id
      AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes'
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (
    user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon
  ) VALUES (
    p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''),
    NULLIF(btrim(p_body_pl), ''),
    NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''),
    NULLIF(btrim(p_icon), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;