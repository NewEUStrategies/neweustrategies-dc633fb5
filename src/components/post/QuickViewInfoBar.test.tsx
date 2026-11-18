// QuickViewInfoBar - pasek quick-view nad trescia wpisu. Testy slotu
// `trailing` (akcje po prawej, np. przycisk Gift Articles): pasek renderuje
// sie z samym trailing, a bez zadnych danych nadal zwraca null.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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

describe("QuickViewInfoBar - `<time datetime>`", () => {
  // Pasek stoi na stronie artykułu i pokazuje SAMĄ datę, więc atrybut to "valid
  // date string" dnia z ekranu (Europe/Warsaw), bez mikrosekund Postgresa.
  const RAW = "2026-09-05T22:30:00.123456+00:00";
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("22:30 UTC to już następny dzień w Warszawie - atrybut i ekran zgodne", () => {
    const { container } = render(<QuickViewInfoBar lang="pl" publishedAt={RAW} />);
    const time = container.querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-09-06");
    expect(time?.textContent).toBe("6 wrz 2026");
  });

  it("data aktualizacji wygrywa także w atrybucie", () => {
    const { container } = render(
      <QuickViewInfoBar lang="pl" publishedAt={RAW} updatedAt="2026-10-01T09:00:00.5+00:00" />,
    );
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-10-01");
  });

  it("SSR nie zależy od strefy maszyny (parytet z hydratacją)", () => {
    const html = (tz: string) => {
      process.env.TZ = tz;
      return renderToString(<QuickViewInfoBar lang="en" publishedAt={RAW} />);
    };
    const utc = html("UTC");
    // React serializuje nazwę jako `dateTime` - nazwy atrybutów HTML są bez wielkości liter.
    expect(utc).toMatch(/<time datetime="2026-09-06">6 Sept? 2026<\/time>/i);
    expect(html("America/Los_Angeles")).toBe(utc);
    expect(html("Pacific/Kiritimati")).toBe(utc);
  });
});
