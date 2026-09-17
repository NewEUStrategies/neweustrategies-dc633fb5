-- 1) Odznaka "zweryfikowany" niedostępna przy samodzielnej edycji profilu.
--    Trigger już podnosi wyjątek, ale reguła dostępu nie pinowała kolumn -
--    dokładamy warunek w WITH CHECK, żeby zapis odpadał w samej polityce.
CREATE OR REPLACE FUNCTION public.profile_verification_matches(
  _id uuid,
  _verified_at timestamptz,
  _verified_by uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.can_manage_profile_verification(auth.uid())
      OR EXISTS (
           SELECT 1
             FROM public.profiles p
            WHERE p.id = _id
              AND p.verified_at IS NOT DISTINCT FROM _verified_at
              AND p.verified_by IS NOT DISTINCT FROM _verified_by
         );
$$;

REVOKE ALL ON FUNCTION public.profile_verification_matches(uuid, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_verification_matches(uuid, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.profile_verification_matches(uuid, timestamptz, uuid) TO service_role;

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id = (SELECT auth.uid())
    AND tenant_id IS NOT NULL
    AND public.profile_verification_matches(id, verified_at, verified_by)
  );

-- 2) Przyjęcie zaproszenia nie może zmieniać roli ani innych pól administracyjnych.
CREATE OR REPLACE FUNCTION public.user_invitations_pin_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF public.is_service_role_caller()
     OR public.has_role(auth.uid(), 'admin'::public.app_role)
     OR public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  NEW.role         := OLD.role;
  NEW.tenant_id    := OLD.tenant_id;
  NEW.email        := OLD.email;
  NEW.display_name := OLD.display_name;
  NEW.mode         := OLD.mode;
  NEW.source       := OLD.source;
  NEW.metadata     := OLD.metadata;
  NEW.invited_by   := OLD.invited_by;
  NEW.expires_at   := OLD.expires_at;
  NEW.send_count   := OLD.send_count;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_invitations_pin_admin_columns_bu ON public.user_invitations;
CREATE TRIGGER user_invitations_pin_admin_columns_bu
  BEFORE UPDATE ON public.user_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.user_invitations_pin_admin_columns();