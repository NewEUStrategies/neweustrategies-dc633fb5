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

| Element                                                                                      | Miejsce w panelu                                                     | Rola                                                 | Mechanizm                                                                                                               |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Hub (Kokpit, Przychód, Retencja, Lejek, Dostęp, Oferta, Społeczność, Wskaźniki…)             | `/admin/revenue` (⌘K: zakładki, „Dane wejściowe”, skróty wskaźników) | admin i redaktor wg zakładki (`canSeeTab`)           | RPC `admin_revenue_*`, migawka, szyna zdarzeń z mapą inwalidacji                                                        |
| Diagnostyka (55 reguł, wyciszenia, mapa systemu)                                             | `/admin/revenue/diagnostics`; chipy sygnału w 10 ekranach modułów    | admin, redaktor (bez kwot)                           | `admin_revenue_facts()`, `admin_revenue_diagnostic_snooze*`                                                             |
| Ścieżki komunikacji (lista, galeria, edytor kanwy, wyniki, przewodnik)                       | `/admin/revenue/journeys`, edytor `/admin/revenue/journeys/<id>`     | edycja: admin i redaktor; publikacja i status: admin | tabele `journey_*`, runner w `jobs-tick`                                                                                |
| Ustawienia silnika ścieżek (włącznik, limit maili, cisza nocna, nadawca, pomiar)             | zakładka Ścieżki → „Ustawienia silnika”                              | admin                                                | `admin_journey_settings_get/save`                                                                                       |
| Harmonogram i jego zdrowie (karta „Silnik ścieżek komunikacji”)                              | `/admin/community/notifications` (panel zdrowia harmonogramu)        | admin, redaktor (podgląd, „Uruchom tick teraz”)      | `job_runner_runs`, `admin_journey_engine_health()`                                                                      |
| Retencja danych (kategorie, karencja, „Włącz teraz”, lista „do wygaszenia”)                  | `/admin/settings/privacy` - karta „Retencja danych”                  | admin                                                | `data_retention_*`, krok `dataRetention` w `jobs-tick`                                                                  |
| Treść zgody na newsletter, podgląd osobnego pola zgody na pomiar, „Poproś o zgodę na pomiar” | `/admin/newsletter/overview`                                         | treść: admin i redaktor; prośba: admin               | `newsletter_settings.policy_html_*` (grupa `inline`), `admin_newsletter_measurement_*` (od I9d-Y2b bez oznaczeń admina) |
| Treść maili próśb (wygaszanie, zgoda na pomiar)                                              | `/admin/newsletter/email-content`                                    | admin                                                | ustawienia newslettera                                                                                                  |
| Skrzynka wysyłek (powody zatrzymania z etykietami PL/EN)                                     | `/admin/newsletter/outbox`                                           | admin i redaktor                                     | `email_send_log` (`suppressed:*`, `skipped:*`, `cancelled:account_deleted`)                                             |
| CRM (lista, karta leada z kartą „Ścieżki”, import CSV, przypisanie zadań)                    | `/admin/crm`, `/admin/crm/<id>`                                      | personel CRM (admin, redaktor)                       | `crm_*`, oś leada z typem `journey`                                                                                     |

## 2. Harmonogram (`jobs-tick`)

`jobs-tick` biegnie co minutę (pg_cron + pg_net → `POST /api/public/jobs-tick`);
przycisk „Uruchom tick teraz” w `/admin/community/notifications` wykonuje ten
sam przebieg. Siatka bezpieczeństwa to `community-cron` (pg_cron co 5 minut
i workflow GitHub `scheduler.yml`) - szczegóły w `docs/RUNBOOK_COMMUNITY.md`.
Kroki huba i ich rytm:

| Krok w `job_runner_runs.result` | Kiedy                                                                                                                                      | Co robi                                                                                                              | Limity i termin                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `journeys`                      | co minutę, po zadaniach uczestnika, PRZED drenem                                                                                           | `runJourneysTick`: skrzynka → zapisy → kroki → maile (dren wysyła je w tym samym ticku)                              | `ingestLimit` 200, `claimLimit` 50, termin 3 s od startu                                                        |
| `emailQueue`                    | co minutę, po `journeys`                                                                                                                   | dren kolejek poczty                                                                                                  | 60 wiadomości, min. 4 s                                                                                         |
| `revenueLifecycle`              | co 5 min (minuty 0, 5, 10…)                                                                                                                | `run_revenue_lifecycle_scanner` (koniec okresu próbnego, wygaśnięcia, windykacja, migawki MRR)                       | literał RPC, znaczniki `revenue_event_marks`                                                                    |
| `retentionFlow`                 | co 5 min                                                                                                                                   | `run_retention_flow_scanner` (porzucone przepływy anulowania)                                                        | jw.                                                                                                             |
| `newsletterSunset`              | co 10 min (minuty 9, 19…), okno 08-17 czasu polskiego                                                                                      | prośby „Chcę dalej otrzymywać” (wygaszanie nieaktywnych)                                                             | ≤ 200 maili/dobę/najemcę (wspólnie z prośbami pomiaru)                                                          |
| `newsletterMeasurement`         | co 10 min (minuty 4, 14…): prośby z panelu w oknie 08-17 czasu polskiego, prośby po zapisie (`origin = 'signup'`, I9d-Y2b) przez całą dobę | prośby o osobną zgodę na pomiar - z panelu („Poproś o zgodę na pomiar”) i po zapisie bez double opt-in (stała treść) | panel ≤ 200 maili/dobę/najemcę wspólnie z wygaszaniem; po zapisie ≤ 500/dobę/najemcę (własny limit); termin 4 s |
| `journeysRollup`                | co godzinę w minucie 13                                                                                                                    | `journey_rollup_daily()` - dzienne liczniki kroków ścieżek                                                           | -                                                                                                               |
| `journeysPurge`                 | raz na dobę o 03:11 UTC                                                                                                                    | `journey_purge('30 days')` - przetworzona skrzynka > 30 dni, błędy silnika > 90 dni                                  | pominięty tick = sprzątanie dzień później (wiersze 31 dni)                                                      |
| `dataRetention`                 | 02:07-02:57 UTC co 10 min (ostatni krok ticku)                                                                                             | `data_retention_run(p_limit => 5000)` - podgląd albo wykonanie kategorii, pieczęcie agregatów, zestawienia           | budżet 8 s, `more: true` = reszta w kolejnym oknie                                                              |

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
- **Pomiar tylko za OSOBNĄ zgodą, potwierdzoną przez właściciela skrzynki**
  (I9d-Y2b, decyzje właściciela 2026-10-23: D1 wariant (b), D2; dziennik
  §25). Piksel i linki z identyfikatorem odbiorcy wyłącznie u aktywnego
  subskrybenta (`subscribed`/`confirmed`) z wpisem
  `crm_consent_log.consent_key = 'email_measurement'` „tak”, który jest
  związany z jego wierszem (`source_id`), pochodzi z kanału udzielenia
  i ma wersję treści pomiaru `email-measurement-2026-10-23` - i jest
  późniejszy niż każde „nie” pomiaru, wycofanie zgody newsletter/marketing
  i wypis (remis chwil = brak pomiaru).
- **Pole w formularzu to deklaracja, nie zgoda.** Osobne, domyślnie
  niezaznaczone pole zapisuje w `newsletter_subscribers.consents` pozycję
  `email_measurement_declared`; rejestr zgód jej nie loguje. Zgodę zapisuje
  WYŁĄCZNIE `_email_measurement_grant` (strażnik `trg_crm_consent_log_measurement_guard`
  odrzuca każde inne „tak”, `trg_crm_consent_log_measurement_lock` blokuje
  zmianę decyzji, kanału, wersji i chwili wpisu).
- **Kanały udzielenia** (`form_id`): `measurement:doi` (karta na stronie
  potwierdzenia double opt-in; POST z tokenem DOI i podpisanym sekretem
  skrzynki `m` z linku maila DOI - sam token DOI nie wystarcza, bo widzi go
  personel; oferta wygasa 60 dni od wysłania maila DOI),
  `measurement:signup` (mail z prośbą po zapisie bez DOI albo przy ponownym
  zapisie aktywnego adresu), `measurement:reconfirm` (prośba z panelu;
  potwierdzenie tylko dla adresu, na który wyszedł mail). **Kanały własnej
  odmowy** (wykluczają z próśb; odmowa zapisuje się także bez wcześniejszej
  zgody): `measurement:email_footer`, `measurement:preferences`,
  `measurement:account`, `measurement:doi_declined`.
- **Wypis daje „nie”.** Każde przejście subskrybenta na `unsubscribed`
  (link, personel, odbicie, skarga, import) dopisuje „nie” z kanałem
  neutralnym `measurement:unsubscribe` (nie wyklucza z próśb), gdy ostatnie
  słowo łańcucha brzmi „tak”. „Przywróć” w panelu nie wskrzesza zgody;
  ponowny zapis wymaga nowego potwierdzenia skrzynką. Adresy wypisane przed
  wdrożeniem domyka jednorazowo migracja `20261023090300`
  (`_email_measurement_close_backfill`, kontrola Y2b-K10).
- **Wycofanie zgody newsletter/marketing daje „nie” pomiaru** (wyzwalacz
  `trg_crm_consent_log_measurement_opt_out`, kanał neutralny
  `measurement:opt_out`), więc retencja łańcucha newsletter/marketing nie
  wskrzesza dawnego „tak” pomiaru.
- **Kolumny personelu.** Rola `authenticated` czyta wszystkie kolumny
  `newsletter_subscribers` poza `confirmation_token`, a zmienia tylko
  status, wypis, imię i nazwisko, język i `meta`; token DOI, deklarację
  (`consents`) i adres zapisuje wyłącznie serwer. Nowa kolumna tej tabeli
  musi trafić do `GRANT SELECT (…)`, inaczej panel jej nie zobaczy.
- **Treść zgody na newsletter** (PL/EN, wersja `newsletter-2026-10-23`,
  bez pomiaru) - przegląd newslettera. Oznaczeń admina „mój tekst obejmuje
  pomiar” nie ma (tabela oznaczeń - archiwum). Karta pokazuje tylko do
  odczytu treść i wersję pola pomiaru oraz ostrzega, gdy własny tekst
  zgody na newsletter wspomina pomiar (kontrola Y2b-K5b, §8.2).
- **„Poproś o zgodę na pomiar”** - przegląd newslettera: podgląd liczby
  adresatów (liczniki tylko próśb `origin = 'panel'`), potwierdzenie,
  wysyłka krokiem `newsletterMeasurement` (minuta 4, okno 08-17,
  ≤ 200/dobę/najemcę wspólnie z prośbami wygaszania). Kandydat, który
  dostał już mail prośby w DOWOLNEJ wersji treści albo sam odmówił, nie
  dostaje drugiej prośby. Prośby po zapisie (`origin = 'signup'`) mają
  stałą treść, idą przez całą dobę i mają własny limit 500/dobę.
- **Wyłącznik awaryjny bez kodu:** wspólny przełącznik pomiaru najemcy
  (karta „Retencja danych”, ustawienia silnika ścieżek albo przegląd
  newslettera; w SQL `journey_settings.open_tracking_enabled = false`) -
  od razu `measured = false` u wszystkich, wpisy rejestru zgód zostają.
- **Tryb źródła zaangażowania** `NEWSLETTER_ENGAGEMENT_SOURCE` musi zostać
  `first_party` (domyślnie), a śledzenie otwarć i kliknięć u dostawcy poczty
  (Resend) - wyłączone. Tryb `provider` nie daje się pogodzić z pomiarem
  tylko za zgodą (dostawca mierzy wszystkich). Zmiana trybu nie jest
  przełącznikiem panelu z założenia - to decyzja prawna, nie operacyjna.
- **Skutek zamierzony wdrożenia I9d-Y2 i I9d-Y2b:** zgody sprzed nowej
  treści nie obejmują pomiaru, a od I9d-Y2b także zgody wyprowadzone
  z treści zgody na newsletter (a) - wskaźniki otwarć i kliknięć spadają
  niemal do zera na starcie (mianownik kampanii = mierzeni; ścieżki -
  dymek). Skutki szczegółowo - §6.
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

-- Q11. Osobna zgoda na pomiar (I9d-Y2b): łańcuch per kanał i wersja z ostatniej
--      doby, prośby per pochodzenie i stan, aktywni z deklaracją bez decyzji.
SELECT form_id, consent_version, given, count(*), max(created_at)
  FROM public.crm_consent_log
 WHERE consent_key = 'email_measurement' AND created_at > now() - interval '24 hours'
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT origin, consent_version, mail_outcome, count(*),
       count(*) FILTER (WHERE confirmed_at IS NOT NULL) AS potwierdzone
  FROM public.newsletter_measurement_requests
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT s.tenant_id, count(*) AS deklaracja_bez_zgody
  FROM public.newsletter_subscribers s
 WHERE s.status IN ('subscribed', 'confirmed')
   AND s.consents @> '[{"key": "email_measurement_declared"}]'::jsonb
   AND NOT public._email_measurement_consent(s.tenant_id, s.email)
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

- **I9d-Y2b - pomiar tylko po potwierdzeniu skrzynki (dziennik §25).**
  Świadome skutki decyzji D1 i D2, bez zmian w kodzie:
  - odsetek mierzonych odbiorców spada na starcie niemal do zera (zgody
    wyprowadzone z treści (a) nie mają mocy; potwierdzenia (a) z osobnego
    kliknięcia na stronie pomiaru - `newsletter:measurement_reconfirm` -
    zachowują moc);
  - kontakty ścieżek bez subskrypcji newslettera (także w mailach
    serwisowych) i subskrybenci `pending` tracą piksel - wprost z D2;
  - **ścieżka powitalna** (`newsletter_welcome`): warunek `email_opened`
    dla niemierzonego odbiorcy daje „nie”, więc prawie każdy nowy
    subskrybent dostanie mail „preferences”, choć czyta. Predykat zostaje
    bez zmian (silnik ścieżek jest domyślnie wyłączony - M3); edytor
    warunków `email_opened`/`email_clicked` mówi to w ostrzeżeniu. Przed
    włączeniem silnika przejrzyj gałęzie oparte na otwarciach;
  - jedna prośba na wersję treści i subskrybenta (klucz główny tabeli
    próśb); kto dostał mail prośby (a), nie dostanie drugiej z panelu;
  - subskrybent już zapisany (gałąź „już zapisany”) z zaznaczonym polem
    dostaje prośbę po zapisie, jeśli sam wcześniej nie odmówił;
  - własne teksty zgody admina z opisem pomiaru (kopie (a) zmienione przez
    admina) migracja zostawia bez zmian - panel ostrzega, a kontrola
    Y2b-K5b (§8.2) je wskazuje.

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

| Fala (wersje, bliźniaki)                | Wycofanie                                                                                                                                                                                                                                                                                                | Dziennik             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| S3 `120000…120400`, `0347…0351`         | revert kodu przywraca dawny paywall; wyzwalacze `trg_profiles_account_registered_emit`, `payment_orders_checkout_emit` - migracją; `_metered_view_consume` z ciała `20261013090400`                                                                                                                      | §18.9                |
| S5 `140000…140500`, `0352…0357`         | `enabled = false` w panelu; awaryjnie `JOURNEYS_ENGINE_DISABLED=1`; wyzwalacz `trg_journey_route_event` - migracją; `email_apply_delivery_event` z ciała `20260725123624`                                                                                                                                | §20.9                |
| I9b A/A2/B `160000…160800`, `0358…0366` | segmenty - migracja z mapą sprzed I9b; limit miejsc Zespołu - `DROP TRIGGER` obu wyzwalaczy; limit tagu - ciała z `20261020130200`/`140200` i `CRM_TAG_MAX = 40`; redakcja księgi i szyny nieodwracalna                                                                                                  | §21.6, §21.9, §21.17 |
| I9c-X1 `160900`, `0367`                 | ciało `_hub_account_erase` z `20261020160700`; dren bez warstwy 2 - revert `queueDrain.server.ts`                                                                                                                                                                                                        | §21.20               |
| I9c-X2 `161000…161400`, `0368…0372`     | wyłączenie kategorii albo przesunięcie karencji w karcie; odczyty agregatów działają bez pieczęci                                                                                                                                                                                                        | §21.21               |
| S7 `150000…150100`, `0373…0375`         | front bez zmian SQL (nowych funkcji nikt nie woła); `DROP FUNCTION` - migracją, decyzją właściciela                                                                                                                                                                                                      | §23.9                |
| I9d-Y1 `161500…162200`, `0376…0383`     | wyłączenie kategorii albo karencja w karcie; zanonimizowane wiersze i usunięci subskrybenci nie wracają                                                                                                                                                                                                  | §21.22               |
| I9d-Y2 `162300…162500`, `0384…0386`     | wspólny przełącznik pomiaru zatrzymuje pomiar u wszystkich; wpisy rejestru zgód zostają (dowód)                                                                                                                                                                                                          | §21.23               |
| I9d-Y2b `090000…090300`, `0394…0397`    | baza tylko do przodu (powrót do pakietowania wykluczony decyzją D1); wyłącznik awaryjny - wspólny przełącznik pomiaru (`measured = false` od razu); błąd czytelnika - nowa migracja z czytelnikiem zwracającym `false`; revert frontu po migracji - uwaga na pole „prywatność” popupu rejestracji (§8.2) | §25                  |
| I9 `162600…162900`, `0387…0390`         | zestawienia: odczyty liczą surowe + zestawienie, puste zestawienie = zachowanie sprzed I9; pomocnik zgody - ciała z `20261012180900`, `20261020140500`, `20261020162000`; emiter formularza - §7.3; czytelnicy kampanii - ciała z `20260912110000`, `20261003180000`, `20261020161200`                   | §24                  |

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

### 8.2 I9d-Y2b - osobna zgoda na pomiar (`20261023090000…090300`, `0394…0397`)

Decyzje właściciela 2026-10-23: **D1 wariant (b)** - każda zgoda ma osobne
pole (osobne, domyślnie niezaznaczone pole zgody na pomiar z własną,
wersjonowaną treścią; treść zgody na newsletter bez pomiaru) i **D2** -
pomiar tylko dla skrzynki potwierdzonej przez jej właściciela. Dziennik
§25. Fale `0347…0390` są na produkcji (potwierdzenie
`0391_pr530_deployment_completion`); `0392`/`0393` (źródło kuponu) to pas
Drizzle. Kontrole mają prefiks `Y2b-`, żeby nie myliły się z K1-K9 fal
z §8.1 (w projekcie I9d-Y2b i w dzienniku §25 - K1-K9 i K5b).

**Przed wdrożeniem (SQL editor, tylko odczyt):**

```sql
-- Y2b-K1 (pytanie Q2): double opt-in per najemca. DEFAULT kolumny to false -
--     bez DOI zaznaczone pole daje osobny mail z prośbą (origin signup).
SELECT tenant_id, double_opt_in FROM public.newsletter_settings ORDER BY 1;

-- Y2b-K2: skala unieważnienia wpisów (a). Moc zachowują tylko potwierdzenia
--     z osobnego kliknięcia na stronie pomiaru (form_id
--     'newsletter:measurement_reconfirm' z potwierdzoną prośbą); wiersze
--     wyprowadzone wyzwalaczem z treści zgody na newsletter (a) - nie.
SELECT l.form_id, l.source_type, s.status, count(*)
  FROM public.crm_consent_log l
  LEFT JOIN public.newsletter_subscribers s ON s.id = l.source_id
 WHERE l.consent_key = 'email_measurement' AND l.given AND l.created_at >= '2026-10-21'
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- Y2b-K3: musi dać 0 (wersji treści pomiaru nikt jeszcze nie zapisał).
SELECT count(*) FROM public.crm_consent_log
 WHERE consent_key = 'email_measurement' AND consent_version = 'email-measurement-2026-10-23';

-- Y2b-K4: prośby per wersja treści (niewysłane prośby (a) migracja przepnie
--     na wersję pomiaru; wysłane i potwierdzone zostają).
SELECT consent_version,
       count(*) FILTER (WHERE mailed_at IS NULL) AS w_kolejce,
       count(*) FILTER (WHERE confirmed_at IS NOT NULL) AS potwierdzone,
       count(*) AS razem
  FROM public.newsletter_measurement_requests GROUP BY 1 ORDER BY 1;

-- Y2b-K5: oznaczenia admina z okresu (a) - po migracji archiwum tylko do
--     odczytu; przejrzyj ręcznie te teksty (mogą opisywać pomiar).
SELECT tenant_id, field, marked_at FROM public.newsletter_consent_measurement_marks ORDER BY 1, 2;

-- Y2b-K5b (R1.24): własne teksty zgody na newsletter, które WSPOMINAJĄ pomiar -
--     migracja ich nie zmienia (podmienia tylko dokładne kopie treści
--     domyślnych). To samo wyrażenie co ostrzeżenie panelu
--     (`consentTextRules.ts`, CONSENT_MEASUREMENT_MENTION). Treść domyślna (a)
--     też pasuje - po migracji jej kopii już nie ma, więc wynik po wdrożeniu
--     to wyłącznie teksty admina. Każdy wiersz: popraw tekst w panelu
--     (opis pomiaru należy do osobnego pola).
SELECT tenant_id, 'policy_html_pl' AS pole, policy_html_pl AS tekst
  FROM public.newsletter_settings WHERE policy_html_pl ~* 'mierz|pomiar|measur'
UNION ALL
SELECT tenant_id, 'policy_html_en', policy_html_en
  FROM public.newsletter_settings WHERE policy_html_en ~* 'mierz|pomiar|measur'
UNION ALL
SELECT tenant_id, 'popup_privacy_html_pl', popup_privacy_html_pl
  FROM public.newsletter_settings WHERE popup_privacy_html_pl ~* 'mierz|pomiar|measur'
UNION ALL
SELECT tenant_id, 'popup_privacy_html_en', popup_privacy_html_en
  FROM public.newsletter_settings WHERE popup_privacy_html_en ~* 'mierz|pomiar|measur'
UNION ALL
SELECT tenant_id, 'popup_fields (newsletter_optin)', f::text
  FROM public.newsletter_settings, jsonb_array_elements(
         CASE WHEN jsonb_typeof(popup_fields) = 'array' THEN popup_fields ELSE '[]'::jsonb END) AS f
 WHERE f ->> 'key' = 'newsletter_optin'
   AND concat_ws(' ', f ->> 'label_pl', f ->> 'label_en') ~* 'mierz|pomiar|measur';
--   Treść zgody w widżetach buildera („Dołącz do nas” `consentText_*`,
--   etykieta zapisu w formularzu kontaktu `newsletterLabel_*`): strony,
--   których dane buildera mają taki tekst - otwórz widżet i popraw.
SELECT p.tenant_id, p.slug
  FROM public.pages p
 WHERE p.builder_data::text ~* '"(consentText|newsletterLabel)_(pl|en)"\s*:\s*"[^"]*(mierz|pomiar|measur)'
 ORDER BY 1, 2;

-- Y2b-K6a (pytanie Q1 - do decyzji właściciela; NIC nie usuwamy w tym PR):
--     zdarzenia otwarć i kliknięć z okresu (a), od 2026-10-22 do wdrożenia.
--     Kampanie: odbiorca bez potwierdzonej skrzynki w chwili zdarzenia
--     (brak subskrybenta, `pending` albo potwierdzenie później niż zdarzenie)
--     kontra pozostali. Status i potwierdzenie są BIEŻĄCE - wynik orientacyjny.
SELECT CASE WHEN s.id IS NULL THEN 'brak_subskrybenta'
            WHEN s.confirmed_at IS NULL AND s.status NOT IN ('subscribed', 'confirmed')
              THEN 'niepotwierdzony'
            WHEN s.confirmed_at > e.created_at THEN 'potwierdzony_pozniej'
            ELSE 'aktywny_w_chwili_zdarzenia' END AS odbiorca,
       e.kind, count(*)
  FROM public.newsletter_campaign_events e
  LEFT JOIN public.newsletter_subscribers s ON s.id = e.subscriber_id
 WHERE e.created_at >= '2026-10-22' AND e.kind IN ('open', 'click')
 GROUP BY 1, 2 ORDER BY 1, 2;
--     Ścieżki: kontakt CRM bez aktywnej subskrypcji (dziś - orientacyjnie).
SELECT CASE WHEN s.id IS NULL THEN 'kontakt_bez_subskrypcji'
            WHEN s.status IN ('subscribed', 'confirmed') THEN 'aktywny_subskrybent'
            ELSE s.status END AS odbiorca,
       ev.kind, count(*)
  FROM public.journey_message_events ev
  JOIN public.journey_messages m ON m.message_id = ev.message_id
  JOIN public.crm_leads l ON l.id = m.lead_id
  LEFT JOIN public.newsletter_subscribers s
         ON s.tenant_id = l.tenant_id AND lower(s.email) = lower(l.email)
 WHERE ev.occurred_at >= '2026-10-22' AND ev.kind IN ('open', 'click')
 GROUP BY 1, 2 ORDER BY 1, 2;
```

```sql
-- Y2b-K6b - GOTOWE do wykonania DOPIERO po decyzji właściciela (Q1, wariant
--     rekomendowany: usunąć zdarzenia odbiorców bez potwierdzonej skrzynki
--     w chwili zdarzenia, zdarzenia aktywnych subskrybentów zostawić
--     w zwykłej retencji). Usunięcie jest NIEODWRACALNE: najpierw wynik K6a
--     do dziennika §10, potem ten blok. Domyślnie kończy się ROLLBACK -
--     zamień na COMMIT świadomie, po sprawdzeniu liczb.
BEGIN;
DELETE FROM public.newsletter_campaign_events e
 WHERE e.created_at >= '2026-10-22' AND e.created_at < '<chwila wdrożenia>'
   AND e.kind IN ('open', 'click')
   AND NOT EXISTS (SELECT 1 FROM public.newsletter_subscribers s
                    WHERE s.id = e.subscriber_id
                      AND (s.confirmed_at <= e.created_at
                           OR (s.confirmed_at IS NULL AND s.status IN ('subscribed', 'confirmed'))));
DELETE FROM public.journey_message_events ev
 USING public.journey_messages m, public.crm_leads l
 WHERE m.message_id = ev.message_id AND l.id = m.lead_id
   AND ev.occurred_at >= '2026-10-22' AND ev.occurred_at < '<chwila wdrożenia>'
   AND ev.kind IN ('open', 'click')
   AND NOT EXISTS (SELECT 1 FROM public.newsletter_subscribers s
                    WHERE s.tenant_id = l.tenant_id AND lower(s.email) = lower(l.email)
                      AND (s.confirmed_at <= ev.occurred_at
                           OR (s.confirmed_at IS NULL AND s.status IN ('subscribed', 'confirmed'))));
ROLLBACK;
--   Zestawienia dzienne (`newsletter_campaign_engagement_daily`) i liczniki
--   per krok ścieżek, zapisane wcześniej przez retencję, zostają - to sumy
--   bez danych osoby.
```

**Wdrożenie - kolejność obowiązkowa:**

1. Migracje `20261023090000` → `090100` → `090200` → `090300` (bliźniaki
   `0394` → `0397`, kopie bajt w bajt - po panelu Lovable no-op). Poza oknem
   wysyłki próśb z panelu (08:00-17:59 czasu polskiego) i poza wysyłką
   kampanii: krótkie blokady `newsletter_settings`, `crm_consent_log`,
   `newsletter_subscribers` i `newsletter_measurement_requests` za
   `lock_timeout` 5 s (`55P03` = ponów plik; wszystkie są idempotentne).
   `090300` (poprawki przeglądu R1) zmienia uprawnienia kolumn personelu
   do `newsletter_subscribers`, zastępuje sygnatury
   `newsletter_doi_measurement_state`/`_decide` (sekret skrzynki) i na
   końcu domyka łańcuchy pomiaru pod blokadą `SHARE ROW EXCLUSIVE` na
   `crm_consent_log` (wpisy zgód czekają na koniec migracji). Sekret
   podpisu `m` to istniejący `SESSION_SECRET` - bez nowej zmiennej.
2. **Zaraz potem** publikacja frontu I9d-Y2b. Nowy front ze starym SQL
   zapisałby deklarację pola pomiaru do rejestru zgód jako wpis „tak”
   klucza `email_measurement_declared` (stary pisarz przepuszcza każdy
   klucz - w CRM wyglądałoby to jak zgoda), karta pomiaru na stronie DOI
   by się nie pokazała, a prośby po zapisie by nie powstały (RPC jeszcze
   nie istnieją - błąd w logu, zapis działa). Stary front z `090300`
   woła usunięte sygnatury strony DOI - karta się nie pokazuje
   (fail-closed), samo potwierdzenie zapisu działa.
3. Publikacja nowych wersji polityk komunikacji i prywatności w panelu
   dokumentów prawnych, jeśli najemca ma własne opublikowane wersje
   (`legal_document_versions` ma pierwszeństwo przed kodem -
   `src/lib/legal/resolve.ts`); daty w kodzie: 2026-10-23 (przy późniejszym
   wdrożeniu - dzień wdrożenia).
4. `workflow_dispatch` CI na `main` → `post-deploy`, wpis w §10 dziennika.

**Po wdrożeniu:**

```sql
-- Y2b-K7: subskrybent `pending` z pomiarem - musi dać 0; strażnicy i wypis
--     (3 wyzwalacze), wyzwalacz pakietowania usunięty (0).
SELECT count(*) FROM public.newsletter_subscribers s
 WHERE s.status = 'pending' AND public._email_measurement_consent(s.tenant_id, s.email);
--     Od 090300 - 4 wyzwalacze (także wycofanie newsletter/marketing).
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
  'trg_crm_consent_log_measurement_guard', 'trg_crm_consent_log_measurement_lock',
  'trg_newsletter_unsubscribed_measurement', 'trg_crm_consent_log_measurement_opt_out');
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'trg_crm_consent_log_measurement';

-- Y2b-K8 (codziennie przez 7 dni): nowe „tak” pomiaru wyłącznie z trzech
--     kanałów udzielenia i w wersji email-measurement-2026-10-23.
SELECT form_id, consent_version, count(*)
  FROM public.crm_consent_log
 WHERE consent_key = 'email_measurement' AND given AND created_at > '<chwila wdrożenia>'
 GROUP BY 1, 2 ORDER BY 1, 2;
--   dopuszczalne: measurement:doi | measurement:signup | measurement:reconfirm.

-- Y2b-K10 (raz, po 090300): domknięcie łańcuchów pomiaru z chwili migracji -
--     liczba dopisanych „nie” (wypisani przed wdrożeniem z ostatnim słowem
--     „tak” i aktywni z wcześniejszym wycofaniem newsletter/marketing);
--     wpis do §10 dziennika. Powtórka pomocnika daje 0.
SELECT form_id, count(*) FROM public.crm_consent_log
 WHERE consent_key = 'email_measurement' AND NOT given
   AND form_id IN ('measurement:unsubscribe', 'measurement:opt_out')
   AND created_at >= '<chwila migracji 090300>'
 GROUP BY 1 ORDER BY 1;
--     Personel nie czyta tokenu DOI - musi dać false:
SELECT has_column_privilege('authenticated', 'public.newsletter_subscribers',
                            'confirmation_token', 'SELECT');
```

- **Y2b-K9 (ręcznie, skrzynki testowe):**
  - wypis testowego adresu dopisuje „nie” `measurement:unsubscribe` (Q11);
  - skrzynka z DOI: zapis z zaznaczonym polem → notka w mailu DOI (link
    z parametrami `token` i `m`) → karta na stronie potwierdzenia →
    „Zgadzam się na pomiar” → wpis `measurement:doi` → `measured = true`
    w porcji kampanii; ten sam link bez `m` - potwierdzenie bez karty;
  - drugi adres: „Nie zgadzam się” → wpis `measurement:doi_declined`,
    adres nie jest kandydatem do prośby z panelu;
  - najemca bez DOI (jeśli jest): mail prośby po zapisie (stała treść) →
    `/newsletter/measurement` → wpis `measurement:signup`;
  - formularz bez zaznaczonego pola: zapis działa jak dotąd, w `consents`
    brak `email_measurement_declared`.

**Wyłącznik awaryjny (bez kodu):** wspólny przełącznik pomiaru najemcy
(§3.3) - `journey_settings.open_tracking_enabled = false` daje od razu
`measured = false` wszędzie. Błąd czytelnika naprawia nowa migracja
z czytelnikiem zwracającym `false`. Migracje działają tylko do przodu;
powrót do pakietowania (a) wykluczony decyzją D1.

**Cofnięcie samego frontu po migracji** jest bezpieczne dla zgód (stary
front nie wysyła deklaracji; stara karta treści zgody pokaże stan
„niedostępne” zamiast oznaczeń; po `090300` stara karta DOI się nie
pokaże - usunięte sygnatury, fail-closed), ALE stary popup rejestracji nie
zna treści (b): tam, gdzie `policy_html_*` niesie treść (b) (DEFAULT kolumny i wiersze
podmienione migracją), a `popup_privacy_html_*` jest puste, pokazałby treść
zgody na newsletter w WYMAGANYM polu „prywatność” (art. 7 ust. 4 RODO). Na
czas cofnięcia wyłącz popup rejestracji albo wpisz własną treść pola
„prywatność” w zakładce „Zgody”.

**Świadome skutki** - §6 (I9d-Y2b): odsetek mierzonych spada niemal do
zera, kontakty ścieżek bez subskrypcji tracą piksel, ścieżka powitalna,
jedna prośba na wersję i subskrybenta.

## 9. Po wdrożeniu - pierwsze dni (właściciel)

1. **14 dni podglądu retencji.** Karta „Retencja danych” pokazuje liczby
   z podglądu każdej kategorii; przed terminem karencji przejrzyj je
   i listę „do wygaszenia”, potem „Włącz teraz” albo przesuń termin.
2. **Polityki.** Jeśli najemca ma własną opublikowaną wersję polityki
   komunikacji albo prywatności (`legal_document_versions`), opublikuj nową
   wersję w panelu dokumentów prawnych - wersja w bazie ma pierwszeństwo
   przed kodem. Od I9d-Y2b (2026-10-23) polityki opisują osobne,
   niezaznaczone pole zgody na pomiar, potwierdzenie przyciskiem przez
   właściciela skrzynki, osobne wycofanie i koniec zgody z końcem
   subskrypcji (§8.2 krok 3).
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
