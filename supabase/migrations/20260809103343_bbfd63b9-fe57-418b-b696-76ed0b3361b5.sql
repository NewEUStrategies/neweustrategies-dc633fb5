-- Backfill A33: zgloszenia zlozone przed wlaczeniem triggera nie mialy szans
-- wywolac powiadomienia. Odtwarzamy je raz, dla wciaz oczekujacych wnioskow.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT m.club_id, m.user_id
      FROM public.club_members m
     WHERE m.status = 'pending'
       AND m.invite_source = 'self'
  LOOP
    UPDATE public.club_members
       SET status = 'invited'
     WHERE club_id = r.club_id AND user_id = r.user_id;
    UPDATE public.club_members
       SET status = 'pending'
     WHERE club_id = r.club_id AND user_id = r.user_id;
  END LOOP;
END;
$$;