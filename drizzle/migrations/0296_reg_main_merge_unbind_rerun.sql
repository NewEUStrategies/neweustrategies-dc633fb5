SELECT public._auth_admin_provisioned_backfill();
SELECT public._event_people_unbind_unverified('reg01_remediation');
DO $$
DECLARE
  v_left integer;
BEGIN
  SELECT count(*)::integer INTO v_left FROM public.event_people_account_binding_audit();
  RAISE NOTICE 'REG-01 po scaleniu z main: audyt dowiazan = % (kryterium: 0)', v_left;
END
$$;