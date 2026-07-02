-- Editorial workflow, part 1/2: new post_status values.
--
-- Kept in its own migration because PostgreSQL forbids USING a freshly added
-- enum value inside the same transaction that created it. Part 2/2
-- (20260702090100_editorial_workflow.sql) wires the column, trigger and cron.
--
-- Workflow (docs/ARCHITECTURE.md §2.7):
--   draft -> pending_review -> published            (authors/editors submit)
--   draft ------------------> published | scheduled (admin / super_admin only)

ALTER TYPE public.post_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE public.post_status ADD VALUE IF NOT EXISTS 'scheduled';
