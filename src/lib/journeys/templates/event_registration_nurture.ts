// Rejestracja na wydarzenie (marketing): materiały przygotowujące i kontekst
// tematu. Terminy przypomnień (dzień i godzina przed) wysyła już poczta
// transakcyjna wydarzeń (`event_reminder`) - ścieżka ich NIE dubluje, tylko
// dokłada treść (Insider `lowattend`: zapowiedź nagrania tylko dla
// uczestników). Obecność kończy ścieżkę celem, rezygnacja - wyjściem.
import { DAY, button, chain, edge, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const eventRegistrationNurture: JourneyTemplate = {
  key: "event_registration_nurture",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "event.registration.created.v1",
    triggerCondition: { status: "approved" },
    entryFilter: [],
    reentry: "after_exit",
    goal: { eventType: "event.registration.attended.v1" },
    exitEvents: [{ eventType: "event.registration.cancelled.v1" }],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("prepare", "send_email"),
      node("wait_3d", "wait", { mode: "duration", minutes: 3 * DAY }),
      node("context", "send_email"),
      node("wait_attend", "wait", {
        mode: "until_event",
        eventType: "event.registration.attended.v1",
        condition: {},
        timeoutMinutes: 30 * DAY,
      }),
      node("attended", "goal", { label: "Obecność na wydarzeniu" }),
      node("done", "exit"),
    ],
    edges: [
      ...chain("trigger", "prepare", "wait_3d", "context", "wait_attend"),
      edge("wait_attend", "attended", "event"),
      edge("wait_attend", "done", "timeout"),
    ],
  },
  emails: [
    {
      nodeId: "prepare",
      subject: {
        pl: "Przed wydarzeniem {{event_title}} - materiały do przygotowania",
        en: "Before {{event_title}} - materials to prepare",
      },
      preheader: {
        pl: "Kilka analiz, które pomogą wejść w temat dyskusji.",
        en: "A few pieces of analysis to help you get into the topic.",
      },
      doc: emailDoc(
        heading("h1", "Do zobaczenia na wydarzeniu", "See you at the event"),
        paragraph(
          "p1",
          "Dziękujemy za rejestrację na {{event_title}}. Żeby dyskusja była jak najbardziej konkretna, polecamy wcześniej przejrzeć nasze analizy w tym temacie - wystarczą streszczenia.",
          "Thank you for registering for {{event_title}}. To make the discussion as concrete as possible, we recommend a look at our analysis on the topic beforehand - the summaries are enough.",
        ),
        button("b1", "Przejrzyj analizy", "Browse the analysis", "{{site_url}}"),
      ),
    },
    {
      nodeId: "context",
      subject: {
        pl: "Pytania, z którymi warto przyjść na {{event_title}}",
        en: "Questions worth bringing to {{event_title}}",
      },
      preheader: {
        pl: "Szczegóły wydarzenia znajdziesz w swoim profilu.",
        en: "The event details are in your profile.",
      },
      doc: emailDoc(
        heading("h1", "Przygotuj swoje pytania", "Prepare your questions"),
        paragraph(
          "p1",
          "Najlepsze dyskusje zaczynają się od dobrych pytań. Zanotuj, co w temacie wydarzenia jest dla Ciebie najważniejsze - będzie czas na rozmowę z prelegentami.",
          "The best discussions start with good questions. Note what matters most to you about the topic - there will be time to talk with the speakers.",
        ),
        button("b1", "Moje wydarzenia", "My events", "{{site_url}}/profile/events"),
      ),
    },
  ],
  knowledge: {
    kpis: ["attendance_rate", "reg_conv", "cost_per_attendee"],
    scenarios: ["lowattend"],
    frameworks: ["fogg", "peakend"],
  },
};
