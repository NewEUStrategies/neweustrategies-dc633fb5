-- CZESC 2/2 MIGRACJI 0062_event_scanner_offline.sql
-- migration-split: part 2/2 of 0062_event_scanner_offline.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 0062_event_scanner_offline.sql,
-- potem 0062_event_scanner_offline_part2.sql .. 0062_event_scanner_offline_part2.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.

-- ----------------------------------------------------------------------------
-- 8) LISTA OFFLINE (plaszczyzna urzadzenia)
--
-- Payload: {device_token, since?, after?, limit?}.
--   * bez `since` - PELNA lista aktywnych zapisow z tokenem; pierwsza strona
--     (bez `after`) to start pobrania: dlawik 30 s, licznik, zdarzenie
--     audytowe; kolejne strony tylko do 10 min od startu;
--   * z `since` (wartosc `generated_at` z poprzedniej odpowiedzi, nie
--     starsza niz ostatnie pelne pobranie) - zapisy zmienione od tej chwili
--     (z zakladka 1 min na transakcje w locie): aktywne w `rows`, anulowane,
--     odrzucone albo bez tokenu w `removed`.
-- Wiersz: r (id zapisu), h (sha256 tokenu), s (status), fn, ln, co (firma),
-- t_pl/t_en (bilet), g_pl/g_en/gc (grupa i kolor), bp (identyfikator wydany).
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
      (r.status IN ('cancelled', 'rejected') OR r.qr_token_hash IS NULL) AS gone,
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
      AND r.qr_token_hash IS NOT NULL
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

  RETURN jsonb_build_object(
    'generated_at', now(),
    'full', v_full,
    'total', v_total,
    'next_after', v_next,
    'rows', v_rows,
    'removed', v_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_scanner_roster(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_scanner_roster(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_scanner_roster(jsonb) IS
  'Lista offline skanera: skroty SHA-256 tokenow biletow wydarzenia plus minimum danych osoby (bez e-maila, telefonu i stanowiska). Payload: {device_token, since?, after?, limit?<=2000}. Wymaga zgody administratora (offline_roster) i zakresu checkin; pelne pobranie co najmniej co 30 s, z audytem event_scanner_device.roster_downloaded.v1; delta od ostatniego pelnego pobrania z usunietymi zapisami w removed.';

-- ----------------------------------------------------------------------------
-- 9) PANEL: WYDANIE POSWIADCZENIA Z LISTA OFFLINE
--
-- Cialo z 20260825055113; zmiany: `offline_roster` z ladunku (tylko razem
-- z zakresem checkin), w zapisie, odpowiedzi i zdarzeniu; bramka modulu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_issue(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_label text := btrim(COALESCE(p_payload->>'label', ''));
  v_checkpoint_id uuid := NULLIF(p_payload->>'checkpoint_id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_scopes text[];
  v_expires timestamptz := NULLIF(p_payload->>'expires_at', '')::timestamptz;
  v_offline boolean := lower(COALESCE(p_payload->>'offline_roster', '')) IN ('true', 't', '1');
  v_event public.events;
  v_token text;
  v_id uuid;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.id = v_event_id;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF char_length(v_label) < 2 THEN
    RAISE EXCEPTION 'invalid_label: the label must have at least 2 characters';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT lower(btrim(s))), ARRAY['checkin']::text[])
  INTO v_scopes
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'scopes') = 'array' THEN p_payload->'scopes'
      ELSE '["checkin"]'::jsonb
    END
  ) AS t(s)
  WHERE lower(btrim(s)) IN ('checkin', 'lead', 'badge_print');

  IF array_length(v_scopes, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_scopes: at least one known scope is required';
  END IF;

  IF v_checkpoint_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_checkpoints cp
    WHERE cp.tenant_id = v_tenant AND cp.event_id = v_event_id AND cp.id = v_checkpoint_id
  ) THEN
    RAISE EXCEPTION 'checkpoint_not_in_event: the checkpoint belongs to another event';
  END IF;

  IF 'lead' = ANY (v_scopes) THEN
    IF v_sponsor_id IS NULL THEN
      RAISE EXCEPTION 'sponsor_required: a lead-retrieval credential must name its sponsor';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.event_sponsors sp
      WHERE sp.tenant_id = v_tenant AND sp.event_id = v_event_id AND sp.id = v_sponsor_id
    ) THEN
      RAISE EXCEPTION 'sponsor_not_in_event: the sponsor belongs to another event';
    END IF;
  ELSE
    v_sponsor_id := NULL;
  END IF;

  -- Lista offline sluzy wylacznie odprawie - bez zakresu checkin nie ma
  -- czemu sluzyc, a dane osob nie jada na urzadzenie "na zapas".
  v_offline := v_offline AND 'checkin' = ANY (v_scopes);

  IF v_expires IS NULL THEN
    v_expires := COALESCE(v_event.ends_at, v_event.starts_at, now()) + interval '24 hours';
    IF v_expires <= now() THEN
      v_expires := now() + interval '48 hours';
    END IF;
  END IF;

  IF v_expires <= now() THEN
    RAISE EXCEPTION 'invalid_expiry: the credential must expire in the future';
  END IF;

  v_token := public._event_new_scanner_token();

  INSERT INTO public.event_scanner_devices (
    tenant_id, event_id, checkpoint_id, sponsor_id, label,
    token_hash, token_prefix, scopes, is_active, expires_at, created_by, offline_roster
  ) VALUES (
    v_tenant, v_event_id, v_checkpoint_id, v_sponsor_id, v_label,
    encode(digest(v_token, 'sha256'), 'hex'), left(v_token, 8), v_scopes,
    true, v_expires, auth.uid(), v_offline
  )
  RETURNING id INTO v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_scanner_device',
    v_id::text,
    'event_scanner_device.issued.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'device_id', v_id,
      'label', v_label,
      'token_prefix', left(v_token, 8),
      'scopes', to_jsonb(v_scopes),
      'expires_at', v_expires,
      'offline_roster', v_offline
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'device_id', v_id,
    'label', v_label,
    'token', v_token,
    'token_prefix', left(v_token, 8),
    'scopes', to_jsonb(v_scopes),
    'expires_at', v_expires,
    'checkpoint_id', v_checkpoint_id,
    'sponsor_id', v_sponsor_id,
    'offline_roster', v_offline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_issue(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_issue(jsonb) IS
  'Wydanie poswiadczenia urzadzenia skanujacego. Payload: {event_id, label, scopes[], checkpoint_id?, sponsor_id?, expires_at?, offline_roster?}. TOKEN JAWNY WRACA DOKLADNIE RAZ. Lista offline tylko z zakresem checkin. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 10) PANEL: WLACZENIE / WYLACZENIE LISTY OFFLINE NA URZADZENIU
--
-- Wylaczenie dziala przy nastepnym kontakcie urzadzenia z baza: pobranie
-- listy konczy sie `roster_disabled:`, a klient kasuje swoja kopie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_set_offline(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'device_id', '')::uuid;
  v_enabled boolean := lower(COALESCE(p_payload->>'offline_roster', '')) IN ('true', 't', '1');
  v_row public.event_scanner_devices;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: device_id is required';
  END IF;

  IF NOT (p_payload ? 'offline_roster') THEN
    RAISE EXCEPTION 'invalid_payload: offline_roster is required';
  END IF;

  SELECT d.* INTO v_row
  FROM public.event_scanner_devices d
  WHERE d.id = v_id AND d.tenant_id = v_tenant
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: scanner credential does not exist in this organisation';
  END IF;

  IF v_enabled AND v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'device_revoked: a revoked credential cannot receive the offline roster';
  END IF;

  IF v_enabled AND NOT ('checkin' = ANY (v_row.scopes)) THEN
    RAISE EXCEPTION 'invalid_scopes: the offline roster requires the checkin scope';
  END IF;

  IF v_row.offline_roster IS DISTINCT FROM v_enabled THEN
    UPDATE public.event_scanner_devices
    SET offline_roster = v_enabled
    WHERE id = v_id AND tenant_id = v_tenant;

    PERFORM public.emit_domain_event(
      v_tenant,
      'event_scanner_device',
      v_row.id::text,
      'event_scanner_device.offline_changed.v1',
      jsonb_build_object(
        'event_id', v_row.event_id,
        'device_id', v_row.id,
        'label', v_row.label,
        'token_prefix', v_row.token_prefix,
        'offline_roster', v_enabled
      ),
      auth.uid()
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_set_offline(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_set_offline(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_set_offline(jsonb) IS
  'Zgoda na liste offline na urzadzeniu (wlaczenie / wylaczenie). Payload: {device_id, offline_roster}. Wlaczenie wymaga zakresu checkin i nie dziala na uniewaznionym poswiadczeniu. Zmiana emituje event_scanner_device.offline_changed.v1. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 11) PANEL: LISTA URZADZEN Z KOLUMNAMI LISTY OFFLINE
--
-- Cialo z 20260825055113 plus trzy kolumny; RETURNS TABLE sie zmienia,
-- wiec DROP + CREATE (ACL odtworzony nizej).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_scanner_devices_list(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_scanner_devices_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  label text,
  token_prefix text,
  scopes text[],
  checkpoint_id uuid,
  checkpoint_name_pl text,
  checkpoint_name_en text,
  sponsor_id uuid,
  sponsor_name text,
  state text,
  is_active boolean,
  expires_at timestamptz,
  revoked_at timestamptz,
  locked_until timestamptz,
  last_seen_at timestamptz,
  scan_count integer,
  failed_scan_count integer,
  last_failed_scan_at timestamptz,
  fail_window_count integer,
  checkins_count integer,
  lead_scans_count integer,
  created_at timestamptz,
  offline_roster boolean,
  roster_downloaded_at timestamptz,
  roster_download_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT
    d.id, d.event_id, d.label, d.token_prefix, d.scopes,
    d.checkpoint_id, cp.name_pl, cp.name_en,
    d.sponsor_id, sp.snapshot_name,
    CASE
      WHEN d.revoked_at IS NOT NULL THEN 'revoked'
      WHEN d.locked_until IS NOT NULL AND d.locked_until > now() THEN 'locked'
      WHEN d.expires_at <= now() THEN 'expired'
      WHEN NOT d.is_active THEN 'paused'
      ELSE 'active'
    END,
    d.is_active, d.expires_at, d.revoked_at, d.locked_until, d.last_seen_at,
    d.scan_count, d.failed_scan_count, d.last_failed_scan_at, d.fail_window_count,
    COALESCE(ci.cnt, 0)::integer,
    COALESCE(ls.cnt, 0)::integer,
    d.created_at,
    d.offline_roster, d.roster_downloaded_at, d.roster_download_count
  FROM public.event_scanner_devices d
  LEFT JOIN public.event_checkpoints cp
    ON cp.tenant_id = d.tenant_id AND cp.id = d.checkpoint_id
  LEFT JOIN public.event_sponsors sp
    ON sp.tenant_id = d.tenant_id AND sp.id = d.sponsor_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_checkins c
    WHERE c.tenant_id = d.tenant_id AND c.device_id = d.id
  ) ci ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_lead_scans l
    WHERE l.tenant_id = d.tenant_id AND l.device_id = d.id
  ) ls ON true
  WHERE d.tenant_id = v_tenant
    AND d.event_id = p_event_id
  ORDER BY d.revoked_at NULLS FIRST, d.label;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_devices_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_devices_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_devices_list(uuid) IS
  'Poswiadczenia urzadzen wydarzenia: stan liczony z czterech kolumn i daty, liczniki skanow i NIEUDANYCH rozpoznan, prefiks tokenu, zgoda na liste offline i ostatnie jej pobranie. HASZA NIE ODDAJE. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 12) PANEL: DZIENNIK ODPRAW Z KOLUMNAMI OFFLINE I KONFLIKTEM
--
-- Cialo z 20260825055347 plus kolumny offline, wyliczony `conflict`
-- z rodzajem `conflict_kind` (admitted_offline: urzadzenie wpuscilo bez
-- sieci, serwer odmawia wedlug trybu punktu; denied_offline: urzadzenie
-- odeslalo czlowieka, a serwer by go wpuscil - trzeba go odnalezc) i filtr
-- `p_conflicts_only` (oba rodzaje). Zmienia sie lista argumentow, wiec stara
-- 10-argumentowa wersja jest usuwana; 11-argumentowa tez, bo zmienia sie
-- RETURNS TABLE (CREATE OR REPLACE nie zmienia typu wyniku).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer
);
DROP FUNCTION IF EXISTS public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean
);
CREATE OR REPLACE FUNCTION public.admin_event_checkins_list(
  p_event_id uuid,
  p_checkpoint_id uuid DEFAULT NULL,
  p_direction text DEFAULT NULL,
  p_result text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_conflicts_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  occurred_at timestamptz,
  scanned_at timestamptz,
  device_scanned_at timestamptz,
  direction text,
  result text,
  source text,
  repeat_count integer,
  note text,
  checkpoint_id uuid,
  checkpoint_name_pl text,
  checkpoint_name_en text,
  checkpoint_kind text,
  person_id uuid,
  first_name text,
  last_name text,
  company text,
  job_title text,
  registration_id uuid,
  registration_status text,
  ticket_name_pl text,
  ticket_name_en text,
  group_name_pl text,
  group_name_en text,
  device_id uuid,
  device_label text,
  operator_user_id uuid,
  operator_name text,
  offline_admitted boolean,
  offline_outcome text,
  roster_generated_at timestamptz,
  offline_server_result text,
  conflict boolean,
  conflict_kind text,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_conflicts boolean := COALESCE(p_conflicts_only, false);
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.occurred_at, c.scanned_at, c.device_scanned_at,
    c.direction, c.result, c.source, c.repeat_count, c.note,
    c.checkpoint_id, cp.name_pl, cp.name_en, cp.kind,
    c.person_id, p.first_name, p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    p.job_title,
    c.registration_id, r.status, tt.name_pl, tt.name_en, g.name_pl, g.name_en,
    c.device_id, d.label,
    c.operator_user_id,
    COALESCE(
      NULLIF(btrim(pr.display_name), ''),
      NULLIF(btrim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), '')
    ),
    c.offline_admitted, c.offline_outcome, c.roster_generated_at,
    c.offline_server_result,
    cf.kind IS NOT NULL,
    cf.kind,
    count(*) OVER ()::integer
  FROM public.event_checkins c
  JOIN public.event_checkpoints cp
    ON cp.tenant_id = c.tenant_id AND cp.id = c.checkpoint_id
  -- `row_admit`: czy wynik WIERSZA wpuszcza wedlug trybu punktu (przy
  -- wpuszczeniu offline to wynik serwera); `server_admit`: czy wpuscilby
  -- serwer (przy odmowie offline jego wynik jest w offline_server_result).
  CROSS JOIN LATERAL (
    SELECT
      (c.result = 'granted'
        OR (cp.access_mode = 'track'
            AND c.result IN ('denied_not_registered', 'denied_registration_status'))) AS row_admit,
      (COALESCE(c.offline_server_result, c.result) = 'granted'
        OR (cp.access_mode = 'track'
            AND COALESCE(c.offline_server_result, c.result)
              IN ('denied_not_registered', 'denied_registration_status'))) AS server_admit
  ) adm
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN c.offline_admitted IS TRUE AND NOT adm.row_admit THEN 'admitted_offline'
      WHEN c.offline_admitted IS FALSE AND adm.server_admit THEN 'denied_offline'
    END AS kind
  ) cf
  JOIN public.event_people p
    ON p.tenant_id = c.tenant_id AND p.id = c.person_id
  LEFT JOIN public.crm_companies co
    ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_registrations r
    ON r.tenant_id = c.tenant_id AND r.id = c.registration_id
  LEFT JOIN public.event_ticket_types tt
    ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
  LEFT JOIN public.event_groups g
    ON g.tenant_id = r.tenant_id AND g.id = r.group_id
  LEFT JOIN public.event_scanner_devices d
    ON d.tenant_id = c.tenant_id AND d.id = c.device_id
  LEFT JOIN public.profiles pr
    ON pr.id = c.operator_user_id AND pr.tenant_id = c.tenant_id
  WHERE c.tenant_id = v_tenant
    AND c.event_id = p_event_id
    AND (p_checkpoint_id IS NULL OR c.checkpoint_id = p_checkpoint_id)
    AND (p_direction IS NULL OR c.direction = p_direction)
    AND (p_result IS NULL OR c.result = p_result)
    AND (p_source IS NULL OR c.source = p_source)
    AND (p_from IS NULL OR c.occurred_at >= p_from)
    AND (p_to IS NULL OR c.occurred_at <= p_to)
    AND (
      v_q IS NULL
      OR p.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR lower(COALESCE(p.company_text, '')) LIKE '%' || lower(v_q) || '%'
    )
    AND (NOT v_conflicts OR cf.kind IS NOT NULL)
  ORDER BY c.occurred_at DESC, c.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean
) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean
) IS
  'Dziennik odpraw dla panelu: filtry (punkt, kierunek, wynik, zrodlo, fraza, zakres czasu, tylko konflikty), paginacja i licznik calosci w funkcji okna. Kolumny offline i wyliczony conflict z rodzajem conflict_kind: admitted_offline (wpuszczony bez sieci, odmowa serwera wedlug trybu punktu) albo denied_offline (odeslany bez sieci, serwer by wpuscil). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 13) CRM: SYGNAL OBECNOSCI
--
-- Pierwsze ostemplowanie `attended_at` (NULL -> NOT NULL) wzbogaca ISTNIEJACY
-- kontakt CRM osoby: tagi `event:<slug>` (jak nabor, faktury i kampanie - po
-- nim CRM filtruje uczestnikow wydarzenia) i `attended:<slug>` oraz wpis osi
-- czasu. Most f0 w trybie
-- `p_create => false` - obecnosc nie jest podstawa do zalozenia kontaktu.
-- Wewnetrzny blok EXCEPTION: nic, co dzieje sie tutaj, nie cofnie odprawy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_event_registrations_attended_crm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.events;
BEGIN
  BEGIN
    SELECT e.* INTO v_event
    FROM public.events e
    WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.event_id;

    PERFORM public._event_person_crm_sync(
      NEW.tenant_id,
      NEW.person_id,
      'event_participant',
      'event:' || COALESCE(v_event.slug, NEW.event_id::text) || ':checkin',
      ARRAY[
        'event:' || COALESCE(v_event.slug, NEW.event_id::text),
        'attended:' || COALESCE(v_event.slug, NEW.event_id::text)
      ],
      '{}'::jsonb,
      false,
      'event.checkin.attended',
      jsonb_build_object(
        'event_id', NEW.event_id,
        'event_slug', v_event.slug,
        'event_title_pl', v_event.title_pl,
        'event_title_en', v_event.title_en,
        'summary_pl', 'Odprawa na wydarzeniu: ' || COALESCE(v_event.title_pl, v_event.title_en, ''),
        'summary_en', 'Checked in at the event: ' || COALESCE(v_event.title_en, v_event.title_pl, ''),
        'registration_id', NEW.id,
        'attended_at', NEW.attended_at
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_event_registrations_attended_crm() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_event_registrations_attended_crm() IS
  'Obecnosc na wydarzeniu -> kontakt CRM (tylko aktualizacja istniejacego): tagi event:<slug> i attended:<slug> oraz wpis osi czasu event.checkin.attended przez _event_person_crm_sync(p_create => false). Nigdy nie cofa odprawy.';

DROP TRIGGER IF EXISTS event_registrations_attended_crm ON public.event_registrations;
CREATE TRIGGER event_registrations_attended_crm
  AFTER UPDATE OF attended_at ON public.event_registrations
  FOR EACH ROW
  WHEN (OLD.attended_at IS NULL AND NEW.attended_at IS NOT NULL)
  EXECUTE FUNCTION public.tg_event_registrations_attended_crm();
