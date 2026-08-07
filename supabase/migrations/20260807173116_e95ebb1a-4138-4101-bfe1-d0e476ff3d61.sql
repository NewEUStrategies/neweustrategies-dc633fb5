ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_introduction  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_recommendation boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_endorsement   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_profile_view  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_meeting       boolean NOT NULL DEFAULT true;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search',
                  'crm_task','expert_request',
                  'introduction','recommendation','endorsement',
                  'profile_view','meeting'))
  NOT VALID;

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text, p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tenant uuid; v_id uuid; v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN RETURN NULL; END IF;
  IF p_kind <> 'security' THEN
    SELECT CASE p_kind
             WHEN 'message'        THEN np.enabled_message
             WHEN 'comment'        THEN np.enabled_comment
             WHEN 'follow'         THEN np.enabled_follow
             WHEN 'subscription'   THEN np.enabled_subscription
             WHEN 'content'        THEN np.enabled_content
             WHEN 'system'         THEN np.enabled_system
             WHEN 'tracker'        THEN np.enabled_tracker
             WHEN 'connection'     THEN np.enabled_connection
             WHEN 'saved_search'   THEN np.enabled_saved_search
             WHEN 'crm_task'       THEN np.enabled_crm_task
             WHEN 'expert_request' THEN np.enabled_expert_request
             WHEN 'introduction'   THEN np.enabled_introduction
             WHEN 'recommendation' THEN np.enabled_recommendation
             WHEN 'endorsement'    THEN np.enabled_endorsement
             WHEN 'profile_view'   THEN np.enabled_profile_view
             WHEN 'meeting'        THEN np.enabled_meeting
             ELSE true END
      INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN RETURN NULL; END IF;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes') THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (
    user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon
  ) VALUES (
    p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''),
    NULLIF(btrim(p_body_pl), ''),
    NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''),
    NULLIF(btrim(p_icon), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.nes_profile_label(_user_id uuid, _fallback text DEFAULT 'Użytkownik')
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
           NULLIF(btrim(p.display_name), ''),
           NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
           NULLIF(btrim(_fallback), ''),
           'Użytkownik')
    FROM public.profiles p
   WHERE p.id = _user_id;
$$;

REVOKE ALL ON FUNCTION public.nes_profile_label(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nes_profile_label(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.nes_profile_href(_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE('/author/' || NULLIF(btrim(p.slug), ''), '/profile')
    FROM public.profiles p
   WHERE p.id = _user_id;
$$;

REVOKE ALL ON FUNCTION public.nes_profile_href(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nes_profile_href(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_introduction_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_requester text;
  v_target    text;
  v_bridge    text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_requester := public.nes_profile_label(NEW.requester_id);
    v_target    := public.nes_profile_label(NEW.target_id);
    PERFORM public.enqueue_notification(
      NEW.bridge_id, 'introduction',
      'Prośba o wprowadzenie',
      'Introduction request',
      v_requester || ' prosi o wprowadzenie do ' || v_target || '.',
      v_requester || ' asks to be introduced to ' || v_target || '.',
      '/profile?intro=' || NEW.id::text,
      'Handshake'
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_requester := public.nes_profile_label(NEW.requester_id);
  v_target    := public.nes_profile_label(NEW.target_id);
  v_bridge    := public.nes_profile_label(NEW.bridge_id);

  IF NEW.status = 'forwarded' THEN
    PERFORM public.enqueue_notification(
      NEW.target_id, 'introduction',
      'Wprowadzenie od ' || v_bridge,
      'Introduction from ' || v_bridge,
      v_bridge || ' przedstawia Ci ' || v_requester || '.',
      v_bridge || ' is introducing you to ' || v_requester || '.',
      '/profile?intro=' || NEW.id::text,
      'Handshake'
    );
    PERFORM public.enqueue_notification(
      NEW.requester_id, 'introduction',
      'Wprowadzenie przekazane',
      'Introduction forwarded',
      v_bridge || ' przekazał Twoją prośbę do ' || v_target || '.',
      v_bridge || ' forwarded your request to ' || v_target || '.',
      '/profile?intro=' || NEW.id::text || '&role=requester',
      'Handshake'
    );
  ELSIF NEW.status = 'declined' THEN
    PERFORM public.enqueue_notification(
      NEW.requester_id, 'introduction',
      'Prośba o wprowadzenie nierozpatrzona',
      'Introduction request declined',
      v_bridge || ' nie przekazał prośby o wprowadzenie do ' || v_target || '.',
      v_bridge || ' did not forward your introduction request to ' || v_target || '.',
      '/profile?intro=' || NEW.id::text || '&role=requester',
      'Handshake'
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_introduction_notify ON public.introduction_requests;
CREATE TRIGGER trg_introduction_notify
  AFTER INSERT OR UPDATE OF status ON public.introduction_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_introduction_notify();

CREATE OR REPLACE FUNCTION public.tg_recommendation_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_author    text;
  v_recipient text;
  v_href      text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'pending' THEN
    v_author := public.nes_profile_label(NEW.author_id);
    PERFORM public.enqueue_notification(
      NEW.recipient_id, 'recommendation',
      'Nowa rekomendacja do zatwierdzenia',
      'New recommendation awaiting approval',
      v_author || ' napisał rekomendację na Twoim profilu - zatwierdź, żeby stała się publiczna.',
      v_author || ' wrote a recommendation on your profile - approve it to make it public.',
      public.nes_profile_href(NEW.recipient_id) || '?rec=' || NEW.id::text,
      'Quote'
    );
  ELSIF NEW.status = 'published' THEN
    v_recipient := public.nes_profile_label(NEW.recipient_id);
    v_href := public.nes_profile_href(NEW.recipient_id);
    PERFORM public.enqueue_notification(
      NEW.author_id, 'recommendation',
      'Twoja rekomendacja jest publiczna',
      'Your recommendation is now public',
      v_recipient || ' opublikował Twoją rekomendację na swoim profilu.',
      v_recipient || ' published your recommendation on their profile.',
      v_href || '?rec=' || NEW.id::text,
      'Quote'
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recommendation_notify ON public.profile_recommendations;
CREATE TRIGGER trg_recommendation_notify
  AFTER INSERT OR UPDATE OF status ON public.profile_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.tg_recommendation_notify();

CREATE OR REPLACE FUNCTION public.tg_endorsement_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_endorser text;
  v_skill    text;
BEGIN
  v_endorser := public.nes_profile_label(NEW.endorser_id);
  SELECT NULLIF(btrim(s.label), '') INTO v_skill
    FROM public.profile_skills s WHERE s.id = NEW.skill_id;

  PERFORM public.enqueue_notification(
    NEW.recipient_id, 'endorsement',
    'Potwierdzenie umiejętności',
    'Skill endorsement',
    v_endorser || ' potwierdził Twoją umiejętność' ||
      COALESCE(': ' || v_skill, '') || '.',
    v_endorser || ' endorsed your skill' ||
      COALESCE(': ' || v_skill, '') || '.',
    '/profile?skill=' || NEW.skill_id::text,
    'BadgeCheck'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_endorsement_notify ON public.profile_skill_endorsements;
CREATE TRIGGER trg_endorsement_notify
  AFTER INSERT ON public.profile_skill_endorsements
  FOR EACH ROW EXECUTE FUNCTION public.tg_endorsement_notify();

CREATE TABLE IF NOT EXISTS public.profile_view_alert_state (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  last_alerted_view_at timestamptz NOT NULL,
  last_alert_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profile_view_alert_state_tenant_idx
  ON public.profile_view_alert_state (tenant_id);

ALTER TABLE public.profile_view_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_view_alert_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.profile_view_alert_state TO service_role;

CREATE OR REPLACE FUNCTION public.run_profile_view_alerts(p_max_profiles integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_sent integer := 0;
BEGIN
  FOR r IN
    SELECT e.profile_id,
           p.tenant_id,
           count(*)                                                   AS views,
           count(DISTINCT e.viewer_id) FILTER (
             WHERE e.viewer_mode = 'public' AND e.viewer_id IS NOT NULL
           )                                                          AS named_viewers,
           max(e.viewed_at)                                           AS newest_view,
           max(e.viewer_snapshot->>'display_name') FILTER (
             WHERE e.viewer_mode = 'public'
           )                                                          AS sample_name
      FROM public.profile_view_events e
      JOIN public.profiles p ON p.id = e.profile_id
      LEFT JOIN public.profile_view_alert_state s ON s.user_id = e.profile_id
     WHERE e.viewed_at <= now()
       AND e.viewed_at > COALESCE(s.last_alerted_view_at, now() - interval '7 days')
       AND COALESCE(s.last_alert_at, to_timestamp(0)) < now() - interval '20 hours'
     GROUP BY e.profile_id, p.tenant_id
     ORDER BY max(e.viewed_at) DESC
     LIMIT GREATEST(LEAST(COALESCE(p_max_profiles, 500), 5000), 1)
  LOOP
    BEGIN
      PERFORM public.enqueue_notification(
        r.profile_id, 'profile_view',
        CASE
          WHEN r.views = 1 THEN 'Ktoś odwiedził Twój profil'
          ELSE r.views::text || ' nowych odsłon Twojego profilu'
        END,
        CASE
          WHEN r.views = 1 THEN 'Someone viewed your profile'
          ELSE r.views::text || ' new profile views'
        END,
        CASE
          WHEN r.named_viewers = 0 THEN 'Odwiedzający nie ujawnili tożsamości.'
          WHEN r.named_viewers = 1 AND r.sample_name IS NOT NULL
            THEN r.sample_name || ' zaglądnął do Twojego profilu.'
          ELSE r.named_viewers::text || ' z nich ma widoczny profil - sprawdź, kto to.'
        END,
        CASE
          WHEN r.named_viewers = 0 THEN 'The visitors did not reveal their identity.'
          WHEN r.named_viewers = 1 AND r.sample_name IS NOT NULL
            THEN r.sample_name || ' looked at your profile.'
          ELSE r.named_viewers::text || ' of them have a visible profile - see who.'
        END,
        '/profile?views=1',
        'Eye'
      );

      INSERT INTO public.profile_view_alert_state (user_id, tenant_id, last_alerted_view_at, last_alert_at)
      VALUES (r.profile_id, r.tenant_id, r.newest_view, now())
      ON CONFLICT (user_id) DO UPDATE
        SET tenant_id = EXCLUDED.tenant_id,
            last_alerted_view_at = GREATEST(EXCLUDED.last_alerted_view_at,
                                            public.profile_view_alert_state.last_alerted_view_at),
            last_alert_at = now();
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.profile_view_alert_state (user_id, tenant_id, last_alerted_view_at, last_alert_at)
      VALUES (r.profile_id, r.tenant_id, r.newest_view, now())
      ON CONFLICT (user_id) DO UPDATE
        SET last_alerted_view_at = EXCLUDED.last_alerted_view_at,
            last_alert_at = now();
    END;
  END LOOP;
  RETURN v_sent;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_profile_view_alerts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_profile_view_alerts(integer) TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed - profile-view-alerts not scheduled';
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'profile-view-alerts',
    '17 * * * *',
    'SELECT public.run_profile_view_alerts()'
  );
END $$;

CREATE OR REPLACE FUNCTION public.book_meeting_slot(p_slot_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_slot public.meeting_slots%ROWTYPE;
  v_when text;
  v_attendee text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'meetings: authentication required';
  END IF;

  SELECT * INTO v_slot
    FROM public.meeting_slots
   WHERE id = p_slot_id
     AND tenant_id = public.public_tenant_id()
     AND is_public
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meetings: slot not found';
  END IF;
  IF v_slot.host_user_id = v_user THEN
    RAISE EXCEPTION 'meetings: cannot book own slot';
  END IF;
  IF v_slot.starts_at < now() THEN
    RAISE EXCEPTION 'meetings: slot in the past';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.meeting_bookings b
     WHERE b.slot_id = p_slot_id AND b.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'meetings: slot already booked';
  END IF;

  INSERT INTO public.meeting_bookings (tenant_id, slot_id, attendee_user_id, note)
  VALUES (v_slot.tenant_id, p_slot_id, v_user, NULLIF(btrim(COALESCE(p_note, '')), ''));

  BEGIN
    v_when := to_char(v_slot.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI');
    v_attendee := public.nes_profile_label(v_user);
    PERFORM public.enqueue_notification(
      v_slot.host_user_id,
      'meeting',
      'Nowa rezerwacja spotkania 1-1',
      'New 1-1 meeting booking',
      v_attendee || ' zarezerwował Twój slot ' || v_when || '.',
      v_attendee || ' booked your slot at ' || v_when || ' (Warsaw time).',
      '/profile?slot=' || p_slot_id::text,
      'CalendarClock'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'meetings: booking notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('slot_id', p_slot_id, 'status', 'confirmed');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_my_meeting_booking(p_slot_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_updated integer;
  v_slot public.meeting_slots%ROWTYPE;
  v_when text;
  v_attendee text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'meetings: authentication required';
  END IF;
  UPDATE public.meeting_bookings
     SET status = 'cancelled', updated_at = now()
   WHERE slot_id = p_slot_id
     AND attendee_user_id = v_user
     AND status = 'confirmed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    BEGIN
      SELECT * INTO v_slot FROM public.meeting_slots WHERE id = p_slot_id;
      IF FOUND THEN
        v_when := to_char(v_slot.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI');
        v_attendee := public.nes_profile_label(v_user);
        PERFORM public.enqueue_notification(
          v_slot.host_user_id,
          'meeting',
          'Rezerwacja spotkania anulowana',
          'Meeting booking cancelled',
          v_attendee || ' anulował rezerwację slotu ' || v_when || ' - termin jest znów wolny.',
          v_attendee || ' cancelled the booking for ' || v_when || ' - the slot is free again.',
          '/profile?slot=' || p_slot_id::text,
          'CalendarX'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'meetings: cancellation notification failed: %', SQLERRM;
    END;
  END IF;

  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_meeting_slot(p_slot_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_deleted integer;
  v_attendee uuid;
  v_starts_at timestamptz;
  v_when text;
  v_host text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'meetings: authentication required';
  END IF;

  SELECT ms.starts_at, b.attendee_user_id
    INTO v_starts_at, v_attendee
    FROM public.meeting_slots ms
    LEFT JOIN public.meeting_bookings b
      ON b.slot_id = ms.id AND b.status = 'confirmed'
   WHERE ms.id = p_slot_id AND ms.host_user_id = v_user;

  DELETE FROM public.meeting_slots
   WHERE id = p_slot_id AND host_user_id = v_user;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 AND v_attendee IS NOT NULL THEN
    BEGIN
      v_when := to_char(v_starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI');
      v_host := public.nes_profile_label(v_user, 'Host');
      PERFORM public.enqueue_notification(
        v_attendee,
        'meeting',
        'Spotkanie odwołane',
        'Meeting cancelled',
        v_host || ' odwołał spotkanie zaplanowane na ' || v_when || '.',
        v_host || ' cancelled the meeting scheduled for ' || v_when || ' (Warsaw time).',
        '/profile?slot=' || p_slot_id::text,
        'CalendarX'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'meetings: slot removal notification failed: %', SQLERRM;
    END;
  END IF;

  RETURN v_deleted > 0;
END;
$$;