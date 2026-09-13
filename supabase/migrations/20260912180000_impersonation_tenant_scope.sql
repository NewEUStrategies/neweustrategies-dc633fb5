-- ZAWĘŻENIE DZIENNIKA PODSZYĆ DO NAJEMCY.
--
-- PO CO. Polityka `super_admin_read_impersonation` (20260628214246) mówiła
-- wyłącznie „wołający jest super adminem", nie zawężając WIERSZY po najemcy.
-- `is_super_admin()` jest tenantowe (`tenant_id = current_tenant_id()`, od
-- 20260824074231), ale bada TYLKO rolę wołającego - nie ma jak ograniczyć tego,
-- co zwraca zapytanie. Efekt: super admin dowolnego najemcy czytał
-- `actor_user_id`, `target_user_id`, `reason`, `ip` i `user_agent` WSZYSTKICH
-- podszyć na platformie, czyli dziennik operacji cudzych organizacji.
--
-- Wiersz audytu nosi już najemcę operacji (handler `startImpersonation`
-- wpisuje `tenant_id` aktora, po sprawdzeniu, że cel należy do tego samego
-- najemcy), więc zawężenie nie wymaga nowej kolumny - wystarczy, żeby polityka
-- z tego najemcy skorzystała.

-- WIERSZE HISTORYCZNE. Do dziś `tenant_id` był tylko ETYKIETĄ wiersza i
-- zapisywał się jako `NULL`, gdy odczyt profilu aktora padł albo profilu nie
-- było. Backfill z profilu AKTORA jest tu jedynym uczciwym źródłem: wiersz
-- dokumentuje operację super admina, a ten działał we własnym najemcy (inaczej
-- `is_super_admin()` w ogóle by go nie przepuściło). Dopisanie `OR tenant_id IS
-- NULL` do polityki byłoby tańsze, ale zostawiłoby na stałe furtkę „wiersz bez
-- najemcy widzi każdy super admin" - dokładnie tę klasę, którą ta migracja
-- zamyka.
UPDATE public.impersonation_sessions AS s
   SET tenant_id = p.tenant_id
  FROM public.profiles AS p
 WHERE p.id = s.actor_user_id
   AND s.tenant_id IS NULL;

-- Reszta wierszy bez najemcy (aktor usunięty razem z profilem) zostaje
-- świadomie NIEWIDOCZNA dla ról klienckich: ślad nie znika - czyta go
-- `service_role` - ale nie da się go przypisać do najemcy, więc nie ma najemcy,
-- któremu wolno go pokazać. Fail closed, nie „pokaż wszystkim".

DROP POLICY IF EXISTS "super_admin_read_impersonation" ON public.impersonation_sessions;

-- `(select ...)` wokół wywołań: InitPlan liczy je RAZ na zapytanie, a nie raz
-- na wiersz dziennika.
CREATE POLICY "super_admin_read_impersonation"
  ON public.impersonation_sessions
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = (select public.current_tenant_id())
    AND (select public.is_super_admin())
  );

-- Indeks pod nowy predykat: polityka filtruje teraz po `tenant_id`, a dziennik
-- rośnie liniowo z liczbą podszyć na całej platformie.
CREATE INDEX IF NOT EXISTS idx_impersonation_tenant
  ON public.impersonation_sessions(tenant_id, started_at DESC);
