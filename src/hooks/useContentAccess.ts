// Shared access-control types + money formatter. The former `useContentAccess`
// hook (and its AccessState) lived here too but were consumed only by the
// removed MediaPreviewDialog; content gating now flows through the server-side
// get_entity_content RPC (see lib/access), so the client hook was dead and was
// removed. The type exports and formatMoney below remain widely used.
export type AccessEntityType = "post" | "page" | "media";
export type AccessMode = "public" | "members" | "paid" | "password";

export interface ContentAccessRule {
  id: string;
  entity_type: AccessEntityType;
  entity_id: string;
  mode: AccessMode;
  plan_ids: string[];
  one_time_price_cents: number | null;
  one_time_currency: string | null;
  teaser_pl: string | null;
  teaser_en: string | null;
  /** Udział w meteringu paywalla: inherit (globalne ustawienia) / metered / exempt. */
  metering_policy?: string | null;
  /** Presence flag only. The hash itself is never selectable client-side (column privilege revoked). */
  has_password?: boolean;
  password_hint_pl?: string | null;
  password_hint_en?: string | null;
}

export interface AccessPlan {
  id: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
  price_cents: number;
  currency: string;
  interval: "month" | "year" | "one_time";
  active: boolean;
  sort_order: number;
  features_pl: string[];
  features_en: string[];
  badge_pl: string | null;
  badge_en: string | null;
  highlighted: boolean;
  trial_days: number;
}

export function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
