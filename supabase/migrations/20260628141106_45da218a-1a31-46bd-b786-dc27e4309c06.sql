
CREATE TABLE IF NOT EXISTS public.icon_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('custom','flag','brand')),
  name text NOT NULL,
  label text,
  url_default text NOT NULL DEFAULT '',
  url_light text NOT NULL DEFAULT '',
  url_dark text NOT NULL DEFAULT '',
  default_variant text NOT NULL DEFAULT 'auto' CHECK (default_variant IN ('auto','light','dark','default')),
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, name)
);

CREATE INDEX IF NOT EXISTS icon_library_tenant_kind_idx ON public.icon_library (tenant_id, kind, position);

GRANT SELECT ON public.icon_library TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.icon_library TO authenticated;
GRANT ALL ON public.icon_library TO service_role;

ALTER TABLE public.icon_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Icon library is publicly readable"
  ON public.icon_library FOR SELECT
  USING (true);

CREATE POLICY "Editors manage icon library within tenant"
  ON public.icon_library FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

DROP TRIGGER IF EXISTS icon_library_set_updated_at ON public.icon_library;
CREATE TRIGGER icon_library_set_updated_at
  BEFORE UPDATE ON public.icon_library
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
