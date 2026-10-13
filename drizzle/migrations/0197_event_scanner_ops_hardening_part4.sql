CREATE OR REPLACE FUNCTION public.event_scanner_roster(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_since timestamptz := NULLIF(p_payload->>'since', '')::timestamptz;
  v_after uuid := NULLIF(p_payload->>'after', '')::uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 2000), 1), 2000);
  v_full boolean := NULLIF(p_payload->>'since', '') IS NULL;
  v_started uuid;
  v_rows jsonb;
  v_removed jsonb;
  v_count integer;
  v_next uuid;
  v_total integer;
  v_checkpoints jsonb;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', 'checkin');

  IF NOT v_device.offline_roster THEN
    RAISE EXCEPTION 'roster_disabled: the offline roster is not enabled for this scanner credential';
  END IF;

  IF v_full AND v_after IS NULL THEN
    UPDATE public.event_scanner_devices d
    SET roster_downloaded_at = now(),
        roster_download_count = d.roster_download_count + 1
    WHERE d.tenant_id = v_device.tenant_id
      AND d.id = v_device.id
      AND (d.roster_downloaded_at IS NULL OR d.roster_downloaded_at <= now() - interval '30 seconds')
    RETURNING d.id INTO v_started;

    IF v_started IS NULL THEN
      RAISE EXCEPTION 'roster_throttled: wait before downloading the full roster again';
    END IF;
  ELSIF v_full THEN
    IF v_device.roster_downloaded_at IS NULL
       OR v_device.roster_downloaded_at < now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'roster_resync_required: start a new full roster download';
    END IF;
  ELSIF v_device.roster_downloaded_at IS NULL
     OR v_since < v_device.roster_downloaded_at - interval '1 second'
     OR v_device.roster_downloaded_at < now() - interval '6 hours' THEN
    RAISE EXCEPTION 'roster_resync_required: the delta cursor is older than the last full download';
  END IF;

  WITH base AS (
    SELECT
      r.id,
      r.qr_token_hash,
      r.badge_token_hash,
      sc.hashes AS superseded_hashes,
      r.status,
      p.first_name,
      p.last_name,
      COALESCE(NULLIF(btrim(p.company_text), ''), co.name) AS company,
      tt.name_pl AS t_pl,
      tt.name_en AS t_en,
      COALESCE(g.name_pl, dg.name_pl) AS g_pl,
      COALESCE(g.name_en, dg.name_en) AS g_en,
      COALESCE(g.color, dg.color) AS gc,
      (bp.printed_at IS NOT NULL) AS bp,
      (r.status IN ('cancelled', 'rejected')
        OR (r.qr_token_hash IS NULL AND r.badge_token_hash IS NULL)) AS gone,
      GREATEST(r.updated_at, p.updated_at, tt.updated_at, g.updated_at, dg.updated_at, bp.printed_at)
        AS changed_at
    FROM public.event_registrations r
    JOIN public.event_people p
      ON p.tenant_id = r.tenant_id AND p.id = r.person_id
    LEFT JOIN public.crm_companies co
      ON co.tenant_id = p.tenant_id AND co.id = p.company_id
    LEFT JOIN public.event_ticket_types tt
      ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
    LEFT JOIN public.event_groups g
      ON g.tenant_id = r.tenant_id AND g.id = r.group_id
    LEFT JOIN LATERAL (
      SELECT dgr.name_pl, dgr.name_en, dgr.color, dgr.updated_at
      FROM public.event_groups dgr
      WHERE dgr.tenant_id = r.tenant_id
        AND dgr.event_id = r.event_id
        AND dgr.is_default
      ORDER BY dgr.id
      LIMIT 1
    ) dg ON true
    LEFT JOIN LATERAL (
      SELECT max(bpr.printed_at) AS printed_at
      FROM public.event_badge_prints bpr
      WHERE bpr.tenant_id = r.tenant_id
        AND bpr.event_id = r.event_id
        AND bpr.person_id = r.person_id
    ) bp ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(s.code_hash ORDER BY s.superseded_at, s.code_hash) AS hashes
      FROM public.event_superseded_codes s
      WHERE s.tenant_id = r.tenant_id
        AND s.registration_id = r.id
    ) sc ON true
    WHERE r.tenant_id = v_device.tenant_id
      AND r.event_id = v_device.event_id
  ),
  page AS (
    SELECT b.*
    FROM base b
    WHERE (v_after IS NULL OR b.id > v_after)
      AND CASE
        WHEN v_full THEN NOT b.gone
        ELSE b.changed_at > v_since - interval '1 minute'
      END
    ORDER BY b.id
    LIMIT v_limit
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'r', pg.id,
          'h', pg.qr_token_hash,
          'bh', pg.badge_token_hash,
          'sh', pg.superseded_hashes,
          's', pg.status,
          'fn', pg.first_name,
          'ln', pg.last_name,
          'co', pg.company,
          't_pl', pg.t_pl,
          't_en', pg.t_en,
          'g_pl', pg.g_pl,
          'g_en', pg.g_en,
          'gc', pg.gc,
          'bp', pg.bp
        ) ORDER BY pg.id
      ) FILTER (WHERE NOT pg.gone),
      '[]'::jsonb
    ),
    COALESCE(jsonb_agg(to_jsonb(pg.id) ORDER BY pg.id) FILTER (WHERE pg.gone), '[]'::jsonb),
    count(*)::integer,
    (array_agg(pg.id ORDER BY pg.id DESC))[1]
  INTO v_rows, v_removed, v_count, v_next
  FROM page pg;

  IF v_count < v_limit THEN
    v_next := NULL;
  END IF;

  IF v_started IS NOT NULL THEN
    SELECT count(*)::integer INTO v_total
    FROM public.event_registrations r
    WHERE r.tenant_id = v_device.tenant_id
      AND r.event_id = v_device.event_id
      AND (r.qr_token_hash IS NOT NULL OR r.badge_token_hash IS NOT NULL)
      AND r.status NOT IN ('cancelled', 'rejected');

    PERFORM public.emit_domain_event(
      v_device.tenant_id,
      'event_scanner_device',
      v_device.id::text,
      'event_scanner_device.roster_downloaded.v1',
      jsonb_build_object(
        'event_id', v_device.event_id,
        'device_id', v_device.id,
        'label', v_device.label,
        'token_prefix', v_device.token_prefix,
        'rows', v_total
      ),
      NULL::uuid
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('id', cp.id, 'reentry_policy', cp.reentry_policy) ORDER BY cp.id),
    '[]'::jsonb
  )
  INTO v_checkpoints
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = v_device.tenant_id
    AND cp.event_id = v_device.event_id
    AND cp.is_active
    AND (v_device.checkpoint_id IS NULL OR cp.id = v_device.checkpoint_id);

  RETURN jsonb_build_object(
    'generated_at', now(),
    'full', v_full,
    'total', v_total,
    'next_after', v_next,
    'rows', v_rows,
    'removed', v_removed,
    'checkpoints', v_checkpoints
  ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.event_scanner_roster(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_scanner_roster(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_scanner_roster(jsonb) IS
  'Lista offline skanera: skroty SHA-256 biletow (h), identyfikatorow (bh) i kodow zastapionych (sh) plus minimum danych osoby (bez e-maila, telefonu i stanowiska). Payload: {device_token, since?, after?, limit?<=2000}. Wymaga zgody administratora (offline_roster) i zakresu checkin; pelne pobranie co najmniej co 30 s, z audytem event_scanner_device.roster_downloaded.v1; delta od ostatniego pelnego pobrania z usunietymi zapisami w removed. Odpowiedz: checkpoints (reentry_policy) i queue_marker.';

CREATE OR REPLACE FUNCTION public.event_scanner_bootstrap(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_event public.events;
  v_checkpoints jsonb;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', NULL);

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_device.tenant_id AND e.id = v_device.event_id;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sort_order', x->>'name_pl'), '[]'::jsonb)
  INTO v_checkpoints
  FROM (
    SELECT jsonb_build_object(
      'id', cp.id,
      'name_pl', cp.name_pl,
      'name_en', cp.name_en,
      'kind', cp.kind,
      'direction_mode', cp.direction_mode,
      'access_mode', cp.access_mode,
      'reentry_policy', cp.reentry_policy,
      'capacity', cp.capacity,
      'dedupe_window_seconds', cp.dedupe_window_seconds,
      'sort_order', cp.sort_order
    ) AS x
    FROM public.event_checkpoints cp
    WHERE cp.tenant_id = v_device.tenant_id
      AND cp.event_id = v_device.event_id
      AND cp.is_active
      AND (v_device.checkpoint_id IS NULL OR cp.id = v_device.checkpoint_id)
  ) src;

  RETURN jsonb_build_object(
    'device_id', v_device.id,
    'label', v_device.label,
    'scopes', to_jsonb(v_device.scopes),
    'expires_at', v_device.expires_at,
    'pinned_checkpoint_id', v_device.checkpoint_id,
    'sponsor_id', v_device.sponsor_id,
    'server_now', now(),
    'offline_roster', v_device.offline_roster,
    'roster_downloaded_at', v_device.roster_downloaded_at,
    'event', jsonb_build_object(
      'id', v_event.id,
      'slug', v_event.slug,
      'title_pl', v_event.title_pl,
      'title_en', v_event.title_en,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at,
      'timezone', v_event.timezone
    ),
    'checkpoints', v_checkpoints
  ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.event_scanner_bootstrap(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_scanner_bootstrap(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_scanner_bootstrap(jsonb) IS
  'Konfiguracja skanera po sparowaniu: wydarzenie, dostepne punkty odprawy (z reentry_policy), zakresy uprawnien, termin waznosci tokenu, zegar serwera (server_now), stan listy offline i znacznik kolejki (queue_marker, queue_marker_valid_until). Payload: {device_token}. Bramka: hasz tokenu urzadzenia.';