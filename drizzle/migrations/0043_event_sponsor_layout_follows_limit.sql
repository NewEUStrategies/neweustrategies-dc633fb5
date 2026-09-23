CREATE OR REPLACE FUNCTION public.admin_event_sponsor_tier_set_layout(_id uuid, _layout text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_old_layout text;
BEGIN
  IF _layout IS NULL OR _layout NOT IN ('banner','grid') THEN
    RAISE EXCEPTION 'invalid_layout';
  END IF;

  SELECT t.layout INTO v_old_layout
    FROM public.event_sponsor_tiers t
   WHERE t.id = _id AND t.tenant_id = v_tenant
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF _layout = 'banner' AND (
    SELECT count(*) FROM public.event_sponsors s
     WHERE s.tier_id = _id AND s.tenant_id = v_tenant
  ) > 1 THEN
    RAISE EXCEPTION 'banner_single_image';
  END IF;

  UPDATE public.event_sponsor_tiers t
     SET layout = _layout,
         max_companies = CASE
           WHEN _layout = 'banner' THEN 1
           WHEN v_old_layout = 'banner' AND t.max_companies = 1 THEN NULL
           ELSE t.max_companies
         END,
         updated_at = now()
   WHERE t.id = _id AND t.tenant_id = v_tenant;
  RETURN FOUND;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_event_sponsor_tier_set_layout(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_tier_set_layout(uuid, text) TO authenticated;
