-- Eksport RODO: sekcja `user_reports_filed` (zgloszenia zlozone PRZEZ wolajacego).
--
-- PRZYCZYNA. `src/lib/profile/export.functions.ts` czytal `public.user_reports`
-- klientem uzytkownika (rola `authenticated`): `.from("user_reports")`
-- z filtrem `reporter_id = userId`. Tabela jest RPC-only - 20260717162432
-- i 20260717170000_connections_v2 robia `REVOKE ALL ... FROM PUBLIC, anon,
-- authenticated` - wiec polityka RLS `user_reports_self_read` (20260725181005,
-- zawezona do najemcy w 20260730085737) nie ma kogo wpuszczac: brak grantu
-- tabelarycznego konczy zapytanie kodem 42501, zanim RLS zostanie oceniony.
-- Kazdy eksport niosl wiec `errors.user_reports_filed = permission denied for
-- table user_reports` i `manifest.failed = [user_reports_filed]`.
--
-- DLACZEGO FUNKCJA, A NIE GRANT. Grant SELECT dla `authenticated` otworzylby
-- tabele RPC-only na dowolne zapytanie PostgREST, a tabela niesie kolumny
-- staffu (`resolution_note`, `resolved_by`): wiersze zawezalby RLS, kolumn -
-- nic. Funkcja oddaje DOKLADNIE siedem kolumn, ktore sekcja eksportu czytala
-- dotad, i nic poza nimi: bez notatki rozstrzygniecia i bez tozsamosci
-- rozstrzygajacego (dane staffu, art. 15 ust. 4 RODO).
--
-- ZAKRES. Osoba wylacznie z sesji (`auth.uid()`), nigdy z parametru; najemca
-- z profilu wolajacego - ten sam predykat co `admin_list_user_reports`
-- i `event_cfp_export_my_data`, i ten sam zakres, ktory deklarowala martwa
-- polityka `user_reports_self_read` (`auth.uid() = reporter_id AND tenant_id
-- = current_tenant_id()`). Sufit wierszy podaje aplikacja (EXPORT_ROW_LIMIT),
-- bramka 1..5000 stoi tutaj - jak w pozostalych funkcjach eksportu.
--
-- Bezpieczna do ponownego wykonania: CREATE OR REPLACE i granty bez zalozen
-- o stanie. Nie dotyka tabeli ani danych.

CREATE OR REPLACE FUNCTION public.user_reports_export_my_data(p_limit integer DEFAULT 2000)
RETURNS TABLE (
  id uuid,
  reported_id uuid,
  reason text,
  details text,
  status text,
  created_at timestamptz,
  resolved_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_limit integer := greatest(1, least(COALESCE(p_limit, 2000), 5000));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to export your data';
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: profile does not exist';
  END IF;

  RETURN QUERY
    SELECT r.id, r.reported_id, r.reason, r.details, r.status, r.created_at, r.resolved_at
      FROM public.user_reports r
     WHERE r.reporter_id = v_uid
       AND r.tenant_id = v_tenant
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.user_reports_export_my_data(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_reports_export_my_data(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.user_reports_export_my_data(integer) IS
  'Eksport RODO zgloszen uzytkownikow zlozonych przez WOLAJACEGO (sekcja user_reports_filed): id, zgloszony, powod, opis, status, daty. Bez notatki rozstrzygniecia i tozsamosci rozstrzygajacego (dane staffu). Osoba z auth.uid(), najemca z profilu wolajacego; tabela user_reports pozostaje RPC-only.';
