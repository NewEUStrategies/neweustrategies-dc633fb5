// Molekuła: legenda macierzy.
//
// Cztery poziomy + dwa badge'e wymagają objaśnienia, bo "nie dotyczy" nie znaczy
// "brak", a "dekoracyjna" nie znaczy "wyłączona". Bez legendy audytor czyta
// macierz opacznie - a to dokładnie ten błąd, który ta strona ma eliminować.
import { useTranslation } from "react-i18next";
import { EnforcementBadge, PermissionLevelCell, TenantScopeBadge } from "../atoms";
import { cn } from "@/lib/utils";
import type { PermissionLevel } from "@/lib/authz/permissionMatrix";

const LEVELS: readonly PermissionLevel[] = ["full", "partial", "none", "not_applicable"];

export interface PermissionMatrixLegendProps {
  className?: string;
}

export function PermissionMatrixLegend({ className }: PermissionMatrixLegendProps) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      <span className="text-xs font-medium text-muted-foreground">
        {t("adminPermissions.table.legend")}:
      </span>
      {LEVELS.map((level) => (
        <PermissionLevelCell key={level} level={level} compact />
      ))}
      <span className="hidden h-4 w-px bg-border sm:inline-block" aria-hidden="true" />
      <EnforcementBadge enforced />
      <EnforcementBadge enforced={false} />
      <span className="hidden h-4 w-px bg-border sm:inline-block" aria-hidden="true" />
      <TenantScopeBadge tenantRef="caller" />
      <TenantScopeBadge tenantRef="row" />
      <TenantScopeBadge tenantRef="none" />
    </div>
  );
}
