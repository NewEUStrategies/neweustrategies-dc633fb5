# Wdrożenie: zaufanie do `x-tenant-host` w bazie + retencja `user_purchases`

Data: 2026-08-05
Zakres: ustalenia §4.1 (KRYTYCZNE / bezpieczeństwo) i §4.2 (WYSOKA / RODO)
z `docs/AUDYT_BRUTALNY_REWIZJA_ZALOZEN_2026-08-05.md`, plus usunięcie marki
dostawcy platformy z kodu i dokumentacji.

---

## 1. §4.1 - `x-tenant-host` przestaje być zaufany W BAZIE

### Co było

Utwardzenie z 02.08 postawiło granicę zaufania na KRAWĘDZI: `pickTrustedHost()`
(`src/lib/server/tenant.server.ts`) porównuje `Host` / `X-Forwarded-Host`
z katalogiem `tenants.domain` i przy braku dopasowania zwraca `null`. To jest
realne i przetestowane - ale obowiązuje wyłącznie dla żądań, które przez tę
krawędź przechodzą.

Warstwa bazy pozostała nietknięta. `request_public_host()`
(`20260703120000:36-53`) czytał `request.headers ->> 'x-tenant-host'` **wprost**,
a `public_tenant_id()` (`20260703191341:100-124`) mapował tę wartość na tenanta.
Klient z PUBLICZNYM kluczem anon woła PostgREST bezpośrednio - `curl`,
`supabase-js` z własnym `global.headers`, dowolny skrypt - i podaje domenę innego
tenanta. Krawędź takiego żądania nigdy nie widzi.

Skutek: czytanie planu anon obcego tenanta, atrybucja anonimowych zapisów do
obcego tenanta, a jako ZALOGOWANY użytkownik tenanta A - pivot na tenanta B
wszędzie, gdzie ścieżka mieszała `public_tenant_id()` z tożsamością wołającego.
Ten ostatni punkt to dokładnie klasa, którą `20260724100000` zamykała RĘCZNIE,
funkcja po funkcji (9 funkcji), zostawiając inwariant do pilnowania na przyszłość.

### Co jest teraz - trzy szczeble zaufania

`supabase/migrations/20260805090000_tenant_host_assertion_hardening.sql`

| Szczebel     | Co niesie żądanie                                                    | Jak baza to traktuje                                                                                                  |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **VERIFIED** | `x-tenant-assert` = HMAC-SHA256 krawędzi nad `v1:<kid>:<host>:<exp>` | host obowiązuje, dowolny tenant                                                                                       |
| **ASSERTED** | sam `x-tenant-host`                                                  | tylko gdy wskazuje domenę/alias ZAREJESTROWANY w `public.tenants`; dla ZALOGOWANEGO nie wyprowadza z tenanta domowego |
| **NONE**     | nic (realtime, bezpośredni SQL, zadania w tle)                       | tenant domyślny (jak dotąd)                                                                                           |

Rozstrzyganie tenanta (`public_tenant_id()`):

```
VERIFIED                -> tenant hosta z poświadczenia
ASSERTED + anon         -> tenant zadeklarowanej domeny (plan treści publicznej)
ASSERTED + zalogowany   -> jeżeli deklaracja wskazuje tenanta INNEGO niż
                           current_tenant_id() (tenant domowy z profilu),
                           deklaracja jest ODRZUCANA i obowiązuje tenant domowy
NONE                    -> tenant domyślny, awaryjnie seed 'nes'
```

**To jest cała naprawa: nagłówek nie przeniesie zalogowanego wołającego do obcego
tenanta.** Jedna reguła, w jednym miejscu, dla wszystkich ~530 ścieżek czytających
`public_tenant_id()` - obecnych i przyszłych. Ręczne łatanie z `20260724100000`
zostaje jako druga warstwa, nie jako jedyna.

Dodatkowo `request_public_host()` **nie zwraca już wartości spoza katalogu
domen**: dowolny łańcuch znaków w nagłówku jest szumem i nie opuszcza
`request_asserted_host()` (koniec sondowania bazy nagłówkiem, koniec
nieograniczonej, wybieranej przez atakującego kardynalności wartości w logach).

Nowe funkcje SQL: `normalize_public_host`, `tenant_id_for_public_host`,
`b64url_encode`/`b64url_decode`, `verify_tenant_host_assertion`,
`request_asserted_host`, `request_verified_host`, `request_public_host_trust`,
`set_tenant_host_assertion_key`, `retire_tenant_host_assertion_key`.

### Uczciwie o granicach

Poświadczenie wiąże **HOST, nie osobę**: kto chce, pobierze poświadczenie
tenanta B wchodząc na jego publiczną witrynę. I tak ma być - to nie token
dostępu, tylko dowód „ruch przeszedł przez platformę dla hosta H". Dzięki niemu
baza odróżnia ruch platformy od surowego wywołania API i może bezpiecznie
degradować to drugie. Wartość ochronna siedzi w regule przypięcia zalogowanego
do tenanta domowego oraz w tym, że deklaracja spoza katalogu domen nie działa
wcale. Autoryzacja NIGDY nie wynika z hosta - pilnuje tego
`scripts/check-sql-tenant-scope.ts` oraz pgTAP.

Anonimowy plan pozostaje host-aware z deklaracji, celowo: anonimowy czytelnik
widzi wyłącznie treść OPUBLIKOWANĄ, a anonimowy zapis (newsletter, formularz
kontaktowy) musi podążać za przeglądaną witryną. Podszycie się deklaracją jest
tam równoważne wejściu na tę witrynę i wypełnieniu formularza - nie daje niczego,
czego atakujący nie ma bez niej.

### Transport poświadczenia

- **SSR / server functions**: `assertionForRequest()` /
  `currentServerAssertion()` (`src/lib/http/requestHost.server.ts`) podpisują host
  JUŻ ZWALIDOWANY względem `tenants.domain`, więc sfałszowany `X-Forwarded-Host`
  nigdy nie zostanie poświadczony.
- **Przeglądarka**: `tenantAssertionMiddleware`
  (`src/lib/http/tenantAssertionCookie.server.ts`) wysyła z dokumentem HTML cookie
  `nes_tenant_assert`, a `fetchWithTenantHost` przepisuje je do nagłówka. Cookie
  jest per-host z definicji, więc karta nie dostanie poświadczenia domeny, której
  nie odwiedziła. Świadomie BEZ `HttpOnly` - konsumentem jest klient anon, który
  woła PostgREST z innego originu (samo cookie tam nie dojedzie); poświadczenie
  nie zawiera tożsamości, więc nie ma tam czego chronić.
- Middleware siedzi **POWYŻEJ** `documentCacheMiddleware` (ta sama doktryna co
  `gpcMiddleware`): `Set-Cookie` dokleja się PO odtworzeniu wpisu z cache'a, więc
  poświadczenie jednego hosta nie wejdzie do dokumentu zapisanego dla innego.
- `exp` jest kwantyzowane do godziny, a ważność to 24 h: poświadczenie dla danego
  hosta jest w obrębie kroku BAJT W BAJT identyczne, więc cache dokumentów nie
  mnoży wariantów, `Set-Cookie` leci najwyżej raz na godzinę, a podpis policzony
  podczas SSR zgadza się z tym, co ma przeglądarka.

### Konfiguracja (wymagana, żeby szczebel VERIFIED żył)

```bash
# 1. Wygeneruj sekret (min. 32 znaki)
openssl rand -hex 32

# 2. Krawędź: zmienne środowiskowe wdrożenia
TENANT_HOST_ASSERTION_KEY=<sekret>
TENANT_HOST_ASSERTION_KID=edge1      # opcjonalnie, domyślnie "edge1"

# 3. Baza (service_role): ten sam sekret do Vaulta pod tym samym kid
select public.set_tenant_host_assertion_key('edge1', '<sekret>');
```

Rotacja: `set_tenant_host_assertion_key('edge2', '<nowy>')`, przełączenie
`TENANT_HOST_ASSERTION_KID` na krawędzi, a po wygaśnięciu ostatnich poświadczeń
(24 h) `select public.retire_tenant_host_assertion_key('edge1')`.

**Bez skonfigurowanego klucza nic się nie psuje.** Nie ma szczebla VERIFIED, więc
zalogowani wołający są zawsze przypięci do tenanta domowego - degradacja jest
w stronę BEZPIECZNĄ, nie w stronę deklaracji atakującego. Instalacja
jednodomenowa (tenant domowy = tenant domyślny = jedyny) działa wtedy bajt
w bajt jak przed zmianą. Konfiguracja klucza jest potrzebna, gdy ZALOGOWANY
członek jednego tenanta ma czytać publiczną treść DRUGIEGO tenanta.

---

## 2. §4.2 - `user_purchases` przestaje przeżywać usunięcie konta z surowym `user_id`

### Dlaczego umknął

`20260803090002` domknęła `payment_orders` wzorcowo. Tabela siostrzana została
pominięta z konkretnego powodu, który warto zapisać, bo to wzorzec błędu:
`user_purchases.user_id` to `uuid NOT NULL` **bez żadnego klucza obcego**
(`20260601051732:105`). Nigdy nie kaskadował, więc nigdy nie pojawił się na
liście „miejsc, gdzie CASCADE niszczy dowody" - audyt CASCADE go nie widział, bo
CASCADE tam nie było. A skoro FK nie było wcale, to po `auth.admin.deleteUser()`
wiersz ZOSTAWAŁ z identyfikatorem usuniętego użytkownika w postaci surowej.

To DRUGI, PRZECIWNY kierunek naruszenia: tam groziło zniszczenie dowodów
księgowych (art. 74 ust. 2 uor), tu zostają osierocone dane osobowe bez podstawy
i bez terminu (art. 5 ust. 1 lit. e i art. 17 RODO).

### Co jest teraz

`supabase/migrations/20260805090100_user_purchases_gdpr_retention.sql`

1. `user_id` nullowalny + FK **`ON DELETE SET NULL`** (nigdy CASCADE, nigdy bez FK).
2. Kolumny retencyjne 1:1 jak w `payment_orders`: `subject_ref` (ten sam pseudonim
   SHA-256, więc zakup i zamówienie tej samej osoby da się uzgodnić w księgach bez
   danych osobowych), `anonymized_at`, `retention_until`, `retention_hold`,
   plus `CHECK` kształtu zanonimizowanego wiersza i indeksy.
3. **Backfill** wierszy już osieroconych - anonimizacja (albo usunięcie, gdy nie
   mają wartości dowodowej) PRZED założeniem FK.
4. `anonymize_user_purchases_for_user()`:
   - **zostaje** (bez danych osobowych) wszystko z kwotą > 0 albo ze śladem
     u operatora (`external_ref`);
   - **znika** darmowy grant bez śladu u operatora - nic nie dowodzi, a trzymanie
     go 5 lat łamałoby minimalizację (art. 5 ust. 1 lit. c RODO).
5. `anonymize_accounting_evidence_for_user()` - JEDEN punkt wejścia dla obu tabel.
   Aplikacja (`retainAccountingEvidence`) i trigger `BEFORE DELETE ON auth.users`
   wołają dokładnie to samo, w jednej transakcji, więc nie istnieje stan
   „zamówienia zanonimizowane, zakupy jeszcze nie".
6. `purge_expired_accounting_evidence()` + jeden wpis pg_cron `35 3 * * *` dla obu
   tabel (dotąd cron znał tylko zamówienia; stary wpis jest usuwany).
7. `REVOKE DELETE, UPDATE, TRUNCATE ... FROM authenticated` - retencja nie zależy
   od RLS.

### Zmiany po stronie aplikacji

- `retainAccountingEvidence()` woła jedno RPC i zwraca rozbicie
  `{orders, purchases, retainedTotal}`; czyta też STARY, płaski kształt
  `{retained, discarded}` (baza migrowana do `20260803090002`, ale nie do
  `20260805090100`), żeby liczba w komunikacie dla użytkownika nie skłamała zerem.
- `deleteMyAccount` zwraca `retainedEvidence` / `retainedOrders` /
  `retainedPurchases`; UI liczy dowody RAZEM (dla użytkownika to jedna kategoria).
- i18n PL/EN: `profile.security.danger.retentionBody` mówi teraz również o
  wykupionym dostępie i o tym, że darmowe przyznania dostępu są usuwane.
- `grant.server.ts`: naprawiony NIEPRAWDZIWY komentarz („`user_purchases`
  zniknęło kaskadą" - nigdy nie kaskadowało) i dodany strażnik: retry webhooka na
  zamówieniu po anonimizacji konta nie wstawi już uprawnienia „dla nikogo"
  (wiersz z `user_id` NULL to w tej tabeli DOWÓD, nie nowe uprawnienie).

---

## 3. Marka dostawcy platformy zamieniona na neweuropeanstrategies.com

### Zmienione (nasze)

- `src/lib/lovable-error-reporting.ts` → `src/lib/platform-error-reporting.ts`,
  `reportLovableError` → `reportPlatformError`.
- Trasy `src/routes/lovable/email/**` → `src/routes/platform/email/**`
  (URL-e `/platform/email/...`), `isInternalPlatformPath` w `src/start.ts`,
  wygenerowane `src/routeTree.gen.ts`.
- Nazwa cookie językowego `lovable_lang` → **`nes_lang`** (widoczna w tabeli
  plików cookie w banerze zgód!) - z odczytem zapasowym starej nazwy, żeby
  wracający czytelnik nie stracił wybranego języka.
- Klucze magazynu przeglądarki: nowy moduł `src/lib/storageKeys.ts` (jedno
  źródło prawdy - klucz zapisanych artykułów był wpisany dosłownie w TRZECH
  plikach) z prefiksem `nes` i **migracją przy pierwszym odczycie**: zapisane
  artykuły, preferencja języka, sesja impersonacji i palety admina przechodzą
  same, bez kroku wdrożeniowego.
- Zdarzenie `lovable:open-login` → `nes:open-login`.
- Etykieta dostawcy poczty w wykluczeniach: `provider: "lovable"` →
  `"platform"`, `eventType: lovable.<reason>` → `platform.<reason>`, klucze
  deduplikacji `lovable:<...>` → `platform:<...>`. Kolumna `provider` nie ma
  `CHECK`, więc historyczne wiersze zostają - raporty pokażą obie wartości
  w okresie przejściowym, a jednorazowo może przejść jeden zduplikowany webhook
  na granicy wdrożenia (klucz deduplikacji zmienia prefiks).
- Dane przykładowe buildera i tokeny ich detekcji: kategoria/tag „Lovable" →
  „Przykład" (zmieniane RAZEM, inaczej gate przestałby wykrywać wyciek danych
  przykładowych na produkcję).
- Komentarze, komunikaty w adminie i dokumentacja.

### Naprawione po drodze (realne defekty odsłonięte przez zamianę)

- **Twitch był martwy na produkcji**: `parent=lovable.app` w
  `src/lib/blocks/embed.ts` musi wskazywać host, który FAKTYCZNIE osadza player,
  inaczej odtwarzacz odmawia startu. Teraz `PUBLIC_SITE_HOST` z domyślną domeną
  kanoniczną.
- **Trzy niezależne kopie allowlisty hostów SEO** (`canonicalRedirect`,
  `sitemapRequest.server`, `robots[.]txt`) plus czwarta w CSP (`start.ts`) -
  cztery listy, które mogły się rozjechać (host dostaje 301, ale robots.txt
  dalej pozwala go indeksować = duplikat treści w wynikach). Zunifikowane
  w `src/lib/http/host.ts`: `CANONICAL_SITE_ORIGIN`, `isCanonicalSiteHost`,
  `isEditorOrLocalHost`, `isNonCanonicalPublicHost`, `isPreviewHost`.
- Domeny podglądu dostawcy wypadły z KODU do KONFIGURACJI:
  `PREVIEW_HOST_SUFFIXES`, `LEGACY_HOST_SUFFIXES`, `EDITOR_HOST_SUFFIXES`.
  Wpis takiej domeny poszerza fail-open planu crawlera i rozluźnia CSP, więc
  jest decyzją wdrożenia, nie stałą w źródle.
- Migracja `20260805090000` czyści `tenants.domain` / `tenants.aliases` z domeny
  podglądu dostawcy wpisanej tam seedem `20260703191341` (w takiej instalacji
  KAŻDE żądanie na własnej domenie spadało na fallback tenanta domyślnego).

### Zostawione świadomie (zewnętrzne identyfikatory)

Tego nie da się zmienić bez zerwania integracji - to nie nasze nazwy:

| Co                                                                   | Dlaczego                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `@lovable.dev/*` w `package.json`, `vite*.config.ts`, `bun.lock`     | nazwy paczek npm dostawcy (m.in. konfiguracja Vite, na której stoi build)  |
| `LOVABLE_API_KEY`, `LOVABLE_SEND_URL`, `LOVABLE_BUILD_ID`            | nazwy sekretów w środowisku wdrożeniowym i w `secrets.*` GitHuba           |
| `connector-gateway.lovable.dev`, `ai.gateway.lovable.dev`            | realne adresy usług dostawcy                                               |
| Nagłówek HTTP `Lovable-API-Key`                                      | kontrakt API dostawcy                                                      |
| `window.__lovableEvents`                                             | globalna nazwa wstrzykiwana przez runtime dostawcy                         |
| `lovable-core-prod` w `bun.lock` i w `sed` w workflowach             | prywatny rejestr, z którego pinowany jest lockfile                         |
| `.lovable/`                                                          | metadane sandboxu (nie kod aplikacji)                                      |
| Literały w `headContract.test.ts`, `meta.test.ts`, `e2e/seo.spec.ts` | te testy PILNUJĄ braku marki w treści - muszą znać nazwę, żeby ją wykrywać |
| Nazwy historyczne w `storageKeys.ts` / `langCookie.ts`               | odczyt zapasowy migracji; zapis idzie wyłącznie pod nazwę `nes`            |
| Migracje sprzed 05.08                                                | SQL jest forward-only, historii się nie edytuje                            |

### Do zrobienia PO wdrożeniu (poza repo)

Zmiana ścieżek tras platformowych wymaga przestawienia dwóch konfiguracji
zewnętrznych - bez tego dostawca będzie uderzał w 404:

1. Supabase → Auth Hooks → „Send Email": `/lovable/email/auth/webhook`
   → **`/platform/email/auth/webhook`**.
2. Webhook wykluczeń dostawcy poczty: `/lovable/email/suppression`
   → **`/platform/email/suppression`**.

Jeśli własny harmonogram uderza w dren kolejki: `/lovable/email/queue/process`
→ **`/platform/email/queue/process`**.

---

## 4. Testy i bramki

Nowe:

| Plik                                                      | Co pilnuje                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/tenant_host_assertion_test.sql`           | 17 asercji: deklaracja spoza katalogu odrzucona, anon dalej host-aware, ZALOGOWANY nie pivotuje deklaracją, poświadczenie przywraca legalny ruch cross-tenantowy, podpis podrobiony / z podmienionym hostem / wygasły / z obcym `kid` nie przechodzi, rejestr kluczy zamknięty dla rol klienckich |
| `supabase/tests/accounting_retention_test.sql`            | 16 asercji: FK `SET NULL`, stempel retencji, dowód zostaje a darmowy grant znika, wspólny pseudonim, `CHECK` kształtu, trigger na `auth.users`, purge z `retention_hold`, granty                                                                                                                  |
| `src/__tests__/tenantHostTrust.invariant.test.ts`         | statyczna bramka stanu końcowego migracji: `request_public_host()` nie czyta nagłówka wprost, `public_tenant_id()` przypina zalogowanego, sekret nie jest dostępny rolom klienckim, nagłówki TS↔SQL zgodne, middleware POWYŻEJ cache'a                                                            |
| `src/lib/http/__tests__/tenantAssertion.test.ts`          | kontrakt formatu = bliźniak weryfikatora SQL (reguły ODRZUCANIA, nie tylko szczęśliwa ścieżka)                                                                                                                                                                                                    |
| `src/lib/server/__tests__/tenantAssertion.server.test.ts` | HMAC policzony NIEZALEŻNIE (`node:crypto`) nad tekstem, który podpisuje baza; determinizm w obrębie kroku                                                                                                                                                                                         |
| `src/lib/http/__tests__/tenantAssertionCookie.test.ts`    | `Set-Cookie` tylko przy zmianie wartości; `Secure` za faktycznym protokołem                                                                                                                                                                                                                       |

Rozszerzone: `accountDeletionRetention.invariant.test.ts` (parametryzowane po
OBU tabelach dowodowych - `user_purchases` umknął audytowi dokładnie dlatego, że
nikt nie mierzył go tą samą miarą co `payment_orders`),
`tenantHostFetch.test.ts`, `host.test.ts`, `langNegotiation.test.ts`,
`accountingRetention.server.test.ts`.

Wynik w tym środowisku:

- `vitest run` - **2936 pass / 7 fail**; wszystkie 7 to `Failed to resolve import
"@tanstack/react-query"` w `src/lib/experts/**` (niekompletne `node_modules`:
  prywatny rejestr z `bun.lock` jest w tym środowisku nieosiągalny - 403).
  Ta sama przyczyna zatrzymuje 260 plików testowych na etapie importu.
- `eslint` na wszystkich zmienionych plikach - **0 błędów**.
- `check:sql-tenant-scope`, `check:sql-anon-insert`, `check:sql-migration-replay`
  - **zielone**.
- `check:sql-app-role` - **czerwone, ale nie z tej zmiany**: to trzy fałszywe
  trafienia opisane w §4.3(a) audytu (`'X'` w komentarzu, `'rola'` w docstringu
  regexu, `'tenant_admin'` w teście, który z definicji sprawdza odsiewanie
  literału spoza enumu). Ta zmiana nie dodaje ani nie usuwa żadnego trafienia.
- `tsc --noEmit` i `check:db-contract` - nie do uruchomienia tutaj (brakujące
  paczki / brak dostępu do bazy). W plikach objętych zmianą nie ma błędów typów
  innych niż kaskady po brakujących modułach `@tanstack/*` i `lucide-react`.
- pgTAP wymaga lokalnego stacka Supabase (Docker) - nieuruchomione w tym
  środowisku, patrz `supabase/tests/README.md`.
