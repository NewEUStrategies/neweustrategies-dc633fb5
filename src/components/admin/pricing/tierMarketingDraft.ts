// Szkic marketingu warstwy w cenniku - pola, kolumny i patch (S1 def. 11, V25).
//
// DLACZEGO OSOBNO OD `lib/admin/pricingDrafts.ts`. Tamten szkic (badge,
// segment, CTA, benefity) powstał, gdy nazwy i opisy warstwy edytowało
// Członkostwo. Od S1 właścicielem `name_*` i `description_*` jest cennik
// (`TIER_MARKETING_COLUMNS` = `syncManifest.ts`), a Członkostwo pokazuje je
// tylko do odczytu - więc szkic cennika dostaje cztery pola więcej. Rozszerzamy
// go tutaj, bo `pricingDrafts.ts` leży poza manifestem wycinka S1.
//
// PATCH = RÓŻNICA. Zapis wysyła WYŁĄCZNIE kolumny, które redakcja zmieniła
// względem wiersza, na którym zaczęła edycję (ta sama normalizacja po obu
// stronach, więc `null` w bazie i puste pole to ta sama wartość). Dawny zapis
// odsyłał cały marketing - w tym `benefits` przepuszczone przez
// `serializeTierBenefits`, który gubi pola spoza znanego kształtu - przy każdej
// zmianie samego badge'a.
import type { MembershipTierRow } from "@/lib/billing/tiers";
import { serializeTierBenefits } from "@/lib/billing/tiers";
import type { TierMarketingPatch } from "@/lib/billing/tierMutations";
import { NO_AUDIENCE, draftFromTier, type TierMarketingDraft } from "@/lib/admin/pricingDrafts";

export interface TierMarketingEditorDraft extends TierMarketingDraft {
  name_pl: string;
  name_en: string;
  description_pl: string;
  description_en: string;
}

export function marketingDraftFromTier(tier: MembershipTierRow): TierMarketingEditorDraft {
  return {
    ...draftFromTier(tier),
    name_pl: tier.name_pl,
    name_en: tier.name_en,
    description_pl: tier.description_pl ?? "",
    description_en: tier.description_en ?? "",
  };
}

/** Nazwa warstwy jest obowiązkowa w OBU językach - karta cennika ma dwie wersje. */
export function marketingDraftValid(draft: TierMarketingEditorDraft): boolean {
  return draft.name_pl.trim().length > 0 && draft.name_en.trim().length > 0;
}

/** Szkic → wszystkie kolumny marketingu (znormalizowane jak przy zapisie). */
export function marketingColumns(draft: TierMarketingEditorDraft): Required<TierMarketingPatch> {
  return {
    name_pl: draft.name_pl.trim(),
    name_en: draft.name_en.trim(),
    description_pl: draft.description_pl.trim() || null,
    description_en: draft.description_en.trim() || null,
    audience_key: draft.audience_key === NO_AUDIENCE ? null : draft.audience_key,
    badge_pl: draft.badge_pl.trim() || null,
    badge_en: draft.badge_en.trim() || null,
    highlight: draft.highlight,
    pricing_visible: draft.pricing_visible,
    contact_url: draft.contact_url.trim() || null,
    cta_mode: draft.cta_mode,
    per_seat: draft.per_seat,
    price_note_pl: draft.price_note_pl.trim() || null,
    price_note_en: draft.price_note_en.trim() || null,
    benefits: serializeTierBenefits(draft.benefits),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Kolumny, w których szkic różni się od wiersza bazowego. */
export function marketingPatch(
  draft: TierMarketingEditorDraft,
  base: MembershipTierRow,
): TierMarketingPatch {
  const next = marketingColumns(draft);
  const prev = marketingColumns(marketingDraftFromTier(base));
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (!same(next[key], prev[key])) patch[key] = next[key];
  }
  return patch as TierMarketingPatch;
}

/**
 * Szkic po konflikcie: pola zmienione przez redakcję względem STAREJ bazy
 * wygrywają, reszta przychodzi ze świeżego wiersza (cudza zmiana).
 */
export function rebaseMarketingDraft(
  draft: TierMarketingEditorDraft,
  oldBase: MembershipTierRow,
  freshBase: MembershipTierRow,
): TierMarketingEditorDraft {
  const before = marketingDraftFromTier(oldBase);
  const out: TierMarketingEditorDraft = marketingDraftFromTier(freshBase);
  for (const key of Object.keys(draft) as (keyof TierMarketingEditorDraft)[]) {
    if (!same(draft[key], before[key])) Object.assign(out, { [key]: draft[key] });
  }
  return out;
}
