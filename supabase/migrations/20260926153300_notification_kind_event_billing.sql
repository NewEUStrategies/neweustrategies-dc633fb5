-- ============================================================================
-- POWIADOMIENIA: RODZAJE `event` I `billing` + ACL LICZNIKA LIMITOW
-- (spec B.3.3, decyzje D0-3, S15, S30).
--
-- PO CO.
--   1. `billing`: zwrot pieniedzy i odrzucona wplata to sygnaly o pieniadzach
--      klienta. Dzis dzwonek rozliczen jest wstawiany z pominieciem producenta
--      albo pod rodzajem spoza katalogu - a `enqueue_notification` polyka
--      naruszenie CHECK-a (`EXCEPTION WHEN OTHERS`), wiec powiadomienie ginie
--      bez sladu. `billing` jest ZAWSZE doreczany (jak `security`): nie ma
--      przelacznika, bo uzytkownik nie moze zrezygnowac z informacji o wlasnych
--      pieniadzach (S15).
--   2. `event`: przypomnienia, oferty listy rezerwowej, przekazanie biletu,
--      certyfikat i ankieta. Pelny rytual rodzaju: katalog, kolumna
--      `notification_preferences.enabled_event` (DEFAULT true), galaz bramki
--      w producencie. Parytet katalog <-> kolumny <-> galezie <-> producenci
--      pilnuje `supabase/tests/notification_preferences_gating_test.sql`.
--   3. `rate_limit_hit`: `20260724221149` odtworzyl funkcje DROP + CREATE bez
--      ponownego GRANT-u, wiec wykonanie dostal z powrotem PUBLIC (a przez
--      domyslne uprawnienia Supabase takze anon/authenticated). Kazdy wolajacy
--      w SQL jest SECURITY DEFINER, kazdy wolajacy w TS uzywa `supabaseAdmin` -
--      bezposredni dostep klienta pozwalal tylko zapychac cudze kubelki (S30).
--
-- DLACZEGO TA MIGRACJA NIE WCHODZI DO HARNESSU WYDARZEN. Harness stawia
-- powierzchnie powiadomien jako ATRAPE (`scripts/events-harness/harness.sql`)
-- i sprawdza jej tozsamosc; zachowanie PRAWDZIWEJ funkcji jest dowodzone
-- w pgTAP. Dlatego ten plik nie niesie znacznika dolaczenia ani zadnego
-- napisu, po ktorym selektor harnessu dobiera migracje po tresci.
--
-- Kazda zmiana wzgledem `20260812091000` jest oznaczona `-- ZMIANA (PF-F): <slug>`
-- i ma nazwana asercje `PF-F ZMIANA <slug>` w pgTAP
-- (`event_participant_foundation_test.sql` / `notification_preferences_gating_test.sql`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Katalog rodzajow: 18 z 20260812091000 + `event` + `billing`
--
-- `NOT VALID` jak w 20260812091000: nowy CHECK jest nadrzedny wobec starego
-- (dodaje dwa rodzaje), wiec istniejace wiersze i tak go spelniaja, a walidacja
-- calej skrzynki nie blokuje tabeli przy wdrozeniu.
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;

-- ZMIANA (PF-F): kind-catalog - katalog rodzajow + 'event', 'billing'.
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search',
                  'crm_task','expert_request',
                  'introduction','recommendation','endorsement',
                  'profile_view','meeting_booking',
                  'club',
                  'event','billing'))
  NOT VALID;

-- ----------------------------------------------------------------------------
-- 2) Przelacznik rodzaju `event` (billing celowo BEZ kolumny - always-on)
-- ----------------------------------------------------------------------------
-- ZMIANA (PF-F): kind-event-column - przelacznik enabled_event, domyslnie wlaczony.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_event boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.enabled_event IS
  'Wydarzenia i przypomnienia (rodzaj event): przypomnienia o wydarzeniu i sesjach, oferty listy rezerwowej, przekazanie biletu, certyfikat, ankieta. Domyslnie wlaczone; pomijane w digescie.';

-- ----------------------------------------------------------------------------
-- 3) Producent: cialo z 20260812091000 + always-on `billing` + galaz `event`
-- LOCKS: notifications (INSERT) only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text, p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
-- ZMIANA (PF-F): enqueue-search-path - dopisany 'pg_temp' (A.6 R-SQL).
SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_tenant uuid; v_id uuid; v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN RETURN NULL; END IF;
  -- ZMIANA (PF-F): kind-always-on - `billing` doreczany zawsze, jak `security`
  -- (informacja o wlasnych pieniadzach nie ma przelacznika, S15).
  IF p_kind NOT IN ('security', 'billing') THEN
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
             -- ZMIANA (PF-F): kind-event-branch - galaz rodzaju event czyta enabled_event.
             WHEN 'event'           THEN np.enabled_event
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

-- ZMIANA (PF-F): enqueue-comment - komentarz producenta opisuje always-on security/billing.
COMMENT ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, text, text) IS
  'Wspolny producent powiadomien: bramka preferencji ODBIORCY (enabled_<rodzaj>), security i billing zawsze doreczane, tenant z profilu odbiorcy, deduplikacja 5 min po (user, kind, href), blad = NULL + WARNING (wywolanie z triggera nie wywraca transakcji).';

-- ZMIANA (PF-F): enqueue-acl - ACL potwierdzone: wylacznie serwerowy producent.
REVOKE ALL ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, text, text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Licznik limitow: wylacznie service_role (S30)
-- ----------------------------------------------------------------------------
-- ZMIANA (PF-F): rate-limit-acl - rate_limit_hit bez PUBLIC/anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, text, integer, integer) TO service_role;
