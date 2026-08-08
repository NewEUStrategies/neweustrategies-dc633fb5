-- 1) Katalog obszarów tematycznych, per organizacja
CREATE TABLE public.club_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  label_pl text NOT NULL,
  label_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_topics_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT club_topics_label_pl_len CHECK (char_length(btrim(label_pl)) BETWEEN 2 AND 80),
  CONSTRAINT club_topics_label_en_len CHECK (char_length(btrim(label_en)) BETWEEN 2 AND 80),
  CONSTRAINT club_topics_tenant_key_unique UNIQUE (tenant_id, key)
);

CREATE INDEX club_topics_tenant_active_idx
  ON public.club_topics (tenant_id, is_active, sort_order, key);
CREATE INDEX club_topics_key_idx ON public.club_topics (key) WHERE is_active;

GRANT SELECT ON public.club_topics TO anon;
GRANT SELECT ON public.club_topics TO authenticated;
GRANT ALL ON public.club_topics TO service_role;

ALTER TABLE public.club_topics ENABLE ROW LEVEL SECURITY;

-- Etykiety obszarów są treścią publiczną (widać je na hubie klubów bez logowania).
CREATE POLICY "club_topics_public_read"
  ON public.club_topics FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "club_topics_admin_insert"
  ON public.club_topics FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public._caller_tenant()
  );

CREATE POLICY "club_topics_admin_update"
  ON public.club_topics FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public._caller_tenant()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public._caller_tenant()
  );

CREATE POLICY "club_topics_admin_delete"
  ON public.club_topics FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND tenant_id = public._caller_tenant()
    AND is_system = false
  );

CREATE TRIGGER club_topics_touch_updated_at
  BEFORE UPDATE ON public.club_topics
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- 2) Zasilenie katalogu domyślną taksonomią dla każdej istniejącej organizacji
INSERT INTO public.club_topics (tenant_id, key, label_pl, label_en, sort_order, is_system)
SELECT tn.tenant_id, d.key, d.label_pl, d.label_en, d.sort_order, true
FROM (
  SELECT DISTINCT tenant_id FROM public.profiles WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM public.clubs WHERE tenant_id IS NOT NULL
) tn
CROSS JOIN (VALUES
  ('geopolitics', 'Geopolityka i wojskowość', 'Geopolitics and defence', 10),
  ('transport', 'Transport', 'Transport', 20),
  ('energy', 'Energetyka', 'Energy', 30),
  ('cybersecurity', 'Cyberbezpieczeństwo', 'Cybersecurity', 40),
  ('technology', 'Technologie', 'Technology', 50),
  ('finance', 'Finanse', 'Finance', 60),
  ('economy', 'Gospodarka', 'Economy', 70),
  ('diplomacy', 'Dyplomacja', 'Diplomacy', 80),
  ('international_relations', 'Stosunki międzynarodowe', 'International relations', 90),
  ('culture', 'Kultura', 'Culture', 100)
) AS d(key, label_pl, label_en, sort_order)
ON CONFLICT (tenant_id, key) DO NOTHING;

-- 3) Walidacja tematu opiera się teraz o katalog (aktywne wpisy)
CREATE OR REPLACE FUNCTION public.club_topic_valid(_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _topic IS NULL
     OR btrim(_topic) = ''
     OR EXISTS (
       SELECT 1 FROM public.club_topics ct
       WHERE ct.key = _topic AND ct.is_active
     );
$$;

-- 4) Publiczny odczyt aktywnych obszarów (hub, kluby, wątki)
CREATE OR REPLACE FUNCTION public.club_topics_active()
RETURNS TABLE (
  key text,
  label_pl text,
  label_en text,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ct.key, ct.label_pl, ct.label_en, ct.sort_order
  FROM public.club_topics ct
  WHERE ct.is_active
    AND ct.tenant_id = COALESCE(public._caller_tenant(), ct.tenant_id)
  ORDER BY ct.sort_order, ct.key;
$$;

GRANT EXECUTE ON FUNCTION public.club_topics_active() TO anon, authenticated, service_role;

-- 5) Panel administracyjny: lista z licznikami użycia
CREATE OR REPLACE FUNCTION public.admin_club_topics_list()
RETURNS TABLE (
  id uuid,
  key text,
  label_pl text,
  label_en text,
  sort_order integer,
  is_active boolean,
  is_system boolean,
  clubs_count integer,
  threads_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT
    ct.id,
    ct.key,
    ct.label_pl,
    ct.label_en,
    ct.sort_order,
    ct.is_active,
    ct.is_system,
    COALESCE(c.cnt, 0)::integer,
    COALESCE(th.cnt, 0)::integer
  FROM public.club_topics ct
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.clubs cl
    WHERE cl.tenant_id = v_tenant AND cl.policy_area = ct.key
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.club_threads t
    JOIN public.clubs cl2 ON cl2.id = t.club_id
    WHERE cl2.tenant_id = v_tenant AND t.topic = ct.key
  ) th ON true
  WHERE ct.tenant_id = v_tenant
  ORDER BY ct.sort_order, ct.key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_club_topics_list() TO authenticated, service_role;

-- 6) Dodawanie i edycja obszaru
CREATE OR REPLACE FUNCTION public.admin_club_topic_upsert(
  _id uuid,
  _key text,
  _label_pl text,
  _label_en text,
  _sort_order integer DEFAULT 100,
  _is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_key text := lower(btrim(COALESCE(_key, '')));
  v_id uuid;
BEGIN
  IF _id IS NOT NULL THEN
    SELECT ct.id, ct.key INTO v_id, v_key
    FROM public.club_topics ct
    WHERE ct.id = _id AND ct.tenant_id = v_tenant;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: topic does not exist in this tenant';
    END IF;

    UPDATE public.club_topics
    SET label_pl = btrim(_label_pl),
        label_en = btrim(_label_en),
        sort_order = COALESCE(_sort_order, sort_order),
        is_active = COALESCE(_is_active, is_active)
    WHERE id = v_id;

    RETURN v_id;
  END IF;

  IF v_key = '' THEN
    RAISE EXCEPTION 'invalid_key: key is required';
  END IF;

  INSERT INTO public.club_topics (tenant_id, key, label_pl, label_en, sort_order, is_active, is_system)
  VALUES (v_tenant, v_key, btrim(_label_pl), btrim(_label_en), COALESCE(_sort_order, 100), COALESCE(_is_active, true), false)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_club_topic_upsert(uuid, text, text, text, integer, boolean) TO authenticated, service_role;

-- 7) Usuwanie obszaru - tylko jeśli nikt go nie używa
CREATE OR REPLACE FUNCTION public.admin_club_topic_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_key text;
  v_used integer;
BEGIN
  SELECT ct.key INTO v_key
  FROM public.club_topics ct
  WHERE ct.id = _id AND ct.tenant_id = v_tenant;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'not_found: topic does not exist in this tenant';
  END IF;

  SELECT (
    (SELECT count(*) FROM public.clubs cl WHERE cl.tenant_id = v_tenant AND cl.policy_area = v_key)
    + (SELECT count(*) FROM public.club_threads t
       JOIN public.clubs cl2 ON cl2.id = t.club_id
       WHERE cl2.tenant_id = v_tenant AND t.topic = v_key)
  )::integer INTO v_used;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'topic_in_use: % item(s) still use this topic', v_used;
  END IF;

  DELETE FROM public.club_topics WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_club_topic_delete(uuid) TO authenticated, service_role;

-- 8) Szybki przełącznik dostępności obszaru w organizacji
CREATE OR REPLACE FUNCTION public.admin_club_topic_set_active(_id uuid, _is_active boolean)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
BEGIN
  UPDATE public.club_topics
  SET is_active = _is_active
  WHERE id = _id AND tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: topic does not exist in this tenant';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_club_topic_set_active(uuid, boolean) TO authenticated, service_role;