// Karta progu na PRAWDZIWYCH benefitach katalogu v6.2 - treść czytana wprost
// z migracji `20261018160200_pricing_v62_catalog_benefits.sql`, tej samej,
// z której seed i apply zapisują `membership_tiers.benefits`.
//
// CZEGO PILNUJE (v6.2, „Komunikacja karty" i „Granica wpływu"):
//   1. Granica wpływu sounding boardu Rady Instytutu („Nie daje prawa do
//      zmiany treści...") jest NA KARCIE, także gdy benefit trafia do
//      spotlightu „Co wyróżnia ten plan" - w PL i EN.
//   2. Karta Członka Pro nie gubi żadnej z 12 pozycji: trzy w spotlighcie,
//      dziewięć w rozwijanej liście szczegółowej (przycisk
//      z `aria-expanded` / `aria-controls`), razem z nagłówkiem o „tym samym
//      jednym bilecie rocznie - nie drugim".
//   3. Granica wpływu POZA spotlightem (zgłoszenie tematu Rady, posiedzenie
//      agendy Kręgu Założycieli) jest widoczna w stanie ZWINIĘTYM - nie za
//      „Pokaż więcej". `toBeVisible`, bo `getByText` znajduje też treść
//      w panelu z atrybutem `hidden`.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { accessPlan } from "@/test/billing/fixtures";
import { membershipTier, reactI18nextStub } from "@/test/admin/pricingFixtures";
import { RouterLinkStub } from "@/test/routerLinkStub";
import { parseTierBenefits, type TierBenefit } from "@/lib/billing/tiers";
import { distinguishingBenefits } from "@/lib/pricing/selectors";

let lang = "pl";

vi.mock("react-i18next", () => reactI18nextStub(() => lang));
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("@/lib/analytics/track", () => ({ trackCta: () => undefined }));

const { TierCard } = await import("@/components/pricing/organisms/TierCard");

// NAJNOWSZA definicja `pricing_catalog_v62_benefits()` - funkcja jest
// redefiniowana (20261018160200 -> I9b 20261020160200, karta Zespołu po
// decyzji właściciela), a seed czyta ostatnią wersję, nie pierwszą.
const MIGRATIONS = resolve(process.cwd(), "supabase/migrations");
const MIGRATION = resolve(
  MIGRATIONS,
  readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) =>
      readFileSync(resolve(MIGRATIONS, name), "utf8").includes(
        "CREATE OR REPLACE FUNCTION public.pricing_catalog_v62_benefits()",
      ),
    )
    .at(-1) ?? "",
);

/** Benefity progu z migracji: literał `('key', '[...]'::jsonb)`, `''` = apostrof. */
function catalogBenefits(key: string): TierBenefit[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf(`('${key}', '[`);
  if (start < 0) throw new Error(`brak progu ${key} w katalogu v6.2`);
  const from = sql.indexOf("[", start);
  const to = sql.indexOf("]'::jsonb)", from);
  return parseTierBenefits(JSON.parse(sql.slice(from, to + 1).replace(/''/g, "'")));
}

function renderTier(key: string, previousKey: string) {
  const benefits = catalogBenefits(key);
  const highlights = distinguishingBenefits(benefits, catalogBenefits(previousKey), lang, 3);
  render(
    <TierCard
      tier={membershipTier({ key, benefits: benefits as never })}
      plans={[accessPlan({ id: `plan-${key}`, tier_key: key })]}
      interval="month"
      lang={lang}
      isCurrentTier={false}
      currentPlanId={null}
      isAuthenticated={false}
      onContact={vi.fn()}
      highlights={highlights}
    />,
  );
  return { benefits, highlights };
}

beforeEach(() => {
  lang = "pl";
});

describe("Rada Instytutu - granica wpływu sounding boardu na karcie", () => {
  it.each([
    ["pl", /Nie daje prawa do zmiany treści, usunięcia wniosku ani wstrzymania publikacji/],
    ["en", /no right to change the text, remove a finding or stop publication/],
  ])("%s: zdanie wiążące stoi przy benefice, także w spotlighcie", (language, sentence) => {
    lang = language;
    const { highlights } = renderTier("vip", "pro");

    // Sounding board jest jednym z trzech wyróżników Rady względem Pro.
    expect(highlights.some((b) => /Sounding board/.test(b.pl))).toBe(true);
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });
});

describe("Członek Pro - pełna lista benefitów bez strat", () => {
  it("12 pozycji v6.2: spotlight, lista i rozwijana lista szczegółowa", () => {
    const { benefits } = renderTier("pro", "member");
    expect(benefits).toHaveLength(12);

    const toggle = screen.getByRole("button", { name: /pricing\.benefitsMore/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // v6.2, „Komunikacja karty": trzy pozycje w spotlighcie, „pozostałe
    // dziewięć trafia do rozwijanej listy szczegółowej" - nic stale widocznego
    // poza spotlightem.
    expect(toggle.textContent).toContain('"count":9');
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(panel).not.toBeVisible();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    for (const benefit of benefits) {
      expect(screen.getByText(benefit.pl), benefit.pl).toBeInTheDocument();
    }
    // Pozycje, które v6.2 „DODAJE" - dawniej obcinane z karty.
    expect(screen.getByText("Spotkania prowadzone w regule Chatham House")).toBeVisible();
    expect(
      screen.getByText("Wydarzenia o ograniczonej liczbie miejsc, z kolejką rezerwową"),
    ).toBeVisible();
  });

  it("nagłówek o tym samym bilecie (nie drugim) zostaje na karcie", () => {
    renderTier("pro", "member");

    expect(screen.getByText(/tym samym jednym biletem rocznie, nie drugim/)).toBeVisible();
  });
});

describe("granica wpływu poza spotlightem - widoczna bez rozwijania", () => {
  it.each([
    ["vip", "pro", /Zgłoszenie jest wnioskiem, nie zleceniem/],
    ["presidents_circle", "partner_general", /zapis nie podlega negocjacji w umowie indywidualnej/],
  ])("%s: zdanie wiążące stoi na karcie w stanie zwiniętym", (key, previousKey, sentence) => {
    renderTier(key, previousKey);

    expect(screen.getByText(sentence)).toBeVisible();
  });

  it("Krąg Założycieli: krótka reszta bez przycisku „Pokaż więcej”", () => {
    renderTier("presidents_circle", "partner_general");

    expect(screen.queryByRole("button", { name: /pricing\.benefitsMore/ })).toBeNull();
    expect(screen.getByText("Miejsce w panelu recenzenckim publikacji")).toBeVisible();
  });
});

describe("Zespół - karta po decyzji właściciela 2026-10-20 (I9b)", () => {
  it("benefity czytane z najnowszej definicji katalogu", () => {
    expect(MIGRATION).toMatch(/20261020160200_pricing_v62_decisions_tenants\.sql$/);
  });

  it.each([
    ["pl", "Pełny zakres Członka Pro dla każdego miejsca", /bez monitoringu/],
    ["en", "The full Member Pro scope for every seat", /without regulatory monitoring/],
  ])(
    "%s: pełny zakres Pro z trackerem, bez dopisku o braku monitoringu",
    (language, first, gone) => {
      lang = language;
      const { benefits } = renderTier("team", "pro");

      expect(benefits[0][language === "pl" ? "pl" : "en"]).toBe(first);
      for (const benefit of benefits) {
        expect(language === "pl" ? benefit.pl : benefit.en).not.toMatch(gone);
      }
    },
  );

  it("nowy najemca: korespondencja z ekspertami to pula 3 zapytań na miejsce (bramka seedu)", () => {
    const { benefits } = renderTier("team", "pro");

    expect(benefits.map((b) => b.pl)).toContain(
      "Korespondencja z ekspertami: 3 zapytania miesięcznie na miejsce",
    );
  });
});
