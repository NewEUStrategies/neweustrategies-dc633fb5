-- Builder enhancements: global widgets, popup documents, section A/B experiments.
--
-- NOTE (version dedup): this file originally shared version 20260702090000 with
-- workflow_status_values.sql, which breaks `supabase db reset` / `db push` /
-- `db test` on fresh environments (duplicate migration version). It was renamed
-- to 20260702085900, preserving the effective apply order (it sorted before the
-- workflow file alphabetically). Environments that already applied it under the
-- shared version should reconcile history with:
--   supabase migration repair --status applied 20260702085900
--
-- 1) builder_global_widgets - a widget saved once and referenced by many pages.
--    Instances embed a snapshot (SSR fallback) + `globalId`; the live record is
--    the source of truth and is overlaid client-side, so editing a global
--    updates every page that references it.
-- 2) builder_popups - popups authored with the visual builder (builder_data)
--    plus display/trigger settings (settings jsonb). Only `active` popups are
--    readable by anonymous visitors.
-- 3) builder_experiments + builder_experiment_events - section-level A/B tests.
--    Variant tagging lives in the page document (advanced.abTest); the tables
--    hold the experiment registry and exposure/conversion events.

-- NOTE (from-zero type repair): status columns are typed with the SAME enums
-- the re-deploy bundle 20260702114108 creates on live environments. The
-- original text + CHECK version made every from-zero replay (supabase db
-- reset / db test) diverge from production and then fail at
-- 20260703052115 ("popups public read active" casts to the enum). Live
-- environments have this file marked applied-without-running (see the repair
-- note above), so changing it affects only fresh replays - and makes them
-- byte-compatible with production.
DO $$ BEGIN
  CREATE TYPE public.builder_popup_status AS ENUM ('draft','active','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.builder_experiment_status AS ENUM ('running','paused','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 1) Global widgets
-- ---------------------------------------------------------------------------
CREATE TABLE public.builder_global_widgets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  name text NOT NULL,
  data jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX builder_global_widgets_tenant_created_idx
  ON public.builder_global_widgets (tenant_id, created_at DESC);

-- Anonymous visitors must resolve globals to render public pages.
GRANT SELECT ON public.builder_global_widgets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_global_widgets TO authenticated;
GRANT ALL ON public.builder_global_widgets TO service_role;

ALTER TABLE public.builder_global_widgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bgw_public_read"
  ON public.builder_global_widgets FOR SELECT
  USING (true);

CREATE POLICY "bgw_insert_tenant"
  ON public.builder_global_widgets FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND auth.uid() = created_by
  );

CREATE POLICY "bgw_update_tenant"
  ON public.builder_global_widgets FOR UPDATE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      auth.uid() = created_by
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
    )
  )
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "bgw_delete_tenant"
  ON public.builder_global_widgets FOR DELETE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      auth.uid() = created_by
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
    )
  );

CREATE TRIGGER trg_builder_global_widgets_updated_at
BEFORE UPDATE ON public.builder_global_widgets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Popups
-- ---------------------------------------------------------------------------
CREATE TABLE public.builder_popups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  name text NOT NULL,
  status public.builder_popup_status NOT NULL DEFAULT 'draft',
  builder_data jsonb NOT NULL DEFAULT '{"version":1,"sections":[]}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX builder_popups_tenant_created_idx
  ON public.builder_popups (tenant_id, created_at DESC);
CREATE INDEX builder_popups_status_idx
  ON public.builder_popups (status);

GRANT SELECT ON public.builder_popups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_popups TO authenticated;
GRANT ALL ON public.builder_popups TO service_role;

ALTER TABLE public.builder_popups ENABLE ROW LEVEL SECURITY;

-- Visitors may only read popups that are live.
CREATE POLICY "popups_public_read_active"
  ON public.builder_popups FOR SELECT TO anon
  USING (status = 'active');

CREATE POLICY "popups_read_tenant"
  ON public.builder_popups FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR status = 'active');

CREATE POLICY "popups_insert_tenant"
  ON public.builder_popups FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND auth.uid() = created_by
  );

CREATE POLICY "popups_update_tenant"
  ON public.builder_popups FOR UPDATE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      auth.uid() = created_by
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
    )
  )
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "popups_delete_tenant"
  ON public.builder_popups FOR DELETE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      auth.uid() = created_by
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
    )
  );

CREATE TRIGGER trg_builder_popups_updated_at
BEFORE UPDATE ON public.builder_popups
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) A/B experiments
-- ---------------------------------------------------------------------------
CREATE TABLE public.builder_experiments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  name text NOT NULL,
  status public.builder_experiment_status NOT NULL DEFAULT 'running',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX builder_experiments_tenant_created_idx
  ON public.builder_experiments (tenant_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_experiments TO authenticated;
GRANT ALL ON public.builder_experiments TO service_role;

ALTER TABLE public.builder_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bx_read_tenant"
  ON public.builder_experiments FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "bx_insert_tenant"
  ON public.builder_experiments FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND auth.uid() = created_by
  );

CREATE POLICY "bx_update_tenant"
  ON public.builder_experiments FOR UPDATE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      auth.uid() = created_by
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
    )
  )
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "bx_delete_tenant"
  ON public.builder_experiments FOR DELETE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      auth.uid() = created_by
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
    )
  );

CREATE TRIGGER trg_builder_experiments_updated_at
BEFORE UPDATE ON public.builder_experiments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Anonymous exposure/conversion writes are only allowed against a running
-- experiment; the check runs as a SECURITY DEFINER fn because anon has no
-- SELECT on builder_experiments.
CREATE OR REPLACE FUNCTION public.is_experiment_running(_experiment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.builder_experiments
    WHERE id = _experiment_id AND status = 'running'
  )
$$;

CREATE TABLE public.builder_experiment_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES public.builder_experiments(id) ON DELETE CASCADE,
  variant text NOT NULL CHECK (variant IN ('a', 'b')),
  event text NOT NULL CHECK (event IN ('exposure', 'conversion')),
  visitor_id text NOT NULL,
  path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX builder_experiment_events_agg_idx
  ON public.builder_experiment_events (experiment_id, variant, event);

GRANT INSERT ON public.builder_experiment_events TO anon;
GRANT SELECT, INSERT, DELETE ON public.builder_experiment_events TO authenticated;
GRANT ALL ON public.builder_experiment_events TO service_role;

ALTER TABLE public.builder_experiment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bxe_insert_public"
  ON public.builder_experiment_events FOR INSERT
  WITH CHECK (is_experiment_running(experiment_id));

CREATE POLICY "bxe_read_tenant"
  ON public.builder_experiment_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.builder_experiments e
      WHERE e.id = experiment_id AND e.tenant_id = current_tenant_id()
    )
  );

CREATE POLICY "bxe_delete_tenant"
  ON public.builder_experiment_events FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.builder_experiments e
      WHERE e.id = experiment_id AND e.tenant_id = current_tenant_id()
    )
  );
