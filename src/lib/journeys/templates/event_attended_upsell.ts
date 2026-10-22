// Po obecności na wydarzeniu (marketing): podziękowanie i materiały zaraz po
// wydarzeniu (Insider: efekt końca - `peakend`, wzajemność - `cialdini`),
// pytanie o opinię, a po kilku dniach - członkostwo dla osób bez planu.
import { DAY, button, chain, edge, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const eventAttendedUpsell: JourneyTemplate = {
  key: "event_attended_upsell",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "event.registration.attended.v1",
    triggerCondition: {},
    entryFilter: [],
    reentry: "after_exit",
    goal: { eventType: "checkout.completed.v1" },
    exitEvents: [],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("wait_1d", "wait", { mode: "duration", minutes: DAY }),
      node("thanks", "send_email"),
      node("wait_5d", "wait", { mode: "duration", minutes: 5 * DAY }),
      node("paid_check", "if_else", {
        match: "any",
        predicates: [{ kind: "plan", op: "has_paid" }],
      }),
      node("membership", "send_email"),
      node("done", "exit"),
      node("member_end", "exit"),
    ],
    edges: [
      ...chain("trigger", "wait_1d", "thanks", "wait_5d", "paid_check"),
      edge("paid_check", "member_end", "yes"),
      edge("paid_check", "membership", "no"),
      edge("membership", "done"),
    ],
  },
  emails: [
    {
      nodeId: "thanks",
      subject: {
        pl: "Dziękujemy za udział w {{event_title}}",
        en: "Thank you for taking part in {{event_title}}",
      },
      preheader: {
        pl: "Materiały po wydarzeniu i krótka prośba o opinię.",
        en: "Materials from the event and a short request for feedback.",
      },
      doc: emailDoc(
        heading("h1", "Dziękujemy za obecność", "Thank you for joining us"),
        paragraph(
          "p1",
          "Mamy nadzieję, że dyskusja była dla Ciebie wartościowa. Materiały związane z wydarzeniem znajdziesz w swoim profilu, w zakładce wydarzeń.",
          "We hope the discussion was worthwhile. Materials related to the event are in your profile, in the events section.",
        ),
        paragraph(
          "p2",
          "Twoja opinia pomoże nam przygotować kolejne spotkania - zajmie minutę.",
          "Your feedback will help us prepare the next meetings - it takes a minute.",
        ),
        button("b1", "Moje wydarzenia", "My events", "{{site_url}}/profile/events"),
      ),
    },
    {
      nodeId: "membership",
      subject: {
        pl: "Więcej takich rozmów w ramach członkostwa NES",
        en: "More conversations like this with NES membership",
      },
      preheader: {
        pl: "Wydarzenia dla członków, kluby dyskusyjne i pełne analizy.",
        en: "Members' events, discussion clubs and full analysis.",
      },
      doc: emailDoc(
        heading("h1", "Zostań z nami na dłużej", "Stay with us for longer"),
        paragraph(
          "p1",
          "Członkostwo łączy wydarzenia, kluby dyskusyjne i pełny dostęp do analiz - w jednym planie, dla Ciebie albo dla zespołu.",
          "Membership brings together events, discussion clubs and full access to analysis - in one plan, for you or for your team.",
        ),
        button("b1", "Zobacz plany", "See the plans", "{{pricing_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: ["nps", "csat", "attendance_rate"],
    scenarios: ["nps"],
    frameworks: ["peakend", "cialdini", "twostep", "servqual"],
  },
};
