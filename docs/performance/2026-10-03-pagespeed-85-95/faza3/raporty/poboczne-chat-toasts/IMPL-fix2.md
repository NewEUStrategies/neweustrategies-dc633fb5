# Toasty nowych wiadomości czatu: poprawki po recenzji 2 (fix2)

- Gałąź `feat/w3-chat-toasts`, worktree `scratchpad/wt3/chat-toasts`.
- Nowy commit **`ee8af71d`** na `3c10e030`. Baza: `claude/zen-ritchie-hzur21` (`56da8d23`).
- Recenzja: `REVIEW-2.md` (approve, N1-N10 i „Luki w testach”).
- Numery linii dotyczą stanu po tym commicie.

## Werdykt w skrócie

- Zrobione: N1, N3, N4, N5, N6, N7, N8, N9 i N10.
- N2: zmierzone. Domknięcie bootu nie rośnie względem bazy: raw −20 B, gzip −18 B, burst ±0 B.
  Odwrót opisany w recenzji jest niebezpieczny, więc go nie stosuję (uzasadnienie w N2).
- N10 jest zrobione w obsłudze toastów, nie w hubie. Zmiana huba przetasowała chunki i dawała +72 B w bootcie (sekcja 4).
- Przy okazji: 3c10e030 zostawił czerwony test `sonnerTheme.test.tsx`. Region toastów nazywa się teraz
  „Powiadomienia”, a test szukał „Notifications”. Runda 1 nie uruchamiała testów `src/components/ui`. Test naprawiony.

---

## 1. Ustalenia: co zrobiłem

### N3: zgubione „przeczytane” blokowało toast pierwszej nowej wiadomości

**Co było.** Punktem odniesienia był sam ostatnio widziany `unread_count`. Realtime nie odtwarza zdarzeń
z czasu zerwanego gniazda. Jeśli przepadło zerowanie (odczyt na telefonie, wyczyszczenie historii), nowa
wiadomość dawała licznik równy albo niższy od zapamiętanego i nie dostawała toasta.

**Co jest teraz** (`src/lib/chat/useIncomingChatToasts.ts`).

- Punkt odniesienia to `{ unread, readMark }` (`:134-142`). `readMark` = `id|last_read_at|cleared_before`
  wiersza (`:363`).
- Każde zerowanie zmienia znacznik:
  - `mark_conversation_read` ustawia `last_read_at = now()`;
  - `chat_clear_history` ustawia `cleared_before`;
  - ponowne wejście do kręgu daje nowe `id` wiersza.
- Trigger wiadomości nie rusza `last_read_at` odbiorcy (`20260713100000_…sql:146`). Potwierdzenie dostarczenia,
  przypięcie i wyciszenie też nie.
- Punkt odniesienia jest wiarygodny (`trusted`, `:375-377`), gdy znacznik się nie zmienił i licznik nie spadł.
  - Wiarygodny i licznik równy: nic się nie dzieje, jak dotąd.
  - Wiarygodny i licznik wyższy: toast bez podpisu, jak dotąd.
  - Niewiarygodny: rozstrzyga podpis transakcji (`updated_at == last_message_at`), czyli ta sama bramka co przy
    pierwszym zdarzeniu.
- Nie ma dodatkowych zapytań. Znacznik przychodzi w ładunku zdarzenia.

**Fałszywych pozytywów nie ma.** Zdarzenie, które nie jest transakcją wiadomości (np. potwierdzenie
dostarczenia po przebudzeniu), nie ma podpisu, więc toasta nie daje. Wiadomości zaległe z czasu snu nie
dostają spóźnionego toasta.

### N4: toast po przeczytaniu gdzie indziej w trakcie RPC profilu

Po odczytach (`:313`) dochodzi warunek `if ((baselines.get(conversationId)?.unread ?? 0) <= 0) return;`. Stoi
obok `isCurrent` i `isConversationFocused`.

- Licznik 0, który przyszedł w trakcie RPC, wygasza toast, zanim powstanie.
- Nie leci też zdarzenie `nes:chat-incoming`.
- Wiadomość, która przyszła po takim odczycie, ustawia `again` w przebiegu rozmowy. Powtórka pokazuje toast
  z najnowszą treścią.

### N5: zdjęcie bez podpisu pokazywało surową nazwę pliku

`buildPreview` dla `image` zwraca samo `chat.photo` (`:196-212`), tak samo jak lista rozmów
(`ConversationListItem.tsx:79`).

- Trigger zapisuje w podglądzie `COALESCE(NULLIF(left(body,140),''), attachment_name)`, więc podpisu nie da się
  odróżnić od nazwy pliku.
- Plik nadal pokazuje „Plik: nazwa”. Nazwa jest tu informacją, a lista nie ma na nią miejsca.

### N6: przed wczytaniem preferencji kanał się otwierał

`src/components/dock/WorkspaceDock.tsx:186-192`:

```ts
const messageToastsAllowed = notificationPrefs
  ? notificationPrefs.enabled_message !== false &&
    notificationPrefs.allow_messages_from !== "nobody"
  : prefsQuery.isError;
```

| Stan zapytania  | Kanał                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| Wczytywanie     | wyłączony (brak join/leave przy „wyłączonych”)                                   |
| Błąd bez danych | włączony (jak przy innych flagach)                                               |
| Są dane         | decydują dane, także po błędzie odświeżenia (React Query zachowuje wtedy `data`) |

Wybrałem `data ?? isError`, a nie zaproponowane `isError || isSuccess && …`. Po błędzie odświeżenia zapytanie ma
status `error`, ale zachowuje dane. Wtedy `isError` włączałby toasty wbrew zapisanemu „wyłączone”.

### N7: `/messages` z otwartą skrzynką doku dawało dwa okna rozmów

W gałęzi `/messages` szyny jest teraz `if (stateRef.current.open === "chat") dispatch({ type: "close" });`
(`WorkspaceDock.tsx:225`). Potem następuje nawigacja na `?c=<id>`. Skrzynka schodzi z fazą wyjścia. Fokus wraca do
strony, na którą prowadzi nawigacja.

### N1: dok ciągnął statycznie 3 chunki przez `useNotificationPreferences`

**Nowy moduł** `src/lib/notifications/preferencesQuery.ts`:

- trzyma klucz cache `notificationPreferencesKey`, zapytanie i kształt danych (wartości domyślne
  i `NOTIFICATION_PREFERENCE_SELECT` z czystego `./preferences`);
- zawiera hak `useNotificationPreferences`;
- importuje tylko `@tanstack/react-query`, klienta Supabase, `useAuth` i `./preferences`.

**`useNotifications.ts`:**

- re-eksportuje hak i bierze klucz do unieważnień (`useUpdateNotificationPreferences`,
  `useNotificationPreferencesRealtime`);
- dzięki temu jest jedno źródło klucza i jeden wpis cache;
- pozostali konsumenci (dzwonek, centrum, `ChatWindow`, `presence`, prywatność) bez zmian.

**Dok** importuje z lekkiego modułu (`WorkspaceDock.tsx:71`).

**Wynik w buildzie** (`fix2/chunk-diff-fix2.txt`, `fix2/dock-closure.py`):

- `NotificationsUnreadBadge-*` (−2768 B raw, w tym −2247 B `preferences.ts`), `podcasts.index-*`
  i `admin.companies._id-*` wypadają z domknięcia doku;
- dochodzi jeden chunk `preferencesQuery-*`: 2839 B raw / 887 B gzip;
- według pomiaru recenzji (14,2 kB raw / ok. 5,1 kB gzip dla tych 3 chunków) domknięcie doku jest o ok.
  11,4 kB raw / 4,2 kB gzip mniejsze niż w 3c10e030.

**Domknięcie leniwe doku względem bazy:** 104 311 → 107 007 B gzip (+2 696 B):

| Chunk                            | Δ gzip   |
| -------------------------------- | -------- |
| hak i pasek w `DockEmptyState-*` | +1 785 B |
| `preferencesQuery-*`             | +887 B   |
| `vendor-sonner-*`                | +102 B   |

**Duplikatu żądania nie ma.** Test „pasek i dzwonek dzielą JEDEN wpis cache” montuje dok obok konsumenta ścieżki
dzwonka (`@/lib/notifications/useNotifications`). Wynik to jedno żądanie `notification_preferences`, a obaj
widzą ten sam obiekt.

### N2: wejście zmienia się przez `__vite__mapDeps`

**Zmierzone.** Wynik w sekcji 4: bez wzrostu. Krawędź `vendor-sonner` → `vendor-i18n` nadal dokłada 6 indeksów
(+12 B), ale całość zmian wejścia daje −20 B raw.

**Odwrotu z recenzji nie stosuję, bo jest niebezpieczny.** Recenzja proponuje w `sonner.tsx` `import i18n from "@/lib/i18n"`.
`src/components/ui/sonner.tsx` ma jednak nazwany chunk (`manualChunks` → `vendor-sonner`, `vite.config.ts:346`).
Rollup (`addStaticDependenciesToManualChunk`) dokłada do nazwanego chunku każdą statyczną zależność, która nie leży
w innym nazwanym chunku. Repo opisuje to samo zjawisko w komentarzu `vite.config.ts:347-356`. Skutki:

- `src/lib/i18n.ts` nie ma nazwanego chunku, więc przeszedłby do `vendor-sonner` razem z `localeRuntime`,
  `langCookie` i `storageKeys`;
- wejście importuje `@/lib/i18n` statycznie, więc musiałoby statycznie importować `vendor-sonner`;
- sonner trafiłby do bootu (ok. 10 kB gzip).

Ostrzeżenie zapisałem w komentarzu `sonner.tsx:19-26`.

### N8: toast nachodził na otwarty panel narzędzia

- **Dok** (`WorkspaceDock.tsx:139-145, 333-350, 473`): dopóki panel narzędzia jest otwarty, efekt mierzy węzeł
  `#workspace-dock-panel` i publikuje `--wd-panel-space: <wysokość>px` na `<html>`.
  - Robi to przy montażu i przy zmianie rozmiaru (`ResizeObserver`).
  - Zamknięcie i zejście paska zdejmują zmienną.
  - Skrzynka czatu (lewa krawędź) zmiennej nie ustawia.
- **`sonner.tsx:14-17`:** `bottom` = `--mbb-reserve` + `--wd-panel-space` + 24 px (telefon: 16 px). Toast staje nad
  panelem zamiast na jego polu wpisywania.
- **Gość:** żadnej zmiennej, odstępy domyślne.
- **Geometria:** wspólna dla motywów, brak CSS w bootcie.

### N9: nieaktualne komentarze

- **`src/routes/__root.tsx` (`:172-179`, `:490-495`):** sonner 2.x odtwarza aktywne toasty nowemu
  subskrybentowi. Toast sprzed montażu nie przepada, najwyżej pokazuje się później.
- **`vite.config.ts:477-495`:** biblioteka sonner importuje tylko React. Opakowanie `ui/sonner.tsx` dokłada
  jednokierunkową krawędź do `vendor-i18n`.
- **Komentarz nagłówkowy haka:** `conversation_participants` ma REPLICA IDENTITY DEFAULT. `FULL` z `20260710092108`
  nadpisuje `20260710094245_…sql:116`.
- **`IMPL-fix1.md`:** errata w sekcji 0 („Starego wiersza nie ma”).

### N10: handler toastów mógł zagłodzić listę rozmów na wspólnym kanale

Callback subskrypcji haka łapie wyjątki `handleChange` i oddaje je do `reportError`, a bez tej funkcji do
`console.error` (`useIncomingChatToasts.ts:174-178, 407-413`). Komentarz nagłówkowy opisuje tę zależność.

**Dlaczego nie w hubie.** Pierwsza wersja izolowała handlery w `tableChannelHub.ts` (try/catch w pętli).
`tableChannelHub.ts` zmienił przez to rozmiar, a Rollup (`experimentalMinChunkSize`) przegrupował małe chunki:

- hub wyszedł z `expertRequestStatus-*` do nowego `listAutoformat-*`;
- powstał `BulkActionBar-*`;
- zmieniło się kilkadziesiąt list preloadu w wejściu;
- wynik: +72 B raw w domknięciu bootu.

Izolacja w obsłudze toastów zamyka to samo ryzyko, czyli handler toastów rejestrowany pierwszy przed listą.
Hub zostaje bajt w bajt jak w bazie.

---

## 2. Testy (behawioralne)

### `src/lib/chat/__tests__/useIncomingChatToasts.test.tsx` (57, w tym 11 nowych)

- `:314` wyjątek w obsłudze toastu: lista na wspólnym kanale i tak unieważnia cache, a błąd idzie do `reportError` (N10).
- `:563` seria przy PIERWSZYM zdarzeniu rozmowy: niezgodny podpis pierwszej, potem toast z najnowszą (luka z recenzji, sonda P1).
- `:610` zgubione „przeczytane” 3 → 1: toast, a kolejna wiadomość już bez podpisu (N3).
- `:636` zgubione „przeczytane” przy równym liczniku 1 → 1 (N3).
- `:652` zgubione `cleared_before` (N3).
- `:667` licznik niższy bez znacznika (sonda P5) (N3).
- `:678` po zgubionym odczycie samo potwierdzenie dostarczenia, bez podpisu: brak toasta (N3, brak fałszywego pozytywu).
- `:756` przeczytane gdzie indziej w trakcie RPC profilu: zero toastów i zdarzeń (N4, sonda P2).
- `:776` nowa wiadomość po takim odczycie: toast z najnowszą treścią i jeden identyfikator (N4).
- `:1051` zdjęcie z `IMG_4521.HEIC` w podglądzie pokazuje „Zdjęcie” (N5, sonda P3).

Zmienione: test „zdjęcie z podpisem skleja oba człony” odwraca się w N5. Test przycinania podpisu załącznika przechodzi
na plik (`:1077`), bo zdjęcie nie ma już podpisu.

### `src/components/dock/__tests__/WorkspaceDock.incomingToasts.test.tsx` (23, w tym 5 nowych)

- `:419` przed wczytaniem preferencji nie ma kanału, a po „wyłączonych” nie powstaje ani razu (N6).
- `:432` po wczytaniu „włączonych” kanał się otwiera i doręcza (N6).
- `:444` błąd odczytu preferencji nie wyłącza toastów (N6).
- `:450` dok i ścieżka dzwonka (`useNotifications`) dają jedno żądanie i ten sam obiekt (N1).
- `:636` `/messages` z otwartą skrzynką: akcja nawiguje, skrzynka schodzi, zakładka `aria-expanded=false` (N7).
- Test „bez preferencji w cache…” czeka teraz na kanał (`waitFor`), bo kanał powstaje dopiero po odpowiedzi (N6).

### `src/components/dock/__tests__/WorkspaceDock.test.tsx` (3 nowe, N8)

- `:491` otwarty panel publikuje swoją wysokość, a zamknięcie ją zdejmuje.
- `:503` skrzynka czatu nie przesuwa toastów.
- `:512` zejście paska z otwartym panelem nie zostawia zmiennej.

Atrapa preferencji przeszła na `@/lib/notifications/preferencesQuery`, tak samo w `WorkspaceDock.ssr.test.tsx`.

### `src/components/ui/__tests__/sonnerPlacement.test.tsx` (NOWY, 4; luka „brak testu propsów Toaster”)

- lista (desktop i telefon) stoi nad `--mbb-reserve` i `--wd-panel-space`, z odstępem 24 i 16 px;
- boki zostają domyślne;
- region nazywa się „Powiadomienia alt+T” (ze słownika);
- wywołujący może nadpisać położenie.

### Pozostałe

- `sonnerTheme.test.tsx`: prawdziwy tłumacz (`@/test/i18nReal`), region `/^Powiadomienia/`. Naprawia czerwony test z 3c10e030.
- `sonner.test.tsx`: prawdziwy tłumacz, bez ostrzeżenia `NO_I18NEXT_INSTANCE`.

### Mutacje

Każda poprawka cofnięta osobno skryptem `mut2/mutate.py`, plik przywrócony z asercją równości:

| Mutacja                                   | Czerwone testy |
| ----------------------------------------- | -------------- |
| N3: stary punkt odniesienia               | 5              |
| N4: bez sprawdzenia licznika po odczytach | 1              |
| N5: „Zdjęcie - nazwa”                     | 1              |
| N6: wczytywanie = włączone                | 3              |
| N6: błąd = wyłączone                      | 1              |
| N7: bez zamknięcia skrzynki               | 1              |
| N8: bez publikacji                        | 2              |
| N8: bez sprzątania                        | 2              |
| N8: offset bez `--wd-panel-space`         | 1              |
| N10: bez try/catch w callbacku haka       | 1              |

---

## 3. Bramki (worktree, końcowe drzewo)

| Bramka                                                                                                                                                                                                                                                                                         | Wynik                                                                                            | Log                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------- |
| `bunx prettier --write` / `--check` (14 dotkniętych plików)                                                                                                                                                                                                                                    | bez zmian / OK                                                                                   | -                                |
| `light.sh bunx eslint` (te same pliki)                                                                                                                                                                                                                                                         | exit 0; 2 zastane ostrzeżenia `react-refresh` w `__root.tsx:482, 1335`                           | -                                |
| Typecheck: `heavy-bg.sh` + `typecheck-noinc.sh` (tsgo app, tsc scripts, tsgo e2e)                                                                                                                                                                                                              | exit 0, pusty log                                                                                | `typecheck-fix2.log(.exit)`      |
| `light.sh bunx vitest run` na `src/components/dock`, `src/lib/chat`, `src/lib/realtime`, `src/lib/notifications`, `src/components/notifications`, `src/components/chat`, `src/components/profile`, 3 testach sonnera, `SiteChrome`, `rootShellRender`, `rootRouterMount` i `src/lib/__tests__` | **250 plików, 5970 zielonych, 45 „expected fail”** (zastane `it.fails`), exit 0                  | `vitest-fix2.log`                |
| `light.sh bun run verify:static`                                                                                                                                                                                                                                                               | 15 bramek OK (242,5 s), w tym kontrakt TS↔SQL (nowy plik z literałem `notification_preferences`) | `verify-static-fix2.log`         |
| `heavy-bg.sh … env BUNDLE_INVENTORY=1 bun run build:smoke`                                                                                                                                                                                                                                     | exit 0                                                                                           | `build-fix2.log`                 |
| `light.sh bun run check:bundle`                                                                                                                                                                                                                                                                | exit 0, „Bundle within budget”                                                                   | `check-bundle-fix2.log`          |
| `check:entry-purity`                                                                                                                                                                                                                                                                           | exit 0                                                                                           | `fix2/check:entry-purity.log`    |
| `check:chunks`                                                                                                                                                                                                                                                                                 | exit 0, graf acykliczny (894 chunki)                                                             | `fix2/check:chunks.log`          |
| `check-document-weight --json`                                                                                                                                                                                                                                                                 | „Waga dokumentu w progach”                                                                       | `document-weight-fix2.json/.log` |
| e2e artefaktowe (`heavy-bg.sh`, env jak w CI: `NES_ARTIFACT_FIXTURE=1`, placeholdery Supabase)                                                                                                                                                                                                 | **12/12 passed** (57,2 s), exit 0                                                                | `e2e-fix2.log`                   |

---

## 4. Boot: pomiar

Waga dokumentu `/` (fixture, 5 próbek):

| Metryka                  | Baza (`verify/document-weight-base.json`) | 3c10e030 (`verify/document-weight.json`) | fix2 (`document-weight-fix2.json`) | Δ vs baza | Δ vs 3c10e030 |
| ------------------------ | ----------------------------------------- | ---------------------------------------- | ---------------------------------- | --------- | ------------- |
| **bootClosureRawBytes**  | 1 636 946                                 | 1 635 066                                | **1 636 926**                      | **−20**   | +1 860        |
| **bootClosureGzipBytes** | 496 041                                   | 495 483                                  | **496 023**                        | **−18**   | +540          |
| **bootBurstGzipBytes**   | 574 062                                   | 573 510                                  | **574 062**                        | **±0**    | +552          |
| bootBurstCount           | 26                                        | 26                                       | 26                                 | 0         | 0             |
| htmlGzipBytes            | 52 540                                    | 52 546                                   | 52 541                             | +1        | −5            |
| preLcpTransferBytes      | 177 698                                   | 177 704                                  | 177 699                            | +1        | −5            |

**Skład bootu jest identyczny jak w bazie.** `fix2/boot-diff-fix2.txt`:

- do domknięcia nie wchodzi ani nie wychodzi żaden moduł;
- wejście `index-*` ma 863 566 B wobec 863 586 B w bazie;
- różnica leży wyłącznie w `__vite__mapDeps` (`fix2/mapdeps-diff.py`):
  - +38 B: nazwa nowego chunku `preferencesQuery-*` w tablicy plików;
  - +4 B na każdą listę konsumentów `useNotifications`;
  - +12 B: `vendor-i18n` w 6 listach przez sonnera;
  - −4 B na każdą listę, z której znika `i18n-chat` (hak wyszedł z `ChatUnreadBadge-*`);
  - −8 do −12 B na listach `network*` i `people.index` bez `NotificationsUnreadBadge-*`, `podcasts.index-*`
    i `admin.companies._id-*`.

**Względem 3c10e030 jest „więcej”, ale to nie jest wzrost.** 3c10e030 zszedł o −1 880 B przypadkiem: Rollup przegrupował
13 małych modułów z wejścia do leniwych chunków, a gość dociągał je potem (+1 żądanie, VERIFY §5). Tutaj tego
przypadku nie ma. Zmieniło się 7 chunków, a nie 25 (`fix2/chunk-diff-fix2.txt`):

- `DockEmptyState`;
- `preferencesQuery` (nowy);
- `NotificationsUnreadBadge`;
- `vendor-sonner`;
- `ChatUnreadBadge`;
- `index`;
- `i18n-chat`.

`check:bundle`:

| Metryka                        | Baza                          | 3c10e030       | fix2           |
| ------------------------------ | ----------------------------- | -------------- | -------------- |
| overall JS gzip (próg 4772 KB) | 4754,4 KB                     | 4757,0 KB      | 4756,1 KB      |
| public                         | 2804,0 KB                     | 2806,3 KB      | 2805,8 KB      |
| największy chunk (`index-*`)   | 262,2 KB                      | 261,6 KB       | 262,1 KB       |
| boot closure                   | 487,8 KB gzip / 1598,6 KB raw | 487,3 / 1596,7 | 487,8 / 1598,6 |

Zapas `overall` wynosi 15,9 KB. Ostrzeżenie „poniżej 2%” było już w bazie.

**Pierwsza próba (exp0, przed przeniesieniem N10 z huba do haka):**

| Metryka              | Δ vs baza |
| -------------------- | --------- |
| bootClosureRawBytes  | +72 B     |
| bootClosureGzipBytes | +4 B      |
| bootBurstGzipBytes   | +15 B     |
| htmlGzipBytes        | +186 B    |

Przyczyna: przegrupowanie opisane w N10. Artefakty leżą w `fix2/*exp0*`.

---

## 5. Prywatność i AGENTS.md

**Prywatność.** Inwariant z rundy 1 bez zmian:

- kanał tylko na własnych wierszach `conversation_participants` (`user_id=eq.<uid>`, `ownParticipantsChannel`);
- obrona w głąb `row.user_id !== uid`;
- odczyt treści tylko dla rozmowy z własnego wiersza;
- nowe pola znacznika (`id`, `last_read_at`, `cleared_before`) pochodzą z tego samego własnego wiersza;
- nowe zapytanie preferencji filtruje po `user_id` z sesji (`useAuth`), nie z ładunku.

**AGENTS.md.**

- Zminimalizowane rozmowy nadal idą przez wspólny magazyn sesji (`restore`/`remove`).
- Render dymków i pigułek bez zmian. Test „na mobile najwyżej trzy dymki…” jest zielony.
- Geometria toastów jest wspólna dla motywów.
- i18n wyłącznie ze słowników.
- Brak nowych zależności.

## 6. Ryzyka i otwarte

- **Kruchość bajtów bootu.** Domknięcie bootu jest neutralne, ale margines jest cienki (burst ±0 B). Przy scalaniu
  z innymi gałęziami fali Rollup może przegrupować chunki inaczej. **Pomiar trzeba powtórzyć na scalonym czubku.**
- **Bramka N6.** Przy wolnym odczycie preferencji (pusty cache) kanał powstaje dopiero po odpowiedzi. Wiadomość
  z tego okna nie dostaje toasta (fail-closed). Zwykle dzwonek w nagłówku i tak pobiera preferencje.
- **Prawie nierozróżnialne przypadki N3.** Zgubione zerowanie i zgubiona sama wiadomość dają po przebudzeniu
  zdarzenie bez podpisu, więc toasta nie ma. Zamierzone: to zaległość, a nie świeża wiadomość.
- **Flash podglądu (N4).** Przy wiadomości, która przyszła po odczycie w trakcie RPC, toast może na chwilę pokazać
  treść przeczytanej wiadomości, a potem podmienia się w miejscu na najnowszą. Kosmetyka, bez dodatkowego zapytania.
- **N8: toast nad wysokim panelem.** Na niskim ekranie (panel `h-[70vh] max-h-[560px]`) toast stoi wysoko po
  prawej, ale mieści się w oknie.
- **Nadal poza zakresem:**
  - e2e seeded z dwoma kontekstami;
  - deduplikacja między kartami;
  - push i toast dla tej samej wiadomości.

  Bez zmian względem IMPL-fix1.

## 7. Commit

`ee8af71d` na `feat/w3-chat-toasts` (worktree `scratchpad/wt3/chat-toasts`, drzewo czyste). Artefakty pomiarów: `fix2/`
(eksperymenty exp0 i exp1, `chunk-diff-fix2.txt`, `boot-diff-fix2.txt`, `mapdeps-diff.py`, `dock-closure.py`), mutacje: `mut2/mutate.py`.
