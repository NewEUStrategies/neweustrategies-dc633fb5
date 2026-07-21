-- pgTAP: CRM follow-upy/zadania + import CSV (20260721120000).
--
--   1. Trigger sync: crm_leads.follow_up_at = MIN(due_at) otwartych zadań.
--   2. Skaner run_crm_task_reminders: notyfikacja kind 'crm_task' + watermark
--      (raz per termin), reset watermarku przy przesunięciu terminu.
--   3. crm_import_leads: dedup po e-mailu (merge, nie duplikat), unia tagów,
--      raport imported/merged/skipped, guard is_staff.
--   4. RLS: izolacja tenantów na crm_tasks.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Dane bazowe: dwa tenanty, staff, zwykły user, lead ───────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('dd111111-1111-1111-1111-111111111111', 'tenant-ft-a', 'Tenant FT A'),
  ('dd222222-2222-2222-2222-222222222222', 'tenant-ft-b', 'Tenant FT B');

INSERT INTO auth.users (id, email) VALUES
  ('dd000000-0000-0000-0000-0000000000aa', 'admin-a@ft.test'),
  ('dd000000-0000-0000-0000-0000000000bb', 'admin-b@ft.test'),
  ('dd000000-0000-0000-0000-0000000000cc', 'plain-user@ft.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('dd000000-0000-0000-0000-0000000000aa', 'admin-a@ft.test', 'Admin A',
   'dd111111-1111-1111-1111-111111111111'),
  ('dd000000-0000-0000-0000-0000000000bb', 'admin-b@ft.test', 'Admin B',
   'dd222222-2222-2222-2222-222222222222'),
  ('dd000000-0000-0000-0000-0000000000cc', 'plain-user@ft.test', 'Plain User',
   'dd111111-1111-1111-1111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('dd000000-0000-0000-0000-0000000000aa', 'admin', 'dd111111-1111-1111-1111-111111111111'),
  ('dd000000-0000-0000-0000-0000000000bb', 'admin', 'dd222222-2222-2222-2222-222222222222');

INSERT INTO public.crm_leads (id, tenant_id, email_norm, email, first_name, tags)
VALUES ('dd333333-3333-3333-3333-333333333333', 'dd111111-1111-1111-1111-111111111111',
        'lead-ft@ft.test', 'lead-ft@ft.test', 'Lead', ARRAY['vip']);

-- ── 1. Sync follow_up_at na leadzie ─────────────────────────────────────────
INSERT INTO public.crm_tasks (id, tenant_id, lead_id, title, due_at, assignee_id)
VALUES ('dd444444-4444-4444-4444-444444444444', 'dd111111-1111-1111-1111-111111111111',
        'dd333333-3333-3333-3333-333333333333', 'Wyslac oferte',
        now() + interval '2 days', 'dd000000-0000-0000-0000-0000000000aa');

SELECT is(
  (SELECT follow_up_at FROM public.crm_leads WHERE id = 'dd333333-3333-3333-3333-333333333333'),
  (SELECT due_at FROM public.crm_tasks WHERE id = 'dd444444-4444-4444-4444-444444444444'),
  'first open task sets crm_leads.follow_up_at'
);

-- Wcześniejsze (zaległe) zadanie przejmuje follow_up_at (MIN due otwartych).
INSERT INTO public.crm_tasks (id, tenant_id, lead_id, title, due_at, assignee_id)
VALUES ('dd555555-5555-5555-5555-555555555555', 'dd111111-1111-1111-1111-111111111111',
        'dd333333-3333-3333-3333-333333333333', 'Oddzwonic po webinarze',
        now() - interval '1 hour', 'dd000000-0000-0000-0000-0000000000aa');

SELECT is(
  (SELECT follow_up_at FROM public.crm_leads WHERE id = 'dd333333-3333-3333-3333-333333333333'),
  (SELECT due_at FROM public.crm_tasks WHERE id = 'dd555555-5555-5555-5555-555555555555'),
  'follow_up_at tracks the earliest OPEN task'
);

-- ── 2. Skaner przypomnień ────────────────────────────────────────────────────
SELECT is(
  public.run_crm_task_reminders(),
  1,
  'reminder scan picks exactly the one overdue task'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.user_id = 'dd000000-0000-0000-0000-0000000000aa'
       AND n.kind = 'crm_task'
       AND n.href LIKE '/admin/crm?lead=dd333333-%task=dd555555-%'
  ),
  'assignee got a crm_task notification deep-linking lead + task'
);

SELECT ok(
  (SELECT reminded_at IS NOT NULL FROM public.crm_tasks
    WHERE id = 'dd555555-5555-5555-5555-555555555555'),
  'watermark reminded_at is stamped after the scan'
);

SELECT is(
  public.run_crm_task_reminders(),
  0,
  'second scan does not re-remind the same task'
);

-- Przesunięcie terminu w przyszłość zeruje watermark (przypomnimy ponownie).
UPDATE public.crm_tasks
   SET due_at = now() + interval '1 day'
 WHERE id = 'dd555555-5555-5555-5555-555555555555';

SELECT ok(
  (SELECT reminded_at IS NULL FROM public.crm_tasks
    WHERE id = 'dd555555-5555-5555-5555-555555555555'),
  'postponing an open task clears the reminder watermark'
);

-- Wykonanie zadania przenosi follow_up_at na kolejne otwarte.
UPDATE public.crm_tasks SET status = 'done'
 WHERE id = 'dd555555-5555-5555-5555-555555555555';

SELECT is(
  (SELECT follow_up_at FROM public.crm_leads WHERE id = 'dd333333-3333-3333-3333-333333333333'),
  (SELECT due_at FROM public.crm_tasks WHERE id = 'dd444444-4444-4444-4444-444444444444'),
  'completing a task moves follow_up_at to the next open task'
);

SELECT ok(
  (SELECT completed_at IS NOT NULL FROM public.crm_tasks
    WHERE id = 'dd555555-5555-5555-5555-555555555555'),
  'completed_at is stamped when a task is done'
);

-- ── 3. Import CSV z dedupem (jako staff tenanta A) ──────────────────────────
CREATE TEMP TABLE import_result (r jsonb);
GRANT ALL ON import_result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"dd000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

INSERT INTO import_result
SELECT public.crm_import_leads(
  '[
     {"email": "lead-ft@ft.test", "company": "NES", "tags": ["imported"]},
     {"email": "nowy-ft@ft.test", "first_name": "Nowa", "last_name": "Osoba"},
     {"email": "zly-adres"}
   ]'::jsonb,
  'import'
);

RESET ROLE;

SELECT is(
  (SELECT (r->>'imported')::int FROM import_result), 1,
  'import creates exactly the one genuinely new lead'
);
SELECT is(
  (SELECT (r->>'merged')::int FROM import_result), 1,
  'import merges the duplicate e-mail into the existing lead'
);
SELECT is(
  (SELECT (r->>'skipped')::int FROM import_result), 1,
  'import skips the row without a valid e-mail'
);

SELECT ok(
  (SELECT tags @> ARRAY['vip','imported'] FROM public.crm_leads
    WHERE id = 'dd333333-3333-3333-3333-333333333333'),
  'import unions tags with the existing ones (no overwrite)'
);

-- ── 4. RLS: izolacja tenantów + guard importu ───────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"dd000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.crm_tasks
    WHERE tenant_id = 'dd111111-1111-1111-1111-111111111111'),
  0,
  'RLS: tenant B staff cannot read tenant A tasks'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"dd000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.crm_import_leads('[{"email":"x@y.z"}]'::jsonb) $$,
  '42501',
  NULL,
  'crm_import_leads denies a non-staff caller'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
