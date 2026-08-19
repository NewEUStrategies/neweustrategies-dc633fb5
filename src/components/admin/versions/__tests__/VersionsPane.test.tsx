// Organizm nadrzędny sekcji „Wersje" (`VersionsPane`, 0%): trzy zakładki -
// polityki, banner zgód, elementy buildera.
//
// Sam w sobie jest cienki, ale niesie jedną regułę, której złamanie jest
// widoczne dopiero w produkcji: ZAKŁADKI SĄ WZAJEMNIE WYŁĄCZNE i tylko
// AKTYWNA jest zamontowana. Każdy z trzech paneli odpytuje własne źródło przy
// montażu, więc zamontowanie ich wszystkich naraz wysyłałoby trzy komplety
// zapytań o historię przy każdym wejściu w sekcję.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({ lang: "pl" as "pl" | "en", mounted: [] as string[] }));

vi.mock("@/lib/builder/labelsEn", () => ({ useAdminLang: () => h.lang }));

// Panele mają własne pliki testowe; tutaj zastępujemy je znacznikami, żeby
// sprawdzić, KTÓRY z nich jest zamontowany i z jakim językiem.
vi.mock("@/components/admin/versions/organisms/PolicyVersionsPane", () => ({
  PolicyVersionsPane: ({ lang }: { lang: string }) => {
    h.mounted.push(`policies:${lang}`);
    return <div data-testid="pane-policies" />;
  },
}));
vi.mock("@/components/admin/versions/organisms/CookieVersionsPane", () => ({
  CookieVersionsPane: ({ lang }: { lang: string }) => {
    h.mounted.push(`cookies:${lang}`);
    return <div data-testid="pane-cookies" />;
  },
}));
vi.mock("@/components/admin/versions/organisms/BuilderVersionsPane", () => ({
  BuilderVersionsPane: ({ lang }: { lang: string }) => {
    h.mounted.push(`builder:${lang}`);
    return <div data-testid="pane-builder" />;
  },
}));

import { VersionsPane } from "@/components/admin/versions/VersionsPane";

afterEach(() => {
  cleanup();
  h.lang = "pl";
  h.mounted = [];
});

describe("VersionsPane", () => {
  it("startuje na politykach i montuje TYLKO ten panel", () => {
    // Zamontowanie wszystkich trzech naraz wysyłałoby trzy komplety zapytań
    // o historię przy każdym wejściu w sekcję.
    render(<VersionsPane />);
    expect(screen.getByTestId("pane-policies")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-cookies")).toBeNull();
    expect(screen.queryByTestId("pane-builder")).toBeNull();
  });

  it("przełącza na banner zgód i ODMONTOWUJE poprzedni panel", () => {
    render(<VersionsPane />);
    fireEvent.click(screen.getByText("Banner cookies i zgody"));

    expect(screen.getByTestId("pane-cookies")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-policies")).toBeNull();
  });

  it("przełącza na elementy buildera", () => {
    render(<VersionsPane />);
    fireEvent.click(screen.getByText("Widgety i popupy"));

    expect(screen.getByTestId("pane-builder")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-policies")).toBeNull();
  });

  it("aktywna zakładka jest oznaczona dla technologii asystujących", () => {
    // Wizualny wariant przycisku nie dociera do czytnika ekranu.
    render(<VersionsPane />);
    expect(screen.getByRole("button", { name: "Polityki i regulamin" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Widgety i popupy" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByText("Widgety i popupy"));

    expect(screen.getByRole("button", { name: "Widgety i popupy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("nawigacja zakładek ma nazwę dostępną", () => {
    render(<VersionsPane />);
    expect(screen.getByRole("navigation", { name: "Sekcje wersji" })).toBeInTheDocument();
  });

  it("PRZEKAZUJE język panelu w dół, do zamontowanego panelu", () => {
    // Panele są dwujęzyczne przez prop, nie przez własny odczyt - rozjazd
    // dałby polską zakładkę z angielskim wnętrzem.
    h.lang = "en";
    render(<VersionsPane />);
    expect(h.mounted).toContain("policies:en");
  });

  it("etykiety zakładek są dwujęzyczne", () => {
    h.lang = "en";
    render(<VersionsPane />);
    expect(screen.getByText("Policies & terms")).toBeInTheDocument();
    expect(screen.getByText("Cookie banner & consent")).toBeInTheDocument();
    expect(screen.getByText("Widgets & popups")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Version sections" })).toBeInTheDocument();
  });
});
