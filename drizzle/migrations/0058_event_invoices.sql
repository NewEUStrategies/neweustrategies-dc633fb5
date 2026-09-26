-- Faktury na firme za bilety i pakiety wydarzen (takze zbiorcze), proformy, korekty, stan KSeF.
-- Blizniak: supabase/migrations/20260926110000_event_invoices.sql (tam pelny opis decyzji).
-- ----------------------------------------------------------------------------
-- 1. FUNKCJE CZYSTE: stawka VAT, netto z brutto, NIP.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_invoice_vat_percent(p_rate text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_rate WHEN '23' THEN 23 WHEN '8' THEN 8 WHEN '5' THEN 5 ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_vat_percent(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_vat_percent(text) TO authenticated, service_role;
COMMENT ON FUNCTION public._event_invoice_vat_percent(text) IS
  'Procent stawki VAT pozycji faktury wydarzenia: 23/8/5, a 0/zw/np = 0.';

CREATE OR REPLACE FUNCTION public._event_invoice_net_from_gross(p_gross bigint, p_rate text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT sign(p_gross)::bigint
    * ((2 * abs(p_gross) * 100 + (100 + public._event_invoice_vat_percent(p_rate)))
       / (2 * (100 + public._event_invoice_vat_percent(p_rate))));
$$;
REVOKE ALL ON FUNCTION public._event_invoice_net_from_gross(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_net_from_gross(bigint, text) TO authenticated, service_role;
COMMENT ON FUNCTION public._event_invoice_net_from_gross(bigint, text) IS
  'Netto pozycji z brutto: zaokraglenie polowkowe od zera w groszach, arytmetyka calkowita (lustro eventInvoiceMath.ts).';

-- Brutto z ceny NETTO (bilet z VAT doliczanym do ceny, `tax_mode =
-- 'exclusive'`): netto * (100 + stawka) / 100, zaokraglenie polowkowe od zera
-- w groszach, arytmetyka calkowita. Bez tego cennik "1000 zl + VAT" trafial na
-- szkic jako 1000 zl BRUTTO - faktura zanizona o caly VAT.
CREATE OR REPLACE FUNCTION public._event_invoice_gross_from_net(p_net bigint, p_rate text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT sign(p_net)::bigint
    * ((2 * abs(p_net) * (100 + public._event_invoice_vat_percent(p_rate)) + 100) / 200);
$$;
REVOKE ALL ON FUNCTION public._event_invoice_gross_from_net(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_gross_from_net(bigint, text) TO authenticated, service_role;
COMMENT ON FUNCTION public._event_invoice_gross_from_net(bigint, text) IS
  'Brutto z ceny netto (bilet z VAT doliczanym): zaokraglenie polowkowe od zera w groszach, arytmetyka calkowita.';

CREATE OR REPLACE FUNCTION public._event_invoice_pl_nip_valid(p_digits text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_weights integer[] := ARRAY[6, 5, 7, 2, 3, 4, 5, 6, 7];
  v_sum integer := 0;
  v_control integer;
  i integer;
BEGIN
  IF p_digits IS NULL OR p_digits !~ '^[0-9]{10}$' THEN
    RETURN false;
  END IF;
  FOR i IN 1..9 LOOP
    v_sum := v_sum + v_weights[i] * substr(p_digits, i, 1)::integer;
  END LOOP;
  v_control := v_sum % 11;
  RETURN v_control <> 10 AND v_control = substr(p_digits, 10, 1)::integer;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_pl_nip_valid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_pl_nip_valid(text) TO authenticated, service_role;
COMMENT ON FUNCTION public._event_invoice_pl_nip_valid(text) IS
  'Suma kontrolna polskiego NIP (wagi 6,5,7,2,3,4,5,6,7, modulo 11) - blizniak isValidPlNip z src/lib/billing/nip.ts.';

CREATE OR REPLACE FUNCTION public._event_invoice_tax_id_normalize(p_raw text, p_country text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm text := upper(regexp_replace(COALESCE(p_raw, ''), '[[:space:].-]', '', 'g'));
  v_digits text;
BEGIN
  IF v_norm = '' THEN
    RETURN '';
  END IF;
  IF upper(COALESCE(p_country, '')) = 'PL' THEN
    v_digits := regexp_replace(v_norm, '^PL', '');
    IF NOT public._event_invoice_pl_nip_valid(v_digits) THEN
      RETURN NULL;
    END IF;
    RETURN v_digits;
  END IF;
  IF v_norm !~ '^[A-Z0-9]{2,16}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_norm;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_tax_id_normalize(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_tax_id_normalize(text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public._event_invoice_tax_id_normalize(text, text) IS
  'Blizniak validateTaxId z src/lib/billing/nip.ts: pusty = pusty napis, PL = 10 cyfr z suma kontrolna, inne = 2-16 znakow A-Z0-9; NULL = identyfikator niepoprawny.';

CREATE OR REPLACE FUNCTION public._event_invoice_tax_key(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN v.norm ~ '^PL[0-9]{10}$' THEN substr(v.norm, 3)
    ELSE v.norm
  END
  FROM (SELECT upper(regexp_replace(COALESCE(p_raw, ''), '[[:space:].-]', '', 'g')) AS norm) AS v;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_tax_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_invoice_tax_key(text) TO authenticated, service_role;
COMMENT ON FUNCTION public._event_invoice_tax_key(text) IS
  'Klucz porownania identyfikatora podatkowego (kartoteka CRM trzyma wolny tekst): bez separatorow, wielkie litery, polski NIP bez prefiksu PL.';

-- ----------------------------------------------------------------------------
-- 2. TABELE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_invoice_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  seller_name text NOT NULL DEFAULT '',
  seller_tax_id text NOT NULL DEFAULT '',
  seller_address text NOT NULL DEFAULT '',
  seller_postal_code text NOT NULL DEFAULT '',
  seller_city text NOT NULL DEFAULT '',
  seller_country text NOT NULL DEFAULT 'PL',
  seller_email text NOT NULL DEFAULT '',
  seller_phone text NOT NULL DEFAULT '',
  seller_bank_account text NOT NULL DEFAULT '',
  seller_bank_swift text NOT NULL DEFAULT '',
  series_invoice text NOT NULL DEFAULT 'FV',
  series_proforma text NOT NULL DEFAULT 'PRO',
  series_correction text NOT NULL DEFAULT 'KOR',
  payment_days integer NOT NULL DEFAULT 14,
  default_vat_rate text NOT NULL DEFAULT '23',
  vat_exempt_basis text NOT NULL DEFAULT '',
  footer_note text NOT NULL DEFAULT '',
  default_locale text NOT NULL DEFAULT 'pl',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_invoice_settings_default_vat_rate_values
    CHECK (default_vat_rate IN ('23', '8', '5', '0', 'zw', 'np')),
  CONSTRAINT event_invoice_settings_default_locale_values
    CHECK (default_locale IN ('pl', 'en')),
  CONSTRAINT event_invoice_settings_payment_days_range CHECK (payment_days BETWEEN 0 AND 120),
  CONSTRAINT event_invoice_settings_series_format CHECK (
    series_invoice ~ '^[A-Z0-9]{1,10}$'
    AND series_proforma ~ '^[A-Z0-9]{1,10}$'
    AND series_correction ~ '^[A-Z0-9]{1,10}$'
  ),
  CONSTRAINT event_invoice_settings_enabled_confirmed CHECK (NOT enabled OR confirmed_at IS NOT NULL)
);
COMMENT ON TABLE public.event_invoice_settings IS
  'Dane wystawcy faktur wydarzen - JEDEN wiersz na najemce, wspolny dla wszystkich wydarzen. Zapis wylacznie przez admin_event_invoice_settings_save.';

CREATE TABLE IF NOT EXISTS public.event_invoice_counters (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  series text NOT NULL,
  period text NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, series, period),
  CONSTRAINT event_invoice_counters_last_seq_nonneg CHECK (last_seq >= 0),
  CONSTRAINT event_invoice_counters_period_format CHECK (period ~ '^[0-9]{4}-[0-9]{2}$')
);
COMMENT ON TABLE public.event_invoice_counters IS
  'Licznik numeracji faktur wydarzen per najemca/seria/miesiac. Przydzial WYLACZNIE przy wystawieniu (_event_invoice_next_number), pod blokada wiersza.';

CREATE TABLE IF NOT EXISTS public.event_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  event_id uuid,
  event_slug text NOT NULL DEFAULT '',
  event_title_pl text NOT NULL DEFAULT '',
  event_title_en text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'invoice',
  status text NOT NULL DEFAULT 'draft',
  series text,
  period text,
  seq integer,
  number text,
  issue_date date,
  sale_date date,
  due_date date,
  payment_method text NOT NULL DEFAULT 'transfer',
  paid_at timestamptz,
  currency text NOT NULL DEFAULT 'PLN',
  net_cents bigint NOT NULL DEFAULT 0,
  vat_cents bigint NOT NULL DEFAULT 0,
  gross_cents bigint NOT NULL DEFAULT 0,
  seller jsonb,
  vat_exempt_basis text NOT NULL DEFAULT '',
  buyer_is_company boolean NOT NULL DEFAULT true,
  buyer_name text NOT NULL DEFAULT '',
  buyer_tax_id text NOT NULL DEFAULT '',
  buyer_country text NOT NULL DEFAULT 'PL',
  buyer_address text NOT NULL DEFAULT '',
  buyer_postal_code text NOT NULL DEFAULT '',
  buyer_city text NOT NULL DEFAULT '',
  buyer_email text NOT NULL DEFAULT '',
  po_number text NOT NULL DEFAULT '',
  recipient_name text NOT NULL DEFAULT '',
  recipient_address text NOT NULL DEFAULT '',
  buyer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  buyer_person_id uuid,
  crm_company_id uuid,
  corrects_invoice_id uuid,
  correction_mode text,
  correction_reason text NOT NULL DEFAULT '',
  source_proforma_id uuid,
  locale text NOT NULL DEFAULT 'pl',
  note text NOT NULL DEFAULT '',
  ksef_status text NOT NULL DEFAULT 'not_applicable',
  ksef_number text,
  ksef_updated_at timestamptz,
  cancel_reason text NOT NULL DEFAULT '',
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at timestamptz,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_invoices_kind_values CHECK (kind IN ('invoice', 'proforma', 'correction')),
  CONSTRAINT event_invoices_status_values CHECK (status IN ('draft', 'issued', 'cancelled')),
  CONSTRAINT event_invoices_payment_method_values
    CHECK (payment_method IN ('card', 'transfer', 'other')),
  CONSTRAINT event_invoices_currency_values CHECK (currency IN ('PLN', 'EUR')),
  CONSTRAINT event_invoices_locale_values CHECK (locale IN ('pl', 'en')),
  CONSTRAINT event_invoices_ksef_status_values
    CHECK (ksef_status IN ('not_applicable', 'pending', 'sent', 'accepted', 'rejected')),
  CONSTRAINT event_invoices_correction_mode_values
    CHECK (correction_mode IS NULL OR correction_mode IN ('full', 'partial')),
  CONSTRAINT event_invoices_totals CHECK (gross_cents = net_cents + vat_cents),
  CONSTRAINT event_invoices_number_stamp CHECK (
    (status = 'draft' AND number IS NULL AND issued_at IS NULL)
    OR (status = 'issued' AND number IS NOT NULL AND issued_at IS NOT NULL AND issue_date IS NOT NULL)
    OR status = 'cancelled'
  ),
  CONSTRAINT event_invoices_cancel_stamp CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT event_invoices_correction_ref CHECK (
    (kind = 'correction') = (corrects_invoice_id IS NOT NULL)
    AND (kind = 'correction') = (correction_mode IS NOT NULL)
  ),
  CONSTRAINT event_invoices_ksef_number_len
    CHECK (ksef_number IS NULL OR char_length(ksef_number) BETWEEN 1 AND 64),
  CONSTRAINT event_invoices_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_invoices_number_unique UNIQUE (tenant_id, number),
  CONSTRAINT event_invoices_seq_unique UNIQUE (tenant_id, series, period, seq),
  CONSTRAINT event_invoices_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE SET NULL (event_id),
  CONSTRAINT event_invoices_crm_company_fk FOREIGN KEY (tenant_id, crm_company_id)
    REFERENCES public.crm_companies (tenant_id, id) ON DELETE SET NULL (crm_company_id),
  CONSTRAINT event_invoices_buyer_person_fk FOREIGN KEY (tenant_id, buyer_person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE SET NULL (buyer_person_id),
  CONSTRAINT event_invoices_corrects_fk FOREIGN KEY (tenant_id, corrects_invoice_id)
    REFERENCES public.event_invoices (tenant_id, id),
  CONSTRAINT event_invoices_source_proforma_fk FOREIGN KEY (tenant_id, source_proforma_id)
    REFERENCES public.event_invoices (tenant_id, id)
);
COMMENT ON TABLE public.event_invoices IS
  'Dokumenty organizatora (faktura, proforma, korekta) za bilety i pakiety wydarzen. Migawka sprzedawcy, nabywcy i tytulu wydarzenia; po wystawieniu niezmienne (trigger). Zapis wylacznie przez RPC admin_event_invoice_*.';

CREATE INDEX IF NOT EXISTS event_invoices_event_idx
  ON public.event_invoices (tenant_id, event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_invoices_buyer_user_idx
  ON public.event_invoices (tenant_id, buyer_user_id, created_at DESC)
  WHERE buyer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_invoices_corrects_idx
  ON public.event_invoices (tenant_id, corrects_invoice_id)
  WHERE corrects_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_invoices_proforma_idx
  ON public.event_invoices (tenant_id, source_proforma_id)
  WHERE source_proforma_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_invoices_ksef_pending_idx
  ON public.event_invoices (tenant_id, ksef_status)
  WHERE status = 'issued' AND ksef_status = 'pending';

CREATE TABLE IF NOT EXISTS public.event_invoice_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  source_kind text NOT NULL,
  registration_id uuid,
  package_order_id uuid,
  status text NOT NULL DEFAULT 'pending',
  buyer_is_company boolean NOT NULL DEFAULT true,
  buyer_name text NOT NULL,
  buyer_tax_id text NOT NULL DEFAULT '',
  buyer_country text NOT NULL DEFAULT 'PL',
  buyer_address text NOT NULL DEFAULT '',
  buyer_postal_code text NOT NULL DEFAULT '',
  buyer_city text NOT NULL DEFAULT '',
  buyer_email text NOT NULL DEFAULT '',
  po_number text NOT NULL DEFAULT '',
  recipient_name text NOT NULL DEFAULT '',
  recipient_address text NOT NULL DEFAULT '',
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  crm_company_id uuid,
  invoice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_invoice_requests_status_values
    CHECK (status IN ('pending', 'invoiced', 'cancelled')),
  CONSTRAINT event_invoice_requests_source_kind_values
    CHECK (source_kind IN ('registration', 'package_order')),
  CONSTRAINT event_invoice_requests_one_source CHECK (
    (source_kind = 'registration' AND registration_id IS NOT NULL AND package_order_id IS NULL)
    OR (source_kind = 'package_order' AND package_order_id IS NOT NULL AND registration_id IS NULL)
  ),
  CONSTRAINT event_invoice_requests_company_tax_id CHECK (NOT buyer_is_company OR buyer_tax_id <> ''),
  CONSTRAINT event_invoice_requests_invoiced_link CHECK (status <> 'invoiced' OR invoice_id IS NOT NULL),
  CONSTRAINT event_invoice_requests_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_invoice_requests_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_invoice_requests_registration_fk FOREIGN KEY (tenant_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_invoice_requests_package_order_fk FOREIGN KEY (tenant_id, package_order_id)
    REFERENCES public.event_package_orders (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_invoice_requests_crm_company_fk FOREIGN KEY (tenant_id, crm_company_id)
    REFERENCES public.crm_companies (tenant_id, id) ON DELETE SET NULL (crm_company_id),
  CONSTRAINT event_invoice_requests_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES public.event_invoices (tenant_id, id)
);
COMMENT ON TABLE public.event_invoice_requests IS
  'Prosba kupujacego o fakture: dane nabywcy dopiete do zapisu (prowadzacego grupy) albo zamowienia pakietu PRZED wystawieniem. Zapis wylacznie przez event_invoice_request_save/_cancel i wystawienie.';

CREATE UNIQUE INDEX IF NOT EXISTS event_invoice_requests_registration_once
  ON public.event_invoice_requests (tenant_id, registration_id)
  WHERE registration_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS event_invoice_requests_package_once
  ON public.event_invoice_requests (tenant_id, package_order_id)
  WHERE package_order_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS event_invoice_requests_event_idx
  ON public.event_invoice_requests (tenant_id, event_id, status, created_at);

CREATE TABLE IF NOT EXISTS public.event_invoice_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  source_kind text NOT NULL,
  registration_id uuid,
  package_order_id uuid,
  payment_order_id uuid REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  person_id uuid,
  seats integer NOT NULL DEFAULT 1,
  gross_cents bigint NOT NULL DEFAULT 0,
  paid_at timestamptz,
  covers boolean NOT NULL DEFAULT false,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_invoice_sources_source_kind_values
    CHECK (source_kind IN ('registration', 'package_order')),
  CONSTRAINT event_invoice_sources_single_ref
    CHECK (NOT (registration_id IS NOT NULL AND package_order_id IS NOT NULL)),
  CONSTRAINT event_invoice_sources_seats_positive CHECK (seats > 0),
  CONSTRAINT event_invoice_sources_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_invoice_sources_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES public.event_invoices (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_invoice_sources_registration_fk FOREIGN KEY (tenant_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, id) ON DELETE SET NULL (registration_id),
  CONSTRAINT event_invoice_sources_package_order_fk FOREIGN KEY (tenant_id, package_order_id)
    REFERENCES public.event_package_orders (tenant_id, id) ON DELETE SET NULL (package_order_id)
);
COMMENT ON TABLE public.event_invoice_sources IS
  'Zamowienia objete dokumentem (zapis prowadzacego grupy albo zamowienie pakietu). covers = faktura (nie proforma, nie korekta); released_at = zwolnione anulowaniem albo pelna korekta.';

CREATE UNIQUE INDEX IF NOT EXISTS event_invoice_sources_registration_once
  ON public.event_invoice_sources (tenant_id, registration_id)
  WHERE registration_id IS NOT NULL AND covers AND released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_invoice_sources_package_once
  ON public.event_invoice_sources (tenant_id, package_order_id)
  WHERE package_order_id IS NOT NULL AND covers AND released_at IS NULL;
CREATE INDEX IF NOT EXISTS event_invoice_sources_invoice_idx
  ON public.event_invoice_sources (tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS public.event_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  position integer NOT NULL,
  description text NOT NULL,
  unit text NOT NULL DEFAULT 'szt.',
  quantity integer NOT NULL,
  unit_gross_cents bigint NOT NULL,
  unit_net_cents bigint NOT NULL,
  vat_rate text NOT NULL,
  net_cents bigint NOT NULL,
  vat_cents bigint NOT NULL,
  gross_cents bigint NOT NULL,
  ticket_type_id uuid,
  corrects_line_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_invoice_lines_vat_rate_values
    CHECK (vat_rate IN ('23', '8', '5', '0', 'zw', 'np')),
  CONSTRAINT event_invoice_lines_totals CHECK (gross_cents = net_cents + vat_cents),
  CONSTRAINT event_invoice_lines_gross_formula CHECK (gross_cents = quantity::bigint * unit_gross_cents),
  CONSTRAINT event_invoice_lines_quantity_range
    CHECK (quantity <> 0 AND quantity BETWEEN -10000 AND 10000),
  CONSTRAINT event_invoice_lines_unit_gross_range
    CHECK (unit_gross_cents BETWEEN 0 AND 100000000),
  CONSTRAINT event_invoice_lines_description_len
    CHECK (char_length(btrim(description)) BETWEEN 1 AND 300),
  CONSTRAINT event_invoice_lines_unit_len CHECK (char_length(btrim(unit)) BETWEEN 1 AND 20),
  CONSTRAINT event_invoice_lines_position_positive CHECK (position > 0),
  CONSTRAINT event_invoice_lines_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_invoice_lines_position_unique UNIQUE (invoice_id, position),
  CONSTRAINT event_invoice_lines_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES public.event_invoices (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE public.event_invoice_lines IS
  'Pozycje dokumentu (to, co jest drukowane). Wartosc = ilosc x cena brutto, netto i VAT liczone na pozycji. Zmiana wylacznie na szkicu (trigger).';

-- ----------------------------------------------------------------------------
-- 3. TRIGGERY: updated_at i NIEZMIENNOSC wystawionego dokumentu.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS event_invoice_settings_touch_updated_at ON public.event_invoice_settings;
CREATE TRIGGER event_invoice_settings_touch_updated_at
  BEFORE UPDATE ON public.event_invoice_settings
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

DROP TRIGGER IF EXISTS event_invoice_requests_touch_updated_at ON public.event_invoice_requests;
CREATE TRIGGER event_invoice_requests_touch_updated_at
  BEFORE UPDATE ON public.event_invoice_requests
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

DROP TRIGGER IF EXISTS event_invoices_touch_updated_at ON public.event_invoices;
CREATE TRIGGER event_invoices_touch_updated_at
  BEFORE UPDATE ON public.event_invoices
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE OR REPLACE FUNCTION public._tg_event_invoices_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_free text[] := ARRAY[
    'ksef_status', 'ksef_number', 'ksef_updated_at', 'paid_at', 'status', 'cancel_reason',
    'cancelled_at', 'cancelled_by', 'updated_at', 'event_id', 'crm_company_id', 'buyer_user_id',
    'buyer_person_id', 'created_by', 'issued_by'
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
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_invoices_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._tg_event_invoices_guard() IS
  'Niezmiennosc wystawionego dokumentu: poza szkicem wolno zmienic tylko ksef_*, paid_at, issued -> cancelled (z powodem) i wyzerowac klucze obce.';

DROP TRIGGER IF EXISTS event_invoices_guard ON public.event_invoices;
CREATE TRIGGER event_invoices_guard
  BEFORE UPDATE OR DELETE ON public.event_invoices
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_invoices_guard();

CREATE OR REPLACE FUNCTION public._tg_event_invoice_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT i.status INTO v_status FROM public.event_invoices i
   WHERE i.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'invoice_immutable: lines of an issued document cannot change' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_invoice_lines_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._tg_event_invoice_lines_guard() IS
  'Pozycje zmieniaja sie wylacznie na szkicu.';

DROP TRIGGER IF EXISTS event_invoice_lines_guard ON public.event_invoice_lines;
CREATE TRIGGER event_invoice_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.event_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_invoice_lines_guard();

CREATE OR REPLACE FUNCTION public._tg_event_invoice_sources_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT i.status INTO v_status FROM public.event_invoices i
   WHERE i.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.invoice_id = OLD.invoice_id
     AND NEW.source_kind = OLD.source_kind
     AND NEW.covers = OLD.covers
     AND NEW.seats = OLD.seats
     AND NEW.gross_cents = OLD.gross_cents
     AND (NEW.registration_id IS NOT DISTINCT FROM OLD.registration_id OR NEW.registration_id IS NULL)
     AND (NEW.package_order_id IS NOT DISTINCT FROM OLD.package_order_id OR NEW.package_order_id IS NULL)
     AND (NEW.payment_order_id IS NOT DISTINCT FROM OLD.payment_order_id OR NEW.payment_order_id IS NULL)
     AND (NEW.person_id IS NOT DISTINCT FROM OLD.person_id)
     AND (NEW.released_at IS NOT DISTINCT FROM OLD.released_at
          OR (OLD.released_at IS NULL AND NEW.released_at IS NOT NULL)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invoice_immutable: sources of an issued document can only be released'
    USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public._tg_event_invoice_sources_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._tg_event_invoice_sources_guard() IS
  'Zrodla zmieniaja sie tylko na szkicu; zrodlo wystawionego dokumentu moze wylacznie zostac zwolnione (released_at) albo stracic klucz usunietego zamowienia.';

DROP TRIGGER IF EXISTS event_invoice_sources_guard ON public.event_invoice_sources;
CREATE TRIGGER event_invoice_sources_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.event_invoice_sources
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_invoice_sources_guard();

-- ----------------------------------------------------------------------------
-- 4. RLS, GRANTY, POLITYKI ODCZYTU (admin/super_admin najemcy; zapis: RPC).
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.event_invoice_settings FROM anon, authenticated;
GRANT SELECT ON public.event_invoice_settings TO authenticated;
GRANT ALL ON public.event_invoice_settings TO service_role;
ALTER TABLE public.event_invoice_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.event_invoice_counters FROM anon, authenticated;
GRANT ALL ON public.event_invoice_counters TO service_role;
ALTER TABLE public.event_invoice_counters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.event_invoices FROM anon, authenticated;
GRANT SELECT ON public.event_invoices TO authenticated;
GRANT ALL ON public.event_invoices TO service_role;
ALTER TABLE public.event_invoices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.event_invoice_requests FROM anon, authenticated;
GRANT SELECT ON public.event_invoice_requests TO authenticated;
GRANT ALL ON public.event_invoice_requests TO service_role;
ALTER TABLE public.event_invoice_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.event_invoice_sources FROM anon, authenticated;
GRANT SELECT ON public.event_invoice_sources TO authenticated;
GRANT ALL ON public.event_invoice_sources TO service_role;
ALTER TABLE public.event_invoice_sources ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.event_invoice_lines FROM anon, authenticated;
GRANT SELECT ON public.event_invoice_lines TO authenticated;
GRANT ALL ON public.event_invoice_lines TO service_role;
ALTER TABLE public.event_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_invoice_settings_staff_read" ON public.event_invoice_settings;
CREATE POLICY "event_invoice_settings_staff_read"
  ON public.event_invoice_settings FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_invoices_staff_read" ON public.event_invoices;
CREATE POLICY "event_invoices_staff_read"
  ON public.event_invoices FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_invoice_requests_staff_read" ON public.event_invoice_requests;
CREATE POLICY "event_invoice_requests_staff_read"
  ON public.event_invoice_requests FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_invoice_sources_staff_read" ON public.event_invoice_sources;
CREATE POLICY "event_invoice_sources_staff_read"
  ON public.event_invoice_sources FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_invoice_lines_staff_read" ON public.event_invoice_lines;
CREATE POLICY "event_invoice_lines_staff_read"
  ON public.event_invoice_lines FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

-- ----------------------------------------------------------------------------
-- 5. FUNKCJE WEWNETRZNE (tylko z cial SECURITY DEFINER; EXECUTE: service_role).
-- ----------------------------------------------------------------------------

-- Czyszczenie i walidacja danych nabywcy. Jedno zrodlo regul dla prosby
-- kupujacego, szkicu panelu i wystawienia (lustro: eventInvoiceBuyerDraft.ts).
CREATE OR REPLACE FUNCTION public._event_invoice_buyer_clean(p_buyer jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_company boolean := COALESCE(NULLIF(p_buyer->>'is_company', '')::boolean, true);
  v_name text := btrim(COALESCE(p_buyer->>'name', ''));
  v_country text := upper(btrim(COALESCE(p_buyer->>'country', '')));
  v_tax text;
  v_address text := btrim(COALESCE(p_buyer->>'address', ''));
  v_postal text := btrim(COALESCE(p_buyer->>'postal_code', ''));
  v_city text := btrim(COALESCE(p_buyer->>'city', ''));
  v_email text := lower(btrim(COALESCE(p_buyer->>'email', '')));
  v_po text := btrim(COALESCE(p_buyer->>'po_number', ''));
  v_recipient_name text := btrim(COALESCE(p_buyer->>'recipient_name', ''));
  v_recipient_address text := btrim(COALESCE(p_buyer->>'recipient_address', ''));
BEGIN
  IF v_country = '' THEN
    v_country := 'PL';
  END IF;
  IF char_length(v_name) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'invalid_buyer_name: buyer name must have 2-200 characters' USING ERRCODE = '22023';
  END IF;
  IF v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid_country: country must be an ISO 3166 alpha-2 code' USING ERRCODE = '22023';
  END IF;
  v_tax := public._event_invoice_tax_id_normalize(p_buyer->>'tax_id', v_country);
  IF v_tax IS NULL THEN
    RAISE EXCEPTION 'invalid_tax_id: tax identifier is not valid for the country' USING ERRCODE = '22023';
  END IF;
  IF v_is_company AND v_tax = '' THEN
    RAISE EXCEPTION 'tax_id_required: a company buyer needs a tax identifier' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_address) NOT BETWEEN 1 AND 200
     OR char_length(v_city) NOT BETWEEN 1 AND 100
     OR char_length(v_postal) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_buyer_address: address, postal code and city are required' USING ERRCODE = '22023';
  END IF;
  IF v_country = 'PL' AND v_postal !~ '^[0-9]{2}-[0-9]{3}$' THEN
    RAISE EXCEPTION 'invalid_postal_code: polish postal code has the form 00-000' USING ERRCODE = '22023';
  END IF;
  IF v_email <> '' AND (char_length(v_email) > 254
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$') THEN
    RAISE EXCEPTION 'invalid_email: invoice e-mail address is not valid' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_po) > 100 THEN
    RAISE EXCEPTION 'invalid_po_number: order reference has more than 100 characters' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_recipient_name) > 200 OR char_length(v_recipient_address) > 300 THEN
    RAISE EXCEPTION 'invalid_recipient: recipient name or address is too long' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'is_company', v_is_company,
    'name', v_name,
    'tax_id', v_tax,
    'country', v_country,
    'address', v_address,
    'postal_code', v_postal,
    'city', v_city,
    'email', v_email,
    'po_number', v_po,
    'recipient_name', v_recipient_name,
    'recipient_address', v_recipient_address
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_buyer_clean(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_buyer_clean(jsonb) TO service_role;
COMMENT ON FUNCTION public._event_invoice_buyer_clean(jsonb) IS
  'Walidacja i normalizacja danych nabywcy (nazwa, NIP/VAT ID wg kraju, adres, kod PL 00-000, e-mail, numer zamowienia, odbiorca).';

-- Dane nabywcy zapisane na dokumencie, w ksztalcie wejscia _event_invoice_buyer_clean.
CREATE OR REPLACE FUNCTION public._event_invoice_buyer_json(p_invoice public.event_invoices)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'is_company', p_invoice.buyer_is_company,
    'name', p_invoice.buyer_name,
    'tax_id', p_invoice.buyer_tax_id,
    'country', p_invoice.buyer_country,
    'address', p_invoice.buyer_address,
    'postal_code', p_invoice.buyer_postal_code,
    'city', p_invoice.buyer_city,
    'email', p_invoice.buyer_email,
    'po_number', p_invoice.po_number,
    'recipient_name', p_invoice.recipient_name,
    'recipient_address', p_invoice.recipient_address
  );
$$;
REVOKE ALL ON FUNCTION public._event_invoice_buyer_json(public.event_invoices) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_buyer_json(public.event_invoices) TO service_role;

-- Ustawienia wystawcy jako obiekt (brak wiersza = wartosci domyslne, wylaczone).
CREATE OR REPLACE FUNCTION public._event_invoice_settings_json(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.event_invoice_settings;
BEGIN
  SELECT * INTO s FROM public.event_invoice_settings x WHERE x.tenant_id = p_tenant;
  IF NOT FOUND THEN
    s.enabled := false;
    s.seller_name := '';
    s.seller_tax_id := '';
    s.seller_address := '';
    s.seller_postal_code := '';
    s.seller_city := '';
    s.seller_country := 'PL';
    s.seller_email := '';
    s.seller_phone := '';
    s.seller_bank_account := '';
    s.seller_bank_swift := '';
    s.series_invoice := 'FV';
    s.series_proforma := 'PRO';
    s.series_correction := 'KOR';
    s.payment_days := 14;
    s.default_vat_rate := '23';
    s.vat_exempt_basis := '';
    s.footer_note := '';
    s.default_locale := 'pl';
  END IF;
  RETURN jsonb_build_object(
    'enabled', s.enabled,
    'confirmed_at', s.confirmed_at,
    'seller_name', s.seller_name,
    'seller_tax_id', s.seller_tax_id,
    'seller_address', s.seller_address,
    'seller_postal_code', s.seller_postal_code,
    'seller_city', s.seller_city,
    'seller_country', s.seller_country,
    'seller_email', s.seller_email,
    'seller_phone', s.seller_phone,
    'seller_bank_account', s.seller_bank_account,
    'seller_bank_swift', s.seller_bank_swift,
    'series_invoice', s.series_invoice,
    'series_proforma', s.series_proforma,
    'series_correction', s.series_correction,
    'payment_days', s.payment_days,
    'default_vat_rate', s.default_vat_rate,
    'vat_exempt_basis', s.vat_exempt_basis,
    'footer_note', s.footer_note,
    'default_locale', s.default_locale,
    'updated_at', s.updated_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_settings_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_settings_json(uuid) TO service_role;

-- Migawka sprzedawcy na dokumencie: dane wystawcy bez ustawien technicznych.
CREATE OR REPLACE FUNCTION public._event_invoice_seller_json(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public._event_invoice_settings_json(p_tenant)
    - 'enabled' - 'confirmed_at' - 'series_invoice' - 'series_proforma' - 'series_correction'
    - 'default_vat_rate' - 'default_locale' - 'updated_at' - 'payment_days' - 'vat_exempt_basis';
$$;
REVOKE ALL ON FUNCTION public._event_invoice_seller_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_seller_json(uuid) TO service_role;

-- Czy organizator moze wystawic WLASNA fakture VAT za zamowienie oplacone
-- KARTA (NULL = moze, inaczej kod odmowy). Kasa nie stempluje plaszczyzny
-- rozliczen na zamowieniu (zmiana sciezki pieniedzy jest poza zakresem tego
-- pliku), wiec regula jest KONSERWATYWNA - lepiej odmowic, niz wystawic
-- druga fakture za te sama sprzedaz:
--   * brak wiersza `checkout_settings` albo `automatic_tax` falsz = tryb
--     operatora (MoR, ta sama regula co checkoutBillingPlane()): sprzedawca
--     jest operator -> `mor_seller_conflict`;
--   * wlasne konto z `invoice_creation` = Stripe sam wystawia fakture za
--     platnosc jednorazowa -> `operator_invoice_enabled`;
--   * ustawienia kasy zmienione PO zalozeniu zamowienia (`updated_at` >
--     `payment_orders.created_at`) = nie wiadomo, na jakiej plaszczyznie
--     zamowienie sprzedano -> `billing_plane_unknown`.
CREATE OR REPLACE FUNCTION public._event_invoice_card_block(p_tenant uuid, p_order uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN c.tenant_id IS NULL OR NOT c.automatic_tax THEN 'mor_seller_conflict'
    WHEN c.invoice_creation THEN 'operator_invoice_enabled'
    WHEN o.id IS NULL OR c.updated_at > o.created_at THEN 'billing_plane_unknown'
  END
    FROM (SELECT 1) AS one
    LEFT JOIN public.checkout_settings c ON c.tenant_id = p_tenant
    LEFT JOIN public.payment_orders o ON o.id = p_order AND o.tenant_id = p_tenant;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_card_block(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_card_block(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_card_block(uuid, uuid) IS
  'NULL = organizator moze zafakturowac zamowienie z karty; inaczej mor_seller_conflict (tryb operatora), operator_invoice_enabled (Stripe wystawia fakture) albo billing_plane_unknown (ustawienia kasy zmienione po zamowieniu).';

-- Numer bez luk: licznik per najemca/seria/miesiac pod blokada wiersza
-- (INSERT ... ON CONFLICT DO UPDATE blokuje wiersz do konca transakcji, a
-- wycofana transakcja wycofuje tez przyrost licznika).
CREATE OR REPLACE FUNCTION public._event_invoice_next_number(p_tenant uuid, p_series text, p_date date)
RETURNS TABLE(out_period text, out_seq integer, out_number text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period text := to_char(p_date, 'YYYY-MM');
  v_seq integer;
BEGIN
  INSERT INTO public.event_invoice_counters AS c (tenant_id, series, period, last_seq)
  VALUES (p_tenant, p_series, v_period, 1)
  ON CONFLICT (tenant_id, series, period)
  DO UPDATE SET last_seq = c.last_seq + 1, updated_at = now()
  RETURNING c.last_seq INTO v_seq;
  RETURN QUERY SELECT
    v_period,
    v_seq,
    p_series || '/' || to_char(p_date, 'YYYY') || '/' || to_char(p_date, 'MM') || '/'
      || CASE WHEN v_seq < 10000 THEN lpad(v_seq::text, 4, '0') ELSE v_seq::text END;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_next_number(uuid, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_next_number(uuid, text, date) TO service_role;
COMMENT ON FUNCTION public._event_invoice_next_number(uuid, text, date) IS
  'Kolejny numer <SERIA>/<RRRR>/<MM>/<NNNN> w miesiacu daty wystawienia; licznik pod blokada wiersza, bez luk.';

-- Wstawia pozycje do szkicu z wyliczonym netto/VAT (kolejna pozycja).
CREATE OR REPLACE FUNCTION public._event_invoice_add_line(
  p_tenant uuid, p_invoice uuid, p_description text, p_unit text, p_quantity integer,
  p_unit_gross bigint, p_rate text, p_ticket_type uuid DEFAULT NULL, p_corrects_line uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gross bigint := p_quantity::bigint * p_unit_gross;
  v_net bigint := public._event_invoice_net_from_gross(p_quantity::bigint * p_unit_gross, p_rate);
  v_position integer;
  v_id uuid;
BEGIN
  SELECT COALESCE(max(l.position), 0) + 1 INTO v_position
    FROM public.event_invoice_lines l
   WHERE l.invoice_id = p_invoice AND l.tenant_id = p_tenant;
  INSERT INTO public.event_invoice_lines (
    tenant_id, invoice_id, position, description, unit, quantity, unit_gross_cents,
    unit_net_cents, vat_rate, net_cents, vat_cents, gross_cents, ticket_type_id, corrects_line_id
  ) VALUES (
    p_tenant, p_invoice, v_position, btrim(p_description), btrim(p_unit), p_quantity, p_unit_gross,
    public._event_invoice_net_from_gross(p_unit_gross, p_rate), p_rate, v_net, v_gross - v_net,
    v_gross, p_ticket_type, p_corrects_line
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_add_line(uuid, uuid, text, text, integer, bigint, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_add_line(uuid, uuid, text, text, integer, bigint, text, uuid, uuid)
  TO service_role;

-- Sumy dokumentu = sumy pozycji (autorytet; lustro invoiceTotals w TS).
CREATE OR REPLACE FUNCTION public._event_invoice_recalc(p_tenant uuid, p_invoice uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.event_invoices i
     SET net_cents = t.net, vat_cents = t.vat, gross_cents = t.gross
    FROM (
      SELECT COALESCE(sum(l.net_cents), 0)::bigint AS net,
             COALESCE(sum(l.vat_cents), 0)::bigint AS vat,
             COALESCE(sum(l.gross_cents), 0)::bigint AS gross
        FROM public.event_invoice_lines l
       WHERE l.invoice_id = p_invoice AND l.tenant_id = p_tenant
    ) AS t
   WHERE i.id = p_invoice AND i.tenant_id = p_tenant;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_recalc(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_recalc(uuid, uuid) TO service_role;

-- STAN BIEZACY FAKTURY PO KOREKTACH. Kolejna korekta musi wyjsc od tego, co
-- faktura znaczy PO wczesniejszych korektach, a nie od jej pierwotnych
-- pozycji - inaczej korekta czesciowa, a po niej pelna, zwracala wiecej, niz
-- zafakturowano. Stan = pozycje faktury + pozycje WYSTAWIONYCH korekt
-- (opcjonalnie + wskazany szkic korekty), zgrupowane po KOTWICY (pozycja
-- faktury albo pozycja dopisana korekta; pozycja korekty wskazuje swoja
-- kotwice w `corrects_line_id`) oraz po (cena brutto, stawka). Czysty stan
-- ma na kotwice najwyzej jedna grupe z dodatnia iloscia, a netto grupy
-- rowne netto liczonemu z jej brutto - wystawienie korekty tego pilnuje.
CREATE OR REPLACE FUNCTION public._event_invoice_state(p_tenant uuid, p_invoice uuid, p_draft uuid)
RETURNS TABLE(
  anchor_id uuid, unit_gross_cents bigint, vat_rate text, quantity bigint, net_cents bigint, gross_cents bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN l.invoice_id = p_invoice OR l.corrects_line_id IS NULL THEN l.id ELSE l.corrects_line_id END,
         l.unit_gross_cents, l.vat_rate, sum(l.quantity)::bigint, sum(l.net_cents)::bigint,
         sum(l.gross_cents)::bigint
    FROM public.event_invoice_lines l
    JOIN public.event_invoices d ON d.id = l.invoice_id AND d.tenant_id = l.tenant_id
   WHERE l.tenant_id = p_tenant
     AND (d.id = p_invoice
          OR (d.corrects_invoice_id = p_invoice AND (d.status = 'issued' OR d.id = p_draft)))
   GROUP BY 1, 2, 3;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_state(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_state(uuid, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_state(uuid, uuid, uuid) IS
  'Stan faktury po wystawionych korektach (i opcjonalnie szkicu korekty): suma pozycji per kotwica, cena brutto i stawka.';

-- Biezace pozycje faktury do korekty (panel i admin_event_invoice_correction_create):
-- jedna na kotwice, z iloscia, cena i stawka PO wczesniejszych korektach
-- (ilosc 0 = pozycja juz usunieta korekta).
CREATE OR REPLACE FUNCTION public._event_invoice_current_lines(p_tenant uuid, p_invoice uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH st AS (
    SELECT * FROM public._event_invoice_state(p_tenant, p_invoice, NULL)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'line_id', r.id,
           'description', r.description,
           'unit', r.unit,
           'quantity', COALESCE(g.quantity, 0),
           'unit_gross_cents', COALESCE(g.unit_gross_cents, r.unit_gross_cents),
           'vat_rate', COALESCE(g.vat_rate, r.vat_rate),
           'ticket_type_id', r.ticket_type_id
         ) ORDER BY (d.id <> p_invoice), d.created_at, d.id, r.position), '[]'::jsonb)
    FROM public.event_invoice_lines r
    JOIN public.event_invoices d ON d.id = r.invoice_id AND d.tenant_id = r.tenant_id
    LEFT JOIN LATERAL (
      SELECT st.quantity, st.unit_gross_cents, st.vat_rate
        FROM st
       WHERE st.anchor_id = r.id AND st.quantity <> 0
       ORDER BY st.quantity DESC
       LIMIT 1
    ) AS g ON true
   WHERE r.tenant_id = p_tenant
     AND (d.id = p_invoice
          OR (d.corrects_invoice_id = p_invoice AND d.status = 'issued' AND r.corrects_line_id IS NULL));
$$;
REVOKE ALL ON FUNCTION public._event_invoice_current_lines(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_current_lines(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_current_lines(uuid, uuid) IS
  'Pozycje faktury po wystawionych korektach (jedna na kotwice): podstawa kolejnej korekty i podgladu w panelu.';

-- Zamiana calej listy pozycji szkicu (edycja w panelu). Walidacja ksztaltu,
-- ilosci (ujemne tylko na korekcie), ceny, stawki, opisu i jednostki.
CREATE OR REPLACE FUNCTION public._event_invoice_replace_lines(
  p_tenant uuid, p_invoice uuid, p_kind text, p_lines jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line jsonb;
  v_qty integer;
  v_unit_gross bigint;
  v_rate text;
  v_description text;
  v_unit text;
  v_corrects uuid;
  v_target uuid;
BEGIN
  SELECT i.corrects_invoice_id INTO v_target
    FROM public.event_invoices i WHERE i.id = p_invoice AND i.tenant_id = p_tenant;
  -- CASE, nie OR: kolejnosc wyliczania OR nie jest gwarantowana, a dlugosc
  -- obiektu JSON rzuca wyjatek zamiast kodu odmowy.
  IF COALESCE(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN jsonb_array_length(p_lines) END, 0) = 0 THEN
    RAISE EXCEPTION 'no_lines: a document needs at least one line' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'too_many_lines: a document holds at most 200 lines' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.event_invoice_lines l WHERE l.invoice_id = p_invoice AND l.tenant_id = p_tenant;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_qty := NULLIF(v_line->>'quantity', '')::integer;
    v_unit_gross := NULLIF(v_line->>'unit_gross_cents', '')::bigint;
    v_rate := COALESCE(v_line->>'vat_rate', '');
    v_description := btrim(COALESCE(v_line->>'description', ''));
    v_unit := btrim(COALESCE(v_line->>'unit', ''));
    IF v_qty IS NULL OR v_qty = 0 OR abs(v_qty) > 10000 OR (p_kind <> 'correction' AND v_qty < 0) THEN
      RAISE EXCEPTION 'invalid_quantity: quantity must be 1-10000 (negative only on a correction)'
        USING ERRCODE = '22023';
    END IF;
    IF v_unit_gross IS NULL OR v_unit_gross < 0 OR v_unit_gross > 100000000 THEN
      RAISE EXCEPTION 'invalid_price: unit gross price must be 0-1000000.00' USING ERRCODE = '22023';
    END IF;
    IF v_rate NOT IN ('23', '8', '5', '0', 'zw', 'np') THEN
      RAISE EXCEPTION 'invalid_vat_rate: unknown VAT rate' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_description) NOT BETWEEN 1 AND 300 OR char_length(v_unit) NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'invalid_line: description (1-300) and unit (1-20) are required'
        USING ERRCODE = '22023';
    END IF;
    -- Odwolanie do pozycji ma sens WYLACZNIE na korekcie i tylko do "kotwicy"
    -- stanu faktury korygowanej (jej pozycja albo pozycja dopisana wystawiona
    -- korekta) - na tym stoi liczenie stanu po korektach.
    v_corrects := CASE WHEN p_kind = 'correction' THEN NULLIF(v_line->>'corrects_line_id', '')::uuid END;
    IF v_corrects IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_invoice_lines r
        JOIN public.event_invoices d ON d.id = r.invoice_id AND d.tenant_id = r.tenant_id
       WHERE r.id = v_corrects AND r.tenant_id = p_tenant
         AND (d.id = v_target
              OR (d.corrects_invoice_id = v_target AND d.status = 'issued' AND r.corrects_line_id IS NULL))
    ) THEN
      RAISE EXCEPTION 'invalid_line: a corrected line must belong to the corrected invoice'
        USING ERRCODE = '22023';
    END IF;
    PERFORM public._event_invoice_add_line(
      p_tenant, p_invoice, v_description, v_unit, v_qty, v_unit_gross, v_rate,
      NULLIF(v_line->>'ticket_type_id', '')::uuid, v_corrects
    );
  END LOOP;
  PERFORM public._event_invoice_recalc(p_tenant, p_invoice);
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_replace_lines(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_replace_lines(uuid, uuid, text, jsonb) TO service_role;

-- Zamowienie (zrodlo dokumentu) w stanie z TEJ chwili: kwota, zamowienie
-- z karty, zaplata, opis pozycji. Jedno zrodlo prawdy dla szkicu, dla
-- proformy -> faktury i dla ponownego sprawdzenia przy wystawieniu: szkic
-- albo proforma moga powstac PRZED zaplata karta (albo przed zwrotem), wiec
-- migawka zrodla z chwili szkicu nie wystarcza do decyzji o fakturze.
-- Bilet z cena NETTO (`event_ticket_types.tax_mode = 'exclusive'`, VAT
-- doliczany do ceny) ma brutto = netto + VAT wg stawki dokumentu
-- (`_event_invoice_gross_from_net`, podstawa `price_list_net`).
CREATE OR REPLACE FUNCTION public._event_invoice_resolve_source(
  p_tenant uuid, p_event_id uuid, p_kind text, p_id uuid, p_rate text, p_locale text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_src record;
  v_en boolean := p_locale = 'en';
BEGIN
  SELECT e.title_pl, e.title_en INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id AND e.tenant_id = p_tenant;
  IF p_kind = 'registration' THEN
    SELECT r.id, r.person_id, r.group_lead_registration_id, r.status, r.payment_status,
           r.payment_order_id, r.ticket_type_id,
           COALESCE(r.paid_at, o.paid_at) AS paid_at,
           p.user_id, t.name_pl, t.name_en,
           COALESCE(o.currency, t.currency, 'PLN') AS currency,
           (o.id IS NOT NULL AND o.status::text IN ('paid', 'refunded')) AS via_card,
           1 + (SELECT count(*)::integer FROM public.event_registrations g
                 WHERE g.group_lead_registration_id = r.id AND g.tenant_id = r.tenant_id
                   AND g.status NOT IN ('cancelled', 'rejected')) AS seats,
           (o.amount_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS order_gross,
           t.price_cents AS list_price,
           COALESCE(t.tax_mode, 'inclusive') AS tax_mode
      INTO v_src
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.event_ticket_types t ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
      LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
     WHERE r.id = p_id AND r.tenant_id = p_tenant AND r.event_id = p_event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source_not_found: registration is not part of this event' USING ERRCODE = '42501';
    END IF;
    IF v_src.group_lead_registration_id IS NOT NULL THEN
      RAISE EXCEPTION 'source_not_lead: invoice the group lead registration' USING ERRCODE = '22023';
    END IF;
    IF v_src.status IN ('cancelled', 'rejected')
       OR v_src.payment_status NOT IN ('paid', 'partially_refunded', 'unpaid') THEN
      RAISE EXCEPTION 'source_not_invoiceable: registration is cancelled, free or refunded'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'kind', 'registration',
      'id', v_src.id,
      'person_id', v_src.person_id,
      'user_id', v_src.user_id,
      'payment_order_id', CASE WHEN v_src.via_card THEN v_src.payment_order_id END,
      'item', COALESCE(v_src.ticket_type_id::text, 'none'),
      'ticket_type_id', v_src.ticket_type_id,
      'seats', v_src.seats,
      'source_seats', v_src.seats,
      'basis', CASE
        WHEN v_src.via_card AND v_src.order_gross IS NOT NULL THEN 'order'
        WHEN v_src.tax_mode = 'exclusive' THEN 'price_list_net'
        ELSE 'price_list'
      END,
      'gross', CASE
        WHEN v_src.via_card AND v_src.order_gross IS NOT NULL THEN v_src.order_gross
        WHEN v_src.tax_mode = 'exclusive'
          THEN public._event_invoice_gross_from_net(COALESCE(v_src.list_price, 0)::bigint, p_rate) * v_src.seats
        ELSE COALESCE(v_src.list_price, 0)::bigint * v_src.seats
      END,
      'currency', v_src.currency,
      'paid', v_src.payment_status IN ('paid', 'partially_refunded'),
      'paid_at', v_src.paid_at,
      'via_card', v_src.via_card,
      'label', CASE WHEN v_en THEN 'Ticket: ' ELSE 'Bilet: ' END
        || COALESCE(NULLIF(btrim(CASE WHEN v_en THEN v_src.name_en ELSE v_src.name_pl END), '') || ' - ', '')
        || CASE WHEN v_en THEN v_event.title_en ELSE v_event.title_pl END,
      'unit', CASE WHEN v_en THEN 'pcs' ELSE 'szt.' END
    );
  END IF;
  SELECT o.id, o.buyer_person_id, o.buyer_user_id, o.status, o.amount_cents, o.currency,
         o.seats_total, o.paid_at, o.package_id, k.name_pl, k.name_en, o.payment_order_id,
         (po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded')) AS via_card,
         (po.amount_cents - COALESCE(po.refunded_amount_cents, 0))::bigint AS order_gross
    INTO v_src
    FROM public.event_package_orders o
    JOIN public.event_ticket_packages k ON k.id = o.package_id AND k.tenant_id = o.tenant_id
    LEFT JOIN public.payment_orders po ON po.id = o.payment_order_id AND po.tenant_id = o.tenant_id
   WHERE o.id = p_id AND o.tenant_id = p_tenant AND o.event_id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source_not_found: package order is not part of this event' USING ERRCODE = '42501';
  END IF;
  IF v_src.status NOT IN ('pending', 'paid') THEN
    RAISE EXCEPTION 'source_not_invoiceable: package order is cancelled or refunded'
      USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'kind', 'package_order',
    'id', v_src.id,
    'person_id', v_src.buyer_person_id,
    'user_id', v_src.buyer_user_id,
    'payment_order_id', CASE WHEN v_src.via_card THEN v_src.payment_order_id END,
    'item', 'package:' || v_src.package_id::text,
    'ticket_type_id', NULL,
    'seats', 1,
    'source_seats', v_src.seats_total,
    'basis', 'order',
    'gross', CASE WHEN v_src.via_card AND v_src.order_gross IS NOT NULL THEN v_src.order_gross
                  ELSE v_src.amount_cents::bigint END,
    'currency', v_src.currency,
    'paid', v_src.status = 'paid',
    'paid_at', v_src.paid_at,
    'via_card', v_src.via_card,
    'label', CASE WHEN v_en THEN 'Package: ' ELSE 'Pakiet: ' END
      || CASE WHEN v_en THEN v_src.name_en ELSE v_src.name_pl END
      || CASE WHEN v_en THEN ', seats: ' ELSE ', miejsc: ' END || v_src.seats_total::text
      || ' - ' || CASE WHEN v_en THEN v_event.title_en ELSE v_event.title_pl END,
    'unit', CASE WHEN v_en THEN 'set' ELSE 'kpl.' END
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_resolve_source(uuid, uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_resolve_source(uuid, uuid, text, uuid, text, text)
  TO service_role;
COMMENT ON FUNCTION public._event_invoice_resolve_source(uuid, uuid, text, uuid, text, text) IS
  'Biezacy stan zrodla dokumentu (zapis prowadzacego grupy albo zamowienie pakietu): kwota (zamowienie z karty, cennik brutto albo netto + VAT), karta, zaplata, opis pozycji.';

-- Budowa szkicu z zamowien (pojedynczy albo ZBIORCZY). Wolaja:
-- admin_event_invoice_draft_create i admin_event_invoice_issue_pending.
CREATE OR REPLACE FUNCTION public._event_invoice_draft_build(p_tenant uuid, p_actor uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.event_invoice_settings;
  v_event record;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_kind text := COALESCE(NULLIF(p_payload->>'kind', ''), 'invoice');
  v_aggregate text := COALESCE(NULLIF(p_payload->>'aggregate', ''), 'per_source');
  v_sources jsonb := COALESCE(p_payload->'sources', '[]'::jsonb);
  v_locale text;
  v_rate text;
  v_item jsonb;
  v_skind text;
  v_sid uuid;
  v_seen uuid[] := '{}';
  v_resolved jsonb := '[]'::jsonb;
  v_currency text;
  v_buyer jsonb;
  v_request public.event_invoice_requests;
  v_request_id uuid := NULLIF(p_payload->>'request_id', '')::uuid;
  v_buyer_user uuid;
  v_buyer_person uuid;
  v_all_paid boolean;
  v_all_card boolean;
  v_paid_at timestamptz;
  v_payment_method text;
  v_sale_date date;
  v_invoice uuid;
  v_units jsonb := '[]'::jsonb;
  v_u bigint;
  v_r integer;
  v_line record;
  v_ord integer := 0;
  v_note text := btrim(COALESCE(p_payload->>'note', ''));
BEGIN
  SELECT * INTO v_settings FROM public.event_invoice_settings s WHERE s.tenant_id = p_tenant;
  IF NOT FOUND OR NOT v_settings.enabled THEN
    RAISE EXCEPTION 'invoicing_disabled: complete and confirm the issuer settings first'
      USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('invoice', 'proforma') THEN
    RAISE EXCEPTION 'invalid_kind: a draft is an invoice or a proforma' USING ERRCODE = '22023';
  END IF;
  IF v_aggregate NOT IN ('per_source', 'per_ticket_type') THEN
    RAISE EXCEPTION 'invalid_aggregate: lines are per source or per ticket type' USING ERRCODE = '22023';
  END IF;
  v_locale := COALESCE(NULLIF(p_payload->>'locale', ''), v_settings.default_locale);
  IF v_locale NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_locale: document language is pl or en' USING ERRCODE = '22023';
  END IF;
  v_rate := COALESCE(NULLIF(p_payload->>'vat_rate', ''), v_settings.default_vat_rate);
  IF v_rate NOT IN ('23', '8', '5', '0', 'zw', 'np') THEN
    RAISE EXCEPTION 'invalid_vat_rate: unknown VAT rate' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'invalid_note: note has more than 1000 characters' USING ERRCODE = '22023';
  END IF;
  SELECT e.id, e.slug, e.title_pl, e.title_en, e.starts_at INTO v_event
    FROM public.events e
   WHERE e.id = v_event_id AND e.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(CASE WHEN jsonb_typeof(v_sources) = 'array' THEN jsonb_array_length(v_sources) END, 0) = 0 THEN
    RAISE EXCEPTION 'no_sources: pick at least one order' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_sources) > 200 THEN
    RAISE EXCEPTION 'too_many_sources: one document covers at most 200 orders' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_sources) LOOP
    v_skind := v_item->>'kind';
    v_sid := NULLIF(v_item->>'id', '')::uuid;
    IF v_sid IS NULL OR v_skind IS NULL OR v_skind NOT IN ('registration', 'package_order') THEN
      RAISE EXCEPTION 'invalid_source: a source is a registration or a package order'
        USING ERRCODE = '22023';
    END IF;
    IF v_sid = ANY (v_seen) THEN
      RAISE EXCEPTION 'duplicate_source: the same order was picked twice' USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || v_sid;
    v_resolved := v_resolved || jsonb_build_array(
      public._event_invoice_resolve_source(p_tenant, v_event_id, v_skind, v_sid, v_rate, v_locale)
    );
    IF v_kind = 'invoice' AND EXISTS (
      SELECT 1 FROM public.event_invoice_sources s
       WHERE s.tenant_id = p_tenant AND s.covers AND s.released_at IS NULL
         AND (s.registration_id = v_sid OR s.package_order_id = v_sid)
    ) THEN
      RAISE EXCEPTION 'already_invoiced: an order already has an active invoice' USING ERRCODE = '23505';
    END IF;
  END LOOP;

  -- Faktura zbiorcza dla JEDNEGO nabywcy. Oczekujace prosby zrodel od roznych
  -- nabywcow (inny NIP albo osoba prywatna) wystawienie oznaczyloby jako
  -- zafakturowane na danych jednego z nich - drugi nabywca zostalby bez
  -- faktury i bez mozliwosci poproszenia o nia. Odmawiamy.
  IF (
    SELECT count(DISTINCT CASE
             WHEN q.buyer_tax_id <> ''
               THEN 'tax:' || public._event_invoice_tax_key(q.buyer_tax_id) || ':' || q.buyer_country
             ELSE 'request:' || q.id::text
           END)
      FROM public.event_invoice_requests q
     WHERE q.tenant_id = p_tenant AND q.status = 'pending'
       AND (q.registration_id = ANY (v_seen) OR q.package_order_id = ANY (v_seen))
  ) > 1 THEN
    RAISE EXCEPTION 'buyer_mismatch: the picked orders carry invoice requests of different buyers'
      USING ERRCODE = '22023';
  END IF;

  SELECT min(x.value->>'currency') INTO v_currency FROM jsonb_array_elements(v_resolved) AS x;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_resolved) AS x WHERE x.value->>'currency' <> v_currency)
     OR v_currency NOT IN ('PLN', 'EUR') THEN
    RAISE EXCEPTION 'currency_mismatch: orders of one document share one currency (PLN or EUR)'
      USING ERRCODE = '22023';
  END IF;

  -- Nabywca: jawny z panelu > wskazana prosba > najstarsza oczekujaca prosba
  -- wsrod zrodel > dane osoby z pierwszego zrodla (szkic do uzupelnienia).
  IF jsonb_typeof(p_payload->'buyer') = 'object' THEN
    v_buyer := public._event_invoice_buyer_clean(p_payload->'buyer');
  END IF;
  IF v_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.event_invoice_requests q
     WHERE q.id = v_request_id AND q.tenant_id = p_tenant AND q.status = 'pending'
       AND (q.registration_id = ANY (v_seen) OR q.package_order_id = ANY (v_seen));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'request_not_found: pending invoice request of these orders does not exist'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT * INTO v_request FROM public.event_invoice_requests q
     WHERE q.tenant_id = p_tenant AND q.status = 'pending'
       AND (q.registration_id = ANY (v_seen) OR q.package_order_id = ANY (v_seen))
     ORDER BY q.created_at, q.id
     LIMIT 1;
  END IF;
  IF v_buyer IS NULL AND v_request.id IS NOT NULL THEN
    v_buyer := jsonb_build_object(
      'is_company', v_request.buyer_is_company, 'name', v_request.buyer_name,
      'tax_id', v_request.buyer_tax_id, 'country', v_request.buyer_country,
      'address', v_request.buyer_address, 'postal_code', v_request.buyer_postal_code,
      'city', v_request.buyer_city, 'email', v_request.buyer_email,
      'po_number', v_request.po_number, 'recipient_name', v_request.recipient_name,
      'recipient_address', v_request.recipient_address
    );
  END IF;
  IF v_request.id IS NULL THEN
    v_buyer_person := NULLIF(v_resolved->0->>'person_id', '')::uuid;
    v_buyer_user := NULLIF(v_resolved->0->>'user_id', '')::uuid;
  ELSE
    SELECT NULLIF(x.value->>'person_id', '')::uuid, NULLIF(x.value->>'user_id', '')::uuid
      INTO v_buyer_person, v_buyer_user
      FROM jsonb_array_elements(v_resolved) AS x
     WHERE x.value->>'id' = COALESCE(v_request.registration_id, v_request.package_order_id)::text;
    v_buyer_user := COALESCE(v_request.requested_by, v_buyer_user);
  END IF;
  IF v_buyer IS NULL THEN
    SELECT jsonb_build_object(
      'is_company', false,
      'name', btrim(COALESCE(o.buyer_name, p.first_name || ' ' || p.last_name, '')),
      'tax_id', '', 'country', 'PL', 'address', '', 'postal_code', '', 'city', '',
      'email', lower(btrim(COALESCE(o.buyer_email, p.email, ''))),
      'po_number', '', 'recipient_name', '', 'recipient_address', ''
    ) INTO v_buyer
      FROM (SELECT 1) AS one
      LEFT JOIN public.event_people p ON p.id = v_buyer_person AND p.tenant_id = p_tenant
      LEFT JOIN public.event_package_orders o
        ON o.id = NULLIF(v_resolved->0->>'id', '')::uuid AND o.tenant_id = p_tenant
       AND v_resolved->0->>'kind' = 'package_order';
  END IF;

  SELECT bool_and((x.value->>'paid')::boolean), bool_and((x.value->>'via_card')::boolean),
         max(NULLIF(x.value->>'paid_at', '')::timestamptz)
    INTO v_all_paid, v_all_card, v_paid_at
    FROM jsonb_array_elements(v_resolved) AS x;
  v_payment_method := COALESCE(NULLIF(p_payload->>'payment_method', ''),
                               CASE WHEN v_all_card THEN 'card' ELSE 'transfer' END);
  IF v_payment_method NOT IN ('card', 'transfer', 'other') THEN
    RAISE EXCEPTION 'invalid_payment_method: payment method is card, transfer or other'
      USING ERRCODE = '22023';
  END IF;
  v_sale_date := COALESCE(
    NULLIF(p_payload->>'sale_date', '')::date,
    CASE WHEN v_all_paid AND v_paid_at IS NOT NULL THEN (v_paid_at AT TIME ZONE 'Europe/Warsaw')::date END,
    (v_event.starts_at AT TIME ZONE 'Europe/Warsaw')::date
  );

  INSERT INTO public.event_invoices (
    tenant_id, event_id, event_slug, event_title_pl, event_title_en, kind, status, sale_date,
    due_date, payment_method, paid_at, currency, buyer_is_company, buyer_name, buyer_tax_id,
    buyer_country, buyer_address, buyer_postal_code, buyer_city, buyer_email, po_number,
    recipient_name, recipient_address, buyer_user_id, buyer_person_id, locale, note, created_by
  ) VALUES (
    p_tenant, v_event.id, v_event.slug, v_event.title_pl, v_event.title_en, v_kind, 'draft', v_sale_date,
    NULLIF(p_payload->>'due_date', '')::date, v_payment_method,
    CASE WHEN v_kind = 'invoice' AND v_all_paid THEN v_paid_at END, v_currency,
    COALESCE((v_buyer->>'is_company')::boolean, false), COALESCE(v_buyer->>'name', ''),
    COALESCE(v_buyer->>'tax_id', ''), COALESCE(NULLIF(v_buyer->>'country', ''), 'PL'),
    COALESCE(v_buyer->>'address', ''), COALESCE(v_buyer->>'postal_code', ''),
    COALESCE(v_buyer->>'city', ''), COALESCE(v_buyer->>'email', ''),
    COALESCE(v_buyer->>'po_number', ''), COALESCE(v_buyer->>'recipient_name', ''),
    COALESCE(v_buyer->>'recipient_address', ''), v_buyer_user, v_buyer_person, v_locale, v_note, p_actor
  )
  RETURNING id INTO v_invoice;

  INSERT INTO public.event_invoice_sources (
    tenant_id, invoice_id, source_kind, registration_id, package_order_id, payment_order_id,
    person_id, seats, gross_cents, paid_at, covers
  )
  SELECT p_tenant, v_invoice, x.value->>'kind',
         CASE WHEN x.value->>'kind' = 'registration' THEN (x.value->>'id')::uuid END,
         CASE WHEN x.value->>'kind' = 'package_order' THEN (x.value->>'id')::uuid END,
         NULLIF(x.value->>'payment_order_id', '')::uuid,
         NULLIF(x.value->>'person_id', '')::uuid,
         (x.value->>'source_seats')::integer, (x.value->>'gross')::bigint,
         NULLIF(x.value->>'paid_at', '')::timestamptz, v_kind = 'invoice'
    FROM jsonb_array_elements(v_resolved) AS x;

  -- Jednostki: kwota zrodla dzielona na miejsca; reszta z dzielenia na
  -- osobnej pozycji (u + 1 grosz), zeby ilosc x cena = wartosc.
  FOR v_item IN SELECT x.value FROM jsonb_array_elements(v_resolved) AS x LOOP
    v_ord := v_ord + 1;
    v_u := (v_item->>'gross')::bigint / (v_item->>'seats')::integer;
    v_r := ((v_item->>'gross')::bigint - v_u * (v_item->>'seats')::integer)::integer;
    v_units := v_units || jsonb_build_array(jsonb_build_object(
      'ord', v_ord * 2, 'item', v_item->>'item', 'label', v_item->>'label', 'unit', v_item->>'unit',
      'ticket_type_id', v_item->>'ticket_type_id',
      'qty', (v_item->>'seats')::integer - v_r, 'unit_gross', v_u
    ));
    IF v_r > 0 THEN
      v_units := v_units || jsonb_build_array(jsonb_build_object(
        'ord', v_ord * 2 + 1, 'item', v_item->>'item', 'label', v_item->>'label',
        'unit', v_item->>'unit', 'ticket_type_id', v_item->>'ticket_type_id',
        'qty', v_r, 'unit_gross', v_u + 1
      ));
    END IF;
  END LOOP;

  FOR v_line IN
    SELECT u.label, u.unit, u.ticket_type_id, sum(u.qty)::integer AS qty, u.unit_gross
      FROM jsonb_to_recordset(v_units) AS u(
        ord integer, item text, label text, unit text, ticket_type_id uuid, qty integer, unit_gross bigint
      )
     GROUP BY CASE WHEN v_aggregate = 'per_ticket_type' THEN u.item ELSE u.ord::text END,
              u.label, u.unit, u.ticket_type_id, u.unit_gross
     ORDER BY min(u.ord)
  LOOP
    PERFORM public._event_invoice_add_line(
      p_tenant, v_invoice, left(v_line.label, 300), v_line.unit, v_line.qty, v_line.unit_gross,
      v_rate, v_line.ticket_type_id
    );
  END LOOP;
  PERFORM public._event_invoice_recalc(p_tenant, v_invoice);
  RETURN v_invoice;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_draft_build(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_draft_build(uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_invoice_draft_build(uuid, uuid, jsonb) IS
  'Szkic faktury/proformy z zamowien wydarzenia (zapisy prowadzacych grupy, zamowienia pakietow): nabywca z panelu, prosby albo osoby; pozycje per zrodlo albo per rodzaj biletu.';

-- Powiazanie nabywcy z kartoteka CRM przy wystawieniu. NIGDY nie rzuca:
-- awaria kartoteki nie moze zablokowac dokumentu.
CREATE OR REPLACE FUNCTION public._event_invoice_crm_link(p_tenant uuid, p_actor uuid, p_invoice uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
  v_company uuid;
  v_key text;
  v_meta jsonb;
  v_action text;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i WHERE i.id = p_invoice AND i.tenant_id = p_tenant;
  v_action := CASE v_inv.kind
    WHEN 'proforma' THEN 'event.invoice.proforma_issued'
    WHEN 'correction' THEN 'event.invoice.correction_issued'
    ELSE 'event.invoice.issued'
  END;
  v_meta := jsonb_build_object(
    'event_id', v_inv.event_id,
    'event_slug', v_inv.event_slug,
    'event_title_pl', v_inv.event_title_pl,
    'event_title_en', v_inv.event_title_en,
    'summary_pl', CASE v_inv.kind WHEN 'proforma' THEN 'Proforma ' WHEN 'correction' THEN 'Korekta '
                  ELSE 'Faktura ' END || COALESCE(v_inv.number, '') || ' - ' || v_inv.event_title_pl,
    'summary_en', CASE v_inv.kind WHEN 'proforma' THEN 'Proforma ' WHEN 'correction' THEN 'Credit note '
                  ELSE 'Invoice ' END || COALESCE(v_inv.number, '') || ' - ' || v_inv.event_title_en,
    'invoice_id', v_inv.id,
    'invoice_kind', v_inv.kind,
    'number', v_inv.number,
    'gross_cents', v_inv.gross_cents,
    'currency', v_inv.currency
  );

  BEGIN
    IF v_inv.buyer_is_company AND btrim(v_inv.buyer_name) <> '' THEN
      v_company := v_inv.crm_company_id;
      v_key := public._event_invoice_tax_key(v_inv.buyer_tax_id);
      IF v_company IS NULL AND v_key <> '' THEN
        SELECT c.id INTO v_company
          FROM public.crm_companies c
         WHERE c.tenant_id = p_tenant AND c.tax_id IS NOT NULL
           AND public._event_invoice_tax_key(c.tax_id) = v_key
         ORDER BY c.created_at, c.id
         LIMIT 1;
      END IF;
      IF v_company IS NULL THEN
        SELECT m.id INTO v_company FROM public.crm_ensure_member_company(p_tenant, v_inv.buyer_name, p_actor) AS m;
        -- Dopasowanie po NAZWIE ignoruje NIP (klucz nazwy zdejmuje forme
        -- prawna): "Globex" z NIP-em A trafilby do "Globex Sp. z o.o." z NIP-em
        -- B - przychod i os czasu innego podmiotu. Firma z INNYM niepustym
        -- NIP-em to inny podmiot: zakladamy nowa z nazwa i NIP-em nabywcy.
        -- Blokada doradcza `crm_ensure_member_company` trwa do konca
        -- transakcji, wiec rownolegle wystawienie czeka; po niej ponownie
        -- szukamy po NIP-ie, zeby nie zalozyc tej samej firmy dwa razy.
        IF v_company IS NOT NULL AND v_key <> '' AND EXISTS (
          SELECT 1 FROM public.crm_companies c
           WHERE c.id = v_company AND c.tenant_id = p_tenant
             AND btrim(COALESCE(c.tax_id, '')) <> ''
             AND public._event_invoice_tax_key(c.tax_id) <> v_key
        ) THEN
          v_company := NULL;
          SELECT c.id INTO v_company
            FROM public.crm_companies c
           WHERE c.tenant_id = p_tenant AND c.tax_id IS NOT NULL
             AND public._event_invoice_tax_key(c.tax_id) = v_key
           ORDER BY c.created_at, c.id
           LIMIT 1;
          IF v_company IS NULL THEN
            INSERT INTO public.crm_companies (tenant_id, name, tax_id, created_by)
            VALUES (p_tenant, btrim(v_inv.buyer_name), v_inv.buyer_tax_id, p_actor)
            RETURNING id INTO v_company;
          END IF;
        END IF;
      END IF;
      IF v_company IS NOT NULL THEN
        UPDATE public.crm_companies c
           SET tax_id = COALESCE(NULLIF(btrim(c.tax_id), ''), NULLIF(v_inv.buyer_tax_id, '')),
               address = COALESCE(NULLIF(btrim(c.address), ''), NULLIF(v_inv.buyer_address, '')),
               postal_code = COALESCE(NULLIF(btrim(c.postal_code), ''), NULLIF(v_inv.buyer_postal_code, '')),
               city = COALESCE(NULLIF(btrim(c.city), ''), NULLIF(v_inv.buyer_city, '')),
               country = COALESCE(NULLIF(btrim(c.country), ''), NULLIF(v_inv.buyer_country, '')),
               email = COALESCE(NULLIF(btrim(c.email), ''), NULLIF(v_inv.buyer_email, ''))
         WHERE c.id = v_company AND c.tenant_id = p_tenant;
        UPDATE public.event_invoices i SET crm_company_id = v_company
         WHERE i.id = p_invoice AND i.tenant_id = p_tenant AND i.crm_company_id IS NULL;
        UPDATE public.event_invoice_requests q SET crm_company_id = v_company
         WHERE q.tenant_id = p_tenant AND q.crm_company_id IS NULL
           AND (q.registration_id IN (SELECT s.registration_id FROM public.event_invoice_sources s
                                        WHERE s.invoice_id = p_invoice AND s.tenant_id = p_tenant)
                OR q.package_order_id IN (SELECT s.package_order_id FROM public.event_invoice_sources s
                                           WHERE s.invoice_id = p_invoice AND s.tenant_id = p_tenant));
        UPDATE public.event_package_orders o SET company_id = v_company
         WHERE o.tenant_id = p_tenant AND o.company_id IS NULL
           AND o.id IN (SELECT s.package_order_id FROM public.event_invoice_sources s
                         WHERE s.invoice_id = p_invoice AND s.tenant_id = p_tenant);
        INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
        VALUES (p_tenant, p_actor, v_action, 'crm_company', v_company, v_meta);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_company := NULL;
  END;

  IF v_inv.buyer_person_id IS NOT NULL AND v_inv.kind <> 'correction' THEN
    PERFORM public._event_person_crm_sync(
      p_tenant, v_inv.buyer_person_id, 'event_participant',
      'event:' || v_inv.event_slug || ':invoice', ARRAY['event:' || v_inv.event_slug],
      '{}'::jsonb, true, v_action, v_meta
    );
  END IF;
  RETURN v_company;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_crm_link(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_crm_link(uuid, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_crm_link(uuid, uuid, uuid) IS
  'Firma nabywcy w CRM (NIP, potem nazwa), uzupelnienie WYLACZNIE pustych pol, wpis osi czasu firmy i most osoby kupujacej. Nigdy nie rzuca.';

-- Wystawienie: numer, migawka sprzedawcy, stan KSeF, prosby, CRM, zdarzenie.
CREATE OR REPLACE FUNCTION public._event_invoice_issue_core(p_tenant uuid, p_actor uuid, p_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
  v_target public.event_invoices;
  v_settings public.event_invoice_settings;
  v_buyer jsonb;
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_series text;
  v_num record;
  v_due date;
  v_exempt boolean;
  v_source public.event_invoice_sources;
  v_now jsonb;
  v_card uuid;
  v_block text;
  v_bad integer;
  v_open integer;
  v_open_anchors integer;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = p_invoice AND i.tenant_id = p_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'not_draft: only a draft can be issued' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_settings FROM public.event_invoice_settings s WHERE s.tenant_id = p_tenant;
  IF NOT FOUND OR NOT v_settings.enabled THEN
    RAISE EXCEPTION 'invoicing_disabled: complete and confirm the issuer settings first'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_invoice_lines l
                  WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'no_lines: a document needs at least one line' USING ERRCODE = '22023';
  END IF;
  v_buyer := public._event_invoice_buyer_clean(public._event_invoice_buyer_json(v_inv));
  v_exempt := EXISTS (SELECT 1 FROM public.event_invoice_lines l
                       WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant AND l.vat_rate = 'zw');
  IF v_exempt AND btrim(v_settings.vat_exempt_basis) = '' THEN
    RAISE EXCEPTION 'vat_exempt_basis_required: exempt lines need the legal basis in issuer settings'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.kind <> 'correction' AND v_inv.gross_cents < 0 THEN
    RAISE EXCEPTION 'negative_total: only a correction can have a negative total' USING ERRCODE = '22023';
  END IF;
  -- ZRODLA SPRAWDZANE NA NOWO. Szkic (takze z proformy) moze powstac przed
  -- zaplata karta albo przed zwrotem; migawka zrodla z chwili szkicu nie
  -- wystarcza. Zamowienie z karty, ktorego organizator nie moze fakturowac
  -- (_event_invoice_card_block), blokuje wystawienie; zrodlo zmienione od
  -- szkicu (nowe zamowienie z karty, inna kwota zamowienia, zamowienie
  -- usuniete) tez - organizator tworzy szkic od nowa na aktualnych danych.
  IF v_inv.kind = 'invoice' THEN
    FOR v_source IN
      SELECT * FROM public.event_invoice_sources s
       WHERE s.invoice_id = v_inv.id AND s.tenant_id = p_tenant
       ORDER BY s.created_at, s.id
    LOOP
      IF COALESCE(v_source.registration_id, v_source.package_order_id) IS NULL THEN
        RAISE EXCEPTION 'source_changed: an order of this draft changed - create the draft again'
          USING ERRCODE = '22023';
      END IF;
      v_now := public._event_invoice_resolve_source(
        p_tenant, v_inv.event_id, v_source.source_kind,
        COALESCE(v_source.registration_id, v_source.package_order_id),
        v_settings.default_vat_rate, v_inv.locale
      );
      v_card := NULLIF(v_now->>'payment_order_id', '')::uuid;
      v_block := CASE WHEN v_card IS NOT NULL THEN public._event_invoice_card_block(p_tenant, v_card) END;
      IF v_block = 'mor_seller_conflict' THEN
        RAISE EXCEPTION 'mor_seller_conflict: card orders of the managed checkout are sold by the payment operator'
          USING ERRCODE = '22023';
      ELSIF v_block = 'operator_invoice_enabled' THEN
        RAISE EXCEPTION 'operator_invoice_enabled: the checkout already issues invoices for card payments'
          USING ERRCODE = '22023';
      ELSIF v_block = 'billing_plane_unknown' THEN
        RAISE EXCEPTION 'billing_plane_unknown: checkout settings changed after this card order'
          USING ERRCODE = '22023';
      END IF;
      IF v_card IS DISTINCT FROM v_source.payment_order_id
         OR ((v_card IS NOT NULL OR v_source.source_kind = 'package_order')
             AND (v_now->>'gross')::bigint <> v_source.gross_cents) THEN
        RAISE EXCEPTION 'source_changed: an order of this draft changed - create the draft again'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    -- Jeden nabywca (patrz _event_invoice_draft_build) - takze przy wystawieniu.
    IF (
      SELECT count(DISTINCT CASE
               WHEN q.buyer_tax_id <> ''
                 THEN 'tax:' || public._event_invoice_tax_key(q.buyer_tax_id) || ':' || q.buyer_country
               ELSE 'request:' || q.id::text
             END)
        FROM public.event_invoice_requests q
        JOIN public.event_invoice_sources s
          ON s.tenant_id = q.tenant_id AND s.invoice_id = v_inv.id
         AND (s.registration_id = q.registration_id OR s.package_order_id = q.package_order_id)
       WHERE q.tenant_id = p_tenant AND q.status = 'pending'
    ) > 1 THEN
      RAISE EXCEPTION 'buyer_mismatch: the picked orders carry invoice requests of different buyers'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_inv.kind = 'correction' THEN
    SELECT * INTO v_target FROM public.event_invoices i
     WHERE i.id = v_inv.corrects_invoice_id AND i.tenant_id = p_tenant
     FOR UPDATE;
    IF v_target.status IS DISTINCT FROM 'issued' THEN
      RAISE EXCEPTION 'correction_target_invalid: the corrected invoice is not issued'
        USING ERRCODE = '22023';
    END IF;
    -- STAN PO KOREKCIE musi byc czysty (patrz _event_invoice_state): bez
    -- ujemnych ilosci, bez resztek netto, najwyzej jedna grupa na kotwice,
    -- netto grupy = netto z jej brutto. Pelna korekta zeruje CALY stan (tylko
    -- wtedy zwalnia zamowienia do ponownego zafakturowania); korekta czesciowa
    -- zerujaca wszystko musi byc pelna, zeby zamowienia nie zostaly
    -- zablokowane na fakturze o wartosci zero.
    SELECT count(*) FILTER (
             WHERE st.quantity < 0
                OR (st.quantity = 0 AND st.net_cents <> 0)
                OR (st.quantity > 0
                    AND st.net_cents <> public._event_invoice_net_from_gross(st.gross_cents, st.vat_rate))),
           count(*) FILTER (WHERE st.quantity > 0),
           count(DISTINCT st.anchor_id) FILTER (WHERE st.quantity > 0)
      INTO v_bad, v_open, v_open_anchors
      FROM public._event_invoice_state(p_tenant, v_target.id, v_inv.id) AS st;
    IF v_bad > 0 OR v_open > v_open_anchors OR (v_inv.correction_mode = 'full' AND v_open > 0) THEN
      RAISE EXCEPTION 'correction_inconsistent: the correction does not match the current state of the invoice'
        USING ERRCODE = '22023';
    END IF;
    IF v_inv.correction_mode = 'partial' AND v_open = 0 THEN
      RAISE EXCEPTION 'correction_use_full: the correction reverses the whole invoice - use a full correction'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  v_due := COALESCE(v_inv.due_date,
                    v_today + CASE WHEN v_inv.paid_at IS NOT NULL THEN 0 ELSE v_settings.payment_days END);
  IF v_due < v_today THEN
    RAISE EXCEPTION 'invalid_due_date: due date is before the issue date' USING ERRCODE = '22023';
  END IF;

  v_series := CASE v_inv.kind
    WHEN 'proforma' THEN v_settings.series_proforma
    WHEN 'correction' THEN v_settings.series_correction
    ELSE v_settings.series_invoice
  END;
  SELECT * INTO v_num FROM public._event_invoice_next_number(p_tenant, v_series, v_today);

  UPDATE public.event_invoices i
     SET status = 'issued',
         series = v_series,
         period = v_num.out_period,
         seq = v_num.out_seq,
         number = v_num.out_number,
         issue_date = v_today,
         due_date = v_due,
         sale_date = COALESCE(i.sale_date, v_today),
         buyer_is_company = (v_buyer->>'is_company')::boolean,
         buyer_name = v_buyer->>'name',
         buyer_tax_id = v_buyer->>'tax_id',
         buyer_country = v_buyer->>'country',
         buyer_address = v_buyer->>'address',
         buyer_postal_code = v_buyer->>'postal_code',
         buyer_city = v_buyer->>'city',
         buyer_email = v_buyer->>'email',
         po_number = v_buyer->>'po_number',
         recipient_name = v_buyer->>'recipient_name',
         recipient_address = v_buyer->>'recipient_address',
         seller = public._event_invoice_seller_json(p_tenant),
         vat_exempt_basis = CASE WHEN v_exempt THEN v_settings.vat_exempt_basis ELSE '' END,
         ksef_status = CASE
           WHEN i.kind <> 'proforma' AND v_settings.seller_country = 'PL' THEN 'pending'
           ELSE 'not_applicable' END,
         issued_at = now(),
         issued_by = p_actor
   WHERE i.id = v_inv.id AND i.tenant_id = p_tenant;

  IF v_inv.kind = 'invoice' THEN
    UPDATE public.event_invoice_requests q
       SET status = 'invoiced', invoice_id = v_inv.id
     WHERE q.tenant_id = p_tenant AND q.status = 'pending'
       AND (q.registration_id IN (SELECT s.registration_id FROM public.event_invoice_sources s
                                    WHERE s.invoice_id = v_inv.id AND s.tenant_id = p_tenant)
            OR q.package_order_id IN (SELECT s.package_order_id FROM public.event_invoice_sources s
                                       WHERE s.invoice_id = v_inv.id AND s.tenant_id = p_tenant));
  ELSIF v_inv.kind = 'correction' AND v_inv.correction_mode = 'full' THEN
    UPDATE public.event_invoice_sources s
       SET released_at = now()
     WHERE s.invoice_id = v_target.id AND s.tenant_id = p_tenant AND s.released_at IS NULL;
    UPDATE public.event_invoice_requests q
       SET status = 'pending', invoice_id = NULL
     WHERE q.tenant_id = p_tenant AND q.invoice_id = v_target.id AND q.status = 'invoiced';
  END IF;

  PERFORM public._event_invoice_crm_link(p_tenant, p_actor, v_inv.id);

  PERFORM public.emit_domain_event(
    p_tenant,
    'event_invoice',
    v_inv.id::text,
    'event_invoice.issued.v1',
    jsonb_build_object('event_id', v_inv.event_id, 'invoice_id', v_inv.id, 'kind', v_inv.kind),
    p_actor
  );
  RETURN jsonb_build_object(
    'id', v_inv.id, 'number', v_num.out_number, 'kind', v_inv.kind, 'event_id', v_inv.event_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_issue_core(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_issue_core(uuid, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_issue_core(uuid, uuid, uuid) IS
  'Wystawienie szkicu: walidacja (wystawca, nabywca, zw, MoR, korekta), numer bez luk, migawka sprzedawcy, KSeF pending, prosby -> invoiced, pelna korekta zwalnia zrodla, CRM, event_invoice.issued.v1.';

-- Dokument w ksztalcie do podgladu, PDF i szczegolow (panel i kupujacy).
CREATE OR REPLACE FUNCTION public._event_invoice_document(p_tenant uuid, p_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i WHERE i.id = p_invoice AND i.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'invoice', to_jsonb(v_inv) - 'seller' - 'tenant_id' - 'created_by' - 'issued_by' - 'cancelled_by',
    'seller', COALESCE(v_inv.seller, public._event_invoice_seller_json(p_tenant)),
    -- Stopka wystawionego dokumentu pochodzi z MIGAWKI sprzedawcy (z chwili
    -- wystawienia) - zmiana stopki w ustawieniach nie moze zmieniac tresci
    -- wydanych juz faktur. Biezace ustawienia wylacznie dla szkicu.
    'footer_note', CASE
      WHEN v_inv.seller IS NOT NULL THEN COALESCE(v_inv.seller->>'footer_note', '')
      ELSE COALESCE((SELECT s.footer_note FROM public.event_invoice_settings s
                      WHERE s.tenant_id = p_tenant), '')
    END,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'position', l.position, 'description', l.description, 'unit', l.unit,
        'quantity', l.quantity, 'unit_gross_cents', l.unit_gross_cents,
        'unit_net_cents', l.unit_net_cents, 'vat_rate', l.vat_rate, 'net_cents', l.net_cents,
        'vat_cents', l.vat_cents, 'gross_cents', l.gross_cents, 'ticket_type_id', l.ticket_type_id,
        'corrects_line_id', l.corrects_line_id
      ) ORDER BY l.position)
      FROM public.event_invoice_lines l WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant
    ), '[]'::jsonb),
    'vat_summary', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'vat_rate', x.vat_rate, 'net_cents', x.net, 'vat_cents', x.vat, 'gross_cents', x.gross
      ) ORDER BY x.vat_rate)
      FROM (
        SELECT l.vat_rate, sum(l.net_cents) AS net, sum(l.vat_cents) AS vat, sum(l.gross_cents) AS gross
          FROM public.event_invoice_lines l
         WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant
         GROUP BY l.vat_rate
      ) AS x
    ), '[]'::jsonb),
    'corrects', (
      SELECT jsonb_build_object('id', c.id, 'number', c.number, 'issue_date', c.issue_date,
                                'sale_date', c.sale_date)
        FROM public.event_invoices c
       WHERE c.id = v_inv.corrects_invoice_id AND c.tenant_id = p_tenant
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_document(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_document(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. PLASZCZYZNA PANELU (assert_event_admin_tenant).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_invoice_settings_get()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN public._event_invoice_settings_json(v_tenant);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_settings_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_settings_get() TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_settings_get() IS
  'Dane wystawcy faktur wydarzen najemcy (brak wiersza = domyslne, wylaczone). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_settings_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_cur jsonb;
  v_new jsonb;
  v_enabled boolean;
  v_country text;
  v_tax text;
  v_confirmed timestamptz;
BEGIN
  v_cur := public._event_invoice_settings_json(v_tenant);
  -- Klucz pominiety = bez zmian; napis przyciety; JSON null = pusty napis.
  SELECT jsonb_object_agg(k.key, CASE
           WHEN NOT (COALESCE(p_payload, '{}'::jsonb) ? k.key) THEN v_cur->k.key
           WHEN jsonb_typeof(p_payload->k.key) = 'string' THEN to_jsonb(btrim(p_payload->>k.key))
           WHEN jsonb_typeof(p_payload->k.key) = 'null' THEN to_jsonb(''::text)
           ELSE p_payload->k.key END)
    INTO v_new
    FROM jsonb_object_keys(v_cur) AS k(key);
  v_enabled := COALESCE(NULLIF(v_new->>'enabled', '')::boolean, false);
  v_country := upper(COALESCE(v_new->>'seller_country', ''));
  IF v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid_country: country must be an ISO 3166 alpha-2 code' USING ERRCODE = '22023';
  END IF;
  v_tax := public._event_invoice_tax_id_normalize(v_new->>'seller_tax_id', v_country);
  IF v_tax IS NULL THEN
    RAISE EXCEPTION 'invalid_tax_id: tax identifier is not valid for the country' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_new->>'seller_name') > 200 OR char_length(v_new->>'seller_address') > 200
     OR char_length(v_new->>'seller_postal_code') > 20 OR char_length(v_new->>'seller_city') > 100
     OR char_length(v_new->>'seller_email') > 254 OR char_length(v_new->>'seller_phone') > 40
     OR char_length(v_new->>'seller_bank_account') > 64 OR char_length(v_new->>'seller_bank_swift') > 20
     OR char_length(v_new->>'vat_exempt_basis') > 300 OR char_length(v_new->>'footer_note') > 500 THEN
    RAISE EXCEPTION 'invalid_settings: a text field is too long' USING ERRCODE = '22023';
  END IF;
  IF (v_new->>'seller_email') <> ''
     AND (v_new->>'seller_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: invoice e-mail address is not valid' USING ERRCODE = '22023';
  END IF;
  IF upper(v_new->>'series_invoice') !~ '^[A-Z0-9]{1,10}$'
     OR upper(v_new->>'series_proforma') !~ '^[A-Z0-9]{1,10}$'
     OR upper(v_new->>'series_correction') !~ '^[A-Z0-9]{1,10}$' THEN
    RAISE EXCEPTION 'invalid_series: a series prefix has 1-10 letters or digits' USING ERRCODE = '22023';
  END IF;
  IF upper(v_new->>'series_invoice') IN (upper(v_new->>'series_proforma'), upper(v_new->>'series_correction'))
     OR upper(v_new->>'series_proforma') = upper(v_new->>'series_correction') THEN
    RAISE EXCEPTION 'series_not_distinct: invoice, proforma and correction series must differ'
      USING ERRCODE = '22023';
  END IF;
  IF (v_new->>'payment_days') !~ '^[0-9]{1,3}$' OR (v_new->>'payment_days')::integer > 120 THEN
    RAISE EXCEPTION 'invalid_payment_days: payment term is 0-120 days' USING ERRCODE = '22023';
  END IF;
  IF (v_new->>'default_vat_rate') NOT IN ('23', '8', '5', '0', 'zw', 'np') THEN
    RAISE EXCEPTION 'invalid_vat_rate: unknown VAT rate' USING ERRCODE = '22023';
  END IF;
  IF (v_new->>'default_locale') NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_locale: document language is pl or en' USING ERRCODE = '22023';
  END IF;
  IF (v_new->>'default_vat_rate') = 'zw' AND (v_new->>'vat_exempt_basis') = '' THEN
    RAISE EXCEPTION 'vat_exempt_basis_required: exempt lines need the legal basis in issuer settings'
      USING ERRCODE = '22023';
  END IF;
  v_confirmed := NULLIF(v_cur->>'confirmed_at', '')::timestamptz;
  IF v_enabled THEN
    IF (v_new->>'seller_name') = '' OR v_tax = '' OR (v_new->>'seller_address') = ''
       OR (v_new->>'seller_postal_code') = '' OR (v_new->>'seller_city') = '' THEN
      RAISE EXCEPTION 'seller_incomplete: issuer name, tax id and address are required'
        USING ERRCODE = '22023';
    END IF;
    IF v_confirmed IS NULL AND COALESCE(NULLIF(p_payload->>'confirm_seller', '')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'seller_confirmation_required: confirm that the organizer is the seller'
        USING ERRCODE = '22023';
    END IF;
    v_confirmed := COALESCE(v_confirmed, now());
  END IF;

  INSERT INTO public.event_invoice_settings AS s (
    tenant_id, enabled, confirmed_at, confirmed_by, seller_name, seller_tax_id, seller_address,
    seller_postal_code, seller_city, seller_country, seller_email, seller_phone, seller_bank_account,
    seller_bank_swift, series_invoice, series_proforma, series_correction, payment_days,
    default_vat_rate, vat_exempt_basis, footer_note, default_locale, updated_by
  ) VALUES (
    v_tenant, v_enabled, v_confirmed, CASE WHEN v_confirmed IS NOT NULL THEN auth.uid() END,
    v_new->>'seller_name', v_tax, v_new->>'seller_address', v_new->>'seller_postal_code',
    v_new->>'seller_city', v_country, lower(v_new->>'seller_email'), v_new->>'seller_phone',
    upper(regexp_replace(v_new->>'seller_bank_account', '[[:space:]]', '', 'g')),
    upper(v_new->>'seller_bank_swift'), upper(v_new->>'series_invoice'), upper(v_new->>'series_proforma'),
    upper(v_new->>'series_correction'), (v_new->>'payment_days')::integer, v_new->>'default_vat_rate',
    v_new->>'vat_exempt_basis', v_new->>'footer_note', v_new->>'default_locale', auth.uid()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    confirmed_at = EXCLUDED.confirmed_at,
    confirmed_by = COALESCE(s.confirmed_by, EXCLUDED.confirmed_by),
    seller_name = EXCLUDED.seller_name,
    seller_tax_id = EXCLUDED.seller_tax_id,
    seller_address = EXCLUDED.seller_address,
    seller_postal_code = EXCLUDED.seller_postal_code,
    seller_city = EXCLUDED.seller_city,
    seller_country = EXCLUDED.seller_country,
    seller_email = EXCLUDED.seller_email,
    seller_phone = EXCLUDED.seller_phone,
    seller_bank_account = EXCLUDED.seller_bank_account,
    seller_bank_swift = EXCLUDED.seller_bank_swift,
    series_invoice = EXCLUDED.series_invoice,
    series_proforma = EXCLUDED.series_proforma,
    series_correction = EXCLUDED.series_correction,
    payment_days = EXCLUDED.payment_days,
    default_vat_rate = EXCLUDED.default_vat_rate,
    vat_exempt_basis = EXCLUDED.vat_exempt_basis,
    footer_note = EXCLUDED.footer_note,
    default_locale = EXCLUDED.default_locale,
    updated_by = EXCLUDED.updated_by;
  RETURN public._event_invoice_settings_json(v_tenant);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_settings_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_settings_save(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_settings_save(jsonb) IS
  'Zapis danych wystawcy (klucz pominiety = bez zmian). Wlaczenie wymaga kompletu danych sprzedawcy i jednorazowego potwierdzenia confirm_seller. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_candidates(p_event_id uuid)
RETURNS TABLE(
  source_kind text,
  source_id uuid,
  person_name text,
  person_email text,
  company_text text,
  label_pl text,
  label_en text,
  ticket_type_id uuid,
  seats integer,
  gross_cents bigint,
  currency text,
  payment_state text,
  paid_via text,
  amount_source text,
  paid_at timestamptz,
  created_at timestamptz,
  request_id uuid,
  request_status text,
  buyer_is_company boolean,
  buyer_name text,
  buyer_tax_id text,
  buyer_email text,
  invoice_id uuid,
  invoice_number text,
  invoice_status text,
  proforma_id uuid,
  proforma_number text,
  tax_key text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  -- Bilet z cena netto (VAT doliczany) pokazujemy w brutto wg domyslnej
  -- stawki wystawcy - ta sama stawka trafi na szkic, jesli jej nie zmienic.
  v_rate text := COALESCE(
    (SELECT s.default_vat_rate FROM public.event_invoice_settings s WHERE s.tenant_id = v_tenant), '23');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH src AS (
    SELECT 'registration'::text AS kind, r.id AS sid,
           btrim(p.first_name || ' ' || p.last_name) AS pname, COALESCE(p.email, '') AS pemail,
           COALESCE(NULLIF(btrim(p.company_text), ''), c.name, '') AS ctext,
           COALESCE(t.name_pl, '') AS lpl, COALESCE(t.name_en, '') AS len, r.ticket_type_id AS tt,
           1 + (SELECT count(*)::integer FROM public.event_registrations g
                 WHERE g.group_lead_registration_id = r.id AND g.tenant_id = r.tenant_id
                   AND g.status NOT IN ('cancelled', 'rejected')) AS nseats,
           (o.id IS NOT NULL AND o.status::text IN ('paid', 'refunded')) AS via_card,
           (o.amount_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS order_gross,
           t.price_cents AS list_price,
           COALESCE(t.tax_mode, 'inclusive') = 'exclusive' AS net_price,
           COALESCE(o.currency, t.currency, 'PLN') AS cur,
           r.payment_status AS pstate,
           COALESCE(r.paid_at, o.paid_at) AS pat, r.created_at AS cat
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.crm_companies c ON c.id = p.company_id AND c.tenant_id = p.tenant_id
      LEFT JOIN public.event_ticket_types t ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
      LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
     WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
       AND r.group_lead_registration_id IS NULL
       AND r.status NOT IN ('cancelled', 'rejected')
       AND r.payment_status IN ('paid', 'partially_refunded', 'unpaid')
    UNION ALL
    SELECT 'package_order'::text, o.id, o.buyer_name, o.buyer_email, COALESCE(c.name, ''),
           k.name_pl, k.name_en, NULL::uuid, o.seats_total,
           (po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded')),
           CASE WHEN po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded')
                THEN (po.amount_cents - COALESCE(po.refunded_amount_cents, 0))::bigint
                ELSE o.amount_cents::bigint END,
           k.price_cents, false, o.currency,
           CASE WHEN o.status = 'paid' THEN 'paid' ELSE 'unpaid' END, o.paid_at, o.created_at
      FROM public.event_package_orders o
      JOIN public.event_ticket_packages k ON k.id = o.package_id AND k.tenant_id = o.tenant_id
      LEFT JOIN public.crm_companies c ON c.id = o.company_id AND c.tenant_id = o.tenant_id
      LEFT JOIN public.payment_orders po ON po.id = o.payment_order_id AND po.tenant_id = o.tenant_id
     WHERE o.tenant_id = v_tenant AND o.event_id = p_event_id AND o.status IN ('pending', 'paid')
  )
  SELECT s.kind, s.sid, s.pname, s.pemail, s.ctext, s.lpl, s.len, s.tt, s.nseats,
         CASE
           WHEN s.kind = 'package_order' OR (s.via_card AND s.order_gross IS NOT NULL) THEN s.order_gross
           WHEN s.net_price
             THEN public._event_invoice_gross_from_net(COALESCE(s.list_price, 0)::bigint, v_rate) * s.nseats
           ELSE COALESCE(s.list_price, 0)::bigint * s.nseats
         END,
         s.cur, s.pstate,
         CASE WHEN s.via_card THEN 'card' ELSE 'transfer' END,
         CASE
           WHEN s.kind = 'package_order' OR (s.via_card AND s.order_gross IS NOT NULL) THEN 'order'
           WHEN s.net_price THEN 'price_list_net'
           ELSE 'price_list'
         END,
         s.pat, s.cat,
         q.id, q.status, q.buyer_is_company, q.buyer_name, q.buyer_tax_id, q.buyer_email,
         inv.id, inv.number, inv.status,
         pro.id, pro.number,
         NULLIF(public._event_invoice_tax_key(q.buyer_tax_id), '')
    FROM src s
    LEFT JOIN LATERAL (
      SELECT x.id, x.status, x.buyer_is_company, x.buyer_name, x.buyer_tax_id, x.buyer_email
        FROM public.event_invoice_requests x
       WHERE x.tenant_id = v_tenant AND x.status <> 'cancelled'
         AND (x.registration_id = s.sid OR x.package_order_id = s.sid)
       ORDER BY x.created_at DESC LIMIT 1
    ) AS q ON true
    LEFT JOIN LATERAL (
      SELECT i.id, i.number, i.status FROM public.event_invoice_sources es
        JOIN public.event_invoices i ON i.id = es.invoice_id AND i.tenant_id = es.tenant_id
       WHERE es.tenant_id = v_tenant AND es.covers AND es.released_at IS NULL
         AND (es.registration_id = s.sid OR es.package_order_id = s.sid)
       LIMIT 1
    ) AS inv ON true
    LEFT JOIN LATERAL (
      SELECT i.id, i.number FROM public.event_invoice_sources es
        JOIN public.event_invoices i ON i.id = es.invoice_id AND i.tenant_id = es.tenant_id
       WHERE es.tenant_id = v_tenant AND i.kind = 'proforma' AND i.status <> 'cancelled'
         AND (es.registration_id = s.sid OR es.package_order_id = s.sid)
       ORDER BY i.created_at DESC LIMIT 1
    ) AS pro ON true
   ORDER BY NULLIF(public._event_invoice_tax_key(q.buyer_tax_id), '') NULLS LAST,
            lower(COALESCE(q.buyer_name, s.pname)), s.cat;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_candidates(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_candidates(uuid) IS
  'Zamowienia wydarzenia do zafakturowania (zapisy prowadzacych grupy, pakiety) z prosba, aktywna faktura i proforma; sortowane po znormalizowanym NIP. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoices_list(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  kind text,
  status text,
  number text,
  issue_date date,
  sale_date date,
  due_date date,
  currency text,
  net_cents bigint,
  vat_cents bigint,
  gross_cents bigint,
  buyer_is_company boolean,
  buyer_name text,
  buyer_tax_id text,
  buyer_email text,
  ksef_status text,
  ksef_number text,
  paid_at timestamptz,
  corrects_invoice_id uuid,
  corrects_number text,
  correction_mode text,
  source_proforma_id uuid,
  converted_invoice_id uuid,
  source_count integer,
  locale text,
  created_at timestamptz,
  issued_at timestamptz,
  cancelled_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT i.id, i.kind, i.status, i.number, i.issue_date, i.sale_date, i.due_date, i.currency,
         i.net_cents, i.vat_cents, i.gross_cents, i.buyer_is_company, i.buyer_name, i.buyer_tax_id,
         i.buyer_email, i.ksef_status, i.ksef_number, i.paid_at, i.corrects_invoice_id, c.number,
         i.correction_mode, i.source_proforma_id,
         (SELECT f.id FROM public.event_invoices f
           WHERE f.tenant_id = v_tenant AND f.source_proforma_id = i.id AND f.status <> 'cancelled'
           LIMIT 1),
         (SELECT count(*)::integer FROM public.event_invoice_sources s
           WHERE s.invoice_id = i.id AND s.tenant_id = v_tenant),
         i.locale, i.created_at, i.issued_at, i.cancelled_at
    FROM public.event_invoices i
    LEFT JOIN public.event_invoices c ON c.id = i.corrects_invoice_id AND c.tenant_id = i.tenant_id
   WHERE i.tenant_id = v_tenant AND i.event_id = p_event_id
   ORDER BY i.created_at DESC, i.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoices_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoices_list(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoices_list(uuid) IS
  'Dokumenty wydarzenia (szkice, faktury, proformy, korekty). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_get(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_doc jsonb;
BEGIN
  v_doc := public._event_invoice_document(v_tenant, p_id);
  IF v_doc IS NULL THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  RETURN v_doc || jsonb_build_object(
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'source_kind', s.source_kind, 'registration_id', s.registration_id,
        'package_order_id', s.package_order_id, 'payment_order_id', s.payment_order_id,
        'seats', s.seats, 'gross_cents', s.gross_cents, 'paid_at', s.paid_at, 'covers', s.covers,
        'released_at', s.released_at
      ) ORDER BY s.created_at, s.id)
      FROM public.event_invoice_sources s WHERE s.invoice_id = p_id AND s.tenant_id = v_tenant
    ), '[]'::jsonb),
    'corrections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'status', c.status,
                                          'correction_mode', c.correction_mode)
                       ORDER BY c.created_at)
        FROM public.event_invoices c
       WHERE c.corrects_invoice_id = p_id AND c.tenant_id = v_tenant
    ), '[]'::jsonb),
    -- Podstawa kolejnej korekty: pozycje PO wystawionych korektach.
    'current_lines', CASE
      WHEN v_doc->'invoice'->>'kind' = 'invoice' AND v_doc->'invoice'->>'status' = 'issued'
        THEN public._event_invoice_current_lines(v_tenant, p_id)
      ELSE '[]'::jsonb
    END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_get(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_get(uuid) IS
  'Pelny dokument (pozycje, podsumowanie VAT, sprzedawca, zrodla, korekty, stan po korektach) do edytora i PDF. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_draft_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN public._event_invoice_draft_build(v_tenant, auth.uid(), p_payload);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_draft_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_draft_create(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_draft_create(jsonb) IS
  'Szkic faktury/proformy z jednego albo WIELU zamowien (zbiorcza). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_draft_update(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_inv public.event_invoices;
  v_buyer jsonb;
  v_method text;
  v_locale text;
  v_note text;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = v_id AND i.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'not_draft: only a draft can be edited' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payload->'buyer') = 'object' THEN
    v_buyer := public._event_invoice_buyer_clean(public._event_invoice_buyer_json(v_inv) || (p_payload->'buyer'));
    UPDATE public.event_invoices i
       SET buyer_is_company = (v_buyer->>'is_company')::boolean,
           buyer_name = v_buyer->>'name',
           buyer_tax_id = v_buyer->>'tax_id',
           buyer_country = v_buyer->>'country',
           buyer_address = v_buyer->>'address',
           buyer_postal_code = v_buyer->>'postal_code',
           buyer_city = v_buyer->>'city',
           buyer_email = v_buyer->>'email',
           po_number = v_buyer->>'po_number',
           recipient_name = v_buyer->>'recipient_name',
           recipient_address = v_buyer->>'recipient_address',
           crm_company_id = NULL
     WHERE i.id = v_id AND i.tenant_id = v_tenant;
  END IF;
  v_method := CASE WHEN p_payload ? 'payment_method' THEN p_payload->>'payment_method' ELSE v_inv.payment_method END;
  IF v_method IS NULL OR v_method NOT IN ('card', 'transfer', 'other') THEN
    RAISE EXCEPTION 'invalid_payment_method: payment method is card, transfer or other'
      USING ERRCODE = '22023';
  END IF;
  v_locale := CASE WHEN p_payload ? 'locale' THEN p_payload->>'locale' ELSE v_inv.locale END;
  IF v_locale IS NULL OR v_locale NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_locale: document language is pl or en' USING ERRCODE = '22023';
  END IF;
  v_note := CASE WHEN p_payload ? 'note' THEN btrim(COALESCE(p_payload->>'note', '')) ELSE v_inv.note END;
  IF char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'invalid_note: note has more than 1000 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_invoices i
     SET payment_method = v_method,
         locale = v_locale,
         note = v_note,
         sale_date = CASE WHEN p_payload ? 'sale_date' THEN NULLIF(p_payload->>'sale_date', '')::date
                          ELSE i.sale_date END,
         due_date = CASE WHEN p_payload ? 'due_date' THEN NULLIF(p_payload->>'due_date', '')::date
                         ELSE i.due_date END,
         paid_at = CASE WHEN p_payload ? 'paid_at' AND i.kind <> 'proforma'
                        THEN NULLIF(p_payload->>'paid_at', '')::timestamptz ELSE i.paid_at END,
         correction_reason = CASE WHEN i.kind = 'correction' AND p_payload ? 'correction_reason'
                                  THEN left(btrim(COALESCE(p_payload->>'correction_reason', '')), 500)
                                  ELSE i.correction_reason END
   WHERE i.id = v_id AND i.tenant_id = v_tenant;
  IF p_payload ? 'lines' THEN
    PERFORM public._event_invoice_replace_lines(v_tenant, v_id, v_inv.kind, p_payload->'lines');
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_draft_update(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_draft_update(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_draft_update(jsonb) IS
  'Edycja szkicu: nabywca (klucze pominiete = bez zmian), daty sprzedazy i platnosci, sposob platnosci, jezyk, uwagi, pozycje (pelna lista). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_issue(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN public._event_invoice_issue_core(v_tenant, auth.uid(), p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_issue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_issue(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_issue(uuid) IS
  'Wystawienie szkicu (numer bez luk, migawki, CRM, zdarzenie). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_issue_pending(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_collective boolean := COALESCE(NULLIF(p_payload->>'collective', '')::boolean, false);
  v_group record;
  v_draft uuid;
  v_result jsonb;
  v_issued jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_invoice_settings s WHERE s.tenant_id = v_tenant AND s.enabled) THEN
    RAISE EXCEPTION 'invoicing_disabled: complete and confirm the issuer settings first'
      USING ERRCODE = '22023';
  END IF;
  FOR v_group IN
    SELECT (array_agg(q.id ORDER BY q.created_at, q.id))[1] AS buyer_request,
           array_agg(q.id ORDER BY q.created_at, q.id) AS request_ids,
           jsonb_agg(jsonb_build_object('kind', q.source_kind,
                                        'id', COALESCE(q.registration_id, q.package_order_id))
                     ORDER BY q.created_at, q.id) AS sources
      FROM public.event_invoice_requests q
      LEFT JOIN public.event_registrations r ON r.id = q.registration_id AND r.tenant_id = q.tenant_id
      LEFT JOIN public.event_package_orders o ON o.id = q.package_order_id AND o.tenant_id = q.tenant_id
     WHERE q.tenant_id = v_tenant AND q.event_id = v_event_id AND q.status = 'pending'
       AND ((r.payment_status IN ('paid', 'partially_refunded') AND r.status NOT IN ('cancelled', 'rejected'))
            OR o.status = 'paid')
       AND NOT EXISTS (
         SELECT 1 FROM public.event_invoice_sources s
          WHERE s.tenant_id = v_tenant AND s.covers AND s.released_at IS NULL
            AND (s.registration_id = q.registration_id OR s.package_order_id = q.package_order_id)
       )
     GROUP BY CASE
       WHEN v_collective AND q.buyer_is_company AND q.buyer_tax_id <> ''
         THEN 'tax:' || public._event_invoice_tax_key(q.buyer_tax_id) || ':' || q.buyer_country
       ELSE 'request:' || q.id::text
     END
     ORDER BY min(q.created_at)
  LOOP
    BEGIN
      v_draft := public._event_invoice_draft_build(v_tenant, auth.uid(), jsonb_build_object(
        'event_id', v_event_id,
        'kind', 'invoice',
        'aggregate', CASE WHEN v_collective THEN 'per_ticket_type' ELSE 'per_source' END,
        'request_id', v_group.buyer_request,
        'sources', v_group.sources
      ));
      v_result := public._event_invoice_issue_core(v_tenant, auth.uid(), v_draft);
      v_issued := v_issued || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_result->>'id', 'number', v_result->>'number',
        'request_ids', to_jsonb(v_group.request_ids)
      ));
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'request_ids', to_jsonb(v_group.request_ids),
        'code', split_part(SQLERRM, ':', 1)
      ));
    END;
  END LOOP;
  RETURN jsonb_build_object('issued', v_issued, 'failed', v_failed);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_issue_pending(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_issue_pending(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_issue_pending(jsonb) IS
  'Wystawia faktury ze wszystkich oczekujacych prosb o OPLACONE zamowienia wydarzenia: jedna na prosbe albo zbiorcza per NIP (collective). Blad jednej grupy nie wycofuje pozostalych. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_cancel(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_reason text := left(btrim(COALESCE(p_payload->>'reason', '')), 500);
  v_inv public.event_invoices;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = v_id AND i.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status = 'cancelled' THEN
    RAISE EXCEPTION 'already_cancelled: the document is already cancelled' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'issued' AND v_reason = '' THEN
    RAISE EXCEPTION 'reason_required: cancelling an issued document needs a reason' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'issued' AND v_inv.kind <> 'proforma' AND v_inv.ksef_status IN ('sent', 'accepted') THEN
    RAISE EXCEPTION 'ksef_locked: a document sent to KSeF can only be corrected' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_invoices c
              WHERE c.tenant_id = v_tenant AND c.corrects_invoice_id = v_inv.id AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'has_corrections: cancel the corrections of this invoice first' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'issued' AND v_inv.kind = 'correction' AND v_inv.correction_mode = 'full' THEN
    RAISE EXCEPTION 'correction_locked: a full correction cannot be cancelled once issued'
      USING ERRCODE = '22023';
  END IF;
  -- Kazda korekta liczy sie od stanu po POPRZEDNICH. Anulowanie wczesniejszej
  -- korekty przy wystawionej pozniejszej rozjechaloby stan faktury (pozniejsza
  -- odwracala pozycje, ktorych juz by nie bylo) - anulowac wolno tylko
  -- ostatnio wystawiona. Remis czasu = odmowa (bezpieczniej).
  IF v_inv.status = 'issued' AND v_inv.kind = 'correction' AND EXISTS (
    SELECT 1 FROM public.event_invoices c
     WHERE c.tenant_id = v_tenant AND c.corrects_invoice_id = v_inv.corrects_invoice_id
       AND c.id <> v_inv.id AND c.status = 'issued' AND c.issued_at >= v_inv.issued_at
  ) THEN
    RAISE EXCEPTION 'correction_not_latest: only the latest correction of an invoice can be cancelled'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_invoice_sources s
     SET released_at = now()
   WHERE s.invoice_id = v_inv.id AND s.tenant_id = v_tenant AND s.released_at IS NULL;
  UPDATE public.event_invoice_requests q
     SET status = 'pending', invoice_id = NULL
   WHERE q.tenant_id = v_tenant AND q.invoice_id = v_inv.id AND q.status = 'invoiced';
  UPDATE public.event_invoices i
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
   WHERE i.id = v_inv.id AND i.tenant_id = v_tenant;
  PERFORM public.emit_domain_event(
    v_tenant,
    'event_invoice',
    v_inv.id::text,
    'event_invoice.cancelled.v1',
    jsonb_build_object('event_id', v_inv.event_id, 'invoice_id', v_inv.id, 'kind', v_inv.kind),
    auth.uid()
  );
  RETURN v_inv.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_cancel(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_cancel(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_cancel(jsonb) IS
  'Anulowanie szkicu, proformy albo dokumentu przed KSeF (z powodem); zwalnia zamowienia i przywraca prosby do oczekujacych. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_correction_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'invoice_id', '')::uuid;
  v_mode text := COALESCE(NULLIF(p_payload->>'mode', ''), 'full');
  v_reason text := left(btrim(COALESCE(p_payload->>'reason', '')), 500);
  v_changes jsonb := CASE WHEN jsonb_typeof(p_payload->'lines') = 'array' THEN p_payload->'lines'
                          ELSE '[]'::jsonb END;
  v_inv public.event_invoices;
  v_new uuid;
  v_cur jsonb;
  v_anchor uuid;
  v_cur_qty integer;
  v_cur_unit bigint;
  v_cur_rate text;
  v_change jsonb;
  v_qty integer;
  v_unit bigint;
  v_rate text;
  v_changed integer := 0;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = v_id AND i.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_inv.kind <> 'invoice' OR v_inv.status <> 'issued' THEN
    RAISE EXCEPTION 'correction_target_invalid: only an issued invoice can be corrected'
      USING ERRCODE = '22023';
  END IF;
  IF v_mode NOT IN ('full', 'partial') THEN
    RAISE EXCEPTION 'invalid_correction_mode: a correction is full or partial' USING ERRCODE = '22023';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'reason_required: a correction needs a reason' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_invoices c
              WHERE c.tenant_id = v_tenant AND c.corrects_invoice_id = v_inv.id
                AND (c.status = 'draft' OR (c.status = 'issued' AND c.correction_mode = 'full'))) THEN
    RAISE EXCEPTION 'correction_exists: finish the open correction or the invoice is fully corrected'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.event_invoices (
    tenant_id, event_id, event_slug, event_title_pl, event_title_en, kind, status, sale_date,
    payment_method, currency, buyer_is_company, buyer_name, buyer_tax_id, buyer_country,
    buyer_address, buyer_postal_code, buyer_city, buyer_email, po_number, recipient_name,
    recipient_address, buyer_user_id, buyer_person_id, crm_company_id, corrects_invoice_id,
    correction_mode, correction_reason, locale, note, created_by
  ) VALUES (
    v_tenant, v_inv.event_id, v_inv.event_slug, v_inv.event_title_pl, v_inv.event_title_en,
    'correction', 'draft', v_inv.sale_date, v_inv.payment_method, v_inv.currency,
    v_inv.buyer_is_company, v_inv.buyer_name, v_inv.buyer_tax_id, v_inv.buyer_country,
    v_inv.buyer_address, v_inv.buyer_postal_code, v_inv.buyer_city, v_inv.buyer_email,
    v_inv.po_number, v_inv.recipient_name, v_inv.recipient_address, v_inv.buyer_user_id,
    v_inv.buyer_person_id, v_inv.crm_company_id, v_inv.id, v_mode, v_reason, v_inv.locale, '',
    auth.uid()
  )
  RETURNING id INTO v_new;

  -- Podstawa korekty to STAN PO WYSTAWIONYCH KOREKTACH (_event_invoice_current_lines),
  -- nie pierwotne pozycje faktury: pozycja "przed" odwraca biezacy stan
  -- kotwicy, a pozycja "po" niesie nowy. Pelna korekta odwraca caly stan.
  FOR v_cur IN SELECT x.value FROM jsonb_array_elements(public._event_invoice_current_lines(v_tenant, v_inv.id)) AS x
  LOOP
    v_anchor := (v_cur->>'line_id')::uuid;
    v_cur_qty := (v_cur->>'quantity')::integer;
    v_cur_unit := (v_cur->>'unit_gross_cents')::bigint;
    v_cur_rate := v_cur->>'vat_rate';
    IF v_mode = 'full' THEN
      IF v_cur_qty > 0 THEN
        PERFORM public._event_invoice_add_line(v_tenant, v_new, v_cur->>'description', v_cur->>'unit',
          -v_cur_qty, v_cur_unit, v_cur_rate, NULLIF(v_cur->>'ticket_type_id', '')::uuid, v_anchor);
        v_changed := v_changed + 1;
      END IF;
    ELSE
      SELECT x.value INTO v_change FROM jsonb_array_elements(v_changes) AS x
       WHERE x.value->>'line_id' = v_anchor::text
       LIMIT 1;
      IF v_change IS NOT NULL THEN
        v_qty := COALESCE(NULLIF(v_change->>'quantity', '')::integer, v_cur_qty);
        v_unit := COALESCE(NULLIF(v_change->>'unit_gross_cents', '')::bigint, v_cur_unit);
        v_rate := COALESCE(NULLIF(v_change->>'vat_rate', ''), v_cur_rate);
        IF v_qty < 0 OR v_qty > 10000 OR v_unit < 0 OR v_unit > 100000000
           OR v_rate NOT IN ('23', '8', '5', '0', 'zw', 'np') THEN
          RAISE EXCEPTION 'invalid_line: corrected quantity, price or rate is out of range'
            USING ERRCODE = '22023';
        END IF;
        IF (v_cur_qty > 0 AND (v_qty <> v_cur_qty OR v_unit <> v_cur_unit OR v_rate <> v_cur_rate))
           OR (v_cur_qty = 0 AND v_qty > 0) THEN
          IF v_cur_qty > 0 THEN
            PERFORM public._event_invoice_add_line(v_tenant, v_new, v_cur->>'description', v_cur->>'unit',
              -v_cur_qty, v_cur_unit, v_cur_rate, NULLIF(v_cur->>'ticket_type_id', '')::uuid, v_anchor);
          END IF;
          IF v_qty > 0 THEN
            PERFORM public._event_invoice_add_line(v_tenant, v_new, v_cur->>'description', v_cur->>'unit',
              v_qty, v_unit, v_rate, NULLIF(v_cur->>'ticket_type_id', '')::uuid, v_anchor);
          END IF;
          v_changed := v_changed + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;
  IF v_changed = 0 THEN
    RAISE EXCEPTION 'correction_empty: the correction changes no line' USING ERRCODE = '22023';
  END IF;
  IF v_mode = 'partial' AND NOT EXISTS (
    SELECT 1 FROM public._event_invoice_state(v_tenant, v_inv.id, v_new) AS st WHERE st.quantity <> 0
  ) THEN
    RAISE EXCEPTION 'correction_use_full: the correction reverses the whole invoice - use a full correction'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._event_invoice_recalc(v_tenant, v_new);
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_correction_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_correction_create(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_correction_create(jsonb) IS
  'Szkic korekty wystawionej faktury liczonej od STANU PO WYSTAWIONYCH KOREKTACH: pelne odwrocenie albo zmiana wybranych pozycji (para przed/po). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_from_proforma(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_pro public.event_invoices;
  v_new uuid;
  v_source public.event_invoice_sources;
  v_resolved jsonb := '[]'::jsonb;
  v_rate text;
  v_all_paid boolean;
  v_all_card boolean;
  v_paid_at timestamptz;
BEGIN
  SELECT * INTO v_pro FROM public.event_invoices i
   WHERE i.id = p_id AND i.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_pro.kind <> 'proforma' OR v_pro.status <> 'issued' THEN
    RAISE EXCEPTION 'not_proforma: only an issued proforma can become an invoice' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_invoices f
              WHERE f.tenant_id = v_tenant AND f.source_proforma_id = v_pro.id AND f.status <> 'cancelled') THEN
    RAISE EXCEPTION 'proforma_already_converted: this proforma already has an invoice' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_invoice_sources s
      JOIN public.event_invoice_sources a
        ON a.tenant_id = s.tenant_id AND a.covers AND a.released_at IS NULL
       AND (a.registration_id = s.registration_id OR a.package_order_id = s.package_order_id)
     WHERE s.invoice_id = v_pro.id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'already_invoiced: an order already has an active invoice' USING ERRCODE = '23505';
  END IF;

  -- ZRODLA Z BIEZACEGO STANU, nie kopia migawki proformy: miedzy proforma
  -- a faktura kupujacy zwykle placi (przelewem albo karta, np. z kuponem na
  -- inna kwote). Karta i faktyczna kwota trafiaja na szkic, wiec przy
  -- wystawieniu dziala regula operatora (_event_invoice_card_block), a edytor
  -- pokazuje rozjazd pozycji z kwota zamowien.
  v_rate := COALESCE((SELECT l.vat_rate FROM public.event_invoice_lines l
                       WHERE l.invoice_id = v_pro.id AND l.tenant_id = v_tenant
                       ORDER BY l.position LIMIT 1), '23');
  FOR v_source IN
    SELECT * FROM public.event_invoice_sources s
     WHERE s.invoice_id = v_pro.id AND s.tenant_id = v_tenant
     ORDER BY s.created_at, s.id
  LOOP
    IF COALESCE(v_source.registration_id, v_source.package_order_id) IS NULL THEN
      RAISE EXCEPTION 'source_changed: an order of this proforma no longer exists' USING ERRCODE = '22023';
    END IF;
    v_resolved := v_resolved || jsonb_build_array(public._event_invoice_resolve_source(
      v_tenant, v_pro.event_id, v_source.source_kind,
      COALESCE(v_source.registration_id, v_source.package_order_id), v_rate, v_pro.locale
    ));
  END LOOP;
  SELECT bool_and((x.value->>'paid')::boolean), bool_and((x.value->>'via_card')::boolean),
         max(NULLIF(x.value->>'paid_at', '')::timestamptz)
    INTO v_all_paid, v_all_card, v_paid_at
    FROM jsonb_array_elements(v_resolved) AS x;
  v_paid_at := COALESCE(v_pro.paid_at, CASE WHEN v_all_paid THEN v_paid_at END);

  INSERT INTO public.event_invoices (
    tenant_id, event_id, event_slug, event_title_pl, event_title_en, kind, status, sale_date,
    payment_method, paid_at, currency, buyer_is_company, buyer_name, buyer_tax_id, buyer_country,
    buyer_address, buyer_postal_code, buyer_city, buyer_email, po_number, recipient_name,
    recipient_address, buyer_user_id, buyer_person_id, crm_company_id, source_proforma_id, locale,
    note, created_by
  ) VALUES (
    v_tenant, v_pro.event_id, v_pro.event_slug, v_pro.event_title_pl, v_pro.event_title_en,
    'invoice', 'draft', COALESCE((v_paid_at AT TIME ZONE 'Europe/Warsaw')::date, v_pro.sale_date),
    CASE WHEN v_all_card THEN 'card' ELSE v_pro.payment_method END, v_paid_at, v_pro.currency,
    v_pro.buyer_is_company, v_pro.buyer_name,
    v_pro.buyer_tax_id, v_pro.buyer_country, v_pro.buyer_address, v_pro.buyer_postal_code,
    v_pro.buyer_city, v_pro.buyer_email, v_pro.po_number, v_pro.recipient_name,
    v_pro.recipient_address, v_pro.buyer_user_id, v_pro.buyer_person_id, v_pro.crm_company_id,
    v_pro.id, v_pro.locale, v_pro.note, auth.uid()
  )
  RETURNING id INTO v_new;

  INSERT INTO public.event_invoice_sources (
    tenant_id, invoice_id, source_kind, registration_id, package_order_id, payment_order_id,
    person_id, seats, gross_cents, paid_at, covers
  )
  SELECT v_tenant, v_new, x.value->>'kind',
         CASE WHEN x.value->>'kind' = 'registration' THEN (x.value->>'id')::uuid END,
         CASE WHEN x.value->>'kind' = 'package_order' THEN (x.value->>'id')::uuid END,
         NULLIF(x.value->>'payment_order_id', '')::uuid,
         NULLIF(x.value->>'person_id', '')::uuid,
         (x.value->>'source_seats')::integer, (x.value->>'gross')::bigint,
         NULLIF(x.value->>'paid_at', '')::timestamptz, true
    FROM jsonb_array_elements(v_resolved) AS x;

  INSERT INTO public.event_invoice_lines (
    tenant_id, invoice_id, position, description, unit, quantity, unit_gross_cents, unit_net_cents,
    vat_rate, net_cents, vat_cents, gross_cents, ticket_type_id
  )
  SELECT v_tenant, v_new, l.position, l.description, l.unit, l.quantity, l.unit_gross_cents,
         l.unit_net_cents, l.vat_rate, l.net_cents, l.vat_cents, l.gross_cents, l.ticket_type_id
    FROM public.event_invoice_lines l
   WHERE l.invoice_id = v_pro.id AND l.tenant_id = v_tenant;
  PERFORM public._event_invoice_recalc(v_tenant, v_new);
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_from_proforma(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_from_proforma(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_from_proforma(uuid) IS
  'Szkic faktury koncowej z wystawionej proformy (te same pozycje i nabywca, zamowienia w BIEZACYM stanie: karta, kwota, zaplata). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_ksef_update(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_status text := NULLIF(btrim(COALESCE(p_payload->>'status', '')), '');
  v_number text := NULLIF(btrim(COALESCE(p_payload->>'number', '')), '');
  v_inv public.event_invoices;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = v_id AND i.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'issued' OR v_inv.kind = 'proforma' THEN
    RAISE EXCEPTION 'ksef_not_applicable: KSeF applies to an issued invoice or correction'
      USING ERRCODE = '22023';
  END IF;
  IF v_status IS NULL OR v_status NOT IN ('not_applicable', 'pending', 'sent', 'accepted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_ksef_status: unknown KSeF status' USING ERRCODE = '22023';
  END IF;
  IF v_status = 'accepted' AND v_number IS NULL THEN
    RAISE EXCEPTION 'ksef_number_required: an accepted document needs the KSeF number'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_number) > 64 THEN
    RAISE EXCEPTION 'invalid_ksef_number: KSeF number has at most 64 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_invoices i
     SET ksef_status = v_status, ksef_number = v_number, ksef_updated_at = now()
   WHERE i.id = v_inv.id AND i.tenant_id = v_tenant;
  RETURN v_inv.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_ksef_update(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_ksef_update(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_ksef_update(jsonb) IS
  'Reczny stan i numer KSeF wystawionej faktury/korekty (szew pod przyszly klient API KSeF). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_set_paid(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_paid timestamptz := NULLIF(p_payload->>'paid_at', '')::timestamptz;
BEGIN
  UPDATE public.event_invoices i
     SET paid_at = v_paid
   WHERE i.id = v_id AND i.tenant_id = v_tenant AND i.status = 'issued';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: issued document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_set_paid(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_set_paid(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_set_paid(jsonb) IS
  'Data zaplaty wystawionego dokumentu (NULL = nieoplacony). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_invoice_notify_payload(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_inv public.event_invoices;
  v_email text;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i WHERE i.id = p_id AND i.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = v_inv.buyer_user_id;
  RETURN jsonb_build_object(
    'tenant_id', v_tenant,
    'invoice_id', v_inv.id,
    'status', v_inv.status,
    'kind', v_inv.kind,
    'number', v_inv.number,
    'issue_date', v_inv.issue_date,
    'gross_cents', v_inv.gross_cents,
    'currency', v_inv.currency,
    'locale', v_inv.locale,
    'event_title_pl', v_inv.event_title_pl,
    'event_title_en', v_inv.event_title_en,
    'buyer_name', v_inv.buyer_name,
    'has_account', v_inv.buyer_user_id IS NOT NULL,
    'recipient', COALESCE(NULLIF(v_inv.buyer_email, ''), v_email)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_notify_payload(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_notify_payload(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_notify_payload(uuid) IS
  'Ladunek maila event_invoice_issued (granica autoryzacji funkcji serwerowej). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 7. PLASZCZYZNA KUPUJACEGO (public_tenant_id + auth.uid, wlasnosc w SQL).
-- ----------------------------------------------------------------------------
-- Czy kupujacy moze w ogole poprosic o fakture organizatora - zanim wpisze
-- dane firmy. Blok "Potrzebuje faktury na firme" obiecywal fakture takze
-- wtedy, gdy organizator nie fakturuje albo gdy za platnosc karta fakture
-- wystawia operator: kupujacy wpisywal dane, placil i czekal na dokument,
-- ktory nie mogl powstac. Ta sama regula co _event_invoice_card_block dla
-- zamowienia, ktore dopiero powstanie (ustawienia kasy z tej chwili).
--   enabled               - organizator potwierdzil dane wystawcy;
--   card_invoiceable      - organizator moze zafakturowac platnosc karta;
--   card_operator_invoice - za platnosc karta dokument wystawia operator/Stripe.
CREATE OR REPLACE FUNCTION public.event_invoice_public_options()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_enabled boolean;
  v_merchant boolean;
  v_invoice_creation boolean;
BEGIN
  SELECT s.enabled INTO v_enabled FROM public.event_invoice_settings s WHERE s.tenant_id = v_tenant;
  SELECT c.automatic_tax, c.invoice_creation INTO v_merchant, v_invoice_creation
    FROM public.checkout_settings c WHERE c.tenant_id = v_tenant;
  v_enabled := COALESCE(v_enabled, false);
  v_merchant := COALESCE(v_merchant, false);
  v_invoice_creation := COALESCE(v_invoice_creation, true);
  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'card_invoiceable', v_enabled AND v_merchant AND NOT v_invoice_creation,
    'card_operator_invoice', NOT v_merchant OR v_invoice_creation
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_invoice_public_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_invoice_public_options() TO authenticated, service_role;
COMMENT ON FUNCTION public.event_invoice_public_options() IS
  'Czy organizator fakturuje i czy za platnosc karta fakture wystawi organizator, czy operator platnosci (blok prosby o fakture w kroku platnosci). Plaszczyzna: public_tenant_id().';

CREATE OR REPLACE FUNCTION public.event_invoice_request_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_registration uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_package_order uuid := NULLIF(p_payload->>'package_order_id', '')::uuid;
  v_event_id uuid;
  v_paid_at timestamptz;
  v_card uuid;
  v_lead uuid;
  v_buyer jsonb;
  v_id uuid;
  v_status text;
  v_requested_by uuid;
  v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to request an invoice' USING ERRCODE = '42501';
  END IF;
  IF (v_registration IS NULL) = (v_package_order IS NULL) THEN
    RAISE EXCEPTION 'invalid_source: pick a registration or a package order' USING ERRCODE = '22023';
  END IF;
  SELECT r.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_invoice_request', v_tenant::text || ':' || v_uid::text, 20, 60) AS r;
  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'rate_limited: too many invoice requests' USING ERRCODE = '54000';
  END IF;
  -- Organizator, ktory nie wystawia faktur, nie dostaje prosb, na ktore nie
  -- odpowie (kupujacy czekalby na dokument, ktory nie powstanie).
  IF NOT EXISTS (SELECT 1 FROM public.event_invoice_settings s WHERE s.tenant_id = v_tenant AND s.enabled) THEN
    RAISE EXCEPTION 'invoicing_disabled: the organizer does not issue invoices' USING ERRCODE = '22023';
  END IF;
  -- WLASNOSC ZAPISU: osoba zapisu przypieta do konta (jak event_my_registrations)
  -- albo zalozyciel SAMODZIELNEGO zapisu (`source = 'self_registration'` -
  -- kupujacy zapisujacy kolege, konto przypiete do innego wiersza osoby).
  -- Zapis wpisany przez organizatora (`admin_event_registration_upsert`
  -- stempluje created_by kontem PRACOWNIKA) nie jest zamowieniem pracownika:
  -- bez tego warunku pracownik - takze po odebraniu roli - czytalby
  -- i nadpisywal dane firmy uczestnika, a faktura trafialaby do jego profilu.
  IF v_registration IS NOT NULL THEN
    SELECT COALESCE(r.group_lead_registration_id, r.id) INTO v_lead
      FROM public.event_registrations r
     WHERE r.id = v_registration AND r.tenant_id = v_tenant;
    SELECT r.event_id, COALESCE(r.paid_at, o.paid_at),
           CASE WHEN o.id IS NOT NULL AND o.status::text IN ('paid', 'refunded') THEN o.id END
      INTO v_event_id, v_paid_at, v_card
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
     WHERE r.id = v_lead AND r.tenant_id = v_tenant
       AND (p.user_id = v_uid OR (r.created_by = v_uid AND r.source = 'self_registration'))
       AND r.status NOT IN ('cancelled', 'rejected')
       AND r.payment_status IN ('paid', 'partially_refunded', 'unpaid');
    v_registration := v_lead;
  ELSE
    SELECT o.event_id, o.paid_at,
           CASE WHEN po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded') THEN po.id END
      INTO v_event_id, v_paid_at, v_card
      FROM public.event_package_orders o
      LEFT JOIN public.payment_orders po ON po.id = o.payment_order_id AND po.tenant_id = o.tenant_id
     WHERE o.id = v_package_order AND o.tenant_id = v_tenant AND o.buyer_user_id = v_uid
       AND o.status IN ('pending', 'paid');
  END IF;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: order does not exist or is not yours' USING ERRCODE = '42501';
  END IF;
  IF v_paid_at IS NOT NULL
     AND (now() AT TIME ZONE 'Europe/Warsaw')::date
       > (date_trunc('month', v_paid_at AT TIME ZONE 'Europe/Warsaw') + interval '4 months' - interval '1 day')::date THEN
    RAISE EXCEPTION 'request_window_closed: invoice can be requested until the end of the third month after payment'
      USING ERRCODE = '22023';
  END IF;
  -- Zamowienie oplacone karta, za ktore organizator nie moze wystawic wlasnej
  -- faktury (tryb operatora, faktura Stripe, niepewna plaszczyzna): dokument
  -- wystawia operator platnosci - prosba bylaby obietnica bez pokrycia.
  IF v_card IS NOT NULL AND public._event_invoice_card_block(v_tenant, v_card) IS NOT NULL THEN
    RAISE EXCEPTION 'operator_invoice: the payment operator issues the invoice for this card payment'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_invoice_sources s
     WHERE s.tenant_id = v_tenant AND s.covers AND s.released_at IS NULL
       AND (s.registration_id = v_registration OR s.package_order_id = v_package_order)
  ) THEN
    RAISE EXCEPTION 'already_invoiced: an order already has an active invoice' USING ERRCODE = '23505';
  END IF;
  v_buyer := public._event_invoice_buyer_clean(p_payload->'buyer');

  SELECT q.id, q.status, q.requested_by INTO v_id, v_status, v_requested_by
    FROM public.event_invoice_requests q
   WHERE q.tenant_id = v_tenant AND q.status <> 'cancelled'
     AND (q.registration_id = v_registration OR q.package_order_id = v_package_order)
   FOR UPDATE;
  IF v_status = 'invoiced' THEN
    RAISE EXCEPTION 'already_invoiced: an order already has an active invoice' USING ERRCODE = '23505';
  END IF;
  -- Prosbe zlozona przez INNE konto (platnik i uczestnik to dwa konta tego
  -- samego zamowienia) zmienia i wycofuje wylacznie jej autor.
  IF v_id IS NOT NULL AND v_requested_by IS NOT NULL AND v_requested_by <> v_uid THEN
    RAISE EXCEPTION 'request_foreign: another person already requested an invoice for this order'
      USING ERRCODE = '42501';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.event_invoice_requests (
      tenant_id, event_id, source_kind, registration_id, package_order_id, buyer_is_company,
      buyer_name, buyer_tax_id, buyer_country, buyer_address, buyer_postal_code, buyer_city,
      buyer_email, po_number, recipient_name, recipient_address, requested_by
    ) VALUES (
      v_tenant, v_event_id, CASE WHEN v_registration IS NOT NULL THEN 'registration' ELSE 'package_order' END,
      v_registration, v_package_order, (v_buyer->>'is_company')::boolean, v_buyer->>'name',
      v_buyer->>'tax_id', v_buyer->>'country', v_buyer->>'address', v_buyer->>'postal_code',
      v_buyer->>'city', v_buyer->>'email', v_buyer->>'po_number', v_buyer->>'recipient_name',
      v_buyer->>'recipient_address', v_uid
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_invoice_requests q
       SET buyer_is_company = (v_buyer->>'is_company')::boolean,
           buyer_name = v_buyer->>'name',
           buyer_tax_id = v_buyer->>'tax_id',
           buyer_country = v_buyer->>'country',
           buyer_address = v_buyer->>'address',
           buyer_postal_code = v_buyer->>'postal_code',
           buyer_city = v_buyer->>'city',
           buyer_email = v_buyer->>'email',
           po_number = v_buyer->>'po_number',
           recipient_name = v_buyer->>'recipient_name',
           recipient_address = v_buyer->>'recipient_address',
           requested_by = v_uid,
           crm_company_id = NULL
     WHERE q.id = v_id AND q.tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.event_invoice_request_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_invoice_request_save(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.event_invoice_request_save(jsonb) IS
  'Prosba kupujacego o fakture do WLASNEGO zapisu (osoba konta albo samodzielny zapis zalozony z konta; prowadzacy grupy) albo zamowienia pakietu; tylko gdy organizator fakturuje i zamowienie z karty nie nalezy do operatora; okno do konca trzeciego miesiaca po zaplacie; cudzej prosby nie przejmuje. Plaszczyzna: public_tenant_id() + auth.uid().';

CREATE OR REPLACE FUNCTION public.event_invoice_request_cancel(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to manage invoice requests' USING ERRCODE = '42501';
  END IF;
  UPDATE public.event_invoice_requests q
     SET status = 'cancelled'
   WHERE q.id = p_request_id AND q.tenant_id = v_tenant AND q.requested_by = v_uid
     AND q.status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: pending request does not exist or is not yours' USING ERRCODE = '42501';
  END IF;
  RETURN p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.event_invoice_request_cancel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_invoice_request_cancel(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.event_invoice_request_cancel(uuid) IS
  'Wycofanie wlasnej oczekujacej prosby o fakture. Plaszczyzna: public_tenant_id() + auth.uid().';

CREATE OR REPLACE FUNCTION public.event_my_invoice_sources()
RETURNS TABLE(
  source_kind text,
  source_id uuid,
  event_id uuid,
  event_slug text,
  event_title_pl text,
  event_title_en text,
  label_pl text,
  label_en text,
  seats integer,
  gross_cents bigint,
  currency text,
  payment_state text,
  paid_at timestamptz,
  request_deadline date,
  can_request boolean,
  request_block text,
  request_id uuid,
  request_status text,
  buyer_is_company boolean,
  buyer_name text,
  buyer_tax_id text,
  buyer_country text,
  buyer_address text,
  buyer_postal_code text,
  buyer_city text,
  buyer_email text,
  po_number text,
  invoice_id uuid,
  invoice_number text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_enabled boolean;
  v_rate text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  SELECT s.enabled, s.default_vat_rate INTO v_enabled, v_rate
    FROM public.event_invoice_settings s WHERE s.tenant_id = v_tenant;
  RETURN QUERY
  WITH src AS (
    -- Wlasnosc jak w event_invoice_request_save: osoba konta albo samodzielny
    -- zapis zalozony z konta (nigdy zapis wpisany przez pracownika).
    SELECT 'registration'::text AS kind, r.id AS sid, r.event_id AS eid,
           COALESCE(t.name_pl, '') AS lpl, COALESCE(t.name_en, '') AS len,
           1 + (SELECT count(*)::integer FROM public.event_registrations g
                 WHERE g.group_lead_registration_id = r.id AND g.tenant_id = r.tenant_id
                   AND g.status NOT IN ('cancelled', 'rejected')) AS nseats,
           (o.amount_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS order_gross,
           t.price_cents AS list_price,
           COALESCE(t.tax_mode, 'inclusive') = 'exclusive' AS net_price,
           CASE WHEN o.id IS NOT NULL AND o.status::text IN ('paid', 'refunded') THEN o.id END AS card,
           COALESCE(o.currency, t.currency, 'PLN') AS cur,
           CASE WHEN r.payment_status = 'unpaid' THEN 'unpaid' ELSE 'paid' END AS pstate,
           COALESCE(r.paid_at, o.paid_at) AS pat, r.created_at AS cat
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.event_ticket_types t ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
      LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
     WHERE r.tenant_id = v_tenant AND r.group_lead_registration_id IS NULL
       AND (p.user_id = v_uid OR (r.created_by = v_uid AND r.source = 'self_registration'))
       AND r.status NOT IN ('cancelled', 'rejected')
       AND r.payment_status IN ('paid', 'partially_refunded', 'unpaid')
    UNION ALL
    SELECT 'package_order'::text, o.id, o.event_id, k.name_pl, k.name_en, o.seats_total,
           CASE WHEN po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded')
                THEN (po.amount_cents - COALESCE(po.refunded_amount_cents, 0))::bigint
                ELSE o.amount_cents::bigint END,
           k.price_cents, false,
           CASE WHEN po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded') THEN po.id END,
           o.currency,
           CASE WHEN o.status = 'paid' THEN 'paid' ELSE 'unpaid' END, o.paid_at, o.created_at
      FROM public.event_package_orders o
      JOIN public.event_ticket_packages k ON k.id = o.package_id AND k.tenant_id = o.tenant_id
      LEFT JOIN public.payment_orders po ON po.id = o.payment_order_id AND po.tenant_id = o.tenant_id
     WHERE o.tenant_id = v_tenant AND o.buyer_user_id = v_uid AND o.status IN ('pending', 'paid')
  ),
  own AS (
    SELECT s.*, e.slug, e.title_pl, e.title_en, q.*,
           inv.id AS inv_id, inv.number AS inv_number, inv.status AS inv_status,
           CASE WHEN s.pat IS NULL THEN NULL::date
                ELSE (date_trunc('month', s.pat AT TIME ZONE 'Europe/Warsaw') + interval '4 months'
                      - interval '1 day')::date
           END AS deadline,
           -- Prosba INNEGO konta (drugi wlasciciel zamowienia): bez jej danych.
           (q.q_id IS NOT NULL AND q.q_by IS NOT NULL AND q.q_by <> v_uid) AS foreign_request
      FROM src s
      JOIN public.events e ON e.id = s.eid AND e.tenant_id = v_tenant
      LEFT JOIN LATERAL (
        SELECT x.id AS q_id, x.status AS q_status, x.requested_by AS q_by,
               x.buyer_is_company AS q_company, x.buyer_name AS q_name, x.buyer_tax_id AS q_tax,
               x.buyer_country AS q_country, x.buyer_address AS q_address,
               x.buyer_postal_code AS q_postal, x.buyer_city AS q_city, x.buyer_email AS q_email,
               x.po_number AS q_po
          FROM public.event_invoice_requests x
         WHERE x.tenant_id = v_tenant AND x.status <> 'cancelled'
           AND (x.registration_id = s.sid OR x.package_order_id = s.sid)
         ORDER BY x.created_at DESC LIMIT 1
      ) AS q ON true
      LEFT JOIN LATERAL (
        SELECT i.id, i.number, i.status FROM public.event_invoice_sources es
          JOIN public.event_invoices i ON i.id = es.invoice_id AND i.tenant_id = es.tenant_id
         WHERE es.tenant_id = v_tenant AND es.covers AND es.released_at IS NULL
           AND (es.registration_id = s.sid OR es.package_order_id = s.sid)
         LIMIT 1
      ) AS inv ON true
  ),
  decided AS (
    SELECT w.*,
           -- Dlaczego prosby nie ma (NULL = mozna prosic): faktura w toku albo
           -- wystawiona, organizator nie fakturuje, prosba innego konta, po
           -- terminie, zamowienie z karty fakturuje operator.
           CASE
             WHEN w.inv_id IS NOT NULL THEN 'invoiced'
             WHEN NOT COALESCE(v_enabled, false) THEN 'disabled'
             WHEN w.foreign_request THEN 'other_requester'
             WHEN w.deadline IS NOT NULL AND v_today > w.deadline THEN 'window_closed'
             WHEN w.card IS NOT NULL AND public._event_invoice_card_block(v_tenant, w.card) IS NOT NULL
               THEN 'operator_invoice'
           END AS block
      FROM own w
  )
  SELECT d.kind, d.sid, d.eid, d.slug, d.title_pl, d.title_en, d.lpl, d.len, d.nseats,
         CASE
           WHEN d.order_gross IS NOT NULL THEN d.order_gross
           WHEN d.net_price
             THEN public._event_invoice_gross_from_net(COALESCE(d.list_price, 0)::bigint, COALESCE(v_rate, '23'))
                  * d.nseats
           ELSE COALESCE(d.list_price, 0)::bigint * d.nseats
         END,
         d.cur, d.pstate, d.pat, d.deadline,
         d.block IS NULL, d.block,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_id END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_status END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_company END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_name END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_tax END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_country END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_address END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_postal END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_city END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_email END,
         CASE WHEN d.foreign_request THEN NULL ELSE d.q_po END,
         CASE WHEN d.inv_status = 'issued' THEN d.inv_id END,
         CASE WHEN d.inv_status = 'issued' THEN d.inv_number END,
         d.cat
    FROM decided d
   ORDER BY d.cat DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.event_my_invoice_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_invoice_sources() TO authenticated, service_role;
COMMENT ON FUNCTION public.event_my_invoice_sources() IS
  'Wlasne zamowienia wydarzen (zapisy prowadzacego, pakiety) z prosba o fakture, terminem prosby, powodem braku prosby (request_block) i wystawiona faktura. Plaszczyzna: public_tenant_id() + auth.uid().';

CREATE OR REPLACE FUNCTION public.event_my_invoices()
RETURNS TABLE(
  id uuid,
  kind text,
  status text,
  number text,
  issue_date date,
  currency text,
  gross_cents bigint,
  event_id uuid,
  event_slug text,
  event_title_pl text,
  event_title_en text,
  buyer_name text,
  corrects_number text,
  paid_at timestamptz,
  due_date date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT i.id, i.kind, i.status, i.number, i.issue_date, i.currency, i.gross_cents, i.event_id,
         i.event_slug, i.event_title_pl, i.event_title_en, i.buyer_name, c.number, i.paid_at, i.due_date
    FROM public.event_invoices i
    LEFT JOIN public.event_invoices c ON c.id = i.corrects_invoice_id AND c.tenant_id = i.tenant_id
   WHERE i.tenant_id = v_tenant AND i.buyer_user_id = v_uid
     AND (i.status = 'issued' OR (i.status = 'cancelled' AND i.number IS NOT NULL))
   ORDER BY i.issued_at DESC NULLS LAST, i.id;
END;
$$;
REVOKE ALL ON FUNCTION public.event_my_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_invoices() TO authenticated, service_role;
COMMENT ON FUNCTION public.event_my_invoices() IS
  'Wlasne wystawione dokumenty za wydarzenia (faktury, proformy, korekty). Plaszczyzna: public_tenant_id() + auth.uid().';

CREATE OR REPLACE FUNCTION public.event_my_invoice(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_doc jsonb;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.event_invoices i
     WHERE i.id = p_id AND i.tenant_id = v_tenant AND i.buyer_user_id = v_uid
       AND (i.status = 'issued' OR (i.status = 'cancelled' AND i.number IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'not_found: document does not exist or is not yours' USING ERRCODE = '42501';
  END IF;
  v_doc := public._event_invoice_document(v_tenant, p_id);
  RETURN v_doc || jsonb_build_object(
    'invoice', (v_doc->'invoice') - 'crm_company_id' - 'buyer_person_id' - 'buyer_user_id'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_my_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_invoice(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.event_my_invoice(uuid) IS
  'Pelna migawka wlasnego wystawionego dokumentu (do PDF). Plaszczyzna: public_tenant_id() + auth.uid().';
