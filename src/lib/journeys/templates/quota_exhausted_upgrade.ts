// Wyczerpany limit darmowych analiz (marketing): wiadomość w chwili wysokiej
// motywacji (Insider: `fogg`), komunikat straty względem punktu odniesienia
// (`prospect`), jedno CTA; przypomnienie po dwóch dniach tylko dla osób bez
// planu. Wyzwalacz emituje S3 raz na konto i miesiąc, więc ścieżka nie
// powtarza się w ramach jednego okresu limitu.
import { DAY, button, chain, edge, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const quotaExhaustedUpgrade: JourneyTemplate = {
  key: "quota_exhausted_upgrade",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "metering.quota_exhausted.v1",
    triggerCondition: {},
    entryFilter: [],
    reentry: "cooldown",
    reentryCooldownDays: 25,
    goal: { eventType: "checkout.completed.v1" },
    exitEvents: [],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("limit", "send_email"),
      node("wait_2d", "wait", { mode: "duration", minutes: 2 * DAY }),
      node("paid_check", "if_else", {
        match: "any",
        predicates: [{ kind: "plan", op: "has_paid" }],
      }),
      node("reminder", "send_email"),
      node("done", "exit"),
      node("member", "goal", { label: "Plan wykupiony" }),
    ],
    edges: [
      ...chain("trigger", "limit", "wait_2d", "paid_check"),
      edge("paid_check", "member", "yes"),
      edge("paid_check", "reminder", "no"),
      edge("reminder", "done"),
    ],
  },
  emails: [
    {
      nodeId: "limit",
      subject: {
        pl: "Wykorzystany limit bezpłatnych analiz w tym miesiącu",
        en: "You have used this month's free analysis allowance",
      },
      preheader: {
        pl: "Czytaj dalej bez przerwy - albo poczekaj na nowy miesiąc.",
        en: "Keep reading without a break - or wait for the new month.",
      },
      doc: emailDoc(
        heading("h1", "Limit na ten miesiąc się skończył", "This month's allowance has run out"),
        paragraph(
          "p1",
          "Dziękujemy, że czytasz nas tak regularnie. Bezpłatny limit odnowi się na początku kolejnego miesiąca. Jeśli nie chcesz czekać, członkostwo daje dostęp do wszystkich analiz od razu.",
          "Thank you for reading us so regularly. The free allowance renews at the start of next month. If you would rather not wait, membership gives you access to all analysis straight away.",
        ),
        button("b1", "Czytaj bez limitu", "Read without limits", "{{pricing_url}}"),
      ),
    },
    {
      nodeId: "reminder",
      subject: {
        pl: "Analizy, które czekają na lekturę",
        en: "Analysis waiting for you",
      },
      preheader: {
        pl: "Od ostatniej wizyty opublikowaliśmy nowe teksty.",
        en: "We have published new pieces since your last visit.",
      },
      doc: emailDoc(
        heading("h1", "Nie trać wątku", "Do not lose the thread"),
        paragraph(
          "p1",
          "Od Twojej ostatniej wizyty pojawiły się nowe analizy. Z planem członkowskim przeczytasz je w całości - bez czekania na odnowienie limitu.",
          "New analysis has appeared since your last visit. With a membership plan you can read it in full - without waiting for the allowance to renew.",
        ),
        button("b1", "Wybierz plan", "Choose a plan", "{{pricing_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: ["cvr", "trial_conv", "arpu", "feature_adoption"],
    scenarios: ["offer"],
    frameworks: ["prospect", "decoy", "psm", "nudge", "fogg"],
  },
};
