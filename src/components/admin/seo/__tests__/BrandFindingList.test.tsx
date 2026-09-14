// Lista uwag audytu marki. Wyprowadzona z DWÓCH tras (kokpit i strona główna),
// gdzie ten sam wiersz był wklejony dwa razy.
//
// CO TU JEST PRZEDMIOTEM DOWODU, a czego nie ma w testach tamtych tras.
// Obie trasy podają audytowi wartości, które ZAWSZE mają fallback (tytuł spada
// na stałą marki, karta społecznościowa na plik marki), więc waga `error` jest
// tam nieosiągalna z konstrukcji - gałąź istniała i była martwa. Tutaj waga
// jest zwykłym wejściem, więc obie ścieżki dowodzi się wprost: kolor, klucz
// nagłówka i to, że komunikat leci z parametrami interpolacji, a nie z tekstem
// zapasowym.
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { BrandFindingList } from "@/components/admin/seo/BrandFindingList";
import type { BrandFinding } from "@/lib/seo/brandAudit";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

afterEach(() => cleanup());

const warning: BrandFinding = { id: "sameAsMissing", severity: "warning" };
const error: BrandFinding = { id: "homepageNoindex", severity: "error" };

describe("BrandFindingList", () => {
  it("pusta lista pokazuje PODANY klucz pustki, a nie własny", () => {
    // Kokpit mówi „wszystko w porządku", zakładka języka „nic w tym języku" -
    // ten sam komponent, dwa różne komunikaty. Zaszycie jednego z nich
    // odebrałoby drugiemu ekranowi sens.
    render(<BrandFindingList findings={[]} emptyKey="adminSeoHub.allGood" />);
    expect(screen.getByText("adminSeoHub.allGood")).toBeTruthy();
    cleanup();
    render(<BrandFindingList findings={[]} emptyKey="adminSeoHub.auditClean" />);
    expect(screen.getByText("adminSeoHub.auditClean")).toBeTruthy();
  });

  it("OSTRZEŻENIE dostaje bursztynową plakietkę i swój nagłówek", () => {
    render(<BrandFindingList findings={[warning]} emptyKey="adminSeoHub.allGood" />);
    const row = screen.getByTestId("brand-finding");
    expect(row.getAttribute("data-severity")).toBe("warning");
    expect(screen.getByText("adminSeoHub.severityWarning")).toBeTruthy();
    expect(row.innerHTML).toContain("text-amber-500");
  });

  it("BŁĄD dostaje plakietkę destrukcyjną i swój nagłówek", () => {
    // Ta gałąź jest nieosiągalna z obu tras - i właśnie dlatego jest tutaj.
    render(<BrandFindingList findings={[error]} emptyKey="adminSeoHub.allGood" />);
    const row = screen.getByTestId("brand-finding");
    expect(row.getAttribute("data-severity")).toBe("error");
    expect(screen.getByText("adminSeoHub.severityError")).toBeTruthy();
    expect(row.innerHTML).toContain("text-destructive");
  });

  it("komunikat bierze klucz z `id` uwagi", () => {
    render(<BrandFindingList findings={[warning]} emptyKey="adminSeoHub.allGood" />);
    expect(screen.getByText("adminSeoHub.finding.sameAsMissing")).toBeTruthy();
  });

  it("parametry uwagi lecą jako INTERPOLACJA, nie jako tekst zapasowy", () => {
    // Atrapa i18n dokleja parametry w nawiasie, więc widać, że trafiły do
    // `t()` drugim argumentem. Gdyby poszły jako `defaultValue`, bramka
    // `check:i18n-default-value` (próg zero) wywaliłaby CI.
    render(
      <BrandFindingList
        findings={[{ id: "titleBrandStripped", severity: "warning", params: { brand: "Marka" } }]}
        emptyKey="adminSeoHub.allGood"
      />,
    );
    expect(screen.getByText("adminSeoHub.finding.titleBrandStripped(brand=Marka)")).toBeTruthy();
  });

  it("uwaga BEZ parametrów nie wywraca interpolacji", () => {
    render(<BrandFindingList findings={[error]} emptyKey="adminSeoHub.allGood" />);
    expect(screen.getByText("adminSeoHub.finding.homepageNoindex")).toBeTruthy();
  });

  it("obie wagi naraz renderują się w PODANEJ kolejności", () => {
    // Kolejność jest kontraktem audytu (błędy przed ostrzeżeniami) - lista nie
    // ma prawa jej przestawiać.
    render(<BrandFindingList findings={[error, warning]} emptyKey="adminSeoHub.allGood" />);
    const rows = screen.getAllByTestId("brand-finding");
    expect(rows.map((r) => r.getAttribute("data-severity"))).toEqual(["error", "warning"]);
  });
});
