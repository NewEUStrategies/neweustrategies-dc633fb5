-- Monitor martwych linków wychodzących (B7) - odwrotność monitora 404
-- (tamten łapie ruch przychodzący): tło sprawdza linki zewnętrzne w
-- opublikowanych wpisach i raportuje zepsute w /admin/link-monitor.
-- Link rot to cichy koszt wiarygodności przypisów starych analiz.
CREATE TABLE IF NOT EXISTS public.outbound_link_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  url text NOT NULL,
  ok boolean NOT NULL,
  status_code integer,
  error text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, url)
);

CREATE INDEX IF NOT EXISTS idx_outbound_link_checks_broken
  ON public.outbound_link_checks (tenant_id, checked_at DESC)
  WHERE ok = false;

GRANT SELECT ON public.outbound_link_checks TO authenticated;
GRANT ALL ON public.outbound_link_checks TO service_role;

ALTER TABLE public.outbound_link_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "link checks staff read" ON public.outbound_link_checks;
CREATE POLICY "link checks staff read" ON public.outbound_link_checks
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

-- Kursor rotacji skanera: kolumna serwerowa (service role); świadomie POZA
-- listą kolumn grantu SELECT dla anon/authenticated (grant kolumnowy z
-- 20260702200000 wylicza kolumny istniejące wtedy - nowa kolumna zostaje
-- niewidoczna dla klientów, czego tu właśnie chcemy).
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS outbound_links_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_posts_link_check_due
  ON public.posts (outbound_links_checked_at NULLS FIRST)
  WHERE status = 'published' AND deleted_at IS NULL;
