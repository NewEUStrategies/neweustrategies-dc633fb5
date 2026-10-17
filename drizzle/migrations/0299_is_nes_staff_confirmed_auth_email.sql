CREATE OR REPLACE FUNCTION public.is_nes_staff(_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (
       public.has_role(_user_id, 'admin')
       OR public.has_role(_user_id, 'super_admin')
       OR public.has_role(_user_id, 'editor')
       OR public.has_role(_user_id, 'author')
       -- Domena NES tylko z POTWIERDZONEGO adresu logowania (D1, REG-01).
       -- profiles.email pisze sam zalogowany, wiec nie jest dowodem niczego.
       OR EXISTS (
         SELECT 1 FROM auth.users u
          WHERE u.id = _user_id
            AND u.email_confirmed_at IS NOT NULL
            AND lower(btrim(COALESCE(u.email, ''))) LIKE '%@neweuropeanstrategies.com'
       )
     );
$function$;

COMMENT ON FUNCTION public.is_nes_staff(uuid) IS
  'Sztab NES: rola admin, super_admin, editor albo author, ALBO potwierdzony adres logowania (auth.users.email z email_confirmed_at) w domenie @neweuropeanstrategies.com. Nie czyta profiles.email - te kolumne zalogowany pisze sam, a sztab dostaje can_read w kazdym klubie tenantu (club_capabilities). NULL -> false. Od 20261017140000.';

REVOKE EXECUTE ON FUNCTION public.is_nes_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_nes_staff(uuid) TO authenticated, service_role;
