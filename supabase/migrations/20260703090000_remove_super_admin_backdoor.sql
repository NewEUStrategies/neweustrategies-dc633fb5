-- ============================================================================
-- Security: remove the hard-coded super_admin auto-grant ("backdoor").
--
-- Migration 20260628212746 installed triggers on auth.users that granted the
-- super_admin role to whichever account carries a specific, hard-coded e-mail
-- address (marketing@...). That is a privilege-escalation backdoor:
--   * anyone able to register / confirm that mailbox (staging with open
--     signup, a lapsed domain, a supplier mailbox takeover) silently becomes
--     super_admin on EVERY environment the migration ran on;
--   * the grant bypasses the role-management UI, RLS and the audit trail.
--
-- Bootstrap/provisioning of the first super_admin is an explicit operational
-- step from now on (seed script or a one-off statement executed by ops), and
-- every later role change goes through public.change_user_role() - atomic and
-- audited (see 20260703090100_profiles_column_grants_and_role_audit.sql).
--
-- Existing role assignments are intentionally NOT revoked here: they are
-- visible in public.user_roles and manageable through the admin UI; revoking
-- blindly could lock out the only legitimate super_admin.
-- ============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created_grant_super_admin ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_confirmed_grant_super_admin ON auth.users;
DROP FUNCTION IF EXISTS public.grant_super_admin_for_marketing_email();
