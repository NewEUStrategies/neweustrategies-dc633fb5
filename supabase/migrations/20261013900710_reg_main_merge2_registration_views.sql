-- events-harness: include
-- ============================================================================
-- SCALENIE Z MAIN (PR #504), RUNDA 4, CZ. 2: WIDOKI ZGLOSZENIA =
-- REG-17/REG-16/REG-06 (REG) + OPS-01 (main).
--
-- POCHODZENIE
--   * REG: 20261012160000 (REG-17, D13) - `event_registration_manage_view`:
--     klucz przez resolver `_event_manage_token_resolve` (cel view), wygasly
--     klucz -> `{ok:false, reason:'expired'}`, kwota z
--     `_event_registration_unit_price` (REG-16, `price_source`,
--     `quote_valid_until`); 20261012170200 (REG-06, D10) -
--     `admin_event_registrations_list` z kolumna `participant_reason`.
--   * main: 20261013110400 (OPS-01) - `event_registration_manage_view` na
--     ciele z 20260830090000 z kluczem `partner_consent`; 20261013110300
--     (OPS-01) - `admin_event_registrations_list` ze zgoda partnerska
--     ZGLOSZENIA (`r.consent_partner_sharing_at`, nowa
--     `consent_partner_withdrawn_at`) zamiast globalnego stempla osoby.
--
-- DEFEKT (stan po samym scaleniu)
--   * replay (nazwy): ciala main wygrywaja - strona samoobslugi znow porownuje
--     skrot klucza wprost (klucz po koncu wydarzenia daje pelny podglad zamiast
--     `expired`, REG-17 cofniete), kwota bez oferty REG-16; lista zgloszen
--     traci `participant_reason` (panel nie odroznia powodu dla uczestnika od
--     notatki wewnetrznej, D10);
--   * produkcja: ciala REG wygrywaja - brak `partner_consent` (karta wycofania
--     zgody partnerskiej main nigdy sie nie pokazuje) i lista ze stemplem
--     OSOBY (panel pokazuje zgode z innego wydarzenia, brak daty wycofania).
--
-- ZMIANA (unia; zmiany oznaczone "ZMIANA (scalenie z main, ...)")
--   * `event_registration_manage_view` - cialo REG 20261012160000 + klucz
--     `partner_consent` main (sama flaga `_event_partner_consent_at IS NOT
--     NULL`). Granty bez zmian (anon, authenticated, service_role).
--   * `admin_event_registrations_list` - cialo main 20261013110300 + kolumna
--     REG `participant_reason` na koncu (typ wyniku inny niz po obu stronach:
--     DROP + CREATE, granty authenticated i service_role, bramka
--     `assert_editor_tenant()` w ciele bez zmian).
--
-- CZEGO TO NIE ZAMYKA. Nic ponad unie - oba widoki nie zmieniaja danych.
-- KOLEJNOSC WDROZENIA: PO wszystkich migracjach main i REG, PRZED
--   20261013900900. Wzgledem kodu dowolna (TS po scaleniu czyta oba klucze).
-- IDEMPOTENTNA: CREATE OR REPLACE / DROP IF EXISTS + CREATE, bezstanowe
--   REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/reg_main_merge_test.sql (H7, H8),
--   supabase/tests/event_manage_token_hygiene_test.sql (REG),
--   harness 33_partner_consent_per_registration.sql (main),
--   78_manage_token_hygiene.sql (REG).
-- ============================================================================

-- A) STAN ZGLOSZENIA NA STRONIE SAMOOBSLUGI --------------------------------------
-- Cialo z 20261012160000 (REG). ZMIANA (scalenie z main, OPS-01) oznaczona.

CREATE OR REPLACE FUNCTION public.event_registration_manage_view(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_token text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_reg_id uuid := CASE
    WHEN COALESCE(p_payload->>'registration_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'registration_id')::uuid
    ELSE NULL
  END;
  v_reg public.event_registrations;
  v_ticket public.event_ticket_types;
  v_event public.events;
  v_key_id uuid;
  v_key_verdict text;
  v_unit jsonb;
  v_owned boolean := false;
BEGIN
  IF v_tenant IS NULL OR (v_token IS NULL AND v_reg_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_token IS NOT NULL THEN
    -- ZMIANA 20261012 (REG-17): klucz przez jedna regule A1 (cel 'view').
    -- Wygasly klucz dostaje WLASNY powod: link z maila po wydarzeniu mowi
    -- „wygasl", a nie „nie znaleziono" - uczestnik wie, ze ma pisac do
    -- organizatora, a nie szukac literowki. Zgloszenie anulowane zostaje
    -- widoczne (podglad statusu), ale zadna akcja kluczem juz nie przejdzie.
    SELECT k.registration_id, k.verdict INTO v_key_id, v_key_verdict
      FROM public._event_manage_token_resolve(v_tenant, v_token, 'view') k;
    IF v_key_verdict = 'expired' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    ELSIF v_key_verdict IS DISTINCT FROM 'ok' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    SELECT r.* INTO v_reg
    FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant
      AND r.id = v_key_id;
  ELSE
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    SELECT r.* INTO v_reg
    FROM public.event_registrations r
    LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE r.id = v_reg_id
      AND r.tenant_id = v_tenant
      AND (r.created_by = v_uid OR p.user_id = v_uid);
  END IF;

  IF v_reg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_event FROM public.events e
  WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant;

  IF v_reg.ticket_type_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.event_ticket_types t
    WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant;
  END IF;

  -- ZMIANA 20261012 (REG-16, D8): kwota zgloszenia ta sama, co w kasie
  -- i w odpowiedzi zapisu - oferta z chwili zapisu, dopoki wazna, inaczej
  -- cena biezaca (bez biletu 0). Jedna regula: `_event_registration_unit_price`.
  v_unit := public._event_registration_unit_price(v_reg, v_ticket);

  -- Czy TEN zalogowany uzytkownik jest wlascicielem zgloszenia. Front pyta
  -- o to, zeby wiedziec, czy pokazac przycisk „Zaplac", czy zdanie
  -- „platna wejsciowka nalezy do konta - zaloguj sie na nie".
  v_owned := v_uid IS NOT NULL AND (
    v_reg.created_by = v_uid
    OR EXISTS (SELECT 1 FROM public.event_people p
               WHERE p.id = v_reg.person_id AND p.tenant_id = v_tenant AND p.user_id = v_uid)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg.id,
    'event_id', v_reg.event_id,
    'event_slug', v_event.slug,
    'ticket_type_id', v_reg.ticket_type_id,
    'status', v_reg.status,
    'payment_status', v_reg.payment_status,
    'waitlist_position', v_reg.waitlist_position,
    'amount_cents', COALESCE((v_unit->>'amount_cents')::integer, 0),
    'price_source', COALESCE(v_unit->>'source', 'current'),
    'quote_valid_until', v_unit->'quote_valid_until',
    'currency', v_ticket.currency,
    'owned_by_caller', v_owned,
    -- ZMIANA (scalenie z main, OPS-01 z 20261013110400): czy zgoda na
    -- przekazanie danych partnerom TEGO wydarzenia jest skuteczna - decyduje
    -- o przycisku jej wycofania. Sama flaga, bez dat i bez danych osoby.
    'partner_consent', public._event_partner_consent_at(v_tenant, v_reg.event_id, v_reg.person_id) IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_manage_view(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_manage_view(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_manage_view(jsonb) IS
  'Stan wlasnego zgloszenia pod kluczem manage_token (gosc; _event_manage_token_resolve cel view: po koncu wydarzenia {ok:false, reason:expired}, po anulowaniu sam status) albo pod identyfikatorem (wlasciciel konta). Oddaje MINIMUM potrzebne stronie samoobslugi: status, os pieniedzy, kwote zgloszenia (_event_registration_unit_price; price_source quote|current, quote_valid_until), to, czy zalogowany jest wlascicielem, i flage skutecznej zgody partnerskiej na to wydarzenie (partner_consent, OPS-01). Zadnych danych osobowych. Unia 20261013900710.';

-- B) LISTA ZGLOSZEN PANELU ---------------------------------------------------------
-- Typ wyniku = unia kolumn obu stron (inny niz kazda z nich), wiec DROP + CREATE.
DROP FUNCTION IF EXISTS public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer);

-- Cialo z 20261013110300 (main). ZMIANA (scalenie z main, REG-06/D10) oznaczona.

CREATE FUNCTION public.admin_event_registrations_list(
  p_event_id uuid,
  p_status text DEFAULT NULL,
  p_ticket_type_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  person_id uuid,
  status text,
  registration_mode text,
  source text,
  first_name text,
  last_name text,
  email text,
  phone text,
  job_title text,
  company_text text,
  company_id uuid,
  company_name text,
  social_profile_url text,
  person_user_id uuid,
  ticket_type_id uuid,
  ticket_key text,
  ticket_name_pl text,
  ticket_name_en text,
  ticket_price_cents integer,
  ticket_currency text,
  group_id uuid,
  group_key text,
  group_name_pl text,
  group_name_en text,
  group_color text,
  extra_groups_count integer,
  answers jsonb,
  decided_by uuid,
  decided_at timestamptz,
  decision_source text,
  decision_note text,
  waitlist_position integer,
  waitlist_notified_at timestamptz,
  promoted_at timestamptz,
  cancelled_at timestamptz,
  attended_at timestamptz,
  has_qr boolean,
  consent_data_processing_at timestamptz,
  consent_marketing_at timestamptz,
  consent_partner_sharing_at timestamptz,
  consent_partner_withdrawn_at timestamptz,
  consent_withdrawn_at timestamptz,
  accepted_terms_count integer,
  required_terms_missing integer,
  created_at timestamptz,
  total_count integer,
  -- ZMIANA (scalenie z main, REG-06/D10 z 20261012170200): powod dla
  -- uczestnika (odrzucenie/anulowanie) - osobno od wewnetrznej `decision_note`.
  participant_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.event_id, r.person_id, r.status, r.registration_mode, r.source,
    p.first_name, p.last_name, p.email, p.phone, p.job_title,
    p.company_text, p.company_id, c.name,
    p.social_profile_url, p.user_id,
    r.ticket_type_id, t.key, t.name_pl, t.name_en, t.price_cents, t.currency,
    r.group_id, g.key, g.name_pl, g.name_en, g.color,
    COALESCE(gm.cnt, 0)::integer,
    r.answers, r.decided_by, r.decided_at, r.decision_source, r.decision_note,
    r.waitlist_position, r.waitlist_notified_at, r.promoted_at,
    r.cancelled_at, r.attended_at,
    (r.qr_token_hash IS NOT NULL),
    p.consent_data_processing_at, p.consent_marketing_at,
    -- ZMIANA 20261013110300: zgoda partnerska Z TEGO ZGLOSZENIA (nadanie
    -- i wycofanie), nie globalny stempel osoby z dowolnego wydarzenia.
    r.consent_partner_sharing_at, r.consent_partner_withdrawn_at,
    p.consent_withdrawn_at,
    COALESCE(ta.accepted, 0)::integer,
    COALESCE(tm.missing, 0)::integer,
    r.created_at,
    count(*) OVER ()::integer,
    r.participant_reason
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  LEFT JOIN public.crm_companies c
    ON c.id = p.company_id AND c.tenant_id = p.tenant_id
  LEFT JOIN public.event_ticket_types t
    ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
  LEFT JOIN public.event_groups g
    ON g.id = r.group_id AND g.tenant_id = r.tenant_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_group_members m
    WHERE m.tenant_id = r.tenant_id
      AND m.event_id = r.event_id
      AND m.person_id = r.person_id
  ) gm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS accepted
    FROM public.event_term_acceptances a
    JOIN public.event_terms tr
      ON tr.id = a.term_id AND tr.tenant_id = a.tenant_id
    WHERE a.tenant_id = r.tenant_id
      AND a.person_id = r.person_id
      AND tr.event_id = r.event_id
      AND a.version = tr.version
      AND a.withdrawn_at IS NULL
  ) ta ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS missing
    FROM public.event_terms tr
    WHERE tr.tenant_id = r.tenant_id
      AND tr.event_id = r.event_id
      AND tr.is_active
      AND tr.is_required
      AND NOT EXISTS (
        SELECT 1 FROM public.event_term_acceptances a
        WHERE a.tenant_id = tr.tenant_id
          AND a.term_id = tr.id
          AND a.person_id = r.person_id
          AND a.version = tr.version
          AND a.withdrawn_at IS NULL
      )
  ) tm ON true
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
    AND (p_status IS NULL OR p_status = 'all' OR r.status = p_status)
    AND (p_ticket_type_id IS NULL OR r.ticket_type_id = p_ticket_type_id)
    AND (
      p_group_id IS NULL
      OR r.group_id = p_group_id
      OR EXISTS (
        SELECT 1 FROM public.event_group_members m2
        WHERE m2.tenant_id = r.tenant_id
          AND m2.group_id = p_group_id
          AND m2.person_id = r.person_id
      )
    )
    AND (p_from IS NULL OR r.created_at >= p_from)
    AND (p_to IS NULL OR r.created_at <= p_to)
    AND (
      v_q IS NULL
      OR p.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR p.email_norm LIKE '%' || lower(v_q) || '%'
      OR p.company_text ILIKE '%' || v_q || '%'
      OR p.job_title ILIKE '%' || v_q || '%'
    )
  ORDER BY
    CASE WHEN r.status = 'waitlist' THEN 0 ELSE 1 END,
    r.waitlist_position NULLS LAST,
    r.created_at DESC,
    r.id DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer) IS
  'Lista zapisow wydarzenia dla panelu: filtry (status, bilet, grupa, fraza, zakres dat), licznik calosci do paginacji, liczba brakujacych zgod wymaganych. Zgoda partnerska (nadanie i wycofanie) z TEGO zgloszenia; consent_withdrawn_at to globalne wycofanie zgod osoby (OPS-01). decision_note = notatka WEWNETRZNA, participant_reason = powod pokazany uczestnikowi (REG-06). Nie oddaje haszy tokenow. Bramka: assert_editor_tenant(). Unia 20261013900710.';
