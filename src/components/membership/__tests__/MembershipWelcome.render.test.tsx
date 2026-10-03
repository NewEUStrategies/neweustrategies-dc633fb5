// PANEL POWITALNY PO AKTYWACJI I PO ZAKUPIE - render, nie tylko teksty.
//
// `membershipWelcome.test.ts` sprawdza same napisy (`welcomeCopy`). Render
// panelu - lista benefitów, nazwa planu, logo marki w motywie i propozycja
// wyższego planu - nie miał wykonania. A to jest PIERWSZY ekran, który widzi
// osoba, która właśnie zapłaciła: lista benefitów jest tu obietnicą, za którą
// zapłaciła, więc idzie z jej warstwy, w jej języku, ze szczegółem.
//
// Kontrakty:
//   * benefity warstwy z jej klucza (RPC `current_membership_tier`) z katalogu
//     `membership_tiers`, PL/EN z odwrotem do drugiego języka i szczegółem;
//   * „Porównaj plany" tylko wtedy, gdy wyżej coś jest (najwyższy plan nie
//     dostaje propozycji zakupu tego, co już ma);
//   * logo marki z ustawień motywu, z wariantem ciemnym; bez logo - sam napis.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MembershipTierRow } from "@/lib/billing/tiers";

const h = vi.hoisted(() => ({
  language: "pl",
  theme: "light" as "light" | "dark",
  current: { data: null as null | Record<string, unknown>, isLoading: false },
  tiers: { data: [] as MembershipTierRow[], isLoading: false },
  settings: {} as Record<string, unknown>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: h.language }, t: (k: string) => k }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: unknown }) => (
    <a href={to}>{children as never}</a>
  ),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: h.settings }),
}));
vi.mock("@/components/ThemeProvider", () => ({ useTheme: () => ({ theme: h.theme }) }));
vi.mock("@/lib/billing/tiers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/tiers")>()),
  useCurrentTier: () => h.current,
  useMembershipTiers: () => h.tiers,
}));

import { membershipTier } from "@/test/admin/pricingFixtures";
import { MembershipWelcome } from "../MembershipWelcome";

const PRO = membershipTier({
  key: "pro",
  name_pl: "Profesjonalny",
  name_en: "Professional",
  rank: 20,
  benefits: [
    { pl: "Briefing poranny", en: "Morning briefing", detail_pl: "Codziennie o 7:00" },
    { pl: "", en: "Expert calls" },
  ],
});
const PATRON = membershipTier({ id: "t-patron", key: "patron", rank: 30 });

beforeEach(() => {
  h.language = "pl";
  h.theme = "light";
  h.current = {
    data: { key: "pro", rank: 20, name_pl: "Pro PL", name_en: "Pro EN" },
    isLoading: false,
  };
  h.tiers = { data: [PRO, PATRON], isLoading: false };
  h.settings = {};
});

afterEach(cleanup);

describe("MembershipWelcome - benefity warstwy", () => {
  it("lista benefitów idzie z warstwy, ze szczegółem i odwrotem do drugiego języka", () => {
    render(<MembershipWelcome />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Lista benefitów planu Profesjonalny" }),
    ).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Briefing porannyCodziennie o 7:00", "Expert calls"]);
  });

  it("po angielsku: nazwa planu i benefity EN; brak szczegółu EN - odwrót do PL", () => {
    h.language = "en-GB";
    render(<MembershipWelcome mode="upgraded" />);
    expect(screen.getByRole("heading", { level: 1, name: "Your plan is active" })).toBeTruthy();
    expect(screen.getByText("Your Professional plan is now active on your account.")).toBeTruthy();
    // Odwrót szczegółu do drugiego języka robi `parseTierBenefits` - tak samo
    // jak przy nazwie: lepszy szczegół po polsku niż żaden.
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Morning briefingCodziennie o 7:00",
      "Expert calls",
    ]);
  });

  it("w trakcie odczytu - komunikat ładowania zamiast pustej listy", () => {
    h.tiers = { data: [], isLoading: true };
    render(<MembershipWelcome />);
    expect(screen.getByText("Wczytujemy korzyści Twojego planu…")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("warstwa spoza katalogu: nazwa z RPC, a benefity - zapowiedź zamiast pustki", () => {
    h.tiers = { data: [PATRON], isLoading: false };
    render(<MembershipWelcome />);
    expect(screen.getByText("Twoje konto jest aktywne. Plan: Pro PL.")).toBeTruthy();
    expect(screen.getByText("Korzyści tego planu pojawią się tutaj wkrótce.")).toBeTruthy();
  });

  it("bez żadnej warstwy plan nazywa się „Członkowski”", () => {
    h.current = { data: null, isLoading: false };
    render(<MembershipWelcome />);
    expect(screen.getByText("Twoje konto jest aktywne. Plan: Członkowski.")).toBeTruthy();
  });

  it("bez warstwy po angielsku: „Member”, a nazwa z RPC ma odwrót do PL", () => {
    h.language = "en";
    h.current = { data: { key: "x", rank: 0, name_pl: "Tylko PL", name_en: "" }, isLoading: false };
    h.tiers = { data: [], isLoading: false };
    const { unmount } = render(<MembershipWelcome />);
    expect(screen.getByText("Your account is active. Plan: Tylko PL.")).toBeTruthy();
    unmount();
    h.current = { data: null, isLoading: false };
    render(<MembershipWelcome />);
    expect(screen.getByText("Your account is active. Plan: Member.")).toBeTruthy();
  });
});

describe("MembershipWelcome - propozycja wyższego planu", () => {
  it("jest, gdy wyżej stoi inna warstwa", () => {
    render(<MembershipWelcome />);
    expect(screen.getByRole("link", { name: "Porównaj plany" }).getAttribute("href")).toBe(
      "/pricing",
    );
  });

  it("najwyższy plan nie dostaje propozycji zakupu tego, co już ma", () => {
    h.current = { data: { key: "patron", rank: 30 }, isLoading: false };
    render(<MembershipWelcome />);
    expect(screen.queryByRole("link", { name: "Porównaj plany" })).toBeNull();
    expect(screen.getByRole("link", { name: "Przejdź do profilu" })).toBeTruthy();
  });
});

describe("MembershipWelcome - znak marki", () => {
  const logo = (cfg: Record<string, string>) => {
    h.settings = { theme_options: { logo: cfg } };
  };

  it("bez logo w ustawieniach zostaje sam napis marki", () => {
    render(<MembershipWelcome />);
    expect(screen.queryByTestId("membership-welcome-logo")).toBeNull();
    expect(screen.getByText("New European Strategies")).toBeTruthy();
  });

  it("jasny motyw bierze logo główne, ciemny - wariant ciemny", () => {
    logo({
      main: "https://cdn.example.com/jasne.svg",
      main_dark: "https://cdn.example.com/ciemne.svg",
    });
    const { unmount } = render(<MembershipWelcome />);
    expect(screen.getByTestId("membership-welcome-logo").getAttribute("src")).toBe(
      "https://cdn.example.com/jasne.svg",
    );
    unmount();
    h.theme = "dark";
    render(<MembershipWelcome />);
    expect(screen.getByTestId("membership-welcome-logo").getAttribute("src")).toBe(
      "https://cdn.example.com/ciemne.svg",
    );
  });

  it("ciemny motyw bez wariantu ciemnego bierze logo jasne zamiast niczego", () => {
    h.theme = "dark";
    logo({ mobile: "https://cdn.example.com/mobilne.svg" });
    render(<MembershipWelcome />);
    expect(screen.getByTestId("membership-welcome-logo").getAttribute("src")).toBe(
      "https://cdn.example.com/mobilne.svg",
    );
  });
});
