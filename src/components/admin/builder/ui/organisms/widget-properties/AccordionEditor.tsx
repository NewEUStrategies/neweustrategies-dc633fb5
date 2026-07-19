// Organism: FAQ-style accordion editor.
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

export function AccordionEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const items = itemsOf(c, "items");
  const update = (next: Item[]) => setContent("items", toJson(next));
  return (
    <ListShell
      title={t("builder.accordionEditor.title")}
      items={items}
      onAdd={() => update([...items, { q_pl: "Nowe pytanie", a_pl: "Odpowiedź…" }])}
    >
      <div className="space-y-2">
        {items.map((it, i) => (
          <ItemFrame
            key={i}
            title={t("builder.accordionEditor.item", { n: i + 1 })}
            onRemove={() => update(items.filter((_, j) => j !== i))}
          >
            <PropField label={t("builder.accordionEditor.question", { lang: lang.toUpperCase() })}>
              <Input
                value={typeof it[`q_${lang}`] === "string" ? (it[`q_${lang}`] as string) : ""}
                onChange={(e) =>
                  update(
                    items.map((x, j) => (j === i ? { ...x, [`q_${lang}`]: e.target.value } : x)),
                  )
                }
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label={t("builder.accordionEditor.answer", { lang: lang.toUpperCase() })}>
              <Textarea
                rows={3}
                value={typeof it[`a_${lang}`] === "string" ? (it[`a_${lang}`] as string) : ""}
                onChange={(e) =>
                  update(
                    items.map((x, j) => (j === i ? { ...x, [`a_${lang}`]: e.target.value } : x)),
                  )
                }
                className="text-xs font-mono"
              />
            </PropField>
          </ItemFrame>
        ))}
      </div>
    </ListShell>
  );
}
