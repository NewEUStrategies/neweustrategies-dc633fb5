-- migration-split: part 5/6 of 20260927000100_event_cfp.sql (SQL wykonywalny = supabase/migrations/20260927000104_event_cfp_part5.sql)
-- events-harness: include

CREATE OR REPLACE FUNCTION public.event_cfp_submission_submit(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_allowed boolean;
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_missing text[];
  v_at timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to submit a talk';
  END IF;
  SELECT r.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_cfp_submit', v_tenant::text || ':' || v_uid::text, 20, 10) r;
  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'rate_limited: too many attempts, try again in a few minutes';
  END IF;
  IF public._event_cfp_own_submission(v_tenant, v_uid, v_id) IS NULL THEN
    RAISE EXCEPTION 'not_found: submission does not exist';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_id
   FOR UPDATE;
  IF v_sub.status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'not_editable: a % submission cannot be submitted again', v_sub.status;
  END IF;
  SELECT e.* INTO v_event FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_sub.event_id;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_sub.event_id;
  IF v_sub.status = 'draft' AND NOT (
    v_event.status = 'published' AND public._event_cfp_is_open(v_s.status, v_s.opens_at, v_s.closes_at)
  ) THEN
    RAISE EXCEPTION 'cfp_closed: the call for speakers is not open';
  END IF;

  IF char_length(v_sub.title_pl) < 2 AND char_length(v_sub.title_en) < 2 THEN
    RAISE EXCEPTION 'missing_title: the talk needs a title';
  END IF;
  IF char_length(v_sub.abstract_pl) < 20 AND char_length(v_sub.abstract_en) < 20 THEN
    RAISE EXCEPTION 'missing_abstract: the talk needs an abstract of at least 20 characters';
  END IF;
  IF jsonb_array_length(COALESCE(v_s.formats, '[]'::jsonb)) > 0 AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_s.formats) f WHERE f->>'key' = v_sub.format_key
  ) THEN
    RAISE EXCEPTION 'missing_format: pick a format';
  END IF;
  IF cardinality(COALESCE(v_s.track_ids, '{}'::uuid[])) > 0
     AND (v_sub.track_id IS NULL OR NOT (v_sub.track_id = ANY (v_s.track_ids))) THEN
    RAISE EXCEPTION 'missing_track: pick a track';
  END IF;
  IF NOT COALESCE(v_s.allow_co_speakers, true) AND EXISTS (
    SELECT 1 FROM public.event_cfp_submission_speakers sp
     WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_id AND NOT sp.is_primary
  ) THEN
    RAISE EXCEPTION 'co_speakers_disabled: this call accepts single-speaker talks only';
  END IF;

  SELECT COALESCE(array_agg(f.key ORDER BY f.sort_order, f.key), ARRAY[]::text[]) INTO v_missing
    FROM public.event_cfp_fields f
   WHERE f.tenant_id = v_tenant AND f.event_id = v_sub.event_id AND f.is_active AND f.is_required
     AND NOT public._event_answer_matches(
       CASE WHEN f.field_type = 'checkbox' THEN 'is_true' ELSE 'not_empty' END,
       'null'::jsonb, v_sub.answers -> f.key);
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'missing_required_fields: %', array_to_string(v_missing, ',');
  END IF;

  UPDATE public.event_cfp_submissions s SET
    status = 'submitted',
    submitted_at = v_at
  WHERE s.tenant_id = v_tenant AND s.id = v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_submission',
    v_id::text,
    'event_cfp_submission.submitted.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_id, 'status', 'submitted'),
    v_uid
  );
  PERFORM public._event_person_crm_sync(
    v_tenant,
    v_sub.person_id,
    'event_cfp',
    'event:' || v_event.slug || ':cfp',
    ARRAY['event:' || v_event.slug, 'cfp:submitted'],
    jsonb_build_object('cfp_title', COALESCE(NULLIF(v_sub.title_pl, ''), v_sub.title_en)),
    true,
    'event.cfp.submitted',
    public._event_cfp_audit_meta(v_tenant, v_id, 'submitted')
  );

  RETURN jsonb_build_object('id', v_id, 'status', 'submitted', 'submitted_at', v_at);
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_submission_submit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_submission_submit(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_submission_submit(jsonb) IS
  'Wyslanie szkicu (nabor otwarty) albo ponowne wyslanie po prosbie o poprawki: tytul, streszczenie, forma, sciezka, wymagane odpowiedzi. Kontakt CRM event_cfp. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_cfp_submission_withdraw(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_sub public.event_cfp_submissions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage your submissions';
  END IF;
  IF public._event_cfp_own_submission(v_tenant, v_uid, v_id) IS NULL THEN
    RAISE EXCEPTION 'not_found: submission does not exist';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_id
   FOR UPDATE;

  IF v_sub.status = 'draft' THEN
    DELETE FROM public.event_cfp_submissions s WHERE s.tenant_id = v_tenant AND s.id = v_id;
    RETURN jsonb_build_object('id', v_id, 'status', 'deleted');
  END IF;
  IF v_sub.status IN ('withdrawn', 'rejected', 'declined') THEN
    RAISE EXCEPTION 'invalid_transition: a % submission cannot be withdrawn', v_sub.status;
  END IF;

  UPDATE public.event_cfp_submissions s SET
    status = 'withdrawn',
    withdrawn_at = now()
  WHERE s.tenant_id = v_tenant AND s.id = v_id;

  IF v_sub.status IN ('accepted', 'confirmed') THEN
    PERFORM public._event_cfp_acceptance_undo(v_tenant, v_id, v_uid);
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_submission',
    v_id::text,
    'event_cfp_submission.withdrawn.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_id, 'status', 'withdrawn'),
    v_uid
  );
  PERFORM public._event_cfp_crm_status(v_tenant, v_id, 'withdrawn');

  RETURN jsonb_build_object('id', v_id, 'status', 'withdrawn');
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_submission_withdraw(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_submission_withdraw(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_submission_withdraw(jsonb) IS
  'Wycofanie wlasnego zgloszenia (szkic znika calkiem; przyjete albo potwierdzone cofa skutki przyjecia). Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_cfp_submission_respond(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage your submissions';
  END IF;
  IF jsonb_typeof(p_payload->'confirm') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'invalid_payload: confirm must be true or false';
  END IF;
  IF public._event_cfp_own_submission(v_tenant, v_uid, v_id) IS NULL THEN
    RAISE EXCEPTION 'not_found: submission does not exist';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_id
   FOR UPDATE;
  IF v_sub.status <> 'accepted' THEN
    RAISE EXCEPTION 'invalid_transition: only an accepted submission can be confirmed or declined';
  END IF;

  v_status := CASE WHEN (p_payload->>'confirm')::boolean THEN 'confirmed' ELSE 'declined' END;
  UPDATE public.event_cfp_submissions s SET
    status = v_status,
    confirmed_at = CASE WHEN v_status = 'confirmed' THEN now() ELSE s.confirmed_at END,
    declined_at = CASE WHEN v_status = 'declined' THEN now() ELSE s.declined_at END
  WHERE s.tenant_id = v_tenant AND s.id = v_id;

  IF v_status = 'confirmed' THEN
    PERFORM public._event_cfp_roster_publish(v_tenant, v_id);
  ELSE
    PERFORM public._event_cfp_acceptance_undo(v_tenant, v_id, v_uid);
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_submission',
    v_id::text,
    'event_cfp_submission.confirmed.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_id, 'status', v_status),
    v_uid
  );
  PERFORM public._event_cfp_crm_status(v_tenant, v_id, v_status);

  RETURN jsonb_build_object('id', v_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_submission_respond(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_submission_respond(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_submission_respond(jsonb) IS
  'Odpowiedz prelegenta na przyjecie: potwierdzenie (wpis wystepujacych na publiczna liste prelegentow) albo odwolanie udzialu (cofniecie skutkow przyjecia). Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_cfp_submission_notice(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage your submissions';
  END IF;
  SELECT jsonb_build_object(
    'submission_id', s.id,
    'tenant_id', s.tenant_id,
    'event_id', s.event_id,
    'status', s.status,
    'submitted_at', s.submitted_at,
    'email', p.email,
    'first_name', p.first_name,
    'lang', s.notify_lang,
    'title_pl', s.title_pl,
    'title_en', s.title_en,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_starts_at', e.starts_at,
    'event_timezone', e.timezone
  ) INTO v_out
  FROM public.event_cfp_submissions s
  JOIN public.event_people p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
  JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
  WHERE s.id = p_submission_id AND p.user_id = v_uid;
  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found: submission does not exist';
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_submission_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_submission_notice(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_submission_notice(uuid) IS
  'Ladunek maila potwierdzajacego wyslanie zgloszenia - wylacznie dla wlasciciela (event_people.user_id = auth.uid()); najemca z wiersza.';

CREATE OR REPLACE FUNCTION public.event_my_cfp_submissions(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_person public.event_people%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your submissions';
  END IF;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = p_slug AND e.status = 'published';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id;
  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.user_id = v_uid;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'timezone', v_event.timezone,
    'max_per_submitter', COALESCE(v_s.max_per_submitter, 3),
    'score_max', COALESCE(v_s.score_max, 5),
    'person', CASE WHEN v_person.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_person.id, 'first_name', v_person.first_name, 'last_name', v_person.last_name,
      'email', v_person.email, 'job_title', v_person.job_title, 'company_text', v_person.company_text,
      'consent_marketing', v_person.consent_marketing_at IS NOT NULL AND v_person.consent_withdrawn_at IS NULL,
      'consents_withdrawn', v_person.consent_withdrawn_at IS NOT NULL)
    END,
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status,
        'title_pl', s.title_pl, 'title_en', s.title_en,
        'abstract_pl', s.abstract_pl, 'abstract_en', s.abstract_en,
        'talk_language', s.talk_language, 'format_key', s.format_key,
        'duration_min', s.duration_min, 'track_id', s.track_id,
        'topics', to_jsonb(s.topics), 'answers', s.answers,
        'submitted_at', s.submitted_at, 'withdrawn_at', s.withdrawn_at,
        'confirmed_at', s.confirmed_at, 'declined_at', s.declined_at,
        'updated_at', s.updated_at, 'session_id', s.session_id,
        'feedback_to_speaker', CASE
          WHEN s.status IN ('changes_requested', 'accepted', 'waitlisted', 'rejected', 'confirmed', 'declined')
            THEN s.feedback_to_speaker ELSE '' END,
        'speakers', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'is_primary', sp.is_primary, 'role', sp.role, 'sort_order', sp.sort_order,
            'first_name', sp.first_name, 'last_name', sp.last_name, 'email', sp.email,
            'job_title', sp.job_title, 'company_text', sp.company_text)
            ORDER BY sp.is_primary DESC, sp.sort_order), '[]'::jsonb)
            FROM public.event_cfp_submission_speakers sp
           WHERE sp.tenant_id = s.tenant_id AND sp.submission_id = s.id
        ),
        'review_summary', public._event_cfp_speaker_review_summary(
          s.tenant_id, s.id, s.status, v_s.min_reviews)
      ) ORDER BY s.created_at DESC), '[]'::jsonb)
        FROM public.event_cfp_submissions s
       WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id AND s.person_id = v_person.id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_cfp_submissions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_cfp_submissions(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_cfp_submissions(text) IS
  'Wlasne zgloszenia na wydarzenie (takze szkice) z informacja zwrotna po decyzji i zagregowana - nigdy pojedyncza - ocena. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public._event_my_speaker_profile(p_tenant uuid, p_uid uuid, p_event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sp.id
    FROM public.speaker_profiles sp
    JOIN public.event_speaker_entries en
      ON en.tenant_id = sp.tenant_id AND en.speaker_profile_id = sp.id AND en.event_id = p_event_id
   WHERE sp.tenant_id = p_tenant
     AND (
       sp.user_id = p_uid
       OR sp.person_id IN (
         SELECT p.id FROM public.event_people p WHERE p.tenant_id = p_tenant AND p.user_id = p_uid
       )
     )
   ORDER BY (sp.user_id = p_uid) DESC NULLS LAST, en.created_at
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public._event_my_speaker_profile(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_my_speaker_profile(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_my_speaker_profile(uuid, uuid, uuid) IS
  'Nakladka sceniczna konta p_uid (po speaker_profiles.user_id albo event_people.user_id) wpisana do rejestru prelegentow wydarzenia; inaczej NULL.';

CREATE OR REPLACE FUNCTION public.event_my_speaker_panel(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_person public.event_people%ROWTYPE;
  v_profile uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to open the speaker panel';
  END IF;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = p_slug AND e.status = 'published';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.user_id = v_uid;
  v_profile := public._event_my_speaker_profile(v_tenant, v_uid, v_event.id);

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'timezone', v_event.timezone,
    'is_reviewer', EXISTS (
      SELECT 1 FROM public.event_cfp_reviewers rv
       WHERE rv.tenant_id = v_tenant AND rv.event_id = v_event.id AND rv.user_id = v_uid AND rv.is_active
    ),
    'submissions_count', (
      SELECT count(*)::integer FROM public.event_cfp_submissions s
       WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id AND s.person_id = v_person.id
    ),
    'person', CASE WHEN v_person.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_person.id, 'first_name', v_person.first_name, 'last_name', v_person.last_name)
    END,
    'profile', (
      SELECT jsonb_build_object(
        'speaker_profile_id', sp.id,
        'headline_pl', sp.headline_pl, 'headline_en', sp.headline_en,
        'bio_pl', sp.bio_pl, 'bio_en', sp.bio_en,
        'topics_pl', to_jsonb(COALESCE(sp.topics_pl, '{}'::text[])),
        'topics_en', to_jsonb(COALESCE(sp.topics_en, '{}'::text[])),
        'languages', to_jsonb(COALESCE(sp.languages, '{}'::text[])),
        'card_photo_url', sp.card_photo_url,
        'is_public', sp.is_public)
        FROM public.speaker_profiles sp
       WHERE sp.tenant_id = v_tenant AND sp.id = v_profile
    ),
    'sessions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'session_id', ses.id, 'title_pl', ses.title_pl, 'title_en', ses.title_en,
        'starts_at', ses.starts_at, 'ends_at', ses.ends_at, 'status', ses.status,
        'format', ses.format, 'role', ss.role, 'room_name', r.name,
        'track_name_pl', t.name_pl, 'track_name_en', t.name_en)
        ORDER BY ses.starts_at, ses.id), '[]'::jsonb)
        FROM public.event_session_speakers ss
        JOIN public.event_sessions ses
          ON ses.tenant_id = ss.tenant_id AND ses.event_id = ss.event_id AND ses.id = ss.session_id
        LEFT JOIN public.event_rooms r
          ON r.tenant_id = ses.tenant_id AND r.event_id = ses.event_id AND r.id = ses.room_id
        LEFT JOIN public.event_tracks t
          ON t.tenant_id = ses.tenant_id AND t.event_id = ses.event_id AND t.id = ses.track_id
       WHERE ss.tenant_id = v_tenant AND ss.event_id = v_event.id
         AND ss.speaker_profile_id = v_profile AND ses.status <> 'cancelled'
    ),
    'materials', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'title_pl', m.title_pl, 'title_en', m.title_en,
        'url', m.url, 'visibility', m.visibility, 'is_published', m.is_published,
        'submission_id', m.submission_id, 'session_id', m.session_id, 'updated_at', m.updated_at)
        ORDER BY m.created_at, m.id), '[]'::jsonb)
        FROM public.event_speaker_materials m
       WHERE m.tenant_id = v_tenant AND m.event_id = v_event.id AND m.speaker_profile_id = v_profile
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_speaker_panel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_speaker_panel(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_speaker_panel(text) IS
  'Panel prelegenta wydarzenia: nakladka sceniczna z rejestru, wystapienia (bez odwolanych; szkic = wstepnie), materialy, liczba zgloszen i czy wolajacy jest recenzentem. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_my_speaker_profile_set(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_profile uuid;
  v_topics_pl text[];
  v_topics_en text[];
  v_languages text[];
  v_photo text := NULLIF(btrim(COALESCE(p_payload->>'card_photo_url', '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to edit your speaker profile';
  END IF;
  SELECT e.id INTO v_event_id
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = NULLIF(p_payload->>'slug', '') AND e.status = 'published';
  v_profile := public._event_my_speaker_profile(v_tenant, v_uid, v_event_id);
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'not_speaker: you are not a speaker of this event';
  END IF;

  IF char_length(COALESCE(p_payload->>'headline_pl', '')) > 200
     OR char_length(COALESCE(p_payload->>'headline_en', '')) > 200
     OR char_length(COALESCE(p_payload->>'bio_pl', '')) > 4000
     OR char_length(COALESCE(p_payload->>'bio_en', '')) > 4000
     OR (v_photo IS NOT NULL AND (v_photo !~ '^https://[^\s]{3,}$' OR char_length(v_photo) > 2048)) THEN
    RAISE EXCEPTION 'invalid_profile: headline up to 200, bio up to 4000 characters, photo as https address';
  END IF;
  IF p_payload ? 'topics_pl' THEN
    v_topics_pl := public._event_speaker_text_array(p_payload->'topics_pl');
  END IF;
  IF p_payload ? 'topics_en' THEN
    v_topics_en := public._event_speaker_text_array(p_payload->'topics_en');
  END IF;
  IF p_payload ? 'languages' THEN
    v_languages := ARRAY(SELECT lower(x) FROM unnest(public._event_speaker_text_array(p_payload->'languages')) x);
  END IF;
  IF cardinality(COALESCE(v_topics_pl, '{}')) > 12 OR cardinality(COALESCE(v_topics_en, '{}')) > 12
     OR EXISTS (SELECT 1 FROM unnest(COALESCE(v_topics_pl, '{}') || COALESCE(v_topics_en, '{}')) x
                 WHERE char_length(x) > 60)
     OR cardinality(COALESCE(v_languages, '{}')) > 10
     OR EXISTS (SELECT 1 FROM unnest(COALESCE(v_languages, '{}')) x WHERE x !~ '^[a-z]{2}$') THEN
    RAISE EXCEPTION 'invalid_profile: at most 12 topics of up to 60 characters and 10 two-letter languages';
  END IF;

  UPDATE public.speaker_profiles sp SET
    headline_pl = CASE WHEN p_payload ? 'headline_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'headline_pl', '')), '') ELSE sp.headline_pl END,
    headline_en = CASE WHEN p_payload ? 'headline_en' THEN NULLIF(btrim(COALESCE(p_payload->>'headline_en', '')), '') ELSE sp.headline_en END,
    bio_pl = CASE WHEN p_payload ? 'bio_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_pl', '')), '') ELSE sp.bio_pl END,
    bio_en = CASE WHEN p_payload ? 'bio_en' THEN NULLIF(btrim(COALESCE(p_payload->>'bio_en', '')), '') ELSE sp.bio_en END,
    topics_pl = COALESCE(v_topics_pl, sp.topics_pl),
    topics_en = COALESCE(v_topics_en, sp.topics_en),
    languages = COALESCE(v_languages, sp.languages),
    card_photo_url = CASE WHEN p_payload ? 'card_photo_url' THEN v_photo ELSE sp.card_photo_url END
  WHERE sp.tenant_id = v_tenant AND sp.id = v_profile;

  RETURN jsonb_build_object('speaker_profile_id', v_profile, 'event_id', v_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_speaker_profile_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_speaker_profile_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_speaker_profile_set(jsonb) IS
  'Prelegent zmienia WLASNA nakladke sceniczna (naglowek, nota, tematy, jezyki, zdjecie karty) - tylko gdy jest w rejestrze prelegentow wydarzenia. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_my_speaker_material_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_speaker_materials%ROWTYPE;
  v_event_id uuid;
  v_profile uuid;
  v_kind text;
  v_title_pl text;
  v_title_en text;
  v_url text;
  v_visibility text;
  v_submission uuid;
  v_session uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage your materials';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT m.* INTO v_row
      FROM public.event_speaker_materials m
     WHERE m.tenant_id = v_tenant AND m.id = v_id
     FOR UPDATE;
    IF NOT FOUND OR public._event_my_speaker_profile(v_tenant, v_uid, v_row.event_id)
                    IS DISTINCT FROM v_row.speaker_profile_id THEN
      RAISE EXCEPTION 'not_found: material does not exist';
    END IF;
    v_event_id := v_row.event_id;
    v_profile := v_row.speaker_profile_id;
  ELSE
    SELECT e.id INTO v_event_id
      FROM public.events e
     WHERE e.tenant_id = v_tenant AND e.slug = NULLIF(p_payload->>'slug', '') AND e.status = 'published';
    v_profile := public._event_my_speaker_profile(v_tenant, v_uid, v_event_id);
    IF v_profile IS NULL THEN
      RAISE EXCEPTION 'not_speaker: you are not a speaker of this event';
    END IF;
    IF (SELECT count(*) FROM public.event_speaker_materials m
         WHERE m.tenant_id = v_tenant AND m.event_id = v_event_id AND m.speaker_profile_id = v_profile) >= 20 THEN
      RAISE EXCEPTION 'too_many_materials: at most 20 materials per event';
    END IF;
  END IF;

  v_kind := CASE WHEN p_payload ? 'kind' THEN p_payload->>'kind' ELSE COALESCE(v_row.kind, 'link') END;
  IF v_kind IS NULL OR v_kind NOT IN ('slides', 'document', 'video', 'link') THEN
    RAISE EXCEPTION 'invalid_kind: kind must be slides, document, video or link';
  END IF;
  v_title_pl := CASE WHEN p_payload ? 'title_pl' THEN btrim(COALESCE(p_payload->>'title_pl', '')) ELSE COALESCE(v_row.title_pl, '') END;
  v_title_en := CASE WHEN p_payload ? 'title_en' THEN btrim(COALESCE(p_payload->>'title_en', '')) ELSE COALESCE(v_row.title_en, '') END;
  IF char_length(v_title_pl) > 200 OR char_length(v_title_en) > 200
     OR (v_title_pl = '' AND v_title_en = '') THEN
    RAISE EXCEPTION 'invalid_title: a material needs a title of up to 200 characters';
  END IF;
  v_url := CASE WHEN p_payload ? 'url' THEN btrim(COALESCE(p_payload->>'url', '')) ELSE v_row.url END;
  IF v_url IS NULL OR v_url !~* '^https://[^\s]{3,}$' OR char_length(v_url) > 2008 THEN
    RAISE EXCEPTION 'invalid_url: the material must be an https address';
  END IF;
  v_visibility := CASE WHEN p_payload ? 'visibility' THEN p_payload->>'visibility' ELSE COALESCE(v_row.visibility, 'organizers') END;
  IF v_visibility IS NULL OR v_visibility NOT IN ('organizers', 'registered', 'public') THEN
    RAISE EXCEPTION 'invalid_visibility: visibility must be organizers, registered or public';
  END IF;
  v_submission := CASE WHEN p_payload ? 'submission_id' THEN NULLIF(p_payload->>'submission_id', '')::uuid ELSE v_row.submission_id END;
  IF v_submission IS NOT NULL AND (
    public._event_cfp_own_submission(v_tenant, v_uid, v_submission) IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.event_cfp_submissions s
                    WHERE s.tenant_id = v_tenant AND s.id = v_submission AND s.event_id = v_event_id)
  ) THEN
    RAISE EXCEPTION 'invalid_submission: the submission is not yours';
  END IF;
  v_session := CASE WHEN p_payload ? 'session_id' THEN NULLIF(p_payload->>'session_id', '')::uuid ELSE v_row.session_id END;
  IF v_session IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_session_speakers ss
     WHERE ss.tenant_id = v_tenant AND ss.event_id = v_event_id AND ss.session_id = v_session
       AND ss.speaker_profile_id = v_profile
  ) THEN
    RAISE EXCEPTION 'invalid_session: you do not speak in this session';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_speaker_materials (
      tenant_id, event_id, speaker_profile_id, submission_id, session_id,
      kind, title_pl, title_en, url, visibility, created_by
    ) VALUES (
      v_tenant, v_event_id, v_profile, v_submission, v_session,
      v_kind, v_title_pl, v_title_en, v_url, v_visibility, v_uid
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_speaker_materials m SET
      kind = v_kind,
      title_pl = v_title_pl,
      title_en = v_title_en,
      url = v_url,
      visibility = v_visibility,
      submission_id = v_submission,
      session_id = v_session,
      is_published = CASE
        WHEN m.url <> v_url OR m.title_pl <> v_title_pl OR m.title_en <> v_title_en
             OR m.visibility <> v_visibility THEN false
        ELSE m.is_published END,
      published_at = CASE
        WHEN m.url <> v_url OR m.title_pl <> v_title_pl OR m.title_en <> v_title_en
             OR m.visibility <> v_visibility THEN NULL
        ELSE m.published_at END
    WHERE m.tenant_id = v_tenant AND m.id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_speaker_material_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_speaker_material_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_speaker_material_upsert(jsonb) IS
  'Prelegent dodaje albo zmienia WLASNY material (adres https). Zmiana tresci zdejmuje publikacje. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_my_speaker_material_delete(p_material_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_row public.event_speaker_materials%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage your materials';
  END IF;
  SELECT m.* INTO v_row
    FROM public.event_speaker_materials m
   WHERE m.tenant_id = v_tenant AND m.id = p_material_id
   FOR UPDATE;
  IF NOT FOUND OR public._event_my_speaker_profile(v_tenant, v_uid, v_row.event_id)
                  IS DISTINCT FROM v_row.speaker_profile_id THEN
    RAISE EXCEPTION 'not_found: material does not exist';
  END IF;
  DELETE FROM public.event_speaker_materials m WHERE m.tenant_id = v_tenant AND m.id = p_material_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_speaker_material_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_speaker_material_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_speaker_material_delete(uuid) IS
  'Prelegent usuwa WLASNY material. Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public._event_cfp_reviewable(
  p_tenant uuid, p_uid uuid, p_reviewer_id uuid, p_submission_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.event_cfp_submissions s
      JOIN public.event_cfp_reviewers rv
        ON rv.tenant_id = s.tenant_id AND rv.event_id = s.event_id AND rv.id = p_reviewer_id
     WHERE s.tenant_id = p_tenant
       AND s.id = p_submission_id
       AND rv.is_active
       AND rv.user_id = p_uid
       AND s.status IN ('submitted', 'under_review', 'changes_requested', 'waitlisted')
       AND (cardinality(rv.track_ids) = 0 OR s.track_id = ANY (rv.track_ids))
       AND NOT EXISTS (
         SELECT 1
           FROM public.event_cfp_submission_speakers sp
           LEFT JOIN public.event_people p ON p.tenant_id = sp.tenant_id AND p.id = sp.person_id
          WHERE sp.tenant_id = s.tenant_id AND sp.submission_id = s.id
            AND (
              p.user_id = p_uid
              OR lower(sp.email) = (SELECT lower(btrim(u.email)) FROM auth.users u WHERE u.id = p_uid)
            )
       )
  )
$$;

REVOKE ALL ON FUNCTION public._event_cfp_reviewable(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_reviewable(uuid, uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_cfp_reviewable(uuid, uuid, uuid, uuid) IS
  'Czy aktywny recenzent moze ocenic zgloszenie: stan do oceny, zakres sciezek, brak udzialu recenzenta w zgloszeniu.';

CREATE OR REPLACE FUNCTION public.event_cfp_review_queue(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_rv public.event_cfp_reviewers%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_identity boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to review submissions';
  END IF;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = p_slug AND e.status = 'published';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT rv.* INTO v_rv
    FROM public.event_cfp_reviewers rv
   WHERE rv.tenant_id = v_tenant AND rv.event_id = v_event.id AND rv.user_id = v_uid AND rv.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_reviewer: you are not a reviewer of this call';
  END IF;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id;
  v_identity := NOT COALESCE(v_s.review_blind, false) OR v_rv.can_see_identity;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'timezone', v_event.timezone,
    'identity_visible', v_identity,
    'score_max', COALESCE(v_s.score_max, 5),
    'review_criteria', COALESCE(v_s.review_criteria, '[]'::jsonb),
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status,
        'title_pl', s.title_pl, 'title_en', s.title_en,
        'talk_language', s.talk_language, 'format_key', s.format_key,
        'duration_min', s.duration_min, 'track_id', s.track_id,
        'track_name_pl', t.name_pl, 'track_name_en', t.name_en,
        'submitted_at', s.submitted_at,
        'speakers', CASE WHEN v_identity THEN (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'first_name', sp.first_name, 'last_name', sp.last_name, 'role', sp.role,
            'job_title', sp.job_title, 'company_text', sp.company_text)
            ORDER BY sp.is_primary DESC, sp.sort_order), '[]'::jsonb)
            FROM public.event_cfp_submission_speakers sp
           WHERE sp.tenant_id = s.tenant_id AND sp.submission_id = s.id
        ) ELSE NULL END,
        'my_review', (
          SELECT jsonb_build_object(
            'id', r.id, 'overall', r.overall, 'recommendation', r.recommendation,
            'conflict_of_interest', r.conflict_of_interest, 'updated_at', r.updated_at)
            FROM public.event_cfp_reviews r
           WHERE r.tenant_id = s.tenant_id AND r.submission_id = s.id AND r.reviewer_id = v_rv.id
        )
      ) ORDER BY s.submitted_at, s.id), '[]'::jsonb)
        FROM public.event_cfp_submissions s
        LEFT JOIN public.event_tracks t
          ON t.tenant_id = s.tenant_id AND t.event_id = s.event_id AND t.id = s.track_id
       WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id
         AND public._event_cfp_reviewable(v_tenant, v_uid, v_rv.id, s.id)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_review_queue(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_review_queue(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_review_queue(text) IS
  'Kolejka recenzenta: zgloszenia do oceny z zakresu jego sciezek, bez wlasnych, z tozsamoscia ukryta przy ocenie w ciemno (chyba ze can_see_identity). Najemca z public_tenant_id(), tozsamosc z auth.uid().';

CREATE OR REPLACE FUNCTION public.event_cfp_review_get(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_rv public.event_cfp_reviewers%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_identity boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to review submissions';
  END IF;
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = p_submission_id;
  SELECT rv.* INTO v_rv
    FROM public.event_cfp_reviewers rv
   WHERE rv.tenant_id = v_tenant AND rv.event_id = v_sub.event_id AND rv.user_id = v_uid AND rv.is_active;
  IF v_rv.id IS NULL OR NOT public._event_cfp_reviewable(v_tenant, v_uid, v_rv.id, p_submission_id) THEN
    RAISE EXCEPTION 'not_found: submission is not in your review queue';
  END IF;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_sub.event_id;
  v_identity := NOT COALESCE(v_s.review_blind, false) OR v_rv.can_see_identity;

  RETURN jsonb_build_object(
    'submission', jsonb_build_object(
      'id', v_sub.id, 'event_id', v_sub.event_id, 'status', v_sub.status,
      'title_pl', v_sub.title_pl, 'title_en', v_sub.title_en,
      'abstract_pl', v_sub.abstract_pl, 'abstract_en', v_sub.abstract_en,
      'talk_language', v_sub.talk_language, 'format_key', v_sub.format_key,
      'duration_min', v_sub.duration_min, 'track_id', v_sub.track_id,
      'topics', to_jsonb(v_sub.topics), 'answers', v_sub.answers,
      'submitted_at', v_sub.submitted_at),
    'identity_visible', v_identity,
    'speakers', CASE WHEN v_identity THEN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'first_name', sp.first_name, 'last_name', sp.last_name, 'role', sp.role,
        'job_title', sp.job_title, 'company_text', sp.company_text, 'is_primary', sp.is_primary)
        ORDER BY sp.is_primary DESC, sp.sort_order), '[]'::jsonb)
        FROM public.event_cfp_submission_speakers sp
       WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id
    ) ELSE NULL END,
    'fields', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', f.key, 'field_type', f.field_type, 'label_pl', f.label_pl, 'label_en', f.label_en,
        'options', f.options) ORDER BY f.sort_order, f.key), '[]'::jsonb)
        FROM public.event_cfp_fields f
       WHERE f.tenant_id = v_tenant AND f.event_id = v_sub.event_id AND f.is_active
    ),
    'formats', COALESCE(v_s.formats, '[]'::jsonb),
    'track', (
      SELECT jsonb_build_object('id', t.id, 'name_pl', t.name_pl, 'name_en', t.name_en)
        FROM public.event_tracks t
       WHERE t.tenant_id = v_tenant AND t.event_id = v_sub.event_id AND t.id = v_sub.track_id
    ),
    'score_max', COALESCE(v_s.score_max, 5),
    'review_criteria', COALESCE(v_s.review_criteria, '[]'::jsonb),
    'review', (
      SELECT jsonb_build_object(
        'id', r.id, 'scores', r.scores, 'overall', r.overall, 'recommendation', r.recommendation,
        'comment_private', r.comment_private, 'comment_to_speaker', r.comment_to_speaker,
        'conflict_of_interest', r.conflict_of_interest, 'updated_at', r.updated_at)
        FROM public.event_cfp_reviews r
       WHERE r.tenant_id = v_tenant AND r.submission_id = v_sub.id AND r.reviewer_id = v_rv.id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_review_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_review_get(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_review_get(uuid) IS
  'Zgloszenie do oceny z kryteriami i wlasna ocena recenzenta (tozsamosc ukryta przy ocenie w ciemno). Najemca z public_tenant_id(), tozsamosc z auth.uid().';
