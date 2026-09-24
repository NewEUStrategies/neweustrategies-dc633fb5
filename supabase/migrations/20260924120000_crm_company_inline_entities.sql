-- Encje inline w edytorze bloków: firma zaciągana z kartoteki CRM.
--
-- PO CO. Redakcja wstawia w treść artykułu „wzbogaconą nazwę" firmy (logo 6 px,
-- nazwa z linią, karta po najechaniu). Dane pochodzą z CRM: nazwa, kraj
-- pochodzenia, branża, specjalizacja, strona www, media społecznościowe, logo.
-- Kartoteka miała wszystko poza SPECJALIZACJĄ i LINKAMI SPOŁECZNOŚCIOWYMI -
-- ta migracja je dokłada.
--
-- KOPIA, NIE ODWOŁANIE. Edytor zapisuje w dokumencie wpisu (`meta.inlineEntities`)
-- KOPIĘ tych pól. Zmiana w artykule nie dotyka kartoteki, a zmiana w kartotece
-- nie przepisuje opublikowanych tekstów sama - redakcja „odświeża z CRM" świadomie.
-- Dzięki temu publiczny render nie czyta `crm_companies` (tabela jest tylko dla
-- zespołu CRM) i SSR nie wykonuje żadnego dodatkowego zapytania.
--
-- DOSTĘP. `crm_companies` SELECT ma tylko admin / super_admin / editor. Autor
-- pisze artykuły, więc potrzebuje wyszukiwarki - dostaje ją przez funkcję
-- SECURITY DEFINER zwracającą WYŁĄCZNIE pola przeznaczone do publikacji (bez
-- adresu, telefonu, e-maila, NIP-u, notatek i leadów). Tenant wymusza baza
-- (`current_tenant_id()`), rola - `is_staff()` / super_admin.

ALTER TABLE public.crm_companies
  ADD COLUMN IF NOT EXISTS specialization text,
  ADD COLUMN IF NOT EXISTS social_links jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_companies_social_links_is_object'
  ) THEN
    ALTER TABLE public.crm_companies
      ADD CONSTRAINT crm_companies_social_links_is_object
      CHECK (jsonb_typeof(social_links) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.crm_companies.specialization IS
  'Specjalizacja firmy (np. „magazyny energii") - pole publikowalne, używane przez encje inline w artykułach.';
COMMENT ON COLUMN public.crm_companies.social_links IS
  'Linki społecznościowe firmy jako obiekt {linkedin, x, facebook, instagram, youtube: url}.';

-- Wyszukiwanie (p_query) albo odczyt jednego rekordu (p_id, „odśwież z CRM").
-- `strpos` zamiast LIKE: fraza użytkownika nie jest wzorcem, więc `%` i `_`
-- w zapytaniu nie mogą rozszerzać dopasowania.
CREATE OR REPLACE FUNCTION public.crm_company_inline_lookup(
  p_query text DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  name text,
  country text,
  branch text,
  specialization text,
  website text,
  domain text,
  logo_url text,
  social_links jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH q AS (SELECT lower(btrim(COALESCE(p_query, ''))) AS v)
  SELECT c.id, c.name, c.country, c.branch, c.specialization, c.website, c.domain, c.logo_url,
         c.social_links
  FROM public.crm_companies c
  CROSS JOIN q
  WHERE auth.uid() IS NOT NULL
    AND (public.is_staff() OR public.has_role(auth.uid(), 'super_admin'::app_role))
    AND c.tenant_id = public.current_tenant_id()
    AND (
      (p_id IS NOT NULL AND c.id = p_id)
      OR (
        p_id IS NULL
        AND (
          q.v = ''
          OR strpos(c.name_norm, q.v) > 0
          OR strpos(lower(COALESCE(c.domain, '')), q.v) > 0
        )
      )
    )
  ORDER BY (strpos(c.name_norm, q.v) = 1) DESC, c.name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 25)
$function$;

REVOKE ALL ON FUNCTION public.crm_company_inline_lookup(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_inline_lookup(text, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_company_inline_lookup(text, uuid, integer) TO authenticated;
