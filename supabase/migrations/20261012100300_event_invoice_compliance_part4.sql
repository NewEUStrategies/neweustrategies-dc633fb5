-- CZESC 4/7 MIGRACJI 20261012100000_event_invoice_compliance.sql
-- events-harness: include
--
-- Plaszczyzna panelu: KSeF jednokierunkowy z dziennikiem i formatem numeru
-- (INV-02, INV-17), anulowanie zablokowane po doreczeniu (INV-08), potrzeby
-- kursowe szkicow (INV-06), weryfikacja VIES (INV-12), zaksiegowana wplata
-- (INV-14) i podstawa "np" w ustawieniach wystawcy (INV-12). Plaszczyzna
-- kupujacego: pobranie dokumentu stempluje doreczenie (INV-08).

-- ----------------------------------------------------------------------------
-- INV-02 / INV-17. STAN I NUMER KSeF.
-- Graf przejsc `_event_invoice_ksef_transition_ok` (accepted terminalne),
-- numer raz na zawsze, z formatem i unikalny w najemcy, kazda zmiana
-- w dzienniku `event_invoice_ksef_events` (trigger) z notatka z ladunku.
-- Trigger `_tg_event_invoices_guard` pilnuje tego samego - RPC daje jedynie
-- czytelne kody odmow zanim dojdzie do zapisu.
-- ----------------------------------------------------------------------------
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
  v_number text := NULLIF(upper(btrim(COALESCE(p_payload->>'number', ''))), '');
  v_note text := btrim(COALESCE(p_payload->>'note', ''));
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
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note: note has more than 500 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT public._event_invoice_ksef_transition_ok(v_inv.ksef_status, v_status) THEN
    RAISE EXCEPTION 'invalid_transition: KSeF status % cannot change to %', v_inv.ksef_status, v_status
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.ksef_number IS NOT NULL AND v_number IS DISTINCT FROM v_inv.ksef_number AND v_number IS NOT NULL THEN
    RAISE EXCEPTION 'ksef_number_immutable: the KSeF number of a document never changes'
      USING ERRCODE = '22023';
  END IF;
  -- Numer pominiety przy dokumencie, ktory go ma = bez zmian (nie "wyczysc").
  v_number := COALESCE(v_number, v_inv.ksef_number);
  IF v_number IS NOT NULL AND v_inv.ksef_number IS NULL AND v_status <> 'accepted' THEN
    RAISE EXCEPTION 'ksef_number_requires_accepted: KSeF assigns the number on acceptance'
      USING ERRCODE = '22023';
  END IF;
  IF v_status = 'accepted' AND v_number IS NULL THEN
    RAISE EXCEPTION 'ksef_number_required: an accepted document needs the KSeF number'
      USING ERRCODE = '22023';
  END IF;
  IF v_number IS DISTINCT FROM v_inv.ksef_number THEN
    IF NOT public._event_invoice_ksef_number_valid(v_number, v_inv.seller->>'seller_tax_id', v_inv.issue_date) THEN
      RAISE EXCEPTION 'invalid_ksef_number: KSeF number has the form NIP-YYYYMMDD-XXXXXXXXXXXX-XX'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_invoices i
                WHERE i.tenant_id = v_tenant AND i.ksef_number = v_number AND i.id <> v_inv.id) THEN
      RAISE EXCEPTION 'ksef_number_taken: another document already has this KSeF number'
        USING ERRCODE = '23505';
    END IF;
  END IF;
  IF v_status = v_inv.ksef_status AND v_number IS NOT DISTINCT FROM v_inv.ksef_number THEN
    -- Sama notatka (np. numer UPO po przyjeciu, uwaga przy odrzuceniu) to tez
    -- wpis dziennika: panel pozwala ja zapisac i zglasza sukces, wiec cicha
    -- utrata notatki bylaby falszywym potwierdzeniem. Stan bez zmian
    -- (from = to), autor jak w triggerze. Bez notatki - nic do zapisania.
    IF v_note <> '' THEN
      INSERT INTO public.event_invoice_ksef_events (
        tenant_id, invoice_id, from_status, to_status, from_number, to_number, actor_id, note
      ) VALUES (
        v_tenant, v_inv.id, v_inv.ksef_status, v_inv.ksef_status, v_inv.ksef_number,
        v_inv.ksef_number, auth.uid(), v_note
      );
    END IF;
    RETURN v_inv.id;
  END IF;
  PERFORM set_config('nes.event_invoice_ksef_note', v_note, true);
  UPDATE public.event_invoices i
     SET ksef_status = v_status, ksef_number = v_number, ksef_updated_at = now()
   WHERE i.id = v_inv.id AND i.tenant_id = v_tenant;
  PERFORM set_config('nes.event_invoice_ksef_note', '', true);
  RETURN v_inv.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_ksef_update(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_ksef_update(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_ksef_update(jsonb) IS
  'Stan i numer KSeF wystawionej faktury/korekty: przejscia jednokierunkowe (accepted terminalne), numer niezmienny, z formatem i unikalny w najemcy, wpis w dzienniku. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- INV-08. ANULOWANIE (cialo z 20260927000203 + blokada doreczenia).
-- Dokument, ktory nabywca dostal mailem albo pobral z profilu, jest w obrocie
-- prawnym - zostaje juz tylko korekta. Proforma nie jest fakturą VAT i dalej
-- daje sie anulowac.
-- ----------------------------------------------------------------------------
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
  -- ZMIANA (INV-08): doreczony dokument VAT = tylko korekta.
  IF v_inv.status = 'issued' AND v_inv.kind <> 'proforma'
     AND (v_inv.buyer_notified_at IS NOT NULL OR v_inv.buyer_downloaded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'delivered_locked: the buyer already received this document - issue a correction'
      USING ERRCODE = '22023';
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
  'Anulowanie szkicu, proformy albo dokumentu przed KSeF i przed doreczeniem nabywcy (z powodem); zwalnia zamowienia i przywraca prosby do oczekujacych. Bramka: assert_event_admin_tenant().';

-- Mail o wystawieniu poszedl (src/lib/events/eventInvoiceNotify.server.ts po
-- udanej wysylce albo wykrytym duplikacie juz wyslanego maila). Stempel raz.
CREATE OR REPLACE FUNCTION public.admin_event_invoice_mark_notified(p_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_at timestamptz;
BEGIN
  UPDATE public.event_invoices i
     SET buyer_notified_at = COALESCE(i.buyer_notified_at, now())
   WHERE i.id = p_id AND i.tenant_id = v_tenant AND i.status = 'issued'
  RETURNING i.buyer_notified_at INTO v_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: issued document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  RETURN v_at;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_mark_notified(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_mark_notified(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_mark_notified(uuid) IS
  'Stempel doreczenia mailem (raz) - od tej chwili dokument VAT mozna juz tylko skorygowac. Bramka: assert_event_admin_tenant().';

-- Pobranie przez kupujacego (cialo z 20260927000204 + stempel doreczenia).
-- VOLATILE: pierwsze pobranie pelnej migawki (PDF w profilu) jest doreczeniem.
CREATE OR REPLACE FUNCTION public.event_my_invoice(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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
  -- ZMIANA (INV-08): doreczenie przez pobranie.
  UPDATE public.event_invoices i
     SET buyer_downloaded_at = now()
   WHERE i.id = p_id AND i.tenant_id = v_tenant AND i.status = 'issued' AND i.buyer_downloaded_at IS NULL;
  v_doc := public._event_invoice_document(v_tenant, p_id);
  RETURN v_doc || jsonb_build_object(
    'invoice', (v_doc->'invoice') - 'crm_company_id' - 'buyer_person_id' - 'buyer_user_id'
      - 'buyer_notified_at' - 'buyer_downloaded_at'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_my_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_invoice(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.event_my_invoice(uuid) IS
  'Pelna migawka wlasnego wystawionego dokumentu (do PDF); pierwsze pobranie stempluje doreczenie. Plaszczyzna: public_tenant_id() + auth.uid().';

-- ----------------------------------------------------------------------------
-- INV-06. KURSY POTRZEBNE DO WYSTAWIENIA. Ta sama regula dnia co
-- `_event_invoice_issue_core`: szkice w walucie obcej (lista `invoice_ids`)
-- albo oczekujace prosby wydarzenia (`event_id` + `pending`, masowe
-- wystawienie: zaplacone zrodla, data sprzedazy = dzien zaplaty). Serwer
-- (eventInvoiceFx.server.ts) pobiera z NBP tylko brakujace dni.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_invoice_fx_needs(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_ids uuid[];
  v_event uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_out jsonb;
BEGIN
  IF jsonb_typeof(p_payload->'invoice_ids') = 'array' THEN
    SELECT array_agg(NULLIF(x.value, '')::uuid) INTO v_ids
      FROM jsonb_array_elements_text(p_payload->'invoice_ids') AS x;
  END IF;
  WITH drafts AS (
    SELECT i.currency,
           CASE WHEN i.kind = 'correction'
                THEN public._event_invoice_fx_basis(t.issue_date, t.sale_date, t.paid_at)
                ELSE public._event_invoice_fx_basis(v_today, COALESCE(i.sale_date, v_today), i.paid_at)
           END - 1 AS rate_date
      FROM public.event_invoices i
      LEFT JOIN public.event_invoices t ON t.id = i.corrects_invoice_id AND t.tenant_id = i.tenant_id
     WHERE i.tenant_id = v_tenant AND i.id = ANY (COALESCE(v_ids, '{}'))
       AND i.status = 'draft' AND i.kind <> 'proforma' AND i.currency <> 'PLN'
       AND NOT (i.kind = 'correction' AND t.fx_rate IS NOT NULL)
  ),
  pending AS (
    SELECT x.currency, public._event_invoice_fx_basis(v_today, x.paid_on, NULL) - 1 AS rate_date
      FROM (
        SELECT COALESCE(src->>'currency', o.currency) AS currency,
               COALESCE((NULLIF(src->>'paid_at', '')::timestamptz AT TIME ZONE 'Europe/Warsaw')::date,
                        (o.paid_at AT TIME ZONE 'Europe/Warsaw')::date) AS paid_on
          FROM public.event_invoice_requests q
          LEFT JOIN public.event_package_orders o ON o.id = q.package_order_id AND o.tenant_id = q.tenant_id
          LEFT JOIN LATERAL (
            SELECT public._event_invoice_registration_source(v_tenant, q.registration_id, '23') AS src
             WHERE q.registration_id IS NOT NULL
          ) AS r ON true
         WHERE v_event IS NOT NULL AND COALESCE((p_payload->>'pending')::boolean, false)
           AND q.tenant_id = v_tenant AND q.event_id = v_event AND q.status = 'pending'
      ) AS x
     WHERE x.currency IS NOT NULL AND x.currency <> 'PLN'
  ),
  needed AS (
    SELECT DISTINCT n.currency, n.rate_date FROM (SELECT * FROM drafts UNION ALL SELECT * FROM pending) AS n
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'currency', n.currency,
           'rate_date', to_char(n.rate_date, 'YYYY-MM-DD'),
           'loaded', EXISTS (SELECT 1 FROM public.nbp_exchange_rates r
                              WHERE r.currency = n.currency AND r.rate_date = n.rate_date)
         ) ORDER BY n.currency, n.rate_date), '[]'::jsonb)
    INTO v_out
    FROM needed n;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_fx_needs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_fx_needs(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_fx_needs(jsonb) IS
  'Dni kursu NBP (waluta, rate_date, czy pobrany) potrzebne do wystawienia wskazanych szkicow albo oczekujacych prosb wydarzenia. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- INV-12. WERYFIKACJA VIES. Panel prosi serwer o sprawdzenie numeru nabywcy
-- szkicu; serwer pyta VIES (eventInvoiceVies.server.ts) i zapisuje wynik
-- przez `_event_invoice_vies_record` (service_role) - panel nie moze sam
-- zadeklarowac "numer wazny". Wynik dotyczy podmiotu (kraj + numer), wiec
-- zmiana nabywcy na szkicu go uniewaznia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_invoice_vies_subject(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_inv public.event_invoices;
  v_subject text;
  v_seller text;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i WHERE i.id = p_id AND i.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: document does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'not_draft: only a draft can be edited' USING ERRCODE = '22023';
  END IF;
  IF NOT v_inv.buyer_is_company OR btrim(v_inv.buyer_tax_id) = ''
     OR NOT public._event_invoice_eu_country(v_inv.buyer_country) THEN
    RAISE EXCEPTION 'vies_not_applicable: VIES verifies the VAT number of an EU company buyer'
      USING ERRCODE = '22023';
  END IF;
  v_subject := public._event_invoice_vies_subject(v_inv.buyer_country, v_inv.buyer_tax_id);
  v_seller := public._event_invoice_tax_key(
    (SELECT s.seller_tax_id FROM public.event_invoice_settings s WHERE s.tenant_id = v_tenant));
  RETURN jsonb_build_object(
    'tenant_id', v_tenant,
    'invoice_id', v_inv.id,
    'subject', v_subject,
    'country_code', left(v_subject, 2),
    'vat_number', substr(v_subject, 3),
    'requester_country', CASE WHEN v_seller ~ '^[0-9]{10}$' THEN 'PL' END,
    'requester_number', CASE WHEN v_seller ~ '^[0-9]{10}$' THEN v_seller END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_invoice_vies_subject(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_invoice_vies_subject(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_invoice_vies_subject(uuid) IS
  'Podmiot zapytania VIES dla nabywcy szkicu (kod kraju VIES, numer, zapytujacy = NIP sprzedawcy). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public._event_invoice_vies_record(
  p_tenant uuid, p_invoice uuid, p_subject text, p_valid boolean, p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i
   WHERE i.id = p_invoice AND i.tenant_id = p_tenant AND i.status = 'draft'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: draft does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF p_subject IS DISTINCT FROM public._event_invoice_vies_subject(v_inv.buyer_country, v_inv.buyer_tax_id) THEN
    RAISE EXCEPTION 'vies_subject_changed: the buyer changed during the VIES check' USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_invoices i
     SET buyer_vies_subject = p_subject,
         buyer_vies_valid = COALESCE(p_valid, false),
         buyer_vies_request_id = NULLIF(left(btrim(COALESCE(p_request_id, '')), 64), ''),
         buyer_vies_checked_at = now()
   WHERE i.id = v_inv.id AND i.tenant_id = p_tenant;
  RETURN jsonb_build_object('subject', p_subject, 'valid', COALESCE(p_valid, false), 'checked_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_vies_record(uuid, uuid, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_vies_record(uuid, uuid, text, boolean, text) TO service_role;
COMMENT ON FUNCTION public._event_invoice_vies_record(uuid, uuid, text, boolean, text) IS
  'Wynik zapytania VIES dla nabywcy szkicu (tylko serwer, najemca z bramki panelu).';

-- ----------------------------------------------------------------------------
-- INV-14. WPLATA ZAKSIEGOWANA (przelew, gotowka). Kwota, ktora faktycznie
-- wplynela za zapis oplacony poza kasa - jedyna podstawa faktury takiego
-- zapisu. Zamowienie z karty ma kwote od operatora, gosc rozliczony przez
-- prowadzacego - na zapisie prowadzacego.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_registration_record_payment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_amount bigint;
  v_currency text := upper(btrim(COALESCE(p_payload->>'currency', '')));
  v_reg record;
BEGIN
  IF COALESCE(p_payload->>'amount_cents', '') !~ '^[0-9]{1,11}$' THEN
    RAISE EXCEPTION 'invalid_price: booked amount must be 0-1000000000.00' USING ERRCODE = '22023';
  END IF;
  v_amount := (p_payload->>'amount_cents')::bigint;
  SELECT r.id, r.group_lead_registration_id, r.payment_status, r.status,
         (o.id IS NOT NULL AND o.status::text IN ('paid', 'refunded')) AS via_card,
         COALESCE(t.currency, 'PLN') AS ticket_currency
    INTO v_reg
    FROM public.event_registrations r
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
    LEFT JOIN public.event_ticket_types t ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
   WHERE r.id = v_id AND r.tenant_id = v_tenant
   FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant' USING ERRCODE = '42501';
  END IF;
  IF v_reg.via_card THEN
    RAISE EXCEPTION 'payment_is_card: the card payment amount comes from the payment operator'
      USING ERRCODE = '22023';
  END IF;
  IF v_reg.group_lead_registration_id IS NOT NULL THEN
    RAISE EXCEPTION 'source_not_lead: invoice the group lead registration' USING ERRCODE = '22023';
  END IF;
  IF v_reg.payment_status NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'registration_not_paid: book the payment after marking the registration paid'
      USING ERRCODE = '22023';
  END IF;
  v_currency := COALESCE(NULLIF(v_currency, ''), v_reg.ticket_currency);
  IF v_currency NOT IN ('PLN', 'EUR') THEN
    RAISE EXCEPTION 'currency_mismatch: booked payment is in PLN or EUR' USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_registrations r
     SET paid_amount_cents = v_amount,
         paid_amount_currency = v_currency,
         paid_amount_recorded_at = now(),
         paid_amount_recorded_by = auth.uid()
   WHERE r.id = v_id AND r.tenant_id = v_tenant;
  RETURN jsonb_build_object('registration_id', v_id, 'amount_cents', v_amount, 'currency', v_currency);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_registration_record_payment(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_record_payment(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_registration_record_payment(jsonb) IS
  'Ksieguje kwote wplaty poza kasa (przelew, gotowka) na oplaconym zapisie prowadzacego - podstawa faktury. Bramka: assert_event_admin_tenant().';

-- migration-split: part 4/7 of 20261012100000_event_invoice_compliance.sql
