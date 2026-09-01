# Wdrożenie: MODUŁ 12 - realtime / powiadomienia / web-push

**Data:** 2026-09-01
**Punkt odniesienia:** `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` (wydanie 8),
rozdział „MODUŁ 12" oraz rozdział 10 tego samego dokumentu (aktualizacja po tej kampanii).
**Zakres:** `src/lib/realtime/`, `src/lib/notifications/`, `src/components/notifications/`,
`src/routes/*notification*`, polityki RLS pięciu tabel modułu.

---

## 1. Wynik w jednej tabeli

| Metryka           |  wyd. 8 | po kampanii |         delta |
| ----------------- | ------: | ----------: | ------------: |
| Linie             |  49,54% |  **98,03%** | **+48,49 pp** |
| Gałęzie           |  31,59% |  **92,14%** | **+60,55 pp** |
| Funkcje           |  47,46% |  **97,11%** | **+49,65 pp** |
| Plików na 0%      | 12 z 28 |       **0** |           -12 |
| Progi per-ścieżka |       0 |      **34** |           +34 |
| Pliki testowe     |      16 |      **37** |           +21 |
| Przypadki testowe |      99 |     **664** |          +565 |

Delta wydania 8 wobec wydania 7 wynosiła **0,0 pp** - moduł stał pięć wydań audytu w miejscu.

---

## 2. Przed → po, plik po pliku

Kolumny „przed" pochodzą z wydania 8 audytu, „po" z pomiaru pełnej suity z `all: true`
(2 051 plików testowych) wykonanego 2026-09-01.

### 2.1. Dwanaście plików, które stały na OKRĄGŁYM ZERZE

| Plik                                                            | przed |           po (linie) | po (funkcje) |
| --------------------------------------------------------------- | ----: | -------------------: | -----------: |
| `components/notifications/NotificationsCenter.tsx`              | 0/146 | **94,07%** (127/135) |   **89,47%** |
| `components/notifications/ConsentsPanel.tsx`                    |  0/59 |     **100%** (59/59) |     **100%** |
| `lib/notifications/useConsents.ts`                              |  0/50 |     **100%** (50/50) |     **100%** |
| `lib/realtime/useModuleRealtime.ts`                             |  0/49 |     **100%** (49/49) |     **100%** |
| `lib/notifications/push.ts`                                     |  0/47 |     **100%** (47/47) |     **100%** |
| `lib/realtime/useEntityPresence.ts`                             |  0/29 |     **100%** (29/29) |     **100%** |
| `lib/notifications/useActorProfiles.ts`                         |  0/19 |     **100%** (14/14) |     **100%** |
| `lib/realtime/useDomainEventStream.ts`                          |  0/16 |     **100%** (16/16) |     **100%** |
| `routes/admin.community.notifications.tsx`                      |  0/14 |     **100%** (14/14) |     **100%** |
| `lib/notifications/pushConfig.functions.ts`                     |   0/3 |       **100%** (3/3) |     **100%** |
| `lib/realtime/cohesionLiveSync.tsx`                             |   0/3 |       **100%** (3/3) |     **100%** |
| `components/notifications/molecules/NotificationKindToggle.tsx` |   0/2 |       **100%** (2/2) |     **100%** |

Mianownik dwóch plików zmalał (`NotificationsCenter` 146 -> 135, `useActorProfiles` 19 -> 14),
bo ekstrakcja przeniosła z nich powtórzony kod do nowych, wspólnych modułów. Nic nie zostało
wykluczone z pomiaru - patrz 3.1.

### 2.2. Siedem plików częściowych

| Plik                                             |                     przed |                               po |
| ------------------------------------------------ | ------------------------: | -------------------------------: |
| `lib/notifications/useNotifications.ts`          | 44,6% L, 18/39 F, 36,5% B |     **100% L, 100% F, 98,65% B** |
| `components/notifications/NotificationsBell.tsx` | 65,5% L, 10/27 F, 45,4% B | **96,15% L, 84,62% F, 87,72% B** |
| `lib/notifications/webpush.server.ts`            | 78,7% L, 19/24 F, 56,3% B | **98,17% L, 95,83% F, 92,71% B** |
| `lib/notifications/dispatch.server.ts`           | 72,9% L, 14/19 F, 53,7% B |   **94,07% L, 100% F, 81,48% B** |
| `lib/realtime/correlationContext.ts`             |            76,9% L, 3/4 F |     **100% L, 100% F, 87,50% B** |
| `lib/realtime/useEventConfirmedMutation.ts`      |          96,5% L, 58,3% B |       **100% L, 100% F, 100% B** |
| `lib/realtime/tableChannelHub.ts`                |    100% L, 5/6 F, 90,0% B |       **100% L, 100% F, 100% B** |

---

## 3. Co realnie odblokowało te liczby

### 3.1. Ekstrakcja przed asercjami

Ten sam predykat żył w module w trzech kopiach, wszystkie WEWNĄTRZ komponentów:

- `isInternalHref` - `NotificationsBell.tsx`, `NotificationsCenter.tsx`, `useActorProfiles.ts`,
- `isPlainLeftClick` - `NotificationsBell.tsx`, `NotificationsCenter.tsx` (identyczne ciała),
- `pickTitle` / `pickBody` - dwie kopie zapisane RÓŻNĄ składnią przy identycznym zachowaniu,
- `fmtDate`, `relTime` - po jednej kopii w każdym z komponentów,
- rozpoznanie kluczy cache listy (`isNotificationListQuery`, `listKeyIsOnlyUnread`).

To nie były funkcje „nieprzetestowane" - były NIEWYWOŁYWALNE dla testu jednostkowego. Jedyną
drogą do nich był render 858-linijkowego organizmu. Powstały trzy czyste moduły:
`notificationLink.ts`, `notificationText.ts`, `notificationListKeys.ts`.

Przy okazji zniknęła czwarta kopia, której audyt nie wymieniał: dzwonek miał WŁASNE, znakowo
identyczne zapytanie o profile aktorów obok istniejącego hooka `useNotificationActorProfiles`.
Dziś oba korzystają z hooka, więc budują ten sam klucz cache - po zalogowaniu leci jedno
zapytanie zamiast dwóch.

Bilans: trzy kopie tego samego kodu zamieniły się w jedną, więc moduł ma 31 plików i 1 168 linii
zamiast 28 plików i 1 191 linii. Żaden plik nie wypadł z pomiaru.

### 3.2. Podłączenie atrapy kanału

`src/test/supabase/realtime.ts` istniała w repo od wydzielenia z fixture'ów czatu i korzystało
z niej **siedem plików testowych w innych modułach**. Z modułu 12 - ani jeden. Moduł nie stał
na 49,5% z braku narzędzia; stał, bo nikt go tu nie podłączył.

Refcount jest w tych testach ASERCJĄ, nie dekoracją. Nagłówek atrapy tłumaczy dlaczego: gubiony
`removeChannel` nie psuje żadnego widoku od razu - dopiero po kilku przejściach między trasami
kończy się limit kanałów i zdarzenia przestają przychodzić. Każdy test odmontowania sprawdza
`removed === true` oraz zerowy `activeChannelCount()`, a `tableChannelHub` **nie jest
mockowany** - z atrapą huba refcount nie mierzyłby niczego.

---

## 4. Inwentarz testów (21 nowych plików)

**Realtime (7 plików, 117 przypadków):** `useModuleRealtime`, `useDomainEventStream`,
`useEntityPresence`, `tableChannelHubSharing`, `correlationContext`,
`useEventConfirmedMutationBranches`, `cohesionLiveSync`.

**Warstwa danych i serwer (10 plików, 294 przypadki):** `notificationLink`, `notificationText`,
`notificationListKeys`, `useNotifications`, `useActorProfiles`, `webpushSend`, `dispatchDigests`,
`pushConfigFunctions`, `push`, `useConsents`.

**Komponenty i trasy (4 pliki, 104 przypadki):** `NotificationsCenter`, `NotificationsBell`,
`NotificationKindToggle`, `adminCommunityNotificationsRoute`.

**Warstwa danych w bazie (1 plik, 45 asercji):** `supabase/tests/module12_notifications_rls_test.sql`,
**wykonany** lokalnie po zaaplikowaniu 935 migracji.

Rodzaje testów, których moduł nie miał wcale przed tą kampanią: komponentowe, dostępnościowe
(axe), warstwy danych, presence na atrapie kanału, pgTAP polityk.

---

## 5. Defekty znalezione i przypięte

Żaden nie został naprawiony po cichu - kontrakt jest opisany w teście, a zachowanie produkcyjne
nietknięte.

| #   | Defekt                                                                                                                                                                | Skutek dla użytkownika                                                                                                                                                                                                                                                                                        | Forma                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | `isNotificationListQuery` uznaje klucz profili aktorów (`["notifications","actor-profiles", string[]]`) za listę wierszy, bo tablica przechodzi `typeof === "object"` | „Oznacz całą rozmowę", „oznacz jako nieprzeczytane" i kosz **nie docierają do serwera** - `onMutate` rzuca `TypeError` na `cached.pages.map`, React Query przerywa mutację, a `onError` dostaje `context === undefined`, więc nie ma czego cofnąć. Warunek: choćby jedno powiadomienie z `/messages?c=<uuid>` | 4 x `it.fails` + zielony test różnicowy izolujący przyczynę                     |
| 2   | `useEventConfirmedMutation` przenosi `correlationId` przez JEDEN `useRef` na cały hook, a `onMutate` jest asynchroniczne                                              | Dwie szybkie akcje z jednego widoku: oba żądania idą ze stemplem drugiej, więc pierwsza po timeoucie zostaje wycofana z cache mimo poprawnego zapisu - dokładnie objaw, któremu ten hook ma zapobiegać                                                                                                        | `it.fails`                                                                      |
| 3   | Panel dzwonka to `role="dialog"` bez nazwy                                                                                                                            | `aria-dialog-name` - czytnik ekranu ogłasza dialog bez tytułu                                                                                                                                                                                                                                                 | `it.fails`                                                                      |
| 4   | Wiersz powiadomienia bez `href` zagnieżdża przycisk w przycisku                                                                                                       | `nested-interactive`, WCAG 4.1.2                                                                                                                                                                                                                                                                              | `it.fails`                                                                      |
| 5   | RLS `push_subscriptions` nie wiąże `tenant_id`, choć dyspozytor filtruje po nim, a `push.ts` nie podaje go w upsercie                                                 | Po przeniesieniu konta między obszarami wiersz zostaje ze starym tenantem, dyspozytor nie znajduje urządzenia i zadanie umiera jako `dead` **bez ani jednej próby wysyłki**. Push cichnie bez śladu w logu                                                                                                    | pgTAP: stan zastany POKAZANY asercjami 16-17 + propozycja polityki w komentarzu |

Przy defektach 3 i 4 stoi ZIELONY test „poza dwoma zgłoszonymi defektami panel jest czysty
w axe", żeby `it.fails` nie stał się workiem na przyszłe regresje.

---

## 6. i18n: sprostowanie i to, co z niego zostało

**Pierwsza wersja tego rozdziału była nieprawdziwa i zostaje wycofana.** Twierdziła, że 17 z 18
przełączników rodzaju i 10 z 10 zgód RODO pokazywało w obu językach surowe slugi. Nie pokazywało:
te klucze od dawna są w rdzeniu `src/lib/locale/{pl,en}.ts` i renderują się poprawnie.

Sprawdziłem tylko nakładkę `src/lib/i18n-notifications.ts`, zobaczyłem w niej brak tych kluczy
i uznałem to za lukę w tłumaczeniach. Nakładka jest warstwą, nie całym słownikiem.

Skutek błędu był poważniejszy niż sam nadmiarowy wpis: nakładka rejestruje się przez
`addResourceBundle(..., true, true)` - ostatnie `true` znaczy NADPISZ - więc od wejścia na trasę
powiadomień podmieniłaby kanoniczne treści. W tym opis zgody marketingowej **bez pouczenia
„Możesz wycofać zgodę w każdej chwili"**, przy niezmienionej wersji `1.0` w `CONSENT_CATALOG`.
Dwa materialnie różne brzmienia zgody pod jedną wersją w rejestrze RODO to defekt materiału
dowodowego z art. 7 ust. 1, nie literówka.

Wychwycił to automatyczny przegląd na PR #316 (uwaga P1), nie ja. **Zmiana cofnięta w całości** -
nakładka wróciła do stanu sprzed kampanii, co do bajtu.

**Trwały wynik.** `src/lib/__tests__/i18nNotifications.test.ts` mierzył dotąd samą nakładkę.
Mierzy teraz SŁOWNIK EFEKTYWNY (rdzeń + nakładka) przez to samo `t`, którego używa aplikacja,
plus trzy bramki:

| Bramka                         | Co pilnuje                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prawna, **bez listy wyjątków** | nakładka nie podmienia żadnego `notifications.consents.items.*` ani `.categories.*` - zmiana treści oświadczenia należy do rdzenia ORAZ do bumpa wersji w `consentCatalog.ts` |
| ratchet                        | pozostałe rozjazdy nakładka-rdzeń: zastano **24** (wszystkie w EN, żaden w treści zgód), lista może tylko maleć                                                               |
| katalogowa                     | każdy rodzaj, sekcja i zgoda z katalogów renderuje się w obu językach i nie jest surowym slugiem - broni przed dopisaniem rodzaju bez tłumaczenia                             |

## 7. Progi per-ścieżka

34 nowe wpisy w `vitest.config.ts` (w repo: 376 -> 410). Trzy katalogowe
(`src/lib/realtime/**`, `src/lib/notifications/**`, `src/components/notifications/**`)
i 31 plikowych. Katalogowe stoją obok plikowych celowo: to one łapią plik DOPISANY do modułu
bez własnego progu.

Reguła marginesu: `floor(zmierzone - 2)` dla pliku, `floor(zmierzone - 3)` dla katalogu.
Plik nie ma wewnętrznego dryfu - albo test go wykonuje, albo nie - więc szerszy margines byłby
tu wyłącznie luzem na regres.

Cele minimalne ze zlecenia wobec zmierzonego:

| Cel                               | wymagane       | zmierzone             |
| --------------------------------- | -------------- | --------------------- |
| Powiadomienia + web-push          | ≥ 75 / 70 / 60 | 97,54 / 96,17 / 91,90 |
| Realtime (kanały, presence)       | ≥ 85 / 90 / 65 | 99,32 / 98,54 / 93,25 |
| moduł 12 razem                    | ≥ 78 / 75 / -  | 98,03 / 97,11 / 92,14 |
| `webpush.server.ts` gałęzie       | ≥ 75           | **92,71**             |
| `NotificationsCenter.tsx` funkcje | ≥ 70           | **89,47**             |

---

## 8. Czego NIE osiągnięto

Rozdział obowiązkowy. Raport wymieniający własne luki jest sprawdzalny; raport podający same
procenty nie jest.

1. **Sześć testów w pięciu plikach jest czerwonych - stan ODZIEDZICZONY z maina**, nietknięty
   przez tę pracę i niedotyczący modułu 12: `authzSnapshotParity` (nieświeży snapshot
   autoryzacji; zlecenie WPROST zabrania jego regeneracji dla zgaszenia czerwieni),
   `migrationReplay` (2 - bliźniaki treści w katalogu migracji), `serviceRoleTenantScope.gate`,
   `router.test.tsx`, `AdminMonetizationLedger`. Ustalone przebiegiem dwunastu shardów całej
   suity i potwierdzone uruchomieniem tych plików osobno.
2. **Trzy bramki `check:*` nie dają się uruchomić w tym środowisku:** `check:db-contract`
   i `check:migration-ledger` wymagają poświadczeń Supabase, `check:authz-snapshot` oblewa
   z powodu z punktu 1. Pozostałe 35 przechodzi.
3. **Cztery fragmenty są NIEOSIĄGALNE z publicznego kontraktu** i zostały tak nazwane, zamiast
   być „pokryte" podmianą globali: `catch` w `notificationActorId` (parser WHATWG URL nie rzuca
   dla ścieżki od pojedynczego `/` - sprawdzone na 11 kandydatach), fałszywa strona
   `if (index >= 0)` w `runWithCorrelation` (stos nie jest eksportowany), `ciphertext length
mismatch` w `encryptPushPayload`, eksmisja z cache'u VAPID przy 64 wpisach.
4. **`domainEvents.ts` stoi na 66,67% funkcji** - jedyny plik modułu poniżej 80% na tej metryce.
   Ma własne, wcześniejsze testy i nie był w zakresie tej kampanii; dostał próg zapadkowy na
   zmierzonym poziomie, żeby nie osunął się dalej.
5. **`NotificationsBell.tsx` ma 84,62% funkcji** - najniższy wynik wśród komponentów. Niepokryte
   są domknięcia, których nie da się wywołać bez otwarcia popovera w konfiguracji, której Radix
   pod happy-dom nie odtwarza wiernie.
6. **Własny błąd, złapany dopiero w przeglądzie, nie przeze mnie:** nadpisanie kanonicznych
   treści zgód RODO napisami z nakładki (rozdział 6). Cofnięte w całości i zabezpieczone bramką
   bez listy wyjątków. Zapisuję to tutaj, bo raport przemilczający własną pomyłkę nie jest
   sprawdzalny - a mechanizm tej pomyłki (sprawdzenie warstwy zamiast słownika efektywnego)
   powtórzy się każdemu, kto dopisze klucz do nakładki `i18n-*.ts`.
7. **`pickBody` i `pickTitle` traktują pusty napis inaczej** (`??` kontra truthiness), więc
   producent zapisujący `""` zamiast NULL-a dostanie w EN pustą treść, a nie polską. Zachowanie
   przeniesiono BEZ ZMIANY i przypięto testem wykonującym się (nie `it.fails`) - to kandydat
   do ujednolicenia, nie defekt z konsekwencjami dziś.
8. **Defekty 1-5 z rozdziału 5 pozostają w produkcji.** Zlecenie zabrania zmiany zachowania
   produkcyjnego w tej kampanii, więc są przypięte, opisane i czekają na osobną decyzję.
   Defekt 1 ma gotową, dowiedzioną testem poprawkę jednolinijkową (`Array.isArray`).
