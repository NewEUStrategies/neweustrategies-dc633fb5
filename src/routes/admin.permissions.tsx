// /admin/permissions - macierz uprawnień.
//
// CO SIĘ ZMIENIŁO WOBEC AUDYTU: strona była referencyjną tabelką wpisaną z ręki -
// nie wynikała z kodu ani z bazy, więc mogła rozjechać się z rzeczywistością bez
// żadnego sygnału (i rozjechała się: obiecywała subskrybentów "free/basic/premium/
// enterprise", których w katalogu warstw nigdy nie było). Teraz:
//
//   - kolumny ról      <- enum public.app_role + snapshot bramek SQL,
//   - kolumny warstw   <- membership_tiers BIEŻĄCEGO obszaru roboczego (tenant_id),
//   - poziomy w komórkach <- role wymienione przez bramkę / flagi features warstwy,
//   - "Egzekwowana / Dekoracyjna" <- czy jakakolwiek bramka czyta daną flagę.
//
// Rozjazd snapshotu z migracjami wywala test parytetu (CI), więc strona nie może
// po cichu skłamać. Odświeżenie snapshotu: `bun run generate:authz-snapshot`.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers, ShieldCheck, ShieldQuestion, Info, ListChecks } from "lucide-react";
import { AUTHZ_SNAPSHOT } from "@/lib/authz/authzSnapshot.generated";
import {
  EMPTY_MATRIX_FILTER,
  buildPermissionMatrix,
  filterMatrix,
  groupRows,
  rowLabel,
  type MatrixFilter,
} from "@/lib/authz/permissionMatrix";
import { PERMISSION_GROUPS } from "@/lib/authz/permissionRows";
import { useTenantMembershipTiers } from "@/lib/authz/permissionMatrixQuery";
import { MatrixKpiTile } from "@/components/admin/permissions/atoms";
import {
  PermissionMatrixLegend,
  PermissionMatrixToolbar,
} from "@/components/admin/permissions/molecules";
import {
  PermissionActorGrid,
  PermissionMatrixTable,
  PermissionSourceNotice,
} from "@/components/admin/permissions/organisms";
import { useLang } from "@/lib/i18n/useLang";
import { ensureI18n as ensureAdminPermissionsI18n } from "@/lib/i18n-admin-permissions";

export const Route = createFileRoute("/admin/permissions")({
  component: PermissionsMatrixPage,
});

function PermissionsMatrixPage() {
  ensureAdminPermissionsI18n();
  const { t } = useTranslation();
  const lang = useLang();
  const { tiers, isLoading, error } = useTenantMembershipTiers();
  const [filter, setFilter] = useState<MatrixFilter>(EMPTY_MATRIX_FILTER);

  // Macierz przelicza się wyłącznie po zmianie warstw tenanta - snapshot bramek
  // jest stały w runtime (pochodzi z migracji, nie z sieci).
  const matrix = useMemo(() => buildPermissionMatrix({ tiers }), [tiers]);

  // `t` zmienia tożsamość przy zmianie języka, więc filtrowanie po etykiecie
  // automatycznie przelicza się dla PL i EN - bez ręcznego zależenia od `lang`.
  const { actors, rows } = useMemo(
    () => filterMatrix(matrix, filter, (row) => rowLabel(row, (key) => t(key))),
    [matrix, filter, t],
  );
  const sections = useMemo(() => groupRows(rows, PERMISSION_GROUPS), [rows]);

  const canReset =
    filter.query !== "" ||
    filter.actorKind !== "all" ||
    filter.onlyEnforced ||
    filter.group !== "all";

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-4">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
            <ShieldCheck className="h-6 w-6 text-brand" aria-hidden="true" />
            {t("adminPermissions.title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("adminPermissions.subtitle")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <MatrixKpiTile
            icon={ListChecks}
            label={t("adminPermissions.kpi.rows")}
            value={String(matrix.summary.rows)}
          />
          <MatrixKpiTile
            icon={ShieldCheck}
            label={t("adminPermissions.kpi.enforced")}
            value={String(matrix.summary.enforcedRows)}
          />
          <MatrixKpiTile
            icon={Info}
            label={t("adminPermissions.kpi.decorative")}
            value={String(matrix.summary.decorativeRows)}
          />
          <MatrixKpiTile
            icon={Layers}
            label={t("adminPermissions.kpi.tiers")}
            value={String(matrix.summary.tiers)}
          />
          <MatrixKpiTile
            icon={ShieldQuestion}
            tone={matrix.summary.gatesWithoutCallerTenant > 0 ? "warning" : "default"}
            label={t("adminPermissions.kpi.gatesWithoutCallerTenant")}
            value={String(matrix.summary.gatesWithoutCallerTenant)}
            title={t("adminPermissions.tenant.rowHint")}
          />
        </div>

        <PermissionSourceNotice stats={AUTHZ_SNAPSHOT.stats} />
      </header>

      <PermissionMatrixToolbar
        filter={filter}
        onChange={setFilter}
        resultCount={rows.length}
        canReset={canReset}
      />

      <PermissionMatrixLegend />

      <PermissionActorGrid matrix={matrix} actors={actors} lang={lang} />

      {error !== null && (
        <p className="rounded-[6px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {t("adminPermissions.empty.error")}
        </p>
      )}
      {error === null && isLoading && (
        <p className="text-xs text-muted-foreground">{t("adminPermissions.empty.loading")}</p>
      )}
      {error === null && !isLoading && tiers.length === 0 && (
        <p className="rounded-[6px] border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t("adminPermissions.empty.tiers")}
        </p>
      )}

      <PermissionMatrixTable actors={actors} sections={sections} lang={lang} />
    </div>
  );
}
