-- ============================================================================
-- FUNKCJE UCZESTNIKA F1-F5: FUNDAMENT (spec B.3.1, decyzje D8/D12/D13, R-1).
--
-- events-harness: include
--
-- PO CO. Piec funkcji uczestnika (plan i kalendarz, przypomnienia, przekazanie
-- i zwrot biletu, platna lista rezerwowa, certyfikat i ankieta) potrzebuje
-- wspolnego podlogi, ktora zaklada JEDEN autor, zanim trzy tory rusza
-- rownolegle:
--   * pomocnicy bez stanu: bezpieczna strefa czasowa (`_event_safe_timezone`),
--     efektywny koniec wydarzenia (`_event_effective_end`, parytet z TS
--     `eventEffectiveEnd`), cisza nocna w strefie wydarzenia
--     (`_event_local_quiet`);
--   * rozpoznanie aktora zgloszenia (posiadacz / zglaszajacy / platnik)
--     i jezyk odbiorcy (`_event_registration_actor`, `_event_registration_lang`)
--     - kazdy konsument czyta jezyk WYLACZNIE przez helper, nigdy `r.lang`;
--   * sprzatanie po utracie miejsca (`_event_participant_release`,
--     `_event_legacy_rsvp_release`) - wolane przez D0 (zwrot) i tor B
--     (przekazanie, samodzielny zwrot);
--   * ustawienia organizatora 1:1 z wydarzeniem (`event_participant_settings`,
--     odczyt WYLACZNIE przez `_event_participant_settings_effective`),
--     RPC panelu (get/save z regula „brak klucza = bez zmian") i publiczne,
--     niezalezne od widza `event_participant_options(slug)`;
--   * jeden dziennik doreczen z UNIKALNYM kluczem deduplikacji
--     (`event_message_deliveries` + `_event_delivery_claim|confirm`);
--   * tabela zapisanych sesji planu (`event_session_saves`, D7);
--   * kolumny zgloszenia: `lang` (NULLABLE, R-1), preferencje przypomnien
--     i stempel zgody SMS (D8, R-6).
--
-- CZEGO TA MIGRACJA NIE ROBI. Nie dotyka katalogu rodzajow powiadomien ani
-- ACL `rate_limit_hit` (to `20260926100200`, bez znacznika harnessu), nie
-- redefiniuje RPC zapisow ani platnosci (D0 w `20260926100100`, reszta tor B),
-- nie zaklada triggerow na nowych tabelach poza stemplem `updated_at`
-- (straznik anonimowosci ankiety na ustawieniach zaklada tor C).
--
-- R-1 (jezyk): kolumna jest NULLABLE, bez triggera dziedziczenia; domyslne
-- `pl` stosuje dopiero `_event_registration_lang()` przy odczycie. NOT NULL
-- DEFAULT zabilby istniejaca kaskade (profil -> newsletter) i zaczerwienil
-- `runtime_test.d/26_group_tickets.sql`.
--
-- KOLEJNOSC BLOKAD (A.3): zadna funkcja tej migracji nie zmienia statusu ani
-- rodzaju biletu zgloszenia. `_event_participant_release` blokuje wiersze
-- `event_sessions` (ostatni szczebel globalnej kolejnosci) w porzadku
-- `session_id`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Pomocnicy bez stanu
-- ----------------------------------------------------------------------------

-- LOCKS: none.
CREATE OR REPLACE FUNCTION public._event_safe_timezone(_tz text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF _tz IS NULL OR btrim(_tz) = '' THEN
    RETURN 'Europe/Warsaw';
  END IF;
  PERFORM now() AT TIME ZONE _tz;
  RETURN _tz;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN 'Europe/Warsaw';
END;
$function$;
COMMENT ON FUNCTION public._event_safe_timezone(text) IS
  'Strefa czasowa bezpieczna dla skanerow zbiorczych: NULL/pusta albo nieznana nazwa (np. Mars/Base) daje Europe/Warsaw zamiast wyjatku, ktory wywrocilby cala partie.';
REVOKE ALL ON FUNCTION public._event_safe_timezone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_safe_timezone(text) TO authenticated, service_role;

-- LOCKS: none.
CREATE OR REPLACE FUNCTION public._event_effective_end(_starts timestamptz, _ends timestamptz)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(_ends, _starts + interval '24 hours');
$function$;
COMMENT ON FUNCTION public._event_effective_end(timestamptz, timestamptz) IS
  'Efektywny koniec wydarzenia: ends_at albo starts_at + 24 h. Parytet z TS eventEffectiveEnd (src/lib/events/effectiveEnd.ts). Od tej chwili otwiera sie ankieta i liczy dostepnosc certyfikatu.';
REVOKE ALL ON FUNCTION public._event_effective_end(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_effective_end(timestamptz, timestamptz) TO authenticated, service_role;

-- LOCKS: none.
CREATE OR REPLACE FUNCTION public._event_local_quiet(_tz text, _at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT extract(hour FROM (_at AT TIME ZONE public._event_safe_timezone(_tz))) >= 22
      OR extract(hour FROM (_at AT TIME ZONE public._event_safe_timezone(_tz))) < 7;
$function$;
COMMENT ON FUNCTION public._event_local_quiet(text, timestamptz) IS
  'Cisza nocna 22:00-07:00 w strefie wydarzenia (S12): kanaly inapp/sms z wyprzedzeniem > 60 min sa w tym oknie odraczane, nie gubione.';
REVOKE ALL ON FUNCTION public._event_local_quiet(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_local_quiet(text, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Kolumny zgloszenia: jezyk (R-1) i preferencje przypomnien (D8, R-6)
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS lang text,
  ADD COLUMN IF NOT EXISTS remind_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remind_push boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remind_sms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remind_sessions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remind_sms_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS remind_sms_consent_via text;

ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS event_registrations_lang_values;
ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_lang_values
  CHECK (lang IS NULL OR lang IN ('pl', 'en'));

ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS event_registrations_remind_sms_consent_via_values;
ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_remind_sms_consent_via_values
  CHECK (remind_sms_consent_via IS NULL OR remind_sms_consent_via IN ('account', 'token'));

-- SMS jest opt-in ze stemplem zgody (R-6): wlaczenie bez stempla to blad
-- schematu, a nie zachowanie, ktore trzeba pamietac w kazdym RPC.
ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS event_registrations_remind_sms_consented;
ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_remind_sms_consented
  CHECK (NOT remind_sms OR remind_sms_consent_at IS NOT NULL);

COMMENT ON COLUMN public.event_registrations.lang IS
  'Jezyk uczestnika pl|en albo NULL = nieznany (R-1). Czytac WYLACZNIE przez public._event_registration_lang(tenant, id), ktory stosuje kaskade profil -> newsletter -> prowadzacy grupy -> pl.';
COMMENT ON COLUMN public.event_registrations.remind_sms IS
  'Opt-in przypomnien SMS (domyslnie wylaczone). Wymaga stempla remind_sms_consent_at (CHECK event_registrations_remind_sms_consented); wlaczyc moze tylko posiadacz biletu.';

-- Uzupelnienie jezyka WYLACZNIE tam, gdzie kaskada profil/newsletter daje
-- `pl|en` (ten sam najemca). Brak wartosci zostaje NULL-em - domyslne `pl`
-- stosuje helper przy odczycie. Jeden UPDATE; uruchamia wylacznie trigger
-- stempla `updated_at` (triggery licznika i grupy wisza na innych kolumnach).
UPDATE public.event_registrations r
   SET lang = src.lang
  FROM (
    SELECT reg.id,
           COALESCE(
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
                WHERE ns.tenant_id = reg.tenant_id
                  AND lower(ns.email) = lower(p.email)
                  AND lower(ns.language) IN ('pl', 'en')
                LIMIT 1
             )
           ) AS lang
      FROM public.event_registrations reg
      JOIN public.event_people p ON p.id = reg.person_id AND p.tenant_id = reg.tenant_id
      LEFT JOIN public.profiles pr ON pr.id = p.user_id AND pr.tenant_id = reg.tenant_id
     WHERE reg.lang IS NULL
  ) src
 WHERE src.id = r.id
   AND r.lang IS NULL
   AND src.lang IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) Ustawienia organizatora (D12): jedna tabela 1:1 z wydarzeniem
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_participant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  calendar_export_enabled boolean NOT NULL DEFAULT true,
  reminders_enabled boolean NOT NULL DEFAULT true,
  reminder_event_leads_minutes integer[] NOT NULL DEFAULT '{1440,60}',
  session_reminders_enabled boolean NOT NULL DEFAULT true,
  session_reminder_lead_minutes integer NOT NULL DEFAULT 15,
  reminder_sms_enabled boolean NOT NULL DEFAULT false,
  transfer_enabled boolean NOT NULL DEFAULT true,
  transfer_deadline_hours integer NOT NULL DEFAULT 24,
  refund_mode text NOT NULL DEFAULT 'policy',
  refund_deadline_hours integer NOT NULL DEFAULT 168,
  waitlist_offer_hours integer NOT NULL DEFAULT 24,
  certificate_enabled boolean NOT NULL DEFAULT false,
  certificate_eligibility text NOT NULL DEFAULT 'attended',
  certificate_min_sessions integer,
  certificate_require_survey boolean NOT NULL DEFAULT false,
  certificate_hours numeric(5,2),
  certificate_issuer_name text,
  certificate_signatory_name text,
  certificate_signatory_title_pl text,
  certificate_signatory_title_en text,
  certificate_body_pl text,
  certificate_body_en text,
  survey_enabled boolean NOT NULL DEFAULT false,
  survey_anonymous boolean NOT NULL DEFAULT true,
  survey_close_after_days integer NOT NULL DEFAULT 14,
  survey_min_results integer NOT NULL DEFAULT 5,
  survey_invite_enabled boolean NOT NULL DEFAULT true,
  survey_intro_pl text,
  survey_intro_en text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT event_participant_settings_event_key UNIQUE (tenant_id, event_id),
  CONSTRAINT event_participant_settings_event_fkey FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_participant_settings_leads_shape CHECK (
    cardinality(reminder_event_leads_minutes) <= 4
    AND array_position(reminder_event_leads_minutes, NULL) IS NULL
    AND 15 <= ALL (reminder_event_leads_minutes)
    AND 10080 >= ALL (reminder_event_leads_minutes)),
  CONSTRAINT event_participant_settings_session_lead CHECK (session_reminder_lead_minutes BETWEEN 5 AND 240),
  CONSTRAINT event_participant_settings_transfer_deadline CHECK (transfer_deadline_hours BETWEEN 0 AND 720),
  CONSTRAINT event_participant_settings_refund_mode_values CHECK (refund_mode IN ('policy', 'none')),
  CONSTRAINT event_participant_settings_refund_deadline CHECK (refund_deadline_hours BETWEEN 0 AND 2160),
  CONSTRAINT event_participant_settings_offer_hours CHECK (waitlist_offer_hours BETWEEN 2 AND 168),
  CONSTRAINT event_participant_settings_certificate_eligibility_values
    CHECK (certificate_eligibility IN ('attended', 'sessions_min', 'confirmed')),
  CONSTRAINT event_participant_settings_cert_min_sessions
    CHECK (certificate_min_sessions IS NULL OR certificate_min_sessions BETWEEN 1 AND 100),
  CONSTRAINT event_participant_settings_cert_sessions_required
    CHECK (certificate_eligibility <> 'sessions_min' OR certificate_min_sessions IS NOT NULL),
  CONSTRAINT event_participant_settings_cert_hours
    CHECK (certificate_hours IS NULL OR (certificate_hours > 0 AND certificate_hours <= 999)),
  CONSTRAINT event_participant_settings_issuer_len
    CHECK (certificate_issuer_name IS NULL OR char_length(certificate_issuer_name) <= 160),
  CONSTRAINT event_participant_settings_signatory_name_len
    CHECK (certificate_signatory_name IS NULL OR char_length(certificate_signatory_name) <= 120),
  CONSTRAINT event_participant_settings_signatory_title_pl_len
    CHECK (certificate_signatory_title_pl IS NULL OR char_length(certificate_signatory_title_pl) <= 120),
  CONSTRAINT event_participant_settings_signatory_title_en_len
    CHECK (certificate_signatory_title_en IS NULL OR char_length(certificate_signatory_title_en) <= 120),
  CONSTRAINT event_participant_settings_body_pl_len
    CHECK (certificate_body_pl IS NULL OR char_length(certificate_body_pl) <= 600),
  CONSTRAINT event_participant_settings_body_en_len
    CHECK (certificate_body_en IS NULL OR char_length(certificate_body_en) <= 600),
  CONSTRAINT event_participant_settings_survey_intro_pl_len
    CHECK (survey_intro_pl IS NULL OR char_length(survey_intro_pl) <= 600),
  CONSTRAINT event_participant_settings_survey_intro_en_len
    CHECK (survey_intro_en IS NULL OR char_length(survey_intro_en) <= 600),
  CONSTRAINT event_participant_settings_survey_close CHECK (survey_close_after_days BETWEEN 1 AND 90),
  CONSTRAINT event_participant_settings_survey_k CHECK (survey_min_results BETWEEN 5 AND 50)
);

DROP TRIGGER IF EXISTS event_participant_settings_touch_updated_at ON public.event_participant_settings;
CREATE TRIGGER event_participant_settings_touch_updated_at
  BEFORE UPDATE ON public.event_participant_settings
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

ALTER TABLE public.event_participant_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_participant_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_participant_settings TO authenticated;
GRANT ALL ON public.event_participant_settings TO service_role;

-- Tylko administrator (i super administrator) najemcy - NIGDY `editor` (D12).
DROP POLICY IF EXISTS event_participant_settings_admin_read ON public.event_participant_settings;
CREATE POLICY event_participant_settings_admin_read ON public.event_participant_settings
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

COMMENT ON TABLE public.event_participant_settings IS
  'Ustawienia funkcji uczestnika per wydarzenie (D12): przypomnienia, kalendarz, przekazanie, zwrot, oferty listy rezerwowej, certyfikat, ankieta. Brak wiersza = wartosci domyslne (_event_participant_settings_effective). Zapis wylacznie przez admin_event_participant_settings_save.';

-- LOCKS: none (read only).
CREATE OR REPLACE FUNCTION public._event_participant_settings_effective(_tenant uuid, _event_id uuid)
RETURNS public.event_participant_settings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v public.event_participant_settings;
BEGIN
  SELECT s.* INTO v
    FROM public.event_participant_settings s
   WHERE s.tenant_id = _tenant AND s.event_id = _event_id;
  IF FOUND THEN
    RETURN v;
  END IF;

  -- Wiersz zbudowany z DEFAULT-ow kolumn (id, stemple i updated_by = NULL, bo
  -- wiersza nie ma). Parytet z DEFAULT-ami tabeli pilnuje asercja
  -- `13/ustawienia: domyslne bez wiersza = DEFAULT-y kolumn`.
  v.tenant_id := _tenant;
  v.event_id := _event_id;
  v.calendar_export_enabled := true;
  v.reminders_enabled := true;
  v.reminder_event_leads_minutes := '{1440,60}'::integer[];
  v.session_reminders_enabled := true;
  v.session_reminder_lead_minutes := 15;
  v.reminder_sms_enabled := false;
  v.transfer_enabled := true;
  v.transfer_deadline_hours := 24;
  v.refund_mode := 'policy';
  v.refund_deadline_hours := 168;
  v.waitlist_offer_hours := 24;
  v.certificate_enabled := false;
  v.certificate_eligibility := 'attended';
  v.certificate_require_survey := false;
  v.survey_enabled := false;
  v.survey_anonymous := true;
  v.survey_close_after_days := 14;
  v.survey_min_results := 5;
  v.survey_invite_enabled := true;
  RETURN v;
END;
$function$;
COMMENT ON FUNCTION public._event_participant_settings_effective(uuid, uuid) IS
  'Jedyna droga odczytu ustawien uczestnika w SQL (A.6 R-SQL): wiersz z event_participant_settings albo wiersz z wartosci domyslnych (id NULL).';
REVOKE ALL ON FUNCTION public._event_participant_settings_effective(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_participant_settings_effective(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Zapisane sesje planu (D7)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_session_saves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_session_saves_user_key UNIQUE (tenant_id, session_id, user_id),
  CONSTRAINT event_session_saves_session_fkey FOREIGN KEY (tenant_id, event_id, session_id)
    REFERENCES public.event_sessions(tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_session_saves_event_fkey FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS event_session_saves_user_event_idx
  ON public.event_session_saves (tenant_id, user_id, event_id);

ALTER TABLE public.event_session_saves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_session_saves FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_session_saves TO authenticated;
GRANT ALL ON public.event_session_saves TO service_role;

DROP POLICY IF EXISTS event_session_saves_owner_read ON public.event_session_saves;
CREATE POLICY event_session_saves_owner_read ON public.event_session_saves
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.public_tenant_id())
  );

COMMENT ON TABLE public.event_session_saves IS
  'Zakladki sesji w planie uczestnika (D7) - odrebne od zapisow na miejsca. Czysty stan osobisty: kasowane razem z kontem (S27) i przy utracie biletu (_event_participant_release).';

-- ----------------------------------------------------------------------------
-- 5) Dziennik doreczen (D8): jeden log, UNIKALNY klucz deduplikacji
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_message_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  registration_id uuid REFERENCES public.event_registrations(id) ON DELETE SET NULL,
  person_id uuid REFERENCES public.event_people(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.event_sessions(id) ON DELETE SET NULL,
  kind text NOT NULL
    CONSTRAINT event_message_deliveries_kind_values CHECK (kind IN (
      'event_reminder', 'session_reminder', 'waitlist_offer', 'waitlist_offer_expired',
      'waitlist_offer_refunded', 'waitlist_joined', 'transfer_offer', 'transfer_completed',
      'transfer_revoked', 'survey_invite', 'certificate_ready')),
  channel text NOT NULL
    CONSTRAINT event_message_deliveries_channel_values CHECK (channel IN ('email', 'sms', 'inapp')),
  lead_minutes integer
    CONSTRAINT event_message_deliveries_lead_minutes_range
    CHECK (lead_minutes IS NULL OR lead_minutes BETWEEN 0 AND 20160),
  starts_at_snapshot timestamptz,
  dedupe_key text NOT NULL
    CONSTRAINT event_message_deliveries_dedupe_key_len CHECK (char_length(dedupe_key) BETWEEN 8 AND 300),
  status text NOT NULL DEFAULT 'claimed'
    CONSTRAINT event_message_deliveries_status_values
    CHECK (status IN ('claimed', 'sent', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 1
    CONSTRAINT event_message_deliveries_attempts_range CHECK (attempts BETWEEN 1 AND 10),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  -- powod pominiecia / kod bledu, NIGDY dane osobowe
  detail text
    CONSTRAINT event_message_deliveries_detail_len CHECK (detail IS NULL OR char_length(detail) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_message_deliveries_dedupe_key UNIQUE (tenant_id, dedupe_key),
  CONSTRAINT event_message_deliveries_sent_dated CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CONSTRAINT event_message_deliveries_event_fkey FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS event_message_deliveries_pending_idx
  ON public.event_message_deliveries (status, claimed_at)
  WHERE status IN ('claimed', 'failed');
CREATE INDEX IF NOT EXISTS event_message_deliveries_event_idx
  ON public.event_message_deliveries (tenant_id, event_id, created_at DESC);

DROP TRIGGER IF EXISTS event_message_deliveries_touch_updated_at ON public.event_message_deliveries;
CREATE TRIGGER event_message_deliveries_touch_updated_at
  BEFORE UPDATE ON public.event_message_deliveries
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

ALTER TABLE public.event_message_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_message_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_message_deliveries TO authenticated;
GRANT ALL ON public.event_message_deliveries TO service_role;

DROP POLICY IF EXISTS event_message_deliveries_admin_read ON public.event_message_deliveries;
CREATE POLICY event_message_deliveries_admin_read ON public.event_message_deliveries
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

COMMENT ON TABLE public.event_message_deliveries IS
  'Dziennik doreczen wiadomosci uczestnika (D8): jeden wiersz na (najemca, klucz deduplikacji) - rejestr kluczy w spec Appendix 1. Zadania tla rezerwuja wiersz przez _event_delivery_claim i zamykaja go przez _event_delivery_confirm. Powiadomienia w aplikacji sa jednorazowe (nigdy ponownie rezerwowane).';

-- ----------------------------------------------------------------------------
-- 6) Aktor i jezyk zgloszenia (D13)
-- ----------------------------------------------------------------------------

-- LOCKS: none (read only).
CREATE OR REPLACE FUNCTION public._event_registration_actor(
  _tenant uuid, _registration_id uuid, _uid uuid, _manage_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_hash text;
  r public.event_registrations;
  v_holder uuid;
  v_payer uuid;
  v_via boolean;
  v_group boolean;
BEGIN
  IF _tenant IS NULL THEN
    RETURN jsonb_build_object('exists', false);
  END IF;
  IF _manage_token IS NOT NULL AND btrim(_manage_token) <> '' THEN
    v_hash := encode(digest(btrim(_manage_token), 'sha256'), 'hex');
  END IF;

  IF _registration_id IS NOT NULL THEN
    SELECT x.* INTO r FROM public.event_registrations x
     WHERE x.id = _registration_id AND x.tenant_id = _tenant;
  ELSIF v_hash IS NOT NULL THEN
    SELECT x.* INTO r FROM public.event_registrations x
     WHERE x.manage_token_hash = v_hash AND x.tenant_id = _tenant;
  END IF;

  -- Jedna odpowiedz dla „nie istnieje" i „nie twoje" - wolajacy odpowiada
  -- `not_found` w obu przypadkach (brak wyroczni istnienia).
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('exists', false);
  END IF;

  v_via := v_hash IS NOT NULL AND r.manage_token_hash IS NOT NULL AND r.manage_token_hash = v_hash;

  SELECT p.user_id INTO v_holder
    FROM public.event_people p
   WHERE p.id = r.person_id AND p.tenant_id = r.tenant_id;

  IF r.payment_order_id IS NOT NULL THEN
    SELECT o.user_id INTO v_payer
      FROM public.payment_orders o
     WHERE o.id = r.payment_order_id AND o.tenant_id = r.tenant_id;
  END IF;

  v_group := r.group_lead_registration_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.event_registrations g
                WHERE g.tenant_id = r.tenant_id AND g.group_lead_registration_id = r.id);

  RETURN jsonb_build_object(
    'exists', true,
    'registration_id', r.id,
    'tenant_id', r.tenant_id,
    'event_id', r.event_id,
    'person_id', r.person_id,
    'ticket_type_id', r.ticket_type_id,
    'status', r.status,
    'payment_status', r.payment_status,
    'source', r.source,
    'group_lead_registration_id', r.group_lead_registration_id,
    'is_group', v_group,
    'via_token', v_via,
    'is_holder', v_via OR COALESCE(_uid IS NOT NULL AND v_holder = _uid, false),
    'is_registrant', COALESCE(_uid IS NOT NULL AND r.created_by = _uid, false),
    'is_payer', COALESCE(_uid IS NOT NULL AND v_payer = _uid, false),
    'holder_user_id', v_holder,
    'payer_user_id', v_payer,
    'payment_order_id', r.payment_order_id
  );
END;
$function$;
COMMENT ON FUNCTION public._event_registration_actor(uuid, uuid, uuid, text) IS
  'Kim jest wolajacy wobec zgloszenia: posiadacz (konto osoby albo klucz samoobslugi), zglaszajacy (created_by), platnik (payment_orders.user_id). Szukanie po id albo po skrocie klucza, ZAWSZE w obrebie najemcy; brak = {"exists":false}.';
REVOKE ALL ON FUNCTION public._event_registration_actor(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_actor(uuid, uuid, uuid, text) TO service_role;

-- LOCKS: none (read only).
CREATE OR REPLACE FUNCTION public._event_registration_lang(_tenant uuid, _registration_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT COALESCE(
             r.lang,
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
             (
               SELECT lr.lang
                 FROM public.event_registrations lr
                WHERE lr.id = r.group_lead_registration_id
                  AND lr.tenant_id = r.tenant_id
             )
           )
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.profiles pr ON pr.id = p.user_id AND pr.tenant_id = r.tenant_id
     WHERE r.id = _registration_id AND r.tenant_id = _tenant
  ), 'pl');
$function$;
COMMENT ON FUNCTION public._event_registration_lang(uuid, uuid) IS
  'Jezyk odbiorcy wiadomosci zgloszenia (R-1): r.lang -> profiles.prefs language/lang -> newsletter_subscribers.language -> lang prowadzacego grupy -> pl. Nieznane zgloszenie = pl. Jedyna droga odczytu jezyka w SQL.';
REVOKE ALL ON FUNCTION public._event_registration_lang(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_lang(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 7) Sprzatanie po utracie miejsca (D1, D5, D7)
-- ----------------------------------------------------------------------------

-- LOCKS: event_rsvps rows of (event, user) only. MUST run AFTER the re-point /
-- cancel UPDATE of the registration being released.
CREATE OR REPLACE FUNCTION public._event_legacy_rsvp_release(_tenant uuid, _event_id uuid, _user_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF _user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Konto nadal trzyma inne aktywne zgloszenie na to wydarzenie (np. drugi
  -- bilet): starsza rezerwacja zostaje, bo nadal odpowiada prawdzie.
  IF EXISTS (
    SELECT 1
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
     WHERE r.tenant_id = _tenant
       AND r.event_id = _event_id
       AND p.user_id = _user_id
       AND r.status NOT IN ('cancelled', 'rejected')
  ) THEN
    RETURN 0;
  END IF;

  -- Filtr najemcy takze tutaj (nie tylko w EXISTS wyzej): wolajacy z blednym
  -- najemca przy poprawnym id wydarzenia nie moze zwolnic cudzej rezerwacji.
  UPDATE public.event_rsvps
     SET status = 'cancelled', updated_at = now()
   WHERE tenant_id = _tenant
     AND event_id = _event_id
     AND user_id = _user_id
     AND status IN ('going', 'waitlist');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
COMMENT ON FUNCTION public._event_legacy_rsvp_release(uuid, uuid, uuid) IS
  'Zwalnia starsza rezerwacje RSVP (going/waitlist -> cancelled) konta, ktore stracilo bilet etapu 4, chyba ze trzyma inne aktywne zgloszenie na to wydarzenie. Wolac PO przepieciu/odwolaniu zgloszenia. Zwraca liczbe zmienionych wierszy.';
REVOKE ALL ON FUNCTION public._event_legacy_rsvp_release(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_legacy_rsvp_release(uuid, uuid, uuid) TO service_role;

-- LOCKS: event_sessions (FOR UPDATE, session_id order) -> event_session_signups
-- -> event_session_saves -> event_rsvps (via _event_legacy_rsvp_release).
CREATE OR REPLACE FUNCTION public._event_participant_release(
  _tenant uuid, _event_id uuid, _user_id uuid, _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  g record;
  v_promoted uuid;
  v_n integer;
  v_cancelled integer := 0;
  v_promoted_n integer := 0;
  v_saves integer := 0;
  v_rsvp integer := 0;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('signups_cancelled', 0, 'signups_promoted', 0,
                              'saves_removed', 0, 'rsvp_cancelled', 0);
  END IF;

  FOR g IN
    SELECT s.id, s.session_id, s.status
      FROM public.event_session_signups s
     WHERE s.tenant_id = _tenant
       AND s.event_id = _event_id
       AND s.user_id = _user_id
       AND s.status IN ('registered', 'waitlist')
     ORDER BY s.session_id
  LOOP
    PERFORM 1 FROM public.event_sessions es
     WHERE es.id = g.session_id AND es.tenant_id = _tenant
       FOR UPDATE;

    -- Status sprawdzany PONOWNIE, juz pod blokada sesji. Petla czyta zapisy
    -- BEZ blokady, a `event_session_signup` (ta sama blokada sesji) moglo
    -- w tym czasie samo odwolac ten zapis i awansowac kolejke - drugi awans
    -- za to samo zwolnione miejsce przepelnilby sesje. Wiersz, ktory nie ma
    -- juz statusu widzianego w petli, nie jest ani liczony, ani zwalniany.
    UPDATE public.event_session_signups
       SET status = 'cancelled', cancelled_at = now()
     WHERE id = g.id AND status = g.status;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_cancelled := v_cancelled + v_n;

    -- Zwolnione miejsce przechodzi na pierwszego z kolejki sesji (FIFO jak
    -- w event_session_signup).
    IF v_n = 1 AND g.status = 'registered' THEN
      v_promoted := NULL;
      SELECT w.id INTO v_promoted
        FROM public.event_session_signups w
       WHERE w.tenant_id = _tenant
         AND w.session_id = g.session_id
         AND w.status = 'waitlist'
       ORDER BY w.registered_at, w.id
       LIMIT 1;
      IF v_promoted IS NOT NULL THEN
        UPDATE public.event_session_signups SET status = 'registered' WHERE id = v_promoted;
        v_promoted_n := v_promoted_n + 1;
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.event_session_saves
   WHERE tenant_id = _tenant AND event_id = _event_id AND user_id = _user_id;
  GET DIAGNOSTICS v_saves = ROW_COUNT;

  v_rsvp := public._event_legacy_rsvp_release(_tenant, _event_id, _user_id);

  RAISE NOTICE '_event_participant_release (%): signups % / promoted % / saves % / rsvp %',
    COALESCE(_reason, 'unspecified'), v_cancelled, v_promoted_n, v_saves, v_rsvp;

  RETURN jsonb_build_object(
    'signups_cancelled', v_cancelled,
    'signups_promoted', v_promoted_n,
    'saves_removed', v_saves,
    'rsvp_cancelled', v_rsvp
  );
END;
$function$;
COMMENT ON FUNCTION public._event_participant_release(uuid, uuid, uuid, text) IS
  'Sprzatanie po utracie biletu (zwrot, przekazanie): odwoluje zapisy konta na sesje wydarzenia (z awansem z kolejki), kasuje zakladki planu i zwalnia starsza rezerwacje RSVP. Powod trafia wylacznie do NOTICE.';
REVOKE ALL ON FUNCTION public._event_participant_release(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_participant_release(uuid, uuid, uuid, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 8) RPC panelu (assert_event_admin_tenant, nigdy public_tenant_id)
-- ----------------------------------------------------------------------------

-- LOCKS: none (read only).
CREATE OR REPLACE FUNCTION public.admin_event_participant_settings_get(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v public.event_participant_settings;
BEGIN
  v_tenant := public.assert_event_admin_tenant();
  IF p_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  v := public._event_participant_settings_effective(v_tenant, p_event_id);

  RETURN to_jsonb(v) || jsonb_build_object(
    'event_id', p_event_id,
    'has_row', v.id IS NOT NULL,
    'has_session_checkpoints', EXISTS (
      SELECT 1 FROM public.event_checkpoints c
       WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id AND c.kind = 'session'
    ),
    'updated_at', v.updated_at
  );
END;
$function$;
COMMENT ON FUNCTION public.admin_event_participant_settings_get(uuid) IS
  'Panel: ustawienia uczestnika wydarzenia (klucze = nazwy kolumn) + has_row, has_session_checkpoints. Bez wiersza zwraca wartosci domyslne. Tylko admin/super admin najemcy wydarzenia.';
REVOKE ALL ON FUNCTION public.admin_event_participant_settings_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_participant_settings_get(uuid) TO authenticated, service_role;

-- LOCKS: event_participant_settings row (FOR UPDATE) only.
CREATE OR REPLACE FUNCTION public.admin_event_participant_settings_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_uid uuid := auth.uid();
  v_event uuid;
  v_row public.event_participant_settings;
  v_key text;
  v_j jsonb;
  v_num numeric;
  v_text text;
  v_leads integer[];
  v_keys text[];
  i integer;
  c_bool_keys CONSTANT text[] := ARRAY[
    'calendar_export_enabled', 'reminders_enabled', 'session_reminders_enabled',
    'reminder_sms_enabled', 'transfer_enabled', 'certificate_enabled',
    'certificate_require_survey', 'survey_enabled', 'survey_anonymous', 'survey_invite_enabled'];
  c_text_keys CONSTANT text[] := ARRAY[
    'certificate_issuer_name', 'certificate_signatory_name', 'certificate_signatory_title_pl',
    'certificate_signatory_title_en', 'certificate_body_pl', 'certificate_body_en',
    'survey_intro_pl', 'survey_intro_en'];
  c_text_max CONSTANT integer[] := ARRAY[160, 120, 120, 120, 600, 600, 600, 600];
  c_known_keys CONSTANT text[] := ARRAY[
    'calendar_export_enabled', 'reminders_enabled', 'reminder_event_leads_minutes',
    'session_reminders_enabled', 'session_reminder_lead_minutes', 'reminder_sms_enabled',
    'transfer_enabled', 'transfer_deadline_hours', 'refund_mode', 'refund_deadline_hours',
    'waitlist_offer_hours', 'certificate_enabled', 'certificate_eligibility',
    'certificate_min_sessions', 'certificate_require_survey', 'certificate_hours',
    'certificate_issuer_name', 'certificate_signatory_name', 'certificate_signatory_title_pl',
    'certificate_signatory_title_en', 'certificate_body_pl', 'certificate_body_en',
    'survey_enabled', 'survey_anonymous', 'survey_close_after_days', 'survey_min_results',
    'survey_invite_enabled', 'survey_intro_pl', 'survey_intro_en'];
BEGIN
  v_tenant := public.assert_event_admin_tenant();

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request: payload must be a JSON object';
  END IF;
  IF COALESCE(p_payload->>'event_id', '')
       !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;
  v_event := (p_payload->>'event_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_event AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  SELECT array_agg(k ORDER BY k) INTO v_keys
    FROM jsonb_object_keys(p_payload) k
   WHERE k = ANY (c_known_keys);
  IF v_keys IS NULL THEN
    -- Sam event_id: nic do zapisania, nic do ogloszenia.
    RETURN public.admin_event_participant_settings_get(v_event);
  END IF;

  SELECT s.* INTO v_row
    FROM public.event_participant_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_event
     FOR UPDATE;
  IF NOT FOUND THEN
    v_row := public._event_participant_settings_effective(v_tenant, v_event);
  END IF;

  -- ── Walidacja KAZDEJ wartosci PRZED zapisem; wynik w lokalnym wierszu ────
  -- Rzutowania stoja w OSOBNYCH instrukcjach po sprawdzeniu typu JSON:
  -- planista nie gwarantuje kolejnosci wyliczania warunkow w jednym IF.
  FOREACH v_key IN ARRAY c_bool_keys LOOP
    CONTINUE WHEN NOT (p_payload ? v_key);
    IF jsonb_typeof(p_payload->v_key) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'invalid_boolean: %', v_key;
    END IF;
    CASE v_key
      WHEN 'calendar_export_enabled' THEN v_row.calendar_export_enabled := (p_payload->>v_key)::boolean;
      WHEN 'reminders_enabled' THEN v_row.reminders_enabled := (p_payload->>v_key)::boolean;
      WHEN 'session_reminders_enabled' THEN v_row.session_reminders_enabled := (p_payload->>v_key)::boolean;
      WHEN 'reminder_sms_enabled' THEN v_row.reminder_sms_enabled := (p_payload->>v_key)::boolean;
      WHEN 'transfer_enabled' THEN v_row.transfer_enabled := (p_payload->>v_key)::boolean;
      WHEN 'certificate_enabled' THEN v_row.certificate_enabled := (p_payload->>v_key)::boolean;
      WHEN 'certificate_require_survey' THEN v_row.certificate_require_survey := (p_payload->>v_key)::boolean;
      WHEN 'survey_enabled' THEN v_row.survey_enabled := (p_payload->>v_key)::boolean;
      WHEN 'survey_anonymous' THEN v_row.survey_anonymous := (p_payload->>v_key)::boolean;
      ELSE v_row.survey_invite_enabled := (p_payload->>v_key)::boolean;
    END CASE;
  END LOOP;

  IF p_payload ? 'reminder_event_leads_minutes' THEN
    v_j := p_payload->'reminder_event_leads_minutes';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_reminder_leads: expected an array of at most 4 integers between 15 and 10080';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_j) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'number') THEN
      RAISE EXCEPTION 'invalid_reminder_leads: expected an array of at most 4 integers between 15 and 10080';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_j) x
       WHERE x::numeric % 1 <> 0 OR x::numeric < 15 OR x::numeric > 10080
    ) THEN
      RAISE EXCEPTION 'invalid_reminder_leads: expected an array of at most 4 integers between 15 and 10080';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x::integer ORDER BY x::integer DESC), '{}'::integer[])
      INTO v_leads
      FROM jsonb_array_elements_text(v_j) x;
    IF cardinality(v_leads) > 4 THEN
      RAISE EXCEPTION 'invalid_reminder_leads: expected an array of at most 4 integers between 15 and 10080';
    END IF;
    v_row.reminder_event_leads_minutes := v_leads;
  END IF;

  IF p_payload ? 'session_reminder_lead_minutes' THEN
    v_j := p_payload->'session_reminder_lead_minutes';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_session_lead: session_reminder_lead_minutes must be an integer between 5 and 240';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 5 OR v_num > 240 THEN
      RAISE EXCEPTION 'invalid_session_lead: session_reminder_lead_minutes must be an integer between 5 and 240';
    END IF;
    v_row.session_reminder_lead_minutes := v_num::integer;
  END IF;

  IF p_payload ? 'transfer_deadline_hours' THEN
    v_j := p_payload->'transfer_deadline_hours';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_transfer_deadline: transfer_deadline_hours must be an integer between 0 and 720';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 0 OR v_num > 720 THEN
      RAISE EXCEPTION 'invalid_transfer_deadline: transfer_deadline_hours must be an integer between 0 and 720';
    END IF;
    v_row.transfer_deadline_hours := v_num::integer;
  END IF;

  IF p_payload ? 'refund_mode' THEN
    v_j := p_payload->'refund_mode';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid_refund_mode: refund_mode must be policy or none';
    END IF;
    IF (v_j #>> '{}') NOT IN ('policy', 'none') THEN
      RAISE EXCEPTION 'invalid_refund_mode: refund_mode must be policy or none';
    END IF;
    v_row.refund_mode := v_j #>> '{}';
  END IF;

  IF p_payload ? 'refund_deadline_hours' THEN
    v_j := p_payload->'refund_deadline_hours';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_refund_deadline: refund_deadline_hours must be an integer between 0 and 2160';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 0 OR v_num > 2160 THEN
      RAISE EXCEPTION 'invalid_refund_deadline: refund_deadline_hours must be an integer between 0 and 2160';
    END IF;
    v_row.refund_deadline_hours := v_num::integer;
  END IF;

  IF p_payload ? 'waitlist_offer_hours' THEN
    v_j := p_payload->'waitlist_offer_hours';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_offer_hours: waitlist_offer_hours must be an integer between 2 and 168';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 2 OR v_num > 168 THEN
      RAISE EXCEPTION 'invalid_offer_hours: waitlist_offer_hours must be an integer between 2 and 168';
    END IF;
    v_row.waitlist_offer_hours := v_num::integer;
  END IF;

  IF p_payload ? 'certificate_eligibility' THEN
    v_j := p_payload->'certificate_eligibility';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid_certificate_eligibility: expected attended, sessions_min or confirmed';
    END IF;
    IF (v_j #>> '{}') NOT IN ('attended', 'sessions_min', 'confirmed') THEN
      RAISE EXCEPTION 'invalid_certificate_eligibility: expected attended, sessions_min or confirmed';
    END IF;
    v_row.certificate_eligibility := v_j #>> '{}';
  END IF;

  IF p_payload ? 'certificate_min_sessions' THEN
    v_j := p_payload->'certificate_min_sessions';
    IF jsonb_typeof(v_j) = 'null' THEN
      v_row.certificate_min_sessions := NULL;
    ELSE
      IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'invalid_certificate_min_sessions: certificate_min_sessions must be null or an integer between 1 and 100';
      END IF;
      v_num := (v_j #>> '{}')::numeric;
      IF v_num % 1 <> 0 OR v_num < 1 OR v_num > 100 THEN
        RAISE EXCEPTION 'invalid_certificate_min_sessions: certificate_min_sessions must be null or an integer between 1 and 100';
      END IF;
      v_row.certificate_min_sessions := v_num::integer;
    END IF;
  END IF;

  IF p_payload ? 'certificate_hours' THEN
    v_j := p_payload->'certificate_hours';
    IF jsonb_typeof(v_j) = 'null' THEN
      v_row.certificate_hours := NULL;
    ELSE
      IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'invalid_certificate_hours: certificate_hours must be null or a number greater than 0 and at most 999';
      END IF;
      -- Zaokraglenie PRZED sprawdzeniem zakresu: numeric(5,2) zaokragla przy
      -- zapisie, wiec 0.001 dawalo 0.00 (CHECK) a 999.999 - przepelnienie.
      v_num := round((v_j #>> '{}')::numeric, 2);
      IF v_num <= 0 OR v_num > 999 THEN
        RAISE EXCEPTION 'invalid_certificate_hours: certificate_hours must be null or a number greater than 0 and at most 999';
      END IF;
      v_row.certificate_hours := v_num;
    END IF;
  END IF;

  FOR i IN 1 .. array_length(c_text_keys, 1) LOOP
    v_key := c_text_keys[i];
    CONTINUE WHEN NOT (p_payload ? v_key);
    v_j := p_payload->v_key;
    IF jsonb_typeof(v_j) = 'null' THEN
      v_text := NULL;
    ELSIF jsonb_typeof(v_j) = 'string' THEN
      v_text := NULLIF(btrim(v_j #>> '{}'), '');
    ELSE
      RAISE EXCEPTION 'invalid_text_length: %', v_key;
    END IF;
    IF v_text IS NOT NULL AND char_length(v_text) > c_text_max[i] THEN
      RAISE EXCEPTION 'invalid_text_length: %', v_key;
    END IF;
    CASE v_key
      WHEN 'certificate_issuer_name' THEN v_row.certificate_issuer_name := v_text;
      WHEN 'certificate_signatory_name' THEN v_row.certificate_signatory_name := v_text;
      WHEN 'certificate_signatory_title_pl' THEN v_row.certificate_signatory_title_pl := v_text;
      WHEN 'certificate_signatory_title_en' THEN v_row.certificate_signatory_title_en := v_text;
      WHEN 'certificate_body_pl' THEN v_row.certificate_body_pl := v_text;
      WHEN 'certificate_body_en' THEN v_row.certificate_body_en := v_text;
      WHEN 'survey_intro_pl' THEN v_row.survey_intro_pl := v_text;
      ELSE v_row.survey_intro_en := v_text;
    END CASE;
  END LOOP;

  IF p_payload ? 'survey_close_after_days' THEN
    v_j := p_payload->'survey_close_after_days';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_survey_close_days: survey_close_after_days must be an integer between 1 and 90';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 1 OR v_num > 90 THEN
      RAISE EXCEPTION 'invalid_survey_close_days: survey_close_after_days must be an integer between 1 and 90';
    END IF;
    v_row.survey_close_after_days := v_num::integer;
  END IF;

  IF p_payload ? 'survey_min_results' THEN
    v_j := p_payload->'survey_min_results';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_survey_min_results: survey_min_results must be an integer between 5 and 50';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 5 OR v_num > 50 THEN
      RAISE EXCEPTION 'invalid_survey_min_results: survey_min_results must be an integer between 5 and 50';
    END IF;
    v_row.survey_min_results := v_num::integer;
  END IF;

  -- Regula miedzypolowa liczona na WIERSZU WYNIKOWYM (zapisany stan + podane
  -- klucze), nie na samym ladunku.
  IF v_row.certificate_eligibility = 'sessions_min' AND v_row.certificate_min_sessions IS NULL THEN
    RAISE EXCEPTION 'invalid_certificate_min_sessions: sessions_min eligibility requires certificate_min_sessions';
  END IF;

  -- ── Zapis: WYLACZNIE podane klucze (brak klucza = bez zmian) ─────────────
  INSERT INTO public.event_participant_settings AS s (
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
  ) VALUES (
    v_tenant, v_event,
    v_row.calendar_export_enabled, v_row.reminders_enabled, v_row.reminder_event_leads_minutes,
    v_row.session_reminders_enabled, v_row.session_reminder_lead_minutes, v_row.reminder_sms_enabled,
    v_row.transfer_enabled, v_row.transfer_deadline_hours, v_row.refund_mode, v_row.refund_deadline_hours,
    v_row.waitlist_offer_hours, v_row.certificate_enabled, v_row.certificate_eligibility,
    v_row.certificate_min_sessions, v_row.certificate_require_survey, v_row.certificate_hours,
    v_row.certificate_issuer_name, v_row.certificate_signatory_name, v_row.certificate_signatory_title_pl,
    v_row.certificate_signatory_title_en, v_row.certificate_body_pl, v_row.certificate_body_en,
    v_row.survey_enabled, v_row.survey_anonymous, v_row.survey_close_after_days, v_row.survey_min_results,
    v_row.survey_invite_enabled, v_row.survey_intro_pl, v_row.survey_intro_en, v_uid
  )
  ON CONFLICT (tenant_id, event_id) DO UPDATE SET
    calendar_export_enabled = CASE WHEN p_payload ? 'calendar_export_enabled' THEN EXCLUDED.calendar_export_enabled ELSE s.calendar_export_enabled END,
    reminders_enabled = CASE WHEN p_payload ? 'reminders_enabled' THEN EXCLUDED.reminders_enabled ELSE s.reminders_enabled END,
    reminder_event_leads_minutes = CASE WHEN p_payload ? 'reminder_event_leads_minutes' THEN EXCLUDED.reminder_event_leads_minutes ELSE s.reminder_event_leads_minutes END,
    session_reminders_enabled = CASE WHEN p_payload ? 'session_reminders_enabled' THEN EXCLUDED.session_reminders_enabled ELSE s.session_reminders_enabled END,
    session_reminder_lead_minutes = CASE WHEN p_payload ? 'session_reminder_lead_minutes' THEN EXCLUDED.session_reminder_lead_minutes ELSE s.session_reminder_lead_minutes END,
    reminder_sms_enabled = CASE WHEN p_payload ? 'reminder_sms_enabled' THEN EXCLUDED.reminder_sms_enabled ELSE s.reminder_sms_enabled END,
    transfer_enabled = CASE WHEN p_payload ? 'transfer_enabled' THEN EXCLUDED.transfer_enabled ELSE s.transfer_enabled END,
    transfer_deadline_hours = CASE WHEN p_payload ? 'transfer_deadline_hours' THEN EXCLUDED.transfer_deadline_hours ELSE s.transfer_deadline_hours END,
    refund_mode = CASE WHEN p_payload ? 'refund_mode' THEN EXCLUDED.refund_mode ELSE s.refund_mode END,
    refund_deadline_hours = CASE WHEN p_payload ? 'refund_deadline_hours' THEN EXCLUDED.refund_deadline_hours ELSE s.refund_deadline_hours END,
    waitlist_offer_hours = CASE WHEN p_payload ? 'waitlist_offer_hours' THEN EXCLUDED.waitlist_offer_hours ELSE s.waitlist_offer_hours END,
    certificate_enabled = CASE WHEN p_payload ? 'certificate_enabled' THEN EXCLUDED.certificate_enabled ELSE s.certificate_enabled END,
    certificate_eligibility = CASE WHEN p_payload ? 'certificate_eligibility' THEN EXCLUDED.certificate_eligibility ELSE s.certificate_eligibility END,
    certificate_min_sessions = CASE WHEN p_payload ? 'certificate_min_sessions' THEN EXCLUDED.certificate_min_sessions ELSE s.certificate_min_sessions END,
    certificate_require_survey = CASE WHEN p_payload ? 'certificate_require_survey' THEN EXCLUDED.certificate_require_survey ELSE s.certificate_require_survey END,
    certificate_hours = CASE WHEN p_payload ? 'certificate_hours' THEN EXCLUDED.certificate_hours ELSE s.certificate_hours END,
    certificate_issuer_name = CASE WHEN p_payload ? 'certificate_issuer_name' THEN EXCLUDED.certificate_issuer_name ELSE s.certificate_issuer_name END,
    certificate_signatory_name = CASE WHEN p_payload ? 'certificate_signatory_name' THEN EXCLUDED.certificate_signatory_name ELSE s.certificate_signatory_name END,
    certificate_signatory_title_pl = CASE WHEN p_payload ? 'certificate_signatory_title_pl' THEN EXCLUDED.certificate_signatory_title_pl ELSE s.certificate_signatory_title_pl END,
    certificate_signatory_title_en = CASE WHEN p_payload ? 'certificate_signatory_title_en' THEN EXCLUDED.certificate_signatory_title_en ELSE s.certificate_signatory_title_en END,
    certificate_body_pl = CASE WHEN p_payload ? 'certificate_body_pl' THEN EXCLUDED.certificate_body_pl ELSE s.certificate_body_pl END,
    certificate_body_en = CASE WHEN p_payload ? 'certificate_body_en' THEN EXCLUDED.certificate_body_en ELSE s.certificate_body_en END,
    survey_enabled = CASE WHEN p_payload ? 'survey_enabled' THEN EXCLUDED.survey_enabled ELSE s.survey_enabled END,
    survey_anonymous = CASE WHEN p_payload ? 'survey_anonymous' THEN EXCLUDED.survey_anonymous ELSE s.survey_anonymous END,
    survey_close_after_days = CASE WHEN p_payload ? 'survey_close_after_days' THEN EXCLUDED.survey_close_after_days ELSE s.survey_close_after_days END,
    survey_min_results = CASE WHEN p_payload ? 'survey_min_results' THEN EXCLUDED.survey_min_results ELSE s.survey_min_results END,
    survey_invite_enabled = CASE WHEN p_payload ? 'survey_invite_enabled' THEN EXCLUDED.survey_invite_enabled ELSE s.survey_invite_enabled END,
    survey_intro_pl = CASE WHEN p_payload ? 'survey_intro_pl' THEN EXCLUDED.survey_intro_pl ELSE s.survey_intro_pl END,
    survey_intro_en = CASE WHEN p_payload ? 'survey_intro_en' THEN EXCLUDED.survey_intro_en ELSE s.survey_intro_en END,
    updated_by = EXCLUDED.updated_by;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_participant_settings',
    v_event::text,
    'event.participant_settings.updated.v1',
    jsonb_build_object('event_id', v_event, 'keys', to_jsonb(v_keys)),
    v_uid
  );

  RETURN public.admin_event_participant_settings_get(v_event);
END;
$function$;
COMMENT ON FUNCTION public.admin_event_participant_settings_save(jsonb) IS
  'Panel: zapis ustawien uczestnika. Brak klucza = bez zmian; kazda wartosc walidowana PRZED zapisem (invalid_*), pusty tekst = NULL. Emituje event.participant_settings.updated.v1 {event_id, keys}. Zwraca to samo co _get.';
REVOKE ALL ON FUNCTION public.admin_event_participant_settings_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_participant_settings_save(jsonb) TO authenticated, service_role;

-- LOCKS: none (read only).
CREATE OR REPLACE FUNCTION public.admin_event_message_delivery_stats(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  v_tenant := public.assert_event_admin_tenant();
  RETURN jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', g.kind, 'channel', g.channel, 'claimed', g.claimed,
               'sent', g.sent, 'skipped', g.skipped, 'failed', g.failed)
             ORDER BY g.kind, g.channel)
        FROM (
          SELECT d.kind, d.channel,
                 count(*) FILTER (WHERE d.status = 'claimed') AS claimed,
                 count(*) FILTER (WHERE d.status = 'sent') AS sent,
                 count(*) FILTER (WHERE d.status = 'skipped') AS skipped,
                 count(*) FILTER (WHERE d.status = 'failed') AS failed
            FROM public.event_message_deliveries d
           WHERE d.tenant_id = v_tenant AND d.event_id = p_event_id
           GROUP BY d.kind, d.channel
        ) g
    ), '[]'::jsonb),
    'last_sent_at', (
      SELECT max(d.sent_at) FROM public.event_message_deliveries d
       WHERE d.tenant_id = v_tenant AND d.event_id = p_event_id
    )
  );
END;
$function$;
COMMENT ON FUNCTION public.admin_event_message_delivery_stats(uuid) IS
  'Panel komunikacji: liczniki dziennika doreczen wydarzenia per rodzaj i kanal (claimed/sent/skipped/failed) + ostatnie wyslanie. Filtr najemca + wydarzenie.';
REVOKE ALL ON FUNCTION public.admin_event_message_delivery_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_message_delivery_stats(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9) Publiczne RPC: flagi potrzebne UI uczestnika (niezalezne od widza)
-- ----------------------------------------------------------------------------

-- LOCKS: none (read only).
CREATE OR REPLACE FUNCTION public.event_participant_options(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event public.events;
  v_s public.event_participant_settings;
  v_end timestamptz;
BEGIN
  IF v_tenant IS NULL OR p_slug IS NULL OR btrim(p_slug) = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = btrim(p_slug) AND e.status = 'published';
  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_s := public._event_participant_settings_effective(v_tenant, v_event.id);
  v_end := public._event_effective_end(v_event.starts_at, v_event.ends_at);

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'timezone', public._event_safe_timezone(v_event.timezone),
    'starts_at', v_event.starts_at,
    'ends_at', v_event.ends_at,
    'effective_end', v_end,
    'calendar_export_enabled', v_s.calendar_export_enabled,
    'reminders_enabled', v_s.reminders_enabled,
    'reminder_event_leads_minutes', to_jsonb(v_s.reminder_event_leads_minutes),
    'session_reminders_enabled', v_s.session_reminders_enabled,
    'session_reminder_lead_minutes', v_s.session_reminder_lead_minutes,
    'reminder_sms_enabled', v_s.reminder_sms_enabled,
    'transfer_enabled', v_s.transfer_enabled,
    'transfer_deadline_at', v_event.starts_at - make_interval(hours => v_s.transfer_deadline_hours),
    'refund_mode', v_s.refund_mode,
    'refund_deadline_hours', v_s.refund_deadline_hours,
    'waitlist_offer_hours', v_s.waitlist_offer_hours,
    'certificate_enabled', v_s.certificate_enabled,
    'survey_enabled', v_s.survey_enabled,
    'survey_opens_at', v_end,
    'survey_closes_at', v_end + make_interval(days => v_s.survey_close_after_days)
  );
END;
$function$;
COMMENT ON FUNCTION public.event_participant_options(text) IS
  'Publiczne flagi funkcji uczestnika opublikowanego wydarzenia (niezalezne od widza, bez danych osobowych): kalendarz, przypomnienia, przekazanie, zwrot, oferty, certyfikat, okno ankiety. Wydarzenie nieopublikowane/nieznane = {"ok":false}.';
REVOKE ALL ON FUNCTION public.event_participant_options(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_participant_options(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10) Rezerwacja i potwierdzenie doreczenia (service_role)
-- ----------------------------------------------------------------------------

-- LOCKS: event_message_deliveries row (INSERT ... ON CONFLICT) only.
CREATE OR REPLACE FUNCTION public._event_delivery_claim(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_event uuid;
  v_registration uuid;
  v_person uuid;
  v_user uuid;
  v_session uuid;
  v_lead integer;
  v_starts timestamptz;
  v_kind text := NULLIF(btrim(COALESCE(p_payload->>'kind', '')), '');
  v_channel text := NULLIF(btrim(COALESCE(p_payload->>'channel', '')), '');
  v_key text := NULLIF(btrim(COALESCE(p_payload->>'dedupe_key', '')), '');
  v_id uuid;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: payload must be a JSON object';
  END IF;

  BEGIN
    v_tenant := NULLIF(p_payload->>'tenant_id', '')::uuid;
    v_event := NULLIF(p_payload->>'event_id', '')::uuid;
    v_registration := NULLIF(p_payload->>'registration_id', '')::uuid;
    v_person := NULLIF(p_payload->>'person_id', '')::uuid;
    v_user := NULLIF(p_payload->>'user_id', '')::uuid;
    v_session := NULLIF(p_payload->>'session_id', '')::uuid;
    v_lead := NULLIF(p_payload->>'lead_minutes', '')::integer;
    v_starts := NULLIF(p_payload->>'starts_at', '')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_payload: malformed id, lead_minutes or starts_at';
  END;

  IF v_tenant IS NULL OR v_event IS NULL OR v_kind IS NULL OR v_channel IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant_id, event_id, kind, channel and dedupe_key are required';
  END IF;
  IF v_kind NOT IN ('event_reminder', 'session_reminder', 'waitlist_offer', 'waitlist_offer_expired',
                    'waitlist_offer_refunded', 'waitlist_joined', 'transfer_offer', 'transfer_completed',
                    'transfer_revoked', 'survey_invite', 'certificate_ready') THEN
    RAISE EXCEPTION 'invalid_payload: unknown kind';
  END IF;
  IF v_channel NOT IN ('email', 'sms', 'inapp') THEN
    RAISE EXCEPTION 'invalid_payload: unknown channel';
  END IF;
  IF char_length(v_key) < 8 OR char_length(v_key) > 300 THEN
    RAISE EXCEPTION 'invalid_payload: dedupe_key must have 8..300 characters';
  END IF;
  IF v_lead IS NOT NULL AND (v_lead < 0 OR v_lead > 20160) THEN
    RAISE EXCEPTION 'invalid_payload: lead_minutes must be between 0 and 20160';
  END IF;

  BEGIN
    INSERT INTO public.event_message_deliveries AS d (
      tenant_id, event_id, registration_id, person_id, user_id, session_id,
      kind, channel, lead_minutes, starts_at_snapshot, dedupe_key
    ) VALUES (
      v_tenant, v_event, v_registration, v_person, v_user, v_session,
      v_kind, v_channel, v_lead, v_starts, v_key
    )
    ON CONFLICT (tenant_id, dedupe_key) DO UPDATE SET
      status = 'claimed',
      claimed_at = now(),
      attempts = d.attempts + 1,
      updated_at = now()
    -- Powiadomienia w aplikacji sa jednorazowe: nigdy ponownie rezerwowane
    -- (dzwonek wyslany dwa razy to dwa dzwonki). E-mail/SMS: porzucona
    -- rezerwacja po 15 min albo blad przy mniej niz 3 probach. Limit 10 prob
    -- porzuconej rezerwacji chroni CHECK `attempts BETWEEN 1 AND 10`.
    WHERE d.channel <> 'inapp'
      AND (
        (d.status = 'claimed' AND d.claimed_at < now() - interval '15 minutes' AND d.attempts < 10)
        OR (d.status = 'failed' AND d.attempts < 3)
      )
    RETURNING d.id INTO v_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'invalid_payload: referenced event, registration, person, user or session does not exist';
  END;

  RETURN v_id;
END;
$function$;
COMMENT ON FUNCTION public._event_delivery_claim(jsonb) IS
  'Rezerwuje doreczenie po kluczu deduplikacji (UNIQUE tenant_id+dedupe_key). Zwraca id nowego albo ponownie zarezerwowanego wiersza, NULL gdy nie do wziecia. In-app nigdy ponownie; e-mail/SMS po 15 min porzucenia albo po bledzie (proby < 3).';
REVOKE ALL ON FUNCTION public._event_delivery_claim(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_delivery_claim(jsonb) TO service_role;

-- LOCKS: event_message_deliveries row (UPDATE) only.
CREATE OR REPLACE FUNCTION public._event_delivery_confirm(p_id uuid, p_status text, p_detail text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('sent', 'skipped', 'failed') THEN
    RAISE EXCEPTION 'invalid_status: status must be sent, skipped or failed';
  END IF;

  UPDATE public.event_message_deliveries d
     SET status = p_status,
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE d.sent_at END,
         detail = left(NULLIF(btrim(COALESCE(p_detail, '')), ''), 500),
         updated_at = now()
   WHERE d.id = p_id
     AND d.status = 'claimed';
  RETURN FOUND;
END;
$function$;
COMMENT ON FUNCTION public._event_delivery_confirm(uuid, text, text) IS
  'Zamyka zarezerwowane doreczenie: sent (ze stemplem sent_at), skipped albo failed; detail = powod/kod bledu bez danych osobowych. Dziala wylacznie na wierszu w stanie claimed; zwraca czy cos zmieniono.';
REVOKE ALL ON FUNCTION public._event_delivery_confirm(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_delivery_confirm(uuid, text, text) TO service_role;
