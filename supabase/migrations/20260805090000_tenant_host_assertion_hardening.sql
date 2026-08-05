-- ============================================================================
-- P0 BEZPIECZEŃSTWO: `x-tenant-host` przestaje być zaufany W BAZIE.
--
-- PRZYCZYNA ŹRÓDŁOWA (audyt 05.08, §4.1 - "utwardzenie chroni tylko SSR").
-- Utwardzenie z 02.08 postawiło granicę zaufania na KRAWĘDZI aplikacji:
-- `pickTrustedHost()` (src/lib/server/tenant.server.ts) porównuje `Host` /
-- `X-Forwarded-Host` z katalogiem `tenants.domain` i przy braku dopasowania
-- zwraca null. To jest realne i przetestowane - ale obowiązuje WYŁĄCZNIE dla
-- żądań, które przez tę krawędź przechodzą.
--
-- Warstwa bazy została nietknięta: `request_public_host()`
-- (20260703120000:36-53) czyta `request.headers ->> 'x-tenant-host'` WPROST,
-- a `public_tenant_id()` (20260703191341:100-124) mapuje tę wartość na tenanta.
-- Klient z PUBLICZNYM kluczem anon woła PostgREST bezpośrednio - `curl`,
-- `supabase-js` z własnym `global.headers`, dowolny skrypt - i podaje domenę
-- innego tenanta. Krawędź nigdy tego żądania nie widzi. Skutek:
--   * czyta plan anon tenanta B (RLS: `tenant_id = public_tenant_id()`),
--   * atrybuuje anonimowe zapisy do tenanta B,
--   * a jako ZALOGOWANY użytkownik tenanta A pivotuje na tenanta B wszędzie,
--     gdzie ścieżka miesza `public_tenant_id()` z tożsamością wołającego.
-- Ostatni punkt to dokładnie klasa, którą 20260724100000 zamykała RĘCZNIE,
-- funkcja po funkcji (9 funkcji), zostawiając inwariant do pilnowania na
-- przyszłość. Ta migracja zamyka ją U ŹRÓDŁA - raz, dla wszystkich ~530
-- miejsc czytających `public_tenant_id()`, obecnych i przyszłych.
--
-- ── MODEL ZAUFANIA (trzy szczeble, jawnie nazwane) ──────────────────────────
--
--  1. VERIFIED - żądanie przyniosło POŚWIADCZENIE KRAWĘDZI: `x-tenant-assert`
--     = `v1.<kid>.<host>.<exp>.<HMAC-SHA256>`, podpisane sekretem, który znają
--     tylko krawędź (env `TENANT_HOST_ASSERTION_KEY`) i baza (Vault). Baza
--     weryfikuje podpis i termin ważności. Poświadczenie mówi dokładnie tyle:
--     "platforma obsłużyła hosta H" - i tylko tyle ma mówić.
--
--  2. ASSERTED - sam `x-tenant-host`, bez podpisu: DEKLARACJA KLIENTA. Od tej
--     migracji jest przyjmowana wyłącznie wtedy, gdy wskazuje domenę/alias
--     ZAREJESTROWANY w `public.tenants`. Dowolny inny łańcuch znaków jest
--     szumem i nie opuszcza `request_asserted_host()` (koniec sondowania bazy
--     nagłówkiem, koniec nieograniczonej kardynalności wartości w logach).
--
--  3. NONE - brak nagłówka (realtime, bezpośredni SQL, zadania w tle).
--
-- ── CO Z TEGO WYNIKA DLA ROZSTRZYGANIA TENANTA ─────────────────────────────
--
-- `public_tenant_id()` rozstrzyga teraz tak:
--
--   VERIFIED                  -> tenant hosta z poświadczenia (dowolny -
--                                krawędź poświadczyła, że tak wygląda ruch);
--   ASSERTED + anon           -> tenant zadeklarowanego hosta. Anonimowy
--                                czytelnik i tak widzi tylko treść
--                                OPUBLIKOWANĄ, a anonimowy zapis podąża za
--                                witryną, którą przegląda - podszycie się
--                                deklaracją jest równoważne wejściu na tę
--                                witrynę i wypełnieniu formularza, więc nie
--                                daje niczego, czego atakujący nie ma;
--   ASSERTED + zalogowany     -> jeżeli deklaracja wskazuje tenanta INNEGO niż
--                                DOMOWY tenant wołającego (`current_tenant_id()`
--                                - z profilu, czyli z sesji), deklaracja jest
--                                ODRZUCANA i obowiązuje tenant domowy.
--                                NAGŁÓWEK NIE PRZENIESIE ZALOGOWANEGO
--                                UŻYTKOWNIKA DO OBCEGO TENANTA. To jest cała
--                                naprawa: fail-safe, w jednym miejscu.
--   NONE                      -> tenant domyślny (jak dotychczas).
--
-- Legalny ruch cross-tenantowy zalogowanego czytelnika (członek tenanta A
-- czyta publiczną treść tenanta B) DALEJ działa - przez szczebel VERIFIED,
-- bo SSR i przeglądarka zawsze noszą poświadczenie krawędzi. Bez skonfigurowanego
-- klucza degradacja jest w stronę BEZPIECZNĄ (tenant domowy), nie w stronę
-- deklaracji atakującego.
--
-- ── UCZCIWIE O GRANICACH ────────────────────────────────────────────────────
-- Poświadczenie jest wiązane z HOSTEM, nie z osobą: kto chce, pobierze
-- poświadczenie tenanta B po prostu wchodząc na publiczną witrynę B. I tak ma
-- być - poświadczenie nie jest tokenem dostępu, jest dowodem "ruch przeszedł
-- przez platformę dla hosta H". Wartość bezpieczeństwa siedzi w szczeblu 3
-- (przypięcie zalogowanego do tenanta domowego) i w tym, że deklaracja spoza
-- katalogu domen nie działa wcale. Autoryzacja NIGDY nie wynika z hosta -
-- pilnuje tego `scripts/check-sql-tenant-scope.ts` i pgTAP
-- (definer_header_tenant_isolation_test.sql, tenant_host_assertion_test.sql).
--
-- Wszystko idempotentne.
-- ============================================================================

-- pgcrypto: `hmac()`. Na Supabase rozszerzenie mieszka w schemacie
-- `extensions`, więc każda funkcja go wołająca ma `search_path = public,
-- extensions` (ten sam wzorzec co `arm_job_runner`, 20260731110000).
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgcrypto unavailable: % - host assertions will stay unverified', SQLERRM;
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 1) Rejestr kluczy poświadczeń. Jawny `kid` pozwala rotować klucz bez okna
--    niedostępności: krawędź podpisuje nowym, baza przez czas przejścia
--    akceptuje oba. Materiał klucza NIE trafia do tabeli - leży w Vault, tak
--    jak sekrety CRM/integracji (20260712140000, 20260714090000).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_host_assertion_keys (
  kid text PRIMARY KEY CHECK (kid ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  secret_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CONSTRAINT tenant_host_assertion_keys_retired_shape_chk
    CHECK (active OR retired_at IS NOT NULL)
);

COMMENT ON TABLE public.tenant_host_assertion_keys IS
  'Rejestr kluczy podpisujących poświadczenia hosta (x-tenant-assert). Materiał klucza leży w Vault (secret_id); tabela trzyma wyłącznie metadane i stan rotacji.';
COMMENT ON COLUMN public.tenant_host_assertion_keys.kid IS
  'Identyfikator klucza wpisywany w poświadczenie - umożliwia rotację z zachodzeniem okien ważności.';
COMMENT ON COLUMN public.tenant_host_assertion_keys.secret_id IS
  'vault.secrets.id sekretu HMAC. Ten sam materiał trzyma krawędź w TENANT_HOST_ASSERTION_KEY.';
COMMENT ON COLUMN public.tenant_host_assertion_keys.active IS
  'false = klucz wycofany: baza przestaje przyjmować jego podpisy (rotację kończy się dopiero po wygaśnięciu ostatnich poświadczeń).';

-- RLS bez ANI JEDNEJ polityki = zero dostępu dla ról klienckich. Świadomie BEZ
-- `FORCE ROW LEVEL SECURITY`: wymuszenie objęłoby też właściciela tabeli, a
-- właścicielem wykonuje się `verify_tenant_host_assertion()` (SECURITY DEFINER).
-- Przy braku polityk weryfikacja czytałaby zero wierszy i szczebel VERIFIED
-- umarłby po cichu - dokładnie ten rodzaj awarii, którego nie widać w testach
-- funkcjonalnych.
ALTER TABLE public.tenant_host_assertion_keys ENABLE ROW LEVEL SECURITY;

-- Grant odbieramy jawnie, żeby rejestr nie zależał od tego, czy ktoś kiedyś nie
-- dopisze polityki „na chwilę".
REVOKE ALL ON public.tenant_host_assertion_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tenant_host_assertion_keys TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Zarządzanie kluczem (service_role): upsert i wycofanie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_tenant_host_assertion_key(p_kid text, p_secret text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kid text := lower(btrim(COALESCE(p_kid, '')));
  v_secret text := btrim(COALESCE(p_secret, ''));
  v_existing uuid;
BEGIN
  IF v_kid !~ '^[a-z0-9][a-z0-9_-]{1,31}$' THEN
    RAISE EXCEPTION 'tenant host assertion: invalid kid';
  END IF;
  -- 32 znaki to podłoga sensu, nie kaprys: poniżej tego HMAC broni sekretu
  -- słabszego niż sam skrót.
  IF length(v_secret) < 32 THEN
    RAISE EXCEPTION 'tenant host assertion: secret too short (min 32 chars)';
  END IF;

  SELECT k.secret_id INTO v_existing
    FROM public.tenant_host_assertion_keys k WHERE k.kid = v_kid;

  IF v_existing IS NULL THEN
    INSERT INTO public.tenant_host_assertion_keys (kid, secret_id)
    VALUES (v_kid, vault.create_secret(v_secret, 'tenant_host_assertion:' || v_kid))
    ON CONFLICT (kid) DO NOTHING;
  ELSE
    PERFORM vault.update_secret(v_existing, v_secret);
    UPDATE public.tenant_host_assertion_keys
       SET active = true, retired_at = NULL
     WHERE kid = v_kid;
  END IF;

  RETURN v_kid;
END $$;

COMMENT ON FUNCTION public.set_tenant_host_assertion_key(text, text) IS
  'Zapisuje/rotuje sekret HMAC poświadczeń hosta w Vault i rejestruje jego kid. Wyłącznie service_role.';

REVOKE EXECUTE ON FUNCTION public.set_tenant_host_assertion_key(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_host_assertion_key(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.retire_tenant_host_assertion_key(p_kid text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_done boolean := false;
BEGIN
  UPDATE public.tenant_host_assertion_keys
     SET active = false, retired_at = COALESCE(retired_at, now())
   WHERE kid = lower(btrim(COALESCE(p_kid, '')))
  RETURNING true INTO v_done;
  RETURN COALESCE(v_done, false);
END $$;

COMMENT ON FUNCTION public.retire_tenant_host_assertion_key(text) IS
  'Wycofuje klucz poświadczeń hosta: baza przestaje przyjmować jego podpisy.';

REVOKE EXECUTE ON FUNCTION public.retire_tenant_host_assertion_key(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retire_tenant_host_assertion_key(text) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) Normalizacja hosta - jedna definicja dla całego planu.
--    Odzwierciedla normalizeHost() z src/lib/http/host.ts: małe litery, bez
--    portu, IPv6 bez nawiasów. Wydzielona z `request_public_host()`, żeby
--    weryfikator poświadczenia i czytnik nagłówka liczyły to samo.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_public_host(p_raw text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  WITH raw AS (SELECT lower(btrim(COALESCE(p_raw, ''))) AS h)
  SELECT CASE
           WHEN h = '' THEN NULL
           WHEN h ~ '^\[' THEN (regexp_match(h, '^\[([^\]]+)\]'))[1]
           ELSE nullif(split_part(h, ':', 1), '')
         END
    FROM raw
$$;

COMMENT ON FUNCTION public.normalize_public_host(text) IS
  'Host żądania w formie kanonicznej: małe litery, bez portu, IPv6 bez nawiasów. Bliźniak normalizeHost() z src/lib/http/host.ts.';

GRANT EXECUTE ON FUNCTION public.normalize_public_host(text)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Host -> tenant: JEDNA definicja dopasowania (dokładna domena > alias
--    www./apex > `tenants.aliases`), używana i przez rozstrzyganie tenanta,
--    i przez walidację deklaracji. Wcześniej ta logika żyła wklejona w ciele
--    `public_tenant_id()`, więc nie dała się użyć powtórnie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_id_for_public_host(p_host text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH req AS (SELECT public.normalize_public_host(p_host) AS host)
  SELECT t.id
    FROM public.tenants t, req r
   WHERE r.host IS NOT NULL
     AND (
       lower(t.domain) IN (
         r.host,
         CASE WHEN r.host LIKE 'www.%' THEN substr(r.host, 5)
              ELSE 'www.' || r.host END
       )
       OR r.host = ANY (ARRAY(SELECT lower(a) FROM unnest(t.aliases) a))
     )
   ORDER BY (lower(t.domain) = r.host) DESC
   LIMIT 1
$$;

COMMENT ON FUNCTION public.tenant_id_for_public_host(text) IS
  'Tenant właściciela hosta: dokładna domena wygrywa z aliasem www./apex, potem tenants.aliases. NULL = host nie jest zajęty przez żadnego tenanta.';

GRANT EXECUTE ON FUNCTION public.tenant_id_for_public_host(text)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Poświadczenie krawędzi: format i weryfikacja.
--
--    `v1.<kid>.<host-base64url>.<exp-epoch>.<hmac-base64url>`
--    podpisywane nad `v1:<kid>:<host>:<exp>` (separacja domeny + wszystkie
--    pola w podpisie, więc żadnego z nich nie da się podmienić).
--
--    Host jest w base64url, bo kropka jest separatorem pól - domena nigdy nie
--    rozjedzie parsera.
-- ----------------------------------------------------------------------------

-- base64url -> tekst. Postgres nie ma dekodera base64url, a base64 wymaga
-- dopełnienia - odtwarzamy oba.
CREATE OR REPLACE FUNCTION public.b64url_decode(p_value text)
RETURNS bytea
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  -- Dopełnienie zdejmujemy PRZED walidacją alfabetu: koder krawędzi go nie
  -- emituje, ale wejście z '=' ma się dekodować, nie odpadać.
  v text := rtrim(translate(COALESCE(p_value, ''), '-_', '+/'), '=');
BEGIN
  IF v = '' OR v !~ '^[A-Za-z0-9+/]+$' THEN
    RETURN NULL;
  END IF;
  v := v || repeat('=', (4 - (length(v) % 4)) % 4);
  RETURN decode(v, 'base64');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

COMMENT ON FUNCTION public.b64url_decode(text) IS
  'base64url -> bytea (dopełnienie odtwarzane, wejście spoza alfabetu daje NULL zamiast błędu).';

GRANT EXECUTE ON FUNCTION public.b64url_decode(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.b64url_encode(p_value bytea)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT rtrim(translate(replace(encode(p_value, 'base64'), E'\n', ''), '+/', '-_'), '=')
$$;

COMMENT ON FUNCTION public.b64url_encode(bytea) IS
  'bytea -> base64url bez dopełnienia (bliźniak kodera z src/lib/http/tenantAssertion.ts).';

GRANT EXECUTE ON FUNCTION public.b64url_encode(bytea) TO anon, authenticated, service_role;

-- Weryfikacja poświadczenia. Zwraca ZNORMALIZOWANY host albo NULL - nigdy nie
-- rzuca, bo wołana jest z RLS i z DEFAULT-ów kolumn: wyjątek zamieniłby
-- spoofowalny nagłówek na wektor DoS na cały plan anon.
CREATE OR REPLACE FUNCTION public.verify_tenant_host_assertion(p_raw text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_parts text[];
  v_kid text;
  v_host text;
  v_exp bigint;
  v_secret text;
  v_expected text;
  v_given text;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN NULL; END IF;
  -- Twardy limit długości: poświadczenie ma znany kształt, a nagłówek jest
  -- wejściem atakującego - nie ma powodu przepuszczać kilobajtów do dekodera.
  IF length(p_raw) > 512 THEN RETURN NULL; END IF;

  v_parts := string_to_array(btrim(p_raw), '.');
  IF array_length(v_parts, 1) <> 5 OR v_parts[1] <> 'v1' THEN RETURN NULL; END IF;

  v_kid := lower(v_parts[2]);
  IF v_kid !~ '^[a-z0-9][a-z0-9_-]{1,31}$' THEN RETURN NULL; END IF;
  IF v_parts[4] !~ '^[0-9]{1,15}$' THEN RETURN NULL; END IF;
  v_exp := v_parts[4]::bigint;

  -- Termin ważności sprawdzamy PRZED sięgnięciem po sekret: wygasłe
  -- poświadczenie nie ma prawa nawet dotknąć Vaulta.
  IF to_timestamp(v_exp) <= now() THEN RETURN NULL; END IF;

  v_host := public.normalize_public_host(
    convert_from(public.b64url_decode(v_parts[3]), 'utf8')
  );
  IF v_host IS NULL THEN RETURN NULL; END IF;

  SELECT ds.decrypted_secret::text INTO v_secret
    FROM public.tenant_host_assertion_keys k
    JOIN vault.decrypted_secrets ds ON ds.id = k.secret_id
   WHERE k.kid = v_kid AND k.active;
  IF v_secret IS NULL OR v_secret = '' THEN RETURN NULL; END IF;

  -- `hmac()` BEZ kwalifikacji schematem: pgcrypto siedzi na Supabase w
  -- `extensions`, a w instalacjach self-hosted bywa w `public` - przypięty
  -- `search_path` funkcji obsługuje oba układy, a kwalifikacja na sztywno
  -- wyłączałaby szczebel VERIFIED po cichu w jednym z nich.
  v_expected := public.b64url_encode(
    hmac('v1:' || v_kid || ':' || v_host || ':' || v_parts[4], v_secret, 'sha256')
  );
  v_given := rtrim(translate(v_parts[5], '+/', '-_'), '=');

  -- Porównujemy SKRÓTY podpisów, nie same podpisy: `=` na tekście kończy się
  -- na pierwszej różnicy, więc porównanie wprost wycieka pozycję rozbieżności
  -- w czasie. Skrót sprowadza każde porównanie do stałego kształtu wejścia.
  IF sha256(convert_to(v_expected, 'utf8')) <> sha256(convert_to(v_given, 'utf8')) THEN
    RETURN NULL;
  END IF;

  RETURN v_host;
EXCEPTION WHEN OTHERS THEN
  -- Brak pgcrypto/Vaulta, uszkodzone wejście - poświadczenie po prostu nie
  -- istnieje. Fail-safe: żądanie spada na szczebel ASSERTED.
  RETURN NULL;
END $$;

COMMENT ON FUNCTION public.verify_tenant_host_assertion(text) IS
  'Weryfikuje poświadczenie hosta z krawędzi (v1.<kid>.<host>.<exp>.<hmac>) i zwraca znormalizowany host albo NULL. Nigdy nie rzuca - wołana z RLS i DEFAULT-ów kolumn.';

REVOKE ALL ON FUNCTION public.verify_tenant_host_assertion(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_tenant_host_assertion(text)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) Trzy szczeble jako funkcje: surowa deklaracja, host poświadczony, wynik.
-- ----------------------------------------------------------------------------

-- SUROWA deklaracja klienta. Nazwa mówi wprost, czym to jest - żadna polityka
-- RLS ani autoryzacja nie ma prawa tego wołać (pilnuje check:sql-tenant-scope).
CREATE OR REPLACE FUNCTION public.request_asserted_host()
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.normalize_public_host(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant-host'
  )
$$;

COMMENT ON FUNCTION public.request_asserted_host() IS
  'NIEZAUFANA deklaracja hosta z nagłówka x-tenant-host, znormalizowana. Wejście diagnostyczne i wejście request_public_host() - nie wolno jej używać jako podstawy autoryzacji.';

GRANT EXECUTE ON FUNCTION public.request_asserted_host()
  TO anon, authenticated, service_role;

-- Host POŚWIADCZONY przez krawędź (albo NULL).
CREATE OR REPLACE FUNCTION public.request_verified_host()
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.verify_tenant_host_assertion(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant-assert'
  )
$$;

COMMENT ON FUNCTION public.request_verified_host() IS
  'Host potwierdzony podpisem krawędzi (nagłówek x-tenant-assert). NULL = brak poświadczenia albo podpis/termin nie przechodzi.';

GRANT EXECUTE ON FUNCTION public.request_verified_host()
  TO anon, authenticated, service_role;

-- Szczebel zaufania bieżącego żądania - do diagnostyki i do testów pgTAP.
CREATE OR REPLACE FUNCTION public.request_public_host_trust()
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN public.request_verified_host() IS NOT NULL THEN 'verified'
           WHEN public.request_asserted_host() IS NOT NULL THEN 'asserted'
           ELSE 'none'
         END
$$;

COMMENT ON FUNCTION public.request_public_host_trust() IS
  'Szczebel zaufania hosta bieżącego żądania: verified (podpis krawędzi) | asserted (deklaracja klienta) | none.';

GRANT EXECUTE ON FUNCTION public.request_public_host_trust()
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) `request_public_host()`: ZAUFANY host żądania.
--
--    Zmiana kontraktu (świadoma, to sedno naprawy): funkcja NIE zwraca już
--    tego, co przyszło w nagłówku. Zwraca host, na którym baza może się
--    OPRZEĆ - poświadczony podpisem albo przynajmniej wskazujący domenę
--    zarejestrowaną w katalogu tenantów. Deklaracja spoza katalogu jest szumem
--    i zwracamy NULL (konsumenci mają już ścieżkę „brak wskazówki tenanta").
--
--    Bliźniak po stronie TS: pickTrustedHost() - ta sama zasada („zaufanie
--    bierze się z katalogu domen"), ta sama odpowiedź na brak dopasowania.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_public_host()
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    public.request_verified_host(),
    (SELECT h.host
       FROM (SELECT public.request_asserted_host() AS host) h
      WHERE h.host IS NOT NULL
        AND public.tenant_id_for_public_host(h.host) IS NOT NULL)
  )
$$;

COMMENT ON FUNCTION public.request_public_host() IS
  'ZAUFANY host żądania: poświadczony podpisem krawędzi (x-tenant-assert), a w jego braku deklaracja x-tenant-host TYLKO gdy wskazuje domenę/alias zarejestrowany w public.tenants. NULL = brak wskazówki tenanta. Surową deklarację zwraca request_asserted_host() - i wyłącznie do diagnostyki.';

REVOKE ALL ON FUNCTION public.request_public_host() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_public_host()
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8) `public_tenant_id()`: rozstrzyganie tenanta ze szczeblem zaufania.
--
--    Kluczowa reguła (§4.1): niepoświadczona deklaracja NIE PRZENIESIE
--    ZALOGOWANEGO WOŁAJĄCEGO DO OBCEGO TENANTA. Anonimowy plan działa jak
--    dotąd - tam host jest jedynym możliwym źródłem prawdy o przeglądanej
--    witrynie, a widoczna jest wyłącznie treść opublikowana.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tenant_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Weryfikacja poświadczenia sięga po sekret do Vaulta, więc wołamy ją
  -- DOKŁADNIE RAZ na rozstrzygnięcie (nie przez request_public_host(), które
  -- zrobiłoby to po raz drugi). Funkcja jest STABLE i bezparametrowa, więc
  -- planner zwija ją do jednego InitPlanu na zapytanie.
  v_verified text := public.request_verified_host();
  v_tenant uuid;
  v_home uuid;
BEGIN
  IF v_verified IS NOT NULL THEN
    v_tenant := public.tenant_id_for_public_host(v_verified);
  ELSE
    v_tenant := public.tenant_id_for_public_host(public.request_asserted_host());
  END IF;

  -- Szczebel ASSERTED + wołający z tożsamością: host nie jest dowodem niczego,
  -- więc nie wolno mu wyprowadzić użytkownika z jego własnego obszaru
  -- roboczego. Tenant domowy pochodzi z profilu (czyli z sesji/JWT), a nie z
  -- nagłówka - tego atakujący nie podmieni.
  --
  -- Ta gałąź obejmuje też przypadek BRAKU nagłówka (v_tenant IS NULL) - i to
  -- jest zamierzone ULEPSZENIE, nie efekt uboczny. Dotąd zalogowany wołający
  -- BEZ wskazówki hosta (realtime, RPC z serwera poza fetchWithTenantHost)
  -- spadał na tenanta DOMYŚLNEGO, czyli - dla członka innego tenanta - na
  -- OBCY tenant. Teraz działa w swoim własnym. Dla tenanta domyślnego
  -- (tenant domowy = domyślny) zachowanie jest identyczne jak wcześniej.
  IF v_verified IS NULL AND auth.uid() IS NOT NULL THEN
    v_home := public.current_tenant_id();
    IF v_home IS NOT NULL AND v_tenant IS DISTINCT FROM v_home THEN
      RETURN v_home;
    END IF;
  END IF;

  RETURN COALESCE(
    v_tenant,
    (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
    (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
  );
END $$;

COMMENT ON FUNCTION public.public_tenant_id() IS
  'Tenant przeglądanej witryny, rozstrzygany ze szczeblem zaufania hosta: poświadczenie krawędzi -> dowolny tenant; sama deklaracja x-tenant-host -> tenant tej domeny dla anon, a dla ZALOGOWANEGO tylko gdy to jego tenant domowy (inaczej tenant domowy); brak wskazówki -> tenant domyślny, awaryjnie seed ''nes''. Wejście wszystkich polityk anon i DEFAULT-ów tenant_id na powierzchniach publicznych.';

REVOKE ALL ON FUNCTION public.public_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tenant_id()
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9) Higiena katalogu: domena podglądu platformy nie jest domeną produkcyjną.
--    Seed z 20260703191341 wpisał tenantowi 'nes' domenę podglądu jako
--    `domain` - w takiej instalacji KAŻDE żądanie na własnej domenie spadało
--    na fallback tenanta domyślnego, a alias podglądu udawał domenę główną.
--    Ustawiamy właściwą domenę produkcyjną, aliasy zostawiamy dla dev.
-- ----------------------------------------------------------------------------
-- `tenants.domain` ma indeks UNIQUE (20260703090200), więc nie nadpisujemy w
-- ciemno: jeśli domenę kanoniczną trzyma już inny tenant, zostawiamy stan bez
-- zmian, zamiast wywalać migrację na konflikcie.
UPDATE public.tenants t
   SET domain = 'neweuropeanstrategies.com',
       aliases = ARRAY(
         SELECT DISTINCT a
           FROM unnest(t.aliases || ARRAY['localhost', '127.0.0.1']) a
          WHERE a NOT LIKE '%lovable%'
       )
 WHERE t.slug = 'nes'
   AND (t.domain IS NULL OR t.domain = '' OR t.domain LIKE '%lovable%')
   AND NOT EXISTS (
     SELECT 1 FROM public.tenants other
      WHERE other.id <> t.id
        AND lower(other.domain) = 'neweuropeanstrategies.com'
   );

UPDATE public.tenants
   SET aliases = ARRAY(SELECT a FROM unnest(aliases) a WHERE a NOT LIKE '%lovable%')
 WHERE EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a LIKE '%lovable%');
