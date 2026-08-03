ALTER TABLE public.payment_orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.payment_orders DROP CONSTRAINT IF EXISTS payment_orders_user_id_fkey;
ALTER TABLE public.payment_orders ADD CONSTRAINT payment_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.payment_orders.user_id IS 'Kupujący. NULL = konto usunięte, a zamówienie zostało jako dowód księgowy (art. 74 uor); tożsamość zredukowana do subject_ref. FK ON DELETE SET NULL - nigdy CASCADE.';

ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS subject_ref text,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until date,
  ADD COLUMN IF NOT EXISTS retention_hold boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payment_orders.subject_ref IS 'Pseudonim kupującego (SHA-256 identyfikatora z separacją domeny) nadawany przy anonimizacji. Umożliwia uzgodnienie ksiąg bez danych osobowych; nieodwracalny.';
COMMENT ON COLUMN public.payment_orders.anonymized_at IS 'Moment anonimizacji po usunięciu konta. NULL = zamówienie ma żywego właściciela.';
COMMENT ON COLUMN public.payment_orders.retention_until IS 'Ostatni dzień obowiązkowego przechowywania (31.12 piątego roku po roku transakcji, art. 74 ust. 2 uor). Stemplowane triggerem.';
COMMENT ON COLUMN public.payment_orders.retention_hold IS 'Blokada czyszczenia ponad okres ustawowy (kontrola skarbowa, spór, chargeback). Ustawiana wyłącznie przez service_role.';

ALTER TABLE public.payment_orders DROP CONSTRAINT IF EXISTS payment_orders_anonymized_shape_chk;
ALTER TABLE public.payment_orders ADD CONSTRAINT payment_orders_anonymized_shape_chk CHECK (
  (anonymized_at IS NULL AND subject_ref IS NULL)
  OR (anonymized_at IS NOT NULL AND subject_ref IS NOT NULL AND user_id IS NULL)
);

CREATE INDEX IF NOT EXISTS payment_orders_subject_ref_idx ON public.payment_orders (subject_ref) WHERE subject_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_orders_retention_idx ON public.payment_orders (retention_until) WHERE anonymized_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.accounting_retention_until(p_at timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT make_date(EXTRACT(YEAR FROM (p_at AT TIME ZONE 'Europe/Warsaw'))::int + 5, 12, 31);
$$;
COMMENT ON FUNCTION public.accounting_retention_until(timestamptz) IS 'Data końca ustawowej retencji dowodu księgowego z podanej chwili (art. 74 ust. 2 uor): 31.12 piątego roku po roku obrotowym.';

CREATE OR REPLACE FUNCTION public.accounting_subject_ref(p_user_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT encode(sha256(convert_to('nes:accounting-subject:v1:' || p_user_id::text, 'utf8')), 'hex');
$$;
COMMENT ON FUNCTION public.accounting_subject_ref(uuid) IS 'Jednokierunkowy pseudonim kupującego używany w zanonimizowanych dowodach księgowych.';

CREATE OR REPLACE FUNCTION public.accounting_metadata_minimum(p_metadata jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    FROM jsonb_each(COALESCE(p_metadata, '{}'::jsonb)) AS entry
   WHERE entry.key IN ('label','event_id','quantity','coupon_code','coupon_id','coupon_discount_cents','original_amount_cents');
$$;
COMMENT ON FUNCTION public.accounting_metadata_minimum(jsonb) IS 'Metadane zamówienia obcięte allowlistą do kluczy o znaczeniu księgowym - używane przy anonimizacji.';

CREATE OR REPLACE FUNCTION public.tg_payment_orders_stamp_retention()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.retention_until := public.accounting_retention_until(COALESCE(NEW.paid_at, NEW.created_at, now()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_orders_stamp_retention ON public.payment_orders;
CREATE TRIGGER payment_orders_stamp_retention BEFORE INSERT OR UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_orders_stamp_retention();

UPDATE public.payment_orders SET retention_until = public.accounting_retention_until(COALESCE(paid_at, created_at)) WHERE retention_until IS NULL;

CREATE OR REPLACE FUNCTION public.anonymize_payment_orders_for_user(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_retained integer := 0;
  v_discarded integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('retained', 0, 'discarded', 0);
  END IF;

  DELETE FROM public.payment_orders o
   WHERE o.user_id = p_user_id
     AND o.paid_at IS NULL
     AND o.provider_intent_id IS NULL
     AND o.provider_session_id IS NULL
     AND o.provider_subscription_id IS NULL
     AND o.status IN ('pending', 'failed', 'canceled')
     AND NOT EXISTS (SELECT 1 FROM public.billing_documents bd WHERE bd.order_id = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.b2b_coupon_redemptions r WHERE r.order_id = o.id);
  GET DIAGNOSTICS v_discarded = ROW_COUNT;

  UPDATE public.payment_orders o
     SET user_id = NULL,
         subject_ref = public.accounting_subject_ref(p_user_id),
         anonymized_at = COALESCE(o.anonymized_at, now()),
         receipt_email = NULL,
         metadata = public.accounting_metadata_minimum(o.metadata),
         updated_at = now()
   WHERE o.user_id = p_user_id;
  GET DIAGNOSTICS v_retained = ROW_COUNT;

  RETURN jsonb_build_object('retained', v_retained, 'discarded', v_discarded);
END;
$$;
COMMENT ON FUNCTION public.anonymize_payment_orders_for_user(uuid) IS 'Realizuje "SET NULL + anonimizacja" dla zamówień usuwanego konta: dowody księgowe zostają bez danych osobowych, porzucone szkice checkoutu są usuwane. Zwraca {retained, discarded}.';
REVOKE EXECUTE ON FUNCTION public.anonymize_payment_orders_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_payment_orders_for_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_auth_user_deleted_retain_accounting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.anonymize_payment_orders_for_user(OLD.id);
  RETURN OLD;
END;
$$;
COMMENT ON FUNCTION public.tg_auth_user_deleted_retain_accounting() IS 'BEFORE DELETE na auth.users: anonimizuje zamówienia zanim zniknie konto, także przy usunięciu poza aplikacją.';

CREATE OR REPLACE FUNCTION public.purge_expired_payment_orders()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.payment_orders o
   WHERE o.anonymized_at IS NOT NULL
     AND o.user_id IS NULL
     AND o.retention_hold = false
     AND o.retention_until IS NOT NULL
     AND o.retention_until < current_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
COMMENT ON FUNCTION public.purge_expired_payment_orders() IS 'Usuwa zanonimizowane zamówienia po upływie ustawowego okresu retencji (art. 5 ust. 1 lit. e RODO). Pomija wiersze z retention_hold.';
REVOKE EXECUTE ON FUNCTION public.purge_expired_payment_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_payment_orders() TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('purge-expired-payment-orders', '35 3 * * *', 'SELECT public.purge_expired_payment_orders()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;

REVOKE DELETE ON public.payment_orders FROM authenticated;

COMMENT ON TABLE public.payment_orders IS 'Ewidencja transakcji (subskrypcje, zakupy jednorazowe, bilety). Dowód księgowy: przeżywa usunięcie konta (user_id ON DELETE SET NULL + anonimizacja), znika dopiero po retention_until.';

REVOKE ALL ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, text, text) TO service_role;
COMMENT ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, text, text) IS 'Kanoniczny producent powiadomień (SECURITY DEFINER). Bramkuje rodzaj po notification_preferences.enabled_<rodzaj> odbiorcy (security zawsze dociera), stempluje tenant z profilu odbiorcy i deduplikuje po (user, kind, href) w oknie 5 minut. WYŁĄCZNIE serwerowa: wołana przez funkcje SECURITY DEFINER i service_role - bez grantu dla ról klienckich. Kontrakt pilnuje supabase/tests/notification_preferences_gating_test.sql.';