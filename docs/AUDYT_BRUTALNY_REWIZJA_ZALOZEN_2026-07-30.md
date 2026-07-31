# Brutalny audyt platformy — rewizja wcześniejszych założeń (2026-07-30)

**Data:** 2026-07-30 · **HEAD:** `be34fc3` · **Gałąź:** `claude/platform-audit-assumptions-3lgp5s`
**Zakres:** cała platforma (moduły, funkcje, zakres funkcjonalności) skonfrontowana z faktycznym kodem,
migracjami i uruchomionymi narzędziami. Punkt odniesienia: seria `OCENA_*` / `AUDYT_*` w `docs/`.

> **AKTUALIZACJA 2026-07-31 — wszystkie P0 domknięte.** Po tym audycie wdrożono naprawy: PR-y #115–#123
> zamknęły `get_chat_peers` (regresja cross-tenant), scheduler `community-cron` (push/digest), unifikację
> suppression, samozbrojenie runnera newslettera, martwy panel darowizn, SSR trackera i paginacje.
> Ostatni otwarty P0 — **izolacja sandbox/live w płatnościach one-time** — oraz P1 **furtka Big Five w CRM**
> i **gate CI anon-insert** domknięte w `WDROZENIE_P0_P1_AUDYT_2026-07-31.md`. Korekta założenia: **quiz
> nie jest wydmuszką** — to celowa promocja drugiej platformy NES (EuroChallenge), ocena 3 → 7 (§4.10).
> Oceny szczegółowe poniżej zostawiam w brzmieniu z 30.07 jako zapis stanu w chwili audytu.

## Po co ten dokument

Poprzednie audyty budowały narrację „**8,0/10, napisane nieprzeciętnie starannie**"
(`OCENA_FUNKCJI_2026-07-24.md`). Ten dokument **rewiduje te założenia** — zgodnie z poleceniem,
oceny mogą iść **drastycznie w dół albo w górę**. Nie powtarzam katalogu funkcji (jest w
`INWENTARZ_FUNKCJONALNOSCI_2026-07-24.md`); sprawdzam, **które twierdzenia się bronią, a które
nie**, i dlaczego safety-net (CI) części z tych problemów nie złapał.

Metoda: 10 równoległych audytorów-agentów prześledziło moduły end-to-end (trasa → lib → RPC →
tabele → RLS → testy), a najcięższe/sporne ustalenia zweryfikowałem osobiście na kodzie i
migracjach. Tam, gdzie dwaj agenci sprzeczali się (np. `get_chat_peers`), rozstrzygam **czytając
kod źródłowy i seed testu**, nie głosowaniem.

---

## 1. Twarde sygnały (uruchomione na tej sesji, HEAD `be34fc3`)

| Sprawdzenie | Wynik | Uwaga |
| --- | --- | --- |
| `vitest run` | **3423 pass / 50 skip / 0 fail** (399 plików) | Zielono — **ale dopiero po przepięciu `bun.lock` na publiczny rejestr**; z committowanym lockiem 161 plików pada na nierozwiązywalnym imporcie (`@tanstack/react-query`), bo pinny wskazują prywatny GAR Lovable. |
| `tsc --noEmit` | **czysto** | Realny gate typów (build przez esbuild nie typuje). |
| `eslint .` (`bun run lint`) | **CZERWONO — 1888 problemów** (1759 błędów, 129 ostrzeżeń) | Głównie `prettier/prettier`, auto-fixowalne, ale **w realnych plikach `src/`** (Header, Footer, admin/*, e2e, scripts). **Lint NIE jest bramką CI** (`ci.yml` odpala typecheck/test/build/bundle, nie eslint) — dlatego formatowanie zgniło niezauważone. Kilka `WDROZENIE_*` twierdzi „eslint zielono" — na HEAD to nieprawda. |
| `knip` | 8 martwych plików, **293 martwe eksporty, 207 martwych typów**, 19 duplikatów eksportu, 1 nieużywana zależność, 1 nielistowana | Skonfigurowany, **nieegzekwowany w CI**. |
| Migracje SQL | **548 plików** | (poprzednie audyty: 444–466 — realny przyrost). |
| Polityki RLS | **408 unikalnych** (nazwa+tabela) z 994 instrukcji `CREATE POLICY` | Tabel bez RLS: **0/198**. Twierdzenie „915 polityk" (`OCENA_FUNKCJI`) **liczyło instrukcje forward-only, zawyżając ~2,4×**. |
| Funkcje `SECURITY DEFINER` | 915 definicji, **911 z `SET search_path`** | 4 bez (`email_infra`), ale wszystkie `REVOKE FROM PUBLIC`. |
| Bloki / widgety | **100 bloków / 87 widgetów** | Twierdzenie „100 + ~75" — bloki trafione, **widgety zaniżone** (jest 87, nie 75). |
| Trasy | 202 pliki (128 admin) | |
| Historia git | **tylko 2 dni** (212 commitów, wszystkie 2026-07-29/30) | Repo spłaszczone/squashowane przez Lovable; „archeologia" commitów jest niedostępna, komunikaty typu „Changes"/„Work in progress" — audyt musi ufać kodowi, nie historii. |
| Bramki CI (`ci.yml`) | typecheck, test+coverage, kontrakt SEO, build, bundle | **Progi pokrycia: 19,5% instrukcji / 15,75% gałęzi** (globalnie). e2e i Lighthouse w osobnych workflow, jadą na **dev-serwerze**. |

**Wniosek z twardych sygnałów:** deklarowana „staranność" jest częściowo realna (3423 zielone testy,
czysty typecheck, 100% RLS), ale **safety-net ma dziury, które maskują regresje**: lint poza CI,
knip poza CI, progi pokrycia na poziomie ~16–20%, a kluczowe testy integracyjne (pgTAP, e2e)
albo są płytkie, albo — jak pokażę — **czerwone i ignorowane**.

---

## 2. Werdykt ogólny: **7,0 / 10** (rewizja z deklarowanych 8,0)

To **nie jest** obniżka „bo kod jest zły" — kod w większości jest realny i ponadprzeciętny jak na
tę skalę. To obniżka za **systematyczną różnicę między deklaracją a stanem faktycznym**, spójną
co do kierunku w kilku modułach (~0,7–1,0 zawyżenia). Trzy rzeczy ciągną werdykt w dół i żadna z
nich nie była widoczna w audycie z 24.07:

1. **Load-bearing martwe ścieżki.** Kolejka web-push i digesty e-mail mają w repo konsumenta i
   **zero producenta wywołania** (`community-cron` nie ma harmonogramu — §4.5). Dren kolejki maili
   transakcyjnych **nie istnieje w repozytorium** (§4.4). Z samego repo: push, digesty i część
   maili transakcyjnych **nie wychodzą**.
2. **Dwie ~30-dniowe ekspozycje bezpieczeństwa znalezione dopiero wczoraj** (migracje `lock_down`
   z 30.07): anonimowy INSERT do `contact_messages` i **fabrykowanie zgód RODO** w `crm_consent_log`
   stały otwarte ~miesiąc (§4.9). Proces jest **reaktywny, nie prewencyjny**.
3. **Świeża regresja cross-tenant z czerwonym, ignorowanym testem** (`get_chat_peers`, §4.3) —
   dowód, że pgTAP w CI albo nie odpala się na realnej bazie, albo nikt nie patrzy.

Do tego dochodzi **UI, które kłamie** użytkownikowi/adminowi (ustawienia checkoutu bez wykonawcy,
`/admin/donations` „zapisuje webhook Stripe", komentarz „autozapis włączony" nad kodem bez
autozapisu, „alerty trackera" sprzedawane w cenniku bez implementacji).

**Ale — uczciwie w drugą stronę** (§6): część rzeczy realnie dojrzała od starszych audytów.
Reset hasła, MFA TOTP, eksport/usunięcie RODO, Customer Portal, przypisy end-to-end, live blog,
SEO web stories, ingestowalny RSS podcastów, paginacja taksonomii — to wszystko **naprawione i
przetestowane**. Gdyby nie te przyrosty, werdykt byłby niższy niż 7,0.

---

## 3. Rewizja ocen per moduł

Strzałka = kierunek względem `OCENA_FUNKCJI_2026-07-24.md`. „(nowe)" = defekt nieujęty wcześniej.

| # | Obszar | Było (24.07) | **Teraz** | Kierunek | Główny powód rewizji |
| - | ------ | :----------: | :-------: | :------: | -------------------- |
| 1 | Treści — czytelnik + edytor | 7,8 / 8,2 | **8,0** | ↑ | Przypisy end-to-end, kotwice skonsolidowane, live blog dokończony, placeholder takeaways usunięty. |
| 2 | Bloki + page builder | 8,6 | **8,8** | ↑ | Realnie **100 bloków / 87 widgetów**, pełne pokrycie rejestrów, 0 placeholderów. Interop tylko blocks→builder. |
| 3 | Strony (builder pages) | (w 4: 7,3) | **6,5** | ↓ | Autozapis **nadal wyłączony** wbrew komentarzowi w kodzie; snapshoty stron gubią `template_type`/`toc_override`; 2 martwe przełączniki. |
| 4 | Media / import WP | 7,3 | **6,8** | ↓ | Import WP **nadal niszczy drugi język** (nadpisuje cały `blocks_data`); walidacja mediów na danych klienta, brak dedup. |
| 5 | Podcasty / audio / TTS | 7,5 (w 7) | **8,0** | ↑ | RSS teraz **ingestowalny** (enclosure+itunes), hosting audio realny, TTS zabezpieczony; minus: `/api/tts` bez cache, kolejka `autoplay_next` martwa. |
| 6 | SSR / SEO / wydajność | 7,9 / (SSR 5,9) | **6,5** | ↓ | `/tracker` to SSR-shell; **e2e-gate pozorny** (guard sam dopisuje sentinel); bundle publiczny **1,47 MB gzip**; prerender = 0; news-sitemap nieodkrywalny. |
| 7 | Czat / komunikator | 8,0 | **7,5** | ↓ | **Regresja cross-tenant `get_chat_peers`** (test czerwony); brak „Zgłoś" w oknie czatu; FTS `simple` bez fleksji wbrew komentarzowi. |
| 8 | Sieć / networking | 7,6 | **8,0** | ↑ | Graf deny-all + RPC-only wzorcowy, rekomendacje **naprawione kontraktowo** i pokryte pgTAP. |
| 9 | Realtime / powiadomienia / push | 8,4 | **6,5** | ↓↓ (nowe) | **Nikt nie woła `community-cron`** → kolejka push i digesty stoją; z repo **push nie wychodzi**. Krypto/SW/gating są znakomite, ale bez schedulera to teatr. |
| 10 | Newsletter / e-mail | 7,7 | **6,5** | ↓ | Suppression rozjechana na 2 tabele; tx-suppression działa dla **1 z 19 typów** maila; **dren kolejki tx nie istnieje w repo**; runner **domyślnie wyłączony**. |
| 11 | Monetyzacja — checkout/subskrypcje | 8,4 | **8,0** | ↓ (nowe) | **Brak izolacji sandbox/live w ścieżce one-time** (env sterowany przez klienta) + 2 wydmuszki po Stripe. Rdzeń nadal mocny (Portal, faktury, dunning realne). |
| 12 | Monetyzacja — kupony/darowizny/reklamy | 6,9 | **6,8** | ~ | Kupony **naprawione i przetestowane** (↑), ale `/admin/donations` to trwale pusta wydmuszka „zapisuje webhook Stripe" (↓). |
| 13 | Profil / konto / RODO | 8,0 | **7,5** | ↓ | MFA/RODO realne (↑ vs 07-11), ale **furtka Big Five do CRM** przez service-role, kasowanie faktur z kontem, 3 niespójne ścieżki logowania (OAuth tylko w bloku, bez MFA). |
| 14 | Analityka / BI | 8,7 | **7,5** | ↓ | GA4 Data API i warstwa semantyczna realne (↑), ale Overview to **flagi env udające insighty**, GSC status „zbiera dane" bez pingu, **zero bot-filtering**, 6/7 zakładek omija słownik. |
| 15 | CRM | 8,1 | **8,0** | ~ | Scoring z 10 triggerami, cron follow-upów, dedup importu — realne; minus `funnelStats` pętlą po całej tabeli i 1 sztywny partner (Merydian). |
| 16 | Społeczność | 7,6 | **7,5** | ~ | Ankiety/Q&A/reputacja realne, ale **katalog odznak wywala się na CHECK** (3 z 6 kluczy nielegalne w DB) i brak auto-przyznawania. |
| 17 | Typy specjalne (tracker/programy/eksperci/quiz) | 7,5 | **6,5** | ↓ | Tracker bez importu/RSS/**alertów** (a alerty **sprzedawane w cenniku**); **2 równoległe tabele programów**; **quiz to obcy iframe** `nes-quiz.com`. |
| 18 | Ustawienia / multi-tenant / bezpieczeństwo | 8,5 (arch. 8,2) | **7,8** | ↓ | 0 tabel bez RLS, step-up MFA, 2 gate'y SQL — ale **4 anonimowe kanały INSERT otwarte ~30 dni**, znalezione 30.07, nie przez gate. |
| 19 | Platforma / backend / szyna zdarzeń | 8,7 | **8,0** | ↓ | Szyna domenowa i idempotencja realne, ale „915 RLS" → 408; footgun `x-tenant-host` wciąż spoofowalny (eskalacja zamknięta, spoofowalność nie). |
| 20 | Lejek / pricing / UX konwersji | (UX 5,9) | **6,5** | ↑ | `/pricing` ma teraz matrycę porównania + FAQ (był „49 linii"); checkout nadal wybija do `/profile/billing` po dane. |

---

## 4. Ustalenia krytyczne i wysokiej wagi (z dowodami)

### 4.1 [KRYTYCZNE, NOWE] Monetyzacja: brak izolacji sandbox/live w ścieżce jednorazowej

Klient dyktuje `environment` (`src/lib/billing/checkout.functions.ts:35`, enum Zod), webhook bierze
`?env=` z URL (`src/routes/api/public/payments/webhook.ts:13`), a `fulfilOneTimeTransaction`
(`webhookDispatch.server.ts:337-345` → `oneTimeFulfilment.server.ts:109-161`) nadaje uprawnienie
**bez sprawdzenia środowiska**. `payment_orders` nie ma nawet kolumny `environment`, a pole
`environment` w `paddleEffects.server.ts:18` nie jest **nigdzie czytane**. Jeśli produkcja ma
ustawiony `PADDLE_SANDBOX_API_KEY` i sandboxowy webhook, **zakup kartą testową w sandboxie
odblokowuje realną treść premium**. Ścieżka subskrypcyjna jest odporna (`subscriptions.environment`
+ `.eq("environment", env)` w `webhookDispatch.server.ts:87-105`) — one-time nie.

### 4.2 [KRYTYCZNE, NOWE] Realtime: kolejka push i digesty bez wywołującego

Łańcuch web-push jest kompletny i dobrze zrobiony: `webpush.server.ts` (RFC 8291/8188, VAPID ES256)
← `dispatch.server.ts:172` ← `processPushJobs:214` ← job `push` w `src/routes/api/public/community-cron.ts:70`.
Service worker `public/push-sw.js` rejestrowany po opt-in, subskrypcje zapisywane, **preferencje
respektowane w 100%** (`enqueue_notification` CASE, `20260721120000...:217-226`).

**Ale nic w repo nie woła `community-cron`.** Zweryfikowane osobiście: brak `cron.schedule('community-cron'...)`,
brak `net.http_post` celującego w ten endpoint, brak `schedule:` w `.github/workflows/*`. Dla kontrastu
**samo-planują się** przez pg_cron: `jobs-tick`, `event-reminders`, `crm-task-reminders`,
`saved-search-alerts`, `billing-reminders`, `publish-due-*`. `community-cron` jest jedynym
konsumentem kolejki bez producenta. `.env.example:65-67` wspomina „wołaj co 5–60 min z dowolnego
schedulera" — czyli **projekt zakłada zewnętrzny cron, którego repo nie dostarcza ani nie wymienia
w wymaganym setupie**. Skutek: świeży deploy zgodny z repo ma push i digest **martwe po cichu**.
(Ten sam plik hostuje digest e-mail przez `processDigests` — również stoi.)

### 4.3 [WYSOKA/bezpieczeństwo, REGRESJA] `get_chat_peers` — wyciek profili cross-tenant, test czerwony

**Rozstrzygnięte osobiście na kodzie i seedzie** (dwaj agenci się sprzeczali). Migracja utwardzająca
z 11.07 (`20260711120000...:419-450`, filtr tenanta + `REVOKE FROM anon`) została **zdmuchnięta** przez
`20260721211552_...sql` (`DROP FUNCTION` + `CREATE` bez filtra tenanta). Bieżące ciało:

```sql
WHERE p.id = ANY (p_user_ids)
  AND ( p.id = auth.uid()
        OR p.discoverable = true            -- ⬅ zwraca profil z DOWOLNEGO tenanta
        OR EXISTS (wspólna konwersacja) )
```

Późniejsza `20260725181430...:33` przywróciła **tylko** `REVOKE FROM PUBLIC/anon`; **filtr tenanta
nie wrócił**. Gałąź `discoverable = true` to jeden z trzech OR-ów (nie koniunkcja), więc dowolny
zalogowany użytkownik tenanta B, mając UUID, wyciąga `display_name/avatar/slug/job_title/current_company/specialization`
discoverable'owego profilu tenanta A.

**Dowód wtórny (zweryfikowany):** `supabase/tests/chat_privacy_isolation_test.sql` seeduje A2 jako
`tenant A, discoverable=true` (`:39`) i B1 jako tenant B, po czym asertuje `count = 0` dla wywołania
`get_chat_peers(['a2'])` jako B1 (`:136-141`). Przy obecnej definicji A2 spełnia `discoverable=true`
→ zwraca 1 → **asercja jest czerwona**. `ci.yml:114-135` odpala `supabase test db` bez
`continue-on-error`. Skoro merge'e nadal przechodzą, to pgTAP **albo nie odpala się na realnej bazie
w tym CI, albo nikt nie czyta wyniku** — od 21.07. (Uwaga: agent bezpieczeństwa uznał tę funkcję za
naprawioną — **błędnie odczytał** gałąź `discoverable` jako wymóg wspólnej konwersacji. To pokazuje,
jak łatwo tę regresję przeoczyć w przeglądzie.)

### 4.4 [WYSOKA] Newsletter: dwie rozłączne listy wykluczeń, dren kolejki tx nie istnieje w repo

Kampanie i double-opt-in pytają `email_suppression` (RPC `suppression.server.ts:88`), a maile
**transakcyjne pytają inną tabelę** `suppressed_emails` (`transactional.server.ts:101`). Webhook
Resend zapisuje wyłącznie do tej pierwszej (`webhooks.resend.ts:342`) → **twardy bounce/skarga nie
blokuje maili transakcyjnych ani digestów**. Gorzej: `transactional.server.ts:105` bramkuje
suppression warunkiem `input.type === "newsletter_confirmed"` — czyli **dla 1 z 19 typów** maila;
dunning, portal, renewal, event_registered lecą na martwe adresy. Do tego `sendTxEmail`/`enqueueRawEmail`
wrzucają do pgmq `transactional_emails`, ale **żadna migracja nie planuje drenu** — jest tylko komentarz
o zewnętrznym narzędziu (`20260728154925...:283-303`), a jedyny drener w repo
(`src/routes/lovable/email/queue/process.ts`) **nie jest nigdzie wołany**. Faktyczna wysyłka
RSVP/dunning/digest jest **nieweryfikowalna z kodu**.

### 4.5 [WYSOKA] Newsletter: runner domyślnie martwy

`job_runner_settings.enabled DEFAULT false`, `base_url DEFAULT ''` (`20260713170000...:42,45`) — pg_cron
puka w `invoke_jobs_tick` co minutę, ale ten no-opuje, dopóki admin nie włączy runnera w **ukrytej
zakładce** (`newsletter-admin.functions.ts:146-156`). Reklamowane „zaplanuj kampanię" jest więc
**wyłączone u każdego, kto nie kliknął w tę zakładkę** — bez alarmu/health-checku.

### 4.6 [WYSOKA/RODO] Profil: furtka Big Five do CRM przez service-role

Migracja `20260711120000...:645-663` **celowo** zamknęła `personality_results` nawet adminom tenanta
(„wyniki psychometryczne nie są publiczne ani dla adminów"). Ale `src/lib/crm.functions.ts:477-482`
czyta tę tabelę **klientem service-role** (omijając RLS) i wystawia wynik staffowi CRM
(`ProfileSyncCard.tsx`) — bez zgody i bez celu przetwarzania. Wynik testu osobowości nadal **nie
zasila rekomendacji** (`get_recommended_posts_v2` nie zna Big Five). Do tego usunięcie konta
(`account.functions.ts`) kasuje twardo przez 71 FK `ON DELETE CASCADE`, w tym `payment_orders` —
czyli **niszczy dowody księgowe** (kolizja art. 74 uor / art. 17(3)(b) RODO).

### 4.7 [WYSOKA] SSR/SEO: gate kompletności SSR potwierdza sam siebie

`documentStreamGuard.server.ts:46` dosztukowuje `FORCED_CLOSE_TAIL = "\n</body></html>"` przy każdym
wymuszonym zamknięciu strumienia, a wrapper jest aktywny też w dev (`vite.config.ts:43-44`), na którym
jedzie Playwright. `e2e/ssr-completeness.spec.ts:28-30` asertuje wyłącznie `<html` +
`endsWith("</html>")` na **4 ścieżkach** (bez posta, trackera, ekspertów, archiwum) i **zero asercji
na treść**. Skoro guard sam dopisuje domykający tag, asercja „musi domknąć `</html>`" **nie może
zafailować**, nawet dla uciętego shella. Dodatkowo `/tracker` (index) **nie ma loadera** →
`tracker.index.tsx:266` renderuje „Ładowanie" w SSR (crawler bez JS widzi pusty stan), a strona jest
w sitemapie z `priority 0.7, changefreq daily`.

### 4.8 [WYSOKA/koszt] SSR: bundle publiczny 1,47 MB gzip, prerender = 0

Progi bramki (`scripts/check-bundle-size.ts:71-73`): `MAX_PUBLIC_KB=1475`, `MAX_TOTAL_KB=2518`,
`MAX_CHUNK_KB=350` — czyli **~1,47 MB gzip JS dla publicznego czytelnika** serwisu treściowego
(5–6× ponad rozsądny budżet). Komentarz sam przyznaje 4 kolejne „re-floory", bo gate stał czerwony na
main — **progi gonią regresję**. Prerender nie istnieje (`vite.config.ts` bez `pages`/`crawlLinks`);
`src/lib/prerender.ts` to osłony Speculation Rules, nie prerender buildowy.

### 4.9 [WYSOKA/bezpieczeństwo] ~30-dniowe anonimowe kanały INSERT (znalezione 30.07)

Migracje `lock_down` z 30.07 zamknęły cztery tabele przyjmujące INSERT wprost przez PostgREST:
- `contact_messages` — otwarte ~34 dni (spam/phishing wprost do skrzynki admina, odpalając triggery CRM);
- `crm_consent_log` — otwarte ~30 dni: **każdy mógł fabrykować zgody RODO na dowolny e-mail**, co
  niszczy wartość dowodową audytu zgód;
- `related_post_clicks`, `builder_experiment_events` — fabrykacja statystyk / wyników A/B.

Migracje same przyznają, że guard `is_experiment_running()` **zgubił się w churnie polityk**
(`20260730140000...:11-12`). To jedna klasa błędu (utrata polityki w przepływie DROP/CREATE), która
**wróci bez statycznego gate'u** „żadna tabela intake nie ma polityki INSERT dla anon/authenticated".
Rewizja: ocena bezpieczeństwa 8,5–8,7 z 24.07 była wystawiona **przed** tym skanem i jest nie do
utrzymania — realnie ~7,3 na 24.07, dziś 7,8 (rosnąco dzięki lockdownom, nie dzięki procesowi).

### 4.10 [ŚREDNIA] Wydmuszki i UI, które kłamie

- **`checkout_settings`** — panel `admin.paywall.tsx:975-1046` zapisuje 5 przełączników (auto-tax,
  tax-id, invoice-creation…), `checkout.$planId.tsx:314-322` **obiecuje je kupującemu**, a body
  transakcji Paddle (`paddleTransaction.server.ts:85-101`) **nie zawiera żadnego**. 132 linie testów
  pilnują martwego kodu.
- **`/admin/donations`** (245 linii) — trwale pusty, nadal deklaruje „Zapisuje je webhook Stripe"
  (`admin.donations.tsx:85-92`); darowizny przeniesione na zrzutka.pl, webhook je ignoruje.
- **Autozapis stron** — `admin.pages.$slug.tsx:293` twierdzi „Autozapis włączony (jak dla wpisów)",
  ale `useAutosave` **nie jest importowany**; zapis tylko ręczny.
- **Alerty trackera** — `capabilities.ts:50` sprzedaje „alerty trackera" jako benefit warstwy, a
  **żaden job nie czyta `eu_policy_follows`**.
- **Quiz** — ~~`quiz.tsx:264` to `<iframe>` do zewnętrznej domeny; wydmuszka.~~ **KOREKTA 2026-07-31:**
  to NIE wydmuszka, tylko **celowa landing-strona promocyjna drugiej platformy NES** (EuroChallenge,
  `nes-quiz.com`) — cross-promo z brandowanym `head()`, `LazyQuizIframe`, tłem z preloadem i przyciskami
  udostępniania. Zostaje jeden realny drobiazg: `head()` ma opis/OG zahardkodowane po polsku (bez
  `activeLang`) — do zbilingwalizowania. Ocena funkcji zrewidowana 3 → 7.
- **Odznaki** — `BADGE_CATALOG` (`admin/community.ts:698-706`) oferuje 6 kluczy, DB CHECK
  (`20260713091000...:23`) dopuszcza 4; **3 z 6 pozycji w dropdownie zawsze łamią CHECK**, a legalny
  `staff` jest nienadawalny z UI. Odznak nie przyznaje żaden trigger (100% ręcznie), mimo że silnik
  reputacji liczy dokładnie te aktywności.

---

## 5. Pięć wzorców systemowych (meta-ustalenia)

To jest sedno „brutalnej szczerości" — pojedyncze bugi są objawami, wzorce są chorobą:

1. **Konsument bez producenta.** `community-cron` (push+digest), dren `transactional_emails`,
   `autoplay_next`, alerty trackera — wielokrotnie zbudowano kolejkę/konsumenta i **nie podłączono
   wyzwalacza**. Klasa: „zbudowane w 90%, ostatni kabel niewpięty", niewidoczna w testach jednostkowych.
2. **Utrata polityki/guardu w churnie DROP/CREATE.** `get_chat_peers` (filtr tenanta), 4 kanały
   INSERT (`is_experiment_running`) — migracje forward-only nadpisują obiekt i **gubią wcześniejsze
   REVOKE/filtry**. Brak gate'u na regresję uprawnień.
3. **Gate, który mierzy sam siebie.** e2e SSR asertuje sentinel dopisywany przez guard; „915 RLS"
   liczy instrukcje churnu; progi pokrycia 16–20%; lint i knip poza CI. **Bramka istnieje, ale nie
   broni.**
4. **UI odłączone od backendu = obietnica wobec użytkownika.** checkout_settings, donations, autozapis,
   alerty trackera — nie „martwy kod", lecz **panel/cennik obiecujący zachowanie, którego nie ma**.
5. **Rozjazd komentarz/dokumentacja ↔ kod.** „Autozapis włączony", „FTS z polską fleksją" (a jest
   `simple`), „limit 30/5min rate_limit_hit" (a jest nieatomowy COUNT), „eslint zielono", „915 RLS",
   „~75 widgetów". Dokumentacja gnije szybciej niż kod.

---

## 6. Co realnie się poprawiło (uczciwy kredyt, rewizja w GÓRĘ)

Żeby audyt był brutalny w obie strony — te twierdzenia sprawdziłem i **bronią się lub urosły**:

- **Auth/RODO z 5/10 (07-11) na realne 7,5.** `reset-password.tsx` istnieje i działa end-to-end;
  MFA TOTP realne (`mfa.enroll/challenge/verify`, step-up aal2 egzekwowany serwerowo w
  `require-staff.ts:70-82`); eksport RODO (17 sekcji) i usunięcie konta z uprzednim anulowaniem
  subskrypcji u operatora.
- **Customer Portal ISTNIEJE** (`portalLink.server.ts:46-74`) — twierdzenie „brak" jest nieaktualne;
  razem z fakturami, dunningiem i samoobsługową zmianą planu.
- **`grantEntitlement` i kupony naprawione mocniej niż deklarowano** — udokumentowany kontrakt +
  8 testów regresji (`grant.server.test.ts:228-274`), wydzielony moduł `couponMoney.ts` + pgTAP.
- **Przypisy** end-to-end (edytor→silnik→SSR, 8+ plików testów); **kotwice** skonsolidowane do
  jednej `slugifyAnchor` z testem parytetu na `ł`.
- **Live blog dokończony** (link w nawigacji, pełny CRUD, realny blok realtime z SSR-prefetch).
- **Web stories** — AMP + JSON-LD + sitemap + indeks; **podcast RSS** teraz ingestowalny (enclosure,
  itunes:*), z panelem readiness ostrzegającym o brakach.
- **Paginacja taksonomii** (`category`/`tag` z `?page=N` + `noindex` dla stron >1).
- **Warstwa semantyczna analityki** — reconciliation, `authoritative` vs `corroborating`, `safeRatio`,
  rozróżnienie `not_configured`/`no_data`; poziom, którego większość repo nie osiąga.
- **CRM to nie „skrzynka leadów"** — scoring z 10 realnymi triggerami, parytet TS↔SQL pilnowany
  testem, cron follow-upów z `SKIP LOCKED`, dedup importu w jednej transakcji.

---

## 7. Priorytetyzacja napraw

**P0 (pieniądze / bezpieczeństwo / martwe ścieżki):**
1. Izolacja sandbox/live w one-time: dodać kolumnę `environment` do `payment_orders`, filtrować w
   `oneTimeFulfilment`/`resolvePlanForPrice`, wyjąć `environment` spod kontroli klienta (§4.1).
2. Zaplanować `community-cron` przez pg_cron+pg_net (wzorem `invoke_jobs_tick`) albo `schedule:` w
   Actions — inaczej push i digest nie wychodzą (§4.2).
3. Przywrócić filtr tenanta w `get_chat_peers` i **potwierdzić, że `supabase test db` faktycznie
   odpala się w CI** (test jest czerwony od 21.07) (§4.3).
4. Zunifikować suppression (jedna tabela) i przepuścić `sendTxEmail` przez nią dla **wszystkich**
   typów; podłączyć dren `transactional_emails` do `runJobsTick` (§4.4).

**P1 (RODO / integralność danych):**
5. Zamknąć furtkę Big Five w CRM; zdjąć `ON DELETE CASCADE` z `payment_orders`/`user_purchases` na
   rzecz `SET NULL` + anonimizacji (§4.6).
6. Domknąć 4 kanały INSERT **gate'em CI** (statyczny test „brak polityki INSERT dla anon/authenticated
   na tabelach intake"), nie jednorazowym lockdownem (§4.9).

**P2 (jakość / prawda w UI):**
7. Usunąć albo okablować wydmuszki: checkout_settings, `/admin/donations`, autozapis stron, alerty
   trackera, quiz (§4.10).
8. Naprawić odznaki (zunifikować katalog z DB CHECK), rozstrzygnąć duplikat tabel programów.
9. Włączyć **lint i knip do CI**; przepisać `e2e/ssr-completeness` na asercje treściowe (wyłączyć
   guard w teście); dodać loader do `/tracker`.
10. `bun run format` na całym repo (1888 problemów prettier) — jednorazowo, a potem lint-gate pilnuje.

---

## 8. Zastrzeżenia metodyczne

- **Audyt statyczny.** Nie odpalałem realnej instancji Supabase ani produkcyjnego dostawcy płatności —
  ustalenia o „martwych ścieżkach" (community-cron, dren tx) są dowodzone **brakiem w repo** (brak
  schedulera, brak wołającego), co jest silnym, ale nie absolutnym dowodem: zewnętrzny cron
  skonfigurowany poza repo mógłby je ożywić. To wprost odnotowuję przy każdym takim ustaleniu.
- **pgTAP nieuruchomiony.** Twierdzenie „test `chat_privacy_isolation` jest czerwony" jest wyprowadzone
  z lektury definicji funkcji + seedu testu (zweryfikowane), nie z uruchomienia `supabase test db`
  (brak lokalnej bazy). Kierunek konkluzji jest jednak jednoznaczny.
- **Oceny są kompozytem** (kompletność + inżynieria + dopracowanie + bezpieczeństwo + testy), spójnym
  ze skalą z `OCENA_FUNKCJI_2026-07-24.md`, żeby rewizje były porównywalne 1:1.
- Historia git spłaszczona do 2 dni — nie dało się zweryfikować „kiedy" regresji poza datami migracji.

---

*Dokument rewiduje założenia serii `OCENA_*`/`AUDYT_*`. Werdykt: platforma jest realna i miejscami
nieprzeciętna, ale deklarowane 8,0 maskowało wzorzec cichych martwych ścieżek, reaktywnego
bezpieczeństwa i płytkich bramek. Uczciwa liczba to **7,0/10** — z jasną, krótką listą P0, po której
realnie wróci w okolice 8.*
