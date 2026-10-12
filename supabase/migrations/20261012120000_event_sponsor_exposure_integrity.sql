-- events-harness: include
-- ============================================================================
-- WYDARZENIA: INTEGRALNOSC POMIARU EKSPOZYCJI SPONSOROW (OPS-09).
--
-- PROBLEM. Raport sponsora (podstawa rozliczenia) liczy "unikalne
-- wyswietlenia" i "unikalne klikniecia" jako liczbe ROZNYCH `session_hash`,
-- a identyfikator sesji wymyslala PRZEGLADARKA (`crypto.randomUUID()`).
-- Skrypt rotujacy identyfikator przy kazdym zadaniu tworzyl nowa "osobe" przy
-- kazdym beaconie i nabijal `views_unique`/`clicks_unique` dowolnemu
-- opublikowanemu sponsorowi. Jedyny limit stal w pamieci JEDNEGO izolatu
-- (`createRateLimiter` w `/api/public/sponsor-event`) - serwerow jest wiele,
-- wiec limit nie byl globalny - a filtr botow czyta naglowki, ktore klient
-- ustawia sam.
--
-- ZMIANA - INTEGRALNOSC EGZEKWOWANA PRZY ZAPISIE, W BAZIE:
--   1) LIMIT ZAPYTAN W BAZIE. `event_sponsor_exposure_ingest` wola
--      `rate_limit_hit` (istniejacy licznik repo) z kluczem najemca x
--      wydarzenie x zrodlo: 300 paczek na minute. Zrodlo (`p_source`) to
--      SOLONY skrot adresu z `requestRateSubject` (ta sama sol i ta sama
--      jedyna definicja "kto dzwoni", co wszystkie limity po IP w repo) -
--      surowy adres nie trafia do bazy. Odmowa jest zapisywana jako anomalia
--      `rate_limited`.
--   2) SESJA WYDAWANA PRZEZ SERWER, PODPISANA HMAC. Klient nie wymysla juz
--      identyfikatora: paczka BEZ sesji dostaje nowa sesje (losowy nonce
--      + HMAC-SHA256 kluczem najemcy), a endpoint oddaje ja przegladarce
--      w odpowiedzi. Paczka z sesja, ktorej podpis sie nie zgadza (stary
--      klient z cache, podrobka, klucz po rotacji), NIE tworzy nowej
--      unikalnej: liczy sie do kubelka "zrodlo x dzien" (jeden unikalny na
--      adres i dzien) i jest zapisywana jako anomalia `invalid_session`.
--      DLACZEGO KLUCZ W BAZIE (pgcrypto), A NIE SEKRET Z ENV SERWERA:
--        * integralnosc ma stac tam, gdzie zapis - kazdy wolajacy ingest
--          (dzis endpoint, jutro import albo drugi endpoint) przechodzi te
--          sama weryfikacje, a harness udowadnia ja na prawdziwej funkcji;
--        * wzorzec juz jest w repo: pieprz najemcy zakladany leniwie
--          (`analytics_search_peppers`, `club_anonymity_salts`) i `hmac`
--          z `extensions`;
--        * wdrozenie nie wymaga nowej zmiennej srodowiska (na Lovable to krok
--          reczny), a lancuch zapasowych sekretow w TS konczy sie stala
--          w kodzie - podpis z takim kluczem bylby podrabialny.
--   3) LIMIT UNIKALNYCH SESJI NA ZRODLO. Na jedno zrodlo, wydarzenie i dzien
--      (strefa wydarzenia) liczy sie najwyzej 50 ROZNYCH sesji
--      (`event_sponsor_exposure_sessions`, sprawdzane pod blokada doradcza,
--      wiec rownolegle paczki nie przeskocza limitu). Kolejne sesje z tego
--      zrodla zwijaja sie do kubelka "zrodlo x dzien" i sa zapisywane jako
--      anomalia `session_cap`. Wniosek dla raportu: z jednego adresu w ciagu
--      dnia najwyzej 51 unikalnych (50 sesji + kubelek), niezaleznie od
--      liczby wyslanych identyfikatorow. KOMPROMIS NAZWANY WPROST: siec
--      konferencyjna (wielu ludzi za jednym adresem) tez trafia w limit -
--      wyswietlenia dalej licza sie w sumach (`hits`), a panel pokazuje
--      ostrzezenie z liczba zwinietych pozycji zamiast udawac, ze ich nie ma.
--   4) ANOMALIE DLA PANELU. `event_sponsor_exposure_anomalies` (dzien x
--      powod x sponsor x zrodlo, licznik) i NOWE RPC panelu
--      `admin_event_sponsor_exposure_anomalies(wydarzenie, sponsor?, od, do)`
--      (bramka `assert_event_admin_tenant()`); raport w studiu pokazuje
--      ostrzezenie, gdy w zakresie sa anomalie. Funkcji raportu
--      (`admin_event_sponsor_report_*`, `event_sponsor_report_for_token`) ten
--      plik NIE zmienia - nie ma potrzeby: zawyzone unikalne nie powstaja.
--   5) RETENCJA. `event_sponsor_exposures_prune` czysci takze rejestr sesji
--      (potrzebny tylko limitowi biezacego dnia - 2 dni zapasu na strefy) i
--      anomalie (ten sam horyzont co ekspozycje). Harmonogram pg_cron jest
--      teraz zakladany tutaj (blok odporny na brak rozszerzenia) - rejestr
--      sesji bez retencji rosl by bez konca.
--
-- `event_home_ad_track` NIE MA tej slabosci: od 20260927000500 to pusta
-- zaslepka (zawsze false, zadnego zapisu) - reklame strony glownej liczy ten
-- sam ingest, wiec dostaje te sama ochrone bez zmian w zaslepce.
--
-- SYGNATURA SIE ZMIENIA: `event_sponsor_exposure_ingest(uuid, jsonb) RETURNS
-- integer` -> `(p_tenant uuid, p_source text, p_payload jsonb) RETURNS jsonb`
-- ({written, session, collapsed}). Stara sygnatura jest USUWANA, nie
-- zostawiana obok: przeciazenie bez zrodla byloby obejsciem limitu. Granty
-- jak dotad (wylacznie service_role). Front (`sponsor-event.ts`) i typy
-- zmieniaja sie w tym samym wydaniu; stary klient z cache dalej dziala - jego
-- niepodpisany identyfikator liczy sie do kubelka.
--
-- RODO. W bazie nadal nie ma IP, UA ani uzytkownika: `source_hash` =
-- sha256(najemca:wydarzenie:solony-skrot-adresu:dzien), `session_hash` =
-- sha256(najemca:wydarzenie:nonce:dzien) - zadnego nie da sie zlaczyc miedzy
-- dniami ani wydarzeniami. Klucz HMAC nie wychodzi z bazy (brak grantow
-- klienckich, brak RPC zwracajacego klucz).
--
-- IDEMPOTENTNA: CREATE TABLE IF NOT EXISTS, DROP FUNCTION IF EXISTS + CREATE,
-- CREATE OR REPLACE, blok harmonogramu z wyrejestrowaniem.
-- Testy: scripts/events-harness/runtime_test.d/34_sponsor_exposure_integrity.sql
-- (i zaktualizowany pomocnik zapisu w 32_sponsor_report.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KLUCZ PODPISU SESJI (per najemca, zakladany leniwie)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sponsor_exposure_keys (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_exposure_keys_secret_shape CHECK (secret ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE public.event_sponsor_exposure_keys IS
  'Klucz HMAC podpisu sesji pomiaru ekspozycji sponsorow (256 bitow, hex), jeden na najemce, zakladany leniwie przez _event_sponsor_exposure_token. Brak polityk i grantow klienckich - klucz nie wychodzi z bazy. Rotacja = podmiana wiersza (wydane sesje licza sie wtedy do kubelka zrodla).';

REVOKE ALL ON public.event_sponsor_exposure_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_sponsor_exposure_keys TO service_role;
ALTER TABLE public.event_sponsor_exposure_keys ENABLE ROW LEVEL SECURITY;
-- Brak polityk: tabela trzyma sekret, odczyt wylacznie przez funkcje podpisu.

-- ----------------------------------------------------------------------------
-- 2) REJESTR SESJI NA ZRODLO I DZIEN (limit unikalnych)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sponsor_exposure_sessions (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  day date NOT NULL,
  source_hash text NOT NULL,
  session_hash text NOT NULL,
  first_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_exposure_sessions_pkey
    PRIMARY KEY (tenant_id, event_id, day, source_hash, session_hash),
  CONSTRAINT event_sponsor_exposure_sessions_source_shape CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT event_sponsor_exposure_sessions_session_shape CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT event_sponsor_exposure_sessions_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_exposure_sessions IS
  'Rozne sesje pomiaru widziane z jednego zrodla (solony skrot adresu) w dniu wydarzenia - podstawa limitu unikalnych sesji na zrodlo w event_sponsor_exposure_ingest. Tabela intake: zapis wylacznie przez ingest, retencja 2 dni (event_sponsor_exposures_prune). Brak IP, UA i uzytkownika.';
COMMENT ON COLUMN public.event_sponsor_exposure_sessions.source_hash IS
  'sha256(src:najemca:wydarzenie:solony-skrot-adresu:dzien) - nie laczy zrodla miedzy dniami ani wydarzeniami.';

REVOKE ALL ON public.event_sponsor_exposure_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_sponsor_exposure_sessions TO service_role;
ALTER TABLE public.event_sponsor_exposure_sessions ENABLE ROW LEVEL SECURITY;
-- Brak polityk: tabela nie ma zadnej drogi klienckiej.

-- ----------------------------------------------------------------------------
-- 3) ANOMALIE POMIARU (odczyt przez RPC panelu)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sponsor_exposure_anomalies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sponsor_id uuid,
  day date NOT NULL,
  reason text NOT NULL,
  source_hash text NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_exposure_anomalies_reason_values
    CHECK (reason IN ('rate_limited', 'session_cap', 'invalid_session')),
  CONSTRAINT event_sponsor_exposure_anomalies_rate_limited_event_level
    CHECK (reason <> 'rate_limited' OR sponsor_id IS NULL),
  CONSTRAINT event_sponsor_exposure_anomalies_source_shape CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT event_sponsor_exposure_anomalies_hits_positive CHECK (hits >= 1),
  CONSTRAINT event_sponsor_exposure_anomalies_time_order CHECK (last_at >= first_at),
  CONSTRAINT event_sponsor_exposure_anomalies_dedup UNIQUE NULLS NOT DISTINCT
    (tenant_id, event_id, sponsor_id, day, reason, source_hash),
  CONSTRAINT event_sponsor_exposure_anomalies_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_exposure_anomalies_sponsor_fk FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_exposure_anomalies IS
  'Anomalie pomiaru ekspozycji sponsorow: rate_limited (paczka odrzucona limitem zapytan zrodla - poziom wydarzenia), session_cap (sesja ponad limit unikalnych na zrodlo i dzien - pozycje policzone do kubelka zrodla), invalid_session (sesja bez waznego podpisu serwera - j.w.). Zapis wylacznie przez event_sponsor_exposure_ingest; odczyt przez admin_event_sponsor_exposure_anomalies.';
COMMENT ON COLUMN public.event_sponsor_exposure_anomalies.hits IS
  'rate_limited: liczba odrzuconych paczek. session_cap / invalid_session: liczba pozycji ekspozycji (po weryfikacji) policzonych do kubelka zrodla zamiast do wlasnej sesji.';
COMMENT ON COLUMN public.event_sponsor_exposure_anomalies.sponsor_id IS
  'Sponsor, ktorego pozycje dotyczy anomalia. NULL = poziom wydarzenia (odrzucona paczka albo reklama strony glownej bez sponsora).';

REVOKE ALL ON public.event_sponsor_exposure_anomalies FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_sponsor_exposure_anomalies TO service_role;
ALTER TABLE public.event_sponsor_exposure_anomalies ENABLE ROW LEVEL SECURITY;
-- Brak polityk: odczyt panelu przez RPC z bramka roli.

-- ----------------------------------------------------------------------------
-- 4) PODPIS SESJI
--
-- Sesja = nonce (32 hex, 128 bitow losowosci) + pierwsze 32 hex z
-- HMAC-SHA256('sx1:<najemca>:<nonce>', klucz najemcy). Weryfikacja = ponowne
-- wyliczenie dla nonce z sesji i porownanie calosci. Klucz jest tekstem hex,
-- bo atrapa harnessu (i czesc srodowisk) zna wylacznie `hmac(text, text,
-- text)`; 64 znaki hex to nadal 256 bitow entropii klucza.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_sponsor_exposure_token(p_tenant uuid, p_nonce text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF p_tenant IS NULL OR p_nonce IS NULL OR p_nonce !~ '^[0-9a-f]{32}$' THEN
    RETURN NULL;
  END IF;

  SELECT k.secret INTO v_key
    FROM public.event_sponsor_exposure_keys k
   WHERE k.tenant_id = p_tenant;

  IF v_key IS NULL THEN
    INSERT INTO public.event_sponsor_exposure_keys (tenant_id, secret)
    VALUES (p_tenant, encode(extensions.gen_random_bytes(32), 'hex'))
    ON CONFLICT (tenant_id) DO NOTHING;

    SELECT k.secret INTO v_key
      FROM public.event_sponsor_exposure_keys k
     WHERE k.tenant_id = p_tenant;
  END IF;

  RETURN p_nonce || left(encode(
    extensions.hmac('sx1:' || p_tenant::text || ':' || p_nonce, v_key, 'sha256'), 'hex'), 32);
END;
$function$;

REVOKE ALL ON FUNCTION public._event_sponsor_exposure_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_sponsor_exposure_token(uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_sponsor_exposure_token(uuid, text) IS
  'Sesja pomiaru ekspozycji dla nonce (32 hex): nonce + 32 hex HMAC-SHA256 kluczem najemcy (zakladanym leniwie). NULL dla zlego nonce. Ten sam wynik sluzy wydaniu i weryfikacji sesji w event_sponsor_exposure_ingest. Pomocnik wewnetrzny (service_role).';

-- ----------------------------------------------------------------------------
-- 5) ZAPIS EKSPOZYCJI - limit zapytan, sesja serwera, limit unikalnych
--
-- Cialo z 20260927000500 (weryfikacja kazdej pozycji wzgledem TEGO
-- opublikowanego wydarzenia - bez zmian) plus:
--   * `p_source` - solony skrot adresu z endpointu (`ip:` + 32 hex);
--   * limit zapytan i anomalia `rate_limited`;
--   * sesja: brak -> nowa (oddawana w `session`); niepodpisana -> kubelek
--     zrodla + anomalia `invalid_session` + nowa sesja w odpowiedzi (nowy
--     klient sie leczy, stary jej nie czyta); podpisana ponad limit zrodla ->
--     kubelek + anomalia `session_cap`;
--   * odpowiedz jsonb {written, session, collapsed}.
-- Funkcje pgcrypto wolane z kwalifikacja `extensions.` - search_path zostaje
-- 'public', 'pg_temp' jak w kazdej funkcji SECURITY DEFINER modulu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_sponsor_exposure_ingest(uuid, jsonb);
DROP FUNCTION IF EXISTS public.event_sponsor_exposure_ingest(uuid, text, jsonb);
CREATE FUNCTION public.event_sponsor_exposure_ingest(p_tenant uuid, p_source text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Paczek na minute z jednego zrodla do jednego wydarzenia. Czlowiek wysyla
  -- kilka na minute; zapas jest na siec konferencyjna za jednym adresem.
  c_requests_per_minute constant integer := 300;
  -- Roznych sesji z jednego zrodla w dniu wydarzenia, ktore licza sie jako
  -- osobne unikalne. Kolejne zwijaja sie do jednego kubelka zrodla.
  c_sessions_per_source constant integer := 50;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_none constant jsonb := jsonb_build_object('written', 0, 'session', NULL, 'collapsed', NULL);
  v_session text := btrim(COALESCE(p_payload->>'session', ''));
  v_slug text := btrim(COALESCE(p_payload->>'event_slug', ''));
  v_event_id uuid;
  v_tz text;
  v_day date;
  v_source_hash text;
  v_rate record;
  v_nonce text;
  v_issued text;
  v_reason text;
  v_hash text;
  v_seen integer;
  v_count integer := 0;
BEGIN
  IF p_tenant IS NULL
     OR p_source IS NULL OR p_source !~ '^ip:[0-9a-f]{32}$'
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
     OR (v_session <> '' AND v_session !~ '^[A-Za-z0-9_-]{16,64}$') THEN
    RETURN v_none;
  END IF;

  SELECT e.id, e.timezone INTO v_event_id, v_tz
    FROM public.events e
   WHERE e.tenant_id = p_tenant AND e.slug = v_slug AND e.status = 'published';
  IF v_event_id IS NULL THEN
    RETURN v_none;
  END IF;

  -- Dzien liczymy w STREFIE WYDARZENIA: raport czyta "drugi dzien kongresu",
  -- a nie dobe UTC, ktora w Warszawie konczy sie o pierwszej w nocy.
  v_day := (now() AT TIME ZONE v_tz)::date;
  v_source_hash := encode(extensions.digest(
    'src:' || p_tenant::text || ':' || v_event_id::text || ':' || p_source || ':' || v_day::text,
    'sha256'), 'hex');

  -- 1) Limit zapytan w bazie - globalny, nie per izolat serwera.
  SELECT * INTO v_rate
    FROM public.rate_limit_hit(
      'event.sponsor_exposure',
      p_tenant::text || ':' || v_event_id::text || ':' || p_source,
      c_requests_per_minute,
      1);
  IF NOT COALESCE(v_rate.allowed, false) THEN
    INSERT INTO public.event_sponsor_exposure_anomalies AS a
      (tenant_id, event_id, sponsor_id, day, reason, source_hash, hits)
    VALUES (p_tenant, v_event_id, NULL, v_day, 'rate_limited', v_source_hash, 1)
    ON CONFLICT ON CONSTRAINT event_sponsor_exposure_anomalies_dedup
    DO UPDATE SET hits = LEAST(a.hits::bigint + 1, 2147483647)::integer, last_at = now();
    RETURN v_none || jsonb_build_object('collapsed', 'rate_limited');
  END IF;

  -- 2) Sesja wydana i podpisana przez serwer.
  IF v_session = '' THEN
    v_nonce := encode(extensions.gen_random_bytes(16), 'hex');
    v_issued := public._event_sponsor_exposure_token(p_tenant, v_nonce);
  ELSIF v_session ~ '^[0-9a-f]{64}$'
        AND public._event_sponsor_exposure_token(p_tenant, left(v_session, 32)) = v_session THEN
    v_nonce := left(v_session, 32);
  ELSE
    v_reason := 'invalid_session';
    v_issued := public._event_sponsor_exposure_token(
      p_tenant, encode(extensions.gen_random_bytes(16), 'hex'));
  END IF;

  -- 3) Limit roznych sesji na zrodlo i dzien. Blokada doradcza per zrodlo:
  --    dwie rownolegle paczki z tego samego adresu nie przeskocza limitu.
  IF v_nonce IS NOT NULL THEN
    v_hash := encode(extensions.digest(
      p_tenant::text || ':' || v_event_id::text || ':' || v_nonce || ':' || v_day::text,
      'sha256'), 'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended('event_sponsor_exposure_sessions:' || v_source_hash, 0));
    IF NOT EXISTS (
      SELECT 1 FROM public.event_sponsor_exposure_sessions s
       WHERE s.tenant_id = p_tenant AND s.event_id = v_event_id AND s.day = v_day
         AND s.source_hash = v_source_hash AND s.session_hash = v_hash
    ) THEN
      SELECT count(*)::integer INTO v_seen
        FROM public.event_sponsor_exposure_sessions s
       WHERE s.tenant_id = p_tenant AND s.event_id = v_event_id AND s.day = v_day
         AND s.source_hash = v_source_hash;
      IF v_seen < c_sessions_per_source THEN
        INSERT INTO public.event_sponsor_exposure_sessions
          (tenant_id, event_id, day, source_hash, session_hash)
        VALUES (p_tenant, v_event_id, v_day, v_source_hash, v_hash)
        ON CONFLICT ON CONSTRAINT event_sponsor_exposure_sessions_pkey DO NOTHING;
      ELSE
        v_reason := 'session_cap';
      END IF;
    END IF;
  END IF;

  -- Kubelek zrodla x dzien: jeden unikalny na adres i dzien, ile by sesji nie bylo.
  IF v_reason IS NOT NULL THEN
    v_hash := encode(extensions.digest(
      'bucket:' || p_tenant::text || ':' || v_event_id::text || ':' || p_source || ':' || v_day::text,
      'sha256'), 'hex');
  END IF;

  WITH raw AS (
    SELECT i.item
      FROM jsonb_array_elements(p_payload->'items') WITH ORDINALITY AS i(item, ord)
     WHERE i.ord <= 40 AND jsonb_typeof(i.item) = 'object'
  ), parsed AS (
    SELECT
      CASE WHEN lower(r.item->>'sponsor_id') ~ v_uuid THEN (r.item->>'sponsor_id')::uuid END AS sid,
      r.item->>'placement' AS placement,
      r.item->>'kind' AS kind,
      CASE WHEN lower(r.item->>'material_id') ~ v_uuid THEN (r.item->>'material_id')::uuid END AS mid,
      CASE WHEN lower(r.item->>'home_ad_id') ~ v_uuid THEN (r.item->>'home_ad_id')::uuid END AS aid
      FROM raw r
  ), resolved AS (
    -- Reklama: sponsora bierzemy z WIERSZA REKLAMY, nie od klienta.
    SELECT a.sponsor_id AS sid, p.placement, p.kind, NULL::uuid AS mid, a.id AS aid
      FROM parsed p
      JOIN public.event_home_ads a
        ON a.tenant_id = p_tenant AND a.event_id = v_event_id AND a.id = p.aid
       AND a.is_active
       AND (a.starts_at IS NULL OR a.starts_at <= now())
       AND (a.ends_at IS NULL OR a.ends_at > now())
     WHERE p.placement = 'home_ad' AND p.kind IN ('view', 'click') AND p.mid IS NULL
    UNION ALL
    SELECT p.sid, p.placement, p.kind, p.mid, NULL::uuid
      FROM parsed p
      JOIN public.event_sponsors s
        ON s.tenant_id = p_tenant AND s.event_id = v_event_id AND s.id = p.sid AND s.is_published
     WHERE p.aid IS NULL
       AND (
         (p.placement IN ('home_strip', 'partners_section', 'partners_tab')
           AND p.kind IN ('view', 'click') AND p.mid IS NULL)
         OR (p.placement = 'agenda_session' AND p.kind = 'view' AND p.mid IS NULL
           AND EXISTS (SELECT 1 FROM public.event_sessions es
                        WHERE es.tenant_id = p_tenant AND es.event_id = v_event_id
                          AND es.sponsor_id = p.sid))
         OR (p.placement = 'agenda_track' AND p.kind = 'view' AND p.mid IS NULL
           AND EXISTS (SELECT 1 FROM public.event_tracks et
                        WHERE et.tenant_id = p_tenant AND et.event_id = v_event_id
                          AND et.sponsor_id = p.sid))
         OR (p.placement = 'materials' AND p.kind = 'view' AND p.mid IS NULL)
         OR (p.placement = 'materials' AND p.kind = 'material_open'
           AND EXISTS (SELECT 1 FROM public.event_sponsor_materials m
                        WHERE m.tenant_id = p_tenant AND m.event_id = v_event_id
                          AND m.sponsor_id = p.sid AND m.id = p.mid AND m.is_published))
       )
  ), grouped AS (
    SELECT r.sid, r.placement, r.kind, r.mid, r.aid, count(*)::integer AS n
      FROM resolved r
     GROUP BY r.sid, r.placement, r.kind, r.mid, r.aid
  ), anomaly AS (
    -- Pozycje zwiniete do kubelka - per sponsor, zeby panel umial je przypisac.
    INSERT INTO public.event_sponsor_exposure_anomalies AS an
      (tenant_id, event_id, sponsor_id, day, reason, source_hash, hits)
    SELECT p_tenant, v_event_id, g.sid, v_day, v_reason, v_source_hash,
           LEAST(sum(g.n), 2147483647)::integer
      FROM grouped g
     WHERE v_reason IS NOT NULL
     GROUP BY g.sid
    ON CONFLICT ON CONSTRAINT event_sponsor_exposure_anomalies_dedup
    DO UPDATE SET hits = LEAST(an.hits::bigint + EXCLUDED.hits, 2147483647)::integer, last_at = now()
    RETURNING 1
  )
  INSERT INTO public.event_sponsor_exposures AS x (
    tenant_id, event_id, sponsor_id, placement, kind, material_id, home_ad_id, day, session_hash, hits
  )
  SELECT p_tenant, v_event_id, g.sid, g.placement, g.kind, g.mid, g.aid, v_day, v_hash, LEAST(g.n, 500)
    FROM grouped g
  ON CONFLICT ON CONSTRAINT event_sponsor_exposures_dedup
  DO UPDATE SET hits = LEAST(x.hits + EXCLUDED.hits, 500), last_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('written', v_count, 'session', v_issued, 'collapsed', v_reason);
END;
$function$;

REVOKE ALL ON FUNCTION public.event_sponsor_exposure_ingest(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_sponsor_exposure_ingest(uuid, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_sponsor_exposure_ingest(uuid, text, jsonb) IS
  'Zapis paczki ekspozycji sponsorow: {event_slug, session?, items:[{sponsor_id, placement, kind, material_id?, home_ad_id?}]} (maks. 40). Wylacznie service_role - najemce (zaufany host) i zrodlo (solony skrot adresu, ip:<32 hex>) podaje endpoint. Limit 300 paczek/min na zrodlo i wydarzenie (rate_limit_hit); sesja wydawana i podpisywana przez serwer (HMAC klucza najemcy); najwyzej 50 roznych sesji na zrodlo i dzien - reszta oraz sesje niepodpisane licza sie do kubelka zrodla; odmowy i zwiniecia trafiaja do event_sponsor_exposure_anomalies. Kazda pozycja weryfikowana wzgledem TEGO opublikowanego wydarzenia. Zwraca {written, session (nowa sesja albo null), collapsed (powod albo null)}.';

-- ----------------------------------------------------------------------------
-- 6) RETENCJA - ekspozycje, anomalie i rejestr sesji
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_sponsor_exposures_prune(p_keep_days integer DEFAULT 400)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cutoff date := (now() - make_interval(days => GREATEST(COALESCE(p_keep_days, 400), 30)))::date;
  v_rows integer;
  v_count integer := 0;
BEGIN
  DELETE FROM public.event_sponsor_exposures x
   WHERE x.day < v_cutoff;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  DELETE FROM public.event_sponsor_exposure_anomalies a
   WHERE a.day < v_cutoff;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  -- Rejestr sesji sluzy wylacznie limitowi BIEZACEGO dnia wydarzenia; dwa dni
  -- zapasu pokrywaja kazda strefe czasowa (UTC-12 .. UTC+14).
  DELETE FROM public.event_sponsor_exposure_sessions s
   WHERE s.day < (now() - interval '2 days')::date;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.event_sponsor_exposures_prune(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_sponsor_exposures_prune(integer) TO service_role;

COMMENT ON FUNCTION public.event_sponsor_exposures_prune(integer) IS
  'Retencja pomiaru ekspozycji sponsorow: ekspozycje i anomalie starsze niz p_keep_days (domyslnie 400, minimum 30) oraz rejestr sesji starszy niz 2 dni. Zwraca laczna liczbe usunietych wierszy. Harmonogram: pg_cron event-sponsor-exposures-prune (35 3 * * *), gdy rozszerzenie jest dostepne.';

-- Minuta 35 o 3:00 UTC - termin zapowiedziany w 20260927000500, wolny w
-- harmonogramie repo. Wyrejestrowanie przed rejestracja czyni blok
-- powtarzalnym; brak pg_cron albo blad rejestracji nie wywraca migracji.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable - sponsor exposure retention runs only on demand';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.unschedule('event-sponsor-exposures-prune');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule(
    'event-sponsor-exposures-prune',
    '35 3 * * *',
    $job$SELECT public.event_sponsor_exposures_prune()$job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sponsor exposures: scheduling retention job failed (%)', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 7) PANEL: ANOMALIE POMIARU W RAPORCIE SPONSORA
--
-- Filtr sponsora oddaje jego wiersze ORAZ wiersze poziomu wydarzenia
-- (odrzucone paczki, reklama bez sponsora) - one tez znieksztalcaja liczby,
-- ktore organizator pokazuje temu sponsorowi. Wiersz = dzien x powod, wiec
-- `sources` (rozne zrodla = adres w tym dniu) liczy sie po CALYM filtrze, bez
-- dublowania adresu, ktory zwinal pozycje kilku sponsorow; suma `sources` po
-- dniach to liczba par adres x dzien. Jedno zrodlo to inny obraz niz sto.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_sponsor_exposure_anomalies(
  p_event_id uuid,
  p_sponsor_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS TABLE (
  day date,
  reason text,
  hits integer,
  sources integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  PERFORM public._event_sponsor_report_assert_filters(p_from, p_to, NULL);

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  SELECT a.day,
         a.reason,
         LEAST(sum(a.hits), 2147483647)::integer,
         count(DISTINCT a.source_hash)::integer
    FROM public.event_sponsor_exposure_anomalies a
   WHERE a.tenant_id = v_tenant
     AND a.event_id = p_event_id
     AND (p_sponsor_id IS NULL OR a.sponsor_id = p_sponsor_id OR a.sponsor_id IS NULL)
     AND (p_from IS NULL OR a.day >= p_from)
     AND (p_to IS NULL OR a.day <= p_to)
   GROUP BY a.day, a.reason
   ORDER BY a.day, a.reason;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_exposure_anomalies(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_exposure_anomalies(uuid, uuid, date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_exposure_anomalies(uuid, uuid, date, date) IS
  'Anomalie pomiaru ekspozycji sponsorow wydarzenia (dzien w strefie wydarzenia x powod): hits i liczba roznych zrodel (adres w danym dniu). Filtr sponsora oddaje jego wiersze i wiersze poziomu wydarzenia (sponsor_id NULL). Bramka: assert_event_admin_tenant().';
