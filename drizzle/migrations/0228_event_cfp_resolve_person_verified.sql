CREATE OR REPLACE FUNCTION public._event_cfp_resolve_person(
  p_tenant uuid, p_uid uuid, p_speaker jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person public.event_people%ROWTYPE;
  v_email text;
  v_bind uuid;
  v_speaker jsonb := CASE WHEN jsonb_typeof(p_speaker) = 'object' THEN p_speaker ELSE '{}'::jsonb END;
  v_first text := NULLIF(btrim(COALESCE(v_speaker->>'first_name', '')), '');
  v_last text := NULLIF(btrim(COALESCE(v_speaker->>'last_name', '')), '');
  v_job text := NULLIF(btrim(COALESCE(v_speaker->>'job_title', '')), '');
  v_company text := NULLIF(btrim(COALESCE(v_speaker->>'company_text', '')), '');
  v_marketing boolean := COALESCE(v_speaker->'consent_marketing' = 'true'::jsonb, false);
  v_data_ok boolean := COALESCE(v_speaker->'consent_data_processing' = 'true'::jsonb, false);
  v_lang text := CASE WHEN v_speaker->>'lang' IN ('pl', 'en') THEN v_speaker->>'lang' END;
  v_text_version integer := CASE
    WHEN jsonb_typeof(v_speaker->'consent_text_version') = 'number'
         AND (v_speaker->>'consent_text_version') ~ '^[1-9][0-9]{0,3}$'
      THEN (v_speaker->>'consent_text_version')::integer
  END;
BEGIN
  IF (v_first IS NOT NULL AND char_length(v_first) > 80)
     OR (v_last IS NOT NULL AND char_length(v_last) > 80)
     OR (v_job IS NOT NULL AND char_length(v_job) > 160)
     OR (v_company IS NOT NULL AND char_length(v_company) > 200) THEN
    RAISE EXCEPTION 'invalid_speaker: speaker details are too long';
  END IF;
  IF NOT v_data_ok THEN
    RAISE EXCEPTION 'consent_required: consent to data processing is required';
  END IF;

  SELECT NULLIF(lower(btrim(u.email)), '') INTO v_email FROM auth.users u WHERE u.id = p_uid;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'email_required: the account has no e-mail address';
  END IF;
  IF NOT public._event_uid_owns_email(p_uid, v_email) THEN
    RAISE EXCEPTION 'email_unverified: confirm the e-mail address of your account first';
  END IF;

  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.user_id = p_uid
   FOR UPDATE;

  IF NOT FOUND THEN
    SELECT p.* INTO v_person
      FROM public.event_people p
     WHERE p.tenant_id = p_tenant AND p.email_norm = v_email
     FOR UPDATE;
    IF FOUND AND v_person.user_id IS NOT NULL AND v_person.user_id <> p_uid THEN
      RAISE EXCEPTION 'email_in_use: this e-mail belongs to another account';
    END IF;
  END IF;

  v_bind := public._event_bind_uid_for_email(p_tenant, p_uid, v_email);

  IF v_person.id IS NULL THEN
    IF v_first IS NULL OR v_last IS NULL THEN
      RAISE EXCEPTION 'invalid_name: first name and last name are required';
    END IF;
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, job_title, company_text,
      source, consent_data_processing_at, created_by
    ) VALUES (
      p_tenant, v_bind, v_email, v_first, v_last, v_job, v_company,
      'self_registration', now(), p_uid
    )
    RETURNING * INTO v_person;
  ELSE
    UPDATE public.event_people p SET
      user_id = COALESCE(p.user_id, v_bind),
      first_name = COALESCE(v_first, p.first_name),
      last_name = COALESCE(v_last, p.last_name),
      job_title = CASE WHEN v_speaker ? 'job_title' THEN v_job ELSE p.job_title END,
      company_text = CASE WHEN v_speaker ? 'company_text' THEN v_company ELSE p.company_text END,
      consent_data_processing_at = COALESCE(p.consent_data_processing_at, now())
    WHERE p.tenant_id = p_tenant AND p.id = v_person.id
    RETURNING * INTO v_person;
  END IF;

  IF v_marketing
     AND v_text_version IS NOT NULL
     AND v_lang IS NOT NULL
     AND v_person.consent_withdrawn_at IS NULL
     AND v_person.consent_marketing_at IS NULL
     AND public._event_uid_owns_email(p_uid, v_person.email_norm)
     AND EXISTS (
       SELECT 1 FROM public.event_consent_texts t
        WHERE t.purpose = 'marketing' AND t.version = v_text_version AND t.lang = v_lang
     ) THEN
    PERFORM public._event_person_consents_confirm(
      p_tenant, v_person.id, ARRAY['marketing']::text[], 'verified_account',
      NULL, NULL, NULL, v_text_version, v_lang, NULL, NULL, p_uid, 'event_cfp', true);
  END IF;

  RETURN v_person.id;
END;
$$;

REVOKE ALL ON FUNCTION public._event_cfp_resolve_person(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_resolve_person(uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public._event_cfp_resolve_person(uuid, uuid, jsonb) IS
  'Kartoteka zglaszajacego: po event_people.user_id, potem po POTWIERDZONYM adresie konta (email_unverified bez auth.users.email_confirmed_at, email_required bez adresu), inaczej nowa osoba self_registration; user_id wylacznie przez _event_bind_uid_for_email. Wymaga jawnej zgody na przetwarzanie danych (consent_required). Zgoda marketingowa tylko z jawnego zaznaczenia, przez _event_person_consents_confirm(verified_account) z wersja i jezykiem tekstu z ladunku (consent_text_version, lang), gdy konto ma potwierdzony adres osoby; brak zaznaczenia jej nie wycofuje, wycofanych zgod nie wskrzesza, consent_withdrawn_at nigdy nie zerowany.';