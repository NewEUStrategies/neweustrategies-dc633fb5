-- ============================================================================
-- PO CO TEN PLIK ISTNIEJE
-- Modul Wydarzen (dziesiec migracji 20260823120000..20260823190000) odwoluje
-- sie do powierzchni platformy, ktorej sam NIE TWORZY: tenantow, profili,
-- rol, tabeli `events` i jej rodzenstwa, funkcji uprawnien i szyny zdarzen.
-- Ten plik stawia te powierzchnie jako ATRAPY, zeby replay migracji na czystej
-- bazie mial na czym stanac.
--
-- FILOZOFIA ATRAPY (przejeta z scripts/pg-harness/harness.sql i obowiazujaca)
-- Z atrapy wchodzi TYLKO to, czego potrzebuje replay - i ani kolumny wiecej.
-- Kazda nadmiarowa kolumna w atrapie to nieprawda, ktora kiedys przejdzie za
-- prawde: migracja odwolujaca sie do kolumny, ktorej na produkcji nie ma,
-- przeszlaby tu na zielono. Ksztalty (nazwy kolumn, typy, sygnatury) sa
-- PRZEPISANE Z ORYGINALOW wskazanych w komentarzu przy kazdej atrapie.
--
-- CZEGO TEN PLIK NIE UDAJE
--   * nie jest replika bazy produkcyjnej - to powierzchnia styku, nic wiecej;
--   * atrapy NIE odtwarzaja logiki modulow, z ktorych pochodza. Warstwy
--     czlonkostwa, reklamy, strony i kluby maja tu ksztalt, nie zachowanie;
--   * polityki RLS atrap sa nieobecne albo trywialne - RLS-em w tym harnessie
--     sa polityki, ktore zakladaja MIGRACJE WYDARZEN, i tylko one sa testowane.
--
-- PRZESTAWIANIE AKTORA (czytaj README, sekcja "Kim jestem w tescie")
-- Funkcje-atrapy uprawnien czytaja parametry sesji (GUC), zeby jeden test
-- runtime mogl udawac po kolei administratora, redaktora, uczestnika i anonima
-- bez stawiania bazy od nowa:
--   request.jwt.claim.sub  -> auth.uid()          (kim jestem; puste = anonim)
--   nes.tenant             -> _caller_tenant()    (z jakiego hosta wchodze)
--   nes.public_tenant      -> public_tenant_id()  (najemca domyslny)
--   nes.tier_rank          -> has_tier_rank()     (ranga warstwy czlonkostwa)
--   nes.tier_features      -> has_tier_feature()  (lista cech, po przecinku)
-- Role (`admin`, `editor`, `super_admin`) NIE sa GUC-iem: siedza w prawdziwej
-- tabeli `user_roles`, bo tak dziala produkcja i bo dzieki temu `has_role`
-- moze byc atrapa o zerowej logice wlasnej.
-- ============================================================================

-- Atrapy sa zakladane defensywnie (`IF NOT EXISTS`, `DROP ... IF EXISTS`), wiec
-- na czystej bazie sypia NOTICE-ami o obiektach, ktorych nie ma. To szum, ktory
-- zasypuje realne ostrzezenia z REPLAYU migracji - a te chcemy widziec.
SET client_min_messages = warning;

-- ----------------------------------------------------------------------------
-- Rozszerzenia i schematy
--
-- btree_gist: wymagane przez 12 ograniczen EXCLUDE modulu (kolizje sesji na
--   sali, nakladanie sie spotkan) - mieszaja uuid/int z zakresem tstzrange,
--   czego czysty GiST nie obsluguje.
-- pgcrypto: `gen_random_uuid()` w DEFAULT-ach wszystkich tabel modulu.
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto  WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent  WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm   WITH SCHEMA public;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

-- Na Supabase pgcrypto siedzi w schemacie `extensions` i modul wola stamtad
-- `gen_random_bytes` (sekrety kodow odprawy) oraz `digest`/`hmac` (trwale
-- aliasy). Harness trzyma pgcrypto w `public`, wiec zamiast drugiej kopii
-- rozszerzenia stawiamy cienkie przekierowniki pod produkcyjnymi nazwami.
CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea
LANGUAGE sql VOLATILE AS $$ SELECT public.gen_random_bytes($1) $$;
CREATE OR REPLACE FUNCTION extensions.digest(text, text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT public.digest($1, $2) $$;
CREATE OR REPLACE FUNCTION extensions.hmac(text, text, text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT public.hmac($1, $2, $3) $$;

-- ----------------------------------------------------------------------------
-- auth (ksztalt z platformy Supabase; z auth.users modul czyta wylacznie `id`)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

-- Aktor sesji. Puste = anonim (`auth.uid()` zwraca NULL), dokladnie jak
-- w Supabase przy zapytaniu bez tokenu.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ----------------------------------------------------------------------------
-- Role platformy (ksztalt z 20260713093000 i pozniejszych; enum ma dokladnie
-- te warianty, ktorych modul uzywa w literalach `::app_role`)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','editor','author','user','super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Najemca publiczny MUSI istniec PRZED migracjami, nie tylko przed testami:
-- 20260823120000 seeduje katalog rodzajow wydarzen wzgledem
-- `public_tenant_id()`, wiec na pustej tabeli tenantow przewraca sie na NOT
-- NULL. Na produkcji ten wiersz istnieje od pierwszej migracji platformy.
INSERT INTO public.tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'ta')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role    public.app_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')
      OR public.has_role(auth.uid(),'author')
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND role = 'super_admin'::public.app_role)
$$;

-- ----------------------------------------------------------------------------
-- Tozsamosc najemcy
--
-- Na produkcji `_caller_tenant()` czyta naglowek hosta z JWT/GUC-a zapytania.
-- Tutaj czyta `nes.tenant` wprost - to CALA roznica, ksztalt zwracanej
-- wartosci jest ten sam (uuid albo NULL).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('nes.public_tenant', true), '')::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid)
$$;

CREATE OR REPLACE FUNCTION public._caller_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('nes.tenant', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(public._caller_tenant(), public.public_tenant_id())
$$;

-- Bramka zapisu panelu. Ksztalt (brak parametrow, RETURNS uuid najemcy,
-- RAISE przy braku uprawnien) przepisany z wywolan w migracjach modulu:
-- `v_tenant := public.assert_admin_tenant();`.
--
-- ODMOWA JEST TU ISTOTNA, nie dekoracyjna: asercje runtime sprawdzaja, ze
-- redaktor i anonim NIE przechodza przez ta bramke, wiec atrapa musi
-- rzeczywiscie rzucac, a nie tylko zwracac NULL.
CREATE OR REPLACE FUNCTION public.assert_admin_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: brak sesji';
  END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN: wymagana rola admin';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: brak profilu najemcy';
  END IF;
  -- Najemca DOMOWY, nie najemca z naglowka hosta. Na produkcji ta roznica
  -- jest cala trescia bramki: admin najemcy A nie moze pisac do najemcy B
  -- przez samo wejscie na jego domene.
  IF public._caller_tenant() IS NOT NULL AND public._caller_tenant() <> v_tenant
     AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: obcy najemca';
  END IF;
  RETURN v_tenant;
END $$;

-- ----------------------------------------------------------------------------
-- Profile (ksztalt z 20260713093000 + kolumny czytane przez modul Wydarzen:
-- display_name/first_name/last_name/slug/avatar_url/job_title/current_company)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name    text,
  first_name      text,
  last_name       text,
  slug            text,
  avatar_url      text,
  job_title       text,
  current_company text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Warstwy czlonkostwa
--
-- Modul czyta z nich TRZY rzeczy: range (`has_tier_rank`), ceche
-- (`has_tier_feature`) i ranga biezaca (`current_tier_rank`). Sama tabela
-- `membership_tiers` jest celem kluczy obcych bramek warstwowych.
-- Ranga i cechy sa GUC-iem, zeby test mogl przestawic uczestnika miedzy
-- warstwami bez odtwarzania calego billingu.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_tiers (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug      text NOT NULL,
  rank      integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, slug)
);

CREATE OR REPLACE FUNCTION public.current_tier_rank() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('nes.tier_rank', true), '')::integer, 0)
$$;

CREATE OR REPLACE FUNCTION public.has_tier_rank(_min integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT public.current_tier_rank() >= COALESCE(_min, 0)
$$;

CREATE OR REPLACE FUNCTION public.has_tier_feature(_feature text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT _feature = ANY (
    string_to_array(COALESCE(current_setting('nes.tier_features', true), ''), ','))
$$;

-- ----------------------------------------------------------------------------
-- Szyna zdarzen domenowych
--
-- Sygnatura jest przepisana z 20260808190000 CO DO KOLEJNOSCI PARAMETROW:
-- szosta pozycja nalezy do aktora. Migracje modulu wolaja te funkcje
-- pozycyjnie, wiec przestawienie parametru w atrapie ukrylo by dokladnie ten
-- blad, ktorego szukamy (patrz historia A12/A16/A17 w module klubow).
-- Wiersze zostaja w tabeli, zeby asercje mogly sprawdzic, CO modul wyemitowal.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.domain_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid,
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  event_type     text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id       uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid,
  p_aggregate_type text,
  p_aggregate_id text,
  p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_actor_id uuid DEFAULT NULL,
  p_suppress_actor boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.domain_events
    (tenant_id, aggregate_type, aggregate_id, event_type, payload, actor_id)
  VALUES (p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type,
          COALESCE(p_payload,'{}'::jsonb),
          CASE WHEN p_suppress_actor THEN NULL ELSE COALESCE(p_actor_id, auth.uid()) END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ----------------------------------------------------------------------------
-- Wspolny trigger stempla `updated_at` (ksztalt z platformy; modul wiesza go
-- na kazdej swojej tabeli)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tg_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ----------------------------------------------------------------------------
-- Strony (front wydarzenia jest poddrzewem `pages`)
--
-- DO 20260826120000 modul dotykal tylko `id` - przez
-- `events.root_page_id REFERENCES pages(id)` oraz `event_page_sections` - i tyle
-- mial ten stub. `event_pages` to zmienilo: mapowanie strona -> menu wydarzenia
-- czyta lancuch rodzicow (`parent_id`), status publikacji kazdego przodka
-- (`status`, `deleted_at`), tytuly na etykiety zastepcze (`title_pl`,
-- `title_en`), a `admin_event_page_create` ZAKLADA strony, wiec pisze takze
-- `editor`, `template_type` i `menu_order`. Bez tych kolumn replay modulu padal
-- na `column p.parent_id does not exist` - czyli na wlasnym niedomiarze atrapy,
-- a nie na bledzie w migracji.
--
-- Typy sa z ORYGINALOW, nie uproszczone do `text`: `status` to `post_status`
-- (20260531180217), `editor` to `editor_type` z dolozonym wariantem `builder`
-- (20260531182614) - `admin_event_page_create` wstawia dokladnie ten wariant,
-- wiec atrapa na `text` przepuscilaby literowke, ktorej baza nie przepusci.
-- Ksztalt kolumn: 20260531182153 (tabela), 20260531223436 (`parent_id`,
-- `menu_order`), 20260531183823 (`deleted_at`), 20260624182857
-- (`template_type` + jego CHECK).
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.post_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.editor_type AS ENUM ('richtext', 'markdown', 'builder', 'blocks');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  parent_id     uuid REFERENCES public.pages(id) ON DELETE RESTRICT,
  title_pl      text NOT NULL DEFAULT '',
  title_en      text NOT NULL DEFAULT '',
  status        public.post_status NOT NULL DEFAULT 'draft',
  editor        public.editor_type NOT NULL DEFAULT 'richtext',
  template_type text NOT NULL DEFAULT 'default',
  menu_order    int NOT NULL DEFAULT 0,
  -- `builder_data` z 20260531182614. WCHODZI, bo dwie funkcje modulu PISZA do
  -- tej kolumny: `admin_event_page_create` (20260826162459:87) wstawia dokument
  -- z szablonu, a `_event_seed_default_pages` (20260826181500) dokument strony
  -- modulowej. Bez niej replay przechodzi (cialo plpgsql nie jest sprawdzane
  -- przy CREATE FUNCTION), a KAZDE wywolanie tych dwoch pada na 42703 - czyli
  -- dokladnie ta klasa bledu, po ktora ten harness istnieje.
  builder_data  jsonb,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pages_template_type_check
    CHECK (template_type IN ('default','full_width','landing','archive_listing','contact')),
  UNIQUE (tenant_id, slug)
);

-- ----------------------------------------------------------------------------
-- Reklamy (ksztalt z 20260624165807)
--
-- 20260823170000 wystawia `event_ad_placements()`, ktora czyta OBIE tabele
-- reklamowe i rzutuje trzy enumy na tekst, wiec atrapa musi byc ENUMEM,
-- a nie tekstem - inaczej rzutowanie `p.position::text` przeszlo by na fikcji,
-- a blad w nazwie wariantu nie wyszedlby nigdy.
--
-- ISTOTNE: `ad_page_type` NIE MA tutaj wariantu `'event'`. Dodaje go dopiero
-- migracja 20260823170000 (`ALTER TYPE ... ADD VALUE IF NOT EXISTS 'event'`,
-- zadanie EB-937). Gdyby atrapa go zawierala, replay tamtej linijki nie
-- sprawdzalby niczego - a to jest wlasnie ta klasa zmiany, ktorej `ADD VALUE`
-- w transakcji nie wybacza.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.ad_slot_kind AS ENUM ('html', 'script', 'image');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ad_slot_status AS ENUM ('active', 'paused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ad_position AS ENUM
    ('header_banner','top_of_post','mid_post','bottom_of_post',
     'sidebar','in_feed','footer_slideup');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ad_page_type AS ENUM
    ('all','home','post','page','category','tag','archive','search');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Z `ad_slots` funkcja czyta name/kind/status/html/script/image_*/width/height/
-- requires_consent/targeting. `notes` celowo NIE MA: komentarz migracji mowi
-- wprost, ze funkcja jej nie oddaje, wiec kolumna w atrapie byla by zaproszeniem
-- do przypadkowego `SELECT *`.
CREATE TABLE IF NOT EXISTS public.ad_slots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name             text NOT NULL,
  kind             public.ad_slot_kind NOT NULL DEFAULT 'html',
  status           public.ad_slot_status NOT NULL DEFAULT 'active',
  html             text,
  script           text,
  image_url        text,
  image_link       text,
  image_alt        text,
  width            int,
  height           int,
  requires_consent boolean NOT NULL DEFAULT true,
  targeting        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_placements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slot_id    uuid NOT NULL REFERENCES public.ad_slots(id) ON DELETE CASCADE,
  position   public.ad_position NOT NULL,
  page_type  public.ad_page_type NOT NULL DEFAULT 'all',
  page_id    uuid,
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  starts_at  timestamptz,
  ends_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- CRM: firmy i leady (ksztalt z 20260706201356)
--
-- 20260823150000 i 20260823160000 wiaza uczestnikow i sponsorow z firmami
-- kluczem obcym ZLOZONYM `(tenant_id, company_id)`, wiec obie migracje same
-- zakladaja na `crm_companies` ograniczenie `UNIQUE (tenant_id, id)` - i robia
-- to przez `conrelid = 'public.crm_companies'::regclass`, czyli PADAJA, jesli
-- tabeli nie ma. Atrapa jest tu warunkiem samego replayu, nie ozdoba.
--
-- `name_norm` jest kolumna GENEROWANA i modul po niej dopasowuje firmy przy
-- scalaniu duplikatow, wiec musi byc generowana rowniez tutaj - zwykla kolumna
-- tekstowa dawalaby NULL i dopasowanie nigdy by nie trafilo.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       text NOT NULL,
  name_norm  text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  domain     text,
  aliases    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_leads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- `events` - ATRAPA TABELY BAZOWEJ
--
-- Tabela istnieje na produkcji od 20260713093000. Harness NIE wykonuje tamtej
-- migracji (jej selektor by ja wciagnal razem z calym modulem spolecznosci,
-- warstwami i szyna powiadomien), wiec stawia atrape o dokladnie tym ksztalcie,
-- ktory modul Wydarzen czyta i rozszerza:
--   * kolumny tozsamosci i harmonogramu (`slug`, `title_*`, `starts_at`, ...);
--   * `kind` z CHECK-iem szesciu wartosci - 20260823120000 celowo zostawia go
--     jako kolumne zgodnosci i backfilluje z niego katalog `event_types`;
--   * `visibility`, `min_tier_rank`, `capacity`, `status`, `chatham_house` -
--     czytaja je bramki warstwowe i widoki publiczne modulu.
-- Kolumny cyklu zycia i przeplywu (`published_at`, `format`, `guest_mode`, ...)
-- oraz `root_page_id`/`branding` doklada 20260823120000 - i DLATEGO nie ma ich
-- tutaj. Gdyby byly, replay tamtej migracji nie sprawdzalby niczego.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  description_pl text,
  description_en text,
  kind text NOT NULL DEFAULT 'webinar'
    CHECK (kind IN ('webinar', 'briefing', 'roundtable', 'ama', 'in_person', 'hybrid')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'Europe/Warsaw',
  location text,
  join_url text,
  recording_url text,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members')),
  min_tier_rank integer NOT NULL DEFAULT 0 CHECK (min_tier_rank >= 0),
  -- Okno zapisow i wczesny dostep. Nie sa ozdoba: `rsvp_event` z migracji
  -- 20260823136000, ktora ten harness REPLAYUJE, czyta oba pola przy kazdym
  -- zapisie (odmowa `events: rsvp not open` plus wyjatek dla rangi
  -- z pierwszenstwem). Bez nich replay przechodzi, ale kazda asercja o oknie
  -- zapisow musialaby dolozyc te kolumny u siebie - i jeden plik asercji
  -- naprawde to robil, mutujac WSPOLNY schemat poza transakcja, czyli takze
  -- dla plikow, ktore biegna po nim. Atrapa deklaruje to, czego modul wymaga.
  rsvp_opens_at timestamptz,
  early_rsvp_rank integer CHECK (early_rsvp_rank IS NULL OR early_rsvp_rank >= 0),
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  host_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  chatham_house boolean NOT NULL DEFAULT false,
  cover_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{3,120}$'),
  CHECK (btrim(title_pl) <> '' AND btrim(title_en) <> ''),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO service_role;

-- ---------------------------------------------------------------------------
-- KASA I SILNIK KUPONOW - atrapy pod migracje 20260824080000 (wejsciowki,
-- pakiety, kupony). Modul Wydarzen zaczal od niej zalezec od trzech rzeczy
-- spoza swojego zakresu, a harness wylapal to REPLAYEM, nie lektura:
-- "relation public.payment_orders does not exist".
--
-- Ksztalt z oryginalow: payment_orders, b2b_coupons i b2b_coupon_redemptions
-- (20260721070203), b2b_coupon_campaigns (20260721082414), verification_domains
-- plus kolumna `academic` (20260822171037). Wchodzi WYLACZNIE to, czego dotyka
-- modul - kolumny rozliczeniowe, ktorych zaden RPC wydarzen nie czyta, sa poza
-- atrapa, zgodnie z zasada calego tego pliku.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.b2b_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text,
  description text,
  discount_kind text NOT NULL CHECK (discount_kind IN ('percent', 'fixed')),
  discount_percent integer CHECK (discount_percent IS NULL OR discount_percent BETWEEN 1 AND 100),
  discount_cents integer CHECK (discount_cents IS NULL OR discount_cents > 0),
  currency text,
  active boolean NOT NULL DEFAULT true,
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemptions_count integer NOT NULL DEFAULT 0,
  valid_from timestamptz,
  valid_until timestamptz,
  plan_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  campaign_id uuid,
  grants_tier_key text,
  grants_duration_days integer,
  newsletter_segment text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT b2b_coupons_code_unique UNIQUE (tenant_id, code),
  CONSTRAINT b2b_coupons_discount_shape CHECK (
    (discount_kind = 'percent' AND discount_percent IS NOT NULL AND discount_cents IS NULL)
    OR (discount_kind = 'fixed' AND discount_cents IS NOT NULL AND discount_percent IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.b2b_coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  coupon_id uuid NOT NULL REFERENCES public.b2b_coupons(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_cents integer NOT NULL DEFAULT 0,
  original_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.b2b_coupon_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  prefix text NOT NULL DEFAULT '',
  code_length integer NOT NULL DEFAULT 8 CHECK (code_length BETWEEN 4 AND 24),
  code_count integer NOT NULL CHECK (code_count > 0 AND code_count <= 10000),
  generated_count integer NOT NULL DEFAULT 0,
  discount_kind text NOT NULL CHECK (discount_kind IN ('percent', 'fixed')),
  discount_percent integer CHECK (discount_percent IS NULL OR discount_percent BETWEEN 1 AND 100),
  discount_cents integer CHECK (discount_cents IS NULL OR discount_cents > 0),
  currency text,
  max_redemptions_per_code integer DEFAULT 1,
  valid_from timestamptz,
  valid_until timestamptz,
  plan_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  grants_tier_key text,
  grants_duration_days integer,
  newsletter_segment text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'sent', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.verification_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  badge text NOT NULL DEFAULT 'verified',
  active boolean NOT NULL DEFAULT true,
  require_email_confirmed boolean NOT NULL DEFAULT true,
  academic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Weryfikacja akademicka jako ATRAPA O ZEROWEJ LOGICE WLASNEJ: czyta prawdziwa
-- tabele domen i prawdziwy adres wolajacego. Gdyby zwracala stala, kazda asercja
-- o stawce akademickiej przechodzilaby zawsze i nie mierzylaby niczego.
CREATE OR REPLACE FUNCTION public.my_academic_domain_verification()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.verification_domains d
      ON d.domain = split_part(lower(btrim(u.email)), '@', 2)
    WHERE u.id = auth.uid()
      AND d.active
      AND d.academic
      AND d.tenant_id = public._caller_tenant()
  );
$fn$;

-- POLITYKI `events` - ATRAPA, ale ATRAPA OBOWIAZKOWA (z 20260713093000).
--
-- Zadna z dziesieciu migracji modulu nie tworzy polityki na `events`; siedza
-- one w 20260713093000, ktorej harness nie wykonuje. Kusi wiec zostawic tabele
-- z wlaczonym RLS i bez polityk - i to jest PULAPKA, ktora ten harness raz
-- juz w siebie wpadl. RLS bez polityki znaczy ODMOWA WSZYSTKIEGO, a polityki
-- tabel POTOMNYCH modulu sprawdzaja wydarzenie podzapytaniem
-- `EXISTS (SELECT 1 FROM public.events e WHERE e.id = ...)`, ktore biegnie
-- z uprawnieniami WOLAJACEGO. Deny-all na `events` uniewaznia wiec KAZDA
-- polityke modulu: wszystkie asercje o izolacji przechodzilyby na pustym
-- wyniku, nie odrozniajac izolacji od blokady.
--
-- Ksztalt jest przepisany co do znaku, wraz z roznica, ktora ma znaczenie dla
-- testow: odczyt publiczny wiaze wiersz z `public_tenant_id()`, a odczyt
-- redakcyjny z `current_tenant_id()` (czyli z naglowkiem hosta).
DROP POLICY IF EXISTS "events public read" ON public.events;
CREATE POLICY "events public read" ON public.events
  FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND tenant_id = (SELECT public.public_tenant_id())
  );

DROP POLICY IF EXISTS "events staff read" ON public.events;
CREATE POLICY "events staff read" ON public.events
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "events staff write" ON public.events;
CREATE POLICY "events staff write" ON public.events
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

-- ----------------------------------------------------------------------------
-- `event_rsvps` - ATRAPA (ksztalt z 20260713093000)
-- Modul Wydarzen migruje z niej dane do `event_registrations` i utrzymuje
-- zgodnosc wsteczna, wiec potrzebuje jej dokladnego ksztaltu.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'interested', 'cancelled')),
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;
-- Na produkcji `anon` NIE MA grantu na `event_rsvps` (20260713093000 daje go
-- tylko `authenticated`). Nadanie go tutaj byloby atrapa szersza od prawdy.
GRANT SELECT ON public.event_rsvps TO authenticated;
GRANT ALL ON public.event_rsvps TO service_role;

-- Polityki z 20260713093000. Ten sam powod, co przy `events`: modul czyta
-- `event_rsvps` z widokow frontu (zgodnosc wsteczna zapisow), wiec deny-all
-- na tej tabeli zamienialby asercje o zapisach w asercje o niczym.
DROP POLICY IF EXISTS "rsvps owner read" ON public.event_rsvps;
CREATE POLICY "rsvps owner read" ON public.event_rsvps
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "rsvps staff read" ON public.event_rsvps;
CREATE POLICY "rsvps staff read" ON public.event_rsvps
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::public.app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- `speaker_profiles` - ATRAPA (ksztalt z 20260727200000)
-- 20260823150000 wiaze osoby wydarzenia z profilami scenicznymi; z atrapy
-- wchodzi tylko to, co czyta modul (tozsamosc, naglowek, widocznosc).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.speaker_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  headline_pl text,
  headline_en text,
  bio_pl text,
  bio_en text,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
ALTER TABLE public.speaker_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.speaker_profiles TO anon, authenticated;
GRANT ALL ON public.speaker_profiles TO service_role;
