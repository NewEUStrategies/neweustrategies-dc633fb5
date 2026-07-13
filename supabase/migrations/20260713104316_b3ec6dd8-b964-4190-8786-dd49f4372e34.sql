
-- PR #21 redeploy - w pełni idempotentne.

-- 1) Preferencja "tracker"
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_tracker boolean NOT NULL DEFAULT true;

-- 2) CHECK notifications.kind - dopisz "tracker"
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker'))
  NOT VALID;

-- 3) enqueue_notification - branch tracker
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text,
  p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN
    RETURN NULL;
  END IF;

  IF p_kind <> 'security' THEN
    SELECT CASE p_kind
             WHEN 'message'      THEN np.enabled_message
             WHEN 'comment'      THEN np.enabled_comment
             WHEN 'follow'       THEN np.enabled_follow
             WHEN 'subscription' THEN np.enabled_subscription
             WHEN 'content'      THEN np.enabled_content
             WHEN 'system'       THEN np.enabled_system
             WHEN 'tracker'      THEN np.enabled_tracker
             ELSE true
           END
      INTO v_enabled
      FROM public.notification_preferences np
     WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN
      RETURN NULL;
    END IF;
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
$function$;

-- 4) Trigger trackera: alerty jako "tracker" + emit_domain_event
CREATE OR REPLACE FUNCTION public.tg_eu_policy_update_applied()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.eu_policy_items%ROWTYPE;
  v_row record;
BEGIN
  SELECT * INTO v_item FROM public.eu_policy_items WHERE id = NEW.item_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  NEW.tenant_id := v_item.tenant_id;
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  IF NEW.stage_to IS NOT NULL AND NEW.stage_to <> v_item.stage THEN
    NEW.stage_from := v_item.stage;
    UPDATE public.eu_policy_items
       SET stage = NEW.stage_to
     WHERE id = NEW.item_id;
  END IF;

  IF v_item.status = 'published' THEN
    FOR v_row IN
      SELECT user_id FROM public.eu_policy_follows WHERE item_id = NEW.item_id
    LOOP
      PERFORM public.enqueue_notification(
        v_row.user_id,
        'tracker',
        'Aktualizacja dossier: ' || v_item.title_pl,
        'Dossier update: ' || v_item.title_en,
        left(btrim(NEW.note_pl), 160),
        left(btrim(NEW.note_en), 160),
        '/tracker/' || v_item.slug,
        'Landmark'
      );
    END LOOP;

    PERFORM public.emit_domain_event(
      v_item.tenant_id, 'eu_policy_item', v_item.id::text, 'policy.updated.v1',
      jsonb_build_object(
        'slug', v_item.slug,
        'stage_to', NEW.stage_to,
        'title_pl', v_item.title_pl,
        'title_en', v_item.title_en
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'tracker: update fan-out failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 5) eu_policy_links (nowa tabela)
CREATE TABLE IF NOT EXISTS public.eu_policy_links (
  item_id uuid NOT NULL REFERENCES public.eu_policy_items(id) ON DELETE CASCADE,
  related_item_id uuid NOT NULL REFERENCES public.eu_policy_items(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  relation text NOT NULL DEFAULT 'related'
    CHECK (relation IN ('related', 'amends', 'implements', 'supersedes')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, related_item_id),
  CHECK (item_id <> related_item_id)
);

CREATE INDEX IF NOT EXISTS idx_eu_policy_links_related
  ON public.eu_policy_links (related_item_id);

GRANT SELECT ON public.eu_policy_links TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.eu_policy_links TO authenticated;
GRANT ALL ON public.eu_policy_links TO service_role;
ALTER TABLE public.eu_policy_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.tg_eu_policy_link_pin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src uuid;
  v_dst uuid;
BEGIN
  SELECT tenant_id INTO v_src FROM public.eu_policy_items WHERE id = NEW.item_id;
  SELECT tenant_id INTO v_dst FROM public.eu_policy_items WHERE id = NEW.related_item_id;
  IF v_src IS NULL OR v_dst IS NULL THEN
    RAISE EXCEPTION 'eu_policy_links: unknown dossier';
  END IF;
  IF v_src <> v_dst THEN
    RAISE EXCEPTION 'eu_policy_links: cross-tenant link forbidden';
  END IF;
  NEW.tenant_id := v_src;
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eu_policy_link_pin ON public.eu_policy_links;
CREATE TRIGGER eu_policy_link_pin
  BEFORE INSERT OR UPDATE ON public.eu_policy_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_eu_policy_link_pin();

DROP POLICY IF EXISTS "policy links public read" ON public.eu_policy_links;
CREATE POLICY "policy links public read" ON public.eu_policy_links
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (SELECT 1 FROM public.eu_policy_items i
                 WHERE i.id = eu_policy_links.item_id AND i.status = 'published')
    AND EXISTS (SELECT 1 FROM public.eu_policy_items j
                 WHERE j.id = eu_policy_links.related_item_id AND j.status = 'published')
  );

DROP POLICY IF EXISTS "policy links staff all" ON public.eu_policy_links;
CREATE POLICY "policy links staff all" ON public.eu_policy_links
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
         OR public.has_role((SELECT auth.uid()), 'editor'::app_role))
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
         OR public.has_role((SELECT auth.uid()), 'editor'::app_role))
  );

-- 6) RPC statystyk trackera
CREATE OR REPLACE FUNCTION public.get_tracker_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH pub AS (
    SELECT stage, policy_area
      FROM public.eu_policy_items
     WHERE tenant_id = public.public_tenant_id()
       AND status = 'published'
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM pub),
    'by_stage', COALESCE((
      SELECT jsonb_object_agg(stage, n)
        FROM (SELECT stage, count(*)::int AS n FROM pub GROUP BY stage) s
    ), '{}'::jsonb),
    'by_area', COALESCE((
      SELECT jsonb_object_agg(policy_area, n)
        FROM (SELECT policy_area, count(*)::int AS n FROM pub GROUP BY policy_area) a
    ), '{}'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_tracker_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracker_stats() TO anon, authenticated, service_role;
