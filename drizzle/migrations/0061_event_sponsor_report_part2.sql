-- CZESC 2/2 MIGRACJI 0061_event_sponsor_report.sql
-- migration-split: part 2/2 of 0061_event_sponsor_report.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 0061_event_sponsor_report.sql,
-- potem 0061_event_sponsor_report_part2.sql .. 0061_event_sponsor_report_part2.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.

-- ----------------------------------------------------------------------------
-- 9) LINK DLA SPONSORA: WYDANIE, LISTA, ODWOLANIE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_link_issue(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_sponsor_id uuid := NULLIF(COALESCE(p_payload->>'sponsor_id', ''), '')::uuid;
  v_label text := btrim(COALESCE(p_payload->>'label', ''));
  v_expires timestamptz := NULLIF(COALESCE(p_payload->>'expires_at', ''), '')::timestamptz;
  v_include boolean := COALESCE((p_payload->>'include_leads')::boolean, false);
  v_sponsor public.event_sponsors%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_token text;
  v_prefix text;
  v_id uuid;
BEGIN
  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: sponsor_id is required';
  END IF;

  SELECT s.* INTO v_sponsor
    FROM public.event_sponsors s
   WHERE s.tenant_id = v_tenant AND s.id = v_sponsor_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sponsor_not_found: the sponsor does not exist in this tenant';
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_sponsor.event_id;

  IF char_length(v_label) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'invalid_label: the label must have 2 to 120 characters';
  END IF;

  IF v_expires IS NULL THEN
    v_expires := LEAST(
      GREATEST(COALESCE(v_event.ends_at, v_event.starts_at) + interval '60 days', now() + interval '7 days'),
      now() + interval '180 days'
    );
  END IF;
  IF v_expires <= now() OR v_expires > now() + interval '180 days' THEN
    RAISE EXCEPTION 'invalid_expiry: the link must expire within 180 days';
  END IF;

  IF (
    SELECT count(*) FROM public.event_sponsor_report_links k
     WHERE k.tenant_id = v_tenant AND k.sponsor_id = v_sponsor_id
       AND k.revoked_at IS NULL AND k.expires_at > now()
  ) >= 10 THEN
    RAISE EXCEPTION 'too_many_links: a sponsor may have at most 10 active links';
  END IF;

  v_token := public._event_new_qr_token();
  v_prefix := left(v_token, 8);

  INSERT INTO public.event_sponsor_report_links (
    tenant_id, event_id, sponsor_id, label, token_hash, token_prefix,
    include_leads, expires_at, created_by
  ) VALUES (
    v_tenant, v_sponsor.event_id, v_sponsor_id, v_label,
    encode(digest(v_token, 'sha256'), 'hex'), v_prefix,
    v_include, v_expires, auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tenant,
    auth.uid(),
    'event.sponsor_report.link_issued',
    'crm_company',
    v_sponsor.company_id,
    jsonb_build_object(
      'event_id', v_event.id,
      'event_slug', v_event.slug,
      'event_title_pl', v_event.title_pl,
      'event_title_en', v_event.title_en,
      'summary_pl', format(
        U&'Udost\0119pniono raport sponsora "%s" (%s): link %s, wa\017Cny do %s',
        v_event.title_pl, v_label, v_prefix, to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      ),
      'summary_en', format(
        'Sponsor report shared "%s" (%s): link %s, valid until %s',
        v_event.title_en, v_label, v_prefix, to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      ),
      'sponsor_id', v_sponsor_id,
      'link_id', v_id,
      'token_prefix', v_prefix,
      'include_leads', v_include,
      'expires_at', v_expires
    )
  );

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_sponsor_report_link',
    v_id::text,
    'event_sponsor_report_link.issued.v1',
    jsonb_build_object('event_id', v_sponsor.event_id, 'sponsor_id', v_sponsor_id, 'link_id', v_id),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'sponsor_id', v_sponsor_id,
    'token', v_token,
    'token_prefix', v_prefix,
    'expires_at', v_expires,
    'include_leads', v_include
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_report_link_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_report_link_issue(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_report_link_issue(jsonb) IS
  'Wydanie linku raportu dla sponsora: {sponsor_id, label, expires_at?, include_leads?}. TOKEN JAWNY WRACA DOKLADNIE RAZ; w bazie tylko sha256 i prefiks. Waznosc maks. 180 dni, maks. 10 aktywnych linkow na sponsora. Wpis audit_log na firmie sponsora (os czasu CRM). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_links_list(
  p_event_id uuid,
  p_sponsor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  sponsor_id uuid,
  sponsor_name text,
  label text,
  token_prefix text,
  include_leads boolean,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  view_count integer,
  created_at timestamptz,
  is_active boolean
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
  SELECT k.id, k.sponsor_id, s.snapshot_name, k.label, k.token_prefix, k.include_leads,
         k.expires_at, k.revoked_at, k.last_seen_at, k.view_count, k.created_at,
         (k.revoked_at IS NULL AND k.expires_at > now())
    FROM public.event_sponsor_report_links k
    JOIN public.event_sponsors s ON s.tenant_id = k.tenant_id AND s.id = k.sponsor_id
   WHERE k.tenant_id = v_tenant AND k.event_id = p_event_id
     AND (p_sponsor_id IS NULL OR k.sponsor_id = p_sponsor_id)
   ORDER BY k.created_at DESC
   LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_report_links_list(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_report_links_list(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_report_links_list(uuid, uuid) IS
  'Linki raportu sponsorow wydarzenia (bez skrotu tokenu): prefiks, waznosc, odwolanie, otwarcia. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_report_link_revoke(p_link_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_link public.event_sponsor_report_links%ROWTYPE;
  v_sponsor public.event_sponsors%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  SELECT k.* INTO v_link
    FROM public.event_sponsor_report_links k
   WHERE k.tenant_id = v_tenant AND k.id = p_link_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: the link does not exist in this tenant';
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.event_sponsor_report_links k
     SET revoked_at = now(), revoked_by = auth.uid()
   WHERE k.tenant_id = v_tenant AND k.id = p_link_id;

  SELECT s.* INTO v_sponsor
    FROM public.event_sponsors s
   WHERE s.tenant_id = v_tenant AND s.id = v_link.sponsor_id;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_link.event_id;

  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tenant,
    auth.uid(),
    'event.sponsor_report.link_revoked',
    'crm_company',
    v_sponsor.company_id,
    jsonb_build_object(
      'event_id', v_event.id,
      'event_slug', v_event.slug,
      'event_title_pl', v_event.title_pl,
      'event_title_en', v_event.title_en,
      'summary_pl', format(
        U&'Odwo\0142ano link do raportu sponsora "%s" (%s): link %s',
        v_event.title_pl, v_link.label, v_link.token_prefix
      ),
      'summary_en', format(
        'Sponsor report link revoked "%s" (%s): link %s',
        v_event.title_en, v_link.label, v_link.token_prefix
      ),
      'sponsor_id', v_link.sponsor_id,
      'link_id', v_link.id,
      'token_prefix', v_link.token_prefix
    )
  );

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_sponsor_report_link',
    v_link.id::text,
    'event_sponsor_report_link.revoked.v1',
    jsonb_build_object('event_id', v_link.event_id, 'sponsor_id', v_link.sponsor_id, 'link_id', v_link.id),
    auth.uid()
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_report_link_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_report_link_revoke(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_report_link_revoke(uuid) IS
  'Odwolanie linku raportu sponsora (idempotentne: drugie odwolanie zwraca false bez zmian). Wpis audit_log na firmie sponsora. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 10) ODCZYT RAPORTU PO TOKENIE (service_role; server fn z limitem po IP)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_sponsor_report_for_token(p_tenant uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_link public.event_sponsor_report_links%ROWTYPE;
  v_sponsor public.event_sponsors%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tier public.event_sponsor_tiers%ROWTYPE;
  v_totals jsonb;
  v_leads_summary jsonb;
  v_meetings jsonb;
  v_placements jsonb;
  v_series jsonb;
  v_leads jsonb;
BEGIN
  IF p_tenant IS NULL OR v_token !~ '^[A-Za-z0-9_-]{32}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT k.* INTO v_link
    FROM public.event_sponsor_report_links k
   WHERE k.tenant_id = p_tenant
     AND k.token_hash = encode(digest(v_token, 'sha256'), 'hex');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_link.revoked_at IS NOT NULL OR v_link.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  UPDATE public.event_sponsor_report_links k
     SET view_count = k.view_count + 1, last_seen_at = now()
   WHERE k.tenant_id = p_tenant AND k.id = v_link.id;

  SELECT s.* INTO v_sponsor
    FROM public.event_sponsors s
   WHERE s.tenant_id = p_tenant AND s.id = v_link.sponsor_id;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = p_tenant AND e.id = v_link.event_id;
  SELECT t.* INTO v_tier
    FROM public.event_sponsor_tiers t
   WHERE t.tenant_id = p_tenant AND t.id = v_sponsor.tier_id;

  SELECT jsonb_build_object(
           'views_unique', count(*) FILTER (WHERE x.kind = 'view'),
           'views_total', COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'view'), 0),
           'clicks_unique', count(*) FILTER (WHERE x.kind = 'click'),
           'clicks_total', COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'click'), 0),
           'material_opens', count(*) FILTER (WHERE x.kind = 'material_open')
         )
    INTO v_totals
    FROM public.event_sponsor_exposures x
   WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id;

  SELECT jsonb_build_object(
           'leads_total', count(*),
           'leads_consented', count(*) FILTER (
             WHERE p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL),
           'lead_scans_total', COALESCE(sum(l.scan_count), 0)
         )
    INTO v_leads_summary
    FROM public.event_lead_scans l
    JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
   WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id;

  -- Te same definicje, co w `admin_event_sponsor_report_summary`
  -- (umowione = accepted/held/no_show; stary wiersz przelozenia sie nie liczy).
  SELECT jsonb_build_object(
           'meetings_total', count(*) FILTER (WHERE m.status NOT IN ('cancelled', 'rescheduled')),
           'meetings_accepted', count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show')),
           'meetings_held', count(*) FILTER (WHERE m.status = 'held')
         )
    INTO v_meetings
    FROM public.event_meetings m
   WHERE m.tenant_id = p_tenant AND m.event_id = v_link.event_id AND m.sponsor_id = v_link.sponsor_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'placement', g.placement,
           'views_unique', g.vu, 'views_total', g.vt,
           'clicks_unique', g.cu, 'clicks_total', g.ct,
           'material_opens', g.mo
         ) ORDER BY g.placement), '[]'::jsonb)
    INTO v_placements
    FROM (
      SELECT x.placement,
             count(*) FILTER (WHERE x.kind = 'view') AS vu,
             COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'view'), 0) AS vt,
             count(*) FILTER (WHERE x.kind = 'click') AS cu,
             COALESCE(sum(x.hits) FILTER (WHERE x.kind = 'click'), 0) AS ct,
             count(*) FILTER (WHERE x.kind = 'material_open') AS mo
        FROM public.event_sponsor_exposures x
       WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id
       GROUP BY x.placement
    ) g;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', d.dday,
           'views_unique', COALESCE(ev.vu, 0),
           'clicks_unique', COALESCE(ev.cu, 0),
           'material_opens', COALESCE(ev.mo, 0),
           'leads_new', COALESCE(ls.n, 0)
         ) ORDER BY d.dday), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT x.day AS dday
        FROM public.event_sponsor_exposures x
       WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id
      UNION
      SELECT (l.first_scanned_at AT TIME ZONE v_event.timezone)::date
        FROM public.event_lead_scans l
       WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id
    ) d
    LEFT JOIN (
      SELECT x.day AS dday,
             count(*) FILTER (WHERE x.kind = 'view') AS vu,
             count(*) FILTER (WHERE x.kind = 'click') AS cu,
             count(*) FILTER (WHERE x.kind = 'material_open') AS mo
        FROM public.event_sponsor_exposures x
       WHERE x.tenant_id = p_tenant AND x.event_id = v_link.event_id AND x.sponsor_id = v_link.sponsor_id
       GROUP BY x.day
    ) ev ON ev.dday = d.dday
    LEFT JOIN (
      SELECT (l.first_scanned_at AT TIME ZONE v_event.timezone)::date AS dday, count(*) AS n
        FROM public.event_lead_scans l
       WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id
       GROUP BY 1
    ) ls ON ls.dday = d.dday;

  IF v_link.include_leads THEN
    -- Wiersz BEZ zywej zgody na przekazanie partnerowi nie niesie danych
    -- osobowych w ogole: link wychodzi poza system, wiec zostaje sam licznik
    -- skanu z notatka i ocena obslugi stoiska (to dane sponsora).
    SELECT COALESCE(jsonb_agg(q.row_json ORDER BY q.last_scanned_at DESC), '[]'::jsonb)
      INTO v_leads
      FROM (
        SELECT l.last_scanned_at,
               jsonb_build_object(
                 'sponsor_name', v_sponsor.snapshot_name,
                 'first_name', CASE WHEN c.ok THEN p.first_name END,
                 'last_name', CASE WHEN c.ok THEN p.last_name END,
                 'company', CASE WHEN c.ok THEN COALESCE(NULLIF(btrim(p.company_text), ''), co.name) END,
                 'job_title', CASE WHEN c.ok THEN p.job_title END,
                 'email', CASE WHEN c.ok THEN p.email END,
                 'phone', CASE WHEN c.ok THEN p.phone END,
                 'consent', c.ok,
                 'consent_snapshot_at', l.consent_snapshot_at,
                 'interest_rating', l.interest_rating,
                 'note', l.note,
                 'scan_count', l.scan_count,
                 'first_scanned_at', l.first_scanned_at,
                 'last_scanned_at', l.last_scanned_at,
                 'device_label', d.label
               ) AS row_json
          FROM public.event_lead_scans l
          JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
          CROSS JOIN LATERAL (
            SELECT (p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL) AS ok
          ) c
          LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
          LEFT JOIN public.event_scanner_devices d ON d.tenant_id = l.tenant_id AND d.id = l.device_id
         WHERE l.tenant_id = p_tenant AND l.event_id = v_link.event_id AND l.sponsor_id = v_link.sponsor_id
         ORDER BY l.last_scanned_at DESC
         LIMIT 5000
      ) q;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'event', jsonb_build_object(
      'slug', v_event.slug,
      'title_pl', v_event.title_pl,
      'title_en', v_event.title_en,
      'timezone', v_event.timezone,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at
    ),
    'sponsor', jsonb_build_object(
      'id', v_sponsor.id,
      'name', v_sponsor.snapshot_name,
      'logo_url', v_sponsor.snapshot_logo_url,
      'role', v_sponsor.role,
      'tier_name_pl', v_tier.name_pl,
      'tier_name_en', v_tier.name_en
    ),
    'link', jsonb_build_object(
      'label', v_link.label,
      'expires_at', v_link.expires_at,
      'include_leads', v_link.include_leads
    ),
    'totals', v_totals || v_leads_summary || v_meetings,
    'placements', v_placements,
    'series', v_series,
    'leads', v_leads
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_sponsor_report_for_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_sponsor_report_for_token(uuid, text) TO service_role;

COMMENT ON FUNCTION public.event_sponsor_report_for_token(uuid, text) IS
  'Raport sponsora po tokenie linku: {ok:false, reason:not_found|expired} albo {ok:true, event, sponsor, link, totals, placements, series, leads}. Wylacznie service_role - najemca z zaufanego hosta, limit prob po IP po stronie serwera. Podbija view_count i last_seen_at. Kontakt tylko przy zywej zgodzie na przekazanie partnerowi.';

-- ----------------------------------------------------------------------------
-- 11) CRM: HISTORIA SPONSORINGU FIRMY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_company_sponsorships(p_company_id uuid)
RETURNS TABLE (
  event_id uuid,
  event_slug text,
  event_title_pl text,
  event_title_en text,
  event_starts_at timestamptz,
  event_timezone text,
  event_status text,
  sponsor_id uuid,
  role text,
  tier_name_pl text,
  tier_name_en text,
  is_published boolean,
  views_unique integer,
  clicks_unique integer,
  material_opens integer,
  leads_total integer,
  leads_consented integer,
  meetings_held integer,
  active_links integer
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
  SELECT e.id, e.slug, e.title_pl, e.title_en, e.starts_at, e.timezone, e.status,
         s.id, s.role, t.name_pl, t.name_en, s.is_published,
         (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.sponsor_id = s.id AND x.kind = 'view')::integer,
         (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.sponsor_id = s.id AND x.kind = 'click')::integer,
         (SELECT count(*) FROM public.event_sponsor_exposures x
           WHERE x.tenant_id = v_tenant AND x.sponsor_id = s.id AND x.kind = 'material_open')::integer,
         (SELECT count(*) FROM public.event_lead_scans l
           WHERE l.tenant_id = v_tenant AND l.sponsor_id = s.id)::integer,
         (SELECT count(*) FROM public.event_lead_scans l
            JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
           WHERE l.tenant_id = v_tenant AND l.sponsor_id = s.id
             AND p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL)::integer,
         (SELECT count(*) FROM public.event_meetings m
           WHERE m.tenant_id = v_tenant AND m.sponsor_id = s.id AND m.status = 'held')::integer,
         (SELECT count(*) FROM public.event_sponsor_report_links k
           WHERE k.tenant_id = v_tenant AND k.sponsor_id = s.id
             AND k.revoked_at IS NULL AND k.expires_at > now())::integer
    FROM public.event_sponsors s
    JOIN public.events e ON e.tenant_id = s.tenant_id AND e.id = s.event_id
    LEFT JOIN public.event_sponsor_tiers t ON t.tenant_id = s.tenant_id AND t.id = s.tier_id
   WHERE s.tenant_id = v_tenant AND s.company_id = p_company_id
   ORDER BY e.starts_at DESC, e.id
   LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_company_sponsorships(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_company_sponsorships(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_company_sponsorships(uuid) IS
  'Historia sponsoringu firmy z CRM na wydarzeniach najemcy z metrykami raportu (wyswietlenia, klikniecia, otwarcia materialow, kontakty, spotkania, aktywne linki). Bramka: assert_event_admin_tenant() - redaktor CRM dostaje forbidden.';

-- ----------------------------------------------------------------------------
-- 12) CRM: PRZENIESIENIE ZEBRANYCH KONTAKTOW (jawna akcja organizatora)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_lead_scans_push_to_crm(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(COALESCE(p_payload->>'event_id', ''), '')::uuid;
  v_sponsor_id uuid := NULLIF(COALESCE(p_payload->>'sponsor_id', ''), '')::uuid;
  -- Strona: kursor (ostatnia osoba poprzedniej strony) i rozmiar 1..500.
  v_after uuid := NULLIF(COALESCE(p_payload->>'after_person_id', ''), '')::uuid;
  v_limit integer := CASE
    WHEN jsonb_typeof(p_payload->'limit') = 'number'
      THEN LEAST(500, GREATEST(1, floor((p_payload->>'limit')::numeric)))::integer
    ELSE 500
  END;
  v_last uuid;
  v_has_more boolean := false;
  v_event public.events%ROWTYPE;
  v_label text;
  r record;
  v_email text;
  v_consent boolean;
  v_existing boolean;
  v_prev public.event_person_crm_links%ROWTYPE;
  v_lead uuid;
  v_status text;
  v_reason text;
  v_persons integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_no_email integer := 0;
  v_no_consent integer := 0;
  v_failed integer := 0;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  IF v_sponsor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sponsors s
     WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id AND s.id = v_sponsor_id
  ) THEN
    RAISE EXCEPTION 'sponsor_not_found: the sponsor does not exist in this event';
  END IF;

  v_label := 'event:' || v_event.slug || ':sponsor_lead';

  FOR r IN
    SELECT l.person_id,
           array_agg(DISTINCT s.company_id ORDER BY s.company_id) AS company_ids,
           array_agg(DISTINCT s.id ORDER BY s.id) AS sponsor_ids,
           string_agg(DISTINCT s.snapshot_name, ', ' ORDER BY s.snapshot_name) AS sponsor_names
      FROM public.event_lead_scans l
      JOIN public.event_sponsors s ON s.tenant_id = l.tenant_id AND s.id = l.sponsor_id
     WHERE l.tenant_id = v_tenant AND l.event_id = v_event_id
       AND (v_sponsor_id IS NULL OR l.sponsor_id = v_sponsor_id)
       AND (v_after IS NULL OR l.person_id > v_after)
     GROUP BY l.person_id
     ORDER BY l.person_id
     LIMIT v_limit
  LOOP
    v_persons := v_persons + 1;
    v_last := r.person_id;

    SELECT lower(NULLIF(btrim(COALESCE(p.email, '')), '')),
           (p.consent_marketing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL)
      INTO v_email, v_consent
      FROM public.event_people p
     WHERE p.tenant_id = v_tenant AND p.id = r.person_id;

    v_existing := v_email IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.crm_leads c WHERE c.tenant_id = v_tenant AND c.email_norm = v_email
    );

    -- Ponowne przeniesienie tej samej osoby nie zasmieca osi czasu CRM:
    -- wpis audytu idzie tylko przy pierwszym udanym przeniesieniu z tej
    -- etykiety (albo po wczesniejszej porazce).
    SELECT k.* INTO v_prev
      FROM public.event_person_crm_links k
     WHERE k.tenant_id = v_tenant AND k.person_id = r.person_id;

    v_lead := public._event_person_crm_sync(
      v_tenant,
      r.person_id,
      'event_participant',
      v_label,
      ARRAY['event:' || v_event.slug]
        || ARRAY(SELECT 'sponsor_lead:' || c::text FROM unnest(r.company_ids) AS c),
      '{}'::jsonb,
      COALESCE(v_consent, false),
      CASE
        WHEN v_prev.sync_status = 'ok' AND v_prev.last_source_label = v_label THEN NULL
        ELSE 'event.sponsor_lead.pushed'
      END,
      jsonb_build_object(
        'event_id', v_event.id,
        'event_slug', v_event.slug,
        'event_title_pl', v_event.title_pl,
        'event_title_en', v_event.title_en,
        'summary_pl', format(
          U&'Kontakt zebrany na stoisku (%s) podczas wydarzenia "%s" przeniesiony do CRM',
          r.sponsor_names, v_event.title_pl
        ),
        'summary_en', format(
          'Contact collected at the booth (%s) during "%s" moved to CRM',
          r.sponsor_names, v_event.title_en
        ),
        'sponsor_ids', to_jsonb(r.sponsor_ids)
      )
    );

    IF v_lead IS NOT NULL THEN
      IF v_existing THEN
        v_updated := v_updated + 1;
      ELSE
        v_created := v_created + 1;
      END IF;
    ELSE
      SELECT k.sync_status, k.last_error INTO v_status, v_reason
        FROM public.event_person_crm_links k
       WHERE k.tenant_id = v_tenant AND k.person_id = r.person_id;
      IF v_status = 'skipped' AND v_reason = 'email_missing' THEN
        v_no_email := v_no_email + 1;
      ELSIF v_status = 'skipped' AND v_reason = 'lead_not_found' THEN
        v_no_consent := v_no_consent + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;
    END IF;
  END LOOP;

  -- Czy za ta strona zostal ktos jeszcze (ten sam zbior co petla).
  v_has_more := v_last IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.event_lead_scans l
      JOIN public.event_sponsors s ON s.tenant_id = l.tenant_id AND s.id = l.sponsor_id
     WHERE l.tenant_id = v_tenant AND l.event_id = v_event_id
       AND (v_sponsor_id IS NULL OR l.sponsor_id = v_sponsor_id)
       AND l.person_id > v_last
  );

  RETURN jsonb_build_object(
    'persons', v_persons,
    'created', v_created,
    'updated', v_updated,
    'skipped_no_email', v_no_email,
    'skipped_no_consent', v_no_consent,
    'failed', v_failed,
    'has_more', v_has_more,
    'next_after', CASE WHEN v_has_more THEN v_last END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_lead_scans_push_to_crm(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_lead_scans_push_to_crm(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_lead_scans_push_to_crm(jsonb) IS
  'Jawne przeniesienie kontaktow zebranych na stoiskach do CRM: {event_id, sponsor_id?, after_person_id?, limit? (1..500, domyslnie 500)} - strona osob po person_id rosnaco. Przez most _event_person_crm_sync: nowy kontakt WYLACZNIE ze zgoda marketingowa organizatora (p_create = dowod), inaczej tylko wzbogacenie istniejacego; segment event_participant, tagi event:<slug> i sponsor_lead:<id firmy>; notatki i oceny sponsora nie ida do CRM. Zwraca {persons, created, updated, skipped_no_email, skipped_no_consent, failed, has_more, next_after} - klient wola dalej z after_person_id = next_after, dopoki has_more. Bramka: assert_event_admin_tenant().';
