-- Rekrutacja: referencja `contact_messages.custom ->> 'cv_path'` NIE nadaje
-- prawa do pliku CV innego najemcy. Migracja naprawcza (bezpieczeństwo, RODO).
--
-- LUKA. Ostatnia definicja polityk `career_cv_staff_read` / `_staff_delete`
-- (20260824074231) miała dwie gałęzie:
--
--     (storage.foldername(name))[1] = current_tenant_id()::text
--     OR EXISTS (SELECT 1 FROM contact_messages m
--                 WHERE m.tenant_id = current_tenant_id()
--                   AND m.custom ->> 'cv_path' = storage.objects.name)
--
-- Druga gałąź miała obsłużyć WYŁĄCZNIE pliki legacy (`uploads/...`, bez
-- tenanta w ścieżce), ale nie była do nich ograniczona. Wystarczył wiersz
-- zgłoszenia najemcy A z `cv_path = '<B>/uploads/...'`, żeby personel A
-- dostał SELECT (podpisany URL) i DELETE na CV kandydata najemcy B. Taki
-- wiersz dało się założyć dwiema drogami:
--   * sfałszowanym zgłoszeniem publicznym - `submitContact` sprawdzał sam
--     KSZTAŁT ścieżki (regex przyjmował dowolny UUID w pierwszym segmencie),
--     a wiersz szedł z `tenant_id` hosta;
--   * wprost z panelu - personel ma UPDATE na `contact_messages` własnego
--     najemcy, więc mógł wpisać do `custom` dowolną ścieżkę bez żadnej bramki
--     aplikacji.
-- Ta sama referencja sterowała też GC: usunięcie (albo domknięcie i retencja)
-- zgłoszenia w A kolejkowało do TRWAŁEGO usunięcia plik najemcy B
-- (`career_cv_enqueue_on_message_delete`, `career_cv_gc_scan`).
--
-- NAPRAWA - trzy warstwy, każda wystarczająca dla swojej drogi:
--   1. WŁAŚCICIEL OBIEKTU wynika z obiektu, nie z referencji. Plik
--      `<tenant>/uploads/...` należy do `<tenant>` i kropka - referencja nic tu
--      nie dodaje. Plik legacy należy do najemcy NAJWCZEŚNIEJSZEJ referencji:
--      prawdziwe zgłoszenie powstaje w chwili wysyłki, a fałszerz musi najpierw
--      poznać losową nazwę obiektu, więc zawsze jest później. Polityki
--      odczytu i usuwania pytają wyłącznie o właściciela.
--   2. STRAŻNIK NA `contact_messages`: nowa lub zmieniona referencja musi
--      wskazywać plik w katalogu najemcy wiersza. Kształt legacy jest od tej
--      migracji zamknięty dla NOWYCH referencji (uploadCv od 20260814100000
--      zawsze dokłada tenanta), zastane wiersze legacy zostają nietknięte.
--   3. GC kolejkuje plik wyłącznie w imieniu jego właściciela, a obca
--      referencja nie chroni pliku przed uznaniem za osierocony.
--
-- WYDAJNOŚĆ. Indeks `contact_messages_cv_path_idx (tenant_id, cv_path) WHERE
-- custom ? 'cv_path'` nie był używany przez nikogo: żadne zapytanie nie
-- niosło predykatu `custom ? 'cv_path'`, więc planner nie mógł sięgnąć po
-- indeks częściowy, a po tej migracji nikt już nie szuka po parze
-- (tenant, ścieżka). Zastępuje go indeks po samej ścieżce, a każde zapytanie
-- niżej niesie predykat indeksu.
--
-- POWTÓRNE WYKONANIE JEST BEZPIECZNE: `CREATE OR REPLACE FUNCTION`,
-- `DROP ... IF EXISTS` + `CREATE`, `CREATE INDEX IF NOT EXISTS`.

-- ---------------------------------------------------------------------------
-- 1. Tenant zapisany w ścieżce i właściciel obiektu
-- ---------------------------------------------------------------------------

-- Tenant z PIERWSZEGO segmentu, wyłącznie dla konwencji `<uuid>/uploads/...`.
-- NULL dla legacy (`uploads/...`) i dla każdego innego kształtu.
CREATE OR REPLACE FUNCTION public.career_cv_path_tenant(_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/uploads/'
      THEN split_part(_name, '/', 1)::uuid
  END
$$;

-- Czysta funkcja bez dostępu do danych; anon dostaje EXECUTE, bo strażnik
-- referencji (niżej) woła ją w imieniu KAŻDEJ roli, która pisze do tabeli.
REVOKE ALL ON FUNCTION public.career_cv_path_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.career_cv_path_tenant(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.career_cv_path_tenant(text) IS
  'Tenant z pierwszego segmentu sciezki <tenant>/uploads/... w buckecie career-cv; NULL dla legacy i innych ksztaltow.';

-- Najemca, do którego NALEŻY obiekt bucketu `career-cv`. SECURITY DEFINER,
-- bo dla pliku legacy musi zobaczyć referencje WSZYSTKICH najemców - pod RLS
-- personel A widziałby tylko swoje i zawsze uznawał siebie za najwcześniejszą.
CREATE OR REPLACE FUNCTION public.career_cv_object_owner(_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.career_cv_path_tenant(_name),
    CASE WHEN _name LIKE 'uploads/%' THEN (
      SELECT m.tenant_id
        FROM public.contact_messages m
       WHERE m.custom ? 'cv_path'
         AND m.custom ->> 'cv_path' = _name
       ORDER BY m.created_at, m.id
       LIMIT 1
    ) END
  )
$$;

REVOKE ALL ON FUNCTION public.career_cv_object_owner(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.career_cv_object_owner(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.career_cv_object_owner(text) IS
  'Wlasciciel obiektu career-cv: tenant ze sciezki albo (legacy uploads/...) tenant NAJWCZESNIEJSZEGO zgloszenia z ta sciezka. Referencja nigdy nie nadaje prawa do pliku w katalogu innego najemcy.';

-- ---------------------------------------------------------------------------
-- 2. Indeks po samej ścieżce (zastępuje nieużywany indeks złożony)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS contact_messages_cv_path_lookup_idx
  ON public.contact_messages ((custom ->> 'cv_path'))
  WHERE custom ? 'cv_path';

DROP INDEX IF EXISTS public.contact_messages_cv_path_idx;

COMMENT ON INDEX public.contact_messages_cv_path_lookup_idx IS
  'Wlasciciel pliku legacy (career_cv_object_owner), strażnik referencji i skan GC career-cv. Zapytania musza niesc predykat custom ? ''cv_path''.';

-- ---------------------------------------------------------------------------
-- 3. Polityki bucketu: prawo wynika z właściciela obiektu
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "career_cv_staff_read" ON storage.objects;
CREATE POLICY "career_cv_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'career-cv'
  AND public.is_admin_or_editor()
  AND public.career_cv_object_owner(name) = public.current_tenant_id()
);

DROP POLICY IF EXISTS "career_cv_staff_delete" ON storage.objects;
CREATE POLICY "career_cv_staff_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'career-cv'
  AND public.is_admin_or_editor()
  AND public.career_cv_object_owner(name) = public.current_tenant_id()
);

-- ---------------------------------------------------------------------------
-- 4. Strażnik referencji na `contact_messages`
-- ---------------------------------------------------------------------------
-- Sprawdza wyłącznie NOWĄ albo ZMIENIONĄ referencję (także zmianę najemcy
-- wiersza). UPDATE, który ścieżki nie rusza (status, `read_at`, notatki),
-- przechodzi bez kosztu - dzięki temu zastane wiersze legacy dalej dają się
-- obsługiwać w panelu, a `career_cv_gc_done` (zdejmuje ścieżkę) nie jest
-- blokowany.
CREATE OR REPLACE FUNCTION public.career_cv_path_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_path text := NULLIF(btrim(COALESCE(NEW.custom ->> 'cv_path', '')), '');
BEGIN
  IF v_path IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
     AND (NEW.custom ->> 'cv_path') IS NOT DISTINCT FROM (OLD.custom ->> 'cv_path') THEN
    RETURN NEW;
  END IF;
  IF public.career_cv_path_tenant(v_path) IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'career_cv_path_foreign_tenant'
      USING ERRCODE = 'check_violation',
            DETAIL = 'custom.cv_path musi wskazywac plik w katalogu <tenant_id>/uploads/ najemcy wiersza.';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.career_cv_path_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contact_messages_career_cv_path_guard ON public.contact_messages;
CREATE TRIGGER trg_contact_messages_career_cv_path_guard
  BEFORE INSERT OR UPDATE OF custom, tenant_id ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.career_cv_path_guard();

-- ---------------------------------------------------------------------------
-- 5. GC: kolejkujemy plik wyłącznie w imieniu jego właściciela
-- ---------------------------------------------------------------------------

/**
 * Usunięcie zgłoszenia zabiera jego CV - o ile zgłoszenie jest WŁAŚCICIELEM
 * pliku. W AFTER DELETE usuwanego wiersza już nie widać, więc dla pliku legacy
 * porównujemy go z najwcześniejszą POZOSTAŁĄ referencją.
 */
CREATE OR REPLACE FUNCTION public.career_cv_enqueue_on_message_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path text := NULLIF(btrim(COALESCE(OLD.custom ->> 'cv_path', '')), '');
  v_owner uuid;
  v_first record;
BEGIN
  IF COALESCE(OLD.form_id, '') <> 'careers' OR v_path IS NULL THEN
    RETURN OLD;
  END IF;

  v_owner := public.career_cv_path_tenant(v_path);
  IF v_owner IS NULL AND v_path LIKE 'uploads/%' THEN
    SELECT m.tenant_id, m.created_at, m.id
      INTO v_first
      FROM public.contact_messages m
     WHERE m.custom ? 'cv_path'
       AND m.custom ->> 'cv_path' = v_path
     ORDER BY m.created_at, m.id
     LIMIT 1;
    IF FOUND AND (v_first.created_at, v_first.id) < (OLD.created_at, OLD.id) THEN
      v_owner := v_first.tenant_id;
    ELSE
      v_owner := OLD.tenant_id;
    END IF;
  END IF;

  -- Referencja do cudzego (albo nierozpoznanego) obiektu: usunięcie wiersza
  -- nie może skasować pliku, który do tego najemcy nie należy.
  IF v_owner IS DISTINCT FROM OLD.tenant_id THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.career_cv_gc_queue (tenant_id, path, reason)
  VALUES (OLD.tenant_id, v_path, 'application_deleted')
  ON CONFLICT (path) DO NOTHING;
  RETURN OLD;
END $$;

/**
 * Skan: dokłada do kolejki pliki osierocone i pliki po okresie retencji.
 *
 * OSIEROCONE - obiekt, na który nie powołuje się żadne zgłoszenie JEGO
 * najemcy (dla pliku legacy: żadne zgłoszenie), starszy niż okno łaski
 * najemcy. Obca referencja nie trzyma pliku przy życiu - inaczej jeden
 * sfałszowany wiersz wstrzymałby usunięcie CV na zawsze.
 *
 * PO RETENCJI - proces domknięty (hired / rejected / withdrawn) dłużej niż
 * `cv_retention_days`, a zgłoszenie jest WŁAŚCICIELEM pliku. Otwarty proces
 * nie traci CV bez względu na wiek.
 */
CREATE OR REPLACE FUNCTION public.career_cv_gc_scan(_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(_limit, 200), 1000));
  v_orphans integer := 0;
  v_retention integer := 0;
  v_fallback_grace integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(MAX(orphan_grace_hours), 24) INTO v_fallback_grace
    FROM public.career_settings;

  -- Wstępne odsianie po NAJKRÓTSZYM dopuszczalnym oknie łaski (CHECK pilnuje
  -- minimum 1 godziny). Dokładne, per-najemcę okno stosujemy niżej.
  WITH candidate AS (
    SELECT o.name AS object_path,
           public.career_cv_path_tenant(o.name) AS path_tenant,
           o.created_at
      FROM storage.objects o
     WHERE o.bucket_id = 'career-cv'
       AND o.created_at < now() - interval '1 hour'
       AND NOT EXISTS (
         SELECT 1 FROM public.career_cv_gc_queue q WHERE q.path = o.name
       )
  ), unreferenced AS (
    SELECT c.*
      FROM candidate c
     WHERE NOT EXISTS (
       SELECT 1 FROM public.contact_messages m
        WHERE m.custom ? 'cv_path'
          AND m.custom ->> 'cv_path' = c.object_path
          AND (c.path_tenant IS NULL OR m.tenant_id = c.path_tenant)
     )
  ), resolved AS (
    SELECT u.object_path,
           u.created_at,
           t.id AS tenant_id,
           COALESCE(s.orphan_grace_hours, v_fallback_grace) AS grace_hours
      FROM unreferenced u
      LEFT JOIN public.tenants t ON t.id = u.path_tenant
      LEFT JOIN public.career_settings s ON s.tenant_id = t.id
  )
  INSERT INTO public.career_cv_gc_queue (tenant_id, path, reason)
  SELECT r.tenant_id, r.object_path, 'orphan'
    FROM resolved r
   WHERE r.created_at < now() - make_interval(hours => r.grace_hours)
   ORDER BY r.created_at
   LIMIT v_limit
  ON CONFLICT (path) DO NOTHING;
  GET DIAGNOSTICS v_orphans = ROW_COUNT;

  WITH expired AS (
    SELECT m.tenant_id,
           m.custom ->> 'cv_path' AS object_path,
           a.stage_changed_at
      FROM public.career_applications a
      JOIN public.contact_messages m ON m.id = a.message_id
      LEFT JOIN public.career_settings s ON s.tenant_id = m.tenant_id
     WHERE a.stage IN ('hired', 'rejected', 'withdrawn')
       AND NULLIF(btrim(COALESCE(m.custom ->> 'cv_path', '')), '') IS NOT NULL
       AND a.stage_changed_at
             < now() - make_interval(days => COALESCE(s.cv_retention_days, 365))
       AND NOT EXISTS (
         SELECT 1 FROM public.career_cv_gc_queue q
          WHERE q.path = m.custom ->> 'cv_path'
       )
       AND public.career_cv_object_owner(m.custom ->> 'cv_path') = m.tenant_id
  )
  INSERT INTO public.career_cv_gc_queue (tenant_id, path, reason)
  SELECT e.tenant_id, e.object_path, 'retention'
    FROM expired e
   ORDER BY e.stage_changed_at
   LIMIT v_limit
  ON CONFLICT (path) DO NOTHING;
  GET DIAGNOSTICS v_retention = ROW_COUNT;

  RETURN jsonb_build_object('orphans', v_orphans, 'retention', v_retention);
END $$;
