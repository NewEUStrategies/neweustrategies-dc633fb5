-- ============================================================================
-- FUNKCJE Z `extensions` WOLANE BEZ KWALIFIKATORA PRZY search_path = public
--
-- OBJAW. Piec plikow pgTAP modulu klubow (discussion_clubs_a1..a5_a6) padalo
-- w CI zawsze na pierwszym wywolaniu `admin_club_upsert`, przy 47 zaplanowanych
-- asercjach konczac na 25. Sonda diagnostyczna podala przyczyne jednym
-- komunikatem:
--
--   SQLSTATE=42883 MESSAGE=function gen_random_bytes(integer) does not exist
--
-- PRZYCZYNA. Na Supabase `pgcrypto` i `unaccent` mieszkaja w schemacie
-- `extensions`, nie w `public`. Funkcja SECURITY DEFINER z przypietym
-- `SET search_path = public` NIE widzi wiec `gen_random_bytes` ani `unaccent` -
-- przypiety search_path nadpisuje sesyjny, wiec nie pomaga nawet poprawnie
-- ustawiona sciezka wolajacego. Repo zna ten wzorzec: `arm_job_runner`
-- (20260731110000) ma `search_path = public, extensions` wprost z komentarzem
-- "search_path zawiera `extensions`, bo dosypanie sekretu wola
-- gen_random_bytes()", a `20260808060751` naprawilo tak `club_anonymity_salt`.
--
-- REGRESJA. `20260808110000_discussion_clubs_a8_hardening.sql` przedeklarowalo
-- `club_anonymity_salt` z powrotem na `SET search_path = public` i wywolanie bez
-- kwalifikatora - naprawa z 060751 zyla trzy godziny. `CREATE OR REPLACE`
-- w pozniejszej migracji cofa poprawke bez sladu w diffie tej poprawki, dlatego
-- ta migracja domyka CALA KLASE, nie jeden przypadek.
--
-- ZASIEG. Przeglad wszystkich funkcji (ostatnia definicja wygrywa) pod katem
-- niekwalifikowanych wywolan funkcji z `extensions` przy przypietym search_path
-- bez `extensions` dal siedem trafien w dwoch grupach o ROZNEJ wadze - i to
-- rozroznienie jest tu istotne, bo `pgcrypto` i `unaccent` NIE mieszkaja
-- w tym samym schemacie:
--
--   [A] AWARIA. `pgcrypto` migracje instaluja jawnie `WITH SCHEMA extensions`
--       (20260805090000, 20260805114407), wiec `gen_random_bytes` NIE jest
--       widoczne z `search_path = public`. Trzy funkcje:
--     * club_anonymity_salt              - sol pseudonimow Chatham House;
--       wolana przez trigger AFTER INSERT ON clubs, wiec KAZDE utworzenie klubu
--       konczylo sie 42883 (to jest awaria z CI, odtworzona lokalnie 1:1:
--       bez tej migracji a1 daje plan=47 ran=25 failed=5, dokladnie jak CI);
--     * admin_club_invite_link_create    - token linku zapraszajacego (32 B);
--     * newsletter_subscribers_ensure_unsub_token - token wypisu z newslettera,
--       trigger uzupelniajacy pusta kolumne.
--
--   [B] UTWARDZENIE, nie naprawa. `unaccent` powstaje w migracji 20260628210000
--       przez `CREATE EXTENSION IF NOT EXISTS unaccent;` BEZ kwalifikatora,
--       czyli w `public` - i tam stoi w CI (dowod: 20260717162432 wola
--       `public.unaccent(...)` w golym UPDATE, bez oslony, i migracje sa
--       zielone). Ponizsze cztery funkcje dzialaja wiec dzisiaj poprawnie;
--       rozszerzenie sciezki jest zabezpieczeniem na wypadek instalacji, ktora
--       postawi unaccent w `extensions` - w tej samej klasie bledu, tylko na
--       innym rozszerzeniu. Sciezka `public, extensions` obsluguje OBA
--       ustawienia, bo wywolania sa niekwalifikowane:
--     * admin_club_thread_create, club_create_thread - normalizacja sluga watku;
--     * admin_club_poll_create           - to samo dla watku ankiety;
--     * guess_gender_from_name           - normalizacja imienia przed odczytem
--       ze slownika imion.
--
-- ROZWIAZANIE. `ALTER FUNCTION ... SET search_path = public, extensions`, a nie
-- przedeklarowanie cial. Zmieniamy WYLACZNIE konfiguracje: cialo funkcji zostaje
-- bit w bit takie, jakie jest w najnowszej migracji, wiec ta migracja nie moze
-- cofnac zadnej pozniejszej poprawki logiki (dokladnie ten blad zrobilo a8).
-- Rozszerzenie sciezki dziala tez wtedy, gdy rozszerzenie stoi w `public` -
-- inaczej niz twarde `extensions.gen_random_bytes`, ktore w takiej instalacji
-- by padlo.
--
-- Kazdy wpis jest sprawdzany przez `to_regprocedure`, wiec migracja jest
-- odtwarzalna takze wtedy, gdy pozniejsza zmiana podpisu usunie ktoras funkcje.
-- ============================================================================

DO $$
DECLARE
  v_signature text;
  v_signatures text[] := ARRAY[
    -- pgcrypto
    'public.club_anonymity_salt(uuid)',
    'public.admin_club_invite_link_create(uuid, text, text, integer, timestamptz, boolean, uuid)',
    'public.newsletter_subscribers_ensure_unsub_token()',
    -- unaccent
    'public.admin_club_thread_create(uuid, text, text, uuid, text, boolean, text)',
    'public.club_create_thread(uuid, text, text, text, boolean, text, text, text, boolean, text, text, text)',
    'public.admin_club_poll_create(uuid, text, text, text, text, jsonb, timestamptz, uuid)',
    'public.guess_gender_from_name(text)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE NOTICE 'search_path fix: brak funkcji % - pomijam', v_signature;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', v_signature);
  END LOOP;
END $$;

-- Backfill soli anonimowosci dla tenantow, ktore maja juz kluby. Migracja a8
-- probowala tego samego, ale jej wstawienie wolalo `gen_random_bytes` bez
-- kwalifikatora pod search_path DDL-a - na bazie z istniejacymi klubami
-- wywrocilo by cala migracje, a na pustej `clubs` nie policzylo ani wiersza
-- (SELECT nie zwrocil nic, wiec funkcja nigdy sie nie wyliczyla). Tutaj
-- wywolanie jest kwalifikowane wprost, wiec nie zalezy od sciezki DDL-a.
INSERT INTO public.club_anonymity_salts (tenant_id, salt)
SELECT DISTINCT c.tenant_id, encode(extensions.gen_random_bytes(32), 'hex')
  FROM public.clubs c
 WHERE NOT EXISTS (
   SELECT 1 FROM public.club_anonymity_salts s WHERE s.tenant_id = c.tenant_id
 )
ON CONFLICT (tenant_id) DO NOTHING;

COMMENT ON FUNCTION public.club_anonymity_salt(uuid) IS
  'Sekret solacy pseudonimy Chatham House, jeden na tenanta. RPC-only i bez grantow - wyciek tej wartosci odwraca anonimowosc calego archiwum. search_path zawiera `extensions`, bo leniwe zasianie soli wola gen_random_bytes() (pgcrypto).';
