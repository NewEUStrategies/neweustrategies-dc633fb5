
CREATE OR REPLACE FUNCTION public.mutual_connections(
  p_user_id uuid,
  p_limit integer DEFAULT 48,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  location text,
  slug text,
  verified boolean,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.id AS uid, p.tenant_id
      FROM public.profiles p
     WHERE p.id = auth.uid()
  ),
  mine AS (
    SELECT CASE WHEN c.requester_id = me.uid THEN c.addressee_id
                ELSE c.requester_id END AS peer
      FROM public.user_connections c, me
     WHERE c.status = 'accepted'
       AND me.uid IN (c.requester_id, c.addressee_id)
  ),
  theirs AS (
    SELECT CASE WHEN c.requester_id = p_user_id THEN c.addressee_id
                ELSE c.requester_id END AS peer
      FROM public.user_connections c
     WHERE c.status = 'accepted'
       AND p_user_id IN (c.requester_id, c.addressee_id)
  ),
  shared AS (
    SELECT m.peer AS uid
      FROM mine m
      JOIN theirs t ON t.peer = m.peer
     WHERE m.peer <> p_user_id
  )
  SELECT
    p.id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
             'User') AS display_name,
    p.avatar_url,
    p.job_title,
    p.current_company,
    p.location,
    p.slug,
    (p.verified_at IS NOT NULL) AS verified,
    count(*) OVER () AS total_count
  FROM shared s
  JOIN public.profiles p ON p.id = s.uid
  CROSS JOIN me
  WHERE auth.uid() IS NOT NULL
    AND p.tenant_id = me.tenant_id
    AND p.discoverable = true
  ORDER BY COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
             'User') ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 48), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE EXECUTE ON FUNCTION public.mutual_connections(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mutual_connections(uuid, integer, integer) TO authenticated, service_role;
