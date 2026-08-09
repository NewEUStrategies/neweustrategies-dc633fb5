CREATE OR REPLACE FUNCTION public.club_reaction_actors(
  p_target_type text,
  p_target_ids uuid[],
  p_limit integer DEFAULT 6
)
RETURNS TABLE(
  target_id uuid,
  kind text,
  user_id uuid,
  display_name text,
  headline text,
  avatar_url text,
  slug text,
  is_me boolean,
  actor_rank integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT r.target_id, r.kind, r.user_id, r.created_at, r.club_id,
           COALESCE(
             CASE WHEN p_target_type = 'thread' THEN
               (SELECT COALESCE(g.attribution_mode, c.attribution_mode)
                  FROM public.club_threads t
                  JOIN public.club_groups g ON g.id = t.group_id
                  JOIN public.clubs c ON c.id = t.club_id
                 WHERE t.id = r.target_id)
             ELSE
               (SELECT COALESCE(g.attribution_mode, c.attribution_mode)
                  FROM public.club_replies rp
                  JOIN public.club_threads t ON t.id = rp.thread_id
                  JOIN public.club_groups g ON g.id = t.group_id
                  JOIN public.clubs c ON c.id = t.club_id
                 WHERE rp.id = r.target_id)
             END, 'named') AS attribution
      FROM public.club_reactions r
     WHERE r.target_type = p_target_type
       AND r.target_id = ANY(p_target_ids[1:200])
       AND (SELECT can_read FROM public.club_capabilities(r.club_id, NULL, auth.uid()))
  ),
  ranked AS (
    SELECT b.*,
           row_number() OVER (
             PARTITION BY b.target_id, b.kind
             ORDER BY (b.user_id = auth.uid()) DESC, b.created_at ASC
           )::int AS pos
      FROM base b
  )
  SELECT
    r.target_id,
    r.kind,
    CASE WHEN r.attribution = 'chatham' AND r.user_id <> auth.uid() THEN NULL ELSE r.user_id END,
    CASE WHEN r.attribution = 'chatham' AND r.user_id <> auth.uid() THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN r.attribution = 'chatham' AND r.user_id <> auth.uid() THEN NULL
         ELSE NULLIF(btrim(p.job_title), '') END,
    CASE WHEN (r.attribution = 'chatham' AND r.user_id <> auth.uid()) OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN r.attribution = 'chatham' AND r.user_id <> auth.uid() THEN NULL ELSE p.slug END,
    (r.user_id = auth.uid()) AS is_me,
    r.pos
  FROM ranked r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.pos <= LEAST(GREATEST(COALESCE(p_limit, 6), 1), 12)
  ORDER BY r.target_id, r.kind, r.pos
$function$;

REVOKE ALL ON FUNCTION public.club_reaction_actors(text, uuid[], integer) FROM public;
GRANT EXECUTE ON FUNCTION public.club_reaction_actors(text, uuid[], integer) TO authenticated;