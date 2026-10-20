// Nieudana płatność - tor CRM BEZ maili. Maile windykacji wysyła
// `dunning.server.ts` (jedno źródło przypomnień o płatności); ścieżka dokłada
// to, czego windykacja nie ma: zadanie dla opiekuna klienta, powiadomienie
// i znacznik w CRM, a odzyskana płatność kończy ścieżkę celem. Walidacja grafu
// (TS i SQL) odrzuca węzeł maila przy tym wyzwalaczu.
import { DAY, chain, edge, node } from "./doc";
import type { JourneyTemplate } from "./types";

export const paymentFailedCrm: JourneyTemplate = {
  key: "payment_failed_crm",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "billing_subscription.payment_failed.v1",
    triggerCondition: {},
    entryFilter: [],
    reentry: "after_exit",
    goal: { eventType: "billing_subscription.payment_recovered.v1" },
    exitEvents: [
      {
        eventType: "billing_subscription.status_changed.v1",
        condition: { new_status: "canceled" },
      },
    ],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("task", "create_crm_task", {
        title: "Nieudana płatność subskrypcji - sprawdź kontakt z klientem",
        description:
          "Windykacja wysłała przypomnienie. Sprawdź, czy klient potrzebuje faktury, zmiany karty albo planu.",
        dueInDays: 1,
        assignee: { mode: "owner_or_default" },
      }),
      node("notify", "notify_staff", {
        recipients: "owner",
        message: "Nieudana płatność subskrypcji klienta - zadanie w CRM czeka na kontakt.",
      }),
      node("tag", "add_tag", { tag: "platnosc-nieudana" }),
      node("wait_recovery", "wait", {
        mode: "until_event",
        eventType: "billing_subscription.payment_recovered.v1",
        condition: {},
        timeoutMinutes: 7 * DAY,
      }),
      node("recovered", "goal", { label: "Płatność odzyskana" }),
      node("escalate", "create_crm_task", {
        title: "Płatność nadal nieodzyskana po 7 dniach",
        description:
          "Rozważ kontakt telefoniczny albo propozycję innego planu przed utratą klienta.",
        dueInDays: 1,
        assignee: { mode: "owner_or_default" },
      }),
      node("done", "exit"),
    ],
    edges: [
      ...chain("trigger", "task", "notify", "tag", "wait_recovery"),
      edge("wait_recovery", "recovered", "event"),
      edge("wait_recovery", "escalate", "timeout"),
      edge("escalate", "done"),
    ],
  },
  emails: [],
  knowledge: {
    kpis: ["churn", "grr", "saas_quick"],
    scenarios: ["quickratio", "churn"],
    frameworks: ["effortless"],
  },
};
