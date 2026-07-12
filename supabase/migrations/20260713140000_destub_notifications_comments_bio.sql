-- ============================================================================
-- De-stubbing: powiadomienia, komentarze, bio. Idempotentne.
--
--   1) POWIADOMIENIA BEZPIECZEŃSTWA ZAWSZE DOCIERAJĄ. UI prezentuje przełącznik
--      "security" jako zawsze włączony (Switch disabled), ale enqueue_notification
--      honorował np.enabled_security w CASE - dawało się go wyłączyć zapisem
--      wprost i wyciszyć alerty bezpieczeństwa. Teraz 'security' omija
--      preferencję (kontrakt zgodny z UI: alertów bezpieczeństwa nie da się
--      wyciszyć).
--
--   2) EDYCJA KOMENTARZY (autor, okno 15 min). Dotąd comments_guard_update
--      twardo blokował zmianę body dla nie-staffu ("body cannot be edited") -
--      brak edycji był atrapą. Teraz autor może poprawić własny komentarz przez
--      15 min od utworzenia; edycja stempluje edited_at (UI pokazuje "edytowano").
--      Kolumny tożsamości nadal niezmienialne; poza oknem lub po soft-delete -
--      blokada; staff (admin/editor) bez ograniczeń.
--
--   3) BIO - JEDNO KANONICZNE ŹRÓDŁO. Edytory pisały bio do TRZECH różnych
--      miejsc (profiles.bio jednojęzyczne, profiles.bio_pl/bio_en lokalizowane,
--      author_profiles.bio_pl/bio_en) - bez synchronizacji. Publiczny render
--      karty autora czyta bio_pl/bio_en, więc to one są kanoniczne. Backfill
--      przenosi legacy profiles.bio do bio_pl/bio_en, a trigger utrzymuje
--      profiles.bio jako LUSTRO (= bio_pl, w razie braku bio_en) - legacy
--      czytelnicy (podglądy, stopki) dalej działają i widzą aktualną treść.
--      Edytory (frontend) przełączone na bio_pl/bio_en jako jedyny zapis.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) enqueue_notification: 'security' omija preferencję odbiorcy
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text,
  p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN
    RETURN NULL;
  END IF;

  -- Alerty bezpieczeństwa docierają ZAWSZE (zgodnie z always-on w UI).
  IF p_kind <> 'security' THEN
    SELECT CASE p_kind
             WHEN 'message'      THEN np.enabled_message
             WHEN 'comment'      THEN np.enabled_comment
             WHEN 'follow'       THEN np.enabled_follow
             WHEN 'subscription' THEN np.enabled_subscription
             WHEN 'content'      THEN np.enabled_content
             WHEN 'system'       THEN np.enabled_system
             ELSE true
           END
      INTO v_enabled
      FROM public.notification_preferences np
     WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id
      AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes'
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (
    user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon
  ) VALUES (
    p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''),
    NULLIF(btrim(p_body_pl), ''),
    NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''),
    NULLIF(btrim(p_icon), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2) KOMENTARZE: edycja własnego body w oknie 15 min + edited_at
-- ----------------------------------------------------------------------------
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
GRANT UPDATE(edited_at) ON public.comments TO authenticated;

CREATE OR REPLACE FUNCTION public.comments_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Kolumny tożsamości zawsze niezmienialne.
  IF NEW.post_id IS DISTINCT FROM OLD.post_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'comments: identity columns are immutable';
  END IF;

  -- Staff (admin/editor) bez ograniczeń.
  IF public.has_role(v_uid, 'admin'::app_role)
     OR public.has_role(v_uid, 'editor'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Autor może edytować treść własnego komentarza przez 15 minut od utworzenia
  -- (RLS comments_own_update już gwarantuje, że to jego wiersz). Poza oknem lub
  -- po soft-delete - edycja treści zabroniona.
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.status = 'deleted' OR OLD.created_at < now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'comments: edit window expired';
    END IF;
    NEW.edited_at := now();
  END IF;

  -- Zmiana statusu przez nie-staff tylko na 'deleted' (soft delete).
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'deleted' THEN
    RAISE EXCEPTION 'comments: only soft delete is allowed';
  END IF;

  RETURN NEW;
END;
$$;

-- Realtime dla komentarzy (klient patchuje/odświeża listę na INSERT/UPDATE).
ALTER TABLE public.comments REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.comments';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'comments: could not add to supabase_realtime (%): continuing', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 3) BIO: kanoniczne bio_pl/bio_en + profiles.bio jako lustro
-- ----------------------------------------------------------------------------
-- Backfill: nie zgub legacy jednojęzycznego bio (trafia do obu lokali, jeśli
-- puste). btrim, by nie przenosić samych spacji.
UPDATE public.profiles
   SET bio_pl = COALESCE(NULLIF(btrim(bio_pl), ''), NULLIF(btrim(bio), '')),
       bio_en = COALESCE(NULLIF(btrim(bio_en), ''), NULLIF(btrim(bio), ''))
 WHERE NULLIF(btrim(bio), '') IS NOT NULL
   AND (NULLIF(btrim(bio_pl), '') IS NULL OR NULLIF(btrim(bio_en), '') IS NULL);

-- Lustro: profiles.bio zawsze odzwierciedla kanoniczne bio_pl (fallback bio_en),
-- żeby legacy czytelnicy (podglądy, stopki) widzieli aktualną treść. Gdy oba
-- lokale puste, zachowuje ewentualną wartość przysłaną wprost (bez kasowania).
CREATE OR REPLACE FUNCTION public.profiles_mirror_bio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.bio := COALESCE(
    NULLIF(btrim(NEW.bio_pl), ''),
    NULLIF(btrim(NEW.bio_en), ''),
    NEW.bio
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_mirror_bio_trg ON public.profiles;
CREATE TRIGGER profiles_mirror_bio_trg
  BEFORE INSERT OR UPDATE OF bio_pl, bio_en ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_mirror_bio();
