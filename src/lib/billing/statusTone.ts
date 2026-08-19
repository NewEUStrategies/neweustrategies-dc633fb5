// Tonacja wizualna STANU PŁATNOŚCI - jedna dla wszystkich powierzchni.
//
// DEFEKT, KTÓRY TO NAPRAWIA. Ta sama decyzja istniała w TRZECH kopiach, każda
// z INNYM zestawem stanów „czerwonych":
//
//   BillingDocumentsCard   refunded, void
//   OrdersTableCard        failed, refunded, canceled
//   PaymentHistoryCard     failed, refunded, canceled, void
//
// Skutek dla klienta: ta sama płatność miała RÓŻNY kolor w zależności od tego,
// na którą kartę patrzył. Nieudana płatność (`failed`) świeciła się na czerwono
// w historii, a w dokumentach wyglądała neutralnie; anulowany dokument (`void`)
// odwrotnie - czerwony w dokumentach, neutralny w tabeli zamówień. Klient nie ma
// jak zgadnąć, która karta mówi prawdę, a to strona, na której sprawdza, czy
// zapłacił.
//
// Zestaw jest teraz SUMĄ trzech kopii, czyli najostrożniejszym z nich: każdy
// stan, który w którymkolwiek miejscu znaczył „coś nie poszło", znaczy to
// wszędzie. Lepiej pokazać czerwień o jeden stan za dużo niż ukryć nieudaną
// płatność.

export type StatusTone = "default" | "secondary" | "destructive" | "outline";

/** Stany oznaczające ZAKOŃCZONĄ POWODZENIEM płatność. */
const PAID: ReadonlySet<string> = new Set(["paid"]);

/**
 * Stany oznaczające, że pieniądze NIE ZOSTAŁY pobrane albo wróciły do klienta.
 * Suma trzech dawnych kopii - patrz nagłówek.
 */
const FAILED: ReadonlySet<string> = new Set(["failed", "refunded", "canceled", "void"]);

/**
 * Tonacja znacznika stanu płatności. Wszystko poza opłaconym i nieudanym
 * (`pending`, `processing`, `draft`, `open`...) jest neutralne - to stan
 * przejściowy, nie problem.
 */
export function paymentStatusTone(status: string): StatusTone {
  if (PAID.has(status)) return "default";
  if (FAILED.has(status)) return "destructive";
  return "secondary";
}

/** Czy stan oznacza, że coś nie poszło - do decyzji „czy pokazać ostrzeżenie". */
export function isFailedPaymentStatus(status: string): boolean {
  return FAILED.has(status);
}
