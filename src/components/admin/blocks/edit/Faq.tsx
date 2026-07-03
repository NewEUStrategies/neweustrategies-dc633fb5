import { toJson } from "@/lib/builder/types";
import type { Block, Json } from "@/lib/blocks/types";
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

function readItems(raw: Json | undefined): FaqItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FaqItem[] = [];
  for (const x of raw) {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const o = x as Record<string, unknown>;
      out.push({ q: String(o.q ?? ""), a: String(o.a ?? "") });
    }
  }
  return out;
}

export function FaqBlock({ block, onChange }: Props) {
  const title = String(block.data.title ?? "");
  const items = readItems(block.data.items);
  const setItems = (next: FaqItem[]) =>
    onChange({ ...block, data: { ...block.data, items: toJson(next) } });

  return (
    <div className="not-prose space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <HelpCircle className="w-3.5 h-3.5" /> FAQ
      </div>
      <Input
        placeholder="Tytuł sekcji (np. Najczęstsze pytania)"
        value={title}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      {items.map((it, i) => (
        <div key={i} className="rounded-md border border-border p-2 space-y-1.5 bg-background">
          <div className="flex items-center gap-1">
            <Input
              placeholder={`Pytanie ${i + 1}`}
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
              aria-label="Usuń"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            placeholder="Odpowiedź"
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
        className="text-xs flex items-center gap-1 text-primary hover:underline"
      >
        <Plus className="w-3.5 h-3.5" /> Dodaj pytanie
      </button>
    </div>
  );
}
