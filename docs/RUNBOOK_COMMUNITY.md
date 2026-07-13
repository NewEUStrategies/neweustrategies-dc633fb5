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
jedynie PUKA do aplikacji. Są dwa równoważne wejścia (oba idempotentne -
claimy atomowe w Postgresie; mogą działać równolegle):

| Endpoint | Sekret | Kto woła | Zakres |
| --- | --- | --- | --- |
| `POST /api/public/jobs-tick` | nagłówek `x-jobs-secret` = `job_runner_settings.secret` (tabela, admin: Newsletter → kampanie) | **pg_cron + pg_net co minutę** (migracja `20260713170000`) | newsletter + push + digesty (daily/weekly) + przypomnienia o wydarzeniach |
| `POST /api/public/community-cron` | nagłówek `x-community-cron-secret` = env `COMMUNITY_CRON_SECRET` | dowolny zewnętrzny scheduler (GitHub Actions, cron-job.org, uptime robot) - **fallback/ręczne** | `?job=all\|push\|digest-daily\|digest-weekly\|event-reminders` |

**Stan pożądany:** działa ścieżka pg_cron→jobs-tick (zero zewnętrznych
zależności). `community-cron` zostaje jako ręczny wyzwalacz i plan B dla
środowisk bez `pg_net`.

### Checklist uruchomieniowy

1. `job_runner_settings` (id=1): `enabled=true`, `secret` ustawiony,
   `base_url` = publiczny adres aplikacji (panel admin newslettera pokazuje
   stan i pozwala wygenerować sekret).
2. pg_cron + pg_net włączone w projekcie Supabase (Database → Extensions);
   migracja `20260713170000` sama zakłada job co minutę, gdy rozszerzenia są.
3. Env aplikacji (patrz `.env.example`): `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `VITE_VAPID_PUBLIC_KEY` (push);
   `LOVABLE_API_KEY` + `RESEND_API_KEY` (digest/e-maile);
   `COMMUNITY_CRON_SECRET` (tylko jeśli używasz fallbacku).
4. Weryfikacja ręczna:
   ```bash
   curl -X POST "$BASE_URL/api/public/community-cron?job=all" \
     -H "x-community-cron-secret: $COMMUNITY_CRON_SECRET"
   # oczekiwane: {"ok":true,"push":{...},"digestDaily":{...},...}
   ```
5. Monitoring kolejki (SQL, service role):
   ```sql
   SELECT status, count(*) FROM notification_push_queue GROUP BY status;
   -- rosnące 'pending' przy działającym cronie = brak VAPID env albo tick nie dochodzi
   SELECT count(*) FROM push_subscriptions WHERE failed_at IS NULL; -- żywe urządzenia
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
  pg_cron (`event-reminders`, 5 * * * *) oraz oba endpointy ticku.
- **Kręgi**: limit 50 osób, kandydaci filtrowani serwerowo (blokady,
  `allow_messages_from`); tryb cichy członka nie zatrzymuje wiadomości
  grupy (guard zawężony do 1:1 w `20260713200000`).

## 5. Testy

- `bun run test` - Vitest (w tym parity i18n PL/EN, krypto push roundtrip).
- `supabase test db` - pgTAP: RLS/RPC wszystkich tabel społeczności
  (`community_*_test.sql`), wyścig o miejsca RSVP, rate limity, kanoniczny
  potok push/digest. CI odpala to w jobie `pgtap`.
