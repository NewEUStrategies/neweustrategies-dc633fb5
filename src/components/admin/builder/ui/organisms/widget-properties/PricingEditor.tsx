// Organism: pricing plans editor.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PropField, ItemFrame } from "../../atoms";
import { ListShell } from "./ListShell";
import { itemsOf, type Item } from "./shared";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function PricingEditor({ c, lang, setContent }: Props) {
  const plans = itemsOf(c, "plans");
  const update = (next: Item[]) => setContent("plans", toJson(next));
  const upd = (i: number, patch: Item) => update(plans.map((x, j) => j === i ? { ...x, ...patch } : x));
  return (
    <ListShell
      title="Plany cenowe"
      items={plans}
      onAdd={() => update([...plans, {
        name_pl: "Plan", price: "0", currency: "zł", period_pl: "/mies.",
        features_pl: ["Funkcja 1"], cta_pl: "Wybierz", href: "#", featured: false,
      }])}
    >
      <div className="space-y-2">
        {plans.map((p, i) => {
          const featuresRaw = p[`features_${lang}`];
          const features = Array.isArray(featuresRaw)
            ? (featuresRaw as unknown[]).filter((x): x is string => typeof x === "string")
            : [];
          return (
            <ItemFrame key={i} title={`Plan #${i + 1}`} onRemove={() => update(plans.filter((_, j) => j !== i))}>
              <PropField label={`Nazwa (${lang.toUpperCase()})`}>
                <Input value={(p[`name_${lang}`] as string) ?? ""} onChange={(e) => upd(i, { [`name_${lang}`]: e.target.value })} className="h-8 text-xs" />
              </PropField>
              <div className="grid grid-cols-2 gap-2">
                <PropField label="Cena">
                  <Input value={(p.price as string) ?? ""} onChange={(e) => upd(i, { price: e.target.value })} className="h-8 text-xs" />
                </PropField>
                <PropField label="Waluta">
                  <Input value={(p.currency as string) ?? ""} onChange={(e) => upd(i, { currency: e.target.value })} placeholder="zł / €" className="h-8 text-xs" />
                </PropField>
              </div>
              <PropField label={`Okres (${lang.toUpperCase()})`}>
                <Input value={(p[`period_${lang}`] as string) ?? ""} onChange={(e) => upd(i, { [`period_${lang}`]: e.target.value })} placeholder="/mies." className="h-8 text-xs" />
              </PropField>
              <PropField label={`Funkcje (${lang.toUpperCase()}) - po jednej na linię`}>
                <Textarea rows={4}
                  value={features.join("\n")}
                  onChange={(e) => upd(i, { [`features_${lang}`]: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                  className="text-xs"
                />
              </PropField>
              <div className="grid grid-cols-2 gap-2">
                <PropField label={`CTA (${lang.toUpperCase()})`}>
                  <Input value={(p[`cta_${lang}`] as string) ?? ""} onChange={(e) => upd(i, { [`cta_${lang}`]: e.target.value })} className="h-8 text-xs" />
                </PropField>
                <PropField label="Link CTA">
                  <Input value={(p.href as string) ?? ""} onChange={(e) => upd(i, { href: e.target.value })} className="h-8 text-xs" />
                </PropField>
              </div>
              <label className="inline-flex items-center gap-2 text-[11px] mt-1">
                <input
                  type="checkbox"
                  checked={!!p.featured}
                  onChange={(e) => upd(i, { featured: e.target.checked })}
                  className="rounded border-border"
                />
                Wyróżniony plan
              </label>
            </ItemFrame>
          );
        })}
      </div>
    </ListShell>
  );
}
