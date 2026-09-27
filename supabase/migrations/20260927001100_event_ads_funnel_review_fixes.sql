-- ============================================================================
-- LEJEK GOOGLE ADS: POPRAWKI PO PRZEGLADZIE (pakiety, zgoda, przychod, limit grup).
--
-- BLIZNIAK drizzle/migrations/0073_event_ads_funnel_review_fixes.sql - ten sam
-- SQL wykonywalny (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
-- events-harness: include
--
-- PO CO
--   Przeglad lejka z 20260927000300/000301 (jeszcze nie na produkcji) znalazl
--   bledy liczb i zgody, ktorych bramki tekstowe nie widza. Pliki tamtej
--   migracji zostaja nietkniete (kolejnosc wdrozenia), a ta para redefiniuje
--   cztery funkcje i dodaje jedna tabele z jednym RPC:
--     * PAKIETY GRUPOWE nie byly konwersja - `event_package_orders` nie czytal
--       ani raport, ani eksport, a zakup pakietu nie mial jak przypiac
--       atrybucji (kupujacy nie dostaje `manage_token`);
--     * EKSPORT KONWERSJI wysylal gclid platnika albo posiadacza biletu, ktory
--       cofnal zgode na cookies marketingowe (`user_consents`,
--       `cookies_marketing`, given = false), oraz zgloszenia oplacone, ale
--       jeszcze nieprzyjete (akceptacja organizatora, lista rezerwowa);
--     * PRZYCHOD liczyl zamowienie niezaplacone albo odrzucone, gdy zgloszenie
--       rozliczyla potem pula planu albo wplata reczna (#407), liczyl pelna
--       kwote zamowienia przy zwrocie recznym z panelu (zamowienie zostaje
--       `paid` ze zwrotem 0), a gubil zamowienia z karty gosci grupy inne niz
--       zamowienie prowadzacego; pula planu liczyla sie jako "oplacone";
--     * RAPORT robil grupe z KAZDEJ wartosci utm_campaign z publicznego
--       beaconu (bez limitu, z podzapytaniami skorelowanymi per grupa);
--     * ZAPIS KOSZTOW recznie nadpisywal klikniecia i wyswietlenia dnia
--       zaimportowanego z CSV wartoscia NULL.
--
-- CO ROBI
--   1) `event_package_order_attributions` - klon `event_registration_
--      attributions` (te same CHECK-i, RLS i granty) dla zamowienia pakietu.
--   2) `event_package_order_attribution_attach(jsonb)` - wylacznie zalogowany
--      kupujacy (`buyer_user_id = auth.uid()`), najemca z `public_tenant_id()`
--      jak przy zgloszeniu, zapis raz, w dobie od zamowienia, ta sama
--      normalizacja `_event_ads_touch`.
--   3) `admin_event_ad_costs_save` - klucz `clicks`/`impressions` pominiety
--      w wierszu zostawia wartosc dnia (jawny null nadal czysci).
--   4) `admin_event_ads_funnel`:
--        * pakiet = konwersja (kohorta po `created_at`, oplacony przy `paid`,
--          przychod `amount_cents`), pakiet bez atrybucji do "bez atrybucji";
--          zgloszenia z miejsc pakietu (`event_package_seats`, zrodlo
--          `package_invitation`) odpadaja jak goscie grupy - pakiet juz jest
--          ta konwersja;
--        * przychod tylko z zamowien `paid`/`refunded` i tylko dla zgloszen
--          `paid`/`partially_refunded`, z `lead_orders` (zamowienia z karty
--          gosci doliczone do prowadzacego); "oplacone" bez zgloszen
--          rozliczonych pula planu bez zamowienia z karty;
--        * grupy utm:/gad: ponad 50 najliczniejszych (zgloszenia, wizyty,
--          klucz) ida do jednej grupy `other`, `groups_folded` mowi ile;
--          agregaty przez GROUP BY + LEFT JOIN zamiast podzapytan per grupa.
--   5) `admin_event_ads_conversions_export`: zamowienia `paid`/`refunded`
--      i `o.paid_at`, tylko przyjete zgloszenia (`approved`/`attended`/
--      `no_show`), pakiety oplacone z kliknieciem (registration_id NULL),
--      wykluczenie przy cofnietej zgodzie platnika albo posiadacza, liczniki
--      `consent_withdrawn` i `awaiting_admission`.
--   6) `event_ads_retention_prune` zeruje klikniecia takze w atrybucji pakietow.
--
-- CZEGO NIE ZMIENIA
--   * sygnatur ani typow zwracanych (CREATE OR REPLACE), grantow;
--   * mostu CRM - atrybucja pakietu nie tworzy wpisu osi czasu (kupujacy nie
--     jest osoba wydarzenia; pakiet przypisuje zespol, nie siebie).
--
-- KOLEJNOSC WDROZENIA
--   Po 20260927000301 (lejek) i 20260824080000 (pakiety). Na koncu
--   scripts/deploy-order/produkcja.txt.
--
-- Testy: scripts/events-harness/runtime_test.d/28_ads_funnel_review.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ATRYBUCJA ZAMOWIENIA PAKIETU (dane osobowe - tylko panel)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_package_order_attributions (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  package_order_id uuid NOT NULL,
  event_id uuid NOT NULL,
  first_touch jsonb,
  last_touch jsonb,
  source text NOT NULL DEFAULT '(direct)',
  medium text NOT NULL DEFAULT '(none)',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gad_source text,
  gad_campaign_id text,
  referrer_host text,
  click_id_type text,
  click_id text,
  click_at timestamptz,
  click_pruned_at timestamptz,
  ad_user_data boolean NOT NULL DEFAULT false,
  ad_personalization boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_package_order_attributions_pkey PRIMARY KEY (tenant_id, package_order_id),
  CONSTRAINT event_package_order_attributions_order_fk FOREIGN KEY (tenant_id, package_order_id)
    REFERENCES public.event_package_orders (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_package_order_attributions_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_package_order_attributions_click_id_type_values
    CHECK (click_id_type IN ('gclid', 'gbraid', 'wbraid')),
  CONSTRAINT event_package_order_attributions_click_pair
    CHECK ((click_id IS NULL) = (click_id_type IS NULL) AND (click_id IS NULL OR click_at IS NOT NULL)),
  CONSTRAINT event_package_order_attributions_click_id_format
    CHECK (char_length(click_id) BETWEEN 10 AND 512 AND click_id ~ '^[A-Za-z0-9_-]+$'),
  CONSTRAINT event_package_order_attributions_click_consent
    CHECK (click_id IS NULL OR ad_user_data),
  CONSTRAINT event_package_order_attributions_touch_shape
    CHECK ((first_touch IS NULL OR jsonb_typeof(first_touch) = 'object')
       AND (last_touch IS NULL OR jsonb_typeof(last_touch) = 'object'))
);

COMMENT ON TABLE public.event_package_order_attributions IS
  'Dotkniecie kampanii przypiete do zamowienia pakietu grupowego (pierwsze + ostatnie nie-bezposrednie, 90 dni). Zapis raz, wylacznie event_package_order_attribution_attach (zalogowany kupujacy); odczyt admin/super_admin najemcy. Wiersz bez dotkniec = wejscie bezposrednie przy zgodzie na pomiar.';
COMMENT ON COLUMN public.event_package_order_attributions.click_id IS
  'gclid/gbraid/wbraid do importu konwersji offline - wylacznie przy zgodzie reklamowej; zerowany po 120 dniach (click_pruned_at). NIGDY nie trafia do CRM.';

CREATE INDEX IF NOT EXISTS event_package_order_attributions_event_idx
  ON public.event_package_order_attributions (tenant_id, event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_package_order_attributions_click_idx
  ON public.event_package_order_attributions (created_at)
  WHERE click_id IS NOT NULL;

REVOKE ALL ON public.event_package_order_attributions FROM anon, authenticated;
GRANT SELECT ON public.event_package_order_attributions TO authenticated;
GRANT ALL ON public.event_package_order_attributions TO service_role;
ALTER TABLE public.event_package_order_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_package_order_attributions_staff_read" ON public.event_package_order_attributions;
CREATE POLICY "event_package_order_attributions_staff_read"
  ON public.event_package_order_attributions FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );
-- Zapis: BRAK polityki klienckiej - wylacznie event_package_order_attribution_attach.

-- ----------------------------------------------------------------------------
-- 2) PRZYPIECIE ATRYBUCJI DO ZAMOWIENIA PAKIETU (zalogowany kupujacy)
--
-- Kluczem jest zamowienie WLASNE wolajacego (`buyer_user_id = auth.uid()`),
-- najemca z `public_tenant_id()` jak przy zgloszeniu. Odmowy sa wynikiem
-- (nie wyjatkiem) i nie mowia, czy cudze zamowienie istnieje. Set-once,
-- tylko w dobie od zlozenia zamowienia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_package_order_attribution_attach(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
  v_now timestamptz := now();
  v_order_id uuid;
  v_event uuid;
  v_created timestamptz;
  v_ad boolean;
  v_first jsonb;
  v_last jsonb;
  v_click jsonb;
  v_source text;
  v_medium text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: a payload object is required';
  END IF;
  IF v_uid IS NULL OR v_tenant IS NULL
     OR COALESCE(p_payload->>'order_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  v_order_id := (p_payload->>'order_id')::uuid;

  SELECT po.event_id, po.created_at INTO v_event, v_created
    FROM public.event_package_orders po
   WHERE po.tenant_id = v_tenant AND po.id = v_order_id AND po.buyer_user_id = v_uid
   FOR UPDATE;
  IF v_event IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_created < v_now - interval '1 day' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_late');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_package_order_attributions a
     WHERE a.tenant_id = v_tenant AND a.package_order_id = v_order_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'attached', false, 'reason', 'already_attached');
  END IF;

  v_ad := COALESCE(p_payload->>'ad_consent', '') = 'true';
  v_first := public._event_ads_touch(p_payload->'first', v_ad, v_now);
  v_last := public._event_ads_touch(p_payload->'last', v_ad, v_now);
  v_first := COALESCE(v_first, v_last);
  v_last := COALESCE(v_last, v_first);
  v_click := CASE
    WHEN v_last->>'click_id' IS NOT NULL THEN v_last
    WHEN v_first->>'click_id' IS NOT NULL THEN v_first
  END;
  v_source := COALESCE(v_last->>'source', '(direct)');
  v_medium := COALESCE(v_last->>'medium', '(none)');

  INSERT INTO public.event_package_order_attributions AS a (
    tenant_id, package_order_id, event_id, first_touch, last_touch, source, medium,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, gad_source, gad_campaign_id,
    referrer_host, click_id_type, click_id, click_at, ad_user_data, ad_personalization, created_at
  ) VALUES (
    v_tenant, v_order_id, v_event, v_first, v_last, v_source, v_medium,
    v_last->>'utm_source', v_last->>'utm_medium', v_last->>'utm_campaign', v_last->>'utm_term',
    v_last->>'utm_content', v_last->>'gad_source', v_last->>'gad_campaign_id',
    v_last->>'referrer_host', v_click->>'click_id_type', v_click->>'click_id',
    (v_click->>'touch_at')::timestamptz, v_ad, v_ad, v_now
  )
  ON CONFLICT (tenant_id, package_order_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'attached', false, 'reason', 'already_attached');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'attached', true,
    'source', v_source,
    'medium', v_medium,
    'click', v_click IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_package_order_attribution_attach(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_package_order_attribution_attach(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_package_order_attribution_attach(jsonb) IS
  'Przypiecie dotkniecia kampanii do WLASNEGO zamowienia pakietu grupowego (buyer_user_id = auth.uid(), najemca z public_tenant_id). Zapis raz, w dobie od zamowienia; identyfikator klikniecia tylko przy ad_consent. Odmowy jako wynik {ok:false, reason}: not_found, too_late.';

-- ----------------------------------------------------------------------------
-- 3) ZAPIS KOSZTOW - klikniecia i wyswietlenia pominiete w wierszu zostaja
--
-- Cialo z 20260927000301. Zmiana: przy nadpisaniu dnia `clicks`/`impressions`
-- biora wartosc z wiersza tylko wtedy, gdy wiersz NIESIE klucz - reczna
-- poprawka kosztu dnia zaimportowanego z CSV nie zeruje jego klikniec.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_ad_costs_save(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_campaign public.event_ad_campaigns%ROWTYPE;
  v_source text;
  v_rows jsonb;
  v_row jsonb;
  v_n integer := 0;
  v_day date;
  v_cost bigint;
  v_days date[] := '{}'::date[];
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR COALESCE(p_payload->>'campaign_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'invalid_payload: campaign_id is required';
  END IF;

  SELECT c.* INTO v_campaign
    FROM public.event_ad_campaigns c
   WHERE c.id = (p_payload->>'campaign_id')::uuid AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: campaign does not exist in this tenant';
  END IF;

  v_source := COALESCE(p_payload->>'source', 'manual');
  IF v_source NOT IN ('manual', 'csv') THEN
    RAISE EXCEPTION 'invalid_source: %', v_source;
  END IF;

  v_rows := p_payload->'rows';
  IF v_rows IS NULL OR jsonb_typeof(v_rows) <> 'array'
     OR jsonb_array_length(v_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_rows: between 1 and 500 rows are required';
  END IF;

  FOR v_row IN SELECT r.value FROM jsonb_array_elements(v_rows) AS r(value) LOOP
    v_n := v_n + 1;
    IF jsonb_typeof(v_row) <> 'object'
       OR COALESCE(v_row->>'day', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR COALESCE(v_row->>'cost_micros', '') !~ '^[0-9]{1,16}$'
       OR COALESCE(v_row->>'currency', '') !~ '^[A-Z]{3}$'
       OR COALESCE(v_row->>'clicks', '0') !~ '^[0-9]{1,9}$'
       OR COALESCE(v_row->>'impressions', '0') !~ '^[0-9]{1,9}$' THEN
      RAISE EXCEPTION 'invalid_cost_row: row % is invalid', v_n;
    END IF;
    BEGIN
      v_day := (v_row->>'day')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_cost_row: row % is invalid', v_n;
    END;
    v_cost := (v_row->>'cost_micros')::bigint;
    IF v_day < DATE '2000-01-01' OR v_day > (now() + interval '1 day')::date
       OR v_cost > 1000000000000000 THEN
      RAISE EXCEPTION 'invalid_cost_row: row % is invalid', v_n;
    END IF;
    IF v_day = ANY (v_days) THEN
      RAISE EXCEPTION 'duplicate_cost_day: row % repeats a day', v_n;
    END IF;
    v_days := v_days || v_day;

    INSERT INTO public.event_ad_campaign_costs AS k (
      tenant_id, event_id, campaign_id, day, cost_micros, currency, clicks, impressions, source
    ) VALUES (
      v_tenant, v_campaign.event_id, v_campaign.id, v_day, v_cost, v_row->>'currency',
      (v_row->>'clicks')::integer, (v_row->>'impressions')::integer, v_source
    )
    ON CONFLICT (tenant_id, campaign_id, day) DO UPDATE SET
      cost_micros = EXCLUDED.cost_micros,
      currency = EXCLUDED.currency,
      clicks = CASE WHEN v_row ? 'clicks' THEN EXCLUDED.clicks ELSE k.clicks END,
      impressions = CASE WHEN v_row ? 'impressions' THEN EXCLUDED.impressions ELSE k.impressions END,
      source = EXCLUDED.source;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ad_costs_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ad_costs_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ad_costs_save(jsonb) IS
  'Zapis wsadowy kosztow dziennych kampanii (1-500 wierszy, calosc albo nic, dzien juz zapisany jest nadpisywany; klikniecia i wyswietlenia tylko, gdy wiersz niesie klucz). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 4) RAPORT LEJKA
--
-- Cialo z 20260927000301, przepisane (opis zmian w naglowku). Konwersja =
-- zgloszenie prowadzacego (bez gosci grupy i bez miejsc pakietu) ALBO
-- zamowienie pakietu. Przychod per ZAMOWIENIE, z jednym wierszem na
-- zamowienie (DISTINCT ON), wiec zamowienie grupy nie dubluje sie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_ads_funnel(
  p_event_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_tz text;
  v_from_day date;
  v_to_day date;
  v_out jsonb;
BEGIN
  SELECT e.timezone INTO v_tz
    FROM public.events e
   WHERE e.id = p_event_id AND e.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from >= p_to THEN
    RAISE EXCEPTION 'invalid_window: from must be earlier than to';
  END IF;
  v_tz := CASE
    WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN v_tz
    ELSE 'Europe/Warsaw'
  END;
  v_from_day := (p_from AT TIME ZONE v_tz)::date;
  v_to_day := ((p_to - interval '1 microsecond') AT TIME ZONE v_tz)::date;

  WITH camps AS (
    SELECT c.id, c.label, c.match_kind, c.match_value
      FROM public.event_ad_campaigns c
     WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id
  ),
  -- Zgloszenia prowadzacych z kohorty. Oplacone: status platnosci i - przy
  -- aktywnym bilecie z puli planu - zamowienie z karty (sama pula nie jest
  -- zakupem).
  leads AS (
    SELECT r.id, r.payment_status, r.payment_order_id,
           a.registration_id IS NOT NULL AS attributed,
           a.source, a.medium, a.utm_campaign, a.gad_campaign_id,
           (r.payment_status IN ('paid', 'partially_refunded')
            AND (o.id IS NOT NULL OR NOT EXISTS (
              SELECT 1 FROM public.plan_ticket_claims c
               WHERE c.tenant_id = r.tenant_id AND c.registration_id = r.id
                 AND c.released_at IS NULL
            ))) AS paid
      FROM public.event_registrations r
      LEFT JOIN public.event_registration_attributions a
        ON a.tenant_id = r.tenant_id AND a.registration_id = r.id
      LEFT JOIN public.payment_orders o
        ON o.id = r.payment_order_id AND o.tenant_id = r.tenant_id
       AND o.status::text IN ('paid', 'refunded')
     WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
       AND r.group_lead_registration_id IS NULL
       AND r.source IS DISTINCT FROM 'package_invitation'
       AND NOT EXISTS (
         SELECT 1 FROM public.event_package_seats s
          WHERE s.tenant_id = r.tenant_id AND s.registration_id = r.id
       )
       AND (p_from IS NULL OR r.created_at >= p_from)
       AND (p_to IS NULL OR r.created_at < p_to)
  ),
  pkgs AS (
    SELECT po.id, po.status = 'paid' AS paid, po.currency, po.amount_cents,
           pa.package_order_id IS NOT NULL AS attributed,
           pa.source, pa.medium, pa.utm_campaign, pa.gad_campaign_id
      FROM public.event_package_orders po
      LEFT JOIN public.event_package_order_attributions pa
        ON pa.tenant_id = po.tenant_id AND pa.package_order_id = po.id
     WHERE po.tenant_id = v_tenant AND po.event_id = p_event_id
       AND (p_from IS NULL OR po.created_at >= p_from)
       AND (p_to IS NULL OR po.created_at < p_to)
  ),
  convs AS (
    SELECT 'reg'::text AS kind, l.id, l.paid, l.attributed,
           l.source, l.medium, l.utm_campaign, l.gad_campaign_id
      FROM leads l
    UNION ALL
    SELECT 'pkg', p.id, p.paid, p.attributed, p.source, p.medium, p.utm_campaign, p.gad_campaign_id
      FROM pkgs p
  ),
  -- Zamowienia z karty prowadzacego i jego gosci (gosc z WLASNYM zamowieniem,
  -- innym niz zamowienie prowadzacego). Zamowienie liczy sie tylko zaplacone
  -- (albo zwrocone przez Stripe - kwota minus zwroty) i tylko dla zgloszenia
  -- `paid`/`partially_refunded`: zwrot reczny z panelu zostawia zamowienie
  -- `paid` ze zwrotem 0, a zgloszenie `refunded`.
  lead_orders AS (
    SELECT l.id AS conv_id, o.id AS order_id, o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS net
      FROM leads l
      JOIN public.payment_orders o ON o.id = l.payment_order_id AND o.tenant_id = v_tenant
     WHERE l.payment_status IN ('paid', 'partially_refunded')
       AND o.status::text IN ('paid', 'refunded')
    UNION ALL
    SELECT l.id, o.id, o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint
      FROM leads l
      JOIN public.event_registrations g
        ON g.tenant_id = v_tenant AND g.group_lead_registration_id = l.id
      JOIN public.payment_orders o ON o.id = g.payment_order_id AND o.tenant_id = v_tenant
     WHERE g.payment_status IN ('paid', 'partially_refunded')
       AND o.status::text IN ('paid', 'refunded')
       AND g.payment_order_id IS DISTINCT FROM l.payment_order_id
  ),
  rev AS (
    SELECT DISTINCT ON (x.order_id) x.kind, x.conv_id, x.currency, x.net
      FROM (
        SELECT 'reg'::text AS kind, lo.conv_id, lo.order_id, lo.currency, lo.net
          FROM lead_orders lo
        UNION ALL
        SELECT 'pkg', p.id, p.id, p.currency, p.amount_cents::bigint
          FROM pkgs p WHERE p.paid
      ) x
     ORDER BY x.order_id, x.conv_id
  ),
  touches AS (
    SELECT 'step'::text AS kind, f.step, f.visitor_key, NULL::uuid AS conv_id, false AS paid,
           f.source, f.medium, f.utm_campaign, f.gad_campaign_id
      FROM public.event_funnel_events f
     WHERE f.tenant_id = v_tenant AND f.event_id = p_event_id
       AND (p_from IS NULL OR f.occurred_at >= p_from)
       AND (p_to IS NULL OR f.occurred_at < p_to)
    UNION ALL
    SELECT c.kind, NULL, NULL, c.id, c.paid, c.source, c.medium, c.utm_campaign, c.gad_campaign_id
      FROM convs c
     WHERE c.attributed
  ),
  raw_keyed AS (
    SELECT t.*,
           CASE
             WHEN m.id IS NOT NULL THEN 'campaign:' || m.id::text
             WHEN t.utm_campaign IS NOT NULL THEN 'utm:' || lower(t.utm_campaign)
             WHEN t.gad_campaign_id IS NOT NULL THEN 'gad:' || t.gad_campaign_id
             ELSE 'none'
           END AS raw_key
      FROM touches t
      LEFT JOIN LATERAL (
        SELECT c.id
          FROM camps c
         WHERE (c.match_kind = 'google_ads_campaign_id' AND c.match_value = t.gad_campaign_id)
            OR (c.match_kind = 'utm_campaign' AND c.match_value = lower(t.utm_campaign))
         ORDER BY (c.match_kind = 'google_ads_campaign_id') DESC, c.id
         LIMIT 1
      ) m ON true
  ),
  -- Limit grup niezmapowanych: wartosci przychodza z publicznego beaconu.
  ranked AS (
    SELECT k.raw_key,
           row_number() OVER (
             ORDER BY count(*) FILTER (WHERE k.kind <> 'step') DESC,
                      count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'visit') DESC,
                      k.raw_key
           ) AS rn
      FROM raw_keyed k
     WHERE k.raw_key LIKE 'utm:%' OR k.raw_key LIKE 'gad:%'
     GROUP BY k.raw_key
  ),
  keyed AS (
    SELECT k.*, CASE WHEN r.rn > 50 THEN 'other' ELSE k.raw_key END AS group_key
      FROM raw_keyed k
      LEFT JOIN ranked r ON r.raw_key = k.raw_key
  ),
  grp AS (
    SELECT k.group_key,
           CASE WHEN k.group_key = 'other' THEN NULL ELSE min(k.utm_campaign) END AS utm_campaign,
           CASE WHEN k.group_key = 'other' THEN NULL ELSE min(k.gad_campaign_id) END AS gad_campaign_id,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'visit') AS visits,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'registration_start') AS starts,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'checkout_start') AS checkouts,
           count(*) FILTER (WHERE k.kind <> 'step') AS registrations,
           count(*) FILTER (WHERE k.kind <> 'step' AND k.paid) AS paid
      FROM keyed k
     GROUP BY k.group_key
  ),
  chan AS (
    SELECT k.group_key, k.source, k.medium,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'visit') AS visits,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'registration_start') AS starts,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'checkout_start') AS checkouts,
           count(*) FILTER (WHERE k.kind <> 'step') AS registrations,
           count(*) FILTER (WHERE k.kind <> 'step' AND k.paid) AS paid
      FROM keyed k
     GROUP BY k.group_key, k.source, k.medium
  ),
  keyed_rev AS (
    SELECT k.group_key, k.source, k.medium, r.currency, r.net
      FROM rev r
      JOIN keyed k ON k.kind = r.kind AND k.conv_id = r.conv_id
  ),
  grp_rev AS (
    SELECT x.group_key,
           jsonb_agg(jsonb_build_object('currency', x.currency, 'cents', x.cents)
                     ORDER BY x.currency) AS revenue
      FROM (
        SELECT kr.group_key, kr.currency, sum(kr.net)::bigint AS cents
          FROM keyed_rev kr
         GROUP BY kr.group_key, kr.currency
      ) x
     GROUP BY x.group_key
  ),
  chan_rev AS (
    SELECT x.group_key, x.source, x.medium,
           jsonb_agg(jsonb_build_object('currency', x.currency, 'cents', x.cents)
                     ORDER BY x.currency) AS revenue
      FROM (
        SELECT kr.group_key, kr.source, kr.medium, kr.currency, sum(kr.net)::bigint AS cents
          FROM keyed_rev kr
         GROUP BY kr.group_key, kr.source, kr.medium, kr.currency
      ) x
     GROUP BY x.group_key, x.source, x.medium
  ),
  chan_json AS (
    SELECT ch.group_key,
           jsonb_agg(jsonb_build_object(
             'source', ch.source,
             'medium', ch.medium,
             'visits', ch.visits,
             'registration_starts', ch.starts,
             'checkout_starts', ch.checkouts,
             'registrations', ch.registrations,
             'paid', ch.paid,
             'revenue', COALESCE(cr.revenue, '[]'::jsonb)
           ) ORDER BY ch.visits DESC, ch.registrations DESC, ch.source, ch.medium) AS channels
      FROM chan ch
      LEFT JOIN chan_rev cr
        ON cr.group_key = ch.group_key AND cr.source = ch.source AND cr.medium = ch.medium
     GROUP BY ch.group_key
  ),
  cost AS (
    SELECT k.campaign_id, k.currency, sum(k.cost_micros)::bigint AS micros
      FROM public.event_ad_campaign_costs k
     WHERE k.tenant_id = v_tenant AND k.event_id = p_event_id
       AND (v_from_day IS NULL OR k.day >= v_from_day)
       AND (v_to_day IS NULL OR k.day <= v_to_day)
     GROUP BY k.campaign_id, k.currency
  ),
  cost_json AS (
    SELECT 'campaign:' || co.campaign_id::text AS group_key,
           jsonb_agg(jsonb_build_object('currency', co.currency, 'micros', co.micros)
                     ORDER BY co.currency) AS cost
      FROM cost co
     GROUP BY co.campaign_id
  ),
  group_keys AS (
    SELECT g.group_key FROM grp g
    UNION
    SELECT cj.group_key FROM cost_json cj
  ),
  unattr AS (
    SELECT c.kind, c.id, c.paid FROM convs c WHERE NOT c.attributed
  ),
  unattr_rev AS (
    SELECT r.currency, r.net
      FROM rev r
      JOIN unattr u ON u.kind = r.kind AND u.id = r.conv_id
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key', gk.group_key,
               'kind', CASE
                 WHEN gk.group_key LIKE 'campaign:%' THEN 'campaign'
                 WHEN gk.group_key LIKE 'utm:%' THEN 'utm_campaign'
                 WHEN gk.group_key LIKE 'gad:%' THEN 'gad_campaign'
                 WHEN gk.group_key = 'other' THEN 'other'
                 ELSE 'none'
               END,
               'campaign_id', c.id,
               'label', c.label,
               'match_kind', c.match_kind,
               'match_value', c.match_value,
               'utm_campaign', g.utm_campaign,
               'gad_campaign_id', g.gad_campaign_id,
               'visits', COALESCE(g.visits, 0),
               'registration_starts', COALESCE(g.starts, 0),
               'checkout_starts', COALESCE(g.checkouts, 0),
               'registrations', COALESCE(g.registrations, 0),
               'paid', COALESCE(g.paid, 0),
               'revenue', COALESCE(gr.revenue, '[]'::jsonb),
               'cost', COALESCE(cj.cost, '[]'::jsonb),
               'channels', COALESCE(chj.channels, '[]'::jsonb)
             ) ORDER BY
               CASE
                 WHEN gk.group_key LIKE 'campaign:%' THEN 0
                 WHEN gk.group_key LIKE 'utm:%' THEN 1
                 WHEN gk.group_key LIKE 'gad:%' THEN 2
                 WHEN gk.group_key = 'other' THEN 3
                 ELSE 4
               END,
               lower(COALESCE(c.label, g.utm_campaign, g.gad_campaign_id, '')),
               gk.group_key)
        FROM group_keys gk
        LEFT JOIN grp g ON g.group_key = gk.group_key
        LEFT JOIN camps c ON 'campaign:' || c.id::text = gk.group_key
        LEFT JOIN grp_rev gr ON gr.group_key = gk.group_key
        LEFT JOIN cost_json cj ON cj.group_key = gk.group_key
        LEFT JOIN chan_json chj ON chj.group_key = gk.group_key
    ), '[]'::jsonb),
    'groups_folded', (SELECT count(*) FROM ranked r WHERE r.rn > 50),
    'unattributed', jsonb_build_object(
      'registrations', (SELECT count(*) FROM unattr),
      'paid', (SELECT count(*) FROM unattr u WHERE u.paid),
      'revenue', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', z.currency, 'cents', z.cents) ORDER BY z.currency)
          FROM (SELECT ur.currency, sum(ur.net)::bigint AS cents FROM unattr_rev ur GROUP BY ur.currency) z
      ), '[]'::jsonb)
    ),
    'totals', jsonb_build_object(
      'visits', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'visit'),
      'registration_starts', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'registration_start'),
      'checkout_starts', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'checkout_start'),
      'attributed_registrations', (SELECT count(*) FROM convs c WHERE c.attributed),
      'registrations', (SELECT count(*) FROM convs),
      'paid', (SELECT count(*) FROM convs c WHERE c.paid),
      'revenue', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', w.currency, 'cents', w.cents) ORDER BY w.currency)
          FROM (SELECT r.currency, sum(r.net)::bigint AS cents FROM rev r GROUP BY r.currency) w
      ), '[]'::jsonb),
      'cost', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', q.currency, 'micros', q.micros) ORDER BY q.currency)
          FROM (SELECT co.currency, sum(co.micros)::bigint AS micros FROM cost co GROUP BY co.currency) q
      ), '[]'::jsonb)
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ads_funnel(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ads_funnel(uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ads_funnel(uuid, timestamptz, timestamptz) IS
  'Lejek sprzedazy wydarzenia per kampania (zmapowana > utm_campaign > id kampanii Google Ads > pozostale ponad 50 najliczniejszych > brak) z rozbiciem zrodlo/medium: wizyty, rozpoczecia zapisu i platnosci, konwersje (zgloszenia prowadzacych i zamowienia pakietow, kohorta po dacie zapisu), oplacone, przychod netto per waluta (per zamowienie zaplacone), koszt; osobno konwersje bez atrybucji i sumy. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 5) EKSPORT KONWERSJI OFFLINE
--
-- Cialo z 20260927000301, przepisane. Oplacone = zamowienie z karty
-- (`paid`/`refunded`, czas `o.paid_at`) zgloszenia `paid`/`partially_refunded`
-- ALBO zamowienie pakietu `paid`. Do pliku tylko z kliknieciem przy zgodzie,
-- mlodszym niz 90 dni, platnoscia po kliknieciu, PRZYJETE (zgloszenie
-- oplacone, ale czekajace na akceptacje albo na liscie rezerwowej moze jeszcze
-- dostac zwrot) i bez cofnietej zgody na cookies marketingowe platnika albo
-- posiadacza biletu. Kazdy pominiety wiersz trafia do dokladnie jednego licznika.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_ads_conversions_export(
  p_event_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_tz text;
  v_out jsonb;
BEGIN
  SELECT e.timezone INTO v_tz
    FROM public.events e
   WHERE e.id = p_event_id AND e.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from >= p_to THEN
    RAISE EXCEPTION 'invalid_window: from must be earlier than to';
  END IF;
  v_tz := CASE
    WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN v_tz
    ELSE 'Europe/Warsaw'
  END;

  WITH paid AS (
    (SELECT DISTINCT ON (o.id)
            r.id AS registration_id, o.id AS order_id, o.currency,
            GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS net,
            o.paid_at AS converted_at,
            r.status IN ('approved', 'attended', 'no_show') AS admitted,
            a.registration_id IS NOT NULL AS attributed,
            a.click_id_type, a.click_id, a.click_at, a.click_pruned_at,
            a.ad_user_data, a.ad_personalization, a.utm_campaign, a.gad_campaign_id,
            o.user_id AS payer_user_id, pe.user_id AS holder_user_id
       FROM public.event_registrations r
       JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = v_tenant
       LEFT JOIN public.event_people pe ON pe.tenant_id = r.tenant_id AND pe.id = r.person_id
       LEFT JOIN public.event_registration_attributions a
         ON a.tenant_id = r.tenant_id AND a.registration_id = r.id
      WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
        AND r.group_lead_registration_id IS NULL
        AND r.payment_status IN ('paid', 'partially_refunded')
        AND o.status::text IN ('paid', 'refunded')
        AND o.paid_at IS NOT NULL
        AND (p_from IS NULL OR o.paid_at >= p_from)
        AND (p_to IS NULL OR o.paid_at < p_to)
      ORDER BY o.id, r.created_at)
    UNION ALL
    SELECT NULL::uuid, po.id, po.currency, po.amount_cents::bigint, po.paid_at, true,
           pa.package_order_id IS NOT NULL,
           pa.click_id_type, pa.click_id, pa.click_at, pa.click_pruned_at,
           pa.ad_user_data, pa.ad_personalization, pa.utm_campaign, pa.gad_campaign_id,
           po.buyer_user_id, NULL::uuid
      FROM public.event_package_orders po
      LEFT JOIN public.event_package_order_attributions pa
        ON pa.tenant_id = po.tenant_id AND pa.package_order_id = po.id
     WHERE po.tenant_id = v_tenant AND po.event_id = p_event_id
       AND po.status = 'paid'
       AND po.paid_at IS NOT NULL
       AND (p_from IS NULL OR po.paid_at >= p_from)
       AND (p_to IS NULL OR po.paid_at < p_to)
  ),
  flagged AS (
    SELECT p.*,
           (p.click_id IS NOT NULL AND p.ad_user_data
            AND p.click_at > now() - interval '90 days'
            AND p.converted_at >= p.click_at) AS click_ok,
           EXISTS (
             SELECT 1 FROM public.user_consents uc
              WHERE uc.user_id IN (p.payer_user_id, p.holder_user_id)
                AND uc.consent_key = 'cookies_marketing'
                AND NOT uc.given
           ) AS consent_withdrawn
      FROM paid p
  ),
  eligible AS (
    SELECT f.*, m.conversion_action_name
      FROM flagged f
      LEFT JOIN LATERAL (
        SELECT c.conversion_action_name
          FROM public.event_ad_campaigns c
         WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id
           AND ((c.match_kind = 'google_ads_campaign_id' AND c.match_value = f.gad_campaign_id)
             OR (c.match_kind = 'utm_campaign' AND c.match_value = lower(f.utm_campaign)))
         ORDER BY (c.match_kind = 'google_ads_campaign_id') DESC, c.id
         LIMIT 1
      ) m ON true
     WHERE f.click_ok AND NOT f.consent_withdrawn AND f.admitted
  )
  SELECT jsonb_build_object(
    'timezone', v_tz,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'order_id', e.order_id,
               'registration_id', e.registration_id,
               'click_id_type', e.click_id_type,
               'click_id', e.click_id,
               'conversion_action_name', e.conversion_action_name,
               'conversion_time', e.converted_at,
               'conversion_time_local', to_char(e.converted_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI:SS'),
               'value_cents', e.net,
               'currency', e.currency,
               'ad_user_data', e.ad_user_data,
               'ad_personalization', e.ad_personalization
             ) ORDER BY e.converted_at, e.order_id)
        FROM eligible e
    ), '[]'::jsonb),
    'skipped', jsonb_build_object(
      'unattributed', (SELECT count(*) FROM flagged f WHERE NOT f.attributed),
      'no_click', (SELECT count(*) FROM flagged f
                    WHERE f.attributed AND f.click_id IS NULL AND f.click_pruned_at IS NULL),
      'expired', (SELECT count(*) FROM flagged f
                   WHERE f.click_pruned_at IS NOT NULL
                      OR (f.click_id IS NOT NULL AND f.click_at <= now() - interval '90 days')),
      'before_click', (SELECT count(*) FROM flagged f
                        WHERE f.click_id IS NOT NULL AND f.click_at > now() - interval '90 days'
                          AND f.converted_at < f.click_at),
      'consent_withdrawn', (SELECT count(*) FROM flagged f WHERE f.click_ok AND f.consent_withdrawn),
      'awaiting_admission', (SELECT count(*) FROM flagged f
                              WHERE f.click_ok AND NOT f.consent_withdrawn AND NOT f.admitted)
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ads_conversions_export(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ads_conversions_export(uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ads_conversions_export(uuid, timestamptz, timestamptz) IS
  'Wiersze do importu konwersji offline Google Ads (klikniecia): oplacone i przyjete zgloszenia (zamowienie z karty paid/refunded) oraz oplacone zamowienia pakietow z identyfikatorem klikniecia przy zgodzie reklamowej, klikniecie mlodsze niz 90 dni, platnosc po kliknieciu, bez cofnietej zgody na cookies marketingowe platnika albo posiadacza; czas w strefie wydarzenia, wartosc netto zamowienia, nazwa konwersji z kampanii; plus liczniki pominietych (w tym consent_withdrawn, awaiting_admission). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 6) RETENCJA - takze atrybucja zamowien pakietow
--
-- Cialo z 20260927000301 + trzecia tabela z identyfikatorem klikniecia.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_ads_retention_prune()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clicks_attr integer;
  v_clicks_pkg integer;
  v_clicks_steps integer;
  v_steps integer;
BEGIN
  UPDATE public.event_registration_attributions a SET
    click_id = NULL,
    click_id_type = NULL,
    click_at = NULL,
    click_pruned_at = now(),
    first_touch = CASE WHEN a.first_touch IS NULL THEN NULL
                       ELSE a.first_touch - 'click_id' - 'click_id_type' END,
    last_touch = CASE WHEN a.last_touch IS NULL THEN NULL
                      ELSE a.last_touch - 'click_id' - 'click_id_type' END
  WHERE a.click_id IS NOT NULL AND a.created_at < now() - interval '120 days';
  GET DIAGNOSTICS v_clicks_attr = ROW_COUNT;

  UPDATE public.event_package_order_attributions a SET
    click_id = NULL,
    click_id_type = NULL,
    click_at = NULL,
    click_pruned_at = now(),
    first_touch = CASE WHEN a.first_touch IS NULL THEN NULL
                       ELSE a.first_touch - 'click_id' - 'click_id_type' END,
    last_touch = CASE WHEN a.last_touch IS NULL THEN NULL
                      ELSE a.last_touch - 'click_id' - 'click_id_type' END
  WHERE a.click_id IS NOT NULL AND a.created_at < now() - interval '120 days';
  GET DIAGNOSTICS v_clicks_pkg = ROW_COUNT;

  UPDATE public.event_funnel_events f SET
    click_id = NULL,
    click_id_type = NULL
  WHERE f.click_id IS NOT NULL AND f.occurred_at < now() - interval '120 days';
  GET DIAGNOSTICS v_clicks_steps = ROW_COUNT;

  DELETE FROM public.event_funnel_events f WHERE f.occurred_at < now() - interval '400 days';
  GET DIAGNOSTICS v_steps = ROW_COUNT;

  RETURN jsonb_build_object(
    'attribution_clicks_cleared', v_clicks_attr,
    'package_attribution_clicks_cleared', v_clicks_pkg,
    'funnel_clicks_cleared', v_clicks_steps,
    'funnel_steps_deleted', v_steps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_ads_retention_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_ads_retention_prune() TO service_role;

COMMENT ON FUNCTION public.event_ads_retention_prune() IS
  'Retencja lejka reklam: identyfikatory klikniec zerowane po 120 dniach (atrybucje zgloszen i pakietow, kroki lejka), kroki lejka kasowane po 400 dniach. Codziennie z pg_cron (event-ads-retention-prune, 03:47 UTC), gdy rozszerzenie jest dostepne; inaczej na zadanie (service_role).';
