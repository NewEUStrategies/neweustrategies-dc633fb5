-- events-harness: include
-- Individual closures use the same durable notification path as group closures.
CREATE OR REPLACE FUNCTION public._event_individual_ticket_closed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.status IN ('cancelled', 'rejected') AND OLD.status NOT IN ('cancelled', 'rejected'))
     OR (NEW.payment_status = 'refunded' AND OLD.payment_status <> 'refunded') THEN
    -- Leads already receive the registration decision / payment outcome notice.
    -- Cascades already carry their own stamp; add the missing individual guest path.
    IF NEW.group_lead_registration_id IS NOT NULL
       AND NEW.ticket_revoked_at IS NOT DISTINCT FROM OLD.ticket_revoked_at
       AND public._event_guest_ticket_reached(OLD) THEN
      NEW.ticket_revoked_at := clock_timestamp();
      NEW.ticket_revoked_notice_claimed_at := NULL;
    END IF;
    -- Keep the old hash for denied-scan attribution and offline reconciliation.
    -- Admission checks the current status/payment state, never the hash alone.
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._event_individual_ticket_closed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_00_close_notice ON public.event_registrations;
CREATE TRIGGER event_registrations_00_close_notice BEFORE UPDATE OF status, payment_status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_individual_ticket_closed();

-- Paid admission includes the legacy access projection used by online join links.
CREATE OR REPLACE FUNCTION public._event_paid_admission_rsvp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.event_people
  WHERE id = NEW.person_id AND tenant_id = NEW.tenant_id;
  IF NEW.status = 'approved' AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND (OLD.status <> 'approved' OR OLD.payment_status NOT IN ('paid', 'partially_refunded'))
     AND v_user IS NOT NULL THEN
    INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status)
    VALUES (NEW.tenant_id, NEW.event_id, v_user, 'going')
    ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'going';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._event_paid_admission_rsvp() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_zy_admission_rsvp ON public.event_registrations;
CREATE TRIGGER event_registrations_zy_admission_rsvp AFTER UPDATE OF status, payment_status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_paid_admission_rsvp();

-- Outbox: an organiser's rejection and the refund request commit together.
-- A group payment is refunded only after ALL registrations funded by it close.
-- Partial allocation is never guessed from today's ticket prices.
CREATE TABLE IF NOT EXISTS public.event_registration_refund_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  payment_order_id uuid NOT NULL UNIQUE REFERENCES public.payment_orders(id),
  registration_id uuid NOT NULL REFERENCES public.event_registrations(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'submitted', 'completed', 'failed', 'cancelled', 'needs_review')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claimed_at timestamptz,
  provider_refund_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, event_id) REFERENCES public.events(tenant_id, id)
);
ALTER TABLE public.event_registration_refund_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_registration_refund_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_registration_refund_jobs TO service_role;
CREATE INDEX IF NOT EXISTS event_refund_jobs_due ON public.event_registration_refund_jobs(next_attempt_at)
WHERE state IN ('pending', 'processing', 'failed');

CREATE OR REPLACE FUNCTION public._event_rejection_refund_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'rejected' AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND NEW.payment_order_id IS NOT NULL
     AND (OLD.status <> 'rejected' OR OLD.payment_status NOT IN ('paid', 'partially_refunded')) THEN
    INSERT INTO public.event_registration_refund_jobs(tenant_id, event_id, payment_order_id, registration_id)
    SELECT NEW.tenant_id, NEW.event_id, o.id, NEW.id FROM public.payment_orders o
    WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
      AND o.metadata->>'event_id' = NEW.event_id::text
      AND o.metadata->>'registration_id' = COALESCE(NEW.group_lead_registration_id, NEW.id)::text
    ON CONFLICT (payment_order_id) DO UPDATE SET state = 'pending', last_error = NULL,
      next_attempt_at = now(), updated_at = now()
    WHERE event_registration_refund_jobs.state IN ('needs_review', 'cancelled');
  END IF;
  IF NEW.payment_status = 'refunded' AND NEW.payment_order_id IS NOT NULL THEN
    UPDATE public.event_registration_refund_jobs SET state = 'completed', claim_token = NULL, updated_at = now()
    WHERE payment_order_id = NEW.payment_order_id AND tenant_id = NEW.tenant_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._event_rejection_refund_queue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_zz_refund_queue ON public.event_registrations;
CREATE TRIGGER event_registrations_zz_refund_queue AFTER UPDATE OF status, payment_status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_rejection_refund_queue();

CREATE OR REPLACE FUNCTION public._event_refund_reapproval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('cancelled', 'rejected') AND NEW.status NOT IN ('cancelled', 'rejected') THEN
    PERFORM 1 FROM public.event_registration_refund_jobs j
    WHERE j.payment_order_id = NEW.payment_order_id AND j.tenant_id = NEW.tenant_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.event_registration_refund_jobs j
      WHERE j.payment_order_id = NEW.payment_order_id AND j.tenant_id = NEW.tenant_id
        AND j.state IN ('processing', 'submitted')) THEN
      RAISE EXCEPTION 'invalid_transition: refund already in progress; create a new registration';
    END IF;
    UPDATE public.event_registration_refund_jobs SET state = 'cancelled', updated_at = now()
    WHERE payment_order_id = NEW.payment_order_id AND tenant_id = NEW.tenant_id
      AND state IN ('pending', 'failed', 'needs_review');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._event_refund_reapproval_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_refund_reapproval ON public.event_registrations;
CREATE TRIGGER event_registrations_refund_reapproval BEFORE UPDATE OF status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_refund_reapproval_guard();

CREATE OR REPLACE FUNCTION public._event_registration_refunds_claim(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_jobs jsonb;
BEGIN
  UPDATE public.event_registration_refund_jobs j SET state = 'completed', claim_token = NULL, updated_at = now()
  FROM public.payment_orders o WHERE o.id = j.payment_order_id AND o.tenant_id = j.tenant_id
    AND o.status = 'refunded' AND j.state <> 'completed';
  -- Cases needing a partial allocation stay visible in the admin journal.
  UPDATE public.event_registration_refund_jobs j SET state = 'needs_review',
    last_error = 'active_registrations_share_payment', updated_at = now()
  WHERE j.state IN ('pending', 'failed') AND EXISTS (
    SELECT 1 FROM public.event_registrations r WHERE r.payment_order_id = j.payment_order_id
      AND r.tenant_id = j.tenant_id AND r.status NOT IN ('cancelled', 'rejected'));
  WITH picked AS (
    SELECT j.id FROM public.event_registration_refund_jobs j
    WHERE (j.state IN ('pending', 'failed') AND j.next_attempt_at <= now() AND j.attempts < 10)
       OR (j.state = 'processing' AND j.claimed_at < now() - interval '15 minutes')
    ORDER BY j.created_at, j.id LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.event_registration_refund_jobs j SET state = 'processing',
      claim_token = gen_random_uuid(), claimed_at = clock_timestamp(), attempts = attempts + 1, updated_at = now()
    FROM picked p WHERE j.id = p.id RETURNING j.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', j.id, 'claim_token', j.claim_token, 'order_id', o.id, 'tenant_id', j.tenant_id,
    'environment', o.environment, 'provider', o.provider,
    'transaction_id', COALESCE(o.provider_payment_intent_id, o.provider_intent_id, o.provider_session_id),
    'order_status', o.status)), '[]'::jsonb) INTO v_jobs
  FROM claimed j JOIN public.payment_orders o ON o.id = j.payment_order_id AND o.tenant_id = j.tenant_id;
  RETURN v_jobs;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refunds_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refunds_claim(integer) TO service_role;

CREATE OR REPLACE FUNCTION public._event_registration_refunds_settle(
  p_job_id uuid, p_claim_token uuid, p_refund_id text, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.event_registration_refund_jobs SET
    state = CASE WHEN p_error IS NULL AND p_refund_id IS NOT NULL THEN 'submitted' ELSE 'failed' END,
    provider_refund_id = p_refund_id, last_error = left(p_error, 500), claim_token = NULL,
    next_attempt_at = now() + make_interval(mins => LEAST(1440, (power(2, LEAST(attempts, 10)))::integer)), updated_at = now()
  WHERE id = p_job_id AND claim_token = p_claim_token AND state = 'processing';
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refunds_settle(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refunds_settle(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_event_refund_jobs(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant(); v_jobs jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC), '[]'::jsonb)
  INTO v_jobs FROM (
    SELECT j.id, j.payment_order_id, j.state, j.attempts, j.created_at,
      j.next_attempt_at, j.last_error,
      concat_ws(' ', p.first_name, p.last_name) AS person_name
    FROM public.event_registration_refund_jobs j
    JOIN public.event_registrations r ON r.id = j.registration_id AND r.tenant_id = j.tenant_id
    JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE j.tenant_id = v_tenant AND j.event_id = p_event_id
    ORDER BY j.created_at DESC, j.id DESC LIMIT 100
  ) j;
  RETURN v_jobs;
END $$;
REVOKE ALL ON FUNCTION public.admin_event_refund_jobs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_refund_jobs(uuid) TO authenticated, service_role;
