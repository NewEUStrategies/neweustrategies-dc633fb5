# Runbook: niedostępność wykonawcy technicznego

Procedura operacyjna na dzień, w którym wykonawca techniczny przestał odpowiadać. To lista
kroków do wykonania po kolei, nie opracowanie analityczne: każdy krok ma komendę, adres
panelu albo zapytanie SQL. Uzupełnia `governance/ownership.json` (kto za co odpowiada),
`docs/RUNBOOK_COMMUNITY.md` (operacje doręczeń) i `docs/ARCHITECTURE.md` (architektura).

**CZEGO NIE OBEJMUJE.** Nie jest dokumentem prawnym - zobowiązania operacyjne i klasy SLA
opisuje `docs/UMOWA_UTRZYMANIOWA.md`, a warunki handlowe, kary i wypowiedzenie są poza
oboma dokumentami (§10, luka L-1). Nie opisuje operacji dnia codziennego (kolejka push,
digesty, przypomnienia) - to `docs/RUNBOOK_COMMUNITY.md`. Nie zawiera oszacowań czasu prac
w godzinach: repo nie daje danych, na których taki szacunek mógłby się oprzeć (historia
gita jest spłaszczona - §8.2), więc prace są opisane trudnością, nie czasem.

**STAN OBSADZENIA 2026-08-29.** Wykonawca w rejestrze: `NIEOBSADZONE`
(`kontraktUtrzymaniowy.wykonawca`); wszystkie 9 domen ma `wlasciciel` i `zastepca` =
`NIEOBSADZONY`. W repo NIE MA ani jednego indywidualnego uchwytu GitHub ani osobowego
adresu e-mail - jedyne realne adresy to `office@neweuropeanstrategies.com` (autor commitów)
i `marketing@neweuropeanstrategies.com` (`.env.example:90`). Każde **DO UZUPEŁNIENIA**
wypełnia **Zamawiający (New European Strategies, `office@neweuropeanstrategies.com`)** -
nikt inny nie ma do tego mandatu.

## 1. Kiedy uruchomić ten runbook

Progi są mierzalne i wynikają wprost z klas SLA zapisanych w
`governance/ownership.json` → `kontraktUtrzymaniowy.klasySla`. Uruchomienie runbooka NIE
jest decyzją uznaniową: wystarczy JEDEN spełniony warunek z tabeli.

### 1.1 Klasy SLA (cytat z rejestru)

| Klasa   | Nazwa       | Reakcja | Obejście | Naprawa | Okno             |
| ------- | ----------- | ------- | -------- | ------- | ---------------- |
| `sla-1` | Krytyczna   | 60 min  | 4 h      | 24 h    | 24/7             |
| `sla-2` | Wysoka      | 240 min | 24 h     | 72 h    | dni robocze 9-17 |
| `sla-3` | Standardowa | 480 min | 72 h     | 240 h   | dni robocze 9-17 |

Przypisanie domen: `sla-2` → `crm-i-marketing`; `sla-3` → `kariera-i-programy`; pozostałe
7 domen (`spolecznosc-i-kluby`, `wydarzenia`, `monetyzacja-i-platnosci`,
`tresc-i-edytory`, `zgodnosc-i-prywatnosc`, `tozsamosc-i-uprawnienia`, `platforma-i-baza`)
→ `sla-1`.

### 1.2 Progi wyzwalające

| #       | Zdarzenie                                                                                  | Próg mierzalny                                                    | Dowód do zebrania                           |
| ------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------- |
| W1      | Brak reakcji na zgłoszenie P1 w domenie `sla-1`                                            | > 180 min od zgłoszenia (3× umowna reakcja 60 min)                | znacznik czasu zgłoszenia + brak odpowiedzi |
| W2      | Brak reakcji na zgłoszenie P1 w domenie `sla-2`                                            | > 720 min (3× 240 min)                                            | jw.                                         |
| W3      | Dwa kolejne zgłoszenia dowolnego priorytetu bez odpowiedzi                                 | 2 zgłoszenia, każde po przekroczeniu umownej reakcji swojej klasy | dwa znaczniki czasu                         |
| W4      | Przekroczony termin naprawy incydentu krytycznego                                          | > 48 h przy `sla-1` (2× 24 h) bez obejścia                        | log incydentu                               |
| W5 / W6 | Jednostronne zerwanie współpracy, upadłość, likwidacja lub utrata zdolności do świadczenia | oświadczenie wykonawcy w dowolnej formie albo wpis w rejestrze    | pisemne oświadczenie / odpis rejestrowy     |

| W7 | Zbliżający się koniec umowy bez następcy | `obowiazujeDo` = **2027-08-31** minus `ostrzegajOdDni` = **60**, czyli **2027-07-02** | data systemowa |
| W8 | Cicha awaria automatyki bez reakcji | brak wiersza `pg_cron` w `job_runner_runs` przez > 24 h I brak odpowiedzi wykonawcy | zapytanie SQL z §5.3 |

**W7 JEST TERMINEM TWARDYM.** Po 2027-07-02 brak wskazanego następcy oznacza wejście w
scenariusz niedostępności planowanej - kroki §2-§4 wykonuje się wtedy spokojnie, a nie
awaryjnie, ale wykonuje się je tak samo.

### 1.3 Kto podejmuje decyzję

| Rola                                | Kto                                        | Kontakt                            |
| ----------------------------------- | ------------------------------------------ | ---------------------------------- |
| Decyzja o uruchomieniu runbooka     | Zamawiający - New European Strategies      | `office@neweuropeanstrategies.com` |
| Prowadzenie procedury (koordynator) | **DO UZUPEŁNIENIA** - wskazuje Zamawiający | **DO UZUPEŁNIENIA**                |
| Wykonanie prac technicznych         | **DO UZUPEŁNIENIA** - wykonawca zastępczy  | **DO UZUPEŁNIENIA**                |

## 2. Pierwsze 24 godziny - checklista

Kolejność kroków jest częścią procedury. Krok 2.1 wykonuje się PRZED wszystkim innym,
bo utrata roli właściciela w którymkolwiek panelu jest nieodwracalna bez wsparcia
dostawcy.

### 2.1 Godzina 0-2: zabezpiecz role właścicielskie (NIE ZWLEKAĆ)

- [ ] **GitHub, organizacja `NewEUStrategies`** (Settings → People): min. dwa konta
      Zamawiającego z rolą `Owner`. **NIE PRZENOSIĆ REPO DO INNEJ ORGANIZACJI** - warunek
      `github.repository_owner == 'NewEUStrategies'` (`scheduler.yml:72`,
      `billing-nightly.yml:51`) zatrzyma oba harmonogramy BEZ ŻADNEGO BŁĘDU.
- [ ] **Supabase, projekt `unnltowbgszpdzwpawdu`** (`supabase/config.toml:1`): rola `Owner`
      u Zamawiającego; Settings → General → Transfer project - sprawdź, czyja to organizacja.
- [ ] **Lovable** - workspace i projekt (`.lovable/project.json`). To panel, w którym leżą
      sekrety produkcyjne (`ci.yml:477-478`: _"real values come from project secrets in
      deploy environments"_).
- [ ] **Cloudflare** - strefa `neweuropeanstrategies.com` i Workers; runtime aplikacji
      (`vite.config.ts:66-76`, `preset: "cloudflare-module"`).
- [ ] **Rejestrator domeny** - dostęp, blokada transferu, kontakt administracyjny u Zamawiającego.
- [ ] **Stripe**, **Resend**, **Google**, **ElevenLabs**, **WordPress.com** - tabela §3.6.
- [ ] Konta wykonawcy usuwaj DOPIERO po potwierdzeniu własnego dostępu z drugiej przeglądarki.

### 2.2 Godzina 0-4: zamroź zmiany

- [ ] GitHub → Settings → Branches: ochrona `main` (wymagaj PR i CI, blokuj `force push`).
      Dziś w `.github/` NIE MA `CODEOWNERS`, `dependabot.yml` ani szablonu PR - tylko 5 workflow.
- [ ] Odwołaj tokeny i deploy keys wykonawcy (Settings → Deploy keys, → Integrations).
- [ ] Zamroź merge do `main` do końca §4. **NIE ROTOWAĆ jeszcze żadnego sekretu** -
      złamanie kolejności z §4 wywraca działający system.

### 2.3 Godzina 0-6: sprawdź, czy platforma żyje

```bash
# 1. Czy serwis w ogóle odpowiada
curl -sS -o /dev/null -w '%{http_code}\n' https://neweuropeanstrategies.com/

# 2. Sonda zdrowia harmonogramu - 200 = OK, 503 = ZASTÓJ
#    (endpoint: src/routes/api/public/community-cron.ts)
curl -i "https://neweuropeanstrategies.com/api/public/community-cron" \
  -H "x-community-cron-secret: $COMMUNITY_CRON_SECRET"

# 3. Ręczny tick, jeśli sonda oddała 503
curl -X POST "https://neweuropeanstrategies.com/api/public/community-cron?job=all" \
  -H "x-community-cron-secret: $COMMUNITY_CRON_SECRET"
```

- [ ] Panel **`/admin/community/notifications`** (RPC `job_scheduler_health()`, rola
      admin/edytor): świeżość ostatniego przebiegu (`fresh` ≤ 6 min, `lagging` ≤ 20 min,
      dalej `stale`), rejestr zadań pg_cron, głębokość kolejki push, brakujące zmienne env.
- [ ] Przycisk **„Uruchom tick teraz"** (`src/components/admin/community/SchedulerHealthPanel.tsx:12`) - woła TĘ SAMĄ funkcję co cron (`runJobsTick`). Dostępny też z `/admin/tracker`.
- [ ] GitHub → Actions: czy `scheduler.yml` (co 5 min) i `billing-nightly.yml` biegną.
      **GitHub wyłącza zaplanowane workflow po 60 dniach bez aktywności w repo**
      (`scheduler.yml:25-27`) - w przestoju gaśnie to po cichu.
- [ ] Supabase → Database → Extensions: `pg_cron` i `pg_net` włączone. Bez nich ścieżka
      podstawowa doręczeń nie istnieje.

### 2.4 Godzina 6-24: zbierz dowody i uruchom bramki

```bash
git clone https://github.com/NewEUStrategies/neweustrategies-dc633fb5.git
cd neweustrategies-dc633fb5

# KROK OBOWIĄZKOWY - bez niego `bun install` NIE PRZEJDZIE (patrz §6.1)
sed -E -i 's#https://europe-west[0-9]+-npm\.pkg\.dev/lovable-core-prod/sandbox-npm-cache/#https://registry.npmjs.org/#g' bun.lock

bun install
bun run check:ownership        # rejestr własnicielstwa - 100% pokrycia obu powierzchni
bun run check:workflow-env-contract   # czy każda zmienna z workflow ma odbiorcę w kodzie
bun run verify:blocking        # verify:static + typecheck + lint + test
```

- [ ] Lustrzana kopia repo poza GitHubem (`git clone --mirror`), przechowana u Zamawiającego.
- [ ] Eksport nazw (nie wartości) sekretów i zmiennych Actions. Oczekiwane: **7 sekretów,
      4 zmienne** (§3.1, §3.2).
- [ ] Supabase → Settings → Database → Backups: **udokumentuj, czy PITR jest włączony i
      z jakim oknem**. W repo NIE MA procedury backupu - 0 trafień `pg_dump`, `pg_restore`
      i `supabase db dump` w całym drzewie. To luka L-3 z §10.

## 3. Inwentarz dostępów do przejęcia

### 3.1 Sekrety GitHub Actions - 7 nazw

Miejsce: **Settings → Secrets and variables → Actions → Repository secrets**.

| Sekret                          | Gdzie użyty                                                       | Kto musi mieć dostęp                              | Co się stanie, gdy zabraknie                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SUPABASE_URL`                  | `ci.yml:481` (build), `ci.yml:746` i `ci.yml:758` (`post-deploy`) | Zamawiający + wykonawca zastępczy                 | W jobie `verify` jest fallback na placeholder. W `post-deploy` **BEZ FALLBACKU** - bramki `check:db-contract` i `check:migration-ledger` przestają weryfikować cokolwiek |
| `SUPABASE_PUBLISHABLE_KEY`      | `ci.yml:482`, `ci.yml:747`, `ci.yml:759`                          | jw.                                               | jw.                                                                                                                                                                      |
| `VITE_SUPABASE_URL`             | `ci.yml:479`, `e2e.yml:51-54`, `lighthouse.yml:176-179`           | jw.                                               | Build CI schodzi na `https://placeholder.supabase.co` - przechodzi na zielono, nie testując niczego realnego                                                             |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | jw.                                                               | jw.                                               | jw. (`placeholder-anon-key`)                                                                                                                                             |
| `STRIPE_SANDBOX_API_KEY`        | `billing-nightly.yml:58`                                          | Zamawiający + osoba odpowiedzialna za rozliczenia | Nocna sonda odnowienia i dunningu nie wykonuje ŻADNEGO żądania                                                                                                           |
| `LOVABLE_API_KEY`               | `billing-nightly.yml:59`                                          | Zamawiający                                       | Sonda rozliczeń nie autoryzuje gatewaya Stripe                                                                                                                           |
| `COMMUNITY_CRON_SECRET`         | `scheduler.yml:84`, `:123`, `:140`                                | Zamawiający + dyżur operacyjny                    | Workflow kończy się **ZIELONO z ostrzeżeniem** i nic nie wysyła (`scheduler.yml:22-23`)                                                                                  |

### 3.2 Zmienne GitHub Actions - 4 nazwy

| Zmienna                  | Gdzie                          | Znaczenie                                                                                               |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `APP_BASE_URL`           | `scheduler.yml:83,122,139,164` | Adres aplikacji, np. `https://neweuropeanstrategies.com`. Bez niej scheduler nie ma dokąd pukać         |
| `BILLING_PROBE_DISABLED` | `billing-nightly.yml:50`       | `'1'` wyłącza sondę rozliczeń. Wyłącznik jest JAWNY celowo                                              |
| `LHCI_URL`               | `lighthouse.yml:53-173`        | Pusty ⇒ MODE B (niebłokujący smoke). Ustawiony ⇒ MODE A: audyt realnego wdrożenia i bramkowanie merge'y |
| `LHCI_EXTRA_PATHS`       | `lighthouse.yml:58`            | Dodatkowe ścieżki audytu, rozdzielane przecinkami                                                       |

### 3.3 Zmienne środowiskowe produkcyjne wg dostawcy

Źródło: `.env.example` (200 linii, 21 aktywnych + 21 zakomentowanych). Reguła z nagłówka
pliku (l. 5-7): **tylko wartości z prefiksem `VITE_` trafiają do bundla przeglądarki -
NIGDY nie dodawać `VITE_` do sekretu.**

| Dostawca        | Zmienna                                                                                                                                                                                   | Linia   | Typ                    | Skutek braku                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase        | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` (13-15) oraz mirrory serwerowe `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_ID` (19-21) | 13-21   | publiczne              | Klient nie łączy się z bazą - aplikacja martwa. Część handlerów SSR czyta mirrory zamiast `VITE_`                                                                                        |
| Supabase        | `SUPABASE_SERVICE_ROLE_KEY`                                                                                                                                                               | 29      | **SEKRET**             | Omija RLS; używany przez `*.server.ts`. Brak = padają wszystkie operacje serwisowe                                                                                                       |
| Supabase        | `DATABASE_URL`                                                                                                                                                                            | 32      | **SEKRET**             | Zawiera hasło do Postgresa                                                                                                                                                               |
| Stripe          | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                                                                                                                              | 35-36   | **SEKRET**             | Brak checkoutu i obsługi webhooków                                                                                                                                                       |
| Stripe          | `STRIPE_SANDBOX_API_KEY`, `STRIPE_LIVE_API_KEY`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET`, `PAYMENTS_LIVE_WEBHOOK_SECRET`, `VITE_PAYMENTS_CLIENT_TOKEN`                                          | 156-160 | **SEKRET** / publiczna | **NAZWY MUSZĄ SIĘ ZGADZAĆ CO DO ZNAKU** z `src/lib/stripe.server.ts` (`.env.example:146-149`)                                                                                            |
| Lovable         | `LOVABLE_API_KEY`                                                                                                                                                                         | 43      | **SEKRET**             | Najczęściej używana zmienna w repo (45 odczytów `process.env`). Patrz §5.4                                                                                                               |
| Resend          | `RESEND_API_KEY`                                                                                                                                                                          | 52      | **SEKRET**             | CAŁA poczta wychodząca spada na zapasowego dostawcę, który NIE zwraca identyfikatora wiadomości                                                                                          |
| Resend          | `RESEND_WEBHOOK_SECRET`                                                                                                                                                                   | 65      | **SEKRET**             | `POST /api/public/webhooks/resend` zwraca 503, lista wykluczeń nie rośnie, wskaźnik spamu może po cichu przekroczyć próg 0,30% z wytycznych Google - **ryzyko reputacyjne CAŁEJ domeny** |
| Web Push        | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `VITE_VAPID_PUBLIC_KEY`                                                                                                         | 88-91   | sekret + publiczne     | Odczyt: `src/lib/notifications/webpush.server.ts:455-458`. Brak = `processPushJobs` zwraca `skipped: "vapid_not_configured"`                                                             |
| Harmonogram     | `COMMUNITY_CRON_SECRET`                                                                                                                                                                   | 105     | **SEKRET**             | Alternatywa: `job_runner_settings.secret` w bazie - endpoint przyjmuje oba                                                                                                               |
| ElevenLabs      | `ELEVENLABS_API_KEY`                                                                                                                                                                      | 39      | **SEKRET**             | Martwa trasa `/api/tts`                                                                                                                                                                  |
| WordPress.com   | `WORDPRESS_COM_API_KEY`                                                                                                                                                                   | 83      | **SEKRET**             | Brak importu treści                                                                                                                                                                      |
| Adres publiczny | `PUBLIC_SITE_URL` (fallbacki `SITE_URL`, `URL`)                                                                                                                                           | 112-114 | publiczna              | Względne linki w checkoucie i mailach                                                                                                                                                    |
| Tenant          | `TENANT_HOST_ASSERTION_KEY` / `_KID`                                                                                                                                                      | 179-180 | **SEKRET** / publiczna | Ten sam sekret musi trafić do Vaulta: `select public.set_tenant_host_assertion_key('edge1', '<sekret>')`. BEZ KLUCZA degradacja jest w stronę BEZPIECZNĄ                                 |
| Runtime SSR     | `NES_EDGE_CACHE`, `SSR_DOC_GUARD*`, `SSR_DB_DEADLINE_MS`                                                                                                                                  | 122-139 | przełączniki           | Kill switche cache'u i guardów SSR                                                                                                                                                       |

### 3.4 PUŁAPKI: 14 zmiennych używanych w kodzie, których NIE MA w `.env.example`

Środowisko postawione „z przykładu" **uruchomi się bez błędu** i będzie miało martwą
analitykę, osłabiony anty-bruteforce i niedziałający `billing-cron`. To najgroźniejsza
pozycja w całym inwentarzu, bo nie daje żadnego komunikatu.

| Zmienna                                                                       | Miejsce użycia                                                                         | Typ                                  | Co po cichu przestaje działać                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GA4_SERVICE_ACCOUNT_JSON`                                                    | `src/lib/analytics/ga4.server.ts:49`, `status.functions.ts:106`                        | **SEKRET**                           | Raporty GA4 Data API                                                                                                                                                        |
| `GA4_OAUTH_CLIENT_ID` / `GA4_OAUTH_CLIENT_SECRET` / `GA4_OAUTH_REFRESH_TOKEN` | `ga4.server.ts:106-108`, `status.functions.ts:123`                                     | **SEKRET** (client_id: konfiguracja) | Alternatywna ścieżka autoryzacji GA4                                                                                                                                        |
| `GA4_PROPERTY_ID` / `GA4_MEASUREMENT_ID` / `GA4_EMBED_URL`                    | `ga4.server.ts:145`, `ga4.functions.ts:115`, `status.functions.ts:134`                 | konfiguracja / publiczna             | Identyfikacja property, pomiar po stronie klienta, osadzony raport w panelu                                                                                                 |
| `GA4_EMBED_URL`                                                               | `status.functions.ts:134`                                                              | konfiguracja                         | Osadzony raport w panelu                                                                                                                                                    |
| `GOOGLE_SEARCH_CONSOLE_API_KEY`                                               | `gsc.functions.ts:46`, `status.functions.ts:103`                                       | **SEKRET**                           | Dane GSC (przez gateway Lovable)                                                                                                                                            |
| `SESSION_SECRET`                                                              | `bruteforce.functions.ts:18`, `rateSubject.server.ts:16`, `trackingToken.server.ts:28` | **SEKRET**                           | **Fallback na `SUPABASE_SERVICE_ROLE_KEY`** - anty-bruteforce i tokeny śledzenia newslettera dziedziczą klucz serwisowy. Rotacja klucza serwisowego unieważnia je wszystkie |
| `OG_REFRESH_SECRET` / `BILLING_CRON_SECRET`                                   | `hooks.refresh-og-image.ts:40`, `billing-cron.ts:32`                                   | **SEKRET**                           | Hak odświeżania obrazków OG; `billing-cron` z fallbackiem na `COMMUNITY_CRON_SECRET`                                                                                        |

| `PUBLIC_APP_URL` | `src/lib/admin/invitations.functions.ts:262` | konfiguracja | Fallback **zahardkodowany** na `https://neweuropeanstrategies.com` - zaproszenia zawsze prowadzą tam, niezależnie od środowiska |
| `AI_GATEWAY_URL` / `AI_GATEWAY_EMBEDDINGS_URL` / `AI_TRANSLATE_MODEL` / `AI_EMBEDDING_MODEL` | `aiTranslate.server.ts:10`, `embeddings.server.ts:10` | konfiguracja | Nadpisania bramki AI - jedyny punkt, przez który da się odciąć AI od Lovable bez zmiany kodu |

**ZADANIE DLA WYKONAWCY ZASTĘPCZEGO:** uzupełnić `.env.example` o powyższe pozycje
w pierwszym tygodniu. Bez tego każde kolejne odtworzenie środowiska powtórzy ten sam błąd.

### 3.5 Sekrety w Supabase Vault - NIE MA ICH W ENV ANI W GITHUBIE

W migracjach: **18 wywołań `vault.create_secret`** (w 9 plikach), 12 odczytów
`vault.decrypted_secrets`, 7 wywołań `set_tenant_host_assertion_key`. Mechanizm:
`supabase/migrations/20260714090000_integration_endpoints_secret_vault.sql`, funkcja
`integration_endpoint_set_secret/2` (`SECURITY DEFINER`, role `admin`/`super_admin`,
zob. `src/lib/authz/authzSnapshot.generated.ts:40`).

| Co leży w Vaulcie                                                    | Gdzie odczytywane                                                                                                   | Skutek utraty dostępu do projektu                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Sekrety integracji wychodzących (HubSpot, Slack, generyczny webhook) | `src/lib/integrations/formats.ts:8` - _"hubspot: upsert kontaktu przez CRM v3 batch API (Bearer = sekret z Vault)"_ | Sekrety przepadają - **nie ma ich kopii nigdzie indziej** |
| Klucz asercji hosta tenanta (`kid` = `edge1`)                        | migracja `20260805090000`                                                                                           | Degradacja bezpieczna, ale izolacja tenanta osłabiona     |
| Sekret runnera zadań (`job_runner_settings.secret`)                  | `invoke_jobs_tick()`, `invoke_community_cron()`                                                                     | Cron bazy nie autoryzuje puknięć do aplikacji             |

**Wyciągnij te sekrety ZANIM ktokolwiek dotknie ról w projekcie Supabase.** Panel:
Supabase → SQL Editor, zapytanie do `vault.decrypted_secrets` z rolą właściciela.

### 3.6 Konta u dostawców zewnętrznych

| Dostawca               | Co konkretnie                                                                                                                                                                                           | Kto musi mieć dostęp            | Skutek utraty                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| **Lovable**            | workspace + projekt, `LOVABLE_API_KEY`, konfiguracja connectorów (Resend, Stripe, WordPress.com, GSC)                                                                                                   | Zamawiający jako właściciel     | Brak buildu, brak wdrożenia, brak poczty, brak płatności, brak AI. Patrz §5.4  |
| **Supabase**           | projekt `unnltowbgszpdzwpawdu`, `service_role`, `DATABASE_URL`, PITR, Vault                                                                                                                             | Zamawiający jako `Owner`        | Utrata wszystkich danych produkcyjnych - nie są odtwarzalne z repo             |
| **Cloudflare**         | strefa `neweuropeanstrategies.com`, Workers, Wrangler                                                                                                                                                   | Zamawiający                     | Brak runtime'u aplikacji                                                       |
| **Rejestrator domeny** | `neweuropeanstrategies.com`                                                                                                                                                                             | Zamawiający                     | Utrata adresu i poczty                                                         |
| **Stripe**             | konto live + sandbox, webhooki                                                                                                                                                                          | Zamawiający + rozliczenia       | Brak przychodu i obsługi subskrypcji                                           |
| **Resend**             | domena nadawcza, DKIM/SPF/DMARC, webhook `{PUBLIC_SITE_URL}/api/public/webhooks/resend`, zdarzenia `email.sent, email.delivered, email.delivery_delayed, email.bounced, email.complained, email.failed` | Zamawiający                     | Brak poczty i utrata reputacji domeny                                          |
| **Google**             | GA4 property, Search Console, service account / OAuth                                                                                                                                                   | Zamawiający                     | Brak analityki i danych SEO                                                    |
| **ElevenLabs**         | klucz API                                                                                                                                                                                               | Zamawiający                     | Martwe TTS (`/api/tts`, `/api/public/post-tts`, cache w bucketcie `tts-cache`) |
| **WordPress.com**      | klucz API                                                                                                                                                                                               | Zamawiający                     | Brak importu treści                                                            |
| **GitHub**             | organizacja `NewEUStrategies`                                                                                                                                                                           | Zamawiający, min. 2 właścicieli | **Zmiana organizacji zatrzyma oba harmonogramy** (§2.1)                        |

## 4. Rotacja poświadczeń - KOLEJNOŚĆ JEST CZĘŚCIĄ PROCEDURY

Zasada nadrzędna: **rotujemy od zewnątrz do środka.** Najpierw poświadczenia, których
utrata nie przerywa ruchu produkcyjnego; klucze na ścieżce krytycznej na końcu, w oknie
serwisowym, z przygotowanym wycofaniem.

### 4.1 Fala 1 - bezpieczne od ręki, bez okna serwisowego

| #   | Poświadczenie                                 | Gdzie                                                | Uwaga                                       |
| --- | --------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| 1   | Konta osobowe wykonawcy w panelach            | GitHub, Supabase, Cloudflare, Stripe, Resend, Google | Usunięcie użytkownika, nie klucza           |
| 2   | Tokeny osobiste i deploy keys wykonawcy       | GitHub → Settings                                    |                                             |
| 3-4 | `ELEVENLABS_API_KEY`, `WORDPRESS_COM_API_KEY` | panele dostawców + env                               | Degradacja: martwe TTS, brak importu treści |

| 5-6 | `GA4_*`, `GOOGLE_SEARCH_CONSOLE_API_KEY`, `OG_REFRESH_SECRET` | Google Cloud + env | Degradacja: luka w danych analitycznych, martwy hak odświeżania obrazków OG |

| 7 | `LHCI_URL`, `LHCI_EXTRA_PATHS`, `APP_BASE_URL`, `BILLING_PROBE_DISABLED` | GitHub → Variables | To zmienne, nie sekrety |

### 4.2 Fala 2 - wymaga koordynacji, ale bez przerwy w ruchu

| #   | Poświadczenie               | Warunek bezpieczeństwa                                                                                                                                                                                                 |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | `COMMUNITY_CRON_SECRET`     | Zmienić **jednocześnie** w env aplikacji, w GitHub Secrets ORAZ w `job_runner_settings.secret`. Endpoint przyjmuje oba źródła, więc rozjazd nie da błędu - da ciche milczenie kolejki                                  |
| 9   | `BILLING_CRON_SECRET`       | Fallback na `COMMUNITY_CRON_SECRET` - rotować razem z pozycją 8                                                                                                                                                        |
| 10  | `RESEND_WEBHOOK_SECRET`     | Nowy sekret podpisu w panelu Resend **i** w env, w tej kolejności. Między jedną a drugą zmianą webhook zwraca 503 i zdarzenia dostarczalności przepadają bezpowrotnie - okno musi być liczone w minutach               |
| 11  | `TENANT_HOST_ASSERTION_KEY` | Nowy `kid` (np. `edge2`), wpis do Vaulta `select public.set_tenant_host_assertion_key('edge2','<sekret>')`, potem podmiana env. Stary `kid` zostawić do czasu potwierdzenia                                            |
| 12  | `SESSION_SECRET`            | **USTAWIĆ JAWNIE, jeśli dziś nie jest ustawiony.** Dziś spada na `SUPABASE_SERVICE_ROLE_KEY` - dopóki tak jest, rotacja klucza serwisowego (poz. 15) unieważni liczniki anty-bruteforce i tokeny śledzenia newslettera |

### 4.3 Fala 3 - WYMAGA OKNA SERWISOWEGO

| #   | Poświadczenie                                                                                       | Dlaczego okno                                                                                                                                                      | Co zrobić                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_LIVE_API_KEY`, `PAYMENTS_LIVE_WEBHOOK_SECRET` | Rotacja w trakcie płatności zostawia zamówienia w stanie nieokreślonym                                                                                             | Okno poza szczytem. Kolejność: nowy klucz w Stripe → env → nowy sekret webhooka → weryfikacja pojedynczą transakcją. Sandbox rotować pierwszy, jako próba                                                                                                                                                                                                                                                                                      |
| 14  | `RESEND_API_KEY`                                                                                    | Kolejka pocztowa jest ciągła                                                                                                                                       | Rotować przy pustej kolejce. Zweryfikować, że wysyłka zwraca identyfikator wiadomości - brak identyfikatora oznacza, że ruch spadł na zapasowego dostawcę                                                                                                                                                                                                                                                                                      |
| 15  | `SUPABASE_SERVICE_ROLE_KEY`                                                                         | Klucz omija RLS i obsługuje CAŁY ruch serwerowy. Dodatkowo jest domyślnym fallbackiem `SESSION_SECRET`                                                             | **NAJPIERW poz. 12**, potem okno serwisowe, potem podmiana w env aplikacji i wszędzie, gdzie jest kopiowany. Po rotacji: pełny przebieg `bun run check:db-contract`                                                                                                                                                                                                                                                                            |
| 16  | `DATABASE_URL`                                                                                      | Zmiana hasła Postgresa zrywa wszystkie otwarte połączenia                                                                                                          | Okno serwisowe, po poz. 15                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 17  | **`VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY`**                                                        | **ROTACJA VAPID UNIEWAŻNIA WSZYSTKIE ISTNIEJĄCE SUBSKRYPCJE PUSH.** Każde urządzenie musi włączyć powiadomienia ponownie ręcznie. TO NIE JEST OPERACJA BEZKOSZTOWA | Rotować **wyłącznie** przy realnym podejrzeniu ujawnienia klucza prywatnego. Nową parę generuje `generateVapidKeys()` z `src/lib/notifications/webpush.server.ts:467`. Podmienić komplet czterech zmiennych naraz (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `VITE_VAPID_PUBLIC_KEY`) - rozjazd klucza publicznego między serwerem a bundlem daje ciche 403 od usług push. Przygotować komunikat do użytkowników PRZED rotacją |
| 18  | `LOVABLE_API_KEY`                                                                                   | Patrz §5.4 - ten klucz trzyma pocztę, płatności, AI, import i GSC naraz                                                                                            | **NIE ROTOWAĆ, dopóki trwa współpraca z platformą.** Przy wyjściu z platformy klucz nie jest rotowany, tylko wygaszany razem z zależnościami (§7)                                                                                                                                                                                                                                                                                              |

**Sekrety `VITE_*` NIE SĄ SEKRETAMI** - trafiają do bundla przeglądarki. Rotacja
`VITE_SUPABASE_PUBLISHABLE_KEY` ma sens wyłącznie razem z przeglądem polityk RLS.

## 5. Tryb minimalnego działania

Cel: serwis żyje bez wykonawcy przez tygodnie. Wymaga utrzymania czterech mechanizmów.

### 5.1 Co MUSI działać

| Mechanizm                                           | Częstotliwość                      | Źródło                                             | Sekret                                                |
| --------------------------------------------------- | ---------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `pg_cron` + `pg_net` → `POST /api/public/jobs-tick` | **co minutę** - ścieżka podstawowa | migracje `20260713170000`, `20260731110000`        | `x-jobs-secret` = `job_runner_settings.secret`        |
| `pg_cron` → `POST /api/public/community-cron`       | co 5 min (minuty 2, 7, 12, …)      | migracja `20260731210000`, `invoke_community_cron` | `x-community-cron-secret`                             |
| `.github/workflows/scheduler.yml`                   | co 5 min - **siatka zewnętrzna**   | `scheduler.yml`                                    | `secrets.COMMUNITY_CRON_SECRET` + `vars.APP_BASE_URL` |
| Przycisk „Uruchom tick teraz"                       | ręcznie                            | `/admin/community/notifications`, `/admin/tracker` | sesja admin/edytor                                    |

Wszystkie cztery wejścia są idempotentne (claimy atomowe w Postgresie) i mogą działać
równolegle. W repo jest **16 zadań `pg_cron`**: `billing-cron-daily`, `billing-reminders`,
`community-cron`, `crm-task-reminders`, `event-reminders`, `jobs-tick`, `publish-due-pages`,
`publish-due-posts`, `saved-search-alerts`, `purge-expired-accounting-evidence`,
`purge-expired-payment-orders` oraz 5 zadań `prune-*`.

### 5.2 Minimalne środowisko, żeby te mechanizmy żyły

`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`PUBLIC_SITE_URL`, `COMMUNITY_CRON_SECRET`, komplet `VAPID_*`. Reszta zmiennych degraduje
funkcje, nie zatrzymuje serwisu.

### 5.3 Sonda dzienna dyżuru

```bash
curl -i "$BASE_URL/api/public/community-cron" -H "x-community-cron-secret: $COMMUNITY_CRON_SECRET"
# 200 = OK, 503 = ZASTÓJ -> otwórz /admin/community/notifications
```

```sql
-- Czy ścieżka podstawowa (pg_cron) w ogóle żyje: brak wiersza 'pg_cron' = nie żyje
SELECT source, max(created_at) AS last_at, count(*) FILTER (WHERE NOT ok) AS fails
  FROM job_runner_runs WHERE created_at > now() - interval '24 hours' GROUP BY source;

-- Rosnące 'pending' przy działającym cronie = brak VAPID w env albo tick nie dochodzi
SELECT status, count(*) FROM notification_push_queue GROUP BY status;
```

### 5.4 CO PRZESTANIE DZIAŁAĆ NATYCHMIAST PO UTRACIE `LOVABLE_API_KEY`

`LOVABLE_API_KEY` jest odczytywany **45 razy** w `src/` i `scripts/` - to najczęściej
używana zmienna w całym repo. Utrata klucza to nie degradacja jednej funkcji, tylko
jednoczesne zatrzymanie pięciu obszarów:

| Obszar                                                             | Punkt awarii                                                                                                                     | Objaw                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **CAŁA poczta wychodząca** - kampanie, transakcyjne, autoryzacyjne | `src/lib/email/provider.server.ts:21,70,120-125` (gateway `https://connector-gateway.lovable.dev/resend`)                        | Ruch spada na zapasowego dostawcę `@lovable.dev/email-js` (`provider.server.ts:178`), który też wymaga klucza. Efektywnie: zero maili |
| **Płatności**                                                      | `src/lib/stripe.server.ts:14,26` (`https://connector-gateway.lovable.dev/stripe`)                                                | Brak checkoutu i odnowień. `src/lib/billing/mockMode.server.ts:16` przełącza się w tryb mock                                          |
| **Tłumaczenia AI, embeddingi, STT**                                | `src/lib/ai-gateway.server.ts:77`, `aiTranslate.server.ts:10,95-98`, `embeddings.server.ts:10,31`, `src/routes/api/stt.ts:56-57` | Komunikat _"Tłumaczenie AI niedostępne: brak LOVABLE_API_KEY"_. Wyszukiwanie semantyczne bez nowych embeddingów                       |
| **Import WordPress**                                               | `src/lib/wordpress-import.functions.ts:84,97-99` - `throw new Error("LOVABLE_API_KEY is not configured")`                        | Twardy błąd, nie degradacja                                                                                                           |
| **Google Search Console**                                          | `src/lib/analytics/gsc.functions.ts:12,45-46`                                                                                    | Brak danych SEO w panelu                                                                                                              |

Klucz Resend **nigdy nie idzie bezpośrednio do `api.resend.com`** - wyłącznie jako nagłówek
`X-Connection-Api-Key` do gatewaya Lovable (`provider.server.ts:120-125`). Posiadanie
własnego klucza Resend nie wystarcza, dopóki kod nie zostanie przepięty (§7.1).

## 6. Odtworzenie środowiska od zera BEZ wykonawcy

### 6.1 Sekwencja, która DZIAŁA DZIŚ (zweryfikowana w CI)

```bash
git clone https://github.com/NewEUStrategies/neweustrategies-dc633fb5.git
cd neweustrategies-dc633fb5

# KROK 1 - OBOWIĄZKOWY. bun.lock ma 340 URL-i do prywatnego rejestru platformy i ZERO
# do registry.npmjs.org; bez podmiany `bun install` dostaje 403. Dokładna komenda z
# ci.yml:70 (identyczna w ci.yml:734, e2e.yml:36, e2e.yml:81, lighthouse.yml:71):
sed -E -i 's#https://europe-west[0-9]+-npm\.pkg\.dev/lovable-core-prod/sandbox-npm-cache/#https://registry.npmjs.org/#g' bun.lock

# KROK 2 - instalacja (Bun przypięty w CI do 1.2.23, ci.yml:61)
bun install

# KROK 3 - baza: świeża instancja + 918 migracji + supabase/seed.sql (440 linii).
# Supabase CLI przypięty do 2.111.0 (ci.yml:524) - pin jest celowy.
supabase db start

# KROK 4 - testy bazy: 99 plików pgTAP
supabase test db

# KROK 5 - bramki
bun run verify:blocking            # verify:static + typecheck + lint + test
bun run check:sql-migration-replay # inwariant odtwarzalności bazy od zera
bun run check:ownership            # pokrycie rejestru własnicielstwa
```

**NIE COMMITOWAĆ ZMIENIONEGO `bun.lock`** - podmiana jest wyłącznie na czas instalacji
(`ci.yml:63-67`: _"This edit is CI-only (never committed)"_). Docelowe rozwiązanie to
pozycja W-4 w §7.

### 6.2 Czego DZIŚ NIE MA i co jest NIEZNANE

| Element                          | Status                  | Co trzeba sprawdzić / napisać                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build produkcyjny                | **NIEZNANY**            | `vite.config.ts:10` importuje `defineConfig` z zamkniętego pakietu `@lovable.dev/vite-tanstack-config` `2.13.1` (`package.json:161`). Pakiet definiuje tanstackStart, viteReact, tailwindcss, tsConfigPaths i nitro. **KROK PIERWSZY: sprawdzić, czy pakiet jest publicznie dostępny na `registry.npmjs.org`.** Jeśli nie - build produkcyjny trzeba złożyć od zera |
| Wdrożenie                        | **NIE ISTNIEJE W REPO** | Grep po `deploy\|wrangler\|publish` w `.github/workflows/*.yml` daje wyłącznie komentarze i nazwę joba `post-deploy`. Zero `wrangler deploy`, zero środowisk GitHub. Do napisania: `wrangler.toml`, pipeline build → deploy, mapowanie sekretów produkcyjnych                                                                                                       |
| Stosowanie migracji na produkcji | **NIE ISTNIEJE W REPO** | `SUPABASE_ACCESS_TOKEN` i `SUPABASE_DB_PASSWORD` są w `TOOL_CONSUMED` (`src/lib/ci/workflowEnvContract.ts:37-49`), ale **żaden workflow ich nie używa**. Migracje stosuje platforma, przepisując im wersje - 9 wpisów `reconciled` w `supabase/migration-ledger.json`, `baseline: "20260825230232"`                                                                 |
| Backup produkcji                 | **NIE ISTNIEJE**        | 0 trafień `pg_dump`, 0 `pg_restore`, 0 `supabase db dump` w całym repo. Jedyne backupy to PITR po stronie Supabase - poza repo, bez testu przywrócenia. `supabase db start` odtwarza SCHEMAT + dane deweloperskie, **nie dane produkcyjne**                                                                                                                         |
| Buckety Storage                  | częściowo               | W politykach RLS 7 bucketów: `media`, `cv`, `career-cv`, `chat-attachments`, `club-media`, `member-resources`, `tts-cache`. **Tylko `media` tworzy migracja** - pozostałe 6 trzeba założyć ręcznie                                                                                                                                                                  |
| Supabase Edge Functions          | brak (to dobrze)        | Katalog `supabase/functions/` nie istnieje. Cała logika serwerowa żyje w aplikacji na Cloudflare Workers - to upraszcza wyjście                                                                                                                                                                                                                                     |
| Rozszerzenia Postgresa           | wymagane                | 10 rozszerzeń: `pg_cron`, `pg_net`, `supabase_vault`, `pgcrypto`, `pg_trgm`, `btree_gist`, `unaccent`, `vector`, `pgmq`, `pgtap`                                                                                                                                                                                                                                    |

### 6.3 Krok CI, który NIE MA odpowiednika na produkcji

`ci.yml:545-580` nadaje roli `postgres` prawo przestawiania triggerów na `auth.users`
(właścicielem jest `supabase_auth_admin`). Komentarz w pliku mówi wprost: _"Dotyczy
WYŁĄCZNIE jednorazowej bazy CI - nie ma odpowiednika na produkcji i nie wynika z żadnej
migracji."_ **NIE PRZENOSIĆ tego kroku na produkcję.**

## 7. Plan wyjścia z platformy

Kolejność wynika z ryzyka: najpierw to, czego brak zatrzymuje przychód i komunikację.
Trudność w skali: **niska** (zmiana konfiguracji), **średnia** (przepisanie kodu w znanych
punktach), **wysoka** (praca projektowa od zera bez wzorca w repo).

| #   | Praca                                                                                                                                         | Punkty w kodzie                                                                                                                                                                                                                                                                                                                                                                                              | Trudność                                    | Ryzyko przy pominięciu                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| W-1 | **Odcięcie gatewaya poczty** → bezpośrednio do `api.resend.com`. **CZTERY niezależne miejsca wołają ten sam gateway - łatwo przeoczyć jedno** | `src/lib/email/provider.server.ts:21,120-125`; `src/lib/server/email.server.ts:16,53-67`; `src/lib/newsletter.functions.ts:16,88-98`; `src/lib/contact.functions.ts:57,66-76`. Do tego fallback `@lovable.dev/email-js` (`provider.server.ts:178,194`) i webhooki platformy: `src/routes/platform/email/auth/webhook.ts:3-4`, `suppression.ts:13,84-86`                                                      | średnia                                     | Część maili wychodzi starą ścieżką - awaria częściowa, najtrudniejsza do wykrycia                                                         |
| W-2 | **Odcięcie gatewaya płatności** → SDK `stripe` 22.0.2 (już w `package.json:150`)                                                              | `src/lib/stripe.server.ts:14,26`; `scripts/billing-renewal-probe.ts:49,126` (ma już nadpisanie `PROBE_GATEWAY_URL`); `src/lib/billing/mockMode.server.ts:16`                                                                                                                                                                                                                                                 | średnia                                     | Brak przychodu. Bramka `check:entry-purity` (`ci.yml:505-506`) pilnuje, żeby SDK nie był osiągalny ze startowego chunku - **utrzymać ją** |
| W-3 | **Odcięcie AI** → własny dostawca                                                                                                             | `src/lib/ai-gateway.server.ts:77`; `aiTranslate.server.ts:10`; `embeddings.server.ts:10`; `src/routes/api/stt.ts:56-57`. Najtańsza ścieżka: nadpisania `AI_GATEWAY_URL` / `AI_GATEWAY_EMBEDDINGS_URL` (§3.4) - bez zmiany kodu, o ile nowy dostawca mówi protokołem zgodnym                                                                                                                                  | niska→średnia                               | Brak tłumaczeń i nowych embeddingów. **Stare embeddingi zostają** - wyszukiwanie semantyczne degraduje się stopniowo, nie od razu         |
| W-4 | **Zastąpienie rejestru npm** - `bun.lock` na stałe na `registry.npmjs.org`                                                                    | dziś `sed` w 5 miejscach CI (§6.1). Dodatkowo `bunfig.toml:5-6` zwalnia `@lovable.dev/vite-tanstack-config` i `@lovable.dev/mcp-js` z 24-godzinnej blokady supply-chain - **tę furtkę trzeba zamknąć albo zaakceptować na piśmie**                                                                                                                                                                           | niska (mechanicznie) / wysoka (weryfikacja) | Każdy build zależy od cudzej infrastruktury                                                                                               |
| W-5 | **Własny build** - wyeliminować `@lovable.dev/vite-tanstack-config` 2.13.1                                                                    | `vite.config.ts:1-3,10,66-76`. Komentarz l. 32-36 przyznaje, że typy pakietu deklarują tylko podzbiór opcji Nitro, a runtime forwarduje cały obiekt - **repo pracuje wokół nieudokumentowanego zachowania cudzego pakietu**                                                                                                                                                                                  | wysoka                                      | Bez tego nie ma czym zbudować produkcji                                                                                                   |
| W-6 | **Własne wdrożenie** - `wrangler.toml`, pipeline build → Cloudflare Workers, mapowanie sekretów                                               | brak wzorca w repo. Znane: `preset: "cloudflare-module"`, assets z `.output/public/` bindowane przez Wranglera (`ci.yml:345`)                                                                                                                                                                                                                                                                                | wysoka                                      | Brak jakiejkolwiek ścieżki wydania                                                                                                        |
| W-7 | **Własne stosowanie migracji** - 918 plików na produkcję                                                                                      | dziś robi to platforma, przepisując wersje (`supabase/migration-ledger.json`)                                                                                                                                                                                                                                                                                                                                | wysoka                                      | Nie ma czym wdrożyć zmiany schematu                                                                                                       |
| W-8 | **Podmiana zahardkodowanego refa bazy W KODZIE I W DANYCH**                                                                                   | Kod: `src/lib/seo/rootHead.ts:30` (`SUPABASE_PRECONNECT_ORIGIN`), `src/lib/email-templates/icons.tsx:13`, `src/lib/email-templates/nes-layout.tsx:22,24` (logotypy maili), plus testy `txCopy.test.ts:188`, `enhanceImages.test.ts:4`. **Dane: 5 plików migracji** zawiera pełne adresy storage - m.in. `20260727075644_*.sql:24-25` (logo motywu) i `20260804133657_*.sql:5,7` (grafiki popupu newslettera) | wysoka                                      | Przejście na inny projekt Supabase to NIE jest podmiana zmiennej env. Po migracji maile pokazywałyby logo ze starego, cudzego projektu    |
| W-9 | **MCP** - zastąpić `@lovable.dev/mcp-js` albo wygasić serwer                                                                                  | `src/lib/mcp/index.ts:1`; trasy `src/routes/mcp.ts:11`, `[.mcp]/list-tools.ts:10`, `[.mcp]/invoke-tool/$tool.ts:10`, `[.well-known]/oauth-protected-resource.ts:11`; manifest `.lovable/mcp/manifest.json`                                                                                                                                                                                                   | niska                                       | Funkcja poboczna - 3 narzędzia (`search_posts`, `get_post`, `list_recent_posts`)                                                          |

**PUŁAPKA UDOKUMENTOWANA W TYM REPO.** Przy każdej zmianie nazwy sekretu grozi powtórka
incydentu z `billing-nightly.yml:9-29`: workflow eksportował `PADDLE_SANDBOX_API_KEY`,
a sonda czytała `STRIPE_SANDBOX_API_KEY` - job co dobę spał 40 minut, kończył się na
zielono i nie wykonywał ŻADNEGO żądania. Chroni przed tym wyłącznie
`bun run check:workflow-env-contract` (`scripts/check-workflow-env-contract.ts`,
`src/lib/ci/workflowEnvContract.ts`). **TĘ BRAMKĘ TRZEBA UTRZYMAĆ WPIĘTĄ.**

## 8. Przekazanie wiedzy (handover)

### 8.1 Co wykonawca ma oddać - checklista odbioru

- [ ] Lista kont i dostępów ze wskazaniem, gdzie leży każdy sekret (panel platformy /
      GitHub Secrets / Supabase Vault - **TRZY różne miejsca**, §3).
- [ ] Sekrety nieodtwarzalne: zawartość Supabase Vault (18 wywołań `vault.create_secret`),
      klucz asercji tenanta, `job_runner_settings.secret`.
- [ ] Pisemne potwierdzenie, czy PITR w Supabase jest włączony, z jakim oknem i kiedy
      ostatnio testowano przywrócenie.
- [ ] 14 zmiennych z §3.4 opisanych i dopisanych do `.env.example`.
- [ ] Konfiguracja connectorów Lovable (Resend, Stripe, WordPress.com, GSC) i webhooków
      Stripe + Resend (`{PUBLIC_SITE_URL}/api/public/webhooks/resend`, 6 zdarzeń,
      `.env.example:57-64`).
- [ ] Osoby do obsadzenia 9 domen w `governance/ownership.json` (właściciel + zastępca +
      eskalacja) - dziś wszystkie 18 pozycji to `NIEOBSADZONY`.
- [ ] Lista znanych, nienaprawionych problemów z odniesieniem do plików.

### 8.2 CZEGO NIE DA SIĘ ODTWORZYĆ Z HISTORII GITA

`git shortlog -sne --all` daje **4 tożsamości i 275 commitów**: `gpt-engineer-app[bot]`
(bot platformy) - 240 commitów, **87,3%**; `Claude <noreply@anthropic.com>` (agent AI) - 24,
8,7%; `Claude <marketing@neweuropeanstrategies.com>` (agent AI) - 9, 3,3%;
`New European Strategies <office@…>` (tożsamość organizacji) - **2 commity, 0,7%**.

Historia jest spłaszczona: 275 commitów w **3 dniach kalendarzowych** (27.08: 1,
28.08: 199, 29.08: 75) przy migracjach datowanych od lipca (`20260702…`). Tagów: **0**.
Numeracja PR-ów sięga **#302**, a historia commitów tego nie odzwierciedla.

**WNIOSEK OPERACYJNY - to cytat z `.github/workflows/ci.yml:120`:**

> _"przy spłaszczonej historii commitów [rejestr migracji] to jedyne narzędzie datowania
> regresji, jakie zostaje audytowi."_

Jedynym rzetelnym zapisem „kiedy co weszło" jest zatem para:
`supabase/migration-ledger.json` (plik → wersja faktycznie wykonana) oraz tabela
`supabase_migrations.schema_migrations` w żywej bazie, porównywane bramką
`bun run check:migration-ledger` przez RPC `missing_migration_versions`
(`ci.yml:749-759`). **NIE KASOWAĆ ani nie przepisywać `migration-ledger.json`** - to
jedyny audytowalny dziennik zmian schematu, jaki projekt posiada.

Rekompensata: repo jest wyjątkowo dobrze udokumentowane wewnętrznie - **124 dokumenty
w `docs/`** plus komentarze w migracjach i workflow opisujące konkretne incydenty
produkcyjne z datami. To realnie obniża koszt przejęcia.

## 9. Ćwiczenie procedury - żeby runbook nie był martwy

Runbook, którego nikt nie wykonał, jest wart tyle co jego brak. Poniższy test jest tani
(jedna osoba, jedna sesja) i wykrywa dokładnie te awarie, które zabijają przejęcie.

### 9.1 Test kwartalny „zimny start"

| Krok | Komenda / czynność                                                              | Kryterium zaliczenia                  |
| ---- | ------------------------------------------------------------------------------- | ------------------------------------- |
| 1    | Sklonuj repo na **czystą maszynę**, bez cache'u i bez konta wykonawcy           | klon się powiódł                      |
| 2    | `sed` z §6.1 + `bun install`                                                    | instalacja bez `403`                  |
| 3    | `supabase db start`                                                             | 918 migracji przechodzi od zera       |
| 4    | `supabase test db`                                                              | 99 plików pgTAP zielone               |
| 5    | `bun run verify:blocking`                                                       | zielone                               |
| 6    | `bun run check:ownership`                                                       | zielone; zapisz raport rozkładu domen |
| 7    | `bun run check:workflow-env-contract`                                           | zielone                               |
| 8    | Sonda `GET /api/public/community-cron`                                          | `200`                                 |
| 9    | Zaloguj się do KAŻDEGO panelu z §3.6 kontem Zamawiającego, bez pomocy wykonawcy | 10/10 paneli                          |
| 10   | Odczytaj jeden sekret z Supabase Vault                                          | odczyt się powiódł                    |

**Kryterium całości: kroki 1-10 wykonane przez jedną osobę w jednej sesji, bez kontaktu
z wykonawcą.** Każdy krok, który wymagał pytania do wykonawcy, jest LUKĄ - wpisz ją do §10.

### 9.2 Test roczny „przywrócenie danych"

Raz w roku, po włączeniu i udokumentowaniu backupu (luka L-3): odtworzyć bazę z kopii na
osobnym projekcie i potwierdzić, że aplikacja startuje na tych danych. **DZIŚ TEGO TESTU
NIE DA SIĘ WYKONAĆ** - nie ma z czego przywracać.

### 9.3 Kontrola ciągła (bez wysiłku)

- `bun run check:ownership` w CI - blokuje merge przy regresji własnicielstwa (luka L-6).
- Progi-zapadki z `governance/ownership.json`: `domenyBezWlasciciela` **9**,
  `migracjeBezAtrybucjiDozwolone` **5 pozycji**, `martweWzorceTras` **0**. **TE PROGI WOLNO WYŁĄCZNIE ZACIEŚNIAĆ** -
  podniesienie jest regresją i wymaga osobnej decyzji Zamawiającego.
- Aktualizacja daty przeglądu tego dokumentu przy każdym ćwiczeniu.

## 10. Rejestr decyzji i luk otwartych

Stan na **2026-08-29**. Kolumna „Kto odblokowuje" nie jest sugestią - to przypisanie
odpowiedzialności.

| ID       | Luka                                                                                                                                                              | Dowód                                                                                                                                                                                                     | Skutek                                                                                                                               | Kto odblokowuje                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **L-1**  | `docs/UMOWA_UTRZYMANIOWA.md` istnieje, ale sam deklaruje: **„TO NIE JEST DOKUMENT PRAWNY"** - warunki handlowe, kary umowne i wypowiedzenie są poza jego zakresem | `docs/UMOWA_UTRZYMANIOWA.md:1-8`                                                                                                                                                                          | Progi i klasy SLA z §1.1 nie mają umocowania w umowie handlowej                                                                      | **Zamawiający** (`office@neweuropeanstrategies.com`)                                    |
| **L-2**  | Brak `governance/README.md`                                                                                                                                       | rejestr wskazuje go w `meta.jakEdytowac`; `bun run check:ownership` zgłasza BRAK DOKUMENTU WYMAGANEGO PRZEZ REJESTR i **kończy się kodem 1**                                                              | Bramka własnicielstwa jest dziś czerwona; nie wiadomo, jak edytować rejestr                                                          | **Zamawiający** + wykonawca zastępczy                                                   |
| **L-3**  | **BRAK PROCEDURY BACKUPU**                                                                                                                                        | 0 trafień `pg_dump`, 0 `pg_restore`, 0 `supabase db dump` w całym repo. Słowo „backup" w `docs/` występuje raz - `ARCHITECTURE.md:778` jako nazwa tabeli `suppressed_emails_legacy_backup`, nie procedura | Dane produkcyjne (treści, użytkownicy, zamówienia, CRM, darowizny) **nie są odtwarzalne**. Nie wiadomo nawet, czy PITR jest włączony | **Zamawiający** - decyzja o planie Supabase; wykonawca zastępczy - procedura i test     |
| **L-4**  | 9 z 9 domen bez właściciela technicznego                                                                                                                          | `bun run check:ownership` - ostrzeżenie „9 z 9 domen nadal bez obsadzonego właściciela"; `osoby.wt-nieobsadzony.obsadzone = false`                                                                        | Zgłoszenie nie ma adresata. SLA nie ma kogo obowiązywać                                                                              | **Zamawiający** - wskazuje osoby                                                        |
| **L-5**  | Brak wykonawcy w rejestrze                                                                                                                                        | `kontraktUtrzymaniowy.wykonawca = "NIEOBSADZONE"`                                                                                                                                                         | jw.                                                                                                                                  | **Zamawiający**                                                                         |
| **L-6**  | `check:ownership` **NIE JEST wpięty do CI**                                                                                                                       | `package.json:54` definiuje skrypt; grep po `.github/workflows/` za `ownership` = **0 trafień**                                                                                                           | Bramka istnieje, ale nie blokuje merge'y. Regresja własnicielstwa przejdzie niezauważona                                             | wykonawca zastępczy - dopisać krok do `ci.yml`                                          |
| **L-7**  | Brak `CODEOWNERS`, `dependabot.yml`, szablonu PR                                                                                                                  | `.github/` zawiera wyłącznie 5 plików workflow; `package.json:55-56` ma już `generate:codeowners` i `check:codeowners`, ale plik `.github/CODEOWNERS` nie istnieje                                        | Brak automatycznego przypisania recenzji i brak aktualizacji bezpieczeństwa przy 190+ zależnościach npm                              | wykonawca zastępczy; obsadzenie L-4 jest warunkiem wstępnym                             |
| **L-8**  | 14 zmiennych produkcyjnych poza `.env.example`                                                                                                                    | §3.4, weryfikacja przez `process.env` w `src/` i `scripts/`                                                                                                                                               | Środowisko „z przykładu" ma martwą analitykę i osłabiony anty-bruteforce - **bez komunikatu błędu**                                  | wykonawca zastępczy                                                                     |
| **L-9**  | Nieznana dostępność `@lovable.dev/vite-tanstack-config` 2.13.1                                                                                                    | `package.json:161`, `vite.config.ts:10`                                                                                                                                                                   | Jeśli pakiet jest prywatny, **nie ma czym zbudować produkcji** po odcięciu od platformy                                              | wykonawca zastępczy - sprawdzenie zajmuje minuty i musi być pierwsze                    |
| **L-10** | Brak pipeline'u wdrożenia i stosowania migracji                                                                                                                   | 0 kroków wdrożenia w `.github/`; `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD` w `TOOL_CONSUMED`, ale nieużywane                                                                                         | Brak ścieżki wydania kodu i schematu                                                                                                 | wykonawca zastępczy (prace W-6, W-7 z §7)                                               |
| **L-11** | Zahardkodowany ref `unnltowbgszpdzwpawdu` w kodzie i danych                                                                                                       | `src/lib/seo/rootHead.ts:30`, `src/lib/email-templates/icons.tsx:13`, `nes-layout.tsx:22,24`, 5 plików migracji                                                                                           | Migracja na inny projekt Supabase wymaga zmiany kodu **i danych**                                                                    | wykonawca zastępczy (praca W-8)                                                         |
| **L-12** | Bezpieczniki właścicielskie w 2 workflow                                                                                                                          | `scheduler.yml:72`, `billing-nightly.yml:51`                                                                                                                                                              | Przeniesienie repo do innej organizacji **zatrzyma harmonogramy bez błędu**                                                          | wykonawca zastępczy - zamienić literał na `vars.*` przed jakąkolwiek zmianą właściciela |
| **L-13** | GitHub gasi zaplanowane workflow po 60 dniach bezczynności                                                                                                        | `scheduler.yml:25-27`                                                                                                                                                                                     | W okresie przestoju - dokładnie w scenariuszu tego runbooka - siatka zewnętrzna umiera po cichu                                      | dyżur operacyjny - dowolna aktywność w repo raz na 60 dni                               |
| **L-14** | `bunfig.toml:5-6` zwalnia 2 pakiety platformy z 24-godzinnej blokady supply-chain                                                                                 | `minimumReleaseAgeExcludes`                                                                                                                                                                               | Przyspieszona ścieżka cudzego kodu do buildu                                                                                         | **Zamawiający** - świadome zamknięcie albo akceptacja na piśmie                         |

## 11. Przegląd dokumentu

Sporządzono **2026-08-29** na podstawie audytu z tego samego dnia (193 trasy
`src/routes/admin*.tsx`, 918 migracji `supabase/migrations/*.sql`, rejestr
`governance/ownership.json`: 9 domen, 75 wzorców tras, 186 reguł prefiksów bazy).
Następny przegląd: po pierwszym ćwiczeniu kwartalnym (§9.1), nie później niż
**2026-11-29**. Twardy termin przeglądu umownego: **2027-07-02** (`obowiazujeDo`
2027-08-31 minus `ostrzegajOdDni` 60). Właściciel dokumentu: **DO UZUPEŁNIENIA** -
wskazuje Zamawiający (§1.3).
