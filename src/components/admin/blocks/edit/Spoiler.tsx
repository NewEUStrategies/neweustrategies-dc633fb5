import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { EyeOff } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function SpoilerBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const summary = String(block.data.summary ?? "");
  const html = String(block.data.html ?? "");
  const defaultOpen = Boolean(block.data.defaultOpen);

  return (
    <div className="not-prose rounded-md border border-dashed border-border p-3 space-y-2 bg-muted/30">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <EyeOff className="w-3.5 h-3.5" /> Spoiler
        <label className="ml-auto flex items-center gap-1 normal-case tracking-normal">
          <input
            type="checkbox"
            checked={defaultOpen}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, defaultOpen: e.target.checked } })
            }
          />
          Otwarty domyślnie
        </label>
      </div>
      <Input
        placeholder={i18n.editor("spoiler", "summaryPh")}
        value={summary}
        onChange={(e) => onChange({ ...block, data: { ...block.data, summary: e.target.value } })}
      />
      <textarea
        placeholder={i18n.editor("spoiler", "hiddenHtmlPh")}
        value={html}
        onChange={(e) => onChange({ ...block, data: { ...block.data, html: e.target.value } })}
        className="w-full rounded border border-border bg-background px-3 py-2 text-sm min-h-[80px] font-mono"
      />
    </div>
  );
}
