-- PR #525: tenant_id na zdarzeniach A/B (kopia supabase/migrations/20261019090000_builder_experiment_events_tenant_id.sql)
ALTER TABLE public.builder_experiment_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.builder_experiment_events_bind_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT e.tenant_id INTO v_tenant
    FROM public.builder_experiments e
   WHERE e.id = NEW.experiment_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'builder_experiment_events: eksperyment % nie istnieje', NEW.experiment_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.builder_experiment_events_bind_tenant() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.builder_experiment_events_bind_tenant() IS
  'Trigger: tenant_id zdarzenia A/B zawsze z builder_experiments.tenant_id (experiment_id); wartosc z ladunku jest nadpisywana.';

DROP TRIGGER IF EXISTS trg_builder_experiment_events_bind_tenant ON public.builder_experiment_events;
CREATE TRIGGER trg_builder_experiment_events_bind_tenant
  BEFORE INSERT OR UPDATE OF experiment_id, tenant_id ON public.builder_experiment_events
  FOR EACH ROW EXECUTE FUNCTION public.builder_experiment_events_bind_tenant();

CREATE OR REPLACE FUNCTION public.builder_experiments_cascade_tenant_to_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.builder_experiment_events ev
     SET tenant_id = NEW.tenant_id
   WHERE ev.experiment_id = NEW.id
     AND ev.tenant_id IS DISTINCT FROM NEW.tenant_id;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.builder_experiments_cascade_tenant_to_events() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.builder_experiments_cascade_tenant_to_events() IS
  'Trigger: zmiana builder_experiments.tenant_id przepina tenant_id wszystkich zdarzen eksperymentu.';

DROP TRIGGER IF EXISTS trg_builder_experiments_cascade_tenant_to_events ON public.builder_experiments;
CREATE TRIGGER trg_builder_experiments_cascade_tenant_to_events
  AFTER UPDATE OF tenant_id ON public.builder_experiments
  FOR EACH ROW
  WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION public.builder_experiments_cascade_tenant_to_events();

UPDATE public.builder_experiment_events ev
   SET tenant_id = e.tenant_id
  FROM public.builder_experiments e
 WHERE e.id = ev.experiment_id
   AND ev.tenant_id IS DISTINCT FROM e.tenant_id;

ALTER TABLE public.builder_experiment_events
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS builder_experiment_events_tenant_lookup_idx
  ON public.builder_experiment_events (tenant_id, experiment_id, variant, event);

COMMENT ON INDEX public.builder_experiment_events_tenant_lookup_idx IS
  'Liczniki panelu A/B (tenant_id, experiment_id, variant, event) i polityki SELECT/DELETE po tenant_id.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'builder_experiment_events'
                AND policyname = 'experiment events tenant admin read') THEN
    DROP POLICY IF EXISTS "experiment events tenant admin read" ON public.builder_experiment_events;
    CREATE POLICY "experiment events tenant admin read"
      ON public.builder_experiment_events FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.is_staff());
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'builder_experiment_events'
                AND policyname = 'experiment events tenant admin delete') THEN
    DROP POLICY IF EXISTS "experiment events tenant admin delete" ON public.builder_experiment_events;
    CREATE POLICY "experiment events tenant admin delete"
      ON public.builder_experiment_events FOR DELETE TO authenticated
      USING (tenant_id = public.current_tenant_id()
             AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'builder_experiment_events'
                AND policyname = 'bxe_read_tenant') THEN
    DROP POLICY IF EXISTS "bxe_read_tenant" ON public.builder_experiment_events;
    CREATE POLICY "bxe_read_tenant"
      ON public.builder_experiment_events FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id());
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'builder_experiment_events'
                AND policyname = 'bxe_delete_tenant') THEN
    DROP POLICY IF EXISTS "bxe_delete_tenant" ON public.builder_experiment_events;
    CREATE POLICY "bxe_delete_tenant"
      ON public.builder_experiment_events FOR DELETE TO authenticated
      USING (tenant_id = public.current_tenant_id());
  END IF;
END $$;