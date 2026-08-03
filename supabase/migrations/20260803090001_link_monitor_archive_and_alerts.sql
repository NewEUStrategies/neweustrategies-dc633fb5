-- Monitor linków wychodzących (B7), warstwa DZIAŁANIA.
--
-- Stan przed: monitor tylko RAPORTOWAŁ zepsute linki w /admin/link-monitor.
-- Nie podpowiadał, co z nimi zrobić (zepsuty przypis prawie nigdy nie wymaga
-- usunięcia - wymaga podmiany na migawkę Internet Archive), i nigdy sam się nie
-- odzywał, więc lista 404 rosła do momentu, gdy ktoś przypadkiem zajrzał w panel.
--
-- Ta migracja dodaje dwie rzeczy:
--   1. Zapamiętaną migawkę web.archive.org dla zepsutego linku (skaner odpytuje
--      Wayback tylko dla linków, które faktycznie padły).
--   2. Stan alertu progowego per tenant, żeby powiadomienie szło raz na dobę
--      (albo przy wyraźnym narośnięciu problemu), a nie przy każdym skanie.

-- 1. Migawka archiwum na wpisie kontroli linku ---------------------------------
-- Kolumny nullable: brak migawki (np. strona nigdy nie była archiwizowana) jest
-- normalnym stanem, a nie błędem. Tabela ma GRANT SELECT na poziomie TABELI
-- (patrz 20260720135000), więc nowe kolumny są od razu widoczne dla panelu.
ALTER TABLE public.outbound_link_checks
  ADD COLUMN IF NOT EXISTS archive_url text,
  ADD COLUMN IF NOT EXISTS archive_timestamp text,
  ADD COLUMN IF NOT EXISTS archive_checked_at timestamptz;

-- 2. Stan alertu progowego -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outbound_link_alerts (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Liczba zepsutych linków przy OSTATNIM wysłanym alercie: histereza liczy
  -- przyrost od tej wartości, więc fala nowych 404 nie czeka na cooldown.
  broken_count integer NOT NULL DEFAULT 0,
  notified_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.outbound_link_alerts TO authenticated;
GRANT ALL ON public.outbound_link_alerts TO service_role;

ALTER TABLE public.outbound_link_alerts ENABLE ROW LEVEL SECURITY;

-- Odczyt tylko dla stafu WŁASNEGO tenanta (jak przy outbound_link_checks).
-- Zapis idzie wyłącznie service rolem ze skanera - brak polityki INSERT/UPDATE
-- dla authenticated jest zamierzony.
DROP POLICY IF EXISTS "link alerts staff read" ON public.outbound_link_alerts;
CREATE POLICY "link alerts staff read" ON public.outbound_link_alerts
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());
