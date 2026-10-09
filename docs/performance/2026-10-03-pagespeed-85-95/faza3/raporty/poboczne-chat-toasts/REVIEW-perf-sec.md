# Recenzja: toasty czatu (wydajność, bezpieczeństwo, granice)

Gałąź `feat/w3-chat-toasts`, commit `a425f807`, baza `claude/zen-ritchie-hzur21` (`56da8d23`).
Worktree: `scratchpad/wt3/chat-toasts`. Recenzja wyłącznie do odczytu: nic nie edytowałem, nie commitowałem i nie budowałem.

## Werdykt: **fix_required**

Granica bootu jest czysta. Z grafu chunków wynika przyrost domknięcia bootu o 0 B. Cykl życia kanału też jest poprawny:
jeden kanał na kartę, refcount przez hub, brak wycieku przy odmontowaniu i wylogowaniu. Montaż jednak włącza funkcję,
która **pokazuje personelowi (admin, super_admin, editor) toasty z treścią cudzych prywatnych rozmów**. RLS na
`messages` przepuszcza personelowi wszystkie wiadomości tenanta, a hak nie sprawdza członkostwa (B1). Do tego dochodzi
subskrypcja praktycznie bez filtra, która skaluje się na serwerze Realtime jak O(zalogowane karty × wiadomości) (M1).

---

## 1. Metoda

- Przeczytany diff (6 plików) i kod, na którym się opiera: `tableChannelHub.ts`, `useConversations.ts`,
  `useMessages.ts`, `minimizedChats.ts`, `ChatSideDrawer.tsx`, `SiteChrome.tsx`, `__root.tsx`, `notify.ts`,
  `useSiteSetting.ts`.
- Przeczytane migracje RLS dla `messages`, `conversation_participants`, `get_chat_peers` oraz trigger
  `messages_after_insert` i publikacja `supabase_realtime`.
- Graf chunków odczytany z istniejącego buildu bazy `scratchpad/base-w3b` (`63a05a32`; `git diff 63a05a32 56da8d23 -- src`
  jest pusty, więc to ten sam kod aplikacji). Źródła: `reports/chunk-inventory.json`, pliki `.output/public/assets`
  i manifest serwera `_tanstack-start-manifest_v-*.mjs`. Domknięcie bootu policzyłem tym samym algorytmem co
  `staticClosure()` z `scripts/performance/documentWeight.ts` (skrypt: `scratchpad/review-perf-sec/closure.mjs`).
- Rozmiar modułu haka po zmianie oszacowałem przez `esbuild --minify` samego pliku. Pełnego buildu nie robiłem.
- Bramki lekkie (przez `light.sh`):
  - `bunx vitest run` na `useIncomingChatToasts.test.tsx`, `WorkspaceDock.incomingToasts.test.tsx`,
    `WorkspaceDock.test.tsx`, `WorkspaceDock.ssr.test.tsx` i `src/lib/realtime`: **17 plików, 270 zielonych,
    1 „expected fail”** (zastany `it.fails`).
  - `bunx eslint` na 6 dotkniętych plikach: **exit 0**.

---

## 2. Granica bootu i chunków: OK (dowód)

**Wejście.** `nesBootManifest.entry = /assets/index-c_XR_U82.js`. Statyczne domknięcie ma 10 plików:
`index`, `vendor-react`, `vendor-tanstack`, `dynamic-icon`, `vendor-i18n`, `vendor-zod`, `vendor-lucide-boot`,
`vendor-radix-boot`, `vendor-supabase` i `vendor-tw-merge`, razem 1 636 946 B raw. Lista jest identyczna z `rootPreloads`.

**Gdzie dziś leżą moduły dotknięte zmianą** (chunk-inventory bazy):

| Moduł                                                                                     | Chunk                                            | W domknięciu bootu?                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| `lib/chat/useIncomingChatToasts.ts` (dziś 175 B renderu, sam `invalidateMuteCache`)       | `ChatUnreadBadge-ouJCqIGf.js`                    | nie                                |
| `lib/chat/chatDockBus.ts`, `lib/chat/useConversations.ts`                                 | `ChatUnreadBadge-ouJCqIGf.js`                    | nie                                |
| `lib/realtime/tableChannelHub.ts`                                                         | `expertRequestStatus-BmoHm0BA.js`                | nie                                |
| `lib/chat/minimizedChats.ts`, `components/dock/WorkspaceDock.tsx`                         | `DockEmptyState-DcczOBEr.js` (leniwy chunk doku) | nie                                |
| `sonner` + `components/ui/sonner.tsx`                                                     | `vendor-sonner-BA-3S3ka.js` (`manualChunks`)     | nie (pilnuje `check:entry-purity`) |
| `lib/community/useCommunityModules.ts` (122 B), `modulesSettings.ts`, `useSiteSetting.ts` | `index-c_XR_U82.js`                              | **tak, ale już dziś**              |

**Dlaczego przyrost bootu wynosi 0 B:**

1. **`useCommunityModules` już jest w wejściu i już jest z niego eksportowany.** W `index-c_XR_U82.js` jest
   `function Ehe(){return ro(Ole,jle)}` (`Ole="community_modules"`), a lista eksportów zawiera `Ehe as u`, bo używają go
   leniwe trasy. Nowy importer w doku nie dokłada więc do wejścia ani funkcji, ani wpisu eksportu.
2. **Przynależność modułów do chunków się nie zmienia.**
   - `WorkspaceDock` → `useIncomingChatToasts`: ten moduł był osiągalny z doku już przed zmianą
     (`MinimizedChats.tsx:23` → `useConversations.ts:21`).
   - Nowa krawędź `useIncomingChatToasts` → `tableChannelHub`: hub był osiągalny z tych samych wejść
     (`useConversations.ts:17`).
   - `minimizedChats` leży w tym samym chunku co dok.

   Zbiory zależnych wejść się nie zmieniają, więc podział na chunki Rollupa jest ten sam.

3. **Nie powstają nowe krawędzie między chunkami.** `ChatUnreadBadge-*` już dziś importuje `vendor-sonner-*`
   i `expertRequestStatus-*`, a `DockEmptyState-*` już importuje `ChatUnreadBadge-*`.
4. **Wejście nie rośnie przez zmianę hashy.** Wejście odwołuje się do chunku doku po nazwie w `__vite__mapDeps`
   (2 wystąpienia). Hash ma stałą długość, więc zmiana hasha nie zmienia liczby bajtów.
5. **Trasa `/` nie preloaduje żadnego z rosnących chunków.** Jej mapa preloadów to `index-C1jaK8Oa`, `blog.index`,
   `headings`, `Footnotes`, `PaginatedPostGrid`, `useInFeedAds`, `prepareContent` i `myEventsGrouping`. `ChatUnreadBadge-*`
   jest wyłącznie w preloadach `/messages`. `expertRequestStatus-*` jest w `/$`, ale jego treść się nie zmienia.

**Co realnie rośnie (tylko leniwie):**

- `ChatUnreadBadge-*`: z ok. 175 B renderu modułu do ok. 2,65 kB min (esbuild samego pliku), czyli ok. +2,4 kB raw
  i ok. +1 kB gzip.
- `DockEmptyState-*`: kilkaset bajtów.

**Ryzyko szczątkowe do sprawdzenia w Verify.** `experimentalMinChunkSize: 2048` (`vite.config.ts:342`) decyduje
o scalaniu małych chunków na podstawie szacowanych rozmiarów atomów. Zmienia się rozmiar jednego atomu w dużym chunku,
więc przesunięcie scalenia jest mało prawdopodobne, ale niewykluczone. To samo dotyczy nazwy chunku doku: gdyby Rollup
nazwał go inaczej, wejście zmieni się o kilka bajtów (2 odwołania). Zapas 155 B to pokrywa, ale **Verify musi
zmierzyć** `bootClosureRawBytes` (oczekiwane Δ = 0), `check:entry-purity` i `check-bundle-size`. Sumy `public`
i `overall` rosną o ok. 1 kB gzip.

**Goście, żądania, CLS: OK.**

- Dok jest leniwy za `!user` (`SiteChrome.tsx:87-92`), a efekt haka wychodzi na `!uid` (`useIncomingChatToasts.ts:194`).
  Test „gość: brak paska, zero kanałów, zero zapytań, zero RPC” to pilnuje.
- `useCommunityModules` czyta wspólne, zasiane zapytanie zbiorcze `site_settings` (`useSiteSetting.ts:21`), więc nie
  dokłada żądania.
- Websocket członka już istnieje (`AuthenticatedLiveSync` → `CohesionLiveSync`, `__root.tsx:213-222`). Zmiana dokłada
  jeden `phx_join` na istniejącym gnieździe.
- Toasty sonnera mają `position: fixed`. `restore()` zmienia pigułki w doku tylko po kliknięciu użytkownika
  (`hadRecentInput`). CLS = 0.

## 3. Cykl życia kanału: OK

- Klucz huba `public|messages|INSERT|sender_id=neq.<uid>` jest unikalny dla tej funkcji. Jest jeden montaż
  (`SiteChrome.tsx:90`, `grep <WorkspaceDock`), więc jeden kanał na kartę. Licznik modułu (`:161-182`) i licznik huba
  działają spójnie.
- StrictMode, ponowny montaż przed potwierdzeniem `leave` (losowy sufiks nazwy w hubie), wylogowanie (zejście doku
  i zmiana `uid` w zależnościach efektu) i przełączanie `enabled`: każde z nich zwalnia kanał, a strażnik
  `subscribedUid !== uid` (`:145`) gasi spóźnione toasty. `seenIds` jest ograniczone do 500, `muteCache` czyszczony
  w `release()`.
- Poza zakresem tej zmiany: wiele kart to wiele kanałów i toastów (ryzyko opisane w IMPL).

---

## 4. Ustalenia

### B1 — BLOKUJĄCE: personel dostaje toasty z treścią cudzych prywatnych rozmów

- **Gdzie:**
  - `src/lib/chat/useIncomingChatToasts.ts:166-170`: subskrypcja `messages` INSERT, `sender_id=neq.<uid>`.
  - `:124-158`: `handleInsert` bez sprawdzenia członkostwa.
  - `:85-101`: brak wiersza uczestnika jest traktowany jako „niewyciszone”.
  - `:136`: zdarzenie `nes:chat-incoming` leci przed jakąkolwiek bramką.
  - `:1-6`: komentarz twierdzi, że „RLS przepuszcza tylko rozmowy, w których jest uczestnikiem”.
  - Montaż: `src/components/dock/WorkspaceDock.tsx:161-162`.
- **Dowód:**
  - `supabase/migrations/20260713200000_chat_admin_tenant_scope_fix.sql:38-48`: polityka
    `messages_staff_read FOR SELECT TO authenticated USING (tenant_id = current_tenant_id() AND (has_role(admin) OR
has_role(super_admin) OR has_role(editor)))`. Polityki permisywne sumują się z `messages_member_select`
    (`20260712230000_chat_whatsapp_architecture.sql:156-170`).
  - `messages` jest w publikacji `supabase_realtime` (`20260710092631_…sql:50`).
  - Realtime `postgres_changes` autoryzuje każde zdarzenie zapytaniem SELECT w imieniu subskrybenta. Personel
    dostaje więc **każdy INSERT z każdej rozmowy tenanta**.
  - W haku `isMutedConversation` dla nie-uczestnika dostaje `data = null`, co daje `until = null`, czyli „niewyciszone”.
    `get_chat_peers` (`20260731213000_…sql`) zwraca kartę nadawcy, gdy jest `discoverable`. Wynik: toast „Imię
    Nazwisko” z podglądem do 140 znaków treści cudzej rozmowy prywatnej na ekranie redaktora lub admina, w dowolnym
    miejscu serwisu.
  - Przed zmianą hak nie był montowany, więc to **nowa ekspozycja** (RODO: minimalizacja danych). Uprawnienie
    moderacyjne do odczytu w panelu to nie to samo co pasywne wyświetlanie treści DM.
  - Akcja „Otwórz” prowadzi do rozmowy, której użytkownik nie jest uczestnikiem.
- **Poprawka (minimalna, przed scaleniem):**
  1. `isMutedConversation` zwraca trzy stany: `"not-member" | "muted" | "ok"`. Gdy `!error && data === null`,
     zwraca `"not-member"` i ten stan trafia do cache z tym samym TTL.
  2. `handleInsert` porzuca wiadomość, gdy stan to `"not-member"`.
  3. `window.dispatchEvent(INCOMING_EVENT)` przenieść **za** bramkę członkostwa, bo dzwonki też nie mogą reagować
     na cudze rozmowy.
  4. Poprawić komentarz `:1-6`.
  5. Test: INSERT z rozmowy, w której `conversation_participants` dla `uid` zwraca `null`. Oczekiwane: zero toastów,
     zero `get_chat_peers` i zero `nes:chat-incoming`.
- Docelowo B1 znika z konstrukcji przy M1.

### M1 — POWAŻNE: subskrypcja praktycznie bez filtra, czyli fan-out kontroli RLS na serwerze Realtime

- **Gdzie:** `src/lib/chat/useIncomingChatToasts.ts:167` (`filter: sender_id=neq.<uid>`), montowane na każdej
  stronie dla każdej karty członka (`WorkspaceDock.tsx:162`).
- **Dowód:**
  - Realtime (walrus, `realtime.apply_rls`) wykonuje osobne zapytanie RLS dla każdej subskrypcji, której filtr
    przepuszcza zmianę. Przetwarza WAL w jednym wątku, więc większa maszyna niewiele pomaga (dokumentacja Supabase,
    „Postgres Changes: performance”).
  - Filtr `neq` przepuszcza prawie każdą wiadomość, w każdym tenancie, bo tabela jest wspólna. Na każdy INSERT
    przypada więc (liczba zalogowanych kart członków we wszystkich tenantach − karty nadawcy) zapytań z polityką
    `messages_member_select` (`member_conversation_ids()` i podzapytanie `cleared_before`) oraz trzema `has_role()`
    z `messages_staff_read`.
  - Dotychczasowe subskrypcje `messages` w repo są wąskie: `conversation_id=eq.<id>` i tylko przy otwartym oknie
    (`src/lib/chat/useMessages.ts:535, 552, 571, 614, 626`).
  - Przy obecnej skali to zapewne pomijalne. To jednak jakościowa zmiana kosztu, który rośnie razem z liczbą
    zalogowanych użytkowników i ruchem czatu. Każda karta dostaje też pełne `body` każdej wiadomości z własnych rozmów,
    nawet gdy toast zostanie wyciszony.
- **Poprawka (zalecana):** źródłem toastów zrobić wiersz uczestnika, nie `messages`.
  1. `messages_after_insert` (`20260713100000_chat_improvements_round3.sql`) zwiększa `unread_count` wyłącznie
     odbiorcom w `conversation_participants`.
  2. Subskrybować dokładnie tę samą specyfikację, co `useChatListRealtime`
     (`{ table: "conversation_participants", filter: "user_id=eq.<uid>" }`, `useConversations.ts:556`). Hub współdzieli
     wtedy kanał, więc **dochodzi 0 nowych kanałów**, a RLS sprawdza się tylko dla subskrypcji właściciela wiersza.
  3. Nowa wiadomość = wzrost `unread_count` względem ostatnio widzianego (mapa per rozmowa). Aktualizacje „przeczytane”
     i „doręczone” pomijać.
  4. `muted_until` przychodzi w ładunku, więc zapytanie o wyciszenie znika.
  5. Podgląd i nadawcę pobrać jednym selectem `conversations(last_message_preview, last_message_sender,
last_message_kind)`, z RLS członka. Toast pomijać, gdy `last_message_sender === uid`.
- Ten kształt usuwa też B1 z konstrukcji.
- Jeśli właściciel świadomie zostaje przy `messages`, minimum to:
  - zapisać w komentarzu haka model kosztu i próg skali;
  - rozważyć `conversation_id=in.(<id-y z listy rozmów, ≤100>)`;
  - mieć poprawkę B1.

### m1 — DROBNE: brak deduplikacji odczytów w locie i brak negatywnego cache profili (N+1 przy serii)

- **Gdzie:** `useIncomingChatToasts.ts:85-101` (`isMutedConversation`) i `:112-122` (`resolvePeer`).
- **Dowód:**
  - Cache zapisuje się dopiero **po** odpowiedzi. Seria k wiadomości z jednej rozmowy w oknie RTT (wklejone akapity,
    aktywna grupa) daje k równoległych selectów `conversation_participants` i k RPC `get_chat_peers`.
  - Błąd albo pusty wynik RPC (np. nadawca nie-`discoverable` przy B1) nie jest cache'owany, więc RPC idzie przy
    każdej wiadomości.
- **Poprawka:**
  - Trzymać w mapach `Promise` zamiast wyniku: `inflightMute`, `inflightPeer`, zdejmowane po rozstrzygnięciu.
  - Cache'ować wynik negatywny (`null`) profilu z krótkim TTL.
  - Test: 3 INSERT-y tej samej rozmowy przed rozwiązaniem odczytów dają 1 select i 1 RPC.

### m2 — DROBNE: `peerCache` przeżywa koniec sesji

- **Gdzie:** `useIncomingChatToasts.ts:51` i `release()` `:174-182`. Czyszczone są `seenIds` i `muteCache`,
  ale nie `peerCache`.
- **Dowód:** karty profili pobrane z uprawnieniami użytkownika A (np. przez wspólną rozmowę, z polami
  `job_title`, `current_company`, `avatar_url`) zostają w pamięci karty. Użytkownik B, który zaloguje się w tej samej
  karcie (wspólne urządzenie, impersonacja: `ImpersonationBanner`), dostaje je bez kontroli `get_chat_peers`.
  Mapa nie ma też limitu.
- **Poprawka:** `peerCache.clear()` w `release()` (w tej samej gałęzi co `muteCache.clear()`) oraz test
  „A → wylogowanie → B: RPC idzie ponownie”.

### m3 — DROBNE: toasty kumulują się w ukrytej karcie

- **Gdzie:** `useIncomingChatToasts.ts:150-158`. Każda wiadomość to nowy toast bez `id`.
- **Dowód:**
  - sonner 2.0.8 wstrzymuje liczniki, gdy `document.hidden` (`node_modules/sonner/dist/index.mjs:115-123, 667`).
  - Renderuje też wszystkie toasty, a niewidoczne dostają tylko `data-visible=false` (`:509, 717`).
  - `isConversationFocused` dla ukrytej karty zwraca `false`, więc każda wiadomość z niewyciszonej, aktywnej grupy
    dokłada węzeł DOM i stan aż do powrotu do karty. Wzrost nie ma górnej granicy, a po powrocie wyskakuje stos toastów.
- **Poprawka:** `toast(name, { id: \`chat-incoming:${row.conversation_id}\`, … })`. Kolejna wiadomość tej rozmowy
podmienia toast, więc liczba toastów jest ograniczona liczbą rozmów. Opcjonalnie dodać licznik („3 nowe”) w opisie.
Test: 3 wiadomości jednej rozmowy dają 3 wywołania z tym samym `id`.

### m4 — DROBNE: kod toastów jedzie we współdzielonym chunku `ChatUnreadBadge-*`

- **Gdzie:** `src/lib/chat/useConversations.ts:21` importuje `invalidateMuteCache` z modułu haka, więc cały hak
  (po zmianie: `handleInsert`, `acquire`, `toast`, ok. +2,4 kB raw, ok. +1 kB gzip) ląduje w `ChatUnreadBadge-*`.
- **Dowód:** ten chunk importują statycznie także `ConnectButton-*`, `DirectMessageButton-*`, `ExpertRequestsInbox-*`,
  `GroupMemberPicker-*`, `club._clubSlug.t._threadSlug-*` i `messages-*` (chunk-inventory). Część z nich może pobrać
  także gość na trasach innych niż `/`. Nie dotyczy to `/` ani bootu, ale to kod, którego gość nigdy nie wykona.
- **Poprawka:** przenieść `muteCache` i `invalidateMuteCache` do nowego `src/lib/chat/muteCache.ts`. Importowałyby go
  `useConversations` i hak. Hak ma wtedy jedynego importera (`WorkspaceDock`), więc Rollup umieści go w leniwym chunku
  doku, tylko dla członków. Zero zmian zachowania.

### m5 — DROBNE: luka w testach regresji (perf i security)

Brakuje testów, które złapałyby ustalenia z tej recenzji:

- B1: nie-uczestnik (personel), czyli brak toasta, RPC i zdarzenia.
- m1: deduplikacja odczytów w locie.
- m2: czyszczenie `peerCache` przy zmianie sesji.
- m3: stałe `id` toasta per rozmowa.

Granicę bootu pilnuje dziś tylko `check:entry-purity`, i tylko dla sonnera (marker `data-sonner-toaster`). Dla
`tableChannelHub`, `useIncomingChatToasts` i `minimizedChats` nie ma strażnika. **Propozycja:** w
`scripts/check-entry-purity.ts` (albo w teście nad `reports/chunk-inventory.json`) asercja, że moduły
`src/lib/chat/*` i `src/lib/realtime/tableChannelHub.ts` nie należą do chunków domknięcia wejścia.

---

## 5. Lista kontrolna dla Verify (po poprawkach)

- `BUNDLE_INVENTORY=1 build:smoke`, potem `check-document-weight`: `bootClosureRawBytes` Δ = 0 B (zapas 155 B),
  `bootBurst*` bez zmian dla `/`.
- `check:entry-purity` zielone. `check-bundle-size`: przyrost tylko w chunkach doku / `ChatUnreadBadge` (albo tylko
  doku po m4), sumy `public`/`overall` mają mieścić się w progach.
- Diff `chunk-inventory.json` przed i po: zmienione mają być wyłącznie zawartości `ChatUnreadBadge-*` i `DockEmptyState-*`
  (plus hashe importerów), bez nowych chunków i bez przesunięć modułów do `index-*`.
- e2e seeded (dwa konteksty, jak proponuje IMPL), poszerzone o konto `admin@nes.local`: wiadomość między dwoma innymi
  członkami **nie** daje mu toasta.
