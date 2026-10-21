# Pakiet I9d-4 – wygaszanie nieaktywnych subskrybentów newslettera (Z-I9c-08)

Stan: gałąź PR #530 (`4b1aa96d3`), 2026-10-21. Tylko odczyt repo. Numery linii wg tego stanu.

## 0. Zadanie (źródło: `docs/PROMPT_KONTYNUACJI_HUB_2026-10-20.md` §8.1 pkt 4-6, l. 522-549)

- Kategoria retencji „Nieaktywni subskrybenci”: **12 mies. bez zaangażowania (zakres 6-24)**.
- Zaangażowanie = kliknięcie, otwarcie LUDZKIE (bez Apple MPP – próg S5 `machine_open_seconds`),
  logowanie powiązanego konta, formularz, potwierdzenie zapisu.
- Przebieg: JEDEN mail z prośbą o potwierdzenie (PL/EN wg języka subskrybenta, treść edytowalna w panelu,
  ton NES, link „Chcę dalej otrzymywać” z podpisanym tokenem jednorazowym – wzorzec `trackingToken.server.ts`;
  klik resetuje licznik) → brak reakcji 30 dni → **DELETE wiersza subskrybenta**. Dziennik zgód zostaje
  („czas trwania zgody + 6 lat”). **NIE dopisywać adresu do listy wyłączeń** (to nie sprzeciw).
  Mail przez istniejącą kolejkę z etykietą respektującą listę wyłączeń.
- Karta retencji: lista „do wygaszenia” (liczba, podgląd, wykluczenie adresu z powodem → `audit_log`);
  karencja 14 dni. Przy wyłączonym pomiarze otwarć zaangażowanie liczone bez otwarć (dymek).
- Testy (pkt 6): pgTAP – mail raz, token resetuje, po 30 dniach usunięcie, wykluczeni zostają, lista
  wyłączeń nietknięta, tylko starsze niż okres, karencja, idempotencja; vitest – parytet stałych, token,
  render maila PL/EN; RTL/axe karty.
- Dziennik: podsekcja „21.x RODO – decyzje właściciela 2 (I9d-Y1)”, Z-I9c-08 → „Zamknięte (I9d, §21.x)”
  (wiersz zgłoszenia: `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` l. 3894; rejestr RODO l. 213-215
  i wiersz wyjątków „Subskrypcja newslettera” l. 193 – dziś „wypis linkiem albo w panelu”).

Pliku `src/lib/journeys/trackingToken.server.ts` NIE MA – wzorzec to `src/lib/newsletter/trackingToken.server.ts`.

---

## 1. Schemat `public.newsletter_subscribers`

DDL: `supabase/migrations/20260601054247_238918ba-…sql` l. 75-125, dalej ALTER-y:

| Kolumna | Typ / ograniczenie | Migracja |
|---|---|---|
| `id` | uuid PK `gen_random_uuid()` | 20260601054247 |
| `tenant_id` | uuid NOT NULL DEFAULT `current_tenant_id()` (**bez FK do tenants**) | 〃 |
| `email` | text NOT NULL; UNIQUE (tenant_id, email) + `newsletter_subscribers_tenant_email_ci_uniq` (20260708160000 l. 40, lower) | 〃 |
| `display_name`, `first_name`, `last_name` | text | 〃 / 20260630053403 l. 23-30 |
| `language` | text NOT NULL DEFAULT 'pl' (**brak CHECK**; zod przyjmuje `pl`/`en`) | 20260601054247 |
| `source`, `source_form_id`, `source_form_name` | text | 〃 / 20260630053403 |
| `status` | text NOT NULL DEFAULT 'subscribed' (**brak CHECK**) | 20260601054247 |
| `confirmed_at`, `unsubscribed_at` | timestamptz | 〃 |
| `confirmation_token` (UNIQUE partial), `confirmation_expires_at` | text / timestamptz | 20260601063834 l. 1-7 |
| `consents` | jsonb NOT NULL DEFAULT '[]' | 20260630053403 l. 24 |
| `ip` (text po 20260630053403), `user_agent`, `meta` jsonb | | |
| `unsubscribe_token` | text NOT NULL DEFAULT `encode(gen_random_bytes(24),'hex')`, UNIQUE, wyzwalacz `newsletter_subscribers_unsub_token_trg` | 20260711082902 l. 1-34 |
| `user_id` | uuid NULL, **bez FK**, indeks partial `newsletter_subscribers_user_id_idx` | 20260716231319 l. 4-9 |
| `created_at`, `updated_at` | timestamptz NOT NULL (wyzwalacz `newsletter_set_updated_at`) | 20260601054247 |

- Statusy faktycznie zapisywane: `pending` (DOI), `subscribed`, `unsubscribed`; `confirmed` – legacy, nadal
  czytane (`_data_retention_crm_candidates`, `_journey_marketing_consent`, `newsletter_to_lead`).
  Kampanie idą do `status='subscribed'` (`src/lib/newsletter-campaigns.functions.ts` l. 745, 1248).
- Język: `language` ('pl' domyślnie) – `CASE WHEN language='en' THEN 'en' ELSE 'pl'`.
- DOI: `newsletter_settings.double_opt_in` (DEFAULT false). Bez DOI zapis od razu `subscribed` +
  `confirmed_at=now()` (`src/lib/newsletter.functions.ts` l. 366-391).
- Powiązanie z kontem: `user_id` ustawiane TYLKO przy zapisie, jeśli profil o tym adresie już istniał
  (`newsletter.functions.ts` l. 324-334, `profiles.ilike email`). Konto założone później → `user_id` NULL.
  Usunięcie konta: `UPDATE … SET user_id = NULL` (`20261020160900_account_erasure_staff_mail_queue.sql` l. 607).
- REPLICA IDENTITY FULL (20260705183601 l. 13) – każdy UPDATE leci realtime do panelu.
- Granty/RLS: INSERT od anon/authenticated odebrany (20260702200100 l. 22-23, 20260703052720 l. 26-27);
  `authenticated`: SELECT/UPDATE/DELETE wg polityk „newsletter staff read/update (admin|editor)”,
  „newsletter staff delete (admin)”; `service_role` ALL.
- Wyzwalacze:
  - `trg_newsletter_to_lead` AFTER INSERT OR **UPDATE OF status** → `newsletter_to_lead()` (najnowsza
    definicja `20260708151417_1568b817-…sql` l. 61-~120): `crm_upsert_lead(…, true, status='subscribed')`
    (**podbija `crm_leads.last_activity_at = now()`, `source_count+1`, `marketing_consent OR …`** –
    `crm_upsert_lead` w `20260630060254_f371acc7-…sql` l. 29-90), `crm_leads.newsletter_status = NEW.status`,
    przy INSERT/przejściu na `confirmed` wpisy `crm_consent_log` (klucze z `consents`, domyślnie
    `consent_key='newsletter'`, `source_type='newsletter'`, `source_id = NEW.id`).
  - `trg_newsletter_subscribers_emit_events` AFTER INSERT OR UPDATE (definicja `20261020100100_newsletter_settings_patch.sql`
    l. 286-355, CIALO-Z wcześniej 20260711220607): subscribed/confirmed/unsubscribed/resubscribed.v1.
    **Brak zdarzenia na DELETE.**
  - `trg_score_on_subscriber` AFTER INSERT OR UPDATE OF status, confirmed_at (20260719083815 l. 518-520).
- Tabele z FK do subskrybenta – wszystkie **ON DELETE SET NULL**: `newsletter_campaign_recipients.subscriber_id`
  (20260711083456 l. 72), `newsletter_campaign_events.subscriber_id` (20260712150000 l. 19),
  `email_suppressions.subscriber_id`, `email_delivery_events.subscriber_id` (20260725123624 l. 20, 73).
- Usuwanie dziś: panel `src/components/admin/newsletter/SubscribersPanel.tsx` l. 103-118
  (`supabase.from("newsletter_subscribers").delete()` przez RLS admina) – bez audytu, bez wpisu zgód.

## 2. Sygnały zaangażowania – gdzie są zapisywane

| Sygnał | Zapis | Klucz do subskrybenta | Pułapki |
|---|---|---|---|
| Otwarcie/klik kampanii | `newsletter_campaign_events` (20260712150000 l. 14-41: id, tenant_id, campaign_id, subscriber_id NULL, `kind CHECK IN ('open','click')`, url, created_at) | `subscriber_id` | **brak kolumny machine**; dedupe 1 wiersz/(kampania, subskrybent, rodzaj, doba UTC) – `nl_campaign_events_subscriber_day_uq` (20260814150000 l. 113-120) |
| Zapis zdarzenia kampanii | RPC `newsletter_record_campaign_event(p_campaign uuid, p_subscriber uuid, p_kind text, p_url text DEFAULT NULL, p_occurred_at timestamptz DEFAULT NULL) RETURNS jsonb` – najnowsza **20260814215302_cd43e60c-…sql l. 53-121**, SECURITY DEFINER, `SET search_path = public` (bez pg_temp), tylko `service_role` | tenant z kampanii | `ON CONFLICT … DO NOTHING` – drugie (ludzkie) otwarcie tej samej doby po otwarciu MPP przepada |
| Producent | piksel `src/routes/api/public/nl-open.ts` l. 48-78 (`?c=&s=` → `verifyTrackingToken` → `recordCampaignEvent`, source `first_party`); klik `nl-click.ts`; webhook dostawcy (`source: provider`) | | `src/lib/newsletter/engagementSource.ts`: jedno źródło prawdy z env `NEWSLETTER_ENGAGEMENT_SOURCE` (domyślnie `first_party`); piksel kampanii **nie przekazuje UA** (proxy) |
| Czas wysyłki kampanii | `newsletter_campaign_recipients.sent_at` (upsert po akceptacji dostawcy, `newsletter-campaigns.functions.ts` l. 1517-1528, 1680-1697); UNIQUE (campaign_id, email) | `subscriber_id`/`email` | sent_at zapisywany PO odpowiedzi dostawcy – piksel MPP może przyjść, zanim wiersz istnieje |
| Otwarcie/klik ścieżki | `journey_message_events` (20261020090400 l. 68-81: `kind IN ('open','click','unsubscribe')`, `machine boolean NOT NULL DEFAULT false`, `occurred_at`, `day`, UNIQUE `(message_id, kind, link_index, day)`) | `journey_messages.lead_id` → `crm_leads.email_norm` → `lower(subscribers.email)` | zapis `journey_record_message_event` (najnowsza **20261020161300** l. 40-105): `v_machine := p_machine OR (open AND now()-queued_at < machine_open_seconds)`; przy `open_tracking_enabled = false` otwarcie NIE jest zapisywane (`open_tracking_disabled`) |
| Próg maszynowy | `journey_settings.machine_open_seconds smallint NOT NULL DEFAULT 2 CHECK 0..30` (20261020090300 l. 257); brak wiersza = 2 | | `isMailProxyUserAgent` (`src/lib/journeys/tracking.server.ts` l. 37-42: GoogleImageProxy, YahooMailProxy, Mimecast, Barracuda, Proofpoint, Outlook-iOS-Android) – **Gmail proxy = maszynowe**; Z-S5-06 (dziennik l. 2337): otwarcia ludzkie to górna granica |
| Logowanie konta | `auth.users.last_sign_in_at` (precedens SQL: `20261020120400_revenue_funnel_access.sql` l. 163, `20261020161200` l. 129) | `subscribers.user_id` albo `profiles (tenant_id, lower(email))` → `auth.users.id` | odświeżenie tokenu nie podbija `last_sign_in_at`; `auth.sessions` nieużywane w repo |
| Formularz | `crm_upsert_from_form` (najnowsza 20260706215313 l. 4-~95) ustawia `crm_leads.last_activity_at = now()`; `contact_messages.created_at` (email); `event_people.email_norm` + `event_registrations.created_at` | email_norm | `crm_leads.last_activity_at` podbijają też: `newsletter_to_lead` (każda zmiana statusu subskrybenta!), akcje workflow (20261020130200 l. 392, 413), klub (20261020130500). Ponowny zapis istniejącego subskrybenta: `subscribeToNewsletter` zwraca `exists` **bez żadnego zapisu** (`newsletter.functions.ts` l. 245-251) |
| Potwierdzenie zapisu | `newsletter_subscribers.confirmed_at` (DOI: `src/routes/api.public.newsletter.confirm.ts` l. 107-114; bez DOI: przy zapisie) | wiersz | |

Precedens listy „aktywności” w SQL: `_data_retention_crm_candidates` (`20261020161100_data_retention_executor.sql`
l. 336-400) – NOT EXISTS po notatkach, zadaniach, etapach, zdarzeniach ścieżek (open/click), zdarzeniach
kampanii, rejestracjach wydarzeń, `contact_messages`. Ten sam kształt nadaje się do kandydatów newslettera.

## 3. Mechanizm retencji I9c-X2 (do rozszerzenia)

Migracje: `20261020161000_data_retention_core` (32 909 B), `161100_executor` (44 527 B – blisko limitu 46 080),
`161200_reads`, `161300_open_tracking`, `161400_panel`; bliźniaki `drizzle/migrations/0368…0372`.

- `data_retention_settings` (core l. 72-100): PK (tenant_id, category); `period_months smallint`;
  `enabled bool NOT NULL DEFAULT true`; `enforce_after timestamptz NOT NULL`; `updated_by` FK auth.users SET NULL.
  CHECK `data_retention_settings_category_check` (l. 84-86: 9 kluczy) i `data_retention_settings_period_check`
  (l. 89-99: `WHEN '<kat>' THEN period_months IS NOT NULL AND period_months BETWEEN a AND b`, ustawowe
  `period_months IS NULL AND enabled`, `ELSE false`).
- `data_retention_runs` (l. 102-118): `category CHECK IN (…9…)` – inline, nazwa automatyczna
  `data_retention_runs_category_check`; `mode IN ('preview','execute')`; `run_trigger IN ('schedule','manual')`;
  `affected`, `backlog`, `error_code` (≤64, tylko SQLSTATE).
- `data_retention_crm_extensions` (l. 134-146) – wzór tabeli wykluczeń: reason `CHECK (char_length(reason) BETWEEN 3 AND 500)`,
  `created_by` FK SET NULL, FK złożony do `crm_leads(tenant_id,id)` CASCADE, `SET lock_timeout = '5s'`.
- `newsletter_campaign_engagement_archive` (l. 174-185): PK campaign_id, opens, clicks, unique_openers,
  unique_clickers, archived_before – **agregat per kampania, bez subskrybenta**.
- ACL nowych tabel (l. 205-217): RLS ON, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, GRANT S/I/U/D `service_role`.
- `_data_retention_catalog()` (l. 224-~250, IMMUTABLE): `categories` (key, default, min, max, editable)
  + `rules` (`audit_network_months` 12 … `batch_max` 50000). `_data_retention_effective(p_tenant)` (l. 255-~295):
  brak wiersza → domyślny okres, `enforce_after = tenants.created_at + 14 dni`, `cutoff = now() - period`.
- Seed bezpiecznego startu (l. 593-597): `INSERT … SELECT t.id, key, default, true, now() + interval '14 days'
  … ON CONFLICT DO NOTHING`. **Nowa kategoria bez seeda = dla istniejących najemców `enforce_after` w
  przeszłości → wykonanie od razu.**
- Executor (161100): funkcje kategorii `(p_tenant, p_cutoff, p_execute, p_limit) RETURNS jsonb {affected, backlog, cutoff}`;
  `_data_retention_fold_campaign_events` l. 152-209 (zwija zdarzenia kampanii < cutoff do archiwum);
  `_data_retention_email_engagement` l. 211-249; `_data_retention_consent_log(p_tenant, p_execute, p_limit)` l. 640-704;
  `_data_retention_run_tenant(p_tenant, p_trigger, p_limit)` l. 706-~775 (blokada doradcza
  `hashtextextended('data_retention_run:'||tenant,0)`, `CASE v_set.category WHEN … END` – **kategoria bez gałęzi
  daje NULL i cichy wiersz `affected 0`**, `BEGIN … EXCEPTION` per kategoria);
  `data_retention_run(p_limit integer DEFAULT 5000)` l. 778-~840 (service_role, budżet 8 s, najemcy bez przebiegu 20 h).
- Panel (161400): `_data_retention_admin_tenant()` l. 41-58 (admin|super_admin z sesji, inaczej 42501);
  `_data_retention_emit(p_tenant, p_op, p_category)` l. 63-76 (`data_retention.changed.v1`, wyjątek → `_log_emit_error`);
  `admin_data_retention_get()` l. 85-~140 (grace = min/max `enforce_after`, `any_preview`);
  `admin_data_retention_save(text, integer, boolean, timestamptz)` l. 142-~200 – **walidacja z katalogu, bez
  listy na sztywno** (nie wymaga redefinicji); `admin_data_retention_enforcement(text, date)` l. 204-~245;
  `admin_data_retention_preview()` l. 251-~325 (CASE per kategoria, sufit 100 000 – wymaga gałęzi);
  `admin_data_retention_crm_due(p_limit integer DEFAULT 50)` l. 328-~365; `admin_data_retention_crm_extend(uuid, text)`
  l. 368-~408; `admin_data_retention_run_now(boolean)` l. 412-~440. Wszystkie panelowe:
  `REVOKE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated, service_role`.
- Harmonogram: `src/lib/server/jobsTick.server.ts` – typ `dataRetention` l. 145-155, `isDataRetentionWindow`
  l. 281-283 (02:07-02:57 UTC co 10 min), krok OSTATNI l. 449-470 (`admin.rpc("data_retention_run", { p_limit:
  DATA_RETENTION_RULES.batchDefault })`, `isMigrationPending` → `skipped: "migration_pending"`); dren poczty
  l. 319-327 (wcześnie w ticku).
- TS: `src/lib/privacy/dataRetention.ts` – `DATA_RETENTION_EDITABLE_CATEGORIES`, `DATA_RETENTION_STATUTORY_CATEGORIES`,
  `DATA_RETENTION_RUN_CATEGORIES`, `DATA_RETENTION_PERIODS`, `DATA_RETENTION_RULES` (`crmExtensionReasonMin/Max` 3/500,
  `graceDays` 14, `batchDefault` 5000), `isRetentionPeriodAllowed`, `retentionPeriodOptions`, `normalizeExtensionReason`
  (punkty kodowe jak `char_length`); `dataRetention.functions.ts` (server fns z `requireAdmin`, literalne RPC
  l. 96-205, `mapDataRetentionError`); `dataRetentionParse.ts` (l. 181 odrzuca nieznane kategorie wg listy TS);
  `dataRetentionQueries.ts`; `keys.ts` (`dataRetentionKeys.tenant/settings/preview/crmDue`).
- **Parytet:** `src/lib/privacy/__tests__/dataRetentionParity.test.ts` czyta NA SZTYWNO `CORE`, `EXECUTOR`, `PANEL`
  (l. 30-33) i oczekuje `CHECK (category IN (<DATA_RETENTION_RUN_CATEGORIES>))` w CORE (l. 64) – po dodaniu
  kategorii w TS test będzie czerwony, dopóki nie zacznie czytać najnowszej definicji (nowej migracji).
- UI: `src/components/admin/settings/dataRetention/{DataRetentionCard,RetentionCategoryRow,CrmDueList}.tsx`
  (karta leniwa w `/admin/settings/privacy`); `CrmDueList` = wzór listy z dialogiem powodu (licznik, odrzucanie,
  nie przycinanie); przełącznik piksela w karcie l. 325-345. Testy: `__tests__/DataRetentionCard.test.tsx` (11, axe),
  `src/routes/__tests__/adminSettingsPrivacyRoute.test.tsx`.
- i18n: `src/lib/i18n-admin-data-retention.ts` (prefiks `adminDataRetention`, PL l. 16-279, EN l. 282-536;
  `categories.<key>.{name,what,after,basis,standard}`, `crm.*`, `pixel.*`). Ostrzeżenie w nagłówku pliku:
  angielskie słowo = klasa Tailwind dokłada CSS do arkusza publicznego (`publicCss` zamrożony).
  W `crm_inactive_contacts.standard` jest już tekst „Polityka wygaszania („sunset policy”): 12-24 miesiące bez zaangażowania.”

**Wniosek:** surowe zdarzenia kampanii/ścieżek mają retencję `email_engagement` 13 mies. (zakres **3**-25) i są
zwijane do archiwum bez subskrybenta → okno nieaktywności (do 24 mies.) NIE może być liczone z surowych zdarzeń.
Potrzebny zdenormalizowany znacznik per subskrybent zapisywany w chwili zdarzenia.

## 4. Dziennik zgód `public.crm_consent_log`

- DDL `20260630053403_8783ac8b-…sql` l. 33-69: id, tenant_id NOT NULL DEFAULT `public_tenant_id()`, email NOT NULL,
  `source_type public.crm_source_type NOT NULL` (enum; używane `'newsletter'`, `'other'`), source_id uuid,
  form_id, form_name, `consent_key text NOT NULL`, `consent_text text NOT NULL`, consent_version, `given boolean NOT NULL`,
  ip, user_agent, lang, created_at; indeks `(tenant_id, lower(email), created_at DESC)`.
- Klucz newslettera: `'newsletter'` (formularze: `NewsletterForm.tsx` l. 298, `JoinUsForm.tsx` l. 481,
  `NewsletterDocRenderer.tsx` l. 208; domyślny w `newsletter_to_lead`).
- Retencja `_data_retention_consent_log` (executor l. 640-704): łańcuch (lower(email), consent_key) z ostatnim
  `given=false` starszym niż 6 lat → DELETE; wygaśnięcie (wpis `given=false`, `source_type='other'`, tekst
  „Wygaśnięcie zgody: brak kontaktu, subskrypcji i konta (retencja danych)”) TYLKO gdy brak niezanonimizowanego
  leada, aktywnej subskrypcji (`pending/subscribed/confirmed`) i profilu. Subskrybent prawie zawsze ma leada
  (tworzy go `newsletter_to_lead`) → po samym DELETE subskrybenta łańcuch `newsletter` zostaje „given=true”
  aż do anonimizacji leada. Reguła „czas trwania zgody + 6 lat” wymaga więc **jawnego wpisu wygaśnięcia przy
  wygaszeniu** (od niego biegnie 6 lat).
- Wzór wycofania z wpisem: `_journey_unsubscribe` (`20261020140500_journeys_tracking_stats.sql` l. 216-~270):
  `crm_leads.marketing_consent=false` + `crm_consent_log` (`'other'`, `form_id 'journey:unsubscribe'`, key `marketing`).
  Uwaga: ta funkcja woła `email_unsubscribe_by_token`/`email_record_suppression` – **dla wygaszania NIE wolno**.

## 5. Lista wyłączeń

- `public.email_suppressions` (kanoniczna; reason ∈ `hard_bounce|soft_bounce|complaint|manual|unsubscribe|invalid|blocked`,
  scope permanent/transient, `subscriber_id` SET NULL). Polityka `src/lib/email/suppressionPolicy.ts`:
  `EmailCategory = "transactional" | "bulk"` (l. 44); `suppressionBlocks` – `bulk` blokuje każdy aktywny powód;
  `TX_EMAIL_CATEGORY: Record<TxEmailType, EmailCategory>` (l. 120, `newsletter_confirmed: "bulk"` l. 200);
  `RAW_LABEL_CATEGORY` (l. 232-248: `newsletter_campaign`, `journey`, `digest_*` = bulk); `emailCategoryForLabel`
  (l. 257, nieznana etykieta → `bulk`); `ACCOUNT_BOUND_EMAIL_LABELS` (l. 296, lustro SQL `_hub_account_bound_email_labels`,
  parytet `accountBoundLabelsParity.test.ts`).
- Karta retencji: lista wyłączeń „Bez usuwania” (`DATA_RETENTION_EXISTING` key `suppression_list`).
- Zapis blokady robią: `email_unsubscribe_by_token`, `email_record_suppression(p_tenant, p_email, p_reason, p_source, p_provider, p_meta)`,
  `releaseUnsubscribeOnOptIn` (zdejmuje przy DOI). Wygaszanie nie może ich wołać; pgTAP: liczba wierszy
  `email_suppressions` dla adresu przed = po.

## 6. Kolejka maili

- `src/lib/email/transactional.server.ts`: `TxSendInput` l. 79-~120 (`type, to, lang, ctaUrl, ctaPath, metaName,
  bodyVars, idempotencyKey, tenantId`), `sendTxEmail` l. 297-~430: bramka `suppressionGate` (kategoria
  `txEmailCategory(type)`), `alreadyHandled(messageId)` (deterministyczny `deterministicMessageId(idempotencyKey)`
  → „mail raz”), nadpisania z panelu `loadTxOverrideFor(…, input.tenantId, type, lang)` (TYLKO przy `tenantId`),
  render `TxEmail` (React Email, import dynamiczny), wiersz `email_send_log` `pending`, `rpc("enqueue_email",
  { queue_name: "transactional_emails", payload: {…, unsubscribe_token: ensureUnsubscribeToken(), label: type,
  tenant_id, purpose: "transactional"} })`. **Brak pola `unsubscribe_url`** (List-Unsubscribe) – ma je tylko
  `enqueueRawEmail` (`RawEmailInput` l. 432-460, funkcja l. 473-544, `label`, `category?`, `unsubscribeUrl?`).
- Dren `src/lib/email/queueDrain.server.ts` l. 530-551: ponowna bramka listy wyłączeń w chwili wysyłki
  (`emailCategoryForLabel(label)`); l. 553-580 `email_queue_send_recheck` tylko dla etykiet związanych z kontem.
- Mail DOI (`newsletter.functions.ts` l. 90-127 `sendEmail`) idzie BEZPOŚREDNIO przez bramkę Resend
  (`GATEWAY_URL` l. 18), nie kolejką – nie wzorować się na nim.
- `src/lib/email/reputationGate.server.ts` (`evaluateSendGate`) – bramka reputacji domeny dla kampanii
  i ścieżek (`journeysRunner.server.ts` l. 33); mail wygaszania to wysyłka masowa – rozważyć.

## 7. Tokeny podpisane – wzorzec `src/lib/newsletter/trackingToken.server.ts` (181 l.)

- Sekret `getSecret()` l. 27-29: `SESSION_SECRET || SUPABASE_SERVICE_ROLE_KEY`; HMAC-SHA256 (`@noble/hashes`),
  podpis 32 hex (`SIG_HEX_LEN`), `constantTimeEqual` (l. 37-44, **nieeksportowany**), `UUID_RE`.
- Domeny HMAC (l. 97-180): `jm:` tracking ścieżki, `ju:` wypis ścieżki (`j` + message_id bez myślników + podpis),
  kampania `${campaignId}:${subscriberId}`. Nowa domena (np. `nk:`) nie koliduje z żadną.
- Tokeny HMAC są **bezstanowe** (wielokrotnego użytku) – jednorazowość wymaga stanu w bazie (nonce kasowany
  przy użyciu). Wzorzec stanowy: `confirmation_token` + `confirmation_expires_at` (idempotentny re-klik → `already`).
- Testy wzorcowe: `src/lib/newsletter/__tests__/trackingToken.test.ts`, `trackingTokenJourney.test.ts`,
  `trackingLinkSignature.test.ts`, `src/routes/api/public/-nl-tracking.test.ts`.
- Plik należy do manifestu S5 (`hubDelivery.ts` l. 718-719) – zmiana z I9 wymaga dopisania do manifestu I9.

## 8. Trasy publiczne

- `src/routes/api.public.newsletter.confirm.ts` (143 l.): GET; `Accept: text/html` → 303 na `/newsletter/confirm`;
  fetch → JSON; `isValidConfirmToken` (16-128 hex), `resolveConfirmOutcome` (czysta, eksport do testów),
  `wantsHtml`; idempotencja (token zostaje → `already`). Testy: `src/routes/-api.public.newsletter.confirm{,.handler}.test.ts`.
- `src/routes/api.public.newsletter.unsubscribe.ts` (251 l.): **GET nigdy nie mutuje** (skanery linków bramek
  pocztowych), GET html → 303 na stronę, POST wykonuje (RFC 8058, oba kodowania formularza), limiter.
  Strona `src/routes/newsletter.unsubscribe.tsx` – przycisk „Potwierdź” → POST. Test `-api.public.newsletter.unsubscribe.test.ts`.
- Strony: `newsletter.confirm.tsx` (head przez `buildContentHead`, `robots: "noindex, nofollow"`, `activeLang`).
- Klucze i18n stron publicznych: `src/lib/locale/pl.ts` l. 131 (`newsletter.confirmPage`), l. 143
  (`newsletter.unsubscribePage`); `en.ts` l. 124/136. Bundle `public` ZAMROŻONY (2881; zmierzone 2778,6).
- Limiter: `createRateLimiter` (`src/lib/http/rateLimit.ts` l. 54), `rateLimitIpSubject` (l. 163).
- Adres wypisu: `newsletterUnsubscribeUrl(origin, token)` (`src/lib/newsletter/unsubscribeUrl.ts`) →
  `/api/public/newsletter/unsubscribe?token=`.

## 9. Treści maili edytowalne w panelu

- Mechanizm: `src/lib/email/txOverrides.ts` – `TX_OVERRIDES_SETTING_KEY = "tx_email_overrides"` w `site_settings`
  (PK (tenant_id, key)), `EDITABLE_TX_TYPES` l. 24-28 (3 typy `team_seat_*`), `TxCopyOverrideSchema` (subject,
  preview, eyebrow, heading, intro, extra, cta, note; max 2000; puste = domyślne), `TxOverridesSchema` (obiekt
  per typ – trzeba dopisać typ), tokeny `{planName, orgName, accessUntil, daysLeft, subject, firstName}` (l. 86-101),
  mutacja zapisu l. 161-~180. Serwer: `txOverrides.server.ts` (`loadTxOverrideFor`, filtr `tenant_id` = jedyna granica).
- Edytor: `src/components/admin/newsletter/system-emails/TxEmailContentPanel.tsx` (trasa
  `/admin/newsletter/email-content`, `src/routes/admin.newsletter.email-content.tsx`) – iteruje po `EDITABLE_TX_TYPES`,
  PL/EN przełącznikiem, i18n `adminNewsletter.emailContent.*`.
- Ton NES – domyślne treści `src/lib/email-templates/tx-copy.ts` (`TxEmailType` l. 9-~90; `newsletter_confirmed`
  PL l. 808-820, EN l. 1552-1565): temat z emoji + „| New European Strategies”, `icon: "hero-mail"`, eyebrow
  „Newsletter”, heading, intro (rzeczowo, „analizy, dane i komentarze eksperckie”), cta, note (wypis jednym kliknięciem),
  `labels: LABELS_PL`, `footerHelp: HELP_PL`.
- Nowy `TxEmailType` trzeba zarejestrować w: `tx-copy.ts` (PL+EN), `tx-body.ts` (jeśli personalizacja),
  `suppressionPolicy.ts` `TX_EMAIL_CATEGORY` (Record – kompilacja wymusza), `email/tx-preview.server.ts`
  (`TX_EMAIL_TYPES` l. 38-83, `case` ~l. 542 dane demo), `email-templates/app-transactional-templates.tsx` (~l. 120),
  `components/admin/newsletter/system-emails/authPreviewRules.ts` (l. 42), `i18n-newsletter-admin.ts`
  (`emailPreview.types` PL l. 245, EN l. 515); opcjonalnie `crm/scoring.ts`. Pliki tx-copy/tx-body/registry są
  w manifeście S2 (l. 581), transactional.server.ts w S5 (l. 736).
- Alternatywa: kolumny `newsletter_settings` + `admin_newsletter_settings_patch(p_group, p_patch, p_expected_updated_at)`
  (20261020100100, biała lista grup, CAS 40001) – cięższa (nowe kolumny, grupa, UI).

## 10. `audit_log` – wzór

Kolumny: id, tenant_id NOT NULL, actor_id NULL, action, entity_type NOT NULL, entity_id text NULL, metadata jsonb, ip,
created_at (`types.ts` l. 444-455). Wzór SQL (161400 l. 399-401):

```sql
INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
VALUES (v_tenant, auth.uid(), 'data_retention.crm_extended', 'crm_lead', p_lead_id,
        jsonb_build_object('extended_until', v_until, 'reason', v_reason));
PERFORM public._data_retention_emit(v_tenant, 'extension', 'crm_inactive_contacts');
```

Akcje `data_retention.*` NIE są finansowe (`AUDIT_FINANCIAL_ACTION_PREFIXES`) → retencja audytu 24 mies.
Nie wpisywać e-maila do `metadata` (audyt czyta się szerzej; przy usunięciu konta e-mail → `[redacted]`).

## 11. Przełącznik pomiaru otwarć

- `journey_settings.open_tracking_enabled boolean NOT NULL DEFAULT true` (core l. 192-193); brak wiersza = włączony.
  Odczyt w panelu `admin_data_retention_get` → `open_tracking_enabled`; zapis `admin_journey_settings_save`
  (161300, klucz boolean, inaczej `22023 open_tracking_enabled_invalid`); karta „Pomiar otwarć (piksel)”.
- Obejmuje TYLKO ścieżki; piksel kampanii zapisuje otwarcia niezależnie (Z-I9c-09 – wspólny przełącznik
  najemcy planuje I9d-Y2). Wygaszanie powinno czytać `COALESCE(js.open_tracking_enabled, true)` i przy `false`
  ignorować WSZYSTKIE otwarcia (kampanie i ścieżki).

## 12. Skutki uboczne DELETE subskrybenta (do obsłużenia)

1. `_journey_marketing_consent` (`20261020140200_journeys_predicates_consent.sql` l. 95-133): bierze status
   subskrybenta (brak wiersza → NULL), księgę tylko dla klucza `marketing`, potem `crm_leads.marketing_consent`
   (ustawiony na true przez `newsletter_to_lead` przy `subscribed`) → **po DELETE ścieżki marketingowe nadal
   „ok”**. Dren też pyta tę funkcję (`email_queue_send_recheck`).
2. `crm_leads.newsletter_status` zostaje `subscribed` (wyzwalacz nie działa na DELETE).
3. `newsletter_campaign_engagement` (161200 l. 435-~490): `COUNT(DISTINCT subscriber_id)` w surowych zdarzeniach
   – po SET NULL **zasięg unikalny kampanii maleje** (otwarcia/kliknięcia nie) → zwinąć zdarzenia subskrybenta do
   `newsletter_campaign_engagement_archive` przed DELETE (wzór `_data_retention_fold_campaign_events`).
4. `_data_retention_crm_candidates` wyklucza leady z aktywną subskrypcją; po DELETE lead z `last_activity_at`
   starszym niż 24 mies. zostanie zanonimizowany w kolejnym przebiegu **bez 30-dniowej listy „do anonimizacji”**.
5. Każdy UPDATE `status` subskrybenta odpala `newsletter_to_lead` → podbija `crm_leads.last_activity_at`
   → jeśli ten sygnał liczy się jako „formularz”, proces sam by się resetował. Stan wygaszania trzymać POZA
   kolumną `status`.
6. Brak zdarzenia domenowego DELETE; inwalidacja panelu przez `data_retention.changed.v1`
   (`eventInvalidationMap.admin.ts` l. 186 → `dataRetentionKeys.tenant`); listę subskrybentów w panelu newslettera
   odświeża `newsletterSubscriberKeys()` tylko na zdarzenia subscriber.*.

## 13. Rejestry i bramki

- `src/lib/ci/hubDelivery.ts`: zakres skanu `[20261020090000, 20261020170000)`; blok I9 `2026102016`;
  `FUNCTION_TABLE` l. 102-314 (`[nazwa, "I9", "panel"|"service"|"internal"|"trigger"]`); `HUB_CIALO_Z` l. 339-357
  (funkcje sprzed huba – np. dopisać `newsletter_record_campaign_event: "20260814215302"`); `HUB_I9_REDEFINITIONS`
  l. 369-388 (funkcje innych wycinków – `journey_record_message_event` dziś `"20261020140500"`; po redefinicji
  w I9d wartość = **`20261020161300`**, bo bramka wymaga najnowszej definicji w hubie, l. 1446-1468);
  redefinicja funkcji własnej I9 (np. `_data_retention_run_tenant`) nie jest sprawdzana przez bramkę –
  znacznik `-- CIALO-Z:` dawać z konwencji. Manifest I9 l. 818-952 – każdy zmieniony plik musi pasować do globu
  I9 (`checkSliceDiff` l. 1038: plik spoza manifestu = naruszenie); `supabase/tests/hub_i9c_*_test.sql` – nowy plik
  `hub_i9d_*` wymaga globu. Pliki współdzielone l. 394-425 (jobsTick, routeTree.gen, domainEvents, mapy inwalidacji, …).
- `supabase/tests/hub_shared_helpers_test.sql` l. 71-135 – lista `hub_grants` (funkcje serwisowe/wewnętrzne/wyzwalacze
  bez EXECUTE dla anon/authenticated) – dopisać nowe.
- Bliźniaki drizzle: `cp` bajt w bajt do `drizzle/migrations/NNNN_<nazwa>.sql`, wpis w `meta/_journal.json`
  (ostatni idx 372, `when` 1792477933912; kolejne +60000), `bun run check:migration-lanes`.
- `types.ts` (nowe tabele/kolumny/RPC), `routeTree.gen.ts` (nowe trasy), `authzSnapshot` (`generate:authz-snapshot`),
  `i18nParity.gate.test.ts` + `reports/i18n-parity.json`, ratchet bundla `overall` (5023).
- AGENTS.md: literalne nazwy RPC/tabel, `service_role` dla serwerowych, tenant/user z sesji (nigdy z payloadu);
  limity tekstu (powód) – odrzucać, nie przycinać, ten sam limit klient/serwer/CHECK; wspólne atomy daty/select.

## 14. Testy – istniejące wzorce

- pgTAP: `supabase/tests/hub_i9c_data_retention_test.sql` (plan 52; fikstura: `tenants` A po karencji
  `created_at = now()-30 days`, B w karencji; `ALTER TABLE auth.users DISABLE TRIGGER USER`; `pg_temp.as_user(uid)`
  przez `set_config('request.jwt.claims', …)`; `pg_temp.ts(interval)`), `hub_i9c_data_retention_aggregates_test.sql`
  (agregaty bez zmian), `newsletter_unsubscribe_suppression_test.sql`, `newsletter_campaign_events_dedup_test.sql`,
  `journeys_tracking_stats_test.sql` (próg maszynowy). Uruchamianie: `PGTAP_DIR=/tmp/pgtap-hub PGTAP_PORT=5490
  flock -x /tmp/hub-pgtap.lock bash scripts/pgtap-local/run.sh test <plik bez .sql>`.
- vitest: `src/lib/privacy/__tests__/{dataRetentionParity,dataRetentionParse}.test.ts`,
  `src/lib/newsletter/__tests__/trackingToken*.test.ts`, `src/lib/email/__tests__/{suppressionPolicy,transactional.server,txOverrides,tx-preview.server}.test.ts`,
  `src/lib/server/__tests__/jobsTickRun.test.ts`, `src/routes/api/public/-jobs-tick.test.ts`,
  `src/routes/-api.public.newsletter.unsubscribe.test.ts`, RTL `DataRetentionCard.test.tsx` (axe).
  Uruchamianie: `TZ=UTC bunx vitest run --maxWorkers=2 <pliki>`.

---

## Rekomendacja wdrożenia

### A. Model danych (nowe obiekty, blok I9)

1. Kolumny `newsletter_subscribers` (ADD COLUMN IF NOT EXISTS, `SET lock_timeout = '5s'`):
   `last_engaged_at timestamptz` (klik, formularz, potwierdzenie, „Chcę dalej”, logowanie zapisane przy zdarzeniu)
   i `last_human_open_at timestamptz` (osobno – żeby przy wyłączonym pomiarze pominąć otwarcia).
   Indeks `(tenant_id, status, GREATEST(…))` niepotrzebny – wystarczy `(tenant_id, last_engaged_at)`.
   Backfill zachowawczy: `last_engaged_at = max(click)` z kampanii (+ ścieżki po email_norm),
   `last_human_open_at = max(open)` BEZ filtra maszynowego (historia nie ma flagi – lepiej nie wygasić
   ludzi na starcie). Aktualizacja tylko gdy `> now() - 1 day` się nie zgadza (mniej UPDATE/realtime).
2. Tabela `newsletter_sunset_requests` (tenant_id NOT NULL FK tenants CASCADE, subscriber_id PK/UNIQUE FK
   `newsletter_subscribers(id)` ON DELETE CASCADE, `requested_at timestamptz NOT NULL`, `nonce uuid NOT NULL`,
   `mailed_at timestamptz`, `mail_outcome text CHECK IN ('queued','duplicate','suppressed','failed')`,
   `claimed_until timestamptz`) – stan cyklu POZA `status` (pkt 12.5), RLS + REVOKE + service_role.
3. Tabela `newsletter_sunset_exclusions` (wzór `data_retention_crm_extensions`): PK (tenant_id, subscriber_id),
   FK CASCADE, `reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500)`, `created_by` FK auth.users
   SET NULL, `created_at`. Wykluczenie bezterminowe, zdejmowalne w panelu (audyt obu akcji).

### B. SQL (funkcje)

- Rozszerzenie katalogu (WSPÓLNE dla całego Y1 – koordynować z pakietami zgłoszeń klubów, `metered_views`,
  `event_people`, jedna migracja): klucz np. `newsletter_inactive` – CHECK `WHEN 'newsletter_inactive' THEN
  period_months IS NOT NULL AND period_months BETWEEN 6 AND 24` (DROP/ADD obu CHECK `data_retention_settings_*`
  i `data_retention_runs_category_check`), `_data_retention_catalog()` (CIALO-Z 20261020161000) z wpisem
  `'default', 12, 'min', 6, 'max', 24` i regułą `'newsletter_response_days', 30` (dopisać NA KOŃCU `rules`),
  seed `enforce_after = now() + interval '14 days'` dla istniejących najemców (`ON CONFLICT DO NOTHING`).
- `_newsletter_engagement_touch(p_tenant, p_subscriber, p_kind)` (internal) – jedyny pisarz kolumn z A.1.
- Redefinicja `newsletter_record_campaign_event` (CIALO-Z **20260814215302**, dodać `pg_temp` do search_path):
  przed wstawieniem dedupe – klik → touch; otwarcie ludzkie gdy `v_at - recipient.sent_at >=
  make_interval(secs => COALESCE(js.machine_open_seconds, 2))` (brak `sent_at` → maszynowe) → touch
  (dzięki temu ludzkie otwarcie tej samej doby po MPP też się liczy). Rejestr: FUNCTION_TABLE `service`, HUB_CIALO_Z.
- Ścieżki: AFTER INSERT na `journey_message_events` `WHEN (NOT NEW.machine AND NEW.kind IN ('open','click'))`
  → touch po `journey_messages.lead_id → crm_leads.email_norm` (bez redefinicji S5, nie koliduje z Y2;
  koszt: ludzkie otwarcie tej samej doby po maszynowym przepada). Alternatywa – redefinicja
  `journey_record_message_event` (CIALO-Z 20261020161300 + aktualizacja `HUB_I9_REDEFINITIONS`).
- `_data_retention_newsletter_candidates(p_tenant, p_cutoff, p_limit)`: `status IN ('subscribed','confirmed')`,
  brak wykluczenia, brak cyklu, `GREATEST(created_at, confirmed_at, last_engaged_at, CASE WHEN tracking THEN
  last_human_open_at END, max(auth.users.last_sign_in_at po user_id i po profiles email), max(contact_messages),
  max(event_registrations)) < p_cutoff` (precedens NOT EXISTS z `_data_retention_crm_candidates`).
  NIE używać `crm_leads.last_activity_at` (podbijają je wyzwalacze i workflow).
- `_data_retention_newsletter_inactive(p_tenant, p_cutoff, p_execute, p_limit)`: (1) podgląd – liczba kandydatów
  + liczba do usunięcia; (2) wykonanie – wstaw cykle (`nonce = gen_random_uuid()`); usuń cykle z zaangażowaniem po
  `requested_at` (reset); dla cykli `mailed_at < now() - 30 days` bez zaangażowania i bez wykluczenia:
  zwiń zdarzenia kampanii subskrybenta do archiwum, wpis `crm_consent_log` `given=false` dla kluczy z ostatnim
  `given=true` (`source_type 'newsletter'`, `source_id` = subskrybent, `form_id 'retention:newsletter_sunset'`,
  tekst „Wygaśnięcie zgody: brak zaangażowania i brak odpowiedzi na prośbę o potwierdzenie (retencja danych)”),
  `crm_leads.newsletter_status = NULL` (decyzja o `marketing_consent` – pytania), DELETE subskrybenta.
  Bez `email_suppressions`. Wynik `{affected, backlog, cutoff, requested, deleted}`.
- Redefinicje własne I9: `_data_retention_run_tenant` (CIALO-Z 20261020161100, nowa gałąź CASE),
  `admin_data_retention_preview` (CIALO-Z 20261020161400, gałąź liczby).
- Service (tylko `service_role`): `newsletter_sunset_claim_mail(p_limit integer)` (FOR UPDATE SKIP LOCKED,
  `claimed_until`, zwraca id, tenant, email, language, first_name, nonce, requested_at, unsubscribe_token),
  `newsletter_sunset_mark_mailed(p_subscriber uuid, p_outcome text)`, `newsletter_sunset_keep(p_subscriber uuid,
  p_nonce uuid)` (nonce zgodny i cykl aktywny → touch `keep`, DELETE cyklu = jednorazowość, wpis zgody `given=true`
  „Potwierdzenie chęci otrzymywania newslettera”; powtórka → `already`; brak wiersza → `gone`).
- Panel (authenticated, `_data_retention_admin_tenant()`): `admin_data_retention_newsletter_due(p_limit integer DEFAULT 50)`
  (oczekujący na reakcję z terminem `mailed_at + 30 dni` + liczba do wysłania), `admin_data_retention_newsletter_exclude(p_subscriber uuid, p_reason text)`
  (22023 `reason_length`, P0002 `subscriber_not_found`, `audit_log` `data_retention.newsletter_excluded`,
  entity `newsletter_subscriber`, metadata `{reason}`, `_data_retention_emit(…,'exclusion','newsletter_inactive')`),
  `admin_data_retention_newsletter_include(p_subscriber uuid)` (`data_retention.newsletter_exclusion_removed`).

### C. TS / UI

- `src/lib/privacy/dataRetention.ts`: kategoria w `DATA_RETENTION_EDITABLE_CATEGORIES`, `DATA_RETENTION_PERIODS.newsletter_inactive
  = { defaultMonths: 12, minMonths: 6, maxMonths: 24 }`, `DATA_RETENTION_RULES.newsletterResponseDays: 30`
  (+ limity powodu – reużyć `crmExtensionReason*` albo nowe stałe z lustrem CHECK). Parytet: test czyta
  najnowszą migrację z CHECK/katalogiem (nie `CORE` na sztywno).
- `dataRetention.functions.ts` / `dataRetentionParse.ts` / `dataRetentionQueries.ts` / `keys.ts`
  (`newsletterDue(tenantId)` pod prefiksem najemcy).
- `src/components/admin/settings/dataRetention/NewsletterSunsetList.tsx` (wzór `CrmDueList`): liczba, tabela
  (adres, ostatnie zaangażowanie, mail wysłany, termin usunięcia), „Wyklucz” (dialog z powodem i licznikiem),
  podgląd maila (link do `/admin/newsletter/email-preview` albo `renderTxEmailPreview`), dymek przy
  `openTrackingEnabled === false`. Wpięcie w `DataRetentionCard.tsx`, i18n w `i18n-admin-data-retention.ts`
  (`categories.newsletter_inactive.*`, `newsletter.*`), podstawa: RODO art. 5 ust. 1 lit. e, art. 7 ust. 1.
- Mail: `TxEmailType` `newsletter_reconfirm` (kategoria `bulk`), PL/EN w `tx-copy.ts`, dopisany do
  `EDITABLE_TX_TYPES` + `TxOverridesSchema` (edycja w `/admin/newsletter/email-content`), tokeny `daysLeft` (30)
  i `accessUntil` (data usunięcia), `firstName`. Rejestracje z §9. Przekazać List-Unsubscribe: dodać do
  `TxSendInput` opcjonalne `unsubscribeUrl` (→ `payload.unsubscribe_url`) z `newsletterUnsubscribeUrl`.
  Szkic PL: temat „📨 Czy nadal chcesz otrzymywać nasz newsletter? | New European Strategies”; heading
  „Czy nadal chcesz otrzymywać nasze analizy?”; intro „Od dłuższego czasu nie widzimy Twojej aktywności
  w naszym newsletterze. Szanujemy Twoją skrzynkę i Twoje dane, dlatego pytamy wprost: jeśli chcesz dalej
  otrzymywać analizy New European Strategies, potwierdź to jednym kliknięciem.”; cta „Chcę dalej otrzymywać”;
  note „Bez potwierdzenia w ciągu {daysLeft} dni ({accessUntil}) usuniemy Twój adres z listy - bez kolejnych
  wiadomości. Możesz zapisać się ponownie w każdej chwili.” EN analogicznie („Do you still want our newsletter?”,
  „Keep me subscribed”).
- Token: funkcje `signNewsletterKeepToken(subscriberId, nonce)` / `verifyNewsletterKeepToken(token)` z domeną `nk:`
  w `trackingToken.server.ts` (manifest I9) albo nowy `src/lib/newsletter/sunsetToken.server.ts` (wtedy
  wyeksportować `constantTimeEqual`). Kształt `k<uuid-hex><nonce-hex><sig>` (jeden napis jak `ju:`).
- Wysyłka: `src/lib/newsletter/sunsetMail.server.ts` (`claim` → `sendTxEmail({ type: "newsletter_reconfirm",
  tenantId, lang, ctaUrl: <origin>/newsletter/keep?token=…, idempotencyKey:
  "newsletter_reconfirm:<tenant>:<subscriber>:<requested_at epoch>" })` → `mark_mailed`); krok
  `newsletterSunsetMail` w `jobsTick.server.ts` (typ w `JobsTickResult`, okno dzienne np. 08-17 Europe/Warsaw
  co 10 min, partia ≤ 50, `isMigrationPending` → skipped) + testy `jobsTickRun.test.ts`, `-jobs-tick.test.ts`.
- Trasy: `src/routes/api.public.newsletter.keep.ts` (GET html → 303 na stronę, GET fetch → walidacja bez mutacji,
  POST → `newsletter_sunset_keep`, limiter), `src/routes/newsletter.keep.tsx` (przycisk „Chcę dalej otrzymywać”
  – świadome działanie, skaner nie odnowi zgody; `noindex`), klucze `newsletter.keepPage.*` w `src/lib/locale/{pl,en}.ts`.
- `subscribeToNewsletter` gałąź `exists` (`newsletter.functions.ts` l. 251): touch `form` przez RPC
  (odpowiedź bez zmian – nie ujawnia obecności na liście).

### D. Kolejność i wersje

Najwyższa wersja: `20261020161400_data_retention_panel.sql`; drizzle `0372_data_retention_panel.sql`.
S7 rezerwuje bliźniaki `0373`, `0374` (wersje `2026102015…`) – I9d bierze następne wolne numery po faktycznym
stanie (`ls drizzle/migrations | tail`). Propozycja (przesuń, jeśli inne pakiety Y1 zajmą wersje):

1. `20261020161500_data_retention_y1_catalog` (wspólna Y1: CHECK, katalog, seed +14 dni) – bliźniak `0375`.
2. `20261020161800_newsletter_sunset_core` (kolumny + backfill, tabele, touch, redefinicja
   `newsletter_record_campaign_event`, wyzwalacz ścieżek) – `0378` (numery orientacyjne).
3. `20261020161900_newsletter_sunset_executor` (kandydaci, kategoria, `_data_retention_run_tenant`, service RPC).
4. `20261020162000_newsletter_sunset_panel` (`admin_data_retention_preview`, due/exclude/include).
   Każda ≤ 45 KiB (`bun run scripts/split-migration.ts <plik> --dry-run`), nagłówek DEFEKT/ZMIANA/KOLEJNOSC/
   IDEMPOTENTNA/DOWOD, `-- pg-harness: exclude` niepotrzebny (brak `club_*`/`event_*` DDL; odczyt
   `event_registrations` – sprawdzić `check:events-harness`, `check:careers-harness` przy `contact_messages`).
5. TS: stałe + parytet → token + testy → tx-copy/rejestracje + render PL/EN test → sunsetMail + jobsTick →
   trasy + strona → karta + i18n + RTL/axe → integracja (hubDelivery, types.ts, routeTree, drizzle,
   `hub_shared_helpers_test`, authz snapshot) → dziennik §21.x + rejestr RODO (wiersz subskrypcji, Z-I9c-08).

### E. Testy do napisania

- pgTAP `supabase/tests/hub_i9d_newsletter_sunset_test.sql` (glob do manifestu I9): RLS/ACL tabel i funkcji;
  kandydat tylko starszy niż okres (świeży klik/otwarcie ludzkie/logowanie/formularz/confirmed_at wyklucza;
  otwarcie maszynowe < próg NIE wyklucza; przy `open_tracking_enabled=false` otwarcie nie wyklucza);
  karencja (najemca w podglądzie – nic nie zmienia, cykl nie powstaje); mail raz (drugi przebieg nie tworzy
  drugiego cyklu, claim nie zwraca wysłanego); keep z dobrym nonce resetuje i kasuje cykl, drugi raz `already`,
  zły nonce odrzucony; po 30 dniach DELETE; wykluczony zostaje; `email_suppressions` bez zmian; wpis
  wygaśnięcia w `crm_consent_log`; zasięg unikalny kampanii (`newsletter_campaign_engagement`) bez zmian
  po usunięciu; idempotencja (powtórka = 0); panel: redaktor 42501, najemca z sesji, powód 3-500 (dłuższy 22023),
  audit_log. Plus aktualizacja `hub_i9c_data_retention_test` (liczba kategorii w kontroli 9 → 9+Y1).
- vitest: parytet stałych (CHECK/katalog/reguła 30 dni), token (podpis, domena `nk:` ≠ `jm:`/`ju:`, stały czas,
  zły kształt), render maila PL/EN (`renderTxEmailPreview`), `suppressionPolicy` (`newsletter_reconfirm` = bulk),
  trasa keep (GET nie mutuje, POST woła RPC, html → 303), `sunsetMail.server` (idempotencja, mark), jobsTick;
  RTL/axe `NewsletterSunsetList` i karty.

## Otwarte pytania / ryzyka

1. **Zgoda marketingowa leada po wygaszeniu:** `crm_leads.marketing_consent` ustawia newsletter; bez zmiany
   ścieżki marketingowe dalej wysyłają (`_journey_marketing_consent`). Rekomendacja: wpis `marketing given=false`
   i flaga false, gdy ostatni `marketing given=true` nie pochodzi z innego źródła niż newsletter – decyzja
   właściciela; powiązać z Z-S5-04 (wspólny pomocnik wycofania zgody).
2. **Szansa na zaangażowanie:** subskrybent, który w oknie nie dostał żadnej kampanii, jest „nieaktywny” z definicji.
   Proponowany warunek: ≥ 1 wysłana kampania (`newsletter_campaign_recipients.status='sent'`) w oknie.
3. **Gmail proxy = maszynowe** (`isMailProxyUserAgent`) – czytelnicy Gmaila bez kliknięć mogą trafić do wygaszania;
   dla kampanii UA nie jest przekazywany (tylko próg czasu). Czy dla wygaszania liczyć proxy pocztowe jako ludzkie?
4. **Mail niewysłany** (blokada listy wyłączeń, błąd): czy 30 dni biegnie od próby (`mail_outcome='suppressed'`),
   czy cykl wstrzymać? Rekomendacja: suppressed → liczyć jak wysłany (adres i tak nieosiągalny), failed → ponowić.
5. **Fala na starcie:** po 14 dniach karencji wielu najemców wyśle masowo prośby → reputacja domeny
   (`reputationGate`); proponowany dzienny limit na najemcę i okno dzienne.
6. **Lead bez 30-dniowego uprzedzenia:** po DELETE subskrybenta lead z `last_activity_at` > 24 mies. jest
   anonimizowany w następnym przebiegu CRM bez listy „do anonimizacji” (pkt 12.4) – pokazać go na liście CRM
   albo nadać 30 dni.
7. **`last_sign_in_at`** nie widzi długich sesji (odświeżanie tokenu) – aktywny czytelnik z kontem może dostać
   prośbę; ewentualnie dodatkowy sygnał (np. `paywall_hits`/`metered_views` konta) – poza decyzją.
8. **Formularz bez DOI jako sygnał** – ktoś może podtrzymać cudzą subskrypcję, wpisując adres; niska szkodliwość.
9. **Wiersze `pending`** (niepotwierdzony DOI) i **`unsubscribed`** – poza decyzją Z-I9c-08; zostają bez okresu
   (do zgłoszenia jako osobne Z-I9d-…).
10. **Koordynacja redefinicji** w I9d: wspólna migracja katalogu Y1; `newsletter_record_campaign_event`
    i `journey_record_message_event` mogą być ruszane też przez Y2 (pomiar tylko za zgodą) – jedna migracja
    na funkcję, kolejność wersji = kolejność dziennika drizzle.
11. Parytet `dataRetentionParity.test.ts` ze ścieżkami na sztywno – trzeba go przepiąć na najnowszą definicję,
    inaczej czerwony po dodaniu kategorii.
12. Z-I9c-10 (podwójny zasięg po archiwizacji) – zwinięcie zdarzeń przy DELETE nie pogarsza (subskrybent nie wróci
    z tym samym id), ale ponowny zapis tego adresu to nowy `id` → zasięg liczony osobno (akceptowalne, opisać).
