// Powitanie nowego konta (marketing): trzy maile w tygodniu - pierwszy krok
// w serwisie, wartość członkostwa, zaproszenie do planu. Cel ścieżki:
// pierwsza płatność (`checkout.completed.v1`) - zakup kończy sekwencję, zanim
// czytelnik dostanie zachętę do czegoś, co już ma. Wiedza: w każdym mailu
// jeden krok do wykonania (Insider: `activation`, krok 3); trzy maile w 7 dni
// mieszczą się w limicie D-03 (kampanie newslettera liczą się do tego samego
// limitu - nadmiar silnik przesuwa, nie dubluje).
import { DAY, button, chain, edge, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const welcomeOnboarding: JourneyTemplate = {
  key: "welcome_onboarding",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "account.registered.v1",
    triggerCondition: {},
    entryFilter: [],
    reentry: "never",
    goal: { eventType: "checkout.completed.v1" },
    exitEvents: [],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("welcome", "send_email"),
      node("wait_3d", "wait", { mode: "duration", minutes: 3 * DAY }),
      node("paid_check", "if_else", {
        match: "any",
        predicates: [{ kind: "plan", op: "has_paid" }],
      }),
      node("value", "send_email"),
      node("wait_4d", "wait", { mode: "duration", minutes: 4 * DAY }),
      node("invite", "send_email"),
      node("done", "exit"),
      node("member", "goal", { label: "Plan już aktywny" }),
    ],
    edges: [
      ...chain("trigger", "welcome", "wait_3d", "paid_check"),
      edge("paid_check", "member", "yes"),
      edge("paid_check", "value", "no"),
      ...chain("value", "wait_4d", "invite", "done"),
    ],
  },
  emails: [
    {
      nodeId: "welcome",
      subject: {
        pl: "Witamy w New European Strategies - od czego zacząć",
        en: "Welcome to New European Strategies - where to start",
      },
      preheader: {
        pl: "Jedna analiza na dobry początek i ustawienia, które warto zrobić od razu.",
        en: "One analysis to begin with and the settings worth doing right away.",
      },
      doc: emailDoc(
        heading("h1", "Dziękujemy za założenie konta", "Thank you for creating an account"),
        paragraph(
          "p1",
          "New European Strategies to niezależny ośrodek analiz o polityce europejskiej, bezpieczeństwie, energii i gospodarce. Piszemy dla osób, które podejmują decyzje - dlatego każdy tekst kończy się wnioskami, a nie samym opisem.",
          "New European Strategies is an independent analysis centre covering European policy, security, energy and the economy. We write for people who take decisions, so every piece ends with conclusions rather than description alone.",
        ),
        paragraph(
          "p2",
          "Na początek proponujemy jeden krok: wybierz tematy, które obserwujesz. Na ich podstawie dobierzemy analizy na stronie głównej i w powiadomieniach.",
          "We suggest a single first step: choose the topics you follow. We will use them to select analyses on the homepage and in your notifications.",
        ),
        button(
          "b1",
          "Wybierz swoje tematy",
          "Choose your topics",
          "{{site_url}}/profile/interests",
        ),
      ),
    },
    {
      nodeId: "value",
      subject: {
        pl: "Co daje członkostwo w NES - i dla kogo jest",
        en: "What NES membership offers - and who it is for",
      },
      preheader: {
        pl: "Pełne analizy i raporty, wydarzenia dla członków i kluby dyskusyjne.",
        en: "Full analysis and reports, members' events and discussion clubs.",
      },
      doc: emailDoc(
        heading("h1", "Analizy, które idą o krok dalej", "Analysis that goes a step further"),
        paragraph(
          "p1",
          "Część tekstów udostępniamy bez opłat. Członkostwo otwiera pełne analizy i raporty, wydarzenia dla członków oraz kluby dyskusyjne, w których rozmawiamy z ekspertami o tym, co z analiz wynika w praktyce.",
          "Some of our writing is free to read. Membership opens full analysis and reports, members' events and discussion clubs where we talk with experts about what the analysis means in practice.",
        ),
        paragraph(
          "p2",
          "Plan dobierzesz do sposobu pracy: indywidualny, zespołowy albo dla instytucji - w każdej chwili możesz go zmienić.",
          "Pick a plan that suits the way you work - individual, team or institutional - and change it at any time.",
        ),
        button("b1", "Porównaj plany", "Compare plans", "{{pricing_url}}"),
      ),
    },
    {
      nodeId: "invite",
      subject: {
        pl: "Ostatnia wiadomość z cyklu powitalnego",
        en: "The last message in our welcome series",
      },
      preheader: {
        pl: "Zostaw sobie dostęp do analiz, które pomagają w decyzjach.",
        en: "Keep access to the analysis that supports your decisions.",
      },
      doc: emailDoc(
        heading("h1", "Zostańmy w kontakcie", "Let us stay in touch"),
        paragraph(
          "p1",
          "To ostatni mail z serii powitalnej. Jeśli chcesz dostawać nasze analizy regularnie, zapisz się na newsletter albo wybierz plan członkowski - obie drogi zajmują minutę.",
          "This is the last message of the welcome series. If you would like to receive our analysis regularly, sign up for the newsletter or choose a membership plan - either takes a minute.",
        ),
        button("b1", "Wybierz plan", "Choose a plan", "{{pricing_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: ["activation", "ttv", "feature_adoption", "retention", "stickiness"],
    scenarios: ["activation", "churn"],
    frameworks: ["fogg", "hook", "aarrr", "nsm", "jtbd"],
  },
};
