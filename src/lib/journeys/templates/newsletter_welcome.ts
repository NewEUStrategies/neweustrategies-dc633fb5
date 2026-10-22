// Powitanie subskrybenta newslettera (marketing, zgoda = potwierdzony zapis
// DOI): czego się spodziewać, najlepsze analizy, a na końcu pytanie
// o preferencje, jeśli dwa pierwsze maile nie zostały otwarte. Wiedza
// Insidera: przypomnieć wartość newslettera w pierwszych wysyłkach i dać
// centrum preferencji (`unsub`); otwarcia maszynowe (MPP) wyłączone
// z warunku - decyzja o trzecim mailu nie może zależeć od skanera.
import { DAY, button, chain, edge, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const newsletterWelcome: JourneyTemplate = {
  key: "newsletter_welcome",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "newsletter_subscriber.confirmed.v1",
    triggerCondition: {},
    entryFilter: [],
    reentry: "never",
    exitEvents: [],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("hello", "send_email"),
      node("wait_3d", "wait", { mode: "duration", minutes: 3 * DAY }),
      node("best_of", "send_email"),
      node("wait_4d", "wait", { mode: "duration", minutes: 4 * DAY }),
      node("engaged", "if_else", {
        match: "any",
        predicates: [
          { kind: "email_opened", nodeId: "hello", excludeMachine: true },
          { kind: "email_opened", nodeId: "best_of", excludeMachine: true },
        ],
      }),
      node("preferences", "send_email"),
      node("done", "exit"),
      node("engaged_end", "exit"),
    ],
    edges: [
      ...chain("trigger", "hello", "wait_3d", "best_of", "wait_4d", "engaged"),
      edge("engaged", "engaged_end", "yes"),
      edge("engaged", "preferences", "no"),
      edge("preferences", "done"),
    ],
  },
  emails: [
    {
      nodeId: "hello",
      subject: {
        pl: "Potwierdzone - co i kiedy będziesz od nas dostawać",
        en: "Confirmed - what to expect from us and when",
      },
      preheader: {
        pl: "Najważniejsze analizy w jednym wydaniu, bez powtórek i bez szumu.",
        en: "The most important analysis in a single edition, without repetition or noise.",
      },
      doc: emailDoc(
        heading("h1", "Dziękujemy za zapis na newsletter", "Thank you for subscribing"),
        paragraph(
          "p1",
          "W każdym wydaniu wybieramy kilka analiz, które najbardziej zmieniają obraz sytuacji w Europie - z krótkim komentarzem, dlaczego warto je przeczytać.",
          "In every edition we pick a few pieces of analysis that change the picture in Europe the most, with a short note on why they are worth reading.",
        ),
        paragraph(
          "p2",
          "Możesz od razu wybrać tematy, które Cię interesują - newsletter będzie wtedy lepiej dopasowany.",
          "You can choose the topics you care about right away so that the newsletter fits you better.",
        ),
        button("b1", "Ustaw preferencje", "Set your preferences", "{{newsletter_url}}"),
      ),
    },
    {
      nodeId: "best_of",
      subject: {
        pl: "Analizy, od których warto zacząć",
        en: "Analysis worth starting with",
      },
      preheader: {
        pl: "Teksty, do których czytelnicy wracają najczęściej.",
        en: "The writing our readers return to most often.",
      },
      doc: emailDoc(
        heading("h1", "Na dobry początek", "A good place to start"),
        paragraph(
          "p1",
          "Na stronie głównej znajdziesz analizy, do których czytelnicy wracają najczęściej - o polityce europejskiej, bezpieczeństwie i gospodarce. Zacznij od streszczeń: każde czyta się w minutę.",
          "On the homepage you will find the analysis readers return to most often - on European policy, security and the economy. Start with the summaries: each takes a minute to read.",
        ),
        button("b1", "Przejdź do analiz", "Go to the analysis", "{{site_url}}"),
      ),
    },
    {
      nodeId: "preferences",
      subject: {
        pl: "Czy nasz newsletter nadal jest dla Ciebie przydatny?",
        en: "Is our newsletter still useful to you?",
      },
      preheader: {
        pl: "Zmień tematy albo częstotliwość - albo zrezygnuj jednym kliknięciem.",
        en: "Change topics or frequency - or opt out with one click.",
      },
      doc: emailDoc(
        heading("h1", "Dopasujmy newsletter", "Let us adjust the newsletter"),
        paragraph(
          "p1",
          "Wygląda na to, że ostatnie wydania nie trafiły w Twoje zainteresowania. Wolimy wysyłać mniej, ale celniej: możesz zmienić tematy albo zrezygnować z newslettera linkiem w stopce.",
          "It seems our recent editions did not match your interests. We would rather send less but more accurately: you can change topics or leave the newsletter using the link in the footer.",
        ),
        button("b1", "Zmień preferencje", "Change preferences", "{{newsletter_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: [
      "open_rate",
      "ctor",
      "ctr_email",
      "unsub",
      "list_growth",
      "active_subscribers",
      "read_rate",
      "mpp_share",
    ],
    scenarios: ["unsub", "subject", "emailclick", "lowread", "mppinfl"],
    frameworks: ["permission", "cialdini"],
  },
};
