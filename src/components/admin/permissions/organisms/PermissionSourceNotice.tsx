// Organizm: nota o pochodzeniu danych.
//
// To ODPOWIEDŹ NA AUDYT: wcześniej macierz była ręcznie wpisaną tabelką i nikt
// czytający stronę nie wiedział, czy patrzy na stan bazy, czy na czyjeś
// wyobrażenie z zeszłego kwartału. Teraz strona sama mówi, z czego powstała
// (liczby ze snapshotu), czym jest bramkowana (test parytetu) i jak ją odświeżyć.
import { DatabaseZap, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AuthzSnapshotStats } from "@/lib/authz/authzSnapshotTypes";

export interface PermissionSourceNoticeProps {
  stats: AuthzSnapshotStats;
  className?: string;
}

export function PermissionSourceNotice({ stats, className }: PermissionSourceNoticeProps) {
  const { t } = useTranslation();
  return (
    <aside
      className={cn(
        "rounded-[6px] border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <DatabaseZap className="h-3.5 w-3.5" aria-hidden="true" />
        {t("adminPermissions.sourceTitle")}
      </h2>
      <p>{t("adminPermissions.sourceBody")}</p>
      <p className="mt-1 font-mono text-[11px]">
        {t("adminPermissions.generatedFrom", {
          migrations: stats.migrations,
          functions: stats.functions,
          policies: stats.policies,
        })}
      </p>
      <p className="mt-2 flex items-start gap-1.5">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {t("adminPermissions.rlsNote")} {t("adminPermissions.tenantNote")}
        </span>
      </p>
    </aside>
  );
}
