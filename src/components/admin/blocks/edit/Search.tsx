import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";

interface Props { block: Block; onChange: (next: Block) => void; }

/** Formularz wyszukiwarki (Gutenberg "Search"). */
export function SearchBlock({ block, onChange }: Props) {
  const placeholder = String(block.data.placeholder ?? "");
  const buttonLabel = String(block.data.buttonLabel ?? "");
  const action = String(block.data.action ?? "/search");

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Search</div>
      <Input
        value={placeholder}
        placeholder="Placeholder (np. Szukaj...)"
        onChange={(e) => onChange({ ...block, data: { ...block.data, placeholder: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={buttonLabel}
          placeholder="Etykieta przycisku (np. Szukaj)"
          onChange={(e) => onChange({ ...block, data: { ...block.data, buttonLabel: e.target.value } })}
        />
        <Input
          value={action}
          placeholder="Akcja (np. /search)"
          onChange={(e) => onChange({ ...block, data: { ...block.data, action: e.target.value } })}
        />
      </div>
    </div>
  );
}
