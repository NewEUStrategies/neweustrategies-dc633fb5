// QuickViewInfoBar - pasek quick-view nad trescia wpisu. Testy slotu
// `trailing` (akcje po prawej, np. przycisk Gift Articles): pasek renderuje
// sie z samym trailing, a bez zadnych danych nadal zwraca null.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuickViewInfoBar } from "@/components/post/QuickViewInfoBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

describe("QuickViewInfoBar", () => {
  it("bez danych i bez trailing nie renderuje niczego", () => {
    const { container } = render(<QuickViewInfoBar lang="pl" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renderuje pasek z samym trailing (akcje po prawej)", () => {
    render(<QuickViewInfoBar lang="pl" trailing={<button type="button">Podaruj</button>} />);
    expect(screen.getByRole("button", { name: "Podaruj" })).toBeInTheDocument();
  });

  it("meta i trailing wspolistnieja w jednym wierszu", () => {
    render(
      <QuickViewInfoBar
        lang="pl"
        readMinutes={7}
        primaryCategory={{ slug: "cyber", name_pl: "Cyberbezpieczeństwo" }}
        trailing={<span data-testid="akcje" />}
      />,
    );
    expect(screen.getByText("Cyberbezpieczeństwo")).toBeInTheDocument();
    expect(screen.getByTestId("akcje")).toBeInTheDocument();
  });
});
