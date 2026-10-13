-- ============================================================================
-- 17_sms_consent_phone_race - ZGODA NA SMS A ZMIANA NUMERU W TEJ SAMEJ CHWILI
-- (przeglad R67, REG-10; migracja 20261012182000)
--
-- PO CO TEN PLIK ISTNIEJE
-- Zgoda na SMS dotyczy numeru, ktory pokazalo okno zgody (`phone_hint`),
-- a zmiana numeru zdejmuje zgode (trigger `event_people_phone_revokes_sms`).
-- Jedna transakcja (16_, pgTAP) nie pokaze dwoch rzeczy, ktore dzieja sie
-- miedzy SESJAMI:
--   A. zmiana numeru W LOCIE (organizator zapisuje nowy numer, jeszcze bez
--      commitu), a gosc klika „Zgadzam sie" z podpowiedzia starego numeru.
--      Stare cialo czytalo zacommitowany stary numer, podpowiedz sie
--      zgadzala i zgoda trafiala na zgloszenie - a trigger zmiany, ktory
--      juz sie wykonal, nie mial czego zdjac. Po commicie organizatora:
--      zgoda na numer, ktorego gosc nigdy nie widzial;
--   B. zmiana numeru zaczeta, gdy zgoda jest JUZ zapisana, ale jeszcze nie
--      zacommitowana. Stary trigger nie widzial stempla (niezacommitowany),
--      wiec go nie zdejmowal.
-- Poprawka: numer przy wlaczaniu SMS czytany z blokada wiersza osoby
-- (FOR SHARE NOWAIT). A -> `phone_changed` bez czekania; B -> zmiana numeru
-- czeka na commit zgody, a jej trigger zgode zdejmuje.
--
-- SPRZATANIE: zacommitowane fikstury wlasnego najemcy, usuwane na koncu
-- (asercja, ze nic nie zostalo); rozszerzenie dblink usuwane.
-- ============================================================================
\echo '== 17 zgoda na SMS a zmiana numeru w tej samej chwili (R67, REG-10) =='

CREATE EXTENSION IF NOT EXISTS dblink;

INSERT INTO public.tenants (id, name, slug)
VALUES ('17171717-1717-4717-8717-171717171717', 'Tenant 17 (zgoda a numer)', 't17-phone');
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode)
VALUES ('17100000-0000-4000-8000-000000000001', '17171717-1717-4717-8717-171717171717', 't17-e',
        'Numer 17', 'Phone 17', now() + interval '10 days', 'published', 'form');
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, phone) VALUES
  ('17300000-0000-4000-8000-00000000000a', '17171717-1717-4717-8717-171717171717',
   'lot.17@example.org', 'Lena', 'W Locie', '+48 608 100 200'),
  ('17300000-0000-4000-8000-00000000000b', '17171717-1717-4717-8717-171717171717',
   'po.17@example.org', 'Basia', 'Po Zgodzie', '+48 609 100 300');

CREATE TABLE public.r67_s17 (k text PRIMARY KEY, reg uuid NOT NULL, token text NOT NULL);
GRANT SELECT ON public.r67_s17 TO anon;
DO $$
DECLARE
  v_key text;
  v_token text;
BEGIN
  FOREACH v_key IN ARRAY ARRAY['a', 'b'] LOOP
    v_token := public._event_new_qr_token();
    INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode,
                                            payment_status, manage_token_hash)
    VALUES (('17400000-0000-4000-8000-00000000000' || v_key)::uuid, '17171717-1717-4717-8717-171717171717',
            '17100000-0000-4000-8000-000000000001', ('17300000-0000-4000-8000-00000000000' || v_key)::uuid,
            'approved', 'form', 'not_required', encode(extensions.digest(v_token, 'sha256'), 'hex'));
    INSERT INTO public.r67_s17 VALUES (v_key, ('17400000-0000-4000-8000-00000000000' || v_key)::uuid, v_token);
  END LOOP;
END $$;

CREATE TEMP TABLE r67_pid (who text PRIMARY KEY, pid integer NOT NULL);
SELECT dblink_connect('r67b', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'), current_database()));
INSERT INTO r67_pid SELECT 'r67b', x::integer FROM dblink('r67b', 'SELECT pg_backend_pid()') AS t(x text);
SELECT pg_temp.assert(
  (SELECT pid <> pg_backend_pid() FROM r67_pid WHERE who = 'r67b'),
  '17/wyscig: osobna sesja serwera dla organizatora');

-- Zgoda kluczem gosci jak z okna zgody (podpowiedz = 3 ostatnie cyfry).
CREATE FUNCTION pg_temp.s17_consent(_k text, _hint text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.event_registration_set_channels(jsonb_build_object(
    'manage_token', (SELECT token FROM public.r67_s17 WHERE k = _k),
    'notify_sms', true, 'remind_sms', true, 'sms_consent', true, 'phone_hint', _hint))
$$;
CREATE FUNCTION pg_temp.s17_consented(_k text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT r.notify_sms OR r.remind_sms OR r.remind_sms_consent_at IS NOT NULL
    FROM public.event_registrations r WHERE r.id = (SELECT reg FROM public.r67_s17 WHERE k = _k)
$$;

SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', '17171717-1717-4717-8717-171717171717', false);

-- ---------------------------------------------------------------------------
-- A) Zmiana numeru W LOCIE, gosc potwierdza zgode ze stara podpowiedzia
-- ---------------------------------------------------------------------------
SELECT dblink_exec('r67b', 'BEGIN');
SELECT dblink_exec('r67b', $$UPDATE public.event_people SET phone = '+48 608 100 999'
                             WHERE id = '17300000-0000-4000-8000-00000000000a'$$);
SET ROLE anon;
SELECT pg_temp.assert_raises_like(
  $q$SELECT pg_temp.s17_consent('a', '200')$q$,
  'phone_changed',
  '17/R67 A (REG-10): zmiana numeru w locie -> phone_changed, nie zgoda na numer, ktorego okno nie pokazalo');
RESET ROLE;
SELECT dblink_exec('r67b', 'COMMIT');
SELECT pg_temp.assert(
  NOT pg_temp.s17_consented('a')
  AND (SELECT phone = '+48 608 100 999' FROM public.event_people WHERE id = '17300000-0000-4000-8000-00000000000a'),
  '17/R67 A: po commicie organizatora - nowy numer i ZADNEJ zgody');
SET ROLE anon;
SELECT pg_temp.assert(
  (pg_temp.s17_consent('a', '999') ->> 'notify_sms')::boolean,
  '17/R67 A: kontrapunkt - zgoda na numer, ktory okno pokazuje teraz, przechodzi');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- B) Zgoda zapisana (bez commitu), zmiana numeru startuje w tej chwili
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.s17_wait(_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_blocked integer := 0; i integer := 0;
BEGIN
  WHILE i < 100 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT count(*) INTO v_blocked
      FROM pg_stat_activity a JOIN r67_pid p ON p.pid = a.pid
     WHERE p.who = 'r67b' AND a.wait_event_type = 'Lock';
    EXIT WHEN v_blocked >= 1;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
  PERFORM pg_temp.assert(v_blocked = 1, _label);
END $$;

BEGIN;
SET LOCAL ROLE anon;
SELECT pg_temp.assert(
  (pg_temp.s17_consent('b', '300') ->> 'notify_sms')::boolean,
  '17/R67 B: zgoda z podpowiedzia zgodna z numerem (jeszcze bez commitu)');
RESET ROLE;
SELECT dblink_send_query('r67b', $$UPDATE public.event_people SET phone = '+48 609 100 777'
                                    WHERE id = '17300000-0000-4000-8000-00000000000b'$$);
SELECT pg_temp.s17_wait('17/R67 B DOWOD: zmiana numeru czeka na commit zgody (blokada wiersza osoby)');
COMMIT;
SELECT x FROM dblink_get_result('r67b', false) AS t(x text);
SELECT pg_temp.assert(NULLIF(dblink_error_message('r67b'), 'OK') IS NULL,
  '17/R67 B: zmiana numeru konczy sie bez bledu (bez zakleszczenia)');
SELECT 1 FROM dblink_get_result('r67b', false) AS t(x text);
SELECT pg_temp.assert(
  NOT pg_temp.s17_consented('b')
  AND (SELECT phone = '+48 609 100 777' FROM public.event_people WHERE id = '17300000-0000-4000-8000-00000000000b'),
  '17/R67 B (REG-10): zmiana numeru po zgodzie zdejmuje ja (trigger widzi zacommitowany stempel)');

SELECT dblink_disconnect('r67b');
DROP TABLE r67_pid;
DROP EXTENSION dblink;

-- Sprzatanie.
SELECT set_config('nes.public_tenant', '', false);
DELETE FROM public.event_registrations WHERE tenant_id = '17171717-1717-4717-8717-171717171717';
DELETE FROM public.event_people WHERE tenant_id = '17171717-1717-4717-8717-171717171717';
DELETE FROM public.events WHERE tenant_id = '17171717-1717-4717-8717-171717171717';
DELETE FROM public.tenants WHERE id = '17171717-1717-4717-8717-171717171717';
DROP TABLE public.r67_s17;
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = '17171717-1717-4717-8717-171717171717')
  AND NOT EXISTS (SELECT 1 FROM public.event_people WHERE tenant_id = '17171717-1717-4717-8717-171717171717')
  AND to_regclass('public.r67_s17') IS NULL,
  '17: sprzatanie - plik nie zostawil ani jednego wiersza');
