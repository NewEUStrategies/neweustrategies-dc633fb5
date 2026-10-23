-- ============================================================================
-- ZGODA NA POMIAR OTWARĆ I KLIKNIĘĆ JAKO OSOBNE POLE (I9d-Y2b, 1/3): TREŚCI
-- I REJESTRY, KONIEC PAKIETOWANIA, JEDYNY PISARZ „TAK", CZYTELNIK TYLKO DLA
-- SKRZYNKI POTWIERDZONEJ PRZEZ WŁAŚCICIELA, WYPIS ZAMYKA ŁAŃCUCH POMIARU.
-- Decyzje właściciela 2026-10-23: D1 wariant (b) - każda zgoda ma osobne
-- pole (osobne, domyślnie niezaznaczone pole zgody na pomiar z własną,
-- wersjonowaną treścią; treść zgody na newsletter bez pomiaru); D2 - pomiar
-- działa tylko dla skrzynki potwierdzonej przez jej właściciela.
--
-- DEFEKT
--   1. Pakietowanie (wariant (a), 20261020162300): treść zgody na newsletter
--      opisuje pomiar, a wyzwalacz `trg_crm_consent_log_measurement` dopisuje
--      `email_measurement` „tak" do KAŻDEJ zgody newsletter*/marketing*
--      w wersji z rejestru albo z treścią oznaczoną przez admina. Zgoda na
--      newsletter i zgoda na pomiar nie są rozdzielne (art. 7 ust. 2 i 4 RODO).
--   2. D2: zgoda na pomiar powstaje bez decyzji właściciela skrzynki -
--      `newsletter_to_lead` loguje zgody przy KAŻDYM INSERT (także `pending`
--      przed potwierdzeniem double opt-in), `_newsletter_log_consents`
--      przepuszcza dowolny klucz z ładunku (także `email_measurement`),
--      a czytelnik `_email_measurement_consent` odrzuca tylko `unsubscribed`.
--      Ponowny zapis wypisanego adresu przez kogokolwiek przywracał pomiar.
--   3. Wypis (link, personel, odbicie, skarga, import) nie zostawia w łańcuchu
--      pomiaru żadnego „nie" - „Przywróć" w panelu wskrzeszał starą zgodę.
--   4. Kolejność zdarzeń opiera się na `now()` (początek transakcji): „nie"
--      transakcji czekającej na blokadę wiersza dostaje chwilę WCZEŚNIEJSZĄ
--      niż „tak" zapisane po zwolnieniu blokady.
--
-- ZMIANA (projekt I9d-Y2b §3 + rozstrzygnięcia R1)
--   A. Treść zgody na newsletter (b) `newsletter-2026-10-23` bez pomiaru
--      i bez akceptacji polityki; osobna treść pola pomiaru
--      `email-measurement-2026-10-23` (`_email_measurement_consent_default`,
--      `_email_measurement_consent_version`; lustro TS z testem parytetu:
--      src/lib/newsletter/measurementConsentText.ts). Rejestr
--      `_consent_measurement_versions()` od teraz = wersje treści POMIARU.
--      Kanały udzielenia i odmowy (`_email_measurement_grant_channels`,
--      `_email_measurement_refusal_channels`) i lista dawnych zaufanych par
--      (`_email_measurement_legacy_grants`, R1.9).
--   B. Dane ustawień: kopie starej i pakietowej (a) treści domyślnej ->
--      treść (b); kopia DOWOLNEJ domyślnej treści zgody w WYMAGANYM polu
--      prywatności popupu -> NULL (pakiet). Tekst admina zostaje.
--   C. Koniec pakietowania: DROP wyzwalacza i funkcji
--      `tg_crm_consent_log_measurement`, `_consent_covers_measurement`, RPC
--      oznaczeń admina; tabela oznaczeń - archiwum tylko do odczytu.
--   D. Strażnik rejestru: INSERT „tak" `email_measurement` tylko przez
--      `_email_measurement_grant` (flaga transakcji); deklaracja i inna
--      pisownia klucza - odrzucone. UPDATE wpisu pomiaru - tylko adres i opis
--      (pseudonimizacja; dziś żadna ścieżka nie robi UPDATE rejestru -
--      retencja usuwa, kasowanie konta zostawia rejestr jako dowód).
--   E. Czytelnik: subskrybent `subscribed`/`confirmed`, wpis „tak" związany
--      z TYM wierszem, z kanału udzielenia i w wersji pomiaru (albo dawna
--      zaufana para z potwierdzoną prośbą), później niż każde „nie" pomiaru,
--      wycofanie newsletter/marketing i `unsubscribed_at` (remis = brak).
--   F. Pisarz zgód z formularzy pomija oba klucze pomiaru; zastępczy wpis
--      `newsletter` w `newsletter_to_lead` tylko przy PUSTYM `consents`.
--   G. Wypis: wyzwalacz `trg_newsletter_unsubscribed_measurement` -> wewnętrzny
--      `_email_measurement_close_on_unsubscribe` („nie" z kanałem neutralnym
--      `measurement:unsubscribe`, gdy ostatnie słowo łańcucha brzmi „tak").
--      Biała lista `email_measurement_withdraw` BEZ zmian (kanał spoza listy
--      = `email_footer`); wersja wpisu = wersja treści pomiaru.
--   H. Deklaracja z formularza (`email_measurement_declared` w `consents`)
--      i stan oferty `_newsletter_measurement_offer_state` (gone | inactive |
--      granted | none | declined | offer; oferta wygasa po 60 dniach od
--      deklaracji - lustro MEASUREMENT_CONFIRM_LINK_DAYS).
--   Pisarze „tak"/„nie" pomiaru datują `created_at = clock_timestamp()`
--   (chwila zapisu, nie początek transakcji); `_email_measurement_grant` sam
--   blokuje wiersz subskrybenta (FOR UPDATE), potem blokada doradcza.
--
-- UWAGA (R1.3): wypis przez odbicie/skargę idzie wyzwalaczem
-- `tg_email_suppression_sync_subscriber` (20260725123624), który połyka
-- błędy (EXCEPTION WHEN OTHERS THEN RETURN NEW) - błąd wyzwalacza wypisu
-- zniknąłby tam RAZEM ze zmianą statusu. Dlatego pisarz „nie" przy wypisie
-- jest prosty i sam niczego nie rzuca; treść wpisu jest neutralna (wypis,
-- odbicie, skarga albo decyzja personelu - nie przypisuje osobie decyzji).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020162900; przed 20261023090100 (strona DOI,
-- prośba po zapisie) i 20261023090200 (prośby, panel). Front I9d-Y2b - ZARAZ
-- po migracjach (nowy front ze starym SQL zapisałby deklarację jako zgodę).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, DROP ... IF EXISTS, DROP TRIGGER
-- IF EXISTS + CREATE TRIGGER, UPDATE tylko wierszy równych dawnym treściom
-- domyślnym (powtórka = 0), bezstanowe REVOKE/GRANT/COMMENT.
-- DOWÓD: supabase/tests/hub_i9d_y2b_measurement_separate_test.sql
-- (+ hub_i9d_y2_consent_test.sql po przepięciu na wariant (b)).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Treści, wersje, kanały, rejestr wersji pomiaru.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020162300; zmiana - treść (b): bez pomiaru, bez akceptacji
-- polityki (polityka to informacja z art. 13, nie druga zgoda).
-- CIALO-Z: 20261020162300
CREATE OR REPLACE FUNCTION public._newsletter_consent_default(p_lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_lang = 'en' THEN
    -- newsletter-consent-default:en
    'By signing up, you agree to receive the newsletter. How we process your data is described in our <a href="/en/polityka-prywatnosci">Privacy Policy</a>. You can withdraw your consent at any time (<a href="/en/komunikacja-i-marketing#rezygnacja">how to do it</a>).'
  ELSE
    -- newsletter-consent-default:pl
    'Zapisując się, wyrażasz zgodę na otrzymywanie newslettera. Zasady przetwarzania danych opisuje <a href="/polityka-prywatnosci">Polityka prywatności</a>. Zgodę możesz wycofać w każdej chwili (<a href="/komunikacja-i-marketing#rezygnacja">jak to zrobić</a>).'
  END
$$;

-- CIALO-Z: 20261020162300
CREATE OR REPLACE FUNCTION public._newsletter_consent_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  -- newsletter-consent-version
  SELECT 'newsletter-2026-10-23'::text
$$;

-- Treść OSOBNEGO pola zgody na pomiar (HTML jak w rejestrze zgód). Lustro TS
-- `measurementConsentHtml` - test parytetu czyta bloki niżej.
CREATE OR REPLACE FUNCTION public._email_measurement_consent_default(p_lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_lang = 'en' THEN
    -- email-measurement-consent-default:en
    'I agree to the measurement of opens and clicks in the emails I receive from you (a tracking image in the message and links carrying my identifier) to tailor the content and sending frequency and keep statistics. This consent is optional - I will receive the newsletter without it. Measurement starts only after I confirm this consent with the button on the page opened from a link in an email sent to my address. I can withdraw it at any time, without unsubscribing, using the “Don''t measure my opens and clicks” link at the bottom of every email (<a href="/en/komunikacja-i-marketing#pomiar">details</a>).'
  ELSE
    -- email-measurement-consent-default:pl
    'Zgadzam się na pomiar otwarć i kliknięć w wiadomościach e-mail, które od Was otrzymuję (niewidoczny obrazek w treści i linki z moim identyfikatorem), aby dopasować treść i częstotliwość wysyłki oraz prowadzić statystykę. Zgoda jest dobrowolna - newsletter otrzymam także bez niej. Pomiar zacznie działać dopiero, gdy potwierdzę tę zgodę przyciskiem na stronie, do której prowadzi link z wiadomości wysłanej na mój adres. Mogę ją wycofać w każdej chwili, bez rezygnacji z newslettera, linkiem „Nie mierz moich otwarć i kliknięć” w stopce każdej wiadomości (<a href="/komunikacja-i-marketing#pomiar">szczegóły</a>).'
  END
$$;

-- Wersja treści pola pomiaru (limit ładunku `version` = 32 znaki, CHECK
-- `newsletter_measurement_requests.consent_version`).
CREATE OR REPLACE FUNCTION public._email_measurement_consent_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  -- email-measurement-consent-version
  SELECT 'email-measurement-2026-10-23'::text
$$;

-- Kanały udzielenia („tak", `form_id`): przycisk na stronie double opt-in,
-- link z maila prośby po zapisie bez DOI, link z prośby z panelu.
CREATE OR REPLACE FUNCTION public._email_measurement_grant_channels()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY['measurement:doi', 'measurement:signup', 'measurement:reconfirm']::text[]
$$;

-- Kanały WŁASNEJ odmowy (wykluczają z próśb). Wypis (`measurement:unsubscribe`)
-- i retencja (`retention:*`) to nie decyzja o pomiarze - nie wykluczają.
CREATE OR REPLACE FUNCTION public._email_measurement_refusal_channels()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY['measurement:email_footer', 'measurement:preferences', 'measurement:account',
               'measurement:doi_declined']::text[]
$$;

-- Dawne zaufane pary (kanał, wersja) z okresu (a) - R1.9. Potwierdzenie
-- z linku prośby (`newsletter:measurement_reconfirm`) to osobny klik
-- właściciela skrzynki na stronie pomiaru: zachowuje moc, ale czytelnik
-- wymaga jeszcze POTWIERDZONEJ prośby tego subskrybenta w tej wersji. Wiersze
-- wyprowadzone w okresie (a) wyzwalaczem z treści formularza - NIE (tu ich
-- nie ma). Lista tylko maleje.
CREATE OR REPLACE FUNCTION public._email_measurement_legacy_grants()
RETURNS TABLE (form_id text, consent_version text)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  VALUES ('newsletter:measurement_reconfirm'::text, 'newsletter-2026-10-21'::text)
$$;

-- Ciało z 20261020162300; zmiana - rejestr wersji treści OSOBNEJ zgody na
-- pomiar (treść zgody na newsletter - także (a) - nigdy tu nie wraca).
-- CIALO-Z: 20261020162300
CREATE OR REPLACE FUNCTION public._consent_measurement_versions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY[public._email_measurement_consent_version()]::text[]
$$;

REVOKE ALL ON FUNCTION public._newsletter_consent_default(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._newsletter_consent_version() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._email_measurement_consent_default(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._email_measurement_consent_version() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._email_measurement_grant_channels() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._email_measurement_refusal_channels() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._email_measurement_legacy_grants() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._consent_measurement_versions() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_consent_default(text) IS
  'Zgoda i pomiar (I9d-Y2b): JEDNO źródło SQL domyślnej treści zgody na newsletter PL/EN, wersja newsletter-2026-10-23 - bez pomiaru i bez akceptacji polityki (pomiar ma osobne pole). Lustro TS z testem parytetu. Wewnętrzna.';
COMMENT ON FUNCTION public._email_measurement_consent_default(text) IS
  'Zgoda i pomiar (I9d-Y2b): treść OSOBNEGO pola zgody na pomiar otwarć i kliknięć PL/EN (HTML; inny język = PL). Zapisuje ją _email_measurement_grant, rozpoznaje _newsletter_measurement_declared_at. Lustro TS z testem parytetu. Wewnętrzna.';
COMMENT ON FUNCTION public._email_measurement_consent_version() IS
  'Zgoda i pomiar (I9d-Y2b): wersja treści pola pomiaru (email-measurement-2026-10-23). Wewnętrzna.';
COMMENT ON FUNCTION public._email_measurement_grant_channels() IS
  'Zgoda i pomiar (I9d-Y2b): kanały udzielenia zgody na pomiar (form_id): measurement:doi | measurement:signup | measurement:reconfirm. Wewnętrzna.';
COMMENT ON FUNCTION public._email_measurement_refusal_channels() IS
  'Zgoda i pomiar (I9d-Y2b): kanały WŁASNEJ odmowy pomiaru (wykluczają z próśb): email_footer, preferences, account, doi_declined. Wypis i retencja - nie. Wewnętrzna.';
COMMENT ON FUNCTION public._email_measurement_legacy_grants() IS
  'Zgoda i pomiar (I9d-Y2b, R1.9): dawne zaufane pary (form_id, wersja) z okresu (a) - potwierdzenie z linku prośby; czytelnik wymaga jeszcze potwierdzonej prośby subskrybenta w tej wersji. Wewnętrzna.';
COMMENT ON FUNCTION public._consent_measurement_versions() IS
  'Zgoda i pomiar (I9d-Y2b): wersje treści OSOBNEJ zgody na pomiar otwarć i kliknięć (od 20261023090000; wcześniej - wersje treści zgody na newsletter z pomiarem). Wewnętrzna.';

-- ----------------------------------------------------------------------------
-- B) Dane ustawień: dawne treści domyślne -> (b), pakiet z pola popupu.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020162300; zmiana - także kopie treści (a) i czyszczenie
-- wymaganego pola prywatności popupu z kopii treści zgody.
-- CIALO-Z: 20261020162300
CREATE OR REPLACE FUNCTION public._newsletter_consent_upgrade_defaults()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Domyślne sprzed Y2 (20260601054247, lustro `defaultNewsletterSettings`).
  c_old_pl constant text := 'Zapisując się akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Możesz wypisać się w każdej chwili.';
  c_old_en constant text := 'By signing up, you agree to our <a href="/privacy-policy">Privacy Policy</a>. You may unsubscribe at any time.';
  -- Treść pakietowa (a) newsletter-2026-10-21 (literały z 20261020162300).
  c_a_pl constant text := 'Zapisując się, wyrażasz zgodę na otrzymywanie newslettera i akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Wiadomości mogą zawierać elementy mierzące otwarcia i kliknięcia - dzięki nim dopasowujemy treść i częstotliwość wysyłki oraz prowadzimy statystykę. Pomiar możesz wyłączyć osobno, bez rezygnacji z newslettera, a zgodę wycofać w każdej chwili (<a href="/komunikacja-i-marketing#rezygnacja">jak to zrobić</a>).';
  c_a_en constant text := 'By signing up, you agree to receive the newsletter and accept our <a href="/en/polityka-prywatnosci">Privacy Policy</a>. Our emails may contain elements that measure opens and clicks - they help us tailor the content and sending frequency and keep statistics. You can switch off this measurement separately, without unsubscribing, and withdraw your consent at any time (<a href="/en/komunikacja-i-marketing#rezygnacja">how to do it</a>).';
  v_n integer;
  v_total integer := 0;
BEGIN
  UPDATE public.newsletter_settings ns SET policy_html_pl = public._newsletter_consent_default('pl')
   WHERE btrim(ns.policy_html_pl) IN (c_old_pl, c_a_pl);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;
  UPDATE public.newsletter_settings ns SET policy_html_en = public._newsletter_consent_default('en')
   WHERE btrim(ns.policy_html_en) IN (c_old_en, c_a_en);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;
  -- WYMAGANE pole „prywatność" popupu nie może nieść zgody na newsletter
  -- (pakiet): kopia dowolnej domyślnej treści zgody -> NULL (popup pokaże
  -- akceptację polityki prywatności z TS). Własny tekst admina zostaje.
  UPDATE public.newsletter_settings ns SET popup_privacy_html_pl = NULL
   WHERE btrim(ns.popup_privacy_html_pl) IN (c_old_pl, c_old_en, c_a_pl, c_a_en,
         public._newsletter_consent_default('pl'), public._newsletter_consent_default('en'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;
  UPDATE public.newsletter_settings ns SET popup_privacy_html_en = NULL
   WHERE btrim(ns.popup_privacy_html_en) IN (c_old_pl, c_old_en, c_a_pl, c_a_en,
         public._newsletter_consent_default('pl'), public._newsletter_consent_default('en'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_consent_upgrade_defaults() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_consent_upgrade_defaults() IS
  'Zgoda i pomiar (I9d-Y2b): policy_html_* równe dawnej treści domyślnej (sprzed Y2 albo pakietowej (a)) -> treść (b); popup_privacy_html_* równe dowolnej domyślnej treści zgody -> NULL. Tekst admina, NULL i pusty bez zmian. Zwraca liczbę zmienionych pól; powtórka = 0. Wewnętrzna.';

-- DEFAULT kolumn = bieżąca treść domyślna (literał), potem aktualizacja.
SET lock_timeout = '5s';
DO $$
BEGIN
  EXECUTE format('ALTER TABLE public.newsletter_settings ALTER COLUMN policy_html_pl SET DEFAULT %L',
                 public._newsletter_consent_default('pl'));
  EXECUTE format('ALTER TABLE public.newsletter_settings ALTER COLUMN policy_html_en SET DEFAULT %L',
                 public._newsletter_consent_default('en'));
END $$;
SELECT public._newsletter_consent_upgrade_defaults();

-- ----------------------------------------------------------------------------
-- C) Koniec pakietowania (wariant (a) wygaszony).
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_crm_consent_log_measurement ON public.crm_consent_log;
DROP FUNCTION IF EXISTS public.tg_crm_consent_log_measurement();
DROP FUNCTION IF EXISTS public._consent_covers_measurement(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.admin_newsletter_consent_measurement_mark(text, boolean);
DROP FUNCTION IF EXISTS public.admin_newsletter_consent_measurement_get();
REVOKE INSERT, UPDATE, DELETE ON public.newsletter_consent_measurement_marks FROM service_role;

COMMENT ON TABLE public.newsletter_consent_measurement_marks IS
  'Zgoda i pomiar (I9d-Y2, WYGASZONA 2026-10-23 - wariant b): archiwum oznaczeń „mój tekst obejmuje pomiar" z okresu (a); bez pisarzy i czytelników. Tylko odczyt (dowód; także audit_log).';

-- ----------------------------------------------------------------------------
-- D) Strażnik rejestru i JEDYNY pisarz „tak" pomiaru.
-- ----------------------------------------------------------------------------
-- INSERT: „tak" `email_measurement` tylko z flagą transakcji, którą ustawia
-- wyłącznie `_email_measurement_grant` (PostgREST nie ustawia zmiennych
-- `nes.*`); nieufne „tak" i deklaracja nie powstają (RETURN NULL - zapis
-- formularza nie pada). „Nie" przechodzi. UPDATE: wpis pomiaru niezmienny
-- poza adresem i opisem (pseudonimizacja) - 42501.
CREATE OR REPLACE FUNCTION public.tg_crm_consent_log_measurement_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.consent_key IS DISTINCT FROM OLD.consent_key OR NEW.given IS DISTINCT FROM OLD.given
       OR NEW.form_id IS DISTINCT FROM OLD.form_id OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
       OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'email_measurement_log_immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.consent_key = 'email_measurement'
     AND (NOT NEW.given OR COALESCE(current_setting('nes.email_measurement_grant', true), '') = 'on') THEN
    RETURN NEW;
  END IF;
  -- Bez adresu w logu: deklaracja, nieufne „tak" albo inna pisownia klucza.
  RAISE WARNING 'email_measurement_log_rejected';
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_crm_consent_log_measurement_guard() FROM PUBLIC, anon, authenticated, service_role;

SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_crm_consent_log_measurement_guard ON public.crm_consent_log;
CREATE TRIGGER trg_crm_consent_log_measurement_guard
  BEFORE INSERT ON public.crm_consent_log
  FOR EACH ROW
  WHEN (lower(btrim(NEW.consent_key)) IN ('email_measurement', 'email_measurement_declared'))
  EXECUTE FUNCTION public.tg_crm_consent_log_measurement_guard();
DROP TRIGGER IF EXISTS trg_crm_consent_log_measurement_lock ON public.crm_consent_log;
CREATE TRIGGER trg_crm_consent_log_measurement_lock
  BEFORE UPDATE ON public.crm_consent_log
  FOR EACH ROW
  WHEN (lower(btrim(OLD.consent_key)) IN ('email_measurement', 'email_measurement_declared')
        OR lower(btrim(NEW.consent_key)) IN ('email_measurement', 'email_measurement_declared'))
  EXECUTE FUNCTION public.tg_crm_consent_log_measurement_guard();

COMMENT ON FUNCTION public.tg_crm_consent_log_measurement_guard() IS
  'Zgoda i pomiar (I9d-Y2b): strażnik rejestru zgód - INSERT „tak" email_measurement tylko z flagą _email_measurement_grant, deklaracja email_measurement_declared i inna pisownia klucza odrzucone (RETURN NULL + WARNING bez adresu), „nie" przechodzi; UPDATE wpisu pomiaru zmieniający klucz, decyzję, kanał, wersję, źródło, najemcę albo chwilę - 42501 (adres i opis - przechodzą). Wyzwalacz.';

-- Jedyny pisarz „tak": subskrybent aktywny, kanał z listy, treść i wersja
-- pomiaru w języku subskrybenta. Blokady: wiersz subskrybenta, potem
-- doradcza adresu (jak wycofanie). Wynik: granted | already | inactive | gone.
CREATE OR REPLACE FUNCTION public._email_measurement_grant(
  p_subscriber uuid, p_channel text, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s public.newsletter_subscribers%ROWTYPE;
  v_form text := 'measurement:' || COALESCE(btrim(p_channel), '');
  v_lang text;
  v_n integer;
BEGIN
  IF NOT (v_form = ANY (public._email_measurement_grant_channels())) THEN
    RAISE EXCEPTION 'channel_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_s FROM public.newsletter_subscribers s WHERE s.id = p_subscriber FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'gone';
  END IF;
  IF v_s.status NOT IN ('subscribed', 'confirmed') THEN
    RETURN 'inactive';
  END IF;
  v_lang := CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('email_measurement:' || v_s.tenant_id::text || ':' || lower(v_s.email), 0));
  IF public._email_measurement_consent(v_s.tenant_id, v_s.email) THEN
    RETURN 'already';
  END IF;
  PERFORM set_config('nes.email_measurement_grant', 'on', true);
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, ip, user_agent, lang, created_at)
  VALUES (v_s.tenant_id, v_s.email, 'newsletter', v_s.id, v_form, 'email_measurement', 'email_measurement',
          public._email_measurement_consent_default(v_lang), public._email_measurement_consent_version(), true,
          left(NULLIF(btrim(p_ip), ''), 64), left(NULLIF(btrim(p_user_agent), ''), 512), v_lang, clock_timestamp());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- Flaga przeżyłaby wyjście z funkcji (zmienna spoza klauzuli SET) - gasimy.
  PERFORM set_config('nes.email_measurement_grant', '', true);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'grant_not_recorded' USING ERRCODE = 'P0001';
  END IF;
  RETURN 'granted';
END;
$$;

REVOKE ALL ON FUNCTION public._email_measurement_grant(uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._email_measurement_grant(uuid, text, text, text) IS
  'Zgoda i pomiar (I9d-Y2b): JEDYNY pisarz „tak" email_measurement - subskrybent subscribed/confirmed (FOR UPDATE, potem blokada doradcza adresu), kanał doi|signup|reconfirm (inny - 22023), treść i wersja pola pomiaru w języku subskrybenta, source_id = subskrybent, created_at = clock_timestamp(). Wynik: granted | already | inactive | gone. Wewnętrzna.';

-- ----------------------------------------------------------------------------
-- E) Czytelnik zgody na pomiar.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020162300; zmiana - D2: zgoda istnieje tylko u subskrybenta
-- `subscribed`/`confirmed` z wpisem „tak" związanym z TYM wierszem,
-- z zaufanego kanału i w wersji treści pomiaru (albo dawna zaufana para
-- z potwierdzoną prośbą); `pending`, kontakt CRM bez subskrypcji, wiersze
-- z okresu (a) wyprowadzone z treści formularza - brak pomiaru. Czytelnicy
-- (`email_measurement_status`/`_state`, render i zapis zdarzeń ścieżek
-- i kampanii, liczba mierzonych) przejmują regułę bez redefinicji.
-- CIALO-Z: 20261020162300
CREATE OR REPLACE FUNCTION public._email_measurement_consent(p_tenant uuid, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH n AS (
    SELECT max(l.created_at) FILTER (WHERE l.consent_key = 'email_measurement' AND NOT l.given) AS withdrawn,
           max(l.created_at) FILTER (WHERE l.consent_key IN ('newsletter', 'marketing') AND NOT l.given) AS opted_out
      FROM public.crm_consent_log l
     WHERE l.tenant_id = p_tenant AND lower(l.email) = lower(btrim(p_email))
  )
  SELECT EXISTS (
    SELECT 1
      FROM public.newsletter_subscribers s
      CROSS JOIN n
      CROSS JOIN LATERAL (
        SELECT max(g.created_at) AS granted
          FROM public.crm_consent_log g
         WHERE g.source_type = 'newsletter' AND g.source_id = s.id
           AND g.tenant_id = p_tenant AND lower(g.email) = lower(s.email)
           AND g.consent_key = 'email_measurement' AND g.given
           AND ((g.form_id = ANY (public._email_measurement_grant_channels())
                 AND g.consent_version = ANY (public._consent_measurement_versions()))
                OR (EXISTS (SELECT 1 FROM public._email_measurement_legacy_grants() lg
                             WHERE lg.form_id = g.form_id AND lg.consent_version = g.consent_version)
                    AND EXISTS (SELECT 1 FROM public.newsletter_measurement_requests q
                                 WHERE q.subscriber_id = s.id AND q.consent_version = g.consent_version
                                   AND q.confirmed_at IS NOT NULL)))
      ) x
     WHERE s.tenant_id = p_tenant AND lower(s.email) = lower(btrim(p_email))
       AND s.status IN ('subscribed', 'confirmed')
       AND x.granted IS NOT NULL
       AND x.granted > COALESCE(n.withdrawn, '-infinity'::timestamptz)
       AND x.granted > COALESCE(n.opted_out, '-infinity'::timestamptz)
       AND x.granted > COALESCE(s.unsubscribed_at, '-infinity'::timestamptz))
$$;

REVOKE ALL ON FUNCTION public._email_measurement_consent(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._email_measurement_consent(uuid, text) IS
  'Zgoda i pomiar (I9d-Y2b): czy adres ma zgodę na pomiar - subskrybent subscribed/confirmed z wpisem email_measurement „tak" związanym z tym wierszem (source_id), z kanału udzielenia i w wersji treści pomiaru (albo dawna zaufana para z potwierdzoną prośbą), później niż każde „nie" pomiaru, wycofanie newsletter/marketing i unsubscribed_at (remis = brak). Bez przełącznika najemcy. Wewnętrzna.';

-- ----------------------------------------------------------------------------
-- F) Pisarz zgód z formularzy i rezerwa `newsletter_to_lead`.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020162300; zmiana - pozycje pomiaru (`email_measurement`,
-- deklaracja `email_measurement_declared`) nie trafiają do rejestru: zgodę
-- zapisuje wyłącznie `_email_measurement_grant`, deklaracja czeka
-- w `consents`. Wynik = liczba zapisanych wpisów.
-- CIALO-Z: 20261020162300
CREATE OR REPLACE FUNCTION public._newsletter_log_consents(
  p_tenant uuid, p_email text, p_subscriber uuid, p_form_id text, p_form_name text, p_lang text,
  p_ip text, p_user_agent text, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_text text;
  v_key text;
  v_n integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN 0;
  END IF;
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_items) AS e LOOP
    CONTINUE WHEN jsonb_typeof(v_item) <> 'object';
    v_key := NULLIF(btrim(v_item ->> 'key'), '');
    v_text := NULLIF(btrim(v_item ->> 'text'), '');
    CONTINUE WHEN v_key IS NULL OR v_text IS NULL;
    -- I9d-Y2b: deklaracja pola pomiaru czeka w `consents`; zgodę zapisuje
    -- wyłącznie _email_measurement_grant.
    CONTINUE WHEN lower(v_key) IN ('email_measurement', 'email_measurement_declared');
    INSERT INTO public.crm_consent_log (
      tenant_id, email, source_type, source_id, form_id, form_name,
      consent_key, consent_text, consent_version, given, ip, user_agent, lang
    ) VALUES (
      p_tenant, p_email, 'newsletter'::public.crm_source_type, p_subscriber, p_form_id, p_form_name,
      v_key, v_item ->> 'text',
      COALESCE(NULLIF(btrim(v_item ->> 'version'), ''), public._consent_text_version(v_item ->> 'text')),
      CASE WHEN jsonb_typeof(v_item -> 'given') = 'boolean' THEN (v_item ->> 'given')::boolean ELSE true END,
      p_ip, p_user_agent, COALESCE(NULLIF(v_item ->> 'lang', ''), p_lang)
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_log_consents(uuid, text, uuid, text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_log_consents(uuid, text, uuid, text, text, text, text, text, jsonb) IS
  'Zgoda i pomiar (I9d-Y2b): pozycje consents subskrybenta -> rejestr zgód z wersją (z ładunku albo skrót treści); pomija pozycje bez klucza/treści oraz klucze pomiaru (email_measurement, email_measurement_declared). Zwraca liczbę wpisów. Wewnętrzna.';

-- Ciało z 20261020162300; zmiana (R1.11) - zastępczy wpis `newsletter` tylko
-- przy PUSTYM `consents`: sama deklaracja pola pomiaru (pominięta przez
-- pisarza) nie może wyprodukować zgody na newsletter.
-- CIALO-Z: 20261020162300
CREATE OR REPLACE FUNCTION public.newsletter_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  c_fallback constant text := 'Zapisuję się do newslettera i akceptuję otrzymywanie wiadomości marketingowych.';
  v_ua   text;
  v_ip   text;
  v_n    integer;
BEGIN
  PERFORM public.crm_upsert_lead(
    NEW.tenant_id, NEW.email, NEW.first_name, NEW.last_name,
    NULL, NULL, true, (NEW.status = 'subscribed')
  );
  UPDATE public.crm_leads
     SET newsletter_status = NEW.status
   WHERE tenant_id = NEW.tenant_id AND email_norm = lower(NEW.email);

  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'confirmed') THEN
    v_ua := NEW.user_agent;
    v_ip := CASE WHEN NEW.ip IS NULL THEN NULL ELSE host(NEW.ip) END;

    v_n := public._newsletter_log_consents(NEW.tenant_id, NEW.email, NEW.id, NEW.source_form_id, NEW.source_form_name,
                                           NEW.language, v_ip, v_ua, NEW.consents);
    IF v_n = 0 AND (jsonb_typeof(NEW.consents) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.consents) = 0) THEN
      INSERT INTO public.crm_consent_log (
        tenant_id, email, source_type, source_id, form_id, form_name,
        consent_key, consent_text, consent_version, given, ip, user_agent, lang
      ) VALUES (
        NEW.tenant_id, NEW.email, 'newsletter'::public.crm_source_type, NEW.id,
        NEW.source_form_id, NEW.source_form_name,
        'newsletter', c_fallback, public._consent_text_version(c_fallback),
        true, v_ip, v_ua, NEW.language
      );
    END IF;
  END IF;

  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.newsletter_to_lead() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.newsletter_to_lead() IS
  'Newsletter -> CRM (I9d-Y2b): lead i status newslettera; przy INSERT i przejściu na confirmed - wpisy rejestru zgód z consents (bez kluczy pomiaru), zastępczy wpis newsletter tylko przy PUSTYM consents. Wyzwalacz.';

-- ----------------------------------------------------------------------------
-- G) Wycofanie samego pomiaru i wypis.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020162300; zmiana - wersja wpisu = wersja treści pomiaru,
-- chwila zapisu `clock_timestamp()`. Biała lista kanałów BEZ zmian (R1.4):
-- neutralny `unsubscribe` ustawia tylko wewnętrzny pisarz wypisu.
-- CIALO-Z: 20261020162300
-- rpc-shape: email_measurement_withdraw (result, tenant_id, lang)
CREATE OR REPLACE FUNCTION public.email_measurement_withdraw(
  p_subscriber uuid DEFAULT NULL,
  p_lead uuid DEFAULT NULL,
  p_channel text DEFAULT 'email_footer',
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s record;
  v_last boolean;
  v_channel text := CASE WHEN p_channel IN ('email_footer', 'preferences', 'account') THEN p_channel
                         ELSE 'email_footer' END;
BEGIN
  IF (p_subscriber IS NULL) = (p_lead IS NULL) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT * INTO v_s FROM public._email_measurement_subject(p_subscriber, p_lead);
  IF v_s.tenant_id IS NULL THEN
    RETURN jsonb_build_object('result', 'gone');
  END IF;
  -- Dwa kliknięcia naraz (podgląd linku przez klienta poczty + człowiek):
  -- jeden wpis „nie", drugi widzi `already`.
  PERFORM pg_advisory_xact_lock(hashtextextended('email_measurement:' || v_s.tenant_id::text || ':' || lower(v_s.email), 0));
  SELECT c.given INTO v_last FROM public.crm_consent_log c
   WHERE c.tenant_id = v_s.tenant_id AND lower(c.email) = lower(v_s.email) AND c.consent_key = 'email_measurement'
   ORDER BY c.created_at DESC, c.given, c.id DESC
   LIMIT 1;
  IF v_last IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('result', 'already', 'tenant_id', v_s.tenant_id, 'lang', v_s.lang);
  END IF;
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, ip, user_agent, lang, created_at)
  VALUES (v_s.tenant_id, v_s.email, v_s.source_type, v_s.source_id, 'measurement:' || v_channel,
          'email_measurement_withdraw', 'email_measurement',
          CASE WHEN v_s.lang = 'en'
            THEN 'Withdrawal of consent to measuring email opens and clicks (newsletter and marketing consent unchanged).'
            ELSE 'Wycofanie zgody na pomiar otwarć i kliknięć w wiadomościach e-mail (zgoda na newsletter i komunikację bez zmian).'
          END,
          public._email_measurement_consent_version(), false, left(NULLIF(btrim(p_ip), ''), 64),
          left(NULLIF(btrim(p_user_agent), ''), 512), v_s.lang, clock_timestamp());
  RETURN jsonb_build_object('result', 'withdrawn', 'tenant_id', v_s.tenant_id, 'lang', v_s.lang);
END;
$$;

REVOKE ALL ON FUNCTION public.email_measurement_withdraw(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_measurement_withdraw(uuid, uuid, text, text, text) TO service_role;

COMMENT ON FUNCTION public.email_measurement_withdraw(uuid, uuid, text, text, text) IS
  'Zgoda i pomiar (I9d-Y2b): wycofanie SAMEGO pomiaru otwarć i kliknięć (subskrybent ALBO kontakt CRM z podpisanego tokenu; kanał email_footer|preferences|account, inny = email_footer) - wpis email_measurement „nie" z wersją treści pomiaru i chwilą zapisu, zgoda na newsletter bez zmian. Wynik: {result: withdrawn|already|gone|invalid, tenant_id, lang}. Tylko service_role (podpis HMAC sprawdza serwer).';

-- Pisarz „nie" przy wypisie: prosty, sam niczego nie rzuca (R1.3 - droga
-- przez wyzwalacz listy wyłączeń połyka błędy). Wpis tylko, gdy ostatnie
-- słowo łańcucha pomiaru brzmi „tak"; kanał neutralny (nie wyklucza z próśb).
CREATE OR REPLACE FUNCTION public._email_measurement_close_on_unsubscribe(p_subscriber uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s public.newsletter_subscribers%ROWTYPE;
  v_lang text;
  v_last boolean;
BEGIN
  SELECT * INTO v_s FROM public.newsletter_subscribers s WHERE s.id = p_subscriber;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_lang := CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('email_measurement:' || v_s.tenant_id::text || ':' || lower(v_s.email), 0));
  SELECT c.given INTO v_last FROM public.crm_consent_log c
   WHERE c.tenant_id = v_s.tenant_id AND lower(c.email) = lower(v_s.email) AND c.consent_key = 'email_measurement'
   ORDER BY c.created_at DESC, c.given, c.id DESC
   LIMIT 1;
  IF v_last IS DISTINCT FROM true THEN
    RETURN false;
  END IF;
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, lang, created_at)
  VALUES (v_s.tenant_id, v_s.email, 'newsletter', v_s.id, 'measurement:unsubscribe', 'email_measurement_unsubscribe',
          'email_measurement',
          CASE WHEN v_lang = 'en'
            THEN 'Consent to measuring opens and clicks expired - the newsletter subscription ended (unsubscribe, bounce, complaint or staff decision).'
            ELSE 'Wygaśnięcie zgody na pomiar otwarć i kliknięć - koniec subskrypcji newslettera (wypis, odbicie, skarga albo decyzja personelu).'
          END,
          public._email_measurement_consent_version(), false, v_lang, clock_timestamp());
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._email_measurement_close_on_unsubscribe(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._email_measurement_close_on_unsubscribe(uuid) IS
  'Zgoda i pomiar (I9d-Y2b, R1.4): wpis email_measurement „nie" z kanałem neutralnym measurement:unsubscribe (wersja pomiaru, chwila zapisu, treść neutralna PL/EN), gdy ostatnie słowo łańcucha pomiaru brzmi „tak". Woła go WYŁĄCZNIE wyzwalacz wypisu. Zwraca, czy zapisał. Wewnętrzna.';

-- Każdy kanał wypisu (link, personel, ścieżka, import, odbicie, skarga,
-- token globalny) zamyka łańcuch pomiaru.
CREATE OR REPLACE FUNCTION public.tg_newsletter_unsubscribed_measurement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._email_measurement_close_on_unsubscribe(NEW.id);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_newsletter_unsubscribed_measurement() FROM PUBLIC, anon, authenticated, service_role;

SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_newsletter_unsubscribed_measurement ON public.newsletter_subscribers;
CREATE TRIGGER trg_newsletter_unsubscribed_measurement
  AFTER UPDATE OF status ON public.newsletter_subscribers
  FOR EACH ROW
  WHEN (NEW.status = 'unsubscribed' AND OLD.status IS DISTINCT FROM 'unsubscribed')
  EXECUTE FUNCTION public.tg_newsletter_unsubscribed_measurement();
RESET lock_timeout;

COMMENT ON FUNCTION public.tg_newsletter_unsubscribed_measurement() IS
  'Zgoda i pomiar (I9d-Y2b): przejście subskrybenta na unsubscribed (każdy kanał) -> _email_measurement_close_on_unsubscribe. „Przywróć" w panelu nie wskrzesza zgody. Wyzwalacz.';

-- ----------------------------------------------------------------------------
-- H) Deklaracja z formularza i stan oferty (wewnętrzne).
-- ----------------------------------------------------------------------------
-- Najpóźniejsza chwila odbioru (`received_at`, ISO z serwera) poprawnej
-- deklaracji: klucz `email_measurement_declared`, `given: true`, wersja
-- z rejestru pomiaru, treść pola (HTML albo bez znaczników, PL albo EN).
-- Deklaracja bez poprawnej chwili = '-infinity' (oferta od razu wygasła).
CREATE OR REPLACE FUNCTION public._newsletter_measurement_declared_at(p_consents jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_at timestamptz;
  v_max timestamptz;
BEGIN
  IF p_consents IS NULL OR jsonb_typeof(p_consents) <> 'array' THEN
    RETURN NULL;
  END IF;
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_consents) AS e LOOP
    CONTINUE WHEN jsonb_typeof(v_item) <> 'object'
              OR lower(btrim(COALESCE(v_item ->> 'key', ''))) <> 'email_measurement_declared'
              OR (v_item -> 'given') IS DISTINCT FROM 'true'::jsonb
              OR NOT COALESCE(btrim(v_item ->> 'version') = ANY (public._consent_measurement_versions()), false)
              OR NOT COALESCE(btrim(v_item ->> 'text') IN (
                   public._email_measurement_consent_default('pl'), public._email_measurement_consent_default('en'),
                   regexp_replace(public._email_measurement_consent_default('pl'), '<[^>]*>', '', 'g'),
                   regexp_replace(public._email_measurement_consent_default('en'), '<[^>]*>', '', 'g')), false);
    v_at := '-infinity';
    IF COALESCE(v_item ->> 'received_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' THEN
      BEGIN
        v_at := (v_item ->> 'received_at')::timestamptz;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
        v_at := '-infinity';
      END;
    END IF;
    v_max := GREATEST(v_max, v_at);
  END LOOP;
  RETURN v_max;
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_measurement_declared_at(jsonb) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_measurement_declared_at(jsonb) IS
  'Zgoda i pomiar (I9d-Y2b): chwila najpóźniejszej poprawnej deklaracji pola pomiaru w consents (klucz email_measurement_declared, given true, wersja i treść pola pomiaru); brak = NULL, bez poprawnej received_at = -infinity. Deklaracja to NIE zgoda. Wewnętrzna.';

-- Stan oferty decyzji o pomiarze dla subskrybenta: gone | inactive | granted |
-- none (brak deklaracji albo wygasła) | declined („nie" pomiaru po
-- deklaracji) | offer.
CREATE OR REPLACE FUNCTION public._newsletter_measurement_offer_state(p_subscriber uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro MEASUREMENT_CONFIRM_LINK_DAYS (src/lib/privacy/measurement.ts):
  -- deklaracja sprzed miesięcy nie otwiera decyzji bez końca.
  c_offer_days constant integer := 60;
  v_s public.newsletter_subscribers%ROWTYPE;
  v_declared timestamptz;
BEGIN
  SELECT * INTO v_s FROM public.newsletter_subscribers s WHERE s.id = p_subscriber;
  IF NOT FOUND THEN
    RETURN 'gone';
  END IF;
  IF v_s.status NOT IN ('subscribed', 'confirmed') THEN
    RETURN 'inactive';
  END IF;
  IF public._email_measurement_consent(v_s.tenant_id, v_s.email) THEN
    RETURN 'granted';
  END IF;
  v_declared := public._newsletter_measurement_declared_at(v_s.consents);
  IF v_declared IS NULL OR v_declared < now() - make_interval(days => c_offer_days) THEN
    RETURN 'none';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_consent_log c
              WHERE c.tenant_id = v_s.tenant_id AND lower(c.email) = lower(v_s.email)
                AND c.consent_key = 'email_measurement' AND NOT c.given AND c.created_at >= v_declared) THEN
    RETURN 'declined';
  END IF;
  RETURN 'offer';
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_measurement_offer_state(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_measurement_offer_state(uuid) IS
  'Zgoda i pomiar (I9d-Y2b): stan decyzji o pomiarze subskrybenta - gone | inactive (nie subscribed/confirmed) | granted | none (brak deklaracji albo starsza niż 60 dni) | declined („nie" pomiaru po deklaracji) | offer. Wewnętrzna.';
