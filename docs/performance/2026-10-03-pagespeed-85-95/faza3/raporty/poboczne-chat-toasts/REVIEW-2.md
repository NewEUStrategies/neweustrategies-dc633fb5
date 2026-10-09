# Recenzja 2 (adwersaryjna): toasty nowych wiadomości czatu

- Gałąź `feat/w3-chat-toasts`, commity `a425f807` + `3c10e030`, baza `claude/zen-ritchie-hzur21` (`56da8d23`).
- Worktree `scratchpad/wt3/chat-toasts`. Tylko odczyt: w worktree nic nie edytowałem, nie commitowałem i nie budowałem.
- Sondy uruchamiałem w osobnej kopii `git archive HEAD` w scratchpadzie. Kopię usunąłem. Plik sond leży obok:
  `REVIEW-2.probe.test.tsx`. Symulacja `__vite__mapDeps` leży w `REVIEW-2.mapdeps-sim.py`.

## Werdykt: **approve** (z warunkiem pomiaru w Verify)

Nie znalazłem ustaleń blokujących ani poważnych.

- **B1 i M1 są naprawione z konstrukcji.** Żadna rola (member, editor, moderator, admin, super_admin) nie dostaje toasta
  ani treści rozmowy, w której nie uczestniczy.
- **Wykrywanie nowej wiadomości jest poprawne.** Opiera się na wzroście `unread_count` i na podpisie
  `updated_at == last_message_at`. Sprawdziłem je względem każdego zapisu do `conversation_participants` w migracjach.
- **Rekomendowane poprawki (nie blokują).** Zostaje 5 drobnych ustaleń i 5 uwag (nit). Najtańsze i najbardziej warte zrobienia
  przed scaleniem to N3, N4 i N5, po kilka linii każde.

**Warunek.** Domknięcie bootu się zmienia, choć IMPL-fix1 zakładał Δ = 0. Symulacja na grafie bazy daje netto ok. −43 B
w wejściu (szczegóły w N2), ale zmiana musi zostać zmierzona. Jeśli Verify pokaże wzrost `bootClosureRawBytes`, N2 staje się
blokujące.

---

## 1. Metoda i bramki

- **Kod.** Przeczytałem cały diff (11 plików) i w całości: `useIncomingChatToasts.ts`, `WorkspaceDock.tsx`, `sonner.tsx`,
  `tableChannelHub.ts`. Dodatkowo fragmenty: `useConversations.ts`, `useNotifications.ts`, `messages.tsx`,
  `minimizedChats.ts`, `ConversationListItem.tsx`, `__root.tsx`, `vite.config.ts` oraz `node_modules/sonner/dist/index.mjs`
  w wersji 2.0.8.
- **Migracje.** Przejrzałem wszystkie zapisy `UPDATE/INSERT/DELETE conversation_participants` (48 plików), wszystkie
  przypisania `unread_count`, triggery na `messages` (before/after insert, edycja, soft delete, guard, search) oraz
  `cp_touch_updated_at`. Do tego polityki RLS `conversations`, `conversation_participants` i `messages`.
- **Build bazy** `scratchpad/base-w3b`. Źródła: `reports/chunk-inventory.json` (892 chunki) i wejście
  `.output/public/assets/index-c_XR_U82.js`. Z wejścia sparsowałem `__vite__mapDeps`: 843 pliki, 532 wywołania `import()`.
  Symulacja domknięć odtwarza bazę dla 521 z 532 list.
- **`light.sh bunx vitest run`** na 5 dotkniętych plikach testów (hak, pasek ×3, `useConversations`):
  **158/158 zielonych**.
- **`light.sh bunx eslint`** na 11 dotkniętych plikach: **exit 0**.
- **Sondy** (kopia izolowana, 5/5 wykonanych):

  | Sonda | Scenariusz                         | Wynik         |
  | ----- | ---------------------------------- | ------------- |
  | P1    | seria przy pierwszym zdarzeniu     | OK            |
  | P2    | wyścig „przeczytane gdzie indziej” | potwierdza N4 |
  | P3    | zdjęcie bez podpisu                | potwierdza N5 |
  | P4    | µs i różne strefy w znacznikach    | OK            |
  | P5    | zgubiony reset licznika            | potwierdza N3 |

## 2. Ustalenia rundy 1: stan

| Ustalenie                          | Stan           | Dowód                                                                                                                                                                                                |
| ---------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** personel widział cudze DM-y | **naprawione** | Kanał tylko na `conversation_participants` z `user_id=eq.<uid>` (`useIncomingChatToasts.ts:366`), obrona w głąb `row.user_id !== uid` (`:323`). Kanału na `messages` nie ma. Szczegóły w sekcji 3.1. |
| **M1** fan-out RLS                 | **naprawione** | Realtime filtruje po `user_id` na serwerze, więc RLS liczy się tylko dla właściciela wiersza. Klucz huba jest wspólny z listą rozmów (`ownParticipantsChannel`, `useConversations.ts:549-551`).      |
| UX2 preferencje i tryb cichy       | naprawione     | `WorkspaceDock.tsx:171-176`. Okno „pending” opisuje N6.                                                                                                                                              |
| UX3 toasty przeżywały sesję        | naprawione     | `closeSession()` (`:345-357`) zdejmuje każdy pokazany toast. Sonner 2.0.8 poprawnie odtwarza ponowne `create` z identyfikatorem zdjętym wcześniej (`dist/index.mjs:174-196`).                        |
| UX4 / m3 stos toastów              | naprawione     | `id: chat-incoming:<conversationId>` (`:239-252`).                                                                                                                                                   |
| UX5 toast zasłania pasek           | naprawione     | `sonner.tsx:12-13, 26-27`. Nowe nakładanie na otwarty panel opisuje N8.                                                                                                                              |
| UX6 nieprzycięty podpis            | naprawione     | `clip()` obejmuje wynik (`:165-187`). Nazwa pliku przy zdjęciu: N5.                                                                                                                                  |
| UX7 „Otwórz” na `/messages`        | naprawione     | `WorkspaceDock.tsx:205-209`. Przypadek z otwartą skrzynką: N7.                                                                                                                                       |
| UX8 etykiety, krąg, `aria`         | naprawione     | `i18n-chat.ts:121, 619`; `:234-237`; `sonner.tsx:28`. Klucz `notifications.title` jest w rdzeniu (`locale/pl.ts:2086`, `en.ts:2061`).                                                                |
| m1 deduplikacja odczytów           | naprawione     | `schedule()` (`:289-317`), `peerInflight` (`:214-227`). Sonda P1 potwierdza powtórkę po niezgodnym podpisie.                                                                                         |
| m2 `peerCache` po sesji            | naprawione     | `:355`.                                                                                                                                                                                              |
| m4 kod w `ChatUnreadBadge-*`       | naprawione     | Hak ma jedynego osiągalnego importera, `WorkspaceDock`. `ChatBell` nie jest w grafie buildu (brak w chunk-inventory).                                                                                |
| m5 testy regresji                  | naprawione     | Testy nie-członka, preferencji, sprzątania i identyfikatora toasta są w obu plikach.                                                                                                                 |
| NIT `restoreAllMocks`, `notify.ts` | naprawione     | Ten sam stary komentarz został jednak w `__root.tsx` (N9).                                                                                                                                           |

## 3. Analiza wymaganych obszarów

### 3.1 Prywatność: żadna rola nie widzi cudzych rozmów

**Źródło zdarzeń.**

- Subskrypcja: `ownParticipantsChannel(uid)` = `{table: "conversation_participants", filter: "user_id=eq.<uid>"}`.
- Filtr działa po stronie Realtime, przed sprawdzeniem RLS. Dodatkowo `handleChange` odrzuca wiersz z `user_id !== uid`
  (`:323`).

**RLS uczestników** (`20260712192421_…sql:177-189`).

- Widoczny jest własny wiersz albo wiersz współuczestnika przy obustronnych potwierdzeniach odczytu.
- Na `conversation_participants` nie ma polityki personelu. Polityki `*_staff_read` istnieją tylko na `conversations`
  i `messages` (`20260713200000_…sql:16-48`).

**Jedyne odczyty treści.**

1. `loadConversation(id)` (`:189-197`). `id` pochodzi wyłącznie z własnego wiersza uczestnika. RLS
   `conversations_member_select` przepuszcza go członkowi, a `conversations_staff_read` niczego tu nie rozszerza, bo `id`
   jest zawsze z własnej rozmowy.
2. `get_chat_peers([last_message_sender])` (`:202`): nadawca z własnej rozmowy.
3. Zdarzenie `nes:chat-incoming` niesie tylko `{conversationId, senderId, at}` i leci po wszystkich bramkach (`:279-280`).
   Poza testami nikt go nie słucha (`git grep onIncomingChatMessage`).

**Kanał wspólny z listą.** Handler listy (`useConversations.ts:562-565`) nie czyta treści, tylko unieważnia cache
i potwierdza dostarczenie.

**Zmiana konta w trakcie odczytu.** Select wysłany już z JWT nowego konta może zwrócić wiersz, który ten personel widzi
przez `conversations_staff_read`. Wynik odrzuca jednak `isCurrent(uid, gen)` (`:263`), zanim cokolwiek trafi na ekran.
Ekspozycji nie ma.

**Wniosek.** B1 jest naprawione dla wszystkich ról: admin, super_admin, editor, moderator, member.

### 3.2 Poprawność wykrywania (`unread_count` + podpis transakcji)

**Inne zapisy nie podnoszą licznika.** Jedynym miejscem, które zwiększa `unread_count` w `conversation_participants`, jest
`messages_after_insert`. Jego ostatnia definicja to `20260713100000_…sql:128-153`. Wzrosty `20260808*` dotyczą innej tabeli
(`m.`, kluby). Każdy inny zapis do wiersza uczestnika albo licznika nie zmienia, albo go zeruje:

- `mark_conversation_read`;
- `mark_conversations_delivered` (`20260712230000_…sql:381-395`);
- `chat_set_pinned`, `chat_set_archived`, `chat_set_muted`;
- `chat_clear_history` (zeruje);
- `chat_set_appearance`, czyli tapeta i emoji (`20260912101000_…sql:45`, **wszyscy uczestnicy**);
- `messages_after_edit` i `messages_after_soft_delete` (`20260710094245_…sql:21-62`, wszyscy uczestnicy, tylko `updated_at`);
- odarchiwizowanie w `get_or_create_direct_conversation` (`20260807054859_…sql:306`);
- `INSERT` uczestników (żadna funkcja nie ustawia `unread_count`, więc zawsze 0) i `DELETE` przy wyjściu z kręgu.

**Fałszywe pozytywy.**

- Wszystkie zapisy wyżej stemplują `updated_at = now()` WŁASNEJ transakcji, a `last_message_at` pochodzi z transakcji
  wiadomości. Przy pierwszym zdarzeniu podpis je więc odrzuca. Przy znanym punkcie odniesienia odpadają przez
  `unread <= previous`.
- Gdyby w transakcji wiadomości wiersz był aktualizowany drugi raz, drugie zdarzenie nie ma wzrostu licznika.
- Fałszywego pozytywu nie znalazłem.

**Znaczniki czasu.**

- `messages.created_at DEFAULT now()`. Żaden trigger BEFORE INSERT go nie nadpisuje: `messages_before_insert`
  stempluje tylko `expires_at` (`20260712230000_…sql:174-200`), a `tg_messages_guard` i `trg_messages_search_vector` go nie ruszają.
- Klient nie wysyła `created_at` (`useMessages.ts:99-116`). Po stronie serwera nie ma insertów do `messages`: w migracjach
  ani jednego `INSERT INTO public.messages`, `send_expert_inmail` / `resolve_expert_request` tylko zakładają rozmowę.
- `tg_cp_touch_updated_at` używa `now()`. `clock_timestamp()` występuje wyłącznie w `cleared_before`.
- Równość jest więc dokładna co do µs w obrębie transakcji.
- Format: Realtime (`to_jsonb`) i PostgREST mogą różnić się strefą zapisu, a `Date.parse` sprowadza oba do tej samej ms.
  Sonda P4 to potwierdza: `…14:00:01.123456+02:00` == `…12:00:01.123456+00:00`.
- Silniki JS (V8, JSC, SpiderMonkey) akceptują 6 cyfr ułamka.

**Fałszywe negatywy.**

- **Seria przy pierwszym zdarzeniu** jest OK. Odczyt widzi już wiadomość 2, podpis E1 się nie zgadza, a powtórka z E2
  (już bez podpisu) daje toast z najnowszą treścią (sonda P1).
- **Własna wiadomość** daje licznik 0 i zdjęcie toasta.
- **Nowa rozmowa:** INSERT uczestnika (0), a potem UPDATE (1), więc toast powstaje bez podpisu.
- **Krąg:** trigger podbija wszystkim poza nadawcą, a tytuł niesie nazwę kręgu.
- **Dwie wiadomości w tej samej ms** do jednej rozmowy: druga nie odświeża treści toasta (`atMs <= handled`, `:270`).
  W praktyce do pominięcia.
- **Rzeczywiste luki:** N3 (zgubiony reset licznika) i N4 (toast po przeczytaniu gdzie indziej).

### 3.3 `ownParticipantsChannel` a `useChatListRealtime`

- Specyfikacja jest identyczna, ten sam klucz huba `public|conversation_participants|*|user_id=eq.<uid>`. Testy listy są
  zielone.
- Zmieniają się tylko dwie rzeczy:
  1. Kanał żyje teraz przez całą sesję członka. Na każdej stronie jest jeden kanał na kartę, a otwarcie skrzynki nie robi
     już świeżego `phx_join`. Funkcjonalnie bez różnic, bo realtime-js sam dołącza ponownie po zerwaniu.
  2. Handler toastów jest rejestrowany pierwszy, a hub woła handlery w pętli bez izolacji (`tableChannelHub.ts:64-66`).
     Szczegóły w N10.

### 3.4 Preferencje, sprzątanie, `/messages`, AGENTS.md

- **Preferencje:** `enabled_message` i `allow_messages_from` leżą w `notification_preferences` (typy `types.ts:15533, 15550`),
  więc bramka jest skuteczna. Okno „pending” opisuje N6.
- **Sprzątanie:**
  - wylogowanie, zmiana konta, wyłączenie modułu albo preferencji i wejście do `/admin` prowadzą przez `release()`
    do `closeSession()`, a ten robi `toast.dismiss` dla wszystkich pokazanych toastów;
  - toasty, które same zniknęły, sonner zdejmuje przez `removeToast` → `ToastState.dismiss`, więc nie wracają z replay;
  - toast w ukrytej karcie zostaje w `shownToasts` i znika przy końcu sesji;
  - szyna zdejmuje toast rozmowy przy jej otwarciu.
- **`/messages`:** `stripLangPrefix(...).pathname === "/messages"`, a trasa jest nielokalizowana (`localePath.ts:59`).
  `navigate({search: {c}})` zdejmuje `view`, więc pokazuje widok rozmów, i tak ma być. Przypadek z otwartą skrzynką
  doku opisuje N7.
- **AGENTS.md (zminimalizowane rozmowy):**
  - przywracanie idzie przez API wspólnego magazynu sesji: `restore` poza `/messages` i `remove` na `/messages`
    (`WorkspaceDock.tsx:203-214`);
  - render molekuły się nie zmienił;
  - test „na mobile najwyżej trzy dymki…” przechodzi.

### 3.5 Boot i wydajność

- **`sonner.tsx` nie jest w domknięciu bootu.** W bazie leży w `vendor-sonner-BA-3S3ka.js` (przypięty w `manualChunks`,
  `vite.config.ts:346`). Domknięcie wejścia to 10 plików i `vendor-sonner` do nich nie należy. Nowy import `react-i18next`
  zmienia jednak WEJŚCIE pośrednio, przez `__vite__mapDeps` (N2).
- **Nowe importy doku z wejścia nie dokładają eksportów.**
  - `stripLangPrefix` jest już eksportowany: leniwy `src/lib/mobileBottomBar/config.ts` w `i18n-mobile-bottom-bar-*`
    importuje go z wejścia.
  - Tak samo `useCommunityModules` (runda 1) i domyślny `i18n` (36 leniwych importerów).
  - `useNavigate` pochodzi z `vendor-tanstack`.
- **Domknięcie leniwego chunku doku rośnie** (N1).

---

## 4. Nowe ustalenia

### N1 — MINOR (wydajność członka): dok ciągnie statycznie 3 dodatkowe chunki przez `useNotificationPreferences`

- **Gdzie:** `src/components/dock/WorkspaceDock.tsx:71, 172`.
- **Dowód** (chunk-inventory bazy):
  - `useNotifications.ts` leży w `NotificationsUnreadBadge-C3ZkiThH.js`. Tego chunku nie ma w liście preloadów doku
    w wejściu: `[158,1,2,61,9,10,11,159,34,14,26,160,7,15,21,25,161,162,163,164,19]`, a 245 w niej brakuje.
  - Łańcuch zależności: `useNotifications` → `kindInvalidation` → `clubs/queryKeys`, który leży w
    `podcasts.index-D_HvMmzT.js`. Ten z kolei importuje `admin.companies._id-VIpRq7dF.js` (`realtime/domainEvents`).
  - Domknięcie doku, czyli chunku blokującego pierwsze malowanie paska członka (`check-bundle-size.ts:2223-2226`), rośnie
    o 3 pliki:

    | Chunk                        | raw         | gzip           |
    | ---------------------------- | ----------- | -------------- |
    | `NotificationsUnreadBadge-*` | 6 245 B     | 2 272 B        |
    | `podcasts.index-*`           | 4 374 B     | 1 562 B        |
    | `admin.companies._id-*`      | 3 618 B     | 1 239 B        |
    | **Razem**                    | **14,2 kB** | **ok. 5,1 kB** |

    Dla porównania sam chunk doku ma 12,1 kB gzip.

  - IMPL-fix1 (sekcja „Granica bootu”) twierdzi, że moduły „grupują się jak dotąd”. To prawda dla przynależności modułów,
    ale nie dla domknięcia doku.
- **Skala w praktyce.** U członka z nagłówkiem `AccountMenuWidget` te chunki i tak ładuje `NotificationsBell` (dla każdej
  sesji), więc bajtów sieciowych zwykle nie przybywa. Rośnie liczba modułów, na które czeka wykonanie doku, i bajty tam,
  gdzie dzwonka nie ma.
- **Poprawka:**
  1. Wydzielić lekki moduł, np. `src/lib/notifications/preferencesQuery.ts`, z `prefsKey`, `queryFn` i
     `useNotificationPreferences`. Ma importować tylko `preferences.ts`, klienta Supabase i `useAuth`.
  2. `useNotifications.ts` re-eksportuje hook, więc klucz cache pozostaje wspólny.
  3. Dok importuje z lekkiego modułu.
  4. Zmierzyć diff `chunk-inventory.json`.

### N2 — MINOR (do zmierzenia; BLOCKING, jeśli pomiar pokaże wzrost): wejście zmienia się przez `__vite__mapDeps`, a nie o Δ = 0

- **Gdzie:** `src/components/ui/sonner.tsx:1, 21` (nowa krawędź `vendor-sonner` → `vendor-i18n`),
  `WorkspaceDock.tsx:71` (N1) i przeniesienie haka z `ChatUnreadBadge-*`.
- **Dowód** (symulacja domknięć na grafie bazy, `REVIEW-2.mapdeps-sim.py`; lista odtworzona dla 521/532 wywołań):

  | Zmiana                                                                             | Wywołania `import()` w wejściu                                                                                           | Bajty raw w wejściu |
  | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------- |
  | `vendor-sonner` importuje `vendor-i18n`                                            | 6 (most `notify.ts` `[15,1]`, leniwy `Toaster` `[15,1]`, `sliderVariants` ×2, `MeetingBookingView`, `editorialCalendar`) | **+12 B**           |
  | dok importuje `useNotifications` (bez ponownego podziału chunków)                  | 1 (lista doku dostaje 3 indeksy)                                                                                         | **+12 B**           |
  | hak opuszcza `ChatUnreadBadge-*` (znika jego import `vendor-sonner` i `i18n-chat`) | 17                                                                                                                       | **−67 B**           |
  | **Razem**                                                                          | 23                                                                                                                       | **ok. −43 B**       |

  IMPL-fix1 pisze, że nowa krawędź „prowadzi do chunku, który już jest w domknięciu bootu”. Vite nie odfiltrowuje jednak
  takich zależności z list preloadu (listy zawierają `vendor-react` = 1 i `vendor-tanstack` = 2), więc wejście się zmienia.

- **Ryzyko:** symulacja nie uwzględnia ewentualnego ponownego podziału przez `experimentalMinChunkSize`. Nowa nazwa chunku
  to ok. +40 B nazwy plus indeksy w każdej liście, a zapas wynosi ok. 155 B.
- **Poprawka i warunek:**
  1. Verify mierzy `bootClosureRawBytes` (oczekiwane ≤ 0), `check:entry-purity` i diff `chunk-inventory.json`.
  2. Jeśli wejście urośnie, najtańszy odwrót to zastąpienie `useTranslation` w `sonner.tsx` importem `i18n` z `@/lib/i18n`.
     Ten moduł leży w wejściu i jest już eksportowany, a Vite pomija chunk-właściciela w `mapDeps`, więc przyrost wynosi 0 B.
     Druga możliwość: zrezygnować z `containerAriaLabel`.

### N3 — MINOR (poprawność): po zgubionym zdarzeniu „przeczytane” pierwsza nowa wiadomość nie dostaje toasta

- **Gdzie:** `src/lib/chat/useIncomingChatToasts.ts:327-335` (`if (previous !== undefined && unread <= previous) return;`).
- **Dowód:**
  - Realtime nie odtwarza zdarzeń z czasu zerwanego gniazda (uśpiony laptop, karta w tle z dławionym heartbeatem).
  - Scenariusz: punkt odniesienia 3, rozmowa przeczytana na telefonie (`unread → 0` nie dociera), potem nowa wiadomość
    (`unread = 1 ≤ 3`) i brak toasta.
  - Kolejne wiadomości już działają, bo `remember` uczy się nowej, niższej wartości (sonda P5: toasty dla 2, 3 i 4,
    brak dla 1).
- **Poprawka (tania, bez dodatkowych zapytań):**
  - trzymać obok licznika `last_read_at` (i `cleared_before`) z ładunku;
  - gdy w zdarzeniu się zmieniły, punkt odniesienia jest nieważny: `schedule(..., needsSignature = true)`;
  - alternatywnie potraktować `0 < unread < previous` jako utratę punktu odniesienia i wymagać podpisu.
  - Test: punkt odniesienia 3, potem `deliver(unread: 1)` z nowym `last_read_at` daje toast.

### N4 — MINOR (UX): toast pojawia się po przeczytaniu rozmowy w innej karcie lub na innym urządzeniu, jeśli zdarzenie przyszło w trakcie RPC profilu

- **Gdzie:** `useIncomingChatToasts.ts:274-281`.
- **Dowód:**
  - `unread → 0` przychodzi, gdy `announce` czeka na `resolvePeer`. `dismissIncomingChatToast` to wtedy no-op, bo
    identyfikatora jeszcze nie ma w `shownToasts`.
  - Po RPC toast i tak się pokazuje i wisi 6 s nad przeczytaną rozmową (sonda P2: 1 toast, 0 zdjęć).
  - Okno to czas RPC, czyli pierwsza wiadomość nadawcy w sesji, zanim profil trafi do pamięci.
- **Poprawka:** po odczytach dołożyć `if ((lastUnread.get(conversationId) ?? 0) <= 0) return;` obok
  `isCurrent` i `isConversationFocused`. Test na wzór P2.

### N5 — MINOR (UX/regresja): zdjęcie bez podpisu pokazuje surową nazwę pliku

- **Gdzie:** `useIncomingChatToasts.ts:178-179` oraz test `useIncomingChatToasts.test.tsx:803`.
- **Dowód:**
  - `messages_after_insert` zapisuje dla `image` i `file` wartość
    `COALESCE(NULLIF(left(body,140),''), attachment_name)` (`20260713100000_…sql:139`).
  - Klient wysyła nazwę oryginału (`attachments.ts:139`, `name: file.name`).
  - Toast pokazuje więc „Zdjęcie - IMG_4521.HEIC” (sonda P3), lista rozmów samo „Zdjęcie” (`ConversationListItem.tsx:79`),
    a stary hak przy braku podpisu też dawał samo „Zdjęcie”.
  - Test zakłada `last_message_preview = null`, czego trigger nigdy nie zapisze dla zdjęcia.
- **Poprawka:**
  - dla `image` zwracać samo `chat.photo`, spójnie z listą. Podpisu nie da się odróżnić od nazwy pliku w denormalizacji;
  - test zmienić na `preview = "IMG_….HEIC"`.

### N6 — MINOR: zanim wczytają się preferencje, kanał się otwiera i toasty są włączone

- **Gdzie:** `WorkspaceDock.tsx:172-176`.
- **Dowód:**
  - `data === undefined` daje `enabled`.
  - Po twardym wczytaniu (pusty cache) użytkownik z `enabled_message=false` albo `nobody` przechodzi przez join, a po
    RTT przez leave.
  - Wiadomość w tym oknie daje toast wbrew jego jawnemu ustawieniu, co dla trybu cichego jest najbardziej widoczne.
- **Poprawka:** traktować `isPending` jako „wyłączone”, a błąd odczytu nadal jako „włączone”, np.
  `const prefsQ = useNotificationPreferences(); const allowed = prefsQ.isError || (prefsQ.isSuccess && …)`.
  Odpada przy okazji wahnięcie join/leave.

### N7 — MINOR: na `/messages` z otwartą skrzynką doku akcja daje znów dwa okna rozmów

- **Gdzie:** `WorkspaceDock.tsx:205-209`.
- **Dowód:**
  - Gałąź `/messages` nawiguje stronę na `?c=<id>`, ale skrzynki doku nie zamyka.
  - Członek, który na `/messages` otworzył „Czaty” w doku, po „Otwórz rozmowę” ma rozmowę X na stronie i inną w skrzynce.
    Właśnie temu miała zapobiec poprawka UX7.
- **Poprawka:** w tej gałęzi `if (stateRef.current.open === "chat") dispatch({ type: "close" })`. Druga możliwość: przy
  otwartej skrzynce przełączać rozmowę w skrzynce.

### N8 — NIT (UX): nowy odstęp toastu nachodzi na otwarty panel narzędzia na desktopie

- **Gdzie:** `sonner.tsx:12`, `WorkspaceDock.tsx:429-433`.
- **Dowód:**
  - Panel jest prawy, dolny, z `bottom = pasek + 8 px`.
  - Toast (`bottom-right`) stoi na `--mbb-reserve + 24 px`, czyli pasek + 32 px, i ma z-index sonnera.
  - Wcześniej toast przykrywał pasek, teraz przykrywa dół otwartego panelu (pole dodawania zadania lub notatki) na 6 s.
  - Na telefonie dymki zminimalizowanych rozmów: ryzyko opisane w IMPL-fix1.
- **Poprawka:** do decyzji, kompromis do przyjęcia. Ewentualnie przesunąć region toastów, gdy panel jest otwarty.

### N9 — NIT (dokumentacja): nieaktualne komentarze

- `src/routes/__root.tsx:176-179` i `:494-497` nadal twierdzą, że „sonner nie odtwarza historii”. To sprzeczne z
  poprawionym `notify.ts:20-25` i ze źródłem sonnera 2.0.8 (`dist/index.mjs:139-144`).
- `vite.config.ts:478, 488-490`: komentarz „sonner importuje wyłącznie react/react-dom” przestaje być prawdą, bo
  `vendor-sonner` importuje teraz `vendor-i18n`. Cyklu nie ma, a `check-entry-purity` tej krawędzi nie bramkuje.
- IMPL-fix1, sekcja 0: `conversation_participants` ma `REPLICA IDENTITY DEFAULT` (`20260710094245_…sql:116`), a nie FULL.
  Na logikę to nie wpływa, bo hak nie używa `old`.
- Komentarz w kodzie haka jest poprawny.
- Komentarze nie zmieniają bajtów buildu.

### N10 — NIT (odporność): handler toastów może zagłodzić listę rozmów na wspólnym kanale

- **Gdzie:** `src/lib/realtime/tableChannelHub.ts:64-66` (`for (const h of created.handlers) h(payload);`) i
  `useIncomingChatToasts.ts:319-342`.
- **Dowód:**
  - Dok rejestruje handler pierwszy, więc wyjątek w `handleChange` przerwałby pętlę przed handlerem
    `useChatListRealtime`: unieważnieniem listy i potwierdzeniem dostarczenia.
  - Dziś `handleChange` nie rzuca w praktyce (`CSS.escape`, `querySelector`, `Date`), ale to nowa zależność między
    funkcjami.
- **Poprawka:** ciało `handleChange` w `try/catch` albo izolacja handlerów w hubie.

### Luki w testach (drobne)

- Brak testu propsów `Toaster` (`offset`, `mobileOffset`, `containerAriaLabel`).
- Brak testu „seria przy pierwszym zdarzeniu” (P1 działa, ale nic tego nie pilnuje).
- Brak testów do N3, N4 i N5 (podgląd zdjęcia z nazwą pliku).

---

## 5. Lista kontrolna dla Verify

1. **Boot:** `BUNDLE_INVENTORY=1 build:smoke`, a potem `check-document-weight`. `bootClosureRawBytes` ma mieć Δ ≤ 0
   (symulacja: ok. −43 B). Każdy wzrost jest blokujący, a odwrót opisuje N2.
2. **Diff `chunk-inventory.json`:**
   - wejście zmienia się wyłącznie w listach `__vite__mapDeps`;
   - `ChatUnreadBadge-*` traci `vendor-sonner` i `i18n-chat`;
   - `DockEmptyState-*` zyskuje hak i, bez N1, importy `NotificationsUnreadBadge-*`, `podcasts.index-*`
     i `admin.companies._id-*`;
   - brak nowych chunków.
3. `check:entry-purity` i `check-bundle-size` mają być zielone.
4. **e2e seeded** (osobne zadanie, jak w rundzie 1):
   - `admin@nes.local` nie dostaje toasta z cudzej rozmowy;
   - odbiorca dostaje toast z pierwszej wiadomości nowej rozmowy;
   - przeczytanie na drugim kontekście zdejmuje toast.
