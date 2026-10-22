// Zapytanie o ofertę dla instytucji (B2B) - tor sprzedaży bez maili do
// kontaktu: natychmiastowe powiadomienie opiekuna (Insider `leadspeed`:
// pierwsza próba kontaktu w ciągu godziny - zadanie liczy dni, więc godzinę
// zapewnia powiadomienie) i zadanie, eskalacja po 2 dniach bez ruchu etapu.
//
// Wyzwalacz: `contact_message.submitted.v1` z warunkiem `form_kind = pricing`
// (I9, Z-S5-01; SPEC §5.6). Formularz kontaktowy zakłada leada bez śladu, że
// chodzi o ofertę, więc `crm_lead.created.v1` łapałby każdy nowy kontakt -
// dopiero zdarzenie wiadomości mówi, z którego formularza przyszła.
import { DAY, chain, edge, node } from "./doc";
import type { JourneyTemplate } from "./types";

export const pricingEnquiryB2b: JourneyTemplate = {
  key: "pricing_enquiry_b2b",
  category: "marketing",
  legalBasis: null,
  availability: { status: "available" },
  replacesWorkflowTemplate: null,
  settings: {
    triggerEventType: "contact_message.submitted.v1",
    triggerCondition: { form_kind: "pricing" },
    entryFilter: [],
    reentry: "never",
    goal: { eventType: "crm_lead.stage_changed.v1", condition: { new_stage: "proposal" } },
    exitEvents: [],
  },
  graph: {
    nodes: [
      node("trigger", "trigger"),
      node("notify", "notify_staff", {
        recipients: "owner",
        message: "Zapytanie o ofertę dla instytucji - pierwszy kontakt w ciągu godziny.",
      }),
      node("task", "create_crm_task", {
        title: "Zapytanie B2B - pierwszy kontakt",
        description: "Ustal potrzeby instytucji, liczbę miejsc i termin decyzji.",
        dueInDays: 0,
        assignee: { mode: "owner_or_default" },
      }),
      node("wait_2d", "wait", { mode: "duration", minutes: 2 * DAY }),
      node("stalled", "if_else", {
        match: "any",
        predicates: [{ kind: "crm_stage", in: ["new"] }],
      }),
      node("escalate", "notify_staff", {
        recipients: "admins",
        message: "Zapytanie B2B bez kontaktu od 2 dni - sprawdź przydział opiekuna.",
      }),
      node("done", "exit"),
      node("moving", "exit"),
    ],
    edges: [
      ...chain("trigger", "notify", "task", "wait_2d", "stalled"),
      edge("stalled", "escalate", "yes"),
      edge("stalled", "moving", "no"),
      edge("escalate", "done"),
    ],
  },
  emails: [],
  knowledge: {
    kpis: [
      "lead_response",
      "mql",
      "sql",
      "stage_conv",
      "meeting_rate",
      "win_rate",
      "cycle",
      "avg_deal",
      "pipeline_velocity",
      "pipeline_cov",
    ],
    scenarios: ["leadspeed", "mqlsql", "leadquality", "winrate", "longcycle", "abmcold"],
    frameworks: ["b2bfunnel", "meddic", "abm", "955"],
  },
};
