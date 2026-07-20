-- Feedback przydatności analizy (A9): jednokliknięciowe "przydatna / nie".
-- Zapis wyłącznie przez server fn (service role, tenant pinowany po hoście,
-- rate limit per IP) - tabela nie ma żadnych polityk anon INSERT. Odczyt
-- zbiorczy: staff (tenant); czytelnik dostaje tylko podziękowanie.
CREATE TABLE IF NOT EXISTS public.post_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  helpful boolean NOT NULL,
  -- Skrót IP+UA (sha256, hex) do deduplikacji nadużyć - bez surowego PII.
  voter_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_feedback_post
  ON public.post_feedback (post_id, created_at DESC);

GRANT SELECT ON public.post_feedback TO authenticated;
GRANT ALL ON public.post_feedback TO service_role;

ALTER TABLE public.post_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback staff read" ON public.post_feedback;
CREATE POLICY "feedback staff read" ON public.post_feedback
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());
