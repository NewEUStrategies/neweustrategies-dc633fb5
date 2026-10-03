# Moduł 13 - monetyzacja: naprawy, martwy kod i pokrycie testami (2026-10-03)

Zlecenie: „Optymalizuj, napraw i wdrażaj testy" dla wiersza audytu
**Monetyzacja: checkout / subskrypcje / billing** (wydanie 12,
`AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 16.6):
12 funkcjonalności, 293 linie bez testu z 6 042, osiem wierszy poniżej 100%
linii. PR: NewEUStrategies/neweustrategies-dc633fb5#449.

Praca szła w trzech falach:

1. **Defekty modułu 13 z audytu** (wyd. 11 i 12) - naprawione ręcznie, każdy
   z testem regresji.
2. **Kampania testów** - 8 grup funkcjonalności, w każdej agent piszący testy
   i drugi agent, który je adwersaryjnie weryfikował (siła asercji,
   determinizm, atrapy wyłącznie na granicach systemu) oraz próbował obalić
   zgłoszone defekty i martwy kod.
3. **Fala napraw** - 27 defektów potwierdzonych w kampanii i 27 pozycji
   martwego kodu, rozdzielone na 9 rozłącznych klastrów plików; dla każdej
   naprawy najpierw test czerwony na starym kodzie, potem poprawka, potem
   adwersaryjny przegląd diffu.

---

## 1. Pomiar: przed i po, tą samą metodą

vitest + istanbul (provider z `vitest.config.ts`), raport zawężony do
**204 plików produkcyjnych modułu 13** (`classifyPath` z
`scripts/taxonomy/moduleMap.mjs`), uruchamiane wszystkie pliki testowe, które
importują kod modułu (293 pliki na końcu). To jest pomiar podzbioru, nie
pełnej suity: pliki modułu pokrywane wyłącznie przez testy spoza tego zbioru
wychodzą tu nieco niżej niż w CI (pomiar wyjściowy: 94,96% wobec 95,15%
w audycie).

| Metryka                     |               Przed (HEAD `b1c8772`) |                                     Po |
| --------------------------- | -----------------------------------: | -------------------------------------: |
| Linie                       | 94,96% (5788/6095), 307 niepokrytych | **99,90% (6167/6173), 6 niepokrytych** |
| Gałęzie                     |                               90,32% |                             **97,51%** |
| Funkcje                     |                               94,41% |                             **99,87%** |
| Instrukcje                  |                               94,10% |                             **99,58%** |
| Przypadki testowe w zbiorze |                                6 472 |                              **7 117** |

Sześć linii, które zostały:

- **5 linii `src/lib/billing/audit.server.ts`** - ścieżka eksportu XLSX.
  Paczka `xlsx` jest w tym środowisku zablokowana polityką sieci (tarball
  z `cdn.sheetjs.com`), więc pomiar szedł z lokalną zaślepką poza
  repozytorium - jak w audycie wyd. 12, rozdz. 16.1. W CI paczka jest i te
  linie pokrywa `auditReport.server.test.ts`.
- **1 linia `src/lib/billing/returnUrl.server.ts`** - ostatni `catch`
  w `absoluteReturnUrl`, celowo nieosiągalny bezpiecznik dla wejścia
  z zewnątrz (opisany w kodzie; przegląd fali napraw go zostawił).

### Per funkcjonalność

Audyt nie publikuje regexów funkcjonalności modułu 13 (`scripts/taxonomy/features.mjs`
ma taksonomię tylko dla modułów 3, 7, 16 i 21), więc grupy poniżej są moją
rekonstrukcją po ścieżkach - nazwy wierszy audytu zachowane, liczby nie są
porównywalne co do pliku z kolumnami audytu.

| Funkcjonalność                               | Pliki | Linie przed (niepokryte) |       Linie po |           Gałęzie |             Funkcje |
| -------------------------------------------- | ----: | -----------------------: | -------------: | ----------------: | ------------------: |
| Dokumenty rozliczeniowe i historia płatności |    14 |              74,5% (118) | **100,0% (0)** | 65,8% → **96,8%** |  76,5% → **100,0%** |
| Uprawnienia i skutki zakupu                  |    15 |               97,5% (18) | **100,0% (0)** | 90,8% → **99,9%** | 100,0% → **100,0%** |
| Webhook płatności                            |     8 |               88,3% (53) | **100,0% (0)** | 86,3% → **97,8%** |  86,3% → **100,0%** |
| Checkout (Stripe) + intencja                 |    37 |               97,3% (30) |  **99,9% (1)** | 94,2% → **99,2%** |  95,7% → **100,0%** |
| Samoobsługa subskrypcji i retencja           |    18 |               93,8% (35) | **100,0% (0)** | 86,4% → **97,5%** |  93,7% → **100,0%** |
| Subskrypcje / plany / cennik                 |    38 |               96,5% (36) | **100,0% (0)** | 89,7% → **97,2%** |  95,2% → **100,0%** |
| Dołączenie do członkostwa (membership join)  |    13 |                97,0% (5) | **100,0% (0)** | 94,6% → **99,5%** |  95,0% → **100,0%** |
| Billing: rekoncyliacja i panel               |    21 |               97,2% (28) |  **99,4% (5)** | 92,4% → **95,5%** |  98,0% → **100,0%** |

Progi pokrycia z `vitest.config.ts` sprawdzone na końcowym pomiarze: CI nie
ma `perFile`, więc globy liczy na sumie plików - wszystkie agregaty modułu 13
i wszystkie progi pojedynczych plików przechodzą. Jeden próg per plik
(`refunds.server.ts`, gałęzie 98%) zapalił się w CI w trakcie pracy i jest
naprawiony (`e33c982`, opis w 2.1).

---

## 2. Fala 1: defekty modułu 13 z audytu wydań 11 i 12

| Waga   | Defekt                                                                                              | Poprawka                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| wysoki | `alertAdminsAboutDispute` powiadamiał administratorów **wszystkich** najemców (`refunds.server.ts`) | najemca z subskrypcji / zamówienia / darowizny, odbiorcy przez `notifyTenantAdmins`; spór bez najemcy nie dzwoni u nikogo (log serwera) |
| wysoki | `resolvePlanForPrice` bez zakresu najemcy i bez kolejności (`purchaseEffects.server.ts`)            | obowiązkowy `PlanScope` (najemca z wiersza albo z profilu), `ORDER BY sort_order, created_at, id`                                       |
| wysoki | okres próbny planu nie trafiał do sesji Stripe na `/checkout/$planId`                               | `trial_days` z planu idzie do sesji                                                                                                     |
| wysoki | kod zakłada unikalność `user_subscriptions.external_ref`                                            | odczyty `order + limit(1)` - duplikat nie zapętla ponowień webhooka                                                                     |
| średni | uzgadnianie za rolą `admin`, ponowienie z dziennika za `super_admin`                                | wspólna bramka `assertSuperAdmin`; trasa pokazuje wyjaśnienie zamiast formularza                                                        |
| średni | zakup z webhooka do GA4 ignorował strumień najemcy                                                  | `sendGa4Purchase({ tenantId })` czyta panel analityki najemcy                                                                           |
| niski  | serwerowy zakup GA4 omijał `ga4_enabled: false`                                                     | wyłącznik respektowany; błąd odczytu ustawień = milczenie                                                                               |
| niski  | wygrany spór przywracał RSVP `going` bezwarunkowo                                                   | RSVP tylko bez `registration_id`; alert prosi o decyzję organizatora                                                                    |
| niski  | komentarz o `_ga_client_id` obiecywał zapis, którego nie ma                                         | komentarz opisuje stan faktyczny                                                                                                        |
| niski  | martwy `trialDaysForPrice`                                                                          | usunięty                                                                                                                                |

### 2.1. Próg gałęzi `refunds.server.ts`

Po naprawie alertu o sporze CI odrzucił plik (gałęzie 95,28% < 98%). Siedem
z ośmiu niepokrytych gałęzi to były zapasowe `?? null` / `?? plan?.tenantId`
na `tenant_id`, który jest `NOT NULL` na `subscriptions`, `payment_orders`
i `donations` - usunięte, a nieosiągalny strażnik w dzwonku o zwrocie
zastąpiony typem `string`. Ósma gałąź była prawdziwa (spór z subskrypcją
nieznaną lokalnie bierze najemcę z zamówienia) i ma test. Plik: 100%
w czterech metrykach.

---

## 3. Fala 2: kampania testów

8 grup funkcjonalności, 16 agentów (pisarz + adwersaryjny weryfikator na
grupę), 0 błędów. Wszystkie grupy zielone dwukrotnie po weryfikacji;
weryfikatorzy przepisali słabe testy (asercje na atrapach zamiast na skutku,
brak zamrożonej strefy czasu, test, który przechodził przy zamienionym
okablowaniu „Pobierz z CRM” / „Zapisz w CRM”).

Commity: `0097f24` (dokumenty rozliczeniowe), `7e790bc` (webhook i checkout),
`e9346d3` (samoobsługa, retencja, skutki zakupu), `ca25bf2` (plany, cennik,
członkostwo, rekoncyliacja). Razem 49 nowych plików testowych i kilkanaście
rozszerzonych.

---

## 4. Fala 3: 27 defektów i martwy kod znalezione przez kampanię

Weryfikatorzy potwierdzili **27 defektów** (3 wysokie, 7 średnich, 17 niskich)
i **27 pozycji martwego kodu**. Wszystkie 27 defektów naprawionych, każdy
z testem czerwonym przed poprawką; martwego kodu usunięto 24 pozycje, resztę
świadomie zostawiono (niżej).

| Klaster            | Commit    | Najważniejsze                                                                                                                                                                                                                                                                           |
| ------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Katalog operatora  | `3af0da2` | **wysoki**: nieudany odczyt `access_plans` był traktowany jak pusta lista planów - sprzątacz archiwizował **każdą** oznaczoną cenę i produkt live w Stripe, a przebieg zapisywał się jako `ok`; zła etykieta zarchiwizowanego produktu                                                  |
| Windykacja         | `1c25ef9` | **wysoki**: klucz idempotencji maila `payment_failed` powtarzał się w każdym cyklu po odzyskaniu płatności - pierwszy mail kolejnego cyklu ginął jako duplikat; błąd odczytu subskrypcji kończył webhook jako `processed` bez windykacji; błąd zapisu licznika nie przerywał maila      |
| Dane firmy z CRM   | `db4382e` | **wysoki**: „Zapisz w CRM” przemianowywał i nadpisywał wspólną kartotekę zespołu, gdy dane do faktury wskazywały inną firmę; szukanie po nazwie przeglądało dowolne 200 firm; wolny tekst kraju trafiał do kodu ISO                                                                     |
| Faktura PDF        | `cec62e3` | znak euro drukował się jako `ą`, litery Latin-1 jako `?`; ogólny opis pozycji dla biletów, treści i darowizn; błąd odczytu dawał `ok: true` z PDF-em bez sprzedawcy albo nabywcy                                                                                                        |
| Skutki zakupu      | `494e1f6` | proporcja dopłaty w mailu zawsze z 30 dni (plan roczny: ok. dwukrotność faktury); `{ error }` z PostgREST w blokach fail-soft przepadał bez śladu                                                                                                                                       |
| Operator i webhook | `ff3f961` | odrzucone ładowanie Stripe.js zapamiętane do końca strony (jedna chwilowa awaria blokowała kasę); przejęcie zdarzenia `failed` bez strażnika - dwa równoległe przejęcia obsługiwały zdarzenie dwa razy (teraz warunkowy UPDATE po `retry_count`)                                        |
| Checkout           | `a445d80` | finalizacja w trybie mock pomijała odświeżenie uprawnień przy szybkim odmontowaniu; godzina kursu walut w strefie przeglądarki obok daty w strefie serwisu; przycisk usunięcia kuponu bez dostępnej nazwy                                                                               |
| Samoobsługa        | `d3a0e2b` | **średni**: panel retencji przy błędzie odczytu pokazywał domyślne 30/3/14 z aktywnym zapisem - prawdziwy rabat można było nadpisać; statusy subskrypcji po końcu okresu; obniżenie planu ponownie szukało harmonogramu `list({ limit: 1 })`; cena spoza katalogu pokazywała cudzy plan |
| Plany i cennik     | `69c614c` | strona planu po wylogowaniu mówiła „plan wycofany ze sprzedaży”; karty i strona planu obiecywały darmowy okres, którego checkout nie przyzna                                                                                                                                            |

Martwy kod usunięty m.in.: `openAdhocCheckout` w `useCheckout` (cały
nieużywany wariant kasy ad-hoc z hooka), `requestOrigin` i parametr
`fallbackPath` w `returnUrl.server`, `billingKeys.myPaymentMethodAll`,
nieosiągalne gałęzie w transporcie klienta Stripe, `?? x` na kolumnach
`NOT NULL` (`payment_failure_count`, `crm_leads.tags`, długości wyników
PostgREST), strażnicy nieosiągalni z UI.

### 4.1. Świadomie NIE zrobione

- **Strażniki wejścia z zewnątrz zostają**: `catch` w `absoluteReturnUrl`,
  gałąź `null` w `parseHttpOrigin`, zawężenie typu w submit
  `/checkout/$planId`, `if (!normalized) continue` w `selfSync.server`
  (zależy od kontraktu `normalizeStripeEvent` spoza klastra).
- **Decyzje produktowe, nie defekty kodu**: czy „Zapisz w CRM” ma wpisywać
  kod ISO do wolnotekstowego kraju w kartotece; czy zapis ma przepinać
  pracodawcę w profilu członka; czy pusty (a nie błędny) odczyt
  `access_plans` ma archiwizować katalog; opis pozycji na fakturach odnowień
  subskrypcji (wymaga zmiany poza klastrem).
- **Migracje**: indeks na `user_subscriptions.external_ref` (unikalny wymaga
  sprawdzenia duplikatów na produkcji; drugi pas migracji wdraża narzędzie
  zewnętrzne), RPC wyszukiwania firmy po kluczu nazwy (obecny filtr ILIKE
  daje te same gwarancje bez migracji).
- **`healCatalogOnce`** nie ma wywołującego w produkcji - nie był na liście
  potwierdzonego martwego kodu, zostaje do osobnej decyzji.
- **`createAdhocCheckoutSession`** po usunięciu `openAdhocCheckout` nie ma
  wywołującego w repo, ale jest osiągalnym punktem RPC - jego usunięcie to
  zmiana kontraktu serwera, poza tym PR.

---

## 5. CI: czerwienie spoza tego PR

W trakcie pracy `main` dostał zmiany, które czerwienią CI niezależnie od
modułu 13 (opisane w komentarzach na PR):

- `build` → „Bundle size budget”: `main` sam przekracza budżet (public
  ~2894 KB > 2877 KB); przyrosty to chunki spoza modułu 13.
- `verify` → prettier i lint: `AGENTS.md` i
  `src/components/dock/molecules/MinimizedChats.tsx` z commitów bota na
  `main`.
- `test` → próg pokrycia `MinimizedChats.tsx` (98%) - ten sam plik.
- Raz `test-shards (2)` doszedł do limitu 30 min przy normalnym tempie
  pozostałych shardów; nowe pliki testowe uruchomione pojedynczo kończą się
  w 1-13 s.

Po drodze przeniesiono do tego PR poprawkę z #448 (`:has()` w `styles.css`
z `main`) i dopisano jej plik do taksonomii (`check:feature-taxonomy`).

---

## 6. Walidacja lokalna (na HEAD fali 3)

- `tsc --noEmit` całego projektu: czysto poza trzema błędami z zaślepki
  `xlsx` (`spreadsheetCore.ts`, `leadExportFile.test.ts`) - w CI z prawdziwą
  paczką ich nie ma.
- eslint i prettier na wszystkich zmienionych plikach: czysto (jedno
  ostrzeżenie `react-refresh` w `SubscriptionCard.tsx` istniało wcześniej).
- `check:ci-gates` 81/81 plików, `check:i18n-parity` 12/12,
  `check:authz-snapshot`, `check:feature-taxonomy`, `check:clock-freeze`,
  `check:unknown-casts`, `check:db-row-casts`, `check:stale-never-casts`,
  `check:i18n-hardcoded`, `check:i18n-default-value`,
  `check:i18n-overlay-imports` (linia bazowa `CouponInput.tsx` 4 → usunięta),
  `check:legacy-payment-refs`, `check:dangerous-html`,
  `check:client-ip-source`, `check:menu-icons` - OK.
- 293 pliki testowe modułu: 7 117 zielonych; jedyna czerwień to
  `auditReport.server.test.ts > XLSX…` (zaślepka paczki).

## 7. Jak sprawdzić

```sh
bun run test -- src/lib/billing src/components/billing src/components/checkout \
  src/components/pricing src/components/membership-join src/components/admin/billing \
  src/components/admin/pricing src/routes/__tests__ src/routes/api/public
bun run test:coverage   # pełna suita z progami
bun run check:ci-gates && bun run check:i18n-parity
```
