
-- 1) content_access: hide password_hash from public reads (RPC verify_content_password stays SECURITY DEFINER)
REVOKE SELECT (password_hash) ON public.content_access FROM anon, authenticated;

-- 2) author_profiles: hide phone from public
REVOKE SELECT (phone) ON public.author_profiles FROM anon;

-- 3) profiles: hide phone and email from anon public author reads
REVOKE SELECT (phone, email) ON public.profiles FROM anon;

-- 4) personality_results / history: hide raw answers from public reads
--
-- UWAGA (naprawa łańcucha migracji, jak w 20260713180000): migracja
-- 20260711120000 USUWA kolumnę `answers` z personality_result_history
-- (minimalizacja danych - surowe odpowiedzi zostają tylko w
-- personality_results). Bezwarunkowy REVOKE na nieistniejącej kolumnie kończy
-- się 42703 i przerywa CAŁY łańcuch na świeżej bazie, czyli `supabase db start`
-- i job pgtap w CI nigdy nie dobiegają do końca. REVOKE wykonujemy więc tylko
-- wtedy, gdy kolumna faktycznie istnieje (na bazie sprzed dropu nadal zadziała).
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['personality_results', 'personality_result_history'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_table AND column_name = 'answers'
    ) THEN
      EXECUTE format('REVOKE SELECT (answers) ON public.%I FROM anon, authenticated', v_table);
    END IF;
  END LOOP;
END $$;
-- Keep answers readable by owner via SECURITY DEFINER path if needed later; for now
-- the public "profile_is_public" surface no longer leaks raw answers.

-- 5) Function search_path hardening
CREATE OR REPLACE FUNCTION public.chat_topic_conversation_id(_topic text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN _topic ~ '^chat-conv:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN substring(_topic FROM 11)::uuid
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.profiles_mirror_bio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.bio := COALESCE(NULLIF(btrim(NEW.bio_pl), ''), NULLIF(btrim(NEW.bio_en), ''), NEW.bio);
  RETURN NEW;
END;
$function$;
