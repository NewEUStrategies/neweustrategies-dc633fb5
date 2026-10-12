INSERT INTO supabase_migrations.schema_migrations (version, statements, name, created_by)
SELECT v.version, ARRAY[]::text[], v.name, 'lovable'
FROM (VALUES
  ('20261011090000', '20261011090000_menu_items_follow_categories'),
  ('20261011090100', '20261011090100_event_seed_test_pages_noindex'),
  ('20261011090200', '20261011090200_unpublish_test_pages')
) AS v(version, name)
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations sm WHERE sm.version = v.version
);