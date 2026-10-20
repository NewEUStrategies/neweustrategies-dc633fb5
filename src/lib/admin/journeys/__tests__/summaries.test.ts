// Opisy, paleta, fakty szablonów, stan silnika i słownik S8-A.
//
// CO TEN PLIK DOWODZI.
//   1. Opis każdego kroku 14 szablonów składa się w PL i EN bez surowego
//      klucza (także parametry-tłumaczenia: zdarzenie, etap CRM, czas).
//   2. Paleta w grupach SPEC (Czas, Komunikacja, Logika, CRM, Newsletter,
//      Zakończenie): lista newslettera w „Newsletter”, pozostałe akcje
//      i powiadomienie zespołu w „CRM”; parametry startowe przechodzą
//      schematy; mail przy windykacji wyłączony z powodem.
//   3. Fakty szablonu: kategoria, maile, wymagania i „czego NIE wysyła”,
//      szablon niedostępny z oczekiwanym zdarzeniem (Z-S5-01).
//   4. Licznik aktywnych ścieżek (Z-S6-08) i komunikat zdrowia silnika
//      (Z-S5-03: włączony + kolejka bez żadnego kroku).
//   5. Słownik S8-A: parytet PL/EN, liczebniki, ZERO kolizji z S5 i czytelnik
//      każdego klucza w kodzie produkcyjnym.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  JOURNEY_CATEGORY_HINT_KEY,
  JOURNEY_CATEGORY_LABEL_KEY,
  JOURNEY_ENGINE_NOTICE_KEY,
  JOURNEY_EXCLUSION_LABEL_KEY,
  JOURNEY_PALETTE_GROUPS,
  JOURNEY_REENTRY_LABEL_KEY,
  JOURNEY_REQUIREMENT_LABEL_KEY,
  JOURNEY_STATUS_LABEL_KEY,
  JOURNEY_TEMPLATE_TIP_KEY,
  activeJourneyCount,
  describeNode,
  durationSummary,
  engineHealthNotice,
  journeyPalette,
  matchesSearch,
  normalizeSearch,
  templateFacts,
  translateSummary,
  triggerSentence,
} from "../summaries";
import { toCatalogEntry } from "../journeyEditor.functions";
import { realT } from "@/test/i18nReal";
import { journeysListDictionaries } from "@/lib/i18n-admin-journeys-list";
import { journeysDictionaries } from "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-crm-lifecycle";
import { NODE_PARAMS_SCHEMAS } from "@/lib/journeys/graph";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";
import type { JourneyEngineHealthDto } from "@/lib/journeys/dto";

const pl = realT("pl");
const en = realT("en");

function noRawKey(text: string) {
  expect(text, text).not.toMatch(/adminJourneys\.|adminCrm\./);
  expect(text.trim().length).toBeGreaterThan(0);
}

describe("opis kroku", () => {
  it.each(Object.values(JOURNEY_TEMPLATES).map((template) => [template.key, template] as const))(
    "%s: każdy krok ma opis PL i EN bez surowych kluczy",
    (_key, template) => {
      for (const node of template.graph.nodes) {
        const summary = describeNode(node, { settings: template.settings, subject: "Temat" });
        noRawKey(translateSummary(pl, summary));
        noRawKey(translateSummary(en, summary));
        expect(summary.labelKey).not.toBe("adminJourneys.common.summary.invalid");
      }
    },
  );

  it("czas czekania w największej całkowitej jednostce, z liczebnikami", () => {
    expect(durationSummary(60).labelKey).toBe("adminJourneys.common.summary.waitHours");
    expect(translateSummary(pl, durationSummary(3 * 1440))).toBe("Czeka 3 dni");
    expect(translateSummary(pl, durationSummary(60))).toBe("Czeka 1 godzinę");
    expect(translateSummary(pl, durationSummary(5 * 60))).toBe("Czeka 5 godzin");
    expect(translateSummary(pl, durationSummary(90))).toBe("Czeka 90 minut");
    expect(translateSummary(en, durationSummary(120))).toBe("Waits 2 hours");
    expect(translateSummary(en, durationSummary(1440))).toBe("Waits 1 day");
    expect(translateSummary(pl, durationSummary(30, "plain"))).toBe("30 minut");
    expect(translateSummary(en, durationSummary(2880, "plain"))).toBe("2 days");
  });

  it("czekanie do godziny: codziennie, dni robocze, wybrane dni", () => {
    const at = (weekdays: number[]) =>
      translateSummary(
        pl,
        describeNode({ type: "wait", params: { mode: "until_time", weekdays, time: "09:00" } }),
      );
    expect(at([1, 2, 3, 4, 5, 6, 7])).toBe("Czeka do najbliższej 09:00");
    expect(at([5, 4, 3, 2, 1])).toBe("Czeka do 09:00 w najbliższy dzień roboczy");
    expect(at([1, 3])).toBe("Czeka do 09:00 w jeden z 2 wybranych dni");
  });

  it("parametry-tłumaczenia: zdarzenie i limit czekania, etap CRM", () => {
    const wait = describeNode({
      type: "wait",
      params: {
        mode: "until_event",
        eventType: "checkout.completed.v1",
        condition: {},
        timeoutMinutes: 2880,
      },
    });
    expect(translateSummary(pl, wait)).toBe(
      `Czeka na: ${pl("adminJourneys.trigger.checkout_completed")} (najdłużej: 2 dni)`,
    );
    const stage = describeNode({
      type: "set_crm_stage",
      params: { stage: "proposal", onlyForward: true },
    });
    expect(translateSummary(pl, stage)).toBe("Ustaw etap sprzedaży: Oferta (tylko do przodu)");
    expect(translateSummary(en, stage)).toBe("Set sales stage: Proposal (forward only)");
  });

  it("mail z tematem i bez; parametry spoza schematu - „do poprawy”, bez wyjątku", () => {
    expect(translateSummary(pl, describeNode({ type: "send_email" }, { subject: " Witaj " }))).toBe(
      "Wyślij e-mail „Witaj”",
    );
    expect(translateSummary(pl, describeNode({ type: "send_email" }))).toBe(
      "Wyślij e-mail (treść do uzupełnienia)",
    );
    expect(describeNode({ type: "wait", params: { mode: "duration", minutes: 1 } }).labelKey).toBe(
      "adminJourneys.common.summary.invalid",
    );
    expect(describeNode({ type: "if_else", params: "zepsute" }).labelKey).toBe(
      "adminJourneys.common.summary.invalid",
    );
  });

  it("zdanie wyzwalacza z warunkiem i bez", () => {
    const plain = triggerSentence({ triggerEventType: "account.registered.v1" });
    expect(translateSummary(pl, plain)).toBe(
      `Start: ${pl("adminJourneys.trigger.account_registered")}`,
    );
    const conditioned = triggerSentence({
      triggerEventType: "checkout.abandoned.v1",
      triggerCondition: { kind: "subscription" },
    });
    expect(translateSummary(pl, conditioned)).toBe(
      `Start: ${pl("adminJourneys.trigger.checkout_abandoned")} (warunek: kind = subscription)`,
    );
    expect(translateSummary(en, conditioned)).toContain("(condition: kind = subscription)");
    expect(describeNode({ type: "trigger" }).labelKey).toBe("adminJourneys.common.summary.trigger");
  });
});

describe("paleta kroków", () => {
  it("grupy SPEC w kolejności, mapowanie typów z rodzin S5", () => {
    const palette = journeyPalette();
    expect(palette.map((g) => g.group)).toEqual([...JOURNEY_PALETTE_GROUPS]);
    const groupOf = (id: string) => palette.find((g) => g.items.some((i) => i.id === id))?.group;
    expect(groupOf("newsletter_list")).toBe("newsletter");
    expect(groupOf("notify_staff")).toBe("crm");
    for (const id of [
      "set_lifecycle_stage",
      "set_crm_stage",
      "create_crm_task",
      "add_tag",
      "remove_tag",
    ]) {
      expect(groupOf(id)).toBe("crm");
    }
    expect(groupOf("wait_until_event")).toBe("time");
    expect(groupOf("ab_split")).toBe("logic");
    expect(groupOf("goal")).toBe("end");
  });

  it("parametry startowe przechodzą schematy, napisy mają tłumaczenia", () => {
    for (const group of journeyPalette()) {
      noRawKey(pl(group.labelKey));
      noRawKey(en(group.labelKey));
      for (const item of group.items) {
        expect(NODE_PARAMS_SCHEMAS[item.type].safeParse(item.params).success, item.id).toBe(true);
        noRawKey(pl(item.labelKey));
        noRawKey(en(item.effectKey));
        expect(item.disabledReasonKey).toBeUndefined();
      }
    }
  });

  it("przy wyzwalaczu windykacji mail jest wyłączony z powodem", () => {
    const palette = journeyPalette({ triggerEventType: "billing_subscription.payment_failed.v1" });
    const mail = palette.flatMap((g) => g.items).find((i) => i.id === "send_email");
    expect(mail?.disabledReasonKey).toBe("adminJourneys.common.palette.emailForbidden");
    noRawKey(pl(mail?.disabledReasonKey ?? ""));
  });

  it("wyszukiwanie bez wielkości liter i polskich znaków", () => {
    expect(normalizeSearch("  Żółć ŁĄKA-e-mail ")).toBe("zolc laka e mail");
    expect(matchesSearch("zadanie", "Utwórz ZADANIE CRM")).toBe(true);
    expect(matchesSearch("e-mail", "Wyślij E MAIL")).toBe(true);
    expect(matchesSearch("", "cokolwiek")).toBe(true);
    expect(matchesSearch("cel", "Koniec")).toBe(false);
  });
});

describe("fakty szablonu", () => {
  const facts = (key: keyof typeof JOURNEY_TEMPLATES) =>
    templateFacts(toCatalogEntry(JOURNEY_TEMPLATES[key]));

  it("szablon niedostępny: wymaganie zdarzenia szyny z nazwą zdarzenia (Z-S5-01)", () => {
    expect(facts("pricing_enquiry_b2b")).toMatchObject({
      available: false,
      awaitedEvent: "contact_message.submitted.v1",
      requirements: ["busEvent"],
      doesNotSend: ["noEmails"],
      emailCount: 0,
    });
  });

  it("marketing z mailami: zgoda i nazwa nadawcy; usługa: podstawa prawna, bez promocji", () => {
    expect(facts("welcome_onboarding")).toMatchObject({
      category: "marketing",
      requirements: ["marketingConsent", "senderName"],
      doesNotSend: ["withoutConsent", "afterPurchase"],
      goalEventType: "checkout.completed.v1",
      reentry: "never",
      cooldownDays: null,
    });
    expect(facts("trial_ending")).toMatchObject({
      category: "service",
      requirements: ["legalBasis"],
      doesNotSend: ["promotions"],
    });
    expect(facts("payment_failed_crm").doesNotSend).toEqual(["noEmails", "dunning"]);
    expect(facts("abandoned_checkout")).toMatchObject({ reentry: "cooldown", cooldownDays: 14 });
    expect(facts("cancel_scheduled_save").replacesWorkflowTemplate).toBe(
      "subscription-cancel-scheduled-crm-task",
    );
  });

  it.each(Object.keys(JOURNEY_TEMPLATES))("%s: każdy fakt ma tłumaczenie PL i EN", (key) => {
    const f = facts(key as keyof typeof JOURNEY_TEMPLATES);
    for (const code of f.requirements) noRawKey(en(JOURNEY_REQUIREMENT_LABEL_KEY[code]));
    for (const code of f.doesNotSend) noRawKey(pl(JOURNEY_EXCLUSION_LABEL_KEY[code]));
    noRawKey(pl(JOURNEY_TEMPLATE_TIP_KEY[f.key]));
    noRawKey(en(JOURNEY_TEMPLATE_TIP_KEY[f.key]));
    expect(f.stepCount).toBe(JOURNEY_TEMPLATES[f.key].graph.nodes.length);
  });

  it("wskazówki Insidera nie niosą liczb benchmarków", () => {
    for (const key of Object.values(JOURNEY_TEMPLATE_TIP_KEY)) {
      expect(pl(key)).not.toMatch(/\d/);
      expect(en(key)).not.toMatch(/\d/);
    }
  });
});

describe("licznik aktywnych i zdrowie silnika", () => {
  it("activeJourneyCount liczy wyłącznie aktywne", () => {
    expect(
      activeJourneyCount([
        { status: "active" },
        { status: "paused" },
        { status: "active" },
        { status: "draft" },
      ]),
    ).toBe(2);
    expect(activeJourneyCount(null)).toBe(0);
  });

  const NOW = Date.parse("2026-10-20T12:00:00Z");
  const health = (patch: Partial<JourneyEngineHealthDto> = {}) => ({
    enabled: true,
    killSwitch: false,
    dueNow: 0,
    lastStepAt: null,
    failed24h: 0,
    deadSteps24h: 0,
    errors24h: {},
    ...patch,
  });

  it("od najważniejszego: wyłącznik, wyłączony, harmonogram (Z-S5-03), postój, błędy", () => {
    expect(engineHealthNotice(health({ killSwitch: true, enabled: false }), NOW)).toBe(
      "kill_switch",
    );
    expect(engineHealthNotice(health({ enabled: false, dueNow: 5 }), NOW)).toBe("disabled");
    expect(engineHealthNotice(health({ dueNow: 3 }), NOW)).toBe("scheduler_pending");
    expect(engineHealthNotice(health({ dueNow: 3 }), NOW, 1)).toBe("scheduler_pending");
    expect(engineHealthNotice(health({ dueNow: 3, lastStepAt: "2026-10-20T11:00:00Z" }), NOW)).toBe(
      "stalled",
    );
    expect(
      engineHealthNotice(health({ dueNow: 3, lastStepAt: "2026-10-20T11:58:00Z" }), NOW),
    ).toBeNull();
    expect(engineHealthNotice(health({ errors24h: { email: 2 } }), NOW)).toBe("errors");
    expect(engineHealthNotice(health({ failed24h: 1 }), NOW)).toBe("errors");
    expect(engineHealthNotice(health(), NOW)).toBeNull();
  });

  it("kolejka malejąca (ktoś wykonuje kroki) to nie „harmonogram niepodpięty”", () => {
    expect(engineHealthNotice(health({ dueNow: 2 }), NOW, 5)).toBeNull();
  });

  it("każdy komunikat i etykieta stanu ma tłumaczenie", () => {
    for (const key of [
      ...Object.values(JOURNEY_ENGINE_NOTICE_KEY),
      ...Object.values(JOURNEY_STATUS_LABEL_KEY),
      ...Object.values(JOURNEY_CATEGORY_LABEL_KEY),
      ...Object.values(JOURNEY_CATEGORY_HINT_KEY),
      ...Object.values(JOURNEY_REENTRY_LABEL_KEY),
    ]) {
      noRawKey(pl(key));
      noRawKey(en(key));
    }
  });
});

// ── Słownik S8-A ────────────────────────────────────────────────────────────

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`),
  );
}

const PLURAL = /_(zero|one|two|few|many|other)$/;

function productionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "__tests__" ? [] : productionSources(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [readFileSync(path, "utf8")] : [];
  });
}

describe("słownik `i18n-admin-journeys-list` (S8-A)", () => {
  const plTree = journeysListDictionaries.pl as unknown as Tree;
  const enTree = journeysListDictionaries.en as unknown as Tree;
  const plKeys = leaves(plTree);

  it("parytet PL/EN: te same klucze, EN niepusty i różny tam, gdzie to zdanie", () => {
    expect(leaves(enTree)).toEqual(plKeys);
    for (const key of plKeys) {
      const value = key.split(".").reduce<unknown>((node, part) => (node as Tree)[part], enTree);
      expect(typeof value === "string" && value.trim() !== "", key).toBe(true);
    }
  });

  it("liczebniki: każda grupa ma formy _one/_few/_many/_other", () => {
    const bases = new Set(plKeys.filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")));
    for (const base of bases) {
      for (const form of ["one", "few", "many", "other"])
        expect(plKeys, base).toContain(`${base}_${form}`);
    }
  });

  it("zero kolizji z kluczami S5 (`i18n-admin-journeys`)", () => {
    const s5 = new Set(leaves(journeysDictionaries.pl as unknown as Tree));
    const s5Branches = new Set(
      leaves(journeysDictionaries.pl as unknown as Tree).map((k) =>
        k.split(".").slice(0, 2).join("."),
      ),
    );
    expect(plKeys.filter((key) => s5.has(key))).toEqual([]);
    const mine = new Set(plKeys.map((k) => k.split(".").slice(0, 2).join(".")));
    expect([...mine].filter((branch) => s5Branches.has(branch))).toEqual([]);
    expect([...mine].sort()).toEqual([
      "adminJourneys.common",
      "adminJourneys.create",
      "adminJourneys.engineSettings",
      "adminJourneys.engineStrip",
      "adminJourneys.gallery",
      "adminJourneys.list",
    ]);
  });

  it("każdy klucz ma czytelnika w kodzie produkcyjnym S8-A", () => {
    const sources = [
      ...productionSources("src/lib/admin/journeys"),
      ...productionSources("src/components/admin/journeys/list"),
      readFileSync("src/components/admin/revenue/tabs/RevenueJourneysTab.tsx", "utf8"),
    ].join("\n");
    const unread = plKeys
      .map((key) => key.replace(PLURAL, ""))
      .filter((key, index, all) => all.indexOf(key) === index)
      .filter((key) => !sources.includes(`"${key}"`));
    expect(unread).toEqual([]);
  });
});
