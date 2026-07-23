-- ============================================================================
-- FIX (P1): obejscie moderacji komentarzy przez edycje po zatwierdzeniu.
--
-- comments_guard_update pozwalal autorowi edytowac `body` przez 15 min od
-- utworzenia i NIE resetowal statusu. Scenariusz naduzycia: tresc neutralna ->
-- moderator zatwierdza (status 'approved') -> autor w oknie 15 min podmienia
-- tresc na zlosliwa; komentarz pozostaje 'approved'. Naprawa: gdy moderacja
-- jest wlaczona dla tenanta (discussion.moderate_new_comments, domyslnie true)
-- i tresc jest edytowana przez nie-staff na juz widocznym komentarzu, cofamy go
-- do 'pending' (ponowna moderacja). Gdy moderacja wylaczona - komentarze i tak
-- sa auto-approved, wiec status zostaje bez zmian.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.comments_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_moderated boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Kolumny tozsamosci zawsze niezmienialne.
  IF NEW.post_id IS DISTINCT FROM OLD.post_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'comments: identity columns are immutable';
  END IF;

  -- Staff (admin/editor) bez ograniczen.
  IF public.has_role(v_uid, 'admin'::app_role)
     OR public.has_role(v_uid, 'editor'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Autor moze edytowac tresc wlasnego komentarza przez 15 minut od utworzenia
  -- (RLS comments_own_update juz gwarantuje, ze to jego wiersz). Poza oknem lub
  -- po soft-delete - edycja tresci zabroniona.
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.status = 'deleted' OR OLD.created_at < now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'comments: edit window expired';
    END IF;
    NEW.edited_at := now();

    -- Re-moderacja: jesli tenant moderuje komentarze, a edytowany komentarz byl
    -- juz widoczny (approved), cofnij go do kolejki moderacji. Zapobiega
    -- podmianie zatwierdzonej tresci na zlosliwa w oknie edycji.
    SELECT COALESCE((s.value ->> 'moderate_new_comments')::boolean, true)
      INTO v_moderated
      FROM public.site_settings s
     WHERE s.key = 'discussion' AND s.tenant_id = OLD.tenant_id;

    IF COALESCE(v_moderated, true) AND OLD.status = 'approved'
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      NEW.status := 'pending';
    END IF;
  END IF;

  -- Zmiana statusu przez nie-staff tylko na 'deleted' (soft delete) albo
  -- automatyczne cofniecie do 'pending' przy re-moderacji powyzej.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('deleted', 'pending') THEN
    RAISE EXCEPTION 'comments: only soft delete is allowed';
  END IF;

  RETURN NEW;
END;
$$;
