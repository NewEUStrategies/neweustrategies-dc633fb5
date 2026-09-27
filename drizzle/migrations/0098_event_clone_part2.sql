-- CZESC 2/3 MIGRACJI 20260927000800_event_clone.sql
-- migration-split: part 2/3 of 20260927000800_event_clone.sql
-- events-harness: include

-- ----------------------------------------------------------------------------
-- 6) POMOCNICY MODULOW. Kazdy dostaje (najemca, zrodlo, nowe, kontekst) i
--    oddaje {copied, skipped}. Kontekst: src_tz, tz, delta, day_shift, uid,
--    src_slug, slug, title_pl, title_en, src_title_pl, include, options.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_clone_groups(
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
  -- Grupy zasiane wyzwalaczem przy INSERT-cie wydarzenia jeszcze nic nie
  -- wskazuje, wiec mozna je zastapic grupami zrodla (klucze i flagi 1:1).
  DELETE FROM public.event_groups g WHERE g.tenant_id = p_tenant AND g.event_id = p_new;

  INSERT INTO public.event_groups (
    id, tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    color, attendee_visibility, can_see_attendees, can_meet, can_chat,
    can_lead_retrieval, can_see_recording, min_tier_rank, sort_order, is_default, is_system
  )
  SELECT public._event_clone_id(p_new, g.id), p_tenant, p_new, g.key, g.name_pl, g.name_en,
         g.description_pl, g.description_en, g.color, g.attendee_visibility,
         g.can_see_attendees, g.can_meet, g.can_chat, g.can_lead_retrieval,
         g.can_see_recording, g.min_tier_rank, g.sort_order, g.is_default, g.is_system
  FROM public.event_groups g
  WHERE g.tenant_id = p_tenant AND g.event_id = p_src;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Dosiew grup systemowych, ktorych zrodlo nie mialo (domyslna zostaje jedna).
  PERFORM public._event_seed_default_groups(p_tenant, p_new);

  RETURN jsonb_build_object('copied', jsonb_build_object('groups', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_groups(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_groups(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_groups(uuid, uuid, uuid, jsonb) IS
  'Klon grup uczestnikow (zawsze): zastepuje grupy zasiane przy INSERT-cie grupami zrodla i dosiewa brakujace systemowe. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_rooms(
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
  INSERT INTO public.event_rooms (
    id, tenant_id, event_id, name, capacity, floor, location_note, sort_order, is_active
  )
  SELECT public._event_clone_id(p_new, r.id), p_tenant, p_new, r.name, r.capacity, r.floor,
         r.location_note, r.sort_order, r.is_active
  FROM public.event_rooms r
  WHERE r.tenant_id = p_tenant AND r.event_id = p_src;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('copied', jsonb_build_object('rooms', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_rooms(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_rooms(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_rooms(uuid, uuid, uuid, jsonb) IS
  'Klon sal wydarzenia (czesc agendy). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_sponsors(
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
  v_with_sponsors boolean := (p_ctx->'include'->>'sponsors')::boolean;
  v_materials boolean := (p_ctx->'include'->>'sponsor_materials')::boolean;
  v_unpublish boolean := (p_ctx->'options'->>'sponsors_unpublished')::boolean;
  v_refresh boolean := (p_ctx->'options'->>'refresh_sponsor_snapshots')::boolean;
  v_tiers integer;
  v_benefits integer;
  v_sponsors integer := 0;
  v_refreshed integer := 0;
  v_contacts integer := 0;
  v_mats integer := 0;
BEGIN
  -- Poziomy i ich korzysci przechodza ZAWSZE: to cennik partnerstwa, nie umowa.
  INSERT INTO public.event_sponsor_tiers (
    id, tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    rank, accent_color, logo_size, max_companies, sort_order, is_active, layout
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.key, t.name_pl, t.name_en,
         t.description_pl, t.description_en, t.rank, t.accent_color, t.logo_size,
         t.max_companies, t.sort_order, t.is_active, t.layout
  FROM public.event_sponsor_tiers t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_tiers = ROW_COUNT;

  INSERT INTO public.event_sponsor_tier_benefits (
    id, tenant_id, event_id, tier_id, label_pl, label_en, sort_order
  )
  SELECT public._event_clone_id(p_new, b.id), p_tenant, p_new,
         public._event_clone_id(p_new, b.tier_id), b.label_pl, b.label_en, b.sort_order
  FROM public.event_sponsor_tier_benefits b
  WHERE b.tenant_id = p_tenant AND b.event_id = p_src;
  GET DIAGNOSTICS v_benefits = ROW_COUNT;

  IF v_with_sponsors THEN
    -- Migawka z CRM tylko dla wierszy `snapshot_source = 'crm'` i tylko
    -- wartosciami, ktore przejda ograniczenia migawki (logo i kraj z kartoteki
    -- nie sa w niej walidowane) - reczne nadpisanie redakcji zostaje.
    INSERT INTO public.event_sponsors (
      id, tenant_id, event_id, company_id, tier_id, role, booth_label, sort_order,
      is_published, snapshot_name, snapshot_logo_url, snapshot_description_pl,
      snapshot_description_en, snapshot_website, snapshot_country, snapshot_source,
      snapshot_taken_at, internal_note, created_by, link_mode, link_url
    )
    SELECT public._event_clone_id(p_new, s.id), p_tenant, p_new, s.company_id,
           public._event_clone_id(p_new, s.tier_id), s.role, s.booth_label, s.sort_order,
           s.is_published AND NOT v_unpublish,
           CASE WHEN x.refresh THEN left(btrim(c.name), 200) ELSE s.snapshot_name END,
           CASE
             WHEN NOT x.refresh THEN s.snapshot_logo_url
             WHEN NULLIF(btrim(COALESCE(c.logo_url, '')), '') IS NULL THEN NULL
             WHEN btrim(c.logo_url) ~ '^(https?://|/)' THEN btrim(c.logo_url)
             ELSE s.snapshot_logo_url
           END,
           s.snapshot_description_pl, s.snapshot_description_en,
           CASE WHEN x.refresh THEN public._event_sponsor_web_url(c.website) ELSE s.snapshot_website END,
           CASE
             WHEN NOT x.refresh THEN s.snapshot_country
             WHEN NULLIF(btrim(COALESCE(c.country, '')), '') IS NULL THEN NULL
             WHEN char_length(btrim(c.country)) BETWEEN 2 AND 120 THEN btrim(c.country)
             ELSE s.snapshot_country
           END,
           s.snapshot_source,
           CASE WHEN x.refresh THEN now() ELSE s.snapshot_taken_at END,
           s.internal_note, v_uid, s.link_mode, s.link_url
    FROM public.event_sponsors s
    LEFT JOIN public.crm_companies c ON c.tenant_id = s.tenant_id AND c.id = s.company_id
    CROSS JOIN LATERAL (
      SELECT v_refresh AND s.snapshot_source = 'crm' AND btrim(COALESCE(c.name, '')) <> '' AS refresh
    ) AS x
    WHERE s.tenant_id = p_tenant AND s.event_id = p_src;
    GET DIAGNOSTICS v_sponsors = ROW_COUNT;

    IF v_refresh THEN
      SELECT count(*) INTO v_refreshed
      FROM public.event_sponsors s
      JOIN public.crm_companies c ON c.tenant_id = s.tenant_id AND c.id = s.company_id
      WHERE s.tenant_id = p_tenant AND s.event_id = p_src
        AND s.snapshot_source = 'crm' AND btrim(c.name) <> '';
    END IF;

    INSERT INTO public.event_sponsor_contacts (
      id, tenant_id, event_id, sponsor_id, lead_id, role, sort_order, created_by
    )
    SELECT public._event_clone_id(p_new, k.id), p_tenant, p_new,
           public._event_clone_id(p_new, k.sponsor_id), k.lead_id, k.role, k.sort_order, v_uid
    FROM public.event_sponsor_contacts k
    WHERE k.tenant_id = p_tenant AND k.event_id = p_src;
    GET DIAGNOSTICS v_contacts = ROW_COUNT;

    IF v_materials THEN
      -- Materialy dotycza poprzedniej edycji (prezentacja, oferta) - wracaja
      -- jako nieopublikowane, do przejrzenia.
      INSERT INTO public.event_sponsor_materials (
        id, tenant_id, event_id, sponsor_id, title_pl, title_en, kind, url, sort_order,
        is_published, created_by
      )
      SELECT public._event_clone_id(p_new, m.id), p_tenant, p_new,
             public._event_clone_id(p_new, m.sponsor_id), m.title_pl, m.title_en, m.kind,
             m.url, m.sort_order, false, v_uid
      FROM public.event_sponsor_materials m
      WHERE m.tenant_id = p_tenant AND m.event_id = p_src;
      GET DIAGNOSTICS v_mats = ROW_COUNT;
    END IF;
  END IF;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'sponsor_tiers', v_tiers,
    'sponsor_benefits', v_benefits,
    'sponsors', v_sponsors,
    'sponsor_snapshots_refreshed', v_refreshed,
    'sponsor_contacts', v_contacts,
    'sponsor_materials', v_mats
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_sponsors(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_sponsors(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_sponsors(uuid, uuid, uuid, jsonb) IS
  'Klon poziomow sponsorskich z korzysciami (zawsze) oraz sponsorow, kontaktow i opcjonalnie materialow; migawka odswiezana z crm_companies. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_agenda(
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
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_all boolean := (p_ctx->'options'->>'include_cancelled_sessions')::boolean;
  v_draft boolean := (p_ctx->'options'->>'sessions_as_draft')::boolean;
  v_tracks integer;
  v_parents integer;
  v_children integer;
  v_total integer;
BEGIN
  INSERT INTO public.event_tracks (
    id, tenant_id, event_id, key, name_pl, name_en, accent_color, sort_order, is_active,
    tagline_pl, tagline_en, description_pl, description_en, cover_url, is_public,
    default_room_id, sponsor_id
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.key, t.name_pl, t.name_en,
         t.accent_color, t.sort_order, t.is_active, t.tagline_pl, t.tagline_en,
         t.description_pl, t.description_en, t.cover_url, t.is_public,
         (SELECT r.id FROM public.event_rooms r
           WHERE r.tenant_id = p_tenant AND r.event_id = p_new
             AND r.id = public._event_clone_id(p_new, t.default_room_id)),
         (SELECT sp.id FROM public.event_sponsors sp
           WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
             AND sp.id = public._event_clone_id(p_new, t.sponsor_id))
  FROM public.event_tracks t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_tracks = ROW_COUNT;

  -- Rodzice przed dziecmi: wyzwalacz `event_sessions_validate` sprawdza
  -- glebokosc na juz zapisanym rodzicu. Sesja odwolana (na zyczenie) wraca
  -- jako szkic BEZ SALI - patrz naglowek.
  INSERT INTO public.event_sessions (
    id, tenant_id, event_id, parent_session_id, track_id, room_id, sponsor_id,
    title_pl, title_en, description_pl, description_en, affiliation_pl, affiliation_en,
    starts_at, ends_at, format, status, capacity, requires_signup, min_tier_rank,
    chatham_house, is_private, allow_overlap, stream_url, recording_url, sort_order,
    published_at, cancelled_at, created_by
  )
  SELECT public._event_clone_id(p_new, s.id), p_tenant, p_new, NULL,
         (SELECT t.id FROM public.event_tracks t
           WHERE t.tenant_id = p_tenant AND t.event_id = p_new
             AND t.id = public._event_clone_id(p_new, s.track_id)),
         CASE WHEN s.status = 'cancelled' THEN NULL ELSE
           (SELECT r.id FROM public.event_rooms r
             WHERE r.tenant_id = p_tenant AND r.event_id = p_new
               AND r.id = public._event_clone_id(p_new, s.room_id))
         END,
         (SELECT sp.id FROM public.event_sponsors sp
           WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
             AND sp.id = public._event_clone_id(p_new, s.sponsor_id)),
         s.title_pl, s.title_en, s.description_pl, s.description_en,
         s.affiliation_pl, s.affiliation_en,
         public._event_clone_shift(s.starts_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(s.ends_at, v_src_tz, v_tz, v_delta),
         s.format, x.status, s.capacity, s.requires_signup, s.min_tier_rank,
         s.chatham_house, s.is_private, s.allow_overlap, NULL, NULL, s.sort_order,
         CASE WHEN x.status = 'published' THEN now() END, NULL, v_uid
  FROM public.event_sessions s
  CROSS JOIN LATERAL (
    SELECT CASE WHEN v_draft OR s.status = 'cancelled' THEN 'draft' ELSE s.status END AS status
  ) AS x
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src
    AND s.parent_session_id IS NULL
    AND (v_all OR s.status <> 'cancelled');
  GET DIAGNOSTICS v_parents = ROW_COUNT;

  INSERT INTO public.event_sessions (
    id, tenant_id, event_id, parent_session_id, track_id, room_id, sponsor_id,
    title_pl, title_en, description_pl, description_en, affiliation_pl, affiliation_en,
    starts_at, ends_at, format, status, capacity, requires_signup, min_tier_rank,
    chatham_house, is_private, allow_overlap, stream_url, recording_url, sort_order,
    published_at, cancelled_at, created_by
  )
  SELECT public._event_clone_id(p_new, s.id), p_tenant, p_new, np.id,
         (SELECT t.id FROM public.event_tracks t
           WHERE t.tenant_id = p_tenant AND t.event_id = p_new
             AND t.id = public._event_clone_id(p_new, s.track_id)),
         CASE WHEN s.status = 'cancelled' THEN NULL ELSE
           (SELECT r.id FROM public.event_rooms r
             WHERE r.tenant_id = p_tenant AND r.event_id = p_new
               AND r.id = public._event_clone_id(p_new, s.room_id))
         END,
         (SELECT sp.id FROM public.event_sponsors sp
           WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
             AND sp.id = public._event_clone_id(p_new, s.sponsor_id)),
         s.title_pl, s.title_en, s.description_pl, s.description_en,
         s.affiliation_pl, s.affiliation_en,
         public._event_clone_shift(s.starts_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(s.ends_at, v_src_tz, v_tz, v_delta),
         s.format, x.status, s.capacity, s.requires_signup, s.min_tier_rank,
         s.chatham_house, s.is_private, s.allow_overlap, NULL, NULL, s.sort_order,
         CASE WHEN x.status = 'published' THEN now() END, NULL, v_uid
  FROM public.event_sessions s
  JOIN public.event_sessions np
    ON np.tenant_id = p_tenant AND np.event_id = p_new
   AND np.id = public._event_clone_id(p_new, s.parent_session_id)
  CROSS JOIN LATERAL (
    SELECT CASE WHEN v_draft OR s.status = 'cancelled' THEN 'draft' ELSE s.status END AS status
  ) AS x
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src
    AND s.parent_session_id IS NOT NULL
    AND (v_all OR s.status <> 'cancelled');
  GET DIAGNOSTICS v_children = ROW_COUNT;

  SELECT count(*) INTO v_total FROM public.event_sessions s
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src;

  RETURN jsonb_build_object(
    'copied', jsonb_build_object('tracks', v_tracks, 'sessions', v_parents + v_children),
    'skipped', jsonb_build_object('sessions', v_total - v_parents - v_children)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_agenda(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_agenda(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_agenda(uuid, uuid, uuid, jsonb) IS
  'Klon sciezek i sesji (rodzice przed dziecmi) z przesunieciem w czasie lokalnym; bez transmisji i nagran, odwolane pomijane albo jako szkic bez sali. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_speakers(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_entries integer;
  v_legacy integer;
  v_cast integer := 0;
BEGIN
  INSERT INTO public.event_speaker_entries (id, tenant_id, event_id, speaker_profile_id, sort_order)
  SELECT public._event_clone_id(p_new, en.id), p_tenant, p_new, en.speaker_profile_id, en.sort_order
  FROM public.event_speaker_entries en
  WHERE en.tenant_id = p_tenant AND en.event_id = p_src;
  GET DIAGNOSTICS v_entries = ROW_COUNT;

  -- Legacy rejestr bez tenant_id: zrodlo jest juz sprawdzone w najemcy
  -- wolajacego, a identyfikator wydarzenia jest globalnie unikalny.
  INSERT INTO public.event_speakers (event_id, user_id, sort_order)
  SELECT p_new, es.user_id, es.sort_order
  FROM public.event_speakers es
  WHERE es.event_id = p_src
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_legacy = ROW_COUNT;

  IF (p_ctx->'include'->>'agenda')::boolean THEN
    INSERT INTO public.event_session_speakers (
      id, tenant_id, event_id, session_id, speaker_profile_id, role, sort_order, allow_overlap
    )
    SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, ns.id, c.speaker_profile_id,
           c.role, c.sort_order, c.allow_overlap
    FROM public.event_session_speakers c
    JOIN public.event_sessions ns
      ON ns.tenant_id = p_tenant AND ns.event_id = p_new
     AND ns.id = public._event_clone_id(p_new, c.session_id)
    WHERE c.tenant_id = p_tenant AND c.event_id = p_src;
    GET DIAGNOSTICS v_cast = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'speakers', v_entries, 'legacy_speakers', v_legacy, 'session_speakers', v_cast
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_speakers(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_speakers(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_speakers(uuid, uuid, uuid, jsonb) IS
  'Klon listy prelegentow (event_speaker_entries i legacy event_speakers) oraz obsady sesji, gdy przechodzi agenda. Profile prelegentow sa wspolne (bez kopii). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_tickets(
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
  v_keep boolean := (p_ctx->'options'->>'keep_access_codes')::boolean;
  v_types integer;
  v_packages integer;
BEGIN
  -- Licznik sprzedazy od zera. Bilet z kodem dostepu bez przeniesienia kodu
  -- wraca NIEAKTYWNY - bez kodu bylby otwarty dla kazdego.
  INSERT INTO public.event_ticket_types (
    id, tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    price_cents, currency, quota, sold_count, sales_from, sales_to, min_tier_rank,
    requires_approval, group_id, is_active, sort_order, audience, requires_verification,
    max_per_person, access_code_hash, access_code_hint, early_bird_price_cents,
    early_bird_until, waitlist_enabled, benefits_pl, benefits_en, price_schedule,
    is_hidden, show_price_label, price_label_pl, price_label_en,
    group_registration_enabled, tax_mode, group_max_size
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.key, t.name_pl, t.name_en,
         t.description_pl, t.description_en, t.price_cents, t.currency, t.quota, 0,
         public._event_clone_shift(t.sales_from, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(t.sales_to, v_src_tz, v_tz, v_delta),
         t.min_tier_rank, t.requires_approval,
         (SELECT g.id FROM public.event_groups g
           WHERE g.tenant_id = p_tenant AND g.event_id = p_new
             AND g.id = public._event_clone_id(p_new, t.group_id)),
         t.is_active AND (v_keep OR t.access_code_hash IS NULL),
         t.sort_order, t.audience, t.requires_verification, t.max_per_person,
         CASE WHEN v_keep THEN t.access_code_hash END,
         CASE WHEN v_keep THEN t.access_code_hint ELSE '' END,
         t.early_bird_price_cents,
         public._event_clone_shift(t.early_bird_until, v_src_tz, v_tz, v_delta),
         t.waitlist_enabled, t.benefits_pl, t.benefits_en,
         public._event_clone_shift_schedule(t.price_schedule, v_src_tz, v_tz, v_delta),
         t.is_hidden, t.show_price_label, t.price_label_pl, t.price_label_en,
         t.group_registration_enabled, t.tax_mode, t.group_max_size
  FROM public.event_ticket_types t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_types = ROW_COUNT;

  INSERT INTO public.event_ticket_packages (
    id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, description_pl,
    description_en, audience, requires_verification, seats, price_cents, currency, quota,
    sold_count, sales_from, sales_to, min_tier_rank, is_active, sort_order
  )
  SELECT public._event_clone_id(p_new, k.id), p_tenant, p_new,
         public._event_clone_id(p_new, k.ticket_type_id), k.key, k.name_pl, k.name_en,
         k.description_pl, k.description_en, k.audience, k.requires_verification, k.seats,
         k.price_cents, k.currency, k.quota, 0,
         public._event_clone_shift(k.sales_from, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(k.sales_to, v_src_tz, v_tz, v_delta),
         k.min_tier_rank, k.is_active, k.sort_order
  FROM public.event_ticket_packages k
  WHERE k.tenant_id = p_tenant AND k.event_id = p_src;
  GET DIAGNOSTICS v_packages = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'ticket_types', v_types, 'packages', v_packages
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_tickets(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_tickets(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_tickets(uuid, uuid, uuid, jsonb) IS
  'Klon rodzajow biletow (progi cen, okna sprzedazy i early bird przesuniete, sprzedaz od zera, kod dostepu tylko na zyczenie) i pakietow. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_registration(
  p_tenant uuid, p_src uuid, p_new uuid, p_ctx jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fields integer;
  v_terms integer;
BEGIN
  INSERT INTO public.event_registration_fields (
    id, tenant_id, event_id, key, field_type, label_pl, label_en, help_pl, help_en,
    is_required, options, sort_order, is_qualifying, qualify_operator, qualify_value,
    qualify_outcome, is_active, consent_url_pl, consent_url_en
  )
  SELECT public._event_clone_id(p_new, f.id), p_tenant, p_new, f.key, f.field_type,
         f.label_pl, f.label_en, f.help_pl, f.help_en, f.is_required, f.options, f.sort_order,
         f.is_qualifying, f.qualify_operator, f.qualify_value, f.qualify_outcome, f.is_active,
         f.consent_url_pl, f.consent_url_en
  FROM public.event_registration_fields f
  WHERE f.tenant_id = p_tenant AND f.event_id = p_src;
  GET DIAGNOSTICS v_fields = ROW_COUNT;

  -- Wersja regulaminu zostaje: to ten sam dokument, a zgody sa per term_id.
  INSERT INTO public.event_terms (
    id, tenant_id, event_id, key, label_pl, label_en, body_pl, body_en, external_url,
    display, is_required, version, sort_order, is_active
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.key, t.label_pl, t.label_en,
         t.body_pl, t.body_en, t.external_url, t.display, t.is_required, t.version,
         t.sort_order, t.is_active
  FROM public.event_terms t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_terms = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object('fields', v_fields, 'terms', v_terms));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_registration(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_registration(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_registration(uuid, uuid, uuid, jsonb) IS
  'Klon pol formularza zapisow i regulaminow (bez akceptacji). Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_pages(
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
  v_src_slug text := p_ctx->>'src_slug';
  v_new_slug text := p_ctx->>'slug';
  v_src_root uuid;
  v_new_root uuid;
  v_modules integer;
  v_pages integer := 0;
  v_links integer;
  v_sections integer;
  v_parent uuid;
  v_tail text;
  v_try integer;
  r record;
BEGIN
  SELECT e.root_page_id INTO v_src_root FROM public.events e
  WHERE e.id = p_src AND e.tenant_id = p_tenant;
  SELECT e.root_page_id INTO v_new_root FROM public.events e
  WHERE e.id = p_new AND e.tenant_id = p_tenant;

  -- Korzen: tytul nowej edycji (zasiew), tresc ze zrodla.
  UPDATE public.pages np
     SET builder_data = CASE WHEN sp.builder_data IS NULL THEN NULL
                        ELSE replace(sp.builder_data::text, p_src::text, p_new::text)::jsonb END,
         content_pl = sp.content_pl, content_en = sp.content_en,
         excerpt_pl = sp.excerpt_pl, excerpt_en = sp.excerpt_en,
         layout_overrides = sp.layout_overrides, header_override = sp.header_override,
         toc_override = sp.toc_override, takeaways_pl = sp.takeaways_pl,
         takeaways_en = sp.takeaways_en, takeaways_variant = sp.takeaways_variant,
         template_id = sp.template_id, template_type = sp.template_type, editor = sp.editor,
         cover_image_url = sp.cover_image_url, seo_title_pl = sp.seo_title_pl,
         seo_title_en = sp.seo_title_en, seo_description_pl = sp.seo_description_pl,
         seo_description_en = sp.seo_description_en, seo_noindex = sp.seo_noindex,
         seo_og_image_url = sp.seo_og_image_url, updated_at = now()
    FROM public.pages sp
   WHERE np.id = v_new_root AND np.tenant_id = p_tenant
     AND sp.id = v_src_root AND sp.tenant_id = p_tenant AND sp.deleted_at IS NULL;

  -- Strony modulowe: tresc, tytul i stan (szkic zostaje szkicem) ze zrodla.
  UPDATE public.pages np
     SET builder_data = CASE WHEN sp.builder_data IS NULL THEN NULL
                        ELSE replace(sp.builder_data::text, p_src::text, p_new::text)::jsonb END,
         title_pl = sp.title_pl, title_en = sp.title_en,
         status = CASE WHEN sp.status = 'published' THEN np.status
                  ELSE 'draft'::public.post_status END,
         content_pl = sp.content_pl, content_en = sp.content_en,
         excerpt_pl = sp.excerpt_pl, excerpt_en = sp.excerpt_en,
         layout_overrides = sp.layout_overrides, header_override = sp.header_override,
         toc_override = sp.toc_override, takeaways_pl = sp.takeaways_pl,
         takeaways_en = sp.takeaways_en, takeaways_variant = sp.takeaways_variant,
         template_id = sp.template_id, template_type = sp.template_type, editor = sp.editor,
         menu_order = sp.menu_order, cover_image_url = sp.cover_image_url,
         seo_title_pl = sp.seo_title_pl, seo_title_en = sp.seo_title_en,
         seo_description_pl = sp.seo_description_pl, seo_description_en = sp.seo_description_en,
         seo_noindex = sp.seo_noindex, seo_og_image_url = sp.seo_og_image_url, updated_at = now()
    FROM public.event_pages sep
    JOIN public.pages sp ON sp.id = sep.page_id AND sp.tenant_id = sep.tenant_id AND sp.deleted_at IS NULL
    JOIN public.event_pages nep
      ON nep.tenant_id = sep.tenant_id AND nep.event_id = p_new AND nep.module = sep.module
   WHERE sep.tenant_id = p_tenant AND sep.event_id = p_src AND sep.module IS NOT NULL
     AND np.id = nep.page_id AND np.tenant_id = p_tenant;

  -- Wyglad pozycji modulowych menu (etykieta, ikona, kolor, kolejnosc, grupy).
  UPDATE public.event_pages nep
     SET menu_label_pl = sep.menu_label_pl, menu_label_en = sep.menu_label_en,
         icon = sep.icon, color = sep.color, in_menu = sep.in_menu, sort_order = sep.sort_order,
         visible_to_groups = ARRAY(
           SELECT g.id FROM unnest(sep.visible_to_groups) WITH ORDINALITY AS u(gid, ord)
           JOIN public.event_groups g
             ON g.tenant_id = p_tenant AND g.event_id = p_new
            AND g.id = public._event_clone_id(p_new, u.gid)
           ORDER BY u.ord
         ),
         updated_at = now()
    FROM public.event_pages sep
   WHERE sep.tenant_id = p_tenant AND sep.event_id = p_src AND sep.module IS NOT NULL
     AND nep.tenant_id = p_tenant AND nep.event_id = p_new AND nep.module = sep.module;
  GET DIAGNOSTICS v_modules = ROW_COUNT;

  -- Pozostale strony poddrzewa korzenia: SZKICE, rodzic przed dzieckiem.
  FOR r IN
    WITH RECURSIVE tree AS (
      SELECT p.id, 1 AS depth FROM public.pages p
      WHERE p.tenant_id = p_tenant AND p.parent_id = v_src_root AND p.deleted_at IS NULL
      UNION ALL
      SELECT c.id, tree.depth + 1 FROM public.pages c
      JOIN tree ON c.parent_id = tree.id
      WHERE c.tenant_id = p_tenant AND c.deleted_at IS NULL AND tree.depth < 10
    )
    SELECT sp.*, tree.depth FROM tree
    JOIN public.pages sp ON sp.id = tree.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_pages m
      WHERE m.tenant_id = p_tenant AND m.event_id = p_src AND m.module IS NOT NULL
        AND m.page_id = sp.id
    )
    ORDER BY tree.depth, sp.menu_order, sp.title_pl
  LOOP
    -- Rodzic: nowy korzen, nowa strona modulowa albo wczesniej skopiowana
    -- strona (glebokosc rosnaco, wiec rodzic juz istnieje).
    v_parent := NULL;
    IF r.parent_id = v_src_root THEN
      v_parent := v_new_root;
    ELSE
      SELECT nep.page_id INTO v_parent
      FROM public.event_pages sep
      JOIN public.event_pages nep
        ON nep.tenant_id = sep.tenant_id AND nep.event_id = p_new AND nep.module = sep.module
      WHERE sep.tenant_id = p_tenant AND sep.event_id = p_src AND sep.module IS NOT NULL
        AND sep.page_id = r.parent_id;
      v_parent := COALESCE(v_parent, public._event_clone_id(p_new, r.parent_id));
    END IF;

    v_tail := CASE
      WHEN left(r.slug, char_length(v_src_slug) + 1) = v_src_slug || '-'
        THEN substr(r.slug, char_length(v_src_slug) + 2)
      ELSE r.slug
    END;

    FOR v_try IN 1..5 LOOP
      BEGIN
        INSERT INTO public.pages (
          id, tenant_id, parent_id, slug, title_pl, title_en, status, editor, template_type,
          menu_order, builder_data, content_pl, content_en, excerpt_pl, excerpt_en,
          layout_overrides, header_override, toc_override, takeaways_pl, takeaways_en,
          takeaways_variant, template_id, cover_image_url, seo_title_pl, seo_title_en,
          seo_description_pl, seo_description_en, seo_noindex, seo_og_image_url, author_id
        ) VALUES (
          public._event_clone_id(p_new, r.id), p_tenant, v_parent,
          public._event_unique_page_slug(p_tenant, v_new_slug || '-' || v_tail),
          r.title_pl, r.title_en, 'draft'::public.post_status, r.editor, r.template_type,
          r.menu_order,
          CASE WHEN r.builder_data IS NULL THEN NULL
               ELSE replace(r.builder_data::text, p_src::text, p_new::text)::jsonb END,
          r.content_pl, r.content_en, r.excerpt_pl, r.excerpt_en, r.layout_overrides,
          r.header_override, r.toc_override, r.takeaways_pl, r.takeaways_en,
          r.takeaways_variant, r.template_id, r.cover_image_url, r.seo_title_pl,
          r.seo_title_en, r.seo_description_pl, r.seo_description_en, r.seo_noindex,
          r.seo_og_image_url, v_uid
        );
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_try = 5 THEN RAISE; END IF;
      END;
    END LOOP;
    v_pages := v_pages + 1;
  END LOOP;

  -- Pozycje menu spoza modulow: skopiowana strona poddrzewa albo TA SAMA
  -- strona serwisu (przypieta spoza poddrzewa).
  INSERT INTO public.event_pages (
    id, tenant_id, event_id, page_id, menu_label_pl, menu_label_en, icon, color, in_menu,
    sort_order, visible_to_groups
  )
  SELECT public._event_clone_id(p_new, sep.id), p_tenant, p_new,
         CASE
           WHEN sep.page_id = v_src_root THEN v_new_root
           ELSE COALESCE(
             (SELECT cp.id FROM public.pages cp
               WHERE cp.tenant_id = p_tenant AND cp.id = public._event_clone_id(p_new, sep.page_id)),
             sep.page_id)
         END,
         sep.menu_label_pl, sep.menu_label_en, sep.icon, sep.color, sep.in_menu, sep.sort_order,
         ARRAY(
           SELECT g.id FROM unnest(sep.visible_to_groups) WITH ORDINALITY AS u(gid, ord)
           JOIN public.event_groups g
             ON g.tenant_id = p_tenant AND g.event_id = p_new
            AND g.id = public._event_clone_id(p_new, u.gid)
           ORDER BY u.ord
         )
  FROM public.event_pages sep
  JOIN public.pages sp ON sp.id = sep.page_id AND sp.tenant_id = sep.tenant_id AND sp.deleted_at IS NULL
  WHERE sep.tenant_id = p_tenant AND sep.event_id = p_src AND sep.module IS NULL
  ON CONFLICT (tenant_id, event_id, page_id) DO NOTHING;
  GET DIAGNOSTICS v_links = ROW_COUNT;

  INSERT INTO public.event_page_sections (
    tenant_id, event_id, section_key, is_visible, sort_order, heading_pl, heading_en,
    visibility, min_tier_rank, created_by
  )
  SELECT p_tenant, p_new, s.section_key, s.is_visible, s.sort_order, s.heading_pl,
         s.heading_en, s.visibility, s.min_tier_rank, v_uid
  FROM public.event_page_sections s
  WHERE s.tenant_id = p_tenant AND s.event_id = p_src;
  GET DIAGNOSTICS v_sections = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'module_pages', v_modules, 'pages', v_pages, 'page_links', v_links, 'page_sections', v_sections
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_pages(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_pages(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_pages(uuid, uuid, uuid, jsonb) IS
  'Klon stron: tresc korzenia i stron modulowych (zasianych), wyglad menu, pozostale strony poddrzewa jako szkice z unikalnym slugiem, pozycje menu i sekcje strony glownej. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_onsite(
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
  v_checkpoints integer;
  v_total integer;
  v_templates integer;
BEGIN
  -- Punkt sesji bez skopiowanej sesji i stoisko bez skopiowanego sponsora
  -- lamalyby CHECK rodzaju - sa pomijane (i liczone).
  INSERT INTO public.event_checkpoints (
    id, tenant_id, event_id, name_pl, name_en, kind, session_id, room_id, sponsor_id,
    direction_mode, access_mode, capacity, dedupe_window_seconds, is_active, sort_order,
    created_by
  )
  SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, c.name_pl, c.name_en, c.kind,
         x.session_id,
         (SELECT r.id FROM public.event_rooms r
           WHERE r.tenant_id = p_tenant AND r.event_id = p_new
             AND r.id = public._event_clone_id(p_new, c.room_id)),
         x.sponsor_id, c.direction_mode, c.access_mode, c.capacity, c.dedupe_window_seconds,
         c.is_active, c.sort_order, v_uid
  FROM public.event_checkpoints c
  CROSS JOIN LATERAL (
    SELECT
      (SELECT s.id FROM public.event_sessions s
        WHERE s.tenant_id = p_tenant AND s.event_id = p_new
          AND s.id = public._event_clone_id(p_new, c.session_id)) AS session_id,
      (SELECT sp.id FROM public.event_sponsors sp
        WHERE sp.tenant_id = p_tenant AND sp.event_id = p_new
          AND sp.id = public._event_clone_id(p_new, c.sponsor_id)) AS sponsor_id
  ) AS x
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src
    AND (c.kind <> 'session' OR x.session_id IS NOT NULL)
    AND (c.kind <> 'company_booth' OR x.sponsor_id IS NOT NULL);
  GET DIAGNOSTICS v_checkpoints = ROW_COUNT;

  SELECT count(*) INTO v_total FROM public.event_checkpoints c
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src;

  INSERT INTO public.event_badge_templates (
    id, tenant_id, event_id, name, paper_format, width_mm, height_mm, orientation,
    double_fold, background_color, background_image_url, show_qr, qr_size_mm, elements,
    version, is_default, created_by
  )
  SELECT public._event_clone_id(p_new, b.id), p_tenant, p_new, b.name, b.paper_format,
         b.width_mm, b.height_mm, b.orientation, b.double_fold, b.background_color,
         b.background_image_url, b.show_qr, b.qr_size_mm, b.elements, 1, b.is_default, v_uid
  FROM public.event_badge_templates b
  WHERE b.tenant_id = p_tenant AND b.event_id = p_src;
  GET DIAGNOSTICS v_templates = ROW_COUNT;

  RETURN jsonb_build_object(
    'copied', jsonb_build_object('checkpoints', v_checkpoints, 'badge_templates', v_templates),
    'skipped', jsonb_build_object('checkpoints', v_total - v_checkpoints)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_onsite(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_onsite(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_onsite(uuid, uuid, uuid, jsonb) IS
  'Klon punktow odprawy (bez celu - pominiete) i szablonow identyfikatorow (wersja od 1). Urzadzen skanera nigdy. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_meetings(
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
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_days integer := (p_ctx->>'day_shift')::integer;
  v_settings integer;
  v_tables integer;
  v_rules integer;
BEGIN
  -- Dni gieldy przesuwaja sie o cale dni lokalne; strefa gieldy idzie za
  -- strefa wydarzenia, jesli byla z nia rowna.
  INSERT INTO public.event_meeting_settings (
    id, tenant_id, event_id, is_enabled, slot_minutes, break_minutes, day_start_time,
    day_end_time, meeting_days, timezone, invites_open_at, invites_close_at,
    max_invites_per_person, max_meetings_per_day, invite_expires_after_hours, visibility,
    intro_pl, intro_en, updated_by
  )
  SELECT public._event_clone_id(p_new, m.id), p_tenant, p_new, m.is_enabled, m.slot_minutes,
         m.break_minutes, m.day_start_time, m.day_end_time,
         ARRAY(
           SELECT u.d + v_days FROM unnest(m.meeting_days) WITH ORDINALITY AS u(d, ord)
           ORDER BY u.ord
         ),
         CASE WHEN m.timezone = v_src_tz THEN v_tz ELSE m.timezone END,
         public._event_clone_shift(m.invites_open_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(m.invites_close_at, v_src_tz, v_tz, v_delta),
         m.max_invites_per_person, m.max_meetings_per_day, m.invite_expires_after_hours,
         m.visibility, m.intro_pl, m.intro_en, v_uid
  FROM public.event_meeting_settings m
  WHERE m.tenant_id = p_tenant AND m.event_id = p_src;
  GET DIAGNOSTICS v_settings = ROW_COUNT;

  INSERT INTO public.event_meeting_tables (
    id, tenant_id, event_id, label, zone, capacity, room_id, note, is_active, sort_order,
    created_by
  )
  SELECT public._event_clone_id(p_new, t.id), p_tenant, p_new, t.label, t.zone, t.capacity,
         (SELECT r.id FROM public.event_rooms r
           WHERE r.tenant_id = p_tenant AND r.event_id = p_new
             AND r.id = public._event_clone_id(p_new, t.room_id)),
         t.note, t.is_active, t.sort_order, v_uid
  FROM public.event_meeting_tables t
  WHERE t.tenant_id = p_tenant AND t.event_id = p_src;
  GET DIAGNOSTICS v_tables = ROW_COUNT;

  INSERT INTO public.event_meeting_rule_groups (id, tenant_id, event_id, group_id, side)
  SELECT public._event_clone_id(p_new, g.id), p_tenant, p_new,
         public._event_clone_id(p_new, g.group_id), g.side
  FROM public.event_meeting_rule_groups g
  WHERE g.tenant_id = p_tenant AND g.event_id = p_src;
  GET DIAGNOSTICS v_rules = ROW_COUNT;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'meeting_settings', v_settings, 'meeting_tables', v_tables, 'meeting_rules', v_rules
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_meetings(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_meetings(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_meetings(uuid, uuid, uuid, jsonb) IS
  'Klon ustawien gieldy spotkan (dni i okno zaproszen przesuniete), stolikow i regul grup. Spotkan i dostepnosci nigdy. Pomocnik klonu edycji.';

CREATE OR REPLACE FUNCTION public._event_clone_cfp(
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
  v_src_tz text := p_ctx->>'src_tz';
  v_tz text := p_ctx->>'tz';
  v_delta interval := (p_ctx->>'delta')::interval;
  v_settings integer;
  v_fields integer;
  v_reviewers integer := 0;
BEGIN
  INSERT INTO public.event_cfp_settings (
    id, tenant_id, event_id, status, opens_at, closes_at, intro_pl, intro_en, guidelines_pl,
    guidelines_en, formats, track_ids, max_per_submitter, allow_co_speakers, review_blind,
    score_max, review_criteria, min_reviews, speaker_group_id, speaker_ticket_type_id,
    updated_by
  )
  SELECT public._event_clone_id(p_new, c.id), p_tenant, p_new, 'draft',
         public._event_clone_shift(c.opens_at, v_src_tz, v_tz, v_delta),
         public._event_clone_shift(c.closes_at, v_src_tz, v_tz, v_delta),
         c.intro_pl, c.intro_en, c.guidelines_pl, c.guidelines_en, c.formats,
         ARRAY(
           SELECT t.id FROM unnest(c.track_ids) WITH ORDINALITY AS u(tid, ord)
           JOIN public.event_tracks t
             ON t.tenant_id = p_tenant AND t.event_id = p_new
            AND t.id = public._event_clone_id(p_new, u.tid)
           ORDER BY u.ord
         ),
         c.max_per_submitter, c.allow_co_speakers, c.review_blind, c.score_max,
         c.review_criteria, c.min_reviews,
         (SELECT g.id FROM public.event_groups g
           WHERE g.tenant_id = p_tenant AND g.event_id = p_new
             AND g.id = public._event_clone_id(p_new, c.speaker_group_id)),
         (SELECT t.id FROM public.event_ticket_types t
           WHERE t.tenant_id = p_tenant AND t.event_id = p_new
             AND t.id = public._event_clone_id(p_new, c.speaker_ticket_type_id)),
         v_uid
  FROM public.event_cfp_settings c
  WHERE c.tenant_id = p_tenant AND c.event_id = p_src;
  GET DIAGNOSTICS v_settings = ROW_COUNT;

  INSERT INTO public.event_cfp_fields (
    id, tenant_id, event_id, key, field_type, label_pl, label_en, help_pl, help_en,
    is_required, options, sort_order, is_active
  )
  SELECT public._event_clone_id(p_new, f.id), p_tenant, p_new, f.key, f.field_type,
         f.label_pl, f.label_en, f.help_pl, f.help_en, f.is_required, f.options, f.sort_order,
         f.is_active
  FROM public.event_cfp_fields f
  WHERE f.tenant_id = p_tenant AND f.event_id = p_src;
  GET DIAGNOSTICS v_fields = ROW_COUNT;

  IF (p_ctx->'options'->>'cfp_reviewers')::boolean THEN
    INSERT INTO public.event_cfp_reviewers (
      id, tenant_id, event_id, user_id, track_ids, can_see_identity, is_active, added_by
    )
    SELECT public._event_clone_id(p_new, rv.id), p_tenant, p_new, rv.user_id,
           ARRAY(
             SELECT t.id FROM unnest(rv.track_ids) WITH ORDINALITY AS u(tid, ord)
             JOIN public.event_tracks t
               ON t.tenant_id = p_tenant AND t.event_id = p_new
              AND t.id = public._event_clone_id(p_new, u.tid)
             ORDER BY u.ord
           ),
           rv.can_see_identity, rv.is_active, v_uid
    FROM public.event_cfp_reviewers rv
    WHERE rv.tenant_id = p_tenant AND rv.event_id = p_src;
    GET DIAGNOSTICS v_reviewers = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('copied', jsonb_build_object(
    'cfp_settings', v_settings, 'cfp_fields', v_fields, 'cfp_reviewers', v_reviewers
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_clone_cfp(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_clone_cfp(uuid, uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public._event_clone_cfp(uuid, uuid, uuid, jsonb) IS
  'Klon ustawien naboru prelegentow (zawsze jako draft, okno przesuniete), pol formularza i opcjonalnie recenzentow. Zgloszen, ocen i materialow nigdy. Pomocnik klonu edycji.';
