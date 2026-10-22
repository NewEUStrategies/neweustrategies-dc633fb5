// KONTRAKT ODNOŚNIKÓW HUBA (SPEC §2.6, karta S7): każdy `drillHref` i każdy
// link z huba wskazuje trasę z `routeTree.gen.ts`, a parametry adresu
// przechodzą walidator TEJ trasy bez utraty wartości.
//
// CO TEN PLIK DOWODZI. Link do nieistniejącej trasy kończy się 404, a link
// z parametrem, którego walidator ekranu nie zna, kończy się na ekranie,
// który parametr po cichu zignoruje (admin ląduje na pierwszej zakładce
// modułu zamiast na tej, o której mówi diagnoza). Oba błędy przechodzą
// kompilację - router typuje `to`, ale nie wartości `search` z danych.
//
// ŹRÓDŁA ODNOŚNIKÓW - dwa rodzaje:
//   A. DANE: kafle KPI (Kokpit, Przychód, Retencja, Społeczność), ekrany-
//      właściciele obszarów, pasek „Powiązane moduły", „Zacznij tutaj",
//      właściciele i naprawy-odnośniki rejestru reguł (z parametrem
//      wypełnianym `refs`), skróty ⌘K wskaźników;
//   B. KOD: każdy literał `"/admin/…"` w plikach huba (komponenty zakładek,
//      biblioteka huba, diagnostyka, kafel pulpitu) oraz każdy `<Link>`
//      z dosłownym `search={{…}}`/`params={{…}}` - także w kartach, które
//      nie mają tablicy odnośników (studio wydarzenia, analityka klubu,
//      skrzynka zgłoszeń, Członkostwo).
// Walidatory to PRAWDZIWE funkcje tras albo ich liście (`*Tabs.ts`) - nie
// lustra w teście, więc zmiana kontraktu ekranu zapala ten plik.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COMMUNITY_CLUB_TILES, COMMUNITY_EVENT_TILES } from "@/components/admin/revenue/community/communityTiles";
import { GETTING_STARTED_LINKS } from "@/components/admin/revenue/overview/gettingStarted";
import { parseBillingSearch } from "@/lib/admin/billingTabs";
import { parsePaywallSearch } from "@/lib/admin/paywallTabs";
import { parseMembershipSearch, parsePricingSearch } from "@/lib/admin/pricingTabs";
import { AREA_OWNER_LINK, RELATED_MODULES } from "@/lib/admin/revenue/hubTabs";
import { metricSearchEntries } from "@/lib/admin/revenue/metricSearchIndex";
import { REVENUE_TILE_SETS } from "@/lib/admin/revenue/overviewTiles";
import { maskComments } from "@/lib/ci/i18nKeyUsage";
import { isRevenueTab, parseRevenueHubSearch } from "@/lib/revenue/search";
import { REVENUE_CHECKS } from "@/lib/revenue/diagnostics/registry";
import { routeSearchValidator } from "@/test/routeHarness";
import { Route as ClubApplicationsRoute } from "@/routes/admin.community.clubs.applications";
import { Route as ClubEditorRoute } from "@/routes/admin.community.clubs.$clubId";
import { Route as CouponsRoute } from "@/routes/admin.coupons";
import { Route as WorkflowsRoute } from "@/routes/admin.workflows";

type Search = Readonly<Record<string, string>>;

interface HubLinkCase {
  /** Skąd odnośnik (komunikat asercji). */
  source: string;
  to: string;
  params?: Search;
  search?: Search;
}

const ROUTE_PATHS: ReadonlySet<string> = new Set(
  [...readFileSync("src/routeTree.gen.ts", "utf8").matchAll(/fullPath: '([^']+)'/g)].map((m) =>
    m[1] === "/" ? "/" : m[1].replace(/\/$/, ""),
  ),
);

/**
 * Adres → trasa drzewa: dosłownie (także szablon `$param` podany wprost jako
 * `to`) albo konkretny adres pasujący do szablonu. `$tab` huba musi być
 * zakładką z `REVENUE_TABS` (kokpit ma jeden adres - indeks), inaczej
 * `beforeLoad` trasy kończy się 404 mimo zgodnego szablonu.
 */
function routeOf(path: string): string | null {
  const clean = path === "/" ? "/" : path.replace(/\/$/, "");
  if (ROUTE_PATHS.has(clean)) return clean;
  const segments = clean.split("/");
  for (const template of ROUTE_PATHS) {
    const parts = template.split("/");
    if (parts.length !== segments.length) continue;
    const ok = parts.every((part, i) => {
      if (!part.startsWith("$")) return part === segments[i];
      if (template === "/admin/revenue/$tab") {
        return isRevenueTab(segments[i]) && segments[i] !== "overview";
      }
      return segments[i].length > 0;
    });
    if (ok) return template;
  }
  return null;
}

/** Walidatory adresu tras - parametr musi przejść BEZ utraty wartości. */
const VALIDATORS: Readonly<Record<string, (raw: Record<string, unknown>) => object>> = {
  "/admin/revenue": parseRevenueHubSearch,
  "/admin/revenue/$tab": parseRevenueHubSearch,
  "/admin/paywall": parsePaywallSearch,
  "/admin/pricing": parsePricingSearch,
  "/admin/membership": parseMembershipSearch,
  "/admin/billing": parseBillingSearch,
  "/admin/workflows": routeSearchValidator(WorkflowsRoute),
  "/admin/coupons": routeSearchValidator(CouponsRoute),
  "/admin/community/clubs/applications": routeSearchValidator(ClubApplicationsRoute),
  "/admin/community/clubs/$clubId": routeSearchValidator(ClubEditorRoute),
};

function substitute(to: string, params: Search | undefined): string {
  let path = to;
  for (const [key, value] of Object.entries(params ?? {})) path = path.replace(`$${key}`, value);
  return path;
}

function expectValidLink(link: HubLinkCase): void {
  const route = routeOf(substitute(link.to, link.params));
  expect(route, `${link.source}: trasa ${link.to}`).not.toBeNull();
  if (route === "/admin/revenue/$tab" && link.params?.tab !== undefined) {
    expect(isRevenueTab(link.params.tab), `${link.source}: $tab=${link.params.tab}`).toBe(true);
  }
  const search = link.search ?? {};
  if (Object.keys(search).length === 0) return;
  const validate = route ? VALIDATORS[route] : undefined;
  expect(validate, `${link.source}: ${route} bez walidatora w kontrakcie §2.6`).toBeDefined();
  expect(validate?.({ ...search }), `${link.source}: ${route}?${new URLSearchParams(search)}`).toMatchObject(
    search,
  );
}

// ---------------------------------------------------------------------------
// A. Odnośniki z danych
// ---------------------------------------------------------------------------

/** Przykładowy identyfikator `refs` diagnozy - kształt tokenu adresu huba. */
const SAMPLE_REF = "welcome_onboarding";

function dataLinks(): HubLinkCase[] {
  const tiles = [
    ...Object.entries(REVENUE_TILE_SETS).flatMap(([set, specs]) =>
      specs.map((spec) => ({ source: `kafel ${set}.${spec.metricId}`, to: spec.drillHref })),
    ),
    ...[...COMMUNITY_EVENT_TILES, ...COMMUNITY_CLUB_TILES].map((spec) => ({
      source: `kafel community.${spec.metricId}`,
      to: spec.drillHref,
    })),
  ];
  const areas = Object.entries(AREA_OWNER_LINK).map(([area, link]) => ({
    source: `obszar ${area}`,
    ...link,
  }));
  const related = RELATED_MODULES.map((link) => ({ source: `powiązany ${link.labelKey}`, ...link }));
  const started = Object.entries(GETTING_STARTED_LINKS).map(([step, link]) => ({
    source: `zacznij tutaj ${step}`,
    ...link,
  }));
  const checks = REVENUE_CHECKS.flatMap((check) => {
    const out: HubLinkCase[] = [{ source: `właściciel ${check.id}`, ...check.owner }];
    if (check.fix?.kind === "link") {
      const { refParam, to, search } = check.fix;
      out.push({
        source: `naprawa ${check.id}`,
        to,
        search: refParam ? { ...search, [refParam]: SAMPLE_REF } : search,
      });
    }
    return out;
  });
  const shortcuts = metricSearchEntries("Wskaźniki", ["admin"]).map((entry) => ({
    source: `⌘K ${entry.label}`,
    to: entry.to,
    search: entry.search,
  }));
  return [...tiles, ...areas, ...related, ...started, ...checks, ...shortcuts];
}

describe("A. odnośniki z danych huba", () => {
  const links = dataLinks();

  it("zbiór jest kompletny (kafle, obszary, moduły, start, reguły, ⌘K)", () => {
    const kinds = new Set(links.map((link) => link.source.split(" ")[0]));
    expect([...kinds].sort()).toEqual(
      ["kafel", "naprawa", "obszar", "powiązany", "właściciel", "zacznij", "⌘K"].sort(),
    );
  });

  it.each(links.map((link) => [link.source, link] as const))("%s", (_source, link) => {
    expectValidLink(link);
  });
});

// ---------------------------------------------------------------------------
// B. Odnośniki w kodzie huba
// ---------------------------------------------------------------------------

const SCANNED = [
  "src/components/admin/revenue",
  "src/lib/admin/revenue",
  "src/lib/revenue/diagnostics",
  "src/components/admin/dashboard/MarketingPanel.tsx",
];

function productionFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((entry) => {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : productionFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const SOURCES = SCANNED.flatMap(productionFiles).map((file) => ({
  file,
  text: maskComments(readFileSync(file, "utf8")),
}));

/** Obiekt `{ klucz: "wartość" }` z dosłownymi napisami (reszta = dane, pomijamy). */
function literalObject(text: string | undefined): Search | undefined {
  if (!text) return undefined;
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/(\w+):\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Atrybuty elementu `<Link …>` - koniec na `>` poza nawiasami i napisami. */
function linkElements(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/<Link\b/g)) {
    let depth = 0;
    let quote: string | null = null;
    let i = (match.index ?? 0) + 5;
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === quote && text[i - 1] !== "\\") quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    out.push(text.slice(match.index, i));
  }
  return out;
}

function codeLinks(): HubLinkCase[] {
  const out: HubLinkCase[] = [];
  for (const { file, text } of SOURCES) {
    for (const m of text.matchAll(/"(\/admin(?:\/[^"\s]*)?)"/g)) {
      // `#…` to klucz mapy ekranów (`SourceHeader`: trasa#zakładka), nie część
      // adresu - sprawdzamy samą trasę.
      const [path, query] = m[1].split("#", 1)[0].split("?", 2);
      out.push({
        source: `${file} literał ${m[1]}`,
        to: path,
        search: query ? Object.fromEntries(new URLSearchParams(query)) : undefined,
      });
    }
    for (const element of linkElements(text)) {
      const to = /\bto="([^"]+)"/.exec(element)?.[1];
      if (!to) continue;
      out.push({
        source: `${file} <Link to="${to}">`,
        to,
        params: literalObject(/\bparams=\{\{([^}]*)\}\}/.exec(element)?.[1]),
        search: literalObject(/\bsearch=\{\{([^}]*)\}\}/.exec(element)?.[1]),
      });
    }
  }
  return out;
}

describe("B. odnośniki w kodzie huba", () => {
  const links = codeLinks();

  it("skan widzi karty S7 z parametrami (studio, analityka klubu, skrzynka, ścieżki)", () => {
    const targets = links.map((link) => `${link.to}?${new URLSearchParams(link.search ?? {})}`);
    expect(targets).toEqual(
      expect.arrayContaining([
        "/admin/events/$eventId/overview?",
        "/admin/community/clubs/$clubId?tab=analytics",
        "/admin/community/clubs/applications?status=pending",
        "/admin/membership?",
        "/admin/revenue/$tab?",
      ]),
    );
  });

  it.each(links.map((link) => [link.source, link] as const))("%s", (_source, link) => {
    expectValidLink(link);
  });
});
