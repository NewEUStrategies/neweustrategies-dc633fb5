# Monetyzacja (MODUŁ 14): warstwa decyzji o pieniądzach z 27% na 47%, 24 defekty i pierwsze progi (2026-08-23)

## 1. Zmierzone liczby — i jasne „cel nieosiągnięty"

Pomiar własny: `bun run test:coverage` na pełnym `src/` z `all: true`
(2026-08-23 03:28, HEAD `f2e0a74`). Suita: **1556 plików testowych zielonych,
1 czerwony**, 41 494 testy zdane, 175 `expected fail`, 50 pominiętych.
Ten jeden czerwony plik (`authzSnapshotParity`) jest **czerwony na tej gałęzi od
jej utworzenia** — patrz §7.

### Moduł 14 jako całość (44 pliki mapowo)

| miara          | audyt (wyd. 5) |          po tej pracy |         delta |
| -------------- | -------------: | --------------------: | ------------: |
| linie          |         27,10% | **47,34%** (659/1392) | **+20,24 pp** |
| gałęzie        |         30,28% | **44,96%** (674/1499) | **+14,68 pp** |
| funkcje        |         17,90% |  **35,43%** (163/460) | **+17,53 pp** |
| instrukcje     |         27,00% |            **47,55%** | **+20,55 pp** |
| plików na 0%   |             13 |                **10** |            −3 |
| plików na 100% |             10 |                **22** |           +12 |

**CEL Z SEKCJI 6 ZLECENIA (≥95% linii / ≥93% gałęzi / ≥90% funkcji) NIE ZOSTAŁ
OSIĄGNIĘTY.** Zmierzone: 47,34% / 44,96% / 35,43%. Nie zaokrąglam w górę i nie
nazywam tego sukcesem. Pokrycie modułu prawie się podwoiło, ale to nie jest to,
o co poprosiłeś.

Powód jest jeden i był policzony w zleceniu: **dziewięć tras panelu to 58,8%
niepokrytych linii i 67,3% niepokrytych funkcji modułu.** Etap 2 (ekstrakcja
i testy tych tras) był w toku, gdy konto uderzyło w limit sesji — cztery agenty
implementacyjne padły w trakcie pracy, a trzy z dziewięciu powierzchni
rozpoznania nie powstały wcale. Szczegóły w §8.

### Etap 1 (warstwy decyzji) — cel osiągnięty na ośmiu z dziewięciu plików

Cel etapu: 95% linii / 93% gałęzi / 95% funkcji.

| plik                                  |  linie |    gałęzie | funkcje | testy |    cel    |
| ------------------------------------- | -----: | ---------: | ------: | ----: | :-------: |
| `lib/ads/readingMode.ts`              |   100% |       100% |    100% |    28 |     ✔     |
| `lib/ads/queries.ts`                  |   100% |       100% |    100% |    30 |     ✔     |
| `lib/billing/couponEffects.server.ts` |   100% |       100% |    100% |    31 |     ✔     |
| `hooks/useValidateCoupon.ts`          |   100% |       100% |    100% |    26 |     ✔     |
| `components/checkout/CouponInput.tsx` |   100% |       100% |    100% |    23 |     ✔     |
| `routes/api/public/ad-event.ts`       |   100% |       100% |    100% |    43 |     ✔     |
| `lib/gifting-admin.functions.ts`      |   100% |     96,87% |    100% |    96 |     ✔     |
| `lib/gifting/hooks.ts`                |   100% |     93,25% |    100% |    57 |     ✔     |
| `lib/ads/consent.ts`                  | 96,89% | **87,90%** |  96,22% |    99 | ✖ gałęzie |

Razem **433 testy** w dziesięciu nowych plikach testowych.

`consent.ts` mija próg gałęzi z **policzonego, a nie domyślanego** powodu:
wszystkie 15 pozostałych niepokrytych gałęzi to **strażnicy SSR** —
`typeof window === "undefined"` ×11, `typeof document === "undefined"` ×3
i `typeof location !== "undefined"` ×1 (gałąź atrybutu `Secure` cookie na
https). Pod `happy-dom` `window` i `document` istnieją zawsze, więc te gałęzie
są **strukturalnie nieosiągalne**: 87,9% jest sufitem tego pliku w tym
środowisku, nie luką w testach. Podniesienie wymagałoby albo usunięcia
strażników (zmiana zachowania na SSR), albo drugiego środowiska testowego bez
`window` — jedno i drugie jest osobną pracą. Próg per-ścieżka stoi na 86, nie
na 93, bo próg powyżej rzeczywistości to próg wyłączony.

### Etap 4 (pgTAP) — cel osiągnięty

Trzy nowe pliki, **66 asercji**, wszystkie zielone. Uruchomione lokalnie na
pełnym schemacie (796 migracji + `seed.sql`) przez `scripts/pgtap-local/run.sh`.
Cała suita pgTAP: **95 plików OK, 6 z błędem — wszystkie sześć pre-existing**
(czat ×2, `community_cron_schedule`, `job_scheduler_heartbeat`, plus dwa, które
w lokalnym runnerze przerywają na atrapie `pgvector` i na triggerach
`storage.objects`). Moje pliki są samowystarczalne (`BEGIN`/`ROLLBACK`), więc
nie mogą wpływać na pozostałe.

### Etapy 2, 3 i część 5 — nierozpoczęte albo częściowe

Stan jawnie: **etap 2 (dziewięć tras, 3 573 linie fizyczne) i etap 3
(prezentacja reklam i darowizn) nie zostały wykonane.** Z etapu 5 zrobiona jest
sekcja 5.1 (literały) i rozszerzenie bramki autorytetu; bramki 5.3 i 5.4
(ładowanie słowników, kompletność kluczy etykiet) — nie.

---

## 2. Powierzchnie: plik → pokrycie po tej pracy

Pełna lista, na której podstawie da się poprawić mapę funkcjonalności w audycie.
Kolumna „moduł" pokazuje, gdzie plik leży MAPOWO — sześć plików funkcjonalności
monetyzacji liczy się dziś do modułów 07/13/15.

| plik                                                    |  moduł   |  linie | gałęzie | funkcje |
| ------------------------------------------------------- | :------: | -----: | ------: | ------: |
| `components/ads/atoms/AdContainer.tsx`                  |    14    |   100% |    100% |    100% |
| `components/checkout/CouponInput.tsx`                   | 07/13/15 |   100% |    100% |    100% |
| `components/donations/DonationCta.tsx`                  |    14    |   100% |  76.92% |    100% |
| `components/gifting/GiftBanner.tsx`                     |    14    |   100% |    100% |    100% |
| `components/gifting/atoms/GiftChannelLink.tsx`          |    14    |   100% |    100% |    100% |
| `components/gifting/atoms/GiftCopyButton.tsx`           |    14    |   100% |  57.14% |    100% |
| `components/gifting/molecules/GiftShareChannels.tsx`    |    14    |   100% |     50% |    100% |
| `lib/ads/consent.ts`                                    |    14    |   100% |   88.7% |    100% |
| `lib/ads/dimensions.ts`                                 |    14    |   100% |    100% |    100% |
| `lib/ads/idle.ts`                                       |    14    |   100% |     80% |     80% |
| `lib/ads/pageType.ts`                                   |    14    |   100% |    100% |    100% |
| `lib/ads/queries.ts`                                    |    14    |   100% |    100% |    100% |
| `lib/ads/readingMode.ts`                                |    14    |   100% |    100% |    100% |
| `lib/billing/couponEffects.server.ts`                   | 07/13/15 |   100% |    100% |    100% |
| `lib/billing/couponMoney.ts`                            | 07/13/15 |   100% |    100% |    100% |
| `lib/gifting-admin.functions.ts`                        |    14    |   100% |  96.87% |    100% |
| `lib/gifting/admin-model.ts`                            |    14    |   100% |    100% |    100% |
| `lib/gifting/hooks.ts`                                  |    14    |   100% |  93.25% |    100% |
| `lib/i18n-admin-coupons.ts`                             |    14    |   100% |    100% |      0% |
| `lib/i18n-ads-admin.ts`                                 |    14    |   100% |    100% |      0% |
| `lib/i18n-donate.ts`                                    |    14    |   100% |    100% |      0% |
| `lib/i18n-donations-admin.ts`                           |    14    |   100% |    100% |      0% |
| `lib/i18n-donations-widget.ts`                          |    14    |   100% |    100% |    100% |
| `lib/i18n-gifting-admin.ts`                             |    14    |   100% |    100% |      0% |
| `lib/i18n-gifting.ts`                                   |    14    |   100% |    100% |    100% |
| `lib/retention/coupon.ts`                               | 07/13/15 |   100% |    100% |    100% |
| `routes/api/public/ad-event.ts`                         | 07/13/15 |   100% |    100% |    100% |
| `lib/gifting/model.ts`                                  |    14    | 97.87% |  94.23% |    100% |
| `lib/ads/types.ts`                                      |    14    | 94.73% |  81.08% |  88.88% |
| `lib/ads/useDeferredAd.ts`                              |    14    |  91.3% |  88.23% |    100% |
| `components/donations/DonationForm.tsx`                 |    14    | 88.88% |  86.53% |  66.66% |
| `components/gifting/molecules/GiftClickBudgetMeter.tsx` |    14    | 83.33% |     50% |    100% |
| `components/donations/DonationsWidgetView.tsx`          |    14    | 79.16% |  65.62% |     75% |
| `components/gifting/GiftArticleButton.tsx`              |    14    | 74.35% |  86.58% |     50% |
| `components/ads/atoms/SandboxedAdFrame.tsx`             |    14    | 71.42% |      0% |     80% |
| `lib/billing/coupons.ts`                                | 07/13/15 |  62.5% |     60% |    100% |
| `components/admin/coupons/DatePickerField.tsx`          |    14    | 43.47% |     50% |  42.85% |
| `components/ads/AdSlotById.tsx`                         |    14    | 33.33% |     30% |     50% |
| `components/ads/MidPostAds.tsx`                         |    14    |  6.06% |      0% |      0% |
| `components/ads/FooterSlideup.tsx`                      |    14    |  2.56% |      0% |      0% |
| `components/ads/useInFeedAds.tsx`                       |    14    |     0% |      0% |      0% |
| `routes/admin.ads.tsx`                                  |    14    |     0% |      0% |      0% |
| `routes/admin.coupons.analytics.tsx`                    |    14    |     0% |      0% |      0% |
| `routes/admin.coupons.campaigns.tsx`                    |    14    |     0% |      0% |      0% |
| `routes/admin.coupons.index.tsx`                        |    14    |     0% |      0% |      0% |
| `routes/admin.coupons.redemptions.tsx`                  |    14    |     0% |      0% |      0% |
| `routes/admin.coupons.tsx`                              |    14    |     0% |      0% |      0% |
| `routes/admin.donations.tsx`                            |    14    |     0% |      0% |      0% |
| `routes/admin.gifting.tsx`                              |    14    |     0% |      0% |      0% |
| `routes/donate.tsx`                                     |    14    |     0% |      0% |      0% |

### Dziewięć tras bez wiersza funkcjonalności

Zlecenie ma rację: te trasy należą do modułu 14 i do żadnej funkcjonalności.
Audyt powinien dostać piąty wiersz „Panele monetyzacji (admin)". Po tej pracy
nadal stoją na 0%:

`admin.ads.tsx`, `admin.coupons.tsx`, `admin.coupons.index.tsx`,
`admin.coupons.campaigns.tsx`, `admin.coupons.redemptions.tsx`,
`admin.coupons.analytics.tsx`, `admin.gifting.tsx`, `admin.donations.tsx`,
`donate.tsx` — plus `components/ads/useInFeedAds.tsx` z etapu 3.

### Pliki utworzone

**Testy (10):**
`src/lib/ads/__tests__/readingMode.test.tsx`,
`src/lib/ads/__tests__/queries.test.tsx`,
`src/lib/ads/__tests__/consentWritePath.test.ts`,
`src/lib/ads/__tests__/consentProfileSync.test.ts`,
`src/lib/gifting/__tests__/hooks.test.tsx`,
`src/lib/__tests__/giftingAdminFunctions.test.ts`,
`src/lib/billing/__tests__/couponEffects.server.test.ts`,
`src/hooks/__tests__/useValidateCoupon.test.tsx`,
`src/components/checkout/__tests__/CouponInput.test.tsx`,
`src/routes/api/public/-ad-event.test.ts`.

**pgTAP (3):** `supabase/tests/ad_events_tenant_scope_test.sql`,
`b2b_coupons_money_test.sql`, `donations_ledger_scope_test.sql`.

**Produkcja (2, każdy osobnym commitem):** `src/lib/i18n-donations-admin.ts`
(nowy słownik) i przepisanie `src/routes/admin.donations.tsx` na klucze.

**Zmienione:** `vitest.config.ts` (9 progów per-ścieżka),
`src/routes/__tests__/adminRouteAuthority.gate.test.ts` (sekcja modułu 14).

---

## 3. Defekty pogrupowane w klasy

24 pozycje. Każda z nich ma `it.fails` z opisem oczekiwanego zachowania ORAZ
sąsiedni zwykły `it()` opisujący stan faktyczny — po naprawie usuwa się je
razem. Zero `it.skip`, zero `it.todo`. **Żadnej z tych rzeczy nie naprawiłem.**

### KLASA A: „awaria odczytu udaje odpowiedź" — 4 wystąpienia

Najgroźniejsza klasa w tym module, bo w każdym przypadku system podaje
użytkownikowi **konkretną, fałszywą informację** zamiast przyznać się do awarii.

| #   | plik                                  | co się dzieje                                                                                                                                                                           | skutek                                                                                                                                                                                                             |  `it.fails`  |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------: |
| A1  | `lib/ads/readingMode.ts:78`           | `paying = tierQ.isPending ? true : (rank ?? 0) > 0` rozgałęzia się WYŁĄCZNIE na `isPending`. Stan błędu to `isPending === false` + `data === undefined`, więc `paying` wychodzi `false` | awaria odczytu planu daje budżet `max_ad_zones_free` zamiast `max_ad_zones_paid` — **płacący czytelnik dostaje WIĘCEJ reklam**, dokładnie przeciwnie do intencji zapisanej w komentarzu nad funkcją                |      ✔       |
| A2  | `lib/billing/couponEffects.server.ts` | dryf nazwy pola w odpowiedzi RPC → `parseOutcome` daje `{applied:false}` bez `reason`                                                                                                   | klient **zapłacił** za plan z kuponu, planu nie dostał, i **nie ma żadnego sygnału** — patrz §5 (to ustalenie jest gorsze, niż zakładało zlecenie)                                                                 |      ✔       |
| A3  | `hooks/useValidateCoupon.ts`          | pusty zbiór wierszy z RPC → `[0] ?? null` → `setResult(null)`, stan nieodróżnialny od „jeszcze nie walidowano"                                                                          | klient wpisuje kod i **nie dostaje ani rabatu, ani komunikatu**; co gorsza, pusty zbiór ZERUJE poprzedni poprawny werdykt                                                                                          |      ✔       |
| A4  | `lib/ads/queries.ts`                  | błąd odczytu jest głośny (`throw` → `isError`), a odfiltrowanie w `select` — ciche (`isSuccess` + pusta lista)                                                                          | regres w `parseAdTargeting` albo redakcyjna literówka w `targeting` gasi WSZYSTKIE reklamy nieodróżnialnie od „nie ma kreacji". Różnica ISTNIEJE w cache (surowa odpowiedź ma wiersze), więc alarm da się zbudować | dokumentacja |

### KLASA B: „spalony zasób podany jako wina użytkownika" — 1 wystąpienie, najważniejsze

| #   | plik                           | co się dzieje                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | `lib/gifting/hooks.ts:322-324` | RPC `redeem_gift_link` po stronie bazy **już skonsumowało slot budżetu**, gdy odpowiada. Gdy treść przyjdzie nierenderowalna PRZY `row.valid === true`, kod nadpisuje werdykt na `{ body: EMPTY_BODY, valid: false, reason: "invalid" }` — czyli **dokładnie ten sam werdykt, co przy nieprawidłowym kodzie z serwera**. |

Skutek: odbiorca widzi „ten link jest nieprawidłowy" i paywall; slot z budżetu
(domyślnie 1 z 5) jest zużyty; miesięczny limit nadawcy o jeden niższy;
w `gift_events` leży udana realizacja — a interfejs mówi odbiorcy, że to **on**
ma zły link. Osobny test dowodzi, że para `(valid, reason)`, na której stoi cały
wybór banera, jest w obu przypadkach **identyczna**. Jedyna różnica żyje w
`body` (`null` kontra `EMPTY_BODY`) i nikt jej nie czyta jako sygnału.

### KLASA C: RODO — zgoda, która wraca albo nie zostawia śladu — 5 wystąpień

| #   | plik                                               | co się dzieje                                                                                                                                                                          | skutek                                                                                                                                                                                                                                                                                | `it.fails` |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------: |
| C1  | `lib/ads/consent.ts` (`clearConsent`)              | wyczyszczenie zgód nie propaguje wycofania ani do profilu, ani do rejestru RODO                                                                                                        | zalogowany klika „wyczyść zgody", a najbliższe zdarzenie auth **WSKRZESZA zgodę z profilu w pełnym zakresie, w tym marketing**. Wycofanie nie zostawia śladu w audycie (art. 7 ust. 3)                                                                                                |     ✔      |
| C2  | `lib/ads/consent.ts` (`syncConsentToProfile`)      | błąd RPC `get_own_profile` jest IGNOROWANY, więc `prevPrefs` schodzi do `{}` i `update` nadpisuje **CAŁĄ** kolumnę `prefs` samym kluczem `consent`                                     | zapis zgody **kasuje wszystkie pozostałe preferencje** użytkownika (motyw, powiadomienia, cokolwiek trzyma `prefs`)                                                                                                                                                                   |     ✔      |
| C3  | `lib/ads/consent.ts` (`hydrateConsentFromProfile`) | gdy zdalna zgoda ISTNIEJE, ale jest STARSZA od lokalnej, nowsza decyzja lokalna nigdy nie leci do profilu (warunek wymaga BRAKU zdalnej)                                               | na drugim urządzeniu wraca STARA zgoda — **wycofanie zgody „odżywa"**                                                                                                                                                                                                                 |     ✔      |
| C4  | `lib/ads/consent.ts` (`readLocal`)                 | brak `try/catch`, w przeciwieństwie do `writeLocal` i `clearConsent`                                                                                                                   | w przeglądarce blokującej `localStorage` rzut leci przez `hasCategoryConsent` do silnika analityki i przez inicjalizator `useConsent` do error boundary; fallback cookie, który mógłby uratować decyzję, **nigdy nie jest osiągany**                                                  |     ✔      |
| C5  | `lib/cookieBanner/registry.ts`                     | glob `consent*`/`gpc*` jest ZAKOTWICZONY (`^…$`), więc realne nośniki `nes_cookie_consent` i `nes_gpc` **nie pasują** i lądują w heurystyce jako `functional` „preferencja interfejsu" | w deklaracji cookies pokazywanej użytkownikowi **dowód zgody RODO i nośnik prawnego opt-outu GPC są opisane jako kategoria, którą można odrzucić**, choć oba są ściśle niezbędne. `routes/cookies.tsx` opisuje to samo cookie poprawnie — dwie sprzeczne deklaracje tego samego pliku |     ✔      |

### KLASA D: panel oferuje akcję, którą baza odrzuci — 1 wystąpienie

| #   | plik                         | co się dzieje                                                                                                                                         |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `routes/admin.donations.tsx` | `donations` ma w RLS wyłącznie rolę `admin` (nie `editor`), a layout `/admin` przepuszcza też `editor` i `author`. Trasa nie domyka uprawnienia sama. |

Redaktor widzi **dwie nieprawdy naraz**: tabelę „Ostatnie wpłaty" jako PUSTĄ
(czyta się jako „nikt nie wpłacił", znaczy „nie masz prawa tego widzieć") —
a **obok niej** kafelki „Suma wpłat" z kwotą, bo te liczą się z publicznych
statystyk przez service role. Sprzeczność w jednym widoku. Do tego przycisk
„Synchronizuj ze Stripe", który wywoła `syncDonationsWithStripe` → `assertAdmin`
→ `forbidden`. To ta sama klasa defektu, którą bramka autorytetu złapała przy
swoim wdrożeniu na `admin.users.$id` (droplista roli dla całego personelu)
i na `admin.settings.seo`. Zakodowane jako `it.fails` w bramce.

### KLASA E: podwójna wysyłka i inne — 3 wystąpienia

| #   | plik                                         | co się dzieje                                                                                                                                                                                                                                                                                                                           | `it.fails` |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------: |
| E1  | `components/checkout/CouponInput.tsx:98-103` | handler Entera nie sprawdza ani `loading`, ani `code.trim()`, choć przycisk obok ma `disabled={loading \|\| !code.trim()}`. Trzymany Enter wysyła N równoległych walidacji; hook trzyma `loading` jako pojedynczy boolean bez licznika i bez przerywania poprzedniego żądania, więc o wyniku decyduje kolejność ODPOWIEDZI, nie wysyłki |     ✔      |
| E2  | `lib/ads/consent.ts` (podglądy)              | `setConsentPreview` / `clearConsentPreview` bez `try/catch` na `sessionStorage`                                                                                                                                                                                                                                                         |     ✔      |
| E3  | `lib/gifting/hooks.ts` (`onSuccess`)         | gałąź `: (prev ?? null)` — updater zwracający `null` **nie jest** w react-query no-opem: tworzy wpis w cache o `data === null` i statusie `success`. Dziś bez skutku (jedyny konsument najpierw czyta stan); każdy nowy wywołujący `create` dostanie „stan wczytany i pusty"                                                            |     ✔      |

---

## 4. Do zgłoszenia człowiekowi (decyzja produktowa albo migracja)

1. **Kupon nadający warstwę nie działa dla subskrypcji kupowanych przez realne
   Stripe.** To najpoważniejsze ustalenie całej pracy i jest **poza wszystkimi
   hipotezami zlecenia**. Zamówienie planu wstaje jako `status='pending'`
   (`stripeCheckout.functions.ts:79-92`), a `paid_at` zapisują wyłącznie
   finalizacja trybu MOCK (`checkout.functions.ts:511`) i płatność JEDNORAZOWA
   (`oneTimeFulfilment.server.ts:169-174`). `apply_b2b_coupon_effects` jest
   fail-closed na `status='paid'`, więc na głównej ścieżce zakupowej **nigdy nie
   odpala**. Obietnica z panelu („Plan") nie ma wykonawcy.
2. **Rejestr realizacji kuponów zapisuje ZEROWY rabat.**
   `stripeCheckout.functions.ts:96-101` woła `redeem_b2b_coupon`
   z `_applied_cents: 0` i `_original_cents: plan.price_cents`, mimo że dwie
   linie wyżej czyta `row.discount_cents > 0` i tworzy dla tej kwoty kupon
   w Stripe. Raport przychodu z kuponów zaniża rabat do zera.
3. **A1** — awaria odczytu planu podnosi budżet reklam płacącemu. Poprawka to
   jedno słowo (`isPending` → `isPending || isError`), ale zmienia zachowanie
   produkcyjne, więc nie wchodzi w to zlecenie.
4. **A2** — `applied: false` nie ma w produkcji ŻADNEGO konsumenta: obaj
   wywołujący robią `await applyCouponEffectsForOrder(order.id)` bez
   przypisania. Wymaga decyzji: czy niezrealizowana obietnica zakupowa ma
   trafiać do audytu albo tabeli, a nie do `console`.
5. **C1 + C5** — dwie pozycje RODO: wycofanie zgody bez śladu w rejestrze
   i sprzeczna deklaracja własnych cookies zgody.
6. **`formatDiscountLabel` bez osłony.** `lib/billing/coupons.ts:66-71` woła
   `Intl.NumberFormat` BEZ `try/catch`, w przeciwieństwie do `formatMoney`
   (`types.ts:129-137`), które ma degradację. Waluta o niepoprawnej długości
   (`"PL"`, `"PLNN"` — a `currency` w `b2b_coupons` **nie ma CHECK-a**) rzuca
   `RangeError` przy renderze etykiety rabatu.
7. **Brak CHECK-a na `currency` w `b2b_coupons`.** Jedyna realna luka
   w ograniczeniach kwotowych kuponu: kupon `fixed` z `currency IS NULL`
   i kupon `percent` z walutą `'XYZ'` przechodzą przez bazę. Spójność trzyma
   wyłącznie panel. Udokumentowane dwiema asercjami stanu faktycznego
   w `b2b_coupons_money_test.sql`; domknięcie wymaga migracji, której zgodnie
   z regułą 9 zlecenia nie dodaję.
8. **Panel darowizn na produkcji startuje w środowisku LIVE.**
   `getStripeEnvironmentSafe()` zwraca `"live"`, gdy KLIENCKI token
   publikowalny zaczyna się od `pk_live_`. Droplista środowiska startuje więc na
   „Środowisko produkcyjne", a przycisk obok uruchamia synchronizację na żywym
   Stripe'ie **bez potwierdzenia**.
9. **`coupon.error.emptyCode` jest kluczem martwym.** Jedynym producentem powodu
   `empty_code` jest `useValidateCoupon`, a jedyny konsument hooka wychodzi
   wcześniej przez `if (!norm) return` (`CouponInput.tsx:34-35`). Klucz istnieje
   i jest przetłumaczony w obu językach; użytkownik nigdy go nie zobaczy.
   Do tego `result` i `reset` — połowa publicznej powierzchni hooka — nie mają
   w produkcji żadnego konsumenta.
10. **Trzy panele kuponów omijają słownik.** `admin.coupons.tsx`,
    `admin.coupons.redemptions.tsx` i `admin.coupons.analytics.tsx` są
    dwujęzyczne przez lokalny helper `const L = (pl, en) => …`. Po angielsku
    **nie** pokazują polszczyzny, więc to nie jest „panel po polsku" — ale ich
    napisy nie przechodzą przez `i18nParity.gate` ani `i18nKeyDrift.gate` (te
    czytają wyłącznie `src/lib/i18n-*.ts`), nie widzi ich tłumacz i trzecia
    wersja językowa wymagałaby przepisania plików. `redemptions.tsx` używa OBU
    mechanizmów naraz. Zapisane jako test-dług w bramce autorytetu.
11. **Migracja bez regeneracji snapshotu autoryzacji.**
    `src/lib/authz/__tests__/authzSnapshotParity.test.ts` jest czerwony na tej
    gałęzi **od jej utworzenia** (commit `4825d02`, migracja
    `20260822171037_bea8e790…` weszła bez `generate:authz-snapshot`). Drift jest
    wyłącznie provenance („wystarczy regeneracja snapshotu"). Zgodnie z regułą 7
    zlecenia snapshotu **nie regeneruję** — zgłaszam.
12. **`vitest.config.ts` ma zduplikowany klucz progu.**
    `"src/components/auth/MfaChallenge.tsx"` występuje dwa razy (linie 1300
    i 1442), co esbuild raportuje ostrzeżeniem przy KAŻDYM uruchomieniu testów;
    drugi wpis cicho wygrywa. Plik modułu 19, więc nie ruszam.
13. **`src/components/pricing/molecules/**` nie dobija progu gałęzi**
    (zmierzone 92,3% vs próg 94%). Nie dotykałem tej powierzchni, a dodanie
    testów nie może obniżyć pokrycia — to dryf pre-existing.

---

## 5. Założenia tego zlecenia, które okazały się NIEPRAWDZIWE

Ta sekcja jest równie ważna jak lista defektów. Siedem pozycji.

### 5.1. „Baza nie ma CHECK-ów na kwocie kuponu" — NIEPRAWDA

Zlecenie polecało udokumentować BRAK i wpisać do raportu „walidacja kwoty
istnieje wyłącznie w panelu". Migracja
`20260721070203_a0e336e0-eaf3-4342-9435-40e076ebf0dd.sql` egzekwuje
**wszystkie cztery** warunki, o które pytało zlecenie:

```sql
discount_kind    text NOT NULL CHECK (discount_kind IN ('percent','fixed')),
discount_percent integer CHECK (discount_percent IS NULL OR (discount_percent BETWEEN 1 AND 100)),
discount_cents   integer CHECK (discount_cents IS NULL OR discount_cents > 0),
max_redemptions  integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
CONSTRAINT b2b_coupons_discount_shape CHECK (
  (discount_kind = 'percent' AND discount_percent IS NOT NULL AND discount_cents IS NULL)
  OR (discount_kind = 'fixed' AND discount_cents IS NOT NULL AND discount_percent IS NULL)
)
```

Różnica względem zlecenia: `max_redemptions` ma **`> 0`**, a nie `>= 0`, więc
ZERO jest odrzucane, a „bez limitu" wyraża `NULL`. To rozróżnienie ma znaczenie
dla panelu: puste pole musi jechać jako `NULL`.

Skutek: plik pgTAP **chroni obecność** tych CHECK-ów (ich utrata jest cicha —
panel nadal waliduje), a nie dokumentuje braku.

### 5.2. Sygnałem dryfu w `couponEffects.server.ts` jest `console.warn` — NIEPRAWDA, jest GORZEJ

Zlecenie zakładało, że jedynym sygnałem jest `console.warn`. Sygnału **nie ma
żadnego**: warunek ostrzeżenia wymaga `applied === true`, a przemianowane pole
daje `applied: false`; gałąź `console.error` obsługuje wyłącznie `error` z RPC
i wyjątek. Do tego obaj wywołujący **wyrzucają wynik**.

### 5.3. `admin.donations.tsx` ma „około dziewięciu" literałów — NIEPRAWDA

Miał ich **~45**: nagłówki wszystkich sześciu sekcji, wszystkie etykiety
i podpowiedzi pól, opcje obu droplist, przyciski synchronizacji, raport
uzgodnienia i cała tabela ostatnich wpłat.

### 5.4. `head()` panelu „ma być dwujęzyczny w konwencji innych tras" — NIEPRAWDA

Inne trasy panelu **nie są** dwujęzyczne. Konwencja repo to jednojęzyczny
literał: `"Analityka i wydajność - Admin"`, `"Uzgadnianie płatności - Panel"`,
`"Rekrutacja | Admin"`, `"Comments · Admin"`. `{ title: "Darowizny - Panel" }`
już ją spełnia — zostawiony bez zmian.

### 5.5. „Panele admina MUSZĄ mieć `robots: noindex`" — WYMAGANIE ROZWIĄZANE INACZEJ

Zlecenie kazało zweryfikować osiem paneli. **Siedem nie ma własnego `head()`
w ogóle** — i nie musi: `head()` w `src/routes/admin.tsx` scala się w dół po
dopasowanym łańcuchu tras, więc wszystkie 142 trasy panelu są wyłączone
z indeksowania z jednego miejsca (lokalnie powtarza to tylko 27). Bramka pilnuje
więc ŹRÓDŁA w layoucie i tego, że żaden panel nie NADPISUJE `robots`.

Uwaga dla następnego czytającego: dwa trafienia `head:` w `admin.ads.tsx` to
`{ count: "exact", head: true }` w zapytaniach Supabase, nie nagłówki trasy.

### 5.6. `safeParse` a klucze prototypowe — DEFEKTU NIE MA

Hipoteza obalona **empirycznie**. `safeParse` czyta wyłącznie po literałach
(`cats.functional`, `cats.analytics`, `cats.marketing`), a `necessary` jest
wpisane na twardo. `JSON.parse` tworzy `__proto__` jako WŁASNĄ właściwość danych
(CreateDataProperty, nie setter), więc `{"categories":{"__proto__":{"analytics":true}}}`
daje `cats.analytics === undefined` i nie zatruwa `Object.prototype`. Cudzym
zapisem w `localStorage`/cookie **nie da się** włączyć analityki ani marketingu.
Domknięte testem regresyjnym.

Utajona, powiązana krawędź (nie defekt dziś): `hasCategoryConsent`
i `useCategoryGranted` indeksują obiekt kategorii ZMIENNĄ
(`!!state?.categories?.[cat]`), więc wywołanie łamiące typ —
`hasCategoryConsent("constructor" as ConsentCategory)` — zwróci `true`. Dziś nie
ma takiego wywołującego.

### 5.7. „`check:pg-harness` musi widzieć nowy plik pgTAP" — NIEPRAWDA

`check:pg-harness` to harness **KLUBÓW**: wybiera migracje po treści
(`public.club_`, `admin_club_`) i uruchamia `scripts/pg-harness/runtime_test.sql`.
Nie dotyka `supabase/tests/` w ogóle. Pliki pgTAP wchodzą do suity przez glob
`supabase/tests/*.sql` w `scripts/pgtap-local/run.sh` oraz przez
`supabase test db` — **nie ma żadnego manifestu do aktualizacji.**

### 5.8. Hipotezy OBALONE w warstwie giftingu i reklam

- klient **nie** zlewa powodów odmowy: `revoked` przechodzi jako `"revoked"`
  (jest w `REDEEM_REASONS`), więc odbiorca wygasłego albo wyczerpanego linku
  dostaje właściwe copy i właściwą drogę wyjścia. Zlanie dotyczy WYŁĄCZNIE
  ścieżki nierenderowalnej treści (defekt B1);
- `_post_id` / `_link_id` jako `undefined` działa poprawnie — `JSON.stringify`
  pomija właściwości `undefined`, więc do funkcji nie leci nic i działa
  serwerowy `DEFAULT NULL`;
- awaria odczytu ustawień giftingu **nie wygasza** przycisku, a WŁĄCZA funkcję
  z domyślnymi (`DEFAULT_GIFT_SETTINGS.enabled === true`) — nadmiar UI, nie
  wyciek treści;
- filtr `page_id` w `queries.ts` używa luźnej równości (`p.page_id == null`)
  **świadomie**: dzięki niej placement, któremu PostgREST nie oddał kolumny
  (`undefined`), liczy się jako „bez ograniczenia strony" i nie znika;
- `status` w `donations` **nie** ma dwóch wartości, a pięć
  (`pending/paid/refunded/failed/canceled`) — pierwotna migracja miała dwie,
  migracja darowizn cyklicznych rozszerzyła zbiór. Pierwsza wersja mojego testu
  pgTAP padła właśnie na tym założeniu i została poprawiona po pomiarze.

### 5.9. Słabości WŁASNYCH testów, znalezione i poprawione

Uczciwie: dwie rzeczy w moich testach były najpierw złe.

- asercja limitera w `-ad-event.test.ts` była jednostronna (`<= 60`), więc
  przechodziłaby także dla `capacity: 1` — każde ZANIŻENIE limitu byłoby
  niewidoczne. Zmienione na obustronne (`>= 60` i `<= 61`);
- komentarz twierdził, że `MAX_BODY` chroni pamięć workera. Nieprawda:
  `await req.text()` wciąga całe ciało do pamięci PRZED pomiarem. Limit chroni
  przed `JSON.parse` dużego ładunku i przed zapisem śmieci. Komentarz poprawiony.

---

## 6. Progi

Moduł startował z **ZEREM** progów per-ścieżka (na 334 w repozytorium). Dopisane
**dziewięć**, wszystkie z wartości ZMIERZONYCH i nie wyżej niż pomiar.

| ścieżka                                   | instrukcje | funkcje | linie | gałęzie | uzasadnienie                                                                                                                                   |
| ----------------------------------------- | ---------: | ------: | ----: | ------: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ads/readingMode.ts`              |        100 |     100 |   100 |     100 | pełne pokrycie                                                                                                                                 |
| `src/lib/ads/queries.ts`                  |        100 |     100 |   100 |     100 | pełne pokrycie                                                                                                                                 |
| `src/lib/billing/couponEffects.server.ts` |        100 |     100 |   100 |     100 | pełne pokrycie                                                                                                                                 |
| `src/hooks/useValidateCoupon.ts`          |        100 |     100 |   100 |     100 | pełne pokrycie                                                                                                                                 |
| `src/components/checkout/CouponInput.tsx` |        100 |     100 |   100 |     100 | pełne pokrycie                                                                                                                                 |
| `src/routes/api/public/ad-event.ts`       |        100 |     100 |   100 |     100 | pełne pokrycie                                                                                                                                 |
| `src/lib/gifting/hooks.ts`                |         99 |     100 |   100 |      92 | zmierzone gałęzie 93,25%; pozostałe to warianty okna wdrożeniowego wzajemnie wykluczające się w jednym przebiegu                               |
| `src/lib/gifting-admin.functions.ts`      |        100 |     100 |   100 |      95 | zmierzone 96,87%; pozostałe to gałęzie `.default()` zod dla pól, które panel zawsze wysyła                                                     |
| `src/lib/ads/consent.ts`                  |         90 |      95 |    95 |      86 | zmierzone 91,22 / 96,22 / 96,89 / 87,90. Gałęzie NIE na 93, bo wszystkie 15 pozostałych to strażniki SSR nieosiągalne pod happy-dom — patrz §1 |

**Progi globalne: NIE podniesione w tym przebiegu.** Zmierzone
75,44% linii / 68,94% gałęzi / 72,47% funkcji / 74,43% instrukcji przeciw progom
58 / 62 / 65 / 64 — jest realny zapas na ratchet rzędu +6…+13 pp. Nie robię tego
teraz świadomie: etapy 2 i 3 są niedokończone, więc następny przebieg zmieni te
liczby w górę, a próg globalny wolno ruszać raz i pewnie. To pozycja do zrobienia
razem z domknięciem etapów 2–3.

---

## 7. Bramki

- **Rozszerzona** `src/routes/__tests__/adminRouteAuthority.gate.test.ts`
  o sekcję „moduł 14 — panele monetyzacji: autorytet dostępu" (13 asercji
  - 1 `it.fails` + kontrola dodatnia). Bramka nie znała żadnej z tych tras.
- Zielone: `check:i18n-hardcoded`, `check:i18n-overlay-imports`,
  `i18nParity.gate`, `i18nKeyDrift.gate`, `typecheck`, `format:check`.
- pgTAP lokalnie: 95/101 plików OK (6 pre-existing/środowiskowych).
- **Czerwone i NIE moje:** `authzSnapshotParity` (§4.11) oraz próg gałęzi
  `components/pricing/molecules/**` (§4.13).
- **Nie zrobione:** bramka ładowania słowników monetyzacji (5.3), bramka
  kompletności kluczy `AD_*_LABEL_KEYS` (5.4), przebieg wszystkich 33 bramek
  `check:*`.

---

## 8. Czego nie zrobiłem i dlaczego

**Etap 2 — dziewięć tras panelu (3 573 linie fizyczne, 253 funkcje).**
Nierozpoczęty w chwili pisania tego akapitu; praca była zlecona czterem agentom
(ekstrakcja wg atomic design + testy) i trwała, gdy konto uderzyło w **limit
sesji** (reset 23:40 UTC). Wszystkie cztery agenty padły w trakcie. To jest
największa brakująca część i to ona odpowiada za nieosiągnięcie celu z §6
zlecenia — 58,8% niepokrytych linii modułu.

**Etap 3 — prezentacja reklam i darowizn.** Nierozpoczęty. W tym flagowa
hipoteza `DonationsWidgetView` (`statsQ.data ?? FALLBACK` — widget zbiórki mówi
„0 zł zebrane" przy awarii odczytu) oraz rozbicie 467-linijkowego komponentu
o sześciu wariantach na atomy. Rozpoznanie tej powierzchni też nie powstało
(padło razem z limitem).

**Etap 5.3 i 5.4** — bramka ładowania słowników i bramka kompletności kluczy
etykiet. Obie są tanie, ale zależą od pracy nad trasami (5.3 sprawdza, że trasa
woła `ensure*I18n` przed pierwszym renderem), więc szły w parze z etapem 2.

**Przebieg wszystkich 33 bramek `check:*`.** Uruchomione zostały te, których
dotyczyły moje zmiany. Pełny przejazd należy zrobić po domknięciu etapów 2–3.

**Ekstrakcja atomic design.** Nie wykonana dla żadnej trasy — jest mechanizmem
dojścia do 90–95% na trasach, więc ma sens dopiero razem z etapem 2. Trzy
katalogi (`components/admin/ads/`, `components/admin/gifting/`) zaczęły
powstawać w chwili przerwania.

**Migracji SQL nie dodałem** (regula 9) i **snapshotu autoryzacji nie
regenerowałem** (reguła 7) — oba świadomie, oba zgłoszone w §4.

### Uwaga o środowisku

Dwie rzeczy warte zapisania dla następnej sesji w tym kontenerze:

1. `node_modules` przyszedł rozjechany — 276 paczek w `bun.lock` celuje
   w `europe-west4-npm.pkg.dev`, który proxy blokuje 403. Brakowało m.in.
   `@tanstack/react-query`, `react-router` i `react-start`, więc **żaden** test
   modułu nie dawał się uruchomić. Uzupełnione przez `npm install`
   (`package-lock.json` jest w `.gitignore`; `bun.lock` nietknięty).
   2 `pgtap` nie był zainstalowany w obrazie — `apt-get install postgresql-16-pgtap`
   załatwia sprawę i bez tego `test:pgtap-local` kończy się „extension pgtap is
   not available", czyli wyglądałoby na błąd testu, a nie środowiska.
