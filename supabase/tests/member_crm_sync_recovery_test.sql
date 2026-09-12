BEGIN;
SELECT plan(19);
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
 ('a1111111-1111-1111-1111-11111111c901', 'crm-recovery-a', 'CRM A'),
 ('b1111111-1111-1111-1111-11111111c901', 'crm-recovery-b', 'CRM B');
INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000c901', 'recovery@crm.test');
INSERT INTO public.profiles (id, tenant_id, email, first_name, current_company) VALUES
 ('a0000000-0000-0000-0000-00000000c901', 'a1111111-1111-1111-1111-11111111c901', 'recovery@crm.test', 'Anna', 'ACME Sp. z o.o.');
-- Profile provisioning may create a lead automatically; explicitly exercise INSERT.
DELETE FROM public.crm_leads WHERE tenant_id = 'a1111111-1111-1111-1111-11111111c901' AND email = 'recovery@crm.test';
SELECT ok(NOT has_function_privilege('authenticated', 'public.crm_sync_member(uuid,uuid,text,uuid,text)', 'EXECUTE'), 'browser cannot invoke service sync');
SELECT ok(NOT has_table_privilege('authenticated', 'public.member_crm_sync_pending', 'SELECT'), 'pending queue is private');
SELECT throws_ok($$SELECT public.crm_sync_member('a0000000-0000-0000-0000-00000000c901','b1111111-1111-1111-1111-11111111c901','member',NULL,'manual_grant')$$,
 '42501', 'crm: profile outside tenant', 'reject cross-tenant profile');
SELECT is(public.crm_sync_member('a0000000-0000-0000-0000-00000000c901','a1111111-1111-1111-1111-11111111c901','member',NULL,'manual_grant')->>'status', 'synced', 'grant sync succeeds');
SELECT is((SELECT stage FROM public.crm_leads WHERE email = 'recovery@crm.test'), 'won', 'grant wins the lead');
SELECT ok((SELECT tags @> ARRAY['plan:member','membership:manual'] FROM public.crm_leads WHERE email = 'recovery@crm.test'), 'membership tags persisted');
SELECT is(public.crm_sync_member('a0000000-0000-0000-0000-00000000c901','a1111111-1111-1111-1111-11111111c901',NULL,NULL,'backfill')->>'companyCreated', 'false', 'retry reuses company');
SELECT is((SELECT count(*)::integer FROM public.crm_companies WHERE tenant_id = 'a1111111-1111-1111-1111-11111111c901'), 1, 'one company after repeated sync');
SELECT is((SELECT id FROM public.crm_ensure_member_company('a1111111-1111-1111-1111-11111111c901','acme',NULL)),
 (SELECT company_id FROM public.crm_leads WHERE email = 'recovery@crm.test'), 'normalized company key deduplicates');
-- Force a secondary write failure. The transaction must retain retry intent.
CREATE FUNCTION pg_temp.fail_recovery_lead() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'forced secondary failure' USING ERRCODE = 'P0001'; END;
$$;
CREATE TRIGGER recovery_failure BEFORE UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_recovery_lead();
SELECT is(public.crm_sync_member('a0000000-0000-0000-0000-00000000c901','a1111111-1111-1111-1111-11111111c901',NULL,NULL,'manual_revoke')->>'status', 'failed', 'secondary failure is explicit');
SELECT is((SELECT reason FROM public.member_crm_sync_pending WHERE user_id = 'a0000000-0000-0000-0000-00000000c901'), 'manual_revoke', 'failed revoke remains retryable');
SELECT is((SELECT stage FROM public.crm_leads WHERE email = 'recovery@crm.test'), 'won', 'failed transaction preserves prior lead');
DROP TRIGGER recovery_failure ON public.crm_leads;
SELECT is(public.crm_sync_member('a0000000-0000-0000-0000-00000000c901','a1111111-1111-1111-1111-11111111c901',NULL,NULL,'backfill')->>'stage', 'qualified', 'backfill replays revoke instead of losing it');
SELECT is((SELECT count(*)::integer FROM public.member_crm_sync_pending WHERE user_id = 'a0000000-0000-0000-0000-00000000c901'), 0, 'successful retry clears intent');
SELECT ok((SELECT NOT tags @> ARRAY['membership:manual'] FROM public.crm_leads WHERE email = 'recovery@crm.test'), 'revoke removes membership tag');
-- A committed grant must survive a missing application RPC call.
INSERT INTO public.membership_grants (tenant_id, user_id, tier_key, source)
VALUES ('a1111111-1111-1111-1111-11111111c901', 'a0000000-0000-0000-0000-00000000c901', 'member', 'manual');
SELECT is((SELECT reason FROM public.member_crm_sync_pending WHERE user_id = 'a0000000-0000-0000-0000-00000000c901'), 'manual_grant', 'grant transaction persists intent before HTTP sync');
SELECT is(public.crm_sync_member('a0000000-0000-0000-0000-00000000c901','a1111111-1111-1111-1111-11111111c901',NULL,NULL,'backfill')->>'stage', 'won', 'backfill recovers after process death');
UPDATE public.membership_grants SET revoked_at = now()
WHERE tenant_id = 'a1111111-1111-1111-1111-11111111c901' AND user_id = 'a0000000-0000-0000-0000-00000000c901';
SELECT is((SELECT reason FROM public.member_crm_sync_pending WHERE user_id = 'a0000000-0000-0000-0000-00000000c901'), 'manual_revoke', 'revoke transaction persists intent');
SELECT is(public.crm_sync_member('a0000000-0000-0000-0000-00000000c901','a1111111-1111-1111-1111-11111111c901',NULL,NULL,'backfill')->>'stage', 'qualified', 'backfill recovers revoke without application RPC');
SELECT * FROM finish();
ROLLBACK;
