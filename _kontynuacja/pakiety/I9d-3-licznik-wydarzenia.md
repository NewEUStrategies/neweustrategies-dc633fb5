# Pakiet I9d-3 – odczyty licznika `metered_views` i uczestnicy wydarzeń `event_people` (Z-I9c-07)

Stan: gałąź PR #530 (`4b1aa96d3`). Tylko odczyt repo. Zadanie: `docs/PROMPT_KONTYNUACJI_HUB_2026-10-20.md`
§8.1 pkt 2, 3, 5, 6 (l. 507–548) i §9 (runbook: retencja). Mechanizm retencji I9c-X2 jako taki
opisuje pakiet siostrzany `I9d-1-retencja-mechanizm.md` – tu tylko to, co specyficzne dla obu
kategorii, plus wspólne pułapki, które te kategorie uruchamiają.

Decyzje właściciela (cytat skrócony, prompt l. 507–521):

- **Odczyty licznika artykułów** – **3 mies.** (zakres **2–13**); licznik potrzebuje bieżącego okresu;
  historia czytania może ujawniać poglądy (art. 9 RODO – minimalizacja). Przed usunięciem anonimowy
  agregat dzienny (`metering_events_daily`, „rozszerz jeśli trzeba”); wskaźniki starszych okien bez
  zmian (pgTAP).
- **Uczestnicy wydarzeń** – anonimizacja **24 mies. od ostatniego udziału/rejestracji** (zakres
  **12–36**): imię i nazwisko → neutralne (NOT NULL); e-mail, telefon, stanowisko, firma wpisana,
  profil społecznościowy, notatki → NULL; zostają obecność, typ biletu, status, daty, źródło.
  Wyjątki: osoba powiązana z ISTNIEJĄCYM kontem (historia w profilu do usunięcia konta); płatne
  zamówienie – nie wcześniej niż `accounting_retention_until`; nie łamać zgód sponsorów/stoisk.
- Wszystko w karcie „Retencja danych” (`/admin/settings/privacy`), mechanizm I9c-X2, `audit_log`,
  `data_retention.changed.v1`; rejestr czynności – nowe wpisy; dziennik „21.x … (I9d-Y1)”; Z-I9c-07 →
  „Zamknięte (I9d, §21.x)”. Testy: każda kategoria usuwa/anonimizuje tylko starsze niż okres,
  wyjątki, agregaty bez zmian, karencja, idempotencja.

Stan Z-I9c-07 w repo: `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` §21.21 tabela zgłoszeń (l. ~3893),
`docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md` l. 210–212 (zgłoszenie do IOD), l. 132 (wiersz „Okres
przechowywania” wpisu 2: „`metered_views` – przez trwanie konta (kaskada)”) – do aktualizacji.

---

## A. `metered_views` – licznik artykułów

### A1. Schemat

`supabase/migrations/20260721063638_9fcae354-….sql` l. 65–92 (bliźniacza kopia w
`20260721120000_crm_tasks_followups.sql` l. 598–628, `IF NOT EXISTS` – no-op):

```sql
CREATE TABLE IF NOT EXISTS public.metered_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,   -- konto: kaskada przy usunięciu konta
  visitor_id uuid,                                            -- gość: uuid z podpisanego cookie
  entity_type public.access_entity_type NOT NULL,
  entity_id uuid NOT NULL,                                    -- CO przeczytano (art. 9!)
  period_month date NOT NULL DEFAULT (date_trunc('month', now()))::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL));
```

- Indeksy: `metered_views_user_entity_uniq (tenant_id,user_id,entity_type,entity_id,period_month) WHERE user_id IS NOT NULL`,
  `metered_views_visitor_entity_uniq (… visitor_id …) WHERE user_id IS NULL`, `metered_views_user_period_idx`,
  `metered_views_visitor_period_idx`; od `20261013090400` l. 77–98: kolumna `ip_subject text`,
  CHECK `metered_views_ip_subject_check (ip_subject IS NULL OR (user_id IS NULL AND ip_subject ~ '^ip:[0-9a-f]{32}$'))`,
  indeks `metered_views_ip_period_idx (tenant_id, ip_subject, period_month) WHERE user_id IS NULL AND ip_subject IS NOT NULL`.
  **Brak indeksu po `created_at`** – usuwanie/agregacja po dniu: filtr po `period_month` (indeks) + `created_at`.
- ACL: RLS ON, `REVOKE ALL … FROM anon, authenticated`, `GRANT ALL … TO service_role` (l. 90–92). Polityka
  `metered_views_admin_read` (`20260730085737` l. 59–66, z filtrem najemcy) jest martwa – authenticated
  nie ma SELECT. Czytają wyłącznie funkcje SECURITY DEFINER i service_role.
- Wyzwalacz `metered_views_log_consume AFTER INSERT` → `log_metering_consumption()` (`20260721070203`
  l. 82–92): KAŻDY wstawiony odczyt dopisuje `metering_event_log` (`outcome='consumed'`, `user_id`,
  `visitor_id`, `entity_type`, `entity_id`). **Ta sama historia czytania żyje więc 13 mies.
  w `metering_event_log`** (kategoria `paywall_metering`) – patrz pułapka A6.1.
- Retencja dziś: `metered_views_scrub_ip(p_limit)` (`20261013090400` l. 630–675; service_role; pg_cron
  `metered-views-scrub-ip` `47 3 * * *`) zeruje `ip_subject` w `period_month < bieżący`. Wiersze żyją
  bezterminowo; konto – kaskada FK; gość – bez końca.

### A2. Pisarze

| Kto | Plik:linia (najnowsza definicja) | Uwagi |
| --- | --- | --- |
| `_metered_view_consume(_tenant uuid,_uid uuid,_visitor_id uuid,_ip_subject text,_entity_type access_entity_type,_entity_id uuid)` RETURNS TABLE(granted,consumed,used,monthly_limit,remaining,requires_registration,show_counter,content_pl,content_en,builder_data,blocks_data) | `20261020120200_metering_quota_rank_gate.sql` l. 71–392 (S3, internal; `HUB_CIALO_Z` = `20261013090400`) | `v_period := date_trunc('month', now())::date` (l. 117); zlicza `period_month = v_period` pod `pg_advisory_xact_lock` (l. 225–251); INSERT l. 330–338 (`ON CONFLICT DO NOTHING`); sufit adresu l. 297–310, 351 |
| `consume_metered_view(_entity_type,_entity_id)` – konto (`auth.uid()`) | `20261013090400` l. 400 | TS: `src/lib/access/metering.ts:411` |
| `consume_metered_view_visitor(_tenant,_entity_type,_entity_id,_visitor_id,_ip_subject)` – service_role | `20261013090400` l. 450 | TS: `src/lib/access/meteringVisitor.server.ts:160` (najemca z hosta, gość z cookie HMAC) |
| `record_paywall_hit` / `_visitor` | `20261020120100_paywall_hits_rpc.sql` l. 64 / 193 | **NIE pisze** `metered_views` – pisze `paywall_hits` (kategoria `paywall_metering`) |

### A3. Czytelnicy – co czyta okres bieżący, a co okna historyczne

| Funkcja / kod | Najnowsza definicja | Co czyta | Skutek usunięcia po 3 mies. |
| --- | --- | --- | --- |
| `_metered_view_consume` | 20261020120200 | `period_month = bieżący` | brak (okres min. 2 mies. > bieżący miesiąc) |
| `_metering_state`, `metering_state()`, `metering_state_visitor(…)` | 20261013090400 l. 494 / 566 / 588 | bieżący okres | brak |
| `metering_impact_preview(_proposed_member_limit int)` (admin/editor/super_admin) | `20260725090100` l. 29–95 | `period_month = v_month` | brak |
| `get_user_monthly_metering_count(_user_id uuid)` | `20260724100000` l. 170–210 | bieżący okres | brak |
| `getCrmLeadMonthlyMetering` (server fn, service_role, literalnie `.from("metered_views")`) | `src/lib/crm.functions.ts:317–371` (zapytanie l. 352–357) | `period_month = 1. dzień miesiąca UTC` | brak |
| **`monetization_dashboard(_from,_to,_plan_id,_organization_id)`** (panel I9, admin/editor) | `20261020161200_data_retention_reads.sql` l. 349–425 | CTE `mv` l. 363–368: `count(*)`, `members` (user_id NOT NULL), `anonymous` z `created_at` w `[_from,_to]` | **zera dla okien sprzed progu** → potrzebny agregat dzienny + odczyt dni `< cut` z agregatu (wzór `ev_rows` l. 369–379) |
| **`_funnel_counts(p_tenant,p_since,p_until,p_segment)`** (S3, internal) | 20261020161200 l. 44–338; `metered_views` l. 133–136 | `active_accounts` – UNIA kont z profili/logowania, `paywall_hits`, **`metered_views.user_id`**, płatności w części surowej `[v_raw_since, p_until)`; `v_raw_since` = `GREATEST(p_since, _data_retention_funnel_cut)` | **zaniżenie „kont aktywnych”** okien 3–13 mies. (granica lejka dziś = okres `paywall_metering`, dom. 13) |
| `admin_revenue_funnel`, `admin_revenue_access_inventory` | `20261020120400` l. 352 / 448 | przez `_funnel_counts` (inventory nie czyta `metered_views` bezpośrednio) | jak wyżej |
| UI pulpitu monetyzacji | `src/routes/admin.monetization.tsx:46, 213–216`; test `src/routes/__tests__/platformMonetizationRoute.test.tsx:35` | kształt `{metered_views:{total,members,anonymous}}` | kształt RPC MUSI zostać |

Testy pgTAP dotykające `metered_views`: `metering_paywall_test`, `metering_visitor_identity_test`,
`metering_concurrency_test`, `metering_quota_rank_gate_test` (konsumpcja – bez zmian),
`security_definer_tenant_scope_test` (l. 78, 182–187 – `monetization_dashboard` przychód najemcy),
`definer_header_tenant_isolation_test` (l. 48), `hub_i9b_account_erasure_sweep_test` (l. 220 – lista tabel).

### A4. Agregaty I9c i granica odczytu (do reużycia)

`supabase/migrations/20261020161000_data_retention_core.sql`:

- `funnel_paywall_daily` (l. 151–164): `tenant_id, day, active_accounts, paywall_hit_accounts,
  paywall_hit_visitors, paywall_hits, converted jsonb, reasons jsonb, computed_at`, PK `(tenant_id, day)`.
  **`active_accounts` dnia już zawiera konta z `metered_views` tego dnia** (wynik `_funnel_counts` dla okna
  jednodniowego).
- `metering_events_daily` (l. 166–172): `tenant_id, day, outcome text, events int CHECK >= 0`,
  PK `(tenant_id, day, outcome)`, bez CHECK na `outcome`. Budowany w pętli pieczęci (l. 415–423) z
  `metering_event_log` (`GROUP BY outcome`), czytany przez `monetization_dashboard` (`ev_rows`).
- RLS + `REVOKE … FROM PUBLIC, anon, authenticated` + `GRANT S/I/U/D … TO service_role` (l. 203–217).
- `data_retention_state` (l. 121–127): PK `(tenant_id, scope)`, `scope CHECK IN ('funnel','journey_stats')`,
  `sealed_through date`, `purged_before date`.
- `_data_retention_funnel_cut(p_tenant) RETURNS date` (l. 304–319, internal):
  ```sql
  SELECT CASE WHEN st.sealed_through IS NULL THEN NULL
              ELSE LEAST(st.sealed_through + 1,
                         GREATEST(COALESCE(st.purged_before, '-infinity'::date),
                                  (e.cutoff AT TIME ZONE 'UTC')::date)) END
    FROM data_retention_state st
    JOIN _data_retention_effective(p_tenant) e ON e.category = 'paywall_metering'
   WHERE st.tenant_id = p_tenant AND st.scope = 'funnel'
  ```
  Woła ją `_funnel_counts` i `monetization_dashboard` (l. 357) – jedna granica dla obu.
- `_data_retention_seal_funnel(p_tenant uuid, p_until date, p_max_days int DEFAULT 31)` (l. 345–437):
  dzień po dniu od `sealed_through+1` (albo od pierwszego dnia `paywall_hits`/`metering_event_log`),
  maks. 31 dni/przebieg, blokada doradcza per najemca; zapis w obu trybach (podgląd też pieczętuje).
- Kategoria `paywall_metering`: `_data_retention_paywall_metering(p_tenant,p_cutoff,p_execute,p_limit)`
  (`20261020161100` l. 97–143) – wzór: pieczęć do dnia progu, `v_cut := LEAST(v_day, sealed_through+1)`,
  DELETE `… LIMIT p_limit FOR UPDATE SKIP LOCKED`, `purged_before = GREATEST(...)`, wynik
  `{affected, backlog, cutoff}`; w podglądzie `_data_retention_bounded(count, p_limit)`.

### A5. Czy `metering_events_daily` wystarczy? – NIE (w obecnym kształcie)

1. Liczy wyniki z `metering_event_log` (`consumed/denied/granted/exempt/requires_registration`), nie
   wiersze `metered_views`; nie rozróżnia `members`/`anonymous` (pulpit tego wymaga). `consumed` ≈ liczba
   wstawień (wyzwalacz), ale rozjeżdża się (kaskada konta usuwa `metered_views`, a dziennik dostaje
   pseudonim – `20261020160500` l. 102–109; wiersze sprzed wyzwalacza).
2. Nie da się z niego odtworzyć `active_accounts` (unia rozłącznych zbiorów kont) – to daje wyłącznie
   `funnel_paywall_daily` + przesunięcie granicy lejka.

Rekomendacja (zgodna z pakietem I9d-1 §7): nowa tabela `public.metered_views_daily (tenant_id uuid NOT NULL
FK tenants ON DELETE CASCADE, day date NOT NULL, members integer NOT NULL DEFAULT 0 CHECK (members >= 0),
anonymous integer NOT NULL DEFAULT 0 CHECK (anonymous >= 0), PRIMARY KEY (tenant_id, day))`, RLS + ACL jak
agregaty I9c; liczona W PĘTLI `_data_retention_seal_funnel` (redefinicja, `-- CIALO-Z: 20261020161000`)
z `metered_views` dnia (`created_at` UTC) + **backfill w migracji** dla dni `<= sealed_through` każdego
najemcy (`INSERT … SELECT … GROUP BY … ON CONFLICT DO NOTHING`) – dni zapieczętowane przez X2 nie mają
tych liczb. Alternatywa „rozszerz `metering_events_daily`” = pseudo-wyniki (`outcome` np.
`'view_member'`/`'view_anonymous'`, brak CHECK) – bez DDL, ale miesza semantykę tabeli; pulpit filtruje
`outcome` (`FILTER (WHERE outcome='consumed')`), więc liczby się nie zdublują. Wybór do dziennika.

### A6. Pułapki (licznik)

1. **Historia czytania przeżywa w `metering_event_log` (13 mies.)** – `consumed` ma `user_id`/`visitor_id`
   i `entity_id` (wyzwalacz A1). Samo usunięcie `metered_views` po 3 mies. nie realizuje celu „art. 9”.
   Rekomendacja do decyzji: kategoria `metered_views` zeruje też w `metering_event_log` wierszach
   starszych niż jej próg `entity_id → NULL` (kolumna NULL-owalna; `outcome`, czas zostają – pulpit liczy
   po `outcome`), ewentualnie `user_id/visitor_id → NULL` (usunięcie konta i tak daje pseudonim). Dotyka
   tabeli kategorii `paywall_metering` – opisać w dzienniku jako rozszerzenie. Pokrewne poza decyzją:
   `paywall_hits` (`user_id`+`entity_id`, 13 mies.), `user_read_history` (`20260601060731`, funkcja
   „historia czytania” konta, bez retencji) – zgłoszenie Z-I9d-xx.
2. **Granica lejka**: usunięcie `metered_views` przy granicy liczonej z okresu `paywall_metering` zaniży
   `active_accounts` okien 3–13 mies. Rekomendacja: redefinicja `_data_retention_funnel_cut`
   (I9, internal, `-- CIALO-Z: 20261020161000`) – `GREATEST(purged_before, cutoff paywall_metering,
   cutoff metered_views JEŻELI kategoria włączona)`, ograniczone `sealed_through + 1` (bez zmian);
   kategoria `metered_views` pieczętuje lejek do WŁASNEGO progu (`_data_retention_seal_funnel(p_tenant,
   v_day)`) i podnosi `purged_before` (scope `funnel`) jak `paywall_metering`. Sam `purged_before` (wariant
   I9d-1) przełącza odczyt dopiero po pierwszym wykonaniu → wartość okna 3–13 mies. zmienia się
   MIĘDZY odczytem przed i po czyszczeniu (konto liczone raz na dzień vs raz na okno) – pgTAP „przed = po”
   z kontem w kilku dniach okna się zaczerwieni; jawny próg w granicy daje stabilny odczyt od wdrożenia.
   **Skutek do opisu i akceptacji:** znane granice agregatu dobowego (§21.21 pkt 4: konto raz na dzień,
   konwersja paywalla tylko z dnia uderzenia) obejmą okna starsze niż 3 mies. (dziś 13). Nie redefiniuj
   `_funnel_counts` – drugi wpis w `HUB_I9_REDEFINITIONS` jest niemożliwy (pułapka C.7).
3. **Okres bieżący**: `v_period = date_trunc('month', now())` (UTC). Warunek usuwania z podwójnym bezpiecznikiem:
   `created_at < v_cut::timestamp AT TIME ZONE 'UTC' AND period_month < date_trunc('month', now())::date`
   (minimum 2 mies. i tak chroni bieżący miesiąc; bezpiecznik chroni przed przyszłym obniżeniem minimum).
4. **Pieczęć przed usunięciem i tylko do dnia zapieczętowanego** (`v_cut := LEAST(v_day, sealed+1)`), pierwszy
   przebieg po wdrożeniu musi dopieczętować ~10 mies. (13 → 3) po 31 dni/przebieg/kategorię – zaległość
   (`backlog: true`) przez kilka nocy jest oczekiwana; usuwanie czeka na pieczęć.
5. Brak indeksu po `created_at`: DELETE/podgląd przez `period_month` (`metered_views_user_period_idx` jest
   częściowy po `user_id`) – rozważ `CREATE INDEX IF NOT EXISTS metered_views_tenant_created_idx
   (tenant_id, created_at)` pod `SET lock_timeout = '5s'` (gorąca tabela, każde czytanie artykułu).
6. `monetization_dashboard`: redefinicja w I9 wymaga znacznika **`-- CIALO-Z: 20260724100000`** (bramka:
   funkcja ma właściciela I9 i wpis `HUB_CIALO_Z`, więc NIE jest „redefinicją I9”), choć ciało kopiujesz
   z `20261020161200` – opisz to komentarzem nad definicją (jak l. 345–348 w 161200). Kształt
   odpowiedzi bez zmian; `REVOKE … FROM PUBLIC, anon` + `GRANT … TO authenticated, service_role` w tym samym
   pliku. Odczyt `mv`: część surowa `created_at >= GREATEST(_from, v_cut) AND created_at <= _to` ∪ dzienne
   `day >= _from::date AND day <= _to::date AND day < v_cut::date` (UTC, wzór `ev_rows`).
7. Podgląd karty (`admin_data_retention_preview`, STABLE) – liczba inline (`count … LIMIT c_cap`), NIE
   wołać funkcji pieczętującej (zapis w STABLE).

---

## B. `event_people` – uczestnicy wydarzeń

### B1. Schemat `public.event_people`

`supabase/migrations/20260823150000_event_people_registration.sql` l. 167–259 (kopia Lovable
`20260824085456` l. 17 – `IF NOT EXISTS`, no-op) + późniejsze kolumny:

| Kolumna | Typ / ograniczenie | Decyzja I9d |
| --- | --- | --- |
| `id`, `tenant_id` (NOT NULL FK tenants CASCADE) | `UNIQUE (tenant_id, id)` = `event_people_tenant_id_key` (cel FK złożonych) | zostaje |
| `user_id` | FK `auth.users ON DELETE SET NULL`; `event_people_tenant_user_uniq (tenant_id,user_id) WHERE user_id IS NOT NULL` | wyjątek: `user_id IS NOT NULL` = istniejące konto → pomiń |
| `email` | CHECK `event_people_email_shape`, `event_people_email_len <= 320`; **`email_norm` GENERATED** `NULLIF(lower(btrim(email)),'')`; `event_people_tenant_email_uniq (tenant_id,email_norm) WHERE email_norm IS NOT NULL` | NULL |
| `first_name`, `last_name` | **NOT NULL**, CHECK `char_length(btrim(x)) BETWEEN 1 AND 80`; `full_name_norm` GENERATED | neutralne (np. `'[redacted]'` = `DATA_RETENTION_REDACTED`, 10 zn.) – do decyzji, pkt F |
| `phone` | CHECK `btrim` 4–40 | NULL (wyzwalacz SMS – B4) |
| `job_title` (≤160), `company_text` (≤200) | | NULL |
| `company_id` | FK złożony `crm_companies (tenant_id,id) ON DELETE SET NULL (company_id)` (`20261013110500` l. 145–149) | poza listą decyzji – pkt F |
| `social_profile_url` | CHECK `~ '^https://'` | NULL |
| `notes` (≤4000) | | NULL |
| `source` | NOT NULL DEFAULT `'self_registration'`, CHECK `event_people_source_values` (najnowszy `20261013111800` l. 76–80: `self_registration, invitation, organizer, import, crm, partner, scan, package_invitation`) | zostaje |
| `consent_data_processing_at`, `consent_marketing_at`, `consent_partner_sharing_at`, `consent_withdrawn_at` | projekcja księgi zgód | **NIE ruszać** (B5) |
| `created_by` (FK auth.users SET NULL), `created_at`, `updated_at` (wyzwalacz `event_people_touch_updated_at` → `_tg_touch_updated_at`) | | zostaje; `updated_at` zmieni się przy anonimizacji – nie używać go jako „aktywności” |
| `photo_url` (CHECK https), `bio_pl`, `bio_en` (≤4000) | `20260826180000` l. 92–123 | poza listą – rekomendacja NULL (pkt F) |
| `email_visible`, `phone_visible` (bool NOT NULL DEFAULT false), `industry`, `specialization`, `seeking_pl/en`, `offering_pl/en`, `social_links jsonb NOT NULL DEFAULT '{}'` (CHECK `jsonb_typeof = 'object'`) | `20260828105751` l. 1–25 | `social_links` → `'{}'` („profil społecznościowy”); reszta – rekomendacja NULL/false (pkt F) |

Typy TS: `src/integrations/supabase/types.ts` (`event_people: { Row: …` – 36 kolumn). Brak kolumny
„zanonimizowano” – rekomendacja `event_people.anonymized_at timestamptz` (lustro `crm_leads.anonymized_at`,
`20261020161000` l. 190) pod `SET lock_timeout = '5s'`: znacznik idempotencji, filtr kandydatów, etykieta w UI.

RLS: `GRANT SELECT … TO authenticated` + polityki `event_people_staff_read` (admin/editor bieżącego
najemcy) i `event_people_self_read` (`user_id = auth.uid()` w najemcy) (l. 261–287); zapis tylko
funkcje/service_role.

Wyzwalacze na `event_people`: `event_people_touch_updated_at` (BEFORE UPDATE) oraz
**`event_people_phone_revokes_sms` AFTER UPDATE OF phone** (`20261012182000` l. 107–151): zmiana adresata
SMS → `event_registrations SET notify_sms=false, remind_sms=false, remind_sms_consent_at=NULL,
remind_sms_consent_via=NULL` dla zgłoszeń osoby. Przy `phone → NULL` odpali się (pożądane; uwzględnić w
liczniku/teście). Brak wyzwalacza mostu CRM na UPDATE.

### B2. Tabele powiązane z osobą (FK `(tenant_id, person_id)` → `event_people`)

Anonimizacja (UPDATE, nie DELETE) zachowuje wszystkie FK. Kaskady istotne, gdyby ktoś chciał kasować:
`event_registrations`, `event_group_members`, `event_lead_scans`, `event_checkins`, `event_badge_prints`,
`event_consent_records` (CASCADE – „DELETE tylko kaskadą przy usunięciu osoby”), `speaker_profiles.person_id`
(CASCADE, `20260826180000` l. 162–166), `event_cfp_*` (CASCADE), `event_person_crm_links`,
`event_person_account_unbinds` (`20261012132100` l. 100); SET NULL: `event_package_orders.buyer_person_id`,
`event_invoices.buyer_person_id` (`20260927000200` l. 432), `event_message_deliveries.person_id`.
**Nie kasować osób** – zniknęłyby obecność, zgody, leady sponsorów i statystyki.

Kopie danych osobowych POZA `event_people` (decyzja ich nie obejmuje – pkt F):
- `event_registrations`: `answers jsonb NOT NULL DEFAULT '{}'` (CHECK object), `submitted_profile jsonb`
  (dane przysłane przez niezweryfikowanego zapisującego, `20261012130600` pkt D), `participant_reason`,
  `decision_note` (CHECK `event_registrations_rejection_has_reason`: odrzucenie przez organizatora wymaga
  ≥ 3 znaków – NULL złamie CHECK; użyj `'[redacted]'`), `cancel_reason`;
- `event_cfp_submission_speakers` (`first_name, last_name, email, job_title, company_text`), `event_cfp_submissions`
  (abstrakty – publiczna treść wystąpień);
- `event_invoices` (`buyer_name/email/address…` – dowód księgowy, własna retencja);
- `event_consent_records.email_norm` (+ skrót IP, UA) – księga append-only (`_tg_event_consent_append_only`,
  UPDATE rzuca `append_only` poza akcjami FK) – dowód zgody, NIE ruszać;
- `event_consent_confirmations.email_norm` (tokeny DOI, 7 dni);
- `event_lead_scans.note` (tekst sponsora – świadomie zostaje, `20261013110200` nagłówek), `event_checkins.note`,
  `event_badge_prints.note` (notatki obsługi).

### B3. Zgłoszenia `event_registrations` (co zostaje)

`20260823150000` l. 656–… + późniejsze kolumny (types.ts `event_registrations.Row`):
`status` NOT NULL CHECK `('draft','pending','approved','rejected','waitlist','cancelled','attended','no_show')`,
`ticket_type_id`, `group_id`, `registration_mode` CHECK `('rsvp','form')`, `source` (CHECK jak osoby),
`decided_*`, `attended_at`, `cancelled_at`, `promoted_at`, `payment_status` NOT NULL DEFAULT `'not_required'`
CHECK `('not_required','unpaid','paid','partially_refunded','refunded')` (`20260830090000` l. 106–109),
`paid_at`, `paid_amount_cents/currency/recorded_at/recorded_by`, `payment_order_id`, `quoted_*`,
`refund_terms_*`, `qr_token_hash`, `badge_token_hash`, `manage_token_hash`, `consent_partner_sharing_at`,
`consent_partner_withdrawn_at` (`20261013110000` l. 42–44), `notify_*`, `remind_*`, `directory_opt_out`, `lang`.
To jest „obecność, typ biletu, status, daty, źródło” – zostaje bez zmian.

Wyzwalacze `event_registrations` są kolumnowe (`UPDATE OF status|payment_status|ticket_type_id|attended_at`)
albo z `WHEN` na `qr_token_hash`/`badge_token_hash`/`status`/`payment_status`
(`event_registrations_zz_supersede_codes` `20261013110500` l. 464, `_zz_wallet_revoke` `20261013111600` l. 283,
`_zz_badge_follows_ticket` `20261013111000` l. 218). **Nie dotykaj tych kolumn** – wtedy zmiana
`answers`/`submitted_profile`/`participant_reason` uruchomi wyłącznie `touch_updated_at`.

### B4. Płatne zamówienie – `accounting_retention_until`

- `public.accounting_retention_until(p_at timestamptz) RETURNS date` IMMUTABLE STRICT
  (`20261012121000_accounting_retention_tax_limitation.sql` l. 66–75): `make_date(EXTRACT(YEAR FROM (p_at AT
  TIME ZONE 'Europe/Warsaw'))::int + 6, 12, 31)` (Z-I9c-04: polecenie mówi 5 lat – decyzja właściciela
  otwarta; trzymaj się funkcji, nie liczby). Lustro TS `ACCOUNTING_RETENTION_YEARS_AFTER_FISCAL_YEAR`
  (`src/lib/billing/accountingRetentionRule.ts`).
- Gotowy pomocnik I9c: `_data_retention_customer_until(p_last_tx)` (`20261020161100` l. 73–83) =
  `GREATEST(accounting_retention_until(tx), 31.12 roku tx (Warszawa) + 6)` – dziś ta sama data; reużyj
  dla spójności z kategorią `crm_customers`.
- Definicja „płatnego zgłoszenia” już używana w retencji CRM (`_data_retention_crm_candidates`, 161100
  l. 386–389): `r.payment_status IN ('paid','partially_refunded','refunded')`, data
  `COALESCE(r.paid_at, r.created_at)`. Dodatkowo kupujący pakiet: `event_package_orders.buyer_person_id`
  (`20260824080000` l. 350–390; `status CHECK ('pending','paid','cancelled','refunded')`,
  `CHECK ((status IN ('paid','refunded')) = (paid_at IS NOT NULL))`) i nabywca faktury
  `event_invoices.buyer_person_id` (`issued_at`). Wyjątek: `last_paid_tx IS NOT NULL AND
  _data_retention_customer_until(last_paid_tx) >= current_date` → pomiń.

### B5. Zgody sponsorów/stoisk (lead retrieval) – czego nie wolno złamać

- Zgoda partnerska PER ZGŁOSZENIE (OPS-01, `20261013110000`): `_event_partner_consent_at(p_tenant,p_event_id,
  p_person_id) RETURNS timestamptz` (l. 63–96; STABLE, tylko service_role) – czyta NAJNOWSZE zgłoszenie osoby na
  wydarzenie i `event_people.consent_withdrawn_at`. Jedyne źródło prawdy dla: `admin_event_lead_scans_export`,
  `admin_event_lead_scans_list`, `event_lead_scans_list`, `event_sponsor_report_for_token`,
  `admin_event_sponsor_report_summary`, `admin_event_sponsor_report_leads_series`,
  `admin_event_company_sponsorships`, `admin_event_onsite_stats` (`20261013110200` nagłówek l. 19–37; skaner –
  `20261013900720_reg_main_merge2_scanner_gate.sql`).
- Księga zgód `event_consent_records` (`20261012130600` l. 263–356) append-only; projekcja w
  `event_people.consent_*` pisana WYŁĄCZNIE przez `_event_person_consents_confirm/_withdraw`
  (`20261013900700` l. 116 / 345).
- **Reguły dla anonimizacji:** (1) nie zmieniaj żadnej kolumny `consent_*` w `event_people` ani
  `consent_partner_*` w `event_registrations` – liczniki „leady ze zgodą” w raportach sponsorów zostają;
  (2) nie usuwaj `event_lead_scans` ani zgłoszeń; (3) NULL w e-mailu/telefonie sprawia, że kanały sponsora
  pokażą lead ze zgodą bez kontaktu – to zamierzony skutek po 24 mies. (opisać w rejestrze; sponsor
  dostaje dane w okresie wydarzenia); (4) nie pisz do `event_consent_records` (UPDATE = `append_only`).
- Most CRM `_event_person_crm_sync` (`20261012130800` l. 52+): przy `email` NULL kończy `skipped/email_missing`
  (l. 143–148) – ponowienie (`admin_event_person_crm_retry`) po anonimizacji nie wypchnie `[redacted]` do CRM.

### B6. Konto, prelegenci, CRM

- „Istniejące konto” = `event_people.user_id IS NOT NULL` (FK SET NULL przy usunięciu konta, więc NOT NULL ⇒
  konto żyje). Po usunięciu konta osoba staje się kandydatem wg reguły 24 mies. (żadne `_hub_account_erase*`
  nie rusza dziś `event_people`; `20261020160900` zeruje tylko `event_registrations.paid_amount_recorded_by`,
  l. 156). Odwiązanie (`admin_event_person_account_unbind`) też czyni osobę kandydatem.
- **Prelegenci bez konta** = `event_people` + `speaker_profiles.person_id` (`speaker_profiles_subject_xor`) +
  `event_speaker_entries` (publiczne karty prelegentów, `event_speakers_public`, archiwum wydarzeń).
  Anonimizacja zamieni nazwisko prelegenta na stronie publicznej – decyzja nie mówi o prelegentach (pkt F;
  rekomendacja: wyłączyć osoby z `speaker_profiles.person_id`).
- **Sprzężenie z retencją CRM** (`_data_retention_crm_candidates`, 161100 l. 372–374 i 386–389): aktywność
  i transakcja kontaktu CRM liczone przez `event_people.email_norm`. Po anonimizacji osoby (e-mail NULL)
  kontakt CRM traci ten sygnał – przy okresie wydarzeń krótszym niż CRM (np. 12 vs 36) kontakt może trafić
  do anonimizacji CRM wcześniej. Klient (płatne) – bez skutku, bo wyjątek B4 trzyma e-mail co najmniej do
  `_data_retention_customer_until`. Opisać; ewentualnie zgłoszenie (połączenie przez `event_person_crm_links`).

### B7. „Ostatni udział/rejestracja” – proponowana definicja (przypiąć pgTAP)

`GREATEST(p.created_at, max(r.created_at), max(r.attended_at), max(r.cancelled_at), max(COALESCE(e.ends_at,
e.starts_at)) po zgłoszeniach osoby (events.starts_at NOT NULL, ends_at NULL-owalne), max(c.occurred_at)
z event_checkins, max(ls.last_scanned_at) z event_lead_scans, max(o.created_at/paid_at) z event_package_orders
jako buyer, max(g.created_at) z event_group_members)`. Data wydarzenia w przyszłości chroni osobę zapisaną
dawno na odległe wydarzenie. Nie używać `updated_at` (zmienia go każda edycja i sama anonimizacja).

### B8. Harnessy i testy wydarzeń

- `check:events-harness` = `scripts/events-harness/run.sh` – wybiera migracje grepem po SUROWYM tekście
  (komentarze też!): `grep -lE 'public\.admin_event_|events_tenant_id_key|events-harness: include|FUNCTION
  public\.event_[a-z_]+\('` (l. 170) i odtwarza je na atrapie (`harness.sql`); **nie ma znacznika exclude**.
  Wybrana migracja retencji (odwołuje się do `data_retention_*`) wywróci harness. Zatem w migracjach I9d:
  żadnej funkcji `public.event_*(`, żadnego `REVOKE/GRANT … ON FUNCTION public.event_…(`, żadnego napisu
  `public.admin_event_` ani `events_tenant_id_key` (także w komentarzu). Bezpieczne: `public.event_people`,
  `public.event_registrations` (tabele), `public._event_partner_consent_at(` (podkreślnik), nazwy
  `_data_retention_event_*`. Asercje runtime: `scripts/events-harness/runtime_test.d/*.sql` (75 plików,
  np. `33_partner_consent_per_registration.sql`, `78_ops_followups.sql`, `99_registration_lifecycle.sql`).
- `check:pg-harness` łapie `public\.(club_|admin_club_)` (znacznik `-- pg-harness: exclude` + reguła
  `brak-pg-harness-exclude` w `hubDelivery.ts` dla nie-S4) – dotyczy migracji z kategorią klubów (I9d-2),
  nie tej. `check:careers-harness` łapie `public\.(career_|contact_messages)|'career-cv'` – nie wspominaj
  `public.contact_messages` w nowych plikach (I9c 161100 przeszedł, bo pętla modułu odfiltrowała).
- pgTAP wydarzeń w `supabase/tests/` (44 pliki `*event*`), m.in. `event_consent_ledger_test`,
  `event_consent_confirm_withdraw_test`, `event_consent_writers_test`, `event_identity_consents_r12_test`,
  `event_people_account_binding_test`, `event_registration_identity_integrity_test`,
  `event_registration_participant_reason_test`, `event_registration_sms_consent_test`,
  `event_attended_revenue_net_test` (wzór fikstury: `events (id, tenant_id, slug, title_pl, title_en,
  starts_at, status, timezone)`, `event_people (id, tenant_id, email, first_name, last_name)`,
  `event_registrations (id, tenant_id, event_id, person_id, status, registration_mode, payment_status)`,
  l. 40–66), `event_speaker_detail_test`. Wszystkie muszą zostać zielone (anonimizacja nie zmienia ich ścieżek).

---

## C. Mechanizm I9c-X2 – miejsca do zmiany dla dwóch nowych kategorii (skrót; pełny opis w I9d-1)

1. **CHECK-i** (DROP/ADD w nowej migracji, idempotentnie): `data_retention_settings_category_check`,
   `data_retention_settings_period_check` (`WHEN '<k>' THEN period_months IS NOT NULL AND period_months
   BETWEEN 2 AND 13` / `12 AND 36`), `data_retention_runs_category_check` (CHECK kolumnowy bez nazwy w
   `20261020161000` l. 104–106 → nazwa automatyczna `data_retention_runs_category_check` – sprawdź
   `pg_constraint` w teście).
2. **Katalog** `_data_retention_catalog()` IMMUTABLE (l. 224–247; `-- CIALO-Z: 20261020161000`) – kolejność =
   kolejność wierszy karty; proponowane klucze: `metered_views` (`'default', 3, 'min', 2, 'max', 13`) i
   `event_attendees` (`24, 12, 36`). Nazwy kluczy uzgodnić z pakietami I9d-1/-2 (jedna migracja „core”).
3. **Seed karencji dla istniejących najemców** (wzór l. 591–597): bez wiersza `_data_retention_effective` daje
   `enforce_after = tenants.created_at + 14 dni` → u istniejących najemców NOWA kategoria wykonałaby się
   od razu (bez 14 dni podglądu). Wymagane `INSERT … SELECT t.id, '<k>', <default>, true, now() + interval
   '14 days' … ON CONFLICT DO NOTHING` tylko dla nowych kluczy.
4. **Dyspozytor** `_data_retention_run_tenant` (161100 l. 706–772; `-- CIALO-Z: 20261020161100`) – CASE bez
   gałęzi zwraca NULL (cichy wiersz z `affected 0`); dodać `WHEN 'metered_views' THEN
   _data_retention_metered_views(...)`, `WHEN 'event_attendees' THEN _data_retention_event_attendees(...)`.
   Kontrakt funkcji kategorii: `(p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit int)
   RETURNS jsonb {affected, backlog, cutoff}`, `SECURITY DEFINER SET search_path = public, pg_temp`,
   `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, wsad `LIMIT p_limit FOR UPDATE SKIP LOCKED`.
5. **Podgląd** `admin_data_retention_preview()` (161400 l. 251–322; STABLE; `-- CIALO-Z: 20261020161400`;
   `REVOKE … FROM PUBLIC, anon` + `GRANT … TO authenticated, service_role`): gałęzie inline (licznik) albo
   wywołanie funkcji kategorii z `p_execute = false` (wzór `crm_*`/`audit_log`) – bez pieczęci.
6. **TS**: `src/lib/privacy/dataRetention.ts` (`DATA_RETENTION_EDITABLE_CATEGORIES` l. 19–27,
   `DATA_RETENTION_PERIODS` l. 57–67 – jedno źródło liczb), `dataRetentionParse.ts` (`category()` l. 177–186
   ODRZUCA nieznany klucz → stary front + nowa migracja = błąd karty; wdrażaj front razem albo przed),
   `dataRetention.functions.ts` (`z.enum(DATA_RETENTION_EDITABLE_CATEGORIES)` l. 123 – automatycznie),
   `src/lib/i18n-admin-data-retention.ts` (`adminDataRetention.categories.<k>.{name,what,after,basis,standard}`
   PL l. 107+, EN l. 365+; bramka `src/__tests__/i18nParity.gate.test.ts` l. 49). Karta
   (`DataRetentionCard.tsx` l. 312, `RetentionCategoryRow.tsx`) jest generyczna.
7. **Bramka dostawy** `src/lib/ci/hubDelivery.ts`: nowe funkcje w `FUNCTION_TABLE` (l. 273–313, np.
   `["_data_retention_metered_views","I9","internal"]`, `["_data_retention_event_attendees","I9","internal"]`);
   redefinicje własnych funkcji I9 (`_data_retention_*`, `admin_data_retention_*`) – bramka nie wymaga
   CIALO-Z (właściciel I9, brak wpisu `HUB_CIALO_Z`), konwencja repo – tak; `monetization_dashboard` →
   znacznik 20260724100000 (A6.6). **`HUB_I9_REDEFINITIONS` (l. 369–391) ma jedną wersję na funkcję** –
   druga redefinicja `_funnel_counts`/`admin_journey_stats`/`journey_*` w I9 zaczerwieni plik I9c.
   Lista `hub-grants` w `supabase/tests/hub_shared_helpers_test.sql` (l. 71–135) = wszystkie
   `internal/service/trigger` spoza `HUB_CIALO_Z` (przypina `hubDelivery.gate.test.ts` l. 185–198) – dopisać
   nowe funkcje. Manifest I9 (l. 818–955) zna tylko `supabase/tests/hub_i9c_*_test.sql` – dla
   `hub_i9d_*` dopisać glob. Nagłówek migracji: `DEFEKT`, `ZMIANA`, `KOLEJNOŚĆ`, `IDEMPOTENTNA`, `DOWÓD`
   (l. 1135–1141), ≤ 45 KiB (`20261020161100` ma już 44 527 B – nic do niego nie dopisuj).
8. **Testy do aktualizacji (zaczerwienią się):** `src/lib/privacy/__tests__/dataRetentionParity.test.ts`
   czyta CHECK i katalog z SZTYWNEJ ścieżki `20261020161000` (l. 31–33, 49–98) – przepiąć na najnowszą
   migrację z definicją; `supabase/tests/hub_i9c_data_retention_test.sql` l. 198 („dziewięć kategorii”)
   i l. 323 (`count(*) = 9` przebiegów) – liczba kategorii po I9d; `hub_i9c_data_retention_aggregates_test.sql`
   (`plan(23)`, l. 209–255) – sprawdzić `f_all` po przesunięciu granicy lejka (fikstura z kontami w jednym
   dniu powinna przejść; profil założony innego dnia niż uderzenie = podwójne liczenie w agregacie).
   `generate:authz-snapshot` – zmienia się plik najnowszej definicji `fn:monetization_dashboard/4`.

---

## D. Szkic funkcji kategorii (do adaptacji)

```sql
-- (I9d) Odczyty licznika: pieczęć lejka + agregat odczytów do progu, potem usunięcie.
CREATE OR REPLACE FUNCTION public._data_retention_metered_views(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_day date := (p_cutoff AT TIME ZONE 'UTC')::date;
  v_month date := date_trunc('month', now())::date;   -- bieżący okres licznika: nietykalny
  v_seal jsonb; v_cut date; v_n integer := 0;
BEGIN
  v_seal := public._data_retention_seal_funnel(p_tenant, v_day);  -- liczy też metered_views_daily
  v_cut := LEAST(v_day, (v_seal ->> 'sealed_through')::date + 1);
  IF p_execute THEN
    WITH doomed AS (SELECT mv.id FROM public.metered_views mv
       WHERE mv.tenant_id = p_tenant AND mv.period_month < v_month
         AND mv.created_at < v_cut::timestamp AT TIME ZONE 'UTC'
       ORDER BY mv.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    DELETE FROM public.metered_views mv USING doomed d WHERE mv.id = d.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    -- (opcja A6.1) UPDATE metering_event_log SET entity_id = NULL WHERE … occurred_at < v_cut …
    UPDATE public.data_retention_state st
       SET purged_before = GREATEST(COALESCE(st.purged_before, v_cut), v_cut), updated_at = now()
     WHERE st.tenant_id = p_tenant AND st.scope = 'funnel';
  ELSE
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_n FROM (SELECT 1 FROM public.metered_views mv
      WHERE mv.tenant_id = p_tenant AND mv.period_month < v_month
        AND mv.created_at < v_cut::timestamp AT TIME ZONE 'UTC' LIMIT p_limit) x;
  END IF;
  RETURN jsonb_build_object('affected', v_n,
    'backlog', v_n >= p_limit OR NOT COALESCE((v_seal ->> 'complete')::boolean, false),
    'cutoff', v_cut::timestamp AT TIME ZONE 'UTC');
END $$;
REVOKE ALL ON FUNCTION public._data_retention_metered_views(uuid, timestamptz, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
```

Anonimizacja uczestnika – kandydaci: `p.tenant_id = p_tenant AND p.user_id IS NULL AND p.anonymized_at IS NULL
AND <ostatnia aktywność B7> < p_cutoff AND NOT <płatne B4 z terminem >= current_date> [AND NOT EXISTS
speaker_profiles sp WHERE sp.tenant_id = p.tenant_id AND sp.person_id = p.id]` `ORDER BY … LIMIT p_limit
FOR UPDATE OF p SKIP LOCKED`; UPDATE: `first_name/last_name = <neutralne>`, `email, phone, job_title,
company_text, social_profile_url, notes = NULL`, `social_links = '{}'`, [pkt F: `photo_url, bio_*, industry,
specialization, seeking_*, offering_* = NULL`, `email_visible/phone_visible = false`], `anonymized_at = now()`;
consent_* bez zmian. Podgląd: ta sama selekcja `count … LIMIT`.

---

## Rekomendacja wdrożenia

**Wersje (sprawdź tuż przed nadaniem):** najwyższa migracja `20261020161400_data_retention_panel.sql`;
najwyższy bliźniak `drizzle/migrations/0372_data_retention_panel.sql` (`meta/_journal.json` idx 372,
`when` 1792477933912; kolejne `when` **+60 000** – tak jest w dzienniku, prompt pisze „- 60000”). S7
rezerwuje `20261020150000/150100` z bliźniakami `0373/0374` (prompt §7.2) – na gałęzi PR ich jeszcze nie ma.
I9d: wersje `2026102016` od `161500`; bliźniaki od `0375` (po S7) albo `0373` (jeśli S7 jeszcze nie
zintegrowane) – kolejność dziennika drizzle = kolejność wersji.

**Wspólny plan z I9d-1/I9d-2 (jeden zestaw migracji dla wszystkich kategorii Y1, żeby katalog, CHECK-i,
dyspozytor i podgląd redefiniować RAZ):**

1. `20261020161500_data_retention_categories_core.sql` (bliźniak `0375_…`/`0373_…`): CHECK ×3 z nowymi
   kluczami i zakresami (`metered_views` 2–13, `event_attendees` 12–36, + klucze I9d-1/-2),
   `_data_retention_catalog` (CIALO-Z 20261020161000), seed karencji nowych kluczy (+14 dni), tabela
   `metered_views_daily` (RLS, REVOKE, GRANT service_role), `event_people.anonymized_at`
   (`SET lock_timeout = '5s'`), opcjonalny indeks `metered_views (tenant_id, created_at)`,
   `_data_retention_seal_funnel` (CIALO-Z 20261020161000; + `metered_views_daily` w pętli),
   `_data_retention_funnel_cut` (CIALO-Z 20261020161000; + próg `metered_views`), backfill
   `metered_views_daily` dla dni `<= sealed_through`.
2. `20261020161600_data_retention_categories_executor.sql`: `_data_retention_metered_views`,
   `_data_retention_event_attendees` (+ ewentualnie pomocnik `_data_retention_anonymize_event_person`),
   funkcje kategorii I9d-1/-2, `_data_retention_run_tenant` (CIALO-Z 20261020161100).
3. `20261020161700_data_retention_categories_reads.sql`: `monetization_dashboard` (`-- CIALO-Z: 20260724100000`,
   ciało z 161200 + `metered_views_daily` dla dni `< cut`).
4. `20261020161800_data_retention_categories_panel.sql`: `admin_data_retention_preview` (CIALO-Z 20261020161400)
   z gałęziami nowych kategorii (+ RPC I9d-1/-2).
   Każdy plik: nagłówek PL, ≤ 45 KiB (`bun run scripts/split-migration.ts <plik> --dry-run`), bez wzorców
   harnessu wydarzeń (B8), bliźniak `cp` bajt w bajt + wpis journala, `bun run check:migration-lanes`.

**TS / pliki współdzielone (integrator I9):** `src/lib/privacy/dataRetention.ts`, `dataRetentionParse.ts`
(+ test), `src/lib/i18n-admin-data-retention.ts` (PL/EN: nazwa, co, po upływie, podstawa – art. 5 ust. 1
lit. c i e, art. 9 dla licznika; art. 6 ust. 1 lit. b/f dla wydarzeń; standard), `reports/i18n-parity.json`,
`src/integrations/supabase/types.ts` (`metered_views_daily`, `event_people.anonymized_at`),
`src/lib/ci/hubDelivery.ts` (FUNCTION_TABLE, manifest `hub_i9d_*`, komentarz integratora),
`supabase/tests/hub_shared_helpers_test.sql` (`hub-grants`), `src/lib/authz/authzSnapshot.generated.ts`
(`bun run generate:authz-snapshot`), ewentualnie `scripts/check-bundle-size.ts` (słownik w leniwym chunku
karty – ratchet `overall` z kroniką). Bez zmian: `src/routes/admin.monetization.tsx` (kształt RPC ten sam),
`jobsTick.server.ts` (dyspozytor przechodzi katalog), kod modułu wydarzeń (`src/lib/events/**` poza
manifestem I9 – nie ruszać).

**Testy:**
- pgTAP nowy `supabase/tests/hub_i9d_retention_meter_events_test.sql` (glob w manifeście I9):
  licznik – usuwa tylko `created_at < próg` i nigdy `period_month = bieżący`; gość i konto; okno sprzed progu
  (`monetization_dashboard -> 'metered_views'`, `_funnel_counts` z `active_accounts`) identyczne przed
  i po wykonaniu; granica lejka = próg licznika przy włączonej kategorii; podgląd nic nie usuwa
  (najemca w karencji); idempotencja (powtórka 0); backfill agregatu dla dnia już zapieczętowanego.
  Uczestnicy – anonimizacja tylko po 24 mies. od B7 (osoba z rejestracją 23 mies. temu i z przyszłym
  wydarzeniem zostaje), wyjątki: `user_id` NOT NULL, płatne zgłoszenie/pakiet z terminem
  `accounting_retention_until` w przyszłości (sprzed 8 lat – anonimizowane), [prelegent]; NOT NULL i CHECK-i
  spełnione; consent_* i `_event_partner_consent_at` bez zmian; `event_lead_scans`, zgłoszenia (status,
  bilet, obecność, źródło, daty) bez zmian; licznik leadów ze zgodą w raporcie sponsora bez zmian; `phone
  → NULL` wyłącza SMS na zgłoszeniach; ACL nowych funkcji (żadna rola API) i tabeli; idempotencja.
- Aktualizacje: `hub_i9c_data_retention_test.sql` (l. 198, 323, `plan`), `hub_i9c_data_retention_aggregates_test.sql`
  (dodać `-> 'metered_views'`), `dataRetentionParity.test.ts` (ścieżka migracji + nowe klucze),
  `dataRetentionParse.test.ts`, `DataRetentionCard.test.tsx` (wiersze nowych kategorii, axe).
- Bramki: prompt §5 pkt 4; szczególnie `check:events-harness` (żadna nowa migracja nie może zostać wybrana –
  w logu liczba migracji modułu bez zmian, 278 wg §21.21), `check:pg-harness`, `check:careers-harness`,
  `hub-slice-guard I9 --base <BAZA>`, pełne `run.sh all` (metering_*, event_*, security_definer_*,
  `hub_i9b_account_erasure_sweep` – asercja kompletności kolumn uuid l. 709–750: nowa kolumna uuid bez FK
  wzorca `*_by|user_id…` zaczerwieni).

**Dokumenty:** dziennik „21.x RODO – decyzje właściciela 2 (I9d-Y1)” (tabela decyzji, kontrolny SQL:
`SELECT category, count(*) FROM data_retention_settings GROUP BY 1`, `SELECT tenant_id, sealed_through,
purged_before FROM data_retention_state WHERE scope='funnel'`, `SELECT count(*) FROM metered_views WHERE
created_at < now() - interval '3 months'`, `SELECT count(*) FROM event_people WHERE anonymized_at IS NOT NULL`);
§21.21 Z-I9c-07 → „Zamknięte (I9d, §21.x)”; rejestr czynności: wpis 2 (okres `metered_views` 3 mies.,
agregat `metered_views_daily`) i NOWY wpis „Uczestnicy wydarzeń” (kategorie danych, podstawa, okres 24 mies.,
wyjątki, sponsorzy); runbook (§9): przełączniki, kolejność migracji, kontrolny SQL.

## Otwarte pytania / ryzyka

1. **Historia czytania w `metering_event_log` (13 mies.)** – bez redakcji `entity_id` (A6.1) cel art. 9
   nie jest osiągnięty; czy kategoria licznika ma też redagować dziennik (i `paywall_hits.entity_id`)? Poza
   decyzją: `user_read_history` (funkcja konta, bez retencji).
2. **Przesunięcie granicy lejka na 3 mies.** – okna 3–13 mies. liczone z agregatu dobowego (konto raz na
   dzień, konwersja z dnia uderzenia). „Bez zmian przed/po czyszczeniu” – tak; „bez zmian względem dziś” –
   nie dla okien wielodniowych. Wymaga akceptacji i dymku w panelu lejka (S3/S6 `MetricExplainer`).
3. **Neutralne imię/nazwisko**: `'[redacted]'` (konwencja repo, `DATA_RETENTION_REDACTED`) vs tekst
   językowy („Uczestnik”/„zanonimizowany”) – UI wydarzeń pokaże wartość dosłownie; z `anonymized_at` można
   renderować etykietę i18n (wymaga zmian w module wydarzeń poza manifestem I9).
4. **Zakres pól**: decyzja nie wymienia `photo_url` (+ plik w storage, który zostanie!), `bio_*`,
   `industry`, `specialization`, `seeking_*`, `offering_*`, `company_id`, ani kopii w
   `event_registrations` (`answers`, `submitted_profile`, `participant_reason`, `decision_note`,
   `cancel_reason`) i `event_cfp_submission_speakers`. Rekomendacja: objąć (jak „wszystkie pola tekstu
   własnego” przy klubach), `company_id` zostawić (statystyki firm/sponsorów) – do potwierdzenia.
5. **Prelegenci bez konta** (publiczne karty, archiwum) – wyłączyć z kategorii czy anonimizować?
6. **Usunięcie konta** – czy osoba z kontem ma być anonimizowana od razu przy usunięciu konta (dziś tylko
   `user_id → NULL`, dalej 24 mies.)? Decyzja mówi „historia w profilu do usunięcia konta”.
7. **Sprzężenie z CRM** (B6): okres wydarzeń < okres CRM przyspiesza anonimizację kontaktu CRM; klient
   chroniony wyjątkiem B4.
8. **Karencja**: seed +14 dni dla nowych kluczy, ale „Włącz teraz”/„Przesuń” (161400 l. 204–245) przestawia
   wszystkie kategorie naraz – czy nowe kategorie mają mieć własny podgląd po kliknięciu admina?
9. **Kolejność wdrożenia**: parser TS odrzuca nieznaną kategorię → front przed albo razem z migracją; stary
   front z nową migracją = błąd karty (nie danych).
10. Numery bliźniaków vs S7 (`0373/0374`) i kolizja wersji z pakietami I9d-1/-2 – jedna migracja „core”
    dla wszystkich kategorii Y1, rozdział decyduje orkiestrator.
11. Wydajność: pierwsze noce po wdrożeniu – dopieczętowanie ~10 mies. lejka (31 dni/przebieg) i skan
    `metered_views` bez indeksu po `created_at`; anonimizacja osób – podzapytania B7 per kandydat
    (indeksy istnieją: `event_registrations_person_idx`, `event_checkins_person_idx`,
    `event_lead_scans_person_idx`; sprawdzić plan `EXPLAIN` na fikstur ze skalą).
