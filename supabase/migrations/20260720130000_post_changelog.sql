-- Publiczna historia aktualizacji analizy (A4).
--
-- Świadomie OSOBNA tabela, nie widok po content_revisions: rewizje to
-- techniczne snapshoty (autosave co chwilę, restore, prune do 50) - szum,
-- którego czytelnik nie ma oglądać. Wpis changelogu jest AKTEM REDAKCYJNYM:
-- "20.07: zaktualizowano dane o Q2", dodawanym świadomie w edytorze.
-- Publicznie renderuje się jako sekcja "Historia aktualizacji" pod analizą -
-- sygnał zaufania dla żywych analiz (odróżnia je od statycznych PDF-ów).
CREATE TABLE IF NOT EXISTS public.post_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  note_pl text NOT NULL,
  note_en text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_changelog_post
  ON public.post_changelog (post_id, entry_date DESC, created_at DESC);

GRANT SELECT ON public.post_changelog TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.post_changelog TO authenticated;
GRANT ALL ON public.post_changelog TO service_role;

ALTER TABLE public.post_changelog ENABLE ROW LEVEL SECURITY;

-- Czytelnik widzi historię wyłącznie opublikowanych wpisów tenanta bieżącego
-- hosta (public_tenant_id() - kanoniczny wzorzec anon-owych polityk, patrz
-- 20260713201355). Draft/kosz nie wyciekają nawet przez changelog.
DROP POLICY IF EXISTS "changelog public read" ON public.post_changelog;
CREATE POLICY "changelog public read" ON public.post_changelog
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_changelog.post_id
         AND p.tenant_id = public_tenant_id()
         AND p.tenant_id = post_changelog.tenant_id
         AND p.status = 'published'
         AND p.deleted_at IS NULL
    )
  );

-- Staff widzi i zarządza całością w swoim tenancie (także dla szkiców -
-- wpisy changelogu można przygotować przed publikacją).
DROP POLICY IF EXISTS "changelog staff read" ON public.post_changelog;
CREATE POLICY "changelog staff read" ON public.post_changelog
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS "changelog staff manage" ON public.post_changelog;
CREATE POLICY "changelog staff manage" ON public.post_changelog
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());
