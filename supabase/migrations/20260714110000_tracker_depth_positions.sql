-- ============================================================================
-- Tracker UE - pogłębienie danych strukturalnych + stanowiska państw (P1).
--
-- Rekomendacja z docs/OCENA_KONKURENCYJNA_2026-07-13.md: pole gry czołowych
-- think-tanków (ECFR EU Coalition Explorer, think-tank, Bruegel) to interaktywne,
-- stale aktualizowane dane - nie PDF-y. Dwa kroki w tym kierunku:
--
--   1. eu_policy_items: pola strukturalne dossier w duchu Politico PRO
--      Legislative Compass - sprawozdawca PE, komisja wiodąca, DG Komisji.
--      Wartości neutralne językowo (nazwisko, kod komisji/DG), więc bez
--      wariantów _pl/_en.
--   2. eu_policy_positions: stanowiska 27 państw członkowskich per dossier
--      (za / przeciw / podzielone / brak stanowiska) + nota PL/EN. Zasila
--      publiczny explorer (mapa choropletowa Europy na istniejącym zasobie
--      public/geo/europe-50m.v1.json).
--
-- Wszystko idempotentne, wzorce RLS 1:1 z eu_policy_updates.
-- ============================================================================

ALTER TABLE public.eu_policy_items
  ADD COLUMN IF NOT EXISTS rapporteur text
    CHECK (rapporteur IS NULL OR length(btrim(rapporteur)) BETWEEN 2 AND 120),
  ADD COLUMN IF NOT EXISTS committee text
    CHECK (committee IS NULL OR length(btrim(committee)) BETWEEN 2 AND 40),
  ADD COLUMN IF NOT EXISTS lead_dg text
    CHECK (lead_dg IS NULL OR length(btrim(lead_dg)) BETWEEN 2 AND 60);

COMMENT ON COLUMN public.eu_policy_items.rapporteur IS
  'Sprawozdawca PE (nazwisko, neutralne językowo).';
COMMENT ON COLUMN public.eu_policy_items.committee IS
  'Komisja wiodąca PE, kod (np. LIBE, ITRE).';
COMMENT ON COLUMN public.eu_policy_items.lead_dg IS
  'Wiodąca DG Komisji Europejskiej (np. DG CNECT).';

-- ----------------------------------------------------------------------------
-- Stanowiska państw członkowskich
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.eu_policy_positions (
  item_id uuid NOT NULL REFERENCES public.eu_policy_items(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  country_code text NOT NULL
    CHECK (country_code IN ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR',
                            'DE','GR','HU','IE','IT','LV','LT','LU','MT','NL',
                            'PL','PT','RO','SK','SI','ES','SE')),
  stance text NOT NULL
    CHECK (stance IN ('support', 'oppose', 'mixed', 'undecided')),
  note_pl text CHECK (note_pl IS NULL OR length(btrim(note_pl)) <= 500),
  note_en text CHECK (note_en IS NULL OR length(btrim(note_en)) <= 500),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, country_code)
);

CREATE INDEX IF NOT EXISTS idx_eu_policy_positions_tenant
  ON public.eu_policy_positions (tenant_id, item_id);

-- tenant_id i updated_by przypina baza z dossier - klient nie może ich
-- sfałszować (ten sam wzorzec co tg_eu_policy_update_applied).
CREATE OR REPLACE FUNCTION public.tg_eu_policy_position_pin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.eu_policy_items WHERE id = NEW.item_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'eu_policy_positions: unknown item %', NEW.item_id;
  END IF;
  NEW.tenant_id := v_tenant;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eu_policy_position_pin ON public.eu_policy_positions;
CREATE TRIGGER eu_policy_position_pin
  BEFORE INSERT OR UPDATE ON public.eu_policy_positions
  FOR EACH ROW EXECUTE FUNCTION public.tg_eu_policy_position_pin();

GRANT SELECT ON public.eu_policy_positions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.eu_policy_positions TO authenticated;
GRANT ALL ON public.eu_policy_positions TO service_role;
ALTER TABLE public.eu_policy_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy positions public read" ON public.eu_policy_positions;
CREATE POLICY "policy positions public read" ON public.eu_policy_positions
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.eu_policy_items i
       WHERE i.id = eu_policy_positions.item_id AND i.status = 'published'
    )
  );

DROP POLICY IF EXISTS "policy positions staff all" ON public.eu_policy_positions;
CREATE POLICY "policy positions staff all" ON public.eu_policy_positions
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    -- tenant_id nadpisuje trigger; WITH CHECK pilnuje spójności końcowej.
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
