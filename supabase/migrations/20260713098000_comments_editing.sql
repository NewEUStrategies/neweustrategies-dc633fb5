-- ============================================================================
-- SPOŁECZNOŚĆ 9/10: edycja komentarzy z oknem 5 minut (parytet z czatem).
--
-- Rate limit komentarzy istnieje od 20260711190000; ten plik domyka edycję:
--   * comments.edited_at - publiczny znacznik "(edytowano)",
--   * trigger BEFORE UPDATE: właściciel (nie-staff) może zmienić WYŁĄCZNIE
--     body, wyłącznie w 5 minut od utworzenia; każda próba przestawienia
--     statusu/post_id/parent_id/user_id przez właściciela jest odrzucana.
--     Staff moderuje bez ograniczeń (jak dotąd).
--
-- Wszystko idempotentne.
-- ============================================================================

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE OR REPLACE FUNCTION public.tg_comments_owner_edit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_staff boolean;
BEGIN
  -- service_role / procesy wewnętrzne: bez zmian zachowania.
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  v_staff := public.has_role(v_user, 'admin'::app_role)
          OR public.has_role(v_user, 'editor'::app_role);
  IF v_staff THEN
    RETURN NEW;
  END IF;

  IF v_user <> OLD.user_id THEN
    RAISE EXCEPTION 'comments: not the author';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.post_id IS DISTINCT FROM OLD.post_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'comments: only the body can be edited';
  END IF;

  IF OLD.created_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'comments: edit window elapsed';
  END IF;

  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edited_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_owner_edit ON public.comments;
CREATE TRIGGER comments_owner_edit
  BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_comments_owner_edit();
