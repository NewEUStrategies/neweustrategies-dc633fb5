import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { toJson } from "@/lib/content-model/json";
import type { Block } from "@/lib/blocks/types";
import { objList, str } from "@/components/blocks/renderer/data";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, HelpCircle } from "lucide-react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

interface FaqItem {
  q: string;
  a: string;
}

/** Te same czytniki co `renderFaq` - obiekt w treści to pusty napis, nie „[object Object]". */
function readItems(block: Block): FaqItem[] {
  return objList(block.data, "items", (o) => ({ q: str(o, "q"), a: str(o, "a") }));
}

export function FaqBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const title = str(block.data, "title");
  const items = readItems(block);
  const setItems = (next: FaqItem[]) =>
    onChange({ ...block, data: { ...block.data, items: toJson(next) } });

  return (
    <div className="not-prose space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <HelpCircle className="w-3.5 h-3.5" /> FAQ
      </div>
      <Input
        placeholder={bt.editor("faq", "sectionTitle")}
        value={title}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      {items.map((it, i) => (
        <div key={i} className="rounded-md border border-border p-2 space-y-1.5 bg-background">
          <div className="flex items-center gap-1">
            <Input
              placeholder={bt.editor("faq", "question", { n: i + 1 })}
              value={it.q}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...it, q: e.target.value };
                setItems(next);
              }}
              className="flex-1 font-medium"
            />
            <button
              type="button"
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              className="p-1 hover:bg-accent rounded"
              aria-label={bt.editor("common", "remove")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            placeholder={bt.editor("faq", "answer")}
            value={it.a}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...it, a: e.target.value };
              setItems(next);
            }}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm min-h-[50px]"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => setItems([...items, { q: "", a: "" }])}
        className="text-xs flex items-center gap-1 text-foreground hover:underline"
      >
        <Plus className="w-3.5 h-3.5" /> {bt.editor("faq", "addQuestion")}
      </button>
    </div>
  );
}
