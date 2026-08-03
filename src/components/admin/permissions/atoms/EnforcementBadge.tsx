// Atom: "Egzekwowana" vs "Dekoracyjna".
//
// To najważniejszy sygnał całej macierzy: pokazuje, czy pozycja ma realną bramkę
// w bazie, czy jest wyłącznie obietnicą na karcie planu. Wartość pochodzi ze
// snapshotu bramek (generowanego ze SQL-a), więc nie da się jej "poprawić"
// ręcznie w UI - trzeba dopiąć bramkę.
import { Info, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface EnforcementBadgeProps {
  enforced: boolean;
  className?: string;
}

export function EnforcementBadge({ enforced, className }: EnforcementBadgeProps) {
  const { t } = useTranslation();
  const Icon = enforced ? ShieldCheck : Info;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium",
        enforced
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground",
        className,
      )}
      title={t(
        enforced
          ? "adminPermissions.enforcement.enforcedHint"
          : "adminPermissions.enforcement.decorativeHint",
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {t(
        enforced
          ? "adminPermissions.enforcement.enforced"
          : "adminPermissions.enforcement.decorative",
      )}
    </span>
  );
}
