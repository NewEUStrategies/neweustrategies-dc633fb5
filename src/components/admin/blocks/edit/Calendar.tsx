import type { Block } from "@/lib/blocks/types";

interface Props { block: Block; onChange: (next: Block) => void; }

/** Kalendarz publikacji (Gutenberg "Calendar"). */
export function CalendarBlock({ block, onChange }: Props) {
  const month = String(block.data.month ?? ""); // YYYY-MM, puste = bieżący
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Calendar</div>
      <input
        type="month"
        value={month}
        onChange={(e) => onChange({ ...block, data: { ...block.data, month: e.target.value } })}
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9 w-full"
        placeholder="Bieżący miesiąc"
      />
    </div>
  );
}
