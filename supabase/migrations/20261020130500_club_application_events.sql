-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S4, 6/8): ZGŁOSZENIA DO KLUBÓW NA SZYNIE + CRM
-- ZGŁOSZENIA BEZ OBNIŻANIA SEGMENTU I BEZ ZAWYŻANIA LICZNIKA.
--
-- MIGRACJA KLUBOWA: pg-harness wciąga ją po treści (`public.club_`), więc
-- wszystko poniżej działa na atrapie CRM harnessu (scripts/pg-harness/
-- harness.sql) - bez `_crm_source_type_rank`, którego atrapa nie ma.
--
-- DEFEKT
--   1. Zgłoszenie do klubu i decyzja komisji nie mają zdarzenia: hub
--      (zakładka Społeczność: lejek zgłoszeń, czas decyzji), ścieżki S5
--      („potwierdź zgłoszenie", „po przyjęciu - powitanie") i druga karta
--      skrzynki nie wiedzą, że coś się stało.
--   2. D3 (brief 04): `club_application_crm_sync` ustawiał
--      `source_type = 'club_application'` bezwarunkowo - płacący klient
--      (`paid_subscriber`, ranga 90) spadał do zgłoszenia klubowego (70),
--      a segment CRM i lejek przestawały go widzieć jako klienta.
--   3. D4 (brief 04): każda synchronizacja podbijała
--      `club_application_count`, także ponowiona synchronizacja TEGO SAMEGO
--      zgłoszenia (przycisk „Synchronizuj ponownie" w skrzynce) - licznik
--      zgłoszeń leada rósł bez nowych zgłoszeń.
--
-- ZMIANA
--   A. `tg_club_applications_emit()` - AFTER INSERT OR UPDATE OF status:
--      `club_application.submitted.v1` przy zgłoszeniu (aktor = kandydat),
--      `club_application.decided.v1` przy przejściu do `accepted`/`rejected`
--      (aktor = osoba decydująca). Payload bez PII: `club_id`,
--      `application_id`, `user_id`, `specialization` (slug - tabela nie ma
--      identyfikatora specjalizacji), przy decyzji `status`. Zgłoszenie do
--      klubu TAJNEGO (`visibility = 'secret'`) NIE emituje - jak pozostałe
--      zdarzenia klubowe (sam fakt istnienia klubu jest poufny). Awaria
--      emisji nie przerywa zapisu zgłoszenia.
--   B. `club_application_crm_sync(uuid)` - jedyna definicja (przeciążenia
--      w bazie nie ma; drugie przeciążenie, o którym mówi plan, dotyczyło
--      `crm_upsert_from_form`) z ciała najnowszego (CIALO-Z niżej):
--        * segment WYŁĄCZNIE w górę rangi: `club_application` (70) nie
--          nadpisuje segmentów o randze >= 70 (`club_application`,
--          `careers`, `expert`, `paid_subscriber` - lustro
--          `_crm_source_type_rank` z 20260926090000, wpisane jawnie, bo atrapa
--          harnessu tej funkcji nie ma; zgodność pilnuje pgTAP);
--        * licznik zgłoszeń rośnie tylko dla zgłoszenia, które jeszcze NIE
--          było powiązane z tym leadem (`crm_lead_id`) - ponowiona
--          synchronizacja nie liczy go drugi raz.
--
-- KOLEJNOŚĆ WDROŻENIA: po I0 (`_log_emit_error` w gałęzi awarii emitera,
-- typy `club_application.*` w katalogu TS) i po 20261020130000 (strażnik CRM -
-- funkcja nie zmienia kolumn huba). Wyzwalacz na `club_applications`
-- (tabela bez ruchu masowego) - bez `lock_timeout`.
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP TRIGGER IF EXISTS + CREATE TRIGGER,
-- bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/club_application_events_test.sql (submitted/decided,
-- klub tajny bez zdarzenia, `paid_subscriber` zostaje, licznik bez zawyżania
-- przy ponowieniu, lustro rangi = `_crm_source_type_rank`);
-- `bun run check:pg-harness` (migracja kompiluje się i stosuje na atrapie).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Emiter zgłoszeń i decyzji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_club_applications_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type text;
BEGIN
  -- Klub tajny: brak zdarzenia (ani w szynie, ani w ścieżkach, ani w hubie).
  IF NEW.club_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.id = NEW.club_id AND c.visibility = 'secret'
  ) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_type := 'club_application.submitted.v1';
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_application', NEW.id::text, 'club_application.submitted.v1',
      jsonb_build_object(
        'club_id', NEW.club_id,
        'application_id', NEW.id,
        'user_id', NEW.user_id,
        'specialization', NEW.specialization_slug
      ),
      NEW.user_id
    );
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status IN ('accepted', 'rejected')
        AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_type := 'club_application.decided.v1';
    -- Aktor = osoba decydująca (auth.uid() z sesji panelu, NULL z serwera).
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_application', NEW.id::text, 'club_application.decided.v1',
      jsonb_build_object(
        'club_id', NEW.club_id,
        'application_id', NEW.id,
        'user_id', NEW.user_id,
        'specialization', NEW.specialization_slug,
        'status', NEW.status
      ),
      NULL
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_club_applications_emit', COALESCE(v_type, 'club_application.unknown'), SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_club_applications_emit() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_club_applications_emit ON public.club_applications;
CREATE TRIGGER trg_club_applications_emit
  AFTER INSERT OR UPDATE OF status ON public.club_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_applications_emit();

-- ----------------------------------------------------------------------------
-- B) Synchronizacja CRM zgłoszenia.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261007140710
CREATE OR REPLACE FUNCTION public.club_application_crm_sync(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  a public.club_applications%ROWTYPE;
  v_lead uuid;
BEGIN
  SELECT * INTO a FROM public.club_applications WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_lead := public.crm_upsert_from_form(
    a.tenant_id, lower(btrim(COALESCE(a.email, ''))),
    NULLIF(btrim(COALESCE(a.first_name, '')), ''),
    NULLIF(btrim(COALESCE(a.last_name, '')), ''),
    NULLIF(btrim(COALESCE(a.phone, '')), ''),
    NULLIF(btrim(COALESCE(a.company, '')), ''),
    NULLIF(btrim(COALESCE(a.job_position, '')), ''),
    NULLIF(btrim(COALESCE(a.linkedin_url, '')), ''),
    NULLIF(btrim(COALESCE(a.country, '')), ''),
    'club_application',
    '{}'::jsonb
  );

  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'crm_email_required';
  END IF;

  UPDATE public.crm_leads l
     -- D3: segment rośnie wyłącznie w górę rangi (`_crm_source_type_rank`:
     -- club_application = careers = expert = 70 < paid_subscriber = 90).
     SET source_type = CASE
           WHEN l.source_type IN ('club_application', 'careers', 'expert', 'paid_subscriber')
             THEN l.source_type
           ELSE 'club_application'
         END,
         marketing_consent = l.marketing_consent OR COALESCE(a.marketing_consent, false),
         club_applied_at = COALESCE(l.club_applied_at, COALESCE(a.created_at, now())),
         -- D4: zgłoszenie już powiązane z tym leadem (ponowiona synchronizacja)
         -- nie jest nowym zgłoszeniem.
         club_application_count = COALESCE(l.club_application_count, 0)
           + CASE WHEN a.crm_lead_id IS NOT DISTINCT FROM v_lead THEN 0 ELSE 1 END,
         club_specializations = (
           SELECT ARRAY(
             SELECT DISTINCT s
               FROM unnest(l.club_specializations || ARRAY[a.specialization_slug]) AS s
           )
         ),
         last_activity_at = now(),
         updated_at = now()
   WHERE l.id = v_lead;

  UPDATE public.club_applications
     SET crm_lead_id = v_lead,
         crm_sync_status = 'ok',
         crm_synced_at = now(),
         crm_last_attempt_at = now(),
         crm_error = NULL,
         updated_at = now()
   WHERE id = p_id;

  RETURN v_lead;
END;
$function$;

-- ACL jak dotąd (20260811151703): wyłącznie service_role; skrzynka i
-- formularz wołają ją z funkcji SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.club_application_crm_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_application_crm_sync(uuid) TO service_role;
