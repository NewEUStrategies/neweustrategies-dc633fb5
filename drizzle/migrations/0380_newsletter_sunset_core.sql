-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y1, 5/8): WYGASZANIE NIEAKTYWNYCH
-- SUBSKRYBENTÓW NEWSLETTERA - ZNACZNIK ZAANGAŻOWANIA, STAN CYKLU,
-- POTWIERDZENIE „CHCĘ DALEJ OTRZYMYWAĆ" (Z-I9c-08). Decyzja właściciela
-- 2026-10-20 („tak, usuwaj"): 12 mies. bez zaangażowania (zakres 6-24) ->
-- JEDNA prośba o potwierdzenie -> brak reakcji 30 dni -> usunięcie wiersza
-- subskrybenta (rejestr zgód zostaje, lista wyłączeń nietknięta).
--
-- DEFEKT
--   1. Zaangażowanie subskrybenta da się dziś odczytać tylko z surowych
--      zdarzeń kampanii i ścieżek, a te kategoria `email_engagement` usuwa
--      po 3-25 mies. (zwijając do archiwum kampanii bez subskrybenta) - okno
--      nieaktywności do 24 mies. widziałoby po czyszczeniu „brak aktywności"
--      u osoby, która klikała (pułapka 8 pakietu I9d-1).
--   2. Otwarcia kampanii nie mają flagi maszynowej - otwarcie przez Apple MPP
--      (pobranie piksela przy doręczeniu) wyglądałoby na zaangażowanie.
--   3. Brak stanu cyklu (prośba, wysyłka, termin reakcji) i wykluczeń.
--
-- ZMIANA (DECYZJE WYKONAWCZE orkiestratora I9d, dziennik §21.22)
--   A. `newsletter_subscribers.last_engaged_at` (kliknięcie, formularz,
--      „Chcę dalej otrzymywać") i `last_human_open_at` (otwarcie ludzkie -
--      osobno, bo przy wyłączonym pomiarze otwarć zaangażowanie liczy się bez
--      otwarć). Jedyny pisarz: `_newsletter_engagement_touch` (zapis najwyżej
--      raz na dobę na subskrybenta - mniej zapisów i zdarzeń realtime).
--      Uzupełnienie wsteczne z zachowanych zdarzeń (otwarcia kampanii bez
--      filtra maszynowego - historia go nie ma; zachowawczo: nikt nie
--      wypada na starcie przez brak danych). Logowanie konta, formularze
--      i potwierdzenie zapisu czyta funkcja kandydatów z trwałych źródeł
--      (`auth.users.last_sign_in_at`, rejestr zgód, wiadomości, zgłoszenia
--      na wydarzenia, `confirmed_at`) - bez wyzwalacza w ścieżce logowania.
--   B. `newsletter_record_campaign_event` (CIALO-Z niżej) - kliknięcie
--      zawsze, otwarcie po progu `machine_open_seconds` od wysyłki do
--      odbiorcy (`newsletter_campaign_recipients.sent_at`; brak wysyłki =
--      maszynowe); `journey_record_message_event` (S5, CIALO-Z niżej -
--      druga redefinicja w rezerwie I9, mapa wersji w bramce) - kliknięcie
--      i otwarcie po progu, subskrybent po adresie kontaktu CRM. Znacznik
--      PRZED deduplikacją doby.
--   C. `newsletter_sunset_requests` - cykl subskrybenta: nonce linku
--      jednorazowego, prośba, dzierżawa wysyłki, próby, wysłano (wynik:
--      w kolejce, duplikat, zablokowany listą wyłączeń = jak wysłany), kod
--      błędu (ponowienie). Stan POZA kolumną `status` (każda zmiana statusu
--      budzi `newsletter_to_lead` i podbija aktywność CRM).
--   D. `newsletter_sunset_exclusions` - wykluczenie adresu z wygaszania
--      z powodem 3-500 znaków (ten sam limit co przedłużenie kontaktu CRM)
--      i autorem; zdejmowalne w panelu (audyt obu akcji - 20261020162100).
--   E. `newsletter_engagement_touch(najemca, e-mail)` - formularz (ponowny
--      zapis istniejącego adresu nie zapisuje dziś niczego); tylko
--      service_role, najemca z hosta po stronie serwera.
--   F. `newsletter_sunset_keep(subskrybent, nonce)` - link „Chcę dalej
--      otrzymywać" (podpis HMAC sprawdza serwer TS): cykl usunięty (token
--      jednorazowy - powtórka `already`), znacznik zaangażowania, wpis
--      potwierdzenia w rejestrze zgód; tylko service_role.
--   G. Indeksy kluczy obcych subskrybenta w modułach poczty (SET NULL przy
--      usunięciu skanowałby całe tabele zdarzeń doręczeń i blokad).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020161300 (ostatnia definicja
-- `journey_record_message_event`) i module newslettera. Wykonanie
-- wygaszania - 20261020162000, panel - 162100, katalog - 162200.
-- IDEMPOTENTNA: ADD COLUMN / CREATE TABLE / CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, uzupełnienie tylko w przód (GREATEST),
-- bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_i9d_newsletter_sunset_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A, C, D, G) Kolumny, tabele cyklu i wykluczeń, indeksy.
-- ----------------------------------------------------------------------------
-- Gorące tabele modułu poczty i newslettera (klucz obcy bierze SHARE ROW
-- EXCLUSIVE na subskrybentach) - limit blokady zamiast kolejki za importem.
SET lock_timeout = '5s';
ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS last_engaged_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_human_open_at timestamptz;

CREATE TABLE IF NOT EXISTS public.newsletter_sunset_requests (
  subscriber_id uuid PRIMARY KEY REFERENCES public.newsletter_subscribers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Składnik linku jednorazowego: nowy cykl = nowy nonce, link z poprzedniej
  -- prośby niczego nie odnawia.
  nonce uuid NOT NULL DEFAULT gen_random_uuid(),
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  mailed_at timestamptz,
  mail_outcome text CHECK (mail_outcome IS NULL OR mail_outcome IN ('queued', 'duplicate', 'suppressed')),
  -- Wyłącznie kod błędu wysyłki - nigdy tekst (mógłby cytować adres).
  last_error text CHECK (last_error IS NULL OR last_error ~ '^[a-z0-9_.:-]{1,64}$'),
  CONSTRAINT newsletter_sunset_requests_mailed_check CHECK ((mailed_at IS NULL) = (mail_outcome IS NULL))
);
CREATE INDEX IF NOT EXISTS newsletter_sunset_requests_tenant_idx
  ON public.newsletter_sunset_requests (tenant_id, mailed_at);
CREATE INDEX IF NOT EXISTS newsletter_sunset_requests_pending_idx
  ON public.newsletter_sunset_requests (tenant_id, requested_at) WHERE mailed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.newsletter_sunset_exclusions (
  subscriber_id uuid PRIMARY KEY REFERENCES public.newsletter_subscribers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Limit = DATA_RETENTION_RULES.crmExtensionReason* (TS); dłuższy powód RPC
  -- odrzuca, nie skraca.
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS newsletter_sunset_exclusions_tenant_idx
  ON public.newsletter_sunset_exclusions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_suppressions_subscriber_idx
  ON public.email_suppressions (subscriber_id) WHERE subscriber_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_delivery_events_subscriber_idx
  ON public.email_delivery_events (subscriber_id) WHERE subscriber_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS newsletter_campaign_recipients_subscriber_idx
  ON public.newsletter_campaign_recipients (subscriber_id) WHERE subscriber_id IS NOT NULL;
-- Limit blokady zostaje do końca uzupełnienia wstecznego (DISABLE/ENABLE
-- TRIGGER na subskrybentach też bierze blokadę tabeli).

COMMENT ON COLUMN public.newsletter_subscribers.last_engaged_at IS
  'Wygaszanie (I9d): ostatnie zaangażowanie poza otwarciem - kliknięcie (kampania, ścieżka), formularz, „Chcę dalej otrzymywać". Trwałe, bo surowe zdarzenia usuwa retencja email_engagement.';
COMMENT ON COLUMN public.newsletter_subscribers.last_human_open_at IS
  'Wygaszanie (I9d): ostatnie otwarcie ludzkie (po progu machine_open_seconds od wysyłki). Pomijane, gdy najemca wyłączył pomiar otwarć.';

ALTER TABLE public.newsletter_sunset_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_sunset_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_sunset_requests, public.newsletter_sunset_exclusions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletter_sunset_requests, public.newsletter_sunset_exclusions
  TO service_role;

COMMENT ON TABLE public.newsletter_sunset_requests IS
  'Wygaszanie nieaktywnych subskrybentów (I9d, Z-I9c-08): cykl prośby o potwierdzenie - nonce linku jednorazowego, prośba, wysyłka (dzierżawa, próby, wynik), termin reakcji = mailed_at + 30 dni. Tylko funkcje SECURITY DEFINER.';
COMMENT ON TABLE public.newsletter_sunset_exclusions IS
  'Wygaszanie (I9d): subskrybent wykluczony przez admina z powodem (3-500 znaków) - bez prośby i bez usunięcia. Audyt w audit_log.';

-- ----------------------------------------------------------------------------
-- A) Jedyny pisarz znacznika zaangażowania.
-- ----------------------------------------------------------------------------
-- `p_kind = 'open'` -> otwarcie ludzkie, każdy inny rodzaj (kliknięcie,
-- formularz, potwierdzenie) -> `last_engaged_at`. Subskrybent po id albo
-- po adresie (ścieżki i formularze znają tylko adres). Zapis tylko, gdy
-- znacznik jest starszy o ponad dobę - zaangażowanie z dokładnością do dnia
-- wystarcza na okno 6-24 mies., a każdy UPDATE leci realtime do panelu.
CREATE OR REPLACE FUNCTION public._newsletter_engagement_touch(
  p_tenant uuid, p_subscriber uuid, p_email text, p_kind text, p_at timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_at timestamptz := LEAST(COALESCE(p_at, now()), now());
  v_email text := lower(NULLIF(btrim(p_email), ''));
  v_n integer := 0;
BEGIN
  IF p_tenant IS NULL OR p_kind IS NULL OR (p_subscriber IS NULL AND v_email IS NULL) THEN
    RETURN 0;
  END IF;
  IF p_kind = 'open' THEN
    UPDATE public.newsletter_subscribers s SET last_human_open_at = v_at
     WHERE s.tenant_id = p_tenant
       AND (s.id = p_subscriber OR (p_subscriber IS NULL AND lower(s.email) = v_email))
       AND (s.last_human_open_at IS NULL OR s.last_human_open_at < v_at - interval '1 day');
  ELSE
    UPDATE public.newsletter_subscribers s SET last_engaged_at = v_at
     WHERE s.tenant_id = p_tenant
       AND (s.id = p_subscriber OR (p_subscriber IS NULL AND lower(s.email) = v_email))
       AND (s.last_engaged_at IS NULL OR s.last_engaged_at < v_at - interval '1 day');
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_engagement_touch(uuid, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_engagement_touch(uuid, uuid, text, text, timestamptz) IS
  'Wygaszanie (I9d): jedyny pisarz znaczników zaangażowania subskrybenta (open -> last_human_open_at, inne -> last_engaged_at), najwyżej raz na dobę. Woła zapis zdarzeń kampanii i ścieżek, formularz i link „Chcę dalej otrzymywać". Wewnętrzny.';

-- Uzupełnienie wsteczne z zachowanych zdarzeń (kampanie: po subskrybencie;
-- ścieżki: po adresie kontaktu CRM), bez przesuwania `updated_at`.
DO $$
DECLARE
  v_touch boolean := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.newsletter_subscribers'::regclass
                                AND tgname = 'newsletter_set_updated_at' AND NOT tgisinternal);
BEGIN
  IF v_touch THEN
    EXECUTE 'ALTER TABLE public.newsletter_subscribers DISABLE TRIGGER newsletter_set_updated_at';
  END IF;

  UPDATE public.newsletter_subscribers s
     SET last_engaged_at = GREATEST(s.last_engaged_at, x.clicked),
         last_human_open_at = GREATEST(s.last_human_open_at, x.opened)
    FROM (SELECT e.subscriber_id,
                 max(e.created_at) FILTER (WHERE e.kind = 'click') AS clicked,
                 max(e.created_at) FILTER (WHERE e.kind = 'open') AS opened
            FROM public.newsletter_campaign_events e
           WHERE e.subscriber_id IS NOT NULL
           GROUP BY e.subscriber_id) x
   WHERE s.id = x.subscriber_id
     AND (x.clicked > COALESCE(s.last_engaged_at, '-infinity'::timestamptz)
          OR x.opened > COALESCE(s.last_human_open_at, '-infinity'::timestamptz));

  UPDATE public.newsletter_subscribers s
     SET last_engaged_at = GREATEST(s.last_engaged_at, x.clicked),
         last_human_open_at = GREATEST(s.last_human_open_at, x.opened)
    FROM (SELECT l.tenant_id, l.email_norm,
                 max(me.occurred_at) FILTER (WHERE me.kind = 'click') AS clicked,
                 max(me.occurred_at) FILTER (WHERE me.kind = 'open' AND NOT me.machine) AS opened
            FROM public.journey_message_events me
            JOIN public.journey_messages m ON m.message_id = me.message_id
            JOIN public.crm_leads l ON l.id = m.lead_id
           WHERE me.kind IN ('open', 'click')
           GROUP BY l.tenant_id, l.email_norm) x
   WHERE s.tenant_id = x.tenant_id AND lower(s.email) = x.email_norm
     AND (x.clicked > COALESCE(s.last_engaged_at, '-infinity'::timestamptz)
          OR x.opened > COALESCE(s.last_human_open_at, '-infinity'::timestamptz));

  IF v_touch THEN
    EXECUTE 'ALTER TABLE public.newsletter_subscribers ENABLE TRIGGER newsletter_set_updated_at';
  END IF;
END $$;
RESET lock_timeout;

-- ----------------------------------------------------------------------------
-- B) Zapis zdarzeń: kampania newslettera.
-- ----------------------------------------------------------------------------
-- Ciało z 20260814215302 (najemca z kampanii, subskrybent w tym samym
-- najemcy, deduplikacja doby UTC); zmiana: znacznik zaangażowania przed
-- wstawieniem i `pg_temp` w ścieżce wyszukiwania.
-- CIALO-Z: 20260814215302
CREATE OR REPLACE FUNCTION public.newsletter_record_campaign_event(
  p_campaign uuid,
  p_subscriber uuid,
  p_kind text,
  p_url text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_subscriber uuid;
  v_id uuid;
  v_at timestamptz := LEAST(COALESCE(p_occurred_at, now()), now());
  v_sent_at timestamptz;
  v_threshold integer;
BEGIN
  IF p_campaign IS NULL OR p_kind IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'invalid_input');
  END IF;

  IF p_kind NOT IN ('open', 'click') THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'invalid_kind');
  END IF;

  SELECT c.tenant_id INTO v_tenant
    FROM public.newsletter_campaigns c
   WHERE c.id = p_campaign;

  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'unknown_campaign');
  END IF;

  SELECT s.id INTO v_subscriber
    FROM public.newsletter_subscribers s
   WHERE s.id = p_subscriber
     AND s.tenant_id = v_tenant;

  IF v_subscriber IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'unknown_subscriber');
  END IF;

  -- ZMIANA (I9d, Z-I9c-08): znacznik zaangażowania PRZED deduplikacją doby
  -- (ludzkie otwarcie po maszynowym tej samej doby też się liczy).
  -- Otwarcie ludzkie = po progu `machine_open_seconds` (S5) od wysyłki do
  -- tego odbiorcy: Apple MPP pobiera piksel przy doręczeniu; brak chwili
  -- wysyłki (piksel przed zapisem `sent_at`) = maszynowe.
  IF p_kind = 'click' THEN
    PERFORM public._newsletter_engagement_touch(v_tenant, v_subscriber, NULL, 'click', v_at);
  ELSE
    SELECT max(r.sent_at) INTO v_sent_at FROM public.newsletter_campaign_recipients r
     WHERE r.subscriber_id = v_subscriber AND r.campaign_id = p_campaign;
    SELECT js.machine_open_seconds INTO v_threshold FROM public.journey_settings js WHERE js.tenant_id = v_tenant;
    IF v_sent_at IS NOT NULL AND v_at - v_sent_at >= make_interval(secs => COALESCE(v_threshold, 2)) THEN
      PERFORM public._newsletter_engagement_touch(v_tenant, v_subscriber, NULL, 'open', v_at);
    END IF;
  END IF;

  INSERT INTO public.newsletter_campaign_events
    (tenant_id, campaign_id, subscriber_id, kind, url, created_at)
  VALUES (v_tenant, p_campaign, v_subscriber, p_kind, left(p_url, 2048), v_at)
  ON CONFLICT (campaign_id, subscriber_id, kind, ((created_at AT TIME ZONE 'UTC')::date))
    WHERE subscriber_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'recorded',  v_id IS NOT NULL,
    'duplicate', v_id IS NULL,
    'reason',    CASE WHEN v_id IS NULL THEN 'duplicate_in_day' ELSE 'recorded' END,
    'event_id',  v_id,
    'tenant_id', v_tenant,
    'event_day', (v_at AT TIME ZONE 'UTC')::date
  );
END;
$$;

COMMENT ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz) IS
  'Jedyna sciezka zapisu zdarzen open/click. Tenant z kampanii, subskrybent walidowany w tym samym tenancie, wstawienie idempotentne w dobie UTC. I9d: znacznik zaangazowania subskrybenta (klik; otwarcie po progu machine_open_seconds od wysylki) przed deduplikacja.';

REVOKE ALL ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)
  TO service_role;

-- ----------------------------------------------------------------------------
-- B) Zapis zdarzeń: mail ścieżki (S5).
-- ----------------------------------------------------------------------------
-- Ciało z 20261020161300 (I9c-X2: wyłącznik pomiaru otwarć); zmiana -
-- znacznik zaangażowania subskrybenta przed wstawieniem.
-- CIALO-Z: 20261020161300
CREATE OR REPLACE FUNCTION public.journey_record_message_event(
  p_message_id text,
  p_kind text,
  p_link_index integer DEFAULT -1,
  p_url text DEFAULT NULL,
  p_machine boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_m public.journey_messages%ROWTYPE;
  v_threshold integer;
  v_machine boolean;
  v_id bigint;
  v_exited integer := 0;
  v_track_opens boolean;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('open', 'click', 'unsubscribe') THEN
    RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_m FROM public.journey_messages m WHERE m.message_id = p_message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'unknown_message');
  END IF;
  SELECT s.machine_open_seconds, s.open_tracking_enabled INTO v_threshold, v_track_opens
    FROM public.journey_settings s WHERE s.tenant_id = v_m.tenant_id;
  -- ZMIANA (I9c-X2): najemca wylaczyl pomiar otwarc - piksel z maila
  -- wyslanego wczesniej nie zapisuje zdarzenia (brak wiersza = wlaczony).
  IF p_kind = 'open' AND v_track_opens IS FALSE THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'open_tracking_disabled', 'tenant_id', v_m.tenant_id);
  END IF;
  -- Otwarcie tuż po wysyłce to skaner albo proxy (MPP), nie człowiek.
  v_machine := COALESCE(p_machine, false)
    OR (p_kind = 'open' AND now() - v_m.queued_at < make_interval(secs => COALESCE(v_threshold, 2)));

  -- ZMIANA (I9d, Z-I9c-08): trwały znacznik zaangażowania subskrybenta
  -- newslettera (wygaszanie nieaktywnych) - PRZED wstawieniem, bo
  -- deduplikacja doby zjadłaby ludzkie otwarcie po maszynowym. Kliknięcie
  -- zawsze; otwarcie - po progu czasu od wysyłki (Apple MPP pobiera piksel
  -- przy doręczeniu). Flaga proxy z TS (`p_machine`) tu się nie liczy:
  -- proxy Gmaila pobiera obrazki przy faktycznym otwarciu (decyzja
  -- wykonawcza I9d - otwarcie przez proxy Gmaila jest ludzkie).
  IF p_kind = 'click'
     OR (p_kind = 'open' AND now() - v_m.queued_at >= make_interval(secs => COALESCE(v_threshold, 2))) THEN
    PERFORM public._newsletter_engagement_touch(
      v_m.tenant_id, NULL, (SELECT l.email_norm FROM public.crm_leads l WHERE l.id = v_m.lead_id), p_kind, now());
  END IF;

  INSERT INTO public.journey_message_events (tenant_id, message_id, kind, link_index, url, machine)
  VALUES (
    v_m.tenant_id, v_m.message_id, p_kind,
    CASE WHEN p_kind = 'click' THEN LEAST(GREATEST(COALESCE(p_link_index, 0), 0), 999) ELSE -1 END,
    CASE WHEN p_kind = 'click' THEN left(p_url, 2000) END,
    v_machine
  )
  ON CONFLICT ON CONSTRAINT journey_message_events_dedupe_key DO NOTHING
  RETURNING id INTO v_id;

  IF p_kind = 'unsubscribe' THEN
    v_exited := public._journey_unsubscribe(v_m.tenant_id, v_m.lead_id, v_m.message_id);
  END IF;
  RETURN jsonb_build_object('recorded', v_id IS NOT NULL, 'tenant_id', v_m.tenant_id,
                            'kind', p_kind, 'machine', v_machine, 'exited', v_exited);
END;
$$;

REVOKE ALL ON FUNCTION public.journey_record_message_event(text, text, integer, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_record_message_event(text, text, integer, text, boolean) TO service_role;


COMMENT ON FUNCTION public.journey_record_message_event(text, text, integer, text, boolean) IS
  'Hub S5: otwarcie/kliknięcie/wypis maila ścieżki - najemca z wiadomości, deduplikacja doby, otwarcia maszynowe; wypis wycofuje zgodę (księga), wypisuje subskrybenta z blokadą i kończy aktywne zapisy marketingowe (unsubscribed). I9d: kliknięcie i otwarcie po progu -> znacznik zaangażowania subskrybenta newslettera. Tylko service_role.';

-- ----------------------------------------------------------------------------
-- E) Formularz: zaangażowanie istniejącego subskrybenta.
-- ----------------------------------------------------------------------------
-- Woła serwer TS (np. ponowny zapis istniejącego adresu - odpowiedź dla
-- osoby bez zmian, nie ujawnia obecności na liście). Najemca rozstrzygnięty
-- przez serwer z hosta, jak przy liczniku gościa; tylko service_role.
CREATE OR REPLACE FUNCTION public.newsletter_engagement_touch(p_tenant uuid, p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._newsletter_engagement_touch(p_tenant, NULL, p_email, 'form', now()) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_engagement_touch(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_engagement_touch(uuid, text) TO service_role;

COMMENT ON FUNCTION public.newsletter_engagement_touch(uuid, text) IS
  'Wygaszanie (I9d): formularz z adresem istniejącego subskrybenta = zaangażowanie (last_engaged_at, najwyżej raz na dobę). Zwraca, czy znacznik się przesunął. Tylko service_role.';

-- ----------------------------------------------------------------------------
-- F) Link „Chcę dalej otrzymywać" (token jednorazowy).
-- ----------------------------------------------------------------------------
-- Serwer TS sprawdza podpis HMAC (subskrybent, nonce) i woła tę funkcję.
-- Jednorazowość: cykl z tym nonce znika przy pierwszym użyciu; powtórka
-- albo link z wcześniejszego cyklu = `already` (bez skutku). Subskrybent
-- wypisany w międzyczasie nie wraca na listę (`inactive`).
-- rpc-shape: newsletter_sunset_keep (result, tenant_id, lang)
CREATE OR REPLACE FUNCTION public.newsletter_sunset_keep(p_subscriber uuid, p_nonce uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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
                                      given, lang)
  VALUES (v_s.tenant_id, v_s.email, 'newsletter', v_s.id, 'retention:newsletter_keep', 'newsletter',
          'Potwierdzenie chęci dalszego otrzymywania newslettera (odpowiedź na prośbę o potwierdzenie, retencja danych)',
          true, v_lang);
  RETURN jsonb_build_object('result', 'kept', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_sunset_keep(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_sunset_keep(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.newsletter_sunset_keep(uuid, uuid) IS
  'Wygaszanie (I9d): link „Chcę dalej otrzymywać" - cykl subskrybenta z tym nonce usunięty (jednorazowo), znacznik zaangażowania, wpis potwierdzenia w rejestrze zgód. Wynik: kept | already | inactive | gone | invalid. Tylko service_role (podpis HMAC sprawdza serwer).';
