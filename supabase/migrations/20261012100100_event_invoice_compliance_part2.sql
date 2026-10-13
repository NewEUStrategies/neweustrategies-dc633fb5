-- CZESC 2/7 MIGRACJI 20261012100000_event_invoice_compliance.sql
-- events-harness: include
--
-- Plaszczyzna rozliczen ze stempla zamowienia (INV-09), VAT od sumy w stawce
-- (INV-16), zaksiegowana wplata jako kwota zrodla (INV-14), podstawa "np"
-- w ustawieniach (INV-12) i dokument z kursem, numerem KSeF faktury
-- korygowanej i zamrozonym podsumowaniem stawek (INV-06, INV-17).
-- Kazda funkcja jest przedeklarowana W CALOSCI (wygrywa ostatnia definicja);
-- zmiany wzgledem 20260927000200 oznacza `-- ZMIANA (INV-xx)`.

-- ----------------------------------------------------------------------------
-- INV-09. Czy organizator moze wystawic WLASNA fakture za zamowienie z karty.
-- Zamowienie ze stemplem (`payment_orders.billing_plane`, czesc 1) mowi samo,
-- na jakiej plaszczyznie je sprzedano - zmiana ustawien kasy PO zamowieniu
-- (np. przelaczenie kodow promocyjnych) nic juz nie zmienia. Zamowienie sprzed
-- stempla (NULL) zostaje przy regule zachowawczej z 20260927000201.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_invoice_card_block(p_tenant uuid, p_order uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    -- ZMIANA (INV-09): stempel z chwili zamowienia rozstrzyga.
    WHEN o.billing_plane = 'managed' THEN 'mor_seller_conflict'
    WHEN o.billing_plane = 'merchant' AND o.operator_invoice THEN 'operator_invoice_enabled'
    WHEN o.billing_plane = 'merchant' THEN NULL
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
  'NULL = organizator moze zafakturowac zamowienie z karty; plaszczyzna ze stempla zamowienia (billing_plane/operator_invoice), dla zamowien sprzed stempla regula zachowawcza (mor_seller_conflict, operator_invoice_enabled, billing_plane_unknown).';

-- ----------------------------------------------------------------------------
-- INV-16. PODSUMOWANIE STAWEK OD SUMY W STAWCE.
--
-- Cena biletu jest BRUTTO, wiec dokument liczy podatek metoda "od brutto"
-- (art. 106e ust. 7 i 8 ustawy o VAT): w kazdej stawce netto = zaokraglenie
-- polowkowe od zera z SUMY wartosci brutto * 100 / (100 + stawka), VAT =
-- brutto - netto. Suma VAT liczonych na pozycjach rozjezdzala sie z tym
-- o grosze na fakturze z wieloma pozycjami w jednej stawce. Pozycje
-- zachowuja swoje netto (podstawa liczenia stanu po korektach,
-- `_event_invoice_state`), ale drukowane sa w brutto (ust. 7), a o kwocie
-- podatku decyduje podsumowanie.
--
-- KOREKTA pokazuje ROZNICE stanu w stawce: netto(po) - netto(przed), gdzie
-- "przed" = faktura + wystawione korekty, "po" = to samo + ta korekta. Suma
-- faktury i jej korekt w kazdej stawce daje wiec dokladnie podatek stanu
-- koncowego, bez dryfu groszy miedzy korektami.
--
-- VAT w PLN (INV-06): z kursem `p_fx` kazdy wiersz dostaje `vat_pln_cents`
-- (korekta: VAT_PLN(po) - VAT_PLN(przed) po kursie faktury korygowanej).
-- Lustro: `vatSummary` / `correctionVatSummary` w eventInvoiceMath.ts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_invoice_rate_gross(p_tenant uuid, p_target uuid, p_draft uuid)
RETURNS TABLE(vat_rate text, gross_cents bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT l.vat_rate, sum(l.gross_cents)::bigint
    FROM public.event_invoice_lines l
    JOIN public.event_invoices d ON d.id = l.invoice_id AND d.tenant_id = l.tenant_id
   WHERE l.tenant_id = p_tenant
     AND (d.id = p_target
          OR (d.corrects_invoice_id = p_target AND (d.status = 'issued' OR d.id = p_draft)))
   GROUP BY l.vat_rate;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_rate_gross(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_rate_gross(uuid, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_rate_gross(uuid, uuid, uuid) IS
  'Suma brutto w stawce dla stanu faktury: jej pozycje + wystawione korekty (+ wskazany szkic korekty).';

CREATE OR REPLACE FUNCTION public._event_invoice_vat_summary(p_tenant uuid, p_invoice uuid, p_fx numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i WHERE i.id = p_invoice AND i.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;
  WITH own AS (
    SELECT l.vat_rate, sum(l.gross_cents)::bigint AS gross
      FROM public.event_invoice_lines l
     WHERE l.invoice_id = p_invoice AND l.tenant_id = p_tenant
     GROUP BY l.vat_rate
  ),
  before AS (
    SELECT b.vat_rate, b.gross_cents AS gross
      FROM public._event_invoice_rate_gross(p_tenant, v_inv.corrects_invoice_id, NULL) AS b
     WHERE v_inv.kind = 'correction'
  ),
  -- Dla faktury i proformy "przed" jest puste, a "po" = wlasne pozycje.
  pairs AS (
    SELECT o.vat_rate,
           COALESCE(b.gross, 0) AS gross_before,
           COALESCE(b.gross, 0) + o.gross AS gross_after
      FROM own o
      LEFT JOIN before b ON b.vat_rate = o.vat_rate
  ),
  nets AS (
    SELECT p.vat_rate, p.gross_before, p.gross_after,
           public._event_invoice_net_from_gross(p.gross_before, p.vat_rate) AS net_before,
           public._event_invoice_net_from_gross(p.gross_after, p.vat_rate) AS net_after
      FROM pairs p
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'vat_rate', n.vat_rate,
             'net_cents', n.net_after - n.net_before,
             'vat_cents', (n.gross_after - n.net_after) - (n.gross_before - n.net_before),
             'gross_cents', n.gross_after - n.gross_before
           ) || CASE WHEN p_fx IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
             'vat_pln_cents',
             public._event_invoice_pln(n.gross_after - n.net_after, p_fx)
               - public._event_invoice_pln(n.gross_before - n.net_before, p_fx)
           ) END
           ORDER BY array_position(ARRAY['23', '8', '5', '0', 'zw', 'np'], n.vat_rate)
         ), '[]'::jsonb)
    INTO v_rows
    FROM nets n;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_vat_summary(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_vat_summary(uuid, uuid, numeric) TO service_role;
COMMENT ON FUNCTION public._event_invoice_vat_summary(uuid, uuid, numeric) IS
  'Podsumowanie stawek od SUMY brutto w stawce (art. 106e ust. 7-8); korekta = roznica stanu po i przed; z kursem - VAT w PLN.';

-- Sumy dokumentu = suma podsumowania stawek (autorytet; lustro invoiceTotals w TS).
CREATE OR REPLACE FUNCTION public._event_invoice_recalc(p_tenant uuid, p_invoice uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- ZMIANA (INV-16): podsumowanie od sumy w stawce, zamrazane na dokumencie.
  v_summary jsonb := public._event_invoice_vat_summary(p_tenant, p_invoice, NULL);
BEGIN
  UPDATE public.event_invoices i
     SET vat_summary = v_summary,
         net_cents = t.net, vat_cents = t.vat, gross_cents = t.gross
    FROM (
      SELECT COALESCE(sum((x.value->>'net_cents')::bigint), 0)::bigint AS net,
             COALESCE(sum((x.value->>'vat_cents')::bigint), 0)::bigint AS vat,
             COALESCE(sum((x.value->>'gross_cents')::bigint), 0)::bigint AS gross
        FROM jsonb_array_elements(v_summary) AS x
    ) AS t
   WHERE i.id = p_invoice AND i.tenant_id = p_tenant AND i.status = 'draft';
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_recalc(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_recalc(uuid, uuid) TO service_role;

-- Szkice sprzed tej migracji dostaja podsumowanie od sumy (szkic jest
-- zmienny; wystawionych dokumentow NIE przeliczamy - drukuja sie po staremu).
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN SELECT i.tenant_id, i.id FROM public.event_invoices i WHERE i.status = 'draft' LOOP
    PERFORM public._event_invoice_recalc(v.tenant_id, v.id);
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- INV-12. Ustawienia wystawcy z podstawa "np".
-- ----------------------------------------------------------------------------
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
    s.vat_np_basis := '';
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
    -- ZMIANA (INV-12): podstawa prawna stawki "np".
    'vat_np_basis', s.vat_np_basis,
    'footer_note', s.footer_note,
    'default_locale', s.default_locale,
    'updated_at', s.updated_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_settings_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_settings_json(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._event_invoice_seller_json(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public._event_invoice_settings_json(p_tenant)
    - 'enabled' - 'confirmed_at' - 'series_invoice' - 'series_proforma' - 'series_correction'
    - 'default_vat_rate' - 'default_locale' - 'updated_at' - 'payment_days' - 'vat_exempt_basis'
    - 'vat_np_basis';
$$;
REVOKE ALL ON FUNCTION public._event_invoice_seller_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_seller_json(uuid) TO service_role;

-- Odwrotne obciazenie "automatycznie" (szkic bez jawnej decyzji): pozycja "np"
-- i nabywca-firma spoza Polski - typowy przypadek uslugi online dla firmy
-- (art. 28b). Organizator moze to nadpisac na szkicu (`reverse_charge`).
CREATE OR REPLACE FUNCTION public._event_invoice_reverse_charge(p_tenant uuid, p_invoice uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    i.reverse_charge,
    i.buyer_is_company AND i.buyer_country <> 'PL' AND EXISTS (
      SELECT 1 FROM public.event_invoice_lines l
       WHERE l.invoice_id = i.id AND l.tenant_id = i.tenant_id AND l.vat_rate = 'np'
    )
  )
    FROM public.event_invoices i
   WHERE i.id = p_invoice AND i.tenant_id = p_tenant;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_reverse_charge(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_reverse_charge(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_reverse_charge(uuid, uuid) IS
  'Czy dokument niesie adnotacje "odwrotne obciazenie": jawna decyzja ze szkicu albo pozycja np + nabywca-firma spoza PL.';

-- ----------------------------------------------------------------------------
-- DOKUMENT (podglad, PDF, szczegoly). ZMIANY: podsumowanie stawek zamrozone
-- na dokumencie (INV-16; dokumenty sprzed migracji - suma pozycji jak
-- dotad), numer KSeF i kurs faktury korygowanej (INV-17, INV-06), na
-- szkicu skuteczna podstawa "np" i odwrotne obciazenie (INV-12) - to samo,
-- co wystawienie zapisze, zeby podglad PDF nie klamal.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_invoice_document(p_tenant uuid, p_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.event_invoices;
  v_row jsonb;
  v_target_np_basis text;
  v_target_rc boolean;
BEGIN
  SELECT * INTO v_inv FROM public.event_invoices i WHERE i.id = p_invoice AND i.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_row := to_jsonb(v_inv) - 'seller' - 'tenant_id' - 'created_by' - 'issued_by' - 'cancelled_by'
           - 'vat_summary';
  -- ZMIANA (INV-12): skutek dla dokumentu - na szkicu to, co zapisze
  -- wystawienie (`_event_invoice_issue_core`: decyzja szkicu, przy korekcie
  -- bez decyzji - decyzja faktury korygowanej, inaczej regula automatyczna;
  -- podstawa szkicu > faktury korygowanej > ustawien wystawcy), na
  -- wystawionym - to, co zapisano. Podstawa szkicu jest podana takze bez
  -- pozycji "np": edytor pokazuje ja w chwili zmiany stawki, zanim pozycja
  -- trafi do bazy (PDF drukuje ja tylko przy pozycji "np"). Pola `np_basis`
  -- i `reverse_charge` zostaja surowe (edytor szkicu zapisuje tylko decyzje).
  IF v_inv.status = 'draft' AND v_inv.corrects_invoice_id IS NOT NULL THEN
    SELECT t.np_basis, t.reverse_charge INTO v_target_np_basis, v_target_rc
      FROM public.event_invoices t
     WHERE t.id = v_inv.corrects_invoice_id AND t.tenant_id = p_tenant;
  END IF;
  v_row := v_row || jsonb_build_object(
    'reverse_charge_effective', CASE
      WHEN v_inv.status <> 'draft' THEN COALESCE(v_inv.reverse_charge, false)
      WHEN v_inv.kind = 'correction' AND v_inv.reverse_charge IS NULL THEN COALESCE(v_target_rc, false)
      ELSE COALESCE(public._event_invoice_reverse_charge(p_tenant, p_invoice), false) END,
    'np_basis_effective', CASE
      WHEN v_inv.status <> 'draft' THEN v_inv.np_basis
      ELSE COALESCE(NULLIF(btrim(v_inv.np_basis), ''), NULLIF(btrim(v_target_np_basis), ''),
                    btrim((SELECT s.vat_np_basis FROM public.event_invoice_settings s
                            WHERE s.tenant_id = p_tenant)), '') END
  );
  RETURN jsonb_build_object(
    'invoice', v_row,
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
    -- ZMIANA (INV-16): zamrozone podsumowanie; NULL = dokument sprzed zmiany.
    'vat_summary', COALESCE(v_inv.vat_summary, (
      SELECT jsonb_agg(jsonb_build_object(
        'vat_rate', x.vat_rate, 'net_cents', x.net, 'vat_cents', x.vat, 'gross_cents', x.gross
      ) ORDER BY array_position(ARRAY['23', '8', '5', '0', 'zw', 'np'], x.vat_rate))
      FROM (
        SELECT l.vat_rate, sum(l.net_cents) AS net, sum(l.vat_cents) AS vat, sum(l.gross_cents) AS gross
          FROM public.event_invoice_lines l
         WHERE l.invoice_id = v_inv.id AND l.tenant_id = p_tenant
         GROUP BY l.vat_rate
      ) AS x
    ), '[]'::jsonb),
    'corrects', (
      SELECT jsonb_build_object('id', c.id, 'number', c.number, 'issue_date', c.issue_date,
                                'sale_date', c.sale_date,
                                -- ZMIANA (INV-17): numer KSeF faktury korygowanej.
                                'ksef_number', c.ksef_number, 'ksef_status', c.ksef_status)
        FROM public.event_invoices c
       WHERE c.id = v_inv.corrects_invoice_id AND c.tenant_id = p_tenant
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_document(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_document(uuid, uuid) TO service_role;

-- migration-split: part 2/7 of 20261012100000_event_invoice_compliance.sql
