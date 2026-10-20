-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9b-A2, 3/3): RODO PO USUNIĘCIU KONTA - PEŁNY
-- PRZEGLĄD TABEL HUBA I MODUŁÓW, DO KTÓRYCH HUB PISZE; WYZWALACZ NA
-- `auth.users` I DOMKNIĘCIE WSTECZ. Polecenie właściciela 2026-10-20
-- („zastosuj" dla Z-I9b-03/04/05).
--
-- DEFEKT (przegląd kolumn uuid/text/jsonb po wszystkich migracjach - tabela
-- w dzienniku wdrożenia §21.9). Poza lejkiem (1/3) i szyną (2/3) po
-- usunięciu konta zostaje SUROWY uid (kolumny bez klucza obcego):
--   1. `crm_leads.user_id` (S4, 20261020130100) - powiązanie kontaktu CRM
--      z kontem; resolver ścieżek łączy po nim zdarzenia z leadem;
--   2. `newsletter_subscribers.user_id` - powiązanie subskrypcji z kontem;
--   3. `crm_lead_stage_history.actor_id` (S4) - autor zmiany etapu;
--   4. kolumny autora konfiguracji huba i modułów, do których hub pisze
--      (konto personelu): `journey_definitions.created_by/updated_by`,
--      `journey_versions.published_by`, `journey_settings.updated_by/
--      default_task_assignee_id`, `revenue_manual_inputs.updated_by`,
--      `revenue_diagnostic_snoozes.created_by` (NOT NULL - usunięcie konta
--      admina nie miało jak go wyzerować), `newsletter_settings.updated_by`
--      (S1), `workflow_definitions.created_by` (S4), `crm_lead_notes.author_id`
--      (CRM), `integration_endpoints.created_by` (router dostaw szyny),
--      `cross_references.created_by` (graf powiązań - krok automatyzacji S4
--      `add_cross_reference` i notatki CRM; krawędź do usuniętego konta
--      w `source_id`/`target_id` wskazuje byt, którego już nie ma);
--   5. `audit_log` (S1 dopisuje `membership.manual_grant/revoke`):
--      `metadata.user_id` osoby, której dotyczy nadanie, `entity_id`,
--      `actor_id` i `ip` autora.
--   Surowy uid jest kluczem do zachowanych dowodów księgowych
--   (`payment_orders.subject_ref` = SHA-256 ze stałego przedrostka i uid),
--   więc to nie jest „identyfikator bez osoby".
--
-- ZMIANA
--   A. `revenue_diagnostic_snoozes.created_by` NULL-owalne (wyciszenie
--      admina zostaje po usunięciu jego konta - decyzja nie znika z panelu).
--   B. `_hub_account_erase(uid, pseudonim, e-mail)` - JEDEN punkt wejścia:
--      lejek (1/3) i dziennik licznika -> pseudonim; `crm_leads.user_id`
--      -> NULL (zaufany pisarz, jak S4 - strażnik kolumn huba odrzuca klienta)
--      i zdarzenia `crm_lead.updated.v1`, które to odcięcie emituje, pomijane
--      w skrzynce ścieżek i dostawach (odcięcie nie jest zmianą kontaktu,
--      więc nie zapisuje go na ścieżkę ani nie wysyła do zewnętrznego CRM);
--      `newsletter_subscribers.user_id`, `crm_lead_stage_history.actor_id`
--      i kolumny autora konfiguracji -> NULL; `audit_log`: uid w `actor_id`,
--      `entity_id` i metadanych -> pseudonim, e-mail w metadanych ->
--      `[redacted]`, IP własnych działań osoby -> NULL (rozliczalność:
--      wpis zostaje, „ten sam usunięty aktor" też); szyna i ścieżki (2/3).
--   C. `tg_auth_users_hub_erasure` - AFTER DELETE ON auth.users. Kolejność:
--      wyzwalacze tego samego zdarzenia odpalają się alfabetycznie, a akcje
--      kluczy obcych (`RI_ConstraintTrigger_…`, wielka litera) idą przed
--      `on_auth_user_…` - kaskady (profil, subskrypcje, nadania) kończą się
--      PRZED redakcją, więc zdarzenia, które same emitują (np. zmiana statusu
--      usuwanej subskrypcji z `user_id`), też są redagowane. Żadna tabela
--      z przeglądu nie ma klucza obcego do `auth.users`, który kasowałby ją
--      wcześniej (A2 nie potrzebuje stanu sprzed usunięcia; `OLD.email`
--      jest w wierszu wyzwalacza). Wyzwalacze BEFORE (dowody księgowe
--      20260805090100, księga MRR 20261020160400) bez zmian. Błąd redakcji
--      PRZERYWA usunięcie (jak 160400) - konto nie znika bez anonimizacji.
--   D. Domknięcie wstecz `_hub_account_erase_orphans()`: uid wersji 4
--      (GoTrue) z kolumn z przeglądu, których nie ma w `auth.users`; dla
--      każdego - nowy pseudonim i B (bez e-maila - konta już nie ma).
--      Pseudonim ma wersję 8, NULL nie jest kandydatem, więc powtórka
--      zwraca 0.
--   WYJĄTKI (zostają z innej podstawy - opis w docs/RODO_REJESTR_CZYNNOSCI_
--   HUB_2026-10.md): kontakt CRM (`crm_leads` e-mail, imię, nazwisko) i jego
--   historia ścieżek, wysyłek i śledzenia - osobna czynność CRM, usuwa ją
--   admin w /admin/crm (kaskada); dowody księgowe (`payment_orders`,
--   `user_purchases`, `billing_documents`) - art. 74 ust. 2 uor,
--   anonimizowane wyzwalaczem 20260805090100; lista blokad poczty
--   (`email_suppressions`) i rejestr zgód (`crm_consent_log`) - dowód
--   respektowania sprzeciwu i zgody (art. 7 ust. 1, art. 21 RODO).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020160500 i 20261020160600 (B je woła), po
-- 20261020160400 (wyzwalacz BEFORE księgi MRR). Nocą: ALTER na
-- `revenue_diagnostic_snoozes` i wyzwalacz na gorącej `auth.users` przy
-- `lock_timeout` 5 s (55P03 = ponów plik); domknięcie D czyta całe tabele
-- z przeglądu raz na osierocone konto (≤ 90 dni szyny, jednorazowo).
-- IDEMPOTENTNA: ALTER COLUMN DROP NOT NULL (no-op przy powtórce), CREATE OR
-- REPLACE FUNCTION (nowe nazwy - bez CIALO-Z), DROP TRIGGER IF EXISTS +
-- CREATE, bezstanowe REVOKE; D wybiera wyłącznie uid kont nieistniejących
-- w wersji 4 - po redakcji ich nie ma, druga runda zwraca 0.
-- DOWÓD: supabase/tests/hub_i9b_account_erasure_sweep_test.sql (konto przez
-- prawdziwe RPC i wyzwalacze, usunięcie, GENERYCZNY skan kolumn uuid/text/
-- jsonb tabel z przeglądu z `information_schema` - uid, e-mail i
-- identyfikatory operatora wyłącznie na jawnej liście wyjątków; liczniki
-- lejka i Σ księgi zamkniętych okresów bez zmian; konto personelu;
-- domknięcie wstecz i druga runda 0; ACL).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Wyciszenie diagnozy bez autora.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';
ALTER TABLE public.revenue_diagnostic_snoozes ALTER COLUMN created_by DROP NOT NULL;
RESET lock_timeout;

COMMENT ON COLUMN public.revenue_diagnostic_snoozes.created_by IS
  'Autor wyciszenia; NULL po usunięciu konta autora (RODO, I9b-A2) - wyciszenie zostaje.';

-- ----------------------------------------------------------------------------
-- B) Jeden punkt wejścia redakcji konta.
-- ----------------------------------------------------------------------------
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

  -- Kontakt CRM: odcięcie od konta. Kolumnę huba zmienia wyłącznie zaufany
  -- pisarz (strażnik `trg_crm_leads_00_hub_guard`); flaga wraca do stanu
  -- sprzed wywołania, jak w `crm_upsert_lead_from_profile`.
  v_prev_trusted := current_setting('app.crm_trusted_writer', true);
  PERFORM set_config('app.crm_trusted_writer', 'on', true);
  WITH cut AS (
    UPDATE public.crm_leads l
       SET user_id = NULL
     WHERE l.user_id = p_user_id
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

  -- Szyna i ścieżki (2/3).
  v_rows := v_rows + public._journeys_erase_account(p_user_id, v_email);
  v_rows := v_rows + public._domain_events_erase_account(p_user_id, p_surrogate, v_email);

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public._hub_account_erase(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._hub_account_erase(uuid, uuid, text) IS
  'Hub I9b-A2 (RODO): jeden punkt wejścia redakcji usuniętego konta - lejek, CRM (user_id), newsletter, historia etapów, autorzy konfiguracji, dziennik audytu, ścieżki i szyna; zwraca liczbę zmian (0 przy powtórce). Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- C) Usunięcie konta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_auth_users_hub_erasure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Jeden pseudonim na konto, wylosowany tu i nigdzie niezapisany.
  PERFORM public._hub_account_erase(OLD.id, public._hub_erasure_surrogate(), OLD.email);
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_auth_users_hub_erasure() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_auth_users_hub_erasure() IS
  'Hub I9b-A2 (RODO Z-I9b-03/04): AFTER DELETE na auth.users - po kaskadach kluczy obcych redaguje lejek, szynę, ścieżki, CRM, newsletter, autorów konfiguracji i dziennik audytu jednym pseudonimem konta. Błąd przerywa usunięcie.';

SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS on_auth_user_deleted_redact_hub ON auth.users;
CREATE TRIGGER on_auth_user_deleted_redact_hub
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_auth_users_hub_erasure();
RESET lock_timeout;

-- ----------------------------------------------------------------------------
-- D) Domknięcie wstecz - konta usunięte przed tą migracją.
-- ----------------------------------------------------------------------------
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
  'Hub I9b-A2 (RODO): domknięcie wstecz - uid kont (UUID v4) nieistniejących w auth.users w kolumnach z przeglądu; dla każdego nowy pseudonim i _hub_account_erase; zwraca liczbę zmian (0 przy powtórce). Wewnętrzny: bez EXECUTE dla ról API.';

SELECT public._hub_account_erase_orphans();
