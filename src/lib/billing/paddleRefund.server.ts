// Zwroty inicjowane przez system (nie przez operatora w panelu).
//
// Jedyny obecny przypadek: bilet opłacony w chwili, gdy ostatnie miejsce
// zajął ktoś inny. Zamiast sprzedać nieistniejące wejście, zwracamy pełną
// kwotę od razu przy realizacji zamówienia. Skutki uprawnień obsługuje
// webhook `adjustment.*` - tutaj tylko zlecamy korektę u operatora.
import { gatewayFetch, type StripeEnv } from "@/lib/paddle.server";

export type RefundResult = { ok: true; adjustmentId: string | null } | { ok: false; error: string };

/** Dozwolone przez operatora powody korekty. */
export type RefundReason = "oversold" | "duplicate" | "error";

const REASON_TEXT: Record<RefundReason, string> = {
  oversold: "Event sold out before payment was fulfilled",
  duplicate: "Duplicate payment",
  error: "Fulfilment error",
};

/**
 * Pełny zwrot transakcji. Zwraca `ok: false` zamiast rzucać - wywołujący
 * decyduje, czy zablokować realizację, czy tylko zalogować problem.
 */
export async function refundTransactionFully(
  env: StripeEnv,
  transactionId: string,
  reason: RefundReason,
): Promise<RefundResult> {
  try {
    const res = await gatewayFetch(env, "/adjustments", {
      method: "POST",
      body: JSON.stringify({
        action: "refund",
        transaction_id: transactionId,
        type: "full",
        reason: REASON_TEXT[reason],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status}: ${text.slice(0, 300)}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: { id?: string } } | null;
    return { ok: true, adjustmentId: json?.data?.id ?? null };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
