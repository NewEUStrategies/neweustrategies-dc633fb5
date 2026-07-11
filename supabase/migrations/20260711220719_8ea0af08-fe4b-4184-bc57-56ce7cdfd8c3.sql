CREATE TABLE IF NOT EXISTS public.cross_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  relation text NOT NULL DEFAULT 'related',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(source_type) <> '' AND btrim(source_id) <> ''),
  CHECK (btrim(target_type) <> '' AND btrim(target_id) <> ''),
  CHECK (NOT (source_type = target_type AND source_id = target_id)),
  UNIQUE (tenant_id, source_type, source_id, target_type, target_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_cross_references_source
  ON public.cross_references (tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_cross_references_target
  ON public.cross_references (tenant_id, target_type, target_id);

GRANT SELECT, INSERT, DELETE ON public.cross_references TO authenticated;
GRANT ALL ON public.cross_references TO service_role;

ALTER TABLE public.cross_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cross_references_staff_select ON public.cross_references;
CREATE POLICY cross_references_staff_select
  ON public.cross_references FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS cross_references_owner_select ON public.cross_references;
CREATE POLICY cross_references_owner_select
  ON public.cross_references FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND created_by = auth.uid());

DROP POLICY IF EXISTS cross_references_staff_insert ON public.cross_references;
CREATE POLICY cross_references_staff_insert
  ON public.cross_references FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_staff()
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS cross_references_staff_delete ON public.cross_references;
CREATE POLICY cross_references_staff_delete
  ON public.cross_references FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cross_references;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE OR REPLACE FUNCTION public.add_cross_reference(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id text,
  p_target_type text,
  p_target_id text,
  p_relation text DEFAULT 'related',
  p_created_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_source_id IS NULL OR p_target_id IS NULL
     OR (p_source_type = p_target_type AND p_source_id = p_target_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.cross_references (
    tenant_id, source_type, source_id, target_type, target_id, relation, created_by
  ) VALUES (
    p_tenant_id, p_source_type, p_source_id, p_target_type, p_target_id,
    COALESCE(NULLIF(btrim(p_relation), ''), 'related'), p_created_by
  )
  ON CONFLICT (tenant_id, source_type, source_id, target_type, target_id, relation)
    DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_cross_reference(uuid, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_cross_reference(uuid, text, text, text, text, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.linked_item_label(p_type text, p_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
BEGIN
  IF p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  CASE p_type
    WHEN 'post' THEN
      SELECT COALESCE(NULLIF(title_pl, ''), NULLIF(title_en, ''), slug)
        INTO v_label FROM public.posts WHERE id = p_id::uuid;
    WHEN 'page' THEN
      SELECT COALESCE(NULLIF(title_pl, ''), NULLIF(title_en, ''), slug)
        INTO v_label FROM public.pages WHERE id = p_id::uuid;
    WHEN 'crm_lead' THEN
      SELECT COALESCE(
               NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
               email
             )
        INTO v_label FROM public.crm_leads WHERE id = p_id::uuid;
    WHEN 'crm_note' THEN
      SELECT left(body, 80) INTO v_label FROM public.crm_lead_notes WHERE id = p_id::uuid;
    WHEN 'comment' THEN
      SELECT left(body, 80) INTO v_label FROM public.comments WHERE id = p_id::uuid;
    WHEN 'profile' THEN
      SELECT COALESCE(NULLIF(display_name, ''), NULLIF(email, ''), slug)
        INTO v_label FROM public.profiles WHERE id = p_id::uuid;
    WHEN 'message' THEN
      v_label := NULL;
    WHEN 'newsletter_subscriber' THEN
      SELECT email INTO v_label FROM public.newsletter_subscribers WHERE id = p_id::uuid;
    ELSE
      v_label := NULL;
  END CASE;
  RETURN v_label;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.linked_item_label(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linked_item_label(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_linked_items(p_item_type text, p_item_id text)
RETURNS TABLE (
  reference_id uuid,
  direction text,
  item_type text,
  item_id text,
  relation text,
  label text,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_tenant IS NULL OR NOT public.is_staff() THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT
    r.id,
    'outgoing'::text,
    r.target_type,
    r.target_id,
    r.relation,
    public.linked_item_label(r.target_type, r.target_id),
    r.created_at
  FROM public.cross_references r
  WHERE r.tenant_id = v_tenant
    AND r.source_type = p_item_type AND r.source_id = p_item_id
  UNION ALL
  SELECT
    r.id,
    'incoming'::text,
    r.source_type,
    r.source_id,
    r.relation,
    public.linked_item_label(r.source_type, r.source_id),
    r.created_at
  FROM public.cross_references r
  WHERE r.tenant_id = v_tenant
    AND r.target_type = p_item_type AND r.target_id = p_item_id
  ORDER BY 7 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_linked_items(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_linked_items(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_mentions(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id text,
  p_body text,
  p_actor_id uuid,
  p_kind text,
  p_href text
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_profile record;
  v_actor_name text;
  v_count integer := 0;
BEGIN
  IF p_body IS NULL OR position('@' in p_body) = 0 THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Ktoś')
    INTO v_actor_name FROM public.profiles WHERE id = p_actor_id;
  v_actor_name := COALESCE(v_actor_name, 'Ktoś');

  FOR v_slug IN
    SELECT DISTINCT lower(m[1])
    FROM regexp_matches(p_body, '(?:^|[^a-zA-Z0-9@._-])@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})', 'g') AS m
    LIMIT 10
  LOOP
    SELECT id, display_name INTO v_profile
      FROM public.profiles
     WHERE tenant_id = p_tenant_id AND slug = v_slug;
    IF v_profile.id IS NULL OR v_profile.id = p_actor_id THEN
      CONTINUE;
    END IF;

    PERFORM public.add_cross_reference(
      p_tenant_id, p_source_type, p_source_id,
      'profile', v_profile.id::text, 'mention', p_actor_id
    );

    PERFORM public.enqueue_notification(
      v_profile.id,
      p_kind,
      v_actor_name || ' wspomniał(a) o Tobie',
      v_actor_name || ' mentioned you',
      NULL, NULL,
      p_href,
      'at-sign'
    );

    PERFORM public.emit_domain_event(
      p_tenant_id, p_source_type, p_source_id, 'mention.created.v1',
      jsonb_build_object(
        'mentioned_user_id', v_profile.id,
        'actor_id', p_actor_id,
        'source_type', p_source_type
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_mentions(uuid, text, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_mentions(uuid, text, text, text, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.tg_comments_cohesion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_href text;
BEGIN
  PERFORM public.add_cross_reference(
    NEW.tenant_id, 'comment', NEW.id::text, 'post', NEW.post_id::text,
    'belongs_to', NEW.user_id
  );
  v_href := public.post_canonical_href(NEW.post_id);
  PERFORM public.process_mentions(
    NEW.tenant_id, 'comment', NEW.id::text, NEW.body, NEW.user_id,
    'comment', v_href
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comments_cohesion ON public.comments;
CREATE TRIGGER trg_comments_cohesion
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_comments_cohesion();

CREATE OR REPLACE FUNCTION public.tg_crm_lead_notes_cohesion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.add_cross_reference(
    NEW.tenant_id, 'crm_note', NEW.id::text, 'crm_lead', NEW.lead_id::text,
    'belongs_to', NEW.author_id
  );
  PERFORM public.process_mentions(
    NEW.tenant_id, 'crm_note', NEW.id::text, NEW.body, NEW.author_id,
    'system', '/admin/crm?lead=' || NEW.lead_id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_lead_notes_cohesion ON public.crm_lead_notes;
CREATE TRIGGER trg_crm_lead_notes_cohesion
  AFTER INSERT ON public.crm_lead_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_lead_notes_cohesion();

CREATE OR REPLACE FUNCTION public.tg_messages_cohesion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.body IS NOT NULL THEN
    PERFORM public.process_mentions(
      NEW.tenant_id, 'message', NEW.id::text, NEW.body, NEW.sender_id,
      'message', '/messages?c=' || NEW.conversation_id::text
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_cohesion ON public.messages;
CREATE TRIGGER trg_messages_cohesion
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_messages_cohesion();

INSERT INTO public.cross_references (
  tenant_id, source_type, source_id, target_type, target_id, relation, created_by
)
SELECT c.tenant_id, 'comment', c.id::text, 'post', c.post_id::text, 'belongs_to', c.user_id
FROM public.comments c
ON CONFLICT (tenant_id, source_type, source_id, target_type, target_id, relation)
  DO NOTHING;

INSERT INTO public.cross_references (
  tenant_id, source_type, source_id, target_type, target_id, relation, created_by
)
SELECT n.tenant_id, 'crm_note', n.id::text, 'crm_lead', n.lead_id::text, 'belongs_to', n.author_id
FROM public.crm_lead_notes n
ON CONFLICT (tenant_id, source_type, source_id, target_type, target_id, relation)
  DO NOTHING;