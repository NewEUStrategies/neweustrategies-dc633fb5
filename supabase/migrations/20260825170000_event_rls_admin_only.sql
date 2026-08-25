-- ============================================================================
-- WYDARZENIA: PLASZCZYZNA ADMINISTRACYJNA TYLKO DLA ADMINA - TAKZE W RLS.
--
-- CO BYLO ZROBIONE POLOWICZNIE. `20260824090000` przestawilo plaszczyzne RPC:
-- `assert_editor_tenant()` deleguje odtad do `assert_event_admin_tenant()`,
-- wiec 338 wywolan w cialach funkcji modulu przestalo wpuszczac redakcje.
-- Ale RLS to DRUGA, NIEZALEZNA plaszczyzna: klient Supabase czyta i zapisuje
-- tabele takze BEZ RPC, przez PostgREST. Polityki modulu nadal zawieraly
-- `has_role(uid, 'editor')`, wiec redaktor, ktoremu zamknieto drzwi RPC,
-- wchodzil oknem - 36 politykami, w tym 6 dajacymi PELNY zapis
-- (`FOR ALL`) na nadaniach uprawnien, zamowieniach pakietow, miejscach
-- w pakietach i sekcjach strony wydarzenia.
--
-- CO ROBI TA MIGRACJA. W kazdej z 36 polityk modulu czlon `OR has_role(uid,
-- 'editor')` znika, a na jego miejsce wchodzi `OR is_super_admin(uid)`.
-- Struktura warunku zostaje nietknieta - w szczegolnosci `is_super_admin`
-- siedzi WEWNATRZ sprawdzenia `tenant_id`, a nie obok niego: super admin
-- widzi wiersze SWOJEGO najemcy, nie cudzych. To swiadome zawezenie wobec
-- starszego wzorca z `crm_leads`, gdzie `OR is_super_admin()` stoi poza
-- warunkiem najemcy i przebija izolacje.
--
-- PRZY OKAZJI NAPRAWIONY DRUGI DEFEKT. `has_role(uid, 'admin')` to scisly
-- odczyt wiersza z `user_roles` - NIE obejmuje roli `super_admin`. Polityki
-- modulu wymienialy tylko `admin` i `editor`, wiec super admin nie mial
-- dostepu do wlasnych tabel wydarzen inaczej niz przez RPC. Dopisanie
-- `is_super_admin` przywraca inwariant `super_admin >= admin`, ktory reszta
-- repozytorium trzyma w 407 miejscach.
--
-- CZEGO TA MIGRACJA CELOWO NIE RUSZA (cztery polityki):
--   `events` (odczyt i zapis) - EKRAN LISTY wydarzen ma zostac dostepny dla
--     redakcji; to ta sama decyzja, ktora w `20260824090000` zostawila
--     `admin_events_list`, `_counts` i `_create` na `assert_event_staff_tenant()`.
--   `event_rsvps` - starsza plaszczyzna RSVP; nowy modul zapisow stoi na
--     `event_registrations`, ktore JEST tu zawezone.
--   `event_speakers` - tabela starszego modulu, czytana przez kreator stron
--     (`src/lib/builder/speakersQuery.ts`), hub ekspertow i panel spolecznosci.
--     Zawezenie jej uderzyloby w powierzchnie redakcyjne POZA Wydarzeniami.
--
-- KONTRAKT PILNUJE `supabase/tests/event_admin_only_contract_test.sql`:
-- kazda nastepna migracja, ktora wpisze `editor` z powrotem w polityke
-- modulu, oblewa bramke `pgtap` w tej samej minucie. Bez tego naprawa
-- zyje do najblizszego `CREATE POLICY` z automatu - dokladnie tak zginela
-- juz raz naprawa `search_path` w `a8_hardening`.
--
-- events-harness: include
--   Znacznik dla `scripts/events-harness/run.sh`. Ta migracja nie definiuje
--   zadnego `public.admin_event_*`, wiec selektor po tresci by jej nie zlapal,
--   a bez niej harness sprawdzalby polityki SPRZED zawezenia.
-- ============================================================================

DROP POLICY IF EXISTS "event_audience_grants_staff_all" ON public.event_audience_grants;
CREATE POLICY "event_audience_grants_staff_all" ON public.event_audience_grants
  FOR ALL TO authenticated
  USING (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  )
  WITH CHECK (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  );

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

DROP POLICY IF EXISTS "event_package_orders_staff_all" ON public.event_package_orders;
CREATE POLICY "event_package_orders_staff_all" ON public.event_package_orders
  FOR ALL TO authenticated
  USING (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  )
  WITH CHECK (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS "event_package_seats_staff_all" ON public.event_package_seats;
CREATE POLICY "event_package_seats_staff_all" ON public.event_package_seats
  FOR ALL TO authenticated
  USING (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  )
  WITH CHECK (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
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

DROP POLICY IF EXISTS "event_ticket_packages_staff_all" ON public.event_ticket_packages;
CREATE POLICY "event_ticket_packages_staff_all" ON public.event_ticket_packages
  FOR ALL TO authenticated
  USING (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
    )
  )
  WITH CHECK (
    tenant_id = public._caller_tenant()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_super_admin(auth.uid())
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

-- ----------------------------------------------------------------------------
-- DRUGA POLOWA TEJ SAMEJ USTERKI: `event_types` ZAMYKA SUPER ADMINA.
--
-- Te trzy polityki NIE wpuszczaly redakcji - byly juz administracyjne. Maja
-- jednak dokladnie ten drugi defekt: `has_role(uid,'admin')` czyta wiersz
-- z `user_roles` scisle, wiec super admin, ktory nie ma osobnego wiersza
-- `admin`, nie mogl zalozyc ani skasowac typu wydarzenia we WLASNYM najemcy.
-- Zawezenie z gory bez tego dopisku zostawiloby modul niespojny: 36 polityk
-- zna super admina, trzy nie.
--
-- Warunek `is_system = false` przy kasowaniu zostaje nietkniety - typy
-- systemowe nie znikaja nawet super adminowi.
-- ----------------------------------------------------------------------------
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
