ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS publish_at timestamptz;

CREATE INDEX IF NOT EXISTS posts_scheduled_due_idx
  ON public.posts (publish_at)
  WHERE status = 'scheduled' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.can_publish_content(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::app_role)
      OR public.has_role(_user_id, 'super_admin'::app_role)
$$;

REVOKE ALL ON FUNCTION public.can_publish_content(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_publish_content(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_post_workflow()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('published', 'scheduled')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NOT public.can_publish_content(auth.uid()) THEN
    RAISE EXCEPTION 'workflow: publishing or scheduling requires an admin role'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'scheduled' AND NEW.publish_at IS NULL THEN
    RAISE EXCEPTION 'workflow: a scheduled post requires publish_at'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_workflow_guard ON public.posts;
CREATE TRIGGER posts_workflow_guard
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_workflow();

CREATE OR REPLACE FUNCTION public.publish_due_posts()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  UPDATE public.posts
     SET status = 'published',
         published_at = COALESCE(publish_at, now())
   WHERE status = 'scheduled'
     AND deleted_at IS NULL
     AND publish_at IS NOT NULL
     AND publish_at <= now();
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_due_posts() FROM public;
GRANT EXECUTE ON FUNCTION public.publish_due_posts() TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('publish-due-posts', '* * * * *', 'SELECT public.publish_due_posts()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - scheduled posts publish via opportunistic ticks only';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END;
$$;

DROP POLICY IF EXISTS "revisions admin delete" ON public.content_revisions;
CREATE POLICY "revisions admin delete"
ON public.content_revisions FOR DELETE TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.can_publish_content(auth.uid())
);

GRANT DELETE ON public.content_revisions TO authenticated;