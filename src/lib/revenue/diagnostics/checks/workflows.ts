// Reguły obszaru „Automatyzacje" (SPEC §5.7; regresje D1 i D13 br. 03).
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

const OWNER = { to: "/admin/workflows", search: { tab: "definitions" } } as const;

export const WORKFLOWS_CHECKS = [
  {
    // D1: przepis `newsletter-confirmed-to-crm` kończył się „sukcesem" bez
    // wykonania kroku (redakcja ładunku usuwała adres). Przebieg udany
    // z zerem kroków w 7 dniach = regresja trwa; starszy ślad = historia.
    id: "workflows.newsletter_confirmed_noop",
    area: "workflows",
    severity: "warning",
    evaluate(facts) {
      const noop = areaFacts(facts, "workflows")?.newsletterConfirmedNoop;
      if (noop?.recent === undefined || noop.older === undefined) return UNKNOWN;
      if (noop.recent + noop.older === 0) return OK;
      return finding(noop.recent > 0 ? "error" : "warn", {
        count: noop.recent + noop.older,
        refs: noop.refs,
        evidence: ev("newsletterConfirmedNoop", {
          recent: noop.recent,
          count: noop.recent + noop.older,
        }),
      });
    },
    fix: { kind: "code", issueRef: "workflows.newsletter_confirmed_noop" },
    owner: OWNER,
    snoozable: true,
  },
  {
    // D13: pauza u operatora zapisuje dostęp jako `canceled`, więc przepis
    // „anulowanie -> zadanie win-back" odpala się na pauzie. Billing anuluje
    // takie zadania (`closeRetentionTasks`) - ich liczba w 30 dniach to ślad.
    id: "workflows.cancel_recipe_fires_on_pause",
    area: "workflows",
    severity: "warning",
    evaluate(facts) {
      const recipe = areaFacts(facts, "workflows")?.cancelRecipe;
      if (recipe === undefined) return UNKNOWN;
      if (recipe === null || recipe.enabled === false || recipe.guarded === true) return OK;
      if (recipe.enabled === undefined || recipe.cancelledByPause30d === undefined) return UNKNOWN;
      return finding(recipe.cancelledByPause30d > 0 ? "error" : "warn", {
        count: recipe.cancelledByPause30d,
        refs: recipe.id ? [recipe.id] : [],
        evidence: ev(
          recipe.cancelledByPause30d > 0 ? "cancelRecipeFiredOnPause" : "cancelRecipeUnguarded",
          {
            count: recipe.cancelledByPause30d,
          },
        ),
      });
    },
    fix: { kind: "dialog", dialog: "workflow_disable" },
    owner: OWNER,
    snoozable: true,
  },
  {
    // Przepis i ścieżka na tym samym zdarzeniu piszą do tego samego kontaktu
    // dwa razy. Szablon ścieżki, który ZASTĘPUJE przepis
    // (`replacesWorkflowTemplate`), przy obu włączonych dubluje zadania (error).
    id: "workflows.overlaps_journey",
    area: "workflows",
    severity: "info",
    evaluate(facts) {
      const overlaps = areaFacts(facts, "workflows")?.overlaps;
      if (!overlaps) return UNKNOWN;
      const all = [...overlaps.duplicates, ...overlaps.sharedTrigger];
      if (all.length === 0) return OK;
      return finding(overlaps.duplicates.length > 0 ? "error" : "warn", {
        count: all.length,
        refs: [...new Set(all.map((o) => o.workflowId))],
        evidence: [
          ...(overlaps.duplicates.length > 0
            ? [ev("workflowReplacedByJourney", { count: overlaps.duplicates.length })]
            : []),
          ...(overlaps.sharedTrigger.length > 0
            ? [ev("workflowSharesTrigger", { count: overlaps.sharedTrigger.length })]
            : []),
        ],
      });
    },
    fix: { kind: "dialog", dialog: "workflow_disable" },
    owner: OWNER,
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
