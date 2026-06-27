import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";

interface Props { block: Block; onChange: (next: Block) => void; }
interface Item { label: string; href: string; variant?: string }

/** Grupa przycisków (Gutenberg "Buttons"). */
export function ButtonsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const items: Item[] = Array.isArray(block.data.items)
    ? (block.data.items as unknown as Item[])
    : [];
  const align = String(block.data.align ?? "left");

  const update = (next: Item[]) =>
    onChange({ ...block, data: { ...block.data, items: next as unknown as Block["data"][string] } });

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">Buttons</span>
        <select
          className="text-xs bg-background border border-border rounded px-2 py-1"
          value={align}
          onChange={(e) => onChange({ ...block, data: { ...block.data, align: e.target.value } })}
        >
          <option value="left">left</option>
          <option value="center">center</option>
          <option value="right">right</option>
        </select>
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
            <Input
              value={it.label}
              placeholder={i18n.field("label")}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...it, label: e.target.value };
                update(next);
              }}
            />
            <Input
              value={it.href}
              placeholder={i18n.field("urlPh")}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...it, href: e.target.value };
                update(next);
              }}
            />
            <select
              className="text-xs bg-background border border-border rounded px-2 py-1"
              value={it.variant ?? "default"}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...it, variant: e.target.value };
                update(next);
              }}
            >
              <option value="default">solid</option>
              <option value="outline">outline</option>
              <option value="ghost">ghost</option>
            </select>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => update(items.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update([...items, { label: "Button", href: "#", variant: "default" }])}
        >
          <Plus className="h-4 w-4 mr-1" /> Dodaj
        </Button>
      </div>
    </div>
  );
}
