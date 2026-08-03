// Molekuła: pierwsza (przyklejona) kolumna wiersza macierzy.
//
// Zawiera wszystko, co pozwala ZWERYFIKOWAĆ twierdzenie wiersza bez pytania
// nikogo: etykietę w języku UI, klucz flagi (gdy to flaga warstwy), badge
// egzekwowania, nazwy bramek SQL i sposób wiązania z tenantem.
import { useTranslation } from "react-i18next";
import { EnforcementBadge, GateChip, TenantScopeBadge } from "../atoms";
import type { MatrixRow } from "@/lib/authz/permissionMatrix";

export interface PermissionRowHeaderProps {
  row: MatrixRow;
  label: string;
}

export function PermissionRowHeader({ row, label }: PermissionRowHeaderProps) {
  const { t } = useTranslation();
  const gate = row.gate;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium leading-tight">{label}</span>
        <EnforcementBadge enforced={row.enforced} />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {row.capability !== null && (
          <span
            className="rounded-[5px] border border-border/70 bg-muted/40 px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
            title={t("adminPermissions.table.flagColumn")}
          >
            {row.capability}
          </span>
        )}
        {gate === null ? (
          <span className="text-[10px] text-muted-foreground/80">
            {t("adminPermissions.gate.none")}
          </span>
        ) : (
          <>
            {gate.objects.map((object, index) => (
              <GateChip
                key={gate.refs[index]}
                object={object}
                kind={gate.kinds[index]}
                securityDefiner={gate.securityDefiner}
              />
            ))}
            <TenantScopeBadge tenantRef={gate.tenantRef} />
            {gate.mode !== "any" && gate.mode !== "none" && (
              <span
                className="rounded-full border border-border px-1.5 py-0 text-[10px] text-muted-foreground"
                title={t(`adminPermissions.gateMode.${gate.mode}Hint`)}
              >
                {t(`adminPermissions.gateMode.${gate.mode}`)}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
