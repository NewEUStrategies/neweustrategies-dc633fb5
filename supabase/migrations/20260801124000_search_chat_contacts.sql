-- ============================================================================
-- Dedykowane RPC wyszukiwarki ODBIORCÓW CZATU (uzupełnienie 20260801123000).
--
-- Historia: 6-argumentowe przeciążenie search_people (20260721204040) niosło
-- filtr "tylko zaakceptowane kontakty" i było wołane przez czat 2-argumentowo
-- ({p_query, p_limit}), ale odkąd obok istniała kanoniczna sygnatura 8-arg,
-- takie wywołanie kończyło się 42725 "is not unique" - wyszukiwarka odbiorców
-- była martwa. Sam DROP przeciążenia (20260801123000) usuwa niejednoznaczność,
-- lecz 2-argumentowe wywołanie zaczęłoby trafiać w wariant KATALOGOWY (wszyscy
-- discoverable w tenancie), pokazując osoby, do których i tak nie da się
-- napisać (get_or_create_direct_conversation rzuci 'chat: not in your
-- network'). Czat dostaje więc własne, jednoznaczne RPC z dokładnie tą samą
-- semantyką filtra co stare przeciążenie: discoverable + ten sam tenant +
-- zaakceptowane połączenie (super_admin widzi wszystkich); useConversations
-- przechodzi na search_chat_contacts.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_chat_contacts(
  p_query text DEFAULT NULL::text,
  p_limit integer DEFAULT 24
)
RETURNS TABLE(
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()),
  is_admin AS (SELECT public.is_super_admin(auth.uid()) AS ok),
  base AS (
    SELECT p.id, p.display_name, p.avatar_url, p.job_title,
           p.current_company, p.specialization, p.location, p.slug
    FROM public.profiles p, me, is_admin
    WHERE p.discoverable = true
      AND p.tenant_id = me.tenant_id
      AND p.id <> auth.uid()
      AND (
        is_admin.ok
        OR EXISTS (
          SELECT 1 FROM public.user_connections uc
          WHERE uc.status = 'accepted'
            AND (
              (uc.requester_id = auth.uid() AND uc.addressee_id = p.id)
              OR (uc.addressee_id = auth.uid() AND uc.requester_id = p.id)
            )
        )
      )
      AND (
        coalesce(p_query, '') = ''
        OR p.display_name    ILIKE '%' || p_query || '%'
        OR p.first_name      ILIKE '%' || p_query || '%'
        OR p.last_name       ILIKE '%' || p_query || '%'
        OR p.job_title       ILIKE '%' || p_query || '%'
        OR p.current_company ILIKE '%' || p_query || '%'
        OR p.specialization  ILIKE '%' || p_query || '%'
        OR p.location        ILIKE '%' || p_query || '%'
      )
  ),
  counted AS (SELECT count(*) AS c FROM base)
  SELECT b.id, b.display_name, b.avatar_url, b.job_title,
         b.current_company, b.specialization, b.location, b.slug,
         (SELECT c FROM counted) AS total_count
  FROM base b
  ORDER BY b.display_name NULLS LAST
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

-- Czat wymaga zalogowania; anon nie ma czego szukać wśród kontaktów.
REVOKE ALL ON FUNCTION public.search_chat_contacts(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_chat_contacts(text, integer) TO authenticated, service_role;
