-- Słowniczek pojęć (A7): terminy polityki europejskiej ("akt delegowany",
-- "TSI", "dual-use") z definicjami PL/EN. Pierwsze wystąpienie terminu w
-- treści wpisu dostaje tooltip (GlossaryHighlighter - mechanika jak dymki
-- przypisów), całość ma publiczną stronę /glossary z JSON-LD DefinedTerm.
CREATE TABLE IF NOT EXISTS public.glossary_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  slug text NOT NULL,
  term_pl text NOT NULL,
  term_en text NOT NULL DEFAULT '',
  definition_pl text NOT NULL,
  definition_en text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_glossary_terms_tenant
  ON public.glossary_terms (tenant_id, term_pl);

GRANT SELECT ON public.glossary_terms TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.glossary_terms TO authenticated;
GRANT ALL ON public.glossary_terms TO service_role;

ALTER TABLE public.glossary_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "glossary public read" ON public.glossary_terms;
CREATE POLICY "glossary public read" ON public.glossary_terms
  FOR SELECT USING (tenant_id = public_tenant_id());

DROP POLICY IF EXISTS "glossary staff manage" ON public.glossary_terms;
CREATE POLICY "glossary staff manage" ON public.glossary_terms
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());
