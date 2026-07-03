import type { Block } from "@/lib/blocks/types";
import { FileDown } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function FileBlock({ block, onChange }: Props) {
  const url = String(block.data.url ?? "");
  const label = String(block.data.label ?? "");
  const showButton = block.data.showButton !== false;

  return (
    <div className="rounded-lg border border-border p-4 space-y-2 bg-muted/30">
      <div className="flex items-center gap-2">
        <FileDown className="w-5 h-5 text-muted-foreground shrink-0" />
        <Input
          value={label}
          placeholder="Nazwa pliku do wyświetlenia…"
          onChange={(e) => onChange({ ...block, data: { ...block.data, label: e.target.value } })}
        />
      </div>
      <Input
        value={url}
        placeholder="URL pliku (PDF, ZIP, DOCX…)"
        onChange={(e) => onChange({ ...block, data: { ...block.data, url: e.target.value } })}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={showButton}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, showButton: e.target.checked } })
          }
        />
        Pokaż przycisk „Pobierz"
      </label>
    </div>
  );
}
