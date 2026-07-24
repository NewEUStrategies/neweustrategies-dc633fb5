-- ============================================================================
-- HARDENING (izolacja tenanta): user_bookmarks - dopięcie polityk RLS do
-- tenanta wołającego.
--
-- Stan wyjściowy: tabela ma `tenant_id uuid NOT NULL DEFAULT current_tenant_id()`,
-- ale polityki "bookmarks owner *" bramkowały wyłącznie po `user_id = auth.uid()`.
-- Ponieważ użytkownik ma jeden tenant domowy, a wiersze i tak dostają tenant_id
-- z DEFAULT current_tenant_id(), nie jest to aktywny wyciek. Jest to jednak luka
-- w dyscyplinie izolacji tenanta obowiązującej na całej platformie: per-userowy
-- wiersz powinien być czytelny/zapisywalny TYLKO w kontekście tenanta właściciela.
--
-- Zmiana dodaje `AND tenant_id = current_tenant_id()` do SELECT/INSERT/DELETE.
-- Bezpieczeństwo dla istniejących danych: wszystkie zakładki użytkownika mają
-- tenant_id = jego tenant domowy = current_tenant_id(), więc klauzula nie ukrywa
-- żadnego legalnego wiersza; INSERT bez tenant_id nadal przechodzi (DEFAULT
-- wypełnia poprawną wartość, WITH CHECK ją akceptuje). Blokuje natomiast odczyt
-- i zapis wierszy przypisanych do innego tenanta.
--
-- Regresję pilnuje supabase/tests/user_bookmarks_tenant_isolation_test.sql.
-- ============================================================================

DROP POLICY IF EXISTS "bookmarks owner select" ON public.user_bookmarks;
CREATE POLICY "bookmarks owner select" ON public.user_bookmarks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "bookmarks owner insert" ON public.user_bookmarks;
CREATE POLICY "bookmarks owner insert" ON public.user_bookmarks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "bookmarks owner delete" ON public.user_bookmarks;
CREATE POLICY "bookmarks owner delete" ON public.user_bookmarks
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.current_tenant_id());
