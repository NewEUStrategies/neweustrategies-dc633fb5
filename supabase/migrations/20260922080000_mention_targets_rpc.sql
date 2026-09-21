-- Cele @wzmianek: wyszukiwanie i odczyt pojedynczego celu (osoba albo firma).
--
-- PO CO TA MIGRACJA ISTNIEJE. Obie funkcje zostały wprowadzone WYŁĄCZNIE na
-- pasie drizzle (0032, a potem 0033 ze stabilnymi slugami firm). Klient woła je
-- z czterech miejsc - podpowiedzi przy pisaniu, dymek wzmianki, katalog wzmianek
-- wątku i profil organizacji - więc w środowisku odtworzonym z `supabase/migrations`
-- każde z tych miejsc dostawało PGRST202 „function not found". Bramka
-- `check:rpc-contract` nazywa to wprost: „funkcja jest martwa w każdym
-- środowisku odtworzonym z migracji". Ten plik domyka pas kanoniczny.
--
-- STAN KOŃCOWY, NIE ŁAŃCUCH. Pas drizzle niesie dwie wersje tych samych funkcji
-- (0032 -> 0033); tutaj wchodzi wyłącznie wersja końcowa, bo obie deklaracje to
-- `CREATE OR REPLACE` i odtwarzanie wersji pośredniej niczego nie dowodzi.
--
-- CO ODDAJĄ, A CZEGO NIE. Osoba: tylko profil publiczny (discoverable albo
-- redakcyjny), etykieta z `display_name`, podpis ze stanowiska i firmy. Firma:
-- bezpieczny wycinek kartoteki CRM - nazwa, logo, strona, branża - i NIC poza
-- tym. Notatki, leady i dane kontaktowe nie wychodzą z kartoteki; tenant
-- wymusza baza, nie klient. Slug firmy niesie prefiks `org-` i identyfikator
-- rekordu, bo nazwa firmy identyfikatorem nie jest: dwie firmy mogą nazywać się
-- tak samo, a wzmianka musi wskazać właściwy wiersz.

CREATE OR REPLACE FUNCTION public.search_mention_targets(
  _q text DEFAULT NULL,
  _limit int DEFAULT 8
)
RETURNS TABLE (
  kind text,
  id uuid,
  slug text,
  label text,
  subtitle text,
  avatar_url text,
  logo_url text,
  website text,
  verified boolean,
  score real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH ctx AS (
    SELECT COALESCE(public._caller_tenant(), public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  nq AS (SELECT unaccent(lower(btrim(COALESCE(_q, '')))) AS q),
  people AS (
    SELECT
      'person'::text AS kind,
      pr.id,
      pr.slug,
      COALESCE(pr.display_name, 'Autor') AS label,
      NULLIF(concat_ws(' - ', COALESCE(ap.job_title, pr.job_title), COALESCE(ap.company, pr.current_company)), '') AS subtitle,
      pr.avatar_url,
      NULL::text AS logo_url,
      NULL::text AS website,
      (pr.verified_at IS NOT NULL) AS verified,
      CASE WHEN nq.q = '' THEN 0.0
           ELSE word_similarity(nq.q, unaccent(lower(COALESCE(pr.display_name, ''))))
                + CASE WHEN unaccent(lower(COALESCE(pr.display_name, ''))) LIKE nq.q || '%' THEN 1.0 ELSE 0.0 END
                + CASE WHEN unaccent(lower(COALESCE(pr.display_name, ''))) LIKE '%' || nq.q || '%' THEN 0.5 ELSE 0.0 END
      END AS score,
      (SELECT count(DISTINCT p.id)
         FROM public.posts p
         LEFT JOIN public.post_authors pa ON pa.post_id = p.id AND pa.user_id = pr.id
        WHERE p.tenant_id = ctx.tid
          AND p.status = 'published'
          AND p.deleted_at IS NULL
          AND (p.author_id = pr.id OR pa.user_id IS NOT NULL)) AS post_count,
      COALESCE(ap.is_public, false) AS is_public_expert
    FROM public.profiles pr
    CROSS JOIN ctx
    CROSS JOIN nq
    LEFT JOIN public.author_profiles ap ON ap.user_id = pr.id AND ap.tenant_id = pr.tenant_id
    WHERE pr.tenant_id = ctx.tid
      AND pr.slug IS NOT NULL
      AND pr.discoverable = true
      AND public.user_is_editorial(pr.id)
  ),
  companies AS (
    SELECT
      'organization'::text AS kind,
      c.id,
      ('org-' || c.id::text) AS slug,
      c.name AS label,
      NULLIF(c.branch, '') AS subtitle,
      NULL::text AS avatar_url,
      c.logo_url,
      c.website,
      false AS verified,
      CASE WHEN nq.q = '' THEN 0.0
           ELSE word_similarity(nq.q, unaccent(lower(c.name)))
                + CASE WHEN unaccent(lower(c.name)) LIKE nq.q || '%' THEN 1.0 ELSE 0.0 END
                + CASE WHEN unaccent(lower(c.name)) LIKE '%' || nq.q || '%' THEN 0.5 ELSE 0.0 END
      END AS score,
      0::bigint AS post_count,
      false AS is_public_expert
    FROM public.crm_companies c
    CROSS JOIN ctx
    CROSS JOIN nq
    WHERE c.tenant_id = ctx.tid
      AND btrim(c.name) <> ''
      AND length(nq.q) >= 2
  ),
  cand AS (
    SELECT * FROM people WHERE post_count > 0 OR is_public_expert
    UNION ALL
    SELECT * FROM companies
  )
  SELECT kind, id, slug, label, subtitle, avatar_url, logo_url, website, verified, score::real
  FROM cand, nq
  WHERE slug IS NOT NULL
    AND slug <> 'org-'
    AND (nq.q = '' OR length(nq.q) < 2 OR score > 0.3)
  ORDER BY score DESC, post_count DESC, label
  LIMIT GREATEST(LEAST(COALESCE(_limit, 8), 20), 1);
$$;

REVOKE ALL ON FUNCTION public.search_mention_targets(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_mention_targets(text, int) TO anon;
GRANT EXECUTE ON FUNCTION public.search_mention_targets(text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_mention_target(_slug text)
RETURNS TABLE (
  kind text,
  id uuid,
  slug text,
  label text,
  subtitle text,
  avatar_url text,
  logo_url text,
  website text,
  verified boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH ctx AS (
    SELECT COALESCE(public._caller_tenant(), public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  wanted AS (SELECT lower(btrim(COALESCE(_slug, ''))) AS slug),
  wanted_company AS (
    SELECT CASE
      WHEN wanted.slug ~ '^org-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN substring(wanted.slug FROM 5)::uuid
      ELSE NULL::uuid
    END AS id
    FROM wanted
  )
  SELECT 'person'::text AS kind,
         pr.id,
         pr.slug,
         COALESCE(pr.display_name, 'Autor') AS label,
         NULLIF(concat_ws(' - ', COALESCE(ap.job_title, pr.job_title), COALESCE(ap.company, pr.current_company)), '') AS subtitle,
         pr.avatar_url,
         NULL::text AS logo_url,
         NULL::text AS website,
         (pr.verified_at IS NOT NULL) AS verified
    FROM public.profiles pr
    CROSS JOIN ctx
    CROSS JOIN wanted
    LEFT JOIN public.author_profiles ap ON ap.user_id = pr.id AND ap.tenant_id = pr.tenant_id
   WHERE pr.tenant_id = ctx.tid
     AND pr.slug = wanted.slug
     AND pr.discoverable = true
     AND public.user_is_editorial(pr.id)
  UNION ALL
  SELECT 'organization'::text AS kind,
         c.id,
         ('org-' || c.id::text) AS slug,
         c.name AS label,
         NULLIF(c.branch, '') AS subtitle,
         NULL::text AS avatar_url,
         c.logo_url,
         c.website,
         false AS verified
    FROM public.crm_companies c
    CROSS JOIN ctx
    CROSS JOIN wanted_company wc
   WHERE c.tenant_id = ctx.tid
     AND c.id = wc.id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_mention_target(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mention_target(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_mention_target(text) TO authenticated;