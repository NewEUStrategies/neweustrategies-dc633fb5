-- ============================================================================
-- 31 REKLAMY NA STRONIE WYDARZENIA - panel, gosc, liczniki
--
-- Migracje `20260922200000_event_sponsor_sections_and_home_ads` i
-- `20260922200100_event_home_ads_viewer_status_fix` dodaly tabele
-- `event_home_ads` i `event_home_ad_events` oraz piec funkcji: trzy panelu
-- (`admin_event_home_ads_list`, `admin_event_home_ad_save`,
-- `admin_event_home_ad_delete`) i dwie publiczne (`event_home_ads_for_viewer`,
-- `event_home_ad_track`). Do tego pliku nie mialy ANI JEDNEJ asercji runtime.
--
-- DLACZEGO TO WAZNE, a nie formalnosc: ograniczenie `event_home_ads.link_url`
-- uzywalo wzorca `{3,2000}`, ktorego silnik wyrazen PostgreSQL w ogole nie
-- kompiluje (limit 255 powtorzen). Kazda reklama z linkiem padala przy zapisie.
-- Migracja nie mogla tego pokazac, bo tabela byla nowa i pusta. Pokazuje to
-- dopiero pierwsza asercja zapisu z linkiem - sekcja 2 ponizej. Naprawa:
-- `20260923000000_event_link_url_regex_within_limit`.
--
-- Plik sprawdza:
--   * zapis reklamy z linkiem i walidacje obu adresow (obraz, link),
--   * granice najemcy w panelu: zapis, zmiana, odczyt i usuniecie,
--   * widocznosc dla goscia: tylko opublikowane wydarzenie, aktywna reklama
--     w oknie czasowym, grupa odbiorcow tylko dla jej czlonkow,
--   * liczniki: jedno wyswietlenie na sesje i dobe, odmowa zlego wejscia,
--   * bramki rol i granty.
--
-- SPRZATANIE. Jedna transakcja zakonczona ROLLBACK-iem, jak kazdy plik
-- w runtime_test.d.
-- ============================================================================

\echo '== 31 reklamy na stronie wydarzenia: panel, gosc, liczniki =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA
--
-- Najemca A to najemca publiczny harnessu (11111111...), najemca B jest nowy.
-- a1 - admin A, a3 - uczestnik A bez roli, a5 - uczestnik A w grupie VIP,
-- b1 - admin B. Wydarzenia A: opublikowane (a1) i szkic (a2); wydarzenie B (b1).
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('31000000-0000-0000-0000-0000000000b0', 'Tenant B (reklamy)', 'tb-ads');

INSERT INTO auth.users (id, email) VALUES
  ('31a00000-0000-0000-0000-0000000000a1', 'ads.admin.a@example.org'),
  ('31a00000-0000-0000-0000-0000000000a3', 'ads.member.a@example.org'),
  ('31a00000-0000-0000-0000-0000000000a5', 'ads.vip.a@example.org'),
  ('31a00000-0000-0000-0000-0000000000b1', 'ads.admin.b@example.org');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('31a00000-0000-0000-0000-0000000000a1', 'admin'),
  ('31a00000-0000-0000-0000-0000000000b1', 'admin');

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('31a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('31a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111'),
  ('31a00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111'),
  ('31a00000-0000-0000-0000-0000000000b1', '31000000-0000-0000-0000-0000000000b0');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('31e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'ads-forum', 'Forum reklam', 'Ads forum', now() + interval '30 days', 'published'),
  ('31e00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'ads-szkic', 'Szkic reklam', 'Ads draft', now() + interval '30 days', 'draft'),
  ('31e00000-0000-0000-0000-0000000000b1', '31000000-0000-0000-0000-0000000000b0',
   'ads-forum-b', 'Forum B', 'Forum B', now() + interval '30 days', 'published');

-- Grupa VIP na wydarzeniu a1 i druga grupa na szkicu - ta druga sluzy odmowie
-- `invalid_group` (grupa z innego wydarzenia).
INSERT INTO public.event_groups (id, tenant_id, event_id, key, name_pl, name_en) VALUES
  ('31c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   '31e00000-0000-0000-0000-0000000000a1', 'vip', 'VIP', 'VIP'),
  ('31c00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111',
   '31e00000-0000-0000-0000-0000000000a2', 'vip_szkic', 'VIP szkic', 'VIP draft');

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('31d00000-0000-0000-0000-0000000000d5', '11111111-1111-1111-1111-111111111111',
   '31a00000-0000-0000-0000-0000000000a5', 'ads.vip.a@example.org', 'Vera', 'Vip');

INSERT INTO public.event_group_members (tenant_id, event_id, group_id, person_id) VALUES
  ('11111111-1111-1111-1111-111111111111', '31e00000-0000-0000-0000-0000000000a1',
   '31c00000-0000-0000-0000-0000000000c1', '31d00000-0000-0000-0000-0000000000d5');

CREATE TEMP TABLE ads_q (k text PRIMARY KEY, u uuid) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- SEKCJA 2: ZAPIS REKLAMY I WALIDACJA ADRESOW
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('31a00000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');

DO $do$
DECLARE v_id uuid;
BEGIN
  v_id := public.admin_event_home_ad_save(jsonb_build_object(
    'event_id', '31e00000-0000-0000-0000-0000000000a1',
    'image_url', 'https://cdn.example.org/ad-1.png',
    'link_url', 'https://partner.example.org/oferta',
    'alt_text', 'Partner forum'));
  INSERT INTO ads_q VALUES ('open', v_id);
  PERFORM pg_temp.assert(v_id IS NOT NULL,
    '31/zapis: reklama z linkiem https zapisana (wzorzec w granicach silnika)');
  PERFORM pg_temp.assert(
    (SELECT l.link_url FROM public.admin_event_home_ads_list('31e00000-0000-0000-0000-0000000000a1') l
      WHERE l.id = v_id) = 'https://partner.example.org/oferta',
    '31/zapis: lista panelu oddaje zapisany link');

  -- Pusty link to BRAK linku, nie pusty napis w kolumnie.
  v_id := public.admin_event_home_ad_save(jsonb_build_object(
    'event_id', '31e00000-0000-0000-0000-0000000000a1',
    'image_url', 'https://cdn.example.org/ad-2.png',
    'link_url', '',
    'group_ids', jsonb_build_array('31c00000-0000-0000-0000-0000000000c1')));
  INSERT INTO ads_q VALUES ('vip', v_id);
  PERFORM pg_temp.assert(
    (SELECT a.link_url IS NULL FROM public.event_home_ads a WHERE a.id = v_id),
    '31/zapis: pusty link zapisany jako NULL');

  -- Okno czasowe i wylaczenie - trzy reklamy, ktorych gosc NIE ma prawa zobaczyc.
  INSERT INTO ads_q VALUES ('future', public.admin_event_home_ad_save(jsonb_build_object(
    'event_id', '31e00000-0000-0000-0000-0000000000a1',
    'image_url', 'https://cdn.example.org/ad-3.png',
    'starts_at', (now() + interval '1 day')::text)));
  INSERT INTO ads_q VALUES ('ended', public.admin_event_home_ad_save(jsonb_build_object(
    'event_id', '31e00000-0000-0000-0000-0000000000a1',
    'image_url', 'https://cdn.example.org/ad-4.png',
    'starts_at', (now() - interval '2 days')::text,
    'ends_at', (now() - interval '1 day')::text)));
  INSERT INTO ads_q VALUES ('off', public.admin_event_home_ad_save(jsonb_build_object(
    'event_id', '31e00000-0000-0000-0000-0000000000a1',
    'image_url', 'https://cdn.example.org/ad-5.png',
    'is_active', false)));
  INSERT INTO ads_q VALUES ('draft', public.admin_event_home_ad_save(jsonb_build_object(
    'event_id', '31e00000-0000-0000-0000-0000000000a2',
    'image_url', 'https://cdn.example.org/ad-6.png')));
END
$do$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_home_ad_save(jsonb_build_object(
       'event_id', '31e00000-0000-0000-0000-0000000000a1',
       'image_url', 'https://cdn.example.org/ad-x.png',
       'link_url', 'http://partner.example.org'))$q$,
  'event_home_ads_link_url_check',
  '31/zapis: link bez https odrzucony przez ograniczenie kolumny');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_home_ad_save(jsonb_build_object(
       'event_id', '31e00000-0000-0000-0000-0000000000a1',
       'image_url', 'https://cdn.example.org/ad-x.png',
       'link_url', 'https://' || repeat('a', 2001)))$q$,
  'event_home_ads_link_url_check',
  '31/zapis: link dluzszy niz 2008 znakow odrzucony');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_home_ad_save(jsonb_build_object(
       'event_id', '31e00000-0000-0000-0000-0000000000a1',
       'image_url', 'http://cdn.example.org/ad-x.png'))$q$,
  'event_home_ads_image_url_check',
  '31/zapis: obraz bez https odrzucony');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_home_ad_save(jsonb_build_object(
       'event_id', '31e00000-0000-0000-0000-0000000000a1',
       'image_url', 'https://cdn.example.org/ad-x.png',
       'group_ids', jsonb_build_array('31c00000-0000-0000-0000-0000000000c2')))$q$,
  'invalid_group',
  '31/zapis: grupa innego wydarzenia odrzucona');

-- ---------------------------------------------------------------------------
-- SEKCJA 3: GRANICA NAJEMCY W PANELU
--
-- Admin B zna identyfikatory A (w tescie - w produkcji nie ma skad), a mimo
-- to nie zapisze, nie zmieni, nie odczyta i nie usunie niczego u A.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('31a00000-0000-0000-0000-0000000000b1',
                      '31000000-0000-0000-0000-0000000000b0');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_home_ad_save(jsonb_build_object(
       'event_id', '31e00000-0000-0000-0000-0000000000a1',
       'image_url', 'https://cdn.example.org/b.png'))$q$,
  'event_not_found',
  '31/izolacja: admin B nie doda reklamy do wydarzenia A');
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_home_ad_save(jsonb_build_object(
       'id', '%s', 'image_url', 'https://cdn.example.org/b.png'))$q$,
         (SELECT u FROM ads_q WHERE k = 'open')),
  'ad_not_found',
  '31/izolacja: admin B nie zmieni reklamy A');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_home_ads_list('31e00000-0000-0000-0000-0000000000a1')) = 0,
  '31/izolacja: admin B nie widzi reklam wydarzenia A');
SELECT pg_temp.assert(
  NOT public.admin_event_home_ad_delete((SELECT u FROM ads_q WHERE k = 'open'))
  AND EXISTS (SELECT 1 FROM public.event_home_ads a WHERE a.id = (SELECT u FROM ads_q WHERE k = 'open')),
  '31/izolacja: usuniecie reklamy A przez admina B nic nie usuwa');

-- ---------------------------------------------------------------------------
-- SEKCJA 4: CO WIDZI GOSC
--
-- `event_home_ads_for_viewer` zwraca LOSOWE piec, wiec asercje pytaja
-- o przynaleznosc konkretnej reklamy do wyniku, a nie o kolejnosc.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_home_ads_for_viewer('ads-forum')) = 1
  AND EXISTS (SELECT 1 FROM public.event_home_ads_for_viewer('ads-forum') v
               WHERE v.id = (SELECT u FROM ads_q WHERE k = 'open')
                 AND v.link_url = 'https://partner.example.org/oferta'),
  '31/gosc: anonim widzi JEDYNIE aktywna reklame bez grupy, w oknie czasowym, z linkiem');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_home_ads_for_viewer('ads-forum') v
               WHERE v.id IN (SELECT u FROM ads_q WHERE k IN ('future', 'ended', 'off', 'vip'))),
  '31/gosc: reklama przyszla, wygasla, wylaczona i grupowa sa niewidoczne dla anonima');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_home_ads_for_viewer('ads-szkic')) = 0,
  '31/gosc: szkic wydarzenia nie pokazuje reklam, nawet aktywnych');

SELECT pg_temp.act_as('31a00000-0000-0000-0000-0000000000a5',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.event_home_ads_for_viewer('ads-forum') v
           WHERE v.id = (SELECT u FROM ads_q WHERE k = 'vip')),
  '31/gosc: czlonek grupy VIP widzi reklame skierowana do grupy');

SELECT pg_temp.act_as('31a00000-0000-0000-0000-0000000000a3',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_home_ads_for_viewer('ads-forum') v
               WHERE v.id = (SELECT u FROM ads_q WHERE k = 'vip')),
  '31/gosc/kontrapunkt: zalogowany spoza grupy NIE widzi reklamy grupowej');

-- Kontekst najemcy B: ten sam slug A nie zwraca niczego.
SELECT pg_temp.act_as(NULL, '31000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_home_ads_for_viewer('ads-forum')) = 0,
  '31/gosc/izolacja: w kontekscie najemcy B reklamy wydarzenia A nie istnieja');

-- ---------------------------------------------------------------------------
-- SEKCJA 5: LICZNIKI WYSWIETLEN I KLIKNIEC
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert(
  public.event_home_ad_track((SELECT u FROM ads_q WHERE k = 'open'), 'view', 'sesja-000001'),
  '31/licznik: pierwsze wyswietlenie w sesji zapisane');
SELECT pg_temp.assert(
  NOT public.event_home_ad_track((SELECT u FROM ads_q WHERE k = 'open'), 'view', 'sesja-000001'),
  '31/licznik: drugie wyswietlenie tej samej sesji tego samego dnia NIE liczy sie drugi raz');
SELECT pg_temp.assert(
  public.event_home_ad_track((SELECT u FROM ads_q WHERE k = 'open'), 'click', 'sesja-000001'),
  '31/licznik: klikniecie liczy sie osobno od wyswietlenia');
SELECT pg_temp.assert(
  NOT public.event_home_ad_track((SELECT u FROM ads_q WHERE k = 'open'), 'share', 'sesja-000001'),
  '31/licznik: nieznany rodzaj zdarzenia odrzucony');
SELECT pg_temp.assert(
  NOT public.event_home_ad_track((SELECT u FROM ads_q WHERE k = 'open'), 'view', 'krotka'),
  '31/licznik: za krotki identyfikator sesji odrzucony');
SELECT pg_temp.assert(
  NOT public.event_home_ad_track((SELECT u FROM ads_q WHERE k = 'off'), 'view', 'sesja-000002'),
  '31/licznik: wylaczona reklama nie zbiera wyswietlen');
SELECT pg_temp.assert(
  (SELECT e.session_hash <> 'sesja-000001' FROM public.event_home_ad_events e
    WHERE e.ad_id = (SELECT u FROM ads_q WHERE k = 'open') AND e.kind = 'view'),
  '31/licznik: identyfikator sesji zapisany wylacznie jako skrot');

SELECT pg_temp.act_as(NULL, '31000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert(
  NOT public.event_home_ad_track((SELECT u FROM ads_q WHERE k = 'open'), 'view', 'sesja-000003'),
  '31/licznik/izolacja: w kontekscie najemcy B reklama A nie zbiera wyswietlen');

SELECT pg_temp.act_as('31a00000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (SELECT l.views = 1 AND l.clicks = 1
     FROM public.admin_event_home_ads_list('31e00000-0000-0000-0000-0000000000a1') l
    WHERE l.id = (SELECT u FROM ads_q WHERE k = 'open')),
  '31/licznik: panel pokazuje jedno wyswietlenie i jedno klikniecie');

-- ---------------------------------------------------------------------------
-- SEKCJA 6: ZMIANA I USUNIECIE PRZEZ WLASCICIELA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE v_open uuid := (SELECT u FROM ads_q WHERE k = 'open');
BEGIN
  PERFORM public.admin_event_home_ad_save(jsonb_build_object(
    'id', v_open,
    'image_url', 'https://cdn.example.org/ad-1b.png',
    'link_url', 'https://partner.example.org/nowa',
    'alt_text', 'Nowy opis'));
  PERFORM pg_temp.assert(
    (SELECT a.image_url = 'https://cdn.example.org/ad-1b.png'
        AND a.link_url = 'https://partner.example.org/nowa'
        AND a.alt_text = 'Nowy opis'
       FROM public.event_home_ads a WHERE a.id = v_open),
    '31/zmiana: wlasciciel zmienia obraz, link i opis reklamy');
  PERFORM pg_temp.assert(public.admin_event_home_ad_delete(v_open),
    '31/usuniecie: wlasciciel usuwa reklame');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_home_ad_events e WHERE e.ad_id = v_open),
    '31/usuniecie: liczniki reklamy ida kaskada');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 7: BRAMKI ROL I GRANTY
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_home_ads_list('31e00000-0000-0000-0000-0000000000a1')$q$,
  'forbidden',
  '31/bramka: anonim nie widzi listy reklam panelu');

SELECT pg_temp.act_as('31a00000-0000-0000-0000-0000000000a3',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_home_ad_save(jsonb_build_object(
       'event_id', '31e00000-0000-0000-0000-0000000000a1',
       'image_url', 'https://cdn.example.org/x.png'))$q$,
  'forbidden',
  '31/bramka: uczestnik bez roli nie dodaje reklam');
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_home_ad_delete('%s')$q$, (SELECT u FROM ads_q WHERE k = 'vip')),
  'forbidden',
  '31/bramka: uczestnik bez roli nie usuwa reklam');

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_home_ad_save(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_home_ads_list(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_home_ad_delete(uuid)', 'EXECUTE'),
  '31/granty: anon nie ma prawa wykonania zadnej funkcji panelu reklam');
SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_home_ads_for_viewer(text)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.event_home_ad_track(uuid, text, text)', 'EXECUTE'),
  '31/granty/kontrapunkt: anon wykonuje odczyt dla goscia i licznik');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_sponsor_set_link(uuid, text, text)', 'EXECUTE'),
  '31/granty: CREATE OR REPLACE w migracji korygujacej zachowal odebranie grantu anonimowi');

ROLLBACK;

\echo '== 31 reklamy na stronie wydarzenia: koniec =='
