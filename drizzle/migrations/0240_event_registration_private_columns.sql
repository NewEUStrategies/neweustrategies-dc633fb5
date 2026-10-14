-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - REG-06: NOTATKA WEWNETRZNA ORGANIZATORA NIE DOCIERA
-- DO UCZESTNIKA ZADNA DROGA (RPC, MAIL, BEZPOSREDNI ODCZYT TABELI).
--
-- DEFEKT
--   1. `event_my_registrations` (20260929095900:51-138) zwraca
--      `COALESCE(cancel_reason, decision_note) AS cancel_reason` dla KAZDEGO
--      statusu (:86), a `cancel_reason` nigdy nie jest pisana - uczestnik widzi
--      w „Moich biletach" wewnetrzna notatke organizatora („Notatka
--      organizatora: ..."), takze przy przyjetym zgloszeniu.
--   2. `admin_event_registration_notify_payload` (20260825223802:2-77) oddaje
--      `decision_note` (:22), a mail o odrzuceniu wstawia ja jako
--      „Uzasadnienie organizatora".
--   3. `GRANT SELECT ON event_registrations TO authenticated`
--      (20260823150000:797) + polityka `event_registrations_self_read`:
--      zalogowany uczestnik czyta `decision_note` (i hashe klucza samoobslugi
--      i biletu, i dane zgloszone przez niezweryfikowany formularz) wprost przez
--      PostgREST, z pominieciem kazdej poprawki RPC. To samo dla
--      `event_people.notes` (notatka organizatora o osobie).
--   4. Kwota nieoplaconego zgloszenia w „Moich zgloszeniach" to golym
--      `price_cents` biletu - bez early birda, harmonogramu i oferty z chwili
--      zapisu (REG-16, D8).
--
-- ZMIANA
--   A. Granty kolumnowe (D10): authenticated czyta KAZDA istniejaca kolumne
--      `event_registrations` POZA `decision_note`, `submitted_profile`,
--      `manage_token_hash`, `qr_token_hash` i kazda kolumne `event_people`
--      POZA `notes`. Lista budowana z katalogu w chwili migracji (odporna na
--      roznice ksztaltu harnessu i produkcji), wykluczenia jawne. Kolumny
--      dodane PO tej migracji sa PRYWATNE domyslnie (granty kolumnowe nie
--      przechodza na nowe kolumny) - nowa kolumna czytana przez klienta
--      wymaga jawnego GRANT SELECT (kolumna) w swojej migracji. Polityki RLS
--      innych tabel (spotkania, ksiega zgod, regulaminy) czytaja tylko
--      id/tenant_id/person_id/user_id - zostaja.
--   B. `event_my_registrations`: `participant_reason` tylko dla
--      rejected/cancelled, ZADNEGO `decision_note` ani `cancel_reason`; kwota
--      nieoplaconego przez `_event_registration_unit_price`.
--   C. `admin_event_registration_notify_payload`: `participant_reason`
--      (rejected/cancelled) zamiast `decision_note`.
--   D. `admin_event_registrations_list`: nowa kolumna `participant_reason`
--      (organizator widzi, co powiedzial uczestnikowi). DROP + CREATE (nowa
--      kolumna wyniku), granty bez zmian.
--
-- CZEGO TO NIE ZAMYKA. `decision_note` nadal kopiuje sie na gosci grupy przy
-- kaskadzie (wewnetrznie, wymaga tego CHECK rejection_has_reason); goscie nie
-- dostaja `participant_reason` (fail-closed). Stary
-- `event_registration_notify_payload` nalezy do B7 (i tak zwraca NULL).
--
-- KOLEJNOSC WDROZENIA: dowolna. Front czyta `participant_reason` (nowa baza)
-- i nic nie pokazuje przy starej; stary front na nowej bazie nie dostaje juz
-- `cancel_reason`, wiec tez nic nie pokazuje. Zaden klient nie czyta tych
-- tabel wprost jako authenticated (src: tylko supabaseAdmin).
-- IDEMPOTENTNA: bezstanowe REVOKE/GRANT (DO z katalogu), CREATE OR REPLACE,
-- DROP FUNCTION IF EXISTS + CREATE + GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_registration_participant_reason_test.sql,
-- scripts/events-harness/runtime_test.d/24_cancel_refund_visibility.sql.
-- ============================================================================

-- A) GRANTY KOLUMNOWE --------------------------------------------------------------
-- Lista kolumn z katalogu w chwili migracji MINUS jawna lista prywatnych:
-- ta sama migracja dziala na produkcji i na harnessie (inny zestaw kolumn
-- modulow), a wykluczenie, ktorego kolumny nie ma, jest po prostu pomijane.
-- REVOKE na tabeli zdejmuje tez granty kolumnowe; prywatne kolumny
-- odbieramy dodatkowo jawnie (anon tez) - powtorne uruchomienie albo czyjs
-- wczesniejszy grant kolumnowy nie zostawia furtki.
DO $grants$
DECLARE
  v_spec record;
  v_cols text;
  v_private text;
BEGIN
  FOR v_spec IN
    SELECT *
      FROM (VALUES
        ('public.event_registrations'::regclass,
         ARRAY['decision_note', 'submitted_profile', 'manage_token_hash', 'qr_token_hash']),
        ('public.event_people'::regclass, ARRAY['notes'])
      ) AS t(rel, private_cols)
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
            FILTER (WHERE NOT a.attname = ANY (v_spec.private_cols)),
           string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
            FILTER (WHERE a.attname = ANY (v_spec.private_cols))
      INTO v_cols, v_private
      FROM pg_attribute a
     WHERE a.attrelid = v_spec.rel
       AND a.attnum > 0
       AND NOT a.attisdropped;

    EXECUTE format('REVOKE SELECT ON %s FROM authenticated', v_spec.rel);
    EXECUTE format('GRANT SELECT (%s) ON %s TO authenticated', v_cols, v_spec.rel);
    IF v_private IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT (%s) ON %s FROM authenticated, anon', v_private, v_spec.rel);
    END IF;
  END LOOP;
END
$grants$;

COMMENT ON TABLE public.event_registrations IS
  'Zapis osoby na wydarzenie: osiem stanow cyklu zycia, tryb zapisu, bilet, grupa, odpowiedzi formularza, slad decyzji i HASZ tokenu QR. Jeden aktywny zapis na osobe i wydarzenie. REG-06 (D10): authenticated ma SELECT KOLUMNOWY - bez decision_note, submitted_profile, manage_token_hash i qr_token_hash (20261012170200). Kolumna dodana pozniej jest PRYWATNA, dopoki jej migracja nie nada jawnie GRANT SELECT (kolumna) TO authenticated.';
COMMENT ON TABLE public.event_people IS
  'Kartoteka osob najemcy dla modulu Wydarzen. Osoba istnieje BEZ konta w auth.users; user_id jest opcjonalnym dowiazaniem. Adres poczty unikalny w granicach najemcy. REG-06 (D10): authenticated ma SELECT KOLUMNOWY - bez notes (notatka organizatora, 20261012170200). Kolumna dodana pozniej jest PRYWATNA, dopoki jej migracja nie nada jawnie GRANT SELECT (kolumna) TO authenticated.';

-- B) „MOJE ZGLOSZENIA" -------------------------------------------------------------
-- Cialo z 20260929095900:51-138. Zmiany (ZMIANA 20261012):
--   * REG-06: bez `cancel_reason`/`decision_note`; `participant_reason` tylko
--     dla rejected/cancelled (stary powod na ponownie otwartym wierszu nie
--     wraca);
--   * REG-16 (D8): kwota nieoplaconego przez `_event_registration_unit_price`.
CREATE OR REPLACE FUNCTION public.event_my_registrations(p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit','')::integer, 20), 1), 50);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your registrations';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      r.id AS registration_id,
      r.event_id,
      r.ticket_type_id,
      r.status,
      r.payment_status,
      r.created_at,
      r.cancelled_at,
      r.paid_at,
      r.waitlist_position,
      r.promoted_at,
      r.notify_email,
      r.notify_sms,
      CASE WHEN r.status IN ('rejected', 'cancelled')
        THEN NULLIF(btrim(r.participant_reason), '')
      END AS participant_reason,
      r.decision_source,
      e.slug AS event_slug,
      e.title_pl AS event_title_pl,
      e.title_en AS event_title_en,
      e.starts_at AS event_starts_at,
      e.ends_at AS event_ends_at,
      e.timezone AS event_timezone,
      o.id AS order_id,
      o.status AS order_status,
      COALESCE(o.amount_cents,
        -- Bez biletu nie ma ceny (NULL jak dotad), nie "0 zl do zaplaty".
        CASE WHEN r.payment_status = 'unpaid' AND r.cancelled_at IS NULL AND tt.id IS NOT NULL
          THEN (public._event_registration_unit_price(r, tt)->>'amount_cents')::integer
        END
      ) AS amount_cents,
      o.refunded_amount_cents,
      COALESCE(o.currency, tt.currency) AS currency,
      o.provider_session_id,
      o.provider_payment_intent_id,
      o.environment,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', w.id,
                 'event_type', w.event_type,
                 'status', w.status,
                 'occurred_at', w.occurred_at,
                 'processed_at', w.processed_at,
                 'retry_count', w.retry_count
               ) ORDER BY w.occurred_at DESC)
        FROM (
          SELECT w2.*
          FROM public.payment_webhook_events w2
          WHERE w2.tenant_id = r.tenant_id
            AND (
              (o.provider_customer_id IS NOT NULL AND w2.customer_id = o.provider_customer_id)
              OR w2.user_id = v_uid
            )
          ORDER BY w2.occurred_at DESC
          LIMIT 20
        ) w
      ), '[]'::jsonb) AS webhooks
    FROM public.event_registrations r
    JOIN public.event_people pe ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
    LEFT JOIN public.event_ticket_types tt ON tt.id = r.ticket_type_id AND tt.tenant_id = r.tenant_id
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id
    WHERE r.tenant_id = v_tenant
      AND pe.user_id = v_uid
    ORDER BY r.created_at DESC
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object('registrations', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.event_my_registrations(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_registrations(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_registrations(jsonb) IS
  'Zgloszenia zalogowanego uczestnika (konto -> osoba najemcy z public_tenant_id()). REG-06: nigdy nie zwraca decision_note ani cancel_reason; participant_reason tylko dla rejected/cancelled. Kwota nieoplaconego z _event_registration_unit_price (REG-16).';

-- C) DANE DO MAILA O DECYZJI ---------------------------------------------------------
-- Cialo z 20260825223802:2-77 (search_path z 20260830120000). ZMIANA 20261012
-- (REG-06): `participant_reason` (tylko rejected/cancelled) zamiast
-- `decision_note` - ladunek sluzy wylacznie do maila dla uczestnika.
CREATE OR REPLACE FUNCTION public.admin_event_registration_notify_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_out jsonb;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: registration_id is required';
  END IF;

  SELECT jsonb_build_object(
    'registration_id', r.id,
    'tenant_id', r.tenant_id,
    'status', r.status,
    'participant_reason', CASE WHEN r.status IN ('rejected', 'cancelled')
      THEN NULLIF(btrim(r.participant_reason), '') END,
    'waitlist_position', r.waitlist_position,
    'decided_at', r.decided_at,
    'promoted_at', r.promoted_at,
    'waitlist_notified_at', r.waitlist_notified_at,
    'email', p.email,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'lang', COALESCE(
      CASE
        WHEN lower(NULLIF(pr.prefs->>'language', '')) IN ('pl', 'en')
          THEN lower(pr.prefs->>'language')
        WHEN lower(NULLIF(pr.prefs->>'lang', '')) IN ('pl', 'en')
          THEN lower(pr.prefs->>'lang')
        ELSE NULL
      END,
      (
        SELECT lower(ns.language)
        FROM public.newsletter_subscribers ns
        WHERE ns.tenant_id = r.tenant_id
          AND lower(ns.email) = lower(p.email)
          AND lower(ns.language) IN ('pl', 'en')
        LIMIT 1
      ),
      'pl'
    ),
    'event_id', e.id,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_starts_at', e.starts_at,
    'event_timezone', e.timezone,
    'event_location', e.location,
    'ticket_name_pl', tt.name_pl,
    'ticket_name_en', tt.name_en
  )
  INTO v_out
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  JOIN public.events e
    ON e.id = r.event_id AND e.tenant_id = r.tenant_id
  LEFT JOIN public.profiles pr
    ON pr.id = p.user_id AND pr.tenant_id = r.tenant_id
  LEFT JOIN public.event_ticket_types tt
    ON tt.id = r.ticket_type_id AND tt.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tenant
    AND r.id = v_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this organisation';
  END IF;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_notify_payload(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_notify_payload(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_notify_payload(jsonb) IS
  'Dane JEDNEGO zgloszenia do maila o decyzji: adres, imie, jezyk odbiorcy (profil -> newsletter -> pl), najemca, status, tytul i termin wydarzenia. REG-06: participant_reason (tylko rejected/cancelled), NIGDY decision_note. Bramka: assert_editor_tenant().';

-- D) LISTA ZGLOSZEN ORGANIZATORA -----------------------------------------------------
-- Cialo z 20260824090214:632-795. ZMIANA 20261012 (REG-06): kolumna
-- `participant_reason` na koncu wyniku (nowa kolumna wyniku = DROP + CREATE).
DROP FUNCTION IF EXISTS public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer);

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
  consent_withdrawn_at timestamptz,
  accepted_terms_count integer,
  required_terms_missing integer,
  created_at timestamptz,
  total_count integer,
  participant_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
    p.consent_partner_sharing_at, p.consent_withdrawn_at,
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
  'Lista zapisow wydarzenia dla panelu: filtry (status, bilet, grupa, fraza, zakres dat), licznik calosci do paginacji, liczba brakujacych zgod wymaganych. Nie oddaje haszy tokenow. decision_note = notatka WEWNETRZNA, participant_reason = powod pokazany uczestnikowi (REG-06). Bramka: assert_editor_tenant().';