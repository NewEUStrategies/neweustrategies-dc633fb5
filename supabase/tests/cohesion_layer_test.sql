-- pgTAP: warstwa spójności między modułami (migracje 20260711200000-204000).
--
-- Weryfikuje kontrakty, których Vitest nigdy nie wykona:
--   1. Szyna zdarzeń: INSERT komentarza emituje comment.created.v1; RLS tnie
--      strumień per tenant (staff B nie widzi zdarzeń tenanta A).
--   2. Graf powiązań: komentarz dostaje krawędź belongs_to do posta, wzmianka
--      @slug krawędź mention do profilu + notyfikację odbiorcy.
--   3. Liczniki: user_pending_counters spójne ze źródłem po INSERT i po
--      oznaczeniu jako przeczytane; tenant_pending_counters liczy pending.
--   4. Workflowy: potwierdzenie subskrypcji newslettera tworzy lead CRM
--      (przepis newsletter-confirmed-to-crm), lead won notyfikuje staff.
--   5. Idempotencja: drugi claim tej samej komendy nie jest claimed.
--   6. Router integracji: pasujące zdarzenie ląduje w integration_deliveries.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(17);

-- ── Seed ───────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'coh-a', 'Cohesion A'),
  ('b2222222-2222-2222-2222-222222222222', 'coh-b', 'Cohesion B');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'coh-admin-a@a.test'),
  ('a2000000-0000-0000-0000-0000000000a2', 'coh-user-a2@a.test'),
  ('b0000000-0000-0000-0000-0000000000bb', 'coh-admin-b@b.test');

INSERT INTO public.profiles (id, email, display_name, slug, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'coh-admin-a@a.test', 'Admin A', 'coh-admin-a',
   'a1111111-1111-1111-1111-111111111111'),
  ('a2000000-0000-0000-0000-0000000000a2', 'coh-user-a2@a.test', 'User A2', 'coh-user-a2',
   'a1111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-0000000000bb', 'coh-admin-b@b.test', 'Admin B', 'coh-admin-b',
   'b2222222-2222-2222-2222-222222222222');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'admin', 'a1111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-0000000000bb', 'admin', 'b2222222-2222-2222-2222-222222222222');

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a1111111-1111-1111-1111-111111111111', 'coh-home');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'coh-post', 'a0000000-0000-0000-0000-0000000000aa',
   'published', 'a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000000a',
   'Post spójności');

-- comments_before_insert wymaga włączonej dyskusji per tenant; site_settings
-- ma PK po samym key (wiersz 'discussion' seedu wskazuje default tenant),
-- więc na czas testu (transakcja + ROLLBACK) przepinamy go na tenant A.
INSERT INTO public.site_settings (tenant_id, key, value) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'discussion', '{"allow_comments": true}'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET tenant_id = EXCLUDED.tenant_id, value = EXCLUDED.value;

-- ── 1+2. Komentarz: zdarzenie + graf + wzmianka ─────────────────────────────
INSERT INTO public.comments (id, tenant_id, post_id, user_id, body, status) VALUES
  ('c0000000-0000-0000-0000-0000000000c1', 'a1111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000aa',
   'Świetny tekst, @coh-user-a2 zerknij proszę', 'pending');

SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE aggregate_type = 'comment'
      AND aggregate_id = 'c0000000-0000-0000-0000-0000000000c1'
      AND event_type = 'comment.created.v1'),
  1,
  'INSERT komentarza emituje comment.created.v1 na szynie'
);

SELECT is(
  (SELECT count(*)::int FROM public.cross_references
    WHERE source_type = 'comment'
      AND source_id = 'c0000000-0000-0000-0000-0000000000c1'
      AND target_type = 'post'
      AND target_id = '00000000-0000-0000-0000-0000000000a1'
      AND relation = 'belongs_to'),
  1,
  'komentarz dostaje krawędź belongs_to do posta w grafie powiązań'
);

SELECT is(
  (SELECT count(*)::int FROM public.cross_references
    WHERE source_type = 'comment'
      AND source_id = 'c0000000-0000-0000-0000-0000000000c1'
      AND target_type = 'profile'
      AND target_id = 'a2000000-0000-0000-0000-0000000000a2'
      AND relation = 'mention'),
  1,
  'wzmianka @slug tworzy krawędź mention do profilu'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000a2'
      AND icon = 'at-sign'),
  1,
  'wzmianka notyfikuje wspomnianego użytkownika (enqueue_notification)'
);

SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE event_type = 'mention.created.v1'
      AND aggregate_id = 'c0000000-0000-0000-0000-0000000000c1'),
  1,
  'wzmianka emituje mention.created.v1'
);

-- ── 3. Liczniki: spójność ze źródłem ────────────────────────────────────────
SELECT is(
  (SELECT value FROM public.user_pending_counters
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000a2'
      AND counter_key = 'notifications_unread'),
  (SELECT count(*)::int FROM public.notifications
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000a2' AND read_at IS NULL),
  'notifications_unread = liczba nieprzeczytanych ze źródła (trigger INSERT)'
);

UPDATE public.notifications SET read_at = now()
 WHERE user_id = 'a2000000-0000-0000-0000-0000000000a2' AND read_at IS NULL;

SELECT is(
  (SELECT value FROM public.user_pending_counters
    WHERE user_id = 'a2000000-0000-0000-0000-0000000000a2'
      AND counter_key = 'notifications_unread'),
  0,
  'oznaczenie jako przeczytane zeruje licznik (trigger UPDATE)'
);

SELECT is(
  (SELECT value FROM public.tenant_pending_counters
    WHERE tenant_id = 'a1111111-1111-1111-1111-111111111111'
      AND counter_key = 'comments_pending'),
  (SELECT count(*)::int FROM public.comments
    WHERE tenant_id = 'a1111111-1111-1111-1111-111111111111' AND status = 'pending'),
  'comments_pending = liczba komentarzy pending w tenancie'
);

-- ── 4. Workflow: newsletter confirmed -> lead CRM ───────────────────────────
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, first_name, status) VALUES
  ('d0000000-0000-0000-0000-0000000000d1', 'a1111111-1111-1111-1111-111111111111',
   'coh-sub@a.test', 'Subka', 'pending');

UPDATE public.newsletter_subscribers
   SET confirmed_at = now(), status = 'subscribed'
 WHERE id = 'd0000000-0000-0000-0000-0000000000d1';

SELECT is(
  (SELECT count(*)::int FROM public.crm_leads
    WHERE tenant_id = 'a1111111-1111-1111-1111-111111111111'
      AND email_norm = 'coh-sub@a.test'),
  1,
  'workflow newsletter-confirmed-to-crm tworzy lead CRM po potwierdzeniu'
);

SELECT is(
  (SELECT count(*)::int FROM public.workflow_runs r
    JOIN public.workflow_definitions d ON d.id = r.workflow_id
    WHERE d.template_key = 'newsletter-confirmed-to-crm'
      AND r.tenant_id = 'a1111111-1111-1111-1111-111111111111'
      AND r.status = 'succeeded'),
  1,
  'przebieg workflow zapisany w workflow_runs ze statusem succeeded'
);

-- ── 4b. Workflow: lead won -> notyfikacja staffu ────────────────────────────
UPDATE public.crm_leads SET stage = 'won'
 WHERE tenant_id = 'a1111111-1111-1111-1111-111111111111'
   AND email_norm = 'coh-sub@a.test';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE user_id = 'a0000000-0000-0000-0000-0000000000aa'
      AND title_pl = 'Lead wygrany w CRM'),
  1,
  'workflow crm-lead-won-notify-staff notyfikuje admina tenanta'
);

-- ── 6. Router integracji ────────────────────────────────────────────────────
INSERT INTO public.integration_endpoints (id, tenant_id, name, url, event_types) VALUES
  ('e0000000-0000-0000-0000-0000000000e1', 'a1111111-1111-1111-1111-111111111111',
   'Test webhook', 'https://example.com/hook', ARRAY['comment.created.v1']);

INSERT INTO public.comments (id, tenant_id, post_id, user_id, body, status) VALUES
  ('c0000000-0000-0000-0000-0000000000c2', 'a1111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000aa',
   'Drugi komentarz (router integracji)', 'approved');

SELECT is(
  (SELECT count(*)::int FROM public.integration_deliveries
    WHERE endpoint_id = 'e0000000-0000-0000-0000-0000000000e1'
      AND event_type = 'comment.created.v1'
      AND status = 'queued'),
  1,
  'zdarzenie pasujące do filtra endpointu ląduje w integration_deliveries'
);

SELECT is(
  (SELECT count(*)::int FROM public.integration_deliveries
    WHERE endpoint_id = 'e0000000-0000-0000-0000-0000000000e1'
      AND event_type <> 'comment.created.v1'),
  0,
  'zdarzenia spoza filtra event_types nie są kolejkowane'
);

-- ── 1b. RLS szyny + 5. idempotencja (jako zalogowani użytkownicy) ───────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE tenant_id = 'a1111111-1111-1111-1111-111111111111'),
  0,
  'staff tenanta B nie czyta zdarzeń tenanta A (RLS na szynie)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT ok(
  (SELECT count(*) FROM public.domain_events
    WHERE tenant_id = 'a1111111-1111-1111-1111-111111111111') > 0,
  'staff tenanta A czyta zdarzenia swojego tenanta'
);

SELECT is(
  (SELECT (public.claim_command('coh-test-key-123', 'test.command')) ->> 'claimed'),
  'true',
  'pierwszy claim komendy wygrywa (claimed=true)'
);

SELECT is(
  (SELECT (public.claim_command('coh-test-key-123', 'test.command')) ->> 'claimed'),
  'false',
  'drugi claim tej samej komendy jest odrzucony (idempotencja)'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
