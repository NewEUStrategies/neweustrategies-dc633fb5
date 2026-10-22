// Problemy ścieżki i blokady publikacji (S8).
//
// CO TEN PLIK DOWODZI.
//   1. Szablon zainstalowany i nieczytany: blokada „treść = szablon” per mail
//      i „nadawca domyślny” (nazwa nadawcy `null`) - blokady, których SQL nie
//      ma (odchylenie od `onboarding@resend.dev` z SPEC opisane w module).
//   2. Treść dostosowana + nadawca ustawiony = zero blokad.
//   3. Brak treści, pusty temat, brak EN (info), nieznane zmienne (ostrzeżenie),
//      usługa bez podstawy prawnej, szkic niepoprawny - bez wyjątku.
//   4. Błędy i ostrzeżenia walidatora grafu z kontekstem włączonych przepisów
//      i aktywnych ścieżek; przepis do wyłączenia przy szablonie zastępującym.
//   5. Kolejność: problemy całej ścieżki, potem po numerze kroku.
//   6. Każdy problem ma tłumaczenie PL i EN.
import { describe, expect, it } from "vitest";

import {
  collectJourneyIssues,
  issueCounts,
  publishBlockers,
  type JourneyIssueContent,
} from "../issues";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import { emptyJourneyGraph } from "@/lib/journeys/graph";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";
import type { JourneyTemplate } from "@/lib/journeys/templates/types";

function contentsOf(template: JourneyTemplate): JourneyIssueContent[] {
  return template.emails.map((email) => ({
    nodeId: email.nodeId,
    variant: "A",
    subjectPl: email.subject.pl,
    subjectEn: email.subject.en,
    preheaderPl: email.preheader.pl,
    preheaderEn: email.preheader.en,
    doc: email.doc,
  }));
}

const welcome = JOURNEY_TEMPLATES.welcome_onboarding;
const draftOf = (template: JourneyTemplate) => ({
  graph: template.graph,
  settings: template.settings,
});
const ENGINE_OFF = { enabled: false, killSwitch: false, senderName: null };
const ENGINE_READY = { enabled: true, killSwitch: false, senderName: "Anna z NES" };

describe("blokady publikacji panelu", () => {
  it("szablon nieczytany: treść = szablon per mail i domyślny nadawca", () => {
    const issues = collectJourneyIssues({
      draft: draftOf(welcome),
      draftValid: true,
      contents: contentsOf(welcome),
      definition: { category: "marketing", legalBasis: null },
      engine: ENGINE_OFF,
      templateMatches: { welcome: true, value: true, invite: true },
    });
    expect(
      issues.map((i) => `${i.code}:${i.nodeId ?? ""}:${i.number ?? ""}:${i.severity}`),
    ).toEqual([
      "sender_default:::blocker",
      "engine_disabled:::info",
      "content_from_template:welcome:2:blocker",
      "content_from_template:value:4.2.1:blocker",
      "content_from_template:invite:4.2.3:blocker",
    ]);
    expect(publishBlockers(issues)).toHaveLength(4);
    expect(issueCounts(issues)).toEqual({ blocker: 4, warning: 0, info: 1 });
  });

  it("treść dostosowana i nadawca ustawiony: zero blokad", () => {
    const issues = collectJourneyIssues({
      draft: draftOf(welcome),
      draftValid: true,
      contents: contentsOf(welcome).map((c) => ({ ...c, matchesTemplate: false })),
      definition: { category: "marketing", legalBasis: null },
      engine: ENGINE_READY,
      templateMatches: { welcome: false, value: false, invite: false },
    });
    expect(issues).toEqual([]);
    expect(publishBlockers(issues)).toEqual([]);
  });

  it("flaga z serwera na treści wystarcza, gdy mapy nie podano", () => {
    const issues = collectJourneyIssues({
      draft: draftOf(welcome),
      draftValid: true,
      contents: contentsOf(welcome).map((c) => ({ ...c, matchesTemplate: c.nodeId === "value" })),
      definition: { category: "marketing", legalBasis: null },
      engine: ENGINE_READY,
    });
    expect(issues.map((i) => `${i.code}:${i.nodeId}`)).toEqual(["content_from_template:value"]);
  });

  it("ścieżka bez maili nie wymaga nazwy nadawcy", () => {
    const template = JOURNEY_TEMPLATES.payment_failed_crm;
    const issues = collectJourneyIssues({
      draft: draftOf(template),
      draftValid: true,
      contents: [],
      definition: { category: "marketing", legalBasis: null },
      engine: { ...ENGINE_READY, senderName: null },
    });
    expect(issues).toEqual([]);
  });
});

describe("treść maili", () => {
  it("brak treści, pusty temat, brak EN i nieznane zmienne", () => {
    const contents = contentsOf(welcome)
      .filter((c) => c.nodeId !== "invite")
      .map((c) =>
        c.nodeId === "welcome"
          ? { ...c, subjectPl: "   ", subjectEn: null }
          : {
              ...c,
              doc: {
                version: 1,
                blocks: [
                  {
                    id: "p",
                    type: "paragraph",
                    html: { pl: "Cześć {{imie}}", en: "Hi {{first_name}}" },
                  },
                ],
              },
            },
      );
    const issues = collectJourneyIssues({
      draft: draftOf(welcome),
      draftValid: true,
      contents,
      definition: { category: "marketing", legalBasis: null },
      engine: ENGINE_READY,
    });
    expect(issues.map((i) => `${i.code}:${i.nodeId}:${i.severity}`)).toEqual([
      "subject_empty:welcome:blocker",
      "english_missing:welcome:info",
      "unknown_variables:value:warning",
      "content_missing:invite:blocker",
    ]);
    expect(issues.find((i) => i.code === "unknown_variables")?.params).toEqual({
      variables: "{{imie}}",
      variant: "A",
    });
  });
});

describe("graf, kategoria, silnik i przepisy", () => {
  it("szkic niepoprawny (pusty szkic z utworzenia) - blokada, bez wyjątku", () => {
    const issues = collectJourneyIssues({
      draft: { graph: { nodes: [], edges: [] }, settings: {} },
      draftValid: false,
      contents: [],
      definition: { category: "marketing", legalBasis: null },
    });
    expect(issues.map((i) => i.code)).toEqual(["draft_invalid"]);
  });

  it("błędy walidatora są blokadami przypiętymi do kroku", () => {
    const graph = emptyJourneyGraph();
    graph.nodes.push({ id: "lost", type: "wait", params: { mode: "duration", minutes: 60 } });
    const issues = collectJourneyIssues({
      draft: { graph, settings: { triggerEventType: "account.registered.v1" } },
      draftValid: true,
      contents: [],
      definition: { category: "marketing", legalBasis: null },
    });
    expect(issues.map((i) => `${i.code}:${i.nodeId}:${i.severity}:${i.number}`)).toEqual([
      "branches_incomplete:lost:blocker:",
      "node_unreachable:lost:blocker:",
    ]);
    expect(issues[0].labelKey).toBe("adminJourneys.graphIssue.branches_incomplete");
  });

  it("usługa bez podstawy prawnej i wyłącznik awaryjny", () => {
    const template = JOURNEY_TEMPLATES.trial_ending;
    const issues = collectJourneyIssues({
      draft: draftOf(template),
      draftValid: true,
      contents: contentsOf(template),
      definition: { category: "service", legalBasis: "  " },
      engine: { enabled: true, killSwitch: true, senderName: null },
    });
    expect(issues.map((i) => `${i.code}:${i.severity}`)).toEqual([
      "legal_basis_missing:blocker",
      "kill_switch:warning",
    ]);
  });

  it("włączony przepis o tym samym wyzwalaczu: nakładanie (walidator) i przepis do wyłączenia", () => {
    const template = JOURNEY_TEMPLATES.cancel_scheduled_save;
    const workflow = {
      name: "Zadanie przy anulowaniu",
      enabled: true,
      triggerEventType: template.settings.triggerEventType,
      actions: ["create_crm_task"],
      templateKey: "subscription-cancel-scheduled-crm-task",
    };
    const input = {
      draft: draftOf(template),
      draftValid: true,
      contents: contentsOf(template),
      definition: {
        category: template.category,
        legalBasis: null,
        replacesWorkflowTemplate: template.replacesWorkflowTemplate,
      },
      engine: ENGINE_READY,
    };
    const issues = collectJourneyIssues({ ...input, workflows: [workflow] });
    expect(
      issues
        .filter((i) => i.severity === "warning")
        .map((i) => `${i.code}:${JSON.stringify(i.params)}`),
    ).toEqual([
      `workflow_overlap:{"detail":"Zadanie przy anulowaniu"}`,
      `workflow_replace:{"name":"Zadanie przy anulowaniu"}`,
    ]);
    // Przepis wyłączony nie jest ani nakładaniem, ani czymś do wyłączenia.
    expect(
      collectJourneyIssues({ ...input, workflows: [{ ...workflow, enabled: false }] }).filter(
        (i) => i.severity === "warning",
      ),
    ).toEqual([]);
  });

  it("cykl wyzwalaczy z aktywną ścieżką to ostrzeżenie", () => {
    const graph = {
      nodes: [
        { id: "t", type: "trigger" as const, params: {} },
        { id: "tag", type: "add_tag" as const, params: { tag: "vip" } },
        { id: "x", type: "exit" as const, params: {} },
      ],
      edges: [
        { from: "t", to: "tag", branch: "next" as const },
        { from: "tag", to: "x", branch: "next" as const },
      ],
    };
    const issues = collectJourneyIssues({
      draft: { graph, settings: { triggerEventType: "account.registered.v1" } },
      draftValid: true,
      contents: [],
      definition: { category: "marketing", legalBasis: null },
      activeJourneys: [{ name: "Aktualizacja leada", triggerEventType: "crm_lead.updated.v1" }],
    });
    expect(issues.map((i) => `${i.code}:${i.severity}`)).toEqual(["trigger_cycle:warning"]);
  });
});

describe("tłumaczenia", () => {
  it("każdy problem ma zdanie PL i EN (z parametrami)", () => {
    const pl = realT("pl");
    const en = realT("en");
    const issues = [
      ...collectJourneyIssues({
        draft: draftOf(welcome),
        draftValid: true,
        contents: contentsOf(welcome)
          .slice(1)
          .map((c) => ({ ...c, subjectEn: null, matchesTemplate: true })),
        definition: { category: "service", legalBasis: null, replacesWorkflowTemplate: "x" },
        engine: { enabled: false, killSwitch: true, senderName: null },
        workflows: [
          {
            name: "P",
            enabled: true,
            triggerEventType: "account.registered.v1",
            actions: [],
            templateKey: "x",
          },
        ],
      }),
      ...collectJourneyIssues({
        draft: null,
        draftValid: false,
        contents: [],
        definition: { category: "marketing", legalBasis: null },
      }),
    ];
    expect(new Set(issues.map((i) => i.code)).size).toBeGreaterThanOrEqual(7);
    for (const issue of issues) {
      for (const t of [pl, en]) {
        const text = t(issue.labelKey, issue.params);
        expect(text, issue.labelKey).not.toMatch(/adminJourneys\./);
        expect(text).not.toMatch(/\{\{/);
      }
    }
  });
});
