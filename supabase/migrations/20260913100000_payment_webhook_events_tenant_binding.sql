-- ============================================================================
-- payment_webhook_events: wiazanie najemcy kaskada + zawezenie RPC zdrowia
-- ============================================================================
--
-- PO CO TA MIGRACJA.
--
-- Dziennik webhookow platnosci jest jedynym miejscem, gdzie leza surowe ladunki
-- operatora platnosci (e-mail platnika, adres, kwoty) razem z identyfikatorami,
-- po ktorych panel admina potrafi ODTWORZYC zdarzenie rozliczeniowe. Obie
-- warstwy zakresu najemcy byly tu dziurawe i psuly sie nawzajem:
--
--  (1) WIAZANIE. Trigger `payment_webhook_events_bind_tenant` (20260824080046)
--      rozstrzygal najemce JEDNYM strzalem: profilem po `NEW.user_id`. A
--      `user_id` jest znany wylacznie dla zdarzen z checkoutu (przychodzi z
--      `customData.userId` w `src/routes/api/public/payments/webhook.ts`).
--      Wszystko inne - `customer.subscription.*`, `invoice.*`, `charge.refunded`
--      oraz kazdy wiersz dopisany przez uzgadnianie - ladowalo w najemcy
--      DOMYSLNYM niezaleznie od tego, czyja to byla platnosc. Trigger byl przy
--      tym `BEFORE INSERT OR UPDATE OF user_id`, wiec domkniecie wiersza przez
--      `finishWebhookEvent` (ktore dopisuje `subscription_id`) nie mialo szansy
--      go przewiazac. Pula wierszy w tenancie domyslnym nie kurczyla sie z
--      czasem - rosla.
--
--  (2) ODCZYT. `admin_payment_webhook_health` (20260828063423) bramkowala
--      WYLACZNIE role (`has_role(admin) OR has_role(super_admin)`), a liczyla po
--      CALEJ tabeli. `recent_failures` oddawalo do przegladarki `id`,
--      `event_type` i tresc bledu zdarzen KAZDEGO innego obszaru roboczego - a
--      te `id` byly gotowym wejsciem dla server fn czytajacych wiersz po samym
--      identyfikatorze.
--
-- Te dwie dziury trzymaly sie razem: samo zawezenie odczytu (2) bez naprawy
-- wiazania (1) OSLEPILOBY legalnych operatorow - przestaliby widziec dokladnie
-- te zdarzenia, ktorych diagnoza jest najczestsza, bo wszystkie siedza w puli
-- domyslnej. Dlatego oba kroki wchodza jedna migracja.
--
-- ZASADA NACZELNA: autoryzacja i zakres danych stoja na TEJ SAMEJ plaszczyznie.
-- Rola jest sprawdzana przez `has_role()` -> `current_tenant_id()` ->
-- `profiles.tenant_id` wolajacego, wiec i dane maja byc liczone po
-- `current_tenant_id()`. Nigdy po hoscie zadania (`public_tenant_id()` bierze
-- naglowek od klienta) i nigdy po ladunku.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Rozstrzyganie najemcy dla wiersza dziennika - JEDNA definicja kaskady.
--
-- PO CO OSOBNA FUNKCJA, a nie cialo triggera: tej samej kaskady potrzebuje
-- trigger (nowe i domykane wiersze) ORAZ jednorazowy backfill ponizej. Gdyby
-- logika zyla w dwoch miejscach, backfill i trigger rozjechalyby sie przy
-- pierwszej korekcie - a rozjazd tutaj znaczy "czesc wierszy w zlym najemcy".
--
-- KOLEJNOSC NOSNIKOW TOZSAMOSCI jest od najmocniejszego do najslabszego:
--   (a) profil platnika po `user_id`        - wskazanie wprost, bez posrednika;
--   (b) subskrypcja po id operatora         - wiersz juz zwiazany z najemca;
--   (c) zamowienie po id subskrypcji        - pierwsza faktura bywa wczesniejsza
--                                             niz wiersz w `subscriptions`;
--   (d) subskrypcja po id klienta           - klient operatora nalezy do jednego
--                                             obszaru roboczego;
--   (e) zamowienie po id klienta            - to samo, gdy subskrypcji nie ma
--                                             (platnosc jednorazowa, darowizna);
--   (f) e-mail z ladunku                    - ostatnia deska ratunku.
-- Zapytania (b)-(e) wiaza dodatkowo `environment`: ten sam identyfikator
-- operatora potrafi istniec w piaskownicy i na produkcji, a pomylka miedzy
-- srodowiskami to ten sam blad co pomylka miedzy najemcami.
--
-- ZWRACA NULL, gdy zaden nosnik nie rozstrzyga. To jest celowe: dopiero
-- wolajacy decyduje, czym wypelnic luke (trigger zostawia wtedy dotychczasowa
-- wartosc kolumny, backfill nie rusza wiersza wcale).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_webhook_event_tenant(
  p_user_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_environment text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_tenant uuid;
  v_email text;
  v_default uuid;
BEGIN
  -- (a) profil platnika
  IF p_user_id IS NOT NULL THEN
    SELECT p.tenant_id INTO v_tenant
      FROM public.profiles p
     WHERE p.id = p_user_id;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;
  END IF;

  -- (b) subskrypcja po identyfikatorze subskrypcji u operatora
  IF p_subscription_id IS NOT NULL THEN
    SELECT s.tenant_id INTO v_tenant
      FROM public.subscriptions s
     WHERE s.provider_subscription_id = p_subscription_id
       AND (p_environment IS NULL OR s.environment = p_environment)
     ORDER BY s.updated_at DESC
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;

    -- (c) zamowienie po identyfikatorze subskrypcji
    SELECT o.tenant_id INTO v_tenant
      FROM public.payment_orders o
     WHERE o.provider_subscription_id = p_subscription_id
       AND (p_environment IS NULL OR o.environment = p_environment)
     ORDER BY o.created_at DESC
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    -- (d) subskrypcja po identyfikatorze klienta
    SELECT s.tenant_id INTO v_tenant
      FROM public.subscriptions s
     WHERE s.provider_customer_id = p_customer_id
       AND (p_environment IS NULL OR s.environment = p_environment)
     ORDER BY s.updated_at DESC
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;

    -- (e) zamowienie po identyfikatorze klienta
    SELECT o.tenant_id INTO v_tenant
      FROM public.payment_orders o
     WHERE o.provider_customer_id = p_customer_id
       AND (p_environment IS NULL OR o.environment = p_environment)
     ORDER BY o.created_at DESC
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;
  END IF;

  -- (f) e-mail platnika z ladunku. Stripe umieszcza go w czterech roznych
  -- miejscach zaleznie od typu obiektu - sprawdzamy wszystkie cztery.
  v_email := NULLIF(btrim(COALESCE(
    p_payload #>> '{data,object,customer_details,email}',
    p_payload #>> '{data,object,customer_email}',
    p_payload #>> '{data,object,receipt_email}',
    p_payload #>> '{data,object,billing_details,email}',
    ''
  )), '');

  IF v_email IS NOT NULL THEN
    -- UWAGA: `email_resolve_tenant_for_address` NIGDY nie zwraca NULL - gdy nie
    -- rozstrzygnie, oddaje najemce domyslnego. Taki wynik traktujemy jak BRAK
    -- wskazowki, bo inaczej domkniecie wiersza przez UPDATE zrzucaloby poprawnie
    -- zwiazany wiersz z powrotem do puli domyslnej.
    v_default := public.email_default_tenant_id();
    v_tenant := public.email_resolve_tenant_for_address(v_email);
    IF v_tenant IS DISTINCT FROM v_default THEN RETURN v_tenant; END IF;
  END IF;

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.payment_webhook_event_tenant(uuid, text, text, text, jsonb) IS
  'Najemca wiersza dziennika webhookow, kaskada nosnikow tozsamosci: profil -> subskrypcja -> zamowienie -> e-mail z ladunku. NULL, gdy zaden nosnik nie rozstrzyga.';

REVOKE ALL ON FUNCTION public.payment_webhook_event_tenant(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_webhook_event_tenant(uuid, text, text, text, jsonb)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Trigger wiazacy - ta sama kaskada, szerszy zestaw kolumn wyzwalajacych.
--
-- `UPDATE OF user_id, customer_id, subscription_id`: samo `user_id` nie
-- wystarczalo, bo `finishWebhookEvent` domyka wiersz dopisujac `subscription_id`
-- i to zwykle jest PIERWSZY moment, w ktorym tozsamosc platnika w ogole daje
-- sie ustalic.
--
-- COALESCE(kaskada, NEW.tenant_id, default): gdy kaskada milczy, zostawiamy
-- wartosc, ktora wiersz juz ma. Przy INSERT jest to DEFAULT kolumny
-- (`email_default_tenant_id()`), przy UPDATE - dotychczasowe wiazanie, ktorego
-- domkniecie zdarzenia nie ma prawa zepsuc.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_payment_webhook_events_bind_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
BEGIN
  NEW.tenant_id := COALESCE(
    public.payment_webhook_event_tenant(
      NEW.user_id,
      NEW.customer_id,
      NEW.subscription_id,
      NEW.environment,
      NEW.payload
    ),
    NEW.tenant_id,
    public.email_default_tenant_id()
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS payment_webhook_events_bind_tenant ON public.payment_webhook_events;
CREATE TRIGGER payment_webhook_events_bind_tenant
  BEFORE INSERT OR UPDATE OF user_id, customer_id, subscription_id
  ON public.payment_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_webhook_events_bind_tenant();

-- ----------------------------------------------------------------------------
-- 3. Backfill wierszy stojacych dzis w puli domyslnej.
--
-- Zakres celowo zawezony do `tenant_id = email_default_tenant_id()`: wiersz,
-- ktory stoi gdzie indziej, zostal juz kiedys rozstrzygniety mocniejszym
-- nosnikiem i nie ma powodu go ruszac.
--
-- CO Z WIERSZAMI, KTORYCH KASKADA NIE ROZSTRZYGNIE: zostaja w najemcy
-- domyslnym. Sa to zdarzenia bez `user_id`, bez rozpoznanego klienta i bez
-- subskrypcji po naszej stronie oraz bez e-maila w ladunku - w praktyce
-- zdarzenia operatora niezwiazane z zadna nasza platnoscia (`ping`, zmiany
-- katalogu cen) i szczatki z czasow, gdy ladunek nie byl zapisywany w calosci.
-- Widzi je super admin najemcy domyslnego i JEST TO SWIADOMA DECYZJA, nie
-- przeoczenie: to jedyna pozostala plaszczyzna "ponad obszarami" w tym module i
-- ma byc nazwana wprost, a nie wynikac z braku filtra. Backfill jest
-- jednorazowy, ale trigger dopisze najemce przy kazdym pozniejszym domknieciu
-- wiersza, wiec pula moze sie jeszcze skurczyc sama.
--
-- Ten UPDATE nie zmienia kolumn wyzwalajacych trigger, wiec kaskada nie
-- wykonuje sie tu po raz drugi.
-- ----------------------------------------------------------------------------
WITH resolved AS (
  SELECT
    e.id,
    public.payment_webhook_event_tenant(
      e.user_id, e.customer_id, e.subscription_id, e.environment, e.payload
    ) AS tenant_id
  FROM public.payment_webhook_events e
  WHERE e.tenant_id = public.email_default_tenant_id()
)
UPDATE public.payment_webhook_events e
   SET tenant_id = r.tenant_id
  FROM resolved r
 WHERE r.id = e.id
   AND r.tenant_id IS NOT NULL
   AND r.tenant_id IS DISTINCT FROM e.tenant_id;

-- ----------------------------------------------------------------------------
-- 4. Zdrowie webhookow platnosci - ZAWEZONE DO NAJEMCY WOLAJACEGO.
--
-- Poprzednia wersja (20260828063423) autoryzowala po `has_role()`, czyli po
-- tenancie DOMOWYM wolajacego, ale liczyla po CALEJ tabeli. `recent_failures`
-- oddawalo do przegladarki `id`, `event_type` i tresc bledu zdarzen kazdego
-- innego obszaru roboczego - i te `id` byly gotowym wejsciem dla server fn
-- `readWebhookEventPayload` / `retryWebhookEvent`, ktore czytaly wiersz po
-- samym identyfikatorze. Autoryzacja i zakres danych musza stac na tej samej
-- plaszczyznie: rola w tenancie X uprawnia do danych tenanta X.
--
-- KSZTALT WYNIKU JEST NIETKNIETY - panel `WebhookHealthPanel` konsumuje te same
-- klucze. Zmienia sie wylacznie ZAKRES liczenia.
--
-- Brak rozwiazanego najemcy to ODMOWA, nie zgoda na wszystko: `current_tenant_id()`
-- zwraca NULL dla konta bez profilu, a `w.tenant_id = NULL` przepuscilby wtedy
-- zero wierszy po cichu, udajac zdrowa instalacje bez ruchu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_payment_webhook_health(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_env text := COALESCE(NULLIF(p_payload->>'environment',''), 'live');
  v_hours integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'since_hours','')::integer, 168), 1), 8760);
  v_since timestamptz;
  v_total integer := 0;
  v_failed integer := 0;
  v_processed integer := 0;
  v_skipped integer := 0;
  v_pending integer := 0;
  v_retries integer := 0;
  v_avg numeric;
  v_p95 numeric;
  v_lag numeric;
  v_types jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: brak kontekstu najemcy';
  END IF;
  IF v_env NOT IN ('sandbox','live') THEN
    RAISE EXCEPTION 'invalid_payload: environment must be sandbox or live';
  END IF;
  v_since := now() - make_interval(hours => v_hours);

  SELECT
    count(*)::int,
    count(*) FILTER (WHERE w.status = 'failed')::int,
    count(*) FILTER (WHERE w.status = 'processed')::int,
    count(*) FILTER (WHERE w.status = 'skipped')::int,
    count(*) FILTER (WHERE w.status NOT IN ('failed','processed','skipped'))::int,
    COALESCE(sum(GREATEST(COALESCE(w.retry_count,0),0)),0)::int,
    round(avg(w.duration_ms)::numeric, 1),
    round((percentile_disc(0.95) WITHIN GROUP (ORDER BY w.duration_ms))::numeric, 1),
    round(avg(EXTRACT(EPOCH FROM (COALESCE(w.processed_at, w.created_at) - w.occurred_at)))::numeric, 2)
  INTO v_total, v_failed, v_processed, v_skipped, v_pending, v_retries, v_avg, v_p95, v_lag
  FROM public.payment_webhook_events w
  WHERE w.environment = v_env AND w.occurred_at >= v_since AND w.tenant_id = v_tenant;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.total DESC), '[]'::jsonb)
    INTO v_types
  FROM (
    SELECT w.event_type,
           count(*)::int AS total,
           count(*) FILTER (WHERE w.status = 'failed')::int AS failed,
           round(avg(w.duration_ms)::numeric, 1) AS avg_duration_ms
    FROM public.payment_webhook_events w
    WHERE w.environment = v_env AND w.occurred_at >= v_since AND w.tenant_id = v_tenant
    GROUP BY w.event_type
    ORDER BY count(*) DESC
    LIMIT 25
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(f)::jsonb ORDER BY f.occurred_at DESC), '[]'::jsonb)
    INTO v_recent
  FROM (
    SELECT w.id, w.event_type, w.status, w.error, w.occurred_at, w.retry_count
    FROM public.payment_webhook_events w
    WHERE w.environment = v_env AND w.occurred_at >= v_since AND w.status = 'failed'
      AND w.tenant_id = v_tenant
    ORDER BY w.occurred_at DESC
    LIMIT 20
  ) f;

  RETURN jsonb_build_object(
    'environment', v_env,
    'since', v_since,
    'total', v_total,
    'processed', v_processed,
    'skipped', v_skipped,
    'failed', v_failed,
    'pending', v_pending,
    'retries', v_retries,
    'failure_rate', CASE WHEN v_total > 0 THEN round(v_failed::numeric / v_total, 4) ELSE 0 END,
    'avg_duration_ms', v_avg,
    'p95_duration_ms', v_p95,
    'avg_lag_seconds', v_lag,
    'by_type', v_types,
    'recent_failures', v_recent
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_payment_webhook_health(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_webhook_health(jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Sprostowanie komentarza schematu.
--
-- `COMMENT ON COLUMN` z migracji 20260831060000 twierdzil, ze polityka odczytu
-- tej tabeli stoi przy samym `is_super_admin()` BEZ predykatu najemcy i ze
-- "granica obszaru roboczego nie zalezy od tej tabeli". Oba zdania sa
-- nieprawdziwe: tamta migracja nie zawiera dla tej tabeli ZADNEGO
-- `CREATE POLICY`, wiec obowiazuje definicja z 20260824080046, ktora predykat
-- najemcy MA. Falszywy komentarz w schemacie jest grozniejszy od braku
-- komentarza, bo uspokaja kazdy kolejny przeglad.
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN public.payment_webhook_events.tenant_id IS
  'Obszar roboczy zdarzenia (NOT NULL). JEST predykatem polityki RLS "payment_webhook_events admin read" (tenant_id = current_tenant_id() AND is_super_admin()). Klient service_role omija RLS, wiec KAZDE zapytanie spod service_role musi filtrowac po tej kolumnie JAWNIE - polityki nie zobaczy. Wartosc nadaje trigger payment_webhook_events_bind_tenant kaskada nosnikow tozsamosci; wiersze nierozstrzygniete zostaja w najemcy domyslnym.';
