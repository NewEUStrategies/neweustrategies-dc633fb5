-- ============================================================================
-- site_settings: PK złożony (tenant_id, key) - odblokowanie multi-tenant
-- warstwy PREZENTACJI (P2; audyt 2026-07-13, rekomendacja P1 #7).
--
-- Tabela powstała z PK = key (singleton na całą platformę); migracja
-- 20260626162717 dodała tenant_id (NOT NULL DEFAULT public_tenant_id())
-- i tenant-RLS, ale klucz główny pozostał globalny - drugi najemca nie mógł
-- utrzymać własnego headera/footera/motywu. Po tej migracji każdy najemca ma
-- własny komplet wierszy ustawień.
--
-- Frontend: wszystkie upserty site_settings przechodzą na
-- onConflict: "tenant_id,key" (ta sama zmiana zestawu commitów). Istniejące
-- wiersze należą do najemcy domyślnego - dla instalacji single-tenant zmiana
-- jest przezroczysta.
--
-- Idempotentnie: przebudowa tylko, gdy PK nie zawiera jeszcze tenant_id.
-- ============================================================================

DO $$
DECLARE
  v_has_composite boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.site_settings'::regclass
       AND c.contype = 'p'
       AND a.attname = 'tenant_id'
  ) INTO v_has_composite;

  IF NOT v_has_composite THEN
    ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_pkey;
    ALTER TABLE public.site_settings
      ADD CONSTRAINT site_settings_pkey PRIMARY KEY (tenant_id, key);
  END IF;
END $$;
