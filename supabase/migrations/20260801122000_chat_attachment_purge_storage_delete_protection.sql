-- ============================================================================
-- P1 REGRESJA: storage-api >= 0055 (prevent-direct-deletes; w CI od pinu
-- supabase/setup-cli 2.111.0) dodaje statementowy trigger protect_objects_delete
-- na storage.objects - DELETE bez GUC storage.allow_delete_query='true' rzuca
-- 42501 "Direct deletion from storage tables is not allowed".
-- tg_messages_purge_attachment() łykał ten wyjątek (RAISE WARNING), więc purge
-- załącznika przy "cofnij wysłanie" oraz twardy purge znikających wiadomości
-- (chat_purge_expired_messages) po cichu przestały usuwać obiekt storage
-- (osierocone pliki = regres prywatności czatu).
-- Ustawiamy sankcjonowaną furtkę storage-api transakcyjnie wokół DELETE
-- i przywracamy poprzednią wartość (bez otwartej furtki do końca transakcji);
-- subtransakcja bloku EXCEPTION cofa GUC także przy błędzie (fail-closed).
-- Poza dodaniem furtki ciało funkcji identyczne z 20260712192421.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_messages_purge_attachment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_path text := OLD.attachment_path;
  v_prev text;
BEGIN
  IF v_path IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.attachment_path IS NOT DISTINCT FROM OLD.attachment_path THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_prev := current_setting('storage.allow_delete_query', true);
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    DELETE FROM storage.objects
    WHERE bucket_id = 'chat-attachments' AND name = v_path;
    PERFORM set_config('storage.allow_delete_query', coalesce(v_prev, 'false'), true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat: attachment purge failed for %: %', v_path, SQLERRM;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;
