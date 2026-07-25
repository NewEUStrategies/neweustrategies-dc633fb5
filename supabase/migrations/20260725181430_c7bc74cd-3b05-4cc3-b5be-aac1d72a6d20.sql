
DO $$
DECLARE
  target_names text[] := ARRAY[
    'admin_clear_content_password','admin_community_stats','admin_get_user_consent',
    'admin_set_content_password','admin_soft_delete_message','admin_update_user_avatar',
    'auto_connect_experts','b2b_coupons_analytics','bulk_generate_coupons_for_campaign',
    'crm_backfill_all_leads','crm_upsert_lead_from_profile','crm_upsert_lead_from_subscriber',
    'endorse_skill','unendorse_skill','integration_endpoint_set_secret',
    'join_us_link_and_backfill','link_current_company',
    'mark_notifications_read','mark_notifications_unread',
    'monetization_dashboard','my_expert_request_quota','my_profile_viewers',
    'publish_due_pages','publish_due_posts',
    'recompute_crm_lead_score','recompute_crm_lead_scores',
    'redeem_b2b_coupon','redeem_b2b_coupon_with_effects',
    'request_introduction','respond_introduction','respond_recommendation',
    'send_expert_request','write_recommendation',
    'get_chat_peers','enqueue_notification','profile_view_stats'
  ];
  r record;
  sig text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname = ANY(target_names)
  LOOP
    sig := format('public.%I(%s)', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated', sig);
  END LOOP;
END $$;
