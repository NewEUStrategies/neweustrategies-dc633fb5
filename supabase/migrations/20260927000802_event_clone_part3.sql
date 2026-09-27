-- CZESC 3/3 MIGRACJI 20260927000800_event_clone.sql
-- migration-split: part 3/3 of 20260927000800_event_clone.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 20260927000800_event_clone.sql,
-- potem 20260927000801_event_clone_part2.sql .. 20260927000802_event_clone_part3.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.
-- events-harness: include

CREATE OR REPLACE FUNCTION public._event_clone_seating(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_categories integer;
  v_links integer;
  v_maps integer;
  v_sections integer;
  v_seats integer;
BEGIN
  INSERT INTO public.event_seat_categories (id, tenant_id, event_id, key, name_pl, name_en, color, sort_order)
  SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, c.key, c.name_pl, c.name_en,
         c.color, c.sort_order
  FROM public.event_seat_categories c
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src;
  GET DIAGNOSTICS v_categories = ROW_COUNT;

  -- Powiazanie kategorii z biletem tylko wtedy, gdy bilet przeszedl.
  INSERT INTO public.event_seat_category_tickets (id, tenant_id, event_id, category_id, ticket_type_id)
  SELECT public._event_clone_id(p_new, l.id), p_tenant, p_new,
         public._event_clone_id(p_new, l.category_id), t.id
  FROM public.event_seat_category_tickets l
  JOIN public.event_ticket_types t
    ON t.tenant_id = p_tenant AND t.event_id = p_new
   AND t.id = public._event_clone_id(p_new, l.ticket_type_id)
  WHERE l.tenant_id = p_tenant AND l.event_id = p_src;
  GET DIAGNOSTICS v_links = ROW_COUNT;

  INSERT INTO public.event_seat_maps (
    id, tenant_id, event_id, room_id, session_id, name, status, width, height, stage_x,
    stage_y, stage_w, stage_h, sort_order, published_at, created_by
  )
  SELECT public._event_clone_id(p_new, m.id), p_tenant, p_new,
         (SELECT r.id FROM public.event_rooms r
           WHERE r.tenant_id = p_tenant AND r.event_id = p_new
             AND r.id = public._event_clone_id(p_new, m.room_id)),
         (SELECT s.id FROM public.event_sessions s
           WHERE s.tenant_id = p_tenant AND s.event_id = p_new
             AND s.id = public._event_clone_id(p_new, m.session_id)),
         m.name, 'draft', m.width, m.height, m.stage_x, m.stage_y, m.stage_w, m.stage_h,
         m.sort_order, NULL, v_uid
  FROM public.event_seat_maps m
  WHERE m.tenant_id = p_tenant AND m.event_id = p_src;
  GET DIAGNOSTICS v_maps = ROW_COUNT;

  INSERT INTO public.event_seat_sections (
    id, tenant_id, event_id, map_id, label, kind, category_id, origin_x, origin_y,
    rotation_deg, rows_count, seats_per_row, row_label_scheme, row_label_start,
    seat_numbering, seat_number_start, seat_pitch, row_pitch, aisle_after, table_shape,
    table_seats, sort_order
  )
  SELECT public._event_clone_id(p_new, s.id), p_tenant, p_new,
         public._event_clone_id(p_new, s.map_id), s.label, s.kind,
         public._event_clone_id(p_new, s.category_id), s.origin_x, s.origin_y, s.rotation_deg,
         s.rows_count, s.seats_per_row, s.row_label_scheme, s.row_label_start,
         s.seat_numbering, s.seat_number_start, s.seat_pitch, s.row_pitch, s.aisle_after,
         s.table_shape, s.table_seats, s.sort_order
  FROM public.event_seat_sections s
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src;
  GET DIAGNOSTICS v_sections = ROW_COUNT;

  -- Blokada zostaje; rezerwacja dla firmy z CRM zostaje; rezerwacje dla
  -- sponsora, zamowienia pakietu i sama notatka sa czyszczone.
  INSERT INTO public.event_seats (
    id, tenant_id, event_id, map_id, section_id, row_label, seat_number, x, y, sort_key,
    category_id, status, block_reason, hold_company_id, hold_sponsor_id,
    hold_package_order_id, hold_note, is_accessible
  )
  SELECT public._event_clone_id(p_new, s.id), p_tenant, p_new,
         public._event_clone_id(p_new, s.map_id), public._event_clone_id(p_new, s.section_id),
         s.row_label, s.seat_number, s.x, s.y, s.sort_key,
         public._event_clone_id(p_new, s.category_id), x.status,
         CASE WHEN x.status = 'blocked' THEN s.block_reason END,
         CASE WHEN x.status = 'held' THEN s.hold_company_id END,
         NULL, NULL,
         CASE WHEN x.status = 'held' THEN s.hold_note END,
         s.is_accessible
  FROM public.event_seats s
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN s.status = 'held' AND s.hold_company_id IS NULL THEN 'available'
      ELSE s.status
    END AS status
  ) AS x
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src;
  GET DIAGNOSTICS v_seats = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'seat_categories', v_categories, 'seat_category_tickets', v_links, 'seat_maps', v_maps,
    'seat_sections', v_sections, 'seats', v_seats
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_seating(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_seating(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_seating(uuid, uuid, uuid, jsonb) IS
  'Klon planu sali jako draft: kategorie (z biletami, jesli przeszly), sekcje i miejsca; blokady i rezerwacje firm z CRM zostaja, pozostale rezerwacje czyszczone. Przydzialow nigdy. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_ad_campaigns(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.event_ad_campaigns (
    id, tenant_id, event_id, platform, match_kind, match_value, label, conversion_action_name,
    created_by
  )
  SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, c.platform, c.match_kind,
         c.match_value, c.label, c.conversion_action_name, (p_ctx->>'uid')::uuid
  FROM public.event_ad_campaigns c
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('copied', jsonb_build_object('ad_campaigns', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_ad_campaigns(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_ad_campaigns(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_ad_campaigns(uuid, uuid, uuid, jsonb) IS
  'Klon mapowania kampanii Google Ads na wydarzenie (bez kosztow, zdarzen lejka i atrybucji). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_home_ads(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_unpublish boolean := (p_ctx->'options'->>'sponsors_unpublished')::boolean;
  v_n integer;
BEGIN
  INSERT INTO public.event_home_ads (
    id, tenant_id, event_id, image_url, image_mobile_url, link_url, alt_text, group_ids,
    starts_at, ends_at, is_active, sort_order, created_by, sponsor_id
  )
  SELECT public._event_clone_id(p_new, a.id), p_tenant, p_new, a.image_url, a.image_mobile_url,
         a.link_url, a.alt_text,
         ARRAY(
           SELECT g.id FROM unnest(a.group_ids) WITH ORDINALITY AS u(gid, ord)
           JOIN public.event_groups g
             ON g.tenant_id = p_tenant AND g.event_id = p_new
            AND g.id = public._event_clone_id(p_new, u.gid)
           ORDER BY u.ord
         ),
         public._event_clone_shift(a.starts_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(a.ends_at, v_src_tz, v_tz, v_delta),
         a.is_active AND NOT v_unpublish, a.sort_order, (p_ctx->>'uid')::uuid,
         (SELECT sp.id FROM public.event_sponsors sp
           WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
             AND sp.id = public._event_clone_id(p_new, a.sponsor_id))
  FROM public.event_home_ads a
  WHERE a.tenant_id = p_tenant AND a.event_id = p_src;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('copied', jsonb_build_object('home_ads', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_home_ads(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_home_ads(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_home_ads(uuid, uuid, uuid, jsonb) IS
  'Klon reklam strony glownej wydarzenia (okno przesuniete, grupy i sponsor remapowane; nieaktywne przy nieopublikowanych sponsorach). Wyswietlen i klikniec nigdy. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_codes(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_suffix text := p_ctx->'options'->>'code_suffix';
  v_total integer;
  v_n integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.b2b_coupons c
  WHERE c.tenant_id = p_tenant AND c.event_ids = ARRAY[p_src];

  -- Tylko kody o zakresie DOKLADNIE tego wydarzenia (kampanie wielu wydarzen
  -- zostaja). Kod jest unikalny w najemcy - kolizja jest pomijana i liczona.
  INSERT INTO public.b2b_coupons (
    tenant_id, code, name, description, discount_kind, discount_percent, discount_cents,
    currency, active, max_redemptions, redemptions_count, valid_from, valid_until, plan_ids,
    campaign_id, grants_tier_key, grants_duration_days, newsletter_segment, metadata,
    created_by, event_ids, ticket_type_ids, package_ids, max_redemptions_per_user,
    applies_discount, reveals_hidden, assigned_company_id, assigned_lead_id,
    lead_score_bonus, organization_id, prefix
  )
  SELECT p_tenant, upper(c.code || v_suffix), c.name, c.description, c.discount_kind,
         c.discount_percent, c.discount_cents, c.currency, c.active, c.max_redemptions, 0,
         public._event_clone_shift(c.valid_from, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(c.valid_until, v_src_tz, v_tz, v_delta),
         c.plan_ids, NULL, c.grants_tier_key, c.grants_duration_days, c.newsletter_segment,
         c.metadata, (p_ctx->>'uid')::uuid, ARRAY[p_new],
         ARRAY(
           SELECT t.id FROM unnest(c.ticket_type_ids) WITH ORDINALITY AS u(tid, ord)
           JOIN public.event_ticket_types t
             ON t.tenant_id = p_tenant AND t.event_id = p_new
            AND t.id = public._event_clone_id(p_new, u.tid)
           ORDER BY u.ord
         ),
         ARRAY(
           SELECT k.id FROM unnest(c.package_ids) WITH ORDINALITY AS u(pid, ord)
           JOIN public.event_ticket_packages k
             ON k.tenant_id = p_tenant AND k.event_id = p_new
            AND k.id = public._event_clone_id(p_new, u.pid)
           ORDER BY u.ord
         ),
         c.max_redemptions_per_user, c.applies_discount, c.reveals_hidden,
         c.assigned_company_id, c.assigned_lead_id, c.lead_score_bonus, c.organization_id,
         c.prefix
  FROM public.b2b_coupons c
  WHERE c.tenant_id = p_tenant AND c.event_ids = ARRAY[p_src]
  ON CONFLICT (tenant_id, code) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object(
    'copied', jsonb_build_object('codes', v_n),
    'skipped', jsonb_build_object('codes', v_total - v_n)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_codes(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_codes(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_codes(uuid, uuid, uuid, jsonb) IS
  'Klon kodow rejestracyjnych wydarzenia z przyrostkiem (licznik od zera, okno przesuniete, bilety i pakiety remapowane, przypisanie do firmy/kontaktu CRM zachowane). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_crm(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (p_ctx->>'uid')::uuid;
  v_title_pl text := p_ctx->>'title_pl';
  v_title_en text := p_ctx->>'title_en';
  v_slug text := p_ctx->>'slug';
  v_task_title text := 'Odnowienie partnerstwa: ' || left(p_ctx->>'title_pl', 180);
  v_due timestamptz := now() + make_interval(days => (p_ctx->'options'->>'crm_task_due_days')::integer);
  v_tasks integer := 0;
  v_audit integer;
BEGIN
  -- Os czasu firmy w CRM: kazdy przeniesiony sponsor (kontrakt metadanych
  -- `src/lib/crm/eventActivity.ts`). Bez sponsorow w kopii - zero wierszy.
  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  SELECT p_tenant, v_uid, 'event.clone.sponsor_copied', 'crm_company', s.company_id,
         jsonb_build_object(
           'event_id', p_new, 'event_slug', v_slug,
           'event_title_pl', v_title_pl, 'event_title_en', v_title_en,
           'summary_pl', 'Sponsor przeniesiony do nowej edycji: ' || v_title_pl,
           'summary_en', 'Sponsor carried over to the new edition: ' || v_title_en,
           'source_event_id', p_src, 'sponsor_id', s.id
         )
  FROM public.event_sponsors s
  WHERE s.tenant_id = p_tenant AND s.event_id = p_new;
  GET DIAGNOSTICS v_audit = ROW_COUNT;

  -- Zadania odnowienia dla GLOWNYCH kontaktow sponsorow ZRODLA (takze tych,
  -- ktorych organizator nie przeniosl - decyzja o odnowieniu zyje w CRM).
  -- Deduplikacja: jedno otwarte zadanie o tym tytule na kontakt.
  IF (p_ctx->'options'->>'crm_renewal_tasks')::boolean THEN
    INSERT INTO public.crm_tasks (tenant_id, lead_id, title, note, due_at, assignee_id, created_by)
    SELECT DISTINCT ON (k.lead_id)
           p_tenant, k.lead_id, v_task_title,
           'Sponsor poprzedniej edycji (' || (p_ctx->>'src_title_pl') || '): ' || s.snapshot_name
             || '. Nowa edycja: ' || v_title_pl || ' (' || v_slug || ').',
           v_due, COALESCE(l.owner_id, v_uid), v_uid
    FROM public.event_sponsor_contacts k
    JOIN public.event_sponsors s
      ON s.tenant_id = k.tenant_id AND s.event_id = k.event_id AND s.id = k.sponsor_id
    JOIN public.crm_leads l ON l.tenant_id = k.tenant_id AND l.id = k.lead_id
    WHERE k.tenant_id = p_tenant AND k.event_id = p_src AND k.role = 'primary'
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_tasks t
        WHERE t.tenant_id = p_tenant AND t.lead_id = k.lead_id
          AND t.status = 'open' AND t.title = v_task_title
      )
    ORDER BY k.lead_id, s.sort_order, s.snapshot_name;
    GET DIAGNOSTICS v_tasks = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'crm_tasks', v_tasks, 'crm_timeline_entries', v_audit
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_crm(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_crm(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_crm(uuid, uuid, uuid, jsonb) IS
  'Most klonu do CRM: wpis osi czasu firmy dla kazdego przeniesionego sponsora i (opcjonalnie) deduplikowane zadania odnowienia partnerstwa dla glownych kontaktow sponsorow zrodla. Pomocnik klonu edycji.';

-- ----------------------------------------------------------------------------
-- 7) KLON (plaszczyzna panelu)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_clone(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_uid uuid := auth.uid();
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_key text := NULLIF(btrim(COALESCE(v_payload->>'idempotency_key', '')), '');
  v_cmd public.command_idempotency;
  v_set jsonb;
  v_inc jsonb;
  v_opt jsonb;
  v_res jsonb;
  v_src public.events;
  v_title_pl text := btrim(COALESCE(v_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(v_payload->>'title_en', ''));
  v_slug_explicit text := NULLIF(lower(btrim(COALESCE(v_payload->>'slug', ''))), '');
  v_slug text;
  v_external text;
  v_new uuid;
  v_try integer;
  v_window jsonb;
  v_warnings jsonb;
  v_ctx jsonb;
  v_parts jsonb[] := ARRAY[]::jsonb[];
  v_part jsonb;
  v_copied jsonb := '{}'::jsonb;
  v_skipped jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  -- 0. Idempotencja w TEJ SAMEJ transakcji: awaria cofa zajecie klucza,
  --    rownolegly duplikat czeka na kluczu glownym i czyta wynik pierwszego.
  IF v_key IS NOT NULL THEN
    IF char_length(v_key) < 8 OR char_length(v_key) > 200 THEN
      RAISE EXCEPTION 'invalid_idempotency_key: key must have 8-200 characters';
    END IF;
    INSERT INTO public.command_idempotency (tenant_id, idempotency_key, command, actor_id, correlation_id)
    VALUES (v_tenant, v_key, 'event.clone', v_uid, public.request_correlation_id())
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
    IF NOT FOUND THEN
      SELECT * INTO v_cmd FROM public.command_idempotency c
      WHERE c.tenant_id = v_tenant AND c.idempotency_key = v_key;
      IF v_cmd.actor_id IS DISTINCT FROM v_uid OR v_cmd.command <> 'event.clone' THEN
        RAISE EXCEPTION 'idempotency_conflict: the key belongs to another command or person';
      END IF;
      IF v_cmd.status = 'succeeded' AND v_cmd.result IS NOT NULL THEN
        RETURN v_cmd.result || jsonb_build_object('replayed', true);
      END IF;
      RAISE EXCEPTION 'clone_in_progress: the same copy is still running';
    END IF;
  END IF;

  -- 1. Ustawienia, zrodlo (w najemcy wolajacego) i przesuniecie.
  v_set := public._event_clone_settings(v_payload, true);
  v_inc := v_set->'include';
  v_opt := v_set->'options';
  v_res := public._event_clone_resolve(v_tenant, v_payload, true);

  -- Blokada klucza: zrodla nie da sie skasowac w trakcie kopiowania.
  SELECT * INTO v_src FROM public.events e
  WHERE e.id = (v_res->>'source_event_id')::uuid AND e.tenant_id = v_tenant
  FOR KEY SHARE;

  -- 2. Walidacja pol nowej edycji.
  IF v_title_pl = '' OR v_title_en = ''
     OR char_length(v_title_pl) > 200 OR char_length(v_title_en) > 200 THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required (at most 200 characters)';
  END IF;

  IF v_slug_explicit IS NOT NULL THEN
    IF v_slug_explicit !~ '^[a-z0-9-]{3,120}$' THEN
      RAISE EXCEPTION 'invalid_slug: slug must be 3-120 chars of a-z, 0-9 and dashes';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.slug = v_slug_explicit
    ) THEN
      RAISE EXCEPTION 'slug_taken: another event already uses this address';
    END IF;
  END IF;

  v_external := v_src.external_registration_url;
  IF v_payload ? 'external_registration_url' THEN
    v_external := NULLIF(btrim(COALESCE(v_payload->>'external_registration_url', '')), '');
  END IF;
  IF v_src.registration_mode = 'external' AND v_external IS NULL THEN
    RAISE EXCEPTION 'external_url_required: this mode registers people elsewhere and needs a url';
  END IF;
  IF v_external IS NOT NULL
     AND (v_external !~* '^https://[^[:space:]]+$' OR char_length(v_external) > 2048) THEN
    RAISE EXCEPTION 'external_url_invalid: url must start with https and be under 2048 chars';
  END IF;

  -- 3. Okno wydarzenia kontra przesuniete sesje - PRZED zapisem.
  v_window := public._event_clone_session_window(v_tenant, v_src.id, v_res, v_inc, v_opt);
  IF (v_window->>'outside')::integer > 0 THEN
    RAISE EXCEPTION 'clone_sessions_outside_window: % session(s) would fall outside the new event dates',
      v_window->>'outside';
  END IF;

  v_warnings := public._event_clone_forecast(
    v_tenant, v_src.id, v_res, v_inc, v_opt, v_payload ? 'external_registration_url'
  );

  -- 4. Wiersz wydarzenia (zawsze szkic). Slug generowany ponawia sie po
  --    wyscigu na unikalnosci; slug podany wprost konczy sie `slug_taken`.
  FOR v_try IN 1..5 LOOP
    v_slug := COALESCE(
      v_slug_explicit, public._event_clone_slug_candidate(v_tenant, v_title_pl, v_src.slug)
    );
    BEGIN
      INSERT INTO public.events (
        tenant_id, slug, title_pl, title_en, description_pl, description_en, kind,
        starts_at, ends_at, timezone, location, street_address, city, region, postal_code,
        country, region_id, visibility, min_tier_rank, capacity, status, host_user_id,
        chatham_house, cover_url, created_by, event_type_id, format, registration_mode,
        registration_flow, guest_mode, external_registration_url, branding,
        video_header_platform, video_header_id, social_hashtag, support_email, languages,
        home_design, pages_display_mode, features, rsvp_opens_at, early_rsvp_rank,
        ticket_price_cents, ticket_currency, program_id, discussion_club_id,
        discussion_group_id, previous_edition_id
      ) VALUES (
        v_tenant, v_slug, v_title_pl, v_title_en, v_src.description_pl, v_src.description_en,
        v_src.kind, (v_res->>'starts_at')::timestamptz, (v_res->>'ends_at')::timestamptz,
        v_res->>'timezone', v_src.location, v_src.street_address, v_src.city, v_src.region,
        v_src.postal_code, v_src.country, v_src.region_id, v_src.visibility,
        v_src.min_tier_rank, v_src.capacity, 'draft', v_src.host_user_id,
        v_src.chatham_house, v_src.cover_url, v_uid, v_src.event_type_id, v_src.format,
        v_src.registration_mode, v_src.registration_flow, v_src.guest_mode, v_external,
        v_src.branding, v_src.video_header_platform, v_src.video_header_id,
        v_src.social_hashtag, v_src.support_email, v_src.languages, v_src.home_design,
        v_src.pages_display_mode, v_src.features,
        public._event_clone_shift(
          v_src.rsvp_opens_at, v_res->>'source_tz', v_res->>'timezone', (v_res->>'delta')::interval
        ),
        v_src.early_rsvp_rank, v_src.ticket_price_cents, v_src.ticket_currency,
        v_src.program_id, v_src.discussion_club_id, v_src.discussion_group_id, v_src.id
      )
      RETURNING id INTO v_new;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_slug_explicit IS NOT NULL THEN
        RAISE EXCEPTION 'slug_taken: another event already uses this address';
      END IF;
      IF v_try = 5 THEN RAISE; END IF;
    END;
  END LOOP;

  v_ctx := jsonb_build_object(
    'src_tz', v_res->>'source_tz', 'tz', v_res->>'timezone', 'delta', v_res->>'delta',
    'day_shift', (v_res->>'day_shift')::integer, 'uid', v_uid, 'src_slug', v_src.slug,
    'slug', v_slug, 'title_pl', v_title_pl, 'title_en', v_title_en,
    'src_title_pl', v_src.title_pl, 'include', v_inc, 'options', v_opt
  );

  -- 5. Moduly w porzadku kluczy obcych (grupy i sale przed wszystkim, co je
  --    wskazuje; sponsorzy przed sciezkami i sesjami; sesje przed obsada,
  --    punktami odprawy i planem sali; bilety przed pakietami, kategoriami
  --    miejsc, naborem i kodami).
  v_parts := array_append(v_parts, public._event_clone_groups(v_tenant, v_src.id, v_new, v_ctx));
  IF (v_inc->>'agenda')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_rooms(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  v_parts := array_append(v_parts, public._event_clone_sponsors(v_tenant, v_src.id, v_new, v_ctx));
  IF (v_inc->>'agenda')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_agenda(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'speakers')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_speakers(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'tickets')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_tickets(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'registration')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_registration(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  -- Korzen i piec stron modulowych jak przy `admin_event_create` - takze bez
  -- sekcji "strony" (wydarzenie bez menu byloby zepsute).
  PERFORM public._event_seed_default_pages(v_tenant, v_new);
  IF (v_inc->>'pages')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_pages(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'onsite')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_onsite(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'meetings')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_meetings(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'cfp')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_cfp(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'seating')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_seating(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'ad_campaigns')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_ad_campaigns(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'home_ads')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_home_ads(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  IF (v_inc->>'codes')::boolean AND (v_inc->>'tickets')::boolean THEN
    v_parts := array_append(v_parts, public._event_clone_codes(v_tenant, v_src.id, v_new, v_ctx));
  END IF;
  v_parts := array_append(v_parts, public._event_clone_crm(v_tenant, v_src.id, v_new, v_ctx));

  FOREACH v_part IN ARRAY v_parts LOOP
    v_copied := v_copied || COALESCE(v_part->'copied', '{}'::jsonb);
    v_skipped := v_skipped || COALESCE(v_part->'skipped', '{}'::jsonb);
  END LOOP;

  -- 6. Wynik, zapamietany dla powtorzen, i zdarzenie domenowe.
  v_result := jsonb_build_object(
    'event_id', v_new,
    'slug', v_slug,
    'source_event_id', v_src.id,
    'replayed', false,
    'shift', jsonb_build_object(
      'delta', v_res->>'delta', 'day_shift', (v_res->>'day_shift')::integer,
      'source_tz', v_res->>'source_tz', 'timezone', v_res->>'timezone'
    ),
    'copied', v_copied,
    'skipped', v_skipped || public._event_clone_not_copied(v_tenant, v_src.id),
    'warnings', v_warnings
  );

  IF v_key IS NOT NULL THEN
    UPDATE public.command_idempotency c
       SET status = 'succeeded', result = v_result, completed_at = now()
     WHERE c.tenant_id = v_tenant AND c.idempotency_key = v_key;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event',
    v_new::text,
    'event.cloned.v1',
    jsonb_build_object('event_id', v_new, 'source_event_id', v_src.id),
    auth.uid()
  );

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_event_clone(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_clone(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_clone(jsonb) IS
  'Nowa edycja wydarzenia z poprzedniej: kopia konfiguracji (grupy, agenda, prelegenci, bilety, formularz, regulaminy, sponsorzy, strony, obsluga na miejscu, gielda spotkan, nabor, plan sali, opcjonalnie kampanie, reklamy i kody) z przesunieciem dat w czasie lokalnym strefy wydarzenia; zawsze szkic, idempotentna po idempotency_key. Nie kopiuje zapisow, zamowien, odpraw, skanow, spotkan, urzadzen, zgloszen, przydzialow ani faktur. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 8) PODGLAD KLONU (bez zapisu)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_clone_preview(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_set jsonb;
  v_inc jsonb;
  v_opt jsonb;
  v_res jsonb;
  v_src public.events;
  v_window jsonb;
  v_title_pl text := btrim(COALESCE(v_payload->>'title_pl', ''));
  v_slug_explicit text := NULLIF(lower(btrim(COALESCE(v_payload->>'slug', ''))), '');
  v_slug text;
  v_slug_valid boolean := true;
  v_slug_available boolean := true;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  v_set := public._event_clone_settings(v_payload, false);
  v_inc := v_set->'include';
  v_opt := v_set->'options';
  v_res := public._event_clone_resolve(v_tenant, v_payload, false);

  SELECT * INTO v_src FROM public.events e
  WHERE e.id = (v_res->>'source_event_id')::uuid AND e.tenant_id = v_tenant;

  v_window := public._event_clone_session_window(v_tenant, v_src.id, v_res, v_inc, v_opt);
  IF (v_window->>'outside')::integer > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'sessions_outside_window', 'count', (v_window->>'outside')::integer
    ));
  END IF;

  IF v_slug_explicit IS NULL THEN
    v_slug := public._event_clone_slug_candidate(v_tenant, v_title_pl, v_src.slug);
  ELSE
    v_slug := v_slug_explicit;
    v_slug_valid := v_slug ~ '^[a-z0-9-]{3,120}$';
    v_slug_available := NOT EXISTS (
      SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.slug = v_slug
    );
    IF NOT v_slug_valid THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'invalid_slug', 'count', 1));
    ELSIF NOT v_slug_available THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'slug_taken', 'count', 1));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'source', jsonb_build_object(
      'id', v_src.id, 'slug', v_src.slug, 'title_pl', v_src.title_pl,
      'title_en', v_src.title_en, 'starts_at', v_src.starts_at, 'ends_at', v_src.ends_at,
      'timezone', v_res->>'source_tz', 'status', v_src.status,
      'registration_mode', v_src.registration_mode,
      'external_registration_url', v_src.external_registration_url
    ),
    'target', jsonb_build_object(
      'starts_at', v_res->'starts_at', 'ends_at', v_res->'ends_at',
      'timezone', v_res->>'timezone', 'suggested_starts_at', v_res->'suggested_starts_at',
      'slug', v_slug, 'slug_valid', v_slug_valid, 'slug_available', v_slug_available
    ),
    'shift', jsonb_build_object(
      'delta', v_res->>'delta', 'day_shift', (v_res->>'day_shift')::integer,
      'source_tz', v_res->>'source_tz', 'timezone', v_res->>'timezone'
    ),
    'include', v_inc,
    'options', v_opt,
    'counts', public._event_clone_counts(v_tenant, v_src.id),
    'not_copied', public._event_clone_not_copied(v_tenant, v_src.id),
    'dates', public._event_clone_dates(v_tenant, v_src.id, v_res) || jsonb_build_object(
      'first_session_starts_at', v_window->'first_starts_at',
      'last_session_ends_at', v_window->'last_ends_at'
    ),
    'warnings', public._event_clone_forecast(
      v_tenant, v_src.id, v_res, v_inc, v_opt, v_payload ? 'external_registration_url'
    ),
    'blockers', v_blockers
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_event_clone_preview(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_clone_preview(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_clone_preview(jsonb) IS
  'Podglad klonu edycji bez zapisu: zrodlo, daty docelowe (poczatek, koniec, podpowiedz), przesuniecie, liczniki sekcji, dane, ktorych klon nie przeniesie, daty kluczowe po przesunieciu, ostrzezenia i blokady. Te same reguly co admin_event_clone. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 9) LISTA EDYCJI (poprzednie i nastepne)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_editions(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  slug text,
  title_pl text,
  title_en text,
  starts_at timestamptz,
  timezone text,
  status text,
  relation text,
  depth integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  WITH RECURSIVE prev AS (
    SELECT e.id AS edition_id, e.previous_edition_id AS parent_id, 1 AS lvl
    FROM public.events e
    WHERE e.tenant_id = v_tenant
      AND e.id = (SELECT x.previous_edition_id FROM public.events x
                   WHERE x.id = p_event_id AND x.tenant_id = v_tenant)
    UNION ALL
    SELECT e.id, e.previous_edition_id, prev.lvl + 1
    FROM public.events e
    JOIN prev ON e.id = prev.parent_id
    WHERE e.tenant_id = v_tenant AND prev.lvl < 20 AND e.id <> p_event_id
  ),
  nxt AS (
    SELECT e.id AS edition_id, 1 AS lvl
    FROM public.events e
    WHERE e.tenant_id = v_tenant AND e.previous_edition_id = p_event_id
    UNION ALL
    SELECT e.id, nxt.lvl + 1
    FROM public.events e
    JOIN nxt ON e.previous_edition_id = nxt.edition_id
    WHERE e.tenant_id = v_tenant AND nxt.lvl < 20 AND e.id <> p_event_id
  ),
  chain AS (
    SELECT prev.edition_id, 'previous'::text AS rel, prev.lvl FROM prev
    UNION ALL
    SELECT nxt.edition_id, 'next'::text, nxt.lvl FROM nxt
  )
  SELECT e.id, e.slug, e.title_pl, e.title_en, e.starts_at, e.timezone, e.status,
         chain.rel, chain.lvl
  FROM chain
  JOIN public.events e ON e.id = chain.edition_id AND e.tenant_id = v_tenant
  ORDER BY e.starts_at, e.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_event_editions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_editions(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_editions(uuid) IS
  'Edycje wydarzenia z rodowodu previous_edition_id: poprzednie (w gore lancucha) i nastepne (klony tego wydarzenia i ich klony), do 20 poziomow, w najemcy wolajacego. Bramka: assert_event_admin_tenant().';
