-- pgTAP: cele @wzmianek nie wystawiają kartoteki CRM (migracja 20261003150000).
--
-- Defekt (20260922080000): `search_mention_targets` oddawała anonimowi KAŻDĄ
-- firmę z `crm_companies` najemcy po dwóch literach frazy, a `'%%'` (fraza
-- wprost do LIKE) zrzucało katalog jednym wywołaniem. `get_mention_target`
-- otwierała kartę dowolnej firmy po UUID. Nagłówek `x-tenant-host` przenosił oba
-- zrzuty na kartotekę obcego najemcy.
--
-- Kontrakt po naprawie, sprawdzany tu na prawdziwej bazie (atrapa PostgREST
-- w Vitest nie zna ani grantów, ani SECURITY DEFINER, ani nagłówków):
--   1. firma jest celem TYLKO z publicznym śladem: organizacja opublikowanego,
--      nieusuniętego wpisu albo opublikowany sponsor opublikowanego wydarzenia;
--      lead, wpis roboczy/zaplanowany/usunięty, sponsor nieopublikowany,
--      wydarzenie robocze/odwołane - nie;
--   2. ta sama reguła w podpowiedziach i w odczycie punktowym (dymek, strona
--      /organization/org-<uuid>);
--   3. fraza nie jest wzorcem: `%%` i `__` nie pasują do wszystkiego, a `%`
--      w nazwie firmy trafia dosłownie;
--   4. sfałszowany nagłówek nie wydaje leadów obcego najemcy, a atrybucja
--      wpisu z innego najemcy nie publikuje firmy;
--   5. zwykły członek i redaktor dostają ten sam wynik co gość (bez gałęzi
--      „staff widzi całą kartotekę" w funkcji publicznej);
--   6. ścieżka osób działa po przepisaniu (regresja optymalizacji);
--   7. granty: RPC dla anon/authenticated zostają, pomocnik nie ma EXECUTE.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(24);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed (jako właściciel; RLS pomijane) ────────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('d7a11111-1111-1111-1111-111111111111', 'mention-fp-a', 'Mention Footprint A', 'a.mention-fp.example'),
  ('d7b22222-2222-2222-2222-222222222222', 'mention-fp-b', 'Mention Footprint B', 'b.mention-fp.example');

INSERT INTO auth.users (id, email) VALUES
  ('d7000000-0000-0000-0000-0000000000a1', 'author-a@mention-fp.test'),
  ('d7000000-0000-0000-0000-0000000000a2', 'member-a@mention-fp.test'),
  ('d7000000-0000-0000-0000-0000000000a3', 'editor-a@mention-fp.test'),
  ('d7000000-0000-0000-0000-0000000000b1', 'author-b@mention-fp.test');

INSERT INTO public.profiles (id, email, display_name, slug, discoverable, tenant_id) VALUES
  ('d7000000-0000-0000-0000-0000000000a1', 'author-a@mention-fp.test', 'Anna Autorka',
   'anna-autorka-fp', true, 'd7a11111-1111-1111-1111-111111111111'),
  ('d7000000-0000-0000-0000-0000000000a2', 'member-a@mention-fp.test', 'Marek Czytelnik',
   'marek-czytelnik-fp', true, 'd7a11111-1111-1111-1111-111111111111'),
  ('d7000000-0000-0000-0000-0000000000a3', 'editor-a@mention-fp.test', 'Ewa Redaktor',
   'ewa-redaktor-fp', true, 'd7a11111-1111-1111-1111-111111111111'),
  ('d7000000-0000-0000-0000-0000000000b1', 'author-b@mention-fp.test', 'Bartek Autor',
   'bartek-autor-fp', true, 'd7b22222-2222-2222-2222-222222222222');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d7000000-0000-0000-0000-0000000000a1', 'author', 'd7a11111-1111-1111-1111-111111111111'),
  ('d7000000-0000-0000-0000-0000000000a2', 'user',   'd7a11111-1111-1111-1111-111111111111'),
  ('d7000000-0000-0000-0000-0000000000a3', 'editor', 'd7a11111-1111-1111-1111-111111111111'),
  ('d7000000-0000-0000-0000-0000000000b1', 'author', 'd7b22222-2222-2222-2222-222222222222');

-- Kartoteka najemcy A: każda nazwa zawiera „Alfa", więc fraza `alfa` dotyka
-- WSZYSTKICH wierszy - o wyniku decyduje wyłącznie bramka śladu.
INSERT INTO public.crm_companies (id, tenant_id, name, website, branch) VALUES
  ('d7c00000-0000-0000-0000-000000000001', 'd7a11111-1111-1111-1111-111111111111', 'Alfa Lead Prospekt',     'https://lead.example',   'Energetyka'),
  ('d7c00000-0000-0000-0000-000000000002', 'd7a11111-1111-1111-1111-111111111111', 'Alfa Media Partner',     'https://media.example',  'Media'),
  ('d7c00000-0000-0000-0000-000000000003', 'd7a11111-1111-1111-1111-111111111111', 'Alfa Szkic Wpisu',       NULL,                     NULL),
  ('d7c00000-0000-0000-0000-000000000004', 'd7a11111-1111-1111-1111-111111111111', 'Alfa Wpis Usuniety',     NULL,                     NULL),
  ('d7c00000-0000-0000-0000-000000000005', 'd7a11111-1111-1111-1111-111111111111', 'Alfa Wpis Zaplanowany',  NULL,                     NULL),
  ('d7c00000-0000-0000-0000-000000000006', 'd7a11111-1111-1111-1111-111111111111', 'Alfa Sponsor Glowny',    'https://sponsor.example','Finanse'),
  ('d7c00000-0000-0000-0000-000000000007', 'd7a11111-1111-1111-1111-111111111111', 'Alfa Sponsor Ukryty',    NULL,                     NULL),
  ('d7c00000-0000-0000-0000-000000000008', 'd7a11111-1111-1111-1111-111111111111', 'Alfa Sponsor Szkicu',    NULL,                     NULL),
  ('d7c00000-0000-0000-0000-000000000009', 'd7a11111-1111-1111-1111-111111111111', 'Alfa Sponsor Odwolany',  NULL,                     NULL),
  ('d7c00000-0000-0000-0000-00000000000a', 'd7a11111-1111-1111-1111-111111111111', 'Alfa Krzyzowa',          NULL,                     NULL),
  ('d7c00000-0000-0000-0000-00000000000b', 'd7a11111-1111-1111-1111-111111111111', 'Procent 100% Analityka', NULL,                     NULL),
  -- Kartoteka najemcy B.
  ('d7c00000-0000-0000-0000-0000000000b1', 'd7b22222-2222-2222-2222-222222222222', 'Alfa Bravo Lead',        NULL,                     NULL),
  ('d7c00000-0000-0000-0000-0000000000b2', 'd7b22222-2222-2222-2222-222222222222', 'Alfa Bravo Publiczna',   NULL,                     NULL);

-- Wpis wymaga strony nadrzędnej (`posts.parent_page_id` NOT NULL).
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('d7d00000-0000-0000-0000-0000000000a0', 'd7a11111-1111-1111-1111-111111111111', 'fp-home-a'),
  ('d7d00000-0000-0000-0000-0000000000b0', 'd7b22222-2222-2222-2222-222222222222', 'fp-home-b');

-- Wpisy. Autorka A ma jeden opublikowany (ścieżka osób). Firma 0a jest
-- przypisana do wpisu NAJEMCY B - FK `organization_id` nie niesie najemcy,
-- więc to dokładnie przypadek, którego bramka nie może wziąć za ślad.
INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl, organization_id, deleted_at) VALUES
  ('d7e00000-0000-0000-0000-000000000001', 'fp-published', 'd7000000-0000-0000-0000-0000000000a1', 'published',
   'd7a11111-1111-1111-1111-111111111111', 'd7d00000-0000-0000-0000-0000000000a0', 'Opublikowany', 'd7c00000-0000-0000-0000-000000000002', NULL),
  ('d7e00000-0000-0000-0000-000000000002', 'fp-draft', 'd7000000-0000-0000-0000-0000000000a1', 'draft',
   'd7a11111-1111-1111-1111-111111111111', 'd7d00000-0000-0000-0000-0000000000a0', 'Roboczy', 'd7c00000-0000-0000-0000-000000000003', NULL),
  ('d7e00000-0000-0000-0000-000000000003', 'fp-deleted', 'd7000000-0000-0000-0000-0000000000a1', 'published',
   'd7a11111-1111-1111-1111-111111111111', 'd7d00000-0000-0000-0000-0000000000a0', 'Usuniety', 'd7c00000-0000-0000-0000-000000000004', now()),
  ('d7e00000-0000-0000-0000-000000000004', 'fp-scheduled', 'd7000000-0000-0000-0000-0000000000a1', 'scheduled',
   'd7a11111-1111-1111-1111-111111111111', 'd7d00000-0000-0000-0000-0000000000a0', 'Zaplanowany', 'd7c00000-0000-0000-0000-000000000005', NULL),
  ('d7e00000-0000-0000-0000-000000000005', 'fp-percent', 'd7000000-0000-0000-0000-0000000000a1', 'published',
   'd7a11111-1111-1111-1111-111111111111', 'd7d00000-0000-0000-0000-0000000000a0', 'Procent', 'd7c00000-0000-0000-0000-00000000000b', NULL),
  ('d7e00000-0000-0000-0000-0000000000b1', 'fp-b-published', 'd7000000-0000-0000-0000-0000000000b1', 'published',
   'd7b22222-2222-2222-2222-222222222222', 'd7d00000-0000-0000-0000-0000000000b0', 'Opublikowany B', 'd7c00000-0000-0000-0000-0000000000b2', NULL),
  ('d7e00000-0000-0000-0000-0000000000b2', 'fp-b-cross', 'd7000000-0000-0000-0000-0000000000b1', 'published',
   'd7b22222-2222-2222-2222-222222222222', 'd7d00000-0000-0000-0000-0000000000b0', 'Krzyzowy B', 'd7c00000-0000-0000-0000-00000000000a', NULL);

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, kind, starts_at, visibility, min_tier_rank, status) VALUES
  ('d7f00000-0000-0000-0000-000000000001', 'd7a11111-1111-1111-1111-111111111111', 'fp-event-live',
   'Wydarzenie', 'Event', 'webinar', now() + interval '7 days', 'public', 0, 'published'),
  ('d7f00000-0000-0000-0000-000000000002', 'd7a11111-1111-1111-1111-111111111111', 'fp-event-draft',
   'Szkic', 'Draft', 'webinar', now() + interval '7 days', 'public', 0, 'draft'),
  ('d7f00000-0000-0000-0000-000000000003', 'd7a11111-1111-1111-1111-111111111111', 'fp-event-cancelled',
   'Odwolane', 'Cancelled', 'webinar', now() + interval '7 days', 'public', 0, 'cancelled');

-- Rola `partner`: opublikowany `sponsor` wymaga poziomu cennika
-- (`event_sponsors_published_sponsor_needs_tier`), a bramka śladu na roli nie
-- patrzy - liczy się publikacja wiersza i wydarzenia.
INSERT INTO public.event_sponsors (tenant_id, event_id, company_id, role, is_published, snapshot_name) VALUES
  ('d7a11111-1111-1111-1111-111111111111', 'd7f00000-0000-0000-0000-000000000001',
   'd7c00000-0000-0000-0000-000000000006', 'partner', true,  'Alfa Sponsor Glowny'),
  ('d7a11111-1111-1111-1111-111111111111', 'd7f00000-0000-0000-0000-000000000001',
   'd7c00000-0000-0000-0000-000000000007', 'partner', false, 'Alfa Sponsor Ukryty'),
  ('d7a11111-1111-1111-1111-111111111111', 'd7f00000-0000-0000-0000-000000000002',
   'd7c00000-0000-0000-0000-000000000008', 'partner', true,  'Alfa Sponsor Szkicu'),
  ('d7a11111-1111-1111-1111-111111111111', 'd7f00000-0000-0000-0000-000000000003',
   'd7c00000-0000-0000-0000-000000000009', 'partner', true,  'Alfa Sponsor Odwolany');

-- ── 1) Gość na hoście A ─────────────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"a.mention-fp.example"}', true);

SELECT is(
  (SELECT array_agg(t.id ORDER BY t.id)
     FROM public.search_mention_targets('alfa', 20) t
    WHERE t.kind = 'organization'),
  ARRAY['d7c00000-0000-0000-0000-000000000002', 'd7c00000-0000-0000-0000-000000000006']::uuid[],
  'anon: fraza dotykająca całej kartoteki oddaje WYŁĄCZNIE firmy z publicznym śladem (wpis + sponsor)'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.search_mention_targets('aa', 20) t
    WHERE t.kind = 'organization'
      AND t.id = 'd7c00000-0000-0000-0000-000000000001'),
  0,
  'anon: dwie litery nie wyliczają leada (przed naprawą: wiersz firmy prospekta)'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_mention_targets('%%', 20)),
  0,
  'anon: `%%` nie jest wzorcem - zero wyników (przed naprawą: 20 firm na wywołanie)'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_mention_targets('__', 20)),
  0,
  'anon: `__` nie jest wzorcem - zero wyników'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.search_mention_targets('Alfa Lead Prospekt', 20) t
    WHERE t.id = 'd7c00000-0000-0000-0000-000000000001'),
  0,
  'anon: nawet dokładna nazwa leada nie zwraca jego UUID'
);

SELECT is(
  (SELECT array_agg(t.id)
     FROM public.search_mention_targets('0%', 20) t
    WHERE t.kind = 'organization'),
  ARRAY['d7c00000-0000-0000-0000-00000000000b']::uuid[],
  'anon: `%` w frazie trafia dosłownie w nazwę publicznej firmy („Procent 100%")'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.search_mention_targets('alfa', 20) t
    WHERE t.id IN ('d7c00000-0000-0000-0000-000000000003',
                   'd7c00000-0000-0000-0000-000000000004',
                   'd7c00000-0000-0000-0000-000000000005',
                   'd7c00000-0000-0000-0000-000000000007',
                   'd7c00000-0000-0000-0000-000000000008',
                   'd7c00000-0000-0000-0000-000000000009')),
  0,
  'anon: wpis roboczy/usunięty/zaplanowany i sponsor ukryty/szkicu/odwołanego wydarzenia to nie ślad'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_mention_targets('a', 20) t WHERE t.kind = 'organization'),
  0,
  'anon: fraza jednoznakowa nie szuka firm'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.get_mention_target('org-d7c00000-0000-0000-0000-000000000001')),
  0,
  'anon: UUID leada nie otwiera karty firmy (strona /organization/org-<uuid> -> 404)'
);

SELECT is(
  (SELECT label FROM public.get_mention_target('org-d7c00000-0000-0000-0000-000000000002')),
  'Alfa Media Partner',
  'anon: firma przypisana do opublikowanego wpisu rozwiązuje się po UUID'
);

SELECT is(
  (SELECT website FROM public.get_mention_target('ORG-D7C00000-0000-0000-0000-000000000006')),
  'https://sponsor.example',
  'anon: opublikowany sponsor opublikowanego wydarzenia rozwiązuje się (slug bez względu na wielkość liter)'
);

SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY[
       'org-d7c00000-0000-0000-0000-000000000003',
       'org-d7c00000-0000-0000-0000-000000000004',
       'org-d7c00000-0000-0000-0000-000000000005',
       'org-d7c00000-0000-0000-0000-000000000007',
       'org-d7c00000-0000-0000-0000-000000000008',
       'org-d7c00000-0000-0000-0000-000000000009',
       'org-d7c00000-0000-0000-0000-00000000000a',
       'org-d7c00000-0000-0000-0000-0000000000b2']) AS s(slug)
     CROSS JOIN LATERAL public.get_mention_target(s.slug) t),
  0,
  'anon: odczyt punktowy stosuje tę samą bramkę (brak śladu, atrybucja z innego najemcy, firma obcego najemcy)'
);

SELECT is(
  (SELECT array_agg(t.slug)
     FROM public.search_mention_targets('anna', 20) t
    WHERE t.kind = 'person'),
  ARRAY['anna-autorka-fp'],
  'anon: ścieżka osób po przepisaniu nadal znajduje autorkę z opublikowanym wpisem'
);

SELECT is(
  (SELECT array_agg(t.slug)
     FROM public.search_mention_targets(NULL, 20) t),
  ARRAY['anna-autorka-fp'],
  'anon: pusta fraza oddaje osoby z dorobkiem, bez firm i bez kont bez publikacji'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_mention_targets('alfa', 1)),
  1,
  'anon: limit jest respektowany'
);

-- ── 2) Gość ze sfałszowanym nagłówkiem najemcy B ────────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"b.mention-fp.example"}', true);

SELECT is(
  (SELECT array_agg(t.id)
     FROM public.search_mention_targets('alfa', 20) t
    WHERE t.kind = 'organization'),
  ARRAY['d7c00000-0000-0000-0000-0000000000b2']::uuid[],
  'anon + x-tenant-host=B: tylko publiczna firma B - bez leada B, bez firm A, bez atrybucji krzyżowej'
);

-- ── 3) Zwykły członek A (rola user), nagłówek dalej wskazuje B ──────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d7000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(t.id ORDER BY t.id)
     FROM public.search_mention_targets('alfa', 20) t
    WHERE t.kind = 'organization'),
  ARRAY['d7c00000-0000-0000-0000-000000000002', 'd7c00000-0000-0000-0000-000000000006']::uuid[],
  'członek bez roli: najemca domowy wygrywa z nagłówkiem, a wynik to wyłącznie firmy z publicznym śladem'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.get_mention_target('org-d7c00000-0000-0000-0000-000000000001')),
  0,
  'członek bez roli: UUID leada nie otwiera karty'
);

-- ── 4) Redaktor A: ta sama reguła (żadnej gałęzi „staff widzi wszystko") ────
SELECT set_config('request.jwt.claims',
  '{"sub":"d7000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int
     FROM public.search_mention_targets('alfa lead', 20) t
    WHERE t.id = 'd7c00000-0000-0000-0000-000000000001'),
  0,
  'redaktor: lead nie staje się celem wzmianki - co da się wzmiankować, da się też rozwiązać u gościa'
);

RESET ROLE;

-- ── 5) Granty i kształt ─────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('anon', 'public.search_mention_targets(text, integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.search_mention_targets(text, integer)', 'EXECUTE'),
  'search_mention_targets: EXECUTE dla anon i authenticated zostaje (podpowiedzi osób dla gości)'
);

SELECT ok(
  has_function_privilege('anon', 'public.get_mention_target(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_mention_target(text)', 'EXECUTE'),
  'get_mention_target: EXECUTE dla anon i authenticated zostaje (dymek i strona organizacji)'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public._mention_public_company_ids(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._mention_public_company_ids(uuid)', 'EXECUTE'),
  '_mention_public_company_ids: brak EXECUTE dla anon i authenticated'
);

SELECT isnt_definer(
  'public', '_mention_public_company_ids', ARRAY['uuid'],
  '_mention_public_company_ids jest SECURITY INVOKER (czyta z prawami wołającej funkcji)'
);

SELECT is(
  (SELECT array_agg(f.company_id ORDER BY f.company_id)
     FROM public._mention_public_company_ids('d7a11111-1111-1111-1111-111111111111') f),
  ARRAY['d7c00000-0000-0000-0000-000000000002',
        'd7c00000-0000-0000-0000-000000000006',
        'd7c00000-0000-0000-0000-00000000000b']::uuid[],
  '_mention_public_company_ids(A): dokładnie wpisy opublikowane + opublikowani sponsorzy opublikowanych wydarzeń'
);

SELECT * FROM finish();
ROLLBACK;
