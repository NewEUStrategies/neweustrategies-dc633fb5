-- 1. author_profiles: publiczne odczyty tylko dla publicznego najemcy
DROP POLICY IF EXISTS "Public can view public author profiles" ON public.author_profiles;
CREATE POLICY "Public can view public author profiles"
  ON public.author_profiles
  FOR SELECT
  TO anon, authenticated
  USING (is_public = true AND tenant_id = public.public_tenant_id());

-- 2. profiles: anon odczyt tylko dla publicznego najemcy
DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
CREATE POLICY "Profiles anon public authors"
  ON public.profiles
  FOR SELECT
  TO anon
  USING (
    slug IS NOT NULL
    AND tenant_id = public.public_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = profiles.id
        AND ur.role = ANY (ARRAY['admin'::app_role, 'editor'::app_role, 'author'::app_role, 'super_admin'::app_role])
    )
  );

-- 3. content_access.password_hash: nie dla anon/authenticated (weryfikacja serwerowo)
REVOKE SELECT (password_hash) ON public.content_access FROM anon, authenticated;
-- Reszta kolumn pozostaje czytelna zgodnie z politykami RLS
GRANT SELECT (id, tenant_id, entity_type, entity_id, mode, plan_ids,
              one_time_price_cents, one_time_currency, teaser_pl, teaser_en,
              password_hint_pl, password_hint_en, created_at, updated_at)
  ON public.content_access TO anon, authenticated;

-- 4. crm_companies: filtr per najemca w politykach staff
DROP POLICY IF EXISTS crm_companies_admin_write ON public.crm_companies;
CREATE POLICY crm_companies_admin_write
  ON public.crm_companies
  FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
  );

DROP POLICY IF EXISTS crm_companies_staff_read ON public.crm_companies;
CREATE POLICY crm_companies_staff_read
  ON public.crm_companies
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
    )
  );

-- 5. Stały search_path dla funkcji własnych
CREATE OR REPLACE FUNCTION public.tg_conversations_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.last_message_at := COALESCE(NEW.last_message_at, OLD.last_message_at); RETURN NEW; END
$function$;

CREATE OR REPLACE FUNCTION public.tg_cp_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$function$;

CREATE OR REPLACE FUNCTION public.tg_message_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RETURN NEW;
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.kind <> 'text' THEN
      RAISE EXCEPTION 'chat: only text messages can be edited';
    END IF;
    IF now() - OLD.created_at > interval '5 minutes' THEN
      RAISE EXCEPTION 'chat: edit window expired';
    END IF;
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.workflow_param_text(
  p_payload jsonb, p_params jsonb, p_fixed_key text, p_from_key text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT COALESCE(
    NULLIF(p_params ->> p_fixed_key, ''),
    NULLIF(p_payload ->> (p_params ->> p_from_key), '')
  );
$function$;