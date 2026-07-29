// Most między subskrypcją planu Zespół (rozliczaną ZA MIEJSCE) a organizacją
// członkowską. Wywoływane wyłącznie z zaufanego serwera (webhook operatora),
// dlatego korzysta z klienta serwisowego i funkcji definera
// `org_apply_subscription_seats`, która sama dopasowuje miejsca do limitu.
//
// Reguła: liczba opłaconych miejsc jest jedynym źródłem prawdy o limicie,
// a stan subskrypcji (aktywna / wstrzymana / anulowana) steruje tym, czy
// organizacja w ogóle nadaje uprawnienia.
import { catalogEntryByPriceId } from "@/lib/billing/paddleCatalog";

export interface SeatsSyncResult {
  linked: boolean;
  orgId?: string;
  seatsLimit?: number;
  active?: number;
  suspended?: number;
}

function readSyncResult(value: unknown): SeatsSyncResult {
  if (!value || typeof value !== "object") return { linked: false };
  const row = value as Record<string, unknown>;
  if (row.linked !== true) return { linked: false };
  return {
    linked: true,
    orgId: typeof row.org_id === "string" ? row.org_id : undefined,
    seatsLimit: typeof row.seats_limit === "number" ? row.seats_limit : undefined,
    active: typeof row.active === "number" ? row.active : undefined,
    suspended: typeof row.suspended === "number" ? row.suspended : undefined,
  };
}

/** Czy dana cena to plan rozliczany za miejsce (Zespół). */
export function isPerSeatPrice(priceId: string | null | undefined): boolean {
  return catalogEntryByPriceId(priceId)?.perSeat === true;
}

/**
 * Liczba opłaconych miejsc -> limit organizacji + dopasowanie uprawnień.
 * Bezpieczne dla subskrypcji bez organizacji (zwraca `linked: false`).
 */
export async function applySubscriptionSeats(input: {
  subscriptionId: string;
  quantity: number;
  priceId: string | null;
}): Promise<SeatsSyncResult> {
  if (!isPerSeatPrice(input.priceId)) return { linked: false };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("org_apply_subscription_seats", {
    p_subscription_id: input.subscriptionId,
    p_quantity: Math.max(1, Math.min(500, Math.trunc(input.quantity || 1))),
  });
  if (error) {
    console.error("[orgs] seats sync failed", input.subscriptionId, error.message);
    return { linked: false };
  }
  return readSyncResult(data);
}

/**
 * Stan subskrypcji -> stan organizacji. Wstrzymanie/anulowanie odbiera
 * uprawnienia CAŁEMU zespołowi (mo.status decyduje w current_membership_tier),
 * a wznowienie je przywraca - bez ruszania listy miejsc.
 */
export async function applySubscriptionOrgState(input: {
  subscriptionId: string;
  status: string;
  priceId: string | null;
}): Promise<{ changed: boolean }> {
  if (!isPerSeatPrice(input.priceId)) return { changed: false };
  const entitled = input.status === "active" || input.status === "trialing";

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("member_organizations")
    .update({ status: entitled ? "active" : "suspended", updated_at: new Date().toISOString() })
    .eq("paddle_subscription_id", input.subscriptionId)
    .select("id");
  if (error) {
    console.error("[orgs] org state sync failed", input.subscriptionId, error.message);
    return { changed: false };
  }
  return { changed: (data ?? []).length > 0 };
}
