
-- 1) content_access: hide password_hash from public reads (RPC verify_content_password stays SECURITY DEFINER)
REVOKE SELECT (password_hash) ON public.content_access FROM anon, authenticated;

-- 2) author_profiles: hide phone from public
REVOKE SELECT (phone) ON public.author_profiles FROM anon;

-- 3) profiles: hide phone and email from anon public author reads
REVOKE SELECT (phone, email) ON public.profiles FROM anon;

-- 4) personality_results / history: hide raw answers from public reads
REVOKE SELECT (answers) ON public.personality_results FROM anon, authenticated;
REVOKE SELECT (answers) ON public.personality_result_history FROM anon, authenticated;
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
