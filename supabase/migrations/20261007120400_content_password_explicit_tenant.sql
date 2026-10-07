-- ============================================================================
-- ODBLOKOWANIE TRESCI HASLEM: TYLKO Z SERWERA, Z JAWNYM NAJEMCA I ADRESEM.
--
-- Znalezisko kontraktu TypeScript <-> SQL
-- (`supabase/tests/ts_sql_contract_test.sql`, sekcja „RPC tylko z serwera").
-- Dwa defekty na szwie rola serwisowa <-> baza w jednej funkcji:
--
--   1. LIMIT PO ADRESIE DO OBEJSCIA. `verify_content_password` (20260720071845)
--      ma EXECUTE dla `anon` i `authenticated`, a kubelek adresu liczy sie
--      TYLKO, gdy wolajacy sam poda `_ip_hash`. Funkcja serwerowa
--      `unlockContentPassword` zawsze go podaje, ale PostgREST wprost
--      (`POST /rest/v1/rpc/verify_content_password` z `_ip_hash` NULL albo
--      losowym) zostawia sam limit 10 prob na minute na wpis - ~14 tys. prob
--      dziennie na jedno haslo. Do tego wynik jest ZBIOREM WIERSZY, a funkcja
--      zapisuje proby: filtr wolajacego z naglowkiem
--      `Accept: application/vnd.pgrst.object+json` wymusza 406 i wycofanie
--      transakcji razem z licznikiem (ta sama klasa co N-13-1 dla kuponow,
--      20261001210000).
--   2. NAJEMCA DOMYSLNY POD ROLA SERWISOWA. Cialo czyta `public_tenant_id()`,
--      a `supabaseAdmin` nie niesie naglowka hosta - bez naglowka i bez
--      `auth.uid()` funkcja zwraca najemce DOMYSLNEGO. Wpis chroniony haslem
--      na domenie kazdego innego najemcy nigdy sie wiec nie odblokowywal
--      (`p.tenant_id = v_tenant` nie trafial).
--
-- ZMIANA:
--   * `_verify_content_password(p_tenant, ...)` - rdzen z cialem
--     z 20260720071845, najemca z argumentu;
--   * `verify_content_password_for_tenant(_tenant_id, _entity_type,
--     _entity_id, _password, _ip_hash)` - TYLKO `service_role`; najemca
--     i skrot adresu wymagane (bez nich kubelek adresu zniknalby po cichu);
--   * `verify_content_password(4)` - wrapper (najemca z hosta), EXECUTE
--     odebrane `PUBLIC`, `anon` i `authenticated`; zostaje `service_role` na
--     okno wdrozenia.
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD, POTEM TA MIGRACJA. Kod
-- (`unlockContentPassword`) woluje wariant z najemca, a przy PGRST202/42883
-- wraca do starego wywolania - ktore dziala rola serwisowa w obu stanach bazy.
--
-- IDEMPOTENTNA: CREATE OR REPLACE i bezstanowe REVOKE/GRANT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._verify_content_password(
  p_tenant uuid,
  _entity_type public.access_entity_type,
  _entity_id uuid,
  _password text,
  _ip_hash text
)
RETURNS TABLE(ok boolean, content_pl text, content_en text, builder_data jsonb, blocks_data jsonb)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_hash text;
  v_mode public.access_mode;
  v_attempts integer;
  v_ip_attempts integer;
BEGIN
  -- Kubelek wpisu (10 / minute), atomowy.
  INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
  VALUES ('content_password', 'pwd:' || _entity_id::text, date_trunc('minute', now()), 1)
  ON CONFLICT (scope, subject_id, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_attempts;

  IF v_attempts > 10 THEN
    RAISE EXCEPTION 'content_password: too many attempts';
  END IF;

  -- Kubelek adresu (20 / 5 minut) na WSZYSTKIE tresci chronione haslem.
  IF _ip_hash IS NOT NULL AND length(_ip_hash) > 0 THEN
    INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
    VALUES (
      'content_password_ip',
      'ip:' || _ip_hash,
      to_timestamp((floor(extract(epoch FROM now()) / 300) * 300)::double precision),
      1
    )
    ON CONFLICT (scope, subject_id, window_start)
    DO UPDATE SET count = public.rate_limits.count + 1
    RETURNING count INTO v_ip_attempts;

    IF v_ip_attempts > 20 THEN
      RAISE EXCEPTION 'content_password: too many attempts (ip)';
    END IF;
  END IF;

  SELECT mode, password_hash INTO v_mode, v_hash
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode::text <> 'password' OR v_hash IS NULL OR _password IS NULL OR length(_password) = 0 THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF public.crypt(_password, v_hash) <> v_hash THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF _entity_type = 'post' THEN
    RETURN QUERY
      SELECT true, p.content_pl, p.content_en, p.builder_data, p.blocks_data
        FROM public.posts p
       WHERE p.id = _entity_id
         AND p.tenant_id = p_tenant
         AND p.status = 'published'
         AND p.deleted_at IS NULL;
  ELSIF _entity_type = 'page' THEN
    RETURN QUERY
      SELECT true, pg.content_pl, pg.content_en, pg.builder_data, NULL::jsonb
        FROM public.pages pg
       WHERE pg.id = _entity_id
         AND pg.tenant_id = p_tenant
         AND pg.status = 'published'
         AND pg.deleted_at IS NULL;
  END IF;

  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public._verify_content_password(uuid, public.access_entity_type, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_content_password_for_tenant(
  _tenant_id uuid,
  _entity_type public.access_entity_type,
  _entity_id uuid,
  _password text,
  _ip_hash text
)
RETURNS TABLE(ok boolean, content_pl text, content_en text, builder_data jsonb, blocks_data jsonb)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Serwer zna najemce (host) i adres (naglowki) - brak ktoregokolwiek to
  -- blad wolajacego, a nie cichy powrot do najemcy domyslnego albo bez limitu.
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant is required';
  END IF;
  IF _ip_hash IS NULL OR length(btrim(_ip_hash)) = 0 THEN
    RAISE EXCEPTION 'invalid_payload: address hash is required';
  END IF;
  RETURN QUERY
    SELECT * FROM public._verify_content_password(_tenant_id, _entity_type, _entity_id, _password, _ip_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_content_password_for_tenant(uuid, public.access_entity_type, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_content_password_for_tenant(uuid, public.access_entity_type, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.verify_content_password(
  _entity_type public.access_entity_type,
  _entity_id uuid,
  _password text,
  _ip_hash text DEFAULT NULL
)
RETURNS TABLE(ok boolean, content_pl text, content_en text, builder_data jsonb, blocks_data jsonb)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT * FROM public._verify_content_password(
      public.public_tenant_id(), _entity_type, _entity_id, _password, _ip_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_content_password(public.access_entity_type, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_content_password(public.access_entity_type, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.verify_content_password_for_tenant(uuid, public.access_entity_type, uuid, text, text) IS
  'Odblokowanie tresci haslem - TYLKO service_role. Najemca i skrot adresu jawnie (supabaseAdmin nie niesie hosta); kubelki: wpis 10/min, adres 20/5 min. Zwraca tresc tylko dla opublikowanego wpisu/strony TEGO najemcy.';
COMMENT ON FUNCTION public.verify_content_password(public.access_entity_type, uuid, text, text) IS
  'Wrapper zgodnosci (najemca z hosta) - TYLKO service_role. Klient woluje unlockContentPassword, a ta verify_content_password_for_tenant.';
