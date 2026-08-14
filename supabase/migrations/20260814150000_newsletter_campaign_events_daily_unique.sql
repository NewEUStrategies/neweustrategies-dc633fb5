-- Otwarcia i kliknięcia newslettera: JEDEN wiersz na (kampania, subskrybent,
-- rodzaj, dobę UTC) - i JEDNO źródło zapisu.
--
-- STAN ZASTANY (zmierzony, szóste zgłoszenie tej samej usterki): tabela
-- `newsletter_campaign_events` nie miała ANI JEDNEGO indeksu unikalnego -
-- istniały wyłącznie `(campaign_id, kind)` i `(tenant_id, created_at DESC)`,
-- oba zwykłe. Do tej tabeli pisały RÓWNOLEGLE dwa niezależne producenty:
--
--   1. tracking własny - piksel `/api/public/nl-open` i przekierowanie
--      `/api/public/nl-click` (token HMAC per kampania+subskrybent),
--   2. webhook dostarczalności Resend - `email.opened` / `email.clicked`.
--
-- Oba mierzą DOKŁADNIE TO SAMO zdarzenie tym samym mechanizmem (piksel obrazka,
-- przepisany link), więc każde otwarcie liczyło się dwa razy. Do tego klient
-- pocztowy potrafi pobrać piksel wielokrotnie (podgląd, przewijanie, proxy
-- prywatności), a każde pobranie było osobnym wierszem. Skutek: `opens` rośnie
-- ponad liczbę dostarczonych maili, a panel kampanii pokazuje wskaźnik otwarć
-- POWYŻEJ 100% - liczba, która nie może być prawdziwa, więc unieważnia cały
-- kafelek zaangażowania. Ta sama inflacja szła dalej: trigger
-- `trg_score_on_campaign_event` przelicza scoring leada z LICZBY zdarzeń, więc
-- podwójny zapis zawyżał też ocenę kontaktu w CRM.
--
-- ROZSTRZYGNIĘCIE - dwie warstwy, obie konieczne:
--
--   A) TWARDY INWARIANT W BAZIE (ta migracja): unikalny indeks częściowy na
--      (campaign_id, subscriber_id, kind, doba UTC). Doba, nie znacznik czasu,
--      bo zdarzeniem biznesowym jest „ten odbiorca otworzył tę kampanię tego
--      dnia" - drugie otwarcie tej samej doby nie niesie nowej informacji, a
--      otwarcie nazajutrz owszem (ślad powracającego czytelnika). Baza jest
--      ostatnią linią obrony: żaden przyszły producent - nowy dostawca poczty,
--      retry webhooka, ponowne wywołanie routingu - nie policzy zdarzenia
--      drugi raz, nawet jeśli warstwa aplikacji o inwariancie zapomni.
--
--   B) JEDNO ŹRÓDŁO ZAPISU (warstwa aplikacji, src/lib/newsletter/
--      engagementSource.ts): domyślnie pisze WYŁĄCZNIE tracking własny, a
--      ścieżka webhooka zapisuje tylko wtedy, gdy operator jawnie uczyni ją
--      źródłem prawdy. Sam indeks by nie wystarczył: bez wyłączenia jednego
--      producenta dwa źródła nadal ścigałyby się o ten sam wiersz, a `ON
--      CONFLICT DO NOTHING` zamieniałby wyścig w cichy, nieobserwowalny szum.
--
-- CZĘŚCIOWY, bo `subscriber_id` jest nullowalne, a NULL-e w indeksie unikalnym
-- są ROZŁĄCZNE - wiersz bez subskrybenta nie dałby się odsiać i inflacja
-- wróciłaby tylnymi drzwiami. Dlatego indeks obejmuje wyłącznie zdarzenia
-- PRZYPISANE, a zapis nieprzypisany jest odrzucany już w RPC (poniżej): takie
-- zdarzenie i tak nie niesie informacji analitycznej, bo nie wiadomo, kto je
-- wywołał. Predykat załatwia też klucz obcy `ON DELETE SET NULL`: kasacja
-- subskrybenta zeruje kolumnę i wiersze WYCHODZĄ z indeksu, zamiast zderzać
-- się ze sobą na wspólnym NULL-u.

-- ---------------------------------------------------------------------------
-- 1) Odkażenie danych zastanych - bez tego CREATE UNIQUE INDEX pada na 23505
-- ---------------------------------------------------------------------------
-- Zostawiamy NAJWCZEŚNIEJSZE zdarzenie w każdej dobie: to ono jest pierwszym
-- realnym śladem odbiorcy, a duplikaty po nim to echo pikseli i webhooka.
--
-- SCORING LEADA PRZELICZAMY TU, NIE „KIEDYŚ". `trg_score_on_campaign_event`
-- jest AFTER INSERT, więc kasowanie duplikatów go NIE odpala, a
-- `crm_leads.score`, `score_band` i `score_breakdown` są ZMATERIALIZOWANE.
-- Zostawione samym sobie zostałyby zawyżone aż do następnego sygnału tego
-- leada - a lead nieaktywny nie wygeneruje go nigdy i tkwiłby w błędnym
-- pasmie („hot" zamiast „cool") bez końca, czyli dokładnie tam, gdzie
-- sprzedaż podejmuje decyzje. Dlatego zbieramy dotkniętych subskrybentów
-- z `RETURNING` i przeliczamy ICH leady od zera.
--
-- Idempotentnie: przy powtórnym przebiegu nie ma czego kasować, zbiór jest
-- pusty i nie przeliczamy niczego.
DO $$
DECLARE
  v_leads uuid[] := '{}';
  v_lead  uuid;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY campaign_id, subscriber_id, kind, (created_at AT TIME ZONE 'UTC')::date
        ORDER BY created_at, id
      ) AS rn
    FROM public.newsletter_campaign_events
    WHERE subscriber_id IS NOT NULL
  ),
  deleted AS (
    DELETE FROM public.newsletter_campaign_events e
    USING ranked r
    WHERE e.id = r.id
      AND r.rn > 1
    RETURNING e.subscriber_id
  )
  -- To samo wiązanie subskrybent -> lead, co w triggerze scoringu: tenant
  -- subskrybenta ORAZ znormalizowany e-mail. Bez tenanta w JOIN-ie ten sam
  -- adres w dwóch obszarach roboczych przeliczyłby cudzy wiersz.
  SELECT COALESCE(array_agg(DISTINCT cl.id), '{}'::uuid[])
    INTO v_leads
    FROM deleted d
    JOIN public.newsletter_subscribers ns ON ns.id = d.subscriber_id
    JOIN public.crm_leads cl
      ON cl.tenant_id = ns.tenant_id
     AND cl.email_norm = lower(ns.email);

  FOREACH v_lead IN ARRAY v_leads LOOP
    PERFORM public.compute_crm_lead_score(v_lead);
  END LOOP;

  IF array_length(v_leads, 1) IS NOT NULL THEN
    RAISE NOTICE 'newsletter_campaign_events: po deduplikacji przeliczono scoring % leadow',
      array_length(v_leads, 1);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Inwariant
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS nl_campaign_events_subscriber_day_uq
  ON public.newsletter_campaign_events (
    campaign_id,
    subscriber_id,
    kind,
    ((created_at AT TIME ZONE 'UTC')::date)
  )
  WHERE subscriber_id IS NOT NULL;

COMMENT ON INDEX public.nl_campaign_events_subscriber_day_uq IS
  'Jedno zdarzenie na (kampania, subskrybent, rodzaj, doba UTC). Zamyka podwojne zliczanie otwarc/klikniec z dwoch producentow (piksel/przekierowanie oraz webhook Resend) i wielokrotne pobranie piksela przez klienta pocztowego - to ono dawalo wskaznik otwarc powyzej 100%. Czesciowy, bo NULL-e w indeksie unikalnym sa rozlaczne: zdarzenia nieprzypisane odsiewa juz newsletter_record_campaign_event.';

COMMENT ON TABLE public.newsletter_campaign_events IS
  'Zdarzenia zaangazowania w kampanii (open/click), ZDEDUPLIKOWANE do jednego wiersza na (kampania, subskrybent, rodzaj, doba UTC) przez nl_campaign_events_subscriber_day_uq. Zapis wylacznie przez newsletter_record_campaign_event (service_role); odczyt stafowy w granicach tenanta. Licznik surowych wierszy jest wiec ZASIEGIEM DZIENNYM, nie liczba interakcji.';

-- ---------------------------------------------------------------------------
-- 3) Jedyna ścieżka zapisu: idempotentne RPC
-- ---------------------------------------------------------------------------
-- Dotąd zapis szedł z aplikacji trzema krokami (SELECT kampanii → SELECT
-- subskrybenta → INSERT). Trzy rundy do bazy na każdy piksel, a między drugą
-- a trzecią realne okno TOCTOU. Tu jest to jedna instrukcja: tenant bierze się
-- z kampanii (NIGDY z żądania), subskrybent musi należeć do TEGO SAMEGO
-- tenanta - inaczej zdarzenie jednego obszaru roboczego dałoby się przypisać
-- do subskrybenta innej firmy - a kolizja z inwariantem jest cichym „już
-- policzone", nie błędem.
--
-- `p_occurred_at` istnieje, bo kubełkiem jest DOBA, a producent nie zawsze pisze
-- w chwili zdarzenia. Webhook dostawcy potrafi dotrzeć z opóźnieniem albo poza
-- kolejnością: dwa otwarcia z tej samej doby dostarczone po dwóch stronach
-- północy policzyłyby się DWA razy, a dwa z różnych dób dostarczone razem -
-- zlały w jedno. Piksel własny podaje NULL (zdarzenie jest „teraz"), webhook
-- podaje zweryfikowany czas wystąpienia. Wartość z przyszłości ścinamy do
-- `now()` - żaden dostawca nie wie o zdarzeniu wcześniej, niż ono nastąpiło,
-- a przesunięty zegar po tamtej stronie nie ma prawa zakładać kubełków w
-- przyszłych dobach.

-- Wariant 4-argumentowy (bez czasu wystąpienia) NIE MOŻE zostać w bazie obok
-- nowego. `CREATE OR REPLACE` z dodatkowym argumentem tworzy PRZECIĄŻENIE, nie
-- zamiennik, a dwa przeciążenia oznaczają albo `PGRST203` z Data API, albo -
-- gorzej - ciche wywołanie wariantu, który ignoruje czas wystąpienia. DROP jest
-- bezpieczny w obie strony: na świeżej bazie nie ma czego kasować.
DROP FUNCTION IF EXISTS public.newsletter_record_campaign_event(uuid, uuid, text, text);

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
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_subscriber uuid;
  v_id uuid;
  v_at timestamptz := LEAST(COALESCE(p_occurred_at, now()), now());
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

  -- Granica obszaru roboczego: subskrybent obcego tenanta (albo skasowany)
  -- NIE tworzy zdarzenia. Zdarzenie nieprzypisane byłoby zresztą poza
  -- inwariantem unikalności, czyli dokładnie tym wektorem inflacji, który ta
  -- migracja zamyka.
  SELECT s.id INTO v_subscriber
    FROM public.newsletter_subscribers s
   WHERE s.id = p_subscriber
     AND s.tenant_id = v_tenant;

  IF v_subscriber IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'unknown_subscriber');
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
  'Jedyna sciezka zapisu zdarzen open/click. Tenant z kampanii (nigdy z zadania), subskrybent walidowany w tym samym tenancie, wstawienie idempotentne w dobie UTC (ON CONFLICT DO NOTHING na nl_campaign_events_subscriber_day_uq). p_occurred_at = czas WYSTAPIENIA (webhook moze dotrzec z opoznieniem lub poza kolejnoscia); NULL = teraz, wartosc z przyszlosci scinana do now(). Zwraca {recorded, duplicate, reason, event_id, tenant_id, event_day} - duplikat to normalny wynik, nie blad.';

REVOKE ALL ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Odczyt panelu: sumy ORAZ zasięg unikalny
-- ---------------------------------------------------------------------------
-- Panel liczył dotąd dwa `count(*)` przez PostgREST, więc nie miał jak podać
-- liczby RÓŻNYCH odbiorców - a to ona jest mianownikiem uczciwego wskaźnika
-- otwarć (zasięg / dostarczone) i to ona z definicji nie przekroczy 100%.
-- `COUNT(DISTINCT ...)` nie da się wyrazić w Data API, więc odczyt schodzi do
-- bazy, gdzie przy okazji odbywa się bramka roli i tenanta.
CREATE OR REPLACE FUNCTION public.newsletter_campaign_engagement(p_campaign uuid)
RETURNS TABLE (
  opens bigint,
  clicks bigint,
  unique_openers bigint,
  unique_clickers bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL
     OR v_tenant IS NULL
     OR NOT (
       public.has_role(v_uid, 'admin'::public.app_role)
       OR public.has_role(v_uid, 'editor'::public.app_role)
     )
  THEN
    RAISE EXCEPTION 'forbidden: staff role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE e.kind = 'open')::bigint,
    COUNT(*) FILTER (WHERE e.kind = 'click')::bigint,
    COUNT(DISTINCT e.subscriber_id) FILTER (WHERE e.kind = 'open')::bigint,
    COUNT(DISTINCT e.subscriber_id) FILTER (WHERE e.kind = 'click')::bigint
  FROM public.newsletter_campaign_events e
  JOIN public.newsletter_campaigns c ON c.id = e.campaign_id
  WHERE e.campaign_id = p_campaign
    AND e.tenant_id = v_tenant
    -- Podwójne wiązanie tenanta: wiersz zdarzenia ORAZ kampania. Rozjazd
    -- jednego z nich (dryf danych) nie może otworzyć okna na cudzy obszar.
    AND c.tenant_id = v_tenant;
END;
$$;

COMMENT ON FUNCTION public.newsletter_campaign_engagement(uuid) IS
  'Zaangazowanie kampanii dla panelu: sumy zdarzen i ZASIEG UNIKALNY (liczba roznych subskrybentow). Bramka: admin/editor w tenancie domowym (current_tenant_id), kampania i zdarzenia wiazane tym samym tenantem. Zasieg / dostarczone to wskaznik, ktory nie moze przekroczyc 100%.';

REVOKE ALL ON FUNCTION public.newsletter_campaign_engagement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.newsletter_campaign_engagement(uuid) TO authenticated, service_role;
