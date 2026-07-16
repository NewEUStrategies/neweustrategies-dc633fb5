
CREATE TABLE public.menus (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

GRANT SELECT ON public.menus TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menus TO authenticated;
GRANT ALL ON public.menus TO service_role;

ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "menus_read_public" ON public.menus
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "menus_staff_insert" ON public.menus
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
    AND tenant_id = public.current_tenant_id()
  );

CREATE POLICY "menus_staff_update" ON public.menus
  FOR UPDATE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
    AND tenant_id = public.current_tenant_id()
  )
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
    AND tenant_id = public.current_tenant_id()
  );

CREATE POLICY "menus_staff_delete" ON public.menus
  FOR DELETE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
    AND tenant_id = public.current_tenant_id()
  );

CREATE TRIGGER menus_set_updated_at
  BEFORE UPDATE ON public.menus
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TYPE public.menu_item_type AS ENUM ('page','post','category','tag','custom');

CREATE TABLE public.menu_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  menu_id UUID NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.menu_items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  item_type public.menu_item_type NOT NULL,
  ref_id UUID,
  label_pl TEXT NOT NULL DEFAULT '',
  label_en TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '_self',
  css_class TEXT NOT NULL DEFAULT '',
  mega_enabled BOOLEAN NOT NULL DEFAULT false,
  mega_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX menu_items_menu_id_idx ON public.menu_items (menu_id, position);
CREATE INDEX menu_items_parent_idx ON public.menu_items (parent_id);

GRANT SELECT ON public.menu_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO authenticated;
GRANT ALL ON public.menu_items TO service_role;

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "menu_items_read_public" ON public.menu_items
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "menu_items_staff_insert" ON public.menu_items
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
    AND EXISTS (
      SELECT 1 FROM public.menus m
      WHERE m.id = menu_items.menu_id
        AND m.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY "menu_items_staff_update" ON public.menu_items
  FOR UPDATE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
    AND EXISTS (
      SELECT 1 FROM public.menus m
      WHERE m.id = menu_items.menu_id
        AND m.tenant_id = public.current_tenant_id()
    )
  )
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
    AND EXISTS (
      SELECT 1 FROM public.menus m
      WHERE m.id = menu_items.menu_id
        AND m.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY "menu_items_staff_delete" ON public.menu_items
  FOR DELETE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
    AND EXISTS (
      SELECT 1 FROM public.menus m
      WHERE m.id = menu_items.menu_id
        AND m.tenant_id = public.current_tenant_id()
    )
  );

CREATE TRIGGER menu_items_set_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.menus (tenant_id, key, name)
SELECT id, 'main', 'Menu główne' FROM public.tenants
ON CONFLICT (tenant_id, key) DO NOTHING;
