-- ============================================================================
-- NAPRAWA: emit_domain_event miał DWA przeciążenia i przestał się rozstrzygać
--
-- OBJAW. W logu pgTAP:
--
--   WARNING: tracker: update fan-out failed:
--            function public.emit_domain_event(uuid, unknown, text, unknown, jsonb)
--            is not unique
--
-- i trzynaście czerwonych asercji w missing_event_notifications_test, dwie
-- w network_event_notifications_test, kolejne w innych plikach. Wszystkie
-- mówią to samo: zdarzenie miało powstać, nie powstało.
--
-- PRZYCZYNA - moja, z migracji 20260808140000 (A12, szwy międzymodułowe).
-- Historia sygnatur:
--
--   2026-07-11  emit_domain_event(uuid, text, text, text, jsonb)            [5 arg]
--   2026-07-23  DROP tej piątki, w zamian
--               emit_domain_event(uuid, text, text, text, jsonb, uuid)      [6 arg]
--               - komentarz tamtej migracji mówi wprost: "dwa przeciążenia
--                 = niejednoznaczność", więc starą usunięto CELOWO.
--   2026-08-08  A12 dodaje
--               emit_domain_event(uuid, text, text, text, jsonb, boolean)   [6 arg]
--               i zdejmuje... piątkę, której od lipca już nie było.
--
-- Skutek: w bazie stanęły DWA warianty sześcioargumentowe, oba z domyślnym
-- argumentem szóstym. Każde z 82 wywołań w kodzie podaje pięć argumentów, więc
-- każde pasuje do obu - Postgres odmawia rozstrzygnięcia błędem 42725.
--
-- Dlaczego nikt tego nie zobaczył od razu: emitery wołają emiter w bloku
-- z własnym EXCEPTION (fan-out ma nie wywracać transakcji biznesowej), więc
-- błąd rozstrzygania zamieniał się w ostrzeżenie w logu, a zdarzenia po prostu
-- PRZESTAWAŁY powstawać. Awaria bez wyjątku jest najdroższym rodzajem awarii:
-- produkt działa, a szyna zdarzeń jest pusta.
--
-- ROZWIĄZANIE. Jedna funkcja, oba opcjonalne parametry. Przy jednej funkcji
-- o danej nazwie żadna liczba argumentów nie jest niejednoznaczna - i to jest
-- właściwość, którą chcemy utrzymać, a nie kolejne przeciążenie z lepszym
-- komentarzem.
--
-- Kolejność aktora zostaje taka, jak ustaliła migracja lipcowa:
-- COALESCE(p_actor_id, auth.uid()). p_suppress_actor bije jedno i drugie, bo
-- tam, gdzie sam fakt "kto to zrobił" jest chroniony (tryb chatham, wpis
-- anonimowy), nie ma aktora, którego wolno by podstawić.
-- ============================================================================

-- Nowa sygnatura powstaje PRZED zdjęciem starych: gdyby migracja przerwała się
-- w środku, baza zostaje z funkcją, która działa, a nie bez żadnej.
-- KOLEJNOSC PARAMETROW JEST WYMUSZONA, nie estetyczna.
--
-- Szesc triggerow z A12 wola emiter z szescioma argumentami POZYCYJNIE, gdzie
-- szosty jest booleanem (`v_ctx.hide_actor`). Gdyby na szostej pozycji stal
-- `p_actor_id uuid`, te wywolania przestalyby sie wiazac - zamienilbym jedna
-- awarie na druga. Dlatego `p_suppress_actor` zostaje szosty, a `p_actor_id`
-- schodzi na siodma pozycje.
--
-- Nic nie traci: w calym repozytorium NIE MA wywolania, ktore podaje aktora
-- pozycyjnie (sprawdzone na 82 wywolaniach). Gdyby ktos takie napisal, boolean
-- na szostej pozycji odrzuci uuid bledem typu - glosno, a nie po cichu.
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid,
  p_aggregate_type text,
  p_aggregate_id text,
  p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  -- true = wiersz powstaje BEZ aktora, nawet gdy sesja go zna.
  p_suppress_actor boolean DEFAULT false,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_aggregate_type IS NULL OR p_aggregate_id IS NULL
     OR p_event_type IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.domain_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload,
    correlation_id, actor_id
  ) VALUES (
    p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type,
    COALESCE(p_payload, '{}'::jsonb),
    public.request_correlation_id(),
    CASE WHEN p_suppress_actor THEN NULL ELSE COALESCE(p_actor_id, auth.uid()) END
  )
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  -- Fan-out nie wywraca transakcji biznesowej. To jest celowe i to samo
  -- zachowanie zamaskowało niejednoznaczność na trzy dni - stąd asercje
  -- w harnessie, które sprawdzają LICZBĘ przeciążeń, a nie tylko efekt.
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.emit_domain_event(uuid, text, text, text, jsonb, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.emit_domain_event(uuid, text, text, text, jsonb, boolean, uuid)
  TO service_role;

-- Oba warianty sześcioargumentowe znikają. Ciała plpgsql rozwiązują nazwy
-- funkcji przy WYWOŁANIU, więc trzydzieści triggerów, które wołają emiter,
-- przechodzi na nową sygnaturę bez rekompilacji i bez zależności do zerwania.
DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb, boolean);
-- Dla porządku: piątki nie ma od lipca, ale DROP IF EXISTS na świeżej bazie
-- kosztuje zero i domyka stan końcowy do dokładnie jednej funkcji tej nazwy.
DROP FUNCTION IF EXISTS public.emit_domain_event(uuid, text, text, text, jsonb);

COMMENT ON FUNCTION
  public.emit_domain_event(uuid, text, text, text, jsonb, boolean, uuid) IS
  'JEDYNY emiter szyny zdarzeń - jedna funkcja, dwa opcjonalne parametry. Przeciążenie tej nazwy jest awarią: wszystkie wywołania podają pięć argumentów, więc drugi wariant z domyślnym szóstym czyni każde z nich niejednoznacznym (42725), a własny EXCEPTION emiterów zamienia to w ciszę zamiast w błąd.';
