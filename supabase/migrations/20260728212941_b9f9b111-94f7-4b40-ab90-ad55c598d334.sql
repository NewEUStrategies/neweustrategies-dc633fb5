-- 1) Fixed search_path for email queue helpers (SUPA_function_search_path_mutable)
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = pgmq, public, pg_temp;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = pgmq, public, pg_temp;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = pgmq, public, pg_temp;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = pgmq, public, pg_temp;

-- 2) expert_inmails: senders must not be able to forge outcome fields
--
-- Naprawa łańcucha migracji: tabela zapytań do eksperta ma w łańcuchu DWIE
-- nazwy. 20260723180000 (blok „expert_request_quota") robi
-- `ALTER TABLE expert_inmails RENAME TO expert_requests`, ale ta migracja
-- napisana jest jeszcze pod starą nazwą. Na produkcji pasowało, bo tamten blok
-- siedział w pliku o zdublowanej wersji i nigdy się nie wykonał (zrzut typów
-- wciąż zna tylko `expert_inmails`); na świeżej bazie zmiana nazwy JEST
-- stosowana i cztery polecenia niżej wywracały się z 42P01.
--
-- Nie rozstrzygamy tu, która nazwa jest kanoniczna - to decyzja o zmianie nazwy
-- tabeli na żywej produkcji, poza zakresem tej migracji. Zamiast tego celujemy
-- w tę tabelę, która faktycznie istnieje, żeby ta sama polityka bezpieczeństwa
-- powstała w obu światach. Polityki zdejmujemy przed założeniem (42710).
DO $expert_req$
DECLARE
  v_tbl text;
  v_pol text;
BEGIN
  SELECT c.relname INTO v_tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN ('expert_requests', 'expert_inmails')
   ORDER BY (c.relname = 'expert_requests') DESC
   LIMIT 1;

  IF v_tbl IS NULL THEN
    RAISE NOTICE 'expert_inmails/expert_requests nie istnieje - pomijam polityki';
    RETURN;
  END IF;

  FOREACH v_pol IN ARRAY ARRAY[
    'inmails: sender or admin may update',
    'inmails: sender may cancel own request',
    'inmails: recipient may respond',
    'inmails: admin may update'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol, v_tbl);
  END LOOP;

  EXECUTE format($ddl$
    CREATE POLICY %I ON public.%I
    FOR UPDATE TO authenticated
    USING (sender_id = auth.uid())
    WITH CHECK (sender_id = auth.uid())
  $ddl$, 'inmails: sender may cancel own request', v_tbl);

  EXECUTE format($ddl$
    CREATE POLICY %I ON public.%I
    FOR UPDATE TO authenticated
    USING (recipient_id = auth.uid())
    WITH CHECK (recipient_id = auth.uid())
  $ddl$, 'inmails: recipient may respond', v_tbl);

  EXECUTE format($ddl$
    CREATE POLICY %I ON public.%I
    FOR UPDATE TO authenticated
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()))
  $ddl$, 'inmails: admin may update', v_tbl);

  EXECUTE format(
    'DROP TRIGGER IF EXISTS expert_inmails_guard_update ON public.%I', v_tbl);
END $expert_req$;

-- Column-level enforcement (RLS cannot express it): senders may only cancel.
CREATE OR REPLACE FUNCTION public.expert_inmails_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR public.is_super_admin(uid) THEN
    RETURN NEW;
  END IF;

  -- Immutable identity/ownership columns for every non-admin actor.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'expert_inmails: immutable columns cannot be changed';
  END IF;

  IF uid = OLD.recipient_id THEN
    -- Recipient decides the outcome, but never writes admin notes.
    IF NEW.admin_note IS DISTINCT FROM OLD.admin_note THEN
      RAISE EXCEPTION 'expert_inmails: only admins can set admin_note';
    END IF;
    IF NEW.status NOT IN ('pending', 'approved', 'declined', 'answered') THEN
      RAISE EXCEPTION 'expert_inmails: invalid status transition for recipient';
    END IF;
    RETURN NEW;
  END IF;

  IF uid = OLD.sender_id THEN
    -- Sender may only withdraw their own pending request.
    IF NEW.admin_note IS DISTINCT FROM OLD.admin_note
       OR NEW.decline_reason IS DISTINCT FROM OLD.decline_reason
       OR NEW.converted_conversation_id IS DISTINCT FROM OLD.converted_conversation_id
       OR NEW.responded_at IS DISTINCT FROM OLD.responded_at
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.questions IS DISTINCT FROM OLD.questions
       OR NEW.expected_answers IS DISTINCT FROM OLD.expected_answers
       OR NEW.external_links IS DISTINCT FROM OLD.external_links THEN
      RAISE EXCEPTION 'expert_inmails: senders may only cancel their request';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'expert_inmails: senders may only cancel their request';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'expert_inmails: not allowed';
END;
$$;

-- Trigger zakładamy na tej samej tabeli, którą wyżej rozstrzygnął DO-blok.
DO $expert_req$
DECLARE
  v_tbl text;
BEGIN
  SELECT c.relname INTO v_tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN ('expert_requests', 'expert_inmails')
   ORDER BY (c.relname = 'expert_requests') DESC
   LIMIT 1;

  IF v_tbl IS NULL THEN
    RAISE NOTICE 'expert_inmails/expert_requests nie istnieje - pomijam trigger';
    RETURN;
  END IF;

  EXECUTE format(
    'DROP TRIGGER IF EXISTS expert_inmails_guard_update ON public.%I', v_tbl);
  EXECUTE format($ddl$
    CREATE TRIGGER expert_inmails_guard_update
    BEFORE UPDATE ON public.%I
    FOR EACH ROW EXECUTE FUNCTION public.expert_inmails_guard_update()
  $ddl$, v_tbl);
END $expert_req$;