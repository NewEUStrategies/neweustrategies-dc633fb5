import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, ThumbsUp, ThumbsDown } from "lucide-react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

function readList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x ?? ""));
}

export function ProsConsBlock({ block, onChange }: Props) {
  const title = String(block.data.title ?? "");
  const pros = readList(block.data.pros);
  const cons = readList(block.data.cons);

  const setField = (key: "pros" | "cons", value: string[]) =>
    onChange({ ...block, data: { ...block.data, [key]: value } });

  const Col = ({
    label,
    items,
    onItems,
    Icon,
    color,
  }: {
    label: string;
    items: string[];
    onItems: (v: string[]) => void;
    Icon: typeof ThumbsUp;
    color: string;
  }) => (
    <div className={`rounded-md border ${color} p-3 space-y-2`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="w-4 h-4" /> {label}
      </div>
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            value={it}
            placeholder={label}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onItems(next);
            }}
            className="flex-1 h-8 text-sm"
          />
          <button
            type="button"
            onClick={() => onItems(items.filter((_, j) => j !== i))}
            className="p-1 hover:bg-accent rounded"
            aria-label="Usuń"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onItems([...items, ""])}
        className="text-xs flex items-center gap-1 text-primary hover:underline"
      >
        <Plus className="w-3.5 h-3.5" /> Dodaj
      </button>
    </div>
  );

  return (
    <div className="not-prose space-y-2">
      <Input
        placeholder="Tytuł (opcjonalnie)"
        value={title}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Col
          label="Plusy"
          items={pros}
          onItems={(v) => setField("pros", v)}
          Icon={ThumbsUp}
          color="bg-emerald-500/5 border-emerald-500/30"
        />
        <Col
          label="Minusy"
          items={cons}
          onItems={(v) => setField("cons", v)}
          Icon={ThumbsDown}
          color="bg-red-500/5 border-red-500/30"
        />
      </div>
    </div>
  );
}
