import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Mail } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function NewsletterBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const title = String(block.data.title ?? "");
  const description = String(block.data.description ?? "");
  const variant = String(block.data.variant ?? "card");

  return (
    <div className="not-prose rounded-md border border-border bg-gradient-to-br from-primary/5 to-transparent p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Mail className="w-3.5 h-3.5" /> Newsletter (inline)
        <select
          value={variant}
          onChange={(e) => onChange({ ...block, data: { ...block.data, variant: e.target.value } })}
          className="ml-auto bg-background border border-border rounded px-1 py-0.5 text-[11px] normal-case tracking-normal"
        >
          <option value="card">{i18n.editor("newsletter","variantCard")}</option>
          <option value="inline">{i18n.editor("newsletter","variantInline")}</option>
        </select>
      </div>
      <Input
        placeholder={i18n.editor("newsletter","titlePh")}
        value={title}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <textarea
        placeholder={i18n.field("description")}
        value={description}
        onChange={(e) => onChange({ ...block, data: { ...block.data, description: e.target.value } })}
        className="w-full rounded border border-border bg-background px-3 py-2 text-sm min-h-[50px]"
      />
    </div>
  );
}
