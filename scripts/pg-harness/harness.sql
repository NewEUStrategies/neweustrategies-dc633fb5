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

-- ---------------------------------------------------------------------------
-- plany czlonkowskie
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_tiers (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key       text NOT NULL,
  rank      integer NOT NULL DEFAULT 0,
  name_pl   text NOT NULL,
  name_en   text NOT NULL,
  active    boolean NOT NULL DEFAULT true
);

CREATE OR REPLACE FUNCTION public.current_tier_rank() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT 0 $$;

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

CREATE TABLE IF NOT EXISTS public.eu_policy_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title     text
);

CREATE TABLE IF NOT EXISTS public.eu_policy_follows (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.eu_policy_items(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.events (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title     text
);

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status   text NOT NULL DEFAULT 'going',
  PRIMARY KEY (user_id, event_id)
);
