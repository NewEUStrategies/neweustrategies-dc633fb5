-- ============================================================================
-- Event Builder, etap 3: WEJSCIOWKI, PAKIETY I KUPONY
--
-- CO ZAMAWIAJACY POPROSIL: wejsciowki indywidualne, pakiety dla firm i NGO oraz
-- dla kadry akademickiej, plus kupony rabatowe jako generowane kody.
--
-- CZEGO NIE BUDUJEMY, BO JUZ JEST. Zanim powstala ta migracja, przeszukano
-- repozytorium. Platforma ma dzialajacy silnik kuponow, i nie jest to szkic:
--   * `b2b_coupons` (20260721070203) - kod, rabat procentowy albo kwotowy
--     z CHECK-iem na spojnosc ksztaltu, okno waznosci, limit uzyc, licznik uzyc;
--   * `b2b_coupon_redemptions` - ksiega uzyc z kwota przed i po rabacie;
--   * `b2b_coupon_campaigns` (20260721082414) - KAMPANIA generujaca kody wsadowo:
--     prefiks, dlugosc kodu, liczba kodow do 10000, limit uzyc na kod;
--   * `bulk_generate_coupons_for_campaign(uuid)` - generator z alfabetem
--     'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', czyli BEZ znakow mylacych (I, O, 0, 1);
--   * `validate_b2b_coupon(...)` i `redeem_b2b_coupon_with_effects(...)`;
--   * po stronie klienta `src/lib/billing/coupons.ts` i `useValidateCoupon`.
-- Drugi silnik kuponow byl by bledem: dwie ksiegi uzyc tego samego kodu to dwa
-- rozne stany prawdy o tym, czy rabat zostal wykorzystany.
--
-- ISTOTNE OGRANICZENIE, KTORE TA MIGRACJA ZDEJMUJE. Tamten silnik jest zakresowany
-- WYLACZNIE na plany: `b2b_coupons.plan_ids uuid[]`. Kuponu nie da sie dzisiaj
-- przypisac ani do wydarzenia, ani do rodzaju wejsciowki - wiec rabat na bilet
-- jest nieosiagalny. Dokladamy zakres wydarzeniowy do TEJ SAMEJ tabeli.
--
-- CZEGO NIE BUDUJEMY, BO JUZ JEST (weryfikacja akademicka). `verification_domains`
-- ma kolumne `academic` (20260822171037), a `my_academic_domain_verification()`
-- (20260822094000) rozstrzyga stawke akademicka po domenie poczty. Komentarz tamtej
-- migracji mowi wprost, ze weryfikacja reczna legitymacja zostaje WYJATKIEM dla
-- domen spoza listy - i ten wyjatek do dzisiaj nie mial nosnika. Dostaje go tutaj
-- jako `event_audience_grants`.
--
-- STAN PO. Cztery nowe tabele i trzy rozszerzenia istniejacych:
--   1) `event_ticket_types` +3 kolumny - KTO moze kupic wejsciowke danego rodzaju;
--   2) `event_audience_grants` - reczne nadanie uprawnienia (kadra akademicka bez
--      domeny z listy, organizacja pozarzadowa, przedstawiciel firmy);
--   3) `event_ticket_packages` - PAKIET: N miejsc jednego rodzaju w jednej cenie;
--   4) `event_package_orders` - zakupiony pakiet z pula miejsc do rozdania;
--   5) `event_package_seats` - jedno miejsce z pakietu, przypisane albo zaproszone;
--   6) `b2b_coupons` i `b2b_coupon_campaigns` +zakres wydarzeniowy i limit na osobe.
--
-- DLACZEGO PAKIET JEST OSOBNA TABELA, A NIE KOLUMNA `seats` NA RODZAJU WEJSCIOWKI.
-- Pakiet i wejsciowka roznia sie tym, CO KUPUJACY DOSTAJE. Wejsciowka jest jednym
-- zapisem na jedna osobe - kupujacy jest uczestnikiem. Pakiet jest PULA miejsc,
-- ktorych kupujacy zwykle nie zajmuje wcale: firma kupuje piec miejsc i rozdaje je
-- pracownikom, ktorych nazwiska poda pozniej albo nigdy (zaproszenie na adres
-- poczty). To sa dwa rozne cykle zycia - jeden konczy sie zapisem, drugi zaczyna
-- pula do rozdysponowania - i mieszanie ich w jednej tabeli konczy sie kolumnami,
-- ktore w polowie wierszy sa NULL-em z zasady.
--
-- IZOLACJA NAJEMCOW. Kazda nowa tabela: `tenant_id NOT NULL` z kluczem obcym do
-- `tenants`, RLS wlaczone, klucz obcy ZLOZONY do rodzica (para najemca-wydarzenie
-- albo trojka najemca-wydarzenie-rodzic), wlasne `UNIQUE (tenant_id, id)` jako cel
-- dla tabel potomnych. Plaszczyzny sa rozdzielone: panel czyta przez
-- `_caller_tenant()` z bramka roli, odczyt publiczny przez `public_tenant_id()`,
-- i ZADNE cialo SECURITY DEFINER nie miesza jednego z drugim.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) WEJSCIOWKA INDYWIDUALNA: dla kogo jest
--
-- `min_tier_rank` odpowiada na pytanie "jaka warstwa czlonkostwa", ale NIE na
-- pytanie "czy to stawka dla kadry akademickiej". To sa dwa niezalezne wymiary:
-- doktorant moze nie miec zadnej warstwy, a czlonek premium nie byc naukowcem.
-- Dlatego `audience` jest osobna kolumna, a nie kolejna ranga.
--
-- `max_per_person` istnieje, bo bez niego stawka ulgowa jest otwarta furtka:
-- jedna osoba z domeny akademickiej kupuje dwadziescia wejsciowek ze znizka
-- i rozdaje je dalej. Domyslne 1 znaczy "wejsciowka indywidualna", NULL znaczy
-- "bez limitu" i jest swiadomym wyborem organizatora.
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_ticket_types
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS requires_verification boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_per_person integer DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_ticket_types_audience_values'
  ) THEN
    ALTER TABLE public.event_ticket_types
      ADD CONSTRAINT event_ticket_types_audience_values
      CHECK (audience IN ('public', 'member', 'academic', 'ngo', 'company', 'invite'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_ticket_types_max_per_person_positive'
  ) THEN
    ALTER TABLE public.event_ticket_types
      ADD CONSTRAINT event_ticket_types_max_per_person_positive
      CHECK (max_per_person IS NULL OR max_per_person > 0);
  END IF;

  -- Wymog weryfikacji ma sens WYLACZNIE dla grup, ktore da sie zweryfikowac.
  -- Zaznaczony przy `public` byl by pulapka na organizatora: ekran obiecuje
  -- kontrole, ktorej nie ma czym wykonac.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_ticket_types_verification_scope'
  ) THEN
    ALTER TABLE public.event_ticket_types
      ADD CONSTRAINT event_ticket_types_verification_scope
      CHECK (NOT requires_verification OR audience IN ('academic', 'ngo', 'company'));
  END IF;
END
$$;

COMMENT ON COLUMN public.event_ticket_types.audience IS
  'Dla kogo jest ta wejsciowka: public (kazdy), member (za progiem warstwy - patrz min_tier_rank), academic (kadra i doktoranci), ngo (organizacje pozarzadowe), company (przedstawiciel firmy z kartoteki), invite (tylko z miejsca w pakiecie albo zaproszenia). Wymiar NIEZALEZNY od min_tier_rank.';
COMMENT ON COLUMN public.event_ticket_types.requires_verification IS
  'Czy uprawnienie do tej stawki musi byc POTWIERDZONE: domena poczty z verification_domains albo reczne nadanie w event_audience_grants. Dopuszczalne tylko dla audience academic / ngo / company.';
COMMENT ON COLUMN public.event_ticket_types.max_per_person IS
  'Ile wejsciowek tego rodzaju moze kupic jedna osoba. 1 = wejsciowka indywidualna (domyslnie), NULL = bez limitu. Bez tego limitu stawka ulgowa jest otwarta furtka do odsprzedazy.';

-- ----------------------------------------------------------------------------
-- 2) RECZNE NADANIE UPRAWNIENIA DO STAWKI
--
-- Weryfikacja po domenie poczty pokrywa wiekszosc przypadkow i nic nie kosztuje,
-- ale nie pokrywa ich wszystkich: adiunkt z prywatnego adresu, fundacja
-- w domenie komercyjnej, przedstawiciel firmy, ktora dopiero wchodzi do kartoteki.
-- Migracja 20260822094000 nazwala te sytuacje wyjatkiem obslugiwanym recznie
-- i na tym poprzestala. Ta tabela jest jej brakujacym nosnikiem.
--
-- NADANIE JEST NAJEMCY, NIE WYDARZENIA. Kadra akademicka pozostaje kadra na
-- kazdym wydarzeniu organizacji, wiec wiazanie nadania z jednym wydarzeniem
-- kazaloby powtarzac te sama weryfikacje przy kazdej konferencji. Zakres
-- wydarzeniowy zostaje dostepny przez `event_id` dla nadan celowo jednorazowych.
--
-- DOWOD JEST WYMAGANY. Kolumna `evidence` nie jest ozdoba: nadanie ulgi bez
-- sladu, kto i na jakiej podstawie ja przyznal, jest nie do obrony przy audycie
-- rozliczen. Dlatego CHECK wymaga tresci.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_audience_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  audience text NOT NULL,
  -- Podmiot nadania: konto ALBO osoba z kartoteki wydarzen. Uczestnik moze nie
  -- miec konta (wiazaca decyzja wlasciciela produktu), wiec obie sciezki musza
  -- byc mozliwe - a jednoczesnie nie obie naraz, bo wtedy nie wiadomo, ktora
  -- tozsamosc rozstrzyga.
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id uuid,
  company_id uuid,
  event_id uuid,
  evidence text NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  revoked_at timestamptz,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_audience_grants_audience_values
    CHECK (audience IN ('academic', 'ngo', 'company')),
  CONSTRAINT event_audience_grants_subject_one
    CHECK ((user_id IS NOT NULL) <> (person_id IS NOT NULL)),
  CONSTRAINT event_audience_grants_evidence_len
    CHECK (char_length(btrim(evidence)) BETWEEN 3 AND 500),
  CONSTRAINT event_audience_grants_window
    CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT event_audience_grants_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_audience_grants_person_fkey
    FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_audience_grants_company_fkey
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES public.crm_companies (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT event_audience_grants_event_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

-- Jedno AKTYWNE nadanie danej grupy na podmiot. Indeks czesciowy, bo nadania
-- wycofane i wygasle maja zostac w ksiedze - to slad audytowy, nie smiec.
CREATE UNIQUE INDEX IF NOT EXISTS event_audience_grants_user_active_uniq
  ON public.event_audience_grants (tenant_id, audience, user_id, COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE user_id IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_audience_grants_person_active_uniq
  ON public.event_audience_grants (tenant_id, audience, person_id, COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE person_id IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS event_audience_grants_lookup_idx
  ON public.event_audience_grants (tenant_id, audience, valid_from, valid_until)
  WHERE revoked_at IS NULL;

ALTER TABLE public.event_audience_grants ENABLE ROW LEVEL SECURITY;

-- Panel: staff redakcyjny wlasnego najemcy. Plaszczyzna administracyjna, wiec
-- `_caller_tenant()`, nigdy `public_tenant_id()`.
CREATE POLICY "event_audience_grants_staff_all" ON public.event_audience_grants
  FOR ALL TO authenticated
  USING (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  )
  WITH CHECK (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  );

-- Wlasciciel widzi SWOJE nadanie - inaczej nie ma jak sprawdzic, czemu dostaje
-- albo nie dostaje stawki ulgowej, a wsparcie odpowiada na to pytanie recznie.
CREATE POLICY "event_audience_grants_own_read" ON public.event_audience_grants
  FOR SELECT TO authenticated
  USING (tenant_id = public._caller_tenant() AND user_id = auth.uid());

CREATE TRIGGER event_audience_grants_touch_updated_at
  BEFORE UPDATE ON public.event_audience_grants
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

COMMENT ON TABLE public.event_audience_grants IS
  'Reczne nadanie uprawnienia do stawki ulgowej (academic / ngo / company) osobie z kontem albo z kartoteki wydarzen. Domyka wyjatek, ktory migracja 20260822094000 nazwala i zostawila bez nosnika: weryfikacja po domenie poczty nie obejmuje adiunkta z adresu prywatnego ani fundacji w domenie komercyjnej. Nadanie jest najemcy; event_id zawezaja tylko nadania celowo jednorazowe.';

-- ----------------------------------------------------------------------------
-- 3) PAKIET: N MIEJSC JEDNEGO RODZAJU W JEDNEJ CENIE
--
-- Pakiet NIE powtarza ceny za miejsce. Cena pakietu jest wlasna, bo w tym tkwi
-- caly sens sprzedazy pakietowej: piec miejsc za cene czterech. Gdyby cena byla
-- wyliczana z ceny rodzaju razy liczba miejsc, pakiet nie mialby po co istniec.
--
-- `ticket_type_id` mowi, CZYM staje sie miejsce po przypisaniu uczestnika: jego
-- zapis dostaje ten rodzaj wejsciowki, jego grupe i jego uprawnienia. Bez tego
-- wiazania miejsce z pakietu byloby zapisem bez rodzaju, a wtedy nie da sie
-- policzyc ani puli rodzaju, ani przychodu na rodzaj.
--
-- PULA JEST DWUPOZIOMOWA I TO JEST ZAMIERZONE. `quota` na pakiecie ogranicza
-- liczbe PAKIETOW do sprzedania, a `quota` na rodzaju wejsciowki - liczbe MIEJSC
-- na sali. Sprzedaz pakietu zajmuje `seats` miejsc w puli rodzaju od razu,
-- w chwili zaplaty, a nie przy rozdawaniu - inaczej organizator sprzedalby
-- dwadziescia pakietow po piec miejsc na sale dla pieciudziesieciu osob
-- i dowiedzial sie o tym przy rejestracji ostatniego uczestnika.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_ticket_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  ticket_type_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT 'company',
  requires_verification boolean NOT NULL DEFAULT false,
  seats integer NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  quota integer,
  sold_count integer NOT NULL DEFAULT 0,
  sales_from timestamptz,
  sales_to timestamptz,
  min_tier_rank integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_ticket_packages_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_ticket_packages_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 80),
  CONSTRAINT event_ticket_packages_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  CONSTRAINT event_ticket_packages_desc_pl_len CHECK (char_length(description_pl) <= 1000),
  CONSTRAINT event_ticket_packages_desc_en_len CHECK (char_length(description_en) <= 1000),
  CONSTRAINT event_ticket_packages_audience_values
    CHECK (audience IN ('public', 'member', 'academic', 'ngo', 'company')),
  CONSTRAINT event_ticket_packages_verification_scope
    CHECK (NOT requires_verification OR audience IN ('academic', 'ngo', 'company')),
  -- Pakiet jednomiejscowy to wejsciowka, nie pakiet. Dwa miejsca to minimum,
  -- przy ktorym slowo "pakiet" cokolwiek znaczy.
  CONSTRAINT event_ticket_packages_seats_range CHECK (seats BETWEEN 2 AND 1000),
  CONSTRAINT event_ticket_packages_price_nonneg CHECK (price_cents >= 0),
  CONSTRAINT event_ticket_packages_currency_values CHECK (currency IN ('PLN', 'EUR')),
  CONSTRAINT event_ticket_packages_quota_positive CHECK (quota IS NULL OR quota > 0),
  CONSTRAINT event_ticket_packages_sold_nonneg CHECK (sold_count >= 0),
  CONSTRAINT event_ticket_packages_sold_within_quota
    CHECK (quota IS NULL OR sold_count <= quota),
  CONSTRAINT event_ticket_packages_sales_window
    CHECK (sales_from IS NULL OR sales_to IS NULL OR sales_to > sales_from),
  CONSTRAINT event_ticket_packages_tier_rank_nonneg CHECK (min_tier_rank >= 0),
  CONSTRAINT event_ticket_packages_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_ticket_packages_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_ticket_packages_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_ticket_packages_event_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  -- Rodzaj wejsciowki MUSI byc z tego samego wydarzenia. Trojka w kluczu obcym
  -- zamyka to na poziomie silnika, a nie w kodzie RPC.
  CONSTRAINT event_ticket_packages_ticket_type_fkey
    FOREIGN KEY (tenant_id, event_id, ticket_type_id)
    REFERENCES public.event_ticket_types (tenant_id, event_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS event_ticket_packages_event_idx
  ON public.event_ticket_packages (tenant_id, event_id, sort_order, id);
-- Indeks czesciowy pod odczyt publiczny: strona wydarzenia pyta wylacznie
-- o pakiety aktywne, wiec wiersze wylaczone nie maja po co byc w indeksie.
CREATE INDEX IF NOT EXISTS event_ticket_packages_public_idx
  ON public.event_ticket_packages (tenant_id, event_id, audience, sort_order)
  WHERE is_active;

ALTER TABLE public.event_ticket_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_ticket_packages_staff_all" ON public.event_ticket_packages
  FOR ALL TO authenticated
  USING (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  )
  WITH CHECK (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  );

CREATE TRIGGER event_ticket_packages_touch_updated_at
  BEFORE UPDATE ON public.event_ticket_packages
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

COMMENT ON TABLE public.event_ticket_packages IS
  'Pakiet wejsciowek: N miejsc jednego rodzaju w jednej WLASNEJ cenie (piec za cene czterech). Cena nie jest wyliczana z ceny rodzaju - w tym tkwi sens pakietu. ticket_type_id mowi, czym staje sie miejsce po przypisaniu uczestnika.';
COMMENT ON COLUMN public.event_ticket_packages.seats IS
  'Liczba miejsc w pakiecie, od dwoch. Pakiet jednomiejscowy to wejsciowka indywidualna i nalezy go zrobic rodzajem wejsciowki, nie pakietem.';
COMMENT ON COLUMN public.event_ticket_packages.quota IS
  'Ile PAKIETOW mozna sprzedac. Limit MIEJSC NA SALI stoi osobno, na event_ticket_types.quota, i sprzedaz pakietu zajmuje w nim seats miejsc od razu przy zaplacie.';

-- ----------------------------------------------------------------------------
-- 4) ZAKUPIONY PAKIET: PULA MIEJSC DO ROZDANIA
--
-- Kupujacy nie musi byc uczestnikiem - i to jest normalny przypadek, nie wyjatek.
-- Dyrektor administracyjny kupuje piec miejsc dla zespolu i sam nie przychodzi.
-- Dlatego `buyer_user_id` jest kto ZAPLACIL, a uczestnicy siedza w miejscach.
--
-- `seats_assigned` jest kolumna, nie wyliczeniem z `event_package_seats`. Powod
-- jest ten sam, co przy `sold_count` na rodzaju wejsciowki: przydzial miejsca
-- musi byc serializowany blokada wiersza, a `count(*)` pod blokada tabeli
-- potomnej nie daje sie zablokowac tanio. Trigger na miejscach utrzymuje licznik,
-- a CHECK jest ostatnia linia obrony.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_package_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  package_id uuid NOT NULL,
  buyer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  buyer_person_id uuid,
  company_id uuid,
  buyer_email text NOT NULL,
  buyer_name text NOT NULL DEFAULT '',
  seats_total integer NOT NULL,
  seats_assigned integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  amount_cents integer NOT NULL DEFAULT 0,
  discount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  payment_order_id uuid REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  coupon_id uuid REFERENCES public.b2b_coupons(id) ON DELETE SET NULL,
  invoice_note text NOT NULL DEFAULT '',
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_package_orders_status_values
    CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  CONSTRAINT event_package_orders_seats_total_positive CHECK (seats_total > 0),
  CONSTRAINT event_package_orders_seats_assigned_range
    CHECK (seats_assigned BETWEEN 0 AND seats_total),
  CONSTRAINT event_package_orders_amount_nonneg CHECK (amount_cents >= 0),
  CONSTRAINT event_package_orders_discount_range
    CHECK (discount_cents >= 0 AND discount_cents <= amount_cents + discount_cents),
  CONSTRAINT event_package_orders_currency_values CHECK (currency IN ('PLN', 'EUR')),
  CONSTRAINT event_package_orders_email_shape
    CHECK (buyer_email = lower(btrim(buyer_email)) AND buyer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  -- Znacznik zaplaty i status musza mowic to samo. Rozjazd tych dwoch pol jest
  -- najczestszym zrodlem "zaplacone, ale bez miejsc" w systemach biletowych.
  CONSTRAINT event_package_orders_paid_stamp
    CHECK ((status IN ('paid', 'refunded')) = (paid_at IS NOT NULL)),
  CONSTRAINT event_package_orders_cancelled_stamp
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT event_package_orders_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_package_orders_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_package_orders_event_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_package_orders_package_fkey
    FOREIGN KEY (tenant_id, event_id, package_id)
    REFERENCES public.event_ticket_packages (tenant_id, event_id, id) ON DELETE RESTRICT,
  CONSTRAINT event_package_orders_person_fkey
    FOREIGN KEY (tenant_id, buyer_person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT event_package_orders_company_fkey
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES public.crm_companies (tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS event_package_orders_event_idx
  ON public.event_package_orders (tenant_id, event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS event_package_orders_buyer_idx
  ON public.event_package_orders (tenant_id, buyer_user_id, created_at DESC)
  WHERE buyer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_package_orders_company_idx
  ON public.event_package_orders (tenant_id, company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

ALTER TABLE public.event_package_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_package_orders_staff_all" ON public.event_package_orders
  FOR ALL TO authenticated
  USING (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  )
  WITH CHECK (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  );

-- Kupujacy widzi SWOJ zakup. Bez tego nie ma jak pokazac mu puli miejsc do
-- rozdania, a rozdawanie miejsc jest jego zadaniem, nie organizatora.
CREATE POLICY "event_package_orders_buyer_read" ON public.event_package_orders
  FOR SELECT TO authenticated
  USING (tenant_id = public._caller_tenant() AND buyer_user_id = auth.uid());

CREATE TRIGGER event_package_orders_touch_updated_at
  BEFORE UPDATE ON public.event_package_orders
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

COMMENT ON TABLE public.event_package_orders IS
  'Zakupiony pakiet jako PULA miejsc do rozdania. Kupujacy zwykle nie jest uczestnikiem (dyrektor administracyjny kupuje piec miejsc dla zespolu i sam nie przychodzi), dlatego buyer_* mowi kto zaplacil, a uczestnicy siedza w event_package_seats.';
COMMENT ON COLUMN public.event_package_orders.seats_assigned IS
  'Licznik utrzymywany triggerem na event_package_seats, nie wyliczenie. Przydzial miejsca jest serializowany blokada TEGO wiersza - count(*) na tabeli potomnej nie daje sie zablokowac tanio.';

-- ----------------------------------------------------------------------------
-- 5) MIEJSCE Z PAKIETU
--
-- Miejsce ma TRZY stany i wszystkie trzy sa potrzebne:
--   wolne        - `registration_id IS NULL` i brak zaproszenia. Firma kupila
--                  piec miejsc i jeszcze nie wie, kto pojedzie.
--   zaproszone   - jest `invite_email` i hash tokenu, nie ma jeszcze zapisu.
--                  Zaproszony sam sie zapisuje i miejsce sie domyka.
--   przypisane   - `registration_id` wskazuje zapis uczestnika.
-- Bez stanu "zaproszone" firma musialaby znac nazwiska w chwili zakupu, a to jest
-- dokladnie ten wymog, ktory zabija sprzedaz pakietowa.
--
-- TOKEN ZAPROSZENIA JAKO HASH, nigdy jawny. Kto ma token, ten zajmuje miejsce -
-- czyli token jest tu wejsciowka na okaziciela. Jawny trafia do wiadomosci raz;
-- w bazie zostaje hash, dokladnie jak przy kodach QR odprawy (20260823180000).
--
-- JEDEN ZAPIS NIE ZAJMUJE DWOCH MIEJSC. Indeks czesciowy na `registration_id`
-- zamyka to na poziomie silnika. Bez niego blad w panelu przy dwukrotnym
-- kliknieciu spala miejsce, ktore firma zaplacila.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_package_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  package_order_id uuid NOT NULL,
  registration_id uuid,
  invite_email text,
  invite_name text NOT NULL DEFAULT '',
  invite_token_hash text,
  invite_sent_at timestamptz,
  invite_expires_at timestamptz,
  assigned_at timestamptz,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_package_seats_invite_email_shape
    CHECK (invite_email IS NULL
           OR (invite_email = lower(btrim(invite_email))
               AND invite_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$')),
  -- Zaproszenie bez tokenu nie da sie przyjac, a token bez adresu nie da sie
  -- wyslac. Jedno bez drugiego jest wierszem, ktory nie prowadzi nikad.
  CONSTRAINT event_package_seats_invite_pair
    CHECK ((invite_email IS NULL) = (invite_token_hash IS NULL)),
  CONSTRAINT event_package_seats_assigned_stamp
    CHECK ((registration_id IS NOT NULL) = (assigned_at IS NOT NULL)),
  CONSTRAINT event_package_seats_invite_window
    CHECK (invite_expires_at IS NULL OR invite_sent_at IS NULL
           OR invite_expires_at > invite_sent_at),
  CONSTRAINT event_package_seats_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_package_seats_order_fkey
    FOREIGN KEY (tenant_id, event_id, package_order_id)
    REFERENCES public.event_package_orders (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_package_seats_event_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  -- Zapis MUSI byc z tego samego wydarzenia. Trojka zamyka podmiane uczestnika
  -- z innej konferencji na oplacone miejsce.
  CONSTRAINT event_package_seats_registration_fkey
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS event_package_seats_registration_uniq
  ON public.event_package_seats (tenant_id, event_id, registration_id)
  WHERE registration_id IS NOT NULL AND revoked_at IS NULL;
-- Jeden adres zaproszony RAZ na zakup. Powtorka to nie druga wejsciowka, tylko
-- pomylka panelu - i lepiej, zeby odrzucila ja baza.
CREATE UNIQUE INDEX IF NOT EXISTS event_package_seats_invite_uniq
  ON public.event_package_seats (tenant_id, package_order_id, invite_email)
  WHERE invite_email IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS event_package_seats_order_idx
  ON public.event_package_seats (tenant_id, package_order_id, created_at);
CREATE INDEX IF NOT EXISTS event_package_seats_token_idx
  ON public.event_package_seats (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL AND revoked_at IS NULL;

ALTER TABLE public.event_package_seats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_package_seats_staff_all" ON public.event_package_seats
  FOR ALL TO authenticated
  USING (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  )
  WITH CHECK (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  );

-- Kupujacy widzi i rozdaje miejsca WLASNEGO zakupu. Zakres liczony przez
-- zakup, zeby nie duplikowac kolumny kupujacego na miejscu.
CREATE POLICY "event_package_seats_buyer_read" ON public.event_package_seats
  FOR SELECT TO authenticated
  USING (
    tenant_id = public._caller_tenant()
    AND EXISTS (
      SELECT 1 FROM public.event_package_orders o
      WHERE o.id = event_package_seats.package_order_id
        AND o.tenant_id = event_package_seats.tenant_id
        AND o.buyer_user_id = auth.uid()
    )
  );

CREATE TRIGGER event_package_seats_touch_updated_at
  BEFORE UPDATE ON public.event_package_seats
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- Token zaproszenia jest wejsciowka na okaziciela, wiec kolumna hasha nie ma
-- prawa wyjsc do klienta ZADNYM grantem - tak samo jak token urzadzenia
-- skanujacego w 20260823180000.
REVOKE ALL (invite_token_hash) ON public.event_package_seats FROM authenticated, anon;

COMMENT ON TABLE public.event_package_seats IS
  'Jedno miejsce z pakietu w jednym z trzech stanow: wolne, zaproszone (adres + HASH tokenu), przypisane (registration_id). Stan zaproszony istnieje, bo wymog podania nazwisk w chwili zakupu zabija sprzedaz pakietowa.';
COMMENT ON COLUMN public.event_package_seats.invite_token_hash IS
  'HASH tokenu zaproszenia, nigdy token jawny - kto ma token, ten zajmuje oplacone miejsce, wiec jest to wejsciowka na okaziciela. Kolumna odcieta grantem od rol klienckich.';

-- ----------------------------------------------------------------------------
-- 6) LICZNIK MIEJSC PRZYPISANYCH
--
-- Trigger, a nie wyliczenie w RPC: `seats_assigned` jest czytany pod blokada
-- wiersza zakupu przy przydziale, a wyliczenie `count(*)` w tym miejscu
-- kazaloby blokowac cala tabele potomna. Trigger utrzymuje licznik przy KAZDEJ
-- sciezce zapisu - takze przy poprawce recznej, ktorej dzisiaj nie znamy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_event_package_seats_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order uuid := COALESCE(NEW.package_order_id, OLD.package_order_id);
BEGIN
  UPDATE public.event_package_orders o
  SET seats_assigned = (
    SELECT count(*)::integer FROM public.event_package_seats s
    WHERE s.package_order_id = v_order
      AND s.registration_id IS NOT NULL
      AND s.revoked_at IS NULL
  )
  WHERE o.id = v_order;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS event_package_seats_count ON public.event_package_seats;
CREATE TRIGGER event_package_seats_count
  AFTER INSERT OR UPDATE OF registration_id, revoked_at OR DELETE
  ON public.event_package_seats
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_package_seats_count();

COMMENT ON FUNCTION public.tg_event_package_seats_count() IS
  'Utrzymuje event_package_orders.seats_assigned. Licznik istnieje, bo przydzial miejsca serializuje sie blokada wiersza zakupu, a count(*) na tabeli potomnej nie daje sie w tym miejscu zablokowac tanio.';

-- ----------------------------------------------------------------------------
-- 7) KUPONY: ZAKRES WYDARZENIOWY DLA ISTNIEJACEGO SILNIKA
--
-- `b2b_coupons.plan_ids` zakresuje kupon na plany czlonkowskie. Wejsciowka nie
-- jest planem, wiec bez tych kolumn kupon na bilet jest nieosiagalny. Zakres
-- jest tablica identyfikatorow, dokladnie jak `plan_ids` - ta sama konwencja
-- w tej samej tabeli, zeby walidacja miala jeden ksztalt.
--
-- PUSTA TABLICA ZNACZY "BEZ ZAWEZENIA", a nie "nigdzie". Tak samo dziala
-- `plan_ids` od 20260721070203 i zmiana tej semantyki uniewaznilaby istniejace
-- kupony.
--
-- `max_redemptions_per_user` domyka luke, ktora przy kodach GENEROWANYCH
-- WSADOWO jest realna: kod z limitem stu uzyc bez limitu na osobe to sto
-- znizek dla jednej osoby, ktora zdazyla go opublikowac.
-- ----------------------------------------------------------------------------
ALTER TABLE public.b2b_coupons
  ADD COLUMN IF NOT EXISTS event_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS ticket_type_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS package_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS max_redemptions_per_user integer;

ALTER TABLE public.b2b_coupon_campaigns
  ADD COLUMN IF NOT EXISTS event_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS ticket_type_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS package_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS max_redemptions_per_user integer,
  ADD COLUMN IF NOT EXISTS audience text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'b2b_coupons_per_user_positive'
  ) THEN
    ALTER TABLE public.b2b_coupons
      ADD CONSTRAINT b2b_coupons_per_user_positive
      CHECK (max_redemptions_per_user IS NULL OR max_redemptions_per_user > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'b2b_coupon_campaigns_per_user_positive'
  ) THEN
    ALTER TABLE public.b2b_coupon_campaigns
      ADD CONSTRAINT b2b_coupon_campaigns_per_user_positive
      CHECK (max_redemptions_per_user IS NULL OR max_redemptions_per_user > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'b2b_coupon_campaigns_audience_values'
  ) THEN
    ALTER TABLE public.b2b_coupon_campaigns
      ADD CONSTRAINT b2b_coupon_campaigns_audience_values
      CHECK (audience IS NULL OR audience IN ('public', 'member', 'academic', 'ngo', 'company'));
  END IF;
END
$$;

-- Wyszukiwanie kuponow po wydarzeniu bez pelnego skanu tabeli. GIN, bo warunek
-- jest zawieraniem w tablicy, nie rownoscia.
CREATE INDEX IF NOT EXISTS b2b_coupons_event_ids_idx
  ON public.b2b_coupons USING gin (event_ids)
  WHERE active;
CREATE INDEX IF NOT EXISTS b2b_coupons_ticket_type_ids_idx
  ON public.b2b_coupons USING gin (ticket_type_ids)
  WHERE active;

COMMENT ON COLUMN public.b2b_coupons.event_ids IS
  'Zawezenie kuponu do wskazanych wydarzen. PUSTA TABLICA znaczy bez zawezenia - ta sama semantyka co plan_ids z 20260721070203; zmiana jej znaczenia uniewaznilaby istniejace kupony.';
COMMENT ON COLUMN public.b2b_coupons.max_redemptions_per_user IS
  'Limit uzyc kodu PRZEZ JEDNA OSOBE. Przy kodach generowanych wsadowo kod ze limitem stu uzyc bez tego limitu to sto znizek dla jednej osoby, ktora zdazyla go opublikowac.';
COMMENT ON COLUMN public.b2b_coupon_campaigns.audience IS
  'Grupa docelowa kampanii kodow (academic, ngo, company, member, public). Sluzy raportowaniu i doborowi odbiorcow wysylki; uprawnienie do stawki rozstrzyga event_audience_grants i verification_domains, nie ta kolumna.';

-- ----------------------------------------------------------------------------
-- 8) CZY WOLAJACY KWALIFIKUJE SIE DO STAWKI
--
-- Jedna funkcja, trzy zrodla uprawnienia, w tej kolejnosci:
--   1. domena poczty z `verification_domains` (academic = true) - automat,
--      istnieje od 20260822094000 i jest darmowy;
--   2. reczne nadanie w `event_audience_grants` - wyjatek, ktory tamta migracja
--      nazwala i zostawila bez nosnika;
--   3. przynaleznosc do firmy z kartoteki - dla stawki firmowej.
--
-- DLACZEGO TO JEST FUNKCJA, A NIE WARUNEK W KAZDYM RPC. Pytanie "czy ta osoba
-- ma prawo do tej stawki" zadaja co najmniej cztery miejsca: wycena wejsciowki,
-- zakup pakietu, walidacja kuponu i panel organizatora. Cztery kopie tego samego
-- warunku rozjezdzaja sie po pierwszej zmianie regulaminu, a rozjazd jest
-- niewidoczny - ulga po prostu przysluguje w jednym miejscu i nie przysluguje
-- w drugim.
--
-- PLASZCZYZNA: administracyjna i wlasna. Funkcja odpowiada o WOLAJACEGO, wiec
-- czyta `auth.uid()` i `_caller_tenant()`. NIE MA tu `public_tenant_id()` -
-- uprawnienie do znizki nie moze zalezec od naglowka Host, bo naglowek jest
-- falsyfikowalny, a znizka jest pieniedzmi.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_audience_qualifies(text);
CREATE FUNCTION public.event_audience_qualifies(p_audience text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_email text;
BEGIN
  IF p_audience IS NULL OR p_audience = 'public' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN false;
  END IF;

  -- Warstwa czlonkostwa ma wlasny mechanizm (min_tier_rank) i nie przechodzi
  -- przez nadania. Zwracamy prawde, bo prog warstwy sprawdza wywolujacy osobno -
  -- inaczej ten sam warunek stalby w dwoch miejscach.
  IF p_audience = 'member' THEN
    RETURN true;
  END IF;

  -- 1. Automat po domenie poczty. Dotyczy wylacznie stawki akademickiej, bo
  --    tylko dla niej `verification_domains` niesie znacznik.
  IF p_audience = 'academic' AND public.my_academic_domain_verification() THEN
    RETURN true;
  END IF;

  -- 2. Reczne nadanie: aktywne, w oknie waznosci, dla tego najemcy.
  IF EXISTS (
    SELECT 1 FROM public.event_audience_grants g
    WHERE g.tenant_id = v_tenant
      AND g.audience = p_audience
      AND g.user_id = v_uid
      AND g.revoked_at IS NULL
      AND g.valid_from <= now()
      AND (g.valid_until IS NULL OR g.valid_until > now())
  ) THEN
    RETURN true;
  END IF;

  -- 3. Stawka firmowa: wolajacy musi byc powiazany z firma z kartoteki tego
  --    najemcy. Dopasowanie po domenie poczty, bo to jedyny zwiazek, ktory
  --    kartoteka niesie bez dodatkowego procesu zapraszania pracownikow.
  IF p_audience = 'company' THEN
    SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = v_uid;
    IF v_email IS NULL OR position('@' in v_email) = 0 THEN
      RETURN false;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.crm_companies c
      WHERE c.tenant_id = v_tenant
        AND c.domain IS NOT NULL
        AND lower(btrim(c.domain)) = split_part(v_email, '@', 2)
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.event_audience_qualifies(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_audience_qualifies(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_audience_qualifies(text) IS
  'Czy WOLAJACY kwalifikuje sie do stawki danej grupy: public zawsze, member zawsze (prog warstwy sprawdza wywolujacy osobno), academic po domenie z verification_domains albo po recznym nadaniu, ngo po recznym nadaniu, company po domenie firmy z kartoteki albo po recznym nadaniu. Plaszczyzna administracyjna - zero public_tenant_id(), bo naglowek Host jest falsyfikowalny, a znizka jest pieniedzmi.';

-- ----------------------------------------------------------------------------
-- 9) WYCENA: ILE TA OSOBA ZAPLACI I CZY W OGOLE MOZE
--
-- To jest JEDNA odpowiedz na cztery pytania, ktore ekran zadaje naraz:
--   * czy wolajacy kwalifikuje sie do tej stawki,
--   * czy pula i okno sprzedazy pozwalaja,
--   * ile kosztuje przed rabatem,
--   * ile kosztuje po zastosowaniu kodu, jesli kod podano.
-- Rozbicie tego na cztery wywolania daje cztery okazje do rozjazdu miedzy tym,
-- co pokazuje ekran, a tym, co przyjmie zapis - czyli przycisk prowadzacy
-- w sciane. Jedno wywolanie oddaje decyzje i jej powod.
--
-- ODMOWA MA NAZWE, nie tylko wartosc logiczna. Panel i strona buduja z niej
-- zdanie dla uzytkownika, a `reason` jest kluczem slownika, nie tekstem -
-- inaczej tlumaczenie musialoby parsowac komunikat.
--
-- PLASZCZYZNA: administracyjna, bo rozstrzyga o pieniadzach wolajacego.
-- `_caller_tenant()` i `auth.uid()`, zero `public_tenant_id()`.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_admission_quote(jsonb);
CREATE FUNCTION public.event_admission_quote(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_ticket_type_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_code text := upper(btrim(COALESCE(p_payload->>'coupon_code', '')));
  v_kind text;
  v_audience text;
  v_requires_verification boolean;
  v_min_tier_rank integer;
  v_price integer;
  v_currency text;
  v_quota integer;
  v_sold integer;
  v_sales_from timestamptz;
  v_sales_to timestamptz;
  v_seats integer := 1;
  v_max_per_person integer;
  v_event_id uuid;
  v_is_active boolean;
  v_owned integer := 0;
  v_coupon public.b2b_coupons;
  v_discount integer := 0;
  v_used_by_user integer := 0;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sign_in_required');
  END IF;

  IF (v_ticket_type_id IS NULL) = (v_package_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload: give exactly one of ticket_type_id or package_id';
  END IF;

  IF v_ticket_type_id IS NOT NULL THEN
    v_kind := 'ticket';
    SELECT t.event_id, t.audience, t.requires_verification, t.min_tier_rank,
           t.price_cents, t.currency, t.quota, t.sold_count, t.sales_from, t.sales_to,
           t.is_active, t.max_per_person
      INTO v_event_id, v_audience, v_requires_verification, v_min_tier_rank,
           v_price, v_currency, v_quota, v_sold, v_sales_from, v_sales_to,
           v_is_active, v_max_per_person
    FROM public.event_ticket_types t
    WHERE t.id = v_ticket_type_id AND t.tenant_id = v_tenant;
  ELSE
    v_kind := 'package';
    SELECT p.event_id, p.audience, p.requires_verification, p.min_tier_rank,
           p.price_cents, p.currency, p.quota, p.sold_count, p.sales_from, p.sales_to,
           p.is_active, p.seats
      INTO v_event_id, v_audience, v_requires_verification, v_min_tier_rank,
           v_price, v_currency, v_quota, v_sold, v_sales_from, v_sales_to,
           v_is_active, v_seats
    FROM public.event_ticket_packages p
    WHERE p.id = v_package_id AND p.tenant_id = v_tenant;
  END IF;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF NOT v_is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;

  -- Okno sprzedazy. Dwa osobne powody, bo "jeszcze nie" i "juz nie" to dla
  -- kupujacego dwie rozne wiadomosci: jedna kaze wrocic, druga nie.
  IF v_sales_from IS NOT NULL AND now() < v_sales_from THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_not_open',
                              'sales_from', v_sales_from);
  END IF;
  IF v_sales_to IS NOT NULL AND now() >= v_sales_to THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_closed');
  END IF;

  IF v_quota IS NOT NULL AND v_sold >= v_quota THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sold_out');
  END IF;

  IF v_min_tier_rank > 0 AND NOT public.has_tier_rank(v_min_tier_rank) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tier_required',
                              'min_tier_rank', v_min_tier_rank);
  END IF;

  -- Uprawnienie do stawki. Sprawdzane ZAWSZE dla grup innych niz publiczna,
  -- a `requires_verification` decyduje tylko o tym, czy odmowa jest twarda.
  -- Rozdzielenie jest celowe: organizator moze chciec stawki NGO otwartej na
  -- oswiadczenie, i to jest jego decyzja, nie decyzja bazy.
  IF v_audience NOT IN ('public', 'member') AND v_requires_verification
     AND NOT public.event_audience_qualifies(v_audience) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'audience_not_verified',
                              'audience', v_audience);
  END IF;

  -- Limit sztuk na osobe dotyczy wylacznie wejsciowek indywidualnych. Pakiet
  -- ma swoja pule i swoj limit, a firma kupujaca dwa pakiety to normalna
  -- sytuacja, nie naduzycie.
  IF v_kind = 'ticket' AND v_max_per_person IS NOT NULL THEN
    -- POWIAZANIE Z KONTEM IDZIE PRZEZ KARTOTEKE, NIE PRZEZ ZAPIS.
    -- `event_registrations` nie ma kolumny `user_id` i to jest zamierzone:
    -- uczestnik moze nie miec konta (wiazaca decyzja wlasciciela produktu),
    -- wiec tozsamosc konta trzyma `event_people.user_id`, a zapis wskazuje
    -- OSOBE. Pierwsza wersja tego zapytania czytala r.user_id i wywracala
    -- wycene KAZDEJ wejsciowki indywidualnej, bo `max_per_person` ma domyslna
    -- wartosc 1 - czyli warunek wykonywal sie zawsze. Zlapal to harness
    -- wykonaniem; bramki tekstowe takiego bledu nie widza.
    SELECT count(*)::integer INTO v_owned
    FROM public.event_registrations r
    JOIN public.event_people pe
      ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    WHERE r.tenant_id = v_tenant
      AND r.ticket_type_id = v_ticket_type_id
      AND pe.user_id = v_uid
      AND r.status NOT IN ('cancelled', 'rejected');
    IF v_owned >= v_max_per_person THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'per_person_limit',
                                'max_per_person', v_max_per_person, 'owned', v_owned);
    END IF;
  END IF;

  -- Kupon. Brak kodu nie jest bledem - to najczestszy przypadek.
  IF v_code <> '' THEN
    SELECT * INTO v_coupon FROM public.b2b_coupons c
    WHERE c.tenant_id = v_tenant AND upper(c.code) = v_code;

    IF v_coupon.id IS NULL OR NOT v_coupon.active THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_unknown');
    END IF;
    IF v_coupon.valid_from IS NOT NULL AND now() < v_coupon.valid_from THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_not_yet_valid');
    END IF;
    IF v_coupon.valid_until IS NOT NULL AND now() >= v_coupon.valid_until THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_expired');
    END IF;
    IF v_coupon.max_redemptions IS NOT NULL
       AND v_coupon.redemptions_count >= v_coupon.max_redemptions THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_exhausted');
    END IF;

    -- Limit uzyc na osobe. Liczony z ksiegi uzyc, a nie z licznika globalnego -
    -- licznik globalny nie wie, KTO uzyl.
    IF v_coupon.max_redemptions_per_user IS NOT NULL THEN
      SELECT count(*)::integer INTO v_used_by_user
      FROM public.b2b_coupon_redemptions r
      WHERE r.coupon_id = v_coupon.id AND r.user_id = v_uid;
      IF v_used_by_user >= v_coupon.max_redemptions_per_user THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'coupon_used_by_you');
      END IF;
    END IF;

    -- Zakres. PUSTA tablica znaczy "bez zawezenia" - ta sama semantyka co
    -- `plan_ids` od 20260721070203.
    IF array_length(v_coupon.event_ids, 1) IS NOT NULL
       AND NOT (v_event_id = ANY (v_coupon.event_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_event');
    END IF;
    IF v_kind = 'ticket' AND array_length(v_coupon.ticket_type_ids, 1) IS NOT NULL
       AND NOT (v_ticket_type_id = ANY (v_coupon.ticket_type_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_ticket_type');
    END IF;
    IF v_kind = 'package' AND array_length(v_coupon.package_ids, 1) IS NOT NULL
       AND NOT (v_package_id = ANY (v_coupon.package_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_package');
    END IF;
    IF v_coupon.currency IS NOT NULL AND v_coupon.currency <> v_currency THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_currency');
    END IF;

    -- Rabat NIGDY nie schodzi ponizej zera. Kupon kwotowy wiekszy niz cena
    -- zeruje cene, a nie tworzy naleznosci wobec kupujacego.
    v_discount := CASE
      WHEN v_coupon.discount_kind = 'percent'
        THEN (v_price * v_coupon.discount_percent) / 100
      ELSE LEAST(v_coupon.discount_cents, v_price)
    END;
    v_discount := GREATEST(LEAST(v_discount, v_price), 0);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', v_kind,
    'event_id', v_event_id,
    'audience', v_audience,
    'seats', v_seats,
    'currency', v_currency,
    'price_cents', v_price,
    'discount_cents', v_discount,
    'total_cents', v_price - v_discount,
    'coupon_id', v_coupon.id,
    'coupon_code', NULLIF(v_code, ''),
    'seats_left', CASE WHEN v_quota IS NULL THEN NULL ELSE v_quota - v_sold END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_admission_quote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_admission_quote(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_admission_quote(jsonb) IS
  'Jedna odpowiedz na cztery pytania ekranu zakupu: czy wolajacy sie kwalifikuje, czy pula i okno pozwalaja, ile kosztuje przed rabatem i po kodzie. Wejscie: {"ticket_type_id"|"package_id", "coupon_code"?}. Odmowa ma NAZWE (reason) bedaca kluczem slownika, nie tekstem. Rozbicie tego na cztery wywolania daje cztery okazje do rozjazdu miedzy ekranem a zapisem.';

-- ----------------------------------------------------------------------------
-- 10) GENERATOR KODOW MUSI PRZENOSIC ZAKRES WYDARZENIOWY
--
-- `bulk_generate_coupons_for_campaign` z 20260721082414 wstawia kupony JAWNA
-- LISTA KOLUMN. Kolumny zakresu dodane wyzej nie sa w tej liscie, wiec kody
-- wygenerowane z kampanii wydarzeniowej wyszlyby BEZ ZAWEZENIA: znizka
-- pomyslana dla jednej konferencji dzialalaby na wszystkim. Blad cichy
-- i kosztowny - kupon nie odmawia, tylko obniza cene tam, gdzie nie powinien.
--
-- PRZY OKAZJI NAPRAWIONA BRAMKA NAJEMCY. Oryginal sprawdzal
-- `_c.tenant_id <> public_tenant_id()` i w tym samym ciele wolal `has_role()`.
-- To jest DOKLADNIE ta mieszanka, ktorej zabrania doktryna repozytorium i ktora
-- wychwytuje bramka `check:sql-tenant-scope`: naglowek Host jest falsyfikowalny,
-- wiec zestawiony z rola pozwala wykonac operacje administracyjna w cudzym
-- najemcy. Redefinicja nie moze przepisac tego wzorca dalej, wiec bramka idzie
-- na `_caller_tenant()` - najemce domowego wolajacego, ktorego nie da sie
-- podstawic naglowkiem.
--
-- CZEGO TU NIE ZMIENIAM I ZGLASZAM ZAMIAST TEGO. Kody powstaja z `random()`,
-- ktory nie jest generatorem kryptograficznym. Przy dziesieciu tysiacach kodow
-- z jednej kampanii przewidywalnosc ziarna jest realnym ryzykiem finansowym.
-- Zamiana na `gen_random_bytes` dotknelaby TAKZE kampanii planowych, ktore dzis
-- dzialaja, wiec jest decyzja wlasciciela produktu, a nie skutkiem ubocznym
-- migracji o wejsciowkach.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_generate_coupons_for_campaign(_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _c public.b2b_coupon_campaigns%ROWTYPE;
  _uid uuid := auth.uid();
  _tenant uuid := public._caller_tenant();
  _i integer := 0;
  _created integer := 0;
  _code text;
  _alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  _tries integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO _c FROM public.b2b_coupon_campaigns WHERE id = _campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF _tenant IS NULL OR _c.tenant_id <> _tenant THEN RAISE EXCEPTION 'wrong_tenant'; END IF;
  IF NOT (
    public.has_role(_uid, 'admin'::app_role)
    OR public.has_role(_uid, 'editor'::app_role)
    OR public.is_super_admin(_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _c.status <> 'draft' THEN RAISE EXCEPTION 'campaign_already_generated'; END IF;

  WHILE _i < _c.code_count LOOP
    _tries := 0;
    LOOP
      _code := COALESCE(NULLIF(_c.prefix, ''), '') ||
        (SELECT string_agg(substr(_alphabet, 1 + floor(random() * length(_alphabet))::int, 1), '')
         FROM generate_series(1, _c.code_length));
      BEGIN
        INSERT INTO public.b2b_coupons(
          tenant_id, code, name, discount_kind, discount_percent, discount_cents, currency,
          active, max_redemptions, valid_from, valid_until, plan_ids,
          campaign_id, grants_tier_key, grants_duration_days, newsletter_segment,
          created_by, metadata,
          -- ZAKRES WYDARZENIOWY - powod istnienia tej redefinicji.
          event_ids, ticket_type_ids, package_ids, max_redemptions_per_user
        ) VALUES (
          _c.tenant_id, _code, _c.name, _c.discount_kind, _c.discount_percent, _c.discount_cents, _c.currency,
          true, _c.max_redemptions_per_code, _c.valid_from, _c.valid_until, _c.plan_ids,
          _c.id, _c.grants_tier_key, _c.grants_duration_days, _c.newsletter_segment,
          _uid, jsonb_build_object('campaign', _c.name, 'audience', _c.audience),
          _c.event_ids, _c.ticket_type_ids, _c.package_ids, _c.max_redemptions_per_user
        );
        _created := _created + 1;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        _tries := _tries + 1;
        IF _tries > 5 THEN RAISE EXCEPTION 'code_collision_limit'; END IF;
      END;
    END LOOP;
    _i := _i + 1;
  END LOOP;

  UPDATE public.b2b_coupon_campaigns
     SET status = 'generated', generated_count = _created, updated_at = now()
   WHERE id = _campaign_id;

  RETURN _created;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_generate_coupons_for_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_generate_coupons_for_campaign(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.bulk_generate_coupons_for_campaign(uuid) IS
  'Generuje kody kampanii wsadowo. Redefinicja z 20260824080000 dodaje PRZENOSZENIE ZAKRESU WYDARZENIOWEGO (event_ids, ticket_type_ids, package_ids, max_redemptions_per_user) - bez tego kody z kampanii wydarzeniowej wychodzily bez zawezenia - oraz przestawia bramke najemcy z public_tenant_id() na _caller_tenant(), bo naglowek Host zestawiony z has_role() w ciele SECURITY DEFINER pozwalal na operacje administracyjna w cudzym najemcy.';

-- ----------------------------------------------------------------------------
-- 11) PANEL: DEFINICJA PAKIETU
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_ticket_package_save(jsonb);
CREATE FUNCTION public.admin_event_ticket_package_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_ticket_type_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
BEGIN
  IF v_id IS NOT NULL THEN
    UPDATE public.event_ticket_packages SET
      name_pl = COALESCE(NULLIF(btrim(p_payload->>'name_pl'), ''), name_pl),
      name_en = COALESCE(NULLIF(btrim(p_payload->>'name_en'), ''), name_en),
      description_pl = COALESCE(p_payload->>'description_pl', description_pl),
      description_en = COALESCE(p_payload->>'description_en', description_en),
      audience = COALESCE(NULLIF(p_payload->>'audience', ''), audience),
      requires_verification = COALESCE((NULLIF(p_payload->>'requires_verification', ''))::boolean, requires_verification),
      seats = COALESCE((NULLIF(p_payload->>'seats', ''))::integer, seats),
      price_cents = COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, price_cents),
      currency = COALESCE(NULLIF(p_payload->>'currency', ''), currency),
      quota = CASE WHEN p_payload ? 'quota'
                THEN (NULLIF(p_payload->>'quota', ''))::integer ELSE quota END,
      sales_from = CASE WHEN p_payload ? 'sales_from'
                     THEN (NULLIF(p_payload->>'sales_from', ''))::timestamptz ELSE sales_from END,
      sales_to = CASE WHEN p_payload ? 'sales_to'
                   THEN (NULLIF(p_payload->>'sales_to', ''))::timestamptz ELSE sales_to END,
      min_tier_rank = COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, min_tier_rank),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active),
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order)
    WHERE id = v_id AND tenant_id = v_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: package does not exist in this tenant';
    END IF;
    RETURN v_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id is required';
  END IF;
  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;
  IF v_ticket_type_id IS NULL THEN
    RAISE EXCEPTION 'invalid_ticket_type: ticket_type_id is required';
  END IF;

  -- Wydarzenie MUSI byc tenanta wolajacego. Klucz obcy zlozony odrzucilby obce
  -- id sam, ale wtedy panel dostaje 23503 bez wskazania pola.
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_ticket_packages (
    tenant_id, event_id, ticket_type_id, key, name_pl, name_en,
    description_pl, description_en, audience, requires_verification,
    seats, price_cents, currency, quota, sales_from, sales_to,
    min_tier_rank, is_active, sort_order
  ) VALUES (
    v_tenant, v_event_id, v_ticket_type_id, v_key,
    btrim(COALESCE(p_payload->>'name_pl', '')),
    btrim(COALESCE(p_payload->>'name_en', '')),
    COALESCE(p_payload->>'description_pl', ''),
    COALESCE(p_payload->>'description_en', ''),
    COALESCE(NULLIF(p_payload->>'audience', ''), 'company'),
    COALESCE((NULLIF(p_payload->>'requires_verification', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'seats', ''))::integer, 2),
    COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, 0),
    COALESCE(NULLIF(p_payload->>'currency', ''), 'PLN'),
    (NULLIF(p_payload->>'quota', ''))::integer,
    (NULLIF(p_payload->>'sales_from', ''))::timestamptz,
    (NULLIF(p_payload->>'sales_to', ''))::timestamptz,
    COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, 0),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_package_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_package_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_package_save(jsonb) IS
  'Zapis pakietu wejsciowek. Bez id tworzy, z id aktualizuje. Klucz jest niezmienny po utworzeniu (jest kotwica w cenniku). Odmowy nazwane: invalid_event, invalid_key, invalid_ticket_type, not_found.';

-- ----------------------------------------------------------------------------
-- 12) ZAKUP PAKIETU
--
-- NAJTRUDNIEJSZY KAWALEK CALEJ MIGRACJI, bo dotyka DWOCH pul naraz i musi
-- byc odporny na dwoch kupujacych w tej samej sekundzie:
--   * pula PAKIETOW (`event_ticket_packages.quota`) - ile zestawow do sprzedania,
--   * pula MIEJSC (`event_ticket_types.quota`) - ile osob wejdzie na sale.
-- Sprzedaz jednego pakietu zajmuje `seats` miejsc w puli rodzaju NATYCHMIAST,
-- a nie przy rozdawaniu. Inaczej organizator sprzedaje dwadziescia pakietow po
-- piec miejsc na sale dla pieciudziesieciu osob i dowiaduje sie o tym przy
-- rejestracji ostatniego uczestnika - czyli za pozno, zeby cokolwiek zrobic.
--
-- KOLEJNOSC BLOKAD JEST USTALONA I MA ZNACZENIE: najpierw rodzaj wejsciowki,
-- potem pakiet. Odwrotna kolejnosc w innym RPC dalaby zakleszczenie przy dwoch
-- rownoczesnych zakupach roznych pakietow tego samego rodzaju.
--
-- WYCENA JEST LICZONA PONOWNIE, nie przyjmowana z wejscia. Cena i rabat
-- przyslane przez klienta sa zyczeniem, nie faktem - a to jest sciezka, ktora
-- porusza pieniadze.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_package_purchase(jsonb);
CREATE FUNCTION public.event_package_purchase(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_company_id uuid := NULLIF(p_payload->>'company_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'buyer_email', '')));
  v_name text := btrim(COALESCE(p_payload->>'buyer_name', ''));
  v_note text := btrim(COALESCE(p_payload->>'invoice_note', ''));
  v_quote jsonb;
  v_pkg public.event_ticket_packages;
  v_type public.event_ticket_types;
  v_order_id uuid;
  v_coupon_id uuid;
  v_total integer;
  v_discount integer;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;
  IF v_package_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: package_id is required';
  END IF;

  -- Wycena z TEJ SAMEJ funkcji, ktora karmi ekran. Jedno zrodlo decyzji znaczy,
  -- ze ekran i zapis nie moga sie rozjechac.
  v_quote := public.event_admission_quote(jsonb_build_object(
    'package_id', v_package_id,
    'coupon_code', COALESCE(p_payload->>'coupon_code', '')
  ));

  IF NOT (v_quote->>'ok')::boolean THEN
    RAISE EXCEPTION 'refused_%: %', v_quote->>'reason', v_quote->>'reason';
  END IF;

  v_total := (v_quote->>'total_cents')::integer;
  v_discount := (v_quote->>'discount_cents')::integer;
  v_coupon_id := NULLIF(v_quote->>'coupon_id', '')::uuid;

  -- BLOKADA 1: rodzaj wejsciowki (pula miejsc na sali).
  SELECT t.* INTO v_type
  FROM public.event_ticket_types t
  JOIN public.event_ticket_packages p
    ON p.ticket_type_id = t.id AND p.tenant_id = t.tenant_id
  WHERE p.id = v_package_id AND p.tenant_id = v_tenant
  FOR UPDATE OF t;

  -- BLOKADA 2: pakiet (pula zestawow).
  SELECT * INTO v_pkg
  FROM public.event_ticket_packages
  WHERE id = v_package_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_pkg.id IS NULL OR v_type.id IS NULL THEN
    RAISE EXCEPTION 'not_found: package does not exist in this tenant';
  END IF;

  -- Pule sprawdzane PO blokadzie, nie przed. Sprawdzenie sprzed blokady jest
  -- opinia sprzed sekundy, a w tej sekundzie ktos inny mogl kupic ostatni zestaw.
  IF v_pkg.quota IS NOT NULL AND v_pkg.sold_count >= v_pkg.quota THEN
    RAISE EXCEPTION 'sold_out: no packages left';
  END IF;
  IF v_type.quota IS NOT NULL AND v_type.sold_count + v_pkg.seats > v_type.quota THEN
    RAISE EXCEPTION 'seats_exhausted: not enough seats left for a whole package';
  END IF;

  INSERT INTO public.event_package_orders (
    tenant_id, event_id, package_id, buyer_user_id, company_id,
    buyer_email, buyer_name, seats_total, status,
    amount_cents, discount_cents, currency, coupon_id, invoice_note, created_by
  ) VALUES (
    v_tenant, v_pkg.event_id, v_package_id, v_uid, v_company_id,
    CASE WHEN v_email <> '' THEN v_email
         ELSE lower(btrim((SELECT u.email FROM auth.users u WHERE u.id = v_uid))) END,
    v_name, v_pkg.seats, 'pending',
    v_total, v_discount, v_pkg.currency, v_coupon_id, v_note, v_uid
  )
  RETURNING id INTO v_order_id;

  -- Miejsca powstaja PUSTE i od razu w komplecie. Pula jest zajeta w chwili
  -- zakupu, wiec musi byc widoczna jako wiersze, a nie jako liczba.
  INSERT INTO public.event_package_seats (tenant_id, event_id, package_order_id)
  SELECT v_tenant, v_pkg.event_id, v_order_id FROM generate_series(1, v_pkg.seats);

  UPDATE public.event_ticket_packages
  SET sold_count = sold_count + 1 WHERE id = v_package_id;
  UPDATE public.event_ticket_types
  SET sold_count = sold_count + v_pkg.seats WHERE id = v_type.id;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'seats', v_pkg.seats,
    'currency', v_pkg.currency,
    'total_cents', v_total,
    'discount_cents', v_discount,
    'status', 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_package_purchase(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_package_purchase(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_package_purchase(jsonb) IS
  'Zakup pakietu. Dotyka DWOCH pul: zestawow (event_ticket_packages.quota) i miejsc na sali (event_ticket_types.quota), obu pod blokada wiersza w USTALONEJ kolejnosci rodzaj-potem-pakiet, zeby dwa rownoczesne zakupy roznych pakietow tego samego rodzaju nie dawaly zakleszczenia. Wycena liczona PONOWNIE przez event_admission_quote - cena przyslana przez klienta jest zyczeniem, nie faktem.';

-- ----------------------------------------------------------------------------
-- 13) ROZDANIE MIEJSCA: ZAPROSZENIE ALBO PRZYPISANIE
--
-- Dwie drogi, bo firmy pracuja na dwa sposoby. Jedna zna nazwiska i przypisuje
-- wprost do zapisow, ktore juz istnieja. Druga zna tylko adresy poczty i wysyla
-- zaproszenia, a uczestnik dopisuje sie sam.
--
-- TOKEN ZWRACANY JEST RAZ. W bazie zostaje hash - kto ma token, ten zajmuje
-- oplacone miejsce, wiec token jest wejsciowka na okaziciela. Ta sama zasada
-- co przy kodach QR odprawy (20260823180000).
--
-- BLOKADA NA ZAKUPIE, nie na miejscu. Liczba wolnych miejsc jest wlasnoscia
-- ZAKUPU, wiec to jego wiersz rozstrzyga, czy jest jeszcze co rozdac. Blokada
-- na pojedynczym miejscu nie zatrzymalaby dwoch rownoczesnych zaproszen
-- kierowanych do dwoch roznych wolnych wierszy.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_package_seat_invite(jsonb);
CREATE FUNCTION public.event_package_seat_invite(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
-- `extensions` NA SCIEZCE, BO CIALO WOLA `digest()` BEZ KWALIFIKATORA.
-- Na Supabase pgcrypto mieszka w schemacie `extensions`, a PRZYPIETA sciezka
-- nadpisuje sesyjna - bez tego wpisu haszowanie tokenu zaproszenia padaloby
-- z 42883 "function digest(text, unknown) does not exist". Kontrakt pilnuje
-- pgTAP `extensions_search_path_contract_test.sql`.
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_order_id uuid := NULLIF(p_payload->>'package_order_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'email', '')));
  v_name text := btrim(COALESCE(p_payload->>'name', ''));
  v_days integer := COALESCE((NULLIF(p_payload->>'expires_in_days', ''))::integer, 30);
  v_order public.event_package_orders;
  v_seat_id uuid;
  v_token text;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid address is required';
  END IF;

  SELECT * INTO v_order
  FROM public.event_package_orders
  WHERE id = v_order_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'not_found: package order does not exist in this tenant';
  END IF;

  -- Rozdaje kupujacy ALBO staff. Nikt inny, nawet w tym samym najemcy.
  IF v_order.buyer_user_id IS DISTINCT FROM v_uid
     AND NOT (
       public.has_role(v_uid, 'admin'::app_role)
       OR public.has_role(v_uid, 'editor'::app_role)
       OR public.is_super_admin(v_uid)
     ) THEN
    RAISE EXCEPTION 'forbidden: only the buyer or the organiser may hand out seats';
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'order_cancelled: seats of a cancelled order cannot be handed out';
  END IF;

  -- Wolne miejsce: bez zapisu i bez zaproszenia. Kolejnosc po `created_at`,
  -- zeby rozdawanie bylo powtarzalne, a nie zalezne od planu zapytania.
  SELECT id INTO v_seat_id
  FROM public.event_package_seats
  WHERE package_order_id = v_order_id
    AND tenant_id = v_tenant
    AND registration_id IS NULL
    AND invite_email IS NULL
    AND revoked_at IS NULL
  ORDER BY created_at, id
  LIMIT 1;

  IF v_seat_id IS NULL THEN
    RAISE EXCEPTION 'no_free_seat: every seat of this package is taken or invited';
  END IF;

  -- Token jawny raz. `gen_random_uuid()` dwa razy daje 244 bity entropii -
  -- dla wejsciowki na okaziciela to wystarcza z zapasem.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  UPDATE public.event_package_seats SET
    invite_email = v_email,
    invite_name = v_name,
    invite_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
    invite_sent_at = now(),
    invite_expires_at = now() + make_interval(days => GREATEST(v_days, 1))
  WHERE id = v_seat_id;

  RETURN jsonb_build_object(
    'seat_id', v_seat_id,
    'email', v_email,
    'token', v_token,
    'expires_at', now() + make_interval(days => GREATEST(v_days, 1))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_package_seat_invite(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_package_seat_invite(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_package_seat_invite(jsonb) IS
  'Zaproszenie na wolne miejsce z pakietu. Token JAWNY zwracany RAZ, w bazie zostaje sha256 - token jest wejsciowka na okaziciela. Blokada na wierszu ZAKUPU, bo to on jest wlascicielem liczby wolnych miejsc. Rozdaje kupujacy albo staff, nikt inny.';

DROP FUNCTION IF EXISTS public.admin_event_package_seat_assign(jsonb);
CREATE FUNCTION public.admin_event_package_seat_assign(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_order_id uuid := NULLIF(p_payload->>'package_order_id', '')::uuid;
  v_registration_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_order public.event_package_orders;
  v_seat_id uuid;
BEGIN
  IF v_order_id IS NULL OR v_registration_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: package_order_id and registration_id are required';
  END IF;

  SELECT * INTO v_order
  FROM public.event_package_orders
  WHERE id = v_order_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'not_found: package order does not exist in this tenant';
  END IF;

  -- Zapis MUSI byc z tego samego wydarzenia. Klucz obcy zlozony na miejscu
  -- odrzucilby to sam, ale komunikat bylby o ograniczeniu, nie o polu.
  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.id = v_registration_id
      AND r.tenant_id = v_tenant
      AND r.event_id = v_order.event_id
  ) THEN
    RAISE EXCEPTION 'not_found: registration does not belong to this event';
  END IF;

  SELECT id INTO v_seat_id
  FROM public.event_package_seats
  WHERE package_order_id = v_order_id
    AND tenant_id = v_tenant
    AND registration_id IS NULL
    AND revoked_at IS NULL
  ORDER BY created_at, id
  LIMIT 1;

  IF v_seat_id IS NULL THEN
    RAISE EXCEPTION 'no_free_seat: every seat of this package is taken';
  END IF;

  UPDATE public.event_package_seats SET
    registration_id = v_registration_id,
    assigned_at = now(),
    assigned_by = v_uid
  WHERE id = v_seat_id;

  -- Miejsce z pakietu nadaje zapisowi rodzaj wejsciowki pakietu - inaczej
  -- uczestnik z pakietu firmowego mialby zapis bez rodzaju i wypadl z kazdego
  -- zestawienia liczonego po rodzajach.
  UPDATE public.event_registrations r
  SET ticket_type_id = p.ticket_type_id
  FROM public.event_ticket_packages p
  WHERE r.id = v_registration_id
    AND p.id = v_order.package_id
    AND r.ticket_type_id IS NULL;

  RETURN v_seat_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_package_seat_assign(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_seat_assign(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_package_seat_assign(jsonb) IS
  'Przypisanie miejsca z pakietu istniejacemu zapisowi przez organizatora. Nadaje zapisowi rodzaj wejsciowki pakietu, jesli zapis go nie mial - bez tego uczestnik z pakietu firmowego wypada z kazdego zestawienia liczonego po rodzajach.';

-- ----------------------------------------------------------------------------
-- 14) PANEL: NADANIE I WYCOFANIE UPRAWNIENIA DO STAWKI
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_audience_grant_save(jsonb);
CREATE FUNCTION public.admin_event_audience_grant_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_audience text := lower(btrim(COALESCE(p_payload->>'audience', '')));
  v_user_id uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_person_id uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_evidence text := btrim(COALESCE(p_payload->>'evidence', ''));
  v_id uuid;
BEGIN
  IF v_audience NOT IN ('academic', 'ngo', 'company') THEN
    RAISE EXCEPTION 'invalid_audience: academic, ngo or company';
  END IF;
  IF (v_user_id IS NULL) = (v_person_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_subject: give exactly one of user_id or person_id';
  END IF;
  IF char_length(v_evidence) < 3 THEN
    RAISE EXCEPTION 'invalid_evidence: state on what basis the rate is granted';
  END IF;

  INSERT INTO public.event_audience_grants (
    tenant_id, audience, user_id, person_id, company_id, event_id,
    evidence, valid_until, granted_by
  ) VALUES (
    v_tenant, v_audience, v_user_id, v_person_id,
    NULLIF(p_payload->>'company_id', '')::uuid,
    NULLIF(p_payload->>'event_id', '')::uuid,
    v_evidence,
    (NULLIF(p_payload->>'valid_until', ''))::timestamptz,
    v_uid
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_audience_grant_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_audience_grant_save(jsonb) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_event_audience_grant_revoke(uuid);
CREATE FUNCTION public.admin_event_audience_grant_revoke(p_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  -- Wycofanie STEMPLUJE, nie kasuje. Nadanie ulgi i jego wycofanie sa sladem
  -- audytowym rozliczen - wiersz skasowany nie odpowie na pytanie, kto i kiedy
  -- przyznal znizke, ktora widnieje na fakturze.
  UPDATE public.event_audience_grants
  SET revoked_at = now()
  WHERE id = p_id AND tenant_id = v_tenant AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: grant does not exist in this tenant or is already revoked';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_audience_grant_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_audience_grant_revoke(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_audience_grant_revoke(uuid) IS
  'Wycofanie nadania stempluje revoked_at zamiast kasowac wiersz. Nadanie ulgi i jego wycofanie sa sladem audytowym rozliczen - skasowany wiersz nie odpowie, kto przyznal znizke widniejaca na fakturze.';
