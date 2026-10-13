-- events-harness: include
-- ============================================================================
-- WYDARZENIA: SPOTKANIE PRZYPINA SIE DO SPONSORA TYLKO PRZEZ STRONE
-- POWIAZANA ZE SPONSOREM (OPS-10).
--
-- PROBLEM. `event_meeting_invite` zapisywal `sponsor_id` WPROST z ladunku
-- (`NULLIF(p_payload->>'sponsor_id','')::uuid`); sprawdzany byl tylko klucz
-- obcy do sponsorow TEGO wydarzenia. Raport sponsora liczy `meetings_total`
-- i `meetings_accepted` po `event_meetings.sponsor_id`, wiec dwa konta
-- uczestnikow (zadne niezwiazane ze sponsorem) mogly dowolnie nabijac albo
-- podrabiac liczbe spotkan, ktora organizator pokazuje sponsorowi.
--
-- ZMIANA:
--   * `_event_meeting_sponsor_allowed(najemca, wydarzenie, sponsor,
--     zapraszajacy, zaproszony)` - JEDNO miejsce, ktore rozstrzyga, czy
--     spotkanie wolno przypiac do sponsora. Wolno, gdy KTORAKOLWIEK strona
--     jest ze sponsorem powiazana:
--       - firma osoby (`event_people.company_id`) jest firma przypiecia
--         sponsora (`event_sponsors.company_id`) - ta sama regula, ktora
--         dopuszcza osobe do miejsca zarezerwowanego dla sponsora
--         (`_event_seat_assign_problem`, 20260927000400);
--       - osoba jest osoba kontaktowa sponsora na TYM wydarzeniu
--         (`event_sponsor_contacts.lead_id` = kontakt CRM osoby z mostu
--         `event_person_crm_links`).
--     Przypiecie sesji lub sciezki agendy do sponsora (20260923120000) NIE
--     jest powiazaniem osoby: prelegent sesji sponsorowanej nie musi
--     reprezentowac sponsora, a przypisanie spotkania z nim sponsorowi
--     zawyzaloby raport. Regula jest celowo waska - pomylka w strone "nie
--     wolno" kosztuje tylko przypisanie, nie samo spotkanie.
--   * `event_meeting_invite` - cialo z 20260825065054 bez zmian poza
--     przypieciem: sponsor z ladunku zostaje zapisany WYLACZNIE, gdy helper
--     go dopuszcza; inaczej spotkanie powstaje BEZ sponsora (NULL), a
--     odpowiedz niesie faktycznie zapisane `sponsor_id`.
--
-- NULL, NIE ODMOWA - UZASADNIENIE. Spotkanie dwojga uczestnikow jest
-- prawomocne samo w sobie; przypisanie do sponsora to metadana raportu,
-- ktorej uczestnik w interfejsie nie ustawia (zaden ekran gieldy nie wysyla
-- dzis `sponsor_id`). Odmowa blokowalaby prawdziwe spotkanie z powodu pola,
-- ktorego czlowiek nie widzi; NULL zamyka naduzycie (raport nie rosnie),
-- a pole `sponsor_id` w odpowiedzi pozwala wolajacemu i testom zobaczyc, ze
-- przypiecie zostalo odrzucone.
--
-- CZEGO NIE ZMIENIA:
--   * `admin_event_meeting_arrange` - organizator jest zaufany i moze
--     przypiac dowolnego sponsora tego wydarzenia;
--   * `event_meeting_reschedule` - kopiuje `sponsor_id` ze spotkania
--     przekladanego (wartosc ustalona przy tworzeniu: przez ten helper albo
--     przez organizatora), nie z ladunku; ponowne sprawdzenie odbieraloby
--     przypiecie spotkaniom umowionym przez organizatora;
--   * `event_meeting_respond` / `event_meeting_cancel` - nie pisza
--     `sponsor_id`; `authenticated` nie ma zadnego grantu zapisu na
--     `event_meetings`, wiec innej drogi uczestnika nie ma;
--   * `tg_event_meetings_validate` - wyzwalacz nie odroznia zapisu
--     organizatora od zapisu uczestnika (tabela nie ma znacznika zrodla),
--     wiec regula w nim zdejmowalaby przypiecia organizatora;
--   * DANYCH HISTORYCZNYCH: istniejacych przypiec nie zmieniamy (raport juz
--     pokazany sponsorowi nie zmienia sie po cichu). Odczyt kontrolny dla
--     operatora - spotkania uczestnikow przypiete do sponsora bez powiazania:
--       SELECT m.id, m.event_id, m.sponsor_id FROM public.event_meetings m
--        WHERE m.sponsor_id IS NOT NULL
--          AND NOT public._event_meeting_sponsor_allowed(m.tenant_id,
--                m.event_id, m.sponsor_id, m.requester_registration_id,
--                m.invitee_registration_id);
--
-- IDEMPOTENTNA: CREATE OR REPLACE (sygnatury i ACL bez zmian).
-- Testy: scripts/events-harness/runtime_test.d/61_meeting_sponsor_binding.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._event_meeting_sponsor_allowed(
  p_tenant uuid,
  p_event_id uuid,
  p_sponsor_id uuid,
  p_requester_registration_id uuid,
  p_invitee_registration_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.event_sponsors s
      JOIN public.event_registrations r
        ON r.tenant_id = s.tenant_id
       AND r.event_id = s.event_id
       AND r.id IN (p_requester_registration_id, p_invitee_registration_id)
      JOIN public.event_people p
        ON p.tenant_id = r.tenant_id AND p.id = r.person_id
     WHERE s.tenant_id = p_tenant
       AND s.event_id = p_event_id
       AND s.id = p_sponsor_id
       AND (
         p.company_id = s.company_id
         OR EXISTS (
           SELECT 1
             FROM public.event_sponsor_contacts k
             JOIN public.event_person_crm_links l
               ON l.tenant_id = k.tenant_id AND l.crm_lead_id = k.lead_id
            WHERE k.tenant_id = s.tenant_id
              AND k.event_id = s.event_id
              AND k.sponsor_id = s.id
              AND l.person_id = p.id
         )
       )
  );
$function$;

REVOKE ALL ON FUNCTION public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid) IS
  'Czy spotkanie dwoch zgloszen wolno przypiac do sponsora TEGO wydarzenia: ktorakolwiek strona pracuje w firmie sponsora (event_people.company_id = event_sponsors.company_id) albo jest jego osoba kontaktowa (event_sponsor_contacts przez event_person_crm_links). Wolaja sciezki uczestnika gieldy; organizator (admin_event_meeting_arrange) jest zaufany. Pomocnik wewnetrzny.';

CREATE OR REPLACE FUNCTION public.event_meeting_invite(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_other uuid := NULLIF(p_payload->>'counterpart_registration_id', '')::uuid;
  v_starts timestamptz := (NULLIF(p_payload->>'starts_at', ''))::timestamptz;
  v_settings public.event_meeting_settings;
  v_me uuid;
  v_reason text;
  v_ends timestamptz;
  v_used integer;
  v_day date;
  v_taken integer;
  v_expires timestamptz;
  v_id uuid;
  v_rate record;
  v_sponsor uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_other IS NULL OR v_starts IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: counterpart_registration_id and starts_at are required';
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND ((v_event_id IS NOT NULL AND e.id = v_event_id) OR (v_slug IS NOT NULL AND e.slug = v_slug));

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_event_id);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_registered: only a participant of this event can send invitations';
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;

  IF v_settings.id IS NULL OR NOT v_settings.is_enabled THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  IF (v_settings.invites_open_at IS NOT NULL AND v_settings.invites_open_at > now())
     OR (v_settings.invites_close_at IS NOT NULL AND v_settings.invites_close_at <= now()) THEN
    RAISE EXCEPTION 'exchange_closed: the meeting exchange is not open for invitations right now';
  END IF;

  SELECT * INTO v_rate
  FROM public.rate_limit_hit('event_meeting_invite', v_tenant::text || ':' || v_uid::text, 30, 10);
  IF NOT v_rate.allowed THEN
    RAISE EXCEPTION 'rate_limited: too many invitations sent, try again in a few minutes';
  END IF;

  v_reason := public._event_meeting_can_invite(v_tenant, v_event_id, v_me, v_other);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%: meeting between these two is not allowed', v_reason;
  END IF;

  IF v_settings.max_invites_per_person IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used
    FROM public.event_meetings m
    WHERE m.tenant_id = v_tenant
      AND m.event_id = v_event_id
      AND m.requester_registration_id = v_me
      AND m.status IN ('invited', 'accepted');

    IF v_used >= v_settings.max_invites_per_person THEN
      RAISE EXCEPTION 'invite_limit_reached: you already have % active invitation(s)', v_used;
    END IF;
  END IF;

  v_ends := v_starts + make_interval(mins => v_settings.slot_minutes);
  v_day := (v_starts AT TIME ZONE v_settings.timezone)::date;

  IF v_settings.max_meetings_per_day IS NOT NULL THEN
    SELECT max(x.taken)::integer INTO v_taken
    FROM (
      SELECT count(*)::integer AS taken
      FROM public.event_meeting_attendees a
      WHERE a.tenant_id = v_tenant
        AND a.event_id = v_event_id
        AND a.registration_id IN (v_me, v_other)
        AND a.status IN ('accepted', 'held', 'no_show')
        AND (a.starts_at AT TIME ZONE v_settings.timezone)::date = v_day
      GROUP BY a.registration_id
    ) x;

    IF COALESCE(v_taken, 0) >= v_settings.max_meetings_per_day THEN
      RAISE EXCEPTION 'daily_limit_reached: one of you already has % meeting(s) that day', v_taken;
    END IF;
  END IF;

  v_expires := LEAST(
    now() + make_interval(hours => v_settings.invite_expires_after_hours),
    v_starts
  );

  -- OPS-10: sponsor z ladunku tylko wtedy, gdy ktoras strona jest z nim
  -- powiazana; inaczej spotkanie powstaje bez przypiecia (uzasadnienie
  -- w naglowku migracji 20261013111500).
  v_sponsor := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  IF v_sponsor IS NOT NULL
     AND NOT public._event_meeting_sponsor_allowed(v_tenant, v_event_id, v_sponsor, v_me, v_other) THEN
    v_sponsor := NULL;
  END IF;

  INSERT INTO public.event_meetings (
    tenant_id, event_id, requester_registration_id, invitee_registration_id,
    starts_at, ends_at, status, topic, sponsor_id, invitation_message,
    expires_at, invited_by
  ) VALUES (
    v_tenant, v_event_id, v_me, v_other,
    v_starts, v_ends, 'invited',
    NULLIF(btrim(COALESCE(p_payload->>'topic', '')), ''),
    v_sponsor,
    NULLIF(btrim(COALESCE(p_payload->>'message', '')), ''),
    v_expires, v_uid
  )
  RETURNING id INTO v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_id::text,
    'event_meeting.invited.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'meeting_id', v_id,
      'requester_registration_id', v_me,
      'invitee_registration_id', v_other,
      'starts_at', v_starts,
      'expires_at', v_expires
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'meeting_id', v_id,
    'status', 'invited',
    'starts_at', v_starts,
    'ends_at', v_ends,
    'expires_at', v_expires,
    'sponsor_id', v_sponsor
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_invitation: you already have an active invitation with this person in this slot';
  WHEN exclusion_violation THEN
    DECLARE
      v_constraint text;
    BEGIN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'event_meetings_table_no_overlap' THEN
        RAISE EXCEPTION 'table_busy: the seat at this table is already taken in this slot';
      END IF;
      RAISE EXCEPTION 'participant_busy: one of you already has a meeting in this slot';
    END;
END;
$function$;

REVOKE ALL ON FUNCTION public.event_meeting_invite(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_invite(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_invite(jsonb) IS
  'Uczestnik wysyla zaproszenie na spotkanie. Siedem warunkow, kazdy z wlasnym kluczem bledu; stolik NIE jest przydzielany przy zaproszeniu. Sponsor z ladunku jest zapisywany tylko, gdy ktoras strona jest z nim powiazana (_event_meeting_sponsor_allowed) - inaczej NULL; odpowiedz niesie zapisane sponsor_id. Plaszczyzna tresci (public_tenant_id).';
