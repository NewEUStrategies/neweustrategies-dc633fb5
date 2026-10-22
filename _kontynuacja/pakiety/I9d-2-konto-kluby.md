# Pakiet I9d-2: konto i kluby. Anonimizacja zgłoszeń do klubów (Z-I9c-01)

Stan repo: gałąź PR #530, HEAD `75133fe20`. Najwyższa migracja: `20261020161400_data_retention_panel.sql`.
Najwyższy bliźniak drizzle: `0372_data_retention_panel.sql` (journal idx 372, `when` 1792477933912).
S7 ma zarezerwowane `20261020150000/150100` oraz bliźniaki `0373/0374` (prompt §7.2), więc po S7
pierwszy wolny numer to `0375`.

Zadanie: `docs/PROMPT_KONTYNUACJI_HUB_2026-10-20.md:490-548` (§8.1 pkt 1a, 1b, 5 i 6).

---

## 0. Najważniejsze ustalenia (czytaj najpierw)

1. **Anonimizacja zgłoszeń przy usunięciu konta już CZĘŚCIOWO istnieje, a dziennik i rejestr o tym
   nie mówią.** `public.anonymize_club_applications_for_user(_user_id uuid)` (najnowsza definicja
   `20260811151210_e49a2850-…sql:248-288`, wcześniej `20260811150000_…a35…sql:1004-1044`) czyści
   14 kolumn tekstowych. Woła ją wyzwalacz **BEFORE** `on_auth_user_deleted_retain_accounting` →
   `tg_auth_user_deleted_retain_accounting()` (najnowsza definicja `20260811151210:322-339`), a
   wywołanie siedzi w bloku `EXCEPTION WHEN OTHERS THEN NULL`, więc błąd przepada po cichu.
   Funkcja NIE rusza kolumn: `user_id` (zostaje surowy uid), `languages`, `availability`,
   `crm_lead_id`, `crm_error` i `notify_error`. Opis Z-I9c-01 w dzienniku (`WDROZENIE…:3681`) i w
   rejestrze (`RODO_REJESTR…:229-232`) mówi, że zostają „imię, e-mail i motywacja”. To nieścisłość:
   w praktyce zostaje surowy `user_id`, języki, dostępność, powiązanie z CRM i teksty błędów.
2. **Pseudonim konta v8** to `public._hub_erasure_surrogate()` (`20261020160500:61-74`): losowy
   UUID, w którym cyfra wersji na pozycji 15 jest podmieniona na `8`. Kolumny NOT NULL w
   `_hub_account_erase_modules` dostają `p_surrogate` (jeden na konto), na przykład
   `wp_import_jobs.actor_id`, `role_audit_log.*`, `club_moderation_log.target_id`
   i `user_read_history.user_id` (`20261020160900:272-289, 326-330`). Testy rozpoznają pseudonim
   po `substr(x::text, 15, 1) = '8'`.
3. **Statusu „wycofane” nie ma.** `club_applications_status_chk` dopuszcza tylko
   `'pending','review','accepted','rejected','needs_info'` (`20260811114031:24-27`). Nie ma też RPC
   wycofania. Status „withdrawn” występuje jedynie jako przypadek negatywny w
   `src/lib/clubs/__tests__/applicationNotify.functions.test.ts:222`.
4. **„Koniec członkostwa” nie ma własnej kolumny.** `club_members` nie ma `left_at` ani `ended_at`.
   Wyjście z klubu ustawia `status='left'`, ban ustawia `'banned'`, admin może skasować wiersz
   (`admin_club_member_remove`), a usunięcie konta lub klubu działa przez kaskadę. Szczegóły w §4.
5. **Asercja 29** to `supabase/tests/hub_i9b_account_erasure_sweep_test.sql:708-754`. Kolumna
   `club_applications.user_id` stoi na jawnej liście (l. 750-752) w grupie „Zgłoszenie Z-I9c-01”.
   Zdanie „wypada z wyjątków” znaczy, że kolumnę **przenosimy do grupy redakcji**
   (`_hub_account_erase` / `_hub_account_erase_modules`). Kolumna musi pozostać w tablicy, inaczej
   asercja zaczerwieni się, bo kolumna wzorca `user_id` bez klucza obcego zostanie wtedy bez
   klasyfikacji.

---

## 1. Ścieżka usunięcia konta (stan obecny)

### 1.1 Wyzwalacze na `auth.users`

Kolejność: najpierw wyzwalacze BEFORE, potem kaskady FK, na końcu AFTER. Wyzwalacze tego samego
typu odpalają się alfabetycznie (`20261020160700:43-52`).

| Wyzwalacz | Typ | Funkcja (najnowsza definicja) | Co robi z klubami |
| --- | --- | --- | --- |
| `on_auth_user_deleted_redact_revenue` | BEFORE | `tg_auth_users_revenue_redact` (`20261020160400`) | nic |
| `on_auth_user_deleted_retain_accounting` | BEFORE | `tg_auth_user_deleted_retain_accounting()` (`20260811151210:322`; trigger założony w `20260805114540:131-134`) | `anonymize_club_applications_for_user(OLD.id)` w `EXCEPTION WHEN OTHERS THEN NULL` |
| kaskady FK | - | - | `club_members.user_id … ON DELETE CASCADE` (`20260808090000:199`), więc członkostwo konta znika |
| `on_auth_user_deleted_redact_hub` | AFTER | `tg_auth_users_hub_erasure()` (`20261020160700:254-279`) | `_hub_account_erase(OLD.id, _hub_erasure_surrogate(), OLD.email)` |

Błąd w `_hub_account_erase` **przerywa** usunięcie konta (`20261020160700:52-54`). Błąd w
anonimizacji klubowej wyzwalacza BEFORE jest połykany.

### 1.2 Funkcje (sygnatury, wersje, granty)

| Funkcja | Najnowsza definicja (dla `-- CIALO-Z`) | Granty |
| --- | --- | --- |
| `public._hub_account_erase(p_user_id uuid, p_surrogate uuid, p_email text DEFAULT NULL) RETURNS integer` | `20261020160900:536-697` (znacznik `CIALO-Z: 20261020160700` na l. 536) | `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` |
| `public._hub_account_erase_modules(p_user_id uuid, p_surrogate uuid) RETURNS integer` | `20261020160900:131-343` (jedyna definicja) | jw. |
| `public._hub_account_erase_orphans() RETURNS integer` | `20261020160900:700-813`; wywołanie domknięcia na l. 815 | jw. |
| `public._hub_erasure_surrogate() RETURNS uuid` (sql, VOLATILE) | `20261020160500:61-74` | jw. |
| `public.anonymize_club_applications_for_user(_user_id uuid) RETURNS integer` (sprzed huba, `SET search_path = public` bez `pg_temp`) | `20260811151210:248-288` | `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role` |
| `public.tg_auth_user_deleted_retain_accounting()` (sprzed huba) | `20260811151210:322-339` | - |

Wszystkie funkcje `_hub_*` mają `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`.

Punkt wywołania `_hub_account_erase` (`20261020160900:537-688`) wykonuje kolejno:

- `_funnel_erase_account`;
- `_hub_account_erase_mail_queue`;
- odcięcie `crm_leads.user_id/owner_id` jako zaufany pisarz;
- newsletter, historię etapów i autorów konfiguracji;
- `audit_log`;
- **`_hub_account_erase_modules(p_user_id, p_surrogate)`** (l. 682);
- `_journeys_erase_account`, a na końcu `_domain_events_erase_account` (l. 685-686).

Moduły idą przed redakcją szyny, więc zdarzenia emitowane przez zmiany w modułach też są
redagowane.

Treść `_hub_account_erase_modules`, w kolejności sekcji:

1. Z-I9b-11 (l. 148-159): `club_applications.reviewed_by = NULL` (l. 153) oraz
   `event_registrations.paid_amount_recorded_by = NULL`.
2. Autorzy w kreatorze i CMS → NULL.
3. Konta, zgłoszenia, kontakt, rekrutacja i zadania → NULL. `user_invitations` idzie pod
   `_set_request_identity(NULL,'service_role',…)`. Na końcu sekcji
   `payment_webhook_events_redact_for_user`.
4. **„Kolumna NOT NULL i dzienniki rozliczalności → pseudonim konta”** (l. 272-289): `wp_import_jobs`,
   `role_audit_log` i `club_moderation_log` (cel `member`). **Tu dopisać zgłoszenia do klubów.**
5. Dane własne → DELETE. Historia czytania → pseudonim (l. 326-330).

Każdy krok ma postać `GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;`.

Wzorzec pseudonimizacji kolumny NOT NULL (cytat z l. 280-288):

```sql
UPDATE public.role_audit_log x
   SET actor_id = CASE WHEN x.actor_id = p_user_id THEN p_surrogate ELSE x.actor_id END, …
UPDATE public.club_moderation_log x SET target_id = p_surrogate
 WHERE x.target_type = 'member' AND x.target_id = p_user_id;
```

Domknięcie wstecz (`_hub_account_erase_orphans`, l. 700-813) działa tak:

- zbiera `UNION` kandydatów tekstowych z kolumn przeglądu;
- filtruje je wzorcem v4 `c_v4 = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`
  i `NOT EXISTS auth.users`;
- dla każdego uid woła `_hub_account_erase(r.u, _hub_erasure_surrogate(), NULL)`.

Kolumna klubowa jest dziś na liście tylko jako `UNION SELECT x.reviewed_by::text FROM
public.club_applications x` (l. 751). **Trzeba dopisać** `UNION SELECT x.user_id::text FROM
public.club_applications x`. Druga runda zwraca 0, bo pseudonim ma wersję 8.

### 1.3 Istniejąca `anonymize_club_applications_for_user` (cytat)

```sql
UPDATE public.club_applications
   SET first_name='', last_name='', email='', phone='', linkedin_url='', city='', company='',
       job_position='', motivation='', goals='', contribution='', expertise='',
       referral_source='', admin_note='', updated_at=now()
 WHERE user_id = _user_id;
```

Jedyny test tej funkcji to pg-harness `scripts/pg-harness/runtime_test.sql:2410-2431` (A35.7).
Asercja szuka wierszy **po `user_id`** po anonimizacji, a funkcja ma zwracać liczbę wierszy (`= 2`).
Jeśli zmienisz tę funkcję tak, by podmieniała `user_id`, harness się wywróci. pgTAP tej funkcji nie
testuje.

---

## 2. Schemat `public.club_applications`

Tabela powstała w `20260811111733_14e9070e-…sql:6-44`, kolumny CRM dodała migracja
`20260811114031_2ce402fd-…sql:1-27`. Późniejsze migracje nie zmieniają kolumn (sprawdzone grepem
`ALTER TABLE public.club_applications`).

| Kolumna | Typ / NULL / domyślna | Klasa | Po anonimizacji (decyzja §8.1 pkt 1a) |
| --- | --- | --- | --- |
| `id` | uuid PK `gen_random_uuid()` | klucz | zostaje |
| `tenant_id` | uuid NOT NULL (bez FK) | najemca | zostaje |
| `user_id` | uuid NOT NULL (bez FK do `auth.users`) | **identyfikator konta** | → pseudonim v8 |
| `specialization_slug` | text NOT NULL | specjalizacja | zostaje |
| `club_id` | uuid NULL, FK `clubs(id) ON DELETE SET NULL` | klub | zostaje |
| `first_name` | text NOT NULL (**bez domyślnej**) | kontakt | `''` |
| `last_name` | text NOT NULL DEFAULT `''` | kontakt | `''` |
| `email` | text NOT NULL (**bez domyślnej**, bez CHECK formatu) | kontakt | `''` |
| `phone` | text NOT NULL DEFAULT `''` | kontakt | `''` |
| `company` | text NOT NULL DEFAULT `''` | firma | `''` |
| `job_position` | text NOT NULL DEFAULT `''` | stanowisko | `''` |
| `seniority` | text NOT NULL DEFAULT `''` | **zgrubne (staż)** | zostaje |
| `industry` | text NOT NULL DEFAULT `''` | **zgrubne (branża)** | zostaje |
| `country` | text NOT NULL DEFAULT `''` | **zgrubne (kraj)** | zostaje |
| `city` | text NOT NULL DEFAULT `''` | miasto | `''` |
| `linkedin_url` | text NOT NULL DEFAULT `''` | profil społecznościowy | `''` |
| `years_experience` | integer NULL | **zgrubne (lata doświadczenia)** | zostaje |
| `expertise` | text NOT NULL DEFAULT `''` | tekst własny (doświadczenie) | `''` |
| `languages` | text NOT NULL DEFAULT `''` | tekst własny (języki) | `''` (**dziś nie czyszczone**) |
| `motivation` | text NOT NULL DEFAULT `''` | tekst własny | `''` |
| `goals` | text NOT NULL DEFAULT `''` | tekst własny | `''` |
| `contribution` | text NOT NULL DEFAULT `''` | tekst własny (wkład) | `''` |
| `availability` | text NOT NULL DEFAULT `''` | tekst własny (dostępność) | `''` (**dziś nie czyszczone**) |
| `referral_source` | text NOT NULL DEFAULT `''` | tekst własny (źródło polecenia) | `''` |
| `consent` | boolean NOT NULL DEFAULT false | zgoda (flaga) | zostaje (proponuję) |
| `marketing_consent` | boolean NOT NULL DEFAULT false | zgoda (flaga) | zostaje (proponuję; dowód zgody jest w `crm_consent_log`) |
| `tier_key` | text NOT NULL DEFAULT `''` | **warstwa (klucz)** | zostaje |
| `tier_rank` | integer NOT NULL DEFAULT 0 | **warstwa (ranga)** | zostaje |
| `status` | text NOT NULL DEFAULT `'pending'`, CHECK `club_applications_status_chk` | status | zostaje |
| `admin_note` | text NOT NULL DEFAULT `''` | wolny tekst komisji o osobie | `''` (tak robi dzisiejsza funkcja; decyzja go nie wymienia) |
| `reviewed_by` | uuid NULL | autor decyzji (personel) | bez zmian (I9c → NULL przy usunięciu konta personelu) |
| `reviewed_at` | timestamptz NULL | **data decyzji** | zostaje |
| `lang` | text NOT NULL DEFAULT `'pl'` | język formularza | zostaje |
| `created_at` | timestamptz NOT NULL DEFAULT now() | data | zostaje |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | data | wyzwalacz przesuwa ją na now() (Z-I9c-03) |
| `crm_lead_id` | uuid NULL (bez FK) | **powiązanie z kontaktem CRM, który zostaje (wyjątek)** | proponuję NULL (inaczej da się ponownie zidentyfikować wiersz) |
| `crm_sync_status` | text NOT NULL DEFAULT `'pending'`, CHECK `club_applications_crm_sync_status_chk` (`'pending','ok','error'`) | techniczna | zostaje |
| `crm_synced_at`, `crm_last_attempt_at` | timestamptz NULL | techniczna | zostaje |
| `crm_error` | text NULL | tekst błędu (SQLERRM może cytować e-mail) | proponuję NULL |
| `notified_status` | text NULL | techniczna | zostaje |
| `notified_at` | timestamptz NULL | techniczna | zostaje |
| `notify_error` | text NULL | tekst błędu | proponuję NULL |

Wszystkie kolumny tekstowe NOT NULL przyjmują `''`: tabela nie ma CHECK na format ani niepustość.

**CHECK:** `club_applications_status_chk`
(`status IN ('pending','review','accepted','rejected','needs_info')`, `20260811114031:24-27`) oraz
`club_applications_crm_sync_status_chk`.

**Indeksy:**

- `club_applications_tenant_created_idx (tenant_id, created_at DESC)`;
- `club_applications_spec_idx (tenant_id, specialization_slug, created_at DESC)`;
- `club_applications_club_idx (club_id) WHERE club_id IS NOT NULL`;
- `club_applications_user_idx (user_id, created_at DESC)`;
- **UNIQUE `club_applications_open_unique_idx (user_id, specialization_slug) WHERE status IN
  ('pending','review','needs_info')`** (najnowsza definicja `20260811151703:6-12`).

Jeden pseudonim na konto nie zderza się z tym indeksem, bo to samo konto nie mogło mieć dwóch
otwartych zgłoszeń jednej specjalizacji. Retencja nie dotyka statusów otwartych.

**Wyzwalacze:**

- `club_applications_touch_updated_at`: BEFORE UPDATE, `_tg_touch_updated_at()` (`20260811111733:71-73`);
- `trg_club_applications_emit`: **AFTER INSERT OR UPDATE OF status** (`20261020130500:116-119`).
  Emituje `club_application.submitted.v1` i `club_application.decided.v1` z ładunkiem
  `club_id, application_id, user_id, specialization[, status]`. Anonimizacja bez zmiany `status`
  **nie emituje** zdarzeń. `user_id` w ładunkach starszych zdarzeń redaguje
  `_domain_events_erase_account`.

**RLS i granty:**

- `ENABLE ROW LEVEL SECURITY`;
- `GRANT SELECT … TO authenticated`, `GRANT ALL … TO service_role` (`20260811111733:55-58`);
- polityki SELECT:
  - `club_applications_select_own`: `user_id = auth.uid() AND tenant_id = (profil)`, najnowsza
    definicja `20260811151703:14-20`;
  - `club_applications_select_admin`: `has_role(admin) AND tenant_id = (profil)`, `20260811111733:64-69`;
- polityk INSERT/UPDATE/DELETE nie ma; zapis idzie wyłącznie przez RPC SECURITY DEFINER.

**Statusy:**

- otwarte („oczekujące”): `pending`, `review`, `needs_info` (komisja czeka; `20260811150000:100-136`);
- decyzje: `accepted`, `rejected`;
- „wycofane”: brak (patrz §0.3).

**Data decyzji:** `admin_club_application_set_status` ustawia `reviewed_by = auth.uid(), reviewed_at
= now()` przy **każdej** zmianie statusu, także przy powrocie do `pending`/`review`
(`20260811150000:492-614`, l. 527-534). Dla `rejected`/`accepted` `reviewed_at` jest więc czasem
ostatniej decyzji.

**RPC i czytelnicy:**

| Obiekt | Najnowsza definicja | Uwaga |
| --- | --- | --- |
| `club_apply_submit(p jsonb) RETURNS uuid` | `20260811151703` (~l. 22-160) | `user_id = auth.uid()` |
| `admin_club_application_set_status(uuid, text, text DEFAULT NULL) RETURNS void` (GRANT authenticated) | `20260811150000:492-614` | przy `accepted` robi `INSERT club_members(user_id = v_app.user_id …)`; **dla zanonimizowanego zgłoszenia z pseudonimem** dostaniesz FK 23503 (`club_members.user_id → auth.users`). Problem istniał już dziś (surowy uid bez konta) |
| `admin_club_applications_list(text, uuid, text, text, integer)` (GRANT authenticated) | `20260811151703:224-283` | zwraca wszystkie kolumny PII; szuka po `email`, imieniu i `company` |
| `admin_club_applications_counts()` | `20260811111733:243-260` | liczy po statusie |
| `club_application_crm_sync(uuid)` (hub S4) | `20261020130500` (CIALO-Z z `20261007140710`) | pusty e-mail daje `crm_email_required`, a to ląduje jako `crm_sync_status='error'` (bez PII) |
| `admin_club_application_crm_retry`, `admin_club_application_notify_payload`, `admin_club_application_mark_notified` | `20260811114031:87-160` | wysyłka maila przy pustym e-mailu zwraca `not_found` (`src/lib/clubs/applicationNotify.functions.ts:69`) |
| `club_my_applications()` | `20260811151210:290-313` | po `auth.uid()`; zanonimizowane wiersze znikają z widoku kandydata |
| `club_export_my_data(integer)` | `20260811151210:1-245` | po `user_id = v_uid` |
| `admin_revenue_clubs_summary(p_since timestamptz, p_until timestamptz) RETURNS jsonb` | `20261020130700:213-…` (`pg-harness: exclude`) | liczy `count(*)` po `status`, `created_at` i `reviewed_at`; **nie** liczy po `user_id`. Agregaty zostają bez zmian |
| S7 `_revenue_facts_clubs` (w toku) | blok 15 | czyta `club_applications` |

TS:

- `src/lib/clubs/applyApi.ts:15` (`ClubApplicationAdminRow`), `:192-201` (RPC listy);
- `src/lib/clubs/adminApplicationsInbox.ts:50` (`APPLICATION_STATUSES`);
- UI `src/components/admin/clubs/molecules/ClubInboxRow.tsx:97-101` (renderuje `first_name last_name`
  i `email · company · job_position`; po anonimizacji pokaże pusty wiersz) oraz
  `src/components/admin/clubs/organisms/ClubApplicationsInbox.tsx`;
- i18n panelu: `src/lib/i18n-clubs-admin.ts` (`adminClubs.applications.*`, PL od l. 29, EN od l. 598);
  istniejący klucz `club.deletedAuthor: "Konto usunięte"` jest w `src/lib/i18n-club.ts:899`.

---

## 3. Gdzie wpiąć anonimizację po usunięciu konta (1a)

Decyzja właściciela: rozszerzyć istniejący punkt wywołania, bez nowego wyzwalacza.

- Miejsce: `_hub_account_erase_modules`, sekcja 4 (kolumny NOT NULL → pseudonim), obok
  `club_moderation_log`.
- `_hub_account_erase` zostaje bez zmian, bo już woła moduły.
- `user_id = p_surrogate`, czyli ten sam pseudonim co w lejku, szynie i audycie.
- Pozostałe kolumny według tabeli z §2.
- Nie polegaj na wyzwalaczu BEFORE: połyka błędy i pomija 6 kolumn. AFTER robi całość, więc jest
  idempotentny niezależnie od tego, co zrobił BEFORE.
- Warunek `WHERE a.user_id = p_user_id` działa także po BEFORE, bo BEFORE nie rusza `user_id`.

Szkic: jedna funkcja wspólna dla 1a i 1b, żeby lista kolumn nie rozjechała się między ścieżkami.

```sql
-- ZMIANA I9d: jedna lista kolumn zgłoszenia do klubu (usunięcie konta i retencja).
CREATE OR REPLACE FUNCTION public._club_applications_anonymize(p_ids uuid[], p_surrogate uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  WITH u AS (SELECT DISTINCT a.user_id FROM public.club_applications a
              WHERE a.id = ANY (p_ids) AND substr(a.user_id::text, 15, 1) <> '8'),
       s AS (SELECT u.user_id, COALESCE(p_surrogate, public._hub_erasure_surrogate()) AS sur FROM u)
  UPDATE public.club_applications a
     SET user_id = s.sur, first_name = '', last_name = '', email = '', phone = '', company = '',
         job_position = '', city = '', linkedin_url = '', expertise = '', languages = '',
         motivation = '', goals = '', contribution = '', availability = '', referral_source = '',
         admin_note = '', crm_lead_id = NULL, crm_error = NULL, notify_error = NULL
    FROM s WHERE a.user_id = s.user_id AND a.id = ANY (p_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._club_applications_anonymize(uuid[], uuid) FROM PUBLIC, anon, authenticated, service_role;
```

Dla 1b `p_surrogate = NULL` oznacza osobny pseudonim per konto w porcji.

Wywołanie w `_hub_account_erase_modules`, sekcja 4:

```sql
v_rows := v_rows + public._club_applications_anonymize(
  ARRAY(SELECT a.id FROM public.club_applications a WHERE a.user_id = p_user_id), p_surrogate);
```

Domknięcie wstecz: w `_hub_account_erase_orphans` dodać
`UNION SELECT x.user_id::text FROM public.club_applications x`, a na końcu migracji wywołać
`SELECT public._hub_account_erase_orphans();`. Uwagi produkcyjne:

- domknięcie obejmie wiersze kont usuniętych przed I9d, w tym te z surowym uid po wyzwalaczu
  BEFORE;
- operacja jest nieodwracalna;
- tabela nie ma ruchu masowego.

Alternatywa minimalna: wpisać UPDATE bezpośrednio w moduły, bez helpera. Wtedy 1b musi powielić
listę kolumn, a parytet trzeba pilnować testem.

**Znacznik „zanonimizowane”.** Bez DDL warunkiem jest `substr(user_id::text,15,1) = '8'`; uid GoTrue
mają wersję 4. Z DDL można dodać `club_applications.anonymized_at timestamptz` (wzorzec
`crm_leads.anonymized_at` z `20261020161000`). Wymaga to aktualizacji `types.ts` i
`check:types-freshness`, a pokazanie flagi w panelu wymaga zmiany typu zwrotu
`admin_club_applications_list` (DROP + CREATE funkcji sprzed huba, więc CIALO-Z). Rekomendacja:
bez DDL, a UI rozpoznaje stan po `user_id[14] === '8'`.

---

## 4. „Koniec członkostwa” dla przyjętych (1b)

`public.club_members` ma najnowszą definicję w `20260808090000_discussion_clubs_a1_structure.sql:194-237`
(pierwotnie `20260807152937:113-135`).

Kolumny:

- `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`;
- `club_id … REFERENCES clubs ON DELETE CASCADE`;
- `status` CHECK `('active','pending','invited','banned','left')`;
- `joined_at NOT NULL DEFAULT now()`, `updated_at`, `role_expires_at`, `last_read_at`,
  `unread_count` (`20260808200000:298`);
- `UNIQUE (club_id, user_id)`.

Kolumny `left_at` ani `ended_at` nie ma.

Źródła końca członkostwa:

- **Wyjście:** `club_leave(p_club_id)` ustawia `status='left'` (`20260808092000:630-652`).
- **Ban:** status `'banned'`. Wyzwalacz `club_members_drop_subscriptions_tg` (BEFORE UPDATE OF
  status, `20260808210000:619-646`) czyści subskrypcje.
- **Usunięcie przez admina:** `admin_club_member_remove(uuid, uuid)` robi `DELETE`
  (`20260808091000:464-496`), więc wiersza nie ma i daty brak.
- **Usunięcie klubu:** kaskada `club_members`; `club_applications.club_id` dostaje SET NULL.
- **Usunięcie konta:** kaskada, a ścieżka 1a i tak anonimizuje.
- `club_members.updated_at` przesuwa wyzwalacz `club_members_set_updated_tg` (`set_updated_at()`,
  `20260807152937:199-201`) przy KAŻDYM UPDATE. Licznik nieprzeczytanych podbija tylko członków
  `status='active'` (`20260808200000:318-328`), więc dla `left`/`banned` `updated_at` ≈ chwila
  wyjścia. Zmiany późniejsze (np. `last_read_at`, rola) mogą ją przesunąć, ale wyłącznie później,
  czyli w bezpieczną stronę.
- **Ponowne przyjęcie:** `admin_club_application_set_status('accepted')` przywraca `left` →
  `active` przez ON CONFLICT (`20260811150000:548-558`). Bez zmiany pozostaje `banned`, zgodnie z
  komentarzem funkcji („ON CONFLICT nie zdejmuje bana”).
- Przyjęte zgłoszenie z `club_id IS NULL` (sama specjalizacja albo usunięty klub) nigdy nie miało
  członkostwa albo straciło je w nieznanej chwili.
- Szyna nie ma zdarzeń o wyjściu z klubu. Słownik `club_moderation_log_action_check` nie ma akcji
  „leave” ani „remove” (`20261004090000:83-90`).

Dwie opcje:

- **Opcja A (bez DDL), proxy.** Koniec = `club_members.updated_at` przy `status IN ('left','banned')`.
  Brak wiersza członkostwa (albo `club_id IS NULL`) oznacza koniec nieznany; wtedy można brać
  `reviewed_at`. To może zanonimizować wcześniej niż „24 mies. od końca” (koniec ≥ decyzja), więc
  wymaga akceptacji. Wiersz `active`, `pending` lub `invited` oznacza członkostwo trwające i brak
  anonimizacji.
- **Opcja B (rekomendowana, odporna).** Kolumna `club_applications.membership_ended_at timestamptz`
  albo `club_members.ended_at`, stemplowana wyzwalaczem na `club_members`:
  - AFTER UPDATE OF status na `left`/`banned` ustawia `now()`;
  - powrót do `active` ustawia NULL;
  - AFTER DELETE ustawia `now()`;
  - domknięcie przy migracji: przyjęte bez aktywnego członkostwa dostają `now()`, czyli 24 mies.
    od wdrożenia.

  Koszt: DDL plus wyzwalacz na tabeli klubowej. Gate wymaga wtedy `pg-harness: exclude` w bloku 16,
  więc harness tego nie sprawdzi, a dowodem jest pgTAP.

Kandydaci retencji (szkic, Opcja A):

```sql
SELECT a.id FROM public.club_applications a
  LEFT JOIN public.club_members m ON m.club_id = a.club_id AND m.user_id = a.user_id
 WHERE a.tenant_id = p_tenant AND substr(a.user_id::text, 15, 1) <> '8'
   AND ( (a.status = 'rejected' AND COALESCE(a.reviewed_at, a.created_at) < p_cutoff)
      OR (a.status = 'accepted'
          AND NOT EXISTS (SELECT 1 FROM public.club_members x WHERE x.club_id = a.club_id
                           AND x.user_id = a.user_id AND x.status IN ('active','pending','invited'))
          AND COALESCE(CASE WHEN m.status IN ('left','banned') THEN m.updated_at END, a.reviewed_at) < p_cutoff) )
 ORDER BY 1 LIMIT p_limit FOR UPDATE OF a SKIP LOCKED
```

Otwarte statusy (`pending`, `review`, `needs_info`) nigdy nie są kandydatami.

---

## 5. Retencja (I9c-X2): punkty styku nowej kategorii (1b)

Pozostałe kategorie I9d (metered_views, event_people, newsletter) dotykają **tych samych** obiektów.
Uzgodnij z ich pakietami jedną migrację „rdzenia kategorii”.

| Obiekt | Gdzie | Co dopisać |
| --- | --- | --- |
| `data_retention_settings_category_check` | `20261020161000:85-87` | `'club_applications'` |
| `data_retention_settings_period_check` | `20261020161000:90-100` | `WHEN 'club_applications' THEN period_months IS NOT NULL AND period_months BETWEEN 12 AND 36` |
| CHECK kategorii w `data_retention_runs` (inline, nazwa nadana przez PG; sprawdź `\d`) | `20261020161000:104-106` | `'club_applications'` |
| `_data_retention_catalog()` | `20261020161000:224-247` (I9-owned) | `jsonb_build_object('key','club_applications','default',24,'min',12,'max',36,'editable',true)` |
| `_data_retention_run_tenant(uuid, text, integer)` | `20261020161100:706-773` (CIALO-Z: `20261020161100`) | `WHEN 'club_applications' THEN public._data_retention_club_applications(p_tenant, v_cutoff, v_set.enforced, v_limit)` |
| `admin_data_retention_preview()` (GRANT authenticated, service_role) | `20261020161400:251-321` (CIALO-Z: `20261020161400`) | gałąź CASE z liczeniem jak wykonawca w podglądzie |
| nowa funkcja `_data_retention_club_applications(p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer) RETURNS jsonb` | wzorzec `_data_retention_cancellation_surveys` (`20261020161100:606-637`): podgląd = `_data_retention_bounded(count(*), p_limit)`; wynik `{affected, backlog: v_n >= p_limit, cutoff}` | wykonanie przez `_club_applications_anonymize(ids, NULL)` |
| `admin_data_retention_save` | `20261020161400:142-…` | sprawdza kategorię przez katalog (`category_invalid`/`period_out_of_range` 22023), więc nie trzeba go zmieniać |
| TS | `src/lib/privacy/dataRetention.ts:20-28` (`DATA_RETENTION_EDITABLE_CATEGORIES`), `:58-68` (`DATA_RETENTION_PERIODS`: `club_applications: { defaultMonths: 24, minMonths: 12, maxMonths: 36 }`) | |
| parytet | `src/lib/privacy/__tests__/dataRetentionParity.test.ts:30-33` | **na sztywno czyta `20261020161000`/`161100`/`161400`**; trzeba czytać najnowszą definicję (CHECK listy run-categories porównywany dosłownie, l. 64) |
| i18n | `src/lib/i18n-admin-data-retention.ts`: `adminDataRetention.categories.<key>.{name,what,after,basis,standard}` (PL ~l. 107-182, EN ~l. 413) | podstawa: „RODO art. 6 ust. 1 lit. b i f; art. 5 ust. 1 lit. e” |
| karta | `src/components/admin/settings/dataRetention/{DataRetentionCard,RetentionCategoryRow}.tsx` | zwykle bez zmian, bo bierze katalog |

Okresy efektywne liczy `_data_retention_effective(p_tenant)` (`20261020161000:255-297`):
`cutoff = now() - make_interval(months => period)`. Karencja wynosi 14 dni (`enforce_after`).
Przebieg idzie przez `jobs-tick` → `data_retention_run(p_limit)` (tylko service_role,
`20261020161100:778-…`).

---

## 6. Testy

### 6.1 `supabase/tests/hub_i9b_account_erasure_sweep_test.sql`

Plan: `SELECT plan(40)`.

Fikstura:

- U = `…d001`, czyli usuwana osoba z e-mailem `usuwana@i9b-sweep.test`;
- K = `…d002` zostaje;
- A = `…d003` i R = `…d007` to personel;
- `…d006` to konto osierocone.

Funkcje pomocnicze:

- `pg_temp.leaks(tenant, needles, except, p_all)` skanuje każdą kolumnę uuid/text/jsonb, przy
  `p_all = true` w każdej tabeli `public` z `tenant_id`;
- `pg_temp.u_needles()` (l. 290-293);
- `pg_temp.exceptions()` (l. 235-237) zawiera wyłącznie e-maile CRM, newslettera i
  `crm_consent_log`.

Numeracja asercji:

| Nr | Linia | Asercja |
| --- | --- | --- |
| 1 | l. 312 | fikstura |
| 4, 5 | l. 340, 346 | skan po usunięciu U (przegląd i cała baza) |
| 20 | l. 613 | fikstura personelu I9c |
| 25 | l. 661 | „I9c-2” |
| 29 | l. 712 | przegląd kolumn uuid wzorca autora/osoby bez FK, z listą l. 726-752 |
| 33-37 | l. 804-820 | domknięcie wstecz |
| 39 | l. 831 | ACL |

Do zrobienia:

- **Asercja 29:** przenieść `'club_applications.user_id'` z grupy „Zgłoszenie Z-I9c-01” (l. 749-752)
  do grupy `_hub_account_erase (A2) i _hub_account_erase_modules (I9c)` i zmienić komentarz.
  Nowe kolumny uuid wzorca (np. `membership_ended_by`) muszą trafić na tę listę albo do redakcji.
- **Fikstura U:** zgłoszenie U (otwarte `pending` plus decyzja `rejected`) z wypełnionymi wszystkimi
  polami PII i zgrubnymi, wstawione PRZED `DELETE` (l. 333-337). Klub `…c2` powstaje dopiero na
  l. 508, więc przenieś go wyżej albo użyj `club_id NULL`. INSERT emituje
  `club_application.submitted.v1` z `user_id`, co dodatkowo sprawdza redakcję szyny.
- **Nowe asercje:** PII `''`/NULL; zgrubne, klub, status, daty i warstwa bez zmian; `user_id` = ten
  sam pseudonim v8 co `paywall_hits.user_id` U (asercja 7 l. 373-389 liczy już jeden pseudonim);
  `admin_revenue_clubs_summary` bez zmian przed i po; `crm_lead_id` NULL. Do tablicy asercji 1
  (l. 314-317) można dopisać `club_applications.user_id` i `club_applications.email`.
- **Pułapka:** asercja 25 (l. 661-668) liczy `count(*) = 2` zgłoszeń całego najemcy, więc zgłoszenia
  U ją zepsują. Zawęź filtr do `user_id = K` albo do specjalizacji `energy`.
- **Wstecz:** zgłoszenie `…d006` wstawione po usunięciu (wyzwalacz hub wyłączony, l. 788-790),
  potem `_hub_account_erase_orphans() > 0`, wiersz zanonimizowany, a druga runda daje 0 (l. 820).
  Wyzwalacz BEFORE retain_accounting jest WŁĄCZONY (l. 334), dlatego zgłoszenie trzeba wstawić PO
  `DELETE`, inaczej BEFORE wyczyści część pól.
- **ACL (l. 831-846):** dopisać `public._club_applications_anonymize(uuid[], uuid)` (i ewentualnie
  `_data_retention_club_applications`) do listy bez EXECUTE.
- Zaktualizować `plan(40)` oraz liczbę asercji w dzienniku (było „40 asercji, było 33”).

### 6.2 Pozostałe

- `supabase/tests/hub_shared_helpers_test.sql:79-135`: lista `hub-grants:begin/end`. Każda nowa
  funkcja `internal`/`service`/`trigger` z rejestru, która nie jest w `HUB_CIALO_Z`, musi tu trafić.
  Parytet z rejestrem pilnuje `src/lib/ci/__tests__/hubDelivery.gate.test.ts:185-198`.
- `supabase/tests/hub_i9c_data_retention_test.sql` (`plan(52)`, fikstura najemców A po karencji i B
  w karencji, l. 25-30) to wzorzec dla kategorii (podgląd vs wykonanie, tylko starsze niż okres,
  idempotencja, ACL). Ankiety: l. 129, 208-217, 312-314.
- Testy klubów dotykające `club_applications`:
  - `club_application_events_test.sql` (`plan(15)`);
  - `revenue_community_aggregates_test.sql` (`plan(23)`, l. 137);
  - `sql_runtime_errors_test.sql` (l. 56-63);
  - `discussion_clubs_a*_test.sql` i `club_*_test.sql`.
- pg-harness `scripts/pg-harness/runtime_test.sql:2410-2431` (A35.7) wymaga, żeby
  `anonymize_club_applications_for_user` zostawiała `user_id` i zwracała 2. **Nie zmieniaj tej
  funkcji**, a jeśli już, to tylko dopisując kolumny bez `user_id`.
- vitest:
  - `src/lib/privacy/__tests__/dataRetentionParity.test.ts`;
  - `src/lib/ci/__tests__/hubDelivery.gate.test.ts`;
  - `src/components/admin/clubs/__tests__/ClubApplicationsInbox.test.tsx` (fikstury
    `src/test/clubs/inboxFixtures.ts`), jeśli UI pokaże stan „zanonimizowane”;
  - `src/lib/clubs/__tests__/applyApi.test.ts`.
- Uruchomienie pgTAP: `PGTAP_DIR=/tmp/pgtap-hub PGTAP_PORT=5490 bash scripts/pgtap-local/run.sh test
  hub_i9b_account_erasure_sweep`.

---

## 7. Harnessy (znaczniki w nagłówku, wzór `20261020160900:5-10, 105-113`)

| Harness | Selektor | Wniosek dla nowej migracji |
| --- | --- | --- |
| pg-harness (`scripts/pg-harness/run.sh:95-138`) | `grep -lE 'public\.(club_\|admin_club_)'` + `*discussion_clubs*`; pomija pliki z linią `^--\s*pg-harness:\s*exclude\s*$` | **wymagany `-- pg-harness: exclude`**. Bramka dostawy także go wymusza: `brak-pg-harness-exclude` dla każdego pliku spoza S4, który dotyka `public.club_` (`hubDelivery.ts:1121-1122, 1376-1381`) |
| careers-harness (`scripts/careers-harness/run.sh:96-127`) | `public\.(career_\|contact_messages)\|'career-cv'`; dyrektywa `^--\s*careers-harness:\s*exclude\s*$` | jeśli migracja przepisuje w całości `_hub_account_erase_modules` (`public.career_application_events`, `public.contact_messages`) albo `_hub_account_erase_orphans`, to **wymagany `-- careers-harness: exclude`** |
| events-harness (`scripts/events-harness/run.sh:170-171`) | `public\.admin_event_\|events_tenant_id_key\|events-harness: include\|FUNCTION public\.event_[a-z_]+\(`; **nie ma znacznika exclude** | ciało modułów z `public.event_registrations` nie pasuje; nie pisz w prozie „FUNCTION public.event_…(” ani „events-harness: include” |
| tenant-isolation | nazwy polityk | nie dotyczy |

Znacznik musi stać jako osobna linia komentarza, z uzasadnieniem w prozie (wzór 160900).

---

## 8. Bramka dostawy `src/lib/ci/hubDelivery.ts`

- Zakres wersji huba to `[20261020090000, 20261020170000)`, a blok I9 to `2026102016` (l. 47-64).
  Nowe wersje mieszczą się w `20261020161500…20261020165900`.
- Rejestr `FUNCTION_TABLE` (l. 239-307): nową funkcję dopisz jako `[nazwa, "I9", "internal"]`.
  Funkcja zaczynająca się od `_` musi mieć rodzaj `internal`, `tg_` to `trigger`, a `admin_` to
  `panel` (test l. 200-207).
- Przepisanie funkcji I9 (moduły, orphans, `_data_retention_*`) w bloku I9 **nie** wymaga wpisu w
  `HUB_I9_REDEFINITIONS` (to rejestr funkcji innych wycinków) ani w `HUB_CIALO_Z`. Konwencja repo
  mimo to stawia `-- CIALO-Z: <wersja>`:
  - `_hub_account_erase_modules` / `_hub_account_erase_orphans`: `20261020160900`;
  - `_data_retention_catalog`: `20261020161000`;
  - `_data_retention_run_tenant`: `20261020161100`;
  - `admin_data_retention_preview`: `20261020161400`.
- Przepisanie funkcji **sprzed huba** (`anonymize_club_applications_for_user`,
  `tg_auth_user_deleted_retain_accounting` → `20260811151210`; `admin_club_application_set_status` →
  `20260811150000`; `admin_club_applications_list` → `20260811151703`) wymaga wpisu w
  `FUNCTION_TABLE` i w `HUB_CIALO_Z` (l. 339-356) oraz znacznika `-- CIALO-Z` (reguły
  `brak-cialo-z`/`zly-cialo-z`, l. 1420-1466).
- Nagłówek PL musi mieć `DEFEKT`, `ZMIANA`, `KOLEJNOŚĆ`, `IDEMPOTENTNA` i `DOWÓD` (l. 1135-1142).
  Plik może mieć najwyżej **45 KiB** (`HUB_MIGRATION_MAX_BYTES`, l. 1111). Dla porównania 160900 ma
  42 552 B, więc przepisanie modułów (~12 KB) i domknięcia (~8 KB) z helperem się zmieści, ale
  retencję daj do osobnego pliku.
- REVOKE w tym samym pliku: dla rodzajów `internal`/`service`/`trigger` z `PUBLIC, anon,
  authenticated` (`REVOKE_REQUIRED_STRICT`, l. 1133). Konwencja I9 dodaje `service_role` dla
  helperów wewnętrznych.
- Manifest plików I9 (~l. 880-948): dopisz nowe ścieżki, np. `supabase/tests/hub_i9d_*_test.sql`
  i ewentualne pliki UI klubów (`src/components/admin/clubs/**`, `src/lib/i18n-clubs-admin.ts`), z
  komentarzem „(I9d, data)”.
- Po zmianach uruchom `bun run generate:authz-snapshot`. `authzSnapshot.generated.ts` liczy
  migracje i funkcje (1294 → …, 1791 → …).

---

## 9. Dokumenty do aktualizacji

- `docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md`:
  - „Wspólny mechanizm usunięcia konta” (l. 48-97): dopisać zgłoszenia do klubów; krok 1 BEFORE
    (l. 53-55) pomija dziś anonimizację klubową w `tg_auth_user_deleted_retain_accounting`;
  - nowy wpis czynności „Zgłoszenia do klubów” (podstawa art. 6 ust. 1 lit. b i f, okresy z §8.1
    pkt 1b);
  - Z-I9c-01 (l. 229-232) oznaczyć jako zamknięte;
  - sekcja „Retencja danych” (l. 26-46).
- `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md`: nowa podsekcja „21.x RODO – decyzje właściciela 2
  (I9d-Y1)” po §21.21 (l. 3753). Zaktualizować:
  - tabelę §21.20 (l. 3610: wiersz „Zgłoszenie do klubu osoby … bez zmian - Z-I9c-01”);
  - Z-I9c-01 (l. 3681) jako „Zamknięte (I9d, §21.x)”;
  - kontrolne SQL, np. `SELECT count(*) FROM club_applications a WHERE NOT EXISTS (SELECT 1 FROM
    auth.users u WHERE u.id = a.user_id) AND substr(a.user_id::text,15,1) <> '8'` z oczekiwanym 0.

---

## 10. Rekomendacja wdrożenia

Kolejność: najpierw sprawdź `ls supabase/migrations | grep ^2026102016 | tail` i
`ls drizzle/migrations | tail` (po S7: `0373/0374`).

1. **Migracja A** (np. `20261020161500_club_applications_account_erasure.sql`, bliźniak `0375_…`
   albo `0373_…`, gdy S7 jeszcze nie wszedł):
   - nagłówek PL;
   - osobne linie `-- pg-harness: exclude` i `-- careers-harness: exclude`, każda z uzasadnieniem;
   - `_club_applications_anonymize(uuid[], uuid)` (nowa);
   - `_hub_account_erase_modules` (`-- CIALO-Z: 20261020160900`, pełne ciało z 160900 plus wywołanie
     w sekcji 4);
   - `_hub_account_erase_orphans` (`-- CIALO-Z: 20261020160900`, plus
     `UNION SELECT x.user_id::text FROM public.club_applications x`);
   - REVOKE;
   - `SELECT public._hub_account_erase_orphans();`.

   `_hub_account_erase` i `tg_*` zostają bez zmian. Zero DDL (wariant bez `anonymized_at`).
2. **Migracja B** (retencja, kolejna wersja, np. `161600`): wspólna z innymi kategoriami I9d albo po
   nich. Zawiera:
   - CHECK-i (DROP/ADD CONSTRAINT z `lock_timeout`);
   - `_data_retention_catalog`;
   - `_data_retention_club_applications`;
   - `_data_retention_run_tenant`;
   - `admin_data_retention_preview`;
   - wariant B z §4: kolumna `membership_ended_at` plus wyzwalacz na `club_members` i domknięcie.

   Migracja dotyka `public.club_`, więc znacznik `pg-harness: exclude` jest obowiązkowy.
3. Bliźniaki: `cp` bajt w bajt do `drizzle/migrations/NNNN_<nazwa>.sql` i wpis w
   `meta/_journal.json` (`when` = poprzedni + 60000). Potem `bun run check:migration-lanes`.
4. TS:
   - `dataRetention.ts` (kategoria i okres), i18n PL/EN, parytet;
   - opcjonalnie UI skrzynki: etykieta „Zgłoszenie zanonimizowane”, wyłączone przyciski decyzji i
     CRM dla `user_id` v8, nowe klucze w `i18n-clubs-admin.ts` PL/EN.
5. Rejestry:
   - `hubDelivery.ts` (FUNCTION_TABLE i manifest);
   - lista `hub-grants` w `hub_shared_helpers_test.sql`;
   - `authzSnapshot`;
   - `types.ts` tylko przy DDL albo nowym RPC.
6. Testy:
   - rozszerzenie `hub_i9b_account_erasure_sweep_test.sql` (§6.1, asercja 29);
   - nowy `supabase/tests/hub_i9d_club_applications_retention_test.sql`: odrzucone starsze niż okres
     → zanonimizowane, młodsze zostają; przyjęte z członkostwem `active` zostają; `left`/`banned`
     starsze niż okres → zanonimizowane; otwarte nigdy; podgląd w karencji nic nie zmienia; powtórka
     daje 0; `admin_revenue_clubs_summary` bez zmian; ACL; zakres 12-36 (22023/23514);
   - vitest parytetu i bramki.
7. Bramki według promptu §5.4:
   - `check:pg-harness`, `check:careers-harness`, `check:events-harness`;
   - `run.sh all`;
   - `split-migration --dry-run`;
   - `hub-slice-guard I9 --base <BAZA>`.
8. Na koniec dziennik §21.x i rejestr (§9).

---

## 11. Otwarte pytania i ryzyka

1. **„Wycofane”:** status nie istnieje. Proponuję interpretować jako `rejected` (plus „członkostwo
   zakończone” dla przyjętych). Ewentualne wycofanie przez kandydata to osobna funkcja, poza zakresem.
2. **Koniec członkostwa:** opcja A (proxy `updated_at`, fallback `reviewed_at`) czy B (nowa kolumna
   plus wyzwalacz)? Fallback w A może zanonimizować wcześniej niż 24 mies. od faktycznego końca.
   Zalecam B albo jawną akceptację A w dzienniku.
3. **Kolumny spoza listy właściciela:**
   - `admin_note` (dzisiejsza funkcja go czyści; to wolny tekst komisji o osobie);
   - `crm_lead_id` (powiązanie z zachowanym kontaktem CRM pozwala ponownie zidentyfikować wiersz);
   - `crm_error` i `notify_error` (tekst błędu może cytować adres).

   Proponuję wszystkie wyczyścić, a `consent`, `marketing_consent`, `lang` i statusy techniczne CRM
   oraz powiadomień zostawić. Opisać jako decyzję wykonawczą w dzienniku.
4. **Decyzja po anonimizacji:** otwarte zgłoszenie usuniętego konta zostaje `pending`. `accepted` z
   panelu dałby FK 23503 na `club_members`, a `rejected` dałby `club_notify` do nieistniejącego
   konta. Problem istniał już przed zmianą (surowy uid bez konta). Rozwiązania:
   - guard w UI dla `user_id` v8;
   - przepisanie `admin_club_application_set_status` z kodem `application_anonymized` (funkcja sprzed
     huba, więc CIALO-Z `20260811150000` i wpis w `HUB_CIALO_Z`, kind `panel`).

   Do decyzji. Zmiany statusu na `rejected` przy usunięciu konta nie robić: łamie zasadę „status
   zostaje” i emituje `decided.v1`.
5. **Pseudonim przy retencji żywych kont:** osobny pseudonim per konto w porcji (proponowany) czy per
   wiersz? Kandydat traci podgląd starego zgłoszenia w `club_my_applications` i w eksporcie RODO.
   Tak ma być, ale warto o tym wspomnieć w dzienniku.
6. **Wyzwalacz BEFORE:** `anonymize_club_applications_for_user` zostaje i jest redundantny. Nie
   ruszamy go (pg-harness A35.7, funkcja sprzed huba). Jego ciche `EXCEPTION WHEN OTHERS` przestaje
   mieć znaczenie, bo AFTER przerywa usunięcie przy błędzie.
7. **Kolizje w I9d:** cztery nowe kategorie zmieniają te same CHECK-i, katalog, `_run_tenant`,
   `preview` i parytet. Bez jednej migracji rdzenia najnowsza definicja „wygrywa po wersji” i gubi
   kategorie innych pakietów.
8. **Rozmiar pliku:** pełne ciała modułów i domknięcia zmieszczą się w 45 KiB, ale nie razem z
   retencją, dlatego plan zakłada dwa pliki.
9. **Dane CRM o klubach** (`crm_leads.club_specializations`, `club_application_count`,
   `club_applied_at`) zostają w kontakcie CRM jako wyjątek i są czyszczone przez retencję CRM
   (`_data_retention_anonymize_lead`, `20261020161100:403-466`). Nie należą do zakresu Z-I9c-01;
   warto to odnotować w rejestrze.
10. **Otwarte zgłoszenia bez terminu:** `needs_info` i `pending` są przechowywane bez ograniczenia
    („nigdy automatycznie”). To ryzyko dla zasady ograniczenia przechowywania. Można dodać dymek lub
    licznik w karcie (poza zakresem).
