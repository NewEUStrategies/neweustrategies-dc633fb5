// Plusy i minusy. Listy czyta ten sam czytnik co `renderProsCons` (`strList`):
// panel pokazuje wyłącznie pozycje tekstowe, które strona faktycznie narysuje.
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { str, strList } from "@/components/blocks/renderer/data";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, ThumbsUp, ThumbsDown } from "lucide-react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

interface ColumnProps {
  label: string;
  addLabel: string;
  removeLabel: string;
  items: string[];
  onItems: (v: string[]) => void;
  Icon: typeof ThumbsUp;
  color: string;
}

// Kolumna jest komponentem MODUŁU, a nie funkcją deklarowaną w renderze
// edytora: nowa tożsamość komponentu przy każdym zapisie kazałaby Reactowi
// montować kolumnę od zera, a redaktor traciłby fokus po każdym znaku.
function Column({ label, addLabel, removeLabel, items, onItems, Icon, color }: ColumnProps) {
  return (
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
            aria-label={removeLabel}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onItems([...items, ""])}
        className="text-xs flex items-center gap-1 text-foreground hover:underline"
      >
        <Plus className="w-3.5 h-3.5" /> {addLabel}
      </button>
    </div>
  );
}

export function ProsConsBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const title = str(block.data, "title");
  const pros = strList(block.data, "pros");
  const cons = strList(block.data, "cons");
  const addLabel = bt.editor("prosCons", "add");
  const removeLabel = bt.editor("common", "remove");

  const setField = (key: "pros" | "cons", value: string[]) =>
    onChange({ ...block, data: { ...block.data, [key]: value } });

  return (
    <div className="not-prose space-y-2">
      <Input
        placeholder={bt.editor("prosCons", "title")}
        value={title}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Column
          label={bt.editor("prosCons", "pros")}
          addLabel={addLabel}
          removeLabel={removeLabel}
          items={pros}
          onItems={(v) => setField("pros", v)}
          Icon={ThumbsUp}
          color="bg-emerald-500/5 border-emerald-500/30"
        />
        <Column
          label={bt.editor("prosCons", "cons")}
          addLabel={addLabel}
          removeLabel={removeLabel}
          items={cons}
          onItems={(v) => setField("cons", v)}
          Icon={ThumbsDown}
          color="bg-red-500/5 border-red-500/30"
        />
      </div>
    </div>
  );
}
