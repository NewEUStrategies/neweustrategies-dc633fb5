-- ============================================================================
-- KATALOG v6.1: PRÓG WOLUMENOWY ZESPOŁU, DECISION LAB JAKO PRODUKT,
-- AUTOMATYCZNA WERYFIKACJA DOMENY UCZELNI
--
-- Trzy pozycje z listy wdrożeniowej katalogu i audytu, wszystkie po stronie
-- ŹRÓDŁA PRAWDY CENNIKA (`access_plans`), bo to z niego `catalogSync.server.ts`
-- odtwarza produkty i ceny u operatora płatności. Zmiana zrobiona tutaj jest
-- zmianą w Stripe - po najbliższej synchronizacji katalogu.
--
-- ── 1) PRÓG WOLUMENOWY ZESPOŁU ──────────────────────────────────────────────
--
-- Katalog: „Rabat wolumenowy od 11 miejsc: 79 zł za miejsce [B?] - wymaga
-- progu wolumenowego w access_plans". Dotąd plan zespołowy miał jedną cenę za
-- miejsce, więc rabat był obietnicą bez mechanizmu: przy piętnastu miejscach
-- operator pobierał piętnaście razy cenę podstawową.
--
-- Próg opisujemy DWIEMA kolumnami na planie, a nie osobnym wierszem planu.
-- Osobny wiersz wymagałby własnego `tier_key` (klucz `access_plans` ->
-- `membership_tiers` jest po nim), a `tier_key` bez odpowiednika w warstwach
-- oznacza subskrypcję BEZ ŻADNYCH UPRAWNIEŃ: `my_effective_tier_features`
-- i `current_membership_tier` łączą się z `membership_tiers` po tym kluczu
-- i po prostu nie znajdują wiersza. Zespół po rabacie straciłby cały zakres Pro.
--
-- ── 2) DECISION LAB JAKO PRODUKT SAMODZIELNY ────────────────────────────────
--
-- Katalog wycenia miejsce w cyklu Decision Lab dla podmiotu spoza partnerstwa
-- i podpiera się odpowiednikiem ECRI/CEPS (5 000 EUR). Audyt (rozdział 2.5)
-- wykazał błąd arytmetyczny w tym uzasadnieniu: przy kursie NBP 4,3122 zł/EUR
-- 5 000 EUR to 21 561 zł, więc proponowane 12 000 zł stanowiło 55,7% - nieco
-- ponad połowę, a nie deklarowane trzy czwarte.
--
-- DECYZJA WŁAŚCICIELA: utrzymać relację trzech czwartych i podnieść cenę do
-- 16 000 zł (16 000 / 21 561 = 74,2%). Opis w katalogu zostaje bez zmian.
--
-- Interwał `one_time` - Decision Lab nie jest subskrypcją. `plan_interval` ma
-- tę wartość od migracji założycielskiej, a `createPlanCheckoutSession`
-- wybiera tryb sesji po `price.type`, więc ścieżka zakupu działa bez zmian.
-- `tier_key = 'decision_lab'` świadomie NIE ma odpowiednika w `membership_tiers`:
-- zakup miejsca w cyklu nie nadaje żadnej rangi w drabince i nie może jej
-- nadawać - to produkt, nie członkostwo.
--
-- ── 3) WERYFIKACJA DOMENY UCZELNI ───────────────────────────────────────────
--
-- Audyt, rozdział 4: katalog opisuje weryfikację studencką jako proces ręczny
-- („e-mailem uczelni lub legitymacją"), podczas gdy platforma ma zbudowaną
-- weryfikację domenową (`verification_domains`, `verification_domain_badges`,
-- `sync_org_verification`) i stosuje ją do odznak profilu. Brakuje jednego:
-- oznaczenia, KTÓRE domeny są akademickie, i odpowiedzi na pytanie „czy tego
-- wołającego trzeba w ogóle prosić o legitymację".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Próg wolumenowy na planie.
-- ----------------------------------------------------------------------------
ALTER TABLE public.access_plans
  ADD COLUMN IF NOT EXISTS volume_threshold_seats integer;
ALTER TABLE public.access_plans
  ADD COLUMN IF NOT EXISTS volume_price_cents integer;

DO $$
BEGIN
  ALTER TABLE public.access_plans
    ADD CONSTRAINT access_plans_volume_tier_check
    CHECK (
      (volume_threshold_seats IS NULL AND volume_price_cents IS NULL)
      OR (volume_threshold_seats >= 2 AND volume_price_cents >= 0
          AND volume_price_cents <= price_cents)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.access_plans.volume_threshold_seats IS
  'Liczba miejsc, od której obowiązuje cena wolumenowa (katalog v6.1: Zespół od 11 miejsc). NULL = plan bez progu wolumenowego.';
COMMENT ON COLUMN public.access_plans.volume_price_cents IS
  'Cena za miejsce po osiągnięciu progu wolumenowego. Cena obejmuje WSZYSTKIE miejsca w zamówieniu (tiers_mode volume u operatora), nie tylko nadwyżkę ponad próg.';

UPDATE public.access_plans
   SET volume_threshold_seats = 11,
       volume_price_cents = 7900
 WHERE tier_key = 'team'
   AND interval = 'month'::public.plan_interval
   AND volume_threshold_seats IS NULL;

-- ----------------------------------------------------------------------------
-- 2) Decision Lab: miejsce w cyklu dla podmiotu spoza partnerstwa.
--
--    NAJPIERW WARSTWA, POTEM PLAN. `access_plans.tier_key` nie ma klucza obcego,
--    ale ma trigger walidujący (`tg_access_plans_validate_tier_key`,
--    20260723120000): klucz bez odpowiednika w `membership_tiers` kończy się
--    `23503 unknown_tier_key`. Trigger jest tam po to, żeby literówka nie
--    oznaczała cichej utraty uprawnień - i słusznie nie robi wyjątku dla
--    produktów, które warstwą nie są.
--
--    Warstwa `decision_lab` jest więc WPISEM TECHNICZNYM, nie progiem drabinki:
--    `rank = 0` (nie daje nic ponad Czytelnika), `features = {}` (nie niesie
--    żadnej flagi), `active = false` (nie renderuje karty na /pricing i wypada
--    z `user_has_tier_feature`, które łączy po `mt.active`), `cta_mode = 'none'`.
--    Nie ma jej też w `TIER_RANKS` ani w `pricing_catalog_v3_rows()` - zakup
--    miejsca w cyklu nie nadaje rangi i nie może jej nadawać.
-- ----------------------------------------------------------------------------
INSERT INTO public.membership_tiers
  (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
   benefits, features, is_default, active, sort_order, audience_key, cta_mode)
SELECT t.id, 'decision_lab', 0,
       'Decision Lab', 'Decision Lab',
       'Wpis techniczny mostka plan -> warstwa dla produktu jednorazowego. Nie jest progiem członkostwa i nie nadaje żadnych uprawnień.',
       'Technical bridge row between the plan and the tier ladder for a one-off product. Not a membership tier; grants nothing.',
       '[]'::jsonb, '{}'::jsonb, false, false, 900, NULL, 'none'
  FROM public.tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.membership_tiers mt
    WHERE mt.tenant_id = t.id AND mt.key = 'decision_lab'
 );

INSERT INTO public.access_plans
  (tenant_id, name_pl, name_en, description_pl, description_en,
   price_cents, currency, interval, active, sort_order, tier_key)
SELECT t.id,
       'Decision Lab - miejsce w cyklu',
       'Decision Lab - seat in the cycle',
       'Miejsce dla podmiotu spoza partnerstwa w jednym cyklu Decision Lab: seria spotkań zakończona raportem z uzgodnionymi rekomendacjami. Partnerzy instytucjonalni mają miejsca wliczone w składkę.',
       'A seat for a non-partner organisation in one Decision Lab cycle: a series of meetings closing with a report of agreed recommendations. Institutional partners have seats included in their contribution.',
       1600000, 'PLN', 'one_time'::public.plan_interval, true, 200, 'decision_lab'
  FROM public.tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.access_plans ap
    WHERE ap.tenant_id = t.id AND ap.tier_key = 'decision_lab'
 );

-- ----------------------------------------------------------------------------
-- 3) Domeny akademickie i odpowiedź „czy prosić o legitymację".
-- ----------------------------------------------------------------------------
ALTER TABLE public.verification_domains
  ADD COLUMN IF NOT EXISTS academic boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.verification_domains.academic IS
  'Domena uczelni / instytucji naukowej. Adres w tej domenie zwalnia z ręcznej weryfikacji stawki studenckiej i akademickiej (katalog v6.1: automat tam, gdzie domena jest na liście, ręcznie wyłącznie jako wyjątek).';

CREATE OR REPLACE FUNCTION public.my_academic_domain_verification()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_tenant    uuid;
  v_email     text;
  v_domain    text;
  v_confirmed boolean := false;
  v_match     boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('automatic', false, 'domain', NULL,
                              'email_confirmed', false, 'reason', 'auth_required');
  END IF;

  SELECT p.tenant_id, p.email INTO v_tenant, v_email
    FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL OR v_email IS NULL THEN
    RETURN jsonb_build_object('automatic', false, 'domain', NULL,
                              'email_confirmed', false, 'reason', 'no_email');
  END IF;

  v_domain := lower(split_part(v_email, '@', 2));

  SELECT (u.email_confirmed_at IS NOT NULL) INTO v_confirmed
    FROM auth.users u WHERE u.id = v_uid;
  v_confirmed := COALESCE(v_confirmed, false);

  SELECT EXISTS (
    SELECT 1 FROM public.verification_domains vd
     WHERE vd.tenant_id = v_tenant
       AND vd.active
       AND vd.academic
       AND vd.domain = v_domain
       AND (v_confirmed OR NOT vd.require_email_confirmed)
  ) INTO v_match;

  RETURN jsonb_build_object(
    'automatic', v_match,
    'domain', v_domain,
    'email_confirmed', v_confirmed,
    -- Powód jest po to, żeby formularz umiał powiedzieć, CZEGO brakuje,
    -- zamiast bezwarunkowo prosić o skan legitymacji.
    'reason', CASE
      WHEN v_match THEN 'domain_listed'
      WHEN NOT v_confirmed THEN 'email_not_confirmed'
      ELSE 'domain_not_listed'
    END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_academic_domain_verification() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_academic_domain_verification() TO authenticated, service_role;

COMMENT ON FUNCTION public.my_academic_domain_verification() IS
  'Czy wołający kwalifikuje się do AUTOMATYCZNEJ weryfikacji stawki studenckiej / akademickiej na podstawie domeny e-mail z listy verification_domains (academic = true). Ręczna weryfikacja legitymacją zostaje wyjątkiem dla domen spoza listy.';

-- ----------------------------------------------------------------------------
-- 4) Panel musi umieć oznaczyć domenę jako akademicką.
--
--    Kolumna bez wejścia w panelu jest tym samym długiem, który audyt wytyka
--    modułowi darowizn: funkcja istnieje, nikt jej nie użyje. Rozszerzamy więc
--    RPC upsertu o siódmy parametr.
--
--    DROP przed CREATE, nie samo CREATE OR REPLACE: zmiana LISTY parametrów
--    zakłada u Postgresa NOWĄ funkcję obok starej (przeciążenie), a wołanie
--    parametrami nazwanymi trafiłoby wtedy na `42725 function is not unique`.
--    Stara sygnatura znika, nazwa RPC zostaje - kontrakt klienta bez zmian.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_upsert_verification_domain(
  text, text, text, boolean, boolean, text
);

CREATE OR REPLACE FUNCTION public.admin_upsert_verification_domain(
  p_domain text,
  p_badge text DEFAULT 'verified',
  p_note text DEFAULT NULL,
  p_active boolean DEFAULT true,
  p_require_email_confirmed boolean DEFAULT true,
  p_grants_tier_key text DEFAULT NULL,
  p_academic boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.admin_assert_verification_admin();
  v_domain text := lower(btrim(COALESCE(p_domain, '')));
  v_tier text := NULLIF(btrim(COALESCE(p_grants_tier_key, '')), '');
  v_id uuid;
BEGIN
  IF v_domain = '' OR v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'verification: invalid domain' USING ERRCODE = '22023';
  END IF;
  IF p_badge NOT IN ('verified', 'expert', 'staff', 'contributor') THEN
    RAISE EXCEPTION 'verification: unsupported badge' USING ERRCODE = '22023';
  END IF;
  IF v_tier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.membership_tiers mt
     WHERE mt.tenant_id = v_tenant AND mt.key = v_tier AND mt.active
  ) THEN
    RAISE EXCEPTION 'verification: unknown membership tier' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.verification_domains
    (tenant_id, domain, badge, note, active, require_email_confirmed,
     grants_tier_key, academic, created_by)
  VALUES (v_tenant, v_domain, p_badge, NULLIF(btrim(COALESCE(p_note, '')), ''),
          p_active, p_require_email_confirmed, v_tier,
          COALESCE(p_academic, false), auth.uid())
  ON CONFLICT (tenant_id, domain, badge) DO UPDATE
    SET note = EXCLUDED.note,
        active = EXCLUDED.active,
        require_email_confirmed = EXCLUDED.require_email_confirmed,
        grants_tier_key = EXCLUDED.grants_tier_key,
        academic = EXCLUDED.academic,
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_verification_domain(
  text, text, text, boolean, boolean, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_verification_domain(
  text, text, text, boolean, boolean, text, boolean
) TO authenticated, service_role;
