// Odczyt subskrypcji u dostawcy płatności (tabela `subscriptions`) dla
// zalogowanego użytkownika. Zawsze filtrujemy po `environment` - wiersze
// testowe i produkcyjne leżą w jednej tabeli, więc brak filtra pokazałby
// w opublikowanej aplikacji subskrypcję z trybu testowego.
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironmentSafe } from "@/lib/stripe";
import { catalogEntryByPriceId, type CatalogPriceEntry } from "./catalog";

export interface StripeSubscriptionRow {
  id: string;
  provider_subscription_id: string;
  provider_customer_id: string;
  product_id: string;
  price_id: string;
  status: string;
  quantity: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  environment: string;
  created_at: string;
}

const COLUMNS =
  "id, provider_subscription_id, provider_customer_id, product_id, price_id, status, quantity, current_period_start, current_period_end, cancel_at_period_end, environment, created_at";

export async function fetchMyStripeSubscription(): Promise<StripeSubscriptionRow | null> {
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("subscriptions")
    .select(COLUMNS)
    .eq("user_id", uid)
    .eq("environment", getStripeEnvironmentSafe())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as StripeSubscriptionRow | null) ?? null;
}

/** Czy subskrypcja daje dostęp (z okresem karencji po anulowaniu). */
export function isStripeSubscriptionActive(row: StripeSubscriptionRow | null): boolean {
  if (!row) return false;
  const endsAt = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
  const withinPeriod = endsAt === null || endsAt > Date.now();
  if (["active", "trialing", "past_due"].includes(row.status)) return withinPeriod;
  return row.status === "canceled" && endsAt !== null && endsAt > Date.now();
}

/**
 * Czy da się wznowić subskrypcję: cofnąć zaplanowane anulowanie (opłacony
 * okres jeszcze trwa) albo odwiesić subskrypcję wstrzymaną.
 */
export function canResumeStripeSubscription(row: StripeSubscriptionRow | null): boolean {
  if (!row) return false;
  if (row.status === "paused") return true;
  if (!row.cancel_at_period_end) return false;
  const endsAt = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
  return row.status !== "canceled" && (endsAt === null || endsAt > Date.now());
}

export function catalogEntryFor(row: StripeSubscriptionRow | null): CatalogPriceEntry | null {
  return catalogEntryByPriceId(row?.price_id);
}

/** Alias nazewniczy po migracji na Stripe - kształt wiersza bez zmian. */
export type ProviderSubscriptionRow = StripeSubscriptionRow;
