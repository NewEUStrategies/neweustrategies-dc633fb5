CREATE OR REPLACE FUNCTION public.event_home_ads_for_viewer(p_slug text)
RETURNS TABLE(id uuid, image_url text, image_mobile_url text, link_url text, alt_text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.image_url, a.image_mobile_url, a.link_url, a.alt_text
    FROM public.events ev
    JOIN public.event_home_ads a ON a.event_id = ev.id AND a.tenant_id = ev.tenant_id
   WHERE ev.slug = p_slug AND ev.status <> 'draft'
     AND ev.tenant_id = public.current_tenant_id()
     AND a.is_active
     AND (a.starts_at IS NULL OR a.starts_at <= now())
     AND (a.ends_at IS NULL OR a.ends_at > now())
     AND (cardinality(a.group_ids) = 0 OR EXISTS (
       SELECT 1 FROM public.event_group_members m
         JOIN public.event_people p ON p.id = m.person_id
        WHERE m.event_id = ev.id AND m.group_id = ANY(a.group_ids)
          AND auth.uid() IS NOT NULL AND p.user_id = auth.uid()))
   ORDER BY random()
   LIMIT 5;
$$;
GRANT EXECUTE ON FUNCTION public.event_home_ads_for_viewer(text) TO anon, authenticated;