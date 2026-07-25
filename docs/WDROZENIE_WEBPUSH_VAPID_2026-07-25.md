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

## 6. Długi zastane - domknięte w tej samej gałęzi

Trzy czerwone gate'y odziedziczone po `main` (zmierzone jako identyczne przed i
po zmianie z sekcji 1-5) zostały naprawione, plus dwa znalezione po drodze.

### 6.1 `Lint`: 296 błędów → 0

- Repo-wide `bun run format`: **61 plików** (38 tsx, 15 ts, 6 md, css, json).
  Lock pinuje `prettier@3.8.3`, a repo było formatowane starszym wydaniem -
  z tego dryfu brało się 295 błędów `prettier/prettier`.
- `prefer-const` w `useSiteSettingsRevisions.ts:34` (`authors` nigdy nie jest
  reassignowane).
- Trzy martwe dyrektywy `eslint-disable` (SiteMenu, `lib/mcp/index.ts`,
  `admin.users.index.tsx`) - reguły nie zgłaszały już nic, a wyciszenie zostało.
- `.prettierignore` dostaje `coverage` i pliki generowane przez platformę
  Lovable (`.lovable`, `src/routes/mcp.ts`, `list-tools`, `invoke-tool`,
  `oauth-protected-resource`) - to samo, co ESLint ignoruje od dawna, więc
  `prettier --check .` nie łapie już szumu z generatora.

Zostaje **108 ostrzeżeń** (0 błędów, gate przechodzi): 73
`react-refresh/only-export-components` i 35 `react-hooks/exhaustive-deps`.
Świadomie nietknięte - każde to decyzja projektowa (przenoszenie eksportów
między plikami / zmiana tablic zależności), a hurtowa „naprawa" tablic
zależności to najkrótsza droga do pętli renderów.

### 6.2 `Test + coverage`: 5 progów per-ścieżka → wszystkie zielone

Podniesione **realnym pokryciem**, nie obniżką progu (zgodnie z regułą
ratchetu z `vitest.config.ts`):

| Ścieżka                         | Było   | Jest       | Próg |
| ------------------------------- | ------ | ---------- | ---- |
| `widget-view/**` statements     | 92,78% | **94,52%** | 93   |
| `widget-view/**` lines          | 94,03% | **95,8%**  | 94,5 |
| `webhooks.stripe.ts` statements | 87,84% | **98,90%** | 90   |
| `webhooks.stripe.ts` branches   | 69,02% | **90,22%** | 75   |
| `webhooks.stripe.ts` functions  | 88,89% | 88,89%     | 85   |

Nowe testy webhooka Stripe (28 → 39) pokrywają ścieżki, które w produkcji
przychodzą od operatora, a nie miały ani jednego testu: paragon płatności dla
sesji bez faktury (i jego porażka), padnięty zapis dokumentu (best-effort),
faktura `void` bez linku, błąd odczytu zamówienia → **500 zamiast cichego 200**
(bez tego Stripe przestaje ponawiać utracone zdarzenie), faktura jednorazowa
wiązana po `payment_intent`, faktura bez właściciela, `charge.refunded` bez
`payment_intent`, wygaśnięcie sesji bez `order_id` (fallback po sesji),
darowizna z błędem zapisu. Harness stracił przy okazji `any` (typowany
`Chain` + kolejka wyników lookupów).

Testy widgetu wyszukiwarki (10 → 19): wstawianie operatora w miejsce karetki i
na zaznaczenie, lupa z frazą i bez, zawężanie po kubełku, czyszczenie historii,
fraza < 2 znaków, batch awatarów (sukces i porażka).

### 6.3 Nieobsłużony błąd w `SearchButtonWidget` (Vitest kończył kodem 1)

Batch awatarów autorów (`from("profiles_public")`) nie miał żadnej obsługi
błędu. W teście brakowało mocka `from`, więc zapytanie rzucało w efekcie
Reacta - nieobsłużone odrzucenie ubijało kod wyjścia całego runu, a ciało
batcha nigdy się nie wykonywało (stąd też dziura w pokryciu). Dwie naprawy:
`try/catch` w komponencie (przy porażce zostają inicjały, wpisy i tak trafiają
do cache'u jako `null` - bez pętli ponowień) i pełny mock w teście. Ta sama
awaria zdarzała się w produkcji przy offline/braku grantu.

### 6.4 Znalezione po drodze: `SQL tenant-scope` fałszywie czerwony

Gate `check:sql-tenant-scope` failował na **5 poprawnych** funkcjach
SECURITY DEFINER z migracji `20260724100000`. Przyczyna: detekcja szukała
`public_tenant_id()` w całym ciele funkcji, a migracja dokumentuje swoją własną
naprawę zdaniami `-- FIX: był public_tenant_id()`. Gate świecił czerwono na
**prozie**, czyli nie chronił niczego - prawdziwa regresja byłaby nieodróżnialna
od tego szumu. Naprawa: `stripSqlComments()` przed detekcją (komentarze
liniowe, blokowe i zagnieżdżone → spacje, literały w apostrofach nietknięte) -
ten sam powód, dla którego skrypt już wcześniej liczył atrybuty bez treści
ciała. Zweryfikowane w dwie strony: czyste drzewo przechodzi (430 funkcji, 3
uzasadnione ścieżki publiczne, brak ostrzeżenia o nieaktualnej allowliście =
detekcja nadal działa na kodzie), a podrzucona funkcja łamiąca inwariant
(skalowanie po nagłówku + `has_role`) jest wyłapywana i nazywana po imieniu.

### 6.5 Znalezione po drodze, NIE naprawione: budżet bundle'a

`check:bundle` jest czerwony i **nie z winy tej zmiany** (diff kliencki to
kilkanaście linii w jednym widgecie plus samo formatowanie, które ginie
w minifikacji):

| Metryka          | Ślad z komentarza skryptu | Pomiar teraz | Budżet  |
| ---------------- | ------------------------- | ------------ | ------- |
| największy chunk | ~348 KB                   | 379,0 KB     | 350 KB  |
| public total     | ~1472 KB                  | 1546,5 KB    | 1475 KB |
| overall total    | ~2513 KB                  | 2617,1 KB    | 2518 KB |

Atrybucja zmierzona, nie wywnioskowana: baseline zbudowany w osobnym worktree
na commicie bazowym gałęzi (`c5bfb24`, przed jakąkolwiek zmianą z tej pracy)
daje **największy chunk 379,0 KB** (bajt w bajt tyle samo), public 1546,0 KB,
overall 2616,6 KB. Cała ta gałąź dokłada **0,5 KB gzip** (try/catch plus
komentarze w jednym widgecie), a największy chunk się nie ruszył - gate był
czerwony przed nią i o dokładnie tyle samo.

Budżety były ustawione „tuż nad bieżącym śladem", więc te ~30-100 KB narosły
funkcjami mergowanymi na `main`. Dwie drogi:

1. **Realny code-splitting** wejścia klienta (379 KB to `index-*.js`: wszystko
   z `node_modules` niedopasowane do reguł `manualChunks` plus cały niebędący
   lazy kod aplikacji). To praca perf z ostrzeżeniem: komentarz w
   `vite.config.ts` opisuje incydent P0 z 2026-07-20, gdzie odcięcie pakietu od
   domknięcia jego zależności dało cykl chunków i **martwą hydratację na każdej
   stronie** - bez błędu widocznego dla użytkownika, niewykrywalne w dev ani
   w testach jednostkowych. Każdy nowy chunk vendorowy wymaga przejścia
   `check:chunks` ORAZ boot-testu przeglądarkowego (`vite.smoke.config.ts`).
2. **Re-flooring budżetów** do zmierzonego śladu z uzasadnieniem w komentarzu
   (tak samo, jak zrobiono z progami pokrycia w `vitest.config.ts`).

**Podniesienie budżetu wydajnościowego to decyzja produktowa** (1,5 MB
publicznego JS-a płaci czytelnik przy pierwszym wejściu), a droga 1 to osobna
praca z realnym ryzykiem regresji bootu - dlatego nie ruszam tego bez decyzji.
