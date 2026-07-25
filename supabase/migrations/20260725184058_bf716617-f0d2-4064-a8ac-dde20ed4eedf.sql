
CREATE OR REPLACE FUNCTION public.crm_companies_aggregates(_company_ids uuid[])
RETURNS TABLE (
  company_id uuid,
  leads_count bigint,
  last_lead_activity_at timestamptz,
  contacts_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ids AS (SELECT unnest(_company_ids) AS id),
  leads AS (
    SELECT l.company_id, count(*) AS c, max(l.last_activity_at) AS last_act
    FROM public.crm_leads l
    WHERE l.company_id = ANY(_company_ids)
    GROUP BY l.company_id
  ),
  contacts AS (
    SELECT p.current_company_id AS company_id, count(*) AS c
    FROM public.profiles p
    WHERE p.current_company_id = ANY(_company_ids)
    GROUP BY p.current_company_id
  )
  SELECT ids.id,
         coalesce(leads.c, 0),
         leads.last_act,
         coalesce(contacts.c, 0)
  FROM ids
  LEFT JOIN leads ON leads.company_id = ids.id
  LEFT JOIN contacts ON contacts.company_id = ids.id;
$$;

REVOKE EXECUTE ON FUNCTION public.crm_companies_aggregates(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_companies_aggregates(uuid[]) TO authenticated, service_role;

-- Wspierające indeksy (idempotentne).
CREATE INDEX IF NOT EXISTS crm_leads_company_id_idx
  ON public.crm_leads(company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_current_company_id_idx
  ON public.profiles(current_company_id) WHERE current_company_id IS NOT NULL;
