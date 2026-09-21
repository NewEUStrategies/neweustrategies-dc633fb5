CREATE OR REPLACE FUNCTION public.set_user_consents(p_entries jsonb)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_entry jsonb;
  v_keys text[] := ARRAY[]::text[];
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'invalid_entries';
  END IF;

  v_count := jsonb_array_length(p_entries);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'invalid_entries';
  END IF;
  IF v_count > 10 THEN
    RAISE EXCEPTION 'too_many_entries';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    PERFORM public.set_user_consent(
      p_key            => v_entry ->> 'key',
      p_given          => (v_entry ->> 'given')::boolean,
      p_version        => v_entry ->> 'version',
      p_gpc            => COALESCE((v_entry ->> 'gpc')::boolean, false),
      p_lang           => v_entry ->> 'lang',
      p_ip             => v_entry ->> 'ip',
      p_user_agent     => v_entry ->> 'user_agent',
      p_source         => v_entry ->> 'source',
      p_banner_version => v_entry ->> 'banner_version',
      p_decision_id    => NULLIF(v_entry ->> 'decision_id', '')::uuid,
      p_page_url       => v_entry ->> 'page_url'
    );
    v_keys := v_keys || (v_entry ->> 'key');
  END LOOP;

  RETURN v_keys;
END;
$function$;

COMMENT ON FUNCTION public.set_user_consents(jsonb) IS
  'Zapisuje CAŁĄ decyzję zgód użytkownika w JEDNEJ transakcji: wszystko albo nic. Woła set_user_consent dla każdego elementu, więc reguła zapisu (upsert + zdarzenie audytowe) ma nadal jedną definicję. Zwraca klucze zapisane, w kolejności wejścia.';

REVOKE ALL ON FUNCTION public.set_user_consents(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_consents(jsonb) TO authenticated;