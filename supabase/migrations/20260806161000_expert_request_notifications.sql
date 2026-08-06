-- ============================================================================
-- POWIADOMIENIA O ZAPYTANIACH DO EKSPERTÓW.
--
-- FINDING. Cały moduł „Zapytanie do eksperta" nie miał ANI JEDNEGO producenta
-- powiadomień. Skutek dla obu stron:
--   * ekspert dowiadywał się o zapytaniu wyłącznie wtedy, gdy sam wszedł na
--     /messages?view=requests albo /profile/expert-requests - a zakładka
--     „Zapytania" w /messages jest UKRYTA, dopóki `list_my_*` nie zwróci
--     wiersza, więc pierwsze w życiu zapytanie było praktycznie niewidoczne;
--   * nadawca (płacący progiem Plus/Pro z policzalnej puli miesięcznej) nie
--     dostawał sygnału o przyjęciu, odpowiedzi ani odrzuceniu - zużył pulę i
--     musiał odpytywać ekran ręcznie.
-- Formalny, „poważny" kanał kontaktu z ekspertem był więc kanałem bez
-- doręczenia. Bramka progu, pula i moderacja działały; brakowało jedynej
-- rzeczy, która czyni je użytecznymi - zawiadomienia.
--
-- WDROŻENIE.
--   1) Nowy rodzaj powiadomień `expert_request` - PEŁNOPRAWNY obywatel
--      katalogu: kolumna `notification_preferences.enabled_expert_request`,
--      wpis w `notifications_kind_check`, gałąź w CASE bramkującym
--      `enqueue_notification`. Kontrakt strukturalny (katalog ⇄ kolumny ⇄ CASE)
--      pilnuje istniejący sweep w
--      supabase/tests/notification_preferences_gating_test.sql - rodzaj bez
--      gałęzi wpadłby w `ELSE true` i przeciekał mimo wyłączenia.
--   2) Trigger `tg_expert_request_notify` na tabeli zapytań:
--        INSERT                -> powiadomienie ODBIORCY o nowym zapytaniu,
--        UPDATE OF status      -> nadawcy o decyzji (przyjęte / odpowiedziane /
--                                 odrzucone), odbiorcy o wycofaniu przez nadawcę.
--      Dwujęzycznie (title_pl/title_en + body_pl/body_en), bo skrzynka renderuje
--      język czytelnika, nie autora zdarzenia.
--   3) `href` ZAWSZE zawiera id zapytania. To nie jest kosmetyka: producent
--      deduplikuje po `(user, kind, href)` w oknie 5 minut, więc wspólny href
--      zjadałby drugie zapytanie od innego nadawcy w tej samej minucie.
--      Po przyjęciu/odpowiedzi link prowadzi wprost do powstałej rozmowy.
--
-- Trigger wiesza się na relacji, która REALNIE istnieje: nazwa rozjechała się
-- między środowiskami (`expert_requests` po rebrandingu z 20260723180000,
-- `expert_inmails` na produkcji - patrz SUPERSEDED w scripts/check-db-contract.ts).
-- ============================================================================

-- ── 1) Katalog rodzajów ─────────────────────────────────────────────────────

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_expert_request boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.enabled_expert_request IS
  'Zapytania do ekspertów: nowe zapytanie (odbiorca) i decyzja eksperta (nadawca).';

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search',
                  'crm_task','expert_request'))
  NOT VALID;

-- Producent: dokładnie ciało z 20260721120000 + gałąź `expert_request`.
-- CREATE OR REPLACE zachowuje ACL nadane przez 20260803090000 (brak EXECUTE dla
-- ról klienckich) - świadomie nie nadajemy tu żadnych nowych uprawnień.
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

-- ── 2) Producent zdarzeń modułu ─────────────────────────────────────────────
--
-- SECURITY DEFINER, bo `enqueue_notification` nie ma grantu dla ról klienckich
-- (20260803090000), a trigger odpala się w sesji nadawcy/odbiorcy.
-- Wyjątek nigdy nie może wywrócić operacji biznesowej: brak powiadomienia jest
-- gorszy niż jego brak PLUS utrata zapytania, więc całość jest w EXCEPTION.

CREATE OR REPLACE FUNCTION public.tg_expert_request_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_subject  text;
  v_sender   text;
  v_expert   text;
  v_href     text;
BEGIN
  -- Temat bywa dowolnym tekstem użytkownika - w skrzynce ma być jedną linią.
  v_subject := left(btrim(COALESCE(NEW.subject, '')), 140);

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Użytkownik')
      INTO v_sender FROM public.profiles p WHERE p.id = NEW.sender_id;

    PERFORM public.enqueue_notification(
      NEW.recipient_id,
      'expert_request',
      'Nowe zapytanie do eksperta',
      'New expert request',
      COALESCE(v_sender, 'Użytkownik') || ': ' || v_subject,
      COALESCE(v_sender, 'A member') || ': ' || v_subject,
      '/profile/expert-requests?box=received&r=' || NEW.id::text,
      'HelpCircle'
    );
    RETURN NEW;
  END IF;

  -- UPDATE: reagujemy WYŁĄCZNIE na realną zmianę statusu (trigger jest
  -- ograniczony do kolumny `status`, ale UPDATE ... SET status = status też by
  -- go odpalił - a to nie jest zdarzenie dla użytkownika).
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Ekspert')
    INTO v_expert FROM public.profiles p WHERE p.id = NEW.recipient_id;

  -- Po przyjęciu/odpowiedzi rozmowa już istnieje - link prowadzi wprost do niej.
  --
  -- Fragment `#<status>` jest CZĘŚCIĄ MECHANIZMU, nie ozdobą: producent
  -- deduplikuje po (user, kind, href) w oknie 5 minut, a jeden wątek potrafi
  -- w tym oknie zmienić status dwa razy (przyjęte -> odpowiedziane, wysłane ->
  -- wycofane). Bez rozróżnienia drugie zdarzenie przepadałoby po cichu.
  -- Fragment nie trafia do zapytania HTTP i nie zmienia kontraktu parametrów
  -- (`validateExpertRequestsSearch`, `validateSearch` w /messages).
  v_href := CASE
    WHEN NEW.converted_conversation_id IS NOT NULL
      THEN '/messages?c=' || NEW.converted_conversation_id::text || '#' || NEW.status
    ELSE '/profile/expert-requests?box=sent&r=' || NEW.id::text || '#' || NEW.status
  END;

  IF NEW.status = 'approved' THEN
    PERFORM public.enqueue_notification(
      NEW.sender_id, 'expert_request',
      'Ekspert przyjął Twoje zapytanie',
      'Your expert request was accepted',
      COALESCE(v_expert, 'Ekspert') || ': ' || v_subject,
      COALESCE(v_expert, 'The expert') || ': ' || v_subject,
      v_href, 'CheckCircle2');

  ELSIF NEW.status = 'answered' THEN
    PERFORM public.enqueue_notification(
      NEW.sender_id, 'expert_request',
      'Ekspert odpowiedział na Twoje zapytanie',
      'The expert answered your request',
      COALESCE(v_expert, 'Ekspert') || ': ' || v_subject,
      COALESCE(v_expert, 'The expert') || ': ' || v_subject,
      v_href, 'MessagesSquare');

  ELSIF NEW.status = 'declined' THEN
    PERFORM public.enqueue_notification(
      NEW.sender_id, 'expert_request',
      'Ekspert odrzucił Twoje zapytanie',
      'Your expert request was declined',
      COALESCE(NULLIF(btrim(NEW.decline_reason), ''), v_subject),
      COALESCE(NULLIF(btrim(NEW.decline_reason), ''), v_subject),
      '/profile/expert-requests?box=sent&r=' || NEW.id::text || '#declined',
      'X');

  ELSIF NEW.status = 'cancelled' THEN
    -- Wycofanie jest decyzją NADAWCY - sygnał należy się odbiorcy, żeby nie
    -- odpowiadał na zapytanie, którego już nie ma.
    PERFORM public.enqueue_notification(
      NEW.recipient_id, 'expert_request',
      'Wycofano zapytanie do eksperta',
      'An expert request was withdrawn',
      v_subject, v_subject,
      '/profile/expert-requests?box=received&r=' || NEW.id::text || '#cancelled',
      'X');
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Doręczenie jest najlepszym staraniem; operacja biznesowa jest ważniejsza.
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_expert_request_notify() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_expert_request_notify() IS
  'Producent powiadomień modułu „Zapytanie do eksperta": INSERT -> odbiorca, zmiana statusu -> nadawca (przyjęte/odpowiedziane/odrzucone) albo odbiorca (wycofane). href zawsze z id zapytania, bo enqueue_notification deduplikuje po (user, kind, href).';

-- ── 3) Podpięcie triggera do realnie istniejącej relacji ────────────────────

DO $do$
DECLARE
  v_rel  regclass := COALESCE(to_regclass('public.expert_requests'),
                              to_regclass('public.expert_inmails'));
  v_name text;
BEGIN
  IF v_rel IS NULL THEN
    RAISE NOTICE 'expert requests: brak relacji - trigger powiadomień nie został podpięty';
    RETURN;
  END IF;
  SELECT c.relname INTO v_name FROM pg_class c WHERE c.oid = v_rel;

  EXECUTE format('DROP TRIGGER IF EXISTS expert_requests_notify_insert ON public.%I', v_name);
  EXECUTE format('DROP TRIGGER IF EXISTS expert_requests_notify_status ON public.%I', v_name);

  EXECUTE format($t$
    CREATE TRIGGER expert_requests_notify_insert
      AFTER INSERT ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.tg_expert_request_notify()
  $t$, v_name);

  EXECUTE format($t$
    CREATE TRIGGER expert_requests_notify_status
      AFTER UPDATE OF status ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.tg_expert_request_notify()
  $t$, v_name);
END
$do$;
