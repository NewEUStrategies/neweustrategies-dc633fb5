-- A33: powiadomienia o zgloszeniach dostepu do klubu.
--
-- Do tej pory club_join() tworzyl wiersz 'pending' i na tym sie konczylo:
-- zgloszenie widzial wylacznie ten, kto sam wszedl w /admin/community/clubs.
-- Zgloszenie bez sygnalu to zgloszenie, na ktore nikt nie odpowiada, dlatego
-- producenta powiadomien wiazemy z TABELA (trigger), a nie z jedna sciezka RPC
-- - zaproszenia, linki i akcje admina przechodza przez ten sam stan.

CREATE OR REPLACE FUNCTION public.club_members_notify_status()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club   public.clubs%ROWTYPE;
  v_name   text;
  v_who    text;
  v_href   text;
  v_lead   record;
  v_any    boolean := false;
BEGIN
  SELECT * INTO v_club FROM public.clubs WHERE id = NEW.club_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  v_name := COALESCE(NULLIF(btrim(v_club.name_pl), ''), v_club.name_en, '');

  -- 1) Nowe zgloszenie samodzielne -> prowadzacy klubu.
  IF NEW.status = 'pending'
     AND NEW.invite_source = 'self'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status, '') IS DISTINCT FROM 'pending') THEN

    SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Uzytkownik')
      INTO v_who
      FROM public.profiles p
     WHERE p.id = NEW.user_id;
    v_who := COALESCE(v_who, 'Uzytkownik');

    v_href := '/admin/community/clubs/' || NEW.club_id::text || '?tab=members';

    FOR v_lead IN
      SELECT DISTINCT m.user_id
        FROM public.club_members m
       WHERE m.club_id = NEW.club_id
         AND m.status = 'active'
         AND m.role IN ('lead', 'moderator')
    LOOP
      v_any := true;
      PERFORM public.club_notify(
        v_lead.user_id, NEW.user_id,
        'Prosba o dostep do klubu',
        'Club access request',
        v_who || ' prosi o dostep do klubu ' || v_name || '.',
        v_who || ' is requesting access to ' || COALESCE(NULLIF(btrim(v_club.name_en), ''), v_name) || '.',
        v_href
      );
    END LOOP;

    -- Klub bez prowadzacego nie moze byc czarna dziura: wtedy zgloszenie
    -- trafia do administratorow tenanta.
    IF NOT v_any THEN
      FOR v_lead IN
        SELECT DISTINCT ur.user_id
          FROM public.user_roles ur
          JOIN public.profiles p ON p.id = ur.user_id
         WHERE ur.role IN ('admin', 'super_admin')
           AND p.tenant_id = v_club.tenant_id
      LOOP
        PERFORM public.club_notify(
          v_lead.user_id, NEW.user_id,
          'Prosba o dostep do klubu',
          'Club access request',
          v_who || ' prosi o dostep do klubu ' || v_name || '.',
          v_who || ' is requesting access to ' || COALESCE(NULLIF(btrim(v_club.name_en), ''), v_name) || '.',
          v_href
        );
      END LOOP;
    END IF;

    RETURN NEW;
  END IF;

  -- 2) Decyzja prowadzacego -> zgloszajacy. Actor = NULL, bo powiadomienie
  --    dotyczy cudzej decyzji o moim zgloszeniu.
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'pending' THEN
    IF NEW.status = 'active' THEN
      PERFORM public.club_notify(
        NEW.user_id, NULL,
        'Dostep do klubu przyznany',
        'Club access granted',
        'Jestes juz czlonkiem klubu ' || v_name || '.',
        'You are now a member of ' || COALESCE(NULLIF(btrim(v_club.name_en), ''), v_name) || '.',
        '/club/' || v_club.slug
      );
    ELSIF NEW.status IN ('left', 'banned') THEN
      PERFORM public.club_notify(
        NEW.user_id, NULL,
        'Prosba o dostep rozpatrzona',
        'Access request reviewed',
        'Prowadzacy nie przyznal dostepu do klubu ' || v_name || '.',
        'Access to ' || COALESCE(NULLIF(btrim(v_club.name_en), ''), v_name) || ' was not granted.',
        '/club'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.club_members_notify_status() IS
  'A33: powiadomienia o zgloszeniach dostepu do klubu (prowadzacy) i o decyzji (zgloszajacy).';

DROP TRIGGER IF EXISTS club_members_notify_status_tg ON public.club_members;
CREATE TRIGGER club_members_notify_status_tg
AFTER INSERT OR UPDATE OF status ON public.club_members
FOR EACH ROW EXECUTE FUNCTION public.club_members_notify_status();