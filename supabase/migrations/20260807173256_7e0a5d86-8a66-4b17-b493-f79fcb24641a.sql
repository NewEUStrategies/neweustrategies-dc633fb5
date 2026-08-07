CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid,
  p_aggregate_type text,
  p_aggregate_id text,
  p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_suppress_actor boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_aggregate_type IS NULL OR p_aggregate_id IS NULL
     OR p_event_type IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.domain_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload,
    correlation_id, actor_id
  ) VALUES (
    p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type,
    COALESCE(p_payload, '{}'::jsonb),
    public.request_correlation_id(),
    CASE WHEN p_suppress_actor THEN NULL ELSE auth.uid() END
  )
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emit_domain_event(uuid, text, text, text, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_domain_event(uuid, text, text, text, jsonb, boolean)
  TO service_role;

DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.process_mentions(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id text,
  p_body text,
  p_actor_id uuid,
  p_kind text,
  p_href text,
  p_actor_label text DEFAULT NULL,
  p_record_actor boolean DEFAULT true
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

  IF p_actor_label IS NOT NULL AND btrim(p_actor_label) <> '' THEN
    v_actor_name := btrim(p_actor_label);
  ELSE
    SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Ktoś')
      INTO v_actor_name FROM public.profiles WHERE id = p_actor_id;
    v_actor_name := COALESCE(v_actor_name, 'Ktoś');
  END IF;

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
      'profile', v_profile.id::text, 'mention',
      CASE WHEN p_record_actor THEN p_actor_id ELSE NULL END
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
        'actor_id', CASE WHEN p_record_actor THEN to_jsonb(p_actor_id) ELSE 'null'::jsonb END,
        'source_type', p_source_type
      ),
      NOT p_record_actor
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.process_mentions(uuid, text, text, text, uuid, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.process_mentions(uuid, text, text, text, uuid, text, text, text, boolean)
  TO service_role;

DROP FUNCTION IF EXISTS public.process_mentions(uuid, text, text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.club_thread_seam_context(p_thread_id uuid)
RETURNS TABLE (
  emit boolean, hide_actor boolean, club_id uuid, club_slug text,
  tenant_id uuid, thread_slug text, group_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (c.visibility <> 'secret'),
    (t.is_anonymous OR COALESCE(g.attribution_mode, c.attribution_mode) = 'chatham'),
    c.id, c.slug, c.tenant_id, t.slug, t.group_id
  FROM public.club_threads t
  JOIN public.clubs c ON c.id = t.club_id
  JOIN public.club_groups g ON g.id = t.group_id
  WHERE t.id = p_thread_id
$$;

REVOKE EXECUTE ON FUNCTION public.club_thread_seam_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_thread_seam_context(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_club_threads_seams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx  record;
  v_href text;
BEGIN
  SELECT * INTO v_ctx FROM public.club_thread_seam_context(NEW.id);
  IF NOT FOUND OR NOT v_ctx.emit THEN
    RETURN NEW;
  END IF;

  v_href := '/club/' || v_ctx.club_slug || '/t/' || v_ctx.thread_slug;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.add_cross_reference(
      NEW.tenant_id, 'club_thread', NEW.id::text, 'club', v_ctx.club_id::text,
      'belongs_to', CASE WHEN v_ctx.hide_actor THEN NULL ELSE NEW.author_id END
    );

    IF NEW.anchor_type IS NOT NULL AND NULLIF(btrim(COALESCE(NEW.anchor_id, '')), '') IS NOT NULL THEN
      PERFORM public.add_cross_reference(
        NEW.tenant_id, 'club_thread', NEW.id::text, NEW.anchor_type, NEW.anchor_id,
        'discusses', CASE WHEN v_ctx.hide_actor THEN NULL ELSE NEW.author_id END
      );
    END IF;

    PERFORM public.process_mentions(
      NEW.tenant_id, 'club_thread', NEW.id::text,
      COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.body, ''),
      NEW.author_id, 'club', v_href,
      CASE WHEN v_ctx.hide_actor THEN 'Uczestnik dyskusji' ELSE NULL END,
      NOT v_ctx.hide_actor
    );

    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_thread', NEW.id::text, 'club_thread.created.v1',
      jsonb_build_object(
        'club_id', v_ctx.club_id, 'group_id', NEW.group_id,
        'status', NEW.status, 'kind', NEW.kind
      ),
      v_ctx.hide_actor
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_thread', NEW.id::text, 'club_thread.status_changed.v1',
      jsonb_build_object(
        'club_id', v_ctx.club_id, 'group_id', NEW.group_id,
        'status', NEW.status, 'previous_status', OLD.status
      ),
      v_ctx.hide_actor
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS club_threads_seams_tg ON public.club_threads;
CREATE TRIGGER club_threads_seams_tg
  AFTER INSERT OR UPDATE OF status ON public.club_threads
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_threads_seams();

CREATE OR REPLACE FUNCTION public.tg_club_replies_seams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx  record;
  v_href text;
BEGIN
  SELECT * INTO v_ctx FROM public.club_thread_seam_context(NEW.thread_id);
  IF NOT FOUND OR NOT v_ctx.emit THEN
    RETURN NEW;
  END IF;

  v_href := '/club/' || v_ctx.club_slug || '/t/' || v_ctx.thread_slug;
  IF NEW.is_anonymous THEN
    v_ctx.hide_actor := true;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.add_cross_reference(
      NEW.tenant_id, 'club_reply', NEW.id::text, 'club_thread', NEW.thread_id::text,
      'belongs_to', CASE WHEN v_ctx.hide_actor THEN NULL ELSE NEW.author_id END
    );

    PERFORM public.process_mentions(
      NEW.tenant_id, 'club_reply', NEW.id::text, NEW.body,
      NEW.author_id, 'club', v_href,
      CASE WHEN v_ctx.hide_actor THEN 'Uczestnik dyskusji' ELSE NULL END,
      NOT v_ctx.hide_actor
    );

    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_reply', NEW.id::text, 'club_reply.created.v1',
      jsonb_build_object(
        'club_id', v_ctx.club_id, 'thread_id', NEW.thread_id,
        'status', NEW.status, 'depth', NEW.depth
      ),
      v_ctx.hide_actor
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_reply', NEW.id::text, 'club_reply.status_changed.v1',
      jsonb_build_object(
        'club_id', v_ctx.club_id, 'thread_id', NEW.thread_id,
        'status', NEW.status, 'previous_status', OLD.status
      ),
      v_ctx.hide_actor
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS club_replies_seams_tg ON public.club_replies;
CREATE TRIGGER club_replies_seams_tg
  AFTER INSERT OR UPDATE OF status ON public.club_replies
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_replies_seams();

CREATE OR REPLACE FUNCTION public.tg_club_members_seams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret boolean;
BEGIN
  SELECT (c.visibility = 'secret') INTO v_secret
    FROM public.clubs c WHERE c.id = NEW.club_id;
  IF COALESCE(v_secret, true) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.role IS DISTINCT FROM OLD.role THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_member', NEW.id::text, 'club_member.changed.v1',
      jsonb_build_object(
        'club_id', NEW.club_id, 'member_user_id', NEW.user_id,
        'status', NEW.status, 'role', NEW.role
      )
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS club_members_seams_tg ON public.club_members;
CREATE TRIGGER club_members_seams_tg
  AFTER INSERT OR UPDATE OF status, role ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_members_seams();

CREATE OR REPLACE FUNCTION public.club_linked_item_label(p_type text, p_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
BEGIN
  IF p_type = 'club' THEN
    SELECT c.name_pl INTO v_label FROM public.clubs c
     WHERE c.id = p_id::uuid AND c.visibility <> 'secret';
    RETURN v_label;
  ELSIF p_type = 'club_thread' THEN
    SELECT CASE WHEN c.visibility IN ('public', 'members')
                THEN t.title
                ELSE 'Dyskusja: ' || c.name_pl END
      INTO v_label
      FROM public.club_threads t
      JOIN public.clubs c ON c.id = t.club_id
     WHERE t.id = p_id::uuid AND c.visibility <> 'secret';
    RETURN v_label;
  ELSIF p_type = 'club_reply' THEN
    SELECT 'Odpowiedź w: ' || c.name_pl INTO v_label
      FROM public.club_replies r
      JOIN public.clubs c ON c.id = r.club_id
     WHERE r.id = p_id::uuid AND c.visibility <> 'secret';
    RETURN v_label;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_linked_item_label(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_linked_item_label(text, text)
  TO authenticated, service_role;