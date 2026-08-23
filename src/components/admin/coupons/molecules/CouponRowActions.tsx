// Molekuła: akcje wiersza kuponu - przełącznik aktywności i usunięcie.
//
// Przełącznik jest STEROWANY DANYMI Z WIERSZA (`checked={active}`), nie
// własnym stanem: po odmowie zapisu wiersz zostaje taki, jaki był, a operator
// widzi wyłącznie komunikat błędu. Nic tu nie blokuje drugiego kliknięcia -
// dwa szybkie kliknięcia wysyłają dwa IDENTYCZNE żądania z tego samego,
// nieaktualnego wiersza. Zachowanie przeniesione bez zmian; zgłasza je test.
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface CouponRowActionsProps {
  active: boolean;
  toggleLabel: string;
  deleteLabel: string;
  onToggle: () => void;
  onDelete: () => void;
}

export function CouponRowActions({
  active,
  toggleLabel,
  deleteLabel,
  onToggle,
  onDelete,
}: CouponRowActionsProps) {
  return (
    <div className="inline-flex items-center gap-1">
      <Switch checked={active} onCheckedChange={onToggle} aria-label={toggleLabel} />
      <Button variant="ghost" size="icon" aria-label={deleteLabel} onClick={onDelete}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
