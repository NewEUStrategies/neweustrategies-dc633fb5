-- Encje inline w edytorze bloków: osoba zaciągana z profilu AUTORA.
--
-- PO CO. Redakcja wstawia w treść „wzbogacone nazwisko" (zdjęcie 6 px,
-- nazwisko z linią, karta: stanowisko, firma, strona zewnętrzna, media
-- społecznościowe). Osobę można wpisać ręcznie albo zaciągnąć z profilu
-- użytkownika o roli redakcyjnej (author / editor / admin / super_admin -
-- ten sam zbiór co katalog „Autorzy" i `user_is_editorial`).
--
-- KOPIA, NIE ODWOŁANIE. Edytor zapisuje w dokumencie wpisu KOPIĘ pól profilu.
-- Modyfikacja w artykule dotyczy wyłącznie tego materiału i NIGDY nie zmienia
-- profilu autora - ta funkcja jest tylko do odczytu.
--
-- CO ODDAJE. Wyłącznie pola, które i tak są publiczne na stronie autora
-- (/people/<slug>): imię, nazwisko, stanowisko, firma, strona, linki
-- społecznościowe, zdjęcie (z poszanowaniem `hide_avatar`), specjalizacja.
-- Pola z `author_profiles` (profil autorski) mają pierwszeństwo przed polami
-- konta. Bez e-maila i telefonu. Tenant wymusza baza, rola - `is_staff()`.

CREATE OR REPLACE FUNCTION public.editor_inline_author_lookup(
  p_query text DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  slug text,
  first_name text,
  last_name text,
  display_name text,
  job_title text,
  company text,
  website_url text,
  linkedin_url text,
  x_url text,
  facebook_url text,
  instagram_url text,
  avatar_url text,
  specialization text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH q AS (SELECT lower(btrim(COALESCE(p_query, ''))) AS v)
  SELECT pr.id,
         pr.slug,
         pr.first_name,
         pr.last_name,
         pr.display_name,
         COALESCE(NULLIF(ap.job_title, ''), pr.job_title),
         COALESCE(NULLIF(ap.company, ''), pr.current_company),
         COALESCE(NULLIF(ap.website_url, ''), pr.website_url),
         COALESCE(NULLIF(ap.linkedin_url, ''), pr.linkedin_url),
         COALESCE(NULLIF(ap.x_url, ''), pr.twitter_url),
         COALESCE(NULLIF(ap.facebook_url, ''), pr.facebook_url),
         COALESCE(NULLIF(ap.instagram_url, ''), pr.instagram_url),
         CASE WHEN pr.hide_avatar THEN NULL
              ELSE COALESCE(NULLIF(ap.avatar_url, ''), pr.avatar_url) END,
         pr.specialization
  FROM public.profiles pr
  CROSS JOIN q
  LEFT JOIN public.author_profiles ap
    ON ap.user_id = pr.id AND ap.tenant_id = pr.tenant_id
  WHERE auth.uid() IS NOT NULL
    AND (public.is_staff() OR public.has_role(auth.uid(), 'super_admin'::app_role))
    AND pr.tenant_id = public.current_tenant_id()
    AND public.user_is_editorial(pr.id)
    AND (
      (p_id IS NOT NULL AND pr.id = p_id)
      OR (
        p_id IS NULL
        AND (
          q.v = ''
          OR strpos(lower(concat_ws(' ', pr.display_name, pr.first_name, pr.last_name)), q.v) > 0
        )
      )
    )
  ORDER BY lower(COALESCE(NULLIF(pr.display_name, ''), concat_ws(' ', pr.first_name, pr.last_name)))
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 25)
$function$;

REVOKE ALL ON FUNCTION public.editor_inline_author_lookup(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editor_inline_author_lookup(text, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.editor_inline_author_lookup(text, uuid, integer) TO authenticated;
