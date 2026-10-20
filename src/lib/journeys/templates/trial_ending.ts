// Koniec okresu próbnego (USŁUGA z podstawą prawną - informacja o warunkach
// trwającej umowy, bez treści promocyjnych; Insider: kategoria transakcyjna).
// Wyzwalacz emituje skaner S2 trzy dni przed końcem próby. Anulowanie przed
// końcem próby kończy ścieżkę (wyjście na zmianie statusu).
import { button, chain, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const trialEnding: JourneyTemplate = {
  key: "trial_ending",
  category: "service",
  legalBasis: {
    pl: "Art. 6 ust. 1 lit. b RODO - informacja o zakończeniu okresu próbnego i warunkach dalszej subskrypcji (wykonanie umowy).",
    en: "Art. 6(1)(b) GDPR - notice of the end of the trial period and the terms of the continuing subscription (performance of a contract).",
  },
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "billing_subscription.trial_ending.v1",
    triggerCondition: {},
    entryFilter: [],
    reentry: "after_exit",
    exitEvents: [
      {
        eventType: "billing_subscription.status_changed.v1",
        condition: { new_status: "canceled" },
      },
    ],
  },
  graph: {
    nodes: [node("trigger", "trigger"), node("notice", "send_email"), node("done", "exit")],
    edges: chain("trigger", "notice", "done"),
  },
  emails: [
    {
      nodeId: "notice",
      subject: {
        pl: "Okres próbny kończy się {{trial_ends_at}}",
        en: "Your trial ends on {{trial_ends_at}}",
      },
      preheader: {
        pl: "Co stanie się z subskrypcją i jak nią zarządzać.",
        en: "What happens to your subscription and how to manage it.",
      },
      doc: emailDoc(
        heading("h1", "Informacja o końcu okresu próbnego", "Notice about the end of your trial"),
        paragraph(
          "p1",
          "Okres próbny planu {{plan_name}} kończy się {{trial_ends_at}}. Jeśli subskrypcja pozostanie aktywna, po tym dniu zostanie naliczona pierwsza opłata zgodnie z wybranym planem.",
          "The trial of the {{plan_name}} plan ends on {{trial_ends_at}}. If the subscription stays active, the first charge for the chosen plan will be made after that date.",
        ),
        paragraph(
          "p2",
          "Plan zmienisz albo anulujesz w ustawieniach konta - do końca okresu próbnego bez żadnych kosztów.",
          "You can change or cancel the plan in your account settings - free of charge until the trial ends.",
        ),
        button("b1", "Zarządzaj subskrypcją", "Manage subscription", "{{account_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: ["trial_conv", "activation", "ttv"],
    scenarios: ["payback", "activation"],
    frameworks: ["prospect", "fogg", "peakend"],
  },
};
