-- ============================================================================
-- WYDARZENIA / PRELEGENCI: profil prelegenta + RPC dla widgetow buildera.
--
-- Ekosystem widgetow wydarzen (event-schedule / event-list / event-countdown /
-- speakers) potrzebuje publicznej, tenantowej projekcji "kto jest prelegentem":
--
--   * speaker_profiles - nakladka "profil prelegenta" na uzytkownika (analogia
--     do author_profiles = "profil eksperta"; doktryna "brak drugiego zrodla
--     prawdy": tozsamosc pochodzi z profiles/profiles_public, eksperckosc z
--     odznaki 'expert' + author_profiles, prelegenckosc z tej nakladki oraz
--     relacji event_speakers).
--   * Zapisy WYLACZNIE przez utwardzone RPC (wzorzec event_rsvps - tabela nie
--     ma klienckich polityk INSERT/UPDATE/DELETE): admin_upsert_speaker_profile
--     / admin_delete_speaker_profile (definer, brama roli w tenancie DOMOWYM =
--     current_tenant_id(), wiec bez mieszania z public_tenant_id() - patrz
--     scripts/check-sql-tenant-scope.ts).
--   * Most do CRM: upsert profilu prelegenta dosypuje/aktualizuje lead w
--     crm_leads przez istniejace crm_upsert_lead_from_profile(), oznacza go
--     source_type='speaker' + tagiem 'speaker' i zapisuje crm_lead_id na
--     profilu prelegenta. Kolumna crm_lead_id jest ODCIETA od klienckiego
--     SELECT grantem kolumnowym (wzorzec events.join_url).
--   * Odczyt publiczny: get_public_speakers() - jedna definerowa projekcja
--     (public_tenant_id(), bez has_role) laczaca profiles + author_profiles +
--     profile_badges + speaker_profiles + (opcjonalnie) event_speakers,
--     zwracajaca wylacznie kolumny publiczne.
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.speaker_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Rola sceniczna ("Dyrektorka programu Cyber", "Senior Fellow") - i18n.
  headline_pl text,
  headline_en text,
  -- Krotkie bio sceniczne (na karte prelegenta / dialog profilu) - i18n.
  bio_pl text,
  bio_en text,
  -- Tematy wystapien (chipy na profilu) - i18n.
  topics_pl text[] NOT NULL DEFAULT '{}',
  topics_en text[] NOT NULL DEFAULT '{}',
  -- Jezyki wystapien (kody, np. 'pl', 'en').
  languages text[] NOT NULL DEFAULT '{}',
  -- Statystyki prelegenta (dla sortowania/oceny w widgetach).
  talks_count integer NOT NULL DEFAULT 0 CHECK (talks_count >= 0),
  rating numeric(2,1) NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  reviews_count integer NOT NULL DEFAULT 0 CHECK (reviews_count >= 0),
  is_public boolean NOT NULL DEFAULT true,
  -- Most do CRM (staff-only; kolumna poza grantem klienckim).
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_speaker_profiles_tenant_public
  ON public.speaker_profiles (tenant_id, is_public);

DROP TRIGGER IF EXISTS speaker_profiles_set_updated_at ON public.speaker_profiles;
CREATE TRIGGER speaker_profiles_set_updated_at
  BEFORE UPDATE ON public.speaker_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Granty KOLUMNOWE: bez crm_lead_id dla klientow (staff czyta przez RPC).
REVOKE ALL ON public.speaker_profiles FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, user_id, headline_pl, headline_en, bio_pl, bio_en,
  topics_pl, topics_en, languages, talks_count, rating, reviews_count,
  is_public, created_at, updated_at
) ON public.speaker_profiles TO anon, authenticated;
GRANT ALL ON public.speaker_profiles TO service_role;
ALTER TABLE public.speaker_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "speaker_profiles public read" ON public.speaker_profiles;
CREATE POLICY "speaker_profiles public read" ON public.speaker_profiles
  FOR SELECT TO anon, authenticated
  USING (
    is_public
    AND tenant_id = (SELECT public.public_tenant_id())
  );

DROP POLICY IF EXISTS "speaker_profiles owner read" ON public.speaker_profiles;
CREATE POLICY "speaker_profiles owner read" ON public.speaker_profiles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
-- Zapisy wylacznie przez RPC admin_upsert_speaker_profile (brak polityk
-- INSERT/UPDATE/DELETE - wzorzec event_rsvps).

-- ----------------------------------------------------------------------------
-- RPC: publiczna projekcja prelegentow dla widgetow (katalog / wydarzenie).
--
-- p_event_id  - gdy podane: prelegenci wydarzenia (event_speakers) w kolejnosci
--               sort_order; profil prelegenta jest dolaczany LEFT JOIN-em, wiec
--               speaker bez nakladki tez sie wyswietli (dane z profiles).
-- p_user_ids  - gdy podane (bez p_event_id): rozwiazanie wskazanych profili
--               (sesje agendy w event-schedule wskazuja prelegentow po
--               user_id); nakladka speaker_profiles jest opcjonalna - profil
--               bez niej tez sie rozwiaze (dane publiczne z profiles +
--               author_profiles, ten sam zakres co profiles_public).
-- Bez obu     - publiczny katalog prelegentow (wiersze speaker_profiles).
--
-- Plaszczyzna TRESCI: wylacznie public_tenant_id(); zero has_role/is_staff.
-- Izolacja tenantow: KAZDA relacja (w tym profiles) jest przypieta do tenanta
-- z naglowka - event_speakers nie ma tenant_id, wiec bez predykatu na
-- profiles.tenant_id wpis wskazujacy na uzytkownika innego tenanta wyciekalby
-- jego display_name/avatar/slug na obcej domenie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_speakers(
  p_event_id uuid DEFAULT NULL,
  p_user_ids uuid[] DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  slug text,
  display_name text,
  avatar_url text,
  job_title text,
  company text,
  headline_pl text,
  headline_en text,
  bio_pl text,
  bio_en text,
  topics_pl text[],
  topics_en text[],
  languages text[],
  talks_count integer,
  rating numeric,
  reviews_count integer,
  is_expert boolean,
  has_speaker_profile boolean,
  sort_order integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH tenant AS (
    SELECT public.public_tenant_id() AS id
  ),
  base AS (
    -- Tryb wydarzenia: relacja event_speakers (kolejnosc = sort_order).
    SELECT es.user_id, es.sort_order
      FROM public.event_speakers es
      JOIN public.events e ON e.id = es.event_id
      JOIN tenant t ON t.id = e.tenant_id
     WHERE p_event_id IS NOT NULL
       AND es.event_id = p_event_id
       AND e.status = 'published'
    UNION ALL
    -- Tryb wskazanych profili (agenda): rozwiazujemy KAZDY profil tenanta,
    -- nie tylko te z nakladka speaker_profiles - nakladke doklada LEFT JOIN.
    SELECT ids.uid AS user_id, 0 AS sort_order
      FROM unnest(COALESCE(p_user_ids, ARRAY[]::uuid[])) AS ids(uid)
     WHERE p_event_id IS NULL
       AND p_user_ids IS NOT NULL
    UNION ALL
    -- Tryb katalogu: publiczne nakladki prelegentow tenanta.
    SELECT sp.user_id, 0 AS sort_order
      FROM public.speaker_profiles sp
      JOIN tenant t ON t.id = sp.tenant_id
     WHERE p_event_id IS NULL
       AND p_user_ids IS NULL
       AND sp.is_public
  )
  SELECT
    p.id AS user_id,
    p.slug,
    p.display_name,
    COALESCE(ap.avatar_url, p.avatar_url) AS avatar_url,
    ap.job_title,
    ap.company,
    sp.headline_pl,
    sp.headline_en,
    sp.bio_pl,
    sp.bio_en,
    COALESCE(sp.topics_pl, '{}') AS topics_pl,
    COALESCE(sp.topics_en, '{}') AS topics_en,
    COALESCE(sp.languages, '{}') AS languages,
    COALESCE(sp.talks_count, 0) AS talks_count,
    COALESCE(sp.rating, 0) AS rating,
    COALESCE(sp.reviews_count, 0) AS reviews_count,
    EXISTS (
      SELECT 1 FROM public.profile_badges pb
       WHERE pb.user_id = p.id
         AND pb.badge = 'expert'
         AND pb.tenant_id = (SELECT id FROM tenant)
    ) AS is_expert,
    (sp.id IS NOT NULL) AS has_speaker_profile,
    b.sort_order
  FROM base b
  JOIN public.profiles p
    ON p.id = b.user_id
   AND p.tenant_id = (SELECT id FROM tenant)
  LEFT JOIN public.speaker_profiles sp
    ON sp.user_id = b.user_id
   AND sp.tenant_id = (SELECT id FROM tenant)
   AND sp.is_public
  LEFT JOIN public.author_profiles ap
    ON ap.user_id = b.user_id
   AND ap.tenant_id = (SELECT id FROM tenant)
   AND ap.is_public
  WHERE (p_user_ids IS NULL OR b.user_id = ANY (p_user_ids))
  ORDER BY b.sort_order, lower(COALESCE(p.display_name, ''))
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_speakers(uuid, uuid[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_speakers(uuid, uuid[], integer)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RPC (staff): pelny odczyt profilu prelegenta (z crm_lead_id) w tenancie
-- DOMOWYM redaktora. Plaszczyzna AUTORYZOWANA: current_tenant_id() + has_role.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_speaker_profile(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  headline_pl text,
  headline_en text,
  bio_pl text,
  bio_en text,
  topics_pl text[],
  topics_en text[],
  languages text[],
  talks_count integer,
  rating numeric,
  reviews_count integer,
  is_public boolean,
  crm_lead_id uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
  ) THEN
    RAISE EXCEPTION 'speaker_profiles: staff role required';
  END IF;

  RETURN QUERY
  SELECT sp.id, sp.user_id, sp.headline_pl, sp.headline_en, sp.bio_pl, sp.bio_en,
         sp.topics_pl, sp.topics_en, sp.languages, sp.talks_count, sp.rating,
         sp.reviews_count, sp.is_public, sp.crm_lead_id, sp.updated_at
    FROM public.speaker_profiles sp
   WHERE sp.user_id = p_user_id
     AND sp.tenant_id = (SELECT public.current_tenant_id());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_speaker_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_speaker_profile(uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RPC (staff): upsert profilu prelegenta + most do CRM.
--
-- Most CRM (best-effort, nie blokuje zapisu profilu):
--   1. crm_upsert_lead_from_profile(user_id) gwarantuje istnienie leada
--      (unikalnosc po (tenant_id, email_norm), wypelnia tylko NULL-e),
--   2. lead dostaje tag 'speaker'; source_type przechodzi na 'speaker' tylko
--      z lagodniejszych zrodel (manual/registered/contact_form/newsletter) -
--      nie nadpisujemy mocniejszych segmentow (paid_subscriber, expert),
--   3. crm_lead_id zostaje zapisany na profilu prelegenta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_speaker_profile(
  p_user_id uuid,
  p_headline_pl text DEFAULT NULL,
  p_headline_en text DEFAULT NULL,
  p_bio_pl text DEFAULT NULL,
  p_bio_en text DEFAULT NULL,
  p_topics_pl text[] DEFAULT '{}',
  p_topics_en text[] DEFAULT '{}',
  p_languages text[] DEFAULT '{}',
  p_talks_count integer DEFAULT 0,
  p_rating numeric DEFAULT 0,
  p_reviews_count integer DEFAULT 0,
  p_is_public boolean DEFAULT true,
  p_sync_crm boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_profile_email text;
  v_lead_id uuid;
  v_row_id uuid;
BEGIN
  IF NOT (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
  ) THEN
    RAISE EXCEPTION 'speaker_profiles: staff role required';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'speaker_profiles: tenant unresolved';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
     WHERE pr.id = p_user_id AND pr.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'speaker_profiles: profile not found in tenant';
  END IF;

  INSERT INTO public.speaker_profiles (
    tenant_id, user_id, headline_pl, headline_en, bio_pl, bio_en,
    topics_pl, topics_en, languages, talks_count, rating, reviews_count,
    is_public
  ) VALUES (
    v_tenant, p_user_id,
    NULLIF(btrim(COALESCE(p_headline_pl, '')), ''),
    NULLIF(btrim(COALESCE(p_headline_en, '')), ''),
    NULLIF(btrim(COALESCE(p_bio_pl, '')), ''),
    NULLIF(btrim(COALESCE(p_bio_en, '')), ''),
    COALESCE(p_topics_pl, '{}'),
    COALESCE(p_topics_en, '{}'),
    COALESCE(p_languages, '{}'),
    GREATEST(COALESCE(p_talks_count, 0), 0),
    LEAST(GREATEST(COALESCE(p_rating, 0), 0), 5),
    GREATEST(COALESCE(p_reviews_count, 0), 0),
    COALESCE(p_is_public, true)
  )
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET
    headline_pl = EXCLUDED.headline_pl,
    headline_en = EXCLUDED.headline_en,
    bio_pl = EXCLUDED.bio_pl,
    bio_en = EXCLUDED.bio_en,
    topics_pl = EXCLUDED.topics_pl,
    topics_en = EXCLUDED.topics_en,
    languages = EXCLUDED.languages,
    talks_count = EXCLUDED.talks_count,
    rating = EXCLUDED.rating,
    reviews_count = EXCLUDED.reviews_count,
    is_public = EXCLUDED.is_public,
    updated_at = now()
  RETURNING id INTO v_row_id;

  IF p_sync_crm THEN
    BEGIN
      PERFORM public.crm_upsert_lead_from_profile(p_user_id);

      SELECT pr.email INTO v_profile_email
        FROM public.profiles pr
       WHERE pr.id = p_user_id;

      IF v_profile_email IS NOT NULL AND btrim(v_profile_email) <> '' THEN
        UPDATE public.crm_leads l
           SET tags = (SELECT ARRAY(
                 SELECT DISTINCT t FROM unnest(l.tags || ARRAY['speaker']) AS t
               )),
               source_type = CASE
                 WHEN l.source_type IN ('manual', 'registered', 'contact_form', 'newsletter')
                   THEN 'speaker'
                 ELSE l.source_type
               END,
               last_activity_at = now(),
               updated_at = now()
         WHERE l.tenant_id = v_tenant
           AND l.email_norm = lower(btrim(v_profile_email))
        RETURNING l.id INTO v_lead_id;

        IF v_lead_id IS NOT NULL THEN
          UPDATE public.speaker_profiles
             SET crm_lead_id = v_lead_id
           WHERE id = v_row_id AND crm_lead_id IS DISTINCT FROM v_lead_id;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'speaker_profiles: crm bridge failed: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('id', v_row_id, 'crm_lead_id', v_lead_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_upsert_speaker_profile(
  uuid, text, text, text, text, text[], text[], text[], integer, numeric, integer, boolean, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_speaker_profile(
  uuid, text, text, text, text, text[], text[], text[], integer, numeric, integer, boolean, boolean
) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RPC (staff): usuniecie profilu prelegenta w tenancie domowym.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_speaker_profile(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF NOT (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
  ) THEN
    RAISE EXCEPTION 'speaker_profiles: staff role required';
  END IF;

  DELETE FROM public.speaker_profiles
   WHERE user_id = p_user_id
     AND tenant_id = (SELECT public.current_tenant_id());
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_speaker_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_speaker_profile(uuid)
  TO authenticated, service_role;
