-- CZESC 2/5 MIGRACJI 20260927000200_event_invoices.sql
-- migration-split: part 2/5 of 20260927000200_event_invoices.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 20260927000200_event_invoices.sql,
-- potem 20260927000201_event_invoices_part2.sql .. 20260927000204_event_invoices_part5.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.
-- events-harness: include
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

-- ZAPIS JAKO ZRODLO DOKUMENTU - JEDNA regula dla szkicu, ponownego
-- sprawdzenia przy wystawieniu, kandydatow w studiu, profilu kupujacego
-- i masowego wystawienia z prosb. Do tej pory kazda z tych funkcji liczyla
-- miejsca i kwote sama i rozjechaly sie z kasa (#403/#405/#406/#407).
-- NIGDY nie rzuca: odmowe niesie `block` (NULL = mozna fakturowac), a
-- wolajacy decyduje, czy to blad (szkic), czy pominiety wiersz (listy).
-- NULL = brak zapisu w tym najemcy.
--   block 'not_lead'    - gosc grupy rozliczony zamowieniem prowadzacego
--                         (fakturuje sie zapis prowadzacego);
--   block 'closed'      - zapis odwolany, odrzucony, darmowy albo zwrocony;
--   block 'plan_ticket' - jedyne miejsce pokrywa bilet z puli planu
--                         czlonkowskiego (`plan_ticket_claims`, 20260926180000),
--                         bez zamowienia - nikt za nie nie zaplacil.
-- ZAMOWIENIE Z KARTY (zaplacone albo zwrocone): kwota = zamowienie minus
-- zwroty, miejsca = `metadata.quantity` (miejsca oplacone TYM zamowieniem,
-- checkout.functions.ts), a przy benefiencie planu (`plan_benefit`) miejsce
-- prowadzacego i miejsca gosci ida osobnymi grupami wg `lead_unit_cents`
-- i `guest_unit_cents` (minus kod na miejsce) - "200 zl za trzy miejsca" to
-- 2 x 100 zl, a nie 3 x 66,67 zl; miejsce za 0 zl (bilet z puli) nie ma
-- pozycji. Kwota zamowienia jest dzielona proporcjonalnie do tych cen, wiec
-- zwrot czesciowy albo podatek doliczony przez Stripe (bilet netto) nie
-- rozjezdza sumy. Gosc z WLASNYM zamowieniem z karty (inne niz zamowienie
-- prowadzacego) to osobne zrodlo z jednym miejscem.
-- BEZ ZAMOWIENIA Z KARTY (przelew, wplata reczna, zapis nieoplacony - proforma):
-- cena z FAZY SPRZEDAZY (`_event_ticket_phase`) - nieoplacony: z tej chwili,
-- oplacony: z chwili zaplaty - razy miejsca prowadzacego i jego gosci bez
-- wlasnego zamowienia; miejsce prowadzacego pokryte aktywnym biletem z puli
-- planu odpada. Kodow rabatowych i znizki czlonkowskiej SQL tu nie liczy
-- (to reguly kasy w TS) - panel oznacza taka kwote jako "z cennika".
-- Bilet z cena netto (`tax_mode = 'exclusive'`) ma brutto = netto + VAT wg
-- stawki dokumentu. `admission`: czy oplacony zapis ma miejsce (ta sama
-- klasyfikacja co src/lib/events/paidAdmission.ts).
CREATE OR REPLACE FUNCTION public._event_invoice_registration_source(
  p_tenant uuid, p_registration_id uuid, p_rate text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
  v_lead_order uuid;
  v_block text;
  v_guests integer := 0;
  v_seats integer;
  v_gross bigint;
  v_unit bigint;
  v_units jsonb;
  v_coupon bigint := 0;
  v_lead_w bigint := 0;
  v_guest_w bigint := 0;
  v_total_w bigint := 0;
  v_lead_part bigint;
BEGIN
  SELECT r.id, r.event_id, r.person_id, r.group_lead_registration_id, r.status, r.payment_status,
         r.payment_order_id, r.ticket_type_id,
         COALESCE(r.paid_at, o.paid_at) AS paid_at,
         p.user_id AS holder_user_id, o.user_id AS payer_user_id,
         COALESCE(t.name_pl, '') AS name_pl, COALESCE(t.name_en, '') AS name_en,
         COALESCE(o.currency, t.currency, 'PLN') AS currency,
         (o.id IS NOT NULL AND o.status::text IN ('paid', 'refunded')) AS via_card,
         (o.amount_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS order_gross,
         COALESCE(o.metadata, '{}'::jsonb) AS meta,
         t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule,
         COALESCE(t.tax_mode, 'inclusive') AS tax_mode
    INTO v
    FROM public.event_registrations r
    JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    LEFT JOIN public.event_ticket_types t ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
   WHERE r.id = p_registration_id AND r.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v.group_lead_registration_id IS NOT NULL THEN
    SELECT l.payment_order_id INTO v_lead_order
      FROM public.event_registrations l
     WHERE l.id = v.group_lead_registration_id AND l.tenant_id = p_tenant;
    IF NOT (v.via_card AND v.payment_order_id IS DISTINCT FROM v_lead_order) THEN
      v_block := 'not_lead';
    END IF;
  ELSE
    -- Goscie rozliczani przez prowadzacego: bez wlasnego zamowienia z karty
    -- (gosc z wlasnym zamowieniem to osobne zrodlo), otwarci, nie zwroceni.
    SELECT count(*)::integer INTO v_guests
      FROM public.event_registrations g
      LEFT JOIN public.payment_orders go ON go.id = g.payment_order_id AND go.tenant_id = g.tenant_id
     WHERE g.group_lead_registration_id = v.id AND g.tenant_id = p_tenant
       AND g.status NOT IN ('cancelled', 'rejected')
       AND g.payment_status IN ('paid', 'partially_refunded', 'unpaid')
       AND NOT (go.id IS NOT NULL AND go.status::text IN ('paid', 'refunded')
                AND g.payment_order_id IS DISTINCT FROM v.payment_order_id);
  END IF;
  IF v_block IS NULL
     AND (v.status IN ('cancelled', 'rejected')
          OR v.payment_status NOT IN ('paid', 'partially_refunded', 'unpaid')) THEN
    v_block := 'closed';
  END IF;

  IF v.via_card AND v.order_gross IS NOT NULL THEN
    v_gross := v.order_gross;
    v_seats := CASE
      WHEN COALESCE(v.meta->>'quantity', '') ~ '^[0-9]{1,5}$' AND (v.meta->>'quantity')::integer >= 1
        THEN (v.meta->>'quantity')::integer
      ELSE 1 + v_guests
    END;
    IF v.meta->>'plan_benefit' IN ('included', 'discount')
       AND COALESCE(v.meta->>'lead_unit_cents', '') ~ '^[0-9]{1,9}$'
       AND COALESCE(v.meta->>'guest_unit_cents', '') ~ '^[0-9]{1,9}$' THEN
      IF COALESCE(v.meta->>'coupon_discount_per_seat_cents', '') ~ '^[0-9]{1,9}$' THEN
        v_coupon := (v.meta->>'coupon_discount_per_seat_cents')::bigint;
      END IF;
      v_lead_w := greatest((v.meta->>'lead_unit_cents')::bigint - v_coupon, 0);
      v_guest_w := greatest((v.meta->>'guest_unit_cents')::bigint - v_coupon, 0);
      v_total_w := v_lead_w + v_guest_w * (v_seats - 1);
    END IF;
    IF v_total_w > 0 AND v_gross > 0 THEN
      -- Czesc prowadzacego: zaokraglenie polowkowe, reszta to goscie.
      v_lead_part := (2 * v_gross * v_lead_w + v_total_w) / (2 * v_total_w);
      v_units := '[]'::jsonb;
      IF v_lead_part > 0 THEN
        v_units := v_units || jsonb_build_array(jsonb_build_object('qty', 1, 'gross', v_lead_part));
      END IF;
      IF v_seats > 1 AND v_gross - v_lead_part > 0 THEN
        v_units := v_units || jsonb_build_array(jsonb_build_object('qty', v_seats - 1, 'gross', v_gross - v_lead_part));
      END IF;
    ELSE
      v_units := jsonb_build_array(jsonb_build_object('qty', v_seats, 'gross', v_gross));
    END IF;
  ELSE
    v_seats := 1 + v_guests - CASE
      WHEN v.group_lead_registration_id IS NULL AND EXISTS (
        SELECT 1 FROM public.plan_ticket_claims c
         WHERE c.tenant_id = p_tenant AND c.registration_id = v.id AND c.released_at IS NULL
      ) THEN 1 ELSE 0 END;
    IF v_block IS NULL AND v_seats < 1 THEN
      v_block := 'plan_ticket';
    END IF;
    v_unit := COALESCE(CASE
      WHEN v.payment_status = 'unpaid'
        THEN public._event_ticket_price_now(v.price_cents, v.early_bird_price_cents, v.early_bird_until,
                                            v.price_schedule)
      ELSE (public._event_ticket_phase(v.price_cents, v.early_bird_price_cents, v.early_bird_until,
                                       v.price_schedule, COALESCE(v.paid_at, now()))->>'price_cents')::integer
    END, 0)::bigint;
    IF v.tax_mode = 'exclusive' THEN
      v_unit := public._event_invoice_gross_from_net(v_unit, p_rate);
    END IF;
    v_gross := v_unit * greatest(v_seats, 0);
    v_units := jsonb_build_array(jsonb_build_object('qty', greatest(v_seats, 0), 'gross', v_gross));
  END IF;

  RETURN jsonb_build_object(
    'id', v.id,
    'event_id', v.event_id,
    'person_id', v.person_id,
    'lead_id', v.group_lead_registration_id,
    'status', v.status,
    'payment_status', v.payment_status,
    'block', v_block,
    'admission', CASE
      WHEN v.status = 'waitlist' THEN 'waitlisted'
      WHEN v.status IN ('draft', 'pending') THEN 'awaitingDecision'
      ELSE 'seated'
    END,
    -- Kupujacy zamowienia z karty to PLATNIK (po przekazaniu biletu osoba
    -- zapisu jest kim innym), bez zamowienia - osoba zapisu.
    'user_id', CASE WHEN v.via_card THEN v.payer_user_id ELSE v.holder_user_id END,
    'via_card', v.via_card,
    'payment_order_id', CASE WHEN v.via_card THEN v.payment_order_id END,
    'ticket_type_id', v.ticket_type_id,
    'name_pl', v.name_pl,
    'name_en', v.name_en,
    'currency', v.currency,
    'paid', v.payment_status IN ('paid', 'partially_refunded'),
    'paid_at', v.paid_at,
    'seats', v_seats,
    'gross', v_gross,
    'units', v_units,
    'basis', CASE
      WHEN v.via_card AND v.order_gross IS NOT NULL THEN 'order'
      WHEN v.tax_mode = 'exclusive' THEN 'price_list_net'
      ELSE 'price_list'
    END
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) TO service_role;
COMMENT ON FUNCTION public._event_invoice_registration_source(uuid, uuid, text) IS
  'Zapis jako zrodlo dokumentu (bez wyjatkow): block (not_lead, closed, plan_ticket albo NULL), miejsca, kwota i grupy pozycji (zamowienie z karty wg metadata.quantity i benefitu planu, inaczej cena fazy sprzedazy), karta, platnik, admission.';

-- Czy konto moze prosic o fakture do zapisu (plaszczyzna kupujacego). Kim
-- jest wolajacy wobec zapisu, mowi `_event_registration_actor`
-- (20260926153100 - ta sama definicja co przekazanie i zwrot biletu):
--   * zapis oplacony zamowieniem z KARTY - wylacznie PLATNIK. Po przekazaniu
--     biletu (tor B przepina osobe zapisu) nowy posiadacz nie prosi o fakture
--     za cudza wplate i nie nadpisuje danych firmy platnika;
--   * bez zamowienia z karty (nieoplacony, przelew, wplata reczna) - osoba
--     zapisu przypieta do konta albo zalozyciel SAMODZIELNEGO zapisu
--     (`source = 'self_registration'`). Zapis wpisany przez organizatora
--     stempluje created_by kontem PRACOWNIKA - to nie jest jego zamowienie.
CREATE OR REPLACE FUNCTION public._event_invoice_registration_owner(
  p_tenant uuid, p_registration_id uuid, p_uid uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor jsonb;
  v_card boolean;
BEGIN
  IF p_uid IS NULL THEN
    RETURN false;
  END IF;
  v_actor := public._event_registration_actor(p_tenant, p_registration_id, p_uid, NULL);
  IF NOT COALESCE((v_actor->>'exists')::boolean, false) THEN
    RETURN false;
  END IF;
  SELECT o.status::text IN ('paid', 'refunded') INTO v_card
    FROM public.payment_orders o
   WHERE o.id = NULLIF(v_actor->>'payment_order_id', '')::uuid AND o.tenant_id = p_tenant;
  IF COALESCE(v_card, false) THEN
    RETURN (v_actor->>'is_payer')::boolean;
  END IF;
  RETURN (v_actor->>'is_holder')::boolean
      OR ((v_actor->>'is_registrant')::boolean AND v_actor->>'source' = 'self_registration');
END;
$$;
REVOKE ALL ON FUNCTION public._event_invoice_registration_owner(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invoice_registration_owner(uuid, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_invoice_registration_owner(uuid, uuid, uuid) IS
  'Czy konto jest kupujacym zapisu (wg _event_registration_actor): zamowienie z karty - platnik; bez niego - osoba zapisu albo zalozyciel samodzielnego zapisu (nigdy pracownik, ktory wpisal zapis).';

-- Zamowienie (zrodlo dokumentu) w stanie z TEJ chwili: kwota, zamowienie
-- z karty, zaplata, opis pozycji. Jedno zrodlo prawdy dla szkicu, dla
-- proformy -> faktury i dla ponownego sprawdzenia przy wystawieniu: szkic
-- albo proforma moga powstac PRZED zaplata karta (albo przed zwrotem), wiec
-- migawka zrodla z chwili szkicu nie wystarcza do decyzji o fakturze.
-- Zapis liczy `_event_invoice_registration_source` (ta sama regula co listy),
-- a odmowa staje sie tu bledem: gosc grupy (`source_not_lead`), zapis
-- zamkniety (`source_not_invoiceable`), miejsce z puli planu
-- (`source_plan_ticket`). `units` to grupy miejsc do pozycji dokumentu.
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
  v_reg jsonb;
  v_en boolean := p_locale = 'en';
BEGIN
  SELECT e.title_pl, e.title_en INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id AND e.tenant_id = p_tenant;
  IF p_kind = 'registration' THEN
    v_reg := public._event_invoice_registration_source(p_tenant, p_id, p_rate);
    IF v_reg IS NULL OR v_reg->>'event_id' IS DISTINCT FROM p_event_id::text THEN
      RAISE EXCEPTION 'source_not_found: registration is not part of this event' USING ERRCODE = '42501';
    END IF;
    IF v_reg->>'block' = 'not_lead' THEN
      RAISE EXCEPTION 'source_not_lead: invoice the group lead registration' USING ERRCODE = '22023';
    END IF;
    IF v_reg->>'block' = 'closed' THEN
      RAISE EXCEPTION 'source_not_invoiceable: registration is cancelled, free or refunded'
        USING ERRCODE = '22023';
    END IF;
    IF v_reg->>'block' = 'plan_ticket' THEN
      RAISE EXCEPTION 'source_plan_ticket: a membership plan ticket covers this seat - nothing was paid'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'kind', 'registration',
      'id', v_reg->'id',
      'person_id', v_reg->'person_id',
      'user_id', v_reg->'user_id',
      'payment_order_id', v_reg->'payment_order_id',
      'item', COALESCE(v_reg->>'ticket_type_id', 'none'),
      'ticket_type_id', v_reg->'ticket_type_id',
      'seats', v_reg->'seats',
      'source_seats', v_reg->'seats',
      'units', v_reg->'units',
      'basis', v_reg->'basis',
      'gross', v_reg->'gross',
      'currency', v_reg->'currency',
      'paid', v_reg->'paid',
      'paid_at', v_reg->'paid_at',
      'via_card', v_reg->'via_card',
      'label', CASE WHEN v_en THEN 'Ticket: ' ELSE 'Bilet: ' END
        || COALESCE(NULLIF(btrim(CASE WHEN v_en THEN v_reg->>'name_en' ELSE v_reg->>'name_pl' END), '') || ' - ', '')
        || CASE WHEN v_en THEN v_event.title_en ELSE v_event.title_pl END,
      'unit', CASE WHEN v_en THEN 'pcs' ELSE 'szt.' END
    );
  END IF;
  -- Zamowienie PAKIETU nie przechodzi dzis przez kase z karty
  -- (`event_package_orders.payment_order_id` nie ustawia zadna funkcja, patrz
  -- 20260926110000) - galaz karty jest bezpiecznikiem na przyszlosc: gdyby
  -- pakiet dostal zamowienie z karty, regula operatora (MoR) i kwota
  -- zamowienia zadzialaja bez zmiany tego pliku. Kwota bez karty to
  -- `amount_cents` zamowienia (juz po rabacie na miejsce).
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
    'units', jsonb_build_array(jsonb_build_object(
      'qty', 1,
      'gross', CASE WHEN v_src.via_card AND v_src.order_gross IS NOT NULL THEN v_src.order_gross
                    ELSE v_src.amount_cents::bigint END
    )),
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
  'Biezacy stan zrodla dokumentu (zapis wg _event_invoice_registration_source albo zamowienie pakietu): kwota i grupy miejsc, karta, zaplata, opis pozycji; odmowa = source_not_lead, source_not_invoiceable, source_plan_ticket.';
