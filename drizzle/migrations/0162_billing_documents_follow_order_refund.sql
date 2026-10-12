-- ============================================================================
-- DOKUMENT ROZLICZENIOWY IDZIE ZA ZWROTEM ZAMOWIENIA (audyt INV-07, domkniecie).
--
-- DEFEKT. Kopia PDF czlonka bierze linie stanu z `billing_documents.status`
-- (20261012110000: "Zaplacono" tylko dla `paid`, "Zwrocono" dla `refunded`),
-- ale zaden zapis nie ustawial `refunded`: zwrot zamowienia (webhook
-- `charge.refunded` -> `refunds.server.ts`, zwroty organizatora, zadania
-- zwrotu wydarzen) zmienial wylacznie `payment_orders.status`. Dokument
-- zwroconego zakupu nadal drukowal "Zaplacono".
--
-- ZMIANA. Trigger na `payment_orders`: gdy zamowienie PRZECHODZI w stan
-- `refunded` (pelny zwrot - zwrot czesciowy zostawia `paid`), jego dokumenty
-- (`billing_documents.order_id`, ten sam najemca) dostaja `refunded`. Trigger,
-- a nie kod TS, bo zamowienie zamyka kilka niezaleznych sciezek - kazda
-- przyszla tez. Dokument `void` zostaje `void` (anulowany nie byl zaplacony).
-- Emiter `trg_billing_documents_emit_events` publikuje zmiane stanu jak przy
-- kazdej innej aktualizacji.
--
-- Wiersze sprzed migracji: jednorazowe uzupelnienie dla zamowien juz
-- zwroconych.
--
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, warunek na stanie.
-- DOWOD: supabase/tests/billing_documents_snapshot_test.sql (sekcja zwrotu).
-- ============================================================================

CREATE OR REPLACE FUNCTION public._billing_documents_follow_order_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.billing_documents d
     SET status = 'refunded'
   WHERE d.order_id = NEW.id
     AND d.tenant_id = NEW.tenant_id
     AND d.status = 'paid';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._billing_documents_follow_order_refund() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._billing_documents_follow_order_refund() IS
  'Pelny zwrot zamowienia (payment_orders.status -> refunded) oznacza jego dokumenty rozliczeniowe jako refunded - kopia PDF czlonka nie drukuje wtedy "Zaplacono".';

DROP TRIGGER IF EXISTS payment_orders_zz_billing_document_refund ON public.payment_orders;
CREATE TRIGGER payment_orders_zz_billing_document_refund
  AFTER UPDATE OF status ON public.payment_orders
  FOR EACH ROW
  WHEN (NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM 'refunded')
  EXECUTE FUNCTION public._billing_documents_follow_order_refund();

UPDATE public.billing_documents d
   SET status = 'refunded'
  FROM public.payment_orders o
 WHERE d.order_id = o.id
   AND d.tenant_id = o.tenant_id
   AND o.status = 'refunded'
   AND d.status = 'paid';