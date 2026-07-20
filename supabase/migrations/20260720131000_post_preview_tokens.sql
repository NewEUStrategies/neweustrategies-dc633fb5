-- Linki podglądu z tokenem (B5, embargo/prasa): podpisany dostępem token
-- pozwala zobaczyć szkic wpisu BEZ konta - kluczowy przepływ think-tanku
-- (dziennikarze, partnerzy, rada przed premierą raportu).
--
-- Model bezpieczeństwa:
--   * tabela NIE ma żadnej polityki publicznego SELECT - anon/authenticated
--     nie czytają jej wprost; walidacja tokenu odbywa się w server fn przez
--     service role (fetchPreviewPost), z twardym sprawdzeniem expiry,
--   * token = 24 losowe bajty base64url (nieodgadywalny), unikalny,
--   * staff zarządza (lista/utworzenie/odwołanie) w swoim tenancie przez RLS,
--   * podgląd renderuje się z noindex + X-Robots-Tag (trasa /preview/$token).
CREATE TABLE IF NOT EXISTS public.post_preview_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_preview_tokens_post
  ON public.post_preview_tokens (post_id, expires_at DESC);

GRANT SELECT, INSERT, DELETE ON public.post_preview_tokens TO authenticated;
GRANT ALL ON public.post_preview_tokens TO service_role;

ALTER TABLE public.post_preview_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "preview tokens staff manage" ON public.post_preview_tokens;
CREATE POLICY "preview tokens staff manage" ON public.post_preview_tokens
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());
