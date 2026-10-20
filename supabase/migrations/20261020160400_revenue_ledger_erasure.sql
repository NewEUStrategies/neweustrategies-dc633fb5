-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9b, 5/5): RODO KSIĘGI MRR - PEŁNA ANONIMIZACJA
-- RUCHÓW, HISTORII I CYKLI WINDYKACJI PO USUNIĘCIU KONTA (Z-07 / Z-S2-03).
-- Decyzja właściciela 2026-10-20 (zgoda delegowana): AKCEPTACJA zachowania
-- zanonimizowanych ruchów, historii i cykli windykacji po usunięciu konta -
-- pod warunkiem PEŁNEJ anonimizacji.
--
-- DEFEKT
--   S2 (20261020110100) zeruje `user_id` w `mrr_movements`,
--   `subscription_state_history` i `dunning_cycles` przy usunięciu
--   subskrypcji, ale zostawia ślady, które prowadzą z powrotem do osoby:
--   1. `subscription_state_history.source_event_id` - identyfikator zdarzenia
--      operatora płatności (`evt_…`); u operatora zdarzenie niesie klienta,
--      e-mail i metodę płatności. Ten sam identyfikator siedzi w `dedupe_key`
--      (`<subskrypcja>:<evt_…>:<odcisk>`, przy usunięciu `deleted:<sub>:…`).
--   2. `price_id_before/after` spoza katalogu - darowizna cykliczna idzie
--      ceną osadzoną (`price_data`), więc jej identyfikator ceny jest
--      jednorazowy i wskazuje jedną subskrypcję u operatora.
--   3. `subscription_id` - identyfikator wiersza `subscriptions`, który przez
--      90 dni retencji szyny (`prune_domain_events`) stoi w ładunkach
--      `billing_subscription.*.v1` obok `user_id` - klucz do połączenia
--      zanonimizowanej księgi z kontem.
--   4. `revenue_event_marks`: znaczniki `quota` mają w `ref` surowy `user_id`
--      (`<uid>:RRRR-MM`, 20261020120200), `trial_ending`/`expired` -
--      identyfikator subskrypcji, `retention_abandoned` - identyfikator
--      odpowiedzi ankiety (kasowanej kaskadą z kontem).
--
-- ZMIANA
--   A. `price_id_after` NULL-owalne (cena spoza katalogu po redakcji).
--   B. `_revenue_ledger_redact_subscription(p_subscription_id)` - JEDNA
--      redakcja dla obu ścieżek: nowy losowy identyfikator subskrypcji
--      wspólny dla jej historii, ruchów i cykli (kohorty, liczniki klientów
--      `'sub:' || id` i saldo per subskrypcja liczą się dalej tak samo),
--      `user_id` NULL, `source_event_id` NULL, `dedupe_key` = `redacted:<id>`,
--      cena spoza katalogu (`billing_catalog_entry`) -> NULL, znaczniki
--      `trial_ending`/`expired` tej subskrypcji usunięte. ZOSTAJĄ: kwoty,
--      waluta, daty, środowisko, status, ilość, `tier_key`, interwał,
--      segment, rodzaj ruchu, powód z katalogu, cena KATALOGOWA (wspólna dla
--      wszystkich klientów planu - opis produktu jak `tier_key`).
--   C. `tg_subscriptions_revenue_redact` (AFTER DELETE ON subscriptions) -
--      po wyzwalaczu S2 (kolejność alfabetyczna: `…_history` < `…_redact`),
--      więc redaguje też ruch `churn` i wiersz historii `deleted`, które S2
--      dopisuje przy usunięciu. Bez połykania błędu: awaria redakcji
--      przerywa usunięcie (jak anonimizacja dowodów księgowych) - konto bez
--      pełnej anonimizacji nie znika „po cichu".
--   D. `tg_auth_users_revenue_redact` (BEFORE DELETE ON auth.users): znaczniki
--      `quota` konta i `retention_abandoned` jego odpowiedzi; ślady księgi
--      z `user_id` konta, których subskrypcja już nie istnieje (redakcja
--      per subskrypcja). Subskrypcje żywe redaguje kaskada (C).
--   E. Domknięcie wstecz: subskrypcje usunięte przed tą migracją (wiersze
--      historii bez `redacted:` albo z `user_id`) i osierocone znaczniki.
--   Σ `delta_minor` się nie zmienia (kwoty i daty nietknięte) - most S2
--   i zamknięte miesiące bez zmian.
--
-- RODO (opis i podstawy w dzienniku wdrożenia §21): dane po anonimizacji nie
-- są danymi osobowymi (motyw 26); przed usunięciem konta - sprawozdawczość
-- finansowa (art. 6 ust. 1 lit. f); dowody księgowe żyją w module rozliczeń
-- (`payment_orders`, `billing_documents`), nie w księdze MRR.
--
-- KOLEJNOŚĆ WDROŻENIA: po 2026102011* (S2). Funkcje sprawdzają istnienie
-- tabel księgi (`to_regclass`) - bez S2 redakcja jest no-opem, a usunięcie
-- konta działa jak dotąd. `SET lock_timeout` przy ALTER i wyzwalaczach na
-- gorących `subscriptions` i `auth.users`.
-- IDEMPOTENTNA: ALTER COLUMN DROP NOT NULL (no-op przy powtórce), CREATE OR
-- REPLACE FUNCTION (nowe nazwy - bez CIALO-Z), DROP TRIGGER IF EXISTS +
-- CREATE, domknięcie E (`_revenue_ledger_redact_orphans`) wybiera tylko
-- ślady jeszcze niezredagowane - powtórka zwraca 0.
-- DOWÓD: supabase/tests/hub_i9b_revenue_ledger_erasure_test.sql (po
-- usunięciu konta żaden wiersz księgi i znaczników nie zawiera uid, e-maila
-- ani identyfikatorów operatora; Σ zamkniętych miesięcy i most bez zmian;
-- domknięcie wstecz; druga runda bez zmian),
-- supabase/tests/revenue_subscription_history_test.sql (Z-07).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Cena spoza katalogu po redakcji.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';
ALTER TABLE public.subscription_state_history ALTER COLUMN price_id_after DROP NOT NULL;
RESET lock_timeout;

COMMENT ON COLUMN public.subscription_state_history.price_id_after IS
  'Cena po zmianie; NULL po redakcji RODO, gdy cena spoza katalogu (cena osadzona darowizny = identyfikator jednej subskrypcji u operatora).';

-- ----------------------------------------------------------------------------
-- B) Redakcja jednej subskrypcji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_ledger_redact_subscription(p_subscription_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new uuid := gen_random_uuid();
  v_catalog boolean := to_regprocedure('public.billing_catalog_entry(text)') IS NOT NULL;
  v_rows integer := 0;
  v_n integer;
BEGIN
  IF p_subscription_id IS NULL OR to_regclass('public.mrr_movements') IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.subscription_state_history h
     SET subscription_id = v_new,
         user_id = NULL,
         source_event_id = NULL,
         dedupe_key = 'redacted:' || h.id::text,
         price_id_before = CASE
           WHEN h.price_id_before IS NOT NULL AND v_catalog
                AND EXISTS (SELECT 1 FROM public.billing_catalog_entry(h.price_id_before))
             THEN h.price_id_before END,
         price_id_after = CASE
           WHEN h.price_id_after IS NOT NULL AND v_catalog
                AND EXISTS (SELECT 1 FROM public.billing_catalog_entry(h.price_id_after))
             THEN h.price_id_after END
   WHERE h.subscription_id = p_subscription_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  UPDATE public.mrr_movements m
     SET subscription_id = v_new,
         user_id = NULL
   WHERE m.subscription_id = p_subscription_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  UPDATE public.dunning_cycles d
     SET subscription_id = v_new,
         user_id = NULL
   WHERE d.subscription_id = p_subscription_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;

  DELETE FROM public.revenue_event_marks k
   WHERE k.kind IN ('trial_ending', 'expired')
     AND k.ref LIKE p_subscription_id::text || ':%';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_rows + v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._revenue_ledger_redact_subscription(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._revenue_ledger_redact_subscription(uuid) IS
  'Hub I9b (RODO Z-07): redakcja księgi MRR jednej subskrypcji - nowy losowy identyfikator wspólny dla historii, ruchów i cykli, bez user_id, zdarzeń operatora, ceny spoza katalogu i znaczników; kwoty i daty nietknięte. Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- C) Usunięcie subskrypcji (także kaskada z usunięcia konta).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_subscriptions_revenue_redact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._revenue_ledger_redact_subscription(OLD.id);
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_subscriptions_revenue_redact() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_subscriptions_revenue_redact() IS
  'Hub I9b (RODO Z-07): po wyzwalaczu S2 (odejście salda) redaguje księgę MRR usuniętej subskrypcji. Błąd przerywa usunięcie.';

-- ----------------------------------------------------------------------------
-- D) Usunięcie konta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_auth_users_revenue_redact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.revenue_event_marks') IS NOT NULL THEN
    DELETE FROM public.revenue_event_marks k
     WHERE k.kind = 'quota'
       AND k.ref LIKE OLD.id::text || ':%';
    DELETE FROM public.revenue_event_marks k
     WHERE k.kind = 'retention_abandoned'
       AND k.ref IN (SELECT f.id::text FROM public.retention_feedback f WHERE f.user_id = OLD.id);
  END IF;

  IF to_regclass('public.mrr_movements') IS NOT NULL THEN
    FOR r IN
      SELECT x.subscription_id
        FROM (SELECT m.subscription_id FROM public.mrr_movements m WHERE m.user_id = OLD.id
              UNION
              SELECT h.subscription_id FROM public.subscription_state_history h WHERE h.user_id = OLD.id
              UNION
              SELECT d.subscription_id FROM public.dunning_cycles d WHERE d.user_id = OLD.id) x
       WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.id = x.subscription_id)
    LOOP
      PERFORM public._revenue_ledger_redact_subscription(r.subscription_id);
    END LOOP;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_auth_users_revenue_redact() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_auth_users_revenue_redact() IS
  'Hub I9b (RODO Z-07): przy usunięciu konta usuwa znaczniki quota i retention_abandoned konta oraz redaguje osierocone ślady księgi MRR z jego user_id; subskrypcje żywe redaguje kaskada.';

SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_subscriptions_revenue_redact ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_revenue_redact
  AFTER DELETE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_subscriptions_revenue_redact();

DROP TRIGGER IF EXISTS on_auth_user_deleted_redact_revenue ON auth.users;
CREATE TRIGGER on_auth_user_deleted_redact_revenue
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_auth_users_revenue_redact();

RESET lock_timeout;

-- ----------------------------------------------------------------------------
-- E) Domknięcie wstecz - ślady subskrypcji usuniętych przed tą migracją
--    i osierocone znaczniki. Wybiera wyłącznie ślady niezredagowane, więc
--    powtórka nic nie zmienia (funkcja zwraca 0) - dowód w pgTAP.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_ledger_redact_orphans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_rows integer := 0;
  v_n integer;
BEGIN
  IF to_regclass('public.mrr_movements') IS NULL THEN
    RETURN 0;
  END IF;
  FOR r IN
    SELECT x.subscription_id
      FROM (SELECT h.subscription_id FROM public.subscription_state_history h
             WHERE h.dedupe_key NOT LIKE 'redacted:%'
            UNION
            SELECT m.subscription_id FROM public.mrr_movements m WHERE m.user_id IS NOT NULL
            UNION
            SELECT d.subscription_id FROM public.dunning_cycles d WHERE d.user_id IS NOT NULL) x
     WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.id = x.subscription_id)
  LOOP
    v_rows := v_rows + public._revenue_ledger_redact_subscription(r.subscription_id);
  END LOOP;

  DELETE FROM public.revenue_event_marks k
   WHERE k.kind = 'quota'
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = split_part(k.ref, ':', 1));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM public.revenue_event_marks k
   WHERE k.kind IN ('trial_ending', 'expired')
     AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.id::text = split_part(k.ref, ':', 1));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM public.revenue_event_marks k
   WHERE k.kind = 'retention_abandoned'
     AND NOT EXISTS (SELECT 1 FROM public.retention_feedback f WHERE f.id::text = k.ref);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_rows + v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._revenue_ledger_redact_orphans() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._revenue_ledger_redact_orphans() IS
  'Hub I9b (RODO Z-07): domknięcie wstecz - redaguje ślady księgi MRR subskrypcji usuniętych przed I9b i usuwa osierocone znaczniki; zwraca liczbę zmian (0 przy powtórce). Wewnętrzny: bez EXECUTE dla ról API.';

SELECT public._revenue_ledger_redact_orphans();
