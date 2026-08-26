# Swapcard Studio → NES: dziennik zrzutów ekranu

Data otwarcia: 2026-08-23 · Status: **żywy dokument, rośnie z każdą partią zrzutów**
Dokument nadrzędny (architektura, model danych, etapy): `docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md`

## Jak czytać i jak dopisywać

Jedna sekcja = jeden zrzut ekranu. Każda ma stały układ:

- **Ekran** — ścieżka w Swapcardzie + tytuł ekranu.
- **Co widać** — inwentarz kontrolek, dosłownie, z etykietami ze zrzutu.
- **Mapowanie** — tabela: element Swapcarda → odpowiednik NES → stan → identyfikator zadania.
- **Wnioski** — co ten ekran zmienia w specyfikacji (jeśli cokolwiek).

Stan: **✅ jest** · **🟡 częściowo** · **🔴 brak**
Identyfikatory zadań są wspólne z §2 dokumentu nadrzędnego (`EB-nnn`).

Kontekst wydarzenia referencyjnego ze zrzutów: **European Strategies Congress**,
`app.swapcard.com/event/european-strategies-congress`, 26–27.11.2025,
`Europe/Warsaw`, Warszawa (Mazowieckie, Polska), format **Hybrid**, języki: English,
support: `office@neweuropeanstrategies.com`, Event ID `RXZlbnRfMTM2MTg5NQ==`,
plan: Free Trial. Grupy: `Exhibitors` (People: 1 · Exhibitors: 4), `Speakers`
(People: 21), `Attendees` (People: 1). Guest mode: **włączony**.

Sidebar Swapcarda (pełny, ze zrzutów): `Overview` · `Event builder` (General
information / Pages & menu / Groups & permissions / Branding / Sponsors & advertising
/ Terms) · `In-App registration` · `Content` · `Exhibitor Marketplace` · `Meetings` ·
`Communications` · `Onsite` · `Integrations` · `Analytics` · `Add-on features` · `Help`.
Górny pasek: `Preview event` · `Publish event` · konto. Nad sidebarem: `Open event`
i wyszukiwarka „Search within the event…".

---

## Partia 1 — 2026-08-23 (5 zrzutów)

### Zrzut 1.1 — `…/content` · „Pages & menu"

**Co widać**

- Nagłówek: „Design your interface by creating pages to promote your content and
  activate the associated features."
- `Home page design` — radio: **Advanced** („Full control and a customizable design")
  z przyciskiem `Customize page`; **Standard** („Limited, fixed design and layout") — wybrany.
- `Display mode` — radio z miniaturami: **Grid** / **List** (wybrany `List`).
  Opis: „Your pages are also displayed on the home page…".
- `Pages` — przyciski `Create menu group` i `Create page`; przełącznik zakładek
  **Menu pages** / **Other pages**; lista pozycji z kolorową ikoną:
  `Uczestnicy`, `Prelegenci`, `Partnerzy`, `Agenda` (dalej ucięte).
- Widget onboardingowy: „Exhibitor Marketplace Checklist · 4 steps · About 17 minutes".
- Linki „Learn how" przy każdej sekcji.

**Mapowanie**

| Swapcard                                                     | NES                                                                                              | Stan                                         | Zadanie     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------- |
| `Home page design: Advanced` + `Customize page`              | builder (`pages.builder_data`, `template_type=landing`) — pełna kompozycja sekcja→kolumna→widget | ✅ silnik, 🔴 wejście z kontekstu wydarzenia | EB-201      |
| `Home page design: Standard`                                 | preset startowy strony wydarzenia (`starterTemplates.ts`)                                        | 🟡                                           | EB-202      |
| `Display mode: Grid / List`                                  | `events.pages_display_mode` + wariant widgetu menu wydarzenia                                    | 🔴                                           | EB-203      |
| `Create page`                                                | tworzenie `pages` z `parent_id = events.root_page_id` + wiersz `event_pages`                     | 🔴 (CRUD stron ✅ w `/admin/pages`)          | EB-204      |
| `Create menu group`                                          | grupa w menu — odpowiednik `mega-menu`/`menu` jako widget globalny (`docs/MICROSITES.md` §3)     | 🟡                                           | EB-205      |
| `Menu pages` / `Other pages`                                 | `event_pages.in_menu` (bool) + `sort_order`                                                      | 🔴                                           | EB-204      |
| kolorowa ikona pozycji                                       | `event_pages.icon` + `color`; paleta ikon jest już w `/admin/icons` (`IconPackSync`)             | 🔴                                           | EB-206      |
| pozycje `Uczestnicy` / `Prelegenci` / `Partnerzy` / `Agenda` | domyślne podstrony presetu rodzaju (`event_types.default_pages`)                                 | 🔴                                           | EB-2xx + §5 |
| „Checklist · 4 steps"                                        | onboarding wydarzenia — odpowiednik `components/admin/onboarding`                                | 🟡                                           | EB-16xx     |

**Wnioski**

1. Nazwy podstron są **polskie** przy angielskim UI panelu — potwierdza, że treść
   wydarzenia jest dwujęzyczna niezależnie od języka panelu. Nasze bliźniacze kolumny
   `*_pl`/`*_en` + `pickLocalized` pokrywają to poprawnie; `event_pages` musi mieć
   `menu_label_pl`/`menu_label_en`, a nie jedno pole.
2. Swapcard trzyma **dwa poziomy strony głównej**: `Standard` (układ zamknięty) i
   `Advanced` (builder). U nas builder jest zawsze — więc `Standard` to nie osobny
   silnik, a **zablokowany preset**. Kolumna `events.home_design` istnieje po to,
   żeby redakcja nie musiała projektować od zera, a nie żeby wyłączać builder.
3. „Pages are also displayed on the home page" — menu wydarzenia jest **projekcją tej
   samej listy** co kafle na stronie głównej. U nas to jeden widget (`event-menu`)
   z dwoma wariantami prezentacji (`list`/`grid`) czytający `event_pages`. Nie dwie listy.

### Zrzut 1.2 — `…/details` · „General information" (góra)

**Co widać**

- `Basics` — „An event cannot exceed 90 days." + „Click here".
- `* Event name` = `European Strategies Congress` (z flagą języka po prawej).
- `Event URL` = `https://app.swapcard.com/event/european-strategies-congress` + ołówek (edycja slugu).
- `* Begins` = `11/26/2025, 09:00 AM`; `* Ends` = `11/27/2025, 07:00 PM`; `* Time zone` = `Europe/Warsaw`.
- `Cover` → `Event image` (miniatura okładki, `Crop`, `Delete`) + nota, że video header
  zastępuje banner, ale obraz nadal jest potrzebny do miniatur.
- `Video header` → `Streaming platform` = `YouTube` + `Video ID` (`https://www.youtube.com/watch?v=`).

**Mapowanie**

| Swapcard                        | NES                                                                             | Stan                            | Zadanie |
| ------------------------------- | ------------------------------------------------------------------------------- | ------------------------------- | ------- |
| `Event name` + flaga języka     | `events.title_pl` / `title_en`                                                  | ✅                              | —       |
| `Event URL` + edycja            | `events.slug` (`CHECK slug ~ '^[a-z0-9-]{3,120}$'`, `UNIQUE (tenant_id, slug)`) | ✅                              | —       |
| `Begins` / `Ends` / `Time zone` | `starts_at` / `ends_at` / `timezone` (`CHECK ends_at > starts_at`)              | ✅                              | —       |
| limit 90 dni                    | brak reguły długości                                                            | 🔴 (świadomie? — patrz Wnioski) | EB-101  |
| `Event image` + `Crop`          | `events.cover_url`; kadrowanie jest w `/admin/crop-sizes` + `CoverImagePicker`  | 🟡                              | EB-102  |
| `Video header` (platforma + ID) | brak kolumn                                                                     | 🔴                              | EB-103  |

**Wnioski**

1. Limit „event cannot exceed 90 days" jest ograniczeniem **cennikowym** Swapcarda,
   nie merytorycznym. Nie kopiujemy go; ewentualnie miękkie ostrzeżenie w UI przy
   wydarzeniu dłuższym niż 30 dni (literówka w dacie kosztuje przypomnienia do
   wszystkich zapisanych).
2. Flaga języka przy polu tekstowym to lepszy wzorzec niż nasze dwa osobne pola
   `*_pl` / `*_en` obok siebie — jedno pole + przełącznik języka. `AdminLangBar.tsx`
   już istnieje i robi dokładnie to; nowy panel ma go używać, a nie dublować pól.
3. Nota „image will still be required for thumbnails" jest istotna: nagłówek wideo
   **nie zwalnia** z okładki. Walidacja: `video_header_id IS NOT NULL ⇒ cover_url IS NOT NULL`.

### Zrzut 1.3 — `…/details` · „General information" (środek)

**Co widać**

- `Format` — radio z ikonami: **Hybrid** (wybrany) / **In-person** / **Virtual**.
  Opis: „By default, virtual event formats will display all dates according to the
  participant's time zone."
- `Location` — `Warszawa`; `Street address` (puste), `City` = `Warszawa`,
  `State` = `Mazowieckie`, `ZIP Code` = `03`, `Country` = `Polska`, link `Reset location`.
- `Information` — edytor RTE (B, U, lista punktowana, lista numerowana, link) z treścią
  polską; nad edytorem flaga języka.

**Mapowanie**

| Swapcard                                           | NES                                                                              | Stan                             | Zadanie    |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------- | ---------- |
| `Format: Hybrid / In-person / Virtual`             | **brak** — dziś zmieszane w `events.kind` (`in_person`, `hybrid` obok `webinar`) | 🔴                               | EB-104, §5 |
| daty w strefie uczestnika dla `virtual`            | `timezone` jest, ale prezentacja nie zależy od formatu                           | 🟡                               | EB-105     |
| `Location` (nazwa miejsca)                         | `events.location` (jedno pole tekstowe)                                          | 🟡                               | EB-106     |
| adres strukturalny (street/city/state/zip/country) | brak kolumn                                                                      | 🔴                               | EB-106     |
| `Information` (RTE)                                | `description_pl` / `description_en` (plain text)                                 | 🟡 → docelowo `rich-text`/blocks | EB-107     |

**Wnioski**

1. To jest **dowód** na tezę §5 dokumentu nadrzędnego: Swapcard ma osobne `Format`,
   a NES wciska formę dostarczenia do tej samej kolumny co gatunek. Rozdzielenie
   `format` (`virtual|in_person|hybrid`) od `kind` (gatunek) jest konieczne, a nie
   kosmetyczne — od formatu zależy, które pola są **wymagane** (`join_url` vs adres).
2. Adres strukturalny nie jest ozdobą: bez niego nie ma `schema.org/Event` z
   `location.address` (SEO wydarzeń), mapy dojazdu ani „dodaj do kalendarza" z adresem.
   `AddToCalendar` już istnieje i dziś dostaje tylko `location` jako tekst.
3. `ZIP Code = 03` w danych referencyjnych jest niepełny — walidacja kodu
   pocztowego per kraj przy `format ≠ virtual` (miękka: ostrzeżenie, nie blokada).
4. `Information` jako RTE u nas oznacza jedno: **nie** dorabiamy trzeciego edytora.
   Albo `description_*` zostaje tekstem, a treść bogata idzie na stronę wydarzenia
   (builder), albo pole dostaje blocks przez ten sam `PostBlockEditor`, którego używa
   widget `rich-text` (`docs/ARCHITECTURE.md` §2).

### Zrzut 1.4 — `…/details` · „General information" (dół)

**Co widać**

- Koniec treści `Information` (akapity o celach kongresu).
- `X (ex-Twitter) hashtag` — pole `# yourhashtag` (puste).
- `Languages` — lista checkboxów: **English** (zaznaczony), Arabic, Bulgarian,
  Catalan, Chinese, … („changing the default language will clear all your email
  content modifications").
- `Support email` — `office@neweuropeanstrategies.com` („Your audience will be
  redirected to this email for all non-platform related questions").
- `Event ID` — `RXZlbnRfMTM2MTg5NQ==` z przyciskiem kopiowania.

**Mapowanie**

| Swapcard                                            | NES                                                                                              | Stan                                  | Zadanie |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- | ------- |
| hashtag X                                           | brak kolumny                                                                                     | 🔴                                    | EB-108  |
| `Languages` (multi)                                 | platforma jest dwujęzyczna PL/EN globalnie (`src/lib/locale/*`); wydarzenie nie ma własnej listy | 🟡                                    | EB-109  |
| ostrzeżenie „zmiana języka wyczyści treści e-maili" | u nas szablony e-mail mają warianty per język (`/admin/newsletter/email-content`)                | ✅ lepiej                             | —       |
| `Support email`                                     | brak per wydarzenie (globalny kontakt w ustawieniach)                                            | 🔴                                    | EB-110  |
| `Event ID` + kopiowanie                             | `events.id` (uuid) — nie jest pokazywane w panelu                                                | 🔴 (trywialne, przydatne do wsparcia) | EB-111  |

**Wnioski**

1. `Languages` u Swapcarda to lista języków **treści wydarzenia**. NES ma dwa języki
   systemowo; per wydarzenie ma sens raczej `languages text[]` jako **informacja dla
   uczestnika** („sesje po polsku i angielsku, tłumaczenie symultaniczne") niż jako
   przełącznik interfejsu. Tak to opisuję w §4.1 i tak trzeba to nazwać w UI,
   żeby nie obiecywać tłumaczenia panelu na arabski.
2. Hashtag i support email są tanie i realnie używane (stopka e-maila, widget
   `event-practical`, karta social preview). Wchodzą do E1 razem z `general`.
3. Widoczne `Event ID` z kopiowaniem to drobiazg, który oszczędza godziny przy
   zgłoszeniach do wsparcia — dorzucić do stopki ekranu `general`.

### Zrzut 1.5 — `…/groups-and-permissions` · „Groups & permissions"

**Co widać**

- `Groups` — „Segment your database to assign different rules (visibility, meetings,
  lead retrieval, etc.) or use it to target sent emails, notifications, and advertisements."
  Lista: **Exhibitors** (People: 1 · Exhibitors: 4), **Speakers** (People: 21),
  **Attendees** (People: 1) — każda z ikoną edycji (ołówek) i ikoną reguł (suwaki).
  Przycisk `Add a group`.
- `Public visibility` → `Guest mode` — przełącznik **włączony**: „Guest mode allows you
  to make your event publicly visible, offering a dedicated landing page… You can fully
  control which parts of your content are visible by adjusting your Pages settings and
  Guests visibility."
- `Guests visibility` — „Manage the visibility of the event content by people who are
  not registered for the event or not logged in." + przycisk `Manage visibility`.

**Mapowanie**

| Swapcard                                                 | NES                                                                                                                    | Stan | Zadanie |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| grupy uczestników z licznikami                           | brak per wydarzenie; **wzorzec gotowy** w `club_groups` + `club_members`                                               | 🔴   | EB-301  |
| reguły per grupa (widoczność, spotkania, lead retrieval) | `club_capabilities()` jako wzorzec „jedna funkcja prawdy"                                                              | 🔴   | EB-302  |
| grupa jako **cel** e-maili / powiadomień / reklam        | segmenty istnieją: `club_segment_rules`, `ClubSegmentCampaign.tsx`, kampanie newslettera                               | 🟡   | EB-303  |
| `Exhibitors` liczy osobno `People` i `Exhibitors`        | dwa liczniki = osoby i **organizacje**; u nas `member_organizations` + `organization_seats`                            | 🟡   | EB-304  |
| `Guest mode`                                             | `events.visibility = 'public'` + `guest_mode` (nowa kolumna) + strona-korzeń publiczna                                 | 🟡   | EB-305  |
| `Guests visibility` → `Manage visibility`                | macierz widoczności per sekcja (§7 dokumentu nadrzędnego); UI wzorowany na `AccessSettingsPane` / `ClubPermissionsTab` | 🔴   | EB-306  |

**Wnioski**

1. Trzy grupy systemowe (`Attendees`, `Speakers`, `Exhibitors`) muszą powstać
   **automatycznie** przy utworzeniu wydarzenia i być nieusuwalne (`is_system`),
   z możliwością dodania własnych (`Add a group`) — dokładnie jak domyślna grupa
   „Ogólna" w klubach.
2. Grupa `Speakers` ma 21 osób, a `event_speakers` u nas trzyma dokładnie tę relację.
   Wniosek: grupa „Speakers" **nie jest** trzecim źródłem prawdy o prelegentach —
   ma być **projekcją** `event_speakers`. Inaczej po miesiącu będą dwie listy
   prelegentów, które się nie zgadzają. To samo dotyczy `Attendees` ↔ `event_rsvps`
   / `event_registrations`. Tylko grupy własne redakcji mają własne członkostwo.
3. „lead retrieval" w opisie reguł to funkcja wystawcy (skan badge'a uczestnika →
   lead w CRM). Mamy CRM i mamy QR na bilecie — brakuje skanera i zgody RODO na
   przekazanie danych wystawcy. To zadanie z etapu E7, ale **zgoda** musi być
   zaprojektowana razem z rejestracją (E5), bo pojawia się w formularzu.
4. Guest mode + Chatham House to kolizja, którą trzeba obsłużyć twardo:
   `chatham_house = true` **wyklucza** publiczną listę uczestników i nagrania
   w trybie gościa. Bramka: test pgtap na `event_capabilities()`.

---

## Partia 2 — 2026-08-23 (5 zrzutów)

Cztery pierwsze zrzuty to **jeden panel boczny**: `Groups & permissions` →
kliknięcie ołówka na grupie `Exhibitors` otwiera szufladę z czterema zakładkami
(`General`, `Exhibitor profile`, `Lead generation`, `Members`). Piąty to `Branding`.

### Zrzut 2.1 — `Exhibitors` → zakładka „General"

**Co widać**

- `* Group name` = `Exhibitors` (pole wyszarzone — grupa systemowa).
- `Community parent group` = `Exhibitors · Community` (dropdown, z ikoną „i").
- `Who and what they can see` — karta `People` z podpisem `Groups: All` (rozwijalne),
  a pod nią trzy wiersze, każdy z przełącznikiem (wszystkie **włączone**) i linkiem
  **`Add condition`**: `Exhibitors`, `Sessions`, `Items`.
- `Chat with exhibitors` — **`Add-on`** (plakietka): „Add a live chat to exhibitors'
  virtual booths to let them communicate with visitors in real time." + `Get feature`.
- `Internal ID` — pole (ucięte na dole zrzutu).

**Mapowanie**

| Swapcard                                                       | NES                                                                                                                                                   | Stan | Zadanie |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| `Group name` + blokada dla grup systemowych                    | `event_groups.name_pl/en` + `is_system`                                                                                                               | 🔴   | EB-301  |
| `Community parent group`                                       | grupa **poziomu społeczności** (tenant), z której grupa wydarzenia dziedziczy                                                                         | 🔴   | EB-307  |
| `Who and what they can see` (People/Exhibitors/Sessions/Items) | macierz widoczności per typ treści                                                                                                                    | 🔴   | EB-306  |
| **`Add condition`** — warunek zawężający                       | **wzorzec istnieje**: `club_segment_rules.rule jsonb` (unia rozłączna, oceniana w SQL, `src/lib/clubs/adminSegment.ts`, `club_segment_candidate_ids`) | 🟡   | EB-308  |
| `Groups: All` na karcie `People`                               | „widzę uczestników z grup: …" — relacja grupa→grupy widoczne                                                                                          | 🔴   | EB-306  |
| `Chat with exhibitors`                                         | czat 1-1 istnieje (`conversations`, `messages`, `/admin/community/chat`); brak czatu przypiętego do stoiska                                           | 🟡   | EB-902  |
| `Internal ID`                                                  | `event_groups.key` (stabilny klucz do integracji/importu)                                                                                             | 🔴   | EB-301  |
| `Add-on` + `Get feature`                                       | odpowiednik: przełączniki modułów (`events.features`, `event_types.default_features`) — u nas **bez upsellu**                                         | 🟡   | EB-15xx |

**Wnioski**

1. `Add condition` to nie checkbox — to **silnik reguł**. Swapcard pozwala powiedzieć
   „grupa Wystawcy widzi sesje, ale tylko te ze ścieżki X". W NES istnieje dokładnie
   ten wzorzec i jego doktryna jest już zapisana: reguła jest **danymi w `jsonb`**
   (unia rozłączna), ocenianymi w SQL, z **obowiązkowym podglądem** liczby trafionych
   rekordów przed zapisem (`src/lib/clubs/adminSegment.ts` §1–4). Kopiujemy wzorzec,
   nie wymyślamy drugiego.
2. `Community parent group` ujawnia, że Swapcard ma **dwa poziomy grup**: społeczność
   (organizator, wiele wydarzeń) i wydarzenie. To ma realną wartość — „Wystawcy" jako
   kategoria trwała w CRM, a `Exhibitors` wydarzenia jako jej instancja. U nas poziom
   społeczności już istnieje w dwóch postaciach: `member_organizations` (organizacja)
   i tagi/segmenty CRM. Rekomendacja: `event_groups.parent_key` wskazuje **słownik grup
   tenanta** (`community_groups`), a nie kolejną tabelę per wydarzenie.
3. Cztery zakładki w szufladzie jednej grupy to sygnał, że „grupa" u Swapcarda **nie
   jest** tylko listą ludzi — jest **rolą produktową** (uprawnienia + pola profilu +
   narzędzia leadowe + zarządzanie zespołem). Nasze `event_groups` muszą to unieść:
   grupa niesie politykę, nie tylko członkostwo.
4. Trzy z czterech funkcji na tym ekranie są u Swapcarda **płatnym dodatkiem**
   (`Add-on`). Nie kopiujemy modelu upsellu, ale kopiujemy **granularność
   przełączników** — `events.features jsonb` musi mieć osobne klucze dla czatu
   przy stoisku, skanowania badge'y, kwalifikacji leadów i eksportów.

### Zrzut 2.2 — `Exhibitors` → zakładka „Exhibitor profile"

**Co widać**

- `Company fields` — „Define here the fields that exhibitors can edit on their company
  profiles." + link `Disable all`.
- Lista pól, każde z przełącznikiem (wszystkie **włączone**): `Name`, `Logo`,
  `Header image`, `Video header`, `Advertising`, `Background image`, `Description`,
  `Address`, `Website`, `Email`, `Phone numbers`, `Social networks`.
- `Documents & Links` — **`Add-on`**: „Give exhibitors a way to include documents and
  links to outside resources on their company profile page." + `Get feature`.
- `Items` — **`Add-on`**: „Provide each exhibitor with a dedicated area where they can
  promote products, services, or anything at all to attendees." + `Get feature`.

**Mapowanie**

| Swapcard                                             | NES                                                                                                                                                                                                      | Stan              | Zadanie |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------- |
| profil firmy wystawcy                                | `member_organizations`: `name`, `logo_h_light/dark`, `logo_v_light/dark`, `logo_favicon`, `brand_primary/accent/ink`, `description`, `website_url`, `contact_email`, `city`, `country`, `sector`, `slug` | ✅ **niemal 1:1** | EB-901  |
| `Header image` / `Background image` / `Video header` | brak w `member_organizations`                                                                                                                                                                            | 🔴                | EB-903  |
| `Social networks`                                    | wzorzec z profilu osoby (`SocialIdentityPanel.tsx`)                                                                                                                                                      | 🟡                | EB-903  |
| `Phone numbers`                                      | `crm_leads.phone` po stronie CRM; brak na organizacji                                                                                                                                                    | 🟡                | EB-903  |
| **polityka pól** („co wystawca może edytować")       | **brak wzorca** — najbliżej: macierz uprawnień `/admin/permissions` + snapshot authz                                                                                                                     | 🔴                | EB-904  |
| `Disable all`                                        | akcja masowa na polityce pól                                                                                                                                                                             | 🔴                | EB-904  |
| `Documents & Links`                                  | wzorzec gotowy: `club_documents` + `club_thread_documents`                                                                                                                                               | 🟡                | EB-905  |
| `Items` (produkty/usługi wystawcy)                   | brak; najbliżej: `programs` / katalog treści                                                                                                                                                             | 🔴                | EB-906  |
| `Advertising` (kreacja wystawcy)                     | `/admin/ads` + `ad_events` + widget `ad-slot`                                                                                                                                                            | 🟡                | EB-503  |

**Wnioski**

1. To jest **najsilniejszy punkt ponownego użycia w całym module**: wystawca to
   `member_organizations`. Ta tabela ma już logotypy w czterech wariantach
   (poziomy/pionowy × jasny/ciemny), favicon, trzy kolory marki, sektor, slug,
   most do `crm_companies` i **miejsca dla zespołu** (`organization_seats`).
   Tworzenie osobnego `event_exhibitor_profiles` byłoby trzecim źródłem prawdy
   o firmie (po `crm_companies` i `member_organizations`).
2. Brakujący element to nie dane, a **polityka pól**: „które pola wystawca edytuje
   sam". To nowy rodzaj obiektu w platformie — dotąd uprawnienia były na poziomie
   trasy/akcji, nie pola. Proponuję `event_exhibitor_field_policy(event_id, field
text, editable boolean, required boolean, visible boolean)` — wąska tabela zamiast
   `jsonb`, żeby bramka `check:db-contract` widziała kontrakt, a nie worek.
3. `Items` (produkty wystawcy) to osobny byt treściowy z własnym cyklem życia.
   Jeśli wystawcy wchodzą do zakresu, `event_exhibitor_items` jest tabelą, nie
   `jsonb` na wystawcy — bo Items mają być wyszukiwalne i linkowalne z agendy.
4. Uwaga produktowa: przy 4 wystawcach w wydarzeniu referencyjnym cały ten aparat
   (self-service profilu, Items, dokumenty, reklamy) jest **przerostem**. To jest
   argument, żeby wystawców zrobić **późno** (etap E6) i tylko jeśli odpowiedź na
   pytanie otwarte §10.2 dokumentu nadrzędnego brzmi „tak, są wystawcy".

### Zrzut 2.3 — `Exhibitors` → zakładka „Lead generation"

**Co widać**

- `Lead capture` — **`Add-on`**: „Use the app to scan participant badges for simple
  lead collection and sharing." + `Get feature`.
- `Lead qualification` — **`Add-on`**: „…giving them a way to qualify leads by criteria
  they define." + `Get feature`.
- `Allow to download QR code` — przełącznik **wyłączony**: „exhibitors can download a
  QR code from Exhibitor Center that goes to their exhibitor profile page. Displaying
  this QR code on site drives more traffic and leads."
- `Lead dashboards and exports` — **`Add-on`**: „…comprehensive dashboards with AI
  recommended leads. Support lead assignments to members and enable data exports
  through Excel or seamless CRM synchronization via the Exhibitor API."

**Mapowanie**

| Swapcard                                   | NES                                                                                    | Stan              | Zadanie |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------- | ------- |
| skan badge'a uczestnika → lead             | QR na bilecie istnieje (`src/lib/events/ticketCode.ts`), **skanera nie ma**            | 🔴                | EB-1201 |
| kwalifikacja leadów po własnych kryteriach | `crm_leads.score`, `score_band`, `score_breakdown`, `tags`, `stage` (enum `crm_stage`) | ✅ **rdzeń jest** | EB-1202 |
| „AI recommended leads"                     | scoring z `score_breakdown` + `/admin/crm` + `crm_upsert_lead_from_profile()`          | 🟡                | EB-1203 |
| przypisanie leada do członka zespołu       | `crm_leads.owner_id`                                                                   | ✅                | —       |
| eksport Excel                              | wzorzec CSV/eksportów w repo (`src/lib/csv`)                                           | 🟡                | EB-1204 |
| „Exhibitor API" / sync do CRM              | `/admin/integrations`, `mcp.ts`, webhooki                                              | 🟡                | EB-1205 |
| QR do profilu wystawcy do druku            | brak                                                                                   | 🔴                | EB-907  |

**Wnioski**

1. **Najważniejszy wniosek prawny całej partii**: „skan badge'a" to przekazanie danych
   osobowych uczestnika **podmiotowi trzeciemu** (wystawcy). W NES nie ma na to zgody
   w żadnym istniejącym formularzu. Musi powstać jako odrębna zgoda w rejestracji
   (etap E5), z zapisem w `user_consents` / `crm_consent_log`, oddzielna od zgody
   marketingowej (`crm_leads.marketing_consent`), z możliwością odmowy **bez utraty
   wstępu**. Zaprojektowanie tego dopiero przy skanerze (E7) byłoby błędem kolejności:
   zgoda zbiera się przy rejestracji, nie przy bramce.
2. Leady wystawcy **nie mogą** wpadać do wspólnego `crm_leads` tenanta bez izolacji —
   wystawca A nie ma prawa zobaczyć leada wystawcy B. Stąd `event_leads` z `org_id`
   i RLS opartym o `organization_seats` (kto z zespołu wystawcy ma dostęp), a dopiero
   **projekcja** do `crm_leads` dla organizatora. Odwrotna kolejność (jedna tabela,
   filtr w UI) to wyciek jednym `SELECT`-em.
3. To, co Swapcard sprzedaje jako trzy dodatki (`capture`, `qualification`,
   `dashboards`), NES ma w połowie darmo: scoring leadów z rozbiciem, właściciel,
   etapy leja i eksporty istnieją w CRM. Brakuje **tylko** skanera i izolacji per
   wystawca. Warto to nazwać w ofercie.

### Zrzut 2.4 — `Exhibitors` → zakładka „Members"

**Co widać**

- `Allow to add registered members` — przełącznik **włączony**: „exhibitors in this
  group can add colleagues to their team. Only people already registered for the event
  can be added as members."
- `Allow to register members` — przełącznik **wyłączony**: „exhibitors can share a
  registration link with their staff. Anyone who registers through the link is
  automatically assigned to the exhibitor's booth."

**Mapowanie**

| Swapcard                                          | NES                                                                                                   | Stan               | Zadanie |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------ | ------- |
| dodawanie kolegi z zespołu (tylko zarejestrowany) | `organization_seats` (`invited_email`, `claimed_at`, `role`, `status`, `suspended_at`, `grace_until`) | ✅ **wzorzec 1:1** | EB-908  |
| link rejestracyjny wystawcy z auto-przypisaniem   | `club_invite_links` + `club_invite_link_uses` (token, limity, zużycia)                                | 🟡 **wzorzec 1:1** | EB-909  |
| dwa przełączniki jako polityka grupy              | `event_groups.can_add_members` / `can_invite_members`                                                 | 🔴                 | EB-301  |

**Wnioski**

1. Oba mechanizmy istnieją w repo w dojrzałej formie — `organization_seats` dla
   zespołu i `club_invite_links` dla linków zapraszających z limitem użyć. Praca
   sprowadza się do **przypięcia ich do wydarzenia i wystawcy**, nie do budowy.
2. Rozróżnienie „dodaj już zarejestrowanego" vs „zaproś nowego" jest istotne
   pojemnościowo: druga opcja **tworzy uczestników**, więc musi respektować limit
   miejsc (`events.capacity`) i pakiet wystawcy (ile wejściówek dla obsługi stoiska).
   Bez tego wystawca zapełni salę własnym zespołem. To reguła do zapisania w
   `event_exhibitors.staff_passes_limit`.

### Zrzut 2.5 — `…/branding` · „Branding"

**Co widać**

- `Appearance` — „Customize the look, feel and color of your event on mobile and web
  apps." Radio z podglądem karty osoby: **Light** (wybrany) / **Dark** z plakietką `Beta`.
- `Colors` — „Choose your navigation, actions and text colors":
  - `Navigation` = `#01112F` („Color of the menu (navigation bar).")
  - `Main actions` = `#FA9346` („Color of the major buttons. Tip: set the same color
    than »My event« button.")
  - `Text` = `#01112F` („Color of all written content.")
- `Background` — „Set your background color or select a background image. It will
  appear on all pages, including the In-App registration form.":
  - `Content blocks background (desktop only)` = `#FFFFFF`
  - `Background` (dalej ucięte — pole obrazu tła)
- Pasek akcji na dole: **`Reset to community branding`** · `Discard changes` · `Save`
  (nieaktywny) + wskaźnik `1 / 4` (paginacja podglądu).
- Po prawej: makieta podglądu układu strony wydarzenia.

**Mapowanie**

| Swapcard                                                             | NES                                                                                                                                                                                                                       | Stan                                             | Zadanie |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------- |
| `Appearance: Light / Dark`                                           | motyw dwutrybowy jest rdzeniem platformy (`ThemeProvider`, `themeInitScript`, każdy slot kolorystyczny ma wariant light i dark)                                                                                           | ✅ **mocniej niż Swapcard** (u nich Dark = Beta) | —       |
| `Navigation` / `Main actions` / `Text` / `Content blocks background` | `GLOBAL_COLOR_GROUPS` (`src/lib/builder/globalColors.ts`): grupy `header`, `button`, `body-text`/`headings`, `body` — **każda ze slotami light/dark**, edytor `GlobalColorsEditor.tsx`, wyjście przez `globalColorsToCss` | ✅ silnik, 🔴 zakres per wydarzenie              | EB-401  |
| obraz tła na wszystkich stronach                                     | `ThemeBackgroundsPane.tsx`                                                                                                                                                                                                | 🟡                                               | EB-402  |
| **`Reset to community branding`**                                    | dziedziczenie „tenant → wydarzenie" z jawnym powrotem do dziedziczenia                                                                                                                                                    | 🔴                                               | EB-403  |
| `Discard changes` / `Save` (nieaktywny bez zmian)                    | wzorzec w repo: `AutosaveBar.tsx`, `UnsavedChangesGuardHost`, „Zapisz" aktywne tylko przy realnej zmianie (`admin.community.clubs.$clubId.tsx`)                                                                           | ✅                                               | —       |
| podgląd na żywo z paginacją `1 / 4`                                  | `LayoutPreview.tsx`, `ExpertLayoutPreview.tsx`, podgląd buildera                                                                                                                                                          | 🟡                                               | EB-404  |
| fonty wydarzenia                                                     | `CustomFontUploader.tsx`, `src/lib/theme/customFonts.ts`, `fontSizes.ts`                                                                                                                                                  | 🟡                                               | EB-405  |

**Wnioski**

1. Branding jest **odwrotnością** relacji z resztą modułu: tu NES jest wyraźnie dalej
   niż Swapcard (dziesiątki slotów w dwóch trybach, presety, undo/redo, własne fonty,
   tła). Ryzyko nie polega na braku funkcji, a na **przeładowaniu**: nie wolno oddać
   redakcji per wydarzenie pełnego `GlobalColorsEditor`, bo dostanie sto suwaków dla
   wydarzenia, które potrzebuje trzech kolorów.
2. Rekomendacja: **wąski zestaw slotów per wydarzenie** — dokładnie ten, który
   pokazuje Swapcard (nawigacja, akcja główna, tekst, tło bloków, obraz tła, logo)
   — jako `events.branding jsonb` (nadpisania), a nie kopia całej struktury.
   Puste = dziedziczenie z motywu globalnego; `Reset to community branding` = usunięcie
   klucza, nie zapis wartości domyślnej. To ta sama semantyka „dziedzicz albo nadpisz",
   którą moduł klubów już stosuje (`NULL` = dziedzicz, wartość = nadpisz).
3. Konsekwencja techniczna: nadpisania wydarzenia muszą wejść w ten sam kanał, co
   dziś idą globalne kolory — CSS custom properties wstrzykiwane w SSR
   (`DesignTokensStyle` / `globalColorsToCss`), z zakresem ograniczonym do poddrzewa
   stron wydarzenia. Drugi mechanizm stylowania (klasy, inline) rozjedzie się
   z pierwszym po dwóch miesiącach.
4. Zdanie „It will appear on all pages, including the In-App registration form" jest
   wymagającym szczegółem: branding musi objąć także **formularz rejestracji**,
   który u nas będzie widgetem buildera — czyli branding wydarzenia nie może być
   właściwością jednej strony, tylko **zakresu** (poddrzewo `pages` + rejestracja).

---

## Partia 3 — 2026-08-23 (5 zrzutów)

Zrzuty 3.1–3.2 to `Sponsors & advertising` (jedna strona, dwa przewinięcia),
3.3 to `Terms → Create a term`, 3.4–3.5 to `In-App registration`
(`Registration settings` i `Tickets`).

> **Kontekst decyzyjny tej partii.** Zamawiający rozstrzygnął pytania otwarte §10
> dokumentu nadrzędnego (patrz tam §0.4). Dla tej partii istotne są dwie
> odpowiedzi: **wystawcy nie są osobnym modułem** (partnerzy i sponsorzy
> synchronizowani z CRM firm) oraz **rejestracja w obu formach** (RSVP jak dziś
> i formularz z akceptacją), a **bilety konfigurowane per wydarzenie**.

### Zrzut 3.1 — `…/sponsors-and-advertising` · „Sponsors" + „Event home ad"

**Co widać**

- `Sponsors` — „Improve sponsor visibility within the platform. Sponsors and ads are
  great ways to monetize." + przycisk **`Create a sponsor section`**.
- Cztery sekcje, każda z ołówkiem (edycja) i ikoną kolejności:
  - **Premium Partner** — 2 logotypy (Security Shield, Ship Tech),
  - **Silver Partner** — 3 logotypy (Globekey, Cyber Tech, Goshieldex),
  - **Bronze Partner** — 5 logotypów (Warner & Spencer, GlobeWork, Lion King,
    Conikos, Pandaros),
  - **Partners** — 2 logotypy (Starrioc, Historic Castle).
- `Event home ad` — „If you add multiple ads that target the same group, they will
  display randomly. On web desktop, the image is displayed in a vertical banner ad on
  the right side of the home page of your event. On mobile, the image appears as a full
  screen interstitial ad." + `Upgrade plan`.
- Tabela reklamy: kolumny `Image` · `Targeted groups` · `Number of views` ·
  `Number of clicks`. Wiersz: kreacja (plakat kongresu) · `Attendees, Speakers,
Exhibitors, Guests` · `42` · `-`.

**Mapowanie**

| Swapcard                                                              | NES                                                                                                                                                                                                            | Stan                 | Zadanie |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------- |
| sekcja sponsorska = poziom (`Premium/Silver/Bronze/Partners`)         | widget `event-sponsors`: `tiers[]` z `name_pl/en`, `size`, `sponsors[]` (`name`, `logo`, `url`, `description_pl/en`)                                                                                           | ✅ **model 1:1**     | EB-501  |
| kolejność sekcji (drag)                                               | `sort_order` w treści widgetu                                                                                                                                                                                  | ✅                   | —       |
| logotyp sponsora                                                      | po decyzji: **z CRM firm** — `crm_companies.logo_url`, `name`, `website`, `domain`                                                                                                                             | 🟡                   | EB-502  |
| `Create a sponsor section` z panelu (nie z buildera)                  | brak — dziś sponsorzy istnieją tylko jako treść widgetu na stronie                                                                                                                                             | 🔴                   | EB-501  |
| `Event home ad` (kreacja + cel + statystyki)                          | `ad_slots` (`image_url`, `image_link`, `image_alt`, `requires_consent`, `targeting jsonb`) + `ad_placements` (`position`, `page_type`, `page_id`, `starts_at`/`ends_at`) + `ad_events` (`kind` = odsłona/klik) | ✅ **silnik gotowy** | EB-503  |
| `Targeted groups`                                                     | `AdTargeting` ma dziś `categorySlugs`, `tagSlugs`, `languages` — **nie ma grup wydarzenia**                                                                                                                    | 🔴                   | EB-504  |
| „wiele reklam na tę samą grupę = rotacja losowa"                      | brak reguły rotacji przy kolizji                                                                                                                                                                               | 🔴                   | EB-505  |
| pozycje: pionowy banner z prawej / pełnoekranowa przerywnik na mobile | `AdPosition`: `sidebar`, `footer_slideup`, `header_banner`… — brak `interstitial`                                                                                                                              | 🟡                   | EB-506  |
| `Number of views` / `Number of clicks`                                | `ad_events` liczy oba rodzaje                                                                                                                                                                                  | ✅                   | —       |

**Wnioski**

1. **Sponsorzy powinni wyjść z treści widgetu do bazy** — dokładnie tą samą decyzją,
   co agenda (§0.2 dokumentu nadrzędnego). Powód jest tu jeszcze mocniejszy: ten sam
   partner wraca na kolejnych wydarzeniach, ma umowę, poziom i kreację reklamową.
   Trzymanie go jako wpisu w `builder_data` oznacza przepisywanie logotypów przy
   każdym wydarzeniu i brak odpowiedzi na pytanie „ilu wydarzeń był partnerem X".
   Po decyzji zamawiającego źródłem jest **`crm_companies`**, więc `event_sponsors`
   to tabela wiążąca (poziom × firma × kolejność), a nie kopia danych firmy.
2. Widget `event-sponsors` dostaje `source: "event"` (obok `manual`) — trzeci raz ten
   sam wzorzec (`speakers`, `event-schedule`, `event-sponsors`). Warto go opisać raz
   w `docs/ARCHITECTURE.md` jako regułę: **widget wydarzenia czyta albo treść własną,
   albo encję wydarzenia**.
3. Reklama „Event home ad" nie wymaga u nas nowego modułu — wymaga **dwóch rozszerzeń
   istniejącego**: celowania po grupie wydarzenia (`AdTargeting.eventGroupKeys`) i
   pozycji `event_home_sidebar` + `interstitial_mobile`. To tanie i mierzalne
   (`ad_events` już liczy odsłony i kliki), a przy okazji spina monetyzację wydarzeń
   z istniejącym `/admin/ads`.
4. `Guests` występuje w `Targeted groups` obok grup uczestników — czyli **gość jest
   grupą docelową**, nie brakiem grupy. Nasza macierz widoczności (§7) musi traktować
   gościa jako pełnoprawny wiersz, a nie „stan zerowy".

### Zrzut 3.2 — ta sama strona, dalej: „Advanced banner ads"

**Co widać**

- Sekcja `Partners` (koniec listy sponsorów) i ponownie tabela `Event home ad`.
- `Advanced banner ads` — **`Add-on`**: „Deliver more exposure and value to sponsors
  with additional in-app ads." + `Get feature`; pusty stan: „You haven't added any
  advanced banner yet" z makietą wielu formatów banerów w aplikacji.

**Mapowanie**

| Swapcard                              | NES                                                                                          | Stan                            | Zadanie |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------- | ------- |
| dodatkowe formaty banerów w aplikacji | `AdPosition` ma dziś 7 pozycji + `in_feed` z `{ every: N }`, `mid_post` z `{ paragraph: N }` | ✅ **bogatsze niż tu pokazane** | —       |
| pusty stan z makietą                  | wzorzec pustych stanów w panelu istnieje                                                     | ✅                              | —       |
| model płatnego dodatku                | u nas: przełącznik modułu, bez upsellu                                                       | —                               | —       |

**Wnioski**

1. Cały „Advanced banner ads" to u Swapcarda **płatny dodatek**, a u nas zwykłe
   `ad_placements` z `position` i `config`. Nie ma tu pracy do wykonania poza
   dodaniem pozycji specyficznych dla wydarzenia (EB-506). Warto to zapisać, bo
   przy porównaniach ofertowych to argument, nie luka.
2. Powtórzenie tabeli `Event home ad` w dwóch przewinięciach potwierdza, że
   reklama wydarzenia jest **jedną kreacją na wydarzenie** (nie kampanią). Nasz
   model (`slot` + wiele `placement`) jest ogólniejszy; UI wydarzenia ma pokazywać
   uproszczony widok „kreacja + cel + statystyki", a nie cały kreator reklam.

### Zrzut 3.3 — `…/terms` · „Create a term"

**Co widać**

- Nagłówek + nota: „For lengthy terms, it is recommended that you use a short
  description and provide an external link."
- `* Label (Only visible to you)` — „Enter a term label (only visible to you)".
- `* Term description` — RTE (B, U, lista punktowana, lista numerowana, link)
  z flagą języka; „Enter a short description".
- `Where to display` — radio:
  - **Only on event access** — „Your term will appear once your attendees access the event."
  - **On in-app registration and event access** — „…displayed on the first page of the
    registration form, and also at the event access if consent has not yet been given."
- `Make this term required` — przełącznik (**wyłączony**).
- Przycisk `Create a term` (nieaktywny do wypełnienia pól).

**Mapowanie**

| Swapcard                                                     | NES                                                                                                                            | Stan | Zadanie |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---- | ------- |
| zgoda/regulamin jako **osobny obiekt** z etykietą wewnętrzną | `user_consents` + `user_consent_events` + `crm_consent_log` (log zgód istnieje), ale **definicji zgody per wydarzenie nie ma** | 🟡   | EB-601  |
| `Label (Only visible to you)`                                | klucz wewnętrzny zgody — u nas odpowiednik `consent_key`                                                                       | 🔴   | EB-601  |
| treść zgody (RTE, i18n)                                      | `*_pl` / `*_en` + wzorzec treści prawnych (`/regulamin`, `/polityka-prywatnosci`, `/admin/settings/privacy`)                   | 🟡   | EB-602  |
| `Where to display` (wejście vs rejestracja + wejście)        | brak mechanizmu „gdzie pokazać zgodę"                                                                                          | 🔴   | EB-603  |
| `Make this term required`                                    | rozróżnienie zgody wymaganej i opcjonalnej                                                                                     | 🔴   | EB-604  |
| dowód udzielenia zgody (kto, kiedy, wersja)                  | `user_consent_events` — **mocna strona NES** (audytowalny log)                                                                 | ✅   | —       |

**Wnioski**

1. Ten ekran zamyka lukę z partii 2 (zrzut 2.3, wniosek 1): **zgoda na przekazanie
   danych wystawcy/partnerowi** to właśnie „term" z opcją `required = false`,
   wyświetlany na pierwszej stronie formularza rejestracji. Nasz model musi to unieść
   jako `event_terms(event_id, key, title_pl/en, body_pl/en, external_url, display
('access' | 'registration_and_access'), required boolean, version int)` +
   `event_term_acceptances(term_id, user_id, accepted_at, version)`.
2. `version` jest mój, nie Swapcarda — i jest konieczny. Zgoda udzielona na treść
   v1 nie jest zgodą na v2; bez wersji log zgód nie ma wartości dowodowej. Repo ma
   już `user_consent_events`, więc dokładam kolumnę wersji, a nie nowy mechanizm.
3. „For lengthy terms use a short description + external link" to dobra praktyka,
   którą warto skopiować: pole `external_url` obok krótkiego opisu, żeby pełny
   regulamin żył jako **strona** (`pages`) z historią rewizji, a nie jako `jsonb`
   w wydarzeniu.
4. `required = false` przy zgodzie **musi** oznaczać realną możliwość odmowy bez
   utraty wstępu — inaczej to zgoda pozorna. Reguła do zapisania w kodzie: odmowa
   zgody nieobowiązkowej nie może blokować `event_registrations.status = 'approved'`.

### Zrzut 3.4 — `…/registration-mode` · „Registration settings"

**Co widać**

- Sidebar zmienia poziom: `< Back to the community`, nazwa wydarzenia
  („European Strategies Congress", „November 26th 2025, 9:00 am"), `Open event`,
  wyszukiwarka, a `In-App registration` jest rozwinięte na:
  **Registration settings** · **Tickets** · **Codes** · **Form**.
- `Registration mode` — radio:
  - **In-App registration** (wybrany) — „Create your tickets, form, and badge
    templates directly in the Studio. You will also be able to use Swapcard Go
    services to manage access and badge printing on-site."
  - **External registration** — „…provide your external registration link to which
    non-registrants will be redirected while interacting with the event in guest
    mode." + linki `Integrations` / `Developer Portal`.
  - **No registration** — „Invite people manually by adding them in the content section."
- `Registration URL` = `https://app.swapcard.com/login/event/european-strategies-congress/registration` + kopiowanie.
- `Guest mode redirection` — `In-App registration` (wybrany) / `External URL`.
- `Registration widget` — „Let your audience register directly on your own website with
  our embeddable widget": `Tickets` = `All tickets`, `Language` = `Automatic (browser
language)`, „Copy and paste the HTML code into your website" + `Preview`.

**Mapowanie**

| Swapcard                                           | NES                                                                                                                                                                         | Stan                 | Zadanie |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------- |
| dwupoziomowa nawigacja (społeczność → wydarzenie)  | **potwierdza IA z §3 dokumentu nadrzędnego**: `/admin/events` → `/admin/events/$eventId/*` z powrotem „do listy"                                                            | —                    | EB-001  |
| `Registration mode: In-App`                        | RSVP + bilety w platformie (`rsvp_event`, `ticket.functions.ts`)                                                                                                            | ✅                   | EB-701  |
| `Registration mode: External`                      | brak — rejestracja zewnętrzna (link) nieobsługiwana                                                                                                                         | 🔴                   | EB-702  |
| `Registration mode: No registration`               | ręczne dodanie uczestnika — dziś częściowo przez `admin.users.invitations`                                                                                                  | 🟡                   | EB-703  |
| `Registration URL`                                 | `/events/$slug` + docelowo `/events/$slug/rejestracja`                                                                                                                      | 🟡                   | EB-704  |
| `Guest mode redirection`                           | gdzie trafia gość klikający „zarejestruj się"                                                                                                                               | 🔴                   | EB-705  |
| **`Registration widget`** (embed na obcej stronie) | **wzorzec istnieje**: widget publiczny do zagnieżdżania jest w repo wspomniany przy „Guests visibility… thanks to our widget"; u nas: newsletter inline + popupy mają embed | 🟡                   | EB-706  |
| `Codes` (kody dostępu/rabatowe)                    | **`/admin/coupons`** — kampanie, realizacje, analityka                                                                                                                      | ✅ **silnik gotowy** | EB-707  |
| `Form` (kreator formularza)                        | widgety `onboarding-form`, `contact-form`, `register-form` + `customize-interests`                                                                                          | 🟡                   | EB-708  |
| `badge templates` w Studio                         | brak                                                                                                                                                                        | 🔴                   | EB-1206 |

**Wnioski**

1. Trzy tryby rejestracji to **jedna kolumna**, nie trzy ścieżki kodu:
   `events.registration_mode ('in_app' | 'external' | 'none')` + `registration_url`.
   Po decyzji zamawiającego („obie formy") tryb `in_app` ma dwa warianty:
   **RSVP jednym kliknięciem** (dzisiejsze zachowanie) i **formularz z akceptacją**
   — czyli czwarta wartość nie jest potrzebna, wystarczy
   `events.registration_flow ('rsvp' | 'form')`. Rozdzielenie „gdzie się rejestruje"
   od „jak wygląda rejestracja" pozwala mieć formularz kwalifikacyjny bez
   zewnętrznego narzędzia i RSVP bez formularza.
2. `Codes` to niespodzianka pozytywna: NES ma **pełny moduł kuponów** (kampanie,
   realizacje, analityka, `/admin/coupons/*`). Kody dostępu do wydarzenia i kody
   rabatowe na bilet to jego zastosowanie, nie nowy byt. Trzeba tylko dopiąć zakres
   „kupon dotyczy tego wydarzenia / tego typu biletu".
3. `Registration widget` (embed HTML na cudzej stronie) jest realnym wymaganiem dla
   NES — kongres promowany na stronach partnerów. To jednak **osobna powierzchnia
   bezpieczeństwa** (CORS, iframe, klucz publiczny). Nie dokładam tego do E5;
   zostaje na osobny etap po rejestracji.
4. Wzmianka o „badge printing on-site" w opisie trybu `In-App` domyka decyzję
   zamawiającego o module onsite: **druk badge'y jest częścią rejestracji**, nie
   dodatkiem — szablon badge'a musi powstać razem z typami biletów (bo badge nosi
   nazwę grupy i typ wejściówki).

### Zrzut 3.5 — `…/registration/ticket-types` · „Tickets"

**Co widać**

- Nota: „Use a single ticket type or multiple based on your event. Tickets can have a
  limited quantity, bounded by dates, and **assign your registrants to a group**."
- Akcje: `Payment settings` (z ikoną „i") · **`Create a ticket`**.
- Tabela z filtrami w nagłówkach (`Status`, `Group`, `Visibility`):
  `Ticket name` · `Status` · `Price` · `Uses` · `Valid from` · `Valid until` ·
  `Group` · `Visibility` · kolejność · menu `…`.
- Trzy wiersze (wszystkie `Ended`, `Free`, `0/Unlimited`, 26–27.03.2025):
  **Partner** → grupa `Exhibitors`, **Uczestnik** → grupa `Attendees`,
  **Prelegent** → grupa `Speakers`. Wszystkie `Visible`.

**Mapowanie**

| Swapcard                                       | NES                                                                                | Stan | Zadanie |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | ---- | ------- |
| wiele typów wejściówek per wydarzenie          | dziś **jedna cena** (`events.ticket_price_cents`, `ticket_currency`)               | 🔴   | EB-709  |
| limit ilościowy per typ (`Uses` `0/Unlimited`) | `events.capacity` (globalny), brak per typ                                         | 🟡   | EB-709  |
| okno sprzedaży (`Valid from` / `Valid until`)  | `events.rsvp_opens_at` (tylko otwarcie, globalne)                                  | 🟡   | EB-709  |
| **typ biletu przypisuje do grupy**             | brak grup — po ich powstaniu: `event_ticket_types.group_id`                        | 🔴   | EB-710  |
| `Visibility` per typ (widoczny/ukryty)         | wzorzec: bilet ukryty dostępny tylko z kodu                                        | 🔴   | EB-711  |
| `Status` (`Ended`) wyliczany z daty            | wyliczenie z okna sprzedaży, nie kolumna                                           | —    | EB-709  |
| `Payment settings`                             | **`/admin/billing`** + Stripe + `payment_orders` + `plan_ticket_claims`            | ✅   | —       |
| `Price: Free`                                  | bilet darmowy = RSVP; ścieżka wolna od płatności istnieje (`confirmFreeRsvpEmail`) | ✅   | —       |
| kolejność typów (drag)                         | `sort_order`                                                                       | 🔴   | EB-709  |

**Wnioski**

1. **To jest brakujące ogniwo całej układanki uprawnień.** Trzy typy biletów
   (`Partner`, `Uczestnik`, `Prelegent`) mapują się jeden-do-jednego na trzy grupy
   (`Exhibitors`, `Attendees`, `Speakers`). Czyli u Swapcarda **typ biletu jest
   mechanizmem nadania grupy**, a grupa nadaje uprawnienia. Łańcuch jest domknięty:
   `typ biletu → grupa → widoczność + narzędzia`. Nasz model musi mieć dokładnie tę
   krawędź (`event_ticket_types.group_id`), bo bez niej administrator nadaje grupy
   ręcznie przy każdym uczestniku.
2. Zgodnie z decyzją zamawiającego („każde wydarzenie indywidualnie") `event_ticket_types`
   wchodzi jako tabela, a `events.ticket_price_cents` staje się **skrótem dla wydarzenia
   z jednym typem** — nie usuwamy go, bo to ścieżka webinaru z jedną ceną i nie warto
   zmuszać redakcji do zakładania typu biletu dla darmowego briefingu. Reguła:
   brak wiersza w `event_ticket_types` ⇒ obowiązuje cena z `events`.
3. Nazwy biletów w danych referencyjnych są **polskie** (`Uczestnik`, `Prelegent`)
   przy angielskich nazwach grup — kolejny dowód, że pola treściowe muszą być
   bliźniacze (`name_pl` / `name_en`), a nie jednojęzyczne.
4. Wszystkie trzy bilety mają `0/Unlimited` przy zamkniętym oknie sprzedaży
   (26–27.03.2025, a wydarzenie jest 26–27.11.2025) — czyli w wydarzeniu referencyjnym
   **rejestracja nigdy nie została otwarta**. To sygnał praktyczny dla UI: panel
   musi ostrzegać, gdy okno sprzedaży biletu nie zawiera się w sensownej relacji
   z datą wydarzenia (typowa literówka: ten sam dzień, inny miesiąc).
5. `Payment settings` jako osobne wejście potwierdza, że konfiguracja płatności jest
   **wspólna dla wydarzeń**, nie per wydarzenie — u nas `/admin/billing` i Stripe.
   Panel wydarzenia ma tam **linkować**, nie duplikować ustawień.

---

## Partia 4 — 2026-08-23 (5 zrzutów: bilet, kody, formularz)

### Zrzut 4.1 — `…/registration/ticket-types` · „Create a ticket" (góra)

**Co widać**

- `Basics` — „Tickets will be available during the specified dates. Hidden tickets can
  be accessed via a direct registration link or selected within Studio."
- `* Ticket name` (z flagą języka) · `* Start date` = `08/23/2026, 12:00 AM` ·
  `* End date` = `09/23/2026, 12:00 AM` · `Quantity` = `No limit` (spinner) ·
  `* Ticket visibility` = przełącznik dwustanowy **Visible** / **Hidden**.
- `Ticket type` — radio **Free** (wybrany) / **Paid**; „If free, you can customize
  the label."
- `Show label` — przełącznik **włączony**: „When enabled, a label will be displayed to
  your registrants. When disabled, it will be hidden." + pole `Label` (`0/40 characters`).
- `Other settings` — „Choose the group to which attendees purchasing this ticket will be
  assigned. Groups help manage permissions and communications.":
  `* Assigned event group` (dropdown `Select group`) + `Description (optional)` (RTE).

**Mapowanie**

| Swapcard                                                       | NES                                                                           | Stan | Zadanie |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---- | ------- |
| nazwa biletu z flagą języka                                    | `event_ticket_types.name_pl/name_en`                                          | 🔴   | EB-709  |
| okno sprzedaży (`Start`/`End date`)                            | `sales_from` / `sales_to`                                                     | 🔴   | EB-709  |
| `Quantity` / `No limit`                                        | `quota int NULL`                                                              | 🔴   | EB-709  |
| `Ticket visibility` + „hidden dostępny z bezpośredniego linku" | `visibility ('visible','hidden')` + link rejestracyjny z parametrem typu      | 🔴   | EB-711  |
| `Free` / `Paid`                                                | `price_cents = 0` vs `> 0`; ścieżka darmowa istnieje (`confirmFreeRsvpEmail`) | 🟡   | EB-709  |
| `Show label` + własna etykieta (40 zn.)                        | etykieta zamiast ceny („Zaproszenie", „Bezpłatny wstęp")                      | 🔴   | EB-712  |
| **`Assigned event group` (wymagane)**                          | `event_ticket_types.group_id NOT NULL`                                        | 🔴   | EB-710  |
| opis biletu (RTE, 500 zn.)                                     | `description_pl/en`                                                           | 🔴   | EB-709  |

**Wnioski**

1. `Assigned event group` jest polem **wymaganym** — potwierdzenie wniosku z zrzutu 3.5
   w mocniejszej formie: u Swapcarda **nie da się** utworzyć biletu bez grupy.
   U nas `group_id` też ma być `NOT NULL`, a przy zakładaniu wydarzenia trzy grupy
   systemowe muszą już istnieć, żeby pierwszy bilet dał się zapisać. Kolejność
   w kreatorze: rodzaj wydarzenia → grupy systemowe → bilety.
2. „Hidden ticket dostępny przez bezpośredni link" to mechanizm zaproszeń imiennych
   bez osobnego modułu: link `?ticket=<id>` odsłania ukryty typ. U nas ten sam wzorzec
   ma już `club_invite_links` (token + limit użyć), więc link do ukrytego biletu
   powinien być **tokenem z limitem**, a nie golym identyfikatorem w URL — inaczej
   pierwszy przekazany link staje się publiczny.
3. `Show label` wygląda jak drobiazg, a jest realną potrzebą redakcji: „Free" po
   angielsku na polskim wydarzeniu to zły komunikat, a „Zaproszenie" znaczy coś innego
   niż „Bezpłatny". Dwa pola (`label_pl`, `label_en`, 40 znaków) załatwiają sprawę.

### Zrzut 4.2 — „Create a ticket" (dół)

**Co widać**

- Koniec `Other settings` (grupa + opis, `0/500 characters`).
- `Moderated Registration` — **`Add-on`**: „Registrations with this ticket will stay in
  pending status until approved or rejected, giving you full control over attendee access."
- `Group registration` — **`Add-on`**: „Allow your attendees to purchase multiple tickets
  and register a group on their behalf."
- `Ticket preview` — „View how the ticket appears to registrants": karta z
  `Ticket name`, `Free`, `Available until wt., 22 wrz 2026`.
- Stopka: `Cancel` · `Create`.

**Mapowanie**

| Swapcard                                                | NES                                                                                                            | Stan | Zadanie |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| **moderacja per TYP BILETU** (nie per wydarzenie)       | `event_ticket_types.moderated boolean` → `event_registrations.status = 'pending'`                              | 🔴   | EB-713  |
| rejestracja grupowa (kupno wielu wejściówek dla innych) | **wzorzec istnieje**: `organization_seats` (zaproszenia po e-mailu, `claimed_at`, role) + `plan_ticket_claims` | 🟡   | EB-714  |
| podgląd karty biletu                                    | wzorzec podglądów w panelu (`LayoutPreview`)                                                                   | 🟡   | EB-715  |
| data w podglądzie po polsku (`wt., 22 wrz 2026`)        | `date-fns` z lokalizacją — w repo obecny                                                                       | ✅   | —       |

**Wnioski**

1. **Korekta wcześniejszego założenia.** W §4.4 dokumentu nadrzędnego postawiłem
   `approval_mode` na **formularzu** (`event_registration_forms`). Ten ekran pokazuje,
   że moderacja siedzi na **typie biletu** — i to jest lepsze: „Uczestnik" wchodzi
   automatycznie, a „Partner" i „Prelegent" wymagają zatwierdzenia, przy jednym
   formularzu. Poprawka: `event_ticket_types.moderated boolean NOT NULL DEFAULT false`,
   a `approval_mode` na formularzu zostaje jako wartość domyślna dla biletów bez ustawienia.
2. Rejestracja grupowa („kupuję pięć wejściówek dla zespołu") to dokładnie ta sama
   mechanika, co miejsca w organizacji: kupujący zostaje właścicielem, zaproszeni
   odbierają wejściówki po e-mailu. Nie budujemy tego od zera — `organization_seats`
   ma już `invited_email`, `claimed_at`, `status`, `grace_until`.
3. Podgląd biletu jest tanim, a wysoko punktowanym elementem UX panelu: pokazuje
   dokładnie to, co zobaczy uczestnik, w jego języku i z jego formatem daty.

### Zrzut 4.3 — `…/registration/promo-codes` · „Registration codes"

**Co widać**

- Ekran powitalny: „Create and manage codes for discounts or event access, boosting
  customer acquisition and engagement. Target specific segments with tailored discounts
  to enhance the purchasing experience and foster long-term loyalty."
  Przyciski `Create a code` · `Learn more`.
- `How does it work?` — trzy kroki: **1 Create codes** („generate discount or access
  codes with customizable options"), **2 Share your codes** („Distribute your codes with
  potential registrants"), **3 Monitor usage** („Track code redemptions and analyze
  their impact on sales and attendance").

**Mapowanie**

| Swapcard                                         | NES                                                                                                                                          | Stan               | Zadanie |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------- |
| kody rabatowe                                    | **`/admin/coupons`** — kampanie (`admin.coupons.campaigns`), realizacje (`admin.coupons.redemptions`), analityka (`admin.coupons.analytics`) | ✅ **pełny moduł** | EB-707  |
| kody **dostępu** (odsłaniają ukryty bilet)       | brak semantyki „kod odsłania typ biletu"                                                                                                     | 🔴                 | EB-716  |
| „Monitor usage" — realizacje i wpływ na sprzedaż | `admin.coupons.redemptions` + `admin.coupons.analytics`                                                                                      | ✅                 | —       |
| celowanie kodu w segment                         | segmenty CRM / reguły (`club_segment_rules` jako wzorzec)                                                                                    | 🟡                 | EB-717  |

**Wnioski**

1. Cała ta sekcja to u nas **jeden przełącznik zakresu** na istniejącym module kuponów:
   „kupon dotyczy wydarzenia X / typu biletu Y". Zero nowych tabel, zero nowego UI
   poza filtrem. To najlepszy stosunek wartości do pracy w całym module.
2. Rozróżnienie **rabat vs dostęp** jest jednak realne i trzeba je nazwać: kod dostępu
   nie zmienia ceny, tylko **odsłania ukryty typ biletu** (zrzut 4.1). To druga
   semantyka na tym samym obiekcie — w modelu kuponów wystarczy `kind ('discount','access')`.

### Zrzut 4.4 — `…/registration/forms` · „Form" (kreator, góra)

**Co widać**

- „Build your registration form by adding pages and fields. The First name, Last name,
  and Email **cannot be modified**. The form background can be modified on the
  **branding page**." + `Learn how`.
- Przełącznik `Expand` / `Collapse`; górny pasek ma `Preview form` obok `Publish event`.
- Karta strony formularza **`Event registration`** z polami: `* Email`, `* First name`,
  `* Last name`, `* Job title`, `* Company`, `* Mobile phone` (z flagą kraju),
  `Website`, `LinkedIn` („Paste a valid url"), `Profile picture`.
- Prawy panel **`Add fields`** — „Drag and drop fields at the desired position on the
  form preview.":
  - `Basic fields`: `First name` ✓, `Last name` ✓, `Email` ✓, `Job title` ✓,
    `Company` ✓, `Biography`, `Mobile phone` ✓, `Landline`, `Website` ✓, `Address`,
    `Profile picture` ✓, `Text block` (z ikoną „i").
  - `Custom fields`: `LinkedIn` ✓, `Type` + przycisk **`Create custom field`**.

**Mapowanie**

| Swapcard                                                                                                           | NES                                                                                                                                           | Stan                  | Zadanie |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------- |
| kreator formularza (strony + pola, drag & drop)                                                                    | **wzorzec istnieje**: builder (sekcja→kolumna→widget, `@dnd-kit`) oraz widgety `onboarding-form` / `register-form` / `contact-form`           | 🟡                    | EB-708  |
| słownik typów pól                                                                                                  | `CustomFieldType` w `src/lib/content-model/formFields.ts`: `text, email, tel, url, textarea, select, checkbox` + `CustomField` z i18n etykiet | ✅ **gotowy słownik** | EB-718  |
| pola nieusuwalne (imię, nazwisko, e-mail)                                                                          | odpowiednik: pola systemowe formularza                                                                                                        | 🔴                    | EB-708  |
| pola mapowane na profil (`Job title`, `Company`, `Biography`, `Website`, `Address`, `Profile picture`, `LinkedIn`) | `profiles` + `profiles_public` + `author_profiles` + `speaker_profiles`                                                                       | 🟡                    | EB-719  |
| `Text block` (treść, nie pole)                                                                                     | odpowiednik: widget tekstowy w formularzu                                                                                                     | 🔴                    | EB-708  |
| `Create custom field`                                                                                              | `CustomField` (widget) — brak **trwałego słownika pól** per tenant                                                                            | 🟡                    | EB-720  |
| tło formularza z ekranu brandingu                                                                                  | potwierdza §4.10: branding obejmuje **zakres**, nie stronę                                                                                    | —                     | EB-401  |

**Wnioski**

1. Kluczowa różnica: u Swapcarda pola formularza **mapują się na profil uczestnika**
   (`Job title`, `Company`, `Biography` to pola profilu, nie odpowiedzi ankiety).
   To znaczy, że rejestracja **zasila profil**, a nie tylko zbiera `answers jsonb`.
   Nasz model musi to rozdzielić: pola profilowe → `profiles` (z polityką edycji,
   zrzut 5.2), pytania kwalifikacyjne → `event_registrations.answers`.
   Bez tego rozdziału albo duplikujemy dane profilu w odpowiedziach, albo tracimy
   pytania kwalifikacyjne przy edycji profilu.
2. Słownik typów pól **już mamy** (`formFields.ts`) i jest wystarczający na start
   (7 typów z i18n). Rekomendacja z §10.3 dokumentu nadrzędnego zostaje: najpierw
   stały zestaw pól profilowych + lista pytań kwalifikacyjnych z tych 7 typów,
   dopiero potem pełny kreator z drag & drop.
3. „Pola nieusuwalne" to dobra reguła do skopiowania: e-mail jest kluczem tożsamości,
   więc nie może być opcjonalny ani usunięty. W naszym modelu to walidacja schematu
   formularza, nie uprawnienie.

### Zrzut 4.5 — „Form" (kreator, dół) + ekran podziękowania

**Co widać**

- Koniec pól: `Mobile phone`, `Website`, `LinkedIn`, `Profile picture`
  („Import a nice picture in 240x240px minimum and no larger than 1MB").
- **`+ Add a new page`** — formularz jest wielostronicowy.
- Karta ekranu końcowego (z ołówkiem edycji): ✓ **„Thank you for registering"** —
  „We've sent you an email with a link that will connect you to the event once it's
  live." + kafel wydarzenia (okładka, nazwa, `Wed, Nov 26, 2025 9:00 AM - Thu, Nov 27,
2025 7:00 PM`) + przycisk `Open the event`.

**Mapowanie**

| Swapcard                         | NES                                                                                | Stan | Zadanie |
| -------------------------------- | ---------------------------------------------------------------------------------- | ---- | ------- |
| formularz wielostronicowy        | `onboarding-form` ma kroki (`steps`)                                               | 🟡   | EB-708  |
| ekran podziękowania (edytowalny) | wzorzec: `/checkout/success`, potwierdzenia RSVP, `confirmFreeRsvpEmail`           | 🟡   | EB-721  |
| e-mail z linkiem do wydarzenia   | `rsvp-email.functions.ts` + szablony systemowe (`/admin/newsletter/system-emails`) | ✅   | —       |
| limity obrazu (240×240, ≤1 MB)   | `/admin/crop-sizes` + walidacja uploadu                                            | ✅   | —       |

**Wnioski**

1. Ekran podziękowania jest **częścią formularza**, nie osobną stroną — i słusznie:
   niesie kafel wydarzenia i CTA. U nas to jeden krok schematu formularza
   (`schema.thankYou`), a nie strona w `pages`; strona byłaby przesadą dla treści,
   która żyje wyłącznie po wysłaniu formularza.
2. Zdanie „link that will connect you to the event **once it's live**" ujawnia, że
   Swapcard rozdziela **rejestrację** od **dostępu**: zapisany uczestnik czeka na
   otwarcie wydarzenia. U nas odpowiednikiem jest `events.status` + `join_url` za
   `get_event_access` — mechanizm jest, brakuje komunikatu w tym miejscu ścieżki.

---

## Partia 5 — 2026-08-23 (4 zrzuty: Content → People)

### Zrzut 5.1 — `…/people?page=1` · „People"

**Co widać**

- Sidebar: `Content` rozwinięte na **People** · **Sessions** · **Exhibitors** ·
  **Items** · **Documents & Links** · **Feed channels** · **Discussions**.
- „Easily manage attendees by adding, editing, or deleting profiles. Import attendee
  lists, assign groups, and control their visibility…"
- Cztery kafle KPI: `0 Registered` (z filtrem) · `0 Checked-in` · `0 Canceled`
  (z filtrem) · `0 Abandoned` **`Add-on`**.
- `Search people` · `People settings` · `Export` · **`Create people`**.
- Tabela: `Onsite` (dwie ikony statusu) · `Reg status` (filtr) · avatar ·
  `First name` (sort) · `Last name` (sort) · `Emails` (filtr) · `Groups` (filtr) ·
  `Job title` (sort) · `Company` · `Member of` · `Registered…`
- Wiersze (21 osób, `1 – 10 of 21`, `Nb / page = 10`): m.in. Dorota Matuszak-Jasik
  (`No account`, grupa `Speakers`, `dr`, New European Strategies), Igor Miasnikow
  (`office@neweuropeanstrategies.com`, `Attendees + 2 groups`, `CEO`, `Member of:
New European Strategies`), Jacek Bartosiak (`No account`, `Speakers`, `CEO`,
  Strategy & Future), Jakub Wiśniewski (OECD), Jakub Sawulski (PIE), Jarosław
  Grzywiński (NASK), Konrad Muzyka (Rochan Consulting), Krzysztof Kalicki
  (Deutsche Bank), Lech Kurkliński (SGH), Ludwik Kotecki (RPP).

**Mapowanie**

| Swapcard                                                 | NES                                                                                             | Stan            | Zadanie |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------- | ------- |
| **uczestnik BEZ konta** (`No account`)                   | `event_rsvps.user_id` → `auth.users` **NOT NULL**; uczestnik bez konta jest dziś **niemożliwy** | 🔴 **kluczowe** | EB-722  |
| lista uczestników z filtrami i sortowaniem               | wzorzec: `/admin/users`, `/admin/crm` (tabele z filtrami, `BulkActionsBar`)                     | 🟡              | EB-723  |
| `Groups` per osoba (wielokrotne: „Attendees + 2 groups") | `event_group_members` (osoba w wielu grupach)                                                   | 🔴              | EB-301  |
| `Reg status`                                             | `event_registrations.status`                                                                    | 🔴              | EB-724  |
| `Onsite` (dwie ikony: check-in / badge)                  | `event_checkins` + druk badge'a                                                                 | 🔴              | EB-1201 |
| KPI `Registered / Checked-in / Canceled`                 | liczniki z `event_registrations` + `event_checkins`                                             | 🔴              | EB-724  |
| KPI `Abandoned` (porzucona rejestracja)                  | brak — wymaga zapisu rozpoczętej, niedokończonej rejestracji                                    | 🔴              | EB-725  |
| `Member of` (organizacja)                                | `member_organizations` + `organization_seats`                                                   | ✅              | —       |
| `Export`                                                 | wzorzec eksportów CSV (`src/lib/csv`)                                                           | ✅              | —       |
| `Create people` (ręcznie)                                | brak dla wydarzeń; wzorzec: `/admin/users/invitations`                                          | 🔴              | EB-726  |

**Wnioski**

1. **To jest najważniejsze odkrycie całej partii i zmienia model danych.** 21 osób,
   w tym prelegenci z realnych instytucji (OECD, NASK, SGH, RPP), ma `No account` —
   czyli w Swapcardzie **uczestnik jest rekordem, nie użytkownikiem**. Konto powstaje
   dopiero, gdy człowiek kliknie link. Nasz model tego nie unosi: `event_rsvps.user_id`
   i `event_speakers.user_id` wskazują `auth.users`, więc żeby wpisać prelegenta do
   agendy, trzeba mu **założyć konto** — czego redakcja nie zrobi za 21 osób i czego
   nie powinna robić bez ich wiedzy (konto to dane osobowe i logowanie).
   Konsekwencja: `event_registrations` musi mieć `user_id uuid NULL` + `email`,
   `first_name`, `last_name`, `job_title`, `company`, a powiązanie z kontem następuje
   **przy pierwszym logowaniu** (dopasowanie po znormalizowanym e-mailu, wzorzec
   `crm_leads.email_norm`). To samo dotyczy prelegentów: `event_speakers` musi
   dopuścić prelegenta bez konta (dziś `speaker_profiles.user_id` też jest wymagane).
2. `Abandoned` (porzucona rejestracja) wymaga zapisywania rejestracji **przed**
   dokończeniem — czyli wiersza `event_registrations` ze statusem `draft` od pierwszego
   kroku. To decyzja o prywatności: zapisujemy e-mail kogoś, kto się nie zapisał.
   Rekomendacja: `draft` z **krótką retencją** (np. 30 dni) i bez wysyłki
   marketingowej — inaczej to zbieranie danych bez podstawy.
3. `Groups` pokazuje osobę w wielu grupach naraz („Attendees + 2 groups"), więc
   `event_group_members` jest relacją wiele-do-wielu, a nie kolumną na uczestniku.
   Uprawnienie wypadkowe = **suma** zdolności z grup (najbardziej pozwalająca wygrywa),
   co trzeba zapisać wprost w `event_capabilities()`, bo domyślne „iloczyn" dałoby
   odwrotny efekt.

### Zrzut 5.2 — `…/people/settings/profile-edition` · „People settings"

**Co widać**

- Zakładki: `Custom fields` · **`Basic fields edition`**.
- `People editable fields` — „Define which information people can add or edit in their
  profile. **The settings are applied universally across all events within the
  community.**" + `Enable all`.
- Pola z przełącznikami: `Profile picture` **ON**, `First name` **OFF**, `Last name`
  **OFF**, `Job title` ON, `Company` ON, `Biography` ON, `Profile email` **OFF**,
  `Address` ON, `Phone numbers` ON, `Social networks` ON, `Website` ON.
- Nota prawna: „These fields may contain personal data, for which you, as organizer are
  the data controller and responsible as such for compliance with applicable rules,
  including possibility for users to rectify the information."

**Mapowanie**

| Swapcard                                                 | NES                                                                                  | Stan | Zadanie |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---- | ------- |
| polityka pól profilu („co uczestnik może edytować")      | brak; najbliżej: `/admin/permissions` (macierz uprawnień, snapshot authz)            | 🔴   | EB-727  |
| zakres **tenanta**, nie wydarzenia                       | ważna korekta wobec zrzutu 2.2                                                       | —    | EB-727  |
| `First name` / `Last name` / `Profile email` zablokowane | tożsamość ustala organizator, nie uczestnik                                          | 🔴   | EB-727  |
| zakładka `Custom fields` (słownik pól tenanta)           | `CustomField` (widget) + `post_custom_meta_defs` jako wzorzec **definicji pól**      | 🟡   | EB-720  |
| nota o roli administratora danych                        | `/admin/settings/privacy`, `user_consents`, RODO w repo (retencja, izolacja tenanta) | ✅   | —       |

**Wnioski**

1. **Korekta wniosku z zrzutu 2.2.** Uznałem tam politykę pól za rzecz per wydarzenie
   (dla wystawców). Ten ekran pokazuje, że u Swapcarda polityka pól profilu jest
   **wspólna dla całej społeczności** — i to jest właściwy poziom: profil człowieka
   nie zmienia się między wydarzeniami. Poprawka do modelu: `profile_field_policy`
   (tenant, field, editable) — jedna tabela na tenanta, nie na wydarzenie.
2. Blokada `First name` / `Last name` / `Profile email` jest przemyślana: przy
   drukowanym badge'u i liście uczestników organizator musi mieć pewność, że nazwisko
   na identyfikatorze nie zmieni się po wydruku. To argument, żeby skopiować domyślne
   ustawienia Swapcarda 1:1, a nie zaczynać od „wszystko edytowalne".
3. Nota o roli administratora danych to nie ozdoba: przy module onsite i skanowaniu
   badge'y organizator faktycznie staje się administratorem danych uczestników.
   Warto ją mieć w panelu w tym samym miejscu (nad polityką pól), bo tam podejmuje
   się decyzję, która ją uruchamia. Wymóg „possibility for users to rectify" jest
   wprost realizowany przez edytowalność pól — czyli wyłączenie wszystkiego byłoby
   problemem prawnym, nie tylko UX-owym.

### Zrzuty 5.3 i 5.4 — dialog „Create manually" (z listą grup)

**Co widać**

- Dialog `Create manually` (strzałka powrotu do wyboru metody — obok zapewne „Import"):
  - `* Group` — dropdown; rozwinięty pokazuje: `Exhibitors`, `Speakers`, `Attendees`.
  - `* Primary account email (login and communications)` — „Filling out this field will
    automatically populate their profile email with the same email address visible to
    their connections."
  - `* First name`, `* Last name`, `Job title`, `Company`.
  - Przycisk `Create people`.

**Mapowanie**

| Swapcard                                             | NES                                                                                 | Stan | Zadanie |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ---- | ------- |
| ręczne dodanie uczestnika z grupą                    | `event_registrations` z `user_id NULL` (zrzut 5.1) + `event_group_members`          | 🔴   | EB-726  |
| rozdzielenie **e-maila konta** i **e-maila profilu** | `auth.users.email` vs `profiles`/`profiles_public` — rozdział istnieje w platformie | ✅   | —       |
| grupa wymagana przy tworzeniu                        | trzy grupy systemowe muszą istnieć od utworzenia wydarzenia                         | 🔴   | EB-301  |
| „Import" (druga metoda, poza zrzutem)                | wzorzec importu: `WxrUploadPanel`, `WordPressImportDialog`, import CSV w CRM        | 🟡   | EB-728  |

**Wnioski**

1. Dialog potwierdza model z zrzutu 5.1: **osoba tworzona bez konta**, z e-mailem jako
   przyszłym kluczem logowania. Nasz odpowiednik to „rejestracja wpisana przez
   organizatora": wiersz `event_registrations` (`status = 'approved'`) + wpis do grupy,
   bez `auth.users`. Zaproszenie do konta wysyła się osobno i opcjonalnie.
2. Rozdzielenie „e-mail konta (login) / e-mail profilu (widoczny dla kontaktów)" jest
   dokładnie tym, co NES już ma. Warto to podkreślić w ofercie: rejestracja nie zmusza
   uczestnika do ujawnienia adresu logowania innym uczestnikom.
3. Wymaganie grupy przy tworzeniu osoby (drugi raz po bilecie — zrzut 4.1) domyka
   regułę: **każdy uczestnik ma dokładnie jedną grupę podstawową** i opcjonalnie
   dodatkowe (zrzut 5.1: „Attendees + 2 groups"). W modelu: `event_registrations.group_id`
   (podstawowa, `NOT NULL`) + `event_group_members` (dodatkowe).

---

## Partia 6 — 2026-08-23 (sesje: lista, szczegóły, format)

Ta partia domyka **największą lukę** specyfikacji: model sesji (§0.2 dokumentu
nadrzędnego). Wnioski są tu najcięższe w całym mapowaniu.

### Zrzut 6.1 — `…/plannings` · „Sessions" (lista)

**Co widać**

- „Allow people to plan their schedule, save time and keep them informed on the latest
  updates." + `Learn how`.
- `Search sessions` · `Session settings` · `Export` · **`Create sessions`**.
- Tabela: `Format` (filtr) · `Title` (sort) · `Description` · `Date` (sort) · `Type` ·
  `Location` · `Topics` · `Speakers` (sort) · `Exhibitors` (sort) · `Attendees`.
- Sześć sesji (`1 – 6 of 6`), wszystkie `In-person (no video)`, wszystkie
  `Wednesday, November 27,…`:
  | Sesja                                          | Godziny     | Speakers | Exhibitors | Attendees |
  | ---------------------------------------------- | ----------- | -------- | ---------- | --------- |
  | Uroczyste otwarcie konferencji…                | 9:00–9:05   | 1        | 1          | –         |
  | Aktywność Polski w organizacjach…              | 9:05–10:00  | 4        | 2          | 1         |
  | Bezpieczeństwo Europy – NATO czy budowa…       | 10:00–11:45 | 4        | 1          | –         |
  | Innowacyjna bankowość, a gdzie przedsiębiorcy? | 12:00–13:45 | 4        | 1          | 1         |
  | Przyszłość reguł fiskalnych w Unii…            | 14:00–15:45 | 4        | 1          | 1         |
  | Mobilność wojskowa państw na wschodniej…       | 16:00–17:45 | 4        | 3          | –         |

**Mapowanie**

| Swapcard                                                   | NES                                                                 | Stan | Zadanie |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ---- | ------- |
| sesja jako **encja z listą, filtrami i eksportem**         | agenda żyje w treści widgetu `event-schedule` (`days[].sessions[]`) | 🔴   | EB-801  |
| `Format` sesji (filtr)                                     | brak                                                                | 🔴   | EB-802  |
| `Type` / `Location` / `Topics` jako **kolumny listy**      | brak (patrz zrzut 6.2: to pola własne)                              | 🔴   | EB-803  |
| liczniki `Speakers` / `Exhibitors` / `Attendees` per sesja | `event_speakers` jest na WYDARZENIU, nie na sesji                   | 🔴   | EB-804  |
| `Create sessions` (mnoga!)                                 | tworzenie wsadowe / import agendy                                   | 🔴   | EB-805  |
| `Export`                                                   | wzorzec CSV (`src/lib/csv`)                                         | ✅   | —       |
| `Session settings`                                         | słownik pól własnych sesji (zrzut 6.2)                              | 🔴   | EB-806  |

**Wnioski**

1. Sześć sesji z 4 prelegentami każda i 21 osobami w bazie ludzi to **realny rozmiar
   agendy NES**, i on rozstrzyga spór z §0.2: takiej agendy nie prowadzi się w JSON-ie
   widgetu. Dwa liczniki („Speakers 4", „Exhibitors 3") są zapytaniami do relacji;
   w treści widgetu trzeba by je liczyć w kliencie po ręcznie wpisanej tablicy.
2. Wszystkie sesje mają datę **27 listopada**, a wydarzenie zaczyna się **26**.
   To albo drugi dzień kongresu (i pierwszy dzień nie ma jeszcze agendy), albo
   literówka. Wniosek dla panelu: lista sesji musi **ostrzegać**, gdy sesja wypada
   poza zakresem `events.starts_at`–`ends_at` (a nie tylko przyjmować dowolną datę).
3. Kolumna `Description` jest w tabeli, ale wszystkie wartości to `-`. Redakcja
   nie wypełni opisu sesji z tabeli; opis żyje w szczegółach. Kolumna jest tu
   dowodem, że tabela służy do **kontroli kompletności** (co jest puste), a nie do
   czytania treści — nasza lista powinna to podkreślić statusem „niekompletna".

### Zrzut 6.2 — szczegóły sesji · zakładka „Details" (góra)

**Co widać**

- Tytuł: „Uroczyste otwarcie konferencji »Geopolityczna Gra Mocarstw«".
- Zakładki: `Details` · `Format & video` · `Speakers (1)` · `Exhibitors (1)` ·
  `Attendees` · `Sessions` · `Documents & Links` · `Preferences`.
- `Basics` → `Header picture` (miniatura; „Import a rectangular image (16:9 ratio),
  size of 1920x1080px and no larger than 1MB is perfect") z kadrowaniem i usuwaniem;
  `* Session name` (z flagą języka); `* Date` = `Wed, Nov 27, 2024`;
  `* Start time` = `9:00:00 AM`; `* End time` = `9:05:00 AM`.
- `Information` — „Fill the custom fields you created in Session Settings. This allows
  you to define specific categories, filters or details about this session…":
  `Type` = `None` (+ `Edit field`), `Location` = `None` (+ `Edit field`),
  `Topics` = „Select one or several values" (+ `Edit field`),
  link **`Manage session custom fields`**.
- `Description` — RTE (B, U, listy, link) z flagą języka.

**Mapowanie**

| Swapcard                                                       | NES                                                                                                  | Stan               | Zadanie |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------ | ------- |
| nazwa sesji i18n, data, godzina start/koniec                   | `event_sessions` (§4.2)                                                                              | 🔴                 | EB-801  |
| `Header picture` per sesja (16:9, 1920×1080)                   | wzorzec `CoverImagePicker` + `/admin/crop-sizes`                                                     | 🟡                 | EB-807  |
| **`Type` / `Location` / `Topics` to POLA WŁASNE**, nie kolumny | wzorzec definicji pól: `post_custom_meta_defs` + `CustomMetaValuesEditor.tsx` + `/admin/custom-meta` | 🟡 **wzorzec 1:1** | EB-806  |
| `Manage session custom fields`                                 | `/admin/custom-meta` jako wzorzec ekranu definicji                                                   | 🟡                 | EB-806  |
| opis sesji (RTE, i18n)                                         | `description_pl/en`                                                                                  | 🔴                 | EB-801  |
| rok `2024` przy wydarzeniu w `2025`                            | walidacja zakresu daty sesji                                                                         | —                  | EB-808  |

**Wnioski**

1. **Korekta modelu z §4.2.** Zaproponowałem tam `room text` i `track text` jako
   kolumny. Swapcard trzyma `Type`, `Location` i `Topics` jako **pola własne
   definiowane per wydarzenie** — i to jest elastyczniejsze (jedno wydarzenie ma
   ścieżki, inne sale, trzecie „poziom zaawansowania"). Poprawka: zostawiamy
   `location text` i `track text` jako pola **pierwszej klasy** (potrzebne do
   wykrywania kolizji i do onsite), a dodajemy słownik pól własnych
   `event_session_field_defs` + `event_session_field_values` na wzór
   `post_custom_meta_defs`. Kolumny dla tego, co silnik musi rozumieć; pola własne
   dla tego, co jest treścią.
2. `Topics` z wielokrotnym wyborem to filtr agendy dla uczestnika („pokaż mi
   bezpieczeństwo"). W NES jest już taksonomia (`tags`, `club_topics`,
   `club_specializations`) — rekomendacja: `Topics` sesji podpiąć pod **istniejące
   tagi**, a nie tworzyć czwartą taksonomię.
3. Godziny z sekundami (`9:00:00 AM`) i osobne `Date` + `Start/End time` zamiast
   `timestamptz` to ślad po strefach czasowych: sesja żyje w strefie **wydarzenia**,
   nie uczestnika. W naszym modelu (`starts_at timestamptz` + `events.timezone`)
   trzeba to jawnie zapisać w panelu: „godziny podajesz w strefie wydarzenia
   (Europe/Warsaw)". Inaczej redakcja wpisze 9:00 i dostanie 10:00 na ekranie.

### Zrzut 6.3 — szczegóły sesji · „Details" (dół): interakcje na żywo

**Co widać**

- `Live interactions` — „The Live interaction box enables participants to chat, ask
  questions to speakers, and respond to polls. Additionally, it integrates seamlessly
  with third-party tools such as **Slido, Sparkup, Validar, Captello, LiveVoice, and
  Interprefy**… you can't have more than 5 features tabs enabled." + `Learn how`.
  - `Interaction box label` (0/30 znaków, z flagą języka).
  - `Features` (z uchwytami przeciągania — kolejność zakładek):
    **Chat** („Allow audience to send messages") **ON**;
    **Questions** („Allow audience to ask and upvote questions") **ON**;
    **Polls** („Allow audience to answer polls and quizes") **ON**;
    `+ Embed third-party service`.
  - `Remove live interactions`.
- `Resources` — „Add redirecting links to your session. For example, to an interactivity
  tool, a feedback form, or any website of your choice.": `Add an existing link` ·
  `Or create new`.
- `IDs` → `Internal IDs` = `UGxhbm5pbmdfMjAwNDQzMg==` z kopiowaniem.

**Mapowanie**

| Swapcard                                  | NES                                                                                                                                            | Stan                      | Zadanie |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------- |
| **Chat** przy sesji                       | `conversations` + `messages` + `/admin/community/chat`                                                                                         | ✅ rdzeń                  | EB-809  |
| **Questions z upvote**                    | `club_thread_questions` + `club_thread_question_votes` **oraz** `qa_sessions` + `qa_questions` (moderacja: pending/approved/rejected/answered) | ✅ **dwa gotowe silniki** | EB-810  |
| **Polls**                                 | `club_thread_polls` + `/admin/community/polls` + `/polls`                                                                                      | ✅                        | EB-811  |
| kolejność i limit 5 zakładek              | konfiguracja skrzynki interakcji per sesja                                                                                                     | 🔴                        | EB-812  |
| `Embed third-party service` (Slido i in.) | `/admin/integrations` + widget embed                                                                                                           | 🟡                        | EB-813  |
| `Resources` (linki przy sesji)            | wzorzec `club_thread_links`                                                                                                                    | 🟡                        | EB-814  |
| `Internal IDs`                            | `event_sessions.id` widoczne w panelu                                                                                                          | 🔴                        | EB-808  |

**Wnioski**

1. **Najmocniejszy punkt ponownego użycia w całym module.** Trzy funkcje, które
   Swapcard sprzedaje jako „Live interaction box", NES ma w produkcji: czat 1-1
   i grupowy, Q&A z głosowaniem i moderacją (dwa niezależne silniki: klubowy
   i sesyjny `qa_sessions`), oraz ankiety. Praca to **przypięcie ich do sesji**
   (`session_id` + konfiguracja zakładek), nie budowa. To warto policzyć w ofercie:
   parytet z Swapcardem w tej sekcji jest osiągalny w dniach, nie tygodniach.
2. „Nie więcej niż 5 zakładek" to mądre ograniczenie UX-owe (skrzynka interakcji jest
   wąska na telefonie). Skopiować, razem z kolejnością przez przeciąganie (`@dnd-kit`
   jest w repo).
3. Integracje z Slido/Interprefy pokazują, że Swapcard **nie próbuje** zrobić
   tłumaczenia symultanicznego ani zaawansowanych ankiet — osadza cudze narzędzia.
   Dla NES to sensowna granica: `Resources` + embed, zero własnego tłumaczenia.

### Zrzut 6.4 — modal „Select format & video"

**Co widać**

Sześć formatów sesji (radio z ikonami):

1. **No video** (wybrany) — „Create a simple session without video. Adapted to
   in-person events."
2. **Swapcard Backstage** — „Use our live broadcasting studio, accessible in one click
   by the speakers, and in which you moderate who is on stage in real-time."
3. **RTMP stream from 3rd-party tool** (wyszarzone) — „Connect with RTMP an external
   broadcast software like OBS, Zoom, or Restream, that will be stream on our player."
4. **Embedded video hosting platform** — „Embed an external online video provider like
   YouTube, Vimeo or any other that provides iframe."
5. **Video file** — „Upload a video file that will be available on-demand or streamed
   as live at a scheduled time."
6. **Roundtable** — „Create a meeting room where your participants will be able to join."

**Mapowanie**

| Swapcard                                 | NES                                                                  | Stan           | Zadanie |
| ---------------------------------------- | -------------------------------------------------------------------- | -------------- | ------- |
| `No video`                               | sesja stacjonarna                                                    | 🔴 (nowe pole) | EB-802  |
| `Swapcard Backstage` (własne studio)     | **poza zakresem NES** — własne studio transmisyjne to osobny produkt | ⛔             | —       |
| `RTMP stream`                            | brak; wymagałby playera i wejścia RTMP                               | ⛔/🔴          | —       |
| `Embedded video hosting platform`        | `events.join_url` / `recording_url` + widget wideo + `live.tsx`      | ✅             | EB-815  |
| `Video file` (on-demand lub „jako live") | media w repo (audio/wideo, `/admin/media`)                           | 🟡             | EB-816  |
| `Roundtable` (pokój spotkań)             | `meeting_slots` / `meeting_bookings`; pokój wideo = link zewnętrzny  | 🟡             | EB-817  |

**Wnioski**

1. Rekomendacja zakresu: `event_sessions.format` z wartościami
   `in_person | embedded_video | video_file | roundtable | external_stream`
   (bez własnego studia i bez wejścia RTMP — to infrastruktura wideo, nie CMS).
   Pięć wartości pokrywa wszystko, co NES realnie robi: sesje stacjonarne kongresu,
   webinar na YouTube/Vimeo, nagranie po wydarzeniu, okrągły stół w pokoju wideo.
2. `Video file` „streamed as live at a scheduled time" (premiera nagrania) to funkcja,
   którą NES może dostać niemal darmo — mamy harmonogram publikacji i media.
   Wart zanotowania jako różnicownik dla webinarów odtwarzanych w kółko.
3. Wyszarzony `RTMP` w interfejsie to element planu taryfowego. Warto pamiętać przy
   porównaniach: część „funkcji" Swapcarda to pozycje cennika, nie zdolności.

---

## Partia 7 — 2026-08-23 (sesje: zakładki i preferencje)

### Zrzut 7.1 — zakładka „Speakers (1)"

**Co widać**

- „Link contributors to the session in order to highlight them on the app and let
  participants contact them." + przycisk **`Manage roles`** (link zewnętrzny).
- Grupa roli **`Wykładowcy`** z kartą osoby: Igor Miasnikow · CEO · New European
  Strategies. Poniżej `+ Add people`.

**Mapowanie**

| Swapcard                                                                           | NES                                                           | Stan | Zadanie |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---- | ------- |
| prelegent **przy sesji** (nie tylko przy wydarzeniu)                               | `event_speakers` jest tylko na wydarzeniu                     | 🔴   | EB-804  |
| **role prelegentów** jako słownik („Wykładowcy", zapewne też Moderator, Panelista) | brak; wzorzec: `club_members.role`, `event_speakers` bez roli | 🔴   | EB-818  |
| `Manage roles` (edycja słownika ról)                                               | wzorzec: `/admin/community/clubs/topics`, `/admin/names`      | 🟡   | EB-818  |
| karta osoby z tytułem i firmą                                                      | `profiles` + `speaker_profiles` + `get_public_speakers`       | ✅   | —       |

**Wnioski**

1. Rola przy sesji jest **konieczna** dla formatu debaty: panel ma moderatora
   i panelistów, a to nie ozdoba — moderator wyświetla się inaczej na karcie sesji
   i inaczej jest liczony w statystykach. Model: `event_session_speakers(session_id,
person_id, role_id, sort_order)` + `event_speaker_roles(event_id, key, name_pl/en,
sort_order)` z domyślnymi: `moderator`, `panelist`, `lecturer` („Wykładowcy"),
   `host`, `guest`.
2. Nazwa roli („Wykładowcy") jest **polska w angielskim UI** — trzeci raz to samo
   w mapowaniu. Słownik ról musi być i18n, a nie stringiem.
3. Prelegent sesji musi móc być osobą **bez konta** (wniosek z zrzutu 5.1), więc
   `event_session_speakers` wskazuje na **rekord uczestnika**, a nie na `auth.users`.
   To domyka spójność: jedna tabela osób wydarzenia, do której wskazują prelegenci
   sesji, obecni na sesji, leady i check-iny.

### Zrzut 7.2 — zakładka „Exhibitors (1)"

**Co widać**

- Pole `Search among exhibitors to add them to the session`.
- Karta: logo + **New European Strategies** z ołówkiem i koszem.

**Mapowanie**

| Swapcard                                          | NES                                                             | Stan | Zadanie |
| ------------------------------------------------- | --------------------------------------------------------------- | ---- | ------- |
| firma powiązana z sesją (partner / sponsor sesji) | po decyzji §0.4: `crm_companies`                                | 🔴   | EB-819  |
| edycja i usunięcie powiązania                     | relacja `event_session_companies(session_id, company_id, role)` | 🔴   | EB-819  |

**Wnioski**

1. Powiązanie sesji z firmą realnie służy do dwóch rzeczy: „sesja sponsorowana przez X"
   (logo na karcie sesji) i „nasz panel prowadzi firma X". Jedna relacja z polem
   `role ('sponsor','host','partner')` obsługuje oba, bez modułu wystawców.
2. Sesja z 3 firmami (zrzut 6.1: „Mobilność wojskowa" — `Exhibitors 3`) pokazuje,
   że to relacja wiele-do-wielu, nie pole na sesji.

### Zrzut 7.3 — zakładka „Attendees"

**Co widać**

- `+ Add one person` · `+ Add several at once`.
- Tabela: `Email` · `Groups` · `First name` · `Last name` · `Job title` · `Company` ·
  `Member of` · `Registered at` (sort).
- Stan pusty: **„Nobody is yet registered"**.

**Mapowanie**

| Swapcard                                                           | NES                                           | Stan | Zadanie |
| ------------------------------------------------------------------ | --------------------------------------------- | ---- | ------- |
| **zapis na konkretną sesję**                                       | brak; RSVP jest na wydarzenie (`event_rsvps`) | 🔴   | EB-820  |
| dopisanie osoby do sesji przez organizatora (pojedynczo i wsadowo) | wzorzec: `BulkActionsBar`, zaproszenia        | 🔴   | EB-820  |
| `Registered at`                                                    | znacznik czasu zapisu                         | 🔴   | EB-820  |

**Wnioski**

1. To potwierdza `event_session_attendance` z §4.2 — ale nazwa była zła. To nie
   „frekwencja", a **zapis na sesję** (`event_session_registrations`), z którego
   frekwencja (`event_checkins`) jest osobnym, późniejszym faktem. Dwa różne stany:
   zapisał się (przed) i był (w trakcie). Zlanie ich w jedno uniemożliwiłoby
   policzenie no-show, czyli najważniejszej liczby przy planowaniu sal.
2. „Add several at once" przy sesji to typowa operacja kongresowa (cała delegacja
   na jeden panel). Wsadowe dopisanie musi respektować limit miejsc sesji —
   inaczej pierwsza taka operacja przepełni salę.

### Zrzut 7.4 — zakładka „Sessions" (powiązania między sesjami)

**Co widać**

- `Create a new link` · pole `Link an existing session` (nieaktywne/puste).

**Mapowanie**

| Swapcard                      | NES  | Stan | Zadanie |
| ----------------------------- | ---- | ---- | ------- |
| powiązanie sesji z inną sesją | brak | 🔴   | EB-821  |

**Wnioski**

1. Powiązania sesja–sesja obsługują trzy realne przypadki: ścieżka („część 1 / część 2"),
   sesja nadrzędna z warsztatami równoległymi i tłumaczenie/duplikat (ta sama treść,
   inna sala). Model: `event_session_links(from_session_id, to_session_id, kind)`
   z `kind ('continuation','parallel','translation','related')`. Tanie, a bez tego
   agenda dwudniowa z równoległymi ścieżkami rozpada się na płaską listę.

### Zrzut 7.5 — zakładka „Documents & Links"

**Co widać**

- Pole `Search` + `Or create new` (pusto).

**Mapowanie**

| Swapcard                                            | NES                                                                                 | Stan | Zadanie |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | ---- | ------- |
| dokumenty i linki przy sesji                        | **wzorzec 1:1**: `club_documents` + `club_thread_documents` (+ `club_thread_links`) | 🟡   | EB-822  |
| biblioteka współdzielona („search" po istniejących) | dokument raz wgrany, podpięty do wielu sesji                                        | 🟡   | EB-822  |

**Wnioski**

1. Wzorzec „szukaj istniejącego albo utwórz nowy" powtarza się w Swapcardzie przy
   dokumentach, linkach i sesjach. To znak, że wszystkie te byty żyją **na poziomie
   wydarzenia**, a sesja tylko je **linkuje**. Nasz model musi to powtórzyć
   (`event_documents` + `event_session_documents`), inaczej ten sam PDF wgrany do
   sześciu sesji będzie w bazie sześć razy.

### Zrzut 7.6 — zakładka „Preferences"

**Co widać**

- `Registration`:
  - **Allow all event members to register at event level** — **ON**: „all event groups
    to register or unregister for this session."
  - **Limit the number of registrations** — **OFF**: „you can define an attendee capacity
    limit. Attendees won't be able to register for the session once the limit has been reached."
  - **Allow overlap** — **ON**: „When the option is disabled, participants will not be
    able to register for the session if they are already registered for another session
    at the same time that also has this option disabled."
  - **Allow all community members to register at community level** — **ON**.
- `Onsite`: **Onsite access tracking with SwapAccess** — **`Add-on`**: „Scan participant
  badges at the entrance and/or exit of sessions to record their attendance or to control
  access with SwapAccess App."
- `Visibility`:
  - **Make the session private** — OFF: „visible only to the attendees who have
    registered for it."
  - **Hide registered people** — OFF: „participants who have registered for the session
    are not visible to others."
- `Engagement`: **Ask for feedback after the session** — **ON**: „people who registered
  for the session can provide a private rating and comment. Notifications that encourage
  registrants to provide feedback will be…" (ucięte).

**Mapowanie**

| Swapcard                                                           | NES                                                                                      | Stan | Zadanie |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---- | ------- |
| kto może się zapisać (grupy wydarzenia / członkowie społeczności)  | `event_sessions.registration_scope ('event_groups','community','none')` + grupy (§4.3)   | 🔴   | EB-823  |
| limit miejsc na sesję                                              | `capacity int` + egzekucja pod blokadą wiersza — **wzorzec `rsvp_event` gotowy**         | 🔴   | EB-824  |
| **`Allow overlap`** — blokada podwójnego zapisu w tym samym czasie | brak; wymaga wykrywania kolizji czasu w RPC                                              | 🔴   | EB-825  |
| skan badge'a na wejściu/wyjściu **sesji**                          | `event_checkins` z `session_id` + `gate ('in','out')` (§4.6)                             | 🔴   | EB-1201 |
| sesja prywatna (tylko zapisani)                                    | `visibility` + `event_capabilities()`                                                    | 🔴   | EB-826  |
| ukrycie listy zapisanych                                           | flaga `hide_attendees` — **istotne przy Chatham House**                                  | 🔴   | EB-826  |
| ocena i komentarz po sesji (prywatne)                              | brak dla sesji; wzorzec ocen: `speaker_profiles.rating`/`reviews_count`, oceny w klubach | 🟡   | EB-827  |
| powiadomienia zachęcające do oceny                                 | `run_event_reminders()` jako wzorzec zadania cyklicznego                                 | 🟡   | EB-827  |

**Wnioski**

1. **`Allow overlap` to jedyna reguła w całym Swapcardzie, której NES nie umie
   nawet przybliżyć** — i jest nietrywialna: zapis na sesję musi sprawdzić, czy
   uczestnik nie ma już zapisu na sesję nachodzącą czasowo, przy czym reguła działa
   tylko między sesjami, które **obie** mają ją wyłączoną. To zapytanie o przecięcie
   przedziałów czasowych w RPC pod blokadą wiersza. W Postgresie robi to zakres
   `tstzrange` z operatorem `&&` i indeksem GiST — warto zapisać w modelu wprost,
   bo wersja „sprawdzam w kliencie" jest wyścigiem.
2. `Ask for feedback after the session` domyka pętlę jakości: `speaker_profiles`
   ma już `rating` i `reviews_count`, ale **nie ma skąd ich brać**. Oceny sesji są
   tym źródłem. To argument, żeby zrobić je od razu (E4/E5), a nie „kiedyś":
   dzisiejsze pola ocen prelegentów są pustymi obietnicami.
3. Dwie flagi widoczności (`sesja prywatna`, `ukryj zapisanych`) plus reguła Chatham
   House z `events.chatham_house` muszą mieć **jedno miejsce rozstrzygania** —
   `event_capabilities(event_id, session_id, user_id)`. Trzy niezależne flagi
   sprawdzane w trzech komponentach to dokładnie ten rozjazd, który moduł klubów
   już raz przeszedł.
4. Zakres zapisu („członkowie wydarzenia" vs „członkowie społeczności") pokazuje,
   że Swapcard dopuszcza zapis na sesję **bez rejestracji na wydarzenie** — u nas
   odpowiednikiem jest warstwa członkowska (`min_tier_rank`). Nasza wersja tej reguły:
   `registration_scope` + `min_tier_rank` na sesji, z dziedziczeniem z wydarzenia.

---

## Partia 8 — 2026-08-23 (Exhibitors: lista, ustawienia, profil firmy)

> **Uwaga o zakresie.** Decyzja §0.4 („wystawcy nie są osobnym modułem, partnerzy
> i sponsorzy synchronizowani z CRM firm") pozostaje w mocy. Te zrzuty mapuję,
> bo pokazują **jak wygląda profil firmy przy wydarzeniu** — a to potrzebne
> niezależnie od modułu wystawców: partner, sponsor i firma prowadząca panel to
> ten sam byt. Elementy typowo wystawiennicze (Exhibitor Center, Items, pakiety)
> zaznaczam jako **poza zakresem**, żeby nie wróciły do backlogu przez pomyłkę.

### Zrzut 8.1 — `…/exhibitors` · lista firm

**Co widać**

- „Give your exhibitors more value and improve their ROI with dedicated Exhibitor
  Profiles and access to the Exhibitor Area."
- `Search` · `Exhibitor settings` · `Export` · **`Create exhibitors`**.
- Tabela: `Logo` · `Name` (sort) · `Group` (filtr) · `Location` · `Type` ·
  `Members` · `Created on` (sort) · `Description` (sort) · `Website`.
- Cztery firmy (`1 – 4 of 4`), wszystkie w grupie `Exhibitors`, utworzone
  21.06.2024: **Bank Pekao S.A.** (0 członków), **Forbes Polska** (0, forbes.pl),
  **New European Strategies** (1 członek, neweuropeanstrategies.com),
  **Parlament Europejski** (0, warsaw.europarl.eu). Opisy po polsku.

**Mapowanie**

| Swapcard                                                  | NES                                                                                     | Stan                                 | Zadanie |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------ | ------- |
| firma przy wydarzeniu (logo, opis, www, lokalizacja, typ) | `crm_companies` (`logo_url`, `name`, `website`, `domain`, `address`, `city`, `country`) | ✅ dane, 🔴 powiązanie z wydarzeniem | EB-819  |
| `Group` firmy                                             | grupa wydarzenia (§4.3) obejmuje też **organizacje**, nie tylko osoby                   | 🔴                                   | EB-304  |
| `Members` (obsada firmy)                                  | `organization_seats` — ale tylko dla `member_organizations`                             | 🟡                                   | EB-908  |
| `Type` (typ firmy)                                        | pole własne (zrzut 8.2)                                                                 | 🔴                                   | EB-830  |
| `Export`                                                  | wzorzec CSV                                                                             | ✅                                   | —       |
| `Create exhibitors`                                       | dopisanie firmy do wydarzenia (z CRM albo nowa)                                         | 🔴                                   | EB-819  |

**Wnioski**

1. Cztery firmy w wydarzeniu referencyjnym to **partnerzy i patroni medialni**
   (bank, tytuł prasowy, instytucja UE, organizator), nie wystawcy ze stoiskami.
   To potwierdza decyzję §0.4 z drugiej strony: nawet w Swapcardzie NES używa
   „Exhibitors" jako **kartoteki firm wydarzenia**. Nasz odpowiednik nazywa się
   **Partnerzy / Firmy wydarzenia** i jest widokiem `crm_companies` przypiętych
   do wydarzenia — z logo, opisem i typem.
2. Wszystkie cztery mają `0` lub `1` członka. Obsada firmy to funkcja, której
   NES realnie nie użyje w pierwszej wersji (dziewięć z dziesięciu partnerów nie
   zaloguje się do panelu). Wniosek: `Members` firmy jest **na końcu kolejki**,
   za sponsorami i sesjami.

### Zrzut 8.2 — `Exhibitor settings` → „Custom fields"

**Co widać**

- „Here you can manage the custom fields and main content of your event. This
  includes any of the information on pages that you will sort into sections.
  **Creating fields with single or multiple choice formats will allow you to create
  search filters.**"
- Pole **`Add a custom field used in other events within this Community`** + wybór
  języka (`Polish`).
- Sekcja `Default custom fields` — „Displayed on top of exhibitor details page" →
  pole `Type`.
- Sekcja `Information` → `+ Create custom field`.

**Mapowanie**

| Swapcard                                                    | NES                                                              | Stan       | Zadanie |
| ----------------------------------------------------------- | ---------------------------------------------------------------- | ---------- | ------- |
| słownik pól własnych firmy                                  | wzorzec: `post_custom_meta_defs` + `/admin/custom-meta`          | 🟡         | EB-830  |
| **pole współdzielone między wydarzeniami społeczności**     | definicja na poziomie tenanta, wartość per wydarzenie            | 🔴         | EB-831  |
| pola typu „jeden / wiele wyborów" → **filtry wyszukiwania** | filtry katalogu (wzorzec: filtry CRM, `search_companies_public`) | 🟡         | EB-832  |
| sekcje pól (`Default` / `Information`)                      | grupowanie pól na karcie                                         | 🔴         | EB-830  |
| wybór języka wartości pola                                  | bliźniacze kolumny / wartości i18n                               | ✅ wzorzec | —       |

**Wnioski**

1. „Pole użyte w innych wydarzeniach tej społeczności" to **kluczowy wzorzec
   oszczędności pracy**: definicja pola żyje raz na tenanta, wartości per
   wydarzenie. Powtarza się przy sesjach (zrzut 6.2), osobach (5.2) i tu.
   Rekomendacja architektoniczna: **jeden mechanizm pól własnych dla trzech
   encji** (`event_custom_field_defs(entity IN ('session','person','company'))`
   - `event_custom_field_values`), a nie trzy osobne. W repo istnieje precedens
     (`post_custom_meta_defs`), więc to rozszerzenie wzorca, nie nowy wynalazek.
2. Zdanie „single or multiple choice → search filters" to reguła projektowa warta
   skopiowania: **tylko pola słownikowe stają się filtrami**. Pole tekstowe jako
   filtr daje bezużyteczną listę pięćdziesięciu unikalnych wartości.

### Zrzut 8.3 — `Exhibitor settings` → „Export condition"

**Co widać**

- „To exclude specific leads from the exports downloaded by exhibitors, add a
  condition such as a **custom field or a term consent**. This condition will be
  applied to all exhibitors of the event." + `Add condition`.

**Mapowanie**

| Swapcard                                    | NES                                             | Stan | Zadanie |
| ------------------------------------------- | ----------------------------------------------- | ---- | ------- |
| warunek wykluczający leady z eksportu       | filtr na `event_leads` przy eksporcie           | 🔴   | EB-833  |
| warunek oparty o **zgodę** (`term consent`) | `event_terms` + `event_term_acceptances` (§4.8) | 🔴   | EB-603  |
| silnik warunków                             | `club_segment_rules.rule jsonb` jako wzorzec    | 🟡   | EB-308  |

**Wnioski**

1. **To jest brakujące ogniwo RODO z partii 2 (zrzut 2.3).** Swapcard rozwiązuje
   problem „kto nie chce, żeby jego dane trafiły do partnera" właśnie tu: warunek
   eksportu oparty o zgodę. Nasza wersja jest prostsza i mocniejsza:
   **eksport leadów widzi wyłącznie osoby z aktywną zgodą** — nie jako
   konfigurowalny warunek, a jako **niewyłączalna reguła w RPC**. Konfigurowalny
   filtr zgody to zaproszenie do pomyłki, której skutkiem jest naruszenie.
2. Zostawiam `Add condition` jako opcję **zawężającą** (partner z pakietu premium
   dostaje tylko leady z określonego typu wejściówki), ale nigdy rozszerzającą.

### Zrzut 8.4 — `Exhibitor settings` → „Home message"

**Co widać**

- „You can customize the home message of the Exhibitor Center here."
- RTE z pełnym paskiem (`Aa`, B, I, U, listy, `---`, link, obraz, plik) + flaga języka.
- Treść: nagłówek **„Welcome to the Exhibitor Center"** i wideo instruktażowe.

**Mapowanie**

| Swapcard                              | NES                                                            | Stan | Zadanie |
| ------------------------------------- | -------------------------------------------------------------- | ---- | ------- |
| Exhibitor Center (panel dla firmy)    | ⛔ **poza zakresem** (§0.4)                                    | —    | —       |
| komunikat powitalny w panelu partnera | odpowiednik: ekran onboardingu (`components/admin/onboarding`) | 🟡   | —       |

**Wnioski**

1. Cały „Exhibitor Center" — osobny panel, do którego loguje się firma — jest
   poza zakresem. Notuję to świadomie: gdyby kiedyś wrócił, NES ma pod niego
   gotowy fundament (`organization_seats` + macierz uprawnień + panel
   z `AdminShell`), ale to **osobny produkt**, nie zakładka Event Buildera.

### Zrzut 8.5 — `Exhibitor settings` → „Similar exhibitor recommendation"

**Co widać**

- `Display similar exhibitors - for the community` — **ON**: „a list of similar
  exhibitors **generated by AI** is displayed on each Exhibitor page on your community."
- `Display similar exhibitors - for this event` — **ON**: to samo w zakresie wydarzenia.

**Mapowanie**

| Swapcard                               | NES                                                                                                   | Stan | Zadanie |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---- | ------- |
| rekomendacje „podobne firmy" z AI      | **wzorzec istnieje**: `club_thread_embeddings` (wektory), rekomendacje treści, `/admin/related-posts` | 🟡   | EB-834  |
| dwa zakresy (społeczność / wydarzenie) | filtr zakresu rekomendacji                                                                            | 🔴   | EB-834  |

**Wnioski**

1. NES ma już osadzenia wektorowe i moduł powiązanych treści, więc „podobne firmy"
   to zastosowanie istniejącego mechanizmu do nowej encji, a nie nowy model.
   Warto to jednak umieścić **nisko** w kolejce: przy czterech partnerach
   rekomendacja „podobnych" jest zabawna, a nie użyteczna. Sensu nabiera od ~30 firm.

### Zrzut 8.6 — profil firmy `Forbes Polska` → „Details"

**Co widać**

- Nagłówek: `Forbes Polska` z plakietką **`Events (1)`**.
- Zakładki: `Details` · `Contact details` · `Members` · `Documents & Links` ·
  `Exhibitors` · `Permissions`.
- `General` — „Add the booth name, a brief description, and the location…":
  `* Name` (flaga języka), `Description` (RTE, treść po polsku),
  `Location` („Search or select an existing location" + `Create new`).
- `Branding` — „Customize the virtual booth with a header, logo, and background image…":
  `Header image` (1200×675, 16:9, ≤1 MB; **albo wideo** z YouTube/Vimeo — „Use a video
  instead"), logo (Forbes), `Background image` (2560×1600, 16:10, ≤1 MB).
- `Custom fields` — `Type` = `None` + `Edit field`; `Create custom field`
  („Custom fields are crucial to boost searchability and **AI recommendations**").
- `Social networks` — `linkedin.com/company/`, `x.com/forbespolska`,
  `instagram.com/`, `facebook.com/` + `See all social networks`.
- `IDs` → `Internal IDs`.

**Mapowanie**

| Swapcard                                                                      | NES                                                                                 | Stan | Zadanie |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---- | ------- |
| **`Events (1)`** — firma należy do społeczności, jest przypięta do N wydarzeń | dokładnie model `crm_companies` (tenant) + `event_companies` (przypięcie)           | 🔴   | EB-819  |
| nazwa i opis firmy per wydarzenie                                             | `crm_companies.name` + **nadpisanie per wydarzenie** (opis inny na innym kongresie) | 🔴   | EB-819  |
| `Location` ze słownika lokalizacji                                            | słownik lokalizacji wydarzenia (ten sam co `Location` sesji, zrzut 6.2)             | 🔴   | EB-835  |
| branding firmy (header/logo/tło, wideo w nagłówku)                            | `member_organizations` ma logotypy i kolory; `crm_companies` ma tylko `logo_url`    | 🟡   | EB-836  |
| pola własne firmy                                                             | jeden mechanizm pól własnych (zrzut 8.2, wniosek 1)                                 | 🔴   | EB-830  |
| social media firmy                                                            | wzorzec `SocialIdentityPanel` (osoba); dla firmy brak                               | 🔴   | EB-837  |

**Wnioski**

1. Plakietka `Events (1)` rozstrzyga architekturę: firma **nie jest** dzieckiem
   wydarzenia. Jest bytem społeczności widocznym w wielu wydarzeniach, a wydarzenie
   nadaje jej **kontekst** (grupa, typ, opis, poziom sponsorski, branding stoiska).
   Nasz model: `crm_companies` (jedno źródło prawdy o firmie) + `event_companies`
   (`event_id`, `company_id`, `group_id`, `role`, `description_pl/en` jako
   nadpisanie, `header_image`, `background_image`, `sort_order`).
   To zresztą **ten sam wzorzec „dziedzicz albo nadpisz"**, który mamy w klubach.
2. Trzy formaty obrazów z różnymi proporcjami (16:9 header, 16:10 tło, logo)
   trafiają wprost do `/admin/crop-sizes` — nie wymyślamy nowych rozmiarów,
   dodajemy presety.
3. Opis Forbesa jest po polsku w polu z flagą języka. Czwarty raz to samo:
   **każde pole treściowe firmy musi być bliźniacze**.

### Zrzut 8.7 — profil firmy → „Contact details"

**Co widać**

- „Attendees can view the exhibitor's contact details, but **in Guest mode and on
  widgets, only the country is shown**."
- `Mobile phone` i `Landline` (z wyborem kraju), `Email`,
  `Address` („Search for a venue or address" + `Add manually`),
  `Website` = `https://www.forbes.pl`.

**Mapowanie**

| Swapcard                                           | NES                                                                               | Stan               | Zadanie |
| -------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------ | ------- |
| dane kontaktowe firmy                              | `crm_companies` (`phone`, `address`, `city`, `postal_code`, `country`, `website`) | ✅                 | —       |
| **degradacja widoczności dla gościa (tylko kraj)** | wzorzec: `profiles_public` jako zawężona projekcja; `get_public_speakers`         | 🟡 **wzorzec 1:1** | EB-838  |

**Wnioski**

1. „Gość widzi tylko kraj" to elegancki wzorzec ochrony danych kontaktowych,
   który NES realizuje **lepiej niż flagą w UI**: osobną projekcją publiczną
   (definerowy RPC zwracający wyłącznie kolumny publiczne — tak działa już
   `get_public_speakers`). Dla firm robimy `get_public_event_companies` i problem
   znika na poziomie bazy, a nie komponentu.

### Zrzut 8.8 — profil firmy → „Members"

**Co widać**

- Pole `Add a member by searching among people with an account`.
- `Members role` — **`Add-on`**: „By default, members are assigned the **'Admin'**
  role, granting them full access to the Exhibitor Center. Change their role to
  **'Limited'** for more control."

**Mapowanie**

| Swapcard                    | NES                                                                 | Stan | Zadanie |
| --------------------------- | ------------------------------------------------------------------- | ---- | ------- |
| obsada firmy z konta        | `organization_seats` (role, statusy, zaproszenia)                   | 🟡   | EB-908  |
| dwie role (Admin / Limited) | `organization_seats.role`                                           | ✅   | —       |
| „tylko osoby **z kontem**"  | tu Swapcard wymaga konta, inaczej niż przy uczestnikach (zrzut 5.1) | —    | —       |

**Wnioski**

1. Ciekawa asymetria: uczestnik może istnieć bez konta, **członek obsady firmy nie**.
   To sensowne — obsada dostaje uprawnienia zapisu, a uprawnienia wymagają
   uwierzytelnienia. Nasz model musi to odzwierciedlić: `event_registrations`
   dopuszcza `user_id NULL`, `organization_seats` nie.

### Zrzut 8.9 — profil firmy → „Permissions"

**Co widać**

- `Groups` — „**By default the exhibitor has the permissions of the group it belongs
  to. By editing, it will apply a specific permission for the exhibitor.**"
  `Group` = `Exhibitors` + link `Edit group's settings`.
- `Exhibitor profile` → `Company fields` — „Define the fields that the exhibitor can
  edit on their company profile": `Name`, `Logo`, `Header image`, `Video header`,
  `Advertising`, `Background image`, `Description`, `Address`, `Website`, `Email`,
  `Phone numbers`, `Social networks` — **wszystkie ON**.
- `Documents & Links` **Add-on**, `Items` **Add-on**.
- `Lead generation`: `Lead capture` **Add-on**, `Lead qualification` **Add-on**,
  `Allow to download QR code` **OFF**, `Lead dashboards and exports` **Add-on**.
- `Members`: `Allow to add registered members` **ON**,
  `Allow to register members` **OFF**.

**Mapowanie**

| Swapcard                                         | NES                                                                 | Stan               | Zadanie |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------------------ | ------- |
| **nadpisanie uprawnień grupy na poziomie firmy** | wzorzec „dziedzicz albo nadpisz" z `club_groups` (NULL = dziedzicz) | 🟡 **wzorzec 1:1** | EB-839  |
| polityka pól firmy                               | (poza zakresem bez Exhibitor Center — §0.4)                         | ⛔                 | —       |
| lead generation per firma                        | `event_leads` + zgoda (§4.6, §4.8)                                  | 🔴                 | EB-1201 |
| `Allow to download QR code`                      | QR do profilu firmy do druku na stoisku                             | 🔴                 | EB-907  |

**Wnioski**

1. Ten ekran domyka partię 2 (zrzut 2.1): uprawnienia mają **dwa poziomy** —
   grupa i pojedynczy podmiot, z dziedziczeniem. To trzecie miejsce, w którym
   Swapcard stosuje „dziedzicz albo nadpisz" (grupa społeczności → grupa
   wydarzenia → firma). Nasz `event_capabilities()` musi liczyć tę kaskadę
   w jednym miejscu, a panel pokazywać jawnie, co skąd wynika (etykieta
   „dziedziczone z grupy" + przełącznik „nadpisz") — dokładnie tak, jak opisuje
   `PROJEKT_MODUL_DISCUSSION_CLUB_V2_ADMIN_2026-08-07.md` §1.
2. Powtórzenie tych samych przełączników (`Company fields`, `Lead generation`,
   `Members`) na poziomie **grupy** (partia 2) i **firmy** (tu) to nie duplikacja
   UI, a właśnie kaskada. Warto zbudować **jeden komponent** renderujący te same
   pola w dwóch trybach (ustawienie grupy / nadpisanie firmy), bo inaczej dwa
   ekrany rozjadą się przy pierwszej zmianie.

---

## Partia 9 — 2026-08-23 (Items, Feed channels, Documents & Links)

### Zrzut 9.1 — `…/products` · „Create items"

**Co widać**

- „Showcase any type of items (**Products, Projects, Job Offers**, etc.) that
  participants will be able to browse and bookmark. Your exhibitors will be able to
  import them from the Exhibitor Center."
- Cztery drogi: **Import via Excel file** („Download and update our pre-filled Excel
  template to add or edit items in bulk"), **Import from another event in the
  Community** („Attach existing content from an event within the same community"),
  **Create manually**, **Item settings** („Create item types, subcategories and custom
  fields. Choose if a list of similar items generated by AI is displayed").

**Mapowanie**

| Swapcard                                             | NES                                                                                                 | Stan | Zadanie |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---- | ------- |
| katalog „items" (produkty / projekty / oferty pracy) | ⛔ jako moduł wystawców; **ale**: NES ma `programs`, `research-programs`, `careers` (oferty pracy!) | 🟡   | EB-840  |
| **import z innego wydarzenia w społeczności**        | brak — a to wzorzec o dużej wartości (patrz Wnioski)                                                | 🔴   | EB-841  |
| import z Excela z gotowym szablonem                  | wzorzec: `WxrUploadPanel`, importy CSV                                                              | 🟡   | EB-805  |
| typy, podkategorie i pola własne                     | jeden mechanizm pól własnych (8.2)                                                                  | 🔴   | EB-830  |
| bookmarkowanie przez uczestnika                      | **istnieje**: zakładki/`reading-list`, `profile.bookmarks`                                          | ✅   | —       |

**Wnioski**

1. `Items` jako produkt wystawcy jest poza zakresem, ale **„Import from another event
   in the Community" to najlepszy pomysł w całym Swapcardzie z punktu widzenia NES**.
   Kongres jest cykliczny: ci sami prelegenci, ci sami partnerzy, podobna agenda.
   Rekomendacja: **kopiowanie zawartości między wydarzeniami** (sesje, prelegenci,
   firmy, sponsorzy, dokumenty, typy biletów) jako osobna funkcja panelu —
   „utwórz wydarzenie na podstawie poprzedniego". Wchodzi do §5 (presety rodzajów)
   jako drugi tryb: preset albo klon.
2. Że oferty pracy są „items" u Swapcarda, a u NES osobnym modułem (`careers`,
   `hiring`), jest argumentem za tym, żeby **nie** budować generycznego katalogu:
   NES ma już typowane moduły treści, które robią to lepiej.

### Zrzut 9.2 i 9.3 — `…/feed-channels` · kanały feedu

**Co widać**

- Lista: `Search` · **`Create channel`**; tabela `Name` (sort) · `Created on` ·
  `Posts` · **`Displayed on`**. Jeden kanał: **„Czy wiedział_ś, że …"**,
  utworzony 21.06.2024, `0` postów, `Displayed on: Dyskusje`.
- Szczegóły kanału: zakładki `Details` · `Posts` · `Settings`; `* Name` (i18n).

**Mapowanie**

| Swapcard                                              | NES                                                                      | Stan | Zadanie |
| ----------------------------------------------------- | ------------------------------------------------------------------------ | ---- | ------- |
| kanał feedu wydarzenia (posty, ogłoszenia)            | **wzorzec 1:1**: `club_posts` + `club_post_likes` + `club_board_notices` | 🟡   | EB-842  |
| `Displayed on` (na której stronie kanał się pokazuje) | u nas: widget na stronie wydarzenia (`event_pages` + builder)            | 🟡   | EB-842  |
| moderacja postów                                      | `club_moderation_log`, `comments`                                        | ✅   | —       |

**Wnioski**

1. Kanał feedu to w praktyce **tablica ogłoszeń wydarzenia** („Czy wiedziałeś, że…"
   to komunikaty organizatora). NES ma to w klubach (`club_board_notices` +
   `club_posts`) — praca polega na przypięciu do wydarzenia i wystawieniu widgetu.
2. `Displayed on: Dyskusje` pokazuje, że kanał jest **treścią**, a strona
   („Dyskusje") jej **powierzchnią**. To znowu potwierdza §0.1: strony są
   z jednego silnika, a moduły dostarczają do nich treść przez widgety.

### Zrzut 9.4 i 9.5 — `…/documents` · „Documents & Links"

**Co widać**

- „Add any document for **sessions & exhibitors** and get all **download statistics**."
  `Search` · **`Add a document`**.
- Tabela: `Title of the document` · **`Attached to`** · `Description` · `Type` · `URL`.
  Dwa wpisy, oba `Type: Link`: „Spotkania Chatham House" (`bit.ly/3V8srNS`),
  „Konferencja Geopolityczna Gra Mocarstw" (`bit.ly/4bIcXHr`).
- Szczegóły dokumentu: `* URL of the document` (z ikonami podglądu, usunięcia
  i wgrania pliku), `* Title of the document`, `Description of the document`
  (max 160 znaków), `Internal ID`, `Delete`.

**Mapowanie**

| Swapcard                             | NES                                                                           | Stan | Zadanie |
| ------------------------------------ | ----------------------------------------------------------------------------- | ---- | ------- |
| biblioteka dokumentów wydarzenia     | **wzorzec 1:1**: `club_documents` + `club_thread_documents`                   | 🟡   | EB-822  |
| `Type: Link` vs plik (ta sama encja) | `club_documents` (plik) + `club_thread_links` (link) — u nas **dwie** encje   | 🟡   | EB-843  |
| **`Attached to`** (sesje, firmy)     | relacja wiele-do-wielu (`event_session_documents`, `event_company_documents`) | 🔴   | EB-822  |
| **statystyki pobrań**                | brak dla dokumentów; wzorzec liczników: `ad_events`, `analytics_events`       | 🔴   | EB-844  |
| `Internal ID`                        | id widoczne w panelu                                                          | 🔴   | EB-808  |

**Wnioski**

1. Swapcard trzyma **link i plik jako jedną encję** z polem `Type`. NES ma dwie
   (`club_documents` i `club_thread_links`). Dla wydarzeń rekomenduję **jedną**:
   `event_documents(kind ('file','link'), url, title, description, …)` — redakcja
   myśli „materiał do pobrania", a nie „plik vs URL", a statystyki pobrań/kliknięć
   mają być w jednym miejscu.
2. Oba dokumenty w wydarzeniu referencyjnym to **skróty bit.ly** — czyli redakcja
   już dziś liczy kliknięcia poza platformą. To mocny argument za `EB-844`
   (statystyki pobrań w panelu): funkcja zastępuje zewnętrzne narzędzie, którego
   NES realnie używa.
3. Nazwa „Spotkania Chatham House" wśród dokumentów jest przypomnieniem, że
   materiały wydarzeń NES bywają **poufne**. Biblioteka dokumentów musi od pierwszej
   wersji respektować bramkę widoczności (grupa / warstwa / zapisani na sesję),
   a nie być publicznym katalogiem URL-i.

---

## Partia 10 — 2026-08-23 (Content → Discussions)

### Zrzut 10.1 — `…/chatrooms` · „Discussions"

**Co widać**

- „Get your attendees engaging on specific topics or a general forum. **For better
  engagement, we recommend using the News Feed feature instead.**" + `Learn how`.
- `Search` · **`New discussion`**.
- Tabela: `Name` · `Description` · `Members` · `Messages`.
  Jeden wpis: **„Rekomendacje fiskalne dla Polski"** — `1` członek, `0` wiadomości.
- Szuflada edycji: `Picture` (zalecane 256×256 px, ≤300 kB), `* Discussion name`,
  `Description` („Add a short description"), `Delete`.

**Mapowanie**

| Swapcard                                                      | NES                                                                                                                                        | Stan      | Zadanie |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------- |
| pokój dyskusyjny wydarzenia (temat + członkowie + wiadomości) | **wzorzec 1:1 i mocniejszy**: `club_threads` + `club_replies` + `club_reactions` + `club_stances` (stanowiska) + moderacja + Chatham House | ✅ silnik | EB-845  |
| obraz i opis pokoju                                           | `club_threads` / `club_groups` mają odpowiedniki                                                                                           | ✅        | —       |
| liczniki członków i wiadomości                                | `thread_count`, `last_activity_at` w klubach                                                                                               | ✅        | —       |
| rekomendacja Swapcarda: „użyj raczej News Feed"               | u nas: kanał ogłoszeń (partia 9) vs wątek dyskusyjny                                                                                       | —         | —       |

**Wnioski**

1. Swapcard **sam odradza** własną funkcję dyskusji na rzecz feedu — to znaczy, że
   czat tematyczny przy wydarzeniu słabo działa bez masy krytycznej. NES ma tu
   przewagę, której nie warto marnować: moduł klubów dyskusyjnych z wątkami,
   stanowiskami, moderacją i regułą Chatham House jest o klasę bogatszy niż ten
   ekran. Rekomendacja: **nie budować osobnych „dyskusji wydarzenia"**, tylko
   podpiąć istniejący klub/grupę pod wydarzenie (`club_events.anchor_event_id`
   już wiąże kalendarz klubu z wydarzeniem — brakuje odwrotnego kierunku:
   „dyskusja tego wydarzenia toczy się w grupie X").
2. Jeden pokój z jednym członkiem i zerem wiadomości w realnym wydarzeniu to
   dowód empiryczny na powyższe. Ta sekcja ma w naszym backlogu **najniższy
   priorytet** i najlepszy stosunek wartości do pracy przy podejściu „podepnij
   istniejący moduł", a nie „zbuduj nowy".

---

## Partia 11 — 2026-08-23 (Exhibitor Marketplace: sprzedaż dodatków partnerom)

> **Zakres.** Sam `Exhibitor Marketplace` jest **poza zakresem** (§0.4). Mapuję go,
> bo pokazuje **mechanizm, którego NES realnie potrzebuje pod inną nazwą**:
> sprzedaż pakietów partnerskich online, gdzie zakup **nadaje uprawnienie**.
> Dziś NES sprzedaje pakiety partnerskie ofertą i fakturą; te ekrany pokazują,
> jak to wygląda jako self-service.

### Zrzut 11.1 — `…/exhibitor-marketplace` · ekran powitalny

**Co widać**

- „Generate new revenue by enabling exhibitors to purchase extras directly in the
  Exhibitor Center, whether Swapcard features such as **Lead Capture** or **in-app
  Advertising**, or any **on-site services** you offer (e.g. parking spaces or Wi-Fi
  access)." + `Create marketplace` · `Learn more`.
- `How does it work?`: **1** `Connect your Stripe account` · **2** `Create & price your
extras` („Customize pricing for each extra to match your monetization strategy") ·
  **3** `Track purchase data` („Monitor sales and revenue with real-time purchase
  insights").

**Mapowanie**

| Swapcard                                                     | NES                                                                                    | Stan | Zadanie |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---- | ------- |
| sprzedaż dodatków firmom (self-service)                      | ⛔ moduł wystawców poza zakresem; **ale** pakiety partnerskie są realnym produktem NES | 🟡   | EB-1101 |
| Stripe jako bramka                                           | **istnieje**: `/admin/billing`, `payment_orders`, `payment_webhook_events`, checkout   | ✅   | —       |
| „on-site services" (parking, Wi-Fi) jako pozycje sprzedażowe | wzorzec: `/admin/pricing` + `event_ticket_types`                                       | 🟡   | EB-1101 |
| statystyki sprzedaży w czasie realnym                        | `/admin/monetization`, `/admin/billing`                                                | ✅   | —       |

**Wnioski**

1. Trzy kroki („podłącz Stripe → wyceń dodatki → mierz sprzedaż") to dokładnie
   ścieżka, którą NES ma już zbudowaną dla subskrypcji i biletów. Gdyby pakiety
   partnerskie miały wejść do sprzedaży online, **nie powstaje nowy moduł
   płatności** — powstaje nowy typ pozycji w istniejącym.

### Zrzut 11.2 — modal „Set currency"

**Co widać**

- Ostrzeżenie: „**This currency applies to both Marketplace and In-app registration.
  Currency changes require support assistance.**"
- Lista walut (EUR, USD ✓, CAD, AED, GBP, SGD, JPY, SEK, AUD, ZAR, DKK,
  **PLN** podświetlony, CHF, NOK, …).

**Mapowanie**

| Swapcard                              | NES                                                            | Stan | Zadanie |
| ------------------------------------- | -------------------------------------------------------------- | ---- | ------- |
| jedna waluta dla biletów i dodatków   | `events.ticket_currency` (per wydarzenie) + waluty w cennikach | 🟡   | EB-1102 |
| zmiana waluty **tylko przez support** | brak analogicznej blokady                                      | 🔴   | EB-1102 |

**Wnioski**

1. To ostrzeżenie jest **lekcją dla naszego modelu**, nie tylko ciekawostką:
   po pierwszej sprzedaży waluta staje się niezmienna, bo kwoty w zamówieniach są
   historyczne. Nasz `events.ticket_currency` da się dziś zmienić kliknięciem —
   po sprzedaniu pierwszego biletu to psuje raportowanie. Reguła do wdrożenia:
   **waluta wydarzenia jest edytowalna tylko dopóki nie istnieje żadne
   zamówienie**, potem wyłącznie przez migrację (`payment_orders` trzyma
   `currency` per zamówienie, więc dane są bezpieczne — chodzi o spójność UI).
2. `ticket_currency` per wydarzenie jest u nas **lepsze** niż jedna waluta na
   społeczność: kongres w Warszawie sprzedaje w PLN, seminarium w Brukseli w EUR.

### Zrzut 11.3 — `Exhibitor Marketplace` · lista dodatków

**Co widać**

- Banner: „**New Feature Release!** Easily customize the marketplace for your
  exhibitors. Try it out and share your feedback." + `Provide feedback`.
- „Offer exhibitors tailored add-ons to enhance their event presence with additional
  services and products, creating valuable monetization opportunities…"
- Zakładki: **`Extras`** · **`Orders`** · **`Revenue team`**.
  Akcje: `Payment settings` · `Marketplace settings` · **`Create an extra`**.
- Tabela: `Status` · `Extra name` · **`Related permission`** · `Price` · `Units sold`.
  Dwa wpisy, oba `Disabled`, `0` sprzedanych:
  **Lead Capture (LC)** → uprawnienie `Lead capture` → **532,90 zł**;
  **Lead Qualification** → uprawnienie `Lead qualification` → **103,24 zł**.

**Mapowanie**

| Swapcard                                            | NES                                                                                          | Stan               | Zadanie |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------ | ------- |
| **`Related permission`** — zakup NADAJE uprawnienie | wzorzec istnieje: warstwy członkowskie z flagami funkcji (`tierHasFeature`, `min_tier_rank`) | 🟡 **wzorzec 1:1** | EB-1103 |
| `Orders` (zamówienia dodatków)                      | `payment_orders`                                                                             | ✅                 | —       |
| `Revenue team` (zespół sprzedaży / prowizje)        | `crm_leads.owner_id`, lej CRM                                                                | 🟡                 | EB-1104 |
| `Status: Disabled / Enabled` per pozycja            | `event_ticket_types.visibility` jako analogia                                                | 🟡                 | EB-1101 |
| `Units sold`                                        | licznik zamówień                                                                             | ✅                 | —       |

**Wnioski**

1. **`Related permission` to najważniejsza rzecz na tym ekranie.** Zakup nie jest
   tylko transakcją — **nadaje zdolność** (`Lead capture`). To znaczy, że
   uprawnienia w Swapcardzie mają trzy źródła: grupa, nadpisanie na podmiocie
   (zrzut 8.9) i **zakup**. Nasz `event_capabilities()` musi to unieść jako
   czwarty składnik kaskady: `rola platformy × grupa × warstwa × uprawnienia
kupione`. W repo istnieje precedens — warstwy członkowskie z flagami funkcji
   (`tierHasFeature`) robią dokładnie to dla użytkownika; tu chodzi o firmę.
2. Ceny są znaczące: **532,90 zł za Lead Capture** przy „minimum 531,90 zł,
   matching the Swapcard fee" (zrzut 11.5) i **szacowanej wypłacie 64,53 zł**.
   Czyli organizator sprzedaje funkcję Swapcarda, oddaje Swapcardowi ~88% ceny
   i zostawia sobie resztę. To nie jest marketplace organizatora — to **kanał
   sprzedaży Swapcarda z organizatorem jako pośrednikiem**. Warto to zapisać,
   bo zmienia ocenę tej funkcji: dla NES wartość ma sprzedaż **własnych** pozycji
   (pakiet partnerski, panel sponsorowany, stoisko, wejściówki dla obsługi),
   a nie odsprzedaż cudzych dodatków.

### Zrzut 11.4 — szczegóły dodatku „Lead Capture (LC)" (góra)

**Co widać**

- Nagłówek: `Lead Capture (LC)` · plakietka `0 sold` · `Disabled` · przycisk
  **`Enable extra`**.
- Banner: „**Collect payments** — Connect your Stripe account to accept payments for
  extras." + `Set gateway`.
- `Basics`: `* Extra name` (`17/50 characters`), `* Description`
  („Exhibitor members will be able to use the mobile app to scan participants badges,
  saving their contact information.", `115/500`), `Image`
  („Manage image visibility on the Marketplace settings"), `Quantity` = `No limit`.

**Mapowanie**

| Swapcard                                        | NES                                                                              | Stan | Zadanie |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | ---- | ------- |
| pozycja sprzedażowa (nazwa, opis, obraz, limit) | `event_ticket_types` ma dokładnie ten kształt (nazwa, opis, `quota`, widoczność) | 🟡   | EB-1101 |
| bramka płatności per wydarzenie                 | `/admin/billing` (globalna) — i **tak jest lepiej**                              | ✅   | —       |
| `Enable extra` (włącz sprzedaż)                 | `status` / okno sprzedaży                                                        | 🟡   | EB-1101 |

**Wnioski**

1. Kształt pozycji sprzedażowej („nazwa, opis, obraz, limit, cena, widoczność,
   grupa docelowa") jest **identyczny** z typem wejściówki (zrzut 4.1). To argument,
   żeby u nas **nie budować drugiej encji**: pakiet partnerski to
   `event_ticket_types` z `audience ('person','company')` i opcjonalnym
   `grants_capabilities jsonb`. Jedna tabela, dwa zastosowania — zamiast dwóch
   równoległych systemów cenowych w jednym wydarzeniu.

### Zrzut 11.5 — szczegóły dodatku (dół): uprawnienia, cena, e-mail po zakupie

**Co widać**

- `Permissions` — „Define the permissions for this extra and choose which group can
  view it.": `Related permissions` (checkboxy: **Lead capture** ✓, `Lead qualification` ☐);
  `* Assigned groups`: **Exhibitors** ✓.
- `Price` — `* Price (before tax)` = `532,9`; `Estimated payout` = **`PLN 64.53`**;
  link `How fees work`; nota: „**Minimum price set to PLN 531.90, matching the
  Swapcard fee.**"
- `Additional settings` — `"Learn more" link` („Add a link so the exhibitor can find
  out more about this extra").
- `After purchase email campaign` — „Create an email in the email manager for this
  extra. Customize it to send more information to your exhibitors about their
  purchase." + `Create campaign`.
- `Preview` — podgląd karty dodatku.

**Mapowanie**

| Swapcard                                            | NES                                                                                                   | Stan | Zadanie |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---- | ------- |
| zakup → nadanie uprawnień (lista)                   | `event_ticket_types.grants_capabilities jsonb` + `event_capabilities()`                               | 🔴   | EB-1103 |
| `Assigned groups` (kto widzi pozycję)               | widoczność pozycji per grupa                                                                          | 🔴   | EB-1101 |
| cena przed podatkiem + szacowana wypłata + prowizja | `payment_orders`, Stripe, `/admin/billing-reconcile`                                                  | 🟡   | EB-1105 |
| **e-mail po zakupie** powiązany z pozycją           | **istnieje**: kampanie i szablony w `/admin/newsletter`, e-maile systemowe, `rsvp-email.functions.ts` | ✅   | EB-1106 |
| podgląd karty pozycji                               | wzorzec podglądów (`LayoutPreview`)                                                                   | 🟡   | —       |

**Wnioski**

1. „E-mail po zakupie powiązany z pozycją sprzedażową" to wzorzec, który warto
   przenieść **także na bilety**: kupujesz `Partner` → dostajesz inną wiadomość
   niż kupujący `Uczestnik` (instrukcja dla obsługi stoiska vs plan dojazdu).
   NES ma szablony i kampanie; brakuje wyłącznie **powiązania szablonu z typem
   wejściówki**. Tanie, a widoczne dla każdego uczestnika.
2. Podatek: pole nazywa się „Price (before tax)". Nasz model trzyma dziś
   `ticket_price_cents` bez rozstrzygnięcia netto/brutto. Przy sprzedaży pakietów
   partnerskich firmom (faktura VAT) to **musi** być jawne: `price_cents` +
   `tax_rate` + `price_is_net boolean`. Inaczej pierwsza faktura dla partnera
   wymaga ręcznej korekty.
3. Cały ekran jest ostatecznym potwierdzeniem, że **nie budujemy marketplace'u**,
   ale trzy jego mechanizmy wchodzą do naszego modelu jako rozszerzenia biletów:
   `audience ('person','company')`, `grants_capabilities` i `email_template_id`.

---

## Partia 12 — 2026-08-23 (Meetings: spotkania 1-1, slots, locations)

Sidebar `Meetings` rozwija się na: **All meetings** · **Slots** · **Locations** ·
**Request rules** · **Hosted buyer & Smart Meetings** (`New`).

> **To najważniejsza partia po sesjach.** NES ma networking 1-1 w produkcji, ale
> **zbudowany na innym modelu** niż Swapcard. Ta różnica jest sedno tej partii.

### Zrzut 12.1 — `…/meetings/schedule` · „All meetings"

**Co widać**

- „Make sure people can meet at the time and place that's convenient for them."
- Stan pusty: „**No meetings scheduled, make sure you create slots, locations,
  generate condition and/or add request rules.**" + `Create locations`.

**Mapowanie**

| Swapcard                                                 | NES                                            | Stan | Zadanie |
| -------------------------------------------------------- | ---------------------------------------------- | ---- | ------- |
| lista wszystkich spotkań wydarzenia                      | `meeting_bookings` istnieje, **panelu nie ma** | 🔴   | EB-1001 |
| cztery warunki wstępne (sloty, miejsca, warunki, reguły) | u nas warunkiem jest tylko slot hosta          | 🟡   | EB-1002 |

**Wnioski**

1. Stan pusty wymienia **cztery** rzeczy potrzebne, żeby spotkania w ogóle
   zadziałały: sloty, miejsca, warunek generowania i reguły zapytań. NES ma
   pierwsze i (częściowo) trzecie. To dobra lista kontrolna zakresu etapu E6.

### Zrzut 12.2 — `…/meetings/places` · „Create locations"

**Co widać**

- „Create meeting locations to define where your participants can meet.
  **'Category'** allows you to apply an area (floor, hall, zone) to the room name.
  **'Meeting capacity'** is the capacity of meetings that can occur **at the same
  time** for the location. A capacity set to '1' means the location can only hold
  one meeting at a time."
- Pola: `Category` (np. „Hall 2", „Level 3") · `* Name` (np. „Blue room", „Table") ·
  `* Meeting capacity` = `3` · `Virtual` (przełącznik, wyłączony).
  Przycisk `Create 1 location`.

**Mapowanie**

| Swapcard                                                | NES                                                           | Stan | Zadanie |
| ------------------------------------------------------- | ------------------------------------------------------------- | ---- | ------- |
| słownik miejsc spotkań (kategoria + nazwa)              | `meeting_slots.location text` — **wolny tekst, bez słownika** | 🔴   | EB-1003 |
| **pojemność równoległa miejsca**                        | brak pojęcia; u nas slot = jedno spotkanie                    | 🔴   | EB-1004 |
| `Virtual` (miejsce zdalne)                              | `meeting_slots.is_public` / link zewnętrzny — nie to samo     | 🔴   | EB-1005 |
| ten sam słownik lokalizacji co przy sesjach (zrzut 6.2) | jeden słownik `event_locations` dla sesji **i** spotkań       | 🔴   | EB-835  |

**Wnioski**

1. „Pojemność równoległa" to nietrywialna zmiana modelu: u nas slot jest
   niepodzielny (jeden potwierdzony uczestnik na slot, egzekwowane częściowym
   indeksem unikalnym + `FOR UPDATE` — wzorzec `rsvp_event`). U Swapcarda
   **slot × miejsce** tworzy siatkę: przy 40 slotach i 3 stolikach mamy 120
   równoległych okien. Nasz odpowiednik: `event_meeting_locations.capacity`,
   a przydział miejsca następuje **przy akceptacji spotkania** (pierwsze wolne
   miejsce w tym slocie), nie przy tworzeniu slotu.
2. Rekomendacja: **jeden słownik lokalizacji** dla całego wydarzenia
   (`event_locations`: kategoria, nazwa, pojemność, wirtualne, sala sesyjna czy
   stolik networkingowy). Sesja wskazuje lokalizację, spotkanie też. Dwa słowniki
   („sale sesji" i „miejsca spotkań") rozjadą się przy pierwszej zmianie planu sal.

### Zrzut 12.3 — `…/meetings/places` · lista „Locations"

**Co widać**

- `Search an exhibitor` · `Default meeting location capacity` · `Add locations`.
- Tabela: `Category` · `Name` (sort) · `Meeting capacity` · **`Exhibitors`** (filtr) ·
  `Confirmed` · **`Confirmed - past`** · `Pending` · `Canceled` · **`Expired`** ·
  **`Not held`**. Jeden wiersz testowy (`d` / `d` / `3` / – / zera).

**Mapowanie**

| Swapcard                                                       | NES                                                                  | Stan | Zadanie |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | ---- | ------- |
| miejsce **przypisane do firmy** (stoisko jako miejsce spotkań) | brak; po decyzji §0.4: `event_companies` + lokalizacja               | 🔴   | EB-1006 |
| domyślna pojemność miejsca (ustawienie globalne)               | brak                                                                 | 🔴   | EB-1004 |
| **statystyki per miejsce** w siedmiu stanach                   | `meeting_bookings.status` ma **dwa** stany: `confirmed`, `cancelled` | 🔴   | EB-1007 |

**Wnioski**

1. Siedem kolumn stanu to **cały cykl życia spotkania**, którego NES nie modeluje:
   `pending` (zaproszenie czeka), `confirmed`, `confirmed - past` (odbyło się),
   `canceled`, `expired` (nikt nie odpowiedział na czas), `not held` (nikt nie
   przyszedł), `draft`. Nasze dwa stany (`confirmed`/`cancelled`) wynikają
   z modelu „rezerwuję wolny slot hosta" — tam nie ma czego akceptować.
   **To jest właściwa różnica między produktami** (patrz zrzut 12.5, wniosek 1).
2. `expired` i `not held` to nie ozdoby raportu: pierwszy mierzy jakość
   matchmakingu (ile zapytań umiera bez odpowiedzi), drugi frekwencję (ile
   potwierdzonych spotkań się nie odbyło). Bez nich nie da się poprawić programu
   networkingowego w kolejnej edycji.

### Zrzut 12.4 — `…/meetings/slots` · lista slotów

**Co widać**

- `Add slots`. Tabela: `Date` (sort) · `Duration` · `Confirmed` · `Pending` ·
  `Canceled` · `Expired` · `Not held` · **`Draft`**.
- Cztery wpisy, wszystkie z zerami; widoczne **anomalie danych**:
  `November 27, 2024 11:00 PM – 11:30 PM` (30 min, rok 2024),
  `March 27, 2025 12:00 AM – 3:30 PM` → **930 minutes**,
  `March 27, 2025 12:00 AM – 5:30 PM` → **1050 minutes**,
  `March 27, 2025 10:00 AM – 10:30 AM` (30 min).

**Mapowanie**

| Swapcard                              | NES                                                                                           | Stan | Zadanie |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ---- | ------- |
| slot jako wiersz z czasem i długością | `meeting_slots` (`starts_at`, `ends_at`, `host_user_id`, `event_id`, `location`, `is_public`) | ✅   | —       |
| slot **wydarzenia**, nie hosta        | `meeting_slots.host_user_id` jest **wymagany** — slot zawsze należy do osoby                  | 🔴   | EB-1008 |
| statystyki per slot                   | jak wyżej — dwa stany                                                                         | 🔴   | EB-1007 |

**Wnioski**

1. Slot o długości **1050 minut** (17,5 godziny) i slot z 2024 roku w wydarzeniu
   z 2025 to nie ciekawostka, a wskazówka produktowa: **generator slotów bez
   walidacji produkuje śmieci**, które potem trafiają do uczestnika jako
   „dostępne terminy". Nasz panel musi: (a) ograniczyć slot do zakresu dat
   wydarzenia, (b) ostrzegać przy długości powyżej ~2 h, (c) pozwolić na masowe
   usunięcie partii.
2. Kluczowa różnica modelowa: u nas slot **należy do hosta**
   (`meeting_slots.host_user_id NOT NULL`), u Swapcarda slot należy do
   **wydarzenia** i jest wspólną siatką czasu dla wszystkich. Nasz model jest
   lepszy dla „umów się z ekspertem", swapcardowy dla „kongres z 200 uczestnikami
   networkingującymi się między sobą". Rekomendacja: `host_user_id` staje się
   **opcjonalny** — `NULL` oznacza slot wspólny wydarzenia. Jedna zmiana kolumny
   otwiera drugi tryb bez rozbijania pierwszego.

### Zrzut 12.5 — modal „Create meeting slots" (generator partii)

**Co widać**

- „Create slots where you want your participants to meet. **Each batch allows you to
  create several consecutive slots of the same duration**, for which you have to
  define the date, the start time of the first slot, the end time of the last one,
  as well as their duration."
- Dwie partie: `11/26/2025` `9:00 AM` → `7:00 PM`, `30 minutes`;
  `11/27/2025` `9:00 AM` → `7:00 PM`, `30 minutes`.
  `Add another batch` · przycisk **`Create 40 slots`**.

**Mapowanie**

| Swapcard                                                        | NES                                                                                       | Stan       | Zadanie |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------- | ------- |
| **generator partii slotów** (dzień + okno + długość → N slotów) | `create_my_meeting_slot` tworzy **jeden** slot                                            | 🔴         | EB-1009 |
| licznik w przycisku („Create 40 slots")                         | wzorzec „liczba w przycisku potwierdzenia" jest już opisany w repo (`adminSegment.ts` §4) | ✅ wzorzec | —       |

**Wnioski**

1. **Podsumowanie różnicy modelowej — do decyzji przy E6.** Swapcard i NES
   rozwiązują dwa różne problemy:

   |                  | NES dziś                           | Swapcard                                                   |
   | ---------------- | ---------------------------------- | ---------------------------------------------------------- |
   | kto tworzy sloty | **host** (ekspert, prelegent)      | **organizator** dla całego wydarzenia                      |
   | jednostka        | slot = jedno spotkanie             | slot × miejsce = siatka okien                              |
   | inicjacja        | uczestnik **rezerwuje** wolny slot | uczestnik **wysyła zapytanie**, druga strona akceptuje     |
   | stany            | `confirmed`, `cancelled`           | 7 stanów z `pending`, `expired`, `not held`                |
   | miejsce          | pole tekstowe na slocie            | słownik miejsc z pojemnością, przydzielany przy akceptacji |
   | kto z kim        | dowolny uczestnik do hosta         | **reguły zapytań** (grupa × grupa)                         |

   Rekomendacja: **rozszerzyć, nie zastępować**. Cztery zmiany dają parytet
   bez utraty dzisiejszego trybu:
   - `meeting_slots.host_user_id` → opcjonalny (`NULL` = slot wspólny wydarzenia)
     - generator partii (jeden RPC, `generate_series` po czasie),
   - `event_locations` ze słownikiem, pojemnością równoległą i flagą `virtual`,
   - `meeting_requests` (zapytanie: od kogo, do kogo, slot preferowany, wiadomość)
     ze stanami `draft | pending | accepted | declined | expired | cancelled`
     - `held boolean` (frekwencja),
   - `meeting_request_rules` (macierz grupa × grupa: kto może zapraszać kogo)
     — na tym samym silniku warunków co `club_segment_rules`.

2. „Create 40 slots" liczy dokładnie tyle, ile powstanie — dokładnie ta zasada,
   którą repo ma już zapisaną przy kampaniach segmentowych: liczba w przycisku
   jest treścią potwierdzenia, bo operacja masowa jest nieodwracalna.
3. `Hosted buyer & Smart Meetings` (pozycja `New` w sidebarze, bez zrzutu) to
   program VIP-ów z ustawionymi z góry spotkaniami plus matchmaking. Zostaje
   **poza zakresem** pierwszej wersji: dla NES sensowniejsze jest „dobre 1-1
   z rekomendacją tematyczną" (osadzenia wektorowe już są) niż program hosted buyer.

---

## Partia 13 — 2026-08-23 (matching: reguły zapytań, hosted buyer, smart meetings)

### Zrzut 13.1 — `…/meetings/rules` · „Create rule"

**Co widać**

- „Create a request rule to define **who can request meeting (requesters)**, **to whom
  (invitees)** and **in which locations**. Select all groups if you do not want any
  restrictions."
- `Rule name` — „This name is only visible to you".
- **`Who should meet with whom?`** — „People of groups **Requesters** will be able to
  send meeting requests to the people **and exhibiting companies** of groups
  **Invitees**." Dwie kolumny checkboxów (`Exhibitors`, `Speakers`, `Attendees`)
  z `Select all` nad każdą.
- **`Where and when should they meet?`** — „Select the locations where participants can
  meet, as well as the time slots when each location is available."
  Ostrzeżenie: „Time slots must be created first" + `Add time slots`.
- **`Meeting request expiration`** — „Define the meeting request expiration time;
  changes impact only **new** meeting requests. **A 2 to 4-day expiration boosts
  acceptance rates.**" Radio: `After a time period of` [`3`] [`Day(s)`] /
  `At meeting start date`.

**Mapowanie**

| Swapcard                                             | NES                                                         | Stan | Zadanie |
| ---------------------------------------------------- | ----------------------------------------------------------- | ---- | ------- |
| **macierz kto-może-zapraszać-kogo** (grupa × grupa)  | brak; u nas każdy może rezerwować wolny slot hosta          | 🔴   | EB-1010 |
| zapraszanie **firm**, nie tylko osób                 | `event_companies` jako adresat zapytania                    | 🔴   | EB-1011 |
| reguła wiąże grupy **z lokalizacjami i slotami**     | brak                                                        | 🔴   | EB-1012 |
| **wygaśnięcie zapytania** (dni albo start spotkania) | brak stanu `pending`, więc i wygaśnięcia                    | 🔴   | EB-1013 |
| „zmiany dotyczą tylko nowych zapytań"                | wersjonowanie reguły albo znacznik na zapytaniu             | 🔴   | EB-1013 |
| nazwa reguły widoczna tylko dla admina               | `name` + wzorzec „Label (only visible to you)" z zrzutu 3.3 | —    | —       |

**Wnioski**

1. **To jest brakująca oś modelu spotkań.** Trzy wymiary reguły — kto zaprasza,
   kogo, gdzie i kiedy — plus czas wygaśnięcia. W naszym modelu (`meeting_slots`
   hosta) żaden z nich nie istnieje, bo rezerwacja jest natychmiastowa i nie ma
   czego regulować. Propozycja tabeli:
   `meeting_request_rules(event_id, name, requester_group_ids uuid[],
invitee_group_ids uuid[], location_ids uuid[], slot_ids uuid[],
expires_after_hours int NULL, expires_at_meeting_start boolean)`.
2. Wskazówka „2 do 4 dni podnosi wskaźnik akceptacji" jest **wiedzą produktową
   z danych** i warto ją skopiować **razem z domyślną wartością**: nasz
   `expires_after_hours` startuje z 72 (3 dni), a nie z `NULL`. Domyślne „nigdy
   nie wygasa" oznaczałoby setki wiszących zapytań i martwe siatki slotów.
3. „Zmiany dotyczą tylko nowych zapytań" to reguła o niezmienności historii:
   zapytanie zapisuje swój czas wygaśnięcia **w momencie utworzenia**
   (`meeting_requests.expires_at`), a nie liczy go z aktualnej reguły. Bez tego
   zmiana reguły unieważnia wysłane zaproszenia — i słusznie Swapcard to podkreśla.

### Zrzut 13.2 — `…/meetings/hosted-buyer` · „Hosted buyer & Smart meetings" (`Add-on`)

**Co widać**

- „Let participants choose who they want to meet, and **our algorithm will generate
  their best agenda** to optimize business time." + `Get feature`.
- `Ready for next-level networking?`
  - **Let participants choose** — „Create a **selection page** where participants can
    choose their preferred meetings by marking others as **»Highly Interested«** or
    **»Interested«**".
  - **Smart meeting scheduling** — „Use AI to generate meetings based on
    **preferences, availability, and selection criteria**, ensuring an optimized
    schedule for all participants."

**Mapowanie**

| Swapcard                                                         | NES                                                                                    | Stan | Zadanie |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---- | ------- |
| strona wyboru preferencji („chcę poznać te osoby")               | brak; wzorzec zbliżony: `/profile/interests`, `customize-interests`                    | 🔴   | EB-1014 |
| dwa poziomy zainteresowania (`Highly Interested` / `Interested`) | waga preferencji                                                                       | 🔴   | EB-1014 |
| algorytm generujący optymalną agendę spotkań                     | brak; **to problem optymalizacyjny**, nie „AI"                                         | 🔴   | EB-1015 |
| rekomendacje „kogo poznać"                                       | osadzenia wektorowe (`club_thread_embeddings`), `search_companies_public`, scoring CRM | 🟡   | EB-1016 |

**Wnioski**

1. **Nazwijmy rzecz po imieniu: „Smart meeting scheduling" to nie AI, a
   przydział dwustronny** (wariant problemu skojarzeń / stable matching
   z ograniczeniami: pojemność slotów, pojemność miejsc, preferencje z wagami,
   dostępność obu stron, limit spotkań na osobę). To zadanie algorytmiczne
   o znanych rozwiązaniach — i to jest dobra wiadomość, bo znaczy, że nie
   potrzebujemy modelu językowego, tylko dobrze postawionego solvera.
2. Dla NES sensowna jest **wersja lekka**, wprost na naszych danych:
   uczestnik zaznacza preferencje (dwa poziomy), a algorytm proponuje agendę
   spotkań, którą **człowiek zatwierdza**. Rekomendacje „kogo poznać" mamy
   na czym oprzeć: wspólne tematy (`topics`), specjalizacje, osadzenia wektorowe,
   sektor firmy. Kolejność prac: najpierw zapytania i reguły (E6), preferencje
   i przydział dopiero po pierwszym kongresie na żywych danych — bez danych
   o akceptacjach solver jest zgadywaniem.
3. `Hosted buyer` w wersji Swapcarda to program VIP (kupujący z opłaconym
   przyjazdem i narzuconym planem spotkań). Dla NES to **nie ten produkt**:
   analogiem jest „gość zaproszony" z gwarantowanymi rozmowami, ale bez
   ekonomii hosted buyer. Zostaje poza zakresem.

### Zrzuty 13.3–13.5 — materiał wideo: konfiguracja strony wyboru

**Co widać** (trzy kadry z filmu instruktażowego)

- **13.3 `Define access and display groups`** — „The meeting selection page lets
  participants choose who they'd like to meet."
  `Who can access the page?` → wybór grup (`Exhibitors`, `Speakers`, `Attendees`,
  **`Buyers`**, **`Sellers`**); `Who is displayed on the page?` → wybór grup.
  Napis w filmie: „Define who can meet whom, when, and where".
- **13.4** konfiguracja strony: `What is the page's name?` = **„Meet buyers"**,
  kolor `#CF386B`, **paleta ~50 ikon**, `Button background image`
  (600×200 px, ≤300 kB); `Which filters should be available?` → `Industry`, `Size`,
  `Location`, `Job Function`, `Purchase role`… („Select the fields you want displayed
  as search filters. You can create new ones and manage their order in the
  **custom fields settings**"). Napis: „with matching custom rules on category".
- **13.5 `Define meeting times and locations`** — `When should they meet?` →
  siatka slotów per dzień (30-minutowe kafle 9:00–18:30, część włączona, część nie),
  dni jako rozwijane sekcje z checkboxem (`Monday, September 15, 2030`,
  `Tuesday, September 16`, `Wednesday, September 17`). Napis: „and give preference to
  your top VIP buyers".

**Mapowanie**

| Swapcard                                                                        | NES                                                                              | Stan | Zadanie |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---- | ------- |
| strona wyboru jako **strona wydarzenia** (nazwa, kolor, ikona, obraz przycisku) | `event_pages` + builder (§0.1, §4.7) — **dokładnie ten mechanizm**               | 🟡   | EB-1014 |
| kto ma dostęp / kto jest wyświetlany (dwie listy grup)                          | macierz widoczności (§7) + `event_capabilities()`                                | 🔴   | EB-306  |
| **filtry z pól własnych** (`Industry`, `Size`, `Job Function`…)                 | `event_custom_field_defs` z `is_filter` (§4.12) — reguła „tylko pola słownikowe" | 🟡   | EB-832  |
| grupy `Buyers` / `Sellers` (poza trzema systemowymi)                            | `event_groups` z własnymi grupami redakcji                                       | 🔴   | EB-301  |
| włączanie **pojedynczych slotów** w siatce dni                                  | `meeting_slots` + flaga aktywności per slot                                      | 🔴   | EB-1012 |
| paleta ~50 ikon dla strony                                                      | `/admin/icons` + `IconPackSync` — **mamy bogatszą**                              | ✅   | —       |

**Wnioski**

1. Strona wyboru spotkań **nie jest osobnym silnikiem** — to strona wydarzenia
   z nazwą, ikoną, kolorem i widgetem („kogo chcesz poznać"). Trzeci raz to samo
   potwierdzenie §0.1: wszystko, co Swapcard nazywa „stroną", u nas jest wierszem
   w `pages` + widgetem. Nowy jest wyłącznie **widget preferencji spotkań**.
2. `Buyers` i `Sellers` na liście grup to dowód, że grupy systemowe są tylko
   punktem startu — redakcja tworzy własne (u nas np. `Delegaci`, `Prasa`,
   `Instytucje`, `Młodzi liderzy`). Potwierdza `is_system` + `Add a group` z §4.3.
3. Filtry katalogu pochodzą **z tego samego słownika pól własnych**, co pola
   profilu i sesji (§4.12). To ostateczne potwierdzenie decyzji o **jednym
   mechanizmie pól własnych** dla wszystkich encji wydarzenia — czwarte miejsce,
   w którym Swapcard sięga po ten sam słownik.

---

## Partia 14 — 2026-08-23 (Communications: e-maile i powiadomienia)

Sidebar `Communications` rozwija się na: **Emails** · **Notifications**.

### Zrzut 14.1 — `…/emails` · kampanie (góra)

**Co widać**

- „Manage and personalize attendee communications. **Target specific groups** with
  customized content, ensuring timely, relevant information to boost engagement…"
- Akcje: `Email templates` · `Email header` · **`Create a campaign`**.
- **`Campaign for Registration`** (z ikoną „i") → tabela: `Status` · `Subject` ·
  `Date` · `Type` · `Sent` · `Opened` · `Clicked`.
  Wiersz: `Disabled` · „Registration confirmation" · – · **`Registration`** · – · – · –
- **`Campaign for Attendees`** z plakietką grupy `Attendees` + `Create email`:
  - „Curious about who you'll meet?" · `Nov 17, 2024 · 9:00 AM (CEST)` · **`Continuous`**
  - „Have you joined your event community?" · `Nov 24` · `One-time`
  - „It's almost go-time! Are you ready?" · `Nov 26` · `One-time`
  - „Let's keep the momentum going!" · `Nov 28` · `One-time`
    (wszystkie `Disabled`)

**Mapowanie**

| Swapcard                                                           | NES                                                                                                           | Stan               | Zadanie |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------ | ------- |
| kampania **per grupa wydarzenia**                                  | `newsletter_campaigns.audience_filter jsonb` — wystarczy `{ event_id, group_ids }`                            | 🟡 **wzorzec 1:1** | EB-1107 |
| trzy typy wysyłki: `Registration` / `Continuous` / `One-time`      | `newsletter_campaigns.status` + `scheduled_at`; brak typu „ciągła"                                            | 🟡                 | EB-1108 |
| statystyki `Sent` / `Opened` / `Clicked`                           | `newsletter_campaign_events` (+ widoki `newsletter_campaign_engagement`, `newsletter_deliverability_metrics`) | ✅                 | —       |
| gotowa **sekwencja cyklu życia** (4 e-maile: przed, w trakcie, po) | brak gotowych sekwencji; szablony systemowe istnieją                                                          | 🔴                 | EB-1109 |
| `Email templates` / `Email header`                                 | `/admin/newsletter/email-content`, `/admin/newsletter/system-emails`, `/admin/newsletter/email-preview`       | ✅                 | —       |

**Wnioski**

1. **Najlepszy stosunek wartości do pracy w całej partii:** `audience_filter jsonb`
   w `newsletter_campaigns` już istnieje, więc „kampania do grupy Prelegenci tego
   wydarzenia" to **filtr, nie nowy moduł**. Praca: rozszerzyć filtr o
   `event_id` + `group_ids` i dodać ekran kampanii w studiu wydarzenia,
   który linkuje do istniejącego edytora.
2. Czteroelementowa sekwencja („poznaj uczestników" → „dołącz do społeczności" →
   „już prawie start" → „utrzymajmy tempo") to **gotowy scenariusz komunikacji**,
   który NES może skopiować jako **preset rodzaju wydarzenia** (§5,
   `event_types.default_features`). To wiedza operacyjna warta więcej niż kod.
3. Typ `Continuous` (wysyłka ciągła — każdy nowy zarejestrowany dostaje e-mail
   po zapisie) to u nas **brakujący tryb**: dzisiejsze kampanie są jednorazowe
   z `scheduled_at`. Wzorzec do dodania: `trigger ('scheduled','on_register',
'before_event','after_event')` z przesunięciem w godzinach.

### Zrzut 14.2 — kampanie dla wystawców i prelegentów

**Co widać**

- **`Campaign for Exhibitors`** [`Exhibitors`]: „Want qualified leads and a higher
  ROI?" (`Continuous`), „Qualified prospects are waiting to meet you!",
  „Your prospects have the app – do you?", „Stay in touch with your new contacts."
- **`Campaign for Speakers`** [`Speakers`]: „Your audience looks forward to your
  session!" (`Continuous`), „Want to see who's attending your session?",
  „Are you engaging with your audience?", „Make the most of your new connections."

**Mapowanie**

| Swapcard                                         | NES                                    | Stan | Zadanie |
| ------------------------------------------------ | -------------------------------------- | ---- | ------- |
| osobna sekwencja per grupa (3 grupy × 4 e-maile) | jedna kampania = jeden filtr odbiorców | 🟡   | EB-1107 |
| treść dopasowana do **roli**, nie do wydarzenia  | j.w.                                   | 🟡   | EB-1109 |

**Wnioski**

1. Trzy sekwencje po cztery e-maile pokazują, że komunikacja jest zorganizowana
   **wokół grupy, nie wokół wydarzenia**: prelegent dostaje „twoja publiczność
   czeka", partner „leady i ROI", uczestnik „poznaj innych". To ta sama zasada,
   co przy typach biletów (zrzut 3.5): **grupa jest osią całego produktu** —
   uprawnień, widoczności, komunikacji i sprzedaży.
2. Dla NES praktyczny wniosek: presety rodzajów wydarzeń powinny nieść **domyślne
   sekwencje per grupa** w dwóch językach. Redakcja włącza i edytuje, a nie pisze
   od zera przy każdym kongresie.

### Zrzut 14.3 — edytor e-maila · zakładka „Properties"

**Co widać**

- Nagłówek: „Your audience looks forward to your session!" + `Save as template` ·
  `Send test email`.
- „Modify the template by selecting the content you wish to change."
- Zakładki: **`Properties`** · `Content` · `Blocks`; `Preview`: `Desktop` / `Mobile`.
- Podgląd e-maila: logo Swapcard, „European Strategies Congress", „Hello Jane,
  You've been added to the event app for **European Strategies Congress** as a
  speaker… **ACCESS MY PROFILE**", sekcja „Highlight your profile".
- `Properties`: `* Subject`; `* From (sender's name)` = **`{{{ event_name }}}`**;
  `* Email sending date` = `11/17/2024, 09:00 AM` z błędem walidacji:
  „**The selected date has passed. Please define the hour first.**"; `Email ID`.

**Mapowanie**

| Swapcard                                        | NES                                              | Stan | Zadanie |
| ----------------------------------------------- | ------------------------------------------------ | ---- | ------- |
| edytor z podglądem desktop/mobile               | `/admin/newsletter/email-preview` (dual preview) | ✅   | —       |
| `Save as template` / `Send test email`          | szablony + test w module newslettera             | ✅   | —       |
| nadawca jako **zmienna** (`{{{ event_name }}}`) | `from_name` w kampanii (wartość stała)           | 🟡   | EB-1110 |
| walidacja daty w przeszłości                    | wzorzec walidacji w panelu                       | 🟡   | EB-1111 |
| `Email ID` widoczny                             | j.w. `Event ID` / `Internal ID` (EB-111, EB-808) | 🔴   | EB-808  |

**Wnioski**

1. Nadawca jako zmienna (`{{{ event_name }}}`) to drobiazg z realnym skutkiem:
   e-mail przychodzi od „European Strategies Congress", a nie od „NES Newsletter".
   Przy kilku wydarzeniach rocznie to różnica w otwarciach. U nas `from_name`
   istnieje — brakuje **interpolacji zmiennych** w tym polu.
2. Komunikat „The selected date has passed. Please define the hour first." jest
   **złym** komunikatem (nie mówi, co zrobić z datą) — i to dobra przestroga:
   nasze walidacje mają nazywać poprawkę, nie problem („wybierz datę po dzisiaj").

### Zrzut 14.4 — edytor e-maila · zakładka „Content"

**Co widać**

- `Image type` = `Default email header image`; `Redirection when clicking on image`
  = **`Event Home`** (lista stron aplikacji); `Title type` = `Event name`.
- RTE z **tagami scalającymi jako chipami**: „Hello [`First name`] , You've been added
  to the event app for [`Event name`] as a speaker. Join the app to **increase your
  visibility** and **start engaging with your audience**."
- `Redirection when clicking on button` = `Event Home`; `Button text` = `Access My Profile`.

**Mapowanie**

| Swapcard                                               | NES                                            | Stan | Zadanie |
| ------------------------------------------------------ | ---------------------------------------------- | ---- | ------- |
| **tagi scalające jako chipy** (nie `{{surowy_tekst}}`) | e-maile systemowe mają zmienne; UI chipów brak | 🟡   | EB-1112 |
| **przekierowanie z listy stron aplikacji** (deep link) | brak; u nas linki wpisuje się ręcznie          | 🔴   | EB-1113 |
| `Title type` (nazwa wydarzenia / własny)               | j.w.                                           | 🟡   | EB-1112 |

**Wnioski**

1. Chip zamiast `{{first_name}}` to poważna różnica w użyteczności: redakcja nie
   psuje składni, bo nie widzi składni. Przy dwóch językach i kilku szablonach to
   oszczędza realne błędy („Hello {{firstname}}" wysłane do 500 osób).
2. **Przekierowanie wybierane z listy stron wydarzenia** to konsekwencja tego, że
   strony są encją (`event_pages`, §4.7): e-mail linkuje do „Agenda" albo „Prelegenci"
   bez wklejania URL-a. U nas ten sam mechanizm domknie się sam, gdy powstaną
   `event_pages` — wystarczy pole `redirect_page_id` w kampanii zamiast wolnego URL.

### Zrzut 14.5 — `…/notifications` · „Notifications scheduler"

**Co widać**

- „Send timely and relevant notifications about your content or updates to keep people
  informed and engaged." + `Learn how to increase your audience interaction` +
  **`Schedule your first notification`**.
- `How does it work?`: **1** `Select the redirection` („Select a page to redirect your
  users to when they click on your notification. Multiple options are available for you
  to highlight your content.") · **2** `Set the target` („Target specific people by
  **custom field, groups** and more to make sure you reach the right audience.") ·
  **3** `Plan the date & time` („Schedule your notifications in advance to be ready even
  before your event starts.").

**Mapowanie**

| Swapcard                               | NES                                                                                                     | Stan     | Zadanie |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- | ------- |
| harmonogram powiadomień push           | **istnieje**: `push_subscriptions`, `notifications`, Web Push (VAPID), `/admin/community/notifications` | ✅ rdzeń | EB-1114 |
| przekierowanie na stronę wydarzenia    | `event_pages` + deep link (jak w e-mailu)                                                               | 🔴       | EB-1113 |
| celowanie **po polu własnym i grupie** | `event_custom_field_values` + `event_groups` + silnik warunków (`club_segment_rules`)                   | 🟡       | EB-1115 |
| planowanie z wyprzedzeniem             | wzorzec: `pg_cron` (`run_event_reminders`), harmonogram publikacji                                      | ✅       | —       |

**Wnioski**

1. Wszystkie trzy klocki powiadomień NES ma: Web Push z VAPID, tabelę powiadomień,
   panel powiadomień społeczności i `pg_cron` do wysyłek zaplanowanych. Brakuje
   **jednego ekranu w studiu wydarzenia**, który spina: cel (grupa/pole własne) +
   treść + strona docelowa + czas.
2. Powiadomienie i e-mail mają **ten sam trójkąt** (cel, treść, przekierowanie,
   czas). Rekomendacja: jeden ekran „Komunikacja" z dwiema kartami kanału zamiast
   dwóch osobnych modułów — inaczej redakcja poda dwa różne linki w e-mailu i pushu
   o tym samym wydarzeniu.
3. Reguła praktyczna do zapisania: powiadomienia push o sesji („twoja sesja
   startuje za 15 minut") powstają **z danych sesji** (§4.2), a nie z ręcznego
   harmonogramu. Ręczne planowanie zostawiamy dla komunikatów organizacyjnych.

---

## Partia 15 — 2026-08-23 (Onsite: leady, badge'e, skanowanie, checkpointy, self check-in)

Sidebar `Onsite`: **Lead generation** 💎 · **Badge templates** · **Session scanning** 💎 ·
**Checkpoints** 💎 · **Self check-in** 💎 (💎 = dodatek płatny u Swapcarda).

> **Decyzja §0.4: onsite budujemy.** Zamawiający potwierdził: „Tak, musimy stworzyć
> moduły". Ta partia jest więc nie tylko mapowaniem, ale **projektem własnego
> systemu skanowania** — sekcja 15.6 poniżej opisuje go wprost.

### Zrzut 15.1 — `…/lead-generation` · „Lead generation"

**Co widać**

- „Allow your attendees **and exhibitors** to collect valuable leads, enhancing
  networking opportunities and optimizing event outcomes with our intuitive badge
  scanning."
- Dwie karty `Add-on`: **Lead capture** („Use the app to scan participant badges for
  simple lead collection and sharing." + `Get feature`) i **Lead qualification**
  („…giving them a way to qualify leads by criteria they define." + `Get feature`).
- Baner: „**Boost revenue by selling extras in the marketplace!**" + `Set marketplace`.

**Mapowanie / wnioski**

1. Nowa informacja wobec partii 2: leady zbierają **także uczestnicy**, nie tylko
   firmy („attendees and exhibitors"). To zmienia model: `event_leads.owner` może być
   osobą albo firmą. U nas: `event_leads(owner_person_id NULL, owner_company_id NULL,
CHECK (num_nonnulls(owner_person_id, owner_company_id) = 1))`.
2. Skan „uczestnik → uczestnik" to w istocie **wymiana wizytówek**, a NES ma już
   sieć kontaktów (`connections`, `network.tsx`, stopień oddalenia). Rekomendacja:
   skan między uczestnikami tworzy **połączenie w sieci kontaktów**, a nie leada
   w CRM. Lead w CRM powstaje wyłącznie przy skanie **firma → uczestnik**, i tylko
   za zgodą (§4.8).

### Zrzut 15.2 — `…/registration/badge-templates` · „Default badge" (edytor badge'a)

**Co widać**

- Nagłówek: `Default badge` + plakietka `Default`; `Back to badge templates`.
- **Podgląd badge'a w skali 1:1** (kartka A6/A5 pionowa, układ do złożenia na pół):
  - u góry **grafika nagłówkowa** wydarzenia (okładka „Geopolityczna Gra Mocarstw"),
  - `First name Last name` (duża czcionka), `Job title`, **`Company`** (pogrubione),
  - **kod QR**,
  - pasek **logotypów partnerów** (trzy bloki: „PARTNERZY HONOROWI", „PARTNERZY
    MEDIALNI", „PARTNERZY MERYTORYCZNI"),
  - w prawej kolumnie: „Badge generated by **swapcard**",
  - na dole **odbicie lustrzane** treści (druga strona po złożeniu) + instrukcja
    „How to double fold your badge" z trzema miniaturami.
- Panel prawy **`Badge customization`**: „Personalize your badge template. **Default
  badge is associated to all tickets which haven't a template associated.**"
  Zakładki: **`General`** · **`Design`** · **`Fields`**.
  W `General`: `* Badge template name` = `Default badge`.

**Zrzut 15.3 — ten sam edytor, panel elementu `Picture`**

- Panel prawy: **`Picture`** (strzałka powrotu, menu „…"):
  `Header image` (podgląd paska logotypów partnerów),
  **`Width`** = `%` / `100` (jednostka wybierana z listy),
  **`Alignment`** = `Center`, **`Distance from previous (cm)`** = `0,54`.
- Na podglądzie badge'a **zaznaczony element** z etykietą wymiaru `0.54(cm)`
  i ramką selekcji.
- Stopka panelu: `← Previous field` · `Next field →`.

**Mapowanie**

| Swapcard                                                    | NES                                                                                            | Stan       | Zadanie |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------- | ------- |
| edytor badge'a z podglądem 1:1 i selekcją elementów         | **builder istnieje** (sekcja→kolumna→widget, `@dnd-kit`), ale nie dla nośnika drukowanego w cm | 🟡         | EB-1206 |
| jednostki **fizyczne** (cm) i szerokość w %                 | builder operuje na px/%/rem — brak jednostek druku                                             | 🔴         | EB-1207 |
| szablon domyślny + szablon **per typ biletu**               | `event_badge_templates.is_default` + `event_ticket_types.badge_template_id`                    | 🔴         | EB-1208 |
| pola z danych osoby (imię, stanowisko, firma)               | `event_people` (§4.11)                                                                         | 🔴         | EB-1206 |
| kod QR z numerem biletu                                     | `src/lib/events/ticketCode.ts` + QR **już istnieje**                                           | ✅         | —       |
| pasek logotypów partnerów na badge'u                        | `event_sponsors` + `crm_companies.logo_url`                                                    | 🟡         | EB-1209 |
| układ „do złożenia na pół" (druk dwustronny w jednym pliku) | brak                                                                                           | 🔴         | EB-1210 |
| nawigacja `Previous field` / `Next field`                   | wzorzec edytora właściwości w builderze                                                        | ✅ wzorzec | —       |

**Wnioski**

1. **Badge builder to nie builder stron.** Różnica jest zasadnicza: nośnik ma
   fizyczne wymiary, jednostki w centymetrach, margines bezpieczny drukarki
   i wymóg deterministycznego renderu (ten sam PDF na każdej drukarce).
   Rekomendacja: **osobny, wąski edytor** z pionową listą elementów
   (obraz nagłówka → imię i nazwisko → stanowisko → firma → QR → logotypy →
   stopka), każdy z: widoczność, szerokość (% lub cm), wyrównanie, odstęp od
   poprzedniego (cm), rozmiar i grubość czcionki. **Bez swobodnego pozycjonowania
   XY** — bo to gwarantuje, że badge zawsze się zmieści i wydrukuje.
   Wyjście: HTML→PDF w rozmiarze fizycznym (`@page` + `mm`), z podglądem 1:1.
2. Układ „złóż na pół" jest praktyczny (identyfikator czytelny z obu stron
   w smyczy) i tani: to ten sam blok obrócony o 180°, generowany automatycznie
   z przełącznika `double_fold boolean`.
3. „Domyślny badge dotyczy wszystkich biletów bez własnego szablonu" to reguła
   dziedziczenia identyczna z resztą modułu — zapisujemy jako
   `event_ticket_types.badge_template_id NULL = szablon domyślny wydarzenia`.

### Zrzut 15.4 — `…/onsite/sessions` · „Session scanning" (`Add-on`)

**Co widać**

- „Scan attendee badges at the **entrance or exit** of a session to **control access**
  or **track attendance** with SwapAccess App." + `Get feature`.
- `How does it work?`: **1 Attendance tracking** („Scan participant badges at the
  entrances or exits of sessions to control access and measure attendance") ·
  **2 Access control** („Manage access with precision… Ensure only authorized attendees
  enter specific sessions or areas") · **3 Data driven insights** („Analyze attendance
  patterns, session popularity, and participant flow to optimize future events").

### Zrzut 15.5 — `…/self-check-in` · „Self check-in and badge printing" (`Add-on`)

**Co widać**

- „**Swapcard GO** delivers all the necessary equipment to easily allow people with an
  In-App registration ticket to do self check-in and have their badge automatically
  printed." + `Get feature` + wideo.
- `How does it work?`: **1 Use In-App registration** („Self Check-in only works for
  people registered with In-App Registration") · **2 Request a Swapcard GO box**
  („Everything you need will be delivered to you" + `Request a box`) ·
  **3 Use SwapAccess** („Generate a login code for accessing the SwapAccess app on the
  **iPads** included in your Swapcard GO box").

### Zrzut 15.x — `Checkpoints` (treść przekazana przez zamawiającego)

- „**Unlock the power of Checkpoints** — Track or control access to any part of your
  event with badge scanning checkpoints with SwapAccess App." + `Get feature`.
- `How does it work?`: **1 Create checkpoints** („Create as many checkpoints as you
  want to monitor or track access to certain areas of your event") ·
  **2 Create SwapAccess credentials** („Set up credentials to login to the SwapAccess
  App. **These credentials can be used to log in on multiple devices**") ·
  **3 Scan with SwapAccess** („Download the SwapAccess app and scan attendees' badges
  **at the entrance and exit** of your checkpoints").

### 15.6 — Projekt własnego systemu skanowania NES (na życzenie zamawiającego)

Trzy warstwy Swapcarda (`Checkpoints` + `Session scanning` + `Self check-in`)
sprowadzają się do **jednego modelu**: punkty kontroli, poświadczenia urządzeń
i zdarzenia skanu. Propozycja dla NES — **bez aplikacji natywnej i bez pudełka
ze sprzętem**:

```sql
-- Punkt kontroli: wejście na wydarzenie, wejście na salę, sesja, strefa VIP,
-- catering, stoisko partnera. Sesja NIE jest osobnym bytem - jest kotwicą.
event_checkpoints (
  id, tenant_id, event_id,
  name_pl/name_en, kind text
    CHECK (kind IN ('event_entry','session','zone','catering','company_booth')),
  session_id uuid NULL → event_sessions,      -- gdy kind = 'session'
  company_id uuid NULL → crm_companies,       -- gdy kind = 'company_booth'
  location_id uuid NULL → event_locations,
  direction_mode text NOT NULL DEFAULT 'in_out'
    CHECK (direction_mode IN ('in_only','in_out')),
  access_mode text NOT NULL DEFAULT 'track'
    CHECK (access_mode IN ('track','control')), -- mierz frekwencję / wpuszczaj
  allowed_group_ids uuid[],                     -- kto ma prawo wejść (gdy 'control')
  allowed_ticket_type_ids uuid[],
  capacity int,                                 -- ilu jednocześnie w środku
  is_active boolean NOT NULL DEFAULT true
)

-- Poświadczenie URZĄDZENIA, nie osoby: jeden kod na bramkę, działa na wielu
-- urządzeniach, wygasa z wydarzeniem. Bez zakładania kont wolontariuszom.
event_scanner_credentials (
  id, tenant_id, event_id, checkpoint_id NULL,  -- NULL = wszystkie punkty
  label text,                                   -- „Bramka główna", „Sala Blue"
  code_hash text NOT NULL,                      -- hash kodu (nigdy jawny!)
  scopes text[] NOT NULL DEFAULT '{checkin}',   -- checkin | lead | badge_print
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by, created_at
)

-- Zdarzenie skanu. Idempotencja: ten sam człowiek, ten sam punkt, ten sam
-- kierunek w oknie 60 s = jeden wiersz (podwójne piknięcie przy bramce).
event_scans (
  id, tenant_id, event_id, checkpoint_id, person_id → event_people,
  direction text CHECK (direction IN ('in','out')),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  credential_id → event_scanner_credentials,
  device_id text,                               -- z przeglądarki skanera
  result text CHECK (result IN ('granted','denied_group','denied_ticket',
                                'denied_capacity','denied_duplicate','unknown_code')),
  offline_queued_at timestamptz,                -- czas skanu na urządzeniu
  UNIQUE (checkpoint_id, person_id, direction, scanned_at)
)
```

Sześć decyzji projektowych, które warto zapisać teraz:

1. **Skaner to PWA, nie aplikacja natywna.** Kamera przez `getUserMedia` +
   `BarcodeDetector` (z fallbackiem na bibliotekę JS) działa na dowolnym telefonie
   wolontariusza. Zero App Store, zero pudełka ze sprzętem, zero kosztu urządzeń.
2. **Kolejka offline jest wymogiem, nie opcją.** Sala kongresowa to miejsce bez
   zasięgu. Skan zapisuje się lokalnie (IndexedDB) ze znacznikiem
   `offline_queued_at` i synchronizuje przy powrocie sieci; serwer rozstrzyga
   duplikaty i przekroczenie pojemności. Bez tego bramka staje się kolejką.
3. **Poświadczenie należy do urządzenia, nie do osoby** — dokładnie jak
   u Swapcarda („can be used to log in on multiple devices"). Wolontariusz nie
   dostaje konta w platformie, tylko kod na jedno wydarzenie z terminem ważności.
   To rozstrzyga pytanie otwarte §10.1 dokumentu nadrzędnego.
4. **Dwa tryby punktu: mierzę albo wpuszczam.** `track` zapisuje przejście
   i nigdy nie blokuje (frekwencja sesji). `control` sprawdza grupę, typ biletu
   i pojemność, i **odmawia** z konkretnym powodem (`result`), żeby obsługa
   wiedziała, co powiedzieć człowiekowi w kolejce.
5. **Self check-in to ta sama PWA w trybie kiosku** (tablet na stojaku,
   wyszukiwanie po nazwisku/e-mailu lub skan kodu z e-maila) + druk badge'a
   z szablonu (§15.3) na drukarkę etykiet przez zwykły dialog druku. Nie
   potrzebujemy „pudełka" — potrzebujemy poprawnego PDF-a w rozmiarze nośnika.
6. **QR na badge'u nie może być identyfikatorem osoby.** Kod biletu z
   `ticketCode.ts` jest losowy i nieodwracalny — skan wymaga zapytania do serwera,
   więc zgubiony badge nie ujawnia niczego o właścicielu. Tę właściwość mamy
   już dziś i trzeba jej **nie zepsuć** przy wystawianiu QR na wydruk.

---

## Partia 16 — 2026-08-23 (Analytics: dashboard i raporty)

### Zrzut 16.1 — `…/analytics` · „Dashboard"

**Co widać**

- „Insightful metrics and analytics to better understand your audience and measure
  your ROI." + `Learn how`.
- Baner: „**You are seeing dummy data on this dashboard.**" + `Show my event data`.
- Sekcja **`In-App registration`** — cztery kafle: `48,820 Registered` ·
  `28,501 Checked-in` · `350 Canceled*` · `15 Abandoned` (`Add-on`).
- Sekcja **`Paid tickets*`** — cztery kafle: `349 Paid tickets sold` ·
  `$4,890.00 Total revenue` · `$522.00 Total refunds` · `$350.00 Total balance due`.
- Nota: „\*Group filtering is not considered for the these metrics."
- **`Registration over time`** — przełącznik `Confirmed registrations` /
  `All registrations`, wykres liniowy z tooltipem (`Jun 22 — Registration over
time: 10000`), oś Y `0 … 34,000`, oś X `Jun 14 … Jun 30`.

**Mapowanie**

| Swapcard                                                   | NES                                                            | Stan                         | Zadanie |
| ---------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- | ------- |
| kafle rejestracji (zapisani, obecni, anulowani, porzuceni) | `event_registrations` + `event_scans` (§15.6)                  | 🔴                           | EB-1401 |
| kafle sprzedaży (sztuki, przychód, zwroty, saldo)          | `payment_orders`, `/admin/billing`, `/admin/monetization`      | ✅ dane, 🔴 widok wydarzenia | EB-1402 |
| wykres rejestracji w czasie                                | wzorzec: `/admin/analytics`, wykresy w repo (`src/lib/charts`) | 🟡                           | EB-1403 |
| `dummy data` w pustym dashboardzie                         | **antywzorzec** (patrz Wnioski)                                | —                            | —       |
| „filtrowanie po grupie nie dotyczy tych metryk"            | j.w.                                                           | —                            | —       |

**Wnioski**

1. **Dane demonstracyjne w panelu produkcyjnym to antywzorzec.** Administrator
   widzi 48 820 rejestracji przy wydarzeniu, które ma 21 osób — i musi kliknąć
   „Show my event data", żeby zobaczyć prawdę. Nasza wersja pokazuje **pusty stan
   z instrukcją** („brak rejestracji — otwórz sprzedaż biletów"), nigdy liczby
   z palca. To nie jest drobiazg estetyczny: liczba w dashboardzie bywa
   przepisywana do raportu dla zarządu.
2. Gwiazdka „filtrowanie po grupie nie dotyczy tych metryk" ujawnia rozjazd:
   część kafli respektuje filtr, część nie. U nas reguła jest odwrotna —
   **filtr obowiązuje wszędzie albo nigdzie**; jeśli metryki nie da się
   przefiltrować, nie stoi obok tych, które da się.
3. `Total balance due` (saldo do zapłaty) sugeruje sprzedaż z odroczoną płatnością
   (faktura dla instytucji). To realny scenariusz NES — kongres opłacany przez
   uczelnię czy ministerstwo — i wchodzi do modelu biletów jako
   `payment_terms ('immediate','invoice')`.

### Zrzuty 16.2 i 16.3 — `…/reports` · „Reports"

**Co widać**

- „Access comprehensive reports that provide valuable insights into every aspect of
  your event." + `Upgrade plan` (wszystkie pozycje wyszarzone — plan nie obejmuje).
- Sekcja bez nazwy: **General metrics** („Networking summary for attendees and
  exhibitors, active users and platform usage information") · **Transactions**
  („List of all credit card transactions, including customer and payment details,
  status, and verification information").
- **`SESSIONS`**: **Session registrations, attendance, and feedback** („List of people
  registered for sessions, with **scan in and out dates**, their ratings, and comments") ·
  **Live session interaction messages and questions** · **Poll answers** („List of
  people who answered polls during sessions with their results") ·
  **Video streaming** („…who watched the session's streaming video, with dates and
  durations") · **Roundtables** („…who joined the roundtables, with dates").
- **`EXHIBITORS & ITEMS`**: **Exhibitors' pages, ads, docs, and items views and
  bookmarks** · **Item views and bookmarks**.
- **`SPONSORS & ADS`**: **Ads clicks and views** („…who have seen or clicked on the
  event home advertising or the advanced banner ads views") · **Event home sponsors**
  („List of people who clicked on the event home sponsors").

**Mapowanie**

| Swapcard                                         | NES                                                                                    | Stan | Zadanie |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- | ---- | ------- |
| raport zapisów, frekwencji i ocen sesji          | `event_session_registrations` + `event_scans` + `event_session_feedback` (§4.2, §15.6) | 🔴   | EB-1404 |
| raport wiadomości i pytań z interakcji           | `qa_questions`, `club_thread_questions`, `messages`                                    | 🟡   | EB-1405 |
| raport odpowiedzi w ankietach                    | `club_thread_polls` + odpowiedzi                                                       | 🟡   | EB-1405 |
| raport oglądalności wideo (czas trwania)         | brak pomiaru czasu odtwarzania                                                         | 🔴   | EB-1406 |
| raport transakcji                                | `payment_orders`, `payment_webhook_events`, `/admin/billing-reconcile`                 | ✅   | —       |
| raporty odsłon/kliknięć reklam i sponsorów       | `ad_events` (odsłony i kliki)                                                          | ✅   | EB-1407 |
| raporty „kto co obejrzał i zapisał w zakładkach" | `profile_view_events`, `analytics_events`, zakładki                                    | 🟡   | EB-1407 |

**Wnioski**

1. Lista raportów to **najlepsza specyfikacja pomiaru**, jaką dostaliśmy: mówi
   dokładnie, co trzeba logować, żeby po wydarzeniu odpowiedzieć na pytania
   partnerów i prelegentów. Trzy z nich mamy „darmo" (`ad_events`,
   `payment_orders`, `analytics_events`), trzy wymagają nowych zdarzeń
   (skany, oglądalność wideo, odpowiedzi w ankietach sesji).
2. Wszystkie raporty to **listy osób z kontekstem**, nie zagregowane wykresy —
   czyli w praktyce **eksporty CSV z filtrem**. To dobra wiadomość: NES ma
   eksporty i filtry; brakuje zapytań i ekranu z listą raportów.
3. Kluczowe zastrzeżenie RODO: raport „kto obejrzał profil / stoisko / reklamę"
   jest **profilowaniem uczestnika**. Przy wydarzeniach z Chatham House takie
   raporty muszą być wyłączone, a nie tylko ukryte w UI — bramka na poziomie RPC.
   To wchodzi do `event_capabilities()` jako osobna zdolność `can_view_reports`.

---

## Partia 17 — (oczekuje na zrzuty)

Domknięte: **cały panel Swapcarda poza czterema ekranami**: `Event builder`,
`In-App registration`, `Content`, `Exhibitor Marketplace`, `Meetings`,
`Communications`, `Onsite`, `Analytics`.

Brakuje:

1. **`Overview`** (pulpit wydarzenia) — jedyny nietknięty ekran główny.
2. **`Integrations`** i **`Add-on features`**.
3. **`Groups & permissions → Manage visibility`** + rozwinięty **`Add condition`**.
4. **`Session settings`** i **`Manage roles`** (słowniki z 6.2 i 7.1).

---

## Stan wdrożenia — 2026-08-26

Iteracja, w której wydarzenie dostało **własną powierzchnię** — studio. Ta
sekcja **nie przepisuje** partii 1–16; one zostają zapisem tego, co widać na
zrzutach. Tutaj jest odpowiedź na inne pytanie: **co z tego już stoi w repo,
pod jaką ścieżką i czego w tym jeszcze nie ma.** Wcześniejsze iteracje
(katalog rodzajów, kolumny przepływu, panele agendy, zapisów, spotkań, odprawy,
sponsorów i regulaminów) są tu wymienione tylko tam, gdzie studio je montuje.

Stany w tabeli opisują **NES**, nie wzorzec: ✅ jest · 🟡 częściowo · 🔴 brak.
Identyfikatory `EB-nnn` są te same, co w §2 dokumentu nadrzędnego.

Migracja tej iteracji: `supabase/migrations/20260826090000_event_studio_general.sql`
(kolumny `events` + RPC `admin_event_detail`, `admin_event_general_save`,
`admin_event_set_status`, `admin_event_branding_save`).

### Rama studia — powierzchnia, której wcześniej nie było

| Element wzorca                                                                | Co powstało                                                                                                                                                                                                        | Gdzie w kodzie                                                                                                 | Stan | Co zostaje                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| osobna powierzchnia jednego wydarzenia (`studio.swapcard.com/event/<slug>/…`) | trasy `/admin/events/<id>/<sekcja>`, piętnaście sekcji, `index` przekierowuje na „Informacje ogólne"                                                                                                               | `src/routes/admin.events_.$eventId.tsx`, `…$eventId.index.tsx` + 15 plików sekcji                              | ✅   | —                                                                       |
| lewy sidebar należący do wydarzenia, nie do panelu                            | własny pas nawigacji; podkreślnik w `events_` **wypina studio z układu** `/admin/events`, więc nie ma dwóch pasków sekcji naraz                                                                                    | `src/components/admin/events/studio/EventStudioSidebar.tsx`, model danych w `src/lib/events/eventStudioNav.ts` | ✅   | pozycje nie pokazują liczników ani stanu „niedokończone"                |
| „Search within the event…" nad sidebarem                                      | wyszukiwarka filtrująca pozycje po etykiecie **i po słowach kluczowych** (`bilety` → Zapisy, `QR` → Na miejscu)                                                                                                    | `eventStudioNav.ts` (`matchesStudioQuery`, `keywordKeys`), `EventStudioSidebar.tsx`                            | ✅   | nie szuka w treści wydarzenia (sesje, uczestnicy), tylko w mapie sekcji |
| `Open event`                                                                  | odnośnik do strony publicznej; dla szkicu **nie ma odnośnika**, tylko zdanie — szkic nie ma strony, na którą można wejść                                                                                           | `EventStudioSidebar.tsx`                                                                                       | ✅   | —                                                                       |
| górny pasek: `Preview event` · `Publish event` · stan planu                   | pasek z nazwą wydarzenia, chipem statusu (przełącznik szkic / opublikowane / odwołane), przełącznikiem podglądu i przyciskiem publikacji                                                                           | `src/components/admin/events/studio/EventStudioTopBar.tsx`, RPC `admin_event_set_status`                       | ✅   | brak odpowiednika „planu" — u nas nie ma warstw cennikowych wydarzenia  |
| makieta podglądu po prawej + wskaźnik `1 / 4`                                 | dok podglądu przypięty do ramy studia, rysujący stronę wydarzenia z **niezapisanego** szkicu; zamiast paginacji `1/4` — przełącznik desktop/mobile i skalowanie `transform: scale` z **mierzonej** szerokości doku | `EventStudioPreview.tsx`, `EventPreviewCanvas.tsx`, `EventStudioPreviewContext.tsx`                            | ✅   | kanwa nie renderuje widgetów buildera — patrz „Dług" niżej              |
| pulpit wydarzenia (`Overview`, Partia 17 pkt 1 — bez zrzutu)                  | kafle z **żywych** RPC (zapisy, wolne miejsca, sesje, grupy, sponsorzy) + lista kroków liczona ze stanu danych                                                                                                     | `src/components/admin/events/organisms/EventOverviewPanel.tsx`                                                 | 🟡   | brak wykresu zapisów w czasie i brak listy ostatnich zdarzeń            |

Dwie decyzje projektowe z tej ramy, które warto mieć zapisane, bo wrócą przy
każdym kolejnym ekranie:

1. **Podgląd rysujemy, nie osadzamy `<iframe>` strony publicznej.** Ramka
   z adresem publicznym pokazuje stan **zapisany** i odświeża się dopiero po
   zapisie — czyli odpowiada na pytanie, którego nikt nie zadaje. Pytanie brzmi
   „jak będzie wyglądać to, co właśnie zmieniam", a odpowiedzieć na nie może
   wyłącznie rysunek z **tego samego szkicu**, który karmi formularz. Kanał:
   `EventStudioPreviewContext` (rama wystawia gniazdo, ekran je wypełnia — ten
   sam wzorzec, co `AdminSidebarExtras`).
2. **Kanwa podglądu nie jest drugim rendererem strony.** Rysuje szkic układu
   (pasek nawigacji, nagłówek z okładką, kafle podstron, blok informacji,
   stopka) i **nie wchodzi w widgety buildera** — inaczej powstałby drugi silnik
   stron, czyli ryzyko nr 1 z §9 dokumentu nadrzędnego.

### Partia 1 — `Pages & menu`, `General information`, `Groups & permissions`

| Zrzut / element wzorca                                         | Co powstało                                                                                                                                                               | Gdzie w kodzie                                                                                                                                                                        | Stan                 | Co zostaje                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 `Home page design: Advanced / Standard` + `Customize page` | dwie karty wyboru z opisem; `Advanced` prowadzi do edytora strony-korzenia wydarzenia                                                                                     | `EventPagesMenuPanel.tsx`, `events.home_design`                                                                                                                                       | ✅ zapis             | `Standard` zapisuje wybór, ale **nie zakłada** presetu startowego (`starterTemplates.ts`) — EB-202 otwarte                      |
| 1.1 `Display mode: Grid / List`                                | dwie karty wyboru; przełączenie natychmiast zmienia układ kafli w podglądzie, przed zapisem                                                                               | `EventPagesMenuPanel.tsx`, `EventPreviewCanvas.tsx`, `events.pages_display_mode`                                                                                                      | 🟡                   | **front publiczny nie czyta tej kolumny** — widgetu `event-menu` nie ma; dziś tryb widać wyłącznie w podglądzie studia (EB-203) |
| 1.1 `Pages` → `Menu pages` / `Other pages`                     | dwie zakładki z licznikami nad listą podstron; lista czytana z poddrzewa `pages` (`parent_id = events.root_page_id`)                                                      | `src/lib/events/eventPagesApi.ts` (`fetchEventPages`, `splitEventPages`), `EventPagesMenuPanel.tsx`                                                                                   | 🟡                   | `event_pages` nie istnieje — podział liczy się tymczasowo z `pages.menu_order` (EB-204)                                         |
| 1.1 kolorowa ikona pozycji, kolejność, widoczność              | —                                                                                                                                                                         | —                                                                                                                                                                                     | 🔴                   | wymaga `event_pages` (`icon`, `color`, `sort_order`, `visible_to_groups`) — EB-206                                              |
| 1.1 `Create page` / `Create menu group`                        | przycisk „Utwórz stronę" prowadzący do `/admin/pages/new`                                                                                                                 | `EventPagesMenuPanel.tsx`                                                                                                                                                             | 🟡                   | strona nie powstaje z gotowym `parent_id = events.root_page_id`; grup menu nie ma (EB-204, EB-205)                              |
| 1.2 `Event name` z flagą języka                                | jedno pole + przełącznik PL/EN nad nim (nie dwa pola obok siebie — wniosek 2 ze zrzutu 1.2)                                                                               | `EventGeneralPanel.tsx` (`LangToggle`)                                                                                                                                                | ✅                   | —                                                                                                                               |
| 1.2 `Event URL` + ołówek                                       | adres publiczny **pod kłódką**: pole zamknięte do świadomego kliknięcia ołówka, bo zmiana slugu opublikowanego wydarzenia psuje linki w wysłanych e-mailach               | `EventGeneralPanel.tsx`, RPC sprawdza `^[a-z0-9-]{3,120}$` i unikalność w tenancie (`slug_taken`)                                                                                     | ✅                   | brak przekierowania ze starego slugu po zmianie                                                                                 |
| 1.2 `Begins` / `Ends` / `Time zone`                            | trzy pola z listą stref (`Intl.supportedValuesOf`, z listą zapasową); `ends_at > starts_at` sprawdzane **i w szkicu, i w RPC**                                            | `EventGeneralPanel.tsx`, `eventGeneralDraft.ts`, migracja (`invalid_ends_at`)                                                                                                         | ✅                   | —                                                                                                                               |
| 1.2 `Cover` → `Event image` + `Crop`                           | wybór okładki istniejącym `CoverImagePicker`                                                                                                                              | `EventGeneralPanel.tsx`                                                                                                                                                               | ✅                   | kadrowanie zostaje w `/admin/crop-sizes` — nie dublujemy narzędzia (EB-102)                                                     |
| 1.2 `Video header` (platforma + `Video ID`)                    | wybór YouTube/Vimeo + pole identyfikatora przyjmujące **także cały adres z paska przeglądarki**                                                                           | `eventGeneralDraft.ts` (`parseVideoId`, `videoEmbedUrl`), kolumny `video_header_platform` / `video_header_id`                                                                         | 🟡                   | zapisane, ale **strona publiczna jeszcze go nie odtwarza** (EB-103)                                                             |
| 1.2 nota „obraz nadal potrzebny do miniatur"                   | reguła w **trzech** miejscach: warunek bazy `events_video_header_requires_cover`, sprawdzenie w RPC (`cover_required`) i w szkicu formularza                              | migracja `20260826090000`, `eventGeneralDraft.ts`                                                                                                                                     | ✅                   | —                                                                                                                               |
| 1.2 „An event cannot exceed 90 days."                          | **nie skopiowane** — patrz „Czego świadomie nie skopiowaliśmy"                                                                                                            | `eventGeneralDraft.ts` (`eventGeneralWarnings`)                                                                                                                                       | ✅ świadomie inaczej | —                                                                                                                               |
| 1.3 `Format: Hybrid / In-person / Virtual`                     | trzy karty wyboru w kolejności wzorca; kolumna `events.format` (`onsite`/`online`/`hybrid`) istnieje od `20260823120000_event_builder_foundation.sql`                     | `EventGeneralPanel.tsx`, `src/lib/events/eventTypes.ts`                                                                                                                               | ✅                   | prezentacja dat w strefie uczestnika dla formatu online — nadal nie zależy od formatu (EB-105)                                  |
| 1.3 `Location` + adres strukturalny + `Reset location`         | nazwa miejsca (`location`) plus pięć pól adresu i przycisk „Wyczyść lokalizację" czyszczący **cały** zestaw naraz                                                         | `EventGeneralPanel.tsx`, `eventGeneralDraft.ts` (`EVENT_LOCATION_FIELDS`, `clearEventLocation`, `eventAddressLine`), kolumny `street_address`/`city`/`region`/`postal_code`/`country` | 🟡                   | zapisane, ale `schema.org/Event` z `location.address`, mapa dojazdu i `AddToCalendar` **jeszcze tego nie czytają** (EB-106)     |
| 1.3 brak adresu przy formacie stacjonarnym                     | miękkie **ostrzeżenie**, nie blokada zapisu — organizator nierzadko zna termin przed miejscem                                                                             | `eventGeneralDraft.ts` (`adminEvents.general.warnings.addressMissing`)                                                                                                                | ✅                   | walidacja kodu pocztowego per kraj — nie ma                                                                                     |
| 1.3 `Information` (RTE)                                        | pole tekstowe PL/EN z tym samym przełącznikiem języka, co nazwa                                                                                                           | `EventGeneralPanel.tsx` (`Textarea` na `description_pl`/`description_en`)                                                                                                             | ✅ świadomie inaczej | trzeciego edytora RTE nie dorabiamy — patrz niżej (§1.3 wniosek 4)                                                              |
| 1.4 `X (ex-Twitter) hashtag`                                   | pole z krzyżykiem jako prefiksem; w bazie hashtag **bez** `#` (znak jest prezentacją), wzorzec `^[A-Za-z0-9_]{1,60}$` w RPC i w szkicu                                    | `EventGeneralPanel.tsx`, `eventGeneralDraft.ts`, `events.social_hashtag`                                                                                                              | 🟡                   | stopka e-maila i karta społecznościowa jeszcze go nie używają (EB-108)                                                          |
| 1.4 `Languages` (checklista)                                   | checklista z katalogu 30 kodów ISO 639-1; **nazwy języków bierze `Intl.DisplayNames`**, a nie słownik i18n — kod języka jest daną, nie tekstem interfejsu                 | `src/lib/events/eventLanguages.ts`, `EventGeneralPanel.tsx`, `events.languages`                                                                                                       | ✅                   | opis w UI musi mówić wprost, że to języki **treści**, a nie interfejsu (EB-109)                                                 |
| 1.4 `Support email`                                            | pole z walidacją adresu w szkicu i w RPC (`invalid_support_email`)                                                                                                        | `EventGeneralPanel.tsx`, `events.support_email`                                                                                                                                       | 🟡                   | zapisane; strona publiczna i stopka e-maila jeszcze go nie pokazują (EB-110)                                                    |
| 1.4 `Event ID` + kopiowanie                                    | `events.id` w stopce ekranu z przyciskiem kopiowania i potwierdzeniem                                                                                                     | `EventGeneralPanel.tsx`                                                                                                                                                               | ✅                   | — (EB-111 zamknięte)                                                                                                            |
| 1.5 `Groups` z licznikami + `Add a group` + ołówek edycji      | istniejący `EventGroupsPanel` wmontowany w ekran studia — nie druga lista grup; edycja grupy otwiera **szufladę z prawej krawędzi**, z zakładkami „Ogólne" i „Członkowie" | `EventGroupsPermissionsPanel.tsx`, `EventGroupsPanel.tsx`, `molecules/EventGroupDialog.tsx`                                                                                           | 🟡                   | reguły per grupa (`event_capabilities()`) nadal do zrobienia (EB-302)                                                           |
| 1.5 `Guest mode` (przełącznik)                                 | przełącznik „widoczne publicznie" + wybór, **co** widzi niezapisany (`teaser` / `full`); `hidden` = wyłączone                                                             | `EventGroupsPermissionsPanel.tsx`, `events.guest_mode` (enum tekstowy)                                                                                                                | ✅                   | —                                                                                                                               |
| 1.5 kolizja Guest mode ↔ Chatham House                         | ostrzeżenie na ekranie przy `chatham_house = true`                                                                                                                        | `EventGroupsPermissionsPanel.tsx`                                                                                                                                                     | 🟡                   | ostrzeżenie **informuje**; twardej bramki w `event_capabilities()` (i testu pgtap) nadal nie ma                                 |
| 1.5 `Guests visibility` → `Manage visibility`                  | —                                                                                                                                                                         | —                                                                                                                                                                                     | 🔴                   | macierz widoczności per sekcja (§7 dokumentu nadrzędnego) — EB-306                                                              |

### Partia 2 — `Branding` (zrzut 2.5)

| Element wzorca                                                                    | Co powstało                                                                                                                              | Gdzie w kodzie                                                                                                    | Stan | Co zostaje                                                                                                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Appearance: Light / Dark`                                                        | dwie karty wyboru z miniaturą wizytówki uczestnika                                                                                       | `EventBrandingPanel.tsx`, `eventBrandingDraft.ts`                                                                 | ✅   | u wzorca `Dark` ma plakietkę `Beta`; u nas motyw dwutrybowy jest rdzeniem platformy, więc plakietki nie kopiujemy                        |
| `Navigation` / `Main actions` / `Text` / `Content blocks background` + tło strony | **pięć** slotów kolorów: `navigation`, `main_action`, `text`, `blocks_background`, `page_background`; wpis szesnastkowy plus próbnik     | `eventBrandingDraft.ts` (`EVENT_BRANDING_COLOR_SLOTS`), `EventBrandingPanel.tsx`                                  | ✅   | zakres celowo wąski — nie oddajemy per wydarzenie całego `GlobalColorsEditor` (wniosek 1 ze zrzutu 2.5)                                  |
| obraz tła „na wszystkich stronach, łącznie z formularzem rejestracji"             | pole adresu obrazu, wyłącznie `https`                                                                                                    | `EventBrandingPanel.tsx`, `admin_event_branding_save`                                                             | 🟡   | branding **nie jest jeszcze wstrzykiwany w SSR** poddrzewa stron wydarzenia ani w formularz zapisu — działa w podglądzie studia (EB-402) |
| **`Reset to community branding`**                                                 | przycisk **czyści klucze**, a nie zapisuje dzisiejszych kolorów motywu — inaczej wydarzenie przestałoby reagować na zmianę marki serwisu | `EventBrandingPanel.tsx`, `eventBrandingPayload` (slot pusty nie wchodzi do obiektu), `admin_event_branding_save` | ✅   | — (EB-403 zamknięte po stronie zapisu)                                                                                                   |
| `Discard changes` / `Save` (nieaktywny bez zmian)                                 | wspólny przyklejony pasek zapisu, **widoczny dopiero przy realnej zmianie**                                                              | `EventStudioSection.tsx` (`EventStudioSaveBar`)                                                                   | ✅   | —                                                                                                                                        |
| podgląd na żywo obok formularza                                                   | dok podglądu wspólny dla całego studia; każda zmiana koloru trafia tam przed zapisem                                                     | `EventStudioPreview.tsx`, `EventPreviewCanvas.tsx` (funkcja `palette` — slot pusty = wartość z motywu)            | ✅   | — (EB-404 zamknięte)                                                                                                                     |
| fonty wydarzenia                                                                  | —                                                                                                                                        | —                                                                                                                 | 🔴   | EB-405; fonty zostają globalne (`CustomFontUploader`)                                                                                    |

Zabezpieczenie, którego wzorzec nie pokazuje, a które musiało powstać:
`events.branding` jest kolumną `jsonb`, więc bez **białej listy kluczy** ktokolwiek
z rolą redaktora mógłby wstrzyknąć dowolną wartość do tokenów CSS renderowanych
w SSR. `admin_event_branding_save` przyjmuje wyłącznie znane klucze, kolory w
`#RRGGBB` i obrazy pod adresem `https`.

### Sekcje montujące istniejące panele

Rejestracja, treść/agenda, spotkania, na miejscu, sponsorzy i regulaminy dostały
w studiu ekrany, które montują **istniejące** panele modułu
(`src/components/admin/events/studio/EventStudioModuleSections.tsx`).
Panele od początku przyjmowały `eventId` — brakowało im miejsca, w którym
wydarzenie jest już **wybrane**. W studiu wybór zrobił sidebar, więc znika
droplista wyboru wydarzenia: pytanie o coś, co już wiadomo, jest zarazem drugim,
rozjeżdżającym się źródłem prawdy o tym, co jest edytowane.

Stare trasy modułu (`/admin/events/agenda`, `…/registrations`, `…/meetings`,
`…/onsite`, `…/sponsors`, `…/terms`) **zostają nietknięte** ze swoimi droplistami.
Studio jest **drugą drogą** do tych samych paneli, a nie ich zamiennikiem — kto
pracuje na kilku wydarzeniach naraz, nie musi przez nie przechodzić.

Cztery sekcje bez własnego zakresu per wydarzenie (`Komunikacja`, `Integracje`,
`Analityka`, `Funkcje dodatkowe`) stoją w sidebarze, ale ich ekrany są
**drogowskazami**: mówią wprost, gdzie ta praca dziś mieszka, i prowadzą do
modułu globalnego (`src/components/admin/events/studio/EventStudioExternalSection.tsx`).
Pusta pozycja w sidebarze jest gorsza niż suchy ekran, a kopia modułu globalnego
per wydarzenie oznaczałaby dwa miejsca do utrzymania i dwa źródła prawdy o tym
samym kluczu API.

### Wejścia do studia

„Utwórz wydarzenie" prowadzi po zapisie prosto do studia
(`src/routes/admin.events.new.tsx` → `/admin/events/$eventId/general`;
`admin_event_create` oddaje identyfikator nowego wiersza, więc nie ma
dodatkowego zapytania o listę). Edycja z listy wydarzeń prowadzi do studia
zamiast do starego dialogu w `/admin/community/events`
(`src/components/admin/events/organisms/EventsListManager.tsx`) — tamten adres
dawał **wynik wyszukiwania po slugu**, a nie wydarzenie: jeden formularz z
częścią pól i zero dojścia do stron, brandingu czy zapisów.

### Czego świadomie NIE skopiowaliśmy

**Limit „An event cannot exceed 90 days" (zrzut 1.2).** To ograniczenie
**cennikowe** wzorca, a nie merytoryczne — nic w danych nie psuje się przy
wydarzeniu dłuższym niż kwartał. Zamiast blokady jest miękkie ostrzeżenie przy
wydarzeniu dłuższym niż 30 dni (`eventGeneralWarnings`): literówka w roku daty
końca kosztuje przypomnienia wysłane do wszystkich zapisanych, a kongres
trwający miesiąc jest dziwny, ale możliwy. Ostrzeżenie mówi o tym redaktorowi,
zamiast decydować za niego.

**Exhibitor Marketplace i dodatki płatne (partie 2, 8, 9, 11, 13, 15).** Decyzja
zamawiającego §0.4: wystawcy **nie są osobnym modułem**, partnerzy i sponsorzy
są synchronizowani z CRM firm. Sidebar studia nie ma pozycji „Exhibitor
Marketplace", a odpowiednik `Add-on features` to u nas „Funkcje" — przełączniki
modułów wydarzenia (`events.features`), a nie sklep, w którym organizator
sprzedaje wystawcom dostęp do skanera leadów. Konsekwencja praktyczna: wszystko,
co we wzorcu jest oznaczone `Add-on`, jest u nas albo w zakresie podstawowym
(skanowanie na miejscu — E7), albo poza zakresem.

**Dane demonstracyjne na pulpicie (partia 16, zrzut 16.1).** Wzorzec pokazuje
48 820 rejestracji przy wydarzeniu, które w tych samych danych ma dwadzieścia
jeden osób. To jest najgorsza rzecz, jaką może zrobić pulpit, bo uczy nie ufać
**żadnej** liczbie na ekranie — także tej prawdziwej. `EventOverviewPanel` czyta
wyłącznie żywe RPC, a kafel bez danych pokazuje kreskę, nie zero z palca:
„nie wiem" i „zero" to różne odpowiedzi. Z tego samego powodu lista kroków liczy
się ze **stanu danych** („dodaj okładkę" znika, gdy okładka jest), a nie
z checklisty do odklikania — checklista, którą da się odhaczyć bez zrobienia
rzeczy, jest gorsza niż jej brak.

**`Information` jako trzeci edytor RTE (§1.3 wniosek 4).** NES ma już dwa
edytory treści bogatej: builder stron i `PostBlockEditor` widgetu `rich-text`.
Trzeci — wpięty w jedno pole formularza ustawień — byłby trzecim zestawem reguł
sanityzacji, trzecim rendererem i trzecim miejscem, w którym psuje się osadzone
wideo. `description_pl`/`description_en` zostają **tekstem** (zapowiedź, karta
katalogu, opis w e-mailu), a bogata treść idzie na stronę wydarzenia w builderze.

### Dług nazwany wprost

1. **`event_pages` nadal nie istnieje.** Podział „strony w menu / pozostałe"
   liczy się tymczasowo z `pages.menu_order` (zero = poza menu) —
   `splitEventPages` w `src/lib/events/eventPagesApi.ts`. Brak ikon, kolorów,
   kolejności i widoczności per grupa dla pozycji menu; brak `menu_label_pl/en`
   niezależnej od tytułu strony. Docelowo rozstrzyga `event_pages.in_menu`
   (§4.7 dokumentu nadrzędnego).
2. **Nowe kolumny są zapisywane, ale front publiczny ich jeszcze nie czyta.**
   `street_address`/`city`/`region`/`postal_code`/`country`, `video_header_*`,
   `social_hashtag`, `support_email`, `languages`, `home_design`,
   `pages_display_mode` widać dziś wyłącznie w podglądzie studia. Dopóki nie ma
   widgetu `event-menu` i dopóki `schema.org/Event` oraz `AddToCalendar` nie
   biorą adresu strukturalnego, ekran „Informacje ogólne" obiecuje więcej, niż
   pokazuje uczestnikowi.
3. **Sekcje Komunikacja / Integracje / Analityka / Funkcje dodatkowe** odsyłają
   do modułów globalnych — nie mają jeszcze zakresu per wydarzenie. Kolumna
   `events.features` istnieje od tej migracji, ekranu przełączników nie ma.
4. **Szuflada edycji grupy ze wzorca ma cztery zakładki** (`General`,
   `Exhibitor profile`, `Lead generation`, `Members` — zrzuty 2.1–2.4). Dwie
   środkowe dotyczą **wystawców**, czyli zakresu wyłączonego decyzją §0.4, więc
   nasza (`src/components/admin/events/molecules/EventGroupDialog.tsx`) ma dwie:
   „Ogólne" i „Członkowie". Nie jest to brak do nadrobienia, tylko różnica
   zakresu — ale musi być zapisana, żeby przy następnym porównaniu ze zrzutami
   nie wyglądała na niedoróbkę. Atrapa zakładki bez źródła danych obiecywałaby
   redaktorowi ekran, którego nie ma.
5. **Podgląd na żywo rysuje szkic układu, a nie kompozycję buildera.** Dla
   `home_design = advanced` — czyli dla strony złożonej w builderze — pokazuje
   uproszczenie: prawdziwy układ sekcji i widgetów zobaczy się dopiero w
   podglądzie strony. To jest cena rezygnacji z drugiego renderera i wybór
   świadomy, nie przeoczenie.
6. **Ostrzeżenie o kolizji Chatham House z trybem gościa jest informacyjne.**
   Twarda bramka (`event_capabilities()` + test pgtap) nadal do zrobienia —
   dziś regułę egzekwują polityki istniejące wcześniej, a nie jedna funkcja
   prawdy.
