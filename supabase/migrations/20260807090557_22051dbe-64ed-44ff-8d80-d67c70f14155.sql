CREATE TABLE IF NOT EXISTS public.connection_suggestion_dismissals (
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dismissed_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dismissed_user_id),
  CHECK (user_id <> dismissed_user_id)
);

COMMENT ON TABLE public.connection_suggestion_dismissals IS
  'Sugestie odrzucone przez uzytkownika. Wylacznie przez RPC: dismiss_connection_suggestion / restore_connection_suggestions.';

CREATE INDEX IF NOT EXISTS connection_suggestion_dismissals_tenant_idx
  ON public.connection_suggestion_dismissals (tenant_id, user_id);

ALTER TABLE public.connection_suggestion_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.connection_suggestion_dismissals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.connection_suggestion_dismissals TO service_role;

CREATE OR REPLACE FUNCTION public.dismiss_connection_suggestion(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_peer_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'connections: authentication required';
  END IF;
  IF p_user_id IS NULL OR p_user_id = v_uid THEN
    RAISE EXCEPTION 'connections: invalid peer';
  END IF;

  SELECT tenant_id INTO v_tenant      FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_peer_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'connections: peer not available';
  END IF;

  INSERT INTO public.connection_suggestion_dismissals (user_id, dismissed_user_id, tenant_id)
  VALUES (v_uid, p_user_id, v_tenant)
  ON CONFLICT (user_id, dismissed_user_id) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dismiss_connection_suggestion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_connection_suggestion(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.restore_connection_suggestions()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_removed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'connections: authentication required';
  END IF;
  DELETE FROM public.connection_suggestion_dismissals WHERE user_id = v_uid;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.restore_connection_suggestions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_connection_suggestions()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_dismissed_suggestions_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM public.connection_suggestion_dismissals d
   WHERE auth.uid() IS NOT NULL
     AND d.user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.my_dismissed_suggestions_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_dismissed_suggestions_count()
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.connection_suggestions(integer);

CREATE FUNCTION public.connection_suggestions(p_limit integer DEFAULT 12)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  verified boolean,
  mutual_count bigint,
  shared_follows bigint,
  shared_events bigint,
  degree smallint,
  bridge_id uuid,
  bridge_name text,
  bridge_avatar text,
  bridge_slug text,
  open_to text[],
  completeness_score smallint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.id, p.tenant_id, p.current_company, p.specialization, p.location, p.open_to
      FROM public.profiles p
     WHERE p.id = auth.uid()
  ),
  mine AS (
    SELECT CASE WHEN c.requester_id = me.id THEN c.addressee_id
                ELSE c.requester_id END AS peer,
           c.responded_at AS since
      FROM public.user_connections c, me
     WHERE c.status = 'accepted' AND me.id IN (c.requester_id, c.addressee_id)
  ),
  related AS (
    SELECT CASE WHEN c.requester_id = me.id THEN c.addressee_id
                ELSE c.requester_id END AS uid
      FROM public.user_connections c, me
     WHERE me.id IN (c.requester_id, c.addressee_id)
  ),
  dismissed AS (
    SELECT d.dismissed_user_id AS uid
      FROM public.connection_suggestion_dismissals d, me
     WHERE d.user_id = me.id
  ),
  second_pairs AS (
    SELECT CASE WHEN c.requester_id = m.peer THEN c.addressee_id
                ELSE c.requester_id END AS uid,
           m.peer AS via,
           m.since AS via_since
      FROM mine m
      JOIN public.user_connections c
        ON c.status = 'accepted' AND m.peer IN (c.requester_id, c.addressee_id)
  ),
  mutual AS (
    SELECT sp.uid, count(*) AS cnt
      FROM second_pairs sp, me
     WHERE sp.uid <> me.id
     GROUP BY sp.uid
  ),
  bridge2 AS (
    SELECT DISTINCT ON (sp.uid)
           sp.uid,
           pb.id AS via_id,
           COALESCE(NULLIF(btrim(pb.display_name), ''),
                    NULLIF(btrim(concat_ws(' ', pb.first_name, pb.last_name)), ''),
                    'User') AS via_name,
           pb.avatar_url AS via_avatar,
           pb.slug AS via_slug
      FROM second_pairs sp
      JOIN public.profiles pb ON pb.id = sp.via
      CROSS JOIN me
     WHERE pb.discoverable
       AND pb.tenant_id = me.tenant_id
     ORDER BY sp.uid,
              sp.via_since ASC NULLS LAST,
              lower(COALESCE(NULLIF(btrim(pb.display_name), ''),
                             concat_ws(' ', pb.first_name, pb.last_name))) ASC,
              pb.id ASC
  ),
  third_pairs AS (
    SELECT CASE WHEN c.requester_id = sp.uid THEN c.addressee_id
                ELSE c.requester_id END AS uid,
           sp.via,
           sp.via_since
      FROM second_pairs sp
      CROSS JOIN me
      JOIN public.user_connections c
        ON c.status = 'accepted' AND sp.uid IN (c.requester_id, c.addressee_id)
     WHERE sp.uid <> me.id
       AND NOT EXISTS (SELECT 1 FROM mine m WHERE m.peer = sp.uid)
  ),
  third_reach AS (
    SELECT DISTINCT tp.uid FROM third_pairs tp
  ),
  bridge3 AS (
    SELECT DISTINCT ON (tp.uid)
           tp.uid,
           pb.id AS via_id,
           COALESCE(NULLIF(btrim(pb.display_name), ''),
                    NULLIF(btrim(concat_ws(' ', pb.first_name, pb.last_name)), ''),
                    'User') AS via_name,
           pb.avatar_url AS via_avatar,
           pb.slug AS via_slug
      FROM third_pairs tp
      JOIN public.profiles pb ON pb.id = tp.via
      CROSS JOIN me
     WHERE pb.discoverable
       AND pb.tenant_id = me.tenant_id
     ORDER BY tp.uid,
              tp.via_since ASC NULLS LAST,
              pb.id ASC
  ),
  shared_follows AS (
    SELECT f2.user_id AS uid, count(*) AS cnt
      FROM public.eu_policy_follows f1
      JOIN public.eu_policy_follows f2
        ON f2.item_id = f1.item_id AND f2.user_id <> f1.user_id, me
     WHERE f1.user_id = me.id
     GROUP BY f2.user_id
  ),
  shared_events AS (
    SELECT r2.user_id AS uid, count(*) AS cnt
      FROM public.event_rsvps r1
      JOIN public.event_rsvps r2
        ON r2.event_id = r1.event_id AND r2.user_id <> r1.user_id, me
     WHERE r1.user_id = me.id
       AND r1.status IN ('going', 'interested')
       AND r2.status IN ('going', 'interested')
     GROUP BY r2.user_id
  ),
  cand AS (
    SELECT p.*, me.id AS my_id, me.current_company AS my_company,
           me.specialization AS my_specialization, me.location AS my_location,
           me.open_to AS my_open_to
      FROM public.profiles p, me
     WHERE p.tenant_id = me.tenant_id
       AND p.discoverable
       AND p.id <> me.id
       AND NOT EXISTS (SELECT 1 FROM related r WHERE r.uid = p.id)
       AND NOT EXISTS (SELECT 1 FROM dismissed x WHERE x.uid = p.id)
       AND NOT public.is_blocked_pair(me.id, p.id)
       AND public.connections_allowed_from(p.id, me.id)
  )
  SELECT
    c.id AS user_id,
    COALESCE(
      NULLIF(btrim(c.display_name), ''),
      NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
      'User'
    ) AS display_name,
    c.avatar_url,
    c.job_title,
    c.current_company,
    c.specialization,
    c.location,
    c.slug,
    (c.verified_at IS NOT NULL) AS verified,
    COALESCE(mu.cnt, 0) AS mutual_count,
    COALESCE(sf.cnt, 0) AS shared_follows,
    COALESCE(se.cnt, 0) AS shared_events,
    (CASE
      WHEN COALESCE(mu.cnt, 0) > 0 THEN 2
      WHEN t3.uid IS NOT NULL THEN 3
      ELSE 0
    END)::smallint AS degree,
    CASE WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_id
         WHEN t3.uid IS NOT NULL THEN b3.via_id END AS bridge_id,
    CASE WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_name
         WHEN t3.uid IS NOT NULL THEN b3.via_name END AS bridge_name,
    CASE WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_avatar
         WHEN t3.uid IS NOT NULL THEN b3.via_avatar END AS bridge_avatar,
    CASE WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_slug
         WHEN t3.uid IS NOT NULL THEN b3.via_slug END AS bridge_slug,
    c.open_to,
    c.completeness_score
  FROM cand c
  LEFT JOIN mutual mu ON mu.uid = c.id
  LEFT JOIN shared_follows sf ON sf.uid = c.id
  LEFT JOIN shared_events se ON se.uid = c.id
  LEFT JOIN third_reach t3 ON t3.uid = c.id
  LEFT JOIN bridge2 b2 ON b2.uid = c.id
  LEFT JOIN bridge3 b3 ON b3.uid = c.id
  WHERE auth.uid() IS NOT NULL
  ORDER BY
    (COALESCE(mu.cnt, 0) * 3
     + LEAST(COALESCE(sf.cnt, 0), 5) * 2
     + LEAST(COALESCE(se.cnt, 0), 5) * 2
     + CASE WHEN t3.uid IS NOT NULL AND COALESCE(mu.cnt, 0) = 0 THEN 1 ELSE 0 END
     + CASE WHEN COALESCE(btrim(c.current_company), '') <> ''
            AND lower(btrim(c.current_company))
                = lower(btrim(COALESCE(c.my_company, ''))) THEN 2 ELSE 0 END
     + CASE WHEN COALESCE(btrim(c.specialization), '') <> ''
            AND lower(btrim(c.specialization))
                = lower(btrim(COALESCE(c.my_specialization, ''))) THEN 2 ELSE 0 END
     + CASE WHEN COALESCE(btrim(c.location), '') <> ''
            AND lower(btrim(c.location))
                = lower(btrim(COALESCE(c.my_location, ''))) THEN 1 ELSE 0 END
     + CASE WHEN c.open_to && COALESCE(c.my_open_to, '{}'::text[]) THEN 2 ELSE 0 END
     + (COALESCE(c.completeness_score, 0) / 25)
    ) DESC,
    COALESCE(mu.cnt, 0) DESC,
    lower(COALESCE(NULLIF(btrim(c.display_name), ''),
                   concat_ws(' ', c.first_name, c.last_name))) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 24)
$$;

COMMENT ON FUNCTION public.connection_suggestions(integer) IS
  'Osoby, ktore mozesz znac: wspolne kontakty + dossier/wydarzenia + zbieznosc intencji, ze stopniem sieci, mostem i odsiewem swiadomie odrzuconych.';

REVOKE EXECUTE ON FUNCTION public.connection_suggestions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connection_suggestions(integer) TO authenticated, service_role;