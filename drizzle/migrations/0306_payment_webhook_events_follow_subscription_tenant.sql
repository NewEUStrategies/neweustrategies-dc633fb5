-- ============================================================================
-- ZDARZENIA WEBHOOKA PŁATNOŚCI: NAJEMCA ZA PRZEPIĘTĄ SUBSKRYPCJĄ.
--
-- DEFEKT (następstwo 20261007140300_subscriptions_tenant_from_owner).
-- Dopóki pas drizzle nie niósł triggera `subscriptions_pin_tenant`, webhook
-- operatora płatności zakładał wiersz `subscriptions` bez `tenant_id`, a pod
-- rolą serwisową DEFAULT public_tenant_id() oddawał najemcę DOMYŚLNEGO.
-- Kaskada `payment_webhook_event_tenant()` (20260913100000) wiąże zdarzenie bez
-- `user_id` (`invoice.*`, `charge.*`) z najemcą SUBSKRYPCJI - kroki (b) i (d) -
-- więc takie zdarzenia konta z innego najemcy lądowały w puli domyślnej: admin
-- najemcy domyślnego widział je w dzienniku i zdrowiu webhooków (z ładunkiem),
-- a właściwy najemca nie widział ich wcale.
--
-- Uzgodnienie subskrypcji (20261007140300, w pasie drizzle 0305) przepina
-- `subscriptions.tenant_id` do profilu właściciela, ale zdarzeń nie rusza:
-- trigger `payment_webhook_events_bind_tenant` odpala wyłącznie przy INSERT
-- i UPDATE OF user_id, customer_id, subscription_id.
--
-- ZMIANA: ten sam backfill co 20260913100000 (sekcja 3), uruchomiony PO
-- przepięciu subskrypcji - wiersze puli domyślnej rozstrzygane od nowa tą samą
-- kaskadą, która teraz czyta poprawionego najemcę subskrypcji. Zakres celowo
-- jak tam: wyłącznie `tenant_id = email_default_tenant_id()`; wiersz stojący
-- gdzie indziej rozstrzygnął już mocniejszy nośnik. Wiersz, którego kaskada nie
-- rozstrzyga, zostaje, gdzie jest. UPDATE nie zmienia kolumn wyzwalających
-- trigger, więc kaskada nie liczy się drugi raz.
--
-- KONTO PRZENIESIONE Z NAJEMCY DOMYŚLNEGO. Kaskada zaczyna od profilu
-- płatnika (krok (a)), więc zdarzenie z `user_id` konta, które po płatności
-- przeniesiono do innego najemcy, idzie za BIEŻĄCYM profilem - razem
-- z subskrypcją, którą 20261007140300 przepina do tego samego profilu. Ta sama
-- reguła działa już na żywo (trigger przelicza najemcę przy każdym zapisie
-- `user_id`, `customer_id` albo `subscription_id`, np. przy domknięciu
-- zdarzenia z identyfikatorem subskrypcji), a backfill 20260913100000
-- przeliczył pulę domyślną tą samą kaskadą. Zawężenie do `user_id IS NULL`
-- rozdzieliłoby jeden zakup między dwóch najemców: płatność w domyślnym,
-- faktury i subskrypcja w nowym.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261007140300 (pas drizzle: 0305 przed 0306).
-- Kod się nie zmienia.
-- IDEMPOTENTNA: drugi przebieg nie znajduje już wierszy do przepięcia.
-- DOWÓD: supabase/tests/payment_webhook_events_follow_subscription_tenant_test.sql.
-- ============================================================================

WITH resolved AS (
  SELECT
    e.id,
    public.payment_webhook_event_tenant(
      e.user_id, e.customer_id, e.subscription_id, e.environment, e.payload
    ) AS tenant_id
  FROM public.payment_webhook_events e
  WHERE e.tenant_id = public.email_default_tenant_id()
)
UPDATE public.payment_webhook_events e
   SET tenant_id = r.tenant_id
  FROM resolved r
 WHERE r.id = e.id
   AND r.tenant_id IS NOT NULL
   AND r.tenant_id IS DISTINCT FROM e.tenant_id;
