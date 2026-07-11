-- SPÓJNOŚĆ MIĘDZY MODUŁAMI, część 1/5: szyna zdarzeń domenowych.
CREATE TABLE IF NOT EXISTS public.domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event_type ~ '^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$'),
  CHECK (btrim(aggregate_type) <> '' AND btrim(aggregate_id) <> '')
);

CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_created
  ON public.domain_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate
  ON public.domain_events (tenant_id, aggregate_type, aggregate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_type
  ON public.domain_events (tenant_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_correlation
  ON public.domain_events (correlation_id) WHERE correlation_id IS NOT NULL;

GRANT SELECT ON public.domain_events TO authenticated;
GRANT ALL ON public.domain_events TO service_role;

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS domain_events_staff_select ON public.domain_events;
CREATE POLICY domain_events_staff_select
  ON public.domain_events FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS domain_events_actor_select ON public.domain_events;
CREATE POLICY domain_events_actor_select
  ON public.domain_events FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND actor_id = auth.uid());

DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.domain_events;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE OR REPLACE FUNCTION public.request_correlation_id()
RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_raw text;
BEGIN
  v_raw := current_setting('request.headers', true)::jsonb ->> 'x-correlation-id';
  IF v_raw IS NULL OR v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_raw::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid,
  p_aggregate_type text,
  p_aggregate_id text,
  p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb
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
    public.request_correlation_id(), auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emit_domain_event(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_domain_event(uuid, text, text, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_correlated_events(p_correlation_id uuid)
RETURNS SETOF public.domain_events
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT * FROM public.domain_events
  WHERE correlation_id = p_correlation_id
  ORDER BY created_at ASC, id ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_correlated_events(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_correlated_events(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_posts_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'post', NEW.id::text, 'post.created.v1',
      jsonb_build_object(
        'slug', NEW.slug, 'status', NEW.status::text,
        'title_pl', NEW.title_pl, 'author_id', NEW.author_id
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'post', NEW.id::text, 'post.deleted.v1',
        jsonb_build_object('slug', NEW.slug)
      );
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'published' THEN
        PERFORM public.emit_domain_event(
          NEW.tenant_id, 'post', NEW.id::text, 'post.published.v1',
          jsonb_build_object(
            'slug', NEW.slug, 'title_pl', NEW.title_pl, 'title_en', NEW.title_en,
            'author_id', NEW.author_id, 'old_status', OLD.status::text
          )
        );
      ELSE
        PERFORM public.emit_domain_event(
          NEW.tenant_id, 'post', NEW.id::text, 'post.status_changed.v1',
          jsonb_build_object(
            'slug', NEW.slug, 'old_status', OLD.status::text,
            'new_status', NEW.status::text, 'author_id', NEW.author_id
          )
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posts_emit_events ON public.posts;
CREATE TRIGGER trg_posts_emit_events
  AFTER INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.tg_posts_emit_events();

CREATE OR REPLACE FUNCTION public.tg_comments_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'comment', NEW.id::text, 'comment.created.v1',
      jsonb_build_object(
        'post_id', NEW.post_id, 'user_id', NEW.user_id,
        'status', NEW.status, 'parent_id', NEW.parent_id
      )
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'comment', NEW.id::text, 'comment.status_changed.v1',
      jsonb_build_object(
        'post_id', NEW.post_id, 'user_id', NEW.user_id,
        'old_status', OLD.status, 'new_status', NEW.status
      )
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comments_emit_events ON public.comments;
CREATE TRIGGER trg_comments_emit_events
  AFTER INSERT OR UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_comments_emit_events();

CREATE OR REPLACE FUNCTION public.tg_messages_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'message', NEW.id::text, 'message.sent.v1',
    jsonb_build_object(
      'conversation_id', NEW.conversation_id, 'sender_id', NEW.sender_id,
      'kind', NEW.kind
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_emit_events ON public.messages;
CREATE TRIGGER trg_messages_emit_events
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_messages_emit_events();

CREATE OR REPLACE FUNCTION public.tg_crm_leads_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'crm_lead', NEW.id::text, 'crm_lead.created.v1',
      jsonb_build_object(
        'email', NEW.email, 'stage', NEW.stage::text,
        'first_name', NEW.first_name, 'last_name', NEW.last_name,
        'owner_id', NEW.owner_id
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.stage IS DISTINCT FROM OLD.stage THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'crm_lead', NEW.id::text, 'crm_lead.stage_changed.v1',
        jsonb_build_object(
          'email', NEW.email, 'old_stage', OLD.stage::text,
          'new_stage', NEW.stage::text, 'owner_id', NEW.owner_id
        )
      );
    ELSE
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'crm_lead', NEW.id::text, 'crm_lead.updated.v1',
        jsonb_build_object('email', NEW.email, 'stage', NEW.stage::text)
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_leads_emit_events ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_emit_events
  AFTER INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_leads_emit_events();

CREATE OR REPLACE FUNCTION public.tg_crm_lead_notes_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'crm_note', NEW.id::text, 'crm_note.created.v1',
    jsonb_build_object('lead_id', NEW.lead_id, 'author_id', NEW.author_id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_lead_notes_emit_events ON public.crm_lead_notes;
CREATE TRIGGER trg_crm_lead_notes_emit_events
  AFTER INSERT ON public.crm_lead_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_lead_notes_emit_events();

CREATE OR REPLACE FUNCTION public.tg_newsletter_subscribers_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'newsletter_subscriber', NEW.id::text,
      'newsletter_subscriber.subscribed.v1',
      jsonb_build_object(
        'email', NEW.email, 'first_name', NEW.first_name,
        'last_name', NEW.last_name, 'language', NEW.language,
        'status', NEW.status, 'source', NEW.source
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'newsletter_subscriber', NEW.id::text,
        'newsletter_subscriber.confirmed.v1',
        jsonb_build_object(
          'email', NEW.email, 'first_name', NEW.first_name,
          'last_name', NEW.last_name, 'language', NEW.language,
          'source', NEW.source
        )
      );
    ELSIF NEW.unsubscribed_at IS NOT NULL AND OLD.unsubscribed_at IS NULL THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'newsletter_subscriber', NEW.id::text,
        'newsletter_subscriber.unsubscribed.v1',
        jsonb_build_object('email', NEW.email)
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_newsletter_subscribers_emit_events ON public.newsletter_subscribers;
CREATE TRIGGER trg_newsletter_subscribers_emit_events
  AFTER INSERT OR UPDATE ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.tg_newsletter_subscribers_emit_events();

CREATE OR REPLACE FUNCTION public.prune_domain_events(p_keep interval DEFAULT interval '90 days')
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.domain_events WHERE created_at < now() - p_keep;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_domain_events(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_domain_events(interval) TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('prune-domain-events', '20 3 * * *',
      'SELECT public.prune_domain_events()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - domain_events pruned only on demand';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;