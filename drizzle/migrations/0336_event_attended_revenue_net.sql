-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S4, 7/8): OBECNOŚĆ NA WYDARZENIU NA SZYNIE + JEDNO
-- ŹRÓDŁO PRZYCHODU NETTO WYDARZENIA (`_event_revenue_net`).
--
-- DEFEKT
--   1. Obecność (`event_registrations.attended_at` - skan na bramce, ręczne
--      odhaczenie, dołączenie do transmisji) nie ma zdarzenia: hub
--      (Społeczność: frekwencja, no-show) i ścieżki S5 („podziękuj za udział",
--      „nie przyszedł - nagranie") nie wiedzą, że ktoś był.
--   2. Przychód netto wydarzenia liczyło wyłącznie ciało
--      `admin_event_ads_funnel` (CTE `lead_orders` + `rev`). Przekrój
--      wydarzeń huba musiałby skopiować tę regułę (zamówienia z karty
--      prowadzącego i gości, zwroty Stripe i ręczne, pakiety, pula planu) -
--      a dwie kopie reguły pieniędzy rozjeżdżają się przy pierwszej poprawce.
--
-- ZMIANA
--   A. `tg_event_registrations_attended_emit()` - AFTER INSERT OR UPDATE OF
--      attended_at: `event.registration.attended.v1` {event_id,
--      registration_id, person_id} raz, przy pierwszym ustawieniu
--      `attended_at` (także przy zgłoszeniu założonym od razu jako obecne -
--      wejście z bramki bez rejestracji). Aktor wytłumiony (skaner nie jest
--      „autorem" obecności). Awaria emisji nie przerywa zapisu.
--   B. `_event_revenue_net(p_tenant, p_event_id, p_since, p_until)` -
--      wewnętrzna (bez EXECUTE dla ról API) funkcja SQL: wiersz na
--      ZAMÓWIENIE (`kind` reg|pkg, `conv_id`, `order_id`, `currency`,
--      `net_minor`), kohorta po dacie zgłoszenia/zamówienia pakietu
--      w `[p_since, p_until)` (NULL = bez granicy). Treść = dotychczasowe CTE
--      `leads`/`pkgs`/`lead_orders`/`rev` z 20260927001100 słowo w słowo.
--   C. `admin_event_ads_funnel` (CIALO-Z niżej) bierze `rev` z funkcji B;
--      reszta ciała bez zmian - wynik BIT W BIT jak przed zmianą (pgTAP
--      porównuje z kopią starego ciała na fiksturze; events-harness
--      `28_ads_funnel*.sql` bez zmian oczekiwań).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20260927001100 (lejek reklam) i po I0
-- (`_log_emit_error`, typ `event.registration.attended.v1` w katalogu TS).
-- Przed 20261020130700 (przekrój wydarzeń huba woła funkcję B).
-- `event_registrations` to gorąca tabela w dniu wydarzenia (bramka) -
-- `lock_timeout` 5 s na CREATE TRIGGER, ponowienie pliku przy 55P03.
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP TRIGGER IF EXISTS + CREATE TRIGGER,
-- bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/event_attended_revenue_net_test.sql (zdarzenie raz,
-- bez emisji przy zmianie innej kolumny, lejek bit w bit z kopią starego
-- ciała, funkcja B bez EXECUTE dla authenticated); scripts/events-harness
-- (migracja wciągana po treści, asercje lejka reklam).
-- events-harness: include
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Obecność na szynie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_event_registrations_attended_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Tylko pierwsze ustawienie obecności; zmiana innej kolumny albo
  -- poprawka znacznika czasu nie jest drugim przyjściem.
  IF NEW.attended_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.attended_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'event_registration', NEW.id::text, 'event.registration.attended.v1',
    jsonb_build_object(
      'event_id', NEW.event_id,
      'registration_id', NEW.id,
      'person_id', NEW.person_id
    ),
    NULL,
    p_suppress_actor => true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_event_registrations_attended_emit', 'event.registration.attended.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_event_registrations_attended_emit() FROM PUBLIC, anon, authenticated, service_role;

SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_event_registrations_attended_emit ON public.event_registrations;
CREATE TRIGGER trg_event_registrations_attended_emit
  AFTER INSERT OR UPDATE OF attended_at ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_registrations_attended_emit();
RESET lock_timeout;

-- ----------------------------------------------------------------------------
-- B) Przychód netto wydarzenia - wiersz na zamówienie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_revenue_net(
  p_tenant uuid,
  p_event_id uuid,
  p_since timestamptz,
  p_until timestamptz
)
RETURNS TABLE (kind text, conv_id uuid, order_id uuid, currency text, net_minor bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  -- Konwersje prowadzących z kohorty (bez gości grupy i bez miejsc pakietu -
  -- pakiet sam jest konwersją).
  WITH leads AS (
    SELECT r.id, r.payment_status, r.payment_order_id
      FROM public.event_registrations r
     WHERE r.tenant_id = p_tenant AND r.event_id = p_event_id
       AND r.group_lead_registration_id IS NULL
       AND r.source IS DISTINCT FROM 'package_invitation'
       AND NOT EXISTS (
         SELECT 1 FROM public.event_package_seats s
          WHERE s.tenant_id = r.tenant_id AND s.registration_id = r.id
       )
       AND (p_since IS NULL OR r.created_at >= p_since)
       AND (p_until IS NULL OR r.created_at < p_until)
  ),
  pkgs AS (
    SELECT po.id, po.currency, po.amount_cents
      FROM public.event_package_orders po
     WHERE po.tenant_id = p_tenant AND po.event_id = p_event_id
       AND po.status = 'paid'
       AND (p_since IS NULL OR po.created_at >= p_since)
       AND (p_until IS NULL OR po.created_at < p_until)
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
      JOIN public.payment_orders o ON o.id = l.payment_order_id AND o.tenant_id = p_tenant
     WHERE l.payment_status IN ('paid', 'partially_refunded')
       AND o.status::text IN ('paid', 'refunded')
    UNION ALL
    SELECT l.id, o.id, o.currency,
           GREATEST(o.amount_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint
      FROM leads l
      JOIN public.event_registrations g
        ON g.tenant_id = p_tenant AND g.group_lead_registration_id = l.id
      JOIN public.payment_orders o ON o.id = g.payment_order_id AND o.tenant_id = p_tenant
     WHERE g.payment_status IN ('paid', 'partially_refunded')
       AND o.status::text IN ('paid', 'refunded')
       AND g.payment_order_id IS DISTINCT FROM l.payment_order_id
  )
  -- Jeden wiersz na zamowienie (zamowienie grupy nie dubluje sie).
  SELECT DISTINCT ON (x.order_id) x.kind, x.conv_id, x.order_id, x.currency, x.net
    FROM (
      SELECT 'reg'::text AS kind, lo.conv_id, lo.order_id, lo.currency, lo.net
        FROM lead_orders lo
      UNION ALL
      SELECT 'pkg', p.id, p.id, p.currency, p.amount_cents::bigint
        FROM pkgs p
    ) x
   ORDER BY x.order_id, x.conv_id
$$;

REVOKE ALL ON FUNCTION public._event_revenue_net(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._event_revenue_net(uuid, uuid, timestamptz, timestamptz) IS
  'Hub S4: przychód netto wydarzenia, wiersz na zamówienie (reg: zamówienia z karty prowadzącego i gości paid/refunded minus zwroty; pkg: opłacone pakiety), kohorta po dacie zgłoszenia/zamówienia. Jedno źródło dla admin_event_ads_funnel i przekroju wydarzeń huba. Wewnętrzna - bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- C) Lejek reklam wydarzenia - przychód z funkcji B, reszta bez zmian.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20260927001100
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
  -- Przychod per ZAMOWIENIE z jednego zrodla (`_event_revenue_net`, S4) -
  -- te same zamowienia, kwoty netto i DISTINCT ON co dotad w tym ciele
  -- (zamowienia z karty prowadzacego i jego gosci + oplacone pakiety);
  -- przekroj wydarzen huba liczy z tej samej funkcji, wiec suma przekroju
  -- = suma raportow per wydarzenie.
  rev AS (
    SELECT n.kind, n.conv_id, n.currency, n.net_minor AS net
      FROM public._event_revenue_net(v_tenant, p_event_id, p_from, p_to) n
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
  'Lejek sprzedazy wydarzenia per kampania (zmapowana > utm_campaign > id kampanii Google Ads > pozostale ponad 50 najliczniejszych > brak) z rozbiciem zrodlo/medium: wizyty, rozpoczecia zapisu i platnosci, konwersje (zgloszenia prowadzacych i zamowienia pakietow, kohorta po dacie zapisu), oplacone, przychod netto per waluta (per zamowienie zaplacone, z _event_revenue_net), koszt; osobno konwersje bez atrybucji i sumy. Bramka: assert_event_admin_tenant().';
