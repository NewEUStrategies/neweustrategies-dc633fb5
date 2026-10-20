// Zaplanowane anulowanie subskrypcji (marketing - oferta pozostania wymaga
// zgody): zadanie CRM dla opiekuna (zastępuje przepis
// `subscription-cancel-scheduled-crm-task` - S8 ostrzega i proponuje jego
// wyłączenie, żeby nie powstały dwa zadania), pytanie o powód bez
// utrudniania rezygnacji (Insider: `effortless`, reguła
// `retention.cancel_flow_too_long`), przed końcem okresu - co zostaje i jak
// wrócić. Cofnięcie anulowania (`cancel_at_period_end = false`) kończy
// ścieżkę celem.
import { DAY, button, chain, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const cancelScheduledSave: JourneyTemplate = {
  key: "cancel_scheduled_save",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: "subscription-cancel-scheduled-crm-task",
  settings: {
    triggerEventType: "billing_subscription.status_changed.v1",
    triggerCondition: { cancel_at_period_end: true },
    entryFilter: [],
    reentry: "after_exit",
    goal: {
      eventType: "billing_subscription.status_changed.v1",
      condition: { cancel_at_period_end: false },
    },
    exitEvents: [],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("task", "create_crm_task", {
        title: "Zaplanowane anulowanie - zapytaj o powód",
        description:
          "Klient zaplanował anulowanie subskrypcji. Ustal powód; nie utrudniaj rezygnacji.",
        dueInDays: 2,
        assignee: { mode: "owner_or_default" },
      }),
      node("reason", "send_email"),
      node("wait_5d", "wait", { mode: "duration", minutes: 5 * DAY }),
      node("keep", "send_email"),
      node("done", "exit"),
    ],
    edges: chain("trigger", "task", "reason", "wait_5d", "keep", "done"),
  },
  emails: [
    {
      nodeId: "reason",
      subject: {
        pl: "Przyjęliśmy anulowanie - jedno pytanie",
        en: "Your cancellation is confirmed - one question",
      },
      preheader: {
        pl: "Dostęp zostaje do końca opłaconego okresu.",
        en: "Your access remains until the end of the paid period.",
      },
      doc: emailDoc(
        heading("h1", "Anulowanie przyjęte", "Cancellation confirmed"),
        paragraph(
          "p1",
          "Subskrypcja zakończy się z końcem opłaconego okresu - do tego czasu masz pełny dostęp. Nie musisz niczego więcej robić.",
          "Your subscription will end with the paid period - until then you keep full access. There is nothing else you need to do.",
        ),
        paragraph(
          "p2",
          "Będziemy wdzięczni za krótką informację, co zdecydowało. Jeśli powodem jest cena albo zakres planu, w ustawieniach konta znajdziesz także plany o innym zakresie.",
          "We would be grateful to know what made the difference. If it was the price or the scope of the plan, your account settings also list plans with a different scope.",
        ),
        button("b1", "Ustawienia subskrypcji", "Subscription settings", "{{account_url}}"),
      ),
    },
    {
      nodeId: "keep",
      subject: {
        pl: "Co zostaje po zakończeniu członkostwa",
        en: "What remains after your membership ends",
      },
      preheader: {
        pl: "Zakładki i historia lektur zostają na koncie - powrót zajmie minutę.",
        en: "Your bookmarks and reading history stay on the account - coming back takes a minute.",
      },
      doc: emailDoc(
        heading("h1", "Twoje konto zostaje", "Your account stays"),
        paragraph(
          "p1",
          "Po zakończeniu członkostwa konto, zakładki i historia lektur pozostaną bez zmian, a bezpłatne analizy nadal będą dostępne. Jeśli zmienisz zdanie przed końcem okresu, wystarczy cofnąć anulowanie w ustawieniach konta.",
          "After your membership ends, your account, bookmarks and reading history stay as they are, and free analysis remains available. If you change your mind before the period ends, simply undo the cancellation in your account settings.",
        ),
        button("b1", "Cofnij anulowanie", "Undo the cancellation", "{{account_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: ["churn", "nrr", "grr", "ces"],
    scenarios: ["churn", "nrr", "quickratio", "effort"],
    frameworks: ["prospect", "peakend", "effortless", "jtbd"],
  },
};
