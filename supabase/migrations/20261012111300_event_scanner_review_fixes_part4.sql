-- events-harness: include
-- ============================================================================
-- WYDARZENIA: SKANER - POPRAWKI PO PRZEGLADZIE, CZESC 4/4: PANEL.
--
-- Opis ustalen - w naglowku 20261012111000. Bramka wszystkich trzech funkcji:
-- assert_event_admin_tenant() (admin albo super_admin), jak dotad.
--
-- ZMIANA:
--   * `admin_event_scanner_devices_list` (cialo z 20260926150001): nowe
--     kolumny superseded_scan_count, queue_fail_window_count,
--     queue_fail_window_started_at, queue_locked_until (R12) i
--     queue_marker_required_at (R0/R11) - organizator widzi blokade kolejki
--     osobno od blokady na zywo i wie, ktore telefony maja juz klienta ze
--     znacznikiem. `state` bez zmian (stan NA ZYWO). RETURNS TABLE sie
--     zmienia, wiec DROP + CREATE (ACL odtworzony);
--   * `admin_event_scanner_device_set_active` (cialo z 20261012110400):
--     wznowienie zdejmuje takze blokade kolejki (R12);
--   * `admin_event_checkins_list` (cialo z 20260926150001): nowy rodzaj
--     konfliktu `double_entry` (R9) - zgoda na wejscie w punkcie z polityka
--     deny, po ktorej (albo przed ktora) tego samego dnia czasu wydarzenia
--     nastepna (poprzednia) zgoda tej osoby w tym punkcie jest znowu
--     wejsciem. Liczony przy odczycie, wiec znika sam, gdy dotrze wyjscie
--     z kolejki innego urzadzenia; jawne obejscie stanowiska
--     (reentry_override) nie jest konfliktem. Nowa kolumna reentry_override
--     (R8). RETURNS TABLE sie zmienia, wiec DROP + CREATE (ACL odtworzony).
--
-- IDEMPOTENTNA: DROP FUNCTION IF EXISTS + CREATE OR REPLACE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) URZADZENIA: LICZNIKI KOLEJKI, BLOKADA KOLEJKI, ZNACZNIK
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
  roster_download_count integer,
  superseded_scan_count integer,
  queue_fail_window_count integer,
  queue_fail_window_started_at timestamptz,
  queue_locked_until timestamptz,
  queue_marker_required_at timestamptz
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
    d.offline_roster, d.roster_downloaded_at, d.roster_download_count,
    d.superseded_scan_count,
    -- Okno kolejki po swoim czasie (60 minut) jest juz nieaktualne - zero,
    -- nie stary licznik.
    CASE
      WHEN d.queue_fail_window_started_at IS NULL
        OR d.queue_fail_window_started_at < now() - interval '60 minutes'
      THEN 0
      ELSE d.queue_fail_window_count
    END,
    d.queue_fail_window_started_at,
    CASE WHEN d.queue_locked_until > now() THEN d.queue_locked_until END,
    d.queue_marker_required_at
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
  'Poswiadczenia urzadzen wydarzenia: stan NA ZYWO liczony z czterech kolumn i daty, liczniki skanow, NIEUDANYCH rozpoznan i kodow zastapionych, okno nieznanych kodow z kolejki (licznik zerowany po 60 minutach) i blokada SAMEJ kolejki (queue_locked_until tylko, gdy trwa), deklaracja klienta ze znacznikiem kolejki (queue_marker_required_at), prefiks tokenu, zgoda na liste offline i ostatnie jej pobranie. HASZA I SEKRETU KOLEJKI NIE ODDAJE. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 2) PAUZA / WZNOWIENIE: WZNOWIENIE ZDEJMUJE TAKZE BLOKADE KOLEJKI
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_set_active(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'device_id', '')::uuid;
  v_active boolean := COALESCE(NULLIF(p_payload->>'is_active', '')::boolean, true);
  v_row public.event_scanner_devices;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: device_id is required';
  END IF;

  SELECT d.* INTO v_row
  FROM public.event_scanner_devices d
  WHERE d.id = v_id AND d.tenant_id = v_tenant;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: scanner credential does not exist in this organisation';
  END IF;

  IF v_row.revoked_at IS NOT NULL AND v_active THEN
    RAISE EXCEPTION 'device_revoked: a revoked credential cannot be reactivated - issue a new one';
  END IF;

  UPDATE public.event_scanner_devices
  SET is_active = v_active,
      locked_until = CASE WHEN v_active THEN NULL ELSE locked_until END,
      fail_window_count = CASE WHEN v_active THEN 0 ELSE fail_window_count END,
      fail_window_started_at = CASE WHEN v_active THEN NULL ELSE fail_window_started_at END,
      queue_locked_until = CASE WHEN v_active THEN NULL ELSE queue_locked_until END,
      queue_fail_window_count = CASE WHEN v_active THEN 0 ELSE queue_fail_window_count END,
      queue_fail_window_started_at = CASE
        WHEN v_active THEN NULL ELSE queue_fail_window_started_at
      END
  WHERE id = v_id AND tenant_id = v_tenant;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) IS
  'Pauza albo wznowienie poswiadczenia. Wznowienie ZDEJMUJE obie blokady automatyczne - na zywo i kolejki - i czysci oba okna nieudanych prob (licznik monotoniczny zostaje - to historia, nie stan). Uniewaznionego poswiadczenia nie da sie wznowic. Payload: {device_id, is_active}. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 3) DZIENNIK ODPRAW: KONFLIKT double_entry I OBEJSCIE STANOWISKA
-- ----------------------------------------------------------------------------
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
  reentry_override boolean,
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
  v_tz text;
BEGIN
  -- Granica dnia regul ponownego wejscia: polnoc w strefie wydarzenia.
  SELECT public._event_safe_timezone(e.timezone) INTO v_tz
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.id = p_event_id;
  v_tz := COALESCE(v_tz, public._event_safe_timezone(NULL));

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
    c.reentry_override,
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
  -- R9: dwa wejscia tej osoby w punkcie z polityka deny, tego samego dnia
  -- czasu wydarzenia, bez wyjscia pomiedzy - kazde z osobna moglo byc
  -- prawdziwe (skan z kolejki oceniony bez pozniejszego wyjscia, ktore
  -- jeszcze nie dotarlo), ale razem to podwojne wejscie jednego kodu.
  -- Oznaczamy oba wiersze pary; jawne obejscie stanowiska nie jest
  -- konfliktem.
  CROSS JOIN LATERAL (
    SELECT (
      c.result = 'granted'
      AND c.direction = 'in'
      AND cp.access_mode = 'control'
      AND cp.reentry_policy = 'deny'
      AND (
        (
          NOT c.reentry_override
          AND (
            SELECT pv.direction
            FROM public.event_checkins pv
            WHERE pv.tenant_id = c.tenant_id
              AND pv.checkpoint_id = c.checkpoint_id
              AND pv.person_id = c.person_id
              AND pv.result = 'granted'
              AND pv.id <> c.id
              AND pv.occurred_at <= c.occurred_at
              AND pv.occurred_at >= date_trunc('day', c.occurred_at AT TIME ZONE v_tz) AT TIME ZONE v_tz
            ORDER BY pv.occurred_at DESC, pv.id DESC
            LIMIT 1
          ) = 'in'
        )
        OR (
          SELECT nx.direction = 'in' AND NOT nx.reentry_override
          FROM public.event_checkins nx
          WHERE nx.tenant_id = c.tenant_id
            AND nx.checkpoint_id = c.checkpoint_id
            AND nx.person_id = c.person_id
            AND nx.result = 'granted'
            AND nx.id <> c.id
            AND nx.occurred_at >= c.occurred_at
            AND nx.occurred_at < (date_trunc('day', c.occurred_at AT TIME ZONE v_tz) + interval '1 day')
              AT TIME ZONE v_tz
          ORDER BY nx.occurred_at, nx.id
          LIMIT 1
        ) IS TRUE
      )
    ) AS double_entry
  ) dbl
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN c.offline_admitted IS TRUE AND NOT adm.row_admit THEN 'admitted_offline'
      WHEN c.offline_admitted IS FALSE AND adm.server_admit THEN 'denied_offline'
      WHEN dbl.double_entry THEN 'double_entry'
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
  'Dziennik odpraw dla panelu: filtry (punkt, kierunek, wynik, zrodlo, fraza, zakres czasu, tylko konflikty), paginacja i licznik calosci w funkcji okna. Kolumny offline i wyliczony conflict z rodzajem conflict_kind: admitted_offline (wpuszczony bez sieci, odmowa serwera wedlug trybu punktu), denied_offline (odeslany bez sieci, serwer by wpuscil) albo double_entry (punkt z polityka deny: dwa wejscia tej osoby tego samego dnia czasu wydarzenia bez wyjscia pomiedzy - oba wiersze pary; liczony przy odczycie, znika, gdy dotrze wyjscie). reentry_override: jawne obejscie odmowy przez stanowisko (nie jest konfliktem). Bramka: assert_event_admin_tenant().';
