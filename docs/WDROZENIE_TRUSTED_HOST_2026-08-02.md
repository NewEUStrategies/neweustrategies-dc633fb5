# Wdrożenie: zaufany host na krawędzi + metryka stanu końcowego RLS (2026-08-02)

Realizacja dwóch rekomendacji z `OCENA_FUNKCJI_TABELE_2026-08-01.md` (Moduł 19):

| Rekomendacja                                                                                                     | Status      |
| ---------------------------------------------------------------------------------------------------------------- | ----------- |
| Multi-tenant: "Walidacja hosta vs `tenants.domain` w krawędzi" (spoofowalny `x-tenant-host`, brak trusted-proxy) | ✅ wdrożone |
| RLS coverage: "Używać metryki stanu końcowego w dokumentacji" (mylące "915"/"408")                               | ✅ wdrożone |

---

## 1. Zaufany host na krawędzi (`pickTrustedHost`)

### Problem (audyt)

Serwerowa strona płaszczyzny host → tenant (`requestPublicHost` /
`currentServerHost`) ufała bezwarunkowo nagłówkowi `X-Forwarded-Host`.
Eskalacja uprawnień była zamknięta (dane prywatne scope'uje profilowe
`current_tenant_id()`), ale spoofowalność nie:

- spreparowany XFH stawał się `x-tenant-host` renderu SSR (render treści
  innego tenanta pod cudzym URL-em; przy cache'owaniu odpowiedzi po URL-u -
  wektor cache poisoning na powierzchniach crawlera i dokumentów),
- klucze NES Edge Cache / `edgeTtlCache` przyjmowały nieograniczoną,
  wybieraną przez atakującego kardynalność (cache-busting),
- atrybucja `tenant_id` anonimowych INSERT-ów (newsletter, kontakt,
  komentarze gości, feedback, dotacje) mogła być przepięta na innego tenanta.

### Mechanizm zaufania

Zamiast sekretu współdzielonego z proxy mechanizmem zaufania jest **sam
katalog tenantów**: `pickTrustedHost(directory, host, xfh)` +
`resolveTrustedRequestHost(request)` w `src/lib/server/tenant.server.ts`
(katalog per-izolat, TTL 60 s - zero dodatkowych round-tripów w stanie
ustalonym). Porządek zaufania:

1. **`Host` zarejestrowany** w `tenants.domain` (dokładnie albo alias
   www./apex) - autorytatywny: to nim warstwa hostingu routuje żądanie, więc
   klient nie wskaże nim cudzej domeny nie trafiając fizycznie na jej site;
2. **`X-Forwarded-Host` zarejestrowany** - realne łańcuchy proxy (front z
   publiczną domeną przed originem o wewnętrznym `Host`); wartość spoza
   katalogu nigdy nie przechodzi, wartość wskazująca cudzą domenę przegrywa
   z regułą 1; lista po przecinku skanowana z twardym limitem 8 kandydatów;
3. **hosty podglądu** (`isPreviewHost`: localhost, *.pages.dev,
   aliasy hostingu itd.) - powierzchnie tenanta domyślnego, jak dotychczas;
4. **bootstrap** (żadna domena nie zajęta albo katalog nieosiągalny) -
   historyczny porządek `XFH ?? Host`; nie ma czego cross-tenantowo pomylić,
   a instalacja single-tenant zachowuje się bajt w bajt jak przed zmianą;
5. inaczej **null - "brak wskazówki tenanta"**: fetch do PostgREST nie
   wysyła `x-tenant-host` (baza i tak spada na tenanta domyślnego), scope'y
   cache zlewają się do jednego kubełka.

### Punkty integracji (jeden choke point)

- `currentTenantHost()` (`src/lib/http/requestHost.ts` →
  `requestHost.server.ts`) - pokrywa automatycznie: `fetchWithTenantHost`
  (nagłówek `x-tenant-host` każdego zapytania anon SSR), scope `edgeTtlCache`
  i purge NES Edge Cache, atrybucję `tenant_id` wszystkich serwerowych
  intake'ów (newsletter, kontakt, join-us, komentarze gości, feedback,
  dotacje, vitals, track, ad-event, popup-event, client-errors), klienta MCP;
- `trustedPublicHost(request)` (nowe, `requestHost.ts`) - klucze dokumentów
  NES Edge Cache (`handleDocumentRequest`) oraz budowa URL-i absolutnych na
  powierzchniach crawlera: sitemap.xml, news-sitemap.xml, rss.xml, podcast
  RSS ×2, robots.txt, llms.txt, AMP web stories, feedy taksonomii, post-tts,
  experiment-event;
- `requestPublicHost(request)` pozostaje jako jawnie SUROWY odczyt -
  jedyni legalni konsumenci to sam rezolwer (fallback bootstrap) i testy.

### Co pozostaje by-design (i dlaczego)

- Nagłówek `x-tenant-host` z PRZEGLĄDARKI jest nadal kontrolowany przez
  klienta: `window.location.host` to faktyczny origin karty ofiary - zdalny
  atakujący go nie podmieni, a surowy `curl` na PostgREST wybiera co najwyżej
  OPUBLIKOWANĄ treść zarejestrowanego tenanta (SQL matchuje vs
  `tenants.domain` z fallbackiem na tenanta domyślnego). Dane prywatne/staff
  scope'uje profilowe `current_tenant_id()` - nagłówek ich nie dotyka.
- `seo/request.ts` i `canonicalRedirect.ts` czytają wyłącznie autorytatywny
  `Host` (bez XFH) - poza wektorem.
- `community-cron` autoryzuje się sekretem - spoofing wymaga sekretu.

### Testy

- `src/lib/server/__tests__/trustedHost.test.ts` - 12 przypadków kontraktu:
  neutralizacja spoofu (garbage i cudza zarejestrowana domena), łańcuch
  proxy, preview vs registered, alias www./apex, normalizacja case/port,
  lista XFH po przecinku + limit kandydatów, bootstrap, cache katalogu;
- istniejące suity bez regresu: `tenantResolver`, `tenantHostFetch`,
  `ssrCacheHostScope`, `documentCache.server`, `documentCacheL2`
  (56 testów ✓). Testy documentCache działają w gałęzi bootstrap (pusty
  katalog bez env Supabase) - dokładnie jak instalacja bez zajętych domen.

---

## 2. Metryka stanu końcowego RLS w dokumentacji

Obowiązująca metryka pokrycia RLS to **stan końcowy polityk** liczony
parserem gate'ów CI (CREATE/DROP POLICY odtwarzane po kolei, jak w
`scripts/check-sql-anon-insert.ts`): na 01.08 = **517 realnych polityk,
0 tabel bez RLS**. Metryki historyczne były mylące: "915" liczyło instrukcje
`CREATE POLICY` w churnie migracji (zawyżenie ~1,8×), "408" pary
nazwa+tabela.

Wystąpienia "915" w dokumentach opatrzone datowaną korektą (bez fałszowania
zapisu historycznego):

- `INWENTARZ_FUNKCJONALNOSCI_2026-07-24.md` (sekcja bezpieczeństwa + zaplecze
  danych),
- `OCENA_FUNKCJI_2026-07-24.md` (wiersz modułu 20, statystyki DB, wiersz RLS,
  tabela metryk).

Liczba polityk rośnie z każdą migracją - w nowych dokumentach podawaj wynik
parsera stanu końcowego z bieżącej sesji zamiast przepisywać stałą.
