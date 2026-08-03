// Atom: jak bramka odnosi się do obszaru roboczego (tenanta).
//
// Izolacja tenantów jest w tym systemie warunkiem podstawowym: dane jednej firmy
// nie mogą być czytane z obszaru innej. `current_tenant_id()` to jedyne wiązanie
// z tenantem DOMOWYM wołającego; samo porównanie kolumn `tenant_id` daje spójność
// wiersz-wiersz, a brak jednego i drugiego to pozycja do przeglądu. Wartość jest
// odtwarzana ze SQL-a, więc badge nie jest opinią, tylko odczytem.
import { Building2, ShieldQuestion, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { TenantRef } from "@/lib/authz/authzSnapshotTypes";

const STYLE: Readonly<Record<TenantRef, string>> = {
  caller:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300",
  row: "border-border bg-muted/50 text-muted-foreground",
  none: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
};

const ICON: Readonly<Record<TenantRef, typeof Building2>> = {
  caller: Building2,
  row: Users,
  none: ShieldQuestion,
};

export interface TenantScopeBadgeProps {
  tenantRef: TenantRef;
  className?: string;
}

export function TenantScopeBadge({ tenantRef, className }: TenantScopeBadgeProps) {
  const { t } = useTranslation();
  const Icon = ICON[tenantRef];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium",
        STYLE[tenantRef],
        className,
      )}
      title={t(`adminPermissions.tenant.${tenantRef}Hint`)}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {t(`adminPermissions.tenant.${tenantRef}`)}
    </span>
  );
}
