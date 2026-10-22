// Zakładka „Kontakty” panelu kroku i ścieżki (S8, SPEC §6.3; montuje ją S8.3
// pod `?node=<id>&tab=contacts`) - zapisy kontaktów: status, bieżący krok,
// wejście, następne wykonanie, powód wyjścia, wersja, oznaczenie testu.
//
// DANE OSOBOWE. Adres e-mail kontaktu przychodzi wyłącznie przez
// `getJourneyEnrollments` (`requireCrmStaff`: admin/redaktor + `aal2` dla kont
// z MFA). Bez drugiego składnika serwer odmawia - zakładka pokazuje wtedy
// `MfaRequiredNotice`, a nie błąd odczytu. Najemca nigdy nie jedzie
// w parametrach - zawęża go sesja.
//
// FILTR I STRONY W STANIE KARTY. Status zapisu i numer strony (po 50,
// `keepPreviousData` - tabela nie mruga przy przełączaniu strony) są
// stanem panelu, nie adresu: adres edytora niesie krok i zakładkę, a link
// „strona 3 kontaktów kroku 4.2” nie jest czymś, co ktoś wysyła koledze.
//
// AKCJE WG RÓL (lustro bramek serwera, `journeyCapabilities`):
//   * „Wyjmij” (`exitJourneyEnrollment`, `requireCrmStaff`) - admin i
//     redaktor, dla zapisów w toku;
//   * „Pomiń czekanie” (`skipJourneyWait`, `requireAdmin`) - tylko admin.
//     Redaktor widzi przycisk wyłączony (`aria-disabled`, fokus zostaje) z
//     wyjaśnieniem w `aria-describedby` - wie, że akcja istnieje i kto ją
//     wykona, zamiast szukać jej w panelu.
// Obie akcje idą przez `ConfirmDialog`; wynik `ok:false` tłumaczymy kodem
// i powodem RPC (`not_waiting` - kontakt już ruszył dalej).
import { useId, useMemo, useState } from "react";
import { Link, useHydrated } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { Button } from "@/components/ui/button";
import { PlatformSelect } from "@/components/ui/platform-select";
import { useAuth } from "@/hooks/useAuth";
import {
  isMfaRequiredError,
  journeyAccessDenial,
  journeyCapabilities,
} from "@/lib/admin/journeys/access";
import {
  mutationErrorText,
  useExitJourneyEnrollment,
  useSkipJourneyWait,
} from "@/lib/admin/journeys/journeyMutations";
import { journeyDetailQueryOptions } from "@/lib/admin/journeys/journeyQueries";
import { journeyPageCount } from "@/lib/admin/journeys/results";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { chartLangFrom } from "@/lib/charts/format";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-results";
import type { JourneyEnrollmentRow } from "@/lib/journeys/dto";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { JOURNEY_ENROLLMENT_STATUSES, type JourneyEnrollmentStatus } from "@/lib/journeys/limits";
import { journeyEnrollmentsQueryOptions } from "@/lib/journeys/queries";
import { useJourneyStepLabel } from "./JourneyResults";

export interface JourneyEnrollmentsTableProps {
  journeyId: string;
  /** Krok panelu; `null` = wszystkie zapisy ścieżki. */
  nodeId?: string | null;
}

/** Zapis w toku - tylko taki da się wyjąć ze ścieżki. */
function inProgress(row: JourneyEnrollmentRow): boolean {
  return row.status === "active" || row.status === "waiting";
}

function contactName(row: JourneyEnrollmentRow): string {
  return row.leadName?.trim() || row.leadEmail;
}

export function JourneyEnrollmentsTable({
  journeyId,
  nodeId = null,
}: JourneyEnrollmentsTableProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="journey-enrollments" data-node-id={nodeId ?? undefined} className="space-y-3">
      {hydrated ? (
        // Nowy krok = nowa karta: filtr i strona z poprzedniego kroku nie
        // mają sensu dla innego zbioru zapisów.
        <EnrollmentsContent key={nodeId ?? ""} journeyId={journeyId} nodeId={nodeId} />
      ) : (
        <RevenueTabPending />
      )}
    </div>
  );
}

function EnrollmentsContent({ journeyId, nodeId }: { journeyId: string; nodeId: string | null }) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const { roles, tenantId } = useAuth();
  const tenant = tenantId ?? null;
  const caps = journeyCapabilities(roles);
  const headingId = useId();
  const statusId = useId();
  const skipHintId = useId();
  const [status, setStatus] = useState<JourneyEnrollmentStatus | null>(null);
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const stepLabel = useJourneyStepLabel();
  const enabled = caps.canEdit && tenant !== null;

  const query = useQuery({
    ...journeyEnrollmentsQueryOptions(journeyId, nodeId, status, page),
    enabled,
  });
  const detail = useQuery({ ...journeyDetailQueryOptions(journeyId), enabled });
  const graph = detail.data?.state === "ready" ? (detail.data.data.draft?.graph ?? null) : null;
  const view = useMemo(() => buildJourneyView(graph), [graph]);
  const exit = useExitJourneyEnrollment(tenant, journeyId);
  const skip = useSkipJourneyWait(tenant, journeyId);

  if (!caps.canEdit) return <RoleGateNotice requiredRole="admin_or_editor" />;
  const denial = journeyAccessDenial(query.error);
  if (mfaRequired || denial === "mfa_required") return <MfaRequiredNotice />;
  if (denial === "role" || query.data?.state === "forbidden") {
    return <RoleGateNotice requiredRole="admin_or_editor" />;
  }
  if (query.data?.state === "unavailable") {
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("adminJourneys.enrollments.unavailable")}
      </p>
    );
  }

  const pageData = query.data?.state === "ready" ? query.data.data : null;
  const rows = pageData?.rows ?? [];
  const pages = pageData ? journeyPageCount(pageData.total, pageData.pageSize) : 1;

  /** Nazwa bieżącego kroku z numeracji kanwy; krok spoza szkicu - surowy identyfikator. */
  const nodeText = (id: string | null) => {
    if (!id) return "—";
    const node = view.nodes.get(id);
    return node ? stepLabel({ number: node.number, type: node.type }) : id;
  };

  const runExit = async (row: JourneyEnrollmentRow) => {
    try {
      const result = await exit.mutateAsync({ enrollmentId: row.id, leadId: row.leadId });
      if (result.ok) toast.success(t("adminJourneys.enrollments.exitDone"));
      else toast.error(mutationErrorText(t, result));
    } catch (error) {
      if (isMfaRequiredError(error)) setMfaRequired(true);
      else toast.error(t("adminJourneys.enrollments.exitError"));
    }
  };

  const runSkip = async (row: JourneyEnrollmentRow) => {
    try {
      const result = await skip.mutateAsync({ enrollmentId: row.id });
      if (result.ok) toast.success(t("adminJourneys.enrollments.skipDone"));
      else toast.error(mutationErrorText(t, result));
    } catch (error) {
      if (isMfaRequiredError(error)) setMfaRequired(true);
      else toast.error(t("adminJourneys.enrollments.skipError"));
    }
  };

  const askExit = (row: JourneyEnrollmentRow) =>
    setConfirm({
      title: t("adminJourneys.enrollments.exitConfirmTitle"),
      description: t("adminJourneys.enrollments.exitConfirmBody", {
        name: contactName(row),
        reason: t(journeyLabelKey("exitReason", "manual")),
      }),
      confirmLabel: t("adminJourneys.enrollments.exitConfirm"),
      cancelLabel: t("adminJourneys.common.cancel"),
      destructive: true,
      onConfirm: () => runExit(row),
    });

  const askSkip = (row: JourneyEnrollmentRow) =>
    setConfirm({
      title: t("adminJourneys.enrollments.skipConfirmTitle"),
      description: t("adminJourneys.enrollments.skipConfirmBody", { name: contactName(row) }),
      confirmLabel: t("adminJourneys.enrollments.skipConfirm"),
      cancelLabel: t("adminJourneys.common.cancel"),
      onConfirm: () => runSkip(row),
    });

  const anyWaiting = rows.some((row) => row.status === "waiting");

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="m-0 text-sm font-semibold">
        {t("adminJourneys.enrollments.title")}
      </h3>
      <p className="m-0 text-xs text-muted-foreground">
        {t("adminJourneys.enrollments.description")}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={statusId} className="text-xs text-muted-foreground">
          {t("adminJourneys.enrollments.statusFilter")}
        </label>
        <PlatformSelect
          id={statusId}
          value={status ?? ""}
          className="h-8 w-44 text-xs"
          onChange={(event) => {
            const value = event.target.value;
            setStatus(
              (JOURNEY_ENROLLMENT_STATUSES as readonly string[]).includes(value)
                ? (value as JourneyEnrollmentStatus)
                : null,
            );
            setPage(0);
          }}
        >
          <option value="">{t("adminJourneys.enrollments.statusAll")}</option>
          {JOURNEY_ENROLLMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(journeyLabelKey("enrollmentStatus", value))}
            </option>
          ))}
        </PlatformSelect>
        {pageData ? (
          <span className="text-xs text-muted-foreground" data-testid="journey-enrollments-total">
            {t("adminJourneys.enrollments.total", {
              count: pageData.total,
              value: formatNumber(pageData.total, lang),
            })}
          </span>
        ) : null}
      </div>

      {!caps.canSkipWait && anyWaiting ? (
        <p
          id={skipHintId}
          className="m-0 flex items-center gap-1 text-[11px] text-muted-foreground"
        >
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("adminJourneys.enrollments.skipAdminOnly")}
        </p>
      ) : null}

      {query.isError ? (
        <div role="alert" className="space-y-2 text-sm">
          <p className="m-0 text-destructive">{t("adminJourneys.enrollments.loadError")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => void query.refetch()}
          >
            {t("adminJourneys.common.retry")}
          </Button>
        </div>
      ) : !pageData ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.enrollments.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {nodeId ? t("adminJourneys.enrollments.emptyNode") : t("adminJourneys.enrollments.empty")}
        </p>
      ) : (
        <div
          role="region"
          aria-label={t("adminJourneys.enrollments.scrollRegion")}
          tabIndex={0}
          className="overflow-x-auto rounded-[6px] border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <table className="w-full min-w-[880px] text-left text-xs">
            <caption className="sr-only">{t("adminJourneys.enrollments.caption")}</caption>
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.enrollments.columns.contact")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.enrollments.columns.status")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.enrollments.columns.step")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.enrollments.columns.entered")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.enrollments.columns.next")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.enrollments.columns.reason")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.enrollments.columns.version")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("adminJourneys.enrollments.columns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = contactName(row);
                return (
                  <tr
                    key={row.id}
                    data-enrollment-id={row.id}
                    data-status={row.status}
                    className="border-t border-border"
                  >
                    <th scope="row" className="px-3 py-2 align-top font-normal">
                      <Link
                        to="/admin/crm/$id"
                        params={{ id: row.leadId }}
                        aria-label={t("adminJourneys.enrollments.openLead", { name })}
                        className="font-medium text-foreground hover:underline focus-visible:underline"
                      >
                        {name}
                      </Link>
                      <span className="block break-all text-[11px] text-muted-foreground">
                        {row.leadEmail}
                      </span>
                      {row.isTest ? (
                        <span className="mt-0.5 inline-flex rounded-full border border-border px-1.5 text-[10px] font-medium">
                          {t("adminJourneys.enrollments.test")}
                        </span>
                      ) : null}
                    </th>
                    <td className="px-3 py-2 align-top">
                      {t(journeyLabelKey("enrollmentStatus", row.status))}
                    </td>
                    <td className="px-3 py-2 align-top">{nodeText(row.currentNodeId)}</td>
                    <td className="px-3 py-2 align-top tabular-nums">
                      {formatDateTime(row.enteredAt, lang)}
                    </td>
                    <td className="px-3 py-2 align-top tabular-nums">
                      {row.nextRunAt ? formatDateTime(row.nextRunAt, lang) : "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {row.exitReason ? t(journeyLabelKey("exitReason", row.exitReason)) : "—"}
                    </td>
                    <td className="px-3 py-2 align-top tabular-nums">
                      {t("adminJourneys.enrollments.versionValue", { version: row.version })}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <div className="flex flex-wrap justify-end gap-1">
                        {row.status === "waiting" ? (
                          caps.canSkipWait ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              disabled={skip.isPending}
                              aria-label={t("adminJourneys.enrollments.skipFor", { name })}
                              onClick={() => askSkip(row)}
                            >
                              {t("adminJourneys.enrollments.skip")}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 opacity-60"
                              aria-disabled="true"
                              aria-describedby={skipHintId}
                              aria-label={t("adminJourneys.enrollments.skipFor", { name })}
                              data-locked="admin"
                            >
                              {t("adminJourneys.enrollments.skip")}
                            </Button>
                          )
                        ) : null}
                        {inProgress(row) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            disabled={exit.isPending}
                            aria-label={t("adminJourneys.enrollments.exitFor", { name })}
                            onClick={() => askExit(row)}
                          >
                            {t("adminJourneys.enrollments.exit")}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageData && pages > 1 ? (
        <nav
          aria-label={t("adminJourneys.enrollments.pagination")}
          className="flex items-center justify-end gap-2 text-xs"
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            {t("adminJourneys.enrollments.prev")}
          </Button>
          <span aria-live="polite" className="tabular-nums text-muted-foreground">
            {t("adminJourneys.enrollments.pageOf", { page: page + 1, pages })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            disabled={page + 1 >= pages}
            onClick={() => setPage((current) => current + 1)}
          >
            {t("adminJourneys.enrollments.next")}
          </Button>
        </nav>
      ) : null}

      <ConfirmDialog
        state={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      />
    </section>
  );
}
