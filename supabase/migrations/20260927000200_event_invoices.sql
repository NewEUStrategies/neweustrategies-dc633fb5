-- ============================================================================
-- FAKTURY NA FIRME ZA BILETY I PAKIETY WYDARZEN (TAKZE ZBIORCZE), PROFORMY,
-- KOREKTY I STAN KSeF.
--
-- BLIZNIAK drizzle/migrations/0058_event_invoices.sql - ten sam SQL wykonywalny
-- (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
-- events-harness: include
--
-- PO CO
--   Firma kupujaca bilety dla zespolu (kilka zamowien z karty, zapis grupowy
--   jednym zamowieniem albo pakiet miejsc oplacany przelewem) potrzebuje
--   faktury VAT na swoje dane - czesto JEDNEJ na wszystkie zamowienia. Do tej
--   pory modul Wydarzen zbieral wylacznie wolny tekst "dane do faktury"
--   (`event_package_orders.invoice_note`), a jedyne dokumenty w repozytorium
--   byly kopiami dokumentow operatora platnosci. Ten plik stawia silnik
--   dokumentow organizatora: dane nabywcy, szkic, numeracje, wystawienie,
--   proforme, korekte, stan KSeF i powiazanie z kartoteka CRM.
--
-- DECYZJE PRODUKTOWE I PODATKOWE (podjete przez prowadzacego, tu utrwalone)
--   1) SPRZEDAWCA = NAJEMCA ORGANIZUJACY. Fakturowanie jest WYLACZONE, dopoki
--      administrator nie uzupelni danych wystawcy i nie potwierdzi jawnie
--      "wystawiamy faktury jako sprzedawca biletow" (`enabled` wymaga
--      `confirmed_at`). Gdy kasa pracuje w trybie operatora rozliczeniowego
--      (Stripe Managed Payments / MoR = `checkout_settings.automatic_tax`
--      falsz albo brak wiersza, ta sama regula co `checkoutBillingPlane()`
--      w `src/lib/billing/checkoutSettings.ts`), SPRZEDAWCA zamowien
--      oplaconych karta jest operator - wlasnej faktury VAT za takie
--      zamowienie wystawic NIE WOLNO. Baza odmawia wtedy wystawienia faktury
--      (`mor_seller_conflict`), a szkice i proformy nadal sa dozwolone.
--      Zamowienia oplacane przelewem (pakiety, wplata zaksiegowana recznie) nie
--      przechodza przez operatora i fakturuje je organizator. Plik NIE zmienia
--      sesji Stripe, webhookow ani realizacji zamowien - dlatego plaszczyzny
--      z chwili zaplaty nie ma na zamowieniu i regula jest KONSERWATYWNA
--      (`_event_invoice_card_block`): za zamowienie z karty organizator
--      wystawia fakture tylko na wlasnym koncie (`automatic_tax`), bez faktur
--      Stripe (`invoice_creation` = falsz, inaczej `operator_invoice_enabled`)
--      i tylko gdy ustawienia kasy nie zmienily sie od zalozenia zamowienia
--      (inaczej `billing_plane_unknown`). Zrodla szkicu sa sprawdzane NA NOWO
--      przy wystawieniu (`source_changed`), a proforma -> faktura bierze
--      zamowienia w biezacym stanie. Kupujacy widzi blok prosby o fakture
--      tylko wtedy, gdy organizator fakturuje i moze te platnosc zafakturowac
--      (`event_invoice_public_options`); baza pilnuje tego samego w prosbie.
--   2) VAT NA POZYCJI. Stawki '23','8','5','0','zw','np'; domyslna z ustawien
--      wystawcy (`default_vat_rate`, domyslnie '23'), zmienialna na szkicu.
--      Zaplacona kwota jest BRUTTO: pozycja = ilosc x cena brutto, netto =
--      zaokraglenie polowkowe od zera (brutto * 100 / (100 + stawka)) liczone
--      NA POZYCJI (grosze, arytmetyka calkowita), VAT = brutto - netto. Sumy
--      liczy baza (`_event_invoice_recalc`), a `src/lib/events/
--      eventInvoiceMath.ts` jest lustrem do podgladu - te same wektory
--      sprawdzaja vitest i harness. 'zw' wymaga podstawy zwolnienia
--      (`vat_exempt_basis`) drukowanej na dokumencie. Kwota zamowienia, ktora
--      nie dzieli sie rowno na miejsca, trafia na DWIE pozycje (n-r po u oraz
--      r po u+1 grosza), zeby cena jednostkowa razy ilosc zawsze dawala
--      wartosc pozycji.
--   3) RODZAJE: faktura (`invoice`), proforma (`proforma`) i korekta
--      (`correction`, tylko do wystawionej faktury; pelne odwrocenie albo
--      zmiana wybranych pozycji zapisana jako para "przed/po"). Ujemne ilosci
--      wolno podac WYLACZNIE na korekcie. Numeracja per najemca + seria +
--      miesiac, bez luk, nadawana WYLACZNIE przy wystawieniu pod blokada
--      wiersza licznika (`event_invoice_counters`), prefiksy serii ustawialne
--      (domyslnie FV, PRO, KOR), format `<PREFIKS>/<RRRR>/<MM>/<NNNN>`. Data
--      wystawienia to dzien wystawienia w strefie Europe/Warsaw - szkic nie
--      ma daty wystawienia, wiec numery w serii ida chronologicznie.
--      Wystawiony dokument jest NIEZMIENNY (trigger): wolno zmienic tylko
--      pola `ksef_*`, `paid_at`, przejscie `issued -> cancelled` (z powodem)
--      oraz wyzerowac klucze obce przy usunieciu wskazywanego wiersza.
--      Anulowac wolno szkic, proforme i fakture/korekte, ktorej nie wyslano
--      do KSeF (`sent`/`accepted` = juz tylko korekta); korekte - tylko
--      ostatnio wystawiona. KOREKTA LICZY SIE OD STANU PO WCZESNIEJSZYCH
--      KOREKTACH (`_event_invoice_state`), a wystawienie pilnuje, zeby stan
--      byl czysty: pelna korekta zeruje fakture, czesciowa jej nie zeruje.
--      Bilet z cena netto (`tax_mode = 'exclusive'`) ma brutto = netto + VAT.
--      Faktura zbiorcza nie laczy prosb roznych nabywcow (`buyer_mismatch`).
--   4) KSeF: pola stanu (`not_applicable|pending|sent|accepted|rejected`),
--      reczny numer KSeF i filtr "do wyslania". Faktura i korekta sprzedawcy
--      z Polski dostaja `pending` przy wystawieniu, proforma
--      `not_applicable`. Klienta API KSeF w tej wersji NIE MA (szew:
--      `admin_event_invoice_ksef_update`) - to jest nastepny krok.
--   5) JEDNO ZAMOWIENIE/ZAPIS = NAJWYZEJ JEDNA AKTYWNA FAKTURA. Wymusza to
--      czesciowy unikalny indeks na `event_invoice_sources` (`covers AND
--      released_at IS NULL`) - takze pod wyscigiem dwoch administratorow.
--      Proforma nie blokuje (covers = false). Anulowanie albo pelna korekta
--      zwalnia zrodla (`released_at`), wiec zamowienie mozna zafakturowac
--      ponownie (np. z poprawionymi danymi nabywcy).
--   6) DANE NABYWCY zbierane przy zakupie (krok platnosci zapisu, zakup
--      pakietu) i pozniej z profilu - do KONCA TRZECIEGO MIESIACA po miesiacu
--      zaplaty (`request_window_closed`); przed zaplata bez ograniczenia.
--      Kupujacy zapisu (`_event_invoice_registration_owner`, na bazie
--      `_event_registration_actor` z 20260926153100): zamowienie z KARTY -
--      wylacznie platnik (po przekazaniu biletu nowy posiadacz nie prosi
--      o fakture za cudza wplate); bez niego - osoba zapisu przypieta do
--      konta albo SAMODZIELNY zapis zalozony z konta - nigdy zapis wpisany
--      przez pracownika organizatora; prosbe innego konta zmienia tylko jej
--      autor.
--   7) ZAPIS JAKO ZRODLO po funkcjach #403/#405/#406/#407 - jedna regula
--      (`_event_invoice_registration_source`) dla szkicu, wystawienia,
--      kandydatow, profilu i masowego wystawienia:
--      * miejsce pokryte biletem z puli planu (`plan_ticket_claims`,
--        20260926180000) bez zamowienia nie jest sprzedaza - odpada z kwoty,
--        a zapis bez innych miejsc nie jest zrodlem (`source_plan_ticket`);
--      * zamowienie z karty: miejsca z `metadata.quantity`, miejsce
--        prowadzacego z benefitem planu i miejsca gosci osobnymi pozycjami
--        (`lead_unit_cents`/`guest_unit_cents`, bez pozycji za 0 zl);
--      * gosc z WLASNYM zamowieniem z karty jest osobnym zrodlem;
--      * zapis bez karty: cena z FAZY SPRZEDAZY (early bird, progi) - dla
--        oplaconego z chwili zaplaty (kodow rabatowych SQL nie liczy);
--      * wplata bez miejsca (kolejka, czeka na decyzje) nie idzie do
--        masowego wystawienia - tylko swiadomie ze szkicu, z plakietka;
--      * wystawiona faktura, za ktora sprzedaz skurczyla sie po wystawieniu
--        (zwrot, odwolanie, mniej miejsc), dostaje podpowiedz korekty
--        (`_event_invoice_correction_hint`) - korekty nic nie wystawia samo.
--
-- DLACZEGO OSOBNA TABELA ZRODEL (`event_invoice_sources`)
--   Faktura zbiorcza z pozycjami zagregowanymi "po rodzaju biletu" ma JEDNA
--   pozycje za wiele zapisow - pozycja nie moze wiec nosic klucza zapisu, na
--   ktorym stoi regula "jedna aktywna faktura". Zrodla (zapis prowadzacego
--   grupy albo zamowienie pakietu) sa osobno i to na nich stoi indeks;
--   pozycje sa tym, co drukujemy.
--
-- CRM (most z 20260926090000 i kartoteka firm)
--   Przy WYSTAWIENIU (decyzja administratora, nigdy przy samej prosbie
--   kupujacego): firma nabywcy po znormalizowanym NIP-ie (najstarsze
--   trafienie), inaczej `crm_ensure_member_company` po nazwie; uzupelniane
--   sa WYLACZNIE puste pola (tax_id, address, postal_code, city, country,
--   email), nic nie jest nadpisywane; `crm_company_id` na fakturze i prosbie,
--   `event_package_orders.company_id` tylko gdy puste; wpis osi czasu firmy
--   `audit_log` (entity `crm_company`, akcja `event.invoice.*`, metadane wg
--   kontraktu `src/lib/crm/eventActivity.ts` + numer, brutto, waluta). Osoba
--   kupujaca (wiersz `event_people`) przez `_event_person_crm_sync`
--   z segmentem `event_participant`, etykieta `event:<slug>:invoice`, tagiem
--   `event:<slug>` - bez zadnego zrodla zgody marketingowej. Awaria CRM nigdy
--   nie wywraca wystawienia (wewnetrzny blok EXCEPTION).
--
-- ZDARZENIA DOMENOWE: `event_invoice.issued.v1`, `event_invoice.cancelled.v1`
--   (ladunek: identyfikatory + `event_id`, bez danych nabywcy).
--
-- PLASZCZYZNY
--   Panel: `admin_event_invoice_*` z `assert_event_admin_tenant()` (admin
--   albo super_admin, nigdy redaktor). Kupujacy: `event_invoice_request_*`
--   i `event_my_invoice*` z `public_tenant_id()` + `auth.uid()`, wlasnosc
--   zapisu/zamowienia sprawdzana w SQL, bez `has_role` w tym samym ciele.
--   Tabele: RLS wlaczony, wylacznie polityki ODCZYTU dla admina/super_admina
--   najemcy; kazdy zapis przez SECURITY DEFINER.
--
-- DOWOD KSIEGOWY
--   `event_invoices.tenant_id` ON DELETE RESTRICT (usuniecie najemcy z
--   wystawionymi dokumentami musi byc swiadoma operacja), wydarzenie, firma
--   CRM, osoba i konta uzytkownikow ON DELETE SET NULL - dokument zostaje
--   z migawka sprzedawcy, nabywcy i tytulu wydarzenia.
--
-- POZA ZAKRESEM (nastepne kroki): wysylka do API KSeF, JPK, automatyczne
--   wystawienie po platnosci karta, mapowanie Stripe Tax, przeliczenie VAT
--   faktury w EUR na PLN po kursie NBP (art. 31a) - faktura w EUR drukuje
--   sumy w EUR.
--
-- IDEMPOTENCJA
--   CREATE TABLE IF NOT EXISTS (ograniczenia w definicji tabeli), CREATE
--   [UNIQUE] INDEX IF NOT EXISTS, DROP ... IF EXISTS + CREATE dla triggerow
--   i polityk, CREATE OR REPLACE FUNCTION (wszystkie funkcje sa nowe).
--
-- Testy: scripts/events-harness/runtime_test.d/27_invoices.sql,
--   src/lib/events/__tests__/eventInvoice*.test.ts.
-- ============================================================================

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

-- migration-split: part 1/5 of 20260927000200_event_invoices.sql
-- CIAG DALSZY: 20260927000201_event_invoices_part2.sql .. 20260927000204_event_invoices_part5.sql
-- (scripts/split-migration.ts, limit wdrozenia Lovable). SQL wykonywalny
-- czesci 1..5 sklejonych po kolei == SQL tej migracji sprzed podzialu.
-- events-harness: include
