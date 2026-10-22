// Karta testu A/B kroku `ab_split` (S8, SPEC §5.6 „A/B”, §6.3 „Wyniki”):
// wejścia, konwersje i udział obu ramion, werdykt z istotnością oraz decyzja
// „Zostaw A/B”.
//
// WERDYKT Z BAZY, NIE Z OKA. `journeyAbVerdict` bierze `z` testu dwóch
// proporcji policzony przez `admin_journey_stats`; poniżej 100 wejść na ramię
// karta mówi „za mało danych (n < 100)” - nawet gdy różnica wygląda na dużą.
// Miarą zwycięzcy jest cel albo kliknięcia (`winnerMetric`), nigdy otwarcia
// (Apple MPP zawyża je w obu ramionach - wskazówka Insidera).
//
// „ZOSTAW B” = NOWY SZKIC, NIE PUBLIKACJA. Decyzja to `ops.resolveSplit` na
// szkicu z `journeyDetailQueryOptions` (wagi 100/0, gałęzie i identyfikatory
// zostają - statystyki obu ramion nadal są czytelne) i zapis
// `useSaveJourneyDraft` z tokenem `updated_at` szkicu. Publikację robi admin
// w edytorze, z blokadami i podsumowaniem. Wyścig z edytorem w innej karcie
// kończy się `conflict`: karta wczytuje aktualny szkic i prosi o ponowny wybór,
// zamiast nadpisać cudze zmiany. Przycisk widzi tylko rola z prawem zapisu
// szkicu (`canEdit`).
import { useId, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { Button } from "@/components/ui/button";
import { isMfaRequiredError } from "@/lib/admin/journeys/access";
import { mutationErrorText, useSaveJourneyDraft } from "@/lib/admin/journeys/journeyMutations";
import { journeyDetailQueryOptions } from "@/lib/admin/journeys/journeyQueries";
import { JOURNEY_OP_LABEL_KEY, resolveSplit } from "@/lib/admin/journeys/ops";
import {
  journeyAbSummary,
  type JourneyAbArm,
  type JourneyAbNode,
} from "@/lib/admin/journeys/results";
import { translateSummary } from "@/lib/admin/journeys/summaries";
import { chartLangFrom, formatPercent } from "@/lib/charts/format";
import { formatNumber } from "@/lib/i18n/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-results";
import { journeyLabelKey } from "@/lib/journeys/labels";

type Variant = "A" | "B";

const KEEP_LABEL_KEY: Readonly<Record<Variant, string>> = {
  A: JOURNEY_OP_LABEL_KEY.keepA,
  B: JOURNEY_OP_LABEL_KEY.keepB,
};

export interface JourneyAbCardProps {
  journeyId: string;
  node: JourneyAbNode;
  /** Zapis szkicu (admin, redaktor) - bez niego karta tylko pokazuje wynik. */
  canEdit: boolean;
  /**
   * Po zapisie szkicu. Domyślnie przejście do kanwy edytora z zaznaczonym
   * krokiem podziału (tam admin publikuje szkic).
   */
  onDraftSaved?: (nodeId: string, variant: Variant) => void;
}

/** Punkty procentowe z jednym miejscem po przecinku („3,1”). */
function formatPoints(points: number, lang: "pl" | "en"): string {
  return formatNumber(points, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function JourneyAbCard({ journeyId, node, canEdit, onDraftSaved }: JourneyAbCardProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const navigate = useNavigate();
  const headingId = useId();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const detail = useQuery({ ...journeyDetailQueryOptions(journeyId), enabled: canEdit });
  const saveDraft = useSaveJourneyDraft(journeyId);

  const { verdict } = node;
  const arms: JourneyAbArm[] = verdict.kind === "no_data" ? [] : [verdict.a, verdict.b];
  const metric = verdict.kind === "no_data" ? null : verdict.metric;
  const verdictText = translateSummary(
    t,
    journeyAbSummary(verdict, (points) => formatPoints(points, lang)),
  );
  const leader = verdict.kind === "result" ? verdict.leader : null;

  const keep = async (variant: Variant) => {
    setError(null);
    const read = detail.data;
    if (read?.state !== "ready") {
      setError(t("adminJourneys.results.ab.saveError"));
      return;
    }
    const { draft, draftValid, definition } = read.data;
    if (!draftValid || !draft) {
      setError(t("adminJourneys.results.ab.draftInvalid"));
      return;
    }
    const op = resolveSplit(draft.graph, node.nodeId, variant, {
      triggerEventType: draft.settings.triggerEventType,
    });
    if (!op.ok) {
      setError(
        op.error === "node_missing" || op.error === "not_split"
          ? t("adminJourneys.results.ab.nodeMissing")
          : t("adminJourneys.results.ab.opError"),
      );
      return;
    }
    try {
      const result = await saveDraft.mutateAsync({
        expectedUpdatedAt: definition.updatedAt,
        draft: { ...draft, graph: op.graph },
      });
      if (result.ok) {
        // Toast, nie komunikat w karcie: domyślnie przechodzimy na kanwę, więc
        // karta znika razem z widokiem wyników.
        toast.success(t("adminJourneys.results.ab.saved", { variant }));
        if (onDraftSaved) onDraftSaved(node.nodeId, variant);
        else {
          void navigate({
            to: "/admin/revenue/journeys/$journeyId",
            params: { journeyId },
            search: { view: "canvas", node: node.nodeId },
          });
        }
        return;
      }
      if (result.error === "conflict") {
        // Cudzy zapis w innej karcie: wczytujemy aktualny szkic i token -
        // ponowny wybór pójdzie już na nowym grafie, nie nadpisze zmian.
        await detail.refetch();
        setError(t("adminJourneys.results.ab.conflict"));
        return;
      }
      setError(mutationErrorText(t, result));
    } catch (caught) {
      if (isMfaRequiredError(caught)) setMfaRequired(true);
      else setError(t("adminJourneys.results.ab.saveError"));
    }
  };

  const ask = (variant: Variant) =>
    setConfirm({
      title: t("adminJourneys.results.ab.confirmTitle", { variant }),
      description: t("adminJourneys.results.ab.confirmBody", { variant }),
      confirmLabel: t(KEEP_LABEL_KEY[variant]),
      cancelLabel: t("adminJourneys.common.cancel"),
      onConfirm: () => keep(variant),
    });

  return (
    <section
      aria-labelledby={headingId}
      data-testid="journey-ab-card"
      data-node-id={node.nodeId}
      data-verdict={verdict.kind}
      className="space-y-2 rounded-[6px] border border-border p-3"
    >
      <h3 id={headingId} className="m-0 flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
        {node.number
          ? t("adminJourneys.results.ab.title", { number: node.number })
          : t("adminJourneys.results.ab.titleOutside")}
      </h3>
      {metric ? (
        <p className="m-0 text-xs text-muted-foreground">
          {metric === "goal"
            ? t("adminJourneys.results.ab.metricGoal")
            : t("adminJourneys.results.ab.metricClick")}
        </p>
      ) : null}

      {arms.length > 0 ? (
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{t("adminJourneys.results.ab.caption")}</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t("adminJourneys.results.ab.columns.variant")}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                {t("adminJourneys.results.ab.columns.entered")}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                {t("adminJourneys.results.ab.columns.conversions")}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                {t("adminJourneys.results.ab.columns.rate")}
              </th>
            </tr>
          </thead>
          <tbody>
            {arms.map((arm) => (
              <tr key={arm.variant} data-variant={arm.variant} className="border-t border-border">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {t(journeyLabelKey("branch", arm.variant))}
                </th>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {formatNumber(arm.entered, lang)}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {formatNumber(arm.conversions, lang)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {arm.rate === null ? "—" : formatPercent(arm.rate, lang)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <p className="m-0 text-sm font-medium" data-testid="journey-ab-verdict">
        {verdictText}
      </p>
      <p className="m-0 text-[11px] text-muted-foreground">{t("adminJourneys.results.ab.hint")}</p>

      {mfaRequired ? <MfaRequiredNotice /> : null}

      {canEdit ? (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            {(["A", "B"] as const).map((variant) => (
              <Button
                key={variant}
                type="button"
                size="sm"
                variant={leader === variant ? "default" : "outline"}
                className="h-7"
                disabled={saveDraft.isPending || detail.isLoading}
                onClick={() => ask(variant)}
              >
                {t(KEEP_LABEL_KEY[variant])}
              </Button>
            ))}
          </div>
          <p className="m-0 text-[11px] text-muted-foreground">
            {t("adminJourneys.results.ab.keepHint")}
          </p>
        </div>
      ) : (
        <p className="m-0 text-[11px] text-muted-foreground">
          {t("adminJourneys.results.ab.readOnly")}
        </p>
      )}

      {error ? (
        <p role="alert" className="m-0 text-xs text-destructive">
          {error}
        </p>
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
