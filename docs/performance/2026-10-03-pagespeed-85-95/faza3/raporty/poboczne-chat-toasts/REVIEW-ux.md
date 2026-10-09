# Recenzja UX/poprawności: toasty nowych wiadomości czatu

Gałąź `feat/w3-chat-toasts`, commit `a425f807`, baza `claude/zen-ritchie-hzur21`.
Soczewka: poprawność i UX. Recenzja tylko do odczytu. Sondy uruchamiałem w osobnej kopii `git archive` w scratchpadzie. Kopię
usunąłem, a plik sondy zostaje obok: `REVIEW-ux.probe.test.tsx`.

## Werdykt: **fix_required**

Montaż w `WorkspaceDock` jest właściwym miejscem i co do zasady działa. Toast pojawia się dla rozmowy, która nie jest otwarta,
nie pojawia się dla własnych wiadomości, a w obrębie karty nie ma duplikatów. Przywracanie zminimalizowanej rozmowy idzie
przez API magazynu sesji. Testy łapią cofnięcie zmian. Włączenie haka dla wszystkich zalogowanych odsłania jednak wyciek
treści prywatnych rozmów do personelu (blokujące) i dwa naruszenia preferencji i sesji (major).

## Bramki uruchomione przeze mnie

- `light.sh bunx vitest run` na 4 dotkniętych plikach testów: 4/4 plików, 86/86 testów zielonych.
- To samo dla sąsiednich zestawów: `SiteChrome`, `MinimizedChats`, `ChatBell`, `useConversations`, `src/lib/realtime`.
  Wynik: 17 plików, 289 zielonych i 1 „expected fail”.
- `light.sh bunx eslint` na 6 dotkniętych plikach: exit 0.
- Mutacje w kopii, wszystkie wykryte:
  - bez montażu w doku: 9/10 testów integracyjnych czerwonych;
  - bez `restore` w obsłudze szyny: 2 czerwone;
  - stała nazwa kanału w hubie: test ponownego montażu czerwony;
  - bez strażnika po odczytach: 2 czerwone.

---

## Ustalenia

### 1. [BLOCKING] Personel (admin, super_admin, **editor**) dostaje toasty z treścią CUDZYCH prywatnych rozmów

**Gdzie:**

- `src/lib/chat/useIncomingChatToasts.ts:124-158`: `handleInsert` nie sprawdza członkostwa.
- `:85-101`: brak wiersza uczestnika daje `data: null`, a stąd „nie wyciszona”.
- `:1-3`: komentarz twierdzi, że „RLS przepuszcza tylko rozmowy, w których jest uczestnikiem”. To nieprawda.

**Dowód:**

- `supabase/migrations/20260713200000_chat_admin_tenant_scope_fix.sql:38-48`: polityka `messages_staff_read` daje
  SELECT na **wszystkie** wiersze `messages` tenanta rolom `admin`, `super_admin` i `editor`. Polityki są permisywne,
  więc sumują się z `messages_member_select`.
- Polityka jest aktywna. Kontrakt `src/lib/ci/__tests__/chatPolicyContract.test.ts:89-97` asertuje jej obecność, a późniejszej
  migracji, która by ją zdejmowała, nie ma.
- Realtime `postgres_changes` filtruje zdarzenia przez RLS z JWT subskrybenta. `current_tenant_id()` czyta `auth.uid()`
  (`20260626180412_…sql`), więc działa także w kontekście Realtime.
- Kanał `messages INSERT sender_id=neq.<uid>` doręcza więc redaktorowi KAŻDĄ wiadomość w tenancie.
- Sonda (`REVIEW-ux.probe.test.tsx`, przypadek 1): przy `conversation_participants` zwracającym `null` (nie-członek) powstaje
  toast `{"title":"Zofia Testowa","description":"prywatna treść","action":"Otwórz"}`.

**Skutek:**

- Podgląd prywatnych DM-ów członków ląduje na ekranie redaktora lub admina w trakcie zwykłego przeglądania serwisu. Wystarczy
  udostępniony ekran, prezentacja albo ktoś zaglądający przez ramię.
- Do tego zalew toastów i po jednym `get_chat_peers` RPC na nadawcę.
- „Otwórz” otwiera skrzynkę na rozmowie, której ta osoba nie jest członkiem.
- Przed zmianą hak się nie montował, więc wycieku nie było. Ta zmiana go uruchamia.

**Poprawka:**

- W `handleInsert` przed dispatchem `INCOMING_EVENT` i przed toastem sprawdź członkostwo.
- Najtaniej rozszerzyć istniejący odczyt `conversation_participants` (ten sam select, `eq(user_id, uid)`) do stanu
  trójwartościowego, np. `{ member: boolean; until: number | null }`. Brak wiersza oznacza `member: false`: wtedy cisza i wpis
  w `muteCache`, żeby personel nie pytał bazy przy każdej wiadomości.
- Przy błędzie odczytu nie pokazuj toasta (fail-closed). Obecny test „błąd odczytu wyciszenia NIE ucisza rozmowy (fail-open)”
  trzeba odwrócić albo ograniczyć do rozmów znanych z cache listy rozmów: prywatność ma pierwszeństwo przed brakiem jednego
  toasta.
- Popraw komentarz w nagłówku.
- Dodaj test w haku (nie-członek, czyli `ok(null)`: zero toastów i zero RPC) oraz w `WorkspaceDock.incomingToasts.test.tsx`.

### 2. [MAJOR] Toast ignoruje preferencje „Wiadomości na czacie” i tryb cichy

**Gdzie:** `src/components/dock/WorkspaceDock.tsx:161-162` (bramka to tylko `chat_enabled`) i
`src/lib/chat/useIncomingChatToasts.ts:138-145` (wyłącznie `muted_until` rozmowy).

**Dowód:**

- Serwerowy fan-out powiadomień (`supabase/migrations/20260713100000_chat_improvements_round3.sql:108-117`) doręcza tylko przy
  `muted_until` nieaktywnym **oraz** `COALESCE(np.enabled_message, true) = true`.
- Użytkownik, który w „Typy powiadomień” wyłączył „Wiadomości na czacie” (`src/lib/locale/pl.ts:2142`,
  `preferences.ts:76`), nie dostanie wpisu w dzwonku, pusha ani maila, a toast dostanie przy każdej wiadomości.
- Tryb cichy (`allow_messages_from = 'nobody'`): UI obiecuje, że „«Nikt» dodatkowo wycisza wiadomości przychodzące także
  w istniejących wątkach” (`src/lib/i18n-chat.ts:494`, EN `:974`). Migracja `20260713200000…sql:515-521` mówi, że w kręgu
  „tryb cichy ma wyciszać powiadomienia adresata”. W kręgach wiadomości przechodzą, a toast się pojawia.

**Poprawka:**

- W `WorkspaceDock` odczytaj `useNotificationPreferences()`. Ten sam klucz cache czyta już `NotificationsBell` w nagłówku,
  więc w praktyce nie ma dodatkowego żądania.
- Przekaż do haka:
  `useIncomingChatToasts(chatEnabled && prefs?.enabled_message !== false && prefs?.allow_messages_from !== "nobody")`.
- Do czasu załadowania zostaje `true`, jak przy innych flagach. Wyłączenie zwalnia kanał, co już działa.
- Dodaj test integracyjny z zasianym `prefsKey(uid)`.

### 3. [MAJOR] Toasty przeżywają sesję: po wylogowaniu w innej karcie pokazują treść poprzedniego konta

**Gdzie:** `src/lib/chat/useIncomingChatToasts.ts:174-182`: `release()` nie zdejmuje utworzonych toastów. `:150-158`: toast nie
ma `id`, więc nie da się go zdjąć.

**Dowód:**

- sonner 2.0.8 wstrzymuje licznik toastu, gdy karta jest ukryta (`node_modules/sonner/dist/index.mjs:667`:
  `if (expanded || interacting || isDocumentHidden) pauseTimer()`).
- Istniejący test „okno otwarte, ale karta w tle - toast MA się pokazać” celowo tworzy toasty w karcie w tle.
- Wylogowanie (`src/hooks/useAuth.tsx:527-557`) robi twardą nawigację wyłącznie w karcie, w której kliknięto „Wyloguj”.
  Komentarz tam deklaruje cel: „the next user (e.g. on a shared device) never sees the previous account's data”.
- Druga karta dostaje `SIGNED_OUT`, dok schodzi i woła `release()`, ale kolejka sonnera zostaje.
- Po powrocie do tej karty następna osoba widzi przez 6 s każdy podgląd wiadomości poprzedniego konta. Akcja „Otwórz” jest
  wtedy martwa, bo szyny nikt nie słucha.
- Nowy strażnik z `:145` blokuje tylko toasty jeszcze NIEUTWORZONE.

**Poprawka:**

- Nadaj toastom `id: \`chat-incoming:${row.conversation_id}\`` i trzymaj je w module (`Set`). Usuwaj wpis w `onAutoClose`i`onDismiss`.
- W `release()` przy zamknięciu kanału (licznik 0) wołaj `toast.dismiss(id)` dla każdego wpisu. Zmiana `uid` w `acquire()`
  też idzie przez `release()`.
- Dodaj test: toast powstał, unmount, czyli `toast.dismiss` wywołane z tym `id`. Atrapa sonnera potrzebuje `dismiss`.

### 4. [MINOR] Brak scalania per rozmowa: seria wiadomości daje stos toastów, a karta w tle daje stare toasty

**Gdzie:** `useIncomingChatToasts.ts:150-158`.

**Dowód:**

- Sonda, przypadek 2: 3 wiadomości z jednej rozmowy dają 3 osobne toasty, wszystkie z `id: null`. Krótkie serie wiadomości
  to norma na czacie.
- W karcie ukrytej (timery wstrzymane, patrz pkt 3) po godzinie wraca cały zaległy stos, często już przeczytany w innej
  karcie.
- Każda karta ma osobny kanał i osobne toasty. Implementer to opisał. Bez koordynacji kart da się to zaakceptować, ale tylko
  przy scalaniu.

**Poprawka:**

- To samo `id` per rozmowa co w pkt 3: sonner podmienia toast w miejscu, więc zostaje ostatnia wiadomość, opcjonalnie
  z licznikiem „(3)”.
- Zdejmuj toast danej rozmowy, gdy szyna ją otwiera (`openChatWindow` z toasta, „Napisz”, pigułka).
- Opcjonalnie: `BroadcastChannel` z roszczeniem `message.id` między kartami.

### 5. [MINOR] Toast zasłania pasek doku, dymki zminimalizowanych rozmów i kompozytor na telefonie

**Gdzie:** `src/components/ui/sonner.tsx` i `src/routes/__root.tsx:1292`: `<Toaster/>` bez `offset` i `mobileOffset`. Tych
plików diff nie dotyka, ale kłopot ujawnia częsty, niezamówiony toast czatu.

**Dowód:**

- sonner stawia toast 24 px nad dołem na desktopie i 16 px na mobile, na całej szerokości
  (`dist/index.mjs:466-468`, `dist/styles.css:430-452`).
- Pasek doku jest `fixed bottom-0`, ma ~40 px plus safe-area (`WorkspaceDock.tsx:419-431`).
- Dymki zminimalizowanych rozmów są `bottom-full mb-2` nad paskiem (`MinimizedChats.tsx:79-81`).
- W skrzynce na telefonie kompozytor stoi tuż nad paskiem.
- Każda nowa wiadomość przykrywa na 6 s zakładkę „Czaty”, dymki i pole pisania w innej rozmowie.
- `src/styles.css:7068-7075` wprost wymaga, by nowe powierzchnie przypięte do dołu korzystały z `--mbb-reserve`.

**Poprawka:**
`<Toaster offset={{ bottom: "calc(var(--mbb-reserve, 0px) + 16px)" }} mobileOffset={{ bottom: "calc(var(--mbb-reserve, 0px) + 8px)" }} />`.
sonner przyjmuje stringi z `calc`. Gość ma `--mbb-reserve` niezdefiniowane, czyli 0.

### 6. [MINOR] Podpis załącznika nie jest przycinany: toast może mieć ~2000 znaków

**Gdzie:** `useIncomingChatToasts.ts:103-110`. Gałąź `attach && text` zwraca całość, a limit 140 obowiązuje tylko dla samego
tekstu.

**Dowód:** DB dopuszcza podpis do 2000 znaków (`20260713100000…sql:40-48`). Sonda, przypadek 3: `description.length = 2010`.
Toast zasłania wtedy pół ekranu.

**Poprawka:** przytnij wynik końcowy, np. wspólną funkcją `clip(…, 140)` dla obu gałęzi. Dodaj test.

### 7. [MINOR] „Otwórz” na `/messages` otwiera skrzynkę doku NAD stroną rozmów

**Gdzie:** `WorkspaceDock.tsx:173-188`. Szyny słucha tylko dok (`grep onOpenChatWindow`).

**Dowód:** na `/messages` z otwartą rozmową B „Otwórz” dla A daje dwa okna czatu naraz: stronę z B i szufladę z A. Każde
ma własne kanały pisania i odczytu. Trasa obsługuje `?c=<id>` (`src/routes/messages.tsx:70-71`).

**Poprawka:** w obsłudze szyny, gdy `pathname` to `/messages` lub `/en/messages`, nawiguj do `?c=<id>` zamiast otwierać
skrzynkę. Druga możliwość: trasa sama słucha szyny i woła `preventDefault`.

### 8. [MINOR] a11y i i18n treści toasta

- Akcja ma etykietę samo „Otwórz” / „Open”, bez dopełnienia. Lepiej „Otwórz rozmowę” / „Open conversation” (nowy klucz
  w `i18n-chat`).
- W kręgu tytuł to sam nadawca, bez nazwy kręgu. Odbiorca nie wie, gdzie odpisać. Pseudonimy rozmów
  (`useNicknames`) są pomijane, więc nazwa różni się od tej na liście.
- Spoza diffu: region sonnera ma etykietę „Notifications alt+T” po angielsku także dla PL (`<Toaster>` bez
  `containerAriaLabel`). Toasty czatu będą odtąd najczęstszym ogłoszeniem w tym regionie.

### 9. [MINOR, poza diffem, następne zadanie] Push i toast podwójnie dla tej samej wiadomości

`public/push-sw.js:15-38` zawsze woła `showNotification`, także przy skupionym oknie. Z włączonym pushem członek dostaje
przy każdej wiadomości systemowe powiadomienie i toast. Poprawka w SW: dla `kind = message` pomiń `showNotification`, gdy
`clients.matchAll({type:"window"})` ma klienta `focused`. Chrome na to pozwala przy skupionym kliencie.

### 10. [NIT] Testy

- Kontrola nie-członka (pkt 1), preferencji (pkt 2) i zdejmowania toastów przy `release` (pkt 3) nie ma w testach.
- `vi.restoreAllMocks()` w ciałach testów (`useIncomingChatToasts.test.tsx`, przypadki wyciszenia i fokusu) zamiast
  w `afterEach`. Wzorzec zastany, ale nowy test spóźnionego otwarcia go powiela: przy porażce asercji szpieg `hasFocus`
  przecieka do kolejnych przypadków.
- `src/lib/notify.ts:20-24`: komentarz o braku replay w sonnerze jest nieaktualny. sonner 2.0.8 odtwarza aktywne toasty
  (`dist/index.mjs:139-144`). Implementer to zauważył, ale komentarza nie poprawił.

---

## Co sprawdziłem i jest poprawne

- **Toast dla rozmowy nieotwartej:** tak. „Otwarta” to znacznik `data-active-conversation` (`ChatWindow.tsx:681, 702`),
  który renderują i skrzynka doku, i `/messages`. Zminimalizowana rozmowa nie ma zamontowanego okna, więc dostaje toast.
- **Nigdy dla własnych:** filtr kanału `sender_id=neq.<uid>` plus kontrola `row.sender_id === uid`. Test integracyjny jest.
- **Jedna subskrypcja w karcie:**
  - licznik referencji haka i hubu, `seenIds`;
  - StrictMode zostawia jeden kanał, nawigacja i przejście przez `ownChrome` nie przemontowują doku (`SiteChrome.tsx:136-156`);
  - ponowny montaż przed potwierdzeniem `leave` naprawiony losowym sufiksem hubu (mutacja potwierdza test);
  - stary kanał hubu po `unsubscribe` ma pusty zbiór handlerów, więc nie ma podwójnego doręczenia.
- **Zmiana konta, wylogowanie, moduł wyłączony:** cleanup efektu wywołuje `release()`, czyli kanał zamknięty i `seenIds` oraz
  `muteCache` wyczyszczone. Strażnik `subscribedUid !== uid` po odczytach poprawnie odcina spóźniony toast innej sesji
  (z wyjątkiem pkt 3).
- **Wyścig „rozmowa otwarta w trakcie odczytów”:** druga kontrola `isConversationFocused` po `await`. Poprawne, testowane.
- **Przywracanie przez magazyn sesji (AGENTS.md):**
  - `minimizedChatsStore.restore(id)` zdejmuje pigułkę i ustawia `requested`;
  - skrzynka konsumuje `requested` (`ChatSideDrawer.tsx:174-181`) i `openRequest` (`:137-141`); oba ustawiają ten sam
    `selected`, więc są idempotentne, a `requested` nie zostaje wiszące, bo `dispatch open` zawsze montuje skrzynkę;
  - limit 3 dymków na mobile i pigułek na desktopie dalej pochodzi z jednego magazynu, a obie szyny rysują ten sam stan
    (test asertuje rząd mobilny).
- **i18n PL/EN:** klucze `chat.incoming.someone/open/emptyBody`, `chat.photo`, `chat.file` i `chat.voice.message` są
  w obu językach (`i18n-chat.ts:80-81, 119-125, 133-134, 584-585, 617-623, 631-632`).
- **Toaster leniwy:** sonner 2.0.8 odtwarza aktywne toasty przy subskrypcji (`dist/index.mjs:139-144`), więc toast sprzed
  montażu `<Toaster/>` się nie gubi.
- **Region `aria-live="polite"`:** przyciski fokusowalne przez `alt+T`, a timer pauzuje się na hover i interakcję.
- **Wyciszenie rozmowy:** respektowane, `invalidateMuteCache` działa natychmiast w tej samej karcie. Wyciszenie
  z innej karty lub urządzenia działa po TTL 60 s. Zastane i do przyjęcia.
