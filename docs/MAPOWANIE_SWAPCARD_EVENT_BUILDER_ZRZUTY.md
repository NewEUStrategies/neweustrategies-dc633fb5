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

## Partia 2 — (oczekuje na zrzuty)

Kolejność, która najbardziej przyda się do domknięcia specyfikacji:

1. **`Content`** — jak Swapcard modeluje sesje/agendę (pola sesji, ścieżki, sale,
   przypisanie prelegentów). To odblokowuje decyzję o `event_sessions` (§0.2/§4.2).
2. **`In-App registration`** — formularz, pytania, akceptacje, typy wejściówek.
3. **`Groups & permissions` → `Manage visibility`** — pełna macierz widoczności.
4. **`Onsite`** — check-in, badge'e, lead retrieval.
5. **`Exhibitor Marketplace`** — pakiety, stoiska, self-service wystawcy.
6. **`Meetings`** — konfiguracja slotów, limity, matchmaking.
7. **`Communications`** — sekwencje e-mail i powiadomienia.
8. **`Analytics`** + **`Add-on features`** + **`Overview`** + **`Branding`** + **`Terms`**.
