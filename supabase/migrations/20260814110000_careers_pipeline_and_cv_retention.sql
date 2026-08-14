-- Rekrutacja: pipeline zgłoszeń + retencja plików CV.
--
-- STAN WYJŚCIOWY: zgłoszenie z /zatrudniamy żyło wyłącznie jako wiersz
-- `contact_messages` z dwoma znacznikami skrzynki (`read_at`, `archived_at`).
-- Nie było etapu procesu (screening / rozmowa / oferta / odrzucenie), nie było
-- właściciela, oceny ani śladu decyzji - a plik CV lądował w buckecie przy
-- WYBORZE pliku, czyli przed wysyłką formularza, więc porzucony kreator
-- zostawiał osierocony plik z danymi osobowymi na zawsze.
--
-- Dwie rzeczy, jedna migracja, bo retencja karmi się pipeline'em: to `stage`
-- decyduje, kiedy CV przestaje być potrzebne, a nie sam wiek pliku.
--
-- PODZIAŁ ODPOWIEDZIALNOŚCI RETENCJI: SQL DECYDUJE (co skasować), job
-- service-role WYKONUJE (storage.remove). Nie da się usunąć obiektu z magazynu
-- instrukcją SQL - DELETE z `storage.objects` zostawia plik w koszu magazynu.
-- Dlatego SQL wypełnia kolejkę `career_cv_gc_queue`, a job ją drenuje.

-- ---------------------------------------------------------------------------
-- A) Etapy procesu
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE public.career_stage AS ENUM (
    'new', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.career_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Źródłem prawdy o TREŚCI zgłoszenia zostaje `contact_messages` (to tam idzie
  -- publiczny zapis, rate-limit i polityka pól). Ta tabela dokłada wyłącznie
  -- warstwę procesu, więc kasowanie zgłoszenia kasuje i jego pipeline.
  message_id uuid NOT NULL UNIQUE REFERENCES public.contact_messages(id) ON DELETE CASCADE,
  stage public.career_stage NOT NULL DEFAULT 'new',
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  /**
   * Notatka do OSTATNIEJ zmiany etapu. Klient ustawia ją w tym samym UPDATE, co
   * `stage`, a trigger przepisuje ją do wpisu w dzienniku - dzięki temu audyt
   * powstaje także przy zwykłym `.update()` z panelu, bez osobnego RPC.
   */
  stage_note text NOT NULL DEFAULT '',
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rating smallint CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  rejection_reason text NOT NULL DEFAULT '',
  next_step_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.career_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  application_id uuid NOT NULL
    REFERENCES public.career_applications(id) ON DELETE CASCADE,
  from_stage public.career_stage,
  to_stage public.career_stage NOT NULL,
  note text NOT NULL DEFAULT '',
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS career_applications_tenant_stage_idx
  ON public.career_applications (tenant_id, stage, stage_changed_at DESC);
CREATE INDEX IF NOT EXISTS career_applications_owner_idx
  ON public.career_applications (owner_id)
  WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS career_application_events_app_idx
  ON public.career_application_events (application_id, created_at DESC);

ALTER TABLE public.career_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_application_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.career_applications TO authenticated;
GRANT ALL ON public.career_applications TO service_role;
GRANT SELECT ON public.career_application_events TO authenticated;
GRANT ALL ON public.career_application_events TO service_role;

DROP POLICY IF EXISTS career_applications_staff_read ON public.career_applications;
CREATE POLICY career_applications_staff_read ON public.career_applications
  FOR SELECT TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS career_applications_staff_update ON public.career_applications;
CREATE POLICY career_applications_staff_update ON public.career_applications
  FOR UPDATE TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_staff() AND tenant_id = public.current_tenant_id());

-- Wiersz pipeline'u zakłada TRIGGER przy wpływie zgłoszenia (SECURITY DEFINER,
-- omija RLS), więc rola kliencka nie potrzebuje INSERT-u. Zostaje jednak DELETE
-- dla admina, który usuwa zgłoszenie razem z procesem.
DROP POLICY IF EXISTS career_applications_admin_delete ON public.career_applications;
CREATE POLICY career_applications_admin_delete ON public.career_applications
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

-- Dziennik jest TYLKO do czytania dla klienta: wpisy tworzy trigger, więc nikt
-- nie dopisze ani nie wyczyści historii decyzji z panelu.
DROP POLICY IF EXISTS career_application_events_staff_read ON public.career_application_events;
CREATE POLICY career_application_events_staff_read ON public.career_application_events
  FOR SELECT TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- B) Bootstrap pipeline'u + audyt zmian etapu
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.career_application_bootstrap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.form_id, '') <> 'careers' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.career_applications (tenant_id, message_id)
  VALUES (NEW.tenant_id, NEW.id)
  ON CONFLICT (message_id) DO NOTHING;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.career_application_bootstrap() IS
  'Kazde zgloszenie z /zatrudniamy dostaje wiersz pipeline w etapie new. Dzieki temu skrzynka nie musi tworzyc wiersza leniwie przy pierwszym otwarciu (co gubi zgloszenia, ktorych nikt nie otworzyl).';

DROP TRIGGER IF EXISTS trg_contact_messages_career_pipeline ON public.contact_messages;
CREATE TRIGGER trg_contact_messages_career_pipeline
  AFTER INSERT ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.career_application_bootstrap();

-- Backfill dla zgłoszeń sprzed tej migracji.
INSERT INTO public.career_applications (tenant_id, message_id, created_at)
SELECT m.tenant_id, m.id, m.created_at
  FROM public.contact_messages m
 WHERE m.form_id = 'careers'
ON CONFLICT (message_id) DO NOTHING;

-- Zgłoszenia zarchiwizowane przed wprowadzeniem etapów traktujemy jako
-- domknięte - inaczej cała historia wpadłaby do kolejki "Nowe".
UPDATE public.career_applications a
   SET stage = 'rejected',
       stage_changed_at = COALESCE(m.archived_at, a.stage_changed_at)
  FROM public.contact_messages m
 WHERE m.id = a.message_id
   AND m.archived_at IS NOT NULL
   AND a.stage = 'new';

CREATE OR REPLACE FUNCTION public.career_application_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Przypięcie wiersza: ani tenant, ani zgłoszenie nie mogą się zmienić
  -- UPDATE-em z panelu (to byłoby przeniesienie procesu do innego najemcy).
  NEW.tenant_id := OLD.tenant_id;
  NEW.message_id := OLD.message_id;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_career_applications_touch ON public.career_applications;
CREATE TRIGGER trg_career_applications_touch
  BEFORE UPDATE ON public.career_applications
  FOR EACH ROW EXECUTE FUNCTION public.career_application_touch();

CREATE OR REPLACE FUNCTION public.career_application_log_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.career_application_events (
    tenant_id, application_id, from_stage, to_stage, note, actor_id
  ) VALUES (
    NEW.tenant_id, NEW.id, OLD.stage, NEW.stage,
    left(btrim(COALESCE(NEW.stage_note, '')), 2000),
    auth.uid()
  );
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.career_application_log_stage() IS
  'Dziennik etapow powstaje w triggerze, nie w RPC - kazda sciezka zapisu (panel, RPC, service_role) zostawia slad, wiec audytu nie da sie ominac.';

DROP TRIGGER IF EXISTS trg_career_applications_log_stage ON public.career_applications;
CREATE TRIGGER trg_career_applications_log_stage
  AFTER UPDATE ON public.career_applications
  FOR EACH ROW EXECUTE FUNCTION public.career_application_log_stage();

-- ---------------------------------------------------------------------------
-- C) Ustawienia retencji (per najemca)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.career_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  /**
   * Ile dni od DOMKNIĘCIA procesu trzymamy plik CV. Domyślne 365 dni to typowy
   * okres, w którym rekruter wraca do odrzuconego kandydata; wartość jest
   * konfigurowalna, bo to decyzja RODO, a nie techniczna.
   */
  cv_retention_days integer NOT NULL DEFAULT 365
    CHECK (cv_retention_days BETWEEN 1 AND 3650),
  /**
   * Okno łaski dla pliku bez zgłoszenia. Plik ląduje w buckecie przy WYBORZE,
   * więc kandydat, który wypełnia kreator pół godziny, nie może stracić CV -
   * ale porzucony kreator nie może zostawić go na zawsze.
   */
  orphan_grace_hours integer NOT NULL DEFAULT 24
    CHECK (orphan_grace_hours BETWEEN 1 AND 720),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.career_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.career_settings TO authenticated;
GRANT ALL ON public.career_settings TO service_role;

DROP POLICY IF EXISTS career_settings_staff_read ON public.career_settings;
CREATE POLICY career_settings_staff_read ON public.career_settings
  FOR SELECT TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS career_settings_admin_write ON public.career_settings;
CREATE POLICY career_settings_admin_write ON public.career_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

DROP POLICY IF EXISTS career_settings_admin_update ON public.career_settings;
CREATE POLICY career_settings_admin_update ON public.career_settings
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

DROP TRIGGER IF EXISTS trg_career_settings_touch ON public.career_settings;
CREATE TRIGGER trg_career_settings_touch BEFORE UPDATE ON public.career_settings
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- D) Kolejka usunięć plików CV
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.career_cv_gc_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  /** Ścieżka w buckecie `career-cv` - unikalna, bo kasujemy raz. */
  path text NOT NULL UNIQUE,
  reason text NOT NULL
    CHECK (reason IN ('orphan', 'application_deleted', 'retention')),
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  claimed_at timestamptz
);

CREATE INDEX IF NOT EXISTS career_cv_gc_queue_claim_idx
  ON public.career_cv_gc_queue (enqueued_at)
  WHERE attempts < 5;

ALTER TABLE public.career_cv_gc_queue ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.career_cv_gc_queue TO service_role;
GRANT SELECT ON public.career_cv_gc_queue TO authenticated;

-- Kolejka jest infrastrukturą joba: klient jej NIE zapisuje (żadna polityka
-- INSERT/UPDATE/DELETE dla roli klienckiej), a personel może ją tylko podejrzeć,
-- żeby panel mógł pokazać zaległości.
DROP POLICY IF EXISTS career_cv_gc_queue_staff_read ON public.career_cv_gc_queue;
CREATE POLICY career_cv_gc_queue_staff_read ON public.career_cv_gc_queue
  FOR SELECT TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id());

/**
 * Usunięcie zgłoszenia zabiera jego CV. Trigger jest na `contact_messages`, bo
 * to jedyna tabela, która zna ścieżkę pliku - `career_applications` pada razem
 * z nią przez ON DELETE CASCADE i w AFTER DELETE nie miałaby już czego czytać.
 */
CREATE OR REPLACE FUNCTION public.career_cv_enqueue_on_message_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path text := NULLIF(btrim(COALESCE(OLD.custom ->> 'cv_path', '')), '');
BEGIN
  IF COALESCE(OLD.form_id, '') <> 'careers' OR v_path IS NULL THEN
    RETURN OLD;
  END IF;
  INSERT INTO public.career_cv_gc_queue (tenant_id, path, reason)
  VALUES (OLD.tenant_id, v_path, 'application_deleted')
  ON CONFLICT (path) DO NOTHING;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_contact_messages_career_cv_gc ON public.contact_messages;
CREATE TRIGGER trg_contact_messages_career_cv_gc
  AFTER DELETE ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.career_cv_enqueue_on_message_delete();

/**
 * Skan: dokłada do kolejki pliki osierocone i pliki po okresie retencji.
 *
 * OSIEROCONE - obiekt w buckecie, na który nie powołuje się żadne zgłoszenie
 * i który jest starszy niż okno łaski najemcy. Tenanta odczytujemy z pierwszego
 * segmentu ścieżki (nowa konwencja); dla plików legacy (`uploads/...`) tenant
 * jest nieznany, więc bierzemy okno najbardziej konserwatywne (MAX z ustawień),
 * żeby nie skasować pliku, którego zgłoszenie jest jeszcze w trakcie wysyłki.
 *
 * PO RETENCJI - proces jest domknięty (hired / rejected / withdrawn), a od
 * domknięcia minęło `cv_retention_days`. Otwarty proces NIE traci CV bez
 * względu na wiek: rekrutacja potrafi stać miesiącami, a plik jest wtedy nadal
 * potrzebny do pracy.
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
  -- minimum 1 godziny). Dokładne, per-najemcę okno stosujemy niżej - tenant jest
  -- znany dopiero po rozbiciu ścieżki, a plik legacy nie nosi go wcale.
  WITH candidate AS (
    SELECT o.name AS object_path,
           NULLIF((storage.foldername(o.name))[1], '') AS tenant_text,
           o.created_at
      FROM storage.objects o
     WHERE o.bucket_id = 'career-cv'
       AND o.created_at < now() - interval '1 hour'
       AND NOT EXISTS (
         SELECT 1 FROM public.contact_messages m
          WHERE m.custom ->> 'cv_path' = o.name
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.career_cv_gc_queue q WHERE q.path = o.name
       )
  ), resolved AS (
    SELECT c.object_path,
           c.created_at,
           t.id AS tenant_id,
           COALESCE(s.orphan_grace_hours, v_fallback_grace) AS grace_hours
      FROM candidate c
      LEFT JOIN public.tenants t
             ON c.tenant_text ~ '^[0-9a-fA-F-]{36}$'
            AND t.id = c.tenant_text::uuid
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

/**
 * Wydaje jobowi partię ścieżek do usunięcia. `SKIP LOCKED` pozwala dwóm tickom
 * biec równolegle bez kasowania tego samego pliku dwa razy; `attempts` zamyka
 * pętlę na ścieżce, której magazyn trwale nie przyjmuje.
 */
-- Zwraca jsonb, nie TABLE: nazwy kolumn kolejki (`path`, `reason`, `attempts`)
-- kolidowałyby z nazwami parametrów OUT w ciele plpgsql.
CREATE OR REPLACE FUNCTION public.career_cv_gc_claim(_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(_limit, 50), 200));
  v_out jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH batch AS (
    SELECT q.id
      FROM public.career_cv_gc_queue q
     WHERE q.attempts < 5
       AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '10 minutes')
     ORDER BY q.enqueued_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.career_cv_gc_queue q
       SET attempts = q.attempts + 1,
           claimed_at = now()
     WHERE q.id IN (SELECT b.id FROM batch b)
    RETURNING q.path, q.reason, q.attempts
  )
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object(
             'path', c.path, 'reason', c.reason, 'attempts', c.attempts
           )),
           '[]'::jsonb
         )
    INTO v_out
    FROM claimed c;

  RETURN v_out;
END $$;

/**
 * Domyka partię: zdejmuje ścieżki z kolejki i - co ważniejsze - ZDEJMUJE JE ZE
 * ZGŁOSZENIA. Bez tego panel dalej pokazywałby przycisk „Otwórz CV" celujący w
 * plik, którego już nie ma. `cv_purged_at` zostaje jako ślad, żeby operator
 * widział „CV usunięte (retencja)", a nie „Brak CV".
 */
CREATE OR REPLACE FUNCTION public.career_cv_gc_done(_paths text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _paths IS NULL OR array_length(_paths, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.contact_messages m
     SET custom = (m.custom - 'cv_path' - 'cv_file_name')
                  || jsonb_build_object('cv_purged_at', to_char(now(), 'YYYY-MM-DD')),
         updated_at = now()
   WHERE m.custom ->> 'cv_path' = ANY (_paths);

  DELETE FROM public.career_cv_gc_queue WHERE path = ANY (_paths);
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END $$;

CREATE OR REPLACE FUNCTION public.career_cv_gc_fail(_path text, _error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.career_cv_gc_queue
     SET last_error = left(COALESCE(_error, ''), 500),
         claimed_at = NULL
   WHERE path = _path;
END $$;

REVOKE ALL ON FUNCTION public.career_cv_gc_scan(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.career_cv_gc_claim(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.career_cv_gc_done(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.career_cv_gc_fail(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.career_cv_gc_scan(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_cv_gc_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_cv_gc_done(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_cv_gc_fail(text, text) TO service_role;

COMMENT ON TABLE public.career_cv_gc_queue IS
  'Kolejka usuniec plikow CV. SQL decyduje (career_cv_gc_scan), job service-role wykonuje storage.remove - instrukcja SQL nie usuwa obiektu z magazynu.';
