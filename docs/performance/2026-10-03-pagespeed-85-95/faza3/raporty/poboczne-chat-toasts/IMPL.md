# Toasty nowych wiadomości czatu: implementacja

Gałąź `feat/w3-chat-toasts`, worktree `scratchpad/wt3/chat-toasts`, baza `56da8d23`.

## 1. Ustalenia (dochodzenie)

### Jedyny montaż haka nie był renderowany

- `git grep -n useIncomingChatToasts`: jedynym wywołaniem w `src` (poza testami) było
  `src/components/chat/ChatBell.tsx:46`. Komponentów `<ChatBell` i `<ChatDock` nie renderuje nic.
  Zostały tylko definicje, testy i jedna atrapa.
- `src/components/SiteChrome.tsx:14-16, 87-92, 154` montuje dla zalogowanych tylko leniwy
  `WorkspaceDock` (poza `/admin` i `/login`). Pływający `ChatDock` usunięto świadomie, co pilnuje test
  `src/components/__tests__/SiteChrome.test.tsx:264` („rozmowy żyją tylko w WorkspaceDock”).
- Innego mechanizmu „nowa wiadomość → toast” nie ma:
  - `useNotificationsRealtime` (`src/lib/notifications/useNotifications.ts:298-316`) tylko unieważnia
    zapytania i nie pokazuje toastów.
  - `useChatListRealtime` (`src/lib/chat/useConversations.ts:546-563`) subskrybuje
    `conversation_participants`, nie `messages`. Nie ma treści ani nadawcy, więc z niego toasta
    zbudować się nie da.
  - Kanały `chat-conv:<id>` (`src/lib/chat/useMessages.ts:450, 528`) żyją tylko przy otwartym oknie
    jednej rozmowy.
  - Globalnego kanału INSERT na `messages` w aplikacji nie było, więc drugiego kanału nie otwieram.
    Hak otwiera jedyny taki kanał.
- Historia gita jest płytka (korzeń 2026-10-01/02, zaimportowany w całości), więc `git log -S
useIncomingChatToasts` / `-S ChatBell` / `-S "<ChatDock"` trafia tylko w commity importu. O tym,
  czy funkcję wycofano celowo, rozstrzygają dokumenty: **nie wycofano jej celowo**.
  - `docs/performance/2026-10-03-pagespeed-85-95/faza3/PLAN-FALI-3.md:261`: „toasty czatu
    (`useIncomingChatToasts`) zostają w kodzie i wychodzą jako osobne zadania dla właściciela — to
    brakujące podłączenia, nie martwy kod”.
  - Audyt R055 (`docs/audyt-ed13/rejestr-defektow.json`, waga „wysoki”): „globalne powiadomienia
    o nowej wiadomości nigdy się nie montują”, status „otwarty”.
  - `faza3/plany/P3.10.md:143, 541` zadaje to samo pytanie.

  Wniosek: wpinam funkcję, nie usuwam jej.

### Architektura czatu, na której się opieram

- `WorkspaceDock` (`src/components/dock/WorkspaceDock.tsx`) jest jedyną powierzchnią rozmów. Słucha
  szyny `chatDockBus` (`onOpenChatWindow`, :175) i otwiera skrzynkę `ChatSideDrawer` z `openRequest`.
- Zminimalizowane rozmowy trzyma magazyn `minimizedChatsStore` (`src/lib/chat/minimizedChats.ts`,
  zapis w `sessionStorage`). Jego API przywracania to `restore(id)` (:93): zdejmuje pigułkę i ustawia
  `requested`. Konsumuje to skrzynka (`ChatSideDrawer.tsx:174-181`) i klik w pigułkę
  (`MinimizedChats.tsx:73`). Molekuła `MinimizedChats` rysuje maksymalnie 3 dymki na mobile
  i pigułki na desktopie (AGENTS.md).
- „Otwarta rozmowa”: `ChatWindow` wystawia `data-active-conversation` w obu wariantach
  (`src/components/chat/ChatWindow.tsx:681, 702`), a hak sprawdza ten znacznik razem z
  `document.hasFocus()` i `visibilityState`.
- Kanały `postgres_changes` w repo idą przez `src/lib/realtime/tableChannelHub.ts`: losowy sufiks
  nazwy i licznik referencji.
- Koszt JS: `useIncomingChatToasts.ts` i `sonner` były JUŻ w statycznym domknięciu chunku doku
  (`MinimizedChats` → `useConversations` → `invalidateMuteCache` z haka). Montaż dokłada więc kilka
  linii do leniwego chunku tylko dla członków. Moduł `useCommunityModules` jest już w wejściu
  (`SiteChrome`), a odczyt idzie z tego samego zapytania `site_settings`, z którego dok czyta
  konfigurację skrótów, więc nie ma osobnego żądania.

### Wada samego haka (poza brakiem montażu)

Hak tworzył własny kanał o stałej nazwie `chat-incoming:<uid>`. W realtime-js 2.116
`RealtimeClient.channel(topic)` oddaje istniejący obiekt, dopóki kanał nie zostanie zamknięty
(`RealtimeClient.js:335-347`). Zamknięcie i `_remove` przychodzą dopiero po potwierdzeniu `leave`
(`RealtimeChannel.js:100-102`). `subscribe()` na kanale, który nie jest „closed”, nie dołącza
ponownie (`RealtimeChannel.js:129-176`). Ponowny montaż przed potwierdzeniem opuszczenia
**dołączonego** kanału dawał więc nasłuch na kanale, który zaraz zostanie rozebrany. Toasty cicho
przestawały przychodzić. Dzieje się tak przy zejściu i powrocie doku albo ponownym zalogowaniu
w oknie RTT.

Podwójny efekt StrictMode przy pierwszym montażu tego nie wywołuje: kanał jeszcze nie jest
dołączony, więc phoenix zamyka go synchronicznie.

## 2. Decyzja

Funkcję wpinam w `WorkspaceDock` jako jedyny montaż na sesję członka. Kanał przepinam na
`tableChannelHub`.

Deduplikacji między kartami nie dodaję. W kodzie nie ma na to wzorca: `BroadcastChannel` jest tylko
w podglądzie typografii buildera (`liveTypography.ts`) i wewnątrz auth Supabase, a „blokady” kart
(`navigator.locks`) nie ma nigdzie. Szczegóły w ryzykach.

## 3. Co zmieniłem i dlaczego

1. `src/components/dock/WorkspaceDock.tsx`
   - :161-162 `useIncomingChatToasts(useCommunityModules().chat_enabled)`. Montuje go tylko dok,
     a dok renderuje się tylko dla zalogowanych (bramka w `SiteChrome` i `if (!user) return null`).
     Stoi w stałej pozycji drzewa, więc działa raz na sesję i nawigacja go nie przemontowuje.
     Moduł czatu wyłączony w panelu nie otwiera kanału (tak samo `/messages` chowa wtedy rozmowy).
   - :175-186 w obsłudze szyny: jeśli rozmowa wisi na szynie zminimalizowanych, przywracam ją przez
     API magazynu sesji (`minimizedChatsStore.restore`). Bez tego akcja „Otwórz” w toaście (i „Napisz”
     w profilu) otwierała rozmowę w skrzynce, a jej pigułka zostawała na pasku obok.
2. `src/lib/chat/useIncomingChatToasts.ts`
   - Kanał idzie przez `subscribeToTable({ table: "messages", event: "INSERT", filter:
"sender_id=neq.<uid>" })`. Licznik referencji haka i sprzątanie (`seenIds`, `muteCache`) zostają.
   - Nowy parametr `enabled` (domyślnie `true`): `false` nie otwiera kanału, a wyłączenie w trakcie
     sesji go zwalnia.
   - :145 po odczytach (wyciszenie, profil nadawcy) toast przepada, gdy sesja się skończyła albo gdy
     użytkownik w międzyczasie otworzył i skupił tę rozmowę. Wcześniej spóźniony toast mógł trafić
     po wylogowaniu albo zdublować okno, które użytkownik już czyta.
   - Komentarze przepisane po polsku: gdzie hak żyje i dlaczego idzie przez hub.
3. Testy (behawioralne, bez list klas i tekstu źródeł):
   - NOWY `src/components/dock/__tests__/WorkspaceDock.incomingToasts.test.tsx` (10). Prawdziwe są
     tu: pasek, hak, hub, szyna, magazyn sesji i odczyt ustawień (zasiany cache `site_settings`).
     Sprawdzane zachowania:
     - zalogowany dostaje JEDEN kanał z filtrem nadawcy i zero zapytań do pierwszej wiadomości;
     - nawigacja nie otwiera drugiego kanału;
     - gość: brak paska, zero kanałów, zero zapytań, zero RPC;
     - StrictMode zostawia jeden kanał, który doręcza;
     - zejście paska zwalnia kanał;
     - moduł czatu wyłączony (i przełączany w trakcie sesji);
     - toast i „Otwórz” otwierają skrzynkę na tej rozmowie;
     - otwarta i skupiona rozmowa nie dostaje toasta, a inna dostaje;
     - zminimalizowaną rozmowę „Otwórz” przywraca przez magazyn sesji: pigułka znika, druga zostaje;
     - echo własnej wiadomości nie daje toasta.
   - `src/lib/chat/__tests__/useIncomingChatToasts.test.tsx` (34, w tym 4 nowe):
     - ponowny montaż przed potwierdzeniem `leave` nadal doręcza (emulacja semantyki realtime-js:
       ta sama nazwa zwraca opuszczany obiekt);
     - `enabled` false/true/false;
     - rozmowa otwarta w trakcie odczytów nie dostaje spóźnionego toasta;
     - toast spóźniony za końcem sesji przepada.

     Nazwy kanałów są teraz kluczem huba.

   - `WorkspaceDock.test.tsx`: atrapa haka (sieć dowodzi plik wyżej) i `getSnapshot` w atrapie
     magazynu. Nowy test: szyna przywraca zminimalizowaną rozmowę przez magazyn, a innych nie rusza.
   - `WorkspaceDock.ssr.test.tsx`: atrapa haka (efekt nie wpływa na HTML ani hydratację).
   - Mutacje sprawdzone ręcznie:
     - usunięcie montażu w doku: 9/10 testów integracyjnych czerwonych;
     - usunięcie `restore` w obsłudze szyny: 2 czerwone;
     - powrót do kanału o stałej nazwie: test ponownego montażu czerwony;
     - usunięcie strażnika po odczytach: 2 czerwone.

## 4. Bramki

- `bunx prettier --write` na 6 dotkniętych plikach: bez zmian.
- `light.sh bunx eslint <6 plików>`: exit 0.
- `light.sh bunx vitest run` na `useIncomingChatToasts`, `useConversations`, `ChatBell`,
  `SiteChrome`, `src/components/dock/` i `src/lib/realtime/`: 29 plików, 509 zielonych i 7 „expected
  fail” (zastane `it.fails`).
- `light.sh bun run verify:static`: 15 bramek OK (281,7 s).
- Typecheck (`typecheck-noinc.sh` przez `heavy-bg.sh`: tsgo app + tsc scripts + tsgo e2e): exit 0,
  pusty log (`typecheck.log`, `typecheck.log.exit` obok).
- Build, e2e artefaktowe i waga dokumentu należą do etapu Verify. Oczekiwanie: domknięcie bootu bez
  zmian, bo dok jest leniwy i renderowany tylko dla zalogowanych, a moduły haka, huba i `sonner`
  już były w jego chunku.

### E2E

Niewykonalne tutaj. Ścieżka zalogowana wymaga lokalnego stosu Supabase (job `e2e-seeded`
w `.github/workflows/e2e.yml:68-135`: `supabase start` z migracjami i seedem, realtime). W kontenerze
nie ma demona Dockera ani CLI `supabase`. Konfiguracja artefaktowa (`playwright.artifact.config.ts`)
jest anonimowa i odtwarza nagrane odpowiedzi serwera. Nie ma sesji ani websocketu realtime, a
emulacja protokołu phoenix w `page.routeWebSocket` byłaby kruchą atrapą. Specyfikacji, której nie da
się tu uruchomić, nie dopisuję do `e2e/user-paths.spec.ts`. Propozycja na osobne zadanie:
w seeded e2e dwa konteksty (`reader@nes.local` na `/`, `admin@nes.local` wysyła wiadomość przez
RPC/REST) i asercje toasta oraz akcji „Otwórz”.

## 5. Ryzyka i ograniczenia

- **Wiele kart.** Każda karta członka ma własny kanał i własny toast. Sonner 2 wstrzymuje licznik
  toastu w karcie ukrytej, więc po przełączeniu na inną kartę serwisu stary toast pokaże się jeszcze
  na 6 s. W repo nie ma wzorca koordynacji kart dla powiadomień, więc go nie wprowadzam. Gdyby
  właściciel chciał, wystarczy `BroadcastChannel` z „roszczeniem” `message.id` (pierwsza widoczna
  karta pokazuje, pozostałe milkną).
- **Toaster leniwy.** `<Toaster/>` montuje się po bezczynności (3 s) albo przy pierwszym toaście
  z `lib/notify`. Sonner 2.0.8 przy subskrypcji odtwarza aktywne toasty (`index.mjs:139-144`), więc
  toast sprzed montażu się nie gubi (komentarz w `lib/notify.ts` mówi inaczej, ale opisuje starszego
  sonnera).
- **Moduł czatu.** Przy wyłączonym `chat_enabled` toastów nie ma. Do czasu odczytu ustawień
  obowiązuje domyślne `true`, ale cache `site_settings` jest zasiany z loadera korzenia, więc w praktyce
  nie ma okna, w którym kanał powstałby i zaraz zniknął.
- **`/admin`.** Dok tam nie wchodzi, więc w panelu toastów nie ma. To zamierzone: akcja „Otwórz”
  i tak nie miałaby skrzynki, w której otworzyć rozmowę.
- `ChatBell.tsx` i `ChatDock.tsx` (martwe) zostały nietknięte: ich los rozstrzyga P3.10 S2.
  `ChatBell` nadal woła hak, ale nikt go nie renderuje, więc nie ma podwójnego montażu.
- Pliki zastrzeżone (lista w zadaniu) nie zostały dotknięte, więc `out_of_scope_needs` jest pusty.

## 6. Commit

`a425f807` na `feat/w3-chat-toasts` (worktree `scratchpad/wt3/chat-toasts`). Stashe `stash@{0}` (edycje pozostałego agenta po
16:32) i `stash@{1}` (mieszane edycje 16:26-16:33) zostają nietknięte, służyły tylko do wglądu. `vitest-1.log` w tym
katalogu (16:34) pochodzi od zatrzymanego agenta, nie z tego przebiegu.
