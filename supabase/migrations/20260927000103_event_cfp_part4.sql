-- CZESC 4/6 MIGRACJI 20260927000100_event_cfp.sql
-- migration-split: part 4/6 of 20260927000100_event_cfp.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 20260927000100_event_cfp.sql,
-- potem 20260927000101_event_cfp_part2.sql .. 20260927000105_event_cfp_part6.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.
-- events-harness: include

-- ----------------------------------------------------------------------------
-- 14) PANEL: PRZYJECIE ZGLOSZENIA
--
-- Kazdy wystepujacy: kartoteka (wspolprelegent dopiero teraz), nakladka
-- sceniczna, grupa prelegentow, opcjonalnie zapis `approved` z biletem
-- prelegenta, kontakt CRM `speaker`. Opcjonalnie szkic sesji z obsada.
-- Wszystko w JEDNEJ transakcji: kolizja sali albo sesja poza oknem wydarzenia
-- cofa cale przyjecie.
--
-- PUBLICZNA LISTA PRELEGENTOW DOPIERO PO POTWIERDZENIU. Przyjecie niczego nie
-- oglasza: wpis w `event_speaker_entries` (a z nim nazwisko na stronie
-- wydarzenia) dodaje `event_cfp_submission_respond(confirm = true)`. Wiersz
-- wystepujacego zapamietuje nakladke i to, co przyjecie DODALO (grupa, zapis)
-- - cofniecie przyjecia zdejmuje dokladnie to.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_submission_accept(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_register boolean := COALESCE(CASE WHEN jsonb_typeof(p_payload->'register') = 'boolean'
    THEN (p_payload->>'register')::boolean END, true);
  v_schedule jsonb := CASE WHEN jsonb_typeof(p_payload->'schedule') = 'object' THEN p_payload->'schedule' END;
  v_sub public.event_cfp_submissions%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_settings public.event_cfp_settings%ROWTYPE;
  v_sp record;
  v_person uuid;
  v_profile uuid;
  v_primary_profile uuid;
  v_lead uuid;
  v_reg uuid;
  v_group uuid;
  v_added_group uuid;
  v_n integer;
  v_cast jsonb := '[]'::jsonb;
  v_regs integer := 0;
  v_enrolled integer := 0;
  v_starts timestamptz;
  v_ends timestamptz;
  v_room uuid;
  v_track uuid;
  v_format text;
  v_session uuid;
  v_note text;
  v_feedback text;
  v_at timestamptz := now();
BEGIN
  SELECT s.* INTO v_sub
    FROM public.event_cfp_submissions s
   WHERE s.tenant_id = v_tenant AND s.id = v_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: submission does not exist in this tenant';
  END IF;
  IF v_sub.status NOT IN ('submitted', 'under_review', 'changes_requested', 'waitlisted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_transition: a % submission cannot be accepted', v_sub.status;
  END IF;

  SELECT e.* INTO v_event FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_sub.event_id;
  SELECT cs.* INTO v_settings
    FROM public.event_cfp_settings cs
   WHERE cs.tenant_id = v_tenant AND cs.event_id = v_sub.event_id;

  v_note := CASE WHEN p_payload ? 'decision_note'
    THEN NULLIF(btrim(COALESCE(p_payload->>'decision_note', '')), '') ELSE v_sub.decision_note END;
  v_feedback := CASE WHEN p_payload ? 'feedback_to_speaker'
    THEN btrim(COALESCE(p_payload->>'feedback_to_speaker', '')) ELSE v_sub.feedback_to_speaker END;
  IF char_length(COALESCE(v_note, '')) > 2000 OR char_length(v_feedback) > 4000 THEN
    RAISE EXCEPTION 'invalid_note: note up to 2000 and feedback up to 4000 characters';
  END IF;

  -- Plan sesji sprawdzany PRZED jakimkolwiek zapisem.
  IF v_schedule IS NOT NULL THEN
    BEGIN
      v_starts := NULLIF(btrim(COALESCE(v_schedule->>'starts_at', '')), '')::timestamptz;
      v_ends := NULLIF(btrim(COALESCE(v_schedule->>'ends_at', '')), '')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_schedule: start and end must be timestamps';
    END;
    IF v_starts IS NULL OR v_ends IS NULL OR v_ends <= v_starts
       OR v_ends > v_starts + interval '48 hours' THEN
      RAISE EXCEPTION 'invalid_schedule: the session needs a start before its end (at most 48 hours)';
    END IF;
    v_room := NULLIF(v_schedule->>'room_id', '')::uuid;
    IF v_room IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_rooms r
       WHERE r.tenant_id = v_tenant AND r.event_id = v_sub.event_id AND r.id = v_room
    ) THEN
      RAISE EXCEPTION 'room_not_found: the room does not belong to this event';
    END IF;
    v_track := CASE WHEN v_schedule ? 'track_id'
      THEN NULLIF(v_schedule->>'track_id', '')::uuid ELSE v_sub.track_id END;
    IF v_track IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_tracks t
       WHERE t.tenant_id = v_tenant AND t.event_id = v_sub.event_id AND t.id = v_track
    ) THEN
      RAISE EXCEPTION 'track_not_found: the track does not belong to this event';
    END IF;
    v_format := COALESCE(NULLIF(v_schedule->>'format', ''), 'onsite');
    IF v_format NOT IN ('onsite', 'online', 'hybrid') THEN
      RAISE EXCEPTION 'invalid_format: format must be onsite, online or hybrid';
    END IF;
  END IF;

  v_group := v_settings.speaker_group_id;

  FOR v_sp IN
    SELECT sp.*
      FROM public.event_cfp_submission_speakers sp
     WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_id
     ORDER BY sp.is_primary DESC, sp.sort_order, sp.created_at, sp.id
  LOOP
    v_person := v_sp.person_id;
    IF v_person IS NULL THEN
      IF v_sp.email IS NOT NULL THEN
        SELECT p.id INTO v_person
          FROM public.event_people p
         WHERE p.tenant_id = v_tenant AND p.email_norm = lower(btrim(v_sp.email));
      END IF;
      IF v_person IS NULL THEN
        -- BEZ stempla zgody na przetwarzanie danych: wspolprelegent zadnej
        -- zgody nie wyrazil - dane wpisal zglaszajacy, kartoteke zaklada
        -- organizator (`source = 'organizer'`). Stempel pozorowalby zgode.
        INSERT INTO public.event_people (
          tenant_id, email, first_name, last_name, job_title, company_text,
          source, created_by
        ) VALUES (
          v_tenant, v_sp.email, v_sp.first_name, v_sp.last_name, v_sp.job_title, v_sp.company_text,
          'organizer', v_uid
        )
        RETURNING id INTO v_person;
      END IF;
      -- Ta sama osoba wpisana dwa razy (np. zglaszajacy podal swoj adres jako
      -- wspolprelegenta) wystepuje raz.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.event_cfp_submission_speakers o
         WHERE o.tenant_id = v_tenant AND o.submission_id = v_id AND o.person_id = v_person
      );
      UPDATE public.event_cfp_submission_speakers sp SET person_id = v_person
       WHERE sp.tenant_id = v_tenant AND sp.id = v_sp.id;
    END IF;

    v_profile := public._event_speaker_overlay_for_person(v_tenant, v_person);
    v_enrolled := v_enrolled + 1;
    IF v_sp.is_primary THEN
      v_primary_profile := v_profile;
    END IF;
    IF NOT v_cast @> jsonb_build_array(jsonb_build_object('profile', v_profile)) THEN
      v_cast := v_cast || jsonb_build_array(jsonb_build_object(
        'profile', v_profile, 'role', v_sp.role, 'order', jsonb_array_length(v_cast)));
    END IF;

    v_added_group := NULL;
    IF v_group IS NOT NULL THEN
      INSERT INTO public.event_group_members (tenant_id, event_id, group_id, person_id, added_by)
      VALUES (v_tenant, v_sub.event_id, v_group, v_person, v_uid)
      ON CONFLICT (tenant_id, group_id, person_id) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN
        v_added_group := v_group;
      END IF;
    END IF;

    v_reg := NULL;
    IF v_register AND NOT EXISTS (
      SELECT 1 FROM public.event_registrations r
       WHERE r.tenant_id = v_tenant AND r.event_id = v_sub.event_id AND r.person_id = v_person
         AND r.status NOT IN ('cancelled', 'rejected')
    ) THEN
      INSERT INTO public.event_registrations (
        tenant_id, event_id, person_id, ticket_type_id, group_id, status,
        registration_mode, answers, source, decided_by, decided_at, decision_source, created_by
      ) VALUES (
        v_tenant, v_sub.event_id, v_person, v_settings.speaker_ticket_type_id,
        COALESCE(v_group, (
          SELECT g.id FROM public.event_groups g
           WHERE g.tenant_id = v_tenant AND g.event_id = v_sub.event_id AND g.is_default)),
        'approved', 'form', '{}'::jsonb, 'invitation', v_uid, v_at, 'organizer', v_uid
      )
      RETURNING id INTO v_reg;
      v_regs := v_regs + 1;
      PERFORM public.emit_domain_event(
        v_tenant,
        'event_registration',
        v_reg::text,
        'event.registration.created.v1',
        jsonb_build_object('event_id', v_sub.event_id, 'person_id', v_person,
                           'status', 'approved', 'source', 'invitation'),
        v_uid
      );
    END IF;

    v_lead := public._event_person_crm_sync(
      v_tenant,
      v_person,
      'speaker',
      'event:' || v_event.slug || ':speaker',
      CASE WHEN v_sp.is_primary
        THEN ARRAY['event:' || v_event.slug, 'speaker', 'cfp:accepted']
        ELSE ARRAY['event:' || v_event.slug, 'speaker'] END,
      '{}'::jsonb,
      true,
      'event.cfp.accepted',
      public._event_cfp_audit_meta(v_tenant, v_id, 'accepted')
    );
    IF v_lead IS NOT NULL THEN
      UPDATE public.speaker_profiles sp SET crm_lead_id = COALESCE(sp.crm_lead_id, v_lead)
       WHERE sp.tenant_id = v_tenant AND sp.id = v_profile;
    END IF;

    -- Co przyjecie DODALO - dokladnie to cofnie rezygnacja albo cofniecie
    -- przyjecia. COALESCE: nigdy nie gubimy sladu, ktory juz jest.
    UPDATE public.event_cfp_submission_speakers sp SET
      speaker_profile_id = v_profile,
      added_group_id = COALESCE(v_added_group, sp.added_group_id),
      added_registration_id = COALESCE(v_reg, sp.added_registration_id)
    WHERE sp.tenant_id = v_tenant AND sp.id = v_sp.id;
  END LOOP;

  IF v_schedule IS NOT NULL THEN
    BEGIN
      INSERT INTO public.event_sessions (
        tenant_id, event_id, track_id, room_id, title_pl, title_en,
        description_pl, description_en, starts_at, ends_at, format, status, created_by
      ) VALUES (
        v_tenant, v_sub.event_id, v_track, v_room,
        COALESCE(NULLIF(btrim(v_sub.title_pl), ''), btrim(v_sub.title_en)),
        COALESCE(NULLIF(btrim(v_sub.title_en), ''), btrim(v_sub.title_pl)),
        COALESCE(NULLIF(btrim(v_sub.abstract_pl), ''), btrim(v_sub.abstract_en)),
        COALESCE(NULLIF(btrim(v_sub.abstract_en), ''), btrim(v_sub.abstract_pl)),
        v_starts, v_ends, v_format, 'draft', v_uid
      )
      RETURNING id INTO v_session;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'room_conflict: the room already has a session at this time';
    END;
    INSERT INTO public.event_session_speakers (
      tenant_id, event_id, session_id, speaker_profile_id, role, sort_order
    )
    SELECT v_tenant, v_sub.event_id, v_session, (c->>'profile')::uuid, c->>'role',
           ((c->>'order')::integer + 1) * 10
      FROM jsonb_array_elements(v_cast) c;
  END IF;

  UPDATE public.event_cfp_submissions s SET
    status = 'accepted',
    decision_note = v_note,
    feedback_to_speaker = v_feedback,
    decided_by = v_uid,
    decided_at = v_at,
    notify_error = NULL,
    speaker_profile_id = v_primary_profile,
    session_id = COALESCE(v_session, s.session_id)
  WHERE s.tenant_id = v_tenant AND s.id = v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_cfp_submission',
    v_id::text,
    'event_cfp_submission.decided.v1',
    jsonb_build_object('event_id', v_sub.event_id, 'submission_id', v_id,
                       'status', 'accepted', 'session_id', v_session),
    v_uid
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'status', 'accepted',
    'decided_at', v_at,
    'speaker_profile_id', v_primary_profile,
    'session_id', v_session,
    'speakers_enrolled', v_enrolled,
    'registrations_created', v_regs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_submission_accept(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_submission_accept(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_submission_accept(jsonb) IS
  'Przyjecie zgloszenia: kartoteki i nakladki wystepujacych (event_people -> speaker_profiles), grupa prelegentow, opcjonalny zapis approved z biletem prelegenta, kontakt CRM speaker, opcjonalny szkic sesji z obsada. Publiczna lista prelegentow (event_speaker_entries) dopiero po potwierdzeniu udzialu. Slad dodanych elementow w wierszach wystepujacych (added_*). Kasuje blad poprzedniej wysylki. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 15) PANEL: POWIADOMIENIE O DECYZJI (ladunek dla funkcji serwerowej)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_notify_payload(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'submission_id', s.id,
    'tenant_id', s.tenant_id,
    'event_id', s.event_id,
    'status', s.status,
    'notice', CASE WHEN s.status IN ('accepted', 'rejected', 'changes_requested') THEN s.status END,
    'decided_at', s.decided_at,
    'email', p.email,
    'first_name', p.first_name,
    'lang', s.notify_lang,
    'title_pl', s.title_pl,
    'title_en', s.title_en,
    'feedback_to_speaker', s.feedback_to_speaker,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_starts_at', e.starts_at,
    'event_timezone', e.timezone,
    'session_starts_at', ses.starts_at,
    'notified_status', s.notified_status,
    'notified_at', s.notified_at
  ) INTO v_out
  FROM public.event_cfp_submissions s
  JOIN public.event_people p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
  JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
  LEFT JOIN public.event_sessions ses
    ON ses.tenant_id = s.tenant_id AND ses.event_id = s.event_id AND ses.id = s.session_id
  WHERE s.tenant_id = v_tenant AND s.id = p_submission_id AND s.status <> 'draft';
  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found: submission does not exist in this tenant';
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_notify_payload(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_notify_payload(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_notify_payload(uuid) IS
  'Ladunek maila o decyzji w naborze (adres, jezyk, tytuly, informacja zwrotna, stempel decyzji). Granica autoryzacji dla funkcji serwerowej. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_mark_notified(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'submission_id', '')::uuid;
  v_status text := NULLIF(p_payload->>'status', '');
  v_error text := left(NULLIF(btrim(COALESCE(p_payload->>'error', '')), ''), 500);
BEGIN
  IF v_status IS NULL OR v_status NOT IN ('accepted', 'rejected', 'changes_requested') THEN
    RAISE EXCEPTION 'invalid_status: status must be accepted, rejected or changes_requested';
  END IF;
  UPDATE public.event_cfp_submissions s SET
    notified_status = CASE WHEN v_error IS NULL THEN v_status ELSE s.notified_status END,
    notified_at = CASE WHEN v_error IS NULL THEN now() ELSE s.notified_at END,
    notify_error = v_error
  WHERE s.tenant_id = v_tenant AND s.id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: submission does not exist in this tenant';
  END IF;
  RETURN v_error IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_mark_notified(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_mark_notified(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_mark_notified(jsonb) IS
  'Wynik wysylki maila o decyzji: stempel notified_status/notified_at albo notify_error. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 16) PANEL: RECENZENCI
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_reviewers_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  track_ids uuid[],
  can_see_identity boolean,
  is_active boolean,
  reviews_count integer,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  RETURN QUERY
  SELECT rv.id, rv.user_id,
         COALESCE(NULLIF(btrim(pr.display_name), ''),
                  NULLIF(btrim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), ''),
                  ''),
         pr.avatar_url, rv.track_ids, rv.can_see_identity, rv.is_active,
         (SELECT count(*)::integer FROM public.event_cfp_reviews r
           WHERE r.tenant_id = rv.tenant_id AND r.reviewer_id = rv.id),
         rv.created_at
    FROM public.event_cfp_reviewers rv
    LEFT JOIN public.profiles pr ON pr.id = rv.user_id AND pr.tenant_id = rv.tenant_id
   WHERE rv.tenant_id = v_tenant AND rv.event_id = p_event_id
   ORDER BY rv.is_active DESC, rv.created_at, rv.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_reviewers_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_reviewers_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_reviewers_list(uuid) IS
  'Recenzenci naboru z nazwa konta, zakresem sciezek i liczba ocen. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_reviewer_set(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_user uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_tracks uuid[];
  v_id uuid;
BEGIN
  IF v_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles pr WHERE pr.id = v_user AND pr.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'reviewer_not_found: the account does not belong to this tenant';
  END IF;

  IF p_payload ? 'track_ids' THEN
    IF jsonb_typeof(p_payload->'track_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_tracks: track_ids must be a list';
    END IF;
    BEGIN
      SELECT COALESCE(array_agg(DISTINCT x::uuid), ARRAY[]::uuid[]) INTO v_tracks
        FROM jsonb_array_elements_text(p_payload->'track_ids') x;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_tracks: track_ids must be identifiers';
    END;
    IF EXISTS (
      SELECT 1 FROM unnest(v_tracks) tid
       WHERE NOT EXISTS (
         SELECT 1 FROM public.event_tracks t
          WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id AND t.id = tid
       )
    ) THEN
      RAISE EXCEPTION 'invalid_tracks: every track must belong to this event';
    END IF;
  END IF;

  INSERT INTO public.event_cfp_reviewers AS rv (
    tenant_id, event_id, user_id, track_ids, can_see_identity, is_active, added_by
  ) VALUES (
    v_tenant, v_event_id, v_user, COALESCE(v_tracks, ARRAY[]::uuid[]),
    COALESCE(CASE WHEN jsonb_typeof(p_payload->'can_see_identity') = 'boolean'
      THEN (p_payload->>'can_see_identity')::boolean END, false),
    COALESCE(CASE WHEN jsonb_typeof(p_payload->'is_active') = 'boolean'
      THEN (p_payload->>'is_active')::boolean END, true),
    auth.uid()
  )
  ON CONFLICT (tenant_id, event_id, user_id) DO UPDATE SET
    track_ids = COALESCE(v_tracks, rv.track_ids),
    can_see_identity = CASE WHEN jsonb_typeof(p_payload->'can_see_identity') = 'boolean'
      THEN (p_payload->>'can_see_identity')::boolean ELSE rv.can_see_identity END,
    is_active = CASE WHEN jsonb_typeof(p_payload->'is_active') = 'boolean'
      THEN (p_payload->>'is_active')::boolean ELSE rv.is_active END
  RETURNING rv.id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_reviewer_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_reviewer_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_reviewer_set(jsonb) IS
  'Dodanie albo zmiana recenzenta (konto najemcy; zakres sciezek, wglad w tozsamosc, aktywnosc - PATCH po obecnosci klucza). Bramka: assert_event_admin_tenant().';

-- Recenzent z ocenami NIE jest usuwany (oceny zniklyby kaskada) - tylko
-- dezaktywowany. Bez ocen znika calkiem.
CREATE OR REPLACE FUNCTION public.admin_event_cfp_reviewer_remove(p_reviewer_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  PERFORM 1 FROM public.event_cfp_reviewers rv
   WHERE rv.tenant_id = v_tenant AND rv.id = p_reviewer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: reviewer does not exist in this tenant';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_cfp_reviews r
     WHERE r.tenant_id = v_tenant AND r.reviewer_id = p_reviewer_id
  ) THEN
    UPDATE public.event_cfp_reviewers rv SET is_active = false
     WHERE rv.tenant_id = v_tenant AND rv.id = p_reviewer_id;
    RETURN 'deactivated';
  END IF;
  DELETE FROM public.event_cfp_reviewers rv WHERE rv.tenant_id = v_tenant AND rv.id = p_reviewer_id;
  RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_reviewer_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_reviewer_remove(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_reviewer_remove(uuid) IS
  'Usuniecie recenzenta bez ocen (deleted) albo dezaktywacja recenzenta z ocenami (deactivated). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 17) PANEL: MATERIALY PRELEGENTOW
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_materials_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  speaker_profile_id uuid,
  speaker_name text,
  submission_id uuid,
  session_id uuid,
  kind text,
  title_pl text,
  title_en text,
  url text,
  visibility text,
  is_published boolean,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  RETURN QUERY
  SELECT m.id, m.speaker_profile_id,
         COALESCE(
           NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), ''),
           NULLIF(btrim(pr.display_name), ''),
           ''),
         m.submission_id, m.session_id, m.kind, m.title_pl, m.title_en, m.url,
         m.visibility, m.is_published, m.published_at, m.created_at, m.updated_at
    FROM public.event_speaker_materials m
    JOIN public.speaker_profiles sp ON sp.tenant_id = m.tenant_id AND sp.id = m.speaker_profile_id
    LEFT JOIN public.event_people pe ON pe.tenant_id = sp.tenant_id AND pe.id = sp.person_id
    LEFT JOIN public.profiles pr ON pr.id = sp.user_id AND pr.tenant_id = sp.tenant_id
   WHERE m.tenant_id = v_tenant AND m.event_id = p_event_id
   ORDER BY m.is_published, m.updated_at DESC, m.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_materials_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_materials_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_materials_list(uuid) IS
  'Materialy prelegentow wydarzenia (najpierw czekajace na publikacje). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_material_publish(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_publish boolean;
  v_visibility text;
BEGIN
  IF jsonb_typeof(p_payload->'is_published') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'invalid_payload: is_published must be true or false';
  END IF;
  v_publish := (p_payload->>'is_published')::boolean;
  SELECT m.visibility INTO v_visibility
    FROM public.event_speaker_materials m
   WHERE m.tenant_id = v_tenant AND m.id = v_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: material does not exist in this tenant';
  END IF;
  -- Material "tylko dla organizatorow" z definicji nie trafia na strone -
  -- publikacja niczego by nie zmienila, a panel udawalby, ze zmienila.
  IF v_publish AND v_visibility = 'organizers' THEN
    RAISE EXCEPTION 'invalid_visibility: a material for organizers only cannot be published';
  END IF;
  UPDATE public.event_speaker_materials m SET
    is_published = v_publish,
    published_at = CASE WHEN v_publish THEN now() END,
    published_by = CASE WHEN v_publish THEN auth.uid() END
  WHERE m.tenant_id = v_tenant AND m.id = v_id;
  RETURN v_publish;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_material_publish(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_material_publish(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_material_publish(jsonb) IS
  'Publikacja albo wycofanie publikacji materialu prelegenta; material z widocznoscia organizers nie jest publikowany (invalid_visibility). Opublikowane czyta event_speaker_materials_public. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 18) PLASZCZYZNA TRESCI: STRONA NABORU (anon + zalogowani)
--
-- Tylko wydarzenia opublikowane. Nabor w szkicu nie zdradza tekstow - strona
-- dostaje wylacznie `phase = 'none'`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_cfp_public(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event public.events%ROWTYPE;
  v_s public.event_cfp_settings%ROWTYPE;
  v_phase text;
BEGIN
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = p_slug AND e.status = 'published';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT s.* INTO v_s
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id;
  v_phase := public._event_cfp_phase(v_s.status, v_s.opens_at, v_s.closes_at);

  IF v_phase = 'none' THEN
    RETURN jsonb_build_object(
      'event_id', v_event.id, 'event_slug', v_event.slug, 'timezone', v_event.timezone,
      'phase', 'none', 'is_open', false);
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'timezone', v_event.timezone,
    'phase', v_phase,
    'is_open', v_phase = 'open',
    'opens_at', v_s.opens_at,
    'closes_at', v_s.closes_at,
    'intro_pl', v_s.intro_pl,
    'intro_en', v_s.intro_en,
    'guidelines_pl', v_s.guidelines_pl,
    'guidelines_en', v_s.guidelines_en,
    'formats', v_s.formats,
    'allow_co_speakers', v_s.allow_co_speakers,
    'max_per_submitter', v_s.max_per_submitter,
    'tracks', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', t.id, 'key', t.key, 'name_pl', t.name_pl, 'name_en', t.name_en)
        ORDER BY t.sort_order, t.key), '[]'::jsonb)
        FROM public.event_tracks t
       WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active
         AND t.id = ANY (v_s.track_ids)
    ),
    'fields', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', f.id, 'key', f.key, 'field_type', f.field_type,
        'label_pl', f.label_pl, 'label_en', f.label_en,
        'help_pl', f.help_pl, 'help_en', f.help_en,
        'is_required', f.is_required, 'options', f.options, 'sort_order', f.sort_order)
        ORDER BY f.sort_order, f.key), '[]'::jsonb)
        FROM public.event_cfp_fields f
       WHERE f.tenant_id = v_tenant AND f.event_id = v_event.id AND f.is_active
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_cfp_public(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_public(text) IS
  'Publiczna strona naboru prelegentow: faza (none/scheduled/open/closed), okno, teksty, formy, sciezki i pytania. Tylko wydarzenia opublikowane; szkic naboru nie zdradza tresci. Najemca z public_tenant_id().';

-- ----------------------------------------------------------------------------
-- 18b) PLASZCZYZNA TRESCI: OPUBLIKOWANE MATERIALY PRELEGENTOW
--
-- To jest czytelnik, bez ktorego "Opublikuj" w panelu niczego nie zmienialo.
-- Oddaje WYLACZNIE materialy opublikowane przez organizatora, prelegentow
-- obecnych na liscie wydarzenia (rezygnacja zdejmuje wpis - a z nim
-- materialy), opublikowanego wydarzenia:
--   * `public` - kazdemu;
--   * `registered` - tylko zalogowanemu z zatwierdzonym zapisem (approved /
--     attended) albo potwierdzonym RSVP - ten sam predykat, co zamek sekcji
--     w `event_sections`;
--   * `organizers` - nigdy (i nie da sie go opublikowac).
-- Najemca z `public_tenant_id()`, zero `has_role()` (plaszczyzna tresci).
-- Strona pyta o nie dopiero w dialogu profilu prelegenta (po kliknieciu), wiec
-- odpowiedz zalezna od zalogowania nie trafia do SSR ani do pamieci krawedzi.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_speaker_materials_public(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  speaker_profile_id uuid,
  session_id uuid,
  kind text,
  title_pl text,
  title_en text,
  url text,
  visibility text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event uuid;
  v_registered boolean := false;
BEGIN
  SELECT e.id INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = p_event_id AND e.status = 'published';
  IF v_event IS NULL THEN
    RETURN;
  END IF;

  IF v_uid IS NOT NULL THEN
    v_registered :=
      EXISTS (
        SELECT 1
          FROM public.event_registrations r
          JOIN public.event_people pe ON pe.tenant_id = r.tenant_id AND pe.id = r.person_id
         WHERE r.tenant_id = v_tenant AND r.event_id = v_event
           AND pe.user_id = v_uid AND r.status IN ('approved', 'attended')
      )
      OR EXISTS (
        SELECT 1 FROM public.event_rsvps rs
         WHERE rs.tenant_id = v_tenant AND rs.event_id = v_event
           AND rs.user_id = v_uid AND rs.status = 'going'
      );
  END IF;

  RETURN QUERY
  SELECT m.id, m.speaker_profile_id, m.session_id, m.kind, m.title_pl, m.title_en, m.url, m.visibility
    FROM public.event_speaker_materials m
   WHERE m.tenant_id = v_tenant
     AND m.event_id = v_event
     AND m.is_published
     AND (m.visibility = 'public' OR (m.visibility = 'registered' AND v_registered))
     AND EXISTS (
       SELECT 1 FROM public.event_speaker_entries en
        WHERE en.tenant_id = m.tenant_id AND en.event_id = m.event_id
          AND en.speaker_profile_id = m.speaker_profile_id
     )
   ORDER BY m.speaker_profile_id, m.created_at, m.id;
END;
$$;

REVOKE ALL ON FUNCTION public.event_speaker_materials_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_speaker_materials_public(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_speaker_materials_public(uuid) IS
  'Opublikowane materialy prelegentow z listy prelegentow OPUBLIKOWANEGO wydarzenia: public dla kazdego, registered dla zalogowanego z zatwierdzonym zapisem albo RSVP going, organizers nigdy. Najemca z public_tenant_id(), zero has_role().';

-- ----------------------------------------------------------------------------
-- 19) PLASZCZYZNA WLASNA: SZKIC I WYSLANIE ZGLOSZENIA
-- ----------------------------------------------------------------------------

-- Wlasne zgloszenie wolajacego (po kartotece z `user_id = auth.uid()`).
CREATE OR REPLACE FUNCTION public._event_cfp_own_submission(
  p_tenant uuid, p_uid uuid, p_submission_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id
    FROM public.event_cfp_submissions s
    JOIN public.event_people p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
   WHERE s.tenant_id = p_tenant AND s.id = p_submission_id AND p.user_id = p_uid
$$;

REVOKE ALL ON FUNCTION public._event_cfp_own_submission(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_own_submission(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_cfp_own_submission(uuid, uuid, uuid) IS
  'Identyfikator zgloszenia, jesli nalezy do osoby z kontem p_uid w najemcy p_tenant; inaczej NULL.';

CREATE OR REPLACE FUNCTION public.event_cfp_submission_save(p_payload jsonb)
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
  v_person uuid;
  v_count integer;
  v_title_pl text;
  v_title_en text;
  v_abstract_pl text;
  v_abstract_en text;
  v_language text;
  v_lang text;
  v_format text;
  v_duration integer;
  v_track uuid;
  v_topics text[];
  v_answers jsonb;
  v_role text;
  v_item jsonb;
  v_first text;
  v_last text;
  v_email text;
  v_emails text[] := ARRAY[]::text[];
  v_order integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to submit a talk';
  END IF;
  SELECT r.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_cfp_save', v_tenant::text || ':' || v_uid::text, 60, 10) r;
  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'rate_limited: too many changes, try again in a few minutes';
  END IF;

  IF v_id IS NULL THEN
    SELECT e.* INTO v_event
      FROM public.events e
     WHERE e.tenant_id = v_tenant AND e.slug = NULLIF(p_payload->>'slug', '') AND e.status = 'published';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: event does not exist';
    END IF;
    SELECT s.* INTO v_s
      FROM public.event_cfp_settings s
     WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id
     FOR UPDATE;
    IF NOT FOUND OR NOT public._event_cfp_is_open(v_s.status, v_s.opens_at, v_s.closes_at) THEN
      RAISE EXCEPTION 'cfp_closed: the call for speakers is not open';
    END IF;
    v_person := public._event_cfp_resolve_person(v_tenant, v_uid, p_payload->'speaker');
    SELECT count(*) INTO v_count
      FROM public.event_cfp_submissions s
     WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id AND s.person_id = v_person
       AND s.status <> 'withdrawn';
    IF v_count >= v_s.max_per_submitter THEN
      RAISE EXCEPTION 'limit_reached: at most % submissions per person', v_s.max_per_submitter;
    END IF;
    INSERT INTO public.event_cfp_submissions (tenant_id, event_id, person_id, created_by)
    VALUES (v_tenant, v_event.id, v_person, v_uid)
    RETURNING * INTO v_sub;
    INSERT INTO public.event_cfp_submission_speakers (
      tenant_id, event_id, submission_id, person_id, is_primary, role, sort_order,
      first_name, last_name, email, job_title, company_text
    )
    SELECT v_tenant, v_event.id, v_sub.id, p.id, true, 'speaker', 0,
           p.first_name, p.last_name, NULLIF(btrim(COALESCE(p.email, '')), ''), p.job_title, p.company_text
      FROM public.event_people p
     WHERE p.tenant_id = v_tenant AND p.id = v_person;
  ELSE
    IF public._event_cfp_own_submission(v_tenant, v_uid, v_id) IS NULL THEN
      RAISE EXCEPTION 'not_found: submission does not exist';
    END IF;
    SELECT s.* INTO v_sub
      FROM public.event_cfp_submissions s
     WHERE s.tenant_id = v_tenant AND s.id = v_id
     FOR UPDATE;
    IF v_sub.status NOT IN ('draft', 'changes_requested') THEN
      RAISE EXCEPTION 'not_editable: a % submission cannot be changed', v_sub.status;
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
    IF p_payload ? 'speaker' THEN
      v_person := public._event_cfp_resolve_person(v_tenant, v_uid, p_payload->'speaker');
      UPDATE public.event_cfp_submission_speakers sp SET
        first_name = p.first_name,
        last_name = p.last_name,
        job_title = p.job_title,
        company_text = p.company_text
        FROM public.event_people p
       WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id AND sp.is_primary
         AND p.tenant_id = v_tenant AND p.id = v_sub.person_id;
    END IF;
  END IF;

  v_title_pl := CASE WHEN p_payload ? 'title_pl' THEN btrim(COALESCE(p_payload->>'title_pl', '')) ELSE v_sub.title_pl END;
  v_title_en := CASE WHEN p_payload ? 'title_en' THEN btrim(COALESCE(p_payload->>'title_en', '')) ELSE v_sub.title_en END;
  IF char_length(v_title_pl) > 200 OR char_length(v_title_en) > 200 THEN
    RAISE EXCEPTION 'invalid_title: titles are limited to 200 characters';
  END IF;
  v_abstract_pl := CASE WHEN p_payload ? 'abstract_pl' THEN btrim(COALESCE(p_payload->>'abstract_pl', '')) ELSE v_sub.abstract_pl END;
  v_abstract_en := CASE WHEN p_payload ? 'abstract_en' THEN btrim(COALESCE(p_payload->>'abstract_en', '')) ELSE v_sub.abstract_en END;
  IF char_length(v_abstract_pl) > 4000 OR char_length(v_abstract_en) > 4000 THEN
    RAISE EXCEPTION 'invalid_abstract: abstracts are limited to 4000 characters';
  END IF;
  v_language := CASE WHEN p_payload ? 'talk_language' THEN p_payload->>'talk_language' ELSE v_sub.talk_language END;
  IF v_language IS NULL OR v_language NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_language: the talk language must be pl or en';
  END IF;
  v_lang := CASE WHEN p_payload->>'notify_lang' IN ('pl', 'en') THEN p_payload->>'notify_lang' ELSE v_sub.notify_lang END;

  v_format := CASE WHEN p_payload ? 'format_key' THEN NULLIF(btrim(COALESCE(p_payload->>'format_key', '')), '') ELSE v_sub.format_key END;
  v_duration := NULL;
  IF v_format IS NOT NULL THEN
    SELECT public._event_cfp_jsonb_int(f -> 'duration_min') INTO v_duration
      FROM jsonb_array_elements(COALESCE(v_s.formats, '[]'::jsonb)) f
     WHERE f ->> 'key' = v_format;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_format: unknown format for this call';
    END IF;
  END IF;

  v_track := CASE WHEN p_payload ? 'track_id' THEN NULLIF(p_payload->>'track_id', '')::uuid ELSE v_sub.track_id END;
  IF v_track IS NOT NULL AND NOT (v_track = ANY (COALESCE(v_s.track_ids, '{}'::uuid[]))) THEN
    RAISE EXCEPTION 'invalid_track: the track is not open for submissions';
  END IF;

  IF p_payload ? 'topics' THEN
    IF jsonb_typeof(p_payload->'topics') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_topics: topics must be a list';
    END IF;
    v_topics := public._event_speaker_text_array(p_payload->'topics');
    IF cardinality(v_topics) > 10 OR EXISTS (SELECT 1 FROM unnest(v_topics) x WHERE char_length(x) > 60) THEN
      RAISE EXCEPTION 'invalid_topics: at most 10 topics of up to 60 characters';
    END IF;
  ELSE
    v_topics := v_sub.topics;
  END IF;

  v_answers := CASE WHEN p_payload ? 'answers'
    THEN public._event_cfp_clean_answers(v_tenant, v_sub.event_id, p_payload->'answers') ELSE v_sub.answers END;

  IF p_payload ? 'role' THEN
    v_role := p_payload->>'role';
    IF v_role IS NULL OR v_role NOT IN ('speaker', 'moderator', 'panelist', 'host') THEN
      RAISE EXCEPTION 'invalid_role: unknown speaker role';
    END IF;
    UPDATE public.event_cfp_submission_speakers sp SET role = v_role
     WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id AND sp.is_primary;
  END IF;

  IF p_payload ? 'co_speakers' THEN
    IF jsonb_typeof(p_payload->'co_speakers') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_speakers: co_speakers must be a list';
    END IF;
    IF jsonb_array_length(p_payload->'co_speakers') > 0 AND NOT COALESCE(v_s.allow_co_speakers, true) THEN
      RAISE EXCEPTION 'co_speakers_disabled: this call accepts single-speaker talks only';
    END IF;
    IF jsonb_array_length(p_payload->'co_speakers') > 5 THEN
      RAISE EXCEPTION 'too_many_speakers: at most 5 co-speakers';
    END IF;
    SELECT ARRAY[lower(btrim(COALESCE(sp.email, '')))] INTO v_emails
      FROM public.event_cfp_submission_speakers sp
     WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id AND sp.is_primary;
    DELETE FROM public.event_cfp_submission_speakers sp
     WHERE sp.tenant_id = v_tenant AND sp.submission_id = v_sub.id AND NOT sp.is_primary;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'co_speakers') LOOP
      v_first := btrim(COALESCE(v_item->>'first_name', ''));
      v_last := btrim(COALESCE(v_item->>'last_name', ''));
      v_email := NULLIF(lower(btrim(COALESCE(v_item->>'email', ''))), '');
      v_role := COALESCE(NULLIF(v_item->>'role', ''), 'speaker');
      v_order := v_order + 1;
      IF jsonb_typeof(v_item) <> 'object'
         OR char_length(v_first) NOT BETWEEN 1 AND 80
         OR char_length(v_last) NOT BETWEEN 1 AND 80
         OR (v_email IS NOT NULL AND (
               char_length(v_email) > 320
               OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
               OR v_email = ANY (v_emails)))
         OR char_length(btrim(COALESCE(v_item->>'job_title', ''))) > 160
         OR char_length(btrim(COALESCE(v_item->>'company_text', ''))) > 200
         OR v_role NOT IN ('speaker', 'moderator', 'panelist', 'host') THEN
        RAISE EXCEPTION 'invalid_speakers: co-speaker % needs a name, a unique valid e-mail and a known role', v_order;
      END IF;
      IF v_email IS NOT NULL THEN
        v_emails := v_emails || v_email;
      END IF;
      INSERT INTO public.event_cfp_submission_speakers (
        tenant_id, event_id, submission_id, is_primary, role, sort_order,
        first_name, last_name, email, job_title, company_text
      ) VALUES (
        v_tenant, v_sub.event_id, v_sub.id, false, v_role, v_order,
        v_first, v_last, v_email,
        NULLIF(btrim(COALESCE(v_item->>'job_title', '')), ''),
        NULLIF(btrim(COALESCE(v_item->>'company_text', '')), '')
      );
    END LOOP;
  END IF;

  UPDATE public.event_cfp_submissions s SET
    title_pl = v_title_pl,
    title_en = v_title_en,
    abstract_pl = v_abstract_pl,
    abstract_en = v_abstract_en,
    talk_language = v_language,
    notify_lang = v_lang,
    format_key = v_format,
    duration_min = v_duration,
    track_id = v_track,
    topics = v_topics,
    answers = v_answers
  WHERE s.tenant_id = v_tenant AND s.id = v_sub.id;

  RETURN jsonb_build_object('id', v_sub.id, 'status', v_sub.status, 'event_id', v_sub.event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.event_cfp_submission_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cfp_submission_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_cfp_submission_save(jsonb) IS
  'Szkic zgloszenia prelegenta: zalozenie (nabor otwarty, limit pod blokada ustawien, kartoteka po koncie) albo zmiana szkicu / zgloszenia z prosba o poprawki (PATCH po obecnosci klucza). Najemca z public_tenant_id(), tozsamosc z auth.uid().';
