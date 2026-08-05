# Brutalny audyt platformy — rewizja założeń, wydanie 2026-08-05

**Data:** 2026-08-05 · **HEAD:** `1672ece` (main po PR #111–#166 + 655 commitach platformy prosto na main)
**Gałąź:** `claude/audyt-brutalny-2026-08-05-2zmdtd`
**Poprzednie wydania (migawki, nietknięte):** `AUDYT_BRUTALNY_REWIZJA_ZALOZEN_2026-07-30.md` (werdykt 8,0 → 7,0),
`OCENA_FUNKCJI_TABELE_2026-08-01.md`, `OCENA_FUNKCJI_TABELE_2026-08-03.md` (rewizja 2, werdykt 8,0).

> **Po co kolejne wydanie.** Od audytu z 30.07 repozytorium przyjęło **56 zmergowanych PR-ów i 1185
> commitów w 8 dni**. Wszystkie cztery P0 i oba P1 z tamtej listy są domknięte — i to nie łatkami, lecz
> bramkami, kontraktami pgTAP i telemetrią (§6). Ten dokument **nie jest raportem sukcesu**: sprawdza,
> czy naprawy sięgają tak daleko, jak mówią ich opisy, i **koryguje w dół cztery twierdzenia** uznane
> ostatnio za zamknięte. Cztery najważniejsze nowe ustalenia: (1) utwardzenie `x-tenant-host` **chroni
> tylko SSR** — baza nadal ufa nagłówkowi klienta, więc cross-tenant przez PostgREST stoi otwarty (§4.1);
> (2) retencja RODO domknęła `payment_orders`, ale **`user_purchases` zostaje po usunięciu konta
> z surowym `user_id`** (§4.2); (3) **CI na `main` jest czerwone na blokującej bramce, która wywala się
> na własnym komentarzu**, a dwie kolejne bramki nigdy nie zostały wpięte (§4.3); (4) **plik testu jest
> dla gita binarny** przez surowy bajt NUL, więc jest niewidoczny w każdym diffie i przeglądzie (§4.4).
> Werdykt: **7,8/10** — korekta w dół wobec 8,0 z 03.08, z nazwanymi powodami (§2).

## Metoda

Ten dokument rewiduje **założenia**, nie katalog funkcji (katalog: `INWENTARZ_FUNKCJONALNOSCI_2026-07-24.md`;
tabele funkcja-po-funkcji: `OCENA_FUNKCJI_TABELE_2026-08-03.md`). Sprawdzam, **które twierdzenia bronią
się na kodzie** — oceny mogą iść w dół i w górę.

Zasada rozstrzygania: **kod i migracje, nie dokumenty `WDROZENIE_*`**. Każde ustalenie w §4 ma dowód
`plik:linia`. Sygnały w §1 są uruchomione na tym HEAD w tej sesji, nie przepisane z poprzedniego wydania.
Weryfikacja szła trzema równoległymi ścieżkami (dług i wydmuszki / bezpieczeństwo i infrastruktura /
delta modułowa od `715f934`), a każde ustalenie cięższe niż „średnia" sprawdziłem osobiście — czytając
definicje funkcji SQL, konfigurację CI i bajty plików. Tam, gdzie dwie ścieżki dały sprzeczny wynik
(czy `check:permissions-parity` jest w CI), rozstrzygałem **własnym grepem po `.github/workflows/`**,
nie głosowaniem: nie jest.

Tam, gdzie naprawa jest **połowiczna**, piszę **którą połowę** zamyka — bo „naprawione" i „naprawione
dla ścieżki SSR" to w praktyce dwa różne stany bezpieczeństwa.

Dodatkowo **regresja-check**: zweryfikowałem, że naprawy z fal 31.07–03.08 nadal stoją (harmonogram
`community-cron` w pg_cron + Actions, filtr tenanta w `get_chat_peers`, guard środowiska w `fulfilOrder`,
jedna lista wykluczeń poczty, dren kolejki w `jobs-tick`, brak wydmuszki `/admin/donations`, zero
odczytów `personality_results` w CRM). **Żadna nie zregresowała.**

---

## 1. Twarde sygnały (uruchomione 2026-08-05 na HEAD `1672ece`)

| Sprawdzenie | Wynik | Uwaga |
| --- | --- | --- |
| `vitest run` | **5982 pass / 50 skip / 0 fail** (573 pliki pass, 2 skip) | Było 3423 na 30.07 — **+75% testów w 6 dni**. Suita jest realna i zielona. |
| `tsc --noEmit` | **czysto** | Bez zmian od 30.07; nadal jedyny realny gate typów (build przez esbuild nie typuje). |
| `eslint .` | **CZERWONO — 238 problemów (104 błędy / 134 ostrzeżenia)** | Poprawa z 1888 (30.07), ale bramka na `main` **znów** nie jest zielona — a dług lintu został w tym okresie wyzerowany osobnym commitem. Wszystkie 104 błędy to `prettier/prettier` w **19 plikach**. Największy pojedynczy winowajca to **nie** platforma hostingowa: `src/lib/i18n-builder.ts` (40 błędów) z commitu autorstwa Claude; dalej `TierCard.tsx` (24), `sliderVariants.tsx` (11), `admin.paywall.tsx` (5), `PopupEventsPanel.tsx` (5) — te z commitów „Changes"/„Work in progress". Ostrzeżenia: 102× react-refresh, 32× exhaustive-deps. |
| `knip` | 6 martwych plików, **337 martwych eksportów, 262 martwe typy**, 21 duplikatów eksportu | Było 293/207/19 na 30.07 — **dług rośnie monotonicznie**, bo knip **nadal nie jest w CI**. |
| `check:sql-tenant-scope` | ✓ (530 funkcji, 3 uzasadnione ścieżki publiczne) | Blokujący. |
| `check:sql-anon-insert` | ✓ (517 polityk w stanie końcowym, 6 tabel intake chronionych) | Blokujący. Klasa błędu z 30.07 domknięta trwale. |
| `check:sql-migration-replay` | ✓ (605 plików: **zero kolizji wersji**, zero niezabezpieczonych zapisów do `storage.objects`) | Blokujący. Bramka powstała po **trzech** kolizjach numeracji z 31.07–03.08. Zastrzeżenie: sprawdza unikalność **wersji**, nie **treści** — trzy pary migracji-bliźniaków przechodzą (§4.6). |
| `check:sql-owner-tenant-scope` | ✓ (150 polityk właściciela z 517; **12 pozycji jawnej amnestii**) | Blokujący, mechanizm ratchet poprawny — ale zielony wynik znaczy „12 potwierdzonych luk odłożonych", nie „brak luk" (§4.7). |
| `check:sql-app-role` | **✗ CZERWONO** | **Blokujący (`ci.yml:142`) i wywalony na `main`.** Trzy „naruszenia" to **własna dokumentacja i własny fixture** nowej macierzy uprawnień: `src/lib/ci/authzGates.ts:9` (`'X'` w komentarzu), `:72` (`'rola'` w docstringu regexu), `src/lib/ci/__tests__/authzGates.test.ts:94` (`'tenant_admin'` w teście negatywnym „odsiewa literał, którego nie ma w enumie"). Gate skanuje `src/**/*.ts(x)` i **nie wycina komentarzy** (`scripts/check-sql-app-role-literals.ts:30`). Zero realnych defektów — CI stoi (§4.3a). |
| `check:authz-snapshot` | **✗ CZERWONO — i nie ma go w CI** | `src/lib/authz/authzSnapshot.generated.ts` deklaruje 589 migracji / 523 funkcje / 505 polityk; stan faktyczny to **605 / 530 / 504**. Skrypt jest w `package.json:29`, w `.github/workflows/` **zero trafień** — to samo `check:permissions-parity` (`package.json:30`). Macierz uprawnień może znów kłamać, tylko teraz przez zdryfowany snapshot (§4.3b). |
| `check:db-contract` | nieweryfikowalny lokalnie (wymaga `SUPABASE_URL` + klucza) | W CI w jobie `post-deploy` (`ci.yml:290`) — **po** merge'u, nie na PR. |
| Migracje SQL | **605 plików** (548 na 30.07) | Zero duplikatów **wersji**; trzy pary duplikatów **treści** (§4.6). |
| Polityki RLS | **1024 instrukcje `CREATE POLICY`** → **517 polityk w stanie końcowym** | Metryka stanu końcowego jest odporna na churn; stare „915" liczyło instrukcje. Tabel bez RLS: **0**. |
| Funkcje `SECURITY DEFINER` | **456 definicji, dokładnie 4 bez `SET search_path`** | Te same 4 od 28.07 (kolejka `email_infra`). Mitygacja: `REVOKE FROM PUBLIC` + `GRANT TO service_role`. **Brak bramki na ten inwariant** (§4.10). |
| Bloki / widgety | **101 bloków / 91 widgetów** (100/87 na 30.07) | Pełne pokrycie rejestrów + nowa bramka `check:widget-fidelity` (parytet schemat⇄renderer). |
| Trasy | **203 pliki (128 admin)**; 252 route-id | Nowe od 03.08: `plans.$planId.tsx`, `[.well-known]/gpc[.]json.ts`. |
| pgTAP | **70 plików**, blokujący, CLI **przypięty** `2.111.0` | Było 62 na 30.07. Zastrzeżenie: krok nadający prawo do triggerów `auth.users` przy porażce emituje tylko `::warning::` — gate i tak będzie czerwony, ale diagnoza jest zakopana. |
| Progi bundla | `MAX_PUBLIC_KB=1799`, `MAX_TOTAL_KB=3005`, `MAX_CHUNK_KB=511` | Na 30.07: **1475 / 2518 / 350**. Publiczny sufit **+22% w 6 dni**; progi nadpisywalne z env (§4.5). |
| Progi pokrycia | **19,5% instrukcji / 15,75% gałęzi / 13% funkcji / 20% linii** | **Identyczne jak 30.07**, przy suicie wyrosłej z 3423 do 5982 testów. Floor nigdy nie „zaskoczył" w górę. |
| Bramki CI (`ci.yml`) | **16 blokujących kroków** w jobie `verify` + blokujący job `pgtap`; `continue-on-error` tylko przy pobieraniu artefaktu raportu i18n | Nowe od 30.07: **i18n parity**, **widget fidelity**, **migration replay**, **owner tenant-scope**. Osobno nowy workflow `billing-nightly.yml` — nocna sonda odnowienia i dunningu (§4.7). e2e w dwóch jobach (zwykły + zaseedowany z lokalną bazą); Lighthouse nadal nie na runtime edge. |
| Historia git | **1185 commitów / 8 dni**; od audytu 30.07: **56 PR-ów** i **655 commitów platforma hostingowa prosto na `main`** | **~92% commitów w tym okresie omija bramki PR.** To jedno zdanie wyjaśnia większość §4.3 i §5 pkt 6. |

**Wniosek z twardych sygnałów.** Safety-net jest dziś nieporównywalnie gęstszy niż 30.07: sześć
statycznych bramek SQL (cztery nowe), parytet i18n, wierność ustawień buildera, działający pgTAP z pinem
CLI, nocna sonda rozliczeń, 5982 zielone testy. **Ale cztery rzeczy psują ten obraz i wszystkie są tej
samej natury — bramka istnieje i nie broni:** (1) `main` jest czerwony na blokującej bramce, która
wywala się na własnym komentarzu; (2) dwie bramki są napisane, wpisane do `package.json` i **nigdy nie
wpięte** — snapshot już zdryfował; (3) bramki formalnie zielone są zielone, bo progi **podniesiono do
zmierzonego stanu** (bundle: trzeci re-floor), **nigdy nie podniesiono** (pokrycie 19,5% przy potrojonej
suicie) albo mają **wbudowaną listę amnestii** (12 luk właściciela); (4) nocna sonda rozliczeń bez
sekretów kończy się **zielono z ostrzeżeniem**, czyli brak konfiguracji jest nieodróżnialny od sukcesu.

---

## 2. Werdykt ogólny: **7,8 / 10**

Ścieżka: deklarowane 8,0 (24.07) → zmierzone **7,0** (30.07) → 7,5 (01.08) → 8,0 (03.08 r2) → **7,8** (05.08).

To **korekta w dół wobec ostatniego wydania** i chcę być precyzyjny, dlaczego — bo platforma w tym czasie
realnie urosła. Średnia arytmetyczna modułów wynosi **~8,1** (§3) i to jest uczciwy obraz *zdolności
produktowych*. Werdykt kompozytu jest niższy, bo waży **bezpieczeństwo, zgodność, integralność przeglądu
i proces dostarczania** — a w tych obszarach stan jest gorszy, niż zakładały poprzednie wydania:

1. **Utwardzenie `x-tenant-host` to pół naprawy opisane jak pełna** (§4.1). Walidacja krawędziowa jest
   realna i przetestowana, ale `request_public_host()` w bazie **nadal czyta nagłówek klienta wprost**.
   Klient z kluczem anon podaje w curl-u zarejestrowaną domenę **innego tenanta** i czyta jego dane
   w planie anonimowym. Moduł 19: 8,5 → **8,0**.
2. **Retencja RODO domknęła jedną tabelę, siostrzana została z surowym PII** (§4.2). `payment_orders`
   ma `SET NULL` + anonimizację + purge + fail-closed trigger — wzorcowo. `user_purchases.user_id` to
   `uuid NOT NULL` **bez FK**: nie kaskadował, więc nie był „problemem CASCADE" — i nie ma
   pseudonimizacji ani terminu retencji. Moduł 15: 8,2 → **8,0**.
3. **CI na `main` jest czerwone, a 92% commitów bramek nie widzi** (§4.3). Blokująca bramka wywalona na
   własnym fixture, dwie kolejne nigdy nie wpięte (snapshot zdryfował), lint znów z 104 błędami — po tym,
   jak dług wyzerowano osobnym commitem w tym samym okresie.
4. **Plik testu jest niewidoczny w przeglądzie** (§4.4). `joinUsLegacyContent.test.tsx` ma surowy bajt NUL
   na offsecie 4440, więc git traktuje go jak dane binarne: `git diff` pokazuje `Bin`, review nie widzi
   ani linii. Kod może w nim zrobić cokolwiek. Wspólnie z §4.6 (bliźniacze migracje) i 655 commitami
   „Changes" składa się to na modułu 20: 8,0 → **7,4**.

**Piąta rzecz, mniejsza wagą, ale symptomatyczna:** `checkout_settings` to nie „martwy przełącznik",
a martwy przełącznik **w obcym dialekcie** — `checkoutSessionExtraParams` generuje parametry w konwencji
**Stripe** dla dostawcy, który nią nie mówi (Paddle), jest **zaimportowany i ani raz nie wywołany**,
a komentarze wprost twierdzą, że „serwer czyta te flagi" (§4.9). Moduł 13: 8,5 → **8,3**.

**Co ciągnie werdykt w górę i dlaczego 7,8, a nie mniej:** wszystkie cztery P0 i oba P1 z 30.07 są
zamknięte i **nie zregresowały**. Odznaki (katalog = CHECK 1:1 + 6 triggerów auto-przyznawania), alerty
trackera (realny trigger → `enqueue_notification`), zgody zunifikowane z GPC i audytem decyzji, retencja
`payment_orders`, `funnelStats` w jednym RPC, kanoniczny głos TTS, tryb „najnowsze wpisy", loader SSR
wydarzeń, macierz uprawnień generowana z migracji, 38 nowych plików testów w dwa dni — to domknięcia
z testami i bramkami, nie łatki (§6). Gdyby nie luka PostgREST z §4.1 i stan CI z §4.3–4.4, ten dokument
mówiłby 8,2.

---

## 3. Rewizja ocen per moduł

Baza porównania: `OCENA_FUNKCJI_TABELE_2026-08-03.md` (rewizja 2, HEAD `715f934`). Kolumna **05.08** to
ta rewizja; strzałka = kierunek wobec 03.08 r2.

| # | Obszar | 30.07 | 01.08 | 03.08 r2 | **05.08** | Kier. | Powód |
| - | ------ | :---: | :---: | :------: | :-------: | :---: | ----- |
| 1 | Wpisy — czytelnik | 8,0 | 8,2 | 8,6 | **8,6** | ~ | Kanoniczny głos TTS (`src/lib/audio/ttsCanonical.ts` — `voiceId`/`model` już nie od klienta) domyka 24-krotną amplifikację kosztu. Pasek czytania wyciągnięty z ukrycia, nowy `SaveArticleButton`, kaskada bylinu autora. |
| 2 | Edytor + workflow | 8,4 | 8,4 | 8,6 | **8,6** | ~ | Karta profilu autora po stronie Gutenberga; bez zmian materialnych w workflow. |
| 3 | Bloki + page builder | 8,8 | 8,8 | 9,0 | **9,0** | ~ | **101 bloków / 91 widgetów**, bramka `check:widget-fidelity` w CI, wspólny kontrakt wyświetlania autora, hover ikon social z testami parytetu widok↔podgląd. Najmocniejszy moduł platformy. |
| 4 | Strony / media / import | 6,8 | 6,8 | 6,8 | **6,6** | ↓ | **Korekta w dół:** import WP nie jest tylko problemem jakości — **obchodzi bramkę anty-XSS**. `image/svg+xml` jest na allowliście w OBU stackach (`wordpress-import.functions.ts:83`, `wp-media.server.ts:16`), gdy ręczny upload go świadomie zakazuje, bo bucket jest publiczny (`media/upload.ts:40`). Do tego asymetria: stack stron **naprawiono** (merge per-język, `wp-import.functions.ts:407`), stack wpisów **nadal zeruje drugi język** (`wordpress-import.functions.ts:706-709,747,797`) — pułapka gorsza niż spójny brak. Autozapis stron nadal wyłączony (§4.8a). Na plus: rejestr stron kodowych z plakietką „Z kodu", polityki `media` per-tenant. |
| 5 | Strona główna / archiwa | 7,8 | 8,0 | 8,3 | **8,4** | ↑ | Tryb „najnowsze wpisy" **przestał być widmem** — trasa go honoruje (`routes/index.tsx:164,316`). Nowy `MegaMenuShowcase`. |
| 6 | Wyszukiwarka | 8,3 | 8,3 | 8,3 | **8,4** | ↑ | `SearchOverlay` + nowy `lib/search/overlayTabs.ts`: 4 zakładki (posts/topics/people/experts) z **jednym równoległym zapytaniem i prawdziwymi licznikami**, test a11y zaktualizowany. |
| 7 | Typy specjalne | 6,5 | 7,0 | 7,8 | **7,8** | ~ | Tracker: **RSS istnieje** (`tracker.rss[.]xml.ts`), **alerty są realne** (trigger `tg_eu_policy_update_applied` czyta `eu_policy_follows` → `enqueue_notification`, `20260714120000:135-148`) — obietnica z cennika ma wreszcie pokrycie; naprawione 404 dla crawlerów. Wydarzenia: `REVOKE SELECT` + granty kolumnowe (bez `join_url`/`recording_url`) + RPC `admin_list_events`. Otwarte: brak importu EUR-Lex/OEIL (dossier ręcznie), brak diffu wersji aktu, **dwie tabele programów** (zero migracji konsolidującej). |
| 8 | SEO / feedy | 7,5 | 7,5 | 8,4 | **8,4** | ~ | Doszedł `public/robots.txt`, a `news-sitemap` i `live.rss` dostały brakujący `crawlerDegradeIsSafe()` (404 → 200 z pustym feedem na hoście podglądu). **Ale ustalenie z 30.07 stoi:** `robots.txt` wymienia wyłącznie `sitemap.xml` — **news-sitemap nadal nieodkrywalny**. |
| 9 | Czat | 7,5 | 8,0 | 8,1 | **8,1** | ~ | Filtr tenanta w `get_chat_peers` trzyma (regresja-check ✓). FTS nadal `to_tsvector('simple')` wbrew komentarzowi o polskiej fleksji (`20260720215250:9-14`) — „ustawy" nie znajdzie „ustawa". W tym zakresie zmian: usunięta jedna pusta linia. |
| 10 | Sieć | 8,0 | 8,0 | 8,1 | **8,1** | ~ | Nowa bramka `check:sql-owner-tenant-scope` obejmuje polityki właściciela (150 z 517), z 12 pozycjami amnestii (§4.7). |
| 11 | Newsletter | 6,5 | 7,5 | 7,5 | **7,7** | ↑ | Popup przepisany end-to-end z pełnym edytorem w adminie (7 zakładek), **telemetrią** (`newsletter_popup_events`: impression/open/submit/success/error + panel) i tokenami pól współdzielonymi z logowaniem. Jedna lista wykluczeń i dren kolejki trzymają (regresja-check ✓). Otwarte: brak `UNIQUE` na `campaign_events` → open/click nadal mogą przekraczać 100%. |
| 12 | Realtime / push | 6,5 | 8,0 | 8,3 | **8,3** | ~ | Harmonogram dwutorowy (pg_cron + Actions) trzyma; w tym zakresie tylko panel zgód pod GPC. |
| 13 | Monetyzacja — checkout | 8,0 | 8,3 | 8,5 | **8,3** | ↓ | **Korekta w dół:** `checkout_settings` jest wydmuszką **w obcym dialekcie** i z kłamiącymi komentarzami (§4.9). Rdzeń bez zarzutu i rośnie: nowa trasa `/plans/$planId`, przebudowany `SubscriptionManagerSection`, **nocna sonda odnowienia i dunningu** — z zastrzeżeniem z §4.7. |
| 14 | Monetyzacja — kupony / reklamy | 6,8 | 7,3 | 7,7 | **7,7** | ~ | Reklamy: GPC klamruje `analytics` i `marketing` na „nie", zdejmowane wyłącznie świadomym override'em (`lib/ads/consent.ts`). Kupony bez zmian. |
| 15 | Profil i konto | 7,5 | 7,8 | 8,2 | **8,0** | ↓ | **Nowe ustalenie:** `user_purchases` zostaje z surowym `user_id` po usunięciu konta (§4.2). Na plus: retencja `payment_orders` wzorcowa, zgody zunifikowane z GPC, `REVOKE ALL ON profiles FROM anon` (`20260803095618`), tokeny pól w logowaniu i resecie hasła. |
| 16 | Społeczność | 7,5 | 7,5 | 8,0 | **8,1** | ↑ | Odznaki **domknięte w pełni**: katalog `PROFILE_BADGE_KINDS` = CHECK 1:1 + test parytetu + **6 triggerów auto-przyznawania** z reputacji (`20260803095150:445-514`). `fetchAdminEvents` przepisane z `select("*")` na RPC `admin_list_events`. |
| 17 | Analityka i BI | 7,5 | 7,5 | 7,5 | **7,5** | ~ | Doszła telemetria popupu, sam moduł BI nietknięty; **zero bot-filteringu** nadal (brak jakiegokolwiek filtra UA w łańcuchu trackingu). |
| 18 | CRM | 8,0 | 8,0 | 8,4 | **8,4** | ~ | `funnelStats` **naprawiony** — jeden RPC `crm_funnel_stats` zamiast pętli po całej tabeli (`crm-funnel.functions.ts:144`). Polityki `crm_lead_notes` dopięte do `current_tenant_id()`. |
| 19 | Ustawienia / multi-tenant / RODO | 7,8 | 8,2 | 8,5 | **8,0** | ↓ | **Korekta w dół:** utwardzenie hosta pokrywa SSR, nie PostgREST (§4.1); 4 funkcje `SECURITY DEFINER` bez `SET search_path` od 28.07 bez bramki (§4.10); CSP nadal z `'unsafe-inline'` bez nonce (`start.ts:212`). Na plus, i to mocno: macierz uprawnień **generowana z migracji** (koniec ręcznie wpisywanej tabelki), zgody+GPC zunifikowane i audytowane, `check:sql-anon-insert` trzyma. |
| 20 | Platforma / backend / SSR | 7,5 | 7,8 | 8,0 | **7,4** | ↓↓ | **Korekta w dół, największa:** CI czerwone na `main` na blokującej bramce wywalonej własnym fixture'em (§4.3a), dwie bramki nigdy nie wpięte przy już zdryfowanym snapshocie (§4.3b), **plik testu binarny dla gita** (§4.4), trzy pary bliźniaczych migracji przechodzące przez bramkę replay (§4.6), trzeci re-floor bundla z progami nadpisywalnymi z env (§4.5), progi pokrycia zamrożone przy potrojonej suicie, sonda rozliczeń zielona bez sekretów (§4.7), sentinel e2e SSR nadal potwierdza sam siebie (§4.8c), prerender = 0. Na plus: 5982 zielone testy, 70 suit pgTAP, bramka odtwarzalności migracji, `gpcMiddleware` poprawnie nad `documentCacheMiddleware`. |

**Średnia arytmetyczna: ~8,1** · **Werdykt kompozytu: 7,8** (ważenie w §2).
**4 moduły w górę, 12 bez zmian, 4 w dół** — i wszystkie cztery spadki to **korekty wcześniejszych
założeń albo świeżo znalezione braki w zasięgu**, nie nowe usterki wprowadzone w kodzie produktowym.

---

## 4. Ustalenia krytyczne i wysokiej wagi (z dowodami)

### 4.1 [KRYTYCZNE / bezpieczeństwo] Utwardzenie `x-tenant-host` pokrywa SSR, nie PostgREST

**Twierdzenie, które rewiduję:** wdrożenie z 02.08 (`WDROZENIE_TRUSTED_HOST_2026-08-02.md`) i wydanie
tabel z 03.08 traktują spoofowalność nagłówka jako zamkniętą (moduł 19 = 8,5).

**Co jest realnie zrobione — i dobrze.** `pickTrustedHost()` (`src/lib/server/tenant.server.ts:163-181`)
porównuje `Host` / `X-Forwarded-Host` z katalogiem `tenants.domain` (plus alias www/apex), z jawnym
priorytetem i `null` przy braku dopasowania. Wejście przez `resolveTrustedRequestHost()` (`:191`),
konsumowane w `src/lib/http/requestHost.server.ts:9,26` i
`src/integrations/supabase/tenant-host-fetch.ts:10-14`. Jest test
(`src/lib/server/__tests__/trustedHost.test.ts`).

**Czego to nie zamyka.** Warstwa bazy została nietknięta: `request_public_host()` czyta
`request.headers ->> 'x-tenant-host'` **wprost** (`20260703120000_host_aware_public_tenant.sql:44`),
a najnowsza definicja `public_tenant_id()`
(`20260703191341_312ecf9b-3d2b-42fb-9e3d-1371b4963064.sql:100-124`) dopasowuje tę wartość do
`tenants.domain`/`aliases` z fallbackiem na tenanta domyślnego. Komentarz „the header is
client-controlled BY DESIGN" (tamże `:24-29`) nadal obowiązuje.

**Skutek.** Walidacja krawędziowa działa dla żądań przechodzących przez SSR. **Nie działa dla
bezpośrednich wywołań PostgREST** — klient z publicznym kluczem anon ustawia `x-tenant-host` na
zarejestrowaną domenę innego tenanta i czyta jego dane w planie anonimowym oraz atrybuuje do niego
anonimowe zapisy. Jedynym twardym zabezpieczeniem pozostaje `check:sql-tenant-scope`, który łapie
wyłącznie niezgodność `public_tenant_id()` × `has_role()`, nie samą spoofowalność. Brak trusted-proxy:
`X-Forwarded-Host` jest liczony bez dowodu, że żądanie faktycznie przeszło przez proxy
(`tenant.server.ts:137-141`, świadomie).

**Rekomendacja (P0).** Przenieść rozstrzyganie tenanta dla ścieżki API na wartość, której klient nie
kontroluje: podpisany nagłówek od krawędzi (HMAC z sekretem współdzielonym z bazą) albo claim tenanta
w JWT. Do czasu naprawy — sprostować dokumentację, że utwardzenie dotyczy **wyłącznie** SSR.

### 4.2 [WYSOKA / RODO] `user_purchases` przeżywa usunięcie konta z surowym `user_id`

**Twierdzenie, które rewiduję:** „jedyny otwarty punkt P1 (dowody księgowe) domknięty" (03.08 r2).

**Co jest zrobione — wzorcowo.** Migracja `20260803090002_payment_orders_gdpr_retention.sql`: FK
przestawiony na `ON DELETE SET NULL` (`:68-70`), `user_id DROP NOT NULL` (`:62-63`),
`anonymize_payment_orders_for_user()` (`:196`) z pseudonimem `subject_ref` (SHA-256), czyszczeniem
`receipt_email` i allowlistą metadanych, usuwaniem porzuconych szkiców checkoutu (`:212-224`),
fail-closed trigger `BEFORE DELETE ON auth.users` (`:271-274`), purge po `retention_until` (`:283`),
wpis pg_cron (`:311`). Ścieżka aplikacyjna wpięta **przed** usunięciem użytkownika:
`src/lib/account.functions.ts:59-60` → `src/lib/billing/accountingRetention.server.ts:45`.

**Czego nie objęto.** `user_purchases.user_id` jest `uuid NOT NULL` **bez żadnego klucza obcego**
(`20260601051732_452c616d-66c8-49ca-a9d8-9b5514a67333.sql:105`). Właśnie dlatego umknął: nigdy nie
kaskadował, więc nie był „problemem CASCADE" — ale też nie ma anonimizacji ani `retention_until`.
Po usunięciu konta wiersze zostają z **identyfikatorem usuniętego użytkownika w postaci surowej**.

**Skutek.** To **drugi kierunek naruszenia**, przeciwny do pierwotnego: tam groziło zniszczenie dowodów
księgowych (art. 74 uor), tu zostają osierocone dane osobowe bez podstawy i bez terminu (art. 5 ust. 1
lit. e i art. 17 RODO). Jedna tabela transakcyjna utwardzona, siostrzana nie — dokładnie ten sam kształt
błędu co §4.1.

**Rekomendacja (P1).** Objąć `user_purchases` tą samą procedurą: pseudonimizacja `user_id` →
`subject_ref`, `retention_until`, purge w tym samym cronie, dopisanie tabeli do `anonymize_*_for_user()`
i do testu pgTAP retencji.

### 4.3 [WYSOKA / proces] CI na `main` jest czerwone, a 92% commitów bramek nie widzi

**(a) Bramka wywalona na własnym fixture.** `check:sql-app-role` jest blokujący (`ci.yml:142-143`, bez
`continue-on-error`) i **czerwony**. Trzy zgłoszone „literały roli poza enumem" to:
`src/lib/ci/authzGates.ts:9` (`'X'` w komentarzu opisującym wzorzec `has_role(uid, 'X')`), `:72`
(`'rola'` w docstringu regexu) oraz `src/lib/ci/__tests__/authzGates.test.ts:94` (`'tenant_admin'`
w teście, który **z definicji** sprawdza odsiewanie literału spoza enumu). Powód: gate skanuje
`supabase/tests` i **`src`** w rozszerzeniach `.sql/.ts/.tsx`
(`scripts/check-sql-app-role-literals.ts:30`) i **nie wycina komentarzy ani stringów testowych**.
Zderzyły się dwie bramki: starsza (literały `app_role`) o nowszą (macierz uprawnień, `eeda74f`, 03.08).
Zero realnych defektów autoryzacji — i zablokowane CI. Efekt uboczny jest gorszy niż sam defekt: bramka,
która stoi czerwona z powodu własnej dokumentacji, **uczy zespół ignorowania czerwieni**.

**(b) Bramki napisane i nigdy nie wpięte.** `check:authz-snapshot` i `check:permissions-parity` są
w `package.json:29-30`, a w `.github/workflows/` **nie ma ich wcale** (sprawdzone gerpem po całym
katalogu). Skutek już się zmaterializował: `src/lib/authz/authzSnapshot.generated.ts` deklaruje
589 migracji / 523 funkcje / 505 polityk, gdy stan faktyczny to **605 / 530 / 504**. Macierz uprawnień
na `/admin/permissions` — której cały sens polegał na tym, że **nie jest** ręcznie wpisaną tabelką —
znów może kłamić, tylko teraz przez zdryfowany snapshot.

**(c) Ścieżka dostarczania omija bramki.** W zakresie od audytu 30.07: **56 zmergowanych PR-ów** i
**655 commitów** typu „Changes" / „Work in progress" / „automatyczny commit platformy" pchanych **prosto na `main`** —
około 92% commitów. Bramka lint jest w CI od 31.07, dług lintu został w tym okresie wyzerowany osobnym
commitem, a `main` ma dziś znów 104 błędy formatowania w 19 plikach. Uczciwie: **największy pojedynczy
winowajca nie jest botem** — `src/lib/i18n-builder.ts` z 40 błędami pochodzi z commitu autorstwa Claude.
Reszta rozkłada się na commity automatyczne. Bramka broni PR-ów; **gałęzi nie chroni nic**.

**Rekomendacja (P0/proces).** (1) Wyciąć komentarze i `__tests__` ze skanu `check:sql-app-role` albo
dodać allowlistę dla `src/lib/ci/**`. (2) Wpiąć `check:authz-snapshot` i `check:permissions-parity` do
jobu `verify` i zregenerować snapshot. (3) Włączyć ochronę gałęzi `main` z wymaganymi statusami albo
uruchomić format + bramki na ścieżce platformy — bez tego każda kolejna bramka skończy tak samo.

### 4.4 [WYSOKA / integralność przeglądu] Plik testu jest dla gita binarny — niewidoczny w każdym diffie

`src/components/admin/builder/__tests__/joinUsLegacyContent.test.tsx` zawiera **surowy bajt NUL (0x00)
na offsecie 4440** z 9602 — wpisany bajtowo w literał separatora zamiast jako escape:

```ts
return Object.values(textProps(content, lang)).join("<0x00>");   // ⬅ realny bajt NUL, nie " "
```

**Zweryfikowane osobiście:** `git diff --numstat` zwraca `-  -` (git klasyfikuje plik jako binarny),
`file` raportuje `data`, w statystykach diffu widnieje `Bin 0 -> 9602 bytes`. W repo **nie ma
`.gitattributes`**, który by to nadpisywał.

**Skutek.** Plik jest **niewidoczny w każdym diffie i w każdym przeglądzie kodu** — ani w PR-ze, ani
w `git log -p`, ani w narzędziach review. Dziś jest to plik testowy, więc szkoda jest ograniczona do
„test może twierdzić cokolwiek i nikt tego nie przeczyta". Ale klasa problemu jest ogólna: **ścieżka,
którą wprowadzono niewidoczny dla review plik z kodem wykonywalnym, jest otwarta** i nic jej nie pilnuje.

**Rekomendacja (P1).** Zamienić bajt na escape (`" "`) albo drukowalny separator; dodać do CI
prosty inwariant „żaden plik w `src/` nie jest przez gita klasyfikowany jako binarny" (jednolinijkowy
`git ls-files --eol` / `git diff --numstat` na pustym drzewie) — to tania bramka na całą klasę.

### 4.5 [WYSOKA / koszt] Bundle: trzeci re-floor, progi nadpisywalne z env, prerender nadal zero

Progi w `scripts/check-bundle-size.ts:139-141` to dziś `511 / 1799 / 3005` KB gzip; na 30.07 było
`350 / 1475 / 2518`. Publiczny sufit — ładunek JS, który dostaje **czytelnik serwisu treściowego** —
wzrósł o **+22% w sześć dni**. Historia z komentarzy (`:95-144`): floory szły `1783,9 → 1790 → 1799`,
zawsze „nad zmierzony ślad", nigdy w dół, a komentarz `:118-120` przyznaje wprost, że „sam `main`
przekracza WSZYSTKIE TRZY poprzednie floory **niezależnie od tej gałęzi**". Zaplanowana redukcja (split
locale PL/EN, odchudzenie eager widgetów chrome, `@tanstack` poza entry) występuje w komentarzach
**trzykrotnie** jako niewykonana (`:96-98`, `:109-111`, `:137-138`). Progi są czytane z
`process.env.MAX_*_KB`, więc bramkę można rozluźnić **bez commita** — czyli bez śladu w przeglądzie.

Prerender nadal **nie istnieje**: w `vite.config.ts` zero trafień na `prerender`/`pages`/`crawlLinks`,
0 stron prerenderowanych; cały ruch, w tym boty, idzie przez SSR na żywo — co wyjaśnia, dlaczego
strażnik strumienia dokumentu w ogóle musiał powstać (§4.8c).

**Rekomendacja (P1).** Zamrozić progi (bez nadpisywania z env w CI), wykonać zaległy split locale
i wypchnąć `@tanstack` z entry; ustawić budżet **docelowy poniżej** bieżącego stanu i traktować go jak
dług do spłaty, nie licznik do przewijania.

### 4.6 [ŚREDNIA / historia zmian] Trzy pary bliźniaczych migracji przechodzą przez bramkę replay

Ta sama zmiana wjechała dwa razy — raz jako plik pisany w PR, raz jako plik wygenerowany przez dashboard
platforma hostingowa (nazwa z UUID):

- `20260804150000_newsletter_popup_design_jsonb.sql` ↔ `20260804145341_26ab64e2-…` — **treść identyczna
  po odjęciu komentarzy** (zweryfikowane `diff` po odfiltrowaniu komentarzy i pustych linii): ta sama
  kolumna `popup_design jsonb` i ten sam `newsletter_settings_popup_design_obj_chk`;
- `20260803140001_consent_gpc_signal.sql` ↔ `20260803190927_fff99c9d-…` — ta sama zmiana rejestru zgód;
- `20260803140000_author_profiles_owner_tenant_scope.sql` ↔ `20260803184416_6ee2444c-…` — różnica
  wyłącznie w treści `COMMENT ON POLICY`.

Wszystkie są idempotentne (`ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS`), więc **replay bazy nie
pęka** i nowa bramka `check:sql-migration-replay` przechodzi — sprawdza unikalność **wersji** i zapisy do
`storage.objects`, nie **treść**. Koszt jest inny niż awaria: **historia migracji kłamie o tym, kiedy
zmiana realnie weszła**, a to jedyne narzędzie datowania regresji, jakie w tym repo zostało (historia
commitów jest spłaszczona — §8).

**Rekomendacja (P2).** Rozszerzyć bramkę replay o wykrywanie duplikatów treści (hash po normalizacji
komentarzy i białych znaków) i usunąć trzy bliźniaki.

### 4.7 [ŚREDNIA] Bramki z wbudowanym marginesem: 12 pozycji amnestii i sonda zielona bez sekretów

**(a) `check:sql-owner-tenant-scope` startuje z listą amnestii.** `KNOWN_OPEN_GAPS`
(`scripts/check-sql-owner-tenant-scope.ts:59`) grandfatheruje **dokładnie 12** realnych luk, które
zostają otwarte: `billing_profiles` (read + delete), `payment_orders::orders owner read`,
`notification_preferences` ×3, `message_stars`, `qa_questions` ×2, `qa_question_votes` ×2,
`eu_policy_follows`. Mechanizm ratchet jest **poprawny** (lista może tylko maleć, każda nowa luka wywala
CI) i dług jest **jawny, z opisem poprawnego predykatu przy każdej pozycji** — to znacznie lepsza
praktyka niż milczenie. Ale audytowo zielony wynik tej bramki trzeba czytać jako „12 potwierdzonych luk
w politykach właściciela odłożonych", nie „polityki właściciela są poprawne".

**(b) Nocna sonda rozliczeń jest zielona bez konfiguracji.** `billing-nightly.yml` sonduje realne
odnowienie i dunning w sandboxie — pomysł bardzo dobry i rzadki. Dwie usterki wykonania: krok „Poczekaj
na naliczenie" to `for i in $(seq 1 40); do sleep 60; done` (`:50`), czyli **40 minut spalonego runnera
codziennie** przy `timeout-minutes: 55`; a bez sekretów przebieg — zgodnie z własnym komentarzem
(`:11`) — **kończy się zielono z ostrzeżeniem**, więc „nie skonfigurowano" jest nieodróżnialne od
„rozliczenia działają".

**Rekomendacja (P2).** Zamienić `sleep` na polling z warunkiem wyjścia; przy braku sekretów kończyć
przebieg statusem neutralnym/czerwonym, nie zielonym.

### 4.8 [ŚREDNIA / prawda w kodzie] Trzy pozycje długu, które przetrwały cztery wydania

**(a) Autozapis stron.** `src/routes/admin.pages.$slug.tsx:298` twierdzi „Autozapis włączony (jak dla
wpisów)". `useAutosave` i `AutosaveBar` występują w tym pliku **wyłącznie w komentarzach** (`:165`,
`:168`, `:238`, `:263`, `:266`) — zero importów, zero wywołań; jest tylko ręczny `save()` i
`useUnsavedChangesGuard`. Hook działa realnie w edytorze wpisów
(`components/admin/post-editor/hooks/usePostEditorForm.ts:22,310`). Komentarz kłamie **od 30.07**, przez
cztery wydania audytu, i w tym czasie został **rozbudowany** o uzasadnienie mechanizmu, którego nie ma.

**(b) Dwie tabele programów.** `programs` i `research_programs` istnieją równolegle
(`20260714130000_expert_hub.sql:27` i `:2601`), obie w wygenerowanych typach
(`integrations/supabase/types.ts:9007`, `:9747`), a `grep "DROP TABLE" | grep -i program` daje **zero**
trafień — żadnej migracji konsolidującej.

**(c) Sentinel e2e SSR nadal potwierdza sam siebie.** `e2e/ssr-completeness.spec.ts:34,36` asertuje
`toContain("<html")` i `endsWith("</html>")`, podczas gdy `documentStreamGuard.server.ts` **sam dopisuje**
`FORCED_CLOSE_TAIL = "\n</body></html>"` przy wymuszonym zamknięciu strumienia. Dokument ucięty w połowie
przez `idle`/`timeout` **przejdzie oba asserty**. Testowane są 4 ścieżki (`/`, `/en`, `/blog`,
`/cookies`) — świadomie bez tras CMS-owych i `/experts`, czyli bez tych, które regresja SSR uderza
najmocniej. Postęp jest: doszedł piąty test (`:40-47`) z realną asercją treści (widoczny `h1`, zero
`pageerror`) — ale tylko dla `/`.

### 4.9 [ŚREDNIA] `checkout_settings`: wydmuszka w obcym dialekcie, z komentarzem, który kłamie

Pozycja znana od 30.07, ale weryfikacja pokazuje stan **gorszy** niż „martwy przełącznik":

- `src/lib/billing/checkout.functions.ts:6-8` **importuje** `checkoutSessionExtraParams` i
  `normalizeCheckoutSettings` — i w całym 690-linijkowym pliku **ani raz ich nie wywołuje**.
- Ciała transakcji Paddle nie zawierają żadnego z przełączników:
  `src/lib/billing/paddleTransaction.server.ts:88-103` (adhoc) i `:189-194` (subskrypcja) niosą
  `items`, `custom_data`, `customer`, `collection_mode`, `discount_id` — i tyle.
- `src/lib/billing/checkoutSettings.ts:62-95` generuje parametry w konwencji **Stripe**
  (`automatic_tax[enabled]`, `customer_creation=always`) — martwy kod **dla dostawcy, który tym językiem
  nie mówi**.
- Komentarze twierdzą przeciwnie: `src/routes/admin.paywall.tsx:968-970` („Serwer czyta te flagi przy
  tworzeniu sesji (`createCheckoutOrder`)") i `src/hooks/useCheckoutSettings.ts:3-4` („Egzekwowanie i tak
  jest serwerowe"). UI obiecuje kupującemu trzy podpowiedzi (`src/routes/checkout.$planId.tsx:313-321`),
  za którymi nie stoi nic.

To najczystszy przypadek wzorca „UI odłączone od backendu **plus** komentarz, który to maskuje" — i jedyna
pozycja w tym audycie, w której dokumentacja **aktywnie utrudnia** znalezienie defektu.

### 4.10 [NISKA / symptomatyczna] Cztery funkcje `SECURITY DEFINER` bez `SET search_path` — bez bramki

Z 456 definicji `SECURITY DEFINER` **dokładnie 4** nie mają `SET search_path`: `enqueue_email`,
`read_email_batch`, `delete_email`, `move_to_dlq` — wszystkie w `20260728154925_email_infra.sql:137-139`
i dalej; ciała wołają `pgmq.*` bez zafiksowanej ścieżki. Ryzyko ograniczone (`REVOKE EXECUTE FROM PUBLIC`
+ `GRANT TO service_role`, tamże `:201-208`) i **niezmienne od 28.07** — ale nie ma bramki na ten
inwariant (`check:sql-search-path` nie istnieje ani w `package.json`, ani w `ci.yml`), więc piąta taka
funkcja wejdzie równie cicho.

---

## 5. Wzorce systemowe

Pojedyncze usterki są objawami; wzorce są chorobą. Wersja z 30.07 miała pięć — dwa są dziś domknięte,
dwa żywe, jeden zmienił postać, i dochodzi jeden nowy.

1. **Konsument bez producenta — DOMKNIĘTY.** `community-cron` ma dwóch producentów (pg_cron + Actions
   z samozbrojeniem), dren `transactional_emails` jest wpięty w `jobs-tick`, alerty trackera dostały
   realny trigger, runner ma heartbeat i log przebiegów. Klasa „zbudowane w 90%, ostatni kabel
   niewpięty" przestała być niewidoczna, bo dołożono **telemetrię**, nie tylko kabel.
2. **Utrata polityki/guardu w churnie migracji — DOMKNIĘTY inwariantami.** Sześć statycznych bramek SQL
   plus 70 suit pgTAP; bramka odtwarzalności migracji powstała **po trzech** kolizjach numeracji i dziś
   raportuje zero. Reszta klasy: duplikaty **treści** wciąż przez nią przechodzą (§4.6).
3. **Gate, który mierzy sam siebie — ŻYWY i ROZGAŁĘZIONY.** 30.07 miał jeden wariant (sentinel e2e
   potwierdzający sam siebie — nadal, §4.8c). Dziś jest ich pięć: bramka wywalona **własnym komentarzem
   i własnym testem** (§4.3a); bramki **napisane i nigdy nie wpięte** (§4.3b); bramka zielona, bo progi
   **podniesiono do zmierzonego stanu** (bundle, trzeci re-floor, do tego nadpisywalne z env — §4.5);
   bramka zielona, bo progi **nigdy nie podniesiono** (pokrycie 19,5% przy suicie 3423 → 5982); bramka
   zielona z **wbudowaną listą amnestii** i sonda **zielona bez konfiguracji** (§4.7). Wzorzec nie tylko
   przetrwał — zaczął się namnażać wraz z liczbą bramek.
4. **UI odłączone od backendu — ŻYWY, ale skurczony.** `/admin/donations` wycięte, alerty trackera
   okablowane, odznaki zgodne z bazą i auto-przyznawane, tryb „najnowsze wpisy" honorowany. Zostaje
   `checkout_settings` (§4.9) i autozapis stron (§4.8a) — oba z **komentarzem aktywnie zaprzeczającym
   kodowi**, co jest gorsze niż milczący martwy przełącznik.
5. **Naprawa opisana szerzej, niż sięga — NOWY.** Dwa najcięższe ustalenia tego wydania mają identyczny
   kształt: robota jest wykonana **dobrze**, ale **węziej**, niż mówi jej opis. Utwardzenie hosta zamyka
   SSR i zostawia PostgREST (§4.1); retencja RODO zamyka `payment_orders` i zostawia `user_purchases`
   (§4.2); merge per-język naprawia stack stron i zostawia stack wpisów (§3 poz. 4). Za każdym razem nie
   ma błędu w tym, co zrobiono — jest **luka w zasięgu**, którą łatwo przeoczyć, bo dokument wdrożeniowy
   brzmi jak domknięcie. Antidotum: wdrożenie zamykające klasę błędu musi wyliczyć **wszystkie** nośniki
   tej klasy (wszystkie ścieżki czytające tenanta, wszystkie tabele z PII, wszystkie stacki importu)
   i pokazać, że każdy jest objęty albo świadomie wyłączony.
6. **Dostarczanie bez śladu przeglądu — NOWY.** 655 z ~711 commitów w tym okresie weszło **poza PR-ami**,
   z komunikatami „Changes"/„Work in progress"; trzy pary migracji weszły **dwa razy** (§4.6), zacierając
   datowanie zmian; jeden plik z kodem wykonywalnym jest dla gita **binarny**, więc nie przeszedł i nie
   przejdzie żadnego przeglądu (§4.4). Osobno każda z tych rzeczy jest drobna. Razem znaczą, że **ślad
   audytowy repozytorium jest słabszy niż jego safety-net** — bramki są dobre, ale historia, na której
   audytor (i przyszły debugger) musi się oprzeć, jest miejscami nieczytelna.

---

## 6. Co realnie się poprawiło (uczciwy kredyt)

Sprawdzone na kodzie, nie na deklaracjach.

**Wszystkie P0 i P1 z audytu 30.07 — zamknięte i bez regresji** (regresja-check w §Metoda): izolacja
sandbox/live w płatnościach jednorazowych; harmonogram push/digestów (pg_cron `2-59/5` + `scheduler.yml`
z samozbrojeniem); filtr tenanta w `get_chat_peers` z kontraktem pgTAP; jedna lista wykluczeń poczty
z bramką dla 19/19 typów i drenem w `jobs-tick`; furtka Big Five w CRM; statyczna bramka anon-insert;
retencja dowodów księgowych dla `payment_orders`.

**Domknięcia z ostatnich dwóch dni:**

- **Odznaki — pełny cykl.** Katalog w `src/lib/profile/badgeCatalog.ts:5` (`verified`, `expert`, `staff`,
  `contributor`), CHECK w bazie zgodny **1:1** (`20260803095150...:10-13`), test parytetu
  (`badgeCatalog.test.ts:11`) i **6 triggerów auto-przyznawania** z silnika reputacji (`:445-514`).
  Ustalenie „3 z 6 kluczy zawsze łamią CHECK, zero automatyzacji" jest nieaktualne w całości.
- **Alerty trackera — obietnica z cennika ma pokrycie.** Trigger `tg_eu_policy_update_applied`
  (`20260714120000_tracker_data_product.sql:108-166`) czyta `eu_policy_follows` i dla każdego
  obserwującego woła `enqueue_notification(..., 'tracker', ...)` + `emit_domain_event('policy.updated.v1')`.
  Fan-out jest zdarzeniowy, nie cronowy — i dlatego cron nie był potrzebny. Doszedł też feed
  `/tracker/rss.xml`.
- **Macierz uprawnień generowana z bramek SQL.** `/admin/permissions` przestało być ręcznie wpisywaną
  tabelką: snapshot odtwarzany z migracji (`scripts/generate-authz-snapshot.ts`, `src/lib/authz/*`,
  13 komponentów), trasa schudła z ~950 linii inline. Wada wykonania — brak wpięcia bramki parytetu
  do CI — jest w §4.3b, ale **kierunek jest wzorcowy**.
- **Zgody: unifikacja + GPC + audyt decyzji.** CMP i rejestr RODO **przestały być dwoma systemami**:
  most `src/lib/consent/registryBridge.ts:35-45` z doktryną jednego pisarza, wpięty w każdy `setConsent`
  (`src/lib/ads/consent.ts:208-209`), z backfillem po zalogowaniu (`:274`) i inwariantem testowym
  (`src/__tests__/consentGpcRegistry.invariant.test.ts`). GPC obsłużone dwutorowo (nagłówek `Sec-GPC`
  + `navigator.globalPrivacyControl`, `Vary: Sec-GPC`, trasa `/.well-known/gpc.json`, klamrowanie
  analytics/marketing/personalization, ślad `gpc_signal`). Najnowszy commit dokłada audyt decyzji
  (`banner_version`, `decision_id`, `page_url`) i RPC `admin_consent_decisions`/`admin_consent_stats`
  z guardem roli i tenanta (`20260805064123...:83,152`) plus panel `ConsentAuditSummary`.
- **Utwardzenia RLS w tym zakresie:** `REVOKE ALL ON profiles FROM anon` + zdjęta polityka „Profiles anon
  public authors" (`20260803095618`); `REVOKE SELECT ON events` z grantami kolumnowymi (bez `join_url`
  i `recording_url`) + RPC `admin_list_events`/`admin_get_event` (`20260803191905`) — i **domknięte
  w kodzie**: nie został ani jeden `from("events").select("*")`; polityki `crm_lead_notes` i `media`
  dopięte do tenanta; `author_profiles` z zakresem tenanta w SELECT/DELETE właściciela + pgTAP.
- **Kanoniczny głos TTS** — `src/lib/audio/ttsCanonical.ts`: `voiceId`/`model` już **nie od klienta**,
  allowlista + `DEFAULT_TTS_VOICE_ID`; koniec 24-krotnej amplifikacji kosztu.
- **`funnelStats`** — jeden RPC `crm_funnel_stats` zamiast pętli po całej tabeli
  (`crm-funnel.functions.ts:144`).
- **Wyszukiwarka** — `lib/search/overlayTabs.ts`: 4 zakładki z jednym równoległym zapytaniem
  i prawdziwymi licznikami.
- **Tryb „najnowsze wpisy"** na home przestał być widmem (`routes/index.tsx:164,316`); **loader SSR
  wydarzeń** dodany — kolejna pozycja z listy „brak SSR" zamknięta.
- **Newsletter/popup** — przepisany end-to-end z edytorem w adminie (7 zakładek), telemetrią
  (`newsletter_popup_events`) i tokenami pól współdzielonymi z logowaniem; przy okazji **usunięty OAuth
  z popupu** (świadomie, netto −83 linie).
- **Nowe bramki i harnessy:** `check:sql-migration-replay` (zero kolizji na 605 plikach),
  `check:sql-owner-tenant-scope` (samokalibrująca, z jawną listą długu), `check:i18n-parity`,
  `check:widget-fidelity`, `check:db-contract` (po deployu), e2e `no-horizontal-pan` + bramka
  `horizontalPanGuard`, oraz **nocna sonda rozliczeń** (`billing-nightly.yml`) sondująca realne
  odnowienie i dunning.
- **Suita testów** 3423 → **5982** (+75%), pgTAP 62 → **70**, e2e w dwóch trybach (zwykły i zaseedowany
  z lokalną bazą); **38 nowych plików testów** tylko w ostatnich dwóch dniach.
- **Higiena, którą warto odnotować:** w całym zakresie 715f934..HEAD **zero** dodanych
  `TODO`/`FIXME`/`@ts-ignore`/`eslint-disable` w `src/`, i **żadnego nowego martwego kodu** — 25 nowych
  komponentów i modułów ma realnego, nietestowego importera.

---

## 7. Priorytetyzacja napraw

**P0 (bezpieczeństwo / odblokowanie procesu):**
1. **Domknąć spoofowalność tenanta na ścieżce API** — podpisany nagłówek od krawędzi albo claim tenanta
   w JWT zamiast `request.headers ->> 'x-tenant-host'`; do czasu naprawy sprostować dokumentację, że
   utwardzenie dotyczy tylko SSR (§4.1).
2. **Odblokować CI:** wyciąć komentarze i `__tests__` ze skanu `check:sql-app-role` (albo allowlista dla
   `src/lib/ci/**`) — blokująca bramka czerwona z powodu własnego fixture'u nie chroni niczego, a uczy
   ignorowania czerwieni (§4.3a).
3. **Wpiąć `check:authz-snapshot` i `check:permissions-parity` do `verify`** i zregenerować snapshot
   (zdryfowany: 589/523/505 vs 605/530/504) — inaczej macierz uprawnień znów zacznie kłamać (§4.3b).
4. **Zamknąć ścieżkę omijającą bramki:** ochrona gałęzi `main` z wymaganymi statusami albo format +
   bramki na ścieżce platformy (655 z ~711 commitów weszło poza PR-ami) (§4.3c).

**P1 (RODO / integralność / koszt):**
5. **`user_purchases`** — pseudonimizacja `user_id`, `retention_until`, purge w tym samym cronie co
   `payment_orders`, test pgTAP retencji (§4.2).
6. **Naprawić plik binarny dla gita** (`joinUsLegacyContent.test.tsx`, bajt NUL → `" "`) i dodać
   inwariant CI „żaden plik w `src/` nie jest binarny" — tania bramka na całą klasę (§4.4).
7. **Usunąć `image/svg+xml` z allowlist importera WP** w obu stackach — import obchodzi bramkę
   anty-XSS, którą ręczny upload egzekwuje, a bucket jest publiczny (§3 poz. 4).
8. **Merge per-język w stacku importu wpisów** (`wordpress-import.functions.ts:706-709,747,797`) —
   stack stron ma to od 03.08; asymetria jest pułapką.
9. **Bundle:** zamrozić progi (bez nadpisywania z env w CI), wykonać zaległy split locale PL/EN
   i wypchnąć `@tanstack` z entry; budżet docelowy **poniżej** bieżącego stanu (§4.5).

**P2 (jakość / prawda w kodzie / ślad audytowy):**
10. `checkout_settings` — okablować do Paddle albo wyciąć razem z testami pilnującymi martwego kodu;
    **kłamiące komentarze poprawić natychmiast**, niezależnie od decyzji (§4.9).
11. Autozapis stron — włączyć `useAutosave`+`AutosaveBar` albo skasować komentarz, który od czterech
    wydań twierdzi, że jest włączony (§4.8a).
12. Rozszerzyć bramkę replay o duplikaty **treści** migracji i usunąć trzy bliźniaki (§4.6).
13. Sonda rozliczeń: polling zamiast `sleep 40 min`; brak sekretów = status neutralny/czerwony, nie
    zielony (§4.7b). Sukcesywnie skracać listę amnestii bramki właściciela (§4.7a).
14. Przepisać `e2e/ssr-completeness` na asercje treściowe z wyłączonym guardem i rozszerzyć o trasy
    CMS-owe (§4.8c); rozważyć prerender kluczowych stron.
15. Wpiąć **knip** do CI (337 martwych eksportów, 262 martwe typy — dług rośnie monotonicznie); podnieść
    progi pokrycia stojące na 19,5%/15,75% przy potrojonej suicie.
16. Bramka `check:sql-search-path` na 4 funkcje kolejki e-mail (§4.10).
17. Zaległości bez zmian od 30.07: konsolidacja dwóch tabel programów (§4.8b); FTS czatu z polską
    fleksją albo poprawa komentarza; `UNIQUE` na `campaign_events` (open/click >100%); bot-filtering
    w analityce; `news-sitemap` w `robots.txt`; import EUR-Lex/OEIL i diff wersji w trackerze; wyjście
    z `'unsafe-inline'` w CSP.

---

## 8. Zastrzeżenia metodyczne

- **Audyt statyczny.** Nie uruchamiałem produkcyjnej instancji Supabase ani dostawcy płatności.
  Ustalenie §4.1 jest wyprowadzone z definicji `request_public_host()` / `public_tenant_id()` i braku
  walidacji po stronie bazy — **nie z wykonanego żądania cross-tenant**. Kierunek jest jednoznaczny, ale
  potwierdzenie eksploatowalności wymaga testu na żywym środowisku (i to jest pierwszy krok rekomendacji
  P0 nr 1).
- **`check:db-contract` nieweryfikowalny lokalnie** (wymaga `SUPABASE_URL` i klucza); w CI działa
  w jobie `post-deploy`, czyli **po** merge'u — kontrakt bazy nie jest bramką PR-a.
- **pgTAP nieuruchomiony w tej sesji** (brak lokalnej bazy). Liczba suit (70) i konfiguracja blokująca
  z pinem CLI są odczytane z repo; wcześniejsze wydanie potwierdziło, że po pinie i kroku właścicielskim
  suita realnie biegnie w CI.
- **Bundle nie zmierzony buildem** — podaję progi z `check-bundle-size.ts` i historię re-floorów
  z komentarzy, nie wynik świeżego `bun run build`. Progi są ustawiane „nad zmierzony ślad", więc
  odzwierciedlają stan `main` z dokładnością do ~1 KB.
- **Weryfikacja wspierana równoległymi przebiegami** (dług/wydmuszki, bezpieczeństwo/infrastruktura,
  delta modułowa). Wszystkie ustalenia cięższe niż „średnia" — utwardzenie hosta, retencja RODO, czerwone
  bramki, bajt NUL, bliźniacze migracje, lista amnestii, sonda rozliczeń — sprawdziłem osobiście na
  plikach. Jedna sprzeczność między przebiegami (czy `check:permissions-parity` jest w CI) została
  rozstrzygnięta **własnym grepem**: nie jest.
- **Oceny są kompozytem** (kompletność + inżynieria + dopracowanie + bezpieczeństwo + testy) w skali
  z `OCENA_FUNKCJI_2026-07-24.md`, żeby wszystkie wydania były porównywalne 1:1. Baza porównania dla
  kolumny 05.08 to `OCENA_FUNKCJI_TABELE_2026-08-03.md` (rewizja 2).
- **Historia git spłaszczona i miejscami nieczytelna** — 1185 commitów w 8 dniach, z czego 655 to
  „Changes"/„Work in progress" prosto na `main`; do tego trzy pary bliźniaczych migracji (§4.6)
  i jeden plik binarny dla gita (§4.4). Datowanie regresji opiera się na numerach migracji i treści
  PR-ów; archeologia commitów automatycznych jest niedostępna.
- **Zakres.** Dokument ocenia **zdolności produktowe i inżynierskie**, nie treść merytoryczną publikacji
  (zgodnie z zastrzeżeniem przyjętym w wydaniu 03.08).

---

*Wydanie 05.08 rewiduje założenia serii `OCENA_*`/`AUDYT_*` na HEAD `1672ece`. Werdykt: platforma przeszła
w sześć dni drogę, którą audyt z 30.07 wyznaczył jako warunek powrotu do ósemki — wszystkie P0 i P1
domknięte, safety-net z trzech bramek do dziesięciu, suita testów o 75% większa, zero nowego martwego
kodu. Uczciwa liczba to jednak **7,8/10**, nie 8,0: dwie najcięższe naprawy sięgają **węziej, niż mówi
ich opis** (host tylko w SSR, retencja tylko w jednej tabeli), CI na `main` jest czerwone na bramce
wywalonej własnym komentarzem, a ślad audytowy repozytorium — 92% commitów poza PR-ami, bliźniacze
migracje, plik niewidoczny w review — jest dziś **słabszy niż safety-net, który go otacza**. Do 8,5 nie
brakuje nowych funkcji; brakuje domknięcia zasięgu tych, które już są, i przywrócenia czytelności zapisu.*
