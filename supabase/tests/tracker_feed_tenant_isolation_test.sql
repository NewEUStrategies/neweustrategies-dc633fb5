-- pgTAP: izolacja tenanta dla zrodel kanalu RSS trackera (/tracker/rss.xml).
--
-- Kanal czyta service-role (lib/server/publishedContent.server.ts -
-- fetchTrackerFeedSources), wiec RLS go NIE chroni: jedyna obrona to jawny
-- filtr `.eq("tenant_id", ...)` po tenancie wlascicielu hosta. Ten plik
-- przypina dwa niezmienniki, na ktorych ten filtr stoi:
--
--   1. dane SA rozdzielone per tenant - dossier i aktualizacje maja wlasne
--      tenant_id, wiec filtr ma po czym dzialac (brak kolumny albo wspolny
--      tenant techniczny czynilby feed nieizolowalnym z definicji),
--   2. warstwa RLS dla anon/authenticated jest fail-closed w te sama strone:
--      obce tenanty i dossier nieopublikowane sa niewidoczne - wiec nawet gdy
--      ktos przepisze czytnik na klienta anon, kanal nie przecieknie.
--
-- Trzeci niezmiennik (aktualizacja bez opublikowanego dossier nie trafia do
-- kanalu) jest testowany po stronie czystego modelu:
-- src/lib/tracker/__tests__/feed.test.ts - "ODRZUCA aktualizacje bez dossier".
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(8);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d8111111-1111-1111-1111-111111111111', 'tenant-feed-obcy', 'Feed Obcy');

INSERT INTO auth.users (id, email) VALUES
  ('d8000000-0000-0000-0000-0000000000aa', 'reader@feed.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d8000000-0000-0000-0000-0000000000aa', 'reader@feed.test', 'Feed Reader',
   (SELECT public.public_tenant_id()));

INSERT INTO public.eu_policy_items (id, tenant_id, slug, title_pl, title_en, policy_area, stage, importance, status) VALUES
  ('d8222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
   'feed-dossier-pub', 'Dossier publiczne', 'Public file', 'digital', 'proposal', 3, 'published'),
  ('d8222222-2222-2222-2222-222222222202', (SELECT public.public_tenant_id()),
   'feed-dossier-szkic', 'Dossier szkic', 'Draft file', 'digital', 'proposal', 1, 'draft'),
  ('d8222222-2222-2222-2222-222222222203', 'd8111111-1111-1111-1111-111111111111',
   'feed-dossier-obcy', 'Dossier obcego tenanta', 'Foreign tenant file', 'energy', 'council', 3, 'published');

INSERT INTO public.eu_policy_updates (id, item_id, note_pl, note_en, happened_on) VALUES
  ('d8333333-3333-3333-3333-333333333301', 'd8222222-2222-2222-2222-222222222201',
   'Zmiana publiczna', 'Public change', current_date),
  ('d8333333-3333-3333-3333-333333333302', 'd8222222-2222-2222-2222-222222222202',
   'Zmiana przy szkicu', 'Draft change', current_date),
  ('d8333333-3333-3333-3333-333333333303', 'd8222222-2222-2222-2222-222222222203',
   'Zmiana obcego tenanta', 'Foreign tenant change', current_date);

-- -- 1. Kolumny tenanta: filtr kanalu ma po czym dzialac -----------------------------

SELECT has_column('public', 'eu_policy_items', 'tenant_id',
  'dossier niesie tenant_id (baza filtra kanalu)');
SELECT has_column('public', 'eu_policy_updates', 'tenant_id',
  'aktualizacja niesie tenant_id (baza filtra kanalu)');

SELECT is(
  (SELECT tenant_id FROM public.eu_policy_updates
    WHERE id = 'd8333333-3333-3333-3333-333333333303'),
  'd8111111-1111-1111-1111-111111111111'::uuid,
  'trigger przepisuje tenant_id aktualizacji z dossier nadrzednego (nie z sesji)'
);

SELECT is(
  (SELECT count(*)::int FROM public.eu_policy_items
    WHERE tenant_id = (SELECT public.public_tenant_id())
      AND status = 'published'
      AND slug LIKE 'feed-dossier-%'),
  1,
  'filtr (tenant + published) zwraca dokladnie jedno dossier publicznego tenanta'
);

SELECT is(
  (SELECT count(*)::int FROM public.eu_policy_updates u
    JOIN public.eu_policy_items i ON i.id = u.item_id
   WHERE u.tenant_id = (SELECT public.public_tenant_id())
     AND i.status = 'published'
     AND u.id IN ('d8333333-3333-3333-3333-333333333301',
                  'd8333333-3333-3333-3333-333333333302',
                  'd8333333-3333-3333-3333-333333333303')),
  1,
  'ten sam filtr na aktualizacjach odsiewa szkic i obcy tenant'
);

-- -- 2. RLS fail-closed w te sama strone (obrona przy przepisaniu na anon) -----------

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.eu_policy_items WHERE slug LIKE 'feed-dossier-%'),
  1,
  'anon widzi tylko opublikowane dossier wlasnego tenanta (szkic i obcy odpadaja)'
);

SELECT is(
  (SELECT count(*)::int FROM public.eu_policy_updates
    WHERE id IN ('d8333333-3333-3333-3333-333333333301',
                 'd8333333-3333-3333-3333-333333333302',
                 'd8333333-3333-3333-3333-333333333303')),
  1,
  'anon widzi tylko aktualizacje opublikowanego dossier wlasnego tenanta'
);

SELECT is(
  (SELECT count(*)::int FROM public.eu_policy_updates
    WHERE note_pl = 'Zmiana obcego tenanta'),
  0,
  'nota obcego tenanta jest niewidoczna dla anon (kanal nie ma jej skad wziac)'
);

SELECT * FROM finish();
ROLLBACK;
