-- Harness: minimalny szkielet platformy NES potrzebny do wykonania migracji
-- modulu Discussion Club. Odtwarza WYLACZNIE te obiekty, ktorych modul dotyka -
-- to nie jest replika bazy produkcyjnej, tylko powierzchnia styku.
--
-- Kazdy obiekt tutaj ma odpowiednik w supabase/migrations; ksztalty (nazwy
-- kolumn, sygnatury, typy) sa przepisane z ORYGINALOW, bo inaczej test
-- przechodzilby na fikcji.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA public;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

-- Na Supabase pgcrypto siedzi w schemacie `extensions`, a modul wola stamtad
-- dwie funkcje: `gen_random_bytes` (sekret zaproszenia) i `hmac` (trwaly alias
-- autora w trybie Chatham House). Harness trzyma pgcrypto w `public` - tak wola
-- go reszta platformy - wiec zamiast drugiej kopii rozszerzenia stawiamy cienkie
-- przekierowniki pod produkcyjnymi nazwami. Bez nich migracja i asercja
-- przewracaly sie na braku funkcji, a nie na wlasnym bledzie.
CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea
LANGUAGE sql VOLATILE AS $$ SELECT public.gen_random_bytes($1) $$;

CREATE OR REPLACE FUNCTION extensions.hmac(text, text, text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT public.hmac($1, $2, $3) $$;

-- pgvector NIE jest dostepny w tym obrazie. Podstawiamy domene nad tablica
-- liczb: wystarczy, by sprawdzic skladnie i typy funkcji A6. Indeks HNSW
-- i operator <=> nie zadzialaja, wiec A6 uruchamiamy z podmieniona sciezka.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    CREATE DOMAIN extensions.vector AS double precision[];
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- role platformy
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','editor','author','user','super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tenant publiczny MUSI istnowac PRZED migracjami, nie tylko przed testami.
-- Migracje modulu seeduja dane wzgledem `public_tenant_id()`
-- (20260811110015: osiem specjalizacji, A24: wpis `community_modules`), wiec na
-- pustej tabeli tenantow przewracaja sie na NOT NULL - a na produkcji tenant
-- istnieje od pierwszej migracji platformy.
--
-- Identyfikator jest ten sam, co "Tenant A" w runtime_test.sql. Wczesniej
-- `public_tenant_id()` wskazywala na niego przez PRZYPADEK: oba tenanty testowe
-- wchodzily jednym INSERT-em, wiec `ORDER BY created_at ASC` rozstrzygalo remis
-- kolejnoscia fizyczna. Teraz wskazuje na niego z zalozenia.
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

-- ---------------------------------------------------------------------------
-- profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name    text,
  first_name      text,
  last_name       text,
  slug            text,
  avatar_url      text,
  hide_avatar     boolean NOT NULL DEFAULT false,
  discoverable    boolean NOT NULL DEFAULT false,
  job_title       text,
  current_company text,
  specialization  text,
  location        text,
  -- Blok kontaktowy dolozony przy A35. `admin_club_application_set_status`
  -- back-fillu je pisze (`phone`, `linkedin_url`), a prefill formularza je
  -- czyta - wiec atrapa bez nich przepuszczala funkcje plpgsql i wywracala sie
  -- dopiero na wywolaniu. `profiles_phone_chk` jest przepisany z ORYGINALU
  -- (20260628222524): bez niego harness przyjalby numer, ktory produkcja
  -- odrzuca, a numer wchodzi tu z FORMULARZA zgloszenia.
  email           text,
  contact_email   text,
  phone           text,
  linkedin_url    text,
  twitter_url     text,
  website_url     text,
  CONSTRAINT profiles_phone_chk
    CHECK (phone IS NULL OR phone ~ '^[+0-9 ()\-]{6,32}$'),
  -- Trzy opisy, nie jeden: `bio` jest kolumna zalozycielska (20260601055702),
  -- `bio_pl`/`bio_en` dolozyla 20260624192716 i to ONE sa zrodlem dla
  -- powierzchni dwujezycznych. Modul czyta wszystkie trzy z fallbackiem, wiec
  -- atrapa bez nich przepuszczalaby funkcje, ktora na produkcji nie istnieje.
  bio             text,
  bio_pl          text,
  bio_en          text,
  verified_at     timestamptz,
  open_to         text[] NOT NULL DEFAULT '{}'::text[],
  completeness_score smallint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.public_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.tenants ORDER BY created_at ASC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Drugi helper `updated_at` w platformie, 1:1 z 20260718215718. Modul nie
-- wybiera miedzy nimi dowolnie: `club_applications` i tabele z 20260808100202
-- podpinaja WLASNIE ten, wiec atrapa tylko `set_updated_at()` przewracala oba
-- pliki na CREATE TRIGGER.
CREATE OR REPLACE FUNCTION public._tg_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- 1:1 z 20260718215718. Dwie migracje klubowe (20260808100202, 20260811110015)
-- wolaja ja w politykach RLS - a polityka jest sprawdzana przy CREATE POLICY,
-- wiec brak funkcji przewracal CALA migracje, nie tylko jej uzycie.
CREATE OR REPLACE FUNCTION public._caller_tenant() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$;

-- 1:1 z 20260713070846. Skrzynka zgloszen (`admin_club_applications_list`,
-- `admin_club_application_set_status`) bierze z niej tenanta admina - i robi to
-- w funkcji LANGUAGE sql, ktorej cialo Postgres waliduje przy tworzeniu.
CREATE OR REPLACE FUNCTION public.assert_admin_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: caller has no tenant';
  END IF;
  RETURN v_tenant;
END $$;

-- ---------------------------------------------------------------------------
-- plany czlonkowskie
-- ---------------------------------------------------------------------------
-- `features` i `is_default` dolozone przy A35: `current_membership_tier()` je
-- zwraca i wybiera po nich plan domyslny, wiec atrapa bez nich nie pozwalalaby
-- odtworzyc funkcji w produkcyjnym KSZTALCIE ZWROTU. UNIQUE (tenant_id, key)
-- jest celem klucza obcego z `membership_grants` - tez z oryginalu.
CREATE TABLE IF NOT EXISTS public.membership_tiers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key        text NOT NULL,
  rank       integer NOT NULL DEFAULT 0,
  name_pl    text NOT NULL,
  name_en    text NOT NULL,
  features   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, key)
);

-- Granty reczne planu. Z trzech zrodel rangi, ktore produkcyjna
-- `current_membership_tier()` sumuje (subskrypcje, granty, seaty organizacji),
-- harness odtwarza WYLACZNIE granty: to najkrotsza droga do rangi >= 20, ktorej
-- wymaga `club_apply_submit`, a modul klubow nie odwoluje sie do zadnej z tych
-- tabel bezposrednio - czyta tylko rangę. `source_donation_id` pominiete,
-- bo `donations` juz nie nalezy do powierzchni styku.
CREATE TABLE IF NOT EXISTS public.membership_grants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_key   text NOT NULL,
  starts_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, tier_key)
    REFERENCES public.membership_tiers (tenant_id, key) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Ksztalt zwrotu przepisany z ORYGINALU (20260729210625), bo `club_apply_submit`
-- robi `SELECT rank, key INTO ...` - atrapa zwracajaca sam integer przepuscilaby
-- funkcje, ktora na produkcji nie ma z czego czytac `key`.
--
-- Cialo jest SKROCONE swiadomie: gala z subskrypcjami i seatami organizacji
-- wymagalaby szesciu kolejnych tabel platnosciowych, a modul klubow nie zaglada
-- do zadnej z nich. Ogon (`def` -> plan domyslny, potem 'reader' rank 0) jest
-- przepisany 1:1, bo TO on decyduje o rangê osoby bez zadnego grantu - czyli
-- o wyniku wiekszosci asercji w runtime_test.
CREATE OR REPLACE FUNCTION public.current_membership_tier()
RETURNS TABLE(key text, rank integer, name_pl text, name_en text, features jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (SELECT COALESCE(public.public_tenant_id(), public.current_tenant_id()) AS tid),
  entitled AS (
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.membership_grants mg JOIN t ON mg.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mg.tenant_id AND mt.key = mg.tier_key AND mt.active
     WHERE mg.user_id = auth.uid() AND mg.revoked_at IS NULL AND mg.starts_at <= now()
       AND (mg.expires_at IS NULL OR mg.expires_at > now())
  ),
  best AS (SELECT * FROM entitled ORDER BY rank DESC LIMIT 1),
  def AS (SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
            FROM public.membership_tiers mt JOIN t ON mt.tenant_id = t.tid
           WHERE mt.is_default AND mt.active LIMIT 1)
  SELECT * FROM best
  UNION ALL SELECT * FROM def WHERE NOT EXISTS (SELECT 1 FROM best)
  UNION ALL SELECT 'reader',0,'Konto bezpłatne','Free account','{}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM best) AND NOT EXISTS (SELECT 1 FROM def);
$$;

-- Oba helpery 1:1 z 20260713090000. Wczesniej `current_tier_rank()` byla twardym
-- `SELECT 0`, wiec proba planu nie dala sie w harnessie w ogole USTAWIC - a to
-- pierwsza bramka `club_apply_submit` (`pro_required`).
CREATE OR REPLACE FUNCTION public.current_tier_rank() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT rank FROM public.current_membership_tier() LIMIT 1), 0);
$$;

CREATE OR REPLACE FUNCTION public.has_tier_rank(_min integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_tier_rank() >= COALESCE(_min, 0)
$$;

-- ---------------------------------------------------------------------------
-- blokady miedzy uzytkownikami
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE OR REPLACE FUNCTION public.is_blocked_pair(_a uuid, _b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_blocks
                  WHERE (blocker_id = _a AND blocked_id = _b)
                     OR (blocker_id = _b AND blocked_id = _a))
$$;

-- ---------------------------------------------------------------------------
-- zaproszenia platformowe
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.invitation_mode AS ENUM ('magic_link','temp_password');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.invitation_status AS ENUM ('pending','sent','accepted','revoked','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email        text NOT NULL,
  display_name text,
  role         public.app_role NOT NULL DEFAULT 'author',
  mode         public.invitation_mode NOT NULL DEFAULT 'magic_link',
  status       public.invitation_status NOT NULL DEFAULT 'pending',
  source       text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  auth_user_id uuid,
  invited_by   uuid,
  sent_at      timestamptz,
  accepted_at  timestamptz,
  expires_at   timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- powiadomienia
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  tenant_id  uuid NOT NULL,
  kind       text NOT NULL,
  title_pl   text,
  title_en   text,
  body_pl    text,
  body_en    text,
  href       text,
  icon       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search',
                  'crm_task','expert_request','introduction','recommendation',
                  'endorsement','profile_view','meeting'))
  NOT VALID;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id                uuid PRIMARY KEY,
  enabled_message        boolean NOT NULL DEFAULT true,
  enabled_comment        boolean NOT NULL DEFAULT true,
  enabled_follow         boolean NOT NULL DEFAULT true,
  enabled_subscription   boolean NOT NULL DEFAULT true,
  enabled_content        boolean NOT NULL DEFAULT true,
  enabled_system         boolean NOT NULL DEFAULT true,
  enabled_tracker        boolean NOT NULL DEFAULT true,
  enabled_connection     boolean NOT NULL DEFAULT true,
  enabled_saved_search   boolean NOT NULL DEFAULT true,
  enabled_crm_task       boolean NOT NULL DEFAULT true,
  enabled_expert_request boolean NOT NULL DEFAULT true,
  enabled_introduction   boolean NOT NULL DEFAULT true,
  enabled_recommendation boolean NOT NULL DEFAULT true,
  enabled_endorsement    boolean NOT NULL DEFAULT true,
  enabled_profile_view   boolean NOT NULL DEFAULT true,
  enabled_meeting        boolean NOT NULL DEFAULT true
);

-- Kopia 1:1 z 20260807140000_network_event_notifications.sql.
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text, p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tenant uuid; v_id uuid; v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN RETURN NULL; END IF;
  IF p_kind <> 'security' THEN
    SELECT CASE p_kind
             WHEN 'message'        THEN np.enabled_message
             WHEN 'comment'        THEN np.enabled_comment
             WHEN 'follow'         THEN np.enabled_follow
             WHEN 'subscription'   THEN np.enabled_subscription
             WHEN 'content'        THEN np.enabled_content
             WHEN 'system'         THEN np.enabled_system
             WHEN 'tracker'        THEN np.enabled_tracker
             WHEN 'connection'     THEN np.enabled_connection
             WHEN 'saved_search'   THEN np.enabled_saved_search
             WHEN 'crm_task'       THEN np.enabled_crm_task
             WHEN 'expert_request' THEN np.enabled_expert_request
             WHEN 'introduction'   THEN np.enabled_introduction
             WHEN 'recommendation' THEN np.enabled_recommendation
             WHEN 'endorsement'    THEN np.enabled_endorsement
             WHEN 'profile_view'   THEN np.enabled_profile_view
             WHEN 'meeting'        THEN np.enabled_meeting
             ELSE true END
      INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN RETURN NULL; END IF;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes') THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (
    user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon
  ) VALUES (
    p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''),
    NULLIF(btrim(p_body_pl), ''),
    NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''),
    NULLIF(btrim(p_icon), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- audyt
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  actor_id    uuid,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  metadata    jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- tabele wolane przez segmenty (sciezka D zaproszen)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_badges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge      text NOT NULL CHECK (badge IN ('verified','expert','contributor','staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, badge)
);

-- `title_pl`/`title_en`/`slug`/`stage`/`policy_area`/`status` dolozone przy A35:
-- `club_anchor_suggest` i `club_reference_suggest` sa funkcjami LANGUAGE sql
-- i czytaja wlasnie te kolumny, wiec atrapa z jednym `title` przewracala A18
-- i A20 przy TWORZENIU funkcji. Nazwy i typy z ORYGINALU 20260713096000.
CREATE TABLE IF NOT EXISTS public.eu_policy_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug        text,
  title       text,
  title_pl    text,
  title_en    text,
  policy_area text NOT NULL DEFAULT 'general',
  stage       text NOT NULL DEFAULT 'proposal',
  status      text NOT NULL DEFAULT 'draft',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.eu_policy_follows (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.eu_policy_items(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, item_id)
);

-- `slug` dolozony przy A28: harmonogram watku linkuje wydarzenie platformy
-- po slugu (club_thread_milestones_list zwraca `e.slug`), wiec bez tej kolumny
-- harness wywracal sie na WLASNYM brakiem, a nie na bledzie w migracji.
-- Nazwa i typ z ORYGINALNEJ migracji 20260713093000.
-- `title_pl`/`title_en`/`status`/`starts_at` dolozone przy A35 z tego samego
-- powodu, co w `eu_policy_items` wyzej: `club_anchor_suggest` filtruje po
-- `status` i sortuje po `starts_at`. Ksztalt z ORYGINALU 20260712224438.
CREATE TABLE IF NOT EXISTS public.events (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug      text,
  title     text,
  title_pl  text,
  title_en  text,
  status    text NOT NULL DEFAULT 'draft',
  starts_at timestamptz
);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS slug text;

-- Wpisy redakcyjne. Modul czyta je jako KOTWICE watku (`club_anchor_suggest`,
-- `club_linked_label`) i jako cel ankiety (`polls.post_id`) - nic wiecej, wiec
-- z oryginalu (20260531180217 + pozniejsze `tenant_id`, `deleted_at`) wchodzi
-- tylko ten wycinek. Enum `post_status` z oryginalu, bo filtr `status =
-- 'published'` na atrapie tekstowej przechodzilby takze dla literowki.
DO $$ BEGIN
  CREATE TYPE public.post_status AS ENUM ('draft','published','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug         text NOT NULL UNIQUE,
  status       public.post_status NOT NULL DEFAULT 'draft',
  title_pl     text NOT NULL DEFAULT '',
  title_en     text NOT NULL DEFAULT '',
  published_at timestamptz,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Silnik glosowan platformy. Modul klubow CELOWO nie ma wlasnego (patrz A20:
-- "reuzywa polls/poll_votes"), wiec `club_thread_polls` wiaze sie krawedzia
-- z ta tabela, a `club_thread_poll_create` wstawia tu ankiete. Ksztalt
-- z ORYGINALU 20260712224838 wraz z oboma ograniczeniami CHECK - bez nich
-- asercja "ankieta potrzebuje 2-8 opcji" przechodzilaby na fikcji.
-- `poll_votes` NIE jest odtwarzane: zadna migracja klubowa go nie dotyka.
CREATE TABLE IF NOT EXISTS public.polls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT public.public_tenant_id()
                REFERENCES public.tenants(id) ON DELETE CASCADE,
  question_pl text NOT NULL,
  question_en text NOT NULL,
  options     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  post_id     uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  ends_at     timestamptz,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(question_pl) <> '' AND btrim(question_en) <> ''),
  CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 8)
);

-- Ustawienia tenanta. A24 wlacza tu modul klubow (`community_modules`), wiec
-- liczy sie ZLOZONY klucz glowny (tenant_id, key) z 20260714113000 - atrapa
-- z `key` jako PK przewracalaby `ON CONFLICT (tenant_id, key)`.
CREATE TABLE IF NOT EXISTS public.site_settings (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (tenant_id, key)
);

-- ---------------------------------------------------------------------------
-- storage
--
-- Dwie migracje klubowe nadaja polityki na `storage.objects` (bucket
-- `club-media` i prefiks `club-covers` w `media`). Schemat storage stawia
-- Supabase, nie migracje repozytorium, wiec harness musi go podstawic sam.
-- Odtwarzamy tylko to, czego dotykaja polityki: tabele oraz `foldername()`,
-- bo warunek `(storage.foldername(name))[1] = ...` jest liczony przy
-- CREATE POLICY. Sprawdzamy skladnie i widocznosc, NIE realne uprawnienia do
-- plikow - te zaleza od rol Supabase, ktorych tu nie ma.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id     text PRIMARY KEY,
  name   text NOT NULL,
  public boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id  text REFERENCES storage.buckets(id),
  name       text,
  owner      uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata   jsonb
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  _parts := string_to_array(name, '/');
  RETURN _parts[1 : array_length(_parts, 1) - 1];
END $$;

INSERT INTO storage.buckets (id, name, public) VALUES
  ('media','media',true), ('club-media','club-media',false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status   text NOT NULL DEFAULT 'going',
  PRIMARY KEY (user_id, event_id)
);

-- ---------------------------------------------------------------------------
-- Szyny miedzymodulowe, ktorych dotyka A12: szyna zdarzen, graf powiazan
-- i wzmianki. Wszystko przepisane z ORYGINALNYCH migracji
-- (20260711200000_domain_event_bus.sql, 20260711201000_cross_references_and_mentions.sql,
-- 20260711220719_*.sql), bo harness na fikcji przepuszczalby bledy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.domain_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  event_type     text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid,
  actor_id       uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (event_type ~ '^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$'),
  CHECK (btrim(aggregate_type) <> '' AND btrim(aggregate_id) <> '')
);

CREATE TABLE IF NOT EXISTS public.cross_references (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id   text NOT NULL,
  target_type text NOT NULL,
  target_id   text NOT NULL,
  relation    text NOT NULL DEFAULT 'related',
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(source_type) <> '' AND btrim(source_id) <> ''),
  CHECK (btrim(target_type) <> '' AND btrim(target_id) <> ''),
  CHECK (NOT (source_type = target_type AND source_id = target_id)),
  UNIQUE (tenant_id, source_type, source_id, target_type, target_id, relation)
);

CREATE OR REPLACE FUNCTION public.request_correlation_id()
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_raw text;
BEGIN
  v_raw := current_setting('request.headers', true)::jsonb ->> 'x-correlation-id';
  IF v_raw IS NULL OR v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_raw::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;

-- UWAGA NA SYGNATURE. Atrapa musi odwzorowywac stan PRODUKCJI sprzed migracji
-- klubowych, a tam od 20260723120000 stoi wariant SZESCIOARGUMENTOWY z aktorem
-- (piatka zostala wtedy skasowana celowo, zeby nie bylo przeciazenia).
-- Atrapa z piatka klamala: A12 kasowala ja i harness konczyl z jedna funkcja,
-- podczas gdy na prawdziwej bazie zostawaly DWIE i kazde wywolanie stawalo sie
-- niejednoznaczne. Trzy dni martwej szyny zdarzen kosztowala ta jedna roznica.
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text,
  p_event_type text, p_payload jsonb DEFAULT '{}'::jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_aggregate_type IS NULL OR p_aggregate_id IS NULL
     OR p_event_type IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.domain_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload, correlation_id, actor_id
  ) VALUES (
    p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type,
    COALESCE(p_payload, '{}'::jsonb), public.request_correlation_id(),
    COALESCE(p_actor_id, auth.uid())
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.add_cross_reference(
  p_tenant_id uuid, p_source_type text, p_source_id text,
  p_target_type text, p_target_id text,
  p_relation text DEFAULT 'related', p_created_by uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR btrim(COALESCE(p_source_id,'')) = ''
     OR btrim(COALESCE(p_target_id,'')) = '' THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.cross_references (
    tenant_id, source_type, source_id, target_type, target_id, relation, created_by
  ) VALUES (
    p_tenant_id, p_source_type, p_source_id, p_target_type, p_target_id,
    COALESCE(p_relation,'related'), p_created_by
  )
  ON CONFLICT (tenant_id, source_type, source_id, target_type, target_id, relation)
  DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.process_mentions(
  p_tenant_id uuid, p_source_type text, p_source_id text, p_body text,
  p_actor_id uuid, p_kind text, p_href text
)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slug text; v_profile record; v_actor_name text; v_count integer := 0;
BEGIN
  IF p_body IS NULL OR position('@' in p_body) = 0 THEN RETURN 0; END IF;
  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Ktoś')
    INTO v_actor_name FROM public.profiles WHERE id = p_actor_id;
  v_actor_name := COALESCE(v_actor_name, 'Ktoś');
  FOR v_slug IN
    SELECT DISTINCT lower(m[1])
    FROM regexp_matches(p_body, '(?:^|[^a-zA-Z0-9@._-])@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})', 'g') AS m
    LIMIT 10
  LOOP
    SELECT id, display_name INTO v_profile
      FROM public.profiles WHERE tenant_id = p_tenant_id AND slug = v_slug;
    IF v_profile.id IS NULL OR v_profile.id = p_actor_id THEN CONTINUE; END IF;
    PERFORM public.add_cross_reference(
      p_tenant_id, p_source_type, p_source_id, 'profile', v_profile.id::text, 'mention', p_actor_id);
    PERFORM public.enqueue_notification(
      v_profile.id, p_kind, v_actor_name || ' wspomniał(a) o Tobie',
      v_actor_name || ' mentioned you', NULL, NULL, p_href, 'at-sign');
    PERFORM public.emit_domain_event(
      p_tenant_id, p_source_type, p_source_id, 'mention.created.v1',
      jsonb_build_object('mentioned_user_id', v_profile.id, 'actor_id', p_actor_id,
                         'source_type', p_source_type));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
EXCEPTION WHEN OTHERS THEN RETURN v_count;
END; $$;

-- ---------------------------------------------------------------------------
-- CRM: powierzchnia, ktorej dotyka sciezka zgloszen do klubow (A35)
--
-- `club_apply_submit` konczy sie wejsciem leada do CRM, wiec bez tych obiektow
-- ani migracja zgloszen (20260811111733), ani A35 nie mialy gdzie sie wykonac -
-- obie przewracaly sie na PIERWSZEJ instrukcji.
--
-- Ograniczenie `crm_leads_source_type_check` jest tu przepisane w brzmieniu
-- SPRZED modulu klubow (20260722094744), a NIE w docelowym z A35. To jest cala
-- pointa tej atrapy: gdyby harness od razu dopuszczal 'club_application',
-- asercja "lead ma source_type = 'club_application'" przechodzilaby nawet po
-- wycofaniu sekcji A1 z migracji - czyli dokladnie "na fikcji", czego README
-- harnessu zabrania. Ograniczenie ma bolec przed poprawka i przestac bolec
-- po niej.
--
-- Czego tu NIE MA: siedmiu triggerow `crm_leads` (`crm_normalize_lead`,
-- `crm_leads_sync_phone_norm_trg`, `trg_score_on_lead_change` i pozostale).
-- `crm_upsert_from_form` wpisuje `email_norm` i `phone_norm` sama, wiec sciezka
-- klubowa dziala bez nich; scoring i normalizacja sa poza zakresem modulu
-- i harness ICH NIE SPRAWDZA.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.crm_stage AS ENUM
    ('new','contacted','qualified','proposal','won','lost','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- `name_norm` jako kolumna GENERATED plus UNIQUE (tenant_id, name_norm) - to na
-- ten indeks celuje `ON CONFLICT (tenant_id, name_norm)` w kanonicznym upsercie.
CREATE TABLE IF NOT EXISTS public.crm_companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       text NOT NULL,
  name_norm  text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  domain     text,
  aliases    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name_norm)
);

-- Kolumny zebrane z ORYGINALOW w kolejnosci ich powstania: 20260630053403
-- (baza), 20260630060254 (`phone_norm`), 20260706201356 (`aliases`,
-- `company_id`, `position`, `linkedin_url`, `country`), 20260718130000
-- (scoring), 20260722094744 (`source_type`). Kolumny klubowe
-- (`club_applied_at`, `club_application_count`, `club_specializations`)
-- dokladana MIGRACJA 20260811111733 - i tak ma byc, bo harness ma sprawdzic,
-- czy ona sie wykonuje.
CREATE TABLE IF NOT EXISTS public.crm_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT public.public_tenant_id(),
  email_norm        text NOT NULL,
  email             text NOT NULL,
  first_name        text,
  last_name         text,
  phone             text,
  phone_norm        text,
  company           text,
  company_id        uuid REFERENCES public.crm_companies(id) ON DELETE SET NULL,
  position          text,
  linkedin_url      text,
  country           text,
  stage             public.crm_stage NOT NULL DEFAULT 'new',
  owner_id          uuid,
  tags              text[] NOT NULL DEFAULT '{}',
  aliases           jsonb NOT NULL DEFAULT '{}'::jsonb,
  follow_up_at      timestamptz,
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  source_count      int NOT NULL DEFAULT 1,
  source_type       text NOT NULL DEFAULT 'manual',
  newsletter_status text,
  marketing_consent boolean NOT NULL DEFAULT false,
  score             integer NOT NULL DEFAULT 0,
  score_band        text NOT NULL DEFAULT 'cold'
                      CHECK (score_band IN ('hot','warm','cool','cold')),
  score_breakdown   jsonb NOT NULL DEFAULT '[]'::jsonb,
  score_updated_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email_norm),
  CONSTRAINT crm_leads_source_type_check CHECK (source_type IN (
    'registered','paid_subscriber','event_participant',
    'speaker','expert','contact_form','newsletter','manual'
  ))
);

-- 1:1 z 20260706201356. Kanoniczny upsert buduje na niej `aliases`, wiec bez
-- niej nie da sie odtworzyc `crm_upsert_from_form` w produkcyjnym ciele.
CREATE OR REPLACE FUNCTION public.jsonb_append_distinct(_obj jsonb, _key text, _val text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN _val IS NULL OR btrim(_val) = '' THEN _obj
    WHEN _obj ? _key AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(_obj->_key) x WHERE x = _val
    ) THEN _obj
    ELSE jsonb_set(_obj, ARRAY[_key],
      COALESCE(_obj->_key, '[]'::jsonb) || to_jsonb(_val), true)
  END
$$;

-- 1:1 z 20260706215313 (ostatnia definicja). Cialo przepisane bez skrotow
-- SWIADOMIE: A35 opiera na niej caly krok 1 wejscia do CRM, a to WLASNIE ta
-- funkcja nie rusza `source_type` ani `marketing_consent` - i to jest powod,
-- dla ktorego po niej musi isc jawny UPDATE. Atrapa "wstaw wiersz i zwroc id"
-- przepuscilaby migracje, ktora zapomniala kroku 2.
CREATE OR REPLACE FUNCTION public.crm_upsert_from_form(
  _tenant uuid,
  _email text,
  _first_name text,
  _last_name text,
  _phone text,
  _company text,
  _position text,
  _linkedin text,
  _country text,
  _source text,
  _custom jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email_norm text := lower(btrim(coalesce(_email, '')));
  v_phone_norm text := regexp_replace(coalesce(_phone,''), '[^0-9+]', '', 'g');
  v_company_id uuid;
  v_lead_id uuid;
  v_existing public.crm_leads%ROWTYPE;
  v_key text;
  v_val text;
  v_aliases jsonb;
BEGIN
  IF v_email_norm = '' THEN RETURN NULL; END IF;
  IF v_phone_norm = '' THEN v_phone_norm := NULL; END IF;

  IF _company IS NOT NULL AND btrim(_company) <> '' THEN
    INSERT INTO public.crm_companies (tenant_id, name)
    VALUES (_tenant, btrim(_company))
    ON CONFLICT (tenant_id, name_norm) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_company_id;
  END IF;

  SELECT * INTO v_existing FROM public.crm_leads
   WHERE tenant_id = _tenant AND email_norm = v_email_norm LIMIT 1;

  IF v_existing.id IS NULL AND _first_name IS NOT NULL AND _last_name IS NOT NULL
     AND btrim(_first_name) <> '' AND btrim(_last_name) <> '' THEN
    SELECT * INTO v_existing FROM public.crm_leads
     WHERE tenant_id = _tenant
       AND lower(btrim(coalesce(first_name,''))) = lower(btrim(_first_name))
       AND lower(btrim(coalesce(last_name,'')))  = lower(btrim(_last_name))
       AND (v_company_id IS NULL OR company_id IS NULL OR company_id = v_company_id)
     LIMIT 1;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.crm_leads SET
      first_name    = COALESCE(NULLIF(first_name,''), _first_name),
      last_name     = COALESCE(NULLIF(last_name,''),  _last_name),
      phone         = COALESCE(NULLIF(phone,''),      _phone),
      phone_norm    = COALESCE(phone_norm,            v_phone_norm),
      company       = COALESCE(NULLIF(company,''),    _company),
      position      = COALESCE(NULLIF(position,''),   _position),
      linkedin_url  = COALESCE(NULLIF(linkedin_url,''), _linkedin),
      country       = COALESCE(NULLIF(country,''),    _country),
      company_id    = COALESCE(company_id,            v_company_id),
      aliases = public.jsonb_append_distinct(
                  public.jsonb_append_distinct(
                    public.jsonb_append_distinct(
                      public.jsonb_append_distinct(
                        public.jsonb_append_distinct(
                          public.jsonb_append_distinct(
                            public.jsonb_append_distinct(aliases, 'emails',
                              CASE WHEN v_email_norm <> lower(btrim(coalesce(v_existing.email,''))) THEN v_email_norm END),
                            'phones', CASE WHEN _phone IS NOT NULL AND v_existing.phone IS DISTINCT FROM _phone THEN _phone END),
                          'companies', CASE WHEN _company IS NOT NULL AND v_existing.company IS DISTINCT FROM _company THEN _company END),
                        'positions', CASE WHEN _position IS NOT NULL AND v_existing.position IS DISTINCT FROM _position THEN _position END),
                      'linkedins', CASE WHEN _linkedin IS NOT NULL AND v_existing.linkedin_url IS DISTINCT FROM _linkedin THEN _linkedin END),
                    'countries', CASE WHEN _country IS NOT NULL AND v_existing.country IS DISTINCT FROM _country THEN _country END),
                  'sources', _source),
      source_count = source_count + 1,
      last_activity_at = now(),
      updated_at = now()
    WHERE id = v_existing.id
    RETURNING id, aliases INTO v_lead_id, v_aliases;
  ELSE
    INSERT INTO public.crm_leads (
      tenant_id, email_norm, email, first_name, last_name,
      phone, phone_norm, company, company_id, position, linkedin_url, country,
      stage, tags, aliases, newsletter_status, marketing_consent, source_count, last_activity_at
    ) VALUES (
      _tenant, v_email_norm, _email, NULLIF(btrim(coalesce(_first_name,'')),''), NULLIF(btrim(coalesce(_last_name,'')),''),
      _phone, v_phone_norm, _company, v_company_id, _position, _linkedin, _country,
      'new', ARRAY[]::text[],
      CASE WHEN _source IS NOT NULL THEN jsonb_build_object('sources', jsonb_build_array(_source)) ELSE '{}'::jsonb END,
      'pending', false, 1, now()
    ) RETURNING id, aliases INTO v_lead_id, v_aliases;
  END IF;

  IF _custom IS NOT NULL AND jsonb_typeof(_custom) = 'object' THEN
    FOR v_key, v_val IN
      SELECT key, value::text FROM jsonb_each_text(_custom)
    LOOP
      IF v_val IS NULL OR btrim(v_val) = '' THEN CONTINUE; END IF;
      IF v_aliases IS NULL OR NOT (v_aliases ? 'custom') OR jsonb_typeof(v_aliases->'custom') <> 'object' THEN
        v_aliases := jsonb_set(COALESCE(v_aliases, '{}'::jsonb), '{custom}', '{}'::jsonb, true);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(
          COALESCE(v_aliases#>ARRAY['custom', v_key], '[]'::jsonb)
        ) x WHERE x = v_val
      ) THEN
        v_aliases := jsonb_set(
          v_aliases,
          ARRAY['custom', v_key],
          COALESCE(v_aliases#>ARRAY['custom', v_key], '[]'::jsonb) || to_jsonb(v_val),
          true
        );
      END IF;
    END LOOP;

    UPDATE public.crm_leads SET aliases = v_aliases, updated_at = now()
     WHERE id = v_lead_id;
  END IF;

  RETURN v_lead_id;
END $function$;
