REVOKE ALL ON FUNCTION public._caller_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._caller_tenant() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "club_topics_public_read" ON public.club_topics;
CREATE POLICY "club_topics_public_read"
  ON public.club_topics FOR SELECT
  TO anon, authenticated
  USING (tenant_id = COALESCE(public._caller_tenant(), public.public_tenant_id()));

CREATE OR REPLACE FUNCTION public.club_topics_active()
RETURNS TABLE (
  key text,
  label_pl text,
  label_en text,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ct.key, ct.label_pl, ct.label_en, ct.sort_order
  FROM public.club_topics ct
  WHERE ct.is_active
    AND ct.tenant_id = COALESCE(public._caller_tenant(), public.public_tenant_id())
  ORDER BY ct.sort_order, ct.key;
$$;