// Szkic edycyjny warstwy członkostwa i reguła surowego JSON-a możliwości.
//
// `features` to bramki maszynowe: to one decydują, co zalogowany członek może
// zrobić w serwisie. Panel pozwala edytować je zarówno przełącznikami, jak i
// jako surowy JSON, więc walidacja tego tekstu jest jedyną barierą między
// literówką redakcji a warstwą, która nie otwiera nic - dlatego jest regułą
// z własnym typem błędu, a nie `try/catch` schowanym w komponencie.
//
// Wyniesione z pliku trasy `/admin/membership` (898 linii).
import type { Json } from "@/integrations/supabase/types";
import { parseTierBenefits, type MembershipTierRow, type TierBenefit } from "@/lib/billing/tiers";

export interface TierDraft {
  name_pl: string;
  name_en: string;
  description_pl: string;
  description_en: string;
  rank: number;
  benefits: TierBenefit[];
  features: string;
  active: boolean;
  is_default: boolean;
}

export function draftFromTier(tier: MembershipTierRow): TierDraft {
  return {
    name_pl: tier.name_pl,
    name_en: tier.name_en,
    description_pl: tier.description_pl ?? "",
    description_en: tier.description_en ?? "",
    rank: tier.rank,
    benefits: parseTierBenefits(tier.benefits),
    features: JSON.stringify(tier.features ?? {}, null, 0),
    active: tier.active,
    is_default: tier.is_default,
  };
}

/** Rzucany, gdy pole „surowy JSON" nie da się sparsować - zapis się nie odbywa. */
export class InvalidFeaturesJsonError extends Error {
  constructor() {
    super("invalid_features_json");
    this.name = "InvalidFeaturesJsonError";
  }
}

/**
 * Tekst z pola „możliwości" na `Json` do zapisu. Puste pole to `{}` (warstwa
 * bez dodatkowych bramek), a tekst niepoprawny składniowo PRZERYWA zapis -
 * warstwa z połamanymi bramkami nie otwiera nic, za co klient zapłacił.
 */
export function parseFeaturesJson(raw: string): Json {
  try {
    return JSON.parse(raw || "{}") as Json;
  } catch {
    throw new InvalidFeaturesJsonError();
  }
}
