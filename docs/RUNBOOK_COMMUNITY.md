# Runbook: operacje modułu społeczności

Operacyjna instrukcja dla kanałów doręczeń (web push, e-mail digest,
przypomnienia o wydarzeniach) oraz zadań tła modułu społeczności. Uzupełnia
`docs/ARCHITECTURE.md` (architektura) i `supabase/tests/README.md` (testy).

## 1. Architektura doręczeń - jeden kanoniczny potok

```
zdarzenie domenowe (trigger SQL)
  └─> enqueue_notification(...)            – preferencje per rodzaj, dedup 5 min
        └─> notifications (in-app, realtime)
              └─> trigger tg_notifications_enqueue_push
                    – TYLKO gdy push_enabled=true ORAZ istnieje żywa
                      subskrypcja (push_subscriptions.failed_at IS NULL)
                    └─> notification_push_queue
                          └─> claim_push_jobs (SKIP LOCKED, backoff)  ┐
e-mail digest: notification_preferences.email_digest (off/daily/weekly)│ APLIKACJA
  └─> claim_due_digests (stempel digest_last_sent_at, SKIP LOCKED)    │ (Node env:
przypomnienia: run_event_reminders (reminded_at = raz na RSVP)        ┘  VAPID_*, RESEND)
```

Historycznie istniał równoległy, zdublowany potok (`push_outbox`,
`claim_due_digest_users`, kolumny `ua`/`disabled_at`/`email_digest_frequency`).
Migracja `20260713210000_notifications_pipeline_reconciliation.sql` usuwa go
i migruje wartości preferencji - **nie przywracać**; wszystkie zmiany robić
w potoku kanonicznym (`20260713092000_notification_channels.sql`).

## 2. Harmonogram - kto woła doręczenia

SQL w cronie nie może wysyłać HTTP z sekretami środowiska, więc pg_cron
jedynie PUKA do aplikacji. Są TRZY równoważne wejścia (wszystkie idempotentne -
claimy atomowe w Postgresie; mogą działać równolegle):

| Endpoint                          | Sekret                                                                                                                 | Kto woła                                                                                                                                                                                        | Zakres                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /api/public/jobs-tick`      | nagłówek `x-jobs-secret` = `job_runner_settings.secret`                                                                | **pg_cron + pg_net co minutę** (migracje `20260713170000`, `20260731110000`)                                                                                                                    | newsletter + push + digesty + przypomnienia (wydarzenia, follow-upy CRM) + linki + integracje |
| `POST /api/public/community-cron` | nagłówek `x-community-cron-secret` = env `COMMUNITY_CRON_SECRET` **albo** `job_runner_settings.secret` (jeden z dwóch) | **pg_cron + pg_net co 5 min, minuty 2,7,12,…** (migracja `20260731210000`, `invoke_community_cron`) + **GitHub Actions co 5 min** (`.github/workflows/scheduler.yml`) + dowolny cron zewnętrzny | `?job=all\|push\|digest-daily\|digest-weekly\|event-reminders\|crm-task-reminders`            |
| przycisk „Uruchom tick teraz"     | sesja admin/edytor (`requireAdminEditor`)                                                                              | operator: /admin/community/notifications, /admin/tracker                                                                                                                                        | to samo co `jobs-tick` (ta sama funkcja `runJobsTick`)                                        |
| `GET /api/public/community-cron`  | jak wyżej                                                                                                              | monitoring zewnętrzny (uptime robot)                                                                                                                                                            | sonda zdrowia bez efektów ubocznych: `200` = OK, `503` = zastój                               |

**Ścieżka podstawowa:** pg_cron → `jobs-tick` (co minutę, zero zewnętrznych
zależności). **Siatka bezpieczeństwa w bazie:** pg_cron → `community-cron`
(co 5 minut, minuty 2,7,12,… - przeplot z oknem digestów jobs-tick; drenuje
WYŁĄCZNIE kanały społeczności, więc działa nawet gdy budżet 25 s jobs-tick
zjada kampania newslettera). **Siatka zewnętrzna:** scheduler w repo (co 5
minut, jeden przebieg = 4 ticki po 60 s; GitHub wyłącza go po 60 dniach bez
aktywności). Przycisk w panelu jest dla dyżuru.

### Samozbrojenie (dlaczego to kiedyś nie działało)

`job_runner_settings` rodzi się z `enabled=false` i `base_url=''`, więc
`invoke_jobs_tick()` wychodził natychmiast: **cron tykał w próżnię, a kolejka
push rosła w `pending`**. Migracja `20260731110000` zamyka tę dziurę:

- **dziewiczy wiersz** (brak stempla `auto_armed_at`, wyłączony, pusty URL)
  uzbraja się sam - z domeny domyślnego tenanta (`resolve_job_runner_base_url`)
  albo z origin-u PIERWSZEGO ticku z dowolnej ścieżki (`arm_job_runner`;
  scheduler repo i przycisk w panelu przekazują tam swój adres). Innymi słowy
  ścieżka repo BOOTSTRAPUJE ścieżkę podstawową;
- **decyzja operatora jest nienaruszalna**: po stemplu `auto_armed_at` (albo po
  ręcznej zmianie w panelu) samozbrojenie nigdy się nie powtarza, więc świadome
  wyłączenie runnera zostaje wyłączone;
- adres musi być `https` bez hosta lokalnego - cron bazy produkcyjnej nie ma
  po co pukać do `localhost`.

### Jedna telemetria runnera (pojednanie dwóch zmian z 2026-07-31)

Tego samego dnia dwie niezależne zmiany przepisały `invoke_jobs_tick()`:
harmonogram doręczeń (`20260731110000`: samozbrojenie, `last_invoked_at`,
nagłówek `x-cron-source`) i unifikacja poczty (`20260731081100` +
`20260731120000`: `last_tick_at` / `last_tick_status` / `last_tick_error` /
`tick_count`, resolver `job_runner_base_url()`). Migracje są forward-only, więc
wygrała ostatnia - i wraz z nią wróciła pierwotna awaria (bez samozbrojenia
dziewiczy wiersz zostaje `enabled=false`). `20260731130000` składa JEDNĄ
funkcję z obu wkładów:

- `job_runner_base_url()` jest kanonicznym resolverem (utwardzonym o odrzucanie
  hostów lokalnych), a `resolve_job_runner_base_url()` tylko do niego deleguje -
  dwie nazwy, jedno zachowanie;
- każde wyjście z `invoke_jobs_tick()` stempluje POWÓD: `disabled`,
  `no_secret`, `no_base_url`, `pg_net_unavailable`, `error` - panel odpowiada
  „dlaczego nie ma ticku" zamiast milczeć;
- udane puknięcie stempluje `last_invoked_at` ORAZ `last_tick_at`/`tick_count`,
  więc obie powierzchnie (panel newslettera i panel doręczeń) mówią to samo;
- `invoke_billing_cron()` używa tego samego resolvera (wcześniej czytał surowy
  `base_url`, więc przy adresie z domeny tenanta nie ruszał).

### Obserwowalność: log przebiegów i panel zdrowia

`pg_net` jest fire-and-forget, więc bez logu nie da się odróżnić „nikt nie woła
dyspozytora" od „nie ma czego wysyłać". Każdy przebieg (cron, repo, panel)
zapisuje wiersz w `public.job_runner_runs` (source, job, `ok`, czas, wynik,
błąd; rotacja 14 dni) i stempluje heartbeat w `job_runner_settings`
(`last_invoked_at` = cron puknął, `last_app_run_at` / `last_app_ok_at` =
aplikacja odpowiedziała, `failure_streak`), obok telemetrii samego crona
(`last_tick_status` / `last_tick_error` / `tick_count` dla jobs-tick;
`community_last_tick_*` / `community_tick_count` dla siatki społeczności -
rozjazd tych dwóch statusów lokalizuje awarię konkretnej ścieżki).

Alert **„cron puka, aplikacja nie odpowiada"** porównuje puknięcie (z
KTÓREJKOLWIEK ścieżki bazy: jobs-tick albo community-cron, tylko status
`dispatched`) z ostatnim przebiegiem ZE ŹRÓDŁA `pg_cron`, nie z globalnym
heartbeatem - ten stempluje każde źródło, więc scheduler repo (co 5 min) albo
ręczny tick z panelu maskowałby martwą ścieżkę podstawową.

**Panel: /admin/community/notifications** (RPC `job_scheduler_health()`,
admin/edytor - ta sama bramka co w RPC; autor jej nie widzi)
pokazuje: świeżość ostatniego udanego przebiegu (`fresh` ≤ 6 min,
`lagging` ≤ 20 min, dalej `stale`), stan każdej ścieżki, rejestr zadań pg_cron,
głębokość kolejki push i wiek najstarszego `pending` w Twoim tenancie, digesty
na wejściu, brakujące env (VAPID / gateway e-mail) oraz log ostatnich 20
przebiegów oraz powód pominięcia puknięcia (zły `base_url`, zły sekret, brak
pg_net, świadome wyłączenie).

### Checklist uruchomieniowy

1. pg_cron + pg_net włączone w projekcie Supabase (Database → Extensions).
   Migracja `20260731110000` zakłada/reaktywuje zadania (`jobs-tick` co minutę,
   `billing-cron-daily` o 04:25 UTC, `prune-job-runner-runs`) także wtedy, gdy
   rozszerzenia włączono PÓŹNIEJ niż pierwotną migrację; `20260731210000`
   dokłada `community-cron` (co 5 minut, minuty 2,7,12,…) - siatkę
   społeczności niezależną od repo i od budżetu jobs-tick.
2. `job_runner_settings` (id=1): `enabled=true`, `secret` ustawiony, `base_url`
   = publiczny adres aplikacji. Zwykle nie trzeba nic robić (samozbrojenie);
   ręcznie: panel Newsletter → kampanie → „Automatyczna wysyłka (cron)".
3. Scheduler repo (Settings → Secrets and variables → Actions):
   `variables.APP_BASE_URL` = `https://…` oraz `secrets.COMMUNITY_CRON_SECRET`
   (env aplikacji ALBO `job_runner_settings.secret` - endpoint przyjmuje oba).
   Bez tej pary workflow kończy się zielono z ostrzeżeniem, nic nie wysyła.
   Uwaga: GitHub wyłącza zaplanowane workflow po 60 dniach bez aktywności w
   repo - dlatego to siatka bezpieczeństwa, nie ścieżka podstawowa.
4. Env aplikacji (patrz `.env.example`): `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `VITE_VAPID_PUBLIC_KEY` (push);
   `LOVABLE_API_KEY` + `RESEND_API_KEY` (digest/e-maile). Brak kluczy VAPID nie
   jest już cichy: `processPushJobs` zwraca `skipped: "vapid_not_configured"`,
   panel i podsumowanie przebiegu Actions mówią to wprost.
5. Weryfikacja ręczna:

   ```bash
   # tick (job z query albo z body; brak = all)
   curl -X POST "$BASE_URL/api/public/community-cron?job=all" \
     -H "x-community-cron-secret: $COMMUNITY_CRON_SECRET"
   # oczekiwane: {"ok":true,"job":"all","durationMs":…,"push":{…},"digestDaily":{…},…}

   # sonda zdrowia (200 = OK, 503 = zastój)
   curl -i "$BASE_URL/api/public/community-cron" \
     -H "x-community-cron-secret: $COMMUNITY_CRON_SECRET"

   # to samo lokalnie, z pętlą i ponowieniami (bez instalacji zależności)
   SCHEDULER_BASE_URL="$BASE_URL" SCHEDULER_SECRET="$COMMUNITY_CRON_SECRET" \
     bun run cron:tick
   ```

6. Monitoring kolejki (SQL, service role):
   ```sql
   SELECT status, count(*) FROM notification_push_queue GROUP BY status;
   -- rosnące 'pending' przy działającym cronie = brak VAPID env albo tick nie dochodzi
   SELECT count(*) FROM push_subscriptions WHERE failed_at IS NULL; -- żywe urządzenia
   SELECT source, max(created_at) AS last_at, count(*) FILTER (WHERE NOT ok) AS fails
     FROM job_runner_runs WHERE created_at > now() - interval '24 hours' GROUP BY source;
   -- brak wiersza dla 'pg_cron' = ścieżka podstawowa nie żyje (patrz panel zdrowia)
   ```

## 3. Web push - weryfikacja na realnych urządzeniach

Krypto (VAPID ES256 + aes128gcm wg RFC 8291) jest pokryte testem roundtrip
(`src/lib/notifications/__tests__/webpush.test.ts`), ale przed ogłoszeniem
funkcji trzeba potwierdzić dostarczanie na żywych usługach push:

1. Wygeneruj klucze: `generateVapidKeys()` z
   `src/lib/notifications/webpush.server.ts` (np. `bun repl`), wstaw do env.
2. Na urządzeniu: zaloguj się → `/messages` → zakładka Zgody → włącz
   „Powiadomienia push w tej przeglądarce" (rejestruje `public/push-sw.js`).
3. Wywołaj zdarzenie (np. wyślij wiadomość z drugiego konta przy zamkniętej
   karcie) albo wstaw powiadomienie SQL-em, potem odpal tick.
4. Matryca minimalna: Chrome desktop (FCM), Firefox desktop (Mozilla
   autopush), Android Chrome (FCM), iOS 16.4+ Safari **po dodaniu do ekranu
   głównego** (Apple Push). iOS bez PWA nie wspiera web push.
5. Diagnoza błędów: wpisy `dead` w `notification_push_queue` + `last_error`;
   endpointy 404/410 dostają `failed_at` (subskrypcja martwa - urządzenie
   musi włączyć push ponownie).

Inwarianty doręczania (`src/lib/notifications/dispatch.server.ts`), przydatne
przy diagnozie:

- **Kolejka per urządzenie**: wysyłki do jednego endpointu idą po kolei
  (kolejność powiadomień na urządzeniu zachowana), a 8 urządzeń naraz. Pierwsze
  404/410 ucina resztę kolejki tego endpointu bez ruchu sieciowego.
- **Filtr tenanta**: subskrypcje są dobierane po `(tenant_id, user_id)` zadania.
  To samo konto zapisane na dwóch domenach NIE dostaje powiadomień obcego
  tenanta - nie usuwać `.in("tenant_id", …)` z zapytania o `push_subscriptions`
  (rola serwisowa omija RLS, ten filtr jest jedyną granicą).
- **Budżet 4096 B** (RFC 8030): jawny JSON ma limit 3993 B, dispatcher przycina
  najpierw treść, potem tytuł (na granicy znaku UTF-8, więc polskie diakrytyki
  nie pękają). Payload ponad budżet dostaje `dead` od razu, bez 8 retry.
- **Kolaps wątku**: nagłówek `Topic` + `tag` w payloadzie = skrót
  (`kind`, `href`). Urządzenie po dniu offline budzi się jednym powiadomieniem
  na wątek. Powtarzające się powiadomienie o tym samym celu jest oczekiwane
  jako podmiana, nie jako brak dostawy.
- **`Retry-After`** z 429/503 leci do logu (`push throttled`) - rosnące wpisy
  oznaczają, że partie są za duże dla usługi push, nie że krypto jest zepsute.

## 4. Wydarzenia, Q&A, ankiety - inwarianty operacyjne

- **Zapisy wyłącznie przez RPC** (`rsvp_event`, `ask_qa_question`,
  `vote_poll`, `create_group_conversation`…) - polityki-zalążki bezpośrednich
  INSERT-ów zostały usunięte (`20260713200000`). Nie przywracać grantów
  INSERT na `event_rsvps`/`poll_votes`.
- **Benefity warstw są egzekwowane w bazie**: `visibility='members'` wymaga
  rangi ≥1; `kind='briefing'` + members wymaga flagi `pro_briefings`;
  priorytet pytań Q&A czyta flagę `qa_priority`. Flagi edytuje admin
  (Membership → features JSON) - usunięcie flagi z warstwy natychmiast
  odbiera dostęp.
- **Przypomnienia o wydarzeniach**: `run_event_reminders()` wysyła raz
  (stempel `reminded_at`) dla RSVP `going` na <24 h przed startem; woła je
  pg_cron (`event-reminders`, 5 \* \* \* \*) oraz oba endpointy ticku.
- **Lista rezerwowa** (`20260721150000`): komplet miejsc nie odrzuca
  chętnych - `rsvp_event` degraduje `going` do `waitlist` (kolejka FIFO po
  `waitlisted_at`, pozycja stabilna przy ponowieniach). Zwolnienie miejsca
  (rezygnacja z `going` albo podniesienie `capacity` w adminie) awansuje
  czoło kolejki i wysyła powiadomienie "Masz miejsce". Awans zeruje
  `reminded_at`, więc przypomnienie <24 h nadal wyjdzie. Klient nigdy nie
  żąda statusu `waitlist` wprost; pozycję podaje
  `get_event_waitlist_position`.
- **Nagrania za bramką warstwy** (`20260721150000`): `get_event_access`
  oddaje `recording_url` tylko przy fladze `recordings` warstwy (lub staff);
  `watch_reason` (`ok`/`none`/`auth_required`/`tier_required`) steruje
  upsellami w UI. Usunięcie flagi z warstwy natychmiast zamyka nagrania.
- **Podsumowania sesji Q&A** (`20260721151000`): `publish_qa_session_summary`
  (staff lub host; sesja `answering`/`closed`, min. 1 odpowiedziane pytanie)
  kompiluje odpowiedzi w dwujęzyczny wpis spięty przez `qa_sessions.post_id`
  - idempotentny upsert (ponowne uruchomienie odświeża treść, nie duplikuje;
    publikacja jest jednokierunkowa). Publikacja respektuje workflow
    redakcyjny (`can_publish_content` - host/edytor kompiluje szkic, publikuje
    admin) i powiadamia autorów pytań. Wpis ląduje pod stroną `blog` tenanta
    (posts.parent_page_id). Panel: Admin → Community → Q&A → ikona
    "Podsumowanie jako treść".
- **Reputacja i tablica kontrybutorów** (`20260721152000`): punkty liczone
  z istniejących danych (`contribution_scores` - wagi w jednym CASE),
  tablica `/contributors` przez `get_contributor_leaderboard` pokazuje
  wyłącznie profile `discoverable=true` i pomija konta redakcyjne; własny
  wynik przez `get_my_reputation` widzi każdy zalogowany. Progi poziomów:
  `src/lib/community/reputation.ts` (prezentacja, nie DB).
- **Kręgi**: limit 50 osób, kandydaci filtrowani serwerowo (blokady,
  `allow_messages_from`); tryb cichy członka nie zatrzymuje wiadomości
  grupy (guard zawężony do 1:1 w `20260713200000`).

## 5. Testy

- `bun run test` - Vitest (w tym parity i18n PL/EN, krypto push roundtrip).
- `supabase test db` - pgTAP: RLS/RPC wszystkich tabel społeczności
  (`community_*_test.sql`), wyścig o miejsca RSVP, rate limity, kanoniczny
  potok push/digest. CI odpala to w jobie `pgtap`.
