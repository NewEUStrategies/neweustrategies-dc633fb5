-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9c-X1): RODO PO USUNIĘCIU KONTA - DOMKNIĘCIA PO A2:
-- KOLUMNY AUTORA I RECENZENTA W MODUŁACH SPOZA HUBA (Z-I9b-11) ORAZ POCZTA
-- W KOLEJCE. Polecenie właściciela 2026-10-20 („ok rozumiem, optymalizuj").
-- pg-harness: exclude
--
-- Znacznik wyżej jest DYREKTYWĄ dla scripts/pg-harness/run.sh: migracja
-- dotyka `public.club_applications` i `public.club_moderation_log` razem
-- z CRM, wydarzeniami, CMS i kolejką poczty, których atrapa harnessu klubów
-- nie ma - wciągnięta po treści wywróciłaby cały przebieg.
--
-- DEFEKT (przegląd `information_schema` po wszystkich migracjach: kolumny
-- uuid tabel `public` bez klucza obcego z ON DELETE SET NULL/CASCADE):
--   1. Z-I9b-11: po usunięciu konta PERSONELU jego uid zostaje
--      w `club_applications.reviewed_by` i `event_registrations.
--      paid_amount_recorded_by` - A2 (20261020160700) domknęła autorów
--      wyłącznie w tabelach huba i modułów, do których hub pisze.
--   2. Ta sama klasa w pozostałych modułach (autor, recenzent, aktor,
--      opiekun): kreator i CMS (`builder_*`, `content_revisions`, `pages`,
--      `post_*`, `live_blog_entries`, `media_folders`, `redirects`,
--      `legal_document_versions`, `site_design_tokens`, `site_settings`,
--      `site_settings_revisions`, `verification_domains`, `event_home_ads`),
--      konta i zgłoszenia (`profiles.verified_by`, `user_invitations`,
--      `user_reports.resolved_by`), CRM i kontakt (`crm_leads.owner_id`,
--      `contact_messages.assigned_to`), rekrutacja, zadania i import
--      (`career_application_events`, `command_idempotency`,
--      `job_runner_runs`, `wp_import_jobs`), dziennik ról (`role_audit_log`),
--      klub (`club_moderation_log` - członek jako cel moderacji), czat
--      (`conversations.last_message_sender`); dziennik webhooków operatora
--      płatności (`payment_webhook_events.user_id`) - redakcję
--      `payment_webhook_events_redact_for_user` woła tylko aplikacja przy
--      zamknięciu konta, usunięcie konta poza nią jej nie uruchamiało.
--   3. Dane własne konta bez klucza obcego (każde konto, także personelu):
--      zakładki, „przeczytaj później", notatki, zadania, zapisane
--      wyszukiwania i widoki, kolejka powiadomień push, obserwowani autorzy
--      (także obserwacje USUWANEGO autora przez innych), powiadomienia
--      innych osób o jego działaniu (uid w `meta`) i historia czytania.
--   4. Kolejka poczty (pgmq `transactional_emails`): mail ścieżki albo
--      digest wstawiony PRZED usunięciem konta wychodzi w najbliższym cyklu
--      drenu (TTL 60 min) - A2 kończy zapis na ścieżkę, ale wiadomość już
--      czekająca w kolejce o tym nie wie.
--
-- ZMIANA
--   A. `_hub_account_bound_email_labels()` - JEDNA lista etykiet poczty
--      związanej z kontem albo zapisem: `journey`, `journey_service`,
--      `journey_test`, `digest_daily`, `digest_weekly` (lustro TS:
--      `ACCOUNT_BOUND_EMAIL_LABELS`, parytet `accountBoundLabelsParity`).
--      Poczta transakcyjna (potwierdzenia, rozliczenia, bilety, autoryzacja)
--      i potwierdzenie newslettera (zgoda niezależna od konta) - poza listą.
--   B. `_hub_account_erase_modules(uid, pseudonim)` - pkt 1-3: autor ->
--      NULL (wiersz, decyzja i kwota zostają); kolumna NOT NULL i dzienniki
--      rozliczalności (import, dziennik ról, cel moderacji) ->
--      pseudonim konta z A2 (wiersz zostaje, „ten sam usunięty" da się
--      prześledzić, nikt nie powiąże go z osobą); dane własne -> usunięte;
--      historia czytania -> pseudonim (popularność treści i analityka
--      członków liczą konta przez `user_id` - NULL zgubiłby odczyty
--      zamkniętych okresów, jak lejek w A2); powiadomienia innych osób
--      o działaniu konta -> usunięte.
--   C. `_hub_account_erase_mail_queue(uid, e-mail)` - pkt 4, warstwa 1:
--      niewysłane wiadomości z listy A należące do konta (klucz idempotencji
--      `journey:<zapis konta>:…` albo `digest:<częstotliwość>:<uid>:…`)
--      znikają z kolejki (treść i adres razem z nimi); dziennik dostaje wpis
--      `suppressed` z powodem `cancelled:account_deleted`, a adres w każdym
--      wpisie tej wiadomości -> `[redacted]` (kolumna jest NOT NULL).
--      Zapisy na ścieżkę kontaktu CRM bez konta (A2: osobna czynność CRM)
--      i poczta transakcyjna zostają.
--   D. `email_queue_send_recheck(etykieta, klucz)` - pkt 4, warstwa 2 (dren
--      przed wysyłką, tylko service_role): dla etykiet z A zapis na ścieżkę
--      musi istnieć i nie być `exited`, ścieżka marketingowa - mieć zgodę
--      (`_journey_marketing_consent`), digest - konto i włączony digest tej
--      częstotliwości. Łapie też wypis w trakcie cyklu i wiadomość, której
--      warstwa 1 nie widziała (w locie u drenu).
--   E. `_hub_account_erase` (CIALO-Z: 20261020160700) - ten sam punkt
--      wejścia i ten sam wyzwalacz A2: C przed odcięciem CRM i wyjściem ze
--      ścieżek (potrzebuje zapisów konta), `crm_leads.owner_id` razem
--      z `user_id`, B przed redakcją szyny (zdarzenia emitowane przez
--      zmiany B też są redagowane). Nowego wyzwalacza nie ma.
--   F. `_hub_account_erase_orphans` (CIALO-Z: 20261020160700) - kandydaci
--      z kolumn B; wywołanie na końcu domyka konta usunięte przed I9c.
--   WYJĄTKI bez zmian (rejestr czynności): kontakt CRM, newsletter, rejestr
--   zgód, blokady poczty, dowody księgowe, wpis audytu z pseudonimem.
--   POZA ZAKRESEM (zgłoszenie Z-I9c-01 w dzienniku §21.20): zgłoszenie do
--   klubu osoby usuwającej konto (`club_applications.user_id`, NOT NULL,
--   z danymi zgłoszenia: imię, e-mail, motywacja) - usunięcie zgłoszenia
--   albo wyjątek jak kontakt CRM to decyzja administratora danych.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020160700 (redefiniuje jej funkcje) i po
-- module poczty (`email_send_log`, `enqueue_email`). Kod drenu (warstwa 2)
-- woła D - wdrożyć razem z frontem; stary dren bez D działa jak dotąd.
-- Zero DDL tabel. Domknięcie F czyta kolumny z przeglądu raz (nocą).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT; B, C
-- i F zmieniają wyłącznie wiersze z uid konta (wersja 4) - po redakcji uid
-- nie występuje, pseudonim ma wersję 8, druga runda F zwraca 0.
-- DOWÓD: supabase/tests/hub_i9b_account_erasure_sweep_test.sql (konta
-- admina i redaktora z wierszami w każdej kolumnie B; skan KAŻDEJ tabeli
-- `public` z `tenant_id` bez śladu poza wyjątkami z podstawą prawną;
-- wstecz), supabase/tests/hub_i9c_account_erasure_mail_queue_test.sql
-- (anulowanie ścieżki i digestu, transakcyjne i kontakt CRM bez konta
-- zostają, dren-recheck po wypisie i po usunięciu, ACL),
-- src/lib/email/__tests__/queueDrainAccountBound.test.ts.
--
-- HARNESS KARIERY: selektor `check:careers-harness` wciąga ten plik przez
-- jedną wzmiankę `public.career_application_events` (kolumna aktora), a reszta
-- migracji sięga do powierzchni, których ten harness celowo nie modeluje
-- (`paywall_hits`, szyna zdarzeń, ścieżki, CRM, kolejka poczty). Pominięcie
-- jest jawne i widoczne w logu (SKIP); pełny dowód - pgTAP na komplecie
-- migracji (hub_i9b_account_erasure_sweep_test, hub_i9c_*).
-- careers-harness: exclude
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Etykiety poczty związanej z kontem albo zapisem.
-- ----------------------------------------------------------------------------
-- Kolumna z 20260711100000, ktorej produkcja nie miala (dryf notifications.meta);
-- ponizsze funkcje czytaja ja przy usuwaniu konta. Idempotentnie.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public._hub_account_bound_email_labels()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY['journey', 'journey_service', 'journey_test', 'digest_daily', 'digest_weekly']::text[]
$$;

REVOKE ALL ON FUNCTION public._hub_account_bound_email_labels() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._hub_account_bound_email_labels() IS
  'Hub I9c-X1 (RODO): etykiety poczty związanej z kontem albo zapisem (ścieżki, digest) - anulowane w kolejce przy usunięciu konta i sprawdzane ponownie przez dren. Lustro TS: ACCOUNT_BOUND_EMAIL_LABELS. Wewnętrzny.';

-- ----------------------------------------------------------------------------
-- B) Autorzy, recenzenci i dane własne konta w modułach spoza huba.
-- ----------------------------------------------------------------------------
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
  'Hub I9c-X1 (RODO, Z-I9b-11): autorzy i recenzenci w modułach spoza huba -> NULL, kolumny NOT NULL i dzienniki rozliczalności -> pseudonim konta, dane własne konta usunięte, historia czytania -> pseudonim. Woła _hub_account_erase. Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- C) Poczta konta w kolejce - warstwa 1 (przy usunięciu).
-- ----------------------------------------------------------------------------
-- Kolejka pgmq dostępna WYŁĄCZNIE przez API rozszerzenia (read/delete), bez
-- nazw tabel `pgmq.q_*` (jak `email_dlq_prune`). `read` z czasem
-- niewidzialności 0 nie chowa żadnej wiadomości przed drenem; czytamy
-- dopiero wtedy, gdy dziennik ma wiadomość tej osoby w toku - zwykłe
-- usunięcie konta kolejki nie dotyka.
CREATE OR REPLACE FUNCTION public._hub_account_erase_mail_queue(p_user_id uuid, p_email text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_queue constant text := 'transactional_emails';
  -- Górna granica jednego odczytu. Kolejka po drenie (co minutę) jest
  -- płytka; wiadomość poza odczytem zatrzyma warstwa 2 (D).
  c_scan constant integer := 1000;
  c_reason constant text := 'cancelled:account_deleted';
  c_redacted constant text := '[redacted]';
  v_labels text[] := public._hub_account_bound_email_labels();
  v_uid text := p_user_id::text;
  v_email text := NULLIF(lower(btrim(p_email)), '');
  v_enrollments text[];
  v_addresses text[];
  v_pending text[];
  v_msg record;
  v_key text;
  v_label text;
  v_message_id text;
  v_cancelled text[] := ARRAY[]::text[];
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Zapisy KONTA (A2: tylko one kończą się z `account_deleted`; zapis
  -- kontaktu CRM bez konta to osobna czynność i jego poczta zostaje).
  SELECT COALESCE(array_agg(e.id::text), ARRAY[]::text[]) INTO v_enrollments
    FROM public.journey_enrollments e
   WHERE e.user_id = p_user_id;

  -- Adresy, na które kolejka mogła przyjąć pocztę konta: konto i kontakty
  -- CRM jego zapisów (mail ścieżki idzie na adres kontaktu).
  SELECT COALESCE(array_agg(DISTINCT x.a), ARRAY[]::text[]) INTO v_addresses
    FROM (
      SELECT v_email AS a
      UNION SELECT l.email_norm FROM public.crm_leads l WHERE l.user_id = p_user_id
      UNION SELECT l.email_norm
              FROM public.journey_enrollments e
              JOIN public.crm_leads l ON l.id = e.lead_id
             WHERE e.user_id = p_user_id
    ) x
   WHERE x.a IS NOT NULL;

  -- Wiadomości w toku wg dziennika: `pending` bez stanu końcowego. Okno
  -- tygodnia z zapasem nad TTL drenu (minuty), żeby stary wpis bez stanu
  -- końcowego nie budził odczytu kolejki przy każdym usunięciu.
  SELECT COALESCE(array_agg(DISTINCT s.message_id), ARRAY[]::text[]) INTO v_pending
    FROM public.email_send_log s
   WHERE s.status = 'pending'
     AND s.message_id IS NOT NULL
     AND s.template_name = ANY (v_labels)
     AND s.recipient_email = ANY (v_addresses)
     AND s.created_at > now() - interval '7 days'
     AND NOT EXISTS (
       SELECT 1 FROM public.email_send_log t
        WHERE t.message_id = s.message_id
          AND t.status IN ('sent', 'suppressed', 'dlq', 'bounced', 'complained'));
  IF cardinality(v_pending) = 0 OR to_regnamespace('pgmq') IS NULL THEN
    RETURN 0;
  END IF;

  BEGIN
    FOR v_msg IN SELECT q.msg_id, q.message FROM pgmq.read(c_queue, 0, c_scan) q LOOP
      CONTINUE WHEN jsonb_typeof(v_msg.message) IS DISTINCT FROM 'object';
      v_label := lower(COALESCE(v_msg.message ->> 'label', ''));
      v_key := COALESCE(v_msg.message ->> 'idempotency_key', '');
      v_message_id := v_msg.message ->> 'message_id';
      CONTINUE WHEN NOT (v_label = ANY (v_labels));
      -- Klucze producentów: runner ścieżek `journey:<zapis>:<węzeł>`,
      -- digest `digest:<częstotliwość>:<uid>:<dzień>`.
      CONTINUE WHEN NOT (
        (split_part(v_key, ':', 1) = 'journey' AND split_part(v_key, ':', 2) = ANY (v_enrollments))
        OR (split_part(v_key, ':', 1) = 'digest' AND split_part(v_key, ':', 3) = v_uid));
      PERFORM pgmq.delete(c_queue, v_msg.msg_id);
      IF v_message_id IS NOT NULL THEN
        v_cancelled := v_cancelled || v_message_id;
      END IF;
    END LOOP;
  EXCEPTION WHEN undefined_table OR undefined_function THEN
    -- Kolejki nie ma (nic do niej nie trafiło) - nie ma czego anulować.
    RETURN 0;
  END;

  IF cardinality(v_cancelled) = 0 THEN
    RETURN 0;
  END IF;

  -- Stan anulowania bez treści i bez adresu; najemca z wpisu `pending`.
  INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, error_message, tenant_id)
  SELECT DISTINCT ON (s.message_id) s.message_id, s.template_name, c_redacted, 'suppressed', c_reason, s.tenant_id
    FROM public.email_send_log s
   WHERE s.message_id = ANY (v_cancelled) AND s.status = 'pending'
   ORDER BY s.message_id, s.created_at;
  UPDATE public.email_send_log s SET recipient_email = c_redacted
   WHERE s.message_id = ANY (v_cancelled) AND s.recipient_email <> c_redacted;

  RETURN cardinality(v_cancelled);
END;
$$;

REVOKE ALL ON FUNCTION public._hub_account_erase_mail_queue(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._hub_account_erase_mail_queue(uuid, text) IS
  'Hub I9c-X1 (RODO): przy usunięciu konta usuwa z kolejki transactional_emails niewysłaną pocztę ścieżek zapisów konta i digest konta; dziennik: suppressed/cancelled:account_deleted, adres [redacted]. Poczta transakcyjna zostaje. Wewnętrzny.';

-- ----------------------------------------------------------------------------
-- D) Dren przed wysyłką - warstwa 2.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_queue_send_recheck(p_label text, p_idempotency_key text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_label text := lower(btrim(COALESCE(p_label, '')));
  v_key text := COALESCE(p_idempotency_key, '');
  v_id text;
  v_enr record;
  v_digest text;
  v_verdict text;
BEGIN
  -- Poczta spoza listy A: decyduje wyłącznie lista wykluczeń drenu.
  IF NOT (v_label = ANY (public._hub_account_bound_email_labels())) THEN
    RETURN 'ok';
  END IF;

  IF v_label IN ('journey', 'journey_service', 'journey_test') THEN
    v_id := lower(split_part(v_key, ':', 2));
    -- Klucz spoza konwencji runnera nie wskazuje zapisu - bez zgadywania.
    IF split_part(v_key, ':', 1) <> 'journey' OR v_id !~ c_uuid THEN
      RETURN 'ok';
    END IF;
    SELECT e.tenant_id, e.lead_id, e.status, e.exit_reason INTO v_enr
      FROM public.journey_enrollments e
     WHERE e.id = v_id::uuid;
    IF NOT FOUND THEN
      -- Kontakt usunięty przez admina (kaskada zapisów).
      RETURN 'skipped:enrollment_missing';
    END IF;
    IF v_enr.status = 'exited' THEN
      RETURN 'skipped:exited:' || COALESCE(v_enr.exit_reason, 'unknown');
    END IF;
    IF v_label = 'journey' THEN
      v_verdict := public._journey_marketing_consent(v_enr.tenant_id, v_enr.lead_id);
      IF v_verdict IS DISTINCT FROM 'ok' THEN
        RETURN 'skipped:' || COALESCE(v_verdict, 'no_consent');
      END IF;
    END IF;
    RETURN 'ok';
  END IF;

  -- Digest: `digest:<częstotliwość>:<uid>:<dzień>`.
  v_id := lower(split_part(v_key, ':', 3));
  IF split_part(v_key, ':', 1) <> 'digest' OR v_id !~ c_uuid THEN
    RETURN 'ok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_id::uuid) THEN
    RETURN 'skipped:account_deleted';
  END IF;
  SELECT np.email_digest INTO v_digest
    FROM public.notification_preferences np
   WHERE np.user_id = v_id::uuid;
  IF v_digest IS DISTINCT FROM split_part(v_key, ':', 2) THEN
    RETURN 'skipped:digest_disabled';
  END IF;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.email_queue_send_recheck(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue_send_recheck(text, text) TO service_role;

COMMENT ON FUNCTION public.email_queue_send_recheck(text, text) IS
  'Hub I9c-X1: dren poczty przed wysyłką wiadomości związanej z kontem albo zapisem - ok albo skipped:<powód> (zapis usunięty lub zakończony wyjściem, brak zgody marketingowej, konto usunięte, digest wyłączony). Tylko service_role (queueDrain.server.ts).';

-- ----------------------------------------------------------------------------
-- E) Jeden punkt wejścia redakcji konta - rozszerzenie.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020160700
CREATE OR REPLACE FUNCTION public._hub_account_erase(
  p_user_id uuid,
  p_surrogate uuid,
  p_email text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_skip constant text := 'skipped:account_deleted';
  v_uid text := p_user_id::text;
  v_email text := NULLIF(lower(btrim(p_email)), '');
  v_prev_trusted text;
  v_leads text[];
  v_rows integer := 0;
  v_n integer;
BEGIN
  IF p_user_id IS NULL OR p_surrogate IS NULL THEN
    RETURN 0;
  END IF;

  -- Lejek i dziennik licznika (1/3).
  v_rows := v_rows + public._funnel_erase_account(p_user_id, p_surrogate);

  -- ZMIANA I9c-X1: poczta konta w kolejce - PRZED odcięciem CRM i wyjściem ze
  -- ścieżek, bo rozpoznaje zapisy i kontakty konta po `user_id`.
  v_rows := v_rows + public._hub_account_erase_mail_queue(p_user_id, v_email);

  -- Kontakt CRM: odcięcie od konta. Kolumnę huba zmienia wyłącznie zaufany
  -- pisarz (strażnik `trg_crm_leads_00_hub_guard`); flaga wraca do stanu
  -- sprzed wywołania, jak w `crm_upsert_lead_from_profile`. ZMIANA I9c-X1:
  -- w tej samej instrukcji opiekun leada (`owner_id`, konto personelu).
  v_prev_trusted := current_setting('app.crm_trusted_writer', true);
  PERFORM set_config('app.crm_trusted_writer', 'on', true);
  WITH cut AS (
    UPDATE public.crm_leads l
       SET user_id = NULLIF(l.user_id, p_user_id),
           owner_id = NULLIF(l.owner_id, p_user_id)
     WHERE l.user_id = p_user_id OR l.owner_id = p_user_id
    RETURNING l.id::text AS id
  )
  SELECT COALESCE(array_agg(cut.id), ARRAY[]::text[]) INTO v_leads FROM cut;
  PERFORM set_config('app.crm_trusted_writer', COALESCE(v_prev_trusted, ''), true);
  v_rows := v_rows + cardinality(v_leads);

  -- Emiter leada zgłasza każdą zmianę wiersza jako `crm_lead.updated.v1`.
  -- Odcięcie konta nie jest zmianą kontaktu: ścieżka nie zapisuje leada,
  -- integracja nie wysyła go dalej (workflowy działają synchronicznie przy
  -- INSERT i nie wysyłają poczty do kontaktów - tylko powiadomienia personelu).
  IF cardinality(v_leads) > 0 THEN
    UPDATE public.journey_event_inbox i
       SET processed_at = now(), error = c_skip
     WHERE i.processed_at IS NULL
       AND i.event_type = 'crm_lead.updated.v1'
       AND i.aggregate_type = 'crm_lead'
       AND i.aggregate_id = ANY (v_leads)
       AND i.occurred_at = now();
    UPDATE public.integration_deliveries d
       SET status = 'dead', last_error = c_skip
      FROM public.domain_events e
     WHERE d.event_id = e.id
       AND d.status IN ('queued', 'failed')
       AND e.event_type = 'crm_lead.updated.v1'
       AND e.aggregate_type = 'crm_lead'
       AND e.aggregate_id = ANY (v_leads)
       AND e.created_at = now();
  END IF;

  UPDATE public.newsletter_subscribers s SET user_id = NULL WHERE s.user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  UPDATE public.crm_lead_stage_history h SET actor_id = NULL WHERE h.actor_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  -- Konto personelu: autor konfiguracji huba i modułów, do których hub
  -- pisze. Wiersze zostają (ścieżki, wersje, ustawienia, dane wejściowe,
  -- wyciszenia, ustawienia newslettera, automatyzacje, notatki CRM, punkty
  -- integracji, powiązania), autor - nie.
  UPDATE public.journey_definitions d
     SET created_by = NULLIF(d.created_by, p_user_id),
         updated_by = NULLIF(d.updated_by, p_user_id)
   WHERE d.created_by = p_user_id OR d.updated_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.journey_versions v SET published_by = NULL WHERE v.published_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.journey_settings s
     SET updated_by = NULLIF(s.updated_by, p_user_id),
         default_task_assignee_id = NULLIF(s.default_task_assignee_id, p_user_id)
   WHERE s.updated_by = p_user_id OR s.default_task_assignee_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.revenue_manual_inputs m SET updated_by = NULL WHERE m.updated_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.revenue_diagnostic_snoozes z SET created_by = NULL WHERE z.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.newsletter_settings ns SET updated_by = NULL WHERE ns.updated_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.workflow_definitions w SET created_by = NULL WHERE w.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.crm_lead_notes cn SET author_id = NULL WHERE cn.author_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.integration_endpoints ie SET created_by = NULL WHERE ie.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  UPDATE public.cross_references x SET created_by = NULL WHERE x.created_by = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  -- Krawędź grafu do konta, którego już nie ma, nic nie wiąże - znika.
  DELETE FROM public.cross_references x WHERE x.source_id = v_uid OR x.target_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  -- Dziennik audytu: wpis zostaje (rozliczalność, art. 5 ust. 2), osoba
  -- staje się pseudonimem - ten sam w każdym wpisie, więc „ten sam usunięty
  -- aktor/podmiot" da się dalej prześledzić. Metadane podmienione tekstowo
  -- (uid stoi pod różnymi kluczami modułów), e-mail -> `[redacted]`.
  UPDATE public.audit_log a
     SET actor_id = CASE WHEN a.actor_id = p_user_id THEN p_surrogate ELSE a.actor_id END,
         ip = CASE WHEN a.actor_id = p_user_id THEN NULL ELSE a.ip END,
         entity_id = CASE WHEN a.entity_id = p_user_id THEN p_surrogate ELSE a.entity_id END,
         metadata = CASE
           WHEN a.metadata IS NULL THEN NULL
           ELSE public._hub_erasure_text(replace(a.metadata::text, v_uid, p_surrogate::text),
                                         p_user_id, v_email)::jsonb
         END
   WHERE a.actor_id = p_user_id
      OR a.entity_id = p_user_id
      OR strpos(a.metadata::text, v_uid) > 0
      OR (v_email IS NOT NULL AND strpos(lower(a.metadata::text), v_email) > 0);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  -- ZMIANA I9c-X1: moduły spoza huba (Z-I9b-11) - PRZED redakcją szyny, żeby
  -- zdarzenia emitowane przez te zmiany też przeszły przez redakcję.
  v_rows := v_rows + public._hub_account_erase_modules(p_user_id, p_surrogate);

  -- Szyna i ścieżki (2/3).
  v_rows := v_rows + public._journeys_erase_account(p_user_id, v_email);
  v_rows := v_rows + public._domain_events_erase_account(p_user_id, p_surrogate, v_email);

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public._hub_account_erase(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._hub_account_erase(uuid, uuid, text) IS
  'Hub I9b-A2 + I9c-X1 (RODO): jeden punkt wejścia redakcji usuniętego konta - lejek, poczta konta w kolejce, CRM (user_id, owner_id), newsletter, historia etapów, autorzy konfiguracji, dziennik audytu, moduły spoza huba (autorzy, recenzenci, dane własne), ścieżki i szyna; zwraca liczbę zmian (0 przy powtórce). Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- F) Domknięcie wstecz - kandydaci z kolumn B.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020160700
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
  'Hub I9b-A2 + I9c-X1 (RODO): domknięcie wstecz - uid kont (UUID v4) nieistniejących w auth.users w kolumnach z przeglądu (hub i moduły spoza huba); dla każdego nowy pseudonim i _hub_account_erase; zwraca liczbę zmian (0 przy powtórce). Wewnętrzny: bez EXECUTE dla ról API.';

SELECT public._hub_account_erase_orphans();
