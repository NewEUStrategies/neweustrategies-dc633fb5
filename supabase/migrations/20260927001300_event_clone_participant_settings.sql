-- ============================================================================
-- KLON EDYCJI: USTAWIENIA UCZESTNIKA (#406), STREFA ZRODLA PRZEZ
-- `_event_safe_timezone` I PELNA LISTA DANYCH, KTORYCH KLON NIE PRZENOSI.
--
-- BLIZNIAK drizzle/migrations/0075_event_clone_participant_settings.sql - ten
-- sam SQL wykonywalny (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
-- events-harness: include
--
-- PO CO TO ISTNIEJE (przeglad klonu edycji z 20260927000800..000802)
--   1) USTAWIENIA UCZESTNIKA GINELY. `event_participant_settings`
--      (20260926153100: przypomnienia, kalendarz, przekazanie i zwrot biletu,
--      oferty listy rezerwowej, certyfikat, ankieta) nie byly kopiowane. Nowa
--      edycja cicho wracala do wartosci domyslnych
--      (`_event_participant_settings_effective`: zwrot do 168 h przed
--      startem, przekazanie wlaczone), a teksty certyfikatu i ankiety
--      znikaly. Nie mowil o tym ani podglad, ani wynik, ani ekran.
--   2) STREFA ZRODLA. `_event_clone_resolve` uznawal strefe zrodla tylko przy
--      nazwie DOKLADNIE z `pg_timezone_names`. Nazwe, ktora Postgres, Intl
--      i `_event_safe_timezone` przyjmuja (np. 'america/new_york'), zapisuje
--      `admin_event_general_save` - klon zakladal wtedy nowa edycje
--      w Europe/Warsaw i przesuwal sesje o roznice stref. Formularz odsyla
--      strefe zrodla z podgladu (`eventCloneDraft.ts`), wiec poprawka samego
--      zrodla wywracalaby klon na `invalid_timezone`.
--   3) CZEGO KLON NIE PRZENOSI. Naglowek 20260927000800 obiecuje, ze wynik
--      raportuje zakladki, zapisy na sesje i przepustki portfela jako
--      `skipped`, a `_event_clone_not_copied` ich nie liczyl.
--
-- CO ZMIENIA
--   * `_event_clone_participant_settings` (NOWA): kopia wiersza ustawien 1:1
--     (wszystkie kolumny konfiguracji, `updated_by` = aktor klonu). Bez
--     przesuniecia dat - wartosci sa wzgledne do terminu (minuty, godziny
--     i dni przed albo po wydarzeniu). Zrodlo bez wiersza = kopia bez wiersza
--     (te same wartosci domyslne). Wolana ZAWSZE, zaraz po grupach.
--   * `admin_event_clone`: wywolanie pomocnika i komentarz; reszta ciala bajt
--     w bajt z 20260927000802.
--   * `_event_clone_counts`: licznik `participant_settings` (0 albo 1).
--   * `_event_clone_not_copied`: `session_saves` (zakladki sesji),
--     `session_signups` (zapisy na sesje), `wallet_passes` (przepustki).
--   * `_event_clone_resolve`: strefa zrodla przez `_event_safe_timezone`
--     (nieznana nazwa -> Europe/Warsaw jak dotad, bez wyjatku). Strefa celu
--     pominieta albo rowna strefie zrodla jest przyjmowana bez sprawdzania
--     w `pg_timezone_names`; kazda inna nadal musi byc dokladna nazwa.
--   * `_event_clone_meetings`: strefa gieldy "rowna strefie wydarzenia"
--     porownywana bez wielkosci liter (ta sama strefa dla Postgresa).
--
-- BEZPIECZENSTWO. Nowy pomocnik jak jego rodzenstwo: SECURITY DEFINER,
--   search_path public, pg_temp, EXECUTE wylacznie service_role, odczyt zrodla
--   filtruje `tenant_id = p_tenant`. Pozostale sygnatury i REVOKE/GRANT bez
--   zmian.
--
-- KOLEJNOSC WDROZENIA: po 20260927000800..000802 (klon), 20260926153100
--   (ustawienia uczestnika, zakladki sesji) i 20260926160000 (przepustki).
--   Plikow klonu z `main` nie zmieniamy
--   (docs/WDROZENIE_FUNKCJE_ORGANIZATORA_CZ3_2026-09-27.md, sekcja 1).
--
-- Testy: scripts/events-harness/runtime_test.d/93_event_clone_participant_settings.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) USTAWIENIA UCZESTNIKA (zawsze, zaraz po grupach)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_participant_settings(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_n integer;
BEGIN
  -- Wiersz 1:1 z wydarzeniem. Nowego wydarzenia nic jeszcze nie zasialo,
  -- a ON CONFLICT nie nadpisze wiersza, gdyby jednak byl.
  INSERT INTO public.event_participant_settings (
    tenant_id, event_id,
    calendar_export_enabled, reminders_enabled, reminder_event_leads_minutes,
    session_reminders_enabled, session_reminder_lead_minutes, reminder_sms_enabled,
    transfer_enabled, transfer_deadline_hours, refund_mode, refund_deadline_hours,
    waitlist_offer_hours, certificate_enabled, certificate_eligibility,
    certificate_min_sessions, certificate_require_survey, certificate_hours,
    certificate_issuer_name, certificate_signatory_name, certificate_signatory_title_pl,
    certificate_signatory_title_en, certificate_body_pl, certificate_body_en,
    survey_enabled, survey_anonymous, survey_close_after_days, survey_min_results,
    survey_invite_enabled, survey_intro_pl, survey_intro_en, updated_by
  )
  SELECT p_tenant, p_new,
         s.calendar_export_enabled, s.reminders_enabled, s.reminder_event_leads_minutes,
         s.session_reminders_enabled, s.session_reminder_lead_minutes, s.reminder_sms_enabled,
         s.transfer_enabled, s.transfer_deadline_hours, s.refund_mode, s.refund_deadline_hours,
         s.waitlist_offer_hours, s.certificate_enabled, s.certificate_eligibility,
         s.certificate_min_sessions, s.certificate_require_survey, s.certificate_hours,
         s.certificate_issuer_name, s.certificate_signatory_name, s.certificate_signatory_title_pl,
         s.certificate_signatory_title_en, s.certificate_body_pl, s.certificate_body_en,
         s.survey_enabled, s.survey_anonymous, s.survey_close_after_days, s.survey_min_results,
         s.survey_invite_enabled, s.survey_intro_pl, s.survey_intro_en, v_uid
  FROM public.event_participant_settings s
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src
  ON CONFLICT (tenant_id, event_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object('participant_settings', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_participant_settings(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_participant_settings(uuid, uuid, uuid, jsonb)
  TO service_role;
COMMENT ON FUNCTION public._event_clone_participant_settings(uuid, uuid, uuid, jsonb) IS
  'Klon ustawien uczestnika (zawsze): wiersz event_participant_settings 1:1 (przypomnienia, kalendarz, przekazanie, zwrot, oferty listy rezerwowej, certyfikat, ankieta) bez przesuniecia - wartosci sa wzgledne do terminu; updated_by = aktor klonu. Zrodlo bez wiersza = kopia z wartosciami domyslnymi. Pomocnik klonu edycji.';

-- ----------------------------------------------------------------------------
-- 2) ROZSTRZYGNIECIE ZRODLA: strefa zrodla przez `_event_safe_timezone`
--    (cialo z 20260927000800, zmienione tylko wyliczenie strefy)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_resolve(
  p_tenant uuid, p_payload jsonb, p_require_start boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src public.events;
  v_src_id uuid;
  v_src_tz text;
  v_tz text := NULLIF(btrim(COALESCE(p_payload->>'timezone', '')), '');
  v_start timestamptz;
  v_end timestamptz;
  v_suggested timestamptz;
  v_delta interval;
  v_days integer;
BEGIN
  BEGIN
    v_src_id := NULLIF(btrim(COALESCE(p_payload->>'source_event_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_src_id := NULL;
  END;
  IF v_src_id IS NULL THEN
    RAISE EXCEPTION 'invalid_source: source_event_id must be an event id';
  END IF;

  SELECT * INTO v_src
  FROM public.events e
  WHERE e.id = v_src_id AND e.tenant_id = p_tenant;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'not_found: source event does not exist in this tenant';
  END IF;

  -- Strefa zrodla nie ma CHECK-a w bazie: ta sama regula co reszta modulu
  -- (`_event_safe_timezone`) - nazwa, ktora Postgres przyjmuje (takze
  -- 'america/new_york' zapisana przez panel), zostaje, a nieznana spada do
  -- domyslnej strefy serwisu, tak samo jak w `eventTimeZone()` frontu.
  -- Formularz odsyla strefe zrodla z podgladu, wiec strefa celu rowna strefie
  -- zrodla nie jest sprawdzana w `pg_timezone_names`; kazda inna musi byc
  -- dokladna nazwa.
  v_src_tz := public._event_safe_timezone(v_src.timezone);
  IF v_tz IS NULL OR v_tz = v_src_tz THEN
    v_tz := v_src_tz;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN
    RAISE EXCEPTION 'invalid_timezone: unknown time zone name';
  END IF;

  -- Podpowiedz: ta sama godzina lokalna rok pozniej, w strefie celu.
  v_suggested := ((v_src.starts_at AT TIME ZONE v_src_tz) + interval '1 year') AT TIME ZONE v_tz;

  BEGIN
    v_start := NULLIF(btrim(COALESCE(p_payload->>'starts_at', '')), '')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_starts_at: start must be an ISO date';
  END;
  IF v_start IS NULL THEN
    IF p_require_start THEN
      RAISE EXCEPTION 'invalid_starts_at: start date is required';
    END IF;
    v_start := v_suggested;
  END IF;

  BEGIN
    v_end := NULLIF(btrim(COALESCE(p_payload->>'ends_at', '')), '')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_ends_at: end must be an ISO date';
  END;
  IF v_end IS NOT NULL AND v_end <= v_start THEN
    RAISE EXCEPTION 'invalid_ends_at: end must be after the start';
  END IF;

  v_delta := (v_start AT TIME ZONE v_tz) - (v_src.starts_at AT TIME ZONE v_src_tz);
  v_days := (v_start AT TIME ZONE v_tz)::date - (v_src.starts_at AT TIME ZONE v_src_tz)::date;

  IF v_end IS NULL AND v_src.ends_at IS NOT NULL THEN
    v_end := public._event_clone_shift(v_src.ends_at, v_src_tz, v_tz, v_delta);
    -- Luka czasu letniego potrafi zjesc godzine krotkiego wydarzenia; koniec
    -- nie moze wtedy wypasc przed poczatkiem (CHECK `ends_at > starts_at`).
    IF v_end <= v_start THEN
      v_end := v_start + (v_src.ends_at - v_src.starts_at);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'source_event_id', v_src.id,
    'source_tz', v_src_tz,
    'timezone', v_tz,
    'starts_at', v_start,
    'ends_at', v_end,
    'suggested_starts_at', v_suggested,
    'delta', v_delta::text,
    'day_shift', v_days
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_resolve(uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_resolve(uuid, jsonb, boolean) TO service_role;
COMMENT ON FUNCTION public._event_clone_resolve(uuid, jsonb, boolean) IS
  'Waliduje zrodlo (w najemcy wolajacego), strefe, poczatek i koniec klonu i liczy przesuniecie w czasie lokalnym. Wspolne dla admin_event_clone i admin_event_clone_preview. Pomocnik klonu edycji.';


-- ----------------------------------------------------------------------------
-- 3) LICZNIKI ZRODLA (+ participant_settings) I DANE, KTORYCH KLON NIE
--    PRZENOSI (+ zakladki sesji, zapisy na sesje, przepustki portfela);
--    ciala z 20260927000800, dopisane tylko nowe klucze
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_counts(p_tenant uuid, p_src uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'groups', (SELECT count(*) FROM public.event_groups x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'rooms', (SELECT count(*) FROM public.event_rooms x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'tracks', (SELECT count(*) FROM public.event_tracks x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'sessions', (SELECT count(*) FROM public.event_sessions x
                  WHERE x.tenant_id = p_tenant AND x.event_id = p_src AND x.status <> 'cancelled'),
    'cancelled_sessions', (SELECT count(*) FROM public.event_sessions x
                            WHERE x.tenant_id = p_tenant AND x.event_id = p_src AND x.status = 'cancelled'),
    'session_speakers', (SELECT count(*) FROM public.event_session_speakers x
                          WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'speakers', (SELECT count(*) FROM public.event_speaker_entries x
                  WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'ticket_types', (SELECT count(*) FROM public.event_ticket_types x
                      WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'packages', (SELECT count(*) FROM public.event_ticket_packages x
                  WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'fields', (SELECT count(*) FROM public.event_registration_fields x
                WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'terms', (SELECT count(*) FROM public.event_terms x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'sponsor_tiers', (SELECT count(*) FROM public.event_sponsor_tiers x
                       WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'sponsors', (SELECT count(*) FROM public.event_sponsors x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'sponsor_contacts', (SELECT count(*) FROM public.event_sponsor_contacts x
                          WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'sponsor_materials', (SELECT count(*) FROM public.event_sponsor_materials x
                           WHERE x.tenant_id = p_tenant AND x.event_id = p_src)
  ) || jsonb_build_object(
    'home_ads', (SELECT count(*) FROM public.event_home_ads x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'pages', (SELECT count(*) FROM public.event_pages x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'page_sections', (SELECT count(*) FROM public.event_page_sections x
                       WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'checkpoints', (SELECT count(*) FROM public.event_checkpoints x
                     WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'badge_templates', (SELECT count(*) FROM public.event_badge_templates x
                         WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'meeting_settings', (SELECT count(*) FROM public.event_meeting_settings x
                          WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'meeting_tables', (SELECT count(*) FROM public.event_meeting_tables x
                        WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'codes', (SELECT count(*) FROM public.b2b_coupons x
               WHERE x.tenant_id = p_tenant AND x.event_ids = ARRAY[p_src]),
    'cfp_settings', (SELECT count(*) FROM public.event_cfp_settings x
                      WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'cfp_fields', (SELECT count(*) FROM public.event_cfp_fields x
                    WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'cfp_reviewers', (SELECT count(*) FROM public.event_cfp_reviewers x
                       WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'seat_maps', (SELECT count(*) FROM public.event_seat_maps x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'seats', (SELECT count(*) FROM public.event_seats x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'ad_campaigns', (SELECT count(*) FROM public.event_ad_campaigns x
                      WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'participant_settings', (SELECT count(*) FROM public.event_participant_settings x
                              WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'renewal_contacts', (SELECT count(DISTINCT x.lead_id) FROM public.event_sponsor_contacts x
                          WHERE x.tenant_id = p_tenant AND x.event_id = p_src AND x.role = 'primary')
  );
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_counts(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_counts(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_clone_counts(uuid, uuid) IS
  'Liczby wierszy konfiguracji wydarzenia zrodla per sekcja klonu (etykiety przelacznikow podgladu). Pomocnik klonu edycji.';


CREATE OR REPLACE FUNCTION public._event_clone_not_copied(p_tenant uuid, p_src uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'registrations', (SELECT count(*) FROM public.event_registrations x
                       WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'package_orders', (SELECT count(*) FROM public.event_package_orders x
                        WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'checkins', (SELECT count(*) FROM public.event_checkins x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'lead_scans', (SELECT count(*) FROM public.event_lead_scans x
                    WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'meetings', (SELECT count(*) FROM public.event_meetings x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'scanner_devices', (SELECT count(*) FROM public.event_scanner_devices x
                         WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'cfp_submissions', (SELECT count(*) FROM public.event_cfp_submissions x
                         WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'seat_assignments', (SELECT count(*) FROM public.event_seat_assignments x
                          WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'invoices', (SELECT count(*) FROM public.event_invoices x WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'session_saves', (SELECT count(*) FROM public.event_session_saves x
                       WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'session_signups', (SELECT count(*) FROM public.event_session_signups x
                         WHERE x.tenant_id = p_tenant AND x.event_id = p_src),
    'wallet_passes', (SELECT count(*) FROM public.event_wallet_passes x
                       WHERE x.tenant_id = p_tenant AND x.event_id = p_src)
  );
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_not_copied(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_not_copied(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_clone_not_copied(uuid, uuid) IS
  'Liczby danych osobowych i transakcyjnych zrodla, ktorych klon z zasady NIE przenosi (zapisy, zamowienia, odprawy, skany, spotkania, urzadzenia, zgloszenia, przydzialy, faktury, zakladki sesji, zapisy na sesje, przepustki portfela). Pomocnik klonu edycji.';


-- ----------------------------------------------------------------------------
-- 4) GIELDA SPOTKAN: strefa gieldy rowna strefie wydarzenia bez wielkosci
--    liter (cialo z 20260927000801, zmienione tylko porownanie strefy)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_meetings(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_days integer := (p_ctx->>'day_shift')::integer;
  v_settings integer;
  v_tables integer;
  v_rules integer;
BEGIN
  -- Dni gieldy przesuwaja sie o cale dni lokalne; strefa gieldy idzie za
  -- strefa wydarzenia, jesli byla z nia rowna.
  INSERT INTO public.event_meeting_settings (
    id, tenant_id, event_id, is_enabled, slot_minutes, break_minutes, day_start_time,
    day_end_time, meeting_days, timezone, invites_open_at, invites_close_at,
    max_invites_per_person, max_meetings_per_day, invite_expires_after_hours, visibility,
    intro_pl, intro_en, updated_by
  )
  SELECT public._event_clone_id(p_new, m.id), p_tenant, p_new, m.is_enabled, m.slot_minutes,
         m.break_minutes, m.day_start_time, m.day_end_time,
         ARRAY(
           SELECT u.d + v_days FROM unnest(m.meeting_days) WITH ORDINALITY AS u(d, ord)
           ORDER BY u.ord
         ),
         CASE WHEN lower(m.timezone) = lower(v_src_tz) THEN v_tz ELSE m.timezone END,
         public._event_clone_shift(m.invites_open_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(m.invites_close_at, v_src_tz, v_tz, v_delta),
         m.max_invites_per_person, m.max_meetings_per_day, m.invite_expires_after_hours,
         m.visibility, m.intro_pl, m.intro_en, v_uid
  FROM public.event_meeting_settings m
  WHERE m.tenant_id = p_tenant AND m.event_id = p_src;
  GET DIAGNOSTICS v_settings = ROW_COUNT;

  INSERT INTO public.event_meeting_tables (
    id, tenant_id, event_id, label, zone, capacity, room_id, note, is_active, sort_order,
    created_by
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.label, t.zone, t.capacity,
         (SELECT r.id FROM public.event_rooms r
           WHERE r.tenant_id = p_tenant AND r.event_id = p_new
             AND r.id = public._event_clone_id(p_new, t.room_id)),
         t.note, t.is_active, t.sort_order, v_uid
  FROM public.event_meeting_tables t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_tables = ROW_COUNT;

  INSERT INTO public.event_meeting_rule_groups (id, tenant_id, event_id, group_id, side)
  SELECT public._event_clone_id(p_new, g.id), p_tenant, p_new,
         public._event_clone_id(p_new, g.group_id), g.side
  FROM public.event_meeting_rule_groups g
  WHERE g.tenant_id = p_tenant AND g.event_id = p_src;
  GET DIAGNOSTICS v_rules = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'meeting_settings', v_settings, 'meeting_tables', v_tables, 'meeting_rules', v_rules
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_meetings(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_meetings(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_meetings(uuid, uuid, uuid, jsonb) IS
  'Klon ustawien gieldy spotkan (dni i okno zaproszen przesuniete), stolikow i regul grup. Spotkan i dostepnosci nigdy. Pomocnik klonu edycji.';

-- ----------------------------------------------------------------------------
-- 5) KLON: ustawienia uczestnika zaraz po grupach
--    (cialo z 20260927000802, dopisane tylko wywolanie pomocnika)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_clone(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_uid uuid := auth.uid();
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_key text := NULLIF(btrim(COALESCE(v_payload->>'idempotency_key', '')), '');
  v_cmd public.command_idempotency;
  v_set jsonb;
  v_inc jsonb;
  v_opt jsonb;
  v_res jsonb;
  v_src public.events;
  v_title_pl text := btrim(COALESCE(v_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(v_payload->>'title_en', ''));
  v_slug_explicit text := NULLIF(lower(btrim(COALESCE(v_payload->>'slug', ''))), '');
  v_slug text;
  v_external text;
  v_new uuid;
  v_try integer;
  v_window jsonb;
  v_warnings jsonb;
  v_ctx jsonb;
  v_parts jsonb[] := ARRAY[]::jsonb[];
  v_part jsonb;
  v_copied jsonb := '{}'::jsonb;
  v_skipped jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  -- 0. Idempotencja w TEJ SAMEJ transakcji: awaria cofa zajecie klucza,
  --    rownolegly duplikat czeka na kluczu glownym i czyta wynik pierwszego.
  IF v_key IS NOT NULL THEN
    IF char_length(v_key) < 8 OR char_length(v_key) > 200 THEN
      RAISE EXCEPTION 'invalid_idempotency_key: key must have 8-200 characters';
    END IF;
    INSERT INTO public.command_idempotency (tenant_id, idempotency_key, command, actor_id, correlation_id)
    VALUES (v_tenant, v_key, 'event.clone', v_uid, public.request_correlation_id())
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
    IF NOT FOUND THEN
      SELECT * INTO v_cmd FROM public.command_idempotency c
      WHERE c.tenant_id = v_tenant AND c.idempotency_key = v_key;
      IF v_cmd.actor_id IS DISTINCT FROM v_uid OR v_cmd.command <> 'event.clone' THEN
        RAISE EXCEPTION 'idempotency_conflict: the key belongs to another command or person';
      END IF;
      IF v_cmd.status = 'succeeded' AND v_cmd.result IS NOT NULL THEN
        RETURN v_cmd.result || jsonb_build_object('replayed', true);
      END IF;
      RAISE EXCEPTION 'clone_in_progress: the same copy is still running';
    END IF;
  END IF;

  -- 1. Ustawienia, zrodlo (w najemcy wolajacego) i przesuniecie.
  v_set := public._event_clone_settings(v_payload, true);
  v_inc := v_set->'include';
  v_opt := v_set->'options';
  v_res := public._event_clone_resolve(v_tenant, v_payload, true);

  -- Blokada klucza: zrodla nie da sie skasowac w trakcie kopiowania.
  SELECT * INTO v_src FROM public.events e
  WHERE e.id = (v_res->>'source_event_id')::uuid AND e.tenant_id = v_tenant
  FOR KEY SHARE;

  -- 2. Walidacja pol nowej edycji.
  IF v_title_pl = '' OR v_title_en = ''
     OR char_length(v_title_pl) > 200 OR char_length(v_title_en) > 200 THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required (at most 200 characters)';
  END IF;

  IF v_slug_explicit IS NOT NULL THEN
    IF v_slug_explicit !~ '^[a-z0-9-]{3,120}$' THEN
      RAISE EXCEPTION 'invalid_slug: slug must be 3-120 chars of a-z, 0-9 and dashes';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.slug = v_slug_explicit
    ) THEN
      RAISE EXCEPTION 'slug_taken: another event already uses this address';
    END IF;
  END IF;

  v_external := v_src.external_registration_url;
  IF v_payload ? 'external_registration_url' THEN
    v_external := NULLIF(btrim(COALESCE(v_payload->>'external_registration_url', '')), '');
  END IF;
  IF v_src.registration_mode = 'external' AND v_external IS NULL THEN
    RAISE EXCEPTION 'external_url_required: this mode registers people elsewhere and needs a url';
  END IF;
  IF v_external IS NOT NULL
     AND (v_external !~* '^https://[^[:space:]]+$' OR char_length(v_external) > 2048) THEN
    RAISE EXCEPTION 'external_url_invalid: url must start with https and be under 2048 chars';
  END IF;

  -- 3. Okno wydarzenia kontra przesuniete sesje - PRZED zapisem.
  v_window := public._event_clone_session_window(v_tenant, v_src.id, v_res, v_inc, v_opt);
  IF (v_window->>'outside')::integer > 0 THEN
    RAISE EXCEPTION 'clone_sessions_outside_window: % session(s) would fall outside the new event dates',
      v_window->>'outside';
  END IF;

  v_warnings := public._event_clone_forecast(
    v_tenant, v_src.id, v_res, v_inc, v_opt, v_payload ? 'external_registration_url'
  );

  -- 4. Wiersz wydarzenia (zawsze szkic). Slug generowany ponawia sie po
  --    wyscigu na unikalnosci; slug podany wprost konczy sie `slug_taken`.
  FOR v_try IN 1..5 LOOP
    v_slug := COALESCE(
      v_slug_explicit, public._event_clone_slug_candidate(v_tenant, v_title_pl, v_src.slug)
    );
    BEGIN
      INSERT INTO public.events (
        tenant_id, slug, title_pl, title_en, description_pl, description_en, kind,
        starts_at, ends_at, timezone, location, street_address, city, region, postal_code,
        country, region_id, visibility, min_tier_rank, capacity, status, host_user_id,
        chatham_house, cover_url, created_by, event_type_id, format, registration_mode,
        registration_flow, guest_mode, external_registration_url, branding,
        video_header_platform, video_header_id, social_hashtag, support_email, languages,
        home_design, pages_display_mode, features, rsvp_opens_at, early_rsvp_rank,
        ticket_price_cents, ticket_currency, program_id, discussion_club_id,
        discussion_group_id, previous_edition_id
      ) VALUES (
        v_tenant, v_slug, v_title_pl, v_title_en, v_src.description_pl, v_src.description_en,
        v_src.kind, (v_res->>'starts_at')::timestamptz, (v_res->>'ends_at')::timestamptz,
        v_res->>'timezone', v_src.location, v_src.street_address, v_src.city, v_src.region,
        v_src.postal_code, v_src.country, v_src.region_id, v_src.visibility,
        v_src.min_tier_rank, v_src.capacity, 'draft', v_src.host_user_id,
        v_src.chatham_house, v_src.cover_url, v_uid, v_src.event_type_id, v_src.format,
        v_src.registration_mode, v_src.registration_flow, v_src.guest_mode, v_external,
        v_src.branding, v_src.video_header_platform, v_src.video_header_id,
        v_src.social_hashtag, v_src.support_email, v_src.languages, v_src.home_design,
        v_src.pages_display_mode, v_src.features,
        public._event_clone_shift(
          v_src.rsvp_opens_at, v_res->>'source_tz', v_res->>'timezone', (v_res->>'delta')::interval
        ),
        v_src.early_rsvp_rank, v_src.ticket_price_cents, v_src.ticket_currency,
        v_src.program_id, v_src.discussion_club_id, v_src.discussion_group_id, v_src.id
      )
      RETURNING id INTO v_new;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_slug_explicit IS NOT NULL THEN
        RAISE EXCEPTION 'slug_taken: another event already uses this address';
      END IF;
      IF v_try = 5 THEN RAISE; END IF;
    END;
  END LOOP;

  v_ctx := jsonb_build_object(
    'src_tz', v_res->>'source_tz', 'tz', v_res->>'timezone', 'delta', v_res->>'delta',
    'day_shift', (v_res->>'day_shift')::integer, 'uid', v_uid, 'src_slug', v_src.slug,
    'slug', v_slug, 'title_pl', v_title_pl, 'title_en', v_title_en,
    'src_title_pl', v_src.title_pl, 'include', v_inc, 'options', v_opt
  );

  -- 5. Moduly w porzadku kluczy obcych (grupy i sale przed wszystkim, co je
  --    wskazuje; sponsorzy przed sciezkami i sesjami; sesje przed obsada,
  --    punktami odprawy i planem sali; bilety przed pakietami, kategoriami
  --    miejsc, naborem i kodami).
  v_parts := array_append(v_parts, public._event_clone_groups(v_tenant, v_src.id, v_new, v_ctx));
  -- Ustawienia uczestnika tez zawsze: bez wiersza nowa edycja cicho wraca do
  -- wartosci domyslnych (zwrot, przekazanie, certyfikat, ankieta).
  v_parts := array_append(
    v_parts, public._event_clone_participant_settings(v_tenant, v_src.id, v_new, v_ctx)
  );
  IF (v_inc->>'agenda')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_rooms(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  v_parts := array_append(v_parts, public._event_clone_sponsors(v_tenant, v_src.id, v_new, v_ctx));
  IF (v_inc->>'agenda')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_agenda(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'speakers')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_speakers(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'tickets')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_tickets(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'registration')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_registration(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  -- Korzen i piec stron modulowych jak przy `admin_event_create` - takze bez
  -- sekcji "strony" (wydarzenie bez menu byloby zepsute).
  PERFORM public._event_seed_default_pages(v_tenant, v_new);
  IF (v_inc->>'pages')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_pages(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'onsite')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_onsite(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'meetings')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_meetings(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'cfp')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_cfp(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'seating')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_seating(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'ad_campaigns')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_ad_campaigns(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'home_ads')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_home_ads(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'codes')::boolean AND (v_inc->>'tickets')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_codes(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  v_parts := array_append(v_parts, public._event_clone_crm(v_tenant, v_src.id, v_new, v_ctx));

  FOREACH v_part IN ARRAY v_parts LOOP
    v_copied := v_copied || COALESCE(v_part->'copied', '{}'::jsonb);
    v_skipped := v_skipped || COALESCE(v_part->'skipped', '{}'::jsonb);
  END LOOP;

  -- 6. Wynik, zapamietany dla powtorzen, i zdarzenie domenowe.
  v_result := jsonb_build_object(
    'event_id', v_new,
    'slug', v_slug,
    'source_event_id', v_src.id,
    'replayed', false,
    'shift', jsonb_build_object(
      'delta', v_res->>'delta', 'day_shift', (v_res->>'day_shift')::integer,
      'source_tz', v_res->>'source_tz', 'timezone', v_res->>'timezone'
    ),
    'copied', v_copied,
    'skipped', v_skipped || public._event_clone_not_copied(v_tenant, v_src.id),
    'warnings', v_warnings
  );

  IF v_key IS NOT NULL THEN
    UPDATE public.command_idempotency c
       SET status = 'succeeded', result = v_result, completed_at = now()
     WHERE c.tenant_id = v_tenant AND c.idempotency_key = v_key;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event',
    v_new::text,
    'event.cloned.v1',
    jsonb_build_object('event_id', v_new, 'source_event_id', v_src.id),
    auth.uid()
  );

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_event_clone(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_clone(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_clone(jsonb) IS
  'Nowa edycja wydarzenia z poprzedniej: kopia konfiguracji (grupy, ustawienia uczestnika, agenda, prelegenci, bilety, formularz, regulaminy, sponsorzy, strony, obsluga na miejscu, gielda spotkan, nabor, plan sali, opcjonalnie kampanie, reklamy i kody) z przesunieciem dat w czasie lokalnym strefy wydarzenia; zawsze szkic, idempotentna po idempotency_key. Nie kopiuje zapisow, zamowien, odpraw, skanow, spotkan, urzadzen, zgloszen, przydzialow, faktur, zakladek sesji, zapisow na sesje ani przepustek portfela. Bramka: assert_event_admin_tenant().';

