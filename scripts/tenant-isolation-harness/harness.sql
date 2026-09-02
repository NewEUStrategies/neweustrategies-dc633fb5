-- Minimalna atrapa platformy potrzebna do WYKONANIA polityk RLS plaszczyzny
-- wlasciciela (media_mentions, saved_searches, user_follows) na czystym
-- Postgresie. Odtwarza wylacznie to, na czym te polityki realnie stoja:
-- auth.uid(), tenants, profiles, current_tenant_id(), public_tenant_id(),
-- has_role() oraz same tabele w ksztalcie z migracji zrodlowych.
--
-- Testowanym artefaktem sa POLITYKI z prawdziwej migracji (run.sh aplikuje plik
-- z supabase/migrations), a nie ich kopia - atrapa dostarcza tylko otoczenia.
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Supabase nadaje te uprawnienia w kazdym projekcie i BEZ NICH atrapa klamie
-- w jednym konkretnym miejscu: wyrazenie polityki jest analizowane przy
-- `CREATE POLICY` (jako wlasciciel), wiec brak USAGE na schemacie `auth` nie
-- przeszkadza politykom - ale przeszkadza KAZDEMU zapytaniu, ktore rola
-- `authenticated` pisze sama. Polityka `user_blocks_owner_insert` wyznacza
-- tenanta PODZAPYTANIEM do `public.profiles` wykonywanym JAKO WOLAJACY, wiec
-- bez tych dwoch grantow odbijalaby sie o uprawnienia, a nie o RLS - i dowod
-- rownowaznosci obu form mierzylby cos innego, niz opisuje.
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'author', 'user', 'super_admin');

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name text
);
-- Produkcja daje `authenticated` odczyt profili (a nad nim RLS z polityka
-- odczytu WLASNEGO wiersza). Atrapa daje sam GRANT: modelowanie tamtej
-- polityki nie zmienia odpowiedzi dla wiersza WOLAJACEGO, a to jedyny wiersz,
-- ktory czyta podzapytanie z `user_blocks_owner_insert`. Roznica miedzy forma
-- funkcyjna (SECURITY DEFINER, omija RLS) a podzapytaniowa (biegnie jako
-- wolajacy, podlega RLS) jest przypieta STATYCZNIE w chatPolicyContract.test.ts.
GRANT SELECT ON public.profiles TO authenticated;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  -- `tenant_id` z migracji 20260531181120 - potrzebne, bo koncowa definicja
  -- `public.is_super_admin()` (20260824074231) porownuje je z tenantem
  -- wolajacego, a bez tej kolumny funkcja nie da sie utworzyc.
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  UNIQUE (user_id, role)
);

INSERT INTO public.tenants (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'nes'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B', 'tb');

CREATE OR REPLACE FUNCTION public.public_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.user_id = _user_id
       AND ur.role = _role
       AND p.tenant_id = public.current_tenant_id()
  )
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- --------------------------------------------------------------------------
-- Tabele w ksztalcie z migracji zrodlowych (kolumny istotne dla RLS).
-- --------------------------------------------------------------------------
CREATE TABLE public.media_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outlet text NOT NULL,
  title text NOT NULL,
  published_on date NOT NULL DEFAULT current_date,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  query text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);

GRANT SELECT ON public.media_mentions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.media_mentions TO authenticated;
GRANT ALL ON public.media_mentions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_searches TO authenticated;
GRANT ALL ON public.saved_searches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_follows TO authenticated;
GRANT ALL ON public.user_follows TO service_role;

ALTER TABLE public.media_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

-- Stan SPRZED naprawy: polityki bez tenanta. Migracja z supabase/migrations je
-- podmienia - dzieki temu harness sprawdza takze, ze podmiana faktycznie zaszla.
CREATE POLICY "media_mentions public read" ON public.media_mentions
  FOR SELECT TO anon, authenticated
  USING (is_public = true AND tenant_id = (SELECT public.public_tenant_id()));
CREATE POLICY "media_mentions owner read" ON public.media_mentions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "media_mentions owner manage" ON public.media_mentions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "media_mentions staff manage" ON public.media_mentions
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::public.app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::public.app_role)
    )
  );

CREATE POLICY "saved_searches owner select" ON public.saved_searches
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "saved_searches owner insert" ON public.saved_searches
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "saved_searches owner update" ON public.saved_searches
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "saved_searches owner delete" ON public.saved_searches
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "follows owner select" ON public.user_follows
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "follows owner insert" ON public.user_follows
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "follows owner delete" ON public.user_follows
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ==========================================================================
-- ROZSZERZENIE 2026-08-31: plaszczyzna wlasciciela w modulach monetyzacji.
--
-- Przeglad polityk modulow 13 (checkout/subskrypcje/billing) i 14 (kupony/
-- darowizny/prezenty/reklamy) wykazal SZESC dalszych wystapien tego samego
-- wzorca, co naprawiony 2026-08-29: odczyt wlasciciela bez predykatu tenanta
-- na tabeli, ktora tenant_id ma. Bramka `check:sql-owner-tenant-scope` ich nie
-- widzi, bo kazda z tych tabel ma DOKLADNIE JEDNA polityke wlascicielska
-- (tenanta pilnuje polityka ADMINISTRACYJNA, a wiec nie ma rodzenstwa
-- deklarujacego intencje) - dlatego dowod musi byc wykonawczy, nie statyczny.
--
-- Kolumny sa okrojone do tych, na ktorych stoi RLS. Polityki ponizej odtwarzaja
-- stan SPRZED naprawy - migracja 20260831060000 je podmienia.
-- ==========================================================================
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.membership_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_key text NOT NULL DEFAULT 'member',
  source text NOT NULL DEFAULT 'manual',
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  org_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_email text,
  role text NOT NULL DEFAULT 'member',
  claimed_at timestamptz
);

CREATE TABLE public.user_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Wlascicielem linku prezentowego jest `created_by`, nie `user_id` - dlatego ta
-- luka jest niewidoczna dla heurystyki nazwy kolumny.
CREATE TABLE public.post_gift_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  post_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Atrapa wylacznie po to, by migracja 20260831060000 wykonala sie w calosci:
-- niesie ona COMMENT ON COLUMN dokumentujacy ROZSTRZYGNIECIE sprawy tenant_id
-- na tej tabeli. Bez atrapy caly plik migracji zostalby pominiety (--single-
-- transaction), a asercje ponizej testowalyby stan SPRZED naprawy, milczac.
CREATE TABLE public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'stripe',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.payment_webhook_events TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_grants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_seats TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_purchases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_gift_links TO authenticated;
GRANT ALL ON public.subscriptions, public.membership_grants, public.organization_seats,
  public.user_purchases, public.user_subscriptions, public.post_gift_links TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_gift_links ENABLE ROW LEVEL SECURITY;

-- Stan SPRZED naprawy - dokladnie tresc z migracji zrodlowych.
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "grants own read" ON public.membership_grants
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "seats own read" ON public.organization_seats
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "purchases owner read"
  ON public.user_purchases FOR SELECT TO authenticated
  USING (user_id = auth.uid()
    OR (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "subs owner read"
  ON public.user_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid()
    OR (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "gift links owner read"
  ON public.post_gift_links FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      tenant_id = current_tenant_id()
      AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    )
  );

-- ==========================================================================
-- ROZSZERZENIE 2026-08-31 (2): KANONICZNA SCIEZKA STRONY (MODUL 3).
--
-- Inna klasa luki niz cala reszta tego pliku i dlatego wymaga innych asercji.
-- Tam problemem byla POLITYKA gubiaca tenanta. Tu polityki nie ma o co pytac:
-- `public.page_full_path()` jest wolana SPOD SERVICE-ROLE przez generator
-- sitemapy (`src/lib/server/sitemapEntries.server.ts:75`), a service_role ma
-- BYPASSRLS - zadna polityka nad ta funkcja nie stoi. Izolacje musi wiec
-- dowiezc CIALO FUNKCJI (predykat najemcy w rekurencji) i SCHEMAT
-- (ograniczenie na `parent_id`), a nie RLS.
--
-- ZASIEG - sprawdzony na stanie KONCOWYM polityk (lokalna replika, 931
-- migracji), nie na migracji zalozycielskiej. Polityka
-- `"Public reads published pages"` NIE jest dzis tenant-slepa: brzmi
-- `status = 'published' AND deleted_at IS NULL AND tenant_id = public_tenant_id()`.
-- Odtwarzam ja ponizej W TEJ POSTACI, a nie w tenant-slepej postaci
-- z 20260531182153 - atrapa ma odwzorowywac produkcje, nie ulatwiac asercji.
-- Asercje odczytu i tak nie ida przez RLS: wolaja funkcje jako wlasciciel bazy,
-- czyli w ukladzie uprawnien generatora sitemapy, bo TAM wyciek jest realny.
--
-- Ponizej stan SPRZED naprawy: stary, jednokolumnowy klucz obcy na parent_id
-- i tenant-slepe cialo obu funkcji. Migracje 20260831160000 dobiera run.sh
-- i ona te definicje podmienia - dzieki temu harness sprawdza takze, ze
-- podmiana faktycznie zaszla.
-- ==========================================================================
CREATE TABLE public.pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.pages(id) ON DELETE RESTRICT,
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  -- `deleted_at` jest w atrapie WYLACZNIE dlatego, ze wystepuje w warunku
  -- odtwarzanej polityki publicznej - kolumna bez niej rozjezdzalaby atrape
  -- z produkcja w miejscu, ktore ta sekcja mierzy.
  deleted_at timestamptz,
  UNIQUE (tenant_id, slug)
);

GRANT SELECT ON public.pages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pages TO authenticated;
GRANT ALL ON public.pages TO service_role;

ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public reads published pages"
  ON public.pages FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND deleted_at IS NULL AND tenant_id = public_tenant_id());

CREATE POLICY "Staff reads own tenant pages"
  ON public.pages FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'author'))
  );

CREATE POLICY "Authors write own tenant pages"
  ON public.pages FOR ALL
  TO authenticated
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Stan SPRZED naprawy: rekurencja bez predykatu najemcy.
CREATE OR REPLACE FUNCTION public.page_full_path(_page_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, slug, 1 AS depth FROM public.pages WHERE id = _page_id
    UNION ALL
    SELECT p.id, p.parent_id, p.slug, c.depth + 1
      FROM public.pages p JOIN chain c ON p.id = c.parent_id
     WHERE c.depth < 50
  )
  SELECT string_agg(slug, '/' ORDER BY depth DESC) FROM chain;
$$;

CREATE OR REPLACE FUNCTION public.page_full_paths(_page_ids uuid[])
RETURNS TABLE(page_id uuid, full_path text)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE requested AS (SELECT DISTINCT unnest(_page_ids) AS root_id),
  chain AS (
    SELECT r.root_id, p.id, p.parent_id, p.slug, 1 AS depth
      FROM requested r JOIN public.pages p ON p.id = r.root_id
    UNION ALL
    SELECT c.root_id, p.id, p.parent_id, p.slug, c.depth + 1
      FROM public.pages p JOIN chain c ON p.id = c.parent_id
     WHERE c.depth < 50
  )
  SELECT root_id AS page_id, string_agg(slug, '/' ORDER BY depth DESC) AS full_path
    FROM chain GROUP BY root_id;
$$;

GRANT EXECUTE ON FUNCTION public.page_full_path(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.page_full_paths(uuid[]) TO anon, authenticated, service_role;

-- ==========================================================================
-- ROZSZERZENIE 2026-08-31 (3): DWIE OSTATNIE REALNE DZIURY PLASZCZYZNY
-- WLASCICIELA (migracja 20260831170000).
--
-- Przeglad na STANIE KONCOWYM polityk (931 migracji na lokalnej replice,
-- 579 polityk w `public`) dal dziesiec trafien wzorca "wlasciciel przez
-- auth.uid() bez wzmianki o current_tenant_id"; PIEC bylo bezpiecznych - wiazaly
-- tenanta innym idiomem (`_caller_tenant()` albo podzapytanie po `profiles`) -
-- a te dwie tabele nie wiazaly go wcale. Obie niosa DANE OSOBOWE, wiec i tu
-- dowod musi byc wykonawczy, nie statyczny.
--
-- Polityki ponizej odtwarzaja stan SPRZED naprawy; migracja je podmienia.
-- ==========================================================================
CREATE TABLE public.user_read_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  post_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.personality_result_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  openness smallint NOT NULL DEFAULT 0,
  conscientiousness smallint NOT NULL DEFAULT 0,
  extraversion smallint NOT NULL DEFAULT 0,
  agreeableness smallint NOT NULL DEFAULT 0,
  neuroticism smallint NOT NULL DEFAULT 0,
  taken_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_read_history TO authenticated;
GRANT ALL ON public.user_read_history TO service_role;
GRANT SELECT ON public.personality_result_history TO authenticated;
GRANT ALL ON public.personality_result_history TO service_role;

ALTER TABLE public.user_read_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personality_result_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_history owner select" ON public.user_read_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "read_history owner insert" ON public.user_read_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "read_history owner update" ON public.user_read_history
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "read_history owner delete" ON public.user_read_history
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "personality_history_owner_read" ON public.personality_result_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- WSZYSTKIE wiersze (stron i plaszczyzny wlasciciela) seeduje runtime_test.sql
-- razem z auth.users i profiles. Taka jest konwencja tej uprzezy: harness.sql
-- daje SCHEMAT, runtime_test.sql DANE - INSERT tutaj lamalby FK na auth.users,
-- ktore jest wypelniane dopiero tam.

-- ==========================================================================
-- ROZSZERZENIE 2026-09-01: PLASZCZYZNA CZATU (MODUL 09).
--
-- Modul 09 dostal bramke STATYCZNA (`src/lib/ci/__tests__/chatPolicyContract.test.ts`),
-- ktora dowodzi KSZTALTU polityk czytanego z migracji. Tutaj domykamy dowod
-- WYKONAWCZY: na zywej bazie, z wlaczonym RLS i rola `authenticated`, te
-- polityki naprawde odcinaja obcy obszar roboczy i obca rozmowe.
--
-- CZYM TA SEKCJA ROZNI SIE OD POZOSTALYCH W TYM PLIKU. Wyzej atrapa odtwarza
-- polityki w stanie SPRZED naprawy, a migracja je podmienia - dzieki temu
-- harness sprawdza takze, ze podmiana zaszla. Tu NIE MA czego podmieniac:
-- polityki czatu nie sa naprawiane, tylko przypinane. Dlatego atrapa daje
-- WYLACZNIE tabele, granty i funkcje pomocnicze, a KAZDA polityke czatu
-- zaklada `run.sh` z tresci prawdziwych migracji (etap 2, patrz
-- `extract_chat_policies.awk`). Gdyby ten plik zakladal tu jakakolwiek
-- polityke, harness testowalby wlasna kopie.
--
-- CZEGO ATRAPA CELOWO NIE INSTALUJE - I DLACZEGO TO JEST DECYZJA:
--
--   1. TRIGGERY STEMPLUJACE (`messages_before_insert`, `message_reactions_
--      before_insert`, `message_stars_before_insert`). W produkcji nadpisuja
--      one `tenant_id`/`conversation_id` wartosciami wziętymi z rozmowy albo
--      z wiadomosci, wiec klient nie umie ich sfalszowac. Gdyby staly w
--      atrapie, KAZDA asercja „zapis z obcym tenant_id jest odrzucany"
--      przechodzilaby dzieki TRIGGEROWI, a polityka - przedmiot dowodu -
--      nie zostalaby wykonana ani razu. To jest druga kladka bezpieczenstwa
--      i mierzymy tu wylacznie te pierwsza.
--   2. FAN-OUT POWIADOMIEN, PURGE TTL, STORAGE ZALACZNIKOW. Stoja na tabelach
--      spoza modulu (`notifications`, `storage.objects`) i nie wchodza do
--      zadnej polityki czatu.
--   3. KANAL REALTIME (`realtime.messages`: pisanie „pisze…", obecnosc).
--      Polityki kanalow wiaza tenanta TEMATEM kanalu, a nie kolumna wiersza,
--      i wymagaja schematu `realtime` z funkcja `realtime.topic()`. Ta atrapa
--      go nie ma i mieć nie bedzie - patrz README.
--
-- Ksztalt tabel jest przepisany z migracji zrodlowych (kolumny istotne dla
-- RLS i dla asercji); komentarz przy kazdej mowi, skad pochodzi.
-- ==========================================================================

-- Koncowa definicja z 20260824074231 (wczesniejsza, z 20260628212746, nie
-- wiazala tenanta). Wchodzi tu, bo bez niej nie da sie zalozyc polityk
-- `expert_inmails: …`, ktore ja wolaja.
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles
     WHERE user_id = _user_id
       AND role = 'super_admin'::public.app_role
       AND tenant_id = public.current_tenant_id()
  )
$$;

-- 20260710092108 (+ 20260712230000: message_ttl_seconds).
-- `tenant_id` BEZ klucza obcego - dokladnie jak w migracji.
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'group')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  message_ttl_seconds integer
);

-- 20260710092108 (+ 20260712230000: pinned_at … last_delivered_at).
CREATE TABLE public.conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  unread_count integer NOT NULL DEFAULT 0,
  last_read_at timestamptz,
  pinned_at timestamptz,
  archived_at timestamptz,
  muted_until timestamptz,
  cleared_before timestamptz,
  last_delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

-- 20260710092108 (+ 20260712230000: expires_at, attachment_duration, kind='audio').
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'file', 'audio')),
  body text,
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint,
  attachment_duration integer,
  reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 20260710092108.
CREATE TABLE public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

-- 20260712230000.
CREATE TABLE public.message_stars (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

-- 20260716090000.
CREATE TABLE public.conversation_nicknames (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 60),
  set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- 20260711190000 / 20260711212733. UWAGA: `tenant_id` jest NOT NULL i NIE MA
-- DEFAULT-u - w calym lancuchu migracji nikt go nie dokłada. To jest powod,
-- dla ktorego rownowaznosc obu form wyznaczania tenanta (podzapytanie do
-- `profiles` w INSERT vs `current_tenant_id()` w SELECT/DELETE) trzeba
-- dowodzic obiegiem zapis-odczyt, a nie wartoscia domyslna kolumny.
CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

-- 20260723090707. NAZWA KONCOWA TO `expert_inmails`, nie `expert_requests`:
-- 20260723180000 przemianowala tabele na `expert_requests`, a 20260806160001
-- i 20260806185055 przemianowaly ja Z POWROTEM (komentarz w tej pierwszej
-- mowi wprost: „na produkcji tabela nazywa sie expert_inmails, rename nigdy
-- nie wjechal"). Polityki podrozuja z tabela, wiec stan koncowy siedzi na tej
-- nazwie. Bramka statyczna kluczuje po nazwie tabeli z tekstu migracji
-- i dlatego widzi jeszcze stara nazwe - to jest zrodlo rozbieznosci opisanej
-- w sekcji `== expert_requests (ZNANY DEFEKT) ==` w runtime_test.sql.
CREATE TABLE public.expert_inmails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  reason text NOT NULL,
  questions text[] NOT NULL DEFAULT ARRAY[]::text[],
  expected_answers text,
  external_links text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined', 'answered', 'cancelled')),
  admin_note text,
  decline_reason text,
  responded_at timestamptz,
  converted_conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id),
  CHECK (char_length(subject) BETWEEN 5 AND 140),
  CHECK (char_length(reason) BETWEEN 20 AND 2000)
);

-- 20260710152630 (+ 20260712190000: read_receipts_enabled, show_online_status).
-- Ta tabela stoi tu WYLACZNIE jako zrodlo dla `chat_read_receipts_enabled()`,
-- ktore wchodzi do polityki `conversation_participants_member_select`.
-- Harness NIC nie twierdzi o jej wlasnych politykach.
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled_message boolean NOT NULL DEFAULT true,
  read_receipts_enabled boolean NOT NULL DEFAULT true,
  show_online_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Funkcje pomocnicze, na ktorych STOJA polityki czatu. Przepisane doslownie
-- z migracji - sygnatury i ciala, nie parafrazy.
-- --------------------------------------------------------------------------

-- 20260710092108 / 20260710092631. Wchodzi do NAJSTARSZYCH polityk czatu
-- (`conv_select_member`, `msg_select_member`, …). One same nie sa juz stanem
-- koncowym, ale `run.sh` odtwarza CALA historie polityk po kolei, wiec musza
-- dac sie zalozyc - inaczej pozniejszy `DROP POLICY IF EXISTS` nie mialby co
-- zdejmowac i harness liczylby inny stan koncowy niz produkcja.
CREATE OR REPLACE FUNCTION public.is_conversation_member(_conv uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = _conv AND user_id = _user
  )
$$;

-- 20260710092631. SECURITY DEFINER przecina rekurencje polityk: gdyby wolal
-- ja wolajacy, RLS na `conversation_participants` musialby najpierw ustalic
-- przynaleznosc, zeby ustalic przynaleznosc.
CREATE OR REPLACE FUNCTION public.member_conversation_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid()
$$;

-- 20260712190000 / 20260712192421. W stanie koncowym uzywana WYLACZNIE przez
-- polityki kanalow realtime, ktorych ta atrapa nie odtwarza; stoi tu, bo
-- zadanie wprost o nia prosi i bo jej cialo jest samodzielnym dowodem, ze
-- czlonkostwo w rozmowie liczy sie TYLKO w obrebie wlasnego tenanta.
CREATE OR REPLACE FUNCTION public.is_tenant_conversation_member(_conv uuid, _user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    JOIN public.conversations c ON c.id = cp.conversation_id
    WHERE cp.conversation_id = _conv
      AND cp.user_id = _user
      AND c.tenant_id = public.current_tenant_id()
  );
$$;

-- 20260712190000 / 20260712192421. Brak wiersza preferencji = potwierdzenia
-- WLACZONE (COALESCE … true) - to jest domyslka produktu, nie przypadek.
CREATE OR REPLACE FUNCTION public.chat_read_receipts_enabled(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT np.read_receipts_enabled FROM public.notification_preferences np WHERE np.user_id = _user),
    true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.member_conversation_ids() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_conversation_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chat_read_receipts_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_conversation_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_tenant_conversation_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_read_receipts_enabled(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- GRANTY W STANIE KONCOWYM. To NIE jest kosmetyka: brak grantu jest w tym
-- module PIERWSZYM zamkiem, a brak polityki DRUGIM. Asercje rozdzielaja oba,
-- wiec granty musza byc dokladnie takie jak na produkcji.
--   conversations, conversation_participants, conversation_nicknames,
--   expert_inmails  -> tylko SELECT (zapis idzie WYLACZNIE przez RPC)
--   messages        -> SELECT, INSERT, UPDATE tylko na kolumnach tresci
--   message_reactions -> SELECT, INSERT, UPDATE, DELETE (20260724190506)
--   message_stars, user_blocks -> SELECT, INSERT, DELETE
-- --------------------------------------------------------------------------
GRANT SELECT ON public.conversations, public.conversation_participants TO authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT UPDATE (body, edited_at, deleted_at, attachment_path, attachment_name,
              attachment_mime, attachment_size, attachment_duration)
  ON public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.message_stars TO authenticated;
GRANT SELECT ON public.conversation_nicknames TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT SELECT ON public.expert_inmails TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.conversations, public.conversation_participants, public.messages,
  public.message_reactions, public.message_stars, public.conversation_nicknames,
  public.user_blocks, public.expert_inmails, public.notification_preferences TO service_role;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_nicknames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expert_inmails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
