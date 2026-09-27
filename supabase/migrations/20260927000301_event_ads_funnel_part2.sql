-- CZESC 2/2 MIGRACJI 20260927000300_event_ads_funnel.sql
-- migration-split: part 2/2 of 20260927000300_event_ads_funnel.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 20260927000300_event_ads_funnel.sql,
-- potem 20260927000301_event_ads_funnel_part2.sql .. 20260927000301_event_ads_funnel_part2.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.
-- events-harness: include

-- Zapis wsadowy kosztow: {campaign_id, source: manual|csv, rows: [{day,
-- cost_micros, currency, clicks?, impressions?}]}. Calosc albo nic - zly
-- wiersz odrzuca wsad z numerem wiersza (liczony od 1), a dzien juz zapisany
-- jest nadpisywany (ponowny import tego samego raportu nie dubluje kosztu).
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
      clicks = EXCLUDED.clicks,
      impressions = EXCLUDED.impressions,
      source = EXCLUDED.source;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ad_costs_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ad_costs_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ad_costs_save(jsonb) IS
  'Zapis wsadowy kosztow dziennych kampanii (1-500 wierszy, calosc albo nic, dzien juz zapisany jest nadpisywany). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_ad_cost_delete(p_campaign_id uuid, p_day date)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  DELETE FROM public.event_ad_campaign_costs k
   WHERE k.tenant_id = v_tenant AND k.campaign_id = p_campaign_id AND k.day = p_day;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: cost row does not exist in this tenant';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ad_cost_delete(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ad_cost_delete(uuid, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ad_cost_delete(uuid, date) IS
  'Usuwa koszt jednego dnia kampanii. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 7) PANEL: RAPORT LEJKA
--
-- Okno [p_from, p_to) (NULL = bez granicy). Kroki lejka po `occurred_at`,
-- zgloszenia KOHORTA po dacie zapisu (ile z zapisanych w oknie zaplacilo do
-- dzis), koszt po dniu w strefie wydarzenia. Goscie grupy nie sa osobnymi
-- konwersjami (liczy sie zgloszenie prowadzacego), a przychod liczy sie per
-- ZAMOWIENIE (netto = kwota - zwroty), wiec zamowienie grupy nie dubluje sie.
--
-- Grupa: zmapowana kampania (etykieta) > utm_campaign > id kampanii Google Ads
-- > brak; w grupie rozbicie zrodlo/medium. Zgloszenia BEZ wiersza atrybucji
-- (brak zgody na pomiar albo zapis spoza przegladarki uczestnika: import,
-- zaproszenie, organizator) ida do osobnego `unattributed` - nigdy do
-- mianownika wizyt, ktore licza tylko przegladarki ze zgoda.
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
  touches AS (
    SELECT 'step'::text AS kind, f.step, f.visitor_key, NULL::uuid AS reg_id,
           NULL::text AS payment_status, NULL::uuid AS order_id,
           f.source, f.medium, f.utm_campaign, f.gad_campaign_id
      FROM public.event_funnel_events f
     WHERE f.tenant_id = v_tenant AND f.event_id = p_event_id
       AND (p_from IS NULL OR f.occurred_at >= p_from)
       AND (p_to IS NULL OR f.occurred_at < p_to)
    UNION ALL
    SELECT 'reg', NULL, NULL, r.id, r.payment_status, r.payment_order_id,
           a.source, a.medium, a.utm_campaign, a.gad_campaign_id
      FROM public.event_registrations r
      JOIN public.event_registration_attributions a
        ON a.tenant_id = r.tenant_id AND a.registration_id = r.id
     WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
       AND r.group_lead_registration_id IS NULL
       AND (p_from IS NULL OR r.created_at >= p_from)
       AND (p_to IS NULL OR r.created_at < p_to)
  ),
  keyed AS (
    SELECT t.*,
           CASE
             WHEN m.id IS NOT NULL THEN 'campaign:' || m.id::text
             WHEN t.utm_campaign IS NOT NULL THEN 'utm:' || lower(t.utm_campaign)
             WHEN t.gad_campaign_id IS NOT NULL THEN 'gad:' || t.gad_campaign_id
             ELSE 'none'
           END AS group_key
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
  orders AS (
    SELECT DISTINCT ON (o.id)
           k.group_key, k.source, k.medium, o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS net
      FROM keyed k
      JOIN public.payment_orders o ON o.id = k.order_id AND o.tenant_id = v_tenant
     WHERE k.kind = 'reg' AND k.payment_status IN ('paid', 'partially_refunded', 'refunded')
     ORDER BY o.id, k.reg_id
  ),
  grp AS (
    SELECT k.group_key,
           min(k.utm_campaign) AS utm_campaign,
           min(k.gad_campaign_id) AS gad_campaign_id,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'visit') AS visits,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'registration_start') AS starts,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'checkout_start') AS checkouts,
           count(*) FILTER (WHERE k.kind = 'reg') AS registrations,
           count(*) FILTER (WHERE k.kind = 'reg'
                              AND k.payment_status IN ('paid', 'partially_refunded')) AS paid
      FROM keyed k
     GROUP BY k.group_key
  ),
  chan AS (
    SELECT k.group_key, k.source, k.medium,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'visit') AS visits,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'registration_start') AS starts,
           count(DISTINCT k.visitor_key) FILTER (WHERE k.step = 'checkout_start') AS checkouts,
           count(*) FILTER (WHERE k.kind = 'reg') AS registrations,
           count(*) FILTER (WHERE k.kind = 'reg'
                              AND k.payment_status IN ('paid', 'partially_refunded')) AS paid
      FROM keyed k
     GROUP BY k.group_key, k.source, k.medium
  ),
  cost AS (
    SELECT k.campaign_id, k.currency, sum(k.cost_micros)::bigint AS micros
      FROM public.event_ad_campaign_costs k
     WHERE k.tenant_id = v_tenant AND k.event_id = p_event_id
       AND (v_from_day IS NULL OR k.day >= v_from_day)
       AND (v_to_day IS NULL OR k.day <= v_to_day)
     GROUP BY k.campaign_id, k.currency
  ),
  group_keys AS (
    SELECT g.group_key FROM grp g
    UNION
    SELECT 'campaign:' || co.campaign_id::text FROM cost co
  ),
  unattr AS (
    SELECT r.id, r.payment_status, r.payment_order_id
      FROM public.event_registrations r
     WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
       AND r.group_lead_registration_id IS NULL
       AND (p_from IS NULL OR r.created_at >= p_from)
       AND (p_to IS NULL OR r.created_at < p_to)
       AND NOT EXISTS (
         SELECT 1 FROM public.event_registration_attributions a
          WHERE a.tenant_id = r.tenant_id AND a.registration_id = r.id
       )
  ),
  unattr_orders AS (
    SELECT DISTINCT ON (o.id) o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS net
      FROM unattr u
      JOIN public.payment_orders o ON o.id = u.payment_order_id AND o.tenant_id = v_tenant
     WHERE u.payment_status IN ('paid', 'partially_refunded', 'refunded')
     ORDER BY o.id
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
               'revenue', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('currency', x.currency, 'cents', x.cents)
                                  ORDER BY x.currency)
                   FROM (
                     SELECT o.currency, sum(o.net)::bigint AS cents
                       FROM orders o WHERE o.group_key = gk.group_key
                      GROUP BY o.currency
                   ) x
               ), '[]'::jsonb),
               'cost', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('currency', co.currency, 'micros', co.micros)
                                  ORDER BY co.currency)
                   FROM cost co WHERE 'campaign:' || co.campaign_id::text = gk.group_key
               ), '[]'::jsonb),
               'channels', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'source', ch.source,
                          'medium', ch.medium,
                          'visits', ch.visits,
                          'registration_starts', ch.starts,
                          'checkout_starts', ch.checkouts,
                          'registrations', ch.registrations,
                          'paid', ch.paid,
                          'revenue', COALESCE((
                            SELECT jsonb_agg(jsonb_build_object('currency', y.currency, 'cents', y.cents)
                                             ORDER BY y.currency)
                              FROM (
                                SELECT o.currency, sum(o.net)::bigint AS cents
                                  FROM orders o
                                 WHERE o.group_key = ch.group_key
                                   AND o.source = ch.source AND o.medium = ch.medium
                                 GROUP BY o.currency
                              ) y
                          ), '[]'::jsonb)
                        ) ORDER BY ch.visits DESC, ch.registrations DESC, ch.source, ch.medium)
                   FROM chan ch WHERE ch.group_key = gk.group_key
               ), '[]'::jsonb)
             ) ORDER BY
               CASE
                 WHEN gk.group_key LIKE 'campaign:%' THEN 0
                 WHEN gk.group_key LIKE 'utm:%' THEN 1
                 WHEN gk.group_key LIKE 'gad:%' THEN 2
                 ELSE 3
               END,
               lower(COALESCE(c.label, g.utm_campaign, g.gad_campaign_id, '')),
               gk.group_key)
        FROM group_keys gk
        LEFT JOIN grp g ON g.group_key = gk.group_key
        LEFT JOIN camps c ON 'campaign:' || c.id::text = gk.group_key
    ), '[]'::jsonb),
    'unattributed', jsonb_build_object(
      'registrations', (SELECT count(*) FROM unattr),
      'paid', (SELECT count(*) FROM unattr u WHERE u.payment_status IN ('paid', 'partially_refunded')),
      'revenue', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', z.currency, 'cents', z.cents) ORDER BY z.currency)
          FROM (SELECT uo.currency, sum(uo.net)::bigint AS cents FROM unattr_orders uo GROUP BY uo.currency) z
      ), '[]'::jsonb)
    ),
    'totals', jsonb_build_object(
      'visits', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'visit'),
      'registration_starts', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'registration_start'),
      'checkout_starts', (SELECT count(DISTINCT k.visitor_key) FROM keyed k WHERE k.step = 'checkout_start'),
      'attributed_registrations', (SELECT count(*) FROM keyed k WHERE k.kind = 'reg'),
      'registrations', (SELECT count(*) FROM keyed k WHERE k.kind = 'reg') + (SELECT count(*) FROM unattr),
      'paid', (SELECT count(*) FROM keyed k
                WHERE k.kind = 'reg' AND k.payment_status IN ('paid', 'partially_refunded'))
              + (SELECT count(*) FROM unattr u WHERE u.payment_status IN ('paid', 'partially_refunded')),
      'revenue', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', w.currency, 'cents', w.cents) ORDER BY w.currency)
          FROM (
            SELECT v.currency, sum(v.net)::bigint AS cents
              FROM (SELECT o.currency, o.net FROM orders o
                    UNION ALL
                    SELECT uo.currency, uo.net FROM unattr_orders uo) v
             GROUP BY v.currency
          ) w
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
  'Lejek sprzedazy wydarzenia per kampania (zmapowana > utm_campaign > id kampanii Google Ads > brak) z rozbiciem zrodlo/medium: wizyty, rozpoczecia zapisu i platnosci, zgloszenia (kohorta po dacie zapisu), oplacone, przychod netto per waluta (per zamowienie), koszt; osobno zgloszenia bez atrybucji i sumy. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 8) PANEL: EKSPORT KONWERSJI OFFLINE (Google Ads, import klikniec)
--
-- Tylko OPLACONE zgloszenia z identyfikatorem klikniecia zebranym przy zgodzie
-- reklamowej, klikniecie mlodsze niz 90 dni (termin importu Google Ads)
-- i platnosc PO kliknieciu. Czas konwersji w strefie wydarzenia (plik niesie
-- naglowek `Parameters:TimeZone=<strefa>`), wartosc netto zamowienia.
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
    SELECT DISTINCT ON (o.id)
           r.id AS registration_id, o.id AS order_id, o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS net,
           COALESCE(o.paid_at, r.paid_at) AS converted_at,
           a.registration_id IS NOT NULL AS attributed,
           a.click_id_type, a.click_id, a.click_at, a.click_pruned_at,
           a.ad_user_data, a.ad_personalization, a.utm_campaign, a.gad_campaign_id
      FROM public.event_registrations r
      JOIN public.payment_orders o ON o.id = r.payment_order_id AND o.tenant_id = v_tenant
      LEFT JOIN public.event_registration_attributions a
        ON a.tenant_id = r.tenant_id AND a.registration_id = r.id
     WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
       AND r.group_lead_registration_id IS NULL
       AND r.payment_status IN ('paid', 'partially_refunded')
       AND COALESCE(o.paid_at, r.paid_at) IS NOT NULL
       AND (p_from IS NULL OR COALESCE(o.paid_at, r.paid_at) >= p_from)
       AND (p_to IS NULL OR COALESCE(o.paid_at, r.paid_at) < p_to)
     ORDER BY o.id, r.created_at
  ),
  eligible AS (
    SELECT p.*,
           (SELECT c.conversion_action_name
              FROM public.event_ad_campaigns c
             WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id
               AND ((c.match_kind = 'google_ads_campaign_id' AND c.match_value = p.gad_campaign_id)
                 OR (c.match_kind = 'utm_campaign' AND c.match_value = lower(p.utm_campaign)))
             ORDER BY (c.match_kind = 'google_ads_campaign_id') DESC, c.id
             LIMIT 1) AS conversion_action_name
      FROM paid p
     WHERE p.click_id IS NOT NULL
       AND p.ad_user_data
       AND p.click_at > now() - interval '90 days'
       AND p.converted_at >= p.click_at
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
      'unattributed', (SELECT count(*) FROM paid p WHERE NOT p.attributed),
      'no_click', (SELECT count(*) FROM paid p
                    WHERE p.attributed AND p.click_id IS NULL AND p.click_pruned_at IS NULL),
      'expired', (SELECT count(*) FROM paid p
                   WHERE p.click_pruned_at IS NOT NULL
                      OR (p.click_id IS NOT NULL AND p.click_at <= now() - interval '90 days')),
      'before_click', (SELECT count(*) FROM paid p
                        WHERE p.click_id IS NOT NULL AND p.click_at > now() - interval '90 days'
                          AND p.converted_at < p.click_at)
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ads_conversions_export(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ads_conversions_export(uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ads_conversions_export(uuid, timestamptz, timestamptz) IS
  'Wiersze do importu konwersji offline Google Ads (klikniecia): oplacone zgloszenia z identyfikatorem klikniecia przy zgodzie reklamowej, klikniecie mlodsze niz 90 dni, platnosc po kliknieciu; czas w strefie wydarzenia, wartosc netto zamowienia, nazwa konwersji z kampanii; plus liczniki pominietych. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 9) RETENCJA
--
-- Identyfikator klikniecia jest potrzebny tylko do importu (maks. 90 dni od
-- klikniecia) - po 120 dniach go zerujemy w obu tabelach (dotkniecia w
-- atrybucji tracza klucze klikniecia). Surowe kroki lejka (pseudonimowe)
-- kasujemy po 400 dniach (13 miesiecy raportowania + zapas).
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

  UPDATE public.event_funnel_events f SET
    click_id = NULL,
    click_id_type = NULL
  WHERE f.click_id IS NOT NULL AND f.occurred_at < now() - interval '120 days';
  GET DIAGNOSTICS v_clicks_steps = ROW_COUNT;

  DELETE FROM public.event_funnel_events f WHERE f.occurred_at < now() - interval '400 days';
  GET DIAGNOSTICS v_steps = ROW_COUNT;

  RETURN jsonb_build_object(
    'attribution_clicks_cleared', v_clicks_attr,
    'funnel_clicks_cleared', v_clicks_steps,
    'funnel_steps_deleted', v_steps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_ads_retention_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_ads_retention_prune() TO service_role;

COMMENT ON FUNCTION public.event_ads_retention_prune() IS
  'Retencja lejka reklam: identyfikatory klikniec zerowane po 120 dniach (atrybucje i kroki lejka), kroki lejka kasowane po 400 dniach. Codziennie z pg_cron (event-ads-retention-prune, 03:47 UTC), gdy rozszerzenie jest dostepne; inaczej na zadanie (service_role).';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('event-ads-retention-prune', '47 3 * * *',
      'SELECT public.event_ads_retention_prune()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - event ads retention runs only on demand';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;
