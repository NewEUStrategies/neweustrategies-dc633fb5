// Organism: tab content editor (HTML per language).
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PropField, ItemFrame } from "../../atoms";
import { LucideIconPicker } from "../../molecules/LucideIconPicker";
import { ListShell } from "./ListShell";
import { itemsOf, type Item } from "./shared";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function TabsEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const tabs = itemsOf(c, "tabs");
  const update = (next: Item[]) => setContent("tabs", toJson(next));
  const orientation = c.orientation === "vertical" ? "vertical" : "horizontal";
  const rawAlign = typeof c.tabAlign === "string" ? c.tabAlign : "left";
  const tabAlign = (["left", "center", "right", "justify"] as const).includes(
    rawAlign as "left" | "center" | "right" | "justify",
  )
    ? rawAlign
    : "left";
  const isPL = lang === "pl";
  return (
    <ListShell
      title={t("builder.tabsEditor.title")}
      items={tabs}
      onAdd={() =>
        update([
          ...tabs,
          {
            label_pl: "Nowa",
            label_en: "New",
            html_pl: "<p>Treść…</p>",
            html_en: "<p>Content…</p>",
          },
        ])
      }
    >
      <PropField label={isPL ? "Układ zakładek" : "Tabs layout"}>
        <select
          value={orientation}
          onChange={(e) => setContent("orientation", e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="horizontal">
            {isPL ? "Poziomy (tekst pod zakładkami)" : "Horizontal (text below tabs)"}
          </option>
          <option value="vertical">
            {isPL ? "Pionowy (tekst po prawej)" : "Vertical (text on the right)"}
          </option>
        </select>
      </PropField>
      {orientation === "horizontal" && (
        <PropField label={isPL ? "Pozycjonowanie zakładek" : "Tabs alignment"}>
          <select
            value={tabAlign}
            onChange={(e) => setContent("tabAlign", e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="left">{isPL ? "Do lewej" : "Left"}</option>
            <option value="center">{isPL ? "Wyśrodkowane" : "Center"}</option>
            <option value="right">{isPL ? "Do prawej" : "Right"}</option>
            <option value="justify">{isPL ? "Wyjustowane" : "Justify"}</option>
          </select>
        </PropField>
      )}
      <div className="space-y-2">
        {tabs.map((it, i) => (
          <ItemFrame
            key={i}
            title={t("builder.tabsEditor.item", { n: i + 1 })}
            onRemove={() => update(tabs.filter((_, j) => j !== i))}
          >
            <PropField label={t("builder.tabsEditor.label", { lang: lang.toUpperCase() })}>
              <Input
                value={
                  typeof it[`label_${lang}`] === "string" ? (it[`label_${lang}`] as string) : ""
                }
                onChange={(e) =>
                  update(
                    tabs.map((x, j) => (j === i ? { ...x, [`label_${lang}`]: e.target.value } : x)),
                  )
                }
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label={t("builder.tabsEditor.html", { lang: lang.toUpperCase() })}>
              <Textarea
                rows={4}
                value={typeof it[`html_${lang}`] === "string" ? (it[`html_${lang}`] as string) : ""}
                onChange={(e) =>
                  update(
                    tabs.map((x, j) => (j === i ? { ...x, [`html_${lang}`]: e.target.value } : x)),
                  )
                }
                className="text-xs font-mono"
              />
            </PropField>
            <PropField label={isPL ? "Ikona (opcjonalna)" : "Icon (optional)"}>
              <LucideIconPicker
                value={typeof it.icon === "string" ? (it.icon as string) : ""}
                onChange={(name) =>
                  update(tabs.map((x, j) => (j === i ? { ...x, icon: name ?? "" } : x)))
                }
              />
            </PropField>
          </ItemFrame>
        ))}
      </div>
    </ListShell>
  );
}
