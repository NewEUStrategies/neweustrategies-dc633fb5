// `PolicySentence` - polityka dostępu w jednym zdaniu (S7, SPEC §6.1).
//
// CO TEN PLIK DOWODZI.
//   1. Komponent wypisuje WSZYSTKIE części zdania `describeAccessPolicy`
//      w kolejności - bez własnej logiki i bez gubienia części.
//   2. Liczebniki i18next w obu językach (PL „5 treści ma”, EN „5 items have”).
//   3. Stan licznika „nie wiadomo” trafia do zdania jako osobna informacja.
//   4. axe bez naruszeń.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { PolicySentence } from "@/components/admin/revenue/access/PolicySentence";
import { accessPolicyFacts, describeAccessPolicy } from "@/lib/admin/revenue/policySentence";
import type { AccessInventoryDto } from "@/lib/revenue/access/dto";
import { ACCESS_INVENTORY, clone } from "../../overview/__tests__/hubFixtures";

const inventory = () => clone(ACCESS_INVENTORY) as AccessInventoryDto;
const METER = {
  enabled: true,
  member_monthly_limit: 3,
  anon_monthly_limit: 1,
  meter_paid: true,
  meter_members: true,
  show_counter: true,
};

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("PolicySentence", () => {
  it("wypisuje każdą część zdania, w kolejności", () => {
    const facts = accessPolicyFacts(inventory(), METER);
    render(<PolicySentence facts={facts} />);
    const t = realT("pl");
    const expected = describeAccessPolicy(facts)
      .map((part) => t(part.key, part.params))
      .join(" ");
    expect(screen.getByTestId("policy-sentence")).toHaveTextContent(expected);
    expect(screen.getByTestId("policy-sentence")).toHaveTextContent(
      "Licznik daje zalogowanym 3 darmowe artykuły w miesiącu, a gościom 1.",
    );
  });

  it("po angielsku z liczebnikami", async () => {
    await i18n.changeLanguage("en");
    render(<PolicySentence facts={accessPolicyFacts({ ...inventory(), total: 5 }, METER)} />);
    expect(screen.getByTestId("policy-sentence")).toHaveTextContent("5 items have an access rule");
    expect(screen.getByTestId("policy-sentence")).toHaveTextContent("1 gate leads to no offer.");
  });

  it("licznik nieodczytany to „nie wiadomo”, nie „wyłączony”", () => {
    render(<PolicySentence facts={accessPolicyFacts(inventory(), undefined)} />);
    const text = screen.getByTestId("policy-sentence");
    expect(text).toHaveTextContent("Stanu licznika darmowych artykułów nie udało się odczytać.");
    expect(text).not.toHaveTextContent("jest wyłączony");
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(<PolicySentence facts={accessPolicyFacts(inventory(), METER)} />);
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
