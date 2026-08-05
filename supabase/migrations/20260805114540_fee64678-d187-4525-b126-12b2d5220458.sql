ALTER TABLE public.user_purchases
  ADD COLUMN IF NOT EXISTS subject_ref text,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until date,
  ADD COLUMN IF NOT EXISTS retention_hold boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.tg_user_purchases_stamp_retention()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.retention_until := public.accounting_retention_until(
    COALESCE(NEW.purchased_at, now())
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_purchases_stamp_retention ON public.user_purchases;
CREATE TRIGGER user_purchases_stamp_retention
  BEFORE INSERT OR UPDATE ON public.user_purchases
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_purchases_stamp_retention();

UPDATE public.user_purchases
   SET retention_until = public.accounting_retention_until(purchased_at)
 WHERE retention_until IS NULL;

ALTER TABLE public.user_purchases
  ALTER COLUMN user_id DROP NOT NULL;

DELETE FROM public.user_purchases p
 WHERE p.user_id IS NOT NULL
   AND COALESCE(p.amount_cents, 0) <= 0
   AND p.external_ref IS NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

UPDATE public.user_purchases p
   SET user_id       = NULL,
       subject_ref   = public.accounting_subject_ref(p.user_id),
       anonymized_at = COALESCE(p.anonymized_at, now())
 WHERE p.user_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

ALTER TABLE public.user_purchases
  DROP CONSTRAINT IF EXISTS user_purchases_user_id_fkey;

ALTER TABLE public.user_purchases
  ADD CONSTRAINT user_purchases_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.user_purchases
  DROP CONSTRAINT IF EXISTS user_purchases_anonymized_shape_chk;
ALTER TABLE public.user_purchases
  ADD CONSTRAINT user_purchases_anonymized_shape_chk CHECK (
    (anonymized_at IS NULL AND subject_ref IS NULL)
    OR (anonymized_at IS NOT NULL AND subject_ref IS NOT NULL AND user_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS user_purchases_subject_ref_idx
  ON public.user_purchases (subject_ref) WHERE subject_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_purchases_retention_idx
  ON public.user_purchases (retention_until) WHERE anonymized_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.anonymize_user_purchases_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retained integer := 0;
  v_discarded integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('retained', 0, 'discarded', 0);
  END IF;
  DELETE FROM public.user_purchases p
   WHERE p.user_id = p_user_id
     AND COALESCE(p.amount_cents, 0) <= 0
     AND p.external_ref IS NULL;
  GET DIAGNOSTICS v_discarded = ROW_COUNT;
  UPDATE public.user_purchases p
     SET user_id       = NULL,
         subject_ref   = public.accounting_subject_ref(p_user_id),
         anonymized_at = COALESCE(p.anonymized_at, now())
   WHERE p.user_id = p_user_id;
  GET DIAGNOSTICS v_retained = ROW_COUNT;
  RETURN jsonb_build_object('retained', v_retained, 'discarded', v_discarded);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anonymize_user_purchases_for_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user_purchases_for_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.anonymize_accounting_evidence_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders jsonb;
  v_purchases jsonb;
BEGIN
  v_orders := public.anonymize_payment_orders_for_user(p_user_id);
  v_purchases := public.anonymize_user_purchases_for_user(p_user_id);
  RETURN jsonb_build_object(
    'orders', v_orders,
    'purchases', v_purchases,
    'retained', COALESCE((v_orders ->> 'retained')::int, 0),
    'discarded', COALESCE((v_orders ->> 'discarded')::int, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anonymize_accounting_evidence_for_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_accounting_evidence_for_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_auth_user_deleted_retain_accounting()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.anonymize_accounting_evidence_for_user(OLD.id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted_retain_accounting ON auth.users;
CREATE TRIGGER on_auth_user_deleted_retain_accounting
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_auth_user_deleted_retain_accounting();

CREATE OR REPLACE FUNCTION public.purge_expired_user_purchases()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.user_purchases p
   WHERE p.anonymized_at IS NOT NULL
     AND p.user_id IS NULL
     AND p.retention_hold = false
     AND p.retention_until IS NOT NULL
     AND p.retention_until < current_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_user_purchases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_user_purchases() TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_accounting_evidence()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders integer := public.purge_expired_payment_orders();
  v_purchases integer := public.purge_expired_user_purchases();
BEGIN
  RETURN jsonb_build_object('orders', v_orders, 'purchases', v_purchases);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_accounting_evidence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_accounting_evidence() TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    BEGIN
      PERFORM cron.unschedule('purge-expired-payment-orders');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'no legacy purge job to unschedule';
    END;
    PERFORM cron.schedule('purge-expired-accounting-evidence', '35 3 * * *',
      'SELECT public.purge_expired_accounting_evidence()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - accounting retention purged only on demand';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;

REVOKE DELETE, UPDATE, TRUNCATE ON public.user_purchases FROM authenticated;
REVOKE ALL ON public.user_purchases FROM anon;