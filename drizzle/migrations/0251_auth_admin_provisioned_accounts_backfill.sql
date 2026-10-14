CREATE OR REPLACE FUNCTION public._auth_admin_provisioned_backfill()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.auth_admin_provisioned_accounts (user_id, email_norm, tenant_id, invitation_id, source)
  SELECT DISTINCT ON (u.id)
         u.id,
         lower(btrim(u.email) COLLATE "C"),
         i.tenant_id,
         i.id,
         CASE WHEN COALESCE(i.source, '') LIKE 'provision:%' THEN 'team_provision'
              ELSE 'invitation_temp_password' END
    FROM public.user_invitations i
    JOIN auth.users u ON u.id = i.auth_user_id
   WHERE i.mode = 'temp_password'
     AND u.email_confirmed_at IS NOT NULL
     AND NULLIF(lower(btrim(u.email) COLLATE "C"), '') = lower(btrim(i.email) COLLATE "C")
     AND (
       COALESCE(u.raw_user_meta_data, '{}'::jsonb) ? 'must_change_password'
       OR COALESCE(u.raw_user_meta_data->>'provisioned', '') = 'true'
       OR u.created_at >= i.created_at
     )
   ORDER BY u.id, i.created_at, i.id
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public._auth_admin_provisioned_backfill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._auth_admin_provisioned_backfill() TO service_role;

COMMENT ON FUNCTION public._auth_admin_provisioned_backfill() IS
  'R12 (D1): dopisuje do auth_admin_provisioned_accounts konta zalozone przez administratora z potwierdzonym adresem (zaproszenie temp_password: must_change_password/provisioned w user_metadata albo konto mlodsze niz zaproszenie; adres konta = adres zaproszenia). Idempotentna (ON CONFLICT DO NOTHING), zwraca liczbe nowych wpisow. Tylko service_role; wolaja ja migracje 20261012180800 i 20261012190100.';

SELECT public._auth_admin_provisioned_backfill();