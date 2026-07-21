// Molekuła prostego wyboru dwujęzycznych opcji (programy / regiony) - lista
// checkboxów, bez inline-tworzenia. Etykieta i podpowiedź "brak" wstrzykiwane
// przez rodzica, więc karta jest w pełni prezentacyjna.
import type { Dispatch, SetStateAction } from "react";
import { Label } from "@/components/ui/label";

interface BilingualOption {
  id: string;
  name_pl: string;
  name_en: string;
}

export function BilingualPickerCard({
  label,
  options,
  selectedIds,
  onSelectedChange,
  emptyHint,
}: {
  label: string;
  options: BilingualOption[] | undefined;
  selectedIds: string[];
  onSelectedChange: Dispatch<SetStateAction<string[]>>;
  emptyHint: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <Label className="block">{label}</Label>
      <div className="space-y-1 max-h-48 overflow-auto">
        {options?.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedIds.includes(o.id)}
              onChange={(e) =>
                onSelectedChange((s) =>
                  e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id),
                )
              }
            />
            {o.name_pl}
            {o.name_en && o.name_en !== o.name_pl ? ` / ${o.name_en}` : ""}
          </label>
        ))}
        {!options?.length && <p className="text-xs text-muted-foreground">{emptyHint}</p>}
      </div>
    </div>
  );
}
