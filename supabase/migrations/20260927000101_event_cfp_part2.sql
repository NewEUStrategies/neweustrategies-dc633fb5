-- CZESC 2/6 MIGRACJI 20260927000100_event_cfp.sql
-- migration-split: part 2/6 of 20260927000100_event_cfp.sql
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

-- Metadane wpisu osi czasu CRM (kontrakt typu "event": event_id, event_slug,
-- event_title_pl/en, summary_pl/en + identyfikatory naboru). Bez ocen, bez
-- notatek - tylko to, co wolno zobaczyc redaktorowi CRM.
CREATE OR REPLACE FUNCTION public._event_cfp_audit_meta(
  p_tenant uuid, p_submission_id uuid, p_status text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'event_id', e.id,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'submission_id', s.id,
    'cfp_status', p_status,
    'summary_pl', CASE WHEN p_status = 'submitted'
      THEN format(U&'Zg\0142oszenie wyst\0105pienia: %s (%s)',
                  COALESCE(NULLIF(btrim(s.title_pl), ''), s.title_en), e.title_pl)
      ELSE format(U&'Nab\00F3r prelegent\00F3w - %s: %s (%s)',
                  public._event_cfp_status_label(p_status, 'pl'),
                  COALESCE(NULLIF(btrim(s.title_pl), ''), s.title_en), e.title_pl)
    END,
    'summary_en', CASE WHEN p_status = 'submitted'
      THEN format('Talk submitted: %s (%s)',
                  COALESCE(NULLIF(btrim(s.title_en), ''), s.title_pl), e.title_en)
      ELSE format('Call for speakers - %s: %s (%s)',
                  public._event_cfp_status_label(p_status, 'en'),
                  COALESCE(NULLIF(btrim(s.title_en), ''), s.title_pl), e.title_en)
    END
  )
  FROM public.event_cfp_submissions s
  JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
  WHERE s.tenant_id = p_tenant AND s.id = p_submission_id
$$;

REVOKE ALL ON FUNCTION public._event_cfp_audit_meta(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_audit_meta(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_cfp_audit_meta(uuid, uuid, text) IS
  'Metadane wpisu osi czasu CRM dla zgloszenia (kontrakt typu event). Bez ocen i notatek.';

-- Zapis stanu zgloszenia do CRM przez most f0. Zglaszajacy: wzbogacenie
-- istniejacego kontaktu (p_create = false) - kontakt zaklada wylacznie
-- wyslanie zgloszenia i przyjecie.
CREATE OR REPLACE FUNCTION public._event_cfp_crm_status(p_tenant uuid, p_submission_id uuid, p_status text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person uuid;
  v_slug text;
BEGIN
  SELECT s.person_id, e.slug INTO v_person, v_slug
    FROM public.event_cfp_submissions s
    JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
   WHERE s.tenant_id = p_tenant AND s.id = p_submission_id;
  IF v_person IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public._event_person_crm_sync(
    p_tenant,
    v_person,
    'event_cfp',
    'event:' || v_slug || ':cfp',
    ARRAY['event:' || v_slug, 'cfp:' || p_status],
    '{}'::jsonb,
    false,
    'event.cfp.' || p_status,
    public._event_cfp_audit_meta(p_tenant, p_submission_id, p_status)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_cfp_crm_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_crm_status(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_cfp_crm_status(uuid, uuid, text) IS
  'Tag cfp:<status> i wpis osi czasu event.cfp.<status> u zglaszajacego - tylko istniejacy kontakt CRM (p_create = false). Nigdy nie rzuca (most).';

-- Agregaty ocen jednego zgloszenia. Ocena z konfliktem interesow nie liczy sie
-- do sredniej ani do rekomendacji; wynik wazony liczony z BIEZACYCH kryteriow.
CREATE OR REPLACE FUNCTION public._event_cfp_review_summary(p_tenant uuid, p_submission_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH crit AS (
    SELECT COALESCE(cs.review_criteria, '[]'::jsonb) AS criteria
      FROM public.event_cfp_submissions sub
      LEFT JOIN public.event_cfp_settings cs
        ON cs.tenant_id = sub.tenant_id AND cs.event_id = sub.event_id
     WHERE sub.tenant_id = p_tenant AND sub.id = p_submission_id
  ), rv AS (
    SELECT r.overall, r.recommendation, r.conflict_of_interest,
      (SELECT sum((r.scores ->> (c ->> 'key'))::numeric * (c ->> 'weight')::numeric)
              / NULLIF(sum((c ->> 'weight')::numeric), 0)
         FROM crit, jsonb_array_elements(crit.criteria) c
        WHERE jsonb_typeof(r.scores -> (c ->> 'key')) = 'number') AS weighted
      FROM public.event_cfp_reviews r
     WHERE r.tenant_id = p_tenant AND r.submission_id = p_submission_id
  )
  SELECT jsonb_build_object(
    'reviews_count', count(*) FILTER (WHERE NOT rv.conflict_of_interest AND rv.overall IS NOT NULL),
    'reviews_total', count(*),
    'conflicts_count', count(*) FILTER (WHERE rv.conflict_of_interest),
    'overall_avg', round(avg(rv.overall) FILTER (WHERE NOT rv.conflict_of_interest), 2),
    'weighted_avg', round(avg(rv.weighted) FILTER (WHERE NOT rv.conflict_of_interest), 2),
    'recommendations', jsonb_build_object(
      'accept', count(*) FILTER (WHERE rv.recommendation = 'accept' AND NOT rv.conflict_of_interest),
      'maybe', count(*) FILTER (WHERE rv.recommendation = 'maybe' AND NOT rv.conflict_of_interest),
      'reject', count(*) FILTER (WHERE rv.recommendation = 'reject' AND NOT rv.conflict_of_interest),
      'abstain', count(*) FILTER (WHERE rv.recommendation = 'abstain' AND NOT rv.conflict_of_interest)
    )
  )
  FROM rv
$$;

REVOKE ALL ON FUNCTION public._event_cfp_review_summary(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_review_summary(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_cfp_review_summary(uuid, uuid) IS
  'Agregaty ocen zgloszenia: liczba ocen, srednia ogolna, srednia wazona kryteriow, rekomendacje. Oceny z konfliktem interesow poza srednimi.';

-- Ocena ZBIORCZA pokazywana prelegentowi (panel, eksport RODO): liczba ocen
-- zawsze, srednia dopiero po decyzji i tylko wtedy, gdy zlozyly sie na nia co
-- najmniej DWIE oceny (i nie mniej niz `min_reviews`). Srednia z jednej oceny
-- to dokladna ocena jednego recenzenta - a ta zostaje u organizatora.
CREATE OR REPLACE FUNCTION public._event_cfp_speaker_review_summary(
  p_tenant uuid, p_submission_id uuid, p_status text, p_min_reviews integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'reviews_count', (sm.summary->>'reviews_count')::integer,
    'overall_avg', CASE
      WHEN p_status IN ('accepted', 'waitlisted', 'rejected', 'confirmed', 'declined')
       AND (sm.summary->>'reviews_count')::integer >= GREATEST(2, COALESCE(p_min_reviews, 2))
        THEN sm.summary->'overall_avg'
      ELSE 'null'::jsonb
    END
  )
  FROM (SELECT public._event_cfp_review_summary(p_tenant, p_submission_id) AS summary) sm
$$;

REVOKE ALL ON FUNCTION public._event_cfp_speaker_review_summary(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_speaker_review_summary(uuid, uuid, text, integer) TO service_role;

COMMENT ON FUNCTION public._event_cfp_speaker_review_summary(uuid, uuid, text, integer) IS
  'Ocena zbiorcza dla prelegenta: liczba ocen oraz srednia po decyzji, gdy ocen jest co najmniej GREATEST(2, min_reviews); inaczej srednia NULL.';

-- Odpowiedzi na pytania: zostaja tylko klucze AKTYWNYCH pytan, wartosc
-- w ksztalcie typu pytania (tekst, liczba, adres https, wybor z opcji, tak/nie).
-- Pusta odpowiedz = brak klucza. Zly ksztalt = `invalid_answers: <klucz>`.
CREATE OR REPLACE FUNCTION public._event_cfp_clean_answers(
  p_tenant uuid, p_event_id uuid, p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_field record;
  v_value jsonb;
  v_kind text;
  v_text text;
  v_values text[];
  v_allowed text[];
BEGIN
  IF p_answers IS NULL OR jsonb_typeof(p_answers) = 'null' THEN
    RETURN v_out;
  END IF;
  IF jsonb_typeof(p_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;
  IF length(p_answers::text) > 60000 THEN
    RAISE EXCEPTION 'invalid_answers: answers are too long';
  END IF;

  FOR v_field IN
    SELECT f.key, f.field_type, f.options
      FROM public.event_cfp_fields f
     WHERE f.tenant_id = p_tenant AND f.event_id = p_event_id AND f.is_active
  LOOP
    v_value := p_answers -> v_field.key;
    v_kind := COALESCE(jsonb_typeof(v_value), 'null');
    CONTINUE WHEN v_kind = 'null';
    SELECT COALESCE(array_agg(o ->> 'value'), ARRAY[]::text[]) INTO v_allowed
      FROM jsonb_array_elements(v_field.options) o;

    IF v_field.field_type = 'multiselect' THEN
      IF v_kind <> 'array' THEN
        RAISE EXCEPTION 'invalid_answers: % expects a list', v_field.key;
      END IF;
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_values
        FROM jsonb_array_elements_text(v_value) x
       WHERE btrim(x) <> '';
      IF NOT (v_values <@ v_allowed) THEN
        RAISE EXCEPTION 'invalid_answers: % has an unknown option', v_field.key;
      END IF;
      IF cardinality(v_values) > 0 THEN
        v_out := v_out || jsonb_build_object(v_field.key, to_jsonb(v_values));
      END IF;
    ELSIF v_field.field_type = 'checkbox' THEN
      IF v_kind = 'boolean' THEN
        v_out := v_out || jsonb_build_object(v_field.key, v_value);
      ELSIF v_kind = 'string' AND lower(btrim(v_value #>> '{}')) IN ('true', 'false') THEN
        v_out := v_out || jsonb_build_object(v_field.key, lower(btrim(v_value #>> '{}'))::boolean);
      ELSIF NOT (v_kind = 'string' AND btrim(v_value #>> '{}') = '') THEN
        RAISE EXCEPTION 'invalid_answers: % expects yes or no', v_field.key;
      END IF;
    ELSE
      IF v_kind NOT IN ('string', 'number') THEN
        RAISE EXCEPTION 'invalid_answers: % expects text', v_field.key;
      END IF;
      v_text := btrim(v_value #>> '{}');
      CONTINUE WHEN v_text = '';
      IF v_field.field_type = 'number' THEN
        IF v_text !~ '^-?[0-9]{1,12}([.][0-9]{1,6})?$' THEN
          RAISE EXCEPTION 'invalid_answers: % expects a number', v_field.key;
        END IF;
        v_out := v_out || jsonb_build_object(v_field.key, v_text::numeric);
      ELSIF v_field.field_type = 'url' THEN
        IF v_text !~* '^https://[^\s]{3,}$' OR char_length(v_text) > 2008 THEN
          RAISE EXCEPTION 'invalid_answers: % expects an https address', v_field.key;
        END IF;
        v_out := v_out || jsonb_build_object(v_field.key, v_text);
      ELSIF v_field.field_type = 'select' THEN
        IF NOT (v_text = ANY (v_allowed)) THEN
          RAISE EXCEPTION 'invalid_answers: % has an unknown option', v_field.key;
        END IF;
        v_out := v_out || jsonb_build_object(v_field.key, v_text);
      ELSE
        IF char_length(v_text) > (CASE WHEN v_field.field_type = 'textarea' THEN 4000 ELSE 500 END) THEN
          RAISE EXCEPTION 'invalid_answers: % is too long', v_field.key;
        END IF;
        v_out := v_out || jsonb_build_object(v_field.key, v_text);
      END IF;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public._event_cfp_clean_answers(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_clean_answers(uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public._event_cfp_clean_answers(uuid, uuid, jsonb) IS
  'Odpowiedzi zgloszenia przyciete do aktywnych pytan i sprawdzone wzgledem typu pytania. Blad: invalid_answers.';

-- Osoba zglaszajacego (wzorzec `event_register`): po koncie, potem po adresie
-- KONTA, inaczej nowa kartoteka. Adres z formularza nie decyduje o tozsamosci.
--
-- ZGODY WYLACZNIE Z JAWNEGO ZAZNACZENIA:
--   * przetwarzanie danych - wymagane przy kazdym zapisie danych osoby
--     (`consent_required`, jak `event_register`); stempel stawiany tylko wtedy;
--   * marketing - zaznaczenie nadaje zgode; brak zaznaczenia NIE jest
--     wycofaniem (formularz nie udaje wycofania); `consent_withdrawn_at`
--     nie jest tu nigdy kasowany - to stempel wycofania WSZYSTKICH zgod,
--     wiec jego skasowanie wskrzesiloby tez zgode na przekazanie danych
--     partnerom. Osoba z wycofanymi zgodami nie odzyskuje tu marketingu
--     (formularz w tym stanie w ogole nie pokazuje pola).
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
  v_person uuid;
  v_owner uuid;
  v_email text;
  v_speaker jsonb := CASE WHEN jsonb_typeof(p_speaker) = 'object' THEN p_speaker ELSE '{}'::jsonb END;
  v_first text := NULLIF(btrim(COALESCE(v_speaker->>'first_name', '')), '');
  v_last text := NULLIF(btrim(COALESCE(v_speaker->>'last_name', '')), '');
  v_job text := NULLIF(btrim(COALESCE(v_speaker->>'job_title', '')), '');
  v_company text := NULLIF(btrim(COALESCE(v_speaker->>'company_text', '')), '');
  v_marketing boolean := COALESCE(v_speaker->'consent_marketing' = 'true'::jsonb, false);
  v_data_ok boolean := COALESCE(v_speaker->'consent_data_processing' = 'true'::jsonb, false);
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

  SELECT p.id INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.user_id = p_uid;

  IF v_person IS NULL THEN
    SELECT NULLIF(lower(btrim(u.email)), '') INTO v_email FROM auth.users u WHERE u.id = p_uid;
    IF v_email IS NULL THEN
      RAISE EXCEPTION 'email_required: the account has no e-mail address';
    END IF;
    SELECT p.id, p.user_id INTO v_person, v_owner
      FROM public.event_people p
     WHERE p.tenant_id = p_tenant AND p.email_norm = v_email;
    IF v_person IS NOT NULL AND v_owner IS NOT NULL AND v_owner <> p_uid THEN
      RAISE EXCEPTION 'email_in_use: this e-mail belongs to another account';
    END IF;
  END IF;

  IF v_person IS NULL THEN
    IF v_first IS NULL OR v_last IS NULL THEN
      RAISE EXCEPTION 'invalid_name: first name and last name are required';
    END IF;
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, job_title, company_text,
      source, consent_data_processing_at, consent_marketing_at, created_by
    ) VALUES (
      p_tenant, p_uid, v_email, v_first, v_last, v_job, v_company,
      'self_registration', now(), CASE WHEN v_marketing THEN now() END, p_uid
    )
    RETURNING id INTO v_person;
  ELSE
    UPDATE public.event_people p SET
      user_id = COALESCE(p.user_id, p_uid),
      first_name = COALESCE(v_first, p.first_name),
      last_name = COALESCE(v_last, p.last_name),
      job_title = CASE WHEN v_speaker ? 'job_title' THEN v_job ELSE p.job_title END,
      company_text = CASE WHEN v_speaker ? 'company_text' THEN v_company ELSE p.company_text END,
      consent_data_processing_at = COALESCE(p.consent_data_processing_at, now()),
      consent_marketing_at = CASE
        WHEN v_marketing AND p.consent_withdrawn_at IS NULL THEN COALESCE(p.consent_marketing_at, now())
        ELSE p.consent_marketing_at
      END
    WHERE p.tenant_id = p_tenant AND p.id = v_person;
  END IF;

  RETURN v_person;
END;
$$;

REVOKE ALL ON FUNCTION public._event_cfp_resolve_person(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_resolve_person(uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public._event_cfp_resolve_person(uuid, uuid, jsonb) IS
  'Kartoteka zglaszajacego: po event_people.user_id, potem po adresie konta (auth.users.email), inaczej nowa osoba self_registration. Wymaga jawnej zgody na przetwarzanie danych (consent_required). Zgoda marketingowa tylko z jawnego zaznaczenia; brak zaznaczenia jej nie wycofuje, wycofanych zgod nie wskrzesza.';

-- Nakladka sceniczna osoby: nakladka KONTA, jesli osoba ma konto i taka
-- nakladka juz istnieje (ta sama osoba nie dostaje drugiej karty), inaczej
-- nakladka osoby (tryb `admin_event_speaker_upsert` bez konta).
CREATE OR REPLACE FUNCTION public._event_speaker_overlay_for_person(p_tenant uuid, p_person_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_profile uuid;
BEGIN
  SELECT p.user_id INTO v_user
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.id = p_person_id;

  IF v_user IS NOT NULL THEN
    SELECT sp.id INTO v_profile
      FROM public.speaker_profiles sp
     WHERE sp.tenant_id = p_tenant AND sp.user_id = v_user;
    IF v_profile IS NOT NULL THEN
      RETURN v_profile;
    END IF;
  END IF;

  INSERT INTO public.speaker_profiles AS sp (tenant_id, person_id)
  VALUES (p_tenant, p_person_id)
  ON CONFLICT (tenant_id, person_id) WHERE person_id IS NOT NULL DO UPDATE
    SET updated_at = now()
  RETURNING sp.id INTO v_profile;
  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public._event_speaker_overlay_for_person(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_speaker_overlay_for_person(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_speaker_overlay_for_person(uuid, uuid) IS
  'Nakladka sceniczna osoby: istniejaca nakladka konta osoby albo nakladka osoby (speaker_profiles.person_id).';

-- Dopisanie nakladki do rejestru prelegentow wydarzenia (na koniec listy).
-- Wspolny ogon `admin_event_speaker_upsert` i przyjecia zgloszenia.
CREATE OR REPLACE FUNCTION public._event_speaker_roster_add(
  p_tenant uuid, p_event_id uuid, p_profile_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sort integer;
  v_entry uuid;
BEGIN
  SELECT COALESCE(MAX(en.sort_order) + 1, 0) INTO v_sort
    FROM public.event_speaker_entries en
   WHERE en.tenant_id = p_tenant AND en.event_id = p_event_id;

  INSERT INTO public.event_speaker_entries AS en (
    tenant_id, event_id, speaker_profile_id, sort_order
  ) VALUES (p_tenant, p_event_id, p_profile_id, v_sort)
  ON CONFLICT (tenant_id, event_id, speaker_profile_id) DO UPDATE
    SET updated_at = now()
  RETURNING en.id INTO v_entry;
  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public._event_speaker_roster_add(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_speaker_roster_add(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_speaker_roster_add(uuid, uuid, uuid) IS
  'Wpis nakladki do rejestru prelegentow wydarzenia (event_speaker_entries) na koncu listy; powtorzenie nie dubluje wpisu.';

-- Ten sam kontrakt, co w 20260924140000; ogon (dopisanie do rejestru) idzie
-- przez wspolny `_event_speaker_roster_add`.
CREATE OR REPLACE FUNCTION public.admin_event_speaker_upsert(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant     uuid := public.assert_event_admin_tenant();
  v_uid        uuid := auth.uid();
  v_event_id   uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_user_id    uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_person_id  uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_group_id   uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_email      text := NULLIF(btrim(p_payload->>'email'), '');
  v_first      text := NULLIF(btrim(p_payload->>'first_name'), '');
  v_last       text := NULLIF(btrim(p_payload->>'last_name'), '');
  v_profile_id uuid;
  v_entry_id   uuid;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: event_id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles pr
       WHERE pr.id = v_user_id AND pr.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'event_speakers: profile not found in tenant' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.speaker_profiles AS sp (tenant_id, user_id)
    VALUES (v_tenant, v_user_id)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET updated_at = now()
    RETURNING sp.id INTO v_profile_id;
  ELSE
    IF v_person_id IS NULL THEN
      IF v_first IS NULL OR v_last IS NULL THEN
        RAISE EXCEPTION 'event_speakers: first_name and last_name are required'
          USING ERRCODE = '22023';
      END IF;

      IF v_email IS NOT NULL THEN
        SELECT pe.id INTO v_person_id
          FROM public.event_people pe
         WHERE pe.tenant_id = v_tenant
           AND pe.email_norm = lower(btrim(v_email));
      END IF;
    END IF;

    IF v_person_id IS NULL THEN
      INSERT INTO public.event_people (
        tenant_id, email, first_name, last_name, phone, job_title,
        company_text, social_profile_url, photo_url, bio_pl, bio_en,
        source, consent_data_processing_at, created_by
      ) VALUES (
        v_tenant, v_email, v_first, v_last,
        NULLIF(btrim(p_payload->>'phone'), ''),
        NULLIF(btrim(p_payload->>'job_title'), ''),
        NULLIF(btrim(p_payload->>'company_text'), ''),
        NULLIF(btrim(p_payload->>'social_profile_url'), ''),
        NULLIF(btrim(p_payload->>'photo_url'), ''),
        NULLIF(btrim(p_payload->>'bio_pl'), ''),
        NULLIF(btrim(p_payload->>'bio_en'), ''),
        'organizer', now(), v_uid
      )
      RETURNING id INTO v_person_id;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.event_people pe
         WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant
      ) THEN
        RAISE EXCEPTION 'event_speakers: person not found in tenant' USING ERRCODE = '42501';
      END IF;

      UPDATE public.event_people pe SET
        first_name         = COALESCE(v_first, pe.first_name),
        last_name          = COALESCE(v_last, pe.last_name),
        email              = COALESCE(v_email, pe.email),
        phone              = COALESCE(NULLIF(btrim(p_payload->>'phone'), ''), pe.phone),
        job_title          = COALESCE(NULLIF(btrim(p_payload->>'job_title'), ''), pe.job_title),
        company_text       = COALESCE(NULLIF(btrim(p_payload->>'company_text'), ''), pe.company_text),
        social_profile_url = COALESCE(NULLIF(btrim(p_payload->>'social_profile_url'), ''), pe.social_profile_url),
        photo_url          = COALESCE(NULLIF(btrim(p_payload->>'photo_url'), ''), pe.photo_url),
        bio_pl             = COALESCE(NULLIF(btrim(p_payload->>'bio_pl'), ''), pe.bio_pl),
        bio_en             = COALESCE(NULLIF(btrim(p_payload->>'bio_en'), ''), pe.bio_en),
        consent_data_processing_at = COALESCE(pe.consent_data_processing_at, now())
      WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant;
    END IF;

    INSERT INTO public.speaker_profiles AS sp (tenant_id, person_id)
    VALUES (v_tenant, v_person_id)
    ON CONFLICT (tenant_id, person_id) WHERE person_id IS NOT NULL DO UPDATE
      SET updated_at = now()
    RETURNING sp.id INTO v_profile_id;

    IF v_group_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.event_groups g
         WHERE g.id = v_group_id AND g.tenant_id = v_tenant AND g.event_id = v_event_id
      ) THEN
        RAISE EXCEPTION 'event_speakers: group not found in event' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.event_group_members (tenant_id, event_id, group_id, person_id, added_by)
      VALUES (v_tenant, v_event_id, v_group_id, v_person_id, v_uid)
      ON CONFLICT (tenant_id, group_id, person_id) DO NOTHING;
    END IF;
  END IF;

  UPDATE public.speaker_profiles sp SET
    headline_pl = COALESCE(NULLIF(btrim(p_payload->>'headline_pl'), ''), sp.headline_pl),
    headline_en = COALESCE(NULLIF(btrim(p_payload->>'headline_en'), ''), sp.headline_en),
    topics_pl   = CASE WHEN p_payload ? 'topics_pl'
                       THEN public._event_speaker_text_array(p_payload->'topics_pl')
                       ELSE sp.topics_pl END,
    topics_en   = CASE WHEN p_payload ? 'topics_en'
                       THEN public._event_speaker_text_array(p_payload->'topics_en')
                       ELSE sp.topics_en END,
    languages   = CASE WHEN p_payload ? 'languages'
                       THEN public._event_speaker_text_array(p_payload->'languages')
                       ELSE sp.languages END,
    is_public   = COALESCE((p_payload->>'is_public')::boolean, sp.is_public),
    card_photo_url    = CASE WHEN p_payload ? 'card_photo_url'
                             THEN NULLIF(btrim(p_payload->>'card_photo_url'), '')
                             ELSE sp.card_photo_url END,
    card_cta_label_pl = CASE WHEN p_payload ? 'card_cta_label_pl'
                             THEN NULLIF(btrim(p_payload->>'card_cta_label_pl'), '')
                             ELSE sp.card_cta_label_pl END,
    card_cta_label_en = CASE WHEN p_payload ? 'card_cta_label_en'
                             THEN NULLIF(btrim(p_payload->>'card_cta_label_en'), '')
                             ELSE sp.card_cta_label_en END,
    card_cta_url      = CASE WHEN p_payload ? 'card_cta_url'
                             THEN NULLIF(btrim(p_payload->>'card_cta_url'), '')
                             ELSE sp.card_cta_url END,
    card_cta_color    = CASE WHEN p_payload ? 'card_cta_color'
                             THEN lower(NULLIF(btrim(p_payload->>'card_cta_color'), ''))
                             ELSE sp.card_cta_color END
  WHERE sp.id = v_profile_id AND sp.tenant_id = v_tenant;

  v_entry_id := public._event_speaker_roster_add(v_tenant, v_event_id, v_profile_id);

  RETURN jsonb_build_object(
    'entry_id', v_entry_id,
    'speaker_profile_id', v_profile_id,
    'person_id', v_person_id,
    'user_id', v_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speaker_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_upsert(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speaker_upsert(jsonb) IS
  'Zaklada prelegenta i podpina go do wydarzenia w JEDNYM zapisie. Tryb osoby (bez user_id): dopasowanie/zalozenie event_people po email_norm + nakladka speaker_profiles(person_id) + wpis event_speaker_entries (_event_speaker_roster_add). Tryb konta (user_id): nakladka speaker_profiles(user_id) + wpis. Pola karty (card_*) po obecnosci klucza. Zgody: wylacznie consent_data_processing_at, source=organizer. Bramka: assert_event_admin_tenant().';

-- Liczba calkowita z jsonb (liczba albo napis z cyframi); cokolwiek innego = NULL.
CREATE OR REPLACE FUNCTION public._event_cfp_jsonb_int(p_value jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_value) IN ('number', 'string')
         AND btrim(p_value #>> '{}') ~ '^-?[0-9]{1,9}$'
      THEN btrim(p_value #>> '{}')::integer
  END
$$;

REVOKE ALL ON FUNCTION public._event_cfp_jsonb_int(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_jsonb_int(jsonb) TO service_role;

COMMENT ON FUNCTION public._event_cfp_jsonb_int(jsonb) IS
  'Liczba calkowita z wartosci jsonb (liczba albo napis z cyframi), inaczej NULL.';

-- Stan ustawien naboru dla panelu: wiersz albo wartosci domyslne (bez zapisu)
-- oraz listy wyboru (sciezki, sale, grupy, bilety) - ekran ustawien i okno
-- przyjecia nie potrzebuja czterech osobnych zapytan.
CREATE OR REPLACE FUNCTION public._event_cfp_settings_payload(p_tenant uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'event_id', e.id,
    'event_slug', e.slug,
    'event_status', e.status,
    'event_timezone', e.timezone,
    'exists', s.id IS NOT NULL,
    'status', COALESCE(s.status, 'draft'),
    'phase', public._event_cfp_phase(s.status, s.opens_at, s.closes_at),
    'is_open', e.status = 'published' AND public._event_cfp_is_open(s.status, s.opens_at, s.closes_at),
    'opens_at', s.opens_at,
    'closes_at', s.closes_at,
    'intro_pl', COALESCE(s.intro_pl, ''),
    'intro_en', COALESCE(s.intro_en, ''),
    'guidelines_pl', COALESCE(s.guidelines_pl, ''),
    'guidelines_en', COALESCE(s.guidelines_en, ''),
    'formats', COALESCE(s.formats, '[]'::jsonb),
    'track_ids', to_jsonb(COALESCE(s.track_ids, '{}'::uuid[])),
    'max_per_submitter', COALESCE(s.max_per_submitter, 3),
    'allow_co_speakers', COALESCE(s.allow_co_speakers, true),
    'review_blind', COALESCE(s.review_blind, false),
    'score_max', COALESCE(s.score_max, 5),
    'review_criteria', COALESCE(s.review_criteria, '[]'::jsonb),
    'min_reviews', COALESCE(s.min_reviews, 2),
    'speaker_group_id', CASE WHEN s.id IS NULL THEN (
        SELECT g.id FROM public.event_groups g
         WHERE g.tenant_id = e.tenant_id AND g.event_id = e.id AND g.key = 'speakers'
      ) ELSE s.speaker_group_id END,
    'speaker_ticket_type_id', s.speaker_ticket_type_id,
    'updated_at', s.updated_at,
    'options', jsonb_build_object(
      'tracks', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', t.id, 'key', t.key, 'name_pl', t.name_pl, 'name_en', t.name_en,
          'is_active', t.is_active) ORDER BY t.sort_order, t.key), '[]'::jsonb)
          FROM public.event_tracks t
         WHERE t.tenant_id = e.tenant_id AND t.event_id = e.id
      ),
      'rooms', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.name, 'capacity', r.capacity,
          'is_active', r.is_active) ORDER BY r.sort_order, r.name), '[]'::jsonb)
          FROM public.event_rooms r
         WHERE r.tenant_id = e.tenant_id AND r.event_id = e.id
      ),
      'groups', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', g.id, 'key', g.key, 'name_pl', g.name_pl, 'name_en', g.name_en)
          ORDER BY g.sort_order, g.key), '[]'::jsonb)
          FROM public.event_groups g
         WHERE g.tenant_id = e.tenant_id AND g.event_id = e.id
      ),
      'tickets', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', tt.id, 'key', tt.key, 'name_pl', tt.name_pl, 'name_en', tt.name_en,
          'is_active', tt.is_active) ORDER BY tt.sort_order, tt.key), '[]'::jsonb)
          FROM public.event_ticket_types tt
         WHERE tt.tenant_id = e.tenant_id AND tt.event_id = e.id
      )
    )
  )
  FROM public.events e
  LEFT JOIN public.event_cfp_settings s ON s.tenant_id = e.tenant_id AND s.event_id = e.id
  WHERE e.tenant_id = p_tenant AND e.id = p_event_id
$$;

REVOKE ALL ON FUNCTION public._event_cfp_settings_payload(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cfp_settings_payload(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_cfp_settings_payload(uuid, uuid) IS
  'Ustawienia naboru (albo wartosci domyslne bez zapisu) z faza i listami wyboru dla panelu.';

-- ----------------------------------------------------------------------------
-- 10) PANEL: USTAWIENIA NABORU
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_settings_get(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  RETURN public._event_cfp_settings_payload(v_tenant, p_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_settings_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_settings_get(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_settings_get(uuid) IS
  'Ustawienia naboru prelegentow wydarzenia (albo wartosci domyslne) z listami wyboru. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_cfp_settings_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_row public.event_cfp_settings%ROWTYPE;
  v_status text;
  v_opens timestamptz;
  v_closes timestamptz;
  v_formats jsonb;
  v_criteria jsonb;
  v_tracks uuid[];
  v_limit integer;
  v_score_max integer;
  v_min_reviews integer;
  v_group uuid;
  v_ticket uuid;
  v_item jsonb;
  v_keys text[] := ARRAY[]::text[];
  v_key text;
  v_label_pl text;
  v_label_en text;
  v_number integer;
  v_top_score integer;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_cfp_settings (tenant_id, event_id, speaker_group_id, updated_by)
  VALUES (
    v_tenant, v_event_id,
    (SELECT g.id FROM public.event_groups g
      WHERE g.tenant_id = v_tenant AND g.event_id = v_event_id AND g.key = 'speakers'),
    auth.uid()
  )
  ON CONFLICT (tenant_id, event_id) DO NOTHING;

  SELECT s.* INTO v_row
    FROM public.event_cfp_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id
   FOR UPDATE;

  v_status := CASE WHEN p_payload ? 'status' THEN p_payload->>'status' ELSE v_row.status END;
  IF v_status IS NULL OR v_status NOT IN ('draft', 'open', 'closed') THEN
    RAISE EXCEPTION 'invalid_status: status must be draft, open or closed';
  END IF;

  BEGIN
    v_opens := CASE WHEN p_payload ? 'opens_at'
      THEN NULLIF(btrim(COALESCE(p_payload->>'opens_at', '')), '')::timestamptz ELSE v_row.opens_at END;
    v_closes := CASE WHEN p_payload ? 'closes_at'
      THEN NULLIF(btrim(COALESCE(p_payload->>'closes_at', '')), '')::timestamptz ELSE v_row.closes_at END;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_window: dates are not valid timestamps';
  END;
  IF v_opens IS NOT NULL AND v_closes IS NOT NULL AND v_closes <= v_opens THEN
    RAISE EXCEPTION 'invalid_window: closes_at must be after opens_at';
  END IF;

  IF char_length(COALESCE(p_payload->>'intro_pl', '')) > 8000
     OR char_length(COALESCE(p_payload->>'intro_en', '')) > 8000
     OR char_length(COALESCE(p_payload->>'guidelines_pl', '')) > 8000
     OR char_length(COALESCE(p_payload->>'guidelines_en', '')) > 8000 THEN
    RAISE EXCEPTION 'invalid_texts: texts are limited to 8000 characters';
  END IF;

  IF p_payload ? 'formats' THEN
    IF jsonb_typeof(p_payload->'formats') IS DISTINCT FROM 'array'
       OR jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'formats') = 'array'
                                  THEN p_payload->'formats' ELSE '[]'::jsonb END) > 20 THEN
      RAISE EXCEPTION 'invalid_formats: formats must be a list of at most 20 items';
    END IF;
    v_formats := '[]'::jsonb;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'formats') LOOP
      v_key := btrim(COALESCE(v_item->>'key', ''));
      v_label_pl := btrim(COALESCE(v_item->>'label_pl', ''));
      v_label_en := btrim(COALESCE(v_item->>'label_en', ''));
      v_number := public._event_cfp_jsonb_int(v_item->'duration_min');
      IF jsonb_typeof(v_item) <> 'object'
         OR v_key !~ '^[a-z][a-z0-9_]{1,48}$'
         OR v_key = ANY (v_keys)
         OR char_length(v_label_pl) NOT BETWEEN 1 AND 80
         OR char_length(v_label_en) NOT BETWEEN 1 AND 80
         OR v_number IS NULL OR v_number NOT BETWEEN 5 AND 480 THEN
        RAISE EXCEPTION 'invalid_formats: each format needs a unique key, both labels and 5-480 minutes';
      END IF;
      v_keys := v_keys || v_key;
      v_formats := v_formats || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'label_pl', v_label_pl, 'label_en', v_label_en, 'duration_min', v_number));
    END LOOP;
  ELSE
    v_formats := v_row.formats;
  END IF;

  IF p_payload ? 'review_criteria' THEN
    IF jsonb_typeof(p_payload->'review_criteria') IS DISTINCT FROM 'array'
       OR jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'review_criteria') = 'array'
                                  THEN p_payload->'review_criteria' ELSE '[]'::jsonb END) > 10 THEN
      RAISE EXCEPTION 'invalid_criteria: criteria must be a list of at most 10 items';
    END IF;
    v_criteria := '[]'::jsonb;
    v_keys := ARRAY[]::text[];
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'review_criteria') LOOP
      v_key := btrim(COALESCE(v_item->>'key', ''));
      v_label_pl := btrim(COALESCE(v_item->>'label_pl', ''));
      v_label_en := btrim(COALESCE(v_item->>'label_en', ''));
      v_number := public._event_cfp_jsonb_int(v_item->'weight');
      IF jsonb_typeof(v_item) <> 'object'
         OR v_key !~ '^[a-z][a-z0-9_]{1,48}$'
         OR v_key = ANY (v_keys)
         OR char_length(v_label_pl) NOT BETWEEN 1 AND 80
         OR char_length(v_label_en) NOT BETWEEN 1 AND 80
         OR v_number IS NULL OR v_number NOT BETWEEN 1 AND 10 THEN
        RAISE EXCEPTION 'invalid_criteria: each criterion needs a unique key, both labels and a weight 1-10';
      END IF;
      v_keys := v_keys || v_key;
      v_criteria := v_criteria || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'label_pl', v_label_pl, 'label_en', v_label_en, 'weight', v_number));
    END LOOP;
  ELSE
    v_criteria := v_row.review_criteria;
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
  ELSE
    v_tracks := v_row.track_ids;
  END IF;

  v_limit := CASE WHEN p_payload ? 'max_per_submitter'
    THEN public._event_cfp_jsonb_int(p_payload->'max_per_submitter') ELSE v_row.max_per_submitter END;
  IF v_limit IS NULL OR v_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_limit: max_per_submitter must be 1-20';
  END IF;

  v_score_max := CASE WHEN p_payload ? 'score_max'
    THEN public._event_cfp_jsonb_int(p_payload->'score_max') ELSE v_row.score_max END;
  IF v_score_max IS NULL OR v_score_max NOT BETWEEN 3 AND 10 THEN
    RAISE EXCEPTION 'invalid_score_max: score_max must be 3-10';
  END IF;
  SELECT max(GREATEST(
           COALESCE(r.overall, 0),
           COALESCE((SELECT max((v.value #>> '{}')::numeric)::integer
                       FROM jsonb_each(r.scores) v
                      WHERE jsonb_typeof(v.value) = 'number'), 0)))
    INTO v_top_score
    FROM public.event_cfp_reviews r
   WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id;
  IF COALESCE(v_top_score, 0) > v_score_max THEN
    RAISE EXCEPTION 'score_max_below_reviews: existing reviews use scores up to %', v_top_score;
  END IF;

  v_min_reviews := CASE WHEN p_payload ? 'min_reviews'
    THEN public._event_cfp_jsonb_int(p_payload->'min_reviews') ELSE v_row.min_reviews END;
  IF v_min_reviews IS NULL OR v_min_reviews NOT BETWEEN 0 AND 20 THEN
    RAISE EXCEPTION 'invalid_min_reviews: min_reviews must be 0-20';
  END IF;

  IF p_payload ? 'speaker_group_id' THEN
    v_group := NULLIF(p_payload->>'speaker_group_id', '')::uuid;
    IF v_group IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_groups g
       WHERE g.tenant_id = v_tenant AND g.event_id = v_event_id AND g.id = v_group
    ) THEN
      RAISE EXCEPTION 'invalid_group: the group does not belong to this event';
    END IF;
  ELSE
    v_group := v_row.speaker_group_id;
  END IF;

  IF p_payload ? 'speaker_ticket_type_id' THEN
    v_ticket := NULLIF(p_payload->>'speaker_ticket_type_id', '')::uuid;
    IF v_ticket IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_ticket_types t
       WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id AND t.id = v_ticket
    ) THEN
      RAISE EXCEPTION 'invalid_ticket: the ticket does not belong to this event';
    END IF;
  ELSE
    v_ticket := v_row.speaker_ticket_type_id;
  END IF;

  UPDATE public.event_cfp_settings s SET
    status = v_status,
    opens_at = v_opens,
    closes_at = v_closes,
    intro_pl = CASE WHEN p_payload ? 'intro_pl' THEN COALESCE(p_payload->>'intro_pl', '') ELSE s.intro_pl END,
    intro_en = CASE WHEN p_payload ? 'intro_en' THEN COALESCE(p_payload->>'intro_en', '') ELSE s.intro_en END,
    guidelines_pl = CASE WHEN p_payload ? 'guidelines_pl'
      THEN COALESCE(p_payload->>'guidelines_pl', '') ELSE s.guidelines_pl END,
    guidelines_en = CASE WHEN p_payload ? 'guidelines_en'
      THEN COALESCE(p_payload->>'guidelines_en', '') ELSE s.guidelines_en END,
    formats = v_formats,
    track_ids = v_tracks,
    max_per_submitter = v_limit,
    allow_co_speakers = CASE WHEN jsonb_typeof(p_payload->'allow_co_speakers') = 'boolean'
      THEN (p_payload->>'allow_co_speakers')::boolean ELSE s.allow_co_speakers END,
    review_blind = CASE WHEN jsonb_typeof(p_payload->'review_blind') = 'boolean'
      THEN (p_payload->>'review_blind')::boolean ELSE s.review_blind END,
    score_max = v_score_max,
    review_criteria = v_criteria,
    min_reviews = v_min_reviews,
    speaker_group_id = v_group,
    speaker_ticket_type_id = v_ticket,
    updated_by = auth.uid()
  WHERE s.tenant_id = v_tenant AND s.id = v_row.id;

  RETURN public._event_cfp_settings_payload(v_tenant, v_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_settings_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_settings_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_settings_save(jsonb) IS
  'Zapis ustawien naboru prelegentow (PATCH po obecnosci klucza). Waliduje okno, formaty, kryteria, sciezki, limity, grupe i bilet. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 11) PANEL: PYTANIA FORMULARZA ZGLOSZENIA
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_cfp_fields_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  key text,
  field_type text,
  label_pl text,
  label_en text,
  help_pl text,
  help_en text,
  is_required boolean,
  options jsonb,
  sort_order integer,
  is_active boolean,
  answers_count integer
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
  SELECT f.id, f.key, f.field_type, f.label_pl, f.label_en, f.help_pl, f.help_en,
         f.is_required, f.options, f.sort_order, f.is_active,
         (SELECT count(*)::integer FROM public.event_cfp_submissions s
           WHERE s.tenant_id = f.tenant_id AND s.event_id = f.event_id AND s.answers ? f.key)
    FROM public.event_cfp_fields f
   WHERE f.tenant_id = v_tenant AND f.event_id = p_event_id
   ORDER BY f.sort_order, f.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_cfp_fields_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_cfp_fields_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_cfp_fields_list(uuid) IS
  'Pytania formularza zgloszenia z liczba zgloszen, ktore na nie odpowiedzialy. Bramka: assert_event_admin_tenant().';
