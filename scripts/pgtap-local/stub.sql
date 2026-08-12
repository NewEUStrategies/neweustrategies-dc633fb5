-- Minimalna atrapa tego, co w produkcji dostarcza Supabase, a czego NIE tworzą
-- migracje repozytorium. Celowo NIE tworzy niczego, co migracje tworzą same
-- (profiles, tenants, notifications, ...) - inaczej `CREATE TABLE IF NOT EXISTS`
-- w migracji zostałby pominięty i schemat zastygłby w kształcie atrapy.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS graphql_public;
CREATE SCHEMA IF NOT EXISTS realtime;

CREATE EXTENSION IF NOT EXISTS pgcrypto  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Migracje wołają te funkcje bez kwalifikatora schematu, licząc na search_path
-- Supabase (public, extensions). Lustrzane wrappery w public zdejmują tę zależność.
CREATE OR REPLACE FUNCTION public.gen_random_uuid() RETURNS uuid
  LANGUAGE sql VOLATILE AS $$ SELECT extensions.gen_random_uuid() $$;
CREATE OR REPLACE FUNCTION public.gen_random_bytes(integer) RETURNS bytea
  LANGUAGE sql VOLATILE AS $$ SELECT extensions.gen_random_bytes($1) $$;
CREATE OR REPLACE FUNCTION public.digest(text, text) RETURNS bytea
  LANGUAGE sql IMMUTABLE AS $$ SELECT extensions.digest($1, $2) $$;
CREATE OR REPLACE FUNCTION public.hmac(text, text, text) RETURNS bytea
  LANGUAGE sql IMMUTABLE AS $$ SELECT extensions.hmac($1, $2, $3) $$;
CREATE OR REPLACE FUNCTION public.crypt(text, text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT extensions.crypt($1, $2) $$;
CREATE OR REPLACE FUNCTION public.gen_salt(text) RETURNS text
  LANGUAGE sql VOLATILE AS $$ SELECT extensions.gen_salt($1) $$;
CREATE OR REPLACE FUNCTION public.unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT extensions.unaccent($1) $$;

-- pgvector bywa niedostępny w obrazie bez rozszerzenia; atrapa pozwala
-- zaaplikować migracje semantyczne. Wyniki podobieństwa NIE są miarodajne.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
  ELSE
    CREATE DOMAIN extensions.vector AS double precision[];
    CREATE FUNCTION extensions.vec_dist(a extensions.vector, b extensions.vector)
      RETURNS double precision LANGUAGE sql IMMUTABLE AS $f$ SELECT 0.0::double precision $f$;
    CREATE OPERATOR extensions.<=> (
      LEFTARG = extensions.vector, RIGHTARG = extensions.vector,
      FUNCTION = extensions.vec_dist);
  END IF;
END $$;

-- auth.*: JWT niosący sub/role czytany przez auth.uid()/auth.role(), tak jak
-- w GoTrue. request.jwt.claim.sub jest ustawiane w testach przez SET.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  instance_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  aud text DEFAULT 'authenticated',
  role text DEFAULT 'authenticated',
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_sent_at timestamptz,
  recovery_sent_at timestamptz,
  email_change_token_new text,
  email_change text,
  email_change_sent_at timestamptz,
  phone text,
  phone_confirmed_at timestamptz,
  is_super_admin boolean,
  banned_until timestamptz,
  confirmation_token text,
  recovery_token text,
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claim.sub', true),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'authenticated')
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()) $$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- storage.*: migracje zakładają polityki na obiektach i wpisy bucketów.
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  path_tokens text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(name, '/', -1) $$;
CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(split_part(name, '/', -1), '.', -1) $$;

GRANT USAGE ON SCHEMA public, extensions, auth, storage TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;
GRANT ALL ON storage.buckets, storage.objects TO authenticated, service_role;

-- Publikacja realtime: migracje dopisują do niej tabele przez ALTER PUBLICATION.
CREATE PUBLICATION supabase_realtime;

-- realtime.messages / topic: broadcast z bazy (RLS na kanałach).
CREATE TABLE IF NOT EXISTS realtime.messages (
  id bigserial PRIMARY KEY,
  topic text NOT NULL,
  extension text NOT NULL DEFAULT 'broadcast',
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  inserted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;
GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;
GRANT ALL ON realtime.messages TO authenticated, service_role;

-- auth.mfa_factors: bramka step-up dla staffu czyta stan czynnika TOTP.
CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friendly_name text,
  factor_type text NOT NULL DEFAULT 'totp',
  status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON auth.mfa_factors TO authenticated, service_role;

-- vault: sekrety integracji. Atrapa trzyma jawny tekst - to jest runner testowy,
-- a nie środowisko, w którym wolno trzymać cokolwiek prawdziwego.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  name text UNIQUE,
  description text NOT NULL DEFAULT '',
  secret text NOT NULL,
  key_id uuid,
  nonce bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT s.id, s.name, s.description, s.secret, s.secret AS decrypted_secret,
         s.key_id, s.nonce, s.created_at, s.updated_at
    FROM vault.secrets s;
CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '',
  new_key_id uuid DEFAULT NULL) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'vault' AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO vault.secrets (name, description, secret, key_id)
  VALUES (new_name, COALESCE(new_description, ''), new_secret, new_key_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION vault.update_secret(
  secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL,
  new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'vault' AS $$
BEGIN
  UPDATE vault.secrets s
     SET secret      = COALESCE(new_secret, s.secret),
         name        = COALESCE(new_name, s.name),
         description = COALESCE(new_description, s.description),
         key_id      = COALESCE(new_key_id, s.key_id),
         updated_at  = now()
   WHERE s.id = secret_id;
END $$;
GRANT USAGE ON SCHEMA vault TO service_role;

-- pg_net: migracje wołają net.http_post z triggerów/cronu (webhooki, maile).
-- Atrapa zwraca id żądania i NIC nie wysyła - runner nie ma prawa ruszać sieci.
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net._http_response (
  id bigserial PRIMARY KEY,
  status_code integer,
  content text,
  created timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION net.http_post(
  url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql VOLATILE AS $$ SELECT 0::bigint $$;
CREATE OR REPLACE FUNCTION net.http_get(
  url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql VOLATILE AS $$ SELECT 0::bigint $$;
GRANT USAGE ON SCHEMA net TO service_role;

-- pg_cron: harmonogram. Atrapa rejestruje wpis w cron.job, żeby testy mogły
-- sprawdzić, ŻE zadanie zostało zarejestrowane, nie wykonując go.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command text NOT NULL,
  nodename text NOT NULL DEFAULT 'localhost',
  nodeport integer NOT NULL DEFAULT 5432,
  database text NOT NULL DEFAULT current_database(),
  username text NOT NULL DEFAULT current_user,
  active boolean NOT NULL DEFAULT true,
  jobname text UNIQUE
);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text)
  RETURNS bigint LANGUAGE plpgsql VOLATILE AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text)
  RETURNS bigint LANGUAGE sql VOLATILE AS $$ SELECT cron.schedule(md5($1 || $2), $1, $2) $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text)
  RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
BEGIN DELETE FROM cron.job WHERE jobname = job_name; RETURN true; END $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint)
  RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
BEGIN DELETE FROM cron.job WHERE jobid = job_id; RETURN true; END $$;
CREATE OR REPLACE FUNCTION cron.alter_job(
  job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  UPDATE cron.job j SET schedule = COALESCE(alter_job.schedule, j.schedule),
                        command  = COALESCE(alter_job.command, j.command),
                        active   = COALESCE(alter_job.active, j.active)
   WHERE j.jobid = job_id;
END $$;
GRANT USAGE ON SCHEMA cron TO service_role;

-- pgmq: kolejka maili. Atrapa trzyma komunikaty w jednej tabeli i implementuje
-- tylko to API, którego naprawdę używają migracje (create/send/read/delete/metrics).
CREATE SCHEMA IF NOT EXISTS pgmq;
CREATE TABLE IF NOT EXISTS pgmq.q_messages (
  msg_id bigserial PRIMARY KEY,
  queue_name text NOT NULL,
  message jsonb NOT NULL,
  read_ct integer NOT NULL DEFAULT 0,
  vt timestamptz NOT NULL DEFAULT now(),
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION pgmq.create(queue_name text) RETURNS void
  LANGUAGE sql VOLATILE AS $$ SELECT NULL::void $$;
CREATE OR REPLACE FUNCTION pgmq.send(queue_name text, msg jsonb, delay integer DEFAULT 0)
  RETURNS bigint LANGUAGE plpgsql VOLATILE AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO pgmq.q_messages (queue_name, message, vt)
  VALUES (queue_name, msg, now() + make_interval(secs => COALESCE(delay, 0)))
  RETURNING msg_id INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION pgmq.read(queue_name text, vt integer, qty integer)
  RETURNS TABLE(msg_id bigint, read_ct integer, enqueued_at timestamptz,
                vt timestamptz, message jsonb)
  LANGUAGE sql VOLATILE AS $$
  SELECT m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message
    FROM pgmq.q_messages m
   WHERE m.queue_name = read.queue_name AND m.vt <= now()
   ORDER BY m.msg_id
   LIMIT qty
$$;
CREATE OR REPLACE FUNCTION pgmq.delete(queue_name text, msg_id bigint) RETURNS boolean
  LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  DELETE FROM pgmq.q_messages m
   WHERE m.queue_name = "delete".queue_name AND m.msg_id = "delete".msg_id;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION pgmq.metrics(queue_name text)
  RETURNS TABLE(queue_name text, queue_length bigint, newest_msg_age_sec integer,
                oldest_msg_age_sec integer, total_messages bigint, scrape_time timestamptz)
  LANGUAGE sql STABLE AS $$
  SELECT metrics.queue_name,
         count(*)::bigint,
         COALESCE(min(extract(epoch FROM now() - m.enqueued_at))::integer, 0),
         COALESCE(max(extract(epoch FROM now() - m.enqueued_at))::integer, 0),
         count(*)::bigint,
         now()
    FROM pgmq.q_messages m
   WHERE m.queue_name = metrics.queue_name
$$;
GRANT USAGE ON SCHEMA pgmq TO service_role;

-- auth.identities: seed deweloperski tworzy tozsamosc e-mailowa dla kont
-- testowych (GoTrue robi to samo przy rejestracji).
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  provider text NOT NULL,
  identity_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  email text,
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider)
);
GRANT SELECT ON auth.identities TO authenticated, service_role;

-- auth.sessions / refresh_tokens: nie uzywane przez testy, ale seed i migracje
-- bywaja pisane pod pelny schemat GoTrue.
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  aal text
);
