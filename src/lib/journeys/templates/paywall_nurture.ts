// Czytelnik zatrzymany na paywallu (marketing): najpierw wartość, potem oferta
// (Insider `offer`: zimny odbiorca dostaje materiał, nie ofertę z końca
// lejka), jedno CTA. Wejście raz na 30 dni (`cooldown`) - kilka uderzeń
// w paywall tego samego dnia to jedna intencja, nie trzy ścieżki. Cel: płatność.
import { DAY, HOUR, button, chain, edge, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const paywallNurture: JourneyTemplate = {
  key: "paywall_nurture",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "paywall.hit.v1",
    triggerCondition: {},
    entryFilter: [{ kind: "plan", op: "none" }],
    reentry: "cooldown",
    reentryCooldownDays: 30,
    goal: { eventType: "checkout.completed.v1" },
    exitEvents: [],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("wait_2h", "wait", { mode: "duration", minutes: 2 * HOUR }),
      node("value", "send_email"),
      node("wait_3d", "wait", { mode: "duration", minutes: 3 * DAY }),
      node("paid_check", "if_else", {
        match: "any",
        predicates: [{ kind: "plan", op: "has_paid" }],
      }),
      node("offer", "send_email"),
      node("done", "exit"),
      node("member", "goal", { label: "Plan wykupiony" }),
    ],
    edges: [
      ...chain("trigger", "wait_2h", "value", "wait_3d", "paid_check"),
      edge("paid_check", "member", "yes"),
      edge("paid_check", "offer", "no"),
      edge("offer", "done"),
    ],
  },
  emails: [
    {
      nodeId: "value",
      subject: {
        pl: "Analiza, której zabrakło - i jak do niej wrócić",
        en: "The analysis you could not finish - and how to get back to it",
      },
      preheader: {
        pl: "Streszczenie wniosków i to, co znajdziesz w pełnej wersji.",
        en: "A summary of the conclusions and what the full version adds.",
      },
      doc: emailDoc(
        heading("h1", "Wniosek najpierw, szczegóły później", "Conclusions first, details later"),
        paragraph(
          "p1",
          "Nasze analizy zaczynają się od streszczenia, które jest dostępne dla wszystkich. Pełna wersja dodaje dane źródłowe, scenariusze i rekomendacje - to część, z której korzystają zespoły przygotowujące decyzje.",
          "Our analysis opens with a summary that anyone can read. The full version adds source data, scenarios and recommendations - the part teams preparing decisions rely on.",
        ),
        paragraph(
          "p2",
          "Jeśli temat jest dla Ciebie ważny, zajrzyj do pozostałych tekstów z tej serii - część z nich jest otwarta.",
          "If the topic matters to you, take a look at the other texts in the series - some of them are open to all.",
        ),
        button("b1", "Wróć do analiz", "Back to the analysis", "{{site_url}}"),
      ),
    },
    {
      nodeId: "offer",
      subject: {
        pl: "Pełny dostęp do analiz NES",
        en: "Full access to NES analysis",
      },
      preheader: {
        pl: "Plan dopasujesz do siebie albo do zespołu.",
        en: "Pick a plan for yourself or for your team.",
      },
      doc: emailDoc(
        heading(
          "h1",
          "Czytaj całość, nie tylko streszczenia",
          "Read the whole piece, not just summaries",
        ),
        paragraph(
          "p1",
          "Członkostwo otwiera pełne analizy i raporty bez limitu. Dla zespołów i instytucji przygotowaliśmy plany z dostępem dla wielu osób.",
          "Membership opens full analysis and reports without limits. For teams and institutions we offer plans with access for several people.",
        ),
        button("b1", "Zobacz plany", "See the plans", "{{pricing_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: ["cvr", "lp_cvr", "trial_conv", "email_conv"],
    scenarios: ["offer", "landing"],
    frameworks: ["stdc", "nudge", "prospect", "elm", "cialdini", "messy", "tpb"],
  },
};
