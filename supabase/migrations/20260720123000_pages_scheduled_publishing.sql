-- Publikacja planowana STRON (C3) - parytet z wpisami.
--
-- Wpisy mają publish_at + trigger enforce_post_workflow + publish_due_posts()
-- (migracje 20260702090100 / 20260702113027). Strony dotąd znały tylko
-- draft/published/archived bez harmonogramu, przez co premiery kampanii
-- i landing pages wymagały ręcznego klikania o świcie. Ta migracja odtwarza
-- ten sam mechanizm 1:1 dla public.pages:
--   * kolumna publish_at + częściowy indeks pod skan "due",
--   * pages_workflow_guard - REUŻYWA enforce_post_workflow (te same kolumny
--     status/publish_at, ta sama semantyka can_publish_content),
--   * publish_due_pages() - flip zaległych scheduled -> published,
--   * tick pg_cron co minutę + wywołania oportunistyczne z panelu.

ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS publish_at timestamptz;

CREATE INDEX IF NOT EXISTS pages_scheduled_due_idx
  ON public.pages (publish_at)
  WHERE status = 'scheduled' AND deleted_at IS NULL;

-- Bramka przejść statusów: identyczna logika co dla wpisów (publikowanie
-- i planowanie tylko dla can_publish_content; scheduled wymaga publish_at).
DROP TRIGGER IF EXISTS pages_workflow_guard ON public.pages;
CREATE TRIGGER pages_workflow_guard
  BEFORE INSERT OR UPDATE ON public.pages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_workflow();

-- Auto-publisher stron: due scheduled -> published; published_at antydatowane
-- do zaplanowanego momentu (spójna kolejność w sitemapach), publish_at zostaje
-- jako zapis historyczny harmonogramu.
CREATE OR REPLACE FUNCTION public.publish_due_pages()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  UPDATE public.pages
     SET status = 'published',
         published_at = COALESCE(published_at, publish_at, now())
   WHERE status = 'scheduled'
     AND deleted_at IS NULL
     AND publish_at IS NOT NULL
     AND publish_at <= now();
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_due_pages() FROM public;
-- Jak publish_due_posts: każda zalogowana sesja może odpalić tick
-- oportunistyczny - funkcja publikuje wyłącznie to, co już zaległe.
GRANT EXECUTE ON FUNCTION public.publish_due_pages() TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('publish-due-pages', '* * * * *', 'SELECT public.publish_due_pages()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - scheduled pages publish via opportunistic ticks only';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END;
$$;
