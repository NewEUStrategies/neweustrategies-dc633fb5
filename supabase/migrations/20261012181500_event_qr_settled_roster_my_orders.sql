-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - REG-07/REG-06/REG-03 (PRZEGLAD R45, CZ. 6): KOD QR
-- Z IDENTYFIKATORA TYLKO DLA ROZLICZONYCH, LISTA OFFLINE BEZ NIEROZLICZONYCH,
-- „MOJE ZGLOSZENIA" BEZ CUDZEGO ZAMOWIENIA, STAN ZWROTU DLA UCZESTNIKA,
-- KOLUMNY DECYZJI PRYWATNE.
--
-- DEFEKT
--   1. `admin_event_badge_batch` (20260828080509:6-116) wydaje kod QR KAZDEMU
--      niezamknietemu zgloszeniu wydrukowanej osoby: pending, waitlist,
--      przyjetemu bez wplaty (takze awansowanemu przez system przed B6).
--      Bramka online takiego wiersza nie wpuszcza (20261012150000:D), ale
--      `event_scanner_roster` (20260926150001) eksportuje go ze statusem
--      `approved`, a `decideOffline` (src/lib/events/scannerRoster.ts)
--      wpuszcza po samym statusie - obejscie bramki platnosci (D11).
--   2. `event_my_registrations` (20261012170200:B) dokleja zamowienie po
--      `r.payment_order_id`: gosc grupy widzi kwote CALEGO zamowienia
--      prowadzacego, identyfikatory Stripe i do 20 webhookow klienta Stripe
--      prowadzacego (takze z jego innych zakupow). Ocena zwrotu celowo ukrywa
--      przed gosciem sume zaplacona przez prowadzacego - ta funkcja ja oddawala.
--   3. Uczestnik odwolanego wydarzenia (zamknietego ze zwrotem przez
--      20261012181000) nie widzi stanu zwrotu - tylko „anulowane, oplacone".
--   4. Granty kolumnowe (20261012170200:A) nadal daja `authenticated`
--      `decided_by` (identyfikator konta organizatora) i wycofane
--      `cancel_reason`.
--
-- ZMIANA
--   A. `admin_event_badge_batch`: kod QR tylko dla zgloszenia rozliczonego
--      (`paid`/`partially_refunded`/`not_required`) albo swiadomej furtki
--      organizatora (`approved`/`attended` + `unpaid` + `decision_source =
--      'organizer'` - ta sama, ktora wpuszcza bramka). Pozostali dostaja
--      identyfikator bez kodu (`qr_code` null), jak osoba bez zgloszenia.
--   B. `event_scanner_roster`: przyjete, nierozliczone zgloszenie spoza
--      furtki jest „gone" - nie trafia do pelnej listy, a delta oddaje je
--      w `removed` (ten sam predykat co bramka online; `decideOffline` bez
--      zmian - listy nie trzeba mu tlumaczyc). Licznik `total` liczy to samo.
--   C. `event_my_registrations`: pola zamowienia (id, status, kwota, zwrot,
--      waluta, identyfikatory operatora, srodowisko) i webhooki TYLKO, gdy
--      wolajacy jest wlascicielem zamowienia (`o.user_id = auth.uid()`);
--      gosc widzi swoj `payment_status` i nowa flage `payment_shared`
--      (oplacone cudzym zamowieniem). Nowy `refund_state` dla zgloszen
--      zamknietych: queued | processing | review | refunded | declined - ze
--      zlecenia zamowienia, ktorego wolajacy jest wlascicielem, albo ze
--      zlecenia recznego tego zgloszenia. Reszta (participant_reason tylko
--      rejected/cancelled, cena nieoplaconego z `_event_registration_unit_price`)
--      bez zmian.
--   D. Granty kolumnowe: wzorzec DO z 20261012170200 z rozszerzona lista
--      prywatnych kolumn (+ `decided_by`, `cancel_reason`). Klient ich nie
--      czyta (src: tylko supabaseAdmin i RPC).
--
-- CZEGO TO NIE ZAMYKA. Kody QR juz wydane nierozliczonym przez stary
-- `admin_event_badge_batch` zostaja w bazie (lista offline juz ich nie
-- eksportuje, bramka online nie wpuszcza); `_event_unsettled_qr_repair`
-- (20261012150000:E) czysci je przy ponownym uruchomieniu przez serwis.
--
-- KOLEJNOSC WDROZENIA: dowolna. Nowe klucze `payment_shared`/`refund_state`
-- czyta nowy front; stary front u goscia pokazuje brak kwoty.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT (DO z katalogu),
-- COMMENT ON.
-- DOWOD: supabase/tests/event_refund_r45_test.sql.
-- ============================================================================

-- A) IDENTYFIKATORY ---------------------------------------------------------------
-- Cialo z 20260828080509:6-116. ZMIANA 20261012 (R45) oznaczona nizej.
CREATE OR REPLACE FUNCTION public.admin_event_badge_batch(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
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

    -- ZMIANA 20261012 (R45, D11): kod QR jest przepustka - tylko dla
    -- rozliczonego zgloszenia albo swiadomej furtki organizatora (przyjal
    -- nieoplacone zgloszenie decyzja). Wydruk identyfikatora nie moze dac
    -- kodu, ktorego wpuszczenie omija bramke platnosci na czytniku offline.
    IF v_row.registration_id IS NOT NULL
       AND (v_row.payment_status IN ('paid', 'partially_refunded', 'not_required')
            OR (v_row.payment_status = 'unpaid'
                AND v_row.decision_source IS NOT DISTINCT FROM 'organizer'
                AND v_row.registration_status IN ('approved', 'attended'))) THEN
      v_token := public._event_new_qr_token();
      UPDATE public.event_registrations
         SET qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
             qr_issued_at = now()
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
      'qr_code', v_token
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
  'Partia identyfikatorow (<= 200 osob) z danymi do wydruku. Kod QR (nowy, rotowany) tylko dla zgloszenia rozliczonego (paid/partially_refunded/not_required) albo furtki organizatora (approved/attended + unpaid + decision_source organizer) - R45, D11; pozostali qr_code null. Najemca z assert_editor_tenant().';

-- B) LISTA OFFLINE CZYTNIKA ------------------------------------------------------------
-- Cialo z 20260926150001. ZMIANA 20261012 (R45) oznaczona nizej.
CREATE OR REPLACE FUNCTION public.event_scanner_roster(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
      -- ZMIANA 20261012 (R45, D11): przyjete, ale nierozliczone zgloszenie
      -- spoza furtki organizatora czytnik offline traktuje jak zamkniete -
      -- `decideOffline` wpuszcza po samym statusie, wiec predykat bramki
      -- online (`_event_checkin_evaluate`) musi stac tutaj.
      (r.status IN ('cancelled', 'rejected')
       OR r.qr_token_hash IS NULL
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
    -- ZMIANA 20261012 (R45): licznik liczy to samo, co eksport.
    SELECT count(*)::integer INTO v_total
    FROM public.event_registrations r
    WHERE r.tenant_id = v_device.tenant_id
      AND r.event_id = v_device.event_id
      AND r.qr_token_hash IS NOT NULL
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

  RETURN jsonb_build_object(
    'generated_at', now(),
    'full', v_full,
    'total', v_total,
    'next_after', v_next,
    'rows', v_rows,
    'removed', v_removed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.event_scanner_roster(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_scanner_roster(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_scanner_roster(jsonb) IS
  'Lista offline skanera: skroty SHA-256 tokenow biletow wydarzenia plus minimum danych osoby (bez e-maila, telefonu i stanowiska). Przyjete, ale nierozliczone zgloszenie spoza furtki organizatora nie trafia na liste (delta: removed) - ten sam predykat co bramka online (R45, D11). Payload: {device_token, since?, after?, limit?<=2000}. Wymaga zgody administratora (offline_roster) i zakresu checkin; pelne pobranie co najmniej co 30 s, z audytem event_scanner_device.roster_downloaded.v1; delta od ostatniego pelnego pobrania z usunietymi zapisami w removed.';

-- C) „MOJE ZGLOSZENIA" ------------------------------------------------------------------
-- Cialo z 20261012170200:B. Zmiany oznaczone `ZMIANA 20261012 (R45)`.
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
      -- ZMIANA 20261012 (R45): zamowienie TYLKO dla jego wlasciciela. Gosc
      -- grupy (zamowienie prowadzacego) widzi wlasny `payment_status`
      -- i flage `payment_shared`, nie kwote calej grupy ani identyfikatory
      -- operatora.
      own.id AS order_id,
      own.status AS order_status,
      COALESCE(own.amount_cents,
        -- Bez biletu nie ma ceny (NULL jak dotad), nie "0 zl do zaplaty".
        CASE WHEN r.payment_status = 'unpaid' AND r.cancelled_at IS NULL AND tt.id IS NOT NULL
          THEN (public._event_registration_unit_price(r, tt)->>'amount_cents')::integer
        END
      ) AS amount_cents,
      own.refunded_amount_cents,
      COALESCE(own.currency, tt.currency) AS currency,
      own.provider_session_id,
      own.provider_payment_intent_id,
      own.environment,
      (o.id IS NOT NULL AND own.id IS NULL) AS payment_shared,
      -- ZMIANA 20261012 (R45): stan zwrotu zamknietego zgloszenia (takze
      -- zamknietego odwolaniem calego wydarzenia) - ze zlecenia zamowienia
      -- wolajacego albo ze zlecenia recznego tego zgloszenia.
      CASE WHEN r.status IN ('cancelled', 'rejected') THEN (
        SELECT CASE j.state
                 WHEN 'pending' THEN 'queued'
                 WHEN 'failed' THEN 'queued'
                 WHEN 'processing' THEN 'processing'
                 WHEN 'submitted' THEN 'processing'
                 WHEN 'needs_review' THEN 'review'
                 WHEN 'completed' THEN 'refunded'
                 WHEN 'cancelled' THEN 'declined'
               END
          FROM public.event_registration_refund_jobs j
         WHERE j.tenant_id = r.tenant_id
           AND ((own.id IS NOT NULL AND j.payment_order_id = own.id)
                OR (j.payment_order_id IS NULL AND j.registration_id = r.id))
         ORDER BY j.updated_at DESC, j.id
         LIMIT 1)
      END AS refund_state,
      CASE WHEN o.id IS NULL OR own.id IS NOT NULL THEN COALESCE((
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
              (own.provider_customer_id IS NOT NULL AND w2.customer_id = own.provider_customer_id)
              OR w2.user_id = v_uid
            )
          ORDER BY w2.occurred_at DESC
          LIMIT 20
        ) w
      ), '[]'::jsonb) ELSE '[]'::jsonb END AS webhooks
    FROM public.event_registrations r
    JOIN public.event_people pe ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
    LEFT JOIN public.event_ticket_types tt ON tt.id = r.ticket_type_id AND tt.tenant_id = r.tenant_id
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id
    LEFT JOIN public.payment_orders own ON own.id = o.id AND own.user_id = v_uid
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
  'Zgloszenia zalogowanego uczestnika (konto -> osoba najemcy z public_tenant_id()). REG-06: nigdy nie zwraca decision_note ani cancel_reason; participant_reason tylko dla rejected/cancelled. Kwota nieoplaconego z _event_registration_unit_price (REG-16). R45: pola zamowienia i webhooki tylko dla wlasciciela zamowienia (payment_shared = oplacone cudzym zamowieniem); refund_state (queued|processing|review|refunded|declined) dla zgloszen zamknietych.';

-- D) GRANTY KOLUMNOWE ------------------------------------------------------------------
-- Wzorzec z 20261012170200:A (lista z katalogu MINUS jawne prywatne).
-- ZMIANA 20261012 (R45): prywatne takze `decided_by` (konto organizatora)
-- i wycofane `cancel_reason`.
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
         ARRAY['decision_note', 'submitted_profile', 'manage_token_hash', 'qr_token_hash',
               'decided_by', 'cancel_reason']),
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
  'Zapis osoby na wydarzenie: osiem stanow cyklu zycia, tryb zapisu, bilet, grupa, odpowiedzi formularza, slad decyzji i HASZ tokenu QR. Jeden aktywny zapis na osobe i wydarzenie. REG-06 (D10): authenticated ma SELECT KOLUMNOWY - bez decision_note, submitted_profile, manage_token_hash, qr_token_hash (20261012170200) oraz decided_by i cancel_reason (20261012181500). Kolumna dodana pozniej jest PRYWATNA, dopoki jej migracja nie nada jawnie GRANT SELECT (kolumna) TO authenticated.';
