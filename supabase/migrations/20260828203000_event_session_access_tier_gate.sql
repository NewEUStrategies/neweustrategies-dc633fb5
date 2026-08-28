-- ============================================================================
-- `event_session_access`: BRAMKA SESJI PYTALA O SESJE, A NIE O WYDARZENIE.
--
-- events-harness: include
--
-- CO BYLO ZLE (P1, WYCIEK - nie estetyka)
--
-- Funkcja ma `GRANT EXECUTE ... TO anon` i oddawala adresy transmisji oraz
-- nagrania, sprawdzajac po drodze DOKLADNIE JEDEN warunek dostepu:
--     IF v_session.min_tier_rank > 0 AND NOT public.has_tier_rank(...)
-- Kolumna `event_sessions.min_tier_rank` ma `DEFAULT 0`
-- (`20260823140000_event_sessions.sql`, linia 454), wiec dla wiekszosci sesji
-- ten warunek nie bramkowal NICZEGO. Zapytanie ladujace sesje filtrowalo
-- wylacznie po `s.status = 'published' AND e.status = 'published'` - ani
-- `events.visibility`, ani `events.min_tier_rank`, ani `events.chatham_house`
-- nie bylo w nim w ogole.
--
-- Skutkiem byla sciezka na dwa wywolania, bez logowania:
--     select public.event_agenda('<slug>');        -- GRANT dla anon, oddaje s.id
--     select public.event_session_access('<id>');  -- GRANT dla anon, oddaje adresy
-- Wydarzenie z `visibility = 'members'` i `min_tier_rank = 3` oddawalo w ten
-- sposob nagrania WSZYSTKICH swoich sesji (`recording_url` wychodzil
-- BEZWARUNKOWO) oraz transmisje kazdej sesji bez wymaganego zapisu - bo
-- `v_signed` liczy sie jako `NOT requires_signup OR EXISTS(...)`, a pierwszy
-- czlon jest prawda takze wtedy, gdy `auth.uid()` jest NULL-em.
--
-- TO JEST POWTORKA BLEDU, KTORY RAZ JUZ ZAMKNIETO. Dla tabeli `events` te same
-- dwie kolumny odcieto grantem kolumnowym i przepuszczono przez
-- `get_event_access` (`20260713093000`, utwardzone w `20260721150000`).
-- `event_sessions` dostal grant kolumnowy - i tu wzorzec zadzialal, bo klient
-- nie przeczyta `stream_url` zwyklym SELECT-em - ale funkcja, ktora te kolumny
-- WYDAJE, nie powtorzyla juz reguly dostepu. Grant kolumnowy chroni tabele;
-- kontrakt funkcji trzeba napisac osobno.
--
-- CO ROBI TA MIGRACJA
--
-- Przepisuje cale cialo `event_session_access` tak, zeby bramka wydarzenia byla
-- ODWZOROWANIEM `get_event_access`, a nie druga, wlasna regula. Kolejnosc
-- warunkow i ich tresc sa przeniesione z tamtej funkcji jeden do jednego:
--
--   1. sesja i wydarzenie musza byc opublikowane      -> `not_found`
--   2. obsada (`admin`/`editor` we wlasnym najemcy)   -> przechodzi wszystko
--   3. `auth.uid() IS NULL`                           -> `auth_required`
--   4. `visibility = 'members' AND kind = 'briefing'` -> `pro_briefings`
--      `visibility = 'members'`                       -> `has_tier_rank(GREATEST(min_tier_rank, 1))`
--      w pozostalych przypadkach                      -> `has_tier_rank(min_tier_rank)`
--   5. `chatham_house`                                -> `chatham_house_events`
--   6. wlasna ranga SESJI (jak dotad)                 -> `tier_required`
--
-- NAGRANIA NIE STAWIAMY ZA FLAGA `recordings`, mimo ze `get_event_access` tak
-- robi dla nagrania WYDARZENIA. Kolumna `event_sessions.recording_url` ma
-- wlasny, zapisany kontrakt („dostep po randze warstwy, BEZ wymogu zapisu"),
-- a asercja `10/sesje: nagranie jest dostepne BEZ zapisu` go pilnuje. Dolozenie
-- tam flagi bylo zawezeniem PONAD kontrakt - odbieraloby nagranie czlonkom,
-- ktorzy maja do niego prawo. Bramka wydarzenia z punktow 1-5 wystarcza,
-- zeby zamknac wyciek: to jej brak byl usterka, nie brak flagi.
--
-- DLACZEGO ANONIM NIE DOSTAJE ADRESOW, NAWET DLA WYDARZENIA OTWARTEGO.
-- Bo tak brzmi doktryna tej platformy dla tych dwoch kolumn: `get_event_access`
-- odsyla `auth_required` PRZED sprawdzeniem widocznosci, wiec niezalogowany nie
-- dostaje ani `join_url`, ani `recording_url` takze przy wydarzeniu publicznym.
-- Komentarz przy `event_sessions.recording_url` powoluje sie na te doktryne
-- wprost („dostep po randze warstwy, BEZ wymogu zapisu (doktryna
-- get_event_access z 20260713093000)"), wiec sesja ma isc za rodzicem.
-- Otwarty webcast dla niezalogowanych NIE JEST dzis funkcja tej platformy;
-- gdyby mial nia byc, potrzebuje wlasnej kolumny, ktora to MOWI - a nie
-- brakujacego warunku, ktory to przypadkiem umozliwia.
--
-- CZEGO TA MIGRACJA NIE RUSZA
--   * `requires_signup` i `v_signed` - regula zapisu na sesje zostaje bez zmian,
--   * `chatham_house` w odpowiedzi - nadal wychodzi, bo front go pokazuje,
--   * grantow: funkcja NADAL jest nadana `anon`. Odebranie grantu zamienia
--     odmowe merytoryczna („zaloguj sie") w blad uprawnien, a front wola te
--     funkcje takze dla goscia, zeby wiedziec, CO pokazac zamiast odtwarzacza.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.event_session_access(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_session public.event_sessions;
  v_event public.events;
  v_staff boolean := false;
  v_allowed boolean;
  v_signed boolean;
  v_can_watch boolean;
BEGIN
  IF v_tenant IS NULL OR _session_id IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'not_found');
  END IF;

  SELECT s.* INTO v_session
  FROM public.event_sessions s
  JOIN public.events e
    ON e.id = s.event_id AND e.tenant_id = s.tenant_id
  WHERE s.id = _session_id
    AND s.tenant_id = v_tenant
    AND s.status = 'published'
    AND e.status = 'published';

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'not_found');
  END IF;

  -- Wiersz wydarzenia - to jego brak byl cala usterka.
  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.id = v_session.event_id AND e.tenant_id = v_tenant;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'not_found');
  END IF;

  v_staff := v_event.tenant_id = public.current_tenant_id()
         AND v_uid IS NOT NULL
         AND (public.has_role(v_uid, 'admin'::app_role)
              OR public.has_role(v_uid, 'editor'::app_role));

  -- Niezalogowany nie dostaje adresow - patrz naglowek, punkt „DLACZEGO ANONIM".
  IF NOT v_staff AND v_uid IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'auth_required');
  END IF;

  IF v_staff THEN
    v_allowed := true;
  ELSIF v_event.visibility = 'members' AND v_event.kind = 'briefing' THEN
    v_allowed := public.has_tier_feature('pro_briefings');
  ELSIF v_event.visibility = 'members' THEN
    v_allowed := public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1));
  ELSE
    v_allowed := public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0));
  END IF;

  IF v_allowed AND NOT v_staff AND v_event.chatham_house THEN
    v_allowed := public.has_tier_feature('chatham_house_events');
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'tier_required');
  END IF;

  -- Wlasna ranga SESJI - warunek sprzed tej migracji, zachowany bez zmian.
  IF NOT v_staff
     AND v_session.min_tier_rank > 0
     AND NOT public.has_tier_rank(v_session.min_tier_rank) THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'tier_required');
  END IF;

  v_signed := v_staff OR NOT v_session.requires_signup OR EXISTS (
    SELECT 1 FROM public.event_session_signups g
    WHERE g.tenant_id = v_tenant
      AND g.session_id = _session_id
      AND g.user_id = v_uid
      AND g.status = 'registered'
  );

  -- NAGRANIE ZALEZY OD RANGI, NIE OD ZAPISU I NIE OD FLAGI `recordings`.
  -- To jest doktryna zapisana przy samej kolumnie („dostep po randze warstwy,
  -- BEZ wymogu zapisu") i pilnowana asercja `10/sesje: nagranie jest dostepne
  -- BEZ zapisu`. Rozdzielenie zasobow jest tu celowe: zapis na sesje otwiera
  -- TRANSMISJE (miejsce na sali), a nagranie idzie za samym prawem wstepu na
  -- wydarzenie. Pierwsza wersja tej migracji dokladala tu jeszcze
  -- `has_tier_feature('recordings')` przez analogie do `get_event_access` -
  -- i bylo to zawezenie PONAD kontrakt, ktore odbieralo nagranie sesji
  -- czlonkom majacym do niego prawo. Bramka wydarzenia powyzej wystarcza.
  v_can_watch := v_session.recording_url IS NOT NULL;

  RETURN jsonb_build_object(
    'can_stream', v_signed,
    'can_watch', v_can_watch,
    'reason', CASE WHEN v_signed THEN 'granted' ELSE 'signup_required' END,
    'stream_url', CASE WHEN v_signed THEN v_session.stream_url END,
    'recording_url', CASE WHEN v_can_watch THEN v_session.recording_url END,
    'chatham_house', v_session.chatham_house
  );
END;
$$;

COMMENT ON FUNCTION public.event_session_access(uuid) IS
  'Dostep do transmisji i nagrania SESJI. Bramka wydarzenia jest odwzorowaniem get_event_access (obsada, auth_required, widocznosc, ranga, Chatham House), a nie druga regula. Nagranie idzie za sama ta bramka - BEZ wymogu zapisu na sesje i BEZ flagi recordings, bo zapis otwiera transmisje (miejsce na sali), a nie archiwum. Wczesniej sprawdzana byla wylacznie wlasna ranga sesji, przez co niezalogowany czytal nagrania wydarzenia dla czlonkow.';

REVOKE ALL ON FUNCTION public.event_session_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_session_access(uuid) TO anon, authenticated, service_role;
