CREATE OR REPLACE FUNCTION public._tg_events_discussion_club_cleared()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.discussion_group_id := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_events_discussion_club_cleared() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_events_discussion_club_cleared() IS
  'Klub dyskusji wydarzenia zostal wyzerowany (usuniecie klubu - ON DELETE SET NULL - albo redakcja): grupa tego przypiecia tez znika, bo grupa bez klubu lamie events_discussion_group_needs_club.';

DROP TRIGGER IF EXISTS events_discussion_club_cleared ON public.events;
CREATE TRIGGER events_discussion_club_cleared
  BEFORE UPDATE OF discussion_club_id ON public.events
  FOR EACH ROW
  WHEN (OLD.discussion_club_id IS NOT NULL
        AND NEW.discussion_club_id IS NULL
        AND NEW.discussion_group_id IS NOT NULL)
  EXECUTE FUNCTION public._tg_events_discussion_club_cleared();