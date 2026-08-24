COMMENT ON TABLE public.event_group_members IS
  'Czlonkostwo osob w grupach DODATKOWYCH wydarzenia. Grupa podstawowa jedzie na zapisie. Uprawnienie wypadkowe = suma zdolnosci wszystkich grup.';

CREATE INDEX IF NOT EXISTS event_group_members_group_idx
  ON public.event_group_members (tenant_id, group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_group_members_person_idx
  ON public.event_group_members (tenant_id, person_id);

GRANT SELECT ON public.event_group_members TO authenticated;

GRANT ALL ON public.event_group_members TO service_role;

ALTER TABLE public.event_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_group_members_staff_read" ON public.event_group_members;

CREATE POLICY "event_group_members_staff_read"
  ON public.event_group_members FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  label_pl text NOT NULL,
  label_en text NOT NULL,
  body_pl text NOT NULL DEFAULT '',
  body_en text NOT NULL DEFAULT '',
  external_url text,
  display text NOT NULL DEFAULT 'registration',
  is_required boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_terms_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_terms_label_pl_len CHECK (char_length(btrim(label_pl)) BETWEEN 2 AND 300),
  CONSTRAINT event_terms_label_en_len CHECK (char_length(btrim(label_en)) BETWEEN 2 AND 300),
  CONSTRAINT event_terms_body_pl_len CHECK (char_length(body_pl) <= 40000),
  CONSTRAINT event_terms_body_en_len CHECK (char_length(body_en) <= 40000),
  CONSTRAINT event_terms_external_url_https
    CHECK (external_url IS NULL OR external_url ~ '^https://'),
  CONSTRAINT event_terms_display_values
    CHECK (display IN ('registration', 'access', 'registration_and_access')),
  CONSTRAINT event_terms_version_positive CHECK (version > 0),
  CONSTRAINT event_terms_has_content CHECK (
    char_length(btrim(body_pl)) > 0
    OR char_length(btrim(body_en)) > 0
    OR external_url IS NOT NULL
  ),
  CONSTRAINT event_terms_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_terms_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_terms_event_tenant_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_terms IS
  'Zgody i regulaminy per wydarzenie, z wersja. Podniesienie wersji uniewaznia akceptacje jako AKTUALNA, nie kasuje jej jako dowodu.';

COMMENT ON COLUMN public.event_terms.display IS
  'Gdzie zgoda jest pokazywana: registration (przy zapisie) | access (przy wejsciu na tresc) | registration_and_access (w obu miejscach).';

COMMENT ON COLUMN public.event_terms.version IS
  'Wersja tresci. Zgoda na wersje N nie jest zgoda na wersje N+1 - formularz poprosi ponownie.';

CREATE INDEX IF NOT EXISTS event_terms_event_order_idx
  ON public.event_terms (tenant_id, event_id, sort_order, key);

GRANT SELECT ON public.event_terms TO authenticated;

GRANT ALL ON public.event_terms TO service_role;

ALTER TABLE public.event_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_terms_staff_read" ON public.event_terms;

CREATE POLICY "event_terms_staff_read"
  ON public.event_terms FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_terms_touch_updated_at ON public.event_terms;

CREATE TRIGGER event_terms_touch_updated_at
  BEFORE UPDATE ON public.event_terms
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.event_term_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  term_id uuid NOT NULL,
  person_id uuid NOT NULL,
  registration_id uuid,
  version integer NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  ip_hash text,
  user_agent text,
  CONSTRAINT event_term_acceptances_version_positive CHECK (version > 0),
  CONSTRAINT event_term_acceptances_ip_hash_shape
    CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{16,128}$'),
  CONSTRAINT event_term_acceptances_user_agent_len
    CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  CONSTRAINT event_term_acceptances_withdrawn_after
    CHECK (withdrawn_at IS NULL OR withdrawn_at >= accepted_at),
  CONSTRAINT event_term_acceptances_unique UNIQUE (tenant_id, term_id, person_id, version),
  CONSTRAINT event_term_acceptances_term_fkey
    FOREIGN KEY (tenant_id, term_id)
    REFERENCES public.event_terms (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_term_acceptances_person_fkey
    FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_term_acceptances_registration_fkey
    FOREIGN KEY (tenant_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_term_acceptances IS
  'Rejestr akceptacji zgod wydarzenia: kto, kiedy, ktora wersje, z jakiego adresu (HASZ, nie adres). Klucz naturalny: (zgoda, osoba, wersja).';

COMMENT ON COLUMN public.event_term_acceptances.ip_hash IS
  'Hasz adresu klienta liczony przez warstwe serwerowa i podany w wywolaniu (Postgres za PostgREST adresu nie widzi). NULL = nie zapisano.';

CREATE INDEX IF NOT EXISTS event_term_acceptances_term_idx
  ON public.event_term_acceptances (tenant_id, term_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS event_term_acceptances_person_idx
  ON public.event_term_acceptances (tenant_id, person_id);

CREATE INDEX IF NOT EXISTS event_term_acceptances_registration_idx
  ON public.event_term_acceptances (tenant_id, registration_id)
  WHERE registration_id IS NOT NULL;

GRANT SELECT ON public.event_term_acceptances TO authenticated;

GRANT ALL ON public.event_term_acceptances TO service_role;

ALTER TABLE public.event_term_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_term_acceptances_staff_read" ON public.event_term_acceptances;

CREATE POLICY "event_term_acceptances_staff_read"
  ON public.event_term_acceptances FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "event_term_acceptances_self_read" ON public.event_term_acceptances;

CREATE POLICY "event_term_acceptances_self_read"
  ON public.event_term_acceptances FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.event_people p
      WHERE p.id = event_term_acceptances.person_id
        AND p.tenant_id = event_term_acceptances.tenant_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.tg_event_registrations_sync_ticket_sold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id;
  ELSE
    v_tenant := NEW.tenant_id;
  END IF;

  IF TG_OP <> 'INSERT' AND OLD.ticket_type_id IS NOT NULL THEN
    v_ids := array_append(v_ids, OLD.ticket_type_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.ticket_type_id IS NOT NULL THEN
    v_ids := array_append(v_ids, NEW.ticket_type_id);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    UPDATE public.event_ticket_types t
    SET sold_count = c.cnt
    FROM (
      SELECT count(*)::integer AS cnt
      FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant
        AND r.ticket_type_id = v_id
        AND r.status IN ('approved', 'attended', 'no_show')
    ) c
    WHERE t.id = v_id
      AND t.tenant_id = v_tenant
      AND t.sold_count <> c.cnt;
  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_event_registrations_sync_ticket_sold() IS
  'Przelicza event_ticket_types.sold_count po kazdej zmianie zapisu. Miejsce zajmuja statusy approved / attended / no_show.';

DROP TRIGGER IF EXISTS event_registrations_sync_ticket_sold ON public.event_registrations;

CREATE TRIGGER event_registrations_sync_ticket_sold
  AFTER INSERT OR DELETE OR UPDATE OF status, ticket_type_id, tenant_id
  ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_registrations_sync_ticket_sold();

DROP FUNCTION IF EXISTS public._event_seed_default_groups(_tenant uuid, _event_id uuid);

CREATE OR REPLACE FUNCTION public._event_seed_default_groups(_tenant uuid, _event_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_default boolean;
  v_inserted integer;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_groups g
    WHERE g.tenant_id = _tenant AND g.event_id = _event_id AND g.is_default
  ) INTO v_has_default;

  INSERT INTO public.event_groups (
    tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    color, attendee_visibility, can_see_attendees, can_meet, can_chat,
    can_lead_retrieval, can_see_recording, sort_order, is_default, is_system
  )
  SELECT
    _tenant, _event_id, d.key, d.name_pl, d.name_en, d.description_pl, d.description_en,
    d.color, d.attendee_visibility, d.can_see_attendees, d.can_meet, d.can_chat,
    d.can_lead_retrieval, d.can_see_recording, d.sort_order,
    d.is_default AND NOT v_has_default, true
  FROM (VALUES
    ('attendees', 'Uczestnicy', 'Attendees',
     'Podstawowa grupa zapisanych. Widzi liste zapisanych i rozmawia na czacie.',
     'Default group of registered people. Sees the attendee list and uses the chat.',
     '#2563eb', 'registered', true, true, true, false, true, 10, true),
    ('speakers', 'Prelegenci', 'Speakers',
     'Osoby na scenie. Widza pelna liste zapisanych, takze przed wydarzeniem.',
     'People on stage. They see the full attendee list, also before the event.',
     '#7c3aed', 'registered', true, true, true, false, true, 20, false),
    ('partners', 'Partnerzy', 'Partners',
     'Przedstawiciele firm partnerskich. Moga skanowac leady na stoisku.',
     'Representatives of partner companies. They may scan leads at the booth.',
     '#0d9488', 'own_group', true, true, true, true, false, 30, false),
    ('organisers', 'Organizatorzy', 'Organisers',
     'Obsada wydarzenia. Widzi wszystko i moze wszystko w obrebie wydarzenia.',
     'Event crew. Sees everything and may do everything within the event.',
     '#b45309', 'everyone', true, true, true, true, true, 40, false)
  ) AS d(
    key, name_pl, name_en, description_pl, description_en, color,
    attendee_visibility, can_see_attendees, can_meet, can_chat,
    can_lead_retrieval, can_see_recording, sort_order, is_default
  )
  ON CONFLICT (tenant_id, event_id, key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public._event_seed_default_groups(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._event_seed_default_groups(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_seed_default_groups(uuid, uuid) IS
  'Zaklada cztery grupy startowe wydarzenia (uczestnicy, prelegenci, partnerzy, organizatorzy). Idempotentna. Wolana triggerem przy tworzeniu wydarzenia i w backfillu.';

CREATE OR REPLACE FUNCTION public.tg_events_seed_registration_groups()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._event_seed_default_groups(NEW.tenant_id, NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'event groups seed skipped (event=%): % [%]', NEW.id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS events_seed_registration_groups ON public.events;

CREATE TRIGGER events_seed_registration_groups
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_events_seed_registration_groups();

DO $$
DECLARE
  v_event record;
BEGIN
  FOR v_event IN SELECT e.tenant_id, e.id FROM public.events e LOOP
    PERFORM public._event_seed_default_groups(v_event.tenant_id, v_event.id);
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS public._event_answer_matches(_operator text, _expected jsonb, _answer jsonb);

CREATE OR REPLACE FUNCTION public._event_answer_matches(
  _operator text,
  _expected jsonb,
  _answer jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_answer_kind text;
  v_answer_text text;
  v_expected_text text;
  v_hit boolean;
  v_bool boolean;
BEGIN
  IF _operator IS NULL OR _operator = 'none' THEN
    RETURN false;
  END IF;

  v_answer_kind := COALESCE(jsonb_typeof(_answer), 'null');

  v_answer_text := CASE
    WHEN v_answer_kind = 'string' THEN NULLIF(btrim(_answer #>> '{}'), '')
    WHEN v_answer_kind IN ('number', 'boolean') THEN _answer #>> '{}'
    ELSE NULL
  END;

  v_expected_text := CASE
    WHEN _expected IS NULL OR jsonb_typeof(_expected) = 'null' THEN NULL
    WHEN jsonb_typeof(_expected) = 'string' THEN NULLIF(btrim(_expected #>> '{}'), '')
    WHEN jsonb_typeof(_expected) IN ('number', 'boolean') THEN _expected #>> '{}'
    ELSE NULL
  END;

  IF _operator = 'not_empty' THEN
    RETURN CASE
      WHEN v_answer_kind = 'array' THEN jsonb_array_length(_answer) > 0
      WHEN v_answer_kind = 'object' THEN _answer <> '{}'::jsonb
      ELSE v_answer_text IS NOT NULL
    END;
  END IF;

  IF _operator IN ('is_true', 'is_false') THEN
    v_bool := CASE
      WHEN v_answer_kind = 'boolean' THEN (_answer = 'true'::jsonb)
      WHEN lower(COALESCE(v_answer_text, '')) IN ('true', '1', 'yes', 'tak') THEN true
      WHEN lower(COALESCE(v_answer_text, '')) IN ('false', '0', 'no', 'nie') THEN false
      ELSE NULL
    END;
    IF v_bool IS NULL THEN
      RETURN false;
    END IF;
    RETURN CASE WHEN _operator = 'is_true' THEN v_bool ELSE NOT v_bool END;
  END IF;

  IF _operator IN ('in', 'not_in') THEN
    IF jsonb_typeof(_expected) <> 'array' THEN
      RETURN false;
    END IF;
    IF v_answer_kind = 'array' THEN
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(_answer) a
        JOIN jsonb_array_elements_text(_expected) x
          ON lower(btrim(a.value)) = lower(btrim(x.value))
      ) INTO v_hit;
    ELSIF v_answer_text IS NULL THEN
      RETURN false;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(_expected) x
        WHERE lower(btrim(x.value)) = lower(v_answer_text)
      ) INTO v_hit;
    END IF;
    RETURN CASE WHEN _operator = 'in' THEN v_hit ELSE NOT v_hit END;
  END IF;

  IF _operator IN ('equals', 'not_equals') THEN
    IF v_answer_text IS NULL OR v_expected_text IS NULL THEN
      RETURN false;
    END IF;
    v_hit := lower(v_answer_text) = lower(v_expected_text);
    RETURN CASE WHEN _operator = 'equals' THEN v_hit ELSE NOT v_hit END;
  END IF;

  IF _operator IN ('gte', 'lte') THEN
    IF v_answer_text IS NULL OR v_answer_text !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN false;
    END IF;
    IF v_expected_text IS NULL OR v_expected_text !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN false;
    END IF;
    RETURN CASE
      WHEN _operator = 'gte' THEN v_answer_text::numeric >= v_expected_text::numeric
      ELSE v_answer_text::numeric <= v_expected_text::numeric
    END;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._event_answer_matches(text, jsonb, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public._event_answer_matches(text, jsonb, jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public._event_answer_matches(text, jsonb, jsonb) IS
  'Predykat reguly kwalifikujacej: czy odpowiedz trafia w warunek. Funkcja czysta - brak odpowiedzi nie trafia w zaden operator poza not_empty.';

DROP FUNCTION IF EXISTS public._event_registration_verdict(_tenant uuid, _event_id uuid, _answers jsonb);

CREATE OR REPLACE FUNCTION public._event_registration_verdict(
  _tenant uuid,
  _event_id uuid,
  _answers jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_field record;
  v_verdict text := 'none';
BEGIN
  FOR v_field IN
    SELECT f.key, f.qualify_operator, f.qualify_value, f.qualify_outcome
    FROM public.event_registration_fields f
    WHERE f.tenant_id = _tenant
      AND f.event_id = _event_id
      AND f.is_active
      AND f.is_qualifying
      AND f.qualify_operator <> 'none'
    ORDER BY f.sort_order, f.key
  LOOP
    CONTINUE WHEN NOT public._event_answer_matches(
      v_field.qualify_operator,
      v_field.qualify_value,
      COALESCE(_answers, '{}'::jsonb) -> v_field.key
    );

    IF v_field.qualify_outcome = 'reject' THEN
      RETURN 'reject';
    ELSIF v_field.qualify_outcome = 'approval' THEN
      v_verdict := 'approval';
    ELSIF v_verdict <> 'approval' THEN
      v_verdict := 'auto_approve';
    END IF;
  END LOOP;

  RETURN v_verdict;
END;
$$;

REVOKE ALL ON FUNCTION public._event_registration_verdict(uuid, uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public._event_registration_verdict(uuid, uuid, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public._event_registration_verdict(uuid, uuid, jsonb) IS
  'Werdykt regul kwalifikujacych wydarzenia dla zestawu odpowiedzi: reject | approval | auto_approve | none. Pierwszenstwo: reject > approval > auto_approve.';

DROP FUNCTION IF EXISTS public._event_seats_left(_tenant uuid, _event_id uuid, _ticket_type_id uuid);

CREATE OR REPLACE FUNCTION public._event_seats_left(
  _tenant uuid,
  _event_id uuid,
  _ticket_type_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity integer;
  v_used integer;
  v_quota integer;
  v_sold integer;
  v_left integer;
  v_ticket_left integer;
BEGIN
  SELECT e.capacity INTO v_capacity
  FROM public.events e
  WHERE e.id = _event_id AND e.tenant_id = _tenant;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF v_capacity IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used
    FROM public.event_registrations r
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.status IN ('approved', 'attended', 'no_show');
    v_left := GREATEST(v_capacity - v_used, 0);
  END IF;

  IF _ticket_type_id IS NOT NULL THEN
    SELECT t.quota, t.sold_count INTO v_quota, v_sold
    FROM public.event_ticket_types t
    WHERE t.id = _ticket_type_id
      AND t.tenant_id = _tenant
      AND t.event_id = _event_id;

    IF NOT FOUND THEN
      RETURN 0;
    END IF;

    IF v_quota IS NOT NULL THEN
      v_ticket_left := GREATEST(v_quota - v_sold, 0);
      v_left := CASE
        WHEN v_left IS NULL THEN v_ticket_left
        ELSE LEAST(v_left, v_ticket_left)
      END;
    END IF;
  END IF;

  RETURN v_left;
END;
$$;

REVOKE ALL ON FUNCTION public._event_seats_left(uuid, uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public._event_seats_left(uuid, uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public._event_seats_left(uuid, uuid, uuid) IS
  'Wolne miejsca wydarzenia (i biletu, gdy podany). NULL = bez limitu. Liczy, nie rezerwuje - wolajacy musi trzymac FOR UPDATE na wierszu biletu albo wydarzenia.';

DROP FUNCTION IF EXISTS public._event_new_qr_token();

CREATE OR REPLACE FUNCTION public._event_new_qr_token()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT replace(replace(rtrim(encode(gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_');
$$;

REVOKE ALL ON FUNCTION public._event_new_qr_token() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._event_new_qr_token() TO service_role;

COMMENT ON FUNCTION public._event_new_qr_token() IS
  'Losowy token wejsciowy (24 bajty, base64url). Do tabeli idzie wylacznie sha256 tej wartosci.';

DROP FUNCTION IF EXISTS public._event_waitlist_promote(_tenant uuid, _event_id uuid, _ticket_type_id uuid, _limit integer);

CREATE OR REPLACE FUNCTION public._event_waitlist_promote(
  _tenant uuid,
  _event_id uuid,
  _ticket_type_id uuid DEFAULT NULL,
  _limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 1), 1), 500);
  v_row record;
  v_left integer;
  v_token text;
  v_promoted jsonb := '[]'::jsonb;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  IF _ticket_type_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = _ticket_type_id AND t.tenant_id = _tenant AND t.event_id = _event_id
    FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.events e
    WHERE e.id = _event_id AND e.tenant_id = _tenant
    FOR UPDATE;
  END IF;

  FOR v_row IN
    SELECT r.id, r.person_id, r.ticket_type_id, p.email, p.first_name, p.last_name, p.user_id
    FROM public.event_registrations r
    JOIN public.event_people p
      ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.status = 'waitlist'
      AND (_ticket_type_id IS NULL OR r.ticket_type_id = _ticket_type_id)
    ORDER BY r.waitlist_position NULLS LAST, r.created_at, r.id
    LIMIT v_limit
  LOOP
    v_left := public._event_seats_left(_tenant, _event_id, v_row.ticket_type_id);
    EXIT WHEN v_left IS NOT NULL AND v_left <= 0;

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        promoted_at = now(),
        decided_at = now(),
        decided_by = NULL,
        decision_source = 'system',
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now()
    WHERE r.id = v_row.id AND r.tenant_id = _tenant AND r.status = 'waitlist';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_promoted := v_promoted || jsonb_build_object(
      'registration_id', v_row.id,
      'person_id', v_row.person_id,
      'email', v_row.email,
      'first_name', v_row.first_name,
      'last_name', v_row.last_name,
      'user_id', v_row.user_id,
      'ticket_type_id', v_row.ticket_type_id
    );

    PERFORM public.emit_domain_event(
      _tenant,
      'event_registration',
      v_row.id::text,
      'event.registration.promoted.v1',
      jsonb_build_object('event_id', _event_id, 'person_id', v_row.person_id),
      auth.uid()
    );
  END LOOP;

  RETURN jsonb_build_object(
    'promoted', jsonb_array_length(v_promoted),
    'registrations', v_promoted
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer) TO service_role;

COMMENT ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer) IS
  'Promuje osoby z listy rezerwowej na zwolnione miejsca (blokada wiersza biletu albo wydarzenia najpierw, liczenie potem). Zwraca promowane wiersze - wysylka wiadomosci nalezy do warstwy znajacej jezyk odbiorcy.';

DROP FUNCTION IF EXISTS public._event_next_waitlist_position(_tenant uuid, _event_id uuid);

CREATE OR REPLACE FUNCTION public._event_next_waitlist_position(_tenant uuid, _event_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(max(r.waitlist_position), 0) + 1
  FROM public.event_registrations r
  WHERE r.tenant_id = _tenant
    AND r.event_id = _event_id
    AND r.status = 'waitlist';
$$;

REVOKE ALL ON FUNCTION public._event_next_waitlist_position(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._event_next_waitlist_position(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_next_waitlist_position(uuid, uuid) IS
  'Nastepna wolna pozycja w kolejce rezerwowej wydarzenia. Wolana pod blokada wiersza biletu albo wydarzenia.';