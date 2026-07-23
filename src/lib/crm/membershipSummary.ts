// Podsumowanie członkostwa dla leada CRM - czysta logika rozstrzygania,
// lustro RPC current_membership_tier (subskrypcje ∪ nadania ∪ miejsca w
// organizacjach -> najwyższa ranga -> warstwa domyślna). Serwerowa funkcja
// getCrmLeadMembership dostarcza wejścia (dopasowanie lead -> profil po
// e-mailu w obrębie tenanta), a ten moduł liczy wynik - dzięki temu reguła
// jest testowalna jednostkowo i nie może się rozjechać w JSX-ie.
export interface MembershipTierLite {
  key: string;
  rank: number;
  name_pl: string;
  name_en: string;
  is_default: boolean;
}

export interface LeadSubscriptionInput {
  id: string;
  status: string;
  started_at: string;
  current_period_end: string | null;
  canceled_at: string | null;
  plan: {
    id: string;
    name_pl: string;
    name_en: string;
    interval: string;
    tier_key: string | null;
  } | null;
}

export interface LeadGrantInput {
  tier_key: string;
  source: string;
  starts_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface LeadOrgInput {
  claimed_at: string | null;
  org: {
    id: string;
    name: string;
    tier_key: string;
    status: string;
    starts_at: string;
    expires_at: string | null;
  } | null;
}

export type LeadMembershipSource = "subscription" | "grant" | "organization" | "default";

export interface CrmLeadMembershipSummary {
  user_id: string;
  /** Efektywna warstwa (zwycięzca po randze) - null tylko przy pustym katalogu. */
  tier: MembershipTierLite | null;
  source: LeadMembershipSource;
  /** Najnowsza aktywna subskrypcja płatna (niezależnie od zwycięzcy). */
  subscription: LeadSubscriptionInput | null;
  /** Liczba aktywnych nadań poza planem. */
  active_grants: number;
  /** Organizacja z odebranym miejscem (członkostwo korporacyjne). */
  organization: { id: string; name: string; tier_key: string } | null;
}

function isTime(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function startedBefore(now: Date, startsAt: string): boolean {
  return new Date(startsAt).getTime() <= now.getTime();
}

function notExpired(now: Date, expiresAt: string | null): boolean {
  return !isTime(expiresAt) || new Date(expiresAt).getTime() > now.getTime();
}

export function isActiveSubscription(now: Date, sub: LeadSubscriptionInput): boolean {
  return sub.status === "active" && notExpired(now, sub.current_period_end);
}

export function isActiveGrant(now: Date, grant: LeadGrantInput): boolean {
  return (
    grant.revoked_at === null &&
    startedBefore(now, grant.starts_at) &&
    notExpired(now, grant.expires_at)
  );
}

export function isActiveOrgSeat(now: Date, seat: LeadOrgInput): boolean {
  return (
    isTime(seat.claimed_at) &&
    !!seat.org &&
    seat.org.status === "active" &&
    startedBefore(now, seat.org.starts_at) &&
    notExpired(now, seat.org.expires_at)
  );
}

/**
 * Rozstrzyga efektywną warstwę użytkownika dopasowanego do leada. Zwycięża
 * najwyższa ranga spośród aktywnych źródeł; bez źródeł wygrywa warstwa
 * domyślna tenantu (source 'default').
 */
export function resolveLeadMembership(input: {
  now: Date;
  userId: string;
  tiers: MembershipTierLite[];
  subscriptions: LeadSubscriptionInput[];
  grants: LeadGrantInput[];
  orgSeats: LeadOrgInput[];
}): CrmLeadMembershipSummary {
  const { now, userId, tiers, subscriptions, grants, orgSeats } = input;
  const tierByKey = new Map(tiers.map((tier) => [tier.key, tier]));

  const candidates: Array<{ tier: MembershipTierLite; source: LeadMembershipSource }> = [];

  for (const sub of subscriptions) {
    const tier = sub.plan?.tier_key ? tierByKey.get(sub.plan.tier_key) : undefined;
    if (tier && isActiveSubscription(now, sub)) candidates.push({ tier, source: "subscription" });
  }
  for (const grant of grants) {
    const tier = tierByKey.get(grant.tier_key);
    if (tier && isActiveGrant(now, grant)) candidates.push({ tier, source: "grant" });
  }
  for (const seat of orgSeats) {
    const tier = seat.org ? tierByKey.get(seat.org.tier_key) : undefined;
    if (tier && isActiveOrgSeat(now, seat)) candidates.push({ tier, source: "organization" });
  }

  let winner: { tier: MembershipTierLite; source: LeadMembershipSource } | null = null;
  for (const candidate of candidates) {
    if (!winner || candidate.tier.rank > winner.tier.rank) winner = candidate;
  }
  if (!winner) {
    const fallback = tiers.find((tier) => tier.is_default) ?? null;
    winner = fallback ? { tier: fallback, source: "default" } : null;
  }

  const activeSubs = subscriptions
    .filter((sub) => isActiveSubscription(now, sub))
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  const activeOrg = orgSeats.find((seat) => isActiveOrgSeat(now, seat))?.org ?? null;

  return {
    user_id: userId,
    tier: winner?.tier ?? null,
    source: winner?.source ?? "default",
    subscription: activeSubs[0] ?? null,
    active_grants: grants.filter((grant) => isActiveGrant(now, grant)).length,
    organization: activeOrg
      ? { id: activeOrg.id, name: activeOrg.name, tier_key: activeOrg.tier_key }
      : null,
  };
}
