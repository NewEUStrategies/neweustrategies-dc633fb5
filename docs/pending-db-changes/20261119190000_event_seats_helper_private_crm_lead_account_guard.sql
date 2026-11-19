-- ============================================================================
-- DWIE POPRAWKI ZE SKANU BEZPIECZEŃSTWA (2026-11-19).
--
-- 1. `_event_page_seats_left(uuid, uuid)` - WEWNĘTRZNY POMOCNIK.
--    PRZYCZYNA: funkcja jest SECURITY DEFINER i miała EXECUTE dla `anon`
--    i `authenticated`. Wołający wybierał dowolny `_tenant`/`_event_id`
--    i dostawał liczbę wolnych miejsc wydarzenia bez sprawdzenia, czy
--    wydarzenie jest opublikowane albo dostępne dla jego progu członkostwa.
--    ZMIANA: EXECUTE tylko dla `service_role`. Jedynymi wołającymi są funkcje
--    z prawami właściciela (`event_page_header`, `event_seat_state`,
--    `events_public_list`, `event_bookmarks_mine`,
--    `_event_rsvp_claim_paid_seat`), które same sprawdzają publikację
--    i najemcę - wykonują się jako właściciel, więc odebranie EXECUTE rolom
--    sesji ich nie dotyka. Treść funkcji bez zmian.
--
-- 2. `crm_leads.user_id` - POWIĄZANIE LEADA Z KONTEM TYLKO Z BAZY.
--    PRZYCZYNA: karty leada (metering, członkostwo, profil/CV) czytają dane
--    członka rolą serwisową. Dotąd dopasowywały konto po `crm_leads.email`,
--    który staff edytuje - wpisanie cudzego adresu ujawniało dane dowolnego
--    członka. Serwer przechodzi na `crm_leads.user_id`, więc i ta kolumna nie
--    może być ustawiana z roli sesji.
--    ZMIANA: wyzwalacz BEFORE odrzuca (42501) ustawienie lub zmianę `user_id`,
--    gdy instrukcję wykonuje rola sesji (`anon`/`authenticated`). Wszyscy
--    obecni pisarze kolumny (`crm_upsert_lead_from_profile`, `crm_sync_member`,
--    backfill, wymazanie konta) to funkcje SECURITY DEFINER właściciela
--    i `service_role` - przechodzą bez zmian. Zapis innych kolumn leada przez
--    staff działa jak dotąd.
--
-- Idempotentne: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, REVOKE/GRANT.
-- ============================================================================

REVOKE ALL ON FUNCTION public._event_page_seats_left(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._event_page_seats_left(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_page_seats_left(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_crm_leads_user_id_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'crm_lead_user_id_managed'
        USING ERRCODE = '42501',
              DETAIL = 'crm_leads.user_id is linked by the database only.';
    ELSIF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'crm_lead_user_id_managed'
        USING ERRCODE = '42501',
              DETAIL = 'crm_leads.user_id is linked by the database only.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_crm_leads_user_id_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_crm_leads_user_id_guard() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_crm_leads_user_id_guard() TO service_role;

COMMENT ON FUNCTION public.tg_crm_leads_user_id_guard() IS
  'Straz crm_leads.user_id: rola sesji (anon/authenticated) nie ustawia ani nie zmienia powiazania leada z kontem - zapisuja je wylacznie funkcje bazy z prawami wlasciciela. Karty leada czytane rola serwisowa ufaja tylko temu powiazaniu, nie edytowalnemu e-mailowi.';

DROP TRIGGER IF EXISTS trg_crm_leads_000_user_id_guard ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_000_user_id_guard
  BEFORE INSERT OR UPDATE OF user_id ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_leads_user_id_guard();
