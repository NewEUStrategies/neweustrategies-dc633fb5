import { adminPageHead } from "@/lib/adminPageHead";
import { AdminSelect } from "@/components/admin/blocks/AdminSelect";
// Admin -> Rozliczenia -> Stany rozliczeń i zwrotów. Filtry: zakres dat
// (natywne pola daty, wartości lokalne RRRR-MM-DD) i status.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getSettlementReport } from "@/lib/billing/settlementStatus.functions";
import {
  SETTLEMENT_STATUSES,
  dateRangeToIso,
  type SettlementFilter,
} from "@/lib/billing/settlementStatus";
import { ensureI18n } from "@/lib/i18n-admin-settlements";

export const Route = createFileRoute("/admin/billing-settlements")({
  head: () =>
    adminPageHead(
      "Settlement and refund states",
      "Filter payment settlements and refunds by date and status. New European Strategies administration.",
    ),
  component: AdminBillingSettlements,
});

function isStatus(v: string): v is SettlementFilter["status"] {
  return v === "all" || (SETTLEMENT_STATUSES as readonly string[]).includes(v);
}

function AdminBillingSettlements() {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<SettlementFilter>({ status: "all", from: "", to: "" });
  const locale = i18n.language?.startsWith("en") ? "en-GB" : "pl-PL";

  const load = useMutation({
    mutationFn: () => {
      const { fromIso, toIso } = dateRangeToIso(filter.from, filter.to);
      return getSettlementReport({ data: { status: filter.status, fromIso, toIso } });
    },
  });

  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);

  const field = "h-9 rounded-md border bg-background px-2 text-sm text-foreground";

  return (
    <div>
      <h2 className="font-display text-xl">{t("adminSettlements.title")}</h2>
      <p className="mb-5 mt-1 max-w-3xl text-sm text-muted-foreground">
        {t("adminSettlements.lead")}
      </p>

      <form
        className="mb-5 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          load.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("adminSettlements.from")}
          <input
            type="date"
            className={field}
            value={filter.from}
            max={filter.to || undefined}
            onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("adminSettlements.to")}
          <input
            type="date"
            className={field}
            value={filter.to}
            min={filter.from || undefined}
            onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("adminSettlements.status")}
          <AdminSelect
            className={field}
            value={filter.status}
            onChange={(e) => {
              const v = e.target.value;
              if (isStatus(v)) setFilter((f) => ({ ...f, status: v }));
            }}
          >
            <option value="all">{t("adminSettlements.all")}</option>
            {SETTLEMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`adminSettlements.statuses.${s}`)}
              </option>
            ))}
          </AdminSelect>
        </label>
        <Button type="submit" disabled={load.isPending}>
          {load.isPending ? t("adminSettlements.loading") : t("adminSettlements.apply")}
        </Button>
      </form>

      {load.isError && (
        <p className="mb-4 text-sm text-destructive">
          {load.error instanceof Error ? load.error.message : String(load.error)}
        </p>
      )}

      {load.data && (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {t("adminSettlements.count", { count: load.data.rows.length })}
          </p>
          {load.data.truncated && (
            <p className="mb-2 text-xs text-brand-ink dark:text-brand">
              {t("adminSettlements.truncated")}
            </p>
          )}
          {load.data.rows.length === 0 ? (
            <p className="rounded-md border p-4 text-sm text-muted-foreground">
              {t("adminSettlements.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">{t("adminSettlements.columns.date")}</th>
                    <th className="p-2">{t("adminSettlements.columns.order")}</th>
                    <th className="p-2">{t("adminSettlements.columns.status")}</th>
                    <th className="p-2 text-right">{t("adminSettlements.columns.amount")}</th>
                    <th className="p-2 text-right">{t("adminSettlements.columns.refunded")}</th>
                    <th className="p-2">{t("adminSettlements.columns.refundJob")}</th>
                  </tr>
                </thead>
                <tbody>
                  {load.data.rows.map((r) => (
                    <tr key={r.id} className="border-t align-top">
                      <td className="whitespace-nowrap p-2 text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString(locale)}
                      </td>
                      <td className="p-2">
                        <code className="break-all text-xs">{r.id}</code>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {r.kind}
                          {r.environment ? ` - ${r.environment}` : ""}
                        </span>
                      </td>
                      <td className="p-2">
                        {t(`adminSettlements.statuses.${r.status}`)}
                        {r.needsReview && (
                          <span className="mt-0.5 block text-xs text-destructive">
                            {t("adminSettlements.review")}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right">
                        {money(r.amountCents, r.currency)}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right">
                        {r.refundedCents > 0 ? money(r.refundedCents, r.currency) : "-"}
                      </td>
                      <td className="p-2 text-xs">
                        {r.refundJobState
                          ? t(`adminSettlements.jobs.${r.refundJobState}`, {
                              defaultValue: r.refundJobState,
                            })
                          : "-"}
                        {r.refundJobError && (
                          <span className="mt-0.5 block break-all text-muted-foreground">
                            {r.refundJobError}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
