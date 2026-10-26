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
i `marketing@neweuropeanstrategies.com` (`VAPID_SUBJECT` w `.env.example`). Każde
**DO UZUPEŁNIENIA** wypełnia **Zamawiający (New European Strategies,
`office@neweuropeanstrategies.com`)** - nikt inny nie ma do tego mandatu.

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
      `github.repository_owner == 'NewEUStrategies'` (warunek `if` joba `tick`
      w `.github/workflows/scheduler.yml` i joba `renewal` w
      `.github/workflows/billing-nightly.yml`) zatrzyma oba harmonogramy BEZ ŻADNEGO BŁĘDU.
- [ ] **Supabase, projekt `unnltowbgszpdzwpawdu`** (`supabase/config.toml:1`): rola `Owner`
      u Zamawiającego; Settings → General → Transfer project - sprawdź, czyja to organizacja.
- [ ] **Lovable** - workspace i projekt (`.lovable/project.json`). To panel, w którym leżą
      sekrety produkcyjne. CI ich celowo nie dostaje: job `build` w `.github/workflows/ci.yml`
      buduje i testuje na zaślepce Supabase (§3.1).
- [ ] **Cloudflare** - strefa `neweuropeanstrategies.com` i Workers; runtime aplikacji
      (`vite.config.ts`, obiekt `nitroOptions`: `preset: "cloudflare-module"`).
- [ ] **Rejestrator domeny** - dostęp, blokada transferu, kontakt administracyjny u Zamawiającego.
- [ ] **Stripe**, **Resend**, **Google**, **ElevenLabs**, **WordPress.com** - tabela §3.6.
- [ ] Konta wykonawcy usuwaj DOPIERO po potwierdzeniu własnego dostępu z drugiej przeglądarki.

### 2.2 Godzina 0-4: zamroź zmiany

- [ ] Ochrona `main`: nałóż ruleset `governance/release/main-ruleset.json`
      (`GH_TOKEN="$(gh auth token)" bun run governance:apply-ruleset`, token z uprawnieniem
      „Administration: write"; nie import w ustawieniach - `governance/release/README.md` §2)
      i potwierdź zielony przebieg `release-governance.yml` (uruchom ręcznie). Ruleset NIE
      zatrzymuje pushy aplikacji Lovable (obejście `always`, tamże §1). Dziś `.github/` ma `CODEOWNERS` (82 aktywne reguły,
      wszystkie na konto `@NewEUStrategies` - L-7) i 10 workflowów; NIE MA `dependabot.yml`
      ani szablonu PR.
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
- [ ] GitHub → Actions: czy `scheduler.yml` (wpis co 5 min, ale best-effort - pomiar
      2026-10-17: około 10 przebiegów na dobę) i `billing-nightly.yml` biegną, a ich kroki
      „Audyt drugiej linii doręczeń" i „Sprawdź konfigurację sondy" są zielone (czerwone =
      brak sekretów z §3.1 albo jawnej decyzji `vars.SCHEDULER_BACKUP=off` /
      `vars.BILLING_PROBE_DISABLED=1`). **GitHub wyłącza zaplanowane workflow po 60 dniach
      bez aktywności w repo** (nagłówek `.github/workflows/scheduler.yml`, „Uwaga
      operacyjna") - w przestoju gaśnie to po cichu.
- [ ] Supabase → Database → Extensions: `pg_cron` i `pg_net` włączone. Bez nich ścieżka
      podstawowa doręczeń nie istnieje.

### 2.4 Godzina 6-24: zbierz dowody i uruchom bramki

```bash
git clone https://github.com/NewEUStrategies/neweustrategies-dc633fb5.git
cd neweustrategies-dc633fb5

# KROK OBOWIĄZKOWY - bez niego `bun install` NIE PRZEJDZIE (patrz §6.1)
sed -E -i 's#https://europe-west[0-9]+-npm\.pkg\.dev/lovable-core-prod/sandbox-npm-cache/#https://registry.npmjs.org/#g' bun.lock

bun install
bun run scripts/generate-codeowners.ts --check   # rejestr własnicielstwa się parsuje, CODEOWNERS zgodny
bun run verify:blocking        # verify:static + typecheck + lint + test (w tym kontrakt env workflow)
```

- [ ] Lustrzana kopia repo poza GitHubem (`git clone --mirror`), przechowana u Zamawiającego.
- [ ] Eksport nazw (nie wartości) sekretów i zmiennych Actions, porównany z §3.1 i §3.2.
      Oczekiwane: sekretów najwyżej **8** (`PSI_API_KEY` jest opcjonalny) i **ŻADNEGO** o nazwie
      `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL` ani
      `VITE_SUPABASE_PUBLISHABLE_KEY` (§3.1); zmiennych najwyżej **9** (§3.2). Innych nazw
      workflowy nie czytają.
- [ ] Supabase → Settings → Database → Backups: **udokumentuj, czy PITR jest włączony i
      z jakim oknem**. W repo NIE MA procedury backupu - 0 trafień `pg_dump`, `pg_restore`
      i `supabase db dump` w całym drzewie. To luka L-3 z §10.

## 3. Inwentarz dostępów do przejęcia

### 3.1 Sekrety GitHub Actions - 12 nazw, z czego 4 NIE MOGĄ istnieć

Miejsce: **Settings → Secrets and variables → Actions → Repository secrets**. Workflowy
czytają 12 nazw `secrets.*`: 8 z tabeli niżej (`PSI_API_KEY` jest opcjonalny) i 4 nazwy
Supabase z ostrzeżenia pod tabelą. Automatyczny `github.token` nie jest ustawianym
sekretem i nie wchodzi do tej liczby.

| Sekret                           | Gdzie użyty                                              | Kto musi mieć dostęp                                                                        | Co się stanie, gdy zabraknie                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SANDBOX_API_KEY`         | `billing-nightly.yml` (env kroków sondy, nie joba)       | Zamawiający + osoba odpowiedzialna za rozliczenia                                           | Nocna sonda odnowienia i dunningu nie wykonuje ŻADNEGO żądania; przebieg z harmonogramu jest CZERWONY (krok „Sprawdź konfigurację sondy" wypisuje komplet braków). Stan 2026-10-26: brak, sonda czerwona codziennie co najmniej od 2026-09-17                                                                                                                                 |
| `LOVABLE_API_KEY`                | `billing-nightly.yml` (env kroków sondy, nie joba)       | Zamawiający                                                                                 | Sonda rozliczeń nie autoryzuje gatewaya Stripe                                                                                                                                                                                                                                                                                                                                |
| `PROBE_SUPABASE_URL`             | `billing-nightly.yml` (wyłącznie krok weryfikacji)       | Zamawiający + osoba odpowiedzialna za rozliczenia                                           | Sonda nie sprawdza NASZEJ strony (dziennik webhooków, `subscriptions`). Z harmonogramu: przebieg **CZERWONY**, ręcznie: ostrzeżenie                                                                                                                                                                                                                                           |
| `PROBE_SUPABASE_PUBLISHABLE_KEY` | jw.                                                      | jw. (klucz PUBLIKOWALNY produkcji - ten sam, co w przeglądarce)                             | jw.                                                                                                                                                                                                                                                                                                                                                                           |
| `BILLING_PROBE_TOKEN`            | jw.                                                      | jw. (token sondy z `SELECT public.billing_probe_rotate_token();`; w bazie leży tylko skrót) | jw. Token otwiera WYŁĄCZNIE RPC `billing_probe_status`: stan zdarzeń piaskownicy jednej subskrypcji. Klucz `service_role` sonda już NIE dostaje (przegląd 7.6)                                                                                                                                                                                                                |
| `COMMUNITY_CRON_SECRET`          | `scheduler.yml` (przebiegi 5-minutowe i ręczne)          | Zamawiający + dyżur operacyjny                                                              | Ticki społeczności są pomijane z ostrzeżeniem (bez ostrzeżenia tylko przebieg z harmonogramu przy `vars.SCHEDULER_BACKUP=off`); dobowy krok „Audyt drugiej linii doręczeń" jest **CZERWONY**, dopóki nie ma ani sekretu, ani decyzji `vars.SCHEDULER_BACKUP=off`                                                                                                              |
| `BILLING_CRON_SECRET`            | `scheduler.yml` (dobowy krok „Tick rozliczeń")           | Zamawiający + dyżur operacyjny                                                              | Dobowy tick rozliczeń z repo jest pomijany, a krok „Audyt drugiej linii doręczeń" jest **CZERWONY**, dopóki nie ma ani sekretu, ani decyzji `vars.SCHEDULER_BACKUP=off`; `pg_cron` (`billing-cron-daily`) dalej działa WŁASNYM sekretem rozliczeń (`job_runner_settings.billing_secret`). Wartość NIE może być sekretem społeczności ani runnera - endpoint ich nie przyjmuje |
| `PSI_API_KEY`                    | `psi.yml` (krok „Sample PageSpeed Insights (locale=pl)") | Zamawiający (klucz z Google Cloud Console)                                                  | **Opcjonalny.** Codzienne próbkowanie PageSpeed Insights kończy się na zielono z ostrzeżeniem i nie pyta API (nagłówek `.github/workflows/psi.yml`)                                                                                                                                                                                                                           |

**NIE TWÓRZ SEKRETÓW `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL` ANI
`VITE_SUPABASE_PUBLISHABLE_KEY`** (`docs/RUNBOOK_MIGRACJE_LOVABLE.md` §4.8). Workflowy
czytają te nazwy jako sekrety, a bez sekretu podstawiają zaślepkę
`https://placeholder.supabase.co` / `placeholder-anon-key` - to zamierzone działanie, nie
luka. Na zaślepce mają działać kroki „Build", „Build production artifact for a node server
(smoke preset)" i „Boot test and first-load timing on the production artifact" joba `build`
w `ci.yml`, krok „Run E2E (Playwright)" w `e2e.yml` oraz kroki „Build production artifact
for a node server (smoke preset)" i „Start the production artifact and warm it with a Chrome
UA" w `lighthouse.yml`. Sekret o jednej z tych nazw przełączyłby je na produkcyjny backend:
artefakt CI dostałby adres produkcji, a testy e2e i pomiary chodziłyby po prawdziwej bazie.
Job `post-deploy` (push na `main` albo `workflow_dispatch` na `main`, wyłącznie po zielonym
`Required release checks`) bierze `SUPABASE_URL` i `SUPABASE_PUBLISHABLE_KEY` (zapasowo `VITE_*`)
najpierw z sekretów o tych nazwach, potem ze ZMIENNYCH z §3.2; gdy nie ma żadnej, job jest
czerwony (`::error`) - commit nie ma dowodu wdrożenia, bo
`check:db-contract` i `check:migration-ledger` niczego nie sprawdziły. Jeśli eksport z §2.4 pokazuje
którąkolwiek z tych czterech nazw wśród sekretów - przenieś wartość do zmiennej z §3.2 i
usuń sekret.

### 3.2 Zmienne GitHub Actions - 9 nazw

Miejsce: **Settings → Secrets and variables → Actions → Variables**.

| Zmienna                                              | Gdzie                                                     | Znaczenie                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_BASE_URL`                                       | `scheduler.yml`, `billing-nightly.yml` (krok weryfikacji) | Adres aplikacji, np. `https://neweuropeanstrategies.com`. Bez niej scheduler nie ma dokąd pukać, a sonda rozliczeń sprawdza KAŻDY punkt odbioru webhooków piaskownicy z naszą ścieżką (nie tylko tego wdrożenia)                                                                                                                                                                              |
| `SCHEDULER_BACKUP`                                   | `scheduler.yml` (kontrola konfiguracji i audyt dobowy)    | `off` = jawna decyzja, że repo nie prowadzi drugiej linii doręczeń (zostaje `pg_cron`). Wyłącza WYŁĄCZNIE przebiegi z harmonogramu (ticki pominięte bez ostrzeżeń) i dobowy „Audyt drugiej linii doręczeń" (tylko odnotowuje decyzję); ręczne uruchomienie (`workflow_dispatch`) działa dokładnie tak, jak bez wyłącznika. Bez decyzji i bez kompletu konfiguracji audyt dobowy jest czerwony |
| `BILLING_PROBE_DISABLED`                             | `billing-nightly.yml` (warunek `if` joba `renewal`)       | `'1'` wyłącza sondę rozliczeń. Wyłącznik jest JAWNY celowo                                                                                                                                                                                                                                                                                                                                    |
| `LHCI_URL`                                           | `lighthouse.yml`                                          | Pusty (domyślnie) ⇒ TRYB C: blokujący audyt artefaktu `build:smoke` (asercje TBT i CLS na poziomie `error`). Ustawiony ⇒ TRYB A: blokujący audyt wdrożenia pod tym adresem. Workflow biegnie wyłącznie po scaleniu do `main` i ręcznie - **żaden tryb nie bramkuje PR-ów**                                                                                                                    |
| `LHCI_EXTRA_PATHS`                                   | `lighthouse.yml` (wyłącznie TRYB A)                       | Ścieżki audytowane obok strony głównej, rozdzielane przecinkami. ZASTĘPUJĄ w całości listę domyślną `/blog,/events,/club`                                                                                                                                                                                                                                                                     |
| `SUPABASE_URL`                                       | `ci.yml` (job `post-deploy`)                              | Adres projektu Supabase dla bramek po wdrożeniu (`check:db-contract`, `check:migration-ledger`). ZMIENNA, nigdy sekret (§3.1). Bez niej, bez `VITE_SUPABASE_URL` i bez sekretu o tych nazwach job jest czerwony (`::error`) - brak dowodu wdrożenia                                                                                                                                           |
| `SUPABASE_PUBLISHABLE_KEY`                           | jw.                                                       | Klucz publikowalny produkcji (ten sam, co w przeglądarce) - para do `SUPABASE_URL`                                                                                                                                                                                                                                                                                                            |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | jw.                                                       | Wyłącznie zapas `post-deploy`, gdy brak dwóch zmiennych wyżej; wystarcza ustawić tamte (`docs/RUNBOOK_MIGRACJE_LOVABLE.md` §4.8)                                                                                                                                                                                                                                                              |

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
| Stripe          | `STRIPE_SANDBOX_API_KEY`, `STRIPE_LIVE_API_KEY`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET`, `PAYMENTS_LIVE_WEBHOOK_SECRET`, `VITE_PAYMENTS_CLIENT_TOKEN`                                          | 181-185 | **SEKRET** / publiczna | **NAZWY MUSZĄ SIĘ ZGADZAĆ CO DO ZNAKU** z `src/lib/stripe.server.ts` (komentarz sekcji płatności w `.env.example`)                                                                       |
| Lovable         | `LOVABLE_API_KEY`                                                                                                                                                                         | 43      | **SEKRET**             | Najczęściej używana zmienna w repo (45 odczytów `process.env`). Patrz §5.4                                                                                                               |
| Resend          | `RESEND_API_KEY`                                                                                                                                                                          | 52      | **SEKRET**             | CAŁA poczta wychodząca spada na zapasowego dostawcę, który NIE zwraca identyfikatora wiadomości                                                                                          |
| Resend          | `RESEND_WEBHOOK_SECRET`                                                                                                                                                                   | 65      | **SEKRET**             | `POST /api/public/webhooks/resend` zwraca 503, lista wykluczeń nie rośnie, wskaźnik spamu może po cichu przekroczyć próg 0,30% z wytycznych Google - **ryzyko reputacyjne CAŁEJ domeny** |
| Web Push        | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `VITE_VAPID_PUBLIC_KEY`                                                                                                         | 88-91   | sekret + publiczne     | Odczyt: `src/lib/notifications/webpush.server.ts:455-458`. Brak = `processPushJobs` zwraca `skipped: "vapid_not_configured"`                                                             |
| Harmonogram     | `COMMUNITY_CRON_SECRET`                                                                                                                                                                   | 105     | **SEKRET**             | Alternatywa: `job_runner_settings.secret` w bazie - endpoint społeczności przyjmuje oba. Rozliczeń ten sekret NIE otwiera                                                                |
| ElevenLabs      | `ELEVENLABS_API_KEY`                                                                                                                                                                      | 39      | **SEKRET**             | Martwa trasa `/api/tts`                                                                                                                                                                  |
| WordPress.com   | `WORDPRESS_COM_API_KEY`                                                                                                                                                                   | 83      | **SEKRET**             | Brak importu treści                                                                                                                                                                      |
| Adres publiczny | `PUBLIC_SITE_URL` (fallbacki `SITE_URL`, `URL`)                                                                                                                                           | 112-114 | publiczna              | Względne linki w checkoucie i mailach                                                                                                                                                    |
| Tenant          | `TENANT_HOST_ASSERTION_KEY` / `_KID`                                                                                                                                                      | 179-180 | **SEKRET** / publiczna | Ten sam sekret musi trafić do Vaulta: `select public.set_tenant_host_assertion_key('edge1', '<sekret>')`. BEZ KLUCZA degradacja jest w stronę BEZPIECZNĄ                                 |
| Runtime SSR     | `NES_EDGE_CACHE`, `SSR_DOC_GUARD*`, `SSR_DB_DEADLINE_MS`                                                                                                                                  | 122-139 | przełączniki           | Kill switche cache'u i guardów SSR                                                                                                                                                       |

### 3.4 PUŁAPKI: 14 zmiennych używanych w kodzie, których NIE MA w `.env.example`

Środowisko postawione „z przykładu" **uruchomi się bez błędu** i będzie miało martwą
analitykę, osłabiony anty-bruteforce i niedziałający `billing-cron`. To najgroźniejsza
pozycja w całym inwentarzu, bo nie daje żadnego komunikatu.

| Zmienna                                                                       | Miejsce użycia                                                                         | Typ                                  | Co po cichu przestaje działać                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GA4_SERVICE_ACCOUNT_JSON`                                                    | `src/lib/analytics/ga4.server.ts:49`, `status.functions.ts:106`                        | **SEKRET**                           | Raporty GA4 Data API                                                                                                                                                                                       |
| `GA4_OAUTH_CLIENT_ID` / `GA4_OAUTH_CLIENT_SECRET` / `GA4_OAUTH_REFRESH_TOKEN` | `ga4.server.ts:106-108`, `status.functions.ts:123`                                     | **SEKRET** (client_id: konfiguracja) | Alternatywna ścieżka autoryzacji GA4                                                                                                                                                                       |
| `GA4_PROPERTY_ID` / `GA4_MEASUREMENT_ID` / `GA4_EMBED_URL`                    | `ga4.server.ts:145`, `ga4.functions.ts:115`, `status.functions.ts:134`                 | konfiguracja / publiczna             | Identyfikacja property, pomiar po stronie klienta, osadzony raport w panelu                                                                                                                                |
| `GA4_EMBED_URL`                                                               | `status.functions.ts:134`                                                              | konfiguracja                         | Osadzony raport w panelu                                                                                                                                                                                   |
| `GOOGLE_SEARCH_CONSOLE_API_KEY`                                               | `gsc.functions.ts:46`, `status.functions.ts:103`                                       | **SEKRET**                           | Dane GSC (przez gateway Lovable)                                                                                                                                                                           |
| `SESSION_SECRET`                                                              | `bruteforce.functions.ts:18`, `rateSubject.server.ts:16`, `trackingToken.server.ts:28` | **SEKRET**                           | **Fallback na `SUPABASE_SERVICE_ROLE_KEY`** - anty-bruteforce i tokeny śledzenia newslettera dziedziczą klucz serwisowy. Rotacja klucza serwisowego unieważnia je wszystkie                                |
| `OG_REFRESH_SECRET` / `BILLING_CRON_SECRET`                                   | `hooks.refresh-og-image.ts:81`, `billing-cron.ts` (`envSecretMatches`)                 | **SEKRET**                           | Hak odświeżania obrazków OG; `billing-cron` przyjmuje WYŁĄCZNIE własny sekret albo `job_runner_settings.billing_secret` - nigdy `COMMUNITY_CRON_SECRET` ani sekretu runnera (`job_runner_settings.secret`) |
| `OG_REFRESH_LEGACY_SIGNATURES`                                                | `hooks.refresh-og-image.ts:127`, `ogRefreshLegacySignature.ts:49`                      | konfiguracja (wyłącznik)             | `off`/`0`/`false` kończy fazę 1 starego podpisu haka OG przed terminem; brak = faza 1 do 2027-01-01T00:00:00Z, potem **401 bez wdrożenia**. Przedłużenia przez env nie ma                                  |

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

| Co leży w Vaulcie                                                                              | Gdzie odczytywane                                                                                                   | Skutek utraty dostępu do projektu                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Sekrety integracji wychodzących (HubSpot, Slack, generyczny webhook)                           | `src/lib/integrations/formats.ts:8` - _"hubspot: upsert kontaktu przez CRM v3 batch API (Bearer = sekret z Vault)"_ | Sekrety przepadają - **nie ma ich kopii nigdzie indziej**                                                                  |
| Klucz asercji hosta tenanta (`kid` = `edge1`)                                                  | migracja `20260805090000`                                                                                           | Degradacja bezpieczna, ale izolacja tenanta osłabiona                                                                      |
| Sekret runnera zadań (`job_runner_settings.secret`)                                            | `invoke_jobs_tick()`, `invoke_community_cron()`                                                                     | Cron bazy nie autoryzuje puknięć do aplikacji                                                                              |
| Sekret rozliczeń (`job_runner_settings.billing_secret`, migracja `billing_cron_own_secret`)    | `invoke_billing_cron()` -> `billing-cron.ts` (`dbSecretMatches`)                                                    | Dobowe przypomnienia rozliczeniowe z `pg_cron` dostają 401; scheduler repo jedzie własnym `BILLING_CRON_SECRET`            |
| Skrót tokenu sondy (`billing_probe_credentials.token_sha256`, migracja `billing_probe_status`) | `billing_probe_status()` (sonda `billing-nightly.yml`)                                                              | Sonda nie widzi naszej strony - nowy token: `SELECT public.billing_probe_rotate_token();` i podmiana `BILLING_PROBE_TOKEN` |

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

| #   | Poświadczenie               | Warunek bezpieczeństwa                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | `COMMUNITY_CRON_SECRET`     | Zmienić **jednocześnie** w env aplikacji, w GitHub Secrets ORAZ w `job_runner_settings.secret`. Endpoint przyjmuje oba źródła, więc rozjazd nie da błędu - da ciche milczenie kolejki                                                                                                                                                                                                                                                                                                       |
| 9   | `BILLING_CRON_SECRET`       | Własny sekret (bez fallbacku na `COMMUNITY_CRON_SECRET`; wartość równą `COMMUNITY_CRON_SECRET` endpoint odrzuca jako błąd konfiguracji). Zmienić **jednocześnie** w env aplikacji i w GitHub Secrets. `pg_cron` autoryzuje się `job_runner_settings.billing_secret` (rotacja: `UPDATE public.job_runner_settings SET billing_secret = replace(gen_random_uuid()::text \|\| gen_random_uuid()::text, '-', '') WHERE id = 1;` - aplikacja czyta go z bazy, nic więcej nie trzeba przepisywać) |
| 9a  | `BILLING_PROBE_TOKEN`       | `SELECT public.billing_probe_rotate_token();` w SQL editorze zwraca NOWY token jeden raz i unieważnia stary - od razu wpisać go do GitHub Secrets. Między krokami nocna sonda jest czerwona (403 z `billing_probe_status`)                                                                                                                                                                                                                                                                  |
| 10  | `RESEND_WEBHOOK_SECRET`     | Nowy sekret podpisu w panelu Resend **i** w env, w tej kolejności. Między jedną a drugą zmianą webhook zwraca 503 i zdarzenia dostarczalności przepadają bezpowrotnie - okno musi być liczone w minutach                                                                                                                                                                                                                                                                                    |
| 11  | `TENANT_HOST_ASSERTION_KEY` | Nowy `kid` (np. `edge2`), wpis do Vaulta `select public.set_tenant_host_assertion_key('edge2','<sekret>')`, potem podmiana env. Stary `kid` zostawić do czasu potwierdzenia                                                                                                                                                                                                                                                                                                                 |
| 12  | `SESSION_SECRET`            | **USTAWIĆ JAWNIE, jeśli dziś nie jest ustawiony.** Dziś spada na `SUPABASE_SERVICE_ROLE_KEY` - dopóki tak jest, rotacja klucza serwisowego (poz. 15) unieważni liczniki anty-bruteforce i tokeny śledzenia newslettera                                                                                                                                                                                                                                                                      |

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

| Obszar                                                             | Punkt awarii                                                                                              | Objaw                                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **CAŁA poczta wychodząca** - kampanie, transakcyjne, autoryzacyjne | `src/lib/email/provider.server.ts:21,70,120-125` (gateway `https://connector-gateway.lovable.dev/resend`) | Ruch spada na zapasowego dostawcę `@lovable.dev/email-js` (`provider.server.ts:178`), który też wymaga klucza. Efektywnie: zero maili |
| **Płatności**                                                      | `src/lib/stripe.server.ts:14,26` (`https://connector-gateway.lovable.dev/stripe`)                         | Brak checkoutu i odnowień. `src/lib/billing/mockMode.server.ts:16` przełącza się w tryb mock                                          |
| **Tłumaczenia AI, embeddingi, STT**                                | `src/lib/server/aiTranslate.server.ts`, `src/lib/server/embeddings.server.ts`, `src/routes/api/stt.ts`    | Komunikat _"Tłumaczenie AI niedostępne: brak LOVABLE_API_KEY"_. Wyszukiwanie semantyczne bez nowych embeddingów                       |
| **Import WordPress**                                               | `src/lib/wordpress-import.functions.ts:84,97-99` - `throw new Error("LOVABLE_API_KEY is not configured")` | Twardy błąd, nie degradacja                                                                                                           |
| **Google Search Console**                                          | `src/lib/analytics/gsc.functions.ts:12,45-46`                                                             | Brak danych SEO w panelu                                                                                                              |

Klucz Resend **nigdy nie idzie bezpośrednio do `api.resend.com`** - wyłącznie jako nagłówek
`X-Connection-Api-Key` do gatewaya Lovable (`provider.server.ts:120-125`). Posiadanie
własnego klucza Resend nie wystarcza, dopóki kod nie zostanie przepięty (§7.1).

## 6. Odtworzenie środowiska od zera BEZ wykonawcy

### 6.1 Sekwencja, która DZIAŁA DZIŚ (zweryfikowana w CI)

```bash
git clone https://github.com/NewEUStrategies/neweustrategies-dc633fb5.git
cd neweustrategies-dc633fb5

# KROK 1 - OBOWIĄZKOWY. bun.lock wskazuje prywatny rejestr platformy (2026-08-29: 340
# URL-i; 2026-10-26: 2 - ansis, seroval-plugins); bez podmiany `bun install` może dostać
# 403 na tych pakietach. Workflowy CI nie robią już tej podmiany.
sed -E -i 's#https://europe-west[0-9]+-npm\.pkg\.dev/lovable-core-prod/sandbox-npm-cache/#https://registry.npmjs.org/#g' bun.lock

# KROK 2 - instalacja (wersja Buna z .bun-version, ta sama co w CI)
bun install

# KROK 3 - baza: świeża instancja + wszystkie migracje + supabase/seed.sql (440 linii).
# Supabase CLI przypięty do 2.111.0 (job pgtap w ci.yml) - pin jest celowy.
supabase db start

# KROK 4 - testy bazy: wszystkie pliki pgTAP z supabase/tests
supabase test db

# KROK 5 - bramki
bun run verify:blocking            # verify:static + typecheck + lint + test
bun run check:sql-migration-replay # inwariant odtwarzalności bazy od zera
bun run scripts/generate-codeowners.ts --check   # rejestr własnicielstwa i CODEOWNERS
```

**NIE COMMITOWAĆ ZMIENIONEGO `bun.lock`** - podmiana jest wyłącznie na czas instalacji
Docelowe rozwiązanie to pozycja W-4 w §7.

### 6.2 Czego DZIŚ NIE MA i co jest NIEZNANE

| Element                          | Status                  | Co trzeba sprawdzić / napisać                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build produkcyjny                | działa w CI             | `vite.config.ts` importuje `defineConfig` z pakietu `@lovable.dev/vite-tanstack-config` (`2.26.7` w `devDependencies` w `package.json`), który definiuje tanstackStart, viteReact, tailwindcss, tsConfigPaths i nitro. Pakiet jest publiczny: `bun.lock` bierze go z domyślnego rejestru, a job `build` w `.github/workflows/ci.yml` instaluje go i buduje produkcję (`bun run build`); registry.npmjs.org 2026-10-26: 2.26.7, licencja MIT. Zostaje zależność od cudzego pakietu (W-5, L-14)                           |
| Wdrożenie                        | **NIE ISTNIEJE W REPO** | Grep po `deploy\|wrangler\|publish` w `.github/workflows/*.yml` daje wyłącznie komentarze i nazwę joba `post-deploy`. Zero `wrangler deploy`, zero środowisk GitHub. Do napisania: `wrangler.toml`, pipeline build → deploy, mapowanie sekretów produkcyjnych                                                                                                                                                                                                                                                           |
| Stosowanie migracji na produkcji | **NIE ISTNIEJE W REPO** | `SUPABASE_ACCESS_TOKEN` i `SUPABASE_DB_PASSWORD` były na liście `TOOL_CONSUMED` bramki env (usuniętej 2026-10-05 w c3f0c0e72), ale **żaden workflow ich nie używa**. Migracje stosuje platforma, przepisując im wersje - 9 wpisów `reconciled` w `supabase/migration-ledger.json`, `baseline: "20260825230232"`. Od 2026-10-25 platforma wykonuje dziennik drizzle migratorem (lustra `bun run migrations:mirror`), a dowodem wdrożenia jest `drizzle.__drizzle_migrations` (docs/RUNBOOK_MIGRACJE_LOVABLE.md §1, §4.4) |
| Backup produkcji                 | **NIE ISTNIEJE**        | 0 trafień `pg_dump`, 0 `pg_restore`, 0 `supabase db dump` w całym repo. Jedyne backupy to PITR po stronie Supabase - poza repo, bez testu przywrócenia. `supabase db start` odtwarza SCHEMAT + dane deweloperskie, **nie dane produkcyjne**                                                                                                                                                                                                                                                                             |
| Buckety Storage                  | częściowo               | W politykach RLS 7 bucketów: `media`, `cv`, `career-cv`, `chat-attachments`, `club-media`, `member-resources`, `tts-cache`. **Tylko `media` tworzy migracja** - pozostałe 6 trzeba założyć ręcznie                                                                                                                                                                                                                                                                                                                      |
| Supabase Edge Functions          | brak (to dobrze)        | Katalog supabase/functions/ nie istnieje. Cała logika serwerowa żyje w aplikacji na Cloudflare Workers - to upraszcza wyjście                                                                                                                                                                                                                                                                                                                                                                                           |
| Rozszerzenia Postgresa           | wymagane                | 10 rozszerzeń: `pg_cron`, `pg_net`, `supabase_vault`, `pgcrypto`, `pg_trgm`, `btree_gist`, `unaccent`, `vector`, `pgmq`, `pgtap`                                                                                                                                                                                                                                                                                                                                                                                        |

### 6.3 Krok CI, który NIE MA odpowiednika na produkcji

Krok „Allow test role to toggle auth triggers" joba `pgtap` w `.github/workflows/ci.yml`
nadaje roli `postgres` prawo przestawiania triggerów na `auth.users` (właścicielem jest
`supabase_auth_admin`). Dotyczy WYŁĄCZNIE jednorazowej bazy CI - nie ma odpowiednika na
produkcji i nie wynika z żadnej migracji. **NIE PRZENOSIĆ tego kroku na produkcję.**

## 7. Plan wyjścia z platformy

Kolejność wynika z ryzyka: najpierw to, czego brak zatrzymuje przychód i komunikację.
Trudność w skali: **niska** (zmiana konfiguracji), **średnia** (przepisanie kodu w znanych
punktach), **wysoka** (praca projektowa od zera bez wzorca w repo).

| #   | Praca                                                                                                                                         | Punkty w kodzie                                                                                                                                                                                                                                                                                                                                                                                              | Trudność                                    | Ryzyko przy pominięciu                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-1 | **Odcięcie gatewaya poczty** → bezpośrednio do `api.resend.com`. **CZTERY niezależne miejsca wołają ten sam gateway - łatwo przeoczyć jedno** | `src/lib/email/provider.server.ts:21,120-125`; `src/lib/server/email.server.ts:16,53-67`; `src/lib/newsletter.functions.ts:16,88-98`; `src/lib/contact.functions.ts:57,66-76`. Do tego fallback `@lovable.dev/email-js` (`provider.server.ts:178,194`) i webhooki platformy: `src/routes/platform/email/auth/webhook.ts:3-4`, `suppression.ts:13,84-86`                                                      | średnia                                     | Część maili wychodzi starą ścieżką - awaria częściowa, najtrudniejsza do wykrycia                                                                                                                                                         |
| W-2 | **Odcięcie gatewaya płatności** → SDK `stripe` (już w `dependencies` w `package.json`, `^22.6.2`)                                             | `src/lib/stripe.server.ts` (`GATEWAY_STRIPE_BASE`, nagłówek `X-Connection-Api-Key`); `scripts/billing-renewal-probe.ts` (stała `GATEWAY`, ma już nadpisanie `PROBE_GATEWAY_URL`); `src/lib/billing/mockMode.server.ts` (`paymentsConfiguredServer`)                                                                                                                                                          | średnia                                     | Brak przychodu. Bramka `check:entry-purity` (krok „Client boot path free of payment SDKs" joba `build`; od 2026-10-26 na każdym przebiegu CI, także na PR-ach) pilnuje, żeby SDK nie był osiągalny ze startowego chunku - **utrzymać ją** |
| W-3 | **Odcięcie AI** → własny dostawca                                                                                                             | `src/lib/server/aiTranslate.server.ts`; `src/lib/server/embeddings.server.ts`; `src/routes/api/stt.ts`. Najtańsza ścieżka: nadpisania `AI_GATEWAY_URL` / `AI_GATEWAY_EMBEDDINGS_URL` (§3.4) - bez zmiany kodu, o ile nowy dostawca mówi protokołem zgodnym                                                                                                                                                   | niska→średnia                               | Brak tłumaczeń i nowych embeddingów. **Stare embeddingi zostają** - wyszukiwanie semantyczne degraduje się stopniowo, nie od razu                                                                                                         |
| W-4 | **Zastąpienie rejestru npm** - `bun.lock` na stałe na `registry.npmjs.org`                                                                    | 2 wpisy `bun.lock` (`ansis`, `seroval-plugins`) wskazują prywatny rejestr platformy (§6.1). CI ich nie podmienia - instaluje `bun install --frozen-lockfile`; lokalnie podmienia je `sed` z §6.1. Dodatkowo `bunfig.toml:5-6` zwalnia `@lovable.dev/vite-tanstack-config` i `@lovable.dev/mcp-js` z 24-godzinnej blokady supply-chain - **tę furtkę trzeba zamknąć albo zaakceptować na piśmie**             | niska (2 wpisy; sumy `sha512` w `bun.lock`) | Instalacja tych 2 pakietów (także w CI) zależy od cudzej infrastruktury                                                                                                                                                                   |
| W-5 | **Własny build** - wyeliminować `@lovable.dev/vite-tanstack-config` 2.26.7                                                                    | `vite.config.ts`: import `defineConfig` z pakietu, komentarz na początku pliku (co pakiet już zawiera) i obiekt `nitroOptions`. Komentarz nad `nitroOptions` przyznaje, że typy pakietu deklarują tylko podzbiór opcji Nitro, a runtime forwarduje cały obiekt - **repo pracuje wokół nieudokumentowanego zachowania cudzego pakietu**                                                                       | wysoka                                      | Build zależy od cudzego pakietu zwolnionego z 24-godzinnej blokady (L-14); zmiana tego nieudokumentowanego zachowania w nowej wersji może po cichu zmienić build                                                                          |
| W-6 | **Własne wdrożenie** - `wrangler.toml`, pipeline build → Cloudflare Workers, mapowanie sekretów                                               | brak wzorca w repo. Znane: `preset: "cloudflare-module"`, assets z `.output/public/` bindowane przez Wranglera                                                                                                                                                                                                                                                                                               | wysoka                                      | Brak jakiejkolwiek ścieżki wydania                                                                                                                                                                                                        |
| W-7 | **Własne stosowanie migracji** - 918 plików na produkcję                                                                                      | dziś robi to platforma: do 2026-10-25 przepisując wersje (`supabase/migration-ledger.json`), od tego dnia migratorem Drizzle na dzienniku lustra (docs/RUNBOOK_MIGRACJE_LOVABLE.md §1)                                                                                                                                                                                                                       | wysoka                                      | Nie ma czym wdrożyć zmiany schematu                                                                                                                                                                                                       |
| W-8 | **Podmiana zahardkodowanego refa bazy W KODZIE I W DANYCH**                                                                                   | Kod: `src/lib/seo/rootHead.ts:30` (`SUPABASE_PRECONNECT_ORIGIN`), `src/lib/email-templates/icons.tsx:13`, `src/lib/email-templates/nes-layout.tsx:22,24` (logotypy maili), plus testy `txCopy.test.ts:188`, `enhanceImages.test.ts:4`. **Dane: 5 plików migracji** zawiera pełne adresy storage - m.in. `20260727075644_*.sql:24-25` (logo motywu) i `20260804133657_*.sql:5,7` (grafiki popupu newslettera) | wysoka                                      | Przejście na inny projekt Supabase to NIE jest podmiana zmiennej env. Po migracji maile pokazywałyby logo ze starego, cudzego projektu                                                                                                    |
| W-9 | **MCP** - zastąpić `@lovable.dev/mcp-js` albo wygasić serwer                                                                                  | `src/lib/mcp/index.ts:1`; trasy `src/routes/mcp.ts:11`, `[.mcp]/list-tools.ts:10`, `[.mcp]/invoke-tool/$tool.ts:10`, `[.well-known]/oauth-protected-resource.ts:11`; manifest `.lovable/mcp/manifest.json`                                                                                                                                                                                                   | niska                                       | Funkcja poboczna - 3 narzędzia (`search_posts`, `get_post`, `list_recent_posts`)                                                                                                                                                          |

**PUŁAPKA UDOKUMENTOWANA W TYM REPO.** Przy każdej zmianie nazwy sekretu grozi powtórka
incydentu opisanego w nagłówku `.github/workflows/billing-nightly.yml` („HISTORIA TEGO
PLIKU"): workflow eksportował `PADDLE_SANDBOX_API_KEY`, a sonda czytała
`STRIPE_SANDBOX_API_KEY` - job co dobę spał 40 minut, kończył się na zielono i nie
wykonywał ŻADNEGO żądania. Bramkę `check:workflow-env-contract` usunięto 2026-10-05
(c3f0c0e72). Dla skryptów nocnej sondy i schedulera tę klasę błędu łapie dziś test
`src/lib/ci/__tests__/workflowOperationalConfig.test.ts` (każda zmienna `env:` kroku ma
odbiorcę w skrypcie, a każdy sekret, którego skrypt wymaga, jest eksportowany). **TEN TEST
TRZEBA UTRZYMAĆ** i rozszerzać o każdy nowy krok uruchamiający skrypt z sekretami.

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
      Stripe + Resend (`{PUBLIC_SITE_URL}/api/public/webhooks/resend`, 6 zdarzeń z komentarza
      przy `RESEND_WEBHOOK_SECRET` w `.env.example`).
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

**WNIOSEK OPERACYJNY:** przy spłaszczonej historii commitów rejestr migracji to jedyne
narzędzie datowania regresji, jakie zostaje audytowi.

Jedynym rzetelnym zapisem „kiedy co weszło" jest zatem para:
`supabase/migration-ledger.json` (plik → wersja faktycznie wykonana) oraz tabela
`supabase_migrations.schema_migrations` w żywej bazie, porównywane bramką
`bun run check:migration-ledger` przez RPC `missing_migration_versions`
(job `post-deploy` w `.github/workflows/ci.yml`). **NIE KASOWAĆ ani nie przepisywać `migration-ledger.json`** - to
audytowalny dziennik zmian schematu sprzed 2026-10-25.

Od 2026-10-25 dowodem wdrożenia jest rejestr migratora `drizzle.__drizzle_migrations`
(hash pliku i `when` wpisu dziennika, sprawdzane `bun run migrations:deploy-sql -- --verify`),
a `supabase_migrations.schema_migrations` jest historyczny i nikt go już nie uzupełnia
(docs/RUNBOOK_MIGRACJE_LOVABLE.md §1, §4.4).

Rekompensata: repo jest wyjątkowo dobrze udokumentowane wewnętrznie - **124 dokumenty
w `docs/`** plus komentarze w migracjach i workflow opisujące konkretne incydenty
produkcyjne z datami. To realnie obniża koszt przejęcia.

## 9. Ćwiczenie procedury - żeby runbook nie był martwy

Runbook, którego nikt nie wykonał, jest wart tyle co jego brak. Poniższy test jest tani
(jedna osoba, jedna sesja) i wykrywa dokładnie te awarie, które zabijają przejęcie.

### 9.1 Test kwartalny „zimny start"

| Krok | Komenda / czynność                                                                                                                                                   | Kryterium zaliczenia                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Sklonuj repo na **czystą maszynę**, bez cache'u i bez konta wykonawcy                                                                                                | klon się powiódł                                                                                                                   |
| 2    | `sed` z §6.1 + `bun install`                                                                                                                                         | instalacja bez `403`                                                                                                               |
| 3    | `supabase db start`                                                                                                                                                  | wszystkie migracje przechodzą od zera                                                                                              |
| 4    | `supabase test db`                                                                                                                                                   | wszystkie pliki pgTAP zielone                                                                                                      |
| 5    | `bun run verify:blocking`                                                                                                                                            | zielone                                                                                                                            |
| 6    | `bun run scripts/generate-codeowners.ts --check`                                                                                                                     | zielone; pokrycie tras i migracji rejestrem - przegląd ręczny (bramkę `check:ownership` usunięto 2026-10-05)                       |
| 7    | `bun run test src/lib/ci/__tests__/workflowOperationalConfig.test.ts src/lib/ci/__tests__/billingWorkflowSecrets.test.ts src/lib/ci/__tests__/docReferences.test.ts` | zielone (kontrakt env skryptów workflow, sekrety rozliczeń, odwołania runbooków; zastępuje usuniętą `check:workflow-env-contract`) |
| 8    | Sonda `GET /api/public/community-cron`                                                                                                                               | `200`                                                                                                                              |
| 9    | Zaloguj się do KAŻDEGO panelu z §3.6 kontem Zamawiającego, bez pomocy wykonawcy                                                                                      | 10/10 paneli                                                                                                                       |
| 10   | Odczytaj jeden sekret z Supabase Vault                                                                                                                               | odczyt się powiódł                                                                                                                 |

**Kryterium całości: kroki 1-10 wykonane przez jedną osobę w jednej sesji, bez kontaktu
z wykonawcą.** Każdy krok, który wymagał pytania do wykonawcy, jest LUKĄ - wpisz ją do §10.

### 9.2 Test roczny „przywrócenie danych"

Raz w roku, po włączeniu i udokumentowaniu backupu (luka L-3): odtworzyć bazę z kopii na
osobnym projekcie i potwierdzić, że aplikacja startuje na tych danych. **DZIŚ TEGO TESTU
NIE DA SIĘ WYKONAĆ** - nie ma z czego przywracać.

### 9.3 Kontrola ciągła (bez wysiłku)

- Pokrycia rejestru własnicielstwa NIE pilnuje żadna bramka (usunięta 2026-10-05, luka L-6)
  - regresję własnicielstwa łapie przegląd PR-a.
- Progi-zapadki z `governance/ownership.json` (2026-10-26): `domenyBezWlasciciela` **0**,
  `migracjeBezAtrybucjiDozwolone` **6 pozycji**, `martweWzorceTras` **0**. **TE PROGI WOLNO WYŁĄCZNIE ZACIEŚNIAĆ** -
  podniesienie jest regresją i wymaga osobnej decyzji Zamawiającego.
- Aktualizacja daty przeglądu tego dokumentu przy każdym ćwiczeniu.

## 10. Rejestr decyzji i luk otwartych

Stan na **2026-08-29**, aktualizacja 2026-10-26: L-2, L-4, L-6, L-7, L-9, L-12, L-13. Kolumna „Kto odblokowuje" nie jest sugestią - to przypisanie
odpowiedzialności.

| ID       | Luka                                                                                                                                                              | Dowód                                                                                                                                                                                                     | Skutek                                                                                                                               | Kto odblokowuje                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **L-1**  | `docs/UMOWA_UTRZYMANIOWA.md` istnieje, ale sam deklaruje: **„TO NIE JEST DOKUMENT PRAWNY"** - warunki handlowe, kary umowne i wypowiedzenie są poza jego zakresem | `docs/UMOWA_UTRZYMANIOWA.md:1-8`                                                                                                                                                                          | Progi i klasy SLA z §1.1 nie mają umocowania w umowie handlowej                                                                      | **Zamawiający** (`office@neweuropeanstrategies.com`)                                    |
| **L-2**  | ZAMKNIĘTA - `governance/README.md` istnieje                                                                                                                       | rejestr wskazuje go w `meta.jakEdytowac`                                                                                                                                                                  | -                                                                                                                                    | **Zamawiający** + wykonawca zastępczy                                                   |
| **L-3**  | **BRAK PROCEDURY BACKUPU**                                                                                                                                        | 0 trafień `pg_dump`, 0 `pg_restore`, 0 `supabase db dump` w całym repo. Słowo „backup" w `docs/` występuje raz - `ARCHITECTURE.md:778` jako nazwa tabeli `suppressed_emails_legacy_backup`, nie procedura | Dane produkcyjne (treści, użytkownicy, zamówienia, CRM, darowizny) **nie są odtwarzalne**. Nie wiadomo nawet, czy PITR jest włączony | **Zamawiający** - decyzja o planie Supabase; wykonawca zastępczy - procedura i test     |
| **L-4**  | Domeny obsadzone formalnie (od 2026-09-12), bus factor osobowy otwarty                                                                                            | `governance/ownership.json`: 9 z 9 domen - `fundacja-utrzymanie` / `fundacja-zastepstwo`, dwie role instytucjonalne jednej organizacji (`governance/README.md`, §7)                                       | Zgłoszenie ma adresata instytucjonalnego, nie osobę                                                                                  | **Zamawiający** - wskazuje osoby                                                        |
| **L-5**  | Brak wykonawcy w rejestrze                                                                                                                                        | `kontraktUtrzymaniowy.wykonawca = "NIEOBSADZONE"`                                                                                                                                                         | jw.                                                                                                                                  | **Zamawiający**                                                                         |
| **L-6**  | Bramki `check:ownership` **NIE MA** - usunięta z `package.json` i CI 2026-10-05 (c3f0c0e72)                                                                       | `package.json` nie ma skryptu; zostały `src/lib/ci/ownership.ts` (parser, atrybucja) i `bun run scripts/generate-codeowners.ts --check`                                                                   | Regresja własnicielstwa przejdzie niezauważona, jeśli nie złapie jej przegląd PR-a                                                   | **Zamawiający** - decyzja o przywróceniu pomiaru                                        |
| **L-7**  | Brak `dependabot.yml` i szablonu PR; `.github/CODEOWNERS` ma 82 aktywne reguły, wszystkie na jedno konto `@NewEUStrategies`                                       | `.github/` zawiera `CODEOWNERS` (z `bun run generate:codeowners`, zgodny z rejestrem) i 10 workflowów; `zespolGithub` każdej domeny w `governance/ownership.json` = `@NewEUStrategies`                    | CODEOWNERS nie rozdziela przeglądu między domeny; brak automatycznych aktualizacji przy 112 bezpośrednich zależnościach npm          | wykonawca zastępczy; podział przeglądu na domeny wymaga osób albo zespołów z L-4        |
| **L-8**  | 14 zmiennych produkcyjnych poza `.env.example`                                                                                                                    | §3.4, weryfikacja przez `process.env` w `src/` i `scripts/`                                                                                                                                               | Środowisko „z przykładu" ma martwą analitykę i osłabiony anty-bruteforce - **bez komunikatu błędu**                                  | wykonawca zastępczy                                                                     |
| **L-9**  | ZAMKNIĘTA 2026-10-26 - `@lovable.dev/vite-tanstack-config` jest publicznie dostępny                                                                               | `bun.lock` bierze 2.26.7 z domyślnego rejestru; job `build` w `.github/workflows/ci.yml` instaluje go i buduje produkcję; npm: licencja MIT (§6.2)                                                        | -                                                                                                                                    | -                                                                                       |
| **L-10** | Brak pipeline'u wdrożenia i stosowania migracji                                                                                                                   | 0 kroków wdrożenia w `.github/`; `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD` w `TOOL_CONSUMED`, ale nieużywane                                                                                         | Brak ścieżki wydania kodu i schematu                                                                                                 | wykonawca zastępczy (prace W-6, W-7 z §7)                                               |
| **L-11** | Zahardkodowany ref `unnltowbgszpdzwpawdu` w kodzie i danych                                                                                                       | `src/lib/seo/rootHead.ts:30`, `src/lib/email-templates/icons.tsx:13`, `nes-layout.tsx:22,24`, 5 plików migracji                                                                                           | Migracja na inny projekt Supabase wymaga zmiany kodu **i danych**                                                                    | wykonawca zastępczy (praca W-8)                                                         |
| **L-12** | Bezpieczniki właścicielskie w 2 workflow                                                                                                                          | warunek `if` joba `tick` w `scheduler.yml` i joba `renewal` w `billing-nightly.yml`                                                                                                                       | Przeniesienie repo do innej organizacji **zatrzyma harmonogramy bez błędu**                                                          | wykonawca zastępczy - zamienić literał na `vars.*` przed jakąkolwiek zmianą właściciela |
| **L-13** | GitHub gasi zaplanowane workflow po 60 dniach bezczynności                                                                                                        | nagłówek `.github/workflows/scheduler.yml` („Uwaga operacyjna")                                                                                                                                           | W okresie przestoju - dokładnie w scenariuszu tego runbooka - siatka zewnętrzna umiera po cichu                                      | dyżur operacyjny - dowolna aktywność w repo raz na 60 dni                               |
| **L-14** | `bunfig.toml:5-6` zwalnia 2 pakiety platformy z 24-godzinnej blokady supply-chain                                                                                 | `minimumReleaseAgeExcludes`                                                                                                                                                                               | Przyspieszona ścieżka cudzego kodu do buildu                                                                                         | **Zamawiający** - świadome zamknięcie albo akceptacja na piśmie                         |

## 11. Przegląd dokumentu

Sporządzono **2026-08-29** na podstawie audytu z tego samego dnia (193 trasy
`src/routes/admin*.tsx`, 918 migracji `supabase/migrations/*.sql`, rejestr
`governance/ownership.json`: 9 domen, 75 wzorców tras, 186 reguł prefiksów bazy).
Następny przegląd: po pierwszym ćwiczeniu kwartalnym (§9.1), nie później niż
**2026-11-29**. Twardy termin przeglądu umownego: **2027-07-02** (`obowiazujeDo`
2027-08-31 minus `ostrzegajOdDni` 60). Właściciel dokumentu: **DO UZUPEŁNIENIA** -
wskazuje Zamawiający (§1.3).
