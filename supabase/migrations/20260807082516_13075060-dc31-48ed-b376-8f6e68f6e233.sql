ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_introduction    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_recommendation  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_endorsement     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_profile_view    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_meeting_booking boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.enabled_introduction IS
  'Wprowadzenia: nowa prośba (most), przekazanie (proszący + osoba docelowa), wycofanie (most). Odmowa mostu pozostaje cicha.';
COMMENT ON COLUMN public.notification_preferences.enabled_recommendation IS
  'Rekomendacje profilowe: nowa/zaktualizowana treść do moderacji (odbiorca) i publikacja (autor). Odrzucenie i ukrycie pozostają ciche.';
COMMENT ON COLUMN public.notification_preferences.enabled_endorsement IS
  'Poparcia umiejętności: ktoś poparł umiejętność na Twoim profilu.';
COMMENT ON COLUMN public.notification_preferences.enabled_profile_view IS
  'Wyświetlenia profilu: ktoś odwiedził Twój profil (tożsamość tylko dla widzów w trybie publicznym).';
COMMENT ON COLUMN public.notification_preferences.enabled_meeting_booking IS
  'Spotkania 1-1: nowa rezerwacja slotu (host + potwierdzenie dla rezerwującego) i anulowanie (host).';

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search',
                  'crm_task','expert_request','introduction','recommendation',
                  'endorsement','profile_view','meeting_booking'))
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
             WHEN 'message'         THEN np.enabled_message
             WHEN 'comment'         THEN np.enabled_comment
             WHEN 'follow'          THEN np.enabled_follow
             WHEN 'subscription'    THEN np.enabled_subscription
             WHEN 'content'         THEN np.enabled_content
             WHEN 'system'          THEN np.enabled_system
             WHEN 'tracker'         THEN np.enabled_tracker
             WHEN 'connection'      THEN np.enabled_connection
             WHEN 'saved_search'    THEN np.enabled_saved_search
             WHEN 'crm_task'        THEN np.enabled_crm_task
             WHEN 'expert_request'  THEN np.enabled_expert_request
             WHEN 'introduction'    THEN np.enabled_introduction
             WHEN 'recommendation'  THEN np.enabled_recommendation
             WHEN 'endorsement'     THEN np.enabled_endorsement
             WHEN 'profile_view'    THEN np.enabled_profile_view
             WHEN 'meeting_booking' THEN np.enabled_meeting_booking
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

CREATE OR REPLACE FUNCTION public.notification_actor_name(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT NULLIF(btrim(p.display_name), '')
    FROM public.profiles p
   WHERE p.id = p_user_id;
$function$;

REVOKE ALL ON FUNCTION public.notification_actor_name(uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notification_actor_name(uuid) IS
  'display_name aktora zdarzenia (NULL, gdy brak) dla treści powiadomień. Wyłącznie serwerowa - wołana przez producentów SECURITY DEFINER.';

CREATE OR REPLACE FUNCTION public.notification_profile_ref(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT NULLIF(btrim(p.slug), '') FROM public.profiles p WHERE p.id = p_user_id),
    p_user_id::text
  );
$function$;

REVOKE ALL ON FUNCTION public.notification_profile_ref(uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notification_profile_ref(uuid) IS
  'Segment ścieżki /author/<ref> dla powiadomień: slug profilu, a gdy brak - id (trasa rezolwuje oba).';

CREATE OR REPLACE FUNCTION public.tg_introduction_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_requester text;
  v_bridge    text;
  v_target    text;
BEGIN
  v_requester := public.notification_actor_name(NEW.requester_id);
  v_bridge    := public.notification_actor_name(NEW.bridge_id);
  v_target    := public.notification_actor_name(NEW.target_id);

  IF TG_OP = 'INSERT' THEN
    PERFORM public.enqueue_notification(
      NEW.bridge_id, 'introduction',
      'Prośba o wprowadzenie',
      'Introduction request',
      COALESCE(v_requester, 'Użytkownik') || ' prosi o wprowadzenie do '
        || COALESCE(v_target, 'innej osoby'),
      COALESCE(v_requester, 'A member') || ' asks for an introduction to '
        || COALESCE(v_target, 'another member'),
      '/profile?tab=activity&intro=bridge#i-' || NEW.id::text || '-pending',
      'Handshake'
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'forwarded' THEN
    PERFORM public.enqueue_notification(
      NEW.requester_id, 'introduction',
      'Prośba o wprowadzenie przekazana',
      'Introduction request forwarded',
      COALESCE(v_target, 'Osoba docelowa') || ' - przekazane przez '
        || COALESCE(v_bridge, 'wspólny kontakt'),
      COALESCE(v_target, 'The target member') || ' - forwarded by '
        || COALESCE(v_bridge, 'your mutual contact'),
      '/profile?tab=activity&intro=requester#i-' || NEW.id::text || '-forwarded',
      'Handshake'
    );
    PERFORM public.enqueue_notification(
      NEW.target_id, 'introduction',
      'Nowe wprowadzenie',
      'You have a new introduction',
      COALESCE(v_requester, 'Użytkownik') || ' - wprowadzenie przez '
        || COALESCE(v_bridge, 'wspólny kontakt'),
      COALESCE(v_requester, 'A member') || ' - introduced by '
        || COALESCE(v_bridge, 'your mutual contact'),
      '/profile?tab=activity&intro=target#i-' || NEW.id::text || '-forwarded',
      'Handshake'
    );

  ELSIF NEW.status = 'withdrawn' THEN
    PERFORM public.enqueue_notification(
      NEW.bridge_id, 'introduction',
      'Prośba o wprowadzenie wycofana',
      'Introduction request withdrawn',
      COALESCE(v_requester, 'Użytkownik') || ' wycofuje prośbę o wprowadzenie do '
        || COALESCE(v_target, 'innej osoby'),
      COALESCE(v_requester, 'A member') || ' withdrew the introduction request to '
        || COALESCE(v_target, 'another member'),
      '/profile?tab=activity&intro=bridge#i-' || NEW.id::text || '-withdrawn',
      'X'
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_introduction_notify() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_introduction_notify() IS
  'Producent powiadomień modułu Wprowadzenia: INSERT -> most, forwarded -> proszący + osoba docelowa, withdrawn -> most. Odmowa mostu jest cicha.';

DROP TRIGGER IF EXISTS introduction_requests_notify_insert ON public.introduction_requests;
CREATE TRIGGER introduction_requests_notify_insert
  AFTER INSERT ON public.introduction_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_introduction_notify();

DROP TRIGGER IF EXISTS introduction_requests_notify_status ON public.introduction_requests;
CREATE TRIGGER introduction_requests_notify_status
  AFTER UPDATE OF status ON public.introduction_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_introduction_notify();

CREATE OR REPLACE FUNCTION public.tg_recommendation_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor      text;
  v_excerpt    text;
  v_to_moderate boolean := false;
  v_published   boolean := false;
BEGIN
  v_excerpt := left(btrim(COALESCE(NEW.body, '')), 140);

  IF TG_OP = 'INSERT' THEN
    v_to_moderate := true;
  ELSE
    v_to_moderate := NEW.status = 'pending'
      AND (OLD.status IS DISTINCT FROM 'pending' OR NEW.body IS DISTINCT FROM OLD.body);
    v_published := NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published';
  END IF;

  IF v_to_moderate THEN
    v_actor := public.notification_actor_name(NEW.author_id);
    PERFORM public.enqueue_notification(
      NEW.recipient_id, 'recommendation',
      'Nowa rekomendacja do zatwierdzenia',
      'New recommendation awaiting your approval',
      COALESCE(v_actor, 'Użytkownik') || ': ' || v_excerpt,
      COALESCE(v_actor, 'A member') || ': ' || v_excerpt,
      '/author/' || public.notification_profile_ref(NEW.recipient_id)
        || '#r-' || NEW.id::text || '-pending',
      'Quote'
    );
    RETURN NEW;
  END IF;

  IF v_published THEN
    v_actor := public.notification_actor_name(NEW.recipient_id);
    PERFORM public.enqueue_notification(
      NEW.author_id, 'recommendation',
      'Twoja rekomendacja została opublikowana',
      'Your recommendation was published',
      COALESCE(v_actor, 'Użytkownik') || ': ' || v_excerpt,
      COALESCE(v_actor, 'A member') || ': ' || v_excerpt,
      '/author/' || public.notification_profile_ref(NEW.recipient_id)
        || '#r-' || NEW.id::text || '-published',
      'Quote'
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_recommendation_notify() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_recommendation_notify() IS
  'Producent powiadomień rekomendacji profilowych: nowa/zaktualizowana treść -> odbiorca (moderacja), publikacja -> autor. Odrzucenie i ukrycie są ciche.';

DROP TRIGGER IF EXISTS profile_recommendations_notify_insert ON public.profile_recommendations;
CREATE TRIGGER profile_recommendations_notify_insert
  AFTER INSERT ON public.profile_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.tg_recommendation_notify();

DROP TRIGGER IF EXISTS profile_recommendations_notify_update ON public.profile_recommendations;
CREATE TRIGGER profile_recommendations_notify_update
  AFTER UPDATE ON public.profile_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.tg_recommendation_notify();

CREATE OR REPLACE FUNCTION public.tg_endorsement_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_endorser text;
  v_skill    text;
BEGIN
  v_endorser := public.notification_actor_name(NEW.endorser_id);
  SELECT NULLIF(left(btrim(s.label), 80), '') INTO v_skill
    FROM public.profile_skills s WHERE s.id = NEW.skill_id;

  PERFORM public.enqueue_notification(
    NEW.recipient_id, 'endorsement',
    'Nowe poparcie umiejętności',
    'New skill endorsement',
    COALESCE(v_endorser, 'Użytkownik') || ': ' || COALESCE(v_skill, 'umiejętność'),
    COALESCE(v_endorser, 'A member') || ': ' || COALESCE(v_skill, 'a skill'),
    '/author/' || public.notification_profile_ref(NEW.recipient_id)
      || '#e-' || NEW.id::text,
    'ThumbsUp'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_endorsement_notify() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_endorsement_notify() IS
  'Producent powiadomień o poparciu umiejętności: INSERT -> właściciel umiejętności (z nazwą umiejętności w treści).';

DROP TRIGGER IF EXISTS profile_skill_endorsements_notify_insert ON public.profile_skill_endorsements;
CREATE TRIGGER profile_skill_endorsements_notify_insert
  AFTER INSERT ON public.profile_skill_endorsements
  FOR EACH ROW EXECUTE FUNCTION public.tg_endorsement_notify();

CREATE OR REPLACE FUNCTION public.tg_profile_view_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_identified boolean := (NEW.viewer_mode = 'public' AND NEW.viewer_id IS NOT NULL);
  v_name_pl text;
  v_name_en text;
  v_href    text;
BEGIN
  IF NEW.viewer_id IS NOT NULL AND NEW.viewer_id = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  IF v_identified THEN
    v_name_pl := COALESCE(
      NULLIF(btrim(NEW.viewer_snapshot->>'display_name'), ''),
      public.notification_actor_name(NEW.viewer_id),
      'Użytkownik');
    v_name_en := v_name_pl;
    v_href := '/profile?tab=activity#pv-' || NEW.viewer_id::text;
  ELSE
    v_name_pl := 'Użytkownik anonimowy';
    v_name_en := 'An anonymous member';
    v_href := '/profile?tab=activity#pv-anon';
  END IF;

  PERFORM public.enqueue_notification(
    NEW.profile_id, 'profile_view',
    'Nowe wyświetlenie profilu',
    'New profile view',
    v_name_pl || ' - wyświetlenie Twojego profilu',
    v_name_en || ' viewed your profile',
    v_href,
    'Eye'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_profile_view_notify() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_profile_view_notify() IS
  'Producent powiadomień Kto oglądał Twój profil: INSERT -> właściciel profilu. Tożsamość widza wyłącznie w trybie public.';

DROP TRIGGER IF EXISTS profile_view_events_notify_insert ON public.profile_view_events;
CREATE TRIGGER profile_view_events_notify_insert
  AFTER INSERT ON public.profile_view_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_view_notify();

CREATE OR REPLACE FUNCTION public.tg_meeting_booking_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_slot      public.meeting_slots%ROWTYPE;
  v_when      text;
  v_place     text := '';
  v_attendee  text;
  v_host      text;
  v_href      text;
  v_cancelled boolean := false;
BEGIN
  SELECT * INTO v_slot FROM public.meeting_slots WHERE id = NEW.slot_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    v_cancelled := NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled';
  END IF;

  v_when := to_char(v_slot.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI');
  IF NULLIF(btrim(COALESCE(v_slot.location, '')), '') IS NOT NULL THEN
    v_place := ', ' || left(btrim(v_slot.location), 100);
  END IF;

  v_attendee := COALESCE(public.notification_actor_name(NEW.attendee_user_id), 'Użytkownik');
  v_host     := COALESCE(public.notification_actor_name(v_slot.host_user_id), 'Host');
  v_href := '/profile?tab=activity#m-' || NEW.slot_id::text;

  IF TG_OP = 'INSERT' AND NEW.status = 'confirmed' THEN
    PERFORM public.enqueue_notification(
      v_slot.host_user_id, 'meeting_booking',
      'Nowa rezerwacja spotkania 1-1',
      'New 1-1 meeting booking',
      v_attendee || ', ' || v_when || v_place,
      v_attendee || ', ' || v_when || ' (Warsaw time)' || v_place,
      v_href || '-booked',
      'CalendarClock'
    );
    PERFORM public.enqueue_notification(
      NEW.attendee_user_id, 'meeting_booking',
      'Rezerwacja spotkania potwierdzona',
      'Your meeting booking is confirmed',
      v_host || ', ' || v_when || v_place,
      v_host || ', ' || v_when || ' (Warsaw time)' || v_place,
      v_href || '-confirmed',
      'CalendarCheck'
    );
    RETURN NEW;
  END IF;

  IF v_cancelled THEN
    PERFORM public.enqueue_notification(
      v_slot.host_user_id, 'meeting_booking',
      'Rezerwacja spotkania anulowana',
      'A meeting booking was cancelled',
      v_attendee || ', ' || v_when || v_place,
      v_attendee || ', ' || v_when || ' (Warsaw time)' || v_place,
      v_href || '-cancelled',
      'CalendarX'
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_meeting_booking_notify() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_meeting_booking_notify() IS
  'Producent powiadomień spotkań 1-1: rezerwacja -> host + potwierdzenie dla rezerwującego, anulowanie -> host.';

DROP TRIGGER IF EXISTS meeting_bookings_notify_insert ON public.meeting_bookings;
CREATE TRIGGER meeting_bookings_notify_insert
  AFTER INSERT ON public.meeting_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_meeting_booking_notify();

DROP TRIGGER IF EXISTS meeting_bookings_notify_status ON public.meeting_bookings;
CREATE TRIGGER meeting_bookings_notify_status
  AFTER UPDATE OF status ON public.meeting_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_meeting_booking_notify();

CREATE OR REPLACE FUNCTION public.book_meeting_slot(p_slot_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_slot public.meeting_slots%ROWTYPE;
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

  RETURN jsonb_build_object('slot_id', p_slot_id, 'status', 'confirmed');
END;
$function$;

COMMENT ON FUNCTION public.book_meeting_slot(uuid, text) IS
  'Rezerwacja slotu 1-1 pod blokadą wiersza (bez wyścigu). Powiadomienia kolejkuje trigger tg_meeting_booking_notify pod rodzajem meeting_booking - nie ta funkcja.';