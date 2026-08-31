// Molekuła: podgląd JEDNEGO benefitu tak, jak zobaczy go klient na /pricing.
//
// Edytor benefitów pokazuje surowe pola (PL, EN, rozwinięcie, nagłówek grupy).
// Redakcja nie widziała, jak to się składa na karcie cennika - stąd okno
// podglądu, które renderuje ten sam komponent listy benefitów co strona
// publiczna, w obu językach naraz.
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TierBenefitList } from "@/components/pricing/atoms/TierBenefitList";
import type { TierBenefit } from "@/lib/billing/tiers";

export function BenefitPreviewDialog({
  benefit,
  open,
  onOpenChange,
}: {
  benefit: TierBenefit | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const tb = (k: string) => t(`adminPricing.benefits.${k}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-[6px] font-sans">
        <DialogHeader>
          <DialogTitle className="text-base">{tb("previewTitle")}</DialogTitle>
          <DialogDescription className="text-xs">{tb("previewHint")}</DialogDescription>
        </DialogHeader>
        {benefit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-[6px] border border-border/70 bg-card p-3">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {tb("previewPl")}
              </h3>
              <TierBenefitList benefits={[benefit]} lang="pl" />
            </section>
            <section className="rounded-[6px] border border-border/70 bg-card p-3">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {tb("previewEn")}
              </h3>
              <TierBenefitList benefits={[benefit]} lang="en" />
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
