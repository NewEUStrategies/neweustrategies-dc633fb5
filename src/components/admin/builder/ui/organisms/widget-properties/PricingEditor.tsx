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
  const source = typeof c.source === "string" && c.source === "plans" ? "plans" : "manual";

  // Źródło danych: ręczne karty albo katalog planów (access_plans) - ten sam,
  // z którego korzysta /pricing i checkout u operatora płatności.
  const sourceControls = (
    <div className="space-y-2 rounded-md border border-border/60 p-2">
      <PropField label={lang === "pl" ? "Źródło danych" : "Data source"}>
        <select
          value={source}
          onChange={(e) => setContent("source", e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="manual">{lang === "pl" ? "Ręcznie" : "Manual"}</option>
          <option value="plans">
            {lang === "pl" ? "Katalog planów (Paddle)" : "Plan catalog (Paddle)"}
          </option>
        </select>
      </PropField>
      {source === "plans" && (
        <>
          <PropField label={lang === "pl" ? "Okres" : "Interval"}>
            <select
              value={(c.planInterval as string) ?? "all"}
              onChange={(e) => setContent("planInterval", e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="all">{lang === "pl" ? "Wszystkie" : "All"}</option>
              <option value="month">{lang === "pl" ? "Miesięczne" : "Monthly"}</option>
              <option value="quarter">{lang === "pl" ? "Kwartalne" : "Quarterly"}</option>
              <option value="year">{lang === "pl" ? "Roczne" : "Yearly"}</option>
              <option value="one_time">{lang === "pl" ? "Jednorazowe" : "One-time"}</option>
            </select>
          </PropField>
          <div className="grid grid-cols-2 gap-2">
            <PropField label={lang === "pl" ? "Warstwy (CSV)" : "Tier keys (CSV)"}>
              <Input
                value={(c.tierKeysCsv as string) ?? ""}
                onChange={(e) => setContent("tierKeysCsv", e.target.value)}
                placeholder="plus,pro"
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label={lang === "pl" ? "Limit kart" : "Card limit"}>
              <Input
                type="number"
                min={0}
                value={String(Number(c.planLimit ?? 0) || 0)}
                onChange={(e) => setContent("planLimit", Number(e.target.value) || 0)}
                className="h-8 text-xs"
              />
            </PropField>
          </div>
          <PropField label={t("builder.pricingEditor.cta", { lang: lang.toUpperCase() })}>
            <Input
              value={(c[`cta_${lang}`] as string) ?? ""}
              onChange={(e) => setContent(`cta_${lang}`, e.target.value)}
              className="h-8 text-xs"
            />
          </PropField>
        </>
      )}
    </div>
  );

  if (source === "plans") return sourceControls;

  return (
    <ListShell
      title={t("builder.pricingEditor.title")}
      items={plans}
      onAdd={() =>
        update([
          ...plans,
          {
            name_pl: "Plan",
            name_en: "Plan",
            price: "0",
            currency: "zł",
            period_pl: "/mies.",
            period_en: "/mo",
            features_pl: ["Funkcja 1"],
            features_en: ["Feature 1"],
            cta_pl: "Wybierz",
            cta_en: "Choose",
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
