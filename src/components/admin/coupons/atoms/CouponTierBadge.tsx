// Atom: plakietka warstwy członkostwa nadawanej przez kupon + długość nadania.
//
// UWAGA NA ZERO: warunek `durationDays && (...)` jest przeniesiony znak w znak,
// więc dla `0` React wypisze „0" zamiast pominąć fragment. To wada oryginału,
// zgłoszona testem.
//
// Plakietka pokazuje SUROWY klucz warstwy z bazy (`gold`), a nie jej
// lokalizowaną nazwę - tak samo jak przed ekstrakcją.
import { Badge } from "@/components/ui/badge";

interface CouponTierBadgeProps {
  tierKey: string | null;
  durationDays: number | null;
}

export function CouponTierBadge({ tierKey, durationDays }: CouponTierBadgeProps) {
  if (!tierKey) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" className="text-xs">
        {tierKey}
      </Badge>
      {durationDays && <span className="text-muted-foreground">{durationDays}d</span>}
    </span>
  );
}
