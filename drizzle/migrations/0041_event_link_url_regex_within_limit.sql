ALTER TABLE public.event_sponsors DROP CONSTRAINT IF EXISTS event_sponsors_link_url_check;
ALTER TABLE public.event_sponsors ADD CONSTRAINT event_sponsors_link_url_check
  CHECK (link_url IS NULL OR (link_url ~* '^https://[^\s]{3,}$' AND char_length(link_url) <= 2008));

ALTER TABLE public.event_home_ads DROP CONSTRAINT IF EXISTS event_home_ads_link_url_check;
ALTER TABLE public.event_home_ads ADD CONSTRAINT event_home_ads_link_url_check
  CHECK (link_url IS NULL OR (link_url ~* '^https://[^\s]{3,}$' AND char_length(link_url) <= 2008));

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_set_link(_id uuid, _mode text, _url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF _mode NOT IN ('exhibitor','external','none') THEN RAISE EXCEPTION 'invalid_link_mode'; END IF;
  IF _mode = 'external' AND (
    _url IS NULL OR _url !~* '^https://[^\s]{3,}$' OR char_length(_url) > 2008
  ) THEN
    RAISE EXCEPTION 'invalid_link_url';
  END IF;
  UPDATE public.event_sponsors
     SET link_mode = _mode,
         link_url = CASE WHEN _mode = 'external' THEN _url ELSE NULL END,
         updated_at = now()
   WHERE id = _id AND tenant_id = v_tenant;
  RETURN FOUND;
END $$;
