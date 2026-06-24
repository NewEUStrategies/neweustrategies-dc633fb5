-- 1) ad_slots
CREATE TYPE public.ad_slot_kind AS ENUM ('html', 'script', 'image');
CREATE TYPE public.ad_slot_status AS ENUM ('active', 'paused');

CREATE TABLE public.ad_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind public.ad_slot_kind NOT NULL DEFAULT 'html',
  status public.ad_slot_status NOT NULL DEFAULT 'active',
  html text,
  script text,
  image_url text,
  image_link text,
  image_alt text,
  width int,
  height int,
  requires_consent boolean NOT NULL DEFAULT true,
  targeting jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_slots TO authenticated;
GRANT SELECT ON public.ad_slots TO anon;
GRANT ALL ON public.ad_slots TO service_role;

ALTER TABLE public.ad_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active ad_slots"
  ON public.ad_slots FOR SELECT
  USING (status = 'active');

CREATE POLICY "Admins/editors manage ad_slots in tenant"
  ON public.ad_slots FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

CREATE TRIGGER ad_slots_set_updated_at
  BEFORE UPDATE ON public.ad_slots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX ad_slots_tenant_status_idx ON public.ad_slots (tenant_id, status);

-- 2) ad_placements
CREATE TYPE public.ad_position AS ENUM (
  'header_banner',
  'top_of_post',
  'mid_post',
  'bottom_of_post',
  'sidebar',
  'in_feed',
  'footer_slideup'
);

CREATE TYPE public.ad_page_type AS ENUM (
  'all',
  'home',
  'post',
  'page',
  'category',
  'tag',
  'archive',
  'search'
);

CREATE TABLE public.ad_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES public.ad_slots(id) ON DELETE CASCADE,
  position public.ad_position NOT NULL,
  page_type public.ad_page_type NOT NULL DEFAULT 'all',
  page_id uuid,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_placements TO authenticated;
GRANT SELECT ON public.ad_placements TO anon;
GRANT ALL ON public.ad_placements TO service_role;

ALTER TABLE public.ad_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active ad_placements"
  ON public.ad_placements FOR SELECT
  USING (
    active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at > now())
  );

CREATE POLICY "Admins/editors manage ad_placements in tenant"
  ON public.ad_placements FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

CREATE TRIGGER ad_placements_set_updated_at
  BEFORE UPDATE ON public.ad_placements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX ad_placements_tenant_position_idx
  ON public.ad_placements (tenant_id, position, page_type)
  WHERE active = true;

CREATE INDEX ad_placements_slot_idx ON public.ad_placements (slot_id);
