// Szablony ścieżek (S5): dane, które admin instaluje jednym kliknięciem, więc
// każdy musi przejść TĘ SAMĄ walidację co publikacja - inaczej szablon
// zainstaluje szkic, którego nie da się opublikować. Plus reguły właściciela:
// D-04 (porzucona kasa = marketing, za zgodą), usługa wyłącznie z podstawą
// prawną, treść PL i EN, zmienne ze słownika, wiedza z pakietu Insidera.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEmailDoc, type EmailDoc } from "@/lib/newsletter/emailDoc";
import { JourneySettingsSchema, validateJourneyGraph } from "../graph";
import { JOURNEY_LIMITS } from "../limits";
import {
  JOURNEY_TEMPLATES,
  JOURNEY_TEMPLATE_KEYS,
  isTemplateAvailable,
  journeyTemplate,
  type JourneyTemplate,
} from "../templates";
import { buildTriggerCondition, isJourneyTrigger } from "../triggers";
import {
  JOURNEY_VARIABLES,
  substituteJourneyVariables,
  unknownJourneyVariables,
} from "../variables";

const ALL = Object.values(JOURNEY_TEMPLATES);
const AVAILABLE = ALL.filter(isTemplateAvailable);

function insiderIds(file: string, key: string): Set<string> {
  const path = join(process.cwd(), "docs/benchmarki/insider-2026-10-19", file);
  const json = JSON.parse(readFileSync(path, "utf8")) as Record<string, { id: string }[]>;
  return new Set(json[key].map((entry) => entry.id));
}

/** Wszystkie teksty dokumentu maila (oba języki) - do kontroli zmiennych. */
function docTexts(doc: EmailDoc): string[] {
  return doc.blocks.flatMap((block) => {
    switch (block.type) {
      case "heading":
        return [block.text.pl, block.text.en];
      case "paragraph":
      case "footer-note":
        return [block.html.pl, block.html.en];
      case "button":
        return [block.label.pl, block.label.en, block.url];
      default:
        return [];
    }
  });
}

describe("katalog", () => {
  it("czternaście szablonów, klucz = pole `key`, wyszukiwanie po kluczu", () => {
    expect(JOURNEY_TEMPLATE_KEYS).toHaveLength(14);
    for (const key of JOURNEY_TEMPLATE_KEYS) {
      expect(JOURNEY_TEMPLATES[key].key).toBe(key);
      expect(journeyTemplate(key)).toBe(JOURNEY_TEMPLATES[key]);
    }
    expect(journeyTemplate("nie_ma")).toBeNull();
  });

  it("wszystkie szablony są dostępne - B2B startuje od wiadomości z cennika (I9, Z-S5-01)", () => {
    const unavailable = ALL.filter((t) => !isTemplateAvailable(t));
    expect(unavailable.map((t) => t.key)).toEqual([]);
    expect(JOURNEY_TEMPLATES.pricing_enquiry_b2b.settings).toMatchObject({
      triggerEventType: "contact_message.submitted.v1",
      triggerCondition: { form_kind: "pricing" },
    });
  });
});

describe.each(ALL.map((t) => [t.key, t] as const))("%s", (_key, template: JourneyTemplate) => {
  it("ustawienia i graf przechodzą walidację publikacji", () => {
    const settings = JourneySettingsSchema.parse(template.settings);
    expect(isJourneyTrigger(settings.triggerEventType)).toBe(true);
    const result = validateJourneyGraph(template.graph, {
      triggerEventType: settings.triggerEventType,
      entryFilter: settings.entryFilter,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warunki wyzwalacza, celu i wyjść są polami katalogu (payload @>)", () => {
    const { settings } = template;
    expect(
      buildTriggerCondition(settings.triggerEventType, settings.triggerCondition ?? {}),
    ).toEqual(settings.triggerCondition ?? {});
    for (const ref of [...(settings.goal ? [settings.goal] : []), ...(settings.exitEvents ?? [])]) {
      expect(isJourneyTrigger(ref.eventType), ref.eventType).toBe(true);
      expect(buildTriggerCondition(ref.eventType, ref.condition ?? {})).toEqual(
        ref.condition ?? {},
      );
    }
  });

  it("kategoria i podstawa prawna (usługa = podstawa PL/EN, marketing = brak)", () => {
    if (template.category === "service") {
      expect(template.legalBasis?.pl.trim()).toBeTruthy();
      expect(template.legalBasis?.en.trim()).toBeTruthy();
      expect(template.legalBasis?.pl.length).toBeLessThanOrEqual(JOURNEY_LIMITS.legalBasisMax);
      expect(template.legalBasis?.en.length).toBeLessThanOrEqual(JOURNEY_LIMITS.legalBasisMax);
    } else {
      expect(template.legalBasis).toBeNull();
    }
  });

  it("treść dokładnie dla każdego węzła send_email, PL i EN, w limitach", () => {
    const mailNodes = template.graph.nodes.filter((n) => n.type === "send_email").map((n) => n.id);
    expect(template.emails.map((e) => e.nodeId).sort()).toEqual([...mailNodes].sort());
    for (const email of template.emails) {
      for (const lang of ["pl", "en"] as const) {
        expect(email.subject[lang].trim().length).toBeGreaterThan(0);
        expect(email.subject[lang].length).toBeLessThanOrEqual(JOURNEY_LIMITS.subjectMax);
        expect(email.preheader[lang].length).toBeLessThanOrEqual(JOURNEY_LIMITS.preheaderMax);
      }
      const doc = parseEmailDoc(email.doc);
      expect(doc).not.toBeNull();
      expect(doc?.blocks.length).toBe(email.doc.blocks.length);
      const texts = [
        email.subject.pl,
        email.subject.en,
        email.preheader.pl,
        email.preheader.en,
        ...docTexts(email.doc),
      ];
      for (const text of texts) expect(unknownJourneyVariables(text)).toEqual([]);
      for (const block of email.doc.blocks) {
        if (block.type === "paragraph" || block.type === "heading") {
          const value = block.type === "paragraph" ? block.html : block.text;
          expect(value.pl.trim(), `${email.nodeId}/${block.id} pl`).toBeTruthy();
          expect(value.en.trim(), `${email.nodeId}/${block.id} en`).toBeTruthy();
        }
        if (block.type === "button") {
          // Adres przycisku = wyłącznie zmienna adresowa serwisu -> bezwzględny URL.
          const url = substituteJourneyVariables(
            block.url,
            { site_url: "https://nes.test", pricing_url: "https://nes.test/pricing" },
            "url",
          );
          expect(block.url).toMatch(/^\{\{[a-z_]+_url\}\}/);
          expect(url.startsWith("https://nes.test") || url === "").toBe(true);
        }
      }
    }
  });

  it("odnośniki do wiedzy Insidera istnieją w pakiecie benchmarków", () => {
    const kpis = insiderIds("kpis.json", "kpis");
    const scenarios = insiderIds("scenarios.json", "scenarios");
    const frameworks = insiderIds("frameworks.json", "frameworks");
    expect(template.knowledge.kpis.length).toBeGreaterThan(0);
    for (const id of template.knowledge.kpis) expect(kpis, `kpi ${id}`).toContain(id);
    for (const id of template.knowledge.scenarios)
      expect(scenarios, `scenariusz ${id}`).toContain(id);
    for (const id of template.knowledge.frameworks)
      expect(frameworks, `framework ${id}`).toContain(id);
  });
});

describe("decyzje właściciela", () => {
  it("D-04: porzucona kasa to marketing (wymaga zgody), tylko subskrypcja", () => {
    const t = JOURNEY_TEMPLATES.abandoned_checkout;
    expect(t.category).toBe("marketing");
    expect(t.settings.triggerEventType).toBe("checkout.abandoned.v1");
    expect(t.settings.triggerCondition).toEqual({ kind: "subscription" });
    expect(t.settings.goal?.eventType).toBe("checkout.completed.v1");
  });

  it("windykacja: payment_failed bez maili (zadania i etapy CRM)", () => {
    const t = JOURNEY_TEMPLATES.payment_failed_crm;
    expect(t.settings.triggerEventType).toBe("billing_subscription.payment_failed.v1");
    expect(t.graph.nodes.some((n) => n.type === "send_email")).toBe(false);
    expect(t.emails).toEqual([]);
  });

  it("win-back nie startuje po pauzie (reason <> 'paused')", () => {
    expect(JOURNEY_TEMPLATES.winback_30d.settings.entryFilter).toEqual([
      { kind: "trigger_field", key: "reason", op: "not_in", values: ["paused"] },
    ]);
  });

  it("usługa: koniec okresu próbnego i wnioski klubowe", () => {
    const service = ALL.filter((t) => t.category === "service").map((t) => t.key);
    expect(service.sort()).toEqual(
      ["club_application_followup", "club_application_received", "trial_ending"].sort(),
    );
  });

  it("ratunek przed rezygnacją zastępuje przepis automatyzacji z zadaniem", () => {
    expect(JOURNEY_TEMPLATES.cancel_scheduled_save.replacesWorkflowTemplate).toBe(
      "subscription-cancel-scheduled-crm-task",
    );
  });

  it("nurtowanie rejestracji kończy rezygnacja z udziału", () => {
    const exits = JOURNEY_TEMPLATES.event_registration_nurture.settings.exitEvents ?? [];
    expect(exits.map((e) => e.eventType)).toContain("event.registration.cancelled.v1");
  });

  it("każdy dostępny szablon wysyła maile albo prowadzi CRM - nic pustego", () => {
    for (const t of AVAILABLE) {
      expect(t.graph.nodes.length, t.key).toBeGreaterThan(2);
    }
    expect(JOURNEY_VARIABLES.some((v) => v.key === "pricing_url")).toBe(true);
  });
});
