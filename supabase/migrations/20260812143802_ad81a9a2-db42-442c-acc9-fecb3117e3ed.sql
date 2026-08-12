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
  RAISE WARNING 'tg_introduction_notify: no delivery for request % (%): % [%]',
    NEW.id, TG_OP, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_introduction_notify() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_introduction_notify() IS
  'Producent powiadomień modułu „Wprowadzenia": INSERT -> most, forwarded -> proszący + osoba docelowa, withdrawn -> most. Odmowa mostu jest cicha (gwarancja network.introductions.bridgeHint). Href niesie rolę adresata i status, bo trasa /profile waliduje ?intro= białą listą.';

CREATE OR REPLACE FUNCTION public.tg_recommendation_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor       text;
  v_excerpt     text;
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
  RAISE WARNING 'tg_recommendation_notify: no delivery for recommendation % (%): % [%]',
    NEW.id, TG_OP, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_recommendation_notify() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_recommendation_notify() IS
  'Producent powiadomień rekomendacji profilowych: nowa/zaktualizowana treść -> odbiorca (moderacja), publikacja -> autor. Odrzucenie i ukrycie są ciche (parytet z list_recommendations). Href prowadzi na profil, na którym stoi tekst, z fragmentem #r-<id>-<status>.';

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
  RAISE WARNING 'tg_endorsement_notify: no delivery for endorsement %: % [%]',
    NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_endorsement_notify() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_endorsement_notify() IS
  'Producent powiadomień o poparciu umiejętności: INSERT -> właściciel umiejętności (z nazwą umiejętności w treści), href z id poparcia chroni serię poparć od dedupu.';

DROP TRIGGER IF EXISTS trg_introduction_notify   ON public.introduction_requests;
DROP TRIGGER IF EXISTS trg_recommendation_notify ON public.profile_recommendations;
DROP TRIGGER IF EXISTS trg_endorsement_notify    ON public.profile_skill_endorsements;

DROP TRIGGER IF EXISTS introduction_requests_notify_insert ON public.introduction_requests;
CREATE TRIGGER introduction_requests_notify_insert
  AFTER INSERT ON public.introduction_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_introduction_notify();

DROP TRIGGER IF EXISTS introduction_requests_notify_status ON public.introduction_requests;
CREATE TRIGGER introduction_requests_notify_status
  AFTER UPDATE OF status ON public.introduction_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_introduction_notify();

DROP TRIGGER IF EXISTS profile_recommendations_notify_insert ON public.profile_recommendations;
CREATE TRIGGER profile_recommendations_notify_insert
  AFTER INSERT ON public.profile_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.tg_recommendation_notify();

DROP TRIGGER IF EXISTS profile_recommendations_notify_update ON public.profile_recommendations;
CREATE TRIGGER profile_recommendations_notify_update
  AFTER UPDATE ON public.profile_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.tg_recommendation_notify();

DROP TRIGGER IF EXISTS profile_skill_endorsements_notify_insert ON public.profile_skill_endorsements;
CREATE TRIGGER profile_skill_endorsements_notify_insert
  AFTER INSERT ON public.profile_skill_endorsements
  FOR EACH ROW EXECUTE FUNCTION public.tg_endorsement_notify();