CREATE TABLE IF NOT EXISTS public.user_pending_counters (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  counter_key text NOT NULL,
  value integer NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, counter_key)
);

CREATE INDEX IF NOT EXISTS idx_user_pending_counters_tenant
  ON public.user_pending_counters (tenant_id);

CREATE TABLE IF NOT EXISTS public.tenant_pending_counters (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  counter_key text NOT NULL,
  value integer NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, counter_key)
);

GRANT SELECT ON public.user_pending_counters TO authenticated;
GRANT SELECT ON public.tenant_pending_counters TO authenticated;
GRANT ALL ON public.user_pending_counters TO service_role;
GRANT ALL ON public.tenant_pending_counters TO service_role;

ALTER TABLE public.user_pending_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_pending_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_pending_counters_own_select ON public.user_pending_counters;
CREATE POLICY user_pending_counters_own_select
  ON public.user_pending_counters FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS tenant_pending_counters_staff_select ON public.tenant_pending_counters;
CREATE POLICY tenant_pending_counters_staff_select
  ON public.tenant_pending_counters FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_pending_counters;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_pending_counters;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE OR REPLACE FUNCTION public.bump_user_counter(
  p_tenant_id uuid, p_user_id uuid, p_key text, p_delta integer
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL OR p_delta = 0 THEN RETURN; END IF;
  INSERT INTO public.user_pending_counters (tenant_id, user_id, counter_key, value)
  VALUES (p_tenant_id, p_user_id, p_key, GREATEST(0, p_delta))
  ON CONFLICT (user_id, counter_key) DO UPDATE
    SET value = GREATEST(0, public.user_pending_counters.value + p_delta),
        updated_at = now();
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_tenant_counter(
  p_tenant_id uuid, p_key text, p_delta integer
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_delta = 0 THEN RETURN; END IF;
  INSERT INTO public.tenant_pending_counters (tenant_id, counter_key, value)
  VALUES (p_tenant_id, p_key, GREATEST(0, p_delta))
  ON CONFLICT (tenant_id, counter_key) DO UPDATE
    SET value = GREATEST(0, public.tenant_pending_counters.value + p_delta),
        updated_at = now();
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bump_user_counter(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_tenant_counter(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_user_counter(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_tenant_counter(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.recompute_user_pending_counters(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_notifications integer;
  v_chat integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  SELECT count(*)::integer INTO v_notifications
    FROM public.notifications WHERE user_id = p_user_id AND read_at IS NULL;
  SELECT COALESCE(sum(unread_count), 0)::integer INTO v_chat
    FROM public.conversation_participants WHERE user_id = p_user_id;

  INSERT INTO public.user_pending_counters (tenant_id, user_id, counter_key, value)
  VALUES
    (v_tenant, p_user_id, 'notifications_unread', v_notifications),
    (v_tenant, p_user_id, 'chat_unread', v_chat)
  ON CONFLICT (user_id, counter_key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_my_pending_counters()
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.recompute_user_pending_counters(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.recompute_tenant_pending_counters(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comments integer;
  v_leads integer;
BEGIN
  IF p_tenant_id IS NULL THEN RETURN; END IF;
  SELECT count(*)::integer INTO v_comments
    FROM public.comments WHERE tenant_id = p_tenant_id AND status = 'pending';
  SELECT count(*)::integer INTO v_leads
    FROM public.crm_leads WHERE tenant_id = p_tenant_id AND stage = 'new';

  INSERT INTO public.tenant_pending_counters (tenant_id, counter_key, value)
  VALUES
    (p_tenant_id, 'comments_pending', v_comments),
    (p_tenant_id, 'crm_leads_new', v_leads)
  ON CONFLICT (tenant_id, counter_key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_user_pending_counters(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_tenant_pending_counters(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_my_pending_counters() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_user_pending_counters(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_tenant_pending_counters(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_my_pending_counters() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_notifications_counters()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.read_at IS NULL THEN
      PERFORM public.bump_user_counter(NEW.tenant_id, NEW.user_id, 'notifications_unread', 1);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.read_at IS NULL AND NEW.read_at IS NOT NULL THEN
      PERFORM public.bump_user_counter(NEW.tenant_id, NEW.user_id, 'notifications_unread', -1);
    ELSIF OLD.read_at IS NOT NULL AND NEW.read_at IS NULL THEN
      PERFORM public.bump_user_counter(NEW.tenant_id, NEW.user_id, 'notifications_unread', 1);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.read_at IS NULL THEN
      PERFORM public.bump_user_counter(OLD.tenant_id, OLD.user_id, 'notifications_unread', -1);
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_counters ON public.notifications;
CREATE TRIGGER trg_notifications_counters
  AFTER INSERT OR UPDATE OR DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_notifications_counters();

CREATE OR REPLACE FUNCTION public.tg_participants_counters()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.unread_count > 0 THEN
      PERFORM public.bump_user_counter(NEW.tenant_id, NEW.user_id, 'chat_unread', NEW.unread_count);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.unread_count <> OLD.unread_count THEN
      PERFORM public.bump_user_counter(
        NEW.tenant_id, NEW.user_id, 'chat_unread', NEW.unread_count - OLD.unread_count
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.unread_count > 0 THEN
      PERFORM public.bump_user_counter(OLD.tenant_id, OLD.user_id, 'chat_unread', -OLD.unread_count);
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_participants_counters ON public.conversation_participants;
CREATE TRIGGER trg_participants_counters
  AFTER INSERT OR UPDATE OR DELETE ON public.conversation_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_participants_counters();

CREATE OR REPLACE FUNCTION public.tg_comments_counters()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      PERFORM public.bump_tenant_counter(NEW.tenant_id, 'comments_pending', 1);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
      PERFORM public.bump_tenant_counter(NEW.tenant_id, 'comments_pending', -1);
    ELSIF OLD.status <> 'pending' AND NEW.status = 'pending' THEN
      PERFORM public.bump_tenant_counter(NEW.tenant_id, 'comments_pending', 1);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'pending' THEN
      PERFORM public.bump_tenant_counter(OLD.tenant_id, 'comments_pending', -1);
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_comments_counters ON public.comments;
CREATE TRIGGER trg_comments_counters
  AFTER INSERT OR UPDATE OR DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_comments_counters();

CREATE OR REPLACE FUNCTION public.tg_crm_leads_counters()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage = 'new' THEN
      PERFORM public.bump_tenant_counter(NEW.tenant_id, 'crm_leads_new', 1);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.stage = 'new' AND NEW.stage <> 'new' THEN
      PERFORM public.bump_tenant_counter(NEW.tenant_id, 'crm_leads_new', -1);
    ELSIF OLD.stage <> 'new' AND NEW.stage = 'new' THEN
      PERFORM public.bump_tenant_counter(NEW.tenant_id, 'crm_leads_new', 1);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.stage = 'new' THEN
      PERFORM public.bump_tenant_counter(OLD.tenant_id, 'crm_leads_new', -1);
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_leads_counters ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_counters
  AFTER INSERT OR UPDATE OR DELETE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_leads_counters();

DO $$
DECLARE
  v_user uuid;
  v_tenant uuid;
BEGIN
  FOR v_user IN SELECT id FROM public.profiles LOOP
    PERFORM public.recompute_user_pending_counters(v_user);
  END LOOP;
  FOR v_tenant IN SELECT id FROM public.tenants LOOP
    PERFORM public.recompute_tenant_pending_counters(v_tenant);
  END LOOP;
END $$;