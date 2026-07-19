// Organism: pricing plans editor.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PropField, ItemFrame } from "../../atoms";
import { ListShell } from "./ListShell";
import { itemsOf, type Item } from "./shared";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function PricingEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const plans = itemsOf(c, "plans");
  const update = (next: Item[]) => setContent("plans", toJson(next));
  const upd = (i: number, patch: Item) =>
    update(plans.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <ListShell
      title={t("builder.pricingEditor.title")}
      items={plans}
      onAdd={() =>
        update([
          ...plans,
          {
            name_pl: "Plan",
            price: "0",
            currency: "zł",
            period_pl: "/mies.",
            features_pl: ["Funkcja 1"],
            cta_pl: "Wybierz",
            href: "#",
            featured: false,
          },
        ])
      }
    >
      <div className="space-y-2">
        {plans.map((p, i) => {
          const featuresRaw = p[`features_${lang}`];
          const features = Array.isArray(featuresRaw)
            ? (featuresRaw as unknown[]).filter((x): x is string => typeof x === "string")
            : [];
          return (
            <ItemFrame
              key={i}
              title={t("builder.pricingEditor.item", { n: i + 1 })}
              onRemove={() => update(plans.filter((_, j) => j !== i))}
            >
              <PropField label={t("builder.pricingEditor.name", { lang: lang.toUpperCase() })}>
                <Input
                  value={(p[`name_${lang}`] as string) ?? ""}
                  onChange={(e) => upd(i, { [`name_${lang}`]: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <div className="grid grid-cols-2 gap-2">
                <PropField label={t("builder.pricingEditor.price")}>
                  <Input
                    value={(p.price as string) ?? ""}
                    onChange={(e) => upd(i, { price: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
                <PropField label={t("builder.pricingEditor.currency")}>
                  <Input
                    value={(p.currency as string) ?? ""}
                    onChange={(e) => upd(i, { currency: e.target.value })}
                    placeholder={t("builder.pricingEditor.currencyPh")}
                    className="h-8 text-xs"
                  />
                </PropField>
              </div>
              <PropField label={t("builder.pricingEditor.period", { lang: lang.toUpperCase() })}>
                <Input
                  value={(p[`period_${lang}`] as string) ?? ""}
                  onChange={(e) => upd(i, { [`period_${lang}`]: e.target.value })}
                  placeholder={t("builder.pricingEditor.periodPh")}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.pricingEditor.features", { lang: lang.toUpperCase() })}>
                <Textarea
                  rows={4}
                  value={features.join("\n")}
                  onChange={(e) =>
                    upd(i, {
                      [`features_${lang}`]: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="text-xs"
                />
              </PropField>
              <div className="grid grid-cols-2 gap-2">
                <PropField label={t("builder.pricingEditor.cta", { lang: lang.toUpperCase() })}>
                  <Input
                    value={(p[`cta_${lang}`] as string) ?? ""}
                    onChange={(e) => upd(i, { [`cta_${lang}`]: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
                <PropField label={t("builder.pricingEditor.ctaLink")}>
                  <Input
                    value={(p.href as string) ?? ""}
                    onChange={(e) => upd(i, { href: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
              </div>
              <label className="inline-flex items-center gap-2 text-[11px] mt-1">
                <input
                  type="checkbox"
                  checked={!!p.featured}
                  onChange={(e) => upd(i, { featured: e.target.checked })}
                  className="rounded border-border"
                />
                {t("builder.pricingEditor.featured")}
              </label>
            </ItemFrame>
          );
        })}
      </div>
    </ListShell>
  );
}
