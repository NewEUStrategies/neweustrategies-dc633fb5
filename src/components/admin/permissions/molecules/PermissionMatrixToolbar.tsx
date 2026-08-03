// Molekuła: pasek filtrów macierzy.
//
// Stan filtra jest sterowany z zewnątrz (MatrixFilter), a samo zawężanie robi
// czysta funkcja filterMatrix - dzięki temu logika jest testowana bez DOM-u, a
// ten komponent odpowiada wyłącznie za wejście użytkownika i a11y.
import { RotateCcw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl } from "@/components/atoms/SegmentedControl";
import { cn } from "@/lib/utils";
import { PERMISSION_GROUPS, type PermissionGroupId } from "@/lib/authz/permissionRows";
import type { ActorKind, MatrixFilter } from "@/lib/authz/permissionMatrix";

export interface PermissionMatrixToolbarProps {
  filter: MatrixFilter;
  onChange: (next: MatrixFilter) => void;
  /** Liczba wierszy po zawężeniu - komunikat dla czytników i dla oka. */
  resultCount: number;
  canReset: boolean;
  className?: string;
}

export function PermissionMatrixToolbar({
  filter,
  onChange,
  resultCount,
  canReset,
  className,
}: PermissionMatrixToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={filter.query}
          onChange={(event) => onChange({ ...filter, query: event.target.value })}
          placeholder={t("adminPermissions.toolbar.search")}
          aria-label={t("adminPermissions.toolbar.searchLabel")}
          className="h-8 pl-8 text-sm"
        />
      </div>

      <SegmentedControl<ActorKind | "all">
        value={filter.actorKind}
        ariaLabel={t("adminPermissions.toolbar.actorAll")}
        size="md"
        onChange={(actorKind) => onChange({ ...filter, actorKind })}
        options={[
          { value: "all", label: t("adminPermissions.toolbar.actorAll") },
          { value: "role", label: t("adminPermissions.toolbar.actorRole") },
          { value: "tier", label: t("adminPermissions.toolbar.actorTier") },
        ]}
      />

      <Select
        value={filter.group}
        onValueChange={(value) =>
          onChange({ ...filter, group: value as PermissionGroupId | "all" })
        }
      >
        <SelectTrigger
          className="h-8 w-[200px] text-xs"
          aria-label={t("adminPermissions.toolbar.groupAll")}
        >
          <SelectValue placeholder={t("adminPermissions.toolbar.groupAll")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("adminPermissions.toolbar.groupAll")}</SelectItem>
          {PERMISSION_GROUPS.map((group) => (
            <SelectItem key={group} value={group}>
              {t(`adminPermissions.groups.${group}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={filter.onlyEnforced}
          onCheckedChange={(onlyEnforced) => onChange({ ...filter, onlyEnforced })}
          aria-label={t("adminPermissions.toolbar.onlyEnforced")}
        />
        {t("adminPermissions.toolbar.onlyEnforced")}
      </label>

      <span className="text-xs text-muted-foreground" aria-live="polite">
        {t("adminPermissions.toolbar.results", { count: resultCount })}
      </span>

      {canReset && (
        <button
          type="button"
          onClick={() =>
            onChange({ query: "", actorKind: "all", onlyEnforced: false, group: "all" })
          }
          className="inline-flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          {t("adminPermissions.toolbar.reset")}
        </button>
      )}
    </div>
  );
}
