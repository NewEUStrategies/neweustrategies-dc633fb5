// Lista benefitów warstwy w stylu prasy cyfrowej: opcjonalne nagłówki sekcji
// (FT) i jednozdaniowe rozwinięcia pod benefitem (NYT). Czysta prezentacja -
// grupowanie liczy selektor groupBenefits.
import { Check } from "lucide-react";
import type { TierBenefit } from "@/lib/billing/tiers";
import { benefitDetail, benefitText, groupBenefits } from "@/lib/pricing/selectors";

export function TierBenefitList({ benefits, lang }: { benefits: TierBenefit[]; lang: string }) {
  const groups = groupBenefits(benefits, lang);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-3">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.group && (
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.group}
            </p>
          )}
          <ul className="space-y-2">
            {group.items.map((benefit, bi) => {
              const detail = benefitDetail(benefit, lang);
              return (
                <li key={bi} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    {benefitText(benefit, lang)}
                    {detail && (
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {detail}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
