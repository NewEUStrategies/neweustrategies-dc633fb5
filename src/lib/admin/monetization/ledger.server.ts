// Rejestr monetyzacji - warstwa danych (server-only, klucz serwisowy).
//
// IZOLACJA NAJEMCY. Wszystkie trzy zapytania są twardo zawężone do `tenant_id`
// podanego przez WOŁAJĄCEGO SERWEROWEGO - a ten bierze go z bramki
// `assertAdmin`, czyli z profilu administratora, nie z ładunku i nie z hosta.
//
// Wcześniej moduł rozstrzygał najemcę sam, z hosta żądania. To była DRUGA
// granica obok tej, po której autoryzowała się rola: admin obszaru A na
// domenie obszaru B przechodził bramkę w A i dostawał pełny rejestr B
// (nadania, linki podarunkowe, adresy darczyńców). Host może być wyłącznie
// kontrolą spójności (`assertCallerTenantMatchesHost`), nigdy źródłem zakresu.
// Pusty najemca = pusty rejestr (nigdy „wszystko").
//
// FILTR ŚRODOWISKA jest domenowy i mieszka w `model.ts`; tutaj tylko go
// stosujemy, żeby ta sama reguła obowiązywała w teście jednostkowym i na
// produkcji.
import {
  filterLedger,
  normalizeEnvironment,
  summarizeLedger,
  type DonationLedgerRow,
  type EnvironmentFilter,
  type GiftLinkLedgerRow,
  type GrantLedgerRow,
  type MonetizationLedger,
  type MonetizationSummary,
} from "@/lib/admin/monetization/model";

export interface MonetizationLedgerResult extends MonetizationLedger {
  environment: EnvironmentFilter;
  summary: MonetizationSummary;
  /** `false` gdy wołający nie ma rozstrzygniętego najemcy - panel mówi to wprost. */
  tenantResolved: boolean;
}

const MAX_LIMIT = 200;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

export const EMPTY_LEDGER: MonetizationLedger = { donations: [], grants: [], giftLinks: [] };

export async function loadMonetizationLedger(input: {
  environment: EnvironmentFilter;
  limit: number;
  /** WYMAGANY - z bramki `assertAdmin` (profil wołającego), nigdy z ładunku. */
  tenantId: string;
}): Promise<MonetizationLedgerResult> {
  const now = new Date();
  const tenantId = input.tenantId;
  // Bezpiecznik: pusta wartość NIGDY nie ma znaczyć „wszyscy najemcy".
  if (!tenantId) {
    return {
      ...EMPTY_LEDGER,
      environment: input.environment,
      summary: summarizeLedger(EMPTY_LEDGER, now),
      tenantResolved: false,
    };
  }

  const limit = clampLimit(input.limit);
  const supabase = await admin();

  const [donationsRes, grantsRes, linksRes] = await Promise.all([
    supabase
      .from("donations")
      .select(
        "id,amount_cents,currency,status,recurring,donor_email,environment,created_at,paid_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("membership_grants")
      .select(
        "id,user_id,tier_key,source,note,source_donation_id,starts_at,expires_at,revoked_at,created_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("post_gift_links")
      .select("id,code,post_id,created_at,expires_at,revoked_at,redemption_count,max_redemptions")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (donationsRes.error) throw new Error(donationsRes.error.message);
  if (grantsRes.error) throw new Error(grantsRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);

  const donations: DonationLedgerRow[] = (donationsRes.data ?? []).map((row) => ({
    id: row.id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    recurring: row.recurring,
    donorEmail: row.donor_email,
    environment: normalizeEnvironment(row.environment),
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }));

  const grants: GrantLedgerRow[] = (grantsRes.data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    tierKey: row.tier_key,
    source: row.source,
    note: row.note,
    sourceDonationId: row.source_donation_id,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }));

  const giftLinks: GiftLinkLedgerRow[] = (linksRes.data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    postId: row.post_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    redemptionCount: row.redemption_count,
    maxRedemptions: row.max_redemptions,
  }));

  const filtered = filterLedger({ donations, grants, giftLinks }, input.environment);
  return {
    ...filtered,
    environment: input.environment,
    summary: summarizeLedger(filtered, now),
    tenantResolved: true,
  };
}
