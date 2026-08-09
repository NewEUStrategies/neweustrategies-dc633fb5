CREATE OR REPLACE FUNCTION public.club_members_notify_status()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club   public.clubs%ROWTYPE;
  v_name   text;
  v_name_en text;
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
  v_name_en := COALESCE(NULLIF(btrim(v_club.name_en), ''), v_name);

  IF NEW.status = 'pending'
     AND NEW.invite_source = 'self'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status, '') IS DISTINCT FROM 'pending') THEN

    SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Użytkownik')
      INTO v_who
      FROM public.profiles p
     WHERE p.id = NEW.user_id;
    v_who := COALESCE(v_who, 'Użytkownik');

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
        'Prośba o dostęp do klubu', 'Club access request',
        v_who || ' prosi o dostęp do klubu ' || v_name || '.',
        v_who || ' is requesting access to ' || v_name_en || '.',
        v_href
      );
    END LOOP;

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
          'Prośba o dostęp do klubu', 'Club access request',
          v_who || ' prosi o dostęp do klubu ' || v_name || '.',
          v_who || ' is requesting access to ' || v_name_en || '.',
          v_href
        );
      END LOOP;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'pending' THEN
    IF NEW.status = 'active' THEN
      PERFORM public.club_notify(
        NEW.user_id, NULL,
        'Dostęp do klubu przyznany', 'Club access granted',
        'Jesteś już członkiem klubu ' || v_name || '.',
        'You are now a member of ' || v_name_en || '.',
        '/club/' || v_club.slug
      );
    ELSIF NEW.status IN ('left', 'banned') THEN
      PERFORM public.club_notify(
        NEW.user_id, NULL,
        'Prośba o dostęp rozpatrzona', 'Access request reviewed',
        'Prowadzący nie przyznał dostępu do klubu ' || v_name || '.',
        'Access to ' || v_name_en || ' was not granted.',
        '/club'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.notifications
   SET title_pl = 'Prośba o dostęp do klubu',
       body_pl = replace(replace(body_pl, 'prosi o dostep do klubu', 'prosi o dostęp do klubu'), 'Uzytkownik', 'Użytkownik')
 WHERE kind = 'club' AND title_pl = 'Prosba o dostep do klubu';