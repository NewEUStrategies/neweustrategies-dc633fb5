-- ============================================================================
-- 78_manage_token_hygiene - KLUCZ SAMOOBSLUGI: JEDNA REGULA WSZEDZIE
-- (REG-17, migracja 20261012160000)
--
-- PO CO TEN PLIK ISTNIEJE
-- Klucz `manage_token` przyjmuje siedem funkcji: podglad, rezygnacja (B4),
-- kanaly (B5), dane do maila (A1 + obwodka), przypiecie atrybucji, miejsce na
-- sali i aktor zgloszenia. pgTAP (supabase/tests/event_manage_token_hygiene_
-- test.sql) przypina kazda z osobna na pelnym schemacie; ten plik przeprowadza
-- JEDEN prawdziwy klucz - z zapisu `event_register_for_client`, tak jak
-- dostaje go gosc w mailu - przez caly jego zywot na replayu modulu:
--
--   1. klucz wazny: podglad, kanaly, dane do maila (bez nazwiska), atrybucja,
--      aktor-posiadacz;
--   2. po rezygnacji tym kluczem: podglad pokazuje 'cancelled', kazda akcja
--      i dane kontaktowe - odmowa (already_closed / not_found);
--   3. KRYTERIUM AUDYTU „odmowa klucza po ends_at": drugi klucz, wydarzenie
--      przesuniete w przeszlosc - podglad `expired`, rezygnacja, kanaly i dane
--      do maila `manage_expired`, atrybucja `expired`, miejsce pusta lista,
--      aktor bez posiadania;
--   4. granica bez ends_at (starts_at + 24 h) i przywrocenie waznosci po
--      przelozeniu wydarzenia na pozniej;
--   5. sciezka konta (registration_id) bez zmian po wygasnieciu klucza: podglad
--      wlasciciela dziala dalej.
--
-- CZEGO NIE SPRAWDZA: ACL (pgTAP - harness dziala jako superuzytkownik),
-- kwot (pgTAP i 21_/25_).
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================
\echo '== 78 klucz samoobslugi: wygasniecie, zamkniecie, jedna regula =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', 'Tenant B7 (klucz samoobslugi)', 'tb7-mth');

INSERT INTO auth.users (id, email) VALUES
  ('b7000000-0000-0000-0000-000000000001', 'wlasciciel.mth@example.org');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
  registration_mode, registration_flow) VALUES
  ('b7100000-0000-0000-0000-000000000001', 'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', 'mth-glowne',
   'Klucz', 'Key', now() + interval '30 days', now() + interval '30 days 8 hours', 'published', 'form', 'instant');

-- Klucze jawne zostaja w tabeli tymczasowej - jak u goscia w skrzynce.
CREATE TEMP TABLE mth (k text PRIMARY KEY, token text NOT NULL, reg uuid NOT NULL);

CREATE FUNCTION pg_temp.mth_register(_k text, _email text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  v := public.event_register_for_client(
    'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', NULL, 'ip:' || repeat('b7', 16), 'harness/78',
    jsonb_build_object('event_slug', 'mth-glowne', 'first_name', 'Gosc', 'last_name', 'Kluczowy',
                       'email', _email, 'consent_data_processing', true));
  IF v->'delivery'->>'manage_token' IS NULL THEN
    RAISE EXCEPTION 'harness 78: zapis nie oddal klucza: %', v;
  END IF;
  INSERT INTO mth VALUES (_k, v->'delivery'->>'manage_token', (v->'delivery'->>'registration_id')::uuid);
END $$;

CREATE FUNCTION pg_temp.mth_tok(_k text) RETURNS jsonb
LANGUAGE sql AS $$ SELECT jsonb_build_object('manage_token', token) FROM mth WHERE k = _k $$;

SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', 'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', false);

SELECT pg_temp.mth_register('a', 'gosc.a.mth@example.org');
SELECT pg_temp.mth_register('b', 'gosc.b.mth@example.org');
SELECT pg_temp.assert((SELECT token ~ '^[A-Za-z0-9_-]{32}$' FROM mth WHERE k = 'a'),
  '78/zapis: klucz z prawdziwego zapisu ma ksztalt _event_new_qr_token (32 znaki base64url)');

-- ---------------------------------------------------------------------------
-- 1. Klucz wazny
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public.event_registration_manage_view(pg_temp.mth_tok('a'))->>'registration_id' = (SELECT reg::text FROM mth WHERE k = 'a'),
  '78/wazny: podglad wskazuje zgloszenie klucza');
SELECT pg_temp.assert(
  public.event_registration_set_channels(pg_temp.mth_tok('a') || '{"remind_email": false}'::jsonb)
    @> '{"remind_email": false}'::jsonb,
  '78/wazny: kanaly zmienione kluczem');
SELECT pg_temp.assert(
  (SELECT v->>'email' = 'gosc.a.mth@example.org' AND v->>'first_name' = 'Gosc' AND NOT v ? 'last_name'
     FROM (SELECT public.event_registration_notify_payload_for_tenant(
             'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', pg_temp.mth_tok('a')) AS v) x),
  '78/wazny: dane do maila - adres i imie, bez nazwiska');
SELECT pg_temp.assert(
  public.event_registration_notify_payload(pg_temp.mth_tok('a'))->>'email' = 'gosc.a.mth@example.org',
  '78/wazny: stara nazwa (obwodka) daje ten sam ksztalt po najemcy z hosta');
SELECT pg_temp.assert(
  (public.event_registration_attribution_attach(pg_temp.mth_tok('a'))->>'attached')::boolean,
  '78/wazny: atrybucja przypieta w dobie od zapisu');
SELECT pg_temp.assert(
  (public._event_registration_actor('b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', NULL, NULL,
     (SELECT token FROM mth WHERE k = 'a'))->>'is_holder')::boolean,
  '78/wazny: aktor - klucz czyni posiadaczem');

-- ---------------------------------------------------------------------------
-- 2. Po rezygnacji tym samym kluczem
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public.event_registration_cancel(pg_temp.mth_tok('a'))->>'status' = 'cancelled',
  '78/anulowanie: rezygnacja kluczem');
SELECT pg_temp.assert(
  public.event_registration_manage_view(pg_temp.mth_tok('a'))->>'status' = 'cancelled',
  '78/anulowanie: podglad statusu nadal dziala (link z maila mowi „anulowane")');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_notify_payload_for_tenant(%L, %L::jsonb)',
         'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', pg_temp.mth_tok('a')),
  'not_found', '78/anulowanie: klucz nie oddaje juz adresu ani imienia');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_set_channels(%L::jsonb)', pg_temp.mth_tok('a') || '{"remind_email": true}'::jsonb),
  'already_closed', '78/anulowanie: kanaly kluczem - odmowa');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_cancel(%L::jsonb)', pg_temp.mth_tok('a')),
  'already_closed', '78/anulowanie: druga rezygnacja - already_closed');
SELECT pg_temp.assert(
  public._event_registration_actor('b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', NULL, NULL,
    (SELECT token FROM mth WHERE k = 'a')) @> '{"is_holder": false, "token_verdict": "closed"}'::jsonb,
  '78/anulowanie: aktor - klucz zamkniety nie czyni posiadaczem');

-- ---------------------------------------------------------------------------
-- 3. Odmowa klucza po ends_at (kryterium audytu)
-- ---------------------------------------------------------------------------
UPDATE public.events SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 minute'
 WHERE id = 'b7100000-0000-0000-0000-000000000001';

SELECT pg_temp.assert(
  public.event_registration_manage_view(pg_temp.mth_tok('b')) = '{"ok": false, "reason": "expired"}'::jsonb,
  '78/po koncu: podglad - {ok:false, reason:expired}');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_cancel(%L::jsonb)', pg_temp.mth_tok('b')),
  'manage_expired', '78/po koncu: rezygnacja kluczem - manage_expired');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_set_channels(%L::jsonb)', pg_temp.mth_tok('b') || '{"remind_email": true}'::jsonb),
  'manage_expired', '78/po koncu: kanaly kluczem (wlaczenie) - manage_expired; samo wylaczenie przechodzi (przeglad R67)');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_notify_payload_for_tenant(%L, %L::jsonb)',
         'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', pg_temp.mth_tok('b')),
  'manage_expired', '78/po koncu: dane do maila - manage_expired');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_notify_payload(%L::jsonb)', pg_temp.mth_tok('b')),
  'manage_expired', '78/po koncu: obwodka danych do maila - manage_expired');
SELECT pg_temp.assert(
  public.event_registration_attribution_attach(pg_temp.mth_tok('b')) = '{"ok": false, "reason": "expired"}'::jsonb,
  '78/po koncu: atrybucja - {ok:false, reason:expired} (mimo doby od zapisu)');
SELECT pg_temp.assert(
  public.event_ticket_seats(jsonb_build_object('slug', 'mth-glowne') || pg_temp.mth_tok('b')) = '{"seats": []}'::jsonb,
  '78/po koncu: miejsce na sali kluczem - pusta lista');
SELECT pg_temp.assert(
  public._event_registration_actor('b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', NULL, NULL,
    (SELECT token FROM mth WHERE k = 'b')) @> '{"exists": true, "is_holder": false, "via_token": false, "token_verdict": "expired"}'::jsonb,
  '78/po koncu: aktor - klucz wygasly nie czyni posiadaczem');

-- ---------------------------------------------------------------------------
-- 4. Granica bez ends_at i przelozenie
-- ---------------------------------------------------------------------------
UPDATE public.events SET starts_at = now() - interval '23 hours', ends_at = NULL
 WHERE id = 'b7100000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (public.event_registration_manage_view(pg_temp.mth_tok('b'))->>'ok')::boolean,
  '78/bez konca: 23 h po starcie klucz jeszcze wazny');
UPDATE public.events SET starts_at = now() - interval '24 hours 1 second', ends_at = NULL
 WHERE id = 'b7100000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  public.event_registration_manage_view(pg_temp.mth_tok('b'))->>'reason' = 'expired',
  '78/bez konca: po starts_at + 24 h klucz wygasa');
UPDATE public.events SET starts_at = now() + interval '10 days', ends_at = NULL
 WHERE id = 'b7100000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (public.event_registration_manage_view(pg_temp.mth_tok('b'))->>'ok')::boolean
  AND (public.event_registration_set_channels(pg_temp.mth_tok('b') || '{"remind_email": false}'::jsonb) IS NOT NULL),
  '78/przelozenie: wydarzenie przesuniete na pozniej - klucz znow dziala (podglad i akcja)');

-- ---------------------------------------------------------------------------
-- 5. Sciezka konta nie zalezy od klucza
-- ---------------------------------------------------------------------------
UPDATE public.event_people p SET user_id = 'b7000000-0000-0000-0000-000000000001'
  FROM public.event_registrations r
 WHERE r.id = (SELECT reg FROM mth WHERE k = 'b') AND p.id = r.person_id;
UPDATE public.events SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 minute'
 WHERE id = 'b7100000-0000-0000-0000-000000000001';
SELECT pg_temp.act_as('b7000000-0000-0000-0000-000000000001', 'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7');
SELECT pg_temp.assert(
  (public.event_registration_manage_view(jsonb_build_object('registration_id', (SELECT reg FROM mth WHERE k = 'b')))
     ->>'owned_by_caller')::boolean,
  '78/konto: wlasciciel konta widzi zgloszenie po identyfikatorze mimo wygaslego klucza');
SELECT pg_temp.act_as(NULL, NULL);

ROLLBACK;
