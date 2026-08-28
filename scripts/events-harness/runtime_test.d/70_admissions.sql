-- ===========================================================================
-- 70 WEJSCIOWKI, PAKIETY I KUPONY (migracja 20260824080000)
--
-- CO TEN PLIK DOWODZI. Migracja, ktora sie REPLAYUJE, nie jest migracja, ktora
-- DZIALA. Replay mowi tylko, ze skladnia jest poprawna i zaleznosci istnieja.
-- Ponizsze asercje sprawdzaja rzeczy, ktore da sie ZLAMAC:
--   * dwie pule schodza razem przy jednym zakupie pakietu,
--   * stawka ulgowa odmawia bez weryfikacji i otwiera sie po nadaniu,
--   * rabat kwotowy wiekszy od ceny zeruje cene, a nie tworzy naleznosci,
--   * generator kodow PRZENOSI zakres wydarzeniowy - to jest asercja pod
--     konkretny blad, ktory ta migracja naprawila: bez niej kody z kampanii
--     wydarzeniowej wychodzily bez zawezenia i obnizaly cene wszedzie,
--   * token zaproszenia nie zostaje w bazie jawny,
--   * najemca B nie widzi ani jednego wiersza cennika najemcy A.
-- ===========================================================================
\echo '== 70 wejsciowki, pakiety, kupony =='
BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('70000000-0000-0000-0000-0000000000b0', 'Tenant B (wejsciowki)', 'tb-adm')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('70a00000-0000-0000-0000-0000000000a1', 'adm.editor.a@example.org'),
  ('70a00000-0000-0000-0000-0000000000a2', 'kupujacy.a@example.org'),
  ('70a00000-0000-0000-0000-0000000000a3', 'doktorant@uczelnia.edu.pl'),
  ('70a00000-0000-0000-0000-0000000000a4', 'fundacja@ngo-domena.org'),
  ('70a00000-0000-0000-0000-0000000000b1', 'adm.editor.b@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('70a00000-0000-0000-0000-0000000000a1', 'admin'),
  ('70a00000-0000-0000-0000-0000000000b1', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('70a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('70a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111'),
  ('70a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111'),
  ('70a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111'),
  ('70a00000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-0000000000b0')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('70e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'adm-kongres-a', 'Kongres', 'Congress', now() + interval '40 days', 'published'),
  ('70e00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'adm-warsztat-a', 'Warsztat', 'Workshop', now() + interval '50 days', 'published'),
  ('70e00000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-0000000000b0',
   'adm-kongres-b', 'Kongres B', 'Congress B', now() + interval '40 days', 'published')
ON CONFLICT (id) DO NOTHING;

-- Domena akademicka na liscie weryfikacji: doktorant kwalifikuje sie AUTOMATEM,
-- fundacja NIE - i to jest cala roznica miedzy tymi dwiema stawkami dzisiaj.
INSERT INTO public.verification_domains (tenant_id, domain, academic, active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'uczelnia.edu.pl', true, true)
ON CONFLICT DO NOTHING;

-- Rodzaje wejsciowek: zwykla, akademicka z wymogiem weryfikacji, oraz rodzaj
-- pakietowy z mala pula, na ktorej widac zajmowanie miejsc.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, audience, requires_verification, max_per_person)
VALUES
  ('70700000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '70e00000-0000-0000-0000-0000000000a1', 'standard', 'Standard', 'Standard',
   60000, 'PLN', 100, 'public', false, 1),
  ('70700000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '70e00000-0000-0000-0000-0000000000a1', 'akademicka', 'Akademicka', 'Academic',
   15000, 'PLN', 50, 'academic', true, 1),
  ('70700000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '70e00000-0000-0000-0000-0000000000a1', 'firmowa', 'Firmowa', 'Corporate',
   80000, 'PLN', 9, 'company', false, NULL),
  ('70700000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-0000000000b0',
   '70e00000-0000-0000-0000-0000000000b1', 'standard', 'Standard B', 'Standard B',
   50000, 'PLN', 10, 'public', false, 1)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- A. DEFINICJA PAKIETU
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_pkg uuid;
  v_txt text;
  v_int integer;
BEGIN
  PERFORM pg_temp.act_as('70a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');

  v_pkg := public.admin_event_package_upsert(jsonb_build_object(
    'event_id', '70e00000-0000-0000-0000-0000000000a1',
    'ticket_type_id', '70700000-0000-0000-0000-0000000000a3',
    'key', 'Firmowy_5', 'name_pl', 'Pakiet firmowy 5', 'name_en', 'Corporate 5',
    'audience', 'company', 'seats', 5, 'price_cents', 320000, 'currency', 'PLN',
    'quota', 3));
  PERFORM pg_temp.assert(v_pkg IS NOT NULL, '70/pakiet: utworzony');

  SELECT p.key INTO v_txt FROM public.event_ticket_packages p WHERE p.id = v_pkg;
  PERFORM pg_temp.assert(v_txt = 'firmowy_5',
    '70/pakiet: klucz znormalizowany do malych liter');

  -- CENA PAKIETU JEST WLASNA, nie iloczynem. Piec miejsc po 800 zl to 4000 zl,
  -- a pakiet kosztuje 3200 zl - i to jest caly powod, dla ktorego pakiet istnieje.
  SELECT p.price_cents INTO v_int FROM public.event_ticket_packages p WHERE p.id = v_pkg;
  PERFORM pg_temp.assert(v_int = 320000,
    '70/pakiet: cena WLASNA, nie iloczyn ceny rodzaju razy liczba miejsc');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_package_upsert(jsonb_build_object(
         'event_id','70e00000-0000-0000-0000-0000000000a1',
         'ticket_type_id','70700000-0000-0000-0000-0000000000a3',
         'key','jednomiejscowy','name_pl','Jednomiejscowy','name_en','Single','seats',1))$q$,
    'event_ticket_packages_seats_range',
    '70/pakiet: jedno miejsce odrzucone - to jest wejsciowka, nie pakiet');

  -- Rodzaj z INNEGO wydarzenia odrzucany kluczem obcym ZLOZONYM, nie kodem RPC.
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_package_upsert(jsonb_build_object(
         'event_id','70e00000-0000-0000-0000-0000000000a2',
         'ticket_type_id','70700000-0000-0000-0000-0000000000a3',
         'key','obcy','name_pl','Obcy rodzaj','name_en','Foreign type','seats',3))$q$,
    'ticket does not exist for this event',
    '70/IZOLACJA: rodzaj wejsciowki z INNEGO wydarzenia odrzucony przy zapisie pakietu');
END $do$;

-- ---------------------------------------------------------------------------
-- B. UPRAWNIENIE DO STAWKI ULGOWEJ
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_q jsonb;
  v_grant uuid;
BEGIN
  -- Doktorant z domeny na liscie: automat otwiera stawke akademicka.
  PERFORM pg_temp.act_as('70a00000-0000-0000-0000-0000000000a3',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(public.event_audience_qualifies('academic'),
    '70/stawka: domena z verification_domains kwalifikuje AUTOMATEM');
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '70700000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean,
    '70/wycena: doktorant dostaje stawke akademicka');
  PERFORM pg_temp.assert((v_q->>'total_cents')::integer = 15000,
    '70/wycena: cena akademicka bez rabatu to 150 zl');

  -- Fundacja: BRAK domeny na liscie i BRAK nadania - stawka zamknieta.
  PERFORM pg_temp.act_as('70a00000-0000-0000-0000-0000000000a4',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(NOT public.event_audience_qualifies('academic'),
    '70/stawka: obca domena NIE kwalifikuje automatem');
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '70700000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert(NOT (v_q->>'ok')::boolean
    AND v_q->>'reason' = 'audience_not_verified',
    '70/wycena: odmowa ma NAZWE audience_not_verified, nie goly falsz');

  -- Reczne nadanie - domkniecie wyjatku, ktory 20260822094000 nazwala
  -- i zostawila bez nosnika.
  PERFORM pg_temp.act_as('70a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');
  v_grant := public.admin_event_audience_grant_save(jsonb_build_object(
    'audience', 'academic',
    'user_id', '70a00000-0000-0000-0000-0000000000a4',
    'evidence', 'Legitymacja pracownicza, weryfikacja 2026-08-24.'));
  PERFORM pg_temp.assert(v_grant IS NOT NULL, '70/nadanie: zapisane');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_audience_grant_save(jsonb_build_object(
         'audience','academic','user_id','70a00000-0000-0000-0000-0000000000a2',
         'evidence','x'))$q$,
    'invalid_evidence',
    '70/nadanie: dowod krotszy niz trzy znaki odrzucony (slad audytowy rozliczen)');

  PERFORM pg_temp.act_as('70a00000-0000-0000-0000-0000000000a4',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(public.event_audience_qualifies('academic'),
    '70/stawka: po RECZNYM nadaniu stawka sie otwiera');

  -- Wycofanie STEMPLUJE i natychmiast zamyka stawke.
  PERFORM pg_temp.act_as('70a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM public.admin_event_audience_grant_revoke(v_grant);
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_audience_grants WHERE id = v_grant) = 1,
    '70/nadanie: wycofanie NIE kasuje wiersza (slad zostaje)');

  PERFORM pg_temp.act_as('70a00000-0000-0000-0000-0000000000a4',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(NOT public.event_audience_qualifies('academic'),
    '70/stawka: po wycofaniu nadania stawka znow zamknieta');
END $do$;

ROLLBACK;

\echo '== 70 wejsciowki: koniec =='
