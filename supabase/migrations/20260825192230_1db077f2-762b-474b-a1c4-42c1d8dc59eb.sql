-- ============================================================================
-- WYDARZENIA: PLASZCZYZNA ADMINISTRACYJNA TYLKO DLA ADMINA - TAKZE W RLS.
-- (migracja repozytorium 20260825170000_event_rls_admin_only.sql)
-- ============================================================================

DROP POLICY IF EXISTS "event_badge_prints_staff_read" ON public.event_badge_prints;
CREATE POLICY "event_badge_prints_staff_read"
  ON public.event_badge_prints FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_badge_templates_staff_read" ON public.event_badge_templates;
CREATE POLICY "event_badge_templates_staff_read"
  ON public.event_badge_templates FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_checkins_staff_read" ON public.event_checkins;
CREATE POLICY "event_checkins_staff_read"
  ON public.event_checkins FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_checkpoints_staff_read" ON public.event_checkpoints;
CREATE POLICY "event_checkpoints_staff_read"
  ON public.event_checkpoints FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_group_members_staff_read" ON public.event_group_members;
CREATE POLICY "event_group_members_staff_read"
  ON public.event_group_members FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_groups_staff_read" ON public.event_groups;
CREATE POLICY "event_groups_staff_read"
  ON public.event_groups FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_lead_scans_staff_read" ON public.event_lead_scans;
CREATE POLICY "event_lead_scans_staff_read"
  ON public.event_lead_scans FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_meeting_attendees_staff_read" ON public.event_meeting_attendees;
CREATE POLICY "event_meeting_attendees_staff_read"
  ON public.event_meeting_attendees FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_meeting_availability_staff_read" ON public.event_meeting_availability;
CREATE POLICY "event_meeting_availability_staff_read"
  ON public.event_meeting_availability FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_meeting_rule_groups_staff_read" ON public.event_meeting_rule_groups;
CREATE POLICY "event_meeting_rule_groups_staff_read"
  ON public.event_meeting_rule_groups FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_meeting_settings_staff_read" ON public.event_meeting_settings;
CREATE POLICY "event_meeting_settings_staff_read"
  ON public.event_meeting_settings FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_meeting_tables_staff_read" ON public.event_meeting_tables;
CREATE POLICY "event_meeting_tables_staff_read"
  ON public.event_meeting_tables FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_meetings_staff_read" ON public.event_meetings;
CREATE POLICY "event_meetings_staff_read"
  ON public.event_meetings FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_page_sections_staff_read" ON public.event_page_sections;
CREATE POLICY "event_page_sections_staff_read"
  ON public.event_page_sections FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_page_sections_staff_write" ON public.event_page_sections;
CREATE POLICY "event_page_sections_staff_write"
  ON public.event_page_sections FOR ALL
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_people_staff_read" ON public.event_people;
CREATE POLICY "event_people_staff_read"
  ON public.event_people FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_registration_fields_staff_read" ON public.event_registration_fields;
CREATE POLICY "event_registration_fields_staff_read"
  ON public.event_registration_fields FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_registrations_staff_read" ON public.event_registrations;
CREATE POLICY "event_registrations_staff_read"
  ON public.event_registrations FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_rooms_staff_read" ON public.event_rooms;
CREATE POLICY "event_rooms_staff_read"
  ON public.event_rooms FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_scanner_devices_staff_read" ON public.event_scanner_devices;
CREATE POLICY "event_scanner_devices_staff_read"
  ON public.event_scanner_devices FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_session_signups_staff_read" ON public.event_session_signups;
CREATE POLICY "event_session_signups_staff_read"
  ON public.event_session_signups FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_session_speakers_staff_read" ON public.event_session_speakers;
CREATE POLICY "event_session_speakers_staff_read"
  ON public.event_session_speakers FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_sessions_staff_read" ON public.event_sessions;
CREATE POLICY "event_sessions_staff_read"
  ON public.event_sessions FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_sponsor_contacts_staff_read" ON public.event_sponsor_contacts;
CREATE POLICY "event_sponsor_contacts_staff_read"
  ON public.event_sponsor_contacts FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_sponsor_materials_staff_read" ON public.event_sponsor_materials;
CREATE POLICY "event_sponsor_materials_staff_read"
  ON public.event_sponsor_materials FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_sponsor_tier_benefits_staff_read" ON public.event_sponsor_tier_benefits;
CREATE POLICY "event_sponsor_tier_benefits_staff_read"
  ON public.event_sponsor_tier_benefits FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_sponsor_tiers_staff_read" ON public.event_sponsor_tiers;
CREATE POLICY "event_sponsor_tiers_staff_read"
  ON public.event_sponsor_tiers FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_sponsors_staff_read" ON public.event_sponsors;
CREATE POLICY "event_sponsors_staff_read"
  ON public.event_sponsors FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_term_acceptances_staff_read" ON public.event_term_acceptances;
CREATE POLICY "event_term_acceptances_staff_read"
  ON public.event_term_acceptances FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_terms_staff_read" ON public.event_terms;
CREATE POLICY "event_terms_staff_read"
  ON public.event_terms FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_ticket_types_staff_read" ON public.event_ticket_types;
CREATE POLICY "event_ticket_types_staff_read"
  ON public.event_ticket_types FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_tracks_staff_read" ON public.event_tracks;
CREATE POLICY "event_tracks_staff_read"
  ON public.event_tracks FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

-- DRUGA POLOWA TEJ SAMEJ USTERKI: `event_types` ZAMYKA SUPER ADMINA.
DROP POLICY IF EXISTS "event_types_admin_insert" ON public.event_types;
CREATE POLICY "event_types_admin_insert"
  ON public.event_types FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
    AND tenant_id = public._caller_tenant()
  );

DROP POLICY IF EXISTS "event_types_admin_update" ON public.event_types;
CREATE POLICY "event_types_admin_update"
  ON public.event_types FOR UPDATE
  TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
    AND tenant_id = public._caller_tenant()
  )
  WITH CHECK (
    (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
    AND tenant_id = public._caller_tenant()
  );

DROP POLICY IF EXISTS "event_types_admin_delete" ON public.event_types;
CREATE POLICY "event_types_admin_delete"
  ON public.event_types FOR DELETE
  TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
    AND tenant_id = public._caller_tenant()
    AND is_system = false
  );