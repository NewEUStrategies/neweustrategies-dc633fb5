// Atom: jedna komórka macierzy uprawnień.
//
// Poziom NIE jest tu liczony - przychodzi z src/lib/authz/permissionMatrix.ts
// (bramki SQL + flagi warstwy). Atom odpowiada wyłącznie za czytelność: kolor,
// ikonę, tooltip i to, żeby "nie dotyczy" nie wyglądało jak "brak" - bo to dwie
// różne informacje dla audytu.
import { Check, Minus, Slash, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { PermissionLevel } from "@/lib/authz/permissionMatrix";

const LEVEL_STYLE: Readonly<Record<PermissionLevel, string>> = {
  full: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300",
  partial:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  none: "border-border bg-muted/60 text-muted-foreground",
  not_applicable: "border-dashed border-border/70 bg-transparent text-muted-foreground/70",
};

const LEVEL_ICON: Readonly<Record<PermissionLevel, typeof Check>> = {
  full: Check,
  partial: Minus,
  none: X,
  not_applicable: Slash,
};

export interface PermissionLevelCellProps {
  level: PermissionLevel;
  /** Wartość limitu (wiersze `tier_quota`) - zastępuje etykietę poziomu. */
  quota?: number;
  /** Wariant kompaktowy do legendy. */
  compact?: boolean;
  className?: string;
}

export function PermissionLevelCell({
  level,
  quota,
  compact = false,
  className,
}: PermissionLevelCellProps) {
  const { t } = useTranslation();
  const Icon = LEVEL_ICON[level];
  const hasQuota = typeof quota === "number" && level !== "not_applicable";
  const label = hasQuota
    ? quota > 0
      ? t("adminPermissions.table.quotaUnit", { count: quota })
      : t("adminPermissions.table.quotaNone")
    : t(`adminPermissions.levels.${level}`);

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded-[5px] border text-[11px] font-medium",
        compact ? "px-1.5 py-0.5" : "min-w-[74px] px-2 py-0.5",
        LEVEL_STYLE[level],
        className,
      )}
      title={t(`adminPermissions.levelHints.${level}`)}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}
