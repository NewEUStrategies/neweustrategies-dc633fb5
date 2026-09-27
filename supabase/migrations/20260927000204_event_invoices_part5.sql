-- CZESC 5/5 MIGRACJI 20260927000200_event_invoices.sql
-- migration-split: part 5/5 of 20260927000200_event_invoices.sql
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
  v_src jsonb;
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
  -- CEL PROSBY: zapis prowadzacego grupy - chyba ze gosc placi SAM.
  -- Nieoplacony gosc w kroku platnosci otwiera wlasna kase (jedno miejsce),
  -- a gosc z wlasnym zamowieniem z karty jest osobnym zrodlem faktury; gosc
  -- rozliczony zamowieniem prowadzacego prosi o fakture prowadzacego.
  -- WLASNOSC: `_event_invoice_registration_owner` (zamowienie z karty -
  -- platnik; bez niego - osoba zapisu albo zalozyciel samodzielnego zapisu).
  -- Zapis wpisany przez organizatora (`admin_event_registration_upsert`
  -- stempluje created_by kontem PRACOWNIKA) nie jest zamowieniem pracownika:
  -- bez tego warunku pracownik - takze po odebraniu roli - czytalby
  -- i nadpisywal dane firmy uczestnika, a faktura trafialaby do jego profilu.
  -- Po przekazaniu biletu (tor B) nowy posiadacz nie prosi o fakture za
  -- wplate kartowa poprzedniego.
  IF v_registration IS NOT NULL THEN
    SELECT CASE
             WHEN r.group_lead_registration_id IS NULL OR r.payment_status = 'unpaid' THEN r.id
             WHEN public._event_invoice_registration_source(v_tenant, r.id, '23')->>'block' IS NULL THEN r.id
             ELSE r.group_lead_registration_id
           END
      INTO v_lead
      FROM public.event_registrations r
     WHERE r.id = v_registration AND r.tenant_id = v_tenant;
    v_src := public._event_invoice_registration_source(v_tenant, v_lead, '23');
    IF v_src IS NOT NULL AND v_src->>'status' NOT IN ('cancelled', 'rejected')
       AND v_src->>'payment_status' IN ('paid', 'partially_refunded', 'unpaid')
       AND public._event_invoice_registration_owner(v_tenant, v_lead, v_uid) THEN
      v_event_id := (v_src->>'event_id')::uuid;
      v_paid_at := NULLIF(v_src->>'paid_at', '')::timestamptz;
      v_card := NULLIF(v_src->>'payment_order_id', '')::uuid;
    END IF;
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
  -- Miejsce z puli planu bez zamowienia: nikt nie zaplacil, faktury nie bedzie.
  IF v_src->>'block' = 'plan_ticket' THEN
    RAISE EXCEPTION 'source_plan_ticket: a membership plan ticket covers this seat - nothing was paid'
      USING ERRCODE = '22023';
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
  'Prosba kupujacego o fakture do WLASNEGO zapisu (wg _event_invoice_registration_owner: zamowienie z karty - platnik, bez niego - osoba konta albo samodzielny zapis zalozony z konta; prowadzacy grupy albo gosc placacy sam) albo zamowienia pakietu; tylko gdy organizator fakturuje, zamowienie z karty nie nalezy do operatora i miejsca nie pokrywa bilet z puli planu; okno do konca trzeciego miesiaca po zaplacie; cudzej prosby nie przejmuje. Plaszczyzna: public_tenant_id() + auth.uid().';

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
    -- Wlasnosc jak w event_invoice_request_save (_event_invoice_registration_owner):
    -- zamowienie z karty - platnik; bez niego - osoba konta albo samodzielny
    -- zapis zalozony z konta (nigdy zapis wpisany przez pracownika). Kwota
    -- i miejsca z _event_invoice_registration_source (ta sama regula co
    -- szkic); zapisy, ktorych organizator i tak nie zafakturuje (miejsce
    -- z puli planu, gosc rozliczony przez prowadzacego), nie sa na liscie.
    -- Gosc z WLASNYM zamowieniem z karty jest osobnym zamowieniem platnika.
    SELECT 'registration'::text AS kind, r.id AS sid, r.event_id AS eid,
           x.src->>'name_pl' AS lpl, x.src->>'name_en' AS len,
           (x.src->>'seats')::integer AS nseats,
           (x.src->>'gross')::bigint AS ngross,
           NULLIF(x.src->>'payment_order_id', '')::uuid AS card,
           x.src->>'currency' AS cur,
           CASE WHEN r.payment_status = 'unpaid' THEN 'unpaid' ELSE 'paid' END AS pstate,
           NULLIF(x.src->>'paid_at', '')::timestamptz AS pat, r.created_at AS cat
      FROM public.event_registrations r
      LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
      CROSS JOIN LATERAL (
        SELECT public._event_invoice_registration_source(v_tenant, r.id, COALESCE(v_rate, '23')) AS src
      ) AS x
     WHERE r.tenant_id = v_tenant
       AND (p.user_id = v_uid OR r.created_by = v_uid OR o.user_id = v_uid)
       AND r.status NOT IN ('cancelled', 'rejected')
       AND r.payment_status IN ('paid', 'partially_refunded', 'unpaid')
       AND x.src->>'block' IS NULL
       AND public._event_invoice_registration_owner(v_tenant, r.id, v_uid)
    UNION ALL
    SELECT 'package_order'::text, o.id, o.event_id, k.name_pl, k.name_en, o.seats_total,
           CASE WHEN po.id IS NOT NULL AND po.status::text IN ('paid', 'refunded')
                THEN (po.amount_cents - COALESCE(po.refunded_amount_cents, 0))::bigint
                ELSE o.amount_cents::bigint END,
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
  SELECT d.kind, d.sid, d.eid, d.slug, d.title_pl, d.title_en, d.lpl, d.len, d.nseats, d.ngross,
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
  'Wlasne zamowienia wydarzen (zapisy prowadzacego i gosci z wlasnym zamowieniem z karty - kupujacy wg _event_invoice_registration_owner, pakiety; bez miejsc z puli planu) z kwota wg _event_invoice_registration_source, prosba o fakture, terminem prosby, powodem braku prosby (request_block) i wystawiona faktura. Plaszczyzna: public_tenant_id() + auth.uid().';

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
