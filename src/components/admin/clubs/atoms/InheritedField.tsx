// Atom: opakowanie pola ustawienia grupy, które może dziedziczyć z klubu.
//
// Dziedziczenie jest pokazane JAWNIE, a nie domyślnie: administrator musi
// widzieć, co skąd wynika, zanim zmieni wartość. Bez tej etykiety pole z
// wartością klubu wygląda jak wartość ustawiona ręcznie na grupie - i pierwsza
// zmiana ustawienia klubu przestaje działać "bez powodu".
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Link2, Link2Off } from "lucide-react";
import { cn } from "@/lib/utils";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

interface InheritedFieldProps {
  label: string;
  /** Czy wartość pochodzi z klubu (kolumna *_inherited z RPC). */
  inherited: boolean;
  /** Przełącza między "dziedzicz" a "nadpisz". */
  onToggleInherit: (inherit: boolean) => void;
  disabled?: boolean;
  hint?: string;
  children: React.ReactNode;
}

export function InheritedField({
  label,
  inherited,
  onToggleInherit,
  disabled,
  hint,
  children,
}: InheritedFieldProps) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-sm">{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onToggleInherit(!inherited)}
          className={cn(
            "h-6 gap-1.5 px-2 text-[11px] font-medium",
            inherited ? "text-muted-foreground" : "text-primary",
          )}
        >
          {inherited ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
          {inherited ? t("club.inheritedFromClub") : t("adminClubs.groups.override")}
        </Button>
      </div>
      {/* Pole dziedziczone jest wyszarzone i nieaktywne - wartość widać, ale
          zmiana wymaga świadomego kliknięcia "Nadpisz". */}
      <div className={cn(inherited && "pointer-events-none opacity-55")}>{children}</div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
