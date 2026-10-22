-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S5, 1/6): ŚCIEŻKI KOMUNIKACJI - TRASA ZDARZEŃ
-- SZYNY DO SKRZYNKI, ROZPOZNANIE KONTAKTU I ZAPIS NA ŚCIEŻKĘ.
--
-- DEFEKT
--   Tabele ścieżek z I0 (20261020090300) nie mają pisarza: żadne zdarzenie
--   szyny (`account.registered.v1`, `checkout.abandoned.v1`,
--   `metering.quota_exhausted.v1`…) nie dociera do silnika, więc opublikowana
--   ścieżka nikogo by nie zapisała. Bezpośrednie wykonywanie kroków
--   w wyzwalaczu szyny jest wykluczone: każdy INSERT do `domain_events`
--   (setki na minutę) płaciłby koszt ścieżek, a awaria kroku wywracałaby
--   transakcję płatności albo rejestracji.
--
-- ZMIANA
--   A. `tg_journey_route_event` - AFTER INSERT ON `domain_events`: JEDNO
--      zapytanie po kluczu głównym `journey_event_routes` (prefiks
--      tenant_id, event_type); gdy trasa jest, kopia zdarzenia trafia do
--      `journey_event_inbox` (`ON CONFLICT (event_id) DO NOTHING`). Agregaty
--      `journey` i `revenue_diagnostic` są pomijane (warunek WHEN wyzwalacza
--      i ciało funkcji) - zdarzenie ścieżki nie może zapisać na ścieżkę
--      (brak pętli). `pg_trigger_depth() < 3`: łańcuch wyzwalaczy głębszy
--      niż emiter -> szyna nie dokłada kolejnego poziomu. Każdy błąd ląduje
--      w `journey_engine_errors` (faza `route`) i NIE przerywa zapisu
--      zdarzenia - trasa jest telemetrią silnika, nie warunkiem płatności.
--      Ładunek w skrzynce bez imienia i nazwiska (redakcja szyny usuwa adres,
--      ale nie imię - skrzynka trzyma minimum potrzebne warunkom).
--   B. `journey_resolve_lead(p_inbox_id)` (service_role) - kontakt zdarzenia:
--      agregat `crm_lead` -> `payload.lead_id` -> konto (`user_id`,
--      `member_user_id`) -> osoba wydarzeń (`person_id`) -> subskrybent ->
--      aktor (tylko gdy ładunek nie niesie tożsamości, a aktor nie jest
--      personelem - decyzja admina nie zapisuje admina na ścieżkę). Klub
--      `secret` i zdarzenie bez tożsamości = brak kontaktu. Brak leada przy
--      znanym adresie = lead zakładany BEZ zgody (`crm_upsert_lead(…, false,
--      false)`) - zgodę daje wyłącznie dowód, nigdy silnik.
--   C. `journey_ingest_inbox(p_limit)` (service_role) - porcja skrzynki
--      (`FOR UPDATE SKIP LOCKED`, każde zdarzenie we własnej podtransakcji):
--      role tras `exit` (w tym globalny wypis z newslettera dla ścieżek
--      marketingowych - powód `unsubscribed`), `goal`, `wake` (czekanie
--      `until_event` z warunkiem zapisu) i `enroll` (`payload @> condition`,
--      ścieżka `active`, wersja = opublikowana, `occurred_at >= published_at`,
--      silnik najemcy WŁĄCZONY, filtr wejścia, polityka ponownego wejścia,
--      `INSERT … ON CONFLICT DO NOTHING`). Błąd zdarzenia = `attempts + 1`,
--      po 5 próbach zdarzenie zamknięte z błędem (bez zatrzymania kolejki).
--   D. `_journey_enroll` (wewnętrzna) - jedno miejsce zapisu na ścieżkę:
--      klucz idempotencji `enrollment_key` (`never` = lead, inaczej lead +
--      zdarzenie), `cooldown` liczony od ostatniego wejścia, filtr wejścia
--      przez `_journey_eval_predicate` (20261020140200).
--   Silnik wyłączony (`journey_settings.enabled = false`, domyślnie) NIE
--   zapisuje nikogo: po włączeniu ścieżka startuje od bieżących zdarzeń,
--   a nie od zaległości sprzed tygodni (powitanie po miesiącu to szkoda).
--
-- KOLEJNOŚĆ WDROŻENIA: po I0 (tabele ścieżek), S2-S4 (emitery zdarzeń
-- i `crm_leads.user_id`). Przed 20261020140100 (silnik czyta zapisy).
-- Funkcja `_journey_eval_predicate` powstaje w 20261020140200 - plpgsql
-- rozwiązuje ją przy wykonaniu, a trasa bez tras (stan po wdrożeniu) nie
-- woła jej wcale. `domain_events` jest gorącą tabelą - CREATE TRIGGER pod
-- `lock_timeout`; błąd 55P03 = ponów cały plik.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE
-- TRIGGER, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/journeys_routing_test.sql (trasa -> skrzynka
-- idempotentnie, resolver, zdarzenia sprzed publikacji, agregaty pomijane),
-- supabase/tests/journeys_route_overhead_test.sql (1000 zdarzeń bez tras,
-- plan po PK, awaria trasy nie przerywa zapisu zdarzenia).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Trasa szyny -> skrzynka.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_journey_route_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Łańcuch: wyzwalacz tabeli (1) -> emiter -> ta trasa (2). Głębiej to już
  -- efekt uboczny efektu ubocznego - silnik nie dokłada kolejnego poziomu.
  IF pg_trigger_depth() >= 3 THEN
    RETURN NEW;
  END IF;
  -- Brak pętli: zdarzenie ścieżki ani diagnostyki nigdy nie zapisuje na ścieżkę.
  IF NEW.aggregate_type IN ('journey', 'revenue_diagnostic') THEN
    RETURN NEW;
  END IF;
  -- Jedno zapytanie po prefiksie klucza głównego (tenant_id, event_type).
  IF NOT EXISTS (
    SELECT 1 FROM public.journey_event_routes r
     WHERE r.tenant_id = NEW.tenant_id AND r.event_type = NEW.event_type
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.journey_event_inbox (
    tenant_id, event_id, event_type, aggregate_type, aggregate_id,
    actor_id, correlation_id, payload, occurred_at
  ) VALUES (
    NEW.tenant_id, NEW.id, NEW.event_type, NEW.aggregate_type, NEW.aggregate_id,
    NEW.actor_id, NEW.correlation_id,
    COALESCE(NEW.payload, '{}'::jsonb) - ARRAY['first_name', 'last_name', 'display_name', 'full_name'],
    NEW.created_at
  )
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Trasa nigdy nie przerywa zapisu zdarzenia (płatność, rejestracja).
  BEGIN
    INSERT INTO public.journey_engine_errors (tenant_id, phase, event_id, error)
    VALUES (NEW.tenant_id, 'route', NEW.id, left(SQLSTATE || ': ' || SQLERRM, 2000));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_journey_route_event() FROM PUBLIC, anon, authenticated;

SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_journey_route_event ON public.domain_events;
-- Warunek WHEN odsiewa agregaty bez wejścia do funkcji (zero kosztu PL/pgSQL).
CREATE TRIGGER trg_journey_route_event
  AFTER INSERT ON public.domain_events
  FOR EACH ROW
  WHEN (NEW.aggregate_type NOT IN ('journey', 'revenue_diagnostic'))
  EXECUTE FUNCTION public.tg_journey_route_event();

RESET lock_timeout;

COMMENT ON FUNCTION public.tg_journey_route_event() IS
  'Hub S5: trasa szyny do skrzynki ścieżek - jedno zapytanie po PK journey_event_routes, agregaty journey/revenue_diagnostic pomijane, błąd do journey_engine_errors bez przerwania zapisu zdarzenia.';

-- ----------------------------------------------------------------------------
-- B) Kontakt zdarzenia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_resolve_lead(p_inbox_id bigint)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_row public.journey_event_inbox%ROWTYPE;
  v_payload jsonb;
  v_lead uuid;
  v_user uuid;
  v_person record;
  v_email text;
  v_first text;
  v_last text;
  v_ref text;
BEGIN
  SELECT * INTO v_row FROM public.journey_event_inbox i WHERE i.id = p_inbox_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_payload := COALESCE(v_row.payload, '{}'::jsonb);

  -- Klub tajny nie istnieje dla nikogo spoza niego - także dla ścieżek.
  IF v_payload ->> 'club_id' ~ c_uuid AND EXISTS (
    SELECT 1 FROM public.clubs c
     WHERE c.id = (v_payload ->> 'club_id')::uuid AND c.tenant_id = v_row.tenant_id
       AND c.visibility = 'secret'
  ) THEN
    RETURN NULL;
  END IF;

  -- 1. Agregat leada i jawny `lead_id`.
  v_ref := CASE WHEN v_row.aggregate_type = 'crm_lead' THEN v_row.aggregate_id
                ELSE v_payload ->> 'lead_id' END;
  IF v_ref ~ c_uuid THEN
    SELECT l.id INTO v_lead FROM public.crm_leads l
     WHERE l.tenant_id = v_row.tenant_id AND l.id = v_ref::uuid;
    IF v_lead IS NOT NULL THEN
      RETURN v_lead;
    END IF;
  END IF;

  -- 2. Konto: właściciel zdarzenia albo członek klubu.
  v_ref := COALESCE(v_payload ->> 'user_id', v_payload ->> 'member_user_id');
  IF v_ref ~ c_uuid THEN
    v_user := v_ref::uuid;
  END IF;

  -- 3. Osoba wydarzeń (rejestracja, obecność). Rezygnacja nie niesie
  --    `person_id` w ładunku - osobę daje agregat zgłoszenia, bo inaczej
  --    wyjście `event.registration.cancelled.v1` nie trafiłoby w zapis.
  v_ref := v_payload ->> 'person_id';
  IF v_ref IS NULL AND v_row.aggregate_type = 'event_registration' AND v_row.aggregate_id ~ c_uuid THEN
    SELECT r.person_id::text INTO v_ref FROM public.event_registrations r
     WHERE r.id = v_row.aggregate_id::uuid AND r.tenant_id = v_row.tenant_id;
  END IF;
  IF v_user IS NULL AND v_ref ~ c_uuid THEN
    SELECT p.user_id, p.email_norm, p.first_name, p.last_name INTO v_person
      FROM public.event_people p
     WHERE p.id = v_ref::uuid AND p.tenant_id = v_row.tenant_id;
    IF FOUND THEN
      v_user := v_person.user_id;
      v_email := NULLIF(btrim(v_person.email_norm), '');
      v_first := v_person.first_name;
      v_last := v_person.last_name;
    END IF;
  END IF;

  -- 4. Subskrybent newslettera (agregat albo `subscriber_id`).
  v_ref := CASE WHEN v_row.aggregate_type = 'newsletter_subscriber' THEN v_row.aggregate_id
                ELSE v_payload ->> 'subscriber_id' END;
  IF v_user IS NULL AND v_email IS NULL AND v_ref ~ c_uuid THEN
    SELECT lower(btrim(s.email)), s.user_id INTO v_email, v_user
      FROM public.newsletter_subscribers s
     WHERE s.id = v_ref::uuid AND s.tenant_id = v_row.tenant_id;
  END IF;

  -- 5. Aktor - tylko gdy ładunek nie niesie tożsamości i aktor nie jest
  --    personelem (decyzja redakcji nie zapisuje redaktora na ścieżkę).
  IF v_user IS NULL AND v_email IS NULL AND v_row.actor_id IS NOT NULL
     AND NOT (v_payload ?| ARRAY['user_id', 'member_user_id', 'person_id', 'subscriber_id', 'lead_id'])
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = v_row.actor_id AND ur.tenant_id = v_row.tenant_id
          AND ur.role::text IN ('admin', 'editor', 'author', 'super_admin')
     ) THEN
    v_user := v_row.actor_id;
  END IF;

  IF v_user IS NOT NULL THEN
    SELECT l.id INTO v_lead FROM public.crm_leads l
     WHERE l.tenant_id = v_row.tenant_id AND l.user_id = v_user;
    IF v_lead IS NOT NULL THEN
      RETURN v_lead;
    END IF;
    IF v_email IS NULL THEN
      SELECT lower(btrim(COALESCE(NULLIF(btrim(p.email), ''), p.contact_email))),
             p.first_name, p.last_name
        INTO v_email, v_first, v_last
        FROM public.profiles p
       WHERE p.id = v_user AND p.tenant_id = v_row.tenant_id;
    END IF;
  END IF;

  -- Zdarzenie bez tożsamości (anonimowe) - nikogo nie zapisujemy.
  IF v_email IS NULL OR v_email = '' OR position('@' IN v_email) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT l.id INTO v_lead FROM public.crm_leads l
   WHERE l.tenant_id = v_row.tenant_id AND l.email_norm = v_email
   ORDER BY l.last_activity_at DESC
   LIMIT 1;
  IF v_lead IS NULL THEN
    -- Lead BEZ zgody marketingowej i bez zapisu na newsletter: silnik
    -- nigdy nie daje zgody - sprawdza ją przy każdej wysyłce.
    v_lead := public.crm_upsert_lead(v_row.tenant_id, v_email, v_first, v_last, NULL, NULL, false, false);
  END IF;
  RETURN v_lead;
END;
$$;

REVOKE ALL ON FUNCTION public.journey_resolve_lead(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_resolve_lead(bigint) TO service_role;

COMMENT ON FUNCTION public.journey_resolve_lead(bigint) IS
  'Hub S5: kontakt zdarzenia ze skrzynki (crm_lead -> lead_id -> user_id/member_user_id -> person_id -> subskrybent -> aktor spoza personelu). Klub secret i zdarzenie anonimowe = NULL. Brak leada przy znanym adresie = lead bez zgody. Tylko service_role.';

-- ----------------------------------------------------------------------------
-- D) Zapis na ścieżkę (jedno miejsce, także dla narzędzi admina).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_enroll(
  p_tenant uuid,
  p_journey_id uuid,
  p_version_id uuid,
  p_lead_id uuid,
  p_event jsonb,
  p_is_test boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version record;
  v_trigger_node text;
  v_key text;
  v_user uuid;
  v_id uuid;
  v_predicate jsonb;
  v_event_id uuid := NULLIF(p_event ->> 'id', '')::uuid;
BEGIN
  SELECT v.reentry, v.reentry_cooldown_days, v.entry_filter, v.graph, v.trigger_event_type
    INTO v_version
    FROM public.journey_versions v
   WHERE v.id = p_version_id AND v.tenant_id = p_tenant AND v.journey_id = p_journey_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT n ->> 'id' INTO v_trigger_node
    FROM jsonb_array_elements(v_version.graph -> 'nodes') n
   WHERE n ->> 'type' = 'trigger'
   LIMIT 1;
  IF v_trigger_node IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT l.user_id INTO v_user FROM public.crm_leads l
   WHERE l.id = p_lead_id AND l.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_is_test THEN
    -- Zapis testowy nie blokuje prawdziwego wejścia (osobny klucz).
    v_key := 'test:' || gen_random_uuid()::text;
  ELSE
    -- Polityka ponownego wejścia = kształt klucza idempotencji.
    v_key := CASE v_version.reentry
      WHEN 'never' THEN p_lead_id::text
      ELSE p_lead_id::text || ':' || COALESCE(v_event_id::text, gen_random_uuid()::text)
    END;
    IF v_version.reentry = 'cooldown' AND EXISTS (
      SELECT 1 FROM public.journey_enrollments e
       WHERE e.journey_id = p_journey_id AND e.lead_id = p_lead_id AND NOT e.is_test
         AND e.entered_at > now() - make_interval(days => COALESCE(v_version.reentry_cooldown_days, 1))
    ) THEN
      RETURN NULL;
    END IF;
    -- Filtr wejścia: kontakt, który nie spełnia warunku, NIE dostaje wiersza -
    -- przy polityce `never` wiersz zablokowałby go na zawsze.
    FOR v_predicate IN SELECT jsonb_array_elements(COALESCE(v_version.entry_filter, '[]'::jsonb)) LOOP
      IF NOT public._journey_eval_predicate(p_tenant, p_lead_id, v_user, NULL, now(), v_predicate,
                                            COALESCE(p_event -> 'payload', '{}'::jsonb)) THEN
        RETURN NULL;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.journey_enrollments (
    tenant_id, journey_id, version_id, lead_id, user_id, status, current_node_id,
    next_run_at, trigger_event_id, trigger_event_type, trigger_snapshot,
    correlation_id, enrollment_key, is_test
  ) VALUES (
    p_tenant, p_journey_id, p_version_id, p_lead_id, v_user, 'active', v_trigger_node,
    now(), v_event_id, COALESCE(p_event ->> 'event_type', v_version.trigger_event_type),
    COALESCE(p_event, '{}'::jsonb),
    COALESCE(NULLIF(p_event ->> 'correlation_id', '')::uuid, gen_random_uuid()),
    v_key, p_is_test
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._journey_enroll(uuid, uuid, uuid, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Skrzynka -> zapisy, cele, wyjścia, przebudzenia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_ingest_inbox(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  v_row public.journey_event_inbox%ROWTYPE;
  v_route record;
  v_lead uuid;
  v_lead_known boolean;
  v_enabled boolean;
  v_id uuid;
  v_n integer;
  v_ingested integer := 0;
  v_enrolled integer := 0;
  v_goals integer := 0;
  v_exits integer := 0;
  v_wakes integer := 0;
  v_failed integer := 0;
  v_journeys jsonb := '{}'::jsonb;
BEGIN
  FOR v_row IN
    SELECT * FROM public.journey_event_inbox i
     WHERE i.processed_at IS NULL
     ORDER BY i.id
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    v_lead := NULL;
    v_lead_known := false;
    BEGIN
      SELECT COALESCE(s.enabled, false) INTO v_enabled
        FROM (SELECT 1) one
        LEFT JOIN public.journey_settings s ON s.tenant_id = v_row.tenant_id;

      -- Kolejność ról: wyjście i cel przed zapisem - zdarzenie, które kończy
      -- poprzedni przebieg, może otworzyć nowy (`after_exit`).
      FOR v_route IN
        SELECT r.journey_id, r.version_id, r.role, r.condition,
               d.status AS journey_status, d.published_version_id, d.category,
               v.published_at
          FROM public.journey_event_routes r
          JOIN public.journey_definitions d ON d.tenant_id = r.tenant_id AND d.id = r.journey_id
          JOIN public.journey_versions v ON v.tenant_id = r.tenant_id AND v.id = r.version_id
         WHERE r.tenant_id = v_row.tenant_id AND r.event_type = v_row.event_type
         ORDER BY r.journey_id,
                  CASE r.role WHEN 'exit' THEN 0 WHEN 'goal' THEN 1 WHEN 'wake' THEN 2 ELSE 3 END
      LOOP
        IF NOT (v_row.payload @> COALESCE(v_route.condition, '{}'::jsonb)) THEN
          CONTINUE;
        END IF;
        IF NOT v_lead_known THEN
          v_lead := public.journey_resolve_lead(v_row.id);
          v_lead_known := true;
        END IF;
        EXIT WHEN v_lead IS NULL;

        IF v_route.role = 'exit' THEN
          UPDATE public.journey_enrollments e
             SET status = 'exited',
                 exit_reason = CASE WHEN v_row.event_type = 'newsletter_subscriber.unsubscribed.v1'
                                    THEN 'unsubscribed' ELSE 'exit_event' END,
                 finished_at = now(), next_run_at = NULL, lock_token = NULL, locked_until = NULL
           WHERE e.tenant_id = v_row.tenant_id AND e.journey_id = v_route.journey_id
             AND e.lead_id = v_lead AND e.status IN ('active', 'waiting')
             AND e.entered_at <= v_row.occurred_at;
          GET DIAGNOSTICS v_n = ROW_COUNT;
          v_exits := v_exits + v_n;
        ELSIF v_route.role = 'goal' THEN
          UPDATE public.journey_enrollments e
             SET status = 'goal_reached', exit_reason = 'goal',
                 finished_at = now(), next_run_at = NULL, lock_token = NULL, locked_until = NULL
           WHERE e.tenant_id = v_row.tenant_id AND e.journey_id = v_route.journey_id
             AND e.lead_id = v_lead AND e.status IN ('active', 'waiting')
             AND e.entered_at <= v_row.occurred_at;
          GET DIAGNOSTICS v_n = ROW_COUNT;
          v_goals := v_goals + v_n;
        ELSIF v_route.role = 'wake' THEN
          WITH woken AS (
            UPDATE public.journey_step_runs sr
               SET status = 'succeeded', outcome = 'event', finished_at = now(),
                   detail = sr.detail || jsonb_build_object('event_id', v_row.event_id)
              FROM public.journey_enrollments e
             WHERE e.tenant_id = v_row.tenant_id AND e.journey_id = v_route.journey_id
               AND e.lead_id = v_lead AND e.status = 'waiting'
               AND e.wait_event_type = v_row.event_type
               AND v_row.payload @> COALESCE(e.wait_condition, '{}'::jsonb)
               AND sr.enrollment_id = e.id AND sr.node_id = e.current_node_id
               AND sr.status = 'running' AND sr.started_at <= v_row.occurred_at
            RETURNING sr.enrollment_id
          )
          UPDATE public.journey_enrollments e
             SET status = 'active', next_run_at = now(),
                 wait_event_type = NULL, wait_condition = NULL, wait_deadline = NULL
           WHERE e.id IN (SELECT w.enrollment_id FROM woken w);
          GET DIAGNOSTICS v_n = ROW_COUNT;
          v_wakes := v_wakes + v_n;
        ELSIF v_route.role = 'enroll'
              AND v_enabled
              AND v_route.journey_status = 'active'
              AND v_route.published_version_id = v_route.version_id
              AND v_row.occurred_at >= v_route.published_at THEN
          v_id := public._journey_enroll(
            v_row.tenant_id, v_route.journey_id, v_route.version_id, v_lead,
            jsonb_build_object(
              'id', v_row.event_id, 'tenant_id', v_row.tenant_id,
              'aggregate_type', v_row.aggregate_type, 'aggregate_id', v_row.aggregate_id,
              'event_type', v_row.event_type, 'payload', v_row.payload,
              'correlation_id', v_row.correlation_id, 'actor_id', v_row.actor_id,
              'created_at', v_row.occurred_at
            ),
            false
          );
          IF v_id IS NOT NULL THEN
            v_enrolled := v_enrolled + 1;
            v_journeys := jsonb_set(v_journeys, ARRAY[v_route.journey_id::text],
              to_jsonb(COALESCE((v_journeys ->> v_route.journey_id::text)::integer, 0) + 1));
          END IF;
        END IF;
      END LOOP;

      UPDATE public.journey_event_inbox
         SET processed_at = now(), attempts = attempts + 1, error = NULL
       WHERE id = v_row.id;
      v_ingested := v_ingested + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Podtransakcja zdarzenia wycofana; zostaje ślad i licznik prób.
      UPDATE public.journey_event_inbox
         SET attempts = attempts + 1,
             error = left(SQLSTATE || ': ' || SQLERRM, 500),
             processed_at = CASE WHEN attempts + 1 >= 5 THEN now() END
       WHERE id = v_row.id;
      INSERT INTO public.journey_engine_errors (tenant_id, phase, event_id, error)
      VALUES (v_row.tenant_id, 'ingest', v_row.event_id, left(SQLSTATE || ': ' || SQLERRM, 2000));
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ingested', v_ingested, 'enrolled', v_enrolled, 'goals', v_goals,
    'exits', v_exits, 'wakes', v_wakes, 'failed', v_failed, 'journeys', v_journeys
  );
END;
$$;

REVOKE ALL ON FUNCTION public.journey_ingest_inbox(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_ingest_inbox(integer) TO service_role;

COMMENT ON FUNCTION public.journey_ingest_inbox(integer) IS
  'Hub S5: porcja skrzynki zdarzeń (FOR UPDATE SKIP LOCKED, podtransakcja na zdarzenie): wyjście, cel, przebudzenie, zapis (silnik najemcy włączony, wersja opublikowana, occurred_at >= published_at, filtr wejścia, polityka ponownego wejścia). Wynik {ingested, enrolled, goals, exits, wakes, failed, journeys{id: zapisani}}. Tylko service_role.';
