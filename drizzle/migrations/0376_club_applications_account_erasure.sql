-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y1, 1/8): RODO - ZGŁOSZENIA DO KLUBÓW PO
-- USUNIĘCIU KONTA (Z-I9c-01). Decyzja właściciela 2026-10-20 („optymalne
-- rozwiązanie wybierz"): anonimizacja zgłoszenia, nie kasowanie.
--
-- Znaczniki niżej są DYREKTYWAMI harnessów (wzór 20261020160900):
-- `pg-harness` - migracja dotyka `public.club_applications` razem z CMS,
-- CRM, wydarzeniami, kolejką i rekrutacją (pełne ciało modułów RODO), których
-- atrapa harnessu klubów nie ma; `careers-harness` - jedna wzmianka
-- `public.career_application_events` (kolumna aktora w module RODO) wciąga
-- plik do harnessu kariery, który tych powierzchni celowo nie modeluje.
-- Pełny dowód - pgTAP na komplecie migracji (niżej).
-- pg-harness: exclude
-- careers-harness: exclude
--
-- DEFEKT
--   1. Z-I9c-01: zgłoszenie do klubu osoby, która usunęła konto, zostaje
--      z danymi zgłoszenia. Wyzwalacz BEFORE sprzed huba
--      (`anonymize_club_applications_for_user`) czyści część tekstów, ale
--      zostawia surowy `user_id` (bez klucza obcego), języki, dostępność,
--      powiązanie z kontaktem CRM i teksty błędów - a jego błąd przepada
--      w `EXCEPTION WHEN OTHERS THEN NULL`. Konta usunięte przed tą migracją
--      mają w zgłoszeniach uid, którego przegląd RODO nie redaguje (asercja
--      29 testu przeglądu trzyma kolumnę na liście wyjątków).
--
-- ZMIANA
--   A. `_club_applications_anonymize(ids, pseudonim)` - JEDNA lista kolumn
--      dla usunięcia konta i retencji (20261020161600): imię, nazwisko,
--      e-mail, telefon, firma, stanowisko, miasto, profil społecznościowy,
--      każdy tekst własny (doświadczenie, języki, motywacja, cele, wkład,
--      dostępność, źródło polecenia) i notatka komisji -> '' (NOT NULL bez
--      CHECK formatu); `crm_lead_id`, `crm_error`, `notify_error` -> NULL
--      (powiązanie z zachowanym kontaktem CRM i tekst błędu pozwalałyby
--      odtworzyć osobę); `user_id` -> pseudonim konta (UUID wersji 8, jeden
--      na konto - przy usunięciu ten sam co w lejku, szynie i audycie).
--      ZOSTAJĄ: klub, specjalizacja, status, daty (złożenia, decyzji),
--      warstwa (klucz, ranga), pola zgrubne (branża, staż, kraj, lata
--      doświadczenia), zgody (flagi), język formularza i statusy techniczne.
--      Status się nie zmienia, więc emiter zgłoszeń (`UPDATE OF status`)
--      milczy. Zgłoszenie z pseudonimem jest pomijane przy powtórce.
--   B. `_hub_account_erase_modules` (CIALO-Z niżej) - ten sam punkt
--      wywołania co Z-I9b-11 (sekcja 4: kolumny NOT NULL -> pseudonim);
--      nowego wyzwalacza nie ma.
--   C. `_hub_account_erase_orphans` (CIALO-Z niżej) - kandydaci także
--      z `club_applications.user_id`; wywołanie na końcu domyka zgłoszenia
--      kont usuniętych przed I9d (operacja nieodwracalna; tabela bez ruchu
--      masowego).
--   Funkcji `anonymize_club_applications_for_user` NIE zmieniamy (harness
--   klubów A35.7 przypina jej zachowanie); po tej migracji jest nadmiarowa.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020160900 (redefiniuje jego funkcje B i C).
-- Retencja zgłoszeń (20261020161600) woła A.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE; A, B i C
-- zmieniają wyłącznie zgłoszenia z uid konta (wersja 4) - pseudonim ma
-- wersję 8, druga runda domknięcia zwraca 0. Zero DDL.
-- DOWÓD: supabase/tests/hub_i9b_account_erasure_sweep_test.sql (zgłoszenie
-- usuwanej osoby: PII puste, zgrubne i decyzja zostają, pseudonim = lejek;
-- przegląd kolumn bez wyjątku dla `club_applications.user_id`; wstecz),
-- supabase/tests/hub_i9d_club_applications_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Jedna lista kolumn zgłoszenia do klubu.
-- ----------------------------------------------------------------------------
-- `p_surrogate` NULL = osobny, nowy pseudonim na każde konto z porcji
-- (retencja żywych kont); podany = ten sam pseudonim dla wszystkich wierszy
-- (usunięcie jednego konta). Wiersz z pseudonimem (wersja 8) jest już
-- zanonimizowany - pomijany.
CREATE OR REPLACE FUNCTION public._club_applications_anonymize(p_ids uuid[], p_surrogate uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;
  -- CTE z funkcją VOLATILE nie jest wklejana w zapytanie, więc pseudonim
  -- losuje się raz na konto, nie raz na wiersz.
  WITH accounts AS (
    SELECT DISTINCT a.user_id FROM public.club_applications a
     WHERE a.id = ANY (p_ids) AND substr(a.user_id::text, 15, 1) <> '8'
  ), pseudonyms AS MATERIALIZED (
    SELECT x.user_id, COALESCE(p_surrogate, public._hub_erasure_surrogate()) AS surrogate FROM accounts x
  )
  UPDATE public.club_applications a
     SET user_id = p.surrogate, first_name = '', last_name = '', email = '', phone = '', company = '',
         job_position = '', city = '', linkedin_url = '', expertise = '', languages = '', motivation = '',
         goals = '', contribution = '', availability = '', referral_source = '', admin_note = '',
         crm_lead_id = NULL, crm_error = NULL, notify_error = NULL
    FROM pseudonyms p
   WHERE a.id = ANY (p_ids) AND a.user_id = p.user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._club_applications_anonymize(uuid[], uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._club_applications_anonymize(uuid[], uuid) IS
  'Hub I9d (RODO, Z-I9c-01): anonimizacja zgłoszeń do klubów - dane kontaktowe i teksty własne puste, powiązanie CRM i błędy NULL, user_id -> pseudonim konta (wersja 8); klub, specjalizacja, status, daty, warstwa i pola zgrubne zostają. Wspólna dla usunięcia konta i retencji. Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- B) Moduły RODO po usunięciu konta - zgłoszenia do klubów w sekcji 4.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020160900
CREATE OR REPLACE FUNCTION public._hub_account_erase_modules(p_user_id uuid, p_surrogate uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid text := p_user_id::text;
  v_rows integer := 0;
  v_n integer;
  v_sub text;
  v_role text;
  v_claims text;
BEGIN
  IF p_user_id IS NULL OR p_surrogate IS NULL THEN
    RETURN 0;
  END IF;

  -- 1. Z-I9b-11. Decyzja o zgłoszeniu i zapisana kwota zostają; panel nie
  --    pokazuje autora (skrzynka zgłoszeń - tylko `reviewed_at`; kwota
  --    wpłaty - kolumna prywatna, klient jej nie czyta), więc NULL nie
  --    zmienia żadnego widoku.
  UPDATE public.club_applications a SET reviewed_by = NULL WHERE a.reviewed_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.event_registrations r SET paid_amount_recorded_by = NULL
   WHERE r.paid_amount_recorded_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  -- 2. Autor treści i konfiguracji: wiersz zostaje, autor - nie. Panele
  --    pokazują brak autora jak dotąd („-", „Nieznany autor"), bo profilu
  --    usuniętego konta i tak nie było.
  UPDATE public.builder_experiments x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.builder_global_widgets x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.builder_popups x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.builder_revisions x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.builder_template_revisions x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.content_revisions x SET author_id = NULL WHERE x.author_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  -- `pages.updated_at` przesuwa wyzwalacz `set_updated_at` (treść bez zmian).
  UPDATE public.pages x SET author_id = NULL WHERE x.author_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.post_changelog x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.post_layout_settings x SET updated_by = NULL WHERE x.updated_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.post_preview_tokens x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.post_sidebar_layouts x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.live_blog_entries x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.media_folders x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.redirects x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.legal_document_versions x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.site_design_tokens x SET updated_by = NULL WHERE x.updated_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  -- Migawka rewizji powstaje tylko przy zmianie `value` - zmiana autora jej
  -- nie tworzy, a rewizje sprzed usunięcia czyści następna instrukcja.
  UPDATE public.site_settings x SET updated_by = NULL WHERE x.updated_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.site_settings_revisions x SET changed_by = NULL WHERE x.changed_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.verification_domains x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.event_home_ads x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  -- 3. Konta, zgłoszenia, kontakt, rekrutacja, zadania.
  UPDATE public.profiles x SET verified_by = NULL WHERE x.verified_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  -- `user_invitations_pin_admin_columns_bu` przywraca `invited_by`
  -- i `auth_user_id` każdemu poza service_role i adminem, a usunięcie konta
  -- biegnie bez sesji (GoTrue) - bez tego zmiana przepadłaby po cichu. Na
  -- czas JEDNEJ instrukcji tożsamość żądania = service_role
  -- (`_set_request_identity`, lokalnie dla transakcji), potem wraca.
  v_sub := current_setting('request.jwt.claim.sub', true);
  v_role := current_setting('request.jwt.claim.role', true);
  v_claims := current_setting('request.jwt.claims', true);
  PERFORM public._set_request_identity(NULL, 'service_role', '{"role":"service_role"}');
  UPDATE public.user_invitations x
     SET invited_by = NULLIF(x.invited_by, p_user_id),
         auth_user_id = NULLIF(x.auth_user_id, p_user_id)
   WHERE x.invited_by = p_user_id OR x.auth_user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public._set_request_identity(v_sub, v_role, v_claims);
  v_rows := v_rows + v_n;
  UPDATE public.user_reports x SET resolved_by = NULL WHERE x.resolved_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.contact_messages x SET assigned_to = NULL WHERE x.assigned_to = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.career_application_events x SET actor_id = NULL WHERE x.actor_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.command_idempotency x SET actor_id = NULL WHERE x.actor_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.job_runner_runs x SET actor_id = NULL WHERE x.actor_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.conversations x SET last_message_sender = NULL WHERE x.last_message_sender = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  -- Dziennik webhooków operatora płatności: aplikacja woła tę redakcję przy
  -- zamknięciu konta (`accountClosure.server`, 20261013090100), ale
  -- usunięcie konta poza aplikacją (panel operatora bazy, CLI) ją omijało.
  -- Powtórka po aplikacji nie znajduje już wierszy konta.
  v_rows := v_rows + public.payment_webhook_events_redact_for_user(p_user_id);

  -- 4. Kolumna NOT NULL i dzienniki rozliczalności -> pseudonim konta (ten
  --    sam co w lejku, szynie i `audit_log`): zadanie importu i wpis zmiany
  --    ról zostają z „tym samym usuniętym" aktorem, członek jako cel
  --    moderacji klubu - tak samo. (`event_cfp_reviews.reviewer_id` wskazuje
  --    wiersz `event_cfp_reviewers`, nie konto - kaskada z konta.)
  UPDATE public.wp_import_jobs x SET actor_id = p_surrogate WHERE x.actor_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.role_audit_log x
     SET actor_id = CASE WHEN x.actor_id = p_user_id THEN p_surrogate ELSE x.actor_id END,
         target_user_id = CASE WHEN x.target_user_id = p_user_id THEN p_surrogate ELSE x.target_user_id END
   WHERE x.actor_id = p_user_id OR x.target_user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.club_moderation_log x SET target_id = p_surrogate
   WHERE x.target_type = 'member' AND x.target_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  -- ZMIANA I9d (Z-I9c-01): zgłoszenia do klubów usuwanego konta -
  --    anonimizacja, nie kasowanie. Dane kontaktowe i każdy tekst własny ->
  --    puste (kolumny NOT NULL), `user_id` -> ten sam pseudonim; klub,
  --    specjalizacja, status, daty decyzji, warstwa i pola zgrubne zostają
  --    (statystyki komisji i klubów). Wspólna lista kolumn z retencją
  --    (`_club_applications_anonymize`). Wyzwalacz BEFORE sprzed huba
  --    (`anonymize_club_applications_for_user`) czyści część tekstów, ale nie
  --    `user_id` - zgłoszenia konta znajdujemy więc dalej po uid.
  v_rows := v_rows + public._club_applications_anonymize(
    ARRAY(SELECT a.id FROM public.club_applications a WHERE a.user_id = p_user_id), p_surrogate);

  -- 5. Dane własne konta: bez konta nie mają celu ani podstawy - znikają
  --    (jak przy kaskadzie, której tym tabelom brakowało). Obserwacja
  --    USUWANEGO autora przez innych też (cel obserwacji nie istnieje).
  DELETE FROM public.user_bookmarks x WHERE x.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM public.user_read_later x WHERE x.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM public.user_notes x WHERE x.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM public.user_todos x WHERE x.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM public.saved_searches x WHERE x.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM public.saved_views x WHERE x.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM public.notification_push_queue x WHERE x.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM public.user_follows x
   WHERE x.user_id = p_user_id OR (x.target_type = 'author' AND x.target_id = p_user_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  -- Powiadomienia INNYCH osób o działaniu usuwanego konta (obserwacja,
  -- prośba, wiadomość) niosą w `meta` jego uid, a w tytule imię i odnośnik
  -- do profilu, którego już nie ma - znikają. Własne powiadomienia konta
  -- zabiera kaskada.
  DELETE FROM public.notifications x WHERE strpos(x.meta::text, v_uid) > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  -- Historia czytania zasila popularność treści i analitykę członków
  -- (liczenie po `user_id`): pseudonim liczy odczyty zamkniętych okresów
  -- dalej raz, bez osoby.
  UPDATE public.user_read_history x SET user_id = p_surrogate WHERE x.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public._hub_account_erase_modules(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._hub_account_erase_modules(uuid, uuid) IS
  'Hub I9c-X1 + I9d (RODO, Z-I9b-11, Z-I9c-01): autorzy i recenzenci w modułach spoza huba -> NULL, kolumny NOT NULL i dzienniki rozliczalności -> pseudonim konta, zgłoszenia do klubów zanonimizowane (pseudonim w user_id), dane własne konta usunięte, historia czytania -> pseudonim. Woła _hub_account_erase. Wewnętrzny: bez EXECUTE dla ról API.';


-- ----------------------------------------------------------------------------
-- C) Domknięcie wstecz - kandydaci także ze zgłoszeń do klubów.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020160900
CREATE OR REPLACE FUNCTION public._hub_account_erase_orphans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- uid kont GoTrue: UUID wersji 4. Pseudonim (wersja 8), stałe i NULL
  -- nie są kandydatami - dlatego powtórka zwraca 0.
  c_v4 constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  r record;
  v_rows integer := 0;
BEGIN
  FOR r IN
    -- Rzutowanie wyłącznie pod CASE: kolejność warunków WHERE nie jest
    -- gwarantowana, a ładunki niosą też napisy niebędące UUID.
    SELECT CASE WHEN lower(c.u) ~ c_v4 THEN c.u::uuid END AS u
      FROM (
        SELECT ph.user_id::text AS u FROM public.paywall_hits ph
        UNION SELECT l.user_id::text FROM public.metering_event_log l
        UNION SELECT l.user_id::text FROM public.crm_leads l
        UNION SELECT s.user_id::text FROM public.newsletter_subscribers s
        UNION SELECT h.actor_id::text FROM public.crm_lead_stage_history h
        UNION SELECT e.user_id::text FROM public.journey_enrollments e
        UNION SELECT e.trigger_snapshot ->> 'actor_id' FROM public.journey_enrollments e
        UNION SELECT e.trigger_snapshot -> 'payload' ->> 'user_id' FROM public.journey_enrollments e
        UNION SELECT e.actor_id::text FROM public.domain_events e
        UNION SELECT e.payload ->> 'user_id' FROM public.domain_events e
        UNION SELECT e.payload ->> 'member_user_id' FROM public.domain_events e
        UNION SELECT e.aggregate_id FROM public.domain_events e
         WHERE e.aggregate_type IN ('account', 'paywall', 'metering')
        UNION SELECT i.actor_id::text FROM public.journey_event_inbox i
        UNION SELECT i.payload ->> 'user_id' FROM public.journey_event_inbox i
        UNION SELECT d.payload -> 'payload' ->> 'user_id' FROM public.integration_deliveries d
        UNION SELECT a.actor_id::text FROM public.audit_log a
        UNION SELECT a.metadata ->> 'user_id' FROM public.audit_log a
        UNION SELECT j.created_by::text FROM public.journey_definitions j
        UNION SELECT j.updated_by::text FROM public.journey_definitions j
        UNION SELECT v.published_by::text FROM public.journey_versions v
        UNION SELECT s.updated_by::text FROM public.journey_settings s
        UNION SELECT s.default_task_assignee_id::text FROM public.journey_settings s
        UNION SELECT m.updated_by::text FROM public.revenue_manual_inputs m
        UNION SELECT z.created_by::text FROM public.revenue_diagnostic_snoozes z
        UNION SELECT ns.updated_by::text FROM public.newsletter_settings ns
        UNION SELECT w.created_by::text FROM public.workflow_definitions w
        UNION SELECT cn.author_id::text FROM public.crm_lead_notes cn
        UNION SELECT ie.created_by::text FROM public.integration_endpoints ie
        UNION SELECT x.created_by::text FROM public.cross_references x
        -- ZMIANA I9c-X1: kolumny B (moduły spoza huba).
        UNION SELECT l.owner_id::text FROM public.crm_leads l
        UNION SELECT x.reviewed_by::text FROM public.club_applications x
        -- ZMIANA I9d (Z-I9c-01): zgłoszenie do klubu konta usuniętego wcześniej.
        UNION SELECT x.user_id::text FROM public.club_applications x
        UNION SELECT x.paid_amount_recorded_by::text FROM public.event_registrations x
        UNION SELECT x.created_by::text FROM public.builder_experiments x
        UNION SELECT x.created_by::text FROM public.builder_global_widgets x
        UNION SELECT x.created_by::text FROM public.builder_popups x
        UNION SELECT x.created_by::text FROM public.builder_revisions x
        UNION SELECT x.created_by::text FROM public.builder_template_revisions x
        UNION SELECT x.author_id::text FROM public.content_revisions x
        UNION SELECT x.author_id::text FROM public.pages x
        UNION SELECT x.created_by::text FROM public.post_changelog x
        UNION SELECT x.updated_by::text FROM public.post_layout_settings x
        UNION SELECT x.created_by::text FROM public.post_preview_tokens x
        UNION SELECT x.created_by::text FROM public.post_sidebar_layouts x
        UNION SELECT x.created_by::text FROM public.live_blog_entries x
        UNION SELECT x.created_by::text FROM public.media_folders x
        UNION SELECT x.created_by::text FROM public.redirects x
        UNION SELECT x.created_by::text FROM public.legal_document_versions x
        UNION SELECT x.updated_by::text FROM public.site_design_tokens x
        UNION SELECT x.updated_by::text FROM public.site_settings x
        UNION SELECT x.changed_by::text FROM public.site_settings_revisions x
        UNION SELECT x.created_by::text FROM public.verification_domains x
        UNION SELECT x.created_by::text FROM public.event_home_ads x
        UNION SELECT x.verified_by::text FROM public.profiles x
        UNION SELECT x.invited_by::text FROM public.user_invitations x
        UNION SELECT x.auth_user_id::text FROM public.user_invitations x
        UNION SELECT x.resolved_by::text FROM public.user_reports x
        UNION SELECT x.assigned_to::text FROM public.contact_messages x
        UNION SELECT x.actor_id::text FROM public.career_application_events x
        UNION SELECT x.actor_id::text FROM public.command_idempotency x
        UNION SELECT x.actor_id::text FROM public.job_runner_runs x
        UNION SELECT x.last_message_sender::text FROM public.conversations x
        UNION SELECT x.user_id::text FROM public.payment_webhook_events x
        UNION SELECT x.actor_id::text FROM public.wp_import_jobs x
        UNION SELECT x.actor_id::text FROM public.role_audit_log x
        UNION SELECT x.target_user_id::text FROM public.role_audit_log x
        UNION SELECT x.target_id::text FROM public.club_moderation_log x WHERE x.target_type = 'member'
        UNION SELECT x.user_id::text FROM public.user_bookmarks x
        UNION SELECT x.user_id::text FROM public.user_read_later x
        UNION SELECT x.user_id::text FROM public.user_notes x
        UNION SELECT x.user_id::text FROM public.user_todos x
        UNION SELECT x.user_id::text FROM public.saved_searches x
        UNION SELECT x.user_id::text FROM public.saved_views x
        UNION SELECT x.user_id::text FROM public.notification_push_queue x
        UNION SELECT x.user_id::text FROM public.user_follows x
        UNION SELECT x.target_id::text FROM public.user_follows x WHERE x.target_type = 'author'
        UNION SELECT x.user_id::text FROM public.user_read_history x
        UNION SELECT x.meta ->> 'actor_id' FROM public.notifications x
      ) c
     WHERE lower(c.u) ~ c_v4
       AND NOT EXISTS (
         SELECT 1 FROM auth.users au
          WHERE au.id = CASE WHEN lower(c.u) ~ c_v4 THEN c.u::uuid END)
  LOOP
    v_rows := v_rows + public._hub_account_erase(r.u, public._hub_erasure_surrogate(), NULL);
  END LOOP;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public._hub_account_erase_orphans() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._hub_account_erase_orphans() IS
  'Hub I9b-A2 + I9c-X1 + I9d (RODO): domknięcie wstecz - uid kont (UUID v4) nieistniejących w auth.users w kolumnach z przeglądu (hub, moduły spoza huba, zgłoszenia do klubów); dla każdego nowy pseudonim i _hub_account_erase; zwraca liczbę zmian (0 przy powtórce). Wewnętrzny: bez EXECUTE dla ról API.';

-- Konta usunięte przed I9d: zgłoszenia z uid bez konta -> anonimizacja (A).
SELECT public._hub_account_erase_orphans();
