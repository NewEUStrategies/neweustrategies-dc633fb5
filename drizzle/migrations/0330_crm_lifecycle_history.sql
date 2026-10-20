-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S4, 1/8): CYKL ŻYCIA LEADA - HISTORIA ETAPÓW,
-- PIERWSZEŃSTWO PISARZY I STRAŻNIK KOLUMN HUBA (Z-06).
--
-- DEFEKT
--   1. Zmiana etapu leada (`stage`) nadpisuje wartość bez śladu: `audit_log`
--      ma tylko oś czasu karty, a `domain_events` trzymają 90 dni. Lejka
--      sprzedaży (konwersja między etapami, czas w etapie) nie da się policzyć.
--   2. I0 dodał `crm_leads.lifecycle_stage`, ale nie ma pisarza: billing nie
--      oznacza klienta, automaty nie przestawiają etapu, a nic nie pilnuje
--      kolejności „kto ma ostatnie słowo". Godzinę po płatności krok ścieżki
--      „ustaw etap: lead" cofnąłby płacącego klienta do leada.
--   3. Z-06 (dziennik §2.2): `authenticated` ma tabelowe INSERT/UPDATE na
--      `crm_leads` i `crm_tasks`, a polityki personelu przepuszczają admina,
--      redaktora (i przy zadaniach - autora). Przez PostgREST redaktor
--      zmieniał więc `user_id` (resolver ścieżek S5 ufa
--      `crm_leads.user_id = auth.uid()`), `lifecycle_stage` z pominięciem
--      pierwszeństwa (billing jedynym pisarzem `customer`/`former_customer`)
--      oraz `source`/`origin_ref` zadania (zajęty `origin_ref` = cichy brak
--      zadania kroku automatyzacji).
--
-- ZMIANA
--   A. `tg_crm_leads_stage_history()` - JEDNA funkcja wyzwalacza w dwóch
--      rolach (rejestr właścicieli zna wyłącznie tę nazwę; rozgałęzienie po
--      `TG_WHEN`):
--        * BEFORE INSERT OR UPDATE (`trg_crm_leads_00_hub_guard`) - strażnik
--          Z-06: zmiana `user_id`, `lifecycle_stage` albo
--          `lifecycle_changed_at` z sesji klienta (rola `authenticated`/`anon`)
--          poza zaufanym pisarzem = 42501. Zaufany pisarz to funkcja SECURITY
--          DEFINER, która na czas własnego zapisu ustawia flagę transakcyjną
--          `app.crm_trusted_writer = on` (wzór `app.verification_sync`,
--          20260806094104). `service_role`, migracje i wyzwalacze serwisowe
--          nie są sesją klienta i flagi nie potrzebują. Niezależnie od roli:
--          `customer`/`former_customer` wyłącznie ze źródła `billing`
--          (albo `backfill` tej migracji) - inaczej 42501. Zmiana etapu cyklu
--          stempluje `lifecycle_changed_at`.
--        * AFTER INSERT OR UPDATE OF stage, lifecycle_stage
--          (`trg_crm_leads_stage_history`) - wiersz `crm_lead_stage_history`
--          na każdą zmianę osi (`crm_stage`, `lifecycle`) ze źródłem z GUC
--          `app.change_source` (domyślnie: sesja klienta = `manual`, reszta =
--          `system`), aktorem `auth.uid()` i - dla ścieżek S5 - `journey_id`/
--          `enrollment_id` z `app.change_journey_id`/`app.change_enrollment_id`;
--          zmiana cyklu życia emituje `crm_lead.lifecycle_changed.v1`
--          {lead_id, from, to, source}. Awaria historii albo emisji NIE
--          przerywa zapisu leada (ślad w `domain_event_emit_errors`).
--   B. `crm_set_lifecycle_stage(p_lead_id, p_stage, p_source, p_allow_backward)`
--      (tylko `service_role` i funkcje SECURITY DEFINER): pierwszeństwo
--      `billing > manual > journey = workflow > system` (lustro
--      `LIFECYCLE_WRITER_PRECEDENCE` w src/lib/crm/lifecycle.ts), ostatni
--      pisarz = źródło najnowszego wpisu historii osi `lifecycle`. Wynik
--      jsonb `{changed, skipped, lead_id, from, to, source}`, gdzie
--      `skipped` ∈ `billing_owned | unchanged | precedence | backward | null`.
--      Cofnięcie etapu (np. `customer` -> `lead`) wymaga `p_allow_backward`.
--   C. `admin_crm_set_lifecycle_stage(p_lead_id, p_stage)` - panel CRM
--      (admin|editor najemcy z sesji, lead tylko z tego najemcy), źródło
--      `manual`, cofnięcie dozwolone (człowiek poprawia błąd automatu),
--      etapy klienta odrzucone (`skipped: billing_owned`).
--   D. `crm_tasks.source` / `origin_ref` - granty kolumnowe: `authenticated`
--      traci tabelowe INSERT/UPDATE i dostaje je na jawnej liście kolumn BEZ
--      tych dwóch (wzór D-S1-06, `b2b_coupon_campaigns`). Zadanie z panelu
--      dostaje `source = 'manual'` z wartości domyślnej; automaty piszą jako
--      właściciel funkcji. NOWA KOLUMNA `crm_tasks` wymaga dopisania do obu
--      list grantów - pilnuje tego test kompletności w pgTAP.
--   E. Widok `crm_leads_all` (zakres „wszyscy najemcy" super admina) dostaje
--      na końcu kolumny cyklu życia i segmentu - filtr cyklu życia na liście
--      CRM działał tylko w zakresie najemcy.
--   F. Backfill historii `crm_stage` z `audit_log` (`crm_lead.stage_change`,
--      `{from, to}`) ze źródłem `backfill`, aktorem i czasem wpisu - wyłącznie
--      dla leadów bez żadnej historii tej osi (powtórka = no-op).
--
-- KOLEJNOŚĆ WDROŻENIA: po I0 (`20261020090200` - tabela historii i kolumny,
-- `20261020090500` - `_log_emit_error`). Przed `20261020130100` (backfill
-- `user_id`/`lifecycle_stage` korzysta z flagi zaufanego pisarza i źródła
-- `backfill`) i przed kodem TS, który woła oba RPC. `crm_leads` to gorąca
-- tabela - `lock_timeout` 5 s, ponowienie całego pliku przy 55P03.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION/VIEW, DROP TRIGGER IF EXISTS +
-- CREATE TRIGGER, bezstanowe REVOKE/GRANT, backfill z NOT EXISTS.
-- DOWÓD: supabase/tests/crm_lifecycle_history_test.sql (historia z GUC,
-- pierwszeństwo billing -> ścieżka `skipped:'precedence'`, emisja,
-- strażnik 42501 dla admina i redaktora przez PostgREST, granty kolumnowe
-- zadań, backfill); parytet pierwszeństwa: src/lib/crm/__tests__/lifecycleParity.test.ts.
-- ============================================================================

SET lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- A) Strażnik kolumn huba + historia etapów (jedna funkcja, dwie role).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_crm_leads_stage_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Rola SESJI (PostgREST: `SET LOCAL ROLE authenticated`). SECURITY DEFINER
  -- zmienia `current_user` na właściciela, ale GUC `role` zostaje - dlatego
  -- strażnik pyta o niego, a nie o `current_user`.
  v_role text := COALESCE(NULLIF(current_setting('role', true), ''), 'none');
  v_client boolean := v_role IN ('authenticated', 'anon');
  v_trusted boolean := COALESCE(current_setting('app.crm_trusted_writer', true), '') = 'on';
  v_source text := NULLIF(current_setting('app.change_source', true), '');
  v_journey uuid;
  v_enrollment uuid;
  v_hub_changed boolean;
  v_lifecycle_changed boolean;
BEGIN
  -- Źródło zmiany: jawne z GUC (RPC, billing, ścieżka), inaczej z roli sesji.
  -- Napis spoza słownika historii nie przechodzi dalej - CHECK tabeli
  -- odrzuciłby wiersz historii, a strażnik użyłby go do decyzji o billingu.
  IF v_source IS NULL
     OR v_source NOT IN ('manual','bulk','billing','journey','workflow','import','system','backfill') THEN
    v_source := CASE WHEN v_client THEN 'manual' ELSE 'system' END;
  END IF;

  IF TG_WHEN = 'BEFORE' THEN
    IF TG_OP = 'INSERT' THEN
      v_lifecycle_changed := NEW.lifecycle_stage IS DISTINCT FROM 'subscriber';
      v_hub_changed := NEW.user_id IS NOT NULL
        OR v_lifecycle_changed
        OR NEW.lifecycle_changed_at IS NOT NULL;
    ELSE
      v_lifecycle_changed := NEW.lifecycle_stage IS DISTINCT FROM OLD.lifecycle_stage;
      v_hub_changed := NEW.user_id IS DISTINCT FROM OLD.user_id
        OR v_lifecycle_changed
        OR NEW.lifecycle_changed_at IS DISTINCT FROM OLD.lifecycle_changed_at;
    END IF;

    -- Z-06: kolumny huba zmienia wyłącznie zaufany pisarz. Brak wyjątku dla
    -- admina CELOWO - cykl życia ustawia admin przez RPC z pierwszeństwem.
    IF v_hub_changed AND v_client AND NOT v_trusted THEN
      RAISE EXCEPTION 'crm_hub_column_protected'
        USING ERRCODE = '42501',
              DETAIL = 'crm_leads.user_id, lifecycle_stage i lifecycle_changed_at zmienia wyłącznie RPC (admin_crm_set_lifecycle_stage).';
    END IF;

    IF v_lifecycle_changed THEN
      -- O tym, kto jest klientem, rozstrzyga płatność - każdy inny pisarz
      -- (także service_role bez GUC) dostaje odmowę, zamiast cicho nadpisać.
      IF NEW.lifecycle_stage IN ('customer', 'former_customer')
         AND v_source NOT IN ('billing', 'backfill') THEN
        RAISE EXCEPTION 'crm_lifecycle_billing_owned'
          USING ERRCODE = '42501',
                DETAIL = 'Etapy customer i former_customer ustawia wyłącznie billing.';
      END IF;
      NEW.lifecycle_changed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- AFTER: historia i emisja. Błąd tu NIE wycofuje zapisu leada - historia
  -- jest pochodną, a zapis CRM (np. webhook płatności) ważniejszy.
  BEGIN
    v_journey := NULLIF(current_setting('app.change_journey_id', true), '')::uuid;
    v_enrollment := NULLIF(current_setting('app.change_enrollment_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_journey := NULL;
    v_enrollment := NULL;
  END;

  BEGIN
    IF (TG_OP = 'INSERT' AND NEW.stage IS DISTINCT FROM 'new'::public.crm_stage)
       OR (TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage) THEN
      INSERT INTO public.crm_lead_stage_history (
        tenant_id, lead_id, dimension, from_value, to_value, source, actor_id,
        journey_id, enrollment_id
      ) VALUES (
        NEW.tenant_id, NEW.id, 'crm_stage',
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage::text END, NEW.stage::text,
        v_source, auth.uid(), v_journey, v_enrollment
      );
    END IF;

    IF (TG_OP = 'INSERT' AND NEW.lifecycle_stage IS DISTINCT FROM 'subscriber')
       OR (TG_OP = 'UPDATE' AND NEW.lifecycle_stage IS DISTINCT FROM OLD.lifecycle_stage) THEN
      INSERT INTO public.crm_lead_stage_history (
        tenant_id, lead_id, dimension, from_value, to_value, source, actor_id,
        journey_id, enrollment_id
      ) VALUES (
        NEW.tenant_id, NEW.id, 'lifecycle',
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.lifecycle_stage END, NEW.lifecycle_stage,
        v_source, auth.uid(), v_journey, v_enrollment
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._log_emit_error(
      NEW.tenant_id, 'tg_crm_leads_stage_history', 'crm_lead_stage_history', SQLSTATE, SQLERRM
    );
  END;

  -- Emisja w OSOBNYM bloku: padnięta szyna nie może cofnąć wpisu historii,
  -- który jest trwałym źródłem lejka (zdarzenia żyją 90 dni).
  -- Payload bez PII (I8): identyfikator i enumy. Backfill odtwarza etap,
  -- a nie zmienia go dziś - zdarzenie uruchomiłoby przepisy i ścieżki dla
  -- tysięcy leadów naraz, więc ten jeden typ źródła nie emituje.
  IF ((TG_OP = 'INSERT' AND NEW.lifecycle_stage IS DISTINCT FROM 'subscriber')
      OR (TG_OP = 'UPDATE' AND NEW.lifecycle_stage IS DISTINCT FROM OLD.lifecycle_stage))
     AND v_source <> 'backfill' THEN
    BEGIN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'crm_lead', NEW.id::text, 'crm_lead.lifecycle_changed.v1',
        jsonb_build_object(
          'lead_id', NEW.id,
          'from', CASE WHEN TG_OP = 'UPDATE' THEN OLD.lifecycle_stage END,
          'to', NEW.lifecycle_stage,
          'source', v_source
        )
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._log_emit_error(
        NEW.tenant_id, 'tg_crm_leads_stage_history', 'crm_lead.lifecycle_changed.v1', SQLSTATE, SQLERRM
      );
    END;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_crm_leads_stage_history() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_crm_leads_stage_history() IS
  'Hub S4 (Z-06): BEFORE - strażnik kolumn user_id/lifecycle_stage/lifecycle_changed_at (sesja klienta tylko przez RPC z flagą app.crm_trusted_writer; customer/former_customer tylko ze źródła billing); AFTER - crm_lead_stage_history (źródło z app.change_source) + crm_lead.lifecycle_changed.v1.';

-- `00` w nazwie: strażnik ma stać PRZED pozostałymi BEFORE (normalizacja,
-- telefon, updated_at) - kolejność wyzwalaczy tego samego rodzaju jest
-- alfabetyczna, a odmowa ma paść zanim cokolwiek policzy się na próżno.
DROP TRIGGER IF EXISTS trg_crm_leads_00_hub_guard ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_00_hub_guard
  BEFORE INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_leads_stage_history();

DROP TRIGGER IF EXISTS trg_crm_leads_stage_history ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_stage_history
  AFTER INSERT OR UPDATE OF stage, lifecycle_stage ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_leads_stage_history();

-- ----------------------------------------------------------------------------
-- B) Pisarz cyklu życia z pierwszeństwem (service_role / SECURITY DEFINER).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_set_lifecycle_stage(
  p_lead_id uuid,
  p_stage text,
  p_source text,
  p_allow_backward boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Kolejność lejka = kolejność CHECK w 20261020090200 = `LIFECYCLE_STAGES`.
  v_order constant text[] := ARRAY[
    'subscriber','lead','registered','mql','sql','opportunity','customer','former_customer','other'
  ];
  v_lead record;
  v_writer text;
  v_last_source text;
  v_last_writer text;
  v_rank_new int;
  v_rank_last int;
  v_from_idx int;
  v_to_idx int;
  v_prev_source text := current_setting('app.change_source', true);
  v_prev_trusted text := current_setting('app.crm_trusted_writer', true);
BEGIN
  IF p_stage IS NULL OR NOT (p_stage = ANY (v_order)) THEN
    RAISE EXCEPTION 'lifecycle_stage_invalid' USING ERRCODE = '22023';
  END IF;
  -- `bulk` i `import` to operacje panelu - piszą z mocą człowieka (manual).
  IF p_source IS NULL
     OR p_source NOT IN ('billing','manual','journey','workflow','system','bulk','import') THEN
    RAISE EXCEPTION 'lifecycle_source_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT l.id, l.tenant_id, l.lifecycle_stage
    INTO v_lead
    FROM public.crm_leads l
   WHERE l.id = p_lead_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_writer := CASE WHEN p_source IN ('bulk', 'import') THEN 'manual' ELSE p_source END;

  IF p_stage IN ('customer', 'former_customer') AND v_writer <> 'billing' THEN
    RETURN jsonb_build_object('changed', false, 'skipped', 'billing_owned', 'lead_id', v_lead.id,
      'from', v_lead.lifecycle_stage, 'to', p_stage, 'source', p_source);
  END IF;

  IF v_lead.lifecycle_stage = p_stage THEN
    RETURN jsonb_build_object('changed', false, 'skipped', 'unchanged', 'lead_id', v_lead.id,
      'from', v_lead.lifecycle_stage, 'to', p_stage, 'source', p_source);
  END IF;

  -- Ostatni pisarz = źródło najnowszego wpisu osi `lifecycle`. Backfill
  -- etapu klienta liczy się jak billing (wyprowadzony z płatności), reszta
  -- backfillu - jak system. Etap klienta bez historii też należy do billingu.
  SELECT h.source INTO v_last_source
    FROM public.crm_lead_stage_history h
   WHERE h.tenant_id = v_lead.tenant_id AND h.lead_id = v_lead.id AND h.dimension = 'lifecycle'
   ORDER BY h.changed_at DESC, h.id DESC
   LIMIT 1;
  v_last_writer := CASE
    WHEN v_lead.lifecycle_stage IN ('customer', 'former_customer')
         AND (v_last_source IS NULL OR v_last_source = 'backfill') THEN 'billing'
    WHEN v_last_source IS NULL THEN NULL
    WHEN v_last_source IN ('manual', 'bulk', 'import') THEN 'manual'
    WHEN v_last_source = 'backfill' THEN 'system'
    ELSE v_last_source
  END;

  -- Lustro LIFECYCLE_WRITER_PRECEDENCE (src/lib/crm/lifecycle.ts).
  v_rank_new := CASE v_writer
    WHEN 'billing' THEN 3 WHEN 'manual' THEN 2 WHEN 'journey' THEN 1 WHEN 'workflow' THEN 1 ELSE 0 END;
  v_rank_last := CASE v_last_writer
    WHEN 'billing' THEN 3 WHEN 'manual' THEN 2 WHEN 'journey' THEN 1 WHEN 'workflow' THEN 1
    WHEN 'system' THEN 0 ELSE -1 END;
  IF v_rank_new < v_rank_last THEN
    RETURN jsonb_build_object('changed', false, 'skipped', 'precedence', 'lead_id', v_lead.id,
      'from', v_lead.lifecycle_stage, 'to', p_stage, 'source', p_source);
  END IF;

  -- Cofnięcie w lejku (bez `other`, które stoi poza kolejnością).
  v_from_idx := array_position(v_order, v_lead.lifecycle_stage);
  v_to_idx := array_position(v_order, p_stage);
  IF NOT COALESCE(p_allow_backward, false)
     AND v_lead.lifecycle_stage <> 'other' AND p_stage <> 'other'
     AND v_to_idx < v_from_idx THEN
    RETURN jsonb_build_object('changed', false, 'skipped', 'backward', 'lead_id', v_lead.id,
      'from', v_lead.lifecycle_stage, 'to', p_stage, 'source', p_source);
  END IF;

  PERFORM set_config('app.change_source', p_source, true);
  PERFORM set_config('app.crm_trusted_writer', 'on', true);
  UPDATE public.crm_leads
     SET lifecycle_stage = p_stage,
         updated_at = now()
   WHERE id = v_lead.id;
  -- Flaga i źródło wracają do stanu sprzed wywołania: kolejny zapis w tej
  -- samej transakcji (np. zwykły UPDATE w webhooku) nie może ich odziedziczyć.
  PERFORM set_config('app.crm_trusted_writer', COALESCE(v_prev_trusted, ''), true);
  PERFORM set_config('app.change_source', COALESCE(v_prev_source, ''), true);

  RETURN jsonb_build_object('changed', true, 'skipped', NULL, 'lead_id', v_lead.id,
    'from', v_lead.lifecycle_stage, 'to', p_stage, 'source', p_source);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_set_lifecycle_stage(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_set_lifecycle_stage(uuid, text, text, boolean) TO service_role;

COMMENT ON FUNCTION public.crm_set_lifecycle_stage(uuid, text, text, boolean) IS
  'Hub S4: jedyny pisarz crm_leads.lifecycle_stage z pierwszeństwem billing > manual > journey = workflow > system. Wynik {changed, skipped: billing_owned|unchanged|precedence|backward|null, lead_id, from, to, source}. Tylko service_role i funkcje SECURITY DEFINER.';

-- ----------------------------------------------------------------------------
-- C) RPC panelu CRM: ręczna zmiana cyklu życia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_crm_set_lifecycle_stage(p_lead_id uuid, p_stage text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Lead spoza najemcy sesji = „nie ma" (bez wyroczni istnienia).
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_leads l WHERE l.id = p_lead_id AND l.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Człowiek może cofnąć etap (poprawa błędu automatu), ale nie nada etapu
  -- klienta - ten wynika z płatności (`skipped: billing_owned`).
  RETURN public.crm_set_lifecycle_stage(p_lead_id, p_stage, 'manual', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_crm_set_lifecycle_stage(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_set_lifecycle_stage(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_crm_set_lifecycle_stage(uuid, text) IS
  'Hub S4: ręczna zmiana cyklu życia leada z panelu CRM (admin|editor, najemca z sesji, źródło manual, cofnięcie dozwolone, etapy klienta odrzucone jako billing_owned).';

-- ----------------------------------------------------------------------------
-- D) Z-06 dla zadań: `source` i `origin_ref` poza grantem klienta.
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON TABLE public.crm_tasks FROM authenticated;
GRANT INSERT (id, tenant_id, lead_id, title, note, due_at, status, assignee_id, created_by,
              reminded_at, completed_at, created_at, updated_at)
  ON TABLE public.crm_tasks TO authenticated;
GRANT UPDATE (id, tenant_id, lead_id, title, note, due_at, status, assignee_id, created_by,
              reminded_at, completed_at, created_at, updated_at)
  ON TABLE public.crm_tasks TO authenticated;

RESET lock_timeout;

COMMENT ON COLUMN public.crm_tasks.source IS
  'Kto utworzył zadanie: manual | workflow | journey | billing | system. Klient (authenticated) nie ma grantu na tę kolumnę - zadanie z panelu dostaje manual z wartości domyślnej (Z-06, S4).';

-- ----------------------------------------------------------------------------
-- E) Widok „wszyscy najemcy" z kolumnami cyklu życia (dopisane NA KOŃCU -
--    CREATE OR REPLACE VIEW nie pozwala przestawić istniejących kolumn).
-- ----------------------------------------------------------------------------
-- `security_invoker` W TEJ SAMEJ instrukcji: CREATE OR REPLACE VIEW bez
-- klauzuli WITH zeruje opcje widoku, więc między nią a ALTER-em widok byłby
-- przez chwilę widokiem DEFINER (RLS liczone jako właściciel).
CREATE OR REPLACE VIEW public.crm_leads_all WITH (security_invoker = true) AS
  SELECT l.id, l.tenant_id, l.email_norm, l.email, l.first_name, l.last_name, l.phone,
         l.company, l.stage, l.owner_id, l.tags, l.follow_up_at, l.last_activity_at,
         l.source_count, l.newsletter_status, l.marketing_consent, l.created_at, l.updated_at,
         l.phone_norm, l.aliases, l.company_id, l."position", l.linkedin_url, l.country,
         l.score, l.score_band, l.score_breakdown, l.score_updated_at,
         t.slug AS tenant_slug, t.name AS tenant_name,
         l.source_type, l.lifecycle_stage, l.lifecycle_changed_at
    FROM public.crm_leads l
    LEFT JOIN public.tenants t ON t.id = l.tenant_id;
GRANT SELECT ON public.crm_leads_all TO authenticated;

-- ----------------------------------------------------------------------------
-- F) Backfill historii etapu sprzedaży z dziennika audytu.
-- ----------------------------------------------------------------------------
INSERT INTO public.crm_lead_stage_history (
  tenant_id, lead_id, dimension, from_value, to_value, source, actor_id, changed_at
)
SELECT a.tenant_id, a.entity_id, 'crm_stage', NULLIF(a.metadata ->> 'from', ''),
       a.metadata ->> 'to', 'backfill', a.actor_id, a.created_at
  FROM public.audit_log a
  JOIN public.crm_leads l ON l.id = a.entity_id AND l.tenant_id = a.tenant_id
 WHERE a.action = 'crm_lead.stage_change'
   AND a.entity_type = 'crm_lead'
   AND NULLIF(a.metadata ->> 'to', '') IS NOT NULL
   -- Powtórka (i lead, który ma już historię z wyzwalacza) = bez zmian.
   AND NOT EXISTS (
     SELECT 1 FROM public.crm_lead_stage_history h
      WHERE h.tenant_id = a.tenant_id AND h.lead_id = a.entity_id AND h.dimension = 'crm_stage'
   );
