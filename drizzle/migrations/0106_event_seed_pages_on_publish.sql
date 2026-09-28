CREATE OR REPLACE FUNCTION public._events_seed_pages_on_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Strona publiczna czyta zakładki z event_pages; bez zasiewu przy publikacji
  -- wydarzenie nieotwarte w panelu „Strony i menu" nie miało zakładek, a podgląd je miał.
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public._event_seed_default_pages(NEW.tenant_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._events_seed_pages_on_publish() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS events_seed_pages_on_publish ON public.events;
CREATE TRIGGER events_seed_pages_on_publish
AFTER INSERT OR UPDATE OF status ON public.events
FOR EACH ROW EXECUTE FUNCTION public._events_seed_pages_on_publish();

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT e.id, e.tenant_id FROM public.events e
    WHERE e.status = 'published'
      AND NOT EXISTS (SELECT 1 FROM public.event_pages ep WHERE ep.event_id = e.id)
  LOOP
    PERFORM public._event_seed_default_pages(r.tenant_id, r.id);
  END LOOP;
END $$;