-- ============================================================================
-- P0 - REGRESJA CROSS-TENANT: przywrócenie hardeningu get_chat_peers.
--
-- KONTEKST: 20260712190000_chat_privacy_tenant_hardening.sql nadała RPC
-- get_chat_peers pełny kontrakt prywatności: filtr tenanta obejmujący OBIE
-- gałęzie widoczności (discoverable + wspólna konwersacja), guard
-- auth.uid() IS NOT NULL, limit rozmiaru wejścia 1-200 oraz REVOKE dla
-- PUBLIC/anon. Migracje z 21.07 (20260721211451 + duplikat 20260721211552),
-- dodając kolumnę slug przez DROP FUNCTION + CREATE, odtworzyły funkcję
-- z ciałem SPRZED hardeningu:
--
--   1. zniknął filtr tenanta - user tenanta B enumerował po UUID profile
--      discoverable tenanta A (imię, avatar, stanowisko, firma, slug),
--      a legacy cross-tenant wiersz członkostwa ujawniał nawet profile
--      NIE-discoverable (pgTAP chat_privacy_isolation_test: czerwony);
--   2. zniknął guard auth.uid() i limit cardinality (nieograniczona tablica
--      wejściowa = darmowy skan profili);
--   3. DROP/CREATE przywrócił domyślne ACL (EXECUTE dla anon) - tę połowę
--      domknęła zbiorcza 20260725181430, ciało pozostało dziurawe.
--
-- TERAZ: ciało hardeningu z 12.07 + kolumna slug z 21.07. Kontrakt frontendu
-- bez zmian (src/lib/chat/useConversations.ts opisuje dokładnie te reguły;
-- src/integrations/supabase/types.ts ma już slug w zwrotce).
--
-- LEKCJA (przyczyna źródłowa): po DROP/CREATE funkcji SECURITY DEFINER
-- REVOKE/GRANT ponawiamy ZAWSZE w tej samej transakcji, a zmiana zwrotki
-- nigdy nie startuje od kopii ciała starszej niż ostatni hardening.
-- Anty-regresyjnie: pgTAP przypina filtr tenanta, guard, limit wejścia,
-- brak EXECUTE dla anon oraz obecność kolumny slug.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_chat_peers(uuid[]);

CREATE FUNCTION public.get_chat_peers(p_user_ids uuid[])
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  slug text,
  job_title text,
  current_company text,
  specialization text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.avatar_url, p.slug, p.job_title, p.current_company, p.specialization
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND cardinality(p_user_ids) BETWEEN 1 AND 200
    AND p.id = ANY (p_user_ids)
    AND (
      p.id = auth.uid()
      OR (
        -- Filtr tenanta obejmuje OBIE gałęzie: discoverable ORAZ wspólną
        -- konwersację (legacy cross-tenant członkostwo nie ujawnia profilu
        -- spoza tenanta wołającego).
        p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
        AND (
          p.discoverable = true
          OR EXISTS (
            SELECT 1
            FROM public.conversation_participants me
            JOIN public.conversation_participants them
              ON them.conversation_id = me.conversation_id
            WHERE me.user_id = auth.uid()
              AND them.user_id = p.id
          )
        )
      )
    );
$$;

COMMENT ON FUNCTION public.get_chat_peers(uuid[]) IS
  'Bezpieczne karty profili dla czatu: wołający, discoverable peers z jego tenanta oraz współuczestnicy konwersacji w jego tenancie. Wejście 1-200 id. Po DROP/CREATE zawsze ponawiać REVOKE (PUBLIC, anon) - patrz regresja z 21.07.';

-- DROP/CREATE nadaje domyślne ACL Supabase (EXECUTE m.in. dla anon) - REVOKE
-- w tej samej transakcji zamyka okno i utrzymuje stan wymagany przez audyt.
REVOKE EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_peers(uuid[]) TO authenticated, service_role;
