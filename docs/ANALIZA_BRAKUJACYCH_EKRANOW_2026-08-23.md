# Brakujące ekrany Event Buildera — analiza na dowodach

Data: 2026-08-23 · Status: **kompletny** — część A: baza dowodowa (§1), część B: rzeczywiste źródła danych (§2–§8), kontrakt (§9), backlog zrzutów (§10), błędy zastane (§11)
Dokumenty powiązane:

- `INWENTARZ_ELEMENTOW_UI_SWAPCARD_2026-08-23.md` — inwentarz elementów z ~70 zrzutów
- `MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md` — dziennik 16 partii zrzutów
- `PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` — specyfikacja i model danych

## 0. Zasada tego dokumentu: zero danych zmyślonych

Tych ekranów **nie widziałem na zrzutach**. Dlatego nie opisuję, „co na nich jest" —
opisuję wyłącznie to, co da się udowodnić, i wprost oznaczam, czego nie wiemy.
Trzy poziomy pewności, konsekwentnie w całym dokumencie:

| Znacznik | Znaczenie                                                                   | Weryfikowalność                          |
| -------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| **[D]**  | **dowód ze zrzutu** — dosłowny cytat kontrolki, która odsyła do tego ekranu | numer zrzutu w dzienniku                 |
| **[R]**  | **fakt z repo** — istniejąca tabela, kolumna, RPC, trasa, komponent         | ścieżka pliku + dokładna nazwa           |
| **[P]**  | **propozycja NES** — decyzja projektowa nasza, nie opis Swapcarda           | uzasadnienie, nigdy „bo tak ma Swapcard" |

Czego w tym dokumencie **nie ma i nie będzie**: wymyślonych etykiet Swapcarda,
zgadywanych układów ekranów, kafli z liczbami bez źródła, przykładowych danych
„na razie". Jeśli metryka nie ma źródła w istniejącej tabeli — jest wypisana
w sekcji „czego brakuje", a nie na projekcie ekranu.

**Reguła nadrzędna dla implementacji** (wprost z antywzorca Swapcarda, zrzut 16.1,
gdzie dashboard pokazuje 48 820 rejestracji przy wydarzeniu z 21 osobami):
kafel bez rzeczywistego źródła nie wchodzi na ekran. Pusty stan z instrukcją
(„brak rejestracji — otwórz sprzedaż biletów") jest zawsze lepszy od liczby,
której nie da się obronić przy zarządzie.

---

## 1. Skąd wiemy, że te ekrany istnieją — inwentarz dowodów

Każdy z brakujących ekranów jest **wywoływany z ekranu, który mamy na zrzucie**.
To jedyny pewny materiał: znamy dokładną etykietę kontrolki odsyłającej i kontekst,
w którym stoi.

| Ekran                               | Dowód [D] — dosłowna kontrolka odsyłająca                                                                                                                                                                                                                                         | Skąd (zrzut)      | Co z tego wynika                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Overview`                          | pozycja sidebara `Overview` — pierwsza, nad `Event builder`                                                                                                                                                                                                                       | wszystkie zrzuty  | istnieje pulpit wydarzenia; **zawartości nie znamy**                                                             |
| `Integrations`                      | pozycja sidebara `Integrations`; w trybie rejestracji zewnętrznej: „Have a look to our `Integrations` or to our `Developer Portal` to connect your external registration tool."                                                                                                   | 3.4               | integracje służą m.in. **podłączeniu zewnętrznej rejestracji**; istnieje też portal dla programistów             |
| `Add-on features`                   | pozycja sidebara `Add-on features` (ikona diamentu, wyróżniony kolor) + 19 plakietek `Add-on` + `Get feature` rozsianych po panelu                                                                                                                                                | zał. E inwentarza | to **katalog funkcji płatnych**, nie moduł produktowy                                                            |
| `Session settings`                  | `lnk` **`Manage session custom fields`** oraz zdanie „Fill the custom fields you created in **Session Settings**. This allows you to define specific categories, filters or details about this session…"                                                                          | 6.2               | ekran definiuje **pola własne sesji**: `Type`, `Location`, `Topics` widziane na sesji to jego produkty           |
| `Manage roles`                      | `btn` **`Manage roles`** z ikoną linku zewnętrznego, obok listy prelegentów sesji z nagłówkiem grupy roli `Wykładowcy`                                                                                                                                                            | 7.1               | ekran definiuje **słownik ról prelegentów**; „Wykładowcy" to jedna z nich, nazwana po polsku                     |
| `Manage visibility`                 | `btn` **`Manage visibility`** pod tekstem „Manage the visibility of the event content by people who are **not registered** for the event **or not logged in**. Make sure that the content is accessible to them if you display it publicly on your website thanks to our widget." | 1.5               | macierz dotyczy **gościa** (nie zalogowany / niezarejestrowany) i ma związek z **widgetem na obcej stronie**     |
| `Add condition`                     | `lnk`/`btn` **`Add condition`** w **trzech różnych miejscach**: przy widoczności `Exhibitors`/`Sessions`/`Items` w grupie (2.1), przy `Export condition` wystawców („add a condition such as a **custom field or a term consent**", 8.3) i w opisie reguł spotkań                 | 2.1, 8.3          | jeden silnik warunków, **trzy zastosowania**; warunki opierają się o **pola własne** i **zgody**                 |
| `Edit group's settings`             | `lnk` `Edit group's settings` obok `Group` = `Exhibitors` w uprawnieniach firmy                                                                                                                                                                                                   | 8.9               | prowadzi do **szuflady grupy z partii 2** — czyli ten ekran **znamy**                                            |
| `Item settings`                     | karta **`Item settings`** — „Create item types, subcategories and custom fields. Choose if a list of similar items generated by AI is displayed on each item page."                                                                                                               | 9.1               | ekran definiuje **typy, podkategorie i pola własne** items; poza zakresem NES (§0.4)                             |
| `Marketplace settings`              | `lnk` `Marketplace settings` (ikona koła) obok `Payment settings`; w szczegółach dodatku: „Manage image visibility on the `Marketplace settings`."                                                                                                                                | 11.3, 11.4        | steruje m.in. **widocznością obrazów** pozycji; poza zakresem NES                                                |
| `Payment settings`                  | `lnk` `Payment settings` przy liście biletów **i** przy liście dodatków                                                                                                                                                                                                           | 3.5, 11.3         | **wspólna** konfiguracja płatności dla biletów i dodatków — potwierdza, że to nie jest ustawienie per wydarzenie |
| `Email templates` / `Email header`  | dwa `btn` obok `Create a campaign`                                                                                                                                                                                                                                                | 14.1              | biblioteka szablonów i wspólny nagłówek e-maili — u nas odpowiedniki **istnieją** (§2 poniżej)                   |
| `Default meeting location capacity` | `lnk` (ikona koła) nad listą miejsc spotkań                                                                                                                                                                                                                                       | 19.3              | domyślna **pojemność równoległa** nowego miejsca                                                                 |
| `custom fields settings`            | „You can create new ones and manage their order in the `custom fields settings`." (przy filtrach strony wyboru spotkań)                                                                                                                                                           | 13.4              | ten sam słownik pól własnych rządzi **kolejnością filtrów**                                                      |
| `example page`                      | `lnk` `View an example page` przy stronie wyboru spotkań                                                                                                                                                                                                                          | 13.3              | Swapcard ma publiczny przykład tej strony                                                                        |

### 1.1 Czego z tych dowodów **nie wynika** (i czego nie wolno dopisać)

- **Nie znamy** ani jednej etykiety pola z wnętrza tych ekranów.
- **Nie znamy** liczby ani rodzaju kontrolek, układu sekcji, wartości domyślnych.
- **Nie znamy** operatorów silnika warunków (`równa się`, `zawiera`, `jest jednym z`…) —
  wiemy tylko, na czym warunki operują: **pola własne** i **zgody** [D 8.3].
- **Nie znamy** zawartości `Overview` — ani jednego kafla. Sidebar to jedyny dowód.

### 1.2 Wzorzec adresów (inferencja z 31 potwierdzonych URL-i)

Z 31 zrzutów mamy potwierdzone ścieżki, m.in. `/people/settings/profile-edition`
oraz cztery zakładki `/exhibitors/settings/…`. Stąd **inferencja** [P] o wzorcu
`/(<moduł>)/settings/<zakładka>` — i dopóki nie ma zrzutu, pozostaje inferencją:

| Ekran              | Ścieżka potwierdzona                                      | Ścieżka prawdopodobna [P]                                                                                |
| ------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| People settings    | `…/people/settings/profile-edition` ✅                    | (druga zakładka `Custom fields` — inna końcówka)                                                         |
| Exhibitor settings | `…/exhibitors/settings/cu…`, `…/re…`, `…/ho…`, `…/si…` ✅ | pełne nazwy zakładek                                                                                     |
| Session settings   | —                                                         | `…/plannings/settings/…`                                                                                 |
| Manage roles       | —                                                         | `…/plannings/settings/roles` lub osobny moduł (ikona linku **zewnętrznego** sugeruje inny obszar panelu) |
| Manage visibility  | —                                                         | `…/groups-and-permissions/visibility`                                                                    |
| Overview           | —                                                         | `…/overview` lub `…/` (korzeń wydarzenia)                                                                |
| Integrations       | —                                                         | `…/integrations`                                                                                         |
| Add-on features    | —                                                         | `…/add-ons`                                                                                              |

**Wniosek praktyczny:** ikona **linku zewnętrznego** przy `Manage roles` [D 7.1] jest
sygnałem, że słownik ról **nie mieszka w studiu wydarzenia**, a w obszarze
społeczności (jak `Community parent group` z 2.1). To jedyne, co można o tym
ekranie powiedzieć bez zrzutu — i to ma bezpośredni skutek dla naszego modelu:
role prelegentów powinny być słownikiem **tenanta**, nie wydarzenia.

---

---

## 2. `Overview` — pulpit wydarzenia: co da się policzyć **dzisiaj**

Ekranu nie widziałem [§1.1]. Dlatego nie projektuję jego układu — inwentaryzuję
**wszystkie metryki wydarzenia, które mają dziś rzeczywiste źródło w bazie**, i wprost
oddzielam je od tych, których policzyć nie można. Projekt kafli powstanie dopiero
po zrzucie; ta sekcja mówi, z czego wolno je zbudować.

### 2.1 Metryki z pokryciem pełnym [R] — wchodzą na ekran bez żadnej migracji

| Metryka                                | Źródło (tabela.kolumna / RPC)                                                                    | Szkic zapytania                                                                                                     | Uwaga wiążąca                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Stan publikacji                        | `events.status` przez RPC `admin_get_event(p_id)`                                                | `fetchAdminEvent(id)` — `src/lib/admin/community.ts:233`                                                            | CHECK dopuszcza wyłącznie `draft`/`published`/`cancelled` (`20260713093000_events_module.sql:44`)              |
| Termin + strefa + odliczanie           | `events.starts_at`, `events.ends_at`, `events.timezone`                                          | `select starts_at, ends_at, timezone from events where id = $1`                                                     | odliczanie ma gotowy moduł `src/lib/events/countdown.ts`                                                       |
| Rodzaj wydarzenia                      | `events.kind`                                                                                    | słownik `EVENT_KINDS` + `EVENT_KIND_LABEL_KEYS`, `src/lib/admin/community.ts:181-203`                               | etykiety i18n już istnieją — nie tworzyć nowych                                                                |
| Bramka dostępu                         | `events.visibility`, `events.min_tier_rank` + `membership_tiers`                                 | wzorzec `requiredTierName` w `src/routes/events.$slug.tsx:239-255`                                                  | `visibility` ma tylko 2 wartości: `public`, `members`                                                          |
| Zapisani / zainteresowani / rezerwowi  | `event_rsvps.status` (`going`/`interested`/`waitlist`/`cancelled`)                               | `from('event_rsvps').select('id',{count:'exact',head:true}).eq('event_id',$1).eq('status','going')`                 | **nie używać `get_event_rsvp_counts`** — filtruje `status='published'` i dla szkicu zwróci pustkę              |
| Najstarsze zgłoszenie w kolejce (FIFO) | `event_rsvps.waitlisted_at`                                                                      | `select count(*), min(waitlisted_at) from event_rsvps where event_id=$1 and status='waitlist'`                      | indeks `idx_event_rsvps_waitlist_fifo(event_id, waitlisted_at)`                                                |
| Limit / wolne miejsca / zapełnienie    | `events.capacity` + licznik `going`                                                              | gotowy `seatsFor()` — `src/lib/events/ticket.server.ts:31-55`                                                       | `capacity IS NULL` = brak limitu, nie zero                                                                     |
| Cena biletu                            | `events.ticket_price_cents`, `events.ticket_currency`                                            | `select ticket_price_cents, ticket_currency from events where id=$1`                                                | CHECK: `NULL OR >= 100`, waluta `IN ('PLN','EUR')` (`20260729174905_…:9,14-15`) → **bezpłatne = tylko `NULL`** |
| Wysłane przypomnienia 24 h             | `event_rsvps.reminded_at`                                                                        | `count(*) filter (where reminded_at is not null)`                                                                   | semantyka z `run_event_reminders()` (`20260713093000:305-334`) — patrz §11 poz. 2                              |
| Prelegenci: liczba i lista             | `event_speakers` + RPC `get_public_speakers(p_event_id)`                                         | `rpc('get_public_speakers',{p_event_id})` → `display_name, avatar_url, job_title, company, sort_order, is_expert`   | `event_speakers` ma **3 kolumny** (`event_id`, `user_id`, `sort_order`) — zero danych osobowych                |
| Kompletność obsady                     | `event_speakers` ⨝ `speaker_profiles` (`is_public`, `headline_*`)                                | `count(sp.id) filter (where sp.is_public)`                                                                          | `speaker_profiles.Row` ma 17 kolumn                                                                            |
| Data publikacji / odwołania + autor    | `domain_events` (`aggregate_type='event'`, `event.published.v1` / `.cancelled.v1`)               | `select event_type, created_at, actor_id from domain_events where aggregate_type='event' and aggregate_id=$1::text` | `events` **nie ma** `published_at`; `prune_domain_events()` może usunąć historię                               |
| Spotkania 1:1 przy wydarzeniu          | `meeting_slots.event_id` + `meeting_bookings.status`                                             | `count(b.id) filter (where b.status='confirmed')`                                                                   | CHECK dopuszcza `confirmed` i `cancelled` (`20260728090000_meeting_slots_networking.sql:73`)                   |
| Sesja Q&A wydarzenia                   | `qa_sessions.event_id` + `qa_questions.status`                                                   | `group by s.id, s.status`                                                                                           | `event_id` jest nullowalne — Q&A może istnieć bez wydarzenia                                                   |
| Czat grupowy wydarzenia                | `events.conversation_id` → `conversations.last_message_at`                                       | `join conversations c on c.id = e.conversation_id`                                                                  | utworzenie wątku: RPC `create_event_group(p_event_id)`                                                         |
| Kontekst programowy i regionalny       | `events.program_id` → `programs.name_pl/name_en`; `events.region_id` → `regions.name_pl/name_en` | `left join programs p on p.id = e.program_id`                                                                       | **`programs` nie ma `title_pl`/`title_en`** — kolumny nazywają się `name_pl`/`name_en`                         |
| Chatham House / nagranie / transmisja  | `events.chatham_house`, `events.recording_url`, `events.join_url`                                | `select chatham_house, (recording_url is not null), (join_url is not null) from events where id=$1`                 | `join_url` i `recording_url` są wyjęte z klienckiego SELECT-a (column-level GRANT)                             |
| Okno rejestracji i pierwszeństwo       | `events.rsvp_opens_at`, `events.early_rsvp_rank`                                                 | wzorzec `src/routes/events.$slug.tsx:269-275`                                                                       | nazwa warstwy pierwszeństwa z `membership_tiers`                                                               |
| Checklista braków konfiguracji         | `events.cover_url`, `description_pl/en`, `location`, `join_url`, `ends_at`                       | liczone w TS z jednego wiersza `admin_get_event`                                                                    | zero zapytań dodatkowych — to najtańszy sensowny kafel pulpitu                                                 |

### 2.2 Metryki z pokryciem **warunkowym** — źródło istnieje, ale ma haczyk

| Metryka                            | Źródło                                                   | Haczyk, który trzeba obsłużyć w kodzie                                                                                                                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ------------------------- | --- | ---- | --- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Sprzedane bilety, przychód, zwroty | `payment_orders` (`status`, `amount_cents`, `currency`)  | **nie ma kolumny `event_id`** — jedyne wiązanie to `metadata->>'event_id'`; brak indeksu po `metadata` (7 indeksów, żaden nie obejmuje jsonb) → liczyć w RPC/`serverFn`, nie w pętli klienta                                                                                                           |
| tamże                              | RLS `orders owner read` (`20260814221337_…:77-83`)       | pełny odczyt w tenancie ma **tylko `admin`**, nie `editor` — pulpit wydarzenia musi to rozróżniać (`event_rsvps` czyta admin **i** editor)                                                                                                                                                             |
| tamże                              | `payment_orders.currency`                                | kasa dopuszcza `PLN` i `EUR` → suma **musi** być grupowana po walucie, jedna liczba „przychód" jest nieprawdziwa                                                                                                                                                                                       |
| Bilety z puli planu                | `plan_ticket_claims` (`event_id` **z prawdziwym FK**)    | jedyna tabela biletowa z bezpośrednim FK do `events`; `released_at IS NULL` = bilet aktywny; RLS staff read (admin **i** editor) — `20260822171037_…:32-49`                                                                                                                                            |
| Przychód całkowity                 | `payment_orders` + `plan_ticket_claims.face_value_cents` | dwa różne strumienie (gotówka vs benefit planu) — trzymać w dwóch kolumnach kafla, nie sumować w jedną liczbę                                                                                                                                                                                          |
| Odsłony strony wydarzenia          | `analytics_events` (`event_type='page_view'`, `path`)    | trzy ograniczenia naraz: (a) `ALLOWED_ENTITIES` **nie zawiera** `'event'` (`src/routes/api/public/track.ts:25-39`), więc filtr może iść tylko po `path`; (b) `redactUrl` zamienia każdy query string na literalne `?[redacted]` (`src/lib/observability/redact.ts:64`) → warunek to `path = '/events/' |     | slug OR path = '/events/' |     | slug |     | '?[redacted]'`, a rozbicie po `utm\_\*` jest **niemożliwe**; (c) zapis wymaga zgody analitycznej (`src/lib/analytics/track.ts:138`) |
| Źródła wejść (referrer)            | `analytics_events.referrer`                              | ten sam `redactUrl` obcina query string referrera                                                                                                                                                                                                                                                      |

### 2.3 Czego policzyć **nie można** — i co dokładnie tego brakuje

| Metryka, której nie ma                | Dlaczego                                                                                                                                                                                                                 | Co musi powstać                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Frekwencja faktyczna (kto przyszedł)  | **zero** trafień na `checked_in`/`check_in`/`attendance` w schemacie; `events_attended` w reputacji liczy się z `count(event_rsvps)` (`20260721152000_community_reputation.sql:72`), czyli z deklaracji, nie z obecności | moduł onsite (E7 specyfikacji): `event_scans`, `event_checkpoints`     |
| Liczba sesji, sesje bez prelegenta    | brak tabeli sesji                                                                                                                                                                                                        | `event_sessions` (E3) — ale **z uwzględnieniem §5.4**                  |
| Sprzedaż per typ biletu               | `events` ma dokładnie jedną cenę; brak `event_ticket_types`                                                                                                                                                              | `event_ticket_types` (E5)                                              |
| Sponsorzy i ich poziomy               | sponsorzy to treść widgetu `event-sponsors` (`src/lib/events/sponsors.ts`)                                                                                                                                               | `event_sponsor_tiers` / `event_sponsors` (E4)                          |
| Wysłane maile per wydarzenie          | `email_send_log.metadata` **nie jest ustawiane** przy zapisie transakcyjnym (`src/lib/email/transactional.server.ts:263-268`)                                                                                            | dopisać `metadata.event_id` w ścieżce transakcyjnej                    |
| Sondaże wydarzenia                    | `polls` ma `post_id`, nie ma `event_id`                                                                                                                                                                                  | `polls.event_id` albo interakcje w `event_sessions.interaction`        |
| Data publikacji odporna na prune      | `events` nie ma `published_at` (31 kolumn), a `domain_events` podlega `prune_domain_events()`                                                                                                                            | `events.published_at timestamptz`                                      |
| Pozycja kolejki rezerwowej dla admina | `get_event_waitlist_position(p_event_id)` zwraca pozycję **wywołującego**, nie całą kolejkę                                                                                                                              | RPC listujący kolejkę dla staffu                                       |
| Pulpit jednym zapytaniem              | nie istnieje żaden RPC pulpitu wydarzenia (`admin_get_event`/`admin_list_events` to CRUD, nie agregat)                                                                                                                   | RPC `admin_event_overview(p_event_id)` na wzór `admin_community_stats` |

### 2.4 Trzy wzorce pulpitu, które w repo już działają — nie wymyślać czwartego

| Wzorzec                                                     | Gdzie                                                                              | Kiedy stosować                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| N równoległych `count: 'exact'` w jednym `useQuery`         | `src/routes/admin.index.tsx:13-72` (4 kafle)                                       | do 4–5 liczników z jednej tabeli, gdy RLS wystarczy                                           |
| Jeden RPC zwracający `Json` z wieloma polami → N `StatCard` | `src/lib/admin/community.ts:27-47` + `src/routes/admin.community.index.tsx:61-140` | **domyślny wybór dla pulpitu wydarzenia** — jedna podróż, spójny snapshot, `staleTime 15_000` |
| Server fn z `requireAdmin` czytający `analytics_events`     | `src/lib/analytics/footerAnalytics.functions.ts:55-66`                             | gdy metryka wymaga skanu z limitem (`limit(10_000)`) i nie może iść przez RLS klienta         |

### 2.5 Wniosek [P]

Pulpit wydarzenia da się dziś zbudować z **19 metryk pełnych** i **6 warunkowych**,
bez ani jednej migracji — pod warunkiem, że powstanie jeden RPC agregujący
(`admin_event_overview`), bo inaczej ekran robi kilkanaście zapytań i część z nich
przy `payment_orders` skanuje jsonb. Dziewięć metryk, których organizator oczekiwałby
najbardziej (frekwencja, sesje, typy biletów), **nie ma dziś nośnika** — i muszą być
na ekranie nieobecne, a nie pokazane jako zero.

### 2.6 Chrome ekranu: `Preview event` / `Publish event`

To pasek nad treścią, obecny na każdym zrzucie. Co z niego mamy **dzisiaj**:

| Element chrome                    | Stan | Dowód                                                                                                                                                          |
| --------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Badge stanu (`draft`/`published`) | ✅   | `events.status` + `EVENT_STATUS_LABEL_KEYS` (`src/lib/admin/community.ts:205-209`)                                                                             |
| Przycisk publikacji / odwołania   | ✅   | `updateEventStatus(id, …)` (`src/lib/admin/community.ts:240`); warunki UI `admin.community.events.tsx:205,215`                                                 |
| Ostatnia modyfikacja              | ✅   | `events.updated_at` (trigger `events_set_updated_at`, `20260713093000:59-62`)                                                                                  |
| Link „otwórz wydarzenie"          | ⛔   | w `admin.community.events.tsx` (580 linii) **zero** linków — trzy przyciski ikonowe i nic więcej                                                               |
| `Preview` niepublikowanego        | ⛔   | `post_preview_tokens.post_id` ma FK do `posts` (`20260720131000:15`); trasa `/preview/$token` renderuje wyłącznie wpis                                         |
| Publikacja zaplanowana            | ⛔   | brak `events.publish_at`, brak statusu `scheduled`, brak `publish_due_events` (dla `posts`/`pages` **istnieją** — dwa precedensy)                              |
| Checklista przed publikacją       | ⛔   | `buildPublishChecklist` operuje na polach wpisu; w trasie wydarzeń zero trafień                                                                                |
| Autozapis / straż niezapisanych   | ⛔   | `AutosaveBar`/`useAutosave`/`useUnsavedChangesGuard` nieużywane w trasie wydarzeń                                                                              |
| Powiadomienie o **publikacji**    | ⛔   | gałąź publikacji w `tg_events_status_notify` (`20260713093000:363-370`) wywołuje tylko `emit_domain_event` — nikt nie dostaje powiadomienia o nowym wydarzeniu |
| Powiadomienie o odwołaniu         | 🟡   | pętla filtruje `status IN ('going','interested')` (`:347`) — **lista rezerwowa nie dostaje nic**, bo status `waitlist` dodano później (`20260721150000:41`)    |

**Decyzja [P]:** `Preview event` wymaga uogólnienia tokenów podglądu z `post_id`
na `(entity_type, entity_id)` — to jedna migracja obsługująca wpisy, strony **i**
wydarzenia naraz, zamiast trzeciej tabeli tokenów. `Publish event` jako jeden
przycisk publikujący cały zestaw ekranów wydarzenia nie ma dziś żadnego nośnika:
publikacja jest per rekord (`events.status`, `pages.status`), więc albo pojawia się
`events.root_page_id` z kaskadą, albo chrome pokazuje **osobne** stany („wydarzenie
opublikowane · 3 z 5 podstron w szkicu").

---

## 3. `Integrations` — co u nas **jest**, a czego brakuje do „zewnętrznej rejestracji"

Dowód [D 3.4] mówi jedno: integracje służą m.in. **podłączeniu zewnętrznego
narzędzia rejestracji**. To jest jedyna informacja o zawartości tego ekranu.
Poniżej stan faktyczny NES.

### 3.1 Infrastruktura integracji, która **działa** [R]

| Element                         | Szczegół potwierdzony                                                                                                                  | Ścieżka                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Trasa panelu                    | `/admin/integrations`, nagłówek **„Integracje wychodzące"** (nie ogólne „Integrations"), `noindex/nofollow`                            | `src/routes/admin.integrations.tsx:60-68`                                                                  |
| Układ ekranu                    | dokładnie 3 bloki: pasek 2 akcji, 4 kafle liczników dostaw, karta `Endpoints` z listą + dialog edycji. **Zero zakładek**               | `src/routes/admin.integrations.tsx:317-455`                                                                |
| Rodzaje endpointów              | CHECK w bazie na 6 wartości: `webhook`, `slack`, `hubspot`, `gcal`, `confluence`, `crm_partner`                                        | `20260711203000_…:141-142`, `20260802131000_…:39-43`                                                       |
| Walidacja URL                   | wymuszone `https` + niepusta nazwa, w bazie **i** w UI                                                                                 | `20260711203000_…:151-152`; `admin.integrations.tsx:502`                                                   |
| Statusy dostaw                  | zamknięta lista: `queued`, `delivering`, `delivered`, `failed`, `dead`                                                                 | `20260711203000_…:165-168`                                                                                 |
| Ponowienia i „śmierć" wiersza   | baza liczy backoff: `LEAST(12h, 1min * 2^attempts)`, po 8 próbach `dead`                                                               | `20260711203000_…:273-278`                                                                                 |
| Dzierżawa i odzysk osieroconych | `claim_integration_deliveries` z dzierżawą 5 min, re-claim wierszy `delivering`                                                        | `20260724090800_integration_delivering_reclaim.sql:19-30`                                                  |
| Sekret HMAC / token             | **nie ma kolumny** — siedzi w Supabase Vault pod `integration_endpoints.secret_id`; kolumnę `secret` usunięto migracją                 | `20260714090000_integration_endpoints_secret_vault.sql:12-93`, `:35` (DROP COLUMN)                         |
| RLS                             | staff może wszystko na endpointach; **dostawy są tylko do czytania** (brak polityk INSERT/UPDATE/DELETE dla klienta)                   | `20260711203000_…:188-197`                                                                                 |
| Dispatcher                      | 3 ścieżki odpalenia: przycisk w panelu, cron `jobs-tick`, wejście do CRM                                                               | `src/lib/server/jobsTick.server.ts:193-196`; `src/lib/crm.functions.ts:603-605`                            |
| Adaptery formatów               | dedykowany payload mają `slack`, `hubspot`, `crm_partner`; reszta = generyczna koperta + HMAC                                          | `src/lib/integrations/formats.ts:16-39`                                                                    |
| Szyna zdarzeń                   | `domain_events` jest źródłem fanoutu; **wydarzenia już emitują** `event.published.v1` / `event.cancelled.v1`                           | `20260713093000_events_module.sql:358-366`                                                                 |
| Automatyzacje                   | `/admin/workflows` („Automatyzacje"), 4 zakładki + 4 kafle KPI z okna 500 przebiegów; silnik obsługuje 5 akcji; 4 zaseedowane szablony | `src/routes/admin.workflows.tsx:40,50,61-71,191-212`; `20260711204000_workflow_engine.sql:161-239,351-394` |
| Zdrowie webhooka płatności      | `payment_webhook_events` + ręczne ponowienie z panelu — ale prezentowane na `/admin/billing`, nie na ekranie integracji                | `src/components/admin/billing/AdminWebhookLogPanel.tsx:17,46-62`                                           |
| Webhooki **wchodzące**          | dwa realne: płatności i Resend                                                                                                         | `src/routes/api/public/payments/webhook.ts`, `src/routes/api/public/webhooks.resend.ts`                    |

### 3.2 Czego brakuje — i co to znaczy dla wydarzeń

| Brak                                                          | Dowód (co konkretnie sprawdzone)                                                                                                                                                         | Konsekwencja dla Event Buildera                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Ekran integracji **w panelu wydarzeń**                        | brak plików `admin.events*.tsx`; w `admin.community.events.tsx` grep na `integration                                                                                                     | webhook                                                                                      | mcp` = 0                                                                                             | zakładka `Integrations` per wydarzenie to nowy ekran, nie przeniesienie                         |
| Powiązanie endpointu z **konkretnym wydarzeniem**             | `integration_endpoints` nie ma `event_id`/`entity_id`; `integration_deliveries.event_id` to `uuid` **bez FK** trzymające `domain_events.id`, nie `events.id`                             | filtrowanie webhooka do jednego wydarzenia wymaga nowej kolumny albo warunku w `event_types` |
| Klucze API / tokeny **wydawane** podmiotom zewnętrznym        | 0 trafień na `api_keys                                                                                                                                                                   | personal_access                                                                              | pat_token`; jedyne „api_key" to **nasz** sekret do partnera (`crm_integrations.merydian_api_key_id`) | „zewnętrzna rejestracja" [D 3.4] w kierunku **do nas** nie ma dziś żadnej tożsamości wołającego |
| Rejestr klientów OAuth                                        | 0 trafień na `oauth` w typach; OAuth istnieje tylko jako weryfikacja JWT Supabase w `src/lib/mcp/index.ts`                                                                               | Developer Portal ze zrzutu [D 3.4] nie ma u nas odpowiednika i nie jest w zakresie           |
| Katalog/marketplace integracji, stan `connected/disconnected` | `integration_endpoints` ma tylko `enabled`; brak `last_sync_at`/`last_error` per endpoint (są tylko w legacy `crm_integrations` i `payment_integration_state`)                           | ekran integracji wydarzenia pokaże **transport**, nie „stan połączenia z dostawcą"           |
| Lista pojedynczych dostaw w UI                                | `select` pobiera **wyłącznie kolumnę `status`** z limitem 1000 (`admin.integrations.tsx:189-192`); `last_error`, `attempts`, `next_attempt_at` istnieją w tabeli, ale nie są renderowane | najtańsza realna poprawa: lista `dead` z ostatnim błędem — dane są, brakuje widoku           |
| Statystyki per endpoint                                       | liczniki są globalne dla tenanta, bez `group by endpoint_id` (`:193-198`)                                                                                                                | tak samo — dane są, brakuje grupowania                                                       |
| Ręczne ponowienie / usunięcie dostawy                         | RLS ma tylko `integration_deliveries_staff_select`; `finish_integration_delivery` i `claim_integration_deliveries` nadane wyłącznie `service_role`                                       | „retry" wymaga nowego RPC z bramką staffa                                                    |
| Narzędzia MCP o wydarzeniach                                  | `src/lib/mcp/tools/` to `get-post.ts`, `list-recent-posts.ts`, `search-posts.ts` — 3 narzędzia, wszystkie read-only i wyłącznie o wpisach                                                | serwer MCP nie jest dziś kanałem integracji wydarzeń                                         |
| Zmienne GA4 w `.env.example`                                  | `src/lib/analytics/ga4.server.ts` czyta 5 zmiennych `GA4_*`, w `.env.example` **żadnej**                                                                                                 | patrz §11 poz. 7                                                                             |

### 3.3 Wniosek [P]

Zakładka `Integrations` per wydarzenie **nie potrzebuje nowego silnika** — potrzebuje
widoku na istniejący. Wydarzenia już emitują zdarzenia domenowe, a `integration_endpoints`
umie je rutować po `event_types`. Realny zakres to: (1) filtr endpointu po wydarzeniu
(nowa kolumna albo warunek), (2) lista dostaw `event.*` dla tego wydarzenia z błędem
i licznikiem prób — z danych, które już są, (3) RPC ponowienia z bramką staffa.
Wszystko poza tym (klucze API, portal dla programistów, katalog konektorów) to
**nowy produkt**, nie zakładka.

---

## 4. `Add-on features` — nasz odpowiednik: dwa niezależne mechanizmy flag

Ekran Swapcarda to **katalog funkcji płatnych** [D, zał. E: 19 plakietek `Add-on` +
`Get feature`]. Decyzja projektowa jest już zapisana: **u NES bez upsellu**
(`MAPOWANIE…:266`). To zmienia pytanie z „jak sprzedać dodatek" na „gdzie włączamy
funkcje". Odpowiedź: w dwóch miejscach, które nie mają ze sobą nic wspólnego.

### 4.1 Mechanizm 1: globalne przełączniki modułów [R]

| Fakt                                                                                                                                                                         | Ścieżka                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Jeden wiersz jsonb w `site_settings` pod kluczem `community_modules`                                                                                                         | `src/lib/community/modulesSettings.ts:40`                       |
| Kształt: **10 flag boolean** + `default_message_ttl_seconds: number \| null`                                                                                                 | `src/lib/community/modulesSettings.ts:6-23`                     |
| Domyślnie wszystko włączone **poza `clubs_enabled`** (opt-in)                                                                                                                | `src/lib/community/modulesSettings.ts:26-37`                    |
| Normalizacja: 9 flag przez `!== false`, `clubs_enabled` przez `=== true` — **brak klucza ≠ wyłączone**                                                                       | `src/lib/admin/community.ts:50-73`                              |
| Zapis: read-modify-write + `upsert(onConflict: "tenant_id,key")`; PK `(tenant_id, key)`                                                                                      | `src/lib/admin/community.ts:76-89`; `20260714113000_…:36`       |
| Audyt zmian: `site_settings_revisions` (`operation`, `value`, `changed_by`, `changed_at`)                                                                                    | typy `13289-13321`                                              |
| Odczyt runtime bez własnego zapytania — wspólny select `key,value`, `staleTime` 10 min, `gcTime` 60 min                                                                      | `src/lib/useSiteSetting.ts:33,111,112`                          |
| **20 realnych konsumentów** w runtime (nie tylko panel): `SiteChrome`, trasy `/qa`, `/events`, `/polls`, `/network`, `/people`, `/messages`, `/contribute`, komponenty sieci | grep `useCommunityModules()` po `src/`                          |
| Panel: `/admin/community` renderuje 10 `ToggleRow`, każdy z jednopolowym patchem; po zapisie unieważnia cache publiczny                                                      | `src/routes/admin.community.index.tsx:157-225`, `:78`           |
| **Egzekwowanie w SQL ma tylko jedna flaga** — `expert_requests_enabled` (bramka w `send_expert_request`)                                                                     | `20260806160001_…:413-420`                                      |
| Pozostałe 9 flag to bramki **wyłącznie UI-owe**; komentarz w repo mówi to wprost: „Bramka jest UI-owa, nie bezpieczeństwem"                                                  | `src/lib/clubs/useClubsModule.ts:18`                            |
| Wzorzec „przełącznik bez skutku jest gorszy niż jego brak" jest zapisany w migracji klubów                                                                                   | `20260808260000_discussion_clubs_a24_module_toggle.sql:9,45-52` |

### 4.2 Mechanizm 2: flagi funkcji warstwy członkowskiej [R]

| Fakt                                                                                                                       | Ścieżka                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `membership_tiers.features` (jsonb), 24 kolumny tabeli, czytane przez `tierHasFeature` / `tierFeatureNumber`               | typy `7596-7620`; `src/lib/billing/tiers.ts:111,120`                                              |
| Kanoniczny rejestr **22 flag** z polem `enforced`: **12 egzekwowanych, 10 dekoracyjnych**                                  | `src/lib/billing/capabilities.ts:46-203`                                                          |
| Osobno **4 limity liczbowe** (`NUMERIC_FEATURE_KEYS`), w tym `included_event_tickets`, `event_ticket_discount_pct`         | `src/lib/billing/capabilities.ts:219-227`                                                         |
| Panel renderuje chipy **wyłącznie z rejestru**, badge pokazuje `t("adminPricing.capabilities.enforced")` / `…decorative`   | `src/components/admin/pricing/TierFeatureTogglesEditor.tsx:78-81`                                 |
| `false` jest **usuwane** z jsonb, nie zapisywane jako `false`                                                              | tamże, `:41-50`                                                                                   |
| Warstwa użytkownika wyłącznie serwerowo: RPC `current_membership_tier()`                                                   | typy `18160-18169`                                                                                |
| Macierz `/admin/permissions` generuje wiersze z `TIER_CAPABILITIES` + `NUMERIC_FEATURE_KEYS`, kolumny z `membership_tiers` | `src/lib/authz/permissionMatrix.ts:379-390`                                                       |
| Zgodność rejestru z realnymi bramkami SQL weryfikuje **snapshot generowany ze SQL-a** + test parytetu                      | `src/lib/authz/authzSnapshot.generated.ts`; `bun run generate:authz-snapshot` (`package.json:35`) |

### 4.3 Czego nie ma [R — sprawdzone negatywnie]

- **żadnej** tabeli, kolumny ani RPC o nazwie `addon`/`add_on` (jedyne trafienia to fixture Stripe w teście i dwa fałszywe: `endpointsYetAddOneStart`, `addOne`);
- tabeli `entitlements` (0 trafień na `entitlement` w typach; `src/lib/billing/entitlement.ts` to czyste helpery bez bazy);
- tabeli `feature_flags` ani kolumny `feature_flag`;
- **kolumny `events.features`** — `events.Row` ma 31 kolumn i żadnej jsonb z flagami;
- tabeli `event_types` ani kolumny `default_features` (oba to propozycje z dokumentu mapowania, nie stan repo);
- przycisku/przepływu **kupna** funkcji — `grep "get feature|getFeature"` = 0; wszystkie trafienia na „upsell" dotyczą kierowania czytelnika na `/pricing` przy zbyt niskim planie;
- osobnego ekranu z listą modułów całego serwisu — przełączniki siedzą **wewnątrz** `/admin/community`;
- walidacji Zod dla `community_modules` (`useSiteSetting` przyjmuje opcjonalny `schema`, ale `useCommunityModules` go nie przekazuje) — uszkodzony jsonb jest ratowany ręcznymi warunkami, nie odrzucany;
- **jakiegokolwiek powiązania** między przełącznikami modułów i flagami warstw: dzielą przypadkiem nazwę `chat_enabled`, ale to dwa niezależne mechanizmy czytane obok siebie tylko w `DirectMessageButton.tsx` (`:66` i `:109`).

### 4.4 Wniosek [P]

Odpowiednikiem `Add-on features` w NES jest **rejestr `TIER_CAPABILITIES`**, nie
przełączniki modułów: to on ma pole `enforced`, panel edycji, macierz uprawnień
i maszynową weryfikację zgodności ze SQL-em. Przełączniki modułów są od czego
innego — od wyłączenia całego obszaru w tenancie.

Dla wydarzeń wynika z tego jedno konkretne zadanie: **flagi per wydarzenie nie mają
dziś nośnika**. Gating wydarzenia to dziś `min_tier_rank`, `chatham_house`,
`visibility`, `kind`, `early_rsvp_rank` — pięć osobnych kolumn skalarnych. Jeżeli
chcemy per-wydarzeniowych włączników (czat przy stoisku, skanowanie, kwalifikacja
leadów, eksporty), to jest **jedna migracja** dodająca `events.features jsonb` —
i wtedy obowiązuje reguła z `capabilities.ts`: każda flaga albo ma bramkę
egzekwowaną w SQL, albo jest jawnie oznaczona jako dekoracyjna. Trzeciej możliwości
(„przełącznik bez skutku") repo zabrania wprost.

---

## 5. `Session settings` — słownik pól własnych: mamy **jeden mechanizm i jego ograniczenia**

Dowód [D 6.2] jest tu najbogatszy z wszystkich brakujących ekranów: znamy dosłowne
zdanie („Fill the custom fields you created in **Session Settings**…"), trzy pola
widziane na sesji (`Type` = `None`, `Location` = `None`, `Topics` =
„Select one or several values"), przycisk `Edit field` przy każdym i link
`Manage session custom fields`. Z [D 8.2] wiemy dodatkowo, że u Swapcarda
„Creating fields with single or multiple choice formats will allow you to create
search filters." — czyli **typ pola rodzi filtr**.

### 5.1 Co w NES istnieje jako słownik pól [R]

`post_custom_meta_defs` + `posts.custom_meta` — jedyny **trwały** słownik pól w schemacie
(grep na tabele `*_defs` daje dokładnie jedno trafienie).

| Aspekt              | Stan faktyczny                                                                                                           | Ścieżka                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Kolumny definicji   | **9**: `id`, `tenant_id`, `key`, `label_pl`, `label_en`, `icon`, `position`, `created_at`, `updated_at`                  | typy `10252-10285`                                       |
| Klucz naturalny     | `UNIQUE (tenant_id, key)`; upsert po `onConflict: "tenant_id,key"`                                                       | `20260624181242_…:12`; `src/lib/customMeta.ts:37-45`     |
| Normalizacja klucza | `trim` → `toLowerCase` → wszystko poza `[a-z0-9_]` na `_`                                                                | `src/routes/admin.custom-meta.tsx:79-82`                 |
| Walidacja           | wymagany niepusty `key` + **co najmniej jedna** etykieta (PL lub EN)                                                     | `src/routes/admin.custom-meta.tsx:66-73`                 |
| Ikony               | zamknięta lista **10** nazw: `Info`, `Clock`, `Award`, `Users`, `Tag`, `Star`, `BookOpen`, `MapPin`, `Bookmark`, `Globe` | `src/components/post/CustomMetaList.tsx:21-32,83`        |
| Fallback językowy   | `metaLabel`: `label_<lang>` → druga wersja → `key`                                                                       | `src/lib/customMeta.ts:67-70`                            |
| Wartości            | **jsonb `posts.custom_meta`**, kontrakt `Record<string, string>` — jeden string na klucz                                 | `src/lib/customMeta.ts:17`; typy `10959`                 |
| Kontrolka wartości  | **wyłącznie `<Input>` tekstowy**, placeholder = surowy `key`                                                             | `src/components/admin/CustomMetaValuesEditor.tsx:49-54`  |
| Pusta wartość       | **usuwa klucz** z jsonb, nie zapisuje pustego stringa                                                                    | tamże, `:23-28`                                          |
| Limity serwerowe    | zod: klucz ≤ 64 znaki, wartość ≤ 200 znaków                                                                              | `src/lib/content.functions.ts:393`                       |
| Historia zmian      | `custom_meta` jest na liście `REVISION_FIELDS` i ma etykietę w diffie rewizji                                            | `src/lib/content/revisions.ts:25`; `revisionDiff.ts:178` |
| Pusty stan          | link „Zdefiniuj globalne pola" → `/admin/custom-meta` — **dokładny odpowiednik** `Manage session custom fields` [D 6.2]  | `CustomMetaValuesEditor.tsx:31-40`                       |
| Zakres              | **per tenant** (`tenant_id`) — odpowiednik „field used in other events within this Community" [D 8.2] istnieje           | `20260624181242_…:5,12`                                  |
| Zakres per encja    | ⛔ brak — `pages` **nie ma** `custom_meta`; mechanizm dotyczy wyłącznie wpisów                                           | typy: brak trafienia w bloku `pages` (start `9122`)      |

### 5.2 Drugi, niezależny mechanizm — pola formularzy widgetów [R]

Ten **ma typy pól**, ale **nie ma bazy**:

- `CustomFieldType` = dokładnie 7 wartości: `text`, `email`, `tel`, `url`, `textarea`, `select`, `checkbox` (`src/lib/content-model/formFields.ts:11`);
- kształt: `{ id, type, labelPl?, labelEn?, placeholderPl?, placeholderEn?, required?, options?, maxLength? }`, `CustomFieldOption = { value, labelPl?, labelEn? }` (`:13-29`);
- walidacja parsera: nieznany typ **degraduje do `text`**, duplikaty `id` pomijane, `id` ≤ 64, etykiety ≤ 200, `maxLength` klamowane do 1..4000, `required` akceptuje `true | "1" | "true"` (`:45-133`);
- zbieranie wartości: `custom_${f.id}` z `FormData`, checkbox → `"1"`/`""`, wartości trimowane i cięte do 500 znaków (`:159-177`);
- walidacja: **tylko `required`** — brak regex, min/max, zależności (`:183-194`);
- **istnieje druga, równoległa kopia tego samego kontraktu**: `src/lib/builder/formFieldConfig.tsx:19-37` z identycznym unionem i własnym parserem + `CustomFieldsRenderer` (`:175-270`) mapującym typy na kontrolki;
- definicje **nie mają trwałego słownika** — żyją w treści widgetu jako `customFields` (stringArray, jeden JSON na linię), `grep "custom_fields|customFields"` w typach = 0;
- wartości lądują w jsonb: `contact_messages.custom`, a przez RPC `crm_upsert_from_form(_custom)` w `crm_leads.aliases`.

### 5.3 Czego brakuje, żeby zbudować `Session settings` [R — negatywnie]

| Brakujący element                | Sprawdzone                                                                                                   | Skutek                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Typ pola** w słowniku          | brak kolumny `type`/`field_type`/`kind`/`input_type` w `post_custom_meta_defs` (cały blok + DDL przeczytane) | `Type`/`Location` jako single choice i `Topics` jako multi [D 6.2] są niewyrażalne                      |
| **Opcje słownikowe**             | brak kolumny `options`/`choices`; `CustomFieldOption` istnieje tylko w TS, bez odbicia w bazie               | „Select one or several values" [D 6.2] nie ma nośnika                                                   |
| **Flaga „pole jest filtrem"**    | brak `is_filter` w jakiejkolwiek tabeli                                                                      | zdanie ze [D 8.2] („choice formats → search filters") nie ma implementacji                              |
| **Wymagalność w słowniku**       | brak `required` w słowniku bazodanowym (jest tylko w kontraktach TS formularzy)                              | dziś `CustomMetaValuesEditor` nie waliduje nic poza „puste = usuń klucz"                                |
| **Zakres wydarzenia / encji**    | brak `event_id`, `entity`, `section`, `group` w słowniku                                                     | nie da się mieć pola „tylko dla tego wydarzenia"                                                        |
| **i18n wartości** (nie etykiety) | `Record<string,string>` = jeden string na klucz; `CustomMetaSection` twardo podaje `lang="pl"`               | wartość PL/EN wymagałaby sztucznej konwencji dwóch kluczy                                               |
| **Tabela sesji**                 | 0 trafień na `event_sessions`; istnieją tylko `impersonation_sessions` i `qa_sessions`                       | tabela ze zrzutu 6.1 (Format, Title, Date, Type, Location, Topics, Speakers, Attendees) nie ma podstawy |
| **Prelegent per sesja**          | `event_speakers` kluczuje po `event_id`, nie `session_id`                                                    | licznik „prelegenci sesji" jest w SQL niepoliczalny                                                     |
| Trasa panelu                     | brak `admin.events.sessions.tsx` / `admin.session-settings.tsx`                                              | nowy ekran                                                                                              |

### 5.4 Korekta wobec wcześniejszej wersji specyfikacji — agenda **nie jest** bezschematowa

To ustalenie zmienia plan migracji, więc zapisuję je wprost. Agenda dziś **ma
silnie typowany kontrakt**, tylko nie w bazie:

| Artefakt                              | Gdzie                                                                                 | Co zawiera                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interface ScheduleDay`               | `src/lib/events/schedule.ts:45-52`                                                    | `id`, `label_pl`, `label_en`, `date`, `sessions: ScheduleSession[]`                                                                                                                         |
| `interface ScheduleSession`           | `src/lib/events/schedule.ts:30-43`                                                    | **12 pól**: `id`, `timeStart`, `timeEnd`, `kind: "session" \| "break"`, `title_pl/en`, `description_pl/en`, `room`, `href`, `speakers: ScheduleSpeakerRef[]`, `sponsors: ScheduleSponsor[]` |
| `parseScheduleDays(c: WidgetContent)` | `src/lib/events/schedule.ts:113`                                                      | parser treści widgetu na tę strukturę                                                                                                                                                       |
| `EventScheduleEditor`                 | `src/components/admin/builder/ui/organisms/widget-properties/EventScheduleEditor.tsx` | dedykowany edytor (`commit("days")` `:448`, obsługa `day.sessions` `:461,467-468,598,609-623`)                                                                                              |
| Puste `schemas.ts`                    | `src/lib/builder/schemas.ts:1657-1659`                                                | `"event-schedule": []` **z komentarzem wyjaśniającym**: „Agenda i odliczanie mają dedykowane edytory […] schema pusta z tego samego powodu co speakers."                                    |

**Konsekwencja [P]:** migracja agendy z JSON do tabeli `event_sessions` nie jest
„wymyśleniem modelu" — jest **przepisaniem istniejącego kontraktu**. Pola `room`
i `kind ("session" | "break")` już istnieją i muszą się w tabeli znaleźć pod tymi
samymi nazwami semantycznymi, a `parseScheduleDays` staje się jednorazowym
migratorem danych. Licznik prelegentów per sesja **da się dziś policzyć w kliencie**
(`speakers: ScheduleSpeakerRef[]`), tylko nie w SQL — to niuans, który wcześniej
zapisałem zbyt kategorycznie jako „brak nośnika".

### 5.5 Wniosek [P]

Do `Session settings` prowadzą dwie drogi i trzeba wybrać **jedną**:

1. **Rozszerzyć istniejący słownik** — `post_custom_meta_defs` przemianować na
   uniwersalny (`custom_field_defs`) i dodać: `entity` (`post`/`session`/`person`/`company`),
   `field_type` (z 7 wartości, które **już są** w `CustomFieldType`), `options jsonb`,
   `required`, `is_filter`, `event_id` (nullowalne = zakres tenanta). Zaleta:
   jeden słownik, jeden panel, jeden renderer. Koszt: migracja tabeli używanej
   przez wpisy i publiczną trasę `$.tsx`.
2. **Dodać osobny słownik dla wydarzeń** (`event_custom_field_defs`). Zaleta:
   zero ryzyka dla treści. Koszt: **trzeci** równoległy mechanizm pól własnych
   w repo, przy dwóch już istniejących i podwojonym kontrakcie TS.

Rekomendacja: **droga 1**. Repo już płaci koszt duplikacji (`formFields.ts` vs
`formFieldConfig.tsx` — dwie identyczne kopie tego samego unionu); trzeci mechanizm
utrwaliłby ten błąd zamiast go naprawić.

---

## 6. `Manage roles` — słownik ról prelegentów: wzorzec **1:1 już istnieje**

Dowód [D 7.1]: przycisk `Manage roles` **z ikoną linku zewnętrznego**, obok listy
prelegentów sesji z nagłówkiem grupy roli `Wykładowcy` (po polsku — czyli nazwy
ról są tłumaczone/edytowalne). Zawartości ekranu nie znamy; oba dokumenty zrzutowe
notują wyłącznie sam przycisk i ten jeden nagłówek. Lista `moderator`, `panelist`,
`lecturer`, `host`, `guest` w dokumencie mapowania to **nasza propozycja**, nie
odczyt ze zrzutu — i tak musi być cytowana.

### 6.1 Wzorzec do skopiowania bez zmian: `club_topics` [R]

| Element                    | Stan faktyczny                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Klucz techniczny           | `key` + `CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$')` + `UNIQUE (tenant_id, key)`                                                     |
| Nazwy i18n                 | `label_pl` / `label_en` z `CHECK char_length(btrim(...)) BETWEEN 2 AND 80`                                                       |
| Kolejność                  | `sort_order integer NOT NULL DEFAULT 100` + indeks `(tenant_id, is_active, sort_order, key)`                                     |
| Przełącznik aktywności     | `is_active` + RPC `admin_club_topic_set_active(_id, _is_active)`                                                                 |
| Ochrona wpisów systemowych | `is_system` + `admin_club_topic_delete(_id)` odmawiające usunięcia wpisu systemowego lub **używanego**                           |
| Licznik użycia w wierszu   | `admin_club_topics_list()` zwraca `clubs_count` i `threads_count` obok wiersza katalogu                                          |
| Odczyt dla selecta         | `club_topics_active()` → `{ key, label_pl, label_en, sort_order }`, dostępne też dla `anon`, cache 5 min + `CLUB_TOPIC_FALLBACK` |
| Blokada usuwania w UI      | helper `catalogDeleteBlocked({is_system}, usage)`                                                                                |

Wariant bogatszy — `club_specializations` (dodatkowo `slug`, `icon` DEFAULT `'Globe2'`,
`lead_pl/en`, `desc_pl/en` + RPC `admin_club_specializations_list` / `club_specializations_public`)
— gdyby rola miała mieć własną stronę lub ikonę.

### 6.2 Czego **nie** brać za wzorzec [R — sprawdzone negatywnie]

| Kandydat          | Dlaczego nie                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `categories`      | **nie ma** `sort_order` ani `is_active`; sortuje się alfabetycznie po `name_pl` (`admin.categories.tsx:115`) |
| `name_dictionary` | **nie ma** `tenant_id`, `sort_order` ani `is_active` — dobry wzorzec CSV/realtime, zły wzorzec słownika      |
| `glossary_terms`  | **nie ma** `sort_order`, `is_active`, `is_system`                                                            |

### 6.3 Dzisiejszy kształt „roli" w repo — trzy niespójne precedensy [R]

| Precedens                                                                    | Kształt                                                                                                  | Ocena                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `speaker_profiles.headline_pl` / `headline_en`                               | wolne pole tekstowe i18n, w migracji opisane jako „Rola sceniczna", w UI etykiety „Rola sceniczna PL/EN" | to **rola przy osobie**, nie przy wydarzeniu — nie da się z tego zrobić nagłówka grupy          |
| `research_program_members.member_role_pl` / `_en` + `is_lead` + `sort_order` | dwa **wolne pola tekstowe** wpisywane ręcznie (`admin.research-programs.tsx:680-694`)                    | najbliższy precedens strukturalny (rola + kolejność + wyróżnienie lidera), ale **bez słownika** |
| `club_members.role` + `role_expires_at`                                      | zwykły `string`, **bez CHECK i bez katalogu** (typy: `role: string`)                                     | precedens „rola z terminem ważności"; jako wzorzec nazw — nie                                   |

### 6.4 Czego brakuje [R — negatywnie]

- tabeli `event_speaker_roles` — 0 trafień w `src/` i `supabase/`, nazwa istnieje **wyłącznie** jako propozycja w naszej specyfikacji;
- kolumny `role`/`role_id`/`role_key` w `event_speakers` — `Row` to dokładnie `{ event_id, sort_order, user_id }`, sprawdzone też w obu DDL;
- tabel `event_sessions` / `event_session_speakers` → prelegent może być dziś powiązany **tylko z wydarzeniem**;
- tabeli `event_people` — `event_speakers.user_id` ma FK do `auth.users`, więc **prelegent musi mieć konto** (to jest sedno problemu z 21/21 „No account" ze zrzutów);
- trasy panelu dla słownika ról (`ls src/routes | grep -i role` = 0 plików); jedyne dwa ekrany słownikowe w całym panelu to `admin.community.clubs.topics.tsx` i `admin.community.clubs.specializations.tsx`;
- RPC z `speaker_role` w nazwie — 0 trafień;
- kluczy i18n roli w `src/lib/i18n-admin-community-events.ts` (blok `speakers`, linie 99-139 PL) — są tylko `profile.headlinePl` / `headlineEn`.

### 6.5 Wniosek [P]

Ikona **linku zewnętrznego** [D 7.1] jest jedyną wskazówką co do zakresu i mówi:
słownik ról **nie mieszka w studiu wydarzenia**. To zgadza się z naszym modelem —
role są słownikiem **tenanta**, jak `club_topics`. Zakres minimalny:
`event_speaker_roles` (kopia `club_topics` co do kolumn i RPC) + `event_speakers.role_id`
nullowalne (NULL = „bez roli", nie „Wykładowca" — domyślna rola z nazwy własnej
byłaby zmyśleniem danych). Nagłówki grup na zakładce Speakers biorą się wtedy
z `ORDER BY r.sort_order, es.sort_order`, a nie z twardo wpisanej listy.

---

## 7. `Manage visibility` — macierz widoczności gościa: **najbardziej rozproszony** obszar w repo

Dowód [D 1.5] jest precyzyjny co do zakresu: „Manage the visibility of the event
content by people who are **not registered** for the event **or not logged in**.
Make sure that the content is accessible to them if you display it publicly on your
website thanks to our widget." Czyli: macierz dotyczy **gościa** i ma związek
z **wstawką na obcej stronie**. Zawartości macierzy nie znamy — ani wierszy, ani kolumn.

### 7.1 Co w NES **jest** — i dlaczego to nie jest jeden ekran [R]

| Mechanizm                        | Gdzie                                                                                                               | Co steruje                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Macierz zdolności klubu (9×8)    | `src/lib/clubs/capabilityMatrix.ts` (`CLUB_CAPABILITY_MATRIX`, `CAPABILITY_KEYS`, `CAPABILITY_ROLES`)               | **dane statyczne w TS**, składane przez `clubCapabilityMatrixRows()` — ekran tylko je rysuje, bez zapytania do bazy     |
| Podgląd prawdy dla osoby         | RPC `admin_club_capabilities_preview(_club_id, _user_id, _group_id)` → `club_capabilities(...)`                     | 9 flag + rola efektywna + **kod powodu odmowy** — to najbliższy istniejący odpowiednik „co ta osoba zobaczy"            |
| Co widzi **anonim** w klubie     | `club_capabilities(_club_id, _group_id, NULL)` — funkcja ma `GRANT EXECUTE` dla `anon`                              | `visibility='public' AND status='active'` → `can_read=true`; w każdym innym przypadku `reason='auth_required'`          |
| Lista klubów dla niezalogowanego | `club_list(p_limit, p_offset)` — gałąź `AND (auth.uid() IS NOT NULL OR c.visibility = 'public')`                    | co gość widzi na liście                                                                                                 |
| Co widzi gość w **wydarzeniu**   | polityka RLS „events public read" (`TO anon`)                                                                       | predykat: `status='published' AND tenant_id=public_tenant_id() AND visibility='public' AND COALESCE(min_tier_rank,0)=0` |
| Co widzi zalogowany              | polityka „events member read" + `has_tier_feature()`, `has_tier_rank()`, `current_tier_rank()`                      | m.in. `kind='briefing'` wymaga `has_tier_feature('pro_briefings')`                                                      |
| Wejście i nagranie               | RPC `get_event_access(p_event_id)` → `can_join`, `can_watch`, `join_url`, `recording_url`, `reason`, `watch_reason` | `chatham_house=true` wymaga `has_tier_feature('chatham_house_events')`                                                  |
| Widoczność sekcji przełącznikiem | `career_page_sections.is_visible` + widok `career_page_sections_public` (tnie nagłówki ukrytej sekcji na `NULL`)    | **wzorzec 1:1 dla „Manage visibility" per sekcja** — wiersz istnieje zawsze, `NULL` w `title_*` = ukryte                |
| Bramka treści                    | `content_access` (`mode`, `plan_ids`, `min_tier_rank`, `metering_policy`, `teaser_*`) + `has_content_access()`      | dla `post`/`page`/`media`                                                                                               |
| Zawężony profil dla gościa       | widok `profiles_public` (23 kolumny, **bez e-maila**)                                                               | degradacja widoczności uczestnika                                                                                       |
| KPI macierzy uprawnień           | `src/lib/authz/authzSnapshot.generated.ts` (`roleGates`, `featureGates`, `stats`) + `buildPermissionMatrix()`       | liczba wierszy, egzekwowanych, dekoracyjnych, bramek bez tenanta wołającego                                             |

### 7.2 Czego brakuje [R — negatywnie, sprawdzone jawnie]

| Brak                                                         | Sprawdzone                                                                                                                                                                              | Znaczenie                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `event_capabilities()` — jedno źródło prawdy o dostępie      | 0 trafień w migracjach i typach; najbliższe to `get_event_access` z **6 polami**, bez pojęcia ról, grup i sekcji                                                                        | macierz widoczności wydarzenia nie ma na czym stanąć — trzeba ją zbudować na wzór `club_capabilities`             |
| `event_groups`                                               | 0 trafień; grupy istnieją **wyłącznie** dla klubów (`club_groups`)                                                                                                                      | wiersze macierzy per grupa uczestników nie istnieją                                                               |
| kolumna `guest_mode`                                         | 0 trafień w migracjach i typach                                                                                                                                                         | przełącznik `Guest mode` [D 1.5] to nowa kolumna                                                                  |
| kolumna `anon_visibility` / `guest_visibility`               | 0 trafień; `anon_visibility` to **tylko nazwa pliku migracji** `20260812103500_community_events_anon_visibility.sql`, która zawiera samą politykę RLS                                   | nie ma czego edytować z panelu                                                                                    |
| kolumna dla **gościa** w macierzy `/admin/permissions`       | `APP_ROLES = [super_admin, admin, editor, author, user]`; `ActorKind = "role" \| "tier"`                                                                                                | istniejąca macierz uprawnień **nie ma** kolumny niezalogowanego — a to dokładnie temat tego ekranu                |
| wartości `private`/`secret`/`invite` dla `events.visibility` | CHECK dopuszcza **tylko** `public` i `members`; czterostopniowa skala istnieje tylko dla klubów                                                                                         | „niezarejestrowany na wydarzenie" ≠ „niezalogowany" — dziś nie umiemy odróżnić tych dwóch stanów                  |
| `access_entity_type = 'event'`                               | enum to `"post" \| "page" \| "media"`                                                                                                                                                   | wydarzenia **nie da się** wpisać do `content_access`                                                              |
| `chatham_house` i `min_tier_rank` w formularzu panelu        | grep w `src/routes/admin.community.events.tsx` = **0 trafień** dla obu                                                                                                                  | wydarzenie „members" zostaje z domyślnym `min_tier_rank = 0` — to była wprost przyczyna migracji `20260812103500` |
| edycja macierzy zdolności z panelu                           | `ClubPermissionsTab.tsx` **nie ma żadnej mutacji** (brak `useMutation`, brak zapisu)                                                                                                    | dziś macierz jest wyłącznie do odczytu; edytowalne są tylko pola widoczności                                      |
| jedno źródło prawdy „co widzi gość"                          | rozproszone po: politykach RLS `TO anon`, column-level GRANT (`20260702200000_gate_content_body_columns.sql`), wąskich widokach `*_public`, gałęziach `IF _user_id IS NULL` w funkcjach | **to jest główne ustalenie tej sekcji**                                                                           |

### 7.3 Wniosek [P]

`Manage visibility` jest u nas trudniejsze niż u Swapcarda, bo nasza widoczność
gościa jest **wymuszana w bazie** (RLS + GRANT-y kolumnowe), a nie w warstwie
aplikacji. To zaleta bezpieczeństwa i wada UX: nie ma jednego miejsca, które
mógłby zredagować organizator.

Jedyna uczciwa droga to **ekran-podgląd, nie ekran-edytor** — na wzór
`admin_club_capabilities_preview`: administrator wybiera aktora („gość",
„zalogowany bez planu", „warstwa X", „zarejestrowany na wydarzenie") i widzi
**wyliczoną prawdę** z kodem powodu odmowy dla każdej sekcji wydarzenia. Edytowalne
zostają wyłącznie pola, które **naprawdę** są danymi: `visibility`, `min_tier_rank`,
`chatham_house` (dziś nieobecne w formularzu — patrz §11 poz. 6), `guest_mode`
(nowa kolumna). Macierz z 40 checkboxami, których nie da się zapisać do bazy,
byłaby dokładnie tym, czego ten dokument zabrania.

---

## 8. `Add condition` — silnik warunków: mamy **cztery dialekty**, potrzebny jest jeden

Dowód [D 2.1, 8.3] mówi, że to **jeden mechanizm w trzech zastosowaniach**
(widoczność w grupie, eksport leadów wystawcy, reguły spotkań) i że warunki
opierają się o **pola własne** i **zgody**. Operatorów nie znamy — to jest
pozycja nr 1 na liście do zrzutu (§10).

### 8.1 Dialekt referencyjny: reguły segmentu klubu [R]

Najbliższy nam mechanizm, jedyny z **obowiązkowym podglądem liczby trafień**:

| Element              | Stan faktyczny                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reguła jako **dane** | `club_segment_rules.rule` (jsonb) — **jeden `kind` i jedna wartość**, bez operatora                                                                                                                                                                      |
| Gałęzie `kind`       | `badge` (`profile_badges`), `policy_follow` (`eu_policy_follows`), `event_rsvp` (`event_rsvps` ze `status IN ('going','interested')`), `other_club` (`club_members` ze `status='active'`), `specialization` (`profiles.specialization` + `discoverable`) |
| Podgląd przed akcją  | RPC `admin_club_segment_preview(p_club_id, p_rule)` → **4 liczby**: `matched`, `already_member`, `blocked`, `will_send`                                                                                                                                  |
| Spójność liczb       | `blocked = GREATEST(matched - member - send, 0)` — trzy liczby **zawsze** sumują się do `matched`; to celowa własność, nie przypadek                                                                                                                     |
| Odsiew przed wysyłką | `club_segment_recipients()`: nie-członek + `notification_preferences.enabled_club IS NOT FALSE` + brak odmowy < 90 dni                                                                                                                                   |
| Wykonanie            | `admin_club_invite_segment(..., p_max)` z `LIMIT LEAST(GREATEST(COALESCE(p_max,500),1),2000)` + `ON CONFLICT`                                                                                                                                            |
| Audyt                | `club_moderation_log` z `action='invite_segment'`, `reason` w formacie `'segment: <kind>, invited: <n>'`                                                                                                                                                 |

### 8.2 Trzy pozostałe dialekty [R]

| Dialekt                       | Nośnik                                         | Sposób oceny                                                                                                                            | Podgląd liczby trafień                      |
| ----------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Warunek automatyzacji         | `workflow_definitions.condition` (jsonb)       | **containment** `NEW.payload @> v_def.condition` w triggerze (`20260711204000_workflow_engine.sql:274`) — płaska koniunkcja             | ⛔ brak                                     |
| Targetowanie reklamy          | `ad_slots.targeting` (jsonb)                   | `parseAdTargeting()` + `matchesAdTargeting()` — **`languages` = AND, kategorie/tagi = OR, zaszyte w kodzie**, nie deklarowane w danych  | ⛔ brak                                     |
| Odbiorcy kampanii newslettera | `newsletter_campaigns.audience_filter` (jsonb) | **server fn** `countCampaignAudience` składająca zapytanie w JS przez `supabaseAdmin` (`src/lib/newsletter-campaigns.functions.ts:398`) | ✅ live licznik w panelu, ale **nie w SQL** |

### 8.3 Czego brakuje we **wszystkich czterech** [R — negatywnie]

- **operatorów** — `grep -ci "operator"` w `src/lib/clubs/adminSegment.ts` = 0; `club_segment_candidate_ids` czyta jsonb wyłącznie przez `p_rule->>'<klucz>'` i porównuje **równościowo**; żadna z czterech reguł nie ma pola `op`/`operator`/`match`;
- **łączenia warunków** — brak `jsonb_array_elements` i pętli po warunkach; `ClubSegmentRule` to jeden `kind` i jedna wartość; `workflow_definitions.condition` to płaska koniunkcja przez `@>`;
- **generycznego RPC podglądu** — `grep "segment_preview"` daje **wyłącznie** `admin_club_segment_preview`; `grep "candidate_ids"` wyłącznie `club_segment_candidate_ids`; nie ma niczego typu `rule_preview`;
- **podglądu w bazie dla newslettera** — liczenie jest w JS, więc dla nowego modułu nie ma czego wywołać z SQL-a;
- **pól własnych, na których warunki mają operować** [D 8.3] — 0 trafień na `custom_field` w migracjach (§5);
- **warunku eksportu** — nie ma tabeli/kolumny wiążącej warunek z eksportem; zgody **istnieją** (`user_consents`, `user_consent_events`, `crm_consent_log` z `consent_key`, `given`, `given_at`, `withdrawn_at`, `version`), ale **nic ich nie spina** z regułą;
- **ponownego użycia zapisanej reguły** — patrz §11 poz. 3.

### 8.4 Wniosek [P] — doktryna dla Event Buildera

Cztery dialekty w jednym repo to już dług. Event Builder ma **trzy** zastosowania
warunków [D 2.1, 8.3] — jeżeli doda piąty dialekt, mechanizm przestanie być
utrzymywalny. Doktryna, którą przyjmujemy (jest już zapisana w `adminSegment.ts`
i tylko ją rozszerzamy na moduł):

1. **Reguła jest danymi**, nie kodem — jsonb z unią rozróżnianą po `kind`.
2. **Reguła jest oceniana w SQL**, nie w kliencie — inaczej nie da się jej użyć w RLS ani w triggerze.
3. **Podgląd liczby trafień jest obowiązkowy** przed każdą akcją nieodwracalną, a liczby muszą się **sumować** (wzorzec `matched = member + blocked + send`).
4. **Liczba stoi w przycisku potwierdzenia** (`Create 40 slots`, `Zaproś 137 osób`) — nie w tekście obok.
5. Operatory dodajemy **dopiero po zrzucie** `Add condition`. Wymyślenie własnego zestawu (`contains`, `in`, `>`) bez wiedzy, czego oczekuje organizator, to dokładnie ten rodzaj zgadywania, którego ten dokument zabrania. Dopóki go nie ma — zostajemy przy równości i jednej gałęzi `kind`, bo to **działa** i jest przetestowane.

---

## 9. Reguła „rzeczywiste dane" — kontrakt dla implementacji

Ta sekcja jest wymogiem zamawiającego postawionym wprost: **dane mają być
rzeczywiste, elementy mają istnieć**. Poniżej kontrakt, który to egzekwuje.

### 9.1 Trzy zakazy

| Zakaz                                                   | Uzasadnienie                                                                                                                                            | Jak sprawdzić                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Zakaz danych demonstracyjnych** w panelu produkcyjnym | Swapcard pokazuje `48,820 Registered` przy wydarzeniu z 21 osobami [D 16.1]; liczba z dashboardu trafia potem do raportu dla zarządu                    | żaden komponent panelu nie może zawierać liczb literalnych w JSX poza `0` w stanie pustym                                        |
| **Zakaz kafla bez źródła**                              | kafel, którego nie da się policzyć z istniejącej tabeli, jest obietnicą bez pokrycia (jak dziś `speaker_profiles.rating` — kolumna jest, źródła nie ma) | każdy kafel na projekcie ma wskazaną tabelę i szkic zapytania; brak → kafel wypada z zakresu do etapu, w którym powstanie źródło |
| **Zakaz metryki częściowo filtrowanej**                 | Swapcard: „\*Group filtering is not considered for the these metrics." [D 16.1] — część kafli respektuje filtr, część nie                               | filtr grupy obowiązuje we wszystkich kaflach sekcji albo w żadnym; kafle niefiltrowalne stoją w osobnej sekcji z jawnym podpisem |

### 9.2 Trzy nakazy

1. **Pusty stan mówi, co zrobić.** Wzorzec ze Swapcarda jest tu dobry i warto go
   skopiować: „No meetings scheduled, make sure you create slots, locations,
   generate condition and/or add request rules." [D 19.1] — zdanie wymienia
   **wszystkie brakujące warunki wstępne**, a nie tylko stwierdza pustkę.
2. **Liczba w przycisku akcji masowej jest treścią potwierdzenia.**
   `Create 40 slots` [D 19.5], `Create 1 location` [D 19.2] — dokładnie tyle,
   ile powstanie. Ta zasada jest już zapisana w repo dla kampanii segmentowych
   (`src/lib/clubs/adminSegment.ts` §4) i obowiązuje w całym module.
3. **Ostrzeżenie zamiast cichego przyjęcia śmieci.** Dane referencyjne Swapcarda
   zawierają slot o długości **1050 minut** i sesje z **2024** roku w wydarzeniu
   z 2025 [D 19.4, 6.2]. Panel musi ostrzegać przy dacie poza zakresem wydarzenia
   i przy nienaturalnym czasie trwania — inaczej uczestnik dostaje takie „terminy".

### 9.3 Test odbioru dla każdego nowego ekranu

Ekran przechodzi odbiór, gdy dla **każdego** widocznego elementu da się odpowiedzieć:

- z jakiej tabeli/kolumny bierze się wartość (albo: to stan pusty),
- co widzi administrator, gdy danych nie ma **wcale**,
- co widzi, gdy danych jest **za dużo** (paginacja, limity),
- czy element respektuje filtr grupy i bramkę widoczności (`chatham_house`).

---

## 10. Czego zamówić na zrzutach (lista zamknięta)

Poniżej dokładnie to, czego brakuje, żeby domknąć mapowanie. Kolejność według
wpływu na model danych, nie według układu sidebara.

| Priorytet | Ekran                                                                  | Dlaczego to blokuje                                                                                                                    | Co konkretnie sfotografować                                                                                                       |
| --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **1**     | `Add condition` — rozwinięty (dowolne z trzech miejsc)                 | jedyny mechanizm, którego kształtu nie znamy, a występuje w trzech modułach: widoczność grupy, eksport leadów, reguły spotkań          | modal/panel po kliknięciu `Add condition`: **operatory**, wybór pola, wartości, łączenie warunków (I/LUB), podgląd liczby trafień |
| **2**     | `Session settings` (przez `Manage session custom fields`)              | definiuje `Type`, `Location`, `Topics` sesji; decyduje, czy nasz jeden mechanizm pól własnych (§4.12 specyfikacji) ma właściwy kształt | lista pól, formularz nowego pola: **typy pól**, sekcje, czy pole jest filtrem, kolejność, zakres (wydarzenie / społeczność)       |
| **3**     | `Manage visibility`                                                    | macierz widoczności gościa — u nas najbardziej ryzykowna część uprawnień (Chatham House)                                               | pełna macierz: **wiersze** (sekcje treści) × **kolumny** (kto widzi), stany domyślne                                              |
| **4**     | `Manage roles`                                                         | rozstrzyga, czy słownik ról prelegentów jest per wydarzenie czy per społeczność (ikona linku zewnętrznego sugeruje drugie)             | lista ról, formularz roli, czy role mają kolejność i i18n nazw                                                                    |
| **5**     | `Overview`                                                             | pulpit, który u nas ma pokazywać **wyłącznie rzeczywiste** dane — trzeba wiedzieć, jakie pytania zadaje organizator                    | wszystkie kafle i sekcje, checklisty onboardingu, skróty do zadań                                                                 |
| **6**     | `Integrations`                                                         | dowiemy się, czy „zewnętrzna rejestracja" to webhook, API czy gotowe konektory                                                         | lista integracji, ekran konfiguracji jednej z nich                                                                                |
| **7**     | `Add-on features`                                                      | katalog funkcji płatnych — przydatny do porównań ofertowych, nie do modelu                                                             | lista pozycji z cenami/opisami                                                                                                    |
| 8         | `People settings → Custom fields`                                      | druga zakładka ekranu, który już mamy                                                                                                  | formularz pola własnego osoby                                                                                                     |
| 9         | `Email templates`, `Email header`                                      | u nas odpowiedniki istnieją; zrzut potwierdziłby zakres                                                                                | lista szablonów, edytor nagłówka                                                                                                  |
| 10        | `Default meeting location capacity`                                    | jedno pole                                                                                                                             | modal ustawienia                                                                                                                  |
| —         | `Item settings`, `Marketplace settings`, `Hosted buyer` (konfiguracja) | **poza zakresem** NES (§0.4) — mapujemy tylko dla kompletności obrazu                                                                  | —                                                                                                                                 |

### 10.1 Alternatywa dla zrzutów: publiczna dokumentacja

Przy `Add condition` i `Manage visibility` (priorytety 1 i 3) sensowną drogą jest
też publiczna dokumentacja Swapcarda (`Learn how ›` prowadzi do ich bazy wiedzy).
Jeśli wolisz, mogę z niej wyciągnąć opis mechanizmu — ale zaznaczę wtedy, że to
**dokumentacja producenta, nie zrzut z działającego panelu**, bo dokumentacja bywa
starsza niż interfejs.

---

## 11. Ustalenia poboczne — **siedem realnych błędów** wykrytych przy weryfikacji źródeł

Te znaleziska nie są częścią Event Buildera. Wyszły przy sprawdzaniu, czy metryki
z §2–§8 mają rzeczywiste źródła — i każde z nich dotyczy kodu, który **dziś jest
na produkcji**. Zapisuję je tutaj, bo trzy z nich (1, 2, 3) leżą dokładnie
na ścieżce, którą moduł wydarzeń będzie chodził.

| #     | Co jest nie tak                                                                                                                                                                                                                | Dowód                                                                                                                                       | Skutek                                                                                                                                                  | Rekomendacja                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Zwrot za bilet nie cofa RSVP.** Kod ustawia `status: "canceled"` (jedno „l"), a `event_rsvps_status_check` dopuszcza wyłącznie `'going'`, `'interested'`, `'cancelled'`, `'waitlist'`.                                       | `src/lib/billing/refunds.server.ts:157` vs `20260721150000_events_waitlist_recordings_gate.sql:40-41`                                       | UPDATE jest odrzucany przez CHECK → `throw new Error("refund: rsvp cancel failed…")` (`:159`) **wywala całą obsługę zwrotu**; miejsce nie wraca do puli | jednoznakowa poprawka + test regresyjny; ścieżka sporu (`:325`) używa `'going'`, więc jest poprawna                                                        |
| **2** | **Przycisk „wyślij przypomnienia" w panelu nie może zadziałać.** `run_event_reminders()` ma `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` i `GRANT` tylko dla `service_role`, a panel woła go z przeglądarki.            | `20260713093000_events_module.sql:333-334` vs `src/lib/admin/community.ts:288` ← `src/routes/admin.community.index.tsx:90-95`               | administrator dostaje `42501`; scenariusz jest **wprost testowany** (`src/lib/admin/__tests__/community.test.ts:868` — „reminders denied", „42501")     | albo `serverFn` z `requireAdmin` i `supabaseAdmin`, albo usunąć przycisk; działające ścieżki to `pg_cron` i `src/lib/notifications/dispatch.server.ts:362` |
| **3** | **Zapisane reguły segmentu są nieosiągalne z panelu.** `club_segment_rules` nie ma **żadnej** polityki RLS, a `REVOKE ALL … FROM authenticated` stoi w migracji — mimo że `COMMENT ON TABLE` deklaruje ponowne użycie reguły.  | brak `CREATE POLICY` dla tej tabeli w `supabase/migrations/*.sql`; `20260808092000_…:139`; `grep 'from("club_segment_rules")'` w `src/` = 0 | kampanii segmentowej **nie da się powtórzyć** z panelu; historia (`last_run_at`, `last_sent`) jest zapisywana i nigdy nie czytana                       | polityka SELECT dla staffa albo RPC listujący — inaczej `p_save_rule` zapisuje do szuflady bez klamki                                                      |
| **4** | **Powiadomienie o odwołaniu pomija listę rezerwową.** Pętla w `tg_events_status_notify` filtruje `status IN ('going','interested')`; status `waitlist` dodano **później** i funkcji nie zaktualizowano.                        | `20260713093000_events_module.sql:347` vs `20260721150000_…:41`; `grep "tg_events_status_notify"` = tylko dwie migracje, żadna po lipcu     | osoby z kolejki nie dowiadują się, że wydarzenie odwołano                                                                                               | dopisać `'waitlist'` do pętli; przy okazji rozważyć powiadomienie o **publikacji** (dziś brak — §2.6)                                                      |
| **5** | **`audience_filter.statuses` nie ma kontrolki w panelu.** Pole jest w schemacie zod i w zapytaniu, ale redaktor nie może go ustawić.                                                                                           | `grep -c 'statuses'` w `src/routes/admin.newsletter.campaigns.$id.tsx` = 0                                                                  | kampanie zawsze idą do domyślnego `['subscribed']`; parametr istnieje tylko dla wywołań programowych                                                    | dodać kontrolkę albo usunąć pole ze schematu (martwy parametr myli przy audycie)                                                                           |
| **6** | **`chatham_house` i `min_tier_rank` nie są edytowalne z panelu wydarzeń.** Oba istnieją w bazie i **są bramkami w SQL**, ale formularz ich nie ustawia.                                                                        | `grep "chatham_house"` i `grep "min_tier_rank"` w `src/routes/admin.community.events.tsx` = 0 trafień                                       | wydarzenie „members" zostaje z `min_tier_rank = 0`; to była wprost przyczyna migracji `20260812103500`                                                  | dwa pola w formularzu — najtańsza poprawka bezpieczeństwa treści w całym module                                                                            |
| **7** | **Zmienne GA4 nie są w `.env.example`.** Kod serwerowy czyta `GA4_SERVICE_ACCOUNT_JSON`, `GA4_OAUTH_CLIENT_ID`, `GA4_OAUTH_CLIENT_SECRET`, `GA4_OAUTH_REFRESH_TOKEN`, `GA4_PROPERTY_ID` — w przykładzie środowiska **żadnej**. | `src/lib/analytics/ga4.server.ts:49,106-108,145` vs `grep -i "GA4" .env.example` = 0                                                        | nowe środowisko wstaje bez GA4 i nikt nie wie, czego brakuje                                                                                            | dopisać pięć nazw (bez wartości) do `.env.example`                                                                                                         |

Dodatkowo dwie rozbieżności dokumentacyjne, bez skutku funkcjonalnego:
nagłówek `src/lib/useSiteSetting.ts:10` mówi o „5-minute staleTime", a kod ma
10 minut (`:111`, `gcTime` 60 min w `:112`); nagłówek
`20260724130000_expert_request_visibility.sql` obiecuje „Trzy poziomy kontroli",
a wylicza dwa.
