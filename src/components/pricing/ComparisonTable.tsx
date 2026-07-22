// Macierz porównania warstw segmentu (styl FT "compare all features").
// Zwijana tym samym akordeonem co FAQ - jedna, spójna animacja na stronie.
// Wiersze to unia benefitów (tekst per język); przy spójnym nazewnictwie
// redakcyjnym daje pełną macierz, przy rozjechanym uczciwie degraduje.
import { useTranslation } from "react-i18next";
import { Check, Minus } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { parseTierBenefits, tierName, type MembershipTierRow } from "@/lib/billing/tiers";
import { benefitText } from "@/lib/pricing/selectors";

export function ComparisonTable({ tiers, lang }: { tiers: MembershipTierRow[]; lang: string }) {
  const { t } = useTranslation();
  const withBenefits = tiers
    .map((tier) => ({ tier, benefits: parseTierBenefits(tier.benefits) }))
    .filter((entry) => entry.benefits.length > 0);
  if (withBenefits.length < 2) return null;

  const rows: string[] = [];
  const included = withBenefits.map(({ benefits }) => {
    const labels = new Set(benefits.map((b) => benefitText(b, lang)));
    for (const label of labels) {
      if (!rows.includes(label)) rows.push(label);
    }
    return labels;
  });

  return (
    <section className="mx-auto mt-16 max-w-4xl">
      <Accordion type="single" collapsible>
        <AccordionItem value="compare" className="border-b-0">
          <AccordionTrigger className="mx-auto flex-none justify-center gap-2 text-base font-semibold hover:no-underline">
            {t("pricing.compareAll")}
          </AccordionTrigger>
          <AccordionContent>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th scope="col" className="p-3 text-left font-medium">
                      {t("pricing.compareFeature")}
                    </th>
                    {withBenefits.map(({ tier }) => (
                      <th scope="col" key={tier.id} className="p-3 text-center font-semibold">
                        {tierName(tier, lang)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((feature) => (
                    <tr key={feature}>
                      <th scope="row" className="p-3 text-left font-normal">
                        {feature}
                      </th>
                      {withBenefits.map(({ tier }, ti) => (
                        <td key={tier.id} className="p-3 text-center">
                          {included[ti].has(feature) ? (
                            <Check
                              className="mx-auto h-4 w-4 text-primary"
                              aria-label={t("common.yes", { defaultValue: "Tak" })}
                            />
                          ) : (
                            <Minus
                              className="mx-auto h-4 w-4 text-muted-foreground/40"
                              aria-label={t("common.no", { defaultValue: "Nie" })}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
