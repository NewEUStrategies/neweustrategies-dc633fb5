-- ============================================================================
-- FUNKCJE SECURITY DEFINER BEZ SCIEZKI KLIENTA: EXECUTE TYLKO DLA ROLI SERWISOWEJ.
--
-- PRZYCZYNA (klasa z 20261002140000, 20261007120500, 20261007140000). Domyslne
-- uprawnienia platformy nadaja EXECUTE na kazda nowa funkcje w `public` JAWNIE
-- rolom anon i authenticated; migracje zdejmowaly je tylko z PUBLIC albo wcale.
-- Kazda ponizsza funkcja jest SECURITY DEFINER (wykonuje sie jako wlasciciel,
-- omija RLS) i ma EXECUTE dla klienta, choc ZADNA sciezka klienta jej nie
-- potrzebuje.
--
-- JAK USTALONO „BRAK SCIEZKI KLIENTA" (inwentarz na w pelni zmigrowanej bazie,
-- katalog pg_proc, nie parser migracji):
--   1. brak wywolania z TypeScriptu: ani w faktach kontraktu TS <-> SQL, ani
--      jako jakikolwiek literal nazwy w src/** (takze formy z rzutowaniem
--      `rpc as unknown as`, ktorych ekstraktor nie widzi), supabase/functions
--      i scripts/;
--   2. brak odwolania z polityki RLS (wszystkie schematy), widoku, wartosci
--      domyslnej, CHECK ani z funkcji SECURITY INVOKER - tylko takie sciezki
--      wykonuja funkcje z uprawnieniami wolajacego. Wywolania z innych funkcji
--      SECURITY DEFINER, wyzwalaczy, pg_cron i hookow auth EXECUTE klienta nie
--      potrzebuja.
-- Z 42 sygnatur: 28 bez zadnej bramki w ciele, 13 wykonywalne nawet dla anon.
--
-- STRAZNIK KLASY: asercja 10 kontraktu TS <-> SQL (src/lib/ci/tsSqlContract.ts)
-- - kazda funkcja SECURITY DEFINER wykonywalna dla klienta musi miec sciezke
-- klienta albo wpis w przejrzanym rejestrze wyjatkow.
--
-- KOLEJNOSC WDROZENIA: dowolna (kod tych funkcji nie woluje).
-- POMIJA FUNKCJE, KTORYCH NIE MA (to_regprocedure IS NULL): harnessy modulow
-- (pg-harness, events-harness) stawiaja tylko swoj podzbior migracji, a dzieki
-- temu wykonuja reszte swoich asercji Z odebranymi uprawnieniami. Literowke
-- w sygnaturze lapie test pgTAP ponizej - pyta katalog o kazda sygnature.
--
-- IDEMPOTENTNA: bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/definer_client_exec_inventory_test.sql.
-- ============================================================================

-- Lista (sygnatura: kto mial EXECUTE, czy cialo ma bramke, skutek):
-- _are_connected(uuid,uuid): anon+authenticated, BEZ bramki - anon: wyrocznia grafu polaczen
-- _event_registration_verdict(uuid,uuid,jsonb): authenticated, BEZ bramki - offline brute-force odpowiedzi ankiety zgloszeniowej dowolnego wydarzenia
-- admin_club_poll_create(uuid,text,text,text,text,jsonb,timestamp with time zone,uuid): authenticated, bramka w ciele
-- admin_dashboard_tenant(): authenticated, bramka w ciele
-- admin_event_package_seat_assign(jsonb): authenticated, bramka w ciele
-- assert_event_staff_tenant(): authenticated, bramka w ciele
-- auto_connect_experts(): authenticated, BEZ bramki - kazdy zalogowany uruchamial O(n^2) zapis zaakceptowanych polaczen we WSZYSTKICH najemcach
-- can_share_full_article(): anon+authenticated, bramka w ciele
-- chat_accepts_new_thread(uuid,uuid): authenticated, BEZ bramki
-- chat_allow_messages_from(uuid): authenticated, BEZ bramki
-- club_anchor_label(text,text): anon+authenticated, BEZ bramki
-- club_linked_item_label(text,text): authenticated, BEZ bramki
-- club_require_curator(uuid): authenticated, bramka w ciele
-- crm_get_merydian_secrets(uuid): authenticated, bramka w ciele - sekrety integracji CRM - bramka w ciele, ale zadna sciezka klienta jej nie potrzebuje
-- crm_upsert_lead_from_subscriber(uuid): authenticated, BEZ bramki - kazdy zalogowany zakladal/scalal lead CRM z cudzego subskrybenta (zgoda marketingowa OR-owana)
-- get_my_qa_question_ids(uuid): authenticated, bramka w ciele
-- gift_share_eligibility(): anon+authenticated, BEZ bramki
-- guess_gender_from_name(text): authenticated, BEZ bramki
-- has_active_subscription(uuid,text): anon+authenticated, BEZ bramki - anon: wyrocznia platnej subskrypcji DOWOLNEGO uzytkownika
-- is_blocked_pair(uuid,uuid): authenticated, BEZ bramki
-- is_connected_pair(uuid,uuid): anon+authenticated, BEZ bramki - anon: wyrocznia grafu polaczen
-- is_conversation_member(uuid,uuid): authenticated, BEZ bramki
-- is_experiment_running(uuid): anon+authenticated, BEZ bramki
-- is_expert_user(uuid): authenticated, bramka w ciele
-- is_expert_user(uuid,uuid): authenticated, BEZ bramki
-- is_form_field_active(uuid,text,text): anon+authenticated, BEZ bramki
-- is_gated_recipient(uuid): authenticated, bramka w ciele
-- is_gated_recipient(uuid,uuid): authenticated, BEZ bramki
-- is_vip_user(uuid): authenticated, bramka w ciele - wyrocznia poziomu VIP/partner dowolnego konta
-- is_vip_user(uuid,uuid): authenticated, BEZ bramki - wyrocznia poziomu VIP/partner dowolnego konta
-- membership_year_window(uuid): authenticated, BEZ bramki
-- my_academic_domain_verification(): authenticated, bramka w ciele
-- my_effective_tier_features(): authenticated, bramka w ciele
-- my_has_feature(text): authenticated, BEZ bramki
-- nes_profile_completeness(uuid): authenticated, BEZ bramki
-- org_reconcile_seats(uuid): anon+authenticated, BEZ bramki - anon zawieszal miejsca zespolu dowolnej organizacji i czytal e-maile zaproszonych (dowod dynamiczny audytu)
-- post_canonical_href(uuid): anon+authenticated, BEZ bramki
-- profiles_tenant_pin_bypass(): authenticated, bramka w ciele
-- seed_related_posts_config(uuid): anon+authenticated, BEZ bramki - anon wstawial konfiguracje powiazanych tresci dla dowolnego najemcy
-- user_is_editorial(uuid): anon+authenticated, BEZ bramki - anon: wyrocznia roli redakcyjnej dowolnego konta
-- verification_domain_badges(uuid,text,boolean): anon+authenticated, BEZ bramki
-- verification_domain_tier(uuid,text,boolean): authenticated, BEZ bramki

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public._are_connected(uuid,uuid)',
    'public._event_registration_verdict(uuid,uuid,jsonb)',
    'public.admin_club_poll_create(uuid,text,text,text,text,jsonb,timestamp with time zone,uuid)',
    'public.admin_dashboard_tenant()',
    'public.admin_event_package_seat_assign(jsonb)',
    'public.assert_event_staff_tenant()',
    'public.auto_connect_experts()',
    'public.can_share_full_article()',
    'public.chat_accepts_new_thread(uuid,uuid)',
    'public.chat_allow_messages_from(uuid)',
    'public.club_anchor_label(text,text)',
    'public.club_linked_item_label(text,text)',
    'public.club_require_curator(uuid)',
    'public.crm_get_merydian_secrets(uuid)',
    'public.crm_upsert_lead_from_subscriber(uuid)',
    'public.get_my_qa_question_ids(uuid)',
    'public.gift_share_eligibility()',
    'public.guess_gender_from_name(text)',
    'public.has_active_subscription(uuid,text)',
    'public.is_blocked_pair(uuid,uuid)',
    'public.is_connected_pair(uuid,uuid)',
    'public.is_conversation_member(uuid,uuid)',
    'public.is_experiment_running(uuid)',
    'public.is_expert_user(uuid)',
    'public.is_expert_user(uuid,uuid)',
    'public.is_form_field_active(uuid,text,text)',
    'public.is_gated_recipient(uuid)',
    'public.is_gated_recipient(uuid,uuid)',
    'public.is_vip_user(uuid)',
    'public.is_vip_user(uuid,uuid)',
    'public.membership_year_window(uuid)',
    'public.my_academic_domain_verification()',
    'public.my_effective_tier_features()',
    'public.my_has_feature(text)',
    'public.nes_profile_completeness(uuid)',
    'public.org_reconcile_seats(uuid)',
    'public.post_canonical_href(uuid)',
    'public.profiles_tenant_pin_bypass()',
    'public.seed_related_posts_config(uuid)',
    'public.user_is_editorial(uuid)',
    'public.verification_domain_badges(uuid,text,boolean)',
    'public.verification_domain_tier(uuid,text,boolean)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
    END IF;
  END LOOP;
END $$;
