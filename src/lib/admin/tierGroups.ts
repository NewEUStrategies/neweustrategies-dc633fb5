// Grupowanie warstw członkostwa po segmencie odbiorców.
//
// Reguła z konsekwencją dla oferty: warstwa wskazująca segment, którego NIE MA
// w katalogu (skasowany, przepisany ręcznie w SQL, literówka w kluczu), nie
// znika - trafia do koszyka „nieprzypisane". Panel musi ją pokazać, bo na
// stronie publicznej taka warstwa nie wyświetli się w żadnej zakładce, czyli
// klient jej nie kupi, a redakcja nie ma skąd o tym wiedzieć.
//
// Kolejność wewnątrz grupy pochodzi z `sortTiers` - tej samej funkcji, której
// używa strona publiczna, żeby panel nie pokazywał innej hierarchii niż klient.
import type { MembershipTierRow } from "@/lib/billing/tiers";
import { sortTiers } from "@/lib/pricing/selectors";

export interface TierGroups {
  /** Warstwy per klucz segmentu, w kolejności prezentacyjnej. */
  byAudience: Map<string, MembershipTierRow[]>;
  /** Warstwy bez segmentu albo wskazujące segment nieistniejący w katalogu. */
  unassigned: MembershipTierRow[];
}

export function groupTiersByAudience(
  tiers: MembershipTierRow[],
  knownKeys: ReadonlySet<string>,
): TierGroups {
  const byAudience = new Map<string, MembershipTierRow[]>();
  const unassigned: MembershipTierRow[] = [];
  for (const tier of sortTiers(tiers)) {
    if (tier.audience_key && knownKeys.has(tier.audience_key)) {
      const list = byAudience.get(tier.audience_key);
      if (list) list.push(tier);
      else byAudience.set(tier.audience_key, [tier]);
    } else {
      unassigned.push(tier);
    }
  }
  return { byAudience, unassigned };
}
