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
  v_marker_required_at timestamptz;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', 'checkin');
  IF NOT v_device.offline_roster THEN
    RAISE EXCEPTION 'roster_disabled: the offline roster is not enabled for this scanner credential';
  END IF;
  v_marker_required_at := public._event_scanner_device_note_caps(
    v_device.tenant_id, v_device.id, p_payload->'client_caps'
  );
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
        OR (r.qr_token_hash IS NULL AND r.badge_token_hash IS NULL)
        OR (r.status = 'approved'
            AND r.payment_status NOT IN ('paid', 'partially_refunded', 'not_required')
            AND NOT (r.payment_status = 'unpaid'
                     AND r.decision_source IS NOT DISTINCT FROM 'organizer'))) AS gone,
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
      AND r.status NOT IN ('cancelled', 'rejected')
      AND NOT (r.status = 'approved'
               AND r.payment_status NOT IN ('paid', 'partially_refunded', 'not_required')
               AND NOT (r.payment_status = 'unpaid'
                        AND r.decision_source IS NOT DISTINCT FROM 'organizer'));
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
    'checkpoints', v_checkpoints,
    'queue_marker_required', v_marker_required_at IS NOT NULL
  ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.event_scanner_roster(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_scanner_roster(jsonb) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.event_scanner_roster(jsonb) IS
  'Lista offline skanera: skroty SHA-256 biletow (h), identyfikatorow (bh) i kodow zastapionych (sh) plus minimum danych osoby (bez e-maila, telefonu i stanowiska). Payload: {device_token, since?, after?, limit?<=2000, client_caps?}. Wymaga zgody administratora (offline_roster) i zakresu checkin; pelne pobranie co najmniej co 30 s, z audytem event_scanner_device.roster_downloaded.v1; delta od ostatniego pelnego pobrania z usunietymi zapisami w removed. Przyjete, ale nierozliczone zgloszenie spoza furtki organizatora (decision_source organizer + unpaid) jest usuniete jak zamkniete - ten sam predykat co bramka online (R45, D11); total liczy to samo. client_caps z "queue_marker" przestawia urzadzenie na scisla regule znacznika. Odpowiedz: checkpoints (reentry_policy), queue_marker, queue_marker_required. Unia 20261013900730.';
CREATE OR REPLACE FUNCTION public.admin_event_badge_batch(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_template_id uuid := NULLIF(p_payload->>'template_id', '')::uuid;
  v_ids uuid[];
  v_row record;
  v_token text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;
  SELECT array_agg(value::uuid) INTO v_ids
  FROM jsonb_array_elements_text(COALESCE(p_payload->'person_ids', '[]'::jsonb)) AS value;
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: person_ids is required';
  END IF;
  IF array_length(v_ids, 1) > 200 THEN
    RAISE EXCEPTION 'invalid_payload: at most 200 badges per batch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;
  IF v_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_badge_templates t
    WHERE t.tenant_id = v_tenant AND t.id = v_template_id AND t.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: badge template does not belong to this event';
  END IF;
  FOR v_row IN
    SELECT
      p.id AS person_id,
      p.first_name,
      p.last_name,
      p.job_title,
      COALESCE(NULLIF(btrim(p.company_text), ''), co.name) AS company,
      r.id AS registration_id,
      r.status AS registration_status,
      (r.badge_token_hash IS NOT NULL) AS had_badge,
      r.payment_status,
      r.decision_source,
      tt.name_pl AS ticket_name_pl,
      tt.name_en AS ticket_name_en,
      COALESCE(g.name_pl, dg.name_pl) AS group_name_pl,
      COALESCE(g.name_en, dg.name_en) AS group_name_en,
      COALESCE(g.color, dg.color) AS group_color
    FROM public.event_people p
    LEFT JOIN public.crm_companies co
      ON co.tenant_id = p.tenant_id AND co.id = p.company_id
    LEFT JOIN public.event_registrations r
      ON r.tenant_id = p.tenant_id
     AND r.event_id = v_event_id
     AND r.person_id = p.id
     AND r.status NOT IN ('cancelled', 'rejected')
    LEFT JOIN public.event_ticket_types tt
      ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
    LEFT JOIN public.event_groups g
      ON g.tenant_id = r.tenant_id AND g.id = r.group_id
    LEFT JOIN public.event_groups dg
      ON dg.tenant_id = p.tenant_id AND dg.event_id = v_event_id AND dg.is_default
    WHERE p.tenant_id = v_tenant
      AND p.id = ANY(v_ids)
    ORDER BY p.last_name, p.first_name
  LOOP
    v_token := NULL;
    IF v_row.registration_id IS NOT NULL
       AND (v_row.payment_status IN ('paid', 'partially_refunded', 'not_required')
            OR (v_row.payment_status = 'unpaid'
                AND v_row.decision_source IS NOT DISTINCT FROM 'organizer'
                AND v_row.registration_status IN ('approved', 'attended'))) THEN
      v_token := public._event_new_qr_token();
      UPDATE public.event_registrations
         SET badge_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
             badge_issued_at = now()
       WHERE tenant_id = v_tenant AND id = v_row.registration_id;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'person_id', v_row.person_id,
      'first_name', v_row.first_name,
      'last_name', v_row.last_name,
      'job_title', v_row.job_title,
      'company', v_row.company,
      'registration_id', v_row.registration_id,
      'registration_status', v_row.registration_status,
      'ticket_name_pl', v_row.ticket_name_pl,
      'ticket_name_en', v_row.ticket_name_en,
      'group_name_pl', v_row.group_name_pl,
      'group_name_en', v_row.group_name_en,
      'group_color', v_row.group_color,
      'qr_code', v_token,
      'credential', CASE WHEN v_token IS NULL THEN NULL ELSE 'badge' END,
      'badge_reissued', COALESCE(v_row.had_badge, false)
    ));
  END LOOP;
  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'template_id', v_template_id,
    'issued_at', now(),
    'badges', v_out
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_event_badge_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_batch(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_badge_batch(jsonb) IS
  'Partia identyfikatorow do druku: dane karty plus JAWNY kod identyfikatora (qr_code), ktory wraca RAZ. Druk i przedruk rotuja wylacznie badge_token_hash - bilet z e-maila i portfela zostaje wazny, a poprzedni identyfikator tej osoby daje przy bramce code_superseded. Kod tylko dla zgloszenia rozliczonego (paid/partially_refunded/not_required) albo furtki organizatora (approved/attended + unpaid + decision_source organizer) - R45, D11; pozostali qr_code i credential null. Payload: {event_id, person_ids[<=200], template_id?}. Bramka: assert_event_admin_tenant(). Unia 20261013900730.';