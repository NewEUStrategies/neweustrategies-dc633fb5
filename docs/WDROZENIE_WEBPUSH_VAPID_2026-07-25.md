# Wdrożenie: krypto Web Push (VAPID) - optymalizacje + usunięcie martwej zależności (2026-07-25)

> Pozycja audytu: „Kryptografia własnej roboty (VAPID)" - oceniona **9/10** (własna
> implementacja RFC 8292 + RFC 8291 na `node:crypto`, pokryta testem roundtrip),
> z zastrzeżeniem: **martwa zależność npm `web-push` w repo**. Ten dokument opisuje
> wdrożone optymalizacje i domknięcie tego długu.
>
> Weryfikacja: `bunx tsc --noEmit` (zielono), `eslint` na zmienionych plikach
> (zielono), `bunx vitest run` (313 plików / 2639 testów zielono),
> `bun run test:coverage` (progi globalne przekroczone z zapasem).

## Zasady wdrożenia (spełnione wymagania)

- **Bez `any`/`as any`** - nowy kod nie wprowadza `any` ani `as any` (typy mocków
  w testach są jawne: `PushSendResult`, `PushSubscriptionKeys`, `QueryResponse`).
- **i18n PL/EN** - payload push niesie `lang` odbiorcy (`profiles.prefs->>'locale'`),
  a service worker ustawia `options.lang` + `dir: "auto"`, więc system czyta
  powiadomienie w języku odbiorcy. Tytuł i treść były już dobierane per język
  (`pickDigestText`) - teraz kontrakt jest domknięty po stronie przeglądarki.
- **tenant_id / izolacja** - dobór subskrypcji zawężony do `(tenant_id, user_id)`
  zadania (wcześniej tylko `user_id`, a rola serwisowa omija RLS).
- **„-" zamiast „—"** - nowe komentarze i dokumentacja używają dywizu.
- **Atomic design / layout** - zmiana jest w warstwie serwerowej i w service
  workerze; nie dotyka komponentów UI, gridu ani responsywności.
- **Testy** - 32 nowe testy jednostkowe (krypto, budżet payloadu, cache JWT,
  dispatcher, pula równoległości).

## 1. Martwa zależność `web-push` - usunięta

`webpush.server.ts` implementuje protokół samodzielnie od początku; pakiet npm
`web-push` nie miał **ani jednego importu** w repo (potwierdzone `knip` - po
zmianie sekcja „Unused dependencies" jest pusta).

| Usunięte                                   | Skutek                                                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web-push@3.6.7` (dependencies)            | -                                                                                                                                                                                                                                               |
| `@types/web-push@^3.6.4` (devDependencies) | -                                                                                                                                                                                                                                               |
| 14 wpisów w `bun.lock`                     | Mniejsza powierzchnia supply-chain: `asn1.js`, `http_ece`, `https-proxy-agent`, `agent-base`, `jws`, `jwa`, `ecdsa-sig-formatter`, `buffer-equal-constant-time`, `safe-buffer`, `bn.js`, `minimalistic-assert`, `minimist` + oba pakiety główne |

`bun install --frozen-lockfile` po zmianie: 905 instalacji / 873 pakietów, bez
zmian w lockfile (spójność potwierdzona), 191 pinów GAR nietknięte.

Dokumentacja: `docs/OCENA_PLATFORMY.md` nie odsyła już do
`bunx web-push generate-vapid-keys` (komenda przestała istnieć) - klucze generuje
`generateVapidKeys()` z `src/lib/notifications/webpush.server.ts`.

## 2. Optymalizacje krypto (`src/lib/notifications/webpush.server.ts`)

Ścieżka gorąca to jeden tick crona: do 200 zadań x N urządzeń w budżecie 25 s
(`src/lib/server/jobsTick.server.ts`).

| Optymalizacja                            | Było                                                                              | Jest                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Cache JWT VAPID per audience**         | podpis ES256 + parsowanie JWK na KAŻDĄ wysyłkę (~87 us; zmierzone: 436 ms / 5000) | jeden podpis na (klucz, subject, origin) na 12 h - cała partia do FCM reużywa token    |
| **Cache `KeyObject`**                    | `createPrivateKey({format:"jwk"})` per wysyłka (~27 us)                           | raz per para kluczy, limit 64 wpisów (LRU-drop najstarszego)                           |
| **HKDF: jeden extract, dwa expandy**     | 6 HMAC-ów na wiadomość (CEK i nonce liczyły PRK osobno)                           | 5 HMAC-ów - CEK i nonce dzielą `(salt, ikm)`, czyli PRK                                |
| **Bufory `info` jako stałe modułu**      | 3x `Buffer.from(ascii)` per wysyłka                                               | zero alokacji per wysyłka                                                              |
| **Jedna alokacja ciała**                 | `Buffer.concat` x3 (rekord, ciphertext, ciało) + osobny `alloc` nagłówka          | jeden `allocUnsafe` o dokładnym rozmiarze; szyfr pisze przez `copy` z kontrolą offsetu |
| **Payload serializowany raz na zadanie** | `JSON.stringify` per urządzenie                                                   | `encodePushPayload` raz, `sendWebPush` przyjmuje gotowy `Buffer`                       |
| **Twardy timeout 10 s**                  | brak - jedna zawieszona usługa push mogła zjeść cały budżet ticku                 | `AbortController` + `clearTimeout` w `finally` (konwencja jak `linkCheck.server.ts`)   |
| **Domknięcie strumienia odpowiedzi**     | `res.arrayBuffer()` (bufor wyrzucany)                                             | `res.body?.cancel()` - połączenie wraca do puli keep-alive                             |

**Świadomie NIE zrobione:** podmiana własnego HKDF na `crypto.hkdfSync`.
Zmierzone na Node 22 (50k iteracji): własne dwa HMAC-i **389 ms**, `hkdfSync`
**736 ms** - natywna funkcja jest tu ~1,9x wolniejsza (koszt wejścia do C++ i
konwersji `ArrayBuffer` przeważa nad samym HMAC-em). Pomiar jest zapisany w
komentarzu pliku, żeby nikt nie „zoptymalizował" tego w drugą stronę.

Efemeryczna para ECDH (~40 us) zostaje generowana per wiadomość - to wymóg
RFC 8291 sek. 3.1, nie da się jej cache'ować bez utraty forward secrecy.

## 3. Poprawki poprawnościowe

| Problem                                                                      | Skutek przed poprawką                                                                                                                                                                                           | Poprawka                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateVapidKeys()` zwracał skalar bez dopełnienia                         | `createECDH().getPrivateKey()` obcina wiodące zera - **ok. 1 na 256 kluczy miał 31 B** (zmierzone 16/4000) i był odrzucany jako „invalid VAPID keys" dopiero przy pierwszej wysyłce, długo po zapisie do `.env` | dopełnienie z lewej do 32 B przy generowaniu; `buildVapidJwt` toleruje krótsze klucze już siedzące w env (test odtwarza ten przypadek deterministycznie przez `setPrivateKey`)                        |
| Pole `rs` nagłówka aes128gcm liczone jako `ciphertext.length + 16 + 65 + 21` | wartość przypadkowa (choć >= długości rekordu), myląca przy debugowaniu                                                                                                                                         | `rs = 4096` - jeden rekord, zgodnie z RFC 8188 sek. 2.1                                                                                                                                               |
| Brak limitu rozmiaru payloadu                                                | usługa push odpowiadała 413, kolejka robiła 8 retry z backoffem i dopiero potem dead-letter - odbiorca nie dostawał nic                                                                                         | `MAX_PUSH_PAYLOAD_BYTES = 3993` (4096 - 86 nagłówek - 1 delimiter - 16 tag); `clampPushPayload` przycina treść, potem tytuł, na granicy znaku UTF-8; ponad budżet = `permanent`, czyli `dead` od razu |
| Brak walidacji długości soli w trybie testowym                               | `saltOverride` innej długości cicho psuł nagłówek                                                                                                                                                               | jawny błąd `invalid salt`                                                                                                                                                                             |
| `PushSendResult` nie rozróżniał błędów trwałych od przechodnich              | 400/413 retry'owane 8 razy                                                                                                                                                                                      | pola `permanent` (400/413) i `retryAfterSec` (z `Retry-After` przy 429/503, sekundy albo data HTTP)                                                                                                   |

## 4. Doręczanie: równoległość + izolacja tenantów (`dispatch.server.ts`)

| Zmiana                                                   | Uzasadnienie                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kolejki per urządzenie, 8 naraz** (`PUSH_CONCURRENCY`) | wysyłki szły sekwencyjnie: 100-300 round-tripów HTTPS po ~100-200 ms nie mieściło się w 25-sekundowym budżecie ticku, więc reszta partii wracała do kolejki z backoffem (push spóźniał się minutami). Grupowanie po endpoincie daje równoległość MIĘDZY urządzeniami i zachowuje kolejność powiadomień NA urządzeniu |
| **Filtr `tenant_id`**                                    | `push_subscriptions.tenant_id` istniał, ale zapytanie filtrowało tylko po `user_id`, a rola serwisowa omija RLS: to samo konto zapisane na dwóch domenach dostawało powiadomienia obcego tenanta (a `href` rozwiązywałby się względem złej domeny w service workerze)                                                |
| **Ucięcie kolejki po 404/410**                           | kolejne zadania na ten sam martwy endpoint dostałyby to samo 410 - teraz są odhaczane bez ruchu sieciowego                                                                                                                                                                                                           |
| **Dedupe `mark_push_subscription_failed`**               | jeden RPC na unikalny endpoint zamiast jednego na (zadanie, endpoint)                                                                                                                                                                                                                                                |
| **Raporty równolegle** (`REPORT_CONCURRENCY = 12`)       | 100 zadań x sekwencyjne RPC to był realny koszt ticku                                                                                                                                                                                                                                                                |
| **Agregacja per zadanie**                                | `sent` gdy dotarło na >= 1 urządzenie; `dead` gdy nic nie doszło i (brak urządzeń albo wszystkie odpadły albo payload nieprzechodzący)                                                                                                                                                                               |
| **`Topic` + `tag`**                                      | skrót SHA-256 z `(kind, href)`, 32 znaki base64url (RFC 8030 sek. 5.4). Urządzenie po dniu offline budzi się jednym powiadomieniem na wątek, a nie serią duplikatów. Skrót zamiast surowego `href`, bo `Topic` leci jawnym nagłówkiem HTTP - ścieżka zdradzałaby, co odbiorca czyta                                  |

Nowy współdzielony primitive: `src/lib/async/pool.ts` - `mapWithConcurrency`
(pula bez bariery między elementami, w przeciwieństwie do wzorca
`slice` + `Promise.all`, gdzie jedna wolna odpowiedź wstrzymuje cały następny
pakiet). Do reużycia przez pozostałe zadania tła.

## 5. Testy

| Plik                                                                     | Zakres                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/notifications/__tests__/webpush.test.ts` (22 testy)             | roundtrip RFC 8291 (bez zmian), dokładny rozmiar ciała i pole `rs`, payload na granicy budżetu (ciało == 4096 B) i ponad budżetem, walidacja soli, `clampPushPayload` + `truncateUtf8` (bez rozcinania diakrytyków), `pushTopic`, cache JWT (reuse per audience, świeży podpis przy wygasaniu, rozdział per klucz), klucz 31-bajtowy podpisuje i weryfikuje się poprawnie |
| `src/lib/notifications/__tests__/pushDispatch.test.ts` (11 testów, nowy) | izolacja tenantów (A nie idzie na urządzenie B + filtr w zapytaniu), `lang`/`tag` w payloadzie, jedna kolejka na urządzenie, ucięcie po 410 + jedno RPC oznaczenia, wygrana dostawa na drugim urządzeniu, 413 → `dead`, 500 → retry, brak urządzeń → `dead`, brak zadań → brak zapytań                                                                                    |
| `src/lib/async/__tests__/pool.test.ts` (5 testów, nowy)                  | kolejność wyników, twardy limit równoległości, brak bariery, przerwanie po pierwszym błędzie, normalizacja limitu                                                                                                                                                                                                                                                         |

Pokrycie globalne rośnie: statements 20,73% → **20,98%**, branches 17,13% →
**17,21%**, functions 14,97% → **15,13%**, lines 21,15% → **21,42%** (progi:
19,5 / 15,75 / 13 / 20). Liczba testów: 2607 → 2639.

## 6. Długi ISTNIEJĄCE PRZED tą zmianą (nietknięte, do osobnej pracy)

Zweryfikowane pomiarem na czystej gałęzi (przed i po - identyczne):

- `bun run lint`: **302 błędy + 111 ostrzeżeń** w plikach niezwiązanych z tą
  zmianą. Lock pinuje `prettier@3.8.3`, a repo było formatowane starszym
  wydaniem - stąd masowe różnice `prettier/prettier`. Zmienione tu pliki są
  czyste (`eslint` zielony), ale gate `Lint` w CI jest czerwony niezależnie od
  tej zmiany. Naprawa = repo-wide `bun run format` w osobnym commicie.
- `test:coverage`: 5 progów per-ścieżka nie domyka się na
  `widget-view/**` (lines 94,03% < 94,5%; statements 92,78% < 93%) i
  `webhooks.stripe.ts` (lines 88,81% < 90%; statements 87,84% < 90%;
  branches 69,02% < 75%). Wartości identyczne przed i po zmianie.
- `SearchButtonWidget.test.tsx` zgłasza nieobsłużony błąd (zapytanie
  `profiles_public` w efekcie React) - test przechodzi, ale Vitest kończy się
  kodem 1. Też identycznie przed zmianą.
