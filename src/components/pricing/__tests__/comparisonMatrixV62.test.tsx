// Macierz porównania wg katalogu v6.2 - na PRAWDZIWYM słowniku (`i18n-pricing`).
//
// CZEGO PILNUJE:
//   1. PARYTET WIERSZY - PL i EN mają te same `id` w tej samej kolejności,
//      a wiersze v3/v4 bez pokrycia w v6.2 (zniżka na konferencję, karta VIP,
//      wyróżnienie partnera, partner misyjny, Learning Path) zniknęły.
//   2. BILET WLICZONY Z DANYCH - `includedTicket` czyta `features` progu:
//      pula organizacji (Zespół 3 / rok), bilet osobisty (1 / rok) albo zniżka
//      stawki ulgowej (50%) - to samo, co egzekwuje `my_ticket_allowance`.
//   3. KOLUMNA UKRYTEGO PROGU tylko na życzenie wołającego (profil obecnego
//      klienta Enterprise) - powierzchnie sprzedażowe podają `listedTiers`.
//   4. PULA ZAPYTAŃ jak bramka (`GREATEST` z dawnymi flagami InMaili) i brak
//      obietnic bez pokrycia (NGO ranga 20, pozycje akademickie spoza v6.2,
//      kwoty PLN w EN).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { membershipTier } from "@/test/admin/pricingFixtures";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty po imporcie - fabryka nic nie importuje. */
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

// Fabryka SYNCHRONICZNA i bez importów: import `@/test/i18nReal` z jej wnętrza
// zakleszcza plik (`@/lib/i18n` importuje mockowany `react-i18next`) - ten sam
// wniosek co w `ReputationLevelChip.test.tsx`. Język przełączany per test.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

import { realT } from "@/test/i18nReal";
import "@/lib/i18n-pricing";

h.fixedT = realT;

const { PricingComparisonMatrix } =
  await import("@/components/pricing/organisms/PricingComparisonMatrix");

interface Row {
  id: string;
  label: string;
  values?: Record<string, string>;
  feature?: string;
  derive?: string;
}

function rows(lang: "pl" | "en"): Row[] {
  return realT(lang)("pricing.comparisonMatrix.rows", { returnObjects: true }) as unknown as Row[];
}

beforeEach(() => {
  h.lang = "pl";
});

describe("słownik macierzy v6.2", () => {
  it("PL i EN mają identyczne wiersze, klucze wartości i źródła", () => {
    const pl = rows("pl");
    const en = rows("en");
    expect(pl.length).toBeGreaterThanOrEqual(40);
    expect(pl.map((r) => r.id)).toEqual(en.map((r) => r.id));
    pl.forEach((row, index) => {
      const other = en[index];
      expect(Object.keys(row.values ?? {}), row.id).toEqual(Object.keys(other.values ?? {}));
      expect(row.feature, row.id).toBe(other.feature);
      expect(row.derive, row.id).toBe(other.derive);
      expect(row.label, row.id).not.toBe("");
    });
  });

  it("wiersze bez pokrycia w v6.2 zniknęły, nowe z v6.2 są", () => {
    const ids = rows("pl").map((r) => r.id);
    for (const gone of [
      "conferenceDiscount",
      "vipCard",
      "partnerRecognition",
      "missionPartner",
      "learningPath",
      "printedPack",
      "networkIntros",
    ]) {
      expect(ids, gone).not.toContain(gone);
    }
    for (const added of [
      "includedTicket",
      "chathamHouse",
      "soundingBoard",
      "taskForce",
      "volumeDiscount",
    ]) {
      expect(ids, added).toContain(added);
    }
  });

  it("żaden wiersz nie wymienia kolumny Enterprise ani Partnera Biznesowego", () => {
    for (const row of rows("pl")) {
      expect(Object.keys(row.values ?? {}), row.id).not.toContain("corporate");
      expect(Object.keys(row.values ?? {}), row.id).not.toContain("business");
    }
  });
});

describe("PricingComparisonMatrix - bilet wliczony z features progu", () => {
  const member = membershipTier({
    id: "t-member",
    key: "member",
    name_pl: "Członek",
    name_en: "Member",
    features: { events_members: true, included_event_tickets: 1 },
  });
  const student = membershipTier({
    id: "t-student",
    key: "student",
    name_pl: "Student i Doktorant",
    name_en: "Student",
    features: { events_members: true, event_ticket_discount_pct: 50 },
  });
  const team = membershipTier({
    id: "t-team",
    key: "team",
    name_pl: "Zespół",
    name_en: "Team",
    features: { events_members: true, included_event_tickets_org: 3 },
  });
  const corporate = membershipTier({
    id: "t-corporate",
    key: "corporate",
    name_pl: "Enterprise",
    name_en: "Enterprise",
    features: { events_members: true, included_event_tickets: 1 },
  });

  function ticketRow(): HTMLElement {
    const label = realT(h.lang)("pricing.comparisonMatrix.rows", {
      returnObjects: true,
    }) as unknown as Row[];
    const name = label.find((r) => r.id === "includedTicket")?.label ?? "";
    return screen.getByRole("row", { name: new RegExp(`^${name}`) });
  }

  it("PL: 1 / rok, zniżka 50%, 3 / rok na organizację", () => {
    render(
      <PricingComparisonMatrix tiers={[member, student, team]} lang="pl" currentTierKey={null} />,
    );
    const cells = within(ticketRow()).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual([
      "1 / rok",
      "Zniżka 50%",
      "3 / rok na organizację",
    ]);
  });

  it("EN: te same liczby w angielskiej wersji", () => {
    h.lang = "en";
    render(
      <PricingComparisonMatrix tiers={[member, student, team]} lang="en" currentTierKey={null} />,
    );
    const cells = within(ticketRow()).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual([
      "1 / yr",
      "50% off",
      "3 / yr per organisation",
    ]);
  });

  it("kolumna ukrytego progu jest, gdy wołający ją poda - profil obecnego klienta Enterprise", () => {
    // O widoczności decyduje powierzchnia: cennik podaje `listedTiers` (bez
    // Enterprise), profil dokłada próg użytkownika - z etykietą „Twój plan".
    render(
      <PricingComparisonMatrix
        tiers={[member, team, corporate]}
        lang="pl"
        currentTierKey="corporate"
      />,
    );
    const header = screen.getAllByRole("columnheader").map((c) => c.textContent);
    expect(header).toContain("Członek");
    expect(header).toContain("Zespół");
    expect(header.some((h) => h?.startsWith("Enterprise"))).toBe(true);
    expect(screen.getByText("Twój plan")).toBeInTheDocument();
  });

  // Klient Enterprise / Partnera Biznesowego zachowuje dostęp (decyzje 3/4) -
  // kolumna „Twój plan" nie może mówić „Nie" przy archiwum czy koncie NES.
  // Słownik nie wymienia tych progów, więc wartości redakcyjne idą z Pro
  // (zakres z ich karty), poza warunkami sprzedaży.
  it.each(["corporate", "business"])(
    "kolumna „Twój plan” progu %s: wiersze redakcyjne z zakresu Pro, nie kreski",
    (key) => {
      const pro = membershipTier({ id: "t-pro", key: "pro", name_pl: "Członek Pro" });
      const hidden = membershipTier({ id: `t-${key}`, key, name_pl: `Próg ${key}` });
      render(
        <PricingComparisonMatrix tiers={[member, pro, hidden]} lang="pl" currentTierKey={key} />,
      );
      const byId = (id: string) => {
        const name = rows("pl").find((r) => r.id === id)?.label ?? "";
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return screen.getByRole("row", { name: new RegExp(`^${escaped}`) });
      };
      const cell = (id: string) => within(byId(id)).getAllByRole("cell")[2];
      for (const id of ["archive", "account", "weeklyReview", "memberDigest", "citations"]) {
        expect(within(cell(id)).getByLabelText("Tak"), id).toBeInTheDocument();
      }
      expect(cell("onboarding").textContent).toBe(
        within(byId("onboarding")).getAllByRole("cell")[1].textContent,
      );
      // Warunek sprzedaży Pro nie przechodzi na próg wycofany albo ukryty.
      expect(within(cell("cancelAnytime")).getByLabelText("Nie")).toBeInTheDocument();
    },
  );
});

describe("PricingComparisonMatrix - pula zapytań do eksperta jak bramka", () => {
  function expertRow(): HTMLElement {
    const label = realT(h.lang)("pricing.comparisonMatrix.rows", {
      returnObjects: true,
    }) as unknown as Row[];
    const name = label.find((r) => r.id === "expertRequest")?.label ?? "";
    return screen.getByRole("row", { name: new RegExp(`^${name}`) });
  }

  it("dawna flaga InMaili podnosi pulę jak `my_expert_request_quota` (GREATEST)", () => {
    const legacyMember = membershipTier({
      id: "t-member-legacy",
      key: "member",
      name_pl: "Członek",
      features: { expert_request_quota: 1, chat_inmail_quota_2: true },
    });
    const legacyPro = membershipTier({
      id: "t-pro-legacy",
      key: "pro",
      name_pl: "Członek Pro",
      features: { expert_request_quota: 3, chat_inmail_quota_5: true },
    });
    // Seed v6.2 (nowy najemca) - bez dawnych flag: dokładnie 1 / mies.
    const v62Seed = membershipTier({
      id: "t-ngo-v62",
      key: "ngo",
      name_pl: "Seed v6.2",
      features: { expert_request_quota: 1 },
    });
    render(
      <PricingComparisonMatrix
        tiers={[legacyMember, legacyPro, v62Seed]}
        lang="pl"
        currentTierKey={null}
      />,
    );
    const cells = within(expertRow()).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["2 / mies.", "5 / mies.", "1 / mies."]);
  });
});

describe("słownik macierzy v6.2 - obietnice tylko z pokryciem w bramkach", () => {
  it("NGO (ranga 20) nie dostaje wartości zakresu Partnera Instytucjonalnego", () => {
    for (const lang of ["pl", "en"] as const) {
      const byId = new Map(rows(lang).map((r) => [r.id, r]));
      for (const id of [
        "decisionLab",
        "soundingBoard",
        "researchTopic",
        "consultations",
        "coverage",
        "orgBriefings",
      ]) {
        expect(Object.keys(byId.get(id)?.values ?? {}), `${lang}:${id}`).not.toContain("ngo");
      }
      expect(byId.get("clubs")?.values?.ngo, lang).toBe(byId.get("clubs")?.values?.pro);
    }
  });

  it("pozycje akademickie spoza v6.2 zniknęły (EuroChallenge, słowniczek, seminaria)", () => {
    const ids = rows("pl").map((r) => r.id);
    for (const gone of ["eduMaterials", "teachingMaterials", "seminarPriority"]) {
      expect(ids, gone).not.toContain(gone);
    }
  });

  it("EN nie podaje kwot w PLN obok cen przeliczonych na EUR", () => {
    for (const row of rows("en")) {
      for (const value of Object.values(row.values ?? {})) {
        expect(value, row.id).not.toMatch(/PLN|zł/);
      }
    }
  });

  // Parytet PL/EN porównuje klucze, nie treść - polski tekst w słowniku EN
  // („Od 11 miejsc: niższa stawka" w wierszu rabatu wolumenowego) przechodził
  // obie bramki i trafiał do anglojęzycznego gościa.
  it("EN nie zawiera polskiego tekstu (znaki diakrytyczne, typowe słowa)", () => {
    const polish = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|\b(od|miejsc|stawka|rocznie|bez|oraz)\b/i;
    for (const row of rows("en")) {
      expect(row.label, row.id).not.toMatch(polish);
      for (const value of Object.values(row.values ?? {})) {
        expect(value, row.id).not.toMatch(polish);
      }
    }
  });
});
