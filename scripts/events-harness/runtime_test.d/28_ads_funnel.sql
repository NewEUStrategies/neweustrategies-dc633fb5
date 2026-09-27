-- ============================================================================
-- 28_ads_funnel - LEJEK SPRZEDAZY WYDARZENIA I KAMPANIE GOOGLE ADS
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20260927000300 stawia trzy powierzchnie o roznym zaufaniu:
-- anonimowy zapis krokow lejka (service_role za endpointem publicznym),
-- przypiecie atrybucji pod kluczem `manage_token` (anon) i panel organizatora
-- (admin). Bramki tekstowe widza tylko ksztalt; to, czy identyfikator
-- klikniecia NAPRAWDE nie trafia do bazy bez zgody reklamowej, czy obcy
-- najemca NAPRAWDE nie widzi kampanii, czy przychod grupy NAPRAWDE nie liczy
-- sie dwa razy i czy do CRM NAPRAWDE nie wyplywa gclid - widac dopiero przy
-- wykonaniu. Kazda obietnica ma tu dowod z oboma bokami.
--
-- CZEGO TU DOWODZIMY
--   (a) normalizacja dotkniecia: e-mail w UTM odrzucony, znaki sterujace,
--       przyciecie, zrodlo/medium jak w GA, klikniecie tylko przy zgodzie,
--       dotkniecie starsze niz 90 dni = wejscie bezposrednie;
--   (b) `event_funnel_track`: zapis, deduplikacja w sesji, wydarzenie
--       nieopublikowane i obcego najemcy pominiete, odmowy z kodami, granty;
--   (c) `event_registration_attribution_attach`: zapis raz, zly klucz,
--       klucz obcego najemcy, "za pozno", wejscie bezposrednie, klikniecie bez
--       zgody zdjete, CRM (segment, tagi, pola kampanii, os czasu) BEZ gclid;
--   (d) mapowanie kampanii i koszty: zapis, zmiana z obecnoscia klucza,
--       duplikat, walidacje, upsert dnia, usuwanie, izolacja najemcow, role;
--   (e) raport lejka: grupy, kanaly, koszty w oknie, przychod netto per
--       zamowienie (gosc grupy nie dubluje), zgloszenia bez atrybucji, sumy;
--   (f) eksport konwersji offline: tylko oplacone z kliknieciem przy zgodzie,
--       czas w strefie wydarzenia, nazwa konwersji, liczniki pominietych;
--   (g) RLS czterech tabel (admin tak, redaktor/uzytkownik/obcy/anon nie);
--   (h) retencja: klikniecia zerowane po 120 dniach, kroki kasowane po 400.
--
-- CZEGO NIE SPRAWDZA: endpointu HTTP (limiter, bot, host) - to vitest
-- `src/routes/api/public/-event-funnel.test.ts`; harmonogramu pg_cron (brak
-- rozszerzenia w obrazie).
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem, wiec
-- `now()` jest STALE przez caly plik - okna czasowe sa deterministyczne.
-- ============================================================================

\echo '== 28 lejek sprzedazy wydarzenia i kampanie Google Ads =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('28000000-0000-0000-0000-0000000000b0', 'Tenant 28 B', 't28b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('28a00000-0000-0000-0000-0000000000a1', 'lejek.admin@example.org'),
  ('28a00000-0000-0000-0000-0000000000a2', 'lejek.redaktor@example.org'),
  ('28a00000-0000-0000-0000-0000000000a3', 'lejek.uzytkownik@example.org'),
  ('28a00000-0000-0000-0000-0000000000b1', 'lejek.admin.b@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('28a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111'),
  ('28a00000-0000-0000-0000-0000000000a2', 'editor', '11111111-1111-1111-1111-111111111111'),
  ('28a00000-0000-0000-0000-0000000000b1', 'admin', '28000000-0000-0000-0000-0000000000b0')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('28a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 28', 'lejek-admin'),
  ('28a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Redaktor 28', 'lejek-redaktor'),
  ('28a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Uzytkownik 28', 'lejek-uzytkownik'),
  ('28a00000-0000-0000-0000-0000000000b1', '28000000-0000-0000-0000-0000000000b0', 'Admin 28 B', 'lejek-admin-b')
ON CONFLICT (id) DO NOTHING;

-- E1 opublikowane (A), E2 szkic (A), EB opublikowane w B pod TYM SAMYM slugiem.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, timezone) VALUES
  ('28e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'lejek-28', 'Kongres 28', 'Congress 28', now() + interval '30 days', 'published', 'Europe/Warsaw'),
  ('28e00000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
   'lejek-28-szkic', 'Szkic 28', 'Draft 28', now() + interval '40 days', 'draft', 'Europe/Warsaw'),
  ('28e00000-0000-0000-0000-0000000000eb', '28000000-0000-0000-0000-0000000000b0',
   'lejek-28', 'Obce 28', 'Foreign 28', now() + interval '30 days', 'published', 'Europe/Warsaw')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_people
  (id, tenant_id, email, first_name, last_name, consent_data_processing_at, consent_marketing_at, source)
VALUES
  ('28f00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'kampania.jeden@example.org', 'Jan', 'Kampania', now(), now() - interval '1 hour', 'self_registration'),
  ('28f00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'kampania.dwa@example.org', 'Ewa', 'Pmax', now(), NULL, 'self_registration'),
  ('28f00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'bezposredni@example.org', 'Olga', 'Wprost', now(), NULL, 'self_registration'),
  ('28f00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'bez.zgody@example.org', 'Piotr', 'Bezzgody', now(), NULL, 'self_registration'),
  ('28f00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'gosc@example.org', 'Gosc', 'Grupy', now(), NULL, 'self_registration'),
  ('28f00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'stary.zapis@example.org', 'Stary', 'Zapis', now(), NULL, 'self_registration'),
  ('28f00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'przed.kliknieciem@example.org', 'Anna', 'Wczesna', now(), NULL, 'self_registration')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payment_orders
  (id, tenant_id, status, amount_cents, currency, metadata, paid_at, refunded_amount_cents)
VALUES
  ('28b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'paid', 49900, 'PLN', '{}'::jsonb, now() - interval '1 hour', 0),
  ('28b00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'paid', 30000, 'PLN', '{}'::jsonb, now() - interval '1 hour', 10000),
  ('28b00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'paid', 20000, 'PLN', '{}'::jsonb, now() - interval '1 hour', 0),
  ('28b00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'paid', 10000, 'PLN', '{}'::jsonb, now() - interval '3 hours', 0)
ON CONFLICT (id) DO NOTHING;

-- Zgloszenia E1 z kluczami samoobslugi (w bazie skrot SHA-256, jak w event_register).
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status,
   payment_order_id, manage_token_hash, created_at, group_lead_registration_id)
VALUES
  ('28c00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '28e00000-0000-0000-0000-0000000000e1', '28f00000-0000-0000-0000-000000000001',
   'approved', 'form', 'paid', '28b00000-0000-0000-0000-000000000001',
   encode(digest('token-28-jeden-aaaaaaaaaaaaaaaaaa', 'sha256'), 'hex'), now(), NULL),
  ('28c00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '28e00000-0000-0000-0000-0000000000e1', '28f00000-0000-0000-0000-000000000002',
   'approved', 'form', 'partially_refunded', '28b00000-0000-0000-0000-000000000002',
   encode(digest('token-28-dwa-bbbbbbbbbbbbbbbbbbbbb', 'sha256'), 'hex'), now(), NULL),
  ('28c00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '28e00000-0000-0000-0000-0000000000e1', '28f00000-0000-0000-0000-000000000003',
   'approved', 'form', 'not_required', NULL,
   encode(digest('token-28-trzy-ccccccccccccccccccc', 'sha256'), 'hex'), now(), NULL),
  ('28c00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '28e00000-0000-0000-0000-0000000000e1', '28f00000-0000-0000-0000-000000000004',
   'approved', 'form', 'paid', '28b00000-0000-0000-0000-000000000004',
   encode(digest('token-28-cztery-ddddddddddddddddd', 'sha256'), 'hex'), now(), NULL),
  ('28c00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '28e00000-0000-0000-0000-0000000000e1', '28f00000-0000-0000-0000-000000000006',
   'approved', 'form', 'not_required', NULL,
   encode(digest('token-28-szesc-fffffffffffffffff', 'sha256'), 'hex'), now() - interval '2 days', NULL),
  ('28c00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   '28e00000-0000-0000-0000-0000000000e1', '28f00000-0000-0000-0000-000000000007',
   'approved', 'form', 'paid', '28b00000-0000-0000-0000-000000000007',
   encode(digest('token-28-siedem-ggggggggggggggggg', 'sha256'), 'hex'), now(), NULL)
ON CONFLICT (id) DO NOTHING;

-- Gosc grupy prowadzacego r1 - TO SAMO zamowienie. Nie jest osobna konwersja.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status,
   payment_order_id, created_at, group_lead_registration_id)
VALUES
  ('28c00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '28e00000-0000-0000-0000-0000000000e1', '28f00000-0000-0000-0000-000000000005',
   'approved', 'form', 'paid', '28b00000-0000-0000-0000-000000000001', now(),
   '28c00000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- (a) NORMALIZACJA DOTKNIECIA
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_ms numeric := floor(extract(epoch FROM now()) * 1000);
  v jsonb;
BEGIN
  v := public._event_ads_touch(jsonb_build_object(
    'ts', v_ms, 'landing_path', '/events/lejek-28',
    'utm_source', ' Google ', 'utm_medium', 'CPC', 'utm_campaign', E'Wio\u0007sna',
    'utm_content', 'jan.kowalski@example.org', 'utm_term', repeat('x', 150),
    'click_id_type', 'gclid', 'click_id', 'Cj0KCQjw-abc_DEF123'), true, now());
  PERFORM pg_temp.assert(v->>'utm_source' = 'google' AND v->>'utm_medium' = 'cpc',
    '28/dotkniecie: zrodlo i medium przyciete i malymi literami');
  PERFORM pg_temp.assert(v->>'utm_campaign' = 'Wiosna',
    '28/dotkniecie: znak sterujacy usuniety, wielkosc liter kampanii zachowana');
  PERFORM pg_temp.assert(v->'utm_content' = 'null'::jsonb,
    '28/dotkniecie: adres e-mail w utm_content ODRZUCONY w calosci');
  PERFORM pg_temp.assert(char_length(v->>'utm_term') = 100,
    '28/dotkniecie: utm_term przyciety do 100 znakow');
  PERFORM pg_temp.assert(v->>'click_id' = 'Cj0KCQjw-abc_DEF123' AND v->>'click_id_type' = 'gclid',
    '28/dotkniecie: klikniecie ZE zgoda reklamowa zachowane');
  PERFORM pg_temp.assert(v->>'landing_path' = '/events/lejek-28'
    AND (v->>'touch_at')::timestamptz = to_timestamp(v_ms / 1000.0),
    '28/dotkniecie: sciezka wejscia i czas dotkniecia');

  v := public._event_ads_touch(jsonb_build_object(
    'ts', v_ms, 'click_id_type', 'gbraid', 'click_id', 'Cj0KCQjw-abc_DEF123'), false, now());
  PERFORM pg_temp.assert(v->'click_id' = 'null'::jsonb AND v->'click_id_type' = 'null'::jsonb,
    '28/dotkniecie: klikniecie BEZ zgody reklamowej zdjete');
  PERFORM pg_temp.assert(v->>'source' = 'google' AND v->>'medium' = 'cpc',
    '28/dotkniecie: sam rodzaj klikniecia nadal klasyfikuje wizyte jako google/cpc');

  v := public._event_ads_touch(jsonb_build_object('ts', v_ms, 'referrer_host', 'WWW.Bing.com'), false, now());
  PERFORM pg_temp.assert(v->>'source' = 'bing' AND v->>'medium' = 'organic'
    AND v->>'referrer_host' = 'bing.com',
    '28/dotkniecie: wyszukiwarka = organic, www zdjete');
  v := public._event_ads_touch(jsonb_build_object('ts', v_ms, 'referrer_host', 'portal.example.org'), false, now());
  PERFORM pg_temp.assert(v->>'source' = 'portal.example.org' AND v->>'medium' = 'referral',
    '28/dotkniecie: inna domena = referral');
  v := public._event_ads_touch(jsonb_build_object('ts', v_ms, 'gad_campaign_id', '123456789',
    'gad_source', '1', 'referrer_host', 'bad host!'), false, now());
  PERFORM pg_temp.assert(v->>'source' = 'google' AND v->>'medium' = 'cpc'
    AND v->>'gad_campaign_id' = '123456789' AND v->'referrer_host' = 'null'::jsonb,
    '28/dotkniecie: gad_campaignid = google/cpc; nieprawidlowy host odrzucony');
  v := public._event_ads_touch(jsonb_build_object('ts', v_ms, 'utm_term', 'energia'), false, now());
  PERFORM pg_temp.assert(v->>'source' = '(not set)' AND v->>'medium' = '(not set)',
    '28/dotkniecie: bez zrodla i medium - (not set), nie (direct)');

  PERFORM pg_temp.assert(public._event_ads_touch(jsonb_build_object('ts', v_ms,
      'gad_campaign_id', 'abc', 'click_id_type', 'fbclid', 'landing_path', '/x?y'), true, now()) IS NULL,
    '28/dotkniecie: same bledne pola = wejscie bezposrednie (NULL)');
  PERFORM pg_temp.assert(public._event_ads_touch(jsonb_build_object(
      'ts', floor(extract(epoch FROM now() - interval '91 days') * 1000), 'utm_source', 'google'),
      false, now()) IS NULL,
    '28/dotkniecie: starsze niz 90 dni = NULL');
  PERFORM pg_temp.assert(public._event_ads_touch(jsonb_build_object('utm_source', 'google'),
      false, now()) IS NULL,
    '28/dotkniecie: bez czasu = NULL');
  PERFORM pg_temp.assert(public._event_ads_touch('[1]'::jsonb, true, now()) IS NULL
      AND public._event_ads_touch(NULL, true, now()) IS NULL,
    '28/dotkniecie: nie-obiekt i NULL = NULL');
  v := public._event_ads_touch(jsonb_build_object(
    'ts', floor(extract(epoch FROM now() + interval '1 day') * 1000), 'utm_source', 'x'), false, now());
  PERFORM pg_temp.assert((v->>'touch_at')::timestamptz = now(),
    '28/dotkniecie: czas z przyszlosci przyciety do teraz');
  PERFORM pg_temp.assert(public._event_ads_clean('   ', 10) IS NULL
      AND public._event_ads_clean(NULL, 10) IS NULL
      AND public._event_ads_clean(E'a\tb   c', 10) = 'ab c',
    '28/czyszczenie: puste, NULL, sterujace i biale znaki');
END $$;

-- ---------------------------------------------------------------------------
-- (b) ZAPIS KROKOW LEJKA (service_role; harness laczy sie jako superuzytkownik)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid := '11111111-1111-1111-1111-111111111111';
  v_ms numeric := floor(extract(epoch FROM now() - interval '2 hours') * 1000);
  v_touch_c1 jsonb;
  v_ok boolean;
  v_row public.event_funnel_events%ROWTYPE;
BEGIN
  v_touch_c1 := jsonb_build_object('ts', v_ms, 'utm_source', 'google', 'utm_medium', 'cpc',
    'utm_campaign', 'Wiosna', 'click_id_type', 'gclid', 'click_id', 'CjwKCAjw-kampania-jeden');

  v_ok := public.event_funnel_track(v_a, jsonb_build_object('step', 'visit', 'slug', 'lejek-28',
    'visitor', 'visitor-0001', 'session', 'session-0001', 'touch', v_touch_c1, 'ad_consent', true,
    'lang', 'pl', 'country', 'PL'));
  PERFORM pg_temp.assert(v_ok, '28/krok: wizyta z kampania zapisana');
  SELECT f.* INTO v_row FROM public.event_funnel_events f
   WHERE f.tenant_id = v_a AND f.session_key = 'session-0001' AND f.step = 'visit';
  PERFORM pg_temp.assert(v_row.event_id = '28e00000-0000-0000-0000-0000000000e1'
    AND v_row.source = 'google' AND v_row.medium = 'cpc' AND v_row.utm_campaign = 'Wiosna'
    AND v_row.click_id = 'CjwKCAjw-kampania-jeden' AND v_row.ad_user_data
    AND v_row.lang = 'pl' AND v_row.country = 'PL' AND v_row.visitor_key = 'visitor-0001',
    '28/krok: wiersz niesie wydarzenie NAJEMCY A (slug wspolny z B), kanal i klikniecie ze zgoda');

  PERFORM pg_temp.assert(NOT public.event_funnel_track(v_a, jsonb_build_object('step', 'visit',
      'slug', 'lejek-28', 'visitor', 'visitor-0001', 'session', 'session-0001', 'touch', v_touch_c1,
      'ad_consent', true)),
    '28/krok: ta sama sesja i krok = pominiete (raz na sesje)');
  PERFORM pg_temp.assert(public.event_funnel_track(v_a, jsonb_build_object('step', 'registration_start',
      'event_id', '28e00000-0000-0000-0000-0000000000e1', 'visitor', 'visitor-0001',
      'session', 'session-0001', 'touch', v_touch_c1, 'ad_consent', true)),
    '28/krok: rozpoczecie zapisu po identyfikatorze wydarzenia');
  PERFORM pg_temp.assert(public.event_funnel_track(v_a, jsonb_build_object('step', 'checkout_start',
      'slug', 'lejek-28', 'visitor', 'visitor-0001', 'session', 'session-0001', 'touch', v_touch_c1,
      'ad_consent', true, 'lang', 'xx', 'country', 'pl')),
    '28/krok: rozpoczecie platnosci');
  SELECT f.* INTO v_row FROM public.event_funnel_events f
   WHERE f.tenant_id = v_a AND f.session_key = 'session-0001' AND f.step = 'checkout_start';
  PERFORM pg_temp.assert(v_row.lang IS NULL AND v_row.country IS NULL,
    '28/krok: nieznany jezyk i kraj spoza ISO odrzucone');
  PERFORM pg_temp.assert(public.event_funnel_track(v_a, jsonb_build_object('step', 'visit',
      'slug', 'lejek-28', 'visitor', 'visitor-0001', 'session', 'session-0006', 'touch', v_touch_c1,
      'ad_consent', true)),
    '28/krok: ta sama przegladarka w nowej sesji to nowy wiersz');

  -- v2: kampania PMax po gad_campaignid, BEZ zgody reklamowej (klikniecie zdjete).
  PERFORM pg_temp.assert(public.event_funnel_track(v_a, jsonb_build_object('step', 'visit',
      'slug', 'lejek-28', 'visitor', 'visitor-0002', 'session', 'session-0002',
      'touch', jsonb_build_object('ts', v_ms, 'gad_campaign_id', '987654321', 'gad_source', '1',
        'click_id_type', 'gbraid', 'click_id', 'GBRAID-bez-zgody-123'),
      'ad_consent', false)),
    '28/krok: wizyta z PMax bez zgody reklamowej');
  SELECT f.* INTO v_row FROM public.event_funnel_events f
   WHERE f.tenant_id = v_a AND f.session_key = 'session-0002';
  PERFORM pg_temp.assert(v_row.click_id IS NULL AND v_row.click_id_type IS NULL
    AND NOT v_row.ad_user_data AND v_row.source = 'google' AND v_row.medium = 'cpc',
    '28/krok: bez zgody reklamowej ZADNEGO identyfikatora klikniecia w bazie');

  -- v3: bezposrednio (bez dotkniecia), pusty visitor = klucz sesji.
  PERFORM pg_temp.assert(public.event_funnel_track(v_a, jsonb_build_object('step', 'visit',
      'slug', 'lejek-28', 'visitor', '', 'session', 'session-0003')),
    '28/krok: wejscie bezposrednie');
  SELECT f.* INTO v_row FROM public.event_funnel_events f
   WHERE f.tenant_id = v_a AND f.session_key = 'session-0003';
  PERFORM pg_temp.assert(v_row.visitor_key = 'session-0003' AND v_row.source = '(direct)'
    AND v_row.medium = '(none)',
    '28/krok: pusty identyfikator przegladarki zastapiony kluczem sesji; kanal (direct)/(none)');

  -- v4: wyszukiwarka organicznie; v5: newsletter z niezmapowana kampania.
  PERFORM public.event_funnel_track(v_a, jsonb_build_object('step', 'visit', 'slug', 'lejek-28',
    'visitor', 'visitor-0004', 'session', 'session-0004',
    'touch', jsonb_build_object('ts', v_ms, 'referrer_host', 'www.google.pl')));
  PERFORM public.event_funnel_track(v_a, jsonb_build_object('step', 'visit', 'slug', 'lejek-28',
    'visitor', 'visitor-0005', 'session', 'session-0005',
    'touch', jsonb_build_object('ts', v_ms, 'utm_source', 'newsletter', 'utm_medium', 'email',
      'utm_campaign', 'lato')));

  -- Pominiete: szkic, wydarzenie obcego najemcy (po id), nieznany slug.
  PERFORM pg_temp.assert(NOT public.event_funnel_track(v_a, jsonb_build_object('step', 'visit',
      'slug', 'lejek-28-szkic', 'session', 'session-0099')),
    '28/krok: wydarzenie NIEOPUBLIKOWANE pominiete');
  PERFORM pg_temp.assert(NOT public.event_funnel_track(v_a, jsonb_build_object('step', 'visit',
      'event_id', '28e00000-0000-0000-0000-0000000000eb', 'session', 'session-0099')),
    '28/krok: wydarzenie obcego najemcy (po id) pominiete - najemca z hosta, nie z ladunku');
  PERFORM pg_temp.assert(NOT public.event_funnel_track(v_a, jsonb_build_object('step', 'visit',
      'slug', 'nie-ma-takiego', 'session', 'session-0099')),
    '28/krok: nieznany slug pominiety');
  PERFORM pg_temp.assert(public.event_funnel_track('28000000-0000-0000-0000-0000000000b0',
      jsonb_build_object('step', 'visit', 'slug', 'lejek-28', 'session', 'session-00b1')),
    '28/krok: ten sam slug w najemcy B trafia w wydarzenie B');
  PERFORM pg_temp.assert((SELECT f.event_id FROM public.event_funnel_events f
      WHERE f.session_key = 'session-00b1') = '28e00000-0000-0000-0000-0000000000eb',
    '28/krok: wiersz najemcy B wskazuje wydarzenie B');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_funnel_track(NULL, '{"step":"visit"}'::jsonb)$q$,
  'invalid_payload', '28/krok/ODMOWA: brak najemcy');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_funnel_track('11111111-1111-1111-1111-111111111111', '[]'::jsonb)$q$,
  'invalid_payload', '28/krok/ODMOWA: ladunek nie jest obiektem');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_funnel_track('11111111-1111-1111-1111-111111111111',
     '{"step":"purchase","slug":"lejek-28","session":"session-0100"}'::jsonb)$q$,
  'invalid_step', '28/krok/ODMOWA: krok spoza listy');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_funnel_track('11111111-1111-1111-1111-111111111111',
     '{"step":"visit","slug":"lejek-28","session":"x"}'::jsonb)$q$,
  'invalid_session', '28/krok/ODMOWA: zly klucz sesji');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_funnel_track('11111111-1111-1111-1111-111111111111',
     '{"step":"visit","slug":"lejek-28","session":"session-0100","visitor":"zly klucz!"}'::jsonb)$q$,
  'invalid_visitor', '28/krok/ODMOWA: zly identyfikator przegladarki');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_funnel_track('11111111-1111-1111-1111-111111111111',
     '{"step":"visit","session":"session-0100","event_id":"nie-uuid"}'::jsonb)$q$,
  'invalid_event', '28/krok/ODMOWA: ani slug, ani poprawny identyfikator');

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.event_funnel_track(uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_funnel_track(uuid, jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_funnel_track(uuid, jsonb)', 'EXECUTE'),
  '28/granty: zapis kroku WYLACZNIE service_role (endpoint), nie klient');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_ads_touch(jsonb, boolean, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_ads_clean(text, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_ads_retention_prune()', 'EXECUTE'),
  '28/granty: pomocniki i retencja niedostepne dla klienta');
SET ROLE anon;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_funnel_track('11111111-1111-1111-1111-111111111111',
     '{"step":"visit","slug":"lejek-28","session":"session-0200"}'::jsonb)$q$,
  'permission denied', '28/granty: anonim nie zapisze kroku z pominieciem endpointu');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- (d) MAPOWANIE KAMPANII I KOSZTY
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('28a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

CREATE TEMP TABLE t28_ids (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON t28_ids TO PUBLIC;

DO $$
DECLARE
  v_c1 uuid;
  v_c2 uuid;
  v_tmp uuid;
  v_row public.event_ad_campaigns%ROWTYPE;
BEGIN
  v_c1 := public.admin_event_ad_campaign_save(jsonb_build_object(
    'event_id', '28e00000-0000-0000-0000-0000000000e1', 'match_kind', 'utm_campaign',
    'match_value', '  Wiosna ', 'label', ' Wiosna Search ', 'conversion_action_name', 'Bilet Kongres'));
  SELECT c.* INTO v_row FROM public.event_ad_campaigns c WHERE c.id = v_c1;
  PERFORM pg_temp.assert(v_row.match_value = 'wiosna' AND v_row.label = 'Wiosna Search'
    AND v_row.conversion_action_name = 'Bilet Kongres' AND v_row.platform = 'google_ads'
    AND v_row.tenant_id = '11111111-1111-1111-1111-111111111111'
    AND v_row.created_by = '28a00000-0000-0000-0000-0000000000a1',
    '28/kampania: nowa - utm_campaign malymi literami, etykieta przycieta, autor');

  v_c2 := public.admin_event_ad_campaign_save(jsonb_build_object(
    'event_id', '28e00000-0000-0000-0000-0000000000e1', 'match_kind', 'google_ads_campaign_id',
    'match_value', ' 987654321 ', 'label', 'PMax 28'));
  INSERT INTO t28_ids VALUES ('c1', v_c1), ('c2', v_c2);

  -- Zmiana: tylko etykieta - nazwa konwersji zostaje (klucz pominiety).
  PERFORM public.admin_event_ad_campaign_save(jsonb_build_object('id', v_c1, 'label', 'Wiosna Search PL'));
  SELECT c.* INTO v_row FROM public.event_ad_campaigns c WHERE c.id = v_c1;
  PERFORM pg_temp.assert(v_row.label = 'Wiosna Search PL' AND v_row.conversion_action_name = 'Bilet Kongres'
    AND v_row.match_value = 'wiosna',
    '28/kampania: zmiana z obecnoscia klucza - pominiete pola zostaja');
  PERFORM public.admin_event_ad_campaign_save(jsonb_build_object('id', v_c2, 'conversion_action_name', 'Zakup PMax'));
  PERFORM public.admin_event_ad_campaign_save(jsonb_build_object('id', v_c2, 'conversion_action_name', NULL));
  PERFORM pg_temp.assert((SELECT c.conversion_action_name FROM public.event_ad_campaigns c WHERE c.id = v_c2) IS NULL,
    '28/kampania: jawny null czysci nazwe konwersji');
  PERFORM public.admin_event_ad_campaign_save(jsonb_build_object('id', v_c1, 'label', 'Wiosna Search'));

  -- Tymczasowa kampania do usuniecia z kosztem (kaskada).
  v_tmp := public.admin_event_ad_campaign_save(jsonb_build_object(
    'event_id', '28e00000-0000-0000-0000-0000000000e1', 'match_kind', 'utm_campaign',
    'match_value', 'do-usuniecia', 'label', 'Tymczasowa'));
  PERFORM public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', v_tmp,
    'rows', jsonb_build_array(jsonb_build_object('day', to_char(now(), 'YYYY-MM-DD'),
      'cost_micros', 1000000, 'currency', 'PLN'))));
  PERFORM pg_temp.assert(public.admin_event_ad_campaign_delete(v_tmp), '28/kampania: usuniecie');
  PERFORM pg_temp.assert(NOT EXISTS (SELECT 1 FROM public.event_ad_campaign_costs k WHERE k.campaign_id = v_tmp),
    '28/kampania: usuniecie zabiera koszty (kaskada)');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('event_id',
     '28e00000-0000-0000-0000-0000000000e1', 'match_kind', 'utm_campaign', 'match_value', 'WIOSNA',
     'label', 'Duplikat'))$q$,
  'campaign_exists', '28/kampania/ODMOWA: ta sama kampania dwa razy (bez wzgledu na wielkosc liter)');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('event_id',
     '28e00000-0000-0000-0000-0000000000e1', 'match_kind', 'meta', 'match_value', 'x', 'label', 'x'))$q$,
  'invalid_match_kind', '28/kampania/ODMOWA: nieznany rodzaj dopasowania');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('event_id',
     '28e00000-0000-0000-0000-0000000000e1', 'match_kind', 'google_ads_campaign_id',
     'match_value', 'abc', 'label', 'x'))$q$,
  'invalid_match_value', '28/kampania/ODMOWA: id kampanii Google Ads nie jest liczba');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('event_id',
     '28e00000-0000-0000-0000-0000000000e1', 'match_kind', 'utm_campaign',
     'match_value', 'kontakt@example.org', 'label', 'x'))$q$,
  'invalid_match_value', '28/kampania/ODMOWA: adres e-mail nie jest kampania');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('event_id',
     '28e00000-0000-0000-0000-0000000000e1', 'match_kind', 'utm_campaign', 'match_value', 'x',
     'label', '   '))$q$,
  'invalid_label', '28/kampania/ODMOWA: pusta etykieta');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('event_id',
     '28e00000-0000-0000-0000-0000000000e1', 'match_kind', 'utm_campaign', 'match_value', 'x',
     'label', 'x', 'conversion_action_name', '=HYPERLINK("x")'))$q$,
  'invalid_conversion_name', '28/kampania/ODMOWA: nazwa konwersji zaczyna sie od formuly');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('event_id',
     '28e00000-0000-0000-0000-0000000000e1', 'match_kind', 'utm_campaign', 'match_value', 'x',
     'label', 'x', 'conversion_action_name', 'Bilet, VIP'))$q$,
  'invalid_conversion_name', '28/kampania/ODMOWA: przecinek rozbilby wiersz CSV importu');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('match_kind', 'utm_campaign'))$q$,
  'invalid_payload', '28/kampania/ODMOWA: nowa bez wydarzenia');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('id', 'nie-uuid'))$q$,
  'invalid_payload', '28/kampania/ODMOWA: identyfikator nie jest uuid');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save('[]'::jsonb)$q$,
  'invalid_payload', '28/kampania/ODMOWA: ladunek nie jest obiektem');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('event_id',
     '28e00000-0000-0000-0000-0000000000eb', 'match_kind', 'utm_campaign', 'match_value', 'x', 'label', 'x'))$q$,
  'not_found', '28/kampania/ODMOWA: wydarzenie obcego najemcy');

-- Koszty.
DO $$
DECLARE
  v_c1 uuid := (SELECT id FROM t28_ids WHERE name = 'c1');
  v_c2 uuid := (SELECT id FROM t28_ids WHERE name = 'c2');
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_n integer;
  v_list_first date;
BEGIN
  v_n := public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', v_c1, 'source', 'csv',
    'rows', jsonb_build_array(
      jsonb_build_object('day', to_char(v_today - 2, 'YYYY-MM-DD'), 'cost_micros', 100000000,
        'currency', 'PLN', 'clicks', 40, 'impressions', 1000),
      jsonb_build_object('day', to_char(v_today - 1, 'YYYY-MM-DD'), 'cost_micros', '99000000',
        'currency', 'PLN', 'clicks', NULL))));
  PERFORM pg_temp.assert(v_n = 2, '28/koszt: wsad dwoch dni');
  -- Ponowny import dnia NADPISUJE (nie dubluje).
  v_n := public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', v_c1,
    'rows', jsonb_build_array(jsonb_build_object('day', to_char(v_today - 1, 'YYYY-MM-DD'),
      'cost_micros', 50000000, 'currency', 'PLN'))));
  PERFORM pg_temp.assert(v_n = 1
    AND (SELECT sum(k.cost_micros) FROM public.event_ad_campaign_costs k WHERE k.campaign_id = v_c1) = 150000000
    AND (SELECT k.source FROM public.event_ad_campaign_costs k WHERE k.campaign_id = v_c1 AND k.day = v_today - 1) = 'manual',
    '28/koszt: ten sam dzien nadpisany, zrodlo domyslnie manual');
  PERFORM public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', v_c2,
    'rows', jsonb_build_array(
      jsonb_build_object('day', to_char(v_today - 1, 'YYYY-MM-DD'), 'cost_micros', 30000000, 'currency', 'PLN'),
      jsonb_build_object('day', to_char(v_today - 5, 'YYYY-MM-DD'), 'cost_micros', 7000000, 'currency', 'PLN'))));
  PERFORM pg_temp.assert(public.admin_event_ad_cost_delete(v_c2, v_today - 5),
    '28/koszt: usuniecie jednego dnia');

  SELECT l.day INTO v_list_first FROM public.admin_event_ad_costs_list(v_c1) l LIMIT 1;
  PERFORM pg_temp.assert(v_list_first = v_today - 1
    AND (SELECT count(*) FROM public.admin_event_ad_costs_list(v_c1)) = 2,
    '28/koszt: lista od najnowszego dnia');
  PERFORM pg_temp.assert((SELECT l.costs FROM public.admin_event_ad_campaigns_list(
      '28e00000-0000-0000-0000-0000000000e1') l WHERE l.id = v_c1)
      = '[{"currency":"PLN","cost_micros":150000000,"days":2}]'::jsonb,
    '28/kampanie: lista z suma kosztow per waluta');
  PERFORM pg_temp.assert((SELECT array_agg(l.label ORDER BY 1) FROM public.admin_event_ad_campaigns_list(
      '28e00000-0000-0000-0000-0000000000e1') l) = ARRAY['PMax 28', 'Wiosna Search'],
    '28/kampanie: lista kampanii wydarzenia');
END $$;

SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', %L, 'rows',
     jsonb_build_array(jsonb_build_object('day', '2026-09-01', 'cost_micros', 1, 'currency', 'PLN'),
                       jsonb_build_object('day', '2026-09-01', 'cost_micros', 2, 'currency', 'PLN'))))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'duplicate_cost_day', '28/koszt/ODMOWA: dzien powtorzony we wsadzie');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', %L, 'rows',
     jsonb_build_array(jsonb_build_object('day', '2026-09-01', 'cost_micros', 1, 'currency', 'pln'))))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'invalid_cost_row: row 1', '28/koszt/ODMOWA: waluta malymi literami (z numerem wiersza)');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', %L, 'rows',
     jsonb_build_array(jsonb_build_object('day', '2026-09-01', 'cost_micros', 1, 'currency', 'PLN'),
                       jsonb_build_object('day', '2026-02-30', 'cost_micros', 1, 'currency', 'PLN'))))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'invalid_cost_row: row 2', '28/koszt/ODMOWA: dzien, ktorego nie ma w kalendarzu');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', %L, 'rows',
     jsonb_build_array(jsonb_build_object('day', '2026-09-01', 'cost_micros', -5, 'currency', 'PLN'))))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'invalid_cost_row', '28/koszt/ODMOWA: koszt ujemny');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', %L, 'rows',
     jsonb_build_array(jsonb_build_object('day', '1999-12-31', 'cost_micros', 5, 'currency', 'PLN'))))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'invalid_cost_row', '28/koszt/ODMOWA: dzien sprzed 2000 roku');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', %L, 'rows',
     jsonb_build_array(jsonb_build_object('day', '2026-09-01', 'cost_micros', 5, 'currency', 'PLN',
       'clicks', -1))))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'invalid_cost_row', '28/koszt/ODMOWA: ujemna liczba klikniec');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', %L, 'rows', '[]'::jsonb))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'invalid_rows', '28/koszt/ODMOWA: pusty wsad');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', %L, 'source', 'api',
     'rows', jsonb_build_array(jsonb_build_object('day', '2026-09-01', 'cost_micros', 5, 'currency', 'PLN'))))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'invalid_source', '28/koszt/ODMOWA: zrodlo spoza listy');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_costs_save('{"campaign_id":"x"}'::jsonb)$q$,
  'invalid_payload', '28/koszt/ODMOWA: brak kampanii');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_costs_save('{"campaign_id":"28000000-0000-0000-0000-00000000dead","rows":[]}'::jsonb)$q$,
  'not_found', '28/koszt/ODMOWA: nieznana kampania');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_cost_delete('28000000-0000-0000-0000-00000000dead', now()::date)$q$,
  'not_found', '28/koszt/ODMOWA: usuniecie nieistniejacego dnia');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_ad_costs_list('28000000-0000-0000-0000-00000000dead')$q$,
  'not_found', '28/koszt/ODMOWA: lista nieznanej kampanii');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ad_campaign_delete('28000000-0000-0000-0000-00000000dead')$q$,
  'not_found', '28/kampania/ODMOWA: usuniecie nieznanej kampanii');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_ad_campaigns_list('28e00000-0000-0000-0000-0000000000eb')$q$,
  'not_found', '28/kampanie/ODMOWA: lista dla wydarzenia obcego najemcy');

-- Izolacja: administrator B nie widzi ani nie zmieni kampanii A.
SELECT pg_temp.act_as('28a00000-0000-0000-0000-0000000000b1', '28000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_campaign_save(jsonb_build_object('id', %L, 'label', 'Przejete'))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'not_found', '28/izolacja: admin B nie zmieni kampanii A');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_campaign_delete(%L)$q$, (SELECT id FROM t28_ids WHERE name = 'c1')),
  'not_found', '28/izolacja: admin B nie usunie kampanii A');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', %L, 'rows',
     jsonb_build_array(jsonb_build_object('day', '2026-09-01', 'cost_micros', 5, 'currency', 'PLN'))))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'not_found', '28/izolacja: admin B nie dopisze kosztu do kampanii A');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ads_funnel('28e00000-0000-0000-0000-0000000000e1')$q$,
  'not_found', '28/izolacja: admin B nie czyta lejka wydarzenia A');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ads_conversions_export('28e00000-0000-0000-0000-0000000000e1')$q$,
  'not_found', '28/izolacja: admin B nie wyeksportuje konwersji wydarzenia A');
SELECT pg_temp.assert((SELECT count(*) FROM public.admin_event_ad_campaigns_list(
    '28e00000-0000-0000-0000-0000000000eb')) = 0,
  '28/izolacja: admin B widzi pusta liste swojego wydarzenia');

-- Role: redaktor, zwykly uzytkownik i anonim nie przechodza bramki panelu.
SELECT pg_temp.act_as('28a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ads_funnel('28e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '28/role: redaktor nie czyta lejka');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_ad_campaigns_list('28e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '28/role: redaktor nie czyta kampanii');
SELECT pg_temp.act_as('28a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', %L, 'rows',
     jsonb_build_array(jsonb_build_object('day', '2026-09-01', 'cost_micros', 5, 'currency', 'PLN'))))$q$,
  (SELECT id FROM t28_ids WHERE name = 'c1')),
  'forbidden', '28/role: zwykly uzytkownik nie zapisze kosztu');
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ads_conversions_export('28e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '28/role: anonim nie wyeksportuje konwersji');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_ads_funnel(uuid, timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_ad_campaign_save(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_ad_costs_save(jsonb)', 'EXECUTE'),
  '28/granty: funkcje panelu bez grantu dla anon, z grantem dla zalogowanych (bramka w ciele)');

-- ---------------------------------------------------------------------------
-- (c) PRZYPIECIE ATRYBUCJI (plaszczyzna publiczna, najemca z hosta)
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);

DO $$
DECLARE
  v_touch_ms numeric := floor(extract(epoch FROM now() - interval '2 hours') * 1000);
  v_first_ms numeric := floor(extract(epoch FROM now() - interval '10 days') * 1000);
  v_res jsonb;
  v_a public.event_registration_attributions%ROWTYPE;
  v_lead public.crm_leads%ROWTYPE;
  v_audit public.audit_log%ROWTYPE;
BEGIN
  -- r1: pierwsza wizyta organicznie, ostatnia z kampanii Wiosna z gclid, zgoda reklamowa.
  v_res := public.event_registration_attribution_attach(jsonb_build_object(
    'manage_token', 'token-28-jeden-aaaaaaaaaaaaaaaaaa',
    'first', jsonb_build_object('ts', v_first_ms, 'referrer_host', 'google.com'),
    'last', jsonb_build_object('ts', v_touch_ms, 'utm_source', 'google', 'utm_medium', 'cpc',
      'utm_campaign', 'Wiosna', 'click_id_type', 'gclid', 'click_id', 'CjwKCAjw-kampania-jeden'),
    'ad_consent', true));
  PERFORM pg_temp.assert(v_res = '{"ok":true,"attached":true,"source":"google","medium":"cpc","click":true}'::jsonb,
    '28/przypiecie: wynik niesie kanal i fakt klikniecia (nie sam identyfikator)');
  SELECT a.* INTO v_a FROM public.event_registration_attributions a
   WHERE a.registration_id = '28c00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_a.tenant_id = '11111111-1111-1111-1111-111111111111'
    AND v_a.event_id = '28e00000-0000-0000-0000-0000000000e1'
    AND v_a.utm_campaign = 'Wiosna' AND v_a.click_id = 'CjwKCAjw-kampania-jeden'
    AND v_a.click_id_type = 'gclid' AND v_a.click_at = to_timestamp(v_touch_ms / 1000.0)
    AND v_a.ad_user_data AND v_a.ad_personalization
    AND v_a.first_touch->>'medium' = 'organic' AND v_a.last_touch->>'utm_campaign' = 'Wiosna',
    '28/przypiecie: pierwsze i ostatnie dotkniecie, klikniecie ze zgoda i czasem klikniecia');

  -- CRM: segment, tagi, pola kampanii i os czasu - bez identyfikatora klikniecia.
  SELECT l.* INTO v_lead FROM public.crm_leads l
   WHERE l.tenant_id = '11111111-1111-1111-1111-111111111111' AND l.email_norm = 'kampania.jeden@example.org';
  PERFORM pg_temp.assert(v_lead.id IS NOT NULL AND v_lead.source_type = 'event_participant'
    AND v_lead.tags @> ARRAY['event:lejek-28', 'utm_campaign:wiosna']
    AND v_lead.aliases #>> '{custom,utm_campaign,0}' = 'Wiosna'
    AND v_lead.aliases #>> '{custom,utm_source,0}' = 'google'
    AND v_lead.aliases->'sources' ? 'event:lejek-28:registration',
    '28/CRM: kontakt z segmentem uczestnika, tagiem kampanii i historia UTM');
  PERFORM pg_temp.assert(position('CjwKCAjw' IN v_lead.aliases::text) = 0
    AND position('gclid' IN v_lead.aliases::text) = 0
    AND NOT (v_lead.aliases->'custom' ? 'click_id'),
    '28/CRM: identyfikator klikniecia NIE trafia do CRM (widzi go redaktor)');
  PERFORM pg_temp.assert(v_lead.marketing_consent,
    '28/CRM: zgoda marketingowa z DOWODU w event_people (consent_marketing_at)');
  SELECT au.* INTO v_audit FROM public.audit_log au
   WHERE au.entity_type = 'crm_lead' AND au.entity_id = v_lead.id
     AND au.action = 'event.registration.attributed';
  PERFORM pg_temp.assert(v_audit.tenant_id = '11111111-1111-1111-1111-111111111111'
    AND v_audit.metadata->>'summary_pl' = 'Zapis na wydarzenie z kampanii Wiosna (google / cpc)'
    AND v_audit.metadata->>'summary_en' = 'Event registration from campaign Wiosna (google / cpc)'
    AND v_audit.metadata->>'event_slug' = 'lejek-28'
    AND v_audit.metadata->>'event_title_pl' = 'Kongres 28'
    AND v_audit.metadata->>'registration_id' = '28c00000-0000-0000-0000-000000000001'
    AND position('CjwKCAjw' IN v_audit.metadata::text) = 0,
    '28/CRM: wpis osi czasu z kontraktem metadanych i BEZ gclid');

  -- Zapis raz.
  v_res := public.event_registration_attribution_attach(jsonb_build_object(
    'manage_token', 'token-28-jeden-aaaaaaaaaaaaaaaaaa',
    'last', jsonb_build_object('ts', v_touch_ms, 'utm_source', 'nadpis'), 'ad_consent', true));
  PERFORM pg_temp.assert(v_res->>'reason' = 'already_attached' AND (v_res->>'attached')::boolean = false
    AND (SELECT a.utm_source FROM public.event_registration_attributions a
          WHERE a.registration_id = '28c00000-0000-0000-0000-000000000001') = 'google'
    AND (SELECT count(*) FROM public.audit_log au WHERE au.entity_id = v_lead.id
          AND au.action = 'event.registration.attributed') = 1,
    '28/przypiecie: drugie wywolanie niczego nie zmienia (ani atrybucji, ani osi czasu)');

  -- r2: PMax z gbraid, ale BEZ zgody reklamowej.
  v_res := public.event_registration_attribution_attach(jsonb_build_object(
    'manage_token', 'token-28-dwa-bbbbbbbbbbbbbbbbbbbbb',
    'last', jsonb_build_object('ts', v_touch_ms, 'gad_campaign_id', '987654321', 'gad_source', '1',
      'click_id_type', 'gbraid', 'click_id', 'GBRAID-bez-zgody-123'),
    'ad_consent', false));
  SELECT a.* INTO v_a FROM public.event_registration_attributions a
   WHERE a.registration_id = '28c00000-0000-0000-0000-000000000002';
  PERFORM pg_temp.assert(v_a.click_id IS NULL AND v_a.click_at IS NULL AND NOT v_a.ad_user_data
    AND v_a.gad_campaign_id = '987654321' AND v_a.source = 'google' AND v_a.medium = 'cpc'
    AND v_res->>'click' = 'false',
    '28/przypiecie: bez zgody reklamowej identyfikator klikniecia zdjety, kanal zostaje');
  PERFORM pg_temp.assert((SELECT l.marketing_consent FROM public.crm_leads l
      WHERE l.tenant_id = '11111111-1111-1111-1111-111111111111' AND l.email_norm = 'kampania.dwa@example.org') = false,
    '28/CRM: bez dowodu w event_people zgoda marketingowa NIE powstaje z cookies');
  PERFORM pg_temp.assert((SELECT au.metadata->>'summary_pl' FROM public.audit_log au
      JOIN public.crm_leads l ON l.id = au.entity_id
     WHERE l.email_norm = 'kampania.dwa@example.org' AND au.action = 'event.registration.attributed')
      = 'Zapis na wydarzenie z google / cpc',
    '28/CRM: zdanie osi czasu bez kampanii UTM, z kanalem');

  -- r3: wejscie bezposrednie (zgoda na pomiar, brak dotkniec).
  v_res := public.event_registration_attribution_attach(jsonb_build_object(
    'manage_token', ' token-28-trzy-ccccccccccccccccccc ', 'first', NULL, 'last', NULL));
  SELECT a.* INTO v_a FROM public.event_registration_attributions a
   WHERE a.registration_id = '28c00000-0000-0000-0000-000000000003';
  PERFORM pg_temp.assert(v_a.source = '(direct)' AND v_a.medium = '(none)'
    AND v_a.first_touch IS NULL AND v_a.last_touch IS NULL AND v_res->>'source' = '(direct)',
    '28/przypiecie: wejscie bezposrednie = wiersz bez dotkniec');
  PERFORM pg_temp.assert((SELECT au.metadata->>'summary_en' FROM public.audit_log au
      JOIN public.crm_leads l ON l.id = au.entity_id
     WHERE l.email_norm = 'bezposredni@example.org' AND au.action = 'event.registration.attributed')
      = 'Event registration without a campaign'
    AND (SELECT l.tags FROM public.crm_leads l WHERE l.email_norm = 'bezposredni@example.org')
      = ARRAY['event:lejek-28'],
    '28/CRM: zapis bez kampanii - tylko tag wydarzenia');

  -- r7: klikniecie PO platnosci (do licznika "before_click" eksportu).
  PERFORM public.event_registration_attribution_attach(jsonb_build_object(
    'manage_token', 'token-28-siedem-ggggggggggggggggg',
    'last', jsonb_build_object('ts', floor(extract(epoch FROM now() - interval '1 hour') * 1000),
      'utm_source', 'google', 'utm_medium', 'cpc', 'utm_campaign', 'wiosna',
      'click_id_type', 'gclid', 'click_id', 'CjwKCAjw-po-platnosci'),
    'ad_consent', true));

  -- Odmowy przypiecia (wynik, nie wyjatek - bez wyroczni o istnieniu klucza).
  PERFORM pg_temp.assert(public.event_registration_attribution_attach(
      '{"manage_token":"zly-klucz"}'::jsonb) = '{"ok":false,"reason":"not_found"}'::jsonb,
    '28/przypiecie/ODMOWA: nieznany klucz');
  PERFORM pg_temp.assert(public.event_registration_attribution_attach('{}'::jsonb)->>'reason' = 'not_found'
    AND public.event_registration_attribution_attach(jsonb_build_object('manage_token', repeat('x', 201)))->>'reason' = 'not_found',
    '28/przypiecie/ODMOWA: brak klucza i klucz za dlugi');
  PERFORM pg_temp.assert(public.event_registration_attribution_attach(
      '{"manage_token":"token-28-szesc-fffffffffffffffff"}'::jsonb)->>'reason' = 'too_late'
    AND NOT EXISTS (SELECT 1 FROM public.event_registration_attributions a
                     WHERE a.registration_id = '28c00000-0000-0000-0000-000000000006'),
    '28/przypiecie/ODMOWA: zgloszenie starsze niz doba');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_registration_attribution_attach('"x"'::jsonb)$q$,
  'invalid_payload', '28/przypiecie/ODMOWA: ladunek nie jest obiektem');

-- Klucz najemcy A pod hostem najemcy B nie istnieje.
SELECT set_config('nes.public_tenant', '28000000-0000-0000-0000-0000000000b0', false);
SELECT pg_temp.assert(public.event_registration_attribution_attach(
    '{"manage_token":"token-28-cztery-ddddddddddddddddd"}'::jsonb)->>'reason' = 'not_found',
  '28/przypiecie/izolacja: klucz najemcy A pod hostem B = nie znaleziono');
SELECT set_config('nes.public_tenant', '', false);

SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_registration_attribution_attach(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_registration_attribution_attach(jsonb)', 'EXECUTE'),
  '28/granty: przypiecie dostepne dla goscia bez konta (jak event_register)');

-- ---------------------------------------------------------------------------
-- (e) RAPORT LEJKA
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('28a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

DO $$
DECLARE
  v jsonb := public.admin_event_ads_funnel('28e00000-0000-0000-0000-0000000000e1');
  v_c1 uuid := (SELECT id FROM t28_ids WHERE name = 'c1');
  v_c2 uuid := (SELECT id FROM t28_ids WHERE name = 'c2');
  g jsonb;
BEGIN
  PERFORM pg_temp.assert(jsonb_array_length(v->'groups') = 4
    AND (SELECT array_agg(x->>'key' ORDER BY o) FROM jsonb_array_elements(v->'groups') WITH ORDINALITY AS t(x, o))
      = ARRAY['campaign:' || v_c2, 'campaign:' || v_c1, 'utm:lato', 'none'],
    '28/lejek: kolejnosc grup - zmapowane (po etykiecie), UTM, brak kampanii');

  g := v->'groups'->1;
  PERFORM pg_temp.assert(g->>'kind' = 'campaign' AND g->>'label' = 'Wiosna Search'
    AND (g->>'visits')::int = 1 AND (g->>'registration_starts')::int = 1
    AND (g->>'checkout_starts')::int = 1 AND (g->>'registrations')::int = 2
    AND (g->>'paid')::int = 2
    AND g->'revenue' = '[{"currency":"PLN","cents":59900}]'::jsonb
    AND g->'cost' = '[{"currency":"PLN","micros":150000000}]'::jsonb,
    '28/lejek: kampania Wiosna - wizyty unikalne, zapisy, oplacone, przychod bez goscia grupy, koszt');
  PERFORM pg_temp.assert(jsonb_array_length(g->'channels') = 1
    AND g->'channels'->0->>'source' = 'google' AND g->'channels'->0->>'medium' = 'cpc'
    AND g->'channels'->0->'revenue' = '[{"currency":"PLN","cents":59900}]'::jsonb,
    '28/lejek: kanal google/cpc w kampanii Wiosna');

  g := v->'groups'->0;
  PERFORM pg_temp.assert(g->>'label' = 'PMax 28' AND g->>'match_kind' = 'google_ads_campaign_id'
    AND (g->>'visits')::int = 1 AND (g->>'registrations')::int = 1 AND (g->>'paid')::int = 1
    AND g->'revenue' = '[{"currency":"PLN","cents":20000}]'::jsonb
    AND g->'cost' = '[{"currency":"PLN","micros":30000000}]'::jsonb,
    '28/lejek: PMax po gad_campaignid - przychod NETTO (kwota minus zwrot)');

  g := v->'groups'->2;
  PERFORM pg_temp.assert(g->>'kind' = 'utm_campaign' AND g->>'utm_campaign' = 'lato'
    AND (g->>'visits')::int = 1 AND (g->>'registrations')::int = 0
    AND g->'cost' = '[]'::jsonb AND g->'channels'->0->>'medium' = 'email',
    '28/lejek: niezmapowana kampania UTM jako wlasna grupa bez kosztu');

  g := v->'groups'->3;
  PERFORM pg_temp.assert(g->>'kind' = 'none' AND (g->>'visits')::int = 2
    AND (g->>'registrations')::int = 1 AND jsonb_array_length(g->'channels') = 2,
    '28/lejek: brak kampanii - bezposrednie i organiczne w jednej grupie, osobne kanaly');

  PERFORM pg_temp.assert(v->'unattributed' = '{"registrations":2,"paid":1,"revenue":[{"currency":"PLN","cents":20000}]}'::jsonb,
    '28/lejek: zgloszenia bez atrybucji osobno (brak zgody / za pozno), nie w mianowniku wizyt');
  PERFORM pg_temp.assert((v->'totals'->>'visits')::int = 5
    AND (v->'totals'->>'registration_starts')::int = 1
    AND (v->'totals'->>'checkout_starts')::int = 1
    AND (v->'totals'->>'attributed_registrations')::int = 4
    AND (v->'totals'->>'registrations')::int = 6
    AND (v->'totals'->>'paid')::int = 4
    AND v->'totals'->'revenue' = '[{"currency":"PLN","cents":99900}]'::jsonb
    AND v->'totals'->'cost' = '[{"currency":"PLN","micros":180000000}]'::jsonb,
    '28/lejek: sumy - unikalne przegladarki, wszystkie zgloszenia, przychod per zamowienie');
  PERFORM pg_temp.assert(v->'window'->>'timezone' = 'Europe/Warsaw' AND v->'window'->'from' = 'null'::jsonb,
    '28/lejek: echo okna i strefy');

  -- Okno ostatniej doby: stary zapis i koszt sprzed dwoch dni wypadaja.
  v := public.admin_event_ads_funnel('28e00000-0000-0000-0000-0000000000e1',
    now() - interval '1 day', now() + interval '1 hour');
  PERFORM pg_temp.assert((v->'unattributed'->>'registrations')::int = 1
    AND (SELECT x->'cost' FROM jsonb_array_elements(v->'groups') x WHERE x->>'key' = 'campaign:' || v_c1)
      = '[{"currency":"PLN","micros":50000000}]'::jsonb,
    '28/lejek: okno czasowe tnie zgloszenia (kohorta) i koszty (dzien w strefie wydarzenia)');
  -- Okno bez aktywnosci: kampania z samym kosztem nadal widoczna.
  v := public.admin_event_ads_funnel('28e00000-0000-0000-0000-0000000000e1',
    now() - interval '2 days 1 hour', now() - interval '1 day 12 hours');
  PERFORM pg_temp.assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'groups') x
      WHERE x->>'key' = 'campaign:' || v_c1 AND (x->>'visits')::int = 0),
    '28/lejek: kampania z kosztem i bez ruchu nie znika z raportu');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ads_funnel('28e00000-0000-0000-0000-0000000000e1', now(), now() - interval '1 day')$q$,
  'invalid_window', '28/lejek/ODMOWA: poczatek po koncu');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ads_funnel('28e00000-0000-0000-0000-00000000dead')$q$,
  'not_found', '28/lejek/ODMOWA: nieznane wydarzenie');

-- ---------------------------------------------------------------------------
-- (f) EKSPORT KONWERSJI OFFLINE
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb := public.admin_event_ads_conversions_export('28e00000-0000-0000-0000-0000000000e1');
  r jsonb;
BEGIN
  PERFORM pg_temp.assert(v->>'timezone' = 'Europe/Warsaw' AND jsonb_array_length(v->'rows') = 1,
    '28/eksport: jeden wiersz - tylko oplacone z kliknieciem przy zgodzie');
  r := v->'rows'->0;
  PERFORM pg_temp.assert(r->>'click_id' = 'CjwKCAjw-kampania-jeden' AND r->>'click_id_type' = 'gclid'
    AND r->>'conversion_action_name' = 'Bilet Kongres'
    AND (r->>'value_cents')::int = 49900 AND r->>'currency' = 'PLN'
    AND r->>'conversion_time_local' = to_char((now() - interval '1 hour') AT TIME ZONE 'Europe/Warsaw', 'YYYY-MM-DD HH24:MI:SS')
    AND (r->>'ad_user_data')::boolean AND r->>'order_id' = '28b00000-0000-0000-0000-000000000001',
    '28/eksport: identyfikator, nazwa konwersji z kampanii, wartosc netto, czas w strefie wydarzenia');
  PERFORM pg_temp.assert(v->'skipped' = '{"unattributed":1,"no_click":1,"expired":0,"before_click":1,"consent_withdrawn":0,"awaiting_admission":0}'::jsonb,
    '28/eksport: liczniki pominietych (bez atrybucji, bez klikniecia, platnosc przed kliknieciem)');
  v := public.admin_event_ads_conversions_export('28e00000-0000-0000-0000-0000000000e1',
    now() - interval '30 minutes', now());
  PERFORM pg_temp.assert(jsonb_array_length(v->'rows') = 0,
    '28/eksport: okno po czasie platnosci');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_ads_conversions_export('28e00000-0000-0000-0000-0000000000e1', now(), now())$q$,
  'invalid_window', '28/eksport/ODMOWA: puste okno');

-- ---------------------------------------------------------------------------
-- (g) RLS CZTERECH TABEL
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('28a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_ad_campaigns WHERE event_id = '28e00000-0000-0000-0000-0000000000e1') = 2
  AND (SELECT count(*) FROM public.event_ad_campaign_costs WHERE event_id = '28e00000-0000-0000-0000-0000000000e1') = 3
  AND (SELECT count(*) FROM public.event_registration_attributions WHERE event_id = '28e00000-0000-0000-0000-0000000000e1') = 4
  AND (SELECT count(*) FROM public.event_funnel_events WHERE event_id = '28e00000-0000-0000-0000-0000000000e1') = 8
  AND (SELECT count(*) FROM public.event_funnel_events WHERE event_id = '28e00000-0000-0000-0000-0000000000eb') = 0,
  '28/RLS: admin A czyta wiersze swojego najemcy i tylko je');
RESET ROLE;

SELECT pg_temp.act_as('28a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_ad_campaigns) = 0
  AND (SELECT count(*) FROM public.event_registration_attributions) = 0
  AND (SELECT count(*) FROM public.event_funnel_events) = 0
  AND (SELECT count(*) FROM public.event_ad_campaign_costs) = 0,
  '28/RLS: redaktor nie czyta nic (modul Wydarzen jest tylko dla admina)');
RESET ROLE;

SELECT pg_temp.act_as('28a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) FROM public.event_registration_attributions) = 0,
  '28/RLS: zwykly uzytkownik nie czyta atrybucji');
RESET ROLE;

SELECT pg_temp.act_as('28a00000-0000-0000-0000-0000000000b1', '28000000-0000-0000-0000-0000000000b0');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_funnel_events) = 1
  AND (SELECT count(*) FROM public.event_funnel_events
        WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0
  AND (SELECT count(*) FROM public.event_ad_campaigns) = 0,
  '28/RLS: admin B czyta wylacznie swoj krok lejka');
RESET ROLE;

SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
SELECT pg_temp.assert_raises_like($q$SELECT count(*) FROM public.event_funnel_events$q$,
  'permission denied', '28/RLS: anonim nie ma grantu do krokow lejka');
SELECT pg_temp.assert_raises_like($q$SELECT count(*) FROM public.event_registration_attributions$q$,
  'permission denied', '28/RLS: anonim nie ma grantu do atrybucji');
RESET ROLE;

SELECT pg_temp.act_as('28a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_funnel_events (tenant_id, event_id, step, visitor_key, session_key)
     VALUES ('11111111-1111-1111-1111-111111111111', '28e00000-0000-0000-0000-0000000000e1',
             'visit', 'visitor-9999', 'session-9999')$q$,
  'permission denied', '28/RLS: nawet admin nie pisze do tabeli z klienta (tylko RPC)');
RESET ROLE;

-- Ograniczenia wiersza: klikniecie bez zgody nie przejdzie nawet zapisem bezposrednim.
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_funnel_events (tenant_id, event_id, step, visitor_key, session_key,
       click_id_type, click_id, ad_user_data)
     VALUES ('11111111-1111-1111-1111-111111111111', '28e00000-0000-0000-0000-0000000000e1',
             'visit', 'visitor-9998', 'session-9998', 'gclid', 'CjwKCAjw-bez-zgody', false)$q$,
  'event_funnel_events_click_consent', '28/CHECK: identyfikator klikniecia wymaga flagi zgody');

-- ---------------------------------------------------------------------------
-- (h) RETENCJA
-- ---------------------------------------------------------------------------
INSERT INTO public.event_funnel_events
  (tenant_id, event_id, step, visitor_key, session_key, occurred_at, click_id_type, click_id, ad_user_data)
VALUES
  ('11111111-1111-1111-1111-111111111111', '28e00000-0000-0000-0000-0000000000e1', 'visit',
   'visitor-stary', 'session-stary-1', now() - interval '121 days', 'gclid', 'CjwKCAjw-stary-121', true),
  ('11111111-1111-1111-1111-111111111111', '28e00000-0000-0000-0000-0000000000e1', 'visit',
   'visitor-stary', 'session-stary-2', now() - interval '401 days', NULL, NULL, false);
UPDATE public.event_registration_attributions
   SET created_at = now() - interval '121 days'
 WHERE registration_id = '28c00000-0000-0000-0000-000000000001';

DO $$
DECLARE
  v jsonb;
  v_a public.event_registration_attributions%ROWTYPE;
BEGIN
  v := public.event_ads_retention_prune();
  PERFORM pg_temp.assert(v = '{"attribution_clicks_cleared":1,"package_attribution_clicks_cleared":0,"funnel_clicks_cleared":1,"funnel_steps_deleted":1}'::jsonb,
    '28/retencja: jedno klikniecie atrybucji, jedno kroku, jeden stary krok');
  SELECT a.* INTO v_a FROM public.event_registration_attributions a
   WHERE a.registration_id = '28c00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_a.click_id IS NULL AND v_a.click_id_type IS NULL AND v_a.click_at IS NULL
    AND v_a.click_pruned_at = now() AND NOT (v_a.last_touch ? 'click_id')
    AND v_a.last_touch->>'utm_campaign' = 'Wiosna',
    '28/retencja: atrybucja traci klikniecie, kanal i kampania zostaja');
  PERFORM pg_temp.assert((SELECT f.click_id FROM public.event_funnel_events f
      WHERE f.session_key = 'session-stary-1') IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.event_funnel_events f WHERE f.session_key = 'session-stary-2')
    AND (SELECT f.click_id FROM public.event_funnel_events f
          WHERE f.session_key = 'session-0001' AND f.step = 'visit') = 'CjwKCAjw-kampania-jeden',
    '28/retencja: swieze klikniecia nietkniete');
  v := public.admin_event_ads_conversions_export('28e00000-0000-0000-0000-0000000000e1');
  PERFORM pg_temp.assert(jsonb_array_length(v->'rows') = 0 AND (v->'skipped'->>'expired')::int = 1,
    '28/retencja: przyciete klikniecie nie wraca do eksportu - liczy sie jako wygasle');
  v := public.event_ads_retention_prune();
  PERFORM pg_temp.assert(v = '{"attribution_clicks_cleared":0,"package_attribution_clicks_cleared":0,"funnel_clicks_cleared":0,"funnel_steps_deleted":0}'::jsonb,
    '28/retencja: drugie przejscie niczego nie zmienia (idempotencja)');
END $$;

ROLLBACK;
