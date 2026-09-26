-- ============================================================================
-- 92_event_clone - NOWA EDYCJA Z POPRZEDNIEJ (migracja 20260926170000)
--
-- PO CO TEN PLIK ISTNIEJE
-- Klon wydarzenia kopiuje kilkadziesiat tabel naraz, a jego gwarancje nie
-- daja sie potwierdzic lektura SQL-a: wyzwalacz zasiewu grup przy INSERT-cie,
-- wyzwalacz okna sesji, kolumna generowana `time_range`, ograniczenia
-- EXCLUDE sal, unikalnosc slugow stron w najemcy, zlozone klucze obce
-- `(tenant_id, event_id, x_id)`, przesuniecie przez zmiane czasu letniego,
-- idempotencja w tej samej transakcji. Kazda obietnica ma tu dowod
-- z oboma bokami (zgoda i odmowa).
--
-- CZEGO TU DOWODZIMY
--   (a) odmowy rol (anonim, zwykly uzytkownik, redaktor) i obcego najemcy,
--       granty funkcji (pomocnicy nie sa wolalni z klienta);
--   (b) walidacja ladunku - kazdy kod odmowy, ktory da sie osiagnac;
--   (c) podglad: liczniki, podpowiedz daty, ostrzezenia, blokady, BEZ zapisu;
--   (d) pelny klon bogatego wydarzenia: kazdy modul, remapowanie kluczy,
--       przesuniecie w czasie lokalnym PRZEZ zmiane CET -> CEST (09:30 zostaje
--       09:30), szkic, rodowod, nic osobowego, CRM (os czasu firmy, zadania
--       odnowienia z deduplikacja), zdarzenie domenowe;
--   (e) idempotencja: powtorka tym samym kluczem = ta sama edycja
--       (`replayed`), inny aktor z tym kluczem = konflikt, klucz w toku;
--   (f) warianty przelacznikow: bez agendy, bez biletow (kody), z kodami
--       dostepu, z sesjami odwolanymi, zmiana strefy, zapisy zewnetrzne;
--   (g) lista edycji i SET NULL rodowodu po skasowaniu zrodla.
--
-- CZEGO NIE SPRAWDZA: wspolbieznosci dwoch sesji (idempotencja jest
-- sprawdzana sekwencyjnie), triggerow produkcyjnych `pages` i `crm_tasks`,
-- ktorych atrapa nie odtwarza (workflow publikacji, zdarzenia zadan CRM).
--
-- DATY SA WZGLEDNE DO BIEZACEGO ROKU (rok+1 i rok+2): 20 marca jest zawsze
-- przed zmiana czasu (ostatnia niedziela marca >= 25.), 2 kwietnia zawsze po
-- niej, a obie daty zawsze w przyszlosci - ostrzezenia "w przeszlosci" nie
-- zmieniaja sie z uplywem kalendarza.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 92 klon edycji: kopia konfiguracji, przesuniecie dat, idempotencja =='

BEGIN;

-- Czas lokalny Warszawy w roku biezacy+offset.
CREATE OR REPLACE FUNCTION pg_temp.t92(_year_offset int, _month int, _day int, _hour int, _minute int)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT make_timestamptz(extract(year FROM now())::int + _year_offset, _month, _day, _hour,
                          _minute, 0, 'Europe/Warsaw');
$$;

-- Godzina lokalna chwili w strefie.
CREATE OR REPLACE FUNCTION pg_temp.hm92(_ts timestamptz, _tz text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT to_char(_ts AT TIME ZONE _tz, 'HH24:MI'); $$;

-- Wyniki wywolan klonu miedzy instrukcjami.
CREATE TEMP TABLE f92 (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
CREATE OR REPLACE FUNCTION pg_temp.f92_id(_k text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (v->>'event_id')::uuid FROM f92 WHERE k = _k;
$$;
CREATE OR REPLACE FUNCTION pg_temp.map92(_k text, _old uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT public._event_clone_id(pg_temp.f92_id(_k), _old);
$$;

-- Poprawny ladunek bazowy (zrodlo E1, start rok+2 2 kwietnia 09:00) + nadpisania.
CREATE OR REPLACE FUNCTION pg_temp.p92(_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'source_event_id', '92e00000-0000-0000-0000-0000000000e1',
    'title_pl', 'Kongres 92 2027',
    'title_en', 'Congress 92 2027',
    'starts_at', pg_temp.t92(2, 4, 2, 9, 0)
  ) || _extra;
$$;

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA - bogate wydarzenie zrodlowe E1 w najemcy A
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('92000000-0000-0000-0000-0000000000b0', 'Tenant 92 B', 't92b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('92a00000-0000-0000-0000-0000000000a1', 'klon.admin@example.org'),
  ('92a00000-0000-0000-0000-0000000000a2', 'klon.redaktor@example.org'),
  ('92a00000-0000-0000-0000-0000000000a3', 'klon.uzytkownik@example.org'),
  ('92a00000-0000-0000-0000-0000000000a4', 'klon.prelegent@example.org'),
  ('92a00000-0000-0000-0000-0000000000a5', 'klon.super@example.org'),
  ('92a00000-0000-0000-0000-0000000000a6', 'klon.admin.drugi@example.org'),
  ('92a00000-0000-0000-0000-0000000000a7', 'klon.opiekun@example.org'),
  ('92a00000-0000-0000-0000-0000000000b1', 'klon.admin.b@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('92a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111'),
  ('92a00000-0000-0000-0000-0000000000a2', 'editor', '11111111-1111-1111-1111-111111111111'),
  ('92a00000-0000-0000-0000-0000000000a5', 'super_admin', '11111111-1111-1111-1111-111111111111'),
  ('92a00000-0000-0000-0000-0000000000a6', 'admin', '11111111-1111-1111-1111-111111111111'),
  ('92a00000-0000-0000-0000-0000000000b1', 'admin', '92000000-0000-0000-0000-0000000000b0')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('92a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 92', 'klon-admin'),
  ('92a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Redaktor 92', 'klon-redaktor'),
  ('92a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Uzytkownik 92', 'klon-uzytkownik'),
  ('92a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'Prelegent 92', 'klon-prelegent'),
  ('92a00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'Super 92', 'klon-super'),
  ('92a00000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111', 'Admin drugi 92', 'klon-admin-drugi'),
  ('92a00000-0000-0000-0000-0000000000a7', '11111111-1111-1111-1111-111111111111', 'Opiekun 92', 'klon-opiekun'),
  ('92a00000-0000-0000-0000-0000000000b1', '92000000-0000-0000-0000-0000000000b0', 'Admin 92 B', 'klon-admin-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_types (id, tenant_id, key, name_pl, name_en, is_active) VALUES
  ('92f00000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   'kongres_92', 'Kongres 92', 'Congress 92', false);

INSERT INTO public.events (
  id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status,
  rsvp_opens_at, cover_url, event_type_id, join_url, recording_url, ticket_price_cents,
  program_id, conversation_id
) VALUES
  ('92e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'kongres-92', 'Kongres 92 2026', 'Congress 92 2026',
   pg_temp.t92(1, 3, 20, 9, 0), pg_temp.t92(1, 3, 21, 18, 0), 'Europe/Warsaw', 'published',
   pg_temp.t92(1, 2, 1, 9, 0), 'https://cdn.example.org/cover-92.jpg',
   '92f00000-0000-0000-0000-0000000000f1', 'https://stream.example.org/92',
   'https://rec.example.org/92', 12000, '92f00000-0000-0000-0000-0000000000fa',
   '92f00000-0000-0000-0000-0000000000fb'),
  -- Zajety slug docelowy (slug_taken) i drugie wydarzenie tego samego najemcy.
  ('92e00000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
   'zajety-92', 'Zajety 92', 'Taken 92', pg_temp.t92(1, 5, 1, 9, 0), NULL, 'Europe/Warsaw', 'draft',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  -- Wydarzenie z zapisami zewnetrznymi (external_url_*).
  ('92e00000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111',
   'zewnetrzne-92', 'Zewnetrzne 92', 'External 92', pg_temp.t92(1, 6, 1, 10, 0),
   pg_temp.t92(1, 6, 1, 12, 0), 'Nie/Strefa', 'published', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL),
  -- Wydarzenie obcego najemcy.
  ('92e00000-0000-0000-0000-0000000000eb', '92000000-0000-0000-0000-0000000000b0',
   'obce-92', 'Obce 92', 'Foreign 92', pg_temp.t92(1, 3, 20, 9, 0), NULL, 'Europe/Warsaw',
   'published', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

UPDATE public.events
   SET registration_mode = 'external', external_registration_url = 'https://tickets.example.org/92'
 WHERE id = '92e00000-0000-0000-0000-0000000000e3';

-- Grupy: cztery zasiane wyzwalaczem + dwie wlasne; zrodlo BEZ `organisers`.
INSERT INTO public.event_groups (id, tenant_id, event_id, key, name_pl, name_en, sort_order) VALUES
  ('92900000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'vip', 'VIP', 'VIP', 50),
  ('92900000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'press', 'Prasa', 'Press', 60);
DELETE FROM public.event_groups
 WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
   AND event_id = '92e00000-0000-0000-0000-0000000000e1' AND key = 'organisers';

INSERT INTO public.event_rooms (id, tenant_id, event_id, name, capacity, floor) VALUES
  ('92100000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'Sala A 92', 200, 'Parter'),
  ('92100000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'Sala B 92', 50, NULL);

INSERT INTO public.crm_companies (id, tenant_id, name, logo_url, website, country) VALUES
  ('92c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   'Firma C1 92 NOWA NAZWA', 'https://cdn.example.org/c1.png', 'c1.example.org', 'Polska'),
  ('92c00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111',
   'Firma C2 92', 'nie-url', 'https://c2.example.org', 'X');

INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, owner_id) VALUES
  ('92d00000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
   'kontakt.c1@example.org', 'kontakt.c1@example.org', '92a00000-0000-0000-0000-0000000000a7'),
  ('92d00000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111',
   'kontakt.c2@example.org', 'kontakt.c2@example.org', NULL),
  ('92d00000-0000-0000-0000-0000000000d3', '11111111-1111-1111-1111-111111111111',
   'marketing.c1@example.org', 'marketing.c1@example.org', NULL);

INSERT INTO public.event_sponsor_tiers (id, tenant_id, event_id, key, name_pl, name_en, rank) VALUES
  ('92500000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'gold', 'Zloty', 'Gold', 10);
INSERT INTO public.event_sponsor_tier_benefits (id, tenant_id, event_id, tier_id, label_pl, label_en) VALUES
  ('92510000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92500000-0000-0000-0000-0000000000a1', 'Stoisko', 'Booth');

INSERT INTO public.event_sponsors (
  id, tenant_id, event_id, company_id, tier_id, role, is_published, snapshot_name,
  snapshot_logo_url, snapshot_country, snapshot_source, internal_note, sort_order
) VALUES
  ('92600000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92c00000-0000-0000-0000-0000000000c1',
   '92500000-0000-0000-0000-0000000000a1', 'sponsor', true, 'Firma C1 92 STARA', NULL, NULL,
   'crm', 'Umowa 2026', 1),
  ('92600000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92c00000-0000-0000-0000-0000000000c2',
   NULL, 'partner', true, 'C2 recznie', 'https://cdn.example.org/c2-reczne.png', 'Niemcy',
   'manual', NULL, 2);

INSERT INTO public.event_sponsor_contacts (id, tenant_id, event_id, sponsor_id, lead_id, role) VALUES
  ('92610000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92600000-0000-0000-0000-0000000000a1',
   '92d00000-0000-0000-0000-0000000000d1', 'primary'),
  ('92610000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92600000-0000-0000-0000-0000000000a2',
   '92d00000-0000-0000-0000-0000000000d2', 'primary'),
  ('92610000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92600000-0000-0000-0000-0000000000a1',
   '92d00000-0000-0000-0000-0000000000d3', 'marketing');

INSERT INTO public.event_sponsor_materials (id, tenant_id, event_id, sponsor_id, title_pl, title_en, kind, url, is_published) VALUES
  ('92620000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92600000-0000-0000-0000-0000000000a1',
   'Oferta', 'Offer', 'document', 'https://cdn.example.org/oferta.pdf', true);

INSERT INTO public.event_tracks (id, tenant_id, event_id, key, name_pl, name_en, default_room_id, sponsor_id) VALUES
  ('92200000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'glowna', 'Glowna', 'Main',
   '92100000-0000-0000-0000-0000000000a1', '92600000-0000-0000-0000-0000000000a1');

-- Sesje: P1 (rodzic) + C1 (dziecko), P2 odwolana + C2 (dziecko odwolanej),
-- P3 drugiego dnia ze sponsorem. Transmisja i nagranie P1 NIE przechodza.
INSERT INTO public.event_sessions (
  id, tenant_id, event_id, parent_session_id, track_id, room_id, sponsor_id, title_pl, title_en,
  starts_at, ends_at, status, stream_url, recording_url, published_at, cancelled_at
) VALUES
  ('92300000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', NULL, '92200000-0000-0000-0000-0000000000a1',
   '92100000-0000-0000-0000-0000000000a1', NULL, 'Otwarcie', 'Opening',
   pg_temp.t92(1, 3, 20, 9, 30), pg_temp.t92(1, 3, 20, 12, 0), 'published',
   'https://stream.example.org/p1', 'https://rec.example.org/p1', now(), NULL);
INSERT INTO public.event_sessions (
  id, tenant_id, event_id, parent_session_id, track_id, room_id, sponsor_id, title_pl, title_en,
  starts_at, ends_at, status, stream_url, recording_url, published_at, cancelled_at
) VALUES
  ('92300000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92300000-0000-0000-0000-0000000000a1', NULL,
   '92100000-0000-0000-0000-0000000000a2', NULL, 'Warsztat', 'Workshop',
   pg_temp.t92(1, 3, 20, 10, 0), pg_temp.t92(1, 3, 20, 11, 0), 'draft', NULL, NULL, NULL, NULL),
  ('92300000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', NULL, NULL,
   '92100000-0000-0000-0000-0000000000a1', NULL, 'Odwolana', 'Cancelled',
   pg_temp.t92(1, 3, 20, 11, 0), pg_temp.t92(1, 3, 20, 12, 0), 'cancelled', NULL, NULL, NULL, now()),
  ('92300000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', NULL, '92200000-0000-0000-0000-0000000000a1',
   '92100000-0000-0000-0000-0000000000a1', '92600000-0000-0000-0000-0000000000a2', 'Zamkniecie',
   'Closing', pg_temp.t92(1, 3, 21, 16, 0), pg_temp.t92(1, 3, 21, 17, 30), 'published', NULL, NULL,
   now(), NULL);
INSERT INTO public.event_sessions (
  id, tenant_id, event_id, parent_session_id, track_id, room_id, sponsor_id, title_pl, title_en,
  starts_at, ends_at, status
) VALUES
  ('92300000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92300000-0000-0000-0000-0000000000a3', NULL, NULL, NULL,
   'Dziecko odwolanej', 'Child of cancelled', pg_temp.t92(1, 3, 20, 11, 0),
   pg_temp.t92(1, 3, 20, 11, 30), 'draft');

-- Osoby: uczestniczka (zapis NIE przechodzi) i prelegentka bez konta.
INSERT INTO public.event_people (id, tenant_id, first_name, last_name, email, source) VALUES
  ('92700000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'Uczestniczka', 'Klon', 'uczestniczka92@example.org', 'self_registration'),
  ('92700000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'Prelegentka', 'Klon', 'prelegentka92@example.org', 'organizer');

INSERT INTO public.speaker_profiles (id, tenant_id, user_id, person_id) VALUES
  ('92710000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92a00000-0000-0000-0000-0000000000a4', NULL),
  ('92710000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   NULL, '92700000-0000-0000-0000-0000000000a2');

INSERT INTO public.event_speaker_entries (id, tenant_id, event_id, speaker_profile_id, sort_order) VALUES
  ('92720000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92710000-0000-0000-0000-0000000000a1', 0),
  ('92720000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92710000-0000-0000-0000-0000000000a2', 1);

INSERT INTO public.event_session_speakers (id, tenant_id, event_id, session_id, speaker_profile_id, role) VALUES
  ('92730000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92300000-0000-0000-0000-0000000000a1',
   '92710000-0000-0000-0000-0000000000a1', 'speaker'),
  ('92730000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92300000-0000-0000-0000-0000000000a2',
   '92710000-0000-0000-0000-0000000000a2', 'moderator');

INSERT INTO public.event_speakers (event_id, user_id, sort_order) VALUES
  ('92e00000-0000-0000-0000-0000000000e1', '92a00000-0000-0000-0000-0000000000a4', 3);

-- Bilety: standard (progi cen, early bird, grupa VIP, sprzedaz 5) i zaproszenie
-- z kodem dostepu.
INSERT INTO public.event_ticket_types (
  id, tenant_id, event_id, key, name_pl, name_en, price_cents, quota, sold_count, sales_from,
  sales_to, group_id, early_bird_price_cents, early_bird_until, price_schedule, is_active
) VALUES
  ('92400000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'standard', 'Standard', 'Standard', 50000, 100, 5,
   pg_temp.t92(1, 1, 10, 12, 0), pg_temp.t92(1, 3, 19, 23, 0), '92900000-0000-0000-0000-0000000000a1',
   30000, pg_temp.t92(1, 2, 1, 0, 0),
   jsonb_build_array(jsonb_build_object(
     'label_pl', 'Pierwsza pula', 'label_en', 'First batch', 'price_cents', 40000,
     'from', to_char(pg_temp.t92(1, 1, 10, 12, 0) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
     'to', to_char(pg_temp.t92(1, 2, 1, 0, 0) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
     jsonb_build_object('label_pl', 'Bez dat', 'label_en', 'No dates', 'price_cents', 45000)),
   true),
  ('92400000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'zaproszenie', 'Zaproszenie', 'Invitation', 0, NULL, 0,
   NULL, NULL, NULL, NULL, NULL, '[]'::jsonb, true);
UPDATE public.event_ticket_types
   SET access_code_hash = repeat('a', 64), access_code_hint = 'kod z maila', is_hidden = true
 WHERE id = '92400000-0000-0000-0000-0000000000a2';

INSERT INTO public.event_ticket_packages (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, seats, sold_count) VALUES
  ('92410000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92400000-0000-0000-0000-0000000000a1',
   'pakiet', 'Pakiet', 'Pack', 5, 2);

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode) VALUES
  ('92420000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92700000-0000-0000-0000-0000000000a1',
   '92400000-0000-0000-0000-0000000000a1', 'approved', 'form');

INSERT INTO public.event_registration_fields (id, tenant_id, event_id, key, field_type, label_pl, label_en) VALUES
  ('92430000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'firma', 'text', 'Firma', 'Company');
INSERT INTO public.event_terms (id, tenant_id, event_id, key, label_pl, label_en, body_pl, version) VALUES
  ('92440000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'regulamin', 'Regulamin', 'Terms', 'Tresc', 3);

-- Strony: korzen + piec modulowych z zasiewu, strona wlasna pod korzeniem,
-- strona zagniezdzona pod nia, strona pod strona modulowa, strona serwisu
-- spoza poddrzewa przypieta do menu, widzet z `eventId` zrodla.
SELECT public._event_seed_default_pages(
  '11111111-1111-1111-1111-111111111111', '92e00000-0000-0000-0000-0000000000e1'
);
INSERT INTO public.pages (id, tenant_id, slug, title_pl, title_en, status, parent_id, builder_data, menu_order) VALUES
  ('92800000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'o-nas-92', 'O nas', 'About', 'published', NULL, NULL, 0),
  ('92800000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'kongres-92-program', 'Program', 'Programme', 'published',
   (SELECT root_page_id FROM public.events WHERE id = '92e00000-0000-0000-0000-0000000000e1'),
   jsonb_build_object('widgets', jsonb_build_array(jsonb_build_object(
     'type', 'speakers', 'props', jsonb_build_object('eventId', '92e00000-0000-0000-0000-0000000000e1')))),
   1);
INSERT INTO public.pages (id, tenant_id, slug, title_pl, title_en, status, parent_id, menu_order) VALUES
  ('92800000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   'kongres-92-program-dzien-1', 'Dzien 1', 'Day 1', 'published', '92800000-0000-0000-0000-0000000000a2', 0),
  ('92800000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   'agenda-szczegoly-92', 'Szczegoly agendy', 'Agenda details', 'draft',
   (SELECT ep.page_id FROM public.event_pages ep
     WHERE ep.event_id = '92e00000-0000-0000-0000-0000000000e1' AND ep.module = 'agenda'), 0);
UPDATE public.pages SET builder_data = jsonb_build_object('eventId', '92e00000-0000-0000-0000-0000000000e1'),
       status = 'draft'
 WHERE id = (SELECT ep.page_id FROM public.event_pages ep
              WHERE ep.event_id = '92e00000-0000-0000-0000-0000000000e1' AND ep.module = 'discussions');
UPDATE public.event_pages SET menu_label_pl = 'Harmonogram', icon = 'calendar', in_menu = false,
       visible_to_groups = ARRAY['92900000-0000-0000-0000-0000000000a1']::uuid[]
 WHERE event_id = '92e00000-0000-0000-0000-0000000000e1' AND module = 'agenda';
INSERT INTO public.event_pages (tenant_id, event_id, page_id, menu_label_pl, sort_order, visible_to_groups) VALUES
  ('11111111-1111-1111-1111-111111111111', '92e00000-0000-0000-0000-0000000000e1',
   '92800000-0000-0000-0000-0000000000a1', 'O nas', 90, '{}'::uuid[]),
  ('11111111-1111-1111-1111-111111111111', '92e00000-0000-0000-0000-0000000000e1',
   '92800000-0000-0000-0000-0000000000a2', 'Program', 20,
   ARRAY['92900000-0000-0000-0000-0000000000a2']::uuid[]);
INSERT INTO public.event_page_sections (tenant_id, event_id, section_key, is_visible, sort_order, heading_pl) VALUES
  ('11111111-1111-1111-1111-111111111111', '92e00000-0000-0000-0000-0000000000e1',
   'agenda', false, 5, 'Plan dnia');

-- Obsluga na miejscu: wejscie (sala), sesja P1, sesja P2 (odwolana), stoisko S1.
INSERT INTO public.event_checkpoints (id, tenant_id, event_id, name_pl, name_en, kind, session_id, room_id, sponsor_id) VALUES
  ('92b00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'Wejscie', 'Entry', 'event_entry', NULL,
   '92100000-0000-0000-0000-0000000000a1', NULL),
  ('92b00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'Sesja otwarcia', 'Opening session', 'session',
   '92300000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('92b00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'Sesja odwolana', 'Cancelled session', 'session',
   '92300000-0000-0000-0000-0000000000a3', NULL, NULL),
  ('92b00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'Stoisko C1', 'Booth C1', 'company_booth', NULL, NULL,
   '92600000-0000-0000-0000-0000000000a1');
INSERT INTO public.event_badge_templates (id, tenant_id, event_id, name, is_default, version) VALUES
  ('92b10000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'Standard', true, 4);
INSERT INTO public.event_scanner_devices (id, tenant_id, event_id, label, token_hash, token_prefix, scopes, expires_at) VALUES
  ('92b20000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'Skaner 92', repeat('b', 64), 'Ab12Cd34',
   ARRAY['checkin'], now() + interval '10 days');

-- Gielda spotkan.
INSERT INTO public.event_meeting_settings (
  id, tenant_id, event_id, is_enabled, meeting_days, timezone, invites_open_at, invites_close_at
) VALUES (
  '92c10000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
  '92e00000-0000-0000-0000-0000000000e1', true,
  ARRAY[(pg_temp.t92(1, 3, 20, 12, 0) AT TIME ZONE 'Europe/Warsaw')::date,
        (pg_temp.t92(1, 3, 21, 12, 0) AT TIME ZONE 'Europe/Warsaw')::date],
  'Europe/Warsaw', pg_temp.t92(1, 3, 1, 9, 0), pg_temp.t92(1, 3, 19, 18, 0)
);
INSERT INTO public.event_meeting_tables (id, tenant_id, event_id, label, capacity, room_id) VALUES
  ('92c20000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'Stolik 1', 4, '92100000-0000-0000-0000-0000000000a2');
INSERT INTO public.event_meeting_rule_groups (id, tenant_id, event_id, group_id, side) VALUES
  ('92c30000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92900000-0000-0000-0000-0000000000a1', 'requester');

-- Nabor prelegentow.
INSERT INTO public.event_cfp_settings (
  id, tenant_id, event_id, status, opens_at, closes_at, track_ids, speaker_group_id,
  speaker_ticket_type_id
) VALUES (
  '92d10000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
  '92e00000-0000-0000-0000-0000000000e1', 'open', pg_temp.t92(1, 1, 5, 9, 0),
  pg_temp.t92(1, 2, 15, 23, 59), ARRAY['92200000-0000-0000-0000-0000000000a1']::uuid[],
  (SELECT g.id FROM public.event_groups g
    WHERE g.event_id = '92e00000-0000-0000-0000-0000000000e1' AND g.key = 'speakers'),
  '92400000-0000-0000-0000-0000000000a1'
);
INSERT INTO public.event_cfp_fields (id, tenant_id, event_id, key, field_type, label_pl, label_en) VALUES
  ('92d20000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'doswiadczenie', 'textarea', 'Doswiadczenie', 'Experience');
INSERT INTO public.event_cfp_reviewers (id, tenant_id, event_id, user_id, track_ids) VALUES
  ('92d30000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92a00000-0000-0000-0000-0000000000a3',
   ARRAY['92200000-0000-0000-0000-0000000000a1']::uuid[]);

-- Plan sali: kategoria (z biletem), plan opublikowany, sekcja 2x3, miejsca:
-- zablokowane, rezerwacja firmy, sponsora, sama notatka, dwa wolne + przydzial.
INSERT INTO public.event_seat_categories (id, tenant_id, event_id, key, name_pl, name_en, color) VALUES
  ('92e10000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'parter', 'Parter', 'Stalls', '#112233');
INSERT INTO public.event_seat_category_tickets (id, tenant_id, event_id, category_id, ticket_type_id) VALUES
  ('92e20000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92e10000-0000-0000-0000-0000000000a1',
   '92400000-0000-0000-0000-0000000000a1');
INSERT INTO public.event_seat_maps (id, tenant_id, event_id, room_id, session_id, name, status, width, height, published_at) VALUES
  ('92e30000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92100000-0000-0000-0000-0000000000a1',
   '92300000-0000-0000-0000-0000000000a1', 'Gala', 'published', 1000, 800, now());
INSERT INTO public.event_seat_sections (
  id, tenant_id, event_id, map_id, label, kind, category_id, rows_count, seats_per_row,
  row_label_scheme, seat_numbering
) VALUES (
  '92e40000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
  '92e00000-0000-0000-0000-0000000000e1', '92e30000-0000-0000-0000-0000000000a1', 'A', 'rows',
  '92e10000-0000-0000-0000-0000000000a1', 2, 3, 'alpha', 'ltr'
);
INSERT INTO public.event_seats (
  id, tenant_id, event_id, map_id, section_id, row_label, seat_number, x, y, sort_key, category_id,
  status, block_reason, hold_company_id, hold_sponsor_id, hold_note
) VALUES
  ('92e50000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92e30000-0000-0000-0000-0000000000a1',
   '92e40000-0000-0000-0000-0000000000a1', 'A', 1, 10, 10, 1, NULL, 'blocked', 'Kolumna', NULL, NULL, NULL),
  ('92e50000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92e30000-0000-0000-0000-0000000000a1',
   '92e40000-0000-0000-0000-0000000000a1', 'A', 2, 20, 10, 2, NULL, 'held', NULL,
   '92c00000-0000-0000-0000-0000000000c1', NULL, 'Dla zarzadu'),
  ('92e50000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92e30000-0000-0000-0000-0000000000a1',
   '92e40000-0000-0000-0000-0000000000a1', 'A', 3, 30, 10, 3, NULL, 'held', NULL, NULL,
   '92600000-0000-0000-0000-0000000000a1', NULL),
  ('92e50000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92e30000-0000-0000-0000-0000000000a1',
   '92e40000-0000-0000-0000-0000000000a1', 'B', 1, 10, 20, 4, NULL, 'held', NULL, NULL, NULL,
   'Tylko notatka'),
  ('92e50000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92e30000-0000-0000-0000-0000000000a1',
   '92e40000-0000-0000-0000-0000000000a1', 'B', 2, 20, 20, 5, '92e10000-0000-0000-0000-0000000000a1',
   'available', NULL, NULL, NULL, NULL),
  ('92e50000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92e30000-0000-0000-0000-0000000000a1',
   '92e40000-0000-0000-0000-0000000000a1', 'B', 3, 30, 20, 6, NULL, 'available', NULL, NULL, NULL, NULL);
INSERT INTO public.event_seat_assignments (id, tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot) VALUES
  ('92e60000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', '92e30000-0000-0000-0000-0000000000a1',
   '92e50000-0000-0000-0000-0000000000a5', '92420000-0000-0000-0000-0000000000a1', 'A B2');

-- Kampania, reklama strony glownej, kody (jeden skoliduje z istniejacym).
INSERT INTO public.event_ad_campaigns (id, tenant_id, event_id, platform, match_kind, match_value, label) VALUES
  ('92f10000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'google_ads', 'utm_campaign', 'kongres92', 'Kongres 92');
INSERT INTO public.event_home_ads (id, tenant_id, event_id, image_url, alt_text, group_ids, starts_at, ends_at, is_active, sponsor_id) VALUES
  ('92f20000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '92e00000-0000-0000-0000-0000000000e1', 'https://cdn.example.org/ad.png', 'Reklama',
   ARRAY['92900000-0000-0000-0000-0000000000a1']::uuid[], pg_temp.t92(1, 3, 1, 0, 0),
   pg_temp.t92(1, 3, 21, 23, 0), true, '92600000-0000-0000-0000-0000000000a1');
INSERT INTO public.b2b_coupons (
  id, tenant_id, code, discount_kind, discount_percent, redemptions_count, event_ids,
  ticket_type_ids, valid_from, assigned_company_id
) VALUES
  ('92f30000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'VIP92',
   'percent', 20, 7, ARRAY['92e00000-0000-0000-0000-0000000000e1']::uuid[],
   ARRAY['92400000-0000-0000-0000-0000000000a1']::uuid[], pg_temp.t92(1, 1, 1, 0, 0),
   '92c00000-0000-0000-0000-0000000000c1'),
  ('92f30000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'EARLY92',
   'percent', 10, 3, ARRAY['92e00000-0000-0000-0000-0000000000e1']::uuid[],
   '{}'::uuid[], NULL, NULL),
  ('92f30000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'VIP92-2027',
   'percent', 5, 0, '{}'::uuid[], '{}'::uuid[], NULL, NULL);

-- Po migawce sponsora S1 firma zmienila nazwe w CRM (odswiezenie ma to wziac).
SELECT pg_temp.assert(
  (SELECT snapshot_name FROM public.event_sponsors WHERE id = '92600000-0000-0000-0000-0000000000a1')
    <> (SELECT name FROM public.crm_companies WHERE id = '92c00000-0000-0000-0000-0000000000c1'),
  '92/scenografia: migawka S1 rozni sie od kartoteki CRM (odswiezenie ma co robic)');

-- ---------------------------------------------------------------------------
-- SEKCJA 2: ODMOWY ROL, NAJEMCY I GRANTY
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as();
SELECT pg_temp.assert_raises_like('SELECT public.admin_event_clone(pg_temp.p92())',
  'forbidden', '92/odmowa: anonim nie klonuje');
SELECT pg_temp.assert_raises_like('SELECT public.admin_event_clone_preview(pg_temp.p92())',
  'forbidden', '92/odmowa: anonim nie widzi podgladu');

SELECT pg_temp.act_as('92a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like('SELECT public.admin_event_clone(pg_temp.p92())',
  'forbidden: admin role required', '92/odmowa: zwykly uzytkownik nie klonuje');

SELECT pg_temp.act_as('92a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like('SELECT public.admin_event_clone(pg_temp.p92())',
  'forbidden: admin role required', '92/odmowa: redaktor nie klonuje (modul tylko dla admina)');
SELECT pg_temp.assert_raises_like('SELECT public.admin_event_clone_preview(pg_temp.p92())',
  'forbidden: admin role required', '92/odmowa: redaktor nie widzi podgladu');
SELECT pg_temp.assert_raises_like(
  'SELECT * FROM public.admin_event_editions(''92e00000-0000-0000-0000-0000000000e1'')',
  'forbidden: admin role required', '92/odmowa: redaktor nie czyta listy edycji');

SELECT pg_temp.act_as('92a00000-0000-0000-0000-0000000000b1', '92000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like('SELECT public.admin_event_clone(pg_temp.p92())',
  'not_found', '92/izolacja: admin obcego najemcy nie sklonuje wydarzenia A');
SELECT pg_temp.assert_raises_like('SELECT public.admin_event_clone_preview(pg_temp.p92())',
  'not_found', '92/izolacja: admin obcego najemcy nie zobaczy podgladu wydarzenia A');
SELECT pg_temp.assert_raises_like(
  'SELECT * FROM public.admin_event_editions(''92e00000-0000-0000-0000-0000000000e1'')',
  'not_found', '92/izolacja: obcy admin nie czyta edycji wydarzenia A');
-- Kontrapunkt: ten sam admin klonuje wydarzenie SWOJEGO najemcy.
SELECT pg_temp.assert(
  (public.admin_event_clone(jsonb_build_object(
     'source_event_id', '92e00000-0000-0000-0000-0000000000eb', 'title_pl', 'Obce 92 kopia',
     'title_en', 'Foreign 92 copy', 'starts_at', pg_temp.t92(2, 3, 20, 9, 0)))->>'slug') = 'obce-92-kopia',
  '92/izolacja: admin B klonuje wydarzenie swojego najemcy (kontrapunkt)');
SELECT pg_temp.assert(
  (SELECT e.tenant_id FROM public.events e WHERE e.slug = 'obce-92-kopia')
    = '92000000-0000-0000-0000-0000000000b0',
  '92/izolacja: kopia wydarzenia B powstaje w najemcy B');

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_clone(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_clone(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_clone_preview(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_clone_preview(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_editions(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_editions(uuid)', 'EXECUTE'),
  '92/granty: RPC klonu tylko dla authenticated (anon bez EXECUTE)');
SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated', 'public._event_clone_pages(uuid, uuid, uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_clone_resolve(uuid, jsonb, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_clone_crm(uuid, uuid, uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_clone_id(uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_clone_pages(uuid, uuid, uuid, jsonb)', 'EXECUTE'),
  '92/granty: pomocnicy klonu niewolalni z klienta (tylko service_role)');
SELECT pg_temp.assert(
  (SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('admin_event_clone', 'admin_event_clone_preview', 'admin_event_editions',
                        '_event_clone_pages', '_event_clone_resolve', '_event_clone_crm')),
  '92/granty: RPC i pomocnicy sa SECURITY DEFINER z search_path public, pg_temp');

-- ---------------------------------------------------------------------------
-- SEKCJA 3: WALIDACJA LADUNKU (admin A)
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('92a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"source_event_id": "nie-uuid"}''))',
  'invalid_source', '92/walidacja: zrodlo nie-UUID');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92() - ''source_event_id'')',
  'invalid_source', '92/walidacja: brak zrodla');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"source_event_id": "92e00000-0000-0000-0000-0000000000ff"}''))',
  'not_found', '92/walidacja: zrodlo nie istnieje');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92() - ''starts_at'')',
  'invalid_starts_at', '92/walidacja: klon wymaga poczatku (podglad nie)');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"starts_at": "jutro"}''))',
  'invalid_starts_at', '92/walidacja: poczatek nie jest data');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"ends_at": "pojutrze"}''))',
  'invalid_ends_at', '92/walidacja: koniec nie jest data');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.admin_event_clone(pg_temp.p92(jsonb_build_object(''ends_at'', %L::timestamptz)))',
         pg_temp.t92(2, 4, 1, 9, 0)),
  'invalid_ends_at', '92/walidacja: koniec przed poczatkiem');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"timezone": "Mars/Olympus"}''))',
  'invalid_timezone', '92/walidacja: nieznana strefa');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"title_en": "  "}''))',
  'invalid_titles', '92/walidacja: pusty tytul EN');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.admin_event_clone(pg_temp.p92(jsonb_build_object(''title_pl'', %L)))', repeat('x', 201)),
  'invalid_titles', '92/walidacja: tytul ponad 200 znakow');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"slug": "Zly Slug!"}''))',
  'invalid_slug', '92/walidacja: slug spoza alfabetu');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"slug": "zajety-92"}''))',
  'slug_taken', '92/walidacja: slug zajety w najemcy');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"include": {"codes": true}}''))',
  'invalid_code_suffix', '92/walidacja: kody bez przyrostka');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"include": {"codes": true}, "options": {"code_suffix": "z spacja"}}''))',
  'invalid_code_suffix', '92/walidacja: przyrostek spoza alfabetu');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"options": {"crm_renewal_tasks": true, "crm_task_due_days": 500}}''))',
  'invalid_task_due_days', '92/walidacja: termin zadania CRM poza 1-365');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"idempotency_key": "krotki"}''))',
  'invalid_idempotency_key', '92/walidacja: klucz idempotencji za krotki');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.admin_event_clone(pg_temp.p92(jsonb_build_object(''ends_at'', %L::timestamptz)))',
         pg_temp.t92(2, 4, 2, 10, 30)),
  'clone_sessions_outside_window: 3', '92/walidacja: koniec ucina 3 przenoszone sesje (odmowa przed zapisem)');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(jsonb_build_object(''source_event_id'', ''92e00000-0000-0000-0000-0000000000e3'', ''title_pl'', ''Zewn 2027'', ''title_en'', ''Ext 2027'', ''starts_at'', pg_temp.t92(2, 6, 1, 10, 0), ''external_registration_url'', ''''))',
  'external_url_required', '92/walidacja: tryb zewnetrzny bez adresu');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(jsonb_build_object(''source_event_id'', ''92e00000-0000-0000-0000-0000000000e3'', ''title_pl'', ''Zewn 2027'', ''title_en'', ''Ext 2027'', ''starts_at'', pg_temp.t92(2, 6, 1, 10, 0), ''external_registration_url'', ''http://niebezpieczny.example.org''))',
  'external_url_invalid', '92/walidacja: adres zapisow bez https');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.events e WHERE e.previous_edition_id = '92e00000-0000-0000-0000-0000000000e1'),
  '92/walidacja: zadna odmowa nie zostawila pol-kopii');

-- ---------------------------------------------------------------------------
-- SEKCJA 4: PODGLAD (bez zapisu)
-- ---------------------------------------------------------------------------
INSERT INTO f92 VALUES ('preview', public.admin_event_clone_preview(
  jsonb_build_object('source_event_id', '92e00000-0000-0000-0000-0000000000e1')));
INSERT INTO f92 VALUES ('preview_short', public.admin_event_clone_preview(pg_temp.p92(jsonb_build_object(
  'ends_at', pg_temp.t92(2, 4, 2, 10, 30), 'slug', 'zajety-92'))));
INSERT INTO f92 VALUES ('preview_badslug', public.admin_event_clone_preview(pg_temp.p92('{"slug": "Zly!"}')));

SELECT pg_temp.assert(
  (SELECT (v->'target'->>'starts_at')::timestamptz = pg_temp.t92(2, 3, 20, 9, 0)
      AND (v->'target'->>'suggested_starts_at')::timestamptz = pg_temp.t92(2, 3, 20, 9, 0)
     FROM f92 WHERE k = 'preview'),
  '92/podglad: bez daty podpowiada te sama godzine lokalna rok pozniej');
SELECT pg_temp.assert(
  (SELECT v->'target'->>'slug' = 'kongres-92-2' AND (v->'target'->>'slug_available')::boolean
     FROM f92 WHERE k = 'preview'),
  '92/podglad: bez tytulu slug ze sluga zrodla z wolnym numerem');
SELECT pg_temp.assert(
  (SELECT (v->'counts'->>'sessions')::int = 4 AND (v->'counts'->>'cancelled_sessions')::int = 1
      AND (v->'counts'->>'ticket_types')::int = 2 AND (v->'counts'->>'sponsors')::int = 2
      AND (v->'counts'->>'codes')::int = 2 AND (v->'counts'->>'seats')::int = 6
      AND (v->'counts'->>'renewal_contacts')::int = 2 AND (v->'counts'->>'groups')::int = 5
     FROM f92 WHERE k = 'preview'),
  '92/podglad: liczniki sekcji zrodla');
SELECT pg_temp.assert(
  (SELECT (v->'not_copied'->>'registrations')::int = 1 AND (v->'not_copied'->>'scanner_devices')::int = 1
      AND (v->'not_copied'->>'seat_assignments')::int = 1
     FROM f92 WHERE k = 'preview'),
  '92/podglad: dane, ktorych klon nie przeniesie, sa policzone');
SELECT pg_temp.assert(
  (SELECT jsonb_agg(w->>'code' ORDER BY w->>'code') FROM f92, jsonb_array_elements(v->'warnings') w WHERE k = 'preview')
    = '["access_codes_dropped", "cancelled_sessions_skipped", "cfp_reviewers_not_copied", "checkpoints_without_target", "codes_not_copied", "pages_copied_as_draft", "seat_holds_cleared", "sponsors_unpublished", "type_inactive"]'::jsonb,
  '92/podglad: komplet ostrzezen dla domyslnych przelacznikow');
SELECT pg_temp.assert(
  (SELECT jsonb_object_agg(w->>'code', (w->>'count')::int) FROM f92, jsonb_array_elements(v->'warnings') w WHERE k = 'preview')
    = '{"access_codes_dropped": 1, "cancelled_sessions_skipped": 2, "cfp_reviewers_not_copied": 1, "checkpoints_without_target": 1, "codes_not_copied": 2, "pages_copied_as_draft": 3, "seat_holds_cleared": 2, "sponsors_unpublished": 2, "type_inactive": 1}'::jsonb,
  '92/podglad: liczby w ostrzezeniach');
SELECT pg_temp.assert(
  (SELECT v->'blockers' = '[]'::jsonb FROM f92 WHERE k = 'preview'),
  '92/podglad: domyslny klon nie ma blokad');
SELECT pg_temp.assert(
  (SELECT v->'blockers' @> '[{"code": "sessions_outside_window", "count": 3}, {"code": "slug_taken", "count": 1}]'::jsonb
      AND (v->'target'->>'slug_available')::boolean IS FALSE
     FROM f92 WHERE k = 'preview_short'),
  '92/podglad: blokady - sesje poza oknem i zajety slug');
SELECT pg_temp.assert(
  (SELECT v->'blockers' = '[{"code": "invalid_slug", "count": 1}]'::jsonb
      AND (v->'target'->>'slug_valid')::boolean IS FALSE
     FROM f92 WHERE k = 'preview_badslug'),
  '92/podglad: blokada - slug spoza alfabetu');
SELECT pg_temp.assert(
  (SELECT pg_temp.hm92((v->'dates'->>'first_session_starts_at')::timestamptz, 'Europe/Warsaw') = '09:30'
      AND (v->'dates'->>'meeting_days_first')::date
          = (pg_temp.t92(2, 3, 20, 12, 0) AT TIME ZONE 'Europe/Warsaw')::date
     FROM f92 WHERE k = 'preview'),
  '92/podglad: daty kluczowe po przesunieciu (pierwsza sesja 09:30, dzien gieldy)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.events e WHERE e.previous_edition_id = '92e00000-0000-0000-0000-0000000000e1') = 0,
  '92/podglad: nic nie zapisuje');

-- ---------------------------------------------------------------------------
-- SEKCJA 5: PELNY KLON (wszystkie przelaczniki, przez zmiane czasu CET -> CEST)
-- ---------------------------------------------------------------------------
INSERT INTO f92 VALUES ('full', public.admin_event_clone(pg_temp.p92(jsonb_build_object(
  'idempotency_key', 'event.clone:92-klucz-pelny',
  'include', jsonb_build_object('codes', true, 'home_ads', true, 'sponsor_materials', true,
                                'ad_campaigns', true),
  'options', jsonb_build_object('code_suffix', '-2027', 'crm_renewal_tasks', true,
                                'crm_task_due_days', 14, 'cfp_reviewers', true)
))));

SELECT pg_temp.assert(
  (SELECT (v->>'replayed')::boolean IS FALSE AND v->>'slug' = 'kongres-92-2027'
      AND (v->>'source_event_id')::uuid = '92e00000-0000-0000-0000-0000000000e1'
      AND v->'shift'->>'source_tz' = 'Europe/Warsaw' AND (v->'shift'->>'day_shift')::int > 360
     FROM f92 WHERE k = 'full'),
  '92/klon: wynik niesie nowe wydarzenie, slug z tytulu i przesuniecie');

SELECT pg_temp.assert(
  (SELECT e.status = 'draft' AND e.published_at IS NULL AND e.join_url IS NULL
      AND e.recording_url IS NULL AND e.conversation_id IS NULL
      AND e.previous_edition_id = '92e00000-0000-0000-0000-0000000000e1'
      AND e.cover_url = 'https://cdn.example.org/cover-92.jpg' AND e.ticket_price_cents = 12000
      AND e.program_id = '92f00000-0000-0000-0000-0000000000fa'
      AND e.created_by = '92a00000-0000-0000-0000-0000000000a1'
      AND e.starts_at = pg_temp.t92(2, 4, 2, 9, 0)
      AND e.ends_at = pg_temp.t92(2, 4, 3, 18, 0)
      AND pg_temp.hm92(e.rsvp_opens_at, 'Europe/Warsaw') = '09:00'
     FROM public.events e WHERE e.id = pg_temp.f92_id('full')),
  '92/klon: wydarzenie jest szkicem z rodowodem, bez transmisji/nagrania/czatu, koniec przesuniety');

-- Grupy: 5 zrodla + dosiana `organisers`, jedna domyslna.
SELECT pg_temp.assert(
  (SELECT count(*) = 6 AND count(*) FILTER (WHERE g.is_default) = 1
      AND bool_or(g.key = 'organisers') AND bool_or(g.key = 'vip')
     FROM public.event_groups g WHERE g.event_id = pg_temp.f92_id('full')),
  '92/klon: grupy zrodla + dosiana systemowa, dokladnie jedna domyslna');
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.event_groups g
           WHERE g.id = pg_temp.map92('full', '92900000-0000-0000-0000-0000000000a1')
             AND g.event_id = pg_temp.f92_id('full') AND g.key = 'vip'),
  '92/klon: identyfikator kopii grupy jest deterministyczny (map92)');

-- Sale, sciezka, sesje - przesuniecie w czasie LOKALNYM.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_rooms r WHERE r.event_id = pg_temp.f92_id('full')) = 2,
  '92/klon: dwie sale');
SELECT pg_temp.assert(
  (SELECT t.default_room_id = pg_temp.map92('full', '92100000-0000-0000-0000-0000000000a1')
      AND t.sponsor_id = pg_temp.map92('full', '92600000-0000-0000-0000-0000000000a1')
     FROM public.event_tracks t WHERE t.event_id = pg_temp.f92_id('full')),
  '92/klon: sciezka wskazuje NOWA sale i NOWEGO sponsora');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions s WHERE s.event_id = pg_temp.f92_id('full')) = 3,
  '92/klon: trzy sesje (odwolana i jej dziecko pominiete)');
SELECT pg_temp.assert(
  (SELECT pg_temp.hm92(s.starts_at, 'Europe/Warsaw') = '09:30'
      AND pg_temp.hm92(s.ends_at, 'Europe/Warsaw') = '12:00'
      AND (s.starts_at AT TIME ZONE 'Europe/Warsaw')::date = (pg_temp.t92(2, 4, 2, 9, 0) AT TIME ZONE 'Europe/Warsaw')::date
      AND to_char(s.starts_at AT TIME ZONE 'UTC', 'HH24:MI') = '07:30'
      AND s.stream_url IS NULL AND s.recording_url IS NULL AND s.status = 'published'
      AND s.published_at IS NOT NULL
      AND s.room_id = pg_temp.map92('full', '92100000-0000-0000-0000-0000000000a1')
     FROM public.event_sessions s WHERE s.id = pg_temp.map92('full', '92300000-0000-0000-0000-0000000000a1')),
  '92/klon/DST: sesja 09:30 CET zostaje 09:30 CEST (07:30 UTC), bez transmisji i nagrania');
SELECT pg_temp.assert(
  (SELECT s.parent_session_id = pg_temp.map92('full', '92300000-0000-0000-0000-0000000000a1')
      AND s.status = 'draft' AND s.published_at IS NULL
     FROM public.event_sessions s WHERE s.id = pg_temp.map92('full', '92300000-0000-0000-0000-0000000000a2')),
  '92/klon: dziecko wskazuje NOWEGO rodzica, szkic zostaje szkicem');
SELECT pg_temp.assert(
  (SELECT s.sponsor_id = pg_temp.map92('full', '92600000-0000-0000-0000-0000000000a2')
      AND pg_temp.hm92(s.starts_at, 'Europe/Warsaw') = '16:00'
     FROM public.event_sessions s WHERE s.id = pg_temp.map92('full', '92300000-0000-0000-0000-0000000000a5')),
  '92/klon: sesja drugiego dnia z NOWYM sponsorem, godzina lokalna zachowana');
SELECT pg_temp.assert(
  (SELECT v->'skipped'->>'sessions' = '2' FROM f92 WHERE k = 'full'),
  '92/klon: wynik raportuje dwie pominiete sesje');

-- Prelegenci i obsada.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_speaker_entries x WHERE x.event_id = pg_temp.f92_id('full')) = 2
  AND (SELECT count(*) FROM public.event_session_speakers x WHERE x.event_id = pg_temp.f92_id('full')) = 2
  AND (SELECT count(*) FROM public.event_speakers x WHERE x.event_id = pg_temp.f92_id('full')) = 1
  AND EXISTS (SELECT 1 FROM public.event_session_speakers x
               WHERE x.session_id = pg_temp.map92('full', '92300000-0000-0000-0000-0000000000a2')
                 AND x.role = 'moderator'),
  '92/klon: lista prelegentow, legacy event_speakers i obsada sesji');

-- Bilety i pakiety.
SELECT pg_temp.assert(
  (SELECT t.sold_count = 0 AND t.group_id = pg_temp.map92('full', '92900000-0000-0000-0000-0000000000a1')
      AND pg_temp.hm92(t.sales_from, 'Europe/Warsaw') = '12:00'
      AND pg_temp.hm92(t.early_bird_until, 'Europe/Warsaw') = '00:00'
      AND (t.price_schedule->0->>'from')::timestamptz
          = public._event_clone_shift(pg_temp.t92(1, 1, 10, 12, 0), 'Europe/Warsaw', 'Europe/Warsaw',
              ((pg_temp.t92(2, 4, 2, 9, 0) AT TIME ZONE 'Europe/Warsaw') - (pg_temp.t92(1, 3, 20, 9, 0) AT TIME ZONE 'Europe/Warsaw')))
      AND t.price_schedule->0->>'from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
      AND t.price_schedule->0->>'label_pl' = 'Pierwsza pula'
      AND NOT (t.price_schedule->1 ? 'from')
     FROM public.event_ticket_types t WHERE t.id = pg_temp.map92('full', '92400000-0000-0000-0000-0000000000a1')),
  '92/klon: bilet - sprzedaz od zera, NOWA grupa, okna i progi przesuniete lokalnie (ISO UTC)');
SELECT pg_temp.assert(
  (SELECT t.access_code_hash IS NULL AND t.access_code_hint = '' AND t.is_active IS FALSE AND t.is_hidden
     FROM public.event_ticket_types t WHERE t.id = pg_temp.map92('full', '92400000-0000-0000-0000-0000000000a2')),
  '92/klon: bilet z kodem dostepu - kod zdjety, bilet NIEAKTYWNY (nie otwiera sie dla kazdego)');
SELECT pg_temp.assert(
  (SELECT k.sold_count = 0 AND k.ticket_type_id = pg_temp.map92('full', '92400000-0000-0000-0000-0000000000a1')
     FROM public.event_ticket_packages k WHERE k.event_id = pg_temp.f92_id('full')),
  '92/klon: pakiet wskazuje NOWY bilet, sprzedaz od zera');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registration_fields f WHERE f.event_id = pg_temp.f92_id('full')) = 1
  AND (SELECT t.version FROM public.event_terms t WHERE t.event_id = pg_temp.f92_id('full')) = 3,
  '92/klon: pole formularza i regulamin (wersja zachowana)');

-- Sponsorzy.
SELECT pg_temp.assert(
  (SELECT count(*) = 2 AND bool_and(NOT s.is_published)
     FROM public.event_sponsors s WHERE s.event_id = pg_temp.f92_id('full')),
  '92/klon: sponsorzy przeniesieni jako NIEOPUBLIKOWANI');
SELECT pg_temp.assert(
  (SELECT s.snapshot_name = 'Firma C1 92 NOWA NAZWA' AND s.snapshot_logo_url = 'https://cdn.example.org/c1.png'
      AND s.snapshot_website = 'https://c1.example.org' AND s.snapshot_country = 'Polska'
      AND s.tier_id = pg_temp.map92('full', '92500000-0000-0000-0000-0000000000a1')
      AND s.internal_note = 'Umowa 2026'
     FROM public.event_sponsors s WHERE s.id = pg_temp.map92('full', '92600000-0000-0000-0000-0000000000a1')),
  '92/klon/CRM: migawka sponsora odswiezona z kartoteki firm, NOWY poziom');
SELECT pg_temp.assert(
  (SELECT s.snapshot_name = 'C2 recznie' AND s.snapshot_logo_url = 'https://cdn.example.org/c2-reczne.png'
      AND s.snapshot_country = 'Niemcy' AND s.snapshot_source = 'manual'
     FROM public.event_sponsors s WHERE s.id = pg_temp.map92('full', '92600000-0000-0000-0000-0000000000a2')),
  '92/klon/CRM: reczna migawka NIE jest nadpisywana z CRM');
SELECT pg_temp.assert(
  (SELECT (v->'copied'->>'sponsor_snapshots_refreshed')::int = 1 AND (v->'copied'->>'sponsor_tiers')::int = 1
      AND (v->'copied'->>'sponsor_benefits')::int = 1 AND (v->'copied'->>'sponsor_contacts')::int = 3
      AND (v->'copied'->>'sponsor_materials')::int = 1
     FROM f92 WHERE k = 'full'),
  '92/klon: liczniki sponsorow w wyniku');
SELECT pg_temp.assert(
  (SELECT bool_and(NOT m.is_published) FROM public.event_sponsor_materials m WHERE m.event_id = pg_temp.f92_id('full')),
  '92/klon: materialy sponsora wracaja nieopublikowane');

-- Strony.
SELECT pg_temp.assert(
  (SELECT p.title_pl = 'Kongres 92 2027' AND p.status = 'published'
     FROM public.events e JOIN public.pages p ON p.id = e.root_page_id
    WHERE e.id = pg_temp.f92_id('full')),
  '92/klon/strony: nowy korzen z tytulem nowej edycji');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_pages ep WHERE ep.event_id = pg_temp.f92_id('full') AND ep.module IS NOT NULL) = 5,
  '92/klon/strony: piec pozycji modulowych');
SELECT pg_temp.assert(
  (SELECT p.status = 'draft' AND p.builder_data->>'eventId' = pg_temp.f92_id('full')::text
     FROM public.event_pages ep JOIN public.pages p ON p.id = ep.page_id
    WHERE ep.event_id = pg_temp.f92_id('full') AND ep.module = 'discussions'),
  '92/klon/strony: strona modulowa - tresc ze zrodla, eventId przepiety, szkic zostaje szkicem');
SELECT pg_temp.assert(
  (SELECT ep.menu_label_pl = 'Harmonogram' AND ep.icon = 'calendar' AND ep.in_menu IS FALSE
      AND ep.visible_to_groups = ARRAY[pg_temp.map92('full', '92900000-0000-0000-0000-0000000000a1')]
     FROM public.event_pages ep WHERE ep.event_id = pg_temp.f92_id('full') AND ep.module = 'agenda'),
  '92/klon/strony: wyglad pozycji modulowej z NOWA grupa');
SELECT pg_temp.assert(
  (SELECT p.status = 'draft' AND p.slug LIKE 'kongres-92-2027-program%'
      AND p.parent_id = (SELECT root_page_id FROM public.events WHERE id = pg_temp.f92_id('full'))
      AND p.builder_data->'widgets'->0->'props'->>'eventId' = pg_temp.f92_id('full')::text
      AND p.author_id = '92a00000-0000-0000-0000-0000000000a1'
     FROM public.pages p WHERE p.id = pg_temp.map92('full', '92800000-0000-0000-0000-0000000000a2')),
  '92/klon/strony: strona wlasna jako SZKIC pod nowym korzeniem, slug nowej edycji, eventId przepiety');
SELECT pg_temp.assert(
  (SELECT p.parent_id = pg_temp.map92('full', '92800000-0000-0000-0000-0000000000a2') AND p.status = 'draft'
     FROM public.pages p WHERE p.id = pg_temp.map92('full', '92800000-0000-0000-0000-0000000000a3')),
  '92/klon/strony: strona zagniezdzona pod SKOPIOWANYM rodzicem');
SELECT pg_temp.assert(
  (SELECT p.parent_id = (SELECT ep.page_id FROM public.event_pages ep
                          WHERE ep.event_id = pg_temp.f92_id('full') AND ep.module = 'agenda')
     FROM public.pages p WHERE p.id = pg_temp.map92('full', '92800000-0000-0000-0000-0000000000a4')),
  '92/klon/strony: strona pod strona modulowa trafia pod NOWA strone modulowa');
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.event_pages ep WHERE ep.event_id = pg_temp.f92_id('full')
             AND ep.page_id = '92800000-0000-0000-0000-0000000000a1' AND ep.sort_order = 90)
  AND EXISTS (SELECT 1 FROM public.event_pages ep WHERE ep.event_id = pg_temp.f92_id('full')
             AND ep.page_id = pg_temp.map92('full', '92800000-0000-0000-0000-0000000000a2')
             AND ep.visible_to_groups = ARRAY[pg_temp.map92('full', '92900000-0000-0000-0000-0000000000a2')]),
  '92/klon/strony: strona serwisu przypieta ponownie (ten sam wiersz), pozycja strony wlasnej na kopii');
SELECT pg_temp.assert(
  (SELECT s.heading_pl = 'Plan dnia' AND s.is_visible IS FALSE
     FROM public.event_page_sections s WHERE s.event_id = pg_temp.f92_id('full') AND s.section_key = 'agenda'),
  '92/klon/strony: nadpisanie sekcji strony glownej');

-- Obsluga na miejscu.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_checkpoints c WHERE c.event_id = pg_temp.f92_id('full')) = 3
  AND (SELECT c.session_id = pg_temp.map92('full', '92300000-0000-0000-0000-0000000000a1')
         FROM public.event_checkpoints c WHERE c.id = pg_temp.map92('full', '92b00000-0000-0000-0000-0000000000a2'))
  AND (SELECT c.sponsor_id = pg_temp.map92('full', '92600000-0000-0000-0000-0000000000a1')
         FROM public.event_checkpoints c WHERE c.id = pg_temp.map92('full', '92b00000-0000-0000-0000-0000000000a4'))
  AND (SELECT c.room_id = pg_temp.map92('full', '92100000-0000-0000-0000-0000000000a1')
         FROM public.event_checkpoints c WHERE c.id = pg_temp.map92('full', '92b00000-0000-0000-0000-0000000000a1')),
  '92/klon/odprawa: trzy punkty z NOWA sesja, sponsorem i sala; punkt odwolanej sesji pominiety');
SELECT pg_temp.assert(
  (SELECT b.version = 1 AND b.is_default FROM public.event_badge_templates b WHERE b.event_id = pg_temp.f92_id('full')),
  '92/klon/odprawa: szablon identyfikatora od wersji 1');

-- Gielda spotkan.
SELECT pg_temp.assert(
  (SELECT m.meeting_days[1] = (pg_temp.t92(2, 4, 2, 12, 0) AT TIME ZONE 'Europe/Warsaw')::date
      AND m.meeting_days[2] = (pg_temp.t92(2, 4, 3, 12, 0) AT TIME ZONE 'Europe/Warsaw')::date
      AND pg_temp.hm92(m.invites_close_at, 'Europe/Warsaw') = '18:00'
      AND m.timezone = 'Europe/Warsaw' AND m.updated_by = '92a00000-0000-0000-0000-0000000000a1'
     FROM public.event_meeting_settings m WHERE m.event_id = pg_temp.f92_id('full')),
  '92/klon/spotkania: dni gieldy o cale dni lokalne, okno zaproszen przesuniete');
SELECT pg_temp.assert(
  (SELECT t.room_id = pg_temp.map92('full', '92100000-0000-0000-0000-0000000000a2')
     FROM public.event_meeting_tables t WHERE t.event_id = pg_temp.f92_id('full'))
  AND (SELECT r.group_id = pg_temp.map92('full', '92900000-0000-0000-0000-0000000000a1')
         FROM public.event_meeting_rule_groups r WHERE r.event_id = pg_temp.f92_id('full')),
  '92/klon/spotkania: stolik w NOWEJ sali, regula dla NOWEJ grupy');

-- Nabor prelegentow.
SELECT pg_temp.assert(
  (SELECT c.status = 'draft' AND pg_temp.hm92(c.closes_at, 'Europe/Warsaw') = '23:59'
      AND c.track_ids = ARRAY[pg_temp.map92('full', '92200000-0000-0000-0000-0000000000a1')]
      AND c.speaker_ticket_type_id = pg_temp.map92('full', '92400000-0000-0000-0000-0000000000a1')
      AND c.speaker_group_id IN (SELECT g.id FROM public.event_groups g
                                  WHERE g.event_id = pg_temp.f92_id('full') AND g.key = 'speakers')
     FROM public.event_cfp_settings c WHERE c.event_id = pg_temp.f92_id('full')),
  '92/klon/nabor: szkic, okno przesuniete, sciezki/grupa/bilet NOWEJ edycji');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_cfp_fields f WHERE f.event_id = pg_temp.f92_id('full')) = 1
  AND (SELECT r.track_ids = ARRAY[pg_temp.map92('full', '92200000-0000-0000-0000-0000000000a1')]
         FROM public.event_cfp_reviewers r WHERE r.event_id = pg_temp.f92_id('full')),
  '92/klon/nabor: pole formularza i recenzent (na zyczenie) z NOWA sciezka');

-- Plan sali.
SELECT pg_temp.assert(
  (SELECT m.status = 'draft' AND m.published_at IS NULL
      AND m.room_id = pg_temp.map92('full', '92100000-0000-0000-0000-0000000000a1')
      AND m.session_id = pg_temp.map92('full', '92300000-0000-0000-0000-0000000000a1')
     FROM public.event_seat_maps m WHERE m.event_id = pg_temp.f92_id('full')),
  '92/klon/plan: plan jako szkic w NOWEJ sali i sesji');
SELECT pg_temp.assert(
  (SELECT s.status FROM public.event_seats s WHERE s.id = pg_temp.map92('full', '92e50000-0000-0000-0000-0000000000a1')) = 'blocked'
  AND (SELECT s.status = 'held' AND s.hold_company_id = '92c00000-0000-0000-0000-0000000000c1' AND s.hold_note = 'Dla zarzadu'
         FROM public.event_seats s WHERE s.id = pg_temp.map92('full', '92e50000-0000-0000-0000-0000000000a2'))
  AND (SELECT s.status = 'available' AND s.hold_sponsor_id IS NULL
         FROM public.event_seats s WHERE s.id = pg_temp.map92('full', '92e50000-0000-0000-0000-0000000000a3'))
  AND (SELECT s.status = 'available' AND s.hold_note IS NULL
         FROM public.event_seats s WHERE s.id = pg_temp.map92('full', '92e50000-0000-0000-0000-0000000000a4'))
  AND (SELECT s.category_id = pg_temp.map92('full', '92e10000-0000-0000-0000-0000000000a1')
         FROM public.event_seats s WHERE s.id = pg_temp.map92('full', '92e50000-0000-0000-0000-0000000000a5')),
  '92/klon/plan: blokada zostaje, rezerwacja firmy CRM zostaje, rezerwacje sponsora i notatki wyczyszczone');
SELECT pg_temp.assert(
  (SELECT l.ticket_type_id = pg_temp.map92('full', '92400000-0000-0000-0000-0000000000a1')
     FROM public.event_seat_category_tickets l WHERE l.event_id = pg_temp.f92_id('full')),
  '92/klon/plan: kategoria miejsc powiazana z NOWYM biletem');

-- Kampania, reklama, kody.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_ad_campaigns c WHERE c.event_id = pg_temp.f92_id('full')) = 1,
  '92/klon: mapowanie kampanii Google Ads (na zyczenie)');
SELECT pg_temp.assert(
  (SELECT a.is_active IS FALSE AND a.group_ids = ARRAY[pg_temp.map92('full', '92900000-0000-0000-0000-0000000000a1')]
      AND a.sponsor_id = pg_temp.map92('full', '92600000-0000-0000-0000-0000000000a1')
      AND pg_temp.hm92(a.ends_at, 'Europe/Warsaw') = '23:00'
     FROM public.event_home_ads a WHERE a.event_id = pg_temp.f92_id('full')),
  '92/klon: reklama nieaktywna (sponsorzy nieopublikowani), NOWE grupy i sponsor, okno przesuniete');
SELECT pg_temp.assert(
  (SELECT c.redemptions_count = 0 AND c.event_ids = ARRAY[pg_temp.f92_id('full')]
      AND c.ticket_type_ids = '{}'::uuid[]
     FROM public.b2b_coupons c WHERE c.code = 'EARLY92-2027')
  AND (SELECT c.event_ids FROM public.b2b_coupons c WHERE c.code = 'VIP92-2027') = '{}'::uuid[],
  '92/klon/kody: kod z przyrostkiem, licznik od zera, NOWE wydarzenie; kolizja nie nadpisuje cudzego kodu');
SELECT pg_temp.assert(
  (SELECT (v->'copied'->>'codes')::int = 1 AND (v->'skipped'->>'codes')::int = 1 FROM f92 WHERE k = 'full'),
  '92/klon/kody: jeden skopiowany, jeden pominiety na kolizji');

-- Nic osobowego.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations x WHERE x.event_id = pg_temp.f92_id('full')) = 0
  AND (SELECT count(*) FROM public.event_scanner_devices x WHERE x.event_id = pg_temp.f92_id('full')) = 0
  AND (SELECT count(*) FROM public.event_seat_assignments x WHERE x.event_id = pg_temp.f92_id('full')) = 0
  AND (SELECT count(*) FROM public.event_checkins x WHERE x.event_id = pg_temp.f92_id('full')) = 0
  AND (SELECT count(*) FROM public.event_group_members x WHERE x.event_id = pg_temp.f92_id('full')) = 0
  AND (SELECT count(*) FROM public.event_package_orders x WHERE x.event_id = pg_temp.f92_id('full')) = 0,
  '92/klon: zadnych zapisow, urzadzen, przydzialow, odpraw, czlonkostw ani zamowien');
SELECT pg_temp.assert(
  (SELECT (v->'skipped'->>'registrations')::int = 1 AND (v->'skipped'->>'scanner_devices')::int = 1
      AND (v->'skipped'->>'seat_assignments')::int = 1
     FROM f92 WHERE k = 'full'),
  '92/klon: wynik raportuje, czego z zasady nie przeniosl');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions s WHERE s.event_id = '92e00000-0000-0000-0000-0000000000e1') = 5
  AND (SELECT sold_count FROM public.event_ticket_types WHERE id = '92400000-0000-0000-0000-0000000000a1') > 0,
  '92/klon: zrodlo nietkniete');

-- CRM: os czasu firm i zadania odnowienia.
SELECT pg_temp.assert(
  (SELECT count(*) = 2 AND bool_and(a.metadata->>'event_id' = pg_temp.f92_id('full')::text)
      AND bool_and(a.metadata->>'summary_pl' LIKE 'Sponsor przeniesiony do nowej edycji: Kongres 92 2027')
      AND bool_and(a.metadata->>'source_event_id' = '92e00000-0000-0000-0000-0000000000e1')
     FROM public.audit_log a WHERE a.action = 'event.clone.sponsor_copied' AND a.entity_type = 'crm_company'
      AND a.tenant_id = '11111111-1111-1111-1111-111111111111'),
  '92/klon/CRM: wpis osi czasu dla kazdej przeniesionej firmy (kontrakt metadanych)');
SELECT pg_temp.assert(
  (SELECT count(*) = 2
      AND bool_and(t.title = 'Odnowienie partnerstwa: Kongres 92 2027')
      AND bool_and(t.due_at > now() + interval '13 days' AND t.due_at < now() + interval '15 days')
      AND bool_and(t.created_by = '92a00000-0000-0000-0000-0000000000a1')
     FROM public.crm_tasks t WHERE t.tenant_id = '11111111-1111-1111-1111-111111111111'),
  '92/klon/CRM: zadanie odnowienia dla kazdego GLOWNEGO kontaktu (bez kontaktu marketingowego)');
SELECT pg_temp.assert(
  (SELECT t.assignee_id FROM public.crm_tasks t WHERE t.lead_id = '92d00000-0000-0000-0000-0000000000d1')
    = '92a00000-0000-0000-0000-0000000000a7'
  AND (SELECT t.assignee_id FROM public.crm_tasks t WHERE t.lead_id = '92d00000-0000-0000-0000-0000000000d2')
    = '92a00000-0000-0000-0000-0000000000a1',
  '92/klon/CRM: zadanie przypisane opiekunowi kontaktu, bez opiekuna - klonujacemu');
SELECT pg_temp.assert(
  (SELECT (v->'copied'->>'crm_tasks')::int = 2 AND (v->'copied'->>'crm_timeline_entries')::int = 2
     FROM f92 WHERE k = 'full'),
  '92/klon/CRM: liczniki w wyniku');

-- Zdarzenie domenowe i idempotencja.
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.domain_events d
           WHERE d.event_type = 'event.cloned.v1' AND d.aggregate_type = 'event'
             AND d.aggregate_id = pg_temp.f92_id('full')::text
             AND d.payload->>'source_event_id' = '92e00000-0000-0000-0000-0000000000e1'
             AND d.actor_id = '92a00000-0000-0000-0000-0000000000a1'),
  '92/klon: zdarzenie event.cloned.v1 zapisane z aktorem');
SELECT pg_temp.assert(
  (SELECT c.status = 'succeeded' AND c.command = 'event.clone' AND c.result->>'event_id' = pg_temp.f92_id('full')::text
     FROM public.command_idempotency c WHERE c.idempotency_key = 'event.clone:92-klucz-pelny'),
  '92/idempotencja: klucz zapamietany z wynikiem');

-- ---------------------------------------------------------------------------
-- SEKCJA 6: POWTORKA, KONFLIKT, KLUCZ W TOKU, DEDUPLIKACJA ZADAN CRM
-- ---------------------------------------------------------------------------
INSERT INTO f92 VALUES ('replay', public.admin_event_clone(pg_temp.p92(jsonb_build_object(
  'idempotency_key', 'event.clone:92-klucz-pelny', 'title_pl', 'Zupelnie inny tytul'))));
SELECT pg_temp.assert(
  (SELECT (v->>'replayed')::boolean AND (v->>'event_id')::uuid = pg_temp.f92_id('full') FROM f92 WHERE k = 'replay')
  AND (SELECT count(*) FROM public.events e WHERE e.previous_edition_id = '92e00000-0000-0000-0000-0000000000e1') = 1,
  '92/idempotencja: powtorka tym samym kluczem oddaje TE SAMA edycje (replayed) i niczego nie tworzy');

SELECT pg_temp.act_as('92a00000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"idempotency_key": "event.clone:92-klucz-pelny"}''))',
  'idempotency_conflict', '92/idempotencja: inny admin z cudzym kluczem - konflikt, bez wyniku');
SELECT pg_temp.act_as('92a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.command_idempotency (tenant_id, idempotency_key, command, actor_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'event.clone:92-w-toku', 'event.clone', '92a00000-0000-0000-0000-0000000000a1'),
  ('11111111-1111-1111-1111-111111111111', 'crm.add_task:92-inna', 'crm.add_task', '92a00000-0000-0000-0000-0000000000a1');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"idempotency_key": "event.clone:92-w-toku"}''))',
  'clone_in_progress', '92/idempotencja: klucz w toku - odmowa zamiast drugiej kopii');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_clone(pg_temp.p92(''{"idempotency_key": "crm.add_task:92-inna"}''))',
  'idempotency_conflict', '92/idempotencja: klucz innej komendy - konflikt');

-- Drugi klon z zadaniami CRM: te same tytuly = zadnego nowego zadania.
INSERT INTO f92 VALUES ('dedupe', public.admin_event_clone(pg_temp.p92(jsonb_build_object(
  'slug', 'kongres-92-druga-kopia', 'options', jsonb_build_object('crm_renewal_tasks', true)))));
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.crm_tasks t WHERE t.tenant_id = '11111111-1111-1111-1111-111111111111') = 2
  AND (SELECT (v->'copied'->>'crm_tasks')::int = 0 AND v->>'slug' = 'kongres-92-druga-kopia' FROM f92 WHERE k = 'dedupe'),
  '92/klon/CRM: zadania odnowienia deduplikowane (otwarte o tym tytule juz sa); slug podany wprost');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.b2b_coupons c WHERE pg_temp.f92_id('dedupe') = ANY (c.event_ids)) = 0
  AND (SELECT count(*) FROM public.event_cfp_reviewers r WHERE r.event_id = pg_temp.f92_id('dedupe')) = 0
  AND (SELECT count(*) FROM public.event_home_ads a WHERE a.event_id = pg_temp.f92_id('dedupe')) = 0
  AND (SELECT count(*) FROM public.event_ad_campaigns a WHERE a.event_id = pg_temp.f92_id('dedupe')) = 0
  AND (SELECT count(*) FROM public.event_sponsor_materials m WHERE m.event_id = pg_temp.f92_id('dedupe')) = 0
  AND (SELECT count(*) FROM public.event_sessions s WHERE s.event_id = pg_temp.f92_id('dedupe')) = 3,
  '92/klon: domyslne przelaczniki - bez kodow, recenzentow, reklam, kampanii i materialow; agenda jest');

-- ---------------------------------------------------------------------------
-- SEKCJA 7: WARIANTY PRZELACZNIKOW
-- ---------------------------------------------------------------------------
-- Bez agendy i bez biletow (kody na zyczenie, ale bez biletow nie przechodza).
INSERT INTO f92 VALUES ('lean', public.admin_event_clone(pg_temp.p92(jsonb_build_object(
  'title_pl', 'Kongres 92 lekki', 'title_en', 'Congress 92 lean',
  'include', jsonb_build_object('agenda', false, 'tickets', false, 'codes', true, 'sponsors', false,
                                'pages', false, 'onsite', true),
  'options', jsonb_build_object('code_suffix', '-L')))));
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions s WHERE s.event_id = pg_temp.f92_id('lean')) = 0
  AND (SELECT count(*) FROM public.event_rooms r WHERE r.event_id = pg_temp.f92_id('lean')) = 0
  AND (SELECT count(*) FROM public.event_session_speakers x WHERE x.event_id = pg_temp.f92_id('lean')) = 0
  AND (SELECT count(*) FROM public.event_speaker_entries x WHERE x.event_id = pg_temp.f92_id('lean')) = 2,
  '92/wariant: bez agendy - lista prelegentow jest, obsady sesji nie ma');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_ticket_types t WHERE t.event_id = pg_temp.f92_id('lean')) = 0
  AND (SELECT count(*) FROM public.b2b_coupons c WHERE c.code LIKE '%-L') = 0
  AND (SELECT count(*) FROM public.event_seat_category_tickets l WHERE l.event_id = pg_temp.f92_id('lean')) = 0
  AND (SELECT c.speaker_ticket_type_id IS NULL AND c.track_ids = '{}'::uuid[]
         FROM public.event_cfp_settings c WHERE c.event_id = pg_temp.f92_id('lean'))
  AND (SELECT m.room_id IS NULL AND m.session_id IS NULL FROM public.event_seat_maps m WHERE m.event_id = pg_temp.f92_id('lean')),
  '92/wariant: bez biletow - kody, powiazania kategorii i bilet naboru nie wisza; plan bez sali i sesji');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors s WHERE s.event_id = pg_temp.f92_id('lean')) = 0
  AND (SELECT count(*) FROM public.event_sponsor_tiers t WHERE t.event_id = pg_temp.f92_id('lean')) = 1
  AND (SELECT count(*) FROM public.event_checkpoints c WHERE c.event_id = pg_temp.f92_id('lean')) = 1
  AND (SELECT (v->'skipped'->>'checkpoints')::int = 3 FROM f92 WHERE k = 'lean'),
  '92/wariant: bez sponsorow - poziomy zostaja; punkty sesji i stoiska pominiete');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_pages ep WHERE ep.event_id = pg_temp.f92_id('lean') AND ep.module IS NOT NULL) = 5
  AND (SELECT count(*) FROM public.event_pages ep WHERE ep.event_id = pg_temp.f92_id('lean') AND ep.module IS NULL) = 0
  AND (SELECT count(*) FROM public.event_page_sections s WHERE s.event_id = pg_temp.f92_id('lean')) = 0,
  '92/wariant: bez stron - i tak piec stron modulowych (menu nie jest puste), bez kopii tresci');
SELECT pg_temp.assert(
  (SELECT v->'warnings' @> '[{"code": "codes_need_tickets", "count": 2}, {"code": "cast_needs_agenda", "count": 2}]'::jsonb
     FROM f92 WHERE k = 'lean'),
  '92/wariant: ostrzezenia - kody wymagaja biletow, obsada wymaga agendy');

-- Kody dostepu na zyczenie, sesje odwolane na zyczenie, sesje jako szkic, zmiana strefy.
INSERT INTO f92 VALUES ('london', public.admin_event_clone(pg_temp.p92(jsonb_build_object(
  'title_pl', 'Kongres 92 Londyn', 'title_en', 'Congress 92 London', 'timezone', 'Europe/London',
  'starts_at', make_timestamptz(extract(year FROM now())::int + 2, 4, 2, 9, 0, 0, 'Europe/London'),
  'options', jsonb_build_object('keep_access_codes', true, 'include_cancelled_sessions', true,
                                'sessions_as_draft', true, 'sponsors_unpublished', false,
                                'refresh_sponsor_snapshots', false)))));
SELECT pg_temp.assert(
  (SELECT e.timezone = 'Europe/London' FROM public.events e WHERE e.id = pg_temp.f92_id('london'))
  AND (SELECT pg_temp.hm92(s.starts_at, 'Europe/London') = '09:30'
         FROM public.event_sessions s WHERE s.id = pg_temp.map92('london', '92300000-0000-0000-0000-0000000000a1')),
  '92/wariant: zmiana strefy zachowuje godziny lokalne (09:30 Warszawa -> 09:30 Londyn)');
SELECT pg_temp.assert(
  (SELECT t.access_code_hash = repeat('a', 64) AND t.access_code_hint = 'kod z maila' AND t.is_active
     FROM public.event_ticket_types t WHERE t.id = pg_temp.map92('london', '92400000-0000-0000-0000-0000000000a2')),
  '92/wariant: kod dostepu przeniesiony na zyczenie, bilet aktywny');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions s WHERE s.event_id = pg_temp.f92_id('london')) = 5
  AND (SELECT bool_and(s.status = 'draft' AND s.published_at IS NULL)
         FROM public.event_sessions s WHERE s.event_id = pg_temp.f92_id('london'))
  AND (SELECT s.room_id IS NULL AND s.cancelled_at IS NULL
         FROM public.event_sessions s WHERE s.id = pg_temp.map92('london', '92300000-0000-0000-0000-0000000000a3'))
  AND (SELECT s.parent_session_id = pg_temp.map92('london', '92300000-0000-0000-0000-0000000000a3')
         FROM public.event_sessions s WHERE s.id = pg_temp.map92('london', '92300000-0000-0000-0000-0000000000a4')),
  '92/wariant: sesje odwolane na zyczenie jako szkic BEZ SALI, wszystkie sesje szkicem');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_checkpoints c WHERE c.event_id = pg_temp.f92_id('london')) = 4
  AND (SELECT m.timezone = 'Europe/London' FROM public.event_meeting_settings m WHERE m.event_id = pg_temp.f92_id('london')),
  '92/wariant: punkt odwolanej sesji przechodzi razem z nia; strefa gieldy idzie za strefa wydarzenia');
SELECT pg_temp.assert(
  (SELECT bool_and(s.is_published) AND bool_or(s.snapshot_name = 'Firma C1 92 STARA')
     FROM public.event_sponsors s WHERE s.event_id = pg_temp.f92_id('london')),
  '92/wariant: sponsorzy opublikowani na zyczenie, migawka bez odswiezenia');

-- Zapisy zewnetrzne: adres podany (nadpisanie) i strefa zrodla spoza listy.
INSERT INTO f92 VALUES ('external', public.admin_event_clone(jsonb_build_object(
  'source_event_id', '92e00000-0000-0000-0000-0000000000e3', 'title_pl', 'Zewnetrzne 92 2027',
  'title_en', 'External 92 2027', 'starts_at', pg_temp.t92(2, 6, 1, 10, 0),
  'external_registration_url', 'https://tickets.example.org/92-2027')));
SELECT pg_temp.assert(
  (SELECT e.external_registration_url = 'https://tickets.example.org/92-2027' AND e.registration_mode = 'external'
      AND e.timezone = 'Europe/Warsaw' AND e.ends_at = pg_temp.t92(2, 6, 1, 12, 0)
     FROM public.events e WHERE e.id = pg_temp.f92_id('external'))
  AND (SELECT NOT (v->'warnings' @> '[{"code": "external_url_copied"}]'::jsonb) FROM f92 WHERE k = 'external'),
  '92/wariant: zapisy zewnetrzne z nowym adresem; nieznana strefa zrodla spada do Europe/Warsaw');
INSERT INTO f92 VALUES ('external2', public.admin_event_clone(jsonb_build_object(
  'source_event_id', '92e00000-0000-0000-0000-0000000000e3', 'title_pl', 'Zewnetrzne 92 2028',
  'title_en', 'External 92 2028', 'starts_at', pg_temp.t92(3, 6, 1, 10, 0))));
SELECT pg_temp.assert(
  (SELECT v->'warnings' @> '[{"code": "external_url_copied", "count": 1}]'::jsonb FROM f92 WHERE k = 'external2')
  AND (SELECT e.external_registration_url = 'https://tickets.example.org/92'
         FROM public.events e WHERE e.id = pg_temp.f92_id('external2')),
  '92/wariant: adres zapisow z poprzedniej edycji przechodzi z ostrzezeniem');

-- ---------------------------------------------------------------------------
-- SEKCJA 8: LISTA EDYCJI I RODOWOD
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_editions('92e00000-0000-0000-0000-0000000000e1') x
    WHERE x.relation = 'next') = 4
  AND (SELECT bool_and(x.depth = 1) FROM public.admin_event_editions('92e00000-0000-0000-0000-0000000000e1') x),
  '92/edycje: zrodlo widzi swoje cztery kolejne edycje');
SELECT pg_temp.act_as('92a00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111');
INSERT INTO f92 VALUES ('grandchild', public.admin_event_clone(jsonb_build_object(
  'source_event_id', pg_temp.f92_id('full'), 'title_pl', 'Kongres 92 2028', 'title_en', 'Congress 92 2028',
  'starts_at', pg_temp.t92(3, 4, 7, 9, 0))));
SELECT pg_temp.assert(
  (SELECT e.created_by = '92a00000-0000-0000-0000-0000000000a5' FROM public.events e WHERE e.id = pg_temp.f92_id('grandchild')),
  '92/edycje: super admin klonuje (bramka admin OR super_admin)');
SELECT pg_temp.assert(
  (SELECT array_agg(x.relation || ':' || x.depth || ':' || x.slug ORDER BY x.starts_at)
     FROM public.admin_event_editions(pg_temp.f92_id('grandchild')) x)
    = ARRAY['previous:2:kongres-92', 'previous:1:kongres-92-2027'],
  '92/edycje: wnuk widzi lancuch poprzednich edycji z glebokoscia');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_editions('92e00000-0000-0000-0000-0000000000e1') x
    WHERE x.relation = 'next' AND x.depth = 2) = 1,
  '92/edycje: zrodlo widzi takze edycje kolejnej edycji (glebokosc 2)');
SELECT pg_temp.assert_raises_like(
  'SELECT * FROM public.admin_event_editions(''92e00000-0000-0000-0000-0000000000ff'')',
  'not_found', '92/edycje: nieistniejace wydarzenie');

-- Skasowanie zrodla urywa rodowod (SET NULL), nie kasuje kolejnej edycji.
DELETE FROM public.events WHERE id = '92e00000-0000-0000-0000-0000000000e3';
SELECT pg_temp.assert(
  (SELECT count(*) = 2 AND bool_and(e.previous_edition_id IS NULL)
     FROM public.events e WHERE e.id IN (pg_temp.f92_id('external'), pg_temp.f92_id('external2'))),
  '92/rodowod: skasowanie poprzedniej edycji zeruje previous_edition_id, kopie zostaja');
SELECT pg_temp.assert_raises_like(
  format('UPDATE public.events SET previous_edition_id = id WHERE id = %L', pg_temp.f92_id('full')),
  'events_previous_edition_not_self', '92/rodowod: wydarzenie nie moze byc wlasna poprzednia edycja');
SELECT pg_temp.assert_raises_like(
  format('UPDATE public.events SET previous_edition_id = %L WHERE id = %L',
         '92e00000-0000-0000-0000-0000000000eb', pg_temp.f92_id('full')),
  'events_previous_edition_fk', '92/rodowod: poprzednia edycja z obcego najemcy odrzucona kluczem zlozonym');

\echo '== 92 klon edycji: koniec =='
ROLLBACK;
