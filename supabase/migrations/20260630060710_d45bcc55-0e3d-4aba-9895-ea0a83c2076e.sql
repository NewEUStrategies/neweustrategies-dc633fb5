-- CRM lead timeline: log stage changes via trigger so the lead-detail timeline
-- can render submit/consents/notes/stage_change/webhook events from a single
-- source of truth (audit_log). Dispatch (webhook/API) events are inserted from
-- the server function that performs the push.

CREATE OR REPLACE FUNCTION public.crm_leads_log_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      NEW.tenant_id,
      auth.uid(),
      'crm_lead.stage_change',
      'crm_lead',
      NEW.id,
      jsonb_build_object('from', OLD.stage, 'to', NEW.stage)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_crm_leads_stage_change ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_stage_change
AFTER UPDATE OF stage ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.crm_leads_log_stage_change();