
CREATE TABLE public.site_settings_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  operation text NOT NULL DEFAULT 'update',
  note text
);

CREATE INDEX site_settings_revisions_lookup_idx
  ON public.site_settings_revisions (tenant_id, key, changed_at DESC);

GRANT SELECT, INSERT ON public.site_settings_revisions TO authenticated;
GRANT ALL ON public.site_settings_revisions TO service_role;

ALTER TABLE public.site_settings_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_settings_revisions admin read"
  ON public.site_settings_revisions FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  );

CREATE POLICY "site_settings_revisions admin insert"
  ON public.site_settings_revisions FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND has_role(auth.uid(), 'admin'::app_role)
  );

CREATE OR REPLACE FUNCTION public.snapshot_site_settings_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.value IS DISTINCT FROM NEW.value THEN
      INSERT INTO public.site_settings_revisions (tenant_id, key, value, changed_by, operation)
      VALUES (OLD.tenant_id, OLD.key, OLD.value, OLD.updated_by, 'update');
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.site_settings_revisions (tenant_id, key, value, changed_by, operation)
    VALUES (OLD.tenant_id, OLD.key, OLD.value, OLD.updated_by, 'delete');
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_site_settings_snapshot ON public.site_settings;
CREATE TRIGGER trg_site_settings_snapshot
  BEFORE UPDATE OR DELETE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_site_settings_revision();
