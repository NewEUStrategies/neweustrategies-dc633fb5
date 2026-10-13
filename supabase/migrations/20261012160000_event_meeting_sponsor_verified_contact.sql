-- events-harness: include
-- ============================================================================
-- WYDARZENIA: SPOTKANIE PRZYPINA SIE DO SPONSORA TYLKO PRZEZ OSOBE KONTAKTOWA
-- WSKAZANA PRZEZ ORGANIZATORA I POTWIERDZONE KONTO (OPS-10, poprawka F6).
--
-- PROBLEM. `_event_meeting_sponsor_allowed` (20261012120100) uznawala strone
-- spotkania za powiazana ze sponsorem na podstawie dwoch pol, ktore uczestnik
-- ustawia SAM, bez udzialu organizatora:
--   * `event_people.company_id = event_sponsors.company_id`. Firme osoby
--     zapisuje `event_my_event_profile_set` (20260828140004, grant dla
--     `authenticated`), sprawdzajac jedynie, ze firma istnieje w najemcy.
--     Identyfikator firmy sponsora odda kazdemu zalogowanemu
--     `crm_company_search` (20260828133656), a formularz profilu uczestnika
--     robi to sam (OrganizationPicker w MyEventProfileForm). `event_people`
--     jest per najemca, wiec jedna edycja profilu dziala na KAZDYM
--     wydarzeniu najemcy;
--   * most `event_person_crm_links` -> `event_sponsor_contacts.lead_id`.
--     Most przepina osobe na kontakt CRM PO E-MAILU OSOBY
--     (`_event_person_crm_sync`, 20260927001400: dopasowanie po
--     `crm_leads.email_norm`, upsert `ON CONFLICT (tenant_id, person_id)`),
--     a `event_people.email` uczestnik tez zmienia sam (ten sam
--     `event_my_event_profile_set`), bez potwierdzenia adresu. Wystarczy potem
--     dowolna akcja uczestnika wolajaca most (zgloszenie w naborze, odprawa).
-- Dwa zmowione konta uczestnikow bez zwiazku ze sponsorem: jedno wpisuje
-- sobie w profilu firme sponsora i zaprasza drugie z `sponsor_id` - przypiecie
-- zostaje, a po akceptacji rosna `meetings_total` i `meetings_accepted`
-- w `admin_event_sponsor_report_summary` i `event_sponsor_report_for_token`.
-- Dokladnie to naduzycie mial zamknac OPS-10. Przeglad koncowy (F6) pokazal
-- to sonda w harnessie; dwie niezalezne weryfikacje potwierdzily i obnizyly
-- wage z "high" do "medium" (skutek: integralnosc metryki raportu sponsora,
-- bez wycieku danych i bez eskalacji uprawnien; atak zostawia widoczny slad
-- - cudza firme na profilu). Ta migracja idzie za weryfikatorami.
--
-- ZMIANA. Powiazanie strony ze sponsorem opiera sie WYLACZNIE na danych,
-- ktore kontroluje organizator, dopasowanych przez tozsamosc, ktorej
-- uczestnik nie przepisze:
--   * KTO: lista osob kontaktowych przypiecia `event_sponsor_contacts`.
--     Zapisuja ja wylacznie `admin_event_sponsor_contacts_set` (bramka
--     `assert_editor_tenant`) i klon wydarzenia; tabela nie ma polityk zapisu,
--     a `authenticated` ma na niej tylko SELECT (i to w polityce stafowej).
--     Rola `onsite` to personel sponsora na miejscu - czyli "lista personelu
--     sponsora prowadzona przez organizatora" juz istnieje; nowa tabela,
--     RPC i ekran bylyby jej duplikatem;
--   * JAK: zgloszenie -> `event_people.user_id` -> `auth.users` z
--     POTWIERDZONYM adresem (`email_confirmed_at IS NOT NULL`) ->
--     `lower(btrim(auth.users.email)) = crm_leads.email_norm` kontaktu
--     wskazanego przez organizatora. Adres konta zmienia sie w GoTrue tylko
--     przez potwierdzenie nowej skrzynki (`enable_confirmations = true`);
--     `user_id` osoby wiaze sie zawsze z kontem WOLAJACEGO, wiec nikt nie
--     podepnie cudzego konta pod swoje zgloszenie. `event_people.email`
--     i most CRM przestaja miec znaczenie.
--
-- FIRMA OSOBY PRZESTAJE BYC DOWODEM W CALOSCI, takze gdy wpisal ja
-- organizator. `event_people` nie przechowuje, KTO ustawil `company_id`,
-- a uczestnik nadpisuje je tym samym polem - regula "firma, chyba ze wpisal
-- ja uczestnik" nie ma na czym stanac. Pozostale kandydatki tez odpadaja:
--   * `crm_leads.company_id` uzupelnia most Z `event_people.company_id`
--     (20260927001400: `company_id = COALESCE(l.company_id, v_person.company_id)`);
--   * `profiles.current_company_id` pisze uczestnik (`push_account`
--     w `event_my_event_profile_set`);
--   * `event_package_orders.company_id` opisuje nabywce pakietu biletow,
--     nie pracodawce kazdego posiadacza biletu z tego pakietu.
-- Wnioskowanie z domeny adresu (`crm_companies.domain`) byloby heurystyka
-- (agencje, skrzynki prywatne, wspolne domeny grup kapitalowych) - pomylka
-- w strone "nie wolno" kosztuje tylko przypisanie, wiec regula zostaje waska.
--
-- SKUTEK DLA ORGANIZATORA. Pracownik sponsora, ktorego spotkania z gieldy maja
-- liczyc sie sponsorowi, trafia na liste osob kontaktowych przypiecia
-- (np. rola `onsite`) z adresem, na ktory ma konto. Spotkania umowione przez
-- organizatora (`admin_event_meeting_arrange`) przypina on sam - bez zmian.
-- Zaden ekran uczestnika nie wysyla dzis `sponsor_id`
-- (`inviteToMeeting` w meetingsApi.ts ma pole, ale nikt go nie ustawia), wiec
-- interfejs uczestnika i tlumaczenia sie nie zmieniaja.
--
-- CZEGO NIE ZMIENIA:
--   * sygnatury i ACL helpera (CREATE OR REPLACE; REVOKE/GRANT powtorzone
--     dla idempotencji) - typy TS bez zmian;
--   * `event_meeting_invite` (20261012120100) - jedyny wolajacy; zmienia sie
--     tylko odpowiedz helpera, cialo zaproszenia zostaje;
--   * `admin_event_meeting_arrange` (organizator zaufany),
--     `event_meeting_reschedule` (kopiuje przypiecie z wiersza),
--     `event_meeting_respond` / `_cancel` (nie pisza `sponsor_id`);
--   * `_event_seat_assign_problem` (20260927000400) - ta sama regula firmy
--     dopuszcza osobe do miejsca zarezerwowanego dla sponsora, ale wola ja
--     tylko przydzial organizatora (`admin_event_seat_assign*`), ktory widzi
--     osobe; to nie jest sciezka uczestnika i nie nalezy do tej poprawki;
--   * DANYCH HISTORYCZNYCH: istniejacych przypiec nie zdejmujemy (raport juz
--     pokazany sponsorowi nie zmienia sie po cichu). Odczyt kontrolny
--     z naglowka 20261012120100 z nowym helperem wylapuje teraz TAKZE
--     spotkania przypiete po samodzielnie wpisanej firmie. Spotkania
--     organizatora (i ich przelozenia) odfiltrowuje `invited_by` rozny od
--     konta zapraszajacego uczestnika:
--       SELECT m.id, m.event_id, m.sponsor_id, m.created_at
--         FROM public.event_meetings m
--         JOIN public.event_registrations r
--           ON r.tenant_id = m.tenant_id AND r.id = m.requester_registration_id
--         JOIN public.event_people p
--           ON p.tenant_id = r.tenant_id AND p.id = r.person_id
--        WHERE m.sponsor_id IS NOT NULL
--          AND m.rescheduled_from_id IS NULL
--          AND m.invited_by IS NOT DISTINCT FROM p.user_id
--          AND NOT public._event_meeting_sponsor_allowed(m.tenant_id,
--                m.event_id, m.sponsor_id, m.requester_registration_id,
--                m.invitee_registration_id);
--
-- IDEMPOTENTNA: CREATE OR REPLACE oraz bezstanowe REVOKE/GRANT/COMMENT.
--
-- DOWOD: scripts/events-harness/runtime_test.d/61_meeting_sponsor_binding.sql
--   * sekcja 2: macierz helpera (osoba kontaktowa po potwierdzonym koncie po
--     obu stronach; firma osoby - takze wpisana przez organizatora - nie;
--     konto niepotwierdzone, osoba bez konta z adresem kontaktu, inny adres
--     konta, most CRM wskazujacy kontakt - nie; normalizacja adresu konta);
--   * sekcja 3: zaproszenia uczestnikow i licznik `event_meetings.sponsor_id`;
--   * sekcja 4 (F6): uczestnik ustawia sobie firme sponsora przez
--     `event_my_event_profile_set` i adres kontaktu przez ten sam RPC + most
--     CRM - zaproszenie z `sponsor_id` powstaje bez przypiecia, licznik
--     sponsora stoi; organizator dopisuje osobe do kontaktow przez
--     `admin_event_sponsor_contacts_set` - przypiecie przechodzi; uczestnik
--     nie ma drogi zapisu do `event_sponsor_contacts`.
-- Kontrola mutacji: bez tej migracji sekcje 2-4 pliku 61 czerwienia sie
-- (helper 20261012120100 przepuszcza firme i most CRM).
-- ============================================================================

CREATE OR REPLACE FUNCTION public._event_meeting_sponsor_allowed(
  p_tenant uuid,
  p_event_id uuid,
  p_sponsor_id uuid,
  p_requester_registration_id uuid,
  p_invitee_registration_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Strona spotkania jest powiazana ze sponsorem wtedy i tylko wtedy, gdy
  -- POTWIERDZONY adres jej konta jest adresem osoby kontaktowej, ktora
  -- organizator przypial do TEGO sponsora na TYM wydarzeniu. Pola osoby
  -- zapisywane przez uczestnika (firma, e-mail, most CRM) nie sa czytane.
  SELECT EXISTS (
    SELECT 1
      FROM public.event_sponsors s
      JOIN public.event_sponsor_contacts k
        ON k.tenant_id = s.tenant_id
       AND k.event_id = s.event_id
       AND k.sponsor_id = s.id
      JOIN public.crm_leads l
        ON l.tenant_id = k.tenant_id
       AND l.id = k.lead_id
      JOIN public.event_registrations r
        ON r.tenant_id = s.tenant_id
       AND r.event_id = s.event_id
       AND r.id IN (p_requester_registration_id, p_invitee_registration_id)
      JOIN public.event_people p
        ON p.tenant_id = r.tenant_id
       AND p.id = r.person_id
      JOIN auth.users u
        ON u.id = p.user_id
     WHERE s.tenant_id = p_tenant
       AND s.event_id = p_event_id
       AND s.id = p_sponsor_id
       AND u.email_confirmed_at IS NOT NULL
       AND l.email_norm = lower(btrim(u.email))
  );
$function$;

REVOKE ALL ON FUNCTION public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid) IS
  'Czy spotkanie dwoch zgloszen wolno przypiac do sponsora TEGO wydarzenia: ktorakolwiek strona ma konto z POTWIERDZONYM adresem (auth.users.email_confirmed_at) rownym adresowi osoby kontaktowej, ktora organizator przypial do tego sponsora (event_sponsor_contacts -> crm_leads.email_norm). Firma osoby, event_people.email i most CRM NIE sa dowodem - uczestnik ustawia je sam (F6, 20261012160000). Wola event_meeting_invite; organizator (admin_event_meeting_arrange) jest zaufany. Pomocnik wewnetrzny.';
