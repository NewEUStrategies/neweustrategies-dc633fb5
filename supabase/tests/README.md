# Testy bazy danych (pgTAP)

Testy SQL warstwy danych Supabase - RLS (izolacja tenantów), przypięcie
`profiles.tenant_id` oraz pełnotekstowe wyszukiwanie. Dopełniają testy
jednostkowe Vitest (`bun run test`), które nie dotykają realnego Postgresa
ani polityk RLS.

## Pliki

| Plik                                   | Co weryfikuje                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rls_tenant_isolation_test.sql`        | „user tenanta A nie czyta postów B" (RLS na `public.posts`, szkice i opublikowane) oraz „UPDATE `tenant_id` jest ignorowany" (trigger `profiles_pin_tenant`).                                                                                                                                                                                                                                                                                                    |
| `search_tsquery_test.sql`              | `public.nes_search_tsquery` - unaccent + lower, prefiks `:*`, łączenie AND, sanityzacja znaków, puste/NULL → `NULL`.                                                                                                                                                                                                                                                                                                                                             |
| `search_posts_smoke_test.sql`          | Smoke RPC `public.search_posts`: zwraca tylko opublikowane, nieusunięte posty tenanta publicznego; pomija szkice, usunięte i obcych tenantów.                                                                                                                                                                                                                                                                                                                    |
| `pii_column_grants_test.sql`           | Bramka CI grantów PII: `has_column_privilege` dowodzi, że `anon`/`authenticated` NIE czytają wrażliwych kolumn (`profiles.email/prefs`, `newsletter_subscribers.email`, `billing_profiles.email/tax_id/phone`, `crm_leads.email/phone`, `contact_messages.email/phone`); regresja grantu = błąd buildu.                                                                                                                                                          |
| `chat_privacy_isolation_test.sql`      | Prywatność czatu per tenant: legacy członkostwo cross-tenant nie daje odczytu wiadomości/konwersacji/uczestników ANI załącznika w storage; purge obiektu storage przy „cofnij wysłanie"; pin `user_id`/`tenant_id` w `notification_preferences`; wzajemne potwierdzenia odczytu (RLS na uczestnikach); `allow_messages_from` (nowe konwersacje + tryb cichy); `get_chat_peers` bez wycieku poza tenant; komplet polityk Realtime Authorization i parser topiców. |
| `chat_whatsapp_features_test.sql`      | Funkcje czatu klasy WhatsApp: potwierdzenia dostarczenia (`mark_conversations_delivered`), pin/archiwum/wyciszenie (self-row RPC; fan-out powiadomień pomija wyciszonych), „wyczyść czat u siebie" (asymetria stron), znikające wiadomości (whitelist TTL, stampowanie `expires_at`, RLS ukrywa wygasłe, twardy purge z kasacją obiektu storage), głosówki (`kind='audio'`, limit czasu, allowlist bucketu), prywatne gwiazdki, harmonogram pg_cron.             |
| `community_membership_badges_test.sql` | Warstwy członkostwa i odznaki: seed 3 warstw dla nowego tenanta (trigger), public read tylko publiczny tenant/aktywne, zapis admin-only we własnym tenancie, rozstrzyganie warstwy (subskrypcja→plan→tier; fallback reader), `has_tier_rank`/`has_tier_feature`, odznaki admin-only + stempel `granted_by` + powiadomienie.                                                                                                                                      |
| `community_events_test.sql`            | Wydarzenia: public read (published, publiczny tenant), granty kolumnowe `join_url`/`recording_url`, `rsvp_event` (wyścig o ostatnie miejsce pod `FOR UPDATE`, idempotencja, zwalnianie miejsc, `interested` bez miejsca), bramki warstw (members ⇒ rank≥1; briefing ⇒ FLAGA `pro_briefings`), zakaz zapisu bezpośredniego (zalążkowe polityki usunięte), `get_event_access` (auth/tier/rsvp/ok) i liczniki RSVP.                                                 |
| `community_qa_test.sql`                | Q&A: sesje bez szkiców, grant kolumnowy `user_id` (Chatham House), `ask_qa_question` (sesja `open`, rate limit 5/h, `author_display` = nazwa profilu - nigdy e-mail, anonimowość, powiadomienie hosta), zakaz INSERT-u bezpośredniego, głosy tylko na approved/answered, `list_qa_questions` (priorytet Pro `qa_priority` > głosy > starszeństwo), moderacja hosta + stempel odpowiedzi.                                                                         |
| `community_polls_contrib_test.sql`     | Ankiety + kontrybutorzy: public read bez szkiców, `vote_poll` (walidacja opcji, zamknięte/przeterminowane, upsert zmiany głosu), anti-anchoring `get_poll_results`/`_bulk`, zakaz zapisu bezpośredniego do `poll_votes`, zgłoszenia (own insert `submitted`, rate limit 3/24h, izolacja own/staff per tenant, akceptacja ⇒ odznaka `contributor`).                                                                                                               |
| `community_tracker_test.sql`           | Tracker UE: public read (published, publiczny tenant), aktualizacje publiczne tylko przy opublikowanym dossier, obserwowanie owner-only (`WITH CHECK` published), licznik obserwujących przez RPC, trigger zmiany etapu (przestawia dossier, stempluje `stage_from`, alarmuje obserwujących).                                                                                                                                                                    |
| `community_groups_test.sql`            | Kręgi (rozmowy grupowe): walidacja tytułu, serwerowy filtr kandydatów (blokady, `allow_messages_from`), owner-only dopraszanie/rename, fan-out N>2 (`unread_count` dla każdego oprócz nadawcy), guard grupowy (tryb cichy nie knebluje kręgu, blokada pary obowiązuje), wyjście ownera z przekazaniem własności i kasacja pustego kręgu.                                                                                                                         |
| `push_and_digest_test.sql`             | Kanoniczny potok push/digest: own-row RLS subskrypcji, kolejka `notification_push_queue` service-role-only, trigger kolejkuje tylko przy opt-in `push_enabled` + żywej subskrypcji, `claim_push_jobs` (atomowy claim z backoffem), `claim_due_digests` (stempel `digest_last_sent_at`, pomija przeczytane).                                                                                                                                                      |
| `security_hardening_rls_test.sql`      | Bramka anti-regresyjna dla 5 findings ze skanu (2026-07-18): kolumnowy REVOKE PII/sekretów (`author_profiles.phone`, `author_profiles.media_contact_email`, `content_access.password_hash`, `content_access.password_hint_pl/en`) dla anon/authenticated; RLS `wp_import_jobs`/`domain_events`/`tenant_pending_counters` - reader (non-staff, non-actor) nie widzi nic, actor swoje, admin tenanta wszystko w tenancie; `profile_badges` public read tylko dla publicznego tenanta; `get_own_author_profile()` (SECURITY DEFINER) zwraca PII własnego wiersza. |

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
