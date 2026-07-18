-- ============================================================================
-- Kreator treści kampanii newslettera - dokument bloków zamiast surowej
-- textarea HTML.
--
-- Wzorzec platformy (posts/pages): dyskryminator `editor` + równoległe kolumny
-- treści; autorytatywna jest ta wskazana przez `editor`:
--   editor='html' -> html_pl / html_en (legacy, pełna kompatybilność wstecz)
--   editor='doc'  -> content_doc (jsonb, model EmailDoc z
--                    src/lib/newsletter/emailDoc.ts; render do e-mail-safe
--                    HTML per język w momencie wysyłki - blok "najnowsze
--                    wpisy" rozwiązuje się świeżo przy wysyłce)
--
-- Istniejące kampanie zostają na 'html' (zero zmian zachowania); nowe
-- kampanie tworzone w UI startują jako 'doc'.
--
-- Idempotentne.
-- ============================================================================

ALTER TABLE public.newsletter_campaigns
  ADD COLUMN IF NOT EXISTS editor text NOT NULL DEFAULT 'html',
  ADD COLUMN IF NOT EXISTS content_doc jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'newsletter_campaigns_editor_check'
      AND conrelid = 'public.newsletter_campaigns'::regclass
  ) THEN
    ALTER TABLE public.newsletter_campaigns
      ADD CONSTRAINT newsletter_campaigns_editor_check
      CHECK (editor IN ('html', 'doc'));
  END IF;
END $$;

COMMENT ON COLUMN public.newsletter_campaigns.editor IS
  'Silnik treści kampanii: html (surowe html_pl/html_en) lub doc (content_doc).';
COMMENT ON COLUMN public.newsletter_campaigns.content_doc IS
  'Dokument kreatora treści (EmailDoc v1) - bloki dwujęzyczne PL/EN; render do HTML przy wysyłce.';
