-- ============================================================================
-- FINDING: `profiles_public` serwowal 22-kolumnowa projekcje KAZDEGO profilu
-- tenanta osobie NIEZALOGOWANEJ.
--
-- Stan zastany (20260724130000): widok jest definerowy (security_invoker=off,
-- GRANT SELECT ... TO anon) i zawezal WYLACZNIE po `tenant_id =
-- public_tenant_id()`. Zadnej bramki widocznosci: zwykly czlonek, ktory nigdy
-- nie wyrazil zgody na katalog (`profiles.discoverable = false`), byl czytelny
-- dla dowolnego `curl`-a pod /rest/v1/profiles_public - z imieniem, nazwiskiem,
-- avatarem, okladka, dwoma bio, stanowiskiem, firma, specjalizacja i szescioma
-- linkami spolecznosciowymi. Enumeracja calej bazy czlonkowskiej byla jednym
-- zadaniem GET.
--
-- Interfejs obiecywal (PL i EN, `profilePrivacy.externalNote` w
-- src/lib/i18n-chat.ts) dokladnie odwrotnie: "osoby niezalogowane i roboty
-- wyszukiwarek nie maja do niego dostepu". Kod ZNAL te luke i mitygowal ja
-- wylacznie `noindex` na /author/$slug (src/lib/experts/publicVisibility.ts) -
-- ale obietnica dotyczyla DOSTEPU, nie indeksowania. `noindex` nie zabiera
-- nikomu wiersza z Data API; jest prosba do crawlera, nie kontrola dostepu.
--
-- Druga, cichsza dziura tego samego widoku: tenant bral sie WYLACZNIE z
-- naglowka `x-tenant-host` (public_tenant_id()), wiec zalogowany user tenanta A
-- podmieniajac naglowek na domene tenanta B czytal katalog osobowy B. Baza
-- czlonkowska firmy przeciekala do obszaru roboczego innej firmy.
--
-- ── ROZWIAZANIE: trzy warstwy widocznosci egzekwowane W BAZIE ───────────────
--
--   T1  PUBLICZNA (kazdy, w tym anon) - tenant PRZEGLADANEJ witryny
--       (public_tenant_id()) ORAZ realna publiczna obecnosc osoby:
--       rola redakcyjna, odznaka 'expert', publiczny profil autorski lub
--       prelegenta, autorstwo/wspolautorstwo opublikowanej tresci,
--       prowadzenie/wystapienie na opublikowanym wydarzeniu. To jest zbior
--       osob, ktore platforma i tak publikuje pod /author/$slug, w bylinach
--       wpisow i w katalogu ekspertow - ani jedna osoba wiecej.
--
--   T2  CZLONKOWSKA (tylko zalogowany) - WYLACZNIE tenant DOMOWY wolajacego
--       (current_tenant_id(), z profilu - nie z naglowka), a w nim: wlasny
--       wiersz, opt-in do katalogu (`discoverable`), staff tenanta oraz osoba
--       polaczona zaakceptowanym kontaktem. Semantyka 1:1 z get_chat_peers()
--       i search_people() - jedna doktryna widocznosci wewnetrznej.
--
--   Warstwy sa ADDYTYWNE (OR), wiec zalogowany nigdy nie widzi MNIEJ niz anon,
--   a naglowek `x-tenant-host` nie otwiera juz warstwy czlonkowskiej obcego
--   tenanta: podmiana hosta daje najwyzej to, co i tak jest publiczne.
--
-- Kolejnosc galezi OR jest CELOWA (Postgres liczy je od lewej): najpierw
-- darmowy `auth.uid() IS NOT NULL` (anon wypada natychmiast, bez ani jednego
-- wywolania funkcji warstwy czlonkowskiej), potem porownania kolumnowe, na
-- koncu funkcje z EXISTS. COST na funkcjach domyka temat dla planisty.
--
-- Kompatybilnosc: projekcja kolumn jest BEZ ZMIAN (te same 22 kolumny, ta sama
-- kolejnosc), wiec CREATE OR REPLACE VIEW wystarcza - zaden obiekt zalezny
-- (get_expert_hub, get_public_speakers) nie wymaga przebudowy, a wygenerowane
-- typy klienta pozostaja wazne.
-- ============================================================================

-- ── (1) Publiczna obecnosc osoby - jedno zrodlo prawdy ──────────────────────
-- SECURITY DEFINER, bo pyta o STAN FAKTYCZNY (czy sa opublikowane materialy),
-- a nie o to, co akurat widzi wolajacy - inaczej anon nie zobaczylby autora
-- tresci, do ktorej sam ma dostep. Zwraca WYLACZNIE boolean, wiec nie moze
-- wynosic danych.
--
-- KAZDA relacja jest przypieta do tenanta profilu (p_tenant_id): odznaka,
-- profil autorski/prelegencki, post, podcast i wydarzenie niosa `tenant_id`,
-- a `post_authors`/`event_speakers` (bez wlasnego tenanta) doklejaja go
-- joinem do rodzica. Bez tego wiersz-satelita zapisany w tenancie B
-- otwieralby profil tenanta A na obcej domenie.
--
-- Rola redakcyjna jest liczona INLINE (a nie przez user_is_editorial()), bo
-- tamten helper celowo nie zna tenanta - tutaj tenant jest czescia inwariantu.
CREATE OR REPLACE FUNCTION public.profile_has_public_presence(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
COST 400
AS $$
  SELECT p_user_id IS NOT NULL
     AND p_tenant_id IS NOT NULL
     AND (
       -- Konto redakcyjne (autor/edytor/admin) - ten sam zbior, ktory bramkuje
       -- polityke "Profiles anon public authors" na tabeli bazowej.
       EXISTS (
         SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = p_user_id
            AND ur.tenant_id = p_tenant_id
            AND ur.role IN ('admin'::public.app_role, 'editor'::public.app_role,
                            'author'::public.app_role, 'super_admin'::public.app_role)
       )
       -- Kurowana odznaka eksperta (katalog /experts).
       OR EXISTS (
         SELECT 1 FROM public.profile_badges b
          WHERE b.user_id = p_user_id
            AND b.tenant_id = p_tenant_id
            AND b.badge = 'expert'
       )
       -- Swiadomy opt-in do publicznego profilu autorskiego.
       OR EXISTS (
         SELECT 1 FROM public.author_profiles ap
          WHERE ap.user_id = p_user_id
            AND ap.tenant_id = p_tenant_id
            AND ap.is_public = true
       )
       -- Swiadomy opt-in do publicznego profilu prelegenta (widgety wydarzen).
       OR EXISTS (
         SELECT 1 FROM public.speaker_profiles sp
          WHERE sp.user_id = p_user_id
            AND sp.tenant_id = p_tenant_id
            AND sp.is_public = true
       )
       -- Autor opublikowanego wpisu (byline na powierzchni publicznej).
       OR EXISTS (
         SELECT 1 FROM public.posts po
          WHERE po.author_id = p_user_id
            AND po.tenant_id = p_tenant_id
            AND po.status = 'published'
            AND po.deleted_at IS NULL
       )
       -- Wspolautor opublikowanego wpisu.
       OR EXISTS (
         SELECT 1
           FROM public.post_authors pa
           JOIN public.posts po2 ON po2.id = pa.post_id
          WHERE pa.user_id = p_user_id
            AND po2.tenant_id = p_tenant_id
            AND po2.status = 'published'
            AND po2.deleted_at IS NULL
       )
       -- Autor opublikowanego podcastu.
       OR EXISTS (
         SELECT 1 FROM public.podcasts pd
          WHERE pd.author_id = p_user_id
            AND pd.tenant_id = p_tenant_id
            AND pd.status = 'published'
            AND pd.deleted_at IS NULL
       )
       -- Gospodarz opublikowanego wydarzenia.
       OR EXISTS (
         SELECT 1 FROM public.events ev
          WHERE ev.host_user_id = p_user_id
            AND ev.tenant_id = p_tenant_id
            AND ev.status = 'published'
       )
       -- Prelegent opublikowanego wydarzenia.
       OR EXISTS (
         SELECT 1
           FROM public.event_speakers es
           JOIN public.events ev2 ON ev2.id = es.event_id
          WHERE es.user_id = p_user_id
            AND ev2.tenant_id = p_tenant_id
            AND ev2.status = 'published'
       )
     )
$$;

REVOKE ALL ON FUNCTION public.profile_has_public_presence(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_has_public_presence(uuid, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.profile_has_public_presence(uuid, uuid) IS
  'Czy osoba ma REALNA publiczna obecnosc w danym tenancie: rola redakcyjna, '
  'odznaka expert, publiczny profil autorski/prelegencki, autorstwo lub '
  'wspolautorstwo opublikowanej tresci, prowadzenie lub wystapienie na '
  'opublikowanym wydarzeniu. Bramka warstwy PUBLICZNEJ widoku profiles_public - '
  'goly profil czlonka nie jest czytelny dla anon. Kazda relacja przypieta do '
  'p_tenant_id (izolacja obszarow roboczych).';

-- ── (2) Staff tenanta DOMOWEGO - opakowanie ACL-owe ─────────────────────────
-- is_staff() nie ma EXECUTE dla anon, a przywileje funkcji w ciele widoku sa
-- sprawdzane wzgledem WOLAJACEGO (widok definerowy przelacza role tylko dla
-- RELACJI, nie dla funkcji) - anon dostalby 42501 zamiast pustego zbioru.
-- SECURITY DEFINER przelacza role na wlasciciela, wiec wewnetrzne wywolanie
-- przechodzi, a na zewnatrz wychodzi wylacznie boolean.
--
-- Rola jest ZAWSZE liczona w tenancie DOMOWYM (has_role/is_super_admin czytaja
-- user_roles wolajacego) i jest uzywana wylacznie w galezi widoku zwiazanej z
-- current_tenant_id() - nigdy z public_tenant_id(). Dlatego podmiana naglowka
-- x-tenant-host nie zamienia sie w przepustke stafowa do obcego tenanta
-- (inwariant scripts/check-sql-tenant-scope.ts).
CREATE OR REPLACE FUNCTION public.caller_is_tenant_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
COST 5
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.is_staff() OR public.is_super_admin(auth.uid()))
$$;

REVOKE ALL ON FUNCTION public.caller_is_tenant_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_is_tenant_staff()
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.caller_is_tenant_staff() IS
  'Czy WOLAJACY jest staffem (admin/editor/author) lub super adminem swojego '
  'tenanta DOMOWEGO. Opakowanie ACL-owe nad is_staff(): widok profiles_public '
  'jest czytany takze przez anon, a przywileje EXECUTE w ciele widoku sa '
  'sprawdzane wzgledem wolajacego. Zwraca false dla anon.';

-- ── (3) Zaakceptowany kontakt z wolajacym ───────────────────────────────────
-- Warstwa czlonkowska musi rozwiazac profil osoby, z ktora wolajacy JEST
-- polaczony, nawet gdy ta osoba wypisala sie z katalogu (`discoverable=false`) -
-- inaczej /network/mutual/$userId pokazywalby pusta nazwe dla wlasnego kontaktu.
-- Ta sama zasada, co w get_chat_peers() (galaz "wspolna konwersacja").
CREATE OR REPLACE FUNCTION public.caller_is_connected_to(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
COST 60
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.user_connections uc
        WHERE uc.status = 'accepted'
          AND (
            (uc.requester_id = auth.uid() AND uc.addressee_id = p_user_id)
            OR (uc.addressee_id = auth.uid() AND uc.requester_id = p_user_id)
          )
     )
$$;

REVOKE ALL ON FUNCTION public.caller_is_connected_to(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_is_connected_to(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.caller_is_connected_to(uuid) IS
  'Czy wolajacego i wskazana osobe laczy ZAAKCEPTOWANY kontakt (user_connections). '
  'Galaz warstwy czlonkowskiej widoku profiles_public - wlasny kontakt pozostaje '
  'rozwiazywalny mimo wypisania sie z katalogu. Zwraca false dla anon.';

-- ── (4) profiles_public: trzy warstwy zamiast golego filtra tenanta ─────────
-- Ta sama lista kolumn i ta sama kolejnosc, co w 20260724130000 - CREATE OR
-- REPLACE zmienia WYLACZNIE predykat.
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = off, security_barrier = true) AS
SELECT
  p.id,
  p.tenant_id,
  p.slug,
  p.display_name,
  p.first_name,
  p.last_name,
  p.avatar_url,
  p.cover_url,
  p.bio_pl,
  p.bio_en,
  p.job_title,
  p.twitter_url,
  p.linkedin_url,
  p.facebook_url,
  p.instagram_url,
  p.spotify_url,
  p.website_url,
  p.current_company,
  p.specialization,
  p.verified_at,
  p.updated_at,
  p.expert_requests_enabled
FROM public.profiles p
WHERE
  -- T2: warstwa CZLONKOWSKA - tylko zalogowany, tylko tenant DOMOWY.
  -- Pierwsza, bo `auth.uid() IS NOT NULL` odsiewa anon za darmo, a dla staffu
  -- konczy sie na taniej galezi bez dotykania funkcji obecnosci publicznej.
  (
    auth.uid() IS NOT NULL
    AND p.tenant_id = public.current_tenant_id()
    AND (
      p.id = auth.uid()
      OR p.discoverable = true
      OR public.caller_is_tenant_staff()
      OR public.caller_is_connected_to(p.id)
    )
  )
  -- T1: warstwa PUBLICZNA - tenant przegladanej witryny + realna obecnosc.
  OR (
    p.tenant_id = public.public_tenant_id()
    AND public.profile_has_public_presence(p.id, p.tenant_id)
  );

GRANT SELECT ON public.profiles_public TO anon, authenticated;

COMMENT ON VIEW public.profiles_public IS
  'Publiczna projekcja profilu z DWIEMA addytywnymi warstwami widocznosci. '
  'PUBLICZNA (takze anon): tenant z public_tenant_id() ORAZ realna publiczna '
  'obecnosc osoby (profile_has_public_presence) - goly profil czlonka jest '
  'NIEDOSTEPNY dla niezalogowanych, zgodnie z obietnica interfejsu. '
  'CZLONKOWSKA (tylko zalogowany): WYLACZNIE tenant domowy (current_tenant_id(), '
  'z profilu - nie z naglowka) i w nim wlasny wiersz, opt-in discoverable, staff '
  'tenanta albo zaakceptowany kontakt. Warstwy sa addytywne, wiec zalogowany '
  'nigdy nie widzi mniej niz anon, a podmiana x-tenant-host nie otwiera katalogu '
  'osobowego obcego tenanta.';

-- ── (5) Wlasna ekspozycja publiczna - dla uczciwego copy w UI ───────────────
-- Panel prywatnosci nie moze dalej obiecywac "nigdy nie jestes widoczny na
-- zewnatrz", bo dla autora/eksperta to nieprawda (jego hub /author/$slug jest
-- publiczny z zalozenia). RPC zwraca WLASNY stan ekspozycji wraz z powodami,
-- zeby interfejs pokazal fakt zamiast obietnicy.
--
-- Wylacznie wlasny wiersz (auth.uid()), wiec nie ma tu powierzchni enumeracji.
CREATE OR REPLACE FUNCTION public.get_my_public_exposure()
RETURNS TABLE (
  is_public boolean,
  discoverable boolean,
  by_editorial_role boolean,
  by_expert_badge boolean,
  by_author_profile boolean,
  by_speaker_profile boolean,
  by_published_content boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Kolumny CTE sa PRZEMIANOWANE (me_*), bo nazwy kolumn z RETURNS TABLE sa
  -- parametrami wyjsciowymi funkcji i widza je referencje w ciele: goly
  -- `discoverable` albo `is_public` bylby wtedy dwuznaczny.
  WITH me AS (
    SELECT pr.id AS me_id, pr.tenant_id AS me_tenant, pr.discoverable AS me_discoverable
      FROM public.profiles pr
     WHERE pr.id = auth.uid()
  )
  SELECT
    public.profile_has_public_presence(me.me_id, me.me_tenant),
    me.me_discoverable,
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = me.me_id
         AND ur.tenant_id = me.me_tenant
         AND ur.role IN ('admin'::public.app_role, 'editor'::public.app_role,
                         'author'::public.app_role, 'super_admin'::public.app_role)
    ),
    EXISTS (
      SELECT 1 FROM public.profile_badges b
       WHERE b.user_id = me.me_id AND b.tenant_id = me.me_tenant AND b.badge = 'expert'
    ),
    EXISTS (
      SELECT 1 FROM public.author_profiles ap
       WHERE ap.user_id = me.me_id AND ap.tenant_id = me.me_tenant AND ap.is_public = true
    ),
    EXISTS (
      SELECT 1 FROM public.speaker_profiles sp
       WHERE sp.user_id = me.me_id AND sp.tenant_id = me.me_tenant AND sp.is_public = true
    ),
    (
      EXISTS (
        SELECT 1 FROM public.posts po
         WHERE po.author_id = me.me_id AND po.tenant_id = me.me_tenant
           AND po.status = 'published' AND po.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.post_authors pa
          JOIN public.posts po2 ON po2.id = pa.post_id
         WHERE pa.user_id = me.me_id AND po2.tenant_id = me.me_tenant
           AND po2.status = 'published' AND po2.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.podcasts pd
         WHERE pd.author_id = me.me_id AND pd.tenant_id = me.me_tenant
           AND pd.status = 'published' AND pd.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.events ev
         WHERE ev.host_user_id = me.me_id AND ev.tenant_id = me.me_tenant
           AND ev.status = 'published'
      )
      OR EXISTS (
        SELECT 1 FROM public.event_speakers es
          JOIN public.events ev2 ON ev2.id = es.event_id
         WHERE es.user_id = me.me_id AND ev2.tenant_id = me.me_tenant
           AND ev2.status = 'published'
      )
    )
  FROM me
$$;

REVOKE ALL ON FUNCTION public.get_my_public_exposure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_public_exposure() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_my_public_exposure() IS
  'Ekspozycja publiczna WLASNEGO profilu wraz z powodami (rola redakcyjna, '
  'odznaka expert, publiczny profil autorski/prelegencki, opublikowana tresc). '
  'Zasila panel prywatnosci, ktory pokazuje FAKTYCZNY stan zamiast ogolnej '
  'obietnicy. Wylacznie wiersz auth.uid() - zero powierzchni enumeracji.';

-- ── (6) Indeksy wspierajace bramke ──────────────────────────────────────────
-- Predykat obecnosci to zestaw EXISTS-ow; kazdy musi konczyc sie sondowaniem
-- indeksu, inaczej lista profili (np. picker prelegentow) placi sekwencyjny
-- skan tresci. Czesc indeksow juz istnieje (idx_post_authors_user,
-- idx_event_speakers_user, idx_posts_author_published, idx_profile_badges_user)
-- - IF NOT EXISTS trzyma migracje idempotentna.
CREATE INDEX IF NOT EXISTS idx_posts_author_published
  ON public.posts (author_id)
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_post_authors_user
  ON public.post_authors (user_id);

CREATE INDEX IF NOT EXISTS idx_event_speakers_user
  ON public.event_speakers (user_id);

CREATE INDEX IF NOT EXISTS idx_podcasts_author_published
  ON public.podcasts (author_id)
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_host_published
  ON public.events (host_user_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_author_profiles_user_public
  ON public.author_profiles (user_id, tenant_id)
  WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_speaker_profiles_user_public
  ON public.speaker_profiles (user_id, tenant_id)
  WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_user_roles_user_tenant_role
  ON public.user_roles (user_id, tenant_id, role);

CREATE INDEX IF NOT EXISTS idx_user_connections_pair_accepted
  ON public.user_connections (requester_id, addressee_id)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS idx_user_connections_pair_accepted_rev
  ON public.user_connections (addressee_id, requester_id)
  WHERE status = 'accepted';
