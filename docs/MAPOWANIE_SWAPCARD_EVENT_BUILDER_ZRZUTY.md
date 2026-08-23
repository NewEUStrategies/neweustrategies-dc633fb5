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
  | Sesja | Godziny | Speakers | Exhibitors | Attendees |
  | --- | --- | --- | --- | --- |
  | Uroczyste otwarcie konferencji… | 9:00–9:05 | 1 | 1 | – |
  | Aktywność Polski w organizacjach… | 9:05–10:00 | 4 | 2 | 1 |
  | Bezpieczeństwo Europy – NATO czy budowa… | 10:00–11:45 | 4 | 1 | – |
  | Innowacyjna bankowość, a gdzie przedsiębiorcy? | 12:00–13:45 | 4 | 1 | 1 |
  | Przyszłość reguł fiskalnych w Unii… | 14:00–15:45 | 4 | 1 | 1 |
  | Mobilność wojskowa państw na wschodniej… | 16:00–17:45 | 4 | 3 | – |

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

## Partia 11 — (oczekuje na zrzuty)

Domknięte: cały `Event builder`, cała `In-App registration`, cały `Content`
(People, Sessions, Exhibitors, Items, Documents & Links, Feed channels, Discussions).

Brakuje wyłącznie modułów operacyjnych i przekrojowych:

1. **`Onsite`** — check-in, skaner, szablony badge'y, druk (moduł wymagany, §0.4).
2. **`Meetings`** — sloty, limity, matchmaking.
3. **`Communications`** — sekwencje e-mail, powiadomienia push.
4. **`Groups & permissions → Manage visibility`** + rozwinięty **`Add condition`**.
5. **`Session settings`** i **`Manage roles`** (słowniki z 6.2 i 7.1).
6. **`Analytics`** · **`Overview`** · **`Integrations`** · **`Add-on features`**.
