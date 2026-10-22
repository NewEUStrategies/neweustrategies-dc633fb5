// Powrót po wygaśnięciu (marketing): 30 dni po końcu dostępu - co nowego
// i zaproszenie do powrotu. Pauza to NIE odejście (D13): wygaśnięcie
// z `reason = 'paused'` nie wchodzi na ścieżkę (filtr `trigger_field
// not_in`, bo `payload @> condition` nie wyraża zaprzeczenia). Zakup kończy
// ścieżkę celem; osoba, która w tym czasie wróciła, nie dostaje oferty.
import { DAY, button, chain, edge, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const winback30d: JourneyTemplate = {
  key: "winback_30d",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "subscription.expired.v1",
    triggerCondition: {},
    entryFilter: [{ kind: "trigger_field", key: "reason", op: "not_in", values: ["paused"] }],
    reentry: "cooldown",
    reentryCooldownDays: 180,
    goal: { eventType: "checkout.completed.v1" },
    exitEvents: [],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("wait_30d", "wait", { mode: "duration", minutes: 30 * DAY }),
      node("paid_check", "if_else", {
        match: "any",
        predicates: [{ kind: "plan", op: "has_paid" }],
      }),
      node("news", "send_email"),
      node("wait_7d", "wait", { mode: "duration", minutes: 7 * DAY }),
      node("invite", "send_email"),
      node("done", "exit"),
      node("back", "goal", { label: "Wrócił przed ofertą" }),
    ],
    edges: [
      ...chain("trigger", "wait_30d", "paid_check"),
      edge("paid_check", "back", "yes"),
      edge("paid_check", "news", "no"),
      ...chain("news", "wait_7d", "invite", "done"),
    ],
  },
  emails: [
    {
      nodeId: "news",
      subject: {
        pl: "Co zmieniło się w Europie przez ostatni miesiąc",
        en: "What has changed in Europe over the past month",
      },
      preheader: {
        pl: "Najważniejsze analizy od Twojej ostatniej wizyty.",
        en: "The most important analysis since your last visit.",
      },
      doc: emailDoc(
        heading("h1", "Miesiąc w skrócie", "The month in brief"),
        paragraph(
          "p1",
          "Od zakończenia Twojego członkostwa opublikowaliśmy kolejne analizy i raporty. Streszczenia są dostępne bezpłatnie - zajrzyj, co działo się w tematach, które śledzisz.",
          "Since your membership ended we have published new analysis and reports. The summaries are free to read - see what has happened in the topics you follow.",
        ),
        button("b1", "Przeczytaj streszczenia", "Read the summaries", "{{site_url}}"),
      ),
    },
    {
      nodeId: "invite",
      subject: {
        pl: "Wróć do pełnych analiz NES",
        en: "Return to full NES analysis",
      },
      preheader: {
        pl: "Twoje konto i zakładki czekają.",
        en: "Your account and bookmarks are waiting.",
      },
      doc: emailDoc(
        heading("h1", "Zapraszamy z powrotem", "Welcome back whenever you are ready"),
        paragraph(
          "p1",
          "Twoje konto, zakładki i historia lektur są tam, gdzie je zostawiono. Plan wznowisz w kilka chwil - w tej samej albo innej wersji.",
          "Your account, bookmarks and reading history are just where they were. You can restart a plan in a few moments - the same one or a different one.",
        ),
        button("b1", "Wybierz plan", "Choose a plan", "{{pricing_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: ["churn", "retention", "repeat_rate"],
    scenarios: ["churn"],
    frameworks: ["prospect", "dj", "mereexp", "frequency"],
  },
};
