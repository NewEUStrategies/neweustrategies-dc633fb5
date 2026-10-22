-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S7, 3/3): WYCISZENIA DIAGNOZ -
-- `admin_revenue_diagnostic_snooze`, `admin_revenue_diagnostic_unsnooze`,
-- `admin_revenue_diagnostic_snoozes` + zdarzenie `revenue_diagnostic.snoozed.v1`.
--
-- DEFEKT
--   1. Tabela `revenue_diagnostic_snoozes` (I0, 20261020090100) nie ma
--      pisarza: RLS daje personelowi wyłącznie odczyt, więc „Wycisz" w panelu
--      nie miałoby czym zapisać, a diagnoza świadomie zaakceptowana (np.
--      warstwa „na zapytanie" widoczna w cenniku) wracałaby przy każdym
--      odświeżeniu i uczyła admina ignorować listę.
--   2. Bez wspólnego pisarza każda karta liczyłaby wyciszenie po swojemu,
--      a druga karta (i licznik na pasku huba) nie dowiedziałaby się o zmianie.
--
-- ZMIANA
--   A. `admin_revenue_diagnostic_snooze(p_check_id, p_scope_key, p_kind,
--      p_until, p_reason, p_scope_hash)` - WYŁĄCZNIE admin
--      (`has_role(auth.uid(), 'admin')`, najemca `current_tenant_id()`,
--      inaczej 42501). Walidacja = CHECK-i tabeli, ODRZUCENIE (22023 z kodem),
--      nigdy przycięcie: `check_id_invalid`, `scope_key_invalid` (pusty albo
--      > 200), `kind_invalid`, `reason_invalid` (po `btrim` 3..500),
--      `scope_hash_invalid` (> 64), `until_invalid` (brak albo przeszłość
--      przy `days`), `until_too_far` (> 180 dni), `scope_hash_required`
--      i `reason_required` (`intentional` wymaga odcisku zakresu i powodu).
--      Reguły KRYTYCZNE w `sync.*` i `data_quality.*` są niewyciszalne
--      (`not_snoozable`) - błąd emitera albo rozjazd księgi przekłamuje
--      każdą liczbę huba, więc nie może zniknąć z listy (lustro TS:
--      `UNSNOOZABLE_CHECK_IDS`, parytet `snoozeParity.test.ts`).
--      Zapis `INSERT … ON CONFLICT (tenant_id, check_id, scope_key) DO
--      UPDATE` (ponowne wyciszenie = nowy termin liczony od teraz),
--      `created_by = auth.uid()` (kolumna NULL-owalna od 20261020160700 -
--      zapis działa w obu stanach).
--   B. `admin_revenue_diagnostic_unsnooze(p_check_id, p_scope_key)` - admin;
--      brak wyciszenia = `{removed: false}`, nie błąd (podwójne kliknięcie).
--   C. `admin_revenue_diagnostic_snoozes()` - admin|editor (redaktor widzi,
--      co wyciszono, ale nie wycisza): aktywne wyciszenia najemcy
--      (`intentional` albo `until` w przyszłości).
--   D. Zdarzenie `revenue_diagnostic.snoozed.v1` (agregat `revenue_diagnostic`,
--      id wiersza; payload WYŁĄCZNIE `check_id, scope_key, kind, until, op`,
--      aktor `auth.uid()`) - mapa inwalidacji odświeża fakty i wyciszenia
--      w innych kartach; router ścieżek pomija ten agregat (20261020140000).
--      Awaria szyny -> `_log_emit_error`, zapis wyciszenia przechodzi.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020090100 (tabela), 20261020090500
-- (`_log_emit_error`) i 20261020140000 (router pomija agregat). Niezależna od
-- bloku I9 2026102016*: nie zakłada `created_by NOT NULL` (160700 zdejmuje
-- NOT NULL; RPC zawsze wpisuje autora) i nie czyta obiektów I9. Zero DDL.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe nazwy - bez CIALO-Z),
-- bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/revenue_diagnostic_snoozes_test.sql (admin-only,
-- days <= 180, intentional z odciskiem i powodem, za długi powód odrzucony,
-- krytyczne sync/data_quality niewyciszalne, zdarzenie z dozwolonymi kluczami,
-- unsnooze, dwóch najemców, ACL).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Wyciszenie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_diagnostic_snooze(
  p_check_id text,
  p_scope_key text,
  p_kind text,
  p_until timestamptz,
  p_reason text,
  p_scope_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tenant uuid;
  v_scope text := COALESCE(p_scope_key, '*');
  v_until timestamptz;
  v_row public.revenue_diagnostic_snoozes%ROWTYPE;
  -- Lustro `UNSNOOZABLE_CHECK_IDS` (src/lib/revenue/diagnostics/registry.ts):
  -- reguły o wadze `critical` w obszarach `sync` i `data_quality`.
  -- unsnoozable:begin
  v_unsnoozable text[] := ARRAY['sync.emit_errors', 'data_quality.ledger_drift'];
  -- unsnoozable:end
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_check_id IS NULL OR p_check_id !~ '^[a-z_]+\.[a-z_]+$' THEN
    RAISE EXCEPTION 'check_id_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_check_id = ANY (v_unsnoozable) THEN
    RAISE EXCEPTION 'not_snoozable' USING ERRCODE = '22023';
  END IF;
  IF v_scope = '' OR char_length(v_scope) > 200 THEN
    RAISE EXCEPTION 'scope_key_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('days', 'intentional') THEN
    RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NOT NULL AND char_length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'reason_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_scope_hash IS NOT NULL AND (p_scope_hash = '' OR char_length(p_scope_hash) > 64) THEN
    RAISE EXCEPTION 'scope_hash_invalid' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'days' THEN
    IF p_until IS NULL OR p_until <= now() THEN
      RAISE EXCEPTION 'until_invalid' USING ERRCODE = '22023';
    END IF;
    -- Ta sama granica co CHECK `until <= created_at + 180 dni`; `created_at`
    -- zapisu = now() (także przy ponownym wyciszeniu), więc warunek jest
    -- sprawdzany tu, z czytelnym kodem, zanim CHECK rzuci ogólnym 23514.
    IF p_until > now() + interval '180 days' THEN
      RAISE EXCEPTION 'until_too_far' USING ERRCODE = '22023';
    END IF;
    v_until := p_until;
  ELSE
    -- Świadome „tak ma być": bez terminu, ale z odciskiem zakresu (zmiana
    -- obiektu zdejmuje wyciszenie po stronie TS) i z powodem.
    IF p_scope_hash IS NULL THEN
      RAISE EXCEPTION 'scope_hash_required' USING ERRCODE = '22023';
    END IF;
    IF p_reason IS NULL THEN
      RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
    END IF;
    v_until := NULL;
  END IF;

  INSERT INTO public.revenue_diagnostic_snoozes AS s
    (tenant_id, check_id, scope_key, kind, scope_hash, until, reason, created_by, created_at)
  VALUES (v_tenant, p_check_id, v_scope, p_kind, p_scope_hash, v_until, p_reason, v_uid, now())
  ON CONFLICT (tenant_id, check_id, scope_key) DO UPDATE
    SET kind = EXCLUDED.kind, scope_hash = EXCLUDED.scope_hash, until = EXCLUDED.until,
        reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at
  RETURNING * INTO v_row;

  BEGIN
    PERFORM public.emit_domain_event(
      v_tenant, 'revenue_diagnostic', v_row.id::text, 'revenue_diagnostic.snoozed.v1',
      jsonb_build_object('check_id', v_row.check_id, 'scope_key', v_row.scope_key, 'kind', v_row.kind,
                         'until', v_row.until, 'op', 'snooze'),
      v_uid);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._log_emit_error(v_tenant, 'admin_revenue_diagnostic_snooze',
                                   'revenue_diagnostic.snoozed.v1', SQLSTATE, SQLERRM);
  END;

  RETURN jsonb_build_object(
    'id', v_row.id, 'checkId', v_row.check_id, 'scopeKey', v_row.scope_key, 'kind', v_row.kind,
    'until', v_row.until, 'reason', v_row.reason, 'scopeHash', v_row.scope_hash,
    'createdAt', v_row.created_at);
END;
$$;

-- ----------------------------------------------------------------------------
-- B) Zdjęcie wyciszenia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_diagnostic_unsnooze(
  p_check_id text,
  p_scope_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tenant uuid;
  v_row public.revenue_diagnostic_snoozes%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_check_id IS NULL OR p_check_id !~ '^[a-z_]+\.[a-z_]+$' THEN
    RAISE EXCEPTION 'check_id_invalid' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.revenue_diagnostic_snoozes s
   WHERE s.tenant_id = v_tenant AND s.check_id = p_check_id AND s.scope_key = COALESCE(p_scope_key, '*')
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('removed', false);
  END IF;

  BEGIN
    PERFORM public.emit_domain_event(
      v_tenant, 'revenue_diagnostic', v_row.id::text, 'revenue_diagnostic.snoozed.v1',
      jsonb_build_object('check_id', v_row.check_id, 'scope_key', v_row.scope_key, 'kind', v_row.kind,
                         'until', NULL, 'op', 'unsnooze'),
      v_uid);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._log_emit_error(v_tenant, 'admin_revenue_diagnostic_unsnooze',
                                   'revenue_diagnostic.snoozed.v1', SQLSTATE, SQLERRM);
  END;

  RETURN jsonb_build_object('removed', true, 'id', v_row.id);
END;
$$;

-- ----------------------------------------------------------------------------
-- C) Aktywne wyciszenia najemcy.
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_revenue_diagnostic_snoozes (snoozes[]: id, checkId, scopeKey,
-- kind, until, reason, scopeHash, createdAt)
CREATE OR REPLACE FUNCTION public.admin_revenue_diagnostic_snoozes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'checkId', s.check_id, 'scopeKey', s.scope_key, 'kind', s.kind,
           'until', s.until, 'reason', s.reason, 'scopeHash', s.scope_hash, 'createdAt', s.created_at)
         ORDER BY s.check_id, s.scope_key), '[]'::jsonb)
    INTO v_rows
    FROM public.revenue_diagnostic_snoozes s
   WHERE s.tenant_id = v_tenant AND (s.kind = 'intentional' OR s.until > now());

  RETURN jsonb_build_object('snoozes', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revenue_diagnostic_snooze(text, text, text, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_diagnostic_unsnooze(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_diagnostic_snoozes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_diagnostic_snooze(text, text, text, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_diagnostic_unsnooze(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_diagnostic_snoozes() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_revenue_diagnostic_snooze(text, text, text, timestamptz, text, text) IS
  'Hub S7: wyciszenie diagnozy (days <= 180 dni | intentional z odciskiem i powodem); tylko admin najemcy z sesji (42501), walidacja = CHECK-i tabeli (22023, bez przycinania), krytyczne sync/data_quality niewyciszalne; zdarzenie revenue_diagnostic.snoozed.v1.';
COMMENT ON FUNCTION public.admin_revenue_diagnostic_unsnooze(text, text) IS
  'Hub S7: zdjęcie wyciszenia diagnozy; tylko admin najemcy z sesji (42501); brak wiersza = {removed:false}; zdarzenie revenue_diagnostic.snoozed.v1 (op unsnooze).';
COMMENT ON FUNCTION public.admin_revenue_diagnostic_snoozes() IS
  'Hub S7: aktywne wyciszenia diagnoz najemcy z sesji (intentional albo until w przyszłości); admin|editor (42501).';
