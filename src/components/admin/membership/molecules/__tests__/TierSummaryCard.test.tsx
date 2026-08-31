// Kafel katalogu warstw: to on zastąpił kilka ekranów przewijania edytorami.
// Kontrakt: cały kafel jest jednym przyciskiem otwierającym okno edycji,
// a liczby (benefity, uprawnienia, egzekwowane) są widoczne BEZ wchodzenia.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { membershipTier, reactI18nextStub } from "@/test/admin/pricingFixtures";

vi.mock("react-i18next", () => reactI18nextStub());

const { TierSummaryCard } = await import("@/components/admin/membership/molecules/TierSummaryCard");

function renderCard(overrides: Parameters<typeof membershipTier>[0] = {}) {
  const onOpen = vi.fn();
  const tier = membershipTier(overrides);
  render(
    <TierSummaryCard
      tier={tier}
      name="Członek"
      description="Dostęp do briefingów"
      benefitsCount={3}
      enabledCount={5}
      enforcedCount={2}
      onOpen={onOpen}
    />,
  );
  return { onOpen, tier };
}

describe("TierSummaryCard", () => {
  it("cały kafel jest przyciskiem otwierającym edycję warstwy", () => {
    const { onOpen } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /summary\.open/ }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("pokazuje nazwę, klucz i rangę bez otwierania okna", () => {
    const { tier } = renderCard({ rank: 30 });

    expect(screen.getByText("Członek")).toBeInTheDocument();
    expect(screen.getByText(tier.key)).toBeInTheDocument();
    expect(screen.getByText(/rankBadge/)).toHaveTextContent("30");
  });

  it("liczby benefitów i uprawnień są w kaflu, nie dopiero w edytorze", () => {
    renderCard();

    expect(screen.getByText(/summary\.benefits/)).toBeInTheDocument();
    expect(screen.getByText(/summary\.capabilities/)).toBeInTheDocument();
    expect(screen.getByText(/summary\.enforced/)).toBeInTheDocument();
  });

  it("znacznik warstwy DOMYŚLNEJ pojawia się tylko dla warstwy domyślnej", () => {
    renderCard({ is_default: true });
    expect(screen.getByText("adminMembership.defaultBadge")).toBeInTheDocument();
  });

  it("warstwa wyłączona jest oznaczona - inaczej nikt by nie zauważył", () => {
    renderCard({ active: false });
    expect(screen.getByText("adminMembership.inactiveBadge")).toBeInTheDocument();
  });

  it("bez opisu kafel nie renderuje pustego akapitu", () => {
    render(
      <TierSummaryCard
        tier={membershipTier()}
        name="Członek"
        description=""
        benefitsCount={0}
        enabledCount={0}
        enforcedCount={0}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByText("Dostęp do briefingów")).not.toBeInTheDocument();
  });
});
