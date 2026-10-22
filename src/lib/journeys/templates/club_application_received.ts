// Zgłoszenie do klubu dyskusyjnego (USŁUGA - odpowiedź na działanie
// zgłaszającego): natychmiastowe potwierdzenie z informacją o dalszym trybie
// (Insider: `leadspeed`, metryka `club_decision_time`) i powiadomienie
// administratorów. Kluby `secret` nie emitują zdarzenia (S4), a resolver
// odrzuca je drugi raz.
import { button, chain, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const clubApplicationReceived: JourneyTemplate = {
  key: "club_application_received",
  category: "service",
  legalBasis: {
    pl: "Art. 6 ust. 1 lit. b RODO - potwierdzenie przyjęcia zgłoszenia do klubu i informacja o jego rozpatrzeniu (działanie na żądanie osoby).",
    en: "Art. 6(1)(b) GDPR - confirmation that the club application was received and how it will be reviewed (steps taken at the person's request).",
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
      node("confirm", "send_email"),
      node("notify", "notify_staff", {
        recipients: "admins",
        message: "Nowe zgłoszenie do klubu dyskusyjnego czeka na decyzję.",
      }),
      node("done", "exit"),
    ],
    edges: chain("trigger", "confirm", "notify", "done"),
  },
  emails: [
    {
      nodeId: "confirm",
      subject: {
        pl: "Otrzymaliśmy Twoje zgłoszenie do klubu {{club_name}}",
        en: "We have received your application to {{club_name}}",
      },
      preheader: {
        pl: "Co dalej i kiedy możesz spodziewać się decyzji.",
        en: "What happens next and when to expect a decision.",
      },
      doc: emailDoc(
        heading("h1", "Zgłoszenie przyjęte", "Application received"),
        paragraph(
          "p1",
          "Dziękujemy za zgłoszenie do klubu {{club_name}}. Zespół klubu je przeczyta i odpowie - o decyzji poinformujemy w osobnej wiadomości.",
          "Thank you for applying to {{club_name}}. The club team will read your application and respond - we will let you know the decision in a separate message.",
        ),
        paragraph(
          "p2",
          "Jeśli zespół będzie potrzebować dodatkowych informacji, poprosi o nie bezpośrednio.",
          "If the team needs more information, they will ask you for it directly.",
        ),
        button("b1", "Przejdź do serwisu", "Go to the site", "{{site_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: ["frt", "lead_response"],
    scenarios: ["leadspeed", "slowresp"],
    frameworks: ["effortless", "peakend"],
  },
};
