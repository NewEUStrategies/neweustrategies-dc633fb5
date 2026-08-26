# Event Builder — dedykowany moduł wydarzeń w panelu administracyjnym

Data otwarcia: 2026-08-23 · Ostatnia aktualizacja: 2026-08-26
Status: **specyfikacja żywa — wdrożenie w toku (E1 i E3 częściowo, patrz §8 i §12)**
Wzorzec referencyjny: **Swapcard Studio** (`studio.swapcard.com/event/<slug>/…`)
Dziennik zrzutów ekranu: `docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md`
(sekcja „Stan wdrożenia — 2026-08-26" mapuje ekran po ekranie na ścieżki w repo)
Dziennik wdrożenia: **§12** tego dokumentu.

---

## 0. Najważniejsza decyzja architektoniczna — przeczytaj przed resztą

W Swapcardzie „wydarzenie" **nie jest wierszem w tabeli**. Jest osobnym mikro-produktem:
ma własne strony i menu, własne grupy uczestników z uprawnieniami, własny branding,
własny formularz rejestracji, własny regulamin, własne integracje i własną analitykę.
Lewy sidebar Swapcarda to nie nawigacja panelu — to **nawigacja jednego wydarzenia**
(nagłówek „Open event", przełącznik planu, „Preview event", „Publish event").

Na platformie NES wydarzenie jest dziś **jednym wierszem `public.events`** z RSVP,
biletem, prelegentami i nagraniem. To działa dla webinaru i briefingu, ale nie dla
kongresu dwudniowego z agendą, wystawcami, spotkaniami 1-1 i wejściówkami na miejscu.

Stąd dwie rzeczy, które trzeba nazwać wprost, zanim powstanie pierwszy plik:

### 0.1 Nie budujemy drugiego silnika stron

NES ma **jeden** silnik kompozycji stron (builder: sekcja → kolumna → widget,
`pages.builder_data`) i udokumentowany wzorzec microsite'u (`docs/MICROSITES.md`:
poddrzewo `pages.parent_id` + dziedziczony `header_override` + globalne widgety
nawigacji + `template_type = landing`). Swapcardowe „Pages & menu" **mapuje się na
ten mechanizm**, a nie na nowy CRUD stron per wydarzenie.

Konsekwencja: „strona wydarzenia" = **strona z `pages` przypięta do wydarzenia**,
a Event Builder daje nad nią wygodną powierzchnię (lista podstron wydarzenia, kolejność
w menu, widoczność per grupa) — nie własny edytor. Drugi silnik stron oznaczałby drugie
źródło prawdy dla SEO, breadcrumbów, harmonogramu publikacji i rewizji; tego nie robimy.

### 0.2 Agenda musi zejść z JSON-a do bazy

Dziś agenda żyje **w treści widgetu** `event-schedule` (`days[].sessions[]` w
`builder_data`). Dla plakatu agendy to wystarcza. Nie wystarcza, gdy sesja ma być
adresowalna: „moja agenda" uczestnika, spotkania 1-1 przy sesji, check-in na sesję,
statystyka frekwencji per sesja, prelegent widzący swoje wystąpienia, powiadomienie
„twoja sesja startuje za 15 minut".

Rekomendacja: **`event_sessions` jako tabela**, a widget `event-schedule` zyskuje
`source: "event"` (obok dzisiejszego `manual`) i staje się rendererem danych z bazy —
dokładnie tak, jak widget `speakers` ma już `source: manual | directory | event`.
Wzorzec jest w repo, nie wymyślamy nowego.

### 0.3 To rekomendacja, nie sprzeciw wobec zakresu

Reszta dokumentu realizuje wymaganie „dedykowana strona Wydarzeń z podstronami,
widgetami, rodzajami eventów" w pełnym zakresie Swapcarda. Powyższe dwa punkty
mówią tylko, **czym to zbudować**, żeby po trzech miesiącach nie było dwóch
niekompatybilnych silników treści.

### 0.4 Decyzje zamawiającego (2026-08-23) — wiążące dla całego dokumentu

Pytania otwarte z §10 zostały rozstrzygnięte. Poniższe odpowiedzi są **wiążące**;
reszta dokumentu jest do nich doprowadzona, a §10 przechowuje już tylko to,
co nadal otwarte.

| Pytanie                                 | Decyzja                                                                | Skutek dla zakresu                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsite czy sekcja w serwisie?        | **sekcja `/events/<slug>/…` w serwisie** (zgodnie z rekomendacją §0.1) | poddrzewo `pages`, jeden silnik stron, wspólne SEO i breadcrumby                                                                                    |
| Wystawcy jako moduł?                    | **nie** — partnerzy i sponsorzy **synchronizowani z CRM firm**         | `Exhibitor Marketplace` **poza zakresem**: bez self-service profilu wystawcy, `Items`, pakietów i stoisk; źródłem danych firmy jest `crm_companies` |
| Rejestracja przy wejściu (QR, badge'e)? | **tak, moduły do zbudowania**                                          | `Onsite` awansuje z „jeśli będzie czas” na **wymagany etap E7**: skaner QR, check-in, szablon i druk badge'a                                        |
| RSVP czy formularz z akceptacją?        | **obie formy**                                                         | `events.registration_flow ('rsvp' albo 'form')` — jedno wydarzenie klika RSVP, inne przechodzi formularz kwalifikacyjny z akceptacją                |
| Ile typów wejściówek?                   | **każde wydarzenie indywidualnie**                                     | `event_ticket_types` jako tabela; `events.ticket_price_cents` zostaje skrótem dla wydarzenia z jedną ceną                                           |

Dwie konsekwencje warte nazwania wprost, bo zmieniają kolejność pracy:

1. **Rezygnacja z modułu wystawców upraszcza moduł o cały podsystem** (profil firmy
   z polityką pól, `Items`, dokumenty wystawcy, pakiety, Exhibitor Center). Zostaje
   **grupa „Partnerzy”** z uprawnieniami i **sponsorzy z poziomami** czytani
   z `crm_companies`. Zaoszczędzony zakres etapu E6 przechodzi na onsite i rejestrację.
2. **Onsite przestaje być opcją**, a to znaczy, że zgoda na przekazanie danych
   partnerowi (skan badge'a) musi być zaprojektowana **razem z rejestracją** (E5),
   nie przy skanerze. Zgodę zbiera się w formularzu, nie przy bramce — patrz §4.8.

---

## 1. Co platforma ma już dziś (stan na 2026-08-23)

### 1.1 Baza danych

| Obiekt                                      | Rola                                                                                                                                                                                                                                                                                                                                                                           | Źródło                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `public.events`                             | rdzeń wydarzenia: `slug`, `title_pl/en`, `description_pl/en`, `kind`, `starts_at`/`ends_at`, `timezone`, `location`, `join_url`, `recording_url`, `visibility`, `min_tier_rank`, `capacity`, `status`, `host_user_id`, `chatham_house`, `cover_url`, `rsvp_opens_at`, `early_rsvp_rank`, `ticket_price_cents`, `ticket_currency`, `program_id`, `region_id`, `conversation_id` | `20260713093000_events_module.sql` + późniejsze ALTER-y |
| `public.event_rsvps`                        | RSVP `going/interested/cancelled` (+ waitlist FIFO), `reminded_at`                                                                                                                                                                                                                                                                                                             | tamże                                                   |
| `public.event_speakers`                     | `(event_id, user_id, sort_order)`                                                                                                                                                                                                                                                                                                                                              | `20260727200000_speaker_profiles_event_widgets.sql`     |
| `public.speaker_profiles`                   | nakładka „profil prelegenta" (headline, bio, tematy, języki, oceny, most do CRM)                                                                                                                                                                                                                                                                                               | tamże                                                   |
| `public.meeting_slots` / `meeting_bookings` | networking 1-1; **`meeting_slots.event_id` już istnieje**                                                                                                                                                                                                                                                                                                                      | moduł networkingu                                       |
| `public.plan_ticket_claims`                 | wejściówki w ramach planu członkowskiego (limit per okres)                                                                                                                                                                                                                                                                                                                     | monetyzacja                                             |
| `public.club_events` / `club_event_rsvps`   | **osobny** kalendarz wewnątrz klubów, z `anchor_event_id` → `events`                                                                                                                                                                                                                                                                                                           | moduł klubów                                            |
| `public.member_organizations`               | organizacja z **brandingiem** (logo H/V light/dark, favicon, `brand_primary/accent/ink`), miejscami i warstwą                                                                                                                                                                                                                                                                  | monetyzacja B2B                                         |
| `public.pages`                              | `parent_id`, `template_type`, `builder_data`, `header_override`, harmonogram, SEO — silnik microsite'ów                                                                                                                                                                                                                                                                        | rdzeń CMS                                               |

Utwardzenia, których nie wolno zgubić przy rozbudowie:
`events.join_url` i `events.recording_url` są **odcięte grantem kolumnowym** od
klienckiego `SELECT`; jedyna droga to `get_event_access`. RSVP wyłącznie przez
`rsvp_event` (limit miejsc pod blokadą wiersza). Liczniki przez
`get_event_rsvp_counts`. Pozycja w kolejce: `get_event_waitlist_position`.
Przypomnienia: `run_event_reminders()` (pg_cron). Prelegenci publicznie:
`get_public_speakers`. Zapisy profilu prelegenta: `admin_upsert_speaker_profile` /
`admin_delete_speaker_profile`.

### 1.2 Panel administracyjny

- `/admin/community/events` (`src/routes/admin.community.events.tsx`, 580 linii) —
  jedyna dzisiejsza powierzchnia: lista + filtr statusu + wyszukiwanie, dialog
  tworzenia/edycji (tytuły PL/EN, opisy, rodzaj, daty, strefa, lokalizacja, `join_url`,
  `recording_url`, widoczność, `min_tier_rank`, `capacity`, cena biletu, Chatham House),
  zmiana statusu, usuwanie, ręczne uruchomienie przypomnień, `EventSpeakersManager`.
- Warstwa danych: `src/lib/admin/community.ts` (`fetchAdminEvents`, `createEvent`,
  `updateEvent`, `updateEventStatus`, `deleteEvent`, `runEventReminders`,
  `fetchEventSpeakers`, `addEventSpeaker`, `removeEventSpeaker`,
  `setEventSpeakerOrder`, `upsertAdminSpeakerProfile`, …).
- i18n: `src/lib/i18n-admin-community-events.ts` (overlay ładowany przez `ensureI18n`).

**Wydarzenia nie mają własnej grupy w nawigacji panelu** — pozycja siedzi w grupie
`community` w `src/lib/admin/adminNav.ts`.

### 1.3 Front publiczny

- `/events` (`src/routes/events.tsx`) — katalog.
- `/events/$slug` (`src/routes/events.$slug.tsx`, 590 linii) — szczegóły + RSVP
  trójstanowe + waitlist + bramka nagrania + zakup biletu (`EventTicketPurchase`,
  `EventTicketCard`), `AddToCalendar`, grupa networkingowa (`EventGroupButton`),
  sekcja prelegentów, realtime miejsc (`useEventSeatsRealtime`).
- `/club/$clubSlug/e/$eventSlug` — wydarzenie klubowe.

### 1.4 Widgety buildera dotyczące wydarzeń (7)

| Widget                 | Kategoria | Źródła danych                                    |
| ---------------------- | --------- | ------------------------------------------------ |
| `speakers`             | blocks    | `manual` \| `directory` \| `event`               |
| `event-schedule`       | blocks    | **tylko `manual`** (dni/sesje w treści widgetu)  |
| `event-list`           | dynamic   | `events` (scope, kind, limit, warianty)          |
| `event-countdown`      | blocks    | `custom` \| `event`                              |
| `event-countdown-card` | blocks    | `custom` \| `event`                              |
| `event-sponsors`       | blocks    | **tylko `manual`** (poziomy + logotypy w treści) |
| `meeting-booking`      | blocks    | `host` \| `event` (`meeting_slots`)              |

Definicje: `src/lib/builder/registry.tsx`; rendery:
`src/components/builder/organisms/widget-view/*`; edytory właściwości:
`src/components/admin/builder/ui/organisms/widget-properties/*`; logika czysta:
`src/lib/events/{schedule,sponsors,countdown,kinds}.ts`.

---

## 2. Mapowanie Swapcard → NES (sidebar 1:1)

Legenda: **✅ jest** · **🟡 częściowo** · **🔴 brak**

### 2.1 Event builder

| Swapcard               | Zawartość ekranu                                                                                                                                                                                                                                               | Stan NES                       | Gdzie to jest / gdzie ma być                                                                                                                                                                                                                                                                                                                                              | Zadanie                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| General information    | nazwa, URL wydarzenia, `Begins`/`Ends`/`Time zone`, okładka, video header (YouTube ID), **Format: Hybrid / In-person / Virtual**, lokalizacja (adres/miasto/region/kod/kraj), Information (RTE), hashtag X, **Languages** (multi), support email, **Event ID** | ✅ ekran, 🟡 skutki na froncie | `src/components/admin/events/organisms/EventGeneralPanel.tsx` + `src/lib/events/eventGeneralDraft.ts` + `src/lib/events/eventLanguages.ts`; zapis `admin_event_general_save`, kolumny w `supabase/migrations/20260826090000_event_studio_general.sql`. **Front publiczny nie czyta jeszcze** adresu strukturalnego, nagłówka wideo, hashtagu, języków ani adresu wsparcia | EB-101…111 (otwarte: 103, 105, 106, 108, 110) |
| Pages & menu           | `Home page design: Advanced / Standard`, `Display mode: Grid / List`, **Pages** (`Menu pages` / `Other pages`) z ikoną, kolorem, kolejnością i widocznością                                                                                                    | 🟡                             | `src/components/admin/events/organisms/EventPagesMenuPanel.tsx` + `src/lib/events/eventPagesApi.ts` (poddrzewo `pages` po `events.root_page_id`); `events.home_design`, `events.pages_display_mode`. **Bez `event_pages`**: podział menu liczy się z `pages.menu_order`, brak ikon, kolorów, kolejności i widoczności per grupa; brak widgetu `event-menu` na froncie     | EB-201…206 (otwarte: 202…206)                 |
| Groups & permissions   | grupy uczestników (`Exhibitors`, `Speakers`, `Attendees` z licznikami), edycja + reguły per grupa, `Guest mode`, `Guests visibility` → „Manage visibility"                                                                                                     | 🟡                             | `src/components/admin/events/organisms/EventGroupsPermissionsPanel.tsx` (montuje istniejący `EventGroupsPanel.tsx`) + `events.guest_mode` (`hidden`/`teaser`/`full`). Ostrzeżenie o kolizji z Chatham House jest **informacyjne**; `event_capabilities()` i macierz „Manage visibility" nie istnieją                                                                      | EB-301…306 (otwarte: 302, 303, 306)           |
| Branding               | kolory, logotypy, fonty wydarzenia                                                                                                                                                                                                                             | 🟡                             | `src/components/admin/events/organisms/EventBrandingPanel.tsx` + `src/lib/events/eventBrandingDraft.ts`; zapis `admin_event_branding_save` (biała lista kluczy, `#RRGGBB`, obrazy wyłącznie `https`). Klucz pominięty = dziedziczenie z motywu globalnego. **Nie wstrzykujemy jeszcze** nadpisań w SSR poddrzewa stron wydarzenia; fonty zostają globalne                 | EB-401…405 (otwarte: 402, 405)                |
| Sponsors & advertising | sponsorzy, poziomy, kreacje reklamowe                                                                                                                                                                                                                          | 🟡                             | panele `SponsorsListPanel.tsx` / `SponsorTiersPanel.tsx` (`src/components/admin/events/organisms/`), w studiu montowane przez `EventStudioModuleSections.tsx`; reklama wydarzenia nadal globalna (`/admin/ads`, `ad_events`)                                                                                                                                              | EB-501…504                                    |
| Terms                  | regulamin i zgody wydarzenia                                                                                                                                                                                                                                   | 🟡                             | `EventTermsPanel.tsx` + `GroupMembersPanel.tsx`, w studiu montowane przez `EventStudioModuleSections.tsx`; globalnie nadal `user_consents` / `crm_consent_log`                                                                                                                                                                                                            | EB-601…603                                    |

### 2.2 Pozostałe sekcje sidebara (do rozpisania po kolejnych zrzutach)

Tabela rozpisana na **podpozycje** po partii 17 zrzutów
(`docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md`, §17.1). Dwie grupy —
`In-App registration` i `Content` — zostały odczytane z rozwiniętego sidebara wzorca
i okazały się grupami po cztery i siedem osobnych ekranów, każdy z własnym adresem.
Wiersze z `›` to te podpozycje; pozostałe grupy są w sidebarze wzorca zwinięte na
wszystkich 41 zrzutach, więc ich drzewa **nie znamy** i zostają jednym wierszem.

| Swapcard                                      | Stan NES                | Najbliższy istniejący klocek                                                                                                                                                                                                                                                             | Zadanie |
| --------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **In-App registration** (grupa, 4 podpozycje) | 🟡                      | w studiu jedna sekcja „Zapisy" z trzema zakładkami, bez droplisty wyboru wydarzenia (`EventStudioModuleSections.tsx` → `EventRegistrationSection`) — wzorzec ma tu **cztery adresy**                                                                                                     | EB-7xx  |
| › `Registration settings`                     | 🔴 ekran                | `RegistrationsManager` + `events.registration_flow` (`rsvp` / `form`, §0.4); ekranu ustawień zapisów per wydarzenie nie ma. Treść ekranu wzorca **nieodczytana** — brak zrzutu (§17.6 pkt 12)                                                                                            | EB-7xx  |
| › `Tickets`                                   | 🟡                      | `EventTicketsPanel` + `events.ticket_price_cents`; `event_ticket_types` jako tabela nadal do zrobienia (§0.4)                                                                                                                                                                            | EB-7xx  |
| › `Codes`                                     | 🔴 ekran                | moduł kuponów `/admin/coupons` (`src/routes/admin.coupons.index.tsx`, `.campaigns`, `.redemptions`, `.analytics`) — kampanie, realizacje i analityka **już są**; brakuje zakresu „to wydarzenie / ten typ biletu" i wejścia z poziomu wydarzenia (§10 pkt 5)                             | EB-7xx  |
| › `Form`                                      | 🟡                      | `RegistrationFieldsPanel`; wzorzec ma kreator wielostronicowy z edytowalnym ekranem podziękowania (zrzuty `02`, `03`) — u nas lista pól                                                                                                                                                  | EB-7xx  |
| **Content** (grupa, 7 podpozycji)             | 🟡                      | w studiu jedna sekcja „Treść" z czterema zakładkami agendy (`EventStudioModuleSections.tsx` → `EventContentSection`) — pokrywa **jedną** z siedmiu podpozycji wzorca                                                                                                                     | EB-8xx  |
| › `People`                                    | 🔴 ekran                | `RegistrationsListPanel` pokazuje **zapisanych** (`event_rsvps`), a nie kartotekę osób wydarzenia; docelowo `event_people` (§4.11) — osoba **bez konta**, wielokrotna przynależność do grup, `No account` jako wartość kolumny e-mail                                                    | EB-8xx  |
| › `Sessions`                                  | 🟡                      | `AgendaSessionsPanel` / `AgendaTracksPanel` / `AgendaRoomsPanel` / `AgendaConflictsPanel`; u wzorca sesja to **ekran z ośmioma zakładkami**, u nas dialog                                                                                                                                | EB-8xx  |
| › `Exhibitors` + `Exhibitor settings`         | ⛔ poza zakresem (§0.4) | zamiast kartoteki firm wydarzenia: sponsorzy i partnerzy czytani z `crm_companies` (`SponsorsListPanel` / `SponsorTiersPanel`). **Nie budujemy** profilu firmy z zakładkami, polityki `Company fields`, ani czterech zakładek `Exhibitor settings`                                       | —       |
| › `Items`                                     | ⛔ poza zakresem (§0.4) | brak odpowiednika i **nie ma powstać** — katalog produktów/projektów/ofert wystawcy to część modułu wystawców                                                                                                                                                                            | —       |
| › `Documents & Links`                         | 🔴 ekran                | wzorzec `club_documents` (`src/lib/clubs/workspaceApi.ts`, migracja `20260808300000_discussion_clubs_a28_workspace.sql`) — dokumenty istnieją w klubach, bez podpięcia do sesji i firm (`Attached to`) i bez statystyk pobrań                                                            | EB-8xx  |
| › `Feed channels`                             | 🔴 ekran                | wzorzec `club_board_notices` (`src/lib/clubs/networkApi.ts`, migracja `20260810180000_discussion_clubs_a33_network_screens.sql`) — kanał ogłoszeń istnieje w klubach; wydarzenie nie ma ani kanału, ani kolumny „na której stronie się pokazuje"                                         | EB-8xx  |
| › `Discussions`                               | 🔴 ekran                | dyskusje klubu: `club_groups` / `club_threads` / `club_replies` (`src/lib/clubs/`). Decyzja z dziennika (partia 10) — **nie budować drugiego silnika dyskusji**, podpiąć moduł klubów; brakuje wejścia w studiu, dziś sekcja nie istnieje w żadnej formie                                | EB-8xx  |
| Exhibitor Marketplace                         | ⛔ poza zakresem (§0.4) | zamiast modułu: grupa „Partnerzy” + sponsorzy czytani z `crm_companies`                                                                                                                                                                                                                  | —       |
| Meetings                                      | 🟡 panel jest           | `MeetingTablesPanel` / `MeetingSettingsPanel` / `MeetingsListPanel` / `MeetingStatsPanel`; w studiu sekcja „Spotkania" (`EventStudioModuleSections.tsx`); reguły matchmakingu nadal 🔴. Podpozycje wzorca **nieodczytane** (§17.6 pkt 1)                                                 | EB-10xx |
| Communications                                | 🟡                      | `/admin/newsletter` (kampanie, szablony), `run_event_reminders()`; w studiu **drogowskaz** bez zakresu per wydarzenie (`studio/EventStudioExternalSection.tsx`). Podpozycje **nieodczytane** (§17.6 pkt 2)                                                                               | EB-11xx |
| Onsite **(wymagany, §0.4)**                   | 🟡                      | `OnsiteDeskPanel` / `OnsiteLogPanel` / `OnsiteStatsPanel` / `OnsiteCheckpointsPanel` / `OnsiteDevicesPanel` / `OnsiteBadgesPanel` / `OnsiteLeadsPanel` + `src/lib/events/scannerApi.ts`; w studiu sekcja „Na miejscu". Podpozycje **nieodczytane** (§17.6 pkt 3)                         | EB-12xx |
| Integrations                                  | 🟡                      | `/admin/integrations` (globalne); w studiu **drogowskaz** bez zakresu per wydarzenie (`studio/EventStudioExternalSection.tsx`). Ani jednego zrzutu ekranu wzorca (§17.6 pkt 4)                                                                                                           | EB-13xx |
| Analytics                                     | 🟡                      | `/admin/analytics`, `analytics_events`, `domain_events`; w studiu **drogowskaz**, a liczby wydarzenia na pulpicie (`EventOverviewPanel.tsx`) — brak dashboardu wydarzenia. Podpozycje **nieodczytane** (§17.6 pkt 5)                                                                     | EB-14xx |
| Add-on features                               | 🔴 ekran                | kolumna `events.features jsonb` istnieje (migracja `20260826090000`), ekranu przełączników nie ma; w studiu **drogowskaz** (`studio/EventStudioExternalSection.tsx`). U nas to przełączniki modułów, nie sklep — patrz niżej                                                             | EB-15xx |
| `Help`                                        | 🔴                      | brak w jakiejkolwiek formie — u wzorca to **pozycja nawigacji** (ostatnia w sidebarze, zrzuty `01` i `37`), nie ikona w narożniku paska                                                                                                                                                  | EB-16xx |
| Publish event / Preview event                 | ✅                      | chip statusu jako przełącznik + „Opublikuj wydarzenie" w `studio/EventStudioTopBar.tsx` (RPC `admin_event_set_status`, znaczniki `published_at`/`cancelled_at` ustawia baza); podgląd na żywo z niezapisanego szkicu w `studio/EventStudioPreview.tsx` + `studio/EventPreviewCanvas.tsx` | EB-16xx |

**Granica §0.4 zapisana wprost, żeby nikt jej nie „dokończył" przez przypadek.**
Trzy pozycje wzorca — `Content › Exhibitors` (wraz z `Exhibitor settings` i profilem
firmy o sześciu zakładkach), `Content › Items` oraz `Exhibitor Marketplace` — są
**poza zakresem decyzją zamawiającego**, a nie brakiem do nadrobienia. Nie oznaczamy ich
🔴, bo 🔴 znaczy „do zrobienia", i ktoś, kto zobaczy czerwoną kropkę przy dziewięciu
ekranach z zrzutów `18`–`30`, uzna to za zaległość. Konkretnie **nie powstaje**:
kartoteka firm wydarzenia z polami własnymi, polityka `Company fields` (dwanaście
przełączników „co partner sam edytuje"), `Exhibitor Center` z komunikatem powitalnym
i obsadą, warunek eksportu leadów, rekomendacje „podobnych firm", katalog `Items`
z typami i podkategoriami, ani marketplace ze Stripe'em i modalem `Set currency`.
Zostaje **grupa „Partnerzy"** z uprawnieniami i **sponsorzy z poziomami** czytani
z `crm_companies`. Jeżeli któryś z tych ekranów kiedyś wróci do zakresu, wraca przez
zmianę §0.4, a nie przez dopisanie wiersza do tej tabeli.

Konsekwencja druga, dla `Add-on features`: wszystko, co wzorzec oznacza plakietką
`Add-on` (skanowanie sesji, self check-in, lead capture i qualification, dashboardy
leadów, role obsady firmy, dokumenty i `Items` wystawcy — zrzuty `17`, `26`–`29`), jest
u nas **albo w zakresie podstawowym** (skanowanie na miejscu — etap E7), **albo poza
zakresem** wraz z modułem wystawców. Nasze „Funkcje" to przełączniki modułów wydarzenia
(`events.features`), nie sklep, w którym organizator dokupuje funkcje.

---

## 3. Docelowa architektura informacji panelu

Dwa poziomy, bo Swapcard ma dwa: **lista wydarzeń** (poziom organizacji) i
**studio jednego wydarzenia** (poziom wydarzenia).

```
/admin/events                          lista + KPI + „Utwórz wydarzenie" (kreator z typu)
/admin/events/types                    rodzaje wydarzeń (presety) — §5
/admin/events/speakers                 katalog prelegentów (speaker_profiles) — dziś w community
/admin/events/$eventId                 STUDIO WYDARZENIA (layout + sub-nav + Outlet)
  ├── /general                         General information
  ├── /pages                           Pages & menu (poddrzewo `pages` wydarzenia)
  ├── /groups                          Groups & permissions
  ├── /branding                        Branding
  ├── /registration                    In-App registration (formularz, typy biletów, akceptacje)
  ├── /agenda                          Content → sesje (`event_sessions`), sale, ścieżki
  ├── /speakers                        Content → prelegenci wydarzenia
  ├── /tickets                         typy wejściówek (event_ticket_types) + kody dostępu
  ├── /sponsors                        sponsorzy i partnerzy (z CRM firm) + reklama wydarzenia
  ├── /meetings                         Meetings (sloty, reguły, statystyki)
  ├── /communications                  e-maile, przypomnienia, powiadomienia push
  ├── /onsite                          check-in, QR, badge'e, lead retrieval
  ├── /terms                           Terms (regulamin + zgody)
  ├── /integrations                    integracje w zakresie wydarzenia
  └── /analytics                       dashboard wydarzenia
```

Wzorce w repo, których się trzymamy:

- **layout + sub-nav + `Outlet`** — dokładnie jak `/admin/newsletter`
  (`src/routes/admin.newsletter.tsx` + `src/components/admin/newsletter/NewsletterSubNav.tsx`),
  `index` przekierowuje na pierwszą podstronę.
- **zakładki wewnątrz jednej trasy** — jak `/admin/community/clubs/$clubId`
  (`Tabs` + `?tab=` w search params). Dla piętnastu sekcji to za mało: przy takiej
  liczbie wybieramy **osobne trasy** (deep link, lazy chunk, osobny stan zapisu),
  a `Tabs` zostawiamy wewnątrz pojedynczej sekcji.
- **nowa grupa w `adminNav`**: `{ id: "events", label: t("admin.navGroups.events") }`
  z pozycjami: Wydarzenia, Rodzaje wydarzeń, Prelegenci, Spotkania 1-1.
  `admin.community.events` zostaje jako alias/redirect, żeby nie łamać zakładek.

---

## 4. Model danych — propozycja

Nazewnictwo i utwardzenia zgodne z doktryną repo: `tenant_id` w każdej tabeli,
zapisy administracyjne przez RPC `SECURITY DEFINER` z bramą roli w tenancie
**domowym** (`current_tenant_id()`), odczyt publiczny wyłącznie przez
`public_tenant_id()`, kolumny wrażliwe odcięte grantem kolumnowym.
Bramki: `check:sql-tenant-scope`, `check:sql-owner-tenant-scope`,
`check:sql-policy-tenant-regression`, `check:rpc-contract`, `check:db-contract`,
`check:gate-coverage`.

```sql
-- §4.1 ROZSZERZENIE events (bez nowej tabeli — wydarzenie zostaje jednym wierszem)
--
-- STAN 2026-08-26: CAŁOŚĆ WDROŻONA, w dwóch migracjach i z czterema odstępstwami
-- od propozycji poniżej. Kolumny przepływu i zaczepu frontu przyszły wcześniej
-- (`20260823120000_event_builder_foundation.sql`), reszta ekranu „Informacje
-- ogólne" w `20260826090000_event_studio_general.sql`. Odstępstwa są opisane
-- przy poszczególnych liniach — propozycji nie kasuję, żeby dało się prześledzić,
-- co i dlaczego zmieniło się względem projektu.
ALTER TABLE public.events
  -- WDROŻONE INACZEJ (20260823120000): wartości to `onsite | online | hybrid`,
  -- DEFAULT `onsite`, CHECK `events_format_values`. Nazwy z propozycji
  -- (`virtual`/`in_person`) były kalką ze wzorca; w repo ta sama trójka nazywa
  -- się `onsite/online/hybrid` w `event_types.default_format` i w `eventTypes.ts`,
  -- a dwa słowniki na jedną oś to gwarantowany rozjazd.
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'virtual'
    CHECK (format IN ('virtual','in_person','hybrid')),
  -- WDROŻONE INACZEJ (20260823120000): zamiast `type_key text` jest
  -- `event_type_id uuid REFERENCES public.event_types(id) ON DELETE SET NULL`.
  -- Klucz tekstowy nie ma integralności referencyjnej: zmiana `key` rodzaju
  -- zostawiłaby wydarzenia wskazujące na nieistniejący preset.
  ADD COLUMN IF NOT EXISTS type_key text,              -- → event_types.key (§5)
  ADD COLUMN IF NOT EXISTS street_address text,        -- WDROŻONE (20260826090000)
  ADD COLUMN IF NOT EXISTS city text,                  -- WDROŻONE (20260826090000)
  ADD COLUMN IF NOT EXISTS region text,                -- WDROŻONE (20260826090000)
  ADD COLUMN IF NOT EXISTS postal_code text,           -- WDROŻONE (20260826090000)
  ADD COLUMN IF NOT EXISTS country text,               -- WDROŻONE (20260826090000)
  -- WDROŻONE (20260826090000) z domknięciem zbioru: CHECK
  -- `events_video_header_platform_check` dopuszcza `youtube | vimeo` albo NULL.
  ADD COLUMN IF NOT EXISTS video_header_platform text,  -- youtube | vimeo | …
  -- WDROŻONE (20260826090000) + WARUNEK, KTÓREGO PROPOZYCJA NIE MIAŁA:
  -- `events_video_header_requires_cover` — `video_header_id IS NOT NULL`
  -- wymaga `cover_url IS NOT NULL`. Nagłówek wideo NIE zwalnia z okładki:
  -- miniatura w katalogu, w karcie społecznościowej i w e-mailu bierze się
  -- z obrazu. Warunek stoi w bazie, bo wideo da się ustawić także importem.
  ADD COLUMN IF NOT EXISTS video_header_id text,
  ADD COLUMN IF NOT EXISTS social_hashtag text,        -- WDROŻONE; w bazie BEZ znaku `#`
  ADD COLUMN IF NOT EXISTS support_email text,         -- WDROŻONE (20260826090000)
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{pl,en}',  -- WDROŻONE
  -- WDROŻONE INACZEJ (20260823120000): `guest_mode text NOT NULL DEFAULT 'teaser'`
  -- z CHECK `hidden | teaser | full`. Boolean odpowiadał tylko na pytanie „czy
  -- widoczne", a ekran 1.5 pyta o dwie rzeczy naraz: czy niezapisany w ogóle widzi
  -- wydarzenie i CO widzi. Trzeci stan („wszystko poza kontaktami") nie mieści się
  -- w dwóch wartościach, a dokładanie drugiej kolumny obok flagi dałoby stan
  -- niemożliwy (`false` + `full`).
  ADD COLUMN IF NOT EXISTS guest_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_design text NOT NULL DEFAULT 'standard'
    CHECK (home_design IN ('standard','advanced')),      -- WDROŻONE 1:1 (20260826090000)
  ADD COLUMN IF NOT EXISTS pages_display_mode text NOT NULL DEFAULT 'list'
    CHECK (pages_display_mode IN ('list','grid')),       -- WDROŻONE 1:1 (20260826090000)
  -- JUŻ ISTNIAŁO przed tą propozycją (20260823120000), razem z `branding jsonb`,
  -- `published_at`, `cancelled_at`, `registration_mode`, `registration_flow`
  -- i `external_registration_url`.
  ADD COLUMN IF NOT EXISTS root_page_id uuid REFERENCES public.pages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}'::jsonb;  -- WDROŻONE; ekranu przełączników jeszcze nie ma

-- RPC ekranu (20260826090000), bo zapis tych pól nie może iść zwykłym UPDATE-em
-- z klienta: slug ma unikalność w tenancie (klient nie sprawdzi kolizji bez
-- wyścigu), `ends_at > starts_at` jest warunkiem bazy, a nagłówek wideo bez
-- okładki jest błędem produktowym. Odmowa ma być JEDNYM, nazwanym błędem,
-- a nie trzema różnymi `23514`:
--   admin_event_detail(uuid)                     -- całe wydarzenie dla studia;
--                                                -- NIE oddaje join_url/recording_url,
--                                                -- tylko flagi has_stream/has_recording
--   admin_event_general_save(jsonb)              -- klucz nieobecny w payloadzie
--                                                -- = pole NIETKNIĘTE (ten sam kontrakt
--                                                -- unosi zapisy cząstkowe z innych ekranów)
--   admin_event_set_status(uuid, text)           -- publikacja/odwołanie; published_at
--                                                -- i cancelled_at ustawia BAZA, nie klient
--   admin_event_branding_save(uuid, jsonb)       -- biała lista kluczy, #RRGGBB, https

-- §4.2 SESJE (agenda z JSON-a do bazy — §0.2; model wg partii 6 i 7 zrzutów)
event_sessions (
  id, tenant_id, event_id → events ON DELETE CASCADE,
  title_pl/title_en, description_pl/description_en,
  header_image text,                                     -- 16:9, per sesja
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  -- Godziny są w strefie WYDARZENIA (events.timezone) - panel musi to napisać.
  format text NOT NULL DEFAULT 'in_person'
    CHECK (format IN ('in_person','embedded_video','video_file','roundtable','external_stream')),
  stream_url text,                                       -- GRANT KOLUMNOWY (jak join_url)
  location text, track text,                             -- pola pierwszej klasy: kolizje + onsite
  capacity int,                                          -- limit miejsc na sesję
  allow_overlap boolean NOT NULL DEFAULT true,           -- blokada podwójnego zapisu (§ niżej)
  registration_scope text NOT NULL DEFAULT 'event_groups'
    CHECK (registration_scope IN ('event_groups','community','none')),
  min_tier_rank int NOT NULL DEFAULT 0,
  is_private boolean NOT NULL DEFAULT false,             -- widoczna tylko dla zapisanych
  hide_attendees boolean NOT NULL DEFAULT false,         -- ukryj listę zapisanych
  feedback_enabled boolean NOT NULL DEFAULT false,       -- ocena po sesji
  interaction jsonb NOT NULL DEFAULT '{}'::jsonb,        -- skrzynka interakcji (patrz niżej)
  status text CHECK (status IN ('draft','published','cancelled')),
  sort_order int, created_by, created_at, updated_at,
  CHECK (ends_at > starts_at)
)
-- Blokada kolizji czasowej (Swapcard: "Allow overlap"). Reguła działa TYLKO
-- między sesjami, które OBIE mają allow_overlap = false. Sprawdzenie należy do
-- RPC pod blokadą wiersza; w kliencie byłoby wyścigiem. W Postgresie:
--   tstzrange(starts_at, ends_at) && tstzrange(...)  + indeks GiST
--
-- interaction jsonb: { label_pl, label_en, tabs: ['chat','questions','polls'] }
--   Maks. 5 zakładek (limit Swapcarda - skrzynka jest wąska na telefonie).
--   Silniki są w repo: czat (conversations/messages), Q&A z głosowaniem
--   (club_thread_questions + club_thread_question_votes, qa_sessions/qa_questions),
--   ankiety (club_thread_polls). Praca = przypięcie session_id, nie budowa.

event_speaker_roles (id, tenant_id, event_id, key, name_pl/name_en, sort_order)
  -- domyślne: moderator, panelist, lecturer („Wykładowcy"), host, guest
event_session_speakers (session_id, person_id, role_id, sort_order)
  -- person_id → rekord uczestnika (§4.11), NIE auth.users: prelegent bez konta
  -- musi być możliwy (21 z 21 prelegentów w danych referencyjnych ma "No account")
event_session_companies (session_id, company_id → crm_companies,
  role text CHECK (role IN ('sponsor','host','partner')))
event_session_registrations (session_id, person_id, registered_at, status,
  UNIQUE (session_id, person_id))                        -- ZAPIS na sesję (przed)
event_session_feedback (session_id, person_id, rating int CHECK (rating BETWEEN 1 AND 5),
  comment text, created_at, UNIQUE (session_id, person_id))
  -- To jest brakujące ŹRÓDŁO dla speaker_profiles.rating / reviews_count, które
  -- dziś są pustą obietnicą: nie ma skąd ich policzyć.
event_session_links (from_session_id, to_session_id,
  kind CHECK (kind IN ('continuation','parallel','translation','related')))

-- Frekwencja (BYŁ) to osobny fakt od zapisu (ZAPISAŁ SIĘ) - patrz event_checkins
-- w §4.6 z session_id. Zlanie ich w jedno uniemożliwia policzenie no-show.

-- §4.3 GRUPY I UPRAWNIENIA (wzorzec club_groups + club_capabilities)
event_groups (
  id, tenant_id, event_id, key text,                   -- 'attendees' | 'speakers' | 'exhibitors' | …
  name_pl/name_en, color, icon, sort_order,
  can_meet boolean, can_see_attendees boolean, can_chat boolean,
  can_lead_retrieval boolean, min_tier_rank int, is_system boolean
)
event_group_members (group_id, user_id, org_id, added_by, created_at)
-- jedna funkcja prawdy: event_capabilities(_event_id, _user_id) → can_read/can_meet/…

-- §4.4 REJESTRACJA (tryb + przebieg: decyzja §0.4 "obie formy")
--   registration_mode: GDZIE się rejestruje; registration_flow: JAK to wygląda.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS registration_mode text NOT NULL DEFAULT 'in_app'
    CHECK (registration_mode IN ('in_app','external','none')),
  ADD COLUMN IF NOT EXISTS registration_flow text NOT NULL DEFAULT 'rsvp'
    CHECK (registration_flow IN ('rsvp','form')),
  ADD COLUMN IF NOT EXISTS registration_url text,        -- tryb 'external'
  ADD COLUMN IF NOT EXISTS guest_redirect text NOT NULL DEFAULT 'in_app'
    CHECK (guest_redirect IN ('in_app','external'));

event_registration_forms (event_id, schema jsonb, approval_mode
  CHECK (approval_mode IN ('auto','manual')), confirmation_email_id, …)
event_registrations (id, tenant_id, event_id, user_id, group_id, status
  CHECK (status IN ('pending','approved','rejected','waitlist','cancelled')),
  answers jsonb, ticket_type_id, created_at)

-- Typy wejściówek. KRAWĘDŹ KLUCZOWA: typ biletu NADAJE GRUPĘ (zrzut 3.5); bez
-- niej administrator przypisuje grupy ręcznie przy każdym uczestniku.
event_ticket_types (
  id, tenant_id, event_id → events ON DELETE CASCADE,
  name_pl/name_en, description_pl/en,
  price_cents int NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'PLN',
  group_id uuid → event_groups,                         -- nadanie grupy przy zakupie
  quota int,                                            -- NULL = bez limitu
  sales_from timestamptz, sales_to timestamptz,          -- "Valid from / until"
  min_tier_rank int NOT NULL DEFAULT 0,
  visibility text NOT NULL DEFAULT 'visible'
    CHECK (visibility IN ('visible','hidden')),           -- hidden = tylko z kodu
  coupon_scope uuid NULL,                                 -- powiązanie z /admin/coupons
  sort_order int NOT NULL DEFAULT 0,
  created_at, updated_at
)
-- Status ("Ended" / "Active") NIE jest kolumną - wylicza się z okna sprzedaży.
-- Brak wiersza w event_ticket_types ⇒ obowiązuje events.ticket_price_cents.

-- §4.5 SPONSORZY I PARTNERZY (decyzja §0.4: źródłem jest CRM firm)
event_sponsor_tiers (id, tenant_id, event_id, name_pl/en, size
  CHECK (size IN ('sm','md','lg')), sort_order)
event_sponsors (id, tenant_id, tier_id → event_sponsor_tiers ON DELETE CASCADE,
  company_id uuid → crm_companies,                      -- jedno źródło prawdy o firmie
  name_override text, logo_override text, url_override text,  -- gdy CRM nie ma logotypu
  description_pl/en, sort_order)
-- Bez pakietów, stoisk i Exhibitor Center - moduł wystawców poza zakresem (§0.4).

-- Firma przy wydarzeniu (partner / patron / prowadzący panel). Zrzut 8.6 pokazał
-- plakietkę "Events (1)": firma należy do SPOŁECZNOŚCI i jest przypięta do N
-- wydarzeń, a wydarzenie nadaje jej kontekst. To wzorzec "dziedzicz albo nadpisz".
event_companies (
  id, tenant_id, event_id, company_id → crm_companies,
  group_id uuid → event_groups,                          -- grupa obejmuje też firmy
  role text,                                             -- partner | patron | media | host
  description_pl/description_en,                         -- NADPISANIE opisu z CRM
  header_image text, background_image text, logo_override text,
  sort_order int, created_at, updated_at,
  UNIQUE (event_id, company_id)
)
-- Odczyt publiczny przez definerowy RPC get_public_event_companies (wzorzec
-- get_public_speakers): gość widzi nazwę, logo, opis i KRAJ - nigdy telefonu
-- ani e-maila. Degradacja widoczności należy do bazy, nie do komponentu.

-- §4.6 ONSITE - WŁASNY SYSTEM SKANOWANIA (wymagane, decyzja §0.4)
--   Swapcard dzieli to na trzy płatne dodatki (Checkpoints + Session scanning +
--   Self check-in). To jeden model: punkty kontroli, poświadczenia urządzeń,
--   zdarzenia skanu. Bez aplikacji natywnej i bez pudełka ze sprzętem.
event_checkpoints (
  id, tenant_id, event_id, name_pl/name_en,
  kind text CHECK (kind IN ('event_entry','session','zone','catering','company_booth')),
  session_id uuid NULL → event_sessions,      -- gdy kind = 'session'
  company_id uuid NULL → crm_companies,       -- gdy kind = 'company_booth'
  location_id uuid NULL → event_locations,
  direction_mode text NOT NULL DEFAULT 'in_out'
    CHECK (direction_mode IN ('in_only','in_out')),
  access_mode text NOT NULL DEFAULT 'track'
    CHECK (access_mode IN ('track','control')),  -- mierz frekwencję / wpuszczaj
  allowed_group_ids uuid[], allowed_ticket_type_ids uuid[],
  capacity int, is_active boolean NOT NULL DEFAULT true
)
-- Poświadczenie URZĄDZENIA, nie osoby (Swapcard: "can be used to log in on
-- multiple devices"). Wolontariusz nie dostaje konta w platformie.
event_scanner_credentials (
  id, tenant_id, event_id, checkpoint_id NULL,  -- NULL = wszystkie punkty
  label text,                                    -- „Bramka główna", „Sala Blue"
  code_hash text NOT NULL,                       -- HASH kodu, nigdy jawny
  scopes text[] NOT NULL DEFAULT '{checkin}',    -- checkin | lead | badge_print
  expires_at timestamptz NOT NULL, revoked_at timestamptz, created_by, created_at
)
event_scans (
  id, tenant_id, event_id, checkpoint_id, person_id → event_people,
  direction text CHECK (direction IN ('in','out')),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  credential_id → event_scanner_credentials, device_id text,
  result text CHECK (result IN ('granted','denied_group','denied_ticket',
                               'denied_capacity','denied_duplicate','unknown_code')),
  offline_queued_at timestamptz,                 -- czas skanu na urządzeniu
  UNIQUE (checkpoint_id, person_id, direction, scanned_at)
)
-- Idempotencja: ten sam człowiek, punkt i kierunek w oknie 60 s = jeden wiersz
-- (podwójne piknięcie przy bramce). Rozstrzyga serwer, nie urządzenie.

event_badge_templates (
  id, tenant_id, event_id, name, is_default boolean,
  paper_format text,                             -- A6 / A5 / 100x150mm
  double_fold boolean NOT NULL DEFAULT false,     -- odbicie lustrzane (smycz)
  elements jsonb                                  -- lista elementów, patrz niżej
)
-- elements: pionowa LISTA bloków, bez swobodnego pozycjonowania XY:
--   [{ kind: 'image'|'text'|'field'|'qr'|'sponsors', field: 'first_name'|…,
--      width: {unit:'%'|'cm', value}, align: 'left'|'center'|'right',
--      gap_cm: 0.54, font_size_pt, font_weight, visible }]
-- Jednostki FIZYCZNE (cm/mm) + @page w CSS: badge musi wyjść identycznie
-- z każdej drukarki. Swobodne XY gwarantuje, że coś kiedyś nie zmieści się.
event_ticket_types.badge_template_id uuid NULL   -- NULL = szablon domyślny

event_leads (
  id, tenant_id, event_id,
  owner_company_id uuid NULL → crm_companies,     -- lead firmy (skan na stoisku)
  owner_person_id uuid NULL → event_people,       -- lead uczestnika (wymiana wizytówek)
  CHECK (num_nonnulls(owner_company_id, owner_person_id) = 1),
  lead_person_id → event_people, scanned_by, scanned_at,
  qualification jsonb, note text,
  UNIQUE (event_id, owner_company_id, owner_person_id, lead_person_id)
)
-- RLS: dostęp WYŁĄCZNIE dla obsady firmy (organization_seats) albo właściciela
-- leada oraz staff. Wspólna tabela z filtrem w UI = wyciek jednym SELECT-em.
-- Eksport leadów widzi TYLKO osoby z aktywną zgodą (§4.8) - reguła w RPC,
-- nie konfigurowalny warunek (inaczej pierwsza pomyłka = naruszenie).
-- Skan uczestnik→uczestnik tworzy POŁĄCZENIE w sieci kontaktów, nie leada w CRM.

-- Skaner: PWA (getUserMedia + BarcodeDetector), kolejka offline w IndexedDB
-- (sala kongresowa bez zasięgu), synchronizacja przy powrocie sieci.
-- Self check-in: ta sama PWA w trybie kiosku + druk badge'a przez dialog druku.

-- §4.7 STRONY WYDARZENIA (bez drugiego silnika stron — §0.1)
event_pages (event_id, page_id → pages, slot text, menu_label_pl/en,
  icon, color, in_menu boolean, sort_order, visible_to_groups uuid[])

-- §4.8 ZGODY I REGULAMIN (zrzut 3.3)
event_terms (
  id, tenant_id, event_id, key text,                    -- "Label (only visible to you)"
  title_pl/title_en, body_pl/body_en, external_url text,
  display text NOT NULL DEFAULT 'access'
    CHECK (display IN ('access','registration_and_access')),
  required boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,                        -- nasze, nie Swapcarda
  sort_order int, created_at, updated_at,
  UNIQUE (event_id, key)
)
event_term_acceptances (term_id, user_id, version int, accepted_at,
  UNIQUE (term_id, user_id, version))
-- Wersja jest warunkiem wartości dowodowej: zgoda na v1 nie jest zgodą na v2.
-- Zgoda required = false (np. przekazanie danych partnerowi) NIE MOŻE blokować
-- zatwierdzenia rejestracji - inaczej jest zgodą pozorną.

-- §4.9 REKLAMA WYDARZENIA (rozszerzenie /admin/ads, nie nowy moduł)
--   AdTargeting  += eventGroupKeys text[]   (dziś: categorySlugs, tagSlugs, languages)
--   AdPosition   += 'event_home_sidebar' | 'interstitial_mobile'
--   ad_placements.page_type += 'event'      (page_id = events.id)
--   rotacja: wiele slotów trafiających w tę samą grupę → losowanie przy renderze
--   statystyki: ad_events (kind = odsłona / klik) - już liczone

-- §4.10 BRANDING WYDARZENIA (zrzut 2.5)
--   events.branding jsonb: WĄSKI podzbiór slotów (nawigacja, akcja główna, tekst,
--   tło bloków, obraz tła, logo) w dwóch trybach (light/dark). Klucz nieobecny =
--   dziedziczenie z motywu globalnego; "Reset to community branding" USUWA klucz,
--   nie zapisuje wartości domyślnej. Wyjście tym samym kanałem, co globalne kolory:
--   CSS custom properties w SSR (globalColorsToCss / DesignTokensStyle), z zakresem
--   ograniczonym do poddrzewa stron wydarzenia ORAZ formularza rejestracji.

-- §4.11 OSOBY WYDARZENIA (uczestnik bez konta - zrzut 5.1, decyzja modelowa)
--   21 prelegentów z OECD, NASK, SGH i RPP ma w danych referencyjnych "No account".
--   Dzisiejsze event_rsvps.user_id i event_speakers.user_id wskazują auth.users,
--   więc wpisanie prelegenta do agendy wymagałoby ZAŁOŻENIA MU KONTA - czego
--   redakcja nie zrobi dla 21 osób i nie powinna robić bez ich wiedzy.
event_people (
  id, tenant_id, event_id,
  user_id uuid NULL → auth.users,                        -- wiązanie przy pierwszym logowaniu
  email text, email_norm text,                           -- klucz dopasowania (wzorzec crm_leads)
  first_name, last_name, job_title, company_text,
  company_id uuid NULL → crm_companies,
  group_id uuid NOT NULL → event_groups,                 -- grupa PODSTAWOWA (wymagana)
  crm_lead_id uuid NULL → crm_leads,                     -- most do CRM (grant kolumnowy!)
  created_at, updated_at,
  UNIQUE (event_id, email_norm)
)
event_group_members (group_id, person_id)                -- grupy DODATKOWE (wiele-do-wielu)
-- Uprawnienie wypadkowe z wielu grup = SUMA zdolności (najbardziej pozwalająca
-- wygrywa); domyślny "iloczyn" dałby efekt odwrotny do zamierzonego.
-- event_registrations, event_session_*, event_checkins i event_leads wskazują
-- na event_people, więc jest JEDNA kartoteka osób wydarzenia.

-- §4.12 POLA WŁASNE - JEDEN mechanizm dla trzech encji (zrzuty 5.2, 6.2, 8.2)
--   Swapcard ma osobne "custom fields" dla osób, sesji i firm, ale ten sam
--   wzorzec: definicja na poziomie SPOŁECZNOŚCI ("field used in other events
--   within this Community"), wartość per wydarzenie. Wzorzec w repo:
--   post_custom_meta_defs + /admin/custom-meta.
event_custom_field_defs (
  id, tenant_id, entity text CHECK (entity IN ('session','person','company')),
  key text, label_pl/label_en, section text,
  type text CHECK (type IN ('text','textarea','select','multiselect','url','email','tel','checkbox')),
  options jsonb, is_filter boolean, sort_order int,
  UNIQUE (tenant_id, entity, key)
)
event_custom_field_values (def_id, event_id, entity_id, value jsonb)
-- Reguła projektowa Swapcarda warta skopiowania: FILTREM wyszukiwania może być
-- wyłącznie pole słownikowe (select/multiselect). Pole tekstowe jako filtr daje
-- listę pięćdziesięciu unikalnych wartości i jest bezużyteczne.
--
-- Polityka edycji pól profilu (zrzut 5.2) jest na poziomie TENANTA, nie wydarzenia:
profile_field_policy (tenant_id, field text, editable boolean)
-- Domyślne wg Swapcarda: imię, nazwisko i e-mail profilu ZABLOKOWANE (nazwisko
-- na wydrukowanym badge'u nie może się zmienić po druku), reszta edytowalna.
-- Wyłączenie wszystkiego byłoby problemem prawnym (RODO: prawo do sprostowania).

-- §4.13 BIBLIOTEKA TREŚCI WYDARZENIA (partie 9 i 10)
event_documents (
  id, tenant_id, event_id,
  kind text CHECK (kind IN ('file','link')),             -- Swapcard trzyma to JEDNĄ encją
  url text, title_pl/title_en, description_pl/description_en,  -- opis do 160 znaków
  visibility text, min_tier_rank int, group_ids uuid[],  -- „Spotkania Chatham House"!
  download_count int NOT NULL DEFAULT 0, created_at, updated_at
)
event_session_documents (session_id, document_id, sort_order)
event_company_documents (company_id, document_id, sort_order)  -- „Attached to"
-- Statystyki pobrań: liczone jak ad_events (kind = pobranie / klik). Redakcja
-- używa dziś do tego skrótów bit.ly - ta funkcja zastępuje zewnętrzne narzędzie.
--
-- Kanał ogłoszeń wydarzenia: wzorzec club_board_notices + club_posts.
-- Dyskusje wydarzenia: NIE budujemy nowego silnika - podpinamy grupę klubu
-- (club_events.anchor_event_id wiąże już kalendarz klubu z wydarzeniem; brakuje
-- kierunku odwrotnego: „dyskusja tego wydarzenia toczy się w grupie X").

-- §4.14 SPOTKANIA 1-1 - rozszerzenie, nie zastąpienie (partie 12 i 13)
--   Dziś: host publikuje slot, uczestnik rezerwuje, potwierdzenie natychmiastowe
--   (meeting_slots.host_user_id NOT NULL; meeting_bookings.status =
--   confirmed|cancelled). Kongres potrzebuje drugiego trybu: wspólna siatka
--   slotów wydarzenia + ZAPYTANIA akceptowane przez drugą stronę.
ALTER TABLE public.meeting_slots
  ALTER COLUMN host_user_id DROP NOT NULL,       -- NULL = slot wspólny wydarzenia
  ADD COLUMN IF NOT EXISTS location_id uuid → event_locations,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
-- + RPC generate_event_meeting_slots(event_id, batches jsonb) - generator partii
--   (dzień + okno + długość → N slotów; „Create 40 slots" liczy dokładnie tyle).

event_locations (                                 -- WSPÓLNY słownik: sale i stoliki
  id, tenant_id, event_id, category text,         -- „Hall 2", „Level 3"
  name text,                                      -- „Blue room", „Table 4"
  capacity int NOT NULL DEFAULT 1,                -- ile spotkań RÓWNOLEGLE
  is_virtual boolean NOT NULL DEFAULT false,
  company_id uuid NULL → crm_companies,           -- stoisko jako miejsce spotkań
  sort_order int
)
meeting_requests (
  id, tenant_id, event_id,
  from_person_id → event_people,
  to_person_id uuid NULL → event_people,
  to_company_id uuid NULL → crm_companies,        -- zaprosić można też firmę
  CHECK (num_nonnulls(to_person_id, to_company_id) = 1),
  slot_id uuid NULL → meeting_slots, location_id uuid NULL → event_locations,
  message text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('draft','pending','accepted','declined','expired','cancelled')),
  held boolean,                                   -- frekwencja: odbyło się?
  expires_at timestamptz NOT NULL,                -- ZAPISANY przy utworzeniu
  created_at, responded_at
)
-- expires_at jest zapisywany, nie liczony z reguły: zmiana reguły nie może
-- unieważniać wysłanych zaproszeń (Swapcard: „changes impact only new requests").
-- Domyślnie 72 h - Swapcard podaje z danych, że 2-4 dni podnosi akceptację.
-- Miejsce przydziela się PRZY AKCEPTACJI (pierwsze wolne w slocie), nie przy
-- tworzeniu slotu - dlatego location.capacity > 1 ma sens.
meeting_request_rules (
  id, tenant_id, event_id, name,
  requester_group_ids uuid[], invitee_group_ids uuid[],
  location_ids uuid[], slot_ids uuid[],
  expires_after_hours int NULL DEFAULT 72,
  expires_at_meeting_start boolean NOT NULL DEFAULT false
)
meeting_preferences (person_id, target_person_id, level
  CHECK (level IN ('interested','highly_interested')))
-- „Smart meeting scheduling" to NIE model językowy, a przydział dwustronny
-- z ograniczeniami (pojemność slotów i miejsc, preferencje z wagami, limit
-- spotkań na osobę). Solver, nie AI. Kolejność: najpierw zapytania i reguły,
-- przydział dopiero na żywych danych o akceptacjach.

-- §4.15 KOMUNIKACJA - rozszerzenie modułu newslettera (partia 14)
--   newsletter_campaigns ma już audience_filter jsonb, i18n treści, harmonogram
--   i statystyki (newsletter_campaign_events). Kampania wydarzenia to FILTR,
--   nie nowy moduł: audience_filter = { event_id, group_ids }.
--   Do dodania:
--     trigger text ('scheduled','on_register','before_event','after_event')
--       + offset_hours int          -- typ „Continuous" u Swapcarda
--     redirect_page_id uuid         -- deep link do event_pages, nie wolny URL
--     from_name z INTERPOLACJĄ zmiennych („{{ event_name }}")
--     email_template_id na event_ticket_types (inny e-mail dla Partnera
--       niż dla Uczestnika)
--   Presety rodzajów wydarzeń (§5) niosą DOMYŚLNE SEKWENCJE per grupa
--   (Swapcard: 3 grupy × 4 e-maile - to wiedza operacyjna warta więcej niż kod).
--   Powiadomienia push: push_subscriptions + notifications + VAPID już są;
--   brakuje jednego ekranu (cel: grupa/pole własne, treść, strona, czas).
--   Push o sesji („start za 15 minut") generuje się Z DANYCH SESJI, nie ręcznie.

-- §4.16 RAPORTY (partia 16) - wszystkie są LISTAMI OSÓB z kontekstem, czyli
--   w praktyce eksportami CSV z filtrem, nie wykresami:
--     zapisy + frekwencja + oceny sesji   (event_session_registrations
--                                          + event_scans + event_session_feedback)
--     wiadomości i pytania z interakcji   (qa_questions, club_thread_questions)
--     odpowiedzi w ankietach              (club_thread_polls)
--     oglądalność wideo z czasem          BRAK - wymaga nowych zdarzeń
--     transakcje                          (payment_orders) ✅
--     odsłony/kliknięcia reklam i sponsorów (ad_events) ✅
--   BRAMKA RODO: raport „kto obejrzał profil/stoisko/reklamę" to PROFILOWANIE.
--   Przy chatham_house = true raporty osobowe muszą być wyłączone w RPC, nie
--   ukryte w UI → nowa zdolność can_view_reports w event_capabilities().
--   Dashboard: NIGDY danych demonstracyjnych (Swapcard pokazuje 48 820 rejestracji
--   przy wydarzeniu z 21 osobami) - pusty stan z instrukcją, nie liczby z palca.
--   Filtr grupy obowiązuje we WSZYSTKICH kaflach albo w żadnym.
```

Decyzje do potwierdzenia przed migracją:

1. **`event_sessions` vs dzisiejszy JSON widgetu** — migracja czy współistnienie?
   Rekomendacja: współistnienie z `source` w widgecie (wzorzec widgetu `speakers`),
   bez migracji wstecznej istniejących stron.
2. **`event_groups` vs `min_tier_rank`** — grupy wydarzenia to nowa oś uprawnień
   obok warstw członkowskich. Rekomendacja: grupa **nie zastępuje** warstwy;
   `event_capabilities()` liczy iloczyn (rola platformy × grupa × warstwa).
3. **Sponsor = wiersz w `crm_companies`** (decyzja §0.4). `member_organizations`
   zostaje przy członkostwie B2B; sponsor nie musi mieć miejsc ani warstwy. Gdy
   firma w CRM nie ma logotypu, ratuje sytuację `logo_override` na `event_sponsors`
   — bez zaśmiecania CRM danymi marketingowymi.
4. **Nazwy typów biletów i poziomów sponsorskich są bliźniacze** (`*_pl` / `*_en`).
   W danych referencyjnych bilety nazywają się `Uczestnik` / `Prelegent`, a grupy
   `Attendees` / `Speakers`; jednojęzyczne pole zablokowałoby wersję angielską.

---

## 5. Rodzaje wydarzeń („rodzaje eventów")

Dziś jedna kolumna `events.kind` z twardym `CHECK`:
`webinar | briefing | roundtable | ama | in_person | hybrid`
(etykiety: `src/lib/events/kinds.ts`, lista dla panelu: `EVENT_KINDS` w
`src/lib/admin/community.ts`).

Ta lista **miesza dwie osie**: gatunek programowy (webinar, briefing, okrągły stół,
AMA) z formą dostarczenia (stacjonarne, hybrydowe). Swapcard trzyma je osobno:
gatunek jest sprawą treści, a `Format: Hybrid / In-person / Virtual` osobnym polem.

Propozycja — trzy poziomy:

1. **`format`** (nowa kolumna, §4.1): `virtual | in_person | hybrid`. Steruje tym,
   co jest wymagane: `join_url` dla virtual, adres dla in_person, oba dla hybrid.
2. **`kind`** zostaje gatunkiem, ale `CHECK` ustępuje miejsca słownikowi
   `event_types` (redakcja dodaje własne rodzaje bez migracji).
3. **preset rodzaju** — to jest realna wartość dla redakcji. Rodzaj wydarzenia
   przestaje być etykietą, a staje się **szablonem uruchamiającym moduły**:

```
event_types (
  id, tenant_id, key text UNIQUE (tenant_id, key),
  name_pl/name_en, description_pl/en, icon, color, sort_order, is_active,
  default_format text,
  default_features jsonb,      -- { rsvp, tickets, waitlist, recording, meetings,
                               --   exhibitors, sponsors, onsite, chatham_house, sessions }
  default_pages jsonb,         -- które podstrony zakładać (agenda, prelegenci, wystawcy…)
  default_widgets jsonb,       -- starter buildera dla strony-korzenia
  default_min_tier_rank int, default_capacity int, default_duration_minutes int
)
```

Presety startowe (z etykietami PL/EN w `src/lib/events/kinds.ts` jako fallback):
`webinar`, `briefing`, `roundtable` (okrągły stół), `ama`, `congress` (kongres —
wielodniowy, agenda + wystawcy + spotkania), `decision_lab` (format własny NES —
Chatham House domyślnie **włączone**, brak nagrania, brak listy uczestników),
`chatham_house`, `study_visit`, `workshop`, `gala`.

Wybór rodzaju w kreatorze („Utwórz wydarzenie") **zakłada od razu** poddrzewo stron
i włącza moduły — to jest odpowiednik swapcardowego onboardingu z checklistą.

**Drugi tryb tworzenia: klon poprzedniej edycji.** Zrzut 9.1 pokazał u Swapcarda
„Import from another event in the Community" — i to jest, z punktu widzenia NES,
najlepszy pomysł w całym tym panelu. Kongres jest cykliczny: ci sami prelegenci,
ci sami partnerzy, podobna agenda, te same typy wejściówek. Kreator ma więc dwie
drogi: **z presetu rodzaju** (nowy format) albo **z poprzedniej edycji**
(kopiowanie sesji, prelegentów, firm, sponsorów, dokumentów, typów biletów i grup,
z wyzerowanymi datami i statusem `draft`). Druga droga oszczędza kilka godzin pracy
redakcji przy każdej edycji i jest tańsza w implementacji niż wygląda: to jeden RPC
kopiujący wiersze między `event_id`.
Istniejące `starterTemplates` buildera (`src/lib/builder/starterTemplates.ts`) są
gotowym miejscem na `default_widgets`.

---

## 6. Widgety — czego brakuje

Mamy 7 (§1.4). Do kompletu „event microsite" brakuje (kategoria `blocks`/`dynamic`,
podgrupa `events` w palecie — `SUBGROUPS` w `WidgetLibrary.tsx`):

| Widget               | Co robi                                                                          | Źródło danych                                    |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `event-hero`         | nagłówek wydarzenia: nazwa, daty, miejsce, format, CTA rejestracji, video header | `events` (tryb `event`)                          |
| `event-registration` | formularz rejestracji / RSVP / wybór typu biletu                                 | `event_registration_forms`, `event_ticket_types` |
| `event-tickets`      | cennik wejściówek z limitami i okienkiem sprzedaży                               | `event_ticket_types`                             |
| `event-session`      | karta jednej sesji (deep link z agendy)                                          | `event_sessions`                                 |
| `event-my-agenda`    | „moja agenda" zalogowanego uczestnika                                            | `event_session_attendance`                       |
| `event-exhibitors`   | katalog wystawców z filtrami i wyszukiwaniem                                     | `event_exhibitors` + `member_organizations`      |
| `event-attendees`    | lista uczestników z widocznością per grupa                                       | `event_groups` + `event_capabilities()`          |
| `event-live`         | transmisja + czat/Q&A na czas sesji                                              | `event_sessions.stream_url` (przez RPC!)         |
| `event-map`          | plan sal / stoisk                                                                | treść widgetu (SVG/obraz + hotspoty)             |
| `event-practical`    | informacje praktyczne: dojazd, hotele, kontakt, hashtag                          | `events`                                         |
| `event-cta-bar`      | przyklejony pasek „Zarejestruj się" z odliczaniem                                | `events`                                         |
| `event-documents`    | materiały wydarzenia z bramką widoczności i licznikiem pobrań                    | `event_documents`                                |
| `event-feed`         | tablica ogłoszeń wydarzenia („Czy wiedziałeś, że…”)                              | kanał ogłoszeń (wzorzec `club_board_notices`)    |
| `event-companies`    | partnerzy i patroni z filtrami po polach słownikowych                            | `event_companies` + `crm_companies`              |
| `event-feedback`     | ocena sesji po jej zakończeniu (prywatna, 1–5 + komentarz)                       | `event_session_feedback`                         |

Rozszerzenia istniejących:
`event-schedule` → `source: manual | event`; `event-sponsors` → `source: manual | event`;
`speakers` → filtr po sesji; `event-list` → filtr po `type_key` i `format`.

Bramka `check:widget-fidelity` wymaga parytetu edytor↔render dla każdego nowego widgetu.

---

## 7. Guest mode i widoczność publiczna

Swapcard: `Guest mode` (publiczny landing) + `Guests visibility` (co widzi
niezalogowany). NES ma już dwie warstwy, które to pokrywają:
`events.visibility` (`public|members`) + `min_tier_rank`, oraz widoczność stron
(`pages.status`, `seo_noindex`, harmonogram publikacji).

Do zrobienia: **jedna macierz widoczności per wydarzenie** — wiersze: sekcje
(agenda, prelegenci, partnerzy, uczestnicy, nagrania, dokumenty), kolumny:
gość / zarejestrowany / grupa / warstwa. Uwaga z zrzutu 3.1: u Swapcarda `Guests`
występuje w `Targeted groups` **obok** grup uczestników, czyli gość jest pełnoprawną
grupą docelową, a nie „stanem zerowym" — nasza macierz musi mieć dla niego wiersz,
nie wyjątek w kodzie. Wzorzec UI: `AccessSettingsPane.tsx`
i `ClubPermissionsTab.tsx`. Ostrzeżenie z modułu klubów obowiązuje tu wprost:
przy `chatham_house = true` lista uczestników i nagranie **nie mogą** trafić do
trybu gościa ani do robota (`forceNoindex`).

---

## 8. Etapy wdrożenia

| Etap                                             | Zakres                                                                                                                                                                                                                                                 | Kryterium odbioru                                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1** Szkielet                                  | grupa `events` w `adminNav`, `/admin/events` (lista + KPI), `/admin/events/$eventId` (layout + sub-nav + `Outlet`), `/general` przeniesione z dzisiejszego dialogu, redirect z `/admin/community/events`                                               | pełny CRUD działa z nowej powierzchni; stara trasa przekierowuje; `check:i18n-hardcoded` czysty                                                                                                                                 |
| **E2** Rodzaje                                   | `event_types` + `/admin/events/types` + kreator „nowe wydarzenie z rodzaju"                                                                                                                                                                            | utworzenie kongresu zakłada podstrony i włącza moduły jednym kliknięciem                                                                                                                                                        |
| **E3** Strony i menu                             | `event_pages` + `/pages` (drzewo, kolejność, ikony, widoczność), oparte na `pages`/builderze                                                                                                                                                           | podstrona wydarzenia powstaje i publikuje się bez wejścia w `/admin/pages`                                                                                                                                                      |
| **E4** Agenda i sesje                            | `event_people` (osoba bez konta!), `event_sessions`, role prelegentów, zapisy na sesję z limitem i blokadą kolizji czasowej, skrzynka interakcji (czat / Q&A / ankiety — silniki już są), oceny sesji, `/agenda`, `event-schedule` z `source: "event"` | agenda dwudniowa z 30 sesjami zarządzalna z panelu; prelegent bez konta da się wpisać; zapis na dwie sesje o tej samej godzinie jest **odrzucany serwerowo**; widget renderuje z bazy; oceny zasilają `speaker_profiles.rating` |
| **E5** Grupy, rejestracja, zgody, bilety         | `event_groups` + `event_capabilities()`, `event_registration_forms`, `event_registrations`, `event_ticket_types` (z `group_id`), `event_terms` + akceptacje; `/groups` + `/registration` + `/tickets` + `/terms`                                       | oba przebiegi działają (RSVP i formularz z akceptacją); **typ biletu nadaje grupę**; zgoda na przekazanie danych partnerowi zebrana w formularzu; pgtap na uprawnieniach i na zgodach                                           |
| **E6** Sponsorzy i spotkania                     | `event_sponsor_tiers` + `event_sponsors` (z `crm_companies`), rozszerzenie `AdTargeting`/`AdPosition` o wydarzenie i grupy, panel `/meetings`                                                                                                          | poziomy sponsorskie z logotypami z CRM; reklama wydarzenia celowana w grupę, z odsłonami i klikami z `ad_events`; sloty 1-1 z limitami                                                                                          |
| **E7** Onsite (wymagany), komunikacja, analityka | `event_checkins`, `event_badge_templates` + druk, `event_leads` z RLS per firma, sekwencje e-mail, dashboard                                                                                                                                           | check-in QR odporny na brak sieci i na powtórny skan (`UNIQUE`); badge z nazwą grupy i typem wejściówki; partner widzi **wyłącznie własne** leady; dashboard pokazuje frekwencję per sesja                                      |

**Stan etapów na 2026-08-26** (szczegóły i ścieżki plików: §12, dziennik zrzutów
→ „Stan wdrożenia — 2026-08-26"):

- **E1 — zrobione:** studio wydarzenia jako osobna powierzchnia
  `/admin/events/<id>/<sekcja>` z własnym sidebarem wydarzenia, wyszukiwarką
  sekcji i górnym paskiem (chip statusu jako przełącznik, podgląd, publikacja);
  ekran „Informacje ogólne" 1:1 ze wzorcem wraz z kolumnami i RPC; publikacja
  przez `admin_event_set_status`; podgląd na żywo z niezapisanego szkicu;
  oba wejścia prowadzą do studia („utwórz wydarzenie" po zapisie, edycja z listy
  wydarzeń zamiast dialogu w `/admin/community/events`).
  **E1 — zostało:** przekierowanie ze starej trasy `/admin/community/events` —
  grupa `events` w `adminNav` już jest (`src/lib/admin/adminNav.ts`) i stara
  pozycja z niej zniknęła, ale sama trasa **żyje dalej** jako druga powierzchnia,
  a nie alias; odzwierciedlenie nowych pól na froncie publicznym (adres strukturalny w
  `schema.org/Event` i `AddToCalendar`, nagłówek wideo, hashtag, języki treści,
  adres wsparcia).
  Teksty studia idą — zgodnie z ryzykiem nr 7 z §9 — wyłącznie przez overlay
  `src/lib/i18n-admin-events.ts` (gałęzie `adminEvents.studio.*`,
  `adminEvents.general.*`, `adminEvents.branding.*`), w obu językach.
- **E3 — zrobione:** ekran „Strony i menu" (`EventPagesMenuPanel.tsx`) z układem
  strony głównej (`standard`/`advanced`), trybem prezentacji (`list`/`grid`),
  listą podstron czytaną z poddrzewa `pages` po `events.root_page_id`
  (`src/lib/events/eventPagesApi.ts`) i podziałem na „strony w menu" / „pozostałe".
  **E3 — zostało:** tabela `event_pages` (§4.7) — bez niej podział menu jest
  liczony z `pages.menu_order`, a ikony, kolory, kolejność i widoczność per grupa
  nie mają gdzie mieszkać; zakładanie podstrony z gotowym
  `parent_id = events.root_page_id` (dziś przycisk prowadzi do zwykłego
  `/admin/pages/new`); grupy menu; preset startowy dla `home_design = standard`;
  widget `event-menu` z wariantami `list`/`grid` na froncie — dopóki go nie ma,
  `pages_display_mode` widać wyłącznie w podglądzie studia.

**Korekta zakresu po partii 17 zrzutów (2026-08-26).** Cztery inwentarze 41 zrzutów
wzorca (`docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md`, „Partia 17") zmieniają zakres
czterech etapów. Nie dodają nowych funkcji — zmieniają **liczbę adresów**, pod którymi
te funkcje mają stać, a to jest praca, którą trzeba zaplanować, nie doczepić.

- **E1 (szkielet) — zakres poszerzony, kryterium odbioru rozszerzone.** Sidebar studia
  przechodzi z **piętnastu sekcji na płasko** na **grupy z podpozycjami**
  (`src/lib/events/eventStudioNav.ts`), a dzisiejsze zakładki wewnątrz sekcji stają się
  **osobnymi adresami** (`src/components/admin/events/studio/EventStudioModuleSections.tsx`).
  Uzasadnienie w §17.3 dziennika: u wzorca każda podstrona ma własny adres, a zakładka
  z `Tabs defaultValue` nie jest w adresie, więc nie da się jej ani podlinkować, ani
  otworzyć w nowej karcie, ani wskazać w zgłoszeniu do wsparcia. Do kryterium odbioru
  dochodzi: **każdy podekran studia ma adres**, a wejście w szczegół rekordu **zostawia
  podświetlenie na pozycji listy** i wraca odnośnikiem w treści, nie trzecim poziomem
  sidebara. Dochodzi też pozycja `Help`, której nie mamy w żadnej formie.
- **E4 (agenda i sesje) — zakres poszerzony.** `Content` to u wzorca **siedem** ekranów
  (`People`, `Sessions`, `Exhibitors`, `Items`, `Documents & Links`, `Feed channels`,
  `Discussions`), z których nasza sekcja „Treść" pokrywa **jeden** (`Sessions`), i to
  zakładkami. Po odjęciu tego, co jest poza zakresem §0.4 (`Exhibitors`, `Items`),
  do E4 wchodzą jako **osobne adresy**: `People` (kartoteka `event_people` — już była
  w zakresie), `Documents & Links`, `Feed channels`, `Discussions`. Dwa ostatnie idą
  po wzorcach z klubów (`club_board_notices`, `club_groups`/`club_threads`), nie jako
  drugi silnik. Sesja przestaje być dialogiem: u wzorca to **ekran z ośmioma
  zakładkami** pod własnym adresem (`…/plannings/<id>`), więc E4 dostaje trasę szczegółu
  sesji z odnośnikiem `‹ powrót do sesji`.
- **E5 (grupy, rejestracja, zgody, bilety) — zakres poszerzony.** `In-App registration`
  to u wzorca **cztery** adresy: `Registration settings` · `Tickets` · `Codes` · `Form`.
  Nasza sekcja „Zapisy" ma trzy zakładki i żadnej z nich nie ma w adresie. Dwa skutki:
  ekran **`Registration settings`** (najprawdopodobniej miejsce, w którym wzorzec
  rozstrzyga odpowiednik `events.registration_flow`) trzeba dobrać zrzutem, zanim
  powstanie (§17.6 pkt 12); **`Codes`** przestaje być pytaniem otwartym o architekturę —
  z §10 pkt 5 zostaje wykonanie: zakres „to wydarzenie / ten typ biletu" na istniejącym
  `/admin/coupons` plus wejście z poziomu wydarzenia. Ekranu kodów po utworzeniu kodu
  nadal nie widzieliśmy (§17.6 pkt 13), więc kolumny tabeli i formularz tworzenia są
  do domknięcia zrzutem.
- **E6 (sponsorzy i spotkania) — zakres bez zmian, granica potwierdzona.** Dziewięć
  zrzutów kartoteki firm wydarzenia (`18`–`30`) opisuje ekrany **poza zakresem** decyzją
  §0.4. Zapisane w §2.2 wprost, bo to jest dokładnie ta część, którą przy porównaniu ze
  zrzutami najłatwiej wziąć za zaległość. E6 zostaje przy poziomach sponsorskich
  i logotypach z `crm_companies`.

---

## 9. Ryzyka

1. **Drugi silnik stron** — największe. Mitygacja: §0.1, `event_pages` jako mapowanie
   na `pages`, zero własnego renderu.
2. **Rozjazd reguł widoczności** — moduł klubów już to przeżył. Mitygacja: jedna
   funkcja `event_capabilities()`, każdy RPC ją woła; `check:gate-coverage`.
3. **Wyciek `join_url` / `stream_url`** — nowe kolumny linków muszą powtórzyć wzorzec
   grantu kolumnowego, inaczej klient odczyta je zwykłym `SELECT`.
4. **`club_events` vs `events`** — dwa kalendarze istnieją świadomie (`anchor_event_id`).
   Event Builder dotyczy `events`; nie scalamy tego przy okazji.
5. **Rozmiar tras** — dzisiejszy plik ma 580 linii przy jednym ekranie. Piętnaście
   sekcji w jednym pliku jest niedopuszczalne: każda sekcja = własna trasa + własne
   organizmy w `src/components/admin/events/`.
6. **Kartoteka osób wydarzenia obok `auth.users`** (§4.11) — to nowa oś tożsamości
   i największe ryzyko modelowe po stronie danych osobowych. Mitygacja: jedno
   dopasowanie po `email_norm` przy pierwszym logowaniu, retencja rekordów bez
   konta opisana w polityce prywatności, i **zakaz** wysyłki marketingowej do
   osób, które nie przeszły rejestracji (wpisane przez organizatora).
7. **i18n** — każdy nowy tekst przez overlay (`src/lib/i18n-admin-events.ts`),
   nigdy `isPl ? … : …`; bramka `check:i18n-hardcoded` to wyłapie.

---

## 10. Pytania otwarte

Pięć pytań pierwotnych zostało rozstrzygniętych — decyzje w **§0.4**. Otwarte
pozostaje to, co wyszło z partii 2 i 3 zrzutów i czego nie da się rozstrzygnąć
z samych ekranów Swapcarda:

1. **Skaner leadów: kto skanuje?** Partner obsługujący stoisko musi mieć aplikację
   (telefon) i konto z uprawnieniem. Czy to obsada firmy z `organization_seats`
   (wymaga, żeby partner był organizacją w platformie), czy prostsze rozwiązanie:
   **token urządzenia** wydany na czas wydarzenia, bez kont per osoba?
   Rekomendacja: token urządzenia — partner na jedno wydarzenie nie potrzebuje
   struktury organizacyjnej, a token łatwiej odebrać po wydarzeniu.
2. **Druk badge'y: gdzie?** Druk lokalny z przeglądarki (PDF na drukarkę etykiet)
   czy usługa druku on-site? To decyduje, czy `event_badge_templates.template`
   musi być drukowalny bez internetu.
3. **Formularz rejestracji: kreator czy stałe zestawy pól?** Pełny kreator (typy
   pytań, warunki, walidacje) to osobny produkt. Rekomendacja na start: stały
   zestaw pól + pytania kwalifikacyjne jako lista (tekst / wybór / wielokrotny
   wybór) — a kreator dopiero, gdy okaże się potrzebny.
4. **Widget rejestracji do zagnieżdżenia na stronach partnerów** (zrzut 3.4) — czy
   jest potrzebny w pierwszej wersji? To osobna powierzchnia bezpieczeństwa
   (CORS, iframe, klucz publiczny), więc proponuję etap po E5.
5. **Kody dostępu** — czy wykorzystujemy istniejący moduł `/admin/coupons`
   (kampanie, realizacje, analityka), czy kody wydarzenia mają być osobnym bytem?
   Rekomendacja: `/admin/coupons` z zakresem „to wydarzenie / ten typ biletu".

---

## 11. Dziennik zrzutów ekranu

Mapowanie ekran-po-ekranie (co widać → co to znaczy → gdzie to ma powstać) żyje
w `docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md`. Każda nowa partia zrzutów
dopisuje tam sekcję i, jeśli trzeba, aktualizuje tabele §2 i backlog §8 tutaj.

Osobno powstał **inwentarz wykonawczy interfejsu**:
`docs/INWENTARZ_ELEMENTOW_UI_SWAPCARD_2026-08-23.md` — każde pole, etykieta
(dosłownie po angielsku), przełącznik, kolumna tabeli, komunikat walidacji,
limit znaków i wymóg obrazka ze wszystkich ~70 zrzutów, plus sześć załączników
przekrojowych (wymogi obrazów, limity znaków, zbiory statusów, katalog kolumn
tabel, lista funkcji płatnych Swapcarda, wszystkie komunikaty walidacji).
Ten dokument jest listą kontrolną do implementacji; dziennik mapowania jest
wykładnią „co to znaczy dla NES".

---

## 12. Dziennik wdrożenia

Jedna sekcja = jedna iteracja kodu. Zapisujemy **co powstało**, **jakie decyzje
projektowe zapadły przy okazji** (bo one przeżyją kod) i **co zostało długiem**.
Mapowanie ekran-po-ekranie na ścieżki w repo żyje w dzienniku zrzutów
(`docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md`, sekcja „Stan wdrożenia").

### 2026-08-26 — studio wydarzenia, informacje ogólne, strony i menu, grupy, branding, pulpit

**Co powstało**

1. **Studio wydarzenia** — osobna powierzchnia `/admin/events/<id>/<sekcja>`
   z piętnastoma sekcjami (`src/routes/admin.events_.$eventId.tsx` + pliki
   sekcji; model nawigacji w `src/lib/events/eventStudioNav.ts`). Sidebar należy
   do **wydarzenia**, nie do panelu; górny pasek niesie nazwę, chip statusu jako
   przełącznik, przełącznik podglądu i publikację
   (`src/components/admin/events/studio/EventStudioTopBar.tsx`). Nad sidebarem —
   wyszukiwarka „szukaj w wydarzeniu", filtrująca po etykiecie **i po słowach
   kluczowych** (`bilety` prowadzą do Zapisów, `QR` do Odprawy).
2. **Podgląd na żywo** — dok przypięty do ramy studia
   (`studio/EventStudioPreview.tsx`), rysujący stronę wydarzenia z
   **niezapisanego** szkicu (`studio/EventStudioPreviewContext.tsx`,
   `studio/EventPreviewCanvas.tsx`), z przełącznikiem desktop/mobile i skalą
   liczoną `transform: scale` z **mierzonej** szerokości doku.
3. **Informacje ogólne** — pełny ekran 1:1 ze wzorcem
   (`organisms/EventGeneralPanel.tsx`, logika czysta w
   `src/lib/events/eventGeneralDraft.ts` i `eventLanguages.ts`): nazwa z
   przełącznikiem PL/EN, adres publiczny pod kłódką, `Begins`/`Ends`/strefa,
   okładka + nagłówek wideo, format, adres strukturalny z „wyczyść lokalizację",
   informacje, hashtag X, języki treści, adres wsparcia, Event ID z kopiowaniem.
4. **Strony i menu** — `organisms/EventPagesMenuPanel.tsx` +
   `src/lib/events/eventPagesApi.ts`: układ strony głównej, tryb prezentacji,
   lista podstron z poddrzewa `pages` po `events.root_page_id`, zakładki
   „strony w menu" / „pozostałe".
5. **Grupy i uprawnienia** — `organisms/EventGroupsPermissionsPanel.tsx`:
   istniejący `EventGroupsPanel` + tryb gościa + widoczność dla niezapisanych
   - ostrzeżenie o kolizji z Chatham House.
6. **Branding** — `organisms/EventBrandingPanel.tsx` +
   `src/lib/events/eventBrandingDraft.ts`: tryb jasny/ciemny, pięć slotów
   kolorów, obraz tła, „przywróć branding społeczności".
7. **Pulpit** — `organisms/EventOverviewPanel.tsx`: kafle z żywych RPC i lista
   kroków liczona ze stanu danych.
8. **Sekcje montujące istniejące panele** — rejestracja, treść, spotkania,
   na miejscu, sponsorzy, regulaminy (`studio/EventStudioModuleSections.tsx`);
   cztery sekcje bez zakresu per wydarzenie jako drogowskazy
   (`studio/EventStudioExternalSection.tsx`).
9. **Migracja** `supabase/migrations/20260826090000_event_studio_general.sql`
   — kolumny i cztery RPC; różnice względem propozycji §4.1 opisane tam przy
   poszczególnych liniach.
10. **Wejścia** — „utwórz wydarzenie" prowadzi po zapisie do studia
    (`src/routes/admin.events.new.tsx`), edycja z listy wydarzeń też
    (`organisms/EventsListManager.tsx`) zamiast do dialogu w
    `/admin/community/events`.

Testy jednostkowe warstwy czystej: `src/lib/events/__tests__/eventStudioNav.test.ts`,
`eventGeneralDraft.test.ts`, `eventBrandingDraft.test.ts`, `eventPagesApi.test.ts`.

**Decyzje projektowe, które zapadły przy okazji**

- **Studio wypięte z układu `/admin/events`.** Podkreślnik w `events_` sprawia,
  że studio nie dziedziczy paska `EventsSubNav`. Dwa poziomy nawigacji naraz
  odpowiadałyby na dwa różne pytania „gdzie jestem" i zabierały połowę
  szerokości ekranowi z osiemnastoma polami. Wydarzenie na czas pracy nad nim
  przejmuje lewy pas — dokładnie jak we wzorcu.
- **Podgląd rysujemy, nie osadzamy `<iframe>` strony publicznej.** Ramka
  z adresem publicznym pokazuje stan **zapisany**; pytanie brzmi „jak będzie
  wyglądać to, co właśnie zmieniam". Odpowiedzieć na nie może wyłącznie rysunek
  z tego samego szkicu, który karmi formularz.
- **Kanwa podglądu nie renderuje widgetów buildera.** To szkic układu, nie drugi
  renderer strony — ryzyko nr 1 z §9. Konsekwencję (uproszczenie dla
  `home_design = advanced`) przyjmujemy świadomie.
- **Zapis idzie przez RPC, nie przez `UPDATE` z klienta.** Slug ma unikalność
  w tenancie (klient nie sprawdzi kolizji bez wyścigu), `ends_at > starts_at`
  jest warunkiem bazy, a nagłówek wideo bez okładki jest błędem produktowym.
  Odmowa ma być jednym, nazwanym błędem, a nie trzema różnymi `23514`
  (`src/lib/events/adminEventStudioErrors.ts` tłumaczy klucz na zdanie).
- **Klucz nieobecny w payloadzie = pole nietknięte.** Ten sam
  `admin_event_general_save` obsługuje ekran w całości i zapisy cząstkowe
  z innych ekranów (`pages_display_mode` ze „Stron i menu", `guest_mode`
  z „Grup i uprawnień"). Dwa RPC na tę samą kolumnę to dwa miejsca na regułę.
- **Klucz nieobecny w brandingu = dziedziczenie.** „Przywróć branding
  społeczności" **usuwa** klucze zamiast zapisywać dzisiejsze kolory motywu —
  inaczej wydarzenie z zapisaną kopią przestałoby reagować na zmianę marki.
  Zbiór kluczy jest zamknięty białą listą, bo `branding jsonb` bez niej byłby
  wstrzyknięciem dowolnej wartości do tokenów CSS renderowanych w SSR.
- **Jeden klucz cache na wydarzenie** (`src/lib/events/useAdminEventDetail.ts`).
  Cztery ekrany czytające ten sam wiersz osobno dałyby cztery odpowiedzi,
  które po zapisie rozjeżdżają się w czasie; zapis unieważnia także listę
  modułu i starą listę w sekcji społeczności.
- **Liczby na pulpicie są prawdziwe albo nie ma ich wcale.** Wzorzec pokazuje
  48 820 rejestracji przy wydarzeniu z dwudziestoma jeden osobami — to uczy nie
  ufać żadnej liczbie na ekranie. Kafel bez danych pokazuje kreskę, nie zero.
  Lista kroków liczy się ze stanu danych, nie z checklisty do odklikania.
- **Sekcje bez własnego zakresu prowadzą do modułu globalnego, nie do jego
  kopii.** Kampanie, integracje i analityka są wspólne dla serwisu; duplikat per
  wydarzenie to dwa miejsca do utrzymania i dwa źródła prawdy o tym samym kluczu API.
- **Stare trasy modułu zostają nietknięte.** `/admin/events/agenda` i siostrzane
  nadal działają ze swoimi droplistami. Studio jest **drugą drogą** do tych
  samych paneli, a nie ich zamiennikiem — kto pracuje na kilku wydarzeniach
  naraz, nie musi przez nie przechodzić.
- **`format` i `guest_mode` odbiegają od propozycji §4.1** — wartości
  `onsite/online/hybrid` zamiast `virtual/in_person/hybrid` (jeden słownik
  z `event_types.default_format`) i enum tekstowy `hidden/teaser/full` zamiast
  `boolean` (bo ekran 1.5 pyta o dwie rzeczy naraz: czy widać i **co** widać).

**Dług**

1. **`event_pages` nadal nie istnieje** (§4.7). Podział „strony w menu /
   pozostałe" liczy się tymczasowo z `pages.menu_order` (`splitEventPages`
   w `src/lib/events/eventPagesApi.ts`). Brak ikon, kolorów, kolejności
   i widoczności per grupa dla pozycji menu; brak etykiet menu niezależnych
   od tytułów stron.
2. **Nowe kolumny są zapisywane, ale front publiczny ich jeszcze nie czyta** —
   adres strukturalny, nagłówek wideo, hashtag, języki treści, adres wsparcia,
   `home_design` i `pages_display_mode` widać dziś wyłącznie w podglądzie
   studia. Brakuje też widgetu `event-menu` i wstrzyknięcia brandingu wydarzenia
   w SSR poddrzewa stron.
3. **Sekcje Komunikacja / Integracje / Analityka / Funkcje dodatkowe** odsyłają
   do modułów globalnych — nie mają zakresu per wydarzenie. Kolumna
   `events.features` istnieje, ekranu przełączników nie ma.
4. **Szuflada edycji grupy ze wzorca ma cztery zakładki** (`General`,
   `Exhibitor profile`, `Lead generation`, `Members`). Dwie środkowe dotyczą
   wystawców, czyli zakresu wyłączonego decyzją §0.4 — nasza
   (`src/components/admin/events/molecules/EventGroupDialog.tsx`) ma dwie:
   „Ogólne" i „Członkowie". To różnica zakresu, nie niedoróbka, ale musi być
   zapisana, żeby nie wracała jako zgłoszenie braku.
5. **Podgląd na żywo rysuje szkic układu, a nie kompozycję buildera** — dla
   `home_design = advanced` pokazuje uproszczenie.
6. **Ostrzeżenie o kolizji Chatham House z trybem gościa jest informacyjne** —
   twardej bramki (`event_capabilities()` + test pgtap) nadal nie ma.
7. **Przekierowanie ze starej trasy.** Grupa `events` w `adminNav` już istnieje
   (`src/lib/admin/adminNav.ts`) i nie ma w niej pozycji `community/events`, ale
   sama trasa `/admin/community/events` żyje dalej jako druga powierzchnia
   edycji wydarzenia — a kryterium odbioru E1 mówi „stara trasa przekierowuje".
   Dopóki obie działają, istnieją dwa formularze na te same kolumny.

### 2026-08-26 (partia 2) — nawigacja dwupoziomowa, podstrony wydarzenia, front publiczny

**Co powstało**

1. **41 zrzutów wzorca weszło do repozytorium** (`docs/zrzuty/swapcard-2026-08-23/`,
   nazwy opisowe, README z zakresem) i zostało zinwentaryzowane ekran po ekranie.
   Wykładnia: partia 17 dziennika zrzutów.
2. **Sidebar studia przeszedł z płaskich piętnastu sekcji na grupy z podpozycjami**,
   a dzisiejsze zakładki wewnątrz sekcji stały się osobnymi adresami: 29 liści,
   pięć grup (`Kreator wydarzenia`, `Rejestracja w aplikacji`, `Treść`, `Spotkania`,
   `Na miejscu`), 22 nowe trasy, trasy indeksowe grup przekierowują na pierwsze
   dziecko (`src/lib/events/eventStudioNav.ts` + `src/routes/admin.events_.$eventId.*`).
3. **Nagłówek sidebara** według wzorca: powrót do listy, nazwa wydarzenia, termin
   w strefie wydarzenia, `Otwórz wydarzenie`, dopiero potem wyszukiwarka.
4. **`event_pages`** — mapowanie strona → menu wydarzenia (ikona, kolor, własna
   etykieta PL/EN, kolejność w tym menu, widoczność per grupa) z pięcioma RPC
   administracyjnymi i publicznym `event_menu`
   (`supabase/migrations/20260826120000_event_pages_and_public_columns.sql`).
   Ekran „Strony i menu" zarządza całością, w tym tworzeniem podstrony jednym
   ruchem (korzeń + strona + przypięcie w jednej transakcji).
5. **Front publiczny czyta nowe kolumny**: nagłówek wideo (degraduje do okładki),
   adres strukturalny w sekcji `map` z odnośnikiem do mapy, języki treści,
   hashtag i adres wsparcia w sekcji `contact`, branding wydarzenia jako zmienne
   CSS w zakresie strony wydarzenia, menu wydarzenia w dwóch prezentacjach,
   `PostalAddress` w `schema.org/Event`.
6. **Analityka wydarzenia** złożona z żywych RPC (zapisy, program, spotkania,
   odprawa) zamiast drogowskazu — `src/components/admin/events/organisms/EventAnalyticsPanel.tsx`.

**Decyzje projektowe**

1. **Każda podstrona ma własny adres.** Zakładki wewnątrz jednej trasy nie dają
   się podlinkować, otworzyć w nowej karcie ani wskazać w zgłoszeniu do wsparcia,
   a wzorzec nawiguje po sidebarze. To była rozbieżność systemowa, nie kosmetyczna.
2. **Prawdziwą przyczyną „front nie czyta nowych kolumn" był GRANT KOLUMNOWY.**
   `events` ma jawną listę kolumn czytelnych dla `anon`/`authenticated` (odcięcie
   `join_url` i `recording_url`), a kolumna dopisana ALTER-em do tej listy nie
   wchodzi — `SELECT` kończył się odmową uprawnień, nie pustą wartością. Grant
   rozszerzamy przyrostowo; odtworzenie całej listy jest dokładnie tym ruchem,
   którym gubi się odcięcie linków do transmisji.
3. **Informacje praktyczne rozdzielone na `map` i `contact`,** a nie zlane w jedną
   kartę: `guest_mode = full` znaczy „wszystko poza kontaktami", a widoczność
   trzyma się per klucz sekcji. Jedna karta musiałaby wybrać jedną widoczność —
   i wybranie kontaktowej ukryłoby adres miejsca przed gościem, który dopiero
   decyduje, czy jechać.
4. **Widoczność pozycji menu per grupa rozstrzyga baza, nie komponent.** Filtr
   w kliencie oznaczałby, że pełna lista pozycji (razem z nazwami stron dla
   partnerów) jedzie do każdego gościa.
5. **Nazwa wydarzenia zniknęła z paska górnego,** bo stoi w nagłówku sidebara —
   ten sam napis dwa razy na jednym ekranie przestaje być czytany w obu miejscach.
6. **Etykiety podpozycji pochodzą ze słowników modułów** (`adminEventRegistration`,
   `adminEventAgenda`, `adminEventMeetings`, `adminEventOnsite`), a nie z drugiej
   kopii w `adminEvents`. Dwa klucze na jeden napis to zaproszenie do rozjazdu.
7. **`admin_event_pages_list` pokazuje także strony NIEPRZYPIĘTE** z poddrzewa
   korzenia (`id IS NULL`). Lista, która ich nie pokazuje, każe redaktorowi
   założyć te strony drugi raz.
8. **Odpięcie pozycji menu nie usuwa strony.** Pomyłkowe odpięcie kosztuje jedno
   kliknięcie, pomyłkowe usunięcie strony kosztuje treść, historię i SEO.

**Dług**

1. **Ekrany wzorca, których nie mamy jako podpozycji:** `Content › People`,
   `Items`, `Feed channels`, `Discussions`, `Exhibitors` (+ `Exhibitor settings`),
   `In-App registration › Registration settings`, `Codes`, oraz pozycja `Help`.
   Wystawcy (`Exhibitors`, `Items`, `Exhibitor Marketplace`) są **poza zakresem**
   decyzją §0.4 — reszta jest realnym brakiem.
2. **Podpozycji pięciu grup wzorca nadal nie znamy** (`Meetings`,
   `Communications`, `Onsite`, `Integrations`, `Analytics` — na wszystkich 41
   zrzutach zwinięte). Nasze podziały tych grup są własne, nie odwzorowane.
3. **Komunikacja i Integracje zostają drogowskazami.** Obie wymagają decyzji
   produktowej (model celowania kampanii; zakres integracji per wydarzenie),
   a nie zgadywania.
4. **`Funkcje dodatkowe` nadal nie bramkują niczego.** Kolumna `events.features`
   istnieje, ale przełącznik, który nie wyłącza sekcji ani w studiu, ani na
   stronie publicznej, byłby przełącznikiem kłamiącym.
5. **Podgląd na żywo nie rysuje reklamy ani nazwanych poziomów sponsorów**
   i nie ma kontekstowych odnośników „Edytuj tę stronę" / „Edytuj tego wystawcę",
   które wzorzec pokazuje w trybie podglądu (zrzuty 38–41).
6. **Wzorzec nie ma przycisku `Save`** — zapisuje natychmiast; nasze ekrany studia
   mają stopkę „Zapisz zmiany". To świadoma rozbieżność (zapis zmieniający adres
   publiczny i termin nie ma być efektem ubocznym pisania), ale warta rewizji na
   ekranach, gdzie zapisuje się jeden przełącznik.

### 2026-08-26 (partia 3) — ustawienia rejestracji, bramkowanie modułów, wycofanie starej trasy

**Co powstało**

1. **`Rejestracja w aplikacji › Ustawienia`** — dziesięć parametrów, które do tej
   zmiany dawały się ustawić **wyłącznie** w starym dialogu
   `/admin/community/events`: tryb zapisów, przebieg, adres zewnętrzny,
   widoczność, limit miejsc, próg warstwy, przedsprzedaż (ranga + moment
   otwarcia), cena i waluta wejściówki, zasada Chatham House oraz adresy
   transmisji i nagrania
   (`src/components/admin/events/organisms/EventRegistrationSettingsPanel.tsx`,
   reguły czyste w `src/lib/events/registrationSettingsDraft.ts`).
2. **`admin_event_general_save` przyjmuje te kolumny**, a `admin_event_detail`
   dokłada do odpowiedzi `join_url`, `recording_url`, `rsvp_opens_at`
   i `early_rsvp_rank`
   (`supabase/migrations/20260826150000_event_registration_settings_and_features.sql`).
3. **`admin_event_features_save`** z zamkniętą listą siedmiu modułów
   (`pages`, `registration`, `tickets`, `sessions`, `meetings`, `onsite`,
   `sponsors`), zapisujący do `events.features` **wyłącznie wyłączenia**.
4. **`Funkcje dodatkowe` bramkują naprawdę** — przełącznik chowa pozycję (albo
   całą grupę) z sidebara studia, a skład grupy liczy się z `EVENT_STUDIO_NAV`,
   nie z drugiej listy obok
   (`src/lib/events/eventFeatures.ts`,
   `src/components/admin/events/organisms/EventFeaturesPanel.tsx`).
   Trasa ukrytej sekcji **nadal odpowiada**: rama studia podstawia
   `EventStudioDisabledSection` — nazwę wyłączonego modułu, zdanie o tym, że dane
   zostały na miejscu, i przycisk do „Funkcji dodatkowych".
5. **`Treść › Prelegenci`** — jedyny ekran prelegentów, dotąd dostępny tylko ze
   starej trasy, wszedł do studia bez zmian w komponencie
   (`EventSpeakersManager` przyjmował `eventId` od początku).
6. **Ręczne wyzwolenie przypomnień** przeniesione na listę modułu
   (`EventsListManager`), a **`/admin/community/events` przekierowuje** na
   `/admin/events/list`; zakładka zniknęła z `CommunitySubNav`.
7. **`20260826170000_event_general_save_match_table_checks.sql`** dociąga RPC do
   CHECK-ów tabeli w czterech miejscach (patrz decyzja 2).

**Decyzje projektowe**

1. **Stara trasa dostała przekierowanie dopiero po inwentaryzacji tego, co
   trzymała sama.** Były to dwie rzeczy — ekran prelegentów i przypomnienia —
   i obie mają nowe miejsce, zanim stary adres przestał je pokazywać.
   Przekierowanie postawione wcześniej byłoby cichą utratą funkcji.
2. **Cztery reguły RPC były LUŹNIEJSZE niż CHECK-i tabeli**, czyli redaktor
   dostawał surowe `23514 violates check constraint` zamiast zdania po polsku:
   adres zewnętrzny sprawdzany tylko w trybie `external` (CHECK obowiązuje
   zawsze — a adres zostaje zapisany także wtedy, gdy tryb go nie używa),
   `capacity >= 0` przy CHECK-u `> 0`, cena `>= 0` przy CHECK-u `>= 100` groszy,
   waluta „dowolne trzy litery" przy zbiorze `{PLN, EUR}`. Migracja forward-only
   zrównuje obie strony; te same reguły stoją drugi raz w module czystym, więc
   ekran odrzuca wartość, nie czekając na odpowiedź bazy.
3. **`events.features` bramkuje STUDIO, nie stronę publiczną.** Widocznością dla
   uczestnika rządzi `event_page_sections` + `event_sections` — dwa przełączniki
   na tę samą rzecz to dwa miejsca, w których można ją wyłączyć, i jedno, które
   ktoś pamięta.
4. **Klucz nieobecny w `features` znaczy „moduł włączony".** Kolumna trzyma
   wyłącznie wyłączenia, bo przy zapisie kompletu flag moduł dodany w przyszłości
   znikałby każdemu wydarzeniu zapisanemu przed jego powstaniem. Ekran wysyła
   komplet siedmiu wartości (kontrakt „klucz pominięty = bez zmian" nie umiałby
   inaczej **włączyć** modułu z powrotem), a odsianie `true` robi RPC.
5. **Przypomnienia są akcją MODUŁU, nie wydarzenia.** `run_event_reminders()`
   przechodzi wszystkie wydarzenia z terminem w oknie powiadomienia — przycisk
   na ekranie jednego wydarzenia kłamałby o zasięgu.
6. **Bramka wyłączonego modułu stoi w jednym miejscu — w ramie studia.** Ten sam
   warunek dopisany do osiemnastu tras rozjechałby się przy pierwszym nowym
   ekranie: ktoś by o nim zapomniał i dostał sekcję, która chowa się w sidebarze,
   ale żyje pod adresem.
7. **Sekcja `Funkcje dodatkowe` nie jest celem żadnego przełącznika** — inaczej
   wyłączenie byłoby nieodwracalne z panelu. Pilnuje tego test.
8. **`Ustawienia rejestracji` nie karmią podglądu na żywo.** Dok rysuje wygląd
   strony wydarzenia; tryb zapisów decyduje, jaki formularz stoi za przyciskiem,
   a limit miejsc i próg warstwy to reguły dostępu liczone w bazie
   (`get_event_access`). Podpięcie ich obiecywałoby, że zobaczymy tam skutek
   zmiany — a podgląd renderuje szkic, nie sesję uczestnika o danej warstwie.

**Dług**

1. **Ekrany wzorca nadal bez odpowiednika:** `Content › People`, `Items`,
   `Feed channels`, `Discussions`, `In-App registration › Codes`, pozycja `Help`.
   Wystawcy pozostają poza zakresem decyzją §0.4.
2. **Podpozycji pięciu grup wzorca nadal nie znamy** (`Meetings`,
   `Communications`, `Onsite`, `Integrations`, `Analytics` — zwinięte na
   wszystkich 41 zrzutach).
3. **Komunikacja i Integracje zostają drogowskazami** — obie czekają na decyzję
   produktową, nie na kod.
4. ~~`check:sql-migration-replay` ma dwa czerwone testy~~ — **zamknięte przez
   `main`**. Para bliźniaków (`20260824090000_event_admin_only_guards.sql` +
   `20260825190728_…`, oba z `1586fc1`) czerwieniła się niezależnie od tej
   gałęzi; commit `935616c` na `main` ją rozwiązał i po scaleniu bramka jest
   zielona. Tym samym scaleniem zniknął jedyny czerwony `format:check`
   (`previewAuthStorage.ts` — plik nietknięty przez tę gałąź, doformatowany tutaj
   razem z jednym `prefer-const`, bo `bun run lint` w CI liczy oba).
5. **Podgląd na żywo** nadal nie rysuje reklamy ani nazwanych poziomów sponsorów
   i nie ma kontekstowych odnośników „Edytuj tę stronę" (zrzuty 38–41).
