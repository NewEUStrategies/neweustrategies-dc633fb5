-- ============================================================================
-- REGRES: POWIADOMIENIE O SPOTKANIU 1-1 ISTNIEJE POD DWIEMA NAZWAMI.
--
-- Migracje 20260807073000 i 20260807082516 wprowadziły rodzaj
-- `meeting_booking`: kolumnę `enabled_meeting_booking`, gałąź w bramce
-- `enqueue_notification`, producenta `tg_meeting_booking_notify` (host +
-- rezerwujący + anulowanie) i USUNĘŁY kolejkowanie z `book_meeting_slot`,
-- żeby host nie dostawał dwóch powiadomień o jednym zdarzeniu.
--
-- Leksykograficznie PÓŹNIEJSZE 20260807140000 -> 20260807162222 ->
-- 20260807174235 -> 20260808094000 odtwarzały ten sam katalog i tę samą
-- funkcję z gałęzią `meeting` (kolumna `enabled_meeting`) oraz ponownie
-- wstawiły kolejkowanie do trzech RPC. Stan końcowy schematu:
--
--   * `tg_meeting_booking_notify` kolejkuje 'meeting_booking' -> bramka wpada
--     w `ELSE true`, INSERT łamie `notifications_kind_check`, a
--     `EXCEPTION WHEN OTHERS THEN RETURN NULL` połyka błąd BEZ ŚLADU.
--     Potwierdzenie dla rezerwującego nie ma drugiego producenta, więc ginie
--     w całości.
--   * `book_meeting_slot` / `cancel_my_meeting_booking` kolejkują 'meeting'
--     bramkowane kolumną `enabled_meeting`, do której nic nie pisze - klient
--     zna WYŁĄCZNIE `enabled_meeting_booking` (src/lib/notifications/
--     preferences.ts). Przełącznik jest martwy w obie strony, a rodzaj
--     'meeting' nie ma w skrzynce ani ikony, ani etykiety, ani sekcji digestu.
--   * `notification_preferences` niesie OBIE kolumny, więc asercja parytetu
--     katalog <-> przełączniki (notification_preferences_gating_test.sql)
--     jest czerwona na HEAD.
--
-- Kierunek ujednolicenia: `meeting_booking`. Tak nazywa się tabela
-- (`meeting_bookings`), RPC (`cancel_my_meeting_booking`), producent
-- (`tg_meeting_booking_notify`) i cała warstwa klienta. Alias 'meeting' nie
-- ma po stronie klienta ŻADNEGO odpowiednika - to on ustępuje.
--
-- Producentem zostaje trigger, jak zakładało 20260807073000: jako jedyny
-- powiadamia obie strony wymiany i reaguje na anulowanie zrobione dowolną
-- ścieżką (RPC, panel, zadanie tła). Kolejkowanie z `book_meeting_slot`
-- i `cancel_my_meeting_booking` znika, bo po naprawie katalogu host dostawałby
-- dwa powiadomienia o jednym zdarzeniu pod dwoma różnymi href-ami - dedup
-- chodzi po (user, kind, href), więc ich NIE sklei. `delete_my_meeting_slot`
-- kolejkuje dalej: usunięcie slotu kasuje rezerwację kaskadowo, a trigger nie
-- wisi na DELETE, więc rezerwujący nie miałby innego źródła sygnału.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Przełączniki: dwie kolumny scalone w tę, którą pisze klient
--
-- Scalamy koniunkcją, nie nadpisaniem: `enabled_meeting` powstało z
-- DEFAULT true i żadna ścieżka do niego nie pisała, ale jeśli jakikolwiek
-- backfill je ruszył, wyłączenie po którejkolwiek stronie zostaje wyłączeniem.
-- ----------------------------------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_meeting_booking boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'notification_preferences'
       AND column_name = 'enabled_meeting'
  ) THEN
    UPDATE public.notification_preferences
       SET enabled_meeting_booking = false
     WHERE NOT enabled_meeting;
    ALTER TABLE public.notification_preferences DROP COLUMN enabled_meeting;
  END IF;
END $$;

COMMENT ON COLUMN public.notification_preferences.enabled_meeting_booking IS
  'Spotkania 1-1 (producent: tg_meeting_booking_notify): rezerwacja u hosta, potwierdzenie u rezerwującego, anulowanie u hosta; dodatkowo usunięcie slotu u rezerwującego (delete_my_meeting_slot).';

-- ----------------------------------------------------------------------------
-- 2) Katalog rodzajów: 'meeting' -> 'meeting_booking' (18 rodzajów bez zmian)
--
-- Kolejność jest wymuszona: przepisanie wierszy MUSI stać między zdjęciem
-- starego CHECK-a i założeniem nowego. `NOT VALID` zwalnia z walidacji tylko
-- wiersze ISTNIEJĄCE - UPDATE przechodzi przez ograniczenie normalnie, więc
-- przy odwrotnej kolejności migracja pada na 23514 na własnych danych.
--
-- Wiersze 'meeting' doręczone przez RPC są prawdziwymi powiadomieniami
-- użytkownika: skrzynka nie może z nimi zostać, bo klient nie ma dla tego
-- rodzaju ani ikony, ani etykiety, ani filtra.
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;

UPDATE public.notifications SET kind = 'meeting_booking' WHERE kind = 'meeting';

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search',
                  'crm_task','expert_request',
                  'introduction','recommendation','endorsement',
                  'profile_view','meeting_booking',
                  'club'))
  NOT VALID;

-- ----------------------------------------------------------------------------
-- 3) Bramka preferencji: gałąź czyta kolumnę, którą pisze klient
--
-- Odtwarzamy CAŁĄ funkcję, tak jak każda migracja ruszająca katalog rodzajów.
-- Poza gałęzią spotkań zmienia się jedna rzecz: połknięcie wyjątku przestaje
-- być NIEWIDOCZNE. Kontrakt wołania z triggera zostaje bez zmian (wyjątek
-- przerwałby zapis użytkownika - komentarz, rezerwację, wiadomość), ale każde
-- pominięcie zostawia teraz wpis w logu z rodzajem i SQLSTATE. Ten dryf
-- przeżył pięć dni dokładnie dlatego, że złamany CHECK nie zostawiał śladu.
-- ----------------------------------------------------------------------------
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
             WHEN 'club'            THEN np.enabled_club
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
  -- Deduplikacja 5-minutowa: dwie odpowiedzi w tym samym wątku w ciągu minuty
  -- to jeden sygnał, nie dwa. Ta reguła istniała już wcześniej; nie ruszamy jej.
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
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_notification: dropped notification (kind=%, user=%): % [%]',
    p_kind, p_user_id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4) Producent jest JEDEN: trigger na meeting_bookings
--
-- Ciała RPC dokładnie z 20260807140000 MINUS blok `enqueue_notification`.
-- Trigger `meeting_bookings_notify_insert` / `_notify_status` (20260807082516)
-- zostaje bez zmian - już kolejkuje pod poprawnym rodzajem i to on ma pełne
-- pokrycie obu stron wymiany.
-- ----------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.cancel_my_meeting_booking(p_slot_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_updated integer;
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
  RETURN v_updated > 0;
END;
$function$;

COMMENT ON FUNCTION public.cancel_my_meeting_booking(uuid) IS
  'Anulowanie własnej rezerwacji (slot wraca do puli). Hosta powiadamia trigger tg_meeting_booking_notify na UPDATE OF status - nie ta funkcja.';

-- `delete_my_meeting_slot` kolejkuje dalej: kaskada zabiera wiersz rezerwacji,
-- a trigger nie wisi na DELETE, więc rezerwujący nie ma innego źródła sygnału.
-- Zmienia się tylko rodzaj - i kolejność zostaje: rezerwację czytamy PRZED
-- DELETE-em.
CREATE OR REPLACE FUNCTION public.delete_my_meeting_slot(p_slot_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $function$
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
        'meeting_booking',
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
$function$;
