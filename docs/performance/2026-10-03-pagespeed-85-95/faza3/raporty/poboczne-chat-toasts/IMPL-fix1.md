# Toasty nowych wiadomości czatu: poprawki po recenzjach (fix1)

- Gałąź `feat/w3-chat-toasts`, worktree `scratchpad/wt3/chat-toasts`.
- Nowy commit **`3c10e030`** na `a425f807`. Baza: `claude/zen-ritchie-hzur21` (`56da8d23`).
- Recenzje: `REVIEW-ux.md` i `REVIEW-perf-sec.md`. Obie dawały `fix_required`.
- Numery linii poniżej dotyczą stanu po commicie `3c10e030`.

## 0. Decyzja projektowa: przyjęty wariant M1

Źródłem toastów są teraz własne wiersze `conversation_participants`, a nie INSERT-y `messages`. Nie znalazłem
konkretnego powodu przeciw. Przed przebudową sprawdziłem w migracjach i typach cztery rzeczy.

### Trigger podbija licznik tylko odbiorcom

Ostatnią definicją `messages_after_insert` jest `supabase/migrations/20260713100000_chat_improvements_round3.sql:128-153`.
Żadna późniejsza migracja jej nie nadpisuje (`grep -l messages_after_insert`). Trigger robi trzy rzeczy:

- odbiorcom ustawia `unread_count = unread_count + 1`, a nadawcy `0`;
- wszystkim uczestnikom stempluje `updated_at = now()`;
- rozmowie ustawia `last_message_at = NEW.created_at` oraz `last_message_kind`, `last_message_preview`
  (`left(body,140)` albo nazwa pliku) i `last_message_sender`.

Inne ścieżki nie podnoszą licznika:

- nie ma funkcji „oznacz jako nieprzeczytane” dla rozmów (`grep unread_count`);
- `mark_conversations_delivered` (`20260712230000_chat_whatsapp_architecture.sql:381-395`) i wyciszenie, przypięcie
  oraz archiwizacja licznika nie zmieniają.

### Podpis transakcji jest dokładny

- `messages.created_at DEFAULT now()` (`20260710092108_…sql:62`). Klient nie wysyła `created_at`
  (`src/lib/chat/useMessages.ts:99-116`).
- `cp_touch_updated_at` ustawia `NEW.updated_at := now()` (`20260710092108_…sql:165-170`).
- `now()` to znacznik transakcji, więc w transakcji wiadomości `updated_at` wiersza odbiorcy jest równe co do
  mikrosekundy `last_message_at` rozmowy.

### Starego wiersza nie ma

> **Errata (fix2, REVIEW-2 N9):** obowiązuje `REPLICA IDENTITY DEFAULT` - ustawienie `FULL` z `20260710092108_…sql:328`
> nadpisuje późniejsza migracja `20260710094245_…sql:116`. Wniosek się nie zmienia: Realtime nie daje starego wiersza,
> więc punkt odniesienia i tak trzyma klient.

`conversation_participants` ma `REPLICA IDENTITY FULL` i jest w publikacji `supabase_realtime`
(`20260710092108_…sql:328, 335`). Przy włączonym RLS Realtime oddaje jednak w `old` wyłącznie klucz główny.
Dlatego punkt odniesienia licznika trzymam po stronie klienta, a pierwsze zdarzenie rozmowy w sesji weryfikuję
podpisem transakcji.

### Kolumny i RLS

- `conversations.last_message_kind/preview/sender` istnieją (`20260710092224_…sql:3-5`, typy `src/integrations/supabase/types.ts`).
- Członek czyta swoje rozmowy przez `conversations_member_select` (`20260710092631_…sql:25`).
- Własny wiersz uczestnika jest zawsze widoczny dla właściciela: `user_id = auth.uid()` w
  `conversation_participants_member_select`, `20260712192421_…sql:177-189`.
- Bramka kontraktu TS↔SQL (`verify:static`) przyjęła nowy select.

## 1. Ustalenia blokujące i poważne

### B1 (blokujące) i M1 (poważne): personel dostawał toasty z cudzych prywatnych rozmów; fan-out RLS

**Rozwiązanie z konstrukcji.**

- `src/lib/chat/useIncomingChatToasts.ts:359-369` (`acquire`) subskrybuje `ownParticipantsChannel(uid)`, czyli
  `{ table: "conversation_participants", filter: "user_id=eq.<uid>" }`.
- Tę specyfikację wydzieliłem w `src/lib/chat/useConversations.ts:549-551`. Używa jej też `useChatListRealtime`
  (`:562`), więc hub widzi jeden klucz i jeden kanał:
  - na zwykłej stronie to jeden kanał, tak jak wcześniej;
  - przy otwartej skrzynce lub na `/messages` nie dochodzi żaden nowy kanał.
- Realtime sprawdza RLS tylko dla właściciela wiersza. Kanału na `messages` nie ma.

**Rozpoznawanie nowej wiadomości** (`useIncomingChatToasts.ts:319-342`, `handleChange`):

- **Obrona w głąb:** wiersz z `user_id !== uid` jest odrzucany przed jakimkolwiek odczytem (`:323`).
- **Licznik spada do 0:** toast tej rozmowy jest zdejmowany (`:331-334`).
- **Licznik bez wzrostu względem ostatnio widzianego:** nic się nie dzieje (`:335`). Dotyczy to potwierdzenia
  dostarczenia, wyciszenia i przypięcia.
- **Wyciszenie:** `muted_until` jest czytane z ładunku zdarzenia (`:337-338`), bez zapytania.
- **Otwarta i skupiona rozmowa:** nic się nie dzieje, bez odczytu (`:339`).

**Ogłoszenie** (`announce`, `:255-282`):

- **Odczyt:** jeden select `conversations` (`id, kind, title, last_message_*`, `:189-197`).
- **Odrzucenie:** gdy brak wiersza (także przy błędzie), gdy to własna wiadomość, gdy wiadomość jest cofnięta
  (`deleted`) albo gdy ta wiadomość została już obsłużona.
- **Podpis:** dla pierwszego zdarzenia rozmowy wymagany jest podpis `updated_at == last_message_at` (`:271`).
- **Ponowne sprawdzenie:** po odczycie profilu jeszcze raz sprawdzam sesję i fokus.
- **Zdarzenie `nes:chat-incoming`:** leci dopiero po wszystkich bramkach (`:279-280`). Niesie
  `{ conversationId, senderId, at }`, a nie wiersz `messages`. Poza testami nikt go nie słuchał.

**Komentarz nagłówkowy** (`:1-51`) przepisany: opisuje faktyczny model RLS, wykrywanie przez licznik i podpis,
bramki i rejestr toastów. Zniknęło fałszywe „RLS przepuszcza tylko rozmowy, w których jest uczestnikiem”.

**Testy:**

- `src/lib/chat/__tests__/useIncomingChatToasts.test.tsx`:
  - `:357` hak nie subskrybuje `messages`;
  - `:366` cudzy wiersz uczestnika daje zero toastów, odczytów, RPC i zdarzeń; zdarzenie `messages` na kanale też
    niczego nie robi;
  - `:418` potwierdzenie dostarczenia bez podpisu nie daje toasta;
  - `:438` brak wzrostu licznika to brak odczytu;
  - `:494` błąd odczytu podglądu to brak toasta i brak RPC (fail-closed);
  - `:851` zdarzenie leci po bramkach.
- `src/components/dock/__tests__/WorkspaceDock.incomingToasts.test.tsx`:
  - `:417` personel lub nie-uczestnik w prawdziwym pasku.

### MAJOR (UX 2): preferencje „Wiadomości na czacie” i tryb cichy

**Rozwiązanie.**

- `src/components/dock/WorkspaceDock.tsx:157-176`: `useNotificationPreferences()`, wspólny klucz cache
  z `NotificationsBell`.
- Hak dostaje `chatEnabled && enabled_message !== false && allow_messages_from !== "nobody"`.
- Wyłączenie w trakcie sesji (np. z innej karty, przez `useNotificationPreferencesRealtime` dzwonka) zamyka kanał
  i zdejmuje toasty.
- Do czasu wczytania obowiązuje „włączone”, jak przy innych flagach.

**Testy** (`WorkspaceDock.incomingToasts.test.tsx`):

- `:288`: preferencje zasiane w cache, więc zero żądań;
- `:305`: bez cache jest dokładnie jedno żądanie `notification_preferences` i nic poza nim;
- `:384`: `enabled_message=false` daje brak kanału;
- `:389`: `nobody` daje brak kanału;
- `:394`: `contacts` nie wycisza;
- `:399`: wyłączenie w trakcie sesji zamyka kanał i zdejmuje toast.

### MAJOR (UX 3) z m3 i UX 4: toasty przeżywały sesję i piętrzyły się

**Rozwiązanie.**

- **Identyfikator per rozmowa.** Toast ma `id: chat-incoming:<conversationId>` (`useIncomingChatToasts.ts:229-253`).
  Sonner podmienia go w miejscu, więc liczba toastów jest ograniczona liczbą rozmów, także w ukrytej karcie.
- **Rejestr modułu.** Zbiór `shownToasts` (`:129`) dostaje wpis przy pokazaniu. Wpis znika przy `onDismiss`,
  `onAutoClose` i kliknięciu akcji.
- **Koniec sesji.** `closeSession()` (`:345-357`) robi `toast.dismiss` dla każdego wpisu. Woła go `release()`
  (licznik 0: wylogowanie, zmiana konta, wyłączenie) oraz `acquire()` przy zmianie konta. Czyści też `lastUnread`,
  `handledAt`, `runs`, `peerCache` i `peerInflight`, a pokolenie sesji (`generation`) unieważnia spóźnione odczyty.
- **Otwarcie rozmowy.**
  - Szyna doku woła `dismissIncomingChatToast(id)` (`WorkspaceDock.tsx:202`, eksport `useIncomingChatToasts.ts:148-152`).
  - Spadek licznika do 0 zdejmuje toast niezależnie od powierzchni: skrzynka, `/messages`, inna karta, inne urządzenie.

**Testy** (`useIncomingChatToasts.test.tsx`):

- `:625`: seria daje jeden `id` i najnowszą treść;
- `:646`: dwie rozmowy dają dwa `id`;
- `:658`: licznik 0 zdejmuje toast;
- `:668`: `dismissIncomingChatToast`;
- `:681`: koniec sesji zdejmuje wszystkie toasty;
- `:693`: zmiana konta zdejmuje toasty.

W pasku (`WorkspaceDock.incomingToasts.test.tsx`):

- `:350`: zejście paska zdejmuje toasty;
- `:468`: szyna zdejmuje toast.

## 2. Drobne

| Ustalenie                                 | Rozwiązanie                                                                                                                                                                                                                                                                                                                                         | Gdzie                                          | Test                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| m1 deduplikacja odczytów w locie          | Na rozmowę najwyżej jeden odczyt w locie. Zdarzenia w trakcie odczytu zapamiętują wiersz i powtarzają odczyt raz po zakończeniu. Profil: `peerInflight` dzieli jedno RPC na nadawcę.                                                                                                                                                                | `useIncomingChatToasts.ts:289-317`, `:214-227` | `:625` (seria 3 wiadomości: 2 odczyty, 1 RPC), `:722`                                          |
| m1 brak pamięci pustego profilu           | Wynik pusty lub błąd RPC trafia do `peerCache` z TTL 60 s (`PEER_MISS_TTL_MS`, `:70`).                                                                                                                                                                                                                                                              | `:199-218`                                     | `:736`                                                                                         |
| m2 `peerCache` przeżywał sesję            | `peerCache.clear()` w `closeSession()`. Mapy mają też limit 1000 wpisów (`remember`, `:131-138`).                                                                                                                                                                                                                                                   | `:355`                                         | `:751`                                                                                         |
| UX 6 nieprzycięty podpis załącznika       | `clip()` obejmuje wynik końcowy, razem z „Zdjęcie - …” i „Plik: …”. Limit toasta to 120 znaków, krótszy niż serwerowe 140, więc ucięty podgląd z serwera zawsze dostaje wielokropek.                                                                                                                                                                | `:165-187`                                     | `:827`, `:833`, `:840`                                                                         |
| UX 7 akcja na `/messages`                 | Na `/messages` (z prefiksem języka zdejmowanym przez `stripLangPrefix`) szyna nawiguje do `/messages?c=<id>`. Pigułkę tej rozmowy zdejmuje `minimizedChatsStore.remove`, bez prośby o skrzynkę. Gdzie indziej działa po staremu przez `restore` (AGENTS.md: jeden magazyn sesji).                                                                   | `WorkspaceDock.tsx:184-219`                    | `WorkspaceDock.incomingToasts.test.tsx:528`                                                    |
| UX 8 etykieta                             | „Otwórz rozmowę” / „Open conversation”.                                                                                                                                                                                                                                                                                                             | `src/lib/i18n-chat.ts:121, 619`                | `:402`, pasek `:449`                                                                           |
| UX 8 nazwa kręgu                          | Rozmowa `kind = "group"` ma tytuł „Nadawca · Nazwa kręgu”, a bez tytułu „· Krąg”. Dane przychodzą z tego samego selectu, bez kosztu.                                                                                                                                                                                                                | `useIncomingChatToasts.ts:232-237`             | `:764`                                                                                         |
| UX 5 toast zasłania pasek                 | `offset.bottom = calc(var(--mbb-reserve, 0px) + 24px)`, `mobileOffset.bottom = calc(var(--mbb-reserve, 0px) + 16px)`. U gościa zmiennej nie ma, więc zostają domyślne 24/16 px. Zgodne z regułą `styles.css:7068-7075`.                                                                                                                             | `src/components/ui/sonner.tsx:6-13, 26-27`     | -                                                                                              |
| UX 8 etykieta regionu sonnera             | `containerAriaLabel={t("notifications.title")}`, czyli „Powiadomienia” / „Notifications” (istniejący klucz rdzenia). Sonner dokleja „alt+T”.                                                                                                                                                                                                        | `sonner.tsx:28`                                | -                                                                                              |
| m4 kod toastów we współdzielonym chunku   | Pamięć wyciszeń zniknęła razem z `invalidateMuteCache`, bo `muted_until` przychodzi w ładunku. `useConversations.ts` nie importuje już haka. Jedynym osiągalnym importerem haka jest `WorkspaceDock` (`ChatBell` nikt nie importuje), więc hak trafia do leniwego chunku doku, nie do `ChatUnreadBadge-*`. Osobny `muteCache.ts` nie był potrzebny. | `useConversations.ts:14-18, 410-421`           | `useConversations.test.tsx:638-665` (testy unieważniania zastąpione testem zapisu RPC i błędu) |
| NIT `vi.restoreAllMocks` w ciałach testów | Przeniesione do `afterEach` w teście haka. W teście paska już tam było.                                                                                                                                                                                                                                                                             | `useIncomingChatToasts.test.tsx:266-269`       | -                                                                                              |
| NIT nieaktualny komentarz `notify.ts`     | Sonner 2.0.8 odtwarza aktywne toasty (`Observer.subscribe` → `getActiveToasts()`). Komentarz poprawiony. Zmienia się tylko komentarz, więc bajty buildu bez zmian.                                                                                                                                                                                  | `src/lib/notify.ts:20-25`                      | -                                                                                              |

### Granica bootu (rozumowanie, pomiar należy do Verify)

**Wejście.** W wejściu zmienia się tylko komentarz w `notify.ts`.

**`sonner.tsx`.** Moduł leży w nazwanym `vendor-sonner` (`vite.config.ts:346`). Nowa krawędź `vendor-sonner` →
`vendor-i18n` prowadzi do chunku, który już jest w domknięciu bootu. Nie powstaje więc nowe żądanie ani cykl:
`vendor-i18n` nie importuje sonnera.

**`useNotifications.ts`.** Nowy import w doku. Moduł już dziś leży we współdzielonym, leniwym
`NotificationsUnreadBadge-*` (10,6 kB) razem z `preferences.ts` i `kindInvalidation.ts`. Ten chunk statycznie
importuje sześć innych leniwych chunków: `ChatWindow`, `messages`, `NotificationsCenter`, `profile.privacy`,
`NotificationsBell` i `presence`. Dok jest jeszcze jednym importerem. Moduły, które dok osiąga przez
`useNotifications`, dostają ten sam dodatkowy importer, więc grupują się jak dotąd. Wejście ich nie osiąga.

**Hak.** Przechodzi z `ChatUnreadBadge-*` do chunku doku (m4).

**Do zmierzenia w Verify:**

- `bootClosureRawBytes`, oczekiwane Δ = 0;
- `check:entry-purity`;
- `check-bundle-size`;
- diff `chunk-inventory.json`: oczekiwane zmiany tylko w `DockEmptyState-*`, `ChatUnreadBadge-*`, `vendor-sonner-*`
  i ewentualnie `NotificationsUnreadBadge-*`.

## 3. Świadomie pominięte i ryzyka szczątkowe

**Pseudonimy rozmów (`useNicknames`) w tytule.** Pominięte. Wymagałyby osobnego odczytu, a ten w haku nie byłby tani.
Tytuł używa `display_name` z `get_chat_peers`, jak wcześniej.

**Dymki zminimalizowanych rozmów na telefonie.** Wiszą nad paskiem (`bottom-full mb-2`) i mogą zachodzić na toast,
który jest teraz nad `--mbb-reserve`. Pełne obejście wymagałoby nowej zmiennej publikowanej przez szynę albo reguły
w `styles.css`, czyli CSS w bootcie. Toast da się zsunąć, a po 6 s znika sam.

**Koszt pierwszego zdarzenia rozmowy w sesji.** Zdarzenie bez punktu odniesienia z licznikiem > 0 kosztuje jeden
select `conversations`, zanim podpis je odrzuci. Typowo to potwierdzenie dostarczenia zaległych wiadomości po
otwarciu skrzynki lub `/messages`. Zdarza się raz na rozmowę na sesję, bo potem punkt odniesienia jest znany.
To nadal mniej niż dawny select wyciszenia i RPC przy każdej wiadomości.

**Podpis zależy od `created_at` z domyślnego `now()`.** Gdyby klient jawnie podał `created_at`, pierwsza wiadomość
rozmowy w sesji nie dostanie toasta. To fail-closed. Kolejne wykrywa już sam wzrost licznika.

**Podmiana toasta w miejscu zachowuje pozostały czas licznika.** Sonner resetuje go tylko przy zmianie `duration`.
Najnowsza wiadomość serii może więc zniknąć szybciej niż po 6 s.

**Rozmowy znikające (TTL).** Toast pokazuje podgląd jak lista rozmów. Toast jest ulotny, a fan-out zapisuje
„Nowa wiadomość” tylko dlatego, że `notifications` nie mają TTL. Bez zmian względem poprzedniej wersji.

**Poza zakresem (osobne zadania):**

- push i toast dla tej samej wiadomości przy skupionym oknie (`public/push-sw.js`);
- deduplikacja między kartami (`BroadcastChannel`);
- e2e seeded z dwoma kontekstami, w tym `admin@nes.local`, który nie dostaje toasta z cudzej rozmowy (propozycja
  z IMPL i recenzji). Lokalnie się nie da: brak Dockera i stosu Supabase.

## 4. Bramki

**`bunx prettier --write`** na 11 dotkniętych plikach. Poprawił formatowanie `WorkspaceDock.tsx`
i `useConversations.ts`, reszta bez zmian.

**`light.sh bunx eslint`** na 11 plikach: exit 0.

**`light.sh bunx vitest run`** na `src/components/dock`, `src/lib/chat`, `src/lib/realtime`,
`src/components/__tests__/SiteChrome.test.tsx`, `src/routes/__tests__/rootShellRender.test.tsx`,
`src/routes/__tests__/rootRouterMount.test.tsx`, `src/components/chat/__tests__/ChatBell.test.tsx` i `src/lib/__tests__`:

- **181 plików, 4263 zielonych, 25 „expected fail”** (zastane `it.fails`), exit 0;
- log: `vitest-fix1.log`;
- test haka po dopisaniu przypadku fail-closed: 48/48.

**`light.sh bun run verify:static`:** 15 bramek OK (305 s), w tym kontrakt TS↔SQL dla nowego selectu.
Log: `verify-static-fix1.log`.

**Typecheck** (`heavy-bg.sh` + `typecheck-noinc.sh`: tsgo app, tsc scripts, tsgo e2e) na końcowym drzewie: exit 0,
pusty log (`typecheck-fix1.log`, `.exit`).

**Mutacje.** Każda poprawka cofnięta osobno, pliki przywrócone i porównane `cmp`. Każda mutacja dała czerwone testy:

| Mutacja                                 | Czerwone testy  |
| --------------------------------------- | --------------- |
| bez `toast.dismiss` w `closeSession`    | 4               |
| bez `row.user_id === uid`               | 2 (hak i pasek) |
| bez podpisu transakcji                  | 1               |
| bez `peerCache.clear`                   | 2               |
| bez preferencji w doku                  | 3               |
| bez gałęzi `/messages`                  | 1               |
| toast bez `id`                          | 3               |
| `clip` bez podpisu załącznika           | 1               |
| zdarzenie przed bramkami                | 5               |
| bez `dismissIncomingChatToast` w szynie | 1               |

**Build, Playwright i waga dokumentu** należą do Verify (lista kontrolna w sekcji 2).
