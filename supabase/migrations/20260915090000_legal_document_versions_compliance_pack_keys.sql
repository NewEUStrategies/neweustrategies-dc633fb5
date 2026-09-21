-- Rozszerzenie katalogu dokumentów prawnych o pakiet zgodności 2026-09.
--
-- PO CO TA MIGRACJA. `legal_document_versions.doc_key` ma CHECK dopuszczający
-- wyłącznie 'terms', 'privacy' i 'refunds'. Dopisanie nowych kluczy w kodzie
-- (src/lib/legal/types.ts) NIE wystarcza: publiczna strona renderuje wtedy
-- treść bazową z kodu, ale redakcja nie może zapisać ani opublikować wersji
-- z panelu - INSERT odbija się o CHECK błędem 23514. Efekt jest mylący, bo
-- strona działa i wygląda na kompletną, a wersjonowanie po cichu nie działa.
--
-- DLACZEGO NAZWA WIĘZU JEST WYSZUKIWANA, A NIE WPISANA. Więz powstał jako
-- CHECK inline w CREATE TABLE, więc nosi nazwę nadaną przez PostgreSQL
-- ('legal_document_versions_doc_key_check'). Poleganie na tej konwencji
-- wywróciłoby migrację na bazie, gdzie tabela powstała z innego zrzutu -
-- dlatego zdejmujemy KAŻDY więz typu CHECK stojący na tej kolumnie, po czym
-- zakładamy własny, jawnie nazwany.

DO $$
DECLARE
  v_constraint text;
BEGIN
  FOR v_constraint IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'legal_document_versions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%doc_key%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.legal_document_versions DROP CONSTRAINT %I',
      v_constraint
    );
  END LOOP;
END
$$;

ALTER TABLE public.legal_document_versions
  ADD CONSTRAINT legal_document_versions_doc_key_allowed
  CHECK (
    doc_key IN (
      -- Dokumenty istniejące przed pakietem zgodności.
      'terms',
      'privacy',
      'refunds',
      -- Pakiet zgodności 2026-09. Kolejność odpowiada rejestrowi
      -- w src/lib/legal/registry.ts.
      'subscriptions',
      'rodo',
      'privacy_governance',
      'data_processing',
      'communications',
      'clubs',
      'moderation',
      'events',
      'ai_transparency',
      'statute'
    )
  );

COMMENT ON CONSTRAINT legal_document_versions_doc_key_allowed
  ON public.legal_document_versions IS
  'Lustro LEGAL_DOC_KEYS z src/lib/legal/types.ts. Nowy dokument prawny = wpis tutaj ORAZ w rejestrze w kodzie.';
