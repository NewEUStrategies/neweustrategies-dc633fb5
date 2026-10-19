-- ============================================================================
-- CENNIK v6.2 (4/5): SEED NOWYCH NAJEMCÓW I APPLY U ISTNIEJĄCYCH
--
-- Ceny v6.2 (docs/cennik-nes-v6.2.html): Członek 39 zł/mies. i 390 zł/rok,
-- Członek Pro 119 zł/mies. i 1 190 zł/rok, Zespół 89 zł za miejsce (próg
-- wolumenowy od 11 miejsc: 79 zł - mechanizm z 20260822094000 zostaje),
-- student 19 zł/mies. i NOWY plan roczny 190 zł, kadra akademicka 29 zł/mies.
-- Progi Rada Instytutu, Partner Instytucjonalny, Partner Strategiczny i Krąg
-- Założycieli nie mają planu - cena „od" stoi w `price_note_*`. Zespół ma plan
-- (cena na karcie, mechanizm wolumenowy u operatora), ale sprzedaje się przez
-- rozmowę: `for_sale = false` jak Decision Lab.
--
-- ── DLACZEGO TU ZMIENIAMY `access_plans`, A NIE STRIPE ─────────────────────
-- `access_plans` jest źródłem prawdy cennika: `catalogSync.server.ts` po
-- zmianie kwoty zakłada u operatora NOWĄ cenę z tym samym `lookup_key`
-- (`transfer_lookup_key`), a starą archiwizuje. Trwające subskrypcje zostają
-- na starych, zarchiwizowanych cenach, dopóki admin nie wykona akcji
-- przeniesienia (panel /admin/billing, decyzja 2) - NIC nie dzieje się
-- z subskrypcjami klientów przy deployu tej migracji.
--
-- ── SEED (nowy najemca, trigger `tenants_seed_pricing_defaults`) ────────────
-- Dotychczasowy `seed_pricing_defaults` (20260724090000) składał stan z v3,
-- punktowych łatek features i benefitów v4/v5: świeży najemca dostawał ceny
-- v3, trial 0 dni, brak Decision Labu, brak progu wolumenowego, Członka
-- z `early_access` i benefity sprzed v6.1. Nowe ciało czyta katalog v6.2
-- z pełnymi features (20261018160100) - koniec składania stanu z historii.
--
-- ── APPLY (najemcy istniejący, po kluczach) ─────────────────────────────────
-- `apply_pricing_catalog_v62(p_tenant)` aktualizuje po `membership_tiers.key`
-- i po parze `(access_plans.tier_key, interval)`, nigdy po UUID. Zmienia
-- prezentację i ceny; `features`, `rank`, `active` i `is_default` zostają -
-- v6.2 nie zmienia mechaniki, a ręczne flagi admina muszą przetrwać zmianę
-- cennika. Każdy UPDATE ma strażnik IS DISTINCT FROM: powtórka nie dotyka
-- `updated_at` i nie emituje drugi raz zdarzeń domenowych
-- (`access_plan.changed.v1`, `membership_tier.changed.v1`).
--
-- Apply NIE odtwarza progów ani planów, które admin najemcy świadomie
-- usunął: seed (`seed_membership_tiers`, `seed_decision_lab_product`,
-- `seed_pricing_plans_v62`) woła wyłącznie `seed_pricing_defaults` nowego
-- najemcy. Jedyny wiersz, który apply DOKŁADA, to roczny plan studencki - i to
-- tylko tam, gdzie najemca sprzedaje miesięczny (domknięcie pary v6.2).
--
-- Stare funkcje (`seed_pricing_plans_v3`, `apply_pricing_catalog_v3/v4/v5`,
-- `pricing_catalog_v3_rows`) zostają nietknięte: migracje są forward-only,
-- a aplikacja ich nie woła.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Seed progów: brakujące klucze z katalogu v6.2, z benefitami i features.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_membership_tiers(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.membership_tiers
    (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
     benefits, features, is_default, sort_order, audience_key,
     badge_pl, badge_en, highlight, per_seat, price_note_pl, price_note_en,
     cta_mode, pricing_visible)
  SELECT p_tenant, v.key, v.rank, v.name_pl, v.name_en, v.desc_pl, v.desc_en,
         COALESCE(b.benefits, '[]'::jsonb), v.features, v.is_default, v.sort_order,
         v.audience_key, v.badge_pl, v.badge_en, v.highlight, v.per_seat,
         v.price_note_pl, v.price_note_en, v.cta_mode, v.pricing_visible
    FROM public.pricing_catalog_v62_rows() v
    LEFT JOIN public.pricing_catalog_v62_benefits() b ON b.key = v.key
   WHERE NOT EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = p_tenant AND mt.key = v.key
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Decision Lab: wpis techniczny + plan jednorazowy, który NIE jest w sprzedaży.
--
--    NAJPIERW WARSTWA, POTEM PLAN: `tg_access_plans_validate_tier_key`
--    (20260723120000) odrzuca `tier_key` bez odpowiednika w `membership_tiers`.
--    Warstwa ma `rank = 0`, `features = {}`, `active = false` - zakup miejsca
--    w cyklu nie nadaje żadnej rangi (20260822094000). Plan `for_sale = false`:
--    v6.2 sprzedaje Decision Lab wyłącznie przez rozmowę (`isEnquiryOnlyPlan`
--    w kodzie jest pierwszym zamkiem, ta kolumna - drugim, w bazie).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_decision_lab_product(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.membership_tiers
    (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
     benefits, features, is_default, active, sort_order, audience_key, cta_mode)
  SELECT p_tenant, 'decision_lab', 0, 'Decision Lab', 'Decision Lab',
         'Wpis techniczny mostka plan -> warstwa dla produktu jednorazowego. Nie jest progiem członkostwa i nie nadaje żadnych uprawnień.',
         'Technical bridge row between the plan and the tier ladder for a one-off product. Not a membership tier; grants nothing.',
         '[{"pl":"Jedno miejsce w pełnym cyklu Decision Lab - cztery zamknięte sesje robocze","en":"One seat in the full Decision Lab cycle - four closed working sessions"},
           {"pl":"Raport końcowy z rekomendacjami dla Twojej organizacji","en":"A closing report with recommendations for your organisation"},
           {"pl":"Praca w gronie analityków, praktyków i decydentów prowadzona przez ekspertów New European Strategies","en":"Work alongside analysts, practitioners and decision-makers, led by New European Strategies experts"},
           {"pl":"Materiały robocze, notatki i nagrania z każdej sesji","en":"Working materials, notes and recordings from every session"},
           {"pl":"Faktura wystawiana na organizację, zakup jednorazowy bez subskrypcji","en":"Invoice issued to the organisation, a one-time purchase with no subscription"}]'::jsonb,
         '{}'::jsonb, false, false, 900, NULL, 'none'
   WHERE NOT EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = p_tenant AND mt.key = 'decision_lab'
   );

  INSERT INTO public.access_plans
    (tenant_id, name_pl, name_en, description_pl, description_en,
     price_cents, currency, interval, active, sort_order, tier_key, trial_days, for_sale)
  SELECT p_tenant,
         'Decision Lab - miejsce w cyklu',
         'Decision Lab - seat in the cycle',
         'Miejsce dla podmiotu spoza partnerstwa w jednym cyklu Decision Lab: seria spotkań zakończona raportem z uzgodnionymi rekomendacjami. Partnerzy instytucjonalni mają miejsca wliczone w składkę.',
         'A seat for a non-partner organisation in one Decision Lab cycle: a series of meetings closing with a report of agreed recommendations. Institutional partners have seats included in their contribution.',
         1600000, 'PLN', 'one_time'::public.plan_interval, true, 200, 'decision_lab', 0, false
   WHERE NOT EXISTS (
     SELECT 1 FROM public.access_plans ap
      WHERE ap.tenant_id = p_tenant AND ap.tier_key = 'decision_lab'
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_decision_lab_product(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_decision_lab_product(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) Plany v6.2: brakujące pary (tier_key, interval). BEZ Partnera Biznesowego
--    (wycofany ze sprzedaży - nowy najemca go nie dostaje). Trial 7 dni jak
--    u najemców istniejących (20260801184937). Plan wyłącznie dla progu, który
--    najemca ma - inaczej trigger walidujący `tier_key` przerwałby migrację
--    u najemcy, który świadomie usunął próg.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_pricing_plans_v62(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.access_plans
    (tenant_id, name_pl, name_en, price_cents, currency, interval, active,
     sort_order, tier_key, trial_days, volume_threshold_seats, volume_price_cents)
  SELECT p_tenant, v.name_pl, v.name_en, v.price_cents, 'PLN',
         v.plan_interval::public.plan_interval, true, v.sort_order, v.tier_key, 7,
         v.vol_seats, v.vol_cents
    FROM (VALUES
      ('Członek - miesięcznie', 'Member - monthly', 3900, 'month', 10, 'member', NULL::integer, NULL::integer),
      ('Członek - rocznie', 'Member - annual', 39000, 'year', 20, 'member', NULL, NULL),
      ('Członek Pro - miesięcznie', 'Member Pro - monthly', 11900, 'month', 30, 'pro', NULL, NULL),
      ('Członek Pro - rocznie', 'Member Pro - annual', 119000, 'year', 40, 'pro', NULL, NULL),
      ('Student i Doktorant - miesięcznie', 'Student & Doctoral - monthly', 1900, 'month', 50, 'student', NULL, NULL),
      ('Student i Doktorant - rocznie', 'Student & Doctoral - annual', 19000, 'year', 55, 'student', NULL, NULL),
      ('Kadra Akademicka - miesięcznie', 'Academic Faculty - monthly', 2900, 'month', 60, 'educator', NULL, NULL),
      ('Zespół - za miejsce, miesięcznie', 'Team - per seat, monthly', 8900, 'month', 70, 'team', 11, 7900)
    ) AS v(name_pl, name_en, price_cents, plan_interval, sort_order, tier_key, vol_seats, vol_cents)
   WHERE EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = p_tenant AND mt.key = v.tier_key
   )
     AND NOT EXISTS (
     SELECT 1 FROM public.access_plans ap
      WHERE ap.tenant_id = p_tenant
        AND ap.tier_key = v.tier_key
        AND ap.interval = v.plan_interval::public.plan_interval
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_plans_v62(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_plans_v62(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Apply v6.2 u najemcy: prezentacja, ceny, wycofanie ze sprzedaży, FAQ.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_pricing_catalog_v62(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'apply_pricing_catalog_v62: tenant required' USING ERRCODE = '22004';
  END IF;

  -- Prezentacja progów v6.2. Highlight ustawiany deterministycznie po kluczu
  -- (wyłącznie Członek Pro) - neutralizuje to też 20260722203317, która
  -- wyróżniała karty po trzech UUID najemcy domyślnego.
  UPDATE public.membership_tiers mt
     SET name_pl = v.name_pl,
         name_en = v.name_en,
         description_pl = v.desc_pl,
         description_en = v.desc_en,
         benefits = b.benefits,
         audience_key = v.audience_key,
         sort_order = v.sort_order,
         badge_pl = v.badge_pl,
         badge_en = v.badge_en,
         highlight = v.highlight,
         per_seat = v.per_seat,
         price_note_pl = v.price_note_pl,
         price_note_en = v.price_note_en,
         cta_mode = v.cta_mode,
         pricing_visible = v.pricing_visible
    FROM public.pricing_catalog_v62_rows() v
    JOIN public.pricing_catalog_v62_benefits() b ON b.key = v.key
   WHERE mt.tenant_id = p_tenant
     AND mt.key = v.key
     AND v.apply_presentation
     AND (mt.name_pl, mt.name_en, mt.description_pl, mt.description_en, mt.benefits,
          mt.audience_key, mt.sort_order, mt.badge_pl, mt.badge_en, mt.highlight,
          mt.per_seat, mt.price_note_pl, mt.price_note_en, mt.cta_mode, mt.pricing_visible)
         IS DISTINCT FROM
         (v.name_pl, v.name_en, v.desc_pl, v.desc_en, b.benefits,
          v.audience_key, v.sort_order, v.badge_pl, v.badge_en, v.highlight,
          v.per_seat, v.price_note_pl, v.price_note_en, v.cta_mode, v.pricing_visible);

  -- Progi poza prezentacją v6.2 (Partner Biznesowy, Enterprise): wyłącznie
  -- widoczność karty i brak wyróżnienia. Treść zostaje - obecni klienci
  -- Partnera Biznesowego widzą swoje benefity w profilu.
  UPDATE public.membership_tiers mt
     SET pricing_visible = v.pricing_visible,
         highlight = false
    FROM public.pricing_catalog_v62_rows() v
   WHERE mt.tenant_id = p_tenant
     AND mt.key = v.key
     AND NOT v.apply_presentation
     AND (mt.pricing_visible, mt.highlight) IS DISTINCT FROM (v.pricing_visible, false);

  -- Ceny i nazwy planów v6.2 po (tier_key, interval) - także ewentualne
  -- duplikaty pary. Cena i próg wolumenowy w JEDNYM UPDATE: CHECK
  -- `access_plans_volume_tier_check` liczy się na wierszu wynikowym
  -- (7 900 <= 8 900), a dwa osobne UPDATE-y mogłyby przejść przez stan
  -- pośredni łamiący warunek.
  UPDATE public.access_plans ap
     SET price_cents = v.price_cents,
         name_pl = v.name_pl,
         name_en = v.name_en,
         volume_threshold_seats = v.vol_seats,
         volume_price_cents = v.vol_cents
    FROM (VALUES
      ('member', 'month', 3900, 'Członek - miesięcznie', 'Member - monthly', NULL::integer, NULL::integer),
      ('member', 'year', 39000, 'Członek - rocznie', 'Member - annual', NULL, NULL),
      ('pro', 'month', 11900, 'Członek Pro - miesięcznie', 'Member Pro - monthly', NULL, NULL),
      ('pro', 'year', 119000, 'Członek Pro - rocznie', 'Member Pro - annual', NULL, NULL),
      ('student', 'month', 1900, 'Student i Doktorant - miesięcznie', 'Student & Doctoral - monthly', NULL, NULL),
      ('educator', 'month', 2900, 'Kadra Akademicka - miesięcznie', 'Academic Faculty - monthly', NULL, NULL),
      ('team', 'month', 8900, 'Zespół - za miejsce, miesięcznie', 'Team - per seat, monthly', 11, 7900)
    ) AS v(tier_key, plan_interval, price_cents, name_pl, name_en, vol_seats, vol_cents)
   WHERE ap.tenant_id = p_tenant
     AND ap.tier_key = v.tier_key
     AND ap.interval = v.plan_interval::public.plan_interval
     AND (ap.price_cents, ap.name_pl, ap.name_en, ap.volume_threshold_seats, ap.volume_price_cents)
         IS DISTINCT FROM (v.price_cents, v.name_pl, v.name_en, v.vol_seats, v.vol_cents);

  -- Nowa para v6.2: student 190 zł/rok obok 19 zł/mies. Wyłącznie u najemcy,
  -- który sprzedaje plan miesięczny - inaczej dokładalibyśmy ofertę tam, gdzie
  -- admin progu studenckiego świadomie nie prowadzi.
  INSERT INTO public.access_plans
    (tenant_id, name_pl, name_en, price_cents, currency, interval, active,
     sort_order, tier_key, trial_days)
  SELECT p_tenant, 'Student i Doktorant - rocznie', 'Student & Doctoral - annual',
         19000, m.currency, 'year'::public.plan_interval, true, 55, 'student', m.trial_days
    FROM public.access_plans m
   WHERE m.tenant_id = p_tenant
     AND m.tier_key = 'student'
     AND m.interval = 'month'::public.plan_interval
     AND m.active
     AND NOT EXISTS (
       SELECT 1 FROM public.access_plans y
        WHERE y.tenant_id = p_tenant
          AND y.tier_key = 'student'
          AND y.interval = 'year'::public.plan_interval
     )
   ORDER BY m.sort_order, m.created_at
   LIMIT 1;

  -- Poza sprzedażą samoobsługową: Partner Biznesowy (wycofany, decyzja 3),
  -- Decision Lab (na zapytanie, decyzja 5) i Zespół (v6.2: „3-20 miejsc ·
  -- rozmowa"; kasa nie zna liczby miejsc ani zakresu 3-20, więc plan za
  -- miejsce sprzedawany z widżetu albo /checkout/<id> szedł po 1 miejscu).
  -- `active` zostaje true - odnowienia, zmiany miejsc i webhook obecnych
  -- klientów działają (nagłówek 20261018160000); karta Zespołu dalej pokazuje
  -- cenę 89 zł z przyciskiem rozmowy.
  UPDATE public.access_plans
     SET for_sale = false
   WHERE tenant_id = p_tenant
     AND tier_key IN ('business', 'decision_lab', 'team')
     AND for_sale;

  -- FAQ bez klucza - identyfikujemy je dokładnym pytaniem z seedu
  -- (20260730200314). Pytanie o produkt, którego nie da się kupić (Partner
  -- Biznesowy), i porównanie z ofertą korporacyjną, której karta jest ukryta
  -- (Enterprise) - opisujące przy tym Zespół jako „samoobsługowy" -
  -- wprowadzałyby w błąd na /pricing.
  UPDATE public.pricing_faq_items
     SET active = false
   WHERE tenant_id = p_tenant
     AND audience_key = 'business'
     AND question_pl IN ('Jak działa rozliczenie planu Partner Biznesowy?',
                         'Czym plan korporacyjny różni się od zespołowego?')
     AND active;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_pricing_catalog_v62(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pricing_catalog_v62(uuid) TO service_role;

COMMENT ON FUNCTION public.apply_pricing_catalog_v62(uuid) IS
  'Stan cennika v6.2 u najemcy, po kluczach (membership_tiers.key, access_plans.tier_key+interval). Prezentacja i ceny - bez features/rank/active/is_default. Idempotentna.';

-- ----------------------------------------------------------------------------
-- 5) Seed nowego najemcy (trigger tenants_seed_pricing_defaults,
--    20260722194752). Zastępuje ciało z 20260724090000.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_pricing_defaults(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.seed_pricing_audiences(p_tenant);
  PERFORM public.seed_membership_tiers(p_tenant);
  PERFORM public.seed_decision_lab_product(p_tenant);
  PERFORM public.seed_pricing_plans_v62(p_tenant);
  PERFORM public.seed_pricing_faq(p_tenant);
  PERFORM public.seed_retention_defaults(p_tenant);
  -- Wycofanie ze sprzedaży i FAQ. Progi i plany świeżo wstawione apply zastaje
  -- już w stanie v6.2 - strażniki IS DISTINCT FROM nic w nich nie zmieniają.
  PERFORM public.apply_pricing_catalog_v62(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Najemcy istniejący - po kluczach, idempotentnie.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    PERFORM public.apply_pricing_catalog_v62(r.id);
  END LOOP;
END;
$$;
