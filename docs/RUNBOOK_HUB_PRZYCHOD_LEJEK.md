# Runbook - hub „Przychód i lejek”

Stan: 2026-10-22, PR #530 (wszystkie wycinki: I0, S1-S8, I9a-I9d, I9).
Dla kogo: administrator najemcy NES (panel), właściciel wdrożenia (Lovable,
migrator Drizzle) i dyżur techniczny. Pełna historia decyzji i dowodów:
`docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` (dalej „dziennik”), kontrakt:
`docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md` (§9.2 - monitoring
i wycofanie), czynności przetwarzania:
`docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md`.

Zasady, które obowiązują w każdym punkcie:

- **Wszystko z panelu.** Każdy przełącznik huba ma miejsce w panelu admina
  dla właściwej roli. Zmienna środowiska `JOURNEYS_ENGINE_DISABLED` jest
  wyłącznie awaryjnym hamulcem dyżuru, a jej stan widać w panelu.
- **SQL tylko do odczytu.** Zapytania z tego dokumentu uruchamiasz w edytorze
  SQL Supabase jako kontrolę. Zmiany w bazie idą wyłącznie migracją (blok
  wersji huba, bliźniak drizzle) - także szablony awaryjne z §7.3.
- **Kod przed migracją i migracja przed kodem są bezpieczne.** Nowy front bez
  migracji pokazuje stan „źródło jeszcze niewdrożone” (PGRST202/42883 →
  `unavailable`), a kroki `jobs-tick` zwracają `skipped: migration_pending`.
  Wyjątki, przy których front i migracje muszą wejść razem, opisuje §8.

## 1. Mapa: co działa gdzie

| Element                                                                          | Miejsce w panelu                                                     | Rola                                                 | Mechanizm                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Hub (Kokpit, Przychód, Retencja, Lejek, Dostęp, Oferta, Społeczność, Wskaźniki…) | `/admin/revenue` (⌘K: zakładki, „Dane wejściowe”, skróty wskaźników) | admin i redaktor wg zakładki (`canSeeTab`)           | RPC `admin_revenue_*`, migawka, szyna zdarzeń z mapą inwalidacji            |
| Diagnostyka (55 reguł, wyciszenia, mapa systemu)                                 | `/admin/revenue/diagnostics`; chipy sygnału w 10 ekranach modułów    | admin, redaktor (bez kwot)                           | `admin_revenue_facts()`, `admin_revenue_diagnostic_snooze*`                 |
| Ścieżki komunikacji (lista, galeria, edytor kanwy, wyniki, przewodnik)           | `/admin/revenue/journeys`, edytor `/admin/revenue/journeys/<id>`     | edycja: admin i redaktor; publikacja i status: admin | tabele `journey_*`, runner w `jobs-tick`                                    |
| Ustawienia silnika ścieżek (włącznik, limit maili, cisza nocna, nadawca, pomiar) | zakładka Ścieżki → „Ustawienia silnika”                              | admin                                                | `admin_journey_settings_get/save`                                           |
| Harmonogram i jego zdrowie (karta „Silnik ścieżek komunikacji”)                  | `/admin/community/notifications` (panel zdrowia harmonogramu)        | admin, redaktor (podgląd, „Uruchom tick teraz”)      | `job_runner_runs`, `admin_journey_engine_health()`                          |
| Retencja danych (kategorie, karencja, „Włącz teraz”, lista „do wygaszenia”)      | `/admin/settings/privacy` - karta „Retencja danych”                  | admin                                                | `data_retention_*`, krok `dataRetention` w `jobs-tick`                      |
| Treść zgody na newsletter i pomiar, „Poproś o zgodę na pomiar”                   | `/admin/newsletter/overview`                                         | treść: admin i redaktor; oznaczenie i prośba: admin  | `admin_newsletter_consent_measurement_*`, `admin_newsletter_measurement_*`  |
| Treść maili próśb (wygaszanie, zgoda na pomiar)                                  | `/admin/newsletter/email-content`                                    | admin                                                | ustawienia newslettera                                                      |
| Skrzynka wysyłek (powody zatrzymania z etykietami PL/EN)                         | `/admin/newsletter/outbox`                                           | admin i redaktor                                     | `email_send_log` (`suppressed:*`, `skipped:*`, `cancelled:account_deleted`) |
| CRM (lista, karta leada z kartą „Ścieżki”, import CSV, przypisanie zadań)        | `/admin/crm`, `/admin/crm/<id>`                                      | personel CRM (admin, redaktor)                       | `crm_*`, oś leada z typem `journey`                                         |

## 2. Harmonogram (`jobs-tick`)

`jobs-tick` biegnie co minutę (pg_cron + pg_net → `POST /api/public/jobs-tick`);
przycisk „Uruchom tick teraz” w `/admin/community/notifications` wykonuje ten
sam przebieg. Siatka bezpieczeństwa to `community-cron` (pg_cron co 5 minut
i workflow GitHub `scheduler.yml`) - szczegóły w `docs/RUNBOOK_COMMUNITY.md`.
Kroki huba i ich rytm:

| Krok w `job_runner_runs.result` | Kiedy                                                 | Co robi                                                                                                    | Limity i termin                                            |
| ------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `journeys`                      | co minutę, po zadaniach uczestnika, PRZED drenem      | `runJourneysTick`: skrzynka → zapisy → kroki → maile (dren wysyła je w tym samym ticku)                    | `ingestLimit` 200, `claimLimit` 50, termin 3 s od startu   |
| `emailQueue`                    | co minutę, po `journeys`                              | dren kolejek poczty                                                                                        | 60 wiadomości, min. 4 s                                    |
| `revenueLifecycle`              | co 5 min (minuty 0, 5, 10…)                           | `run_revenue_lifecycle_scanner` (koniec okresu próbnego, wygaśnięcia, windykacja, migawki MRR)             | literał RPC, znaczniki `revenue_event_marks`               |
| `retentionFlow`                 | co 5 min                                              | `run_retention_flow_scanner` (porzucone przepływy anulowania)                                              | jw.                                                        |
| `newsletterSunset`              | co 10 min (minuty 9, 19…), okno 08-17 czasu polskiego | prośby „Chcę dalej otrzymywać” (wygaszanie nieaktywnych)                                                   | ≤ 200 maili/dobę/najemcę (wspólnie z prośbami pomiaru)     |
| `newsletterMeasurement`         | co 10 min (minuty 4, 14…), okno 08-17 czasu polskiego | prośby „Poproś o zgodę na pomiar”                                                                          | jw., termin 4 s                                            |
| `journeysRollup`                | co godzinę w minucie 13                               | `journey_rollup_daily()` - dzienne liczniki kroków ścieżek                                                 | -                                                          |
| `journeysPurge`                 | raz na dobę o 03:11 UTC                               | `journey_purge('30 days')` - przetworzona skrzynka > 30 dni, błędy silnika > 90 dni                        | pominięty tick = sprzątanie dzień później (wiersze 31 dni) |
| `dataRetention`                 | 02:07-02:57 UTC co 10 min (ostatni krok ticku)        | `data_retention_run(p_limit => 5000)` - podgląd albo wykonanie kategorii, pieczęcie agregatów, zestawienia | budżet 8 s, `more: true` = reszta w kolejnym oknie         |

- Kroki `journeys` i `revenue-lifecycle` w `community-cron` są dostępne tylko
  jawnie (parametr `job`), nie w `all`: pg_cron woła `all` co 5 minut, a ta
  ścieżka nie drenuje poczty.
- **Ręczne wypchnięcie:** przycisk „Uruchom tick teraz” (cały tick) albo
  GitHub → Actions → workflow `scheduler` → „Run workflow” z jobem
  `journeys` albo `revenue-lifecycle` (`community-cron`; skrypt
  `scripts/scheduler-tick.mjs` drukuje podsumowanie kroku).
- `skipped: "migration_pending"` = funkcja SQL kroku jeszcze niewdrożona
  (oczekiwane w oknie „kod przed migracją”). `skipped: "kill_switch"` =
  wyłącznik `JOURNEYS_ENGINE_DISABLED` (§3.1). `{ "error": … }` = awaria
  kroku (licznik porażek w panelu zdrowia).

## 3. Przełączniki

### 3.1 Silnik ścieżek

| Przełącznik                          | Gdzie                                                                         | Skutek                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `journey_settings.enabled` (najemca) | zakładka Ścieżki → „Ustawienia silnika” (admin); domyślnie WYŁĄCZONY          | Wyłączony: nowe zapisy nie powstają, zapisy w toku czekają. Test na sobie (`admin_journey_enroll_test`) działa przy wyłączonym silniku. Włączenie u NES - dopiero po teście na żywo (M3, §9).                                                                                                                                        |
| Status ścieżki                       | lista Ścieżek i pasek edytora (admin)                                         | Wstrzymana (`paused`) - bez nowych wejść, zapisy w toku czekają (runner bierze kroki tylko ścieżek aktywnych i zapisów testowych). Archiwum kończy aktywne zapisy z powodem `journey_archived` i zdejmuje trasy. Publikacja nowej wersji: `drain` (zapisy w toku kończą swoją wersję) albo `exit_all` (wychodzą z powodem `manual`). |
| `JOURNEYS_ENGINE_DISABLED=1`         | zmienna środowiska serwera aplikacji (sekrety wdrożenia), **tylko awaryjnie** | Runner nie wykonuje niczego (ani skrzynki, ani kroków). Krok `journeys` = `{ "skipped": "kill_switch" }` - pominięcie, nie awaria (bez alarmu co minutę). Karta „Silnik ścieżek komunikacji” w panelu zdrowia harmonogramu pokazuje alert wyłącznika.                                                                                |

Po zdjęciu wyłącznika (usunięcie zmiennej i ponowne wdrożenie) runner
nadrabia skrzynkę po 200 zdarzeń na minutę. Nieprzetworzonych wierszy
`journey_purge` nie usuwa, więc nic nie ginie.

Gdy rośnie kolejka poczty (`email_queue_depth()` - §4), runner sam odkłada
maile ścieżek (`deferred`) do czasu spadku kolejki - wyłącznik jest
potrzebny dopiero, gdy to nie wystarcza.

### 3.2 Retencja danych i karencja

Karta „Retencja danych” (`/admin/settings/privacy`, admin):

- **Kategorie** (13): okres, włączenie z potwierdzeniem i ostrzeżeniem
  o zasadzie ograniczenia przechowywania, „Uruchom teraz” z potwierdzeniem,
  przedłużenie kontaktu CRM. Każda zmiana zapisuje się w `audit_log`
  i wysyła `data_retention.changed.v1`.
- **Karencja (bezpieczny start):** `enforce_after` = chwila wdrożenia + 14
  dni (nowe kategorie I9d-Y1 dostają własne 14 dni). Do tego terminu zadanie
  działa w trybie PODGLĄDU - liczy, niczego nie usuwa. Admin może „Włącz
  teraz” albo przesunąć termin (najdalej 90 dni od dziś).
- **Lista „do wygaszenia”** (kategoria `newsletter_inactive`): wykluczenia
  pojedynczych adresów; prośba „Chcę dalej otrzymywać” wychodzi raz, po 30
  dniach bez potwierdzenia subskrybent jest usuwany (rejestr zgód zostaje,
  lista wyłączeń nietknięta).
- Agregaty dzienne są pieczętowane przed usunięciem surowych wierszy
  (lejek, licznik, statystyki kroków ścieżek), a od I9 także **zestawienie
  statusów zapisów ścieżek** (`journey_enrollment_daily_stats`, Z-I9c-06)
  i **dzienne sumy zdarzeń kampanii** (`newsletter_campaign_engagement_daily`,
  Z-I9c-05) - podsumowania starszych okien przeżywają retencję.

### 3.3 Pomiar otwarć i kliknięć, zgoda na pomiar

- **Wspólny przełącznik najemcy** `journey_settings.open_tracking_enabled`
  obejmuje ścieżki i kampanie, otwarcia i kliknięcia (render, zapis zdarzeń,
  webhook dostawcy). Ten sam przełącznik jest w trzech miejscach: karta
  retencji, ustawienia silnika ścieżek i przegląd newslettera.
- **Pomiar tylko za zgodą** (`crm_consent_log.consent_key =
'email_measurement'`, I9d-Y2): piksel i linki z identyfikatorem odbiorcy
  wyłącznie u osób, których zgoda obejmuje pomiar. Wycofanie linkiem „Nie
  mierz moich otwarć i kliknięć” (osobno od wypisu).
- **Treść zgody** (PL/EN, z wersją) - przegląd newslettera; własny tekst
  admina może dostać oznaczenie „obejmuje pomiar” (działa od chwili
  oznaczenia, nie wstecz - Z-I9d-13).
- **„Poproś o zgodę na pomiar”** - przegląd newslettera: podgląd liczby
  adresatów, potwierdzenie, wysyłka krokiem `newsletterMeasurement`
  (co 10 minut w minutach 4, 14…, okno 08-17, ≤ 200/dobę/najemcę wspólnie z prośbami wygaszania).
- **Tryb źródła zaangażowania** `NEWSLETTER_ENGAGEMENT_SOURCE` musi zostać
  `first_party` (domyślnie), a śledzenie otwarć i kliknięć u dostawcy poczty
  (Resend) - wyłączone. Tryb `provider` nie daje się pogodzić z pomiarem
  tylko za zgodą (dostawca mierzy wszystkich). Zmiana trybu nie jest
  przełącznikiem panelu z założenia - to decyzja prawna, nie operacyjna.
- **Skutek zamierzony wdrożenia I9d-Y2:** zgody sprzed nowej treści nie
  obejmują pomiaru, więc wskaźniki otwarć i kliknięć spadają skokowo
  (mianownik kampanii = mierzeni; ścieżki - dymek).
- Otwarcia ludzkie i CTOR są **górną granicą** (Apple MPP odsiewa tylko próg
  czasu `machine_open_seconds`) - dymki w wynikach ścieżek, nakładce kanwy,
  tabeli maili, A/B i notka w Kokpicie (Z-S5-06, Z-I9d-16).

### 3.4 Inne przełączniki, z których korzysta hub

- Przepływ anulowania: `retention_settings.enabled` (Cennik → Retencja).
- Okno porzucenia kasy: `checkout_settings.abandon_after_minutes` (ustawienia
  kasy, I9a).
- Licznik artykułów i paywall: ustawienia meteringu (moduł paywalla).

## 4. Sygnały i alerty (7 dni po każdej fali - SPEC §9.2)

| Sygnał                         | Gdzie patrzeć                                                                         | Norma                                         | Działanie                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Błędy emiterów                 | `domain_event_emit_errors` 24 h (Q2)                                                  | 0                                             | przegląd `source`/`sqlstate`; poprawka u właściciela funkcji; awaryjnie §7.3               |
| Błędy silnika                  | karta silnika (panel zdrowia, zakładka Ścieżki), `admin_journey_engine_health()` (Q3) | błędy 24 h < 1 % kroków, `dead_steps_24h` = 0 | pauza ścieżki, analiza `last_errors`                                                       |
| Opóźnienie skrzynki            | `inbox_oldest_at` w zdrowiu silnika (Q3)                                              | p95 < 2 min                                   | sprawdzić, czy krok `journeys` nie jest pomijany budżetem; awaryjnie wyłącznik             |
| Kolejka poczty                 | `email_queue_depth()` (Q4), panel newslettera                                         | `transactional_emails` < 120, DLQ bez wzrostu | runner odkłada sam; trwały wzrost → `JOURNEYS_ENGINE_DISABLED=1`                           |
| Kroki harmonogramu             | panel zdrowia harmonogramu, `job_runner_runs` (Q1)                                    | `ok` w każdej minucie, brak `{ error }`       | log kroku; `migration_pending` po wdrożeniu = brak migracji                                |
| Milczące emitery               | Diagnostyka: `sync.emitter_silent`                                                    | brak                                          | test emitera (Q5), poprawka                                                                |
| Dryf księgi MRR                | Diagnostyka: `data_quality.ledger_drift`                                              | < 0,5 %                                       | analiza `basis_mix` i klasyfikacji                                                         |
| Retencja                       | karta retencji, `data_retention_runs` (Q6)                                            | tryb `preview` przez 14 dni, bez `error_code` | kod błędu kategorii w karcie; kategoria osobno (`BEGIN … EXCEPTION`)                       |
| Wolumen realtime               | Q5 przed/po wdrożeniu                                                                 | wzrost < 30 %                                 | zawężenie emisji                                                                           |
| Przerwana szyna w przeglądarce | baner „Aktualizacje na żywo wstrzymane” w nagłówku huba                               | brak                                          | odświeżenie strony; trwały - kanał realtime Supabase                                       |
| Poczta zatrzymana              | Skrzynka wysyłek (etykiety powodów), Q7                                               | -                                             | `suppressed:*` - lista wyłączeń; `cancelled:account_deleted` - usunięte konto (oczekiwane) |

## 5. Zapytania diagnostyczne (SQL editor, tylko odczyt)

```sql
-- Q1. Ostatnie przebiegi harmonogramu - kroki huba.
SELECT created_at, source, job, ok, duration_ms,
       result -> 'journeys' AS journeys,
       result -> 'emailQueue' AS email_queue,
       result -> 'revenueLifecycle' AS revenue_lifecycle,
       result -> 'retentionFlow' AS retention_flow,
       result -> 'journeysRollup' AS rollup,
       result -> 'journeysPurge' AS purge,
       result -> 'dataRetention' AS data_retention,
       error
  FROM public.job_runner_runs
 ORDER BY created_at DESC LIMIT 20;

-- Q2. Błędy emiterów z ostatniej doby.
SELECT source, event_type, sqlstate, count(*) AS n, max(created_at) AS ostatni
  FROM public.domain_event_emit_errors
 WHERE created_at > now() - interval '24 hours'
 GROUP BY 1, 2, 3 ORDER BY n DESC;

-- Q3. Zdrowie silnika ścieżek bez sesji admina (to, co liczy
--     admin_journey_engine_health dla najemcy).
SELECT tenant_id,
       count(*) FILTER (WHERE processed_at IS NULL) AS skrzynka_oczekuje,
       min(received_at) FILTER (WHERE processed_at IS NULL) AS najstarsze
  FROM public.journey_event_inbox GROUP BY 1;
SELECT tenant_id, status, count(*) AS zapisy,
       count(*) FILTER (WHERE next_run_at <= now() AND (locked_until IS NULL OR locked_until < now())) AS do_wykonania
  FROM public.journey_enrollments
 WHERE status IN ('active', 'waiting') GROUP BY 1, 2;
SELECT phase, count(*), max(created_at) FROM public.journey_engine_errors
 WHERE created_at > now() - interval '24 hours' GROUP BY 1;

-- Q4. Głębokość kolejek poczty (funkcja tylko dla service_role -
--     w edytorze SQL jako postgres).
SELECT public.email_queue_depth();

-- Q5. Wolumen szyny per typ zdarzenia (przed i po wdrożeniu; także test
--     emitera - typ bez wierszy przy ruchu w module = milczący emiter).
SELECT event_type, count(*) AS n
  FROM public.domain_events
 WHERE created_at > now() - interval '24 hours'
 GROUP BY 1 ORDER BY n DESC;

-- Q6. Retencja: ostatnie przebiegi i pieczęcie.
SELECT tenant_id, category, mode, run_trigger, affected, backlog, error_code, started_at
  FROM public.data_retention_runs ORDER BY started_at DESC LIMIT 50;
SELECT tenant_id, scope, sealed_through, purged_before FROM public.data_retention_state ORDER BY 1, 2;

-- Q7. Poczta zatrzymana i pominięta (Skrzynka wysyłek pokazuje te kody jako etykiety).
SELECT error_message, count(*) FROM public.email_send_log
 WHERE error_message LIKE 'suppressed:%' OR error_message LIKE 'skipped:%'
    OR error_message = 'cancelled:account_deleted'
 GROUP BY 1 ORDER BY 2 DESC;

-- Q8. Zestawienia I9 (rosną dopiero po pierwszym WYKONANIU retencji, nie w podglądzie).
SELECT tenant_id, count(*) AS wiersze, sum(enrollments) AS zapisy
  FROM public.journey_enrollment_daily_stats GROUP BY 1;
SELECT tenant_id, sum(opens) AS otwarcia, sum(clicks) AS klikniecia
  FROM public.newsletter_campaign_engagement_daily GROUP BY 1;

-- Q9. Formularz kontaktowy na szynie (Z-S5-01) i błędy jego emitera.
SELECT payload ->> 'form_kind' AS rodzaj, count(*)
  FROM public.domain_events
 WHERE event_type = 'contact_message.submitted.v1' AND created_at > now() - interval '7 days'
 GROUP BY 1;
SELECT * FROM public.domain_event_emit_errors
 WHERE source = 'tg_contact_messages_submitted_emit' ORDER BY created_at DESC LIMIT 20;

-- Q10. Wycofanie zgody marketingowej - jeden pomocnik, trzy źródła (Z-S5-04).
SELECT form_id, count(*), max(created_at)
  FROM public.crm_consent_log
 WHERE form_id IN ('crm_staff:withdraw', 'journey:unsubscribe', 'retention:newsletter_sunset')
 GROUP BY 1;
```

## 6. Znane skutki i świadome granice (bez zmian w kodzie)

- **Z-I9c-03 - `updated_at` po usunięciu konta.** Zerowanie autora przy
  usunięciu konta przesuwa `updated_at` wierszy z wyzwalaczem
  `set_updated_at`/`_tg_touch_updated_at` (np. `pages`,
  `legal_document_versions`, `event_registrations`, `club_applications`) na
  chwilę usunięcia. Treść się nie zmienia i nie powstaje nowa rewizja
  (migawki powstają tylko przy zmianie treści). Sortowanie „ostatnio
  zmienione” pokaże te wiersze wyżej - to nie edycja.
- **Z-S3-02 - goście w paywallu to dolna granica.** Uderzenie gościa bez
  ważnego cookie licznika (`nes_mvid`, zakładane dopiero przy konsumpcji
  limitu) nie jest liczone - pomiar nie ma podstawy, by zakładać
  identyfikator przeglądarki. Wskaźniki PHR/PSCR liczą konta, nie gości.
- **Z-S5-05 - jedna stopka wypisu.** Mail ścieżki wysyłany przez bramkę
  platformy ma wyłącznie stopkę platformy (stopka ścieżki jest wycinana).
  Wypis z niej blokuje adres (`email_unsubscribe_by_token`), a zapis
  wychodzi przy następnym kroku z powodem `unsubscribed`. Na drodze Resend
  zostaje stopka ścieżki z nagłówkiem RFC 8058. Wygląd stopki i to, czy
  platforma dokleja `List-Unsubscribe`, potwierdza test na żywo (M3, §9).
- **Z-I9c-06 - podsumowanie ścieżki ze starych okien.** Zapisy usunięte
  retencją składane są do `journey_enrollment_daily_stats` od wdrożenia
  `20261020162600`. Zapisy usunięte wcześniej nie wrócą - nota „partial”
  w wynikach to opisuje. W serii dni zapieczętowanych maile i kliknięcia
  liczą się po dniu kroku i jako wysłane (nie zakolejkowane).
- **Z-I9c-05 / Z-I9c-10 - kampanie po retencji.** Kokpit, zdrowie poczty
  i warstwa semantyczna czytają dni sprzed progu z dziennych sum (od
  wdrożenia `20261020162900`; wcześniej złożone zdarzenia są tylko
  w archiwum kampanii, bez dnia). Dzień liczy się po początku doby UTC.
  Unikalni odbiorcy dni sprzed progu to dolna granica (dni nie da się
  sumować). Zasięg kampanii jest przycięty do liczby odbiorców (`LEAST`) -
  powrót po progu nie zawyża zasięgu ponad listę. Scoring leadów świadomie
  czyta tylko surowe zdarzenia (minimalizacja): efektywny horyzont = min
  (horyzont scoringu, retencja).
- **Z-S2-07 - dokumenty rozliczeniowe.** Nowe dokumenty mają `environment`
  i `subscription_id` (odnowienia emitują `subscription.renewed.v1`;
  pierwsza faktura subskrypcji to zakup, nie odnowienie). Dokumenty sprzed
  zmiany zostają w diagnostyce jako „nieznane środowisko” - bez backfillu,
  żeby nie wywołać masowych spóźnionych odnowień.
- **Z-S5-01 - zdarzenie formularza kontaktowego.** Ładunek
  `{message_id, lead_id, form_kind, form_id}` bez danych osobowych;
  `form_kind = pricing`, gdy formularz to zapytanie z cennika. Źródło
  kontroluje klient, więc każdy może uruchomić ścieżkę B2B - skutkiem jest
  powiadomienie i zadanie personelu, w limicie formularza (5/10 min na IP,
  3/h na adres). Kandydaci do pracy (`careers`) nie wychodzą na szynę.
- **Z-I9b-14 - snapshot autoryzacji bez aliasu `is_admin_or_editor`
  (świadomie).** Alias w generatorze zmieniłby jedną linię snapshotu, ale
  wiersz `cap_premium_content` w `/admin/permissions` pokazałby wtedy admina
  i redaktora jako „pełny dostęp” - a raport personelu
  `admin_revenue_access_inventory` nie jest bramką czytelnika treści.
  Lepiej, żeby macierz uprawnień mówiła prawdę o czytelniku niż
  o raporcie. Raporty personelu mają w snapshocie `bypassRoles: []`.
- **Z-I9c-04 - dowody księgowe (decyzja właściciela, bez zmian).**
  Repozytorium trzyma dowody księgowe do 31.12 roku obrotowego + 6 lat
  (`accounting_retention_until`, `20261012121000`) - dłużej niż „5 lat od
  początku roku następującego po roku obrotowym” z polecenia (art. 74 ustawy
  o rachunkowości, mieści się w regule repo). Kontakt klienta CRM i wpisy
  audytu operacji finansowych idą za tą samą (dłuższą) datą. Skrócenie
  wymaga decyzji administratora danych i zmiany
  `accounting_retention_until` (dotyka dowodów księgowych).
- **D-09 - pulpit monetyzacji.** `/admin/monetization` ma baner „przeniesione
  do huba”; przekierowanie dopiero po 14 dniach bez rozjazdu `reconcileAll`
  (decyzja właściciela). Do tego czasu pulpit liczy własny ranking powodów
  rezygnacji (z `not_given` jako powodem).

## 7. Wycofanie

### 7.1 Zasady

- **Kod:** `git revert` commitu wycinka i publikacja frontu. SQL huba jest
  addytywny (nowe tabele, kolumny NULL-owalne albo z domyślną, funkcje,
  wyzwalacze), więc stara wersja frontu działa na nowej bazie - wyjątki
  w §7.2.
- **Baza: wyłącznie do przodu.** Bez `DROP` tabel i kolumn z danymi księgi,
  ścieżek i zgód. Zmiana zachowania = nowa migracja w bloku huba z ciałem
  funkcji z wcześniejszej wersji (`-- CIALO-Z:`), bliźniak drizzle, wpis
  w `hubDelivery.ts`.
- **Najpierw przełącznik, potem migracja.** Silnik, pomiar, retencja,
  kategorie i ścieżki mają przełączniki w panelu (§3) - działają od razu,
  bez wdrożenia.
- **Anonimizacja i retencja są nieodwracalne z założenia** (RODO); zdjęcie
  ich wyzwalaczy wstrzymuje je dla kolejnych przypadków, czego RODO nie
  dopuszcza bez innej anonimizacji - tylko decyzją administratora danych.

### 7.2 Per fala (szczegóły w sekcjach dziennika)

| Fala (wersje, bliźniaki)                | Wycofanie                                                                                                                                                                                                                                                                              | Dziennik             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| S3 `120000…120400`, `0347…0351`         | revert kodu przywraca dawny paywall; wyzwalacze `trg_profiles_account_registered_emit`, `payment_orders_checkout_emit` - migracją; `_metered_view_consume` z ciała `20261013090400`                                                                                                    | §18.9                |
| S5 `140000…140500`, `0352…0357`         | `enabled = false` w panelu; awaryjnie `JOURNEYS_ENGINE_DISABLED=1`; wyzwalacz `trg_journey_route_event` - migracją; `email_apply_delivery_event` z ciała `20260725123624`                                                                                                              | §20.9                |
| I9b A/A2/B `160000…160800`, `0358…0366` | segmenty - migracja z mapą sprzed I9b; limit miejsc Zespołu - `DROP TRIGGER` obu wyzwalaczy; limit tagu - ciała z `20261020130200`/`140200` i `CRM_TAG_MAX = 40`; redakcja księgi i szyny nieodwracalna                                                                                | §21.6, §21.9, §21.17 |
| I9c-X1 `160900`, `0367`                 | ciało `_hub_account_erase` z `20261020160700`; dren bez warstwy 2 - revert `queueDrain.server.ts`                                                                                                                                                                                      | §21.20               |
| I9c-X2 `161000…161400`, `0368…0372`     | wyłączenie kategorii albo przesunięcie karencji w karcie; odczyty agregatów działają bez pieczęci                                                                                                                                                                                      | §21.21               |
| S7 `150000…150100`, `0373…0375`         | front bez zmian SQL (nowych funkcji nikt nie woła); `DROP FUNCTION` - migracją, decyzją właściciela                                                                                                                                                                                    | §23.9                |
| I9d-Y1 `161500…162200`, `0376…0383`     | wyłączenie kategorii albo karencja w karcie; zanonimizowane wiersze i usunięci subskrybenci nie wracają                                                                                                                                                                                | §21.22               |
| I9d-Y2 `162300…162500`, `0384…0386`     | wspólny przełącznik pomiaru zatrzymuje pomiar u wszystkich; wpisy rejestru zgód zostają (dowód)                                                                                                                                                                                        | §21.23               |
| I9 `162600…162900`, `0387…0390`         | zestawienia: odczyty liczą surowe + zestawienie, puste zestawienie = zachowanie sprzed I9; pomocnik zgody - ciała z `20261012180900`, `20261020140500`, `20261020162000`; emiter formularza - §7.3; czytelnicy kampanii - ciała z `20260912110000`, `20261003180000`, `20261020161200` | §24                  |

### 7.3 Szablon awaryjny: emiter albo wyzwalacz jako no-op

Emitery huba łapią własne błędy (`EXCEPTION` → `domain_event_emit_errors`)
i nie przerywają zapisu modułu, więc wyzwalacz zdejmuje się tylko wtedy, gdy
sam zapis modułu jest zagrożony (np. blokady, wolumen). Szablon nowej
migracji (wersja w bloku huba wyższa od ostatniej, bliźniak drizzle, wpis
w `hubDelivery.ts`; poza oknem wysyłki, nocą dla gorących tabel):

```sql
-- ============================================================================
-- DEFEKT: <objaw z sygnału §4, np. błędy 55P03 przy zapisie formularza>.
-- ZMIANA: zdjęcie wyzwalacza <nazwa> na public.<tabela> (emiter jako no-op);
--   funkcja wyzwalacza zostaje, więc powrót = ponowne CREATE TRIGGER z wersji
--   <wersja migracji źródłowej>.
-- KOLEJNOSC: po <ostatnia wdrożona wersja huba>.
-- IDEMPOTENTNA: DROP TRIGGER IF EXISTS.
-- DOWOD: pgTAP <plik> - zapis do public.<tabela> bez wiersza w domain_events.
-- ============================================================================
SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS <nazwa> ON public.<tabela>;
RESET lock_timeout;
```

Wyzwalacze huba (nazwa → tabela): `trg_journey_route_event`,
`trg_run_workflows_for_event` → `domain_events`;
`trg_contact_messages_to_lead_submitted_emit` → `contact_messages`;
`trg_profiles_account_registered_emit` → `profiles`;
`payment_orders_checkout_emit` → `payment_orders`;
`trg_billing_documents_renewed_emit` → `billing_documents`;
`trg_subscriptions_revenue_history`, `trg_subscriptions_revenue_redact` →
`subscriptions`; `trg_crm_leads_00_hub_guard`, `trg_crm_leads_stage_history`
→ `crm_leads`; `trg_retention_feedback_emit` → `retention_feedback`;
`trg_club_applications_emit` → `club_applications`;
`trg_event_registrations_attended_emit` → `event_registrations`;
`trg_workflow_definitions_emit` → `workflow_definitions`;
`trg_crm_consent_log_measurement` → `crm_consent_log`;
`trg_newsletter_consents_log` → `newsletter_subscribers`;
`trg_newsletter_recipients_measured` → `newsletter_campaign_recipients`;
emitery ustawień S1 (`trg_*_settings_emit`, `trg_b2b_*_emit`,
`trg_content_access_emit`, `trg_retention_reasons_emit`) → tabele o tej
samej nazwie. Wyzwalaczy redakcji RODO (`on_auth_user_deleted_redact_*`)
i limitu miejsc Zespołu nie zdejmuje się tym szablonem (§7.1).

## 8. Kolejność wdrożenia migracji `0347…0390`

M0, S1, S2 i S4 (`0313…0346`) są na produkcji (potwierdzenie `0346`,
dziennik §10, §17.2). Do wdrożenia zostaje 44 bliźniaków. Migrator Drizzle
stosuje wpisy `drizzle/migrations/meta/_journal.json` po `idx` - kolejność
poniżej jest kolejnością dziennika. Bliźniaki są kopiami bajt w bajt
migracji `supabase/migrations/…`, więc po panelu Lovable wykonują się jako
no-op.

Wspólne zasady: okno nocne przy gorących tabelach; ALTER/wyzwalacze stoją
za `SET lock_timeout = '5s'` - błąd `55P03` = ponów cały plik (wszystkie
pliki są idempotentne); po każdej fali `workflow_dispatch` CI na `main` →
job `post-deploy` (`check:db-contract`, `check:migration-ledger`) i wpis do
§10 dziennika; front publikować razem z migracjami albo zaraz po nich.

| Krok | Bliźniaki   | Wersje                  | Fala                                            | Okno i warunki                                                                                                           | Kontrola           |
| ---- | ----------- | ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| 1    | `0347…0351` | `20261020120000…120400` | S3 - lejek i paywall czytelnika                 | nocą (wyzwalacze na `profiles`, `payment_orders`)                                                                        | K1, dziennik §18.9 |
| 2    | `0352…0357` | `20261020140000…140500` | S5 - silnik ścieżek                             | nocą (wyzwalacz na `domain_events`); silnik zostaje wyłączony                                                            | K2, §20.9          |
| 3    | `0358…0362` | `20261020160000…160400` | I9b A - segmenty, cennik v6.2, RODO księgi      | nocą (wyzwalacze `subscriptions`, `auth.users`, `member_organizations`, `organization_seats`; UPDATE `membership_tiers`) | K3, §21.6          |
| 4    | `0363…0365` | `20261020160500…160700` | I9b A2 - RODO po usunięciu konta                | nocą (domknięcie wstecz kont usuniętych wcześniej)                                                                       | K3, §21.9          |
| 5    | `0366`      | `20261020160800`        | I9b B - limit tagu 64                           | same funkcje                                                                                                             | K3, §21.17         |
| 6    | `0367`      | `20261020160900`        | I9c-X1 - autorzy, poczta w kolejce              | razem z frontem (dren woła `email_queue_send_recheck`)                                                                   | K4, §21.20         |
| 7    | `0368…0372` | `20261020161000…161400` | I9c-X2 - retencja danych                        | razem z frontem; potem 14 dni podglądu                                                                                   | K5, §21.21         |
| 8    | `0373…0375` | `20261020150000…150100` | S7 - diagnostyka                                | same funkcje, można w dzień                                                                                              | K6, §23.9          |
| 9    | `0376…0383` | `20261020161500…162200` | I9d-Y1 - kluby, licznik, wydarzenia, wygaszanie | nocą (ALTER `club_members`, `club_applications`, `paywall_hits`, `event_people`, `newsletter_subscribers`)               | K7, §21.22 pkt 7   |
| 10   | `0384…0386` | `20261020162300…162500` | I9d-Y2 - treść zgody i pomiar                   | razem z frontem, poza wysyłką kampanii                                                                                   | K8, §21.23 pkt 7   |
| 11   | `0387…0390` | `20261020162600…162900` | I9 - zestawienia, zgoda, formularz, kampanie    | krótka blokada `contact_messages` (wyzwalacz); reszta to funkcje i dwie nowe tabele                                      | K9, §24            |

S7 (krok 8) ma wersje bloku `15*`, ale bliźniaki po `0372` - Drizzle
wykonuje go po I9c, co jest bezpieczne (funkcje S7 tolerują brak tabel
modułów: `null` obszaru zamiast błędu).

### 8.1 Zapytania kontrolne

Pełne zestawy są w sekcjach dziennika z tabeli; tu - zapytanie, które
rozstrzyga, czy fala weszła.

```sql
-- K1 (S3): 4 niepuste kolumny i 2 wyzwalacze.
SELECT to_regprocedure('public.record_paywall_hit(text,uuid,text,text,text)') AS hit,
       to_regprocedure('public.record_paywall_hit_visitor(text,uuid,text,uuid,text,text,text)') AS visitor_hit,
       to_regprocedure('public.admin_revenue_funnel(timestamptz,timestamptz,text,text)') AS funnel,
       to_regprocedure('public.admin_revenue_access_inventory()') AS inventory;
SELECT count(*) FROM pg_trigger
 WHERE NOT tgisinternal AND tgname IN ('trg_profiles_account_registered_emit', 'payment_orders_checkout_emit');

-- K2 (S5): wyzwalacz trasy = 1, silnik wyłączony u każdego = 0, serwisowe bez klienta = false, false.
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'trg_journey_route_event';
SELECT count(*) FROM public.journey_settings WHERE enabled;
SELECT has_function_privilege('anon', 'public.journey_ingest_inbox(integer)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.journey_advance(uuid,uuid,integer)', 'EXECUTE');

-- K3 (I9b): segmenty zgodne (0), limit tagu 64 w obu ciałach, ślady kont usuniętych (0).
SELECT count(*) FROM public.mrr_movements m
 WHERE m.segment IS DISTINCT FROM public.revenue_segment_of_tier(
         CASE WHEN m.kind = 'churn' THEN m.tier_key_before ELSE m.tier_key_after END);
SELECT p.proname, pg_get_functiondef(p.oid) LIKE '%NOT BETWEEN 1 AND 64%' AS has_64
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('run_workflow_step', 'journey_validate_graph');
SELECT count(*) FROM public.domain_events e
 WHERE e.payload ->> 'user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4'
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = e.payload ->> 'user_id');

-- K4 (I9c-X1): autorzy i recenzenci kont nieistniejących - 0.
SELECT (SELECT count(*) FROM public.club_applications a
         WHERE a.reviewed_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.reviewed_by))
     + (SELECT count(*) FROM public.pages p
         WHERE p.author_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.author_id)) AS autorzy;

-- K5 (I9c-X2): kategorie i karencja per najemca (po I9d-Y1: 13), pieczęcie.
SELECT tenant_id, count(*) AS kategorie, min(enforce_after) AS wykonanie_od
  FROM public.data_retention_settings GROUP BY tenant_id;
SELECT tenant_id, scope, sealed_through, purged_before FROM public.data_retention_state ORDER BY 1, 2;

-- K6 (S7): 4 niepuste kolumny i 16 helperów faktów.
SELECT to_regprocedure('public.admin_revenue_facts()') AS facts,
       to_regprocedure('public.admin_revenue_diagnostic_snooze(text,text,text,timestamptz,text,text)') AS snooze,
       to_regprocedure('public.admin_revenue_diagnostic_unsnooze(text,text)') AS unsnooze,
       to_regprocedure('public.admin_revenue_diagnostic_snoozes()') AS snoozes;
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE '\_revenue\_facts\_%';

-- K7 (I9d-Y1): nowe kategorie z własną karencją; zgłoszenia kont usuniętych bez pseudonimu - 0.
SELECT tenant_id, category, enabled, period_months, enforce_after
  FROM public.data_retention_settings
 WHERE category IN ('metered_views', 'newsletter_inactive', 'event_attendees', 'club_applications')
 ORDER BY 1, 2;
SELECT count(*) FROM public.club_applications a
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id)
   AND substr(a.user_id::text, 15, 1) <> '8';

-- K8 (I9d-Y2): zgody z pomiarem (tuż po wdrożeniu 0, potem rośnie), wspólny przełącznik.
SELECT tenant_id, consent_version, given, count(*)
  FROM public.crm_consent_log WHERE consent_key = 'email_measurement'
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT tenant_id, open_tracking_enabled FROM public.journey_settings ORDER BY 1;

-- K9 (I9): dwie nowe tabele z RLS i bez dostępu ról API; emiter formularza;
--     pomocniki wewnętrzne bez EXECUTE ról API.
SELECT c.relname, c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select
  FROM pg_class c
 WHERE c.oid IN ('public.journey_enrollment_daily_stats'::regclass,
                 'public.newsletter_campaign_engagement_daily'::regclass);
--   oczekiwane: 2 wiersze, rls = true, anon_select = false, auth_select = false.
SELECT count(*) FROM pg_trigger
 WHERE NOT tgisinternal AND tgname = 'trg_contact_messages_to_lead_submitted_emit';
--   oczekiwane: 1.
SELECT has_function_privilege('authenticated',
         'public._crm_marketing_consent_withdraw(uuid,uuid[],crm_source_type,uuid,text,text,text,text)', 'EXECUTE') AS zgoda_auth,
       has_function_privilege('anon',
         'public._crm_marketing_consent_withdraw(uuid,uuid[],crm_source_type,uuid,text,text,text,text)', 'EXECUTE') AS zgoda_anon,
       has_function_privilege('authenticated',
         'public._newsletter_engagement_daily_sum(uuid,text,timestamptz,timestamptz,boolean)', 'EXECUTE') AS sumy_auth;
--   oczekiwane: false, false, false.
```

## 9. Po wdrożeniu - pierwsze dni (właściciel)

1. **14 dni podglądu retencji.** Karta „Retencja danych” pokazuje liczby
   z podglądu każdej kategorii; przed terminem karencji przejrzyj je
   i listę „do wygaszenia”, potem „Włącz teraz” albo przesuń termin.
2. **Polityki.** Jeśli najemca ma własną opublikowaną wersję polityki
   komunikacji albo prywatności (`legal_document_versions`), opublikuj nową
   wersję z akapitem o pomiarze w panelu dokumentów prawnych - wersja w bazie
   ma pierwszeństwo przed kodem.
3. **M3 - test na żywo ścieżek (Z-S5-07).** W zakładce Ścieżki zainstaluj
   `welcome_onboarding` i `abandoned_checkout`, uzupełnij nadawcę i Reply-To,
   opublikuj, uruchom „Testuj na sobie” („pomiń czekanie” prowadzi przez
   kolejne kroki). Sprawdź: oba maile dochodzą, linki przechodzą przez
   `nl-click` na właściwy cel, wypis jednym kliknięciem wyprowadza zapis
   z powodem `unsubscribed`, stopka wypisu występuje raz (Z-S5-05). Dopiero
   potem włącz silnik w „Ustawieniach silnika” i obserwuj 7 dni (§4).
4. **Stripe (Z-I9b-13, Z-S2-11):** trzy kroki wizualne w trybie testowym
   (kupon w panelu, `Idempotency-Key` w logach, portal z powodami) i powody
   rezygnacji w konfiguracji portalu klienta.
5. **Obserwacja 7 dni** wg §4 po każdej fali; wynik `post-deploy` do §10
   dziennika.

## 10. Budżet bundla i baseline (D-08)

- Progi w `scripts/check-bundle-size.ts`: `public`, `publicCss`, `chunk`,
  `boot` - zamrożone; `overall` i `css` - ratchet `ceil(zmierzone) + 1`
  z wpisem kroniki nad progiem (wycinek, baza, rozbicie wzrostu).
- `reports/bundle-baseline.json` (raport „ruchy względem baseline'u”)
  odświeża się **wyłącznie z zielonego buildu runnera CI**, nie z hosta
  (liczby hosta różnią się od runnera; zabetonowanie ich w pliku psułoby
  każdą kolejną deltę). Procedura: po scaleniu PR na `main` uruchom
  `workflow_dispatch` CI (krok „Bundle size budget” biegnie tylko na `main`
  i ręcznie); gdy jest zielony, na tym samym buildzie wykonaj
  `bun run scripts/check-bundle-size.ts --update-baseline` (jednorazowy
  krok w jobie albo build runnera pobrany jako artefakt) i zacommituj
  `reports/bundle-baseline.json` z `commit` i `bucketConvention: 3`.
  Do tego czasu raport ruchów porównuje z baseline'em `b006c2e`
  (2026-10-02, epoka Rollupa - część ruchów to przemianowania chunków).

## 11. e2e

`e2e` i `e2e-seeded` (`.github/workflows/e2e.yml`) rozstrzyga CI - lokalny
kontener nie ma demona Dockera (seed Supabase) ani sekretów. Na głowie PR
`2113569d` oba joby: `success` (114 testów zaliczonych, 25 pominiętych,
0 błędów) - Z-S3-04 zamknięte (dziennik §24).
