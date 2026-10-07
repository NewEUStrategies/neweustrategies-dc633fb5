-- pgTAP: funkcje SECURITY DEFINER bez sciezki klienta nie sa wykonywalne dla
-- anon ani authenticated (migracja 20261007140100_definer_functions_without_client_path).
-- Kazda pozycja ma tez kontrole dodatnia: service_role zachowuje EXECUTE, wiec
-- wolajacy serwerowi i funkcje SECURITY DEFINER dzialaja dalej.
BEGIN;
SELECT plan(84);
SELECT ok(NOT has_function_privilege('anon', 'public._are_connected(uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public._are_connected(uuid,uuid)', 'EXECUTE'),
  '_are_connected(uuid,uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public._are_connected(uuid,uuid)', 'EXECUTE'),
  '_are_connected(uuid,uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public._event_registration_verdict(uuid,uuid,jsonb)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public._event_registration_verdict(uuid,uuid,jsonb)', 'EXECUTE'),
  '_event_registration_verdict(uuid,uuid,jsonb): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public._event_registration_verdict(uuid,uuid,jsonb)', 'EXECUTE'),
  '_event_registration_verdict(uuid,uuid,jsonb): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_club_poll_create(uuid,text,text,text,text,jsonb,timestamp with time zone,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.admin_club_poll_create(uuid,text,text,text,text,jsonb,timestamp with time zone,uuid)', 'EXECUTE'),
  'admin_club_poll_create(uuid,text,text,text,text,jsonb,timestamp with time zone,uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.admin_club_poll_create(uuid,text,text,text,text,jsonb,timestamp with time zone,uuid)', 'EXECUTE'),
  'admin_club_poll_create(uuid,text,text,text,text,jsonb,timestamp with time zone,uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_dashboard_tenant()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.admin_dashboard_tenant()', 'EXECUTE'),
  'admin_dashboard_tenant(): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.admin_dashboard_tenant()', 'EXECUTE'),
  'admin_dashboard_tenant(): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_event_package_seat_assign(jsonb)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.admin_event_package_seat_assign(jsonb)', 'EXECUTE'),
  'admin_event_package_seat_assign(jsonb): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.admin_event_package_seat_assign(jsonb)', 'EXECUTE'),
  'admin_event_package_seat_assign(jsonb): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.assert_event_staff_tenant()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.assert_event_staff_tenant()', 'EXECUTE'),
  'assert_event_staff_tenant(): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.assert_event_staff_tenant()', 'EXECUTE'),
  'assert_event_staff_tenant(): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.auto_connect_experts()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.auto_connect_experts()', 'EXECUTE'),
  'auto_connect_experts(): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.auto_connect_experts()', 'EXECUTE'),
  'auto_connect_experts(): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.can_share_full_article()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.can_share_full_article()', 'EXECUTE'),
  'can_share_full_article(): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.can_share_full_article()', 'EXECUTE'),
  'can_share_full_article(): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.chat_accepts_new_thread(uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.chat_accepts_new_thread(uuid,uuid)', 'EXECUTE'),
  'chat_accepts_new_thread(uuid,uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.chat_accepts_new_thread(uuid,uuid)', 'EXECUTE'),
  'chat_accepts_new_thread(uuid,uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.chat_allow_messages_from(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.chat_allow_messages_from(uuid)', 'EXECUTE'),
  'chat_allow_messages_from(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.chat_allow_messages_from(uuid)', 'EXECUTE'),
  'chat_allow_messages_from(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.club_anchor_label(text,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.club_anchor_label(text,text)', 'EXECUTE'),
  'club_anchor_label(text,text): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.club_anchor_label(text,text)', 'EXECUTE'),
  'club_anchor_label(text,text): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.club_linked_item_label(text,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.club_linked_item_label(text,text)', 'EXECUTE'),
  'club_linked_item_label(text,text): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.club_linked_item_label(text,text)', 'EXECUTE'),
  'club_linked_item_label(text,text): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.club_require_curator(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.club_require_curator(uuid)', 'EXECUTE'),
  'club_require_curator(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.club_require_curator(uuid)', 'EXECUTE'),
  'club_require_curator(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.crm_get_merydian_secrets(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.crm_get_merydian_secrets(uuid)', 'EXECUTE'),
  'crm_get_merydian_secrets(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.crm_get_merydian_secrets(uuid)', 'EXECUTE'),
  'crm_get_merydian_secrets(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.crm_upsert_lead_from_subscriber(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.crm_upsert_lead_from_subscriber(uuid)', 'EXECUTE'),
  'crm_upsert_lead_from_subscriber(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.crm_upsert_lead_from_subscriber(uuid)', 'EXECUTE'),
  'crm_upsert_lead_from_subscriber(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.get_my_qa_question_ids(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.get_my_qa_question_ids(uuid)', 'EXECUTE'),
  'get_my_qa_question_ids(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.get_my_qa_question_ids(uuid)', 'EXECUTE'),
  'get_my_qa_question_ids(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.gift_share_eligibility()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.gift_share_eligibility()', 'EXECUTE'),
  'gift_share_eligibility(): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.gift_share_eligibility()', 'EXECUTE'),
  'gift_share_eligibility(): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.guess_gender_from_name(text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.guess_gender_from_name(text)', 'EXECUTE'),
  'guess_gender_from_name(text): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.guess_gender_from_name(text)', 'EXECUTE'),
  'guess_gender_from_name(text): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.has_active_subscription(uuid,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.has_active_subscription(uuid,text)', 'EXECUTE'),
  'has_active_subscription(uuid,text): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.has_active_subscription(uuid,text)', 'EXECUTE'),
  'has_active_subscription(uuid,text): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_blocked_pair(uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_blocked_pair(uuid,uuid)', 'EXECUTE'),
  'is_blocked_pair(uuid,uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_blocked_pair(uuid,uuid)', 'EXECUTE'),
  'is_blocked_pair(uuid,uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_connected_pair(uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_connected_pair(uuid,uuid)', 'EXECUTE'),
  'is_connected_pair(uuid,uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_connected_pair(uuid,uuid)', 'EXECUTE'),
  'is_connected_pair(uuid,uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_conversation_member(uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_conversation_member(uuid,uuid)', 'EXECUTE'),
  'is_conversation_member(uuid,uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_conversation_member(uuid,uuid)', 'EXECUTE'),
  'is_conversation_member(uuid,uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_experiment_running(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_experiment_running(uuid)', 'EXECUTE'),
  'is_experiment_running(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_experiment_running(uuid)', 'EXECUTE'),
  'is_experiment_running(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_expert_user(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_expert_user(uuid)', 'EXECUTE'),
  'is_expert_user(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_expert_user(uuid)', 'EXECUTE'),
  'is_expert_user(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_expert_user(uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_expert_user(uuid,uuid)', 'EXECUTE'),
  'is_expert_user(uuid,uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_expert_user(uuid,uuid)', 'EXECUTE'),
  'is_expert_user(uuid,uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_form_field_active(uuid,text,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_form_field_active(uuid,text,text)', 'EXECUTE'),
  'is_form_field_active(uuid,text,text): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_form_field_active(uuid,text,text)', 'EXECUTE'),
  'is_form_field_active(uuid,text,text): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_gated_recipient(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_gated_recipient(uuid)', 'EXECUTE'),
  'is_gated_recipient(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_gated_recipient(uuid)', 'EXECUTE'),
  'is_gated_recipient(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_gated_recipient(uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_gated_recipient(uuid,uuid)', 'EXECUTE'),
  'is_gated_recipient(uuid,uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_gated_recipient(uuid,uuid)', 'EXECUTE'),
  'is_gated_recipient(uuid,uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_vip_user(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_vip_user(uuid)', 'EXECUTE'),
  'is_vip_user(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_vip_user(uuid)', 'EXECUTE'),
  'is_vip_user(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.is_vip_user(uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.is_vip_user(uuid,uuid)', 'EXECUTE'),
  'is_vip_user(uuid,uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.is_vip_user(uuid,uuid)', 'EXECUTE'),
  'is_vip_user(uuid,uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.membership_year_window(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.membership_year_window(uuid)', 'EXECUTE'),
  'membership_year_window(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.membership_year_window(uuid)', 'EXECUTE'),
  'membership_year_window(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.my_academic_domain_verification()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.my_academic_domain_verification()', 'EXECUTE'),
  'my_academic_domain_verification(): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.my_academic_domain_verification()', 'EXECUTE'),
  'my_academic_domain_verification(): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.my_effective_tier_features()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.my_effective_tier_features()', 'EXECUTE'),
  'my_effective_tier_features(): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.my_effective_tier_features()', 'EXECUTE'),
  'my_effective_tier_features(): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.my_has_feature(text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.my_has_feature(text)', 'EXECUTE'),
  'my_has_feature(text): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.my_has_feature(text)', 'EXECUTE'),
  'my_has_feature(text): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.nes_profile_completeness(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.nes_profile_completeness(uuid)', 'EXECUTE'),
  'nes_profile_completeness(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.nes_profile_completeness(uuid)', 'EXECUTE'),
  'nes_profile_completeness(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.org_reconcile_seats(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.org_reconcile_seats(uuid)', 'EXECUTE'),
  'org_reconcile_seats(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.org_reconcile_seats(uuid)', 'EXECUTE'),
  'org_reconcile_seats(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.post_canonical_href(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.post_canonical_href(uuid)', 'EXECUTE'),
  'post_canonical_href(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.post_canonical_href(uuid)', 'EXECUTE'),
  'post_canonical_href(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.profiles_tenant_pin_bypass()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.profiles_tenant_pin_bypass()', 'EXECUTE'),
  'profiles_tenant_pin_bypass(): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.profiles_tenant_pin_bypass()', 'EXECUTE'),
  'profiles_tenant_pin_bypass(): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.seed_related_posts_config(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.seed_related_posts_config(uuid)', 'EXECUTE'),
  'seed_related_posts_config(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.seed_related_posts_config(uuid)', 'EXECUTE'),
  'seed_related_posts_config(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.user_is_editorial(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.user_is_editorial(uuid)', 'EXECUTE'),
  'user_is_editorial(uuid): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.user_is_editorial(uuid)', 'EXECUTE'),
  'user_is_editorial(uuid): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.verification_domain_badges(uuid,text,boolean)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.verification_domain_badges(uuid,text,boolean)', 'EXECUTE'),
  'verification_domain_badges(uuid,text,boolean): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.verification_domain_badges(uuid,text,boolean)', 'EXECUTE'),
  'verification_domain_badges(uuid,text,boolean): service_role zachowuje EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.verification_domain_tier(uuid,text,boolean)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.verification_domain_tier(uuid,text,boolean)', 'EXECUTE'),
  'verification_domain_tier(uuid,text,boolean): bez EXECUTE dla anon i authenticated');
SELECT ok(has_function_privilege('service_role', 'public.verification_domain_tier(uuid,text,boolean)', 'EXECUTE'),
  'verification_domain_tier(uuid,text,boolean): service_role zachowuje EXECUTE');
SELECT * FROM finish();
ROLLBACK;
