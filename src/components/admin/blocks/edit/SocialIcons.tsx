import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";

interface Props { block: Block; onChange: (next: Block) => void; }
interface Item { platform: string; url: string }

const PLATFORMS = ["facebook","x","instagram","youtube","linkedin","tiktok","github","mail","rss"] as const;

/** Ikony socjalne (Gutenberg "Social Icons"). */
export function SocialIconsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const items: Item[] = Array.isArray(block.data.items)
    ? (block.data.items as unknown as Item[])
    : [];
  const size = String(block.data.size ?? "md");
  const align = String(block.data.align ?? "left");

  const update = (next: Item[]) =>
    onChange({ ...block, data: { ...block.data, items: next as unknown as Block["data"][string] } });

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">Social Icons</span>
        <div className="flex gap-2">
          <select
            className="text-xs bg-background border border-border rounded px-2 py-1"
            value={size}
            onChange={(e) => onChange({ ...block, data: { ...block.data, size: e.target.value } })}
          >
            <option value="sm">small</option>
            <option value="md">medium</option>
            <option value="lg">large</option>
          </select>
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
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[160px_1fr_auto] gap-2 items-center">
            <select
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              value={it.platform}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...it, platform: e.target.value };
                update(next);
              }}
            >
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <Input
              value={it.url}
              placeholder={i18n.field("urlPh")}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...it, url: e.target.value };
                update(next);
              }}
            />
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
          onClick={() => update([...items, { platform: "facebook", url: "" }])}
        >
          <Plus className="h-4 w-4 mr-1" /> Dodaj
        </Button>
      </div>
    </div>
  );
}
