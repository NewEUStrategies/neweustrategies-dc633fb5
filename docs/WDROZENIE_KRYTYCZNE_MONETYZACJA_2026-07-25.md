# Wdrożenie ustaleń krytycznych - ścieżka pieniężna (2026-07-25)

> Zakres: §1 i §2 z `AUDYT_FUNKCJONALNY_MODULOW_2026-07-25.md` - cicha porażka
> zapisu w `grantEntitlement` i w webhooku Stripe. Oba defekty miały ten sam
> mechanizm: `supabase-js` nie rzuca przy błędzie zapisu, a handler webhooka
> zwraca 200 dla wszystkiego, co nie rzuciło. Stripe po 200 nie ponawia dostawy,
> więc rozjazd stanu był **trwały i niewidoczny**.

## Zasady wdrożenia (spełnione)

- **Bez `any` / `as any`** - nowy kod nie wprowadza żadnego. Helper `mustWrite`
  przyjmuje `PromiseLike<{ error: { message: string } | null }>`, co strukturalnie
  pasuje do buildera PostgREST bez rzutowania.
- **i18n PL/EN** - nie dotyczy: cała zmiana jest serwerowa, a nowe teksty to
  komunikaty wyjątków i logi (nigdy nie trafiają do UI).
- **tenant_id / izolacja** - bez zmian w zapytaniach; poprawki nie dotykają
  filtrów tenanta ani nie dodają kolumn do payloadów.
- **„-" zamiast „—"** - nowe komentarze i komunikaty używają dywizu.
- **Testy** - 12 nowych testów pilnuje kontraktu; `grant.server.ts` ma próg
  pokrycia 100% linii, więc każda nowa gałąź błędu jest pokryta.

---

## 1. `grantEntitlement` - kontrakt „rzuca przy każdej porażce bazy"

`src/lib/billing/grant.server.ts`, `src/lib/billing/__tests__/grant.server.test.ts`

Funkcja jest jedynym punktem zamiany płatności na dostęp (`has_content_access()`
czyta dokładnie te wiersze). Wszystkie trzy zapisy i dwa gatujące odczyty
ignorowały `error`, więc funkcja **nie mogła zawieść w sposób widoczny**.

| Miejsce                                         | Było                                                                        | Jest                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| odczyt `access_plans` (interwał planu)          | `error` gubiony - nieudany odczyt cicho degradował do domyślnego okresu     | rzuca przy błędzie; **brak wiersza** nadal tolerowany (`periodEndFor(null)`) |
| odczyt `user_subscriptions` (insert vs refresh) | `error` gubiony - nieudany odczyt udawał „brak wiersza" i kierował w INSERT | rzuca przy błędzie                                                           |
| `update` subskrypcji                            | `error` gubiony                                                             | rzuca z `external_ref` w komunikacie                                         |
| `insert` subskrypcji                            | `error` gubiony                                                             | rzuca z `external_ref` w komunikacie                                         |
| `upsert` zakupu                                 | `error` gubiony                                                             | rzuca z `user/entity` w komunikacie                                          |

Rozróżnienie **„brak wiersza" ≠ „nieudany odczyt"** jest tu istotne i zostało
zachowane celowo: istniejący test wymaga, żeby usunięty plan degradował do
bezpiecznego domyślnego okresu, a nie wywracał grantu. Rzucamy tylko wtedy, gdy
baza faktycznie zwróciła błąd.

Drugi odczyt zasługuje na osobne zdanie, bo to nie kosmetyka: wybiera on gałąź
INSERT vs UPDATE. Przy zgubionym błędzie `existing` było `null`, kod szedł w
INSERT, ten padał na unikalnym `external_ref` - i ten błąd też był gubiony.
Grant przepadał w całości.

**Dlaczego to przywraca zabezpieczenie, a nie tylko poprawia logi.** Komentarz w
`webhooks.stripe.ts` opisuje architekturę „grant-before-flip" i wprost zakłada,
że **nieudany grant rzuca**:

> „if `grantEntitlement` **threw** after the status was already flipped, the
> Stripe retry found the order paid, matched zero rows, and skipped the grant
> forever - customer charged, no access."

Ponieważ grant nie mógł rzucić przy błędzie bazy, handler flipował zamówienie na
`paid` i odpowiadał 200. Stripe nie ponawiał. Teraz wyjątek zamienia się w 500,
Stripe ponawia, a grant jest idempotentny - stan się dogania.

## 2. Webhook Stripe - helper `mustWrite` na ścieżce pieniężnej

`src/routes/api/public/webhooks.stripe.ts`, `src/routes/api/public/-webhooks.stripe.test.ts`

Zamiast 12 powtórzonych `if (error) throw` wprowadzono jeden helper, żeby nie
rozdmuchać handlera:

```ts
async function mustWrite(op: PromiseLike<WriteResult>, what: string): Promise<void> {
  const { error } = await op;
  if (error) throw new Error(`${what}: ${error.message}`);
}
```

Objęte zapisy (każdy z etykietą diagnostyczną niosącą identyfikator):

| Zdarzenie                                                    | Zapis                                    | Skutek cichej porażki (przed)                                                               |
| ------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `checkout.session.completed`                                 | `payment_orders` → `paid`                | efekty kuponu B2B pomijane (`apply_b2b_coupon_effects` jest fail-closed na `status='paid'`) |
| `invoice.payment_succeeded`                                  | `user_subscriptions` → odnowienie okresu | dostęp wygasa mimo zapłaconej faktury                                                       |
| `customer.subscription.updated`                              | `user_subscriptions` → lustro statusu    | rozjazd ze Stripe                                                                           |
| `customer.subscription.deleted`                              | `user_subscriptions` → `canceled`        | **dostęp płatny po rezygnacji, bezterminowo**                                               |
| `charge.refunded`                                            | `donations` → `refunded`                 | zwrot darowizny bez śladu                                                                   |
| `charge.refunded`                                            | `payment_orders` → `refunded`            | zamówienie nadal `paid`                                                                     |
| `charge.refunded`                                            | `user_purchases` → `refunded`            | **dostęp po zwrocie pieniędzy**                                                             |
| `charge.refunded`                                            | `user_subscriptions` → `canceled`        | **dostęp po zwrocie pieniędzy**                                                             |
| `checkout.session.expired` / `payment_intent.payment_failed` | `payment_orders` → `canceled`/`failed`   | zamówienie wisi w `pending`                                                                 |

Dodatkowo odczyt zamówienia w `charge.refunded` dostał `if (orderErr) throw` -
dotąd nieudany odczyt udawał „brak zamówienia" i handler robił `break`, czyli
**porzucał cały zwrot** przy odpowiedzi 200.

### Czego świadomie NIE objęto

Rejestr `billing_documents` zostaje **best-effort** - zgodnie z regułą, którą
plik już wcześniej deklarował („dokument nigdy nie może wywrócić księgowania
płatności", `upsertBillingDocument` loguje ostrzeżenie zamiast rzucać). Dwa
zapisy `billing_documents` w ścieżce zwrotu przepisano na pętlę z logowaniem, więc
teraz zachowują się jawnie tak samo jak reszta rejestru - dotąd gubiły `error`
bez żadnego śladu.

To rozróżnienie jest sedno zmiany: **nie każdy zapis ma rzucać**. Rzucają zapisy
stanu pieniędzy i uprawnienia; rejestr dokumentów loguje.

## 3. Testy

`grant.server.test.ts` - nowy blok `propagacja błędów bazy` (6 testów): błąd
odczytu planu, błąd odczytu istniejącej subskrypcji, błąd `update`, błąd
`insert`, błąd `upsert` zakupu oraz test, że komunikat niesie `external_ref`
i treść błędu bazy (diagnostyka bez wchodzenia do bazy). Harness dostał
`writeResult`, bo dotąd terminal zapisu zawsze zwracał sukces - błędu zapisu
**nie dało się w nim wyrazić**.

`-webhooks.stripe.test.ts` - 7 nowych testów: nieudany flip na `paid` zwraca 500
**i nie woła efektów kuponu**, nieudane anulowanie subskrypcji, nieudane
odnowienie z faktury, nieudane odbranie uprawnienia przy zwrocie, nieudany
odczyt zamówienia przy zwrocie, nieudane oznaczenie wygasłej sesji - oraz test
odwrotny: **padnięty zapis dokumentu NIE blokuje odbrania dostępu** (200 + log).

Harness dostał `writeQueue` (kolejkę wyników zapisu). Było to konieczne, bo
polityka błędów przestała być jednolita - trzeba umieć uszkodzić dokładnie jeden
zapis w przepływie. Z tego samego powodu uściślono istniejący test
„padnięty zapis dokumentu nie wywraca księgowania płatności": dotąd psuł
**wszystkie** zapisy naraz i asertował 200, co po uszczelnieniu ścieżki
pieniężnej mieszałoby dwie różne polityki w jednej asercji. Teraz psuje wyłącznie
upsert dokumentu i dodatkowo sprawdza, że zamówienie mimo to zaksięgowało się
na `paid` - czyli dokładnie to, o co w tym teście chodziło.

## Weryfikacja

| Sprawdzenie                                               | Wynik                                                  |
| --------------------------------------------------------- | ------------------------------------------------------ |
| `tsc --noEmit`                                            | czysto                                                 |
| `eslint` (4 zmienione pliki)                              | czysto                                                 |
| `prettier --check` (4 zmienione pliki)                    | czysto                                                 |
| `vitest` - `grant.server.test.ts`                         | 15/15                                                  |
| `vitest` - `-webhooks.stripe.test.ts`                     | 46/46                                                  |
| **`bun run test:coverage` (pełny suite + bramka progów)** | **exit 0** - 327 plików / 2851 testów, zero czerwonych |
| Pozostałe niesprawdzane zapisy w obu plikach              | 0 (skan automatyczny)                                  |

Bramka pokrycia przechodzi bez ruszania progów w `vitest.config.ts` - w
szczególności `grant.server.ts` utrzymał wymagane **100% linii i funkcji**
(nowe gałęzie błędów są pokryte), a `webhooks.stripe.ts` swoje progi 90/85/90/75.

Uwaga dla lokalnego uruchamiania: `bun.lock` przypina tarballe do prywatnego
cache'u GAR, nieosiągalnego publicznie. Poza CI trzeba powtórzyć sztuczkę z
`.github/workflows/ci.yml` (przepięcie hosta na `registry.npmjs.org` z
zachowaniem zapiętych wersji) - inaczej część zależności się nie zainstaluje
i suite sypie się na etapie ładowania plików, co łatwo pomylić z regresem.

## Pozostaje otwarte (poza zakresem tego wdrożenia)

- **Kolejność w finalizerze trybu mock.** `finalizeCheckout`
  (`src/lib/billing/checkout.functions.ts:353-367`) flipuje zamówienie na `paid`
  **przed** grantem - odwrotnie niż webhook. Po tej zmianie nieudany grant jest
  tam widoczny (server fn rzuca, klient widzi błąd), ale ponowna próba trafi w
  `.neq("status","paid")`, zaktualizuje zero wierszy i zwróci
  `alreadyFinalized: true` - czyli grant nie zostanie powtórzony. To ten sam
  wzorzec, który webhook już naprawił. Ryzyko jest ograniczone do trybu mock
  (`mockCheckoutAllowed()` odmawia w produkcji), dlatego nie zmieniam tego przy
  okazji - warto to zrobić osobno, razem z testem ponowienia.
- Ustalenia §3-§9 audytu (m.in. cichy no-op zapisu w „Powiązanych wpisach"
  i zakres `dompurify`) - nietknięte.
