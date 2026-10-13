// Stan dokumentu rozliczeniowego (`billing_documents.status`) - jedno źródło
// prawdy po stronie TS i jedyne tłumaczenie stanu operatora na stan rejestru.
//
// PRZYCZYNA. Kolumna ma `CHECK (status IN ('paid', 'open', 'void',
// 'refunded'))`, a zapis przepisywał stan operatora DOSŁOWNIE, z domyślnym
// `pending`. Sesja Checkout (bilet, darowizna, odblokowanie treści) nie niosła
// stanu wcale, więc KAŻDY zakup jednorazowy rozbijał się na CHECK-u (23514),
// a błąd był logowany jako „wyścig" i pomijany - członek nie dostawał dokumentu,
// choć rejestr RODO deklaruje, że faktury „żyją w billing_documents".
//
// Stąd dwa kontrakty tego modułu:
//  1. `BILLING_DOCUMENT_STATUSES` = zbiór z CHECK-a migracji. Pilnuje tego test
//     parytetu (`billingDocumentsDbCheck.test.ts`, czyta migracje), a zgodność
//     z typem `BillingDocumentStatus` - kompilator.
//  2. `billingDocumentStatus` zna KAŻDY słownik, który dochodzi do zapisu
//     (faktura Stripe, sesja Checkout, słownik domenowy dyspozytora), i dla
//     stanu nieznanego zwraca `null` - wołający decyduje, co to znaczy (nowy
//     dokument: `open`, istniejący: bez zmiany), zamiast zgadywać tutaj.
//  3. `billingDocumentStatusTransition` - stan dokumentu idzie TYLKO DO PRZODU
//     (open -> paid -> refunded; void i refunded końcowe). Webhooki przychodzą
//     z opóźnieniem, poza kolejnością i bywają ponawiane (nieudany zapis
//     rejestru oddaje 500): spóźnione `invoice.payment_failed` po `paid` albo
//     powtórka zakończenia transakcji po zwrocie nie mogą cofnąć stanu, który
//     drukuje kopia PDF członka.
import type { BillingDocumentStatus } from "@/lib/billing/types";

/** Zbiór z `CHECK (status IN (...))` tabeli `billing_documents`, w tej samej kolejności. */
export const BILLING_DOCUMENT_STATUSES = [
  "paid",
  "open",
  "void",
  "refunded",
] as const satisfies readonly BillingDocumentStatus[];

const PROVIDER_STATUS = new Map<string, BillingDocumentStatus>([
  // Faktura Stripe (`invoice.status`).
  ["paid", "paid"],
  ["open", "open"],
  ["draft", "open"],
  // Faktura spisana jako nieściągalna wciąż PRZYJMUJE zapłatę u operatora -
  // `void` twierdziłby, że dokument anulowano, a tak nie jest.
  ["uncollectible", "open"],
  ["void", "void"],
  // Sesja Checkout (`payment_status`): zakup w pełni pokryty kuponem nie
  // wymaga płatności i jest rozliczony tak samo jak opłacony.
  ["no_payment_required", "paid"],
  ["unpaid", "open"],
  // Zwrot.
  ["refunded", "refunded"],
  // Słownik domenowy dyspozytora (`transaction.completed` / `transaction.past_due`).
  ["completed", "paid"],
  ["past_due", "open"],
]);

/** Stan dokumentu dla stanu operatora; `null` = operator nie powiedział nic, co znamy. */
export function billingDocumentStatus(providerStatus: string | null): BillingDocumentStatus | null {
  if (providerStatus === null) return null;
  return PROVIDER_STATUS.get(providerStatus.trim().toLowerCase()) ?? null;
}

/** Zawężenie wartości z bazy (kolumna `text`, typ generowany to `string`). */
export function isBillingDocumentStatus(value: unknown): value is BillingDocumentStatus {
  return (BILLING_DOCUMENT_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Dozwolone przejścia stanu dokumentu - wyłącznie do przodu. `paid` może
 * tylko zostać zwrócony; `void` i `refunded` są końcowe (zwrot ustawia też
 * trigger bazy przy pełnym zwrocie zamówienia, 20261012122000).
 */
const FORWARD: Readonly<Record<BillingDocumentStatus, readonly BillingDocumentStatus[]>> = {
  open: ["paid", "void", "refunded"],
  paid: ["refunded"],
  void: [],
  refunded: [],
};

/**
 * Stan do zapisania przy aktualizacji istniejącego dokumentu albo `null`,
 * gdy stanu nie zmieniamy (brak informacji, ten sam stan albo krok wstecz).
 * Stan obecny spoza zbioru (uszkodzony wiersz) przyjmuje znany stan operatora.
 */
export function billingDocumentStatusTransition(
  current: string | null,
  incoming: BillingDocumentStatus | null,
): BillingDocumentStatus | null {
  if (incoming === null || incoming === current) return null;
  if (!isBillingDocumentStatus(current)) return incoming;
  return FORWARD[current].includes(incoming) ? incoming : null;
}
