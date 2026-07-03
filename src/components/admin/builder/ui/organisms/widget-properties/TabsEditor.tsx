// Organism: tab content editor (HTML per language).
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

export function TabsEditor({ c, lang, setContent }: Props) {
  const tabs = itemsOf(c, "tabs");
  const update = (next: Item[]) => setContent("tabs", toJson(next));
  return (
    <ListShell
      title="Zakładki"
      items={tabs}
      onAdd={() => update([...tabs, { label_pl: "Nowa", html_pl: "<p>Treść…</p>" }])}
    >
      <div className="space-y-2">
        {tabs.map((it, i) => (
          <ItemFrame
            key={i}
            title={`Zakładka #${i + 1}`}
            onRemove={() => update(tabs.filter((_, j) => j !== i))}
          >
            <PropField label={`Etykieta (${lang.toUpperCase()})`}>
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
            <PropField label={`Treść HTML (${lang.toUpperCase()})`}>
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
          </ItemFrame>
        ))}
      </div>
    </ListShell>
  );
}
