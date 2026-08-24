DROP FUNCTION IF EXISTS public._event_new_scanner_token();
CREATE OR REPLACE FUNCTION public._event_new_scanner_token()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT replace(replace(rtrim(encode(gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_');
$$;

REVOKE ALL ON FUNCTION public._event_new_scanner_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_new_scanner_token() TO service_role;

COMMENT ON FUNCTION public._event_new_scanner_token() IS
  'Losowy token urzadzenia skanujacego (24 bajty, base64url). Do tabeli idzie wylacznie sha256 tej wartosci plus osiem pierwszych znakow jako prefiks identyfikacyjny.';

DROP FUNCTION IF EXISTS public._event_scanner_device_auth(text, text);
CREATE OR REPLACE FUNCTION public._event_scanner_device_auth(_token text, _scope text)
RETURNS public.event_scanner_devices
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean text := btrim(COALESCE(_token, ''));
  v_device public.event_scanner_devices;
BEGIN
  IF v_clean !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'invalid_device_token: scanner token is missing or malformed';
  END IF;

  SELECT d.* INTO v_device
  FROM public.event_scanner_devices d
  WHERE d.token_hash = encode(digest(v_clean, 'sha256'), 'hex');

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'invalid_device_token: scanner token is not known';
  END IF;

  IF v_device.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'device_revoked: this scanner credential was revoked';
  END IF;

  IF NOT v_device.is_active THEN
    RAISE EXCEPTION 'device_inactive: this scanner credential is paused';
  END IF;

  IF v_device.expires_at <= now() THEN
    RAISE EXCEPTION 'device_expired: this scanner credential has expired';
  END IF;

  IF v_device.locked_until IS NOT NULL AND v_device.locked_until > now() THEN
    RAISE EXCEPTION 'device_locked: this scanner credential is temporarily locked';
  END IF;

  IF _scope IS NOT NULL AND NOT (_scope = ANY (v_device.scopes)) THEN
    RAISE EXCEPTION 'device_scope_missing: this scanner credential has no % scope', _scope;
  END IF;

  UPDATE public.event_scanner_devices
  SET last_seen_at = now(),
      locked_until = CASE WHEN locked_until <= now() THEN NULL ELSE locked_until END,
      fail_window_count = CASE WHEN locked_until <= now() THEN 0 ELSE fail_window_count END
  WHERE id = v_device.id;

  RETURN v_device;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_auth(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_auth(text, text) TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_auth(text, text) IS
  'Bramka plaszczyzny urzadzenia: token jawny -> wiersz poswiadczenia. Najemca i wydarzenie sa WYNIKIEM odszukania po haszu, nie argumentem - nie ma naglowka do podrobienia ani roli do eskalacji. Sprawdza uniewaznienie, pauze, termin, blokade i zakres.';

DROP FUNCTION IF EXISTS public._event_scanner_device_note_failure(uuid);
CREATE OR REPLACE FUNCTION public._event_scanner_device_note_failure(_device_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_minutes constant integer := 10;
  v_threshold constant integer := 20;
  v_lock_minutes constant integer := 30;
  v_row public.event_scanner_devices;
  v_locked boolean := false;
BEGIN
  IF _device_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.event_scanner_devices d
  SET failed_scan_count = d.failed_scan_count + 1,
      last_failed_scan_at = now(),
      fail_window_started_at = CASE
        WHEN d.fail_window_started_at IS NULL
          OR d.fail_window_started_at < now() - make_interval(mins => v_window_minutes)
        THEN now()
        ELSE d.fail_window_started_at
      END,
      fail_window_count = CASE
        WHEN d.fail_window_started_at IS NULL
          OR d.fail_window_started_at < now() - make_interval(mins => v_window_minutes)
        THEN 1
        ELSE d.fail_window_count + 1
      END
  WHERE d.id = _device_id
  RETURNING d.* INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN false;
  END IF;

  IF v_row.fail_window_count >= v_threshold
     AND (v_row.locked_until IS NULL OR v_row.locked_until <= now()) THEN
    UPDATE public.event_scanner_devices
    SET locked_until = now() + make_interval(mins => v_lock_minutes)
    WHERE id = _device_id;
    v_locked := true;

    PERFORM public.emit_domain_event(
      v_row.tenant_id,
      'event_scanner_device',
      v_row.id::text,
      'event_scanner_device.locked.v1',
      jsonb_build_object(
        'event_id', v_row.event_id,
        'device_id', v_row.id,
        'label', v_row.label,
        'token_prefix', v_row.token_prefix,
        'failures_in_window', v_row.fail_window_count,
        'locked_minutes', v_lock_minutes
      ),
      NULL::uuid
    );
  END IF;

  RETURN v_locked;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_note_failure(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_note_failure(uuid) TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_note_failure(uuid) IS
  'Podnosi licznik nieudanych rozpoznan tokenu uczestnika i po 20 probach w oknie 10 minut blokuje urzadzenie na 30 minut, emitujac event_scanner_device.locked.v1. Zwraca true, gdy blokada wlasnie zapadla.';

DROP FUNCTION IF EXISTS public._event_checkpoint_occupancy(uuid, uuid);
CREATE OR REPLACE FUNCTION public._event_checkpoint_occupancy(_tenant uuid, _checkpoint_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM (
    SELECT DISTINCT ON (c.person_id) c.direction
    FROM public.event_checkins c
    WHERE c.tenant_id = _tenant
      AND c.checkpoint_id = _checkpoint_id
      AND c.result = 'granted'
    ORDER BY c.person_id, c.occurred_at DESC, c.id
  ) last_scan
  WHERE last_scan.direction = 'in';
$$;

REVOKE ALL ON FUNCTION public._event_checkpoint_occupancy(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkpoint_occupancy(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_checkpoint_occupancy(uuid, uuid) IS
  'Ile osob jest AKTUALNIE w punkcie (ostatni skan osoby = wejscie). Liczy z dziennika, nie z kolumny-licznika, ktora dryfuje. Liczy, nie rezerwuje - wolajacy trzyma blokade wiersza punktu.';

DROP FUNCTION IF EXISTS public._event_onsite_person_card(uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public._event_onsite_person_card(
  _tenant uuid,
  _event_id uuid,
  _person_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'person_id', p.id,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'company', COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    'job_title', p.job_title,
    'registration_id', r.id,
    'registration_status', r.status,
    'ticket_name_pl', tt.name_pl,
    'ticket_name_en', tt.name_en,
    'group_name_pl', COALESCE(g.name_pl, dg.name_pl),
    'group_name_en', COALESCE(g.name_en, dg.name_en),
    'group_color', COALESCE(g.color, dg.color),
    'badge_printed', (bp.printed_at IS NOT NULL),
    'badge_printed_at', bp.printed_at,
    'badge_printed_version', bp.template_version
  )
  INTO v_out
  FROM public.event_people p
  LEFT JOIN public.crm_companies co
    ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_registrations r
    ON r.tenant_id = p.tenant_id
   AND r.event_id = _event_id
   AND r.person_id = p.id
   AND r.status NOT IN ('cancelled', 'rejected')
  LEFT JOIN public.event_ticket_types tt
    ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
  LEFT JOIN public.event_groups g
    ON g.tenant_id = r.tenant_id AND g.id = r.group_id
  LEFT JOIN public.event_groups dg
    ON dg.tenant_id = p.tenant_id AND dg.event_id = _event_id AND dg.is_default
  LEFT JOIN LATERAL (
    SELECT bpr.printed_at, bpr.template_version
    FROM public.event_badge_prints bpr
    WHERE bpr.tenant_id = p.tenant_id
      AND bpr.event_id = _event_id
      AND bpr.person_id = p.id
    ORDER BY bpr.printed_at DESC
    LIMIT 1
  ) bp ON true
  WHERE p.tenant_id = _tenant
    AND p.id = _person_id;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public._event_onsite_person_card(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_onsite_person_card(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_onsite_person_card(uuid, uuid, uuid) IS
  'Minimum danych operatora bramki: imie, nazwisko, firma, stanowisko, bilet, grupa, status zapisu, stan identyfikatora. BEZ adresu poczty i telefonu - bramka ich nie potrzebuje, a poswiadczenie urzadzenia bywa przechwycone.';