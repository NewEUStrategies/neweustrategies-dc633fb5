-- ============================================================================
-- REJESTR ZGÓD RODO: SYGNAŁ GLOBAL PRIVACY CONTROL + STEMPEL TENANTA.
--
-- PRZYCZYNA ŹRÓDŁOWA (audyt "Zgody / prywatność", punkt otwarty od wydania
-- 2026-07-30 do 2026-08-03: „Brak GPC / »do not sell« - zero wystąpień
-- `Sec-GPC`"). Rejestr `user_consents` / `user_consent_events` zapisywał
-- IP, User-Agent, wersję treści, język i źródło decyzji - czyli WSZYSTKO poza
-- jedną informacją, bez której audytu nie da się rozstrzygnąć: czy w momencie
-- decyzji przeglądarka wysyłała ogólny sygnał sprzeciwu. Bez tej kolumny wpis
-- „zgoda udzielona" jest nieodróżnialny od „zgoda udzielona wbrew sygnałowi
-- opt-outu", a to dwie różne sytuacje prawne (art. 7 ust. 3 i art. 21 RODO,
-- CPRA §1798.135(b)).
--
-- CO ROBI TA MIGRACJA:
--
--   1) `gpc boolean NOT NULL DEFAULT false` na obu tabelach rejestru. Stan
--      sygnału w momencie decyzji. Historyczne wiersze dostają `false` - i to
--      jest prawda o nich: sprzed wdrożenia obsługi sygnału nie mieliśmy go
--      skąd odczytać.
--
--   2) `tenant_id uuid DEFAULT public.current_tenant_id()` na obu tabelach.
--      Zgoda jest per-osoba, ale ADMINISTRATOREM danych jest tenant - bez
--      stempla nie da się wykonać ani eksportu rejestru dla jednego
--      administratora, ani retencji per tenant. Kolumna jest NULLABLE, bo
--      wiersze historyczne nie mają skąd wziąć tenanta, a wsteczne przypisanie
--      byłoby zmyślaniem dowodu audytowego.
--
--      ŚWIADOMY ZAKRES RLS: polityki NIE są rozszerzane. Rejestr pozostaje
--      widoczny WYŁĄCZNIE dla właściciela wiersza (`auth.uid() = user_id`) -
--      stempel tenanta jest dla ścieżek service_role (eksport/retencja), a nie
--      furtką dla adminów tenanta do zgód innych osób. Dodanie kolumny nie
--      poszerza ani o milimetr powierzchni odczytu.
--
--   3) `set_user_consent(...)` w nowej sygnaturze z WYMAGANYM `p_gpc`. Sygnał
--      prawny nie może mieć cichego defaultu - pominięcie parametru to błąd
--      wołającego, nie „brak sygnału".
--
--      DLACZEGO STARA SYGNATURA ZOSTAJE (jako cienki shim, nie duplikat logiki):
--      * rolling deploy - migracja wchodzi przed nowym bundlem, a stary bundle
--        woła jeszcze wariant 7-argumentowy; DROP zrobiłby z tego okna 500-kę,
--      * jednoznaczność PostgREST - to jest powód, dla którego `p_gpc` NIE MA
--        defaultu i NIE JEST parametrem końcowym. Gdyby miał default, wywołanie
--        bez `p_gpc` pasowałoby do OBU funkcji i PostgREST zwróciłby PGRST203
--        (Multiple Choices). Bez defaultu zbiory wymaganych argumentów są
--        rozłączne, więc każde wywołanie ma dokładnie jednego kandydata.
--
--   4) Indeks częściowy na zdarzeniach z aktywnym sygnałem - zapytanie audytowe
--      „pokaż decyzje podjęte przy aktywnym GPC" nie skanuje całej historii.
--
--   5) ZAMKNIĘCIE ŚCIEŻKI ZAPISU do rejestru (granty + polityki INSERT/UPDATE/
--      DELETE dla roli klienckiej). Bez tego nowa kolumna byłaby ozdobą: klient
--      mógł dotąd pisać do rejestru wprost przez PostgREST, a więc podać własne
--      `gpc = false`, własne `ip`/`user_agent` i zmienić stan bez wpisu w
--      audit-logu. Szczegóły i dowód bezpieczeństwa zmiany - w sekcji 4.
--
-- Wszystko idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Kolumny: sygnał GPC + stempel tenanta.
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_consents
  ADD COLUMN IF NOT EXISTS gpc boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT public.current_tenant_id();

ALTER TABLE public.user_consent_events
  ADD COLUMN IF NOT EXISTS gpc boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT public.current_tenant_id();

COMMENT ON COLUMN public.user_consents.gpc IS
  'Czy w momencie ostatniej decyzji aktywny byl sygnal Global Privacy Control (Sec-GPC / navigator.globalPrivacyControl).';
COMMENT ON COLUMN public.user_consent_events.gpc IS
  'Czy w momencie tego zdarzenia aktywny byl sygnal Global Privacy Control. Zgoda z gpc = true zostala udzielona jako swiadomy override sygnalu.';
COMMENT ON COLUMN public.user_consents.tenant_id IS
  'Administrator danych, w ktorego obszarze podjeto decyzje. NULL = wiersz sprzed wdrozenia stempla. RLS pozostaje user-scoped.';
COMMENT ON COLUMN public.user_consent_events.tenant_id IS
  'Administrator danych, w ktorego obszarze podjeto decyzje. NULL = wiersz sprzed wdrozenia stempla. RLS pozostaje user-scoped.';

-- FK dopinany osobno: ADD COLUMN IF NOT EXISTS nie jest idempotentne razem
-- z inline REFERENCES przy powtórnym przebiegu migracji.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_consents_tenant_id_fkey'
      AND conrelid = 'public.user_consents'::regclass
  ) THEN
    ALTER TABLE public.user_consents
      ADD CONSTRAINT user_consents_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_consent_events_tenant_id_fkey'
      AND conrelid = 'public.user_consent_events'::regclass
  ) THEN
    ALTER TABLE public.user_consent_events
      ADD CONSTRAINT user_consent_events_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Audyt „decyzje podjęte przy aktywnym sygnale" bez skanu całej historii.
CREATE INDEX IF NOT EXISTS user_consent_events_gpc_idx
  ON public.user_consent_events (tenant_id, created_at DESC)
  WHERE gpc;

-- ----------------------------------------------------------------------------
-- 2) set_user_consent - nowa sygnatura z wymaganym p_gpc.
--
-- `p_gpc` stoi na POZYCJI CZWARTEJ (przed parametrami z defaultami), bo Postgres
-- nie pozwala, by argument bez defaultu następował po argumentach z defaultem.
-- Wołający używa argumentów NAZWANYCH (PostgREST), więc kolejność jest wyłącznie
-- ograniczeniem składni, nie kontraktem.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_consent(
  p_key text,
  p_given boolean,
  p_version text,
  p_gpc boolean,
  p_lang text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_source text DEFAULT NULL
)
RETURNS public.user_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_gpc boolean := COALESCE(p_gpc, false);
  v_row public.user_consents;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_key IS NULL OR length(p_key) = 0 THEN
    RAISE EXCEPTION 'invalid_key';
  END IF;
  IF p_version IS NULL OR length(p_version) = 0 THEN
    RAISE EXCEPTION 'invalid_version';
  END IF;

  INSERT INTO public.user_consents AS uc
    (user_id, tenant_id, consent_key, given, version, lang, ip, user_agent, gpc,
     given_at, withdrawn_at)
  VALUES
    (v_uid, v_tenant, p_key, p_given, p_version, p_lang, p_ip, p_user_agent, v_gpc,
     CASE WHEN p_given THEN now() ELSE NULL END,
     CASE WHEN p_given THEN NULL ELSE now() END)
  ON CONFLICT (user_id, consent_key) DO UPDATE
    SET given = EXCLUDED.given,
        version = EXCLUDED.version,
        lang = COALESCE(EXCLUDED.lang, uc.lang),
        ip = EXCLUDED.ip,
        user_agent = EXCLUDED.user_agent,
        gpc = EXCLUDED.gpc,
        -- Stempel tenanta uzupełniamy, ale nie przepisujemy: wiersz założony w
        -- obszarze administratora A nie może po cichu zmienić właściciela
        -- ewidencji, gdy ta sama osoba kliknie w obszarze B.
        tenant_id = COALESCE(uc.tenant_id, EXCLUDED.tenant_id),
        given_at = CASE WHEN EXCLUDED.given THEN now() ELSE uc.given_at END,
        withdrawn_at = CASE WHEN EXCLUDED.given THEN NULL ELSE now() END
  RETURNING * INTO v_row;

  INSERT INTO public.user_consent_events
    (user_id, tenant_id, consent_key, given, version, lang, ip, user_agent, source, gpc)
  VALUES
    (v_uid, v_tenant, p_key, p_given, p_version, p_lang, p_ip, p_user_agent, p_source, v_gpc);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_consent(text, boolean, text, boolean, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, boolean, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, boolean, text, text, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) Stara sygnatura 7-argumentowa -> cienki shim, zero duplikacji logiki.
--
-- Istnieje wyłącznie dla okna rolling deployu (stary bundle woła jeszcze ten
-- wariant). Deleguje z `p_gpc => false`, bo bundle, który nie zna kolumny, nie
-- ma jak zaraportować sygnału - a `false` to prawda o TYM wywołaniu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_consent(
  p_key text,
  p_given boolean,
  p_version text,
  p_lang text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_source text DEFAULT NULL
)
RETURNS public.user_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Osiem argumentów NAZWANYCH - dopasowuje się wyłącznie do nowej sygnatury,
  -- więc shim nie może zapętlić się na sobie.
  RETURN public.set_user_consent(
    p_key => p_key,
    p_given => p_given,
    p_version => p_version,
    p_gpc => false,
    p_lang => p_lang,
    p_ip => p_ip,
    p_user_agent => p_user_agent,
    p_source => p_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_consent(text, boolean, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_user_consent(text, boolean, text, text, text, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4) ZAMKNIĘCIE ŚCIEŻKI ZAPISU: rejestr pisze WYŁĄCZNIE set_user_consent.
--
-- Bez tego kroku nowa kolumna `gpc` byłaby ozdobą. Do tej pory rola
-- `authenticated` miała na `user_consents` grant INSERT/UPDATE/DELETE i
-- permisywne polityki own-row, a na `user_consent_events` grant INSERT z
-- polityką own-row. Znaczyło to, że klient (albo cudzy skrypt wykonany w jego
-- karcie) mógł przez PostgREST:
--   * wpisać sobie zgodę z `gpc = false`, obchodząc sygnał opt-outu,
--   * podać dowolne `ip` / `user_agent` - metadane, których cała wartość polega
--     na tym, że czyta je SERWER,
--   * zmienić stan w `user_consents` BEZ wpisu w `user_consent_events`, czyli
--     bez śladu w „niezmiennym audit-logu",
--   * dopisać do audit-logu zdarzenie, które nigdy się nie stało,
--   * a po dodaniu `tenant_id` - podstawić OBCY tenant i zaśmiecić ewidencję
--     innego administratora danych.
--
-- Atomowość „upsert stanu + wpis zdarzenia" gwarantuje tylko RPC, więc każda
-- inna ścieżka zapisu jest z definicji sposobem na rozspójnienie rejestru.
-- Zdejmujemy obie warstwy (granty I polityki), bo każda z nich osobno wystarcza
-- do zablokowania - i dzięki temu żadne przyszłe przywrócenie jednej z nich nie
-- otwiera dziury po cichu. SELECT zostaje nietknięty: użytkownik musi widzieć
-- swoje zgody i swoją historię.
--
-- Ta zmiana jest bezpieczna, bo w kodzie NIE MA klienta piszącego wprost do tych
-- tabel - `consents.functions.ts` czyta (SELECT), a pisze przez RPC.
-- SECURITY DEFINER `set_user_consent` działa jako właściciel tabeli, więc ani
-- granty roli klienckiej, ani polityki RLS go nie dotyczą.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "user_consents_insert_own" ON public.user_consents;
DROP POLICY IF EXISTS "user_consents_update_own" ON public.user_consents;
DROP POLICY IF EXISTS "user_consents_delete_own" ON public.user_consents;
DROP POLICY IF EXISTS "user_consent_events_insert_own" ON public.user_consent_events;

REVOKE INSERT, UPDATE, DELETE ON public.user_consents FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_consent_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_consents FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.user_consent_events FROM anon;
