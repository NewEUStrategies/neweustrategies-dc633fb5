-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S3, 4/5): ZDARZENIA KASY -
-- `checkout.started|completed|failed|abandoned.v1`.
--
-- DEFEKT
--   1. Kasa nie zostawia faktów na szynie: zamówienie (`payment_orders`)
--      zmienia status w webhooku, a lejek huba, karta zamówień w profilu
--      i ścieżki (S5: „porzucony koszyk") widzą zmianę dopiero po
--      przeładowaniu. Mapa inwalidacji I0 ma reguły dla tych typów -
--      brakowało emitera.
--   2. Porzucona kasa (P22) nie istnieje jako zdarzenie: wygasła sesja
--      kończy się `canceled` tak samo jak anulowanie ręczne, więc ścieżka
--      przypomnienia nie odróżniłaby „zrezygnował" od „zapomniał".
--
-- ZMIANA
--   `tg_payment_orders_checkout_emit` (rejestr S3, rodzaj `trigger`) -
--   AFTER INSERT OR UPDATE OF status ON `payment_orders`:
--     * wyłącznie `environment = 'live'` i `provider <> 'mock'` - zamówienia
--       testowe i atrapa kasy nie pompują lejka ani nie budzą ścieżek;
--     * INSERT -> `checkout.started.v1` (zamówienie założone w kasie;
--       zamówienie wstawione od razu jako `paid` dostaje też `completed`);
--     * UPDATE statusu (`IS DISTINCT FROM`): -> `paid` = `completed`,
--       -> `failed` = `failed`, -> `canceled` z `metadata.cancel_reason =
--       'session_expired'` = `abandoned` (zapisuje go webhook
--       `checkout.session.expired`, `expireCheckoutOrder`). Anulowanie bez
--       tego powodu (zastąpiona sesja, ręczne) NIE jest porzuceniem;
--     * payload bez PII: `order_id`, `user_id`, `kind`, `plan_id`,
--       `tier_key` (z planu), `event_id` (z metadanych biletu), `amount_minor`,
--       `currency`, `has_coupon`; `reason` przy `failed`/`abandoned`.
--       Klucze z wartością NULL są pomijane (`jsonb_strip_nulls`);
--     * agregat `checkout`, `aggregate_id` = id zamówienia, aktor = kupujący
--       (zmianę statusu robi webhook spod `service_role`, który aktora nie ma).
--   Każdy typ ma JEDNO wywołanie `emit_domain_event` z literałem typu (skaner
--   katalogu, K-03). Awaria szyny nie przerywa zapisu zamówienia
--   (`_log_emit_error`, Z-02) - webhook płatności nigdy nie pada przez lejek.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020090500 (`_log_emit_error`). Kod TS
-- zapisujący `cancel_reason` (`oneTimeFulfilment.server.ts`) może wejść przed
-- albo po tej migracji: bez niego wygaśnięcie emituje tylko brak zdarzenia.
-- `payment_orders` jest gorącą tabelą (webhooki) - CREATE TRIGGER pod
-- `lock_timeout`; błąd 55P03 = ponów cały plik.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowa sygnatura), DROP TRIGGER IF
-- EXISTS + CREATE TRIGGER, bezstanowe REVOKE.
-- DOWÓD: supabase/tests/checkout_events_test.sql (4 typy, sandbox i mock bez
-- zdarzeń, `abandoned` tylko z `session_expired`, awaria emitera nie przerywa
-- zapisu zamówienia), src/lib/billing/__tests__/oneTimeFulfilmentExpire.test.ts.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_payment_orders_checkout_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier text;
  v_base jsonb;
  v_started boolean := false;
  v_completed boolean := false;
  v_failed boolean := false;
  v_abandoned boolean := false;
  -- Typ w toku - do śladu awarii (jeden blok EXCEPTION na cztery emisje).
  v_type text := 'checkout';
BEGIN
  -- Pieniądze tylko z produkcji: sandbox i atrapa kasy nie są lejkiem.
  IF NEW.environment IS DISTINCT FROM 'live' OR NEW.provider = 'mock' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_started := true;
    v_completed := NEW.status = 'paid';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_completed := NEW.status = 'paid';
    v_failed := NEW.status = 'failed';
    v_abandoned := NEW.status = 'canceled'
      AND COALESCE(NEW.metadata ->> 'cancel_reason', '') = 'session_expired';
  END IF;
  IF NOT (v_started OR v_completed OR v_failed OR v_abandoned) THEN
    RETURN NULL;
  END IF;

  SELECT ap.tier_key INTO v_tier FROM public.access_plans ap WHERE ap.id = NEW.plan_id;
  v_base := jsonb_strip_nulls(jsonb_build_object(
    'order_id', NEW.id,
    'user_id', NEW.user_id,
    'kind', NEW.kind,
    'plan_id', NEW.plan_id,
    'tier_key', v_tier,
    'event_id', NEW.metadata ->> 'event_id',
    'amount_minor', NEW.amount_cents,
    'currency', NEW.currency,
    'has_coupon', (NEW.metadata ? 'coupon_id')
  ));

  IF v_started THEN
    v_type := 'checkout.started.v1';
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'checkout', NEW.id::text, 'checkout.started.v1', v_base, NEW.user_id
    );
  END IF;
  IF v_completed THEN
    v_type := 'checkout.completed.v1';
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'checkout', NEW.id::text, 'checkout.completed.v1', v_base, NEW.user_id
    );
  END IF;
  IF v_failed THEN
    v_type := 'checkout.failed.v1';
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'checkout', NEW.id::text, 'checkout.failed.v1',
      v_base || jsonb_build_object(
        'reason', COALESCE(NEW.metadata ->> 'failure_reason', 'payment_failed')
      ),
      NEW.user_id
    );
  END IF;
  IF v_abandoned THEN
    v_type := 'checkout.abandoned.v1';
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'checkout', NEW.id::text, 'checkout.abandoned.v1',
      v_base || jsonb_build_object('reason', 'session_expired'),
      NEW.user_id
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_payment_orders_checkout_emit', v_type, SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_payment_orders_checkout_emit() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_payment_orders_checkout_emit() IS
  'Hub S3: checkout.started|completed|failed|abandoned.v1 - tylko live i nie mock; abandoned = canceled z metadata.cancel_reason=session_expired; payload bez PII; awaria szyny nie przerywa zapisu zamówienia.';

SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS payment_orders_checkout_emit ON public.payment_orders;
CREATE TRIGGER payment_orders_checkout_emit
  AFTER INSERT OR UPDATE OF status ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_orders_checkout_emit();

RESET lock_timeout;
