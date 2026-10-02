CREATE OR REPLACE FUNCTION public.profiles_generate_unique_slug(_base text, _exclude_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_try int := 0;
BEGIN
  v_base := lower(unaccent(coalesce(_base, '')));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := regexp_replace(v_base, '(^-+|-+$)', '', 'g');
  v_base := regexp_replace(v_base, '-{2,}', '-', 'g');

  IF length(v_base) > 55 THEN
    v_base := regexp_replace(substr(v_base, 1, 55), '-+$', '', 'g');
  END IF;

  IF length(v_base) < 2 THEN
    v_base := 'user';
  ELSIF NOT EXISTS (SELECT 1 FROM public.profiles
                     WHERE slug = v_base AND id IS DISTINCT FROM _exclude_id) THEN
    RETURN v_base;
  END IF;

  LOOP
    v_try := v_try + 1;
    v_candidate := v_base || '-' || (1000 + floor(random() * 9000))::int::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles
                           WHERE slug = v_candidate AND id IS DISTINCT FROM _exclude_id);
    IF v_try >= 50 THEN
      v_candidate := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
      EXIT;
    END IF;
  END LOOP;

  RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_generate_unique_slug(_base text)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public, extensions
AS $$
  SELECT public.profiles_generate_unique_slug(_base, NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public.profiles_generate_unique_slug(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.profiles_ensure_slug()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := public.profiles_generate_unique_slug(
      COALESCE(
        NULLIF(btrim(concat_ws(' ', NEW.first_name, NEW.last_name)), ''),
        NULLIF(btrim(NEW.display_name), '')
      ),
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_ensure_slug() IS
  'BEFORE INSERT/UPDATE OF slug: pusty slug zastepuje slugiem z imienia i nazwiska '
  '(dalej display_name; przy kolizji sufiks czterech cyfr). Profil zawsze ma slug, '
  'wiec zaden link nie musi podstawiac id w miejsce sluga.';

REVOKE ALL ON FUNCTION public.profiles_ensure_slug() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_0_ensure_slug_trg ON public.profiles;
CREATE TRIGGER profiles_0_ensure_slug_trg
  BEFORE INSERT OR UPDATE OF slug ON public.profiles
  FOR EACH ROW
  WHEN (NEW.slug IS NULL OR btrim(NEW.slug) = '')
  EXECUTE FUNCTION public.profiles_ensure_slug();

UPDATE public.profiles SET slug = NULL
 WHERE slug IS NULL OR btrim(slug) = '';

UPDATE public.notifications n
   SET href = '/author/' || p.slug || substr(n.href, 45)
  FROM public.profiles p
 WHERE n.href ~ '^/author/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}([#?/]|$)'
   AND p.id = substr(n.href, 9, 36)::uuid
   AND btrim(COALESCE(p.slug, '')) <> '';

CREATE OR REPLACE FUNCTION public.notification_profile_ref(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(btrim(p.slug), '') FROM public.profiles p WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.notification_profile_ref(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notification_profile_ref(uuid) IS
  'Segment sciezki /author/<ref> dla powiadomien: slug profilu albo NULL (powiadomienie '
  'bez linku). Nigdy id - /author/<uuid> omija przekierowanie nie-autora na /people '
  'i po F5 konczy sie 404. Profil zawsze ma slug (profiles_0_ensure_slug_trg).';