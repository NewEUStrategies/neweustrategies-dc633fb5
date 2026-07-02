
-- Enums
DO $$ BEGIN
  CREATE TYPE public.builder_popup_status AS ENUM ('draft','active','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.builder_experiment_status AS ENUM ('running','paused','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.builder_experiment_event AS ENUM ('exposure','conversion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.builder_ab_variant AS ENUM ('a','b');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ builder_popups ============
CREATE TABLE IF NOT EXISTS public.builder_popups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  status public.builder_popup_status NOT NULL DEFAULT 'draft',
  builder_data jsonb NOT NULL DEFAULT '{"version":1,"sections":[]}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS builder_popups_tenant_idx ON public.builder_popups(tenant_id, status);

GRANT SELECT ON public.builder_popups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_popups TO authenticated;
GRANT ALL ON public.builder_popups TO service_role;

ALTER TABLE public.builder_popups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "popups public read active"
  ON public.builder_popups FOR SELECT
  USING (status = 'active');

CREATE POLICY "popups tenant staff read"
  ON public.builder_popups FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE POLICY "popups tenant staff insert"
  ON public.builder_popups FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE POLICY "popups tenant staff update"
  ON public.builder_popups FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE POLICY "popups tenant admin delete"
  ON public.builder_popups FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')));

CREATE TRIGGER builder_popups_updated_at
  BEFORE UPDATE ON public.builder_popups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ builder_global_widgets ============
CREATE TABLE IF NOT EXISTS public.builder_global_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS builder_global_widgets_tenant_idx ON public.builder_global_widgets(tenant_id);

GRANT SELECT ON public.builder_global_widgets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_global_widgets TO authenticated;
GRANT ALL ON public.builder_global_widgets TO service_role;

ALTER TABLE public.builder_global_widgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "global widgets public read"
  ON public.builder_global_widgets FOR SELECT
  USING (true);

CREATE POLICY "global widgets tenant staff insert"
  ON public.builder_global_widgets FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE POLICY "global widgets tenant staff update"
  ON public.builder_global_widgets FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE POLICY "global widgets tenant admin delete"
  ON public.builder_global_widgets FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')));

CREATE TRIGGER builder_global_widgets_updated_at
  BEFORE UPDATE ON public.builder_global_widgets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ builder_experiments ============
CREATE TABLE IF NOT EXISTS public.builder_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  status public.builder_experiment_status NOT NULL DEFAULT 'running',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS builder_experiments_tenant_idx ON public.builder_experiments(tenant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_experiments TO authenticated;
GRANT ALL ON public.builder_experiments TO service_role;

ALTER TABLE public.builder_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "experiments tenant staff read"
  ON public.builder_experiments FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE POLICY "experiments tenant staff insert"
  ON public.builder_experiments FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE POLICY "experiments tenant staff update"
  ON public.builder_experiments FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE POLICY "experiments tenant admin delete"
  ON public.builder_experiments FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')));

CREATE TRIGGER builder_experiments_updated_at
  BEFORE UPDATE ON public.builder_experiments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ builder_experiment_events ============
CREATE TABLE IF NOT EXISTS public.builder_experiment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.builder_experiments(id) ON DELETE CASCADE,
  variant public.builder_ab_variant NOT NULL,
  event public.builder_experiment_event NOT NULL,
  visitor_id text NOT NULL,
  path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS builder_experiment_events_lookup_idx
  ON public.builder_experiment_events(experiment_id, variant, event);

GRANT INSERT ON public.builder_experiment_events TO anon, authenticated;
GRANT SELECT, DELETE ON public.builder_experiment_events TO authenticated;
GRANT ALL ON public.builder_experiment_events TO service_role;

ALTER TABLE public.builder_experiment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "experiment events public insert"
  ON public.builder_experiment_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "experiment events tenant admin read"
  ON public.builder_experiment_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.builder_experiments e
     WHERE e.id = experiment_id
       AND e.tenant_id = public.current_tenant_id()
       AND public.is_staff()
  ));

CREATE POLICY "experiment events tenant admin delete"
  ON public.builder_experiment_events FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.builder_experiments e
     WHERE e.id = experiment_id
       AND e.tenant_id = public.current_tenant_id()
       AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  ));
