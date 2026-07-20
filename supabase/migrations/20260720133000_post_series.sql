-- Serie / dossier (A8): sekwencyjne cykle analiz ("część 2 z 5") - format
-- flagowy think-tanków (cykle przedwyborcze, sankcyjne, energetyczne).
--
--   * series: nazwa/opis PL+EN, slug per tenant,
--   * post_series: przypięcie wpisu do JEDNEJ serii (UNIQUE post_id)
--     z numerem części; kolejność = part_number,
--   * publicznie: nagłówek serii na wpisie + nawigacja część wstecz/naprzód
--     + strona /series/$slug; RLS jak post_authors (widoczne tylko to, co
--     wynika z opublikowanych wpisów tenanta hosta).
CREATE TABLE IF NOT EXISTS public.series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  slug text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL DEFAULT '',
  description_pl text,
  description_en text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS public.post_series (
  post_id uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  part_number integer NOT NULL DEFAULT 1 CHECK (part_number >= 1 AND part_number <= 999),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_series_series
  ON public.post_series (series_id, part_number);

GRANT SELECT ON public.series, public.post_series TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.series, public.post_series TO authenticated;
GRANT ALL ON public.series, public.post_series TO service_role;

ALTER TABLE public.series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_series ENABLE ROW LEVEL SECURITY;

-- Serie tenanta bieżącego hosta są jawne (nazwy cykli nie są sekretem).
DROP POLICY IF EXISTS "series public read" ON public.series;
CREATE POLICY "series public read" ON public.series
  FOR SELECT USING (tenant_id = public_tenant_id());

DROP POLICY IF EXISTS "series staff manage" ON public.series;
CREATE POLICY "series staff manage" ON public.series
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

-- Przypięcia: publicznie tylko dla opublikowanych wpisów (jak post_authors);
-- staff widzi i edytuje całość w swoim tenancie (w tym szkice serii).
DROP POLICY IF EXISTS "post_series public read" ON public.post_series;
CREATE POLICY "post_series public read" ON public.post_series
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_series.post_id
         AND p.tenant_id = public_tenant_id()
         AND p.status = 'published'
         AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "post_series staff manage" ON public.post_series;
CREATE POLICY "post_series staff manage" ON public.post_series
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_series.post_id
         AND p.tenant_id = public.current_tenant_id()
    ) AND public.is_staff()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_series.post_id
         AND p.tenant_id = public.current_tenant_id()
    ) AND public.is_staff()
  );
