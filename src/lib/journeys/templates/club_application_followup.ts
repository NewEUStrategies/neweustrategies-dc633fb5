// Zgłoszenie do klubu bez decyzji po 7 dniach (USŁUGA): zadanie CRM dla
// zespołu klubu i wiadomość do zgłaszającego, że zgłoszenie nadal jest
// rozpatrywane. Spójne z regułą diagnostyki `clubs.pending_applications_over_7d`
// (S7). Decyzja w terminie kończy ścieżkę bez maila.
import { DAY, button, chain, edge, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const clubApplicationFollowup: JourneyTemplate = {
  key: "club_application_followup",
  category: "service",
  legalBasis: {
    pl: "Art. 6 ust. 1 lit. b RODO - informacja o stanie rozpatrywania zgłoszenia do klubu (działanie na żądanie osoby).",
    en: "Art. 6(1)(b) GDPR - information about the status of the club application review (steps taken at the person's request).",
  },
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "club_application.submitted.v1",
    triggerCondition: {},
    entryFilter: [],
    reentry: "after_exit",
    exitEvents: [],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("wait_decision", "wait", {
        mode: "until_event",
        eventType: "club_application.decided.v1",
        condition: {},
        timeoutMinutes: 7 * DAY,
      }),
      node("decided", "exit"),
      node("task", "create_crm_task", {
        title: "Zgłoszenie do klubu czeka ponad 7 dni",
        description: "Podejmij decyzję albo poproś zgłaszającego o brakujące informacje.",
        dueInDays: 1,
        assignee: { mode: "owner_or_default" },
      }),
      node("status", "send_email"),
      node("done", "exit"),
    ],
    edges: [
      edge("trigger", "wait_decision"),
      edge("wait_decision", "decided", "event"),
      edge("wait_decision", "task", "timeout"),
      ...chain("task", "status", "done"),
    ],
  },
  emails: [
    {
      nodeId: "status",
      subject: {
        pl: "Twoje zgłoszenie do klubu {{club_name}} jest nadal rozpatrywane",
        en: "Your application to {{club_name}} is still under review",
      },
      preheader: {
        pl: "Przepraszamy za oczekiwanie - wkrótce wrócimy z odpowiedzią.",
        en: "Sorry for the wait - we will be back with an answer soon.",
      },
      doc: emailDoc(
        heading("h1", "Zgłoszenie nadal w toku", "Your application is still in progress"),
        paragraph(
          "p1",
          "Rozpatrzenie zgłoszenia do klubu {{club_name}} trwa dłużej niż zwykle. Zespół klubu ma je na liście i wróci z odpowiedzią - przepraszamy za oczekiwanie.",
          "Reviewing your application to {{club_name}} is taking longer than usual. The club team has it on their list and will get back to you - we apologise for the wait.",
        ),
        button("b1", "Przejdź do serwisu", "Go to the site", "{{site_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: ["frt", "lead_response"],
    scenarios: ["leadspeed"],
    frameworks: ["effortless"],
  },
};
