-- Prośba o wprowadzenie: trzy brakujące bramki prywatności i deduplikacja,
-- która dotąd istniała wyłącznie w komentarzu i w kliencie.
--
-- ── 1. BRAMKI PRYWATNOŚCI ──────────────────────────────────────────────────
--
-- PRZYCZYNA ŹRÓDŁOWA. `request_introduction` z 20260718215718 sprawdzało tylko
-- kształt trójkąta (most jest moim kontaktem, most zna cel, ja celu nie znam)
-- oraz limit 5 oczekujących na dobę. Trzy bramki, które ma jego własny wzorzec
-- `connection_request` (20260717170000_connections_v2.sql:95-140), NIE ZOSTAŁY
-- przepisane:
--   bramka                                 connection_request   request_introduction
--   is_blocked_pair                        linia 102            BRAK
--   profiles.discoverable celu             linia 136            BRAK
--   connections_allowed_from(cel, ja)      linia 137            BRAK
--
-- DLACZEGO TO BLOKOWAŁO. Te trzy bramki to cała treść prywatności modułu.
-- Osoba, która mnie ZABLOKOWAŁA, która WYŁĄCZYŁA przyjmowanie zaproszeń, albo
-- która ZDJĘŁA `discoverable`, była osiągalna drogą wprowadzenia - i to nie
-- teoretycznie: przy statusie `forwarded` wyzwalacz `tg_introduction_notify`
-- (20260812101000_pgtap_cluster_c_fix.sql:125) wysyła jej powiadomienie.
-- Blokada nie blokowała, wyłączenie nie wyłączało. Nagłówek
-- `src/lib/network/useIntroductions.ts:7` deklarował przy tym wprost, że
-- "target musi zezwalać na komunikację (allowConnections)".
--
-- DLACZEGO JEDEN KOMUNIKAT DLA TRZECH ODMÓW. Tak samo, jak w
-- `connection_request`: rozróżnialne komunikaty zdradzają USTAWIENIE
-- PRYWATNOŚCI osobie, która nie ma prawa go znać ("zablokował mnie" kontra
-- "nie przyjmuje zaproszeń" kontra "ukrył profil" to trzy różne informacje
-- o kimś, kto właśnie odmówił kontaktu). Wprowadzenia POWTARZAJĄ to
-- zachowanie, zamiast wymyślać własne - stąd dosłownie ten sam tekst
-- 'connections: peer not available'.
--
-- CZEGO TU ŚWIADOMIE NIE MA: sprawdzenia najemcy. Izolacja jest zachowana
-- PRZECHODNIO i dokładanie jej zaciemniłoby funkcję, nic nie zmieniając: most
-- jest moim zaakceptowanym kontaktem, cel jest zaakceptowanym kontaktem mostu,
-- a oba wejścia do `user_connections` wymuszają równość najemcy
-- (`connection_request` w 20260717170000:109-111, `auto_connect_experts`
-- w 20260723133949:24 przez `pb.tenant_id = pa.tenant_id`), przy czym
-- `authenticated` nie ma na tej tabeli grantu zapisu.
--
-- ── 2. DEDUPLIKACJA ────────────────────────────────────────────────────────
--
-- PRZYCZYNA ŹRÓDŁOWA. `src/lib/network/useIntroductions.ts:8` obiecywał "jeden
-- aktywny request na trójkę (deduplikacja w bazie)". W bazie NIE BYŁO NICZEGO
-- TAKIEGO: tabela ma PRIMARY KEY, trzy CHECK i dwa zwykłe indeksy
-- (`idx_intro_bridge`, `idx_intro_requester`) - ani UNIQUE, ani indeksu
-- częściowego - a sama funkcja nie robiła SELECT-a sprawdzającego istniejący
-- wiersz. Jedyną ochroną było `usedBridges` liczone W KLIENCIE z propsa
-- `existing` (`RequestIntroductionDialog.tsx:54-63`), karmionego zapytaniem
-- o `staleTime: 15_000`. Dwie karty otwarte obok siebie albo jedno kliknięcie
-- w oknie nieodświeżonych 15 sekund i most dostawał tę samą prośbę drugi raz.
--
-- WZORZEC. `user_connections_pair_uidx` (20260723133949:2-3) to unikalny indeks
-- na uporządkowanej parze, a wołający obsługuje `unique_violation` w bloku
-- EXCEPTION (tamże, linia 34). Tu jest to samo, z indeksem CZĘŚCIOWYM: unikalna
-- jest trójka `(requester, bridge, target)` TYLKO w stanie `pending`, bo prośba
-- odrzucona, wycofana albo przekazana ma prawo zostać ponowiona.
--
-- DLACZEGO POWTÓRZENIE ZWRACA `id`, A NIE RZUCA WYJĄTKIEM. Powtórne kliknięcie
-- ma być BEZSZKODLIWE, a nie głośne: użytkownik nie zrobił nic złego, a jedyna
-- poprawna odpowiedź na "poproś o to samo drugi raz" to wskazanie prośby, która
-- już czeka. Wyjątek zmusiłby klienta do mapowania komunikatu na tekst, czyli
-- do rozróżniania stanu, który nie jest błędem.
--
-- DLACZEGO `EXCEPTION`, A NIE SAM `SELECT` PRZED `INSERT`. Wyścig dwóch kart
-- przechodzi między SELECT-em a INSERT-em; indeks jest jedynym miejscem, w
-- którym baza rozstrzyga to bez okna. `SELECT` przed wstawką zostaje mimo to
-- jako ścieżka zwykła (bez zużywania sekwencji i bez wchodzenia w blok
-- wyjątku), a `EXCEPTION` łapie wyłącznie przegraną w wyścigu.

-- Wiersze historyczne mogą łamać nowy warunek (dedup nigdy nie obowiązywał),
-- więc indeks powstaje bez przestoju i bez wywracania migracji na danych:
-- z każdej nadmiarowej trójki `pending` zostaje NAJSTARSZA prośba, reszta idzie
-- w `withdrawn`. Wycofanie, a nie skasowanie - wiersz jest korespondencją
-- między trzema osobami, a nie zapisem technicznym.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY requester_id, bridge_id, target_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM public.introduction_requests
   WHERE status = 'pending'
)
UPDATE public.introduction_requests i
   SET status = 'withdrawn', updated_at = now()
  FROM ranked r
 WHERE i.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS introduction_requests_active_uidx
  ON public.introduction_requests (requester_id, bridge_id, target_id)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.request_introduction(
  p_bridge UUID, p_target UUID, p_message TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant UUID; v_id UUID; v_target_discoverable BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public._are_connected(auth.uid(), p_bridge) THEN
    RAISE EXCEPTION 'not connected to bridge'; END IF;
  IF NOT public._are_connected(p_bridge, p_target) THEN
    RAISE EXCEPTION 'bridge not connected to target'; END IF;
  IF public._are_connected(auth.uid(), p_target) THEN
    RAISE EXCEPTION 'already connected to target'; END IF;

  -- Bramki prywatności celu. Jeden komunikat dla trzech powodów - patrz nagłówek.
  SELECT discoverable INTO v_target_discoverable
    FROM public.profiles WHERE id = p_target;
  IF public.is_blocked_pair(auth.uid(), p_target)
     OR NOT COALESCE(v_target_discoverable, false)
     OR NOT public.connections_allowed_from(p_target, auth.uid()) THEN
    RAISE EXCEPTION 'connections: peer not available';
  END IF;

  IF (SELECT COUNT(*) FROM public.introduction_requests
       WHERE requester_id = auth.uid() AND status = 'pending'
         AND created_at > now() - INTERVAL '24 hours') >= 5 THEN
    RAISE EXCEPTION 'rate limited'; END IF;

  -- Ścieżka zwykła: prośba do tej samej trójki już czeka.
  SELECT id INTO v_id FROM public.introduction_requests
   WHERE requester_id = auth.uid() AND bridge_id = p_bridge
     AND target_id = p_target AND status = 'pending';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  v_tenant := public._caller_tenant();
  BEGIN
    INSERT INTO public.introduction_requests
      (tenant_id, requester_id, bridge_id, target_id, message)
    VALUES (v_tenant, auth.uid(), p_bridge, p_target, p_message)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Przegrana w wyścigu dwóch kart: wiersz założyła równoległa transakcja.
    SELECT id INTO v_id FROM public.introduction_requests
     WHERE requester_id = auth.uid() AND bridge_id = p_bridge
       AND target_id = p_target AND status = 'pending';
  END;
  RETURN v_id;
END; $$;

COMMENT ON INDEX public.introduction_requests_active_uidx IS
  'Jedna AKTYWNA prośba na trójkę (requester, bridge, target). Częściowy, bo prośba odrzucona/wycofana/przekazana ma prawo zostać ponowiona. Do 20260913171000 deduplikacja istniała wyłącznie w komentarzu i w kliencie.';
