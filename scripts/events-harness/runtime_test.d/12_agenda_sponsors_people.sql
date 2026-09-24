-- ============================================================================
-- 12_agenda_sponsors_people - SPONSOR SCIEZKI I DEBATY, AFILIACJA, OSOBY BEZ
--                             KONTA W PUBLICZNEJ AGENDZIE
--
-- PO CO TEN PLIK ISTNIEJE
-- 20260923120000_event_agenda_sponsor_affiliation dokłada do `event_tracks`
-- i `event_sessions` kolumne `sponsor_id` (klucz obcy POTROJNY do
-- `event_sponsors`), do sesji dwujezyczna afiliacje i przepisuje szesc RPC
-- (zapis/lista sciezek, zapis/lista/szczegol sesji, publiczne `event_agenda`).
-- 20260923130000_event_agenda_people_without_accounts wpuszcza do obsady
-- publicznej osoby z kartoteki `event_people`. Oba pliki powstaly w panelu
-- Lovable i zaden nie mial dotad ani jednej asercji wykonania.
--
-- CO DOWODZIMY - kazda regula z drugim bokiem:
--   (1) sponsor z INNEGO wydarzenia jest odrzucany przez RPC (zapis nowej
--       sciezki, edycja sciezki, zapis sesji) i przez goly INSERT (klucz obcy);
--   (2) zapis czesciowy (bez klucza `sponsor_id` / `affiliation_*`) NIE kasuje
--       przypiecia ani afiliacji - panel zapisuje z roznych ekranow;
--   (3) afiliacja ponad 300 znakow jest odrzucana, pusta schodzi do NULL;
--   (4) publiczna agenda pokazuje WYLACZNIE przypiecie OGLOSZONE - nieogloszone
--       jest dla anonima NULL-em, po ogloszeniu wraca;
--   (5) usuniecie przypiecia zeruje `sponsor_id`, a sciezka i sesja zostaja
--       (`ON DELETE SET NULL (sponsor_id)` - bez listy kolumn PostgreSQL
--       wyzerowalby tez `tenant_id` i `event_id`);
--   (6) osoba BEZ konta z publiczna nakladka jest w obsadzie z nazwa, zdjeciem
--       i stanowiskiem, bez adresu poczty; nakladka niepubliczna - nie.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 12 agenda: sponsor sciezki i debaty, afiliacja, osoby bez konta =='

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('12a00000-0000-0000-0000-0000000000a1', 'redaktor.12@agenda.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('12a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'Redaktor 12', 'redaktor-12')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('12a00000-0000-0000-0000-0000000000a1', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('12e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'agenda-12', 'Kongres 12', 'Congress 12', now() + interval '30 days', 'published'),
  ('12e00000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
   'agenda-12-inne', 'Inne wydarzenie', 'Other event', now() + interval '40 days', 'published')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('12c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Orlen'),
  ('12c00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 'Ukryta SA')
ON CONFLICT (id) DO NOTHING;

-- Rola `partner`, a nie `sponsor`: przypiecie `sponsor` wymaga poziomu do
-- publikacji (CHECK `is_published = false OR role <> 'sponsor' OR tier_id ...`),
-- a przedmiotem tego pliku jest agenda, nie poziomy.
INSERT INTO public.event_sponsors
  (id, tenant_id, event_id, company_id, role, is_published, snapshot_name, snapshot_logo_url)
VALUES
  ('12500000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   '12e00000-0000-0000-0000-0000000000e1', '12c00000-0000-0000-0000-0000000000c1',
   'partner', true, 'Orlen', 'https://cdn.test/orlen.png'),
  ('12500000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111',
   '12e00000-0000-0000-0000-0000000000e1', '12c00000-0000-0000-0000-0000000000c2',
   'partner', false, 'Ukryta SA', NULL),
  ('12500000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111',
   '12e00000-0000-0000-0000-0000000000e2', '12c00000-0000-0000-0000-0000000000c1',
   'partner', true, 'Orlen (inne wydarzenie)', NULL)
ON CONFLICT (id) DO NOTHING;

DO $do$
DECLARE
  v_admin constant uuid := '12a00000-0000-0000-0000-0000000000a1';
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_event constant uuid := '12e00000-0000-0000-0000-0000000000e1';
  v_other_event constant uuid := '12e00000-0000-0000-0000-0000000000e2';
  v_s1 constant uuid := '12500000-0000-0000-0000-0000000000b1';
  v_s2 constant uuid := '12500000-0000-0000-0000-0000000000b2';
  v_s3 constant uuid := '12500000-0000-0000-0000-0000000000b3';
  v_track uuid;
  v_session uuid;
  v_row record;
  v_speakers jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_admin, v_tenant);

  -- (1) sciezka: sponsor tego wydarzenia przechodzi, z innego - nie.
  v_track := public.admin_event_track_save(jsonb_build_object(
    'event_id', v_event, 'key', 'energia', 'name_pl', 'Energia', 'name_en', 'Energy',
    'sponsor_id', v_s1));
  PERFORM pg_temp.assert(
    (SELECT sponsor_id FROM public.event_tracks WHERE id = v_track) = v_s1,
    '12/sciezka: RPC zapisuje sponsora z TEGO wydarzenia');

  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_track_save(jsonb_build_object(
      'event_id', %L, 'key', 'obca', 'name_pl', 'Obca', 'name_en', 'Foreign',
      'sponsor_id', %L))$q$, v_event, v_s3),
    'sponsor_not_found',
    '12/sciezka: nowa sciezka ze sponsorem INNEGO wydarzenia jest odrzucana');

  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_track_save(jsonb_build_object(
      'id', %L, 'name_pl', 'Energia', 'name_en', 'Energy', 'sponsor_id', %L))$q$,
      v_track, v_s3),
    'sponsor_not_found',
    '12/sciezka: edycja nie przepina sponsora z INNEGO wydarzenia');

  -- (2) edycja bez klucza `sponsor_id` zostawia przypiecie.
  PERFORM public.admin_event_track_save(jsonb_build_object(
    'id', v_track, 'name_pl', 'Energia i klimat', 'name_en', 'Energy and climate'));
  PERFORM pg_temp.assert(
    (SELECT sponsor_id FROM public.event_tracks WHERE id = v_track) = v_s1,
    '12/sciezka: zapis czesciowy (bez sponsor_id) NIE kasuje sponsora');

  SELECT * INTO v_row FROM public.admin_event_tracks_list(v_event) t WHERE t.id = v_track;
  PERFORM pg_temp.assert(v_row.sponsor_name = 'Orlen' AND v_row.sponsor_role = 'partner',
    '12/sciezka: lista panelu oddaje nazwe i role sponsora');

  -- (1)(3) sesja: sponsor NIEOGLOSZONY tego wydarzenia wolno przypiac,
  -- afiliacja jest przycinana.
  v_session := public.admin_event_session_save(jsonb_build_object(
    'event_id', v_event, 'title_pl', 'Debata o sieciach', 'title_en', 'Grid debate',
    'starts_at', now() + interval '30 days', 'ends_at', now() + interval '30 days 90 minutes',
    'status', 'published', 'track_id', v_track, 'sponsor_id', v_s2,
    'affiliation_pl', '  Rada Programowa  ', 'affiliation_en', ''));
  SELECT * INTO v_row FROM public.event_sessions WHERE id = v_session;
  PERFORM pg_temp.assert(
    v_row.sponsor_id = v_s2 AND v_row.affiliation_pl = 'Rada Programowa'
      AND v_row.affiliation_en IS NULL,
    '12/sesja: sponsor i afiliacja zapisane, pusta afiliacja EN schodzi do NULL');

  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_session_save(jsonb_build_object(
      'id', %L, 'sponsor_id', %L))$q$, v_session, v_s3),
    'sponsor_not_found',
    '12/sesja: sponsor INNEGO wydarzenia jest odrzucany');

  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_session_save(jsonb_build_object(
      'id', %L, 'affiliation_pl', %L))$q$, v_session, repeat('x', 301)),
    'invalid_affiliation',
    '12/sesja: afiliacja ponad 300 znakow jest odrzucana');

  -- (2) edycja samego tytulu nie rusza sponsora ani afiliacji.
  PERFORM public.admin_event_session_save(jsonb_build_object(
    'id', v_session, 'title_pl', 'Debata o sieciach przesylowych'));
  SELECT * INTO v_row FROM public.event_sessions WHERE id = v_session;
  PERFORM pg_temp.assert(
    v_row.sponsor_id = v_s2 AND v_row.affiliation_pl = 'Rada Programowa',
    '12/sesja: zapis czesciowy NIE kasuje sponsora ani afiliacji');

  SELECT * INTO v_row FROM public.admin_event_session_detail(v_session);
  PERFORM pg_temp.assert(
    v_row.sponsor_name = 'Ukryta SA' AND v_row.affiliation_pl = 'Rada Programowa',
    '12/sesja: szczegol panelu oddaje sponsora i afiliacje');

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_sessions_list(v_event, NULL, NULL, NULL, 'ukryta')) = 1
      AND (SELECT count(*) FROM public.admin_event_sessions_list(v_event, NULL, NULL, NULL, 'rada')) = 1,
    '12/sesja: wyszukiwarka panelu trafia po nazwie sponsora i po afiliacji');

  -- (1) goly INSERT tez nie ominie klucza potrojnego.
  PERFORM pg_temp.assert_raises_like(
    format($q$UPDATE public.event_sessions SET sponsor_id = %L WHERE id = %L$q$, v_s3, v_session),
    'event_sessions_sponsor_fk',
    '12/sesja: klucz obcy potrojny odrzuca sponsora innego wydarzenia bez RPC');

  -- (6) obsada: osoba bez konta (publiczna nakladka) i osoba ukryta.
  INSERT INTO public.event_people
    (id, tenant_id, first_name, last_name, email, job_title, photo_url)
  VALUES
    ('12700000-0000-0000-0000-0000000000d1', v_tenant, 'Anna', 'Bezkonta',
     'anna.bezkonta@example.org', 'Profesorka SGH', 'https://cdn.test/anna.jpg'),
    ('12700000-0000-0000-0000-0000000000d2', v_tenant, 'Jan', 'Ukryty',
     'jan.ukryty@example.org', 'Analityk', NULL);
  INSERT INTO public.speaker_profiles (id, tenant_id, user_id, person_id, is_public) VALUES
    ('12900000-0000-0000-0000-0000000000f1', v_tenant, NULL,
     '12700000-0000-0000-0000-0000000000d1', true),
    ('12900000-0000-0000-0000-0000000000f2', v_tenant, NULL,
     '12700000-0000-0000-0000-0000000000d2', false);
  INSERT INTO public.event_session_speakers
    (tenant_id, event_id, session_id, speaker_profile_id, role, sort_order)
  VALUES
    (v_tenant, v_event, v_session, '12900000-0000-0000-0000-0000000000f1', 'moderator', 1),
    (v_tenant, v_event, v_session, '12900000-0000-0000-0000-0000000000f2', 'panelist', 2);

  -- WIDOK ANONIMA: to jest plaszczyzna tresci z `GRANT EXECUTE ... TO anon`.
  PERFORM pg_temp.act_as();

  SELECT * INTO v_row FROM public.event_agenda('agenda-12') a WHERE a.id = v_session;
  PERFORM pg_temp.assert(v_row.id IS NOT NULL, '12/front: opublikowana debata jest w agendzie');
  -- (4) nieogloszone przypiecie debaty jest dla anonima NULL-em...
  PERFORM pg_temp.assert(
    v_row.session_sponsor_id IS NULL AND v_row.session_sponsor_name IS NULL,
    '12/front: sponsor NIEOGLOSZONY nie wychodzi do agendy');
  -- ...a ogloszone przypiecie sciezki wychodzi.
  PERFORM pg_temp.assert(
    v_row.track_sponsor_id = v_s1 AND v_row.track_sponsor_name = 'Orlen'
      AND v_row.track_sponsor_logo_url = 'https://cdn.test/orlen.png',
    '12/front: sponsor OGLOSZONY sciezki wychodzi z nazwa i logo');
  PERFORM pg_temp.assert(v_row.affiliation_pl = 'Rada Programowa',
    '12/front: afiliacja debaty jest publiczna');

  -- (6) obsada.
  v_speakers := v_row.speakers;
  PERFORM pg_temp.assert(jsonb_array_length(v_speakers) = 1,
    '12/front: w obsadzie jest osoba z publiczna nakladka, a ukryta nie - dostano: '
      || jsonb_array_length(v_speakers));
  PERFORM pg_temp.assert(
    v_speakers->0->>'display_name' = 'Anna Bezkonta'
      AND v_speakers->0->>'avatar_url' = 'https://cdn.test/anna.jpg'
      AND v_speakers->0->>'headline_pl' = 'Profesorka SGH'
      AND v_speakers->0->>'role' = 'moderator',
    '12/front: osoba BEZ konta ma nazwe, zdjecie i stanowisko z kartoteki');
  PERFORM pg_temp.assert(
    v_speakers->0->>'user_id' = '12700000-0000-0000-0000-0000000000d1'
      AND v_speakers->0->>'slug' IS NULL,
    '12/front: klucz wiersza osoby to id kartoteki, bez odnosnika do konta');
  PERFORM pg_temp.assert(
    NOT (v_speakers::text ILIKE '%example.org%') AND NOT (v_speakers->0 ? 'email'),
    '12/front: adres poczty osoby NIE wychodzi do agendy');

  -- (4) drugi bok: po ogloszeniu przypiecia debaty sponsor wraca.
  UPDATE public.event_sponsors SET is_published = true WHERE id = v_s2;
  SELECT * INTO v_row FROM public.event_agenda('agenda-12') a WHERE a.id = v_session;
  PERFORM pg_temp.assert(v_row.session_sponsor_name = 'Ukryta SA',
    '12/front: po ogloszeniu przypiecia sponsor debaty jest widoczny');

  -- (5) usuniecie przypiecia zeruje wylacznie sponsor_id.
  DELETE FROM public.event_sponsors WHERE id = v_s1;
  SELECT * INTO v_row FROM public.event_tracks WHERE id = v_track;
  PERFORM pg_temp.assert(
    v_row.id IS NOT NULL AND v_row.sponsor_id IS NULL
      AND v_row.tenant_id = v_tenant AND v_row.event_id = v_event,
    '12/sciezka: usuniecie sponsora zeruje sponsor_id, sciezka zostaje w swoim wydarzeniu');
  DELETE FROM public.event_sponsors WHERE id = v_s2;
  SELECT * INTO v_row FROM public.event_sessions WHERE id = v_session;
  PERFORM pg_temp.assert(
    v_row.id IS NOT NULL AND v_row.sponsor_id IS NULL AND v_row.event_id = v_event,
    '12/sesja: usuniecie sponsora zeruje sponsor_id, debata zostaje');

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_agenda('agenda-12-inne')) = 0
      AND v_other_event IS NOT NULL,
    '12/front: agenda innego wydarzenia nie widzi debat tego wydarzenia');
END $do$;

ROLLBACK;
