-- ============================================================================
-- FINDING (audyt modulu 19): `admin_get_user_consent/1` byla JEDYNA bramka
-- adminowa modulu RODO bez zakresu najemcy.
--
-- Stan zastany (20260715214120): funkcja czytala `profiles.prefs->'consent'`
-- po samym `p.id = _user_id`, a autoryzowala wylacznie rola
-- (`has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin')`).
-- `has_role` jest zakresowany `current_tenant_id()`, wiec admin najemcy A
-- przechodzil bramke roli WE WLASNYM obszarze, a nastepnie odczytywal lustro
-- CMP (kategorie zgod, wersja, znacznik czasu) uzytkownika najemcy B - funkcja
-- jest SECURITY DEFINER, wiec RLS na `profiles` tego nie zatrzymywala. Snapshot
-- autoryzacji raportowal to jako `tenantRef: "none"`.
--
-- Poprawka wiaze CZYTANY WIERSZ z najemca domowym wolajacego, tak jak robia to
-- blizniacze bramki adminowe na `profiles` (`admin_update_user_avatar`,
-- `change_user_role`). Brak kontekstu najemcy daje `current_tenant_id() = NULL`,
-- czyli pusty zbior i `NULL` w zwrotce - bramka jest fail-closed.
--
-- Rejestr dowodow zgody (`user_consents`, `user_consent_events`) NIE jest tu
-- ruszany: granty i polityki zapisu dla rol klienckich zdjela migracja
-- 20260803190927, a zapis idzie wylacznie przez SECURITY DEFINER
-- `set_user_consent` (sam ustala `user_id`, `tenant_id` i znaczniki czasu).
-- Regresje pilnuja `supabase/tests/consent_evidence_hardening_test.sql` oraz
-- lista PROTECTED_INTAKE_TABLES w `scripts/check-sql-anon-insert.ts`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_user_consent(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (p.prefs->'consent')
  FROM public.profiles p
  WHERE p.id = _user_id
    AND p.tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    );
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_consent(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_user_consent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_user_consent(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_get_user_consent(uuid) IS
  'Lustro CMP (profiles.prefs->consent) uzytkownika dla panelu admina. Najemca pochodzi z current_tenant_id() (profil wolajacego), nie z parametru - admin czyta wylacznie wlasny obszar roboczy.';
