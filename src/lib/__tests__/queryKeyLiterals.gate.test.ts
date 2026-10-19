// BRAMKA: KLUCZE REACT QUERY Z FABRYK, NIE Z LITERAŁÓW (SPEC §8.1, I2).
//
// CO SIĘ DZIEJE BEZ NIEJ. Klucz zapisany literałem w ekranie i drugi raz
// literałem w regule szyny zdarzeń to dwa niezależne napisy. Wystarczy, że
// ekran zmieni kształt (`["crm-tasks", "due"]` → `["crm-tasks-due"]`), a reguła
// `crm_task.*` dalej unieważnia stary prefiks: lista „Do zrobienia" przestaje
// odświeżać się na żywo - bez błędu, bez ostrzeżenia, do pierwszego
// przeładowania. Fabryka robi z obu miejsc JEDNO wywołanie.
//
// CO PILNUJE. Plik spoza listy długu nie może zawierać literału tablicowego,
// którego wiodące napisy RÓWNAJĄ SIĘ prefiksowi którejkolwiek fabryki huba.
// Prefiksy nie są przepisane ręcznie: wylicza je wywołanie każdej funkcji
// fabryki z argumentami-wartownikami (napisy przed pierwszym wartownikiem).
// Nowa funkcja fabryki jest więc pilnowana od chwili, w której powstaje.
//
// DLACZEGO RÓWNOŚĆ ELEMENTÓW, A NIE PREFIKS NAPISU. `["crm-lead-timeline", id]`
// nie jest kluczem `["crm-lead", id]`, a `["admin", "billing", "catalog-state"]`
// nie jest długiem tylko dlatego, że fabryka zna `["admin", "billing",
// "test-plans"]`. Porównanie liter zamiast elementów robiłoby fałszywe alarmy,
// a fałszywy alarm uczy wyłączać bramkę.
//
// KOMENTARZE SĄ MASKOWANE (`bezKomentarzy`), bo w tym repo komentarze CYTUJĄ
// klucze (`couponQueries.ts:5`, `newsletterFieldLabels.ts:134`) - inaczej
// bramka zmuszałaby do kasowania zdań, które wyjaśniają kod.
//
// LISTA DŁUGU JEST ZAMROŻONA w I0. Wycinek usuwa literały ze SWOICH plików
// i NIE edytuje listy (plik współdzielony); wpis nieaktualny jest tylko
// drukowany. Tryb ścisły (wpis nieaktualny = błąd, lista pusta) włącza I9.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { accessKeys, checkoutKeys, meteringKeys } from "@/lib/access/keys";
import { couponKeys } from "@/lib/admin/couponKeys";
import { workflowKeys } from "@/lib/admin/workflowKeys";
import { billingKeys } from "@/lib/billing/keys";
import { bezKomentarzy } from "@/lib/ci/sourceScan";
import { crmKeys } from "@/lib/crm/keys";
import { journeyKeys } from "@/lib/journeys/keys";
import { newsletterKeys } from "@/lib/newsletter/keys";
import { retentionKeys } from "@/lib/retention/keys";
import { revenueKeys } from "@/lib/revenue/keys";

/** Fabryki, których prefiksy pilnuje bramka. */
const FABRYKI: Readonly<Record<string, object>> = {
  accessKeys,
  billingKeys,
  checkoutKeys,
  couponKeys,
  crmKeys,
  journeyKeys,
  meteringKeys,
  newsletterKeys,
  retentionKeys,
  revenueKeys,
  workflowKeys,
};

/**
 * Klucze bez funkcji w fabryce, które i tak są długiem. `["admin-access-plans"]`
 * czyta dziś /admin/paywall; S1 przenosi go na `billingKeys.admin.plansAll()`
 * (inny kształt, więc nie wynika z wywołania fabryki).
 */
const LEGACY_KEY_ALIASES: readonly (readonly string[])[] = [["admin-access-plans"]];

/**
 * Pliki, w których literały kluczy fabryk wolno jeszcze trzymać - stan po I0,
 * posortowany, z wycinkiem-właścicielem w komentarzu. Wycinek usuwa literały
 * ze swoich plików; listę czyści I9.
 */
const QUERY_KEY_LITERAL_DEBT: readonly string[] = [
  "src/components/admin/AccessSettingsPane.tsx", // S1
  "src/components/admin/PostGeneralOverview.tsx", // S1
  "src/components/admin/billing/AdminBillingPanel.tsx", // S2
  "src/components/admin/billing/AdminPaymentOrdersPanel.tsx", // S2
  "src/components/admin/billing/AdminPaymentsDiagnosticsPanel.tsx", // S2
  "src/components/admin/coupons/organisms/CampaignsPage.tsx", // S1
  "src/components/admin/crm/CrmPartnerEndpointsPanel.tsx", // S4
  "src/components/admin/crm/FollowUpsPanel.tsx", // S4
  "src/components/admin/crm/ImportLeadsCsvDialog.tsx", // S4
  "src/components/admin/crm/LeadTasksPanel.tsx", // S4
  "src/components/admin/crm/MeteringUsageCard.tsx", // S4
  "src/components/admin/crm/NewCompanyDialog.tsx", // S4
  "src/components/admin/crm/ScoreBreakdownCard.tsx", // S4
  "src/components/admin/crm/ScoringSettingsDialog.tsx", // S4
  "src/components/admin/newsletter/OverviewPanel.tsx", // S1
  "src/components/admin/newsletter/PopupEventsPanel.tsx", // S1
  "src/components/admin/newsletter/SubscribersPanel.tsx", // S1
  "src/components/admin/newsletter/subscribers/ImportCsvDialog.tsx", // S1
  "src/components/admin/post-editor/molecules/OrganizationCreateForm.tsx", // S4
  "src/components/admin/pricing/organisms/RetentionTab.tsx", // S1
  "src/components/admin/workflows/CorrelationTracePanel.tsx", // S4
  "src/components/admin/workflows/WorkflowRunsPanel.tsx", // S4
  "src/components/admin/workflows/WorkflowTemplatesPanel.tsx", // S4
  "src/hooks/useCheckoutSettings.ts", // S1
  "src/hooks/useNewsletterSettings.ts", // S1
  "src/lib/access/metering.ts", // S1
  "src/lib/admin/couponQueries.ts", // S1
  "src/lib/crm/leadMutations.ts", // S4
  "src/lib/retention/queries.ts", // S1
  "src/routes/admin.companies.$id.tsx", // S4
  "src/routes/admin.companies.index.tsx", // S4
  "src/routes/admin.coupons.redemptions.tsx", // S1
  "src/routes/admin.crm.$id.tsx", // S4
  "src/routes/admin.crm.funnel.index.tsx", // S4
  "src/routes/admin.crm.index.tsx", // S4
  "src/routes/admin.monetization.tsx", // S1
  "src/routes/admin.newsletter.campaigns.$id.tsx", // S1
  "src/routes/admin.newsletter.campaigns.index.tsx", // S1
  "src/routes/admin.newsletter.overview.tsx", // S1
  "src/routes/admin.paywall.tsx", // S1
  "src/routes/admin.workflows.tsx", // S4
];

/* ------------------------------------------------------------ sygnatury */

/**
 * Wartownik zamiast argumentu. Proxy oddaje samego siebie przy KAŻDYM
 * odczycie pola, więc fabryka czytająca `range.current.sinceIso` albo
 * `filters.currency ?? null` dostaje wartownika, a nie wyjątek. Nie jest
 * napisem - sygnatura kończy się na nim.
 */
const WARTOWNIK: unknown = new Proxy(function wartownik() {}, {
  get: (_cel, pole) => (pole === Symbol.toPrimitive ? () => "\u0000wartownik" : WARTOWNIK),
});
const ARGUMENTY = Array.from({ length: 6 }, () => WARTOWNIK);

type Sygnatura = readonly string[];

/** Wiodące napisy klucza - do pierwszego elementu, który nie jest napisem. */
function wiodaceNapisy(klucz: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const el of klucz) {
    if (typeof el !== "string") break;
    out.push(el);
  }
  return out;
}

function sygnaturyFabryki(nazwa: string, fabryka: object): { sciezka: string; syg: Sygnatura }[] {
  const out: { sciezka: string; syg: Sygnatura }[] = [];
  for (const [pole, wartosc] of Object.entries(fabryka)) {
    const sciezka = `${nazwa}.${pole}`;
    if (typeof wartosc === "function") {
      const klucz: unknown = (wartosc as (...a: unknown[]) => unknown)(...ARGUMENTY);
      if (!Array.isArray(klucz)) throw new Error(`${sciezka}() nie zwraca tablicy`);
      out.push({ sciezka, syg: wiodaceNapisy(klucz) });
    } else if (typeof wartosc === "object" && wartosc !== null) {
      out.push(...sygnaturyFabryki(sciezka, wartosc));
    }
  }
  return out;
}

const SYGNATURY_FUNKCJI = Object.entries(FABRYKI).flatMap(([n, f]) => sygnaturyFabryki(n, f));

const SYGNATURY: readonly Sygnatura[] = [
  ...new Map(
    [...SYGNATURY_FUNKCJI.map((s) => s.syg), ...LEGACY_KEY_ALIASES].map((s) => [
      JSON.stringify(s),
      s,
    ]),
  ).values(),
];

/* ---------------------------------------------------------------- skaner */

const NAPIS = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`;
/** `[` + co najmniej jeden napis + kolejne napisy po przecinkach. */
const LITERAL = new RegExp(String.raw`\[\s*((?:${NAPIS})(?:\s*,\s*(?:${NAPIS}))*)`, "g");
const NAPIS_GLOBALNY = new RegExp(NAPIS, "g");

interface Trafienie {
  linia: number;
  literal: string;
}

/** Czy wiodące napisy literału zaczynają się DOKŁADNIE elementami sygnatury. */
function pasuje(literal: readonly string[], syg: Sygnatura): boolean {
  return literal.length >= syg.length && syg.every((el, i) => literal[i] === el);
}

/** Literały kluczy fabryk w źródle (komentarze zamaskowane). */
function trafienia(zrodlo: string): Trafienie[] {
  const kod = bezKomentarzy(zrodlo);
  const out: Trafienie[] = [];
  for (const m of kod.matchAll(LITERAL)) {
    const start = m.index ?? 0;
    // `obiekt["crm-leads"]` to odczyt pola, nie tablica. Prettier nie stawia
    // spacji przed nawiasem dostępu, więc znak tuż przed `[` rozstrzyga.
    if (start > 0 && /[\w$)\]]/.test(kod[start - 1])) continue;
    const napisy = (m[1].match(NAPIS_GLOBALNY) ?? []).map((n) => n.slice(1, -1));
    if (!SYGNATURY.some((syg) => pasuje(napisy, syg))) continue;
    // Dalsze elementy (identyfikatory, obiekty) skracamy do „…" - komunikat
    // ma wskazać miejsce, nie przepisywać wyrażenia.
    const ciag = /^\s*,/.test(kod.slice(start + m[0].length)) ? ", …" : "";
    out.push({
      linia: kod.slice(0, start).split("\n").length,
      literal: `[${napisy.map((n) => JSON.stringify(n)).join(", ")}${ciag}]`,
    });
  }
  return out;
}

/** Plik, którego bramka nie czyta: testy, typy generowane i same fabryki. */
function pominiety(sciezka: string): boolean {
  return (
    sciezka.includes("/__tests__/") ||
    /\.(test|spec)\.tsx?$/.test(sciezka) ||
    sciezka.startsWith("src/test/") ||
    sciezka === "src/integrations/supabase/types.ts" ||
    sciezka === "src/routeTree.gen.ts" ||
    /\/keys\.ts$/.test(sciezka) ||
    /Keys\.ts$/.test(sciezka)
  );
}

function plikiZrodlowe(katalog: string): string[] {
  const out: string[] = [];
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const sciezka = join(katalog, wpis.name);
    if (wpis.isDirectory()) out.push(...plikiZrodlowe(sciezka));
    else if (/\.tsx?$/.test(wpis.name) && !pominiety(sciezka)) out.push(sciezka);
  }
  return out;
}

const PLIKI = plikiZrodlowe("src");

const SKAN = new Map(
  PLIKI.map((plik) => [plik, trafienia(readFileSync(plik, "utf8"))] as const).filter(
    ([, t]) => t.length > 0,
  ),
);

/** Źródła fabryk - jedyne pliki, w których literał klucza jest NA MIEJSCU. */
const PLIKI_FABRYK = [
  "src/lib/access/keys.ts",
  "src/lib/admin/couponKeys.ts",
  "src/lib/admin/workflowKeys.ts",
  "src/lib/billing/keys.ts",
  "src/lib/crm/keys.ts",
  "src/lib/journeys/keys.ts",
  "src/lib/newsletter/keys.ts",
  "src/lib/retention/keys.ts",
  "src/lib/revenue/keys.ts",
] as const;

/* ---------------------------------------------------------------- testy */

describe("bramka literałów kluczy React Query", () => {
  it("sygnatury są wyliczone z fabryk i żadna nie jest samym `admin`", () => {
    // `["admin"]` jako sygnatura dopasowałaby KAŻDY klucz panelu - bramka
    // stałaby się czerwona na wszystkim i ktoś by ją wyłączył.
    for (const { sciezka, syg } of SYGNATURY_FUNKCJI) {
      expect(syg.length, `${sciezka}: klucz musi zaczynać się napisem`).toBeGreaterThan(0);
      if (syg[0] === "admin") expect(syg.length, sciezka).toBeGreaterThanOrEqual(2);
    }
    expect(SYGNATURY.length).toBeGreaterThan(40);
  });

  it("lista długu jest posortowana, bez powtórzeń i nie zawiera plików fabryk", () => {
    expect([...QUERY_KEY_LITERAL_DEBT].sort()).toEqual(QUERY_KEY_LITERAL_DEBT);
    expect(new Set(QUERY_KEY_LITERAL_DEBT).size).toBe(QUERY_KEY_LITERAL_DEBT.length);
    expect(QUERY_KEY_LITERAL_DEBT.filter(pominiety)).toEqual([]);
  });

  it("plik spoza listy długu nie trzyma literału klucza fabryki", () => {
    const dlug = new Set(QUERY_KEY_LITERAL_DEBT);
    const nowe = [...SKAN]
      .filter(([plik]) => !dlug.has(plik))
      .flatMap(([plik, t]) => t.map((x) => `${plik}:${x.linia} ${x.literal}`));
    // Naprawa: zamień literał na wywołanie fabryki (`crmKeys.tasksDue()`,
    // `billingKeys.admin.members()`…) - kształt jest ten sam, cache trafia.
    expect(nowe).toEqual([]);
  });

  it("wpis nieaktualny jest tylko odnotowany (tryb ścisły - I9)", () => {
    const nieaktualne = QUERY_KEY_LITERAL_DEBT.filter((plik) => !SKAN.has(plik));
    // Bez asercji ŚWIADOMIE: wycinek, który wyczyścił swój plik, nie może
    // dostać czerwieni za to, że nie edytował listy współdzielonej.
    if (nieaktualne.length > 0) {
      console.info(
        `[queryKeyLiterals] pliki bez literałów, do zdjęcia z listy w I9:\n  ${nieaktualne.join("\n  ")}`,
      );
    }
  });

  it("KANAREK: detektor łapie fiksturę i literały w realnych plikach repo", () => {
    // Bez kanarka zepsuty skaner (np. maska komentarzy zjadająca plik) jest
    // CICHO zielony - najgroźniejszy tryb awarii bramki.
    const fikstura = [
      `const a = useQuery({ queryKey: ["crm-tasks", "due"] });`,
      `qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns", id, "engagement"] });`,
      `const b = ["crm-lead-timeline", leadId];`,
      `// komentarz cytuje ["crm-leads"] i nie jest długiem`,
      `const c = ["crm-lead-profile-sync", leadId];`,
      `const d = ["admin", "billing", "catalog-state"];`,
      `const e = mapa["crm-leads"];`,
      `const f = ["admin-access-plans"];`,
      `const g = "napis z [\\"crm-leads\\"] w środku";`,
    ].join("\n");
    expect(trafienia(fikstura).map((t) => `${t.linia} ${t.literal}`)).toEqual([
      `1 ["crm-tasks", "due"]`,
      `2 ["admin", "newsletter-campaigns", …]`,
      `3 ["crm-lead-timeline", …]`,
      `8 ["admin-access-plans"]`,
    ]);

    // Realne pliki, nie tylko fikstura: źródła fabryk z definicji trzymają
    // literały kluczy. Liczymy je TAM, a nie w długu - dług maleje z każdym
    // wycinkiem i kanarek liczony na nim zaczerwieniłby wycinek, który zrobił
    // dokładnie to, czego bramka od niego chce.
    const wFabrykach = PLIKI_FABRYK.flatMap((plik) => trafienia(readFileSync(plik, "utf8")));
    expect(wFabrykach.length).toBeGreaterThanOrEqual(40);
    expect(PLIKI.length).toBeGreaterThan(500);
    expect(PLIKI_FABRYK.filter((plik) => !pominiety(plik))).toEqual([]);
  });
});
