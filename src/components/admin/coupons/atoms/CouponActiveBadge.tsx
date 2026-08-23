// Atom: plakietka „aktywny / nieaktywny" kuponu.
//
// Kolor niesie znaczenie: zielony wyłącznie dla kuponu, który NAPRAWDĘ da się
// dziś zrealizować. Napisy wchodzą propem, żeby atom nie znał ani i18next, ani
// przestrzeni kluczy panelu.
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface CouponActiveBadgeProps {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}

export function CouponActiveBadge({ active, activeLabel, inactiveLabel }: CouponActiveBadgeProps) {
  if (!active) return <Badge variant="secondary">{inactiveLabel}</Badge>;
  return (
    <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10">
      <Check className="h-3 w-3 mr-1" />
      {activeLabel}
    </Badge>
  );
}
