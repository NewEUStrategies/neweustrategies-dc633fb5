-- ============================================================================
-- PRELEGENT BEZ KONTA: KARTOTEKA OSOBY JAKO PODMIOT WYSTAPIENIA.
--
-- CO BYLO ZLE (nie "zepsute" - NIEDOSTEPNE Z DEFINICJI)
--
-- Ekran prelegentow wydarzenia ma jedno pole wejsciowe - droplista
-- „Dodaj prelegenta...". Ta droplista jest WYSZUKIWARKA ISTNIEJACYCH KONT
-- (`MemberPicker` robi zwykly SELECT z `profiles` + ilike), a rejestr, do
-- ktorego zapisuje, fizycznie nie dopuszcza osoby bez konta:
--   * `event_speakers` (20260714130000): `user_id uuid NOT NULL REFERENCES
--     auth.users(id)`, `PRIMARY KEY (event_id, user_id)`, ZERO `tenant_id`;
--   * `speaker_profiles` (20260727200000:34): `user_id uuid NOT NULL
--     REFERENCES auth.users(id)`.
-- Czyli „zaloz prelegenta i wpisz jego szczegoly" nie istnialo jako operacja.
-- Luka byla odlozona SWIADOMIE - 20260823140000:161-172 mowi to wprost
-- („Do tego czasu obie sciezki sa pelne i egzekwowalne, tylko wezsze").
--
-- Dane referencyjne wzorca robia odwrotnie: 21 z 21 osob w grupie „Speakers"
-- ma status „No account" i powstaje w dialogu „Create manually"
-- (docs/zrzuty/swapcard-2026-08-23/06-content-people-create-manually-dialog.png).
--
-- ROZSTRZYGNIECIE: PRELEGENT TO OSOBA, NIE KONTO.
--
-- Podmiotem jest wiersz `event_people` - kartoteka osob najemcy, ktora ISTNIEJE
-- od 20260823150000 i od poczatku byla projektowana pod czlowieka bez konta
-- (komentarz tamtej migracji: „NULL = uczestnik bez konta (21 z 21 prelegentow
-- w danych referencyjnych)"). `speaker_profiles` staje sie NAKLADKA SCENICZNA
-- tej samej osoby - wskazuje ALBO konto, ALBO wiersz kartoteki. Kont nie
-- zakladamy: redakcja nie ma prawa utworzyc 21 tozsamosci bez wiedzy tych osob.
--
-- CO ROBI TA MIGRACJA
--   1) `event_people`: zdjecie i bio - dwa pola, ktore zbiera popup, a ktorych
--      kartoteka nie miala.
--   2) `speaker_profiles`: `user_id` przestaje byc obowiazkowy, dochodzi
--      `person_id` i CHECK „dokladnie jedno z dwoch".
--   3) `event_speaker_entries`: NOWA tabela wiazaca prelegenta z wydarzeniem.
--   4) Cztery RPC panelu (lista, upsert, usuniecie, kolejnosc) za JEDNA bramka
--      `assert_event_admin_tenant()`.
--   5) `event_speakers_public`: publiczna projekcja, ktora NIE gubi osoby bez
--      konta (LEFT JOIN zamiast JOIN po `profiles`).
--
-- CZEGO TA MIGRACJA NIE ROBI - I DLACZEGO
--   * NIE rusza `event_agenda`. Projekcja agendy ma `JOIN profiles` i tez gubi
--     osobe bez konta, ale jej kontrakt czyta rownolegle prowadzona praca nad
--     agenda (`agendaSurface.ts`, `eventPublicSurface.test.ts`). Zmiana wchodzi
--     PO scaleniu tamtej galezi - inaczej dwie galezie przedeklarowuja te sama
--     funkcje i wygrywa ta, ktora scali sie druga.
--   * NIE przepisuje `get_public_speakers`. Tamta funkcja obsluguje jeszcze tryb
--     katalogu i tryb `p_user_ids` dla agendy; zmiana jej `RETURNS TABLE` rusza
--     `check:rpc-contract` i widget buildera. Nowa nazwa jest tansza.
--   * NIE rusza `event_speakers`. Tabela zostaje jako LEGACY (repozytorium samo
--     tak ja nazywa - 20260823170000:884) i jest czytana przez kreator stron,
--     hub ekspertow i spolecznosc. Publiczna projekcja robi UNION obu rejestrow,
--     wiec dotychczasowi prelegenci nie znikaja z zadnej strony.
--
-- IZOLACJA NAJEMCOW
--   * Nowa tabela ma `tenant_id uuid NOT NULL` i KAZDE powiazanie jest kluczem
--     obcym ZLOZONYM: `(tenant_id, event_id) -> events(tenant_id, id)` oraz
--     `(tenant_id, speaker_profile_id) -> speaker_profiles(tenant_id, id)`.
--     Wiersz nie moze wskazac wydarzenia ani prelegenta obcego najemcy - baza
--     odrzuca to na poziomie silnika, takze przy imporcie.
--   * Plaszczyzna administracyjna (`admin_event_speaker*`) uzywa WYLACZNIE
--     `assert_event_admin_tenant()` (tenant DOMOWY z `profiles`). Plaszczyzna
--     tresci (`event_speakers_public`) uzywa WYLACZNIE `public_tenant_id()`
--     i nie wola `has_role()` ani razu. Zadne cialo nie miesza tych dwoch
--     swiatow - naglowek `x-tenant-host` jest falsyfikowalny
--     (bramka `check:sql-tenant-scope`).
--
-- KONTRAKT RLS MODULU
--   Kazda polityka na tabeli `event%` (poza imiennymi wyjatkami `events`,
--   `event_rsvps`, `event_speakers`) stoi na `has_role(admin) OR is_super_admin`
--   i NIE wymienia roli `editor` - pilnuje tego
--   `supabase/tests/event_admin_only_contract_test.sql`. Nowa tabela wchodzi pod
--   ten kontrakt automatycznie, bo nie ma jej na liscie wyjatkow.
--
-- Wszystko idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KARTOTEKA OSOBY: ZDJECIE I BIO
--
-- Kartoteka ma juz imie, nazwisko, adres, telefon, stanowisko, firme (wpisana
-- i z CRM) oraz profil spolecznosciowy (20260823150000:167-212). Brakuje
-- dokladnie dwoch rzeczy, ktore widac na KARCIE PRELEGENTA na stronie
-- publicznej: zdjecia i opisu. Bez nich osoba bez konta dostaje karte
-- z inicjalami i jedna linia tekstu, czyli wyglada jak blad, a nie jak wpis.
--
-- `photo_url` wymaga https tak samo jak `social_profile_url`: adres jedzie do
-- atrybutu `src`, a mieszana zawartosc na stronie z https jest blokowana przez
-- przegladarke - wtedy zdjecie nie tyle brzydko wyglada, co NIE ISTNIEJE.
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_people
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS bio_pl text,
  ADD COLUMN IF NOT EXISTS bio_en text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.event_people'::regclass
       AND conname = 'event_people_photo_url_https'
  ) THEN
    ALTER TABLE public.event_people
      ADD CONSTRAINT event_people_photo_url_https
      CHECK (photo_url IS NULL OR photo_url ~ '^https://');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.event_people'::regclass
       AND conname = 'event_people_bio_len'
  ) THEN
    ALTER TABLE public.event_people
      ADD CONSTRAINT event_people_bio_len
      CHECK (
        (bio_pl IS NULL OR char_length(bio_pl) <= 4000)
        AND (bio_en IS NULL OR char_length(bio_en) <= 4000)
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.event_people.photo_url IS
  'Zdjecie osoby (https wymagane - adres jedzie do atrybutu src, a mieszana zawartosc jest blokowana). Zrodlo awatara na karcie prelegenta dla osoby BEZ konta.';
COMMENT ON COLUMN public.event_people.bio_pl IS
  'Nota biograficzna osoby, PL. Kartoteka, nie nakladka sceniczna: to samo bio sluzy prelegentowi, panelisci i gosciowi honorowemu.';
COMMENT ON COLUMN public.event_people.bio_en IS
  'Nota biograficzna osoby, EN.';

-- ----------------------------------------------------------------------------
-- 2) NAKLADKA SCENICZNA WSKAZUJE KONTO ALBO KARTOTEKE
--
-- `user_id` traci NOT NULL, dochodzi `person_id`, a CHECK pilnuje, ze wypelnione
-- jest DOKLADNIE JEDNO z dwoch. Wiersz z oboma identyfikatorami znaczylby dwie
-- tozsamosci jednej nakladki (czyj headline?), wiersz z zadnym - nakladke bez
-- osoby, czyli sierote, ktorej nie da sie ani pokazac, ani usunac po wlascicielu.
--
-- ISTNIEJACY `UNIQUE (tenant_id, user_id)` ZOSTAJE. Postgres dopuszcza wiele
-- NULL-i w kolumnie unikalnej, wiec setka nakladek osob bez konta nie koliduje
-- na tym kluczu. Dzieki temu `admin_upsert_speaker_profile` z 20260727200000
-- dalej dziala BEZ ZMIANY - jego `ON CONFLICT (tenant_id, user_id)` celuje
-- w to samo ograniczenie.
--
-- `person_id` dostaje SWOJ czesciowy klucz unikalny. Bez niego dwa wywolania
-- popupu dla tej samej osoby daja dwie nakladki, czyli dwie karty i dwie oceny
-- jednego czlowieka - dokladnie to, czego 20260823140000:95-100 zabrania.
-- ----------------------------------------------------------------------------
ALTER TABLE public.speaker_profiles
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.speaker_profiles
  ADD COLUMN IF NOT EXISTS person_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.speaker_profiles'::regclass
       AND conname = 'speaker_profiles_person_tenant_fkey'
  ) THEN
    ALTER TABLE public.speaker_profiles
      ADD CONSTRAINT speaker_profiles_person_tenant_fkey
      FOREIGN KEY (tenant_id, person_id)
      REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.speaker_profiles'::regclass
       AND conname = 'speaker_profiles_subject_xor'
  ) THEN
    ALTER TABLE public.speaker_profiles
      ADD CONSTRAINT speaker_profiles_subject_xor
      CHECK ((user_id IS NOT NULL) <> (person_id IS NOT NULL));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS speaker_profiles_tenant_person_uniq
  ON public.speaker_profiles (tenant_id, person_id)
  WHERE person_id IS NOT NULL;

COMMENT ON COLUMN public.speaker_profiles.person_id IS
  'Osoba z kartoteki najemcy (event_people) - prelegent BEZ konta w auth.users. Dokladnie jedno z (user_id, person_id) jest wypelnione (CHECK speaker_profiles_subject_xor).';
COMMENT ON CONSTRAINT speaker_profiles_subject_xor ON public.speaker_profiles IS
  'Nakladka sceniczna ma DOKLADNIE JEDEN podmiot: konto platformy albo wiersz kartoteki. Oba naraz to dwie tozsamosci jednej karty, zaden - sierota bez wlasciciela.';

-- Kolumny `person_id` NIE dodajemy do klienckiego grantu SELECT. Granty na tej
-- tabeli sa KOLUMNOWE (wzorzec `events.join_url`), a osoba bez konta jest
-- czytana wylacznie przez definerowe projekcje - `event_speakers_public` na
-- froncie i `admin_event_speakers_list` w panelu. Dodanie kolumny do grantu
-- anonowego oddawaloby identyfikator kartoteki bez zadnego konsumenta.

-- ----------------------------------------------------------------------------
-- 3) REJESTR PRELEGENTOW WYDARZENIA
--
-- DLACZEGO NOWA TABELA, A NIE `event_speakers`. Tamta ma `PRIMARY KEY
-- (event_id, user_id)` i zero `tenant_id`: osoby bez konta nie da sie w nia
-- wpisac bez zlamania klucza glownego (NULL w PK), a dodanie `tenant_id` do
-- tabeli czytanej przez trzy inne moduly to zmiana ich kontraktow. Nowa tabela
-- jest tansza i - w przeciwienstwie do tamtej - stoi pod kontraktem RLS modulu.
--
-- Wiersz wskazuje NAKLADKE (`speaker_profile_id`), a nie osobe. Dzieki temu
-- obsada sesji (`event_session_speakers`, ktora wskazuje `speaker_profiles`)
-- i lista prelegentow wydarzenia mowia o TYM SAMYM podmiocie - inaczej ta sama
-- osoba miala by dwie kolejnosci i dwa opisy sceniczne.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_speaker_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  speaker_profile_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_speaker_entries_tenant_id_key UNIQUE (tenant_id, id),
  -- Jedna osoba jest prelegentem wydarzenia RAZ. Dwa wiersze to dwie karty
  -- pod jednym nazwiskiem, nie dwie role - role sa na obsadzie sesji.
  CONSTRAINT event_speaker_entries_unique UNIQUE (tenant_id, event_id, speaker_profile_id),
  CONSTRAINT event_speaker_entries_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_speaker_entries_profile_fk FOREIGN KEY (tenant_id, speaker_profile_id)
    REFERENCES public.speaker_profiles (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_speaker_entries IS
  'Prelegenci wydarzenia: powiazanie wydarzenia z nakladka sceniczna (speaker_profiles), ktora wskazuje konto ALBO osobe z kartoteki. Nastepca legacy event_speakers - tamta nie ma tenant_id i nie przyjmuje osoby bez konta. Zapis wylacznie przez admin_event_speaker_upsert.';
COMMENT ON COLUMN public.event_speaker_entries.sort_order IS
  'Kolejnosc na liscie i na karcie publicznej. Przenumerowanie calej listy (0..n-1) przez admin_event_speaker_reorder - zamiana dwoch wartosci byla by no-op dla rzedow z rownym sort_order.';

CREATE INDEX IF NOT EXISTS event_speaker_entries_event_idx
  ON public.event_speaker_entries (tenant_id, event_id, sort_order);
CREATE INDEX IF NOT EXISTS event_speaker_entries_profile_idx
  ON public.event_speaker_entries (tenant_id, speaker_profile_id);

DROP TRIGGER IF EXISTS event_speaker_entries_touch_updated_at ON public.event_speaker_entries;
CREATE TRIGGER event_speaker_entries_touch_updated_at
  BEFORE UPDATE ON public.event_speaker_entries
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_speaker_entries TO authenticated;
GRANT ALL ON public.event_speaker_entries TO service_role;
ALTER TABLE public.event_speaker_entries ENABLE ROW LEVEL SECURITY;

-- Plaszczyzna administracyjna: `admin` ALBO `is_super_admin`, NIGDY `editor`.
-- Predykat przepisany z 20260825192230 (naprawa RLS modulu) - kontrakt
-- `event_admin_only_contract_test.sql` czyta KATALOG, nie migracje, wiec
-- jedno `CREATE POLICY` we wzorcu `admin OR editor` cofnelo by tamta naprawe
-- bez sladu w diffie. Ta galaz popelnila juz ten blad raz.
DROP POLICY IF EXISTS "event_speaker_entries_staff_read" ON public.event_speaker_entries;
CREATE POLICY "event_speaker_entries_staff_read"
  ON public.event_speaker_entries FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );
-- Zapis: BRAK polityki klienckiej. Jedyna droga to RPC z bramka
-- `assert_event_admin_tenant()` (wzorzec `event_rsvps` / `speaker_profiles`).
-- Odczytu ANONIMOWEGO tez nie ma swiadomie: front czyta definerowe
-- `event_speakers_public`, wiec polityka publiczna dawala by druga, szersza
-- droge do tych samych wierszy bez ani jednego konsumenta.

-- ----------------------------------------------------------------------------
-- 4) PANEL: CZTERY OPERACJE, JEDNA BRAMKA
--
-- Bramka `assert_event_admin_tenant()` (20260824090000): `admin` albo
-- `super_admin`, NIGDY `editor`. Nazwy `assert_editor_tenant()` nowy kod nie
-- wola - to wycofany alias, ktory mimo nazwy odrzuca redakcje.
-- ----------------------------------------------------------------------------

-- 4a) LISTA. Panel nie czyta tych tabel wprost, bo nie da sie tego zrobic
-- poprawnie: `speaker_profiles` nie ma polityki stafowej (tylko publiczna
-- „is_public" i wlascicielska), wiec kliencki SELECT gubilby nakladki
-- niepubliczne, a `event_people` ma polityke stafowa o INNYM predykacie niz
-- nowa tabela. Jedna definerowa projekcja zamiast trzech zapytan i dwoch
-- niespojnych predykatow.
CREATE OR REPLACE FUNCTION public.admin_event_speakers_list(p_event_id uuid)
RETURNS TABLE (
  entry_id uuid,
  speaker_profile_id uuid,
  user_id uuid,
  person_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  company text,
  email text,
  is_public boolean,
  sort_order integer,
  is_legacy boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      en.id AS entry_id,
      en.speaker_profile_id,
      sp.user_id,
      sp.person_id,
      sp.is_public,
      en.sort_order,
      false AS is_legacy
    FROM public.event_speaker_entries en
    JOIN public.speaker_profiles sp
      ON sp.id = en.speaker_profile_id AND sp.tenant_id = en.tenant_id
    WHERE en.tenant_id = v_tenant
      AND en.event_id = p_event_id
    UNION ALL
    -- Rzedy legacy: ta sama lista, zeby redaktor nie widzial dwoch rejestrow
    -- tego samego wydarzenia. Osoba, ktora ma juz wpis w nowej tabeli, nie
    -- pojawia sie dwa razy (NOT EXISTS ponizej).
    SELECT
      NULL::uuid AS entry_id,
      sp.id AS speaker_profile_id,
      es.user_id,
      NULL::uuid AS person_id,
      sp.is_public,
      es.sort_order,
      true AS is_legacy
    FROM public.event_speakers es
    LEFT JOIN public.speaker_profiles sp
      ON sp.user_id = es.user_id AND sp.tenant_id = v_tenant
    WHERE es.event_id = p_event_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_speaker_entries en2
        JOIN public.speaker_profiles sp2
          ON sp2.id = en2.speaker_profile_id AND sp2.tenant_id = en2.tenant_id
        WHERE en2.tenant_id = v_tenant
          AND en2.event_id = p_event_id
          AND sp2.user_id = es.user_id
      )
  )
  SELECT
    b.entry_id,
    b.speaker_profile_id,
    b.user_id,
    b.person_id,
    -- Osoba bez konta ma imie i nazwisko w kartotece; konto ma display_name.
    COALESCE(
      pr.display_name,
      NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), '')
    ) AS display_name,
    COALESCE(pr.avatar_url, pe.photo_url) AS avatar_url,
    COALESCE(ap.job_title, pe.job_title) AS job_title,
    COALESCE(ap.company, pe.company_text) AS company,
    pe.email,
    COALESCE(b.is_public, true) AS is_public,
    b.sort_order,
    b.is_legacy
  FROM base b
  LEFT JOIN public.profiles pr
    ON pr.id = b.user_id AND pr.tenant_id = v_tenant
  LEFT JOIN public.event_people pe
    ON pe.id = b.person_id AND pe.tenant_id = v_tenant
  LEFT JOIN public.author_profiles ap
    ON ap.user_id = b.user_id AND ap.tenant_id = v_tenant
  ORDER BY b.sort_order, lower(COALESCE(pr.display_name, pe.last_name, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speakers_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speakers_list(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speakers_list(uuid) IS
  'Prelegenci wydarzenia dla panelu: nowy rejestr (event_speaker_entries) UNION legacy event_speakers, z nazwiskiem i zdjeciem osoby BEZ konta z kartoteki. Bramka: assert_event_admin_tenant().';

-- 4b) UPSERT. JEDNO wywolanie zaklada osobe I podpina ja do wydarzenia -
-- dotychczas nie istniala ZADNA funkcja, ktora robi oba kroki, a rozbicie na
-- dwa wywolania z klienta zostawia po bledzie sieci osobe w kartotece bez
-- wystapienia (czyli smiec, ktorego redaktor nie widzi w zadnym ekranie).
--
-- DWA TRYBY, jeden payload:
--   * `user_id`  -> tryb KONTA: nakladka na istniejacy profil platformy;
--   * bez niego  -> tryb OSOBY: dopasowanie/zalozenie wiersza kartoteki.
--
-- DOPASOWANIE PO `email_norm`, nie po nazwisku: adres jest kluczem tozsamosci
-- w kartotece (unikalny indeks `event_people_tenant_email_uniq`), a dwoch
-- Kowalskich to norma. Osoba BEZ adresu jest zakladana za kazdym razem nowa -
-- inaczej dwoch imiennikow bez adresu scalilo by sie w jednego czlowieka.
--
-- ZGODY: popup ustawia WYLACZNIE `consent_data_processing_at` i `source`.
-- Zgody marketingowej ani partnerskiej organizator nie moze udzielic za osobe -
-- to byla by zgoda pozorna. Zostaja w sciezce rejestracji, gdzie klika je
-- czlowiek, ktorego dotycza.
--
-- `source = 'organizer'`, a nie 'organiser_entry': CHECK
-- `event_people_source_values` (20260823150000:219-221) wylicza siedem wartosci
-- i 'organiser_entry' nie jest jedna z nich. 'organizer' znaczy dokladnie to
-- samo („wpisal organizator"), a osma wartosc o tym samym znaczeniu dalaby dwa
-- sposoby zapisania jednego faktu.
-- Tablica tekstowa z jsonb: `["a","b"]` -> `{a,b}`, z obcieciem bialych znakow
-- i odsianiem pustych. Wydzielona funkcja, a nie podzapytanie w trzech
-- miejscach: to samo przeksztalcenie powtorzone trzy razy inline rozjezdza sie
-- przy pierwszej poprawce (raz z `btrim`, raz bez).
CREATE OR REPLACE FUNCTION public._event_speaker_text_array(p_value jsonb)
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT btrim(item)
        FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::jsonb END
             ) AS t(item)
       WHERE btrim(item) <> ''
    ),
    '{}'::text[]
  );
$$;

REVOKE ALL ON FUNCTION public._event_speaker_text_array(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_speaker_text_array(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public._event_speaker_text_array(jsonb) IS
  'Pomocnik: tablica tekstowa z jsonb (btrim, bez pustych, nie-tablica na {}). Uzywany przez admin_event_speaker_upsert do tematow i jezykow nakladki scenicznej.';

CREATE OR REPLACE FUNCTION public.admin_event_speaker_upsert(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant     uuid := public.assert_event_admin_tenant();
  v_uid        uuid := auth.uid();
  v_event_id   uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_user_id    uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_person_id  uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_group_id   uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_email      text := NULLIF(btrim(p_payload->>'email'), '');
  v_first      text := NULLIF(btrim(p_payload->>'first_name'), '');
  v_last       text := NULLIF(btrim(p_payload->>'last_name'), '');
  v_profile_id uuid;
  v_entry_id   uuid;
  v_sort       integer;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: event_id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  IF v_user_id IS NOT NULL THEN
    -- ---- TRYB KONTA -------------------------------------------------------
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles pr
       WHERE pr.id = v_user_id AND pr.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'event_speakers: profile not found in tenant' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.speaker_profiles AS sp (tenant_id, user_id)
    VALUES (v_tenant, v_user_id)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET updated_at = now()
    RETURNING sp.id INTO v_profile_id;
  ELSE
    -- ---- TRYB OSOBY -------------------------------------------------------
    IF v_person_id IS NULL THEN
      IF v_first IS NULL OR v_last IS NULL THEN
        RAISE EXCEPTION 'event_speakers: first_name and last_name are required'
          USING ERRCODE = '22023';
      END IF;

      IF v_email IS NOT NULL THEN
        SELECT pe.id INTO v_person_id
          FROM public.event_people pe
         WHERE pe.tenant_id = v_tenant
           AND pe.email_norm = lower(btrim(v_email));
      END IF;
    END IF;

    IF v_person_id IS NULL THEN
      INSERT INTO public.event_people (
        tenant_id, email, first_name, last_name, phone, job_title,
        company_text, social_profile_url, photo_url, bio_pl, bio_en,
        source, consent_data_processing_at, created_by
      ) VALUES (
        v_tenant, v_email, v_first, v_last,
        NULLIF(btrim(p_payload->>'phone'), ''),
        NULLIF(btrim(p_payload->>'job_title'), ''),
        NULLIF(btrim(p_payload->>'company_text'), ''),
        NULLIF(btrim(p_payload->>'social_profile_url'), ''),
        NULLIF(btrim(p_payload->>'photo_url'), ''),
        NULLIF(btrim(p_payload->>'bio_pl'), ''),
        NULLIF(btrim(p_payload->>'bio_en'), ''),
        'organizer', now(), v_uid
      )
      RETURNING id INTO v_person_id;
    ELSE
      -- PATCH, nie nadpisanie: klucz nieobecny w payloadzie zostawia kolumne
      -- nietknieta. Popup prelegenta nie jest jedynym pisarzem tej kartoteki -
      -- rejestracja i skan leada tez tam pisza, wiec puste pole formularza nie
      -- moze wymazac telefonu wpisanego przez samego uczestnika.
      IF NOT EXISTS (
        SELECT 1 FROM public.event_people pe
         WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant
      ) THEN
        RAISE EXCEPTION 'event_speakers: person not found in tenant' USING ERRCODE = '42501';
      END IF;

      UPDATE public.event_people pe SET
        first_name         = COALESCE(v_first, pe.first_name),
        last_name          = COALESCE(v_last, pe.last_name),
        email              = COALESCE(v_email, pe.email),
        phone              = COALESCE(NULLIF(btrim(p_payload->>'phone'), ''), pe.phone),
        job_title          = COALESCE(NULLIF(btrim(p_payload->>'job_title'), ''), pe.job_title),
        company_text       = COALESCE(NULLIF(btrim(p_payload->>'company_text'), ''), pe.company_text),
        social_profile_url = COALESCE(NULLIF(btrim(p_payload->>'social_profile_url'), ''), pe.social_profile_url),
        photo_url          = COALESCE(NULLIF(btrim(p_payload->>'photo_url'), ''), pe.photo_url),
        bio_pl             = COALESCE(NULLIF(btrim(p_payload->>'bio_pl'), ''), pe.bio_pl),
        bio_en             = COALESCE(NULLIF(btrim(p_payload->>'bio_en'), ''), pe.bio_en),
        consent_data_processing_at = COALESCE(pe.consent_data_processing_at, now())
      WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant;
    END IF;

    INSERT INTO public.speaker_profiles AS sp (tenant_id, person_id)
    VALUES (v_tenant, v_person_id)
    ON CONFLICT (tenant_id, person_id) WHERE person_id IS NOT NULL DO UPDATE
      SET updated_at = now()
    RETURNING sp.id INTO v_profile_id;

    -- Grupa jest OPCJONALNA, w odroznieniu od wzorca (tam pole wymagane, bo
    -- tam grupa JEST rola). U nas rola „prelegent" wynika z wpisu w rejestrze,
    -- a grupa niesie uprawnienia (kto kogo widzi, kto moze sie spotkac) - wiec
    -- brak grupy nie moze blokowac zalozenia prelegenta.
    IF v_group_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.event_groups g
         WHERE g.id = v_group_id AND g.tenant_id = v_tenant AND g.event_id = v_event_id
      ) THEN
        RAISE EXCEPTION 'event_speakers: group not found in event' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.event_group_members (tenant_id, event_id, group_id, person_id, added_by)
      VALUES (v_tenant, v_event_id, v_group_id, v_person_id, v_uid)
      ON CONFLICT (tenant_id, group_id, person_id) DO NOTHING;
    END IF;
  END IF;

  -- Nakladka sceniczna dostaje WYLACZNIE to, czego nie ma kartoteka: role
  -- sceniczna, tematy, jezyki i flage opisu. Bio popupu jedzie do
  -- `event_people` i TYLKO tam - ten sam tekst w dwoch kolumnach to dwa zrodla
  -- prawdy, ktore rozjezdzaja sie przy pierwszej korekcie literowki. Projekcja
  -- publiczna czyta `COALESCE(sp.bio, pe.bio)`, wiec redaktor moze pozniej
  -- nadpisac bio osoby WERSJA SCENICZNA w dialogu profilu - wtedy wygra nakladka.
  --
  -- TABLICE SA PATCHOWANE PO OBECNOSCI KLUCZA (`p_payload ? 'topics_pl'`), a nie
  -- po pustosci wartosci: `[]` znaczy „wyczysc tematy", a brak klucza znaczy
  -- „nie dotykaj". Bez tego rozroznienia nie da sie usunac ostatniego tematu.
  UPDATE public.speaker_profiles sp SET
    headline_pl = COALESCE(NULLIF(btrim(p_payload->>'headline_pl'), ''), sp.headline_pl),
    headline_en = COALESCE(NULLIF(btrim(p_payload->>'headline_en'), ''), sp.headline_en),
    topics_pl   = CASE WHEN p_payload ? 'topics_pl'
                       THEN public._event_speaker_text_array(p_payload->'topics_pl')
                       ELSE sp.topics_pl END,
    topics_en   = CASE WHEN p_payload ? 'topics_en'
                       THEN public._event_speaker_text_array(p_payload->'topics_en')
                       ELSE sp.topics_en END,
    languages   = CASE WHEN p_payload ? 'languages'
                       THEN public._event_speaker_text_array(p_payload->'languages')
                       ELSE sp.languages END,
    is_public   = COALESCE((p_payload->>'is_public')::boolean, sp.is_public)
  WHERE sp.id = v_profile_id AND sp.tenant_id = v_tenant;

  -- KOLEJNOSC LICZY BAZA, nie klient: „na koniec listy" wymaga zobaczenia
  -- calej listy, a klient widzi tylko swoja migawke sprzed sekundy.
  SELECT COALESCE(MAX(en.sort_order) + 1, 0) INTO v_sort
    FROM public.event_speaker_entries en
   WHERE en.tenant_id = v_tenant AND en.event_id = v_event_id;

  INSERT INTO public.event_speaker_entries AS en (
    tenant_id, event_id, speaker_profile_id, sort_order
  ) VALUES (v_tenant, v_event_id, v_profile_id, v_sort)
  ON CONFLICT (tenant_id, event_id, speaker_profile_id) DO UPDATE
    SET updated_at = now()
  RETURNING en.id INTO v_entry_id;

  RETURN jsonb_build_object(
    'entry_id', v_entry_id,
    'speaker_profile_id', v_profile_id,
    'person_id', v_person_id,
    'user_id', v_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speaker_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_upsert(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speaker_upsert(jsonb) IS
  'Zaklada prelegenta i podpina go do wydarzenia w JEDNYM zapisie. Tryb osoby (bez user_id): dopasowanie/zalozenie event_people po email_norm + nakladka speaker_profiles(person_id) + wpis event_speaker_entries. Tryb konta (user_id): nakladka speaker_profiles(user_id) + wpis. Zgody: wylacznie consent_data_processing_at, source=organizer. Bramka: assert_event_admin_tenant().';

-- 4c) USUNIECIE. Zdejmuje prelegenta z WYDARZENIA, a nie z platformy: nakladka
-- sceniczna i wiersz kartoteki zostaja, bo ta sama osoba wystepuje na kolejnych
-- wydarzeniach, a kartoteka jest dokumentem obecnosci. Rzad legacy jest
-- usuwany rownolegle, inaczej „usunieta" osoba wracala by z drugiego rejestru.
CREATE OR REPLACE FUNCTION public.admin_event_speaker_remove(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant     uuid := public.assert_event_admin_tenant();
  v_event_id   uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_profile_id uuid := NULLIF(p_payload->>'speaker_profile_id', '')::uuid;
  v_user_id    uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_removed    integer := 0;
  v_legacy     integer := 0;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: event_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_profile_id IS NULL AND v_user_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: speaker_profile_id or user_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  WITH gone AS (
    DELETE FROM public.event_speaker_entries en
     WHERE en.tenant_id = v_tenant
       AND en.event_id = v_event_id
       AND (
         en.speaker_profile_id = v_profile_id
         OR (
           v_user_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM public.speaker_profiles sp
              WHERE sp.id = en.speaker_profile_id
                AND sp.tenant_id = v_tenant
                AND sp.user_id = v_user_id
           )
         )
       )
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_removed FROM gone;

  IF v_user_id IS NOT NULL THEN
    WITH gone_legacy AS (
      DELETE FROM public.event_speakers es
       WHERE es.event_id = v_event_id AND es.user_id = v_user_id
      RETURNING 1
    )
    SELECT count(*)::integer INTO v_legacy FROM gone_legacy;
  END IF;

  RETURN (v_removed + v_legacy) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speaker_remove(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_remove(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speaker_remove(jsonb) IS
  'Zdejmuje prelegenta z wydarzenia (event_speaker_entries + rzad legacy event_speakers). Nakladka sceniczna i wiersz kartoteki ZOSTAJA - osoba wystepuje na kolejnych wydarzeniach. Bramka: assert_event_admin_tenant().';

-- 4d) KOLEJNOSC. Przenumerowanie CALEJ listy (0..n-1), a nie zamiana dwoch
-- wartosci: rzedy legacy maja `sort_order` DEFAULT 0, wiec zamiana dwoch
-- rownych wartosci jest no-op, a czesciowy zapis zostawia duplikaty.
-- Przenumerowanie jest idempotentne i samo naprawia taki stan.
CREATE OR REPLACE FUNCTION public.admin_event_speaker_reorder(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant   uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_count    integer := 0;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: event_id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  WITH wanted AS (
    SELECT
      NULLIF(btrim(item->>'speaker_profile_id'), '')::uuid AS speaker_profile_id,
      NULLIF(btrim(item->>'user_id'), '')::uuid AS user_id,
      (ordinality - 1)::integer AS sort_position
    FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb))
      WITH ORDINALITY AS t(item, ordinality)
  ),
  touched_new AS (
    UPDATE public.event_speaker_entries en
       SET sort_order = w.sort_position
      FROM wanted w
     WHERE en.tenant_id = v_tenant
       AND en.event_id = v_event_id
       AND en.speaker_profile_id = w.speaker_profile_id
       AND en.sort_order <> w.sort_position
    RETURNING 1
  ),
  touched_legacy AS (
    UPDATE public.event_speakers es
       SET sort_order = w.sort_position
      FROM wanted w
     WHERE es.event_id = v_event_id
       AND w.user_id IS NOT NULL
       AND es.user_id = w.user_id
       AND es.sort_order <> w.sort_position
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM touched_new) + (SELECT count(*) FROM touched_legacy)
    INTO v_count;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speaker_reorder(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_reorder(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speaker_reorder(jsonb) IS
  'Przenumerowanie listy prelegentow wydarzenia (items[] w zadanej kolejnosci -> sort_order 0..n-1), oba rejestry naraz. Idempotentne. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 5) FRONT: PROJEKCJA, KTORA NIE GUBI OSOBY BEZ KONTA
--
-- `get_public_speakers` ma `JOIN public.profiles p ON p.id = b.user_id`
-- (20260727200000:193-195) - INNER. Prelegent bez konta wypada z listy
-- BEZWARUNKOWO, bez sladu w logu i bez bledu: strona pokazuje pusta sekcje,
-- a redaktor widzi w panelu piecioro prelegentow. Tutaj to LEFT JOIN,
-- a tozsamosc jest liczona z tego zrodla, ktore ISTNIEJE.
--
-- NOWA NAZWA, a nie przepisanie tamtej funkcji: tamta obsluguje jeszcze tryb
-- katalogu i tryb `p_user_ids` dla agendy, wiec zmiana jej `RETURNS TABLE`
-- rusza `check:rpc-contract` i widget buildera. Nazewnictwo jak istniejace
-- `event_sponsors_public`.
--
-- WARUNEK PUBLIKACJI ZOSTAJE (`e.status = 'published'`): to jest plaszczyzna
-- TRESCI, a szkic nie ma strony publicznej. Panel mowi o tym wprost plakietka -
-- inaczej redaktor dodaje piecioro prelegentow i uznaje, ze funkcja nie dziala.
--
-- `is_public` na nakladce dziala tak jak w `get_public_speakers`: ukrywa OPIS
-- SCENICZNY (headline/bio/tematy), a nie osobe. Nazwisko i zdjecie ida bez
-- warunku, bo o obecnosci na liscie decyduje WPIS do rejestru, a nie flaga
-- nakladki. Etykieta w panelu mowi wiec „Pokaz opis sceniczny", nie „Publiczny".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_speakers_public(p_payload jsonb)
RETURNS TABLE (
  speaker_profile_id uuid,
  user_id uuid,
  person_id uuid,
  slug text,
  display_name text,
  avatar_url text,
  job_title text,
  company text,
  headline_pl text,
  headline_en text,
  bio_pl text,
  bio_en text,
  topics_pl text[],
  topics_en text[],
  languages text[],
  talks_count integer,
  rating numeric,
  reviews_count integer,
  is_expert boolean,
  has_speaker_profile boolean,
  sort_order integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant   uuid := public.public_tenant_id();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_slug     text := NULLIF(btrim(p_payload->>'slug'), '');
  v_limit    integer := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 100), 1), 200);
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  -- Wydarzenie rozwiazujemy po id ALBO po slugu - front strony publicznej ma
  -- slug w adresie, a widget buildera ma id.
  SELECT e.id INTO v_event_id
    FROM public.events e
   WHERE e.tenant_id = v_tenant
     AND e.status = 'published'
     AND (
       (v_event_id IS NOT NULL AND e.id = v_event_id)
       OR (v_event_id IS NULL AND v_slug IS NOT NULL AND e.slug = v_slug)
     );

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      sp.id AS speaker_profile_id,
      sp.user_id,
      sp.person_id,
      en.sort_order
    FROM public.event_speaker_entries en
    JOIN public.speaker_profiles sp
      ON sp.id = en.speaker_profile_id AND sp.tenant_id = en.tenant_id
    WHERE en.tenant_id = v_tenant
      AND en.event_id = v_event_id
    UNION ALL
    -- Legacy `event_speakers`: bez tego czlonu publikacja nowej funkcji
    -- skasowala by z froncie wszystkich dotychczasowych prelegentow.
    SELECT
      sp.id AS speaker_profile_id,
      es.user_id,
      NULL::uuid AS person_id,
      es.sort_order
    FROM public.event_speakers es
    LEFT JOIN public.speaker_profiles sp
      ON sp.user_id = es.user_id AND sp.tenant_id = v_tenant
    WHERE es.event_id = v_event_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_speaker_entries en2
        JOIN public.speaker_profiles sp2
          ON sp2.id = en2.speaker_profile_id AND sp2.tenant_id = en2.tenant_id
        WHERE en2.tenant_id = v_tenant
          AND en2.event_id = v_event_id
          AND sp2.user_id = es.user_id
      )
  )
  SELECT
    b.speaker_profile_id,
    b.user_id,
    b.person_id,
    p.slug,
    COALESCE(
      p.display_name,
      NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), '')
    ) AS display_name,
    COALESCE(ap.avatar_url, p.avatar_url, pe.photo_url) AS avatar_url,
    COALESCE(ap.job_title, pe.job_title) AS job_title,
    COALESCE(ap.company, pe.company_text) AS company,
    sp.headline_pl,
    sp.headline_en,
    COALESCE(sp.bio_pl, pe.bio_pl) AS bio_pl,
    COALESCE(sp.bio_en, pe.bio_en) AS bio_en,
    COALESCE(sp.topics_pl, '{}') AS topics_pl,
    COALESCE(sp.topics_en, '{}') AS topics_en,
    COALESCE(sp.languages, '{}') AS languages,
    COALESCE(sp.talks_count, 0) AS talks_count,
    COALESCE(sp.rating, 0) AS rating,
    COALESCE(sp.reviews_count, 0) AS reviews_count,
    EXISTS (
      SELECT 1 FROM public.profile_badges pb
       WHERE pb.user_id = b.user_id
         AND pb.badge = 'expert'
         AND pb.tenant_id = v_tenant
    ) AS is_expert,
    (b.speaker_profile_id IS NOT NULL) AS has_speaker_profile,
    b.sort_order
  FROM base b
  -- IZOLACJA: `event_speakers` nie ma `tenant_id`, wiec bez przypiecia
  -- `profiles.tenant_id` wpis wskazujacy konto obcego najemcy wyciekal by jego
  -- nazwe i awatar na naszej domenie (ten sam predykat co w get_public_speakers).
  LEFT JOIN public.profiles p
    ON p.id = b.user_id AND p.tenant_id = v_tenant
  LEFT JOIN public.event_people pe
    ON pe.id = b.person_id AND pe.tenant_id = v_tenant
  LEFT JOIN public.speaker_profiles sp
    ON sp.id = b.speaker_profile_id AND sp.tenant_id = v_tenant AND sp.is_public
  LEFT JOIN public.author_profiles ap
    ON ap.user_id = b.user_id AND ap.tenant_id = v_tenant AND ap.is_public
  -- Wiersz bez ZADNEGO zrodla tozsamosci (osierocony rzad legacy albo konto
  -- obcego najemcy) nie jest karta z pustym nazwiskiem - nie jest karta w ogole.
  WHERE p.id IS NOT NULL OR pe.id IS NOT NULL
  ORDER BY b.sort_order, lower(COALESCE(p.display_name, pe.last_name, ''))
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.event_speakers_public(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_speakers_public(jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_speakers_public(jsonb) IS
  'Publiczna lista prelegentow OPUBLIKOWANEGO wydarzenia (payload: event_id albo slug, opcjonalnie limit). UNION event_speaker_entries + legacy event_speakers, LEFT JOIN profiles - osoba BEZ konta bierze nazwisko, zdjecie, stanowisko i firme z kartoteki event_people. Plaszczyzna tresci: public_tenant_id(), zero has_role().';
