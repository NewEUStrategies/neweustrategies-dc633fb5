# Czat: refaktor organizmu na atomy, 607 testów i trzy zapory CI (2026-08-18)

Zamknięcie pozycji **„Gęstość testów: 4/10 - T/P 0,111, bez ruchu w tej delcie, przy
12 293 liniach"** z audytu `OCENA_FUNKCJI_TABELE_2026-08-14.md` (MODUŁ 9) oraz otwartej
rekomendacji **„Zgłoś brak w oknie czatu"** z tej samej tabeli.

Ocena modułu brzmiała: _architektonicznie dobry, testowo najsłabszy - i to się nie
zmienia_. Kluczowe jest drugie zdanie: pokrycie stało na 17-20% przez **trzy kolejne
pomiary**, a dwa defekty tej generacji wykrył człowiek czytający kod, nie test.

---

## 1. Stan wyjściowy: pomiar bez zapory

| Powierzchnia          | Instrukcje | Gałęzie | Funkcje |  Linie |
| --------------------- | ---------: | ------: | ------: | -----: |
| `src/lib/chat`        |     19,67% |  20,54% |  18,13% | 20,90% |
| `src/components/chat` |     17,32% |  14,81% |  12,85% | 18,20% |

Trzy pliki, które decydują o tym, czy wiadomość dojdzie, stały praktycznie na zerze:

| Plik                  | Linie kodu | Pokrycie |
| --------------------- | ---------: | -------: |
| `ChatWindow.tsx`      |       1212 |       0% |
| `useMessages.ts`      |        713 |       0% |
| `useConversations.ts` |        563 |   12,24% |

### 1.1 Dlaczego pokrycie NIE ruszało

Nie z braku chęci - z **kosztu wejścia**, i był on policzalny w trzech miejscach:

1. **Warstwa danych rozmawia z bazą przez ŁAŃCUCH PostgREST**
   (`.from().select().eq().or().order().order().limit()`), nie przez pojedyncze `rpc()`.
   Każdy test musiał zbudować własną atrapę łańcucha - a atrapa, która rozwiązuje się
   za wcześnie, gubi połowę ogniw i test przestaje cokolwiek dowodzić.
2. **Reguły mieszkały w `useMemo`-ach organizmu.** Kolejność wiadomości, deduplikacja
   bliźniaka optymistycznego, miejsce separatora „nieprzeczytane", odsiew wygasłych
   wiadomości, budżet stron przy skoku do trafienia - żadnej z nich nie dało się
   sprawdzić bez wyrenderowania całego okna czatu razem z sesją, tenantem, kanałem
   realtime i kompozytorem.
3. **Powtórzony JSX zamiast komponentów.** Cztery kopie przycisku ikonowego, dwa
   niezależne paski nagłówka, trzy kopie dialogu potwierdzenia - test każdej kopii
   osobno nie ma sensu, a testu jednej wspólnej rzeczy nie było czego napisać.

---

## 2. Refaktor: organizm -> atomy

`ChatWindow.tsx`: **1165 -> 643 linii kodu (-45%)**. Plik jest teraz WYŁĄCZNIE
kompozycją - spina warstwę danych z częściami prezentacyjnymi i przekazuje intencje.

| Nowy moduł                      | Co wyniósł z organizmu                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/chat/thread.ts`            | kolejność wątku, separator nieprzeczytanych, ścieżki załączników, deskryptor podtytułu, nazwa autora, profile reagujących, mapowanie werdyktów serwera |
| `lib/chat/useTypingRegistry.ts` | zbiór piszących + niezależny licznik wygaszenia per osoba                                                                                              |
| `lib/chat/useThreadJump.ts`     | maszyna stanów skoku do trafienia z budżetem stron                                                                                                     |
| `lib/chat/useAutoMarkRead.ts`   | oznaczanie przeczytania + reaktywna widoczność karty                                                                                                   |
| `lib/chat/menuOptions.ts`       | katalog okien wyciszenia i TTL (lustro CHECK-a)                                                                                                        |
| `ChatWindowHeader.tsx`          | oba paski nagłówka z JAWNYM `variant`                                                                                                                  |
| `ConversationMenu.tsx`          | menu rozmowy (~190 linii JSX z czterema parami stan/etykieta)                                                                                          |
| `ChatWindowDialogs.tsx`         | wszystkie warstwy modalne                                                                                                                              |
| `ChatIconButton.tsx`            | przycisk ikonowy rzędu akcji - jeden kontrakt a11y dla wszystkich                                                                                      |
| `ChatConfirmDialog.tsx`         | potwierdzenie operacji nieodwracalnej                                                                                                                  |
| `BlockedComposerNotice.tsx`     | pasek zamiast kompozytora przy blokadzie                                                                                                               |

### 2.1 Deskryptory zamiast napisów

`headerSubtitle()` zwraca `{kind:"group", members, online}` albo `{kind:"direct", online}` -
**dane, nie tekst**. Odmiana liczebników („2 uczestnicy" vs „5 uczestników") zostaje
w słowniku PL/EN, reguła zostaje w module, a test reguły nie zależy od copy. Ta sama
zasada w `sendErrorMessageKey()`: funkcja zwraca KLUCZ i18n albo `null`.

---

## 3. Defekty, które wyszły dopiero pod testem

Refaktor sam z siebie nie znajduje błędów. Znalazły je testy pisane do wyekstrahowanych
modułów - i to jest jedyny dowód, że ekstrakcja miała sens.

### 3.1 `orderThreadMessages`: przy duplikacie wygrywała kopia STARSZA

Wersja z `ChatWindow` iterowała spłaszczoną listę **od końca**, więc przy tym samym `id`
w dwóch stronach cache'u wygrywała kopia ze strony NAJSTARSZEJ - dokładnie odwrotnie, niż
mówił jej własny komentarz („bliźniak z realtime … tam ląduje wersja serwerowa").
Praktycznie nie dawało widocznej awarii, bo `upsertMessageInCache` łata wiersz we
wszystkich stronach, a wiersz optymistyczny ma inne `id` niż serwerowy (dedup nigdy ich
nie dotyczył - to robi `replaceId`). Ale reguła była inna niż udokumentowana, więc przy
pierwszym realnym rozjeździe stron wygrałaby kopia stara.

### 3.2 `useAutoMarkRead`: koalescencja gasła po pierwszym renderze

Pierwsza wersja hooka (napisana w tym PR) zerowała klucz koalescencji **osobnym efektem**
na zmianie `conversationId`. Efekty biegną w kolejności deklaracji, więc ten drugi
czyścił ref zaraz po pierwszym oznaczeniu - i każda późniejsza zmiana `unreadCount`
(a ta zmienia się przy KAŻDYM refetchu listy) wołała `mark_conversation_read` ponownie.
Klucz niesie teraz rozmowę (`<conversationId>:<messageId>`), bez drugiego efektu.
Dwa testy oznaczone `REGRESJA:` przypinają oba scenariusze.

### 3.3 Nagłówek: avatar w wariancie „page" nie prowadził do profilu

Wariant dokowany linkował avatar do `/author/$slug`, wariant pełnoekranowy nie - ta sama
rozmowa, ta sama tożsamość, dwa różne zachowania. Dodatkowo gałąź kręgu przekazywała
`to={slug ? … : undefined}`, choć slug kręgu jest **zawsze** NULL-em (krąg to nie osoba) -
martwy kod udający funkcję.

### 3.4 Atrapa błędu, która przechodziła OBOK testowanej gałęzi

`PostgrestError` w supabase-js **dziedziczy po `Error`**. Pierwsza wersja fixture'ów
zwracała goły obiekt `{message}`, więc `err instanceof Error` było `false`, a test
mapowania komunikatów „dowodził", że mapowanie nie działa - choć w produkcji działa.
Wierność atrapy jest tu warunkiem sensu testu, nie kosmetyką.

---

## 4. Testy: 607 przypadków w 33 plikach

### 4.1 Atomy testowe (`src/test/chat/fixtures.ts`)

Atomic design zastosowany do testów, dokładnie jak w `src/test/network/fixtures.ts`.
Jedno źródło prawdy dla:

- **fabryk wierszy** 1:1 z `Database["public"]["Tables"][…]["Row"]` - rozjazd kolumny
  w migracji wychodzi na typach w KAŻDYM teście, który tego wiersza używa,
- **thenable atrapy łańcucha PostgREST** - rozwiązuje się dopiero przy `await` albo
  `.single()`, więc test widzi dokładnie te ogniwa, które kod naprawdę wywołał;
  brak zaplanowanej odpowiedzi to BŁĄD, nie ciche `[]`,
- **atrapy realtime** z obserwowalnym refcountem, `emitPostgres`/`emitBroadcast`/`emitStatus`,
- **atrapy storage** (podpisy pojedyncze i batch, URL uploadu),
- **stubu i18n** echującego klucz.

Skutek: zmiana kontraktu warstwy danych psuje JEDEN plik, nie osiemnaście.

### 4.2 Co testy pilnują

Nie „czy się renderuje", a **czy gwarancja nadal obowiązuje**:

| Gwarancja                                                                            | Gdzie                             |
| ------------------------------------------------------------------------------------ | --------------------------------- |
| stempel `tenant_id` na KAŻDYM zapisie (wiadomość, reakcja, blokada)                  | `useMessages`, `chatDataHooks`    |
| tożsamość wątku z `direct_key`, gdy RLS ukrył wiersz rozmówcy                        | `useConversations`                |
| licznik nieprzeczytanych z TEGO SAMEGO zapytania (zero dodatkowych round-tripów)     | `useConversations`                |
| kursor złożony `(created_at, id)` - bez tiebreakera gubi wiersze z granicy sekundy   | `useMessages`                     |
| JEDEN kanał „typing" na rozmowę z refcountem (bez niego rozmówca nie dostaje pingów) | `useMessages`                     |
| potwierdzenia w kręgu: przeczytane tylko gdy WSZYSCY                                 | `display`, `ConversationListItem` |
| kwota uploadów sprawdzana PRZED podpisem URL-a                                       | `attachments`                     |
| allowlista MIME bez SVG i limit 30 MB                                                | `attachments`                     |
| okres łaski presence (brak mignięcia „wszyscy offline" przy remouncie trasy)         | `presence`                        |
| limit okien doku zależny od viewportu; przepełnienie MINIMALIZUJE, nie odrzuca       | `ChatDock`                        |
| przekazanie WYŁĄCZNIE tekstu (ścieżka załącznika niesie id rozmowy źródłowej)        | `chatSurfaces`                    |
| snippet FTS renderowany komponentem, NIGDY przez `innerHTML`                         | `chatSurfaces`                    |
| izolacja cache'u między kontami (każdy klucz niesie `uid`)                           | `keys`                            |

### 4.3 Wynik

| Powierzchnia                                                    |  Przed |                         Po |
| --------------------------------------------------------------- | -----: | -------------------------: |
| `src/lib/chat` (instrukcje)                                     | 19,67% |                     78,52% |
| `src/lib/chat` (funkcje)                                        | 18,13% |                     84,82% |
| `src/components/chat`                                           | 17,32% |                     44,63% |
| `ChatWindow.tsx`                                                |     0% |                     83,55% |
| `useMessages.ts`                                                |     0% |                     90,42% |
| `useConversations.ts`                                           | 12,24% |                     94,89% |
| `thread.ts` / `menuOptions.ts` / `useThreadJump.ts` / `keys.ts` |      - | 100% na czterech metrykach |

Co ZOSTAJE nieotestowane i dlaczego to nie jest ukryte: kompozytor (585 linii), panel
mediów, dialogi kręgu i wyglądu, katalog osób, pseudonimy, toasty przychodzące
i nagrywanie głosu (MediaRecorder). Każda z tych powierzchni ma własną warstwę danych,
której ten PR nie dotykał - są następnym krokiem, nie regresją tego.

### 4.4 Domknięcie zerowych modułów warstwy danych

Osobna partia po pierwszym pomiarze, bo `src/lib/chat` miał jeszcze pięć plików bez ani
jednej asercji, a każdy niesie warunek poprawności widoczny dla użytkownika albo dla
INNYCH użytkowników:

- `expertRequestDialogBus` ma **replay**: host dialogu jest `React.lazy`, więc klik w CTA
  może paść przed pobraniem jego chunka. Trzy warunki bez których prefill przepada:
  odtworzenie pierwszemu subskrybentowi, zużycie replayu RAZ, unieważnienie zaległego
  żądania przez zamknięcie.
- `emoji.ts` (467 linii) - poza wyszukiwaniem dwujęzycznym testy pilnują inwariantów
  DATASETU: brak duplikatów emotki i brak wielkich liter w słowach kluczowych (wielka
  litera czyni wpis niewyszukiwalnym, bo porównanie idzie po lowercase).
- `useDiscoverable` - trzy przełączniki prywatności profilu. Wspólna reguła: zapis
  zawężony `.eq("id", user.id)`, bo grant UPDATE na `profiles` ma `authenticated`, nie
  tylko właściciela. Domyślne wartości przy braku wiersza są RÓŻNE per pole: brak wiersza
  to „nie w katalogu" (false), ale „przyjmuję zapytania" (true).
- `useExpertRequests` - normalizacja zwrotki RPC (wartość nieliczbowa schodzi na zero,
  nie na NaN w interfejsie; `unlimited` wymaga DOKŁADNIE `true`), pomijanie pustych pól
  opcjonalnych (RPC ma rozróżniać „nie podano" od „podano nic") i zakres unieważnień -
  wysłanie odświeża skrzynkę I pulę, bo anulowanie nie zwraca limitu.

---

## 5. Trzy zapory, żeby pomiar znów nie zamarł

### 5.1 Progi pokrycia per ścieżka (`vitest.config.ts`)

Pokrycie stało w miejscu przez trzy pomiary, bo **sam pomiar niczego nie pilnuje**.
Progi floorowane ~4 pp pod zmierzonym poziomem (marża na dryf CI); zasada jak wszędzie
w tym pliku: wolno je wyłącznie podnosić. Czyste moduły wątku dostają 100% na wszystkich
czterech metrykach - one niosą reguły, których złamanie widzi WYŁĄCZNIE użytkownik.

| Ścieżka                                             | instrukcje / funkcje / linie / gałęzie | zmierzone                 |
| --------------------------------------------------- | -------------------------------------- | ------------------------- |
| `src/lib/chat/**`                                   | 74 / 80 / 77 / 67                      | 78,5 / 84,8 / 81,9 / 71,9 |
| `src/lib/chat/useMessages.ts`                       | 86 / 87 / 91 / 78                      | 90,4 / 91,5 / 95,7 / 82,5 |
| `src/lib/chat/useConversations.ts`                  | 90 / 96 / 96 / 80                      | 94,9 / 100 / 100 / 84,3   |
| `src/components/chat/**`                            | 40 / 36 / 41 / 34                      | 44,6 / 40,0 / 45,6 / 38,3 |
| `src/components/chat/ChatWindow.tsx`                | 78 / 60 / 84 / 70                      | 83,6 / 64,4 / 88,1 / 75,2 |
| `src/lib/ci/ftsConfigSymmetry.ts`                   | 93 / 100 / 98 / 81                     | 95,9 / 100 / 100 / 84,4   |
| `thread` / `menuOptions` / `useThreadJump` / `keys` | 100 / 100 / 100 / 100                  | 100 na czterech           |

### 5.2 Bramka symetrii FTS (`src/lib/ci/ftsConfigSymmetry.ts`)

Drugi defekt z audytu - `20260720160000_chat_message_search.sql` deklarowało w nagłówku
FTS „z polską fleksją", a wektor i podświetlenie stały na `simple` - przeżył **siedem
wydań audytu**, bo nie widzi go nic z warstwy kontrolnej repo: `tsc` (to napis w SQL-u),
wykonanie migracji (obie konfiguracje istnieją), testy (nikt nie szukał odmienionej
formy) ani bramki `check:sql-*` (patrzą na tenanty, role i granty, nie na słowniki).

Bramka czyta migracje i sprawdza, że konfiguracja **BUDOWY wektora**, **ZAPYTANIA**
i **PODŚWIETLENIA** jest ta sama. Rozwiązuje przy tym:

- budowniczych zapytań (`RETURNS tsquery` -> konfiguracja z literału),
- budowniczych **wektorów** (`RETURNS tsvector`): `posts` i `pages` nie wołają
  `to_tsvector` w triggerze, tylko `public.nes_posts_search_vector(…)` - konfiguracja
  siedzi wewnątrz tej funkcji,
- kolumny wektorowe z `GENERATED ALWAYS AS` i z triggerów (`NEW.<kol> := …`),
- **aliasy tabel** z klauzul FROM/JOIN oraz **CTE** (łańcuchowo, `CTE -> CTE -> tabela`) -
  i to jest warunek poprawności, nie wygoda: kolumna `search_vector` żyje w tym repo
  w siedmiu tabelach, część świadomie na `simple`, część na `public.nes_polish`. Pierwsza
  wersja bramki dopasowywała po samej nazwie kolumny i produkowała 27 fałszywych alarmów.

Bramka **ocenia całą historię migracji** (`SYMMETRY_ENFORCED_FROM = "00000000000000"`) -
wszystkie **siedem** powierzchni szukających repo: `search_posts`, `search_quick`,
`search_facets`, `search_messages`, `run_saved_search_alerts`, `club_search`,
`club_thread_search`. Pierwsza wersja stała na progu `20260815090000` (spłata długu
czatu) i oceniała **jedną** powierzchnię, bo pozostałych sześciu nie umiała przeczytać:
`posts`/`pages` budują wektor funkcją pomocniczą, a wyszukiwarki klubów porównują wektor
przez CTE. Po domknięciu obu ścieżek cały katalog jest symetryczny, więc próg przestał
być potrzebny - zamrożona historia, której nie umiemy przeczytać, to nie to samo co
historia przeczytana i czysta. Próg został jako pokrętło (i punkt odniesienia
`CHAT_FTS_DEBT_PAID_IN`), a test pilnuje, że nie wrócił po cichu.

To, czego nie rozstrzygnęła, raportuje jako `unresolved` - i **zatrzymuje CI**
(`gateFailed`), zamiast udawać zieleń. Sonda historyczna potwierdziła, że przy progu
z 20.07 bramka zgłasza oryginalny dług słowami: `wektor messages.search_vector budowany
w 'simple', odpytywany w 'public.nes_polish'`.

Cztery defekty własne bramki, złapane testem, zanim wyszły z gałęzi:

| Defekt                                                                                | Skutek, gdyby przeżył                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| raport mówił „OK", gdy `violations` puste, choć `unresolved` niepuste                 | zieleń nad powierzchnią, której nikt nie sprawdził      |
| zakres liczony z daty samej funkcji, nie z jej zależności                             | nowa migracja psuje starą wyszukiwarkę bez alarmu       |
| `websearch_to_tsquery` uznawane za nieznanego budowniczego (wzorzec `^(?:…)_tsquery`) | dwie wyszukiwarki klubów w `unresolved` = czerwone CI   |
| trigger wiązany wzorcem przez CAŁY plik - brał tabelę z pierwszego `CREATE TRIGGER`   | wektor `pages` pod kluczem `posts`, `pages` niewidoczna |

### 5.3 Parytet PL/EN

Nowy klucz `chat.menu.report` w obu drzewach; parytet struktury pilnuje istniejący
`src/lib/__tests__/i18nChat.test.ts`.

---

## 6. Zgłoszenie osoby do moderacji z okna rozmowy

Otwarta rekomendacja audytu. Do teraz zgłoszenie istniało wyłącznie na profilu autora
i w popoverze sieci kontaktów - czyli **nie tam, gdzie problem się dzieje**. Menu rozmowy
dostaje pozycję „Zgłoś osobę", widoczną tylko w wątku bezpośrednim (zgłasza się OSOBĘ,
a w kręgu nie wiadomo którą), wpiętą w istniejący `ReportUserDialog`.

Reużycie, nie kopia: powody, limit dzienny i deduplikację egzekwuje ten sam RPC
`report_user`, więc drugi dialog o tej samej treści byłby tylko drugim miejscem do
rozjazdu z listą powodów w bazie.

---

## 7. Czego ten PR NIE robi

- **Nie podnosi globalnego floora pokrycia repo.** Wymaga pomiaru całego `src/`,
  a pełny przebieg z instrumentacją nie domknął się w środowisku wdrożeniowym.
  Zgadywanie progu, który wywraca CI, jest gorsze niż próg o kilka punktów za niski.
- **Nie rozstrzyga losu demo-bota** (audyt: „lokalne echo, duplikuje ~300 linii UI,
  wyciąć albo podłączyć realny backend"). To decyzja produktowa, nie techniczna.
- **Nie dokłada powierzchni serwerowej** - pgTAP czatu (`chat_privacy_isolation_test.sql`,
  `chat_contacts_search_and_privacy_test.sql`) zostaje bez zmian; oba wskazane defekty
  mają tam już asercje.
