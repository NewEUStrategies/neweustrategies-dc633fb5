-- 1) Legal document versions -----------------------------------------------
CREATE TABLE public.legal_document_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  doc_key text NOT NULL CHECK (doc_key IN ('terms', 'privacy', 'refunds')),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  content jsonb NOT NULL,
  note text,
  effective_from timestamptz,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ldv_tenant_doc_created
  ON public.legal_document_versions (tenant_id, doc_key, created_at DESC);

CREATE UNIQUE INDEX idx_ldv_one_published
  ON public.legal_document_versions (tenant_id, doc_key)
  WHERE status = 'published';

GRANT SELECT ON public.legal_document_versions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_document_versions TO authenticated;
GRANT ALL ON public.legal_document_versions TO service_role;

ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ldv_public_read_published"
  ON public.legal_document_versions FOR SELECT TO anon, authenticated
  USING (status = 'published' AND tenant_id = public.public_tenant_id());

CREATE POLICY "ldv_staff_read"
  ON public.legal_document_versions FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role)
         OR public.has_role(auth.uid(), 'editor'::app_role))
  );

CREATE POLICY "ldv_staff_insert"
  ON public.legal_document_versions FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role)
         OR public.has_role(auth.uid(), 'editor'::app_role))
  );

CREATE POLICY "ldv_staff_update"
  ON public.legal_document_versions FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role)
         OR public.has_role(auth.uid(), 'editor'::app_role))
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "ldv_staff_delete"
  ON public.legal_document_versions FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role))
  );

CREATE TRIGGER trg_ldv_touch
  BEFORE UPDATE ON public.legal_document_versions
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- Atomic publish: exactly one published version per (tenant, doc_key).
CREATE OR REPLACE FUNCTION public.publish_legal_version(_id uuid)
RETURNS public.legal_document_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.legal_document_versions;
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_role(auth.uid(), 'super_admin'::app_role)
          OR public.has_role(auth.uid(), 'editor'::app_role)) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row
  FROM public.legal_document_versions
  WHERE id = _id AND tenant_id = v_tenant
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'legal_version_not_found';
  END IF;

  UPDATE public.legal_document_versions
     SET status = 'archived'
   WHERE tenant_id = v_tenant
     AND doc_key = v_row.doc_key
     AND status = 'published'
     AND id <> _id;

  UPDATE public.legal_document_versions
     SET status = 'published',
         published_at = now(),
         effective_from = COALESCE(effective_from, now())
   WHERE id = _id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_legal_version(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.publish_legal_version(uuid) TO authenticated;

-- 2) Builder revisions (global widgets + popups) ------------------------------
CREATE TABLE public.builder_revisions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  entity_type text NOT NULL CHECK (entity_type IN ('global_widget', 'popup')),
  entity_id uuid NOT NULL,
  name text NOT NULL,
  data jsonb NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brev_entity_created
  ON public.builder_revisions (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_brev_tenant_created
  ON public.builder_revisions (tenant_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.builder_revisions TO authenticated;
GRANT ALL ON public.builder_revisions TO service_role;

ALTER TABLE public.builder_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brev_staff_read"
  ON public.builder_revisions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE POLICY "brev_staff_insert"
  ON public.builder_revisions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

CREATE POLICY "brev_delete_own_or_admin"
  ON public.builder_revisions FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (created_by = auth.uid()
         OR public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role))
  );

CREATE OR REPLACE FUNCTION public.snapshot_global_widget()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.data IS NOT DISTINCT FROM OLD.data
     AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.builder_revisions (tenant_id, entity_type, entity_id, name, data, created_by)
  VALUES (NEW.tenant_id, 'global_widget', NEW.id, NEW.name, NEW.data, auth.uid());

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_snapshot_global_widget
AFTER INSERT OR UPDATE ON public.builder_global_widgets
FOR EACH ROW EXECUTE FUNCTION public.snapshot_global_widget();

CREATE OR REPLACE FUNCTION public.snapshot_builder_popup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.builder_data IS NOT DISTINCT FROM OLD.builder_data
     AND NEW.settings IS NOT DISTINCT FROM OLD.settings
     AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.builder_revisions (tenant_id, entity_type, entity_id, name, data, created_by)
  VALUES (
    NEW.tenant_id,
    'popup',
    NEW.id,
    NEW.name,
    jsonb_build_object('builder_data', NEW.builder_data, 'settings', NEW.settings),
    auth.uid()
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_snapshot_builder_popup
AFTER INSERT OR UPDATE ON public.builder_popups
FOR EACH ROW EXECUTE FUNCTION public.snapshot_builder_popup();

-- Backfill: one baseline revision per existing entity.
INSERT INTO public.builder_revisions (tenant_id, entity_type, entity_id, name, data, created_at)
SELECT w.tenant_id, 'global_widget', w.id, w.name, w.data, w.created_at
FROM public.builder_global_widgets w
WHERE NOT EXISTS (
  SELECT 1 FROM public.builder_revisions r
  WHERE r.entity_type = 'global_widget' AND r.entity_id = w.id
);

INSERT INTO public.builder_revisions (tenant_id, entity_type, entity_id, name, data, created_at)
SELECT p.tenant_id, 'popup', p.id, p.name,
       jsonb_build_object('builder_data', p.builder_data, 'settings', p.settings),
       p.created_at
FROM public.builder_popups p
WHERE NOT EXISTS (
  SELECT 1 FROM public.builder_revisions r
  WHERE r.entity_type = 'popup' AND r.entity_id = p.id
);