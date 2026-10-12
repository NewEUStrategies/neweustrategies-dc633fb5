-- ============================================================================
-- FAKTURY WYDARZEN - ZGODNOSC Z AUDYTEM ROZLICZEN (INV-02, 05, 06, 08, 09,
-- 12, 14, 15, 16, 17). CZESC 1/7: SCHEMAT, STRAZNICY, FUNKCJE CZYSTE.
-- events-harness: include
--
-- PO CO. Audyt (docs/AUDYT_FAKTURY_WYDARZEN_2026-10-12.md) potwierdzil, ze
-- silnik dokumentow z 20260927000200 pozwalal na rzeczy, ktorych w obrocie
-- prawnym robic nie wolno albo ktorych prawo wymaga, a ktorych nie bylo:
--
--   INV-02  stan KSeF dawal sie cofnac (`accepted` -> `pending`), numer KSeF
--           nadpisac, a potem fakture anulowac i wystawic druga za te sama
--           sprzedaz. Teraz: przejscia jednokierunkowe (graf ponizej, ten sam
--           w RPC i w TRIGGERZE - zadna sciezka, takze service_role, go nie
--           obejdzie), numer KSeF niezmienny po ustawieniu i dziennik KAZDEJ
--           zmiany stanu (`event_invoice_ksef_events`).
--   INV-17  numer KSeF bez formatu i bez unikalnosci, korekta bez numeru KSeF
--           faktury korygowanej. Teraz: format NIP-RRRRMMDD-HEX12-HEX2 z NIP-em
--           sprzedawcy i data przyjecia, unikalnosc w najemcy, `corrects`
--           niesie `ksef_number` (czesc 2).
--   INV-06  faktura w EUR bez VAT w PLN i bez kursu NBP. Teraz: kursy tabeli A
--           (`nbp_exchange_rates`, dzien kalendarzowy -> ostatnia tabela), na
--           dokumencie kurs, numer tabeli, data i VAT w PLN (czesci 2-4).
--   INV-08  anulowanie faktury, ktora nabywca juz dostal mailem albo pobral.
--           Teraz: stemple doreczenia (`buyer_notified_at`,
--           `buyer_downloaded_at`), ustawiane raz, blokuja anulowanie.
--   INV-09  kazda zmiana ustawien kasy blokowala fakturowanie starszych
--           zamowien kartą. Teraz: plaszczyzna rozliczen STEMPLOWANA na
--           zamowieniu w chwili jego zalozenia (trigger), niezmienna.
--   INV-12  stawka "np" bez podstawy prawnej i bez adnotacji "odwrotne
--           obciazenie", NIP UE tylko formatowo. Teraz: podstawa "np"
--           wymagana, adnotacja i weryfikacja VIES dla nabywcy z UE.
--   INV-14  kwota z cennika dla wplat bez karty. Teraz: zaksiegowana wplata na
--           zapisie (`paid_amount_*`) i odmowa wystawienia przy rozjezdzie.
--   INV-16  VAT jako suma VAT pozycji. Teraz: VAT od SUMY wartosci brutto
--           w stawce (art. 106e ust. 7 i 8 ustawy o VAT), zamrozony na
--           dokumencie (`vat_summary`).
--   INV-05  i INV-15 - czesc 6.
--
-- IDEMPOTENCJA: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- DROP ... IF EXISTS + CREATE dla ograniczen, triggerow i polityk,
-- CREATE OR REPLACE FUNCTION. Rozmiar kazdej z siedmiu czesci < 45 KiB (limit Lovable,
-- `src/lib/ci/migrationSize.ts`).
--
-- Testy: scripts/events-harness/runtime_test.d/27_invoices_compliance.sql,
--   src/lib/events/__tests__/eventInvoice*.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. KOLUMNY
-- ----------------------------------------------------------------------------

-- Podstawa prawna stawki "np" (np. "art. 28b ustawy o VAT") - domyslna dla
-- kazdego dokumentu z pozycja "np", tak jak `vat_exempt_basis` dla "zw".
ALTER TABLE public.event_invoice_settings
  ADD COLUMN IF NOT EXISTS vat_np_basis text NOT NULL DEFAULT '';

ALTER TABLE public.event_invoices
  -- INV-16: podsumowanie stawek liczone OD SUMY w stawce, zamrozone przy
  -- wystawieniu. NULL = dokument sprzed tej migracji (drukuje sie po staremu,
  -- bo wystawionego dokumentu zmieniac nie wolno).
  ADD COLUMN IF NOT EXISTS vat_summary jsonb,
  -- INV-12: podstawa "np", odwrotne obciazenie (NULL na szkicu = ustal
  -- automatycznie przy wystawieniu) i dowod weryfikacji VIES nabywcy.
  ADD COLUMN IF NOT EXISTS np_basis text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reverse_charge boolean,
  ADD COLUMN IF NOT EXISTS buyer_vies_subject text,
  ADD COLUMN IF NOT EXISTS buyer_vies_valid boolean,
  ADD COLUMN IF NOT EXISTS buyer_vies_request_id text,
  ADD COLUMN IF NOT EXISTS buyer_vies_checked_at timestamptz,
  -- INV-06: kurs sredni NBP (tabela A) z ostatniego dnia roboczego przed
  -- obowiazkiem podatkowym i VAT w PLN.
  ADD COLUMN IF NOT EXISTS fx_rate numeric(10, 4),
  ADD COLUMN IF NOT EXISTS fx_table_no text,
  ADD COLUMN IF NOT EXISTS fx_effective_date date,
  ADD COLUMN IF NOT EXISTS vat_pln_cents bigint,
  -- INV-08: dokument doreczony nabywcy (mail o wystawieniu, pobranie z profilu).
  ADD COLUMN IF NOT EXISTS buyer_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS buyer_downloaded_at timestamptz;

ALTER TABLE public.event_invoices DROP CONSTRAINT IF EXISTS event_invoices_fx_shape;
ALTER TABLE public.event_invoices ADD CONSTRAINT event_invoices_fx_shape CHECK (
  (fx_rate IS NULL) = (fx_table_no IS NULL)
  AND (fx_rate IS NULL) = (fx_effective_date IS NULL)
  AND (fx_rate IS NULL OR fx_rate > 0)
  AND (fx_table_no IS NULL OR fx_table_no ~ '^[0-9]{1,3}/A/NBP/[0-9]{4}$')
);
ALTER TABLE public.event_invoices DROP CONSTRAINT IF EXISTS event_invoices_np_basis_len;
ALTER TABLE public.event_invoices ADD CONSTRAINT event_invoices_np_basis_len
  CHECK (char_length(np_basis) <= 300);
ALTER TABLE public.event_invoices DROP CONSTRAINT IF EXISTS event_invoices_vies_shape;
ALTER TABLE public.event_invoices ADD CONSTRAINT event_invoices_vies_shape CHECK (
  (buyer_vies_checked_at IS NULL) = (buyer_vies_subject IS NULL)
  AND (buyer_vies_checked_at IS NULL) = (buyer_vies_valid IS NULL)
  AND (buyer_vies_request_id IS NULL OR char_length(buyer_vies_request_id) BETWEEN 1 AND 64)
);
ALTER TABLE public.event_invoice_settings DROP CONSTRAINT IF EXISTS event_invoice_settings_np_basis_len;
ALTER TABLE public.event_invoice_settings ADD CONSTRAINT event_invoice_settings_np_basis_len
  CHECK (char_length(vat_np_basis) <= 300);

-- INV-14: wplata ZAKSIEGOWANA przez organizatora (przelew, gotowka) - kwota,
-- ktora faktycznie wplynela. Bez niej zapis oplacony poza kasa nie ma kwoty
-- i faktura brala cene z cennika (pelna cena mimo uzgodnionego rabatu).
-- Zapis WYLACZNIE przez `admin_event_registration_record_payment` (czesc 4);
-- klient nie ma prawa UPDATE na `event_registrations`.
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS paid_amount_cents bigint,
  ADD COLUMN IF NOT EXISTS paid_amount_currency text,
  ADD COLUMN IF NOT EXISTS paid_amount_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_amount_recorded_by uuid;
ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS event_registrations_paid_amount_shape;
ALTER TABLE public.event_registrations ADD CONSTRAINT event_registrations_paid_amount_shape CHECK (
  (paid_amount_cents IS NULL) = (paid_amount_currency IS NULL)
  AND (paid_amount_cents IS NULL) = (paid_amount_recorded_at IS NULL)
  AND (paid_amount_cents IS NULL OR paid_amount_cents BETWEEN 0 AND 100000000000)
  AND (paid_amount_currency IS NULL OR paid_amount_currency IN ('PLN', 'EUR'))
);

-- INV-09: plaszczyzna rozliczen zamowienia z chwili ZALOZENIA (wtedy kasa
-- otwiera sesje operatora z flagami `automatic_tax` / `invoice_creation`).
--   billing_plane    'managed' (operator = sprzedawca, MoR) | 'merchant';
--   operator_invoice dokument za platnosc wystawia operator (MoR) albo Stripe
--                    (`invoice_creation` na wlasnym koncie).
-- NULL = zamowienie sprzed tej migracji (regula zachowawcza z 20260927000201).
ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS billing_plane text,
  ADD COLUMN IF NOT EXISTS operator_invoice boolean;
ALTER TABLE public.payment_orders DROP CONSTRAINT IF EXISTS payment_orders_billing_plane_values;
ALTER TABLE public.payment_orders ADD CONSTRAINT payment_orders_billing_plane_values CHECK (
  (billing_plane IS NULL OR billing_plane IN ('managed', 'merchant'))
  AND (billing_plane IS NULL) = (operator_invoice IS NULL)
);

-- Stempel przy INSERT, zamrozenie przy UPDATE. Trigger, a nie trzy sciezki
-- kasy w TS (bilety, ad-hoc, plany): jedno miejsce, ktorego zadne nowe wejscie
-- nie ominie, w tej samej transakcji co zalozenie zamowienia. Wartosci
-- podane przez klienta sa IGNOROWANE (stempel nie jest deklaracja kupujacego).
CREATE OR REPLACE FUNCTION public._tg_payment_orders_billing_plane()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_automatic_tax boolean;
  v_invoice_creation boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.billing_plane := OLD.billing_plane;
    NEW.operator_invoice := OLD.operator_invoice;
    RETURN NEW;
  END IF;
  SELECT c.automatic_tax, c.invoice_creation INTO v_automatic_tax, v_invoice_creation
    FROM public.checkout_settings c WHERE c.tenant_id = NEW.tenant_id;
  -- Ta sama regula co checkoutBillingPlane() i checkoutSessionParams()
  -- (src/lib/billing/checkoutSettings.ts): brak wiersza = domyslne ustawienia
  -- (automatic_tax false -> operator, invoice_creation true).
  NEW.billing_plane := CASE WHEN COALESCE(v_automatic_tax, false) THEN 'merchant' ELSE 'managed' END;
  NEW.operator_invoice := NEW.billing_plane = 'managed' OR COALESCE(v_invoice_creation, true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._tg_payment_orders_billing_plane() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._tg_payment_orders_billing_plane() IS
  'Plaszczyzna rozliczen (managed/merchant) i dokument operatora stemplowane na zamowieniu przy INSERT z checkout_settings najemcy; przy UPDATE niezmienne.';

-- `zz_`: po triggerach, ktore ustawiaja najemce i stan zamowienia.
DROP TRIGGER IF EXISTS payment_orders_zz_billing_plane ON public.payment_orders;
CREATE TRIGGER payment_orders_zz_billing_plane
  BEFORE INSERT OR UPDATE OF billing_plane, operator_invoice ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public._tg_payment_orders_billing_plane();

-- ----------------------------------------------------------------------------
-- 2. KURSY NBP (INV-06)
--
-- Wiersz = dzien KALENDARZOWY `rate_date` -> ostatnia tabela A opublikowana
-- w tym dniu albo wczesniej. Kurs z "ostatniego dnia roboczego poprzedzajacego
-- dzien X" (art. 31a ust. 1 i 2 ustawy o VAT) to wiersz `rate_date = X - 1`:
-- jedno trafienie po kluczu, bez zgadywania swiat. Brak wiersza = kurs nie
-- pobrany, a nie "wez starszy" - stary kurs na fakturze to blad podatkowy.
-- Zapisuje WYLACZNIE serwer (service_role) po pobraniu z api.nbp.pl
-- (src/lib/events/eventInvoiceFx.server.ts); klient ani panel nie podaja kursu.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nbp_exchange_rates (
  currency text NOT NULL,
  rate_date date NOT NULL,
  effective_date date NOT NULL,
  table_no text NOT NULL,
  mid numeric(10, 4) NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, rate_date),
  CONSTRAINT nbp_exchange_rates_currency_format CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'PLN'),
  CONSTRAINT nbp_exchange_rates_effective_window
    CHECK (effective_date <= rate_date AND rate_date - effective_date <= 10),
  CONSTRAINT nbp_exchange_rates_table_format CHECK (table_no ~ '^[0-9]{1,3}/A/NBP/[0-9]{4}$'),
  CONSTRAINT nbp_exchange_rates_mid_positive CHECK (mid > 0)
);
COMMENT ON TABLE public.nbp_exchange_rates IS
  'Kurs sredni NBP (tabela A) obowiazujacy w dniu kalendarzowym rate_date (ostatnia tabela opublikowana tego dnia lub wczesniej). Zapis wylacznie service_role (serwer pobiera z api.nbp.pl); czytaja funkcje faktur.';
ALTER TABLE public.nbp_exchange_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nbp_exchange_rates FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.nbp_exchange_rates TO service_role;

-- ----------------------------------------------------------------------------
-- 3. DZIENNIK STANU KSeF (INV-02)
-- Append-only: kazda zmiana `ksef_status`/`ksef_number` wystawionego
-- dokumentu, z autorem i notatka. Wpisuje WYLACZNIE trigger na
-- `event_invoices`, wiec zadna sciezka zapisu nie zmieni stanu bez sladu.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_invoice_ksef_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  from_number text,
  to_number text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text NOT NULL DEFAULT '',
  -- clock_timestamp(): kolejnosc wpisow takze wewnatrz jednej transakcji
  -- (wystawienie i zmiana stanu w jednym wywolaniu maja ten sam now()).
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT event_invoice_ksef_events_note_len CHECK (char_length(note) <= 500),
  CONSTRAINT event_invoice_ksef_events_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES public.event_invoices (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE public.event_invoice_ksef_events IS
  'Dziennik zmian stanu i numeru KSeF dokumentow wydarzen (append-only, wpisuje trigger na event_invoices).';
CREATE INDEX IF NOT EXISTS event_invoice_ksef_events_invoice_idx
  ON public.event_invoice_ksef_events (tenant_id, invoice_id, created_at);

REVOKE ALL ON public.event_invoice_ksef_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_invoice_ksef_events TO authenticated;
GRANT ALL ON public.event_invoice_ksef_events TO service_role;
ALTER TABLE public.event_invoice_ksef_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_invoice_ksef_events_staff_read" ON public.event_invoice_ksef_events;
CREATE POLICY "event_invoice_ksef_events_staff_read"
  ON public.event_invoice_ksef_events FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

CREATE OR REPLACE FUNCTION public._tg_event_invoice_ksef_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Kaskada z usuniecia SZKICU jest jedynym dozwolonym DELETE (szkic nie ma
  -- stanu KSeF, wiec w praktyce nie ma tez wpisow).
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.event_invoices i WHERE i.id = OLD.invoice_id AND i.status <> 'draft'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'invoice_immutable: the KSeF log is append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_invoice_ksef_events_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_invoice_ksef_events_append_only ON public.event_invoice_ksef_events;
CREATE TRIGGER event_invoice_ksef_events_append_only
  BEFORE UPDATE OR DELETE ON public.event_invoice_ksef_events
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_invoice_ksef_events_append_only();

-- ----------------------------------------------------------------------------
-- 4. FUNKCJE CZYSTE
-- ----------------------------------------------------------------------------

-- GRAF STANOW KSeF (INV-02). Jedno zrodlo dla triggera, RPC i panelu (lustro
-- `EVENT_INVOICE_KSEF_TRANSITIONS` w src/lib/events/eventInvoiceEnums.ts,
-- parytet pilnuje vitest). Ruch WYLACZNIE do przodu:
--   pending  -> sent | accepted | rejected
--   sent     -> accepted | rejected
--   rejected -> pending | sent | accepted  (ponowna wysylka po odrzuceniu)
--   accepted, not_applicable - TERMINALNE.
-- Stany, w ktorych wolno anulowac (pending, rejected), nie sa osiagalne ze
-- stanow, w ktorych nie wolno (sent, accepted) - tylko przez `rejected`,
-- czyli odmowe KSeF zapisana w dzienniku.
CREATE OR REPLACE FUNCTION public._event_invoice_ksef_transition_ok(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_from IS NOT DISTINCT FROM p_to
      OR (p_from, p_to) IN (
           ('pending', 'sent'), ('pending', 'accepted'), ('pending', 'rejected'),
           ('sent', 'accepted'), ('sent', 'rejected'),
           ('rejected', 'pending'), ('rejected', 'sent'), ('rejected', 'accepted')
         );
$$;
REVOKE ALL ON FUNCTION public._event_invoice_ksef_transition_ok(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_ksef_transition_ok(text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public._event_invoice_ksef_transition_ok(text, text) IS
  'Dozwolone przejscie stanu KSeF (jednokierunkowe; accepted i not_applicable terminalne).';

-- NUMER KSeF (INV-17): `NNNNNNNNNN-RRRRMMDD-XXXXXXXXXXXX-XX` - NIP sprzedawcy
-- (z suma kontrolna i rowny NIP-owi z migawki), data przyjecia (prawdziwa
-- data, nie wczesniej niz dzien przed wystawieniem i nie pozniej niz jutro),
-- 12 znakow szesnastkowych i 2 znaki sumy kontrolnej. Sumy CRC samego numeru
-- celowo NIE liczymy: opis algorytmu w dokumentacji KSeF nie jest tu
-- zweryfikowany, a falszywa odmowa zablokowalaby zapis poprawnego numeru.
CREATE OR REPLACE FUNCTION public._event_invoice_ksef_number_valid(
  p_number text, p_seller_tax_id text, p_issue_date date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parts text[];
  v_date date;
  v_seller text := public._event_invoice_tax_key(p_seller_tax_id);
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
BEGIN
  v_parts := regexp_match(COALESCE(p_number, ''),
                          '^([0-9]{10})-([0-9]{4})([0-9]{2})([0-9]{2})-[0-9A-F]{12}-[0-9A-F]{2}$');
  IF v_parts IS NULL OR NOT public._event_invoice_pl_nip_valid(v_parts[1]) THEN
    RETURN false;
  END IF;
  IF v_seller ~ '^[0-9]{10}$' AND v_seller <> v_parts[1] THEN
    RETURN false;
  END IF;
  BEGIN
    v_date := make_date(v_parts[2]::integer, v_parts[3]::integer, v_parts[4]::integer);
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  RETURN v_date <= v_today + 1 AND (p_issue_date IS NULL OR v_date >= p_issue_date - 1);
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_ksef_number_valid(text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_ksef_number_valid(text, text, date) TO authenticated, service_role;
COMMENT ON FUNCTION public._event_invoice_ksef_number_valid(text, text, date) IS
  'Format numeru KSeF: NIP sprzedawcy (suma kontrolna, zgodny z migawka)-RRRRMMDD (data przyjecia)-12 hex-2 hex.';

-- DZIEN, OD KTOREGO LICZY SIE KURS (INV-06, art. 31a ust. 1 i 2 ustawy o
-- VAT): obowiazek podatkowy uslugi powstaje z jej wykonaniem (data sprzedazy)
-- albo wczesniej - z otrzymaniem zaplaty (art. 19a ust. 1 i 8); faktura
-- wystawiona PRZED obowiazkiem bierze kurs sprzed dnia wystawienia. Stad
-- najwczesniejsza z dat: wystawienia, sprzedazy, zaplaty. Kurs = wiersz
-- `nbp_exchange_rates.rate_date = wynik - 1`.
CREATE OR REPLACE FUNCTION public._event_invoice_fx_basis(p_issue date, p_sale date, p_paid timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT least(p_issue, p_sale, (p_paid AT TIME ZONE 'Europe/Warsaw')::date);
$$;
REVOKE ALL ON FUNCTION public._event_invoice_fx_basis(date, date, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_fx_basis(date, date, timestamptz) TO authenticated, service_role;
COMMENT ON FUNCTION public._event_invoice_fx_basis(date, date, timestamptz) IS
  'Dzien obowiazku podatkowego dla kursu NBP: najwczesniejsza z dat wystawienia, sprzedazy i zaplaty (kurs z dnia poprzedzajacego).';

-- VAT w PLN (INV-06): kwota w walucie x kurs, zaokraglenie polowkowe od zera
-- do grosza (lustro `vatInPln` w eventInvoiceMath.ts).
CREATE OR REPLACE FUNCTION public._event_invoice_pln(p_cents bigint, p_rate numeric)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT round(p_cents::numeric * p_rate)::bigint;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_pln(bigint, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_pln(bigint, numeric) TO authenticated, service_role;

-- Panstwa UE w VIES (Grecja ma tam kod EL, Irlandia Polnocna XI).
CREATE OR REPLACE FUNCTION public._event_invoice_eu_country(p_country text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT upper(COALESCE(p_country, '')) IN (
    'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'GR', 'ES', 'FI', 'FR', 'HR', 'HU',
    'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI'
  );
$$;
REVOKE ALL ON FUNCTION public._event_invoice_eu_country(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_eu_country(text) TO authenticated, service_role;

-- Podmiot zapytania VIES: kod panstwa VIES + numer bez prefiksu kraju
-- ("DE123456789" i "123456789" przy kraju DE -> "DE123456789"). Wynik
-- weryfikacji jest wazny tylko dla TEGO podmiotu - zmiana danych nabywcy na
-- szkicu uniewaznia go bez dodatkowej logiki.
CREATE OR REPLACE FUNCTION public._event_invoice_vies_subject(p_country text, p_tax_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT v.cc || regexp_replace(
           upper(regexp_replace(COALESCE(p_tax_id, ''), '[^A-Za-z0-9]', '', 'g')),
           '^(' || v.cc || '|' || upper(COALESCE(p_country, '')) || ')', '')
    FROM (SELECT CASE upper(COALESCE(p_country, '')) WHEN 'GR' THEN 'EL'
                 ELSE upper(COALESCE(p_country, '')) END AS cc) AS v;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_vies_subject(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_vies_subject(text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. STRAZNIK NIEZMIENNOSCI WYSTAWIONEGO DOKUMENTU (rozszerzenie 20260927000200)
-- Poza tym, co pilnowal dotad: graf KSeF, numer KSeF niezmienny i z formatem,
-- przyjecie wymaga numeru, stemple doreczenia ustawiane raz.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tg_event_invoices_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_free text[] := ARRAY[
    'ksef_status', 'ksef_number', 'ksef_updated_at', 'paid_at', 'status', 'cancel_reason',
    'cancelled_at', 'cancelled_by', 'updated_at', 'event_id', 'crm_company_id', 'buyer_user_id',
    'buyer_person_id', 'created_by', 'issued_by', 'buyer_notified_at', 'buyer_downloaded_at'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'invoice_immutable: only a draft may be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - v_free) IS DISTINCT FROM (to_jsonb(OLD) - v_free) THEN
    RAISE EXCEPTION 'invoice_immutable: an issued document cannot change' USING ERRCODE = '42501';
  END IF;
  IF (NEW.event_id IS DISTINCT FROM OLD.event_id AND NEW.event_id IS NOT NULL)
     OR (NEW.crm_company_id IS DISTINCT FROM OLD.crm_company_id AND NEW.crm_company_id IS NOT NULL
         AND OLD.crm_company_id IS NOT NULL)
     OR (NEW.buyer_user_id IS DISTINCT FROM OLD.buyer_user_id AND NEW.buyer_user_id IS NOT NULL)
     OR (NEW.buyer_person_id IS DISTINCT FROM OLD.buyer_person_id AND NEW.buyer_person_id IS NOT NULL)
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)
     OR (NEW.issued_by IS DISTINCT FROM OLD.issued_by AND NEW.issued_by IS NOT NULL) THEN
    RAISE EXCEPTION 'invoice_immutable: references of an issued document may only be cleared'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'invoice_immutable: a cancelled document stays cancelled' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'issued' AND NEW.status NOT IN ('issued', 'cancelled') THEN
    RAISE EXCEPTION 'invoice_immutable: an issued document can only be cancelled' USING ERRCODE = '42501';
  END IF;
  -- INV-02: KSeF tylko do przodu, numer raz na zawsze.
  IF NOT public._event_invoice_ksef_transition_ok(OLD.ksef_status, NEW.ksef_status) THEN
    RAISE EXCEPTION 'invalid_transition: KSeF status % cannot change to %', OLD.ksef_status, NEW.ksef_status
      USING ERRCODE = '22023';
  END IF;
  IF OLD.ksef_number IS NOT NULL AND NEW.ksef_number IS DISTINCT FROM OLD.ksef_number THEN
    RAISE EXCEPTION 'ksef_number_immutable: the KSeF number of a document never changes'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.ksef_number IS DISTINCT FROM OLD.ksef_number
     AND NOT public._event_invoice_ksef_number_valid(NEW.ksef_number, NEW.seller->>'seller_tax_id', NEW.issue_date) THEN
    RAISE EXCEPTION 'invalid_ksef_number: KSeF number has the form NIP-YYYYMMDD-XXXXXXXXXXXX-XX'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.ksef_status = 'accepted' AND OLD.ksef_status IS DISTINCT FROM 'accepted' AND NEW.ksef_number IS NULL THEN
    RAISE EXCEPTION 'ksef_number_required: an accepted document needs the KSeF number'
      USING ERRCODE = '22023';
  END IF;
  -- INV-08: doreczenie jest faktem - stempla nie da sie przestawic ani zdjac.
  IF (OLD.buyer_notified_at IS NOT NULL AND NEW.buyer_notified_at IS DISTINCT FROM OLD.buyer_notified_at)
     OR (OLD.buyer_downloaded_at IS NOT NULL AND NEW.buyer_downloaded_at IS DISTINCT FROM OLD.buyer_downloaded_at) THEN
    RAISE EXCEPTION 'invoice_immutable: a delivery stamp never changes' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_invoices_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._tg_event_invoices_guard() IS
  'Niezmiennosc wystawionego dokumentu: poza szkicem wolno zmienic tylko ksef_* (graf jednokierunkowy, numer raz, z formatem), paid_at, issued -> cancelled, stemple doreczenia (raz) i wyzerowac klucze obce.';

-- Dziennik KSeF: wpis przy kazdej zmianie stanu albo numeru wystawionego
-- dokumentu (takze przy wystawieniu: not_applicable -> pending). Notatke
-- przekazuje RPC przez lokalny GUC `nes.event_invoice_ksef_note`.
CREATE OR REPLACE FUNCTION public._tg_event_invoices_ksef_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'draft' THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.event_invoice_ksef_events (
    tenant_id, invoice_id, from_status, to_status, from_number, to_number, actor_id, note
  ) VALUES (
    NEW.tenant_id, NEW.id,
    CASE WHEN OLD.status = 'draft' THEN NULL ELSE OLD.ksef_status END, NEW.ksef_status,
    OLD.ksef_number, NEW.ksef_number, auth.uid(),
    left(COALESCE(NULLIF(current_setting('nes.event_invoice_ksef_note', true), ''),
                  CASE WHEN OLD.status = 'draft' THEN 'issued' ELSE '' END), 500)
  );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_invoices_ksef_log() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_invoices_ksef_log ON public.event_invoices;
CREATE TRIGGER event_invoices_ksef_log
  AFTER UPDATE OF ksef_status, ksef_number, status ON public.event_invoices
  FOR EACH ROW
  WHEN (OLD.ksef_status IS DISTINCT FROM NEW.ksef_status OR OLD.ksef_number IS DISTINCT FROM NEW.ksef_number)
  EXECUTE FUNCTION public._tg_event_invoices_ksef_log();

-- UNIKALNOSC NUMERU KSeF W NAJEMCY (INV-17). Indeks powstaje tylko na czystych
-- danych: duplikat zapisany przed ta migracja nie moze wywrocic wdrozenia
-- (pozostale poprawki sa wazniejsze), a RPC i tak odmawia nowego duplikatu
-- (`ksef_number_taken`). Ostrzezenie wskazuje, co poprawic recznie.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.event_invoices
     WHERE ksef_number IS NOT NULL
     GROUP BY tenant_id, ksef_number
    HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'event_invoices: duplicate KSeF numbers exist - unique index event_invoices_ksef_number_unique NOT created';
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS event_invoices_ksef_number_unique
               ON public.event_invoices (tenant_id, ksef_number) WHERE ksef_number IS NOT NULL';
  END IF;
END;
$$;

-- migration-split: part 1/7 of 20261012100000_event_invoice_compliance.sql
-- CIAG DALSZY: 20261012100100 .. 20261012100600 (wdrazac PO KOLEI).
