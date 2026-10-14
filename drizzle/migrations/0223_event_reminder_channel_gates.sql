-- events-harness: include
-- ============================================================================
-- PRZYPOMNIENIA UCZESTNIKA - REG-09: GLOWNE PRZELACZNIKI KANALOW ZGLOSZENIA
-- (notify_email / notify_sms) OBOWIAZUJA TAKZE PRZYPOMNIENIA.
--
-- DEFEKT
--   `_event_reminder_candidates` (jedyna definicja: 20261003140000:82-314)
--   czyta wylacznie podprzelaczniki `remind_*`:
--     * e-mail o wydarzeniu (:154) - `r.remind_email AND p.email_norm ...`;
--     * e-mail o sesji (:275) - to samo, a LATERAL (:264) nie wybiera nawet
--       `notify_email`;
--     * SMS (:164) - `el.sms_enabled AND r.remind_sms AND stempel ...`.
--   Uczestnik, ktory w „Moich zgloszeniach" wylaczyl e-mail (`notify_email =
--   false`), dalej dostawal przypomnienia o wydarzeniu i o sesjach. Przy
--   `notify_sms = false` przypomnienie SMS zalezalo tylko od `remind_sms`.
--   (Kontrapunkt: `_event_ticket_revoked_notices_claim` juz respektuje
--   `notify_email IS FALSE`.)
--
-- ZMIANA (ZMIANA 20261012, REG-09, D12). Cialo ZNAK W ZNAK z
-- 20261003140000:82-310 poza trzema bramkami:
--   1. e-mail o wydarzeniu: `r.notify_email AND r.remind_email AND ...`;
--   2. SMS: `el.sms_enabled AND r.notify_sms AND r.remind_sms AND stempel ...`;
--   3. e-mail o sesji: LATERAL wybiera `r0.notify_email`, a kanal ma
--      `r.notify_email AND r.remind_email AND ...`.
--   Dzwonek (inapp) bez zmian - `notify_*` steruje poczta i SMS-em, dzwonek
--   ma wlasna preferencje (`remind_push` + ustawienia powiadomien konta).
--   `_event_reminders_claim` i `run_event_reminders` biora bramki stad - bez
--   zmian. Kazdy, kto zmienia regule naleznosci przypomnien, startuje od TEGO
--   ciala, nie od 20261003140000.
--
-- CZEGO TO NIE ZAMYKA. Wpisy dziennika doreczen zarezerwowane przed
-- wdrozeniem wysla sie jeszcze raz wedlug starej reguly (najwyzej jedna
-- porcja). Bramka zgody SMS przy wysylce transakcyjnej (platnosc, awans) siedzi
-- w TS (`registrationOutcomeNotify.server.ts`), nie tutaj.
--
-- DLACZEGO TO WCHODZI DO HARNESSU WYDARZEN, a 20261003140000 nie: tamta
-- migracja przepisuje `run_event_reminders` i `claim_due_digests` (atrapy
-- harnessu). Ta definiuje WYLACZNIE skaner, ktory czyta tabele modulu
-- obecne w harnessie (zgloszenia, osoby, sesje, zapisy, zakladki, dziennik
-- doreczen, RSVP) - wiec harness sprawdza bramki na realnym ciele.
--
-- KOLEJNOSC WDROZENIA: dowolna (nowe bramki czytaja istniejace kolumny).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_reminder_channel_gates_test.sql,
-- scripts/events-harness/runtime_test.d/16_sms_consent_reminder_gates.sql.
-- ============================================================================

-- LOCKS: none (read only).
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
       ('email', r.notify_email AND r.remind_email AND p.email_norm IS NOT NULL),
       ('inapp', r.remind_push AND p.user_id IS NOT NULL
                 AND NOT (el.quiet AND el.lead > 60)
                 -- Przejscie ze starego skanera (dzwonek przez projekcje RSVP).
                 AND NOT EXISTS (
                   SELECT 1 FROM public.event_rsvps v
                    WHERE v.event_id = el.event_id
                      AND v.tenant_id = el.tenant_id
                      AND v.user_id = p.user_id
                      AND v.reminded_at >= el.starts_at - make_interval(mins => el.lead))),
       ('sms', el.sms_enabled AND r.notify_sms AND r.remind_sms AND r.remind_sms_consent_at IS NOT NULL
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
        SELECT r0.id, r0.notify_email, r0.remind_email, r0.remind_push, r0.remind_sessions
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
       ('email', r.notify_email AND r.remind_email AND p.email_norm IS NOT NULL),
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
  'Nalezne przypomnienia uczestnika (F2): o wydarzeniu dla zgloszen z biletem (email gdy notify_email AND remind_email, inapp wg remind_push, sms gdy notify_sms AND remind_sms AND stempel zgody - REG-09), o wydarzeniu dla samych RSVP (inapp) i o sesjach z planu (email gdy notify_email AND remind_email, inapp wg remind_push; wszystko wg remind_sessions). Ustawienia przez _event_participant_settings_effective; najmniejszy nalezny termin; termin tylko dla zapisu sprzed jego chwili; cisza nocna odracza inapp/sms z wyprzedzeniem > 60 min; bez wpisow dziennika, ktorych nie wolno przejac.';
REVOKE ALL ON FUNCTION public._event_reminder_candidates(timestamptz, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_reminder_candidates(timestamptz, text[], integer) TO service_role;
