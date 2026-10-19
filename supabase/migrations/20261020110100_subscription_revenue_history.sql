-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S2, 2/8): KSIĘGA MRR - HISTORIA STANÓW SUBSKRYPCJI,
-- RUCHY PO DELCIE, CYKLE WINDYKACJI, ZDARZENIA BILLINGU; RODO PRZY USUNIĘCIU
-- KONTA (Z-07).
--
-- DEFEKT
--   1. Webhook operatora nadpisuje wiersz `subscriptions` - poprzedni stan
--      znika. Nie da się policzyć mostu MRR (nowe / rozszerzenia / zwężenia /
--      odejścia / powroty), NRR, GRR ani kohort; panel ma jedną liczbę „teraz".
--   2. Kierunek zmiany planu rozstrzyga dziś RANGA (`planChangeDirection`):
--      `plus_monthly` (39 zł) -> `plus_annual` (390 zł / 12 = 32,50 zł) to
--      „upgrade", choć MRR SPADA. Księga z rangą zawyżałaby rozszerzenia.
--   3. Pauza (`status = paused`) i odejście wyglądają w danych tak samo - stąd
--      fałszywy win-back i brak powrotu po wznowieniu (P13).
--   4. Nieudana płatność nie ma cyklu: nie wiadomo, ile MRR jest zagrożone,
--      ile odzyskano, a ile stracono; szyna nie zna `payment_failed`.
--   5. Z-07 (RODO): `auth.users` -> `subscriptions` -> historia -> ruchy
--      kaskadowały. Usunięcie konta kasowało ruchy ZAMKNIĘTYCH miesięcy
--      (fantomowy spadek MRR wstecz, zgubione cykle windykacji), a wiersze
--      bez historii zostawały z surowym `user_id`. `deleteMyAccount` anuluje
--      subskrypcję u operatora i kasuje konto przed webhookiem anulowania,
--      więc ruch `churn` nie powstawał wcale - MRR wisiał na zawsze.
--
-- ZMIANA
--   A. Z-07 - zamiast kaskady anonimizacja: historia i cykle windykacji tracą
--      FK do `subscriptions` (identyfikator subskrypcji zostaje jako klucz
--      nieprzezroczysty), ruch traci historię `ON DELETE SET NULL`, a `user_id`
--      we wszystkich trzech tabelach jest NULL-owalny. Trigger przy DELETE
--      subskrypcji: zapisuje odejście otwartego MRR (`churn`, `canceled`,
--      `user_id` NULL), zeruje `user_id` w historii, ruchach i cyklach tej
--      subskrypcji i domyka otwarty cykl jako `lost`. Zamknięte miesiące
--      pozostają nietknięte (Σ `delta_minor` bez zmian).
--   B. `tg_subscriptions_revenue_history` (AFTER INSERT OR UPDATE OR DELETE ON
--      subscriptions): przy zmianie kolumn znaczących (status, cena, ilość,
--      koniec okresu, pauza, licznik porażek, migawka kwoty i rabatu)
--        * wiersz historii z MRR przed (SALDO KSIĘGI subskrypcji - nie
--          przeliczenie starego stanu po dzisiejszym katalogu, więc most się
--          domyka) i po (`subscription_mrr_minor`, z podstawą kwoty),
--          `dedupe_key` = subskrypcja + zdarzenie operatora + odcisk stanu -
--          powtórka tego samego zdarzenia nie dubluje historii ani ruchu;
--        * ruch KLASYFIKOWANY PO DELCIE: 0 -> >0 `new` (pierwszy raz) albo
--          `reactivation` (był już przychód z tej subskrypcji albo konta),
--          >0 -> 0 `churn` (`paused` | `unpaid` | `canceled`), wzrost
--          `expansion`, spadek `contraction` (`plan_change` | `quantity` |
--          `discount` | `price`); zmiana waluty = `churn` w starej + `new` w
--          nowej (`currency_switch`; drugi ruch bez `history_id`, bo jeden
--          wiersz historii ma jeden ruch). MRR liczy się wyłącznie dla
--          `active|past_due` bez pauzy - trial to jeszcze nie przychód
--          (`trial_converted` przy wejściu w płatny stan), zaległość to wciąż
--          klient do końca windykacji. Cena nieznana katalogowi przy płatnym
--          stanie NIE tworzy ruchu (saldo zostaje, historia ma MRR NULL).
--        * cykl windykacji: licznik porażek 0 -> >0 otwiera cykl (MRR
--          zagrożone = saldo), kolejna porażka zwiększa `failures`, powrót do
--          0 w stanie `active|trialing` = `recovered`, `canceled|unpaid|
--          incomplete_expired` przy otwartym cyklu = `lost` (po 30 dniach
--          domyka go skaner 110500).
--      Zdarzenia WYŁĄCZNIE dla `environment = 'live'` (subskrypcje lustra
--      operatora nigdy nie są `mock` - zakup próbny nie zakłada wiersza
--      `subscriptions`): `billing_subscription.status_changed.v1` (status,
--      `cancel_at_period_end` albo pauza), `.payment_failed.v1` (0 -> >0),
--      `.payment_recovered.v1` (>0 -> 0 przy `active`). Payload bez PII.
--      Awaria księgi albo szyny NIE przerywa zapisu webhooka - ślad trafia do
--      `domain_event_emit_errors` (`_log_emit_error`, Z-02).
--   C. `tg_billing_documents_renewed_emit` (AFTER INSERT OR UPDATE OF
--      subscription_id, environment, status ON billing_documents): faktura
--      odnowienia (subskrypcja, bez zamówienia, `invoice`, `paid`, `live`, nie
--      `mock`) -> `subscription.renewed.v1`, raz - przy pierwszym stanie, który
--      spełnia warunek (faktura `open` opłacona przy kolejnej próbie też jest
--      odnowieniem). Rozszerzenie względem SPEC (sam INSERT): dzisiejszy zapis
--      dokumentu (`billingDocuments.server.ts`) nie stawia `subscription_id`
--      ani `environment` - Integrator dopina je w kodzie (zgłoszenie S2), a do
--      tego czasu zdarzenie po prostu nie powstaje (bez fałszywych odnowień).
--
-- KOLEJNOŚĆ WDROŻENIA: po 110000 (MRR subskrypcji) i przed 110200 (backfill
-- liczy saldo otwarcia). Trigger zaczyna pisać od chwili wdrożenia - stan
-- sprzed wdrożenia uzupełnia backfill (110200). `ALTER` na nowych tabelach
-- huba i `CREATE TRIGGER` na gorących `subscriptions`/`billing_documents`
-- z `lock_timeout` (55P03 = ponów plik).
-- IDEMPOTENTNA: DROP CONSTRAINT IF EXISTS + ADD (FK historii ruchu),
-- ALTER COLUMN DROP NOT NULL (no-op przy powtórce), CREATE OR REPLACE
-- FUNCTION (nowe nazwy - bez CIALO-Z), DROP TRIGGER IF EXISTS + CREATE,
-- bezstanowe REVOKE.
-- DOWÓD: supabase/tests/revenue_subscription_history_test.sql (pułapka
-- rangi, pauza, reaktywacja, waluta, idempotencja, windykacja, sandbox,
-- izolacja awarii szyny, usunięcie konta nie zmienia zamkniętych miesięcy).
-- ============================================================================

SET lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- A) Z-07: anonimizacja zamiast kaskady.
-- ----------------------------------------------------------------------------
ALTER TABLE public.subscription_state_history
  DROP CONSTRAINT IF EXISTS subscription_state_history_subscription_id_fkey;
ALTER TABLE public.subscription_state_history ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.mrr_movements DROP CONSTRAINT IF EXISTS mrr_movements_history_id_fkey;
ALTER TABLE public.mrr_movements
  ADD CONSTRAINT mrr_movements_history_id_fkey
  FOREIGN KEY (history_id) REFERENCES public.subscription_state_history(id) ON DELETE SET NULL;
ALTER TABLE public.mrr_movements ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.dunning_cycles DROP CONSTRAINT IF EXISTS dunning_cycles_subscription_id_fkey;
ALTER TABLE public.dunning_cycles ALTER COLUMN user_id DROP NOT NULL;

RESET lock_timeout;

CREATE INDEX IF NOT EXISTS dunning_cycles_subscription_idx
  ON public.dunning_cycles (subscription_id);

COMMENT ON COLUMN public.mrr_movements.user_id IS
  'Właściciel subskrypcji; NULL po usunięciu konta (Z-07: anonimizacja zamiast kaskady - zamknięte miesiące bez zmian).';
COMMENT ON COLUMN public.subscription_state_history.user_id IS
  'Właściciel subskrypcji; NULL po usunięciu konta (Z-07).';
COMMENT ON COLUMN public.dunning_cycles.user_id IS
  'Właściciel subskrypcji; NULL po usunięciu konta (Z-07).';

-- ----------------------------------------------------------------------------
-- B) Historia -> ruch po delcie -> cykl windykacji -> zdarzenia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_subscriptions_revenue_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_open record;
  v_after record;
  v_entry_before record;
  v_paid boolean;
  v_after_mrr integer := 0;
  v_after_cur text;
  v_before_mrr integer := 0;
  v_before_cur text;
  v_before_tier text;
  v_before_interval text;
  v_after_tier text;
  v_after_interval text;
  v_history_id bigint;
  v_dedupe text;
  v_switch boolean := false;
  v_kind text;
  v_reason text;
  v_status_before text;
  v_price_before text;
  v_qty_before integer;
  v_fail_before integer := 0;
  v_paused_after boolean;
  v_had_revenue boolean;
BEGIN
  -- ── Usunięcie subskrypcji (najczęściej kaskada z usunięcia konta) ────────
  IF TG_OP = 'DELETE' THEN
    BEGIN
      FOR v_open IN
        SELECT m.currency, sum(m.delta_minor)::integer AS amount,
               (array_agg(m.tier_key_after ORDER BY m.occurred_at DESC, m.id DESC))[1] AS tier,
               (array_agg(m.interval_after ORDER BY m.occurred_at DESC, m.id DESC))[1] AS intv
          FROM public.mrr_movements m
         WHERE m.subscription_id = OLD.id AND m.environment = OLD.environment
         GROUP BY m.currency
        HAVING sum(m.delta_minor) <> 0
      LOOP
        v_history_id := NULL;
        INSERT INTO public.subscription_state_history (
          tenant_id, subscription_id, user_id, environment, source_event_id,
          status_before, status_after, price_id_before, price_id_after,
          quantity_before, quantity_after, paused_after, cancel_at_period_end_after,
          payment_failure_count_after, mrr_before_minor, mrr_after_minor, currency,
          mrr_basis, dedupe_key)
        VALUES (
          OLD.tenant_id, OLD.id, NULL, OLD.environment, 'deleted',
          OLD.status, 'deleted', OLD.price_id, OLD.price_id,
          OLD.quantity, OLD.quantity, false, OLD.cancel_at_period_end,
          OLD.payment_failure_count, v_open.amount, 0, v_open.currency,
          NULL, 'deleted:' || OLD.id::text || ':' || v_open.currency)
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id INTO v_history_id;
        IF v_history_id IS NOT NULL THEN
          INSERT INTO public.mrr_movements (
            tenant_id, history_id, subscription_id, user_id, environment, occurred_at,
            kind, reason, mrr_before_minor, mrr_after_minor, currency,
            tier_key_before, tier_key_after, interval_before, interval_after, segment)
          VALUES (
            OLD.tenant_id, v_history_id, OLD.id, NULL, OLD.environment, now(),
            'churn', 'canceled', v_open.amount, 0, v_open.currency,
            v_open.tier, v_open.tier, v_open.intv, v_open.intv,
            public.revenue_segment_of_tier(v_open.tier));
        END IF;
      END LOOP;
      UPDATE public.mrr_movements SET user_id = NULL
       WHERE subscription_id = OLD.id AND user_id IS NOT NULL;
      UPDATE public.subscription_state_history SET user_id = NULL
       WHERE subscription_id = OLD.id AND user_id IS NOT NULL;
      UPDATE public.dunning_cycles
         SET user_id = NULL,
             lost_at = CASE WHEN outcome = 'open' THEN now() ELSE lost_at END,
             outcome = CASE WHEN outcome = 'open' THEN 'lost' ELSE outcome END
       WHERE subscription_id = OLD.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._log_emit_error(OLD.tenant_id, 'tg_subscriptions_revenue_history', 'ledger', SQLSTATE, SQLERRM);
    END;
    RETURN OLD;
  END IF;

  -- ── Zmiana bez znaczenia dla przychodu (strażnik zdarzeń, znaczniki) ─────
  IF TG_OP = 'UPDATE' AND NOT (
       OLD.status IS DISTINCT FROM NEW.status
    OR OLD.price_id IS DISTINCT FROM NEW.price_id
    OR OLD.quantity IS DISTINCT FROM NEW.quantity
    OR OLD.cancel_at_period_end IS DISTINCT FROM NEW.cancel_at_period_end
    OR OLD.pause_collection_behavior IS DISTINCT FROM NEW.pause_collection_behavior
    OR OLD.payment_failure_count IS DISTINCT FROM NEW.payment_failure_count
    OR OLD.unit_amount_minor IS DISTINCT FROM NEW.unit_amount_minor
    OR OLD.currency IS DISTINCT FROM NEW.currency
    OR OLD.discount_minor_per_period IS DISTINCT FROM NEW.discount_minor_per_period
    OR OLD.discount_ends_at IS DISTINCT FROM NEW.discount_ends_at
    OR OLD.environment IS DISTINCT FROM NEW.environment) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_status_before := OLD.status;
    v_price_before := OLD.price_id;
    v_qty_before := OLD.quantity;
    v_fail_before := COALESCE(OLD.payment_failure_count, 0);
  END IF;
  v_paused_after := NEW.status = 'paused' OR NEW.pause_collection_behavior IS NOT NULL;

  BEGIN
    SELECT * INTO v_after
      FROM public.subscription_mrr_minor(NEW.tenant_id, NEW.price_id, NEW.quantity,
             NEW.unit_amount_minor, NEW.currency, NEW.discount_minor_per_period,
             NEW.discount_ends_at, now());
    -- MRR liczy się wyłącznie w stanie płatnym bez pauzy (trial to jeszcze nie
    -- przychód; zaległość to klient do końca windykacji).
    v_paid := NEW.status IN ('active', 'past_due') AND NOT v_paused_after;
    v_after_cur := v_after.currency;
    v_after_tier := v_after.tier_key;
    v_after_interval := v_after.billing_interval;
    v_after_mrr := CASE WHEN v_paid THEN COALESCE(v_after.mrr_minor, 0) ELSE 0 END;

    -- Saldo księgi tej subskrypcji w walucie po zmianie (albo w jedynej
    -- otwartej) - „przed" bierzemy z księgi, nie z przeliczenia starego stanu.
    SELECT m.currency, sum(m.delta_minor)::integer AS amount,
           (array_agg(m.tier_key_after ORDER BY m.occurred_at DESC, m.id DESC))[1] AS tier,
           (array_agg(m.interval_after ORDER BY m.occurred_at DESC, m.id DESC))[1] AS intv
      INTO v_open
      FROM public.mrr_movements m
     WHERE m.subscription_id = NEW.id AND m.environment = NEW.environment
     GROUP BY m.currency
    HAVING sum(m.delta_minor) <> 0
     ORDER BY (m.currency = v_after_cur) DESC, m.currency
     LIMIT 1;
    IF FOUND THEN
      v_before_mrr := v_open.amount;
      v_before_cur := v_open.currency;
      v_before_tier := v_open.tier;
      v_before_interval := v_open.intv;
    END IF;
    IF v_before_tier IS NULL AND v_price_before IS NOT NULL THEN
      SELECT * INTO v_entry_before FROM public.billing_catalog_entry(v_price_before);
      IF FOUND THEN
        v_before_tier := v_entry_before.tier_key;
        v_before_interval := v_entry_before.billing_interval;
      END IF;
    END IF;

    v_dedupe := NEW.id::text || ':' || COALESCE(NEW.last_event_id, 'tx' || txid_current()::text) || ':'
      || md5(concat_ws('|', NEW.status, NEW.price_id, NEW.quantity, NEW.cancel_at_period_end,
                       NEW.pause_collection_behavior, NEW.payment_failure_count, NEW.unit_amount_minor,
                       NEW.currency, NEW.discount_minor_per_period, NEW.discount_ends_at, NEW.environment));

    INSERT INTO public.subscription_state_history (
      tenant_id, subscription_id, user_id, environment, source_event_id,
      status_before, status_after, price_id_before, price_id_after,
      quantity_before, quantity_after, paused_after, cancel_at_period_end_after,
      payment_failure_count_after, mrr_before_minor, mrr_after_minor, currency,
      mrr_basis, dedupe_key)
    VALUES (
      NEW.tenant_id, NEW.id, NEW.user_id, NEW.environment, NEW.last_event_id,
      v_status_before, NEW.status, v_price_before, NEW.price_id,
      v_qty_before, NEW.quantity, v_paused_after, NEW.cancel_at_period_end,
      COALESCE(NEW.payment_failure_count, 0), v_before_mrr,
      CASE WHEN v_paid THEN v_after.mrr_minor ELSE 0 END,
      COALESCE(v_after_cur, v_before_cur), v_after.basis, v_dedupe)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_history_id;

    IF v_history_id IS NOT NULL THEN
      -- Cena nieznana w stanie płatnym: nie wiemy, ile płaci - saldo zostaje.
      IF v_paid AND v_after.mrr_minor IS NULL THEN
        NULL;
      ELSE
        -- Odejście salda w innej walucie (zmiana waluty) albo do zera.
        IF v_before_mrr > 0 AND (v_after_mrr = 0 OR v_before_cur IS DISTINCT FROM v_after_cur) THEN
          v_switch := v_after_mrr > 0;
          v_reason := CASE
            WHEN v_switch THEN 'currency_switch'
            WHEN v_paused_after THEN 'paused'
            WHEN NEW.status = 'unpaid'
              OR (NEW.status IN ('canceled', 'incomplete_expired')
                  AND (COALESCE(NEW.payment_failure_count, 0) > 0 OR NEW.first_payment_failed_at IS NOT NULL))
              THEN 'unpaid'
            ELSE 'canceled'
          END;
          INSERT INTO public.mrr_movements (
            tenant_id, history_id, subscription_id, user_id, environment, occurred_at,
            kind, reason, mrr_before_minor, mrr_after_minor, currency,
            tier_key_before, tier_key_after, interval_before, interval_after, segment)
          VALUES (
            NEW.tenant_id, v_history_id, NEW.id, NEW.user_id, NEW.environment, now(),
            'churn', v_reason, v_before_mrr, 0, v_before_cur,
            v_before_tier, v_after_tier, v_before_interval, v_after_interval,
            public.revenue_segment_of_tier(v_before_tier));
        END IF;

        IF v_after_mrr > 0 AND (v_switch OR v_before_mrr = 0) THEN
          -- Powrót: ta subskrypcja albo to konto miało już przychód.
          v_had_revenue := EXISTS (
            SELECT 1 FROM public.mrr_movements m
             WHERE m.environment = NEW.environment
               AND m.kind IN ('new', 'reactivation')
               AND (m.subscription_id = NEW.id
                    OR (m.user_id = NEW.user_id AND m.tenant_id = NEW.tenant_id)));
          v_kind := CASE WHEN v_had_revenue AND NOT v_switch THEN 'reactivation' ELSE 'new' END;
          v_reason := CASE
            WHEN v_switch THEN 'currency_switch'
            WHEN v_status_before = 'trialing' THEN 'trial_converted'
            WHEN v_kind = 'reactivation' THEN 'resumed'
            ELSE 'signup'
          END;
          INSERT INTO public.mrr_movements (
            tenant_id, history_id, subscription_id, user_id, environment, occurred_at,
            kind, reason, mrr_before_minor, mrr_after_minor, currency,
            tier_key_before, tier_key_after, interval_before, interval_after, segment)
          VALUES (
            NEW.tenant_id, CASE WHEN v_switch THEN NULL ELSE v_history_id END, NEW.id, NEW.user_id,
            NEW.environment, now(), v_kind, v_reason, 0, v_after_mrr, v_after_cur,
            v_before_tier, v_after_tier, v_before_interval, v_after_interval,
            public.revenue_segment_of_tier(v_after_tier));
        ELSIF v_after_mrr > 0 AND v_before_mrr > 0 AND v_after_mrr <> v_before_mrr THEN
          v_reason := CASE
            WHEN v_price_before IS DISTINCT FROM NEW.price_id THEN 'plan_change'
            WHEN v_qty_before IS DISTINCT FROM NEW.quantity THEN 'quantity'
            WHEN TG_OP = 'UPDATE' AND (OLD.discount_minor_per_period IS DISTINCT FROM NEW.discount_minor_per_period
                  OR OLD.discount_ends_at IS DISTINCT FROM NEW.discount_ends_at) THEN 'discount'
            ELSE 'price'
          END;
          INSERT INTO public.mrr_movements (
            tenant_id, history_id, subscription_id, user_id, environment, occurred_at,
            kind, reason, mrr_before_minor, mrr_after_minor, currency,
            tier_key_before, tier_key_after, interval_before, interval_after, segment)
          VALUES (
            NEW.tenant_id, v_history_id, NEW.id, NEW.user_id, NEW.environment, now(),
            CASE WHEN v_after_mrr > v_before_mrr THEN 'expansion' ELSE 'contraction' END,
            v_reason, v_before_mrr, v_after_mrr, v_after_cur,
            v_before_tier, v_after_tier, v_before_interval, v_after_interval,
            public.revenue_segment_of_tier(v_after_tier));
        END IF;
      END IF;

      -- Cykl windykacji.
      IF v_fail_before = 0 AND COALESCE(NEW.payment_failure_count, 0) > 0 THEN
        INSERT INTO public.dunning_cycles (
          tenant_id, subscription_id, user_id, environment, started_at, failures,
          mrr_at_risk_minor, currency)
        VALUES (
          NEW.tenant_id, NEW.id, NEW.user_id, NEW.environment,
          COALESCE(NEW.first_payment_failed_at, NEW.last_payment_failed_at, now()),
          NEW.payment_failure_count, GREATEST(v_before_mrr, v_after_mrr),
          COALESCE(v_before_cur, v_after_cur, 'PLN'))
        ON CONFLICT (subscription_id) WHERE outcome = 'open'
        DO UPDATE SET failures = GREATEST(public.dunning_cycles.failures, EXCLUDED.failures);
      ELSIF COALESCE(NEW.payment_failure_count, 0) > v_fail_before THEN
        UPDATE public.dunning_cycles SET failures = NEW.payment_failure_count
         WHERE subscription_id = NEW.id AND outcome = 'open';
      END IF;
      IF v_fail_before > 0 AND COALESCE(NEW.payment_failure_count, 0) = 0
         AND NEW.status IN ('active', 'trialing') THEN
        UPDATE public.dunning_cycles SET outcome = 'recovered', recovered_at = now()
         WHERE subscription_id = NEW.id AND outcome = 'open';
      ELSIF NEW.status IN ('canceled', 'unpaid', 'incomplete_expired') THEN
        UPDATE public.dunning_cycles SET outcome = 'lost', lost_at = now()
         WHERE subscription_id = NEW.id AND outcome = 'open';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._log_emit_error(NEW.tenant_id, 'tg_subscriptions_revenue_history', 'ledger', SQLSTATE, SQLERRM);
  END;

  -- ── Zdarzenia: tylko pieniądze produkcyjne ────────────────────────────
  IF NEW.environment = 'live' THEN
    IF TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.cancel_at_period_end IS DISTINCT FROM NEW.cancel_at_period_end
       OR OLD.pause_collection_behavior IS DISTINCT FROM NEW.pause_collection_behavior THEN
      BEGIN
        PERFORM public.emit_domain_event(NEW.tenant_id, 'billing_subscription', NEW.id::text,
          'billing_subscription.status_changed.v1',
          jsonb_build_object('subscription_id', NEW.id, 'user_id', NEW.user_id,
            'old_status', v_status_before, 'new_status', NEW.status, 'paused', v_paused_after,
            'cancel_at_period_end', NEW.cancel_at_period_end, 'price_id', NEW.price_id),
          NEW.user_id);
      EXCEPTION WHEN OTHERS THEN
        PERFORM public._log_emit_error(NEW.tenant_id, 'tg_subscriptions_revenue_history',
          'billing_subscription.status_changed.v1', SQLSTATE, SQLERRM);
      END;
    END IF;
    IF v_fail_before = 0 AND COALESCE(NEW.payment_failure_count, 0) > 0 THEN
      BEGIN
        PERFORM public.emit_domain_event(NEW.tenant_id, 'billing_subscription', NEW.id::text,
          'billing_subscription.payment_failed.v1',
          jsonb_build_object('subscription_id', NEW.id, 'user_id', NEW.user_id,
            'failure_count', NEW.payment_failure_count, 'price_id', NEW.price_id),
          NEW.user_id);
      EXCEPTION WHEN OTHERS THEN
        PERFORM public._log_emit_error(NEW.tenant_id, 'tg_subscriptions_revenue_history',
          'billing_subscription.payment_failed.v1', SQLSTATE, SQLERRM);
      END;
    ELSIF v_fail_before > 0 AND COALESCE(NEW.payment_failure_count, 0) = 0 AND NEW.status = 'active' THEN
      BEGIN
        PERFORM public.emit_domain_event(NEW.tenant_id, 'billing_subscription', NEW.id::text,
          'billing_subscription.payment_recovered.v1',
          jsonb_build_object('subscription_id', NEW.id, 'user_id', NEW.user_id,
            'failure_count', 0, 'price_id', NEW.price_id),
          NEW.user_id);
      EXCEPTION WHEN OTHERS THEN
        PERFORM public._log_emit_error(NEW.tenant_id, 'tg_subscriptions_revenue_history',
          'billing_subscription.payment_recovered.v1', SQLSTATE, SQLERRM);
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_subscriptions_revenue_history() IS
  'Hub przychodu (S2): historia stanów -> ruch MRR po delcie -> cykl windykacji -> zdarzenia billing_subscription.* (live). DELETE: odejście salda + anonimizacja (Z-07).';

-- ----------------------------------------------------------------------------
-- C) Odnowienie subskrypcji z dokumentu operatora.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_billing_documents_renewed_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.subscription_id IS NULL OR NEW.order_id IS NOT NULL OR NEW.kind <> 'invoice'
     OR NEW.status <> 'paid' OR NEW.environment IS DISTINCT FROM 'live' OR NEW.provider = 'mock' THEN
    RETURN NEW;
  END IF;
  -- Faktura bywa zapisana jako `open` i opłacona dopiero przy kolejnej próbie
  -- (albo dostaje powiązanie i środowisko później) - zdarzenie idzie RAZ, przy
  -- pierwszym stanie spełniającym warunek.
  IF TG_OP = 'UPDATE' AND OLD.subscription_id IS NOT NULL AND OLD.order_id IS NULL
     AND OLD.kind = 'invoice' AND OLD.status = 'paid' AND OLD.environment = 'live'
     AND OLD.provider <> 'mock' THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.emit_domain_event(NEW.tenant_id, 'subscription', NEW.subscription_id::text,
      'subscription.renewed.v1',
      jsonb_build_object('subscription_id', NEW.subscription_id, 'user_id', NEW.user_id,
        'document_id', NEW.id),
      NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._log_emit_error(NEW.tenant_id, 'tg_billing_documents_renewed_emit',
      'subscription.renewed.v1', SQLSTATE, SQLERRM);
  END;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_billing_documents_renewed_emit() IS
  'Hub przychodu (S2): faktura odnowienia (subskrypcja, bez zamówienia, invoice, paid, live, nie mock) -> subscription.renewed.v1.';

SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_subscriptions_revenue_history ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_revenue_history
  AFTER INSERT OR UPDATE OR DELETE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_subscriptions_revenue_history();

DROP TRIGGER IF EXISTS trg_billing_documents_renewed_emit ON public.billing_documents;
CREATE TRIGGER trg_billing_documents_renewed_emit
  AFTER INSERT OR UPDATE OF subscription_id, environment, status ON public.billing_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_billing_documents_renewed_emit();

RESET lock_timeout;

REVOKE ALL ON FUNCTION public.tg_subscriptions_revenue_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_billing_documents_renewed_emit() FROM PUBLIC, anon, authenticated;
