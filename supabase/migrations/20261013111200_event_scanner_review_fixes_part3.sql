-- events-harness: include
-- ============================================================================
-- WYDARZENIA: SKANER - POPRAWKI PO PRZEGLADZIE, CZESC 3/4: PLASZCZYZNA
-- URZADZENIA (ODPRAWA, LEAD, KONFIGURACJA, LISTA OFFLINE).
--
-- Opis ustalen - w naglowku 20261013111000. Sygnatury i ACL bez zmian.
--
-- ZMIANA:
--   * `event_checkin_record` (cialo z 20261013110700):
--       - R4: skan Z KOLEJKI kodu zastapionego PO chwili skanu (czas skanu
--         przyciety do now() < superseded_at) jest oceniany jako kod wazny -
--         idzie do zapisu jak kazdy inny ("decyzja na chwile skanu, nie
--         synchronizacji"). Kod martwy JUZ w chwili skanu, a wpuszczony
--         offline, zapisuje prawdziwa odmowe `denied_code_superseded`
--         z offline_admitted = true (konflikt admitted_offline w dzienniku),
--         zamiast wracac bez wiersza; odpowiedz niesie `superseded`. Pozostale
--         skany kodu zastapionego - jak dotad code_superseded bez wiersza;
--       - R12: nieznany kod z kolejki zwraca `queue_locked` (blokada SAMEJ
--         kolejki), a `device_locked` dotyczy juz tylko blokady na zywo;
--       - skan z kolejki bez czasu urzadzenia jest dla bramki synchronizacji
--         skanem z chwili synchronizacji (blokada kolejki go obejmuje);
--   * `event_lead_scan_record` (cialo z 20261013110700): R4 jak wyzej (lead
--     zeskanowany przed przedrukiem zostaje zapisany), R12 jak wyzej;
--   * `event_scanner_bootstrap` (cialo z 20261013110800): `client_caps`
--     z "queue_marker" ustawia queue_marker_required_at (R0/R11); odpowiedz
--     niesie `queue_marker_required`;
--   * `event_scanner_roster` (cialo z 20261013110800): to samo dla
--     `client_caps`; odpowiedz niesie `queue_marker_required`.
--
-- IDEMPOTENTNA: CREATE OR REPLACE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ZAPIS ODPRAWY Z URZADZENIA
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_checkin_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_code text := btrim(COALESCE(p_payload->>'code', ''));
  v_checkpoint_id uuid;
  v_cp public.event_checkpoints;
  v_direction text;
  v_reg record;
  v_locked boolean := false;
  v_queue_locked boolean := false;
  v_source text;
  v_client_uid text := NULLIF(btrim(COALESCE(p_payload->>'client_scan_uid', '')), '');
  v_device_at timestamptz := NULLIF(p_payload->>'device_scanned_at', '')::timestamptz;
  v_marker text := NULLIF(btrim(COALESCE(p_payload->>'queue_marker', '')), '');
  v_offline_outcome text := NULLIF(lower(btrim(COALESCE(p_payload->>'offline_outcome', ''))), '');
  v_offline_admitted boolean;
  v_offline_denied text;
  v_code_denied text;
  v_roster_at timestamptz := NULLIF(p_payload->>'roster_generated_at', '')::timestamptz;
  -- Skan z decyzja offline zawsze pochodzi z kolejki.
  v_queued boolean := lower(COALESCE(p_payload->>'queued', '')) IN ('true', 't', '1')
    OR NULLIF(btrim(COALESCE(p_payload->>'offline_outcome', '')), '') IS NOT NULL;
  v_result jsonb;
BEGIN
  -- Okno 72 h, znacznik kolejki i blokada kolejki dotycza tylko skanu
  -- z kolejki: bramka synchronizacji rozpoznaje go po czasie urzadzenia
  -- (skan z kolejki bez czasu = chwila synchronizacji).
  v_device := public._event_scanner_device_auth_sync(
    p_payload->>'device_token', 'checkin',
    CASE WHEN v_queued THEN COALESCE(v_device_at, now()) END,
    CASE WHEN v_queued THEN v_marker END
  );

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;

  IF v_offline_outcome IS NOT NULL AND v_offline_outcome NOT IN (
    'granted', 'denied_direction', 'denied_registration_status', 'unknown_code', 'repeat',
    'denied_already_inside'
  ) THEN
    RAISE EXCEPTION 'invalid_payload: unknown offline_outcome %', v_offline_outcome;
  END IF;
  IF v_offline_outcome IS NOT NULL THEN
    v_offline_admitted := lower(COALESCE(p_payload->>'offline_admitted', '')) IN ('true', 't', '1');
    -- Zgoda i powtorzenie to z definicji wpuszczenie (`decideOffline`);
    -- "zgoda, ale nie wpuscilem" to ladunek sprzeczny, nie decyzja.
    IF NOT v_offline_admitted AND v_offline_outcome IN ('granted', 'repeat') THEN
      RAISE EXCEPTION 'invalid_payload: offline_outcome % requires offline_admitted', v_offline_outcome;
    END IF;
    IF NOT v_offline_admitted THEN
      v_offline_denied := CASE v_offline_outcome
        WHEN 'unknown_code' THEN 'denied_not_registered'
        ELSE v_offline_outcome
      END;
    END IF;
  END IF;

  v_checkpoint_id := COALESCE(
    NULLIF(p_payload->>'checkpoint_id', '')::uuid,
    v_device.checkpoint_id
  );
  IF v_checkpoint_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: checkpoint_id is required for a device without a pinned checkpoint';
  END IF;
  IF v_device.checkpoint_id IS NOT NULL AND v_checkpoint_id <> v_device.checkpoint_id THEN
    RAISE EXCEPTION 'device_checkpoint_mismatch: this credential is pinned to another checkpoint';
  END IF;

  SELECT cp.* INTO v_cp
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = v_device.tenant_id
    AND cp.event_id = v_device.event_id
    AND cp.id = v_checkpoint_id;
  IF v_cp.id IS NULL THEN
    RAISE EXCEPTION 'checkpoint_not_found: checkpoint does not exist in this event';
  END IF;

  v_direction := lower(btrim(COALESCE(
    p_payload->>'direction',
    CASE v_cp.direction_mode WHEN 'out_only' THEN 'out' ELSE 'in' END
  )));

  v_source := CASE
    WHEN lower(COALESCE(p_payload->>'self_service', '')) IN ('true', 't', '1')
      THEN 'self_service'
    ELSE 'qr_code'
  END;

  SELECT l.* INTO v_reg
  FROM public._event_scanner_code_lookup(v_device.tenant_id, v_code) l;

  IF v_reg.registration_id IS NULL THEN
    IF v_queued THEN
      -- Skan z kolejki: wlasne okno i wlasna blokada (R12) - skanowanie na
      -- zywo dziala dalej, wiec device_locked zostaje false.
      v_queue_locked := public._event_scanner_device_note_queue_failure(v_device.id);
    ELSE
      v_locked := public._event_scanner_device_note_failure(v_device.id);
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'unknown_code',
      'admit', false,
      'result', NULL,
      'device_locked', v_locked,
      'queue_locked', v_queue_locked,
      'person', NULL
    ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object(
      'outcome', 'wrong_event',
      'admit', false,
      'result', NULL,
      'device_locked', false,
      'other_event', (
        SELECT jsonb_build_object('title_pl', e.title_pl, 'title_en', e.title_en)
        FROM public.events e
        WHERE e.tenant_id = v_device.tenant_id AND e.id = v_reg.event_id
      ),
      'person', NULL
    ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
  END IF;

  IF v_reg.superseded THEN
    IF v_queued AND v_device_at IS NOT NULL
       AND LEAST(v_device_at, now()) < v_reg.superseded_at THEN
      -- R4: w chwili SKANU kod byl wazny (zastapiono go pozniej, np.
      -- przedruk w trakcie pracy bramki bez sieci) - zapis jak kazdy inny.
      NULL;
    ELSIF v_queued AND v_offline_admitted IS TRUE THEN
      -- R4: bramka wpuscila offline kod martwy juz w chwili skanu: wiersz
      -- z prawdziwa odmowa serwera i offline_admitted = true (konflikt
      -- admitted_offline), nie cichy powrot bez sladu.
      v_code_denied := 'denied_code_superseded';
      UPDATE public.event_scanner_devices
      SET superseded_scan_count = superseded_scan_count + 1
      WHERE tenant_id = v_device.tenant_id AND id = v_device.id;
    ELSE
      -- Kod zastapiony: rozpoznany, wiec poza oknem blokady; bez wiersza
      -- w dzienniku (jak nieznany kod). Imie i nazwisko tylko w terminie
      -- poswiadczenia - okno 72 h nie oddaje danych osoby.
      RETURN public._event_scanner_superseded_reply(
        v_device.tenant_id, v_device.id, v_reg.person_id, v_reg.credential,
        v_reg.superseded_reason, v_reg.superseded_at, v_device.expires_at > now()
      ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
    END IF;
  END IF;

  UPDATE public.event_scanner_devices
  SET scan_count = scan_count + 1
  WHERE tenant_id = v_device.tenant_id AND id = v_device.id;

  v_result := public._event_checkin_write(
    v_device.tenant_id,
    v_device.event_id,
    v_checkpoint_id,
    v_reg.person_id,
    v_direction,
    v_source,
    v_device.id,
    NULL,
    v_client_uid,
    v_device_at,
    NULL,
    v_offline_denied,
    false,
    v_code_denied
  );

  -- Poswiadczenie po terminie przeszlo WYLACZNIE dzieki oknu synchronizacji:
  -- zapis zostaje, ale karta osoby nie wraca na wygasle urzadzenie.
  IF v_device.expires_at <= now() THEN
    v_result := jsonb_set(v_result, '{person}', 'null'::jsonb);
  END IF;

  IF v_offline_outcome IS NOT NULL THEN
    UPDATE public.event_checkins c
    SET offline_admitted = CASE
          WHEN c.offline_admitted IS TRUE THEN true
          ELSE v_offline_admitted
        END,
        offline_outcome = COALESCE(c.offline_outcome, v_offline_outcome),
        roster_generated_at = COALESCE(c.roster_generated_at, v_roster_at)
    WHERE c.tenant_id = v_device.tenant_id
      AND c.event_id = v_device.event_id
      AND c.id = (v_result->>'checkin_id')::uuid;
  END IF;

  RETURN v_result
    || jsonb_build_object('credential', v_reg.credential)
    || CASE
      WHEN v_code_denied IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('superseded', jsonb_build_object(
        'credential', v_reg.credential,
        'reason', v_reg.superseded_reason,
        'superseded_at', v_reg.superseded_at
      ))
    END
    || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.event_checkin_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_checkin_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_checkin_record(jsonb) IS
  'Zapis odprawy z urzadzenia. Payload: {device_token, code, checkpoint_id?, direction?, client_scan_uid?, device_scanned_at?, self_service?, queued?, queue_marker?, offline_admitted?, offline_outcome?, roster_generated_at?}. Wejsciem jest TOKEN (bilet albo identyfikator), nigdy person_id. Kod zastapiony: code_superseded, poza oknem blokady - chyba ze skan z kolejki byl sprzed zastapienia (zapis jak kodu waznego) albo bramka wpuscila offline kod juz martwy (wiersz denied_code_superseded, konflikt). Idempotencja: client_scan_uid plus okno punktu. Wygasle poswiadczenie przyjmuje skan z kolejki sprzed terminu przez 72 h (ze znacznikiem kolejki, gdy urzadzenie go zadeklarowalo; bez karty osoby). Nieznane kody z kolejki: queue_locked (blokada samej kolejki). Odpowiedz: reentry, reentry_previous_at, reentry_override, credential, queue_marker.';

-- ----------------------------------------------------------------------------
-- 2) ZAPIS LEADU NA STOISKU
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_lead_scan_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_code text := btrim(COALESCE(p_payload->>'code', ''));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_rating smallint := NULLIF(p_payload->>'interest_rating', '')::smallint;
  v_device_at timestamptz := NULLIF(p_payload->>'device_scanned_at', '')::timestamptz;
  v_marker text := NULLIF(btrim(COALESCE(p_payload->>'queue_marker', '')), '');
  v_queued boolean := lower(COALESCE(p_payload->>'queued', '')) IN ('true', 't', '1');
  v_reg record;
  v_person public.event_people;
  v_consent_at timestamptz;
  v_lead_id uuid;
  v_count integer;
  v_locked boolean := false;
  v_queue_locked boolean := false;
  v_grace boolean;
BEGIN
  v_device := public._event_scanner_device_auth_sync(
    p_payload->>'device_token', 'lead',
    CASE WHEN v_queued THEN COALESCE(v_device_at, now()) END,
    CASE WHEN v_queued THEN v_marker END
  );
  v_grace := v_device.expires_at <= now();

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'invalid_payload: note is longer than 2000 characters';
  END IF;
  IF v_rating IS NOT NULL AND v_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_payload: interest_rating must be between 1 and 5';
  END IF;

  SELECT l.* INTO v_reg
  FROM public._event_scanner_code_lookup(v_device.tenant_id, v_code) l;

  IF v_reg.registration_id IS NULL THEN
    IF v_queued THEN
      v_queue_locked := public._event_scanner_device_note_queue_failure(v_device.id);
    ELSE
      v_locked := public._event_scanner_device_note_failure(v_device.id);
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'unknown_code', 'device_locked', v_locked, 'queue_locked', v_queue_locked,
      'person', NULL
    ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object(
      'outcome', 'wrong_event', 'device_locked', false, 'person', NULL
    ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
  END IF;

  -- R4: lead zeskanowany z kolejki ZANIM kod zastapiono jest leadem kodu
  -- waznego. Kazdy inny skan kodu zastapionego: bez leada i BEZ tozsamosci
  -- (na stoisku tozsamosc wymaga zgody partnerskiej, a kod zastapiony nie
  -- jest okazja, zeby ja ominac).
  IF v_reg.superseded AND NOT (
    v_queued AND v_device_at IS NOT NULL
    AND LEAST(v_device_at, now()) < v_reg.superseded_at
  ) THEN
    RETURN public._event_scanner_superseded_reply(
      v_device.tenant_id, v_device.id, v_reg.person_id, v_reg.credential,
      v_reg.superseded_reason, v_reg.superseded_at, false
    ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
  END IF;

  SELECT p.* INTO v_person
  FROM public.event_people p
  WHERE p.tenant_id = v_device.tenant_id AND p.id = v_reg.person_id;

  -- OPS-01: zgoda udzielona NA TO wydarzenie w zgloszeniu, niewycofana -
  -- nie globalny stempel osoby z dowolnego wydarzenia.
  v_consent_at := public._event_partner_consent_at(
    v_device.tenant_id, v_device.event_id, v_reg.person_id
  );

  INSERT INTO public.event_lead_scans (
    tenant_id, event_id, sponsor_id, person_id, registration_id,
    checkpoint_id, device_id, first_scanned_at, last_scanned_at, scan_count,
    note, interest_rating, consent_snapshot_at
  ) VALUES (
    v_device.tenant_id, v_device.event_id, v_device.sponsor_id, v_reg.person_id, v_reg.registration_id,
    v_device.checkpoint_id, v_device.id, now(), now(), 1,
    v_note, v_rating, v_consent_at
  )
  ON CONFLICT (tenant_id, sponsor_id, person_id) DO UPDATE
  SET last_scanned_at = now(),
      scan_count = event_lead_scans.scan_count + 1,
      note = COALESCE(EXCLUDED.note, event_lead_scans.note),
      interest_rating = COALESCE(EXCLUDED.interest_rating, event_lead_scans.interest_rating),
      consent_snapshot_at = EXCLUDED.consent_snapshot_at,
      registration_id = COALESCE(EXCLUDED.registration_id, event_lead_scans.registration_id)
  RETURNING id, scan_count INTO v_lead_id, v_count;

  RETURN jsonb_build_object(
    'outcome', 'saved',
    'lead_id', v_lead_id,
    'scan_count', v_count,
    'consent', (v_consent_at IS NOT NULL),
    'person', CASE
      WHEN v_consent_at IS NULL OR v_grace THEN NULL
      ELSE jsonb_build_object(
        'first_name', v_person.first_name,
        'last_name', v_person.last_name,
        'company', COALESCE(
          NULLIF(btrim(v_person.company_text), ''),
          (SELECT co.name FROM public.crm_companies co
            WHERE co.tenant_id = v_person.tenant_id AND co.id = v_person.company_id)
        ),
        'job_title', v_person.job_title,
        'email', v_person.email,
        'phone', v_person.phone
      )
    END
  ) || public._event_scanner_queue_marker_reply(v_device.id, v_device.queue_secret, v_device.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.event_lead_scan_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_lead_scan_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_lead_scan_record(jsonb) IS
  'Skan leada na stoisku. Payload: {device_token, code, note?, interest_rating?, device_scanned_at?, queued?, queue_marker?}. Wlasciciel leada pochodzi z POSWIADCZENIA (event_scanner_devices.sponsor_id). Zgoda: _event_partner_consent_at - zgoda NA TO wydarzenie; bez niej potwierdza zapis, ale NIE oddaje tozsamosci. Kod zastapiony: code_superseded bez leada i bez tozsamosci - chyba ze skan z kolejki byl sprzed zastapienia (lead kodu waznego). Wygasle poswiadczenie przyjmuje skan z kolejki sprzed terminu przez 72 h (ze znacznikiem kolejki, gdy urzadzenie go zadeklarowalo) - bez danych osoby w odpowiedzi. Nieznane kody z kolejki: queue_locked (blokada samej kolejki).';

-- ----------------------------------------------------------------------------
-- 3) LISTA OFFLINE (plaszczyzna urzadzenia)
--
-- Cialo z 20261013110800; zmiana: `client_caps` (R0/R11) i
-- `queue_marker_required` w odpowiedzi. Payload: {device_token, since?,
-- after?, limit?, client_caps?}.
-- ----------------------------------------------------------------------------
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

  -- Polityka ponownego wejscia punktow, ktore to urzadzenie obsluguje -
  -- zmiana w trakcie wydarzenia dociera z kolejna delta, bez bootstrapu.
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
  'Lista offline skanera: skroty SHA-256 biletow (h), identyfikatorow (bh) i kodow zastapionych (sh) plus minimum danych osoby (bez e-maila, telefonu i stanowiska). Payload: {device_token, since?, after?, limit?<=2000, client_caps?}. Wymaga zgody administratora (offline_roster) i zakresu checkin; pelne pobranie co najmniej co 30 s, z audytem event_scanner_device.roster_downloaded.v1; delta od ostatniego pelnego pobrania z usunietymi zapisami w removed. client_caps z "queue_marker" przestawia urzadzenie na scisla regule znacznika. Odpowiedz: checkpoints (reentry_policy), queue_marker, queue_marker_required.';

-- ----------------------------------------------------------------------------
-- 4) KONFIGURACJA SKANERA
--
-- Cialo z 20261013110800; zmiana: `client_caps` (R0/R11) i
-- `queue_marker_required` w odpowiedzi. Payload: {device_token, client_caps?}.
-- ----------------------------------------------------------------------------
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
  v_marker_required_at timestamptz;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', NULL);

  v_marker_required_at := public._event_scanner_device_note_caps(
    v_device.tenant_id, v_device.id, p_payload->'client_caps'
  );

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
    'queue_marker_required', v_marker_required_at IS NOT NULL,
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
  'Konfiguracja skanera po sparowaniu: wydarzenie (ze strefa czasowa - granica dnia regul ponownego wejscia), dostepne punkty odprawy (z reentry_policy), zakresy uprawnien, termin waznosci tokenu, zegar serwera (server_now), stan listy offline i znacznik kolejki (queue_marker, queue_marker_valid_until, queue_marker_required). Payload: {device_token, client_caps?}; client_caps z "queue_marker" przestawia urzadzenie na scisla regule znacznika po terminie (nieodwracalnie). Bramka: hasz tokenu urzadzenia.';
