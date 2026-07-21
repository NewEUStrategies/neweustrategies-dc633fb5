-- Add slug to get_chat_peers so chat UI can link peer avatars to /author/$slug.
DROP FUNCTION IF EXISTS public.get_chat_peers(uuid[]);

CREATE OR REPLACE FUNCTION public.get_chat_peers(p_user_ids uuid[])
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  slug text,
  job_title text,
  current_company text,
  specialization text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.avatar_url, p.slug, p.job_title, p.current_company, p.specialization
  FROM public.profiles p
  WHERE p.id = ANY (p_user_ids)
    AND (
      p.id = auth.uid()
      OR p.discoverable = true
      OR EXISTS (
        SELECT 1
        FROM public.conversation_participants me
        JOIN public.conversation_participants them
          ON them.conversation_id = me.conversation_id
        WHERE me.user_id = auth.uid()
          AND them.user_id = p.id
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) TO authenticated;