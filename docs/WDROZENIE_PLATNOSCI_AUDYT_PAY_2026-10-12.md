# Wdrożenie audytu płatności PAY - runbook operatora (2026-10-12)

> Zakres: PR #496 - poprawki audytu płatności PAY-01 ... PAY-17 i dwóch rund
> przeglądu (kasa, zwroty i spory, realizacja zamówień, dyspozytor zdarzeń,
> transport webhooków i operacje). Ten dokument jest listą kroków dla
> operatora wdrożenia: co zrobić PRZED kodem, co przy wdrożeniu i co po nim.
> Uzasadnienia techniczne żyją w nagłówkach migracji i w komentarzach kodu -
> tu są wyłącznie decyzje i polecenia.
>
> Migracje są nazwane NAZWĄ (np. `subscription_event_guard`), nie numerem
> wersji: integrator przenumerowuje je przy scalaniu z `main`. Plik migracji
> znajdziesz poleceniem `ls supabase/migrations | grep <nazwa>`.

## 0. Skrót - kolejność kroków

| #   | Kiedy             | Krok                                                                                                    | Sekcja |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| 1   | przed             | Przegląd `checkout_settings` z włączonym polem kodu promocyjnego                                        | 4.1    |
| 2   | przed             | Przegląd aktywnych planów bez pary w katalogu (`tier_key`, `interval`)                                  | 5      |
| 3   | przed             | Wygenerowanie `BILLING_CRON_SECRET`; wpis w aplikacji i w GitHub                                        | 3.1    |
| 4   | wdrożenie         | Migracje (wszystkie siedem) - **PRZED kodem**, tego samego dnia, poza 04:25 UTC                         | 1      |
| 5   | wdrożenie         | Stripe: włączenie `checkout.session.expired`, `charge.dispute.closed`, `refund.failed` (sandbox i live) | 2      |
| 6   | wdrożenie         | Kod aplikacji                                                                                           | -      |
| 7   | zaraz po          | Token sondy, klucz publikowalny w GitHub, usunięcie `PROBE_SUPABASE_SERVICE_ROLE_KEY`                   | 3.3    |
| 8   | zaraz po          | Synchronizacja katalogu (sandbox i live) i kontrola `price_mismatch`                                    | 5      |
| 9   | w ciągu doby      | Przegląd starych kodów promocyjnych w Stripe                                                            | 4.3    |
| 10  | w ciągu doby      | Przegląd subskrypcji zawieszonych przez spór przed wdrożeniem                                           | 6.2    |
| 11  | po pierwszej nocy | Weryfikacja: nocna sonda, dobowy cykl rozliczeń, zamiatarka                                             | 8      |

## 1. Migracje - kolejność i powód

Wszystkie migracje tego PR idą **PRZED kodem**. Stary kod na nowej bazie działa
(nowe kolumny mają wartości domyślne, nowe funkcje nikt jeszcze nie woła), nowy
kod na starej bazie - NIE.

| Kolejność | Migracja                                 | Co robi                                                                                                                            | Dlaczego przed kodem                                                                                                                                                                   |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | `checkout_settings_promo_default_off`    | Domyślna wartość `allow_promotion_codes` = `false` dla NOWYCH wierszy. Istniejących nie przepisuje (patrz 4.1)                     | Bez wymagań kolejności - tylko domyślna wartość kolumny                                                                                                                                |
| 2         | `subscription_event_guard`               | Kolumna `subscriptions.last_event_id` - strażnik kolejności zdarzeń subskrypcji (PAY-02, PAY-10)                                   | **WYMAGANA przed kodem.** Kod zapisuje `last_event_id` przy każdym zdarzeniu subskrypcji - bez kolumny PostgREST odrzuca zapis i każde zdarzenie kończy się `failed` do czasu migracji |
| 3         | `user_subscriptions_external_ref_unique` | Deduplikacja uprawnień (duplikaty dostają `#dup:<id>` i `canceled`) + UNIQUE na `external_ref`                                     | **WYMAGANA przed kodem.** Nowy kod czyta uprawnienie po kluczu przez `maybeSingle()`; klucz z dwoma wierszami daje błąd i zdarzenia takiej subskrypcji padają                          |
| 4         | `payment_orders_per_seat_plan_amount`    | Strażnik kwoty zamówienia dopuszcza plan za miejsce (do 100 miejsc)                                                                | Nowa kasa zakłada zamówienia na kilka miejsc - stary strażnik odrzuca je wyjątkiem                                                                                                     |
| 5         | `billing_cron_own_secret`                | Prywatny `job_runner_settings.billing_secret` (losowany) + `invoke_billing_cron()` puka nim, z terminem 60 s                       | Nowy kod przyjmuje w `billing-cron` wyłącznie sekret rozliczeń - bez kolumny dobowy przebieg z `pg_cron` dostaje 401                                                                   |
| 6         | `payment_webhook_sweep_candidates`       | Funkcja kandydatów zamiatarki dziennika płatności (bez ładunków po retencji `_redacted`) + indeks częściowy na otwartych wierszach | Nowa zamiatarka czyta kandydatów WYŁĄCZNIE tą funkcją - bez niej każdy przebieg kończy się `webhook sweep read failed`                                                                 |
| 7         | `billing_probe_status`                   | Tabela skrótu tokenu sondy, `billing_probe_rotate_token()`, `billing_probe_status()`                                               | Nocna sonda czyta naszą stronę wyłącznie tą funkcją                                                                                                                                    |

Uwagi wykonawcze:

- Migracje audytu SUB (PR #495, od `donations_ledger_integrity` do
  `subscription_lifecycle_reconcile`) są już na produkcji. Migracje tego PR
  mają wersje PO nich i nie redefiniują żadnego z ich obiektów - kolejność
  w tabeli wyżej jest kompletna.
- `user_subscriptions_external_ref_unique` trzyma `SHARE ROW EXCLUSIVE` na
  `user_subscriptions` przez jedno przejście tabeli (sekundy): zapisy uprawnień
  czekają, odczyty (`has_content_access`) idą dalej. Uruchamiać poza szczytem.
- `payment_webhook_sweep_candidates` buduje indeks częściowy na
  `payment_webhook_events` (zwykły `CREATE INDEX`, bo migracja biegnie
  w transakcji) - wstawienia do dziennika czekają na koniec budowy.
- `billing_cron_own_secret` zmienia sekret, którym puka `pg_cron`. Stary kod
  porównuje go z sekretem runnera, nowy - z sekretem rozliczeń. Przebieg
  `billing-cron-daily` (04:25 UTC) między migracją a kodem dostaje 401 bez
  skutków ubocznych - wdrażać obie rzeczy tego samego dnia, poza tą godziną.

## 2. Stripe - zdarzenia punktów odbioru webhooków

Integracja obsługuje 17 typów zdarzeń (`src/lib/billing/stripeEventTypes.ts`).
Trzy z nich są NOWE i trzeba je **włączyć ręcznie na OBU punktach odbioru**
(sandbox i live). Kod tego nie robi, a bez nich nic nie świeci na czerwono -
poza panelem diagnostyki i (od tego PR) nocną sondą dla piaskownicy.

| Typ zdarzenia              | Bez niego                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `checkout.session.expired` | Porzucona kasa nie zamyka zamówienia i nie zwalnia rezerwacji kuponu (limit użyć się wyczerpuje) |
| `charge.dispute.closed`    | Spór wygrany nie przywraca dostępu, przegrany go nie domyka                                      |
| `refund.failed`            | Zwrot, który nie doszedł, nie wraca do przeglądu - zamówienie zostaje „zwrócone"                 |

Kroki: Stripe Dashboard -> Developers -> Webhooks -> punkt odbioru
`https://<domena>/api/public/payments/webhook?env=sandbox` (w trybie testowym)
i `...?env=live` (w trybie live) -> „Listen to events" -> dopisać trzy typy.
Sprawdzenie: panel `/admin/billing` -> diagnostyka -> „webhook_events" bez braków
dla obu środowisk. Nocna sonda (sekcja „punkt odbioru webhooków") jest czerwona,
dopóki punkt piaskownicy nie ma kompletu.

## 3. Sekrety i poświadczenia

### 3.1 `BILLING_CRON_SECRET` - aplikacja i GitHub

Endpoint `/api/public/billing-cron` (dobowe przypomnienia o odnowieniu,
karencja miejsc zespołowych, dobowa zamiatarka płatności) przyjmuje WYŁĄCZNIE:

- `BILLING_CRON_SECRET` ze środowiska aplikacji (scheduler repo, ręczne wywołanie),
- `job_runner_settings.billing_secret` (puka nim `pg_cron`, patrz 3.2).

NIE przyjmuje sekretu społeczności (`COMMUNITY_CRON_SECRET`) ani sekretu runnera
(`job_runner_settings.secret`). Wartość `BILLING_CRON_SECRET` równą
`COMMUNITY_CRON_SECRET` odrzuca jako błąd konfiguracji (401 + wpis w logu
`[billing-cron] BILLING_CRON_SECRET jest równy COMMUNITY_CRON_SECRET`).

1. Wygenerować NOWĄ wartość: `openssl rand -hex 32`.
2. Wpisać ją jako `BILLING_CRON_SECRET` w środowisku aplikacji (sekrety
   wdrożenia) **i** jako `secrets.BILLING_CRON_SECRET` w GitHub (Settings ->
   Secrets and variables -> Actions). Obie wartości muszą być równe.
3. Nigdy nie wpisywać tu sekretu społeczności ani sekretu runnera.

Wariant bez zmiennej w aplikacji: `secrets.BILLING_CRON_SECRET` = wartość
`SELECT billing_secret FROM public.job_runner_settings WHERE id = 1;` - endpoint
przyjmuje ją z bazy. Wtedy rotacja sekretu rozliczeń (3.2) wymaga też podmiany
w GitHub.

Krok „Tick rozliczeń" w `scheduler.yml` czeka teraz na odpowiedź do 60 s
(`SCHEDULER_TIMEOUT_MS`) - tyle samo, co `pg_net` w `invoke_billing_cron()`.

### 3.2 Sekret rozliczeń `pg_cron` (`job_runner_settings.billing_secret`)

Nic do zrobienia przy wdrożeniu: migracja `billing_cron_own_secret` losuje go
sama (64 znaki hex, CHECK: różny od sekretu runnera, odczyt wyłącznie
`service_role`). Rotacja (np. po podejrzeniu wycieku):

```sql
UPDATE public.job_runner_settings
   SET billing_secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 WHERE id = 1;
```

Aplikacja czyta go z bazy przy każdym wywołaniu - nic więcej nie trzeba
przepisywać (chyba że użyto wariantu z 3.1 bez zmiennej w aplikacji).

### 3.3 Nocna sonda rozliczeń - poświadczenie najmniejszego uprawnienia

Sonda (`billing-nightly.yml`) czytała dziennik webhooków i `subscriptions`
kluczem `service_role` PRODUKCJI. Ten klucz omija RLS w całej bazie, a sekret
repozytorium może odczytać każdy workflow wypchnięty na gałąź. Teraz sonda
woła wyłącznie RPC `billing_probe_status` kluczem PUBLIKOWALNYM i własnym
tokenem; funkcja zwraca tylko pola sondy z piaskownicy jednej subskrypcji.

1. W SQL editorze Supabase (rola właściciela):
   ```sql
   SELECT public.billing_probe_rotate_token();
   ```
   Wynik (64 znaki hex) to token - pokazuje się JEDEN raz, w bazie zostaje
   wyłącznie jego skrót SHA-256.
2. GitHub -> Settings -> Secrets and variables -> Actions:
   - `BILLING_PROBE_TOKEN` = token z kroku 1,
   - `PROBE_SUPABASE_PUBLISHABLE_KEY` = klucz publikowalny (anon) projektu
     produkcyjnego - ten sam, który dostaje przeglądarka,
   - `PROBE_SUPABASE_URL` - bez zmian,
   - **usunąć `PROBE_SUPABASE_SERVICE_ROLE_KEY`**.
3. Zmienna `vars.APP_BASE_URL` (już istnieje dla schedulera) zawęża kontrolę
   punktów odbioru webhooków do tego wdrożenia.
4. Klucz `service_role` produkcji leżał w sekretach repozytorium. Jeśli nie da
   się wykluczyć, że ktoś go odczytał (każdy z prawem zapisu do repo mógł),
   zaplanować jego rotację według `docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md`, §4.3
   poz. 15 (najpierw `SESSION_SECRET`, poz. 12).

Rotacja tokenu sondy: ten sam krok 1 (stary token natychmiast przestaje
działać) i podmiana `BILLING_PROBE_TOKEN`.

### 3.4 Który sekret co otwiera

| Sekret                                     | Otwiera                                     | Nie otwiera    |
| ------------------------------------------ | ------------------------------------------- | -------------- |
| `job_runner_settings.secret` (runner)      | `jobs-tick`, `community-cron`               | `billing-cron` |
| `COMMUNITY_CRON_SECRET`                    | `community-cron`                            | `billing-cron` |
| `BILLING_CRON_SECRET`                      | `billing-cron`                              | resztę         |
| `job_runner_settings.billing_secret`       | `billing-cron`                              | resztę         |
| `BILLING_PROBE_TOKEN` + klucz publikowalny | `billing_probe_status` (odczyt piaskownicy) | resztę         |

## 4. Kody promocyjne Stripe

### 4.1 Pole kodu w kasie - domyślnie wyłączone (PAY-06)

Nowe wiersze `checkout_settings` mają `allow_promotion_codes = false`.
Istniejących migracja NIE przepisuje: panel zapisywał wszystkie przełączniki ze
stanu formularza, którego domyślna wartość była `true`, więc tabela nie odróżnia
najemcy, który pole włączył celowo, od takiego, który zapisał panel dla faktur.

```sql
SELECT tenant_id, updated_at, updated_by
  FROM public.checkout_settings
 WHERE allow_promotion_codes;
```

Dla każdego wiersza potwierdzić z adminem najemcy, czy pole kodu w kasie Stripe
ma być włączone. Jeśli nie - wyłączyć w `/admin/paywall` (ustawienia kasy).

### 4.2 Wstrzymanie realizacji przy cudzym kodzie (S8)

Konto Stripe jest wspólne dla najemców, więc kod zsynchronizowany przez
najemcę A działa w kasie najemcy B. Realizacja sprawdza teraz każdy kod
wpisany w kasie:

- kod innego najemcy (`foreign_promotion_code`) albo spoza zakresu kuponu
  (`promotion_code_out_of_scope`) przy zakupie jednorazowym: zamówienie
  `paid` (pieniądze pobrane), **dostęp wstrzymany**, alert dla adminów
  najemcy z linkiem `/admin/billing?order=<id>&review=<powód>`. Admin decyduje:
  zwrot albo ręczne nadanie dostępu;
- przy subskrypcji: zamówienie oznaczone do przeglądu + alert (dostęp nadaje
  i tak `subscription.*`);
- kod bez najemcy w metadanych (zrobiony ręcznie w panelu Stripe): przechodzi,
  w zamówieniu zostaje ślad `promotion_code_unscoped`, bez alertu.

### 4.3 Przegląd starych zsynchronizowanych kodów

Synchronizacja kuponów sprzed tego wydania tworzyła kody w Stripe BEZ metadanych
(`source`, `tenant_id`, `coupon_id`) i bez zawężenia do produktów planów. Nowa
realizacja traktuje je jak kody operatora (4.2, ostatni punkt): działają w każdej
kasie z włączonym polem kodu, u każdego najemcy i dla każdego planu.

1. Lista kodów z naszej bazy (dla porównania):
   ```sql
   SELECT tenant_id, code, active, plan_ids, event_ids, valid_until
     FROM public.b2b_coupons
    WHERE active
    ORDER BY tenant_id, code;
   ```
2. W Stripe (sandbox i live): Product catalog -> Coupons -> Promotion codes.
   Kod, którego treść jest na liście z kroku 1, a który NIE ma metadanej
   `source = b2b_coupon_sync`, pochodzi ze starej synchronizacji.
3. Dla każdego takiego kodu: dezaktywować go w Stripe (kodu nie da się usunąć).
   Kupon, który ma dalej działać w kasie Stripe, wydać pod NOWĄ treścią kodu
   w panelu kuponów i zsynchronizować ponownie (diagnostyka -> synchronizacja
   kuponów). Synchronizacja pomija treść kodu, która już istnieje u operatora -
   także nieaktywna - więc stara treść nie zostanie odtworzona z metadanymi.

## 5. Katalog i ceny planów (PAY-01)

- Kasa odmawia (`price_mismatch`, log `[payments] plan price mismatch`), gdy
  cena Stripe pod `lookup_key` nie zgadza się z interwałem, liczbą interwałów,
  kwotą albo progami wolumenowymi planu. Po wdrożeniu uruchomić synchronizację
  katalogu (panel diagnostyki) dla sandbox i live i sprawdzić, że żadna kasa
  planu nie loguje `price_mismatch`. Jeśli kilku najemców sprzedaje tę samą parę
  (`tier_key`, `interval`) w różnych cenach na wspólnym koncie Stripe, jeden
  z nich dostanie odmowę, dopóki ceny się nie zrównają.
- Plany, których para (`tier_key`, `interval`) nie istnieje w `BILLING_CATALOG`
  (np. `pro`/`quarter`, `business`/`year`, `member`/`two_weeks`), nie dają się
  już kupić (`plan_price_missing`) - wcześniej obciążano je pierwszą ceną warstwy.
  ```sql
  SELECT id, tenant_id, tier_key, interval FROM public.access_plans WHERE active;
  ```
  Każdy plan bez dokładnej pary w katalogu: wyłączyć, poprawić albo dopisać
  pozycję katalogu.
- Minimalna kwota obciążenia jest liczona per waluta (PLN 2,00, EUR 0,50).
  Odblokowanie treści, bilety i kupony zostawiające mniej niż 2,00 zł do zapłaty
  są odrzucane (`final_amount_too_low` / `amount_too_low`). Kupony 100% na plany
  są odrzucane w obu kasach - darmowy pierwszy okres to `trial_days` planu.

## 6. Spory i zwroty

### 6.1 `refund.failed`

Włączyć na obu punktach odbioru (sekcja 2). Do tego czasu diagnostyka
zgłasza brak, a nieudane zwroty nie wracają automatycznie do przeglądu.

### 6.2 Subskrypcje zawieszone przez otwarty spór PRZED wdrożeniem

Spór otwarty na subskrypcji w bieżącym okresie ustawia teraz uprawnieniu
status `refunded`; przed tym wydaniem ustawiał `canceled`. Wiersze zawieszone
po staremu (klucze `sub_…`) mają starą semantykę: wygrany spór nadal je
przywraca, ale najbliższe `subscription.updated` w tym samym okresie mogło je
już ożywić.

```sql
SELECT us.id, us.user_id, us.tenant_id, us.external_ref, us.canceled_at, us.updated_at
  FROM public.user_subscriptions us
 WHERE us.status = 'canceled'
   AND us.external_ref LIKE 'sub\_%'
 ORDER BY us.updated_at DESC;
```

Porównać z listą sporów w Stripe (Payments -> Disputes, status `needs_response`
/ `under_review`) i dla subskrypcji z otwartym sporem potwierdzić, że dostęp
jest zawieszony. Klucze zamówień planów (`cs_…`, identyfikator zamówienia)
nadal używają zawieszenia `canceled` - ich nie dotyczy.

## 7. Zamiatarka dziennika płatności - co widzi dyżur

Zmiany zachowania (przegląd 3.0-3.4, 6.10), bez kroków do wykonania:

- Kandydatów liczy baza (`payment_webhook_sweep_candidates`): wiersz do wzięcia
  nie czeka już za setką starszych wierszy w odstępie.
- Porzucone `received` mają odstęp wykładniczy jak `failed` (5, 10, 20 ... min) -
  osiem prób mieści się w ~21 h, nie w ~40 min.
- Horyzont 3 dób liczy się od czasu ZDARZENIA (`occurred_at`): odtworzenie
  prawdziwego starego zdarzenia (`evt_…`) z uzgadniania trafia do człowieka, nie
  do automatu. Syntetyczne naprawy (`reconcile_…`, stan operatora z chwili
  naprawy) liczą wiek od utworzenia wiersza - nieudana naprawa zamówienia
  wraca automatycznie.
- Wiersz startuje aż do terminu wołającego: każdy zaczęty wiersz jest od startu
  zarejestrowany „za odpowiedzią", a runtime daje takiej pracy 30 s po zerwaniu
  połączenia - więcej niż budżet wiersza (20 s). W `jobs-tick` (co 5 min)
  termin to najwyżej 8 s od startu zamiatarki i nie dalej niż 23 s od startu
  ticku; w dobowym `billing-cron` - 58 s od przyjęcia żądania. W logu
  przebiegów: `deferred` = odłożone (termin minął przed startem), `timedOut` =
  wiersz przekroczył termin i dokańcza się „za odpowiedzią".
- Ładunek po retencji dziennika (`_redacted`, audyt SUB-11: 30/90 dni albo od
  razu przy zamknięciu konta) NIE jest odtwarzany: funkcja kandydatów pomija
  taki wiersz, zamiatarka po przejęciu domyka go `failed` z przyczyną (wyścig
  z retencją), a ponowienie z panelu odmawia komunikatem „Ładunek zdarzenia
  został zanonimizowany". Takie zdarzenie odtwarza uzgadnianie ze Stripe
  (czyta je od operatora). Ponowna dostawa od Stripe zapisuje świeży ładunek,
  więc znacznik znika razem ze starą treścią.
- Domknięcie wiersza zamiatarki jest warunkowe na pokolenie przejęcia
  (`retry_count`): spóźniony wykonawca nie nadpisze wyniku nowszego. Błąd bazy
  przy domknięciu jest ponawiany na miejscu (~1 s), a potem „za odpowiedzią"
  (2, 5 i 10 s - log `[payments] webhook log finish deferred`). Dopiero gdy
  przepadną i te próby, wiersz wraca do zamiatarki po odstępie, a w logu zostaje
  `[payments] webhook log finish lost <event_id>`.

## 8. Weryfikacja po wdrożeniu

| #   | Sprawdzenie                                                                                                   | Oczekiwany wynik                                      |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | `SELECT length(billing_secret), billing_secret <> secret FROM public.job_runner_settings WHERE id = 1;`       | `64`, `true`                                          |
| 2   | `curl -X POST "$BASE_URL/api/public/billing-cron" -H "x-billing-cron-secret: $COMMUNITY_CRON_SECRET"`         | `401`                                                 |
| 3   | GitHub -> Actions -> „Scheduler" -> Run workflow, zakres `billing`                                            | zielony; w odpowiedzi `webhookSweep` bez `error`      |
| 4   | GitHub -> Actions -> „Rozliczenia (nocna sonda...)" -> Run workflow                                           | zielony; w podsumowaniu „punkt odbioru webhooków" `✓` |
| 5   | `SELECT * FROM public.payment_webhook_sweep_candidates(20, 8, 300000, 300000, 259200000);` (rola właściciela) | wykonuje się bez błędu                                |
| 6   | Panel `/admin/billing` -> diagnostyka -> `webhook_events` (sandbox i live)                                    | brak brakujących typów                                |
| 7   | Następnego dnia: `job_runner_runs` dla `billing-cron` i ticków z minutą podzielną przez 5                     | bez `webhookSweep: webhook sweep read failed`         |

## 9. Dla integratora (nie dla operatora)

- `src/integrations/supabase/types.ts`: dopisać `job_runner_settings.billing_secret`
  (Row: `string`, Insert/Update: `string?`) oraz funkcję
  `payment_webhook_sweep_candidates` (argumenty `p_limit`, `p_max_attempts`:
  `number`; `p_backoff_base_ms`, `p_stuck_after_ms`, `p_horizon_ms`: `number`;
  zwraca tablicę wierszy dziennika: `id`, `event_id`, `event_type`,
  `environment`, `status`: `string`; `occurred_at`, `last_retried_at`,
  `processed_at`: `string | null`; `created_at`: `string`; `retry_count`:
  `number`). Bez tego `check:types-freshness` i `tsgo` są czerwone.
  `billing_probe_*` nie potrzebują typów (woła je wyłącznie skrypt sondy).
- Kontrakt TS <-> SQL generuje CI (`bun run generate:ts-sql-contract`); nowe
  użycia: `job_runner_settings` (`enabled, billing_secret`) i RPC
  `payment_webhook_sweep_candidates` - obie z `service_role`.
- Pokolenie przejęcia: zamiatarka przekazuje `generation` wprost; trasa
  webhooka, naprawa z uzgadniania i ponowienie z panelu dostają pokolenie
  odczytane tuż po przejęciu (`claimedGeneration` w `webhookReplay.server`),
  więc domknięcie jest warunkowe na każdej ścieżce. Przekazanie `generation`
  z `claimWebhookEventWithGeneration` / `reclaimWebhookEventRowWithGeneration`
  oszczędza ten odczyt.
- Uruchomić `tsgo` po scaleniu (kod pisany pod ścisłe typy, bez przebiegu tsgo
  w klastrach): `OneTimeOutcome` ma `held`, `settleSubscriptionCheckoutOrder`
  zwraca `SubscriptionSettleOutcome`, `applyTicketOutcome` ma `throwOnError`,
  `TransactionDocumentInput` ma opcjonalne `orderId`.
- Dowód „pada przed poprawką" dla realizacji i dokumentów: 49 testów
  jednostkowych i 6 z 7 testów przepływu padało na kodzie sprzed poprawki
  (log klastra C w przestrzeni roboczej integracji).
