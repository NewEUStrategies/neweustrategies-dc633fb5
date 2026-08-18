# Wdrożenie: okablowanie `checkout_settings` do sesji Stripe - 2026-08-06

**Źródło zadania:** `docs/OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`, wiersz
**`checkout_settings`** (ocena 3): „Wydmuszka przez szóste wydanie.
`checkoutSessionExtraParams` (`lib/billing/checkoutSettings.ts`) wołane
**wyłącznie we własnym teście**; `checkout.functions.ts` nie importuje modułu;
flagi `automatic_tax`/`tax_id_collection`/`invoice_creation`/
`allow_promotion_codes` nie trafiają do sesji Stripe, choć panel je zapisuje,
a `checkout.$planId.tsx:271-279` obiecuje je kupującemu”. Rekomendacja:
„Okablować albo wyciąć razem z testami; **kłamiące obietnice w UI usunąć
natychmiast**”.

Wybrano **okablowanie**: tabela ma sens biznesowy (kupony, NIP na fakturze,
adres rozliczeniowy), panel admina jest gotowy, a jedyne czego brakowało to
ścieżka od ustawień do faktycznego ładunku `checkout.sessions.create`.

**Weryfikacja na tej sesji:** `tsc --noEmit` bez nowych błędów (93 błędy
pre-existing, wyłącznie w trasach `src/routes/api/**` z powodu
niezregenerowanego `routeTree.gen.ts` - na czystym drzewie identycznie);
ESLint na wszystkich zmienionych plikach czysty (dodatkowo naprawione 3 błędy
formatowania pre-existing w `adhocCheckout.server.ts`,
`adhocCheckoutOrder.server.ts`, `admin.paywall.tsx`); `check:i18n-parity`
zielony (118 testów); nowe testy: 16 (czysta funkcja) + 6 (ładunek sesji
Stripe) + 4 (odczyt serwerowy) + 5 (atom UI).

---

## 1. Dlaczego martwy kod był martwy

`checkoutSessionExtraParams` zwracał `Array<[string, string]>` - pary do
form-encoded body z czasów, gdy repo nie używało SDK operatora („konwencja
repo: żadnego SDK Stripe, surowe URLSearchParams”). Po migracji na
`stripe` 22.x sesje powstają przez `stripe.checkout.sessions.create(params)`
z typowanym obiektem, więc stary kształt **nie miał jak** wpiąć się w ścieżkę

- i nikt go nie wpiął.

## 2. Nowa architektura - jedna czysta funkcja, trzy ścieżki wejścia

### `src/lib/billing/checkoutSettings.ts` (izomorficzny, bez SDK)

- `CHECKOUT_SETTINGS_COLUMNS` - jedno źródło prawdy dla `select()` po obu
  stronach (hook kliencki i loader serwerowy).
- `checkoutBillingPlane(settings)` -> `"managed" | "merchant"` - nazwana
  **płaszczyzna rozliczeniowa** sesji (patrz §3).
- `checkoutSessionParams(settings, context)` -> typowany fragment
  `SessionCreateParams`. **Jedyne** miejsce, w którym rozstrzygamy zależności
  wymuszone przez API Stripe:

  | Reguła                                           | Skutek                                                         |
  | ------------------------------------------------ | -------------------------------------------------------------- |
  | `discounts` + `allow_promotion_codes` = błąd API | rabat kuponu B2B wygrywa, pole kodu znika                      |
  | `customer` + `customer_creation` = błąd API      | `customer_creation=always` tylko dla gościa w trybie `payment` |
  | istniejący klient + `automatic_tax`              | wymagane `customer_update.address='auto'`                      |
  | istniejący klient + `tax_id_collection`          | wymagane `customer_update.name='auto'`                         |
  | `automatic_tax` potrzebuje jurysdykcji           | `billing_address_collection='required'`                        |
  | subskrypcja fakturowana jest zawsze              | `invoice_creation` wyłącznie w trybie `payment`                |

  Poprzednia (martwa) implementacja **nie znała** trzech pierwszych reguł -
  gdyby ją naiwnie podłączyć, każda sesja zalogowanego kupującego kończyłaby
  się błędem Stripe (`customer` razem z `customer_creation`).

### `src/lib/billing/checkoutSettings.server.ts` (nowy)

`loadCheckoutSettings(supabase, tenantId)` - odczyt zawężony do **tenantu
zamówienia** (`payment_orders.tenant_id`), nie tenantu żądania. Zapytanie idzie
klientem użytkownika, czyli pod RLS (`tenant_id = public_tenant_id()`); jawny
filtr jest drugim zamkiem - rozjazd tenantów daje zero wierszy i konserwatywne
domyślne zamiast cudzej konfiguracji podatkowej. Fail-safe: błąd odczytu nie
wywraca płatności, tylko loguje i zwraca `DEFAULT_CHECKOUT_SETTINGS`.

Świadomie bez cache: to jeden SELECT z tabeli o jednym wierszu na tenant,
pomijalny obok 2-4 wywołań API Stripe w tej samej ścieżce, a admin zmieniający
flagi widzi skutek natychmiast.

### Ścieżki wejścia (wszystkie trzy silniki checkoutu)

| Plik                           | Co się zmieniło                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.functions.ts`        | `INSERT ... RETURNING id, tenant_id`, `loadCheckoutSettings` przed utworzeniem sesji, `settings` do obu gałęzi (plan katalogowy + ad-hoc) |
| `stripeCheckout.functions.ts`  | to samo dla drugiego silnika (plan z `lookup_key`)                                                                                        |
| `adhocCheckoutOrder.server.ts` | to samo dla odblokowania treści / biletu / darowizny                                                                                      |
| `adhocCheckout.server.ts`      | `settings?: CheckoutSettings` w obu wejściach; `...sessionFlags(...)` zastępuje zahardkodowane `managed_payments`                         |

Darowizny z `donations.server.ts` (osobny moduł, `mode: subscription` dla
cyklicznych) pozostają poza tym mechanizmem - darowizna nie jest sprzedażą i
świadomie nie ma ani `managed_payments`, ani flag podatkowych (komentarz w
module bez zmian).

## 3. Płaszczyzna rozliczeniowa - `managed_payments` vs `automatic_tax`

Repo miało dyrektywę „nie łączymy `managed_payments` z `automatic_tax`”
powtórzoną w komentarzach, ale nigdzie wyrażoną w kodzie. Teraz jest to nazwany
i przetestowany niezmiennik:

- **`managed`** (domyślna, `automatic_tax: false`) - Stripe jako operator
  rozliczeniowy (Merchant of Record). Stripe nalicza podatek i sam wystawia
  fakturę (patrz `invoice.server.ts`: „faktury nie są przechowywane u nas”).
  Do sesji jadą `managed_payments`, kupony, NIP i adres rozliczeniowy;
  `automatic_tax` i `invoice_creation` **nie**, bo dublowałyby rolę operatora.
- **`merchant`** (`automatic_tax: true`) - sprzedawca przejmuje podatek
  (Stripe Tax na własnym koncie). `managed_payments` znika, wchodzą
  `automatic_tax`, wymagany adres i - dla płatności jednorazowych -
  `invoice_creation`.

**Brak regresji na produkcji:** przy domyślnych ustawieniach
(`automatic_tax: false`) sesja różni się od dotychczasowej wyłącznie o
`allow_promotion_codes`, `tax_id_collection` i `customer_update.name` - czyli
dokładnie o to, co panel obiecywał, a czego nie wysyłał. Test
„domyślne ustawienia nie zmieniają dotychczasowego kształtu sesji” pilnuje tego
jawnie.

## 4. Koniec kłamiących obietnic w UI

- **Nowy atom** `src/components/checkout/CheckoutAssurances.tsx` - lista
  wskazówek liczona **tą samą** funkcją `checkoutSessionParams`, której używa
  serwer. Obietnica nie może rozjechać się z sesją z definicji, nie z dyscypliny.
  - kupon B2B zastosowany -> obietnica pola kodu promocyjnego znika (Stripe i
    tak by go nie pokazał),
  - `automatic_tax` obiecywany wyłącznie na płaszczyźnie sprzedawcy,
  - nowa wskazówka `checkout.invoiceHint` (PL/EN) o dostępności faktury.
- `checkout.$planId.tsx` - wycięty inline `<ul>` z trzema warunkami; tryb sesji
  wyprowadzony z cyklu planu (`one_time` -> `payment`).
- `admin.paywall.tsx` - **podgląd płaszczyzny** (`CheckoutPlanePreview`):
  operator widzi nazwę płaszczyzny i posortowaną listę parametrów, które
  faktycznie pojadą do Stripe dla bieżących przełączników.
- i18n PL/EN: `checkout.invoiceHint`, `admin.paywall.planTitle` /
  `planManaged` / `planMerchant` / `planParams`; doprecyzowane
  `automaticTaxHint` (przejęcie rozliczenia od MoR) i `invoiceCreationHint`.

## 5. Testy

| Plik                                                        | Zakres                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `__tests__/checkoutSettings.test.ts`                        | normalizacja, płaszczyzna, **wszystkie 6 reguł API** (16 testów)                         |
| `__tests__/checkoutSessionFlags.server.test.ts`             | **nowy** - ładunek faktycznie przekazany do `stripe.checkout.sessions.create` (6 testów) |
| `__tests__/checkoutSettingsLoad.server.test.ts`             | **nowy** - zawężenie do tenantu, fail-safe (4 testy)                                     |
| `components/checkout/__tests__/checkoutAssurances.test.tsx` | **nowy** - obietnice UI vs sesja (5 testów)                                              |

Kluczowy jest drugi z nich: test czystej funkcji nie wykryłby ponownego
odłączenia modułu - dokładnie tak martwy kod przetrwał sześć wydań. Test
ładunku sesji spina flagę z wywołaniem API, więc odpięcie okablowania od razu
świeci na czerwono.

## 6. Świadomie poza zakresem

- **Osobny przełącznik `managed_payments` w bazie** - płaszczyzna jest dziś
  wyprowadzana z `automatic_tax`, bez migracji. Gdyby operator potrzebował
  wyłączyć MoR bez włączania własnego Stripe Tax, wystarczy dodać kolumnę i
  zmienić `checkoutBillingPlane` - reszta łańcucha jest już gotowa.
- **Pozostałe błędy formatowania w `src/lib/billing`** (18 plików) - osobna
  pozycja audytu, nietknięta, żeby diff tego wdrożenia pozostał czytelny.
