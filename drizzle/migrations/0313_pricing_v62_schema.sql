-- ============================================================================
-- CENNIK v6.2 (1/5): SCHEMAT - SPRZEDAŻ, WIDOCZNOŚĆ KARTY, DZIENNIK PRZECEN
--
-- Decyzje właściciela z 18.10.2026: Partner Biznesowy wycofany ze sprzedaży
-- (obecni klienci zachowują dostęp i cenę), Enterprise ukryty na /pricing
-- (próg i ranga 30 zostają), Decision Lab wyłącznie na zapytanie, a obecni
-- subskrybenci Członka / Członka Pro / Zespołu przechodzą na niższą cenę v6.2
-- od najbliższego odnowienia - akcją admina, nie automatem przy deployu.
--
-- ── 1) `access_plans.for_sale`, a NIE `active = false` ──────────────────────
-- `active = false` odcięłoby obecnych klientów Partnera Biznesowego trzema
-- drogami naraz:
--   * webhook odwzorowuje cenę na plan WYŁĄCZNIE wśród planów aktywnych
--     (`resolvePlanForPrice`, purchaseEffects.server.ts) - odnowienie nie
--     przesunęłoby `current_period_end` i dostęp wygasłby po bieżącym okresie,
--   * polityka RLS „plans public read" pokazuje zwykłemu użytkownikowi tylko
--     plany aktywne - profil subskrybenta dostałby `plan = null`,
--   * synchronizacja katalogu archiwizuje u operatora ceny planów nieaktywnych.
-- Osobna kolumna mówi tylko jedno: „plan przyjmuje NOWY zakup samoobsługowy".
-- Czytają ją obie kasy, reguła zmiany planu i strażnik `payment_orders`
-- (20261018160400); webhook, RLS, uprawnienia i katalog Stripe zostają bez
-- zmian, więc trwające subskrypcje odnawiają się po swojej cenie.
--
-- ── 2) `membership_tiers.pricing_visible`, a NIE `active = false` ───────────
-- `active = false` wyłącza uprawnienia - `user_has_tier_feature`
-- i `user_tier_rank` łączą się z progiem po `mt.active` - a ranga 30
-- Enterprise jest też progiem klubów. Pusty `audience_key` nie ukrywa karty,
-- bo selektor `tiersForAudience` przerzuca taki próg do pierwszego segmentu.
-- Kolumnę czytają WYŁĄCZNIE powierzchnie publiczne (/pricing,
-- /membership-join, macierz porównania); pickery panelu admina (organizacje,
-- granty, kluby) dalej widzą wszystkie progi.
--
-- ── 3) `subscription_price_migrations` ──────────────────────────────────────
-- Dziennik akcji „przenieś trwające subskrypcje na cenę katalogu v6.2".
-- Jeden wiersz na (środowisko, subskrypcja u operatora, cena docelowa) -
-- to jest pierwsza z trzech warstw idempotencji (druga: klucz idempotencji
-- Stripe z odcisku stanu, trzecia: klucz idempotencji maila). Tabela
-- wyłącznie dla service_role, bez polityk RLS (wzorem
-- `billing_probe_credentials`): panel czyta ją przez server function z bramką
-- admina + MFA i filtrem `tenant_id` z sesji, nigdy wprost z przeglądarki.
-- Brak DELETE i TRUNCATE dla service_role - to dziennik audytowy, nie stan
-- roboczy (REVOKE ALL także z service_role, patrz niżej).
--
-- RODO: WPIS ZNIKA RAZEM Z KONTEM (CASCADE, nie SET NULL). Wiersz niesie
-- `provider_subscription_id` (sub_...), który u operatora prowadzi wprost do
-- klienta (imię, e-mail), oraz kwoty i daty - po usunięciu konta zostałby
-- pseudonimem bez podstawy i bez terminu (art. 5 ust. 1 lit. e, art. 17).
-- Dziennik NIE jest dowodem księgowym: dowodami zostają `payment_orders`
-- (pseudonim, retencja 5 lat) i `billing_documents`. Ten sam wzorzec co
-- 20261018150000 (`user_subscriptions`) i lustro `subscriptions`, które
-- kasuje się kaskadowo z kontem - dziennik idzie za lustrem i za kontem.
-- Retencja ponad to nie jest potrzebna: wpis żyje tyle, co subskrypcja
-- w lustrze, a kampania jest jednorazowa.
--
-- WPIS `applied` JEST NIENARUSZALNY. Ponowny przebieg (ten sam klucz
-- unikalny) nie może nadpisać śladu wykonanej zmiany wpisem `skipped` albo
-- `failed` - strażnik niżej zostawia taki wiersz bez zmian (zmiana samego
-- `email_status` przy `applied` przechodzi). Wpis intencji zapisywany PRZED
-- mutacją u operatora ma status `failed` z kodem `in_progress`: przerwany
-- przebieg zostawia ślad, a ponowne „Wykonaj" rozpoznaje zmianę, która u
-- operatora jednak weszła, i dokańcza wpis `applied` oraz mail.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Plan w sprzedaży.
-- ----------------------------------------------------------------------------
ALTER TABLE public.access_plans
  ADD COLUMN IF NOT EXISTS for_sale boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.access_plans.for_sale IS
  'Plan przyjmuje NOWY zakup samoobsługowy (kasa, zmiana planu). false = wycofany ze sprzedaży albo na zapytanie; subskrypcje już trwające odnawiają się bez zmian (active zostaje true - webhook, RLS i katalog Stripe go potrzebują).';

-- ----------------------------------------------------------------------------
-- 2) Karta progu na publicznym cenniku.
-- ----------------------------------------------------------------------------
ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS pricing_visible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.membership_tiers.pricing_visible IS
  'Karta progu na publicznym cenniku (/pricing, /membership-join, macierz porównania). false = próg działa (ranga, features, granty, kluby), ale nie jest oferowany publicznie.';

-- ----------------------------------------------------------------------------
-- 3) Dziennik przeniesienia trwających subskrypcji na cenę katalogu.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_price_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Kampania przeceny: dziś jedna (`pricing_v62`), ale klucz zostaje w wierszu,
  -- żeby kolejna zmiana cennika nie mieszała się z tą w raportach.
  campaign text NOT NULL DEFAULT 'pricing_v62' CHECK (campaign ~ '^[a-z0-9_]{1,40}$'),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  -- Wpis idzie za lustrem `subscriptions` (kasowanym kaskadowo z kontem) -
  -- patrz „RODO" w nagłówku.
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  provider_subscription_id text NOT NULL CHECK (provider_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  -- Dane osobowe ograniczone do identyfikatora konta; bez e-maili i nazw.
  -- Usunięcie konta kasuje wpis (RODO, nagłówek).
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  lookup_key text NOT NULL CHECK (lookup_key ~ '^[a-z0-9_]{1,64}$'),
  from_provider_price_id text NOT NULL CHECK (from_provider_price_id ~ '^price_[A-Za-z0-9]+$'),
  to_provider_price_id text NOT NULL CHECK (to_provider_price_id ~ '^price_[A-Za-z0-9]+$'),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 500),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billing_interval text NOT NULL
    CHECK (billing_interval IN ('two_weeks', 'month', 'quarter', 'year')),
  -- Kwoty za CAŁĄ pozycję (cena × ilość, z progiem wolumenowym), przed rabatem
  -- i podatkiem - to samo, co pokazuje podgląd w panelu.
  from_amount_cents integer NOT NULL CHECK (from_amount_cents >= 0),
  to_amount_cents integer NOT NULL CHECK (to_amount_cents >= 0),
  -- Pierwsza faktura po nowej cenie (koniec triala albo bieżącego okresu).
  effective_at timestamptz,
  status text NOT NULL CHECK (status IN ('applied', 'skipped', 'failed')),
  -- Kod powodu (pominięcia albo błędu), nigdy treść błędu operatora - ta
  -- potrafi nieść dane osobowe klienta.
  reason text CHECK (reason IS NULL OR reason ~ '^[a-z_]{1,64}$'),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  applied_at timestamptz,
  email_status text NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'queued', 'skipped', 'failed')),
  email_queued_at timestamptz,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_price_migrations_target_key
    UNIQUE (environment, provider_subscription_id, to_provider_price_id),
  CONSTRAINT subscription_price_migrations_applied_at_check
    CHECK (status <> 'applied' OR applied_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS subscription_price_migrations_tenant_idx
  ON public.subscription_price_migrations (tenant_id, campaign, created_at DESC);

-- Kaskady z konta i z lustra szukają wpisów po tych kolumnach.
CREATE INDEX IF NOT EXISTS subscription_price_migrations_user_idx
  ON public.subscription_price_migrations (user_id);
CREATE INDEX IF NOT EXISTS subscription_price_migrations_subscription_idx
  ON public.subscription_price_migrations (subscription_id);

-- Strażnik wpisu `applied` (nagłówek): UPDATE, który zmieniłby status
-- wykonanej zmiany, zostaje pominięty dla tego wiersza (RETURN NULL), więc
-- upsert ponownego przebiegu nie gubi śladu ani daty wykonania. Nazwa
-- wyzwalacza sortuje się PRZED `..._set_updated_at` - pominięty wiersz nie
-- dostaje też nowego `updated_at`.
CREATE OR REPLACE FUNCTION public.subscription_price_migrations_keep_applied()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'applied' AND NEW.status IS DISTINCT FROM 'applied' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Funkcja wyzwalacza: wykonuje ją silnik przy UPDATE, nie wołający.
REVOKE EXECUTE ON FUNCTION public.subscription_price_migrations_keep_applied()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS subscription_price_migrations_keep_applied
  ON public.subscription_price_migrations;
CREATE TRIGGER subscription_price_migrations_keep_applied
  BEFORE UPDATE ON public.subscription_price_migrations
  FOR EACH ROW EXECUTE FUNCTION public.subscription_price_migrations_keep_applied();

DROP TRIGGER IF EXISTS subscription_price_migrations_set_updated_at
  ON public.subscription_price_migrations;
CREATE TRIGGER subscription_price_migrations_set_updated_at
  BEFORE UPDATE ON public.subscription_price_migrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.subscription_price_migrations ENABLE ROW LEVEL SECURITY;
-- service_role TAKŻE w REVOKE: domyślne uprawnienia schematu `public` na
-- produkcji (pg_default_acl roli postgres, zmierzone 2026-10-12 -
-- 20261012210000) dają mu `arwdDxtm` na każdą nową tabelę, więc sam GRANT
-- niżej zostawiał DELETE i TRUNCATE. Skasowany wpis to zgubiona pierwsza
-- warstwa idempotencji (ponowne „Wykonaj" nie rozpozna zmiany, która weszła
-- u operatora) i ślad audytowy. Kaskady kluczy obcych (RODO) działają
-- z prawami właściciela tabeli - wzorzec 20261012130600.
REVOKE ALL ON public.subscription_price_migrations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.subscription_price_migrations TO service_role;

COMMENT ON TABLE public.subscription_price_migrations IS
  'Dziennik przeniesienia trwających subskrypcji na cenę katalogu (kampania pricing_v62). Jeden wiersz na (środowisko, subskrypcja, cena docelowa) = klucz idempotencji. Tylko service_role; panel czyta przez server fn z filtrem tenant_id z sesji.';
