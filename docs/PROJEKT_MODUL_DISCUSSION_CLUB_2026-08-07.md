# Projekt modułu: Discussion Club

Data: 2026-08-07 · Status: **specyfikacja do zatwierdzenia** (przed implementacją)
Kontekst: domyka luki #8 („trwałe kręgi tematyczne") i #17 („kanał aktywności członków")
z `AUDYT_NETWORKING_KONTAKT_WYSZUKIWANIE_2026-08-07.md`.

---

## 0. Teza projektowa

Platforma ma dziś **pięć** powierzchni rozmowy i żadna z nich nie robi tego, co Discussion Club:

| Powierzchnia          | Rytm               | Trwałość      | Kto inicjuje   | Relacja              |
| --------------------- | ------------------ | ------------- | -------------- | -------------------- |
| Komentarze pod wpisem | reaktywny          | żyje z wpisem | czytelnik      | czytelnik → redakcja |
| Q&A (`qa_sessions`)   | sesyjny            | żyje z sesją  | uczestnik pyta | laik → ekspert       |
| Czat / grupy          | synchroniczny      | efemeryczny   | dowolny        | 1:1 lub mała grupa   |
| Programy badawcze     | redakcyjny         | trwały        | **redakcja**   | redakcja → odbiorca  |
| Tracker / dossier     | monitorujący       | trwały        | system         | system → obserwator  |
| **Discussion Club**   | **asynchroniczny** | **trwały**    | **członek**    | **równy ↔ równy**    |

Dziura jest dokładnie jedna i jest duża: **nigdzie członek nie może założyć trwałego wątku
i prowadzić go z innymi członkami jak z równymi sobie.** Wszystko, co dziś istnieje, to albo
reakcja na cudzą treść, albo pytanie do autorytetu, albo znikająca rozmowa.

**Zasada nadrzędna: Discussion Club nie jest forum.** Forum optymalizuje liczbę postów.
Ten moduł optymalizuje **jakość deliberacji** — a to prowadzi do innych decyzji projektowych
w pięciu miejscach: reakcje są semantyczne a nie ozdobne, wątek ma zamierzony wynik,
atrybucja jest przełączalna (reguła Chatham House), głębokość zagnieżdżenia jest przycięta,
a ranking premiuje wnoszenie wiedzy zamiast częstotliwości.

---

## 1. Zasady funkcjonowania

### 1.1 Klub jako jednostka, nie kategoria

Klub to **przestrzeń z członkostwem**, nie tag. Ma nazwę, opis, prowadzących, zasady, próg
wejścia i własny rytm. Konsekwencja: użytkownik nie „przegląda kategorii" — on **wstępuje**,
a wstąpienie jest zdarzeniem, które można powitać, wyjaśnić i zmierzyć.

Cztery poziomy widoczności (`clubs.visibility`), świadomie rozdzielone od polityki wstępu:

| Widoczność | Kto widzi, że klub istnieje         | Kto czyta treść  | Zastosowanie                       |
| ---------- | ----------------------------------- | ---------------- | ---------------------------------- |
| `public`   | wszyscy, także anonim, indeksowane  | wszyscy          | klub wizerunkowy, lejek pozyskania |
| `members`  | zalogowani                          | zalogowani       | domyślny                           |
| `private`  | zalogowani (widzą kartę, nie treść) | tylko członkowie | grupa robocza                      |
| `secret`   | tylko członkowie                    | tylko członkowie | konsorcjum, sprawa wrażliwa        |

Polityka wstępu (`join_policy`) jest **osobną osią**: `open` / `request` / `invite`.
Klub `public` + `invite` to publiczna wizytówka zamkniętego grona — poprawna i częsta
kombinacja, której model jednoosiowy by nie wyraził.

Dodatkowo `min_tier_rank` — dokładnie ten sam wzorzec bramkowania, co `events.min_tier_rank`,
więc klub premium działa bez nowej mechaniki płatności.

### 1.2 Reguła Chatham House jako przełącznik, nie obejście

To jest najważniejsza decyzja projektowa całego modułu i główny powód, dla którego ten klub
nadaje się do rozmowy o polityce publicznej.

`clubs.attribution_mode`:

- **`attributed`** — każdy post podpisany. Domyślny.
- **`chatham`** — treść jest cytowalna, tożsamość nie. Wypowiedzi widoczne jako
  „Członek klubu" + stabilny pseudonim w obrębie wątku (żeby dało się śledzić, kto z kim
  polemizuje), bez ujawnienia kto.
- **`anonymous_allowed`** — autor decyduje per post.

**Anonimowość jest funkcją projekcji, nie interfejsu.** `author_id` zapisujemy zawsze — bo
odpowiedzialność i moderacja muszą działać — ale w trybie `chatham` kolumna **nigdy nie
opuszcza bazy**. Egzekwuje to RPC odczytowy (`club_thread_view`), który nie zwraca `author_id`
dla postów anonimowych; klient go nie dostaje, więc nie ma czego wycieknąć w devtoolsach.
To ta sama doktryna, która działa już w `get_chat_peers` i w cichej odmowie zaproszenia.

Pseudonim jest deterministyczny i **osolony per wątek**:
`author_alias = hash(thread_id || author_id || tenant_salt)` → „Uczestnik C". Osolenie per
wątek jest celowe: bez niego ten sam pseudonim w wielu wątkach pozwoliłby po czasie
zdeanonimizować osobę przez korelację tematów.

Moderator widzi tożsamość zawsze — przez osobne, audytowane RPC
(`club_moderator_reveal_author`), którego każde wywołanie ląduje w `audit_log`.
To jest kompromis, który trzeba świadomie zatwierdzić: **pełna anonimowość wobec moderatora
jest niemożliwa w module, który ma odpowiadać za nadużycia.**

### 1.3 Wątek ma zamierzony wynik

Każdy wątek deklaruje rodzaj (`club_threads.kind`), a rodzaj zmienia zachowanie UI i cyklu życia:

| Rodzaj         | Po co                    | Co dodaje                                                                         |
| -------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `discussion`   | otwarta debata           | domyślny                                                                          |
| `question`     | ktoś czegoś nie wie      | „oznacz jako rozstrzygające" (`resolved_reply_id`), status `resolved`             |
| `position`     | wykuć wspólne stanowisko | stanowiska `support`/`oppose`/`abstain` + licznik, wynik do `eu_policy_positions` |
| `resource`     | podzielić się materiałem | wymaga linku/pliku, wpina się w `cross_references`                                |
| `announcement` | ogłoszenie prowadzącego  | tylko `lead`/`moderator`, przypięte, opcjonalnie bez odpowiedzi                   |
| `poll`         | szybki sondaż            | reużywa istniejące `polls` / `poll_votes`                                         |

Wątek, który nie prowadzi do niczego, po 90 dniach bez odpowiedzi dostaje status `dormant`
i wypada z rankingu — bez kasowania. To utrzymuje klub czytelnym bez moderacyjnej pracy ręcznej.

### 1.4 Kotwiczenie w treści platformy

Wątek może być zakotwiczony (`anchor_type` + `anchor_id`) w: `eu_policy_item` (dossier),
`post`, `event`, `research_program`, `club_thread` (kontynuacja). Kotwica nie jest ozdobnym
linkiem — to krawędź w istniejącym grafie `cross_references`, więc:

- dossier pokazuje „3 wątki w klubach dyskutują ten plik",
- wpis redakcyjny pokazuje „dyskusja członków",
- wątek dziedziczy `policy_area` i etap legislacyjny kotwicy, więc filtruje się razem z nimi,
- `policy.updated.v1` na szynie zdarzeń może **obudzić wątek** („dossier zmienił etap na
  trilog — wasza dyskusja sprzed miesiąca może wymagać aktualizacji").

Ostatni punkt jest tym, czego generyczne forum nie potrafi, a co na platformie policy jest
naturalne: **dyskusja żyje w rytmie procesu legislacyjnego, nie w rytmie postów.**

### 1.5 Moderacja proporcjonalna do ryzyka

`clubs.moderation_mode`: `post` (domyślne — publikuj, moderuj po fakcie) / `pre`
(premoderacja wszystkiego) / `trusted` (premoderacja **tylko** dla członków poniżej progu
reputacji). Tryb `trusted` powinien być rekomendowany: rozwiązuje realny problem
(nowe konto = wektor spamu) bez kary dla stałych uczestników.

Próg czyta istniejący system reputacji (`REPUTATION_LEVELS`): domyślnie premoderacja poniżej
poziomu `participant` (50 pkt).

---

## 2. Model danych

Wszystko idempotentne, `tenant_id` pinowany triggerem, RLS włączone, klient **bez grantów
zapisu** — cała powierzchnia mutacji przez RPC `SECURITY DEFINER`. Wzorzec przeniesiony
1:1 z `user_connections`, który audyt ocenił na 9/10.

```sql
-- 1) Klub
clubs (
  id uuid PK, tenant_id uuid NOT NULL → tenants,
  slug text NOT NULL,                          -- UNIQUE (tenant_id, slug)
  name_pl/name_en text NOT NULL,
  tagline_pl/tagline_en text,
  description_pl/description_en text,
  icon text DEFAULT 'MessagesSquare', accent_color text, cover_image_url text,
  visibility text CHECK IN ('public','members','private','secret') DEFAULT 'members',
  join_policy text CHECK IN ('open','request','invite') DEFAULT 'request',
  min_tier_rank integer NOT NULL DEFAULT 0,
  attribution_mode text CHECK IN ('attributed','chatham','anonymous_allowed'),
  post_policy text CHECK IN ('all_members','curated','leads_only'),
  moderation_mode text CHECK IN ('post','pre','trusted') DEFAULT 'trusted',
  policy_area text,                            -- spójne z eu_policy_items
  rules_pl/rules_en text,                      -- zasady klubu, akceptowane przy wejściu
  status text CHECK IN ('draft','active','archived') DEFAULT 'draft',
  member_count/thread_count integer DEFAULT 0, -- denormalizacja, trigger
  last_activity_at timestamptz,
  created_by uuid, created_at, updated_at
)

-- 2) Członkostwo
club_members (
  id, tenant_id, club_id → clubs, user_id → auth.users,
  role text CHECK IN ('lead','moderator','member','observer') DEFAULT 'member',
  status text CHECK IN ('active','pending','invited','banned','left'),
  notify_level text CHECK IN ('all','mentions','digest','none') DEFAULT 'digest',
  rules_accepted_at timestamptz,
  joined_at, last_read_at,
  UNIQUE (club_id, user_id)
)

-- 3) Wątek
club_threads (
  id, tenant_id, club_id, author_id, slug,      -- UNIQUE (club_id, slug)
  title text CHECK (length BETWEEN 5 AND 200),
  body text CHECK (length BETWEEN 10 AND 20000),
  kind text CHECK IN ('discussion','question','position','resource','announcement','poll'),
  status text CHECK IN ('pending','open','resolved','dormant','locked','hidden','deleted'),
  is_anonymous boolean DEFAULT false,
  anchor_type text, anchor_id text,             -- dossier/post/event/program/thread
  pinned_at, locked_at, resolved_reply_id,
  reply_count/participant_count/reaction_count integer DEFAULT 0,
  last_reply_at timestamptz,
  hotness numeric DEFAULT 0,                    -- patrz §5.3
  search_vector tsvector,                       -- GENERATED, konfiguracja 'polish'
  created_at, updated_at, edited_at, edit_count smallint DEFAULT 0
)

-- 4) Odpowiedź (drzewo przycięte do 2 poziomów, jak komentarze)
club_replies (
  id, tenant_id, club_id, thread_id → club_threads, author_id,
  parent_id → club_replies,
  depth smallint NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 2),
  body text CHECK (length BETWEEN 1 AND 10000),
  is_anonymous boolean DEFAULT false,
  status text CHECK IN ('pending','visible','hidden','deleted'),
  reaction_count integer DEFAULT 0,
  search_vector tsvector,
  created_at, updated_at, edited_at, edit_count smallint DEFAULT 0
)

-- 5) Reakcje — słownik ZAMKNIĘTY (patrz §4.2)
club_reactions (
  id, tenant_id, club_id,
  target_type text CHECK IN ('thread','reply'), target_id uuid,
  user_id, kind text CHECK IN ('insightful','evidence','question','agree','disagree','thanks'),
  created_at,
  UNIQUE (target_type, target_id, user_id, kind)
)

-- 6) Stanowiska (wątki kind='position')
club_stances (
  id, tenant_id, thread_id, user_id,
  stance text CHECK IN ('support','oppose','abstain'),
  rationale text CHECK (rationale IS NULL OR length <= 1000),
  created_at, updated_at,
  UNIQUE (thread_id, user_id)
)

-- 7) Subskrypcje wątków (nadpisują notify_level klubu)
club_thread_subscriptions (
  thread_id, user_id, state CHECK IN ('subscribed','muted'), created_at,
  PRIMARY KEY (thread_id, user_id)
)

-- 8) Zaproszenia
club_invitations (
  id, tenant_id, club_id, inviter_id, invitee_id, message,
  status CHECK IN ('pending','accepted','declined','expired'),
  created_at, responded_at, expires_at
)

-- 9) Log moderacji (osobno od audit_log — widoczny dla prowadzących klubu)
club_moderation_log (
  id, tenant_id, club_id, moderator_id,
  action CHECK IN ('approve','hide','delete','lock','pin','ban','unban','reveal_author'),
  target_type, target_id, reason text, created_at
)

-- 10) Wektory semantyczne wątków (domyka lukę #1 z audytu)
club_thread_embeddings (
  thread_id PK, tenant_id, embedding extensions.vector(768),
  source_hash text, updated_at
)
```

**Denormalizacja liczników jest świadoma.** `reply_count`, `participant_count`,
`member_count`, `last_reply_at` utrzymują triggery — dokładnie jak `user_pending_counters`
w istniejącej architekturze. Lista wątków musi się renderować bez `COUNT(*)` per wiersz,
bo to jest ekran otwierany najczęściej w całym module.

**Indeksy krytyczne:**

```sql
club_threads (club_id, status, pinned_at DESC NULLS LAST, hotness DESC)  -- lista domyślna
club_threads (club_id, status, last_reply_at DESC)                        -- sort "najnowsze"
club_threads (anchor_type, anchor_id) WHERE anchor_id IS NOT NULL         -- karta dossier
club_threads USING GIN (search_vector)
club_replies (thread_id, status, created_at)                              -- widok wątku
club_replies (parent_id) WHERE parent_id IS NOT NULL
club_reactions (target_type, target_id)                                   -- agregacja reakcji
club_members (user_id, status) WHERE status = 'active'                    -- "moje kluby"
club_thread_embeddings USING hnsw (embedding vector_cosine_ops)
```

---

## 3. Powierzchnia RPC

Wszystkie `SECURITY DEFINER`, `SET search_path = public`, `REVOKE … FROM PUBLIC, anon`,
`GRANT … TO authenticated` (poza odczytami klubów `public`, które dostaje też `anon`).

**Odczyt:** `club_list` · `club_view(slug)` · `club_threads_list(club_id, sort, filter, cursor)` ·
`club_thread_view(thread_id)` · `club_members_list(club_id)` · `club_my_memberships` ·
`club_reactions_for(target_ids[])` (batch — nigdy N+1) · `club_search(q, club_id?)` ·
`club_semantic_search(q)` · `club_unread_counts`

**Zapis — członkostwo:** `club_join` · `club_request_join` · `club_leave` · `club_invite` ·
`club_respond_invitation` · `club_set_notify_level` · `club_accept_rules`

**Zapis — treść:** `club_create_thread` (idempotentne przez `command_idempotency`) ·
`club_edit_thread` (okno 15 min, potem `edited_at` widoczne) · `club_reply` ·
`club_edit_reply` · `club_react` / `club_unreact` · `club_set_stance` ·
`club_subscribe_thread` · `club_mark_read`

**Moderacja:** `club_moderate` (approve/hide/delete/lock/pin) · `club_resolve_thread` ·
`club_ban_member` · `club_set_role` · `club_moderator_reveal_author` (audytowane)

**Admin:** `admin_club_upsert` · `admin_club_stats` · `admin_club_moderation_queue`

Razem **≈32 RPC**. Dla porównania: sama sieć kontaktów ma dziś 128 funkcji domenowych,
więc to nie jest skok skali — to jeden moduł więcej w tej samej konwencji.

---

## 4. Interakcje

### 4.1 Kompozytor

Reużywa **w całości** istniejący `MentionTextarea` + `useMentionAutocomplete` +
`MentionSuggestionList`. Zero nowego kodu wzmianek po stronie klienta.

Rozszerzenia specyficzne dla klubu:

- przełącznik „opublikuj anonimowo" (tylko gdy `attribution_mode` na to pozwala),
- wybór rodzaju wątku (§1.3) z jednozdaniowym wyjaśnieniem, co dany rodzaj zmienia,
- selektor kotwicy z podpowiedziami z `eu_policy_items` / `posts` / `events`,
- podgląd Markdown (podzbiór: `**`, `*`, `` ` ``, listy, `>`, linki — **bez HTML**),
- licznik znaków i twardy limit z DB, nie z UI,
- autozapis wersji roboczej — reużywa `useAutosave` z edytora wpisów.

### 4.2 Reakcje: słownik zamknięty, nie emoji

**To jest świadome odejście od wzorca czatu** (`message_reactions.emoji` = dowolny string).
Powód: w czacie reakcja to ekspresja, w klubie dyskusyjnym reakcja to **dane**. Dowolne emoji
dają szum nieprzydatny ani do rankingu, ani do reputacji, ani do mapy stanowisk.

Sześć rodzajów w dwóch rozłącznych grupach:

| Grupa          | Rodzaj       | Znaczenie          | Wielokrotny?           |
| -------------- | ------------ | ------------------ | ---------------------- |
| **jakość**     | `insightful` | wnosi wiedzę       | ✅ niezależny          |
|                | `evidence`   | poparte źródłem    | ✅ niezależny          |
|                | `question`   | wymaga wyjaśnienia | ✅ niezależny          |
|                | `thanks`     | podziękowanie      | ✅ niezależny          |
| **stanowisko** | `agree`      | zgadzam się        | ⛔ wyklucza `disagree` |
|                | `disagree`   | nie zgadzam się    | ⛔ wyklucza `agree`    |

Rozłączność grupy „stanowisko" egzekwuje trigger `club_reactions_stance_exclusive`, nie
klient — `UNIQUE (target, user, kind)` sam z siebie pozwoliłby na `agree` **i** `disagree`
naraz od tej samej osoby.

Zwrot z tej decyzji jest potrójny: `insightful` + `evidence` zasilają ranking i reputację,
`agree`/`disagree` dają **mapę stanowisk wątku** bez ankiety, a `question` jest sygnałem dla
autora, że coś wymaga doprecyzowania — czyli reakcją, która realnie coś zmienia.

Reakcje odczytujemy **wsadowo** (`club_reactions_for(target_ids[])`) dla całej widocznej
partii, dokładnie jak `useBadgesForUsers` i `useConnectionStatuses` na `/people`.

### 4.3 Wzmianki

Backend **już to potrafi**. `process_mentions(p_tenant_id, p_source_type, p_source_id,
p_body, p_actor_id, p_kind, p_href)` jest generyczny i obsługuje dziś `comments`,
`messages`, `crm_lead_notes`. Discussion Club dokłada dwa typy źródła: `club_thread`
i `club_reply` — i dostaje za darmo:

- parsowanie `@slug` **po stronie bazy** tym samym wzorcem, co renderuje frontend
  (`lib/mentions/parse.ts`) — więc nie ma rozjazdu „widzę link, ale nikt nie dostał
  powiadomienia",
- krawędź `mention` w `cross_references`,
- `enqueue_notification` z poszanowaniem preferencji odbiorcy,
- zdarzenie `mention.created.v1` na szynie.

Trzy reguły specyficzne dla klubu, których generyczny procesor nie zna i które trzeba dodać
w wywołującym triggerze:

1. wzmianka osoby **spoza klubu** w klubie `private`/`secret` **nie** wysyła powiadomienia
   (ujawniałaby istnienie klubu i jego treść) — zamiast tego UI proponuje zaproszenie,
2. w trybie `chatham` wzmianka jest dozwolona, ale powiadomienie nie zdradza autora,
3. limit 10 wzmianek na post — antyspam, egzekwowany w DB.

### 4.4 Wyświetlanie odpowiedzi

**Drzewo przycięte do 2 poziomów** — reużywa dokładnie logikę `lib/comments/tree.ts`
(`buildCommentTree`, `MAX_COMMENT_DEPTH`, `canReplyToComment`), gdzie limit trzyma
i trigger DB, i składanie drzewa. Uzasadnienie: deliberacja potrzebuje wątków pobocznych,
ale głębokie zagnieżdżenie zabija czytelność i mobilny layout. Odpowiedź na poziomie 2
renderuje się jako „@ktoś" w treści, nie jako trzecie piętro.

Sortowanie odpowiedzi: `chronological` (domyślne — deliberacja to sekwencja),
`best` (po `insightful`), `stance` (grupowane wg `agree`/`disagree` — mapa sporu).

---

## 5. Sposób wyświetlania

### 5.1 Architektura informacji

```
/club                        indeks: moje kluby · odkryj · zaproszenia
/club/$slug                  dom klubu: lista wątków (domyślnie)
/club/$slug/about            zasady, prowadzący, statystyki
/club/$slug/members          członkowie (respektuje discoverable)
/club/$slug/t/$threadSlug    wątek
/admin/community/clubs       zarządzanie + kolejka moderacji
```

`noindex` dla wszystkiego poza klubami `public` — ta sama doktryna, co `/people` i `/network`.
Klub `public` jest indeksowalny i staje się realnym lejkiem pozyskania (jedyna powierzchnia
w module, która dowozi ruch z wyszukiwarek).

### 5.2 Widok listy wątków

Wiersz wątku niesie **dziewięć** sygnałów, wszystkie z jednego zapytania dzięki denormalizacji:
rodzaj (chip), tytuł, autor (lub alias), kotwica (chip dossier/wpis), liczba odpowiedzi,
liczba uczestników, `insightful`, czas ostatniej odpowiedzi, znacznik nieprzeczytanego.

Sorty: `hot` (domyślny) · `new` · `unanswered` · `top` (30 dni) · `mine` · `subscribed`.
Filtry: rodzaj, obszar polityki, kotwica, status, „tylko nieprzeczytane".

**`unanswered` jest celowo wyeksponowany.** Wątek bez odpowiedzi to porażka klubu, a nie
neutralny stan — im łatwiej go znaleźć, tym rzadziej się zdarza.

### 5.3 Ranking `hotness`

```
hotness = (insightful*3 + evidence*3 + replies*2 + participants*2 + stances)
          / pow(hours_since_created + 2, 1.5)
```

Trzy świadome decyzje: **jakość waży więcej niż objętość** (`insightful` ×3 vs `replies` ×2),
**liczba uczestników waży tyle co odpowiedzi** (dziesięć odpowiedzi od dwóch osób to kłótnia,
nie dyskusja), **`agree`/`disagree` nie podbijają** (inaczej ranking premiowałby polaryzację —
to jest ta jedna decyzja, którą warto obronić najmocniej).

Przeliczane triggerem na zmianę liczników **i** cyklicznie w `jobs-tick` (bo mianownik rośnie
z czasem sam z siebie). Kolumna, nie widok — lista wątków nie może liczyć potęg per wiersz.

### 5.4 Widok wątku

Nagłówek (tytuł, rodzaj, status, kotwica, przypięcie) → post otwierający (pełna szerokość,
autor z odznakami i poziomem reputacji) → pasek reakcji → dla `kind='question'` przypięta
odpowiedź rozstrzygająca, dla `kind='position'` mapa stanowisk → drzewo odpowiedzi →
sticky kompozytor.

Realtime: nowe odpowiedzi **nie wskakują** same do widoku. Pojawia się pasek
„3 nowe odpowiedzi — pokaż". Wstawianie treści pod kursorem czytającego to najczęstszy błąd
UX w tej klasie produktów; czat może sobie na to pozwolić, długa deliberacja nie.

### 5.5 Powierzchnie poza modułem

- **Karta dossier / wpis**: `ClubThreadsCard` — „dyskutowane w klubach" (przez `cross_references`),
- **Widgety buildera**: `club-card`, `club-threads` (rejestracja w `schema.ts` + `schemas.ts`
  - bramka wierności ustawień),
- **Wyszukiwarka globalna**: piąta zakładka `clubs` w `OVERLAY_TABS`,
- **Profil**: „aktywność w klubach" (respektuje anonimowość — posty z `chatham` nigdy),
- **Pasek mobilny**: licznik nieprzeczytanych.

---

## 6. Mechanizmy architektury

### 6.1 Szyna zdarzeń

Nowe typy do `DOMAIN_EVENT_TYPES` (`src/lib/realtime/domainEvents.ts`) — katalog jest
kontraktem pilnowanym testem kompletności:

```
club.created.v1 · club.updated.v1
club_member.joined.v1 · club_member.left.v1 · club_member.role_changed.v1
club_thread.created.v1 · club_thread.status_changed.v1 · club_thread.resolved.v1
club_reply.created.v1
club_stance.recorded.v1
```

**Reguła bezwzględna z `ARCHITECTURE.md` §5.1:** żadnego konsumenta bez wpisu
w `eventInvalidationMap.ts`. Emitery przez `emit_domain_event()`, nigdy z klienta.

Konsument odwrotny — `policy.updated.v1` budzi zakotwiczone wątki (§1.4) — realizuje
`workflow_definitions` (istniejący silnik: `trigger_event_type` + warunek `@>` + kroki),
więc **nie wymaga nowego kodu**, tylko nowego przepisu w `workflow_templates`.

### 6.2 Realtime

`useModuleRealtime("club")` — bez własnych kanałów. `tableChannelHub` zlicza referencje
per (schema, table, event, filter). Anonimowi nie trzymają websocketów (kwoty połączeń).
Debounce inwalidacji + wstrzymanie przy ukrytej karcie — jak wszędzie indziej.

### 6.3 Liczniki i idempotencja

- `user_pending_counters.club_unread` — triggery, nie `COUNT(*)`; `recompute_my_pending_counters()`
  naprawia dryf,
- `tenant_pending_counters.club_pending` — kolejka moderacji (badge w adminie),
- `club_create_thread` przez `withCommandIdempotency` (klucz generuje frontend per akcję) —
  podwójny klik nie tworzy dwóch wątków.

### 6.4 Powiadomienia

Nowy rodzaj wymaga **trzech** zmian, inaczej `enqueue_notification` cicho zwróci `NULL`:

1. `notifications_kind_check` — dopisać `'club'` (obecnie 12 rodzajów),
2. `notification_preferences.enabled_club boolean DEFAULT true`,
3. gałąź `WHEN 'club' THEN np.enabled_club` w `enqueue_notification`.

Zdarzenia powiadamiające: odpowiedź w moim wątku · odpowiedź w subskrybowanym · wzmianka ·
reakcja `insightful` na moim poście (progowana — nie po każdej) · zaproszenie · przyjęcie do
klubu · wątek rozstrzygnięty · dla moderatorów: coś czeka w kolejce.

Digest reużywa `dispatch.server.ts` — tygodniowe podsumowanie klubu jako jedna sekcja.

**Uwaga wiążąca z audytem:** to jest ta sama luka #7 („producenci powiadomień"). Discussion
Club musi wejść **z kompletem producentów od pierwszego dnia**, żeby nie powtórzyć wzorca
pięciu cichych funkcji.

### 6.5 Wyszukiwanie

- FTS: `search_vector` GENERATED z konfiguracją **`polish`** — nie `simple`. Wyszukiwarka
  wiadomości czatu ma tu otwarty dług od sześciu wydań („zero fleksji wbrew komentarzowi");
  nie powielamy go,
- `club_thread_embeddings` wpięte w istniejącą kolejkę indeksera (`embeddings.server.ts`,
  `jobs-tick`) — ten sam wzorzec, co `post_embeddings`, tylko druga tabela,
- `club_search` respektuje widoczność: wyniki z klubów `private`/`secret` **wyłącznie** dla
  członków. Filtr w RPC, przed rankingiem.

To jest moment, w którym moduł **spłaca lukę #1 z audytu**: treść klubowa jest gęsta,
członkowska i tematyczna — czyli dokładnie ten materiał, na którym wyszukiwanie semantyczne
daje przewagę, a którego dziś na platformie nie ma.

### 6.6 i18n

`src/lib/i18n-club.ts` (PL/EN), side-effect import w chunku trasy — **nie** w entry
(budżety bundla są dziś czerwone: +30,6 KB / +87,9 KB / +124,0 KB ponad próg).
Prefiks `club` do `GATED_PREFIXES` bramki parytetu **i** do bramki użycia kluczy
(`i18nKeyUsage.ts`) — żaden `t()` w module nie może polegać na `defaultValue`.
Formy mnogie PL w pełnym zestawie `_one/_few/_many/_other` dla wszystkiego z `count`.

### 6.7 Wydajność i chunking

Cały moduł za `lazy()`, własny chunk trasy. `check:chunks` (graf acykliczny, Tarjan)
i `check:entry-purity` są blokujące — moduł nie może wciągnąć się do entry przez
przypadkowy import (dokładnie ta pułapka, w którą wpadł `modulesSettings.ts`, przez co
trzeba go było wydzielić z `lib/admin/community.ts`).

Lista wątków: kursor `(hotness, id)` albo `(last_reply_at, id)` — **zawsze z tiebreakerem
`id`**. Czat ma tu otwartą pozycję („kursor paginacji bez tiebreakera") — nie powielamy.

---

## 7. Bezpieczeństwo, prywatność, RODO

**Izolacja tenanta** — `tenant_id` pinowany triggerem z profilu autora; obie strony każdej
relacji w tym samym tenancie. `check:sql-tenant-scope` (554 funkcje) jest blokujący.

**Macierz widoczności** — jedna funkcja `club_can_read(club_id, user_id)` jako **jedyne**
źródło prawdy, wołana przez każdy RPC odczytowy. Rozjazd między kopiami tej reguły to
najbardziej prawdopodobny sposób, w jaki ten moduł mógłby wyciec.

**Antyspam** (w DB, nie w kliencie): 10 wątków / 24 h · 60 odpowiedzi / 24 h · 5 odpowiedzi /
min · 10 wzmianek / post · premoderacja poniżej progu reputacji.

**Blokady** — `user_blocks` działa też tu: zablokowany nie widzi moich postów, ja nie widzę
jego. Spójność między modułami jak `tg_user_blocks_sever_connection`.

**Zgłoszenia** — reużywa `report_user` + `admin_list_user_reports`. Wejście „Zgłoś" **musi**
być przy każdym poście od pierwszego dnia (w czacie brakuje go od sześciu wydań).

**RODO:**

- eksport — nowa sekcja w istniejącym eksporcie (dziś 17 sekcji),
- usunięcie konta — **anonimizacja autorstwa, nie kasowanie treści**: `author_id → NULL`,
  `subject_ref`, `anonymized_at` (wzorzec `payment_orders`). Dyskusja jest dorobkiem
  zbiorowym; kasowanie postów usuwającego konto rozbiłoby wątki innych osób. **To wymaga
  jawnej zgody w regulaminie klubu** — inaczej jest to przetwarzanie bez podstawy,
- Chatham House — retencja mapowania alias↔tożsamość wymaga **osobnej decyzji prawnej**
  (patrz §10).

---

## 8. Bramki CI

| Bramka                                                 | Co musi pokryć                                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pgTAP                                                  | macierz widoczności (4 × 3 kombinacje) · redakcja `author_id` w `chatham` · rozłączność `agree`/`disagree` · limit głębokości · rate limity · izolacja tenanta · brak grantów klienta |
| `check:sql-tenant-scope`                               | wszystkie nowe RPC                                                                                                                                                                    |
| `check:sql-anon-insert`                                | brak ścieżki anonimowego zapisu                                                                                                                                                       |
| `check:sql-owner-tenant-scope`                         | polityki właściciela (ratchet nie może drgnąć)                                                                                                                                        |
| `check:i18n-parity` + key-usage                        | prefiks `club`, zero `defaultValue`                                                                                                                                                   |
| `check:bundle` / `check:chunks` / `check:entry-purity` | moduł poza entry                                                                                                                                                                      |
| `check:widget-fidelity`                                | jeśli dochodzą widgety buildera                                                                                                                                                       |
| vitest                                                 | drzewo odpowiedzi, `hotness`, macierz uprawnień, alias Chatham (czyste funkcje)                                                                                                       |

Progi pokrycia dla nowego katalogu **od razu wysokie** — `src/components/network` przeszło
drogę od 4,64% do 99% dopiero po fakcie; nowy moduł nie powinien jej powtarzać.

---

## 9. Etapy wdrożenia

**E1 — Szkielet (wartość: klub istnieje).** `clubs`, `club_members`, `club_threads`,
`club_replies` + RPC odczytu/zapisu + `/club`, `/club/$slug`, `/club/$slug/t/$slug` +
i18n + pgTAP widoczności. Bez reakcji, bez anonimowości, bez rankingu (sort `new`).
_To jest najmniejszy zestaw, który daje działający produkt._

**E2 — Interakcja.** Reakcje (§4.2) + wzmianki (`process_mentions`) + subskrypcje +
powiadomienia z **kompletem** producentów + liczniki nieprzeczytanych.

**E3 — Deliberacja.** Rodzaje wątków, `resolved_reply_id`, `club_stances`, `hotness`,
kotwiczenie w `cross_references`, karta na dossier.

**E4 — Zaufanie i skala.** Chatham House, moderacja (tryby, kolejka, log), rate limity,
role, bany, `report_user`.

**E5 — Odkrywalność.** FTS `polish`, embeddingi, zakładka w wyszukiwarce, widgety buildera,
digest, workflow `policy.updated.v1` → budzenie wątków.

Kolejność jest wymuszona zależnościami: E4 przed publicznym otwarciem klubów `open`
(bez rate limitów i moderacji to zaproszenie do spamu), E5 dopiero gdy jest co indeksować.

---

## 10. Decyzje, których nie podejmę za Ciebie

Cztery pytania, gdzie różne odpowiedzi dają **różny moduł**, nie różny szczegół:

1. **Chatham House — czy w ogóle?** Daje przewagę w rozmowie o polityce publicznej
   i jest głównym wyróżnikiem tego projektu. Kosztuje: retencja mapowania alias↔tożsamość,
   ryzyko nadużyć pod osłoną, konieczność audytowanego ujawnienia dla moderatora.
   **Wymaga decyzji prawnej przed E4, nie w trakcie.**

2. **Kto zakłada kluby?** Tylko redakcja (kontrola jakości, wolny wzrost) czy członkowie od
   poziomu `voice`/150 pkt (organiczny wzrost, ryzyko rozproszenia). Moja rekomendacja:
   **redakcja w E1–E4, próg reputacyjny od E5** — gdy moderacja jest już gotowa.

3. **Czy usunięcie konta kasuje posty?** Rekomenduję anonimizację (§7), ale to musi wejść
   do regulaminu klubu **przed** pierwszym postem, nie po.

4. **Czy klub jest produktem płatnym?** `min_tier_rank` jest w modelu od początku, więc
   technicznie tak. Ale klub premium bez masy krytycznej jest pusty, a pusty klub jest
   gorszy niż brak klubu. Rekomendacja: **wszystkie kluby otwarte dla zalogowanych do
   czasu, aż któryś ma 50+ aktywnych członków.**

---

## 11. Co ten moduł zmienia poza sobą

| Luka z audytu 07.08               | Jak Discussion Club ją domyka                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **#8** trwałe kręgi tematyczne    | **całkowicie** — to jest ten moduł                                                                                         |
| **#17** kanał aktywności członków | **całkowicie**, i to w formie mniej ryzykownej niż otwarty feed: treść ma kontekst, właściciela i moderację                |
| **#1** semantyka na ludziach      | **częściowo** — `club_thread_embeddings` dokłada drugą tabelę do gotowej infrastruktury i uczy tego wzorca przed profilami |
| **#2** sygnały intencji           | **częściowo** — członkostwo w klubie _jest_ deklaracją zainteresowania, mocniejszą niż pole w profilu                      |
| **#5** pętla zwrotna sugestii     | **zasila** — wspólny klub to sygnał rankingu mocniejszy niż wspólne wydarzenie                                             |
| **#7** ciche funkcje              | **nie powiela** — komplet producentów w E2                                                                                 |

Klub jest jedyną pozycją z listy siedemnastu, która domyka **dwie** luki w całości i zasila
cztery kolejne — i dlatego, mimo że jest największym pojedynczym przedsięwzięciem z tej listy,
broni się jako następny krok.
