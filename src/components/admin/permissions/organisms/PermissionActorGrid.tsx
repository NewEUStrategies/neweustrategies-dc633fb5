// Organizm: siatka kart kolumn (role + warstwy obszaru roboczego).
//
// Karty są kontekstem dla tabeli: zanim ktoś zacznie czytać 60 wierszy, widzi
// kim są aktorzy i - dla warstw - ile z ich włączonych flag ma realną bramkę.
import { useTranslation } from "react-i18next";
import { PermissionActorCard } from "../molecules";
import { cn } from "@/lib/utils";
import type { AppLang } from "@/lib/i18n/localePath";
import {
  tierEnforcementCount,
  type MatrixActor,
  type PermissionMatrix,
} from "@/lib/authz/permissionMatrix";

export interface PermissionActorGridProps {
  matrix: PermissionMatrix;
  actors: readonly MatrixActor[];
  lang: AppLang;
  className?: string;
}

export function PermissionActorGrid({ matrix, actors, lang, className }: PermissionActorGridProps) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("adminPermissions.table.caption")}
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {actors.map((actor) => (
        <PermissionActorCard
          key={actor.id}
          actor={actor}
          lang={lang}
          enforcedFlags={actor.kind === "tier" ? tierEnforcementCount(matrix, actor.id) : undefined}
        />
      ))}
    </section>
  );
}
