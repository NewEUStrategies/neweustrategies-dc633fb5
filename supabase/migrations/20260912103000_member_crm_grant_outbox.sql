-- Persist intent in the membership transaction, including when the application
-- loses its connection or exits before calling the secondary CRM RPC.
CREATE OR REPLACE FUNCTION public.queue_membership_crm_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.source <> 'manual' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at
      AND NEW.tier_key IS NOT DISTINCT FROM OLD.tier_key THEN RETURN NEW; END IF;
  END IF;
  -- Some auth bootstrap paths create a grant before the profile. The normal
  -- member backfill will discover that profile once provisioning completes.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND tenant_id = NEW.tenant_id) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.member_crm_sync_pending (tenant_id, user_id, tier_key, actor_id, reason)
  VALUES (NEW.tenant_id, NEW.user_id,
    CASE WHEN NEW.revoked_at IS NULL THEN NEW.tier_key ELSE NULL END,
    NEW.granted_by,
    CASE WHEN NEW.revoked_at IS NULL THEN 'manual_grant' ELSE 'manual_revoke' END)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET tier_key = EXCLUDED.tier_key, actor_id = EXCLUDED.actor_id,
        reason = EXCLUDED.reason, requested_at = clock_timestamp(), attempts = 0, last_error_code = NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_membership_crm_sync() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER membership_crm_sync_outbox
AFTER INSERT OR UPDATE OF revoked_at, tier_key ON public.membership_grants
FOR EACH ROW EXECUTE FUNCTION public.queue_membership_crm_sync();
