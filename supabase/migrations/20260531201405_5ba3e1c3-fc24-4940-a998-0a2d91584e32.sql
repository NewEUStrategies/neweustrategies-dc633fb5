-- 1) Revisions table
CREATE TABLE public.builder_template_revisions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES public.builder_templates(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  data jsonb NOT NULL,
  name text NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_btr_template_created ON public.builder_template_revisions (template_id, created_at DESC);
CREATE INDEX idx_btr_tenant_created ON public.builder_template_revisions (tenant_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.builder_template_revisions TO authenticated;
GRANT ALL ON public.builder_template_revisions TO service_role;

ALTER TABLE public.builder_template_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "btr_read_tenant"
  ON public.builder_template_revisions FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

-- Inserts happen via trigger (SECURITY DEFINER); we still allow direct inserts within tenant for flexibility.
CREATE POLICY "btr_insert_tenant"
  ON public.builder_template_revisions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "btr_delete_own_or_admin"
  ON public.builder_template_revisions FOR DELETE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  );

-- 2) Allow updating templates (owner / editor / admin within tenant)
CREATE POLICY "templates_update_tenant"
  ON public.builder_templates FOR UPDATE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      auth.uid() = created_by
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
    )
  )
  WITH CHECK (tenant_id = current_tenant_id());

-- 3) Trigger: snapshot to revisions on INSERT and UPDATE
CREATE OR REPLACE FUNCTION public.snapshot_builder_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.data IS NOT DISTINCT FROM OLD.data AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.builder_template_revisions (template_id, tenant_id, data, name, created_by)
  VALUES (NEW.id, NEW.tenant_id, NEW.data, NEW.name, auth.uid());

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_snapshot_builder_template
AFTER INSERT OR UPDATE ON public.builder_templates
FOR EACH ROW
EXECUTE FUNCTION public.snapshot_builder_template();

-- 4) Backfill: initial revision for every existing template
INSERT INTO public.builder_template_revisions (template_id, tenant_id, data, name, created_by, created_at)
SELECT t.id, t.tenant_id, t.data, t.name, t.created_by, t.created_at
FROM public.builder_templates t
WHERE NOT EXISTS (
  SELECT 1 FROM public.builder_template_revisions r WHERE r.template_id = t.id
);