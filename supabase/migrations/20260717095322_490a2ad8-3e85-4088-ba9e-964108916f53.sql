-- 1) Bieżący stan zgód użytkownika (jeden wiersz per (user, consent_key))
CREATE TABLE public.user_consents (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_key text NOT NULL CHECK (length(consent_key) BETWEEN 1 AND 64),
  given boolean NOT NULL,
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 32),
  lang text NULL CHECK (lang IS NULL OR lang IN ('pl','en')),
  ip text NULL,
  user_agent text NULL,
  given_at timestamptz NULL,
  withdrawn_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, consent_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_consents TO authenticated;
GRANT ALL ON public.user_consents TO service_role;

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_consents_select_own" ON public.user_consents
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_consents_insert_own" ON public.user_consents
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_consents_update_own" ON public.user_consents
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_consents_delete_own" ON public.user_consents
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.tg_user_consents_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_user_consents_touch
  BEFORE UPDATE ON public.user_consents
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_consents_touch();

-- 2) Niezmienny audit-log zdarzeń zgody (RODO): każda zmiana = nowy wiersz.
CREATE TABLE public.user_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_key text NOT NULL CHECK (length(consent_key) BETWEEN 1 AND 64),
  given boolean NOT NULL,
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 32),
  lang text NULL CHECK (lang IS NULL OR lang IN ('pl','en')),
  ip text NULL,
  user_agent text NULL,
  source text NULL CHECK (source IS NULL OR length(source) <= 64),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_consent_events_user_created_idx
  ON public.user_consent_events (user_id, created_at DESC);
CREATE INDEX user_consent_events_user_key_created_idx
  ON public.user_consent_events (user_id, consent_key, created_at DESC);

GRANT SELECT, INSERT ON public.user_consent_events TO authenticated;
GRANT ALL ON public.user_consent_events TO service_role;

ALTER TABLE public.user_consent_events ENABLE ROW LEVEL SECURITY;

-- Użytkownik czyta własne zdarzenia; wpisy tylko własne; brak UPDATE/DELETE (immutable audit)
CREATE POLICY "user_consent_events_select_own" ON public.user_consent_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_consent_events_insert_own" ON public.user_consent_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 3) Funkcja pomocnicza: atomowy upsert stanu + wpis do audit-logu.
CREATE OR REPLACE FUNCTION public.set_user_consent(
  p_key text,
  p_given boolean,
  p_version text,
  p_lang text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_source text DEFAULT NULL
)
RETURNS public.user_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.user_consents;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_key IS NULL OR length(p_key) = 0 THEN
    RAISE EXCEPTION 'invalid_key';
  END IF;
  IF p_version IS NULL OR length(p_version) = 0 THEN
    RAISE EXCEPTION 'invalid_version';
  END IF;

  INSERT INTO public.user_consents AS uc
    (user_id, consent_key, given, version, lang, ip, user_agent, given_at, withdrawn_at)
  VALUES
    (v_uid, p_key, p_given, p_version, p_lang, p_ip, p_user_agent,
     CASE WHEN p_given THEN now() ELSE NULL END,
     CASE WHEN p_given THEN NULL ELSE now() END)
  ON CONFLICT (user_id, consent_key) DO UPDATE
    SET given = EXCLUDED.given,
        version = EXCLUDED.version,
        lang = COALESCE(EXCLUDED.lang, uc.lang),
        ip = EXCLUDED.ip,
        user_agent = EXCLUDED.user_agent,
        given_at = CASE WHEN EXCLUDED.given THEN now() ELSE uc.given_at END,
        withdrawn_at = CASE WHEN EXCLUDED.given THEN NULL ELSE now() END
  RETURNING * INTO v_row;

  INSERT INTO public.user_consent_events
    (user_id, consent_key, given, version, lang, ip, user_agent, source)
  VALUES
    (v_uid, p_key, p_given, p_version, p_lang, p_ip, p_user_agent, p_source);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_consent(text, boolean, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, text, text, text, text) TO authenticated;