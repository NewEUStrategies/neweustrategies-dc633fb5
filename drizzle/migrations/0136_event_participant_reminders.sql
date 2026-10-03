-- Przypomnienia uczestnika F2: skaner naleznych przypomnien, run_event_reminders na rodzaju event, partia e-mail/SMS zadania F2, confirm_many i digest bez rodzaju event (blizniak 20261003140000).
-- ----------------------------------------------------------------------------
-- 1) Indeksy pod skan po czasie startu (miedzy najemcami, co minute)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS events_published_starts_idx
  ON public.events (starts_at)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS event_sessions_published_starts_idx
  ON public.event_sessions (starts_at)
  WHERE status = 'published';

-- ----------------------------------------------------------------------------
-- 2) Nalezne przypomnienia (jedno zrodlo prawdy)
-- LOCKS: none (read only).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_reminder_candidates(
  p_now timestamptz,
  p_channels text[],
  p_limit integer
)
RETURNS TABLE (
  kind text,
  channel text,
  dedupe_key text,
  tenant_id uuid,
  event_id uuid,
  registration_id uuid,
  person_id uuid,
  user_id uuid,
  session_id uuid,
  rsvp_id uuid,
  lead_minutes integer,
  starts_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ev AS (
    SELECT e.tenant_id,
           e.id AS event_id,
           e.starts_at,
           public._event_local_quiet(e.timezone, p_now) AS quiet,
           s.reminder_event_leads_minutes AS leads,
           s.reminder_sms_enabled AS sms_enabled
      FROM public.events e
     CROSS JOIN LATERAL public._event_participant_settings_effective(e.tenant_id, e.id) s
     WHERE e.status = 'published'
       AND e.cancelled_at IS NULL
       AND e.starts_at > p_now
       -- 10080 min = gorna granica CHECK event_participant_settings_leads_shape.
       AND e.starts_at <= p_now + interval '10080 minutes'
       AND s.reminders_enabled
  ),
  ev_due AS (
    SELECT ev.tenant_id, ev.event_id, ev.starts_at, ev.quiet, ev.sms_enabled,
           d.lead,
           ev.starts_at - make_interval(mins => d.lead) AS due_at
      FROM ev
     CROSS JOIN LATERAL (
       SELECT min(x) AS lead
         FROM unnest(ev.leads) AS x
        WHERE ev.starts_at - make_interval(mins => x) <= p_now
     ) d
     WHERE d.lead IS NOT NULL
  ),
  reg AS (
    SELECT 'event_reminder'::text AS kind,
           ch.channel,
           el.tenant_id,
           el.event_id,
           r.id AS registration_id,
           p.id AS person_id,
           p.user_id,
           NULL::uuid AS session_id,
           NULL::uuid AS rsvp_id,
           el.lead AS lead_minutes,
           el.starts_at,
           'er:' || r.id::text || ':' || ch.channel || ':' || el.lead::text || ':'
             || floor(extract(epoch FROM el.starts_at))::bigint::text AS dedupe_key
      FROM ev_due el
      JOIN public.event_registrations r
        ON r.tenant_id = el.tenant_id AND r.event_id = el.event_id
      JOIN public.event_people p
        ON p.id = r.person_id AND p.tenant_id = r.tenant_id
     CROSS JOIN LATERAL (VALUES
       ('email', r.remind_email AND p.email_norm IS NOT NULL),
       ('inapp', r.remind_push AND p.user_id IS NOT NULL
                 AND NOT (el.quiet AND el.lead > 60)
                 -- Przejscie ze starego skanera (dzwonek przez projekcje RSVP).
                 AND NOT EXISTS (
                   SELECT 1 FROM public.event_rsvps v
                    WHERE v.event_id = el.event_id
                      AND v.tenant_id = el.tenant_id
                      AND v.user_id = p.user_id
                      AND v.reminded_at >= el.starts_at - make_interval(mins => el.lead))),
       ('sms', el.sms_enabled AND r.remind_sms AND r.remind_sms_consent_at IS NOT NULL
               AND NULLIF(btrim(COALESCE(p.phone, '')), '') IS NOT NULL
               AND NOT (el.quiet AND el.lead > 60))
     ) AS ch(channel, wanted)
     WHERE ch.wanted
       AND ch.channel = ANY (p_channels)
       AND r.status IN ('approved', 'attended')
       AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')
       AND r.created_at <= el.due_at
  ),
  rsvp AS (
    SELECT 'event_reminder'::text AS kind,
           'inapp'::text AS channel,
           el.tenant_id,
           el.event_id,
           NULL::uuid AS registration_id,
           NULL::uuid AS person_id,
           v.user_id,
           NULL::uuid AS session_id,
           v.id AS rsvp_id,
           el.lead AS lead_minutes,
           el.starts_at,
           'er:rsvp:' || v.id::text || ':inapp:' || el.lead::text || ':'
             || floor(extract(epoch FROM el.starts_at))::bigint::text AS dedupe_key
      FROM ev_due el
      JOIN public.event_rsvps v
        ON v.event_id = el.event_id AND v.tenant_id = el.tenant_id
     WHERE 'inapp' = ANY (p_channels)
       AND NOT (el.quiet AND el.lead > 60)
       AND v.status = 'going'
       AND v.created_at <= el.due_at
       AND (v.reminded_at IS NULL OR v.reminded_at < el.due_at)
       -- Konto z zywym zgloszeniem obsluguje galaz `reg` (z jego preferencjami);
       -- tu zostaja wylacznie same RSVP.
       AND NOT EXISTS (
         SELECT 1
           FROM public.event_registrations r
           JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
          WHERE r.tenant_id = el.tenant_id
            AND r.event_id = el.event_id
            AND p.user_id = v.user_id
            AND r.status NOT IN ('cancelled', 'rejected'))
  ),
  ses AS (
    SELECT es.tenant_id,
           es.event_id,
           es.id AS session_id,
           es.starts_at,
           s.session_reminder_lead_minutes AS lead,
           es.starts_at - make_interval(mins => s.session_reminder_lead_minutes) AS due_at,
           public._event_local_quiet(e.timezone, p_now) AS quiet
      FROM public.event_sessions es
      JOIN public.events e
        ON e.id = es.event_id AND e.tenant_id = es.tenant_id
     CROSS JOIN LATERAL public._event_participant_settings_effective(es.tenant_id, es.event_id) s
     WHERE es.status = 'published'
       AND es.cancelled_at IS NULL
       AND es.starts_at > p_now
       -- 240 min = gorna granica CHECK event_participant_settings_session_lead.
       AND es.starts_at <= p_now + interval '240 minutes'
       AND e.status = 'published'
       AND e.cancelled_at IS NULL
       AND s.reminders_enabled
       AND s.session_reminders_enabled
       AND es.starts_at - make_interval(mins => s.session_reminder_lead_minutes) <= p_now
  ),
  ses_who AS (
    SELECT DISTINCT x.tenant_id, x.event_id, x.session_id, x.starts_at, x.lead, x.quiet, x.user_id
      FROM (
        SELECT ses.*, g.user_id, g.registered_at AS added_at
          FROM ses
          JOIN public.event_session_signups g
            ON g.tenant_id = ses.tenant_id AND g.session_id = ses.session_id
         WHERE g.status = 'registered'
        UNION ALL
        SELECT ses.*, b.user_id, b.created_at AS added_at
          FROM ses
          JOIN public.event_session_saves b
            ON b.tenant_id = ses.tenant_id AND b.session_id = ses.session_id
      ) x
     WHERE x.added_at <= x.due_at
  ),
  ses_cand AS (
    SELECT 'session_reminder'::text AS kind,
           ch.channel,
           w.tenant_id,
           w.event_id,
           r.id AS registration_id,
           p.id AS person_id,
           w.user_id,
           w.session_id,
           NULL::uuid AS rsvp_id,
           w.lead AS lead_minutes,
           w.starts_at,
           'sr:' || w.session_id::text || ':' || w.user_id::text || ':' || ch.channel || ':'
             || w.lead::text || ':' || floor(extract(epoch FROM w.starts_at))::bigint::text AS dedupe_key
      FROM ses_who w
      JOIN public.event_people p
        ON p.tenant_id = w.tenant_id AND p.user_id = w.user_id
      JOIN LATERAL (
        SELECT r0.id, r0.remind_email, r0.remind_push, r0.remind_sessions
          FROM public.event_registrations r0
         WHERE r0.tenant_id = w.tenant_id
           AND r0.event_id = w.event_id
           AND r0.person_id = p.id
           AND r0.status IN ('approved', 'attended')
           AND r0.payment_status IN ('paid', 'partially_refunded', 'not_required')
         ORDER BY r0.created_at, r0.id
         LIMIT 1
      ) r ON true
     CROSS JOIN LATERAL (VALUES
       ('email', r.remind_email AND p.email_norm IS NOT NULL),
       ('inapp', r.remind_push AND NOT (w.quiet AND w.lead > 60))
     ) AS ch(channel, wanted)
     WHERE r.remind_sessions
       AND ch.wanted
       AND ch.channel = ANY (p_channels)
  ),
  cand AS (
    SELECT * FROM reg
    UNION ALL
    SELECT * FROM rsvp
    UNION ALL
    SELECT * FROM ses_cand
  )
  SELECT c.kind, c.channel, c.dedupe_key, c.tenant_id, c.event_id, c.registration_id,
         c.person_id, c.user_id, c.session_id, c.rsvp_id, c.lead_minutes, c.starts_at
    FROM cand c
   -- Wpis dziennika, ktorego NIE wolno przejac, zamyka kandydata. Warunek
   -- przejecia jest kopia klauzuli WHERE w `_event_delivery_claim`; rezerwacja
   -- i tak rozstrzyga atomowo, a ten filtr oszczedza jej proby skazane na NULL.
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.event_message_deliveries d
      WHERE d.tenant_id = c.tenant_id
        AND d.dedupe_key = c.dedupe_key
        AND NOT (
          d.channel <> 'inapp'
          AND (
            (d.status = 'claimed' AND d.claimed_at < p_now - interval '15 minutes' AND d.attempts < 10)
            OR (d.status = 'failed' AND d.attempts < 3)
          )
        )
   )
   ORDER BY c.starts_at, c.dedupe_key
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000));
$function$;
COMMENT ON FUNCTION public._event_reminder_candidates(timestamptz, text[], integer) IS
  'Nalezne przypomnienia uczestnika (F2): o wydarzeniu dla zgloszen z biletem (email/inapp/sms wg remind_*), o wydarzeniu dla samych RSVP (inapp) i o sesjach z planu (email/inapp wg remind_sessions). Ustawienia przez _event_participant_settings_effective; najmniejszy nalezny termin; termin tylko dla zapisu sprzed jego chwili; cisza nocna odracza inapp/sms z wyprzedzeniem > 60 min; bez wpisow dziennika, ktorych nie wolno przejac.';
REVOKE ALL ON FUNCTION public._event_reminder_candidates(timestamptz, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_reminder_candidates(timestamptz, text[], integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) Dzwonki: run_event_reminders() na rodzaju 'event'
-- LOCKS: event_message_deliveries (INSERT/UPDATE), notifications (INSERT przez
-- enqueue_notification), event_rsvps (UPDATE reminded_at po kluczu unikalnym).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_event_reminders()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c record;
  v_delivery uuid;
  v_note uuid;
  v_count integer := 0;
  v_tz text;
  v_at text;
  v_title_pl text;
  v_title_en text;
  v_body_pl text;
  v_body_en text;
  v_href text;
BEGIN
  FOR c IN
    SELECT k.*,
           e.slug,
           e.title_pl AS event_title_pl,
           e.title_en AS event_title_en,
           e.timezone,
           es.title_pl AS session_title_pl,
           es.title_en AS session_title_en
      FROM public._event_reminder_candidates(now(), ARRAY['inapp'], 200) k
      JOIN public.events e ON e.id = k.event_id AND e.tenant_id = k.tenant_id
      LEFT JOIN public.event_sessions es ON es.id = k.session_id AND es.tenant_id = k.tenant_id
  LOOP
    v_delivery := public._event_delivery_claim(jsonb_build_object(
      'tenant_id', c.tenant_id,
      'event_id', c.event_id,
      'registration_id', c.registration_id,
      'person_id', c.person_id,
      'user_id', c.user_id,
      'session_id', c.session_id,
      'kind', c.kind,
      'channel', c.channel,
      'dedupe_key', c.dedupe_key,
      'lead_minutes', c.lead_minutes,
      'starts_at', c.starts_at));
    -- Inny harmonogram wzial to doreczenie w tej samej chwili.
    CONTINUE WHEN v_delivery IS NULL;

    v_tz := public._event_safe_timezone(c.timezone);
    v_at := to_char(c.starts_at AT TIME ZONE v_tz, 'DD.MM HH24:MI');
    IF c.kind = 'session_reminder' THEN
      v_title_pl := 'Sesja wkrótce: ' || c.session_title_pl;
      v_title_en := 'Session soon: ' || COALESCE(NULLIF(btrim(c.session_title_en), ''), c.session_title_pl);
      v_body_pl := 'Sesja z Twojego planu zaczyna się ' || v_at || ' (' || v_tz || ').';
      v_body_en := 'A session from your plan starts at ' || v_at || ' (' || v_tz || ').';
      v_href := '/events/' || c.slug || '/me?tab=schedule#event-session-' || c.session_id::text;
    ELSE
      v_title_pl := 'Przypomnienie: ' || c.event_title_pl;
      v_title_en := 'Reminder: ' || COALESCE(NULLIF(btrim(c.event_title_en), ''), c.event_title_pl);
      v_body_pl := 'Wydarzenie zaczyna się ' || v_at || ' (' || v_tz || ').';
      v_body_en := 'The event starts at ' || v_at || ' (' || v_tz || ').';
      v_href := '/events/' || c.slug;
    END IF;

    v_note := public.enqueue_notification(
      c.user_id,
      'event',
      v_title_pl,
      v_title_en,
      v_body_pl,
      v_body_en,
      v_href,
      'calendar-clock'
    );

    -- NULL od producenta: odbiorca wylaczyl rodzaj „Wydarzenia", ten sam dzwonek
    -- wyszedl w ostatnich 5 minutach albo producent polknal blad. Wpis
    -- zamykamy jako pominiety (in-app nie jest nigdy ponawiany).
    PERFORM public._event_delivery_confirm(
      v_delivery,
      CASE WHEN v_note IS NULL THEN 'skipped' ELSE 'sent' END,
      CASE WHEN v_note IS NULL THEN 'not_enqueued' END);

    IF v_note IS NOT NULL THEN
      v_count := v_count + 1;
      IF c.kind = 'event_reminder' THEN
        UPDATE public.event_rsvps
           SET reminded_at = now()
         WHERE event_id = c.event_id
           AND tenant_id = c.tenant_id
           AND user_id = c.user_id;
      END IF;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;
COMMENT ON FUNCTION public.run_event_reminders() IS
  'Dzwonki przypomnien uczestnika (rodzaj event): o wydarzeniu wg terminow organizatora (zgloszenia z biletem i same RSVP) i o sesjach z planu. Przez dziennik doreczen (_event_delivery_claim/_confirm), partia 200 w kolejnosci startu. Zwraca liczbe wyslanych dzwonkow. E-mail i SMS wysyla zadanie F2 (_event_reminders_claim).';
REVOKE ALL ON FUNCTION public.run_event_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_event_reminders() TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Partia e-mail/SMS dla zadania F2
-- LOCKS: event_message_deliveries (INSERT ... ON CONFLICT) only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_reminders_claim(p_limit integer DEFAULT 20, p_sms boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c record;
  v_delivery uuid;
  v_out jsonb := '[]'::jsonb;
  v_channels text[] := CASE WHEN COALESCE(p_sms, false) THEN ARRAY['email', 'sms'] ELSE ARRAY['email'] END;
BEGIN
  FOR c IN
    SELECT k.*,
           e.slug,
           e.title_pl AS event_title_pl,
           e.title_en AS event_title_en,
           e.timezone,
           e.location,
           e.format,
           e.street_address,
           e.postal_code,
           e.city,
           e.country,
           es.title_pl AS session_title_pl,
           es.title_en AS session_title_en,
           rm.name AS room_name,
           p.email,
           p.phone,
           p.first_name
      FROM public._event_reminder_candidates(now(), v_channels,
             GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))) k
      JOIN public.events e ON e.id = k.event_id AND e.tenant_id = k.tenant_id
      JOIN public.event_people p ON p.id = k.person_id AND p.tenant_id = k.tenant_id
      LEFT JOIN public.event_sessions es ON es.id = k.session_id AND es.tenant_id = k.tenant_id
      LEFT JOIN public.event_rooms rm ON rm.id = es.room_id AND rm.tenant_id = es.tenant_id
  LOOP
    v_delivery := public._event_delivery_claim(jsonb_build_object(
      'tenant_id', c.tenant_id,
      'event_id', c.event_id,
      'registration_id', c.registration_id,
      'person_id', c.person_id,
      'user_id', c.user_id,
      'session_id', c.session_id,
      'kind', c.kind,
      'channel', c.channel,
      'dedupe_key', c.dedupe_key,
      'lead_minutes', c.lead_minutes,
      'starts_at', c.starts_at));
    CONTINUE WHEN v_delivery IS NULL;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'delivery_id', v_delivery,
      'kind', c.kind,
      'channel', c.channel,
      'dedupe_key', c.dedupe_key,
      'tenant_id', c.tenant_id,
      'event_id', c.event_id,
      'registration_id', c.registration_id,
      'session_id', c.session_id,
      'lead_minutes', c.lead_minutes,
      'starts_at', c.starts_at,
      'lang', public._event_registration_lang(c.tenant_id, c.registration_id),
      'email', c.email,
      'phone', CASE WHEN c.channel = 'sms' THEN c.phone END,
      'first_name', c.first_name,
      'event_slug', c.slug,
      'event_title_pl', c.event_title_pl,
      'event_title_en', c.event_title_en,
      'event_timezone', public._event_safe_timezone(c.timezone),
      'event_location', c.location,
      'event_format', c.format,
      'event_street_address', c.street_address,
      'event_postal_code', c.postal_code,
      'event_city', c.city,
      'event_country', c.country,
      'session_title_pl', c.session_title_pl,
      'session_title_en', c.session_title_en,
      'room_name', c.room_name));
  END LOOP;
  RETURN v_out;
END;
$function$;
COMMENT ON FUNCTION public._event_reminders_claim(integer, boolean) IS
  'Zadanie F2: rezerwuje do 100 naleznych przypomnien e-mail (i SMS, gdy p_sms) przez _event_delivery_claim i zwraca tablice jsonb z danymi do wysylki (delivery_id, rodzaj, kanal, jezyk, adres, wydarzenie, sesja, sala). Numer telefonu tylko dla kanalu sms.';
REVOKE ALL ON FUNCTION public._event_reminders_claim(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_reminders_claim(integer, boolean) TO service_role;

-- ----------------------------------------------------------------------------
-- 5) Zamkniecie partii jednym RPC
-- LOCKS: event_message_deliveries rows (UPDATE) only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_delivery_confirm_many(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb;
  v_id uuid;
  v_count integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be a JSON array';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'invalid_payload: at most 200 items';
  END IF;

  -- Cala partia jest walidowana PRZED pierwszym zapisem: zly element nie moze
  -- zostawic polowy partii zamknietej, a polowy w stanie claimed.
  FOR v_item IN SELECT x FROM jsonb_array_elements(p_items) AS x LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR COALESCE(v_item->>'id', '')
          !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR COALESCE(v_item->>'status', '') NOT IN ('sent', 'skipped', 'failed') THEN
      RAISE EXCEPTION 'invalid_payload: each item needs id (uuid) and status sent|skipped|failed';
    END IF;
  END LOOP;

  FOR v_item IN SELECT x FROM jsonb_array_elements(p_items) AS x LOOP
    v_id := (v_item->>'id')::uuid;
    IF public._event_delivery_confirm(v_id, v_item->>'status', v_item->>'detail') THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;
COMMENT ON FUNCTION public._event_delivery_confirm_many(jsonb) IS
  'Zamyka partie doreczen jednym wywolaniem: [{id, status sent|skipped|failed, detail?}], najwyzej 200, walidacja calej partii przed zapisem. Kazdy element idzie przez _event_delivery_confirm (tylko wiersze claimed). Zwraca liczbe zamknietych.';
REVOKE ALL ON FUNCTION public._event_delivery_confirm_many(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_delivery_confirm_many(jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Digest bez rodzaju 'event' juz w claimie (D8)
-- Cialo z 20260713092000; zmienione WYLACZNIE dwa warunki `n.kind <> 'event'`
-- i `search_path` z 'pg_temp'.
-- LOCKS: notification_preferences rows (FOR UPDATE SKIP LOCKED, UPDATE).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_due_digests(p_frequency text, p_limit integer DEFAULT 50)
RETURNS TABLE (user_id uuid, email text, display_name text, items jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_window interval;
BEGIN
  IF p_frequency NOT IN ('daily', 'weekly') THEN
    RAISE EXCEPTION 'digest: unknown frequency %', p_frequency;
  END IF;
  v_window := CASE p_frequency WHEN 'daily' THEN interval '20 hours' ELSE interval '6 days' END;

  RETURN QUERY
  WITH cand AS (
    SELECT np.user_id AS uid,
           COALESCE(np.digest_last_sent_at, now() - interval '14 days') AS since
      FROM public.notification_preferences np
     WHERE np.email_digest = p_frequency
       AND (np.digest_last_sent_at IS NULL OR np.digest_last_sent_at < now() - v_window)
       AND EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = np.user_id
            AND n.read_at IS NULL
            -- Przypomnienie w zbiorczym mailu jest po czasie z definicji (D8):
            -- konto z samymi przypomnieniami nie jest kandydatem i nie traci okna.
            AND n.kind <> 'event'
            AND n.created_at > COALESCE(np.digest_last_sent_at, now() - interval '14 days')
       )
     ORDER BY np.digest_last_sent_at ASC NULLS FIRST
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
       FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.notification_preferences np
       SET digest_last_sent_at = now()
      FROM cand
     WHERE np.user_id = cand.uid
    RETURNING np.user_id AS uid
  )
  SELECT p.id,
         p.email,
         COALESCE(p.display_name, split_part(p.email, '@', 1)),
         (
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'kind', q.kind,
                    'title_pl', q.title_pl,
                    'title_en', q.title_en,
                    'body_pl', q.body_pl,
                    'body_en', q.body_en,
                    'href', q.href,
                    'created_at', q.created_at
                  ) ORDER BY q.created_at DESC), '[]'::jsonb)
             FROM (
               SELECT n.kind, n.title_pl, n.title_en, n.body_pl, n.body_en,
                      n.href, n.created_at
                 FROM public.notifications n
                 JOIN cand c ON c.uid = n.user_id
                WHERE n.user_id = p.id
                  AND n.read_at IS NULL
                  -- Bez przypomnien: nie wypieraja pozycji z limitu 20.
                  AND n.kind <> 'event'
                  AND n.created_at > c.since
                ORDER BY n.created_at DESC
                LIMIT 20
             ) q
         )
    FROM upd
    JOIN public.profiles p ON p.id = upd.uid
   WHERE p.email IS NOT NULL AND p.email <> '';
END;
$function$;
COMMENT ON FUNCTION public.claim_due_digests(text, integer) IS
  'Atomowy claim naleznych digestow (daily/weekly): stempluje digest_last_sent_at i zwraca do 20 nieprzeczytanych pozycji od poprzedniego digestu. Rodzaj event (przypomnienia, D8) jest wykluczony z wyboru kandydatow i z pozycji.';
REVOKE ALL ON FUNCTION public.claim_due_digests(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_digests(text, integer) TO service_role;
