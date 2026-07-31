DROP FUNCTION IF EXISTS public.get_chat_peers(uuid[]);

CREATE FUNCTION public.get_chat_peers(p_user_ids uuid[])
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
  WHERE auth.uid() IS NOT NULL
    AND cardinality(p_user_ids) BETWEEN 1 AND 200
    AND p.id = ANY (p_user_ids)
    AND (
      p.id = auth.uid()
      OR (
        p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
        AND (
          p.discoverable = true
          OR EXISTS (
            SELECT 1
            FROM public.conversation_participants me
            JOIN public.conversation_participants them
              ON them.conversation_id = me.conversation_id
            WHERE me.user_id = auth.uid()
              AND them.user_id = p.id
          )
        )
      )
    );
$$;

COMMENT ON FUNCTION public.get_chat_peers(uuid[]) IS
  'Bezpieczne karty profili dla czatu: wolajacy, discoverable peers z jego tenanta oraz wspoluczestnicy konwersacji w jego tenancie. Wejscie 1-200 id. Po DROP/CREATE zawsze ponawiac REVOKE (PUBLIC, anon).';

REVOKE EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) TO authenticated, service_role;