// Atomy testowe PANELI REDAKCYJNYCH monetyzacji (`/admin/pricing`,
// `/admin/membership`) - atomic design zastosowany do testów, jak w
// `src/test/billing/fixtures.ts`.
//
// DLACZEGO TO ISTNIEJE. Audyt 18.08 dał tym panelom 0% pokrycia przy 1821 i 898
// liniach w dwóch plikach tras. To panele, w których redakcja definiuje, CO
// klient widzi na stronie cennika i CO dostaje po zakupie: nazwy segmentów,
// przypisanie warstw, mapowanie planu na warstwę, bramki dostępu, kontrofertę
// dla odchodzących. Błąd tutaj nie wywala aplikacji - po cichu zmienia ofertę.
//
// Wiersze są SYNTETYCZNE: żadnych prawdziwych nazw klientów, NIP-ów ani kwot.
//
// Świadomie BEZ JSX i bez importu komponentów: moduł bywa wciągany z wnętrza
// fabryk `vi.mock`, więc musi być tani i wolny od side-effectów.
import type { MembershipTierRow } from "@/lib/billing/tiers";
import type { PricingAudienceRow, PricingFaqItemRow } from "@/lib/pricing/queries";
import type { RetentionFeedbackRow } from "@/lib/retention/queries";

export {
  fail,
  ok,
  okCount,
  pgError,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/supabaseChain";
export {
  pendingQueryStub,
  queryStub,
  radixSelectStub,
  radixSwitchStub,
  radixTabsStub,
  reactI18nextStub,
  translateKey,
} from "@/test/reactStubs";

export const ADMIN_IDS = {
  tenant: "tenant-test",
  audience: "aud-individual",
  tier: "tier-member",
  faq: "faq-cancel",
} as const;

/** Punkt odniesienia czasu - ten sam, co w atomach rozliczeniowych. */
export const ADMIN_NOW = Date.parse("2026-08-18T10:00:00.000Z");

export const isoDaysAgo = (days: number): string =>
  new Date(ADMIN_NOW - days * 86_400_000).toISOString();

/** Segment odbiorców cennika (`pricing_audiences`). */
export function pricingAudience(overrides: Partial<PricingAudienceRow> = {}): PricingAudienceRow {
  return {
    id: ADMIN_IDS.audience,
    tenant_id: ADMIN_IDS.tenant,
    key: "individual",
    name_pl: "Osoba prywatna",
    name_en: "Individual",
    tagline_pl: "Dla czytających codziennie",
    tagline_en: "For daily readers",
    trust_pl: null,
    trust_en: null,
    icon: "user",
    active: true,
    sort_order: 0,
    created_at: isoDaysAgo(30),
    updated_at: isoDaysAgo(1),
    ...overrides,
  } as PricingAudienceRow;
}

/** Warstwa członkostwa (`membership_tiers`) - katalog i marketing w jednym wierszu. */
export function membershipTier(overrides: Partial<MembershipTierRow> = {}): MembershipTierRow {
  return {
    id: ADMIN_IDS.tier,
    tenant_id: ADMIN_IDS.tenant,
    key: "member",
    name_pl: "Członek",
    name_en: "Member",
    description_pl: null,
    description_en: null,
    rank: 10,
    benefits: [{ pl: "Poranny briefing", en: "Morning briefing" }],
    features: { briefings: true },
    active: true,
    is_default: false,
    audience_key: "individual",
    badge_pl: null,
    badge_en: null,
    highlight: false,
    contact_url: null,
    cta_mode: "auto",
    per_seat: false,
    price_note_pl: null,
    price_note_en: null,
    created_at: isoDaysAgo(30),
    updated_at: isoDaysAgo(1),
    ...overrides,
  } as MembershipTierRow;
}

/** Pytanie FAQ cennika (`pricing_faq_items`). */
export function pricingFaqItem(overrides: Partial<PricingFaqItemRow> = {}): PricingFaqItemRow {
  return {
    id: ADMIN_IDS.faq,
    tenant_id: ADMIN_IDS.tenant,
    audience_key: null,
    question_pl: "Czy mogę zrezygnować w każdej chwili?",
    question_en: "Can I cancel at any time?",
    answer_pl: "Tak, subskrypcja działa do końca opłaconego okresu.",
    answer_en: "Yes, access runs until the end of the paid period.",
    sort_order: 0,
    active: true,
    created_at: isoDaysAgo(30),
    updated_at: isoDaysAgo(1),
    ...overrides,
  } as PricingFaqItemRow;
}

/** Odpowiedź odchodzącego klienta (`retention_feedback`). */
export function retentionFeedback(
  overrides: Partial<RetentionFeedbackRow> = {},
): RetentionFeedbackRow {
  return {
    id: "fb-1",
    tenant_id: ADMIN_IDS.tenant,
    user_id: "user-synthetic",
    subscription_id: null,
    reason_code: "price",
    reason_label: "Za drogo",
    comment: null,
    offer_shown: true,
    offer_accepted: false,
    coupon_code: null,
    created_at: isoDaysAgo(2),
    ...overrides,
  } as RetentionFeedbackRow;
}
