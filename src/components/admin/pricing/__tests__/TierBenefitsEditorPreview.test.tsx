// Edytor benefitów warstwy - PODGLĄD „jak to zobaczy klient" i izolacja
// edycji między wierszami.
//
// RYZYKO. Benefit dopisany tutaj ląduje na karcie planu w /pricing jako
// obietnica sprzedażowa. Redakcja sprawdza jego wygląd w oknie podglądu,
// zanim zapisze warstwę - więc podgląd, który pokazuje INNY wiersz niż
// kliknięty (albo wywraca się na wierszu, którego już nie ma), wprowadza
// w błąd dokładnie w chwili decyzji o tym, co sprzedajemy. Druga rzecz:
// edycja jednego wiersza nie może przepisać pozostałych (lista idzie do bazy
// w całości przez `serializeTierBenefits`).
//
// Atrapowane: słownik (echo klucza) i rejestracja zasobów i18n. Okno podglądu
// (`BenefitPreviewDialog`) i lista benefitów strony publicznej biegną
// PRAWDZIWE - to ich złożenie jest przedmiotem dowodu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TierBenefit } from "@/lib/billing/tiers";

vi.mock("react-i18next", async () => (await import("@/test/reactStubs")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-pricing", () => ({ ensureI18n: () => {} }));

import { TierBenefitsEditor } from "@/components/admin/pricing/TierBenefitsEditor";

const FIRST: TierBenefit = { pl: "Poranny briefing", en: "Morning briefing" };
const SECOND: TierBenefit = {
  pl: "Zamknięte debaty",
  en: "Closed-door debates",
  detail_pl: "Raz w miesiącu, Warszawa",
  detail_en: "Monthly, Warsaw",
};

let onChange: ReturnType<typeof vi.fn<(next: TierBenefit[]) => void>>;

beforeEach(() => {
  onChange = vi.fn<(next: TierBenefit[]) => void>();
});

function renderEditor(value: TierBenefit[] = [FIRST, SECOND]) {
  return render(<TierBenefitsEditor value={value} onChange={onChange} />);
}

describe("TierBenefitsEditor - podgląd benefitu", () => {
  it("podgląd pokazuje DOKŁADNIE kliknięty wiersz, w obu językach naraz", async () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "adminPricing.benefits.preview #2" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("adminPricing.benefits.previewTitle")).toBeInTheDocument();
    expect(within(dialog).getByText("Zamknięte debaty")).toBeInTheDocument();
    expect(within(dialog).getByText("Closed-door debates")).toBeInTheDocument();
    expect(within(dialog).getByText("Raz w miesiącu, Warszawa")).toBeInTheDocument();
    expect(within(dialog).queryByText("Poranny briefing")).not.toBeInTheDocument();
  });

  it("podgląd niczego nie zapisuje - lista nie dostaje zmiany", async () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "adminPricing.benefits.preview #1" }));

    await screen.findByRole("dialog");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("zamknięcie podglądu chowa okno, a kolejny podgląd pokazuje już nowy wiersz", async () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "adminPricing.benefits.preview #2" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "adminPricing.benefits.preview #1" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Poranny briefing")).toBeInTheDocument();
    expect(within(dialog).queryByText("Zamknięte debaty")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lista skrócona z zewnątrz przy otwartym podglądzie nie pokazuje cudzego benefitu", async () => {
    // Wiersz #2 znika z wartości (np. szkic warstwy odświeżony z bazy), gdy
    // jego podgląd jest otwarty. Okno nie może się wywrócić ani pokazać
    // wiersza, który wskoczył na tę pozycję.
    const view = renderEditor([FIRST, SECOND]);
    fireEvent.click(screen.getByRole("button", { name: "adminPricing.benefits.preview #2" }));
    await screen.findByRole("dialog");

    view.rerender(<TierBenefitsEditor value={[FIRST]} onChange={onChange} />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("Zamknięte debaty")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Poranny briefing")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("listitem")).not.toBeInTheDocument();
  });
});

describe("TierBenefitsEditor - edycja jednego wiersza", () => {
  it("zmiana treści wiersza #2 zostawia wiersz #1 NIETKNIĘTY (ten sam obiekt)", () => {
    const value = [FIRST, SECOND];
    renderEditor(value);

    fireEvent.change(screen.getByLabelText("adminPricing.benefits.labelEn #2"), {
      target: { value: "Closed debates" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(FIRST);
    expect(next[1]).toEqual({ ...SECOND, en: "Closed debates" });
  });

  it("zmiana rozwinięcia wiersza #1 nie przenosi go do wiersza #2", () => {
    renderEditor([{ ...FIRST, detail_pl: "Codziennie o 7:00" }, SECOND]);

    fireEvent.change(screen.getByLabelText("adminPricing.benefits.detailPl #1"), {
      target: { value: "Codziennie o 6:30" },
    });

    const next = onChange.mock.calls[0][0];
    expect(next[0].detail_pl).toBe("Codziennie o 6:30");
    expect(next[1]).toBe(SECOND);
  });
});
