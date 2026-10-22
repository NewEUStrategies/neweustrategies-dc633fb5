-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y2, 1/3): TREŚĆ ZGODY NA NEWSLETTER Z POMIAREM
-- OTWARĆ I KLIKNIĘĆ, WERSJA TREŚCI PRZY KAŻDEJ ZGODZIE, KLUCZ ZGODY
-- `email_measurement`. Decyzje właściciela 2026-10-20 („tak, uzupełnij")
-- i 2026-10-21 (wariant (a): pomiar opisany w treści zgody na newsletter,
-- ale wyłączalny OSOBNO, bez rezygnacji z newslettera - art. 7 ust. 3-4 RODO,
-- wytyczne EDPB 2/2023 do art. 5 ust. 3 dyrektywy 2002/58/WE).
--
-- DEFEKT
--   1. Domyślna treść zgody (`newsletter_settings.policy_html_*`) nie wspomina
--      pomiaru otwarć i kliknięć, choć piksel i linki z identyfikatorem
--      odbiorcy to dostęp do informacji w urządzeniu odbiorcy - wymaga zgody.
--      Domyślny tekst EN wskazuje `/privacy-policy`, której trasa nie istnieje
--      (polityka EN = `/en/polityka-prywatnosci`).
--   2. Wpisy rejestru zgód z formularzy newslettera nie mają wersji treści
--      (`consent_version` NULL) - nie da się wykazać, KTÓRĄ treść widziała
--      osoba (art. 7 ust. 1 RODO), ani odróżnić zgody obejmującej pomiar.
--   3. Wyzwalacz `newsletter_to_lead` loguje zgody tylko przy INSERT i przy
--      przejściu na `confirmed`: ponowny zapis po wypisie (upsert
--      `unsubscribed -> subscribed` z NOWYMI `consents`) nie zostawiał
--      w rejestrze żadnego wpisu.
--   4. Brak klucza zgody na pomiar i sposobu wycofania SAMEGO pomiaru.
--
-- ZMIANA (DECYZJE WYKONAWCZE I9d-Y2, dziennik §21.23)
--   A. Jedno źródło SQL treści domyślnej PL/EN i jej wersji
--      (`_newsletter_consent_default`, `_newsletter_consent_version`; lustro
--      TS z testem parytetu - Y2-B czyta bloki `newsletter-consent-default:*`
--      niżej). DEFAULT kolumn `policy_html_*` = ta treść jako LITERAŁ wyliczony
--      z funkcji (wywołanie w DEFAULT wymagałoby EXECUTE od roli zapisującej
--      wiersz). Zapisany tekst zmieniany WYŁĄCZNIE tam, gdzie równy staremu
--      domyślnemu (po obcięciu spacji; `_newsletter_consent_upgrade_defaults`);
--      tekst admina zostaje, NULL i pusty też (formularz renderuje wtedy
--      domyślny tekst z TS).
--   B. `newsletter_consent_measurement_marks` - jawne oznaczenie admina „mój
--      tekst obejmuje pomiar" (skrót SHA-256 ZAPISANEGO tekstu pola, autor,
--      chwila) zamiast heurystyki słów. Zmiana tekstu = inny skrót, więc
--      oznaczenie przestaje działać samo. Zapis - RPC panelu (20261020162500).
--   C. Zgoda z pomiarem = wpis „tak" klucza `newsletter*`/`marketing*`
--      z wersją z rejestru wersji z pomiarem (`_consent_measurement_versions`)
--      albo z treścią, której skrót admin oznaczył. Wyzwalacz na
--      `crm_consent_log` dopisuje wtedy wpis `email_measurement` „tak" (ta
--      sama treść, wersja, źródło i chwila) - dla KAŻDEGO pisarza rejestru
--      (formularze, wydarzenia, zakup), bez redefinicji każdego z nich.
--   D. `newsletter_to_lead` (CIALO-Z niżej): wersja przy każdym wpisie
--      (z ładunku; brak = `txt-sha256:` skrótu treści). Nowy wyzwalacz
--      `AFTER UPDATE OF consents` loguje NOWE pozycje `consents` (ponowny
--      zapis); aktywność CRM (`crm_upsert_lead`) bez zmian. Link „Chcę
--      dalej otrzymywać" (`newsletter_sunset_keep`, Y1) - też z wersją.
--   E. Czytelnik `_email_measurement_consent(najemca, adres)`: ostatnie
--      udzielenie `email_measurement` PÓŹNIEJSZE niż ostatnie wycofanie
--      pomiaru, wycofanie zgody `newsletter`/`marketing` i wypis subskrybenta.
--      Porcja dla kampanii i ścieżek `email_measurement_status` (service_role)
--      łączy zgodę ze WSPÓLNYM przełącznikiem najemcy (Z-I9c-09:
--      `journey_settings.open_tracking_enabled` przez `_newsletter_track_opens`
--      - od tej migracji obejmuje ścieżki I kampanie, otwarcia I kliknięcia).
--   F. Wycofanie SAMEGO pomiaru `email_measurement_withdraw` (link w stopce
--      i w preferencjach; podpis HMAC sprawdza serwer TS) oraz stan
--      `email_measurement_state` - zgoda na newsletter bez zmian.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020162200 (blok I9d-Y1). Render i zapis
-- zdarzeń (20261020162400) czytają funkcje E; panel i ponowne potwierdzenie
-- - 20261020162500. Front bez Y2-B wysyła wpisy bez wersji - dostają skrót.
-- IDEMPOTENTNA: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER, UPDATE tylko wierszy równych
-- staremu domyślnemu (powtórka = 0 wierszy), bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_i9d_y2_consent_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Treść domyślna, wersja, rejestr wersji z pomiarem, skrót treści.
-- ----------------------------------------------------------------------------
-- Treść = to, co formularz pokazuje, gdy admin nie wpisał własnej (HTML jak
-- `policy_html_*`; adaptery formatów w TS). Wersji wydanej NIE zmienia się:
-- nowa treść = nowa wersja (nowy literał niżej + wpis w rejestrze).
CREATE OR REPLACE FUNCTION public._newsletter_consent_default(p_lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_lang = 'en' THEN
    -- newsletter-consent-default:en
    'By signing up, you agree to receive the newsletter and accept our <a href="/en/polityka-prywatnosci">Privacy Policy</a>. Our emails may contain elements that measure opens and clicks - they help us tailor the content and sending frequency and keep statistics. You can switch off this measurement separately, without unsubscribing, and withdraw your consent at any time (<a href="/en/komunikacja-i-marketing#rezygnacja">how to do it</a>).'
  ELSE
    -- newsletter-consent-default:pl
    'Zapisując się, wyrażasz zgodę na otrzymywanie newslettera i akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Wiadomości mogą zawierać elementy mierzące otwarcia i kliknięcia - dzięki nim dopasowujemy treść i częstotliwość wysyłki oraz prowadzimy statystykę. Pomiar możesz wyłączyć osobno, bez rezygnacji z newslettera, a zgodę wycofać w każdej chwili (<a href="/komunikacja-i-marketing#rezygnacja">jak to zrobić</a>).'
  END
$$;

-- Wersja treści domyślnej (z pomiarem). Lustro TS: stała wersji w module
-- jednego źródła (Y2-B); limit ładunku `ConsentEntry.version` = 32 znaki.
CREATE OR REPLACE FUNCTION public._newsletter_consent_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  -- newsletter-consent-version
  SELECT 'newsletter-2026-10-21'::text
$$;

-- Rejestr wersji treści, które OBEJMUJĄ pomiar otwarć i kliknięć. Wersje
-- sprzed Y2 (NULL, skróty, `event-marketing-v1-*`, premium `2026-10-12`) -
-- nie. Nowa wersja z pomiarem (np. tekst zgód wydarzeń v2) = dopisek tutaj.
CREATE OR REPLACE FUNCTION public._consent_measurement_versions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY[public._newsletter_consent_version()]::text[]
$$;

-- Skrót treści: obcięte białe znaki (jak `.trim()` ładunku w TS), UTF-8.
CREATE OR REPLACE FUNCTION public._consent_text_sha256(p_text text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_text IS NULL THEN NULL ELSE
    encode(sha256(convert_to(
      regexp_replace(p_text, '^[[:space:] ﻿]+|[[:space:] ﻿]+$', '', 'g'), 'UTF8')), 'hex')
  END
$$;

-- Wersja zastępcza wpisu bez wersji w ładunku: skrót treści (31 znaków -
-- mieści się w limicie wersji ładunku). Odtwarzalna z samego wpisu.
CREATE OR REPLACE FUNCTION public._consent_text_version(p_text text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT 'txt-sha256:' || left(public._consent_text_sha256(p_text), 20)
$$;

REVOKE ALL ON FUNCTION public._newsletter_consent_default(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._newsletter_consent_version() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._consent_measurement_versions() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._consent_text_sha256(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._consent_text_version(text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_consent_default(text) IS
  'Zgoda i pomiar (I9d-Y2): JEDNO źródło SQL domyślnej treści zgody na newsletter PL/EN (pomiar otwarć i kliknięć, cel, osobne wyłączenie pomiaru, wycofanie zgody z linkiem). Lustro TS z testem parytetu. Wewnętrzna.';
COMMENT ON FUNCTION public._consent_measurement_versions() IS
  'Zgoda i pomiar (I9d-Y2): wersje treści zgody OBEJMUJĄCE pomiar otwarć i kliknięć (wpis „tak" z taką wersją daje email_measurement). Wewnętrzna.';

-- Aktualizacja WYŁĄCZNIE tekstu równego staremu domyślnemu (tekst admina,
-- NULL i pusty - bez zmian). Funkcja, nie anonimowy blok: pgTAP dowodzi
-- reguły na fiksturze, a powtórka migracji to 0 wierszy.
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
  v_pl integer;
  v_en integer;
BEGIN
  UPDATE public.newsletter_settings ns SET policy_html_pl = public._newsletter_consent_default('pl')
   WHERE btrim(ns.policy_html_pl) = c_old_pl;
  GET DIAGNOSTICS v_pl = ROW_COUNT;
  UPDATE public.newsletter_settings ns SET policy_html_en = public._newsletter_consent_default('en')
   WHERE btrim(ns.policy_html_en) = c_old_en;
  GET DIAGNOSTICS v_en = ROW_COUNT;
  RETURN v_pl + v_en;
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_consent_upgrade_defaults() FROM PUBLIC, anon, authenticated, service_role;

-- DEFAULT kolumn = bieżąca treść domyślna (literał), potem aktualizacja.
-- Krótka blokada katalogowa na tabeli czytanej przez każdą stronę.
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
-- B) Oznaczenie admina „mój tekst obejmuje pomiar".
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.newsletter_consent_measurement_marks (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Pola z edytowalną treścią zgody newslettera (ustawienia formularza
  -- i popupu); oznaczenie dotyczy ZAPISANEGO tekstu pola w chwili oznaczenia.
  field text NOT NULL CHECK (field IN ('policy_html_pl', 'policy_html_en',
                                       'popup_privacy_html_pl', 'popup_privacy_html_en')),
  text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, field)
);
CREATE INDEX IF NOT EXISTS newsletter_consent_measurement_marks_sha_idx
  ON public.newsletter_consent_measurement_marks (tenant_id, text_sha256);

ALTER TABLE public.newsletter_consent_measurement_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_consent_measurement_marks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletter_consent_measurement_marks TO service_role;

COMMENT ON TABLE public.newsletter_consent_measurement_marks IS
  'Zgoda i pomiar (I9d-Y2): jawne oznaczenie admina, że WŁASNY tekst zgody (skrót SHA-256 zapisanego tekstu pola) informuje o pomiarze otwarć i kliknięć - wpis „tak" z tą treścią daje email_measurement. Zapis wyłącznie RPC panelu (audit_log).';

-- ----------------------------------------------------------------------------
-- C) Zgoda z pomiarem -> wpis `email_measurement` (każdy pisarz rejestru).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._consent_covers_measurement(
  p_tenant uuid, p_key text, p_version text, p_text text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_key ~ '^(newsletter|marketing)', false)
     AND (COALESCE(p_version = ANY (public._consent_measurement_versions()), false)
          OR EXISTS (SELECT 1 FROM public.newsletter_consent_measurement_marks m
                      WHERE m.tenant_id = p_tenant AND m.text_sha256 = public._consent_text_sha256(p_text)))
$$;

REVOKE ALL ON FUNCTION public._consent_covers_measurement(uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_crm_consent_log_measurement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public._consent_covers_measurement(NEW.tenant_id, NEW.consent_key, NEW.consent_version, NEW.consent_text) THEN
    RETURN NULL;
  END IF;
  -- Jeden wpis „tak" na adres i chwilę: formularz z kluczem `newsletter`
  -- i `marketing` jednocześnie nie dubluje zgody na pomiar.
  IF EXISTS (SELECT 1 FROM public.crm_consent_log c
              WHERE c.tenant_id = NEW.tenant_id AND lower(c.email) = lower(NEW.email)
                AND c.consent_key = 'email_measurement' AND c.given AND c.created_at = NEW.created_at) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, ip, user_agent, lang, created_at)
  VALUES (NEW.tenant_id, NEW.email, NEW.source_type, NEW.source_id, NEW.form_id, NEW.form_name, 'email_measurement',
          NEW.consent_text, NEW.consent_version, true, NEW.ip, NEW.user_agent, NEW.lang, NEW.created_at);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_crm_consent_log_measurement() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_crm_consent_log_measurement ON public.crm_consent_log;
CREATE TRIGGER trg_crm_consent_log_measurement
  AFTER INSERT ON public.crm_consent_log
  FOR EACH ROW
  WHEN (NEW.given AND NEW.consent_key ~ '^(newsletter|marketing)')
  EXECUTE FUNCTION public.tg_crm_consent_log_measurement();

COMMENT ON FUNCTION public.tg_crm_consent_log_measurement() IS
  'Zgoda i pomiar (I9d-Y2): wpis „tak" klucza newsletter*/marketing* z wersją z pomiarem albo z treścią oznaczoną przez admina dopisuje email_measurement „tak" (ta sama treść, wersja, źródło, chwila).';

-- ----------------------------------------------------------------------------
-- D) Pisarz zgód newslettera: wersja przy każdym wpisie, ponowny zapis.
-- ----------------------------------------------------------------------------
-- Wspólny dla wyzwalacza INSERT/potwierdzenia i wyzwalacza zmiany `consents`.
-- Pozycja bez klucza albo treści jest pomijana (dotąd NULL w treści zrywał
-- cały zapis subskrybenta na NOT NULL rejestru).
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
    INSERT INTO public.crm_consent_log (
      tenant_id, email, source_type, source_id, form_id, form_name,
      consent_key, consent_text, consent_version, given, ip, user_agent, lang
    ) VALUES (
      p_tenant, p_email, 'newsletter'::public.crm_source_type, p_subscriber, p_form_id, p_form_name,
      v_key, v_item ->> 'text',
      -- ZMIANA (I9d-Y2): wersja przy KAŻDEJ zgodzie - z ładunku, a gdy brak,
      -- skrót treści (dowód „którą treść widziała osoba").
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

-- Ciało z 20260708151417 (lead CRM, status newslettera, wpisy rejestru przy
-- INSERT i przejściu na `confirmed`, tekst zastępczy przy braku zgód);
-- zmiana: wpisy przez wspólnego pisarza (wersja przy każdej zgodzie),
-- tekst zastępczy też z wersją, `pg_temp` w ścieżce wyszukiwania.
-- CIALO-Z: 20260708151417
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

    IF public._newsletter_log_consents(NEW.tenant_id, NEW.email, NEW.id, NEW.source_form_id, NEW.source_form_name,
                                       NEW.language, v_ip, v_ua, NEW.consents) = 0 THEN
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

REVOKE ALL ON FUNCTION public.newsletter_to_lead() FROM PUBLIC, anon, authenticated;

-- Ponowny zapis (upsert istniejącego wiersza z nowymi `consents`): loguje
-- WYŁĄCZNIE pozycje nieobecne w poprzednim `consents` (każda pozycja ma
-- własną chwilę odbioru, więc nowy zapis = nowe pozycje). Przejście na
-- `confirmed` loguje komplet `newsletter_to_lead` - tu bez dubla.
CREATE OR REPLACE FUNCTION public.tg_newsletter_consents_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new jsonb;
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(NEW.consents) IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(jsonb_agg(e.item ORDER BY e.ord), '[]'::jsonb) INTO v_new
    FROM jsonb_array_elements(NEW.consents) WITH ORDINALITY AS e(item, ord)
   WHERE NOT (jsonb_typeof(OLD.consents) = 'array' AND OLD.consents @> jsonb_build_array(e.item));
  PERFORM public._newsletter_log_consents(NEW.tenant_id, NEW.email, NEW.id, NEW.source_form_id, NEW.source_form_name,
                                          NEW.language, CASE WHEN NEW.ip IS NULL THEN NULL ELSE host(NEW.ip) END,
                                          NEW.user_agent, v_new);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_newsletter_consents_log() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_newsletter_consents_log ON public.newsletter_subscribers;
CREATE TRIGGER trg_newsletter_consents_log
  AFTER UPDATE OF consents ON public.newsletter_subscribers
  FOR EACH ROW
  WHEN (OLD.consents IS DISTINCT FROM NEW.consents)
  EXECUTE FUNCTION public.tg_newsletter_consents_log();
RESET lock_timeout;

COMMENT ON FUNCTION public.tg_newsletter_consents_log() IS
  'Zgoda i pomiar (I9d-Y2): nowe pozycje consents subskrybenta (ponowny zapis po wypisie, ponowne zgłoszenie DOI) trafiają do rejestru zgód z wersją; przejście na confirmed loguje newsletter_to_lead.';

-- Link „Chcę dalej otrzymywać" (wygaszanie Y1) też jest wpisem „tak"
-- w rejestrze - dostaje wersję treści (skrót opisu potwierdzenia). Ciało
-- z 20261020161900; zmiana - wyłącznie kolumna wersji wpisu.
-- CIALO-Z: 20261020161900
-- rpc-shape: newsletter_sunset_keep (result, tenant_id, lang)
CREATE OR REPLACE FUNCTION public.newsletter_sunset_keep(p_subscriber uuid, p_nonce uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_text constant text :=
    'Potwierdzenie chęci dalszego otrzymywania newslettera (odpowiedź na prośbę o potwierdzenie, retencja danych)';
  v_s public.newsletter_subscribers%ROWTYPE;
  v_lang text;
BEGIN
  IF p_subscriber IS NULL OR p_nonce IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT * INTO v_s FROM public.newsletter_subscribers s WHERE s.id = p_subscriber FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'gone');
  END IF;
  v_lang := CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END;
  DELETE FROM public.newsletter_sunset_requests q
   WHERE q.subscriber_id = p_subscriber AND q.tenant_id = v_s.tenant_id AND q.nonce = p_nonce;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'already', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  IF v_s.status NOT IN ('subscribed', 'confirmed') THEN
    RETURN jsonb_build_object('result', 'inactive', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;

  UPDATE public.newsletter_subscribers s SET last_engaged_at = now() WHERE s.id = p_subscriber;
  -- Dowód odnowionej woli (art. 7 ust. 1): wpis „tak" w łańcuchu newslettera.
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, consent_key, consent_text,
                                      consent_version, given, lang)
  VALUES (v_s.tenant_id, v_s.email, 'newsletter', v_s.id, 'retention:newsletter_keep', 'newsletter', c_text,
          public._consent_text_version(c_text), true, v_lang);
  RETURN jsonb_build_object('result', 'kept', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_sunset_keep(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_sunset_keep(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.newsletter_sunset_keep(uuid, uuid) IS
  'Wygaszanie (I9d): link „Chcę dalej otrzymywać" - cykl subskrybenta z tym nonce usunięty (jednorazowo), znacznik zaangażowania, wpis potwierdzenia w rejestrze zgód (I9d-Y2: z wersją treści). Wynik: kept | already | inactive | gone | invalid. Tylko service_role (podpis HMAC sprawdza serwer).';

-- ----------------------------------------------------------------------------
-- E) Czytelnik zgody na pomiar i porcja dla runnerów (service_role).
-- ----------------------------------------------------------------------------
-- Zgoda na pomiar trwa od ostatniego wpisu `email_measurement` „tak", jeśli
-- PO NIM nie było: wycofania pomiaru, wycofania zgody `newsletter` albo
-- `marketing` (wypis ścieżki, personel, wygaśnięcie w retencji) ani wypisu
-- subskrybenta (`unsubscribed_at` zostaje po ponownym zapisie, więc stara
-- zgoda sprzed wypisu nie wraca razem z zapisem bez pomiaru). Remis chwil =
-- brak pomiaru (zachowawczo).
CREATE OR REPLACE FUNCTION public._email_measurement_consent(p_tenant uuid, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH c AS (
    SELECT max(l.created_at) FILTER (WHERE l.consent_key = 'email_measurement' AND l.given) AS granted,
           max(l.created_at) FILTER (WHERE l.consent_key = 'email_measurement' AND NOT l.given) AS withdrawn,
           max(l.created_at) FILTER (WHERE l.consent_key IN ('newsletter', 'marketing') AND NOT l.given) AS opted_out
      FROM public.crm_consent_log l
     WHERE l.tenant_id = p_tenant AND lower(l.email) = lower(btrim(p_email))
  )
  SELECT COALESCE(
           c.granted > COALESCE(c.withdrawn, '-infinity'::timestamptz)
       AND c.granted > COALESCE(c.opted_out, '-infinity'::timestamptz)
       AND NOT EXISTS (SELECT 1 FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = p_tenant AND lower(s.email) = lower(btrim(p_email))
                          AND (s.status = 'unsubscribed' OR s.unsubscribed_at >= c.granted)),
           false)
    FROM c
$$;

REVOKE ALL ON FUNCTION public._email_measurement_consent(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._email_measurement_consent(uuid, text) IS
  'Zgoda i pomiar (I9d-Y2): czy adres ma zgodę na pomiar otwarć i kliknięć - ostatnie email_measurement „tak" później niż wycofanie pomiaru, wycofanie zgody newsletter/marketing i wypis subskrybenta. Bez przełącznika najemcy. Wewnętrzna.';

-- Porcja adresów dla renderu kampanii i ścieżek: `consent` - zgoda osoby,
-- `measured` - zgoda ORAZ wspólny przełącznik najemcy (piksel i linki
-- z identyfikatorem odbiorcy tylko przy `measured`). Najemca z serwera
-- (kampania/zapis ścieżki), nie z żądania publicznego.
-- rpc-shape: email_measurement_status (email, consent, measured)
CREATE OR REPLACE FUNCTION public.email_measurement_status(p_tenant uuid, p_emails text[])
RETURNS TABLE (email text, consent boolean, measured boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Porcja runnera kampanii to 50-500 adresów; limit chroni bazę przed
  -- jednym wywołaniem z całą listą (TS dzieli większe zbiory).
  c_max constant integer := 2000;
  v_enabled boolean;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant_required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(cardinality(p_emails), 0) > c_max THEN
    RAISE EXCEPTION 'too_many_emails' USING ERRCODE = '22023';
  END IF;
  v_enabled := public._newsletter_track_opens(p_tenant);
  RETURN QUERY
    SELECT e.em, x.ok, x.ok AND v_enabled
      FROM (SELECT DISTINCT lower(btrim(v)) AS em
              FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) AS v
             WHERE NULLIF(btrim(v), '') IS NOT NULL) e
     CROSS JOIN LATERAL (SELECT public._email_measurement_consent(p_tenant, e.em) AS ok) x
     ORDER BY e.em;
END;
$$;

REVOKE ALL ON FUNCTION public.email_measurement_status(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_measurement_status(uuid, text[]) TO service_role;

COMMENT ON FUNCTION public.email_measurement_status(uuid, text[]) IS
  'Zgoda i pomiar (I9d-Y2): porcja adresów (maks. 2000, małe litery, bez duplikatów) -> consent (zgoda osoby na pomiar) i measured (zgoda ORAZ wspólny przełącznik najemcy journey_settings.open_tracking_enabled - ścieżki i kampanie). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- F) Podmiot linku (subskrybent albo kontakt CRM), stan i wycofanie pomiaru.
-- ----------------------------------------------------------------------------
-- Link z maila kampanii/preferencji niesie subskrybenta, z maila ścieżki -
-- kontakt CRM (identyfikator z podpisanego tokenu TS, nigdy adres).
CREATE OR REPLACE FUNCTION public._email_measurement_subject(
  p_subscriber uuid, p_lead uuid,
  OUT tenant_id uuid, OUT email text, OUT lang text, OUT source_type public.crm_source_type, OUT source_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF (p_subscriber IS NULL) = (p_lead IS NULL) THEN
    RETURN;
  END IF;
  IF p_subscriber IS NOT NULL THEN
    SELECT s.tenant_id, s.email, CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END,
           'newsletter'::public.crm_source_type, s.id
      INTO tenant_id, email, lang, source_type, source_id
      FROM public.newsletter_subscribers s WHERE s.id = p_subscriber;
    RETURN;
  END IF;
  SELECT l.tenant_id, l.email_norm, 'other'::public.crm_source_type, l.id
    INTO tenant_id, email, source_type, source_id
    FROM public.crm_leads l WHERE l.id = p_lead AND l.anonymized_at IS NULL;
  IF tenant_id IS NOT NULL THEN
    SELECT CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END INTO lang
      FROM public.newsletter_subscribers s
     WHERE s.tenant_id = _email_measurement_subject.tenant_id
       AND lower(s.email) = _email_measurement_subject.email
     LIMIT 1;
    lang := COALESCE(lang, 'pl');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._email_measurement_subject(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Stan dla strony linku (GET bez mutacji) i preferencji.
-- rpc-shape: email_measurement_state (result, consent, measured, enabled, tenant_id, lang)
CREATE OR REPLACE FUNCTION public.email_measurement_state(p_subscriber uuid DEFAULT NULL, p_lead uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s record;
  v_consent boolean;
  v_enabled boolean;
BEGIN
  IF (p_subscriber IS NULL) = (p_lead IS NULL) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT * INTO v_s FROM public._email_measurement_subject(p_subscriber, p_lead);
  IF v_s.tenant_id IS NULL THEN
    RETURN jsonb_build_object('result', 'gone');
  END IF;
  v_consent := public._email_measurement_consent(v_s.tenant_id, v_s.email);
  v_enabled := public._newsletter_track_opens(v_s.tenant_id);
  RETURN jsonb_build_object('result', 'ok', 'consent', v_consent, 'measured', v_consent AND v_enabled,
                            'enabled', v_enabled, 'tenant_id', v_s.tenant_id, 'lang', v_s.lang);
END;
$$;

REVOKE ALL ON FUNCTION public.email_measurement_state(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_measurement_state(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.email_measurement_state(uuid, uuid) IS
  'Zgoda i pomiar (I9d-Y2): stan pomiaru dla linku „Nie mierz moich otwarć i kliknięć" (subskrybent ALBO kontakt CRM z podpisanego tokenu). Wynik: {result: ok|gone|invalid, consent, measured, enabled, tenant_id, lang}. Bez mutacji. Tylko service_role.';

-- Wycofanie SAMEGO pomiaru: wpis `email_measurement` „nie" (zgoda na
-- newsletter, status subskrybenta i kontakt CRM bez zmian). Idempotentne:
-- gdy ostatnie słowo łańcucha pomiaru nie brzmi „tak" - `already` bez wpisu
-- (remis chwil w jednej transakcji rozstrzyga „nie" - jak czytelnik zgody).
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
                                      consent_text, consent_version, given, ip, user_agent, lang)
  VALUES (v_s.tenant_id, v_s.email, v_s.source_type, v_s.source_id, 'measurement:' || v_channel,
          'email_measurement_withdraw', 'email_measurement',
          CASE WHEN v_s.lang = 'en'
            THEN 'Withdrawal of consent to measuring email opens and clicks (newsletter and marketing consent unchanged).'
            ELSE 'Wycofanie zgody na pomiar otwarć i kliknięć w wiadomościach e-mail (zgoda na newsletter i komunikację bez zmian).'
          END,
          public._newsletter_consent_version(), false, left(NULLIF(btrim(p_ip), ''), 64),
          left(NULLIF(btrim(p_user_agent), ''), 512), v_s.lang);
  RETURN jsonb_build_object('result', 'withdrawn', 'tenant_id', v_s.tenant_id, 'lang', v_s.lang);
END;
$$;

REVOKE ALL ON FUNCTION public.email_measurement_withdraw(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_measurement_withdraw(uuid, uuid, text, text, text) TO service_role;

COMMENT ON FUNCTION public.email_measurement_withdraw(uuid, uuid, text, text, text) IS
  'Zgoda i pomiar (I9d-Y2): wycofanie SAMEGO pomiaru otwarć i kliknięć (subskrybent ALBO kontakt CRM z podpisanego tokenu; kanał email_footer|preferences|account) - wpis email_measurement „nie", zgoda na newsletter bez zmian. Wynik: {result: withdrawn|already|gone|invalid, tenant_id, lang}. Tylko service_role (podpis HMAC sprawdza serwer).';
