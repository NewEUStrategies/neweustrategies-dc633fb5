-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9b, 4/5): ZESPÓŁ 3-20 MIEJSC - GÓRNY LIMIT 20
-- MIEJSC ORGANIZACJI NA PROGU `team`, EGZEKWOWANY W BAZIE.
-- Decyzja właściciela 2026-10-20 (zgoda delegowana), pozycja 3 listy
-- obietnic v6.2 bez pokrycia (PR #520).
--
-- DEFEKT
--   Katalog v6.2 sprzedaje Zespół jako „3-20 miejsc", a powyżej 20 kieruje
--   do Enterprise. Mechanizm miejsc (`member_organizations.seats_limit`
--   1-500, `organization_seats`, `org_add_seat`, `org_set_seats_limit`,
--   `org_apply_subscription_seats`) nie znał progu: organizacja Zespołu
--   dostawała dowolny limit do 500 i dowolną liczbę aktywnych miejsc - pięć
--   ścieżek zapisu (formularz panelu, RPC właściciela i admina, webhook
--   operatora, bezpośredni zapis tabeli przez politykę admina) i żadna nie
--   pilnowała obietnicy.
--
-- ZMIANA (autorytet w bazie - każda ścieżka zapisu przechodzi przez wyzwalacz)
--   A. `tg_member_organizations_team_seat_cap` (BEFORE INSERT OR UPDATE OF
--      tier_key, seats_limit): organizacja na progu `team` nie dostaje
--      limitu > 20 - przy zakładaniu, przy przejściu na `team` i przy
--      PODNIESIENIU limitu. Istniejąca organizacja ponad limitem zostaje
--      (bez usuwania miejsc i bez blokady innych zmian), może tylko obniżać.
--   B. `tg_organization_seats_team_seat_cap` (BEFORE INSERT OR UPDATE OF
--      org_id): nowe aktywne miejsce w organizacji Zespołu tylko, gdy
--      aktywnych jest < 20 - także w organizacji, która ma limit ponad 20
--      sprzed tej migracji („blokuje tylko dodawanie"). Zmiana statusu
--      (przeliczenie karencji `org_reconcile_seats`) NIE jest dodawaniem
--      i przechodzi - inaczej obniżenie limitu u takiej organizacji
--      wywracałoby się na własnym przeliczeniu. Blokada wiersza organizacji
--      (FOR UPDATE, jak `org_add_seat`) szereguje równoległe zaproszenia.
--   Odrzucenie, nigdy przycięcie (AGENTS.md): `23514` z komunikatem
--   `orgs: team seats max` - panel mapuje go na tekst PL/EN z sugestią
--   Enterprise. Ta sama liczba w TS: `TEAM_TIER_MAX_SEATS`
--   (src/lib/organizations/teamSeats.ts) - parytet w teście.
--   Minimum 3 to warunek SPRZEDAŻY, nie przydziału (miejsca dodaje się po
--   jednym) - baza go nie egzekwuje, panel ostrzega.
--
-- CZEGO TO NIE ROBI. Webhook operatora z ilością > 20 dla Zespołu dostaje
-- odmowę (`org_apply_subscription_seats` -> `applySubscriptionSeats` loguje
-- „seats sync failed" i zostawia dotychczasowy limit) - taka ilość to oferta
-- Enterprise, nie Zespół; admin przenosi organizację na Enterprise w panelu.
--
-- KOLEJNOŚĆ WDROŻENIA: dowolna po tabelach organizacji (20260713174428).
-- Wyzwalacze BEFORE na gorących tabelach organizacji - `lock_timeout`.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe nazwy - bez CIALO-Z),
-- DROP TRIGGER IF EXISTS + CREATE, bezstanowe REVOKE.
-- DOWÓD: supabase/tests/hub_i9b_team_seat_cap_test.sql (limit przy
-- zakładaniu, przejściu i podniesieniu; obniżenie u organizacji ponad
-- limitem; 20. miejsce przechodzi, 21. nie - także przez `org_add_seat`;
-- przeliczenie karencji przechodzi; inne progi bez zmian),
-- src/lib/organizations/__tests__/teamSeatCap.test.ts (parytet 20 TS ⇄ SQL).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Limit organizacji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_member_organizations_team_seat_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_team_max CONSTANT integer := 20;
BEGIN
  IF NEW.tier_key = 'team'
     AND NEW.seats_limit > c_team_max
     AND (TG_OP = 'INSERT'
          OR OLD.tier_key IS DISTINCT FROM 'team'
          OR NEW.seats_limit > OLD.seats_limit) THEN
    RAISE EXCEPTION 'orgs: team seats max'
      USING ERRCODE = '23514',
            DETAIL = format('Zespół: maksymalnie %s miejsc (cennik v6.2), żądane %s.', c_team_max, NEW.seats_limit),
            HINT = 'Powyżej 20 miejsc - próg Enterprise.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_member_organizations_team_seat_cap() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_member_organizations_team_seat_cap() IS
  'Hub I9b: organizacja na progu team ma limit miejsc <= 20 (cennik v6.2, TEAM_TIER_MAX_SEATS w TS) - przy zakładaniu, przejściu na team i podniesieniu; obniżenie zawsze przechodzi. 23514 orgs: team seats max.';

-- ----------------------------------------------------------------------------
-- B) Dodawanie miejsc.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_organization_seats_team_seat_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_team_max CONSTANT integer := 20;
  v_tier text;
  v_active integer;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.org_id IS NOT DISTINCT FROM NEW.org_id THEN
    RETURN NEW;
  END IF;
  SELECT mo.tier_key INTO v_tier
    FROM public.member_organizations mo
   WHERE mo.id = NEW.org_id
     FOR UPDATE;
  IF v_tier IS DISTINCT FROM 'team' THEN
    RETURN NEW;
  END IF;
  SELECT count(*)::integer INTO v_active
    FROM public.organization_seats s
   WHERE s.org_id = NEW.org_id
     AND s.status = 'active'
     AND s.id IS DISTINCT FROM NEW.id;
  IF v_active >= c_team_max THEN
    RAISE EXCEPTION 'orgs: team seats max'
      USING ERRCODE = '23514',
            DETAIL = format('Zespół: maksymalnie %s aktywnych miejsc (cennik v6.2).', c_team_max),
            HINT = 'Powyżej 20 miejsc - próg Enterprise.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_organization_seats_team_seat_cap() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_organization_seats_team_seat_cap() IS
  'Hub I9b: nowe aktywne miejsce w organizacji team tylko przy < 20 aktywnych (także u organizacji z limitem ponad 20 sprzed I9b); zmiana statusu (karencja) nie jest dodawaniem. 23514 orgs: team seats max.';

-- ----------------------------------------------------------------------------
-- C) Wyzwalacze.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_member_organizations_team_seat_cap ON public.member_organizations;
CREATE TRIGGER trg_member_organizations_team_seat_cap
  BEFORE INSERT OR UPDATE OF tier_key, seats_limit ON public.member_organizations
  FOR EACH ROW EXECUTE FUNCTION public.tg_member_organizations_team_seat_cap();

DROP TRIGGER IF EXISTS trg_organization_seats_team_seat_cap ON public.organization_seats;
CREATE TRIGGER trg_organization_seats_team_seat_cap
  BEFORE INSERT OR UPDATE OF org_id ON public.organization_seats
  FOR EACH ROW EXECUTE FUNCTION public.tg_organization_seats_team_seat_cap();

RESET lock_timeout;
