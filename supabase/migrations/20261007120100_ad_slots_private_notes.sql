-- ============================================================================
-- REKLAMY: NOTATKI OPERATORA `ad_slots.notes` POZA ZASIEGIEM ANONA I CZYTELNIKA.
--
-- DEFEKT (szew TypeScript <-> SQL, audyt ed13 D-14-3, R264). Od utworzenia
-- tabeli (20260624165807:25-26) `anon` i `authenticated` maja SELECT na CALEJ
-- tabeli, a polityka „Public can read active ad_slots" (20260703052115:24-30)
-- wpuszcza kazdy aktywny slot najemcy hosta bez ograniczenia kolumn. Naprawa
-- R203 zyla wylacznie po stronie aplikacji: `PUBLIC_AD_SLOT_COLUMNS`
-- (`src/lib/ads/types.ts`) i typ `PublicAdSlot = Omit<AdSlot, "notes">`
-- pilnuja zapytan frontu, a test atrapy sprawdza, ze lista nie zawiera
-- `notes` - ale bezposrednie `GET /rest/v1/ad_slots?select=notes` z kluczem
-- publicznym nadal oddawalo notatki operatora (warunki umowy, kontakt do
-- reklamodawcy) kazdemu gosciowi.
--
-- ZMIANA (wzorzec 20260803191905 dla `events.join_url`):
--   1. SELECT kolumnowy dla `anon` i `authenticated`: wszystko poza `notes`.
--      GRANT tabelowy spelnia sprawdzenie uprawnien dla KAZDEJ kolumny, wiec
--      sam REVOKE (notes) bylby no-opem - stad REVOKE tabelowy i lista.
--      Lista = `PUBLIC_AD_SLOT_COLUMNS`; rownosc obu pilnuje kontrakt
--      `supabase/tests/ts_sql_contract_test.sql` (sekcja „kolumny publiczne").
--   2. `admin_list_ad_slots()` - pelne wiersze (z `notes`) dla panelu reklam.
--      Ten sam predykat co polityka „Admins/editors manage ad_slots in tenant":
--      najemca z `current_tenant_id()` i rola admin albo editor. Odmowa to
--      42501, nie pusta lista - panel nie moze pokazac „brak slotow"
--      zamiast „brak uprawnien".
--   INSERT/UPDATE/DELETE zostaja tabelowe: zapis `notes` przez panel dalej
--   idzie przez polityke redakcji, a supabase-js bez `.select()` nie robi
--   RETURNING (Prefer: return=minimal), wiec zapis nie potrzebuje SELECT notes.
--
-- KOLEJNOSC WDROZENIA: dowolna. Panel slotow czyta przez `fetchAdminAdSlots`
-- (`src/lib/ads/adminSlots.ts`), ktory przed ta migracja (PGRST202) wraca do
-- `select("*")`; statystyki i lista slotow w zakladce pozycji czytaja kolumny
-- publiczne w obu stanach bazy.
--
-- IDEMPOTENTNA: REVOKE/GRANT bezstanowe, CREATE OR REPLACE.
-- ============================================================================

REVOKE SELECT ON public.ad_slots FROM anon, authenticated;
GRANT SELECT (
  id,
  tenant_id,
  name,
  kind,
  status,
  html,
  script,
  image_url,
  image_link,
  image_alt,
  width,
  height,
  requires_consent,
  targeting,
  created_at,
  updated_at
) ON public.ad_slots TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_ad_slots()
RETURNS SETOF public.ad_slots
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL
     OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
             OR public.has_role(v_uid, 'editor'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden: ad slots are managed by admins and editors'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.*
  FROM public.ad_slots s
  WHERE s.tenant_id = v_tenant
  ORDER BY s.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_ad_slots() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_ad_slots() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_list_ad_slots() IS
  'Panel reklam: pelne wiersze ad_slots najemcy (z notatkami operatora notes, ktorych anon i authenticated nie czytaja wprost). Predykat polityki redakcji: current_tenant_id() i rola admin albo editor; odmowa 42501.';
