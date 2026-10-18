INSERT INTO supabase_migrations.schema_migrations (version, statements, name, created_by)
SELECT v.version, ARRAY[]::text[], v.name, 'lovable'
FROM (VALUES
  ('20261018100000', '20261018100000_payment_webhook_events_follow_subscription_tenant'),
  ('20261018120000', '20261018120000_release_coupon_order_lock')
) AS v(version, name)
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations sm WHERE sm.version = v.version
);