// Organizm: macierz plan × benefit z konfliktami P20 (SPEC §2.2 `offer`,
// §6.1, §6.8; model `planBenefitMatrix.ts`).
//
// SKĄD DANE. Plany i ich warstwy - macierz oferty S2
// (`revenueOfferMatrixQueryOptions`, czyta też redaktor); obietnice i flagi
// warstw - katalog warstw (`adminMembershipTiersQueryOptions`, ten sam wpis
// cache co Cennik i Członkostwo, więc poprawka benefitu w Cenniku od razu
// zmienia macierz). Nazwy uprawnień ze słownika Członkostwa - te same słowa
// co przełączniki warstwy.
//
// DWA UKŁADY, JEDEN ZNACZNIK. Od 768 px tabela (`caption`, nagłówki `scope`,
// przewijany region z fokusem), poniżej - `Accordion` z jednym planem na
// pozycję. Oba są w znaczniku od początku i przełącza je CSS (`md:`), więc
// serwer i klient rysują to samo (bez pomiaru szerokości w JS).
//
// STAN KOMÓRKI SŁOWEM I IKONĄ: ikona jest dekoracją, nazwa stanu jest w
// tekście (dla czytnika) i w legendzie - kolor nigdy nie jest jedynym
// nośnikiem (WCAG 1.4.1).
//
// EDYCJA PRZEZ ORGANIZM MODUŁU. „Edytuj plan" otwiera `AccessPlanEditorDialog`
// (paywall, S1) - ten sam formularz, mutator i obsługa konfliktu co w module.
// Redaktor widzi macierz w trybie podglądu: przycisk jest wyłączony, a powód
// podaje `DisabledReason` (fokusowalna podpowiedź `Tooltip`).
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { adminMembershipTiersQueryOptions } from "@/components/admin/membership/membershipQueries";
import { AccessPlanEditorDialog } from "@/components/admin/paywall/AccessPlanEditorDialog";
import { DisabledReason } from "@/components/admin/pricing/atoms/DisabledReason";
import { SourceHeader } from "@/components/admin/revenue/molecules/SourceHeader";
import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { formatMoneyMinor } from "@/lib/analytics/semantic/format";
import { enabledFeatureKeys } from "@/lib/billing/capabilities";
import { parseTierBenefits, tierName } from "@/lib/billing/tiers";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureMembershipI18n } from "@/lib/i18n-admin-membership";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueOfferMatrixQueryOptions } from "@/lib/revenue/finance/queries";
import {
  INTERVAL_KEY,
  planBenefitMatrix,
  type BenefitCell,
  type MatrixColumn,
  type MatrixTier,
} from "./planBenefitMatrix";

const CELL_KEY: Readonly<Record<BenefitCell, string>> = {
  ok: "adminRevenue.offer.matrix.cell.ok",
  broken: "adminRevenue.offer.matrix.cell.broken",
  decorative: "adminRevenue.offer.matrix.cell.decorative",
  silent: "adminRevenue.offer.matrix.cell.silent",
  none: "adminRevenue.offer.matrix.cell.none",
};

const CELL_ICON = {
  ok: CheckCircle2,
  broken: XCircle,
  decorative: AlertTriangle,
  silent: Info,
} as const;

export interface PlanBenefitMatrixProps {
  tenantId: string | null;
  /** Dokładne role sesji - zapis wyłącznie dla administratora. */
  roles: readonly string[];
}

/** Znak komórki; `label` pusty = znak w legendzie, gdzie nazwa stoi obok jako tekst. */
function CellMark({ cell, label }: { cell: BenefitCell; label: string }) {
  if (cell === "none") {
    return (
      <>
        <span aria-hidden="true" className="text-muted-foreground">
          -
        </span>
        <span className="sr-only">{label}</span>
      </>
    );
  }
  const Icon = CELL_ICON[cell];
  return (
    <span className="inline-flex items-center gap-1" title={label || undefined}>
      <Icon
        aria-hidden="true"
        className={
          cell === "broken"
            ? "h-4 w-4 shrink-0 text-destructive"
            : cell === "decorative"
              ? "h-4 w-4 shrink-0 text-brand-ink dark:text-brand"
              : "h-4 w-4 shrink-0 text-muted-foreground"
        }
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export function PlanBenefitMatrix({ tenantId, roles }: PlanBenefitMatrixProps) {
  ensureMembershipI18n();
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const captionId = useId();
  const isAdmin = roles.includes("admin");
  const [editing, setEditing] = useState<string | null>(null);
  const offerQ = useQuery(revenueOfferMatrixQueryOptions(tenantId));
  const tiersQ = useQuery({ ...adminMembershipTiersQueryOptions(), enabled: Boolean(tenantId) });
  const status = cardStatusOf(offerQ, tenantId);

  const tierRows = tiersQ.data;
  const model = useMemo(() => {
    if (offerQ.data?.state !== "ready" || tierRows === undefined) return null;
    const tiers: MatrixTier[] = tierRows.map((row) => ({
      key: row.key,
      rank: row.rank,
      featureKeys: enabledFeatureKeys(row.features),
      capabilityKeys: parseTierBenefits(row.benefits).flatMap((b) =>
        b.capability_key ? [b.capability_key] : [],
      ),
    }));
    return planBenefitMatrix(
      offerQ.data.data.plans.map((p) => ({
        planId: p.planId,
        tierKey: p.tierKey,
        interval: p.interval,
        priceCents: p.priceCents,
        currency: p.currency,
        active: p.active,
        forSale: p.forSale,
      })),
      tiers,
    );
  }, [offerQ.data, tierRows]);

  const capabilityLabel = (key: string) => {
    const labelKey = `adminMembership.capabilities.labels.${key}`;
    return i18n.exists(labelKey) ? t(labelKey) : key;
  };
  const tierLabel = (key: string | null) => {
    const row = key ? tierRows?.find((r) => r.key === key) : undefined;
    return row ? tierName(row, lang) : t("adminRevenue.offer.ladder.noTier");
  };
  const planLabel = (column: MatrixColumn) => {
    const interval = INTERVAL_KEY[column.plan.interval];
    return `${t("adminRevenue.offer.matrix.plan", {
      tier: tierLabel(column.plan.tierKey),
      interval: interval ? t(interval) : column.plan.interval,
    })} · ${formatMoneyMinor(column.plan.priceCents, column.plan.currency, lang)}`;
  };
  const editButton = (column: MatrixColumn) => {
    const name = planLabel(column);
    const reason = isAdmin ? null : t("adminRevenue.role.editorPreview");
    return (
      <DisabledReason reason={reason}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={!isAdmin}
          aria-label={t("adminRevenue.offer.matrix.editPlan", { plan: name })}
          onClick={() => setEditing(column.plan.planId)}
        >
          {t("adminRevenue.offer.matrix.edit")}
        </Button>
      </DisabledReason>
    );
  };

  let body;
  if (status !== "ready") {
    body = (
      <HubCardState
        status={status}
        forbiddenKey="adminRevenue.finance.state.forbidden"
        unavailableKey="adminRevenue.finance.state.unavailable"
        onRetry={() => void offerQ.refetch()}
      />
    );
  } else if (model === null) {
    body = tiersQ.isError ? (
      <HubCardState
        status="error"
        forbiddenKey="adminRevenue.finance.state.forbidden"
        unavailableKey="adminRevenue.finance.state.unavailable"
        onRetry={() => void tiersQ.refetch()}
      />
    ) : (
      <HubCardState
        status="loading"
        forbiddenKey="adminRevenue.finance.state.forbidden"
        unavailableKey="adminRevenue.finance.state.unavailable"
      />
    );
  } else if (model.columns.length === 0) {
    body = (
      <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.offer.matrix.empty")}</p>
    );
  } else {
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            className="m-0 text-sm font-medium"
            data-testid="matrix-conflicts"
            data-conflicts={model.conflicts}
          >
            {model.conflicts > 0
              ? t("adminRevenue.offer.matrix.conflicts", { count: model.conflicts })
              : t("adminRevenue.offer.matrix.noConflicts")}
          </p>
          {model.conflicts > 0 ? (
            <Button asChild size="sm" variant="outline" className="h-7">
              <Link to="/admin/pricing" search={{ tab: "tiers" }}>
                {t("adminRevenue.offer.matrix.fixBenefits")}
              </Link>
            </Button>
          ) : null}
        </div>

        <div
          role="region"
          tabIndex={0}
          aria-labelledby={captionId}
          data-testid="matrix-table"
          className="hidden overflow-x-auto rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:block"
        >
          <table className="w-full text-sm">
            <caption id={captionId} className="pb-2 text-left text-xs text-muted-foreground">
              {t("adminRevenue.offer.matrix.caption")}
            </caption>
            <thead>
              <tr className="align-bottom text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminRevenue.offer.matrix.capability")}
                </th>
                {model.columns.map((column) => (
                  <th
                    key={column.plan.planId}
                    scope="col"
                    data-plan={column.plan.planId}
                    className="min-w-[8rem] py-1 pr-3 font-medium"
                  >
                    <span className="block text-foreground">{planLabel(column)}</span>
                    {column.tier === null ? (
                      <span className="block font-normal">
                        {t("adminRevenue.offer.matrix.noTier")}
                      </span>
                    ) : null}
                    <span className="mt-1 block">{editButton(column)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {model.capabilities.map((capability, row) => (
                <tr key={capability} data-capability={capability}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    {capabilityLabel(capability)}
                  </th>
                  {model.columns.map((column) => {
                    const cell = column.cells[row] as BenefitCell;
                    return (
                      <td key={column.plan.planId} data-cell={cell} className="py-1 pr-3">
                        <CellMark cell={cell} label={t(CELL_KEY[cell])} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden" data-testid="matrix-accordion">
          <Accordion type="multiple">
            {model.columns.map((column) => (
              <AccordionItem key={column.plan.planId} value={column.plan.planId}>
                <AccordionTrigger className="text-sm">{planLabel(column)}</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {column.tier === null ? (
                      <p className="m-0 text-xs text-muted-foreground">
                        {t("adminRevenue.offer.matrix.noTier")}
                      </p>
                    ) : null}
                    <ul className="m-0 list-none space-y-1 p-0 text-sm">
                      {model.capabilities.map((capability, row) => {
                        const cell = column.cells[row] as BenefitCell;
                        return (
                          <li
                            key={capability}
                            data-cell={cell}
                            className="flex items-start justify-between gap-2"
                          >
                            <span>{capabilityLabel(capability)}</span>
                            <span className="text-right text-xs text-muted-foreground">
                              {t(CELL_KEY[cell])}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {editButton(column)}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        <ul
          aria-label={t("adminRevenue.offer.matrix.title")}
          className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted-foreground"
        >
          {(["ok", "broken", "decorative", "silent"] as const).map((cell) => (
            <li key={cell} className="inline-flex items-center gap-1">
              <CellMark cell={cell} label="" />
              {t(CELL_KEY[cell])}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="plan-benefit-matrix"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="min-w-0 space-y-0.5">
        <h3 id={headingId} className="text-sm font-semibold">
          {t("adminRevenue.offer.matrix.title")}
        </h3>
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.offer.matrix.description")}
        </p>
      </div>
      <SourceHeader entity="membership_tier" columns={["benefits", "features"]} />
      {body}
      <AccessPlanEditorDialog
        planId={editing}
        open={editing !== null && isAdmin}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </section>
  );
}
