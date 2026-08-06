// Atom: z KTÓREJ migracji pochodzi żywa definicja bramki.
//
// Migracje są forward-only, więc o stanie bazy decyduje OSTATNIA definicja funkcji
// (albo ostatnia operacja na polityce). Bez tej informacji strona odpowiadała na
// pytanie „kto może", ale nie na „od kiedy i czym" - a to drugie jest w audycie
// pierwszym pytaniem po każdej zmianie uprawnień. Pole `file` było w snapshocie od
// początku i to właśnie jego dryf dawał w bramce parytetu komunikat „bramka
// rozjechała się" z dwoma identycznymi obiektami; teraz jest widoczne również tam,
// gdzie ktoś czyta uprawnienia, nie logi CI.
import { GitCommitVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { migrationProvenance } from "@/lib/authz/permissionMatrix";

export interface GateProvenanceChipProps {
  /** Nazwa pliku migracji ze snapshotu bramek. */
  file: string;
  className?: string;
}

export function GateProvenanceChip({ file, className }: GateProvenanceChipProps) {
  const { t } = useTranslation();
  const { version, date } = migrationProvenance(file);

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-[5px] border border-border/60 bg-background px-1.5 py-0 text-[10px] text-muted-foreground",
        className,
      )}
      title={`${t("adminPermissions.gate.provenanceHint")} ${file}`}
    >
      <GitCommitVertical className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t("adminPermissions.gate.provenance")}: </span>
      <span className="truncate font-mono">{date ?? version}</span>
    </span>
  );
}
