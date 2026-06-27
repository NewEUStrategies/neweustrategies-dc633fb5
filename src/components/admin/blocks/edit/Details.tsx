import type { Block } from "@/lib/blocks/types";
import { Textarea } from "@/components/ui/textarea";
import { useBlocksI18n } from "@/lib/blocks/i18n";

interface Props { block: Block; onChange: (next: Block) => void; }

export function DetailsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const summary = String(block.data.summary ?? "");
  const body = String(block.data.body ?? "");
  return (
    <details open className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
      <summary className="cursor-pointer outline-none">
        <input
          type="text"
          value={summary}
          placeholder={i18n.editor("details","summaryPh")}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ ...block, data: { ...block.data, summary: e.target.value } })}
          className="bg-transparent font-medium text-sm border-none outline-none w-[calc(100%-2rem)] ml-1"
        />
      </summary>
      <Textarea
        value={body}
        placeholder={i18n.editor("details","contentPh")}
        rows={4}
        onChange={(e) => onChange({ ...block, data: { ...block.data, body: e.target.value } })}
        className="mt-2"
      />
    </details>
  );
}
