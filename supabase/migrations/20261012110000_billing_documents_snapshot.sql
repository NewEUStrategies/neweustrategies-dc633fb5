-- ============================================================================
-- DOKUMENTY ROZLICZENIOWE: MIGAWKA NABYWCY, SPRZEDAWCY I PLASZCZYZNY ROZLICZEN.
--
-- DEFEKT (audyt INV-07). Kopia PDF z panelu czlonka
-- (`src/lib/billing/invoiceDocument.server.ts`) czytala nabywce
-- z `billing_profiles`, sprzedawce z `site_settings` (`invoice_issuer`)
-- i drukowala stala note "Podatek rozlicza operator (MoR)" - wszystko NA ZYWO,
-- w chwili pobrania. Zmiana danych w profilu (albo "Pobierz z CRM")
-- przepisywala nabywce na KAZDYM starym dokumencie, a w plaszczyznie
-- `merchant` (sprzedawca sam rozlicza podatek, `checkoutBillingPlane`
-- w `src/lib/billing/checkoutSettings.ts`) dokument niosl falszywa adnotacje.
--
-- ZMIANA:
--   1. trzy kolumny migawki: `buyer_snapshot` i `seller_snapshot` (jsonb,
--      ksztalt `InvoiceParty` z `src/lib/billing/invoicePdf.ts`) oraz
--      `billing_plane` ('managed' | 'merchant' - zbior `CheckoutBillingPlane`).
--      Pisze je webhook przy ZALOZENIU dokumentu
--      (`src/lib/billing/billingDocuments.server.ts`); wiersze sprzed tej
--      migracji dostaja migawke przy PIERWSZYM pobraniu PDF
--      (`UPDATE ... WHERE buyer_snapshot IS NULL`) i od tej chwili tez sa
--      niezmienne;
--   2. CHECK kompletnosci: migawka jest cala albo jej nie ma. Polowa migawki
--      (nabywca bez plaszczyzny) zmusilaby PDF do doczytania reszty na zywo,
--      czyli do dokladnie tego defektu;
--   3. CHECK ksztaltu: strona dokumentu to obiekt z tekstowa nazwa (PDF bez
--      nazwy nabywcy nie jest dokumentem);
--   4. trigger WRITE-ONCE: raz zapisanej migawki nie zmienia zaden UPDATE,
--      takze spod roli serwisowej. Dokument ksiegowy opisuje transakcje z dnia
--      transakcji - poprawka to nowy dokument (korekta), nie edycja starego.
--
-- RODO: migawka kopiuje dane nabywcy do rejestru dokumentow ksiegowych, ktory
-- swiadomie przetrwa usuniecie konta (brak FK `user_id`, 20260723151000) -
-- podstawa: obowiazek przechowywania dowodow sprzedazy (art. 17 ust. 3 lit. b
-- RODO, art. 74 uor). Podglad: te same polityki RLS co reszta wiersza
-- (wlasciciel + administrator najemcy).
--
-- KOLEJNOSC WDROZENIA: migracja PRZED kodem (kod czyta i pisze nowe kolumny).
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT / TRIGGER IF EXISTS,
-- CREATE OR REPLACE.
-- DOWOD: src/lib/billing/__tests__/billingDocumentsDbCheck.test.ts (CHECK-i
-- = zbiory TS), supabase/tests/billing_documents_snapshot_test.sql.
-- ============================================================================

ALTER TABLE public.billing_documents
  ADD COLUMN IF NOT EXISTS buyer_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS seller_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS billing_plane text;

COMMENT ON COLUMN public.billing_documents.buyer_snapshot IS
  'Migawka nabywcy z chwili zakupu (ksztalt InvoiceParty). Zapis raz: webhook przy zalozeniu dokumentu albo pierwsze pobranie PDF; potem niezmienna (trigger billing_documents_snapshot_write_once).';
COMMENT ON COLUMN public.billing_documents.seller_snapshot IS
  'Migawka sprzedawcy (site_settings.invoice_issuer) z chwili zakupu, ksztalt InvoiceParty. Zapis raz, potem niezmienna.';
COMMENT ON COLUMN public.billing_documents.billing_plane IS
  'Plaszczyzna rozliczen z chwili zakupu: managed = operator jako Merchant of Record, merchant = sprzedawca rozlicza podatek. Wybiera note podatkowa kopii PDF.';

ALTER TABLE public.billing_documents
  DROP CONSTRAINT IF EXISTS billing_documents_billing_plane_values;
ALTER TABLE public.billing_documents
  ADD CONSTRAINT billing_documents_billing_plane_values
  CHECK (billing_plane IN ('managed', 'merchant'));

ALTER TABLE public.billing_documents
  DROP CONSTRAINT IF EXISTS billing_documents_snapshot_complete;
ALTER TABLE public.billing_documents
  ADD CONSTRAINT billing_documents_snapshot_complete
  CHECK (
    (buyer_snapshot IS NULL) = (seller_snapshot IS NULL)
    AND (buyer_snapshot IS NULL) = (billing_plane IS NULL)
  );

-- COALESCE jest konieczny: `->` na skalarze albo obiekcie bez klucza daje
-- NULL, a CHECK z wynikiem NULL PRZEPUSZCZA wiersz.
ALTER TABLE public.billing_documents
  DROP CONSTRAINT IF EXISTS billing_documents_snapshot_party_name;
ALTER TABLE public.billing_documents
  ADD CONSTRAINT billing_documents_snapshot_party_name
  CHECK (
    (buyer_snapshot IS NULL OR COALESCE(jsonb_typeof(buyer_snapshot -> 'name'), '') = 'string')
    AND (seller_snapshot IS NULL OR COALESCE(jsonb_typeof(seller_snapshot -> 'name'), '') = 'string')
  );

CREATE OR REPLACE FUNCTION public.billing_documents_snapshot_write_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.buyer_snapshot IS NOT NULL AND (
       NEW.buyer_snapshot IS DISTINCT FROM OLD.buyer_snapshot
    OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot
    OR NEW.billing_plane IS DISTINCT FROM OLD.billing_plane
  ) THEN
    RAISE EXCEPTION 'billing_document_snapshot_immutable: snapshot of document % cannot change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.billing_documents_snapshot_write_once() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.billing_documents_snapshot_write_once() IS
  'Write-once migawki dokumentu rozliczeniowego: po pierwszym zapisie buyer_snapshot, seller_snapshot i billing_plane nie zmieniaja sie (42501). Dokument opisuje transakcje z dnia transakcji, nie biezacy profil.';

DROP TRIGGER IF EXISTS billing_documents_snapshot_write_once ON public.billing_documents;
CREATE TRIGGER billing_documents_snapshot_write_once
  BEFORE UPDATE OF buyer_snapshot, seller_snapshot, billing_plane ON public.billing_documents
  FOR EACH ROW EXECUTE FUNCTION public.billing_documents_snapshot_write_once();
