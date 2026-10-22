// Porzucona kasa planu (D-04: marketing - wymaga zgody marketingowej, bramka
// `journey_can_send`). Wyzwalacz `checkout.abandoned.v1` emituje S3 dopiero po
// wygaśnięciu sesji kasy (okno `abandon_after_minutes`, P22), więc pierwsza
// wiadomość idzie po dwóch godzinach od porzucenia - w oknie „kilku godzin"
// z Insidera (`cartaband`, krok 4). Zakup (`checkout.completed.v1`) kończy
// ścieżkę przed drugim mailem. Tylko plany - bilety mają własną pocztę
// transakcyjną (rezerwacja miejsca).
import { DAY, HOUR, button, chain, emailDoc, heading, node, paragraph } from "./doc";
import type { JourneyTemplate } from "./types";

export const abandonedCheckout: JourneyTemplate = {
  key: "abandoned_checkout",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "checkout.abandoned.v1",
    triggerCondition: { kind: "subscription" },
    entryFilter: [],
    reentry: "cooldown",
    reentryCooldownDays: 14,
    goal: { eventType: "checkout.completed.v1" },
    exitEvents: [],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("wait_2h", "wait", { mode: "duration", minutes: 2 * HOUR }),
      node("reminder", "send_email"),
      node("wait_1d", "wait", { mode: "duration", minutes: DAY }),
      node("help", "send_email"),
      node("done", "exit"),
    ],
    edges: chain("trigger", "wait_2h", "reminder", "wait_1d", "help", "done"),
  },
  emails: [
    {
      nodeId: "reminder",
      subject: {
        pl: "Twój plan {{plan_name}} czeka na dokończenie",
        en: "Your {{plan_name}} plan is waiting to be completed",
      },
      preheader: {
        pl: "Płatność nie została dokończona - wrócisz do niej jednym kliknięciem.",
        en: "The payment was not completed - you can return to it in one click.",
      },
      doc: emailDoc(
        heading("h1", "Płatność nie została dokończona", "The payment was not completed"),
        paragraph(
          "p1",
          "Sesja płatności wygasła, zanim zamówienie zostało opłacone. Nic nie zostało pobrane. Jeśli chcesz dokończyć, wybierz plan ponownie - zajmie to chwilę.",
          "The payment session expired before the order was paid. Nothing has been charged. If you would like to finish, choose the plan again - it only takes a moment.",
        ),
        button("b1", "Dokończ zamówienie", "Complete the order", "{{pricing_url}}"),
      ),
    },
    {
      nodeId: "help",
      subject: {
        pl: "Czy coś przeszkodziło w zamówieniu?",
        en: "Did something get in the way of your order?",
      },
      preheader: {
        pl: "Faktura dla firmy, inna forma płatności, plan dla zespołu - podpowiemy.",
        en: "A company invoice, another payment method, a team plan - we can help.",
      },
      doc: emailDoc(
        heading("h1", "Pomożemy dokończyć", "We can help you finish"),
        paragraph(
          "p1",
          "Jeśli zamówienie przerwała kwestia faktury dla firmy, formy płatności albo wyboru planu dla zespołu - na stronie planów znajdziesz warianty dla zespołów i instytucji oraz kontakt do naszego zespołu.",
          "If the order stopped over a company invoice, a payment method or choosing a team plan, the plans page lists options for teams and institutions together with a way to reach our team.",
        ),
        button("b1", "Wróć do planów", "Back to the plans", "{{pricing_url}}"),
      ),
    },
  ],
  knowledge: {
    kpis: ["cart_abandon", "form_abandon", "email_conv", "automation_rev_share"],
    scenarios: ["cartaband"],
    frameworks: ["nudge", "prospect", "permission"],
  },
};
