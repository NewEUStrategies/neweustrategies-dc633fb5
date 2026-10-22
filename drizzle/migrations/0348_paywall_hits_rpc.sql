-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S3, 2/5): POMIAR UDERZEŃ W PAYWALL -
-- `record_paywall_hit` (konto) I `record_paywall_hit_visitor` (gość, serwer).
--
-- DEFEKT
--   1. Brak pomiaru paywalla (P18): ani `Paywall`, ani `MeterBanner`, ani
--      bramka klubu nie zostawiają śladu, że czytelnik zatrzymał się na
--      ścianie. Lejek „wyświetlenie -> rejestracja -> płatność" nie ma środka,
--      a wskaźniki PHR (zasięg paywalla) i PSCR (konwersja paywalla) z
--      rejestru S6 nie mają mianownika.
--   2. Pomiar klienta (`track()`) działa wyłącznie przy zgodzie analitycznej -
--      liczony nim lejek byłby próbką zależną od banera zgód, a nie faktem.
--      Uderzenie w paywall to fakt wykonania usługi (umowa: dostęp do treści
--      wg planu), więc zapis serwerowy nie zależy od zgody i nie niesie
--      identyfikatora przeglądarki ani adresu.
--
-- ZMIANA (rejestr S3 w `src/lib/ci/hubDelivery.ts`)
--   A. `record_paywall_hit(p_entity_type, p_entity_id, p_reason,
--      p_required_tier_key, p_variant)` - rodzaj `reader`: EXECUTE dla
--      `authenticated` BEZ bramki roli (czytelnik nie jest staffem). Konto
--      wyłącznie z `auth.uid()`, najemca wyłącznie z `public_tenant_id()`
--      (płaszczyzna treści - ten sam najemca, który wydał regułę dostępu;
--      funkcja NIE łączy go z `has_role`, więc `check:sql-tenant-scope` ma
--      czysty przypadek). Jeden wiersz `paywall_hits` na (doba UTC, konto,
--      treść, wariant) z licznikiem (`ON CONFLICT … DO UPDATE hits + 1`).
--      Pierwszy wiersz konta w dobie emituje `paywall.hit.v1` - blokada
--      transakcyjna per (najemca, konto, doba) serializuje sprawdzenie
--      „pierwszy dziś", więc dwie karty naraz nie dają dwóch zdarzeń.
--   B. `record_paywall_hit_visitor(p_visitor_hash, p_tenant, …)` - rodzaj
--      `service`: wyłącznie `service_role` (funkcja serwerowa
--      `recordPaywallHitVisitor`, najemca z zaufanego hosta, skrót gościa
--      z podpisanego cookie - nigdy z ładunku klienta). Bez zdarzenia na
--      szynie (zdarzenie jest per konto; gość nie ma kogo prowadzić ścieżką).
--   C. Walidacja wejścia JAWNA, z odrzuceniem (22023), nie z przycięciem:
--      typ treści, powód i wariant z dziedziny CHECK-ów tabeli, klucz warstwy
--      <= 64 znaki i istniejący u najemcy. Treść musi należeć do najemcy
--      i być zabramkowana (`content_access` z trybem innym niż `public`,
--      klub albo wydarzenie najemcy) - inaczej wywołanie jest pomijane bez
--      wiersza: RPC jest otwarte dla każdego zalogowanego, więc bez tego
--      dałoby się zaśmiecać lejek dowolnymi identyfikatorami.
--   Błąd emitera nie psuje zapisu uderzenia (`_log_emit_error`, Z-02).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020090100 (`paywall_hits`, unikalne indeksy
-- częściowe = arbitry ON CONFLICT) i 20261020090500 (`_log_emit_error`).
-- Klient woła RPC literałem przez `RpcCallable`; przed wdrożeniem dostaje
-- PGRST202, który paywall połyka (pomiar nigdy nie psuje ściany).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe sygnatury), bezstanowe
-- REVOKE/GRANT. Zero DDL tabel.
-- DOWÓD: supabase/tests/paywall_hits_test.sql (uid z sesji, najemca z
-- `public_tenant_id()`, deduplikacja doby, jedno zdarzenie na dobę, `anon`
-- bez EXECUTE, wariant gościa tylko dla `service_role`, odrzucenie złego
-- wejścia), src/lib/access/__tests__/paywallHits.functions.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Wspólna walidacja i zapis - ciało jest w obu funkcjach osobno (funkcja
-- pomocnicza byłaby trzecią funkcją bez właściciela w rejestrze), dlatego
-- reguły wejścia stoją w jednym miejscu: tu, w opisie, i w obu ciałach 1:1.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- A) Konto.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_paywall_hit(
  p_entity_type text,
  p_entity_id uuid,
  p_reason text,
  p_required_tier_key text DEFAULT NULL,
  p_variant text DEFAULT 'default'
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_day date := (now() AT TIME ZONE 'UTC')::date;
  v_variant text := COALESCE(NULLIF(btrim(p_variant), ''), 'default');
  v_tier text := NULLIF(btrim(p_required_tier_key), '');
  v_gated boolean := false;
  v_first boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'paywall_hit_requires_account' USING ERRCODE = '42501';
  END IF;
  IF p_entity_type IS NULL OR p_entity_type NOT IN ('post', 'page', 'media', 'club', 'event') THEN
    RAISE EXCEPTION 'paywall_hit_invalid_entity_type' USING ERRCODE = '22023';
  END IF;
  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'paywall_hit_invalid_entity_id' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('members', 'paid', 'tier_rank', 'password', 'quota', 'registration') THEN
    RAISE EXCEPTION 'paywall_hit_invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF v_variant !~ '^[a-z0-9_-]{1,32}$' THEN
    RAISE EXCEPTION 'paywall_hit_invalid_variant' USING ERRCODE = '22023';
  END IF;
  IF v_tier IS NOT NULL AND char_length(v_tier) > 64 THEN
    RAISE EXCEPTION 'paywall_hit_invalid_tier_key' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.public_tenant_id();
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  -- Warstwa spoza katalogu najemcy nie jest błędem czytelnika (reguła mogła
  -- wskazać warstwę usuniętą chwilę temu) - zapis bez klucza, nie odmowa.
  IF v_tier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.membership_tiers mt WHERE mt.tenant_id = v_tenant AND mt.key = v_tier
  ) THEN
    v_tier := NULL;
  END IF;

  IF p_entity_type IN ('post', 'page', 'media') THEN
    SELECT EXISTS (
      SELECT 1 FROM public.content_access ca
       WHERE ca.entity_type = p_entity_type::public.access_entity_type
         AND ca.entity_id = p_entity_id
         AND ca.tenant_id = v_tenant
         AND ca.mode <> 'public'
    ) INTO v_gated;
  ELSIF p_entity_type = 'club' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.clubs c WHERE c.id = p_entity_id AND c.tenant_id = v_tenant
    ) INTO v_gated;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = p_entity_id AND e.tenant_id = v_tenant
    ) INTO v_gated;
  END IF;
  IF NOT v_gated THEN
    RETURN;
  END IF;

  -- „Pierwszy wiersz konta w dobie" sprawdzany pod blokadą: bez niej dwa
  -- równoległe uderzenia w RÓŻNE treści widziałyby pustą dobę i oba
  -- emitowały zdarzenie. Blokada transakcyjna zwalnia się sama.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('paywall_hit:' || v_tenant::text || ':' || v_uid::text || ':' || v_day::text, 0)
  );
  v_first := NOT EXISTS (
    SELECT 1 FROM public.paywall_hits ph
     WHERE ph.tenant_id = v_tenant AND ph.day = v_day AND ph.user_id = v_uid
  );

  INSERT INTO public.paywall_hits
    (tenant_id, day, user_id, entity_type, entity_id, reason, required_tier_key, variant)
  VALUES
    (v_tenant, v_day, v_uid, p_entity_type, p_entity_id, p_reason, v_tier, v_variant)
  ON CONFLICT (tenant_id, day, user_id, entity_type, entity_id, variant) WHERE user_id IS NOT NULL
  DO UPDATE SET
    hits = public.paywall_hits.hits + 1,
    last_at = now(),
    -- Powód i warstwa z OSTATNIEGO uderzenia: czytelnik, który kupił niższy
    -- plan, wraca na tę samą treść już z powodem `tier_rank`.
    reason = EXCLUDED.reason,
    required_tier_key = EXCLUDED.required_tier_key;

  IF v_first THEN
    BEGIN
      PERFORM public.emit_domain_event(
        v_tenant, 'paywall', v_uid::text, 'paywall.hit.v1',
        jsonb_strip_nulls(jsonb_build_object(
          'user_id', v_uid,
          'entity_type', p_entity_type,
          'entity_id', p_entity_id,
          'reason', p_reason,
          'required_tier_key', v_tier,
          'variant', v_variant
        )),
        v_uid
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._log_emit_error(v_tenant, 'record_paywall_hit', 'paywall.hit.v1', SQLSTATE, SQLERRM);
    END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_paywall_hit(text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_paywall_hit(text, uuid, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_paywall_hit(text, uuid, text, text, text) IS
  'Hub S3: uderzenie zalogowanego czytelnika w paywall - konto z auth.uid(), najemca z public_tenant_id(); wiersz na (doba UTC, konto, treść, wariant) z licznikiem; pierwszy wiersz doby -> paywall.hit.v1. Niezależne od zgody analitycznej (fakt usługi, bez identyfikatora przeglądarki).';

-- ----------------------------------------------------------------------------
-- B) Gość - wyłącznie serwer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_paywall_hit_visitor(
  p_visitor_hash text,
  p_tenant uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_reason text,
  p_required_tier_key text DEFAULT NULL,
  p_variant text DEFAULT 'default'
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'UTC')::date;
  v_variant text := COALESCE(NULLIF(btrim(p_variant), ''), 'default');
  v_tier text := NULLIF(btrim(p_required_tier_key), '');
  v_gated boolean := false;
BEGIN
  -- Skrót gościa: wyłącznie hex skrótu HMAC (16-128 znaków, CHECK tabeli).
  -- Za długi albo nie-hex to błąd serwera, nie dane do przycięcia.
  IF p_visitor_hash IS NULL OR p_visitor_hash !~ '^[0-9a-f]{16,128}$' THEN
    RAISE EXCEPTION 'paywall_hit_invalid_visitor' USING ERRCODE = '22023';
  END IF;
  IF p_entity_type IS NULL OR p_entity_type NOT IN ('post', 'page', 'media', 'club', 'event') THEN
    RAISE EXCEPTION 'paywall_hit_invalid_entity_type' USING ERRCODE = '22023';
  END IF;
  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'paywall_hit_invalid_entity_id' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('members', 'paid', 'tier_rank', 'password', 'quota', 'registration') THEN
    RAISE EXCEPTION 'paywall_hit_invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF v_variant !~ '^[a-z0-9_-]{1,32}$' THEN
    RAISE EXCEPTION 'paywall_hit_invalid_variant' USING ERRCODE = '22023';
  END IF;
  IF v_tier IS NOT NULL AND char_length(v_tier) > 64 THEN
    RAISE EXCEPTION 'paywall_hit_invalid_tier_key' USING ERRCODE = '22023';
  END IF;
  IF p_tenant IS NULL THEN
    RETURN;
  END IF;

  IF v_tier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.membership_tiers mt WHERE mt.tenant_id = p_tenant AND mt.key = v_tier
  ) THEN
    v_tier := NULL;
  END IF;

  IF p_entity_type IN ('post', 'page', 'media') THEN
    SELECT EXISTS (
      SELECT 1 FROM public.content_access ca
       WHERE ca.entity_type = p_entity_type::public.access_entity_type
         AND ca.entity_id = p_entity_id
         AND ca.tenant_id = p_tenant
         AND ca.mode <> 'public'
    ) INTO v_gated;
  ELSIF p_entity_type = 'club' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.clubs c WHERE c.id = p_entity_id AND c.tenant_id = p_tenant
    ) INTO v_gated;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = p_entity_id AND e.tenant_id = p_tenant
    ) INTO v_gated;
  END IF;
  IF NOT v_gated THEN
    RETURN;
  END IF;

  INSERT INTO public.paywall_hits
    (tenant_id, day, visitor_hash, entity_type, entity_id, reason, required_tier_key, variant)
  VALUES
    (p_tenant, v_day, p_visitor_hash, p_entity_type, p_entity_id, p_reason, v_tier, v_variant)
  ON CONFLICT (tenant_id, day, visitor_hash, entity_type, entity_id, variant) WHERE visitor_hash IS NOT NULL
  DO UPDATE SET
    hits = public.paywall_hits.hits + 1,
    last_at = now(),
    reason = EXCLUDED.reason,
    required_tier_key = EXCLUDED.required_tier_key;
END;
$$;

REVOKE ALL ON FUNCTION public.record_paywall_hit_visitor(text, uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_paywall_hit_visitor(text, uuid, text, uuid, text, text, text) TO service_role;

COMMENT ON FUNCTION public.record_paywall_hit_visitor(text, uuid, text, uuid, text, text, text) IS
  'Hub S3: uderzenie gościa w paywall - wyłącznie service_role (najemca z zaufanego hosta, skrót gościa HMAC z podpisanego cookie); wiersz na (doba UTC, gość, treść, wariant) z licznikiem, bez zdarzenia na szynie.';
