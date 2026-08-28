// Molekuła: JEDNA POZYCJA KOSZYKA. Rysuje nazwę, cenę poglądową i dwa
// działania (zapłać, usuń). Nie zna Stripe'a ani magazynu koszyka - wołający
// podaje gotowe napisy i procedury, dzięki czemu tę samą kartę może pokazać
// test i (docelowo) podgląd w panelu.
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function CartLine({
  label,
  price,
  eventLink,
  busy,
  payLabel,
  removeLabel,
  onPay,
  onRemove,
}: {
  label: string;
  price: string;
  /** `<Link>` do strony wydarzenia - slot, bo trasa jest sprawą wołającego. */
  eventLink: ReactNode;
  busy: boolean;
  payLabel: string;
  removeLabel: string;
  onPay: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      data-testid="cart-line"
      className="flex flex-col gap-3 rounded-[6px] border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-semibold text-foreground">{label}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{price}</span>
          {eventLink}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" onClick={onPay} disabled={busy}>
          {payLabel}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}
