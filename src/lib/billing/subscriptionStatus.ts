// Czytelny status subskrypcji dla użytkownika.
//
// Surowe statusy operatora (`active`, `trialing`, `past_due`, `paused`,
// `canceled`, `incomplete`) i lokalna tabela `user_subscriptions` opisują ten
// sam byt z dwóch stron. Ten moduł sprowadza je do JEDNEGO słownika stanów,
// który da się pokazać człowiekowi: aktywna / okres próbny / w trakcie zmiany
// (anulowanie zaplanowane) / zaległość / wstrzymana / anulowana.
//
// Świadomie bez zależności od Reacta i i18n - klucz stanu tłumaczy warstwa UI,
// a logika jest testowalna czysto.
import type { UserSubscriptionRow } from "./types";
import type { StripeSubscriptionRow } from "./subscriptionQueries";

export type SubscriptionStatusKey =
  | "active"
  | "trialing"
  | "cancelScheduled"
  | "pastDue"
  | "paused"
  | "canceled"
  | "grantLifetime"
  | "grantActive"
  | "none";

export type SubscriptionTone = "success" | "info" | "warning" | "danger" | "muted";

/**
 * Dostęp przyznany poza subskrypcją (membership_grants). Eksperci New European
 * Strategies mają dożywotni VIP - bez tego wejścia status pokazywałby „brak
 * subskrypcji", mimo że użytkownik ma pełne prawa.
 */
export interface AccessGrantInput {
  tierKey: string;
  expiresAt: string | null;
  source: string;
}

export interface SubscriptionStatusView {
  key: SubscriptionStatusKey;
  tone: SubscriptionTone;
  /** Data kolejnego odnowienia - tylko gdy subskrypcja faktycznie się odnowi. */
  renewsAt: string | null;
  /** Data wygaśnięcia dostępu - gdy odnowienia już nie będzie. */
  endsAt: string | null;
  /** Czy dostęp nadal przysługuje (opłacony okres trwa). */
  hasAccess: boolean;
  /** Nadanie, z którego wynika dostęp - gdy nie ma płatnej subskrypcji. */
  grant: AccessGrantInput | null;
}

const TONES: Record<SubscriptionStatusKey, SubscriptionTone> = {
  active: "success",
  trialing: "info",
  cancelScheduled: "warning",
  pastDue: "danger",
  paused: "warning",
  canceled: "muted",
  grantLifetime: "success",
  grantActive: "success",
  none: "muted",
};

function isFuture(iso: string | null, now: number): boolean {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) && ts > now;
}

/**
 * Łączy stan lokalny z operatorskim. Operator jest źródłem prawdy dla statusu
 * i zaplanowanego anulowania; lokalny wiersz uzupełnia braki, gdy webhook
 * jeszcze nie dowiózł subskrypcji (albo gdy dostęp pochodzi z zakupu bez
 * odwzorowania w tabeli `subscriptions`).
 */
export function deriveSubscriptionStatus(input: {
  local: UserSubscriptionRow | null;
  provider: StripeSubscriptionRow | null;
  /** Aktywne nadania (np. dożywotni VIP eksperta). */
  grants?: AccessGrantInput[];
  now?: number;
}): SubscriptionStatusView {
  const now = input.now ?? Date.now();
  const provider = input.provider;
  const local = input.local;

  const periodEnd = provider?.current_period_end ?? local?.current_period_end ?? null;
  const withinPeriod = isFuture(periodEnd, now);

  const build = (
    key: SubscriptionStatusKey,
    renews: boolean,
    access: boolean,
  ): SubscriptionStatusView => ({
    key,
    tone: TONES[key],
    renewsAt: renews ? periodEnd : null,
    endsAt: renews ? null : periodEnd,
    hasAccess: access,
    grant: null,
  });

  // Dostęp z nadania jest ważniejszy niż „brak subskrypcji" - pokazujemy go
  // zamiast pustego stanu, a przy dożywotnim VIP nie ma daty wygaśnięcia.
  const activeGrants = (input.grants ?? []).filter(
    (g) => !g.expiresAt || isFuture(g.expiresAt, now),
  );
  const lifetime = activeGrants.find((g) => !g.expiresAt) ?? null;
  const grant = lifetime ?? activeGrants[0] ?? null;

  const buildGrant = (): SubscriptionStatusView => ({
    key: grant?.expiresAt ? "grantActive" : "grantLifetime",
    tone: "success",
    renewsAt: null,
    endsAt: grant?.expiresAt ?? null,
    hasAccess: true,
    grant,
  });

  if (provider) {
    if (provider.status === "paused")
      return grant ? buildGrant() : build("paused", false, withinPeriod);
    if (provider.status === "canceled")
      return grant && !withinPeriod ? buildGrant() : build("canceled", false, withinPeriod);
    if (provider.cancel_at_period_end) return build("cancelScheduled", false, withinPeriod);
    if (provider.status === "past_due" || provider.status === "unpaid")
      return build("pastDue", true, withinPeriod);
    if (provider.status === "trialing") return build("trialing", true, true);
    if (provider.status === "active") return build("active", true, true);
  }

  if (!local) return grant ? buildGrant() : build("none", false, false);
  if (local.status === "canceled" || local.canceled_at)
    return grant && !withinPeriod ? buildGrant() : build("cancelScheduled", false, withinPeriod);
  if (local.status === "expired" || local.status === "refunded")
    return grant ? buildGrant() : build("canceled", false, false);
  return build("active", true, withinPeriod || !periodEnd);
}
