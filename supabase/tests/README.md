# Testy bazy danych (pgTAP)

Testy SQL warstwy danych Supabase - RLS (izolacja tenantów), przypięcie
`profiles.tenant_id` oraz pełnotekstowe wyszukiwanie. Dopełniają testy
jednostkowe Vitest (`bun run test`), które nie dotykają realnego Postgresa
ani polityk RLS.

## Pliki

| Plik                                   | Co weryfikuje                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rls_tenant_isolation_test.sql`        | „user tenanta A nie czyta postów B" (RLS na `public.posts`, szkice i opublikowane) oraz „UPDATE `tenant_id` jest ignorowany" (trigger `profiles_pin_tenant`).                                                                                                                                                                                                                                                                                                                                                                                                  |
| `search_tsquery_test.sql`              | `public.nes_search_tsquery` - unaccent + lower, prefiks `:*`, łączenie AND, sanityzacja znaków, puste/NULL → `NULL`.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `search_posts_smoke_test.sql`          | Smoke RPC `public.search_posts`: zwraca tylko opublikowane, nieusunięte posty tenanta publicznego; pomija szkice, usunięte i obcych tenantów.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pii_column_grants_test.sql`           | Bramka CI grantów PII: `has_column_privilege` dowodzi, że `anon`/`authenticated` NIE czytają wrażliwych kolumn (`profiles.email/prefs`, `newsletter_subscribers.email`, `billing_profiles.email/tax_id/phone`, `crm_leads.email/phone`, `contact_messages.email/phone`, `author_profiles.phone/contact_email/media_contact_email/media_contact_phone`); regresja grantu = błąd buildu.                                                                                                                                                                          |
| `author_contact_privacy_test.sql`      | Prywatność kontaktów autora (finding „author contact details exposed by default", migracja 20260730120000): widok `author_profiles_public` bez ŻADNEJ kolumny kontaktowej (zostaje tylko `media_contact_name`), `get_expert_hub()` bez `contact_email` w payloadzie, `is_public` DEFAULT `false`, `admin_get_author_profile()` (SECURITY DEFINER) czyta pełny wiersz wyłącznie dla admina tego samego tenanta (nie-admin i admin obcego tenanta - pusty zbiór, anon bez EXECUTE), właściciel przez `get_own_author_profile()`, anon widzi publiczną projekcję. |
| `anonymous_insert_lockdown_test.sql`   | Bramka anty-regresyjna dla 4 findings ze skanu anonimowych INSERT-ów (2026-07-30, migracje 20260730130000 + 20260730140000): `contact_messages`, `crm_consent_log`, `related_post_clicks` i `builder_experiment_events` bez ŻADNEJ polityki INSERT i bez grantów INSERT dla `anon`/`authenticated` (INSERT z obu sesji = 42501, także z poprawnym tenantem i eksperymentem `running`); anon bez SELECT na logu zgód; service_role zachowuje zapis (ścieżki `submitContactMessage` / beacony `/api/public/related-click` i `/api/public/experiment-event`), a trigger `contact_messages_to_lead` nadal dopisuje zgodę RODO do `crm_consent_log` przy realnym zgłoszeniu. |
| `chat_privacy_isolation_test.sql`      | Prywatność czatu per tenant: legacy członkostwo cross-tenant nie daje odczytu wiadomości/konwersacji/uczestników ANI załącznika w storage; purge obiektu storage przy „cofnij wysłanie"; pin `user_id`/`tenant_id` w `notification_preferences`; wzajemne potwierdzenia odczytu (RLS na uczestnikach); `allow_messages_from` (nowe konwersacje + tryb cichy); `get_chat_peers` bez wycieku poza tenant; komplet polityk Realtime Authorization i parser topiców.                                                                                               |
| `chat_whatsapp_features_test.sql`      | Funkcje czatu klasy WhatsApp: potwierdzenia dostarczenia (`mark_conversations_delivered`), pin/archiwum/wyciszenie (self-row RPC; fan-out powiadomień pomija wyciszonych), „wyczyść czat u siebie" (asymetria stron), znikające wiadomości (whitelist TTL, stampowanie `expires_at`, RLS ukrywa wygasłe, twardy purge z kasacją obiektu storage), głosówki (`kind='audio'`, limit czasu, allowlist bucketu), prywatne gwiazdki, harmonogram pg_cron.                                                                                                           |
| `community_membership_badges_test.sql` | Warstwy członkostwa i odznaki: seed 3 warstw dla nowego tenanta (trigger), public read tylko publiczny tenant/aktywne, zapis admin-only we własnym tenancie, rozstrzyganie warstwy (subskrypcja→plan→tier; fallback reader), `has_tier_rank`/`has_tier_feature`, odznaki admin-only + stempel `granted_by` + powiadomienie.                                                                                                                                                                                                                                    |
| `community_events_test.sql`            | Wydarzenia: public read (published, publiczny tenant), granty kolumnowe `join_url`/`recording_url`, `rsvp_event` (wyścig o ostatnie miejsce pod `FOR UPDATE` ⇒ lista rezerwowa, idempotencja, zwalnianie miejsc, `interested` bez miejsca), bramki warstw (members ⇒ rank≥1; briefing ⇒ FLAGA `pro_briefings`), zakaz zapisu bezpośredniego (zalążkowe polityki usunięte), `get_event_access` (auth/tier/rsvp/ok) i liczniki RSVP.                                                                                                                             |
| `community_events_waitlist_test.sql`   | Lista rezerwowa wydarzeń: komplet ⇒ `waitlist` FIFO (stabilna pozycja przy ponowieniach), rezygnacja z `going`/podniesienie `capacity` awansuje czoło kolejki + powiadomienie, `get_event_rsvp_counts.waitlist`, `get_event_waitlist_position`, `get_event_access` reason=`waitlisted`; nagrania za FLAGĄ `recordings` (URL nie wycieka bez uprawnienia, `watch_reason` steruje upsellem).                                                                                                                                                                     |
| `community_qa_summary_test.sql`        | Podsumowanie sesji Q&A jako treść: bramki (staff/host; sesja `answering`/`closed`; min. 1 odpowiedź), workflow redakcyjny publikacji (`can_publish_content` - host kompiluje szkic, publikuje admin), escaping HTML treści pytań, anonimowość Chatham House, porządek głosów, idempotentny upsert przez `qa_sessions.post_id`, powiadomienia autorów przy pierwszej publikacji, publikacja jednokierunkowa.                                                                                                                                                    |
| `community_reputation_test.sql`        | Reputacja + tablica kontrybutorów: wagi punktów z istniejących danych (Q&A/odznaki, breakdown per źródło), tablica wyłącznie dla zalogowanych i wyłącznie profile `discoverable=true` bez kont redakcyjnych, `get_my_reputation` (własny wynik bez opt-in, pozycja tylko dla widocznych).                                                                                                                                                                                                                                                                      |
| `community_qa_test.sql`                | Q&A: sesje bez szkiców, grant kolumnowy `user_id` (Chatham House), `ask_qa_question` (sesja `open`, rate limit 5/h, `author_display` = nazwa profilu - nigdy e-mail, anonimowość, powiadomienie hosta), zakaz INSERT-u bezpośredniego, głosy tylko na approved/answered, `list_qa_questions` (priorytet Pro `qa_priority` > głosy > starszeństwo), moderacja hosta + stempel odpowiedzi.                                                                                                                                                                       |
| `community_polls_contrib_test.sql`     | Ankiety + kontrybutorzy: public read bez szkiców, `vote_poll` (walidacja opcji, zamknięte/przeterminowane, upsert zmiany głosu), anti-anchoring `get_poll_results`/`_bulk`, zakaz zapisu bezpośredniego do `poll_votes`, zgłoszenia (own insert `submitted`, rate limit 3/24h, izolacja own/staff per tenant, akceptacja ⇒ odznaka `contributor`).                                                                                                                                                                                                             |
| `community_tracker_test.sql`           | Tracker UE: public read (published, publiczny tenant), aktualizacje publiczne tylko przy opublikowanym dossier, obserwowanie owner-only (`WITH CHECK` published), licznik obserwujących przez RPC, trigger zmiany etapu (przestawia dossier, stempluje `stage_from`, alarmuje obserwujących).                                                                                                                                                                                                                                                                  |
| `community_groups_test.sql`            | Kręgi (rozmowy grupowe): walidacja tytułu, serwerowy filtr kandydatów (blokady, `allow_messages_from`), owner-only dopraszanie/rename, fan-out N>2 (`unread_count` dla każdego oprócz nadawcy), guard grupowy (tryb cichy nie knebluje kręgu, blokada pary obowiązuje), wyjście ownera z przekazaniem własności i kasacja pustego kręgu.                                                                                                                                                                                                                       |
| `push_and_digest_test.sql`             | Kanoniczny potok push/digest: own-row RLS subskrypcji, kolejka `notification_push_queue` service-role-only, trigger kolejkuje tylko przy opt-in `push_enabled` + żywej subskrypcji, `claim_push_jobs` (atomowy claim z backoffem), `claim_due_digests` (stempel `digest_last_sent_at`, pomija przeczytane).                                                                                                                                                                                                                                                    |
| `job_scheduler_heartbeat_test.sql`     | Harmonogram doręczeń (20260731110000): log przebiegów `job_runner_runs` service-role-only (RLS bez polityk, zero grantów klienckich), funkcje harmonogramu (`record_job_run`, `arm_job_runner`, `invoke_billing_cron`, `resolve_job_runner_base_url`) niedostępne dla anon/authenticated, `job_scheduler_health()` z bramką roli (członek → 42501, admin → pełny payload BEZ sekretu), normalizacja wejścia w `record_job_run` (nieznane źródło → `external`, puste job → `all`, ujemny czas → 0) i heartbeat z licznikiem porażek, samozbrojenie `arm_job_runner` (tylko https bez hosta lokalnego, tylko dziewiczy wiersz, decyzja operatora nienaruszalna), `invoke_jobs_tick()` fail-open bez pg_net. |
| `security_hardening_rls_test.sql`      | Bramka anti-regresyjna dla 5 findings ze skanu (2026-07-18): kolumnowy REVOKE PII/sekretów (`author_profiles.phone`, `author_profiles.media_contact_email`, `content_access.password_hash`, `content_access.password_hint_pl/en`) dla anon/authenticated; RLS `wp_import_jobs`/`domain_events`/`tenant_pending_counters` - reader (non-staff, non-actor) nie widzi nic, actor swoje, admin tenanta wszystko w tenancie; `profile_badges` public read tylko dla publicznego tenanta; `get_own_author_profile()` (SECURITY DEFINER) zwraca PII własnego wiersza. |
| `tenant_isolation_billing_storage_test.sql` | Regresja izolacji tenantów dla ten sam `auth.uid()` w dwóch tenantach: `billing_documents` i `donations` widzą tylko rekordy aktywnego tenanta (`user_id = auth.uid() AND tenant_id = current_tenant_id()`); storage bucket `cv` blokuje SELECT/DELETE plików spoza aktywnego tenanta pomimo zgodnego owner_id; test symetrii po przełączeniu profilu na drugi tenant. |
| `email_suppression_test.sql`           | Lista wykluczeń e-mail (bounce/complaint): twarde odbicie → blokada trwała + natychmiastowe wypisanie subskrybenta, miękkie → czasowa z backoffem i eskalacją do trwałej po 4 zdarzeniach, pierwszeństwo powagi (skarga nie słabnie od późniejszego soft bounce), `email_filter_suppressed`/`email_is_suppressed` tylko dla AKTYWNYCH blokad własnego tenanta (wygasłe i cudze nie blokują), idempotencja `email_apply_delivery_event` po `(provider, event_id)` + korelacja stanu dostawy po `provider_message_id`, RLS/PII (anon bez dostępu, nie-staff widzi zero) i bramka stafowa `email_suppression_add`. |
| `related_posts_config_provisioning_test.sql` | Provisioning i izolacja singletonu `related_posts_config`: backfill (każdy istniejący tenant ma wiersz), trigger `tenants_seed_related_posts_config` (nowy tenant zasiewa się sam), idempotencja `seed_related_posts_config` (bez duplikatu i bez nadpisania ustawień admina), upsert admina dotyka WYŁĄCZNIE wiersza jego tenanta, RLS blokuje zapis do wiersza obcego tenanta, oraz determinizm odczytu: goły `select().limit(1)` widzi DWA wiersze przy adminie obcego tenanta na cudzej domenie (suma polityk OR), a `get_related_posts_config()` zwraca zawsze wiersz tenanta PRZEGLĄDANEGO. |

## Uruchamianie

Kanonicznie - przez Supabase CLI, które stawia świeżą bazę, nakłada wszystkie
migracje z `supabase/migrations/` i odpala pliki przez `pg_prove`:

```bash
supabase test db          # albo: bun run db:test
```

Wymagane jest rozszerzenie pgTAP w lokalnej bazie testowej (jednorazowo):

```sql
create extension if not exists pgtap with schema extensions;
```

### Konwencje

- Każdy plik jest samowystarczalny: `begin; select plan(N); … select * from finish(); rollback;`.
  `ROLLBACK` na końcu nie zostawia żadnych danych - testy nie zależą od kolejności.
- Wcielanie się w użytkownika (RLS): `set local role authenticated|anon` +
  `set_config('request.jwt.claims', '{"sub":"…","role":"…"}', true)`; `auth.uid()`
  czyta `sub` z claims. Rolę zdejmujemy przez `reset role`.
- Seed nadaje `tenant_id`/role jawnie i wyłącza triggery rejestracji
  (`alter table auth.users disable trigger user`), żeby nie polegać na
  auto-provisioningu.

## Uwaga: środowisko bez Supabase CLI

`supabase test db` wymaga lokalnego stacka Supabase (Docker). W środowiskach bez
CLI te same pliki uruchomisz przez `pg_prove` na dowolnym Postgresie, który ma
nałożone migracje oraz schematy/role platformy Supabase (`auth.uid()`,
`auth.users`, role `anon`/`authenticated`/`service_role`, `storage.*`):

```bash
pg_prove -d "$DATABASE_URL" supabase/tests/*.sql
```

## Ujednolicenie listy wykluczeń i runner poczty

`email_suppression_unification_test.sql` - bramka anty-regresyjna dla migracji
`20260731120000_email_suppression_unification.sql`:

- `public.suppressed_emails` jest **widokiem** zgodności nad
  `public.email_suppressions` (relkind `v`), utworzonym z
  `security_invoker = true` i BEZ dostępu dla `anon`/`authenticated` - adres
  e-mail to PII, a widok bez `security_invoker` obszedłby RLS tabeli źródłowej.
- zapisy przez widok trafiają do listy kanonicznej przez
  `email_record_suppression` (mapowanie `bounce → hard_bounce`), są idempotentne
  i dziedziczą synchronizację z listą subskrybentów; `DELETE` **odblokowuje**
  (`released_at`) zamiast usuwać historię; blokada wygasła nie jest widoczna.
- `email_resolve_tenant_for_address`: jednoznaczny subskrybent → jednoznaczne
  konto → tenant domyślny (adres w dwóch tenantach NIE jest zgadywany).
- `email_unsubscribe_by_token`: wypis tokenem globalnym i tokenem per subskrybent
  w jednej transakcji (blokada + zdjęcie subskrypcji + zużycie tokenu),
  idempotentny przy powtórzonym one-click, z izolacją tenantów.
- runner zadań tła: `job_runner_settings.enabled` ma `DEFAULT true`, a
  `job_runner_base_url()` wylicza adres z domeny tenanta domyślnego, gdy
  konfiguracja jest pusta.
