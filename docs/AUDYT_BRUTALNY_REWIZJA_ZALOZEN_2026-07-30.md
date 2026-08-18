# Brutalny audyt platformy — rewizja wcześniejszych założeń (2026-07-30)

**Data:** 2026-07-30 · **HEAD:** `be34fc3` · **Gałąź:** `claude/platform-audit-assumptions-3lgp5s`
**Aktualizacja:** 2026-08-01 · **HEAD:** `657da6e` (main po PR #111–#124) · twarde sygnały zmierzone ponownie
**Zakres:** cała platforma (moduły, funkcje, zakres funkcjonalności) skonfrontowana z faktycznym kodem,
migracjami i uruchomionymi narzędziami. Punkt odniesienia: seria `OCENA_*` / `AUDYT_*` w `docs/`.

> **AKTUALIZACJA 2026-08-01 — ponowny pomiar na HEAD `657da6e` (main po PR #111–#124).** Wszystkie P0
> i P1 z §7 są domknięte i **zweryfikowane na kodzie tej sesji**, nie tylko na dokumentach wdrożeniowych.
> Werdykt idzie w górę: 7,0 → **7,5** (§2). Konwencja tej rewizji: wartości i oceny z 30.07 zostają w
> tabelach jako migawka („było"), obok dochodzi stan **01.08**; każde ustalenie §4 dostaje dopisek
> **STATUS 01.08**. Najważniejszy nowy sygnał procesowy: lint został bramką CI po jednorazowym
> sformatowaniu repo — i main **znów jest czerwony** (1446 problemów), bo commity platformy idą prosto na
> main z pominięciem PR-ów. Bramka broni PR-ów, nie chroni gałęzi (§1, §5 pkt 3).

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
kod źródłowy i seed testu**, nie głosowaniem. Rewizja 01.08 powtórzyła twarde sygnały (§1) i
zweryfikowała każde ustalenie §4 bezpośrednio na kodzie HEAD `657da6e`.

---

## 1. Twarde sygnały (zmierzone ponownie 2026-08-01 na HEAD `657da6e`; „było" = 30.07, `be34fc3`)

| Sprawdzenie                 | Wynik                                                                                                                                                                                                              | Uwaga                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest run`                | **3665 pass / 50 skip / 0 fail** (421 plików; było 3423 / 399 plików)                                                                                                                                              | Lokalnie nadal wymaga przepięcia `bun.lock` na publiczny rejestr (pinny wskazują prywatny GAR platformy) — ale **CI robi to teraz samo** (krok „Repoint lockfile" w `ci.yml`), więc bramka testowa przestała zależeć od ręcznego obejścia.                                                                                                                                                                                                                                                                                |
| `tsc --noEmit`              | **czysto** (bez zmian)                                                                                                                                                                                             | Realny gate typów (build przez esbuild nie typuje).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `eslint .` (`bun run lint`) | **CZERWONO — 1446 problemów** (1319 błędów, 127 ostrzeżeń; było 1888: 1759/129)                                                                                                                                    | **Lint JEST teraz bramką CI** po jednorazowym sformatowaniu repo (komentarz w `ci.yml`: „backlog wyczyszczony, lint blokuje merge")… i main **znów jest czerwony**: 1313× `prettier/prettier` w 280 plikach, źródłem commity automatyczne platformy pchane **prosto na main** (top: `WidgetProperties.tsx`, `BuilderWidgetNode.tsx`, `MegaPanelView.tsx`, `platform/email/*`). Do tego 1 realny błąd `react-hooks/rules-of-hooks` (`preview.$token.tsx:74` — warunkowy `useRef`), 92× react-refresh, 34× exhaustive-deps. |
| `knip`                      | 7 martwych plików, **303 martwe eksporty, 219 martwych typów**, 19 duplikatów eksportu (było 8 / 293 / 207 / 19)                                                                                                   | Nadal **nieegzekwowany w CI**; dług eksportów lekko rośnie.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Migracje SQL                | **557 plików** (było 548)                                                                                                                                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Polityki RLS                | **998 instrukcji `CREATE POLICY`**; nowy parser gate'ów liczy **517 polityk w stanie końcowym** (uruchomione na tej sesji: `check:sql-anon-insert` ✓)                                                              | Parser stanu końcowego (CREATE/DROP odtwarzane po kolei) zamyka spór o metodę: „915" z `OCENA_FUNKCJI` liczyło churn instrukcji, „408" z 30.07 — pary nazwa+tabela. Tabel bez RLS: bez zmian **0**.                                                                                                                                                                                                                                                                                                                       |
| Funkcje `SECURITY DEFINER`  | przyrost definicji; **niezmiennie dokładnie 4 bez `SET search_path`** — kolejka `email_infra` (`enqueue_email`, `read_email_batch`, `delete_email`, `move_to_dlq`), wszystkie `REVOKE FROM PUBLIC`                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Bloki / widgety             | **100 bloków / 89 widgetów** (było 100 / 87; +2 widgety z 31.07 — slidery/responsive)                                                                                                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Trasy                       | **201 plików (127 admin)** — było 202 (128)                                                                                                                                                                        | Ubyła wydmuszka `/admin/donations` (§4.10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Historia git                | **4 dni, 443 commity** (było 2 dni, 212)                                                                                                                                                                           | Nadal spłaszczona; strona platformy dalej commituje „Changes" **prosto na main**, więc archeologia i bramki PR jej nie obejmują.                                                                                                                                                                                                                                                                                                                                                                                          |
| Bramki CI (`ci.yml`)        | typecheck, test+coverage (progi bez zmian: **19,5% / 15,75%**), kontrakt SEO, build, bundle (progi bez zmian), **chunk-graph**, **lint (NOWA)**, SQL tenant-scope, SQL app-role, **SQL anon-insert (NOWA)**, pgTAP | **pgTAP faktycznie odpala się na lokalnej bazie**: pin `supabase/setup-cli@2.111.0` (rezolucja `latest` padała na nieautoryzowanym rate-limicie api.github.com — run PR #118 — dokładnie to maskowało czerwony test z §4.3) + krok nadający roli testowej prawo przestawiania triggerów `auth.users` (wcześniej większość plików padała od razu na `42501 must be owner of table users`). e2e i Lighthouse nadal w osobnych workflow na **dev-serwerze**.                                                                 |

**Wniosek z twardych sygnałów (01.08):** safety-net realnie się zagęścił — lint i anon-insert weszły
do CI, pgTAP został **odblokowany** (i urósł o 5 suit kontraktowych), scheduler dostał heartbeat, a CI
przestało zależeć od prywatnego rejestru. Zostały dwa systemowe wyjątki: (1) **commity prosto na main
omijają wszystkie bramki** — stąd świeży czerwony lint mimo świeżej bramki; (2) knip i progi pokrycia
(~16–20%) nadal niczego nie bronią. Zdanie z 30.07 o „czerwonych i ignorowanych testach
integracyjnych" jest już nieaktualne — przyczyna była infrastrukturalna i została usunięta.

---

## 2. Werdykt ogólny: **7,5 / 10** (01.08; rewizja z 7,0 z 30.07, wobec deklarowanych 8,0 z 24.07)

To **nie jest** podbicie „bo naprawiono punktowo" — wszystkie trzy rzeczy, które 30.07 ciągnęły
werdykt w dół, zostały domknięte **systemowo** (z bramką, testem kontraktowym albo telemetrią, nie
jednorazową łatą):

1. **Load-bearing martwe ścieżki** — ✅ domknięte podwójnie: `community-cron` ma harmonogram w bazie
   (pg_cron + pg_net) **i** siatkę bezpieczeństwa w Actions, która dodatkowo sama uzbraja ścieżkę
   bazową; dren kolejki maili transakcyjnych istnieje i jest wpięty w `jobs-tick`; runner newslettera
   sam się zbroi i ma heartbeat, więc „martwe po cichu" stało się **obserwowalne** (§4.2, §4.4, §4.5).
2. **Reaktywne bezpieczeństwo (~30-dniowe ekspozycje)** — ✅ klasa błędu zamknięta **statycznym gate'em
   CI** na anonimowe INSERT-y (2 inwarianty na stanie końcowym polityk, self-test nie-pustości),
   uruchomionym i zielonym na tej sesji (§4.9).
3. **Czerwony, ignorowany test pgTAP** — ✅ regresja `get_chat_peers` naprawiona z przywróceniem filtra
   tenanta na obu gałęziach, a hipoteza audytu „pgTAP nie odpala się w CI" **potwierdziła się dosłownie**
   i została usunięta (pin CLI + własność triggerów `auth.users`); doszedł samodzielny kontrakt pgTAP
   (§4.3).

**Co nadal trzyma ocenę poniżej 8:** wydmuszki UI z §4.10 poza darowiznami (checkout_settings,
komentarz o autozapisie, „alerty trackera" w cenniku, odznaki łamiące CHECK), dryf formatowania przez
commity prosto na main (bramka lint nie chroni gałęzi — §5 pkt 3), knip i progi pokrycia poza realną
egzekucją, bundle publiczny nadal ~1,47 MB gzip z prerender = 0 (§4.8), import WP niszczący drugi
język (§3 poz. 4) oraz otwarta połowa P1: twarde `ON DELETE CASCADE` na `payment_orders` przy
usuwaniu konta (§4.6, §7 pkt 5).

Do tego dochodziło **UI, które kłamie** użytkownikowi/adminowi — po 01.08 lista skróciła się o
`/admin/donations` (wycięte i zastąpione uczciwym linkiem zewnętrznym), reszta pozycji stoi (§4.10).

**Ale — uczciwie w drugą stronę** (§6): oprócz napraw P0/P1 platforma w dwa dni realnie urosła:
metering treści, SSR-paginacja bloga i archiwum autora z URL, inline edytor layoutów ekspertów,
konsolidacja kotwic, warstwa „Partner Biznesowy" zamiast sprzedaży reklam (zgodność z AUP Paddle),
5 nowych suit pgTAP. Gdyby nie utrzymujące się wydmuszki i dryf na main, werdykt byłby bliżej 7,8.

---

## 3. Rewizja ocen per moduł

Strzałka = kierunek względem `OCENA_FUNKCJI_2026-07-24.md`. „(nowe)" = defekt nieujęty wcześniej.
Kolumna **01.08** = ta rewizja; dopiski `[01.08: …]` w ostatniej kolumnie tylko tam, gdzie stan się zmienił.

| #   | Obszar                                          |  Było (24.07)   | 30.07 | **01.08** | Kierunek | Główny powód rewizji                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------- | :-------------: | :---: | :-------: | :------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Treści — czytelnik + edytor                     |    7,8 / 8,2    |  8,0  |  **8,0**  |    ↑     | Przypisy end-to-end, kotwice skonsolidowane, live blog dokończony, placeholder takeaways usunięty. [01.08: piąta kopia slugify usunięta — `TocWidget` na kanonicznym `slugifyAnchor`, PR #123.]                                                                                                                                                                       |
| 2   | Bloki + page builder                            |       8,6       |  8,8  |  **8,8**  |    ↑     | Realnie **100 bloków / 89 widgetów** (+2 od 30.07), pełne pokrycie rejestrów, 0 placeholderów. Interop tylko blocks→builder.                                                                                                                                                                                                                                          |
| 3   | Strony (builder pages)                          |   (w 4: 7,3)    |  6,5  |  **6,5**  |    ↓     | Autozapis **nadal wyłączony** wbrew komentarzowi w kodzie; snapshoty stron gubią `template_type`/`toc_override`; 2 martwe przełączniki. [01.08: bez zmian — komentarz o autozapisie wręcz rozbudowano, hook dalej nieimportowany.]                                                                                                                                    |
| 4   | Media / import WP                               |       7,3       |  6,8  |  **6,8**  |    ↓     | Import WP **nadal niszczy drugi język** (nadpisuje cały `blocks_data`); walidacja mediów na danych klienta, brak dedup. [01.08: bez zmian.]                                                                                                                                                                                                                           |
| 5   | Podcasty / audio / TTS                          |    7,5 (w 7)    |  8,0  |  **8,0**  |    ↑     | RSS ingestowalny, hosting audio realny, TTS zabezpieczony; minus: `/api/tts` bez cache, kolejka `autoplay_next` martwa.                                                                                                                                                                                                                                               |
| 6   | SSR / SEO / wydajność                           | 7,9 / (SSR 5,9) |  6,5  |  **7,0**  |   ↓→↑    | Było: `/tracker` SSR-shell, e2e-gate pozorny, bundle 1,47 MB, prerender 0. [01.08: `/tracker` ma loader + ItemList JSON-LD + cache ISR (PR #117); `/blog` i archiwum autora z **SSR-paginacją `?page`** (PR #121/#122). e2e-gate i bundle bez zmian — to one blokują powrót do ~7,5.]                                                                                 |
| 7   | Czat / komunikator                              |       8,0       |  7,5  |  **8,0**  |    ~     | Było: regresja cross-tenant `get_chat_peers` z czerwonym testem. [01.08: filtr tenanta przywrócony na obu gałęziach + samodzielny kontrakt pgTAP (PR #118). Zostają: brak „Zgłoś" w oknie czatu, FTS `simple` bez fleksji.]                                                                                                                                           |
| 8   | Sieć / networking                               |       7,6       |  8,0  |  **8,0**  |    ↑     | Graf deny-all + RPC-only wzorcowy, rekomendacje naprawione kontraktowo i pokryte pgTAP. [01.08: polityki `introduction_requests`/`user_connections` dokręcone o zakres tenanta.]                                                                                                                                                                                      |
| 9   | Realtime / powiadomienia / push                 |       8,4       |  6,5  |  **8,0**  |   ↓→↑    | Było (nowe): nikt nie woła `community-cron` → push i digesty stoją. [01.08: harmonogram w bazie (pg_cron co 5 min) + siatka Actions z samozbrojeniem, heartbeat i log przebiegów + pgTAP (PR #112/#116). Krypto/SW/gating były znakomite — teraz mają wyzwalacz i telemetrię.]                                                                                        |
| 10  | Newsletter / e-mail                             |       7,7       |  6,5  |  **7,5**  |   ↓→↑    | Było: suppression na 2 tabelach, tx-suppression dla 1/19 typów, brak drenu, runner domyślnie martwy. [01.08: **jedna** lista wykluczeń (druga tabela = widok zgodności), bramka dla **19/19** typów ze śladem w `email_send_log`, dren wpięty w `jobs-tick`, runner sam się zbroi (PR #111/#112). Rezerwa: dostarczalność wciąż niepotwierdzona produkcyjnie z repo.] |
| 11  | Monetyzacja — checkout/subskrypcje              |       8,4       |  8,0  |  **8,3**  |    ~     | Było (nowe): brak izolacji sandbox/live w one-time. [01.08: izolacja domknięta dwuwarstwowo — kolumna `environment` + serwerowe rozstrzyganie + guard w fulfilmencie (PR #124). Zostaje wydmuszka `checkout_settings`.]                                                                                                                                               |
| 12  | Monetyzacja — kupony/darowizny/reklamy          |       6,9       |  6,8  |  **7,3**  |    ↑     | Kupony naprawione i przetestowane. [01.08: `/admin/donations` **wycięte** — nawigacja jawnym linkiem zewnętrznym do zbiórki (PR #115); sprzedaż reklam przekształcona w subskrypcję **„Partner Biznesowy"** (2 tyg./mies./kwartał) zgodną z AUP Paddle.]                                                                                                              |
| 13  | Profil / konto / RODO                           |       8,0       |  7,5  |  **7,8**  |    ~     | MFA/RODO realne. [01.08: furtka Big Five do CRM **zamknięta** (odczyt service-role usunięty, PR #124). Zostają: kasowanie faktur z kontem (CASCADE), 3 niespójne ścieżki logowania.]                                                                                                                                                                                  |
| 14  | Analityka / BI                                  |       8,7       |  7,5  |  **7,5**  |    ↓     | GA4 Data API i warstwa semantyczna realne, ale Overview to flagi env udające insighty, GSC „zbiera dane" bez pingu, zero bot-filteringu, 6/7 zakładek omija słownik. [01.08: bez zmian.]                                                                                                                                                                              |
| 15  | CRM                                             |       8,1       |  8,0  |  **8,0**  |    ~     | Scoring z 10 triggerami, cron follow-upów, dedup importu — realne; minus `funnelStats` pętlą po całej tabeli i 1 sztywny partner (Merydian). [01.08: bez zmian poza wycięciem Big Five (↑ prywatność).]                                                                                                                                                               |
| 16  | Społeczność                                     |       7,6       |  7,5  |  **7,5**  |    ~     | Ankiety/Q&A/reputacja realne, ale **katalog odznak wywala się na CHECK** (3 z 6 kluczy nielegalne w DB) i brak auto-przyznawania. [01.08: bez zmian.]                                                                                                                                                                                                                 |
| 17  | Typy specjalne (tracker/programy/eksperci/quiz) |       7,5       |  6,5  |  **7,0**  |   ↓→↑    | Było: tracker bez SSR/alertów, 2 tabele programów, quiz-iframe. [01.08: tracker z loaderem SSR (PR #117), archiwum autora z paginacją serwerową (PR #122), inline edytor layoutów ekspertów (PR #120). Zostają: „alerty trackera" sprzedawane w cenniku bez implementacji, duplikat tabel programów; quiz — patrz korekta w §4.10.]                                   |
| 18  | Ustawienia / multi-tenant / bezpieczeństwo      | 8,5 (arch. 8,2) |  7,8  |  **8,2**  |    ~     | Było: 4 anonimowe kanały INSERT otwarte ~30 dni, znalezione skanem, nie gate'em. [01.08: klasa domknięta **statycznym gate'em CI** `check:sql-anon-insert` (self-test nie-pustości, 6 tabel intake) — proces przestał być czysto reaktywny. Zostaje spoofowalny `x-tenant-host`.]                                                                                     |
| 19  | Platforma / backend / szyna zdarzeń             |       8,7       |  8,0  |  **8,3**  |    ~     | Szyna domenowa i idempotencja realne. [01.08: harmonogram zadań tła z heartbeatem, logiem przebiegów i panelem zdrowia (`job_scheduler_health`), jeden dren poczty; footgun `x-tenant-host` wciąż spoofowalny.]                                                                                                                                                       |
| 20  | Lejek / pricing / UX konwersji                  |    (UX 5,9)     |  6,5  |  **6,8**  |    ↑     | `/pricing` z matrycą porównania + FAQ. [01.08: licznik „N darmowych artykułów/mies." w warstwie treści z kluczami okresu rozliczeniowego (PR #119) — realny mechanizm konwersji; checkout nadal wybija do `/profile/billing` po dane.]                                                                                                                                |

---

## 4. Ustalenia krytyczne i wysokiej wagi (z dowodami)

### 4.1 [KRYTYCZNE, NOWE] Monetyzacja: brak izolacji sandbox/live w ścieżce jednorazowej

Klient dyktuje `environment` (`src/lib/billing/checkout.functions.ts:35`, enum Zod), webhook bierze
`?env=` z URL (`src/routes/api/public/payments/webhook.ts:13`), a `fulfilOneTimeTransaction`
(`webhookDispatch.server.ts:337-345` → `oneTimeFulfilment.server.ts:109-161`) nadaje uprawnienie
**bez sprawdzenia środowiska**. `payment_orders` nie ma nawet kolumny `environment`, a pole
`environment` w `paddleEffects.server.ts:18` nie jest **nigdzie czytane**. Jeśli produkcja ma
ustawiony `PADDLE_SANDBOX_API_KEY` i sandboxowy webhook, **zakup kartą testową w sandboxie
odblokowuje realną treść premium**. Ścieżka subskrypcyjna jest odporna (`subscriptions.environment` +
`.eq("environment", env)` w `webhookDispatch.server.ts:87-105`) — one-time nie.

**STATUS 01.08: ✅ naprawione (PR #124), zweryfikowane na kodzie.** Obrona dwuwarstwowa jak w
subskrypcjach: kolumna `payment_orders.environment NOT NULL DEFAULT 'live'` + backfill (migracja
`20260731220000`); `resolveEnvironment()` w produkcji zwraca **zawsze `'live'`**, ignorując wartość
klienta (`paddleTransaction.server.ts:134-138`); `fulfilOrder()` czyta `environment` zamówienia i
**pomija realizację przy niezgodności** ze środowiskiem webhooka (`oneTimeFulfilment.server.ts:120-146`);
test regresji env-mismatch w `oneTimeFulfilment.event.test.ts`. Szczegóły: `WDROZENIE_P0_P1_AUDYT_2026-07-31.md` §1.

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

**STATUS 01.08: ✅ naprawione podwójnie (PR #112 + #116), zweryfikowane na kodzie.**
(1) Ścieżka bazowa: `cron.schedule('community-cron', '2-59/5 * * * *', 'SELECT public.invoke_community_cron()')`
przez pg_net, z telemetrią `community_last_tick_*` (migracja `20260731210000_community_cron_db_schedule.sql`).
(2) Siatka bezpieczeństwa w repo: `.github/workflows/scheduler.yml` (co 5 min + dobowy billing-cron)
→ `scripts/scheduler-tick.mjs` → `/api/public/community-cron`; pierwszy tick **sam uzbraja** ścieżkę
bazową (`arm_job_runner` przekazuje bazie publiczny origin). Kontrakt pilnowany pgTAP
(`community_cron_schedule_test.sql`), operacyjnie opisany w `RUNBOOK_COMMUNITY.md`.

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

**STATUS 01.08: ✅ naprawione (PR #118), zweryfikowane na kodzie.** Migracja
`20260731213000_restore_get_chat_peers_tenant_hardening.sql` przywraca filtr
`p.tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())` **nad obiema gałęziami**
(discoverable ORAZ wspólna konwersacja), ponawia REVOKE i wpisuje ostrzeżenie o regresji do `COMMENT`
funkcji. Doszedł samodzielny kontrakt pgTAP `get_chat_peers_contract_test.sql` (178 linii). Hipoteza
o nieodpalającym się pgTAP **potwierdziła się dosłownie i została usunięta**: rezolucja
`supabase/setup-cli@latest` padała na rate-limicie (run PR #118), a fixture'y — na własności triggerów
`auth.users` (`42501`); `ci.yml` ma teraz pin `2.111.0` i krok właścicielski (por. §1, wiersz „Bramki CI").

### 4.4 [WYSOKA] Newsletter: dwie rozłączne listy wykluczeń, dren kolejki tx nie istnieje w repo

Kampanie i double-opt-in pytają `email_suppression` (RPC `suppression.server.ts:88`), a maile
**transakcyjne pytają inną tabelę** `suppressed_emails` (`transactional.server.ts:101`). Webhook
Resend zapisuje wyłącznie do tej pierwszej (`webhooks.resend.ts:342`) → **twardy bounce/skarga nie
blokuje maili transakcyjnych ani digestów**. Gorzej: `transactional.server.ts:105` bramkuje
suppression warunkiem `input.type === "newsletter_confirmed"` — czyli **dla 1 z 19 typów** maila;
dunning, portal, renewal, event_registered lecą na martwe adresy. Do tego `sendTxEmail`/`enqueueRawEmail`
wrzucają do pgmq `transactional_emails`, ale **żadna migracja nie planuje drenu** — jest tylko komentarz
o zewnętrznym narzędziu (`20260728154925...:283-303`), a jedyny drener w repo
(`src/routes/platform/email/queue/process.ts`) **nie jest nigdzie wołany**. Faktyczna wysyłka
RSVP/dunning/digest jest **nieweryfikowalna z kodu**.

**STATUS 01.08: ✅ naprawione (PR #111), zweryfikowane na kodzie.** Migracja
`20260731120000_email_suppression_unification.sql`: **jedna kanoniczna lista** (`email_suppressions`),
a `suppressed_emails` zdegradowana do **widoku zgodności** (security invoker + `INSTEAD OF` →
`email_record_suppression`) — żadna przyszła ścieżka nie odtworzy drugiej listy; rozwiązywanie tenanta
dla adresu bez kontekstu żądania (service-role). `transactional.server.ts` bramkuje teraz **każdy z 19
typów** macierzą powód×kategoria (`suppressionPolicy`), a pominięcie zostawia ślad w `email_send_log`
(status `suppressed`). Dren kolejki **istnieje i jest wpięty**: `queueDrain.server.ts` ←
`jobsTick.server.ts`. Kontrakt pgTAP: `email_suppression_unification_test.sql` (265 linii).

### 4.5 [WYSOKA] Newsletter: runner domyślnie martwy

`job_runner_settings.enabled DEFAULT false`, `base_url DEFAULT ''` (`20260713170000...:42,45`) — pg_cron
puka w `invoke_jobs_tick` co minutę, ale ten no-opuje, dopóki admin nie włączy runnera w **ukrytej
zakładce** (`newsletter-admin.functions.ts:146-156`). Reklamowane „zaplanuj kampanię" jest więc
**wyłączone u każdego, kto nie kliknął w tę zakładkę** — bez alarmu/health-checku.

**STATUS 01.08: ✅ naprawione (PR #111/#112), zweryfikowane na kodzie.** Migracja
`20260731110000_job_scheduler_selfarming_heartbeat.sql`: **samozbrojenie** — dziewiczy wiersz
konfiguracji sam ustawia `base_url` z domeny domyślnego tenanta i włącza runner (stempel
`auto_armed_at`; świadome wyłączenie przez operatora jest nienaruszalne); **heartbeat**
(`last_invoked_at` vs `last_app_run_at/last_app_ok_at/failure_streak` — rozjazd = diagnoza „cron puka,
aplikacja nie odpowiada"); append-only log `job_runner_runs`; `job_scheduler_health()` w jednym
round-tripie dla panelu i alertów. Kontrakt pgTAP: `job_scheduler_heartbeat_test.sql` (348 linii).
Dodatkowo pierwszy tick z Actions (`scheduler.yml`) też uzbraja runner (§4.2).

### 4.6 [WYSOKA/RODO] Profil: furtka Big Five do CRM przez service-role

Migracja `20260711120000...:645-663` **celowo** zamknęła `personality_results` nawet adminom tenanta
(„wyniki psychometryczne nie są publiczne ani dla adminów"). Ale `src/lib/crm.functions.ts:477-482`
czyta tę tabelę **klientem service-role** (omijając RLS) i wystawia wynik staffowi CRM
(`ProfileSyncCard.tsx`) — bez zgody i bez celu przetwarzania. Wynik testu osobowości nadal **nie
zasila rekomendacji** (`get_recommended_posts_v2` nie zna Big Five). Do tego usunięcie konta
(`account.functions.ts`) kasuje twardo przez 71 FK `ON DELETE CASCADE`, w tym `payment_orders` —
czyli **niszczy dowody księgowe** (kolizja art. 74 uor / art. 17(3)(b) RODO).

**STATUS 01.08: ✅ furtka zamknięta (PR #124), zweryfikowane na kodzie** — odczyt `personality_results`
i pole `personality` usunięte z `crm.functions.ts` w całości (zero wystąpień), `Big5Panel` wycięty z
`ProfileSyncCard.tsx`; REVOKE w DB bez zmian, usunięto **aplikacyjne obejście** decyzji.
**⚠️ Druga część ustalenia OTWARTA:** kasowanie `payment_orders`/faktur twardym `ON DELETE CASCADE`
przy usuwaniu konta nie zostało zmienione (brak migracji `SET NULL`/anonimizacji) — zostaje w §7 pkt 5.

### 4.7 [WYSOKA] SSR/SEO: gate kompletności SSR potwierdza sam siebie

`documentStreamGuard.server.ts:46` dosztukowuje `FORCED_CLOSE_TAIL = "\n</body></html>"` przy każdym
wymuszonym zamknięciu strumienia, a wrapper jest aktywny też w dev (`vite.config.ts:43-44`), na którym
jedzie Playwright. `e2e/ssr-completeness.spec.ts:28-30` asertuje wyłącznie `<html` +
`endsWith("</html>")` na **4 ścieżkach** (bez posta, trackera, ekspertów, archiwum) i **zero asercji
na treść**. Skoro guard sam dopisuje domykający tag, asercja „musi domknąć `</html>`" **nie może
zafailować**, nawet dla uciętego shella. Dodatkowo `/tracker` (index) **nie ma loadera** →
`tracker.index.tsx:266` renderuje „Ładowanie" w SSR (crawler bez JS widzi pusty stan), a strona jest
w sitemapie z `priority 0.7, changefreq daily`.

**STATUS 01.08: częściowo ✅.** `/tracker` ma **defensywny loader** (pierwsza strona dossier z budżetem
czasowym, wzorzec `/blog`), `ItemList` JSON-LD z danych loadera i cache ISR (PR #117) — crawler bez JS
dostaje treść. **✗ Bez zmian:** `e2e/ssr-completeness.spec.ts` nie został przepisany (sentinel guarda
nadal potwierdza sam siebie), prerender nadal nie istnieje. Zostaje w §7 pkt 9.

### 4.8 [WYSOKA/koszt] SSR: bundle publiczny 1,47 MB gzip, prerender = 0

Progi bramki (`scripts/check-bundle-size.ts:71-73`): `MAX_PUBLIC_KB=1475`, `MAX_TOTAL_KB=2518`,
`MAX_CHUNK_KB=350` — czyli **~1,47 MB gzip JS dla publicznego czytelnika** serwisu treściowego
(5–6× ponad rozsądny budżet). Komentarz sam przyznaje 4 kolejne „re-floory", bo gate stał czerwony na
main — **progi gonią regresję**. Prerender nie istnieje (`vite.config.ts` bez `pages`/`crawlLinks`);
`src/lib/prerender.ts` to osłony Speculation Rules, nie prerender buildowy.

**STATUS 01.08: ✗ bez zmian** — progi 1475/2518/350 KB stoją. Doszła bramka **acykliczności grafu
chunków** (`check:chunks` w CI) — pilnuje poprawności inicjalizacji (martwa hydracja z 20.07), ale nie
rozmiaru. Redukcja bundla i prerender zostają w §7 pkt 9–10.

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

**STATUS 01.08: ✅ klasa błędu domknięta gate'em (PR #124), uruchomionym na tej sesji.**
`scripts/check-sql-anon-insert.ts` (271 linii, wspólny parser stanu końcowego z pozostałymi gate'ami
SQL), **blokujący w `ci.yml`**: inwariant A (żadna permisywna polityka INSERT dla `anon`/`public` z
`WITH CHECK true`) + inwariant B (6 tabel intake bez żadnej nie-DENY polityki INSERT dla ról klienta).
Self-test nie-pustości: wstrzyknięta permisywna polityka **failuje** gate. Wynik na tej sesji:
`✓ 517 polityk w stanie końcowym, 6 tabel intake chronionych`. Równolegle strona platformy dokręciła
kolejne polityki (zakres tenanta na `introduction_requests` i `user_connections`, update profili tylko
`authenticated`, drop tabeli-zaszłości) — nadal reaktywnie, ale już pod parasolem gate'u.

### 4.10 [ŚREDNIA] Wydmuszki i UI, które kłamie

- **`checkout_settings`** — panel `admin.paywall.tsx:975-1046` zapisuje 5 przełączników (auto-tax,
  tax-id, invoice-creation…), `checkout.$planId.tsx:314-322` **obiecuje je kupującemu**, a body
  transakcji Paddle (`paddleTransaction.server.ts:85-101`) **nie zawiera żadnego**. 132 linie testów
  pilnują martwego kodu. **[01.08: ✗ bez zmian** — `useCheckoutSettings` nadal zasila panel i obietnicę
  w checkout, body transakcji nadal bez tych pól.]
- **`/admin/donations`** (245 linii) — trwale pusty, nadal deklaruje „Zapisuje je webhook Stripe"
  (`admin.donations.tsx:85-92`); darowizny przeniesione na zrzutka.pl, webhook je ignoruje.
  **[01.08: ✅ naprawione przez USUNIĘCIE (PR #115)** — trasa wycięta (−1 trasa admin), pozycja
  nawigacji to jawny **link zewnętrzny** (`target="_blank"` + `rel`, glif „external", i18n PL/EN,
  5 testów atomu `SidebarExternalNavLink`); rejestr historyczny i widget CMS czytają dalej z
  `public.donations`. Szczegóły: `WDROZENIE_DAROWIZNY_LINK_ZEWNETRZNY_2026-07-31.md`.]
- **Autozapis stron** — `admin.pages.$slug.tsx:293` twierdzi „Autozapis włączony (jak dla wpisów)",
  ale `useAutosave` **nie jest importowany**; zapis tylko ręczny. **[01.08: ✗ bez zmian, wręcz gorzej
  kosmetycznie** — komentarz rozbudowano o uzasadnienie (optimistic-lock, debounce), a hook nadal nie
  jest importowany (żyje tylko w edytorze wpisów: `usePostEditorForm.ts:218`); zapis stron pozostaje
  wyłącznie ręczny.]
- **Alerty trackera** — `capabilities.ts:50` sprzedaje „alerty trackera" jako benefit warstwy, a
  **żaden job nie czyta `eu_policy_follows`**. **[01.08: ✗ bez zmian** — `billing/capabilities.ts:50-51`
  nadal obiecuje alerty; `eu_policy_follows` czytają tylko UI follow/unfollow i eksport RODO.]
- **Quiz** — ~~`quiz.tsx:264` to `<iframe>` do zewnętrznej domeny; wydmuszka.~~ **KOREKTA 2026-07-31:**
  to NIE wydmuszka, tylko **celowa landing-strona promocyjna drugiej platformy NES** (EuroChallenge,
  `nes-quiz.com`) — cross-promo z brandowanym `head()`, `LazyQuizIframe`, tłem z preloadem i przyciskami
  udostępniania. Zostaje jeden realny drobiazg: `head()` ma opis/OG zahardkodowane po polsku (bez
  `activeLang`) — do zbilingwalizowania. Ocena funkcji zrewidowana 3 → 7. **[01.08: korekta stoi;
  drobiazg i18n w `head()` nadal niezrobiony.]**
- **Odznaki** — `BADGE_CATALOG` (`admin/community.ts:698-706`) oferuje 6 kluczy, DB CHECK
  (`20260713091000...:23`) dopuszcza 4; **3 z 6 pozycji w dropdownie zawsze łamią CHECK**, a legalny
  `staff` jest nienadawalny z UI. Odznak nie przyznaje żaden trigger (100% ręcznie), mimo że silnik
  reputacji liczy dokładnie te aktywności. **[01.08: ✗ bez zmian** — katalog i CHECK niezmienione.]

---

## 5. Pięć wzorców systemowych (meta-ustalenia)

To jest sedno „brutalnej szczerości" — pojedyncze bugi są objawami, wzorce są chorobą.
**[01.08]** — dopisany stan po naprawach:

1. **Konsument bez producenta.** `community-cron` (push+digest), dren `transactional_emails`,
   `autoplay_next`, alerty trackera — wielokrotnie zbudowano kolejkę/konsumenta i **nie podłączono
   wyzwalacza**. Klasa: „zbudowane w 90%, ostatni kabel niewpięty", niewidoczna w testach jednostkowych.
   **[01.08: w dużej mierze DOMKNIĘTY systemowo** — `community-cron` ma dwóch producentów (pg_cron +
   Actions), dren wpięty w `jobs-tick`, runner sam się zbroi, a heartbeat + `job_runner_runs` sprawiają,
   że „nikt nie woła" jest teraz **widoczne**, nie ciche. Zostały drobne: `autoplay_next`, alerty trackera.]
2. **Utrata polityki/guardu w churnie DROP/CREATE.** `get_chat_peers` (filtr tenanta), 4 kanały
   INSERT (`is_experiment_running`) — migracje forward-only nadpisują obiekt i **gubią wcześniejsze
   REVOKE/filtry**. Brak gate'u na regresję uprawnień. **[01.08: DOMKNIĘTY dokładnie tym, czego
   brakowało** — statyczny gate `check:sql-anon-insert` na stanie końcowym polityk (z self-testem) +
   kontrakt pgTAP przypinający filtr tenanta `get_chat_peers`; ostrzeżenie „po DROP/CREATE ponawiać
   REVOKE" wpisane w `COMMENT` funkcji.]
3. **Gate, który mierzy sam siebie.** e2e SSR asertuje sentinel dopisywany przez guard; „915 RLS"
   liczy instrukcje churnu; progi pokrycia 16–20%; lint i knip poza CI. **Bramka istnieje, ale nie
   broni.** **[01.08: POŁOWICZNIE domknięty** — pgTAP odblokowany (pin CLI + własność triggerów), lint
   wszedł do CI, parser stanu końcowego zastąpił liczenie churnu. ALE: e2e SSR nadal asertuje sentinel,
   progi pokrycia bez zmian, knip poza CI — i doszedł **nowy przypadek tej klasy**: bramka lint broni
   PR-ów, podczas gdy commity platformy idą prosto na main, więc main jest czerwony mimo bramki.]
4. **UI odłączone od backendu = obietnica wobec użytkownika.** checkout_settings, donations, autozapis,
   alerty trackera — nie „martwy kod", lecz **panel/cennik obiecujący zachowanie, którego nie ma**.
   **[01.08: donations naprawione przez USUNIĘCIE kłamstwa (jedyna uczciwa opcja); checkout_settings,
   autozapis, alerty trackera, odznaki — bez zmian.]**
5. **Rozjazd komentarz/dokumentacja ↔ kod.** „Autozapis włączony", „FTS z polską fleksją" (a jest
   `simple`), „limit 30/5min rate_limit_hit" (a jest nieatomowy COUNT), „eslint zielono", „915 RLS",
   „~75 widgetów". Dokumentacja gnije szybciej niż kod. **[01.08: wzorzec ŻYWY** — komentarz o
   autozapisie rozbudowano zamiast okablować; `ci.yml` twierdzi „wszystkie błędy ESLint naprawione",
   gdy main ma ich znów 1319; „FTS z fleksją" nadal `simple`.]

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

**Nowe od 30.07 (PR #111–#124, zweryfikowane 01.08):**

- **Harmonogram doręczeń end-to-end** — pg_cron w bazie + siatka Actions z samozbrojeniem, heartbeat,
  append-only log przebiegów i panel zdrowia w 1 RPC; „martwe po cichu" stało się obserwowalne
  (PR #112/#116, `RUNBOOK_COMMUNITY.md`).
- **Poczta na jednej liście wykluczeń** — widok zgodności zamiast drugiej tabeli, bramka 19/19 typów
  ze śladem w `email_send_log`, dren kolejki wpięty w `jobs-tick`, runner domyślnie uzbrojony (PR #111).
- **pgTAP faktycznie działa w CI** (pin CLI 2.111.0 + własność triggerów `auth.users`) i urósł o
  **5 suit kontraktowych** (+1244 linii): `get_chat_peers`, harmonogram community-cron, unifikacja
  suppression, heartbeat schedulera, paginacja materiałów eksperta.
- **Metering treści** — licznik „N darmowych artykułów/mies." w warstwie treści, klucze z granicą
  okresu rozliczeniowego (`lib/access/metering.ts` + testy; PR #119).
- **SSR-paginacja z URL** — `/blog?page=N` (PR #121) i archiwum autora przez RPC
  `get_expert_materials` (SECURITY INVOKER, deterministyczne okno, indeks częściowy; PR #122) —
  deep-linki, działające „wstecz", indeksowalne strony zamiast „load more".
- **Inline edytor layoutów ekspertów** — nadpisania per-ekspert na `/author/$slug` (PR #120).
- **„Partner Biznesowy"** — sprzedaż ekspozycji reklamowej przekształcona w subskrypcję B2B
  (2 tyg./mies./kwartał) zgodną z AUP Paddle; parytet katalogu pilnowany testem (migracje
  `20260730190000`/`191000`).
- **Strona platformy** — +2 widgety buildera (razem 89), parser wklejania z Worda, poprawki mobile,
  przekierowanie 301 do bloga oraz własne dokręcenia RLS (zakres tenanta na `introduction_requests`
  i `user_connections`).
- **CI niezależne od prywatnego rejestru** — krok przepinający `bun.lock` na publiczny npm; zastrzeżenie
  z §1 („zielono dopiero po ręcznym przepięciu locka") przestało dotyczyć CI.

---

## 7. Priorytetyzacja napraw

Status 01.08 dopisany przy każdej pozycji; szczegóły napraw w §4.

**P0 (pieniądze / bezpieczeństwo / martwe ścieżki):** — **wszystkie ✅ domknięte**

1. ✅ Izolacja sandbox/live w one-time: kolumna `environment` w `payment_orders`, filtr w
   `fulfilOrder`, `environment` wyjęty spod kontroli klienta w produkcji (§4.1; PR #124).
2. ✅ `community-cron` zaplanowany przez pg_cron+pg_net ORAZ `schedule:` w Actions z samozbrojeniem
   ścieżki bazowej (§4.2; PR #112/#116).
3. ✅ Filtr tenanta w `get_chat_peers` przywrócony; potwierdzone, że `supabase test db` **faktycznie
   nie odpalał się** w CI (rate-limit CLI + własność triggerów) i oba powody usunięto (§4.3; PR #118).
4. ✅ Suppression zunifikowane (jedna tabela + widok zgodności), `sendTxEmail` przez bramkę dla
   **wszystkich** typów, dren `transactional_emails` wpięty w `jobs-tick` (§4.4; PR #111).

**P1 (RODO / integralność danych):** 5. ✅/✗ **połowicznie:** furtka Big Five w CRM zamknięta (✅, PR #124); zdjęcie `ON DELETE CASCADE`
z `payment_orders`/`user_purchases` na rzecz `SET NULL` + anonimizacji — **NADAL OTWARTE** (§4.6). 6. ✅ 4 kanały INSERT domknięte **gate'em CI** (`check:sql-anon-insert`, 2 inwarianty na stanie
końcowym + self-test), nie jednorazowym lockdownem (§4.9; PR #124).

**P2 (jakość / prawda w UI):** 7. częściowo: ✅ `/admin/donations` usunięte z uczciwym linkiem zewnętrznym (PR #115); ✗ checkout_settings,
✗ autozapis stron, ✗ alerty trackera; quiz — została tylko bilingwalizacja `head()` (§4.10). 8. ✗ Odznaki (katalog vs CHECK) i duplikat tabel programów (`programs` + `research_programs`) — bez zmian. 9. częściowo: ✅ lint w CI; ✅ loader `/tracker`; ✗ knip poza CI; ✗ `e2e/ssr-completeness` nadal na
sentinelu guarda (asercje treściowe niezrobione). 10. ✅→✗ `bun run format` wykonany i lint-gate wpięty — ale **dryf wrócił**: commity platformy prosto na
main znów zostawiły 1446 problemów. Realne domknięcie wymaga wymuszenia formatu na ścieżce platformy
(ochrona gałęzi main / format przy imporcie), nie kolejnego jednorazowego sprzątania.

**Pozostała lista po 01.08 (zaktualizowane P2/P3):** okablować albo wyciąć `checkout_settings`;
autozapis stron (albo poprawić kłamiący komentarz); job alertów po `eu_policy_follows` albo usunięcie
obietnicy z cennika; unifikacja katalogu odznak z CHECK + auto-przyznawanie; rozstrzygnięcie duplikatu
tabel programów; przepisanie e2e SSR na asercje treściowe (guard wyłączony w teście); knip do CI;
redukcja bundla publicznego (1,47 MB) i prerender; import WP niszczący drugi język; `SET NULL` +
anonimizacja zamiast CASCADE na dowodach księgowych; naprawa `react-hooks/rules-of-hooks` w
`preview.$token.tsx:74`; egzekucja prettiera na commitach platformy; dwujęzyczny `head()` quizu.

---

## 8. Zastrzeżenia metodyczne

- **Audyt statyczny.** Nie odpalałem realnej instancji Supabase ani produkcyjnego dostawcy płatności —
  ustalenia o „martwych ścieżkach" (community-cron, dren tx) są dowodzone **brakiem w repo** (brak
  schedulera, brak wołającego), co jest silnym, ale nie absolutnym dowodem: zewnętrzny cron
  skonfigurowany poza repo mógłby je ożywić. To wprost odnotowuję przy każdym takim ustaleniu.
  _(01.08: nieaktualne dla community-cron/drenu — producenci są teraz w repo i mają telemetrię.)_
- **pgTAP nieuruchomiony.** Twierdzenie „test `chat_privacy_isolation` jest czerwony" jest wyprowadzone
  z lektury definicji funkcji + seedu testu (zweryfikowane), nie z uruchomienia `supabase test db`
  (brak lokalnej bazy). Kierunek konkluzji jest jednak jednoznaczny. _(01.08: konkluzja potwierdzona —
  pgTAP w CI realnie nie dobiegał do testów z powodów infrastrukturalnych; po pinie CLI i kroku
  właścicielskim suita — w tym nowe kontrakty — przechodzi w CI. Lokalnie nadal nie uruchamiam bazy.)_
- **Oceny są kompozytem** (kompletność + inżynieria + dopracowanie + bezpieczeństwo + testy), spójnym
  ze skalą z `OCENA_FUNKCJI_2026-07-24.md`, żeby rewizje były porównywalne 1:1. Kolumna 01.08 w §3
  używa tej samej skali.
- Historia git spłaszczona — na 01.08 to 4 dni / 443 commity; strona platformy nadal wypycha „Changes"
  prosto na main, co ogranicza archeologię i omija bramki PR.
- **Rewizja 01.08** wykonana tą samą metodą statyczną na HEAD `657da6e`: `vitest`/`tsc`/`eslint`/`knip`
  oraz gate `check:sql-anon-insert` uruchomione lokalnie (wyniki w §1), każdy STATUS w §4 zweryfikowany
  bezpośrednio na kodzie i migracjach, nie na deklaracjach z dokumentów `WDROZENIE_*`.

---

_Dokument rewiduje założenia serii `OCENA_*`/`AUDYT_*`. Werdykt: platforma jest realna i miejscami
nieprzeciętna, ale deklarowane 8,0 maskowało wzorzec cichych martwych ścieżek, reaktywnego
bezpieczeństwa i płytkich bramek. Uczciwa liczba na 30.07 to **7,0/10**. Po domknięciu wszystkich P0
i P1 (poza CASCADE faktur) oraz odblokowaniu pgTAP uczciwa liczba na 01.08 to **7,5/10** — do ~8,0
brakuje domknięcia P2 (wydmuszki UI, e2e SSR, knip/bundle, import WP) i zatrzymania dryfu
formatowania na main._
