-- events-harness: include
-- ============================================================================
-- REJESTR ZGOD UCZESTNIKOW WYDARZEN (REG-02 / REG-14, INFRASTRUKTURA):
-- TEKSTY WERSJONOWANE, KSIEGA APPEND-ONLY, TOKENY DOUBLE OPT-IN.
--
-- DEFEKT (audyt zapisow na wydarzenia, REG-02 i REG-14).
--   1. Zgody osoby to cztery gole stemple w `event_people`
--      (`consent_data_processing_at`, `consent_marketing_at`,
--      `consent_partner_sharing_at`, `consent_withdrawn_at`). Brak tekstu,
--      wersji, kanalu i dowodu, ze zgode dal wlasciciel adresu - a art. 7
--      ust. 1 RODO kaze administratorowi WYKAZAC zgode.
--   2. Kazdy, takze anonim, stawial te stemple cudzej osobie: `event_register`
--      (20261007140400:534-552) po samym e-mailu z ladunku ustawia marketing
--      i partnerow na now() i zeruje `consent_withdrawn_at` (:551). Wycofania
--      nie ustawia nic - wszystkie przypisania w migracjach to `= NULL`.
--   3. Most do CRM (`_event_person_crm_sync`, 20260927001400:303-345) traktuje
--      te stemple jak dowod: `marketing_consent = l.marketing_consent OR
--      v_evidence` i wiersz `crm_consent_log` z tekstem zmyslonym przez most.
--      Zgoda w CRM jest monotoniczna - wycofanie nigdy tam nie dociera.
--
-- ZMIANA (ta migracja i dwie nastepne w slocie 20261012100100..100999):
--   A. `event_consent_texts` - globalne, wersjonowane teksty checkboxow
--      formularza (PL/EN) z odciskiem sha256. Wersja 1 = DOKLADNIE napisy
--      renderowane dzis przez PublicRegistrationForm.tsx
--      (`eventRegistration.consents.*` w src/lib/i18n-event-registration.ts);
--      bramka vitest `eventConsentTexts.gate.test.ts` pilnuje, ze zmiana napisu
--      w i18n bez nowej wersji tutaj czerwieni CI.
--   B. `event_consent_confirmations` - tokeny double opt-in (w bazie tylko
--      sha256), jeden otwarty na osobe, 7 dni waznosci; tylko service_role.
--   C. `event_consent_records` - KSIEGA append-only (UPDATE i TRUNCATE rzucaja
--      `append_only`; DELETE wylacznie kaskada przy usunieciu osoby - prawo do
--      usuniecia danych). Cztery CHECK-i inwariantow czynia REG-02 niemozliwym
--      do odtworzenia na poziomie bazy:
--        * `_verified_grant`   - marketing/partnerzy 'confirmed' tylko z kanalu
--          zweryfikowanego (konto z potwierdzonym adresem, DOI z maila) albo
--          jako spadek (`legacy_single_opt_in`);
--        * `_pending_channel`  - 'pending' tylko z formularza;
--        * `_withdraw_channel` - 'withdrawn' tylko z kanalu wlasciciela
--          (link samoobslugi, ustawienia konta, link wypisu);
--        * `_text_for_grant`   - kazde udzielenie (poza spadkiem) wskazuje
--          tekst i wersje, ktore osoba widziala.
--   D. `event_registrations.submitted_profile` - dane, ktore przyslal
--      NIEZWERYFIKOWANY zapisujacy (do wgladu organizatora zamiast nadpisania
--      kartoteki; zapisuje je jednostka B1a).
--   E. Spadek: kazdy dzisiejszy aktywny stempel marketingu/partnerow dostaje
--      wiersz 'confirmed' z dowodem `legacy_single_opt_in` i data stempla
--      (idempotentna `_event_consent_backfill_legacy()`, wolana tu raz).
--      Projekcja (kolumny `event_people`) zostaje bez zmian.
--   F. `_event_consent_text_check` - jedyna walidacja (cel, wersja, jezyk).
--   Pomocnicze funkcje zapisu (20261012100200) i most CRM czytajacy ksiege
--   (20261012100300) - w osobnych plikach, kazdy < 45 KiB (limit Lovable).
--
-- CZEGO TO NIE ZAMYKA: `event_register`, `_event_cfp_resolve_person`
--   i `event_package_invite_accept` nadal pisza stemple zgod wprost (ich
--   wlasciciele - B1a, B3, B2 - przepinaja je na pomocnicze funkcje tej
--   jednostki; tymczasowa lista w supabase/tests/event_consent_writers_test.sql
--   moze tylko malec). Historycznych zgod sfalszowanych przed ta migracja nie
--   da sie odroznic od prawdziwych - dostaja dowod `legacy_single_opt_in`, nie
--   sa uniewazniane (decyzja produktu/prawna, opisana w raporcie). Granty
--   kolumnowe `event_registrations` (D10: authenticated nie czyta
--   `submitted_profile`) naleza do jednostki B4.
--
-- KOLEJNOSC WDROZENIA: dowolna (nowe obiekty; nic w TS jeszcze ich nie wola).
-- IDEMPOTENTNA: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP ... IF
--   EXISTS przed CREATE TRIGGER/POLICY, ON CONFLICT DO NOTHING dla tekstow,
--   NOT EXISTS dla spadku, bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/event_consent_ledger_test.sql,
--   supabase/tests/event_consent_writers_test.sql,
--   scripts/events-harness/runtime_test.d/23_consent_ledger.sql,
--   src/lib/events/__tests__/eventConsentTexts.gate.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) TEKSTY ZGOD - wersjonowane, niezmienne po publikacji
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_consent_texts (
  purpose        text NOT NULL
    CONSTRAINT event_consent_texts_purpose_values
    CHECK (purpose IN ('data_processing', 'marketing', 'partner_sharing')),
  version        integer NOT NULL
    CONSTRAINT event_consent_texts_version_positive CHECK (version > 0),
  lang           text NOT NULL
    CONSTRAINT event_consent_texts_lang_values CHECK (lang IN ('pl', 'en')),
  body           text NOT NULL
    CONSTRAINT event_consent_texts_body_len CHECK (char_length(body) BETWEEN 10 AND 2000),
  -- Odcisk liczy baza, nie wolajacy: kolumna generowana nie da sie podac ani
  -- zmienic, wiec skrot zawsze opisuje dokladnie zapisany tekst.
  body_sha256    text GENERATED ALWAYS AS (encode(extensions.digest(body, 'sha256'), 'hex')) STORED,
  effective_from timestamptz NOT NULL DEFAULT now(),
  retired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_consent_texts_pkey PRIMARY KEY (purpose, version, lang),
  CONSTRAINT event_consent_texts_retired_after_effective
    CHECK (retired_at IS NULL OR retired_at >= effective_from)
);

-- Jedna obowiazujaca wersja na cel i jezyk. Nowa wersja: najpierw `retired_at`
-- starej, potem INSERT nowej (w tej kolejnosci, inaczej ten indeks odmowi).
CREATE UNIQUE INDEX IF NOT EXISTS event_consent_texts_active_uniq
  ON public.event_consent_texts (purpose, lang)
  WHERE retired_at IS NULL;

COMMENT ON TABLE public.event_consent_texts IS
  'Wersjonowane teksty zgod formularza zapisu na wydarzenie (globalne, PL/EN). Wiersz opublikowanej wersji jest niezmienny: UPDATE moze wylacznie wycofac go z uzycia (retired_at), DELETE i TRUNCATE rzucaja append_only. Nowa wersja = retired_at starej + INSERT nowej + EVENT_CONSENT_TEXT_VERSION w src/lib/events/consentTexts.ts (pilnuje bramka eventConsentTexts.gate.test.ts).';
COMMENT ON COLUMN public.event_consent_texts.body IS
  'Dokladny tekst checkboxa, ktory widziala osoba (ten sam napis co klucz i18n eventRegistration.consents.* dla tej wersji).';
COMMENT ON COLUMN public.event_consent_texts.body_sha256 IS
  'sha256(body) w hex, liczony przez baze (kolumna generowana) - dowod, ze tekst wersji nie zmienil sie po publikacji.';

-- Wspolny straznik "tylko dopisywanie" dla operacji, ktore nie maja wyjatkow
-- (TRUNCATE ksiegi i tekstow, DELETE tekstow). Funkcja wyzwalacza bez
-- odwolan do NEW/OLD, wiec obsluguje i wyzwalacz wierszowy, i zdaniowy.
CREATE OR REPLACE FUNCTION public._tg_event_consent_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'append_only: % does not allow %', TG_TABLE_NAME, TG_OP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_consent_append_only() FROM PUBLIC, anon, authenticated;

-- Tekst opublikowanej wersji jest dowodem tego, co osoba widziala - zmiana
-- tresci po fakcie przepisalaby historie kazdej zgody na tej wersji. Jedyna
-- dopuszczalna zmiana to jednorazowe wycofanie wersji z uzycia. Odcisk
-- (`body_sha256`) pomijamy w porownaniu: w wyzwalaczu BEFORE kolumna
-- generowana nie jest jeszcze policzona, a i tak wynika z `body`.
CREATE OR REPLACE FUNCTION public._tg_event_consent_texts_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['retired_at', 'body_sha256'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['retired_at', 'body_sha256'])
     OR OLD.retired_at IS NOT NULL
     OR NEW.retired_at IS NULL THEN
    RAISE EXCEPTION 'append_only: a published consent text can only be retired once';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_consent_texts_guard_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_consent_texts_guard_update ON public.event_consent_texts;
CREATE TRIGGER event_consent_texts_guard_update
  BEFORE UPDATE ON public.event_consent_texts
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_consent_texts_guard_update();

DROP TRIGGER IF EXISTS event_consent_texts_no_delete ON public.event_consent_texts;
CREATE TRIGGER event_consent_texts_no_delete
  BEFORE DELETE ON public.event_consent_texts
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_consent_append_only();

DROP TRIGGER IF EXISTS event_consent_texts_no_truncate ON public.event_consent_texts;
CREATE TRIGGER event_consent_texts_no_truncate
  BEFORE TRUNCATE ON public.event_consent_texts
  FOR EACH STATEMENT EXECUTE FUNCTION public._tg_event_consent_append_only();

-- Teksty sa publiczne z natury (stoja na formularzu), wiec odczyt dla kazdego;
-- zapis wylacznie migracja (wlasciciel tabeli), bez zadnej roli klienckiej.
ALTER TABLE public.event_consent_texts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_consent_texts_public_read" ON public.event_consent_texts;
CREATE POLICY "event_consent_texts_public_read"
  ON public.event_consent_texts FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE ALL ON TABLE public.event_consent_texts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.event_consent_texts TO anon, authenticated, service_role;

-- Wersja 1: napisy renderowane przez PublicRegistrationForm.tsx w chwili tej
-- migracji (`eventRegistration.consents.dataProcessing|marketing|partnerSharing`,
-- PL i EN). Znak w znak - porownuje je bramka eventConsentTexts.gate.test.ts.
INSERT INTO public.event_consent_texts (purpose, version, lang, body, effective_from) VALUES
  ('data_processing', 1, 'pl', 'Zgadzam się na przetwarzanie moich danych w celu obsługi zapisu.', '2026-10-12 00:00+00'),
  ('data_processing', 1, 'en', 'I agree to the processing of my data to handle this registration.', '2026-10-12 00:00+00'),
  ('marketing', 1, 'pl', 'Chcę otrzymywać informacje o kolejnych wydarzeniach.', '2026-10-12 00:00+00'),
  ('marketing', 1, 'en', 'I want to hear about upcoming events.', '2026-10-12 00:00+00'),
  ('partner_sharing', 1, 'pl', 'Zgadzam się na przekazanie danych partnerom tego wydarzenia.', '2026-10-12 00:00+00'),
  ('partner_sharing', 1, 'en', 'I agree to share my data with the partners of this event.', '2026-10-12 00:00+00')
ON CONFLICT (purpose, version, lang) DO NOTHING;

-- ----------------------------------------------------------------------------
-- B) POTWIERDZENIA DOUBLE OPT-IN - token tylko jako skrot, tylko service_role
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_consent_confirmations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  person_id            uuid NOT NULL,
  event_id             uuid,
  registration_id      uuid,
  -- Adres w chwili wydania: potwierdzenie dotyczy skrzynki, do ktorej poszedl
  -- mail. Gdy organizator zmieni e-mail osoby, stary link nie moze juz niczego
  -- udzielic (sprawdza to RPC potwierdzenia).
  email_norm           text NOT NULL
    CONSTRAINT event_consent_confirmations_email_norm_shape
    CHECK (email_norm = lower(btrim(email_norm)) AND char_length(email_norm) BETWEEN 3 AND 320),
  token_hash           text NOT NULL
    CONSTRAINT event_consent_confirmations_token_hash_shape CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  purposes             text[] NOT NULL
    CONSTRAINT event_consent_confirmations_purposes_values
    CHECK (cardinality(purposes) > 0 AND purposes <@ ARRAY['marketing', 'partner_sharing']::text[]),
  text_version         integer NOT NULL
    CONSTRAINT event_consent_confirmations_text_version_positive CHECK (text_version > 0),
  text_lang            text NOT NULL
    CONSTRAINT event_consent_confirmations_text_lang_values CHECK (text_lang IN ('pl', 'en')),
  requested_ip_subject text
    CONSTRAINT event_consent_confirmations_requested_ip_shape
    CHECK (requested_ip_subject IS NULL OR requested_ip_subject ~ '^ip:[0-9a-f]{32}$'),
  requested_user_agent text
    CONSTRAINT event_consent_confirmations_requested_ua_len
    CHECK (requested_user_agent IS NULL OR char_length(requested_user_agent) <= 400),
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  mailed_at            timestamptz,
  confirmed_at         timestamptz,
  confirmed_ip_subject text
    CONSTRAINT event_consent_confirmations_confirmed_ip_shape
    CHECK (confirmed_ip_subject IS NULL OR confirmed_ip_subject ~ '^ip:[0-9a-f]{32}$'),
  confirmed_user_agent text
    CONSTRAINT event_consent_confirmations_confirmed_ua_len
    CHECK (confirmed_user_agent IS NULL OR char_length(confirmed_user_agent) <= 400),
  confirmed_by_user    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  superseded_at        timestamptz,
  CONSTRAINT event_consent_confirmations_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_consent_confirmations_token_hash_key UNIQUE (token_hash),
  CONSTRAINT event_consent_confirmations_expiry_after_issue CHECK (expires_at > created_at),
  -- Potwierdzone nie bywa pozniej "zastapione": wycofanie zastepuje tylko
  -- otwarte linki, a udzielona zgode odwoluje wpis 'withdrawn' w ksiedze.
  CONSTRAINT event_consent_confirmations_single_outcome
    CHECK (confirmed_at IS NULL OR superseded_at IS NULL),
  CONSTRAINT event_consent_confirmations_person_fk
    FOREIGN KEY (tenant_id, person_id) REFERENCES public.event_people(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_consent_confirmations_registration_fk
    FOREIGN KEY (tenant_id, registration_id) REFERENCES public.event_registrations(tenant_id, id)
    ON DELETE SET NULL (registration_id),
  CONSTRAINT event_consent_confirmations_event_fk
    FOREIGN KEY (tenant_id, event_id) REFERENCES public.events(tenant_id, id)
    ON DELETE SET NULL (event_id)
);

-- Najwyzej jeden otwarty link na osobe: nowy zapis zastepuje poprzedni, wiec
-- stary mail nie potwierdzi zgod, ktorych osoba w miedzyczasie nie chciala.
CREATE UNIQUE INDEX IF NOT EXISTS event_consent_confirmations_open_uniq
  ON public.event_consent_confirmations (tenant_id, person_id)
  WHERE confirmed_at IS NULL AND superseded_at IS NULL;

COMMENT ON TABLE public.event_consent_confirmations IS
  'Linki double opt-in zgod marketingu i partnerow (REG-02/REG-14). Token tylko jako sha256 (jawny zwraca raz _event_consent_issue_confirmation do wysylki mailem), 7 dni waznosci, jeden otwarty na osobe, zastepowany przez nowe wydanie i przez wycofanie celow, ktore obejmuje. Wylacznie service_role (RLS bez polityk).';

ALTER TABLE public.event_consent_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_consent_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_consent_confirmations TO service_role;

-- ----------------------------------------------------------------------------
-- C) KSIEGA ZGOD - tylko dopisywanie
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_consent_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Porzadek dopisania. now() jest stale w transakcji, wiec created_at nie
  -- rozstrzyga, ktory z dwoch wpisow tej samej transakcji jest nowszy
  -- (potwierdzenie i wycofanie w jednym zadaniu); kolejnosc niesie seq.
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  person_id       uuid NOT NULL,
  event_id        uuid,
  registration_id uuid,
  confirmation_id uuid,
  email_norm      text
    CONSTRAINT event_consent_records_email_norm_shape
    CHECK (email_norm IS NULL OR (email_norm = lower(btrim(email_norm)) AND char_length(email_norm) BETWEEN 3 AND 320)),
  purpose         text NOT NULL
    CONSTRAINT event_consent_records_purpose_values
    CHECK (purpose IN ('data_processing', 'marketing', 'partner_sharing')),
  status          text NOT NULL
    CONSTRAINT event_consent_records_status_values
    CHECK (status IN ('pending', 'confirmed', 'withdrawn')),
  evidence        text NOT NULL
    CONSTRAINT event_consent_records_evidence_values
    CHECK (evidence IN ('registration_form', 'verified_account', 'email_double_opt_in',
                        'manage_token', 'account_settings', 'unsubscribe_link',
                        'legacy_single_opt_in')),
  text_version    integer,
  text_lang       text
    CONSTRAINT event_consent_records_text_lang_values CHECK (text_lang IS NULL OR text_lang IN ('pl', 'en')),
  ip_subject      text
    CONSTRAINT event_consent_records_ip_subject_shape
    CHECK (ip_subject IS NULL OR ip_subject ~ '^ip:[0-9a-f]{32}$'),
  user_agent      text
    CONSTRAINT event_consent_records_user_agent_len
    CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  actor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source          text
    CONSTRAINT event_consent_records_source_len CHECK (source IS NULL OR char_length(source) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_consent_records_seq_key UNIQUE (seq),
  -- INWARIANTY REG-02 (komentarz w naglowku migracji).
  CONSTRAINT event_consent_records_verified_grant CHECK (
    status <> 'confirmed'
    OR purpose = 'data_processing'
    OR evidence IN ('verified_account', 'email_double_opt_in', 'legacy_single_opt_in')
  ),
  CONSTRAINT event_consent_records_pending_channel CHECK (
    status <> 'pending' OR evidence = 'registration_form'
  ),
  CONSTRAINT event_consent_records_withdraw_channel CHECK (
    status <> 'withdrawn' OR evidence IN ('manage_token', 'account_settings', 'unsubscribe_link')
  ),
  CONSTRAINT event_consent_records_text_for_grant CHECK (
    status = 'withdrawn' OR evidence = 'legacy_single_opt_in' OR text_version IS NOT NULL
  ),
  -- Udzielenie albo prosba o zgode dotyczy konkretnej skrzynki; wycofanie
  -- przyjmujemy takze od osoby bez adresu (wycofanie nigdy nie moze sie
  -- nie udac z braku danych).
  CONSTRAINT event_consent_records_grant_has_address CHECK (
    status = 'withdrawn' OR email_norm IS NOT NULL
  ),
  CONSTRAINT event_consent_records_text_pair CHECK ((text_version IS NULL) = (text_lang IS NULL)),
  CONSTRAINT event_consent_records_person_fk
    FOREIGN KEY (tenant_id, person_id) REFERENCES public.event_people(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_consent_records_registration_fk
    FOREIGN KEY (tenant_id, registration_id) REFERENCES public.event_registrations(tenant_id, id)
    ON DELETE SET NULL (registration_id),
  CONSTRAINT event_consent_records_event_fk
    FOREIGN KEY (tenant_id, event_id) REFERENCES public.events(tenant_id, id)
    ON DELETE SET NULL (event_id),
  CONSTRAINT event_consent_records_confirmation_fk
    FOREIGN KEY (tenant_id, confirmation_id) REFERENCES public.event_consent_confirmations(tenant_id, id)
    ON DELETE SET NULL (confirmation_id),
  -- Tekst MUSI byc tym samym celem co wpis: klucz obcy po (purpose, wersja,
  -- jezyk). MATCH SIMPLE - wpis bez wersji (wycofanie, spadek) nie jest
  -- sprawdzany, a tekstu, na ktory wskazuje jakikolwiek wpis, nie da sie usunac.
  CONSTRAINT event_consent_records_text_fk
    FOREIGN KEY (purpose, text_version, text_lang)
    REFERENCES public.event_consent_texts(purpose, version, lang)
);

CREATE INDEX IF NOT EXISTS event_consent_records_person_idx
  ON public.event_consent_records (tenant_id, person_id, purpose, seq DESC);
CREATE INDEX IF NOT EXISTS event_consent_records_registration_idx
  ON public.event_consent_records (tenant_id, registration_id)
  WHERE registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_consent_records_confirmation_idx
  ON public.event_consent_records (tenant_id, confirmation_id)
  WHERE confirmation_id IS NOT NULL;

COMMENT ON TABLE public.event_consent_records IS
  'Ksiega zgod uczestnikow wydarzen (append-only, REG-02/REG-14): kazde udzielenie, prosba o potwierdzenie i wycofanie celu data_processing/marketing/partner_sharing z kanalem dowodu, tekstem i wersja, solonym skrotem adresu IP (ip:<32 hex>) i user agentem z serwera. Kolumny zgod w event_people sa jej PROJEKCJA, pisana wylacznie przez _event_person_consents_confirm/_withdraw. UPDATE rzuca append_only (wyjatek: zerowanie odnosnikow przez akcje kluczy obcych), TRUNCATE rzuca append_only, DELETE tylko kaskada przy usunieciu osoby.';
COMMENT ON COLUMN public.event_consent_records.seq IS
  'Kolejnosc dopisania (created_at jest stale w transakcji). Najnowszy wpis celu = najwiekszy seq.';
COMMENT ON COLUMN public.event_consent_records.email_norm IS
  'Adres osoby w chwili wpisu. Most CRM uznaje zgode tylko, gdy wpis dotyczy obecnego adresu osoby.';
COMMENT ON COLUMN public.event_consent_records.ip_subject IS
  'Solony skrot adresu klienta policzony przez serwer aplikacji (requestRateSubject), nigdy wartosc z ladunku przegladarki.';

-- Ksiega jest dowodem - wpisu nie poprawia sie, tylko dopisuje nowy. Jedyny
-- legalny UPDATE to akcja ON DELETE SET NULL kluczy obcych (usuniecie
-- zgloszenia, wydarzenia, linku DOI albo konta aktora): zeruje odnosnik i nie
-- rusza tresci wpisu. Bez tego wyjatku usuniecie zgloszenia wywracaloby sie
-- na tym wyzwalaczu.
CREATE OR REPLACE FUNCTION public._tg_event_consent_records_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['event_id', 'registration_id', 'confirmation_id', 'actor_user_id'])
       IS NOT DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['event_id', 'registration_id', 'confirmation_id', 'actor_user_id'])
     AND (NEW.event_id IS NULL OR NEW.event_id IS NOT DISTINCT FROM OLD.event_id)
     AND (NEW.registration_id IS NULL OR NEW.registration_id IS NOT DISTINCT FROM OLD.registration_id)
     AND (NEW.confirmation_id IS NULL OR NEW.confirmation_id IS NOT DISTINCT FROM OLD.confirmation_id)
     AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'append_only: event_consent_records entries cannot be changed - append a new entry instead';
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_consent_records_guard_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_consent_records_guard_update ON public.event_consent_records;
CREATE TRIGGER event_consent_records_guard_update
  BEFORE UPDATE ON public.event_consent_records
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_consent_records_guard_update();

DROP TRIGGER IF EXISTS event_consent_records_no_truncate ON public.event_consent_records;
CREATE TRIGGER event_consent_records_no_truncate
  BEFORE TRUNCATE ON public.event_consent_records
  FOR EACH STATEMENT EXECUTE FUNCTION public._tg_event_consent_append_only();

-- RLS: administrator najemcy (i super admin - kontrakt
-- event_admin_only_contract_test.sql) czyta ksiege swoich osob, osoba czyta
-- wlasna (art. 15 RODO). Zapisu z klienta nie ma: pisza wylacznie funkcje
-- SECURITY DEFINER tej jednostki.
ALTER TABLE public.event_consent_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_consent_records_staff_read" ON public.event_consent_records;
CREATE POLICY "event_consent_records_staff_read"
  ON public.event_consent_records FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_consent_records_self_read" ON public.event_consent_records;
CREATE POLICY "event_consent_records_self_read"
  ON public.event_consent_records FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1
        FROM public.event_people p
       WHERE p.tenant_id = event_consent_records.tenant_id
         AND p.id = event_consent_records.person_id
         AND p.user_id = (SELECT auth.uid())
    )
  );

-- service_role bez UPDATE/DELETE/TRUNCATE: nawet klucz serwisowy nie poprawi
-- ani nie skasuje dowodu (kaskada kluczy obcych dziala z prawami wlasciciela).
REVOKE ALL ON TABLE public.event_consent_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.event_consent_records TO authenticated;
GRANT SELECT, INSERT ON TABLE public.event_consent_records TO service_role;

-- ----------------------------------------------------------------------------
-- D) DANE PRZYSLANE PRZEZ NIEZWERYFIKOWANEGO ZAPISUJACEGO
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS submitted_profile jsonb
    CONSTRAINT event_registrations_submitted_profile_shape
    CHECK (
      submitted_profile IS NULL
      OR (jsonb_typeof(submitted_profile) = 'object' AND char_length(submitted_profile::text) <= 4000)
    );

COMMENT ON COLUMN public.event_registrations.submitted_profile IS
  'Dane osobowe przyslane w formularzu przez NIEZWERYFIKOWANEGO zapisujacego (imie, nazwisko, telefon, stanowisko, firma, profil), gdy roznia sie od kartoteki istniejacej osoby. Kartoteka nie jest nadpisywana (REG-02); organizator przeglada te dane i moze je przeniesc. Do wgladu organizatora - nigdy nie pokazywane uczestnikom.';

-- ----------------------------------------------------------------------------
-- E) SPADEK: dzisiejsze aktywne zgody jako wpisy `legacy_single_opt_in`
-- ----------------------------------------------------------------------------
-- Tylko stemple bez wycofania i tylko osoby z adresem (wpis udzielenia dotyczy
-- skrzynki). Data wpisu = data stempla, wiec najnowszym wpisem celu zostaje
-- spadek, dopoki osoba nie potwierdzi albo nie wycofa zgody na nowo. Osoba,
-- ktora ma JAKIKOLWIEK wpis celu, jest pomijana - funkcja jest idempotentna.
--
-- FUNKCJA, NIE JEDNORAZOWY INSERT: do wdrozenia jednostki B1a stary
-- `event_register` nadal stawia stemple bez wpisu ksiegi. Ponowne wywolanie po
-- przepieciu pisarzy domyka i te osoby, a test (event_consent_ledger_test.sql)
-- dowodzi tej samej sciezki, ktora wykonala migracja. SECURITY INVOKER - nie
-- daje nikomu wiecej, niz ma wolajacy; klient nie ma EXECUTE.
CREATE OR REPLACE FUNCTION public._event_consent_backfill_legacy()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.event_consent_records (
    tenant_id, person_id, email_norm, purpose, status, evidence, source, created_at
  )
  SELECT p.tenant_id, p.id, p.email_norm, c.purpose, 'confirmed', 'legacy_single_opt_in',
         'backfill:20261012100100', c.stamp
    FROM public.event_people p
   CROSS JOIN LATERAL (
     VALUES ('marketing'::text, p.consent_marketing_at),
            ('partner_sharing'::text, p.consent_partner_sharing_at)
   ) AS c(purpose, stamp)
   WHERE c.stamp IS NOT NULL
     AND p.consent_withdrawn_at IS NULL
     AND p.email_norm IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.event_consent_records r
        WHERE r.tenant_id = p.tenant_id
          AND r.person_id = p.id
          AND r.purpose = c.purpose
     )
   ORDER BY c.stamp, p.id, c.purpose;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._event_consent_backfill_legacy() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_consent_backfill_legacy() IS
  'Utrzymaniowa (migracja, operator): dopisuje do event_consent_records wpis confirmed/legacy_single_opt_in z data stempla dla kazdego aktywnego (bez consent_withdrawn_at) stempla marketingu/partnerow osoby z adresem, ktora nie ma jeszcze zadnego wpisu tego celu. Idempotentna, zwraca liczbe dopisanych wpisow. SECURITY INVOKER, bez EXECUTE dla klienta.';

SELECT public._event_consent_backfill_legacy();

-- ----------------------------------------------------------------------------
-- F) WALIDACJA TEKSTU ZGODY
-- ----------------------------------------------------------------------------
-- Przyjmuje takze wersje wycofana z uzycia: przegladarka z paczka sprzed
-- wdrozenia nowej wersji pokazala stary tekst i to on jest prawda o zgodzie.
-- Nie przyjmuje wersji, ktorej nie ma (wolajacy nie wymysli tekstu).
CREATE OR REPLACE FUNCTION public._event_consent_text_check(p_purpose text, p_version integer, p_lang text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_purpose IS NULL OR p_version IS NULL OR p_lang IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.event_consent_texts t
     WHERE t.purpose = p_purpose
       AND t.version = p_version
       AND t.lang = p_lang
  ) THEN
    RAISE EXCEPTION 'consent_text_unknown: no consent text for % version % (%)',
      COALESCE(p_purpose, '?'), COALESCE(p_version::text, '?'), COALESCE(p_lang, '?');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._event_consent_text_check(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_consent_text_check(text, integer, text) TO service_role;

COMMENT ON FUNCTION public._event_consent_text_check(text, integer, text) IS
  'Wewnetrzna (service_role i funkcje SECURITY DEFINER): RAISE consent_text_unknown, gdy nie ma tekstu zgody o tym celu, wersji i jezyku. Wersja wycofana z uzycia jest przyjmowana (stara paczka formularza pokazala wlasnie ja).';
