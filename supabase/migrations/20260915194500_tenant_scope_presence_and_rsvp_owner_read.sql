-- Zakres najemcy w obecności i we właścicielskim odczycie RSVP (bliźniak pasa
-- drizzle `0025_tenant_scope_presence_and_rsvp_owner_read`).
--
-- PO CO BLIŹNIAK. Obie poprawki pojechały wyłącznie pasem drizzle. W bazie
-- odtworzonej z `supabase/migrations/` rola admin/editor/author jednego najemcy
-- nadal widzi obecność przy encjach cudzego najemcy, a polityka „rsvps owner
-- read" pokazuje właścicielowi jego wiersze także pod cudzym hostem.
--
-- POWTÓRNE WYKONANIE JEST BEZPIECZNE: `CREATE OR REPLACE FUNCTION` oraz
-- `DROP POLICY IF EXISTS` + `CREATE POLICY` nadpisują ten sam stan.
-- 1) Obecność (presence) dla encji redakcyjnych i CRM musi być ograniczona
--    do tenanta wywołującego - rola admin/editor/author w jednym tenancie
--    nie może dawać wglądu w obecność przy encjach innego tenanta.
CREATE OR REPLACE FUNCTION public.can_access_entity_presence(_entity_type text, _entity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid := public.current_tenant_id();
  _same_tenant boolean := false;
BEGIN
  IF _uid IS NULL OR _tenant IS NULL OR _entity_id IS NULL THEN
    RETURN false;
  END IF;

  IF _entity_type = 'conversation' THEN
    RETURN public.is_tenant_conversation_member(_entity_id, _uid);
  END IF;

  IF _entity_type NOT IN ('post', 'page', 'media', 'crm_lead') THEN
    RETURN false;
  END IF;

  -- Rola bez przypisania encji do tenanta wywołującego nie wystarcza.
  IF NOT (
    public.has_role(_uid, 'admin'::public.app_role)
    OR public.has_role(_uid, 'super_admin'::public.app_role)
    OR public.has_role(_uid, 'editor'::public.app_role)
    OR public.has_role(_uid, 'author'::public.app_role)
  ) THEN
    RETURN false;
  END IF;

  CASE _entity_type
    WHEN 'post' THEN
      SELECT EXISTS (SELECT 1 FROM public.posts t WHERE t.id = _entity_id AND t.tenant_id = _tenant)
        INTO _same_tenant;
    WHEN 'page' THEN
      SELECT EXISTS (SELECT 1 FROM public.pages t WHERE t.id = _entity_id AND t.tenant_id = _tenant)
        INTO _same_tenant;
    WHEN 'media' THEN
      SELECT EXISTS (SELECT 1 FROM public.media t WHERE t.id = _entity_id AND t.tenant_id = _tenant)
        INTO _same_tenant;
    WHEN 'crm_lead' THEN
      SELECT EXISTS (SELECT 1 FROM public.crm_leads t WHERE t.id = _entity_id AND t.tenant_id = _tenant)
        INTO _same_tenant;
    ELSE
      _same_tenant := false;
  END CASE;

  RETURN _same_tenant;
END;
$function$;

-- 2) Właścicielski odczyt zapisów na wydarzenia musi być dodatkowo zawężony
--    do tenanta bieżącego hosta - to samo konto w innym tenancie nie widzi
--    tam swoich wierszy.
DROP POLICY IF EXISTS "rsvps owner read" ON public.event_rsvps;
CREATE POLICY "rsvps owner read"
ON public.event_rsvps
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND tenant_id = (SELECT public.current_tenant_id())
);
