// Organizm: tabela macierzy uprawnień.
//
// Wiersze i kolumny przychodzą gotowe (już zawężone filtrem) - tu liczy się tylko
// prezentacja: przyklejony nagłówek i przyklejona pierwsza kolumna, żeby przy 40+
// pozycjach i kilkunastu kolumnach dało się czytać bez gubienia kontekstu, oraz
// poziomy scroll wyłącznie WEWNĄTRZ tabeli (strona nigdy nie jedzie w poprzek).
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { PermissionLevelCell } from "../atoms";
import { PermissionRowHeader } from "../molecules";
import { cn } from "@/lib/utils";
import type { AppLang } from "@/lib/i18n/localePath";
import {
  actorName,
  rowLabel,
  type MatrixActor,
  type MatrixRow,
} from "@/lib/authz/permissionMatrix";
import type { PermissionGroupId } from "@/lib/authz/permissionRows";

export interface PermissionMatrixSection {
  readonly group: PermissionGroupId;
  readonly rows: readonly MatrixRow[];
}

export interface PermissionMatrixTableProps {
  actors: readonly MatrixActor[];
  sections: readonly PermissionMatrixSection[];
  lang: AppLang;
  className?: string;
}

export function PermissionMatrixTable({
  actors,
  sections,
  lang,
  className,
}: PermissionMatrixTableProps) {
  const { t } = useTranslation();
  const translate = (key: string): string => t(key);
  const columnCount = actors.length + 1;
  const isEmpty = sections.every((section) => section.rows.length === 0);

  return (
    <section
      className={cn("overflow-hidden rounded-[6px] border border-border bg-card", className)}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("adminPermissions.table.caption")}</caption>
          <thead>
            <tr className="bg-muted/60">
              <th
                scope="col"
                className="sticky left-0 z-20 min-w-[280px] border-b border-border bg-muted/60 px-3 py-2 text-left font-semibold"
              >
                {t("adminPermissions.table.capability")}
              </th>
              {actors.map((actor) => (
                <th
                  key={actor.id}
                  scope="col"
                  className="whitespace-nowrap border-b border-l border-border/60 px-2 py-2 text-center font-semibold"
                >
                  <span className="flex flex-col items-center gap-0.5">
                    <span>{actorName(actor, lang, translate)}</span>
                    <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                      {t(
                        actor.kind === "role"
                          ? "adminPermissions.roleBadge"
                          : "adminPermissions.tierBadge",
                      )}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              // Fragment MUSI mieć klucz - bez tego React nie potrafi
              // zidentyfikować sekcji przy filtrowaniu (i sypie ostrzeżeniem).
              <Fragment key={section.group}>
                <tr className="bg-muted/30">
                  <th
                    scope="colgroup"
                    colSpan={columnCount}
                    className="sticky left-0 border-b border-border px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t(`adminPermissions.groups.${section.group}`)}
                  </th>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.id} className="group/row transition-colors hover:bg-muted/20">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-border/60 bg-card px-3 py-2 text-left font-normal group-hover/row:bg-muted/20"
                    >
                      <PermissionRowHeader row={row} label={rowLabel(row, translate)} />
                    </th>
                    {actors.map((actor) => (
                      <td
                        key={actor.id}
                        className="border-b border-l border-border/60 px-2 py-2 text-center"
                      >
                        <PermissionLevelCell
                          level={row.levels[actor.id] ?? "not_applicable"}
                          quota={row.quota?.[actor.id]}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
            {isEmpty && (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {t("adminPermissions.empty.rows")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
