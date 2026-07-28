-- 1) Fixed search_path for email queue helpers (SUPA_function_search_path_mutable)
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = pgmq, public, pg_temp;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = pgmq, public, pg_temp;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = pgmq, public, pg_temp;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = pgmq, public, pg_temp;

-- 2) expert_inmails: senders must not be able to forge outcome fields
DROP POLICY IF EXISTS "inmails: sender or admin may update" ON public.expert_inmails;

CREATE POLICY "inmails: sender may cancel own request"
ON public.expert_inmails
FOR UPDATE
TO authenticated
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

CREATE POLICY "inmails: recipient may respond"
ON public.expert_inmails
FOR UPDATE
TO authenticated
USING (recipient_id = auth.uid())
WITH CHECK (recipient_id = auth.uid());

CREATE POLICY "inmails: admin may update"
ON public.expert_inmails
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- Column-level enforcement (RLS cannot express it): senders may only cancel.
CREATE OR REPLACE FUNCTION public.expert_inmails_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR public.is_super_admin(uid) THEN
    RETURN NEW;
  END IF;

  -- Immutable identity/ownership columns for every non-admin actor.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'expert_inmails: immutable columns cannot be changed';
  END IF;

  IF uid = OLD.recipient_id THEN
    -- Recipient decides the outcome, but never writes admin notes.
    IF NEW.admin_note IS DISTINCT FROM OLD.admin_note THEN
      RAISE EXCEPTION 'expert_inmails: only admins can set admin_note';
    END IF;
    IF NEW.status NOT IN ('pending', 'approved', 'declined', 'answered') THEN
      RAISE EXCEPTION 'expert_inmails: invalid status transition for recipient';
    END IF;
    RETURN NEW;
  END IF;

  IF uid = OLD.sender_id THEN
    -- Sender may only withdraw their own pending request.
    IF NEW.admin_note IS DISTINCT FROM OLD.admin_note
       OR NEW.decline_reason IS DISTINCT FROM OLD.decline_reason
       OR NEW.converted_conversation_id IS DISTINCT FROM OLD.converted_conversation_id
       OR NEW.responded_at IS DISTINCT FROM OLD.responded_at
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.questions IS DISTINCT FROM OLD.questions
       OR NEW.expected_answers IS DISTINCT FROM OLD.expected_answers
       OR NEW.external_links IS DISTINCT FROM OLD.external_links THEN
      RAISE EXCEPTION 'expert_inmails: senders may only cancel their request';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'expert_inmails: senders may only cancel their request';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'expert_inmails: not allowed';
END;
$$;

DROP TRIGGER IF EXISTS expert_inmails_guard_update ON public.expert_inmails;
CREATE TRIGGER expert_inmails_guard_update
BEFORE UPDATE ON public.expert_inmails
FOR EACH ROW EXECUTE FUNCTION public.expert_inmails_guard_update();