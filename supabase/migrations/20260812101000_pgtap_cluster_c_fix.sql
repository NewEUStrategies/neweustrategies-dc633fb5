-- ============================================================================
-- REGRES: WPROWADZENIA I REKOMENDACJE MAJĄ DWÓCH PRODUCENTÓW O ROZBIEŻNYM
-- KONTRAKCIE - PRZEŻYŁ TEN, KTÓRY SORTUJE SIĘ NA KOŃCU.
--
-- Ta sama klasa dryfu, którą 20260812091000 zamknęło dla spotkań 1-1, tylko
-- że tutaj rozjeżdża się nie NAZWA rodzaju, a TREŚĆ doręczenia: href, adresat
-- i lista przejść statusu, o których wolno mówić.
--
-- Trzy migracje z 07.08 dotykają tych samych producentów:
--   * 20260807073000 - projekt kanoniczny (href z rolą i statusem w
--     identyfikatorze, cicha odmowa mostu, wycofanie do mostu),
--   * 20260807082516 - ten sam kod ponownie (replay bez komentarzy),
--   * 20260807140000 - NIEZALEŻNA druga implementacja tych samych trzech
--     funkcji z innym href-em, innym zestawem przejść i własnymi triggerami
--     (`trg_introduction_notify`, `trg_recommendation_notify`,
--     `trg_endorsement_notify`) OBOK kanonicznych, których nie zdejmuje.
--
-- Stan końcowy schematu na HEAD i jego skutki:
--
--   1. PRYWATNOŚĆ. `tg_introduction_notify` doręcza proszącemu powiadomienie
--      przy przejściu na 'declined' ("<most> nie przekazał prośby o
--      wprowadzenie do <cel>"). Produkt obiecuje mostowi coś dokładnie
--      odwrotnego - `network.introductions.bridgeHint` (src/lib/i18n-network.ts)
--      stoi pod przyciskiem odmowy i mówi: „Odmowa jest cicha - osoba prosząca
--      nie zobaczy Twojej decyzji". Powiadomienie ujawnia i decyzję, i jej
--      autora, kanałem, który dociera sam (skrzynka + web push + digest).
--      To wyciek gwarancji, nie kosmetyka - i on jeden wystarcza, żeby
--      rozstrzygnąć, która implementacja ustępuje.
--
--   2. MARTWE LINKI. Trasa profilu waliduje `?intro=` białą listą
--      INTRO_BOXES = {bridge, requester, target} (src/routes/profile.index.tsx)
--      i czyta zakładkę z `?tab=activity`; fragment `#i-<id>-<status>` wskazuje
--      wiersz. Producent z 140000 wysyła `/profile?intro=<uuid>` oraz
--      `...&role=requester` - `intro=<uuid>` nie przechodzi walidacji i jest po
--      cichu odrzucany, `tab` nie ma wcale, więc powiadomienie ląduje na
--      zakładce „O mnie". To samo dotyczy rekomendacji (`/author/<slug>?rec=`
--      zamiast `#r-<id>-<status>`) i poparć (`/profile?skill=<uuid>` - `skill`
--      nie jest parametrem tej trasy).
--
--   3. LUKA W DORĘCZENIU. Przejście 'withdrawn' straciło producenta, więc most
--      dalej widzi w swojej kolejce prośbę, której proszący już nie chce -
--      wbrew komentarzowi kolumny `enabled_introduction` i kontraktowi
--      opisanemu w src/lib/notifications/preferences.ts („nowa prośba u mostu,
--      przekazanie u proszącego i osoby docelowej, wycofanie u mostu").
--
--   4. BRAK ŚLADU. Każde zdarzenie odpala producenta DWA razy (trigger
--      kanoniczny + `trg_*`). Drugie wywołanie wpada w 5-minutowy dedup po
--      (user, kind, href) i zwraca NULL, więc podwójne doręczenie nie było
--      widoczne w skrzynce - a rozjazd href-ów tak samo cicho zamieniał
--      powiadomienia w linki nikąd.
--
-- Kierunek ujednolicenia: 073000/082516. Rozstrzyga klient, jak w
-- 20260812091000 - to on nazywa producentów w dokumentacji przełączników, to
-- jego trasa rezolwuje href-y i to on wyświetla obietnicę cichej odmowy.
-- Warstwa 140000 nie ma po stronie klienta ANI JEDNEGO odpowiednika.
--
-- Helpery z 140000 (`nes_profile_label`, `nes_profile_href`) zostają bez
-- zmian: używa ich moduł spotkań (20260812091000).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) WPROWADZENIA: kontrakt href + trzy przejścia, o których wolno mówić
--
-- Ciało z 20260807073000. Jedna różnica: połknięty wyjątek zostawia wpis w
-- logu. Handler musi zostać (brak powiadomienia jest zły, ale utrata prośby o
-- wprowadzenie jest gorsza), natomiast NIEWIDOCZNY handler jest dokładnie tym,
-- co pozwoliło dwóm rozbieżnym implementacjom żyć obok siebie przez tydzień.
-- ----------------------------------------------------------------------------
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
    -- Adresatem prośby jest MOST - on jedyny może ją przekazać albo odrzucić.
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

  -- Trigger jest ograniczony do kolumny `status`, ale UPDATE ... SET status =
  -- status też by go odpalił - a to nie jest zdarzenie dla użytkownika.
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
    -- Osoba docelowa: JEDYNY moment, w którym wprowadzenie ma wartość.
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
    -- Wycofanie jest decyzją PROSZĄCEGO i nie ujawnia mostowi niczego, czego
    -- most już nie widzi w swojej kolejce - a bez sygnału rozstrzygałby prośbę,
    -- której nie ma. Proszący i osoba docelowa milczą.
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

  -- 'declined' NIE MA producenta i mieć nie może: pod przyciskiem odmowy stoi
  -- `network.introductions.bridgeHint` - „Odmowa jest cicha - osoba prosząca
  -- nie zobaczy Twojej decyzji".
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

-- ----------------------------------------------------------------------------
-- 2) REKOMENDACJE: moderacja u odbiorcy, publikacja u autora, reszta cicho
--
-- Ciało z 20260807073000. `write_recommendation` robi UPSERT, więc powrót do
-- 'pending' ze ZMIENIONĄ treścią jest nowym zdarzeniem moderacyjnym - dlatego
-- producent patrzy też na `body`, a jego trigger UPDATE nie może być zawężony
-- do kolumny `status`.
-- ----------------------------------------------------------------------------
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
  -- Treść bywa akapitem - w skrzynce ma być jedną linią.
  v_excerpt := left(btrim(COALESCE(NEW.body, '')), 140);

  -- OLD istnieje TYLKO przy UPDATE - rozstrzygamy to zanim go dotkniemy.
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

  -- 'declined' i 'hidden' bez producenta: `list_recommendations`
  -- (20260725090000) pokazuje autorowi odrzucony tekst jako „oczekujący"
  -- właśnie po to, żeby nie ujawniać decyzji moderacyjnej odbiorcy.
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

-- ----------------------------------------------------------------------------
-- 3) POPARCIA UMIEJĘTNOŚCI: href, który da się rozwiązać
--
-- Ciało z 20260807073000. `/profile?skill=<uuid>` z 140000 nie istnieje jako
-- parametr trasy profilu; poparcie stoi na profilu publicznym odbiorcy.
-- ----------------------------------------------------------------------------
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
    -- Fragment z id poparcia jest CZĘŚCIĄ MECHANIZMU: dedup chodzi po
    -- (user, kind, href), więc wspólny href zjadałby poparcia od różnych osób
    -- w tym samym oknie 5 minut.
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

-- ----------------------------------------------------------------------------
-- 4) JEDEN PRODUCENT NA TABELĘ
--
-- `trg_*` z 20260807140000 wołają te same funkcje co triggery kanoniczne, więc
-- każde zdarzenie przechodziło przez producenta dwukrotnie. Dedup to ukrywał,
-- ale zestaw zdarzeń NIE był ten sam: `trg_recommendation_notify` wisi na
-- UPDATE OF status, czyli powrót do moderacji po samej zmianie treści nie
-- odpalał go wcale.
-- ----------------------------------------------------------------------------
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

-- Bez `OF status`: powrót do moderacji wywołuje TAKŻE zmiana samej treści.
DROP TRIGGER IF EXISTS profile_recommendations_notify_update ON public.profile_recommendations;
CREATE TRIGGER profile_recommendations_notify_update
  AFTER UPDATE ON public.profile_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.tg_recommendation_notify();

DROP TRIGGER IF EXISTS profile_skill_endorsements_notify_insert ON public.profile_skill_endorsements;
CREATE TRIGGER profile_skill_endorsements_notify_insert
  AFTER INSERT ON public.profile_skill_endorsements
  FOR EACH ROW EXECUTE FUNCTION public.tg_endorsement_notify();
