// Odnośniki „moduł → hub" (SPEC §2.7, montaż I9): `useRevenueHubTab`,
// `RevenueHubLink`, `RevenueHubHint` i mały słownik `i18n-admin-revenue-links`.
//
// CO TEN PLIK DOWODZI:
//   1. BRAMKA PRZED ODNOŚNIKIEM. Przed hydratacją, bez roli huba (autor, sam
//      super_admin), bez najemcy i dla zakładki spoza roli (redaktor → Przychód)
//      nie ma ani odnośnika, ani wiersza - ta sama reguła co pasek zakładek
//      i ⌘K (`canSeeTab`).
//   2. ADRES PRZEZ KONTRAKT HUBA. Kokpit = `/admin/revenue`, reszta =
//      `/admin/revenue/$tab`; parametry (`?new=1&template=`, `?sec=`) przechodzą
//      walidator huba bez strat.
//   3. SŁOWNIK: PL i EN z tym samym kształtem, liczebniki, zero słów-klas
//      Tailwinda (arkusz publiczny), axe bez naruszeń.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  hydrated: true,
  auth: { roles: ["admin"] as string[], tenantId: "tenant-1" as string | null },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    useHydrated: () => h.hydrated,
    // Parametry adresu w atrybucie - asercja widzi kontrakt deep linku.
    Link: (props: { search?: Record<string, string>; children?: ReactNode }) => (
      <RouterLinkStub {...props} data-search={new URLSearchParams(props.search).toString()} />
    ),
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { RevenueHubHint } from "@/components/admin/revenue/molecules/RevenueHubHint";
import { RevenueHubLink } from "@/components/admin/revenue/molecules/RevenueHubLink";
import "@/lib/i18n-admin-revenue-links";
import { parseRevenueHubSearch } from "@/lib/revenue/search";

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.hydrated = true;
  h.auth = { roles: ["admin"], tenantId: "tenant-1" };
});

afterEach(() => cleanup());

describe("RevenueHubLink - bramka roli i hydratacji", () => {
  it.each([
    ["przed hydratacją", false, ["admin"], "tenant-1"],
    ["autor", true, ["author"], "tenant-1"],
    ["sam super_admin (bez roli huba)", true, ["super_admin"], "tenant-1"],
    ["admin bez najemcy", true, ["admin"], null],
  ] as const)("%s - nic", (_label, hydrated, roles, tenantId) => {
    h.hydrated = hydrated;
    h.auth = { roles: [...roles], tenantId };
    const { container } = render(<RevenueHubLink tab="journeys">Ścieżki</RevenueHubLink>);
    expect(container).toBeEmptyDOMElement();
  });

  it("redaktor nie dostaje odnośnika do zakładki z kwotami (Przychód - tylko admin)", () => {
    h.auth = { roles: ["editor"], tenantId: "tenant-1" };
    render(
      <>
        <RevenueHubLink tab="mrr">Przychód</RevenueHubLink>
        <RevenueHubLink tab="community">Społeczność</RevenueHubLink>
      </>,
    );
    expect(screen.queryByRole("link", { name: "Przychód" })).toBeNull();
    expect(screen.getByRole("link", { name: "Społeczność" })).toBeInTheDocument();
  });
});

describe("RevenueHubLink - adres przez kontrakt huba", () => {
  it("kokpit ma jeden adres (`/admin/revenue`), zakładka - `/admin/revenue/$tab`", () => {
    render(
      <>
        <RevenueHubLink tab="overview">Hub</RevenueHubLink>
        <RevenueHubLink tab="community" search={{ sec: "events" }}>
          Wydarzenia
        </RevenueHubLink>
      </>,
    );
    expect(screen.getByRole("link", { name: "Hub" }).getAttribute("href")).toBe("/admin/revenue");
    const events = screen.getByRole("link", { name: "Wydarzenia" });
    expect(events.getAttribute("href")).toBe("/admin/revenue/community");
    expect(events.getAttribute("data-search")).toBe("sec=events");
    expect(events.getAttribute("data-hub-tab")).toBe("community");
  });

  it("parametry galerii przechodzą walidator huba bez strat (`?new=1&template=`)", () => {
    render(
      <RevenueHubLink tab="journeys" search={{ new: "1", template: "event_registration_nurture" }}>
        Zautomatyzuj
      </RevenueHubLink>,
    );
    const raw = Object.fromEntries(
      new URLSearchParams(
        screen.getByRole("link", { name: "Zautomatyzuj" }).getAttribute("data-search") ?? "",
      ),
    );
    expect(parseRevenueHubSearch(raw)).toMatchObject({
      new: "1",
      template: "event_registration_nurture",
    });
  });
});

describe("RevenueHubHint - wiersz-drogowskaz", () => {
  it("zdanie i odnośnik dla roli huba; bez roli - ani zdania (obietnica bez drogi)", () => {
    const ui = (
      <RevenueHubHint
        tab="journeys"
        search={{ new: "1", template: "club_application_received" }}
        hint="Zdanie o hubie"
        action="Zautomatyzuj"
      />
    );
    const { unmount } = render(ui);
    expect(screen.getByTestId("revenue-hub-hint")).toHaveTextContent("Zdanie o hubie");
    expect(screen.getByRole("link", { name: "Zautomatyzuj" }).getAttribute("href")).toBe(
      "/admin/revenue/journeys",
    );
    unmount();

    h.auth = { roles: ["author"], tenantId: "tenant-1" };
    const { container } = render(ui);
    expect(container).toBeEmptyDOMElement();
  });

  it("axe bez naruszeń (PL i EN, prawdziwy słownik)", async () => {
    for (const lang of ["pl", "en"] as const) {
      await i18n.changeLanguage(lang);
      const t = realT(lang);
      const { container } = render(
        <RevenueHubHint
          tab="journeys"
          hint={t("adminRevenue.moduleLinks.clubs.automateHint")}
          action={t("adminRevenue.moduleLinks.clubs.automateAction")}
        />,
      );
      const violations = await axeViolations(container);
      expect(violations, summarize(violations)).toEqual([]);
      cleanup();
    }
  });
});

describe("słownik odnośników (`i18n-admin-revenue-links`)", () => {
  type Tree = { [key: string]: string | Tree };
  const branch = (lang: "pl" | "en") =>
    i18n.getResourceBundle(lang, "translation").adminRevenue.moduleLinks as Tree;
  function leaves(tree: Tree, prefix = ""): Array<[string, string]> {
    return Object.entries(tree).flatMap(([key, value]) =>
      typeof value === "string"
        ? [[`${prefix}${key}`, value] as [string, string]]
        : leaves(value, `${prefix}${key}.`),
    );
  }

  it("PL i EN mają ten sam komplet kluczy i różne napisy", () => {
    const pl = new Map(leaves(branch("pl")));
    const en = new Map(leaves(branch("en")));
    expect([...en.keys()].sort()).toEqual([...pl.keys()].sort());
    for (const [key, value] of pl) {
      if (value.length > 3) expect(en.get(key), key).not.toBe(value);
    }
  });

  it("liczebniki: PL odmienia „aktywne ścieżki”, EN - jedna i wiele", () => {
    const pl = realT("pl");
    const en = realT("en");
    const key = "adminRevenue.moduleLinks.events.journeysCount";
    expect(pl(key, { count: 1 })).toBe("1 aktywna ścieżka");
    expect(pl(key, { count: 3 })).toBe("3 aktywne ścieżki");
    expect(pl(key, { count: 5 })).toBe("5 aktywnych ścieżek");
    expect(en(key, { count: 1 })).toBe("1 active journey");
    expect(en(key, { count: 5 })).toBe("5 active journeys");
  });

  // Pliki `src/lib/i18n-*.ts` skanuje generator CSS czytelnika: słowo będące
  // klasą narzędziową dokłada regułę do każdej strony (lista jak w teście
  // słownika retencji danych).
  const UTILITIES = new Set([
    "block",
    "inline",
    "flex",
    "grid",
    "table",
    "contents",
    "hidden",
    "visible",
    "invisible",
    "collapse",
    "static",
    "fixed",
    "absolute",
    "relative",
    "sticky",
    "grow",
    "shrink",
    "truncate",
    "italic",
    "underline",
    "overline",
    "uppercase",
    "lowercase",
    "capitalize",
    "border",
    "rounded",
    "shadow",
    "ring",
    "outline",
    "blur",
    "invert",
    "sepia",
    "grayscale",
    "filter",
    "transform",
    "transition",
    "container",
    "isolate",
    "resize",
    "group",
    "peer",
    "ordinal",
    "antialiased",
  ]);

  it("żaden napis nie zawiera samodzielnej nazwy klasy narzędziowej", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const [key, value] of leaves(branch(lang))) {
        for (const word of value.split(/[^A-Za-z-]+/)) {
          expect(UTILITIES.has(word), `${lang} ${key}: ${word}`).toBe(false);
        }
      }
    }
  });
});
