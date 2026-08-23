// Atom: kolumna „Subskrypcja" w tabeli kampanii - warstwa + liczba dni.
//
// CO BYŁO W TRASIE. `admin.coupons.campaigns.tsx` (dawne 259-268):
//   {c.grants_tier_key ? (
//     <Badge variant="outline">{c.grants_tier_key}{c.grants_duration_days && ` · ${c.grants_duration_days}d`}</Badge>
//   ) : (<span className="text-muted-foreground">—</span>)}
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI:
//   * plakietka pokazuje SUROWY klucz warstwy („gold"), a nie jej nazwę -
//     ta sama lista, z której operator wybierał, ma etykiety lokalizowane;
//   * `{liczba && ...}` przy liczbie 0 renderuje w Reakcie ZERO, więc kampania
//     z `grants_duration_days = 0` wypisuje „gold0" zamiast samego „gold".
// Oba są zgłoszone przez `it.fails`; atom nie zmienia zachowania.
import { Badge } from "@/components/ui/badge";

export function CampaignTierBadge({
  tierKey,
  durationDays,
}: {
  tierKey: string | null;
  durationDays: number | null;
}) {
  if (!tierKey) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline">
      {tierKey}
      {durationDays && ` · ${durationDays}d`}
    </Badge>
  );
}
