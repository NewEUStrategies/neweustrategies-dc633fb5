# Event Builder — dedykowany moduł wydarzeń w panelu administracyjnym

Data: 2026-08-23 · Status: **specyfikacja w budowie (mapowanie, przed implementacją)**
Wzorzec referencyjny: **Swapcard Studio** (`studio.swapcard.com/event/<slug>/…`)
Dziennik zrzutów ekranu: `docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md`
Zakres tej iteracji: **inwentaryzacja + mapowanie + backlog**. Kod nie jest jeszcze pisany.

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

| Swapcard               | Zawartość ekranu                                                                                                                                                                                                                                               | Stan NES                             | Gdzie to jest / gdzie ma być                                                                                                                                         | Zadanie    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| General information    | nazwa, URL wydarzenia, `Begins`/`Ends`/`Time zone`, okładka, video header (YouTube ID), **Format: Hybrid / In-person / Virtual**, lokalizacja (adres/miasto/region/kod/kraj), Information (RTE), hashtag X, **Languages** (multi), support email, **Event ID** | 🟡                                   | jest: nazwa, slug, daty, strefa, `location`, `cover_url`, opisy PL/EN. brak: `format`, adres strukturalny, video header, hashtag, support email, jawny Event ID w UI | EB-101…107 |
| Pages & menu           | `Home page design: Advanced / Standard`, `Display mode: Grid / List`, **Pages** (`Menu pages` / `Other pages`) z ikoną, kolorem, kolejnością i widocznością                                                                                                    | 🔴 (silnik jest, powierzchni nie ma) | oprzeć na `pages.parent_id` + `menu_order` + `header_override` (`docs/MICROSITES.md`), nie nowy CRUD                                                                 | EB-201…206 |
| Groups & permissions   | grupy uczestników (`Exhibitors`, `Speakers`, `Attendees` z licznikami), edycja + reguły per grupa, `Guest mode`, `Guests visibility` → „Manage visibility"                                                                                                     | 🔴                                   | wzorzec 1:1 z `club_groups` + `club_capabilities()` (`docs/PROJEKT_MODUL_DISCUSSION_CLUB_V2_ADMIN_2026-08-07.md`)                                                    | EB-301…306 |
| Branding               | kolory, logotypy, fonty wydarzenia                                                                                                                                                                                                                             | 🟡                                   | globalne: `/admin/theme-design`, `/admin/theme-options`; per-organizacja wzorzec kolumn w `member_organizations` (logo H/V light/dark + `brand_*`)                   | EB-401…403 |
| Sponsors & advertising | sponsorzy, poziomy, kreacje reklamowe                                                                                                                                                                                                                          | 🟡                                   | widget `event-sponsors` (JSON) + globalny `/admin/ads` (`ad_events`)                                                                                                 | EB-501…504 |
| Terms                  | regulamin i zgody wydarzenia                                                                                                                                                                                                                                   | 🟡                                   | globalnie `user_consents` / `crm_consent_log` + `/regulamin`; per-wydarzenie brak                                                                                    | EB-601…603 |

### 2.2 Pozostałe sekcje sidebara (do rozpisania po kolejnych zrzutach)

| Swapcard                               | Stan NES | Najbliższy istniejący klocek                                                                                                        | Zadanie |
| -------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- |
| In-App registration                    | 🟡       | `rsvp_event`, bilety (`ticket*.ts`), `plan_ticket_claims`, `admin.users.invitations`, `onboarding-form`/`register-form` w builderze | EB-7xx  |
| Content (sesje, prelegenci, dokumenty) | 🟡       | `event_speakers` + `speaker_profiles` ✅; sesje tylko w JSON widgetu 🔴; dokumenty → wzorzec `club_documents`                       | EB-8xx  |
| Exhibitor Marketplace                  | 🔴       | `member_organizations` (branding + miejsca) + `crm_companies` + `/admin/pricing`                                                    | EB-9xx  |
| Meetings                               | ✅ rdzeń | `meeting_slots.event_id`, `meeting_bookings`, widget `meeting-booking` — brak panelu (siatka slotów, limity, reguły matchmakingu)   | EB-10xx |
| Communications                         | 🟡       | `/admin/newsletter` (kampanie, szablony), powiadomienia community, `run_event_reminders()`                                          | EB-11xx |
| Onsite                                 | 🔴       | bilet z QR (`src/lib/events/ticketCode.ts`) istnieje, **skanera/check-inu/badge'y nie ma**                                          | EB-12xx |
| Integrations                           | 🟡       | `/admin/integrations` (globalne) — brak zakresu per wydarzenie                                                                      | EB-13xx |
| Analytics                              | 🟡       | `/admin/analytics`, `analytics_events`, `domain_events` — brak dashboardu wydarzenia                                                | EB-14xx |
| Add-on features                        | 🔴       | odpowiednik: przełączniki modułów (`fetchCommunityModules`) → per wydarzenie                                                        | EB-15xx |
| Publish event / Preview event          | 🟡       | `events.status` (`draft/published/cancelled`) + `/preview/$token` dla treści                                                        | EB-16xx |

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
  ├── /exhibitors                      Exhibitor Marketplace / wystawcy
  ├── /sponsors                        Sponsors & advertising
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
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'virtual'
    CHECK (format IN ('virtual','in_person','hybrid')),
  ADD COLUMN IF NOT EXISTS type_key text,              -- → event_types.key (§5)
  ADD COLUMN IF NOT EXISTS street_address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS video_header_platform text,  -- youtube | vimeo | …
  ADD COLUMN IF NOT EXISTS video_header_id text,
  ADD COLUMN IF NOT EXISTS social_hashtag text,
  ADD COLUMN IF NOT EXISTS support_email text,
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{pl,en}',
  ADD COLUMN IF NOT EXISTS guest_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_design text NOT NULL DEFAULT 'standard'
    CHECK (home_design IN ('standard','advanced')),
  ADD COLUMN IF NOT EXISTS pages_display_mode text NOT NULL DEFAULT 'list'
    CHECK (pages_display_mode IN ('list','grid')),
  ADD COLUMN IF NOT EXISTS root_page_id uuid REFERENCES public.pages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}'::jsonb;  -- add-on features

-- §4.2 SESJE (agenda z JSON-a do bazy — §0.2)
event_sessions (
  id, tenant_id, event_id → events ON DELETE CASCADE,
  day_index int NOT NULL DEFAULT 0, day_date date,
  starts_at timestamptz, ends_at timestamptz,          -- albo time_start/time_end + day_date
  kind text CHECK (kind IN ('session','keynote','panel','break','workshop','networking')),
  title_pl/title_en, description_pl/description_en,
  room text, track text, capacity int, stream_url text,  -- stream_url: grant kolumnowy!
  visibility text, min_tier_rank int, sort_order int,
  status text CHECK (status IN ('draft','published','cancelled')),
  created_by, created_at, updated_at,
  UNIQUE (event_id, day_index, sort_order)
)
event_session_speakers (session_id, user_id, role text, sort_order)
event_session_attendance (session_id, user_id, status)   -- „moja agenda" + frekwencja

-- §4.3 GRUPY I UPRAWNIENIA (wzorzec club_groups + club_capabilities)
event_groups (
  id, tenant_id, event_id, key text,                   -- 'attendees' | 'speakers' | 'exhibitors' | …
  name_pl/name_en, color, icon, sort_order,
  can_meet boolean, can_see_attendees boolean, can_chat boolean,
  can_lead_retrieval boolean, min_tier_rank int, is_system boolean
)
event_group_members (group_id, user_id, org_id, added_by, created_at)
-- jedna funkcja prawdy: event_capabilities(_event_id, _user_id) → can_read/can_meet/…

-- §4.4 REJESTRACJA
event_registration_forms (event_id, schema jsonb, approval_mode, confirmation_email_id, …)
event_registrations (id, tenant_id, event_id, user_id, group_id, status
  CHECK (status IN ('pending','approved','rejected','waitlist','cancelled')),
  answers jsonb, ticket_type_id, created_at)
event_ticket_types (id, tenant_id, event_id, name_pl/en, price_cents, currency,
  quota int, sales_from, sales_to, min_tier_rank, visibility)

-- §4.5 WYSTAWCY / SPONSORZY
event_exhibitors (id, tenant_id, event_id, org_id → member_organizations,
  package_key, booth text, description_pl/en, status, sort_order)
event_sponsor_tiers (id, tenant_id, event_id, name_pl/en, size, sort_order)
event_sponsors (id, tier_id, org_id NULL, name, logo_url, url, description_pl/en, sort_order)

-- §4.6 ONSITE
event_checkins (id, tenant_id, event_id, session_id NULL, user_id, ticket_code,
  scanned_by, scanned_at, gate text)                    -- idempotencja per (event,user,session)
event_badges (event_id, template jsonb)                 -- layout badge'a do druku

-- §4.7 STRONY WYDARZENIA (bez drugiego silnika stron — §0.1)
event_pages (event_id, page_id → pages, slot text, menu_label_pl/en,
  icon, color, in_menu boolean, sort_order, visible_to_groups uuid[])
```

Decyzje do potwierdzenia przed migracją:

1. **`event_sessions` vs dzisiejszy JSON widgetu** — migracja czy współistnienie?
   Rekomendacja: współistnienie z `source` w widgecie (wzorzec widgetu `speakers`),
   bez migracji wstecznej istniejących stron.
2. **`event_groups` vs `min_tier_rank`** — grupy wydarzenia to nowa oś uprawnień
   obok warstw członkowskich. Rekomendacja: grupa **nie zastępuje** warstwy;
   `event_capabilities()` liczy iloczyn (rola platformy × grupa × warstwa).
3. **wystawca = `member_organizations`** czy nowy byt? Rekomendacja: `member_organizations`
   — ma już logotypy w czterech wariantach, kolory marki, miejsca i warstwę.

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
(agenda, prelegenci, wystawcy, uczestnicy, nagrania, dokumenty), kolumny:
gość / zarejestrowany / grupa / warstwa. Wzorzec UI: `AccessSettingsPane.tsx`
i `ClubPermissionsTab.tsx`. Ostrzeżenie z modułu klubów obowiązuje tu wprost:
przy `chatham_house = true` lista uczestników i nagranie **nie mogą** trafić do
trybu gościa ani do robota (`forceNoindex`).

---

## 8. Etapy wdrożenia

| Etap                                  | Zakres                                                                                                                                                                                                   | Kryterium odbioru                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **E1** Szkielet                       | grupa `events` w `adminNav`, `/admin/events` (lista + KPI), `/admin/events/$eventId` (layout + sub-nav + `Outlet`), `/general` przeniesione z dzisiejszego dialogu, redirect z `/admin/community/events` | pełny CRUD działa z nowej powierzchni; stara trasa przekierowuje; `check:i18n-hardcoded` czysty |
| **E2** Rodzaje                        | `event_types` + `/admin/events/types` + kreator „nowe wydarzenie z rodzaju"                                                                                                                              | utworzenie kongresu zakłada podstrony i włącza moduły jednym kliknięciem                        |
| **E3** Strony i menu                  | `event_pages` + `/pages` (drzewo, kolejność, ikony, widoczność), oparte na `pages`/builderze                                                                                                             | podstrona wydarzenia powstaje i publikuje się bez wejścia w `/admin/pages`                      |
| **E4** Agenda                         | `event_sessions` (+ prelegenci sesji), `/agenda`, `event-schedule` z `source: "event"`                                                                                                                   | agenda dwudniowa z 30 sesjami zarządzalna z panelu; widget renderuje z bazy                     |
| **E5** Grupy i rejestracja            | `event_groups`, `event_capabilities()`, `event_registrations`, `event_ticket_types`, `/groups` + `/registration`                                                                                         | rejestracja z akceptacją; grupa steruje widocznością; pgtap na uprawnieniach                    |
| **E6** Wystawcy, sponsorzy, spotkania | `event_exhibitors`, `event_sponsor_tiers`, panel `/meetings`                                                                                                                                             | wystawca z pakietem, sponsorzy z bazy, sloty 1-1 z limitami                                     |
| **E7** Onsite, komunikacja, analityka | `event_checkins`, badge'e, sekwencje e-mail, dashboard                                                                                                                                                   | check-in QR działa offline-tolerantnie; dashboard pokazuje frekwencję per sesja                 |

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
6. **i18n** — każdy nowy tekst przez overlay (`src/lib/i18n-admin-events.ts`),
   nigdy `isPl ? … : …`; bramka `check:i18n-hardcoded` to wyłapie.

---

## 10. Pytania otwarte (do rozstrzygnięcia z zamawiającym)

1. **Jedno wydarzenie = jedno microsite z własnym menu, czy sekcja w serwisie?**
   Swapcard robi osobną aplikację wydarzenia. Dla NES tańsze i spójniejsze SEO-wo
   jest poddrzewo `/events/<slug>/…` w serwisie.
2. **Wystawcy** — czy w ogóle są w modelu NES (kongres z powierzchnią wystawienniczą),
   czy wystarczą sponsorzy i partnerzy?
3. **Onsite** — czy jest fizyczna rejestracja przy wejściu (skaner QR, druk badge'y),
   czy wydarzenia pozostają online/hybrydowe bez check-inu?
4. **Rejestracja** — RSVP (jak dziś) czy formularz z akceptacją i pytaniami
   kwalifikacyjnymi (jak Decision Lab)?
5. **Bilety** — czy `event_ticket_types` (kilka rodzajów wejściówek) są potrzebne,
   czy jedna cena per wydarzenie wystarcza?

---

## 11. Dziennik zrzutów ekranu

Mapowanie ekran-po-ekranie (co widać → co to znaczy → gdzie to ma powstać) żyje
w `docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md`. Każda nowa partia zrzutów
dopisuje tam sekcję i, jeśli trzeba, aktualizuje tabele §2 i backlog §8 tutaj.
