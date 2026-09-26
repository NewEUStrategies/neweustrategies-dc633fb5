-- ===========================================================================
-- 72 ANULOWANIE ZAMOWIENIA PAKIETU ODDAJE UZYCIE KODU (migracja 20260926130000)
--
-- PO CO TEN PLIK ISTNIEJE. Od 20260926110000 zakup pakietu zuzywa kod rabatowy
-- (licznik + wiersz realizacji), ale zmiana statusu zamowienia nie oddawala go
-- przy anulowaniu: wiersz realizacji nie wskazywal zamowienia. Kod „Liczba
-- uzyc: 1" z anulowanego zamowienia zostawal wyczerpany na zawsze.
--
-- CO SPRAWDZA (kazdy punkt to galaz, ktora da sie zlamac):
--   A. zakup wiaze realizacje z zamowieniem (`package_order_id`); CHECK
--      „platnosc ALBO pakiet", unikalnosc jednego uzycia na zamowienie, klucz
--      obcy zlozony z najemca i ON DELETE SET NULL (package_order_id), ktory
--      NIE zeruje `tenant_id`;
--   B. odmowy dostepu: redaktor i kupujacy (bez roli admin), anonim, admin
--      obcego najemcy (`not_found`), nieznany stan, nieznane zamowienie - i to,
--      ze zadna odmowa niczego nie zmienila;
--   C. pending -> paid zatrzymuje uzycie;
--   D. paid -> cancelled oddaje uzycie: licznik, wiersz realizacji, zatrzask,
--      wycofane miejsca;
--   E. oddane uzycie bierze inny kupujacy (wycena i zakup);
--   F. powrot z anulowania przy wyczerpanym kodzie - `coupon_restore_exhausted`
--      i wycofanie CALEJ zmiany (stan, zatrzask, licznik);
--   G. ponowne anulowanie anulowanego nie rusza kodu ani znacznikow;
--   H. powrot z anulowania zuzywa kod z powrotem (pola realizacji, zatrzask
--      wyczyszczony) - takze gdy kod jest juz WYLACZONY i PRZETERMINOWANY;
--   I. pending -> pending nic nie zmienia;
--   J. paid -> refunded zatrzymuje uzycie, refunded -> cancelled je oddaje;
--   K. limit na osobe - `coupon_restore_used_by_buyer` - i kontrapunkt;
--   L. zamowienie bez kodu (zalozone przez organizatora) - nic sie nie dzieje;
--   M. realizacja NIEPOWIAZANA (stare dane): anulowanie nic nie oddaje,
--      zatrzask zostaje pusty, powrot niczego nie zuzywa;
--   N. kod skasowany (i kod spoza najemcy) w czasie anulowania: powrot czysci
--      zatrzask bez bledu i bez realizacji;
--   O. dopiecie starych danych `_event_package_coupon_link_backfill()`: para
--      jednoznaczna, para niejednoznaczna, prawie-para, anulowana para;
--      dwa wywolania - wynik dokladnie raz; potem zachowanie jak nowe dane;
--   P. CHECK zatrzasku i granty obu funkcji.
--
-- CZEGO NIE SPRAWDZA: rownoleglych transakcji (harness ma jedna sesje - kolejnosc
-- blokad opisuje migracja), ekranu panelu (vitest packagesApiMutations) ani
-- zwrotu puli zestawow i miejsc przy anulowaniu - tego migracja nie robi.
--
-- `now()` jest czasem poczatku transakcji, wiec KAZDY znacznik w tym pliku ma
-- te sama wartosc. Tam, gdzie asercja mowi „znacznik bez zmian", znacznik jest
-- najpierw cofniety o godzine - inaczej porownanie byloby puste.
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK.
-- ===========================================================================
\echo '== 72 anulowanie zamowienia pakietu oddaje uzycie kodu =='
BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('72000000-0000-0000-0000-0000000000b0', 'Tenant B (anulowanie pakietu)', 'tb-pak72')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('72a00000-0000-0000-0000-0000000000a1', 'pak72.admin@example.org'),
  ('72a00000-0000-0000-0000-0000000000a2', 'pak72.kupujacy@example.org'),
  ('72a00000-0000-0000-0000-0000000000a3', 'pak72.drugi@example.org'),
  ('72a00000-0000-0000-0000-0000000000a4', 'pak72.redaktor@example.org'),
  ('72a00000-0000-0000-0000-0000000000b1', 'pak72.admin.b@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('72a00000-0000-0000-0000-0000000000a1', 'admin'),
  ('72a00000-0000-0000-0000-0000000000a4', 'editor'),
  ('72a00000-0000-0000-0000-0000000000b1', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('72a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('72a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111'),
  ('72a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111'),
  ('72a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111'),
  ('72a00000-0000-0000-0000-0000000000b1', '72000000-0000-0000-0000-0000000000b0')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('72e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'pak-anulowanie-72', 'Kongres anulowan', 'Cancellation congress', now() + interval '40 days',
   'published')
ON CONFLICT (id) DO NOTHING;

-- Rodzaj i pakiet BEZ limitow, zeby kilkanascie zakupow nie rozbilo sie o pule.
-- P2: 2 miejsca za 1000 zl; kod -50 zl daje rabat 2 x 50 zl = 100 zl.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, audience, requires_verification, max_per_person)
VALUES
  ('72700000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '72e00000-0000-0000-0000-0000000000a1', 'firmowa', 'Firmowa', 'Corporate',
   80000, 'PLN', NULL, 'company', false, NULL);

INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, audience,
   seats, price_cents, currency, quota)
VALUES
  ('72900000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '72e00000-0000-0000-0000-0000000000a1', '72700000-0000-0000-0000-0000000000a1',
   'firmowy_2', 'Pakiet firmowy 2', 'Corporate 2', 'company', 2, 100000, 'PLN', NULL);

-- Kazdy kod ma JEDNA role w pliku, zeby liczniki nie mieszaly sie miedzy
-- sekcjami. Wszystkie kwotowe -50 zl na to samo wydarzenie.
INSERT INTO public.b2b_coupons
  (id, tenant_id, code, discount_kind, discount_percent, discount_cents, currency,
   event_ids, ticket_type_ids, max_redemptions, max_redemptions_per_user,
   applies_discount, reveals_hidden)
VALUES
  -- 01: jedno uzycie - oddanie, przejecie przez innego kupujacego, odmowa powrotu.
  ('72c00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'PAK72-RAZ', 'fixed', NULL, 5000, 'PLN',
   ARRAY['72e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], 1, NULL, true, false),
  -- 02: jedno uzycie na osobe - odmowa powrotu po limicie kupujacego.
  ('72c00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'PAK72-OSOBA', 'fixed', NULL, 5000, 'PLN',
   ARRAY['72e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, 1, true, false),
  -- 03: bez limitow - powrot, zwrot, pending -> pending.
  ('72c00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'PAK72-WIELE', 'fixed', NULL, 5000, 'PLN',
   ARRAY['72e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, NULL, true, false),
  -- 04: skasowany w czasie anulowania.
  ('72c00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'PAK72-USUN', 'fixed', NULL, 5000, 'PLN',
   ARRAY['72e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, NULL, true, false),
  -- 05: realizacja niepowiazana (stare dane).
  ('72c00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'PAK72-STARY', 'fixed', NULL, 5000, 'PLN',
   ARRAY['72e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, NULL, true, false),
  -- 06: stare dane pod dopiecie (licznik = piec wierszy realizacji ponizej).
  ('72c00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'PAK72-DOPIECIE', 'fixed', NULL, 5000, 'PLN',
   ARRAY['72e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, NULL, true, false),
  -- 07: przeniesiony do obcego najemcy w czasie anulowania.
  ('72c00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'PAK72-OBCY', 'fixed', NULL, 5000, 'PLN',
   ARRAY['72e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, NULL, true, false),
  -- 08: zamowienie skasowane (ON DELETE SET NULL).
  ('72c00000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   'PAK72-KASUJ', 'fixed', NULL, 5000, 'PLN',
   ARRAY['72e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, NULL, true, false);

-- Zamowienia po kluczu z sekcji - identyfikatory nadaje zakup.
CREATE TEMP TABLE t72 (k text PRIMARY KEY, id uuid NOT NULL);

CREATE FUNCTION pg_temp.o72(_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT t.id FROM pg_temp.t72 t WHERE t.k = _k $$;

-- Zakup pakietu P2 jako `_uid` (z kodem albo bez) - zapamietany pod kluczem.
CREATE FUNCTION pg_temp.buy72(_k text, _uid uuid, _code text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM pg_temp.act_as(_uid, '11111111-1111-1111-1111-111111111111');
  v_id := (public.event_package_purchase(jsonb_build_object(
    'package_id', '72900000-0000-0000-0000-0000000000a2',
    'coupon_code', COALESCE(_code, ''))) ->> 'order_id')::uuid;
  INSERT INTO pg_temp.t72 (k, id) VALUES (_k, v_id);
  RETURN v_id;
END $$;

-- Zmiana statusu jako administrator najemcy A.
CREATE FUNCTION pg_temp.st72(_k text, _status text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.act_as('72a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');
  RETURN public.admin_event_package_order_set_status(
    jsonb_build_object('id', pg_temp.o72(_k), 'status', _status));
END $$;

-- Licznik kodu i liczba realizacji: wszystkich kodu / powiazanych z zamowieniem.
CREATE FUNCTION pg_temp.cnt72(_coupon uuid) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT c.redemptions_count FROM public.b2b_coupons c WHERE c.id = _coupon $$;
CREATE FUNCTION pg_temp.rows72(_coupon uuid) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.b2b_coupon_redemptions r WHERE r.coupon_id = _coupon $$;
CREATE FUNCTION pg_temp.linked72(_k text) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.b2b_coupon_redemptions r
  WHERE r.package_order_id = pg_temp.o72(_k) $$;
CREATE FUNCTION pg_temp.ord72(_k text) RETURNS public.event_package_orders
LANGUAGE sql STABLE AS $$
  SELECT o.* FROM public.event_package_orders o WHERE o.id = pg_temp.o72(_k) $$;

-- ---------------------------------------------------------------------------
-- A. ZAKUP WIAZE REALIZACJE Z ZAMOWIENIEM
-- ---------------------------------------------------------------------------
INSERT INTO public.payment_orders (id, tenant_id, user_id) VALUES
  ('72d00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '72a00000-0000-0000-0000-0000000000a2');

DO $do$
DECLARE
  v_o1 uuid;
  v_del uuid;
  v_free uuid;
  v_red public.b2b_coupon_redemptions;
BEGIN
  v_o1 := pg_temp.buy72('o1', '72a00000-0000-0000-0000-0000000000a2', 'PAK72-RAZ');

  SELECT * INTO v_red FROM public.b2b_coupon_redemptions r
  WHERE r.coupon_id = '72c00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_red.package_order_id = v_o1 AND v_red.order_id IS NULL
    AND v_red.applied_cents = 10000 AND v_red.original_cents = 100000,
    '72/zakup: wiersz realizacji wskazuje zamowienie pakietu (package_order_id)');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000001') = 1,
    '72/zakup: kod z jednym uzyciem jest zuzyty');

  -- Wiersz wskazuje zamowienie platnosci ALBO pakiet - nie oba.
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.b2b_coupon_redemptions
      (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
       package_order_id)
    VALUES ('11111111-1111-1111-1111-111111111111', '72c00000-0000-0000-0000-000000000003',
            '72d00000-0000-0000-0000-0000000000a1', NULL, 0, 0, 'PLN', %L)$q$, v_o1),
    'b2b_coupon_redemptions_one_order_kind',
    '72/schemat: realizacja nie wskazuje naraz zamowienia platnosci i pakietu');
  -- Jedno zamowienie pakietu - jedno uzycie.
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.b2b_coupon_redemptions
      (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
       package_order_id)
    VALUES ('11111111-1111-1111-1111-111111111111', '72c00000-0000-0000-0000-000000000003',
            NULL, NULL, 0, 0, 'PLN', %L)$q$, v_o1),
    'b2b_coupon_redemptions_package_order_key',
    '72/schemat: drugie uzycie na tym samym zamowieniu pakietu odrzucone');
  -- Klucz obcy ma najemce: wiersz najemcy B nie wskaze zamowienia najemcy A.
  -- Zamowienie BEZ kodu - na o1 odmowilby wczesniej indeks unikalny, a nie klucz.
  v_free := pg_temp.buy72('a_bez_kodu', '72a00000-0000-0000-0000-0000000000a3', NULL);
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.b2b_coupon_redemptions
      (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
       package_order_id)
    VALUES ('72000000-0000-0000-0000-0000000000b0', '72c00000-0000-0000-0000-000000000003',
            NULL, NULL, 0, 0, 'PLN', %L)$q$, v_free),
    'b2b_coupon_redemptions_package_order_fkey',
    '72/schemat: realizacja obcego najemcy nie wskaze zamowienia najemcy A (klucz z tenant_id)');
  -- Kontrapunkt: ten sam wiersz w najemcy zamowienia przechodzi.
  INSERT INTO public.b2b_coupon_redemptions
    (id, tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
     package_order_id)
  VALUES ('72b00000-0000-0000-0000-0000000000f0', '11111111-1111-1111-1111-111111111111',
          '72c00000-0000-0000-0000-000000000003', NULL, NULL, 0, 0, 'PLN', v_free);
  PERFORM pg_temp.assert(pg_temp.linked72('a_bez_kodu') = 1,
    '72/schemat: wiersz w najemcy zamowienia wskazuje je bez przeszkod (kontrapunkt)');
  DELETE FROM public.b2b_coupon_redemptions WHERE id = '72b00000-0000-0000-0000-0000000000f0';

  -- ON DELETE SET NULL (package_order_id): skasowane zamowienie zostawia uzycie
  -- policzone, a wiersz zostaje w SWOIM najemcy. Goly SET NULL zerowalby tez
  -- `tenant_id` (NOT NULL) i kasowanie zamowienia by padalo.
  v_del := pg_temp.buy72('kasowane', '72a00000-0000-0000-0000-0000000000a3', 'PAK72-KASUJ');
  DELETE FROM public.event_package_orders o WHERE o.id = v_del;
  SELECT * INTO v_red FROM public.b2b_coupon_redemptions r
  WHERE r.coupon_id = '72c00000-0000-0000-0000-000000000008';
  PERFORM pg_temp.assert(v_red.id IS NOT NULL AND v_red.package_order_id IS NULL
    AND v_red.tenant_id = '11111111-1111-1111-1111-111111111111'
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000008') = 1,
    '72/schemat: skasowane zamowienie - realizacja zostaje w najemcy, bez wskazania, licznik bez zmian');
END $do$;

-- ---------------------------------------------------------------------------
-- B. ODMOWY DOSTEPU - i zadna niczego nie zmienia
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_sql text := format(
    $q$SELECT public.admin_event_package_order_set_status(jsonb_build_object('id', %L, 'status', 'cancelled'))$q$,
    pg_temp.o72('o1'));
  v_o public.event_package_orders;
BEGIN
  -- Redaktor NIE jest administratorem modulu (20260824090000).
  PERFORM pg_temp.act_as('72a00000-0000-0000-0000-0000000000a4',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(v_sql, 'forbidden: admin role required',
    '72/dostep: redaktor nie anuluje zamowienia pakietu');
  PERFORM pg_temp.act_as('72a00000-0000-0000-0000-0000000000a2',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(v_sql, 'forbidden: admin role required',
    '72/dostep: kupujacy nie anuluje wlasnego zamowienia przez panel');
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert_raises_like(v_sql, 'forbidden: authentication required',
    '72/dostep: anonim odrzucony');
  -- Admin najemcy B, takze wchodzacy przez host najemcy A: zamowienia nie widzi.
  PERFORM pg_temp.act_as('72a00000-0000-0000-0000-0000000000b1',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(v_sql, 'not_found: order does not exist in this tenant',
    '72/dostep: admin obcego najemcy dostaje not_found');

  PERFORM pg_temp.act_as('72a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_package_order_set_status(jsonb_build_object('id', %L, 'status', 'archived'))$q$,
    pg_temp.o72('o1')), 'invalid_status', '72/stan: nieznany stan odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_package_order_set_status(jsonb_build_object(
         'id', '72f00000-0000-0000-0000-0000000000ff', 'status', 'cancelled'))$q$,
    'not_found: order does not exist in this tenant',
    '72/stan: nieznane zamowienie - not_found');

  v_o := pg_temp.ord72('o1');
  PERFORM pg_temp.assert(v_o.status = 'pending' AND v_o.coupon_released_at IS NULL
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000001') = 1
    AND pg_temp.linked72('o1') = 1,
    '72/dostep: zadna odmowa nie ruszyla zamowienia ani kodu');
END $do$;

-- ---------------------------------------------------------------------------
-- C-D. PENDING -> PAID ZATRZYMUJE, PAID -> CANCELLED ODDAJE
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_o public.event_package_orders;
BEGIN
  PERFORM pg_temp.assert(pg_temp.st72('o1', 'paid'), '72/oplacenie: zmiana statusu zwraca true');
  v_o := pg_temp.ord72('o1');
  PERFORM pg_temp.assert(v_o.status = 'paid' AND v_o.paid_at IS NOT NULL
    AND v_o.coupon_released_at IS NULL
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000001') = 1
    AND pg_temp.linked72('o1') = 1,
    '72/oplacenie: pending -> paid zatrzymuje uzycie kodu');

  PERFORM pg_temp.assert(pg_temp.st72('o1', 'cancelled'), '72/anulowanie: zmiana statusu zwraca true');
  v_o := pg_temp.ord72('o1');
  PERFORM pg_temp.assert(v_o.status = 'cancelled' AND v_o.cancelled_at IS NOT NULL
    AND v_o.paid_at IS NULL,
    '72/anulowanie: stan i znaczniki jak dotad (cancelled_at, bez paid_at)');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000001') = 0,
    '72/anulowanie: paid -> cancelled oddaje uzycie - licznik kodu 1 -> 0');
  PERFORM pg_temp.assert(pg_temp.linked72('o1') = 0
    AND pg_temp.rows72('72c00000-0000-0000-0000-000000000001') = 0,
    '72/anulowanie: wiersz realizacji zamowienia skasowany');
  PERFORM pg_temp.assert(v_o.coupon_released_at IS NOT NULL,
    '72/anulowanie: zatrzask coupon_released_at ustawiony');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_package_seats s
      WHERE s.package_order_id = v_o.id AND s.revoked_at IS NOT NULL) = 2
    AND (SELECT count(*) FROM public.event_package_seats s
      WHERE s.package_order_id = v_o.id AND s.revoked_at IS NULL) = 0,
    '72/anulowanie: oba wolne miejsca wycofane (zachowanie sprzed migracji)');
END $do$;

-- ---------------------------------------------------------------------------
-- E. ODDANE UZYCIE BIERZE INNY KUPUJACY
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_q jsonb;
BEGIN
  PERFORM pg_temp.act_as('72a00000-0000-0000-0000-0000000000a3',
                         '11111111-1111-1111-1111-111111111111');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '72900000-0000-0000-0000-0000000000a2', 'coupon_code', 'PAK72-RAZ'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean AND (v_q->>'discount_cents')::integer = 10000,
    '72/przejecie: po anulowaniu wycena kodu z jednym uzyciem znow przechodzi');
  PERFORM pg_temp.buy72('o2', '72a00000-0000-0000-0000-0000000000a3', 'PAK72-RAZ');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000001') = 1
    AND pg_temp.linked72('o2') = 1,
    '72/przejecie: inny kupujacy kupuje z oddanym uzyciem (licznik 0 -> 1)');
END $do$;

-- ---------------------------------------------------------------------------
-- F. POWROT Z ANULOWANIA PRZY WYCZERPANYM KODZIE - ODMOWA WYCOFUJE CALOSC
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_o public.event_package_orders;
BEGIN
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT pg_temp.st72('o1', 'paid')$q$,
    'coupon_restore_exhausted',
    '72/powrot: kod wyczerpany przez innego kupujacego - coupon_restore_exhausted');
  v_o := pg_temp.ord72('o1');
  PERFORM pg_temp.assert(v_o.status = 'cancelled' AND v_o.cancelled_at IS NOT NULL
    AND v_o.paid_at IS NULL AND v_o.coupon_released_at IS NOT NULL,
    '72/powrot: odmowa wycofuje zmiane statusu - zamowienie anulowane, zatrzask stoi');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000001') = 1
    AND pg_temp.linked72('o1') = 0
    AND pg_temp.rows72('72c00000-0000-0000-0000-000000000001') = 1,
    '72/powrot: odmowa nie zostawia realizacji ani podniesionego licznika');
END $do$;

-- ---------------------------------------------------------------------------
-- G. PONOWNE ANULOWANIE ANULOWANEGO NIE ROBI Z KODEM NIC
--
-- Znaczniki cofniete o godzine: bez tego „bez zmian" porownywaloby now() z now().
-- Wiersz realizacji dopiety RECZNIE do anulowanego zamowienia (stan, ktorego
-- funkcje nie tworza) rozroznia „galaz A pominieta" od „galaz A niczego nie
-- znalazla": gdyby ponowne anulowanie weszlo w galaz A, skasowaloby go
-- i zdjelo licznik kodu z 1 na 0.
-- ---------------------------------------------------------------------------
UPDATE public.event_package_orders
SET cancelled_at = now() - interval '1 hour', coupon_released_at = now() - interval '1 hour'
WHERE id = pg_temp.o72('o1');

INSERT INTO public.b2b_coupon_redemptions
  (id, tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
   package_order_id)
VALUES
  ('72b00000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   '72c00000-0000-0000-0000-000000000001', NULL, '72a00000-0000-0000-0000-0000000000a2',
   10000, 100000, 'PLN', pg_temp.o72('o1'));

DO $do$
DECLARE
  v_o public.event_package_orders;
BEGIN
  PERFORM pg_temp.assert(pg_temp.st72('o1', 'cancelled'),
    '72/ponowne anulowanie: zmiana statusu zwraca true');
  v_o := pg_temp.ord72('o1');
  PERFORM pg_temp.assert(v_o.cancelled_at = now() - interval '1 hour'
    AND v_o.coupon_released_at = now() - interval '1 hour',
    '72/ponowne anulowanie: cancelled_at i zatrzask bez zmian');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000001') = 1
    AND EXISTS (SELECT 1 FROM public.b2b_coupon_redemptions r
                 WHERE r.id = '72b00000-0000-0000-0000-0000000000f1'),
    '72/ponowne anulowanie: licznik i wiersze realizacji nietkniete');
END $do$;

DELETE FROM public.b2b_coupon_redemptions WHERE id = '72b00000-0000-0000-0000-0000000000f1';

-- ---------------------------------------------------------------------------
-- H. POWROT Z ANULOWANIA ZUZYWA KOD Z POWROTEM
--
-- Kod jest w chwili powrotu WYLACZONY i PRZETERMINOWANY - i mimo to powrot
-- przechodzi: rabat jest juz w cenie zamowienia, to nie jest nowe uzycie.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_o public.event_package_orders;
  v_red public.b2b_coupon_redemptions;
BEGIN
  PERFORM pg_temp.buy72('o3', '72a00000-0000-0000-0000-0000000000a2', 'PAK72-WIELE');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000003') = 1,
    '72/powrot: zakup zuzyl kod bez limitu');
  PERFORM pg_temp.st72('o3', 'cancelled');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000003') = 0
    AND pg_temp.linked72('o3') = 0
    AND (pg_temp.ord72('o3')).coupon_released_at IS NOT NULL,
    '72/powrot: pending -> cancelled oddaje uzycie i stawia zatrzask');

  UPDATE public.b2b_coupons SET active = false, valid_until = now()
  WHERE id = '72c00000-0000-0000-0000-000000000003';

  PERFORM pg_temp.assert(pg_temp.st72('o3', 'paid'), '72/powrot: cancelled -> paid zwraca true');
  v_o := pg_temp.ord72('o3');
  PERFORM pg_temp.assert(v_o.status = 'paid' AND v_o.paid_at IS NOT NULL
    AND v_o.cancelled_at IS NULL AND v_o.coupon_released_at IS NULL,
    '72/powrot: zamowienie oplacone, zatrzask wyczyszczony');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000003') = 1,
    '72/powrot: licznik kodu 0 -> 1 mimo kodu wylaczonego i przeterminowanego');
  SELECT * INTO v_red FROM public.b2b_coupon_redemptions r
  WHERE r.package_order_id = v_o.id;
  PERFORM pg_temp.assert(v_red.coupon_id = '72c00000-0000-0000-0000-000000000003'
    AND v_red.tenant_id = '11111111-1111-1111-1111-111111111111'
    AND v_red.user_id = '72a00000-0000-0000-0000-0000000000a2'
    AND v_red.order_id IS NULL
    AND v_red.applied_cents = v_o.discount_cents AND v_red.applied_cents = 10000
    AND v_red.original_cents = v_o.amount_cents + v_o.discount_cents
    AND v_red.original_cents = 100000
    AND v_red.currency = 'PLN',
    '72/powrot: realizacja z powrotem - kupujacy, rabat i cena z zamowienia, wskazanie zamowienia');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_package_seats s
      WHERE s.package_order_id = v_o.id AND s.revoked_at IS NULL) = 0,
    '72/powrot: miejsca zostaja wycofane (powrot przywraca kod, nie zaproszenia)');

  UPDATE public.b2b_coupons SET active = true, valid_until = NULL
  WHERE id = '72c00000-0000-0000-0000-000000000003';
END $do$;

-- ---------------------------------------------------------------------------
-- I-J. PENDING -> PENDING, PAID -> REFUNDED, REFUNDED -> CANCELLED
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_o public.event_package_orders;
  v_n integer;
BEGIN
  PERFORM pg_temp.buy72('o4', '72a00000-0000-0000-0000-0000000000a3', 'PAK72-WIELE');
  v_n := pg_temp.cnt72('72c00000-0000-0000-0000-000000000003');
  PERFORM pg_temp.assert(v_n = 2, '72/pending: drugi zakup kodem bez limitu (licznik 2)');
  PERFORM pg_temp.assert(pg_temp.st72('o4', 'pending'), '72/pending: pending -> pending zwraca true');
  v_o := pg_temp.ord72('o4');
  PERFORM pg_temp.assert(v_o.status = 'pending' AND v_o.paid_at IS NULL
    AND v_o.cancelled_at IS NULL AND v_o.coupon_released_at IS NULL
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000003') = v_n
    AND pg_temp.linked72('o4') = 1,
    '72/pending: pending -> pending nie rusza kodu ani znacznikow');

  PERFORM pg_temp.st72('o3', 'refunded');
  v_o := pg_temp.ord72('o3');
  PERFORM pg_temp.assert(v_o.status = 'refunded' AND v_o.paid_at IS NOT NULL
    AND v_o.coupon_released_at IS NULL
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000003') = v_n
    AND pg_temp.linked72('o3') = 1,
    '72/zwrot: paid -> refunded zatrzymuje uzycie kodu');

  PERFORM pg_temp.st72('o3', 'cancelled');
  v_o := pg_temp.ord72('o3');
  PERFORM pg_temp.assert(v_o.status = 'cancelled' AND v_o.paid_at IS NULL
    AND v_o.coupon_released_at IS NOT NULL
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000003') = v_n - 1
    AND pg_temp.linked72('o3') = 0,
    '72/zwrot: refunded -> cancelled oddaje uzycie jak kazde anulowanie');
END $do$;

-- ---------------------------------------------------------------------------
-- K. LIMIT NA OSOBE PRZY POWROCIE Z ANULOWANIA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_o public.event_package_orders;
BEGIN
  PERFORM pg_temp.buy72('o5', '72a00000-0000-0000-0000-0000000000a2', 'PAK72-OSOBA');
  PERFORM pg_temp.st72('o5', 'cancelled');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000002') = 0,
    '72/limit na osobe: anulowanie oddaje uzycie kupujacemu');
  -- Ta sama osoba kupuje ponownie - oddane uzycie wraca do jej limitu.
  PERFORM pg_temp.buy72('o6', '72a00000-0000-0000-0000-0000000000a2', 'PAK72-OSOBA');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000002') = 1,
    '72/limit na osobe: ta sama osoba kupuje z kodem drugi raz po anulowaniu');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT pg_temp.st72('o5', 'paid')$q$,
    'coupon_restore_used_by_buyer',
    '72/limit na osobe: powrot pierwszego zamowienia - coupon_restore_used_by_buyer');
  v_o := pg_temp.ord72('o5');
  PERFORM pg_temp.assert(v_o.status = 'cancelled' AND v_o.coupon_released_at IS NOT NULL
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000002') = 1
    AND pg_temp.rows72('72c00000-0000-0000-0000-000000000002') = 1
    AND pg_temp.linked72('o5') = 0,
    '72/limit na osobe: odmowa niczego nie zmienia (stan, zatrzask, licznik, realizacje)');

  -- Kontrapunkt: drugie zamowienie anulowane - pierwsze wraca z kodem.
  PERFORM pg_temp.st72('o6', 'cancelled');
  PERFORM pg_temp.assert(pg_temp.st72('o5', 'paid'),
    '72/limit na osobe: po anulowaniu drugiego zamowienia powrot pierwszego przechodzi');
  v_o := pg_temp.ord72('o5');
  PERFORM pg_temp.assert(v_o.status = 'paid' AND v_o.coupon_released_at IS NULL
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000002') = 1
    AND pg_temp.linked72('o5') = 1 AND pg_temp.linked72('o6') = 0,
    '72/limit na osobe: uzycie wrocilo do pierwszego zamowienia');
END $do$;

-- ---------------------------------------------------------------------------
-- L. ZAMOWIENIE BEZ KODU (zalozone przez organizatora)
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_total integer := (SELECT count(*) FROM public.b2b_coupon_redemptions);
  v_o public.event_package_orders;
BEGIN
  PERFORM pg_temp.act_as('72a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');
  INSERT INTO pg_temp.t72 (k, id) VALUES ('o7', public.admin_event_package_order_create(
    jsonb_build_object('package_id', '72900000-0000-0000-0000-0000000000a2',
                       'buyer_email', 'pak72.faktura@example.org')));
  PERFORM pg_temp.st72('o7', 'cancelled');
  v_o := pg_temp.ord72('o7');
  PERFORM pg_temp.assert(v_o.status = 'cancelled' AND v_o.coupon_id IS NULL
    AND v_o.coupon_released_at IS NULL,
    '72/bez kodu: anulowanie zamowienia bez kodu nie stawia zatrzasku');
  PERFORM pg_temp.st72('o7', 'paid');
  v_o := pg_temp.ord72('o7');
  PERFORM pg_temp.assert(v_o.status = 'paid' AND v_o.coupon_released_at IS NULL
    AND pg_temp.linked72('o7') = 0
    AND (SELECT count(*) FROM public.b2b_coupon_redemptions) = v_total,
    '72/bez kodu: powrot nie tworzy zadnej realizacji');
END $do$;

-- ---------------------------------------------------------------------------
-- M. REALIZACJA NIEPOWIAZANA (stare dane) - nic nie oddajemy, nic nie zuzywamy
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_o public.event_package_orders;
BEGIN
  PERFORM pg_temp.buy72('o8', '72a00000-0000-0000-0000-0000000000a3', 'PAK72-STARY');
  -- Ksztalt sprzed tej migracji: wiersz realizacji bez wskazania zamowienia.
  UPDATE public.b2b_coupon_redemptions SET package_order_id = NULL
  WHERE package_order_id = pg_temp.o72('o8');

  PERFORM pg_temp.st72('o8', 'cancelled');
  v_o := pg_temp.ord72('o8');
  PERFORM pg_temp.assert(v_o.status = 'cancelled' AND v_o.coupon_released_at IS NULL,
    '72/stare dane: anulowanie bez powiazanej realizacji - zatrzask pusty');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000005') = 1
    AND pg_temp.rows72('72c00000-0000-0000-0000-000000000005') = 1,
    '72/stare dane: anulowanie nie rusza licznika ani niepowiazanego wiersza');

  PERFORM pg_temp.st72('o8', 'pending');
  v_o := pg_temp.ord72('o8');
  PERFORM pg_temp.assert(v_o.status = 'pending'
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000005') = 1
    AND pg_temp.rows72('72c00000-0000-0000-0000-000000000005') = 1,
    '72/stare dane: powrot NIE zuzywa kodu drugi raz (bez zatrzasku nie ma czego przywracac)');
END $do$;

-- ---------------------------------------------------------------------------
-- N. KOD SKASOWANY ALBO SPOZA NAJEMCY W CZASIE ANULOWANIA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_o public.event_package_orders;
BEGIN
  PERFORM pg_temp.buy72('o9', '72a00000-0000-0000-0000-0000000000a2', 'PAK72-USUN');
  PERFORM pg_temp.st72('o9', 'cancelled');
  PERFORM pg_temp.assert((pg_temp.ord72('o9')).coupon_released_at IS NOT NULL,
    '72/kod skasowany: anulowanie oddalo uzycie');
  DELETE FROM public.b2b_coupons WHERE id = '72c00000-0000-0000-0000-000000000004';
  PERFORM pg_temp.assert((pg_temp.ord72('o9')).coupon_id IS NULL,
    '72/kod skasowany: klucz obcy zamowienia wyzerowal coupon_id');
  PERFORM pg_temp.assert(pg_temp.st72('o9', 'pending'),
    '72/kod skasowany: powrot z anulowania przechodzi bez bledu');
  v_o := pg_temp.ord72('o9');
  PERFORM pg_temp.assert(v_o.status = 'pending' AND v_o.coupon_released_at IS NULL
    AND pg_temp.linked72('o9') = 0,
    '72/kod skasowany: zatrzask wyczyszczony, realizacji nie ma czego odtwarzac');

  -- Kod zamowienia istnieje, ale w innym najemcy - nie zuzywamy cudzego kodu.
  PERFORM pg_temp.buy72('o10', '72a00000-0000-0000-0000-0000000000a2', 'PAK72-OBCY');
  PERFORM pg_temp.st72('o10', 'cancelled');
  UPDATE public.b2b_coupons SET tenant_id = '72000000-0000-0000-0000-0000000000b0'
  WHERE id = '72c00000-0000-0000-0000-000000000007';
  PERFORM pg_temp.assert(pg_temp.st72('o10', 'paid'),
    '72/kod obcy: powrot z anulowania przechodzi bez bledu');
  v_o := pg_temp.ord72('o10');
  PERFORM pg_temp.assert(v_o.status = 'paid' AND v_o.coupon_released_at IS NULL
    AND pg_temp.linked72('o10') = 0
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000007') = 0,
    '72/kod obcy: kod innego najemcy nie jest zuzywany, zatrzask wyczyszczony');
END $do$;

-- ---------------------------------------------------------------------------
-- O. DOPIECIE DANYCH SPRZED MIGRACJI
--
-- Stare zamowienia i realizacje wstawione wprost, z `created_at` z przeszlosci
-- (zakup wstawial oba wiersze tym samym now()). Kod PAK72-DOPIECIE:
--   OL1 (paid)      + R1        - para jednoznaczna        -> powiazana;
--   OA1, OA2 (pend.) + RA1, RA2 - dwie nierozroznialne     -> bez zmian;
--   ON (paid)       + RN        - RN sekunde pozniej       -> bez zmian;
--   OC1 (cancelled) + RC1       - para, zamowienie anulowane -> powiazana
--                                 i oddana (licznik 5 -> 4, zatrzask).
-- Do tego zamowienie o8 z sekcji M (realizacja celowo odpieta, ten sam now()) -
-- tez para jednoznaczna, wiec dopiecie ja wiaze. Razem: linked 3, released 1.
-- ---------------------------------------------------------------------------
UPDATE public.b2b_coupons SET redemptions_count = 5
WHERE id = '72c00000-0000-0000-0000-000000000006';

INSERT INTO public.event_package_orders
  (id, tenant_id, event_id, package_id, buyer_user_id, buyer_email, seats_total, status,
   amount_cents, discount_cents, currency, coupon_id, paid_at, cancelled_at, created_at)
VALUES
  ('72f00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   '72e00000-0000-0000-0000-0000000000a1', '72900000-0000-0000-0000-0000000000a2',
   '72a00000-0000-0000-0000-0000000000a2', 'pak72.kupujacy@example.org', 2, 'paid',
   90000, 10000, 'PLN', '72c00000-0000-0000-0000-000000000006',
   '2026-01-01 12:00+00', NULL, '2026-01-01 10:00+00'),
  ('72f00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111',
   '72e00000-0000-0000-0000-0000000000a1', '72900000-0000-0000-0000-0000000000a2',
   '72a00000-0000-0000-0000-0000000000a3', 'pak72.drugi@example.org', 2, 'pending',
   90000, 10000, 'PLN', '72c00000-0000-0000-0000-000000000006',
   NULL, NULL, '2026-01-02 10:00+00'),
  ('72f00000-0000-0000-0000-0000000000c3', '11111111-1111-1111-1111-111111111111',
   '72e00000-0000-0000-0000-0000000000a1', '72900000-0000-0000-0000-0000000000a2',
   '72a00000-0000-0000-0000-0000000000a3', 'pak72.drugi@example.org', 2, 'pending',
   90000, 10000, 'PLN', '72c00000-0000-0000-0000-000000000006',
   NULL, NULL, '2026-01-02 10:00+00'),
  ('72f00000-0000-0000-0000-0000000000c4', '11111111-1111-1111-1111-111111111111',
   '72e00000-0000-0000-0000-0000000000a1', '72900000-0000-0000-0000-0000000000a2',
   '72a00000-0000-0000-0000-0000000000a2', 'pak72.kupujacy@example.org', 2, 'paid',
   90000, 10000, 'PLN', '72c00000-0000-0000-0000-000000000006',
   '2026-01-04 12:00+00', NULL, '2026-01-04 10:00+00'),
  ('72f00000-0000-0000-0000-0000000000c5', '11111111-1111-1111-1111-111111111111',
   '72e00000-0000-0000-0000-0000000000a1', '72900000-0000-0000-0000-0000000000a2',
   '72a00000-0000-0000-0000-0000000000a3', 'pak72.drugi@example.org', 2, 'cancelled',
   90000, 10000, 'PLN', '72c00000-0000-0000-0000-000000000006',
   NULL, '2026-01-05 12:00+00', '2026-01-03 10:00+00');

INSERT INTO pg_temp.t72 (k, id) VALUES
  ('ol1', '72f00000-0000-0000-0000-0000000000c1'),
  ('oa1', '72f00000-0000-0000-0000-0000000000c2'),
  ('oa2', '72f00000-0000-0000-0000-0000000000c3'),
  ('on',  '72f00000-0000-0000-0000-0000000000c4'),
  ('oc1', '72f00000-0000-0000-0000-0000000000c5');

INSERT INTO public.b2b_coupon_redemptions
  (id, tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
   created_at)
VALUES
  ('72b00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   '72c00000-0000-0000-0000-000000000006', NULL, '72a00000-0000-0000-0000-0000000000a2',
   10000, 100000, 'PLN', '2026-01-01 10:00+00'),
  ('72b00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111',
   '72c00000-0000-0000-0000-000000000006', NULL, '72a00000-0000-0000-0000-0000000000a3',
   10000, 100000, 'PLN', '2026-01-02 10:00+00'),
  ('72b00000-0000-0000-0000-0000000000c3', '11111111-1111-1111-1111-111111111111',
   '72c00000-0000-0000-0000-000000000006', NULL, '72a00000-0000-0000-0000-0000000000a3',
   10000, 100000, 'PLN', '2026-01-02 10:00+00'),
  ('72b00000-0000-0000-0000-0000000000c4', '11111111-1111-1111-1111-111111111111',
   '72c00000-0000-0000-0000-000000000006', NULL, '72a00000-0000-0000-0000-0000000000a2',
   10000, 100000, 'PLN', '2026-01-04 10:00:01+00'),
  ('72b00000-0000-0000-0000-0000000000c5', '11111111-1111-1111-1111-111111111111',
   '72c00000-0000-0000-0000-000000000006', NULL, '72a00000-0000-0000-0000-0000000000a3',
   10000, 100000, 'PLN', '2026-01-03 10:00+00');

DO $do$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public._event_package_coupon_link_backfill();
  PERFORM pg_temp.assert((v_res->>'linked')::integer = 3 AND (v_res->>'released')::integer = 1,
    format('72/dopiecie: pierwsze wywolanie - linked 3, released 1 (jest: %s)', v_res));

  PERFORM pg_temp.assert(
    (SELECT r.package_order_id FROM public.b2b_coupon_redemptions r
      WHERE r.id = '72b00000-0000-0000-0000-0000000000c1') = pg_temp.o72('ol1')
    AND (pg_temp.ord72('ol1')).coupon_released_at IS NULL,
    '72/dopiecie: para jednoznaczna powiazana, zamowienie oplacone bez zatrzasku');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.b2b_coupon_redemptions r
      WHERE r.id IN ('72b00000-0000-0000-0000-0000000000c2',
                     '72b00000-0000-0000-0000-0000000000c3')
        AND r.package_order_id IS NULL) = 2
    AND pg_temp.linked72('oa1') = 0 AND pg_temp.linked72('oa2') = 0,
    '72/dopiecie: dwie nierozroznialne pary zostaja niepowiazane');
  PERFORM pg_temp.assert(
    (SELECT r.package_order_id FROM public.b2b_coupon_redemptions r
      WHERE r.id = '72b00000-0000-0000-0000-0000000000c4') IS NULL
    AND pg_temp.linked72('on') = 0,
    '72/dopiecie: realizacja sekunde pozniej niz zamowienie nie jest wiazana');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.b2b_coupon_redemptions r
                 WHERE r.id = '72b00000-0000-0000-0000-0000000000c5')
    AND (pg_temp.ord72('oc1')).coupon_released_at IS NOT NULL
    AND (pg_temp.ord72('oc1')).status = 'cancelled',
    '72/dopiecie: zamowienie anulowane przed migracja oddaje uzycie i dostaje zatrzask');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000006') = 4,
    '72/dopiecie: licznik kodu 5 -> 4 (oddane tylko uzycie anulowanego zamowienia)');
  PERFORM pg_temp.assert(pg_temp.linked72('o8') = 1
    AND pg_temp.cnt72('72c00000-0000-0000-0000-000000000005') = 1,
    '72/dopiecie: odpieta realizacja z sekcji M powiazana z powrotem, licznik bez zmian');

  v_res := public._event_package_coupon_link_backfill();
  PERFORM pg_temp.assert((v_res->>'linked')::integer = 0 AND (v_res->>'released')::integer = 0,
    format('72/dopiecie: drugie wywolanie niczego nie zmienia (jest: %s)', v_res));
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000006') = 4,
    '72/dopiecie: drugie wywolanie nie zdejmuje licznika drugi raz');

  -- Po dopieciu stare zamowienia zachowuja sie jak nowe.
  PERFORM pg_temp.st72('ol1', 'cancelled');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000006') = 3
    AND pg_temp.linked72('ol1') = 0
    AND (pg_temp.ord72('ol1')).coupon_released_at IS NOT NULL,
    '72/dopiecie: anulowanie dopietego zamowienia oddaje uzycie');
  PERFORM pg_temp.st72('oc1', 'paid');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000006') = 4
    AND pg_temp.linked72('oc1') = 1
    AND (pg_temp.ord72('oc1')).coupon_released_at IS NULL,
    '72/dopiecie: powrot zamowienia anulowanego przed migracja zuzywa kod z powrotem');
  PERFORM pg_temp.st72('oa1', 'cancelled');
  PERFORM pg_temp.assert(pg_temp.cnt72('72c00000-0000-0000-0000-000000000006') = 4
    AND (pg_temp.ord72('oa1')).coupon_released_at IS NULL,
    '72/dopiecie: anulowanie zamowienia z para niejednoznaczna nie oddaje niczego');
END $do$;

-- ---------------------------------------------------------------------------
-- P. CHECK ZATRZASKU I GRANTY
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  PERFORM pg_temp.assert_raises_like(format(
    $q$UPDATE public.event_package_orders SET coupon_released_at = now() WHERE id = %L$q$,
    pg_temp.o72('o4')),
    'event_package_orders_coupon_released_stamp',
    '72/schemat: zatrzask nie stoi na zamowieniu, ktore nie jest anulowane');

  PERFORM pg_temp.assert(
    has_function_privilege('authenticated', 'public.admin_event_package_order_set_status(jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.admin_event_package_order_set_status(jsonb)', 'EXECUTE'),
    '72/granty: zmiana statusu dla authenticated i service_role');
  PERFORM pg_temp.assert(
    NOT has_function_privilege('anon', 'public.admin_event_package_order_set_status(jsonb)', 'EXECUTE'),
    '72/granty: anon nie wola zmiany statusu');
  PERFORM pg_temp.assert(
    has_function_privilege('service_role', 'public._event_package_coupon_link_backfill()', 'EXECUTE'),
    '72/granty: dopiecie dla service_role');
  PERFORM pg_temp.assert(
    NOT has_function_privilege('authenticated', 'public._event_package_coupon_link_backfill()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public._event_package_coupon_link_backfill()', 'EXECUTE'),
    '72/granty: dopiecia nie wola ani authenticated, ani anon');
END $do$;

ROLLBACK;

\echo '== 72 anulowanie zamowienia pakietu oddaje uzycie kodu: koniec =='
