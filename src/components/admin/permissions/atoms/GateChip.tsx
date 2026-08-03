// Atom: referencja bramki SQL (funkcja albo polityka RLS).
//
// Nazwa obiektu jest klikalnym "adresem" w bazie - audytor czyta wiersz macierzy
// i od razu wie, którą funkcję/politykę otworzyć, żeby zweryfikować twierdzenie.
// Dlatego chip pokazuje nazwę monospace, rodzaj bramki i to, czy funkcja omija
// RLS (SECURITY DEFINER) - w takim wypadku jej własna bramka roli jest JEDYNYM
// ograniczeniem.
import { FileCode2, ShieldAlert, TableProperties } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AuthzGateKind } from "@/lib/authz/authzSnapshotTypes";

export interface GateChipProps {
  object: string;
  kind: AuthzGateKind;
  securityDefiner?: boolean;
  className?: string;
}

export function GateChip({ object, kind, securityDefiner = false, className }: GateChipProps) {
  const { t } = useTranslation();
  const Icon = kind === "function" ? FileCode2 : TableProperties;
  const kindLabel = t(`adminPermissions.gate.${kind}`);

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-[5px] border border-border/70 bg-muted/40 px-1.5 py-0 text-[10px] text-muted-foreground",
        className,
      )}
      title={`${kindLabel}: ${object}${securityDefiner ? ` - ${t("adminPermissions.gate.definerHint")}` : ""}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate font-mono">{object}</span>
      {securityDefiner && (
        <ShieldAlert
          className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
      )}
    </span>
  );
}
