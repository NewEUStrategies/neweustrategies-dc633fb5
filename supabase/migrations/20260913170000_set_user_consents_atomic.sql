-- ============================================================================
-- ZGODY RODO: CAŁA DECYZJA UŻYTKOWNIKA ZAPISYWANA W JEDNEJ TRANSAKCJI
-- ============================================================================
--
-- PRZYCZYNA ŹRÓDŁOWA. `setMyConsentsBulk` (`src/lib/consents.functions.ts`)
-- dostaje JEDNĄ decyzję z banera - „odrzuć wszystko", „zapisz wybrane" - która
-- obejmuje kilka kategorii cookie naraz, i zapisywała ją PĘTLĄ po osobnych
-- wywołaniach `set_user_consent`. Każde takie wywołanie to własna transakcja,
-- więc `if (error) throw` przerywał pętlę w połowie, zostawiając wpisy
-- wcześniejsze ZATWIERDZONE. Atomowy był pojedynczy upsert plus jego zdarzenie
-- audytowe - nie decyzja użytkownika.
--
-- SKUTEK. Użytkownik klika „odrzuć wszystko", zapis przerywa się na trzeciej
-- z pięciu kategorii, a dwie pozostałe zostają WŁĄCZONE - trwale i bez żadnego
-- komunikatu. Ścieżka naprawcza tego nie łapie: `backfillRegistryOnLogin`
-- uzupełnia wyłącznie klucze NIEOBECNE w rejestrze, a kategoria z nieudanego
-- zapisu jest obecna, tyle że ze starą wartością. To jest dokładnie ta klasa
-- zdarzenia, którą RODO nazywa naruszeniem zapisu zgody.
--
-- ROZWIĄZANIE. Jedna funkcja przyjmująca CAŁĄ decyzję. Funkcja plpgsql wykonuje
-- się w jednej transakcji, więc `RAISE` na dowolnym elemencie wycofuje WSZYSTKIE
-- wcześniejsze - razem z ich wpisami w audycie. Wszystko albo nic.
--
-- DLACZEGO PĘTLA PO `set_user_consent`, A NIE PRZEPISANY UPSERT. Bo reguła
-- zapisu zgody ma mieć JEDNĄ definicję. Druga kopia upsertu plus wstawki do
-- `user_consent_events` rozjechałaby się z oryginałem przy pierwszej korekcie,
-- a rozjazd tutaj znaczy „część zgód zapisana według starej reguły". Wariant
-- pojedynczy ZOSTAJE dla ścieżek, które naprawdę zapisują jedną kategorię
-- (panel konta) - ta funkcja go woła, nie zastępuje.
--
-- DLACZEGO JSONB, A NIE TABLICE RÓWNOLEGŁE. Wpis zgody ma jedenaście pól,
-- z czego pięć opcjonalnych. Jedenaście tablic tej samej długości to kontrakt,
-- który psuje się po cichu przy pierwszym niedopasowaniu długości; jsonb niesie
-- wpis jako CAŁOŚĆ. Ten sam wybór i ten sam kształt co
-- `admin_event_sponsor_contacts_set(jsonb)` i `crm_import_leads(jsonb, text)`.

CREATE OR REPLACE FUNCTION public.set_user_consents(p_entries jsonb)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_entry jsonb;
  v_keys text[] := ARRAY[]::text[];
  v_count integer;
BEGIN
  -- Ta sama bramka i ten sam komunikat co w `set_user_consent`: funkcja jest
  -- SECURITY DEFINER, więc brak użytkownika musi być odmową, a nie zapisem
  -- „na nikogo".
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'invalid_entries';
  END IF;

  v_count := jsonb_array_length(p_entries);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'invalid_entries';
  END IF;
  -- Sufit odwzorowuje `SetConsentsBulkSchema` (`entries` min 1, max 10), czyli
  -- rozmiar katalogu kategorii z zapasem. Baza powtarza limit warstwy
  -- aplikacji, bo to ONA jest ostatnią linią - wywołanie RPC może przyjść
  -- z pominięciem walidatora Zod.
  IF v_count > 10 THEN
    RAISE EXCEPTION 'too_many_entries';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    -- Argumenty nazwane: kolejność jedenastu pozycyjnych parametrów jest
    -- dokładnie tym, co cicho rozjeżdża się przy następnej zmianie sygnatury.
    PERFORM public.set_user_consent(
      p_key            => v_entry ->> 'key',
      p_given          => (v_entry ->> 'given')::boolean,
      p_version        => v_entry ->> 'version',
      p_gpc            => COALESCE((v_entry ->> 'gpc')::boolean, false),
      p_lang           => v_entry ->> 'lang',
      p_ip             => v_entry ->> 'ip',
      p_user_agent     => v_entry ->> 'user_agent',
      p_source         => v_entry ->> 'source',
      p_banner_version => v_entry ->> 'banner_version',
      p_decision_id    => NULLIF(v_entry ->> 'decision_id', '')::uuid,
      p_page_url       => v_entry ->> 'page_url'
    );
    v_keys := v_keys || (v_entry ->> 'key');
  END LOOP;

  RETURN v_keys;
END;
$function$;

COMMENT ON FUNCTION public.set_user_consents(jsonb) IS
  'Zapisuje CAŁĄ decyzję zgód użytkownika w JEDNEJ transakcji: wszystko albo nic. Woła set_user_consent dla każdego elementu, więc reguła zapisu (upsert + zdarzenie audytowe) ma nadal jedną definicję. Zwraca klucze zapisane, w kolejności wejścia.';

-- Te same grantów co dla wariantu pojedynczego: `anon` nie zapisuje zgód
-- (zgoda jest zawsze czyjaś), `authenticated` woła przez server-fn.
REVOKE ALL ON FUNCTION public.set_user_consents(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_consents(jsonb) TO authenticated;
